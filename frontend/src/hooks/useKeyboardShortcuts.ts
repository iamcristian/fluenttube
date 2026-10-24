import { useEffect } from 'react';

export interface ShortcutHandlers {
  onReplay?: () => void;
  onHint?: () => void;
  onPrevSegment?: () => void;
  onNextSegment?: () => void;
  onClose?: () => void;
  isRecording?: boolean;
  enabled?: boolean;
}

/**
 * Single Shortcut Map (Section 8.4):
 * - Replay current sentence: Alt+R
 * - Hint: Alt+H
 * - Previous / next sentence: Alt+Left / Alt+Right (prevent default page history)
 * - Close modal/drawer: Escape
 * - Segment navigation disabled while recording
 * - Tab / Shift+Tab standard behavior (never intercepted)
 */
export function useKeyboardShortcuts({
  onReplay,
  onHint,
  onPrevSegment,
  onNextSegment,
  onClose,
  isRecording = false,
  enabled = true,
}: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: Close modal/drawer
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
        return;
      }

      // Alt+R: Replay current sentence
      if (e.altKey && (e.key === 'r' || e.key === 'R') && onReplay) {
        e.preventDefault();
        onReplay();
        return;
      }

      // Alt+H: Hint
      if (e.altKey && (e.key === 'h' || e.key === 'H') && onHint) {
        e.preventDefault();
        onHint();
        return;
      }

      // Alt+Left / Alt+Right: Segment navigation (blocked during recording)
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault(); // Prevent browser back navigation
        if (!isRecording && onPrevSegment) {
          onPrevSegment();
        }
        return;
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault(); // Prevent browser forward navigation
        if (!isRecording && onNextSegment) {
          onNextSegment();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onReplay, onHint, onPrevSegment, onNextSegment, onClose, isRecording, enabled]);
}
