import { PlayerAdapter, PlayerError, PlayerState } from './types';
import { formatYouTubeError } from './YouTubePlayerAdapter';

export class FakePlayerAdapter implements PlayerAdapter {
  videoId: string;
  currentTime = 0;
  duration = 100;
  state: PlayerState = PlayerState.UNSTARTED;
  playbackRate = 1.0;
  availablePlaybackRates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  isDestroyed = false;

  // Spies / Call trackers for assertions
  playCalls = 0;
  pauseCalls = 0;
  seekCalls: Array<{ seconds: number; allowSeekAhead?: boolean }> = [];
  setRateCalls: number[] = [];
  cuedVideos: Array<{ videoId: string; startSeconds?: number }> = [];
  loadedVideos: Array<{ videoId: string; startSeconds?: number }> = [];

  private readyListeners: Array<() => void> = [];
  private stateChangeListeners: Array<(state: PlayerState) => void> = [];
  private playbackRateListeners: Array<(rate: number) => void> = [];
  private errorListeners: Array<(error: PlayerError) => void> = [];

  constructor(videoId: string = 'test-video-id') {
    this.videoId = videoId;
  }

  play(): void {
    if (this.isDestroyed) return;
    this.playCalls++;
    this.state = PlayerState.PLAYING;
    this.emitStateChange(PlayerState.PLAYING);
  }

  pause(): void {
    if (this.isDestroyed) return;
    this.pauseCalls++;
    this.state = PlayerState.PAUSED;
    this.emitStateChange(PlayerState.PAUSED);
  }

  seekTo(seconds: number, allowSeekAhead?: boolean): void {
    if (this.isDestroyed) return;
    this.seekCalls.push({ seconds, allowSeekAhead });
    this.currentTime = seconds;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.duration;
  }

  getState(): PlayerState {
    return this.state;
  }

  getAvailablePlaybackRates(): number[] {
    return this.availablePlaybackRates;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  setPlaybackRate(rate: number): void {
    if (this.isDestroyed) return;
    this.setRateCalls.push(rate);
    this.playbackRate = rate;
    this.emitPlaybackRateChange(rate);
  }

  cueVideoById(videoId: string, startSeconds: number = 0): void {
    if (this.isDestroyed) return;
    this.videoId = videoId;
    this.currentTime = startSeconds;
    this.state = PlayerState.CUED;
    this.cuedVideos.push({ videoId, startSeconds });
    this.emitStateChange(PlayerState.CUED);
  }

  loadVideoById(videoId: string, startSeconds: number = 0): void {
    if (this.isDestroyed) return;
    this.videoId = videoId;
    this.currentTime = startSeconds;
    this.state = PlayerState.PLAYING;
    this.loadedVideos.push({ videoId, startSeconds });
    this.emitStateChange(PlayerState.PLAYING);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.readyListeners = [];
    this.stateChangeListeners = [];
    this.playbackRateListeners = [];
    this.errorListeners = [];
  }

  // Event Subscriptions
  onReady(listener: () => void): () => void {
    this.readyListeners.push(listener);
    return () => {
      this.readyListeners = this.readyListeners.filter((l) => l !== listener);
    };
  }

  onStateChange(listener: (state: PlayerState) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== listener);
    };
  }

  onPlaybackRateChange(listener: (rate: number) => void): () => void {
    this.playbackRateListeners.push(listener);
    return () => {
      this.playbackRateListeners = this.playbackRateListeners.filter((l) => l !== listener);
    };
  }

  onError(listener: (error: PlayerError) => void): () => void {
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    };
  }

  // Simulation & Event Emission Helpers
  emitReady(): void {
    this.readyListeners.forEach((l) => l());
  }

  simulateReady(): void {
    this.emitReady();
  }

  emitStateChange(state: PlayerState): void {
    this.state = state;
    this.stateChangeListeners.forEach((l) => l(state));
  }

  simulateStateChange(state: PlayerState): void {
    this.emitStateChange(state);
  }

  emitPlaybackRateChange(rate: number): void {
    this.playbackRate = rate;
    this.playbackRateListeners.forEach((l) => l(rate));
  }

  simulatePlaybackRateChange(rate: number): void {
    this.emitPlaybackRateChange(rate);
  }

  emitError(errorCode: number): void {
    const error = formatYouTubeError(errorCode, this.videoId);
    this.errorListeners.forEach((l) => l(error));
  }

  simulateError(errorCode: number): void {
    this.emitError(errorCode);
  }
}
