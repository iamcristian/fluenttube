import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from sqlmodel import Session, select
from backend.app.database import engine as default_engine
from backend.app.models import Segment, ShadowingAttempt
from backend.app.services.assessment import assess_shadowing
from backend.app.services.audio_service import safe_cleanup
from backend.app.services.whisper_engine import whisper_engine

logger = logging.getLogger(__name__)

def handle_shadowing_job(
    job_id: str,
    payload: Dict[str, Any],
    update_progress: Callable[[Optional[str], Optional[float]], None],
    engine: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Background job handler for shadowing evaluation jobs (kind="shadowing").
    Consumes faster-whisper ASR engine off the main event loop to transcribe speech
    with word-level timestamps, runs Section 10.4 assessment scoring, persists the
    ShadowingAttempt record, and cleans up temporary audio artifacts.
    """
    active_engine = engine or default_engine
    segment_id = payload.get("segment_id")
    wav_path_str = payload.get("wav_path")

    logger.info(f"Handling shadowing job {job_id} for segment {segment_id}")

    # Stage 1: Audio validated & converted
    update_progress("audio_validated", 0.2)

    if not wav_path_str or not Path(wav_path_str).exists():
        logger.error(f"Shadowing job {job_id} missing converted WAV file: {wav_path_str}")
        raise ValueError(f"WAV audio file not found at path: {wav_path_str}")

    try:
        # Verify segment in database and capture reference parameters
        with Session(active_engine) as session:
            segment = session.exec(select(Segment).where(Segment.id == segment_id)).first()
            if not segment:
                raise ValueError(f"Segment with id {segment_id} does not exist.")
            reference_text = segment.text
            reference_speech_seconds = segment.reference_speech_seconds
            segment_window_seconds = max(0.0, segment.end_seconds - segment.start_seconds)
            timing_quality = segment.timing_quality

        # Stage 2: Transcribe speech with faster-whisper ASR engine
        update_progress("transcribing_speech", 0.5)

        transcription = whisper_engine.transcribe(
            audio_path=wav_path_str,
            language="en",
            vad_filter=True,
        )

        # Stage 3: Assessment scoring per Section 10.4
        update_progress("evaluating_speech", 0.8)

        assessment = assess_shadowing(
            reference_text=reference_text,
            reference_speech_seconds=reference_speech_seconds,
            segment_window_seconds=segment_window_seconds,
            recognized_text=transcription["text"],
            recognized_words=transcription["words"],
            timing_quality=timing_quality,
        )

        # Stage 4: Persist ShadowingAttempt
        update_progress("saving_attempt", 0.95)

        with Session(active_engine) as session:
            # Idempotency: check if an attempt for this job_id already exists
            existing_attempt = session.exec(
                select(ShadowingAttempt).where(ShadowingAttempt.job_id == job_id)
            ).first()

            if existing_attempt:
                existing_attempt.status = assessment["status"]
                existing_attempt.recognized_text = transcription["text"]
                existing_attempt.word_match_score = assessment["word_match_score"]
                existing_attempt.timing_similarity_score = assessment["timing_similarity_score"]
                existing_attempt.overall_score = assessment["overall_score"]
                existing_attempt.alignment_json = json.dumps(assessment["alignment"])
                existing_attempt.model_name = transcription["model_name"]
                existing_attempt.device = transcription["device"]
                existing_attempt.compute_type = transcription["compute_type"]
                existing_attempt.scoring_version = assessment["scoring_version"]
                existing_attempt.warning_codes_json = json.dumps(assessment["warning_codes"])
                session.add(existing_attempt)
                session.commit()
                session.refresh(existing_attempt)
                attempt_id = existing_attempt.id
            else:
                attempt = ShadowingAttempt(
                    job_id=job_id,
                    segment_id=segment_id,
                    status=assessment["status"],
                    recognized_text=transcription["text"],
                    word_match_score=assessment["word_match_score"],
                    timing_similarity_score=assessment["timing_similarity_score"],
                    overall_score=assessment["overall_score"],
                    alignment_json = json.dumps(assessment["alignment"]),
                    model_name=transcription["model_name"],
                    device=transcription["device"],
                    compute_type=transcription["compute_type"],
                    scoring_version=assessment["scoring_version"],
                    warning_codes_json=json.dumps(assessment["warning_codes"]),
                )
                session.add(attempt)
                session.flush()
                attempt_id = attempt.id
                session.commit()

        update_progress("completed", 1.0)

        result = {
            "attempt_id": attempt_id,
            "job_id": job_id,
            "segment_id": segment_id,
            "status": assessment["status"],
            "recognized_text": transcription["text"],
            "word_match_score": assessment["word_match_score"],
            "timing_similarity_score": assessment["timing_similarity_score"],
            "overall_score": assessment["overall_score"],
            "spoken_duration": assessment["spoken_duration"],
            "reference_duration": assessment["reference_duration"],
            "timing_basis": assessment["timing_basis"],
            "alignment": assessment["alignment"],
            "insertions": assessment["insertions"],
            "warning_codes": assessment["warning_codes"],
            "scoring_version": assessment["scoring_version"],
            "model_name": transcription["model_name"],
            "device": transcription["device"],
            "compute_type": transcription["compute_type"],
            "duration_seconds": transcription["duration"],
            "inference_time_ms": transcription["inference_time_ms"],
        }

        logger.info(
            f"Shadowing job {job_id} scored successfully (attempt {attempt_id}). "
            f"Overall: {assessment['overall_score']}, Word: {assessment['word_match_score']}, "
            f"Timing: {assessment['timing_similarity_score']}, Status: {assessment['status']}"
        )
        return result

    finally:
        # Section 10.2 cleanup: delete converted WAV once evaluation finishes
        if wav_path_str:
            safe_cleanup(wav_path_str)
