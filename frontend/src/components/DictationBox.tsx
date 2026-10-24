import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import { SegmentDTO } from '../api/types';
import { apiClient } from '../api/client';
import { useStudyStore } from '../stores/useStudyStore';
import { normalizeText, DisplayToken } from '../utils/aligner';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

export interface DictationBoxProps {
  segment: SegmentDTO;
  onNext?: () => void;
  isLastSegment?: boolean;
}

export const DictationBox: React.FC<DictationBoxProps> = ({
  segment,
  onNext,
  isLastSegment = false,
}) => {
  const {
    drafts,
    setDraft,
    sessions,
    setSession,
    results,
    setResult,
    staleDiffs,
    updateSegment,
  } = useStudyStore();

  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isHinting, setIsHinting] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hintMessage, setHintMessage] = useState<string | null>(null);

  const draft = drafts[segment.id] ?? '';
  const session = sessions[segment.id] ?? null;
  const result = results[segment.id] ?? null;
  const isStale = staleDiffs[segment.id] ?? false;

  // Initialize or load practice session for this segment
  useEffect(() => {
    let isMounted = true;
    if (!session && !isLoadingSession) {
      setIsLoadingSession(true);
      apiClient
        .createSession(segment.id)
        .then((sess) => {
          if (isMounted) {
            setSession(segment.id, sess);
          }
        })
        .catch((err) => {
          console.error('Failed to create practice session:', err);
        })
        .finally(() => {
          if (isMounted) {
            setIsLoadingSession(false);
          }
        });
    }
    return () => {
      isMounted = false;
    };
  }, [segment.id, session, isLoadingSession, setSession]);

  // Extract display tokens from target segment text
  const targetNorm = useMemo(() => {
    try {
      return normalizeText(segment.text, false);
    } catch {
      return { display_tokens: [] as DisplayToken[], canonical_tokens: [] };
    }
  }, [segment.text]);

  // Determine whether each display token is matched in latest non-stale result
  const matchedDisplayTokens = useMemo(() => {
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

  const isCompleted = segment.completed || (result?.completed ?? false);
  const isRevealed = segment.revealed || (session?.answer_revealed ?? false);

  // Check action
  const handleCheck = useCallback(async () => {
    if (!draft.trim() || isChecking) return;

    setIsChecking(true);
    setCheckError(null);
    setHintMessage(null);

    try {
      let activeSession = session;
      if (!activeSession) {
        activeSession = await apiClient.createSession(segment.id);
        setSession(segment.id, activeSession);
      }

      const checkRes = await apiClient.checkDictation(activeSession.id, {
        input_text: draft,
      });

      setResult(segment.id, checkRes);

      if (checkRes.is_exact) {
        if (!activeSession.answer_revealed) {
          updateSegment(segment.id, {
            completed: true,
            shadowing_unlocked: true,
          });
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to evaluate dictation';
      setCheckError(message);
    } finally {
      setIsChecking(false);
    }
  }, [session, draft, isChecking, segment.id, setSession, setResult, updateSegment]);

  // Hint action: targets first display token not matched and not hinted
  const handleHint = useCallback(async () => {
    if (!session || isHinting || isCompleted || isRevealed) return;

    const hintedSet = new Set(session.hinted_display_indices);
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

    try {
      const hintRes = await apiClient.getHint(session.id, candidate.index);
      setSession(segment.id, {
        ...session,
        hinted_display_indices: hintRes.hinted_display_indices,
      });
    } catch (err: unknown) {
      console.error('Failed to get hint:', err);
    } finally {
      setIsHinting(false);
    }
  }, [
    session,
    isHinting,
    isCompleted,
    isRevealed,
    targetNorm.display_tokens,
    matchedDisplayTokens,
    segment.id,
    setSession,
  ]);

  // Reveal action
  const handleReveal = useCallback(async () => {
    if (!session || isRevealing || isCompleted || isRevealed) return;

    setIsRevealing(true);
    setCheckError(null);

    try {
      const revRes = await apiClient.revealAnswer(session.id);
      setSession(segment.id, {
        ...session,
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
  }, [session, isRevealing, isCompleted, isRevealed, segment.id, setSession, updateSegment]);

  // Try again action: create fresh session
  const handleTryAgain = useCallback(async () => {
    setIsLoadingSession(true);
    setCheckError(null);
    setHintMessage(null);
    setDraft(segment.id, '');

    try {
      const newSess = await apiClient.createSession(segment.id);
      setSession(segment.id, newSess);
    } catch (err: unknown) {
      console.error('Failed to reset session:', err);
    } finally {
      setIsLoadingSession(false);
    }
  }, [segment.id, setDraft, setSession]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check on Enter (without Shift) OR Ctrl+Enter / Cmd+Enter
    if ((e.key === 'Enter' && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.keyCode === 13))) {
      e.preventDefault();
      handleCheck();
    }
  };

  useKeyboardShortcuts({
    onHint: handleHint,
    onClose: showHelpModal ? () => setShowHelpModal(false) : undefined,
  });

  return (
    <div className="bg-surface rounded-panel border border-border p-5 shadow-lg space-y-5">
      {/* Shortcut Help Modal */}
      {showHelpModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-help-title"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-surface border border-border rounded-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center space-x-2 text-accent">
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
                <span className="text-text-secondary">Reveal first letter hint</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+H
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Previous sentence</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+Left
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-text-secondary">Next sentence</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Alt+Right
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-text-secondary">Close modal / dialog</span>
                <kbd className="px-2 py-0.5 rounded bg-surface-raised border border-border font-mono text-accent">
                  Esc
                </kbd>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-1.5 rounded-control text-xs font-semibold bg-accent text-background hover:bg-accent-hover transition"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header bar: Word Slots & Shortcuts trigger */}
      <div className="flex items-center justify-between border-b border-border/70 pb-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
            Sentence Word Slots
          </span>
          <span className="text-[11px] font-mono text-text-secondary">
            ({targetNorm.display_tokens.length} words)
          </span>
        </div>

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

      {/* Word Slots Container (Section 7.3) */}
      <div
        role="region"
        aria-label="Target sentence word placeholders"
        className="flex flex-wrap gap-2 p-3.5 bg-background/80 rounded-control border border-border/60 min-h-[52px] items-center"
      >
        {targetNorm.display_tokens.map((token) => {
          // If sentence is revealed or completed: display actual word
          if (isCompleted || isRevealed) {
            return (
              <span
                key={token.index}
                className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition ${
                  isCompleted
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {token.text}
              </span>
            );
          }

          // In progress: check if token matched in latest non-stale check
          const isMatched = matchedDisplayTokens.has(token.index);
          if (isMatched) {
            return (
              <span
                key={token.index}
                className="px-2.5 py-1 rounded text-xs font-mono font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 transition"
              >
                {token.text}
              </span>
            );
          }

          // Check if token has received a hint
          const isHinted = session?.hinted_display_indices.includes(token.index);
          if (isHinted) {
            const dashesCount = Math.max(1, Math.min(8, token.text.length) - 1);
            return (
              <span
                key={token.index}
                className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 tracking-wider transition"
                title={`Hint: starts with '${token.text[0]}'`}
                aria-label={`Word hint: starts with ${token.text[0]}`}
              >
                {token.text[0]}
                {'-'.repeat(dashesCount)}
              </span>
            );
          }

          // Default placeholder: dashes matching approximate written length capped at 8
          const dashLen = Math.min(8, Math.max(2, token.text.length));
          return (
            <span
              key={token.index}
              className="px-2 py-1 rounded text-xs font-mono text-slate-500 bg-surface-raised/60 border border-border/40 tracking-widest select-none"
              aria-label={`Hidden word, length ${token.text.length}`}
            >
              {'-'.repeat(dashLen)}
            </span>
          );
        })}
      </div>

      {/* Hint notice message if any */}
      {hintMessage && (
        <div
          role="status"
          className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded-control flex items-center space-x-2"
        >
          <Lightbulb className="w-4 h-4 shrink-0 text-amber-400" />
          <span>{hintMessage}</span>
        </div>
      )}

      {/* Error Banner */}
      {checkError && (
        <div
          role="alert"
          className="text-xs text-danger bg-danger/10 border border-danger/30 px-3 py-2.5 rounded-control flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{checkError}</span>
          </div>
          <button
            type="button"
            onClick={handleCheck}
            className="text-[11px] underline font-semibold hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Feedback Banner on Completed / Evaluated */}
      {result && !isStale && (
        <div
          role="region"
          aria-label="Dictation evaluation feedback"
          className={`p-3.5 rounded-control border text-xs space-y-2 transition ${
            result.is_exact
              ? isRevealed
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-surface-raised border-border text-text-secondary'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm">
                {result.is_exact
                  ? isRevealed
                    ? 'Answer reviewed'
                    : 'Dictation completed!'
                  : 'Needs practice'}
              </span>
              {result.assisted && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] uppercase font-bold tracking-wider">
                  Assisted
                </span>
              )}
            </div>

            <div className="flex items-center space-x-3 font-mono font-semibold">
              <span>Score: {result.score}%</span>
              <span className="text-slate-400">Distance: {result.distance}</span>
            </div>
          </div>

          {!result.is_exact && (
            <div className="space-y-2">
              <div className="flex items-center space-x-4 text-[11px] text-slate-300 pt-1">
                <span>
                  Substitutions: {result.alignment.filter((a) => a.op === 'substitution').length}
                </span>
                <span>
                  Omissions: {result.alignment.filter((a) => a.op === 'omission').length}
                </span>
                <span>
                  Insertions: {result.alignment.filter((a) => a.op === 'insertion').length}
                </span>
              </div>

              {/* Visual Word-by-Word Alignment Breakdown */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
                {result.alignment.map((item, idx) => {
                  if (item.op === 'match') {
                    return (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px] border border-emerald-500/40 font-semibold"
                        title="Correct match"
                      >
                        ✓ {item.target || item.input}
                      </span>
                    );
                  }
                  if (item.op === 'substitution') {
                    return (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[11px] border border-rose-500/40 inline-flex items-center"
                        title={`Typed "${item.input}", expected "${item.target}"`}
                      >
                        <span className="line-through opacity-75">{item.input}</span>
                        <span className="text-emerald-400 font-bold ml-1">→ {item.target}</span>
                      </span>
                    );
                  }
                  if (item.op === 'omission') {
                    return (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px] border border-amber-500/40"
                        title={`Missing word: "${item.target}"`}
                      >
                        + missing: {item.target}
                      </span>
                    );
                  }
                  if (item.op === 'insertion') {
                    return (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono text-[11px] border border-rose-500/40"
                        title={`Extra word: "${item.input}"`}
                      >
                        <span className="line-through">{item.input}</span> (extra)
                      </span>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Single Accessible Textarea (Section 7.3) */}
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
          value={draft}
          onChange={(e) => setDraft(segment.id, e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isChecking}
          placeholder="Listen to the audio and transcribe the sentence here (Ctrl+Enter to check)..."
          rows={3}
          className="w-full bg-background border border-border focus:border-accent rounded-control p-3.5 text-sm text-text-primary placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/20 transition resize-y font-sans leading-relaxed disabled:opacity-50"
        />
      </div>

      {/* Dictation Action Buttons with Tooltip Reasons (Section 7.3, 8.2) */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          {/* Check Button */}
          <button
            type="button"
            onClick={handleCheck}
            disabled={!draft.trim() || isChecking}
            title={
              !draft.trim()
                ? 'Type what you hear before checking'
                : 'Evaluate dictation accuracy (Ctrl+Enter)'
            }
            aria-label="Check sentence"
            className="px-4 py-2 rounded-control text-xs font-semibold bg-accent text-background hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition shadow-md shadow-accent/20 flex items-center space-x-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isChecking ? 'Checking...' : 'Check'}</span>
          </button>

          {/* Hint Button */}
          <button
            type="button"
            onClick={handleHint}
            disabled={isCompleted || isRevealed || isHinting}
            title={
              isCompleted || isRevealed
                ? 'Hints disabled for revealed/completed sentences'
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
            disabled={isCompleted || isRevealed || isRevealing}
            title={
              isCompleted || isRevealed
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
          {(isRevealed || (result && !result.is_exact)) && (
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

        {/* Next Sentence Button (Shown on completion or reveal, Section 7.3) */}
        {(isCompleted || isRevealed) && !isLastSegment && (
          <button
            type="button"
            onClick={onNext}
            title="Advance to next sentence"
            aria-label="Advance to next"
            className="px-4 py-2 rounded-control text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 flex items-center space-x-1.5 ml-auto"
          >
            <span>Next sentence</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
