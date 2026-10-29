import { useState, useRef, useEffect, useCallback } from 'react';
import { useStudyStore } from '../stores/useStudyStore';

export type RecorderState =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'stopping'
  | 'recorded'
  | 'error';

export interface UseRecorderOptions {
  maxDurationSeconds?: number;
  onBeforeStart?: () => void;
  onRecordComplete?: (blob: Blob, duration: number) => void;
}

export interface UseRecorderReturn {
  state: RecorderState;
  isRecording: boolean;
  audioBlob: Blob | null;
  audioUrl: string | null;
  durationSeconds: number;
  errorMessage: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
}

/**
 * Detects the optimal supported audio MIME type in the current browser.
 * Prefers audio/webm;codecs=opus per Section 14.15.
 */
export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

/**
 * Hook managing local audio recording with MediaRecorder per Section 8.2 and Section 14.15.
 * Features:
 * - 30-second hard limit with automatic stop
 * - Immediate hardware release (stops all tracks upon recording completion)
 * - Object URL lifecycle management (no memory leaks)
 * - Navigation guard synchronization via useStudyStore
 * - Clean permission denial and device absence messaging
 */
export function useRecorder(options: UseRecorderOptions = {}): UseRecorderReturn {
  const {
    maxDurationSeconds = 30,
    onBeforeStart,
    onRecordComplete,
  } = options;

  const setIsRecordingStore = useStudyStore((s) => s.setIsRecording);
  const discardRecordingRequested = useStudyStore((s) => s.discardRecordingRequested);

  const [state, setState] = useState<RecorderState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const isCancelledRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const prevDiscardCountRef = useRef(discardRecordingRequested);
  const audioUrlRef = useRef<string | null>(null);
  audioUrlRef.current = audioUrl;

  // Release microphone hardware immediately
  const releaseMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset recording to idle, safely stopping hardware and discarding chunks
  const resetRecording = useCallback(() => {
    isCancelledRef.current = true;
    clearTimer();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;

    releaseMediaStream();
    setIsRecordingStore(false);

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      setAudioUrl(null);
    }
    chunksRef.current = [];
    setAudioBlob(null);
    setDurationSeconds(0);
    setErrorMessage(null);
    setState('idle');
  }, [clearTimer, releaseMediaStream, setIsRecordingStore]);

  // Clean up on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isCancelledRef.current = true;
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.ondataavailable = null;
          mediaRecorderRef.current.onstop = null;
          mediaRecorderRef.current.stop();
        } catch {}
      }
      mediaRecorderRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
        streamRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setIsRecordingStore(false);
    };
  }, [setIsRecordingStore]);

  // Listen to global discard requests
  useEffect(() => {
    if (discardRecordingRequested !== prevDiscardCountRef.current) {
      prevDiscardCountRef.current = discardRecordingRequested;
      resetRecording();
    }
  }, [discardRecordingRequested, resetRecording]);

  // Stop recording normally
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      setState('stopping');
      clearTimer();
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.error('Error stopping MediaRecorder:', err);
      }
    }
  }, [clearTimer]);

  // Start recording
  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    isCancelledRef.current = false;

    // Pause YouTube playback before recording begins per Section 14.15
    if (onBeforeStart) {
      try {
        onBeforeStart();
      } catch (err) {
        console.warn('onBeforeStart callback error:', err);
      }
    }

    // Check mediaDevices support
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setState('error');
      setErrorMessage(
        'Audio recording is not supported in this browser environment. Please use a modern browser.'
      );
      return;
    }

    // Clean up any existing recording
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setAudioBlob(null);
    setDurationSeconds(0);
    chunksRef.current = [];

    setState('requesting_permission');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (isCancelledRef.current || !isMountedRef.current) {
        // Late permission arrived after unmount or cancellation! Stop tracks immediately.
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore
          }
        });
        return;
      }
      streamRef.current = stream;
    } catch (err: unknown) {
      if (isCancelledRef.current || !isMountedRef.current) {
        return;
      }
      setState('error');
      setIsRecordingStore(false);
      const error = err as Error;
      if (
        error.name === 'NotAllowedError' ||
        error.name === 'PermissionDeniedError' ||
        error.message?.includes('Permission denied')
      ) {
        setErrorMessage(
          'Microphone permission was denied. Please allow microphone access in your browser site settings and try again.'
        );
      } else if (
        error.name === 'NotFoundError' ||
        error.name === 'DevicesNotFoundError'
      ) {
        setErrorMessage('No microphone device found. Please connect an audio input device.');
      } else {
        setErrorMessage(
          `Unable to access microphone: ${error.message || 'unknown error'}`
        );
      }
      return;
    }

    const mimeType = getSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
    } catch (err: unknown) {
      releaseMediaStream();
      setState('error');
      setIsRecordingStore(false);
      setErrorMessage('Failed to initialize MediaRecorder with supported audio codec.');
      return;
    }

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onerror = () => {
      clearTimer();
      releaseMediaStream();
      setIsRecordingStore(false);
      setState('error');
      setErrorMessage('An error occurred during audio recording.');
    };

    recorder.onstop = () => {
      clearTimer();
      releaseMediaStream();
      setIsRecordingStore(false);

      const effectiveMime = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: effectiveMime });
      const finalDuration = Math.min(
        maxDurationSeconds,
        Math.max(0.1, (Date.now() - startTimeRef.current) / 1000)
      );

      const objectUrl = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioUrl(objectUrl);
      setDurationSeconds(Math.round(finalDuration * 10) / 10);
      setState('recorded');

      if (onRecordComplete) {
        onRecordComplete(blob, finalDuration);
      }
    };

    try {
      recorder.start(250); // Emit chunks every 250ms
      startTimeRef.current = Date.now();
      setState('recording');
      setIsRecordingStore(true);

      // Start elapsed timer with 100ms granularity
      timerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (elapsed >= maxDurationSeconds) {
          setDurationSeconds(maxDurationSeconds);
          stopRecording();
        } else {
          setDurationSeconds(Math.round(elapsed * 10) / 10);
        }
      }, 100);
    } catch (err: unknown) {
      clearTimer();
      releaseMediaStream();
      setIsRecordingStore(false);
      setState('error');
      setErrorMessage('Failed to start audio recording stream.');
    }
  }, [
    audioUrl,
    maxDurationSeconds,
    onBeforeStart,
    onRecordComplete,
    clearTimer,
    releaseMediaStream,
    stopRecording,
    setIsRecordingStore,
  ]);

  return {
    state,
    isRecording: state === 'recording',
    audioBlob,
    audioUrl,
    durationSeconds,
    errorMessage,
    startRecording,
    stopRecording,
    resetRecording,
  };
}
