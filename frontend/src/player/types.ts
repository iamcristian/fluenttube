export enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

export interface PlayerError {
  code: number | string;
  message: string;
  isEmbedRestricted: boolean;
  videoUrl: string;
}

export interface PlayerAdapter {
  play(): Promise<void> | void;
  pause(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): PlayerState;
  getAvailablePlaybackRates(): number[];
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  loadVideoById(videoId: string, startSeconds?: number): void;
  destroy(): void;

  // Event subscriptions
  onReady(listener: () => void): () => void;
  onStateChange(listener: (state: PlayerState) => void): () => void;
  onPlaybackRateChange(listener: (rate: number) => void): () => void;
  onError(listener: (error: PlayerError) => void): () => void;
}

// Global declaration for YouTube IFrame API window objects
declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId?: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: unknown }) => void;
            onStateChange?: (event: { data: number }) => void;
            onPlaybackRateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => unknown;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
