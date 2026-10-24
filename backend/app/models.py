import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlmodel import Field, Relationship, SQLModel, UniqueConstraint

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class Video(SQLModel, table=True):
    __tablename__ = "video"

    id: Optional[int] = Field(default=None, primary_key=True)
    youtube_id: str = Field(unique=True, index=True, nullable=False)
    title: str = Field(nullable=False)
    channel: Optional[str] = Field(default=None)
    duration_seconds: float = Field(gt=0, nullable=False)
    transcription_source: str = Field(
        nullable=False,
        description="captions_manual | captions_auto | local_asr",
    )
    language: str = Field(default="en", nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    last_opened_at: Optional[datetime] = Field(default=None)
    last_segment_id: Optional[int] = Field(default=None, foreign_key="segment.id")
    audio_relative_path: Optional[str] = Field(default=None)

    # Explicit foreign_keys to disambiguate from last_segment_id
    segments: List["Segment"] = Relationship(
        back_populates="video",
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "order_by": "Segment.position",
            "foreign_keys": "Segment.video_id",
        },
    )

class Segment(SQLModel, table=True):
    __tablename__ = "segment"
    __table_args__ = (
        UniqueConstraint("video_id", "position", name="uq_video_position"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    video_id: int = Field(foreign_key="video.id", index=True, nullable=False)
    position: int = Field(ge=0, nullable=False)
    start_seconds: float = Field(ge=0, nullable=False)
    end_seconds: float = Field(nullable=False)
    text: str = Field(nullable=False)
    timing_quality: str = Field(
        nullable=False,
        description="caption | word | coarse",
    )
    reference_speech_seconds: Optional[float] = Field(default=None, gt=0)
    completed_at: Optional[datetime] = Field(default=None)
    revealed_at: Optional[datetime] = Field(default=None)

    video: Optional[Video] = Relationship(
        back_populates="segments",
        sa_relationship_kwargs={"foreign_keys": "Segment.video_id"},
    )
    practice_sessions: List["PracticeSession"] = Relationship(
        back_populates="segment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    dictation_attempts: List["DictationAttempt"] = Relationship(
        back_populates="segment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    shadowing_attempts: List["ShadowingAttempt"] = Relationship(
        back_populates="segment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

class PracticeSession(SQLModel, table=True):
    __tablename__ = "practicesession"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    client_request_id: str = Field(unique=True, index=True, nullable=False)
    request_hash: str = Field(index=True, nullable=False)
    segment_id: int = Field(foreign_key="segment.id", index=True, nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    hinted_display_indices_json: str = Field(default="[]", nullable=False)
    answer_revealed: bool = Field(default=False, nullable=False)
    last_input: str = Field(default="", max_length=2000, nullable=False)
    last_result_json: Optional[str] = Field(default=None)

    segment: Optional[Segment] = Relationship(back_populates="practice_sessions")
    dictation_attempts: List["DictationAttempt"] = Relationship(
        back_populates="session",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

class DictationAttempt(SQLModel, table=True):
    __tablename__ = "dictationattempt"

    id: Optional[int] = Field(default=None, primary_key=True)
    client_request_id: str = Field(unique=True, index=True, nullable=False)
    request_hash: str = Field(index=True, nullable=False)
    session_id: str = Field(foreign_key="practicesession.id", index=True, nullable=False)
    segment_id: int = Field(foreign_key="segment.id", index=True, nullable=False)
    input_text: str = Field(nullable=False)
    normalized_target_json: str = Field(nullable=False)
    normalized_input_json: str = Field(nullable=False)
    distance: int = Field(ge=0, nullable=False)
    score: float = Field(ge=0, le=100, nullable=False)
    is_exact: bool = Field(nullable=False)
    assisted: bool = Field(nullable=False)
    rules_version: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)

    segment: Optional[Segment] = Relationship(back_populates="dictation_attempts")
    session: Optional[PracticeSession] = Relationship(back_populates="dictation_attempts")

class ShadowingAttempt(SQLModel, table=True):
    __tablename__ = "shadowingattempt"

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: str = Field(unique=True, foreign_key="job.id", index=True, nullable=False)
    segment_id: int = Field(foreign_key="segment.id", index=True, nullable=False)
    status: str = Field(nullable=False, description="scored | unscorable")
    recognized_text: str = Field(nullable=False)
    word_match_score: Optional[float] = Field(default=None)
    timing_similarity_score: Optional[float] = Field(default=None)
    overall_score: Optional[float] = Field(default=None)
    alignment_json: str = Field(default="[]", nullable=False)
    model_name: str = Field(nullable=False)
    device: str = Field(nullable=False)
    compute_type: str = Field(nullable=False)
    scoring_version: str = Field(nullable=False)
    warning_codes_json: str = Field(default="[]", nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)

    segment: Optional[Segment] = Relationship(back_populates="shadowing_attempts")
    job: Optional["Job"] = Relationship(back_populates="shadowing_attempt")

class TutorCache(SQLModel, table=True):
    __tablename__ = "tutorcache"
    __table_args__ = (
        UniqueConstraint(
            "segment_id",
            "language",
            "provider",
            "model",
            "prompt_version",
            "context_hash",
            name="uq_tutor_cache",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    segment_id: int = Field(foreign_key="segment.id", index=True, nullable=False)
    language: str = Field(nullable=False)
    provider: str = Field(nullable=False)
    model: str = Field(nullable=False)
    prompt_version: str = Field(nullable=False)
    context_hash: str = Field(index=True, nullable=False)
    response_json: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)

class Job(SQLModel, table=True):
    __tablename__ = "job"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    client_request_id: str = Field(unique=True, index=True, nullable=False)
    request_hash: str = Field(index=True, nullable=False)
    kind: str = Field(nullable=False, description="ingest | shadowing")
    status: str = Field(
        default="queued",
        nullable=False,
        description="queued | running | succeeded | failed",
    )
    stage: Optional[str] = Field(default=None)
    progress: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    payload_json: str = Field(default="{}", nullable=False)
    result_json: Optional[str] = Field(default=None)
    error_code: Optional[str] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    started_at: Optional[datetime] = Field(default=None)
    finished_at: Optional[datetime] = Field(default=None)

    shadowing_attempt: Optional[ShadowingAttempt] = Relationship(
        back_populates="job",
        sa_relationship_kwargs={"uselist": False},
    )
