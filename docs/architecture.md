# Architecture

FluentTube is a single-user local application. React and TypeScript render the library and Listen / Write / Speak workspace; FastAPI owns imports, scoring and persistence. The API binds to loopback and validates hosts and request origins. SQLite uses WAL mode and foreign keys.

## Media and speech

MP4 and WebM uploads are stored locally and processed with FFmpeg and Faster-Whisper. A bounded background queue tracks jobs. Long imports checkpoint completed transcription parts and can resume without uploading again. The native video player streams local media with byte-range requests. Transcription supports CPU and optional NVIDIA acceleration.

Recordings are compared with the original segment using local speech recognition and timing feedback. Experimental pitch and energy displays help compare takes; they do not assess individual phonemes or certify pronunciation. Phonetics Lab adds sound guides, articulation diagrams, listening quizzes, reviews and a guided course.

## Practice state

TanStack Query handles server data; Zustand and browser storage preserve practice preferences and drafts. The backend persists library progress, sessions and attempts. Drafts that have not been submitted are separate from the database backup.

Dictation validates words in order as they are completed. Contractions and internal hyphens remain readable display units while normalisation accepts equivalent forms. Hints reveal successive letters of the first unfinished word; the backend records assisted words once. Completed or revealed segments unlock the answer-dependent speaking tools and sentence IPA.

On desktop, the video keeps its natural height and the sentence list scrolls independently. Vocabulary notes dismiss on outside clicks or Escape. Practice tools share the footer to avoid floating controls covering each other.

## Offline dictionaries

British IPA comes from bundled Britfone and ipa-dict UK data, with a small editorial fallback. WordNet supplies English definitions, grammatical categories and available examples; original function-word entries cover common prepositions and articles that WordNet omits. Loading is lazy and lookups make no external requests. Historic cached IPA is not treated as a verified British source.

Word Inspector prioritises senses matching the contextual part of speech when available. Other uses stay collapsed; examples that use only a synonym instead of the queried lemma are omitted. Sentence IPA displays the first dictionary reading of each word in sequence. An underlined reading opens its alternatives; missing entries remain in brackets. This guide stays British regardless of the video accent and does not infer connected speech from audio.

Bundled data, original licenses, source revisions and hashes live in `backend/app/resources/`. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Optional online features

The AI tutor supplies separate contextual explanations. The fixed sentence profile uses a direct Spanish translation and English explanations, vocabulary, idioms, phrasal verbs, examples and British connected-speech tips. Opening the sentence explanation starts the request immediately. Reference speech can use an online synthetic British voice. Neither service resolves the local dictionary entries.

Source code and bundled dictionaries belong in Git. Databases, uploaded videos, recordings, credentials and downloaded speech models stay private. See [backup instructions](PUBLISHING.md).
