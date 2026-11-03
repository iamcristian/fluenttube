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
  spanish_translation: "Estoy intentando entender cómo funciona esto.",
  contextual_meaning: 'The speaker is trying to understand how something works.',
  key_vocabulary: [
    {
      term: 'figure out',
      type: 'phrasal_verb',
      explanation: 'To understand or solve something.',
      example: 'I finally figured out the answer.',
    },
  ],
  connected_speech: [
    {
      fragment: 'trying to',
      tip: 'In British English, to can take the weak form /tə/.'
    },
  ],
  example: {
    sentence: "I need to figure out this problem.",
    explanation: 'Another use of the same phrasal verb.',
  },
  cached: false,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
};

describe('GrammarTutorDrawer Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'explainSegment').mockResolvedValue(mockExplanation);
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

  it('shows disabled state when tutor is unavailable', async () => {
    vi.spyOn(apiClient, 'explainSegment').mockRejectedValue(new ApiError(503, 'TUTOR_DISABLED', 'Disabled'));

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

  it('opens with the target sentence and no second button or language selector', async () => {

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("I am trying to figure out how this works.")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Explain this sentence/i })).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    });
  });

  it('opening triggers one API call and renders the fixed explanation', async () => {

    const explainSpy = vi.spyOn(apiClient, 'explainSegment').mockResolvedValueOnce(mockExplanation);

    render(
      <GrammarTutorDrawer
        isOpen={true}
        onClose={vi.fn()}
        segment={mockSegment}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Explain this sentence/i })).toBeNull();
    });



    await waitFor(() => expect(explainSpy).toHaveBeenCalledWith(42, 'en'));
    expect(explainSpy).toHaveBeenCalledTimes(1);

    expect(await screen.findByText(/Contextual Meaning/i)).toBeInTheDocument();
    expect(screen.getByText(mockExplanation.contextual_meaning)).toBeInTheDocument();
    expect(screen.getByText('figure out')).toBeInTheDocument();
    expect(screen.getByText('phrasal verb')).toBeInTheDocument();
    expect(screen.getByText(/To understand or solve something/i)).toBeInTheDocument();
    expect(screen.getByText('"trying to"')).toBeInTheDocument();
    expect(screen.getByText(/In British English/i)).toBeInTheDocument();
    expect(screen.getByText(/Example Usage/i)).toBeInTheDocument();
    expect(screen.getByText('"I need to figure out this problem."')).toBeInTheDocument();
    expect(screen.getByText(/gemini \(gemini-2.5-flash\)/i)).toBeInTheDocument();
  });

  it('renders cached explanation discreetly when cached = true', async () => {

    const cachedExp = { ...mockExplanation, cached: true };
    useStudyStore.getState().setTutorExplanation(42, 'sentence-british-v2', cachedExp);

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
      expect(screen.queryByRole('button', { name: /Explain this sentence/i })).toBeNull();
    });



    await waitFor(() => {
      expect(screen.getByText(/Tutor Analysis Error/i)).toBeInTheDocument();
      expect(screen.getByText(/Rate limit exceeded/i)).toBeInTheDocument();
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
    useStudyStore.getState().setTutorExplanation(42, 'sentence-british-v2', maliciousExplanation);

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
