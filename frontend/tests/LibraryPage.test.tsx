import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { LibraryPage } from '../src/pages/LibraryPage';
import { apiClient } from '../src/api/client';
import { VideoSummaryDTO } from '../src/api/types';

describe('LibraryPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(apiClient, 'getLocalImports').mockResolvedValue([]);
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

  const libraryVideos: VideoSummaryDTO[] = [
    { id: 11, youtube_id: 'abcdefghijk', title: 'Travel stories', channel: 'Everyday English', duration_seconds: 90, segment_count: 10, completed_count: 2, last_segment_id: 110, transcription_source: 'captions_manual', created_at: '2026-10-01' },
    { id: 12, youtube_id: 'bcdefghijkl', title: 'A new beginning', channel: 'Learning Lab', duration_seconds: 30, segment_count: 5, completed_count: 0, last_segment_id: null, transcription_source: 'captions_manual', created_at: '2026-10-02' },
    { id: 13, youtube_id: 'cdefghijklm', title: 'Finished lesson', channel: 'Learning Lab', duration_seconds: 45, segment_count: 4, completed_count: 4, last_segment_id: 130, transcription_source: 'captions_manual', created_at: '2026-10-03' },
  ];

  it('searches by channel without case sensitivity and clears a no-results state', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({ items: libraryVideos, total: 3 });
    renderWithQueryClient(<LibraryPage onSelectVideo={vi.fn()} />);
    const search = await screen.findByRole('textbox', { name: 'Search videos' });
    fireEvent.change(search, { target: { value: ' LEARNING LAB ' } });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Travel stories' })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'not in library' } });
    expect(screen.getByText('No videos match just yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('filters practice status and reviews completed videos', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({ items: libraryVideos, total: 3 });
    const select = vi.fn();
    renderWithQueryClient(<LibraryPage onSelectVideo={select} />);
    await screen.findByRole('textbox', { name: 'Search videos' });
    fireEvent.click(screen.getByRole('button', { name: 'Not started' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(within(screen.getByRole('article')).getByRole('heading')).toHaveTextContent('A new beginning');
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review Practice' }));
    expect(select).toHaveBeenCalledWith(13);
  });

  it('sorts videos by duration and resumes the most recently opened unfinished video', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({ items: libraryVideos, total: 3 });
    const select = vi.fn();
    renderWithQueryClient(<LibraryPage onSelectVideo={select} />);
    await screen.findByRole('textbox', { name: 'Search videos' });
    fireEvent.change(screen.getByLabelText('Sort videos'), { target: { value: 'shortest' } });
    expect(within(screen.getAllByRole('article')[0]).getByRole('heading')).toHaveTextContent('A new beginning');
    fireEvent.click(screen.getByRole('button', { name: 'Pick up where you left off' }));
    expect(select).toHaveBeenCalledWith(11);
  });

  it('searches videos beyond the first API page', async () => {
    const getVideos = vi.spyOn(apiClient, 'getVideos')
      .mockResolvedValueOnce({ items: [libraryVideos[0]], total: 2 })
      .mockResolvedValueOnce({ items: [libraryVideos[1]], total: 2 });
    renderWithQueryClient(<LibraryPage onSelectVideo={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'A new beginning' })).toBeInTheDocument();
    expect(getVideos).toHaveBeenCalledWith(100, 1);
  });

  it('shows a local source without requesting a YouTube thumbnail', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({ items: [{ ...libraryVideos[0], youtube_id: 'local:example', source_type: 'local', channel: 'Local video' }], total: 1 });
    const { container } = renderWithQueryClient(<LibraryPage onSelectVideo={vi.fn()} />);
    expect(await screen.findByText('Local video · no YouTube connection')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('finds an ongoing local import even when browser storage is empty', async () => {
    const job = { id: 'saved-local-import', kind: 'local_ingest' as const, status: 'running' as const, stage: 'recovering', progress: 0.4, error: null, created_at: '2026-10-28' };
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(apiClient, 'getLocalImports').mockResolvedValue([job]);
    vi.spyOn(apiClient, 'getJob').mockResolvedValue(job);
    renderWithQueryClient(<LibraryPage onSelectVideo={vi.fn()} />);
    expect(await screen.findByText('Restoring your saved video...')).toBeInTheDocument();
    expect(localStorage.getItem('fluenttube_pending_job_id')).toBe(job.id);
  });
});
