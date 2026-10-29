import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Check,
  Eye,
  RotateCcw,
  ArrowRight,
  AlertCircle,
  Lightbulb,
  Keyboard,
  X,
  Trash2,
  Mic,
  MicOff,
  BookOpen,
} from 'lucide-react';
import { SegmentDTO } from '../api/types';
import { apiClient } from '../api/client';
import { useStudyStore } from '../stores/useStudyStore';
import { normalizeText, DisplayToken } from '../utils/aligner';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useSettingsStore } from '../stores/useSettingsStore';

export interface DictationBoxProps {
  isActive?: boolean;
  segment: SegmentDTO;
  onNext?: (autoPlay?: boolean) => void;
  isLastSegment?: boolean;
  onSelectWord?: (word: string) => void;
  onToggleShadowing?: () => void;
  isShadowingRecording?: boolean;
}

export const DictationBox: React.FC<DictationBoxProps> = ({
  isActive = true,
  segment,
  onNext,
  isLastSegment = false,
  onSelectWord,
  onToggleShadowing,
  isShadowingRecording = false,
}) => {
  const autoAdvance = useSettingsStore(s => s.autoAdvance);
  const setAutoAdvance = useSettingsStore(s => s.setAutoAdvance);
  const {
    drafts,
    setDraft,
    sessions,
    setSession,
    results,
    setResult,
    staleDiffs,
    setStaleDiff,
    updateSegment,
    retryingSegmentId,
    setRetryingSegmentId,
  } = useStudyStore();

  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isHinting, setIsHinting] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<string>('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTabTimeRef = useRef<number>(0);
  const autoSubmittedRef = useRef<boolean>(false);
  const currentSubmissionIdRef = useRef<string | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSegmentIdRef = useRef<number>(segment.id);
  activeSegmentIdRef.current = segment.id;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const inFlightSessionRef = useRef<{ segmentId: number; promise: Promise<import('../api/types').SessionResponseDTO> } | null>(null);

  const draft = drafts[segment.id] ?? '';
  const session = sessions[segment.id] ?? null;
  const result = results[segment.id] ?? null;
  const isStale = staleDiffs[segment.id] ?? false;

  // Clear pending advance timer and draft selection when switching segments or unmounting
  useEffect(() => {
    setSelectedText('');
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, [segment.id, isActive, autoAdvance]);

  // 1. Stable, deduplicated session provider (Fixes Bug F-01 & StrictMode race conditions)
  const ensureSession = useCallback(
    async (targetSegmentId: number): Promise<import('../api/types').SessionResponseDTO> => {
      const existing = sessions[targetSegmentId];
      if (existing) return existing;

      if (inFlightSessionRef.current && inFlightSessionRef.current.segmentId === targetSegmentId) {
        return inFlightSessionRef.current.promise;
      }

      setIsLoadingSession(true);
      const p = apiClient
        .createSession(targetSegmentId)
        .then((sess) => {
          setSession(targetSegmentId, sess);
          return sess;
        })
        .finally(() => {
          if (inFlightSessionRef.current?.segmentId === targetSegmentId) {
            inFlightSessionRef.current = null;
          }
          if (activeSegmentIdRef.current === targetSegmentId) {
            setIsLoadingSession(false);
          }
        });

      inFlightSessionRef.current = { segmentId: targetSegmentId, promise: p };
      return p;
    },
    [sessions, setSession]
  );

  useEffect(() => {
    if (!session && isActive) {
      ensureSession(segment.id).catch((err) => {
        console.error('Failed to create practice session:', err);
      });
    }
  }, [segment.id, session, ensureSession, isActive]);

  // Reset auto-submit tracker and submission ID on segment change
  useEffect(() => {
    autoSubmittedRef.current = false;
    currentSubmissionIdRef.current = null;
  }, [segment.id]);

  // 2. Extract display tokens from target segment text
  const targetNorm = useMemo(() => {
    try {
      return normalizeText(segment.text, false);
    } catch {
      return { display_tokens: [] as DisplayToken[], canonical_tokens: [] };
    }
  }, [segment.text]);

  // 3. Extract tokens from user draft for live matching
  const draftNorm = useMemo(() => {
    try {
      return normalizeText(draft, false);
    } catch {
      return { display_tokens: [] as DisplayToken[], canonical_tokens: [] };
    }
  }, [draft]);

  // 4. Live sequential matching from left to right (FluentDictation reactive highlight)
  const liveMatchedIndices = useMemo(() => {
    if (isStale) return new Set<number>();
    const matched = new Set<number>();
    const targetTokens = targetNorm.display_tokens;
    const userTokens = draftNorm.display_tokens;

    for (let i = 0; i < targetTokens.length && i < userTokens.length; i++) {
      const targetClean = targetTokens[i].text.toLowerCase().replace(/[^\w]/g, '');
      const userClean = userTokens[i].text.toLowerCase().replace(/[^\w]/g, '');
      if (targetClean === userClean) {
        matched.add(targetTokens[i].index);
      } else {
        break;
      }
    }
    return matched;
  }, [targetNorm.display_tokens, draftNorm.display_tokens, isStale]);

  // 5. Server-evaluated matched display tokens from latest non-stale result
  const serverMatchedDisplayTokens = useMemo(() => {
    if (!result || isStale) return new Set<number>();
    const matched = new Set<number>();

    for (const dt of targetNorm.display_tokens) {
      const allCanonicalMatched = dt.canonical_indices.every((cIdx) => {
        const op = result.alignment.find((a) => a.target_index === cIdx);
        return op && op.op === 'match';
      });
      if (allCanonicalMatched) {
        matched.add(dt.index);
      }
    }
    return matched;
  }, [result, isStale, targetNorm.display_tokens]);

  // Combined matched tokens: union of server evaluated and live matched
  const matchedDisplayTokens = useMemo(() => {
    const combined = new Set<number>(serverMatchedDisplayTokens);
    liveMatchedIndices.forEach((idx) => combined.add(idx));
    return combined;
  }, [serverMatchedDisplayTokens, liveMatchedIndices]);

  const isRetrying = retryingSegmentId === segment.id;
  const isCompleted = segment.completed || (result?.completed ?? false);
  const isRevealed = session?.answer_revealed ?? false;

  // Answer visibility policy (Fix Bugs F-03 & F-04):
  // Target words are concealed during active practice and hidden retries.
  // They are only revealed if:
  // 1. Session is explicitly revealed (session.answer_revealed === true)
  // 2. Or completed in this session/attempt (result?.is_exact === true)
  // 3. Or viewing an already-completed/revealed sentence in review mode (not retrying).
  const isAnswerVisible =
    isRevealed ||
    (result?.is_exact ?? false) ||
    (!isRetrying && (segment.completed || segment.revealed));

  // 6. Check action
  const handleCheck = useCallback(async (_isAuto = false) => {
    if (!draft.trim() || isChecking) return;

    setIsChecking(true);
    setCheckError(null);
    setHintMessage(null);

    try {
      const activeSession = session || await ensureSession(segment.id);
      if (!currentSubmissionIdRef.current) {
        currentSubmissionIdRef.current =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `check_${Date.now()}`;
      }

      const checkRes = await apiClient.checkDictation(activeSession.id, {
        input_text: draft,
        client_request_id: currentSubmissionIdRef.current,
      });

      // Clear stable request ID on successful response so next draft gets fresh ID
      currentSubmissionIdRef.current = null;
      setResult(segment.id, checkRes);

      if (checkRes.is_exact) {
        setRetryingSegmentId(null);
        if (!activeSession.answer_revealed) {
          updateSegment(segment.id, {
            completed: true,
            shadowing_unlocked: true,
          });
        }
        // Continuous dictation (F-02): automatically advance and play next segment after brief UX feedback (approx 600ms)
        if (autoAdvance && isActiveRef.current && activeSegmentIdRef.current === segment.id && onNext && !isLastSegment && !isShadowingRecording) {
          if (advanceTimerRef.current) {
            clearTimeout(advanceTimerRef.current);
          }
          advanceTimerRef.current = setTimeout(() => {
            onNext(true);
          }, 600);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to evaluate dictation';
      setCheckError(message);
    } finally {
      setIsChecking(false);
    }
  }, [draft, isChecking, session, segment.id, ensureSession, setResult, updateSegment, setRetryingSegmentId, onNext, isLastSegment, isShadowingRecording, autoAdvance, isActive]);

  // 7. Auto-submit on 100% exact live match
  useEffect(() => {
    const allMatched =
      targetNorm.display_tokens.length > 0 &&
      liveMatchedIndices.size === targetNorm.display_tokens.length;

    if (allMatched && !autoSubmittedRef.current && !isAnswerVisible) {
      autoSubmittedRef.current = true;
      handleCheck(true);
    }
  }, [liveMatchedIndices.size, targetNorm.display_tokens.length, isAnswerVisible, handleCheck]);

  // 8. Hint action: First-letter hint
  const handleHint = useCallback(async () => {
    if (isHinting || isAnswerVisible) return;

    try {
      const activeSession = session || await ensureSession(segment.id);
      if (!activeSession) return;

      const hintedSet = new Set(activeSession.hinted_display_indices);
      const candidate = targetNorm.display_tokens.find(
        (dt) => !hintedSet.has(dt.index) && !matchedDisplayTokens.has(dt.index)
      );

      if (!candidate) {
        setHintMessage('No more hints available for this sentence.');
        setTimeout(() => setHintMessage(null), 3000);
        return;
      }

      setIsHinting(true);
      setHintMessage(null);

      const hintRes = await apiClient.getHint(activeSession.id, candidate.index);
      setSession(segment.id, {
        ...activeSession,
        hinted_display_indices: hintRes.hinted_display_indices,
      });
    } catch (err: unknown) {
      console.error('Failed to get hint:', err);
    } finally {
      setIsHinting(false);
    }
  }, [
    session,
    ensureSession,
    isHinting,
    isAnswerVisible,
    targetNorm.display_tokens,
    matchedDisplayTokens,
    segment.id,
    setSession,
  ]);

  // Double-Tab hint action: fills in the next missing word
  const handleDoubleTabHint = useCallback(async () => {
    if (isAnswerVisible) return;

    const nextUnmatched = targetNorm.display_tokens.find(
      (dt) => !matchedDisplayTokens.has(dt.index)
    );
    if (!nextUnmatched) return;

    const current = draft.trim();
    const newDraft = current ? `${current} ${nextUnmatched.text}` : nextUnmatched.text;
    setDraft(segment.id, newDraft);

    try {
      const activeSession = session || await ensureSession(segment.id);
      if (activeSession) {
        apiClient.getHint(activeSession.id, nextUnmatched.index).catch(() => {});
      }
    } catch {}

    setHintMessage(`Pista: "${nextUnmatched.text}"`);
    setTimeout(() => setHintMessage(null), 2000);
  }, [isAnswerVisible, targetNorm.display_tokens, matchedDisplayTokens, draft, setDraft, segment.id, session, ensureSession]);

  // Reveal answer
  const handleReveal = useCallback(async () => {
    if (isRevealing || isAnswerVisible) return;

    setIsRevealing(true);
    setCheckError(null);

    try {
      const activeSession = session || await ensureSession(segment.id);
      const revRes = await apiClient.revealAnswer(activeSession.id);
      setRetryingSegmentId(null);
      setSession(segment.id, {
        ...activeSession,
        answer_revealed: true,
      });
      updateSegment(segment.id, {
        revealed: true,
        shadowing_unlocked: revRes.shadowing_unlocked,
      });
    } catch (err: unknown) {
      console.error('Failed to reveal answer:', err);
    } finally {
      setIsRevealing(false);
    }
  }, [session, ensureSession, isRevealing, isAnswerVisible, segment.id, setSession, updateSegment, setRetryingSegmentId]);

  // Try again action (conceals answers across all surfaces for fresh practice)
  const handleTryAgain = useCallback(async () => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setIsLoadingSession(true);
    setCheckError(null);
    setHintMessage(null);
    setDraft(segment.id, '');
    autoSubmittedRef.current = false;
    currentSubmissionIdRef.current = null;
    setRetryingSegmentId(segment.id);

    try {
      const newSess = await apiClient.createSession(segment.id);
      setSession(segment.id, newSess);
      setResult(segment.id, null);
      textareaRef.current?.focus();
    } catch (err: unknown) {
      console.error('Failed to create new session:', err);
    } finally {
      setIsLoadingSession(false);
    }
  }, [segment.id, setDraft, setSession, setResult, setRetryingSegmentId]);

  // Keyboard shortcuts integration
  useKeyboardShortcuts({
    enabled: isActive,
    onHint: handleHint,
    onClose: () => setShowHelpModal(false),
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      const now = Date.now();
      if (now - lastTabTimeRef.current < 350) {
        e.preventDefault();
        handleDoubleTabHint();
      }
      lastTabTimeRef.current = now;
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      if (e.shiftKey) return; // Shift+Enter allows newline
      e.preventDefault();
      handleCheck(false);
    }
  };

  const hintedIndicesSet = useMemo(
    () => new Set(session?.hinted_display_indices ?? []),
    [session?.hinted_display_indices]
  );

  return (
    <div className="bg-surface rounded-panel border border-border p-5 shadow-lg space-y-4">
      {/* Header and Integrated Mic Controls */}
      <div className="flex items-center justify-between border-b border-border/80 pb-3">
        <div className="flex items-center space-x-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
            Dictation Practice
          </h2>
          {isCompleted && (
            <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              ✓ Completed
            </span>
          )}
          {isRevealed && !isCompleted && (
            <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
              Answer Revealed
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {hintMessage && (
            <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded animate-pulse">
              {hintMessage}
            </span>
          )}

          {onToggleShadowing && (
            <button
              type="button"
              onClick={onToggleShadowing}
              title="Open the speaking activity"
              aria-label="Open speaking practice"
              className={`p-1.5 rounded-full transition-all ${
                isShadowingRecording
                  ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/30'
                  : 'bg-surface-raised hover:bg-accent/20 text-text-secondary hover:text-white border border-border'
              }`}
            >
              {isShadowingRecording ? <MicOff className="w-3.5 h-3.5 text-white" /> : <Mic className="w-3.5 h-3.5 text-accent" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            title="View keyboard shortcuts"
            aria-label="View keyboard shortcuts"
            className="flex items-center space-x-1 text-xs text-text-secondary hover:text-accent transition p-1"
          >
            <Keyboard className="w-4 h-4" />
            <span className="hidden sm:inline text-[11px]">Shortcuts</span>
          </button>
        </div>
      </div>

      <p className="text-sm text-text-secondary leading-relaxed">Listen, then write what you hear. Use a hint if you get stuck, or reveal the answer to study it.</p>
      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer"><input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.target.checked)} className="accent-emerald-300 w-4 h-4" />Automatically play the next sentence after a correct answer</label>
      {/* Word Slots Container (Section 7.3) */}
      <div
        role="region"
        aria-label="Target sentence word placeholders"
        className="flex flex-wrap gap-2 p-3.5 bg-background/80 rounded-control border border-border/60 min-h-[52px] items-center select-none"
      >
        {targetNorm.display_tokens.map((token) => {
          // If answer is visible: display actual word
          if (isAnswerVisible) {
            return (
              <button
                type="button"
                key={token.index}
                onClick={() => onSelectWord?.(token.text)}
                title="Click to inspect British pronunciation and definition"
                className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition cursor-pointer hover:bg-surface-raised ${
                  isCompleted
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {token.text}
              </button>
            );
          }

          // If word matched: display in green
          if (matchedDisplayTokens.has(token.index)) {
            return (
              <button
                type="button"
                key={token.index}
                onClick={() => onSelectWord?.(token.text)}
                title="Matched! Click to inspect British pronunciation"
                className="px-2.5 py-1 rounded text-xs font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-pointer hover:bg-emerald-500/30 transition shadow-xs"
              >
                {token.text}
              </button>
            );
          }

          // If hinted: display first letter + dashes capped at 8
          if (hintedIndicesSet.has(token.index)) {
            const cleanText = token.text.replace(/[^\w]/g, '');
            const firstChar = cleanText.length > 0 ? cleanText[0] : token.text[0];
            const dashCount = Math.min(8, Math.max(2, token.text.length));
            const remainderDashes = '-'.repeat(Math.max(1, dashCount - 1));

            return (
              <span
                key={token.index}
                aria-label={`Word hint: starts with ${firstChar}`}
                className="px-2.5 py-1 rounded text-xs font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 tracking-wider"
              >
                {firstChar}{remainderDashes}
              </span>
            );
          }

          // Concealed word: dashes capped strictly at 8 characters
          const dashCount = Math.min(8, Math.max(2, token.text.length));
          const placeholderDashes = '-'.repeat(dashCount);

          return (
            <span
              key={token.index}
              className="px-2.5 py-1 rounded text-xs font-mono text-slate-500 tracking-wider bg-surface/50 border border-border/40 select-none"
            >
              {placeholderDashes}
            </span>
          );
        })}
      </div>

      {/* Evaluation Feedback Panel */}
      {result && !isStale && (
        <div className="p-3.5 rounded-control bg-surface-raised border border-border text-xs space-y-2 animate-in fade-in duration-150">
          <div className="flex items-center justify-between font-semibold">
            <span className={result.is_exact ? 'text-emerald-400' : 'text-amber-400'}>
              {result.is_exact ? 'Dictation completed!' : 'Needs practice'}
            </span>
            <span className="font-mono text-slate-300">Score: {result.score}%</span>
          </div>

          {!result.is_exact && (
            <div className="flex items-center space-x-4 text-[11px] text-text-secondary">
              <span>Words to revisit: {result.alignment.filter(a => a.op === 'substitution').length}</span>
              <span>Missing words: {result.alignment.filter(a => a.op === 'omission').length}</span>
            </div>
          )}
        </div>
      )}

      {/* Single Accessible Textarea */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <label htmlFor="dictation-input" className="font-semibold text-white">
            Type what you hear:
          </label>
          <span className="font-mono text-[11px] text-slate-400">
            {draft.length} / 2000 chars
          </span>
        </div>

        <textarea
          id="dictation-input"
          aria-label="Type what you hear"
          value={draft}
          onChange={(e) => {
            if (advanceTimerRef.current) {
              clearTimeout(advanceTimerRef.current);
              advanceTimerRef.current = null;
            }
            currentSubmissionIdRef.current = null;
            setDraft(segment.id, e.target.value);
            setStaleDiff(segment.id, true);
          }}
          onSelect={(e) => {
            const start = e.currentTarget.selectionStart;
            const end = e.currentTarget.selectionEnd;
            if (end > start) {
              const sel = draft.slice(start, end).trim();
              if (sel.length >= 2 && sel.length <= 80) {
                setSelectedText(sel);
                return;
              }
            }
            setSelectedText('');
          }}
          onKeyDown={handleKeyDown}
          disabled={isChecking}
          placeholder="Listen to the audio and transcribe the sentence here..."
          aria-describedby="dictation-input-help"
          maxLength={2000}
          rows={4}
          className="w-full bg-background border border-border focus:border-accent rounded-control p-4 text-base text-text-primary placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/20 transition resize-y font-sans leading-relaxed disabled:opacity-50"
        />
        <p id="dictation-input-help" className="text-xs text-text-secondary">Enter to check · Shift+Enter for a new line · Alt+R to listen again</p>
        {selectedText && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-accent/10 border border-accent/30 text-xs text-text-primary animate-in fade-in duration-100">
            <span className="truncate">
              Selected: <strong className="text-white">"{selectedText}"</strong>
            </span>
            <button
              type="button"
              onClick={() => onSelectWord?.(selectedText)}
              className="ml-2 px-2.5 py-1 rounded bg-accent text-background font-bold text-[11px] hover:bg-accent/90 transition shadow-xs flex items-center gap-1 shrink-0"
            >
              <BookOpen className="w-3 h-3" />
              <span>Inspect in Contextual Dictionary</span>
            </button>
          </div>
        )}
      </div>

      {/* Dictation Action Buttons with Tooltip Reasons */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          {/* Check Button */}
          <button
            type="button"
            onClick={() => handleCheck(false)}
            disabled={!draft.trim() || isChecking || isLoadingSession}
            title={
              !draft.trim()
                ? 'Type what you hear before checking'
                : isLoadingSession
                ? 'Initializing practice session...'
                : 'Evaluate dictation accuracy (Ctrl+Enter)'
            }
            aria-label="Check sentence"
            className="px-4 py-2 rounded-control text-xs font-semibold bg-accent text-background hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition shadow-md shadow-accent/20 flex items-center space-x-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isChecking ? 'Checking...' : isLoadingSession ? 'Loading...' : 'Check'}</span>
          </button>

          {/* Hint Button */}
          <button
            type="button"
            onClick={handleHint}
            disabled={isAnswerVisible || isHinting}
            title={
              isAnswerVisible
                ? 'Hints disabled when answer is already revealed/completed'
                : 'Reveal first letter of next hidden word (Alt+H)'
            }
            aria-label="Get hint"
            className="px-3.5 py-2 rounded-control text-xs font-semibold bg-surface-raised border border-border text-text-secondary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center space-x-1.5"
          >
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span>{isHinting ? 'Hinting...' : 'Hint'}</span>
          </button>

          {/* Reveal Button */}
          <button
            type="button"
            onClick={handleReveal}
            disabled={isAnswerVisible || isRevealing}
            title={
              isAnswerVisible
                ? 'Sentence is already revealed'
                : 'Reveal answer and unlock speaking practice'
            }
            aria-label="Reveal sentence"
            className="px-3.5 py-2 rounded-control text-xs font-semibold bg-surface-raised border border-border text-text-secondary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center space-x-1.5"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isRevealing ? 'Revealing...' : 'Reveal answer'}</span>
          </button>

          {/* Try Again Button (Shown after check or reveal) */}
          {(isAnswerVisible || isCompleted || isRevealed || (result && !result.is_exact)) && (
            <button
              type="button"
              onClick={handleTryAgain}
              title="Start a fresh practice session for this sentence"
              aria-label="Try again"
              className="px-3.5 py-2 rounded-control text-xs font-semibold bg-surface-raised border border-border text-text-secondary hover:text-white transition flex items-center space-x-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Try again</span>
            </button>
          )}

          {/* Clear Draft Button */}
          <button
            type="button"
            onClick={() => setDraft(segment.id, '')}
            disabled={!draft}
            title={!draft ? 'Draft is currently empty' : 'Clear draft text'}
            aria-label="Clear draft"
            className="px-3 py-2 rounded-control text-xs font-semibold text-text-secondary hover:text-danger border border-border/60 hover:border-danger/40 bg-surface-raised disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center space-x-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>

        {/* Next Sentence Button */}
        {(isCompleted || isRevealed) && !isLastSegment && (
          <button
            type="button"
            onClick={() => {
              if (advanceTimerRef.current) {
                clearTimeout(advanceTimerRef.current);
                advanceTimerRef.current = null;
              }
              onNext?.(true);
            }}
            title="Advance to next sentence and play"
            aria-label="Advance to next"
            className="px-4 py-2 rounded-control text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 flex items-center space-x-1.5 ml-auto"
          >
            <span>Next sentence</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {checkError && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-control text-xs text-danger flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{checkError}</span>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showHelpModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-help-title"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-surface border border-border rounded-panel p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/80 pb-3 text-white">
              <div className="flex items-center space-x-2">
                <Keyboard className="w-5 h-5" />
                <h3 id="shortcut-help-title" className="text-sm font-bold text-white">
                  Keyboard Shortcuts
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="text-text-secondary hover:text-white transition p-1"
                aria-label="Close shortcuts modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Pista siguiente palabra</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Tab + Tab
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Replay current sentence</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+R
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Check dictation</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Ctrl+Enter
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Reveal first-letter hint</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+H
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Reveal full answer</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+A
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-text-secondary">Previous / Next sentence</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+Left / Right
                </kbd>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
