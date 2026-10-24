import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GrammarTutorDrawer } from '../src/components/GrammarTutorDrawer';
import { SegmentDTO, TutorExplanationDTO } from '../src/api/types';
import { apiClient, ApiError } from '../src/api/client';
import { useStudyStore } from '../src/stores/useStudyStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';

const mockSegment: SegmentDTO = {
  id: 42,
  video_id: 1,
  position: 0,
  start_seconds: 0.0,
  end_seconds: 4.5,
  text: "I am trying to figure out how this works.",
  timing_quality: "caption",
  completed: true,
  revealed: false,
  shadowing_unlocked: true,
};

const mockExplanation: TutorExplanationDTO = {
  segment_id: 42,
  language: 'es',
  contextual_meaning: 'El hablante expresa que lleva un tiempo intentando comprender la situación.',
  key_vocabulary: [
    {
      term: 'figure out',
      type: 'phrasal_verb',
      explanation: 'Descubrir, entender o resolver algo tras reflexionar.',
    },
  ],
  connected_speech: [
    {
      fragment: 'trying to',
      tip: "En habla rápida, 'trying to' suele reducirse a 'tryna'.",
    },
  ],
  example: {
    sentence: "I need to figure out this problem.",
    explanation: 'Otro ejemplo del mismo phrasal verb.',
  },
  cached: false,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
};

describe('GrammarTutorDrawer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStudyStore.getState().reset();
    useSettingsStore.getState().resetPreferences();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <GrammarTutorDrawer
        isOpen={false}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows disabled state when health reports tutor.enabled = false', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValueOnce({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: { state: 'ready', device: 'cpu', model: 'small.en', compute_type: 'int8', gpu_name: null, free_vram_mb: null, last_error: null },
      tutor: { enabled: false, provider: null },
    });

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Grammar Tutor is Disabled/i)).toBeInTheDocument();
      expect(screen.getByText(/requires a Gemini API key/i)).toBeInTheDocument();
      expect(screen.getByText(/View Settings & Setup Guide/i)).toBeInTheDocument();
    });
  });

  it('shows idle state with target sentence and Explain button when tutor is enabled', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValueOnce({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: { state: 'ready', device: 'cpu', model: 'small.en', compute_type: 'int8', gpu_name: null, free_vram_mb: null, last_error: null },
      tutor: { enabled: true, provider: 'gemini' },
    });

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("I am trying to figure out how this works.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Explain this sentence/i })).toBeInTheDocument();
      expect(screen.getByText(/Only this sentence and its immediate neighbors are sent/i)).toBeInTheDocument();
    });
  });

  it('clicking Explain button triggers API call and renders structured explanation', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValueOnce({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: { state: 'ready', device: 'cpu', model: 'small.en', compute_type: 'int8', gpu_name: null, free_vram_mb: null, last_error: null },
      tutor: { enabled: true, provider: 'gemini' },
    });

    const explainSpy = vi.spyOn(apiClient, 'explainSegment').mockResolvedValueOnce(mockExplanation);

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Explain this sentence/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Explain this sentence/i }));

    expect(explainSpy).toHaveBeenCalledWith(42, 'es');

    expect(await screen.findByText(/Contextual Meaning/i)).toBeInTheDocument();
    expect(screen.getByText(mockExplanation.contextual_meaning)).toBeInTheDocument();
    expect(screen.getByText('figure out')).toBeInTheDocument();
    expect(screen.getByText('phrasal verb')).toBeInTheDocument();
    expect(screen.getByText(/Descubrir, entender o resolver algo tras reflexionar/i)).toBeInTheDocument();
    expect(screen.getByText('"trying to"')).toBeInTheDocument();
    expect(screen.getByText(/suele reducirse a 'tryna'/i)).toBeInTheDocument();
    expect(screen.getByText(/Example Usage/i)).toBeInTheDocument();
    expect(screen.getByText('"I need to figure out this problem."')).toBeInTheDocument();
    expect(screen.getByText(/gemini \(gemini-2.5-flash\)/i)).toBeInTheDocument();
  });

  it('renders cached explanation discreetly when cached = true', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValueOnce({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: { state: 'ready', device: 'cpu', model: 'small.en', compute_type: 'int8', gpu_name: null, free_vram_mb: null, last_error: null },
      tutor: { enabled: true, provider: 'gemini' },
    });

    const cachedExp = { ...mockExplanation, cached: true };
    useStudyStore.getState().setTutorExplanation(42, 'es', cachedExp);

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Cached response/i)).toBeInTheDocument();
      expect(screen.getByText(mockExplanation.contextual_meaning)).toBeInTheDocument();
    });
  });

  it('renders error state and preserves drawer on API failure', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValueOnce({
      status: 'ok',
      database: 'ok',
      ffmpeg_available: true,
      speech: { state: 'ready', device: 'cpu', model: 'small.en', compute_type: 'int8', gpu_name: null, free_vram_mb: null, last_error: null },
      tutor: { enabled: true, provider: 'gemini' },
    });

    vi.spyOn(apiClient, 'explainSegment').mockRejectedValueOnce(
      new ApiError(429, 'TUTOR_QUOTA_EXCEEDED', 'Rate limit exceeded')
    );

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Explain this sentence/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Explain this sentence/i }));

    await waitFor(() => {
      expect(screen.getByText(/Tutor Analysis Error/i)).toBeInTheDocument();
      expect(screen.getByText(/rate limit or quota exceeded/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
    });
  });

  it('closes when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={handleClose}
        segment={mockSegment}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Close tutor drawer/i }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={handleClose}
        segment={mockSegment}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders sanitized text nodes without HTML execution', async () => {
    const maliciousExplanation: TutorExplanationDTO = {
      ...mockExplanation,
      contextual_meaning: '<script>alert("hacked")</script><b>Dangerous bold</b>',
    };
    useStudyStore.getState().setTutorExplanation(42, 'es', maliciousExplanation);

    const { container } = render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('<script>alert("hacked")</script><b>Dangerous bold</b>')).toBeInTheDocument();
      // Ensure <script> was NOT created as a DOM element
      expect(container.querySelector('script')).toBeNull();
    });
  });
});
