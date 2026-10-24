# FluentTube AI: Technical Review and Implementation Handoff

Review date: October 23, 2026 (America/La_Paz)

## 1. Purpose and verdict

This is an analysis-only review of the current local project. No application source, configuration, dependencies, or existing tests were changed. Diagnostic probes were kept outside the project. This document is a handoff for another AI or developer to implement the changes.

**Verdict:** The project has a useful foundation, but its tests and completion claims overstate readiness. There are reproducible session, answer-disclosure, recording-lifecycle, and request-replay defects. The user's two principal product requirements also remain unimplemented: continuous YouTube dictation and a contextual dictionary powered by a local language model.

Fix the existing implementation incrementally. Retain React, FastAPI, SQLite, the player adapter, deterministic server-side scoring, and local speech recognition. A framework rewrite or new cloud backend is unnecessary.

### Current requirements take precedence

1. After a correct dictation is verified, automatically select and play the next segment. Avoid Check → Next → Play.
2. Provide local-AI word/phrase explanations: English meaning, Spanish translation, contextual meaning, examples, and usage.
3. Keep Anki, AnkiConnect, deck exports, flashcard synchronization, and associated APIs out of scope. Their absence is intentional, not a defect.
4. Preserve existing videos, drafts where possible, and learning history.

Older decisions D-016 and D-020 document no-autoplay/manual-next behavior. The new requirement supersedes that interaction policy. It does not require unexpected sound when the application first opens.

## 2. Validation and evidence boundaries

| Check actually performed | Observed result |
| --- | --- |
| Existing frontend suite: `npm --prefix frontend test` | **98 tests passed across 12 files.** Also emitted React `act(...)` warnings and attempted real localhost API requests in some component tests. |
| `npm --prefix frontend run typecheck` | Passed. |
| Vite production build, output redirected to a temporary directory | Passed; 1,647 modules transformed. |
| Backend suites for alignment, assessment, database, segmentation, and YouTube URL parsing | **44 tests passed.** |
| Five temporary frontend diagnostic tests | All five reproduced defective behavior in F-01, F-03, F-04, and F-07. They demonstrate bugs, not fixes. |
| Backend probes using actual router/service functions and isolated SQLite | Reproduced wrong idempotency replay, copy-after-reveal completion, cleanup failure, invalid clamped timestamps, removal of parenthetical speech, and an uncaught invalid-port exception. |
| Full backend suite excluding live network/GPU inference tests | Attempted, then stopped after stalling. A focused retry with a stack dump blocked inside Windows `socket.socketpair()` / asyncio initialization while entering `TestClient`, before request processing. The full HTTP suite is **not verified** here. |

The first attempt to redirect the npm build output passed the output directory incorrectly as Vite's project root. Invoking Vite directly with the correct argument succeeded. This was a verification-command issue, not a project build defect.

No live YouTube playback, real microphone recording, GPU transcription, Gemini request, or local LLM inference was certified in this review. Browser policies and real subtitle/audio synchronization still require the acceptance checks below. Existing benchmark/browser claims in `docs/` are historical claims, not independently reproduced results.

Evidence labels:

- **Reproduced:** demonstrated against the implementation by a focused diagnostic.
- **Code-confirmed:** the relevant path directly supports the finding; the full real-browser journey was not exercised.
- **Requirement gap:** the requested behavior is absent, even if the old specification allowed it.
- **Improvement:** a proposed addition, not a claim that existing functionality crashes.

### Foundation worth retaining

Deterministic backend scoring with cross-language fixtures; SQLite foreign keys/WAL and transactional writes; canonicalized YouTube URLs; serialized background ASR work; the testable player adapter and cutoff calculations; structured tutor output rendered as React text; and the distinction between ASR practice feedback and phonetic pronunciation assessment are all useful foundations.

## 3. Priorities

P1 means a core workflow, learning-state, data-association, or process-safety issue, or a central missing user requirement. P2 means important reliability/usability work. P3 means lower-priority consistency/documentation. These are project priorities, not vulnerability scores.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| F-01 | P1 | Session initialization invalidates its own request | Reproduced |
| F-02 | P1 | Correct dictation does not advance and play automatically | Requirement gap |
| F-03 | P1 | Incorrect checks disclose answers without recording assistance | Reproduced |
| F-04 | P1 | Try Again starts an unrevealed session while answers remain visible | Reproduced |
| F-05 | P1 | Local contextual dictionary is missing; tutor is Gemini-only | Requirement gap |
| F-06 | P1 | Audio recorded for A can be submitted against sentence B | Code-confirmed |
| F-07 | P1 | Discard and late microphone permission do not safely control recording | Reproduced |
| F-08 | P1 | Retrying an old dictation request returns a newer result | Reproduced |
| F-09 | P1 | Shutdown script can kill unrelated Python/Node processes | Code-confirmed |
| F-10 | P2 | Saved playback preferences are not applied; study tabs are cosmetic | Code-confirmed |
| F-11 | P2 | Draft/session recovery and progress synchronization are incomplete | Code-confirmed |
| F-12 | P2 | Tutor adds a redundant click and can display stale responses | Code-confirmed |
| F-13 | P2 | Tutor repair loses context; concurrent cache misses duplicate work | Code-confirmed |
| F-14 | P2 | Finished shadowing jobs do not delete their WAV files | Reproduced |
| F-15 | P2 | Synchronous audio conversion blocks the async request handler | Code-confirmed |
| F-16 | P2 | Shadowing idempotency accepts unrelated jobs/payloads | Code-confirmed |
| F-17 | P2 | Transcript processing can invalidate timing or remove spoken content | Reproduced / code-confirmed |
| F-18 | P2 | Import and polling recovery can leave misleading/stuck UI | Code-confirmed |
| F-19 | P2 | Video detail loads complete histories through per-segment queries | Code-confirmed |
| F-20 | P2 | Player API loading and seek recovery need stronger failure states | Code-confirmed |
| F-21 | P2 | Tests miss important lifecycle paths and global dependency isolation | Code-confirmed |
| F-22 | P3 | Documentation/configuration claims differ from the source | Code-confirmed |

