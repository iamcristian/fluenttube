import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from backend.app.database import get_engine, get_session, init_db
from backend.app.main import app
from backend.app.models import DictionaryCache


@pytest.fixture(autouse=True)
def isolated_dictionary_sources(monkeypatch, tmp_path):
    """Exercise route/cache contracts without relying on live network or old TTS files."""
    from backend.app.routers import british
    async def audio(text):
        path = tmp_path / "audio.mp3"
        path.write_bytes(b"fixture" * 100)
        return path
    monkeypatch.setattr(british, "get_or_create_british_audio", audio)


@pytest.fixture
def test_db(tmp_path):
    test_db_path = tmp_path / "british_test.db"
    test_engine = get_engine(f"sqlite:///{test_db_path}")
    init_db(test_engine)
    return test_engine


@pytest.fixture
def client(test_db):
    def override_get_session():
        with Session(test_db) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_british_audio_generation(client: TestClient):
    response = client.get("/api/british/audio", params={"text": "hello"})
    assert response.status_code == 200
    assert response.headers.get("content-type") == "audio/mpeg"
    assert len(response.content) > 100


def test_british_dictionary_lookup_uses_local_sources(client: TestClient, test_db):
    # Ensure word does not exist in cache first
    with Session(test_db) as db:
        existing = db.get(DictionaryCache, "world")
        if existing:
            db.delete(existing)
            db.commit()

    # First lookup (uncached)
    response = client.get("/api/british/dictionary", params={"word": "world"})
    assert response.status_code == 200
    data = response.json()
    assert data["word"] == "world"
    assert data["audio_url"] == "/api/british/audio?text=world"
    assert data["cached"] is False
    assert data["definition_en"] is not None

    # Second lookup (cached)
    response_cached = client.get("/api/british/dictionary", params={"word": "world"})
    assert response_cached.status_code == 200
    data_cached = response_cached.json()
    assert data_cached["word"] == "world"
    assert data_cached["definition_source"] == "Princeton WordNet 3.0 (local)"


def test_british_sentence_ipa_is_local_and_reports_missing_and_ambiguous_words(client, test_db, monkeypatch):
    from backend.app.models import Video, Segment, utc_now
    def blocked(*args, **kwargs):
        raise AssertionError('IPA must not contact an external service')
    monkeypatch.setattr('httpx.AsyncClient', blocked)
    with Session(test_db) as session:
        video = Video(source_key='ipa-guide', title='American source video', duration_seconds=10, transcription_source='local_asr')
        session.add(video); session.commit(); session.refresh(video)
        segment = Segment(video_id=video.id, position=0, start_seconds=0, end_seconds=4, text='We read zxqvunknownword.', timing_quality='word')
        session.add(segment); session.commit(); session.refresh(segment)
        segment_id = segment.id
        assert client.get(f'/api/british/sentence/{segment_id}').status_code == 409
        segment.revealed_at = utc_now(); session.add(segment); session.commit()
    result = client.get(f'/api/british/sentence/{segment_id}')
    assert result.status_code == 200
    words = result.json()['words']
    assert words[0]['readings']
    assert len(words[1]['readings']) == 2
    assert words[2]['readings'] == []
    assert client.get('/api/british/sentence/999999').status_code == 404
