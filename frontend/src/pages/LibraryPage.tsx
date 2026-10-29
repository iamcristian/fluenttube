import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Plus,
  Play,
  Search,
  Settings,
  Headphones,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  BookOpen,
  Mic,
  Film,
  Trash2,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { VideoSummaryDTO } from '../api/types';
import { VideoLoaderModal } from '../components/VideoLoaderModal';
import { useStudyStore } from '../stores/useStudyStore';

export interface LibraryPageProps {
  onSelectVideo: (videoId: number) => void;
  onNavigateToSettings?: () => void;
}
type Filter = 'all' | 'progress' | 'new' | 'completed';
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All videos' },
  { id: 'progress', label: 'In progress' },
  { id: 'new', label: 'Not started' },
  { id: 'completed', label: 'Completed' },
];
const isComplete = (v: VideoSummaryDTO) =>
  v.segment_count > 0 && v.completed_count >= v.segment_count;
const formatDuration = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;

export const LibraryPage: React.FC<LibraryPageProps> = ({
  onSelectVideo,
  onNavigateToSettings,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState('recent');
  const [videoToRemove, setVideoToRemove] = useState<VideoSummaryDTO | null>(null);
  const [removeError, setRemoveError] = useState('');
  const queryClient = useQueryClient();
  const removeDialogRef = useRef<HTMLElement>(null);
  const removeVideo = useMutation({
    mutationFn: (id: number) => apiClient.deleteVideo(id),
    onSuccess: async (result) => {
      useStudyStore.getState().forgetVideo(result.video_id, result.segment_ids);
      queryClient.removeQueries({ queryKey: ['video', result.video_id] });
      setVideoToRemove(null);
      setRemoveError('');
      await queryClient.invalidateQueries({ queryKey: ['videos'] });
    },
    onError: (error) => setRemoveError(error instanceof Error ? error.message : 'We couldn’t remove this video. Try again.'),
  });
  useEffect(() => {
    if (!videoToRemove) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    removeDialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removeVideo.isPending) { event.preventDefault(); setVideoToRemove(null); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(removeDialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [videoToRemove, removeVideo.isPending]);
  useEffect(() => {
    const saved = localStorage.getItem('fluenttube_pending_job_id');
    if (saved) {
      setPendingJobId(saved);
      setIsModalOpen(true);
      return;
    }
    let cancelled = false;
    apiClient.getLocalImports().then(jobs => {
      const recoverable = jobs.find(job => job.status !== 'failed' || job.error?.details?.can_resume);
      if (!cancelled && recoverable) {
        setPendingJobId(recoverable.id);
        setIsModalOpen(true);
        localStorage.setItem('fluenttube_pending_job_id', recoverable.id);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['videos'],
    queryFn: async () => {
      // Include every page in library search and progress totals.
      const first = await apiClient.getVideos(100, 0);
      const items = [...first.items];
      while (items.length < first.total) {
        const page = await apiClient.getVideos(100, items.length);
        if (!page.items.length) break;
        items.push(...page.items);
      }
      return { ...first, items };
    },
  });
  const videos = data?.items ?? [];
  const visibleVideos = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    const result = videos.filter(
      (v) =>
        `${v.title} ${v.channel ?? ''}`.toLocaleLowerCase().includes(q) &&
        (filter === 'all' ||
          (filter === 'completed' && isComplete(v)) ||
          (filter === 'new' && !v.completed_count && !v.last_segment_id) ||
          (filter === 'progress' &&
            !isComplete(v) &&
            Boolean(v.completed_count || v.last_segment_id)))
    );
    if (sort === 'title') result.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'shortest')
      result.sort((a, b) => a.duration_seconds - b.duration_seconds);
    return result;
  }, [videos, search, filter, sort]);
  const completed = videos.reduce((sum, v) => sum + v.completed_count, 0);
  const resume = videos.find(
    (v) => !isComplete(v) && (v.last_segment_id || v.completed_count)
  );
  const openImport = () => setIsModalOpen(true);

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <header className="border-b border-border-subtle bg-background/95 sticky top-0 z-30 backdrop-blur-xl">
        <div className="library-shell h-20 flex items-center justify-between gap-4">
          <a
            href="#/"
            className="flex items-center gap-3"
            aria-label="FluentTube home"
          >
            <span className="brand-mark">
              <Headphones size={23} />
            </span>
            <span className="text-lg font-bold tracking-tight">
              fluent<span className="text-accent">tube</span>
              <span className="hidden sm:block text-[10px] font-medium tracking-[0.15em] uppercase text-text-secondary">
                A little practice. Real progress.
              </span>
            </span>
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              className="quiet-button"
              aria-label="Settings"
              onClick={
                onNavigateToSettings ??
                (() => {
                  window.location.hash = '#/settings';
                })
              }
            >
              <Settings size={18} />
              <span className="hidden sm:inline">Settings</span>
            </button>
            <button
              className="primary-button"
              aria-label="Import Video"
              onClick={openImport}
            >
              <Plus size={18} />
              <span>
                Import<span className="hidden sm:inline"> Video</span>
              </span>
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="library-shell py-8 sm:py-12 space-y-9">
        <section className="library-hero">
          <div className="relative z-10 max-w-xl">
            <p className="eyebrow mb-4">
              <span className="h-2 w-2 rounded-full bg-accent" />
              YOUR ENGLISH, EVERY DAY
            </p>
            <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.12]">
              Good videos.
              <br />
              <span className="text-accent">Better English.</span>
            </h1>
            <p className="text-text-secondary mt-5 text-sm sm:text-base max-w-md leading-relaxed">
              Turn something you love watching into something you love learning.
              One sentence at a time.
            </p>
            <button
              className="primary-button mt-6"
              onClick={() => (resume ? onSelectVideo(resume.id) : openImport())}
            >
              {resume ? 'Pick up where you left off' : 'Add your first video'}
              <ArrowRight size={17} />
            </button>
            {resume && (
              <p className="text-xs text-text-secondary mt-3 truncate">
                Continue: {resume.title}
              </p>
            )}
          </div>
          <div
            className={`hero-guide ${videos.length ? 'hidden md:block' : ''}`}
            aria-label="How practice works"
          >
            <p className="eyebrow text-text-secondary mb-5">
              YOUR NEXT 5 MINUTES
            </p>
            {[
              {
                Icon: Headphones,
                title: 'Listen closely',
                text: 'Replay a short sentence at your pace.',
              },
              {
                Icon: BookOpen,
                title: 'Write what you hear',
                text: 'Check your answer. Learn from each try.',
              },
              {
                Icon: Mic,
                title: 'Make it your own',
                text: 'Say it out loud and compare.',
              },
            ].map(({ Icon, title, text }, i) => (
              <div key={title} className="flex gap-4 items-start py-3">
                <span className="guide-icon">
                  <Icon size={19} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">
                    <span className="text-text-secondary mr-2">0{i + 1}</span>
                    {title}
                  </h2>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
        {!isLoading && !isError && videos.length > 0 && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-text-secondary border-b border-border-subtle pb-6">
            <span>
              <strong className="text-white text-lg mr-2">
                {videos.length}
              </strong>
              videos in your library
            </span>
            <span>
              <strong className="text-accent text-lg mr-2">{completed}</strong>
              sentences completed
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-accent" />
              Your progress is saved automatically
            </span>
          </div>
        )}
        <section aria-label="Video library" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-text-secondary mb-2">
                WATCH. PRACTICE. REPEAT.
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">
                Your library
              </h2>
            </div>
            {videos.length > 0 && (
              <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search
                    size={17}
                    className="absolute left-3 top-3.5 text-text-secondary"
                  />
                  <input
                    aria-label="Search videos"
                    placeholder="Search videos or channels"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="search-input pr-9"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      aria-label="Clear search"
                      className="absolute right-3 top-3.5 text-text-secondary"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <select
                  aria-label="Sort videos"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="search-input w-auto"
                >
                  <option value="recent">Recently opened</option>
                  <option value="title">Title A–Z</option>
                  <option value="shortest">Shortest first</option>
                </select>
              </div>
            )}
          </div>
          {videos.length > 0 && (
            <div
              role="group"
              aria-label="Filter videos"
              className="flex flex-wrap gap-2"
            >
              {filters.map((f) => (
                <button
                  key={f.id}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`filter-chip ${filter === f.id ? 'filter-chip-active' : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {isLoading && (
            <div
              role="status"
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5"
            >
              <span className="sr-only">Loading your video library...</span>
              {[1, 2, 3].map((id) => (
                <div
                  key={id}
                  className="h-72 bg-surface rounded-2xl animate-pulse border border-border-subtle"
                />
              ))}
            </div>
          )}
          {isError && (
            <div role="alert" className="empty-panel">
              <AlertCircle className="text-danger mx-auto mb-3" />
              <h3 className="text-lg font-semibold">Unable to load library</h3>
              <p className="text-text-secondary mt-2 mb-5">
                We couldn’t reach your local server. Start the app with npm run
                dev, then try again.
              </p>
              <button
                className="secondary-button mx-auto"
                onClick={() => refetch()}
              >
                <RefreshCw size={16} />
                Retry Connection
              </button>
            </div>
          )}
          {!isLoading && !isError && videos.length === 0 && (
            <div className="empty-panel">
              <Headphones size={32} className="mx-auto text-accent mb-4" />
              <h3 className="text-xl font-semibold">
                Your study library is empty
              </h3>
              <p className="text-sm text-text-secondary mt-3 mb-6 max-w-md mx-auto leading-relaxed">
                Paste any YouTube link with English subtitles to get started. A
                short video about something you enjoy is a great first choice.
              </p>
              <button className="primary-button mx-auto" onClick={openImport}>
                <Plus size={17} />
                Import Your First Video
              </button>
            </div>
          )}
          {!isLoading &&
            !isError &&
            videos.length > 0 &&
            visibleVideos.length === 0 && (
              <div className="empty-panel" role="status">
                <Search className="mx-auto text-text-secondary mb-3" />
                <h3 className="font-semibold">No videos match just yet</h3>
                <p className="text-sm text-text-secondary mt-2 mb-5">
                  Try another title, channel, or practice status.
                </p>
                <button
                  className="secondary-button mx-auto"
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                  }}
                >
                  Clear search and filters
                </button>
              </div>
            )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {!isError &&
              visibleVideos.map((v) => {
                const pct = v.segment_count
                  ? Math.min(
                      100,
                      Math.round((v.completed_count / v.segment_count) * 100)
                    )
                  : 0;
                const started = Boolean(v.completed_count || v.last_segment_id);
                return (
                  <article key={v.id} className="video-card group">
                    <div className="relative aspect-video bg-surface-raised overflow-hidden">
                      {v.source_type === 'local' ? <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-accent/10 to-background text-accent"><Film size={40} /><span className="text-sm">Local video · no YouTube connection</span></div> : <img
                        src={`https://img.youtube.com/vi/${v.youtube_id}/mqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />}
                      <span className="absolute bottom-3 right-3 bg-black/80 text-white rounded-md text-xs px-2 py-1 tabular-nums">
                        {formatDuration(v.duration_seconds)}
                      </span>
                      <button
                        type="button"
                        className="absolute top-3 right-3 inline-flex items-center justify-center gap-2 rounded-lg bg-black/80 text-white px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 transition-opacity"
                        aria-label={`Remove ${v.title} from library`}
                        title="Remove from library"
                        onClick={() => { setRemoveError(''); setVideoToRemove(v); }}
                      >
                        <Trash2 size={15} />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                      <span
                        className={`absolute top-3 left-3 rounded-full text-[11px] font-medium px-2.5 py-1 ${isComplete(v) ? 'bg-accent text-background' : 'bg-background/90 text-white'}`}
                      >
                        {isComplete(v)
                          ? 'Completed'
                          : started
                            ? 'In progress'
                            : 'Ready when you are'}
                      </span>
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <p className="text-xs text-text-secondary mb-2">
                        {v.channel || 'YouTube video'}
                      </p>
                      <h3
                        className="font-semibold leading-snug line-clamp-2 mb-5"
                        title={v.title}
                      >
                        {v.title}
                      </h3>
                      <div className="mt-auto">
                        <div className="flex justify-between text-xs text-text-secondary mb-2">
                          <span>
                            {v.completed_count} / {v.segment_count} sentences
                          </span>
                          <span className="text-accent">{pct}%</span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label={`${v.title} progress`}
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          className="h-1 bg-surface-raised rounded-full overflow-hidden"
                        >
                          <div
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <button
                          className="video-action"
                          onClick={() => onSelectVideo(v.id)}
                        >
                          <Play size={15} />
                          <span>
                            {isComplete(v)
                              ? 'Review Practice'
                              : started
                                ? 'Continue Practice'
                                : 'Start Practice'}
                          </span>
                          <ArrowRight size={16} className="ml-auto" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
        <footer className="text-xs text-text-secondary border-t border-border-subtle pt-6 pb-4 flex flex-wrap justify-between gap-3">
          <span>Small steps sound better every day.</span>
          <span>FluentTube · Your personal English practice space</span>
        </footer>
      </main>
      <VideoLoaderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialJobId={pendingJobId}
        onSuccess={(id) => {
          setIsModalOpen(false);
          setPendingJobId(null);
          onSelectVideo(id);
        }}
      />
      {videoToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !removeVideo.isPending) setVideoToRemove(null); }}>
          <section ref={removeDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="remove-video-title" aria-describedby="remove-video-description" className="w-full max-w-md rounded-2xl border border-border-subtle bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-danger"><Trash2 size={20} /></div>
            <h2 id="remove-video-title" className="text-xl font-semibold">Remove this video?</h2>
            <p id="remove-video-description" className="mt-3 text-sm leading-relaxed text-text-secondary"><span className="font-medium text-text-primary">{videoToRemove.title}</span> and its practice history will be permanently removed from your library{videoToRemove.source_type === 'local' ? ', including the copy stored by this app' : ''}. This cannot be undone.</p>
            {removeError && <p role="alert" className="mt-4 text-sm text-danger">{removeError}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="secondary-button justify-center" onClick={() => { setVideoToRemove(null); setRemoveError(''); }} disabled={removeVideo.isPending}>Keep video</button>
              <button type="button" className="inline-flex items-center justify-center gap-2 rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-60" onClick={() => removeVideo.mutate(videoToRemove.id)} disabled={removeVideo.isPending}>
                <Trash2 size={16} />
                {removeVideo.isPending ? 'Removing…' : 'Remove video'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
