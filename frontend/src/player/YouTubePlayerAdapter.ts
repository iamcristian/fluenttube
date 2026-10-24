import { PlayerAdapter, PlayerError, PlayerState } from './types';

export function formatYouTubeError(code: number | string, videoId: string): PlayerError {
  const numericCode = typeof code === 'number' ? code : parseInt(String(code), 10);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  switch (numericCode) {
    case 2:
      return {
        code,
        message: 'The requested YouTube video ID contains invalid parameters.',
        isEmbedRestricted: false,
        videoUrl,
      };
    case 5:
      return {
        code,
        message: 'The requested content could not be played in the YouTube HTML5 player.',
        isEmbedRestricted: false,
        videoUrl,
      };
    case 100:
      return {
        code,
        message: 'The video was not found or has been marked as private by the creator.',
        isEmbedRestricted: false,
        videoUrl,
      };
    case 101:
    case 150:
      return {
        code,
        message:
          'The video owner does not allow playback in embedded third-party players.',
        isEmbedRestricted: true,
        videoUrl,
      };
    default:
      return {
        code,
        message: `An unexpected YouTube player error occurred (code ${code}).`,
        isEmbedRestricted: false,
        videoUrl,
      };
  }
}

interface NativeYTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getAvailablePlaybackRates: () => number[];
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  cueVideoById: (videoId: string, startSeconds?: number) => void;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  destroy: () => void;
}

export class YouTubePlayerAdapter implements PlayerAdapter {
  private player: NativeYTPlayer | null = null;
  private videoId: string;
  private isDestroyed = false;

  private readyListeners: Array<() => void> = [];
  private stateChangeListeners: Array<(state: PlayerState) => void> = [];
  private playbackRateListeners: Array<(rate: number) => void> = [];
  private errorListeners: Array<(error: PlayerError) => void> = [];

  constructor(videoId: string) {
    this.videoId = videoId;
  }

  /**
   * Internal hook to link the created native YT.Player instance.
   */
  setNativePlayer(player: unknown): void {
    if (this.isDestroyed) {
      if (player && typeof (player as NativeYTPlayer).destroy === 'function') {
        (player as NativeYTPlayer).destroy();
      }
      return;
    }
    this.player = player as NativeYTPlayer;
  }

  // --- Core Player Controls ---

  play(): void {
    if (this.isDestroyed || !this.player) return;
    try {
      this.player.playVideo();
    } catch (e) {
      console.warn('YouTubePlayerAdapter: playVideo error', e);
    }
  }

  pause(): void {
    if (this.isDestroyed || !this.player) return;
    try {
      this.player.pauseVideo();
    } catch (e) {
      console.warn('YouTubePlayerAdapter: pauseVideo error', e);
    }
  }

  seekTo(seconds: number, allowSeekAhead: boolean = true): void {
    if (this.isDestroyed || !this.player) return;
    try {
      this.player.seekTo(seconds, allowSeekAhead);
    } catch (e) {
      console.warn('YouTubePlayerAdapter: seekTo error', e);
    }
  }

  getCurrentTime(): number {
    if (this.isDestroyed || !this.player) return 0;
    try {
      return this.player.getCurrentTime() || 0;
    } catch {
      return 0;
    }
  }

  getDuration(): number {
    if (this.isDestroyed || !this.player) return 0;
    try {
      return this.player.getDuration() || 0;
    } catch {
      return 0;
    }
  }

  getState(): PlayerState {
    if (this.isDestroyed || !this.player) return PlayerState.UNSTARTED;
    try {
      const state = this.player.getPlayerState();
      return typeof state === 'number' ? (state as PlayerState) : PlayerState.UNSTARTED;
    } catch {
      return PlayerState.UNSTARTED;
    }
  }

  getAvailablePlaybackRates(): number[] {
    if (this.isDestroyed || !this.player) return [1];
    try {
      const rates = this.player.getAvailablePlaybackRates();
      return Array.isArray(rates) && rates.length > 0 ? rates : [1];
    } catch {
      return [1];
    }
  }

  getPlaybackRate(): number {
    if (this.isDestroyed || !this.player) return 1;
    try {
      return this.player.getPlaybackRate() || 1;
    } catch {
      return 1;
    }
  }

  setPlaybackRate(rate: number): void {
    if (this.isDestroyed || !this.player) return;
    try {
      this.player.setPlaybackRate(rate);
    } catch (e) {
      console.warn('YouTubePlayerAdapter: setPlaybackRate error', e);
    }
  }

  cueVideoById(videoId: string, startSeconds: number = 0): void {
    this.videoId = videoId;
    if (this.isDestroyed || !this.player) return;
    try {
      this.player.cueVideoById(videoId, startSeconds);
    } catch (e) {
      console.warn('YouTubePlayerAdapter: cueVideoById error', e);
    }
  }

  loadVideoById(videoId: string, startSeconds: number = 0): void {
    this.videoId = videoId;
    if (this.isDestroyed || !this.player) return;
    try {
      this.player.loadVideoById(videoId, startSeconds);
    } catch (e) {
      console.warn('YouTubePlayerAdapter: loadVideoById error', e);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.player) {
      try {
        this.player.destroy();
      } catch (e) {
        console.warn('YouTubePlayerAdapter: destroy error', e);
      }
      this.player = null;
    }
    this.readyListeners = [];
    this.stateChangeListeners = [];
    this.playbackRateListeners = [];
    this.errorListeners = [];
  }

  // --- Subscriptions ---

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

  // --- Event Dispatchers (called by native event callbacks) ---

  emitReady(): void {
    if (this.isDestroyed) return;
    this.readyListeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error('Error in onReady listener', e);
      }
    });
  }

  emitStateChange(state: number): void {
    if (this.isDestroyed) return;
    const playerState = state as PlayerState;
    this.stateChangeListeners.forEach((l) => {
      try {
        l(playerState);
      } catch (e) {
        console.error('Error in onStateChange listener', e);
      }
    });
  }

  emitPlaybackRateChange(rate: number): void {
    if (this.isDestroyed) return;
    this.playbackRateListeners.forEach((l) => {
      try {
        l(rate);
      } catch (e) {
        console.error('Error in onPlaybackRateChange listener', e);
      }
    });
  }

  emitError(errorCode: number): void {
    if (this.isDestroyed) return;
    const error = formatYouTubeError(errorCode, this.videoId);
    this.errorListeners.forEach((l) => {
      try {
        l(error);
      } catch (e) {
        console.error('Error in onError listener', e);
      }
    });
  }
}
