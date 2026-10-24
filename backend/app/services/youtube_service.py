import os
import re
import urllib.parse
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
import yt_dlp
from youtube_transcript_api import (
    YouTubeTranscriptApi,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
    IpBlocked,
    RequestBlocked,
    YouTubeRequestFailed,
    YouTubeTranscriptApiException,
)
from sqlmodel import Session
from backend.app.config import BACKEND_DIR, settings
from backend.app.database import engine as default_engine
from backend.app.errors import AppException
from backend.app.models import Segment, Video, utc_now
from backend.app.services.segmenter import RawFragment, segment_fragments, segment_asr_result
from backend.app.services.whisper_engine import whisper_engine

YOUTUBE_ID_REGEX = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_HOSTNAMES = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

def parse_youtube_url(url: str) -> str:
    """
    Validate and extract the 11-character YouTube video ID from a URL according to Section 6.2.

    Raises:
        AppException(422, "INVALID_YOUTUBE_URL") on invalid, hostile, or unsupported formats.
    """
    if not url or not isinstance(url, str):
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="Paste a supported YouTube video URL.",
            status_code=422,
        )

    clean_url = url.strip()
    if len(clean_url) > 2048:
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="URL exceeds maximum length of 2048 characters.",
            status_code=422,
        )

    try:
        parsed = urllib.parse.urlsplit(clean_url)
    except Exception:
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="Could not parse YouTube URL.",
            status_code=422,
        )

    # 1. Scheme validation: only http/https
    if parsed.scheme.lower() not in ("http", "https"):
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="Only HTTP and HTTPS URLs are supported.",
            status_code=422,
        )

    # 2. Reject credentials in URL
    if parsed.username or parsed.password:
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="User credentials in YouTube URLs are prohibited.",
            status_code=422,
        )

    # 3. Port validation: explicit ports other than 80/443 prohibited
    if parsed.port and parsed.port not in (80, 443):
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="Custom network ports are not permitted.",
            status_code=422,
        )

    # 4. Exact hostname validation (prevent hostile subdomains/suffixes)
    raw_host = (parsed.hostname or "").lower().strip()
    if raw_host not in ALLOWED_HOSTNAMES:
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message=f"Hostname '{raw_host}' is not a supported YouTube domain.",
            status_code=422,
        )

    path = parsed.path.strip()
    youtube_id: Optional[str] = None

    # 5. Extract ID based on domain & path
    if raw_host in ("youtu.be", "www.youtu.be"):
        # youtu.be/<id>
        path_segments = [seg for seg in path.split("/") if seg]
        if not path_segments:
            raise AppException(
                code="INVALID_YOUTUBE_URL",
                message="Missing video ID in youtu.be URL.",
                status_code=422,
            )
        if path_segments[0].lower() == "playlist":
            raise AppException(
                code="INVALID_YOUTUBE_URL",
                message="Standalone playlist URLs are not supported.",
                status_code=422,
            )
        youtube_id = path_segments[0]

    else:
        # youtube.com formats: watch?v=ID, /shorts/ID, /embed/ID
        if path.lower() == "/playlist":
            raise AppException(
                code="INVALID_YOUTUBE_URL",
                message="Standalone playlist URLs are not supported. Paste a video URL.",
                status_code=422,
            )

        if path.lower() == "/watch":
            query_params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            v_values = query_params.get("v")
            if not v_values or not v_values[0]:
                raise AppException(
                    code="INVALID_YOUTUBE_URL",
                    message="Missing 'v' parameter in YouTube watch URL.",
                    status_code=422,
                )
            # Check for conflicting multiple 'v' parameters
            unique_v = set(v_values)
            if len(unique_v) > 1:
                raise AppException(
                    code="INVALID_YOUTUBE_URL",
                    message="Conflicting 'v' parameters detected in URL.",
                    status_code=422,
                )
            youtube_id = v_values[0]

        elif path.lower().startswith("/shorts/"):
            segments = [seg for seg in path.split("/") if seg]
            if len(segments) >= 2:
                youtube_id = segments[1]

        elif path.lower().startswith("/embed/"):
            segments = [seg for seg in path.split("/") if seg]
            if len(segments) >= 2:
                youtube_id = segments[1]

        else:
            raise AppException(
                code="INVALID_YOUTUBE_URL",
                message=f"Unsupported YouTube URL path '{path}'.",
                status_code=422,
            )

    # 6. Validate extracted ID with exact regex
    if not youtube_id or not YOUTUBE_ID_REGEX.match(youtube_id):
        raise AppException(
            code="INVALID_YOUTUBE_URL",
            message="Extracted YouTube ID is invalid. Must be exactly 11 characters.",
            status_code=422,
            details={"extracted_id": youtube_id},
        )

    return youtube_id

