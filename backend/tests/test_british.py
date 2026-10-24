import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from backend.app.database import get_engine, get_session, init_db
from backend.app.main import app
from backend.app.models import DictionaryCache


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


def test_british_dictionary_lookup_and_caching(client: TestClient, test_db):
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
    assert data_cached["cached"] is True
