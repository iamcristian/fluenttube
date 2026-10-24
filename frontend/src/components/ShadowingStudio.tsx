import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Square,
  RotateCcw,
  Volume2,
  AlertCircle,
  Sparkles,
  Clock,
  Loader2,
  Play,
  Pause,
  CheckCircle2,
} from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import { SegmentDTO, ShadowingResultDTO } from '../api/types';
import { useRecorder } from '../hooks/useRecorder';
import { apiClient, ApiError } from '../api/client';
import { useJob } from '../hooks/useJob';
import { useStudyStore } from '../stores/useStudyStore';

export interface ShadowingStudioProps {
  segment: SegmentDTO | null;
  onListenOriginal?: () => void;
  onBeforeRecord?: () => void;
}

/**
 * Format seconds into mm:ss.t display
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

export const ShadowingStudio: React.FC<ShadowingStudioProps> = ({
  segment,
  onListenOriginal,
  onBeforeRecord,
}) => {
  const isUnlocked = Boolean(segment?.completed || segment?.revealed);
  const segmentId = segment?.id ?? null;

  const {
    shadowingResults,
    shadowingJobs,
    setShadowingResult,
    setShadowingJob,
    updateSegment,
  } = useStudyStore();

  const currentEval = segmentId != null ? shadowingResults[segmentId] || null : null;
  const activeJobId = segmentId != null ? shadowingJobs[segmentId] || null : null;

  const {
    state,
    isRecording,
    audioBlob,
    audioUrl,
    durationSeconds,
    errorMessage,
    startRecording,
    stopRecording,
    resetRecording: baseResetRecording,
  } = useRecorder({
    maxDurationSeconds: 30,
    onBeforeStart: onBeforeRecord,
  });

  // WaveSurfer state & refs
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlayingWave, setIsPlayingWave] = useState(false);

  // In-flight evaluation tracking
  const [isSubmittingEval, setIsSubmittingEval] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Poll background job tied to active segment
  const { isPolling: isEvaluating } = useJob(activeJobId, {
    enabled: Boolean(activeJobId),
    pollInterval: 1000,
    onSucceeded: (result) => {
      setIsSubmittingEval(false);
      if (segmentId != null) {
        const evalResult = result as unknown as ShadowingResultDTO;
        setShadowingResult(segmentId, evalResult);
        setShadowingJob(segmentId, null);
        if (evalResult.overall_score != null && segment) {
          updateSegment(segmentId, {
            best_overall_score: Math.max(
              segment.best_overall_score ?? 0,
              evalResult.overall_score
            ),
          });
        }
      }
    },
    onFailed: (err) => {
      setIsSubmittingEval(false);
      if (segmentId != null) {
        setShadowingJob(segmentId, null);
      }
      setEvalError(err?.message || 'Speech evaluation job failed.');
    },
  });

  // Load previous shadowing attempt if available and not yet cached in store
  useEffect(() => {
    if (!segmentId || !isUnlocked || shadowingResults[segmentId]) return;
    let isMounted = true;
    apiClient
      .getShadowingAttempts(segmentId, 1)
      .then((resp) => {
        if (isMounted && resp.items.length > 0 && !shadowingResults[segmentId]) {
          const latest = resp.items[0];
          setShadowingResult(segmentId, {
            attempt_id: latest.id,
            job_id: latest.job_id,
            segment_id: latest.segment_id,
            status: latest.status,
            recognized_text: latest.recognized_text,
            word_match_score: latest.word_match_score,
            timing_similarity_score: latest.timing_similarity_score,
            overall_score: latest.overall_score,
            alignment: latest.alignment || [],
            warning_codes: latest.warning_codes || [],
          });
        }
      })
      .catch(() => {
        // Silently ignore background load error
      });
    return () => {
      isMounted = false;
    };
  }, [segmentId, isUnlocked, shadowingResults, setShadowingResult]);

  // Reset recording state without discarding stored evaluation history (Section 8.2)
  const resetRecording = useCallback(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch {
        // ignore
      }
      wavesurferRef.current = null;
    }
    setIsPlayingWave(false);
    setIsSubmittingEval(false);
    setEvalError(null);
    baseResetRecording();
  }, [baseResetRecording]);

  // Mount WaveSurfer on audioUrl
  useEffect(() => {
    if (state !== 'recorded' || !audioUrl || !waveformContainerRef.current) {
      return;
    }

    let ws: WaveSurfer | null = null;
    try {
      ws = WaveSurfer.create({
        container: waveformContainerRef.current,
        waveColor: '#475569',
        progressColor: '#38bdf8',
        cursorColor: '#f8fafc',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 48,
        url: audioUrl,
      });

      ws.on('play', () => setIsPlayingWave(true));
      ws.on('pause', () => setIsPlayingWave(false));
      ws.on('finish', () => setIsPlayingWave(false));

      wavesurferRef.current = ws;
    } catch (err) {
      console.warn('WaveSurfer creation failed (expected in headless/JSDOM):', err);
    }

    return () => {
      if (ws) {
        try {
          ws.destroy();
        } catch {
          // ignore
        }
      }
      wavesurferRef.current = null;
      setIsPlayingWave(false);
    };
  }, [state, audioUrl]);

  // Handle WaveSurfer Play/Pause toggle
  const toggleWavePlayback = useCallback(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.playPause();
      } catch (err) {
        console.warn('Error during WaveSurfer playPause:', err);
      }
    }
  }, []);

  // Handle Submit Speech for Evaluation
  const handleEvaluate = useCallback(async () => {
    if (!segment || !audioBlob || isSubmittingEval || isEvaluating) return;

    setEvalError(null);
    setIsSubmittingEval(true);

    try {
      const res = await apiClient.evaluateShadowing(segment.id, audioBlob);
      setShadowingJob(segment.id, res.job_id);
    } catch (err: unknown) {
      setIsSubmittingEval(false);
      if (err instanceof ApiError) {
        setEvalError(err.message);
      } else {
        const error = err as Error;
        setEvalError(error.message || 'Failed to submit audio for evaluation.');
      }
    }
  }, [segment, audioBlob, isSubmittingEval, isEvaluating, setShadowingJob]);

  const progressPct = Math.min(100, (durationSeconds / 30) * 100);

  return (
    <div
      aria-label="Shadowing Studio"
      className="bg-surface rounded-panel border border-border p-5 shadow-lg space-y-4"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-border/70 pb-3">
        <div className="flex items-center space-x-2">
          <Mic className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
            Shadowing Studio
          </h3>
        </div>
        <span
          className={`text-[11px] font-mono font-semibold ${
            isUnlocked ? 'text-emerald-400' : 'text-slate-500'
          }`}
        >
          {isUnlocked ? 'Unlocked' : 'Locked'}
        </span>
      </div>

      {/* Locked State (Section 8.2) */}
      {!isUnlocked ? (
        <div
          role="region"
          aria-label="Shadowing studio locked"
          className="p-6 rounded-control bg-background/50 border border-border/60 text-center space-y-3"
        >
          <p className="text-xs text-text-secondary leading-relaxed">
            Complete or reveal the sentence to practice speaking.
          </p>
          <button
            type="button"
            disabled
            title="Complete or reveal sentence first"
            aria-label="Record Speech"
            className="px-4 py-2 rounded-control bg-surface-raised border border-border text-xs text-text-secondary/40 font-semibold cursor-not-allowed inline-flex items-center space-x-2"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Record Speech</span>
          </button>
        </div>
      ) : (
        /* Unlocked State (Section 8.2) */
        <div className="space-y-4">
          {/* Target Sentence Quote */}
          <div className="p-3.5 rounded-control bg-surface-raised border border-border/80">
            <span className="text-[11px] font-mono text-accent uppercase font-bold block mb-1">
              Target Sentence
            </span>
            <p className="text-sm font-medium text-white leading-relaxed">
              "{segment?.text}"
            </p>
          </div>

          {/* Recorder Error Message */}
          {errorMessage && (
            <div
              role="alert"
              className="text-xs text-danger bg-danger/10 border border-danger/30 p-3 rounded-control flex items-start justify-between space-x-2"
            >
              <div className="flex items-start space-x-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <span className="leading-snug">{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={resetRecording}
                className="text-[11px] font-semibold underline hover:text-white shrink-0 ml-2"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Idle / Permission Requesting State */}
          {state === 'idle' || state === 'requesting_permission' ? (
            <div className="flex items-center space-x-3 flex-wrap gap-y-2">
              {/* Listen to Original Button */}
              {onListenOriginal && (
                <button
                  type="button"
                  onClick={onListenOriginal}
                  title="Listen to original speaker from sentence start (Alt+R)"
                  aria-label="Listen to original sentence"
                  className="px-4 py-2 rounded-control bg-surface-raised hover:bg-surface border border-border text-text-secondary hover:text-white text-xs font-semibold transition flex items-center space-x-1.5 shadow-sm"
                >
                  <Volume2 className="w-3.5 h-3.5 text-accent" />
                  <span>Listen</span>
                </button>
              )}

              {/* Start Recording Button */}
              <button
                type="button"
                onClick={startRecording}
                disabled={state === 'requesting_permission'}
                title="Start recording your voice (max 30s)"
                aria-label="Start recording"
                className="px-4 py-2 rounded-control bg-accent text-background font-bold text-xs hover:bg-accent-hover transition shadow-md shadow-accent/20 flex items-center space-x-1.5"
              >
                {state === 'requesting_permission' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Requesting Mic...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>Start Recording</span>
                  </>
                )}
              </button>
            </div>
          ) : null}

          {/* Recording in Progress State */}
          {isRecording || state === 'stopping' ? (
            <div
              role="region"
              aria-label="Recording in progress"
              className="p-4 rounded-control bg-danger/10 border border-danger/40 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-danger" />
                  </span>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    {state === 'stopping' ? 'Stopping recording...' : 'Recording Audio'}
                  </span>
                </div>

                <div className="flex items-center space-x-1 text-xs font-mono font-bold text-danger">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {formatDuration(durationSeconds)} / 00:30.0
                  </span>
                </div>
              </div>

              {/* 30s Duration Progress Bar */}
              <div className="w-full h-1.5 bg-background rounded-full overflow-hidden border border-border/50">
                <div
                  className="h-full bg-danger rounded-full transition-all duration-100"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Stop Recording Button */}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={stopRecording}
                  disabled={state === 'stopping'}
                  title="Stop recording and review audio"
                  aria-label="Stop recording"
                  className="px-4 py-2 rounded-control bg-danger hover:bg-danger/90 text-white font-bold text-xs transition shadow-lg shadow-danger/25 flex items-center space-x-1.5"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Recording</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* Recorded Audio Playback, WaveSurfer & Evaluate State */}
          {state === 'recorded' && audioUrl ? (
            <div
              role="region"
              aria-label="Recorded audio playback"
              className="p-4 rounded-control bg-surface-raised border border-border/90 space-y-3.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white">Your Shadowing Repetition</span>
                <span className="font-mono text-text-secondary text-[11px]">
                  Duration: {durationSeconds.toFixed(1)}s / 30.0s
                </span>
              </div>

              {/* Interactive WaveSurfer Waveform Container (Section 8.2 & T15) */}
              <div
                data-testid="waveform-card"
                className="p-2.5 rounded bg-background/80 border border-border/70 space-y-2"
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
                    Waveform
                  </span>
                  <button
                    type="button"
                    onClick={toggleWavePlayback}
                    aria-label={isPlayingWave ? 'Pause waveform' : 'Play waveform'}
                    className="p-1 rounded bg-surface hover:bg-surface-raised text-accent border border-border/60 transition"
                  >
                    {isPlayingWave ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                  </button>
                </div>
                {/* WaveSurfer Container */}
                <div
                  ref={waveformContainerRef}
                  data-testid="waveform-container"
                  className="w-full min-h-[48px] overflow-hidden"
                />
              </div>

              {/* Native Accessible Audio Player fallback */}
              <audio
                src={audioUrl}
                controls
                className="w-full h-8 rounded focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Playback your recorded speech"
              />

              {/* Evaluation Error Banner */}
              {evalError && (
                <div
                  role="alert"
                  className="text-xs text-danger bg-danger/10 border border-danger/30 p-2.5 rounded-control flex items-start justify-between space-x-2"
                >
                  <div className="flex items-start space-x-1.5 min-w-0">
                    <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                    <span className="leading-snug">{evalError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEvalError(null)}
                    className="text-[11px] font-semibold underline hover:text-white shrink-0 ml-2"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Action Buttons: Listen original, Record again, Evaluate */}
              <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                <div className="flex items-center space-x-2">
                  {onListenOriginal && (
                    <button
                      type="button"
                      onClick={onListenOriginal}
                      title="Listen to original video sentence"
                      aria-label="Listen to original"
                      className="px-3.5 py-1.5 rounded-control bg-surface hover:bg-surface-raised border border-border text-text-secondary hover:text-white text-xs font-semibold transition flex items-center space-x-1.5"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-accent" />
                      <span>Original</span>
                    </button>
                  )}

                  {/* Record Again Button */}
                  <button
                    type="button"
                    onClick={resetRecording}
                    title="Discard current capture and record again"
                    aria-label="Record again"
                    className="px-3.5 py-1.5 rounded-control bg-surface hover:bg-surface-raised border border-border text-text-secondary hover:text-white text-xs font-semibold transition flex items-center space-x-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Record again</span>
                  </button>
                </div>

                {/* Evaluate Speech Button */}
                <button
                  type="button"
                  onClick={handleEvaluate}
                  disabled={isSubmittingEval || isEvaluating || Boolean(currentEval)}
                  title={
                    currentEval
                      ? 'Audio successfully evaluated'
                      : isEvaluating
                      ? 'Evaluation in progress...'
                      : 'Upload and validate audio for speech recognition'
                  }
                  aria-label="Evaluate speech"
                  className={`px-4 py-1.5 rounded-control font-semibold text-xs transition flex items-center space-x-1.5 shadow-md ${
                    isSubmittingEval || isEvaluating
                      ? 'bg-accent/40 text-background cursor-wait'
                      : currentEval
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 cursor-default'
                      : 'bg-accent text-background hover:bg-accent-hover shadow-accent/20 cursor-pointer'
                  }`}
                >
                  {isSubmittingEval || isEvaluating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Evaluating speech...</span>
                    </>
                  ) : currentEval ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Evaluated</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Evaluate speech</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* Evaluation Success / Capability Banner (T15 compatibility when mock message present) */}
          {currentEval && (currentEval as any).message && !currentEval.status && (
            <div
              role="status"
              className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-control flex items-start space-x-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-white">Audio Validated & Queued</p>
                <p className="text-[11px] text-text-secondary leading-normal">
                  {(currentEval as any).message}
                </p>
              </div>
            </div>
          )}

          {/* T19 Full Evaluation Feedback & Score Breakdown Section */}
          {currentEval && currentEval.status && (
            <div
              role="region"
              aria-label="Speech evaluation feedback"
              className="p-4 rounded-control bg-background/60 border border-border/80 space-y-4"
            >
              {/* Unscorable State */}
              {currentEval.status === 'unscorable' ? (
                <div
                  role="alert"
                  className="p-3.5 rounded-control bg-amber-500/10 border border-amber-500/30 space-y-1.5"
                >
                  <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Speech Unscorable</span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    No clear speech was recognized in your recording. Please speak clearly into your microphone and try again.
                  </p>
                </div>
              ) : (
                <>
                  {/* Score Metrics Grid (Section 8.2 & 10.4) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Practice Score */}
                    <div className="p-3 rounded-control bg-surface border border-border/80 text-center space-y-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider block font-semibold">
                        Practice score
                      </span>
                      <div className="text-2xl font-black font-mono text-accent">
                        {currentEval.overall_score != null ? `${currentEval.overall_score}%` : '—'}
                      </div>
                      <p className="text-[10px] text-text-secondary leading-tight">
                        Weighted: 70% word match + 30% duration
                      </p>
                    </div>

                    {/* Word Match */}
                    <div className="p-3 rounded-control bg-surface border border-border/80 text-center space-y-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider block font-semibold">
                        Word match
                      </span>
                      <div className="text-2xl font-black font-mono text-emerald-400">
                        {currentEval.word_match_score != null ? `${currentEval.word_match_score}%` : '—'}
                      </div>
                      <p className="text-[10px] text-text-secondary leading-tight">
                        Aligned words against target sentence
                      </p>
                    </div>

                    {/* Timing Similarity */}
                    <div className="p-3 rounded-control bg-surface border border-border/80 text-center space-y-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider block font-semibold">
                        Timing similarity
                      </span>
                      <div className="text-2xl font-black font-mono text-sky-400">
                        {currentEval.timing_similarity_score != null
                          ? `${currentEval.timing_similarity_score}%`
                          : '—'}
                      </div>
                      <p className="text-[10px] text-text-secondary leading-tight">
                        Compares speech duration to reference
                      </p>
                    </div>
                  </div>

                  {/* Warning Badges (if any) */}
                  {currentEval.warning_codes && currentEval.warning_codes.length > 0 && (
                    <div className="space-y-1">
                      {currentEval.warning_codes.map((code) => {
                        if (code === 'TIMING_UNAVAILABLE') {
                          return (
                            <p key={code} className="text-[11px] text-amber-400/90 flex items-center space-x-1.5">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Duration timing was unavailable for this attempt.</span>
                            </p>
                          );
                        }
                        if (code === 'COARSE_REFERENCE_TIMING') {
                          return (
                            <p key={code} className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              <span>Reference duration estimated from caption window (coarse timing).</span>
                            </p>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}

                  {/* Word Status Badges (Section 10.4) */}
                  <div className="space-y-2 pt-1">
                    <span className="text-[11px] font-mono text-text-secondary uppercase tracking-wider block font-semibold">
                      Word Assessment
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {currentEval.alignment &&
                        currentEval.alignment.map((token, idx) => {
                          let badgeClass = 'bg-slate-700/50 text-slate-400 border-slate-600/50';
                          let label = 'Missing';
                          if (token.status === 'matched') {
                            badgeClass = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
                            label = 'Recognized';
                          } else if (token.status === 'uncertain') {
                            badgeClass = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
                            label = 'Uncertain';
                          } else if (token.status === 'substituted') {
                            badgeClass = 'bg-rose-500/15 text-rose-400 border-rose-500/30';
                            label = 'Different';
                          } else if (token.status === 'omitted') {
                            badgeClass = 'bg-slate-700/40 text-slate-400 border-slate-600/40';
                            label = 'Missing';
                          }

                          return (
                            <span
                              key={`${token.display_index}-${idx}`}
                              className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-semibold border ${badgeClass}`}
                              title={`${token.text}: ${label}${token.asr_confidence != null ? ` (${Math.round(token.asr_confidence * 100)}% conf)` : ''}`}
                            >
                              <span>{token.text}</span>
                              <span className="text-[9px] uppercase font-mono opacity-70">({label})</span>
                            </span>
                          );
                        })}
                    </div>

                    {/* Word Status Legend (Section 8.2) */}
                    <div className="flex items-center space-x-3 text-[10px] text-text-secondary font-mono pt-1 flex-wrap gap-y-1">
                      <span className="font-semibold text-slate-400">Legend:</span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                        <span>Recognized</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                        <span>Uncertain</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                        <span>Different</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
                        <span>Missing</span>
                      </span>
                    </div>
                  </div>

                  {/* Extra Word Insertions */}
                  {currentEval.insertions && currentEval.insertions.length > 0 && (
                    <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-xs space-y-1">
                      <span className="text-[11px] font-mono text-amber-400 font-bold block">
                        Extra Words Detected:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {currentEval.insertions.map((ins, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-mono"
                          >
                            +{ins.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Surface Recognized Speech Transcript */}
                  {currentEval.recognized_text && (
                    <div className="p-2.5 rounded bg-surface border border-border/60 text-xs space-y-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider block font-semibold">
                        Recognized Speech
                      </span>
                      <p className="text-xs text-text-primary italic">
                        "{currentEval.recognized_text}"
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Visible Disclaimer (Section 8.2) */}
      <p className="text-[11px] text-slate-500 leading-normal border-t border-border/50 pt-3">
        Practice feedback estimated from speech recognition; it is not a phonetic pronunciation assessment.
      </p>
    </div>
  );
};