def build_canonical_youtube_url(youtube_id: str) -> str:
    """Construct sanitized canonical URL for downloader consumption."""
    if not YOUTUBE_ID_REGEX.match(youtube_id):
        raise ValueError(f"Invalid YouTube ID: {youtube_id}")
    return f"https://www.youtube.com/watch?v={youtube_id}"

def fetch_video_metadata(youtube_id: str) -> Dict[str, Any]:
    """
    Fetch metadata using yt-dlp in metadata-only mode without downloading media.
    Validates duration and rejects live streams according to Section 6.3.
    """
    canonical_url = build_canonical_youtube_url(youtube_id)
    ydl_opts = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "socket_timeout": 15,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(canonical_url, download=False)
    except Exception as exc:
        raise AppException(
            code="VIDEO_UNAVAILABLE",
            message=f"YouTube video could not be loaded: {str(exc)}",
            status_code=404,
            retryable=False,
        )

    if not info:
        raise AppException(
            code="VIDEO_NOT_FOUND",
            message="No metadata returned for video.",
            status_code=404,
        )

    # Reject active live stream
    if info.get("is_live") or info.get("live_status") == "is_live":
        raise AppException(
            code="LIVE_STREAM_UNSUPPORTED",
            message="Active live streams are not supported.",
            status_code=400,
            retryable=False,
        )

    # Validate duration
    duration = info.get("duration")
    if duration is None or duration <= 0:
        raise AppException(
            code="INVALID_VIDEO_METADATA",
            message="Video duration is invalid or unknown.",
            status_code=400,
            retryable=False,
        )

    if duration > 1800:
        raise AppException(
            code="VIDEO_TOO_LONG",
            message="Video duration exceeds maximum limit of 30 minutes (1800 seconds).",
            status_code=400,
            retryable=False,
            details={"duration_seconds": duration, "max_seconds": 1800},
        )

    return {
        "youtube_id": youtube_id,
        "title": info.get("title") or "Untitled Video",
        "channel": info.get("channel") or info.get("uploader"),
        "duration": float(duration),
    }

