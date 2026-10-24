import React, { useState, useEffect, useRef } from 'react';
import { X, Youtube, Loader2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import { useJob } from '../hooks/useJob';
import { queryClient } from '../api/queryClient';

export interface VideoLoaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (videoId: number) => void;
  initialJobId?: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  metadata: 'Extracting video metadata...',
  captions: 'Downloading English subtitles...',
  downloading_audio: 'Downloading video audio...',
  loading_model: 'Loading speech model...',
  transcribing: 'Transcribing speech audio with local ASR...',
  segmenting: 'Segmenting practice sentences...',
  saving: 'Persisting to database...',
  done: 'Completed!',
};

export const VideoLoaderModal: React.FC<VideoLoaderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialJobId = null,
}) => {
  const [url, setUrl] = useState('');
  const [forceGpuWhisper, setForceGpuWhisper] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isModalOpenRef = useRef(isOpen);

  useEffect(() => {
    isModalOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (initialJobId) {
      setActiveJobId(initialJobId);
    }
  }, [initialJobId]);

  useEffect(() => {
    if (isOpen && !activeJobId) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, activeJobId]);

  // Hook for polling background job
  const { job } = useJob(activeJobId, {
    enabled: Boolean(activeJobId),
    onSucceeded: (result) => {
      localStorage.removeItem('fluenttube_pending_job_id');
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      const videoId = result?.video_id as number | undefined;
      // If modal was closed by user, do not force unwanted navigation
      if (isModalOpenRef.current && videoId) {
        onSuccess(videoId);
        handleClose();
      }
    },
    onFailed: () => {
      localStorage.removeItem('fluenttube_pending_job_id');
    },
  });

  const handleClose = () => {
    setUrl('');
    setForceGpuWhisper(false);
    setSubmitError(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return; // Guard against double-click

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setSubmitError('Please enter a YouTube video URL.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await apiClient.ingestVideo({
        url: trimmedUrl,
        force: false,
        force_gpu_whisper: forceGpuWhisper,
      });

      // 1. Cache hit (200 OK)
      if (response.cached && response.video_id) {
        queryClient.invalidateQueries({ queryKey: ['videos'] });
        onSuccess(response.video_id);
        handleClose();
        return;
      }

      // 2. Background job queued (202 Accepted)
      if (response.job_id) {
        localStorage.setItem('fluenttube_pending_job_id', response.job_id);
        setActiveJobId(response.job_id);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'SUBTITLES_NOT_FOUND') {
          setSubmitError('English subtitles not found and local transcription was unavailable.');
        } else if (err.code === 'VIDEO_TOO_LONG') {
          setSubmitError('This video exceeds the 30-minute limit (1800s).');
        } else if (err.code === 'LIVE_STREAM_UNSUPPORTED') {
          setSubmitError('Active YouTube live streams are not supported.');
        } else {
          setSubmitError(err.message || 'Failed to import video.');
        }
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('An unexpected error occurred while importing.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    localStorage.removeItem('fluenttube_pending_job_id');
    setActiveJobId(null);
    setSubmitError(null);
    setUrl('');
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-lg bg-[#151D2A] border border-[#243044] rounded-2xl shadow-2xl p-6 text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-red-600/20 text-red-400">
              <Youtube className="w-5 h-5" />
            </div>
            <h2 id="modal-title" className="text-lg font-semibold text-white">
              {activeJobId ? 'Processing Video' : 'Import YouTube Video'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="py-5">
          {!activeJobId ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="youtube-url" className="block text-xs font-medium text-slate-300 mb-1.5">
                  YouTube Video URL
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    id="youtube-url"
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (submitError) setSubmitError(null);
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={isSubmitting}
                    className="w-full px-4 py-2.5 bg-[#0B0F17] border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  Paste any YouTube URL under 30 minutes with English subtitles (manual or automatic).
                </p>
                <div className="pt-2">
                  <label className="flex items-center space-x-2.5 cursor-pointer text-xs text-slate-300 hover:text-white select-none">
                    <input
                      type="checkbox"
                      id="force-local-asr-checkbox"
                      checked={forceGpuWhisper}
                      onChange={(e) => setForceGpuWhisper(e.target.checked)}
                      disabled={isSubmitting}
                      className="w-4 h-4 rounded bg-[#0B0F17] border-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900 focus:ring-offset-1"
                    />
                    <span>Use local transcription for this new video</span>
                  </label>
                </div>
              </div>

              {submitError && (
                <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-red-950/40 border border-red-800/50 text-xs text-red-300">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">{submitError}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center space-x-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg shadow-blue-600/20 transition"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Validating...</span>
                    </>
                  ) : (
                    <>
                      <span>Import Video</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Progress view for active background job */
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Job Status</span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                    job?.status === 'succeeded'
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                      : job?.status === 'failed'
                      ? 'bg-red-950/60 text-red-400 border border-red-800/50'
                      : 'bg-blue-950/60 text-blue-400 border border-blue-800/50 animate-pulse'
                  }`}
                >
                  {job?.status || 'QUEUED'}
                </span>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>{job?.stage ? STAGE_LABELS[job.stage] || job.stage : 'Preparing task...'}</span>
                  <span className="font-mono text-slate-400">
                    {job?.progress !== null && job?.progress !== undefined
                      ? `${Math.round(job.progress * 100)}%`
                      : '...'}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        job?.progress !== null && job?.progress !== undefined
                          ? Math.max(5, Math.round(job.progress * 100))
                          : 15
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Job Error */}
              {job?.status === 'failed' && (
                <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/50 text-xs text-red-300 space-y-1">
                  <div className="flex items-center space-x-2 font-semibold text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span>Import Failed ({job.error?.code || 'ERROR'})</span>
                  </div>
                  <p className="pl-6">
                    {job.error?.code === 'SUBTITLES_NOT_FOUND'
                      ? 'Este video no tiene subtítulos en inglés. V1 no transcribe automáticamente.'
                      : job.error?.message || 'The ingestion process could not be completed.'}
                  </p>
                </div>
              )}

              {/* Success */}
              {job?.status === 'succeeded' && (
                <div className="flex items-center space-x-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Subtitles processed and segments saved! Loading study view...</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <p className="text-xs text-slate-500">
                  You can close this window; the process will continue in the background.
                </p>
                {job?.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition"
                  >
                    Try Another Video
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl transition"
                  >
                    Close Modal
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
