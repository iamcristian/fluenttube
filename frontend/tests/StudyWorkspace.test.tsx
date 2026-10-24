import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { SegmentList } from '../src/components/SegmentList';
import { StudyPage } from '../src/pages/StudyPage';
import { apiClient } from '../src/api/client';
import { useStudyStore } from '../src/stores/useStudyStore';
import { VideoDetailDTO, SegmentDTO } from '../src/api/types';

describe('SegmentList Component', () => {
  const sampleSegments: SegmentDTO[] = [
    {
      id: 88,
      video_id: 10,
      position: 0,
      start_seconds: 0.0,
      end_seconds: 3.5,
      text: 'Secret sentence one.',
      timing_quality: 'good',
      completed: false,
      revealed: false,
      shadowing_unlocked: false,
    },
    {
      id: 92,
      video_id: 10,
      position: 1,
      start_seconds: 3.5,
      end_seconds: 6.2,
      text: 'Revealed sentence two.',
      timing_quality: 'good',
      completed: false,
      revealed: true,
      shadowing_unlocked: false,
    },
    {
      id: 105,
      video_id: 10,
      position: 2,
      start_seconds: 6.2,
      end_seconds: 9.0,
      text: 'Completed sentence three.',
      timing_quality: 'good',
      completed: true,
      revealed: false,
      shadowing_unlocked: true,
    },
  ];

  it('renders independent position numbers (#1, #2, #3) regardless of database IDs', () => {
    const handleSelect = vi.fn();
    renderWithQueryClient(
      <SegmentList
        segments={sampleSegments}
        activeSegmentId={88}
        onSelectSegment={handleSelect}
      />
    );

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();

    // Verify DB IDs are NOT used as the segment numbering text
    expect(screen.queryByText('#88')).not.toBeInTheDocument();
    expect(screen.queryByText('#92')).not.toBeInTheDocument();
    expect(screen.queryByText('#105')).not.toBeInTheDocument();
  });

  it('conceals answer text for incomplete and unrevealed sentences', () => {
    const handleSelect = vi.fn();
    renderWithQueryClient(
      <SegmentList
        segments={sampleSegments}
        activeSegmentId={88}
        onSelectSegment={handleSelect}
      />
    );

    // Segment 88 is incomplete and unrevealed: text MUST NOT be visible
    expect(screen.queryByText('Secret sentence one.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sentence hidden until completed')).toBeInTheDocument();

    // Segment 92 is revealed: text MUST be visible
    expect(screen.getByText('Revealed sentence two.')).toBeInTheDocument();

    // Segment 105 is completed: text MUST be visible
    expect(screen.getByText('Completed sentence three.')).toBeInTheDocument();
  });

  it('triggers onSelectSegment with database ID when segment is clicked', () => {
    const handleSelect = vi.fn();
    renderWithQueryClient(
      <SegmentList
        segments={sampleSegments}
        activeSegmentId={88}
        onSelectSegment={handleSelect}
      />
    );

    const segmentTwoBtn = screen.getByRole('listitem', { name: /Sentence 2/i });
    fireEvent.click(segmentTwoBtn);

    expect(handleSelect).toHaveBeenCalledWith(92);
  });
});

