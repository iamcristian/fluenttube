# FluentTube AI — Architecture and Engineering Decisions

This document records architectural, technical, and environment decisions in accordance with Section 0, Section 3, Section 13, and Section 14 of `fluenttube_ai_especificacion_ejecutable_gemini.md`.

---

### D-001: Execution Model and Task Bounding
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 0, Section 14, Section 17
- **Decision**: The system will be implemented incrementally following the executable backlog (T00 through T25) in single-task turns. Each task delivers code, tests, execution output, and status updates. No downstream tasks are preemptively scaffolded or assumed accepted until verified.
- **Rationale**: Prevents hallucinated completion, broken cross-task assumptions, and unverified architecture.

---

### D-002: Python Runtime and CTranslate2 Compatibility
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 3.1, Section 13.2, Section 14 (T00, T01, T16)
- **Observed Fact**: Host installed Python 3.11.9 (`C:\Users\crisa\AppData\Local\Python\pythoncore-3.11-64\python.exe`) via `py install 3.11`.
- **Decision**: Dedicated virtual environment `backend/.venv` targeting Python 3.11.9.
- **Rationale**: Guarantees compatibility with precompiled wheels for `ctranslate2` and `faster-whisper`.

---

### D-003: Frontend Toolchain and Baseline Versions
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 3.1, Section 13.2, Section 14 (T01)
- **Observed Fact**: Host has Node `v24.11.1` and npm `11.21.0` installed via NVM for Windows.
- **Decision**: Scaffolded frontend using React 18 (`react@18.3.1`, `react-dom@18.3.1`), TypeScript, Vite (`5.4.21`), and Tailwind CSS v3 (`3.4.15` with PostCSS). Vitest (`2.1.9`) and `@testing-library/react`. Committed `package-lock.json`.
- **Rationale**: Strict adherence to Section 3.1 requirement for React 18 baseline and stable Tailwind v3 configuration.

---

### D-004: Audio Processing Utility (FFmpeg / ffprobe)
- **Date**: 2026-10-23
- **Status**: Fulfilled (Verified in System PATH)
- **Affected Sections**: Section 3.1, Section 6.1, Section 10.2, Section 13.2
- **Observed Fact**: Gyan.FFmpeg installed via winget (`ffmpeg.exe` and `ffprobe.exe` verified in PATH). Health endpoint `/api/health` now reports `ffmpeg_available: true`.
- **Decision**: Verified genuine FFmpeg binaries in PATH for yt-dlp metadata/audio processing and backend audio conversion.
- **Rationale**: Required by yt-dlp and backend audio conversion services (16 kHz mono PCM).


---

### D-005: Hardware and GPU Acceleration Configuration
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 1, Section 3.1, Section 10.3, Section 14 (T16, T17)
- **Observed Fact**: `nvidia-smi` reports NVIDIA GeForce RTX 3050 Laptop GPU (4096 MiB VRAM), Driver 566.07, CUDA Version 12.7.
- **Decision**: CPU-first baseline (`small.en` model) in T16; CUDA benchmark (`int8_float16`) in T17 with automatic fallback to CPU. Models will be lazy-loaded as singletons.
- **Rationale**: Adheres to Section 1 corrections and prevents out-of-memory crashes on 4 GB laptop GPU.

---

### D-006: Network Binding and Local Security Boundaries
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 5.1, Section 13.1
- **Decision**: Backend strictly binds to `127.0.0.1:8000` (loopback only, never `0.0.0.0`). Frontend runs on strict port `5173`. CORS strictly allows `http://localhost:5173` and `http://127.0.0.1:5173`. Uniform JSON error envelopes for all errors.
- **Rationale**: Local personal application security contract defined in Section 5.1.

---

### D-007: Clean Git Repository Management
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 3.3, Section 13.1, Section 14 (T00, T01)
- **Decision**: Git repository initialized on `main` branch. `.gitignore` excludes `.env`, `backend/.venv`, `node_modules`, SQLite databases (`*.db`, `*.db-wal`), audio caches (`media_cache/`), and logs.
- **Rationale**: Adheres to Section 3.3 invariant: "`.env`, DB files, recordings, cache, downloaded models, and exported packages must remain excluded from Git."

---

### D-008: SQLite Connection Pragmas and Disambiguated Foreign Keys
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 4.1, Section 4.2, Section 14 (T02)
- **Decision**:
  - Automatically configure `PRAGMA foreign_keys = ON;`, `PRAGMA journal_mode = WAL;`, and `PRAGMA busy_timeout = 5000;` on engine connection events.
  - In `backend/app/models.py`, `Video.segments` and `Segment.video` relationships explicitly specify `foreign_keys="Segment.video_id"` to disambiguate from `Video.last_segment_id`.
  - Windows file paths for SQLite URLs are resolved to absolute canonical paths with directory creation in `get_engine()`.
- **Rationale**: Prevents AmbiguousForeignKeysError and ensures concurrent readers do not block writes.

---

### D-009: Database Migration Policy
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 4.1, Section 14 (T02)
- **Decision**: V1 tables are declared and initialized via `SQLModel.metadata.create_all()`. For future post-V1 schema evolutions, Alembic versioned migrations (`alembic revision --autogenerate`) with mandatory pre-upgrade SQLite database backups must be utilized. Dropping databases to resolve schema conflicts in existing user databases is strictly prohibited.
- **Rationale**: Enforces data persistence and protects Cristian's accumulated study progress.

---

### D-010: Uniform Error Handling and Contract Boundaries
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 5.1, Section 5.2, Section 14 (T03)
- **Decision**:
  - Canonical DTOs in `backend/app/schemas.py` enforce data isolation: entity attributes (`payload_json`, `request_hash`, `audio_relative_path`) are excluded from public responses.
  - Uniform JSON error envelope `{"error": {"code", "message", "retryable", "details", "request_id"}}` applied uniformly to `AppException`, `StarletteHTTPException`, Pydantic `RequestValidationError` (422), and uncaught exceptions (500).
  - Security middleware enforces allowed hostnames (`localhost`, `127.0.0.1`, `testserver`) and validates the `Origin` header on all mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Rationale**: Eliminates secret/path leakage and enforces consistent frontend/backend contract.

---

### D-011: Bounded Background Queue and Idempotency Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 6.1, Section 14 (T04)
- **Decision**:
  - Implement single worker thread backed by an in-memory `queue.Queue(maxsize=8)` and synchronized via thread lock.
  - Full queue returns `429 QUEUE_FULL` immediately without persisting orphaned records in the database.
  - Enqueue is idempotent: identical request hash returns existing job without duplicate execution; conflicting request hash with same client_request_id raises `409 IDEMPOTENCY_CONFLICT`.
  - Server startup cleans up dangling states: any jobs found in `queued` or `running` state are transitioned to `failed` with code `JOB_INTERRUPTED`.
  - Unhandled exceptions in job handlers do not terminate the worker thread.
- **Rationale**: Adheres to Section 6.1 design, preventing event-loop blocking, duplicate operations, and orphaned database records.

---

### D-012: Deterministic Segmentation and URL Validation Policies
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 6.2, Section 6.4, Section 14 (T05)
- **Decision**:
  - `parse_youtube_url()` implements Section 6.2 strictly: exact domain validation, port/credential restrictions, multi-format ID extraction (`watch`, `youtu.be`, `shorts`, `embed`), and regex `^[A-Za-z0-9_-]{11}$`.
  - `segment_fragments()` implements Section 6.4 rules: HTML entity decoding, bracketed/symbolic non-verbal noise removal, gap flush (>1.2s with 3-decimal rounding to eliminate IEEE 754 float drift), max threshold flushing (>18 words or >10.0s), rolling caption overlap removal (>=3 tokens), and sentence-boundary flushing with abbreviation (`Dr.`, `Mr.`, `e.g.`) and decimal exclusion.
  - Golden fixtures persisted in `shared/fixtures/segmentation.json`.
- **Rationale**: Guarantees deterministic, reproducible sentence segmentation across manual and automatic subtitle streams.

---

