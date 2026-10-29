"""Local-only video ingestion. This module never requests YouTube or browser sessions."""
import math
import json
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Callable
from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool
from sqlmodel import Session, select
from backend.app.config import BACKEND_DIR, settings
from backend.app.database import engine as default_engine
from backend.app.errors import AppException
from backend.app.models import Video, Segment, LocalVideoMedia
from backend.app.services.audio_service import stream_and_validate_upload, probe_audio, safe_cleanup
from backend.app.services.segmenter import SegmentDraft, segment_asr_result
from backend.app.services.whisper_engine import whisper_engine

ALLOWED_EXTENSIONS = {".mp4", ".webm"}
TRANSCRIPTION_CHUNK_SECONDS = 300
_playback_lock = threading.Lock()


def media_root() -> Path:
    root = Path(settings.MEDIA_ROOT)
    return (root if root.is_absolute() else BACKEND_DIR / root).resolve()


def local_media_path(relative: str) -> Path:
    root = media_root()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise AppException(code="LOCAL_MEDIA_NOT_FOUND", message="The local video file is no longer available. Import it again.", status_code=404)
    return path


def _mp4_needs_preparation(path: Path) -> bool:
    """Inspect top-level MP4 boxes without reading the entire media payload."""
    length = path.stat().st_size
    with path.open("rb") as source:
        offset = 0
        has_metadata = False
        while offset + 8 <= length:
            source.seek(offset)
            header = source.read(8)
            size, kind = int.from_bytes(header[:4], "big"), header[4:]
            header_size = 8
            if size == 1:
                size = int.from_bytes(source.read(8), "big")
                header_size = 16
            if kind == b"moov":
                has_metadata = True
            if kind == b"moof":
                return True
            if kind == b"mdat":
                return not has_metadata
            if size < header_size or offset + size > length:
                break
            offset += size
    return False


def local_playback_path(source: Path) -> Path:
    """Cache a regular, indexed MP4 for fragmented files or trailing metadata."""
    if source.suffix.lower() != ".mp4" or not _mp4_needs_preparation(source):
        return source
    cached = source.with_suffix(".playback.mp4")
    with _playback_lock:
        if cached.is_file() and cached.stat().st_size > 0 and cached.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            return cached
        temporary = source.with_name(f"{source.stem}.{uuid.uuid4().hex}.pending.mp4")
        try:
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise OSError("FFmpeg is unavailable")
            result = subprocess.run(
                [ffmpeg, "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", str(source),
                 "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", str(temporary)],
                capture_output=True, timeout=90, check=False,
            )
            if result.returncode or not temporary.is_file() or temporary.stat().st_size == 0 or _mp4_needs_preparation(temporary):
                raise OSError("Fast-start preparation failed")
            temporary.replace(cached)
            return cached
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise AppException(code="LOCAL_PLAYBACK_PREPARATION_FAILED", message="The local video could not be prepared for playback. Your original file and practice progress are saved. Try opening it again.", status_code=503, retryable=True) from exc
        finally:
            safe_cleanup(temporary)


async def prepare_local_upload(file: UploadFile, file_id: str) -> dict:
    filename = (file.filename or "video.mp4").replace("\\", "/").split("/")[-1]
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise AppException(code="UNSUPPORTED_VIDEO", message="Choose an MP4 or WebM video with English speech.", status_code=415)
    raw = None
    try:
        raw = await stream_and_validate_upload(file, file_id, max_bytes=settings.MAX_SOURCE_AUDIO_BYTES)
        probe = await run_in_threadpool(probe_audio, raw)
        streams = probe.get("streams", [])
        if not any(stream.get("codec_type") == "video" for stream in streams):
            raise AppException(code="UNSUPPORTED_VIDEO", message="This file has no video track. Choose an MP4 or WebM video.", status_code=415)
        video_codecs = {s.get("codec_name") for s in streams if s.get("codec_type") == "video"}
        if not video_codecs.intersection({"h264", "vp8", "vp9", "av1"}):
            raise AppException(code="UNSUPPORTED_VIDEO", message="This video uses a codec the browser may not play. Export it as MP4 (H.264) or WebM and try again.", status_code=415)
        try:
            duration = float(probe.get("format", {}).get("duration", 0))
        except (TypeError, ValueError):
            duration = 0
        if not math.isfinite(duration) or duration <= 0:
            raise AppException(code="INVALID_VIDEO_METADATA", message="The video duration could not be read.", status_code=422)
        if duration > settings.MAX_VIDEO_SECONDS:
            raise AppException(code="VIDEO_TOO_LONG", message=f"Choose a video no longer than {settings.MAX_VIDEO_SECONDS / 60:g} minutes.", status_code=422, details={"duration_seconds": duration, "max_seconds": settings.MAX_VIDEO_SECONDS})
        relative = f"local/{file_id}{extension}"
        destination = media_root() / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        raw.replace(destination)
        return {"file_relative_path": relative, "duration": duration, "title": Path(filename).stem[:200] or "Local video", "source_key": f"local:{file_id}"}
    finally:
        safe_cleanup(raw)
        await file.close()


