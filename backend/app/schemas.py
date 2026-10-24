import uuid
from datetime import datetime
from typing import Any, Dict, Generic, List, Literal, Optional, TypeVar
from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")

# -----------------------------------------------------------------------------
# Base & Error Envelopes (Section 5.1)
# -----------------------------------------------------------------------------

class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: Dict[str, Any] = Field(default_factory=dict)
    request_id: str

class ErrorEnvelope(BaseModel):
    error: ErrorDetail

class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int

# -----------------------------------------------------------------------------
# Health DTOs (Section 5.4)
# -----------------------------------------------------------------------------

class SpeechHealthDTO(BaseModel):
    state: str = Field(
        default="unloaded",
        description="unloaded | loading | ready | unavailable",
    )
    device: Optional[str] = None
    model: Optional[str] = None
    compute_type: Optional[str] = None
    gpu_name: Optional[str] = None
    free_vram_mb: Optional[int] = None
    last_error: Optional[str] = None

class TutorHealthDTO(BaseModel):
    enabled: bool = False
    provider: Optional[str] = None

class HealthResponseDTO(BaseModel):
    status: str = Field(description="ok | degraded")
    database: str = Field(description="ok | unhealthy")
    ffmpeg_available: bool
    speech: SpeechHealthDTO
    tutor: TutorHealthDTO

# -----------------------------------------------------------------------------
# Video & Segment DTOs (Section 5.2)
# -----------------------------------------------------------------------------

class SegmentDTO(BaseModel):
    id: int
    video_id: int
    position: int
    start_seconds: float
    end_seconds: float
    text: str
    timing_quality: str
    completed: bool = False
    revealed: bool = False
    shadowing_unlocked: bool = False
    best_word_match_score: Optional[float] = None
    best_overall_score: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)

class VideoSummaryDTO(BaseModel):
    id: int
    youtube_id: str
    title: str
    channel: Optional[str] = None
    duration_seconds: float
    transcription_source: str
    segment_count: int = 0
    completed_count: int = 0
    last_segment_id: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class VideoDetailDTO(VideoSummaryDTO):
    segments: List[SegmentDTO] = Field(default_factory=list)

class VideoProgressUpdateDTO(BaseModel):
    last_segment_id: int

class VideoProgressResponseDTO(BaseModel):
    last_segment_id: int
    last_opened_at: datetime

# -----------------------------------------------------------------------------
# Job DTOs (Section 5.2, 5.4)
# -----------------------------------------------------------------------------

class JobErrorDTO(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: Dict[str, Any] = Field(default_factory=dict)

class JobDTO(BaseModel):
    id: str
    kind: str = Field(description="ingest | shadowing")
    status: str = Field(description="queued | running | succeeded | failed")
    stage: Optional[str] = None
    progress: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    result: Optional[Dict[str, Any]] = None
    error: Optional[JobErrorDTO] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class IngestRequestDTO(BaseModel):
    url: str
    force: bool = False
    force_gpu_whisper: bool = False
    client_request_id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))

class IngestResponseDTO(BaseModel):
    job_id: Optional[str] = None
    video_id: Optional[int] = None
    status: str = "queued"
    cached: bool = False

# -----------------------------------------------------------------------------
# Practice & Dictation DTOs (Section 5.3, 5.4)
# -----------------------------------------------------------------------------

class SessionCreateDTO(BaseModel):
    client_request_id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))

class SessionResponseDTO(BaseModel):
    id: str
    segment_id: int
    hinted_display_indices: List[int] = Field(default_factory=list)
    answer_revealed: bool = False
    last_input: str = ""
    last_result: Optional[Dict[str, Any]] = None
    created_at: datetime

class HintRequestDTO(BaseModel):
    display_token_index: int

class HintResponseDTO(BaseModel):
    display_token_index: int
    hint_letter: str
    hinted_display_indices: List[int]

class RevealResponseDTO(BaseModel):
    text: str
    shadowing_unlocked: bool = True
    completed: bool

class CheckRequestDTO(BaseModel):
    input_text: str = Field(max_length=2000)
    client_request_id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))

class AlignmentOpDTO(BaseModel):
    op: str = Field(description="match | substitution | insertion | omission")
    target_index: Optional[int] = None
    input_index: Optional[int] = None
    target: Optional[str] = None
    input: Optional[str] = None

class DictationResultDTO(BaseModel):
    attempt_id: int
    is_exact: bool
    score: float
    distance: int
    completed: bool
    shadowing_unlocked: bool
    assisted: bool
    alignment: List[AlignmentOpDTO]
    rules_version: str


# -----------------------------------------------------------------------------
# Shadowing DTOs (Section 5.2, 5.3)
# -----------------------------------------------------------------------------

class ShadowingEvaluateResponseDTO(BaseModel):
    job_id: str
    status: str = "queued"

class ShadowingAttemptDTO(BaseModel):
    id: int
    segment_id: int
    job_id: str
    status: str = Field(description="scored | unscorable")
    recognized_text: str
    word_match_score: Optional[float] = None
    timing_similarity_score: Optional[float] = None
    overall_score: Optional[float] = None
    alignment: List[Any] = Field(default_factory=list)
    warning_codes: List[str] = Field(default_factory=list)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class ShadowingAttemptListDTO(BaseModel):
    items: List[ShadowingAttemptDTO]
    total: int
    limit: int
    offset: int

# -----------------------------------------------------------------------------
# Tutor DTOs (Section 11, T20)
# -----------------------------------------------------------------------------

TutorKeyVocabularyType = Literal["phrasal_verb", "idiom", "slang", "grammar", "word"]

class TutorKeyVocabularyItem(BaseModel):
    term: str = Field(max_length=100)
    type: TutorKeyVocabularyType
    explanation: str = Field(max_length=600)

class TutorConnectedSpeechItem(BaseModel):
    fragment: str = Field(max_length=100)
    tip: str = Field(max_length=600)

class TutorExampleItem(BaseModel):
    sentence: str = Field(max_length=300)
    explanation: str = Field(max_length=600)

class TutorExplanationContent(BaseModel):
    contextual_meaning: str = Field(max_length=1200)
    key_vocabulary: List[TutorKeyVocabularyItem] = Field(default_factory=list, max_length=8)
    connected_speech: List[TutorConnectedSpeechItem] = Field(default_factory=list, max_length=5)
    example: TutorExampleItem

class TutorExplanationDTO(TutorExplanationContent):
    segment_id: int
    language: str
    cached: bool = False
    provider: str
    model: str

class TutorExplainRequestDTO(BaseModel):
    segment_id: int
    language: str = Field(default="es", max_length=10)

