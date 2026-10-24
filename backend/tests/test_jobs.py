import threading
import time
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from backend.app.database import get_engine, init_db
from backend.app.errors import AppException
from backend.app.main import app
from backend.app.models import Job
from backend.app.schemas import JobDTO
from backend.app.services.jobs import JobRunner, compute_payload_hash

@pytest.fixture
def test_runner(tmp_path):
    """Fixture providing an isolated JobRunner with its own temporary database."""
    db_file = tmp_path / "test_jobs.db"
    engine = get_engine(f"sqlite:///{db_file}")
    init_db(engine)

    runner = JobRunner(max_waiting=3, engine_override=engine)
    runner.start()
    yield runner
    runner.stop(timeout=2.0)

def test_fifo_execution_order(test_runner):
    """Verify two synthetic jobs execute strictly in FIFO sequence."""
    order_log = []
    job1_entered = threading.Event()
    job1_can_finish = threading.Event()

    def handler_1(job_id, payload, update_progress):
        order_log.append("j1_start")
        job1_entered.set()
        job1_can_finish.wait(timeout=3.0)
        order_log.append("j1_done")
        return {"step": 1}

    def handler_2(job_id, payload, update_progress):
        order_log.append("j2_start")
        order_log.append("j2_done")
        return {"step": 2}

    test_runner.register_handler("kind_1", handler_1)
    test_runner.register_handler("kind_2", handler_2)

    j1, _ = test_runner.enqueue_job("kind_1", "client-req-j1", {"data": 1})
    j2, _ = test_runner.enqueue_job("kind_2", "client-req-j2", {"data": 2})

    # Wait for J1 to start running
    assert job1_entered.wait(timeout=2.0)
    # Release J1 so it can complete, allowing J2 to be picked up
    job1_can_finish.set()

    # Wait for J2 to complete
    for _ in range(30):
        job2 = test_runner.get_job(j2.id)
        if job2 and job2.status == "succeeded":
            break
        time.sleep(0.05)

    assert order_log == ["j1_start", "j1_done", "j2_start", "j2_done"]
    job1_final = test_runner.get_job(j1.id)
    job2_final = test_runner.get_job(j2.id)
    assert job1_final.status == "succeeded"
    assert job2_final.status == "succeeded"

def test_idempotent_enqueue_identical_payload(test_runner):
    """Same client_request_id with identical payload returns existing Job without duplicating."""
    payload = {"query": "sample video", "count": 10}
    j1, created1 = test_runner.enqueue_job("synthetic", "req-idem-1", payload)
    assert created1 is True

    j2, created2 = test_runner.enqueue_job("synthetic", "req-idem-1", payload)
    assert created2 is False
    assert j1.id == j2.id

    # Verify only one row exists in database
    with Session(test_runner.engine) as session:
        jobs = session.exec(select(Job).where(Job.client_request_id == "req-idem-1")).all()
        assert len(jobs) == 1

def test_idempotency_conflict_different_payload(test_runner):
    """Same client_request_id with conflicting payload raises 409 IDEMPOTENCY_CONFLICT."""
    test_runner.enqueue_job("synthetic", "req-conflict-1", {"version": 1})

    with pytest.raises(AppException) as exc_info:
        test_runner.enqueue_job("synthetic", "req-conflict-1", {"version": 2})

    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "IDEMPOTENCY_CONFLICT"

def test_queue_full_returns_429(tmp_path):
    """When the queue reaches max_waiting capacity, enqueue raises 429 without orphaned records."""
    db_file = tmp_path / "test_queue_full.db"
    engine = get_engine(f"sqlite:///{db_file}")
    init_db(engine)

    # Queue capacity = 1 waiting job
    runner = JobRunner(max_waiting=1, engine_override=engine)
    worker_blocked = threading.Event()

    def blocking_handler(job_id, payload, update_progress):
        worker_blocked.wait(timeout=3.0)
        return {"done": True}

    runner.register_handler("blocking", blocking_handler)
    runner.start()

    try:
        # Job 1 is claimed and running
        j1, _ = runner.enqueue_job("blocking", "req-cap-1", {"num": 1})
        time.sleep(0.1)

        # Job 2 enters waiting queue (size 1)
        j2, _ = runner.enqueue_job("blocking", "req-cap-2", {"num": 2})

        # Job 3 should be rejected because queue is at capacity
        with pytest.raises(AppException) as exc_info:
            runner.enqueue_job("blocking", "req-cap-3", {"num": 3})

        assert exc_info.value.status_code == 429
        assert exc_info.value.code == "QUEUE_FULL"

        # Verify Job 3 was not persisted in database
        with Session(engine) as session:
            job3 = session.exec(select(Job).where(Job.client_request_id == "req-cap-3")).first()
            assert job3 is None
    finally:
        worker_blocked.set()
        runner.stop(timeout=2.0)

