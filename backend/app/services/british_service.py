import asyncio
import hashlib
import logging
import re
import urllib.parse
import uuid
import unicodedata
from pathlib import Path
from typing import Optional

from sqlmodel import Session

from backend.app.config import settings
from backend.app.models import DictionaryCache
from backend.app.schemas import DictionaryEntryDTO

logger = logging.getLogger(__name__)

TTS_CACHE_DIR = Path(settings.MEDIA_ROOT) / "tts_uk"
TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_BRITISH_VOICE = "en-GB-RyanNeural"  # Professional natural UK voice

from backend.app.services.pronunciation_lexicon import resolve_pronunciation


def format_ipa(word: str, raw_arpa: Optional[str] = None) -> Optional[str]:
    """Return a local GB reading only when it is unambiguous."""
    return resolve_pronunciation(word)["phonetic_uk"]


def sanitize_filename(text: str) -> str:
    """Generate a clean filesystem-safe name for caching synthesized audio."""
    slug = re.sub(r"[^\w\s-]", "", text.strip().lower())
    slug = re.sub(r"[\s]+", "_", slug)
    if len(slug) > 30 or not slug:
        slug = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return slug


async def get_or_create_british_audio(
    text: str,
    voice: str = DEFAULT_BRITISH_VOICE,
) -> Path:
    """
    Optional online Edge TTS with bounded wait and atomic local caching.
    """
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Audio synthesis text cannot be empty.")

    slug = hashlib.sha256((voice + "\0" + clean_text).encode("utf-8")).hexdigest()
    file_path = TTS_CACHE_DIR / f"{slug}.mp3"

    if file_path.exists() and file_path.stat().st_size > 0:
        return file_path

    temporary = file_path.with_name(file_path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        import edge_tts

        communicate = edge_tts.Communicate(clean_text, voice)
        await asyncio.wait_for(communicate.save(str(temporary)), timeout=20)
        if temporary.stat().st_size == 0:
            raise ValueError("Empty TTS response")
        temporary.replace(file_path)
        return file_path
    except Exception as e:
        logger.error(f"edge-tts synthesis failed for '{clean_text}': {e}")
        raise
    finally:
        temporary.unlink(missing_ok=True)


async def lookup_word(word: str, session: Session) -> DictionaryEntryDTO:
    """Resolve IPA and definitions offline, preserving any legacy cached definitions."""
    from backend.app.services.local_dictionary import lookup_meanings
    normalized_word = unicodedata.normalize('NFKC', word).strip().lower().replace('’', "'")
    cached = session.get(DictionaryCache, normalized_word) if normalized_word else None
    senses = lookup_meanings(normalized_word) if normalized_word else []
    first = senses[0] if senses else {}
    examples = [example for sense in senses for example in sense['examples']]
    return DictionaryEntryDTO(
        word=normalized_word,
        **resolve_pronunciation(normalized_word),
        part_of_speech=first.get('part_of_speech') or (cached.part_of_speech if cached else None),
        definition_en=first.get('meaning') or (cached.definition_en if cached else None),
        definition_es=cached.definition_es if cached else None,
        example_en=next(iter(examples), None) or (cached.example_en if cached else None),
        senses=senses,
        definition_source=('Local learner dictionary + Princeton WordNet 3.0' if any(sense['part_of_speech'] in ('preposition', 'article') for sense in senses) else 'Princeton WordNet 3.0 (local)') if senses else 'Legacy local cache' if cached and cached.definition_en else None,
        audio_url=f'/api/british/audio?text={urllib.parse.quote(normalized_word)}' if normalized_word else '',
        cached=bool(cached),
    )
