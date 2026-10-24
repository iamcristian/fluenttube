import { useEffect, useRef, useState, useCallback } from 'react';
import { PlayerAdapter, PlayerState } from './types';

export const POLL_INTERVAL_MS = 50;
export const BASE_CUTOFF_PADDING_SECONDS = 0.12;
export const SEEK_GUARD_TIMEOUT_MS = 2000;

export interface SegmentBounds {
  start_seconds: number;
  end_seconds: number;
}

export interface CutoffCalculationResult {
  cutoff: number;
  hasCoarseTimingNotice: boolean;
}

/**
 * Pure function to calculate cutoff timestamp per Section 9 Rule 7:
 * - Base cutoff: end + 0.12s.
 * - If subsequent segment starts after current end, clamp padding to next start.
 * - If segments overlap (next starts before current ends), cut off strictly at
 *   original end and flag coarse timing notice.
 */
export function calculateCutoff(
  segment: SegmentBounds,
  nextSegment?: SegmentBounds | null
): CutoffCalculationResult {
  if (!nextSegment) {
    return {
      cutoff: Number((segment.end_seconds + BASE_CUTOFF_PADDING_SECONDS).toFixed(3)),
      hasCoarseTimingNotice: false,
    };
  }

  // Overlapping segments: cut off strictly at current segment end
  if (nextSegment.start_seconds < segment.end_seconds) {
    return {
      cutoff: Number(segment.end_seconds.toFixed(3)),
      hasCoarseTimingNotice: true,
    };
  }

  // Next segment starts before base padding expires: clamp to next segment start
  const potentialCutoff = segment.end_seconds + BASE_CUTOFF_PADDING_SECONDS;
  if (nextSegment.start_seconds < potentialCutoff) {
    return {
      cutoff: Number(nextSegment.start_seconds.toFixed(3)),
      hasCoarseTimingNotice: false,
    };
  }

  return {
    cutoff: Number(potentialCutoff.toFixed(3)),
    hasCoarseTimingNotice: false,
  };
}

export interface UseSegmentPlaybackOptions {
  player: PlayerAdapter | null;
  segment: SegmentBounds | null;
  nextSegment?: SegmentBounds | null;
  initialLoop?: boolean;
  onCutoffReached?: () => void;
  onManualScrubDetected?: () => void;
}

export interface UseSegmentPlaybackReturn {
  playSegment: () => void;
  pauseSegment: () => void;
  replaySegment: () => void;
  isLooping: boolean;
  setIsLooping: (loop: boolean) => void;
  isSegmentPlaying: boolean;
  isSeeking: boolean;
  isManualScrubbed: boolean;
  resetScrubbedState: () => void;
  cutoff: number;
  hasCoarseTimingNotice: boolean;
}

