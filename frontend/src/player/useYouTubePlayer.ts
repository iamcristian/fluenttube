import { useEffect, useRef, useState, useCallback } from 'react';
import { PlayerAdapter, PlayerError, PlayerState } from './types';
import { YouTubePlayerAdapter } from './YouTubePlayerAdapter';
import { loadYouTubeIframeApi } from './youtubeApiLoader';

export interface UseYouTubePlayerOptions {
  containerRef: React.RefObject<HTMLDivElement>;
  videoId: string;
  onReady?: () => void;
  onError?: (error: PlayerError) => void;
  onStateChange?: (state: PlayerState) => void;
  customAdapter?: PlayerAdapter; // For testing
}

export interface UseYouTubePlayerReturn {
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

export function useYouTubePlayer({
  containerRef,
  videoId,
  onReady,
  onError,
  onStateChange,
  customAdapter,
}: UseYouTubePlayerOptions): UseYouTubePlayerReturn {
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

  // Track previous videoId to handle video changes
  const prevVideoIdRef = useRef<string>(videoId);
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

  // Main YouTube Player initialization under React StrictMode
  useEffect(() => {
    if (customAdapter) return;
    if (!containerRef.current || !videoId) return;

    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    const adapterInstance = new YouTubePlayerAdapter(videoId);

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

    // Load API and instantiate
    loadYouTubeIframeApi()
      .then(() => {
        if (isCancelled || !containerRef.current || !window.YT) {
          return;
        }

        // Create DOM element for iframe mount inside container
        const targetElement = document.createElement('div');
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(targetElement);

        const nativePlayer = new window.YT.Player(targetElement, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 1,
            origin: window.location.origin,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            fs: 1,
          },
          events: {
            onReady: () => {
              adapterInstance.emitReady();
            },
            onStateChange: (event: { data: number }) => {
              adapterInstance.emitStateChange(event.data);
            },
            onPlaybackRateChange: (event: { data: number }) => {
              adapterInstance.emitPlaybackRateChange(event.data);
            },
            onError: (event: { data: number }) => {
              adapterInstance.emitError(event.data);
            },
          },
        });

        adapterInstance.setNativePlayer(nativePlayer);
        setAdapter(adapterInstance);
      })
      .catch((err) => {
        if (isCancelled) return;
        setIsLoading(false);
        setError({
          code: 'API_LOAD_FAILED',
          message: err instanceof Error ? err.message : 'Failed to load YouTube API.',
          isEmbedRestricted: false,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        });
      });

    return () => {
      isCancelled = true;
      unsubs.forEach((u) => u());
      adapterInstance.destroy();
      setAdapter(null);
      setIsReady(false);
    };
  }, [videoId, containerRef, customAdapter, onReady, onStateChange, onError]);

  // Handle switching videoId on an existing ready player instance
  useEffect(() => {
    if (adapterRef.current && prevVideoIdRef.current !== videoId) {
      prevVideoIdRef.current = videoId;
      setError(null);
      // cue video without autoplay
      adapterRef.current.cueVideoById(videoId);
    }
  }, [videoId]);

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
