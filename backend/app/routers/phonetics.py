import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, File
from starlette.concurrency import run_in_threadpool
from uuid import uuid4
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import PhoneticsChallenge, PhoneticsReview
from backend.app.services.british_service import get_or_create_british_audio

router = APIRouter(prefix="/phonetics", tags=["phonetics"])
CONTENT = json.loads((Path(__file__).parent.parent / "content" / "phonetics.json").read_text(encoding="utf8"))
LESSONS = {lesson["id"]: lesson for lesson in CONTENT["lessons"]}
UNITS = {u["id"]: u for u in json.loads((Path(__file__).parent.parent / "content" / "phonetics_course.json").read_text(encoding="utf8"))}


@router.get("/course")
def course(session: Session = Depends(get_session)):
    history = session.exec(select(PhoneticsReview).where(PhoneticsReview.lesson_id.in_(list(UNITS)))).all()
    completed = {row.lesson_id for row in history if row.correct}
    return [{**{k: u[k] for k in ("id", "title", "example", "instruction", "focus")},
             "completed": u["id"] in completed} for u in UNITS.values()]


def lesson_by_id(lesson_id):
    if lesson_id not in LESSONS:
        raise AppException(code="RESOURCE_NOT_FOUND", message="Lesson not found.", status_code=404)
    return LESSONS[lesson_id]


@router.post("/voice/{lesson_id}")
async def compare_voice(lesson_id: str, audio_file: UploadFile = File(...)):
    """Ephemeral comparison with the word example; never writes student scores."""
    lesson = lesson_by_id(lesson_id)
    from backend.app.services.audio_service import (
        stream_and_validate_upload, convert_to_pcm16k_mono, ensure_temp_dir, safe_cleanup,
    )
    from backend.app.services.prosody import analyze_audio
    from backend.app.services.local_video import extract_audio_chunk
    key = str(uuid4())
    raw = None
    recording = ensure_temp_dir() / f"{key}.wav"
    reference = ensure_temp_dir() / f"{key}-reference.wav"
    try:
        raw = await stream_and_validate_upload(audio_file, key)
        await run_in_threadpool(convert_to_pcm16k_mono, raw, recording)
        example = await get_or_create_british_audio(lesson["word"])
        await run_in_threadpool(extract_audio_chunk, example, reference, 0, 30)
        a = await run_in_threadpool(analyze_audio, reference)
        b = await run_in_threadpool(analyze_audio, recording)
        return {"status": "experimental" if a["status"] == b["status"] == "estimated" else "unscorable",
                "reference": a, "recording": b, "word": lesson["word"],
                "normalization_method": "median-semitones-1",
                "reference_source": "synthetic-en-GB-RyanNeural",
                "warning_codes": ["DESCRIPTIVE_ONLY_NOT_CALIBRATED"]}
    except AppException:
        raise
    except ValueError as exc:
        raise AppException(code="AUDIO_UNSCORABLE", message="Graba entre 0,5 y 30 segundos y vuelve a intentarlo.", status_code=422) from exc
    except Exception as exc:
        raise AppException(code="VOICE_ANALYSIS_UNAVAILABLE", message="No se pudo comparar el audio. Puedes escuchar tu toma y reintentar.", status_code=503, retryable=True) from exc
    finally:
        safe_cleanup(raw, recording, reference)
        await audio_file.close()


@router.get("/catalog")
def catalog():
    return CONTENT


@router.get("/audio/{lesson_id}")
async def lesson_audio(lesson_id: str):
    text = UNITS[lesson_id]["example"] if lesson_id in UNITS else lesson_by_id(lesson_id)["word"]
    try:
        path = await get_or_create_british_audio(text)
    except Exception as exc:
        raise AppException(code="AUDIO_UNAVAILABLE", message="British audio is unavailable. Retry when connected.", status_code=503, retryable=True) from exc
    return FileResponse(path, media_type="audio/mpeg", headers={"X-Audio-Source": "edge-tts-en-GB-RyanNeural"})


