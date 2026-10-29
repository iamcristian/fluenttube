import json
import re
from fastapi import APIRouter
from backend.app.errors import AppException
from backend.app.schemas import JobDTO, JobErrorDTO
from backend.app.services.jobs import job_runner
from backend.app.services.youtube_access import youtube_import_wait
from sqlmodel import Session, select, or_, and_
from backend.app.models import Job

router = APIRouter(prefix="/jobs", tags=["jobs"])

@router.get("/{job_id}", response_model=JobDTO)
def get_job_by_id(job_id: str) -> JobDTO:
    """Retrieve job details by UUID."""
    job = job_runner.get_job(job_id)
    if not job:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Job with ID '{job_id}' was not found.",
            status_code=404,
            retryable=False,
            details={"job_id": job_id},
        )

    result_data = None
    if job.result_json:
        try:
            result_data = json.loads(job.result_json)
        except Exception:
            result_data = None

    error_data = None
    if job.error_code:
        # Only include the public video link, never the full job payload or session paths.
        details = {}
        if job.kind == "local_ingest":
            try:
                from backend.app.services.local_video import local_media_path
                local_media_path(json.loads(job.payload_json)["file_relative_path"])
                details["can_resume"] = True
            except (AppException, ValueError, TypeError, KeyError):
                details["can_resume"] = False
        if job.kind == "ingest":
            try:
                youtube_id = json.loads(job.payload_json).get("youtube_id", "")
                if isinstance(youtube_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", youtube_id):
                    details = {"youtube_id": youtube_id, "video_url": f"https://www.youtube.com/watch?v={youtube_id}"}
            except (ValueError, TypeError, AttributeError):
                pass
            with Session(job_runner.engine) as session:
                details["retry_after_seconds"] = youtube_import_wait(session)
        error_data = JobErrorDTO(
            code=job.error_code,
            message=job.error_message or "Job execution failed.",
            retryable=job.error_code in ("YOUTUBE_BLOCKED", "RATE_LIMITED", "YOUTUBE_CONNECTION_FAILED", "AUDIO_DOWNLOAD_FAILED", "JOB_INTERRUPTED"),
            details=details,
        )

    return JobDTO(
        id=job.id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        result=result_data,
        error=error_data,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.post("/{job_id}/resume", response_model=JobDTO)
def resume_local_import(job_id: str) -> JobDTO:
    job_runner.resume_local_job(job_id)
    return get_job_by_id(job_id)


@router.get("/recoverable/local", response_model=list[JobDTO])
def get_recoverable_local_imports() -> list[JobDTO]:
    with Session(job_runner.engine) as session:
        jobs = session.exec(select(Job).where(Job.kind == "local_ingest", or_(
            Job.status.in_(["queued", "running"]),
            and_(Job.status == "failed", Job.error_code == "JOB_INTERRUPTED"),
        )).order_by(Job.created_at.desc()).limit(8)).all()
    return [get_job_by_id(job.id) for job in jobs]