## 4. Detailed findings

### F-01 — Initial session creation invalidates its own request

**Locations:** `frontend/src/components/DictationBox.tsx:54–79`; `frontend/tests/DictationBox.test.tsx:35–40`.

The initialization effect depends on `isLoadingSession` and sets it to true. That update triggers cleanup, setting the pending closure's `isMounted` to false. When creation resolves, `setSession` and the loading reset are skipped. The next effect sees loading already true and does not create another session.

**Reproduction:** Mount a fresh DictationBox with an empty store; resolve a successful creation request. The store still has no session. The enabled Hint button does nothing because its handler returns without a session; Reveal has the same guard. Checking a draft can create a separate session and partially mask the bug. Existing tests inject a session beforehand.

**Change:** Give initialization one stable owner keyed by segment/practice-run identity. Avoid a loading dependency that cancels its own work; deduplicate requests; handle late responses and visible retry states. Hint/Reveal should await shared initialization or temporarily indicate that initialization is pending.

**Acceptance:** Empty-store startup works normally and in StrictMode; failures offer Retry; segment switching cannot misassociate a session; concurrent Check and initialization do not create independent active sessions.

### F-02 — Continuous dictation is absent

**Locations:** `DictationBox.tsx:110–143,651–664`; `frontend/src/pages/StudyPage.tsx:76–100,402–406`; `frontend/src/player/useSegmentPlayback.ts:319–339`; decisions D-016/D-020.

A correct check only updates progress. The learner must choose Next Sentence, and selection pauses/seeks without playing. There is no success-to-next-play transition or automatic exact-answer verification. Enter already submits a check, which is useful.

**Change:** Implement section 5. Give the study controller ownership of transitions. Do not immediately call Play after updating React selection while player bounds still refer to the previous segment. Consume authoritative `completed`, `shadowing_unlocked`, and assistance fields rather than inferring completion from `is_exact` and a captured session object.

**Acceptance:** One current exact result causes one save, one selection transition, and one playback request for the next segment. Wrong/stale answers, recording, vocabulary study, background tabs, and the final segment follow explicit rules.

### F-03 — Incorrect checks disclose hidden answers

**Locations:** `DictationBox.tsx:493–526`; `backend/app/routers/dictation.py:350–385`.

The incorrect-answer breakdown renders replacement targets and every omitted word. The backend derives `assisted` only from explicit hints; only Reveal marks the session revealed.

**Reproduction:** For “We are ready,” submit “we.” The UI displays `+ missing: are` and `+ missing: ready`, while `answer_revealed` remains false. Copying the corrections can then produce an unassisted completion.

This concerns ordinary learning behavior, not a claim that a transcript in a local application's API response is a critical security vulnerability.

**Change:** Separate retry feedback from solution feedback. Identify incorrect typed words/missing positions without displaying hidden corrections. If the learner requests detailed corrections, record that exposure and classify the subsequent attempt accordingly.

**Acceptance:** Wrong checks cannot expose all missing/replacement words through text, tooltips, or accessible labels while leaving assistance false. Explicit correction requests update both visible and persisted learning state.

### F-04 — Try Again leaves the answer visible

**Locations:** `DictationBox.tsx:106–107,211–226`; `backend/app/routers/dictation.py:110–123,239–244,378–387`; `ShadowingStudio.tsx:275–282`; `SegmentList.tsx:39–40,117–120`.

Reveal is persisted on the segment. A fresh session starts with `answer_revealed=False`, but UI visibility still uses `segment.revealed`. Try Again clears the draft and creates a new session while the full answer remains visible in word slots and other unlocked surfaces.

**Reproduction:** Reveal → Try Again → copy visible text. A frontend probe confirmed a fresh unrevealed session with visible target text. A backend probe returned `completed=True, assisted=False` for the copied answer.

**Change:** Separate historical progress from current-run visibility and assistance. A fresh hidden retry must conceal the answer across every surface; otherwise explicitly label it review/copy practice. Preserve historical completion/reveal data instead of erasing it to hide the UI.

**Acceptance:** Cover reveal/retry, reload after reveal, and retry of historically completed segments. The sidebar, speaking quote, tutor, and old feedback must obey the same current-run policy. Review practice cannot masquerade as unassisted recall.

### F-05 — Local contextual dictionary is missing

