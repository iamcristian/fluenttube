import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  BookOpen,
  Sparkles,
  Loader2,
  AlertCircle,
  Cpu,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { OpenWordAtlas } from './phoneticsNavigation';
import {
  DictionaryEntryDTO,
  TutorExplanationDTO,
  SegmentDTO,
  VocabularyExplainResponseDTO,
} from '../api/types';

interface BritishInspectorProps {
  selectedWord: string | null;
  onClearSelectedWord?: () => void;
  segment?: SegmentDTO | null;
  tutorExplanation: TutorExplanationDTO | null;
  isLoadingTutor: boolean;
  tutorError?: string | null;
  onRequestTutor: () => void;
}

export const BritishInspector: React.FC<BritishInspectorProps> = ({
  selectedWord,
  segment,
  tutorExplanation,
  isLoadingTutor,
  tutorError,
  onRequestTutor,
}) => {
  const [activeTab, setActiveTab] = useState<'word' | 'grammar'>('word');
  const openWordAtlas = React.useContext(OpenWordAtlas);
  const [dictEntry, setDictEntry] = useState<DictionaryEntryDTO | null>(null);
  const [vocabResult, setVocabResult] = useState<VocabularyExplainResponseDTO | null>(null);
  const [isLoadingDict, setIsLoadingDict] = useState<boolean>(false);
  const [isLoadingVocab, setIsLoadingVocab] = useState<boolean>(false);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [dictError, setDictError] = useState<string | null>(null);
  const [lookupRetry, setLookupRetry] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Generation guard: prevents older asynchronous responses from overwriting newer word selections (F-12)
  const activeLookupKeyRef = useRef<symbol | null>(null);

  // 1-Click Contextual Dictionary Lookup (Section 6, F-05, F-12)
  useEffect(() => {
    const lookupKey = Symbol('word lookup');
    activeLookupKeyRef.current = lookupKey;
    setIsLoadingDict(false);
    setIsLoadingVocab(false);
    setDictError(null);
    setAudioError(null);
    setIsPlayingAudio(false);
    if (!selectedWord) {
      setVocabResult(null);
      setDictEntry(null);
      setVocabError(null);
      return;
    }

    const term = selectedWord.trim();


    setActiveTab('word');
    setIsLoadingDict(true);
    setIsLoadingVocab(true);
    setVocabError(null);
    setVocabResult(null);
    setDictEntry(null);

    // 1. Fetch UK IPA & Dictionary definition
    const cleanWord = term.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').trim().toLowerCase();
    apiClient
      .getDictionaryEntry(cleanWord)
      .then((entry) => {
        if (activeLookupKeyRef.current === lookupKey) {
          setDictEntry(entry);
        }
      })
      .catch(() => {
        if (activeLookupKeyRef.current === lookupKey) {
          setDictError('Dictionary unavailable. Try this word again.');
        }
      })
      .finally(() => {
        if (activeLookupKeyRef.current === lookupKey) {
          setIsLoadingDict(false);
        }
      });

    // 2. Fetch Local Contextual AI Explanation (Section 6 contract)
    if (segment) {
      apiClient
        .explainVocabulary({
          segment_id: segment.id,
          term: term,
          explanation_language: 'es',
        })
        .then((res) => {
          if (activeLookupKeyRef.current === lookupKey) {
            setVocabResult(res);
          }
        })
        .catch((err: any) => {
          if (activeLookupKeyRef.current === lookupKey) {
            const code = err?.code || '';
            if (
              code === 'TUTOR_PROVIDER_UNAVAILABLE' ||
              code === 'TUTOR_DISABLED' ||
              code === 'TUTOR_TIMEOUT' ||
              err?.statusCode === 503 ||
              err?.statusCode === 504
            ) {
              setVocabError('The optional tutor is unavailable. Dictionary entries remain available. Check your tutor settings and try again.');
            } else {
              setVocabError(err?.message || 'Contextual AI explanation unavailable.');
            }
          }
        })
        .finally(() => {
          if (activeLookupKeyRef.current === lookupKey) {
            setIsLoadingVocab(false);
          }
        });
    } else {
      setIsLoadingVocab(false);
    }
    return () => {
      activeLookupKeyRef.current = null;
    };
  }, [selectedWord, segment?.id, lookupRetry]);

  useEffect(() => {
    return () => {
      if (audioTimeoutRef.current) clearTimeout(audioTimeoutRef.current);
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, [selectedWord, segment?.id]);

  const handleRetryVocab = () => {
    if (!selectedWord || !segment) return;
    const term = selectedWord.trim();
    const lookupKey = activeLookupKeyRef.current;
    setIsLoadingVocab(true);
    setVocabError(null);
    apiClient
      .explainVocabulary({
        segment_id: segment.id,
        term: term,
        explanation_language: 'es',
      })
      .then((res) => {
        if (activeLookupKeyRef.current === lookupKey) {
          setVocabResult(res);
        }
      })
      .catch((err: any) => {
        if (activeLookupKeyRef.current === lookupKey) {
          setVocabError(err?.message || 'Contextual AI explanation unavailable.');
        }
      })
      .finally(() => {
        if (activeLookupKeyRef.current === lookupKey) {
          setIsLoadingVocab(false);
        }
      });
  };

  // Switch to 'grammar' tab if tutor explanation arrives and no word is actively inspected
  useEffect(() => {
    if (tutorExplanation && !selectedWord) {
      setActiveTab('grammar');
    }
  }, [tutorExplanation, selectedWord]);

  const handlePlayAudio = (phrase: string) => {
    if (!phrase) return;
    if (audioTimeoutRef.current) clearTimeout(audioTimeoutRef.current);
    if (audioRef.current) audioRef.current.pause();
    setAudioError(null);
    setIsPlayingAudio(true);
    const audio = new Audio(apiClient.getBritishAudioUrl(phrase));
    audioRef.current = audio;
    const finish = (failed: boolean) => {
      if (audioRef.current !== audio) return;
      if (audioTimeoutRef.current) clearTimeout(audioTimeoutRef.current);
      audioTimeoutRef.current = null;
      setIsPlayingAudio(false);
      if (failed) {
        audio.pause();
        setAudioError('Audio unavailable. Check your connection and try Listen again.');
      }
    };
    audio.onended = () => finish(false);
    audio.onerror = () => finish(true);
    audio.onplaying = () => {
      if (audioRef.current === audio && audioTimeoutRef.current) {
        clearTimeout(audioTimeoutRef.current);
        audioTimeoutRef.current = null;
      }
    };
    audioTimeoutRef.current = setTimeout(() => finish(true), 25000);
    audio.play().catch(() => finish(true));
  };

  const isLoading = isLoadingDict;
  const currentTerm = selectedWord;

  return (
    <div className="h-full flex flex-col bg-surface border-l border-border select-none">
      {/* Header Tabs */}
      <div className="flex items-center border-b border-border bg-surface-raised/40 px-3 py-2 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('word')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            activeTab === 'word'
              ? 'bg-accent/20 text-accent font-bold border border-accent/30'
              : 'text-text-secondary hover:text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Word Inspector</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('grammar')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ml-2 ${
            activeTab === 'grammar'
              ? 'bg-accent/20 text-accent font-bold border border-accent/30'
              : 'text-text-secondary hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>B2 Tutor & Connected Speech</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'word' ? (
          <div>
            {isLoading ? (
              <div className="py-16 flex flex-col items-center justify-center text-text-muted space-y-3">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <p className="text-xs font-mono">Looking up this word...</p>
              </div>
            ) : selectedWord ? (
              <div className="space-y-4 animate-in fade-in duration-150">
                {/* Word Banner with Audio and Provider Tag */}
                <div className="p-3.5 rounded-xl bg-surface-raised border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-wide break-words">
                        {currentTerm}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {dictEntry?.phonetic_uk && (
                          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                            UK {dictEntry.phonetic_uk}
                          </span>
                        )}
                        {!dictEntry?.phonetic_uk && dictEntry?.ipa_options?.map((ipa) => (
                          <span key={ipa} className="text-xs font-mono">UK {ipa}</span>
                        ))}
                        {(vocabResult?.part_of_speech || dictEntry?.part_of_speech) && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">
                            {vocabResult?.part_of_speech || dictEntry?.part_of_speech}
                          </span>
                        )}
                        {vocabResult?.cached && (
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> cached
                          </span>
                        )}
                      </div>
                      {dictEntry && !dictEntry.phonetic_uk && !dictEntry.ipa_options?.length && (
                        <p className="text-xs text-text-muted mt-1">British IPA unavailable for this word.</p>
                      )}
                      {openWordAtlas && dictEntry && (dictEntry.phonetic_uk ? [dictEntry.phonetic_uk] : dictEntry.ipa_options || []).map(ipa =>
                        <button key={ipa} className="quiet-button" onClick={() => openWordAtlas({word: currentTerm || selectedWord, ipa})}>Practicar los sonidos de {ipa}</button>)}
                      {(dictEntry?.phonetic_uk || Boolean(dictEntry?.ipa_options?.length)) && (
                        <p className="text-xs text-text-muted mt-1">
                          {dictEntry?.ipa_quality === 'editorial_pending_review' ? 'Editorial transcription · review pending' : 'Pronunciation source'}
                          {' · '}{dictEntry?.ipa_source || 'Unverified source'}
                        </p>
                      )}
                      {dictEntry?.ipa_notes?.map((note) => (
                        <p key={note} className="text-xs text-text-muted mt-1">{note}</p>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePlayAudio(currentTerm || '')}
                      aria-label={isPlayingAudio ? "Replay British audio" : "Listen to British audio"}
                      aria-busy={isPlayingAudio}
                      title="British synthetic audio · online service"
                      className={`p-2.5 rounded-full transition-all shrink-0 ${
                        isPlayingAudio
                          ? 'bg-accent text-white scale-110 shadow-lg shadow-accent/40'
                          : 'bg-surface hover:bg-accent/20 text-accent hover:text-white border border-accent/30'
                      }`}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  {audioError && <p role="alert" className="text-xs text-amber-300 mt-2">{audioError}</p>}
                  {dictError && (
                    <div role="alert" className="text-xs text-amber-300 mt-2">
                      <p>{dictError}</p>
                      <button type="button" onClick={() => setLookupRetry(value => value + 1)}>Retry dictionary</button>
                    </div>
                  )}
                  {isLoadingVocab && <p role="status" className="text-xs text-text-muted mt-2">Loading contextual explanation…</p>}
                  {vocabResult?.provider && (
                    <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-text-muted">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Cpu className="w-3 h-3 text-accent" />
                        Provider: <strong className="text-slate-300 font-mono">{vocabResult.provider} ({vocabResult.model})</strong>
                      </span>
                      <span>AI explanation</span>
                    </div>
                  )}
                </div>

                {/* Vocabulary Tutor Status/Error Banner */}
                {vocabError && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div className="flex-1">
                      <p className="font-semibold text-white">Optional tutor unavailable</p>
                      <p className="text-[11px] text-amber-200/90 mt-0.5 leading-relaxed">
                        {vocabError}
                      </p>
                      <button
                        type="button"
                        onClick={handleRetryVocab}
                        disabled={isLoadingVocab}
                        className="mt-2 px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-medium transition-colors inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reintentar análisis de vocabulario</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Contextual Meaning & Translation Card (Local AI) */}
                {vocabResult && (
                  <div className="p-3.5 rounded-xl bg-background/60 border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Traducción & Contexto</span>
                      </h4>
                    </div>

                    <div className="space-y-1">
                      <p className="text-sm font-bold text-emerald-400 font-sans">
                        {vocabResult.translation}
                      </p>
                      <p className="text-xs text-text-primary leading-relaxed font-sans">
                        {vocabResult.contextual_meaning}
                      </p>
                      <p className="text-[11px] text-text-muted italic pt-1 border-t border-border/30">
                        EN: {vocabResult.meaning_en}
                      </p>
                    </div>
                  </div>
                )}

                {/* Collocations */}
                {vocabResult?.collocations && vocabResult.collocations.length > 0 && (
                  <div className="p-3 rounded-xl bg-surface-raised/60 border border-border space-y-1.5">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                      Collocations & Fórmulas habituales
                    </h4>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {vocabResult.collocations.map((col, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-surface border border-border/70 text-xs text-slate-200 font-mono"
                        >
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Real Context Examples */}
                {vocabResult?.examples && vocabResult.examples.length > 0 && (
                  <div className="p-3 rounded-xl bg-background/50 border border-border/80 space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                      Ejemplos de Uso
                    </h4>
                    <div className="space-y-2">
                      {vocabResult.examples.map((ex, idx) => (
                        <div key={idx} className="p-2 rounded bg-surface/70 border border-border/50 text-xs space-y-0.5">
                          <p className="font-semibold text-white font-sans">"{ex.en}"</p>
                          <p className="text-[11px] text-emerald-300/90 font-sans">{ex.translation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallback Dictionary Definition Card */}
                {dictEntry && !vocabResult && (
                  <div className="p-3.5 rounded-xl bg-background/50 border border-border/80 space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Definition (EN)</h4>
                    <p className="text-xs text-text-primary leading-relaxed font-sans">
                      {dictEntry.definition_en || 'No specific definition found.'}
                    </p>
                    {dictEntry.example_en && (
                      <div className="mt-2.5 pt-2 border-t border-border/40">
                        <p className="text-[11px] text-text-muted italic">
                          "{dictEntry.example_en}"
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-20 text-center px-4 text-text-muted space-y-3">
                <div className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center mx-auto text-text-secondary">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-secondary">Click any word or select text</p>
                  <p className="text-[11px] text-text-muted mt-1 max-w-[220px] mx-auto">
                    Select a word or phrase in the sentence to instantly inspect its British IPA, definitions, contextual translation, and audio.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* B2 Tutor & Connected Speech Tab */
          <div className="space-y-4">
            {isLoadingTutor ? (
              <div className="py-16 flex flex-col items-center justify-center text-text-muted space-y-3">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <p className="text-xs font-mono">Analyzing connected speech & B2 grammar...</p>
              </div>
            ) : tutorExplanation ? (
              <div className="space-y-4 animate-in fade-in duration-150">
                {/* Contextual Meaning */}
                <div className="p-3.5 rounded-xl bg-surface-raised border border-border space-y-1.5">
                  <div className="flex items-center gap-1.5 text-accent text-xs font-bold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Significado en Contexto</span>
                  </div>
                  <p className="text-xs text-text-primary leading-relaxed">
                    {tutorExplanation.contextual_meaning}
                  </p>
                </div>

                {/* Connected Speech Tips */}
                {tutorExplanation.connected_speech && tutorExplanation.connected_speech.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-background/60 border border-border space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                      British Connected Speech
                    </h4>
                    <div className="space-y-2">
                      {tutorExplanation.connected_speech.map((cs, idx) => (
                        <div key={idx} className="p-2 rounded bg-surface border border-border/50 text-xs">
                          <span className="font-mono font-semibold text-amber-300">"{cs.fragment}"</span>
                          <p className="text-[11px] text-text-secondary mt-0.5">{cs.tip}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Vocabulary & Phrasal Verbs */}
                {tutorExplanation.key_vocabulary && tutorExplanation.key_vocabulary.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-background/60 border border-border space-y-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                      Vocabulario & Phrasal Verbs
                    </h4>
                    <div className="space-y-2">
                      {tutorExplanation.key_vocabulary.map((vocab, idx) => (
                        <div key={idx} className="p-2 rounded bg-surface border border-border/50 text-xs space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">{vocab.term}</span>
                            <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded">
                              {vocab.type}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-secondary">{vocab.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-12 text-center px-4 text-text-muted space-y-3">
                {tutorError ? (
                  <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/30 text-left space-y-2 mb-3">
                    <div className="flex items-center gap-2 text-danger font-bold text-xs uppercase tracking-wider">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Error al obtener análisis</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{tutorError}</p>
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center mx-auto text-accent">
                    <Sparkles className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-text-secondary">Connected Speech & Gramática B2</p>
                  <p className="text-[11px] text-text-muted mt-1 max-w-[220px] mx-auto">
                    Termina de dictar la frase o pulsa el botón para obtener el desglose pedagógico.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRequestTutor}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{tutorError ? 'Reintentar explicación' : 'Explicar esta oración'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
