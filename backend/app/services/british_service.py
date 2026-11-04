import asyncio
import hashlib
import json
import logging
import re
import urllib.parse
import uuid
import unicodedata
from pathlib import Path
from typing import Optional, Tuple

import httpx
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

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


async def fetch_free_dictionary(word: str) -> Optional[dict]:
    """Attempt lookup via Free Dictionary API."""
    url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{urllib.parse.quote(word)}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, list) and len(data) > 0:
                    return data[0]
    except Exception as e:
        logger.debug(f"Free Dictionary API query failed for '{word}': {e}")
    return None


async def fetch_datamuse(word: str) -> Optional[dict]:
    """Fallback lookup via Datamuse API (fast, resilient, no key required)."""
    url = f"https://api.datamuse.com/words?sp={urllib.parse.quote(word)}&md=drp"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(url)
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, list) and len(data) > 0:
                    for item in data:
                        if item.get("word", "").lower() == word.lower():
                            return item
                    return data[0]
    except Exception as e:
        logger.debug(f"Datamuse query failed for '{word}': {e}")
    return None


async def lookup_word(
    word: str,
    session: Session,
) -> DictionaryEntryDTO:
    """
    Look up British IPA, part of speech, English definition, and example.
    Checks SQLite DictionaryCache first. Fallbacks to FreeDict then Datamuse.
    """
    normalized_word = unicodedata.normalize("NFC", word).strip().lower().replace("’", "'")
    if not normalized_word:
        return DictionaryEntryDTO(
            word="",
            audio_url="",
            cached=False,
        )

    # 1. Check local SQLite cache (0 ms)
    cached = session.exec(
        select(DictionaryCache).where(DictionaryCache.word == normalized_word)
    ).first()

    if cached:
        return DictionaryEntryDTO(
            word=cached.word,
            **resolve_pronunciation(normalized_word),
            part_of_speech=cached.part_of_speech,
            definition_en=cached.definition_en,
            definition_es=cached.definition_es,
            example_en=cached.example_en,
            audio_url=f"/api/british/audio?text={urllib.parse.quote(cached.word)}",
            cached=True,
        )

    # 2. Try Free Dictionary API
    phonetic_uk = None
    part_of_speech = None
    definition_en = None
    example_en = None

    free_dict_data = await fetch_free_dictionary(normalized_word)
    if free_dict_data:
        meanings = free_dict_data.get("meanings", [])
        if meanings:
            m = meanings[0]
            part_of_speech = m.get("partOfSpeech")
            defs = m.get("definitions", [])
            if defs:
                definition_en = defs[0].get("definition")
                example_en = defs[0].get("example")

    # 3. If Free Dictionary didn't provide definitions or phonetics, try Datamuse fallback
    if not definition_en:
        dm_data = await fetch_datamuse(normalized_word)
        if dm_data:
            # Datamuse tags can give POS and pronunciation
            tags = dm_data.get("tags", [])
            for t in tags:
                if t in ("v", "verb") and not part_of_speech:
                    part_of_speech = "verb"
                elif t in ("n", "noun") and not part_of_speech:
                    part_of_speech = "noun"
                elif t in ("adj", "adjective") and not part_of_speech:
                    part_of_speech = "adjective"
                elif t in ("adv", "adverb") and not part_of_speech:
                    part_of_speech = "adverb"

            defs = dm_data.get("defs", [])
            if defs and not definition_en:
                first_def = defs[0]
                # Defs are formatted like: "v\tTo form a mental image..."
                if "\t" in first_def:
                    pos_letter, def_text = first_def.split("\t", 1)
                    if not part_of_speech:
                        part_of_speech = {
                            "n": "noun",
                            "v": "verb",
                            "adj": "adjective",
                            "adv": "adverb",
                        }.get(pos_letter, pos_letter)
                    definition_en = def_text.strip()
                else:
                    definition_en = first_def.strip()

    # Definitions and pronunciation have independent provenance.
    phonetic_uk = format_ipa(normalized_word)

    # Save to SQLite DictionaryCache
    new_entry = DictionaryCache(
        word=normalized_word,
        phonetic_uk=phonetic_uk,
        part_of_speech=part_of_speech,
        definition_en=definition_en,
        definition_es=None,
        example_en=example_en,
        audio_relative_path=f"tts_uk/{sanitize_filename(normalized_word)}.mp3",
    )
    session.add(new_entry)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        # Another request may have populated this word while network lookup ran.
        if session.get(DictionaryCache, normalized_word) is None:
            raise
        return await lookup_word(normalized_word, session)
    session.refresh(new_entry)

    return DictionaryEntryDTO(
        word=new_entry.word,
        **resolve_pronunciation(normalized_word),
        part_of_speech=new_entry.part_of_speech,
        definition_en=new_entry.definition_en,
        definition_es=new_entry.definition_es,
        example_en=new_entry.example_en,
        audio_url=f"/api/british/audio?text={urllib.parse.quote(new_entry.word)}",
        cached=False,
    )