**Locations:** `backend/app/services/llm_tutor.py:98–199,231–234,301–307`; `backend/app/config.py`; tutor DTOs in `backend/app/schemas.py`; `GrammarTutorDrawer.tsx`.

The only production client is Gemini. `_resolve_client()` always returns it, and requests require `GEMINI_API_KEY`. Changing `TUTOR_PROVIDER` does not install or dispatch to a local provider. Faster-Whisper is local speech recognition, not a language model for word explanations.

The current whole-sentence tutor chooses its own short vocabulary list. There is no selected-word/phrase endpoint, explicit translation/part-of-speech/usage contract, dictionary panel, or saved vocabulary collection.

**Change:** Implement section 6. Reuse the structured-output/cache pattern with genuine provider dispatch and local readiness/error handling. Local mode must never silently fall back to a remote provider. Cloud support may remain explicitly optional.

**Acceptance:** With no Gemini key, an available local model explains selected words and phrases. When unavailable, show a useful recovery state while dictation continues.

### F-06 — Recorded audio is not bound to its source segment

**Locations:** `frontend/src/components/ShadowingStudio.tsx:43–71,211–230`; `StudyPage.tsx:414–418`.

The same component/hook survives segment changes. There is no capture-owned segment ID or segment-keyed reset. Evaluation sends the current `segment.id` with whichever old `audioBlob` is stored.

**Reproduction path:** Record A, stop, select another unlocked sentence B, then Evaluate without recording again. The navigation guard is inactive after stopping, so A's audio can be submitted as B's.

**Change:** Model a capture as `{captureId, segmentId, videoId, blob, duration}`. Submit against its recorded identity; reject mismatched selection. Either retain captures per segment or deliberately discard on departure. Scope pending/error state by capture/job so a request for A cannot indefinitely disable B.

**Acceptance:** Audio from A cannot be evaluated as B. Delayed submissions/results remain associated with A. Returning to A restores its correct state.

### F-07 — Discard does not stop recording; late permission can outlive the page

**Locations:** `StudyPage.tsx:147–155`; `frontend/src/hooks/useRecorder.ts:82–97,138–173,228–253,286–299`.

“Stop Recording & Discard” only changes a Zustand flag. It does not stop MediaRecorder/tracks or discard the capture; the hook owns independent recording state. Also, after awaiting microphone permission, `startRecording()` does not check whether the component/request is still valid. Leaving while permission is pending can allow recording to start after unmount.

Both paths were reproduced with the real hook and mocked browser media objects: clearing the flag left recording active and tracks unstopped; granting permission after unmount started recording and set the global flag again.

**Change:** Expose recorder-owned stop-and-discard/stop-and-keep commands; derive the store from actual state. Invalidate pending permission on cancel/unmount/departure and stop late-arriving tracks immediately. Detach obsolete handlers; prevent late `onstop` from restoring discarded audio or allocating orphan URLs. Separate URL cleanup from recorder lifetime.

**Acceptance:** Discard stops tracks and leaves no capture; canceled permission cannot start recording later; repeated cleanup is safe. Apply the agreed recording guard to Back to Library as well as sentence navigation.

### F-08 — Dictation idempotency returns the wrong result

**Location:** `backend/app/routers/dictation.py:296–309`.

For a matched prior request, the endpoint returns the session's `last_result_json`, which may belong to a later attempt.

| Observed operation | Result |
| --- | --- |
| Request A: `we` | Attempt 1, score 33 |
| Request B: `we are ready` | Attempt 2, score 100 |
| Retry A with A's original request key | **Attempt 2, score 100** |

**Change:** Return the matched attempt's immutable response or reconstruct from that attempt under a documented historical/current-progress policy. Never use session-global last result as an attempt cache. The frontend must retain one request key per logical submission; currently Check sends only `input_text`, so retries get new server-generated keys.

**Acceptance:** A → B → retry A returns A's attempt/alignment. Network retry inserts nothing extra. Different input with the same key conflicts. Concurrent duplicates do not cause unhandled unique-constraint errors.

### F-09 — Shutdown can terminate unrelated services

**Location:** `scripts/stop_local.ps1`, `Stop-TrackedProcess` and `Stop-PortListener`.

Ownership is inferred from broad names like Python/Node. Final port cleanup kills Python/Node listeners on 8000/5173 even without a valid matching tracked record. Another development project can be terminated.

**Change:** Remove broad port-based killing. Verify recorded PID, start time, expected executable, and project-specific command line where available. If identity is uncertain, report the conflict and leave it running. Handle the actual launcher tree explicitly.

**Acceptance:** An unrelated temporary listener survives. Reused/stale PIDs cannot authorize termination. Only owned processes stop. Test the real script in a controlled environment; do not run the current script against the user's active environment to demonstrate this defect.

### F-10 — Settings and study modes do not control behavior

**Locations:** `frontend/src/stores/useSettingsStore.ts`; `SettingsPage.tsx`; `VideoPlayer.tsx:44,91–95,296`; `StudyPage.tsx:302–318,400–418`.

Playback speed, automatic loop, and sound-effect preferences are persisted but not consumed by the player. Settings default to `autoLoop=true`; VideoPlayer defaults to false. Player speed initializes independently. Explanation language is wired correctly.

