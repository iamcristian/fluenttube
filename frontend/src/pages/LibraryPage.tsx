import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  Headphones,
  Film,
  Sparkles,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { VideoSummaryDTO } from '../api/types';
import { VideoLoaderModal } from '../components/VideoLoaderModal';

export interface LibraryPageProps {
  onSelectVideo: (videoId: number) => void;
  onNavigateToSettings?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({ onSelectVideo, onNavigateToSettings }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  // Check for pending background job on mount (state recovery)
  useEffect(() => {
    const savedJobId = localStorage.getItem('fluenttube_pending_job_id');
    if (savedJobId) {
      setPendingJobId(savedJobId);
      setIsModalOpen(true);
    }
  }, []);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['videos'],
    queryFn: () => apiClient.getVideos(50, 0),
  });

  const videos: VideoSummaryDTO[] = data?.items || [];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-[#151D2A]/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400">
              <Headphones className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center space-x-2">
                <span>FluentTube AI</span>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-400 border border-blue-800/50">
                  V1 Study
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onNavigateToSettings || (() => { window.location.hash = '#/settings'; })}
              aria-label="Settings"
              title="Settings & System Diagnostics"
              className="flex items-center space-x-1.5 px-3 py-2 bg-surface-raised hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl text-sm font-semibold border border-slate-700/60 transition"
            >
              <Settings className="w-4 h-4 text-slate-400" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPendingJobId(null);
                setIsModalOpen(true);
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-600/20 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Import Video</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 space-y-3">
            <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Loading your video library...</p>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-red-950/30 border border-red-800/50 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-900/40 text-red-400 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-red-200">Unable to load library</h3>
              <p className="text-xs text-red-400 mt-1">
                {error instanceof Error ? error.message : 'Could not connect to backend database.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </button>
          </div>
        )}

        {/* Empty State Guide */}
        {!isLoading && !isError && videos.length === 0 && (
          <div className="max-w-xl mx-auto my-16 p-8 rounded-3xl bg-[#151D2A] border border-slate-800/80 text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
              <Film className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Your study library is empty</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Paste any YouTube link with English subtitles under 30 minutes to practice listening, sentence-by-sentence dictation, and shadowing.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left p-4 rounded-2xl bg-[#0B0F17]/60 border border-slate-800/60 text-xs text-slate-300">
              <div className="flex items-start space-x-2">
                <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>Deterministic sentence segmentation</span>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>Word-level typing and error alignment</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setPendingJobId(null);
                setIsModalOpen(true);
              }}
              className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-600/25 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Import Your First Video</span>
            </button>
          </div>
        )}

        {/* Video Grid */}
        {!isLoading && !isError && videos.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-200">
                Imported Videos ({videos.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {videos.map((video) => {
                const completionPct =
                  video.segment_count > 0
                    ? Math.round((video.completed_count / video.segment_count) * 100)
                    : 0;

                return (
                  <article
                    key={video.id}
                    className="group bg-[#151D2A] border border-slate-800/80 hover:border-slate-700 rounded-2xl overflow-hidden shadow-lg transition-all duration-200 hover:-translate-y-1 flex flex-col justify-between"
                  >
                    <div>
                      {/* Thumbnail Container */}
                      <div className="relative aspect-video bg-slate-900 overflow-hidden">
                        <img
                          src={`https://img.youtube.com/vi/${video.youtube_id}/mqdefault.jpg`}
                          alt={video.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-sm text-[11px] font-mono font-medium text-slate-200 flex items-center space-x-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formatDuration(video.duration_seconds)}</span>
                        </div>
                        <div
                          className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md backdrop-blur-sm text-[10px] font-semibold uppercase tracking-wider ${
                            video.transcription_source === 'local_asr'
                              ? 'bg-sky-950/80 text-sky-300 border border-sky-500/30'
                              : video.transcription_source === 'captions_manual'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                              : 'bg-black/60 text-slate-300'
                          }`}
                        >
                          {video.transcription_source === 'local_asr'
                            ? 'Local ASR'
                            : video.transcription_source === 'captions_manual'
                            ? 'Manual CC'
                            : 'Auto CC'}
                        </div>
                      </div>

                      {/* Video Info */}
                      <div className="p-4 space-y-2">
                        <h3
                          className="text-sm font-semibold text-white line-clamp-2 leading-snug group-hover:text-blue-400 transition-colors"
                          title={video.title}
                        >
                          {video.title}
                        </h3>
                        {video.channel && (
                          <p className="text-xs text-slate-400 truncate">{video.channel}</p>
                        )}
                      </div>
                    </div>

                    {/* Progress & CTA */}
                    <div className="p-4 pt-0 space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                          <span>
                            {video.completed_count} / {video.segment_count} sentences
                          </span>
                          <span>{completionPct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                            style={{ width: `${completionPct}%` }}
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectVideo(video.id)}
                        className="w-full flex items-center justify-center space-x-2 py-2.5 bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white rounded-xl text-xs font-semibold transition"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>
                          {video.completed_count > 0 ? 'Continue Practice' : 'Start Practice'}
                        </span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Video Loader Modal */}
      <VideoLoaderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialJobId={pendingJobId}
        onSuccess={(videoId) => {
          setIsModalOpen(false);
          onSelectVideo(videoId);
        }}
      />
    </div>
  );
};
