import { describe, it, expect, beforeEach } from 'vitest';
import { useStudyStore, resolveInitialSegment } from '../src/stores/useStudyStore';
import { VideoDetailDTO, SegmentDTO } from '../src/api/types';

describe('useStudyStore and resolveInitialSegment', () => {
  const mockSegments: SegmentDTO[] = [
    {
      id: 101,
      video_id: 1,
      position: 0,
      start_seconds: 0.0,
      end_seconds: 2.5,
      text: 'First sentence.',
      timing_quality: 'good',
      completed: true,
      revealed: false,
      shadowing_unlocked: true,
    },
    {
      id: 205,
      video_id: 1,
      position: 1,
      start_seconds: 2.5,
      end_seconds: 5.8,
      text: 'Second non-consecutive sentence.',
      timing_quality: 'good',
      completed: false,
      revealed: false,
      shadowing_unlocked: false,
    },
    {
      id: 309,
      video_id: 1,
      position: 2,
      start_seconds: 5.8,
      end_seconds: 8.2,
      text: 'Third sentence.',
      timing_quality: 'good',
      completed: false,
      revealed: true,
      shadowing_unlocked: false,
    },
  ];

  const mockVideo: VideoDetailDTO = {
    id: 1,
    youtube_id: 'dQw4w9WgXcQ',
    title: 'Test Video Navigation',
    channel: 'Test Channel',
    duration_seconds: 120.0,
    transcription_source: 'captions_manual',
    segment_count: 3,
    completed_count: 1,
    last_segment_id: 205,
    created_at: new Date().toISOString(),
    segments: mockSegments,
  };

  beforeEach(() => {
    useStudyStore.getState().reset();
  });

  describe('resolveInitialSegment', () => {
    it('restores last_segment_id when it exists in segments', () => {
      const initial = resolveInitialSegment(mockVideo);
      expect(initial).not.toBeNull();
      expect(initial?.id).toBe(205);
      expect(initial?.position).toBe(1);
    });

    it('falls back to first incomplete segment if last_segment_id is null or not found', () => {
      const videoWithoutLast: VideoDetailDTO = {
        ...mockVideo,
        last_segment_id: null,
      };
      const initial = resolveInitialSegment(videoWithoutLast);
      // Segment 101 is completed, segment 205 is first incomplete
      expect(initial?.id).toBe(205);
      expect(initial?.position).toBe(1);
    });

    it('falls back to segment 0 if all segments are completed', () => {
      const allDoneVideo: VideoDetailDTO = {
        ...mockVideo,
        last_segment_id: null,
        segments: mockSegments.map((s) => ({ ...s, completed: true })),
      };
      const initial = resolveInitialSegment(allDoneVideo);
      expect(initial?.id).toBe(101);
      expect(initial?.position).toBe(0);
    });

    it('returns null if video has no segments', () => {
      const emptyVideo: VideoDetailDTO = {
        ...mockVideo,
        segments: [],
      };
      expect(resolveInitialSegment(emptyVideo)).toBeNull();
    });
  });

  describe('useStudyStore navigation and state tracking', () => {
    it('initializes with video and sets active position independent of DB ID', () => {
      const store = useStudyStore.getState();
      store.setVideo(mockVideo);

      const state = useStudyStore.getState();
      expect(state.video?.id).toBe(1);
      expect(state.activeSegmentId).toBe(205);
      expect(state.activePosition).toBe(1);
    });

    it('navigates between non-consecutive segment IDs and updates separate position', () => {
      const store = useStudyStore.getState();
      store.setVideo(mockVideo);

      // Select third segment (id: 309, position: 2)
      const res1 = store.selectSegment(309);
      expect(res1.success).toBe(true);
      expect(useStudyStore.getState().activeSegmentId).toBe(309);
      expect(useStudyStore.getState().activePosition).toBe(2);

      // Select first segment (id: 101, position: 0)
      const res2 = store.selectSegment(101);
      expect(res2.success).toBe(true);
      expect(useStudyStore.getState().activeSegmentId).toBe(101);
      expect(useStudyStore.getState().activePosition).toBe(0);
    });

    it('persists and restores saved drafts per segment ID', () => {
      const store = useStudyStore.getState();
      store.setVideo(mockVideo);

      // Set draft for segment 205
      store.setDraft(205, 'My incomplete draft for segment 2');
      expect(store.getCurrentDraft()).toBe('My incomplete draft for segment 2');

      // Switch to segment 101
      store.selectSegment(101);
      expect(store.getCurrentDraft()).toBe('');

      // Set draft for segment 101
      store.setDraft(101, 'Draft for segment 1');
      expect(store.getCurrentDraft()).toBe('Draft for segment 1');

      // Switch back to segment 205 and verify draft is restored
      store.selectSegment(205);
      expect(store.getCurrentDraft()).toBe('My incomplete draft for segment 2');
    });

    it('blocks navigation when recording is in progress and sets warning flag', () => {
      const store = useStudyStore.getState();
      store.setVideo(mockVideo);
      store.selectSegment(101);

      // Start recording
      store.setIsRecording(true);
      expect(useStudyStore.getState().isRecording).toBe(true);

      // Attempt to switch segment
      const result = store.selectSegment(205);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('recording_in_progress');

      // Segment should NOT have changed
      expect(useStudyStore.getState().activeSegmentId).toBe(101);
      expect(useStudyStore.getState().showRecordingWarning).toBe(true);

      // Dismiss warning or force change
      const forceResult = store.selectSegment(205, { force: true });
      expect(forceResult.success).toBe(true);
      expect(useStudyStore.getState().activeSegmentId).toBe(205);
    });

    it('toggles mobile sidebar state', () => {
      const store = useStudyStore.getState();
      expect(store.isSidebarOpen).toBe(false);

      store.toggleSidebar();
      expect(useStudyStore.getState().isSidebarOpen).toBe(true);

      store.toggleSidebar();
      expect(useStudyStore.getState().isSidebarOpen).toBe(false);
    });
  });
});
