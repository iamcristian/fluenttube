import io
import json
import wave
import uuid
from datetime import datetime, timezone
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool
from backend.app.main import app
from backend.app.database import get_session
from backend.app.models import Video, Segment, Job, ShadowingAttempt
from backend.app.services.jobs import JobRunner
from backend.app.services.shadowing_service import handle_shadowing_job
import backend.app.routers.shadowing as shadowing_router_module

def create_synthetic_wav(duration_seconds: float = 2.0, sample_rate: int = 16000) -> bytes:
    """Generate in-memory synthetic 16-bit mono PCM WAV audio using Python standard library."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        num_frames = int(duration_seconds * sample_rate)
        frames = b"\x00\x00" * num_frames
        wav_file.writeframes(frames)
    return buffer.getvalue()

@pytest.fixture
def shadowing_db():
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)

    # Dedicated job runner for tests
    test_runner = JobRunner(engine_override=test_engine)
    test_runner.register_handler("shadowing", handle_shadowing_job)
    test_runner.start()

    import backend.app.routers.jobs as jobs_router_module
    from backend.app.services.whisper_engine import whisper_engine

    old_shadow_runner = shadowing_router_module.job_runner
    old_jobs_runner = jobs_router_module.job_runner
    shadowing_router_module.job_runner = test_runner
    jobs_router_module.job_runner = test_runner

    whisper_engine.set_mock_transcriber(
        lambda path, opts: {
            "text": "Second completed sentence.",
            "language": "en",
            "language_probability": 0.99,
            "duration": 2.5,
            "words": [
                {"word": "Second", "start": 0.0, "end": 0.6, "probability": 0.95},
                {"word": "completed", "start": 0.6, "end": 1.4, "probability": 0.92},
                {"word": "sentence", "start": 1.4, "end": 2.1, "probability": 0.96},
            ],
            "segments": [
                {
                    "start": 0.0,
                    "end": 2.1,
                    "text": "Second completed sentence.",
                    "words": [
                        {"word": "Second", "start": 0.0, "end": 0.6, "probability": 0.95},
                        {"word": "completed", "start": 0.6, "end": 1.4, "probability": 0.92},
                        {"word": "sentence", "start": 1.4, "end": 2.1, "probability": 0.96},
                    ],
                }
            ],
            "model_name": "mock_model",
            "device": "cpu",
            "compute_type": "int8",
            "inference_time_ms": 45.2,
        }
    )

    def override_get_session():
        with Session(test_engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session

    yield test_engine, test_runner

    whisper_engine.set_mock_transcriber(None)
    test_runner.stop()
    shadowing_router_module.job_runner = old_shadow_runner
    jobs_router_module.job_runner = old_jobs_runner
    app.dependency_overrides.clear()

def seed_test_video_and_segments(engine):
    with Session(engine) as session:
        video = Video(
            youtube_id="jNQXAC9IVRw",
            title="Me at the zoo",
            channel="jawed",
            duration_seconds=19.0,
            transcription_source="captions_manual",
        )
        session.add(video)
        session.commit()
        session.refresh(video)

        now = datetime.now(timezone.utc)

        # Segment 1: Locked (not completed, not revealed)
        seg1 = Segment(
            video_id=video.id,
            position=0,
            start_seconds=0.0,
            end_seconds=3.0,
            text="First locked sentence.",
            timing_quality="good",
            completed_at=None,
            revealed_at=None,
        )
        # Segment 2: Unlocked via completed
        seg2 = Segment(
            video_id=video.id,
            position=1,
            start_seconds=3.0,
            end_seconds=6.5,
            text="Second completed sentence.",
            timing_quality="good",
            completed_at=now,
            revealed_at=None,
        )
        # Segment 3: Unlocked via revealed
        seg3 = Segment(
            video_id=video.id,
            position=2,
            start_seconds=6.5,
            end_seconds=10.0,
            text="Third revealed sentence.",
            timing_quality="good",
            completed_at=None,
            revealed_at=now,
        )
        session.add_all([seg1, seg2, seg3])
        session.commit()
        session.refresh(seg1)
        session.refresh(seg2)
        session.refresh(seg3)
        return video, [seg1, seg2, seg3]

def test_shadowing_locked_rejection(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    wav_bytes = create_synthetic_wav(duration_seconds=2.0)
    files = {"audio_file": ("recording.wav", io.BytesIO(wav_bytes), "audio/wav")}
    data = {"segment_id": segments[0].id, "client_request_id": str(uuid.uuid4())}

    # Segment 0 is locked (completed=false, revealed=false)
    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "SHADOWING_LOCKED"
    assert "Sentence must be completed or revealed" in body["error"]["message"]

def test_shadowing_nonexistent_segment(shadowing_db):
    client = TestClient(app)
    wav_bytes = create_synthetic_wav(duration_seconds=2.0)
    files = {"audio_file": ("recording.wav", io.BytesIO(wav_bytes), "audio/wav")}
    data = {"segment_id": 99999, "client_request_id": str(uuid.uuid4())}

    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "RESOURCE_NOT_FOUND"

def test_shadowing_empty_audio_rejection(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # Zero-byte audio file
    files = {"audio_file": ("empty.wav", io.BytesIO(b""), "audio/wav")}
    data = {"segment_id": segments[1].id, "client_request_id": str(uuid.uuid4())}

    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "EMPTY_AUDIO"
    assert "zero bytes" in body["error"]["message"]

def test_shadowing_oversized_audio_rejection(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # Create dummy payload exceeding 15 MiB (15 * 1024 * 1024 + 100 bytes)
    oversized_bytes = b"0" * (15 * 1024 * 1024 + 100)
    files = {"audio_file": ("giant.wav", io.BytesIO(oversized_bytes), "audio/wav")}
    data = {"segment_id": segments[1].id, "client_request_id": str(uuid.uuid4())}

    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 413
    body = resp.json()
    assert body["error"]["code"] == "AUDIO_TOO_LARGE"

def test_shadowing_spoofed_corrupt_audio_rejection(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # Text content disguised as audio/wav
    fake_audio = b"This is plain text pretending to be an audio recording."
    files = {"audio_file": ("spoofed.wav", io.BytesIO(fake_audio), "audio/wav")}
    data = {"segment_id": segments[1].id, "client_request_id": str(uuid.uuid4())}

    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 415
    body = resp.json()
    assert body["error"]["code"] == "UNSUPPORTED_AUDIO"

def test_shadowing_audio_too_short_rejection(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # 0.2s is below the 0.5s minimum threshold
    wav_bytes = create_synthetic_wav(duration_seconds=0.2)
    files = {"audio_file": ("short.wav", io.BytesIO(wav_bytes), "audio/wav")}
    data = {"segment_id": segments[1].id, "client_request_id": str(uuid.uuid4())}

    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "AUDIO_TOO_SHORT"
    assert body["error"]["details"]["duration_seconds"] < 0.5

def test_shadowing_audio_too_long_rejection(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # 31.0s exceeds the 30.5s maximum limit
    wav_bytes = create_synthetic_wav(duration_seconds=31.0)
    files = {"audio_file": ("long.wav", io.BytesIO(wav_bytes), "audio/wav")}
    data = {"segment_id": segments[1].id, "client_request_id": str(uuid.uuid4())}

    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "AUDIO_TOO_LONG"
    assert body["error"]["details"]["duration_seconds"] > 30.5

def test_shadowing_valid_audio_conversion_and_job_execution(shadowing_db):
    engine, runner = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # Valid 2.5s audio recording
    wav_bytes = create_synthetic_wav(duration_seconds=2.5)
    client_req_id = str(uuid.uuid4())
    malicious_filename = "../../../etc/shadow.wav"
    files = {"audio_file": (malicious_filename, io.BytesIO(wav_bytes), "audio/wav")}
    data = {"segment_id": segments[1].id, "client_request_id": client_req_id}

    # 1. Upload & evaluate
    resp = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp.status_code == 202
    body = resp.json()
    job_id = body["job_id"]
    assert body["status"] == "queued"

    # Verify upload filename did NOT influence storage path
    with Session(engine) as session:
        job = session.get(Job, job_id)
        assert job is not None
        # Verify malicious filename was NOT used anywhere in the saved path
        assert "etc" not in job.payload_json
        assert malicious_filename not in job.payload_json

    # 2. Wait for background job worker to complete processing
    import time
    for _ in range(30):
        time.sleep(0.1)
        with Session(engine) as session:
            job = session.get(Job, job_id)
            if job and job.status == "succeeded":
                break

    assert job.status == "succeeded"
    assert job.result_json is not None
    import json
    result = json.loads(job.result_json)
    assert result["recognized_text"] == "Second completed sentence."
    assert result["status"] == "scored"
    assert result["overall_score"] is not None
    assert result["word_match_score"] is not None
    assert result["attempt_id"] is not None
    assert 2.4 <= result["duration_seconds"] <= 2.6

    # Verify ShadowingAttempt was persisted in the DB
    with Session(engine) as session:
        attempt = session.get(ShadowingAttempt, result["attempt_id"])
        assert attempt is not None
        assert attempt.segment_id == segments[1].id
        assert attempt.status == "scored"
        assert attempt.overall_score == result["overall_score"]

    # 3. Test GET /jobs/{id} endpoint
    job_resp = client.get(f"/api/jobs/{job_id}")
    assert job_resp.status_code == 200
    job_data = job_resp.json()
    assert job_data["status"] == "succeeded"
    assert job_data["kind"] == "shadowing"
    assert job_data["result"]["recognized_text"] == "Second completed sentence."

def test_shadowing_idempotency_retry(shadowing_db):
    engine, runner = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    wav_bytes = create_synthetic_wav(duration_seconds=1.5)
    client_req_id = "idem_shadow_123"
    files = {"audio_file": ("test.wav", io.BytesIO(wav_bytes), "audio/wav")}
    data = {"segment_id": segments[2].id, "client_request_id": client_req_id}

    # First attempt: 202 Accepted
    resp1 = client.post("/api/shadowing/evaluate", files=files, data=data)
    assert resp1.status_code == 202
    job_id1 = resp1.json()["job_id"]

    # Identical retry with same client_request_id
    files2 = {"audio_file": ("test.wav", io.BytesIO(wav_bytes), "audio/wav")}
    resp2 = client.post("/api/shadowing/evaluate", files=files2, data=data)
    assert resp2.status_code in (200, 202)
    assert resp2.json()["job_id"] == job_id1

def test_list_shadowing_attempts_empty_and_seeded(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # Empty attempts list
    resp = client.get(f"/api/segments/{segments[1].id}/shadowing-attempts")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0

    # Seed an attempt record
    with Session(engine) as session:
        # Create a dummy job first for foreign key
        dummy_job = Job(
            client_request_id="test_dummy_job_1",
            request_hash="hash1",
            kind="shadowing",
            status="succeeded",
            payload_json="{}",
        )
        session.add(dummy_job)
        session.commit()
        session.refresh(dummy_job)

        attempt = ShadowingAttempt(
            job_id=dummy_job.id,
            segment_id=segments[1].id,
            status="scored",
            recognized_text="Second completed sentence.",
            word_match_score=95.0,
            timing_similarity_score=88.0,
            overall_score=91.5,
            alignment_json='[{"op":"match","target":"Second","input":"Second"}]',
            model_name="small.en",
            device="cpu",
            compute_type="int8",
            scoring_version="v1",
            warning_codes_json="[]",
        )
        session.add(attempt)
        session.commit()

    resp2 = client.get(f"/api/segments/{segments[1].id}/shadowing-attempts")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["total"] == 1
    assert data2["items"][0]["recognized_text"] == "Second completed sentence."
    assert data2["items"][0]["word_match_score"] == 95.0

def test_safe_cleanup_removes_both_path_and_string_paths(tmp_path: Path):
    from backend.app.services.audio_service import safe_cleanup

    file_as_path = tmp_path / "test_path.wav"
    file_as_path.write_bytes(b"dummy")

    file_as_str = tmp_path / "test_str.wav"
    file_as_str.write_bytes(b"dummy")

    assert file_as_path.exists()
    assert file_as_str.exists()

    safe_cleanup(file_as_path, str(file_as_str), None)

    assert not file_as_path.exists()
    assert not file_as_str.exists()

def test_shadowing_idempotency_conflict_on_mismatched_segment_or_kind(shadowing_db):
    engine, _ = shadowing_db
    _, segments = seed_test_video_and_segments(engine)
    client = TestClient(app)

    # Seed an existing job with client_request_id "idemp_test_key" for segment 1
    with Session(engine) as session:
        existing = Job(
            client_request_id="idemp_test_key",
            request_hash="some_hash",
            kind="shadowing",
            status="queued",
            payload_json=json.dumps({"segment_id": segments[1].id, "duration_seconds": 1.5}),
        )
        session.add(existing)
        session.commit()

    # Attempt to reuse the same client_request_id for segment 2
    audio_data = create_synthetic_wav(1.0)
    resp = client.post(
        "/api/shadowing/evaluate",
        data={"segment_id": segments[2].id, "client_request_id": "idemp_test_key"},
        files={"audio_file": ("test.wav", audio_data, "audio/wav")},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
