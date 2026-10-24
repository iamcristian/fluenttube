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
    });

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
    expect(screen.getByText(/no tiene subtítulos en inglés/i)).toBeInTheDocument();

    // Click "Try Another Video"
    const retryBtn = screen.getByRole('button', { name: /try another video/i });
    fireEvent.click(retryBtn);

    // Returns to URL input form
    expect(screen.getByText('Import YouTube Video')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://www.youtube.com/watch?v=...')).toBeInTheDocument();
  });
});
