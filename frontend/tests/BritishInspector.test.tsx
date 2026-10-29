import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BritishInspector } from '../src/components/BritishInspector';
import { SegmentDTO, VocabularyExplainResponseDTO } from '../src/api/types';
import { apiClient } from '../src/api/client';

const mockSegment: SegmentDTO = {
  id: 101,
  video_id: 1,
  position: 0,
  start_seconds: 0.0,
  end_seconds: 5.0,
  text: 'I cannot put up with that terrible noise.',
  timing_quality: 'caption',
  completed: true,
  revealed: false,
  shadowing_unlocked: true,
};

const mockVocabResponse: VocabularyExplainResponseDTO = {
  term: 'put up with',
  lemma: 'put up with',
  part_of_speech: 'phrasal verb',
  meaning_en: 'To tolerate something unpleasant.',
  translation: 'soportar; tolerar',
  contextual_meaning: 'En esta frase, significa tolerar un ruido muy molesto.',
  usage_notes: ['Inseparable phrasal verb.'],
  examples: [
    {
      en: 'I cannot put up with that terrible noise.',
      translation: 'No puedo soportar ese ruido terrible.',
    },
  ],
  collocations: ['put up with noise', 'put up with delays'],
  other_senses: [],
  warnings: [],
  cached: false,
  provider: 'ollama',
  model: 'llama3.2',
};

describe('BritishInspector Component & Contextual Dictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default prompt when no word is selected', () => {
    render(
      <BritishInspector
        selectedWord={null}
        segment={mockSegment}
        tutorExplanation={null}
        isLoadingTutor={false}
        onRequestTutor={vi.fn()}
      />
    );

    expect(screen.getByText(/Click any word or select text/i)).toBeInTheDocument();
  });

  it('triggers 1-click lookup and renders contextual meaning and translation', async () => {
    const vocabSpy = vi
      .spyOn(apiClient, 'explainVocabulary')
      .mockResolvedValueOnce(mockVocabResponse);

    const dictSpy = vi.spyOn(apiClient, 'getDictionaryEntry').mockResolvedValueOnce({
      word: 'put up with',
      phonetic_uk: '/pʊt ʌp wɪð/',
      part_of_speech: 'phrasal verb',
      definition_en: 'To tolerate something.',
      definition_es: 'Soportar algo.',
      example_en: null,
      audio_url: '/api/british/audio?text=put+up+with',
      cached: true,
    });

    render(
      <BritishInspector
        selectedWord="put up with"
        segment={mockSegment}
        tutorExplanation={null}
        isLoadingTutor={false}
        onRequestTutor={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(vocabSpy).toHaveBeenCalledWith({
        segment_id: 101,
        term: 'put up with',
        explanation_language: 'es',
      });
      expect(dictSpy).toHaveBeenCalled();
    });

    expect(await screen.findByText('soportar; tolerar')).toBeInTheDocument();
    expect(screen.getByText(/En esta frase, significa tolerar un ruido muy molesto/i)).toBeInTheDocument();
    expect(screen.getByText('put up with noise')).toBeInTheDocument();
    expect(screen.getByText('ollama (llama3.2)')).toBeInTheDocument();
  });

  it('shows helpful offline recovery banner when local LLM is offline', async () => {
    vi.spyOn(apiClient, 'explainVocabulary').mockRejectedValueOnce({
      code: 'TUTOR_PROVIDER_UNAVAILABLE',
      statusCode: 503,
      message: 'Local LLM offline',
    });

    vi.spyOn(apiClient, 'getDictionaryEntry').mockResolvedValueOnce({
      word: 'terrible',
      phonetic_uk: '/ˈter.ə.bəl/',
      part_of_speech: 'adjective',
      definition_en: 'Extremely bad or serious.',
      definition_es: 'Terrible o muy malo.',
      example_en: null,
      audio_url: '/api/british/audio?text=terrible',
      cached: false,
    });

    render(
      <BritishInspector
        selectedWord="terrible"
        segment={mockSegment}
        tutorExplanation={null}
        isLoadingTutor={false}
        onRequestTutor={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Local AI Offline/i)).toBeInTheDocument();
      expect(screen.getByText(/ollama run llama3.2/i)).toBeInTheDocument();
      // Standard dictionary still renders definition
      expect(screen.getByText('Extremely bad or serious.')).toBeInTheDocument();
    });
  });
});
