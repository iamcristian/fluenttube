import shutil
from fastapi import APIRouter, Response, status
from sqlalchemy import text
from sqlmodel import Session
from backend.app.config import settings
from backend.app.database import engine
from backend.app.schemas import (
    HealthResponseDTO,
    SpeechHealthDTO,
    TutorHealthDTO,
)
from backend.app.services.whisper_engine import whisper_engine

router = APIRouter(tags=["health"])

@router.get("/health", response_model=HealthResponseDTO)
def get_health(response: Response) -> HealthResponseDTO:
    ffmpeg_exists = shutil.which("ffmpeg") is not None
    
    db_status = "ok"
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
    except Exception:
        db_status = "unhealthy"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    speech_health = whisper_engine.get_health_status()

    return HealthResponseDTO(
        status="ok" if db_status == "ok" else "degraded",
        database=db_status,
        ffmpeg_available=ffmpeg_exists,
        speech=SpeechHealthDTO(**speech_health),
        tutor=TutorHealthDTO(
            enabled=bool(settings.TUTOR_ENABLED and settings.GEMINI_API_KEY),
            provider=settings.TUTOR_PROVIDER if (settings.TUTOR_ENABLED and settings.GEMINI_API_KEY) else None,
        ),
    )
