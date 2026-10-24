"""
FluentTube AI - Whisper ASR Benchmark Suite (Section 10.5 & Task T17)
Measures cold/warm latency, RTF (Real-Time Factor), and VRAM utilization on CPU vs. GPU.
"""

import json
import os
import sys
import tempfile
import time
import wave
import numpy as np
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add workspace root and backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = BACKEND_DIR.parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from backend.app.config import settings
from backend.app.services.whisper_engine import whisper_engine
from check_environment import check_environment

def generate_tone_wav(duration_s: float, freq_hz: float = 440.0) -> Path:
    """Generate a clean 16 kHz mono PCM WAV test vector."""
    sample_rate = 16000
    total_samples = int(sample_rate * duration_s)
    t = np.linspace(0, duration_s, total_samples, False)
    # Generate modulated sine wave tone resembling speech cadence
    envelope = 0.5 * (1 + np.sin(2 * np.pi * 3 * t))
    audio_data = envelope * np.sin(2 * np.pi * freq_hz * t)
    audio_int16 = (audio_data * 32767).astype(np.int16)

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    with wave.open(str(tmp_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_int16.tobytes())

    return tmp_path

def run_benchmark(
    device: str,
    model_name: str,
    compute_type: str,
    durations: List[float] = [1.0, 5.0, 10.0],
    repeats: int = 3,
) -> Dict[str, Any]:
    """Execute ASR benchmark for a given device and model configuration."""
    whisper_engine.unload_model()

    print(f"\n--- Benchmarking: {model_name} on {device.upper()} ({compute_type}) ---")

    # Measure cold load
    t0_cold = time.perf_counter()
    whisper_engine.load_model(device=device, model_name=model_name, compute_type=compute_type)
    cold_load_time_ms = round((time.perf_counter() - t0_cold) * 1000, 2)
    print(f"  Cold Model Load: {cold_load_time_ms} ms")

    results_by_duration = []

    for dur in durations:
        wav_path = generate_tone_wav(dur)
        try:
            # First inference (warmup for this length)
            whisper_engine.transcribe(wav_path, vad_filter=False)

            # Timed warm inferences
            warm_times_ms = []
            for _ in range(repeats):
                t0 = time.perf_counter()
                res = whisper_engine.transcribe(wav_path, vad_filter=False)
                t_ms = (time.perf_counter() - t0) * 1000
                warm_times_ms.append(t_ms)

            avg_warm_ms = round(sum(warm_times_ms) / len(warm_times_ms), 2)
            p95_warm_ms = round(float(np.percentile(warm_times_ms, 95)), 2)
            rtf = round((avg_warm_ms / 1000.0) / dur, 4)

            print(f"  Audio {dur:4.1f}s | Avg Warm: {avg_warm_ms:7.2f} ms | p95: {p95_warm_ms:7.2f} ms | RTF: {rtf:6.4f}")

            results_by_duration.append({
                "audio_duration_s": dur,
                "warm_times_ms": [round(t, 2) for t in warm_times_ms],
                "avg_warm_time_ms": avg_warm_ms,
                "p95_warm_time_ms": p95_warm_ms,
                "real_time_factor_rtf": rtf,
            })
        finally:
            if wav_path.exists():
                wav_path.unlink()

    health = whisper_engine.get_health_status()
    whisper_engine.unload_model()

    return {
        "device": device,
        "model_name": model_name,
        "compute_type": compute_type,
        "cold_load_time_ms": cold_load_time_ms,
        "gpu_name": health.get("gpu_name"),
        "free_vram_mb": health.get("free_vram_mb"),
        "benchmarks": results_by_duration,
    }

def main():
    env_info = check_environment()
    has_cuda = env_info["speech_runtime"]["cuda_device_count"] > 0 and env_info["speech_runtime"]["int8_float16_supported"]

    print("=" * 70)
    print("FluentTube AI - Whisper Speech Engine Benchmark (Section 10.5)")
    print("=" * 70)
    print(f"Host Hardware: {env_info['gpu'].get('gpu_name', 'CPU only')}")
    print(f"Driver Version: {env_info['gpu'].get('driver_version', 'N/A')}")
    print(f"CTranslate2:   {env_info['speech_runtime']['ctranslate2_version']}")
    print(f"CUDA Available: {has_cuda}")
    print("=" * 70)

    # Use available cached model for rapid benchmarking (tiny.en or base.en)
    test_model = "tiny.en"

    # 1. CPU Benchmark
    cpu_results = run_benchmark(
        device="cpu",
        model_name=test_model,
        compute_type="int8",
        durations=[1.0, 5.0, 10.0],
    )

    # 2. GPU Benchmark (if CUDA available)
    gpu_results = None
    if has_cuda:
        gpu_results = run_benchmark(
            device="cuda",
            model_name=test_model,
            compute_type="int8_float16",
            durations=[1.0, 5.0, 10.0],
        )

    full_report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "environment": env_info,
        "cpu_benchmark": cpu_results,
        "gpu_benchmark": gpu_results,
    }

    # Save benchmark artifact to docs/benchmarks-t17.json
    out_dir = BACKEND_DIR.parent / "docs"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_file = out_dir / "benchmarks-t17.json"
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(full_report, f, indent=2)

    print("\n" + "=" * 70)
    print("Summary Comparison (Audio: 5.0s vector)")
    print("=" * 70)
    cpu_5s = next((b for b in cpu_results["benchmarks"] if b["audio_duration_s"] == 5.0), None)
    print(f"CPU (int8):         {cpu_5s['avg_warm_time_ms']} ms (RTF: {cpu_5s['real_time_factor_rtf']})")
    if gpu_results:
        gpu_5s = next((b for b in gpu_results["benchmarks"] if b["audio_duration_s"] == 5.0), None)
        speedup = round(cpu_5s["avg_warm_time_ms"] / gpu_5s["avg_warm_time_ms"], 2)
        print(f"GPU (int8_float16): {gpu_5s['avg_warm_time_ms']} ms (RTF: {gpu_5s['real_time_factor_rtf']}) -> {speedup}x speedup")
    print(f"Saved benchmark report to: {report_file}")
    print("=" * 70)

if __name__ == "__main__":
    main()
