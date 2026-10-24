import { screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { ShadowingStudio } from '../src/components/ShadowingStudio';
import { useStudyStore } from '../src/stores/useStudyStore';
import { SegmentDTO, JobDTO } from '../src/api/types';
import { apiClient } from '../src/api/client';
import WaveSurfer from 'wavesurfer.js';

// Mock WaveSurfer
vi.mock('wavesurfer.js', () => {
  const mockInstance = {
    on: vi.fn(),
    playPause: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockInstance),
    },
  };
});

describe('ShadowingStudio Component & Recording Lifecycle', () => {
  const lockedSegment: SegmentDTO = {
    id: 101,
    video_id: 1,
    position: 0,
    start_seconds: 0.0,
    end_seconds: 3.5,
    text: 'Locked confidential sentence.',
    timing_quality: 'good',
    completed: false,
    revealed: false,
    shadowing_unlocked: false,
  };

  const unlockedCompletedSegment: SegmentDTO = {
    id: 102,
    video_id: 1,
    position: 1,
    start_seconds: 3.5,
    end_seconds: 7.0,
    text: 'A great journey begins with a single step.',
    timing_quality: 'good',
    completed: true,
    revealed: false,
    shadowing_unlocked: true,
  };

  const unlockedRevealedSegment: SegmentDTO = {
    id: 103,
    video_id: 1,
    position: 2,
    start_seconds: 7.0,
    end_seconds: 10.2,
    text: 'Practice makes permanent progress.',
    timing_quality: 'good',
    completed: false,
    revealed: true,
    shadowing_unlocked: false,
  };

  // Mock MediaStreamTrack
  class MockTrack {
    kind = 'audio';
    enabled = true;
    readyState: 'live' | 'ended' = 'live';
    stop = vi.fn(() => {
      this.readyState = 'ended';
    });
  }

  // Mock MediaStream
  class MockStream {
    tracks: MockTrack[];
    constructor(tracks?: MockTrack[]) {
      this.tracks = tracks || [new MockTrack()];
    }
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
  }

  let activeStream: MockStream | null = null;
  let activeRecorder: MockMediaRecorder | null = null;
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];

  class MockMediaRecorder {
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    stream: MockStream;
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;

    static isTypeSupported = vi.fn((mime: string) => mime.includes('webm'));

    constructor(stream: MockStream, options?: { mimeType?: string }) {
      this.stream = stream;
      this.mimeType = options?.mimeType || 'audio/webm;codecs=opus';
      activeRecorder = this;
    }

    start = vi.fn((_timeslice?: number) => {
      this.state = 'recording';
    });

    stop = vi.fn(() => {
      this.state = 'inactive';
      if (this.ondataavailable) {
        this.ondataavailable({
          data: new Blob(['fake-audio-binary'], { type: this.mimeType }),
        });
      }
      if (this.onstop) {
        this.onstop();
      }
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    useStudyStore.getState().reset();
    activeStream = new MockStream();
    activeRecorder = null;
    createdUrls.length = 0;
    revokedUrls.length = 0;

    // Mock URL object URL lifecycle
    let urlCounter = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:http://localhost/mock-audio-${++urlCounter}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });

    // Mock MediaRecorder globally
    (window as any).MediaRecorder = MockMediaRecorder;

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: vi.fn().mockImplementation(async () => activeStream),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Locked / Unlocked State Handling', () => {
    it('renders locked state when segment is incomplete and unrevealed', () => {
      renderWithQueryClient(<ShadowingStudio segment={lockedSegment} />);

      expect(screen.getByText('Locked')).toBeInTheDocument();
      expect(
        screen.getByText('Complete or reveal the sentence to practice speaking.')
      ).toBeInTheDocument();

      // Record button is disabled with explanation title
      const recordBtn = screen.getByRole('button', { name: /Record Speech/i });
      expect(recordBtn).toBeDisabled();
      expect(recordBtn).toHaveAttribute('title', 'Complete or reveal sentence first');

      // Target sentence text is hidden
      expect(screen.queryByText('Locked confidential sentence.')).not.toBeInTheDocument();

      // Section 8.2 disclaimer is present
      expect(
        screen.getByText(
          /Practice feedback estimated from speech recognition; it is not a phonetic pronunciation assessment\./i
        )
      ).toBeInTheDocument();
    });

    it('renders unlocked state when segment is completed', () => {
      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      expect(screen.getByText('Unlocked')).toBeInTheDocument();
      expect(
        screen.getByText('"A great journey begins with a single step."')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start recording/i })).toBeEnabled();
    });

    it('renders unlocked state when segment is revealed', () => {
      renderWithQueryClient(<ShadowingStudio segment={unlockedRevealedSegment} />);

      expect(screen.getByText('Unlocked')).toBeInTheDocument();
      expect(
        screen.getByText('"Practice makes permanent progress."')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start recording/i })).toBeEnabled();
    });

    it('triggers onListenOriginal when clicking Listen button', () => {
      const handleListen = vi.fn();
      renderWithQueryClient(
        <ShadowingStudio
          segment={unlockedCompletedSegment}
          onListenOriginal={handleListen}
        />
      );

      const listenBtn = screen.getByRole('button', { name: /Listen to original sentence/i });
      fireEvent.click(listenBtn);
      expect(handleListen).toHaveBeenCalledTimes(1);
    });
  });

  describe('Recording Lifecycle and Hardware Release', () => {
    it('pauses YouTube player before recording begins and starts capture', async () => {
      const handleBeforeRecord = vi.fn();
      renderWithQueryClient(
        <ShadowingStudio
          segment={unlockedCompletedSegment}
          onBeforeRecord={handleBeforeRecord}
        />
      );

      const startBtn = screen.getByRole('button', { name: /Start recording/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      // 1. YouTube playback paused
      expect(handleBeforeRecord).toHaveBeenCalledTimes(1);

      // 2. getUserMedia requested audio
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });

      // 3. MediaRecorder initialized and started
      expect(activeRecorder).not.toBeNull();
      expect(activeRecorder?.start).toHaveBeenCalledWith(250);

      // 4. Store state updated to guard navigation
      expect(useStudyStore.getState().isRecording).toBe(true);

      // 5. Active recording UI rendered
      expect(screen.getByText('Recording Audio')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Stop recording/i })).toBeInTheDocument();
    });

    it('stops recording, immediately releases hardware tracks, mounts WaveSurfer and enables evaluation', async () => {
      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      const startBtn = screen.getByRole('button', { name: /Start recording/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(activeStream?.tracks[0].readyState).toBe('live');

      // Click stop recording
      const stopBtn = screen.getByRole('button', { name: /Stop recording/i });
      act(() => {
        fireEvent.click(stopBtn);
      });

      // Hardware tracks immediately stopped per Section 14.15 & 8.2
      expect(activeStream?.tracks[0].stop).toHaveBeenCalledTimes(1);
      expect(activeStream?.tracks[0].readyState).toBe('ended');

      // Navigation guard released in store
      expect(useStudyStore.getState().isRecording).toBe(false);

      // Playback UI rendered
      expect(screen.getByText('Your Shadowing Repetition')).toBeInTheDocument();
      expect(screen.getByTestId('waveform-card')).toBeInTheDocument();
      expect(screen.getByTestId('waveform-container')).toBeInTheDocument();
      expect(WaveSurfer.create).toHaveBeenCalled();

      // Native accessible audio player rendered
      const audioElement = screen.getByLabelText(/Playback your recorded speech/i) as HTMLAudioElement;
      expect(audioElement).toBeInTheDocument();
      expect(audioElement.src).toContain('blob:http://localhost/mock-audio-1');

      // Evaluate speech button rendered and enabled (T15)
      const evalBtn = screen.getByRole('button', { name: /Evaluate speech/i });
      expect(evalBtn).toBeEnabled();
    });

    it('revokes previous object URL and resets state when Record again is clicked', async () => {
      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      // Start & Stop recording
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Stop recording/i }));
      });

      expect(createdUrls.length).toBe(1);
      const recordedUrl = createdUrls[0];

      // Click "Record again"
      const recordAgainBtn = screen.getByRole('button', { name: /Record again/i });
      act(() => {
        fireEvent.click(recordAgainBtn);
      });

      // Previous object URL revoked
      expect(revokedUrls).toContain(recordedUrl);

      // State returned to idle with Start Recording available
      expect(screen.getByRole('button', { name: /Start recording/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Playback your recorded speech/i)).not.toBeInTheDocument();
    });

    it('enforces 30.0s hard cutoff and automatically stops recording', async () => {
      vi.useFakeTimers();

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
      });

      expect(activeRecorder?.state).toBe('recording');

      // Advance timers by 30 seconds
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      // MediaRecorder stopped automatically
      expect(activeRecorder?.stop).toHaveBeenCalled();
      expect(activeStream?.tracks[0].stop).toHaveBeenCalled();
      expect(useStudyStore.getState().isRecording).toBe(false);
    });

    it('releases hardware tracks and revokes object URL on unmount', async () => {
      const { unmount } = renderWithQueryClient(
        <ShadowingStudio segment={unlockedCompletedSegment} />
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
      });

      const track = activeStream?.tracks[0];
      expect(track?.readyState).toBe('live');

      // Unmount during recording
      act(() => {
        unmount();
      });

      // Track must be released immediately upon unmount
      expect(track?.stop).toHaveBeenCalled();
      expect(useStudyStore.getState().isRecording).toBe(false);
    });
  });

  describe('WaveSurfer and Speech Evaluation Flow (T15)', () => {
    it('submits recorded audio to evaluation endpoint and displays completion banner', async () => {
      const mockJob: JobDTO = {
        id: 'job-shadow-123',
        kind: 'shadowing',
        status: 'succeeded',
        stage: 'ready_for_asr',
        progress: 1.0,
        result: {
          segment_id: 102,
          audio_valid: true,
          duration_seconds: 2.5,
          engine_status: 'pending_t16_asr',
          message:
            'Audio validated and converted to 16 kHz mono PCM. Speech evaluation engine activates in T16.',
        },
        error: null,
        created_at: new Date().toISOString(),
      };

      vi.spyOn(apiClient, 'evaluateShadowing').mockResolvedValue({
        job_id: 'job-shadow-123',
        status: 'queued',
      });
      vi.spyOn(apiClient, 'getJob').mockResolvedValue(mockJob);

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      // Record audio
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Stop recording/i }));
      });

      const evalBtn = screen.getByRole('button', { name: /Evaluate speech/i });
      expect(evalBtn).toBeEnabled();

      // Click evaluate
      await act(async () => {
        fireEvent.click(evalBtn);
      });

      expect(apiClient.evaluateShadowing).toHaveBeenCalledWith(
        102,
        expect.any(Blob)
      );

      // Verify success banner displays
      await screen.findByText('Audio Validated & Queued');
      expect(
        screen.getByText(
          /Audio validated and converted to 16 kHz mono PCM\. Speech evaluation engine activates in T16\./i
        )
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Evaluate speech/i })).toHaveTextContent(
        'Evaluated'
      );
    });

    it('displays error message when evaluateShadowing fails with api error', async () => {
      vi.spyOn(apiClient, 'evaluateShadowing').mockRejectedValueOnce(
        new Error('Media container could not be parsed as valid audio.')
      );

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      // Record audio
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Start recording/i }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Stop recording/i }));
      });

      const evalBtn = screen.getByRole('button', { name: /Evaluate speech/i });
      await act(async () => {
        fireEvent.click(evalBtn);
      });

      // Verify error alert banner displays
      await screen.findByRole('alert');
      expect(
        screen.getByText('Media container could not be parsed as valid audio.')
      ).toBeInTheDocument();

      // Dismiss error
      const dismissBtn = screen.getByRole('button', { name: /Dismiss/i });
      act(() => {
        fireEvent.click(dismissBtn);
      });
      expect(
        screen.queryByText('Media container could not be parsed as valid audio.')
      ).not.toBeInTheDocument();
    });
  });

  describe('Error and Permission Handling', () => {
    it('displays clear instructions when microphone permission is denied', async () => {
      const permissionError = new Error('Permission denied');
      permissionError.name = 'NotAllowedError';
      (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(permissionError);

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      const startBtn = screen.getByRole('button', { name: /Start recording/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      // User-friendly permission denial message
      expect(
        screen.getByText(
          'Microphone permission was denied. Please allow microphone access in your browser site settings and try again.'
        )
      ).toBeInTheDocument();

      // Dismiss error
      const dismissBtn = screen.getByRole('button', { name: /Dismiss/i });
      act(() => {
        fireEvent.click(dismissBtn);
      });
      expect(
        screen.queryByText(
          'Microphone permission was denied. Please allow microphone access in your browser site settings and try again.'
        )
      ).not.toBeInTheDocument();
    });

    it('displays clear error when no microphone hardware is found', async () => {
      const notFoundError = new Error('Device not found');
      notFoundError.name = 'NotFoundError';
      (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(notFoundError);

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      const startBtn = screen.getByRole('button', { name: /Start recording/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(
        screen.getByText('No microphone device found. Please connect an audio input device.')
      ).toBeInTheDocument();
    });

    it('handles unsupported browser environment gracefully', async () => {
      // Remove mediaDevices
      Object.defineProperty(navigator, 'mediaDevices', {
        writable: true,
        value: undefined,
      });

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      const startBtn = screen.getByRole('button', { name: /Start recording/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(
        screen.getByText(
          'Audio recording is not supported in this browser environment. Please use a modern browser.'
        )
      ).toBeInTheDocument();
    });
  });

  describe('T19 — Speech Feedback, Metrics, Badges, and Segment Isolation', () => {
    it('renders full Section 10.4 score breakdown, token badges, legend, and extra words', async () => {
      useStudyStore.getState().setShadowingResult(102, {
        segment_id: 102,
        status: 'scored',
        recognized_text: 'A great journey begins with single step please',
        word_match_score: 90,
        timing_similarity_score: 85,
        overall_score: 89,
        spoken_duration: 3.2,
        reference_duration: 3.5,
        timing_basis: 'active_reference_words',
        alignment: [
          { display_index: 0, text: 'A', status: 'matched', asr_confidence: 0.95, canonical_tokens: ['a'] },
          { display_index: 1, text: 'great', status: 'matched', asr_confidence: 0.92, canonical_tokens: ['great'] },
          { display_index: 2, text: 'journey', status: 'uncertain', asr_confidence: 0.65, canonical_tokens: ['journey'] },
          { display_index: 3, text: 'begins', status: 'matched', asr_confidence: 0.90, canonical_tokens: ['begins'] },
          { display_index: 4, text: 'with', status: 'matched', asr_confidence: 0.88, canonical_tokens: ['with'] },
          { display_index: 5, text: 'a', status: 'omitted', asr_confidence: null, canonical_tokens: ['a'] },
          { display_index: 6, text: 'single', status: 'matched', asr_confidence: 0.91, canonical_tokens: ['single'] },
          { display_index: 7, text: 'step', status: 'matched', asr_confidence: 0.94, canonical_tokens: ['step'] },
        ],
        insertions: [{ text: 'please', asr_confidence: 0.89 }],
        warning_codes: [],
      });

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      // Verify numeric scores and labels (Section 8.2 & Section 10.4)
      expect(screen.getByText('Practice score')).toBeInTheDocument();
      expect(screen.getByText('89%')).toBeInTheDocument();
      expect(screen.getByText('Word match')).toBeInTheDocument();
      expect(screen.getByText('90%')).toBeInTheDocument();
      expect(screen.getByText('Timing similarity')).toBeInTheDocument();
      expect(screen.getByText('85%')).toBeInTheDocument();

      // Verify word status legend
      expect(screen.getByText('Legend:')).toBeInTheDocument();
      expect(screen.getAllByText('Recognized').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Uncertain').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(1);

      // Verify token badges
      expect(screen.getByText('journey')).toBeInTheDocument();

      // Verify extra words
      expect(screen.getByText('Extra Words Detected:')).toBeInTheDocument();
      expect(screen.getByText('+please')).toBeInTheDocument();

      // Verify surfaced recognized speech
      expect(screen.getByText('Recognized Speech')).toBeInTheDocument();
      expect(
        screen.getByText('"A great journey begins with single step please"')
      ).toBeInTheDocument();
    });

    it('renders unscorable feedback when status is unscorable without fake grades', async () => {
      useStudyStore.getState().setShadowingResult(102, {
        segment_id: 102,
        status: 'unscorable',
        recognized_text: '',
        word_match_score: null,
        timing_similarity_score: null,
        overall_score: null,
        alignment: [],
        warning_codes: ['NO_SPEECH'],
      });

      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);

      expect(screen.getByText('Speech Unscorable')).toBeInTheDocument();
      expect(
        screen.getByText(
          'No clear speech was recognized in your recording. Please speak clearly into your microphone and try again.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText('Practice score')).not.toBeInTheDocument();
    });

    it('verifies evaluation results are isolated by segment and do not bleed into adjacent segments', async () => {
      // Store result strictly for segment 102
      useStudyStore.getState().setShadowingResult(102, {
        segment_id: 102,
        status: 'scored',
        recognized_text: 'Segment 102 unique speech',
        word_match_score: 100,
        timing_similarity_score: 95,
        overall_score: 99,
        alignment: [],
        warning_codes: [],
      });

      // Render segment 103 (which has no stored result)
      const { unmount } = renderWithQueryClient(
        <ShadowingStudio segment={unlockedRevealedSegment} />
      );

      // Verify segment 102's speech and score do NOT bleed into segment 103
      expect(screen.queryByText('Segment 102 unique speech')).not.toBeInTheDocument();
      expect(screen.queryByText('99%')).not.toBeInTheDocument();
      unmount();

      // Re-render segment 102: its result is preserved and displayed
      renderWithQueryClient(<ShadowingStudio segment={unlockedCompletedSegment} />);
      expect(screen.getByText('"Segment 102 unique speech"')).toBeInTheDocument();
      expect(screen.getByText('99%')).toBeInTheDocument();
    });
  });
});

