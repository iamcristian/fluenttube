import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Response, status
from sqlmodel import Session, select

try:
    from backend.app.database import get_session
    from backend.app.errors import AppException
    from backend.app.models import DictationAttempt, PracticeSession, Segment
    from backend.app.schemas import (
        AlignmentOpDTO,
        CheckRequestDTO,
        DictationResultDTO,
        HintRequestDTO,
        HintResponseDTO,
        RevealResponseDTO,
        SessionCreateDTO,
        SessionResponseDTO,
    )
    from backend.app.services.aligner import align, normalize_text
except ImportError:
    from app.database import get_session
    from app.errors import AppException
    from app.models import DictationAttempt, PracticeSession, Segment
    from app.schemas import (
        AlignmentOpDTO,
        CheckRequestDTO,
        DictationResultDTO,
        HintRequestDTO,
        HintResponseDTO,
        RevealResponseDTO,
        SessionCreateDTO,
        SessionResponseDTO,
    )
    from app.services.aligner import align, normalize_text


router = APIRouter(tags=["dictation"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_session_response(session_obj: PracticeSession) -> SessionResponseDTO:
    try:
        hinted = json.loads(session_obj.hinted_display_indices_json or "[]")
    except Exception:
        hinted = []

    last_res = None
    if session_obj.last_result_json:
        try:
            last_res = json.loads(session_obj.last_result_json)
        except Exception:
            last_res = None

    return SessionResponseDTO(
        id=session_obj.id,
        segment_id=session_obj.segment_id,
        hinted_display_indices=hinted,
        answer_revealed=session_obj.answer_revealed,
        last_input=session_obj.last_input,
        last_result=last_res,
        created_at=session_obj.created_at,
    )


@router.post(
    "/segments/{id}/sessions",
    response_model=SessionResponseDTO,
)
def create_practice_session(
    id: int,
    payload: SessionCreateDTO,
    response: Response,
    db: Session = Depends(get_session),
) -> SessionResponseDTO:
    # 1. Verify segment exists
    segment = db.get(Segment, id)
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    client_req_id = payload.client_request_id or str(uuid.uuid4())
    req_hash = hashlib.sha256(f"session:{id}:{client_req_id}".encode()).hexdigest()

    # 2. Check idempotency: does a session with this client_request_id exist?
    existing = db.exec(
        select(PracticeSession).where(PracticeSession.client_request_id == client_req_id)
    ).first()

    if existing:
        if existing.segment_id == id:
            response.status_code = status.HTTP_200_OK
            return _format_session_response(existing)
        else:
            raise AppException(
                code="IDEMPOTENCY_CONFLICT",
                message="Client request ID already used for a different segment.",
                status_code=status.HTTP_409_CONFLICT,
                retryable=False,
            )

    # 3. Create fresh practice session
    new_session = PracticeSession(
        id=str(uuid.uuid4()),
        client_request_id=client_req_id,
        request_hash=req_hash,
        segment_id=id,
        hinted_display_indices_json="[]",
        answer_revealed=False,
        last_input="",
        last_result_json=None,
        created_at=utc_now(),
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    response.status_code = status.HTTP_201_CREATED
    return _format_session_response(new_session)


@router.get(
    "/sessions/{id}",
    response_model=SessionResponseDTO,
)
def get_practice_session(
    id: str,
    db: Session = Depends(get_session),
) -> SessionResponseDTO:
    session_obj = db.get(PracticeSession, id)
    if not session_obj:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Session {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )
    return _format_session_response(session_obj)


@router.post(
    "/sessions/{id}/hint",
    response_model=HintResponseDTO,
)
def get_hint(
    id: str,
    payload: HintRequestDTO,
    db: Session = Depends(get_session),
) -> HintResponseDTO:
    session_obj = db.get(PracticeSession, id)
    if not session_obj:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Session {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    segment = db.get(Segment, session_obj.segment_id)
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment {session_obj.segment_id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    target_norm = normalize_text(segment.text, is_input=False)
    num_display_tokens = len(target_norm.display_tokens)

    if payload.display_token_index < 0 or payload.display_token_index >= num_display_tokens:
        raise AppException(
            code="INVALID_INPUT",
            message=f"Display token index {payload.display_token_index} out of range (0-{num_display_tokens - 1}).",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            retryable=False,
        )

    target_display_token = target_norm.display_tokens[payload.display_token_index]
    hint_letter = target_display_token.text[0] if target_display_token.text else ""

    try:
        hinted_indices: List[int] = json.loads(session_obj.hinted_display_indices_json or "[]")
    except Exception:
        hinted_indices = []

    if payload.display_token_index not in hinted_indices:
        hinted_indices.append(payload.display_token_index)
        hinted_indices.sort()
        session_obj.hinted_display_indices_json = json.dumps(hinted_indices)
        db.add(session_obj)
        db.commit()
        db.refresh(session_obj)

    return HintResponseDTO(
        display_token_index=payload.display_token_index,
        hint_letter=hint_letter,
        hinted_display_indices=hinted_indices,
    )


@router.post(
    "/sessions/{id}/reveal",
    response_model=RevealResponseDTO,
)
def reveal_answer(
    id: str,
    db: Session = Depends(get_session),
) -> RevealResponseDTO:
    session_obj = db.get(PracticeSession, id)
    if not session_obj:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Session {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    segment = db.get(Segment, session_obj.segment_id)
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment {session_obj.segment_id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    prior_completed = segment.completed_at is not None

    session_obj.answer_revealed = True
    if segment.revealed_at is None:
        segment.revealed_at = utc_now()

    db.add(session_obj)
    db.add(segment)
    db.commit()

    return RevealResponseDTO(
        text=segment.text,
        shadowing_unlocked=True,
        completed=prior_completed,
    )


@router.post(
    "/sessions/{id}/check",
    response_model=DictationResultDTO,
)
def check_dictation(
    id: str,
    payload: CheckRequestDTO,
    db: Session = Depends(get_session),
) -> DictationResultDTO:
    # 1. Validate max input length
    if len(payload.input_text) > 2000:
        raise AppException(
            code="INVALID_INPUT",
            message="Input text exceeds maximum 2000 characters.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            retryable=False,
        )

    # 2. Get session & segment
    session_obj = db.get(PracticeSession, id)
    if not session_obj:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Session {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    segment = db.get(Segment, session_obj.segment_id)
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment {session_obj.segment_id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    # 3. Idempotency check on client_request_id
    client_req_id = payload.client_request_id or str(uuid.uuid4())
    req_hash = hashlib.sha256(f"check:{id}:{payload.input_text}".encode()).hexdigest()

    existing_attempt = db.exec(
        select(DictationAttempt).where(DictationAttempt.client_request_id == client_req_id)
    ).first()

    if existing_attempt:
        if existing_attempt.request_hash == req_hash:
            # Replay existing result
            if session_obj.last_result_json:
                try:
                    cached_dict = json.loads(session_obj.last_result_json)
                    return DictationResultDTO(**cached_dict)
                except Exception:
                    pass

            align_res = align(target_text=segment.text, input_text=existing_attempt.input_text)
            alignment_ops = [
                AlignmentOpDTO(
                    op=at.operation,
                    target_index=at.target_index,
                    input_index=at.input_index,
                    target=at.target_token,
                    input=at.input_token,
                )
                for at in align_res.aligned_tokens
            ]
            shadowing_unlocked = (
                (segment.completed_at is not None)
                or (segment.revealed_at is not None)
                or session_obj.answer_revealed
            )
            return DictationResultDTO(
                attempt_id=existing_attempt.id,
                is_exact=existing_attempt.is_exact,
                score=existing_attempt.score,
                distance=existing_attempt.distance,
                completed=segment.completed_at is not None,
                shadowing_unlocked=shadowing_unlocked,
                assisted=existing_attempt.assisted,
                alignment=alignment_ops,
                rules_version=existing_attempt.rules_version,
            )
        else:
            raise AppException(
                code="IDEMPOTENCY_CONFLICT",
                message="Client request ID already used with different input text.",
                status_code=status.HTTP_409_CONFLICT,
                retryable=False,
            )

    # 4. Authoritative alignment
    try:
        align_result = align(target_text=segment.text, input_text=payload.input_text)
    except ValueError as e:
        raise AppException(
            code="INVALID_SEGMENT",
            message=str(e),
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            retryable=False,
        )

    alignment_ops = [
        AlignmentOpDTO(
            op=at.operation,
            target_index=at.target_index,
            input_index=at.input_index,
            target=at.target_token,
            input=at.input_token,
        )
        for at in align_result.aligned_tokens
    ]

    # 5. Check hints and completion invariants
    try:
        hinted_indices = json.loads(session_obj.hinted_display_indices_json or "[]")
    except Exception:
        hinted_indices = []

    assisted = len(hinted_indices) > 0
    is_exact = align_result.is_exact

    # Segment completion policy (Invariants 4.3.4, 4.3.5, 4.3.7):
    # - Exact check in unrevealed session marks completed_at atomically.
    # - Exact check in revealed session does NOT mark completed_at (retains prior completed state).
    # - Inexact check never reverts a previously completed segment.
    if is_exact:
        if not session_obj.answer_revealed:
            if segment.completed_at is None:
                segment.completed_at = utc_now()
            completed = True
        else:
            completed = segment.completed_at is not None
    else:
        completed = segment.completed_at is not None

    shadowing_unlocked = (
        (segment.completed_at is not None)
        or (segment.revealed_at is not None)
        or session_obj.answer_revealed
    )

    # 6. Persist attempt and session updates atomically
    attempt = DictationAttempt(
        client_request_id=client_req_id,
        request_hash=req_hash,
        session_id=session_obj.id,
        segment_id=segment.id,
        input_text=payload.input_text,
        normalized_target_json=json.dumps(align_result.target_normalized.to_dict()),
        normalized_input_json=json.dumps(align_result.input_normalized.to_dict()),
        distance=align_result.distance,
        score=float(align_result.score),
        is_exact=is_exact,
        assisted=assisted,
        rules_version="normalization-v1",
        created_at=utc_now(),
    )
    db.add(attempt)
    db.flush()

    result_dto = DictationResultDTO(
        attempt_id=attempt.id,
        is_exact=is_exact,
        score=float(align_result.score),
        distance=align_result.distance,
        completed=completed,
        shadowing_unlocked=shadowing_unlocked,
        assisted=assisted,
        alignment=alignment_ops,
        rules_version="normalization-v1",
    )

    session_obj.last_input = payload.input_text
    session_obj.last_result_json = result_dto.model_dump_json()

    db.add(session_obj)
    db.add(segment)
    db.commit()

    return result_dto
