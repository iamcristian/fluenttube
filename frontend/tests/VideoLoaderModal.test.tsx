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

    expect(screen.getByText('Import a video file')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a video file')).toBeInTheDocument();
    expect(document.querySelector('input[type="url"]')).toBeNull();
    const submitBtn = screen.getByRole('button', { name: /import file/i });

    // Empty submission
    fireEvent.click(submitBtn);
    expect(await screen.findByText('Choose an MP4 or WebM video first.')).toBeInTheDocument();
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('handles queued background job (202 Accepted) and polls until succeeded', async () => {
    const handleClose = vi.fn();
    const handleSuccess = vi.fn();

    vi.spyOn(apiClient, 'uploadVideo').mockResolvedValue({
      job_id: 'job-test-123',
      status: 'queued',
      cached: false,
      video_id: null,
    });

    // Mock job polling sequence: running (50%) -> succeeded (100%)
    const runningJob: JobDTO = {
      id: 'job-test-123',
      kind: 'local_ingest',
      status: 'running',
      stage: 'transcribing',
      progress: 0.5,
      result: null,
      error: null,
      created_at: new Date().toISOString(),
    };

    const succeededJob: JobDTO = {
      id: 'job-test-123',
      kind: 'local_ingest',
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

    const input = screen.getByLabelText('Choose a video file');
    fireEvent.change(input, { target: { files: [new File(['video'], 'practice.mp4', { type: 'video/mp4' })] } });

    const submitBtn = screen.getByRole('button', { name: /import file/i });
    fireEvent.click(submitBtn);

    // Transitions to Processing view and displays stage
    expect(await screen.findByText('Processing Video')).toBeInTheDocument();
    expect(await screen.findByText('Turning the audio into practice sentences...')).toBeInTheDocument();
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

    vi.spyOn(apiClient, 'uploadVideo').mockResolvedValue({
      job_id: 'job-bg-456',
      status: 'queued',
      cached: false,
      video_id: null,
    });

    const runningJob: JobDTO = {
      id: 'job-bg-456',
      kind: 'local_ingest',
      status: 'running',
      stage: 'segmenting',
      progress: 0.7,
      result: null,
      error: null,
      created_at: new Date().toISOString(),
    };

    const succeededJob: JobDTO = {
      id: 'job-bg-456',
      kind: 'local_ingest',
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

    const input = screen.getByLabelText('Choose a video file');
    fireEvent.change(input, { target: { files: [new File(['video'], 'practice.mp4', { type: 'video/mp4' })] } });
    fireEvent.click(screen.getByRole('button', { name: /import file/i }));

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

    vi.spyOn(apiClient, 'uploadVideo').mockResolvedValue({
      job_id: 'job-fail-789',
      status: 'queued',
      cached: false,
      video_id: null,
    });

    const failedJob: JobDTO = {
      id: 'job-fail-789',
      kind: 'local_ingest',
      status: 'failed',
      stage: 'transcribing',
      progress: 0.4,
      result: null,
      error: {
        code: 'TRANSCRIPTION_FAILED',
        message: 'Speech recognition could not finish.',
        retryable: false,
      },
      created_at: new Date().toISOString(),
    };

    vi.spyOn(apiClient, 'getJob').mockResolvedValue(failedJob);

    renderWithQueryClient(
      <VideoLoaderModal isOpen={true} onClose={handleClose} onSuccess={handleSuccess} />
    );

    const input = screen.getByLabelText('Choose a video file');
    fireEvent.change(input, { target: { files: [new File(['video'], 'practice.mp4', { type: 'video/mp4' })] } });
    fireEvent.click(screen.getByRole('button', { name: /import file/i }));

    expect(await screen.findByText(/Import Failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Speech recognition could not finish/i)).toBeInTheDocument();

    // Click "Try Another Video"
    const retryBtn = screen.getByRole('button', { name: /try another video/i });
    fireEvent.click(retryBtn);

    // Returns to URL input form
    expect(screen.getByText('Import a video file')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a video file')).toBeInTheDocument();
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
    vi.spyOn(apiClient, 'getJob').mockResolvedValue({ id: 'finished-job', kind: 'local_ingest', status: 'succeeded', stage: 'done', progress: 1, result: { video_id: 88 }, error: null, created_at: '2026-10-28' });
    const success = vi.fn();
    const close = vi.fn();
    const { rerender } = renderWithQueryClient(<VideoLoaderModal isOpen initialJobId="finished-job" onClose={close} onSuccess={success} />);
    await waitFor(() => expect(success).toHaveBeenCalledWith(88));
    rerender(<VideoLoaderModal isOpen={false} onClose={close} onSuccess={success} />);
    rerender(<VideoLoaderModal isOpen onClose={close} onSuccess={success} />);
    expect(screen.getByRole('heading', { name: 'Import a video file' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a video file')).toHaveValue('');
  });

  it('imports a selected file through the local endpoint', async () => {
    const upload = vi.spyOn(apiClient, 'uploadVideo').mockResolvedValue({ job_id: 'local-job', status: 'queued', cached: false });
    vi.spyOn(apiClient, 'getJob').mockResolvedValue({ id: 'local-job', kind: 'local_ingest', status: 'running', stage: 'transcribing', progress: 0.35, result: null, error: null, created_at: '2026-10-28' });
    renderWithQueryClient(<VideoLoaderModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
    const file = new File(['local content'], 'english.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText('Choose a video file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import file' }));
    expect(await screen.findByText('Processing Video')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(file);
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