Listen/Dictate/Shadow only changes tab styling: both practice panels remain rendered, with no change to playback, focus, or workflow.

**Change:** Wire supported preferences to actual controllers, remove/defer unsupported settings, and give modes meaningful behavior or simplify the workspace. Define precedence between loop mode and continuous advancement.

**Acceptance:** Persisted preferences apply when the player becomes ready and after reload. Unsupported speeds fall back visibly. Mode selection changes observable behavior. Tests must check the player/workflow, not only stored values.

### F-11 — Persistence and progress synchronization are incomplete

**Locations:** `frontend/src/stores/useStudyStore.ts`; `StudyPage.tsx:57–67,76–82`; `frontend/src/api/client.ts` (`getSession`); dictation/progress routers.

Drafts, session IDs, and results are memory-only. The backend stores the last submitted input, but the frontend never restores a session through `getSession`; unsubmitted drafts disappear on reload.

Navigation sends independent fire-and-forget PATCH requests. Rapid A → B → C requests can persist an older selection last. Failures are only logged. Dictation mutations do not synchronize React Query's video/list caches, creating another stale state source.

**Change:** Persist a small versioned workspace record per video/segment containing draft and session identity, validated against server state on restore. Serialize/coalesce progress updates or use monotonic revisions. Update/invalidate query caches after persisted changes. Clear video-specific transient UI on route changes; avoid showing the old workspace while the new video is loading or failed.

**Acceptance:** Reload restores the draft/help state; fast navigation resumes at the final selection; failed saves are recoverable without blocking practice; video switching never presents old content as the new route.

### F-12 — Tutor adds a redundant click and can show stale answers

**Locations:** `GrammarTutorDrawer.tsx:74–113,138–169,288–307`; StudyPage tutor trigger and shortcuts.

Explain opens the drawer, checks health, and then asks for another generation click. Requests are not aborted/version-checked when segment selection changes. A response for A can replace `currentExplanation` after navigation to B. Previous content may remain visible while the new health request is pending. Background segment shortcuts are not scoped out when the drawer is open.

**Change:** Make initial Explain/word selection the request action. Show cached data or loading immediately. Bind display and request identity to segment, term, language, and generation; ignore stale UI updates. Contain modal focus, restore it deliberately, and prevent global shortcuts acting on hidden background content.

**Acceptance:** One action yields an explanation. Slow A cannot render as B. Closing/reopening does not flash unrelated text. Background navigation does not silently change the sentence under a modal explanation.

### F-13 — Repair loses context and cache misses duplicate generation

**Locations:** `backend/app/services/llm_tutor.py:301–307,333–364,381–399`.

The stateless repair call contains a validation error but omits the original sentence/context and invalid output. It cannot reliably repair the intended explanation. Cache lookup happens before the semaphore, with no recheck inside; identical simultaneous misses can generate twice, then collide on cache insertion. Provider availability is checked before cache lookup, preventing persistent-cache access when generation is disabled/unavailable.

**Change:** Include bounded original context and malformed output in repair. Deduplicate per cache key and recheck after acquiring generation ownership. Separate cached reading from new generation availability. Dictionary keys must include term/span, context/reference version, language, provider/model, and schema/prompt versions. Bound waiting as well as inference time.

**Acceptance:** Concurrent identical requests generate once. Cached entries work while the provider is offline. Repair preserves the target meaning. Corrupt entries are replaced/invalidated rather than repeatedly colliding with their existing cache row.

### F-14 — Worker WAV cleanup is a no-op

**Locations:** `backend/app/services/shadowing_service.py:149–152`; `backend/app/services/audio_service.py:33–43`.

The worker passes a string to `safe_cleanup`, but the helper only handles `Path` objects.

**Reproduction:** `safe_cleanup(str(temp_wav))` leaves the file present; `safe_cleanup(temp_wav)` with a Path removes it. Existing files were observed under `backend/data/temp`, but their individual provenance was not investigated.

**Change:** Normalize path types at the cleanup boundary, restrict cleanup to owned temporary audio, and clean abandoned/interrupted jobs. Make the temporary directory configurable; it is currently hard-coded. Do not indiscriminately remove existing media.

**Acceptance:** Success, inference failure, enqueue failure, and restart interruption leave no owned orphan beyond documented retention. Assert actual file disappearance, not just a helper call.

### F-15 — Conversion blocks the async endpoint

**Locations:** `backend/app/routers/shadowing.py:29,80–85`; `backend/app/services/audio_service.py:125,228,276`.

The async upload handler directly calls synchronous ffprobe/FFmpeg subprocesses before enqueueing. This can block event-loop request handling for substantial periods; actual latency was not measured in this review.

**Change:** Move probing/conversion into the bounded worker after receiving the upload, or use bounded worker-thread execution. Define raw/WAV ownership and cleanup across all failures. Limit decoded-media work rather than converting arbitrary duration and checking only the final result.

**Acceptance:** Slow conversion does not freeze dictation, health, or polling. Queue-full/conversion failure clean owned files and show useful feedback.

### F-16 — Shadowing idempotency accepts unrelated requests

**Locations:** `backend/app/routers/shadowing.py:66–75,94–109`; `frontend/src/api/client.ts` (`evaluateShadowing`).

