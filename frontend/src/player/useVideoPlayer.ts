import { useEffect, useRef, useState, useCallback } from 'react';
import { PlayerAdapter, PlayerError, PlayerState } from './types';
import { LocalVideoAdapter } from './LocalVideoAdapter';

export interface UseVideoPlayerOptions {
  containerRef: React.RefObject<HTMLDivElement>;
  videoId: string;
  mediaUrl?: string;
  onReady?: () => void;
  onError?: (error: PlayerError) => void;
  onStateChange?: (state: PlayerState) => void;
  customAdapter?: PlayerAdapter; // For testing
}

export interface UseVideoPlayerReturn {
  adapter: PlayerAdapter | null;
  isReady: boolean;
  isLoading: boolean;
  error: PlayerError | null;
  playerState: PlayerState;
  playbackRate: number;
  availablePlaybackRates: number[];
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
}

export function useVideoPlayer({
  containerRef,
  videoId,
  mediaUrl,
  onReady,
  onError,
  onStateChange,
  customAdapter,
}: UseVideoPlayerOptions): UseVideoPlayerReturn {
  const [adapter, setAdapter] = useState<PlayerAdapter | null>(() => customAdapter ?? null);
  const [isReady, setIsReady] = useState(() => !!customAdapter);
  const [isLoading, setIsLoading] = useState(() => !customAdapter);
  const [error, setError] = useState<PlayerError | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(PlayerState.UNSTARTED);
  const [playbackRate, setPlaybackRateState] = useState<number>(() =>
    customAdapter ? customAdapter.getPlaybackRate() : 1.0
  );
  const [availablePlaybackRates, setAvailablePlaybackRates] = useState<number[]>(() =>
    customAdapter ? customAdapter.getAvailablePlaybackRates() : [1.0]
  );

  const adapterRef = useRef<PlayerAdapter | null>(customAdapter ?? null);
  adapterRef.current = customAdapter ?? adapter;

  // If customAdapter is provided (in unit tests)
  useEffect(() => {
    if (customAdapter) {
      setAdapter(customAdapter);
      setIsLoading(false);
      setIsReady(true);

      const unsubs = [
        customAdapter.onReady(() => {
          setIsReady(true);
          setAvailablePlaybackRates(customAdapter.getAvailablePlaybackRates());
          if (onReady) onReady();
        }),
        customAdapter.onStateChange((state) => {
          setPlayerState(state);
          if (onStateChange) onStateChange(state);
        }),
        customAdapter.onPlaybackRateChange((rate) => {
          setPlaybackRateState(rate);
        }),
        customAdapter.onError((err) => {
          setError(err);
          if (onError) onError(err);
        }),
      ];

      return () => {
        unsubs.forEach((u) => u());
        customAdapter.destroy();
      };
    }
  }, [customAdapter, onReady, onStateChange, onError]);

  // Mount native playback and release it on cleanup.
  useEffect(() => {
    if (customAdapter) return;
    if (!containerRef.current) return;
    if (!mediaUrl) {
      setIsLoading(false);
      setIsReady(false);
      setError({ code: 'MEDIA_UNAVAILABLE', message: 'The original media is unavailable. Import a video file to practice with local playback.', videoUrl: '' });
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    const adapterInstance = new LocalVideoAdapter(mediaUrl);

    // Wire up event listeners
    const unsubs = [
      adapterInstance.onReady(() => {
        if (isCancelled) return;
        setIsReady(true);
        setIsLoading(false);
        setAvailablePlaybackRates(adapterInstance.getAvailablePlaybackRates());
        setPlaybackRateState(adapterInstance.getPlaybackRate());
        if (onReady) onReady();
      }),
      adapterInstance.onStateChange((state) => {
        if (isCancelled) return;
        setPlayerState(state);
        if (onStateChange) onStateChange(state);
      }),
      adapterInstance.onPlaybackRateChange((rate) => {
        if (isCancelled) return;
        setPlaybackRateState(rate);
      }),
      adapterInstance.onError((err) => {
        if (isCancelled) return;
        setError(err);
        setIsLoading(false);
        if (onError) onError(err);
      }),
    ];

    adapterInstance.mount(containerRef.current);
    setAdapter(adapterInstance);

    return () => {
      isCancelled = true;
      unsubs.forEach((u) => u());
      adapterInstance.destroy();
      setAdapter(null);
      setIsReady(false);
    };
  }, [videoId, mediaUrl, containerRef, customAdapter, onReady, onStateChange, onError]);

  const play = useCallback(() => {
    if (adapterRef.current) {
      adapterRef.current.play();
    }
  }, []);

  const pause = useCallback(() => {
    if (adapterRef.current) {
      adapterRef.current.pause();
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    if (adapterRef.current) {
      adapterRef.current.seekTo(seconds);
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (adapterRef.current) {
      adapterRef.current.setPlaybackRate(rate);
    }
  }, []);

  return {
    adapter,
    isReady,
    isLoading,
    error,
    playerState,
    playbackRate,
    availablePlaybackRates,
    play,
    pause,
    seekTo,
    setPlaybackRate,
  };
}