def fetch_video_subtitles(youtube_id: str) -> Tuple[List[RawFragment], str]:
    """
    Fetch English subtitles (manual English preferred, then auto English).
    Returns (raw_fragments, transcription_source).
    """
    ytt = YouTubeTranscriptApi()
    try:
        transcript_list = ytt.list(youtube_id)
    except (NoTranscriptFound, TranscriptsDisabled):
        raise AppException(
            code="SUBTITLES_NOT_FOUND",
            message="Este video no tiene subtítulos en inglés. V1 no transcribe automáticamente.",
            status_code=404,
            retryable=False,
        )
    except (VideoUnavailable, VideoUnplayable):
        raise AppException(
            code="VIDEO_NOT_FOUND",
            message="Video is unavailable or private.",
            status_code=404,
            retryable=False,
        )
    except (IpBlocked, RequestBlocked, YouTubeRequestFailed):
        raise AppException(
            code="RATE_LIMITED",
            message="YouTube rate limit or block encountered. Please retry later.",
            status_code=429,
            retryable=True,
        )
    except Exception as exc:
        raise AppException(
            code="SUBTITLES_FETCH_FAILED",
            message=f"Failed to retrieve subtitles: {str(exc)}",
            status_code=502,
            retryable=True,
        )

    manual_en = None
    auto_en = None

    for transcript in transcript_list:
        lang = transcript.language_code.lower()
        if lang == "en" or lang.startswith("en-"):
            if not transcript.is_generated and manual_en is None:
                manual_en = transcript
            elif transcript.is_generated and auto_en is None:
                auto_en = transcript

    if manual_en is not None:
        target = manual_en
        source = "captions_manual"
    elif auto_en is not None:
        target = auto_en
        source = "captions_auto"
    else:
        raise AppException(
            code="SUBTITLES_NOT_FOUND",
            message="Este video no tiene subtítulos en inglés. V1 no transcribe automáticamente.",
            status_code=404,
            retryable=False,
        )

    try:
        raw_items = target.fetch()
    except Exception as exc:
        raise AppException(
            code="SUBTITLES_FETCH_FAILED",
            message=f"Failed fetching subtitle items: {str(exc)}",
            status_code=502,
            retryable=True,
        )

    raw_fragments: List[RawFragment] = []
    for item in raw_items:
        text = getattr(item, "text", None) or (item.get("text", "") if isinstance(item, dict) else "")
        start = getattr(item, "start", None) if getattr(item, "start", None) is not None else (item.get("start", 0.0) if isinstance(item, dict) else 0.0)
        dur = getattr(item, "duration", None) if getattr(item, "duration", None) is not None else (item.get("duration", 0.0) if isinstance(item, dict) else 0.0)
        start_flt = round(float(start), 3)
        end_flt = round(start_flt + float(dur), 3)
        raw_fragments.append(
            RawFragment(
                start_seconds=start_flt,
                end_seconds=end_flt,
                text=str(text),
            )
        )

    if not raw_fragments:
        raise AppException(
            code="SUBTITLES_NOT_FOUND",
            message="Este video no tiene subtítulos en inglés. V1 no transcribe automáticamente.",
            status_code=404,
            retryable=False,
        )

    return raw_fragments, source

def download_youtube_audio(youtube_id: str) -> Path:
    """
    Download audio for a YouTube video using yt-dlp according to Section 6.5.
    Stores audio under MEDIA_ROOT/audio/<youtube_id>.<ext>.
    Reuses existing cached audio if present.
    Enforces atomic write and max file size limits.
    """
    media_root = Path(settings.MEDIA_ROOT)
    if not media_root.is_absolute():
        media_root = BACKEND_DIR / media_root

    audio_dir = media_root / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    # 1. Check existing cached audio
    for existing in audio_dir.glob(f"{youtube_id}.*"):
        if existing.is_file() and existing.stat().st_size > 0:
            return existing

    # 2. Prepare temp template
    part_id = uuid.uuid4().hex[:8]
    tmp_template = str(audio_dir / f"{youtube_id}_{part_id}.part.%(ext)s")
    canonical_url = build_canonical_youtube_url(youtube_id)

    ydl_opts = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": tmp_template,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "max_filesize": settings.MAX_SOURCE_AUDIO_BYTES,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([canonical_url])
    except Exception as exc:
        for f in audio_dir.glob(f"{youtube_id}_{part_id}.part*"):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass
        raise AppException(
            code="AUDIO_DOWNLOAD_FAILED",
            message=f"Failed to download audio for YouTube video: {str(exc)}",
            status_code=502,
            retryable=True,
            details={"youtube_id": youtube_id, "error": str(exc)},
        )

    downloaded_files = list(audio_dir.glob(f"{youtube_id}_{part_id}.part.*"))
    if not downloaded_files:
        raise AppException(
            code="AUDIO_DOWNLOAD_FAILED",
            message="Audio download completed but target audio file was not found.",
            status_code=502,
            retryable=True,
        )

    part_file = downloaded_files[0]
    file_ext = part_file.suffix.lower()
    final_path = audio_dir / f"{youtube_id}{file_ext}"

    # Atomic rename
    part_file.replace(final_path)

    if not final_path.exists() or final_path.stat().st_size == 0:
        raise AppException(
            code="AUDIO_DOWNLOAD_FAILED",
            message="Downloaded audio file was empty.",
            status_code=502,
            retryable=True,
        )

    return final_path