A matching `client_request_id` returns a job without checking kind, segment, or audio. It can return another sentence's job or an ingestion job. The runner's later hash includes a newly generated temporary path, which is not stable across identical uploads. The frontend generates a fresh key on each Evaluate call, undermining network retries.

**Change:** Define stable identity from operation, target, relevant options, and capture/content identity. Validate before returning a prior job. Retain a key per logical capture submission and explicitly handle concurrent duplicates.

**Acceptance:** Same key/capture returns one job; changed kind/segment/audio conflicts; retries do not create extra evaluations or orphan files.

### F-17 — Segmentation can invalidate bounds or remove real speech

**Locations:** `backend/app/services/segmenter.py:16–19,48,191,209–236,325–349`; `youtube_service.py` (`handle_ingest_job`).

Confirmed issues:

1. Clamping only the end creates invalid intervals: a fragment at 12–14s with video duration 10s becomes **start=12, end=10**. The ASR-word flush has the same end-only clamp pattern.
2. Every parenthesized/bracketed phrase is removed, not just recognized noise. `I work (mostly remotely) every day.` becomes `I work every day.`
3. A single long caption is retained as `coarse`, not split to the advertised 18-word/10-second limit. Retaining honest coarse timing may be sensible; claiming the limit is enforced is not.
4. Rolling-caption handling stores stripped text as the next `prev_text`, losing context for later cumulative overlaps. Expand fixtures for multi-update rolling captions and genuine repetition.

**Change:** Revalidate finite `0 <= start < end <= duration` after clamping. Drop/repair out-of-range fragments. Strip known noise markers deliberately and preserve spoken parentheses. Do not fabricate precise word times. Offer optional local alignment/resegmentation for coarse captions.

**Product improvement:** Add Report/Correct transcript and Adjust clip actions. Caption/ASR references are fallible; preserve the original and a versioned correction, invalidate affected caches, and retain earlier attempt history. A correct listener should not be trapped by an inaccurate reference. Do not use LLM semantic similarity to silently accept arbitrary dictation answers.

**Acceptance:** Cover video bounds, cumulative captions, legitimate repeated speech, spoken parentheses, long captions, and overlap. Corrections create explicit reference versions with honest timing provenance.

### F-18 — Import/polling recovery can get stuck

**Locations:** `frontend/src/hooks/useJob.ts`; `VideoLoaderModal.tsx:49–84,109–137`; `LibraryPage.tsx`; `backend/app/routers/videos.py:57–86`.

Polling intervals are enabled only when existing data says queued/running. If the first job request exhausts retries without data, regular polling does not resume. The import modal ignores query errors and can remain at QUEUED/Preparing task.

Closing retains `activeJobId`. If completion occurs while closed, reopening Import can show the stale completed job instead of an input form; `initialJobId=null` does not clear it. For duplicate imports, the backend supplies an existing job ID with `INGEST_IN_PROGRESS`, but the frontend only shows an error message.

**Change:** Model new input, submitting, active job, completion, failure, and disconnected polling explicitly. Preserve genuinely pending jobs, reset acknowledged completed ones, surface polling Retry/Resume, and adopt a valid existing job for a duplicate import.

**Acceptance:** Backend disconnect/reconnect, missing saved jobs, close-then-complete-then-reopen, and duplicate imports all recover without an indefinite misleading queue state.

### F-19 — Detail queries load excessive history

**Location:** `backend/app/routers/videos.py:159–204`.

Each segment lazily loads its dictation/shadowing attempt relationships and calculates maxima in Python. That introduces per-segment queries and materializes full attempts, including large JSON/text fields, for simple summary scores.

**Change:** Aggregate maxima in SQL grouped by segment and merge them into DTOs. Avoid loading full attempts for summaries. Consider transcript pagination/virtualization only if measured usage warrants it.

**Acceptance:** With hundreds of segments and several attempts each, query count stays approximately constant rather than growing by two history queries per segment. Verify score parity and measure latency without inventing performance numbers.

### F-20 — Player recovery and seek state need strengthening

**Locations:** `frontend/src/player/youtubeApiLoader.ts`; `useSegmentPlayback.ts:180–205,260–285,319–339`; `useYouTubePlayer.ts`.

After script failure, the loader clears its promise but leaves the failed script element. A retry sees that element and waits for a callback that may never occur. There is no readiness timeout or normal retry UI.

Play's initial-seek flag clears when time is merely beyond the start, without an upper-bound or timeout check like Replay's guard. A delayed backward seek can report the previous late timestamp and be classified as manual scrubbing. This is a code-level race risk needing an asynchronous adapter test and real-browser confirmation, not a reproduced live-YouTube failure.

Current wiring does not expose `onAutoplayBlocked`; a requested play is not proof of actual playback.

**Change:** Implement recoverable API loading with timeout/clean reinjection. Unify bounded seek readiness/cancellation. Distinguish requested play, observed PLAYING, buffering, blocked, and error. Handle the real autoplay-blocked event with one useful Resume action, not repeated play commands.

**Acceptance:** Script failure retries without reload; delayed seeks preserve cutoff monitoring; playback uses the correct segment; blocked playback retains progress/draft. Do not promise autoplay under every browser policy.

