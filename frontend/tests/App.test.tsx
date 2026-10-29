import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../src/App';
import { apiClient } from '../src/api/client';
import { VideoDetailDTO, VideoSummaryDTO } from '../src/api/types';
import { queryClient } from '../src/api/queryClient';

describe('App Component & Routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.location.hash = '#/';
    localStorage.clear();
    queryClient.clear();
    vi.spyOn(apiClient, 'getLocalImports').mockResolvedValue([]);
  });

  it('renders LibraryPage by default on root route', async () => {
    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({
      items: [],
      total: 0,
    });

    render(<App />);

    expect(screen.getByRole('link', { name: 'FluentTube home' })).toBeInTheDocument();
    expect(await screen.findByText('Your study library is empty')).toBeInTheDocument();
  });

  it('navigates to StudyPage when a video card is clicked and returns on back click', async () => {
    const mockVideos: VideoSummaryDTO[] = [
      {
        id: 10,
        youtube_id: 'abc12345678',
        title: 'Learn English with News',
        channel: 'English Channel',
        duration_seconds: 120.0,
        transcription_source: 'captions_manual',
        segment_count: 5,
        completed_count: 0,
        last_segment_id: null,
        created_at: new Date().toISOString(),
      },
    ];

    const mockDetail: VideoDetailDTO = {
      ...mockVideos[0],
      segments: [
        {
          id: 101,
          video_id: 10,
          position: 0,
          start_seconds: 0.0,
          end_seconds: 4.5,
          text: 'Good morning everyone.',
          timing_quality: 'caption',
          completed: true,
          revealed: false,
          shadowing_unlocked: true,
        },
      ],
    };

    vi.spyOn(apiClient, 'getVideos').mockResolvedValue({
      items: mockVideos,
      total: 1,
    });
    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockDetail);

    render(<App />);

    // Video card appears in library
    const titles = await screen.findAllByText('Learn English with News');
    expect(titles.length).toBeGreaterThanOrEqual(1);

    // Click "Start Practice"
    const startBtn = screen.getByRole('button', { name: /start practice/i });
    fireEvent.click(startBtn);

    // Navigates to study view
    expect(window.location.hash).toBe('#/study/10');
    expect(await screen.findByText('Practice Sentences (1)')).toBeInTheDocument();
    expect(screen.getByText('Good morning everyone.')).toBeInTheDocument();

    // Click "Library" back button
    const backBtn = screen.getByRole('button', { name: /library/i });
    fireEvent.click(backBtn);

    // Returns to library view
    expect(window.location.hash).toBe('#/');
    expect(await screen.findByRole('heading', { name: 'Your library' })).toBeInTheDocument();
  });

  it('renders StudyPage directly when URL hash is #/study/:id', async () => {
    window.location.hash = '#/study/42';

    const mockDetail: VideoDetailDTO = {
      id: 42,
      youtube_id: 'xyz12345678',
      title: 'Direct Route Video',
      channel: 'Channel',
      duration_seconds: 60.0,
      transcription_source: 'captions_manual',
      segment_count: 1,
      completed_count: 0,
      last_segment_id: null,
      created_at: new Date().toISOString(),
      segments: [
        {
          id: 201,
          video_id: 42,
          position: 0,
          start_seconds: 0.0,
          end_seconds: 2.0,
          text: 'Direct segment.',
          timing_quality: 'caption',
          completed: true,
          revealed: false,
          shadowing_unlocked: true,
        },
      ],
    };

    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockDetail);

    render(<App />);

    const directHeadings = await screen.findAllByText('Direct Route Video');
    expect(directHeadings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Direct segment.')).toBeInTheDocument();
  });

  it('renders SettingsPage when URL hash is #/settings', async () => {
    window.location.hash = '#/settings';
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: { state: 'unloaded', device: null, model: null, compute_type: null, gpu_name: null, free_vram_mb: null, last_error: null },
      tutor: { enabled: false, provider: null },
    });

    render(<App />);

    expect(await screen.findByText('System Settings & Health')).toBeInTheDocument();
    expect(screen.getByText('AI Grammar Tutor Configuration Guide')).toBeInTheDocument();
  });
});

