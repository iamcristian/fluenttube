from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Session

from backend.app.database import get_session
from backend.app.schemas import DictionaryEntryDTO
from backend.app.services.british_service import get_or_create_british_audio, lookup_word

router = APIRouter(prefix="/api/british", tags=["british"])


@router.get("/audio")
async def get_british_audio(
    text: str = Query(..., min_length=1, max_length=200, description="Word or phrase to speak in British English"),
):
    """
    Returns studio-grade British neural audio (en-GB-RyanNeural) for any word or sentence.
    Zero tokens, zero VRAM, cached locally as MP3.
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
