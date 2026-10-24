from datetime import datetime, timezone
import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from backend.app.config import settings
from backend.app.main import app
from backend.app.models import Job, Video
from backend.app.schemas import (
    HealthResponseDTO,
    JobDTO,
    VideoSummaryDTO,
)

# Test router to test validation envelope and mutating endpoints
contract_test_router = APIRouter(prefix="/api/test", tags=["test"])

class SamplePayload(BaseModel):
    name: str = Field(min_length=3)
    age: int = Field(ge=0)

@contract_test_router.post("/validate")
def sample_validate_endpoint(payload: SamplePayload):
    return {"message": f"Hello {payload.name}"}

app.include_router(contract_test_router)

def test_invalid_host_header_rejected():
    """Verify Host headers other than localhost/127.0.0.1/testserver are rejected."""
    with TestClient(app) as client:
        response = client.get("/api/health", headers={"Host": "malicious-host.com"})
        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        assert data["error"]["code"] == "INVALID_HOST"
        assert "Host header rejected" in data["error"]["message"]
        assert "request_id" in data["error"]

def test_valid_host_headers_accepted():
    """Verify allowed host headers succeed."""
    with TestClient(app) as client:
        for valid_host in ["localhost", "localhost:8000", "127.0.0.1", "127.0.0.1:8000", "testserver"]:
            response = client.get("/api/health", headers={"Host": valid_host})
            assert response.status_code == 200

def test_mutating_request_unauthorized_origin_rejected():
    """Verify mutating routes reject unauthorized origins with 403."""
    with TestClient(app) as client:
        response = client.post(
            "/api/test/validate",
            json={"name": "Alice", "age": 25},
            headers={"Origin": "http://evil-attacker.com"},
        )
        assert response.status_code == 403
        data = response.json()
        assert "error" in data
        assert data["error"]["code"] == "UNAUTHORIZED_ORIGIN"
        assert "unauthorized origin" in data["error"]["message"].lower()

def test_mutating_request_authorized_origin_accepted():
    """Verify mutating routes accept requests from configured dev origins."""
    with TestClient(app) as client:
        response = client.post(
            "/api/test/validate",
            json={"name": "Alice", "age": 25},
            headers={"Origin": "http://localhost:5173"},
        )
        assert response.status_code == 200
        assert response.json() == {"message": "Hello Alice"}

def test_pydantic_422_validation_error_envelope():
    """Verify validation errors adhere to Section 5.1 uniform error envelope."""
    with TestClient(app) as client:
        # Invalid payload: name too short, negative age
        response = client.post(
            "/api/test/validate",
            json={"name": "A", "age": -5},
            headers={"Origin": "http://localhost:5173"},
        )
        assert response.status_code == 422
        data = response.json()
        assert "error" in data
        err = data["error"]
        assert err["code"] == "INVALID_INPUT"
        assert err["message"] == "Request validation failed."
        assert err["retryable"] is False
        assert "request_id" in err
        assert "details" in err
        assert "errors" in err["details"]
        assert len(err["details"]["errors"]) >= 2

def test_health_check_canonical_schema():
    """Verify health endpoint conforms to HealthResponseDTO without model initialization."""
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        
        # Validate against Pydantic schema
        dto = HealthResponseDTO.model_validate(data)
        assert dto.status in ("ok", "degraded")
        assert dto.database == "ok"
        assert dto.speech.state == "unloaded"
        assert dto.speech.device is None
        assert dto.speech.model is None
        assert dto.tutor.enabled == settings.TUTOR_ENABLED
        if settings.TUTOR_ENABLED:
            assert dto.tutor.provider == settings.TUTOR_PROVIDER
        else:
            assert dto.tutor.provider is None

def test_dto_verification_no_internal_entity_leaks():
    """Verify public DTOs do not leak internal entity fields (payload_json, audio_relative_path)."""
    now = datetime.now(timezone.utc)
    
    # Test Job entity vs JobDTO
    job_entity = Job(
        id="test-job-uuid",
        client_request_id="client-req-999",
        request_hash="hash-secret",
        kind="ingest",
        status="succeeded",
        stage="done",
        progress=1.0,
        payload_json='{"internal_secret":"do_not_leak"}',
        result_json='{"video_id":42}',
        created_at=now,
    )
    job_dto = JobDTO(
        id=job_entity.id,
        kind=job_entity.kind,
        status=job_entity.status,
        stage=job_entity.stage,
        progress=job_entity.progress,
        result={"video_id": 42},
        error=None,
        created_at=job_entity.created_at,
    )
    dumped_job = job_dto.model_dump()
    assert "payload_json" not in dumped_job
    assert "request_hash" not in dumped_job
    assert "client_request_id" not in dumped_job
    assert dumped_job["result"] == {"video_id": 42}

    # Test Video entity vs VideoSummaryDTO
    video_entity = Video(
        id=1,
        youtube_id="abc123xyz78",
        title="Test Video",
        duration_seconds=120.0,
        transcription_source="captions_manual",
        audio_relative_path="audio/secret_internal_path.m4a",
        created_at=now,
    )
    video_dto = VideoSummaryDTO.model_validate(video_entity)
    dumped_video = video_dto.model_dump()
    assert "audio_relative_path" not in dumped_video
    assert dumped_video["youtube_id"] == "abc123xyz78"