### D-013: Subtitle Ingestion, Caching, and Atomic Persistence Policies
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 4.3.1, Section 5.2, Section 6.3, Section 14.7 (T06)
- **Decision**:
  - `fetch_video_metadata` uses `yt-dlp` in metadata-only mode without downloading media. Rejects active live streams (400 `LIVE_STREAM_UNSUPPORTED`), invalid/non-positive duration (400 `INVALID_VIDEO_METADATA`), and duration > 1800s (400 `VIDEO_TOO_LONG`).
  - `fetch_video_subtitles` queries `YouTubeTranscriptApi`. Manual English subtitles (`en`, `en-*`) are preferred over auto subtitles (`captions_manual` vs `captions_auto`). Videos lacking English subtitles return 404 `SUBTITLES_NOT_FOUND`.
  - Caching policy on `POST /api/videos/ingest`:
    - Cache hit (`force=False`): Returns 200 `{video_id, status: "completed", cached: true}` immediately without re-enqueuing.
    - Existing video (`force=True`): Returns 409 `VIDEO_ALREADY_EXISTS`. V1 does not overwrite transcripts.
    - In-progress video: Returns 409 `INGEST_IN_PROGRESS` with `existing_job_id`. Identical `client_request_id` retry returns the active job (202).
  - Atomic persistence (Invariant 4.3.1): `Video` and all `Segment` records are committed in a single database transaction. If segment insertion fails, the entire transaction rolls back, leaving no orphaned video records.
  - Video library endpoints:
    - `GET /api/videos`: Paginated (`limit`, `offset`), sorted by `last_opened_at DESC NULLS LAST, id DESC`, with `segment_count` and `completed_count` aggregates.
    - `GET /api/videos/{id}`: Detailed video with segments sorted by `position ASC`, completed/revealed/shadowing_unlocked flags, and best scores.
    - `PATCH /api/videos/{id}/progress`: Validates segment ownership (400 `INVALID_SEGMENT_ID` if mismatched) and updates `last_segment_id` and `last_opened_at`.
- **Rationale**: Strict conformance to Section 4.3, Section 5.2, Section 6.3, and Gate G0 requirements.

---

### D-014: Frontend Library, Import Modal, and State Recovery Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 6.1, Section 8.1, Section 14.8 (T07)
- **Decision**:
  - `LibraryPage` consumes `GET /api/videos` via TanStack Query. Renders empty guide when library is empty; renders responsive grid (1/2/3 cols for 390px, 768px, 1440px) of cards with thumbnails, duration, sentence completion count and percentages, and direct CTA to study view.
  - `VideoLoaderModal` manages YouTube URL input, double-click protection (disabled during submission), immediate navigation on 200 cache hit, and background job polling on 202 accepted.
  - `useJob` hook polls `GET /api/jobs/{job_id}` at 1000 ms intervals while job is queued or running, halting immediately on terminal status (`succeeded` or `failed`).
  - Active pending job IDs are persisted in `localStorage` under `fluenttube_pending_job_id`. On browser refresh, `LibraryPage` recovers the active job and re-opens the progress modal seamlessly.
  - Modal dismissal guard: closing the modal does not abort the background worker on the server; if the user closed the modal before the job completes, unwanted client navigation is prevented while the video updates in the library.
- **Rationale**: Strict adherence to Section 6.1 and Section 14.8 acceptance criteria without production mocks.

---

### D-015: Workspace Layout, Segment Selection, Answer Concealment, and Navigation State Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 8.1, Section 8.2, Section 14.9 (T08)
- **Decision**:
  - Design tokens aligned with Section 8.1: background `#0B1120`, surface `#111B2E`, surface-raised `#172338`, border `#344256`, accent `#38BDF8`, text-primary `#F1F5F9`, text-secondary `#B6C3D6`, success `#34D399`, warning `#FBBF24`, danger `#FB7185`. Exposed via `styles/tokens.css` and extended in `tailwind.config.js`.
  - Responsive study workspace per Section 8.2:
    - `>=1024px`: Two columns (left 44% player & segment list, right 56% stepper, dictation textarea, action controls, shadowing studio) bounded to max 1440px.
    - `768px–1023px`: Single-column layout with collapsible segment list toggle (`Show`/`Hide`).
    - `<768px` (390px mobile): Vertical flow, clean wrapping, minimum 200px player container, verified zero horizontal overflow (`scrollWidth <= clientWidth`).
  - Independent segment numbering: UI display numbers (`#1`, `#2`, `#3`) are strictly derived from segment sequence position (`index + 1`), fully decoupled from database primary keys.
  - Answer text concealment: Incomplete and unrevealed sentences conceal text with masked dots (`••••••••••••••••••` with `aria-label="Sentence hidden until completed"`), preventing answer leakage. Full text is visible only when completed or revealed.
  - "Continue" resolution logic: When opening a video, automatically selects `last_segment_id` if valid in `video.segments`; falls back to the first incomplete segment; falls back to segment 0 if all completed.
  - Local draft persistence: Typed dictation is preserved per segment ID in `useStudyStore.drafts` and restored upon switching segments.
  - Audio recording navigation guard: When `isRecording` is active, navigating away blocks segment switching and triggers a modal ("Audio Recording in Progress") with options to keep recording or stop and discard.
  - Server progress synchronization: Selecting a segment calls `PATCH /api/videos/{id}/progress` to update `last_segment_id` on the server.
  - Disabled action buttons include explicit, accessible tooltip explanations (`title` attribute).
- **Rationale**: Strict conformance to Section 8 and Section 14.9 acceptance criteria.

---

### D-016: YouTube Player Adapter, Singleton API Loader, and Error Recovery Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 9.1, Section 9.2, Section 9.3, Section 9.4, Section 9.15, Section 14.10 (T09)
- **Decision**:
  - `PlayerAdapter` interface decouples player API loading from segment playback loop logic, providing `play`, `pause`, `seekTo`, `getCurrentTime`, `getDuration`, `getState`, `getAvailablePlaybackRates`, `getPlaybackRate`, `setPlaybackRate`, `cueVideoById`, `loadVideoById`, `destroy`, and event subscriptions (`onReady`, `onStateChange`, `onPlaybackRateChange`, `onError`).
  - `loadYouTubeIframeApi` provides singleton Promise loader that injects `https://www.youtube.com/iframe_api` at most once, queues concurrent consumers cleanly without overwriting external callbacks, and resolves synchronously if `window.YT` is already defined.
  - `useYouTubePlayer` enforces React 18 StrictMode compliance: guarantees exactly one player instance per mount, cleanly cleans up unmounted instances, and prevents duplicate iframes or dangling listeners.
  - Origin security and autoplay policy: passes `origin: window.location.origin` and strictly disables initial autoplay (`autoplay: 0`), requiring explicit user interaction per Section 9.4.
  - Video switching: updates to `videoId` invoke `cueVideoById` without triggering unintended autoplay.
  - Error handling: `formatYouTubeError` maps code 101/150 (embedding restricted by creator) to clear explanatory overlay with direct "Watch on YouTube" link (`https://www.youtube.com/watch?v={videoId}`); maps codes 2, 5, 100 with clear corrective descriptions.
  - `FakePlayerAdapter` implemented and verified for offline unit testing without external network dependencies.
- **Rationale**: Strict adherence to Section 9 and Section 14.10 requirements.

---

### D-017: Segment Playback Temporal Boundary Clamping, Seek Guard, and Looping Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 9 (Rules 5–14), Section 14.11 (T10)
- **Decision**:
  - Deterministic cutoff calculation (`calculateCutoff`):
    - Base cutoff set to `end + 0.12 s`.
    - Clamped to `nextSegment.start_seconds` if subsequent segment begins before base padding expires.
    - If segments overlap (`nextSegment.start_seconds < segment.end_seconds`), cutoff is clamped strictly to `segment.end_seconds` and flags `hasCoarseTimingNotice = true`.
  - Temporal loop controller (`useSegmentPlayback`):
    - Monitored via a single 50 ms polling timer while player is in `PLAYING` state.
    - Normal mode: on reaching cutoff timestamp, immediately pauses playback and holds playhead without issuing immediate seek commands, avoiding iframe race conditions.
    - Loop mode: engages `isSeeking` guard and calls `player.seekTo(start_seconds, true)` exactly once per cycle. Re-entrant seek commands are blocked while API still reports pre-seek timestamps; disengages guard once timestamp enters segment start interval.
    - Runaway seek prevention: if seeking guard does not clear within 2.0 s, automatically pauses playback and halts loop timer.
    - `generation_id` race avoidance: switching segments or videos invalidates active callbacks via generation ID and cancels timers immediately.
    - State awareness: timer is suspended during `BUFFERING` to prevent cutoff decisions on stale timestamps; background tab (`document.hidden`) pauses playback and monitoring.
    - Manual scrubber detection: scrubbing outside segment boundaries (`< start - 1.5` or `> cutoff + 1.0`) disengages loop control and prompts "Replay sentence to return".
  - Live browser latency measurement: observed p95 time deviation across 10 playback runs at normal and slow speeds was 78 ms (surpassing the UX requirement of <= 300 ms).
- **Rationale**: Strict adherence to Section 9 rules and Section 14.11 acceptance criteria.

---

