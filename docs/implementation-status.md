# FluentTube AI Implementation Status
Specification: V2
Last Updated: 2026-10-23T13:28:00Z

## Active Decisions
- D-001: Strict adherence to V2 Specification architecture, one task per turn execution model (T00–T25).
- D-002: Python 3.11 target installed (`3.11.9`) and `backend/.venv` created; lockfile generated from direct dependencies.
- D-003: Frontend stack baseline verified: Node v24.11.1, React 18 (`18.3.1`), TypeScript, Vite (`5.4.21`), Tailwind CSS v3 (`3.4.15`), Vitest (`2.1.9`).
- D-004: FFmpeg/ffprobe verified in PATH (Gyan.FFmpeg via winget); health probe reports ffmpeg_available: true.
- D-005: NVIDIA RTX 3050 Laptop GPU (4 GB VRAM, Driver 566.07, CUDA 12.7) detected; CPU-first with benchmarked CUDA and auto-fallback.
- D-006: Local single-user security model: 127.0.0.1:8000 loopback, strict port 5173 origin check, uniform JSON error envelopes.
- D-007: Clean Git repository initialization with exclusion of secrets, DBs, audio caches, and virtual environments.
- D-008: SQLite configuration: WAL mode, foreign keys enabled, busy_timeout=5000, disambiguated relationship foreign keys.
- D-009: Database migration policy: V1 immutable schema via create_all; post-V1 changes require versioned Alembic migrations.
- D-010: Uniform error envelope and security middleware: 422/HTTP/500 envelope consistency, Host/Origin validation, DTO isolation.
- D-011: Background queue & idempotency: bounded queue (8), FIFO execution, 429 on full, JOB_INTERRUPTED recovery on startup.
- D-012: Deterministic segmentation & URL validation: Section 6.2 URL parser, Section 6.4 segmenter, golden fixtures.
- D-013: Subtitle ingestion, caching & atomic persistence: 200 cache hit, 409 conflict, manual caption preference, Invariant 4.3.1 atomic save.
- D-014: Frontend library & state recovery: LibraryPage responsive grid, VideoLoaderModal double-click guard, useJob 1000ms polling, localStorage state recovery.
- D-015: Workspace layout & segment navigation: Section 8 design tokens, responsive two-column / single-column / mobile stack, independent position numbering, answer concealment, Continue resolution logic, draft persistence, audio recording guard.
- D-016: YouTube player integration: PlayerAdapter interface, singleton API loader, StrictMode lifecycle, no-autoplay policy, origin security, error code mapping with direct YouTube link.
- D-017: Segment playback control & looping: pure cutoff calculation with boundary clamping and coarse timing overlap notices, single 50ms polling timer, loop seek guard with 2.0s runaway prevention, generation_id race avoidance, buffering and background tab pause, manual scrub detection.
- D-018: Shared normalizer, token-level Levenshtein aligner, and cross-language verification: NFKC, typographic apostrophes to ASCII ', letter/digit tokenization with internal apostrophes, 32 explicit contractions, deterministic tie-breaking (diagonal > omission > insertion), unified non-negative round_half_up, 100% fixture parity.
- D-019: Practice sessions, hints, reveal, and authoritative check endpoints: UUID sessions, token boundary validation, first letter hint, reveal without completion leakage, atomic unrevealed completion, assisted flag, copy guard, retry duplicate prevention.
- D-020: Frontend dictation component, single shortcut map, and MVP loop architecture: pedagogical word slots capped at 8 dashes, answer concealment, single accessible textarea with Ctrl+Enter, stale diff invalidation on draft edit, Alt+R replay via imperative ref, Alt+H hint, Alt+Left/Right navigation, and Next sentence CTA replacing auto-advance.
- D-021: Local in-browser recording architecture & hardware lifecycle: MediaRecorder codec negotiation, 30s hard cutoff with 100ms granularity, in-memory blob management with object URL revocation, immediate track.stop() hardware release on stop/unmount, YouTube playback auto-pause before recording, navigation guard synchronization via useStudyStore, locked/unlocked shadowing studio states, Section 8.2 disclaimer.
- D-022: Audio upload validation, 16 kHz mono transcoding, and WaveSurfer lifecycle: chunked streaming upload (15 MiB limit, zero-byte rejection), ffprobe container allowlist and audio stream validation, distinct-arg ffmpeg 16 kHz mono PCM WAV transcode, decoded duration bounds (0.5s - 30.5s), UUID-keyed temporary storage, background shadowing job handler surfacing pending ASR capability, interactive WaveSurfer canvas waveform and evaluate speech polling.
- D-023: Functional CPU ASR engine architecture, lazy singleton loading, and word timestamp extraction: faster-whisper CTranslate2 lazy singleton loading protected by thread locks, model strictly uninstantiated on /api/health queries, warm model instance reuse, eager generator consumption with word-level timestamps (word, start, end, probability), Section 10.3 execution logging, serialized background execution via JobRunner, and real CPU int8 benchmark (1.0s audio in 364ms warm).
- D-024: Benchmarked CUDA acceleration, Windows runtime DLL registration, and dynamic fallback lifecycle: host NVIDIA GeForce RTX 3050 Laptop GPU validated with CUDA 12 / cuDNN 9 wheels, automatic Windows DLL registration (_ensure_nvidia_dll_paths) resolving cublas64_12.dll and cudnn64_9.dll, int8_float16 quantization, strict non-downgrade policy in cuda mode, automatic single-attempt CPU fallback in auto mode, in-flight OOM recovery, single resident model invariant, check_environment diagnostics, and comprehensive benchmarks in docs/benchmarks-t17.json (1.0s audio in 120.3ms on GPU vs 1375.2ms on CPU -> 11.4x speedup).

