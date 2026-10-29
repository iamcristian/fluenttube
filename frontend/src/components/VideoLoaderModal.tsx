import React, { useState, useEffect, useRef } from 'react';
import { X, Youtube, Loader2, AlertCircle, CheckCircle2, ArrowRight, ExternalLink, RotateCcw, Upload, FileVideo } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
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
  metadata: 'Finding your video...',
  captions: 'Downloading English subtitles...',
  downloading_audio: 'Downloading video audio...',
  loading_model: 'Preparing speech recognition...',
  transcribing: 'Turning the audio into practice sentences...',
  segmenting: 'Segmenting practice sentences...',
  saving: 'Saving your practice...',
  done: 'Completed!',
};

function importFailure(code: string, message: string) {
  // Older saved jobs can contain the raw downloader message rather than a specific code.
  const normalized = message.toLowerCase();
  if (code === 'JOB_INTERRUPTED') {
    return { title: 'Processing was interrupted', message: 'The local app restarted before processing finished. Your previous practice progress is still saved.' };
  }
  if (code === 'YOUTUBE_COOLDOWN') {
    return { title: 'Imports are taking a short break', message };
  }
  if (code === 'RATE_LIMITED' || normalized.includes('429') || normalized.includes('too many requests')) {
    return { title: 'YouTube needs a little time', message: 'YouTube is temporarily limiting imports from this connection. Wait a while before trying again. Repeated retries can prolong the block.' };
  }
  if (code === 'YOUTUBE_AUTH_REQUIRED' || normalized.includes('not a bot') || normalized.includes('sign in to confirm')) {
    return { title: 'YouTube is asking for verification', message: 'Your link is valid. YouTube is blocking the automatic import until a verification is completed. You can check the video on YouTube, wait and try again later, or choose another video.' };
  }
  return { title: 'Import Failed', message: code === 'SUBTITLES_NOT_FOUND' ? 'No English subtitles were available, and automatic transcription could not finish. Try a different video.' : message || 'The video could not be imported. Please try again later.' };
}

