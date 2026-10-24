import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Server,
  Database,
  Mic,
  Sparkles,
  Volume2,
  Repeat,
  Globe,
  Gauge,
  Key,
  Shield,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useSettingsStore } from '../stores/useSettingsStore';

export interface SettingsPageProps {
  onBackToLibrary: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBackToLibrary }) => {
  const {
    playbackSpeed,
    autoLoop,
    soundEffect,
    explanationLanguage,
    setPlaybackSpeed,
    setAutoLoop,
    setSoundEffect,
    setExplanationLanguage,
  } = useSettingsStore();

  const {
    data: health,
    isLoading: isHealthLoading,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.getHealth(),
    refetchInterval: 10000,
  });

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-30 w-full">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onBackToLibrary}
              aria-label="Back to Library"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-control text-xs font-semibold text-text-secondary hover:text-white bg-surface-raised border border-border/80 hover:border-border transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Library</span>
            </button>
            <div className="h-4 w-px bg-border shrink-0" />
            <h1 className="text-sm font-semibold text-white">System Settings & Health</h1>
          </div>

          <button
            type="button"
            onClick={() => refetchHealth()}
            aria-label="Refresh health diagnostics"
            className="p-1.5 rounded-control text-text-secondary hover:text-white bg-surface-raised border border-border transition"
            title="Refresh system diagnostics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Settings Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Section 1: System Health & Hardware Diagnostics */}
        <section aria-labelledby="diagnostics-heading" className="space-y-3">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-accent" />
            <h2 id="diagnostics-heading" className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Local System Diagnostics & Engine Status
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Backend Server */}
            <div className="p-4 rounded-panel bg-surface border border-border flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary font-medium">Backend Server</span>
                <Server className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                />
                <span className="text-sm font-bold text-white capitalize">
                  {isHealthLoading ? 'Checking...' : health?.status || 'Offline'}
                </span>
              </div>
              <span className="text-[11px] text-text-secondary">127.0.0.1:8000</span>
            </div>

            {/* Database */}
            <div className="p-4 rounded-panel bg-surface border border-border flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary font-medium">SQLite Database</span>
                <Database className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health?.database === 'ok' ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                />
                <span className="text-sm font-bold text-white capitalize">
                  {isHealthLoading ? 'Checking...' : health?.database || 'Unreachable'}
                </span>
              </div>
              <span className="text-[11px] text-text-secondary">WAL mode enabled</span>
            </div>

            {/* ASR Speech Engine */}
            <div className="p-4 rounded-panel bg-surface border border-border flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary font-medium">Speech ASR Engine</span>
                <Mic className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health?.speech.state === 'ready'
                      ? 'bg-emerald-400'
                      : health?.speech.state === 'unloaded'
                      ? 'bg-blue-400'
                      : 'bg-amber-400'
                  }`}
                />
                <span className="text-sm font-bold text-white capitalize">
                  {health?.speech.state || 'Unloaded'}
                </span>
              </div>
              <span className="text-[11px] text-text-secondary font-mono truncate">
                {health?.speech.gpu_name
                  ? `${health.speech.gpu_name} (CUDA)`
                  : health?.speech.device
                  ? `${health.speech.device.toUpperCase()}`
                  : 'Lazy-loaded on first speech'}
              </span>
            </div>

            {/* Contextual Tutor */}
            <div className="p-4 rounded-panel bg-surface border border-border flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary font-medium">AI Grammar Tutor</span>
                <Sparkles className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health?.tutor.enabled ? 'bg-emerald-400' : 'bg-slate-500'
                  }`}
                />
                <span className="text-sm font-bold text-white">
                  {health?.tutor.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <span className="text-[11px] text-text-secondary font-mono">
                {health?.tutor.provider ? `${health.tutor.provider} (cloud)` : 'Unconfigured'}
              </span>
            </div>
          </div>
        </section>

        {/* Section 2: Local User Preferences */}
        <section aria-labelledby="preferences-heading" className="p-6 rounded-panel bg-surface border border-border space-y-5">
          <div className="flex items-center space-x-2 border-b border-border/80 pb-3">
            <Gauge className="w-4 h-4 text-accent" />
            <h2 id="preferences-heading" className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Study Preferences (Saved Locally)
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Default Playback Speed */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white flex items-center space-x-2">
                <Gauge className="w-3.5 h-3.5 text-accent" />
                <span>Default Playback Speed</span>
              </label>
              <p className="text-[11px] text-text-secondary">
                Initial speed when starting segment playback
              </p>
              <div className="flex items-center space-x-2 pt-1">
                {[0.75, 1.0, 1.25].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => setPlaybackSpeed(speed)}
                    className={`px-3 py-1.5 rounded-control text-xs font-mono font-semibold transition ${
                      playbackSpeed === speed
                        ? 'bg-accent text-background font-bold shadow-md'
                        : 'bg-surface-raised text-text-secondary hover:text-white border border-border'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* Default Explanation Language */}
            <div className="space-y-2">
              <label htmlFor="pref-lang" className="text-xs font-semibold text-white flex items-center space-x-2">
                <Globe className="w-3.5 h-3.5 text-accent" />
                <span>Tutor Explanation Language</span>
              </label>
              <p className="text-[11px] text-text-secondary">
                Target language for AI contextual explanations
              </p>
              <div className="pt-1">
                <select
                  id="pref-lang"
                  value={explanationLanguage}
                  onChange={(e) => setExplanationLanguage(e.target.value)}
                  className="px-3 py-1.5 rounded-control bg-surface-raised border border-border text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="es">Spanish (Español)</option>
                  <option value="en">English</option>
                  <option value="fr">French (Français)</option>
                  <option value="de">German (Deutsch)</option>
                  <option value="ja">Japanese (日本語)</option>
                  <option value="pt">Portuguese (Português)</option>
                </select>
              </div>
            </div>

            {/* Auto-Loop Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white flex items-center space-x-2">
                <Repeat className="w-3.5 h-3.5 text-accent" />
                <span>Continuous Sentence Looping</span>
              </label>
              <p className="text-[11px] text-text-secondary">
                Automatically loop sentence audio until paused
              </p>
              <label className="flex items-center space-x-2.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoLoop}
                  onChange={(e) => setAutoLoop(e.target.checked)}
                  className="w-4 h-4 rounded text-accent focus:ring-accent bg-surface-raised border-border"
                />
                <span className="text-xs text-slate-300">
                  {autoLoop ? 'Auto-loop enabled' : 'Play once and pause'}
                </span>
              </label>
            </div>

            {/* Sound Effect Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white flex items-center space-x-2">
                <Volume2 className="w-3.5 h-3.5 text-accent" />
                <span>Audio Sound Effects</span>
              </label>
              <p className="text-[11px] text-text-secondary">
                Play subtle chime on exact dictation matches
              </p>
              <label className="flex items-center space-x-2.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soundEffect}
                  onChange={(e) => setSoundEffect(e.target.checked)}
                  className="w-4 h-4 rounded text-accent focus:ring-accent bg-surface-raised border-border"
                />
                <span className="text-xs text-slate-300">
                  {soundEffect ? 'Sound effects enabled' : 'Muted'}
                </span>
              </label>
            </div>
          </div>
        </section>

        {/* Section 3: AI Tutor Setup Instructions (Section 8.2 Security Guard: No frontend API key input!) */}
        <section aria-labelledby="tutor-setup-heading" className="p-6 rounded-panel bg-surface border border-border space-y-4">
          <div className="flex items-center space-x-2 border-b border-border/80 pb-3">
            <Key className="w-4 h-4 text-amber-400" />
            <h2 id="tutor-setup-heading" className="text-xs font-bold uppercase tracking-wider text-text-primary">
              AI Grammar Tutor Configuration Guide
            </h2>
          </div>

          <div className="space-y-3 text-xs text-text-secondary leading-relaxed">
            <p>
              To protect your credentials, <strong className="text-white">API keys are never entered in the web interface</strong> or exposed in client bundles. Configure your Gemini API key in the backend environment file.
            </p>

            <div className="p-4 rounded-control bg-background border border-border font-mono text-[11px] text-slate-300 space-y-1">
              <p className="text-text-secondary"># In backend/.env:</p>
              <p className="text-accent">TUTOR_ENABLED=true</p>
              <p className="text-emerald-400">GEMINI_API_KEY=AIzaSyYourActualApiKeyHere</p>
              <p className="text-accent">TUTOR_MODEL=gemini-3.5-flash-lite</p>
              <p className="text-accent">TUTOR_TIMEOUT_SECONDS=30</p>
            </div>

            <div className="flex items-start space-x-2 text-[11px] text-slate-400 bg-surface-raised/50 p-3 rounded-control border border-border/60">
              <HelpCircle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <p>
                After updating <code className="text-white">backend/.env</code>, restart your backend server (<code className="text-white">uvicorn</code>) for the new key to take effect.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Privacy & Offline Boundaries */}
        <section className="p-4 rounded-panel bg-surface-raised/40 border border-border/60 flex items-start space-x-3 text-xs text-text-secondary leading-relaxed">
          <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-semibold text-white">Local Privacy Boundaries</h3>
            <p>
              ASR speech recognition and dictation processing execute 100% locally on your machine with zero external telemetry. YouTube video playback requires an internet connection to stream iframe video frames.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};