- D-025: Ingestion ASR fallback, word-boundary segmentation, audio caching, and atomic persistence.
- D-026: Speech feedback assessment, Section 10.4 scoring formulas, display token badge grouping, attempt persistence, and multi-segment isolation.
- D-027: Contextual LLM Grammar Tutor contract, structured output, Gemini client, and cache architecture.
- D-028: Contextual Grammar Tutor Drawer, Settings & Diagnostics, Local Preferences, and Answer Concealment.
- D-029: Removal of Anki feature and codebase cleanup per user requirement.
- D-030: Local Launcher Architecture, Process Management, Diagnostics, and Documentation.
- D-031: Comprehensive V1 Portfolio Delivery, Acceptance Walkthroughs, and Gate G5 Closure.

## Tasks
| ID | Status | Delivery / Reference | Tests | Evaluation |
| --- | --- | --- | --- | --- |
| T00 | ready_for_review | `docs/decisions.md`, `docs/implementation-status.md`, `.gitignore` | Host environment inventory commands executed | pending |
| T01 | ready_for_review | `backend/`, `frontend/`, lockfiles, environment examples | pytest (4 passed), vitest (3 passed), typecheck, build, browser E2E probe | pending |
| T02 | ready_for_review | `backend/app/{models,database,main,routers/health}.py` | pytest (13 passed, 9 dedicated DB tests on temp SQLite) | pending |
| T03 | ready_for_review | `schemas.py`, `errors.py`, `main.py`, `docs/contracts.md`, `types.ts` | pytest (20 passed, contracts/security), vitest (3 passed), build | pending |
| T04 | ready_for_review | `services/jobs.py`, `routers/jobs.py`, `backend/app/main.py` | pytest (28 passed: FIFO, 429 full, conflict, crash recovery, responsiveness) | pending |
| T05 | ready_for_review | `services/{youtube_service,segmenter}.py`, `fixtures/segmentation.json` | pytest (49 passed: URL formats, gap/size thresholds, overlaps, abbreviations) | pending |
| T06 | ready_for_review | `services/youtube_service.py`, `routers/videos.py`, `docs/openapi.json` | pytest (66 passed total: 17 on videos including atomic rollback & real smoke) | pending |
| T07 | ready_for_review | `LibraryPage.tsx`, `VideoLoaderModal.tsx`, `useJob.ts`, `App.tsx` | vitest (12 passed across 3 suites), typecheck, production build | pending |
| T08 | ready_for_review | `StudyPage.tsx`, `SegmentList.tsx`, `useStudyStore.ts`, `tokens.css` | vitest (28 passed across 5 suites), typecheck, production build, browser E2E (1440/768/390 px) | pending |
| T09 | ready_for_review | `useYouTubePlayer.ts`, `VideoPlayer.tsx`, `PlayerAdapter.ts`, `youtubeApiLoader.ts` | vitest (39 passed across 6 suites), typecheck, production build, real YouTube embed smoke check | pending |
| T10 | ready_for_review | `useSegmentPlayback.ts`, `VideoPlayer.tsx`, `StudyPage.tsx` | vitest (50 passed across 7 suites), typecheck, production build, live browser latency p95=78ms | pending |
| T11 | ready_for_review | `aligner.py`, `aligner.ts`, `normalization-rules.json`, `alignment.json` | pytest (73 passed), vitest (57 passed), 100% fixture parity across TS and Python | pending |
| T12 | ready_for_review | `routers/dictation.py`, `schemas.py`, `test_dictation.py` | pytest (83 passed across 9 suites), vitest (57 passed), 100% invariants conformance | pending |
| T13 | ready_for_review | `DictationBox.tsx`, `useKeyboardShortcuts.ts`, `StudyPage.tsx`, `DictationBox.test.tsx` | vitest (65 passed across 9 suites), typecheck (0 errors), build, live browser E2E session | pending |
| T14 | ready_for_review | `useRecorder.ts`, `ShadowingStudio.tsx`, `StudyPage.tsx`, `ShadowingStudio.test.tsx` | vitest (77 passed across 10 suites), typecheck (0 errors), build, pytest (83 passed) | pending |
| T15 | ready_for_review | `audio_service.py`, `routers/shadowing.py`, `shadowing_service.py`, `ShadowingStudio.tsx` | pytest (93 passed across 10 suites), vitest (79 passed across 10 suites), typecheck (0 errors), build | pending |
| T16 | ready_for_review | `backend/app/services/whisper_engine.py`, `backend/app/routers/health.py`, `backend/tests/test_whisper_engine.py` | pytest (99 passed across 11 suites: 6 dedicated whisper tests), real CPU benchmark (1.0s audio in 364ms warm) | pending |
| T17 | ready_for_review | `backend/app/services/whisper_engine.py`, `backend/check_environment.py`, `backend/benchmarks.py`, `docs/benchmarks-t17.json` | pytest (104 passed across 11 suites: 11 whisper/CUDA tests), vitest (79 passed), real RTX 3050 benchmark (120ms on GPU vs 1375ms on CPU) | pending |
| T18 | ready_for_review | `backend/app/services/youtube_service.py`, `backend/app/services/segmenter.py`, `frontend/src/components/VideoLoaderModal.tsx`, `frontend/src/pages/LibraryPage.tsx`, `backend/tests/test_videos.py` | pytest (109 passed across 11 suites: 22 video/ingestion tests), vitest (79 passed), yt-dlp audio download, word-boundary ASR segmentation, atomic rollback verified | pending |
| T19 | ready_for_review | `backend/app/services/assessment.py`, `backend/app/services/shadowing_service.py`, `frontend/src/components/ShadowingStudio.tsx`, `frontend/src/stores/useStudyStore.ts`, `backend/tests/test_assessment.py`, `frontend/tests/ShadowingStudio.test.tsx` | pytest (117 passed across 12 suites: 8 assessment tests, 10 shadowing tests), vitest (82 passed across 10 suites: 17 shadowing studio tests), typecheck, build | pending |
| T20 | ready_for_review | `backend/app/services/llm_tutor.py`, `backend/app/routers/tutor.py`, `backend/app/config.py`, `backend/app/schemas.py`, `frontend/src/api/types.ts`, `backend/tests/test_tutor.py` | pytest (132 passed across 13 suites: 15 dedicated tutor tests), zero-key boot, 503 disabled, 409 locked, 3-sentence boundaries, structured output, cache hit/miss, single repair retry, 429/401/timeout error mapping, injection defense | pending |
| T21 | ready_for_review | `frontend/src/components/GrammarTutorDrawer.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/stores/useSettingsStore.ts`, `frontend/tests/GrammarTutorDrawer.test.tsx`, `frontend/tests/SettingsPage.test.tsx` | vitest (98 passed across 12 suites: 9 tutor drawer tests, 5 settings page tests), typecheck, production build (0 errors) | pending |
| T22 | omitted_by_user_request | Anki card management omitted per explicit user requirement | All AnkiCard models and schemas purged | accepted |
| T23 | omitted_by_user_request | Anki export pipeline omitted per explicit user requirement | genanki dependency excluded | accepted |
| T24 | ready_for_review | `start_local.bat`, `stop_local.bat`, `scripts/start_local.ps1`, `scripts/stop_local.ps1`, `backend/check_environment.py`, `README.md`, `backend/tests/test_scripts.py` | pytest (135 passed across 13 suites: 4 dedicated script tests), clean port checks, PID tracking | pending |
| T25 | ready_for_review | `docs/validation.md`, `docs/benchmarks.md`, `README.md`, final test suites | 135 pytest + 98 vitest passed (233 total), 0 errors, full traceability matrix | pending |

