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
  destroy(): void;

  // Event subscriptions
  onReady(listener: () => void): () => void;
  onStateChange(listener: (state: PlayerState) => void): () => void;
  onPlaybackRateChange(listener: (rate: number) => void): () => void;
  onError(listener: (error: PlayerError) => void): () => void;
}
