import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, AlertCircle, CheckCircle2, ArrowRight, RotateCcw, FileVideo } from 'lucide-react';
import { apiClient } from '../api/client';
import { useJob } from '../hooks/useJob';
import { useQueryClient } from '@tanstack/react-query';

export interface VideoLoaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (videoId: number) => void;
  initialJobId?: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  recovering: 'Restoring your saved video...',
  loading_model: 'Preparing speech recognition...',
  transcribing: 'Turning the audio into practice sentences...',
  segmenting: 'Segmenting practice sentences...',
  saving: 'Saving your practice...',
  done: 'Completed!',
};

function importFailure(code: string, message: string) {
  if (code === 'JOB_INTERRUPTED') {
    return { title: 'Processing was interrupted', message: 'The local app restarted before processing finished. Your previous practice progress is still saved.' };
  }

  return { title: 'Import Failed', message: message || 'The video could not be imported. Please try again.' };
}

export const VideoLoaderModal: React.FC<VideoLoaderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialJobId = null,
}) => {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<() => void>(() => {});
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
  const { job, error: jobError, refetch: retryJob } = useJob(activeJobId, {
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
      setActiveJobId(null);
    },
    onFailed: (_error, failedJob) => {
      if (failedJob.kind === 'local_ingest' && failedJob.error?.details?.can_resume !== false) localStorage.setItem('fluenttube_pending_job_id', failedJob.id);
      else {
        localStorage.removeItem('fluenttube_pending_job_id');
        if (failedJob.kind !== 'local_ingest') setActiveJobId(null);
      }
    },
  });

  const handleClose = () => {
    setSubmitError(null);
    setIsSubmitting(false);
    setSelectedFile(null);
    onClose();
  };
  closeRef.current = handleClose;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])');
      (inputRef.current ?? focusable)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], select:not([disabled])') ?? []).filter(el => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

  const handleReset = () => {
    localStorage.removeItem('fluenttube_pending_job_id');
    setActiveJobId(null);
    setSubmitError(null);
  };

  const startLocalImport = async () => {
    if (isSubmitting) return;
    if (!selectedFile) { setSubmitError('Choose an MP4 or WebM video first.'); return; }
    if (!/\.(mp4|webm)$/i.test(selectedFile.name)) { setSubmitError('Choose an MP4 or WebM video.'); return; }
    if (selectedFile.size > 250 * 1024 * 1024) { setSubmitError('Choose a video smaller than 250 MB.'); return; }
    if (!selectedFile.size) { setSubmitError('This file is empty. Choose another video.'); return; }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await apiClient.uploadVideo(selectedFile);
      if (response.job_id) {
        setActiveJobId(response.job_id);
        localStorage.setItem('fluenttube_pending_job_id', response.job_id);
        setSelectedFile(null);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The video file could not be imported. Try again.');
    } finally { setIsSubmitting(false); }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void startLocalImport();
  };
  const resumeLocalImport = async () => {
    if (!activeJobId || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const resumed = await apiClient.resumeLocalJob(activeJobId);
      queryClient.setQueryData(['job', resumed.id], resumed);
      localStorage.setItem('fluenttube_pending_job_id', resumed.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The saved import could not be continued.');
    } finally { setIsSubmitting(false); }
  };
  const failed = job?.status === 'failed';
  const canResumeLocal = failed && job?.kind === 'local_ingest' && job?.error?.details?.can_resume !== false;
  const failure = importFailure(job?.error?.code ?? '', job?.error?.message ?? '');

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
      <div ref={dialogRef} className="relative w-full max-w-lg bg-surface border border-border rounded-panel shadow-2xl p-6 text-text-primary max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-border-subtle">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-control bg-accent/10 text-accent">
              <FileVideo className="w-5 h-5" />
            </div>
            <h2 id="modal-title" className="text-lg font-semibold text-white">
              {failed ? 'Let’s get you back to practicing' : activeJobId ? 'Processing Video' : 'Import a video file'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            className="p-1.5 shrink-0 text-text-secondary hover:text-white rounded-control hover:bg-surface-raised transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="py-5">
          {!activeJobId ? (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 p-5 space-y-3"><label htmlFor="local-video-file" className="block font-semibold text-sm">Choose a video file</label><input ref={inputRef} id="local-video-file" type="file" accept=".mp4,.webm,video/mp4,video/webm" disabled={isSubmitting} onChange={event => { setSelectedFile(event.target.files?.[0] ?? null); setSubmitError(null); }} className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-raised file:px-3 file:py-2 file:text-white" /><p className="text-xs text-text-secondary">MP4 (H.264) or WebM · Up to 250 MB and 60 minutes · English speech</p>{selectedFile && <p className="text-sm text-accent break-words">{selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>}<p className="text-xs text-text-secondary">Speech recognition uses a local model. The first run may need to download the model; your video is not sent to an AI provider.</p></div>
              {submitError && (
                <div role="alert" className="flex items-start space-x-2.5 p-3 rounded-xl bg-red-950/40 border border-red-800/50 text-xs text-red-300">
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
                  className="secondary-button"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="primary-button"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Copying your video…</span>
                    </>
                  ) : (
                    <>
                      <span>Import file</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Progress view for active background job */
            <div className="space-y-5" aria-live="polite">
              {jobError && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm space-y-3"><p>We couldn’t check this import. Try reconnecting, or return to the import form.</p><div className="flex flex-wrap gap-2"><button className="secondary-button" onClick={() => retryJob()}>Retry connection</button><button className="quiet-button" onClick={handleReset}>Back to import</button></div></div>}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">Import status</span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                    job?.status === 'succeeded'
                      ? 'bg-success/10 text-success border border-success/30'
                      : job?.status === 'failed'
                      ? 'bg-danger/10 text-danger border border-danger/30'
                      : 'bg-accent/10 text-accent border border-accent/30 animate-pulse'
                  }`}
                >
                  {failed ? 'Needs attention' : job?.status === 'running' ? 'Preparing' : job?.status === 'succeeded' ? 'Ready' : 'Waiting'}
                </span>
              </div>

              {/* Progress bar */}
              {!failed && <div className="space-y-2">
                <div className="flex justify-between text-xs text-text-secondary">
                  <span>{job?.stage ? STAGE_LABELS[job.stage] || job.stage : 'Preparing task...'}</span>
                  <span className="font-mono text-text-secondary">
                    {job?.progress !== null && job?.progress !== undefined
                      ? `${Math.round(job.progress * 100)}%`
                      : '...'}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-surface-raised rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        job?.progress !== null && job?.progress !== undefined
                          ? Math.max(5, Math.round(job.progress * 100))
                          : 15
                      }%`,
                    }}
                  />
                </div>
              </div>}

              {/* Job Error */}
              {job?.status === 'failed' && (
                <div role="alert" className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-text-secondary space-y-3">
                  <div className="flex items-center space-x-2 font-semibold text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span>{failure.title}</span>
                  </div>
                  <p className="pl-6">
                    {failure.message}
                  </p>
                  <p className="pl-6 text-xs">Your library and previous progress are safe.</p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {canResumeLocal && <button className="primary-button" disabled={isSubmitting} onClick={() => { void resumeLocalImport(); }}><RotateCcw size={15} />{isSubmitting ? 'Continuing…' : 'Continue processing'}</button>}
                  </div>
                  {submitError && <p className="text-danger">{submitError}</p>}
                </div>
              )}

              {/* Success */}
              {job?.status === 'succeeded' && (
                <div className="flex items-center space-x-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Transcription and practice sentences saved! Loading study view...</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
                <p className="text-xs text-text-muted">
                  {canResumeLocal ? 'Your file is saved on this computer. Completed parts will not be transcribed again.' : failed ? 'You can return to your library and practice another video.' : 'You can close this window; the process will continue in the background.'}
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
