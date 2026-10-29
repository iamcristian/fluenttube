import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Sparkles,
  Headphones,
  PenLine,
  Mic,
  Play,
  BookOpen,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useStudyStore, StudyStep } from '../stores/useStudyStore';
import { SegmentList } from '../components/SegmentList';
import { VideoPlayer, VideoPlayerRef } from '../components/VideoPlayer';
import { DictationBox } from '../components/DictationBox';
import { ShadowingStudio } from '../components/ShadowingStudio';
import { GrammarTutorDrawer } from '../components/GrammarTutorDrawer';
import { BritishInspector } from '../components/BritishInspector';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { PlayerAdapter } from '../player/types';
import { TutorExplanationDTO } from '../api/types';
import { useSettingsStore } from '../stores/useSettingsStore';

export interface StudyPageProps {
  videoId: number;
  onBackToLibrary: () => void;
  customPlayerAdapter?: PlayerAdapter;
}

export const StudyPage: React.FC<StudyPageProps> = ({
  videoId,
  onBackToLibrary,
  customPlayerAdapter,
}) => {
  const queryClient = useQueryClient();
  const {
    video,
    activeSegmentId,
    activePosition,
    showRecordingWarning,
    isSidebarOpen,
    activeStep,
    isRecording,
    isTutorOpen,
    setIsTutorOpen,
    setVideo,
    selectSegment,
    setShowRecordingWarning,
    requestDiscardRecording,
    toggleSidebar,
    setActiveStep,
  } = useStudyStore();

  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [tutorExplanation, setTutorExplanation] = useState<TutorExplanationDTO | null>(null);
  const [isLoadingTutor, setIsLoadingTutor] = useState<boolean>(false);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const explanationLanguage = useSettingsStore(s => s.explanationLanguage);

  const playerRef = useRef<VideoPlayerRef>(null);
  const tutorTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingAutoPlayRef = useRef<boolean>(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isInspectorOpen) inspectorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [isInspectorOpen, selectedWord]);

  const { data: fetchedVideo, isLoading, isError, error } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => apiClient.getVideo(videoId),
  });

  // Synchronize store when video data loads
  useEffect(() => {
    if (fetchedVideo) {
      setVideo(fetchedVideo);
    }
  }, [fetchedVideo, setVideo]);

  const currentVideo = video?.id === videoId ? video : null;
  const activeSegment = currentVideo?.segments.find((s) => s.id === activeSegmentId) ?? null;
  const isRetrying = useStudyStore(s => s.retryingSegmentId) === activeSegmentId;
  const isSegmentUnlocked = activeSegment ? Boolean((activeSegment.completed || activeSegment.revealed) && !isRetrying) : false;
  const totalSegments = currentVideo?.segments.length ?? 0;
  const isLastSegment = activePosition >= totalSegments - 1;
  const isFirstSegment = activePosition <= 0;
  const activeTutorSegmentRef = useRef<number | null>(null);

  // Reset selected word and explanation when switching segments (F-12)
  useEffect(() => {
    setSelectedWord(null);
    setTutorExplanation(null);
    setTutorError(null);
    setIsLoadingTutor(false);
    activeTutorSegmentRef.current = activeSegmentId;
  }, [activeSegmentId]);

  // Request tutor explanation for current segment with generation guard (F-12)
  const handleRequestTutor = useCallback(async () => {
    if (!activeSegment) return;
    const reqSegmentId = activeSegment.id;
    activeTutorSegmentRef.current = reqSegmentId;
    setIsLoadingTutor(true);
    setTutorError(null);
    try {
      const res = await apiClient.explainSegment(reqSegmentId, explanationLanguage);
      if (activeTutorSegmentRef.current === reqSegmentId) {
        setTutorExplanation(res);
      }
    } catch (err: any) {
      if (activeTutorSegmentRef.current === reqSegmentId) {
        console.error('Failed to get tutor explanation:', err);
        const code = err?.code || '';
        if (code === 'TUTOR_PROVIDER_UNAVAILABLE' || err?.statusCode === 503) {
          setTutorError(err?.message || "Tutor service is unavailable. Check provider config.");
        } else if (code === 'SEGMENT_LOCKED') {
          setTutorError("Sentence must be completed or revealed before requesting tutor analysis.");
        } else {
          setTutorError(err?.message || "Failed to generate tutor explanation.");
        }
      }
    } finally {
      if (activeTutorSegmentRef.current === reqSegmentId) {
        setIsLoadingTutor(false);
      }
    }
  }, [activeSegment, explanationLanguage]);

  const changeStep = (step: StudyStep) => {
    if (isRecording && step !== activeStep) {
      pendingNavigationRef.current = () => { playerRef.current?.pause(); setActiveStep(step); };
      setShowRecordingWarning(true);
      return;
    }
    playerRef.current?.pause();
    setActiveStep(step);
  };

  // Handle switching segment
  const handleSelectSegment = (segmentId: number) => {
    if (isRecording) {
      pendingNavigationRef.current = () => {
        const result = selectSegment(segmentId);
        if (result.success && currentVideo) apiClient.updateVideoProgress(currentVideo.id, segmentId).catch(() => {});
      };
    }
    const res = selectSegment(segmentId);
    if (res.success && video) {
      apiClient.updateVideoProgress(video.id, segmentId).catch((err) => {
        console.warn('Failed to update progress on server:', err);
      });
    }
  };

  const handleNextSegment = (autoPlay = false) => {
    if (isLastSegment || !video) return;
    const nextSeg = video.segments[activePosition + 1];
    if (nextSeg) {
      if (autoPlay && typeof document !== 'undefined' && !document.hidden && !isRecording) {
        pendingAutoPlayRef.current = true;
      }
      handleSelectSegment(nextSeg.id);
    }
  };

  // Continuous dictation: automatically play next sentence once segment bounds commit (F-02)
  useEffect(() => {
    if (pendingAutoPlayRef.current && activeSegment && !isRecording) {
      pendingAutoPlayRef.current = false;
      if (typeof document !== 'undefined' && document.hidden) return;
      const t = window.setTimeout(() => {
        playerRef.current?.play();
      }, 70);
      return () => window.clearTimeout(t);
    }
  }, [activeSegmentId, activeSegment, isRecording]);

  const handlePrevSegment = () => {
    if (isFirstSegment || !video) return;
    const prevSeg = video.segments[activePosition - 1];
    if (prevSeg) {
      handleSelectSegment(prevSeg.id);
    }
  };

  const handleBackToLibrary = () => {
    const returnToLibrary = () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      onBackToLibrary();
    };
    if (isRecording) {
      pendingNavigationRef.current = returnToLibrary;
      setShowRecordingWarning(true);
      return;
    }
    returnToLibrary();
  };

  // Keyboard shortcuts map
  useKeyboardShortcuts({
    enabled: !isTutorOpen,
    onReplay: () => playerRef.current?.replay(),
    onPrevSegment: handlePrevSegment,
    onNextSegment: () => handleNextSegment(false),
    isRecording,
    onClose: () => {
      if (showRecordingWarning) setShowRecordingWarning(false);
    },
  });

  const completionPct =
    currentVideo && currentVideo.segment_count > 0
      ? Math.round((currentVideo.completed_count / currentVideo.segment_count) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-background text-text-primary flex flex-col overflow-x-hidden">
      {/* Recording Warning Modal */}
      {showRecordingWarning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recording-warning-title"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-surface border border-danger/60 rounded-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-danger">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 id="recording-warning-title" className="text-base font-bold text-white">
                Audio Recording in Progress
              </h3>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              Navigating to another sentence right now will discard your active audio capture.
              Please stop the recording before switching segments.
            </p>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => { pendingNavigationRef.current = null; setShowRecordingWarning(false); }}
                className="px-4 py-2 rounded-control text-xs font-semibold text-text-secondary hover:text-white bg-surface-raised hover:bg-surface-raised/80 border border-border transition"
              >
                Keep Recording
              </button>
              <button
                type="button"
                onClick={() => {
                  requestDiscardRecording();
                  setShowRecordingWarning(false);
                  pendingNavigationRef.current?.();
                  pendingNavigationRef.current = null;
                }}
                className="px-4 py-2 rounded-control text-xs font-semibold text-white bg-danger hover:bg-danger/90 transition shadow-lg shadow-danger/25"
              >
                Stop Recording & Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-30 w-full">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Left: Navigation and Truncated Title */}
          <div className="flex items-center space-x-3 min-w-0">
            <button
              type="button"
              onClick={handleBackToLibrary}
              aria-label="Back to Library"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-control text-xs font-semibold text-text-secondary hover:text-white bg-surface-raised border border-border/80 hover:border-border transition shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Library</span>
            </button>

            <div className="h-4 w-px bg-border shrink-0" />

            <h1
              className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg cursor-default"
              title={currentVideo ? currentVideo.title : 'Loading video...'}
            >
              {currentVideo ? currentVideo.title : 'Loading video...'}
            </h1>
          </div>

          {/* Right: Progress bar */}
          {currentVideo && (
            <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
              <div className="hidden sm:flex flex-col items-end space-y-1">
                <div className="flex items-center space-x-2 text-[11px] font-mono text-text-secondary">
                  <span>
                    {currentVideo.completed_count}/{currentVideo.segment_count} completed
                  </span>
                  <span className="font-semibold text-accent">{completionPct}%</span>
                </div>
                <div className="w-24 sm:w-32 h-1.5 bg-background rounded-full overflow-hidden border border-border/50">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace Body: Unified 3-Column Layout */}
      <main id="main-content" className="flex-1 max-w-[1320px] w-full mx-auto p-4 sm:p-6">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 space-y-3">
            <div className="w-8 h-8 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
            <p className="text-xs text-text-secondary font-mono">Loading workspace...</p>
          </div>
        )}

        {isError && (
          <div className="p-6 rounded-panel bg-danger/10 border border-danger/40 text-center max-w-md mx-auto my-12 space-y-3">
            <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
            <h3 className="text-sm font-semibold text-white">Error loading video</h3>
            <p className="text-xs text-danger">
              {error instanceof Error ? error.message : 'Video could not be loaded.'}
            </p>
            <button
              type="button"
              onClick={onBackToLibrary}
              className="px-4 py-2 bg-surface-raised text-xs font-semibold text-text-primary rounded-control hover:bg-surface border border-border transition"
            >
              Return to Library
            </button>
          </div>
        )}

        {currentVideo && video && !isError && (
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* COLUMN 1: LEFT (Video Player & Anti-Spoiler Transcript) */}
            <section
              aria-label="Video Player and Segment Navigation"
              className="lg:col-span-5 flex flex-col space-y-4 min-w-0"
            >
              {/* YouTube Video Player */}
              <VideoPlayer
                ref={playerRef}
                videoId={video.youtube_id}
                mediaUrl={video.source_type === 'local' ? apiClient.getVideoMediaUrl(video.id) : undefined}
                title={video.title}
                startSeconds={activeSegment?.start_seconds ?? 0}
                endSeconds={activeSegment?.end_seconds ?? undefined}
                nextStartSeconds={video.segments[activePosition + 1]?.start_seconds ?? undefined}
                customAdapter={customPlayerAdapter}
              />

              {/* Segment List Panel: Anti-Spoiler Transcript with Masked Dots */}
              <div className="bg-surface rounded-panel border border-border p-4 shadow-lg flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-accent" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                      Practice Sentences ({video.segments.length})
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={toggleSidebar}
                    aria-expanded={isSidebarOpen}
                    aria-label={isSidebarOpen ? 'Collapse sentence list' : 'Expand sentence list'}
                    className="flex items-center space-x-1 px-2.5 py-2 rounded-control bg-surface-raised border border-border text-xs text-text-secondary hover:text-white transition"
                  >
                    <span>{isSidebarOpen ? 'Hide' : 'Show'}</span>
                    {isSidebarOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <div className={isSidebarOpen ? 'block' : 'hidden'}>
                  <SegmentList
                    segments={video.segments}
                    activeSegmentId={activeSegmentId}
                    onSelectSegment={handleSelectSegment}
                  />
                </div>
              </div>
            </section>

            {/* COLUMN 2: CENTER (Active Dictation & Unified Shadowing Studio) */}
            <section
              aria-label="Dictation and Shadowing Workspace"
              className="lg:col-span-7 flex flex-col space-y-4 min-w-0"
            >
              {/* Stepper & Navigation Card */}
              <div className="bg-surface rounded-panel border border-border p-4 shadow-lg space-y-3">
                <div className="flex items-center justify-between border-b border-border/80 pb-3 flex-wrap gap-3">
                  <div role="tablist" aria-label="Practice activity" className="flex items-center gap-1 w-full bg-background p-1 rounded-2xl">
                    {(['listen', 'dictate', 'shadow'] as StudyStep[]).map((step, index) => {
                      const isActiveStep = activeStep === step;
                      const Icon = step === 'listen' ? Headphones : step === 'dictate' ? PenLine : Mic;
                      return (
                        <button
                          key={step}
                          type="button"
                          role="tab"
                          id={`step-${step}`}
                          aria-controls="practice-panel"
                          aria-selected={isActiveStep}
                          onClick={() => changeStep(step)}
                          onKeyDown={event => {
                            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                            event.preventDefault();
                            const steps: StudyStep[] = ['listen', 'dictate', 'shadow'];
                            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
                            changeStep(steps[next]);
                            if (!isRecording) document.getElementById(`step-${steps[next]}`)?.focus();
                          }}
                          tabIndex={isActiveStep ? 0 : -1}
                          className="study-step"
                        >
                          <Icon size={16} /><span>{index + 1}. {step === 'listen' ? 'Listen' : step === 'dictate' ? 'Write' : 'Speak'}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Sentence Indicator */}
                  <div className="flex items-center space-x-2 text-xs text-text-secondary">
                    <span className="font-mono text-white font-semibold">
                      Sentence {activePosition + 1} of {totalSegments}
                    </span>
                    <div className="flex items-center space-x-1 pl-1">
                      <button
                        type="button"
                        onClick={handlePrevSegment}
                        disabled={isFirstSegment}
                        title={isFirstSegment ? 'Already on first sentence' : 'Previous sentence (Alt+Left)'}
                        aria-label="Previous sentence"
                        className="p-1 rounded bg-surface-raised border border-border text-text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNextSegment(false)}
                        disabled={isLastSegment}
                        title={isLastSegment ? 'Already on last sentence' : 'Next sentence (Alt+Right)'}
                        aria-label="Next sentence"
                        className="p-1 rounded bg-surface-raised border border-border text-text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Sentence Info / Status */}
                <div className="flex items-center justify-between text-xs text-text-secondary bg-surface-raised/70 p-3 rounded-control border border-border/60 flex-wrap gap-2">
                  <div className="flex items-center space-x-3">
                    <span className="font-mono text-slate-400">
                      {activeSegment ? `${Math.max(1, Math.round(activeSegment.end_seconds - activeSegment.start_seconds))} seconds of practice` : 'Choose a sentence'}
                    </span>
                    <span className="flex items-center space-x-1.5">
                      {activeSegment?.completed ? (
                        <span className="text-emerald-400 font-semibold flex items-center space-x-1">
                          <Check className="w-3.5 h-3.5" />
                          <span>Completed</span>
                        </span>
                      ) : activeSegment?.revealed ? (
                        <span className="text-amber-400 font-semibold flex items-center space-x-1">
                          <Eye className="w-3.5 h-3.5" />
                          <span>Revealed</span>
                        </span>
                      ) : (
                        <span className="text-text-secondary flex items-center space-x-1">
                          <span>Dictation in progress</span>
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Explain sentence button */}
                  <button
                    ref={tutorTriggerRef}
                    type="button"
                    disabled={!isSegmentUnlocked}
                    onClick={() => {
                      setIsTutorOpen(true);
                    }}
                    aria-label="Explain sentence with AI tutor"
                    title={
                      isSegmentUnlocked
                        ? 'Explain sentence grammar and vocabulary with AI tutor'
                        : 'Complete or reveal sentence to unlock tutor explanation'
                    }
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-xs font-semibold transition ${
                      isSegmentUnlocked
                        ? 'bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25 active:scale-95 shadow-xs'
                        : 'bg-surface text-text-secondary border border-border/70 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Explain sentence</span>
                  </button>
                </div>
              </div>

              <div id="practice-panel" role="tabpanel" aria-labelledby={`step-${activeStep}`} className="space-y-4">
              {activeStep === 'listen' && activeSegment && <div className="bg-surface border border-border rounded-panel p-6 sm:p-8 space-y-5">
                <span className="guide-icon"><Headphones size={22} /></span>
                <div><p className="eyebrow mb-3">STEP 01 · GET THE SOUND</p><h2 className="text-2xl font-semibold tracking-tight">First, just listen.</h2><p className="text-sm text-text-secondary leading-relaxed mt-3">Play this short sentence a few times. Focus on the sounds and rhythm. You don’t need to catch every word yet.</p></div>
                <button className="secondary-button" onClick={() => playerRef.current?.replay()}><Play size={17} />Listen to this sentence</button>
                <p className="text-xs text-text-secondary">Too fast? Slow the video down with the speed controls below it.</p>
                <button className="primary-button w-full" onClick={() => changeStep('dictate')}>I’m ready to write<ChevronRight size={17} /></button>
              </div>}
              {/* Keep drafts and sessions intact while switching activities. */}
              <div hidden={activeStep !== 'dictate'}>
              {activeSegment ? (
                <DictationBox
                  isActive={activeStep === 'dictate' && !isTutorOpen && !showRecordingWarning}
                  segment={activeSegment}
                  onNext={handleNextSegment}
                  isLastSegment={isLastSegment}
                  onSelectWord={(word) => { setSelectedWord(word); setIsInspectorOpen(true); }}
                  onToggleShadowing={() => changeStep('shadow')}
                  isShadowingRecording={isRecording}
                />
              ) : (
                <div className="bg-surface rounded-panel border border-border p-8 text-center text-text-secondary">
                  Select a sentence to begin dictation.
                </div>
              )}
              </div>

              <div hidden={activeStep !== 'shadow'} className="space-y-4">
              <div className="p-5 bg-surface border border-border rounded-panel"><p className="eyebrow mb-3">STEP 03 · FIND YOUR VOICE</p><h2 className="text-xl font-semibold">Say it in your own voice.</h2><p className="text-sm text-text-secondary mt-2 leading-relaxed">Listen to the original, then record yourself saying the same sentence. Try to copy the rhythm. A little better each time is enough.</p>{!isSegmentUnlocked && <button className="secondary-button mt-4" onClick={() => changeStep('dictate')}>Write or reveal the sentence first<ChevronRight size={16} /></button>}</div>
              <ShadowingStudio
                segment={activeSegment}
                onListenOriginal={() => playerRef.current?.replay()}
                onBeforeRecord={() => playerRef.current?.pause()}
              />
              </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-text-secondary"><span>Take your time. Your progress is saved as you practice.</span><button className="quiet-button" aria-expanded={isInspectorOpen} onClick={() => setIsInspectorOpen(!isInspectorOpen)}><BookOpen size={16} />Vocabulary & study notes</button></div>
              {video.completed_count === video.segment_count && video.segment_count > 0 && <div role="status" className="bg-accent/10 border border-accent/30 rounded-panel p-5"><h2 className="font-semibold text-accent">You’ve practiced every sentence. Nicely done.</h2><p className="text-sm text-text-secondary mt-2">Review a sentence, try speaking it, or pick a new video.</p><button className="primary-button mt-4" onClick={handleBackToLibrary}>Back to your library<ChevronRight size={16} /></button></div>}
            </section>

            {/* COLUMN 3: RIGHT (Fixed British Study Inspector) */}
            {isInspectorOpen && <section
              ref={inspectorRef}
              aria-label="British Study Inspector"
              className="lg:col-span-12 bg-surface rounded-panel border border-border overflow-hidden flex flex-col scroll-mt-20"
            >
              <div className="flex items-center justify-between px-5 pt-4"><h2 className="font-semibold">Your study notes</h2><button className="quiet-button" aria-label="Close study notes" onClick={() => setIsInspectorOpen(false)}><X size={18} /></button></div>
              <BritishInspector
                selectedWord={selectedWord}
                onClearSelectedWord={() => setSelectedWord(null)}
                segment={activeSegment}
                tutorExplanation={tutorExplanation}
                isLoadingTutor={isLoadingTutor}
                tutorError={tutorError}
                onRequestTutor={handleRequestTutor}
              />
            </section>}
          </div>
        )}
      </main>

      {/* Grammar Tutor Slide-out Drawer */}
      <GrammarTutorDrawer
        isOpen={isTutorOpen}
        onClose={() => setIsTutorOpen(false)}
        segment={activeSegment}
        triggerRef={tutorTriggerRef}
      />
    </div>
  );
};
