import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from backend.app.database import get_engine, init_db
from backend.app.models import (
    DictationAttempt,
    Job,
    PracticeSession,
    Segment,
    ShadowingAttempt,
    TutorCache,
    Video,
)

@pytest.fixture
def temp_db(tmp_path):
    """Fixture providing an isolated temporary SQLite database on disk."""
    db_file = tmp_path / "test_fluenttube.db"
    db_url = f"sqlite:///{db_file}"
    engine = get_engine(db_url)
    init_db(engine)
    return engine

def test_sqlite_pragmas_enabled(temp_db):
    """Verify that foreign keys, WAL mode, and busy timeout are active."""
    with Session(temp_db) as session:
        fk_result = session.exec(text("PRAGMA foreign_keys")).first()
        assert fk_result[0] == 1

        journal_result = session.exec(text("PRAGMA journal_mode")).first()
        assert journal_result[0].lower() == "wal"

        timeout_result = session.exec(text("PRAGMA busy_timeout")).first()
        assert timeout_result[0] == 5000

def test_video_and_segments_save_and_read(temp_db):
    """Verify video and ordered segments persist with 0-based positions."""
    with Session(temp_db) as session:
        video = Video(
            youtube_id="dQw4w9WgXcQ",
            title="Never Gonna Give You Up",
            channel="Rick Astley",
            duration_seconds=212.0,
            transcription_source="captions_manual",
            language="en",
        )
        session.add(video)
        session.commit()
        session.refresh(video)

        seg0 = Segment(
            video_id=video.id,
            position=0,
            start_seconds=0.0,
            end_seconds=4.5,
            text="We're no strangers to love.",
            timing_quality="caption",
        )
        seg1 = Segment(
            video_id=video.id,
            position=1,
            start_seconds=4.5,
            end_seconds=9.0,
            text="You know the rules and so do I.",
            timing_quality="caption",
        )
        session.add_all([seg0, seg1])
        session.commit()

        # Update last_segment_id
        video.last_segment_id = seg0.id
        session.add(video)
        session.commit()

    # Reopen fresh session
    with Session(temp_db) as session:
        loaded_video = session.exec(
            select(Video).where(Video.youtube_id == "dQw4w9WgXcQ")
        ).one()
        assert loaded_video.title == "Never Gonna Give You Up"
        assert len(loaded_video.segments) == 2
        assert loaded_video.segments[0].position == 0
        assert loaded_video.segments[1].position == 1
        assert loaded_video.last_segment_id == loaded_video.segments[0].id

def test_unique_youtube_id_constraint(temp_db):
    """Verify unique constraint on Video.youtube_id."""
    with Session(temp_db) as session:
        v1 = Video(
            youtube_id="unique_id_123",
            title="Video 1",
            duration_seconds=60.0,
            transcription_source="captions_manual",
        )
        session.add(v1)
        session.commit()

        v2 = Video(
            youtube_id="unique_id_123",
            title="Video 2 (Duplicate)",
            duration_seconds=120.0,
            transcription_source="captions_auto",
        )
        session.add(v2)
        with pytest.raises(IntegrityError):
            session.commit()

def test_unique_video_position_constraint(temp_db):
    """Verify unique constraint on (video_id, position)."""
    with Session(temp_db) as session:
        video = Video(
            youtube_id="vid_pos_test",
            title="Position Test",
            duration_seconds=30.0,
            transcription_source="captions_manual",
        )
        session.add(video)
        session.commit()
        session.refresh(video)

        seg0a = Segment(
            video_id=video.id,
            position=0,
            start_seconds=0.0,
            end_seconds=3.0,
            text="First segment",
            timing_quality="caption",
        )
        session.add(seg0a)
        session.commit()

        # Duplicate position 0 for same video
        seg0b = Segment(
            video_id=video.id,
            position=0,
            start_seconds=3.0,
            end_seconds=6.0,
            text="Conflicting segment",
            timing_quality="caption",
        )
        session.add(seg0b)
        with pytest.raises(IntegrityError):
            session.commit()

