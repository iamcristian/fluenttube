import { create } from 'zustand';

export interface UserPreferences {
  playbackSpeed: number;
  autoLoop: boolean;
  autoAdvance: boolean;
  soundEffect: boolean;
  explanationLanguage: string;
}

export interface SettingsState extends UserPreferences {
  setPlaybackSpeed: (speed: number) => void;
  setAutoLoop: (loop: boolean) => void;
  setAutoAdvance: (advance: boolean) => void;
  setSoundEffect: (sound: boolean) => void;
  setExplanationLanguage: (lang: string) => void;
  resetPreferences: () => void;
}

const STORAGE_KEY = 'fluenttube_user_preferences';

export const DEFAULT_PREFERENCES: UserPreferences = {
  playbackSpeed: 1.0,
  autoLoop: true,
  autoAdvance: false,
  soundEffect: true,
  explanationLanguage: 'es',
};

function loadStoredPreferences(): UserPreferences {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
      }
    }
  } catch (err) {
    console.warn('Failed to parse stored preferences:', err);
  }
  return DEFAULT_PREFERENCES;
}

function savePreferences(prefs: UserPreferences): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch (err) {
    console.warn('Failed to save preferences:', err);
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = loadStoredPreferences();

  return {
    ...initial,

    setAutoAdvance: (autoAdvance) => {
      set({ autoAdvance });
      const { playbackSpeed, autoLoop, soundEffect, explanationLanguage } = get();
      savePreferences({ playbackSpeed, autoLoop, autoAdvance, soundEffect, explanationLanguage });
    },

    setPlaybackSpeed: (playbackSpeed) => {
      set({ playbackSpeed });
      const { autoLoop, autoAdvance, soundEffect, explanationLanguage } = get();
      savePreferences({ playbackSpeed, autoLoop, autoAdvance, soundEffect, explanationLanguage });
    },

    setAutoLoop: (autoLoop) => {
      set({ autoLoop });
      const { playbackSpeed, autoAdvance, soundEffect, explanationLanguage } = get();
      savePreferences({ playbackSpeed, autoLoop, autoAdvance, soundEffect, explanationLanguage });
    },

    setSoundEffect: (soundEffect) => {
      set({ soundEffect });
      const { playbackSpeed, autoLoop, autoAdvance, explanationLanguage } = get();
      savePreferences({ playbackSpeed, autoLoop, autoAdvance, soundEffect, explanationLanguage });
    },

    setExplanationLanguage: (explanationLanguage) => {
      set({ explanationLanguage });
      const { playbackSpeed, autoLoop, autoAdvance, soundEffect } = get();
      savePreferences({ playbackSpeed, autoLoop, autoAdvance, soundEffect, explanationLanguage });
    },

    resetPreferences: () => {
      set(DEFAULT_PREFERENCES);
      savePreferences(DEFAULT_PREFERENCES);
    },
  };
});
