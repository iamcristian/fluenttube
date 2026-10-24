import {
  ApiErrorPayload,
  HealthResponse,
  IngestRequestDTO,
  IngestResponseDTO,
  JobDTO,
  PaginatedResponse,
  VideoDetailDTO,
  VideoProgressResponseDTO,
  VideoSummaryDTO,
} from './types';
const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    return `${window.location.protocol}//${window.location.hostname}:8000/api`;
  }
  return 'http://127.0.0.1:8000/api';
};

const API_BASE_URL = getApiBaseUrl();

export class ApiError extends Error {
  code: string;
  retryable: boolean;
  details: Record<string, unknown>;
  requestId: string;
  statusCode: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryable: boolean = false,
    details: Record<string, unknown> = {},
    requestId: string = ''
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.requestId = requestId;
  }
}

export async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorPayload: ApiErrorPayload | null = null;
    try {
      errorPayload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Non-JSON response
    }

    if (errorPayload && errorPayload.error) {
      const err = errorPayload.error;
      throw new ApiError(
        response.status,
        err.code,
        err.message,
        err.retryable,
        err.details,
        err.request_id
      );
    }

    throw new ApiError(
      response.status,
      'HTTP_ERROR',
      `Request failed with status ${response.status}`,
      false,
      {},
      ''
    );
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  getHealth: (): Promise<HealthResponse> => request<HealthResponse>('/health'),
  getJob: (jobId: string): Promise<JobDTO> => request<JobDTO>(`/jobs/${jobId}`),
  ingestVideo: (data: IngestRequestDTO): Promise<IngestResponseDTO> =>
    request<IngestResponseDTO>('/videos/ingest', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getVideos: (limit: number = 50, offset: number = 0): Promise<PaginatedResponse<VideoSummaryDTO>> =>
    request<PaginatedResponse<VideoSummaryDTO>>(`/videos?limit=${limit}&offset=${offset}`),
  getVideo: (id: number): Promise<VideoDetailDTO> => request<VideoDetailDTO>(`/videos/${id}`),
  updateVideoProgress: (id: number, lastSegmentId: number): Promise<VideoProgressResponseDTO> =>
    request<VideoProgressResponseDTO>(`/videos/${id}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ last_segment_id: lastSegmentId }),
    }),
  createSession: (segmentId: number, data?: { client_request_id?: string }): Promise<import('./types').SessionResponseDTO> =>
    request<import('./types').SessionResponseDTO>(`/segments/${segmentId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  getSession: (sessionId: string): Promise<import('./types').SessionResponseDTO> =>
    request<import('./types').SessionResponseDTO>(`/sessions/${sessionId}`),
  getHint: (sessionId: string, displayTokenIndex: number): Promise<import('./types').HintResponseDTO> =>
    request<import('./types').HintResponseDTO>(`/sessions/${sessionId}/hint`, {
      method: 'POST',
      body: JSON.stringify({ display_token_index: displayTokenIndex }),
    }),
  revealAnswer: (sessionId: string): Promise<import('./types').RevealResponseDTO> =>
    request<import('./types').RevealResponseDTO>(`/sessions/${sessionId}/reveal`, {
      method: 'POST',
    }),
  checkDictation: (sessionId: string, data: import('./types').CheckRequestDTO): Promise<import('./types').DictationResultDTO> =>
    request<import('./types').DictationResultDTO>(`/sessions/${sessionId}/check`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  evaluateShadowing: (
    segmentId: number,
    audioBlob: Blob,
    clientRequestId?: string
  ): Promise<import('./types').ShadowingEvaluateResponseDTO> => {
    const formData = new FormData();
    const type = audioBlob.type || '';
    const extension = type.includes('ogg')
      ? 'ogg'
      : type.includes('mp4')
      ? 'mp4'
      : type.includes('wav')
      ? 'wav'
      : 'webm';
    formData.append('audio_file', audioBlob, `shadowing_capture.${extension}`);
    formData.append('segment_id', segmentId.toString());
    formData.append(
      'client_request_id',
      clientRequestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}`)
    );

    return request<import('./types').ShadowingEvaluateResponseDTO>('/shadowing/evaluate', {
      method: 'POST',
      body: formData,
    });
  },
  getShadowingAttempts: (
    segmentId: number,
    limit: number = 20,
    offset: number = 0
  ): Promise<PaginatedResponse<import('./types').ShadowingAttemptDTO>> =>
    request<PaginatedResponse<import('./types').ShadowingAttemptDTO>>(
      `/segments/${segmentId}/shadowing-attempts?limit=${limit}&offset=${offset}`
    ),
  explainSegment: (
    segmentId: number,
    language: string = 'es'
  ): Promise<import('./types').TutorExplanationDTO> =>
    request<import('./types').TutorExplanationDTO>('/tutor/explain', {
      method: 'POST',
      body: JSON.stringify({ segment_id: segmentId, language }),
    }),
  getDictionaryEntry: (word: string): Promise<import('./types').DictionaryEntryDTO> =>
    request<import('./types').DictionaryEntryDTO>(`/british/dictionary?word=${encodeURIComponent(word)}`),
  getBritishAudioUrl: (text: string): string =>
    `/api/british/audio?text=${encodeURIComponent(text)}`,
};


