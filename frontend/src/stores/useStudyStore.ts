import { create } from 'zustand';
import {
  SegmentDTO,
  SessionResponseDTO,
  DictationResultDTO,
  VideoDetailDTO,
  ShadowingResultDTO,
  TutorExplanationDTO,
} from '../api/types';

export type StudyStep = 'listen' | 'dictate' | 'shadow';

export interface StudyState {
  video: VideoDetailDTO | null;
  activeSegmentId: number | null;
  activePosition: number;
  drafts: Record<number, string>;
  sessions: Record<number, SessionResponseDTO>;
  results: Record<number, DictationResultDTO>;
  shadowingResults: Record<number, ShadowingResultDTO>;
  shadowingJobs: Record<number, string>;
  tutorExplanations: Record<string, TutorExplanationDTO>;
  isTutorOpen: boolean;
  staleDiffs: Record<number, boolean>;
  isRecording: boolean;
  showRecordingWarning: boolean;
  isSidebarOpen: boolean;
  activeStep: StudyStep;

  // Actions
  setVideo: (video: VideoDetailDTO) => void;
  selectSegment: (
    segmentId: number,
    options?: { force?: boolean }
  ) => { success: boolean; reason?: string };
  selectSegmentByPosition: (
    position: number,
    options?: { force?: boolean }
  ) => { success: boolean; reason?: string };
  setDraft: (segmentId: number, text: string) => void;
  getCurrentDraft: () => string;
  setSession: (segmentId: number, session: SessionResponseDTO) => void;
  setResult: (segmentId: number, result: DictationResultDTO) => void;
  setShadowingResult: (segmentId: number, result: ShadowingResultDTO) => void;
  setShadowingJob: (segmentId: number, jobId: string | null) => void;
  setTutorExplanation: (segmentId: number, language: string, explanation: TutorExplanationDTO) => void;
  setIsTutorOpen: (open: boolean) => void;
  setStaleDiff: (segmentId: number, isStale: boolean) => void;
  updateSegment: (segmentId: number, updates: Partial<SegmentDTO>) => void;
  setIsRecording: (recording: boolean) => void;
  setShowRecordingWarning: (show: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveStep: (step: StudyStep) => void;
  reset: () => void;
}

/**
 * Resolves the initial active segment according to the V2 specification:
 * 1. Valid last_segment_id if present in video.segments.
 * 2. Otherwise, first incomplete segment (!completed).
 * 3. Otherwise (all completed), first segment (position 0).
 */
export function resolveInitialSegment(video: VideoDetailDTO): SegmentDTO | null {
  if (!video.segments || video.segments.length === 0) {
    return null;
  }

  if (video.last_segment_id != null) {
    const found = video.segments.find((s) => s.id === video.last_segment_id);
    if (found) {
      return found;
    }
  }

  const firstIncomplete = video.segments.find((s) => !s.completed);
  if (firstIncomplete) {
    return firstIncomplete;
  }

  return video.segments[0];
}

export const useStudyStore = create<StudyState>((set, get) => ({
  video: null,
  activeSegmentId: null,
  activePosition: 0,
  drafts: {},
  sessions: {},
  results: {},
  shadowingResults: {},
  shadowingJobs: {},
  tutorExplanations: {},
  isTutorOpen: false,
  staleDiffs: {},
  isRecording: false,
  showRecordingWarning: false,
  isSidebarOpen: false,
  activeStep: 'dictate',

  setVideo: (video: VideoDetailDTO) => {
    const currentActiveId = get().activeSegmentId;
    const currentVideoId = get().video?.id;

    // If reloading the same video and activeSegmentId is still valid, retain it
    if (currentVideoId === video.id && currentActiveId != null) {
      const match = video.segments.find((s) => s.id === currentActiveId);
      if (match) {
        set({
          video,
          activeSegmentId: match.id,
          activePosition: match.position,
        });
        return;
      }
    }

    const initial = resolveInitialSegment(video);
    set({
      video,
      activeSegmentId: initial ? initial.id : null,
      activePosition: initial ? initial.position : 0,
    });
  },

  selectSegment: (segmentId: number, options?: { force?: boolean }) => {
    const state = get();

    // Guard against navigating away during audio recording
    if (state.isRecording && !options?.force) {
      set({ showRecordingWarning: true });
      return { success: false, reason: 'recording_in_progress' };
    }

    if (!state.video) {
      return { success: false, reason: 'no_video_loaded' };
    }

    const target = state.video.segments.find((s) => s.id === segmentId);
    if (!target) {
      return { success: false, reason: 'segment_not_found' };
    }

    set({
      activeSegmentId: target.id,
      activePosition: target.position,
      showRecordingWarning: false,
    });

    return { success: true };
  },

  selectSegmentByPosition: (position: number, options?: { force?: boolean }) => {
    const state = get();
    if (!state.video || !state.video.segments) {
      return { success: false, reason: 'no_video_loaded' };
    }

    const target = state.video.segments[position];
    if (!target) {
      return { success: false, reason: 'invalid_position' };
    }

    return get().selectSegment(target.id, options);
  },

  setDraft: (segmentId: number, text: string) => {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [segmentId]: text,
      },
      staleDiffs: {
        ...state.staleDiffs,
        [segmentId]: true,
      },
    }));
  },

  getCurrentDraft: () => {
    const { activeSegmentId, drafts } = get();
    if (activeSegmentId == null) return '';
    return drafts[activeSegmentId] ?? '';
  },

  setSession: (segmentId: number, session: SessionResponseDTO) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [segmentId]: session,
      },
    }));
  },

  setResult: (segmentId: number, result: DictationResultDTO) => {
    set((state) => ({
      results: {
        ...state.results,
        [segmentId]: result,
      },
      staleDiffs: {
        ...state.staleDiffs,
        [segmentId]: false,
      },
    }));
  },

  setShadowingResult: (segmentId: number, result: ShadowingResultDTO) => {
    set((state) => ({
      shadowingResults: {
        ...state.shadowingResults,
        [segmentId]: result,
      },
    }));
  },

  setShadowingJob: (segmentId: number, jobId: string | null) => {
    set((state) => {
      const nextJobs = { ...state.shadowingJobs };
      if (jobId) {
        nextJobs[segmentId] = jobId;
      } else {
        delete nextJobs[segmentId];
      }
      return { shadowingJobs: nextJobs };
    });
  },

  setStaleDiff: (segmentId: number, isStale: boolean) => {
    set((state) => ({
      staleDiffs: {
        ...state.staleDiffs,
        [segmentId]: isStale,
      },
    }));
  },

  updateSegment: (segmentId: number, updates: Partial<SegmentDTO>) => {
    set((state) => {
      if (!state.video) return state;

      const updatedSegments = state.video.segments.map((seg) => {
        if (seg.id === segmentId) {
          return { ...seg, ...updates };
        }
        return seg;
      });

      const completedCount = updatedSegments.filter((s) => s.completed).length;

      return {
        video: {
          ...state.video,
          completed_count: completedCount,
          segments: updatedSegments,
        },
      };
    });
  },

  setIsRecording: (recording: boolean) => {
    set((state) => ({
      isRecording: recording,
      showRecordingWarning: recording ? state.showRecordingWarning : false,
    }));
  },

  setShowRecordingWarning: (show: boolean) => {
    set({ showRecordingWarning: show });
  },

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setSidebarOpen: (open: boolean) => {
    set({ isSidebarOpen: open });
  },

  setActiveStep: (step: StudyStep) => {
    set({ activeStep: step });
  },

  setIsTutorOpen: (open: boolean) => {
    set({ isTutorOpen: open });
  },

  setTutorExplanation: (segmentId: number, language: string, explanation: TutorExplanationDTO) => {
    const key = `${segmentId}_${language}`;
    set((state) => ({
      tutorExplanations: {
        ...state.tutorExplanations,
        [key]: explanation,
      },
    }));
  },

  reset: () => {
    set({
      video: null,
      activeSegmentId: null,
      activePosition: 0,
      drafts: {},
      sessions: {},
      results: {},
      shadowingResults: {},
      shadowingJobs: {},
      tutorExplanations: {},
      isTutorOpen: false,
      staleDiffs: {},
      isRecording: false,
      showRecordingWarning: false,
      isSidebarOpen: false,
      activeStep: 'dictate',
    });
  },
}));