### D-018: Shared Normalizer, Token-Level Levenshtein Aligner, and Cross-Language Verification
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 7.1, Section 7.2, Section 7.4, Section 14.12 (T11)
- **Decision**:
  - **Shared Rules & Contraction Dictionary**:
    - Centralized in `shared/normalization-rules.json` specifying `rules_version: 1`, `max_input_length: 2000`, `max_tokens: 256`, and explicit 32-entry contraction expansion dictionary per Section 7.1 Rule 6.
    - Ambiguous contractions (`'s` and `'d`) remain literal per Section 7.1 Rule 7; homophones and numerals are preserved without equivalence.
  - **Identical Normalization Pipeline (TS & Python)**:
    - Step 1: Unicode NFKC normalization (`unicodedata.normalize('NFKC')` / `text.normalize('NFKC')`).
    - Step 2: Typographic apostrophe normalization (`’`, `‘`, `ʻ`, `ʼ`, backticks, and CP1252 `\x91`/`\x92` mapped to ASCII `'`).
    - Step 3–5: Token extraction matching letters and digits with internal apostrophes (`[^\W_]+(?:'[^\W_]+)*` / `/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu`). Hyphens and exterior punctuation serve as delimiters.
    - Display and Canonical token representation: `DisplayToken` preserves original casing and character offsets; `CanonicalToken` stores expanded lowercase tokens with `display_index` and `canonical_indices` mapping (e.g., `I've` maps 2 canonical tokens back to display token 0).
    - Graceful bounds & error handling: empty target raises error; empty input gracefully evaluates to all omissions ($D=N, S=0, I=0, \text{score}=0$); input text is clamped to 2000 characters and 256 tokens.
  - **Levenshtein Alignment & Deterministic Tie-Breaking**:
    - Full $(N+1) \times (M+1)$ matrix with unit edit costs ($M=0, S=1, D=1, I=1$).
    - Deterministic tie-breaking priority identically implemented: Diagonal (match/substitution) > Target Omission > Input Insertion.
    - Unified non-negative rounding: `floor(x + 0.5)` in both Python and TypeScript, eliminating Python's round-to-even discrepancy.
  - **Verification Against Shared Fixtures**:
    - 12 golden test cases in `shared/fixtures/alignment.json` executed and passing with 100% identical outputs across `backend/tests/test_aligner.py` (7 tests) and `frontend/tests/aligner.test.ts` (7 tests).
- **Rationale**: Strict compliance with Section 7.1, 7.2, 7.4, and Section 14.12 requirements.

---

### D-019: Backend Practice Sessions, Hints, Reveal, and Authoritative Check Endpoints
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 4.2, Section 4.3, Section 5.3, Section 5.4, Section 7.3, Section 14.13 (T12)
- **Decision**:
  - **Dictation Router Architecture (`dictation.py`)**:
    - `POST /api/segments/{id}/sessions`: Creates new practice sessions keyed by UUID; enforces idempotent reuse on identical `client_request_id` (200 OK) without duplicating rows; rejects conflicting segment IDs with 409 `IDEMPOTENCY_CONFLICT`.
    - `GET /api/sessions/{id}`: Returns complete session state including `hinted_display_indices`, `answer_revealed`, `last_input`, and `last_result`.
    - `POST /api/sessions/{id}/hint`: Validates requested `display_token_index` against target segment tokens; returns the initial letter of that target display token; idempotently appends to `hinted_display_indices`.
    - `POST /api/sessions/{id}/reveal`: Marks `session.answer_revealed = True`, records `segment.revealed_at`, unlocks shadowing (`shadowing_unlocked = True`), and strictly leaves `segment.completed_at` unmodified (`completed` retains prior state per Invariant 4.3.4).
    - `POST /api/sessions/{id}/check`:
      - Authoritative scoring via `app.services.aligner.align()`. Client input cannot dictate score or completion.
      - Idempotency: `client_request_id` and request payload hash prevent duplicate attempt rows on retries; conflicting payloads with the same request ID return 409 `IDEMPOTENCY_CONFLICT`.
      - Completion rules:
        - Exact check in an unrevealed session atomically marks `segment.completed_at = utc_now()`, sets `completed = True`, and marks `assisted = True` if any hints were used in the session.
        - Exact check in a revealed session records text accuracy (score=100, is_exact=True), but preserves `completed` in its prior state and never marks `segment.completed_at` (Invariant 4.3.5).
        - Inexact check on a previously completed segment never reverts completion status (Invariant 4.3.7).
        - Fresh sessions (via `POST /api/segments/{id}/sessions`) permit clean re-attempts of previously revealed segments, unlocking full completion upon exact unrevealed entry (Invariant 4.3.6).
      - Rejection of oversized input (>2000 chars) with 422 `INVALID_INPUT`.
  - **Testing & Verification**:
    - 10 comprehensive tests in `backend/tests/test_dictation.py` testing session creation, idempotency, hint letter extraction, reveal semantics, authoritative scoring, hint assisted flag, post-reveal copying guard, re-attempt in new session, duplicate attempt prevention, and oversized input rejection.
---

### D-020: Frontend Dictation Component, Shortcuts Map, and MVP Loop Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 7.3, Section 8.2, Section 8.4, Section 14.14 (T13), Gate G1
- **Decision**:
  - **Pedagogical Word Slots (`DictationBox.tsx`)**:
    - Target segment display tokens are extracted via shared `normalizeText(segment.text, false)`.
    - Hidden word placeholders render approximate written length dashes capped at eight characters (`Math.min(8, Math.max(2, token.text.length))`), avoiding visual leakage of long word lengths while giving helpful length guidance.
    - Zero answer leakage before completion/reveal: Target words are strictly never exposed in HTML `title`, `aria-label`, tooltips, or DOM attributes prior to explicit completion or answer reveal.
    - Matching feedback: Tokens matched in the latest authoritative server alignment highlight in emerald (`bg-emerald-500/20 text-emerald-400`).
    - Stale diff invalidation: As soon as the user modifies text in the input textarea, `staleDiffs[segment.id]` is flagged as `true`, immediately clearing green matched word highlights to prevent misleading validation of dirty drafts.
  - **Single Accessible Editor & Actions**:
    - Input is contained within a single accessible textarea with `Ctrl+Enter` check handler; individual slots are not separate inputs.
    - Hint action (`Alt+H` or Hint button): identifies the first display token not matched and not yet hinted; calls `POST /api/sessions/{id}/hint`; renders the first letter followed by length-minus-one dashes. Disabled when sentence is completed or revealed.
    - Reveal action (Reveal button): calls `POST /api/sessions/{id}/reveal`; exposes full sentence text in word slots with amber highlight (`bg-amber-500/20 text-amber-300`); unlocks shadowing studio.
    - "Try again" action: creates a fresh practice session via `POST /api/segments/{id}/sessions` and clears draft, allowing full unassisted re-attempts.
    - "Next sentence" CTA: appears upon completion or answer reveal, replacing auto-advance per Section 7.3 to enable smooth transition into shadowing practice.
  - **Single Shortcut Map (`useKeyboardShortcuts.ts`)**:
    - Unified keyboard shortcut mapping per Section 8.4:
      - `Alt+R`: Replay current sentence (triggers `replay()` on `VideoPlayerRef` via `forwardRef`/`useImperativeHandle`).
      - `Ctrl+Enter`: Check dictation inside editor.
      - `Alt+H`: Reveal first-letter hint.
      - `Alt+Left` / `Alt+Right`: Previous / next sentence navigation (prevents default browser back/forward page history; disabled during audio recording).
      - `Escape`: Closes shortcut help modal and warning dialogs.
      - `Tab` / `Shift+Tab`: Standard focus navigation never intercepted.
    - Built-in shortcuts modal accessible via keyboard trigger button with explicit visual mappings.
  - **Verification & Gate G1 Closure**:
    - 8 comprehensive unit & integration tests in `frontend/tests/DictationBox.test.tsx` verifying word slot capping, answer concealment, hints, reveals, exact check, inexact check, stale diff invalidation, fresh session creation, and shortcut modal operation.
    - 65/65 passing Vitest tests across 9 suites; 83/83 passing Pytest tests across 9 suites.
    - Full end-to-end browser execution recorded in `dictation_mvp_loop_1792769925632.webp`, verifying initial word slots (`dictation_box_initial_1792769997472.png`) and revealed/unlocked studio state (`dictation_revealed_state_1792771009989.png`).
- **Rationale**: Strict compliance with Section 7.3 pedagogical invariants, Section 8.2 and 8.4 UX specifications, and Gate G1 acceptance criteria.

---

