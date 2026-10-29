import React from 'react';
import { screen, render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadYouTubeIframeApi, resetYouTubeApiLoaderForTesting } from '../src/player/youtubeApiLoader';
import { formatYouTubeError, YouTubePlayerAdapter } from '../src/player/YouTubePlayerAdapter';
import { FakePlayerAdapter } from '../src/player/FakePlayerAdapter';
import { PlayerState } from '../src/player/types';
import { VideoPlayer } from '../src/components/VideoPlayer';

describe('YouTube IFrame API Singleton Loader', () => {
  beforeEach(() => {
    resetYouTubeApiLoaderForTesting();
    document.querySelectorAll('script[src*="youtube.com/iframe_api"]').forEach((s) => s.remove());
    delete (window as unknown as { YT?: unknown }).YT;
    delete (window as unknown as { onYouTubeIframeAPIReady?: unknown }).onYouTubeIframeAPIReady;
  });

  afterEach(() => {
    resetYouTubeApiLoaderForTesting();
  });

  it('injects script tag exactly once and returns shared promise', async () => {
    const promise1 = loadYouTubeIframeApi();
    const promise2 = loadYouTubeIframeApi();

    // Verify both calls returned the identical Promise instance
    expect(promise1).toBe(promise2);

    const scripts = document.querySelectorAll('script[src*="youtube.com/iframe_api"]');
    expect(scripts.length).toBe(1);

    // Mock API ready callback
    (window as unknown as { YT: unknown }).YT = {
      Player: vi.fn(),
      PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    };

    act(() => {
      window.onYouTubeIframeAPIReady?.();
    });

    await expect(promise1).resolves.toBeUndefined();
    await expect(promise2).resolves.toBeUndefined();
  });

  it('resolves immediately without re-injecting script when window.YT is already loaded', async () => {
    (window as unknown as { YT: unknown }).YT = {
      Player: vi.fn(),
      PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    };

    await expect(loadYouTubeIframeApi()).resolves.toBeUndefined();
    const scripts = document.querySelectorAll('script[src*="youtube.com/iframe_api"]');
    expect(scripts.length).toBe(0);
  });

  it('preserves existing onYouTubeIframeAPIReady hook when adding its own', async () => {
    const previousHook = vi.fn();
    window.onYouTubeIframeAPIReady = previousHook;

    const promise = loadYouTubeIframeApi();

    (window as unknown as { YT: unknown }).YT = {
      Player: vi.fn(),
      PlayerState: {},
    };

    act(() => {
      window.onYouTubeIframeAPIReady?.();
    });

    await promise;
    expect(previousHook).toHaveBeenCalledTimes(1);
  });

  it('cleans up failed script tag on error and allows subsequent retry (F-20)', async () => {
    const promise1 = loadYouTubeIframeApi();
    const script = document.querySelector('script[src*="youtube.com/iframe_api"]') as HTMLScriptElement;
    expect(script).not.toBeNull();

    // Trigger script error
    fireEvent.error(script);

    await expect(promise1).rejects.toThrow('Failed to load YouTube IFrame API script.');

    // Script element must be removed from DOM
    expect(document.querySelector('script[src*="youtube.com/iframe_api"]')).toBeNull();

    // Subsequent retry should inject a new script tag and work
    const promise2 = loadYouTubeIframeApi();
    const newScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
    expect(newScript).not.toBeNull();

    (window as unknown as { YT: unknown }).YT = {
      Player: vi.fn(),
      PlayerState: {},
    };

    act(() => {
      window.onYouTubeIframeAPIReady?.();
    });

    await expect(promise2).resolves.toBeUndefined();
  });
});

describe('YouTubePlayerAdapter and Error Formatting', () => {
  it('formats error 101/150 as embedding restriction with direct YouTube link', () => {
    const err101 = formatYouTubeError(101, 'dQw4w9WgXcQ');
    expect(err101.isEmbedRestricted).toBe(true);
    expect(err101.message).toContain('embedded third-party players');
    expect(err101.videoUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const err150 = formatYouTubeError(150, 'jNQXAC9IVRw');
    expect(err150.isEmbedRestricted).toBe(true);
    expect(err150.videoUrl).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  });

  it('formats error 100 as video not found', () => {
    const err = formatYouTubeError(100, 'abc12345678');
    expect(err.isEmbedRestricted).toBe(false);
    expect(err.message).toContain('not found or has been marked as private');
  });

  it('dispatches and unsubscribes event listeners cleanly', () => {
    const adapter = new YouTubePlayerAdapter('test-id');
    const stateSpy = vi.fn();
    const rateSpy = vi.fn();
    const errorSpy = vi.fn();

    const unsubState = adapter.onStateChange(stateSpy);
    const unsubRate = adapter.onPlaybackRateChange(rateSpy);
    const unsubError = adapter.onError(errorSpy);

    adapter.emitStateChange(1);
    expect(stateSpy).toHaveBeenCalledWith(PlayerState.PLAYING);

    adapter.emitPlaybackRateChange(0.75);
    expect(rateSpy).toHaveBeenCalledWith(0.75);

    adapter.emitError(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 2,
        isEmbedRestricted: false,
      })
    );

    // Unsubscribe
    unsubState();
    unsubRate();
    unsubError();

    adapter.emitStateChange(2);
    adapter.emitPlaybackRateChange(1.0);
    adapter.emitError(100);

    // Should not have received second emissions
    expect(stateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    adapter.destroy();
  });
});