def test_unhandled_job_exception_does_not_kill_worker(test_runner):
    """An unhandled exception marks the job failed but leaves worker alive for subsequent jobs."""
    job2_done = threading.Event()

    def failing_handler(job_id, payload, update_progress):
        raise RuntimeError("Simulated crash in job handler")

    def success_handler(job_id, payload, update_progress):
        job2_done.set()
        return {"recovered": True}

    test_runner.register_handler("failing", failing_handler)
    test_runner.register_handler("success", success_handler)

    j_fail, _ = test_runner.enqueue_job("failing", "req-fail-1", {})
    j_succ, _ = test_runner.enqueue_job("success", "req-succ-1", {})

    assert job2_done.wait(timeout=3.0)

    failed_job = test_runner.get_job(j_fail.id)
    assert failed_job.status == "failed"
    assert failed_job.error_code == "EXECUTION_ERROR"
    assert "Simulated crash" in failed_job.error_message
    assert failed_job.finished_at is not None

    # Wait for succ_job to transition from running to succeeded
    succ_job = None
    for _ in range(30):
        succ_job = test_runner.get_job(j_succ.id)
        if succ_job and succ_job.status == "succeeded":
            break
        time.sleep(0.05)

    assert succ_job is not None
    assert succ_job.status == "succeeded"

def test_startup_recovery_interrupted_jobs(tmp_path):
    """On reboot, prior queued or running jobs are marked failed with JOB_INTERRUPTED."""
    db_file = tmp_path / "test_recovery.db"
    engine = get_engine(f"sqlite:///{db_file}")
    init_db(engine)

    # Insert simulated interrupted jobs
    with Session(engine) as session:
        j_queued = Job(
            client_request_id="int-queued",
            request_hash="hash-q",
            kind="ingest",
            status="queued",
            payload_json="{}",
        )
        j_running = Job(
            client_request_id="int-running",
            request_hash="hash-r",
            kind="shadowing",
            status="running",
            payload_json="{}",
        )
        session.add_all([j_queued, j_running])
        session.commit()

    # Create new runner and start (triggers recovery)
    runner = JobRunner(engine_override=engine)
    runner.start()
    runner.stop(timeout=1.0)

    with Session(engine) as session:
        recovered_q = session.exec(select(Job).where(Job.client_request_id == "int-queued")).one()
        recovered_r = session.exec(select(Job).where(Job.client_request_id == "int-running")).one()

        assert recovered_q.status == "failed"
        assert recovered_q.error_code == "JOB_INTERRUPTED"
        assert recovered_q.finished_at is not None

        assert recovered_r.status == "failed"
        assert recovered_r.error_code == "JOB_INTERRUPTED"
        assert recovered_r.finished_at is not None

def test_get_job_api_endpoint():
    """Verify GET /api/jobs/{id} returns clean JobDTO without internal fields."""
    with TestClient(app) as client:
        # Non-existent job
        res_404 = client.get("/api/jobs/00000000-0000-0000-0000-000000000000")
        assert res_404.status_code == 404
        assert res_404.json()["error"]["code"] == "RESOURCE_NOT_FOUND"

def test_health_check_responsive_during_job_execution(test_runner):
    """Health check remains responsive while worker is executing a long-running job."""
    job_blocking = threading.Event()
    job_started = threading.Event()

    def long_handler(job_id, payload, update_progress):
        job_started.set()
        job_blocking.wait(timeout=3.0)
        return {"status": "finished"}

    test_runner.register_handler("long_task", long_handler)
    test_runner.enqueue_job("long_task", "req-long-1", {})

    assert job_started.wait(timeout=2.0)

    try:
        with TestClient(app) as client:
            # Health check must respond immediately (not blocked by long running inference/task)
            start_time = time.monotonic()
            response = client.get("/api/health")
            elapsed = time.monotonic() - start_time

            assert response.status_code == 200
            assert elapsed < 1.0  # Responsive in sub-second time
            assert response.json()["status"] == "ok"
    finally:
        job_blocking.set()