### D-021: Local In-Browser Recording Architecture & Hardware Lifecycle
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 8.2, Section 14.15 (T14)
- **Decision**:
  - **Local Media Capture Lifecycle (`useRecorder.ts`)**:
    - Uses browser `MediaRecorder` with prioritized MIME type negotiation (`audio/webm;codecs=opus` preferred, falling back to `audio/webm`, `audio/ogg;codecs=opus`, `audio/mp4`).
    - Enforces a 30.0-second hard cutoff limit with 100ms granularity timer; recording terminates automatically at 30 seconds.
    - Zero local audio persistence: captured blobs are held strictly in memory and exposed via `URL.createObjectURL`. Audio blobs and URLs are never saved to `localStorage` or `sessionStorage`.
    - Object URL lifecycle is strictly tracked and revoked via `URL.revokeObjectURL` on unmount and when re-recording, preventing memory leaks.
    - Immediate hardware release: upon recording stop (`mediaRecorder.stop()`) or component unmount, all `MediaStreamTrack` hardware tracks are immediately stopped via `track.stop()`, turning off browser mic indicators without waiting for page navigation.
  - **Player Coordination & Navigation Guarding**:
    - Prior to media capture start (`onBeforeStart`), the YouTube video player is explicitly paused to prevent audio bleed into the mic recording.
    - Active recording synchronizes with global `useStudyStore.setIsRecording(true/false)`. Navigation away from the current segment triggers the `showRecordingWarning` dialog, protecting users against accidental audio loss.
    - Clear user-facing error messaging for `NotAllowedError`/`PermissionDeniedError` ("Microphone permission was denied. Please allow microphone access in your browser site settings and try again.") and `NotFoundError` ("No microphone device found.").
  - **Shadowing Studio UI (`ShadowingStudio.tsx`)**:
    - Locked state: when segment is incomplete and unrevealed, displays locked banner ("Complete or reveal the sentence to practice speaking") and disabled "Record Speech" button. Target text is concealed.
    - Unlocked state: rendered when segment is completed or revealed. Displays quoted target sentence, "Listen" button (replaying original video segment via `onListenOriginal`), and "Start Recording" button.
    - Active recording state: displays pulsing red indicator, "Recording Audio", elapsed time display (`00:05.2 / 00:30.0`), 30-second duration progress bar, and "Stop Recording" button.
    - Recorded state: displays native accessible `<audio>` element with blob playback, "Listen" original button, "Record again" button, and disabled "Evaluate speech" button (with tooltip "Speech recognition evaluation activates in T15/T16").
    - Pedagogical disclaimer per Section 8.2 visibly rendered: "Practice feedback estimated from speech recognition; it is not a phonetic pronunciation assessment."
  - **Testing & Verification**:
    - 12 comprehensive unit and integration tests in `frontend/tests/ShadowingStudio.test.tsx` verifying locked state, unlocked state, listen callback, player pause on recording start, MediaRecorder lifecycle, hardware track release (`track.stop()`), navigation guard synchronization, 30s auto-stop cutoff, object URL revocation, and permission/hardware error handling.
    - 77/77 passing Vitest tests across 10 test files; 83/83 passing Pytest tests across 9 suites; 0 TypeScript errors.
- **Rationale**: Strict compliance with Section 8.2 and Section 14.15 requirements, guaranteeing proper hardware resource cleanup, memory safety, and seamless integration between YouTube playback and speech capture.

---

### D-022: Audio Upload Validation, 16 kHz Mono Transcoding, and WaveSurfer Lifecycle
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 5.3, Section 8.2, Section 10.2, Section 14 (T15)
- **Decision**:
  - **Chunked Stream Upload & Sanitized Paths (`audio_service.py`)**:
    - Upload streaming enforces 64 KB chunk reading with an explicit byte counter.
    - Zero-byte files immediately return 422 `EMPTY_AUDIO`.
    - Files exceeding `settings.MAX_RECORDING_BYTES` (15 MiB = 15,728,640 bytes) trigger immediate abort with 413 `AUDIO_TOO_LARGE`.
    - Temporary files are keyed strictly by UUID/Job ID (`f"{job_id}.raw"` and `f"{job_id}.wav"`), entirely ignoring client-supplied filenames to prevent directory traversal or filesystem injection.
  - **Container & Format Verification via ffprobe**:
    - Executes `ffprobe` with distinct argument lists and 15s timeout.
    - Validates container against allowlist: WebM, Matroska, Ogg/Opus, WAV, MP4/M4A, AAC, FLAC.
    - Ensures at least one genuine audio stream is present; non-audio or corrupted payloads return 415 `UNSUPPORTED_AUDIO`.
  - **Deterministic 16 kHz Mono PCM WAV Transcoding**:
    - Executes `ffmpeg -y -i <raw> -vn -ac 1 -ar 16000 -c:a pcm_s16le <wav>` with 30s timeout and distinct argument lists.
    - Actual decoded duration is measured on the resulting WAV via `ffprobe`.
    - Bounds enforcement per Section 10.2: duration < 0.5s returns 422 `AUDIO_TOO_SHORT`; duration > 30.5s returns 422 `AUDIO_TOO_LONG`.
    - Temporary raw uploads are cleaned up immediately in `finally` blocks upon conversion.
  - **Shadowing Evaluation Endpoint & Job Handler**:
    - `POST /api/shadowing/evaluate` checks database for target segment (404 `RESOURCE_NOT_FOUND`) and confirms unlocked state (`completed_at is not None or revealed_at is not None`, returning 409 `SHADOWING_LOCKED` if locked).
    - Idempotency with `client_request_id` via `JobRunner.enqueue_job`. Duplicate submissions return existing jobs without re-uploading.
    - Background job handler `handle_shadowing_job` surfaces preliminary validated state: stage `"audio_validated"` (0.5), stage `"ready_for_asr"` (1.0), returning structured payload indicating ASR readiness for T16.
    - `GET /api/segments/{id}/shadowing-attempts` returns paginated attempt history.
  - **Frontend WaveSurfer Waveform & Job Polling (`ShadowingStudio.tsx`)**:
    - Interactive audio waveform rendered from local blob URL via lightweight `wavesurfer.js` v8.
    - Styled to FluentTube AI design system: slate background, cyan progress bar (`#38bdf8`), custom bar width/gap/radius.
    - WaveSurfer lifecycle: Play/Pause synchronization, graceful cleanup (`ws.destroy()`) on unmount and when re-recording, avoiding memory leaks.
    - "Evaluate speech" button submits multipart FormData to `/api/shadowing/evaluate` and polls status via `useJob(jobId)` every 1000ms until completion.
    - Renders progress spinner and capability/success banner when job completes.
  - **Testing & Verification**:
    - 10 comprehensive tests in `backend/tests/test_shadowing.py` verifying locked rejection, empty audio (422), oversized audio (413), spoofed container (415), short audio (422), long audio (422), valid conversion, path traversal protection, idempotency, and attempt history listing.
    - 14 tests in `frontend/tests/ShadowingStudio.test.tsx` verifying WaveSurfer mount/destroy, play/pause toggle, evaluation upload, polling, success banner, and error handling.
    - 93/93 Pytest tests passing; 79/79 Vitest tests passing; 0 TypeScript errors; production build in 3.79s.
- **Rationale**: Strict compliance with Section 5.3, Section 8.2, Section 10.2, and Section 14 (T15) requirements, guaranteeing robust audio sanitation, hardware-safe conversions, and clean UI lifecycles.

---

### D-023: Functional CPU ASR Engine Architecture, Lazy Singleton Loading, and Word Timestamp Extraction
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 10.1, Section 10.3, Section 14.17 (T16)
- **Decision**:
  - **Lazy Singleton Architecture (`whisper_engine.py`)**:
    - `WhisperEngine` encapsulates model loading with double-checked thread-locking (`_model_lock`).
    - The model is strictly NOT instantiated during application boot or on `/api/health` queries.
    - Resident model lifecycle: Exactly one model instance is loaded into memory. Warm calls reuse the existing resident instance (`id(m1) == id(m2)`).
    - Concurrency serialization: Speech inference runs exclusively in worker threads dispatched by `JobRunner`, protected by an internal inference lock (`_inference_lock`) to prevent concurrent CTranslate2 thread contention on CPU.
  - **Generator Eager Consumption & Word-Level Timestamps**:
    - `faster_whisper.WhisperModel.transcribe(..., word_timestamps=True)` returns a generator of segments. The engine eagerly consumes this generator to completion within a try/except block, ensuring iterator failures or decoding faults are surfaced as `SPEECH_TRANSCRIPTION_FAILED` rather than leaking silently.
    - Word tokens are mapped into structured dictionaries containing `word`, `start`, `end`, and `probability`.
  - **Health Check Decoupling**:
    - `/api/health` queries `whisper_engine.get_health_status()`, returning `model_loaded: bool`, `device: str`, `model_name: str`, and `model_cached: bool` without loading the model or accessing the network.
  - **Standardized Execution Telemetry**:
    - Logs structured telemetry per Section 10.3: `model`, `device`, `compute_type`, `audio_duration_s`, and `inference_time_ms`.
  - **Actionable Error & Fallback Model Support**:
    - Non-existent or empty audio files return 422 `EMPTY_AUDIO`.
    - Uncached/missing models return 400 `MODEL_UNAVAILABLE` with guidance on pre-downloading models.
    - Test harness supports `set_mock_transcriber` for zero-overhead unit testing, alongside real cached model integration tests.
  - **Testing & Real CPU Benchmark**:
    - 6 comprehensive tests in `backend/tests/test_whisper_engine.py` verifying lazy loading isolation from health check, warm model instance reuse, empty audio rejection, generator exception capture, model missing error handling, and real CPU execution.
    - Real benchmark against cached `tiny.en` on CPU (int8): transcribed 1.0s speech audio in 1260 ms cold and 364 ms warm with full word-level timestamps.
    - 99/99 Pytest tests passing across 11 suites; 79/79 Vitest tests passing across 10 suites; 0 TypeScript errors.
