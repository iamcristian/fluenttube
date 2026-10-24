"""
backend/app/routers/tutor.py

Router for Contextual Grammar Tutor endpoints (Section 5.3 & Section 11, Task T20).
Provides:
- POST /api/tutor/explain: canonical structured explanation and cache metadata.
"""

import logging
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import Segment
from backend.app.schemas import (
    TutorExplainRequestDTO,
    TutorExplanationDTO,
)
from backend.app.services.llm_tutor import tutor_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tutor"])


@router.post(
    "/tutor/explain",
    response_model=TutorExplanationDTO,
    summary="Get contextual grammar tutor explanation for a segment",
)
async def explain_segment(
    req: TutorExplainRequestDTO,
    session: Session = Depends(get_session),
) -> TutorExplanationDTO:
    """
    Returns structured B2 pedagogical analysis of the target sentence.
    Requires the segment to be completed or revealed (status 409 if locked).
    Returns 503 if tutor is unconfigured/disabled.
    Returns 429 if provider quota is exceeded.
    """
    # 1. Fetch target segment from database
    segment = session.exec(select(Segment).where(Segment.id == req.segment_id)).first()
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment with id {req.segment_id} does not exist.",
            status_code=404,
        )

    # 2. Invariant: Sentence must be completed or revealed before tutor can explain (Section 5.3, 11)
    if not (segment.completed_at is not None or segment.revealed_at is not None):
        raise AppException(
            code="SEGMENT_LOCKED",
            message="Segment must be completed or revealed before requesting tutor explanation.",
            status_code=409,
        )

    # 3. Delegate to tutor service
    explanation = await tutor_service.get_explanation(
        segment=segment,
        session=session,
        language=req.language or "es",
    )
    return explanation
