# FluentTube AI — Performance Benchmarks & Temporal Calibration Report

> **Specification Reference**: Section 10.3, Section 10.5, Section 14.18 (T17), Section 14.25 (T25)  
> **Raw Telemetry Source**: [`docs/benchmarks-t17.json`](file:///c:/Users/crisa/Workspace/system-design/english-learning/docs/benchmarks-t17.json)

---

## 1. Test Environment & Hardware Specification

All benchmarks were conducted on the local physical host workstation:

| Component | Hardware / Software Profile |
| :--- | :--- |
| **Operating System** | Windows 11 (build 26100), 64-bit |
| **Python Runtime** | Python 3.11.9 (`C:\Users\crisa\Workspace\system-design\english-learning\backend\.venv\Scripts\python.exe`) |
| **FFmpeg Engine** | FFmpeg 9.0.2 full build (`www.gyan.dev`) with ffprobe |
| **Inference Framework** | CTranslate2 v4.8.3 |
| **Host GPU** | **NVIDIA GeForce RTX 3050 Laptop GPU** |
| **GPU Dedicated VRAM** | 4,096 MB total (3,964 MB free during benchmark baseline) |
| **NVIDIA Driver** | 566.07 (Direct CUDA 12.7 runtime support) |
| **NVIDIA Wheels (Win32)** | `nvidia-cublas-cu12`, `nvidia-cudnn-cu12`, `nvidia-cuda-nvrtc-cu12` dynamically registered via `_ensure_nvidia_dll_paths()` |
| **Whisper Model** | `Systran/faster-whisper-tiny.en` (downloaded and cached locally at `data/models`) |

---

## 2. Speech ASR Inference: CPU vs. GPU Acceleration

### 2.1 Latency & Acceleration Summary Table

| Test Vector Duration | Mode & Precision | Cold Load Time | Warm Runs (ms) | Avg Warm Latency | p95 Warm Latency | Real-Time Factor (RTF) | Observed Speedup |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1.0 s Audio** | **CPU (`int8`)** | 873.7 ms | 1481.7, 1351.7, 1292.1 | 1,375.2 ms | 1,468.7 ms | 1.375 | Baseline |
| **1.0 s Audio** | **GPU (`int8_float16`)** | 498.3 ms | 135.7, 114.9, 110.3 | **120.3 ms** | **133.6 ms** | **0.120** | **11.4x Faster** |
| **5.0 s Audio** | **CPU (`int8`)** | — | 4135.4, 4554.4, 4287.7 | 4,325.8 ms | 4,527.7 ms | 0.865 | Baseline |
| **5.0 s Audio** | **GPU (`int8_float16`)** | — | 1893.0, 2303.6, 2170.8 | **2,122.5 ms** | **2,290.4 ms** | **0.425** | **2.04x Faster** |
| **10.0 s Audio** | **CPU (`int8`)** | — | 4855.9, 4775.1, 3826.3 | 4,485.8 ms | 4,847.8 ms | 0.449 | Baseline |
| **10.0 s Audio** | **GPU (`int8_float16`)** | — | 2345.8, 1761.4, 2343.2 | **2,150.1 ms** | **2,345.5 ms** | **0.215** | **2.09x Faster** |

### 2.2 Key Findings on ASR Performance

1. **Short Sentence Processing (1.0 s Vector)**:
   - On CPU, processing a short 1-second segment requires **1,375 ms** due to CPU CTranslate2 thread orchestration and decoding overhead.
   - On the NVIDIA RTX 3050 Laptop GPU using `int8_float16` precision, the exact same segment is transcribed and word-timestamped in **120.3 ms** — a **11.4x speedup** with an RTF of **0.120** (processes audio over 8 times faster than real-time playback).
2. **Medium & Long Sentence Vectors (5.0 s & 10.0 s)**:
   - GPU maintains an RTF under **0.43**, ensuring that user speech evaluations during Shadowing Practice complete and render within ~2 seconds even on long compound sentences.
3. **Cold Model Initialization**:
   - Initial model instantiation into GPU VRAM completes in **498.3 ms** (1.75x faster than CPU cold load of 873.7 ms).
   - Once warm, the resident model is locked into VRAM (`free_vram_mb = 3,784 MB`), leaving ample headroom (>3.7 GB VRAM) on the host's 4 GB GPU for other applications.

---

## 3. Video Playback Temporal Calibration (Task T10)

### 3.1 Loop Mode & Boundary Precision Metrics
Measured via live browser automated calibration harness over 10 consecutive foreground runs:

| Playback Rate | Segment Duration | Measured End Cutoff Deviation | Status |
| :---: | :---: | :---: | :---: |
| **1.0x (Normal)** | 4.50 s | p50 = 42 ms, p95 = **78 ms**, max = 92 ms | PASSED (Target $\le 300$ ms) |
| **0.75x (Slow)** | 4.50 s | p50 = 55 ms, p95 = **84 ms**, max = 105 ms | PASSED (Target $\le 300$ ms) |

- **Loop Pause Calibration**: Replay trigger cleanly enforces the 1.0-second delay between repetitions, allowing learners to parse sentences without auditory overlap.
- **Teardown**: Video pause and cleanup timer execute within 16 ms of component unmount, preventing background audio bleed.

---

## 4. Architectural Telemetry & Resource Boundaries

- **Single Resident Model Invariant**: Exactly one model instance is maintained in memory. Transitions between CPU and CUDA execute garbage collection (`gc.collect()`) and clear existing handles prior to new instantiation.
- **In-Browser Recording**: MediaRecorder streams are strictly held in-memory blobs with immediate hardware track release (`track.stop()`) on pause/stop, preventing microphone retention.
- **Memory Footprint**: SQLite database operates with WAL mode and `cache_size = -64000` (64 MB ceiling), ensuring ultra-fast query times without runaway memory usage.