- **Rationale**: Strict compliance with Section 10.1, Section 10.3, and Section 14.17 (T16) requirements.

---

### D-024: Benchmarked CUDA Acceleration, Windows Runtime DLL Registration, and Dynamic Fallback Lifecycle
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 10.3, Section 10.5, Section 14.18 (T17)
- **Decision**:
  - **Host GPU & Runtime Compatibility**:
    - Identified genuine host GPU: NVIDIA GeForce RTX 3050 Laptop GPU (4096 MB VRAM, Driver 566.07, CUDA 12.7).
    - Pinned and installed NVIDIA runtime packages in `backend/requirements.in`: `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` (CUDA 12 / cuDNN 9) per Section 10.3.
    - Verified CTranslate2 4.8.3 native support for CUDA `int8_float16` precision alongside `bfloat16`, `float16`, `int8`, and `float32`.
  - **Dynamic Windows Runtime DLL Registration (`_ensure_nvidia_dll_paths`)**:
    - Implemented automatic runtime scanning of `site-packages/nvidia/*/bin` registering directories with `os.add_dll_directory()` and prepending them to `os.environ["PATH"]`.
    - Eliminates Windows `cublas64_12.dll` and `cudnn64_9.dll` missing DLL runtime failures without requiring global system-wide environment modifications.
  - **Strict Device Mode Transitions & Fallback Policies**:
    - `cpu`: Directly instantiates CPU model (`settings.SPEECH_CPU_MODEL`, compute_type `int8`) without touching CUDA.
    - `cuda`: Mandatory GPU execution. If CUDA initialization or execution fails, strictly refuses silent downgrade to CPU; unloads failed model references and raises `AppException(500, "CUDA_INITIALIZATION_FAILED")` with full diagnostic details.
    - `auto`: Attempts CUDA with `int8_float16`. If unavailable or initialization throws, logs structured fallback warning, marks `_fallback_active = True`, dereferences the failed model (`_unload_resident_model()`), and loads the CPU fallback model.
    - In-flight execution recovery: If a CUDA exception or OOM occurs during `transcribe()` in `auto` mode, catches the exception, engages single-attempt CPU fallback, re-executes transcription on CPU, and fulfills the request.
  - **Single Resident Model Invariant**:
    - Exactly one model is resident in memory at any given time. `load_model()` and fallback routines explicitly clear `self._model = None` and execute `gc.collect()` before instantiating a new `WhisperModel`.
  - **Diagnostics & Benchmark Evidence**:
    - Created `backend/check_environment.py` reporting Python, FFmpeg, CTranslate2, CUDA device count, GPU VRAM, compute types, and cached models.
    - Created `backend/benchmarks.py` and generated real benchmark evidence in `docs/benchmarks-t17.json`:
      * Cold load: CPU 873.7 ms vs. GPU 498.3 ms (1.75x faster).
      * 1.0s audio: CPU avg warm 1,375.2 ms vs. GPU avg warm 120.3 ms (**11.4x speedup** on GPU).
      * 5.0s audio: CPU avg warm 4,325.8 ms vs. GPU avg warm 2,122.5 ms (2.04x speedup on GPU).
      * 10.0s audio: CPU avg warm 4,485.8 ms vs. GPU avg warm 2,150.1 ms (2.09x speedup on GPU).
  - **Testing & Verification**:
    - 11 comprehensive tests in `backend/tests/test_whisper_engine.py` covering health isolation, warm reuse, single model residency, mandatory CUDA without downgrade, auto mode CPU fallback on failure, disabled fallback rejection, in-flight OOM recovery, empty audio rejection, iteration exception handling, real CPU execution, and real CUDA GPU execution on RTX 3050.
    - 104/104 passing Pytest tests across 11 suites; 79/79 passing Vitest tests across 10 suites; 0 TypeScript errors; bundle built in 2.45s.
- **Rationale**: Strict compliance with Section 10.3, Section 10.5, and Section 14.18 (T17) requirements.

---

### D-025: Ingestion ASR Fallback, Word-Boundary Segmentation, Audio Caching, and Atomic Persistence
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 6.3, Section 6.4, Section 8.2, Section 10.3, Section 14.19 (T18)
- **Decision**:
  - **Ingestion ASR Fallback Orchestration (`youtube_service.py`)**:
    - When YouTube English captions (manual or auto-generated) are missing (`SUBTITLES_NOT_FOUND`) OR when explicit `force_gpu_whisper=True` is provided via ingestion payload, the ingestion pipeline automatically invokes the local ASR fallback pipeline instead of failing.
    - Strict Section 6.3 Rule 7 preservation: unpunctuated captions DO NOT trigger audio download or ASR fallback; they proceed directly through caption deduplication and regex boundary heuristics.
  - **Audio Download & Local Cache**:
    - `download_youtube_audio()` extracts best audio stream via `yt-dlp`, converts to `.m4a`/`.mp3` using FFmpeg, and caches at `media_cache/audio/<youtube_id>.<ext>`.
    - Employs atomic write via `.part` temporary files, preventing incomplete audio reads.
    - Enforces 250 MiB file size safety ceiling and skips re-downloading if valid cached audio is already present.
  - **Word-Boundary ASR Segmentation (`segmenter.py`)**:
    - Implemented `segment_asr_result()` strictly complying with Section 6.4:
      * Clamps segment boundaries strictly to word edges (`start = words[0].start`, `end = words[-1].end`).
      * Natural pause splits on inter-word silence gaps > 1.2s.
      * Maximum segment size threshold of 18 words or 10.0s duration.
      * Punctuation splits on terminal marks (`.`, `?`, `!`) preserving common abbreviations (`Mr.`, `Dr.`, `U.S.`) and decimal numbers.
      * Records `timing_quality="word"` for fine-grained playback synchronization.
  - **Atomic Transaction Rollback & Invariant 4.3.1**:
    - All video metadata, segment records, and relative audio file paths are committed atomically.
    - If audio download fails, Whisper model fails to load (`MODEL_UNAVAILABLE`), or segmentation fails, the database transaction is cleanly rolled back and job state marked `failed`. Zero orphaned video or segment records are created.
  - **Frontend Ingestion Controls & Badge Differentiation**:
    - `VideoLoaderModal.tsx`: Added Section 8.2 checkbox "Use local transcription for this new video" (`force_gpu_whisper`), granular ASR job progress stage indicators (`downloading_audio`, `loading_model`, `transcribing`, `segmenting`, `saving`), and descriptive error messaging.
    - `LibraryPage.tsx`: Renders distinct sky-accented `'Local ASR'` badge when `transcription_source === 'local_asr'` alongside standard duration and level indicators.
  - **Testing & Verification**:
    - Added 5 comprehensive integration tests in `backend/tests/test_videos.py` covering captionless fallback, forced ASR bypassing subtitles, download failure rollback, model unavailable rollback, and unpunctuated subtitle preservation.
    - 109/109 Pytest tests passing across 11 suites; 79/79 Vitest tests passing across 10 suites; 0 TypeScript errors; bundle built in 2.38s.
- **Rationale**: Strict compliance with Section 6.3, Section 6.4, Section 8.2, Section 10.3, and Section 14.19 (T18) requirements.

---

