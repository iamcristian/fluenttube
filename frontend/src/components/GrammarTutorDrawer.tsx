import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  BookOpen,
  Volume2,
  Lightbulb,
  AlertCircle,
  Settings as SettingsIcon,
  RefreshCw,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import { SegmentDTO, TutorExplanationDTO, TutorKeyVocabularyType } from '../api/types';
import { useStudyStore } from '../stores/useStudyStore';

export interface GrammarTutorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  segment: SegmentDTO | null;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

type DrawerState = 'disabled' | 'loading' | 'ready' | 'error';

const pendingExplanations = new Map<number, Promise<TutorExplanationDTO>>();
const PROFILE = 'sentence-british-v2';
function requestExplanation(id: number) {
  let pending = pendingExplanations.get(id);
  if (!pending) {
    pending = apiClient.explainSegment(id, 'en');
    pendingExplanations.set(id, pending);
    const clear = () => { if (pendingExplanations.get(id) === pending) pendingExplanations.delete(id); };
    pending.then(clear, clear);
  }
  return pending;
}

function getVocabularyBadgeStyle(type: TutorKeyVocabularyType): string {
  switch (type) {
    case 'phrasal_verb':
      return 'bg-purple-950/80 text-purple-300 border-purple-800/60';
    case 'idiom':
      return 'bg-amber-950/80 text-amber-300 border-amber-800/60';
    case 'slang':
      return 'bg-rose-950/80 text-rose-300 border-rose-800/60';
    case 'grammar':
      return 'bg-blue-950/80 text-blue-300 border-blue-800/60';
    case 'word':
    default:
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';
  }
}