### F-21 — Green tests miss lifecycle and isolation failures

**Locations:** `frontend/tests/DictationBox.test.tsx`; `StudyWorkspace.test.tsx`; `backend/tests/test_scripts.py`; `test_dictation.py`; `backend/app/main.py` lifespan and module-global services.

- Pre-filled sessions hide F-01.
- Success tests assert manual Next, not continuous practice.
- Some component tests attempt real localhost requests and still pass after errors.
- Recording tests omit actual discard-modal and late-permission paths.
- Launcher tests simulate behavior rather than checking the real script safely.
- Overriding `get_session` does not redirect global engine/health/lifespan/runner dependencies. TestClient lifespan can initialize or recover jobs in the configured application database unless every dependency is isolated.
- Synthetic silent-audio benchmarks do not validate recognition accuracy on spoken English.

**Change:** Add section 8 regressions; fail on unexpected network requests. Introduce application-factory/dependency assembly so database, worker, temporary storage, models, and lifespan use test-owned resources. Make external/GPU tests opt-in and prevent surprise model downloads.

**Acceptance:** A non-network suite never touches user data/media or live providers and covers real initialization and cross-segment async transitions. Report mocked, unit, and live checks separately.

### F-22 — Documentation and configuration drift

**Locations:** README; `docs/implementation-status.md`; `docs/validation.md`; backend config/YouTube service; scripts; `.gitignore`.

- “No remaining P0/P1/P2 defects” is contradicted by this review.
- README says Myers diff; the source implements token-level Levenshtein.
- README names `SPEECH_CUDA_MODEL`; settings use `SPEECH_MODEL`. Documented CPU defaults also differ from class defaults.
- Root `start_local.bat` and `stop_local.bat` referenced in docs are absent; PowerShell scripts exist.
- Root `npm install` does not create Python dependencies or install the frontend; fresh setup needs the manual steps or a bootstrap command.
- `MAX_VIDEO_SECONDS` exists, but metadata validation hard-codes 1800 seconds.
- Some messages say automatic transcription is unavailable although fallback ASR exists.
- Library lists only the first 50 videos without pagination.
- Ignore rules do not comprehensively exclude model files and recordings under `backend/data/`; avoid committing binaries or personal recordings.

**Additional small validation defect:** `parse_youtube_url` reads `parsed.port` outside its exception guard. `https://youtube.com:notaport/watch?v=aaaaaaaaaaa` raises ValueError rather than the intended input error. Catch malformed/out-of-range ports and return the canonical 422 response.

**Change:** Reconcile docs after repairs, use consumed settings, regenerate API snapshots, verify one setup path, and separate local ASR from local language-model explanations. Do not expose environment secrets in diagnostics/docs.

**Acceptance:** Fresh setup works as documented; settings/limits are truthful; counts reflect current runs; malformed URLs produce useful errors; Anki remains excluded.

## 5. Target experience: continuous YouTube dictation

This section specifies proposed behavior, not existing functionality.

1. Start/resume with one intentional action when playback needs authorization.
2. Play the active segment and pause at its boundary. Keep the input ready for typing.
3. Enter checks; Shift+Enter can preserve multiline input. Respect IME composition.
4. An authoritative exact result for the current draft/run shows brief feedback, then advances after approximately 500–800 ms. This is a proposed UX delay, not a measured optimum.
5. Commit new segment identity/bounds and wait for readiness before issuing one seek/play request. Preserve input focus without unwanted scrolling.
6. Pause at the next boundary. No routine Next → Play action is needed.
7. At the final segment, show completion/review options, not an invalid next index or unexpected restart.

### Optional automatic checking

To remove routine Check, offer exact-answer verification after a typing pause. One approach is approximately 600 ms debounce, a local exact-match precheck using the same versioned normalization rules, then authoritative backend verification of a candidate exact match.

The precheck is an optimization, never the completion authority. Do not persist attempts for every partial keystroke or flash failures during typing. Enter remains available for partial feedback. If normalization versions differ, disable the optimization and retain server checking.

Enable automatic advancement for the requested experience, with a persistent preference to pause after success. Add automatic checking after the single-submit advance/play path is reliable. Avoid competing timers across components.

### Transition rules

| Event | Required behavior |
| --- | --- |
| Exact current response | Save once; show feedback; schedule one advance/play transition. |
| Incorrect response | Stay; retain draft; provide non-revealing feedback; keep Replay available. |
| Hint/Reveal | Stay for learning; track exposure; reveal alone does not auto-skip. |
| Draft edited/cleared after submit | Old response cannot validate the new draft or navigate. |
| Manual navigation before response | Save under the original run; do not move the learner again. |
| Dictionary/tutor opened | Suspend advancement; preserve draft/player state; resume deliberately. |
| Recording/pending permission | No auto-navigation; recorder owns stop/discard. |
| Hidden page | Suspend pending auto-play; returning cannot unexpectedly skip/start a sentence. |
| Autoplay blocked | Preserve selection/progress; offer one Resume playback action. |
| Buffering/delayed seek | Wait for valid state with bounded recovery; no play/seek storm. |
| Final segment | Completion/review state without extra navigation. |

