# FluentTube AI

> **YouTube English Dictation & Shadowing Web App**  
> *Autonomous speech recognition, server-authoritative scoring, and optional contextual AI grammar tutor.*

FluentTube AI is a desktop-first, local-first web application designed for intermediate-to-advanced (B2+) English learners. It transforms any YouTube video with English speech into an intensive, multi-modal language training station:

1. **Step 1: Dictation Practice** — Train auditory parsing through segment-by-segment dictation with server-authoritative Myers diff scoring, adaptive word slots, and strict answer concealment.
2. **Step 2: Shadowing Studio** — Practice spoken fluency with in-browser microphone capture, deterministic 16 kHz WAV transcoding, local Faster-Whisper ASR inference (with GPU CUDA acceleration and CPU fallback), and fine-grained display token alignment.
3. **Step 3: Contextual Grammar Tutor (Optional)** — Deepen comprehension with an on-demand Google Gemini 2.5 Flash tutor delivering structured B2 grammatical breakdowns, connected speech tips, and contextual idioms across a strict 3-sentence window.

---

## Architecture Overview

```
                                      +------------------------------------+
                                      |   Browser (Frontend: Vite+React)   |
                                      |  - Port 5173 (Strict Binding)      |
                                      |  - Zustand Stores & TanStack Query |
                                      |  - YouTube IFrame & WaveSurfer.js  |
                                      |  - In-Browser MediaRecorder (30s)  |
                                      +-----------------+------------------+
                                                        |
                                       HTTP / REST (JSON & Multipart)
                                       Strict Loopback: 127.0.0.1:8000
                                                        |
                                                        v
                                      +-----------------+------------------+
                                      |    Backend Server (FastAPI)        |
                                      |  - Port 8000 (Strict Loopback)     |
                                      |  - Bounded FIFO Job Queue (max 8)  |
                                      |  - SQLite WAL (Foreign Keys, Busy) |
                                      +---+-------------+--------------+---+
                                          |             |              |
                    +---------------------+             |              +----------------------+
                    v                                   v                                     v
+-----------------------+              +-----------------------+              +-----------------------+
|  YouTube Ingestion    |              | Faster-Whisper Engine |              | Contextual AI Tutor   |
| - yt-dlp audio stream |              | - CTranslate2 (CUDA)  |              | - Google Gemini 2.5   |
| - Subtitle Deduplicat.|              | - int8_float16 / int8 |              | - Structured Schema   |
| - Word-Boundary ASR   |              | - Auto CPU Fallback   |              | - SHA-256 Cache Table |
| - Atomic DB Rollback  |              | - Word-Level Timings  |              | - Concurrency = 1     |
+-----------------------+              +-----------------------+              +-----------------------+
```

---

## System Requirements & Prerequisites

| Component | Minimum Requirement | Recommended (GPU Accelerated) |
| :--- | :--- | :--- |
| **Operating System** | Windows 10/11, Linux, macOS | Windows 11 64-bit |
| **Python** | Python 3.11.x (`3.11.9` tested) | Python 3.11.9 |
| **Node.js** | Node.js 18.x or 20.x + npm | Node.js 20.x + npm 10+ |
| **FFmpeg** | `ffmpeg` and `ffprobe` in system `PATH` | FFmpeg 6.0+ |
| **Inference Hardware** | Modern x86_64 CPU (int8 quantization) | NVIDIA GPU (e.g., RTX 3050+ with 4GB+ VRAM, CUDA 12) |
| **AI Tutor (Optional)** | None (runs disabled by default) | Free Google Gemini API Key (`GEMINI_API_KEY`) |

---

## Quick Start (Recommended)

From the project root:
```bash
# 1. Install root dependencies (once)
npm install

# 2. Launch both Backend & Frontend concurrently with live reload:
npm run dev
```

This single command starts:
- **Backend API**: `http://127.0.0.1:8000` (FastAPI with Uvicorn `--reload`)
- **Frontend App**: `http://127.0.0.1:5173` (Vite React dev server with proxy to backend)

To stop both services anytime, simply press `Ctrl + C` in your terminal.

---

### Alternative: Two Separate Terminals
If you prefer viewing backend and frontend logs in dedicated terminal windows:

**Terminal 1 (Backend):**
```powershell
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 (Frontend):**
```bash
npm --prefix frontend run dev
```

---

## Manual Setup & Development

### 1. Backend Setup
From the project root:
```powershell
# Create Python 3.11 virtual environment
py -3.11 -m venv backend/.venv

# Activate environment and install pinned dependencies
.\backend\.venv\Scripts\Activate.ps1
pip install -r backend/requirements-lock.txt

# Copy environment configuration
copy backend\.env.example backend\.env
```

### 2. Frontend Setup
```powershell
cd frontend
npm ci
cd ..
```

### 3. Run Automated Test Suites
```powershell
# Run backend pytest suite (131 tests across 13 suites)
.\backend\.venv\Scripts\pytest.exe backend/tests

# Run frontend Vitest suite (98 tests across 12 suites)
npm --prefix frontend test