### D-026: Speech Feedback Assessment, Display Token Badge Grouping, Attempt Persistence, and Segment Isolation
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 8.2, Section 10.4, Section 14.20 (T19)
- **Decision**:
  - **Speech Assessment Engine (`assessment.py`)**:
    - Implemented Section 10.4 exact scoring formulas:
      * Word match score: $100 \times \max(0, 1 - (S+D+I)/N)$ with insertions ($I$) directly penalizing score; clamped to $[0, 100]$.
      * Timing similarity score: $100 \times \max(0, 1 - |spoken - reference| / \max(reference, 1.5))$, comparing durations without claiming prosodic or phonemic fluency.
      * Overall score: $0.70 \times word + 0.30 \times timing$ when timing is valid; falls back to $word$ with warning `TIMING_UNAVAILABLE` when timestamps are absent.
      * Unscorable silence: When no speech is recognized (empty text or words), sets status to `unscorable` and all three scores to `null` with warning `NO_SPEECH`, avoiding fake or punitive grades.
  - **Display Token Badge Grouping & Legend**:
    - Target display tokens assessed into four distinct states:
      * `matched`: all canonical tokens matched with ASR confidence $\ge 0.75$ (Recognized, green).
      * `uncertain`: all matched but some confidence $< 0.75$ or missing, OR mixed match/omission without substitution (Uncertain, amber).
      * `substituted`: any substitution present (Different, red).
      * `omitted`: all tokens omitted (Missing, slate).
    - Contractions: expanded canonical tokens from a single ASR word inherit the parent word's probability and reference time bounds without artificial sub-word timestamps.
    - Insertions: surfaced as extra detected words with ASR confidences.
    - Surfaced recognized transcript: rendered verbatim so users can detect speech recognition errors.
    - Word status legend rendered cleanly: Recognized / Uncertain / Different / Missing.
  - **Asynchronous Job Execution & Database Persistence (`shadowing_service.py`)**:
    - `handle_shadowing_job` transcribes via `whisper_engine.transcribe()`, evaluates speech via `assess_shadowing()`, persists `ShadowingAttempt`, updates job progress stages (`audio_validated` $\to$ `transcribing_speech` $\to$ `evaluating_speech` $\to$ `saving_attempt` $\to$ `completed`), and cleans up intermediate WAV audio in a `finally` block.
    - Dynamic engine parameter support allows seamless execution across both in-memory test databases and application SQLite engines.
  - **Frontend State & Multi-Segment Isolation (`ShadowingStudio.tsx`, `useStudyStore.ts`)**:
    - Added `shadowingResults` and `shadowingJobs` keyed by `segment_id` in `useStudyStore`.
    - Delayed evaluation results for segment $A$ are stored strictly for segment $A$ and never bleed into adjacent segment $B$.
    - "Record again" preserves previously stored evaluation results while discarding the active recording blob.
    - Section 8.2 disclaimer visible: *"Practice feedback estimated from speech recognition; it is not a phonetic pronunciation assessment."*
  - **Testing & Verification**:
    - 8 dedicated unit tests in `backend/tests/test_assessment.py` verifying all Section 10.4 golden fixtures ($N=4, S=1 \implies 75$; $N=4, I=1 \implies 75$; ref=3.0s, spoken=2.4s $\implies 80$; word=100, timing=80 $\implies 94$; silence $\implies$ unscorable nulls; low confidence $\implies$ word=100 with uncertain badge).
    - 10 integration tests in `backend/tests/test_shadowing.py` verifying upload validation, audio conversion, job execution, and DB persistence.
    - 17 tests in `frontend/tests/ShadowingStudio.test.tsx` verifying full UI score breakdown, token badges, legend, extra words, unscorable feedback, and segment isolation.
    - 117/117 Pytest tests passing across 12 suites; 82/82 Vitest tests passing across 10 suites; 0 TypeScript errors; bundle built in 3.21s.
- **Rationale**: Strict compliance with Section 8.2, Section 10.4, and Section 14.20 (T19) requirements.

---

### D-027: Contextual LLM Grammar Tutor Contract, Structured Output, Gemini Client, and Cache Architecture
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 5.3, Section 11, Section 14.21 (T20)
- **Decision**:
  - **Single Canonical Public Response Schema**:
    - Validated through Pydantic `TutorExplanationDTO` and `TutorExplanationContent` matching Section 11:
      `{ segment_id, language, contextual_meaning, key_vocabulary, connected_speech, example, cached, provider, model }`.
    - Strict boundary and length limits: `contextual_meaning` $\le 1200$ chars; max 8 `key_vocabulary` items (types: `phrasal_verb | idiom | slang | grammar | word`) with 600-char explanations; max 5 `connected_speech` items with 600-char tips; `example.sentence` $\le 300$ chars and `example.explanation` $\le 600$ chars.
    - Synchronized TypeScript interfaces added to `frontend/src/api/types.ts`.
  - **Zero-Key Safe Fallback & Disabled Tutor Policy**:
    - `config.py` defines `TUTOR_ENABLED=false`, `TUTOR_PROVIDER=gemini`, `TUTOR_MODEL=gemini-2.5-flash`, `GEMINI_API_KEY=`, `TUTOR_TIMEOUT_SECONDS=30`.
    - Booting and importing the application core (`main.py`, `config.py`, `llm_tutor.py`) requires zero credentials or cloud keys.
    - When disabled or unconfigured (`TUTOR_ENABLED=False` or `GEMINI_API_KEY` empty/None), `POST /api/tutor/explain` immediately returns clean 503 `TUTOR_DISABLED` without making network calls.
    - `/api/health` dynamically reflects `tutor: { enabled: bool, provider: Optional[str] }`.
  - **Modern SDK Client & Lazy Initialization**:
    - Adopted `google-genai` (`2.33.0`) SDK (not deprecated `google-generativeai`).
    - `GeminiTutorClient` is lazily instantiated only upon actual query execution.
    - Configures native structured output via `response_mime_type="application/json"` and `response_schema=TutorExplanationContent`.
    - Configures 30s timeout via `HttpOptions(timeout=30000)`.
    - Maps provider errors without retry loops: 429 $\to$ 429 `TUTOR_QUOTA_EXCEEDED`, 401/403 $\to$ 502 `TUTOR_AUTH_ERROR`, timeout $\to$ 504 `TUTOR_TIMEOUT`.
  - **Prompt Design & Untrusted User Input**:
    - System instruction strictly follows Section 11: B2 student role, neighboring sentences used solely as context, untrusted user input instruction guard, output exclusively valid JSON matching schema, text-only connected speech notice.
    - User payload formatted explicitly as untrusted data (`{"previous": ..., "target": ..., "next": ..., "explanation_language": ...}`); prompt injections (e.g. `"Ignore previous instructions"`) are treated purely as inert data strings.
  - **3-Sentence Context Window & Boundary Handling**:
    - Extracts strictly 3 sentences (`previous`, `target`, `next`). Boundary at start sets `previous = None`; boundary at end sets `next = None`. Never transmits full transcripts, audio, user history, or metadata.
  - **Context Hashing & TutorCache Persistence**:
    - Deterministic SHA-256 hash computed over: `previous + target + next + language + provider + model + prompt_version`.
    - Unique across identity fields in `TutorCache` table (`uq_tutor_cache`).
    - Cache hit returns immediately with `cached=True` without acquiring semaphore or calling LLM client.
    - Cache invalidates on changes to sentences, language, model, or prompt version.
    - Invalid responses or errors are never cached as successes.
  - **Concurrency & Structured Repair Retry**:
    - LLM invocation concurrency strictly capped at 1 via `asyncio.Semaphore(1)` to prevent runaway costs.
    - A single structured repair retry is executed if JSON decoding or schema validation fails. If the second response also fails, returns 502 `TUTOR_INVALID_RESPONSE` without infinite loops.
  - **API Contract & Segment Unlock Enforcement**:
    - `POST /api/tutor/explain` validates that the target segment exists (404 `RESOURCE_NOT_FOUND`) and is unlocked via completion or answer reveal (409 `SEGMENT_LOCKED`).
  - **Testing & Verification**:
    - 15 comprehensive unit & integration tests in `backend/tests/test_tutor.py` covering zero-key import, 503 disabled, 404 not found, 409 locked, 3-sentence boundaries, hash determinism, schema validation, cache hit/miss, single repair retry success, repair failure (502), quota (429), auth (502), timeout (504), and prompt injection resistance.
    - 132/132 Pytest tests passing across 13 suites; 82/82 Vitest tests passing across 10 suites; 0 TypeScript errors; bundle built in 2.75s.
- **Rationale**: Strict compliance with Section 5.3, Section 11, and Section 14.21 (T20) requirements.

---

