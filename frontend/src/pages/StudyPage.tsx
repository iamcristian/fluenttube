import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
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
    setIsRecording,
    setShowRecordingWarning,
    toggleSidebar,
    setActiveStep,
  } = useStudyStore();

  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [tutorExplanation, setTutorExplanation] = useState<TutorExplanationDTO | null>(null);
  const [isLoadingTutor, setIsLoadingTutor] = useState<boolean>(false);

  const playerRef = useRef<VideoPlayerRef>(null);
  const tutorTriggerRef = useRef<HTMLButtonElement>(null);

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

  const activeSegment = video?.segments.find((s) => s.id === activeSegmentId) ?? null;
  const isSegmentUnlocked = activeSegment ? Boolean(activeSegment.completed || activeSegment.revealed) : false;
  const totalSegments = video?.segments.length ?? 0;
  const isLastSegment = activePosition >= totalSegments - 1;
  const isFirstSegment = activePosition <= 0;

  // Reset selected word when switching segments
  useEffect(() => {
    setSelectedWord(null);
  }, [activeSegmentId]);

  // Request tutor explanation for current segment
  const handleRequestTutor = useCallback(async () => {
    if (!activeSegment) return;
    setIsLoadingTutor(true);
    try {
      const res = await apiClient.explainSegment(activeSegment.id, 'es');
      setTutorExplanation(res);
    } catch (err) {
      console.error('Failed to get tutor explanation:', err);
    } finally {
      setIsLoadingTutor(false);
    }
  }, [activeSegment]);

  // Handle switching segment
  const handleSelectSegment = (segmentId: number) => {
    const res = selectSegment(segmentId);
    if (res.success && video) {
      apiClient.updateVideoProgress(video.id, segmentId).catch((err) => {
        console.warn('Failed to update progress on server:', err);
      });
    }
  };

  const handleNextSegment = () => {
    if (isLastSegment || !video) return;
    const nextSeg = video.segments[activePosition + 1];
    if (nextSeg) {
      handleSelectSegment(nextSeg.id);
    }
  };

  const handlePrevSegment = () => {
    if (isFirstSegment || !video) return;
    const prevSeg = video.segments[activePosition - 1];
    if (prevSeg) {
      handleSelectSegment(prevSeg.id);
    }
  };

  // Keyboard shortcuts map
  useKeyboardShortcuts({
    onReplay: () => playerRef.current?.replay(),
    onPrevSegment: handlePrevSegment,
    onNextSegment: handleNextSegment,
    isRecording,
    onClose: () => {
      if (showRecordingWarning) setShowRecordingWarning(false);
    },
  });

  const completionPct =
    video && video.segment_count > 0
      ? Math.round((video.completed_count / video.segment_count) * 100)
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
                onClick={() => setShowRecordingWarning(false)}
                className="px-4 py-2 rounded-control text-xs font-semibold text-text-secondary hover:text-white bg-surface-raised hover:bg-surface-raised/80 border border-border transition"
              >
                Keep Recording
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRecording(false);
                  setShowRecordingWarning(false);
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
              onClick={onBackToLibrary}
              aria-label="Back to Library"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-control text-xs font-semibold text-text-secondary hover:text-white bg-surface-raised border border-border/80 hover:border-border transition shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Library</span>
            </button>

            <div className="h-4 w-px bg-border shrink-0" />

            <h1
              className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg cursor-default"
              title={video ? video.title : 'Loading video...'}
            >
              {video ? video.title : 'Loading video...'}
            </h1>
          </div>

          {/* Right: Progress bar */}
          {video && (
            <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
              <div className="hidden sm:flex flex-col items-end space-y-1">
                <div className="flex items-center space-x-2 text-[11px] font-mono text-text-secondary">
                  <span>
                    {video.completed_count}/{video.segment_count} completed
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
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6">
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

        {video && (
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* COLUMN 1: LEFT (Video Player & Anti-Spoiler Transcript) */}
            <section
              aria-label="Video Player and Segment Navigation"
              className="lg:col-span-5 xl:col-span-4 flex flex-col space-y-4"
            >
              {/* YouTube Video Player */}
              <VideoPlayer
                ref={playerRef}
                videoId={video.youtube_id}
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
                    className="lg:hidden flex items-center space-x-1 px-2.5 py-1 rounded-control bg-surface-raised border border-border text-xs text-text-secondary hover:text-white transition"
                  >
                    <span>{isSidebarOpen ? 'Hide' : 'Show'}</span>
                    {isSidebarOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <div className={`${isSidebarOpen ? 'block' : 'hidden lg:block'}`}>
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
              className="lg:col-span-7 xl:col-span-5 flex flex-col space-y-4"
            >
              {/* Stepper & Navigation Card */}
              <div className="bg-surface rounded-panel border border-border p-4 shadow-lg space-y-3">
                <div className="flex items-center justify-between border-b border-border/80 pb-3 flex-wrap gap-3">
                  <div className="flex items-center space-x-2">
                    {(['listen', 'dictate', 'shadow'] as StudyStep[]).map((step) => {
                      const isActiveStep = activeStep === step;
                      return (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setActiveStep(step)}
                          className={`px-3 py-1.5 rounded-control text-xs font-semibold uppercase tracking-wider transition ${
                            isActiveStep
                              ? 'bg-accent text-background font-bold shadow-md shadow-accent/20'
                              : 'bg-surface-raised text-text-secondary hover:text-white border border-border'
                          }`}
                        >
                          {step}
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
                        onClick={handleNextSegment}
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
                      Segment #{activePosition + 1} (ID: {activeSegment?.id ?? '—'})
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
                      handleRequestTutor();
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

              {/* Dictation Box (Reactive word-by-word with double-tab) */}
              {activeSegment ? (
                <DictationBox
                  segment={activeSegment}
                  onNext={handleNextSegment}
                  isLastSegment={isLastSegment}
                  onSelectWord={(word) => setSelectedWord(word)}
                  onToggleShadowing={() => setActiveStep(activeStep === 'shadow' ? 'dictate' : 'shadow')}
                  isShadowingRecording={isRecording}
                />
              ) : (
                <div className="bg-surface rounded-panel border border-border p-8 text-center text-text-secondary">
                  Select a sentence to begin dictation.
                </div>
              )}

              {/* Shadowing Studio Docked Panel */}
              <ShadowingStudio
                segment={activeSegment}
                onListenOriginal={() => playerRef.current?.replay()}
                onBeforeRecord={() => playerRef.current?.pause()}
              />
            </section>

            {/* COLUMN 3: RIGHT (Fixed British Study Inspector) */}
            <section
              aria-label="British Study Inspector"
              className="lg:col-span-12 xl:col-span-3 bg-surface rounded-panel border border-border shadow-lg overflow-hidden flex flex-col min-h-[500px]"
            >
              <BritishInspector
                selectedWord={selectedWord}
                onClearSelectedWord={() => setSelectedWord(null)}
                segment={activeSegment}
                tutorExplanation={tutorExplanation}
                isLoadingTutor={isLoadingTutor}
                onRequestTutor={handleRequestTutor}
              />
            </section>
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
