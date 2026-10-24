from pathlib import Path
from typing import List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8000
    DATABASE_URL: str = "sqlite:///./data/fluenttube.db"
    MEDIA_ROOT: str = "./media_cache"
    ALLOWED_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    MAX_VIDEO_SECONDS: int = 1800
    MAX_SOURCE_AUDIO_BYTES: int = 262144000
    MAX_RECORDING_SECONDS: int = 30
    MAX_RECORDING_BYTES: int = 15728640
    JOB_QUEUE_MAX_WAITING: int = 8
    EXPORT_TTL_HOURS: int = 24
    LOG_LEVEL: str = "INFO"

    # Speech recognition (Section 10.3)
    SPEECH_DEVICE: str = "auto"
    SPEECH_MODEL: str = "small.en"
    SPEECH_CPU_MODEL: str = "base.en"
    SPEECH_GPU_COMPUTE_TYPE: str = "int8_float16"
    SPEECH_CPU_COMPUTE_TYPE: str = "int8"
    SPEECH_ALLOW_CPU_FALLBACK: bool = True
    MODEL_CACHE_DIR: str = "./data/models"

    # Contextual LLM Tutor (Section 11, T20)
    TUTOR_ENABLED: bool = False
    TUTOR_PROVIDER: str = "gemini"
    TUTOR_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_API_KEY: Optional[str] = None
    TUTOR_TIMEOUT_SECONDS: int = 30


    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: Union[List[str], str]) -> List[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()
