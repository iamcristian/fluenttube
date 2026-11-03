import json
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from backend.app.database import get_engine, get_session, init_db
from backend.app.main import app
from backend.app.models import Job, Segment, Video, utc_now
from backend.app.services.jobs import job_runner

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

def test_api_get_videos_pagination_and_sorting(client, test_db):
    """Verify listing videos respects pagination, completed count, and last_opened_at DESC NULLS LAST."""
    with Session(test_db) as session:
        # Video 1: opened recently
        v1 = Video(
            source_key="vid11111111",
            title="Video 1",
            duration_seconds=120.0,
            transcription_source="captions_manual",
            last_opened_at=datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc),
        )
        # Video 2: opened older
        v2 = Video(
            source_key="vid22222222",
            title="Video 2",
            duration_seconds=150.0,
            transcription_source="captions_auto",
            last_opened_at=datetime(2026, 10, 22, 12, 0, 0, tzinfo=timezone.utc),
        )
        # Video 3: never opened (last_opened_at is None)
        v3 = Video(
            source_key="vid33333333",
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
    assert data["items"][0]["source_key"] == "vid11111111"
    assert data["items"][0]["segment_count"] == 2
    assert data["items"][0]["completed_count"] == 1
    assert data["items"][1]["source_key"] == "vid22222222"

    # Query offset=2 to get the remaining nulls last video
    res2 = client.get("/api/videos?limit=2&offset=2")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["items"]) == 1
    assert data2["items"][0]["source_key"] == "vid33333333"

def test_api_get_video_detail_ordered_segments(client, test_db):
    """Verify GET /api/videos/{id} returns full detail with segments ordered by position."""
    with Session(test_db) as session:
        v = Video(
            source_key="detailVid123",
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
            source_key="progVid1111",
            title="Prog Video 1",
            duration_seconds=100.0,
            transcription_source="captions_manual",
        )
        v2 = Video(
            source_key="progVid2222",
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

def test_delete_video_removes_owned_history_and_local_files(client, test_db):
    from backend.app.models import LocalVideoMedia, PracticeSession, TutorCache, VocabularyCache
    from backend.app.services.local_video import media_root
    path = media_root() / 'local/delete-fixture.mp4'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'test local video')
    playback = path.with_suffix('.playback.mp4')
    playback.write_bytes(b'test playback copy')
    with Session(test_db) as db:
        target = Video(source_key='local:delete-fixture', title='Delete fixture', duration_seconds=5, transcription_source='local_asr')
        other = Video(source_key='keep-fixture', title='Keep fixture', duration_seconds=5, transcription_source='captions_manual')
        db.add(target); db.add(other); db.commit(); db.refresh(target); db.refresh(other)
        video_id, other_id = target.id, other.id
        segment = Segment(video_id=video_id, position=0, start_seconds=0, end_seconds=5, text='Hello.', timing_quality='word')
        db.add(segment); db.commit(); db.refresh(segment)
        segment_id = segment.id
        db.add(LocalVideoMedia(video_id=video_id, file_relative_path='local/delete-fixture.mp4'))
        db.add(PracticeSession(client_request_id='delete-session', request_hash='test', segment_id=segment_id))
        db.add(TutorCache(segment_id=segment_id, language='es', provider='test', model='test', prompt_version='1', context_hash='test', response_json='{}'))
        db.add(VocabularyCache(segment_id=segment_id, term='hello', language='es', provider='test', model='test', prompt_version='1', response_json='{}'))
        db.commit()
    progress = client.patch(f'/api/videos/{video_id}/progress', json={'last_segment_id': segment_id})
    assert progress.status_code == 200
    response = client.delete(f'/api/videos/{video_id}')
    assert response.status_code == 200, response.text
    assert response.json()['segment_ids'] == [segment_id]
    with Session(test_db) as db:
        assert db.get(Video, video_id) is None
        assert db.get(Video, other_id) is not None
        for model in (Segment, PracticeSession, TutorCache, VocabularyCache, LocalVideoMedia):
            assert db.exec(select(model)).all() == []
    assert not path.exists()
    assert not playback.exists()
    assert client.delete(f'/api/videos/{video_id}').status_code == 404


def test_url_ingestion_endpoint_is_removed(client):
    for prefix in ("/api", ""):
        response = client.post(f"{prefix}/videos/ingest", json={"url": "https://example.com/video"})
        assert response.status_code == 405
    schema = client.get("/api/openapi.json").json()
    assert "/api/videos/ingest" not in schema["paths"]
    assert "/api/videos/upload" in schema["paths"]
