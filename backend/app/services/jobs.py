import hashlib
import json
import logging
import queue
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Tuple
from sqlmodel import Session, select
from backend.app.config import settings
from backend.app.database import engine as default_engine
from backend.app.errors import AppException
from backend.app.models import Job

logger = logging.getLogger(__name__)

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def compute_payload_hash(payload: Dict[str, Any]) -> str:
    """Compute deterministic SHA-256 hash of a JSON-serializable dictionary."""
    canonical_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

class JobRunner:
    """
    In-process single background worker managing a bounded job queue.
    Ensures serialization of long-running operations and state preservation across restarts.
    """

    def __init__(
        self,
        max_waiting: Optional[int] = None,
        engine_override=None,
    ):
        self.max_waiting = max_waiting or settings.JOB_QUEUE_MAX_WAITING
        self.queue: queue.Queue = queue.Queue(maxsize=self.max_waiting)
        self.engine = engine_override or default_engine
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._handlers: Dict[
            str,
            Callable[[str, Dict[str, Any], Callable[[Optional[str], Optional[float]], None]], Dict[str, Any]],
        ] = {}

    def register_handler(
        self,
        kind: str,
        handler: Callable[[str, Dict[str, Any], Callable[[Optional[str], Optional[float]], None]], Dict[str, Any]],
    ) -> None:
        """Register a handler function for a specific job kind."""
        with self._lock:
            self._handlers[kind] = handler

    def start(self) -> None:
        """Start worker thread and perform startup recovery for interrupted jobs."""
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._recover_interrupted_jobs()
            if self._worker_thread is None or not self._worker_thread.is_alive():
                self._stop_event.clear()
                self._worker_thread = threading.Thread(
                    target=self._worker_loop,
                    name="fluenttube-job-worker",
                    daemon=True,
                )
                self._worker_thread.start()
                logger.info("JobRunner background worker started.")

    def stop(self, timeout: float = 5.0) -> None:
        """Signal worker thread to stop and wait up to timeout."""
        self._stop_event.set()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=timeout)
            logger.info("JobRunner background worker stopped.")

    def _recover_interrupted_jobs(self) -> None:
        """
        Resume saved local imports after a restart. Other interrupted work is marked
        failed; external requests are never retried automatically.
        """
        with Session(self.engine) as session:
            interrupted_jobs = session.exec(
                select(Job).where(Job.status.in_(["queued", "running"]))
            ).all()
            for job in interrupted_jobs:
                if job.kind == "local_ingest" and job.kind in self._handlers and not self.queue.full():
                    try:
                        from backend.app.services.local_video import local_media_path
                        local_media_path(json.loads(job.payload_json)["file_relative_path"])
                        job.status = "queued"
                        job.stage = "recovering"
                        job.error_code = None
                        job.error_message = None
                        job.finished_at = None
                        session.add(job)
                        self.queue.put_nowait(job.id)
                        continue
                    except (AppException, ValueError, KeyError, TypeError):
                        pass
                job.status = "failed"
                job.error_code = "JOB_INTERRUPTED"
                job.error_message = "Processing stopped when the local app restarted."
                job.finished_at = utc_now()
                session.add(job)
            if interrupted_jobs:
                session.commit()
                logger.warning(
                    f"Recovered {len(interrupted_jobs)} interrupted jobs from prior execution."
                )

    def resume_local_job(self, job_id: str) -> Job:
        """Resume a saved local file once; never restart a YouTube request."""
        from backend.app.services.local_video import local_media_path
        with self._lock:
            with Session(self.engine) as session:
                job = session.get(Job, job_id)
                if not job:
                    raise AppException(code="RESOURCE_NOT_FOUND", message="This import was not found.", status_code=404)
                if job.kind != "local_ingest":
                    raise AppException(code="JOB_NOT_RESUMABLE", message="Only imports from saved local files can be continued this way.", status_code=409)
                if job.status in {"queued", "running", "succeeded"}:
                    return job
                try:
                    local_media_path(json.loads(job.payload_json)["file_relative_path"])
                except (ValueError, KeyError, TypeError) as exc:
                    raise AppException(code="LOCAL_MEDIA_NOT_FOUND", message="The saved file could not be found. Choose it again.", status_code=404) from exc
                if self.queue.full():
                    raise AppException(code="QUEUE_FULL", message="Another video is being processed. Try continuing this import a little later.", status_code=429, retryable=True)
                job.status = "queued"
                job.stage = "recovering"
                job.error_code = None
                job.error_message = None
                job.finished_at = None
                job.started_at = None
                job.result_json = None
                session.add(job)
                session.commit()
                session.refresh(job)
                self.queue.put_nowait(job.id)
                return job

    def enqueue_job(
        self,
        kind: str,
        client_request_id: str,
        payload: Dict[str, Any],
    ) -> Tuple[Job, bool]:
        """
        Idempotently enqueue a new background job.
        Returns:
            (Job, created: bool)
        Raises:
            AppException(409, "IDEMPOTENCY_CONFLICT") if same client_request_id has different payload.
            AppException(429, "QUEUE_FULL") if queue is at capacity.
        """
        request_hash = compute_payload_hash(payload)

        with self._lock:
            # 1. Check idempotency in database
            with Session(self.engine) as session:
                existing_job = session.exec(
                    select(Job).where(Job.client_request_id == client_request_id)
                ).first()

                if existing_job:
                    if existing_job.request_hash != request_hash:
                        raise AppException(
                            code="IDEMPOTENCY_CONFLICT",
                            message="A job with this client_request_id already exists with a different payload.",
                            status_code=409,
                            retryable=False,
                            details={"client_request_id": client_request_id},
                        )
                    # Identical payload retry: return existing job without re-queueing
                    return existing_job, False

            # 2. Check queue capacity before writing to DB (prevent orphaned 'queued' records)
            if self.queue.full():
                raise AppException(
                    code="QUEUE_FULL",
                    message="Job queue is full. Please retry after current operations complete.",
                    status_code=429,
                    retryable=True,
                    details={"max_waiting": self.max_waiting},
                )

            # 3. Create persistent job record
            new_job = Job(
                client_request_id=client_request_id,
                request_hash=request_hash,
                kind=kind,
                status="queued",
                payload_json=json.dumps(payload),
                created_at=utc_now(),
            )
            with Session(self.engine) as session:
                session.add(new_job)
                session.commit()
                session.refresh(new_job)

            # 4. Enqueue job ID for worker consumption
            try:
                self.queue.put_nowait(new_job.id)
            except queue.Full:
                # Should not happen due to prior check under lock, but guard against race
                with Session(self.engine) as session:
                    failed_job = session.get(Job, new_job.id)
                    if failed_job:
                        session.delete(failed_job)
                        session.commit()
                raise AppException(
                    code="QUEUE_FULL",
                    message="Job queue is full. Please retry after current operations complete.",
                    status_code=429,
                    retryable=True,
                    details={"max_waiting": self.max_waiting},
                )

            return new_job, True

    def get_job(self, job_id: str) -> Optional[Job]:
        """Fetch a job by ID using a dedicated short-lived session."""
        with Session(self.engine) as session:
            return session.get(Job, job_id)

    def _worker_loop(self) -> None:
        """Worker loop processing jobs sequentially off the queue."""
        while not self._stop_event.is_set():
            try:
                job_id = self.queue.get(timeout=0.2)
            except queue.Empty:
                continue

            try:
                self._execute_job(job_id)
            except Exception as e:
                logger.exception(f"Unhandled exception in worker loop processing {job_id}: {e}")
            finally:
                self.queue.task_done()

    def _execute_job(self, job_id: str) -> None:
        """Execute a single job with progress updates and failure resilience."""
        # Step 1: Claim job and update status to running
        kind = None
        payload = {}
        with Session(self.engine) as session:
            job = session.get(Job, job_id)
            if not job:
                logger.error(f"Job {job_id} queued but missing from database.")
                return

            if job.status != "queued":
                logger.warning(f"Job {job_id} already in status {job.status}; skipping.")
                return

            job.status = "running"
            job.started_at = utc_now()
            session.add(job)
            session.commit()
            kind = job.kind
            try:
                payload = json.loads(job.payload_json)
            except Exception:
                payload = {}

        # Progress callback for the handler to report intermediate progress
        def update_progress(stage: Optional[str] = None, progress: Optional[float] = None) -> None:
            with Session(self.engine) as prog_session:
                current_job = prog_session.get(Job, job_id)
                if current_job and current_job.status == "running":
                    if stage is not None:
                        current_job.stage = stage
                    if progress is not None:
                        current_job.progress = max(0.0, min(1.0, float(progress)))
                    prog_session.add(current_job)
                    prog_session.commit()

        # Step 2: Resolve handler and execute
        handler = self._handlers.get(kind)
        if not handler:
            with Session(self.engine) as session:
                job = session.get(Job, job_id)
                if job:
                    job.status = "failed"
                    job.error_code = "NO_HANDLER"
                    job.error_message = f"No handler registered for job kind '{kind}'."
                    job.finished_at = utc_now()
                    session.add(job)
                    session.commit()
            return

        try:
            import inspect
            sig = inspect.signature(handler)
            if "engine" in sig.parameters:
                result = handler(job_id, payload, update_progress, engine=self.engine)
            else:
                result = handler(job_id, payload, update_progress)
            # Step 3: Success commit
            with Session(self.engine) as session:
                job = session.get(Job, job_id)
                if job:
                    job.status = "succeeded"
                    job.stage = "done"
                    job.progress = 1.0
                    job.result_json = json.dumps(result)
                    job.error_code = None
                    job.error_message = None
                    job.finished_at = utc_now()
                    session.add(job)
                    session.commit()
        except AppException as app_err:
            with Session(self.engine) as session:
                job = session.get(Job, job_id)
                if job:
                    job.status = "failed"
                    job.error_code = app_err.code
                    job.error_message = app_err.message
                    job.finished_at = utc_now()
                    session.add(job)
                    session.commit()
        except Exception as exc:
            logger.exception(f"Job {job_id} failed with unhandled exception: {exc}")
            with Session(self.engine) as session:
                job = session.get(Job, job_id)
                if job:
                    job.status = "failed"
                    job.error_code = "EXECUTION_ERROR"
                    job.error_message = str(exc)
                    job.finished_at = utc_now()
                    session.add(job)
                    session.commit()

# Global default instance
job_runner = JobRunner()
