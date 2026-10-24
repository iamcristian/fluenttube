import React, { useState, useEffect, useRef } from 'react';
import { Volume2, BookOpen, Sparkles, Loader2, CheckCircle2, Bookmark, ExternalLink } from 'lucide-react';
import { apiClient } from '../api/client';
import { DictionaryEntryDTO, TutorExplanationDTO, SegmentDTO } from '../api/types';
import { useStudyStore } from '../stores/useStudyStore';

interface BritishInspectorProps {
  selectedWord: string | null;
  onClearSelectedWord: () => void;
  segment: SegmentDTO | null;
  tutorExplanation: TutorExplanationDTO | null;
  isLoadingTutor: boolean;
  onRequestTutor: () => void;
}

export const BritishInspector: React.FC<BritishInspectorProps> = ({
  selectedWord,
  onClearSelectedWord,
  segment,
  tutorExplanation,
  isLoadingTutor,
  onRequestTutor,
}) => {
  const [activeTab, setActiveTab] = useState<'word' | 'grammar'>('word');
  const [dictEntry, setDictEntry] = useState<DictionaryEntryDTO | null>(null);
  const [isLoadingDict, setIsLoadingDict] = useState<boolean>(false);
  const [dictError, setDictError] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Switch to 'word' tab when a word is clicked
  useEffect(() => {
    if (selectedWord) {
      setActiveTab('word');
      setIsLoadingDict(true);
      setDictError(null);

      // Clean punctuation
      const cleanWord = selectedWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '').trim().toLowerCase();

      apiClient
        .getDictionaryEntry(cleanWord)
        .then((entry) => {
          setDictEntry(entry);
        })
        .catch((err) => {
          setDictError('Could not load definition. Offline or unavailable.');
          console.error(err);
        })
        .finally(() => {
          setIsLoadingDict(false);
        });
    }
  }, [selectedWord]);

  // Switch to 'grammar' tab if tutor explanation arrives and no word is actively focused
  useEffect(() => {
    if (tutorExplanation && !selectedWord) {
      setActiveTab('grammar');
    }
  }, [tutorExplanation, selectedWord]);

  const handlePlayAudio = (word: string) => {
    if (!word) return;
    setIsPlayingAudio(true);
    const audioUrl = apiClient.getBritishAudioUrl(word);

    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch((err) => console.error('Audio play error:', err));
    audio.onended = () => setIsPlayingAudio(false);
    audio.onerror = () => setIsPlayingAudio(false);
  };

  return (
    <div className="h-full flex flex-col bg-surface border-l border-border select-none">
      {/* Header Tabs */}
      <div className="flex items-center border-b border-border bg-surface-raised/40 px-3 py-2 text-xs font-semibold">
        <button
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
            {isLoadingDict ? (
              <div className="py-16 flex flex-col items-center justify-center text-text-muted space-y-3">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <p className="text-xs font-mono">Fetching UK phonetics & definition...</p>
              </div>
            ) : dictEntry ? (
              <div className="space-y-4 animate-in fade-in duration-150">
                {/* Word Banner */}
                <div className="p-3.5 rounded-xl bg-surface-raised border border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-wide">{dictEntry.word}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          UK {dictEntry.phonetic_uk || `/${dictEntry.word}/`}
                        </span>
                        {dictEntry.part_of_speech && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">
                            {dictEntry.part_of_speech}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handlePlayAudio(dictEntry.word)}
                      title="Listen with British Neural Voice (en-GB-Ryan)"
                      className={`p-2.5 rounded-full transition-all ${
                        isPlayingAudio
                          ? 'bg-accent text-white scale-110 shadow-lg shadow-accent/40'
                          : 'bg-surface hover:bg-accent/20 text-accent hover:text-white border border-accent/30'
                      }`}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Definition Card */}
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

                {/* Footer notes */}
                <div className="text-[10px] text-text-muted flex items-center justify-between px-1">
                  <span>Pronunciation: British RP</span>
                  <span>Audio: Microsoft Neural</span>
                </div>
              </div>
            ) : (
              <div className="py-20 text-center px-4 text-text-muted space-y-3">
                <div className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center mx-auto text-text-secondary">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-secondary">Click any word above</p>
                  <p className="text-[11px] text-text-muted mt-1 max-w-[220px] mx-auto">
                    Select a word in the sentence to instantly inspect its British IPA, definitions, and studio-grade UK pronunciation.
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
              <div className="py-16 text-center px-4 text-text-muted space-y-3">
                <div className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center mx-auto text-accent">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-secondary">Connected Speech & Gramática B2</p>
                  <p className="text-[11px] text-text-muted mt-1 max-w-[220px] mx-auto">
                    Termina de dictar la frase o pulsa el botón para obtener el desglose pedagógico.
                  </p>
                </div>
                <button
                  onClick={onRequestTutor}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Explicar esta oración</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
