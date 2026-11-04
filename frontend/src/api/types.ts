export type SpeechState = 'unloaded' | 'loading' | 'ready' | 'unavailable';
export type JobKind = 'local_ingest' | 'shadowing';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface SpeechHealthDTO {
  state: SpeechState;
  device: string | null;
  model: string | null;
  compute_type: string | null;
  gpu_name: string | null;
  free_vram_mb: number | null;
  last_error: string | null;
}

export interface TutorHealthDTO {
  enabled: boolean;
  provider: string | null;
}

export interface HealthResponse {
  status: string;
  database: string;
  ffmpeg_available: boolean;
  speech: SpeechHealthDTO;
  tutor: TutorHealthDTO;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
  request_id: string;
}

export interface ApiErrorPayload {
  error: ApiErrorDetail;
}

export interface SegmentDTO {
  id: number;
  video_id: number;
  position: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  timing_quality: string;
  completed: boolean;
  revealed: boolean;
  shadowing_unlocked: boolean;
  best_word_match_score?: number | null;
  best_overall_score?: number | null;
}

export interface VideoSummaryDTO {
  id: number;
  source_key: string;
  source_type?: 'local' | 'unavailable';
  title: string;
  channel?: string | null;
  duration_seconds: number;
  transcription_source: string;
  segment_count: number;
  completed_count: number;
  last_segment_id?: number | null;
  created_at: string;
}

export interface VideoDetailDTO extends VideoSummaryDTO {
  segments: SegmentDTO[];
}

export interface JobErrorDTO {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface JobDTO {
  id: string;
  kind: JobKind;
  status: JobStatus;
  stage?: string | null;
  progress?: number | null;
  result?: Record<string, unknown> | null;
  error?: JobErrorDTO | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface IngestResponseDTO {
  job_id?: string | null;
  video_id?: number | null;
  status: string;
  cached: boolean;
}

export interface VideoProgressUpdateDTO {
  last_segment_id: number;
}

export interface VideoProgressResponseDTO {
  last_segment_id: number;
  last_opened_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

export interface SessionCreateDTO {
  client_request_id?: string;
}

export interface SessionResponseDTO {
  id: string;
  segment_id: number;
  hinted_display_indices: number[];
  answer_revealed: boolean;
  last_input: string;
  last_result?: Record<string, unknown> | null;
  created_at: string;
}

export interface HintRequestDTO {
  display_token_index: number;
}

export interface HintResponseDTO {
  display_token_index: number;
  hint_letter: string;
  hinted_display_indices: number[];
}

export interface RevealResponseDTO {
  text: string;
  shadowing_unlocked: boolean;
  completed: boolean;
}

export interface CheckRequestDTO {
  input_text: string;
  client_request_id?: string;
}

export interface AlignmentOpDTO {
  op: 'match' | 'substitution' | 'insertion' | 'omission';
  target_index?: number | null;
  input_index?: number | null;
  target?: string | null;
  input?: string | null;
}

export interface DictationResultDTO {
  attempt_id: number;
  is_exact: boolean;
  score: number;
  distance: number;
  completed: boolean;
  shadowing_unlocked: boolean;
  assisted: boolean;
  alignment: AlignmentOpDTO[];
  rules_version: string;
}

export interface ShadowingEvaluateResponseDTO {
  job_id: string;
  status: string;
}

export type DisplayTokenStatus = 'matched' | 'uncertain' | 'substituted' | 'omitted';

export interface ShadowingDisplayTokenAssessment {
  display_index: number;
  text: string;
  status: DisplayTokenStatus;
  asr_confidence: number | null;
  canonical_tokens: string[];
}

export interface ShadowingInsertion {
  text: string;
  asr_confidence: number | null;
}

export interface ShadowingResultDTO {
  evaluation_version?: string;
  prosody?: ProsodyResult | null;

  attempt_id?: number;
  job_id?: string;
  segment_id: number;
  status: 'scored' | 'unscorable';
  recognized_text: string;
  word_match_score?: number | null;
  timing_similarity_score?: number | null;
  overall_score?: number | null;
  spoken_duration?: number | null;
  reference_duration?: number | null;
  timing_basis?: string | null;
  alignment: ShadowingDisplayTokenAssessment[];
  insertions?: ShadowingInsertion[];
  warning_codes: string[];
  scoring_version?: string;
  model_name?: string;
  device?: string;
  inference_time_ms?: number;
}

export interface ShadowingAttemptDTO {
  evaluation_version?: string;
  prosody?: ProsodyResult | null;

  id: number;
  segment_id: number;
  job_id: string;
  status: 'scored' | 'unscorable';
  recognized_text: string;
  word_match_score?: number | null;
  timing_similarity_score?: number | null;
  overall_score?: number | null;
  alignment: ShadowingDisplayTokenAssessment[];
  warning_codes: string[];
  created_at: string;
}

export type TutorKeyVocabularyType = 'phrasal_verb' | 'idiom' | 'slang' | 'grammar' | 'word';

export interface TutorKeyVocabularyItem {
  example: string;
  term: string;
  type: TutorKeyVocabularyType;
  explanation: string;
}

export interface TutorConnectedSpeechItem {
  fragment: string;
  tip: string;
}

export interface TutorExampleItem {
  sentence: string;
  explanation: string;
}

export interface TutorExplanationDTO {
  spanish_translation: string;
  segment_id: number;
  language: string;
  contextual_meaning: string;
  key_vocabulary: TutorKeyVocabularyItem[];
  connected_speech: TutorConnectedSpeechItem[];
  example: TutorExampleItem;
  cached: boolean;
  provider: string;
  model: string;
}

export interface TutorExplainRequestDTO {
  segment_id: number;
  language?: string;
}

export interface DictionaryEntryDTO {
  word: string;
  phonetic_uk: string | null;
  ipa_options?: string[];
  ipa_quality?: string;
  ipa_source?: string | null;
  ipa_version?: string | null;
  ipa_notes?: string[];
  part_of_speech: string | null;
  definition_en: string | null;
  definition_es: string | null;
  example_en: string | null;
  audio_url: string;
  cached: boolean;
}

export interface VocabularyExampleItem {
  en: string;
  translation: string;
}

export interface VocabularyExplainRequestDTO {
  segment_id: number;
  term: string;
  selection_start?: number | null;
  selection_end?: number | null;
  explanation_language?: string;
}

export interface VocabularyExplainResponseDTO {
  term: string;
  lemma?: string | null;
  part_of_speech?: string | null;
  meaning_en: string;
  translation: string;
  contextual_meaning: string;
  usage_notes: string[];
  examples: VocabularyExampleItem[];
  collocations: string[];
  other_senses: string[];
  warnings: string[];
  cached: boolean;
  provider: string;
  model: string;
}


export interface AcousticFeatures {
  clipped_ratio?: number;
  rms_dbfs?: number;
  status: string;
  duration_seconds: number;
  voiced_ratio: number;
  pitch_times_seconds: number[];
  pitch_semitones: (number | null)[];
  pitch_range_semitones: number | null;
  pauses: { start_seconds: number; end_seconds: number }[];
  warning_codes: string[];
}

export interface ProsodyResult {
  status: string;
  normalization_method?: string;
  reference?: AcousticFeatures;
  recording?: AcousticFeatures;
  warning_codes: string[];
}
