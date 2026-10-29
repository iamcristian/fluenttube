"""
backend/app/routers/vocabulary.py

Router for Contextual Vocabulary Dictionary endpoints (Section 6 & F-05).
Provides:
- POST /api/vocabulary/explain: Local/Ollama or cloud contextual dictionary explanation.
"""

import logging
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import Segment
from backend.app.schemas import (
    VocabularyExplainRequestDTO,
    VocabularyExplainResponseDTO,
)
from backend.app.services.llm_tutor import tutor_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vocabulary"])


@router.post(
    "/vocabulary/explain",
    response_model=VocabularyExplainResponseDTO,
    summary="Get contextual vocabulary explanation for a term in a segment",
)
async def explain_vocabulary_term(
    req: VocabularyExplainRequestDTO,
    session: Session = Depends(get_session),
) -> VocabularyExplainResponseDTO:
    """
    Returns structured explanation of a word, phrasal verb, or idiom in segment context.
    Cached first in SQLite VocabularyCache; generates via local LLM (Ollama) or configured provider.
    """
    clean_term = req.term.strip()
    if not clean_term:
        raise AppException(
            code="VALIDATION_ERROR",
            message="Term must not be empty.",
            status_code=422,
        )

    # 1. Fetch target segment from database
    segment = session.exec(select(Segment).where(Segment.id == req.segment_id)).first()
    if not segment:
        raise AppException(
            code="RESOURCE_NOT_FOUND",
            message=f"Segment with id {req.segment_id} does not exist.",
            status_code=404,
        )

    # 2. Server-side validation of selection bounds if provided
    if req.selection_start is not None and req.selection_end is not None:
        if 0 <= req.selection_start < req.selection_end <= len(segment.text):
            sliced = segment.text[req.selection_start : req.selection_end]
            if sliced.strip().lower() == clean_term.lower():
                clean_term = sliced.strip()

    # 3. Delegate to tutor service with cache-first lookup
    explanation = await tutor_service.explain_vocabulary(
        segment=segment,
        term=clean_term,
        session=session,
        language=req.explanation_language or "es",
    )
    return explanation
