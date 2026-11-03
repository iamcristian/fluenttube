import json
from fastapi import APIRouter
from backend.app.errors import AppException
from backend.app.schemas import JobDTO, JobErrorDTO
from backend.app.services.jobs import job_runner
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
        # Expose only whether the saved local file can be resumed.
        details = {}
        if job.kind == "local_ingest":
            try:
                from backend.app.services.local_video import local_media_path
                local_media_path(json.loads(job.payload_json)["file_relative_path"])
                details["can_resume"] = True
            except (AppException, ValueError, TypeError, KeyError):
                details["can_resume"] = False
        error_data = JobErrorDTO(
            code=job.error_code,
            message=job.error_message or "Job execution failed.",
            retryable=job.error_code in ("JOB_INTERRUPTED",),
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
