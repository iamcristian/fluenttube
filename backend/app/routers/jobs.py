import json
from fastapi import APIRouter
from backend.app.errors import AppException
from backend.app.schemas import JobDTO, JobErrorDTO
from backend.app.services.jobs import job_runner

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
        error_data = JobErrorDTO(
            code=job.error_code,
            message=job.error_message or "Job execution failed.",
            retryable=job.error_code in ("YOUTUBE_BLOCKED", "RATE_LIMITED", "JOB_INTERRUPTED"),
            details={},
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
