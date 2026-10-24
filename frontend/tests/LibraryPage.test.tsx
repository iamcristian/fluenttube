import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { LibraryPage } from '../src/pages/LibraryPage';
import { apiClient } from '../src/api/client';
import { VideoSummaryDTO } from '../src/api/types';

describe('LibraryPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders empty state guide when no videos exist in database', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({
      items: [],
      total: 0,
    });

    const handleSelectVideo = vi.fn();
    renderWithQueryClient(<LibraryPage onSelectVideo={handleSelectVideo} />);

    expect(await screen.findByText('Your study library is empty')).toBeInTheDocument();
    expect(screen.getByText(/Paste any YouTube link with English subtitles/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import your first video/i })).toBeInTheDocument();
  });

  it('renders video cards with metadata, duration, and completion progress', async () => {
    const mockVideos: VideoSummaryDTO[] = [
      {
        id: 1,
        youtube_id: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        channel: 'Rick Astley',
        duration_seconds: 212.0,
        transcription_source: 'captions_manual',
        segment_count: 20,
        completed_count: 5,
        last_segment_id: 3,
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        youtube_id: 'jNQXAC9IVRw',
        title: 'Me at the zoo',
        channel: 'jawed',
        duration_seconds: 19.0,
        transcription_source: 'captions_auto',
        segment_count: 3,
        completed_count: 0,
        last_segment_id: null,
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({
      items: mockVideos,
      total: 2,
    });

    const handleSelectVideo = vi.fn();
    renderWithQueryClient(<LibraryPage onSelectVideo={handleSelectVideo} />);

    expect(await screen.findByText('Never Gonna Give You Up')).toBeInTheDocument();
    expect(screen.getByText('Rick Astley')).toBeInTheDocument();
    expect(screen.getByText('03:32')).toBeInTheDocument(); // 212s = 03:32
    expect(screen.getByText('5 / 20 sentences')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();

    expect(screen.getByText('Me at the zoo')).toBeInTheDocument();
    expect(screen.getByText('jawed')).toBeInTheDocument();
    expect(screen.getByText('00:19')).toBeInTheDocument();

    // Clicking "Continue Practice" on video 1 triggers onSelectVideo(1)
    const continueBtn = screen.getByRole('button', { name: /continue practice/i });
    fireEvent.click(continueBtn);
    expect(handleSelectVideo).toHaveBeenCalledWith(1);
  });

  it('opens import modal when clicking top Import Video button', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({
      items: [],
      total: 0,
    });

    const handleSelectVideo = vi.fn();
    renderWithQueryClient(<LibraryPage onSelectVideo={handleSelectVideo} />);

    await waitFor(() => {
      expect(screen.getByText('Your study library is empty')).toBeInTheDocument();
    });

    const topImportBtn = screen.getByRole('button', { name: /^import video$/i });
    fireEvent.click(topImportBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Import YouTube Video')).toBeInTheDocument();
  });

  it('recovers pending job from localStorage on mount and opens modal with progress', async () => {
    localStorage.setItem('fluenttube_pending_job_id', 'job-recover-123');

    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({
      items: [],
      total: 0,
    });

    vi.spyOn(apiClient, 'getJob').mockResolvedValue({
      id: 'job-recover-123',
      kind: 'ingest',
      status: 'running',
      stage: 'segmenting',
      progress: 0.7,
      result: null,
      error: null,
      created_at: new Date().toISOString(),
    });

    const handleSelectVideo = vi.fn();
    renderWithQueryClient(<LibraryPage onSelectVideo={handleSelectVideo} />);

    // Modal should automatically open with the active recovered job
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Processing Video')).toBeInTheDocument();
    expect(await screen.findByText('Segmenting practice sentences...')).toBeInTheDocument();
    expect(await screen.findByText('70%')).toBeInTheDocument();
  });
});
