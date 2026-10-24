import io
import time
import wave
from pathlib import Path
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.config import settings
from backend.app.errors import AppException
from backend.app.services.whisper_engine import WhisperEngine, whisper_engine

def create_synthetic_wav(duration_seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """Generate in-memory synthetic 16-bit mono PCM WAV audio."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        num_frames = int(duration_seconds * sample_rate)
        frames = b"\x00\x00" * num_frames
        wav_file.writeframes(frames)
    return buffer.getvalue()

@pytest.fixture(autouse=True)
def cleanup_whisper_state():
    """Ensure clean state before and after each test."""
    whisper_engine.set_mock_transcriber(None)
    whisper_engine.unload_model()
    yield
    whisper_engine.set_mock_transcriber(None)
    whisper_engine.unload_model()

def test_health_does_not_initialize_model():
    """Acceptance criteria: Health endpoint does not initialize model."""
    client = TestClient(app)

    # Pre-condition: model is unloaded
    assert whisper_engine._model is None
    assert whisper_engine.get_health_status()["state"] == "unloaded"

    # Query GET /health
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["speech"]["state"] == "unloaded"
    assert data["speech"]["device"] is None
    assert data["speech"]["model"] is None

    # Post-condition: model was NOT loaded or instantiated
    assert whisper_engine._model is None
    assert whisper_engine._state == "unloaded"

def test_singleton_and_warm_model_reuse():
    """Acceptance criteria: consecutive evaluations reuse the warm model instance."""
    engine = WhisperEngine()

    mock_whisper_model = MagicMock()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "faster_whisper.WhisperModel",
            lambda *args, **kwargs: mock_whisper_model,
        )

        # First load
        m1 = engine.load_model(device="cpu", model_name="base.en")
        assert m1 is mock_whisper_model
        assert engine._state == "ready"
        assert engine._device == "cpu"
        assert engine._model_name == "base.en"

        # Second load: must reuse the exact same warm instance without re-instantiating
        m2 = engine.load_model(device="cpu", model_name="base.en")
        assert m2 is m1
        assert id(m1) == id(m2)

def test_never_two_models_resident_concurrently():
    """Acceptance criteria: Two models are never resident in memory concurrently."""
    engine = WhisperEngine()

    resident_models = []

    def mock_model_factory(model_size_or_path, *args, **kwargs):
        m = MagicMock(name=f"model_{model_size_or_path}")
        resident_models.append(m)
        return m

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("faster_whisper.WhisperModel", mock_model_factory)

        # Load first model
        m1 = engine.load_model(device="cpu", model_name="base.en")
        assert engine._model is m1

        # Load second distinct model
        m2 = engine.load_model(device="cpu", model_name="tiny.en")
        assert engine._model is m2
        assert m2 is not m1

        # Unload explicitly
        engine.unload_model()
        assert engine._model is None
        assert engine._state == "unloaded"

def test_cuda_mode_mandatory_no_silent_downgrade():
    """Acceptance criteria: cuda mode does not silently downgrade to CPU on failure."""
    engine = WhisperEngine()

    with pytest.MonkeyPatch.context() as mp:
        def raise_cuda_error(*args, **kwargs):
            raise RuntimeError("CUDA driver out of memory or device unavailable")

        mp.setattr("faster_whisper.WhisperModel", raise_cuda_error)

        with pytest.raises(AppException) as exc_info:
            engine.load_model(device="cuda", model_name="small.en")

        assert exc_info.value.code == "CUDA_INITIALIZATION_FAILED"
        assert exc_info.value.status_code == 500
        assert "GPU execution mandatory in 'cuda' mode" in exc_info.value.message
        # Verify strict NO downgrade: state is unavailable, device is NOT set to cpu
        assert engine._state == "unavailable"
        assert engine._device is None
        assert engine._model is None

def test_auto_mode_fallback_to_cpu_when_cuda_fails():
    """Acceptance criteria: auto mode logs fallback event and initializes CPU model on CUDA failure."""
    engine = WhisperEngine()

    attempt_count = 0

    def mock_whisper_factory(model_size_or_path, device, *args, **kwargs):
        nonlocal attempt_count
        attempt_count += 1
        if device == "cuda":
            raise RuntimeError("CUDA out of memory error during initialization")
        mock = MagicMock(name=f"cpu_{model_size_or_path}")
        return mock

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("ctranslate2.get_cuda_device_count", lambda: 1)
        mp.setattr("faster_whisper.WhisperModel", mock_whisper_factory)
        mp.setattr(settings, "SPEECH_ALLOW_CPU_FALLBACK", True)

        # Load in auto mode
        model = engine.load_model(device="auto")

        assert attempt_count == 2  # 1st attempt CUDA (failed) -> 2nd attempt CPU (succeeded)
        assert engine._state == "ready"
        assert engine._device == "cpu"
        assert engine._fallback_active is True
        assert "CUDA out of memory" in str(engine._fallback_reason)
        assert engine._model is not None

def test_auto_mode_no_fallback_when_disabled():
    """When SPEECH_ALLOW_CPU_FALLBACK is False, auto mode does not downgrade on CUDA failure."""
    engine = WhisperEngine()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("ctranslate2.get_cuda_device_count", lambda: 1)
        mp.setattr(
            "faster_whisper.WhisperModel",
            lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("CUDA failed")),
        )
        mp.setattr(settings, "SPEECH_ALLOW_CPU_FALLBACK", False)

        with pytest.raises(AppException) as exc_info:
            engine.load_model(device="auto")

        assert exc_info.value.code == "CUDA_INITIALIZATION_FAILED"
        assert engine._state == "unavailable"
        assert engine._fallback_active is False

def test_in_flight_cuda_oom_recovery_in_auto_mode(tmp_path):
    """In-flight CUDA execution failure/OOM triggers single-attempt CPU fallback and retry."""
    engine = WhisperEngine()
    test_wav = tmp_path / "test.wav"
    test_wav.write_bytes(create_synthetic_wav(1.0))

    cuda_model_mock = MagicMock()
    # transcribe on CUDA fails with CUDA OOM
    cuda_model_mock.transcribe.side_effect = RuntimeError("CUDA out of memory in native GEMM kernel")

    cpu_words = [MagicMock(word="recovered", start=0.1, end=0.8, probability=0.95)]
    cpu_seg = MagicMock(text="recovered", start=0.1, end=0.8, words=cpu_words)
    cpu_info = MagicMock(language="en", language_probability=0.99, duration=1.0)
    cpu_model_mock = MagicMock()
    cpu_model_mock.transcribe.return_value = ([cpu_seg], cpu_info)

    def factory(model_size_or_path, device, *args, **kwargs):
        if device == "cuda":
            return cuda_model_mock
        return cpu_model_mock

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("faster_whisper.WhisperModel", factory)
        mp.setattr(settings, "SPEECH_DEVICE", "auto")
        mp.setattr(settings, "SPEECH_ALLOW_CPU_FALLBACK", True)

        # Preload on CUDA
        engine.load_model(device="cuda")
        assert engine._device == "cuda"

        # Transcribe should catch the in-flight CUDA error and fallback to CPU cleanly
        result = engine.transcribe(test_wav)

        assert result["text"] == "recovered"
        assert result["device"] == "cpu"
        assert engine._fallback_active is True
        assert len(result["words"]) == 1

def test_transcription_empty_or_missing_audio_rejection(tmp_path):
    """Empty or non-existent audio must raise structured error."""
    engine = WhisperEngine()

    # Missing file
    with pytest.raises(AppException) as exc_info:
        engine.transcribe(tmp_path / "non_existent.wav")
    assert exc_info.value.code == "EMPTY_AUDIO"
    assert exc_info.value.status_code == 422

    # Zero-byte file
    empty_file = tmp_path / "empty.wav"
    empty_file.write_bytes(b"")
    with pytest.raises(AppException) as exc_info2:
        engine.transcribe(empty_file)
    assert exc_info2.value.code == "EMPTY_AUDIO"
    assert exc_info2.value.status_code == 422

def test_iteration_exception_handling(tmp_path):
    """Iteration exceptions during generator consumption must be caught and logged cleanly."""
    engine = WhisperEngine()

    dummy_wav = tmp_path / "test.wav"
    dummy_wav.write_bytes(create_synthetic_wav(1.0))

    def faulty_generator():
        yield MagicMock(text="First chunk", words=[])
        raise RuntimeError("Native CTranslate2 computation failure in mid-stream")

    mock_info = MagicMock(language="en", language_probability=0.98, duration=1.0)
    mock_model = MagicMock()
    mock_model.transcribe.return_value = (faulty_generator(), mock_info)

    engine._model = mock_model
    engine._state = "ready"
    engine._device = "cpu"
    engine._model_name = "test_model"

    with pytest.raises(AppException) as exc_info:
        engine.transcribe(dummy_wav)

    assert exc_info.value.code == "SPEECH_TRANSCRIPTION_FAILED"
    assert exc_info.value.status_code == 500
    assert "Native CTranslate2 computation failure" in exc_info.value.message
    assert engine._last_error is not None

def test_real_cpu_transcription_integration(tmp_path):
    """Real CPU integration test with cached 'tiny.en' model."""
    engine = WhisperEngine()
    test_wav = tmp_path / "integration_cpu.wav"
    test_wav.write_bytes(create_synthetic_wav(duration_seconds=1.0))

    engine.load_model(device="cpu", model_name="tiny.en")
    assert engine._state == "ready"
    assert engine._device == "cpu"

    result = engine.transcribe(test_wav, language="en")
    assert "text" in result
    assert "words" in result
    assert result["device"] == "cpu"
    assert result["model_name"] == "tiny.en"
    assert result["inference_time_ms"] > 0

def test_real_cuda_transcription_integration(tmp_path):
    """
    Real CUDA GPU integration test with cached 'tiny.en' model on NVIDIA RTX 3050.
    Verifies int8_float16 compute type, genuine GPU execution, and latency.
    """
    import ctranslate2
    if ctranslate2.get_cuda_device_count() == 0:
        pytest.skip("No CUDA device available on host")

    engine = WhisperEngine()
    test_wav = tmp_path / "integration_gpu.wav"
    test_wav.write_bytes(create_synthetic_wav(duration_seconds=1.0))

    engine.load_model(device="cuda", model_name="tiny.en", compute_type="int8_float16")
    assert engine._state == "ready"
    assert engine._device == "cuda"
    assert engine._compute_type == "int8_float16"

    result = engine.transcribe(test_wav, language="en")
    assert "text" in result
    assert "words" in result
    assert result["device"] == "cuda"
    assert result["model_name"] == "tiny.en"
    assert result["compute_type"] == "int8_float16"
    assert result["inference_time_ms"] > 0
    # On GPU, warm 1.0s audio typically processes in under 500ms
    assert result["inference_time_ms"] < 2000
