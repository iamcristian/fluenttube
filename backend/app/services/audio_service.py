import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from fastapi import UploadFile
from backend.app.config import BACKEND_DIR, settings
from backend.app.errors import AppException

logger = logging.getLogger(__name__)

TEMP_DIR = BACKEND_DIR / "data" / "temp"

# Permitted audio containers / format names from ffprobe
ALLOWED_CONTAINER_PATTERNS = [
    "webm",
    "matroska",
    "ogg",
    "wav",
    "mp4",
    "m4a",
    "aac",
    "flac",
]

def ensure_temp_dir() -> Path:
    """Ensure the temporary audio directory exists and return its path."""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    return TEMP_DIR

def safe_cleanup(*paths: Optional[Path]) -> None:
    """Safely delete temporary files, suppressing errors."""
    for path in paths:
        if path is not None and isinstance(path, Path):
            try:
                if path.is_file():
                    path.unlink(missing_ok=True)
                elif path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
            except Exception as e:
                logger.warning(f"Failed to remove temporary file {path}: {e}")

async def stream_and_validate_upload(
    audio_file: UploadFile,
    file_id: str,
    max_bytes: int = settings.MAX_RECORDING_BYTES,
) -> Path:
    """
    Stream and write an uploaded audio file to a safe UUID-keyed path in chunks.
    Enforces maximum size limit and zero-byte check during streaming.
    Never uses client-supplied filenames.
    """
    temp_dir = ensure_temp_dir()
    # Explicitly use UUID file_id, never trusting or using client-supplied filename
    raw_path = temp_dir / f"{file_id}.raw"

    total_bytes = 0
    chunk_size = 65536  # 64 KB

    try:
        with open(raw_path, "wb") as f:
            while True:
                chunk = await audio_file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    f.close()
                    safe_cleanup(raw_path)
                    raise AppException(
                        code="AUDIO_TOO_LARGE",
                        message=f"Audio file exceeds maximum allowed size of {max_bytes // (1024 * 1024)} MiB.",
                        status_code=413,
                        details={"max_bytes": max_bytes, "bytes_received": total_bytes},
                    )
                f.write(chunk)

        if total_bytes == 0:
            safe_cleanup(raw_path)
            raise AppException(
                code="EMPTY_AUDIO",
                message="Uploaded audio file contains zero bytes.",
                status_code=422,
            )

        return raw_path
    except AppException:
        raise
    except Exception as e:
        safe_cleanup(raw_path)
        logger.error(f"Error while reading audio upload stream: {e}", exc_info=True)
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message=f"Failed to read audio upload stream: {str(e)}",
            status_code=415,
        )

def probe_audio(raw_path: Path) -> Dict[str, Any]:
    """
    Use ffprobe to inspect audio container, streams, and duration.
    Verifies that the file contains a valid audio stream in an allowed container.
    """
    ffprobe_bin = shutil.which("ffprobe")
    if not ffprobe_bin:
        raise AppException(
            code="FFMPEG_UNAVAILABLE",
            message="ffprobe binary is not installed or not found in system PATH.",
            status_code=500,
        )

    cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name:stream=codec_name,codec_type,duration",
        "-of",
        "json",
        str(raw_path),
    ]

    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="ffprobe timed out while analyzing audio file.",
            status_code=415,
        )
    except Exception as e:
        logger.error(f"Failed to execute ffprobe: {e}", exc_info=True)
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="Failed to execute media probe on audio payload.",
            status_code=415,
        )

    if result.returncode != 0:
        logger.warning(f"ffprobe rejected input: {result.stderr.strip()}")
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="Media container could not be parsed as valid audio.",
            status_code=415,
            details={"ffprobe_error": result.stderr.strip()[:200]},
        )

    try:
        probe_data = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="Invalid probe response from ffprobe.",
            status_code=415,
        )

    # 1. Container allowlist check
    format_info = probe_data.get("format", {})
    format_name = (format_info.get("format_name") or "").lower()
    is_allowed = any(pattern in format_name for pattern in ALLOWED_CONTAINER_PATTERNS)
    if not is_allowed:
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message=f"Unsupported audio container: '{format_name}'. Allowed: WebM, OGG, WAV, MP4/M4A.",
            status_code=415,
            details={"format_name": format_name},
        )

    # 2. Must contain an audio stream
    streams = probe_data.get("streams", [])
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    if not audio_streams:
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="Uploaded file does not contain an audio stream.",
            status_code=415,
        )

    return probe_data

def convert_to_pcm16k_mono(
    raw_path: Path,
    output_wav_path: Path,
    min_duration: float = 0.5,
    max_duration: float = 30.5,
) -> float:
    """
    Validate and transcode audio to 16 kHz mono 16-bit PCM WAV using ffmpeg.
    Measures decoded duration and enforces 0.5s - 30.5s duration limits.
    """
    # 1. Preliminary format probe
    probe_audio(raw_path)

    # 2. Check ffmpeg availability
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise AppException(
            code="FFMPEG_UNAVAILABLE",
            message="ffmpeg binary is not installed or not found in system PATH.",
            status_code=500,
        )

    # 3. Transcode to PCM mono 16 kHz WAV with distinct argument list (Section 10.2)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(raw_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_wav_path),
    ]

    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired:
        safe_cleanup(output_wav_path)
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="FFmpeg timed out after 30 seconds while converting audio.",
            status_code=415,
        )
    except Exception as e:
        safe_cleanup(output_wav_path)
        logger.error(f"FFmpeg execution failed: {e}", exc_info=True)
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message=f"Failed to execute audio transcode: {str(e)}",
            status_code=415,
        )

    if proc.returncode != 0 or not output_wav_path.exists() or output_wav_path.stat().st_size == 0:
        safe_cleanup(output_wav_path)
        logger.warning(f"FFmpeg failed with code {proc.returncode}: {proc.stderr.strip()}")
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="FFmpeg failed to convert audio to 16 kHz mono WAV.",
            status_code=415,
            details={"ffmpeg_error": proc.stderr.strip()[:300]},
        )

    # 4. Measure actual decoded duration of the generated WAV file with ffprobe
    ffprobe_bin = shutil.which("ffprobe")
    probe_cmd = [
        ffprobe_bin,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(output_wav_path),
    ]

    try:
        probe_res = subprocess.run(
            probe_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
            check=False,
        )
        duration_str = probe_res.stdout.strip()
        decoded_duration = float(duration_str)
    except Exception as e:
        safe_cleanup(output_wav_path)
        logger.error(f"Failed to measure decoded duration: {e}")
        raise AppException(
            code="UNSUPPORTED_AUDIO",
            message="Failed to determine decoded audio duration.",
            status_code=415,
        )

    # 5. Enforce duration boundaries per Section 10.2
    if decoded_duration < min_duration:
        safe_cleanup(output_wav_path)
        raise AppException(
            code="AUDIO_TOO_SHORT",
            message=f"Audio duration ({decoded_duration:.2f}s) is too short. Minimum duration is {min_duration} seconds.",
            status_code=422,
            details={"duration_seconds": decoded_duration, "min_seconds": min_duration},
        )

    if decoded_duration > max_duration:
        safe_cleanup(output_wav_path)
        raise AppException(
            code="AUDIO_TOO_LONG",
            message=f"Audio duration ({decoded_duration:.2f}s) exceeds maximum allowed duration of {max_duration} seconds.",
            status_code=422,
            details={"duration_seconds": decoded_duration, "max_seconds": max_duration},
        )

    return decoded_duration
