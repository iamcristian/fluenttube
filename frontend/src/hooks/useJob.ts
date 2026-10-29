import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { JobDTO, JobErrorDTO } from '../api/types';

export interface UseJobOptions {
  enabled?: boolean;
  pollInterval?: number;
  onSucceeded?: (result: Record<string, unknown> | null, job: JobDTO) => void;
  onFailed?: (error: JobErrorDTO | null, job: JobDTO) => void;
}

export function useJob(jobId: string | null, options: UseJobOptions = {}) {
  const { enabled = true, pollInterval = 1000, onSucceeded, onFailed } = options;
  const isEnabled = enabled && Boolean(jobId);
  const handledRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => {
      if (!jobId) throw new Error('No jobId provided');
      return apiClient.getJob(jobId);
    },
    enabled: isEnabled,
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.status;
      if (status === 'queued' || status === 'running') {
        return pollInterval;
      }
      const job = queryState.state.data;
      if (job?.kind === 'local_ingest' && job.error?.code === 'JOB_INTERRUPTED' && job.error.details?.can_resume !== false) {
        // A restarted local app may have recovered the same job. This only reads local status.
        return pollInterval;
      }
      return false;
    },
    refetchOnWindowFocus: false,
  });

  const job = query.data || null;

  useEffect(() => {
    if (!job) return;
    if (job.status === 'queued' || job.status === 'running') {
      handledRef.current = null;
      return;
    }
    const key = `${job.id}:${job.status}`;
    if (handledRef.current === key) return;

    if (job.status === 'succeeded') {
      handledRef.current = key;
      onSucceeded?.(job.result ?? null, job);
    } else if (job.status === 'failed') {
      handledRef.current = key;
      onFailed?.(job.error ?? null, job);
    }
  }, [job, onSucceeded, onFailed]);

  return {
    job,
    isLoading: query.isLoading,
    isPolling: job?.status === 'queued' || job?.status === 'running',
    error: query.error,
    refetch: query.refetch,
  };
}
