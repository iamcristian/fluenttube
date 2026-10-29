import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithQueryClient } from './testUtils';
import { DictationBox } from '../src/components/DictationBox';
import { apiClient } from '../src/api/client';
import { useStudyStore } from '../src/stores/useStudyStore';
import { SegmentDTO, SessionResponseDTO, DictationResultDTO } from '../src/api/types';

describe('DictationBox Component', () => {
  const sampleSegment: SegmentDTO = {
    id: 101,
    video_id: 1,
    position: 0,
    start_seconds: 0.0,
    end_seconds: 4.5,
    text: "I'm learning comprehensive vocabulary.",
    timing_quality: 'good',
    completed: false,
    revealed: false,
    shadowing_unlocked: false,
  };

  const mockSession: SessionResponseDTO = {
    id: 'sess-uuid-101',
    segment_id: 101,
    hinted_display_indices: [],
    answer_revealed: false,
    last_input: '',
    last_result: null,
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useStudyStore.getState().reset();
    useStudyStore.getState().setSession(101, mockSession);
    vi.spyOn(apiClient, 'createSession').mockResolvedValue(mockSession);
  });

  it('renders word slots with dashes capped at 8 and conceals answer text', async () => {
    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    // Answer text MUST NOT be visible anywhere prior to checking or revealing
    expect(screen.queryByText('comprehensive')).not.toBeInTheDocument();
    expect(screen.queryByText('vocabulary.')).not.toBeInTheDocument();

    // Word slots region exists and individual slot spans are capped at 8 dashes
    const slotsRegion = screen.getByRole('region', { name: /target sentence word placeholders/i });
    expect(slotsRegion).toBeInTheDocument();

    const slotSpans = slotsRegion.querySelectorAll('span');
    expect(slotSpans.length).toBe(4);
    slotSpans.forEach((span) => {
      expect(span.textContent?.length).toBeLessThanOrEqual(8);
    });
  });

  it('fetches and displays first-letter hint with Alt+H or Hint button', async () => {
    const hintSpy = vi.spyOn(apiClient, 'getHint').mockResolvedValue({
      display_token_index: 0,
      hint_letter: 'I',
      hinted_display_indices: [0],
    });

    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    const hintBtn = screen.getByRole('button', { name: /get hint/i });
    expect(hintBtn).toBeEnabled();

    // Click Hint button
    fireEvent.click(hintBtn);

    await waitFor(() => {
      expect(hintSpy).toHaveBeenCalledWith('sess-uuid-101', 0);
    });

    // Verify hinted word slot displays first letter followed by dashes
    const hintedSlot = await screen.findByLabelText(/word hint: starts with I/i);
    expect(hintedSlot).toBeInTheDocument();
    expect(hintedSlot.textContent).toContain('I');
  });

  it('reveals answer, displays full sentence, and unlocks shadowing', async () => {
    const revealSpy = vi.spyOn(apiClient, 'revealAnswer').mockResolvedValue({
      text: "I'm learning comprehensive vocabulary.",
      shadowing_unlocked: true,
      completed: false,
    });

    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    const revealBtn = screen.getByRole('button', { name: /reveal sentence/i });
    fireEvent.click(revealBtn);

    await waitFor(() => {
      expect(revealSpy).toHaveBeenCalledWith('sess-uuid-101');
    });

    // After reveal, full text is displayed in slots
    expect(await screen.findByText("I'm")).toBeInTheDocument();
    expect(screen.getByText('learning')).toBeInTheDocument();
    expect(screen.getByText('comprehensive')).toBeInTheDocument();
    expect(screen.getByText('vocabulary')).toBeInTheDocument();

    // "Next sentence" CTA button appears
    expect(screen.getByRole('button', { name: /advance to next/i })).toBeInTheDocument();
  });

  it('evaluates exact dictation, displays completed feedback and triggers onNext CTA', async () => {
    const exactResult: DictationResultDTO = {
      attempt_id: 1,
      is_exact: true,
      score: 100,
      distance: 0,
      completed: true,
      shadowing_unlocked: true,
      assisted: false,
      alignment: [
        { op: 'match', target_index: 0, input_index: 0 },
        { op: 'match', target_index: 1, input_index: 1 },
        { op: 'match', target_index: 2, input_index: 2 },
        { op: 'match', target_index: 3, input_index: 3 },
      ],
      rules_version: '1.0.0',
    };

    vi.spyOn(apiClient, 'checkDictation').mockResolvedValue(exactResult);
    const handleNext = vi.fn();

    renderWithQueryClient(<DictationBox segment={sampleSegment} onNext={handleNext} />);

    const textarea = screen.getByLabelText(/type what you hear/i);
    fireEvent.change(textarea, {
      target: { value: "I'm learning comprehensive vocabulary." },
    });

    const checkBtn = screen.getByRole('button', { name: /check sentence/i });
    expect(checkBtn).toBeEnabled();
    fireEvent.click(checkBtn);

    // Feedback shows "Dictation completed!"
    expect(await screen.findByText('Dictation completed!')).toBeInTheDocument();
    expect(screen.getByText('Score: 100%')).toBeInTheDocument();

    // Next sentence CTA button appears and triggers callback
    const nextCta = screen.getByRole('button', { name: /advance to next/i });
    fireEvent.click(nextCta);
    expect(handleNext).toHaveBeenCalledTimes(1);
  });

  it('handles Ctrl+Enter keyboard shortcut to submit dictation check', async () => {
    const checkSpy = vi.spyOn(apiClient, 'checkDictation').mockResolvedValue({
      attempt_id: 2,
      is_exact: false,
      score: 75,
      distance: 1,
      completed: false,
      shadowing_unlocked: false,
      assisted: false,
      alignment: [
        { op: 'match', target_index: 0, input_index: 0 },
        { op: 'match', target_index: 1, input_index: 1 },
        { op: 'substitution', target_index: 2, input_index: 2 },
        { op: 'match', target_index: 3, input_index: 3 },
      ],
      rules_version: '1.0.0',
    });

    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    const textarea = screen.getByLabelText(/type what you hear/i);
    fireEvent.change(textarea, { target: { value: "I'm learning wrong vocabulary." } });

    // Press Ctrl+Enter
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(checkSpy).toHaveBeenCalledWith(
        'sess-uuid-101',
        expect.objectContaining({
          input_text: "I'm learning wrong vocabulary.",
        })
      );
    });

    // Displays feedback with substitutions breakdown
    expect(await screen.findByText('Needs practice')).toBeInTheDocument();
    expect(screen.getByText(/Words to revisit: 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('clears green matching slots when user edits text after check (stale diff tracking)', async () => {
    const partialResult: DictationResultDTO = {
      attempt_id: 3,
      is_exact: false,
      score: 50,
      distance: 2,
      completed: false,
      shadowing_unlocked: false,
      assisted: false,
      alignment: [
        { op: 'match', target_index: 0, input_index: 0 },
        { op: 'match', target_index: 1, input_index: 1 },
        { op: 'omission', target_index: 2, input_index: null },
      ],
      rules_version: '1.0.0',
    };

    vi.spyOn(apiClient, 'checkDictation').mockResolvedValue(partialResult);

    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    const textarea = screen.getByLabelText(/type what you hear/i);
    fireEvent.change(textarea, { target: { value: "I'm" } });

    const checkBtn = screen.getByRole('button', { name: /check sentence/i });
    fireEvent.click(checkBtn);

    // After check, word 0 "I'm" is matched and displayed in green
    expect(await screen.findByText("I'm")).toBeInTheDocument();

    // Now edit text -> marks diff as stale
    fireEvent.change(textarea, { target: { value: "I'm thinking" } });

    // Green matched slot for "I'm" should clear immediately
    expect(screen.queryByText("I'm")).not.toBeInTheDocument();
  });

  it('creates fresh practice session when clicking Try again', async () => {
    const newSession: SessionResponseDTO = {
      id: 'sess-uuid-fresh-999',
      segment_id: 101,
      hinted_display_indices: [],
      answer_revealed: false,
      last_input: '',
      last_result: null,
      created_at: new Date().toISOString(),
    };

    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    // Set initial result in store to show "Try again"
    act(() => {
      useStudyStore.getState().setResult(101, {
        attempt_id: 4,
        is_exact: false,
        score: 50,
        distance: 2,
        completed: false,
        shadowing_unlocked: false,
        assisted: false,
        alignment: [],
        rules_version: '1.0.0',
      });
      useStudyStore.getState().setDraft(101, 'Some wrong input');
    });

    const tryAgainBtn = await screen.findByRole('button', { name: /try again/i });
    vi.spyOn(apiClient, 'createSession').mockResolvedValue(newSession);

    fireEvent.click(tryAgainBtn);

    await waitFor(() => {
      expect(apiClient.createSession).toHaveBeenCalledWith(101);
    });

    // Draft is cleared
    const textarea = screen.getByLabelText(/type what you hear/i);
    expect(textarea).toHaveValue('');
  });

  it('opens and closes keyboard shortcuts modal via button and Esc key', async () => {
    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    const shortcutsBtn = screen.getByRole('button', { name: /view keyboard shortcuts/i });
    fireEvent.click(shortcutsBtn);

    // Shortcuts modal opens
    expect(screen.getByRole('heading', { name: /keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.getByText('Replay current sentence')).toBeInTheDocument();
    expect(screen.getByText('Alt+R')).toBeInTheDocument();

    // Press Escape to close modal
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
    });
  });

  it('initializes session automatically when store is empty and does not drop session (F-01)', async () => {
    // Reset store to empty
    useStudyStore.getState().reset();

    const mockSession: SessionResponseDTO = {
      id: 'fresh-sess-101',
      segment_id: 101,
      answer_revealed: false,
      hinted_display_indices: [],
      last_input: '',
      last_result: null,
      created_at: new Date().toISOString(),
    };
    vi.spyOn(apiClient, 'createSession').mockResolvedValue(mockSession);

    renderWithQueryClient(<DictationBox segment={sampleSegment} />);

    await waitFor(() => {
      expect(apiClient.createSession).toHaveBeenCalledWith(101);
      expect(useStudyStore.getState().sessions[101]).toEqual(mockSession);
    });
  });

  it('conceals target words when Try Again is clicked on a revealed segment (F-04)', async () => {
    useStudyStore.getState().reset();

    const revealedSegment: SegmentDTO = {
      ...sampleSegment,
      revealed: true,
      completed: false,
    };

    const initialSession: SessionResponseDTO = {
      id: 'sess-revealed-1',
      segment_id: 101,
      answer_revealed: true,
      hinted_display_indices: [],
      last_input: '',
      last_result: null,
      created_at: new Date().toISOString(),
    };
    useStudyStore.getState().setSession(101, initialSession);

    const freshSession: SessionResponseDTO = {
      id: 'sess-fresh-2',
      segment_id: 101,
      answer_revealed: false,
      hinted_display_indices: [],
      last_input: '',
      last_result: null,
      created_at: new Date().toISOString(),
    };
    vi.spyOn(apiClient, 'createSession').mockResolvedValue(freshSession);

    renderWithQueryClient(<DictationBox segment={revealedSegment} />);

    // Initially, because session is revealed, actual words are displayed
    expect(screen.getByText('comprehensive')).toBeInTheDocument();

    // Click Try Again
    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    await act(async () => {
      fireEvent.click(tryAgainBtn);
    });

    await waitFor(() => {
      expect(apiClient.createSession).toHaveBeenCalledWith(101);
    });

    // After clicking Try Again, the answer must be CONCEALED (dashes shown, target word hidden)
    expect(screen.queryByText('comprehensive')).not.toBeInTheDocument();
    expect(useStudyStore.getState().retryingSegmentId).toBe(101);
  });
});
