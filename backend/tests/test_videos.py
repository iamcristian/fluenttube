import json
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from backend.app.database import get_engine, get_session, init_db
from backend.app.errors import AppException
from backend.app.main import app
from backend.app.models import Job, Segment, Video, utc_now
from backend.app.schemas import (
    IngestRequestDTO,
    VideoProgressUpdateDTO,
)
from backend.app.services.jobs import JobRunner, job_runner
from backend.app.services.youtube_service import (
    fetch_video_metadata,
    fetch_video_subtitles,
    handle_ingest_job,
)

@pytest.fixture
def test_db(tmp_path):
    """Isolated temporary SQLite database on disk."""
    db_file = tmp_path / "test_videos.db"
    engine = get_engine(f"sqlite:///{db_file}")
    init_db(engine)
    return engine

@pytest.fixture
def client(test_db):
    """TestClient wired with temporary test database session override."""
    def override_get_session():
        with Session(test_db) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    # Point global job_runner to test_db for tests
    original_engine = job_runner.engine
    job_runner.engine = test_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    job_runner.engine = original_engine

# =============================================================================
# Unit Tests for Metadata & Subtitle Fetching
# =============================================================================

def test_fetch_metadata_live_stream_rejected():
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = {
            "title": "Live Test",
            "is_live": True,
            "duration": 500,
        }
        mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

        with pytest.raises(AppException) as exc_info:
            fetch_video_metadata("dQw4w9WgXcQ")
        assert exc_info.value.code == "LIVE_STREAM_UNSUPPORTED"
        assert exc_info.value.status_code == 400

def test_fetch_metadata_too_long_rejected():
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = {
            "title": "Long Video",
            "is_live": False,
            "duration": 1801,
        }
        mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

        with pytest.raises(AppException) as exc_info:
            fetch_video_metadata("dQw4w9WgXcQ")
        assert exc_info.value.code == "VIDEO_TOO_LONG"
        assert exc_info.value.status_code == 400

def test_fetch_metadata_invalid_duration_rejected():
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = {
            "title": "Zero Duration",
            "is_live": False,
            "duration": 0,
        }
        mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

        with pytest.raises(AppException) as exc_info:
            fetch_video_metadata("dQw4w9WgXcQ")
        assert exc_info.value.code == "INVALID_VIDEO_METADATA"
        assert exc_info.value.status_code == 400

def test_fetch_metadata_download_error_maps_to_unavailable():
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.side_effect = Exception("Video unavailable")
        mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

        with pytest.raises(AppException) as exc_info:
            fetch_video_metadata("dQw4w9WgXcQ")
        assert exc_info.value.code == "VIDEO_UNAVAILABLE"
        assert exc_info.value.status_code == 404

def test_fetch_subtitles_manual_preferred_over_auto():
    with patch("backend.app.services.youtube_service.YouTubeTranscriptApi") as mock_api_cls:
        mock_api = MagicMock()
        mock_api_cls.return_value = mock_api

        auto_transcript = MagicMock()
        auto_transcript.language_code = "en"
        auto_transcript.is_generated = True

        manual_transcript = MagicMock()
        manual_transcript.language_code = "en"
        manual_transcript.is_generated = False
        manual_transcript.fetch.return_value = [
            {"text": "Manual subtitle line 1.", "start": 0.0, "duration": 2.0},
            {"text": "Manual subtitle line 2.", "start": 2.5, "duration": 3.0},
        ]

        mock_api.list.return_value = [auto_transcript, manual_transcript]

        fragments, source = fetch_video_subtitles("dQw4w9WgXcQ")
        assert source == "captions_manual"
        assert len(fragments) == 2
        assert fragments[0].text == "Manual subtitle line 1."
        manual_transcript.fetch.assert_called_once()
        auto_transcript.fetch.assert_not_called()

