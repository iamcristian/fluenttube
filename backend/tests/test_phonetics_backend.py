import asyncio
import json
import sqlite3
import wave
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from sqlalchemy import inspect
from sqlmodel import Session, SQLModel, select

from backend.app.database import get_engine, init_db
from backend.app.errors import AppException
from backend.app.models import DictionaryCache, Job, Segment, Video
from backend.app.services import british_service
from backend.app.services.jobs import JobRunner
from backend.app.services.pronunciation_lexicon import resolve_pronunciation
from backend.app.services.prosody import analyze_audio, compare_audio
from backend.app.services.reference_audio import words_in_window


def test_legacy_dictionary_ipa_is_never_trusted(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'lexicon.db'}")
    init_db(engine)
    with Session(engine) as session:
        session.add(DictionaryCache(word="unknownword", phonetic_uk="/unknownword/", definition_en="Preserve me"))
        session.commit()
        result = asyncio.run(british_service.lookup_word("unknownword", session))
        assert result.phonetic_uk is None
        assert result.ipa_quality == "unavailable"
        assert result.definition_en == "Preserve me"
        assert result.cached


def test_local_dictionary_never_contacts_network(tmp_path, monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError('Dictionary lookup must stay offline')
    monkeypatch.setattr('httpx.AsyncClient', blocked)
    engine = get_engine(f"sqlite:///{tmp_path / 'offline.db'}")
    init_db(engine)
    with Session(engine) as session:
        for word in ('approach', 'simplistic'):
            session.add(DictionaryCache(word=word, phonetic_uk='/old/', definition_en='stale'))
        session.commit()
        for word in ('approach', 'simplistic'):
            result = asyncio.run(british_service.lookup_word(word, session))
            assert result.phonetic_uk and result.phonetic_uk != '/old/'
            assert result.ipa_quality == 'dictionary'
            assert result.definition_source == 'Princeton WordNet 3.0 (local)'
            assert result.senses and result.senses[0].part_of_speech
            assert result.example_en
            assert result.definition_en != 'stale'
            assert result.cached
        unknown = asyncio.run(british_service.lookup_word('zxqvunknownword', session))
        assert not unknown.ipa_options and not unknown.senses


def test_homograph_and_apostrophe():
    assert resolve_pronunciation("read")["phonetic_uk"] is None
    assert resolve_pronunciation("read")["ipa_options"] == ["/ɹˈiːd/", "/ɹˈɛd/"]
    assert resolve_pronunciation("can’t") == resolve_pronunciation("can't")
    assert british_service.format_ipa("zxqvunknownword", "AA1 B") is None


def test_migration_preserves_legacy_rows_and_backup(tmp_path):
    path = tmp_path / "legacy.db"
    engine = get_engine(f"sqlite:///{path}")
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        for table, columns in {"segment": ["reference_words_json", "reference_words_version"],
                               "shadowingattempt": ["evaluation_version", "prosody_json"]}.items():
            for column in columns:
                connection.exec_driver_sql(f"ALTER TABLE {table} DROP COLUMN {column}")
        connection.exec_driver_sql("INSERT INTO dictionary_cache (word, phonetic_uk, definition_en, created_at) VALUES ('old', '/old/', 'keep', '2026-01-01')")
    init_db(engine)
    init_db(engine)
    with Session(engine) as session:
        assert session.get(DictionaryCache, "old").definition_en == "keep"
    backups = list(tmp_path.glob("*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as connection:
        assert connection.execute("SELECT definition_en FROM dictionary_cache").fetchone()[0] == "keep"
        assert "reference_words_json" not in {r[1] for r in connection.execute("PRAGMA table_info(segment)")}
    # Restoring the backup to a separate path produces a usable legacy database.
    restored = tmp_path / "restored.db"
    with sqlite3.connect(backups[0]) as origin, sqlite3.connect(restored) as destination:
        origin.backup(destination)
    init_db(get_engine(f"sqlite:///{restored}"))


def test_unknown_schema_is_not_stamped(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'unknown.db'}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE segment (id INTEGER PRIMARY KEY)")
    with pytest.raises(RuntimeError, match="Unrecognized schema"):
        init_db(engine)
    assert "reference_words_json" not in {c["name"] for c in inspect(engine).get_columns("segment")}


def test_partial_migration_is_rolled_back(tmp_path, monkeypatch):
    from alembic.operations import Operations
    engine = get_engine(f"sqlite:///{tmp_path / 'rollback.db'}")
    with engine.begin() as connection:
        SQLModel.metadata.create_all(connection)
        for column in ("reference_words_json", "reference_words_version"):
            connection.exec_driver_sql(f"ALTER TABLE segment DROP COLUMN {column}")
    original = Operations.add_column
    def fail_second(self, table, column, **kwargs):
        if column.name == "reference_words_version":
            raise RuntimeError("injected failure")
        return original(self, table, column, **kwargs)
    monkeypatch.setattr(Operations, "add_column", fail_second)
    with pytest.raises(RuntimeError, match="injected failure"):
        init_db(engine)
    assert "reference_words_json" not in {c["name"] for c in inspect(engine).get_columns("segment")}


def test_import_preserves_word_times_across_chunks(tmp_path, monkeypatch):
    from backend.app.services import local_video
    path = tmp_path / "source.mp4"
    path.write_bytes(b"fixture")
    monkeypatch.setattr(local_video, "extract_audio_chunk", lambda *args: None)
    monkeypatch.setattr(local_video.whisper_engine, "load_model", lambda: None)
    monkeypatch.setattr(local_video.whisper_engine, "transcribe", lambda *args, **kwargs: {
        "text": "Hello.", "words": [{"word": "Hello.", "start": .1, "end": 1.0}], "segments": []})
    segments = local_video.transcribe_local_video(path, 302, lambda *args: None)
    assert segments[0].reference_words[0]["start"] == .1
    assert segments[1].reference_words[0]["start"] == 300.1


def test_word_times_keep_chunk_offset_and_exclude_invalid_boundaries():
    words = [{"word": "one", "start": 1, "end": 2}, {"word": "nan", "start": float("nan"), "end": 2},
             {"word": "outside", "start": 3, "end": 4}]
    assert words_in_window(words, 0, 3, 300) == [{"word": "one", "start": 301, "end": 302, "probability": None}]


def write_signal(path, base=110, excursion=3, silent=False):
    t = np.arange(32000) / 16000
    frequency = base * 2 ** (excursion * np.sin(np.pi*t)/12)
    phase = 2*np.pi*np.cumsum(frequency)/16000
    signal = sum(np.sin(k*phase)/k for k in range(1, 7))/3
    if silent:
        signal *= 0
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes((signal*25000).astype("<i2").tobytes())


def test_pitch_register_invariance_and_silence(tmp_path):
    low, high, flat, silence = [tmp_path / name for name in ("low.wav", "high.wav", "flat.wav", "silence.wav")]
    write_signal(low)
    write_signal(high, base=220)
    write_signal(flat, excursion=0)
    write_signal(silence, silent=True)
    a, b, c = [analyze_audio(path) for path in (low, high, flat)]
    def curve(result):
        return np.array([np.nan if x is None else x for x in result["pitch_semitones"]])
    assert np.nanmedian(np.abs(curve(a)-curve(b))) < .05
    assert np.nanmedian(np.abs(curve(a)-curve(c))) > 1
    result = compare_audio(low, silence, 100)
    assert result["status"] == "unscorable"
    assert result["pitch_contour_similarity"] is None
    assert result["recording"]["pitch_range_semitones"] is None
    json.dumps(result, allow_nan=False)


def test_concurrent_capture_replay_and_failed_retry(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'jobs.db'}")
    init_db(engine)
    runner = JobRunner(engine_override=engine)
    identity = {"segment_id": 1, "audio_sha256": "same", "evaluation_version": "2"}
    def enqueue(index):
        return runner.enqueue_job("shadowing", "capture", {"wav_path": f"{index}.wav"}, request_identity=identity, retry_failed=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(enqueue, range(2)))
    assert jobs[0][0].id == jobs[1][0].id
    assert sum(created for _, created in jobs) == 1
    runner.queue.get_nowait()
    with Session(engine) as session:
        job = session.get(Job, jobs[0][0].id)
        job.status = "failed"
        session.add(job)
        session.commit()
    retried, created = enqueue(3)
    assert created and retried.id == jobs[0][0].id
    assert json.loads(retried.payload_json)["wav_path"] == "3.wav"
    with pytest.raises(AppException) as error:
        runner.enqueue_job("shadowing", "capture", {}, request_identity={**identity, "audio_sha256": "different"})
    assert error.value.code == "IDEMPOTENCY_CONFLICT"


def test_reference_cache_cascades_with_video(tmp_path):
    from backend.app.models import ReferenceAnalysisCache
    engine = get_engine(f"sqlite:///{tmp_path / 'cascade.db'}")
    init_db(engine)
    with Session(engine) as session:
        video = Video(source_key="cache", title="cache", duration_seconds=2, transcription_source="local_asr")
        session.add(video)
        session.flush()
        segment = Segment(video_id=video.id, position=0, start_seconds=0, end_seconds=2, text="hello", timing_quality="word")
        session.add(segment)
        session.flush()
        session.add(ReferenceAnalysisCache(segment_id=segment.id, source_signature="hash", features_json="{}"))
        session.commit()
        session.delete(video)
        session.commit()
        assert session.exec(select(ReferenceAnalysisCache)).all() == []


def test_tts_cache_keeps_voice_and_punctuation_and_cleans_failure(tmp_path, monkeypatch):
    import edge_tts
    monkeypatch.setattr(british_service, "TTS_CACHE_DIR", tmp_path)
    class FakeCommunicate:
        def __init__(self, text, voice):
            self.text = text
        async def save(self, path):
            from pathlib import Path
            Path(path).write_bytes(b"audio")
            if self.text == "fail":
                raise RuntimeError("endpoint failed")
    monkeypatch.setattr(edge_tts, "Communicate", FakeCommunicate)
    a = asyncio.run(british_service.get_or_create_british_audio("can't", "voice-a"))
    b = asyncio.run(british_service.get_or_create_british_audio("cant", "voice-a"))
    c = asyncio.run(british_service.get_or_create_british_audio("can't", "voice-b"))
    assert len({a, b, c}) == 3
    with pytest.raises(RuntimeError):
        asyncio.run(british_service.get_or_create_british_audio("fail"))
    assert not list(tmp_path.glob("*.tmp"))
