import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayer } from '../src/components/VideoPlayer';

describe('Local video playback', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('uses the local media endpoint without injecting a YouTube script or iframe', () => {
    const before = document.querySelectorAll('script[src*="youtube"]').length;
    const { container } = render(<VideoPlayer videoId="local:test" mediaUrl="/api/videos/12/media" startSeconds={1} endSeconds={3} />);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('src', '/api/videos/12/media');
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.querySelectorAll('script[src*="youtube"]')).toHaveLength(before);
    act(() => fireEvent.loadedMetadata(video));
    expect(screen.getByRole('button', { name: 'Play video' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(video.play).toHaveBeenCalled();
  });

  it('changes playback speed and releases the local player on unmount', () => {
    const { container, unmount } = render(<VideoPlayer videoId="local:test" mediaUrl="/api/videos/12/media" />);
    const video = container.querySelector('video')!;
    act(() => fireEvent.loadedMetadata(video));
    fireEvent.click(screen.getByRole('button', { name: '0.75x' }));
    expect(video.playbackRate).toBe(0.75);
    unmount();
    expect(video.pause).toHaveBeenCalled();
    expect(video).not.toHaveAttribute('src');
  });
});
