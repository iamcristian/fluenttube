import hashlib
import json
import logging
import uuid
import math
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from sqlmodel import Session, col, func, select
from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import Job, Segment, ShadowingAttempt, LocalVideoMedia
from backend.app.schemas import (
    ShadowingAttemptDTO,
    ShadowingAttemptListDTO,
    ShadowingEvaluateResponseDTO,
)
from backend.app.services.audio_service import (
    convert_to_pcm16k_mono,
    ensure_temp_dir,
    safe_cleanup,
    stream_and_validate_upload,
)
from backend.app.services.jobs import job_runner

logger = logging.getLogger(__name__)

router = APIRouter(tags=["shadowing"])


@router.get("/segments/{segment_id}/reference-audio")
async def reference_audio(segment_id: int, session: Session = Depends(get_session)):
    from backend.app.services.local_video import local_media_path, extract_audio_chunk
    segment = session.get(Segment, segment_id)
    if segment is None:
        raise AppException(code="RESOURCE_NOT_FOUND", message="Sentence not found.", status_code=404)
    media = session.get(LocalVideoMedia, segment.video_id)
    if media is None:
        raise AppException(code="REFERENCE_UNAVAILABLE", message="Original audio requires an imported local video.", status_code=404)
    start, end = segment.start_seconds, segment.end_seconds
    if not math.isfinite(start) or not math.isfinite(end) or not 0 < end-start <= 30:
        raise AppException(code="INVALID_REFERENCE_INTERVAL", message="Choose a sentence of up to 30 seconds.", status_code=422)
    source = local_media_path(media.file_relative_path)
    output = ensure_temp_dir() / f"{uuid.uuid4()}-reference-playback.wav"
    try:
        await run_in_threadpool(extract_audio_chunk, source, output, start, end-start)
        return FileResponse(output, media_type="audio/wav", background=BackgroundTask(safe_cleanup, output))
    except Exception:
        safe_cleanup(output)
        raise

@router.post(
    "/shadowing/evaluate",
    response_model=ShadowingEvaluateResponseDTO,
    status_code=202,
    summary="Upload audio recording and enqueue shadowing evaluation job",
)
async def evaluate_shadowing(
    audio_file: UploadFile = File(...),
    segment_id: int = Form(...),
    client_request_id: Optional[str] = Form(None),
    evaluation_version: str = Form("1", pattern="^[12]$"),
    session: Session = Depends(get_session),
):
    """
    Validates uploaded audio, checks that the target segment is unlocked,
    transcodes audio to 16 kHz mono WAV, and enqueues a background evaluation job.
    """
    client_req_id = client_request_id or str(uuid.uuid4())

    # 1. Verify target segment exists in DB
    segment = session.exec(select(Segment).where(Segment.id == segment_id)).first()
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment with id {segment_id} does not exist.",
            status_code=404,
        )

    # 2. Invariant: Sentence must be completed or revealed before shadowing can be evaluated
    is_completed = segment.completed_at is not None
    is_revealed = segment.revealed_at is not None
    if not (is_completed or is_revealed):
        raise AppException(
            code="SHADOWING_LOCKED",
            message="Sentence must be completed or revealed before shadowing practice can be evaluated.",
            status_code=409,
            details={"segment_id": segment_id},
        )

    # 4. Stream upload and transcode to 16 kHz mono WAV
    job_uuid = str(uuid.uuid4())
    temp_dir = ensure_temp_dir()
    wav_path = temp_dir / f"{job_uuid}.wav"
    raw_path = None

    try:
        raw_path = await stream_and_validate_upload(audio_file, job_uuid)
        def audio_hash():
            digest = hashlib.sha256()
            with raw_path.open("rb") as source:
                for chunk in iter(lambda: source.read(65536), b""):
                    digest.update(chunk)
            return digest.hexdigest()
        identity = {"segment_id": segment_id, "audio_sha256": await run_in_threadpool(audio_hash),
                    "evaluation_version": evaluation_version}
        existing = session.exec(select(Job).where(Job.client_request_id == client_req_id)).first()
        if existing:
            from backend.app.services.jobs import compute_payload_hash
            expected = compute_payload_hash({"kind": "shadowing", "identity": identity})
            if existing.kind != "shadowing" or existing.request_hash != expected:
                raise AppException(code="IDEMPOTENCY_CONFLICT", message="Request ID belongs to different audio, segment or evaluation version.", status_code=409)
            if existing.status != "failed":
                return JSONResponse(status_code=200 if existing.status == "succeeded" else 202,
                                    content={"job_id": existing.id, "status": existing.status})
        duration = await run_in_threadpool(convert_to_pcm16k_mono, raw_path, wav_path)
    except Exception:
        safe_cleanup(raw_path, wav_path)
        raise
    finally:
        # Raw upload is always discarded once transcoded into standard 16 kHz WAV
        if raw_path:
            safe_cleanup(raw_path)

    # 5. Enqueue background shadowing job
    try:
        payload = {
            "segment_id": segment_id,
            "wav_path": str(wav_path),
            "duration_seconds": duration,
            "evaluation_version": evaluation_version,
        }
        job, created = job_runner.enqueue_job(
            kind="shadowing",
            client_request_id=client_req_id,
            payload=payload,
            request_identity=identity,
            retry_failed=True,
        )
        if not created:
            safe_cleanup(wav_path)
        status_code = 200 if job.status in ("succeeded", "failed") else 202
        return JSONResponse(
            status_code=status_code,
            content={"job_id": job.id, "status": job.status},
        )
    except Exception:
        safe_cleanup(wav_path)
        raise

@router.get(
    "/segments/{id}/shadowing-attempts",
    response_model=ShadowingAttemptListDTO,
    summary="List shadowing attempts for a segment",
)
def list_shadowing_attempts(
    id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    """
    Return paginated shadowing practice attempts for a segment,
    ordered by created_at DESC, id DESC.
    """
    segment = session.exec(select(Segment).where(Segment.id == id)).first()
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment with id {id} does not exist.",
            status_code=404,
        )

    total = session.exec(
        select(func.count(ShadowingAttempt.id)).where(ShadowingAttempt.segment_id == id)
    ).one()

    attempts = session.exec(
        select(ShadowingAttempt)
        .where(ShadowingAttempt.segment_id == id)
        .order_by(col(ShadowingAttempt.created_at).desc(), col(ShadowingAttempt.id).desc())
        .offset(offset)
        .limit(limit)
    ).all()

    items = []
    for att in attempts:
        alignment = []
        warning_codes = []
        try:
            if att.alignment_json:
                alignment = json.loads(att.alignment_json)
        except Exception:
            pass
        try:
            if att.warning_codes_json:
                warning_codes = json.loads(att.warning_codes_json)
        except Exception:
            pass

        items.append(
            ShadowingAttemptDTO(
                evaluation_version=att.evaluation_version or "1",
                prosody=json.loads(att.prosody_json) if att.prosody_json else None,
                id=att.id,
                segment_id=att.segment_id,
                job_id=att.job_id,
                status=att.status,
                recognized_text=att.recognized_text,
                word_match_score=att.word_match_score,
                timing_similarity_score=att.timing_similarity_score,
                overall_score=att.overall_score,
                alignment=alignment,
                warning_codes=warning_codes,
                created_at=att.created_at,
            )
        )

    return ShadowingAttemptListDTO(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )
