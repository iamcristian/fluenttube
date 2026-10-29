import uuid
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from sqlmodel import Session
from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import LocalVideoMedia
from backend.app.schemas import IngestResponseDTO
from backend.app.services.audio_service import safe_cleanup
from backend.app.services.jobs import job_runner
from backend.app.services.local_video import prepare_local_upload, local_media_path, local_playback_path

router = APIRouter(tags=["local videos"])


@router.post("/videos/upload", response_model=IngestResponseDTO, status_code=202)
async def upload_local_video(video_file: UploadFile = File(...)):
    payload = await prepare_local_upload(video_file, uuid.uuid4().hex)
    try:
        job, _ = await run_in_threadpool(job_runner.enqueue_job, "local_ingest", str(uuid.uuid4()), payload)
    except Exception:
        safe_cleanup(local_media_path(payload["file_relative_path"]))
        raise
    return IngestResponseDTO(job_id=job.id, status=job.status, cached=False)


@router.api_route("/videos/{video_id}/media", methods=["GET", "HEAD"])
def get_local_video(video_id: int, session: Session = Depends(get_session)):
    media = session.get(LocalVideoMedia, video_id)
    if not media:
        raise AppException(code="LOCAL_MEDIA_NOT_FOUND", message="No local video was found.", status_code=404)
    path = local_playback_path(local_media_path(media.file_relative_path))
    response = FileResponse(
        path,
        media_type="video/webm" if path.suffix.lower() == ".webm" else "video/mp4",
        filename=f"video-{video_id}{path.suffix}",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-cache"},
    )
    response.chunk_size = 1024 * 1024
    return response