def extract_audio_chunk(source: Path, output: Path, start: float, duration: float) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AppException(code="FFMPEG_UNAVAILABLE", message="Local audio processing is unavailable. Install FFmpeg and continue this import.", status_code=503)
    try:
        result = subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-y", "-ss", str(start), "-protocol_whitelist", "file,pipe", "-i", str(source), "-t", str(duration), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(output)], capture_output=True, timeout=90, check=False)
    except (subprocess.TimeoutExpired, OSError) as exc:
        raise AppException(code="LOCAL_AUDIO_FAILED", message="This part of the video could not be prepared. Your file and completed parts are saved; try continuing the import.", status_code=503) from exc
    if result.returncode or not output.is_file() or output.stat().st_size == 0:
        raise AppException(code="LOCAL_AUDIO_FAILED", message="This part of the video could not be decoded. Your file and completed parts are saved.", status_code=422)


def transcribe_local_video(path: Path, duration: float, update_progress: Callable) -> list[SegmentDraft]:
    """Save each completed five-minute part atomically, then resume at the next part."""
    checkpoint_path = path.with_suffix(".transcript.json")
    scratch = path.with_suffix(".chunk.wav")
    total_parts = max(1, math.ceil(duration / TRANSCRIPTION_CHUNK_SECONDS))
    signature = {"size": path.stat().st_size, "mtime_ns": path.stat().st_mtime_ns, "duration": duration, "chunk_seconds": TRANSCRIPTION_CHUNK_SECONDS}
    next_part = 0
    segments: list[SegmentDraft] = []
    try:
        saved = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        if saved.get("version") == 1 and saved.get("source") == signature and isinstance(saved.get("next_part"), int) and 0 <= saved["next_part"] <= total_parts:
            segments = [SegmentDraft.model_validate(item) for item in saved["segments"]]
            next_part = saved["next_part"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    if next_part < total_parts:
        update_progress("loading_model", 0.1 + 0.75 * next_part / total_parts)
        whisper_engine.load_model()
    for index in range(next_part, total_parts):
        offset = index * TRANSCRIPTION_CHUNK_SECONDS
        part_duration = min(TRANSCRIPTION_CHUNK_SECONDS, duration - offset)
        update_progress(f"Transcribing part {index + 1} of {total_parts}...", 0.1 + 0.75 * index / total_parts)
        try:
            audio_path = path
            if total_parts > 1:
                extract_audio_chunk(path, scratch, offset, part_duration)
                audio_path = scratch
            result = whisper_engine.transcribe(audio_path, language="en")
            for segment in segment_asr_result(result, max_duration=part_duration):
                segment.start_seconds = round(segment.start_seconds + offset, 3)
                segment.end_seconds = round(segment.end_seconds + offset, 3)
                segment.position = len(segments)
                segments.append(segment)
            checkpoint = {"version": 1, "source": signature, "next_part": index + 1, "segments": [s.model_dump() for s in segments]}
            temporary = checkpoint_path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(checkpoint, ensure_ascii=False), encoding="utf-8")
            temporary.replace(checkpoint_path)
            update_progress(f"Saved part {index + 1} of {total_parts}", 0.1 + 0.75 * (index + 1) / total_parts)
        finally:
            safe_cleanup(scratch)
    return segments


def handle_local_ingest_job(job_id: str, payload: dict, update_progress: Callable, engine=None) -> dict:
    active_engine = engine or default_engine
    # A process can stop after the video commit but before its job is marked complete.
    with Session(active_engine) as session:
        existing = session.exec(select(Video).where(Video.youtube_id == payload["source_key"])).first()
        if existing:
            return {"video_id": existing.id, "segment_count": len(existing.segments), "transcription_source": existing.transcription_source}
    path = local_media_path(payload["file_relative_path"])
    segments = transcribe_local_video(path, payload["duration"], update_progress)
    if not segments:
        raise AppException(code="SEGMENTATION_EMPTY", message="No English speech was found. Try a video with clear spoken English.", status_code=422)
    update_progress("saving", 0.95)
    with Session(active_engine) as session:
        video = Video(youtube_id=payload["source_key"], title=payload["title"], channel="Local video", duration_seconds=payload["duration"], transcription_source="local_asr", audio_relative_path=payload["file_relative_path"])
        session.add(video)
        session.flush()
        session.add(LocalVideoMedia(video_id=video.id, file_relative_path=payload["file_relative_path"]))
        for item in segments:
            session.add(Segment(video_id=video.id, position=item.position, start_seconds=item.start_seconds, end_seconds=item.end_seconds, text=item.text, timing_quality=item.timing_quality))
        session.commit()
        result = {"video_id": video.id, "segment_count": len(segments), "transcription_source": "local_asr"}
    safe_cleanup(path.with_suffix(".transcript.json"))
    return result
