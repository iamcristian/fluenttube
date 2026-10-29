import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { VideoLoaderModal } from '../src/components/VideoLoaderModal';
import { apiClient } from '../src/api/client';
import { JobDTO } from '../src/api/types';

describe('VideoLoaderModal Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders modal with input field and validates empty submission', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    renderWithQueryClient(
      <VideoLoaderModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />
    );

    expect(screen.getByText('Import YouTube Video')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://www.youtube.com/watch?v=...')).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /import video/i });

    // Empty submission
    fireEvent.click(submitBtn);
    expect(await screen.findByText('Please enter a YouTube video URL.')).toBeInTheDocument();
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('handles cache hit (200 OK) by immediately triggering onSuccess and closing', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    vi.spyOn(apiClient, 'ingestVideo').mockResolvedValue({
      video_id: 77,
      status: 'completed',
      cached: true,
      job_id: null,
    });

    renderWithQueryClient(
      <VideoLoaderModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />
    );

    const input = screen.getByPlaceholderText('https://www.youtube.com/watch?v=...');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });

    const submitBtn = screen.getByRole('button', { name: /import video/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith(77);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('handles queued background job (202 Accepted) and polls until succeeded', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    vi.spyOn(apiClient, 'ingestVideo').mockResolvedValue({
      job_id: 'job-test-123',
      status: 'queued',
      cached: false,
      video_id: null,
    });

    // Mock job polling sequence: running (50%) -> succeeded (100%)
    const runningJob: JobDTO = {
      id: 'job-test-123',
      kind: 'ingest',
      status: 'running',
      stage: 'captions',
      progress: 0.5,
      result: null,
      error: null,
      created_at: new Date().toISOString(),
    };

    const succeededJob: JobDTO = {
      id: 'job-test-123',
      kind: 'ingest',
      status: 'succeeded',
      stage: 'done',
      progress: 1.0,
      result: { video_id: 88, segment_count: 5 },
      error: null,
      created_at: new Date().toISOString(),
    };

    const getJobSpy = vi.spyOn(apiClient, 'getJob')
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(succeededJob);

    renderWithQueryClient(
      <VideoLoaderModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />
    );

    const input = screen.getByPlaceholderText('https://www.youtube.com/watch?v=...');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });

    const submitBtn = screen.getByRole('button', { name: /import video/i });
    fireEvent.click(submitBtn);

    // Transitions to Processing view and displays stage
    expect(await screen.findByText('Processing Video')).toBeInTheDocument();
    expect(await screen.findByText('Downloading English subtitles...')).toBeInTheDocument();
    expect(await screen.findByText('50%')).toBeInTheDocument();

    // Succeeded triggers navigation and close
    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith(88);
      expect(handleClose).toHaveBeenCalled();
    }, { timeout: 3000 });

    expect(getJobSpy).toHaveBeenCalledWith('job-test-123');
  });

  it('does NOT trigger unwanted navigation if modal was closed before job succeeds', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    vi.spyOn(apiClient, 'ingestVideo').mockResolvedValue({
      job_id: 'job-bg-456',
      status: 'queued',
      cached: false,
      video_id: null,
    });

    const runningJob: JobDTO = {
      id: 'job-bg-456',
      kind: 'ingest',
      status: 'running',
      stage: 'segmenting',
      progress: 0.7,
      result: null,
      error: null,
      created_at: new Date().toISOString(),
    };

    const succeededJob: JobDTO = {
      id: 'job-bg-456',
      kind: 'ingest',
      status: 'succeeded',
      stage: 'done',
      progress: 1.0,
      result: { video_id: 99 },
      error: null,
      created_at: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'getJob')
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(succeededJob);

    const { rerender } = renderWithQueryClient(
      <VideoLoaderModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />
    );

    const input = screen.getByPlaceholderText('https://www.youtube.com/watch?v=...');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /import video/i }));

    expect(await screen.findByText('Processing Video')).toBeInTheDocument();

    // User closes modal while job is still running
    const closeBtn = screen.getByLabelText('Close modal');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();

    // Rerender with isOpen=false simulating closed modal
    rerender(
      <VideoLoaderModal isOpen={false} onClose={handleClose} onSuccess={handleSuccess} initialJobId="job-bg-456" />
    );

    // Wait and verify onSuccess was NOT called
    await waitFor(() => {
      expect(handleSuccess).not.toHaveBeenCalled();
    });
  });

  it('displays job failure error and allows user to retry with another video', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    vi.spyOn(apiClient, 'ingestVideo').mockResolvedValue({
      job_id: 'job-fail-789',
      status: 'queued',
      cached: false,
      video_id: null,
    });

    const failedJob: JobDTO = {
      id: 'job-fail-789',
      kind: 'ingest',
      status: 'failed',
      stage: 'captions',
      progress: 0.4,
      result: null,
      error: {
        code: 'SUBTITLES_NOT_FOUND',
        message: 'Este video no tiene subtítulos en inglés. V1 no transcribe automáticamente.',
        retryable: false,
      },
      created_at: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'getJob').mockResolvedValue(failedJob);

    renderWithQueryClient(
      <VideoLoaderModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />
    );

    const input = screen.getByPlaceholderText('https://www.youtube.com/watch?v=...');
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
    fireEvent.click(screen.getByRole('button', { name: /import video/i }));

    expect(await screen.findByText(/Import Failed/i)).toBeInTheDocument();
    expect(screen.getByText(/No English subtitles were available/i)).toBeInTheDocument();

    // Click "Try Another Video"
    const retryBtn = screen.getByRole('button', { name: /try another video/i });
    fireEvent.click(retryBtn);

    // Returns to URL input form
    expect(screen.getByText('Import YouTube Video')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://www.youtube.com/watch?v=...')).toBeInTheDocument();
  });

  it('rejects non-YouTube links before sending an import request', async () => {
    const ingest = vi.spyOn(apiClient, 'ingestVideo');
    renderWithQueryClient(<VideoLoaderModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('YouTube Video URL'), { target: { value: 'https://example.com/video' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Video' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use a YouTube video link');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('closes with Escape and restores page scrolling', () => {
    const close = vi.fn();
    const { unmount } = renderWithQueryClient(<VideoLoaderModal isOpen onClose={close} onSuccess={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('opens a fresh import form after a background job finishes', async () => {
    vi.spyOn(apiClient, 'getJob').mockResolvedValue({ id: 'finished-job', kind: 'ingest', status: 'succeeded', stage: 'done', progress: 1, result: { video_id: 88 }, error: null, created_at: '2026-10-28' });
    const success = vi.fn();
    const close = vi.fn();
    const { rerender } = renderWithQueryClient(<VideoLoaderModal isOpen initialJobId="finished-job" onClose={close} onSuccess={success} />);
    await waitFor(() => expect(success).toHaveBeenCalledWith(88));
    rerender(<VideoLoaderModal isOpen={false} onClose={close} onSuccess={success} />);
    rerender(<VideoLoaderModal isOpen onClose={close} onSuccess={success} />);
    expect(screen.getByRole('heading', { name: 'Import YouTube Video' })).toBeInTheDocument();
    expect(screen.getByLabelText('YouTube Video URL')).toHaveValue('');
  });

  it('explains a legacy bot-verification failure without exposing commands or encouraging retries', async () => {
    const ingest = vi.spyOn(apiClient, 'ingestVideo');
    vi.spyOn(apiClient, 'getJob').mockResolvedValue({ id: 'blocked-job', kind: 'ingest', status: 'failed', stage: 'metadata', progress: 0.1, result: null, error: { code: 'VIDEO_UNAVAILABLE', message: 'ERROR: [youtube] epbFY0DTPxs: Sign in to confirm you’re not a bot. Use --cookies-from-browser', details: {} }, created_at: '2026-10-28' });
    renderWithQueryClient(<VideoLoaderModal isOpen initialJobId="blocked-job" onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(await screen.findByText('YouTube is asking for verification')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=epbFY0DTPxs');
    expect(screen.queryByText(/--cookies-from-browser/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry this video' })).not.toBeInTheDocument();
    expect(screen.queryByText('10%')).not.toBeInTheDocument();
    expect(screen.getByText(/No automatic retries/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to library' })).toBeInTheDocument();
    expect(ingest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use a video file instead' }));
    expect(screen.getByRole('heading', { name: 'Import a video file' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a video file')).toBeInTheDocument();
  });

  it('imports a selected file through the local endpoint without attempting a YouTube import', async () => {
    const ingest = vi.spyOn(apiClient, 'ingestVideo');
    const upload = vi.spyOn(apiClient, 'uploadVideo').mockResolvedValue({ job_id: 'local-job', status: 'queued', cached: false });
    vi.spyOn(apiClient, 'getJob').mockResolvedValue({ id: 'local-job', kind: 'local_ingest', status: 'running', stage: 'transcribing', progress: 0.35, result: null, error: null, created_at: '2026-10-28' });
    renderWithQueryClient(<VideoLoaderModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Video file' }));
    const file = new File(['local content'], 'english.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Choose a video file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import file' }));
    expect(await screen.findByText('Processing Video')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(file);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('continues an interrupted local import without another upload', async () => {
    const upload = vi.spyOn(apiClient, 'uploadVideo');
    const failed: JobDTO = { id: 'interrupted-local', kind: 'local_ingest', status: 'failed', stage: 'transcribing', progress: 0.35, error: { code: 'JOB_INTERRUPTED', message: 'Job interrupted by server shutdown or restart.', details: { can_resume: true } }, created_at: '2026-10-28' };
    const running: JobDTO = { ...failed, status: 'running', stage: 'recovering', error: null };
    vi.spyOn(apiClient, 'getJob').mockResolvedValueOnce(failed).mockResolvedValue(running);
    const resume = vi.spyOn(apiClient, 'resumeLocalJob').mockResolvedValue(running);
    renderWithQueryClient(<VideoLoaderModal isOpen initialJobId={failed.id} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(await screen.findByText('Processing was interrupted')).toBeInTheDocument();
    expect(screen.queryByText(/server shutdown/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue processing' }));
    expect(await screen.findByText('Restoring your saved video...')).toBeInTheDocument();
    expect(resume).toHaveBeenCalledWith(failed.id);
    expect(upload).not.toHaveBeenCalled();
    expect(localStorage.getItem('fluenttube_pending_job_id')).toBe(failed.id);
  });
});
