import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateCutoff,
  useSegmentPlayback,
  POLL_INTERVAL_MS,
  SEEK_GUARD_TIMEOUT_MS,
} from '../src/player/useSegmentPlayback';
import { FakePlayerAdapter } from '../src/player/FakePlayerAdapter';
import { PlayerState } from '../src/player/types';

describe('calculateCutoff (Section 9 Rule 7)', () => {
  it('adds base padding 0.12s when no next segment exists', () => {
    const res = calculateCutoff({ start_seconds: 0.0, end_seconds: 3.0 });
    expect(res.cutoff).toBe(3.12);
    expect(res.hasCoarseTimingNotice).toBe(false);
  });

  it('adds base padding 0.12s when next segment starts after end + 0.12s', () => {
    const res = calculateCutoff(
      { start_seconds: 0.0, end_seconds: 3.0 },
      { start_seconds: 4.5, end_seconds: 7.0 }
    );
    expect(res.cutoff).toBe(3.12);
    expect(res.hasCoarseTimingNotice).toBe(false);
  });

  it('clamps padding to next segment start when next segment starts between end and end + 0.12s', () => {
    const res = calculateCutoff(
      { start_seconds: 0.0, end_seconds: 3.0 },
      { start_seconds: 3.06, end_seconds: 6.0 }
    );
    expect(res.cutoff).toBe(3.06);
    expect(res.hasCoarseTimingNotice).toBe(false);
  });

  it('cuts off strictly at current end and flags coarse timing notice when segments overlap', () => {
    const res = calculateCutoff(
      { start_seconds: 0.0, end_seconds: 3.0 },
      { start_seconds: 2.8, end_seconds: 5.5 }
    );
    expect(res.cutoff).toBe(3.0);
    expect(res.hasCoarseTimingNotice).toBe(true);
  });
});

