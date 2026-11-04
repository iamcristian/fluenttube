"""Read local reference clips and recover missing word times on demand."""
import json
import math
import hashlib
from sqlmodel import Session
from backend.app.models import Segment, LocalVideoMedia, ReferenceAnalysisCache
from backend.app.services.whisper_engine import whisper_engine


def words_in_window(words, start, end, offset=0):
    result = []
    for word in words:
        a, b = word.get("start"), word.get("end")
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            continue
        if not math.isfinite(a) or not math.isfinite(b) or not start <= a < b <= end:
            continue
        result.append({"word": str(word.get("word", "")), "start": round(a + offset, 3),
                       "end": round(b + offset, 3), "probability": word.get("probability")})
    return sorted(result, key=lambda word: word["start"])


def prepare_reference(segment_id, output, engine):
    from backend.app.services.local_video import local_media_path, extract_audio_chunk
    with Session(engine) as session:
        segment = session.get(Segment, segment_id)
        if segment is None:
            raise ValueError("Reference segment was deleted")
        media = session.get(LocalVideoMedia, segment.video_id)
        if media is None:
            raise ValueError("No imported local reference")
        start, end, text = segment.start_seconds, segment.end_seconds, segment.text
        if not math.isfinite(start) or not math.isfinite(end) or end <= start or end-start > 30:
            raise ValueError("Reference interval is invalid or exceeds 30 seconds")
        path = local_media_path(media.file_relative_path)
        extract_audio_chunk(path, output, start, end-start)
        from backend.app.services.prosody import analyze_audio, VERSION
        digest = hashlib.sha256()
        with output.open("rb") as source:
            for chunk in iter(lambda: source.read(65536), b""):
                digest.update(chunk)
        clip_hash = digest.hexdigest()
        signature = hashlib.sha256(json.dumps({"clip_sha256": clip_hash, "start": start,
            "end": end, "text": text, "feature_version": VERSION,
            "sample_rate": 16000, "pitch_floor": 50, "pitch_ceiling": 600}, sort_keys=True).encode()).hexdigest()
        cached = session.get(ReferenceAnalysisCache, segment_id)
        cache_hit = cached is not None and cached.source_signature == signature
        changed = cached is not None and not cache_hit
        features = json.loads(cached.features_json) if cache_hit else analyze_audio(output)
        words_json = segment.reference_words_json
        words_version = segment.reference_words_version
        if cache_hit:
            words_json, words_version = cached.words_json, cached.words_version
        elif words_json is None or changed:
            words_json, words_version = None, None
            transcription = whisper_engine.transcribe(output, language="en")
            from backend.app.services.assessment import assess_shadowing
            assessment = assess_shadowing(text, None, end-start, transcription["text"], transcription["words"])
            if (assessment["word_match_score"] or 0) >= 90:
                words = words_in_window(transcription["words"], 0, end-start, start)
                if words:
                    words_json = json.dumps(words)
                    words_version = "recovered-asr-v1:" + transcription["model_name"]
        segment.reference_words_json = words_json
        segment.reference_words_version = words_version
        words = json.loads(words_json) if words_json else []
        segment.reference_speech_seconds = words[-1]["end"]-words[0]["start"] if words else None
        cached = cached or ReferenceAnalysisCache(segment_id=segment_id, source_signature=signature, features_json="{}")
        cached.source_signature = signature
        cached.features_json = json.dumps(features, allow_nan=False)
        cached.words_json, cached.words_version = words_json, words_version
        session.add(segment)
        session.add(cached)
        session.commit()
        return {"type": "imported_local_video", "start_seconds": start, "end_seconds": end,
                "clip_sha256": clip_hash, "features_version": VERSION, "features": features,
                "word_timing_source": words_version,
                "quality": "unknown", "speaker_count": None}