export const GrammarTutorDrawer: React.FC<GrammarTutorDrawerProps> = ({
  isOpen,
  onClose,
  segment,
  triggerRef,
}) => {
  const { setTutorExplanation } = useStudyStore();

  const [retry, setRetry] = useState(0);
  const [drawerState, setDrawerState] = useState<DrawerState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentExplanation, setCurrentExplanation] = useState<TutorExplanationDTO | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const segmentId = segment?.id;
  useEffect(() => {
    if (!isOpen || segmentId == null) return;
    let active = true;
    setErrorMessage(null);
    setCurrentExplanation(null);
    const cached = useStudyStore.getState().tutorExplanations[`${segmentId}_${PROFILE}`];
    if (cached) {
      setCurrentExplanation(cached);
      setDrawerState('ready');
      return;
    }
    setDrawerState('loading');
    requestExplanation(segmentId).then(result => {
      setTutorExplanation(segmentId, PROFILE, result);
      if (!active) return;
      setCurrentExplanation(result);
      setDrawerState('ready');
    }).catch(error => {
      if (!active) return;
      setDrawerState(error instanceof ApiError && error.code === 'TUTOR_DISABLED' ? 'disabled' : 'error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to connect to the tutor. Please try again.');
    });
    return () => { active = false; };
  }, [isOpen, segmentId, retry, setTutorExplanation]);

  // Keyboard shortcut: Escape closes drawer (Section 8.4)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus management: focus close button on open, return focus on close
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    } else if (triggerRef?.current) {
      triggerRef.current.focus();
    }
  }, [isOpen, triggerRef]);

  const handleFetchExplanation = () => setRetry(value => value + 1);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutor-drawer-title"
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-[#121824] border-l border-border shadow-2xl flex flex-col text-slate-100 overflow-hidden"
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-border/80 bg-[#151D2A] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-accent/15 text-accent border border-accent/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 id="tutor-drawer-title" className="text-sm font-bold text-white tracking-tight">
                Contextual Grammar Tutor
              </h2>
              <p className="text-[11px] text-text-secondary">
                Spanish translation · English notes · British pronunciation
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close tutor drawer"
            className="p-1.5 rounded-control text-text-secondary hover:text-white bg-surface-raised border border-border/70 hover:border-border transition"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sentence Context Banner */}
          <div className="p-3.5 rounded-panel bg-surface-raised/80 border border-border/80 space-y-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-accent">
              Target Sentence
            </span>
            <p className="text-xs font-medium text-white leading-relaxed">
              {segment?.text || '—'}
            </p>
          </div>

          {/* STATE: Disabled */}
          {drawerState === 'disabled' && (
            <div className="p-5 rounded-panel bg-amber-950/20 border border-amber-800/40 text-center space-y-3 my-4">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <h3 className="text-sm font-semibold text-white">Grammar Tutor is Disabled</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                The AI Grammar Tutor requires a Gemini API key configured in your backend environment.
                The application core functions 100% locally without cloud credentials.
              </p>
              <div className="pt-2">
                <a
                  href="#/settings"
                  onClick={onClose}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-control bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition"
                >
                  <SettingsIcon className="w-3.5 h-3.5" />
                  <span>View Settings & Setup Guide</span>
                </a>
              </div>
            </div>
          )}

          {/* STATE: Loading */}
          {drawerState === 'loading' && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
              <div className="w-8 h-8 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
              <p className="text-xs font-semibold text-white">
                Consulting AI Tutor...
              </p>
              <p className="text-[11px] text-text-secondary">
                Analyzing contextual nuance, connected speech, and idioms
              </p>
            </div>
          )}

          {/* STATE: Error */}
          {drawerState === 'error' && (
            <div className="p-4 rounded-panel bg-danger/10 border border-danger/40 space-y-3">
              <div className="flex items-center space-x-2 text-danger">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <h4 className="text-xs font-bold uppercase tracking-wider">Tutor Analysis Error</h4>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {errorMessage || 'Failed to retrieve explanation from tutor provider.'}
              </p>
              <button
                type="button"
                onClick={handleFetchExplanation}
                className="px-3.5 py-1.5 rounded-control bg-surface-raised hover:bg-surface border border-border text-xs font-semibold text-white flex items-center space-x-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            </div>
          )}

          {/* STATE: Ready / Structured Explanation */}
          {drawerState === 'ready' && currentExplanation && (
            <div className="space-y-4 animate-fadeIn">
              <section className="p-4 rounded-panel bg-surface-raised border border-border space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-accent">Spanish translation</h3>
                <p lang="es" className="text-sm text-slate-200 leading-relaxed">{currentExplanation.spanish_translation}</p>
              </section>
              {/* Contextual Meaning */}
              <section className="p-4 rounded-panel bg-surface-raised border border-border space-y-2">
                <div className="flex items-center space-x-2 text-accent">
                  <BookOpen className="w-4 h-4" />
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Contextual Meaning
                  </h3>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {currentExplanation.contextual_meaning}
                </p>
              </section>

              {/* Key Vocabulary & Grammar Items */}
              {currentExplanation.key_vocabulary.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary px-1">
                    Key Vocabulary & Grammar ({currentExplanation.key_vocabulary.length})
                  </h3>
                  <div className="space-y-2">
                    {currentExplanation.key_vocabulary.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-panel bg-surface-raised border border-border/80 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white font-mono">
                            {item.term}
                          </span>
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${getVocabularyBadgeStyle(
                              item.type
                            )}`}
                          >
                            {item.type.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {item.explanation}
                        </p>
                        <p className="text-xs text-slate-300 leading-relaxed"><strong>Example:</strong> {item.example}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Connected Speech Tips */}
              {currentExplanation.connected_speech.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary px-1">
                    British Connected Speech Tips ({currentExplanation.connected_speech.length})
                  </h3>
                  <div className="space-y-2">
                    {currentExplanation.connected_speech.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-panel bg-surface-raised border border-border/80 space-y-1"
                      >
                        <div className="flex items-center space-x-1.5 text-sky-400 text-xs font-mono font-semibold">
                          <Volume2 className="w-3.5 h-3.5" />
                          <span>{`"${item.fragment}"`}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {item.tip}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-secondary px-1 italic">
                    * Pronunciation tips are deduced from text grammar, not microphone audio.
                  </p>
                </section>
              )}

              {/* Example in Context */}
              {currentExplanation.example && (
                <section className="p-4 rounded-panel bg-surface-raised border border-border space-y-2">
                  <div className="flex items-center space-x-2 text-amber-400">
                    <Lightbulb className="w-4 h-4" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">
                      Example Usage
                    </h3>
                  </div>
                  <blockquote className="border-l-2 border-amber-400/60 pl-3 text-xs italic text-slate-200">
                    {`"${currentExplanation.example.sentence}"`}
                  </blockquote>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {currentExplanation.example.explanation}
                  </p>
                </section>
              )}


            </div>
          )}
        </div>
      </aside>
    </>
  );
};
