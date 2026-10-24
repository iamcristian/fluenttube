import json
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse
from sqlmodel import Session, col, func, select
from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import Job, Segment, ShadowingAttempt
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

    # 3. Idempotency check: if job with identical client_request_id already exists, return it
    existing_job = session.exec(
        select(Job).where(Job.client_request_id == client_req_id)
    ).first()
    if existing_job:
        status_code = 200 if existing_job.status in ("succeeded", "failed") else 202
        return JSONResponse(
            status_code=status_code,
            content={"job_id": existing_job.id, "status": existing_job.status},
        )

    # 4. Stream upload and transcode to 16 kHz mono WAV
    job_uuid = str(uuid.uuid4())
    temp_dir = ensure_temp_dir()
    wav_path = temp_dir / f"{job_uuid}.wav"
    raw_path = None

    try:
        raw_path = await stream_and_validate_upload(audio_file, job_uuid)
        duration = convert_to_pcm16k_mono(raw_path, wav_path)
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
        }
        job, is_existing = job_runner.enqueue_job(
            kind="shadowing",
            client_request_id=client_req_id,
            payload=payload,
        )
        status_code = 200 if (is_existing and job.status in ("succeeded", "failed")) else 202
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
