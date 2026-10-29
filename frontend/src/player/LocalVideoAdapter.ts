import { PlayerAdapter, PlayerError, PlayerState } from './types';

/** Native playback for local uploads. Never initializes the YouTube API. */
export class LocalVideoAdapter implements PlayerAdapter {
  private video: HTMLVideoElement | null = null;
  private state = PlayerState.UNSTARTED;
  private readyListeners = new Set<() => void>();
  private stateListeners = new Set<(state: PlayerState) => void>();
  private rateListeners = new Set<(rate: number) => void>();
  private errorListeners = new Set<(error: PlayerError) => void>();
  constructor(private url: string) {}

  mount(container: HTMLElement) {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.className = 'w-full h-full object-contain';
    video.setAttribute('aria-label', 'Local video');
    video.addEventListener('loadedmetadata', () => { this.state = PlayerState.CUED; this.readyListeners.forEach(fn => fn()); });
    for (const [event, state] of [['play', PlayerState.PLAYING], ['pause', PlayerState.PAUSED], ['ended', PlayerState.ENDED], ['waiting', PlayerState.BUFFERING], ['playing', PlayerState.PLAYING]] as const) {
      video.addEventListener(event, () => { this.state = state; this.stateListeners.forEach(fn => fn(state)); });
    }
    video.addEventListener('ratechange', () => this.rateListeners.forEach(fn => fn(video.playbackRate)));
    video.addEventListener('error', () => this.emitError('This local video could not be played. Try MP4 with H.264 video and AAC audio, or WebM.'));
    video.src = this.url;
    container.replaceChildren(video);
    this.video = video;
  }
  private emitError(message: string) { this.errorListeners.forEach(fn => fn({ code: 'LOCAL_PLAYBACK_FAILED', message, isEmbedRestricted: false, videoUrl: this.url })); }
  async play() { try { await this.video?.play(); } catch { this.emitError('Playback could not start. Press Play on the video to try again.'); } }
  pause() { this.video?.pause(); }
  seekTo(seconds: number) { if (this.video && this.video.readyState >= 1) this.video.currentTime = Math.max(0, seconds); }
  getCurrentTime() { return this.video?.currentTime ?? 0; }
  getDuration() { return this.video?.duration ?? 0; }
  getState() { return this.state; }
  getAvailablePlaybackRates() { return [0.5, 0.75, 1, 1.25, 1.5]; }
  getPlaybackRate() { return this.video?.playbackRate ?? 1; }
  setPlaybackRate(rate: number) { if (this.video) this.video.playbackRate = rate; }
  cueVideoById(_id: string, startSeconds = 0) { this.seekTo(startSeconds); }
  loadVideoById(_id: string, startSeconds = 0) { this.seekTo(startSeconds); void this.play(); }
  destroy() { if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove(); this.video = null; } this.readyListeners.clear(); this.stateListeners.clear(); this.rateListeners.clear(); this.errorListeners.clear(); }
  onReady(fn: () => void) { this.readyListeners.add(fn); return () => { this.readyListeners.delete(fn); }; }
  onStateChange(fn: (state: PlayerState) => void) { this.stateListeners.add(fn); return () => { this.stateListeners.delete(fn); }; }
  onPlaybackRateChange(fn: (rate: number) => void) { this.rateListeners.add(fn); return () => { this.rateListeners.delete(fn); }; }
  onError(fn: (error: PlayerError) => void) { this.errorListeners.add(fn); return () => { this.errorListeners.delete(fn); }; }
}
