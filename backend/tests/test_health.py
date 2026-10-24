from fastapi.testclient import TestClient
from backend.app.config import settings
from backend.app.main import app

def test_health_check_returns_200():
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "ffmpeg_available" in data
        assert isinstance(data["ffmpeg_available"], bool)
        assert data["database"] == "ok"
        assert data["speech"]["state"] == "unloaded"
        assert data["speech"]["device"] is None
        assert data["tutor"]["enabled"] == settings.TUTOR_ENABLED

def test_request_id_header_propagated():
    with TestClient(app) as client:
        custom_id = "test-request-id-12345"
        response = client.get("/api/health", headers={"X-Request-ID": custom_id})
        assert response.status_code == 200
        assert response.headers.get("X-Request-ID") == custom_id

def test_cors_preflight_allowed_origin():
    with TestClient(app) as client:
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

def test_cors_disallows_unauthorized_origin():
    with TestClient(app) as client:
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://malicious-site.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") is None
