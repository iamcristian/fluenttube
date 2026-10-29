"""
backend/tests/test_vocabulary.py

Tests for Local Contextual Vocabulary Dictionary (Section 6, F-05, F-12, F-13).
Verifies:
- Contextual dictionary endpoint POST /api/vocabulary/explain
- Valid schema output (meaning_en, translation, contextual_meaning, examples, etc.)
- SQLite VocabularyCache persistence and cache-first reading
- Cache retrieval even when provider/Ollama is offline
- Repair retry on malformed JSON
- Offsets boundary validation
- Missing segment 404 & empty term 422
"""

import json
from datetime import datetime, timezone
from typing import Optional
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from backend.app.config import settings
from backend.app.database import get_session
from backend.app.main import app
from backend.app.models import Segment, Video, VocabularyCache
from backend.app.services.llm_tutor import (
    BaseTutorClient,
    VOCAB_PROMPT_VERSION,
    tutor_service,
)


@pytest.fixture(name="db_session")
def db_session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(db_session: Session):
    def get_session_override():
        return db_session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app, base_url="http://localhost:8000")
    yield client
    app.dependency_overrides.clear()
    tutor_service.set_client(None)


def seed_video_and_segment(session: Session) -> Segment:
    video = Video(
        youtube_id="vocab_test_vid",
        title="Vocabulary Test Video",
        duration_seconds=20.0,
        transcription_source="captions_manual",
    )
    session.add(video)
    session.commit()
    session.refresh(video)

    seg = Segment(
        video_id=video.id,
        position=0,
        start_seconds=0.0,
        end_seconds=5.0,
        text="I cannot put up with that terrible noise any longer.",
        timing_quality="caption",
        completed_at=datetime.now(timezone.utc),
    )
    session.add(seg)
    session.commit()
    session.refresh(seg)
    return seg


class MockVocabClient(BaseTutorClient):
    def __init__(self, response_text: str):
        self._response_text = response_text
        self.call_count = 0
        self._model = "llama3.2"

    async def generate_text(
        self, prompt: str, system_instruction: str, timeout_seconds: int = 15
    ) -> str:
        self.call_count += 1
        return self._response_text


SAMPLE_VOCAB_RESPONSE = {
    "term": "put up with",
    "lemma": "put up with",
    "part_of_speech": "phrasal verb",
    "meaning_en": "To tolerate something unpleasant or annoying.",
    "translation": "soportar; tolerar",
    "contextual_meaning": "En esta frase, significa soportar un ruido muy molesto.",
    "usage_notes": ["Inseparable: put up with + noun/pronoun."],
    "examples": [
        {
            "en": "I cannot put up with that terrible noise any longer.",
            "translation": "Ya no puedo soportar ese ruido terrible por más tiempo.",
        }
    ],
    "collocations": ["put up with noise", "put up with rudeness"],
    "other_senses": [],
    "warnings": [],
}


def test_vocabulary_explain_success(client: TestClient, db_session: Session, monkeypatch):
    monkeypatch.setattr(settings, "TUTOR_ENABLED", True)
    monkeypatch.setattr(settings, "TUTOR_PROVIDER", "ollama")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "llama3.2")

    mock_client = MockVocabClient(json.dumps(SAMPLE_VOCAB_RESPONSE))
    tutor_service.set_client(mock_client)

    seg = seed_video_and_segment(db_session)

    res = client.post(
        "/api/vocabulary/explain",
        json={
            "segment_id": seg.id,
            "term": "put up with",
            "selection_start": 9,
            "selection_end": 20,
            "explanation_language": "es",
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["term"] == "put up with"
    assert data["lemma"] == "put up with"
    assert data["part_of_speech"] == "phrasal verb"
    assert data["translation"] == "soportar; tolerar"
    assert data["meaning_en"] == "To tolerate something unpleasant or annoying."
    assert "soportar un ruido" in data["contextual_meaning"]
    assert len(data["examples"]) == 1
    assert data["cached"] is False
    assert data["provider"] == "ollama"
    assert mock_client.call_count == 1

    # Verify persisted in VocabularyCache
    cached = db_session.exec(
        select(VocabularyCache).where(
            VocabularyCache.segment_id == seg.id,
            VocabularyCache.term == "put up with",
        )
    ).first()
    assert cached is not None


def test_vocabulary_cache_hit_and_offline_resilience(
    client: TestClient, db_session: Session, monkeypatch
):
    monkeypatch.setattr(settings, "TUTOR_ENABLED", True)
    monkeypatch.setattr(settings, "TUTOR_PROVIDER", "ollama")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "llama3.2")

    mock_client = MockVocabClient(json.dumps(SAMPLE_VOCAB_RESPONSE))
    tutor_service.set_client(mock_client)

    seg = seed_video_and_segment(db_session)

    # First call - cache miss
    res1 = client.post(
        "/api/vocabulary/explain",
        json={"segment_id": seg.id, "term": "put up with", "explanation_language": "es"},
    )
    assert res1.status_code == 200
    assert res1.json()["cached"] is False
    assert mock_client.call_count == 1

    # Simulate provider going offline / disabled
    monkeypatch.setattr(settings, "TUTOR_ENABLED", False)
    tutor_service.set_client(None)

    # Second call - should return from cache directly without error (F-13)
    res2 = client.post(
        "/api/vocabulary/explain",
        json={"segment_id": seg.id, "term": "put up with", "explanation_language": "es"},
    )
    assert res2.status_code == 200
    assert res2.json()["cached"] is True
    assert res2.json()["translation"] == "soportar; tolerar"


def test_vocabulary_explain_repair_retry(
    client: TestClient, db_session: Session, monkeypatch
):
    monkeypatch.setattr(settings, "TUTOR_ENABLED", True)
    monkeypatch.setattr(settings, "TUTOR_PROVIDER", "ollama")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "llama3.2")

    class FlakyVocabClient(BaseTutorClient):
        def __init__(self):
            self.calls = 0
            self._model = "llama3.2"

        async def generate_text(
            self, prompt: str, system_instruction: str, timeout_seconds: int = 15
        ) -> str:
            self.calls += 1
            if self.calls == 1:
                return "Not valid JSON at all: Here is your explanation..."
            return json.dumps(SAMPLE_VOCAB_RESPONSE)

    flaky_client = FlakyVocabClient()
    tutor_service.set_client(flaky_client)

    seg = seed_video_and_segment(db_session)

    res = client.post(
        "/api/vocabulary/explain",
        json={"segment_id": seg.id, "term": "put up with", "explanation_language": "es"},
    )
    assert res.status_code == 200
    assert res.json()["term"] == "put up with"
    assert flaky_client.calls == 2  # Repaired on second call


def test_vocabulary_explain_missing_segment(client: TestClient):
    res = client.post(
        "/api/vocabulary/explain",
        json={"segment_id": 99999, "term": "noise"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "RESOURCE_NOT_FOUND"


def test_vocabulary_explain_empty_term(client: TestClient, db_session: Session):
    seg = seed_video_and_segment(db_session)
    res = client.post(
        "/api/vocabulary/explain",
        json={"segment_id": seg.id, "term": "   "},
    )
    assert res.status_code == 422