export const VideoLoaderModal: React.FC<VideoLoaderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialJobId = null,
}) => {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [source, setSource] = useState<'youtube' | 'local'>('youtube');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [forceGpuWhisper, setForceGpuWhisper] = useState(false);
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
      else localStorage.removeItem('fluenttube_pending_job_id');
    },
  });

  const handleClose = () => {
    setUrl('');
    setForceGpuWhisper(false);
    setSubmitError(null);
    setIsSubmitting(false);
    setSelectedFile(null);
    onClose();
  };
  useEffect(() => {
    if (job?.kind === 'local_ingest') setSource('local');
  }, [job?.kind]);
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

  const startImport = async (videoUrl: string) => {
    if (isSubmitting) return; // Guard against double-click

    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl) {
      setSubmitError('Please enter a YouTube video URL.');
      return;
    }
    try {
      const parsed = new URL(trimmedUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || !/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/.test(parsed.hostname)) {
        setSubmitError('Use a YouTube video link, such as youtube.com/watch?v=… or youtu.be/…');
        return;
      }
    } catch {
      setSubmitError('Enter a complete YouTube link, starting with https://');
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
        if (isModalOpenRef.current) {
          onSuccess(response.video_id);
          handleClose();
        }
        return;
      }

      // 2. Background job queued (202 Accepted)
      if (response.job_id) {
        localStorage.setItem('fluenttube_pending_job_id', response.job_id);
        setActiveJobId(response.job_id);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'INGEST_IN_PROGRESS' && typeof err.details.existing_job_id === 'string') {
          setActiveJobId(err.details.existing_job_id);
          localStorage.setItem('fluenttube_pending_job_id', err.details.existing_job_id);
          return;
        }
        if (err.code === 'SUBTITLES_NOT_FOUND') {
          setSubmitError('English subtitles not found and local transcription was unavailable.');
        } else if (err.code === 'VIDEO_TOO_LONG') {
          setSubmitError(err.message || 'This video exceeds the 60-minute limit.');
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
    if (source === 'local') void startLocalImport();
    else void startImport(url);
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
  const publicId = job?.error?.details?.youtube_id ?? job?.error?.message.match(/\[youtube\]\s+([A-Za-z0-9_-]{11})(?=:|\s)/)?.[1];
  const sourceUrl = typeof publicId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(publicId)
    ? `https://www.youtube.com/watch?v=${publicId}` : null;
  const retryUrl = url.trim() || sourceUrl;
  const isYouTubeBlocked = ['YOUTUBE_AUTH_REQUIRED', 'YOUTUBE_BLOCKED', 'RATE_LIMITED', 'YOUTUBE_COOLDOWN'].includes(job?.error?.code ?? '') || /not a bot|sign in to confirm|too many requests|429/i.test(job?.error?.message ?? '');

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
      <div ref={dialogRef} className="relative w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl p-6 text-slate-100 max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-red-600/20 text-red-400">
              {source === 'local' ? <FileVideo className="w-5 h-5" /> : <Youtube className="w-5 h-5" />}
            </div>
            <h2 id="modal-title" className="text-lg font-semibold text-white">
              {failed ? 'Let’s get you back to practicing' : activeJobId ? 'Processing Video' : source === 'local' ? 'Import a video file' : 'Import YouTube Video'}
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
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div role="group" aria-label="Import source" className="grid grid-cols-2 gap-2"><button type="button" disabled={isSubmitting} aria-pressed={source === 'youtube'} className={source === 'youtube' ? 'primary-button' : 'secondary-button'} onClick={() => { setSource('youtube'); setSubmitError(null); }}><Youtube size={16} />YouTube link</button><button type="button" disabled={isSubmitting} aria-pressed={source === 'local'} className={source === 'local' ? 'primary-button' : 'secondary-button'} onClick={() => { setSource('local'); setSubmitError(null); }}><Upload size={16} />Video file</button></div>
              <p className="text-sm text-text-secondary leading-relaxed">{source === 'local' ? 'Use a video already on your computer. It is copied to this local app and transcribed on your computer, with no requests to YouTube.' : 'Choose a video you actually want to watch. We’ll turn it into short listening and speaking exercises.'}</p>
              {source === 'local' && <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 p-5 space-y-3"><label htmlFor="local-video-file" className="block font-semibold text-sm">Choose a video file</label><input id="local-video-file" type="file" accept=".mp4,.webm,video/mp4,video/webm" disabled={isSubmitting} onChange={event => { setSelectedFile(event.target.files?.[0] ?? null); setSubmitError(null); }} className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-raised file:px-3 file:py-2 file:text-white" /><p className="text-xs text-text-secondary">MP4 (H.264) or WebM · Up to 250 MB and 60 minutes · English speech</p>{selectedFile && <p className="text-sm text-accent break-words">{selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>}<p className="text-xs text-text-secondary">Speech recognition uses a local model. The first run may need to download the model; your video is not sent to an AI provider.</p></div>}
              {source === 'youtube' && <div>
                <label htmlFor="youtube-url" className="block text-xs font-medium text-slate-300 mb-1.5">
                  YouTube Video URL
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    id="youtube-url"
                    type="url"
                    inputMode="url"
                    aria-invalid={Boolean(submitError)}
                    aria-describedby="import-url-help"
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
                <p id="import-url-help" className="mt-1.5 text-xs text-slate-400">
                  Paste any YouTube URL up to 60 minutes with English subtitles (manual or automatic).
                </p>
                <details className="pt-3 text-xs text-text-secondary">
                  <summary className="cursor-pointer py-2">Advanced import options</summary>
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
                </details>
              </div>}

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
                      <span>{source === 'local' ? 'Copying your video…' : 'Validating...'}</span>
                    </>
                  ) : (
                    <>
                      <span>{source === 'local' ? 'Import file' : 'Import Video'}</span>
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
                <span className="text-xs font-medium text-slate-400">Import status</span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                    job?.status === 'succeeded'
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                      : job?.status === 'failed'
                      ? 'bg-red-950/60 text-red-400 border border-red-800/50'
                      : 'bg-blue-950/60 text-blue-400 border border-blue-800/50 animate-pulse'
                  }`}
                >
                  {failed ? 'Needs attention' : job?.status === 'running' ? 'Preparing' : job?.status === 'succeeded' ? 'Ready' : 'Waiting'}
                </span>
              </div>

              {/* Progress bar */}
              {!failed && <div className="space-y-2">
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
                    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="secondary-button"><ExternalLink size={15} />Open on YouTube</a>}
                    {retryUrl && !isYouTubeBlocked && <button disabled={isSubmitting} onClick={() => { void startImport(retryUrl); }} className="secondary-button"><RotateCcw size={15} />{isSubmitting ? 'Retrying…' : 'Retry this video'}</button>}
                  </div>
                  {isYouTubeBlocked && <p className="text-xs leading-relaxed">No automatic retries. After a YouTube block, new imports pause for 15 minutes to avoid repeated requests. You can keep practicing videos already in your library.</p>}
                  {isYouTubeBlocked && <button className="primary-button w-full" onClick={() => { handleReset(); setSource('local'); }}><Upload size={16} />Use a video file instead</button>}
                  {(job.error?.code === 'YOUTUBE_AUTH_REQUIRED' || failure.title.includes('verification')) && <details className="text-xs leading-relaxed"><summary className="cursor-pointer py-2">Why doesn’t signing in fix it automatically?</summary><p>The app imports videos separately from your browser. It never reads your browser session automatically. Optional local session setup is explained in Settings.</p><a href="#/settings" onClick={handleClose} className="inline-block text-accent py-2 underline">Open Settings</a></details>}
                  {submitError && <p className="text-danger">{submitError}</p>}
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
                  {canResumeLocal ? 'Your file is saved on this computer. Completed parts will not be transcribed again.' : failed ? 'You can return to your library and practice another video.' : 'You can close this window; the process will continue in the background.'}
                </p>
                {job?.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={isYouTubeBlocked ? handleClose : handleReset}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition"
                  >
                    {isYouTubeBlocked ? 'Back to library' : 'Try Another Video'}
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
