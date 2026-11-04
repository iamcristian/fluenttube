import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BritishInspector } from '../src/components/BritishInspector';
import { OpenWordAtlas } from '../src/components/phoneticsNavigation';
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
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

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
    const openAtlas = vi.fn();
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
      <OpenWordAtlas.Provider value={openAtlas}><BritishInspector
        selectedWord="put up with"
        segment={mockSegment}
        tutorExplanation={null}
        isLoadingTutor={false}
        onRequestTutor={vi.fn()}
      /></OpenWordAtlas.Provider>
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
    expect(screen.queryByText(/llama3.2/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Practicar los sonidos de /pʊt ʌp wɪð/'}));
    expect(openAtlas).toHaveBeenCalledWith({word:'put up with',ipa:'/pʊt ʌp wɪð/'});
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
      expect(screen.getByText(/Optional tutor unavailable/i)).toBeInTheDocument();
      expect(screen.getByText(/Check your tutor settings/i)).toBeInTheDocument();
      // Standard dictionary still renders definition
      expect(screen.getByText('Extremely bad or serious.')).toBeInTheDocument();
    });
  });
});


const inspectorProps = {
  segment: mockSegment, tutorExplanation: null, isLoadingTutor: false, onRequestTutor: vi.fn(),
};

function entry(word: string) {
  return { word, phonetic_uk: null, part_of_speech: null, definition_en: 'Definition of ' + word,
    definition_es: null, example_en: null, audio_url: '', cached: false };
}

it('shows dictionary, variants and editorial status while the tutor is pending', async () => {
  vi.spyOn(apiClient, 'explainVocabulary').mockReturnValue(new Promise(() => {}));
  vi.spyOn(apiClient, 'getDictionaryEntry').mockResolvedValue({
    ...entry('read'), ipa_options: ['/riːd/', '/red/'], ipa_source: 'fluenttube-original-gb-seed',
    ipa_quality: 'editorial_pending_review',
  });
  render(<BritishInspector {...inspectorProps} selectedWord="read" />);
  expect(await screen.findByText('Definition of read')).toBeInTheDocument();
  expect(screen.getByText('UK /riːd/')).toBeInTheDocument();
  expect(screen.getByText('UK /red/')).toBeInTheDocument();
  expect(screen.queryByText(/review pending|Pronunciation source|fluenttube-original-gb-seed/)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Loading contextual');
});

it('preserves apostrophes and offers retry after dictionary failure', async () => {
  vi.spyOn(apiClient, 'explainVocabulary').mockReturnValue(new Promise(() => {}));
  const lookup = vi.spyOn(apiClient, 'getDictionaryEntry')
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(entry("can't"));
  render(<BritishInspector {...inspectorProps} selectedWord={"“can't!”"} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry dictionary' }));
  expect(await screen.findByText("Definition of can't")).toBeInTheDocument();
  expect(lookup).toHaveBeenLastCalledWith("can't");
  expect(screen.getByText(/British IPA unavailable/)).toBeInTheDocument();
});

it('discards earlier responses even when the student returns to the same word', async () => {
  vi.spyOn(apiClient, 'explainVocabulary').mockReturnValue(new Promise(() => {}));
  let resolveOld!: (value: ReturnType<typeof entry>) => void;
  vi.spyOn(apiClient, 'getDictionaryEntry')
    .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(entry('bird'))
    .mockResolvedValueOnce(entry('car'));
  const view = render(<BritishInspector {...inspectorProps} selectedWord="car" />);
  view.rerender(<BritishInspector {...inspectorProps} selectedWord="bird" />);
  await screen.findByText('Definition of bird');
  view.rerender(<BritishInspector {...inspectorProps} selectedWord="car" />);
  await screen.findByText('Definition of car');
  await act(async () => { resolveOld({ ...entry('car'), definition_en: 'Stale definition' }); });
  expect(screen.queryByText('Stale definition')).not.toBeInTheDocument();
  view.rerender(<BritishInspector {...inspectorProps} selectedWord={null} />);
  expect(screen.getByText(/Click any word/)).toBeInTheDocument();
});

it('reports playback rejection and releases audio on word change', async () => {
  vi.spyOn(apiClient, 'explainVocabulary').mockReturnValue(new Promise(() => {}));
  vi.spyOn(apiClient, 'getDictionaryEntry').mockImplementation(word => Promise.resolve(entry(word)));
  const audio = { play: vi.fn().mockRejectedValue(new Error('offline')), pause: vi.fn(),
    removeAttribute: vi.fn(), load: vi.fn(), onended: null, onerror: null, onplaying: null };
  vi.stubGlobal('Audio', vi.fn(function () { return audio; }));
  const view = render(<BritishInspector {...inspectorProps} selectedWord="car" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Listen to British audio' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Audio unavailable');
  expect(screen.getByRole('button', { name: 'Listen to British audio' })).toHaveAttribute('aria-busy', 'false');
  view.rerender(<BritishInspector {...inspectorProps} selectedWord="bird" />);
  await screen.findByText('Definition of bird');
  expect(audio.pause).toHaveBeenCalled();
  expect(audio.removeAttribute).toHaveBeenCalledWith('src');
  expect(screen.queryByText(/Audio unavailable/)).not.toBeInTheDocument();
});

it('shows local meaning, part of speech and examples even with an AI result', async () => {
  vi.spyOn(apiClient, 'explainVocabulary').mockResolvedValue(mockVocabResponse);
  vi.spyOn(apiClient, 'getDictionaryEntry').mockResolvedValue({
    ...entry('simplistic'), definition_source: 'Princeton WordNet 3.0 (local)',
    senses: [{ part_of_speech: 'adjective', meaning: 'Misleadingly simple.', examples: ['A simplistic argument.'], lemma: 'simplistic' }],
  });
  render(<BritishInspector {...inspectorProps} selectedWord="simplistic" />);
  expect(await screen.findByRole('region', { name: 'Local dictionary meanings' })).toHaveTextContent('Misleadingly simple.');
  expect(screen.getByRole('region', { name: 'Local dictionary meanings' })).toHaveTextContent('adjective');
  expect(screen.getByText('“A simplistic argument.”')).toBeInTheDocument();
});

it('prioritises the contextual grammatical use and puts unrelated senses behind a disclosure', async () => {
  vi.spyOn(apiClient, 'explainVocabulary').mockResolvedValue({ ...mockVocabResponse, term: 'behind', part_of_speech: 'preposition' });
  vi.spyOn(apiClient, 'getDictionaryEntry').mockResolvedValue({ ...entry('behind'), senses: [
    { part_of_speech: 'noun', meaning: 'The part of the body you sit on.', examples: [], lemma: 'behind' },
    { part_of_speech: 'preposition', meaning: 'Responsible for the origin of something.', examples: ['Who is behind these memes?'], lemma: 'behind' },
  ] });
  render(<BritishInspector {...inspectorProps} selectedWord="behind" />);
  expect(await screen.findByText('Responsible for the origin of something.')).toBeVisible();
  expect(screen.getByText('The part of the body you sit on.')).not.toBeVisible();
  expect(screen.getByText('Other uses of this word')).toBeVisible();
});
