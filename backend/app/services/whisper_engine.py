import gc
import logging
import os
import shutil
import site
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

from backend.app.config import BACKEND_DIR, settings
from backend.app.errors import AppException

logger = logging.getLogger(__name__)

def _ensure_nvidia_dll_paths() -> None:
    """
    On Windows, register NVIDIA wheel DLL directories (cublas, cudnn, nvrtc)
    so CTranslate2 / CUDA 12 can locate cublas64_12.dll and cudnn64_9.dll seamlessly.
    """
    if os.name != "nt":
        return

    try:
        for site_pkg in site.getsitepackages():
            nvidia_root = Path(site_pkg) / "nvidia"
            if nvidia_root.exists():
                for sub in nvidia_root.iterdir():
                    for candidate in ["bin", "lib"]:
                        bin_dir = sub / candidate
                        if bin_dir.is_dir():
                            try:
                                os.add_dll_directory(str(bin_dir))
                            except Exception:
                                pass
                            current_path = os.environ.get("PATH", "")
                            if str(bin_dir) not in current_path:
                                os.environ["PATH"] = f"{str(bin_dir)};{current_path}"
    except Exception as e:
        logger.debug(f"Failed to scan/register NVIDIA DLL directories: {e}")

# Register DLL paths early at module import
_ensure_nvidia_dll_paths()