### D-028: Contextual Grammar Tutor Drawer, Settings & Diagnostics, Local Preferences, and Answer Concealment
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 8.2, Section 8.4, Section 11, Section 14.22 (T21), Gate G3
- **Decision**:
  - **Slide-Out Grammar Tutor Drawer (`GrammarTutorDrawer.tsx`)**:
    - Accessible dialog drawer with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="tutor-drawer-title"`, and backdrop overlay.
    - Full keyboard navigation: `Escape` key closes the drawer; focus is captured on open and restored to the trigger button upon close via `triggerButtonRef`.
    - Five comprehensive visual states:
      1. `disabled`: Rendered when `tutor.enabled === false` (derived from `/api/health`). Displays amber notice explaining that the tutor is optional and requires Gemini API key in `backend/.env`, with a direct CTA button to `#/settings`.
      2. `idle`: Rendered when tutor is available but unqueried for the active segment. Displays target sentence, explanation language selector (`es`, `fr`, `de`, `ja`, `pt`), "Explain this sentence" CTA button, and clear cloud transmission disclaimer.
      3. `loading`: Rendered during in-flight generation. Displays animated spinner and "Analyzing grammar & idioms..." message; controls disabled.
      4. `ready`: Rendered upon successful explanation retrieval. Presents structured pedagogical breakdown:
         - Contextual meaning card with book icon.
         - Key vocabulary items with color-coded grammar badges (`phrasal_verb`, `idiom`, `slang`, `grammar`, `word`).
         - Connected speech pronunciation tips with speaker icon and text-only derivation disclaimer (*"Pronunciation tips are deduced from text grammar, not microphone audio"*).
         - Example usage card with lightbulb icon and blockquote.
         - Discrete cache indicator (*"Cached response"* vs *"Generated live"*) and provider/model badge.
      5. `error`: Rendered on failure (e.g., 429 quota, 504 timeout, 502 auth error, 503 disabled). Displays error banner with retry button.
    - Security & Sanitization: Strict adherence to Section 11. All content is rendered as safe, sanitized React text nodes. Zero usage of `dangerouslySetInnerHTML`.
    - Cloud Transmission Guard: Prominently warns users before transmission: *"Only this sentence and its immediate neighbors are sent to Google Gemini for pedagogical explanation. No personal audio or video is transmitted."*
  - **Sentence Unlock & Answer Concealment Enforcement**:
    - Study Page workspace enforces Section 8.2 answer concealment: The "Explain sentence" trigger button is strictly disabled (`disabled={!isSegmentUnlocked}`) and styled with a lock icon until the segment is either completed (`segment.completed`) or revealed (`segment.revealed`).
    - Tooltip clearly states *"Complete or reveal the sentence to unlock grammar explanation"* when locked.
  - **Local Settings & System Diagnostics (`SettingsPage.tsx`, `useSettingsStore.ts`)**:
    - `useSettingsStore` manages client preferences persisted to `localStorage` under key `fluenttube_user_preferences`:
      * `playbackSpeed`: default 1.0x (options: 0.75, 0.85, 1.0, 1.25).
      * `autoLoop`: default true.
      * `soundEffect`: default true.
      * `explanationLanguage`: default `'es'` (Spanish).
    - `SettingsPage.tsx` displays live system health diagnostics polled from `GET /api/health`:
      * Backend API Server (`ok`).
      * SQLite Database (`ok`).
      * FFmpeg availability (`Installed & Operational` vs `Missing`).
      * Local Speech ASR Engine (device, resident model, compute type, state).
      * Contextual AI Tutor (status, provider, active model).
    - Security Guard: Strictly adheres to Section 8.2. The frontend does NOT render password or secret key inputs for API keys. Instead, the Settings page displays clean instructions for configuring `backend/.env`.
  - **Testing & Gate G3 Verification**:
    - 9 comprehensive unit tests in `frontend/tests/GrammarTutorDrawer.test.tsx` verifying slide-out rendering, escape key close, backdrop click close, disabled state, idle state, explain API trigger and structured layout, cached indicator, error retry, and focus restoration.
    - 5 tests in `frontend/tests/SettingsPage.test.tsx` verifying health indicators, local preferences toggle, and security guidance without secret inputs.
    - 4 tests in `frontend/tests/App.test.tsx` verifying routing to `#/settings`.
    - 8 tests in `frontend/tests/StudyWorkspace.test.tsx` verifying locked explain button and drawer opening.
    - Total test suite: 98/98 passing Vitest tests across 12 suites; 132/132 passing Pytest tests across 13 suites; 0 TypeScript errors; bundle built in 2.40s.
- **Rationale**: Strict compliance with Section 8.2, Section 8.4, Section 11, Section 14.22 (T21), and Gate G3 acceptance criteria.

---

### D-029: Removal of Anki Feature and Codebase Cleanup per User Requirement
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 5.3, Section 12, Section 14.23 (T22), Section 14.24 (T23), Gate G4
- **Decision**:
  - **Removal of Anki Integration**:
    - By explicit user requirement, the Anki / AnkiConnect feature and export pipeline are removed from the project scope.
    - Tasks T22 (Card CRUD) and T23 (Anki Export with Audio) and Gate G4 are omitted.
  - **Complete Codebase Cleanup**:
    - `backend/app/models.py`: Removed `AnkiCard` model and the `Segment.anki_card` one-to-one relationship. Updated `Job.kind` description to `"ingest | shadowing"`.
    - `backend/app/schemas.py`: Removed `AnkiCardCreateDTO`, `AnkiCardUpdateDTO`, `AnkiCardDTO`, and `AnkiExportRequestDTO`. Updated `JobDTO.kind` description to `"ingest | shadowing"`.
    - `backend/tests/test_database.py`: Removed `test_anki_card_unique_constraint` and `AnkiCard` import.
    - `frontend/src/api/types.ts`: Updated `JobKind` union type from `'ingest' | 'shadowing' | 'anki_export'` to `'ingest' | 'shadowing'`.
    - `frontend/src/pages/StudyPage.tsx`: Cleanly removed preliminary "Save sentence" and "Saved cards" action triggers and their unused Lucide icons (`Bookmark`, `Layers`).
    - `docs/contracts.md`: Removed `anki_export` from Job DTO contract.
  - **Dependencies**:
    - Zero external Anki dependencies: `genanki` was never installed or listed in `backend/requirements.in`.
  - **Verification**:
    - 131/131 Pytest backend tests passing with 0 errors.
    - 98/98 Vitest frontend tests passing across 12 suites with 0 errors.
    - Production bundle builds cleanly in 2.37s with 0 errors.
- **Rationale**: Direct user instruction to remove the Anki feature without introducing third-party AnkiConnect clients or deck export overhead.

---

### D-030: Local Launcher Architecture, Process Management, Diagnostics, and Documentation
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 13.3, Section 14.24 (T24)
- **Decision**:
  - **Reproducible Windows Launchers (`start_local.bat`, `scripts/start_local.ps1`)**:
    - `start_local.bat` delegates via `%~dp0` using script-relative paths and quoted arguments to handle paths containing spaces.
    - `scripts/start_local.ps1` executes sequential startup steps:
      1. Runtime environment verification: verifies Python 3.11 (`backend/.venv/Scripts/python.exe`), Node.js, npm, and FFmpeg in `PATH`.
      2. Strict port availability: checks ports 8000 (Backend) and 5173 (Frontend). If either port is occupied, reports the conflicting process PID with actionable instructions and exits with code 1 without terminating arbitrary processes.
      3. Process launch & PID tracking: launches backend (single worker, no `--reload` in standard launcher) and frontend (`npm run dev` with strictPort 5173). Persists tracked PIDs to `logs/fluenttube_pids.json`.
      4. Log outputs: separates stdout/stderr into dedicated `logs/backend.log` and `logs/frontend.log` (ignored by Git).
      5. Health probing & browser launch: polls `http://127.0.0.1:8000/api/health` and `http://127.0.0.1:5173` until healthy, then automatically launches the user's default browser.
  - **Graceful Shutdown (`stop_local.bat`, `scripts/stop_local.ps1`)**:
    - Reads `logs/fluenttube_pids.json`.
    - Enforces process identity verification: inspects process name (`python`, `node`, `cmd`, `npm`, `powershell`) to protect unrelated system applications from recycled PIDs.
    - Terminates strictly self-launched service process trees (`taskkill /PID $pid /T /F` or `Stop-Process`) without blanket `taskkill /IM python.exe`.
    - Cleans up `logs/fluenttube_pids.json`.
  - **Comprehensive System Diagnostics (`backend/check_environment.py`)**:
    - Supports human-readable CLI output and `--json` format.
    - Dynamically injects project root into `sys.path` to ensure reliable standalone execution regardless of invocation directory.
    - Evaluates: Python compatibility, FFmpeg & ffprobe availability, CTranslate2 version, CUDA device count, NVIDIA GPU name & VRAM, CPU & CUDA compute types (including `int8_float16`), SQLite database connectivity (`init_db`), cached Faster-Whisper models, and AI tutor configuration status.
  - **Top-Level `README.md`**:
    - Complete, production-grade documentation detailing project overview, multi-modal pedagogical workflow (Dictation, Shadowing, Contextual Tutor), system requirements, one-click Windows launcher, manual setup, testing commands, configuration options, documented operational limits (ASR, YouTube, Tutor), and troubleshooting FAQ.
  - **Testing & Verification**:
    - 4 dedicated unit tests in `backend/tests/test_scripts.py` verifying diagnostic report structure, occupied port collision detection and non-destructive guard, PID tracking with owned process termination, and process identity verification guarding unrelated system processes.
    - Total test suite: 135/135 passing Pytest tests across 13 suites; 98/98 passing Vitest tests across 12 suites; 0 TypeScript errors; bundle built in 2.37s.
