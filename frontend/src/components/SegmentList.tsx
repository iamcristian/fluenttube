import React, { useEffect, useRef } from 'react';
import { CheckCircle2, Eye, Lock } from 'lucide-react';
import { SegmentDTO } from '../api/types';
import { useStudyStore } from '../stores/useStudyStore';

export interface SegmentListProps {
  segments: SegmentDTO[];
  activeSegmentId: number | null;
  onSelectSegment: (segmentId: number) => void;
  className?: string;
}

export const SegmentList: React.FC<SegmentListProps> = ({
  segments,
  activeSegmentId,
  onSelectSegment,
  className = '',
}) => {
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const { retryingSegmentId } = useStudyStore();

  // Automatically scroll active segment into view within the container
  useEffect(() => {
    if (
      activeItemRef.current &&
      typeof activeItemRef.current.scrollIntoView === 'function'
    ) {
      activeItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [activeSegmentId]);

  return (
    <div
      role="list"
      aria-label="Sentence segment list"
      className={`space-y-1.5 overflow-y-auto max-h-[500px] pr-1.5 custom-scrollbar ${className}`}
    >
      {segments.map((segment, index) => {
        const isActive = segment.id === activeSegmentId;
        const isRetrying = retryingSegmentId === segment.id;
        const isRevealedOrDone = Boolean((segment.completed || segment.revealed) && !isRetrying);
        const displayNumber = index + 1; // Independent 1-based display number

        let statusIcon = (
          <span
            className="flex items-center text-slate-500"
            title="Incomplete — dictation required"
            aria-label="Incomplete"
          >
            <Lock className="w-3.5 h-3.5" />
          </span>
        );

        if (segment.completed) {
          statusIcon = (
            <span
              className="flex items-center text-emerald-400"
              title="Sentence completed"
              aria-label="Completed"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </span>
          );
        } else if (segment.revealed) {
          statusIcon = (
            <span
              className="flex items-center text-amber-400"
              title="Sentence revealed"
              aria-label="Revealed"
            >
              <Eye className="w-3.5 h-3.5" />
            </span>
          );
        }

        return (
          <button
            key={segment.id}
            ref={isActive ? activeItemRef : null}
            role="listitem"
            type="button"
            onClick={() => onSelectSegment(segment.id)}
            aria-current={isActive ? 'true' : undefined}
            aria-label={`Sentence ${displayNumber}, ${segment.start_seconds.toFixed(1)} to ${segment.end_seconds.toFixed(1)} seconds, ${
              segment.completed ? 'completed' : segment.revealed ? 'revealed' : 'hidden'
            }`}
            className={`w-full text-left p-3 rounded-control transition-all duration-150 flex items-center justify-between border ${
              isActive
                ? 'bg-surface-raised border-accent text-white shadow-md shadow-accent/5 ring-1 ring-accent/30'
                : 'bg-surface/70 border-border/60 text-text-secondary hover:bg-surface-raised/60 hover:border-border hover:text-text-primary'
            }`}
          >
            <div className="flex items-center space-x-2.5 min-w-0 pr-2">
              {/* Display Number independent of DB ID */}
              <span
                className={`font-mono text-xs font-semibold px-1.5 py-0.5 rounded ${
                  isActive
                    ? 'bg-accent/20 text-accent'
                    : 'bg-background/80 text-text-secondary'
                }`}
              >
                #{displayNumber}
              </span>

              {/* Timestamp interval */}
              <span className="font-mono text-[11px] text-slate-400 shrink-0">
                [{segment.start_seconds.toFixed(1)}s - {segment.end_seconds.toFixed(1)}s]
              </span>

              {/* Concealed Answer vs Visible Completed Text */}
              <div className="truncate text-xs">
                {isRevealedOrDone ? (
                  <span className="text-text-primary font-normal">{segment.text}</span>
                ) : (
                  <span
                    className="text-slate-500 font-mono tracking-widest text-[11px] select-none"
                    aria-label="Sentence hidden until completed"
                  >
                    ••••••••••••••••••
                  </span>
                )}
              </div>
            </div>

            {/* Status indicator */}
            <div className="shrink-0 pl-1 flex items-center space-x-1.5">
              {statusIcon}
            </div>
          </button>
        );
      })}
    </div>
  );
};
