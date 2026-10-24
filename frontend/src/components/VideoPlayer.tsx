import { useRef, useImperativeHandle, forwardRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Gauge,
  Clock,
  ExternalLink,
  AlertTriangle,
  Loader2,
  Info,
} from 'lucide-react';
import { PlayerAdapter, PlayerError, PlayerState } from '../player/types';
import { useYouTubePlayer } from '../player/useYouTubePlayer';
import { useSegmentPlayback } from '../player/useSegmentPlayback';

export interface VideoPlayerRef {
  play: () => void;
  pause: () => void;
  replay: () => void;
}

export interface VideoPlayerProps {
  videoId: string;
  title?: string;
  startSeconds?: number;
  endSeconds?: number;
  nextStartSeconds?: number;
  initialLoop?: boolean;
  customAdapter?: PlayerAdapter;
  onReady?: () => void;
  onStateChange?: (state: PlayerState) => void;
  onError?: (error: PlayerError) => void;
  className?: string;
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(({
  videoId,
  title,
  startSeconds = 0,
  endSeconds,
  nextStartSeconds,
  initialLoop = false,
  customAdapter,
  onReady,
  onStateChange,
  onError,
  className = '',
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
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
  } = useYouTubePlayer({
    containerRef,
    videoId,
    customAdapter,
    onReady,
    onStateChange,
    onError,
  });

  const segmentBounds =
    endSeconds != null ? { start_seconds: startSeconds, end_seconds: endSeconds } : null;
  const nextSegmentBounds =
    nextStartSeconds != null
      ? { start_seconds: nextStartSeconds, end_seconds: nextStartSeconds + 5 }
      : null;

  const {
    playSegment,
    pauseSegment,
    replaySegment,
    isLooping,
    setIsLooping,
    isSegmentPlaying,
    isManualScrubbed,
    resetScrubbedState,
    hasCoarseTimingNotice,
  } = useSegmentPlayback({
    player: adapter,
    segment: segmentBounds,
    nextSegment: nextSegmentBounds,
    initialLoop,
  });

  // Effective playing state: if bounded segment is provided, check segment playing or player state
  const isPlaying =
    segmentBounds != null ? isSegmentPlaying : playerState === PlayerState.PLAYING;

  const handlePlay = () => {
    if (segmentBounds != null) {
      playSegment();
    } else {
      play();
    }
  };

  const handlePause = () => {
    if (segmentBounds != null) {
      pauseSegment();
    } else {
      pause();
    }
  };

  const handleReplay = () => {
    if (segmentBounds != null) {
      replaySegment();
    } else {
      seekTo(startSeconds);
      play();
    }
  };

  const handleReturnFromScrub = () => {
    resetScrubbedState();
    handleReplay();
  };

  useImperativeHandle(ref, () => ({
    play: handlePlay,
    pause: handlePause,
    replay: handleReplay,
  }));

  return (
    <div
      aria-label={title ? `Video player: ${title}` : 'Video player'}
      className={`bg-surface rounded-panel border border-border overflow-hidden shadow-lg flex flex-col ${className}`}
      data-testid="video-player-root"
    >
      {/* 16:9 Video Player Container (minimum 200px on mobile per Section 8) */}
      <div className="w-full aspect-video min-h-[200px] bg-black relative flex items-center justify-center overflow-hidden">
        {/* Native YouTube iframe target */}
        <div
          ref={containerRef}
          className="w-full h-full"
          data-testid="youtube-iframe-container"
        />

        {/* Loading overlay */}
        {isLoading && !error && (
          <div
            className="absolute inset-0 bg-[#0B1120]/80 backdrop-blur-xs flex flex-col items-center justify-center p-4 space-y-2 pointer-events-none"
            aria-live="polite"
          >
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-xs text-text-secondary font-mono">
              Loading YouTube player...
            </p>
          </div>
        )}

        {/* Manual Scrub Alert Overlay per Section 9 Rule 14 */}
        {isManualScrubbed && (
          <div
            role="status"
            className="absolute top-3 inset-x-3 bg-surface/95 border border-amber-500/60 p-2.5 rounded-control backdrop-blur-md flex items-center justify-between text-xs text-amber-200 shadow-xl z-20"
          >
            <div className="flex items-center space-x-2">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Scrubbed outside sentence bounds.</span>
            </div>
            <button
              type="button"
              onClick={handleReturnFromScrub}
              className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-[11px] border border-amber-500/40 transition"
            >
              Replay sentence to return
            </button>
          </div>
        )}

        {/* Error overlay per Section 9.15 */}
        {error && (
          <div
            role="alert"
            className="absolute inset-0 bg-[#0B1120]/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-3 z-10"
          >
            <div className="w-12 h-12 rounded-full bg-danger/10 border border-danger/30 flex items-center justify-center text-danger">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-bold text-white">
                {error.isEmbedRestricted
                  ? 'Embedding Restricted by Video Owner'
                  : 'YouTube Playback Unavailable'}
              </h3>
              <p className="text-xs text-danger/90 leading-relaxed">{error.message}</p>
            </div>
            <a
              href={error.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-surface-raised hover:bg-surface border border-border text-white text-xs font-semibold rounded-control shadow-md transition"
            >
              <span>Watch on YouTube</span>
              <ExternalLink className="w-3.5 h-3.5 text-accent" />
            </a>
          </div>
        )}
      </div>

      {/* Sentence & Player Controls Bar */}
      <div className="p-3 bg-surface-raised border-t border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center space-x-1.5">
          {/* Play Button */}
          <button
            type="button"
            onClick={handlePlay}
            disabled={!isReady || !!error || isPlaying}
            aria-label="Play video"
            title={isPlaying ? 'Video is currently playing' : 'Play sentence'}
            className="p-2 rounded-control bg-surface border border-border/80 text-text-secondary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
          >
            <Play className="w-4 h-4 fill-current" />
          </button>

          {/* Pause Button */}
          <button
            type="button"
            onClick={handlePause}
            disabled={!isReady || !!error || !isPlaying}
            aria-label="Pause video"
            title={!isPlaying ? 'Video is paused' : 'Pause sentence'}
            className="p-2 rounded-control bg-surface border border-border/80 text-text-secondary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
          >
            <Pause className="w-4 h-4" />
          </button>

          {/* Replay Button */}
          <button
            type="button"
            onClick={handleReplay}
            disabled={!isReady || !!error}
            aria-label="Replay current sentence"
            title="Replay from sentence start"
            className="p-2 rounded-control bg-surface border border-border/80 text-text-secondary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Loop Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsLooping(!isLooping)}
            disabled={!isReady || !!error}
            aria-label="Toggle loop mode"
            aria-pressed={isLooping}
            title={isLooping ? 'Loop mode is ON (repeats sentence)' : 'Loop mode is OFF'}
            className={`p-2 rounded-control border transition shadow-sm ${
              isLooping
                ? 'bg-accent/20 border-accent text-accent font-bold ring-1 ring-accent/30'
                : 'bg-surface border-border/80 text-text-secondary hover:text-white disabled:opacity-40'
            }`}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>

        {/* Timestamp Range & Playback Speed Selector */}
        <div className="flex items-center space-x-3 text-xs text-text-secondary">
          {/* Coarse Timing Notice per Section 9 Rule 7 */}
          {hasCoarseTimingNotice && (
            <span
              title="Sentences overlap in the subtitle track; timing clamped to original segment end."
              className="text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 font-mono"
            >
              Coarse timing
            </span>
          )}

          <div className="flex items-center space-x-1 font-mono text-[11px] text-slate-400">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>
              {startSeconds.toFixed(1)}s
              {endSeconds != null ? ` - ${endSeconds.toFixed(1)}s` : ''}
            </span>
          </div>

          {/* Playback Rate Selector */}
          <div className="flex items-center space-x-1 bg-surface border border-border rounded-control p-1">
            <Gauge className="w-3 h-3 text-accent ml-1 mr-0.5" />
            {[0.75, 1.0, 1.25].map((rate) => {
              const isAvailable = availablePlaybackRates.includes(rate);
              const isCurrent = Math.abs(playbackRate - rate) < 0.05;
              return (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setPlaybackRate(rate)}
                  disabled={!isReady || !!error || !isAvailable}
                  title={
                    !isAvailable
                      ? `Rate ${rate}x not available for this video`
                      : `Set speed to ${rate}x`
                  }
                  className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition ${
                    isCurrent
                      ? 'bg-accent text-background font-bold'
                      : 'text-text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed'
                  }`}
                >
                  {rate}x
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';