describe('StudyPage Workspace Integration', () => {
  const mockSegments: SegmentDTO[] = [
    {
      id: 501,
      video_id: 5,
      position: 0,
      start_seconds: 0.0,
      end_seconds: 4.0,
      text: 'First practice sentence.',
      timing_quality: 'good',
      completed: true,
      revealed: false,
      shadowing_unlocked: true,
    },
    {
      id: 502,
      video_id: 5,
      position: 1,
      start_seconds: 4.0,
      end_seconds: 8.5,
      text: 'Second practice sentence.',
      timing_quality: 'good',
      completed: false,
      revealed: false,
      shadowing_unlocked: false,
    },
  ];

  const mockVideoDetail: VideoDetailDTO = {
    id: 5,
    youtube_id: 'jNQXAC9IVRw',
    title: 'Me at the zoo - Practice Audio Clip',
    channel: 'jawed',
    duration_seconds: 19.0,
    transcription_source: 'captions_manual',
    segment_count: 2,
    completed_count: 1,
    last_segment_id: 502,
    created_at: new Date().toISOString(),
    segments: mockSegments,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useStudyStore.getState().reset();
  });

  it('restores last_segment_id on opening and updates progress on navigation', async () => {
    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockVideoDetail);
    const updateProgressSpy = vi
      .spyOn(apiClient, 'updateVideoProgress')
      .mockResolvedValue({
        last_segment_id: 501,
        last_opened_at: new Date().toISOString(),
      });

    const handleBack = vi.fn();
    renderWithQueryClient(<StudyPage videoId={5} onBackToLibrary={handleBack} />);

    // Wait for video title to be displayed
    expect(await screen.findByText('Me at the zoo - Practice Audio Clip')).toBeInTheDocument();

    // Verify last_segment_id (502) is restored: "Sentence 2 of 2"
    expect(screen.getByText('Sentence 2 of 2')).toBeInTheDocument();

    // Verify progress bar shows "1/2 completed" and "50%"
    expect(screen.getByText('1/2 completed')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();

    // Navigate to previous segment (Sentence 1, id 501)
    const prevBtn = screen.getByRole('button', { name: /previous sentence/i });
    fireEvent.click(prevBtn);

    // Position updates to "Sentence 1 of 2"
    expect(screen.getByText('Sentence 1 of 2')).toBeInTheDocument();

    // Verifies progress update was called with segment ID 501
    await waitFor(() => {
      expect(updateProgressSpy).toHaveBeenCalledWith(5, 501);
    });
  });

  it('preserves and restores draft per segment during workspace navigation', async () => {
    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockVideoDetail);
    vi.spyOn(apiClient, 'updateVideoProgress').mockResolvedValue({
      last_segment_id: 501,
      last_opened_at: new Date().toISOString(),
    });

    renderWithQueryClient(<StudyPage videoId={5} onBackToLibrary={vi.fn()} />);
    await screen.findByText('Sentence 2 of 2');

    const textarea = screen.getByPlaceholderText(/transcribe the sentence here/i);

    // Type a draft for Sentence 2
    fireEvent.change(textarea, { target: { value: 'Draft for sentence two' } });
    expect(textarea).toHaveValue('Draft for sentence two');

    // Navigate to Sentence 1
    const prevBtn = screen.getByRole('button', { name: /previous sentence/i });
    fireEvent.click(prevBtn);
    expect(screen.getByText('Sentence 1 of 2')).toBeInTheDocument();
    expect(textarea).toHaveValue('');

    // Type draft for Sentence 1
    fireEvent.change(textarea, { target: { value: 'Sentence one draft' } });
    expect(textarea).toHaveValue('Sentence one draft');

    // Navigate back to Sentence 2 and verify draft was restored
    const nextBtn = screen.getByRole('button', { name: /next sentence/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText('Sentence 2 of 2')).toBeInTheDocument();
    expect(textarea).toHaveValue('Draft for sentence two');
  });

  it('renders disabled action buttons with clear tooltip reasons', async () => {
    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockVideoDetail);
    renderWithQueryClient(<StudyPage videoId={5} onBackToLibrary={vi.fn()} />);

    await screen.findByText('Me at the zoo - Practice Audio Clip');

    // Player controls (VideoPlayer) Play button is initially disabled while player initializes
    const playBtn = screen.getByRole('button', { name: /play video/i });
    expect(playBtn).toBeDisabled();

    // "Check" button disabled when input is empty with explanation tooltip
    const checkBtn = screen.getByRole('button', { name: /check sentence/i });
    expect(checkBtn).toBeDisabled();
    expect(checkBtn).toHaveAttribute('title', 'Type what you hear before checking');

    // "Clear" button disabled when draft is empty
    const clearBtn = screen.getByRole('button', { name: /clear draft/i });
    expect(clearBtn).toBeDisabled();
    expect(clearBtn).toHaveAttribute('title', 'Draft is currently empty');
  });

  it('blocks segment navigation when audio recording is active', async () => {
    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockVideoDetail);
    renderWithQueryClient(<StudyPage videoId={5} onBackToLibrary={vi.fn()} />);

    await screen.findByText('Sentence 2 of 2');

    // Simulate active recording in store
    act(() => {
      useStudyStore.getState().setIsRecording(true);
    });

    // Try navigating to Sentence 1 via previous button
    const prevBtn = screen.getByRole('button', { name: /previous sentence/i });
    fireEvent.click(prevBtn);

    // Warning modal appears
    expect(screen.getByText('Audio Recording in Progress')).toBeInTheDocument();
    expect(
      screen.getByText(/Navigating to another sentence right now will discard your active audio capture/i)
    ).toBeInTheDocument();

    // Still on Sentence 2 of 2
    expect(screen.getByText('Sentence 2 of 2')).toBeInTheDocument();

    // Click "Keep Recording"
    const keepRecordingBtn = screen.getByRole('button', { name: /keep recording/i });
    fireEvent.click(keepRecordingBtn);
    expect(screen.queryByText('Audio Recording in Progress')).not.toBeInTheDocument();
  });

  it('prevents opening tutor drawer before unlock and enables explain button after reveal or completion', async () => {
    vi.spyOn(apiClient, 'getVideo').mockResolvedValue(mockVideoDetail);
    renderWithQueryClient(<StudyPage videoId={5} onBackToLibrary={vi.fn()} />);

    // Sentence 2 is initially active (incomplete, not revealed)
    await screen.findByText('Sentence 2 of 2');

    const explainBtn = screen.getByRole('button', { name: /explain sentence/i });
    // Inactive / locked state
    expect(explainBtn).toBeDisabled();
    expect(explainBtn).toHaveAttribute(
      'title',
      'Complete or reveal sentence to unlock tutor explanation'
    );

    // Simulate completion or reveal of segment 502
    act(() => {
      useStudyStore.getState().updateSegment(502, { revealed: true });
    });

    // Button becomes enabled
    expect(explainBtn).not.toBeDisabled();
    expect(explainBtn).toHaveAttribute(
      'title',
      'Explain sentence grammar and vocabulary with AI tutor'
    );

    // Clicking button opens the drawer
    fireEvent.click(explainBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Contextual Grammar Tutor/i)).toBeInTheDocument();
  });
});