class WhisperEngine:
    """
    Singleton service managing the faster-whisper local ASR model.
    Enforces:
    - Lazy loading protected by thread locks (health queries never load the model)
    - Consecutive evaluations reuse the warm model instance
    - Maximum inference concurrency of 1 (in-service lock)
    - Policy for auto/cuda/cpu device modes per Section 10.3
    - Exactly one model resident in memory at any time (never two models concurrently)
    - Automatic single-attempt CPU fallback in 'auto' mode if CUDA initialization or OOM occurs
    - Strict prohibition of silent CPU downgrades when 'cuda' is explicitly requested
    - Full generator consumption with word timestamps extraction
    - Section 10.3 telemetry logging (model, device, compute_type, audio duration, inference time)
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._model: Any = None
        self._state: str = "unloaded"  # unloaded | loading | ready | unavailable
        self._device: Optional[str] = None
        self._model_name: Optional[str] = None
        self._compute_type: Optional[str] = None
        self._fallback_active: bool = False
        self._fallback_reason: Optional[str] = None
        self._gpu_name: Optional[str] = None
        self._last_error: Optional[str] = None
        self._mock_transcriber: Optional[Callable[[str, Dict[str, Any]], Dict[str, Any]]] = None

    def _query_gpu_diagnostics(self) -> Dict[str, Any]:
        """Non-blocking query for GPU name and free VRAM via nvidia-smi."""
        try:
            res = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.free",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=2,
            )
            lines = res.stdout.strip().split("\n")
            if lines and lines[0]:
                parts = [p.strip() for p in lines[0].split(",")]
                gpu_name = parts[0] if len(parts) > 0 else None
                vram_free = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
                return {"gpu_name": gpu_name, "free_vram_mb": vram_free}
        except Exception:
            pass
        return {"gpu_name": None, "free_vram_mb": None}

    def get_health_status(self) -> Dict[str, Any]:
        """
        Return the current state of the speech engine for /api/health.
        CRITICAL: Never initializes or loads the model during health check.
        """
        gpu_info = self._query_gpu_diagnostics()
        if gpu_info.get("gpu_name"):
            self._gpu_name = gpu_info["gpu_name"]

        return {
            "state": self._state,
            "device": self._device,
            "model": self._model_name,
            "compute_type": self._compute_type,
            "gpu_name": self._gpu_name or gpu_info.get("gpu_name"),
            "free_vram_mb": gpu_info.get("free_vram_mb"),
            "last_error": self._last_error,
        }

    def set_mock_transcriber(
        self,
        transcriber: Optional[Callable[[str, Dict[str, Any]], Dict[str, Any]]],
    ) -> None:
        """Inject a mock transcriber for fast, isolated testing without downloading models."""
        with self._lock:
            self._mock_transcriber = transcriber
            if transcriber is not None:
                self._state = "ready"
                self._device = "cpu"
                self._model_name = "mock_model"
                self._compute_type = "int8"
            else:
                self._state = "unloaded"
                self._device = None
                self._model_name = None
                self._compute_type = None

    def _unload_resident_model(self) -> None:
        """
        Helper ensuring exactly one model is resident in memory.
        Dereferences the existing model and triggers immediate garbage collection.
        """
        if self._model is not None:
            self._model = None
            gc.collect()
            logger.info("Unloaded resident WhisperModel instance and triggered garbage collection.")

    def load_model(
        self,
        device: Optional[str] = None,
        model_name: Optional[str] = None,
        compute_type: Optional[str] = None,
    ) -> Any:
        """
        Thread-safe lazy model loader adhering to Section 10.3:
        - Exactly one model resident in memory (previous model unloaded before new allocation)
        - Warm instance reuse when parameters match
        - Modes:
          * 'cpu': loads CPU model without attempting CUDA
          * 'cuda': mandatory GPU; fails with diagnostic error on CUDA failure, no silent downgrade
          * 'auto': attempts CUDA; if unavailable/fails, releases failed model and falls back to CPU
        """
        with self._lock:
            req_device = (device or settings.SPEECH_DEVICE).lower()

            cache_dir = Path(settings.MODEL_CACHE_DIR)
            if not cache_dir.is_absolute():
                cache_dir = BACKEND_DIR / cache_dir
            cache_dir.mkdir(parents=True, exist_ok=True)

            from faster_whisper import WhisperModel
            import ctranslate2

            # =========================================================================
            # Case 1: Explicit CPU Mode
            # =========================================================================
            if req_device == "cpu":
                target_model = model_name or settings.SPEECH_CPU_MODEL or "base.en"
                target_compute = compute_type or settings.SPEECH_CPU_COMPUTE_TYPE or "int8"

                # Check warm reuse
                if (
                    self._model is not None
                    and self._state == "ready"
                    and self._device == "cpu"
                    and self._model_name == target_model
                    and self._compute_type == target_compute
                ):
                    logger.info(f"Reusing warm CPU WhisperModel instance ({target_model}, {target_compute})")
                    return self._model

                self._unload_resident_model()
                self._state = "loading"
                self._last_error = None

                try:
                    logger.info(f"Loading faster-whisper model '{target_model}' on CPU (compute_type={target_compute})...")
                    model = WhisperModel(
                        model_size_or_path=target_model,
                        device="cpu",
                        compute_type=target_compute,
                        download_root=str(cache_dir),
                    )
                    self._model = model
                    self._state = "ready"
                    self._device = "cpu"
                    self._model_name = target_model
                    self._compute_type = target_compute
                    self._fallback_active = False
                    logger.info(f"Successfully loaded WhisperModel '{target_model}' on CPU.")
                    return self._model
                except Exception as e:
                    self._model = None
                    self._state = "unavailable"
                    self._last_error = str(e)
                    gc.collect()
                    logger.error(f"Failed to load CPU model '{target_model}': {e}", exc_info=True)
                    raise AppException(
                        code="MODEL_UNAVAILABLE",
                        message=f"Failed to load CPU speech recognition model '{target_model}': {e}",
                        status_code=500,
                        details={"model": target_model, "device": "cpu", "compute_type": target_compute, "error": str(e)},
                    )

            # =========================================================================
            # Case 2: Explicit CUDA Mode (Mandatory GPU, NO silent downgrade per Sec 10.3)
            # =========================================================================
            if req_device == "cuda":
                target_model = model_name or settings.SPEECH_MODEL or "small.en"
                target_compute = compute_type or settings.SPEECH_GPU_COMPUTE_TYPE or "int8_float16"

                # Check warm reuse
                if (
                    self._model is not None
                    and self._state == "ready"
                    and self._device == "cuda"
                    and self._model_name == target_model
                    and self._compute_type == target_compute
                ):
                    logger.info(f"Reusing warm CUDA WhisperModel instance ({target_model}, {target_compute})")
                    return self._model

                self._unload_resident_model()
                self._state = "loading"
                self._last_error = None

                try:
                    cuda_count = ctranslate2.get_cuda_device_count()
                    if cuda_count == 0:
                        raise RuntimeError("No CUDA devices detected by CTranslate2 runtime")

                    logger.info(f"Loading faster-whisper model '{target_model}' on CUDA (compute_type={target_compute})...")
                    model = WhisperModel(
                        model_size_or_path=target_model,
                        device="cuda",
                        compute_type=target_compute,
                        download_root=str(cache_dir),
                    )
                    self._model = model
                    self._state = "ready"
                    self._device = "cuda"
                    self._model_name = target_model
                    self._compute_type = target_compute
                    self._fallback_active = False
                    logger.info(f"Successfully loaded WhisperModel '{target_model}' on CUDA.")
                    return self._model
                except Exception as e:
                    self._model = None
                    self._state = "unavailable"
                    self._last_error = str(e)
                    gc.collect()
                    logger.error(f"CUDA mode requested but failed to initialize: {e}", exc_info=True)
                    raise AppException(
                        code="CUDA_INITIALIZATION_FAILED",
                        message=f"GPU execution mandatory in 'cuda' mode, but CUDA initialization failed: {e}",
                        status_code=500,
                        details={"model": target_model, "device": "cuda", "compute_type": target_compute, "error": str(e)},
                    )

            # =========================================================================
            # Case 3: Auto Mode (Attempt CUDA -> Release -> Fallback to CPU if allowed)
            # =========================================================================
            target_gpu_model = model_name or settings.SPEECH_MODEL or "small.en"
            target_gpu_compute = compute_type or settings.SPEECH_GPU_COMPUTE_TYPE or "int8_float16"
            target_cpu_model = settings.SPEECH_CPU_MODEL or "base.en"
            target_cpu_compute = settings.SPEECH_CPU_COMPUTE_TYPE or "int8"

            # Check warm reuse for CUDA
            if (
                self._model is not None
                and self._state == "ready"
                and self._device == "cuda"
                and self._model_name == target_gpu_model
                and self._compute_type == target_gpu_compute
            ):
                logger.info(f"Reusing warm CUDA WhisperModel instance in auto mode ({target_gpu_model}, {target_gpu_compute})")
                return self._model

            # Check warm reuse for CPU if fallback was already engaged
            if (
                self._fallback_active
                and self._model is not None
                and self._state == "ready"
                and self._device == "cpu"
                and self._model_name == target_cpu_model
                and self._compute_type == target_cpu_compute
            ):
                logger.info(f"Reusing warm fallback CPU WhisperModel instance ({target_cpu_model}, {target_cpu_compute})")
                return self._model

            self._unload_resident_model()
            self._state = "loading"
            self._last_error = None

            # Attempt CUDA first if device count > 0
            cuda_available = False
            try:
                cuda_available = ctranslate2.get_cuda_device_count() > 0
            except Exception as e:
                logger.warning(f"Error checking CTranslate2 CUDA device count: {e}")

            if cuda_available:
                try:
                    logger.info(f"Auto mode: attempting CUDA model '{target_gpu_model}' (compute_type={target_gpu_compute})...")
                    model = WhisperModel(
                        model_size_or_path=target_gpu_model,
                        device="cuda",
                        compute_type=target_gpu_compute,
                        download_root=str(cache_dir),
                    )
                    self._model = model
                    self._state = "ready"
                    self._device = "cuda"
                    self._model_name = target_gpu_model
                    self._compute_type = target_gpu_compute
                    self._fallback_active = False
                    logger.info(f"Auto mode successfully initialized WhisperModel on CUDA ({target_gpu_model}).")
                    return self._model
                except Exception as cuda_err:
                    logger.warning(f"CUDA initialization failed in auto mode: {cuda_err}")
                    self._unload_resident_model()
                    self._last_error = str(cuda_err)

                    if not settings.SPEECH_ALLOW_CPU_FALLBACK:
                        self._state = "unavailable"
                        raise AppException(
                            code="CUDA_INITIALIZATION_FAILED",
                            message=f"CUDA initialization failed and CPU fallback is disabled: {cuda_err}",
                            status_code=500,
                            details={"model": target_gpu_model, "device": "cuda", "compute_type": target_gpu_compute, "error": str(cuda_err)},
                        )

                    logger.warning(
                        f"Engaging single-attempt CPU fallback per Section 10.3 (model='{target_cpu_model}', compute_type='{target_cpu_compute}')"
                    )
                    self._fallback_active = True
                    self._fallback_reason = str(cuda_err)

            else:
                logger.info("Auto mode: No CUDA devices detected; proceeding with CPU model.")
                self._fallback_active = True
                self._fallback_reason = "No CUDA devices detected"

            # Fallback to CPU
            try:
                logger.info(f"Loading CPU model '{target_cpu_model}' (compute_type={target_cpu_compute})...")
                cpu_model = WhisperModel(
                    model_size_or_path=target_cpu_model,
                    device="cpu",
                    compute_type=target_cpu_compute,
                    download_root=str(cache_dir),
                )
                self._model = cpu_model
                self._state = "ready"
                self._device = "cpu"
                self._model_name = target_cpu_model
                self._compute_type = target_cpu_compute
                logger.info(f"Successfully loaded fallback CPU WhisperModel '{target_cpu_model}'.")
                return self._model
            except Exception as cpu_err:
                self._model = None
                self._state = "unavailable"
                self._last_error = str(cpu_err)
                gc.collect()
                logger.error(f"CPU fallback also failed: {cpu_err}", exc_info=True)
                raise AppException(
                    code="MODEL_UNAVAILABLE",
                    message=f"Speech recognition model unavailable (CUDA and CPU fallback both failed): {cpu_err}",
                    status_code=500,
                    details={"error": str(cpu_err)},
                )

    def unload_model(self) -> None:
        """Unload active model instance and reclaim memory."""
        with self._lock:
            self._unload_resident_model()
            self._state = "unloaded"
            self._device = None
            self._model_name = None
            self._compute_type = None
            self._last_error = None
            self._fallback_active = False
            self._fallback_reason = None

    def _execute_transcription_stream(
        self,
        audio_path: Union[str, Path],
        language: str = "en",
        vad_filter: bool = True,
    ) -> Dict[str, Any]:
        """Internal worker executing transcription and fully consuming generator."""
        model = self._model
        if model is None:
            raise RuntimeError("Model is not loaded")

        start_time = time.perf_counter()

        segments_generator, info = model.transcribe(
            str(audio_path),
            language=language,
            task="transcribe",
            word_timestamps=True,
            vad_filter=vad_filter,
        )

        words_list: List[Dict[str, Any]] = []
        transcribed_segments: List[Dict[str, Any]] = []
        text_chunks: List[str] = []

        for seg in segments_generator:
            seg_text = seg.text.strip()
            if seg_text:
                text_chunks.append(seg_text)

            seg_words: List[Dict[str, Any]] = []
            if getattr(seg, "words", None):
                for w in seg.words:
                    word_item = {
                        "word": w.word.strip(),
                        "start": round(float(w.start), 3),
                        "end": round(float(w.end), 3),
                        "probability": (
                            round(float(w.probability), 4)
                            if getattr(w, "probability", None) is not None
                            else None
                        ),
                    }
                    seg_words.append(word_item)
                    words_list.append(word_item)

            transcribed_segments.append(
                {
                    "start": round(float(seg.start), 3),
                    "end": round(float(seg.end), 3),
                    "text": seg_text,
                    "words": seg_words,
                }
            )

        elapsed_time_s = time.perf_counter() - start_time
        elapsed_time_ms = round(elapsed_time_s * 1000, 2)
        full_text = " ".join(text_chunks).strip()
        audio_duration = round(float(getattr(info, "duration", 0.0)), 3)

        # Section 10.3 required logging format
        logger.info(
            f"ASR Inference Complete: model='{self._model_name}', device='{self._device}', "
            f"compute_type='{self._compute_type}', audio_duration={audio_duration}s, "
            f"inference_time={elapsed_time_ms}ms, words_detected={len(words_list)}"
        )

        return {
            "text": full_text,
            "language": getattr(info, "language", language),
            "language_probability": round(
                float(getattr(info, "language_probability", 1.0)), 4
            ),
            "duration": audio_duration,
            "words": words_list,
            "segments": transcribed_segments,
            "model_name": self._model_name,
            "device": self._device,
            "compute_type": self._compute_type,
            "inference_time_ms": elapsed_time_ms,
        }

    def transcribe(
        self,
        audio_path: Union[str, Path],
        language: str = "en",
        vad_filter: bool = True,
    ) -> Dict[str, Any]:
        """
        Execute speech recognition on the given audio file.
        Enforces:
        - In-service inference concurrency lock (= 1)
        - Off-event-loop execution (called by background job thread)
        - Generator consumption capturing iteration exceptions
        - Word timestamps extraction
        - Section 10.3 logging (model, device, compute_type, audio duration, inference time)
        - In-flight CUDA OOM / runtime recovery with CPU fallback in auto mode
        """
        path_obj = Path(audio_path)
        if not path_obj.exists() or path_obj.stat().st_size == 0:
            raise AppException(
                code="EMPTY_AUDIO",
                message=f"Audio file does not exist or is empty: {audio_path}",
                status_code=422,
            )

        with self._inference_lock:
            # Check mock transcriber override
            if self._mock_transcriber is not None:
                return self._mock_transcriber(
                    str(audio_path),
                    {"language": language, "vad_filter": vad_filter},
                )

            # Lazy load model if not yet warm
            if self._model is None:
                self.load_model()

            try:
                return self._execute_transcription_stream(audio_path, language=language, vad_filter=vad_filter)
            except Exception as e:
                # Check for in-flight CUDA runtime failure or OOM in auto mode
                is_cuda_active = (self._device == "cuda")
                is_auto_mode = (settings.SPEECH_DEVICE.lower() == "auto")

                if is_cuda_active and is_auto_mode and settings.SPEECH_ALLOW_CPU_FALLBACK:
                    logger.warning(
                        f"In-flight CUDA transcription failed ({e}); engaging single-attempt CPU fallback..."
                    )
                    self._unload_resident_model()
                    self.load_model(device="cpu", model_name=settings.SPEECH_CPU_MODEL, compute_type=settings.SPEECH_CPU_COMPUTE_TYPE)
                    self._fallback_active = True
                    self._fallback_reason = str(e)
                    try:
                        return self._execute_transcription_stream(audio_path, language=language, vad_filter=vad_filter)
                    except Exception as cpu_retry_err:
                        self._last_error = str(cpu_retry_err)
                        logger.error(f"CPU fallback transcription also failed: {cpu_retry_err}", exc_info=True)
                        raise AppException(
                            code="SPEECH_TRANSCRIPTION_FAILED",
                            message=f"Speech recognition failed on both CUDA and CPU fallback: {cpu_retry_err}",
                            status_code=500,
                            details={"audio_path": str(audio_path), "error": str(cpu_retry_err)},
                        )

                self._last_error = str(e)
                logger.error(f"Speech transcription iteration error: {e}", exc_info=True)
                raise AppException(
                    code="SPEECH_TRANSCRIPTION_FAILED",
                    message=f"Speech recognition transcription failed: {str(e)}",
                    status_code=500,
                    details={"audio_path": str(audio_path), "error": str(e)},
                )

# Global singleton engine instance
whisper_engine = WhisperEngine()