@router.post("/quizzes/{lesson_id}")
def new_challenge(lesson_id: str, session: Session = Depends(get_session)):
    if lesson_id in UNITS:
        unit = UNITS[lesson_id]
        key = secrets.choice(("a", "b"))
        challenge = PhoneticsChallenge(lesson_id=lesson_id, target_id=key)
        session.add(challenge)
        session.commit()
        return {"id": challenge.id, "prompt": unit["question"], "options": [
            {"id": option, "label": unit["solution"] if option == key else unit["distractor"]}
            for option in ("a", "b")]}
    lesson = lesson_by_id(lesson_id)
    options = [lesson_id, lesson["contrast_id"]]
    challenge = PhoneticsChallenge(lesson_id=lesson_id, target_id=secrets.choice(options))
    session.add(challenge)
    session.commit()
    session.refresh(challenge)
    secrets.SystemRandom().shuffle(options)
    response = {"id": challenge.id, "options": [{"id": item, "ipa": LESSONS[item]["ipa"]} for item in options]}

    # Variable centring diphthongs can merge in a synthetic voice. Test
    # their documented notation instead of grading an ambiguous recording.
    if lesson["diagram"]["kind"] == "notation" or lesson_id in {"near", "square", "cure"}:
        prompts = {
            "primary": "¿Qué signo precede a la sílaba con acento principal?",
            "secondary": "¿Qué signo precede a una sílaba con acento secundario?",
            "length": "¿Qué signo se coloca después de una vocal para indicar longitud?",
            "near": "¿Qué transcripción tradicional va de una vocal anterior casi cerrada hacia el centro?",
            "square": "¿Qué diptongo tradicional parte de una vocal anterior media y termina cerca del centro?",
            "cure": "¿Qué diptongo tradicional empieza con los labios redondeados y termina cerca del centro?",
            "thought": "¿Qué símbolo representa la vocal larga redondeada de thought?",
        }
        response["prompt"] = prompts[challenge.target_id]
    return response


@router.get("/quizzes/{challenge_id}/audio")
async def quiz_audio(challenge_id: str, session: Session = Depends(get_session)):
    challenge = session.get(PhoneticsChallenge, challenge_id)
    if challenge is None:
        raise AppException(code="RESOURCE_NOT_FOUND", message="Exercise not found.", status_code=404)
    return await lesson_audio(challenge.lesson_id if challenge.lesson_id in UNITS else challenge.target_id)


class ReviewAnswer(BaseModel):
    selected_id: str


@router.post("/quizzes/{challenge_id}/answer")
def answer(challenge_id: str, body: ReviewAnswer, session: Session = Depends(get_session)):
    challenge = session.get(PhoneticsChallenge, challenge_id)
    if challenge is None:
        raise AppException(code="RESOURCE_NOT_FOUND", message="Exercise not found.", status_code=404)
    unit = UNITS.get(challenge.lesson_id)
    choices = ("a", "b") if unit else (challenge.lesson_id, LESSONS[challenge.lesson_id]["contrast_id"])
    if body.selected_id not in choices:
        raise AppException(code="INVALID_ANSWER", message="Select one of the exercise options.", status_code=422)
    existing = session.get(PhoneticsReview, challenge_id)
    if existing is None:
        session.add(PhoneticsReview(challenge_id=challenge_id, lesson_id=challenge.lesson_id,
                    selected_id=body.selected_id, correct=body.selected_id == challenge.target_id))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
        existing = session.get(PhoneticsReview, challenge_id)
    if existing.selected_id != body.selected_id:
        raise AppException(code="IDEMPOTENCY_CONFLICT", message="This exercise was already answered.", status_code=409)
    if unit:
        return {"correct": existing.correct, "explanation": unit["explanation"], "solution": unit["solution"]}
    return {"correct": existing.correct, "answer_ipa": LESSONS[challenge.target_id]["ipa"],
            "word": LESSONS[challenge.target_id]["word"]}


@router.get("/reviews")
def reviews(session: Session = Depends(get_session)):
    attempts = session.exec(select(PhoneticsReview).order_by(PhoneticsReview.created_at, PhoneticsReview.challenge_id)).all()
    now = datetime.now(timezone.utc)
    items = []
    for lesson in CONTENT["lessons"]:
        history = [row for row in attempts if row.lesson_id == lesson["id"]]
        streak = 0
        for row in history:
            streak = streak + 1 if row.correct else 0
        interval = [1, 1, 3, 7, 14, 30][min(streak, 5)]
        due = history[-1].created_at.replace(tzinfo=timezone.utc) + timedelta(days=interval) if history else now
        items.append({"lesson_id": lesson["id"], "attempts": len(history),
                      "correct": sum(row.correct for row in history), "due_at": due.isoformat(),
                      "due": due <= now, "algorithm_version": "perception-streak-1"})
    return {"items": items}
