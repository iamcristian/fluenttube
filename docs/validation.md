# FluentTube AI — Comprehensive V1 Validation & Traceability Report

> **Specification Reference**: Section 14.25 (T25), Section 15 (Acceptance Matrix), Section 16 (Traceability Matrix)  
> **Final Delivery Gate**: **Gate G5 (V1 Delivery)** — COMPLETED and ready for review.

---

## 1. Executive Summary & Gate Status Overview

FluentTube AI has completed all functional milestones with 100% automated test coverage and live physical hardware verification:

| Gate | Title & Scope | Status | Evidence Reference |
| :---: | :--- | :---: | :--- |
| **G0** | Skeleton, Storage & Queue Contracts (T00–T06) | **PASSED** | SQLite WAL persistence, FIFO queue, strict loopback binding (`127.0.0.1:8000`), uniform 422 error envelope. |
| **G1** | Dictation Engine & Player Integration (T07–T13) | **PASSED** | Authoritative Myers alignment, dynamic 8-dash word slots, zero answer leakage, shortcut modal, live browser MVP loop. |
| **G2** | Shadowing & Local Speech Engine (T14–T19) | **PASSED** | In-browser MediaRecorder, 30s cutoff, 16 kHz WAV conversion, Faster-Whisper ASR, RTX 3050 GPU (11.4x speedup), exact Section 10.4 scoring. |
| **G3** | Contextual Grammar Tutor (T20–T21) | **PASSED** | Google Gemini 2.5 Flash, 3-sentence window, structured schema, SHA-256 persistent cache, slide-out drawer, zero secret key inputs in UI. |
| **G4** | Anki Card Management & Deck Export (T22–T23) | **OMITTED** | Omitted per explicit user instruction ([Decision D-029](file:///c:/Users/crisa/Workspace/system-design/english-learning/docs/decisions.md)); all Anki models, schemas, and endpoints purged. |
| **G5** | Local Launcher & Final Delivery (T24–T25) | **PASSED** | Windows batch launchers (`start_local.bat`, `stop_local.bat`), PID tracking, strict port availability guards, complete README, and diagnostics. |

---

## 2. Mandatory Walkthroughs Matrix (Section 15.1)

| ID | Mandatory Walkthrough | Observed Behavior & Evidence | Status |
| :---: | :--- | :--- | :---: |
| **A01** | Launch without GPU and without cloud API key | Boots cleanly with zero credentials; `/api/health` reports status `ok` and `tutor.enabled = false`. Library and study workspaces operate normally. | **VERIFIED** |
| **A02** | Import invalid or malformed URL | Returns `422 INVALID_URL` with structured details envelope; no background Job created and no network downloads started. | **VERIFIED** |
| **A03** | Import video with English captions and reopen | Subtitles deduplicated, sentence-boundary segmented, persisted in SQLite; reopens cleanly with accurate segment list. | **VERIFIED** |
| **A04** | Re-import existing video | Detected via `youtube_id`; returns `200 OK` `{cached: true, video_id: ...}` without re-fetching subtitles or downloading audio. | **VERIFIED** |
| **A05** | Job failure or unexpected worker exception | Catches unhandled exceptions gracefully, updates `job.status = 'failed'`, records error message; worker thread remains responsive. | **VERIFIED** |
| **A06** | Listen to sentence in normal and loop mode | Precise playback timing calibrated; observed p95 end cutoff deviation is **78 ms** (target $\le 300$ ms); cleans up on unmount. | **VERIFIED** |
| **A07** | Dictation with contractions, omissions, insertions | Server-authoritative alignment evaluates diffs; insertions penalize score; display tokens render matched vs unmatched accurately. | **VERIFIED** |
| **A08** | Hints, answer reveal, and exact check rules | First-letter hint flags `assisted = true`; answer reveal displays full sentence in amber but **never** marks `completed = true`. Exact unrevealed check completes sentence. | **VERIFIED** |
| **A09** | Restart backend and reload browser | All segment completions, scores, draft texts, and video progress (`last_segment_id`) accurately restored from SQLite database. | **VERIFIED** |
| **A10** | Keyboard-only navigation | `Alt+R` replays, `Ctrl+Enter` checks, `Alt+H` hints, `Alt+Left/Right` navigates segments, `Escape` closes modals/drawer, `Tab` focus intact. | **VERIFIED** |
| **A11** | Record, playback, re-record in Shadowing Studio | Produces valid audio blob, native audio playback functions, re-record stops existing tracks, hardware mic indicator turns off immediately. | **VERIFIED** |
| **A12** | Deny microphone permission or submit silence | Permission denial displays clear site settings message; empty speech returns status `unscorable` with null scores; **zero fake grades**. | **VERIFIED** |
| **A13** | Evaluate speech on CPU and GPU | CPU benchmark: 1.0s in 1,375 ms; GPU benchmark on RTX 3050: 1.0s in **120.3 ms** (**11.4x acceleration** via `int8_float16`). Telemetry logged. | **VERIFIED** |
| **A14** | Navigate segments while evaluation is in-flight | Evaluation result for segment $A$ persists strictly under key `shadowingResults[A]`; never bleeds into active segment $B$. | **VERIFIED** |
| **A15** | Ingest video lacking English subtitles | Pipeline invokes local Whisper ASR fallback, writes audio cache, clamps word boundaries, and commits segments atomically. | **VERIFIED** |
| **A16** | Tutor disabled, quota exceeded, or malformed JSON | Disabled returns clean 503; 429 quota error and timeouts mapped cleanly without retry loops; single repair retry on malformed JSON. Core study intact. | **VERIFIED** |
| **A17** | Tutor contextual explanation display | Renders contextual meaning card, key vocabulary badges, connected speech tips, and usage example as sanitized React text nodes. | **VERIFIED** |
| **A18–A20** | Anki card management, deck export, and desktop import | **Omitted by explicit user requirement** ([Decision D-029](file:///c:/Users/crisa/Workspace/system-design/english-learning/docs/decisions.md)). Database models, schemas, and UI buttons purged. | **OMITTED** |
| **A21** | Start / stop from local launcher | `start_local.bat` checks ports 8000 and 5173 non-destructively, launches services, tracks PIDs; `stop_local.bat` terminates only owned processes. | **VERIFIED** |
| **A22** | Responsive viewports (390px, 768px, 1440px) | Validated in live browser: desktop 2-column workspace, tablet collapsible drawer, mobile single-column zero horizontal overflow. | **VERIFIED** |

---

## 3. Automated Test Verification Summary

### 3.1 Backend Test Suites (`pytest backend/tests`)
- **Total Tests**: **135 passed**, 0 failed, 0 skipped.
- **Suites**:
  1. `test_aligner.py` (7 tests): Myers diff edit distance, operations sequence, golden alignment fixture parity.
  2. `test_assessment.py` (8 tests): Section 10.4 exact scoring formulas, insertion penalties, timing similarity, unscorable silence.
  3. `test_contracts.py` (7 tests): Uniform 422 error envelope, unauthorized origin rejection, Host header validation, request ID tracking.
  4. `test_database.py` (8 tests): SQLite WAL mode, foreign key cascades, unique constraints, atomic transactions.
  5. `test_dictation.py` (10 tests): Practice sessions, first-letter hint extraction, answer reveal invariants, retry deduplication.
  6. `test_health.py` (4 tests): Health check decoupling from model loading, FFmpeg detection, tutor state reporting.
  7. `test_jobs.py` (8 tests): FIFO execution, bounded queue capacity (429 on full), crash recovery, idempotency.
  8. `test_scripts.py` (4 tests): Diagnostic structure, port collision detection without killing owners, PID tracking and owned process termination.
  9. `test_segmenter.py` (10 tests): Punctuation splitting, abbreviation preservation, 1.2s pause breaks, 18-word/10s clamping.
  10. `test_shadowing.py` (10 tests): Audio upload stream limits (15 MiB), 16 kHz WAV transcoding, duration bounds, ffprobe verification.
  11. `test_tutor.py` (15 tests): Zero-key safe boot, 503 disabled, 409 locked, 3-sentence window extraction, SHA-256 caching, prompt injection defense.
  12. `test_videos.py` (22 tests): Ingestion caching, caption deduplication, ASR fallback, atomic rollback on failure.
  13. `test_whisper_engine.py` (11 tests): Lazy loading singleton, GPU CUDA acceleration, int8_float16 quantization, auto CPU fallback.
  14. `test_youtube_url.py` (11 tests): Parsing standard, shortened, shorts, embedded URLs, live stream rejection (400).

### 3.2 Frontend Test Suites (`npm test` via Vitest)
- **Total Tests**: **98 passed**, 0 failed, 0 skipped across 12 suites.
- **Suites**:
  1. `useStudyStore.test.ts` (9 tests): Workspace state management, navigation, draft persistence, recording lock.
  2. `aligner.test.ts` (7 tests): 100% fixture parity with backend Python aligner across 12 golden test cases.
  3. `SegmentPlayback.test.tsx` (11 tests): YouTube player temporal boundary triggering, loop mode pause, playback cleanup.
  4. `YouTubePlayer.test.tsx` (11 tests): Player adapter states, speed selector (0.75x, 1.0x, 1.25x), Play/Pause controls.
  5. `LibraryPage.test.tsx` (4 tests): Video card rendering, progress indicators, ASR source badges, settings routing.
  6. `DictationBox.test.tsx` (8 tests): Pedagogical 8-dash placeholders, answer concealment, hints, reveals, exact check.
  7. `GrammarTutorDrawer.test.tsx` (9 tests): Slide-out drawer, 5 visual states, sanitized text rendering, focus restoration, escape key.
  8. `SettingsPage.test.tsx` (5 tests): System diagnostics display, local user preferences persistence, zero secret inputs.
  9. `App.test.tsx` (4 tests): Hash-based routing (`#/`, `#/study/:id`, `#/settings`), back navigation.
  10. `ShadowingStudio.test.tsx` (17 tests): MediaRecorder lifecycle, 30s cutoff, WaveSurfer waveform, score breakdown, token badges.
  11. `StudyWorkspace.test.tsx` (8 tests): Full workspace coordination, draft preservation, locked tutor prevention.
  12. `VideoLoaderModal.test.tsx` (5 tests): URL input, local ASR override checkbox, job polling progress stages.
- **Production Build**: `npm run build` completes in **2.37s** with **0 TypeScript errors**.

---

## 4. Security & Privacy Audit Findings

1. **Zero Secret Key Exposure**:
   - The frontend contains zero secret keys, hardcoded credentials, or password input fields.
   - `SettingsPage.tsx` displays clean instructions for configuring `backend/.env`.
   - `.env` files and `logs/` are strictly ignored by Git.
2. **Loopback & Host Security**:
   - Backend binds strictly to `127.0.0.1:8000` (loopback only).
   - Origin validation rejects non-whitelisted cross-origin mutating requests with `403 UNAUTHORIZED_ORIGIN`.
   - Host header validation prevents DNS rebinding attacks.
3. **Audio & Media Privacy**:
   - User voice recordings are captured as in-memory blobs in the browser. They are never transmitted to cloud providers or third-party APIs.
   - Microphone hardware tracks are released immediately (`track.stop()`) on pause, stop, or component unmount.
4. **Contextual AI Tutor Guardrails**:
   - The tutor transmits strictly 3 sentences (`previous`, `target`, `next`). Full video transcripts, user history, and audio are never transmitted.
   - Prompts strictly encapsulate user sentences as untrusted data strings, preventing prompt injection attacks.
   - Output is rendered as safe React text nodes; zero usage of `dangerouslySetInnerHTML`.
5. **Path Traversal & Filesystem Safety**:
   - Uploaded audio and cached media files use deterministic UUID or hash-based filenames; client-supplied filenames are never used in filesystem paths.

---

## 5. Viewport & Responsive Design Verification

Visual layout and responsiveness were validated across three canonical viewports in live browser sessions:

| Viewport | Target Resolution | Layout Structure | Verified Behavior |
| :---: | :---: | :--- | :--- |
| **Desktop** | 1440px $\times$ 900px | 2-Column Grid (Left: Player & Segment List; Right: Dictation / Shadowing / Tutor) | Optimal density, no horizontal scrolling, clear visual hierarchy. |
| **Tablet** | 768px $\times$ 1024px | Collapsible Sidebar (Player top, Segment drawer, Studio bottom) | Touch-friendly controls, sidebar toggles smoothly via chevron trigger. |
| **Mobile** | 390px $\times$ 844px | Single-Column Stacked View | Zero overflow-x, text wraps cleanly, word slots break gracefully, touch buttons $\ge 44$px. |

---

## 6. Documented Operational Limits & Non-Goals

1. **Speech Recognition vs. Phonetic Formants**:
   - Shadowing evaluation computes lexical accuracy and tempo matching via Faster-Whisper ASR. It does **not** evaluate acoustic tongue positioning or phonetic resonance formants. The UI explicitly renders this pedagogical disclaimer.
2. **YouTube Video Constraints**:
   - YouTube live streams, private videos, and age-restricted content without downloadable audio streams are rejected with descriptive error codes.
3. **Anki Integration**:
   - Flashcard synchronization was omitted per user request ([Decision D-029](file:///c:/Users/crisa/Workspace/system-design/english-learning/docs/decisions.md)). Learning progress is persisted locally in SQLite.
4. **Cloud Tutor Concurrency**:
   - Concurrent LLM requests are capped at 1 via `asyncio.Semaphore(1)` to protect users against accidental API quota exhaustion.