Validate async work with identities such as `{videoId, segmentId, sessionId, draftRevision, requestId, transitionGeneration}`. Cancel stale timers when identities change. One global checking boolean cannot represent multiple segment lifecycles safely.

Offer Stay and review during success feedback and easy access to the previous sentence. Automatic advancement must not make vocabulary study inconvenient.

Prioritize input, Replay, Check, and progress. Move database IDs/edit-distance details into optional diagnostics. Keep shortcut help consistent with Enter behavior, preserve normal typing/modal focus, enforce the displayed 2,000-character limit, and define loop/advance precedence.

## 6. Target feature: local contextual dictionary

### Entry points

- Click a visible word after completion/reveal to open its explanation immediately. Multiword selection must support phrasal verbs and idioms.
- Before reveal, allow lookup of learner-entered text without hidden-answer suggestions. Track assistance if help exposes an answer.
- Keep lesson context in a compact side panel, without a second Generate/Confirm step.
- Lead with English meaning and Spanish translation, followed by contextual interpretation, examples, and usage; expand optional details on demand.
- Optionally provide Save word to a local vocabulary list. This is normal application data, not Anki sync or a requirement for a spaced-repetition platform.
- Label generated explanations honestly; do not invent dictionary citations or verified pronunciation claims.

### Proposed contract

Add `POST /api/vocabulary/explain` or an equivalent dedicated endpoint. This does not currently exist. Reuse suitable tutor infrastructure without conflating sentence analysis and selected-term lookup.

Example request:

```json
{
  "segment_id": 123,
  "term": "put up with",
  "selection_start": 7,
  "selection_end": 18,
  "explanation_language": "es"
}
```

Define offset conventions: JavaScript UTF-16 offsets and Python code-point offsets differ for some characters. Validate exact selected text; stable token ranges are another option. Validate context server-side instead of trusting arbitrary client-supplied transcript as the canonical lesson.

Example response:

```json
{
  "term": "put up with",
  "lemma": "put up with",
  "part_of_speech": "phrasal verb",
  "meaning_en": "To tolerate something unpleasant or annoying.",
  "translation": "soportar; tolerar",
  "contextual_meaning": "En esta frase, significa tolerar una situación molesta.",
  "usage_notes": [
    "The object follows the full phrase: put up with something or someone."
  ],
  "examples": [
    {
      "en": "I cannot put up with that noise any longer.",
      "translation": "Ya no puedo soportar ese ruido."
    }
  ],
  "collocations": ["put up with noise", "put up with delays"],
  "other_senses": [],
  "warnings": [],
  "cached": false,
  "provider": "local",
  "model": "configured-local-model"
}
```

This is an illustrative contract, not an actual model response or evidence of an installed model. Bound strings/arrays with Pydantic. Permit uncertainty instead of forcing fabricated answers. Pronunciation/audio can follow through a reliable local source; generated IPA need not block the core dictionary.

### Provider and resource design

One suitable option is an Ollama adapter behind the backend abstraction. Official documentation describes local chat and JSON-schema output. Example model names do not establish hardware suitability: select and benchmark locally before promising speed or quality.

1. Implement real dispatch: local, explicitly chosen optional cloud, or disabled. A provider label is insufficient.
2. Store the local endpoint in backend settings, loopback by default. Do not accept arbitrary provider URLs on browser lookup requests.
3. Distinguish disabled, unreachable, model missing, loading, ready, busy, and timed out. Local readiness cannot depend on a Gemini key.
4. No silent remote fallback, unexpected paid calls, or automatic large model download. Document one-time installation and offline limits.
5. Use the term and a small sentence window. Treat captions as data, not instructions. Do not send audio/full learning history for word lookup.
6. Validate output after generation. A bounded repair must retain original context and malformed output.
7. Cache by term/selection, reference version/context hash, language, provider/model, schema version, and prompt version. Different senses of “bank” cannot share an unconditional word-only explanation.
8. Deduplicate in-flight work, serve caches offline, and ignore stale panel responses.
9. Coordinate model memory with Whisper. Documentation mentions a 4 GB GPU, but this review did not verify hardware. Do not assume both models fit simultaneously. Measure, support appropriate CPU operation, and expose busy state without freezing playback.
10. Structured JSON does not guarantee good teaching. Evaluate reviewed ambiguous words, idioms, phrasal verbs, and grammar usages.

### Vocabulary acceptance examples

| Context | Expected distinction |
| --- | --- |
| “She sat on the bank of the river.” | River-side land, with contextual Spanish sense. |
| “He works at a bank.” | Financial institution; cannot reuse the river explanation. |
| “I can't put up with this noise.” | Explain the full phrasal verb, not independent literal words. |
| “I'm used to working late.” | Familiarity/habitual adjustment followed by a gerund. |
| “I used to work late.” | Past habit, distinguished from the preceding form. |
| Misspelled learner-entered word | Cautious correction/ambiguity, not fabricated certainty. |

## 7. Implementation sequence

Each phase should deliver a reviewable change with targeted regressions, without requiring a global rewrite.

