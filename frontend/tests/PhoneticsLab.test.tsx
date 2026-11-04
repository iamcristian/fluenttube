import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhoneticsLab } from '../src/components/PhoneticsLab';
import { request } from '../src/api/client';
import { splitReading } from '../src/components/phoneticsNavigation';
import { ArticulationPlate } from '../src/components/ArticulationPlate';
vi.mock('../src/api/client', () => ({ request: vi.fn(), phoneticsAudioUrl: (path: string) => '/api/phonetics' + path }));
vi.mock('../src/hooks/useRecorder', () => ({ useRecorder: () => ({ state: 'idle', isRecording: false, resetRecording: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === '/phonetics/catalog') return { catalog: [{ ipa: 'ɪ', category: 'Vowels', lesson_id: 'kit' }],
      lessons: [{ id: 'kit', ipa: 'ɪ', word: 'ship', name: 'KIT', guide_es: 'Guía', diagram: {kind:'vowel', points:[[.2,.2]], lips:'relaxed'} }] } as never;
    if (path === '/phonetics/reviews') return { items: [{ lesson_id: 'kit', attempts: 0, correct: 0, due: true, due_at: new Date().toISOString() }] } as never;
    if (path.endsWith('/answer')) return { correct: true, answer_ipa: 'ɪ', word: 'ship' } as never;
    return { id: 'opaque', options: [{ id: 'kit', ipa: 'ɪ' }, { id: 'fleece', ipa: 'iː' }] } as never;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps affricates and diphthongs together when entering the atlas from the inspector', () => {
  expect(splitReading('/dʒaɪg/', ['a','d','ʒ','ɡ','dʒ','aɪ'])).toEqual(['dʒ','aɪ','ɡ']);
});

it('distinguishes voicing for two sounds made at the same contact point', () => {
  const base = {kind:'consonant',place:'labiodental',manner:'fricative'} as const;
  const {rerender} = render(<ArticulationPlate ipa="f" model={{...base,voiced:false}} progress={0}/>);
  expect(screen.getByRole('img',{name:/Incisivos.*Sorda/})).toBeInTheDocument();
  rerender(<ArticulationPlate ipa="v" model={{...base,voiced:true}} progress={0}/>);
  expect(screen.getByRole('img',{name:/Incisivos.*Sonora/})).toBeInTheDocument();
});

it('opens a lesson, listens to an opaque quiz, answers and returns', async () => {
  const close = vi.fn();
  render(<PhoneticsLab onClose={close} />);
  await screen.findByText('/ɪ/ · ship');
  expect(screen.getByText(/Static pose/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Práctica de oído opcional/));
  fireEvent.click(screen.getByRole('button', { name: 'Start listening exercise' }));
  const option = await screen.findByRole('button', { name: '/iː/' });
  expect(option).toBeDisabled();
  const quiz = document.querySelector('audio[src$="/quizzes/opaque/audio"]')!;
  fireEvent.ended(quiz);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '/ɪ/' })));
  expect(await screen.findByText(/Correct. You heard/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Return to study' }));
  expect(close).toHaveBeenCalled();
});
