"""Conservative import pacing, persisted through the existing job history."""
import math
from datetime import timezone
from sqlmodel import Session, select, or_
from backend.app.errors import AppException
from backend.app.models import Job, utc_now

IMPORT_INTERVAL_SECONDS = 30
BLOCK_COOLDOWN_SECONDS = 15 * 60


def youtube_import_wait(session: Session) -> int:
    # Local refusals must not extend the cooldown or hide the original remote failure.
    job = session.exec(select(Job).where(
        Job.kind == "ingest",
        Job.status.in_(["failed", "succeeded"]),
        Job.finished_at.is_not(None),
        or_(Job.error_code.is_(None), Job.error_code != "YOUTUBE_COOLDOWN"),
    ).order_by(Job.finished_at.desc()).limit(1)).first()
    if job is None:
        return 0
    message = (job.error_message or "").lower()
    blocked = job.error_code in {"RATE_LIMITED", "YOUTUBE_BLOCKED", "YOUTUBE_AUTH_REQUIRED"} or any(
        marker in message for marker in ("not a bot", "sign in to confirm", "too many requests", "http error 429")
    )
    finished = job.finished_at.replace(tzinfo=timezone.utc)
    elapsed = (utc_now() - finished).total_seconds()
    interval = BLOCK_COOLDOWN_SECONDS if blocked else IMPORT_INTERVAL_SECONDS
    return max(0, math.ceil(interval - elapsed))


def ensure_youtube_import_allowed(session: Session) -> None:
    remaining = youtube_import_wait(session)
    if remaining:
        raise AppException(
            code="YOUTUBE_COOLDOWN",
            message=f"Imports are paused to avoid sending repeated requests to YouTube. Try again in {math.ceil(remaining / 60)} minute(s). Your saved videos remain available.",
            status_code=429,
            retryable=False,
            details={"retry_after_seconds": remaining},
        )