def test_foreign_key_rejection(temp_db):
    """Verify foreign key constraint rejects non-existent video_id."""
    with Session(temp_db) as session:
        orphan_segment = Segment(
            video_id=999999,  # Non-existent
            position=0,
            start_seconds=0.0,
            end_seconds=5.0,
            text="Orphan text",
            timing_quality="caption",
        )
        session.add(orphan_segment)
        with pytest.raises(IntegrityError):
            session.commit()

def test_cascade_delete_video(temp_db):
    """Verify deleting a video cascades and removes all segments."""
    with Session(temp_db) as session:
        video = Video(
            youtube_id="cascade_test",
            title="Cascade Test",
            duration_seconds=10.0,
            transcription_source="captions_manual",
        )
        session.add(video)
        session.commit()
        session.refresh(video)

        seg = Segment(
            video_id=video.id,
            position=0,
            start_seconds=0.0,
            end_seconds=2.0,
            text="Sample segment",
            timing_quality="caption",
        )
        session.add(seg)
        session.commit()

        # Delete video
        session.delete(video)
        session.commit()

        # Segments must be gone
        remaining_segs = session.exec(select(Segment).where(Segment.video_id == video.id)).all()
        assert len(remaining_segs) == 0

def test_idempotency_key_enforcement(temp_db):
    """Verify client_request_id unique constraint on PracticeSession and Job."""
    with Session(temp_db) as session:
        video = Video(
            youtube_id="idemp_vid",
            title="Idempotency Test",
            duration_seconds=10.0,
            transcription_source="captions_manual",
        )
        session.add(video)
        session.commit()
        session.refresh(video)

        seg = Segment(
            video_id=video.id,
            position=0,
            start_seconds=0.0,
            end_seconds=3.0,
            text="Session segment",
            timing_quality="caption",
        )
        session.add(seg)
        session.commit()
        session.refresh(seg)

        # PracticeSession idempotency
        sess1 = PracticeSession(
            client_request_id="client-req-001",
            request_hash="hash_abc",
            segment_id=seg.id,
        )
        session.add(sess1)
        session.commit()

        sess2 = PracticeSession(
            client_request_id="client-req-001",  # Same client_request_id
            request_hash="hash_abc",
            segment_id=seg.id,
        )
        session.add(sess2)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        # Job idempotency
        job1 = Job(
            client_request_id="job-req-001",
            request_hash="job_hash_123",
            kind="ingest",
        )
        session.add(job1)
        session.commit()

        job2 = Job(
            client_request_id="job-req-001",  # Same client_request_id
            request_hash="job_hash_123",
            kind="ingest",
        )
        session.add(job2)
        with pytest.raises(IntegrityError):
            session.commit()

def test_rollback_of_partial_insertion(temp_db):
    """Invariant 4.3.1: Partial video insertion must rollback cleanly leaving no records."""
    with Session(temp_db) as session:
        try:
            video = Video(
                youtube_id="rollback_vid",
                title="Rollback Test",
                duration_seconds=60.0,
                transcription_source="captions_manual",
            )
            session.add(video)
            session.flush()  # Flush gives video an ID without committing transaction

            # Add one valid segment
            seg0 = Segment(
                video_id=video.id,
                position=0,
                start_seconds=0.0,
                end_seconds=5.0,
                text="Valid segment",
                timing_quality="caption",
            )
            session.add(seg0)
            session.flush()

            # Trigger an intentional error (invalid segment with non-existent foreign key)
            broken_seg = Segment(
                video_id=99999999,  # Invalid
                position=1,
                start_seconds=5.0,
                end_seconds=10.0,
                text="Broken segment",
                timing_quality="caption",
            )
            session.add(broken_seg)
            session.commit()
        except IntegrityError:
            session.rollback()

    # Verify neither video nor segment was persisted
    with Session(temp_db) as session:
        videos = session.exec(select(Video).where(Video.youtube_id == "rollback_vid")).all()
        assert len(videos) == 0
        segments = session.exec(select(Segment).where(Segment.text == "Valid segment")).all()
        assert len(segments) == 0