describe('FakePlayerAdapter Unit Tests', () => {
  it('tracks play, pause, seek, and rate changes', () => {
    const fake = new FakePlayerAdapter('video123');
    expect(fake.getState()).toBe(PlayerState.UNSTARTED);

    fake.play();
    expect(fake.playCalls).toBe(1);
    expect(fake.getState()).toBe(PlayerState.PLAYING);

    fake.pause();
    expect(fake.pauseCalls).toBe(1);
    expect(fake.getState()).toBe(PlayerState.PAUSED);

    fake.seekTo(12.5, true);
    expect(fake.seekCalls).toEqual([{ seconds: 12.5, allowSeekAhead: true }]);
    expect(fake.getCurrentTime()).toBe(12.5);

    fake.setPlaybackRate(0.75);
    expect(fake.getPlaybackRate()).toBe(0.75);
    expect(fake.setRateCalls).toEqual([0.75]);

    fake.cueVideoById('new-video-id', 5.0);
    expect(fake.cuedVideos).toEqual([{ videoId: 'new-video-id', startSeconds: 5.0 }]);
    expect(fake.getState()).toBe(PlayerState.CUED);

    fake.destroy();
    expect(fake.isDestroyed).toBe(true);
  });
});

describe('VideoPlayer Component Integration', () => {
  it('renders player container and controls with FakePlayerAdapter', () => {
    const fakeAdapter = new FakePlayerAdapter('jNQXAC9IVRw');

    render(
      <VideoPlayer
        videoId="jNQXAC9IVRw"
        title="Me at the zoo"
        startSeconds={2.0}
        endSeconds={5.5}
        customAdapter={fakeAdapter}
      />
    );

    expect(screen.getByTestId('video-player-root')).toBeInTheDocument();
    expect(screen.getByLabelText(/Video player: Me at the zoo/i)).toBeInTheDocument();

    // Timestamp interval is rendered
    expect(screen.getByText('2.0s - 5.5s')).toBeInTheDocument();

    // Play button
    const playBtn = screen.getByRole('button', { name: /play video/i });
    expect(playBtn).toBeEnabled();
    fireEvent.click(playBtn);
    expect(fakeAdapter.playCalls).toBe(1);

    // Now playing: Pause button should be enabled
    const pauseBtn = screen.getByRole('button', { name: /pause video/i });
    expect(pauseBtn).toBeEnabled();
    fireEvent.click(pauseBtn);
    expect(fakeAdapter.pauseCalls).toBe(1);

    // Replay button seeks back to startSeconds (2.0) and plays
    const replayBtn = screen.getByRole('button', { name: /replay current sentence/i });
    fireEvent.click(replayBtn);
    expect(fakeAdapter.seekCalls).toContainEqual({ seconds: 2.0, allowSeekAhead: true });
    expect(fakeAdapter.playCalls).toBe(2);
  });

  it('switches playback speed when rate button is clicked', () => {
    const fakeAdapter = new FakePlayerAdapter('jNQXAC9IVRw');

    render(
      <VideoPlayer
        videoId="jNQXAC9IVRw"
        title="Me at the zoo"
        customAdapter={fakeAdapter}
      />
    );

    const speed075 = screen.getByRole('button', { name: '0.75x' });
    fireEvent.click(speed075);

    expect(fakeAdapter.setRateCalls).toContain(0.75);
    expect(fakeAdapter.getPlaybackRate()).toBe(0.75);
  });

  it('renders meaningful error overlay and direct YouTube link on error 101 (embedding restricted)', () => {
    const fakeAdapter = new FakePlayerAdapter('restricted-id');

    render(
      <VideoPlayer
        videoId="restricted-id"
        title="Restricted Video"
        customAdapter={fakeAdapter}
      />
    );

    act(() => {
      fakeAdapter.simulateError(101);
    });

    // Alert overlay is presented
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Embedding Restricted by Video Owner')).toBeInTheDocument();
    expect(
      screen.getByText(/The video owner does not allow playback in embedded third-party players/i)
    ).toBeInTheDocument();

    // "Watch on YouTube" direct link
    const ytLink = screen.getByRole('link', { name: /watch on youtube/i });
    expect(ytLink).toHaveAttribute('href', 'https://www.youtube.com/watch?v=restricted-id');
    expect(ytLink).toHaveAttribute('target', '_blank');
  });

  it('cleans up adapter instance cleanly on unmount under React StrictMode', () => {
    const fakeAdapter = new FakePlayerAdapter('unmount-test');
    const destroySpy = vi.spyOn(fakeAdapter, 'destroy');

    const { unmount } = render(
      <React.StrictMode>
        <VideoPlayer
          videoId="unmount-test"
          customAdapter={fakeAdapter}
        />
      </React.StrictMode>
    );

    unmount();
    expect(destroySpy).toHaveBeenCalled();
  });
});