def handle_ingest_job(
    job_id: str,
    payload: Dict[str, Any],
    update_progress: Callable[[Optional[str], Optional[float]], None],
    engine=None,
) -> Dict[str, Any]:
    """
    Background worker handler for 'ingest' jobs.
    Performs metadata retrieval, subtitle extraction (with fallback to local ASR per Section 6.3),
    deterministic segmentation, and atomic persistence.
    """
    youtube_id = payload["youtube_id"]
    force_gpu_whisper = payload.get("force_gpu_whisper", False)
    active_engine = engine or default_engine

    # Stage 1: Metadata (10%)
    update_progress("metadata", 0.10)
    metadata = fetch_video_metadata(youtube_id)

    raw_fragments: Optional[List[RawFragment]] = None
    source: Optional[str] = None
    segments = None
    audio_rel_path: Optional[str] = None

    # Step 2: Try subtitles first unless force_gpu_whisper was requested
    if not force_gpu_whisper:
        try:
            update_progress("captions", 0.35)
            raw_fragments, source = fetch_video_subtitles(youtube_id)
            update_progress("segmenting", 0.70)
            segments = segment_fragments(raw_fragments, max_duration=metadata["duration"])
        except AppException as exc:
            # Fallback to local ASR if subtitles were not found or disabled
            if exc.code in ("SUBTITLES_NOT_FOUND", "VIDEO_NOT_FOUND"):
                raw_fragments = None
                source = None
            else:
                raise exc

    # Step 3: Local ASR fallback (missing subtitles OR force_gpu_whisper)
    if segments is None:
        # Stage 2b: downloading_audio (25%)
        update_progress("downloading_audio", 0.25)
        audio_path = download_youtube_audio(youtube_id)
        audio_rel_path = f"audio/{audio_path.name}"

        # Stage 2c: loading_model (50%)
        update_progress("loading_model", 0.50)
        whisper_engine.load_model()

        # Stage 2d: transcribing (75%)
        update_progress("transcribing", 0.75)
        asr_result = whisper_engine.transcribe(audio_path, language="en")

        # Stage 2e: segmenting (90%)
        update_progress("segmenting", 0.90)
        segments = segment_asr_result(asr_result, max_duration=metadata["duration"])
        source = "local_asr"

    if not segments:
        raise AppException(
            code="SEGMENTATION_EMPTY",
            message="Could not extract any valid practice segments.",
            status_code=422,
            retryable=False,
        )

    # Stage 4: Saving (100%) - Atomic persistence (Invariant 4.3.1)
    update_progress("saving", 1.0)
    with Session(active_engine) as session:
        video = Video(
            youtube_id=youtube_id,
            title=metadata["title"],
            channel=metadata.get("channel"),
            duration_seconds=metadata["duration"],
            transcription_source=source,
            language="en",
            created_at=utc_now(),
            audio_relative_path=audio_rel_path,
        )
        session.add(video)
        session.flush()

        for seg in segments:
            db_seg = Segment(
                video_id=video.id,
                position=seg.position,
                start_seconds=seg.start_seconds,
                end_seconds=seg.end_seconds,
                text=seg.text,
                timing_quality=seg.timing_quality,
            )
            session.add(db_seg)

        session.commit()
        session.refresh(video)
        video_id = video.id

    return {
        "video_id": video_id,
        "segment_count": len(segments),
        "transcription_source": source,
    }