describe('useSegmentPlayback Temporal Control (Section 9)', () => {
  let fakePlayer: FakePlayerAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    fakePlayer = new FakePlayerAdapter('test-playback-vid');
  });

  afterEach(() => {
    vi.useRealTimers();
    fakePlayer.destroy();
  });

  it('normal mode: halts on the first tick >= cutoff, pauses, and holds playhead', () => {
    const onCutoff = vi.fn();
    const { result } = renderHook(() =>
      useSegmentPlayback({
        player: fakePlayer,
        segment: { start_seconds: 1.0, end_seconds: 4.0 }, // cutoff = 4.12
        initialLoop: false,
        onCutoffReached: onCutoff,
      })
    );

    // Initial state: playhead at segment start (1.0)
    fakePlayer.currentTime = 1.0;
    act(() => {
      result.current.playSegment();
    });

    expect(fakePlayer.playCalls).toBe(1);
    expect(result.current.isSegmentPlaying).toBe(true);
    expect(result.current.cutoff).toBe(4.12);

    // Advance time while playhead is within segment bounds
    fakePlayer.currentTime = 2.5;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 5); // 250ms
    });
    expect(fakePlayer.pauseCalls).toBe(0);
    expect(onCutoff).not.toHaveBeenCalled();

    // Advance playhead right before cutoff (4.10)
    fakePlayer.currentTime = 4.1;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(fakePlayer.pauseCalls).toBe(0);

    // Cross cutoff timestamp (4.12)
    fakePlayer.currentTime = 4.15;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    // Verified: paused on first tick >= cutoff, playhead held there without immediate seek
    expect(onCutoff).toHaveBeenCalledTimes(1);
    expect(fakePlayer.pauseCalls).toBe(1);
    expect(result.current.isSegmentPlaying).toBe(false);
    expect(fakePlayer.seekCalls.length).toBe(0); // No immediate seek back in normal mode

    // Replay seeks back to start and plays
    act(() => {
      result.current.replaySegment();
    });
    expect(fakePlayer.seekCalls).toEqual([{ seconds: 1.0, allowSeekAhead: true }]);
    expect(fakePlayer.playCalls).toBe(2);
  });

  it('loop mode: seeks back to start and prevents duplicate seek commands via seeking guard', () => {
    const onCutoff = vi.fn();
    const { result } = renderHook(() =>
      useSegmentPlayback({
        player: fakePlayer,
        segment: { start_seconds: 2.0, end_seconds: 5.0 }, // cutoff = 5.12
        initialLoop: true,
        onCutoffReached: onCutoff,
      })
    );

    fakePlayer.currentTime = 2.0;
    act(() => {
      result.current.playSegment();
    });

    // Playhead reaches cutoff
    fakePlayer.currentTime = 5.15;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    // Initial seek back to 2.0
    expect(fakePlayer.seekCalls.length).toBe(1);
    expect(fakePlayer.seekCalls[0].seconds).toBe(2.0);
    expect(result.current.isSeeking).toBe(true);

    // Next tick: simulate slow API response where currentTime is still reported as 5.15
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    // Seeking guard prevents duplicate seek!
    expect(fakePlayer.seekCalls.length).toBe(1);

    // API finally reports returned timestamp (2.05s)
    fakePlayer.currentTime = 2.05;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    // Seeking guard disengaged
    expect(result.current.isSeeking).toBe(false);
  });

  it('loop mode: halts runaway seek loop if guard does not clear within 2 seconds', () => {
    const { result } = renderHook(() =>
      useSegmentPlayback({
        player: fakePlayer,
        segment: { start_seconds: 1.0, end_seconds: 3.0 },
        initialLoop: true,
      })
    );

    // Prevent immediate currentTime update in seekTo to simulate hung/frozen seek
    fakePlayer.seekTo = (seconds, allowSeekAhead) => {
      fakePlayer.seekCalls.push({ seconds, allowSeekAhead });
    };

    fakePlayer.currentTime = 1.0;
    act(() => {
      result.current.playSegment();
    });

    // Cross cutoff (3.12)
    fakePlayer.currentTime = 3.2;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(result.current.isSeeking).toBe(true);
    expect(fakePlayer.seekCalls.length).toBe(1);

    // Advance past SEEK_GUARD_TIMEOUT_MS (2000ms) with currentTime remaining frozen at 3.2
    act(() => {
      vi.advanceTimersByTime(SEEK_GUARD_TIMEOUT_MS + 100);
    });

    // Guard cleared and playback paused to prevent runaway seek loop
    expect(result.current.isSeeking).toBe(false);
    expect(fakePlayer.pauseCalls).toBe(1);
    expect(result.current.isSegmentPlaying).toBe(false);
  });

  it('switching segments mid-playback invalidates active generation_id and stops timer', () => {
    const onCutoff = vi.fn();
    const { result, rerender } = renderHook(
      ({ seg }) =>
        useSegmentPlayback({
          player: fakePlayer,
          segment: seg,
          onCutoffReached: onCutoff,
        }),
      {
        initialProps: { seg: { start_seconds: 0.0, end_seconds: 2.0 } },
      }
    );

    act(() => {
      result.current.playSegment();
    });
    expect(result.current.isSegmentPlaying).toBe(true);

    // Change segment to segment 2
    rerender({ seg: { start_seconds: 5.0, end_seconds: 8.0 } });

    // Segment change immediately pauses segment playing flag
    expect(result.current.isSegmentPlaying).toBe(false);

    // Ticks at old cutoff (2.12) should be completely ignored
    fakePlayer.currentTime = 2.15;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(onCutoff).not.toHaveBeenCalled();
  });

  it('suspends cutoff decisions while player is in BUFFERING state', () => {
    const onCutoff = vi.fn();
    const { result } = renderHook(() =>
      useSegmentPlayback({
        player: fakePlayer,
        segment: { start_seconds: 0.0, end_seconds: 2.0 },
        onCutoffReached: onCutoff,
      })
    );

    act(() => {
      result.current.playSegment();
    });

    // Transition to buffering state
    fakePlayer.state = PlayerState.BUFFERING;
    fakePlayer.currentTime = 2.5; // Stale timestamp past cutoff
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
    });

    // No cutoff action taken during buffering
    expect(onCutoff).not.toHaveBeenCalled();
    expect(fakePlayer.pauseCalls).toBe(0);
  });

  it('detects manual scrubbing outside segment bounds and halts loop control', () => {
    const onScrub = vi.fn();
    const { result } = renderHook(() =>
      useSegmentPlayback({
        player: fakePlayer,
        segment: { start_seconds: 10.0, end_seconds: 15.0 }, // cutoff = 15.12
        onManualScrubDetected: onScrub,
      })
    );

    act(() => {
      result.current.playSegment();
    });

    // User scrubs far outside bounds (e.g. at 25.0s)
    fakePlayer.currentTime = 25.0;
    act(() => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });

    expect(result.current.isManualScrubbed).toBe(true);
    expect(onScrub).toHaveBeenCalledTimes(1);

    // Calling resetScrubbedState clears the state
    act(() => {
      result.current.resetScrubbedState();
    });
    expect(result.current.isManualScrubbed).toBe(false);
  });

  it('pauses playback when browser tab visibility becomes hidden', () => {
    renderHook(() =>
      useSegmentPlayback({
        player: fakePlayer,
        segment: { start_seconds: 0.0, end_seconds: 3.0 },
      })
    );

    fakePlayer.state = PlayerState.PLAYING;

    // Simulate tab hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(fakePlayer.pauseCalls).toBe(1);

    // Restore document.hidden
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