def test_fetch_subtitles_auto_fallback_when_no_manual():
    with patch("backend.app.services.youtube_service.YouTubeTranscriptApi") as mock_api_cls:
        mock_api = MagicMock()
        mock_api_cls.return_value = mock_api

        auto_transcript = MagicMock()
        auto_transcript.language_code = "en-US"
        auto_transcript.is_generated = True
        auto_transcript.fetch.return_value = [
            {"text": "Auto subtitle line.", "start": 1.0, "duration": 2.5},
        ]

        mock_api.list.return_value = [auto_transcript]

        fragments, source = fetch_video_subtitles("dQw4w9WgXcQ")
        assert source == "captions_auto"
        assert len(fragments) == 1
        assert fragments[0].text == "Auto subtitle line."

def test_fetch_subtitles_missing_english_fails():
    with patch("backend.app.services.youtube_service.YouTubeTranscriptApi") as mock_api_cls:
        mock_api = MagicMock()
        mock_api_cls.return_value = mock_api

        es_transcript = MagicMock()
        es_transcript.language_code = "es"
        es_transcript.is_generated = False

        mock_api.list.return_value = [es_transcript]

        with pytest.raises(AppException) as exc_info:
            fetch_video_subtitles("dQw4w9WgXcQ")
        assert exc_info.value.code == "SUBTITLES_NOT_FOUND"
        assert exc_info.value.status_code == 404
        assert "no tiene subtítulos en inglés" in exc_info.value.message

# =============================================================================
# Ingestion Job Handler & Atomic Persistence Tests
# =============================================================================

def test_handle_ingest_job_success(test_db):
    """Verify handle_ingest_job runs stages, produces segments, and commits atomically."""
    progress_log = []
    def progress_callback(stage, progress):
        progress_log.append((stage, progress))

    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs:
        
        mock_meta.return_value = {
            "youtube_id": "dQw4w9WgXcQ",
            "title": "Never Gonna Give You Up",
            "channel": "Rick Astley",
            "duration": 212.0,
        }
        from backend.app.services.segmenter import RawFragment
        mock_subs.return_value = (
            [
                RawFragment(start_seconds=0.0, end_seconds=2.0, text="Never gonna give you up."),
                RawFragment(start_seconds=3.0, end_seconds=5.0, text="Never gonna let you down."),
            ],
            "captions_manual",
        )

        result = handle_ingest_job(
            job_id="test-job-1",
            payload={"youtube_id": "dQw4w9WgXcQ"},
            update_progress=progress_callback,
            engine=test_db,
        )

        assert "video_id" in result
        assert result["segment_count"] == 2
        assert result["transcription_source"] == "captions_manual"

        # Check progress stages reported: 10% metadata, 40% captions, 70% segmenting, 100% saving
        stages = [p[0] for p in progress_log]
        assert "metadata" in stages
        assert "captions" in stages
        assert "segmenting" in stages
        assert "saving" in stages

        # Verify DB entities
        with Session(test_db) as session:
            video = session.get(Video, result["video_id"])
            assert video is not None
            assert video.youtube_id == "dQw4w9WgXcQ"
            assert video.title == "Never Gonna Give You Up"
            assert video.duration_seconds == 212.0
            assert video.transcription_source == "captions_manual"
            assert len(video.segments) == 2
            assert video.segments[0].position == 0
            assert video.segments[0].text == "Never gonna give you up."
            assert video.segments[1].position == 1
            assert video.segments[1].text == "Never gonna let you down."

def test_handle_ingest_job_atomic_rollback_on_failure(test_db):
    """Verify that if saving fails, the transaction rolls back with no orphaned Video (Invariant 4.3.1)."""
    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs, \
         patch("backend.app.services.youtube_service.segment_fragments") as mock_seg:

        mock_meta.return_value = {
            "youtube_id": "failVid1234",
            "title": "Rollback Test",
            "channel": "Channel",
            "duration": 60.0,
        }
        mock_subs.return_value = ([], "captions_manual")
        # Return two segments with duplicate position=0 to trigger unique constraint uq_video_position
        from backend.app.services.segmenter import SegmentDraft
        mock_seg.return_value = [
            SegmentDraft(position=0, start_seconds=0.0, end_seconds=2.0, text="First", timing_quality="caption"),
            SegmentDraft(position=0, start_seconds=2.0, end_seconds=4.0, text="Duplicate pos", timing_quality="caption"),
        ]

        with pytest.raises(Exception):
            handle_ingest_job(
                job_id="test-fail-job",
                payload={"youtube_id": "failVid1234"},
                update_progress=lambda s, p: None,
                engine=test_db,
            )

        # Assert no orphaned Video was committed
        with Session(test_db) as session:
            video = session.exec(select(Video).where(Video.youtube_id == "failVid1234")).first()
            assert video is None