# Run frontend production typecheck and build
npm --prefix frontend run build
```

### 4. Run System Diagnostics
```powershell
.\backend\.venv\Scripts\python.exe backend/check_environment.py
```
Outputs a full diagnostic report of your Python runtime, FFmpeg, CTranslate2, CUDA device count, GPU VRAM, compute types, SQLite connectivity, and cached models.

---

## Configuration (`backend/.env`)

Configure operational limits in `backend/.env`:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `APP_HOST` | `127.0.0.1` | Loopback binding address |
| `APP_PORT` | `8000` | Port for FastAPI backend |
| `DATABASE_URL` | `sqlite:///./data/fluenttube.db` | SQLite database path (WAL mode) |
| `MEDIA_ROOT` | `./media_cache` | Cached audio files and ASR temporary WAVs |
| `SPEECH_DEVICE` | `auto` | `auto` (attempts CUDA, falls back to CPU), `cuda`, or `cpu` |
| `SPEECH_CUDA_MODEL` | `small.en` | Whisper model for GPU inference |
| `SPEECH_CPU_MODEL` | `small.en` | Whisper model for CPU fallback inference |
| `TUTOR_ENABLED` | `false` | Enable or disable contextual AI tutor |
| `TUTOR_PROVIDER` | `gemini` | LLM provider (`gemini`) |
| `TUTOR_MODEL` | `gemini-3.5-flash-lite` | Gemini model name (default: `gemini-3.5-flash-lite` [500 RPD free], supports `gemini-3.5-flash`, `gemini-3.8-flash`) |
| `GEMINI_API_KEY` | `""` | Optional Google Gemini API key |

---

## Pedagogical Feature Highlights

### 1. Ingestion Pipeline
- **Dual Source Ingestion**: Fetches existing English subtitles (manual or auto-generated) with noise token removal (`[Music]`, `(applause)`), or triggers local Whisper ASR fallback when captions are unavailable.
- **Word-Boundary Clamping**: Aligns subtitle breaks to natural word boundaries, pauses >1.2s, or sentence punctuation, clamped to a maximum of 18 words / 10.0 seconds.
- **Atomic Persistence**: Video metadata, segment timestamps, and relative audio file paths are committed in a single atomic transaction.

### 2. Dictation Practice
- **Zero Answer Leakage**: Target sentence words are strictly concealed. Placeholders render dynamic dashes capped at 8 characters (`Math.min(8, Math.max(2, length))`) so long words cannot be guessed from character count.
- **Authoritative Server Scoring**: Client input is evaluated on the backend via Myers diff alignment. Client cannot dictate its own score.
- **Pedagogical Invariants**:
  - Revealing the answer unlocks the segment for study but prevents marking the sentence as completed.
  - Using hints flags the segment as `assisted = true`.
  - Inexact checks on previously completed sentences never revoke completed status.
  - Stale diff invalidation clears matched word highlights as soon as the user alters their draft.

### 3. Shadowing Studio
- **Hardware-Safe Lifecycle**: In-browser recording uses `MediaRecorder` with prioritized Opus encoding and a strict 30.0-second auto-stop cutoff. Hardware tracks are immediately released (`track.stop()`) when stopping or unmounting.
- **Deterministic 16 kHz WAV Transcoding**: Uploaded audio is validated via `ffprobe` and converted to single-channel 16 kHz mono PCM WAV using explicit argument lists.
- **Section 10.4 Scoring Metrics**:
  - Word match score: $100 \times \max(0, 1 - (S + D + I)/N)$ with insertions ($I$) directly penalizing accuracy.
  - Timing similarity score: $100 \times \max(0, 1 - |spoken - reference| / \max(reference, 1.5))$.
  - Word display badges: **Recognized** (green), **Uncertain** (amber), **Different** (red), **Missing** (slate).
  - Explicit disclaimer rendered: *"Practice feedback estimated from speech recognition; it is not a phonetic pronunciation assessment."*

### 4. Contextual Grammar Tutor (Optional)
- **Bounded 3-Sentence Context Window**: Sends only the target sentence and its immediate prior and subsequent sentences to Google Gemini. Full transcripts, user history, and audio are never transmitted.
- **Deterministic SHA-256 Cache**: Caches responses in SQLite `TutorCache` table across sentence context, language, provider, model, and prompt version.
- **Safe Rendering**: All tutor output is rendered as sanitized React text nodes. Zero usage of `dangerouslySetInnerHTML`.
- **Zero-Key Safe Boot**: Application boots and operates 100% functional without cloud credentials. If disabled, `/api/health` indicates `tutor.enabled = false` and the UI shows a setup guide.

---

## Documented Operational Limits

1. **Speech Assessment**: Speech feedback is derived from ASR word confidence and segment timing duration. It evaluates lexical accuracy and tempo, **not** vocal acoustic formants or phonemic tongue placement.
2. **YouTube Video Constraints**: YouTube live streams, private videos, and age-restricted content without downloadable streams are rejected with descriptive HTTP 400/422 errors.
3. **Hardware Acceleration**: GPU acceleration requires an NVIDIA GPU with compute capability $\ge 7.0$ and CUDA 12 runtime wheels (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`). If CUDA initialization fails in `auto` mode, the engine falls back automatically to CPU int8 inference.
4. **AI Tutor Concurrency**: Cloud LLM tutor queries are concurrency-limited to 1 request at a time via `asyncio.Semaphore(1)` to protect against accidental quota depletion.
5. **No External Flashcard Sync**: AnkiConnect / Anki deck export was removed from the scope per user decision (Decision D-029). Dictation and shadowing progress are saved directly in local SQLite.

---

## Troubleshooting FAQ

### Port 8000 or 5173 is already in use
The launcher script enforces strict port binding to ensure CORS policies and saved bookmarks remain valid. If a port is occupied:
1. Run `.\stop_local.bat` to terminate any previous background session.
2. If another application occupies port 8000 or 5173, close that application or change its port before re-running `.\start_local.bat`.

### FFmpeg was not found in PATH
Install FFmpeg using winget or download from Gyan.dev:
```powershell
winget install Gyan.FFmpeg
```
Restart your terminal after installation to refresh the system PATH.

### Missing Whisper Model or Offline Boot
The application comes pre-configured to look for models in `backend/data/models`. If a requested model is not downloaded:
```powershell
python -c "from faster_whisper import WhisperModel; WhisperModel('small.en', download_root='backend/data/models')"
```

---

## License

Private / Educational Use Only.
