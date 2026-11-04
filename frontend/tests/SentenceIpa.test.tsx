import { screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { SentenceIpa } from '../src/components/SentenceIpa';
import { apiClient } from '../src/api/client';
import { SentenceIpaDTO } from '../src/api/types';

afterEach(() => vi.restoreAllMocks());

describe('British sentence practice guide', () => {
  it('keeps unknown words and alternative readings explicit', async () => {
    vi.spyOn(apiClient, 'getSentenceIpa').mockResolvedValue({ segment_id: 1, words: [
      { text: 'read', readings: ['/riːd/', '/red/'] }, { text: 'MissingName', readings: [] },
    ] });
    renderWithQueryClient(<SentenceIpa segmentId={1} text="read MissingName" />);
    expect(await screen.findByText(/Words in brackets/)).toBeInTheDocument();
    expect(screen.getByLabelText('Sentence pronunciation')).toHaveTextContent('riːd [MissingName]');
    expect(screen.getByLabelText('Sentence pronunciation')).not.toHaveTextContent('|');
    expect(screen.queryByRole('combobox')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Choose pronunciation for read' });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(screen.getByLabelText('Sentence pronunciation')).toHaveTextContent('red [MissingName]');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('never shows a late guide for the previous sentence', async () => {
    let finish!: (value: SentenceIpaDTO) => void;
    vi.spyOn(apiClient, 'getSentenceIpa').mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ segment_id: 2, words: [{ text: 'new', readings: ['/njuː/'] }] });
    const view = renderWithQueryClient(<SentenceIpa segmentId={1} text="old" />);
    view.rerender(<SentenceIpa segmentId={2} text="new" />);
    await screen.findByText(/njuː/);
    await act(async () => finish({ segment_id: 1, words: [{ text: 'old', readings: ['/əʊld/'] }] }));
    expect(screen.getByLabelText('British IPA practice guide')).not.toHaveTextContent('əʊld');
  });
});

it('keeps selections separate between sentences and closes choices with Escape', async () => {
  vi.spyOn(apiClient, 'getSentenceIpa').mockImplementation(async segmentId => ({ segment_id: segmentId, words: [{ text: 'read', readings: ['/riːd/', '/red/'] }] }));
  const view = renderWithQueryClient(<SentenceIpa segmentId={1} text="read" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Choose pronunciation for read' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
  view.rerender(<SentenceIpa segmentId={2} text="read" />);
  await screen.findByRole('button', { name: 'Choose pronunciation for read' });
  expect(screen.getByLabelText('Sentence pronunciation')).toHaveTextContent('riːd');
  fireEvent.click(screen.getByRole('button', { name: 'Choose pronunciation for read' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('combobox')).toBeNull();
  view.rerender(<SentenceIpa segmentId={1} text="read" />);
  expect(await screen.findByLabelText('Sentence pronunciation')).toHaveTextContent('red');
});