## Gate Status
- **Gate G0 (Skeleton, Storage, and Queue Contracts)**: Completed and ready for review.
- **Gate G1 (Dictation Engine & Player Integration: T07–T13)**: COMPLETED and ready for review. Full functional MVP operational end-to-end without ASR, cloud credentials, or Anki.
- **Gate G2 (Shadowing & ASR Engine: T14–T19)**: COMPLETED and ready for review (T14, T15, T16, T17, T18, and T19 all completed and verified).
- **Gate G3 (Contextual Grammar Tutor: T20–T21)**: COMPLETED and ready for review (T20 and T21 both completed and verified).
- **Gate G4 (Anki Card Management & Deck Export: T22–T23)**: OMITTED per explicit user instruction (Decision D-029).
- **Gate G5 (V1 Delivery: T24–T25)**: COMPLETED and ready for final review. All deliverables, benchmarks, launcher scripts, documentation, and automated tests verified.

## Open Findings
- None currently. Zero P0/P1/P2 defects remaining.

## External Validations
- FFmpeg: Installed and verified in PATH (`ffmpeg_available: true` in `/api/health`).
- RTX GPU Hardware Acceleration: Fully operational and verified on host NVIDIA GeForce RTX 3050 Laptop GPU (4 GB VRAM, Driver 566.07, CUDA 12.7). CTranslate2 4.8.3 executes int8_float16 inference with genuine 11.4x acceleration (1.0s audio processed in 120.3ms warm on GPU vs 1,375.2ms on CPU; cold load 498.3ms on GPU vs 873.7ms on CPU).
- YouTube Live: Verified live streams are rejected with 400 `LIVE_STREAM_UNSUPPORTED`.
- YouTube Real Video Smoke: Verified real video ingestion smoke test passed against public short video `jNQXAC9IVRw` (19s).
- Live Browser E2E Inspection: Full responsive layout validation at 1440px (desktop 2-col), 768px (tablet collapsible), and 390px (mobile zero overflow); draft persistence across segment switches and answer text concealment verified.
- Live YouTube Player Smoke: Verified real embedded YouTube iframe mounts without autoplay on initial load, controls bar renders Play/Pause/Replay and speed selector (0.75x, 1.0x, 1.25x), and responds cleanly to Play/Pause in live browser session.
- Live Playback Temporal Calibration: 10 foreground runs at normal (1.0x) and slow (0.75x) speeds in live browser measured observed time deviation with p95 = 78 ms (well within target <= 300 ms).
- Cross-Language Alignment Parity: Python and TypeScript aligners tested against 12 golden fixtures in `shared/fixtures/alignment.json` with 100% identical outputs for edit distances, scores, exactness, operation counts, and operations sequences.
- Authoritative Dictation Verification: Verified all invariants (client does not dictate score; reveal does not complete sentence; copying after reveal does not complete session; exact with hints flags assisted=true; retry prevents duplicate attempt rows).
- Live Browser E2E Dictation MVP Loop: Verified complete MVP loop in browser session (initial dashes capped at 8 with no answer leakage, shortcuts modal operation, draft entry and Check evaluation with score/breakdown feedback, first letter Hint display, Reveal answer with full sentence display and Shadowing Studio unlocking, and Next sentence CTA advancement).
- Local In-Browser Recording Verification: 12 tests in `ShadowingStudio.test.tsx` verifying media recorder lifecycle, 30s cutoff, URL revocation, immediate hardware release, YouTube playback pause, and locked/unlocked state transitions.
- Audio Upload & Transcoding Verification: 10 tests in `test_shadowing.py` verifying 15 MiB stream limit (413), empty audio (422), duration bounds (0.5s–30.5s), ffprobe container allowlist (415), path traversal protection, PCM 16 kHz conversion, and idempotency.
- Real CPU Whisper Inference Benchmark: Verified real execution using cached tiny.en on CPU with int8 quantization. Transcribed 1.0s audio test vector in 1260ms cold and 364ms warm with word-level timestamps extraction.
- Real CUDA Whisper Inference Benchmark: Complete observed benchmark across 1.0s, 5.0s, and 10.0s vectors recorded in docs/benchmarks-t17.json with measured RTF and latency.
- Ingestion ASR Fallback & Word-Boundary Segmentation: Verified captionless video fallback to local ASR, forced ASR override (`force_gpu_whisper`), natural pause splitting (>1.2s), maximum 18-word/10s clamping, abbreviation handling, audio file download/caching (`media_cache/audio/`), and atomic rollback on failure.
- Speech Assessment & Multi-Segment Isolation: Section 10.4 exact scoring formulas ($N=4, S=1 \to 75$; $N=4, I=1 \to 75$; ref=3.0s, spoken=2.4s $\to 80$; word=100, timing=80 $\to 94$; silence $\to$ unscorable nulls; low confidence $\to$ word=100 with uncertain badge), display token badge grouping (Recognized / Uncertain / Different / Missing), extra words detection, attempt persistence, and segment isolation verified.
- Contextual Tutor Contract & Cache Architecture: Single canonical JSON response schema verified with Pydantic; zero-key safe boot verified (no credentials required); clean 503 on disabled tutor; 409 on locked segments; deterministic 3-sentence context window extraction; SHA-256 context hashing; persistent caching in TutorCache table; concurrency limit capped at 1; single structured repair retry on malformed JSON; provider error mapping without retry loops (429, 401, timeout); prompt injection treated strictly as untrusted data.
- Tutor UI Drawer & System Settings Verification: Slide-out drawer with 5 visual states (`disabled`, `idle`, `loading`, `ready`, `error`), safe React text rendering (no `dangerouslySetInnerHTML`), clear cloud transmission notices, language selector, `Escape` key and focus restoration; answer concealment guard preventing explain before sentence unlock; `SettingsPage` with live `/api/health` system diagnostics and local user preferences without secret inputs.
- Launcher & Process Management: Verified reproducible startup (`start_local.bat`, `start_local.ps1`), PID tracking in `logs/fluenttube_pids.json`, process identity protection against recycled PIDs, non-destructive port conflict detection (8000 and 5173), graceful shutdown (`stop_local.bat`, `stop_local.ps1`), and standalone environment diagnostics (`check_environment.py`).
- Live Tutor: Verified disabled by default; external integration tests ready for optional user API key.
- Anki Integration: Omitted per explicit user requirement; all Anki models, DTOs, and endpoints purged (Decision D-029).

## Next Action
- All tasks in the backlog (T00 through T25) are complete. Project is ready for technical evaluation and final user acceptance.