export function useSegmentPlayback({
  player,
  segment,
  nextSegment,
  initialLoop = false,
  onCutoffReached,
  onManualScrubDetected,
}: UseSegmentPlaybackOptions): UseSegmentPlaybackReturn {
  const [isLooping, setIsLooping] = useState(initialLoop);
  const [isSegmentPlaying, setIsSegmentPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isManualScrubbed, setIsManualScrubbed] = useState(false);

  // References to avoid stale closures in polling timer
  const generationIdRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSeekingRef = useRef<boolean>(false);
  const seekStartTimeRef = useRef<number>(0);
  const isLoopingRef = useRef<boolean>(isLooping);
  isLoopingRef.current = isLooping;

  const segmentRef = useRef<SegmentBounds | null>(segment);
  segmentRef.current = segment;

  const nextSegmentRef = useRef<SegmentBounds | null | undefined>(nextSegment);
  nextSegmentRef.current = nextSegment;

  const onCutoffReachedRef = useRef(onCutoffReached);
  onCutoffReachedRef.current = onCutoffReached;

  const onManualScrubDetectedRef = useRef(onManualScrubDetected);
  onManualScrubDetectedRef.current = onManualScrubDetected;

  // Calculate cutoff
  const { cutoff, hasCoarseTimingNotice } = segment
    ? calculateCutoff(segment, nextSegment)
    : { cutoff: 0, hasCoarseTimingNotice: false };

  const cutoffRef = useRef<number>(cutoff);
  cutoffRef.current = cutoff;

  // Clear monitoring timer safely
  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const initialSeekPendingRef = useRef<boolean>(false);

  // Monitor playback tick
  const checkPlaybackTick = useCallback(
    (generationId: number) => {
      if (generationId !== generationIdRef.current || !player || !segmentRef.current) {
        return;
      }

      const currentState = player.getState();

      // Rule 11: In BUFFERING or non-PLAYING state, suspend/ignore cutoff decisions
      if (currentState === PlayerState.BUFFERING) {
        return;
      }
      if (currentState !== PlayerState.PLAYING) {
        setIsSegmentPlaying(false);
        stopTimer();
        return;
      }

      setIsSegmentPlaying(true);
      const currentTime = player.getCurrentTime();
      const currentCutoff = cutoffRef.current;
      const startSeconds = segmentRef.current.start_seconds;

      // Rule 9: Seeking guard clearance (for loop mode and replay)
      if (isSeekingRef.current) {
        const timeSinceSeek = Date.now() - seekStartTimeRef.current;

        // Disengage guard once reported timestamp enters the segment interval before cutoff
        if (currentTime >= startSeconds - 0.25 && currentTime < currentCutoff - 0.1) {
          isSeekingRef.current = false;
          setIsSeeking(false);
        } else if (timeSinceSeek > SEEK_GUARD_TIMEOUT_MS) {
          // If guard does not clear within 2s, pause playback to prevent runaway seek loops
          isSeekingRef.current = false;
          setIsSeeking(false);
          player.pause();
          setIsSegmentPlaying(false);
          stopTimer();
          return;
        } else {
          // While seeking guard is engaged, do not issue duplicate seeks or cutoff actions
          return;
        }
      }

      // Handle async seek landing for playSegment
      if (initialSeekPendingRef.current) {
        if (currentTime >= startSeconds - 0.3) {
          initialSeekPendingRef.current = false;
        } else {
          return;
        }
      }

      // Rule 14: Manual scrub detection outside segment bounds
      // If user scrubbed noticeably before start or past cutoff + 1.0s
      if (
        !isSeekingRef.current &&
        (currentTime < startSeconds - 1.5 || currentTime > currentCutoff + 1.0)
      ) {
        setIsManualScrubbed(true);
        stopTimer();
        if (onManualScrubDetectedRef.current) {
          onManualScrubDetectedRef.current();
        }
        return;
      }

      // Reached cutoff timestamp (Rule 8 & 9)
      if (currentTime >= currentCutoff) {
        if (onCutoffReachedRef.current) {
          onCutoffReachedRef.current();
        }

        if (isLoopingRef.current) {
          // Loop mode: engage seeking guard and seek back to start
          isSeekingRef.current = true;
          setIsSeeking(true);
          seekStartTimeRef.current = Date.now();
          player.seekTo(startSeconds, true);
        } else {
          // Normal mode: pause and hold playhead; do not issue pause+seek commands
          player.pause();
          setIsSegmentPlaying(false);
          stopTimer();
        }
      }
    },
    [player, stopTimer]
  );

  // Start polling timer
  const startTimer = useCallback(
    (generationId: number) => {
      stopTimer();
      timerRef.current = setInterval(() => {
        checkPlaybackTick(generationId);
      }, POLL_INTERVAL_MS);
    },
    [stopTimer, checkPlaybackTick]
  );

  // Auto-monitor whenever player enters PLAYING state (e.g. from YouTube iframe click or spacebar)
  useEffect(() => {
    if (!player) return;

    const unsub = player.onStateChange((state) => {
      if (state === PlayerState.PLAYING) {
        setIsSegmentPlaying(true);
        setIsManualScrubbed(false);
        if (timerRef.current === null && segmentRef.current) {
          const gen = ++generationIdRef.current;
          startTimer(gen);
        }
      } else if (state === PlayerState.PAUSED || state === PlayerState.ENDED) {
        setIsSegmentPlaying(false);
        stopTimer();
      }
    });

    return () => {
      unsub();
      stopTimer();
    };
  }, [player, startTimer, stopTimer]);

  // Play segment action (Rule 5)
  const playSegment = useCallback(() => {
    if (!player || !segmentRef.current) return;

    stopTimer();
    setIsManualScrubbed(false);
    isSeekingRef.current = false;
    setIsSeeking(false);

    const currentTime = player.getCurrentTime();
    const startSeconds = segmentRef.current.start_seconds;

    // If playhead is outside segment, seek to start first
    if (currentTime < startSeconds - 0.2 || currentTime >= cutoffRef.current) {
      initialSeekPendingRef.current = true;
      player.seekTo(startSeconds, true);
    } else {
      initialSeekPendingRef.current = false;
    }

    player.play();
    setIsSegmentPlaying(true);
    if (timerRef.current === null) {
      const gen = ++generationIdRef.current;
      startTimer(gen);
    }
  }, [player, startTimer, stopTimer]);

  // Pause segment action
  const pauseSegment = useCallback(() => {
    if (!player) return;
    player.pause();
    setIsSegmentPlaying(false);
    stopTimer();
  }, [player, stopTimer]);

  // Replay segment action (Rule 5 & 8)
  const replaySegment = useCallback(() => {
    if (!player || !segmentRef.current) return;

    stopTimer();
    setIsManualScrubbed(false);
    isSeekingRef.current = true;
    setIsSeeking(true);
    seekStartTimeRef.current = Date.now();

    player.seekTo(segmentRef.current.start_seconds, true);
    player.play();
    setIsSegmentPlaying(true);
    if (timerRef.current === null) {
      const gen = ++generationIdRef.current;
      startTimer(gen);
    }
  }, [player, startTimer, stopTimer]);

  const resetScrubbedState = useCallback(() => {
    setIsManualScrubbed(false);
  }, []);

  // Rule 10: Invalidate active callbacks and cue playhead on segment change
  const prevSegmentKeyRef = useRef<string | null>(null);
  useEffect(() => {
    generationIdRef.current++;
    stopTimer();
    setIsSegmentPlaying(false);
    setIsSeeking(false);
    isSeekingRef.current = false;
    setIsManualScrubbed(false);

    if (player && segment != null) {
      const segKey = `${segment.start_seconds}_${segment.end_seconds}`;
      if (prevSegmentKeyRef.current !== null && prevSegmentKeyRef.current !== segKey) {
        try {
          player.pause();
          player.seekTo(segment.start_seconds, true);
        } catch {}
      }
      prevSegmentKeyRef.current = segKey;
    }
  }, [player, segment?.start_seconds, segment?.end_seconds, stopTimer]);

  // Rule 12: Pause playback and cancel monitoring when browser tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        if (player && player.getState() === PlayerState.PLAYING) {
          player.pause();
        }
        setIsSegmentPlaying(false);
        stopTimer();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [player, stopTimer]);

  // Teardown on unmount
  useEffect(() => {
    return () => {
      generationIdRef.current++;
      stopTimer();
    };
  }, [stopTimer]);

  return {
    playSegment,
    pauseSegment,
    replaySegment,
    isLooping,
    setIsLooping,
    isSegmentPlaying,
    isSeeking,
    isManualScrubbed,
    resetScrubbedState,
    cutoff,
    hasCoarseTimingNotice,
  };
}
