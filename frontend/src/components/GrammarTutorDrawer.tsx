import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  BookOpen,
  Volume2,
  Lightbulb,
  AlertCircle,
  Settings as SettingsIcon,
  Zap,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import { SegmentDTO, TutorExplanationDTO, TutorKeyVocabularyType } from '../api/types';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudyStore } from '../stores/useStudyStore';

export interface GrammarTutorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  segment: SegmentDTO | null;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

type DrawerState = 'checking' | 'disabled' | 'idle' | 'loading' | 'ready' | 'error';

const LANGUAGE_OPTIONS = [
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'pt', label: 'Portuguese (Português)' },
];

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
  const { explanationLanguage, setExplanationLanguage } = useSettingsStore();
  const { tutorExplanations, setTutorExplanation } = useStudyStore();

  const [selectedLang, setSelectedLang] = useState(explanationLanguage);
  const [drawerState, setDrawerState] = useState<DrawerState>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentExplanation, setCurrentExplanation] = useState<TutorExplanationDTO | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Sync selected language with settings store
  useEffect(() => {
    setSelectedLang(explanationLanguage);
  }, [explanationLanguage]);

  // Check tutor availability & cached state on drawer open
  useEffect(() => {
    if (!isOpen || !segment) return;

    let isMounted = true;
    const cacheKey = `${segment.id}_${selectedLang}`;
    const cached = tutorExplanations[cacheKey];

    if (cached) {
      setCurrentExplanation(cached);
      setDrawerState('ready');
      return;
    }

    // Check health to see if tutor is enabled
    apiClient
      .getHealth()
      .then((health) => {
        if (!isMounted) return;
        if (!health.tutor.enabled) {
          setDrawerState('disabled');
        } else {
          setDrawerState('idle');
          setCurrentExplanation(null);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Failed to query health for tutor check:', err);
        // Default to idle to allow attempt
        setDrawerState('idle');
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, segment, selectedLang, tutorExplanations]);

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

  // Request explanation from API
  const handleFetchExplanation = async () => {
    if (!segment) return;

    setDrawerState('loading');
    setErrorMessage(null);

    try {
      const result = await apiClient.explainSegment(segment.id, selectedLang);
      setCurrentExplanation(result);
      setTutorExplanation(segment.id, selectedLang, result);
      setDrawerState('ready');
    } catch (err: unknown) {
      setDrawerState('error');
      if (err instanceof ApiError) {
        if (err.code === 'TUTOR_DISABLED') {
          setDrawerState('disabled');
          return;
        }
        if (err.code === 'TUTOR_QUOTA_EXCEEDED') {
          setErrorMessage('Tutor rate limit or quota exceeded. Please try again in a few moments.');
          return;
        }
        if (err.code === 'SEGMENT_LOCKED') {
          setErrorMessage('Sentence must be completed or revealed before requesting tutor analysis.');
          return;
        }
        setErrorMessage(err.message || 'Failed to generate tutor explanation.');
      } else {
        setErrorMessage('Unable to connect to tutor service. Check network or local backend.');
      }
    }
  };

  const handleLanguageChange = (lang: string) => {
    setSelectedLang(lang);
    setExplanationLanguage(lang);
    if (segment) {
      const cacheKey = `${segment.id}_${lang}`;
      const cached = tutorExplanations[cacheKey];
      if (cached) {
        setCurrentExplanation(cached);
        setDrawerState('ready');
      } else {
        setCurrentExplanation(null);
        setDrawerState('idle');
      }
    }
  };

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
                Pedagogical B2 explanation of target sentence
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

          {/* Language Selector */}
          <div className="flex items-center justify-between text-xs pt-1">
            <label htmlFor="tutor-lang-select" className="text-text-secondary font-medium">
              Explanation language:
            </label>
            <select
              id="tutor-lang-select"
              value={selectedLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              disabled={drawerState === 'loading'}
              className="px-2.5 py-1 rounded-control bg-surface-raised border border-border text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
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

          {/* STATE: Idle */}
          {drawerState === 'idle' && (
            <div className="space-y-4 pt-2">
              <div className="p-3.5 rounded-panel bg-surface-raised/50 border border-border/60 flex items-start space-x-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  Only this sentence and its immediate neighbors are sent to the AI provider.
                  Full video transcripts, audio files, and practice records are never transmitted.
                </p>
              </div>

              <button
                type="button"
                onClick={handleFetchExplanation}
                className="w-full py-2.5 px-4 rounded-control bg-accent hover:bg-accent/90 text-background font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-lg shadow-accent/20 transition active:scale-98"
              >
                <Sparkles className="w-4 h-4" />
                <span>Explain this sentence</span>
              </button>
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
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Connected Speech Tips */}
              {currentExplanation.connected_speech.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary px-1">
                    Connected Speech Tips ({currentExplanation.connected_speech.length})
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

              {/* Metadata & Cache Footer */}
              <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-text-secondary">
                <span className="flex items-center space-x-1">
                  {currentExplanation.cached ? (
                    <span className="text-emerald-400 font-semibold flex items-center space-x-1">
                      <Zap className="w-3 h-3" />
                      <span>Cached response</span>
                    </span>
                  ) : (
                    <span>Generated live</span>
                  )}
                </span>
                <span className="font-mono text-slate-400">
                  {`${currentExplanation.provider} (${currentExplanation.model})`}
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
