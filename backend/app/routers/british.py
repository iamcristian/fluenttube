from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Session

from backend.app.database import get_session
from backend.app.schemas import DictionaryEntryDTO, SentenceIpaDTO
from backend.app.services.british_service import get_or_create_british_audio, lookup_word

router = APIRouter(prefix="/api/british", tags=["british"])


@router.get("/audio")
async def get_british_audio(
    text: str = Query(..., min_length=1, max_length=200, description="Word or phrase to speak in British English"),
):
    """
    Optional online speech synthesis, cached locally. Availability depends on Edge TTS.
    """
    try:
        audio_path = await get_or_create_british_audio(text)
        return FileResponse(
            path=str(audio_path),
            media_type="audio/mpeg",
            filename=f"{audio_path.name}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate British audio: {str(e)}")


@router.get("/dictionary", response_model=DictionaryEntryDTO)
async def get_dictionary_entry(
    word: str = Query(..., min_length=1, max_length=100, description="Word to look up"),
    session: Session = Depends(get_session),
):
    """
    Returns British IPA, part of speech, English definition, and audio link.
    Persisted deterministically in SQLite DictionaryCache.
    """
    return await lookup_word(word, session)


@router.get('/sentence/{segment_id}', response_model=SentenceIpaDTO)
def get_sentence_ipa(segment_id: int, session: Session = Depends(get_session)):
    from backend.app.models import Segment
    from backend.app.errors import AppException
    from backend.app.services.aligner import normalize_text
    from backend.app.services.pronunciation_lexicon import resolve_pronunciation
    segment = session.get(Segment, segment_id)
    if not segment:
        raise AppException(code='RESOURCE_NOT_FOUND', message='Sentence not found.', status_code=404)
    if not (segment.completed_at or segment.revealed_at):
        raise AppException(code='SEGMENT_LOCKED', message='Complete or reveal the sentence first.', status_code=409)
    return {'segment_id': segment_id, 'words': [
        {'text': token.text, 'readings': resolve_pronunciation(token.text)['ipa_options']}
        for token in normalize_text(segment.text).display_tokens
    ]}