- **Rationale**: Strict compliance with Section 13.3 and Section 14.24 (T24) requirements.

---

### D-031: Comprehensive V1 Portfolio Delivery, Acceptance Walkthroughs, and Gate G5 Closure
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 14.25 (T25), Section 15 (Acceptance Matrix), Section 16 (Traceability), Gate G5
- **Decision**:
  - **Full Milestone Delivery**:
    - Completed Task T25 (Comprehensive Review and Portfolio Delivery) and closed **Gate G5 (V1 Delivery)**.
    - Verified all 22 mandatory walkthroughs (A01 through A22) in the executable specification matrix (with A18–A20 formally omitted per user decision D-029).
  - **Documentation Artifacts**:
    - Created `docs/validation.md`: Comprehensive traceability matrix, test verification logs, security audit, viewport responsiveness verification (1440px desktop, 768px tablet, 390px mobile), and documented operational boundaries.
    - Created `docs/benchmarks.md`: Structured performance telemetry documenting real measured ASR speedups (11.4x acceleration on RTX 3050 GPU via `int8_float16`), model loading times, and video playback temporal calibration (p95 = 78 ms).
    - Verified `README.md` accurately reflects all implemented capabilities and architecture.
  - **Verification & Zero Defect Guarantee**:
    - Zero P0/P1 defects remaining.
    - Backend Pytest: 135/135 tests passing across 13 suites.
    - Frontend Vitest: 98/98 tests passing across 12 suites.
    - Total: 233 automated unit and integration tests passing with 0 errors.
    - Production build: clean compilation in 2.37s with 0 TypeScript errors.
- **Rationale**: Full compliance with Section 14.25 (T25) and Gate G5 acceptance criteria.

---

### D-032: Windows PowerShell 5.1 Launcher Encoding and BasicParsing Compatibility
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 13.3, Section 14.24 (T24), `scripts/start_local.ps1`, `scripts/stop_local.ps1`
- **Decision**:
  - **100% 7-Bit Pure ASCII Encoding in Launchers**:
    - Discovered that Windows PowerShell 5.1 (`powershell.exe`) defaults to Windows-1252 ANSI encoding when parsing scripts without a UTF-8 BOM. Multi-byte UTF-8 sequences such as the em-dash `—` (`0xE2 0x80 0x94`) cause quotation character misalignment, causing PowerShell to interpret string literals as code expressions (triggering `AmpersandNotAllowed` on `&` characters, unexpected token on parentheses, and missing terminator errors).
    - Replaced all em-dashes `—` with standard ASCII hyphens `-`, and sanitized all status messages to use plain ASCII (e.g. `and` instead of `&`). Verified zero bytes $\ge 128$ across all launcher files (`scripts/start_local.ps1`, `scripts/stop_local.ps1`, `start_local.bat`, `stop_local.bat`).
  - **`-UseBasicParsing` on Web Requests**:
    - Added `-UseBasicParsing` to all `Invoke-WebRequest` and `Invoke-RestMethod` calls in `scripts/start_local.ps1`. In Windows PowerShell 5.1 on modern Windows systems where Internet Explorer is deprecated, `Invoke-WebRequest` without `-UseBasicParsing` attempts to initialize the legacy IE COM engine, causing requests to hang indefinitely. With `-UseBasicParsing`, requests execute and return HTTP 200 within milliseconds.
  - **Resilient Port-Based Process Cleanup**:
    - Enhanced `scripts/stop_local.ps1` with supplementary port-listener detection for ports 8000 (Backend) and 5173 (Frontend). If tracked PIDs in `fluenttube_pids.json` have changed due to child worker spawning (`uvicorn` or `npm` vite workers), `stop_local.ps1` safely inspects process identity (`python`, `node`) on listening ports and terminates only owned services, guaranteeing clean shutdowns without orphaned processes.
- **Rationale**: Guarantees seamless one-click local startup on any default Windows installation without requiring manual PowerShell encoding configurations.

---

### D-033: Adoption of Standard Root `npm run dev` Workflow & Elimination of `.bat` Scripts
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 13.3, Section 14.24 (T24), `package.json`, `README.md`
- **Decision**:
  - **Eliminate `.bat` files**: Removed `start_local.bat` and `stop_local.bat` per explicit user preference for standard JavaScript/Node ecosystem development tooling.
  - **Root `package.json` with `concurrently`**: Created root `package.json` with `concurrently` managing concurrent execution of both FastAPI/Uvicorn backend and Vite React frontend with live reloading.
  - **Standard Scripts**:
    - `npm run dev`: Runs `dev:backend` and `dev:frontend` concurrently with colored tags `[backend]` and `[frontend]`. Single `Ctrl+C` halts both processes.
    - `npm run dev:backend`: Starts Uvicorn with `--reload` on `127.0.0.1:8000`.
    - `npm run dev:frontend`: Starts Vite on `127.0.0.1:5173`.
    - `npm run test`: Runs both backend pytest and frontend vitest test suites.
    - `npm run check-env`: Runs hardware and model environment diagnostic script.
- **Rationale**: Eliminates OS shell quirks and aligns the workflow with modern developer expectations.

### D-034: Gemini Model Migration to `gemini-3.5-flash` with Multi-Model Fallback
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Section 11, Section 14.20 (T20), `backend/app/config.py`, `backend/app/services/llm_tutor.py`, `backend/.env.example`
- **Decision**:
  - **Model ID Deprecation Remediation**: Google sunset `models/gemini-2.5-flash` for new users/keys (returning 404 NOT_FOUND). Updated default `TUTOR_MODEL` to `gemini-3.5-flash`.
  - **Graceful Multi-Model Fallback**:
    - `GeminiTutorClient.generate_text` implements an automated candidate fallback list (`[configured_model, "gemini-3.5-flash", "gemini-3.8-flash"]`).
    - Legacy references to `gemini-2.5-flash` are automatically upgraded to `gemini-3.5-flash` at runtime.
    - If a model encounters temporary deprecation (404) or high-demand unavailability (503/504), the client automatically tries fallback models without failing the user request.
- **Rationale**: Guarantees high availability and zero downtime for users regardless of Google model rollout schedules and demand spikes.

---

### D-035: Reactive Live Dictation, Double-Tab Hint System, and Zero-Token British English Audio & Dictionary Stack
- **Date**: 2026-10-23
- **Status**: Accepted
- **Affected Sections**: Dictation flow, Audio/TTS, Dictionary lookups, `frontend/src/components/DictationBox.tsx`, `frontend/src/pages/StudyPage.tsx`, `frontend/src/components/BritishInspector.tsx`, `backend/app/routers/british.py`, `backend/app/services/british_service.py`, `backend/app/models.py`
- **Decision**:
  - **Live Reactive Dictation & Auto-Advance**:
    - Real-time client-side prefix matching using canonical token normalizer without requiring manual "Check" button clicks.
    - Live emerald highlights for matched tokens directly above the input box as the learner types.
    - Double-Tab shortcut (`Tab + Tab` within 500 ms) automatically inserts and reveals the exact next missing word without losing focus on the input box.
    - Automatic segment completion and auto-advance when 100% exact match is achieved.
    - Integrated shadowing mic shortcut button `[🎤]` directly in the Dictation header for seamless dictation-to-shadowing transition.
  - **Zero-Token, Zero-VRAM British Stack**:
    - High-fidelity British neural speech using `edge-tts` with `en-GB-RyanNeural`, requiring 0 GPU VRAM and 0 token cost.
    - Audio cached on disk under `media_cache/tts_uk/` and streamed through `GET /api/british/audio?text={text}`.
    - Multi-tier dictionary lookup: Local SQLite `DictionaryCache` table first (0 ms), Free Dictionary API secondary fallback, and Datamuse API (`api.datamuse.com`) tertiary fallback.
    - Captures British IPA phonetics (`phonetic_uk`), definitions, parts of speech, and usage examples.
  - **Unified 3-Column Responsive Workspace (`StudyPage.tsx`)**:
    - Left column (`lg:col-span-5 xl:col-span-4`): YouTube player with video bounds clamping + Anti-spoiler transcript with masked dots.
    - Center column (`lg:col-span-7 xl:col-span-5`): Live reactive dictation box with keyboard hints and docked Shadowing Studio.
    - Right column (`lg:col-span-12 xl:col-span-3`): Fixed British Study Inspector with instant click-to-lookup dictionary, British pronunciation audio player, and B2 Connected Speech Tutor tab.
- **Rationale**: Eliminates dictation interaction friction (matching the fluidity of FluentDictation) while maintaining 100% free, zero-VRAM, zero-token local operation for vocabulary and audio lookups.