| Phase | Scope | Exit condition |
| --- | --- | --- |
| 1. Trustworthy practice state | F-01, F-03, F-04, F-08, stale-result guards | Sessions work, help is tracked, retries return correct attempts. |
| 2. Continuous dictation | F-02, F-10, relevant F-11/F-20 | Start once → type/check → correct → next plays; focus and blocked playback recover. |
| 3. Local dictionary | F-05, F-12, F-13 | One-action local lookup, validated content, cache, useful unavailable states. |
| 4. Recording/runtime repairs | F-06, F-07, F-09, F-14, F-15, F-16 | Correct capture identity, real discard, safe permission lifecycle, cleanup/shutdown. |
| 5. Transcript/recovery/scaling | F-17, F-18, F-19, remaining F-11/F-20 | Correctable references, resilient imports, stable progress, bounded queries. |
| 6. Validation/documentation | F-21, F-22 | Reproducible isolated tests; live-browser/model results separately recorded. |

Fix F-07/F-09 immediately if recording or the PowerShell shutdown workflow will be used during phases 1–3. Product sequencing does not make those defects safe to ignore.

New vocabulary/correction tables require versioned migrations and backups. `create_all()` is not a migration system. Preserve existing databases, original references, and historical attempts whose meaning depends on earlier transcript versions.

## 8. Regression and acceptance checklist

### Dictation/player

- [ ] Empty-store creation, delayed success/failure, StrictMode, switching during loading.
- [ ] First Hint/Reveal works without an initial Check.
- [ ] Wrong feedback does not expose unrequested corrections.
- [ ] Reveal/retry/history semantics agree across input, sidebar, speaking, and dictionary.
- [ ] A → B → retry A returns A; network retries persist one logical attempt.
- [ ] Correct results advance once and play the next committed bounds.
- [ ] Stale drafts/segments, canceled timers, and hidden tabs cannot auto-navigate.
- [ ] Final-segment completion is explicit.
- [ ] Enter/Shift+Enter/IME, replay, modal focus, and post-check focus work naturally.
- [ ] Preferences control playback without conflicting with advancement.
- [ ] Slow seek, buffering, blocked playback, and script failure recover.
- [ ] Reload restores draft/run; fast navigation persists the latest position.

### Local vocabulary

- [ ] Word/phrase lookup requires one initial action.
- [ ] No Gemini key or remote generation in local mode, including local failure.
- [ ] Unreachable service, missing model, busy, timeout, invalid JSON, and repair failure differ visibly.
- [ ] Context-sensitive caching; identical concurrent requests generate once.
- [ ] Cached entries remain available offline.
- [ ] Late term/segment responses cannot replace current content.
- [ ] Caption prompt-injection text remains data.
- [ ] Reviewed examples cover ambiguity, phrasal verbs, idioms, and “used to” distinctions.
- [ ] Actual latency, memory use, and coexistence with Whisper are measured locally.

### Recording/ingestion/runtime

- [ ] A's capture cannot be evaluated as B.
- [ ] Discard stops tracks, discards late events/blob, and keeps UI/store consistent.
- [ ] Permission granted after cancel/unmount is immediately released.
- [ ] Success/failure/interruption clean owned temporary media.
- [ ] Slow conversion does not block unrelated requests.
- [ ] Idempotency checks operation/target/content identity.
- [ ] Segments satisfy finite `0 <= start < end <= video_duration` after every transformation.
- [ ] Spoken parentheses, rolling captions, repetition, and long coarse captions are deliberate.
- [ ] Transcript edits version references and preserve history.
- [ ] Polling disconnect, duplicates, closed-modal completion, and stale saved jobs recover.
- [ ] Detail queries do not load complete histories per segment.
- [ ] Shutdown cannot terminate unrelated listeners or reused PIDs.
- [ ] Tests isolate database/media/models throughout lifespan and worker execution.
- [ ] Anki remains outside scope.

### Real-user walkthrough before declaring completion

Use a short real YouTube video with clear English and at least ten segments. Complete several without Next/Play after success; make errors; use a hint; reveal/retry; look up a word and phrase; change speed; revisit a sentence; refresh; briefly disconnect the backend; finish the lesson. Then cancel microphone permission and make an actual recording on another sentence.

Record actual observations, including autoplay restrictions and transcript mismatches. Mock-player success alone does not establish a comfortable YouTube experience.

## 9. Guardrails for the implementing AI

- Implement current requirements, not obsolete manual-navigation policies.
- Preserve data and useful architecture; avoid unnecessary dependencies/platform migrations.
- Keep deterministic grading separate from generated vocabulary explanations.
- Separate historical progress, current-run visibility, capture identity, and transitions.
- Provide explicit loading/error/unavailable/blocked-playback states.
- Add regressions for observed bugs; do not alter tests merely to accept incorrect behavior.
- Do not claim verification from tests that bypass initialization or pre-fill state.
- Do not add Anki, deck exports, cloud sync, or a full flashcard platform.

## 10. Primary references

These support API/lifecycle design details. Project findings are grounded in local code and probes above.

- [React useEffect reference](https://react.dev/reference/react/useEffect): cleanup precedes new setup when dependencies change; development StrictMode adds a setup/cleanup cycle.
- [YouTube IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference): playback events, seeking, and `onAutoplayBlocked`.
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs): local requests using a JSON schema in `format`, followed by application-side validation.

**No fixes in this handoff have been implemented by the reviewer.**