# =============================================================================
# API Endpoint Tests
# =============================================================================

def test_api_ingest_cache_hit_returns_200(client, test_db):
    """When video already exists and force=False, returns 200 with cached=True without enqueuing."""
    with Session(test_db) as session:
        video = Video(
            youtube_id="cacheHit123",
            title="Existing Video",
            duration_seconds=100.0,
            transcription_source="captions_manual",
        )
        session.add(video)
        session.commit()
        session.refresh(video)
        video_id = video.id

    response = client.post(
        "/api/videos/ingest",
        json={"url": "https://www.youtube.com/watch?v=cacheHit123", "force": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["cached"] is True
    assert data["video_id"] == video_id
    assert data["status"] == "completed"
    assert data["job_id"] is None

def test_api_ingest_force_on_existing_returns_409(client, test_db):
    """When video already exists and force=True, returns 409 VIDEO_ALREADY_EXISTS."""
    with Session(test_db) as session:
        video = Video(
            youtube_id="force123456",
            title="Existing Video",
            duration_seconds=100.0,
            transcription_source="captions_manual",
        )
        session.add(video)
        session.commit()

    response = client.post(
        "/api/videos/ingest",
        json={"url": "https://www.youtube.com/watch?v=force123456", "force": True},
    )
    assert response.status_code == 409
    data = response.json()
    assert data["error"]["code"] == "VIDEO_ALREADY_EXISTS"

def test_api_ingest_in_progress_returns_409(client, test_db):
    """When a job for the same video is currently queued/running, return 409 INGEST_IN_PROGRESS."""
    with Session(test_db) as session:
        job = Job(
            client_request_id="initial-req-id",
            request_hash="hash123",
            kind="ingest",
            status="running",
            payload_json=json.dumps({"youtube_id": "inProg12345"}),
            created_at=utc_now(),
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id

    response = client.post(
        "/api/videos/ingest",
        json={
            "url": "https://www.youtube.com/watch?v=inProg12345",
            "client_request_id": "different-req-id",
        },
    )
    assert response.status_code == 409
    data = response.json()
    assert data["error"]["code"] == "INGEST_IN_PROGRESS"
    assert data["error"]["details"]["existing_job_id"] == job_id

def test_api_ingest_new_video_returns_202(client, test_db):
    """When video is new, enqueues job and returns 202 with job_id."""
    response = client.post(
        "/api/videos/ingest",
        json={
            "url": "https://www.youtube.com/watch?v=newVid12345",
            "client_request_id": "new-job-req-id",
        },
    )
    assert response.status_code == 202
    data = response.json()
    assert data["cached"] is False
    assert data["status"] == "queued"
    assert data["job_id"] is not None

def test_api_get_videos_pagination_and_sorting(client, test_db):
    """Verify listing videos respects pagination, completed count, and last_opened_at DESC NULLS LAST."""
    with Session(test_db) as session:
        # Video 1: opened recently
        v1 = Video(
            youtube_id="vid11111111",
            title="Video 1",
            duration_seconds=120.0,
            transcription_source="captions_manual",
            last_opened_at=datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc),
        )
        # Video 2: opened older
        v2 = Video(
            youtube_id="vid22222222",
            title="Video 2",
            duration_seconds=150.0,
            transcription_source="captions_auto",
            last_opened_at=datetime(2026, 10, 22, 12, 0, 0, tzinfo=timezone.utc),
        )
        # Video 3: never opened (last_opened_at is None)
        v3 = Video(
            youtube_id="vid33333333",
            title="Video 3",
            duration_seconds=90.0,
            transcription_source="captions_manual",
            last_opened_at=None,
        )
        session.add_all([v1, v2, v3])
        session.flush()

        # Add segments to v1: 2 segments, 1 completed
        s1 = Segment(
            video_id=v1.id,
            position=0,
            start_seconds=0.0,
            end_seconds=3.0,
            text="Sentence one.",
            timing_quality="caption",
            completed_at=utc_now(),
        )
        s2 = Segment(
            video_id=v1.id,
            position=1,
            start_seconds=3.0,
            end_seconds=6.0,
            text="Sentence two.",
            timing_quality="caption",
        )
        session.add_all([s1, s2])
        session.commit()

    # Query GET /api/videos with limit=2
    res = client.get("/api/videos?limit=2&offset=0")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    # v1 first (most recently opened), then v2
    assert data["items"][0]["youtube_id"] == "vid11111111"
    assert data["items"][0]["segment_count"] == 2
    assert data["items"][0]["completed_count"] == 1
    assert data["items"][1]["youtube_id"] == "vid22222222"

    # Query offset=2 to get the remaining nulls last video
    res2 = client.get("/api/videos?limit=2&offset=2")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["items"]) == 1
    assert data2["items"][0]["youtube_id"] == "vid33333333"

def test_api_get_video_detail_ordered_segments(client, test_db):
    """Verify GET /api/videos/{id} returns full detail with segments ordered by position."""
    with Session(test_db) as session:
        v = Video(
            youtube_id="detailVid123",
            title="Detailed Video",
            channel="Test Channel",
            duration_seconds=200.0,
            transcription_source="captions_manual",
        )
        session.add(v)
        session.flush()

        # Insert segments out of order
        s1 = Segment(
            video_id=v.id,
            position=1,
            start_seconds=3.0,
            end_seconds=6.0,
            text="Second segment.",
            timing_quality="caption",
            revealed_at=utc_now(),
        )
        s0 = Segment(
            video_id=v.id,
            position=0,
            start_seconds=0.0,
            end_seconds=3.0,
            text="First segment.",
            timing_quality="caption",
            completed_at=utc_now(),
        )
        session.add_all([s1, s0])
        session.commit()
        vid_id = v.id

    res = client.get(f"/api/videos/{vid_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == vid_id
    assert data["title"] == "Detailed Video"
    assert data["segment_count"] == 2
    assert data["completed_count"] == 1
    assert len(data["segments"]) == 2

    # Segments must be sorted by position 0, 1
    assert data["segments"][0]["position"] == 0
    assert data["segments"][0]["text"] == "First segment."
    assert data["segments"][0]["completed"] is True
    assert data["segments"][0]["shadowing_unlocked"] is True

    assert data["segments"][1]["position"] == 1
    assert data["segments"][1]["text"] == "Second segment."
    assert data["segments"][1]["completed"] is False
    assert data["segments"][1]["revealed"] is True
    assert data["segments"][1]["shadowing_unlocked"] is True

def test_api_patch_video_progress_success_and_validation(client, test_db):
    """Verify PATCH /api/videos/{id}/progress updates last_segment_id and validates ownership."""
    with Session(test_db) as session:
        v1 = Video(
            youtube_id="progVid1111",
            title="Prog Video 1",
            duration_seconds=100.0,
            transcription_source="captions_manual",
        )
        v2 = Video(
            youtube_id="progVid2222",
            title="Prog Video 2",
            duration_seconds=100.0,
            transcription_source="captions_manual",
        )
        session.add_all([v1, v2])
        session.flush()

        seg_v1 = Segment(
            video_id=v1.id,
            position=0,
            start_seconds=0.0,
            end_seconds=5.0,
            text="V1 Segment",
            timing_quality="caption",
        )
        seg_v2 = Segment(
            video_id=v2.id,
            position=0,
            start_seconds=0.0,
            end_seconds=5.0,
            text="V2 Segment",
            timing_quality="caption",
        )
        session.add_all([seg_v1, seg_v2])
        session.commit()
        v1_id, seg_v1_id = v1.id, seg_v1.id
        v2_id, seg_v2_id = v2.id, seg_v2.id

    # 1. Update v1 with seg_v1: Success 200
    res = client.patch(
        f"/api/videos/{v1_id}/progress",
        json={"last_segment_id": seg_v1_id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["last_segment_id"] == seg_v1_id
    assert "last_opened_at" in data

    # Verify persisted in DB
    with Session(test_db) as session:
        updated_v1 = session.get(Video, v1_id)
        assert updated_v1.last_segment_id == seg_v1_id
        assert updated_v1.last_opened_at is not None

    # 2. Update v1 with seg_v2 (belongs to another video): Error 400 INVALID_SEGMENT_ID
    res_bad = client.patch(
        f"/api/videos/{v1_id}/progress",
        json={"last_segment_id": seg_v2_id},
    )
    assert res_bad.status_code == 400
    bad_data = res_bad.json()
    assert bad_data["error"]["code"] == "INVALID_SEGMENT_ID"

    # 3. Update non-existent video: Error 404 VIDEO_NOT_FOUND
    res_404 = client.patch(
        "/api/videos/999999/progress",
        json={"last_segment_id": seg_v1_id},
    )
    assert res_404.status_code == 404
    assert res_404.json()["error"]["code"] == "VIDEO_NOT_FOUND"

# =============================================================================
# Integration Test (Optional / Live network check)
# =============================================================================

@pytest.mark.integration
def test_real_video_ingestion_smoke(test_db):
    """
    Live smoke test against a real public YouTube short video.
    Uses 'jNQXAC9IVRw' (Me at the zoo, 19s).
    Skips cleanly if network is unreachable or YouTube blocks request.
    """
    progress_stages = []
    def progress_callback(stage, progress):
        progress_stages.append(stage)

    try:
        result = handle_ingest_job(
            job_id="live-smoke-test-job",
            payload={"youtube_id": "jNQXAC9IVRw"},
            update_progress=progress_callback,
            engine=test_db,
        )
    except AppException as app_err:
        if app_err.code in ("RATE_LIMITED", "VIDEO_UNAVAILABLE", "SUBTITLES_NOT_FOUND"):
            pytest.skip(f"Live YouTube access skipped: {app_err.code} - {app_err.message}")
        raise
    except Exception as exc:
        pytest.skip(f"Live network unavailable: {exc}")

    assert result["video_id"] is not None
    assert result["segment_count"] >= 1
    with Session(test_db) as session:
        video = session.get(Video, result["video_id"])
        assert video is not None
        assert video.youtube_id == "jNQXAC9IVRw"
        assert len(video.segments) >= 1
        for s in video.segments:
            assert s.start_seconds >= 0.0
            assert s.end_seconds > s.start_seconds
            assert len(s.text) > 0

# =============================================================================
# Task T18: Ingestion ASR Fallback Tests
# =============================================================================

def test_ingest_captionless_video_falls_back_to_local_asr(test_db, tmp_path):
    """
    Acceptance criteria: Video lacking subtitles automatically falls back to local ASR.
    Records source as 'local_asr' with word-level segment timings.
    """
    dummy_wav = tmp_path / "downloaded_dummy.m4a"
    dummy_wav.write_bytes(b"dummy audio data")

    asr_words = [
        {"word": "Welcome", "start": 0.2, "end": 0.8, "probability": 0.99},
        {"word": "to", "start": 0.85, "end": 1.05, "probability": 0.98},
        {"word": "FluentTube.", "start": 1.1, "end": 1.9, "probability": 0.95},
    ]
    mock_asr_result = {
        "text": "Welcome to FluentTube.",
        "duration": 2.0,
        "words": asr_words,
        "segments": [{"start": 0.2, "end": 1.9, "text": "Welcome to FluentTube.", "words": asr_words}],
    }

    progress_stages = []
    def progress_callback(stage, progress):
        progress_stages.append(stage)

    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs, \
         patch("backend.app.services.youtube_service.download_youtube_audio") as mock_dl, \
         patch("backend.app.services.youtube_service.whisper_engine.load_model") as mock_load, \
         patch("backend.app.services.youtube_service.whisper_engine.transcribe") as mock_transcribe:

        mock_meta.return_value = {
            "youtube_id": "test_nocap12",
            "title": "Captionless Video",
            "channel": "English Channel",
            "duration": 30.0,
        }
        # Simulate missing subtitles
        mock_subs.side_effect = AppException(
            code="SUBTITLES_NOT_FOUND",
            message="No captions available",
            status_code=404,
        )
        mock_dl.return_value = dummy_wav
        mock_transcribe.return_value = mock_asr_result

        result = handle_ingest_job(
            job_id="captionless-job-uuid",
            payload={"youtube_id": "test_nocap12", "force_gpu_whisper": False},
            update_progress=progress_callback,
            engine=test_db,
        )

        assert result["transcription_source"] == "local_asr"
        assert result["segment_count"] == 1

        # Verify stages include audio download and transcription
        assert "metadata" in progress_stages
        assert "downloading_audio" in progress_stages
        assert "loading_model" in progress_stages
        assert "transcribing" in progress_stages
        assert "segmenting" in progress_stages
        assert "saving" in progress_stages

        # Verify database record
        with Session(test_db) as session:
            video = session.get(Video, result["video_id"])
            assert video is not None
            assert video.transcription_source == "local_asr"
            assert video.audio_relative_path == f"audio/{dummy_wav.name}"
            assert len(video.segments) == 1
            seg = video.segments[0]
            assert seg.text == "Welcome to FluentTube."
            assert seg.timing_quality == "word"
            assert seg.start_seconds == 0.2
            assert seg.end_seconds == 1.9

def test_ingest_force_gpu_whisper_bypasses_captions(test_db, tmp_path):
    """
    Acceptance criteria: force_gpu_whisper=True on a new video bypasses subtitles
    and executes local ASR directly.
    """
    dummy_wav = tmp_path / "forced_audio.m4a"
    dummy_wav.write_bytes(b"forced audio content")

    asr_words = [
        {"word": "Local", "start": 0.5, "end": 1.0, "probability": 0.99},
        {"word": "transcription.", "start": 1.1, "end": 2.2, "probability": 0.97},
    ]

    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs, \
         patch("backend.app.services.youtube_service.download_youtube_audio") as mock_dl, \
         patch("backend.app.services.youtube_service.whisper_engine.load_model"), \
         patch("backend.app.services.youtube_service.whisper_engine.transcribe") as mock_transcribe:

        mock_meta.return_value = {
            "youtube_id": "forced_asr12",
            "title": "Forced Local ASR Video",
            "channel": "Tech",
            "duration": 45.0,
        }
        mock_dl.return_value = dummy_wav
        mock_transcribe.return_value = {
            "text": "Local transcription.",
            "duration": 5.0,
            "words": asr_words,
            "segments": [{"start": 0.5, "end": 2.2, "text": "Local transcription.", "words": asr_words}],
        }

        result = handle_ingest_job(
            job_id="forced-job-uuid",
            payload={"youtube_id": "forced_asr12", "force_gpu_whisper": True},
            update_progress=lambda st, pr: None,
            engine=test_db,
        )

        # Captions fetch must NOT be invoked when force_gpu_whisper=True
        mock_subs.assert_not_called()
        assert result["transcription_source"] == "local_asr"

        with Session(test_db) as session:
            video = session.get(Video, result["video_id"])
            assert video.transcription_source == "local_asr"
            assert video.segments[0].timing_quality == "word"

def test_ingest_audio_download_failure_leaves_no_orphaned_records(test_db):
    """
    Acceptance criteria: Audio download failure leaves NO orphaned video records.
    """
    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs, \
         patch("backend.app.services.youtube_service.download_youtube_audio") as mock_dl:

        mock_meta.return_value = {
            "youtube_id": "fail_dl_123",
            "title": "Download Fail Video",
            "channel": "Channel",
            "duration": 60.0,
        }
        mock_subs.side_effect = AppException(
            code="SUBTITLES_NOT_FOUND",
            message="No captions available",
            status_code=404,
        )
        mock_dl.side_effect = AppException(
            code="AUDIO_DOWNLOAD_FAILED",
            message="Download stream aborted by remote host",
            status_code=502,
        )

        with pytest.raises(AppException) as exc_info:
            handle_ingest_job(
                job_id="fail-dl-job",
                payload={"youtube_id": "fail_dl_123", "force_gpu_whisper": False},
                update_progress=lambda st, pr: None,
                engine=test_db,
            )

        assert exc_info.value.code == "AUDIO_DOWNLOAD_FAILED"

        # Invariant 4.3.1: Zero orphaned videos or segments
        with Session(test_db) as session:
            videos = session.exec(select(Video).where(Video.youtube_id == "fail_dl_123")).all()
            assert len(videos) == 0
            segments = session.exec(select(Segment)).all()
            assert len(segments) == 0

def test_ingest_asr_model_unavailable_leaves_no_orphaned_records(test_db, tmp_path):
    """
    Acceptance criteria: Whisper failure leaves NO orphaned video records.
    """
    dummy_wav = tmp_path / "audio.m4a"
    dummy_wav.write_bytes(b"audio")

    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs, \
         patch("backend.app.services.youtube_service.download_youtube_audio") as mock_dl, \
         patch("backend.app.services.youtube_service.whisper_engine.load_model") as mock_load:

        mock_meta.return_value = {
            "youtube_id": "fail_model_1",
            "title": "Model Fail Video",
            "channel": "Channel",
            "duration": 60.0,
        }
        mock_subs.side_effect = AppException(code="SUBTITLES_NOT_FOUND", message="No subtitles", status_code=404)
        mock_dl.return_value = dummy_wav
        mock_load.side_effect = AppException(code="MODEL_UNAVAILABLE", message="Cannot load Whisper model", status_code=500)

        with pytest.raises(AppException) as exc_info:
            handle_ingest_job(
                job_id="fail-model-job",
                payload={"youtube_id": "fail_model_1", "force_gpu_whisper": False},
                update_progress=lambda st, pr: None,
                engine=test_db,
            )

        assert exc_info.value.code == "MODEL_UNAVAILABLE"

        # Invariant 4.3.1: Zero orphaned records
        with Session(test_db) as session:
            videos = session.exec(select(Video).where(Video.youtube_id == "fail_model_1")).all()
            assert len(videos) == 0

def test_ingest_unpunctuated_captions_do_not_force_asr(test_db):
    """
    Acceptance criteria per Section 6.3 Rule 7:
    Unpunctuated subtitles DO NOT trigger audio download or ASR fallback.
    They are cleaned and segmented from captions.
    """
    from backend.app.services.segmenter import RawFragment

    unpunctuated_fragments = [
        RawFragment(start_seconds=0.0, end_seconds=2.0, text="hello everyone welcome back to the channel"),
        RawFragment(start_seconds=2.5, end_seconds=4.0, text="today we are going to learn english"),
    ]

    with patch("backend.app.services.youtube_service.fetch_video_metadata") as mock_meta, \
         patch("backend.app.services.youtube_service.fetch_video_subtitles") as mock_subs, \
         patch("backend.app.services.youtube_service.download_youtube_audio") as mock_dl:

        mock_meta.return_value = {
            "youtube_id": "unpunctuated",
            "title": "Unpunctuated Captions Video",
            "channel": "English",
            "duration": 10.0,
        }
        mock_subs.return_value = (unpunctuated_fragments, "captions_auto")

        result = handle_ingest_job(
            job_id="unpunctuated-job",
            payload={"youtube_id": "unpunctuated", "force_gpu_whisper": False},
            update_progress=lambda st, pr: None,
            engine=test_db,
        )

        # Audio download MUST NOT be invoked when captions exist
        mock_dl.assert_not_called()
        assert result["transcription_source"] == "captions_auto"

        with Session(test_db) as session:
            video = session.get(Video, result["video_id"])
            assert video.transcription_source == "captions_auto"
            assert video.audio_relative_path is None
