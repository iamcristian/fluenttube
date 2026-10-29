# FluentTube AI — API Contracts & Schema Reference

Specification Reference: Section 5 (`specification.md`)

---

## 1. Network & Security Conventions

- **Base URL**: `http://localhost:8000/api` (Frontend reads `VITE_API_BASE_URL`).
- **Loopback Binding**: Strictly bound to `127.0.0.1:8000` (never `0.0.0.0`).
- **Allowed Origins**: `http://localhost:5173` and `http://127.0.0.1:5173` (no wildcard `*`).
- **Host Header Validation**: Rejects any Host header other than `localhost`, `127.0.0.1`, and `testserver`.
- **Origin Validation**: All mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) with an `Origin` header validate that origin against the allowed list; unauthorized origins return `403 UNAUTHORIZED_ORIGIN`.
- **Request ID Tracking**: Header `X-Request-ID` is extracted or generated on every request and propagated in all response headers and error envelopes.

---

## 2. Uniform Error Envelope

All application errors, HTTP status exceptions, and Pydantic 422 validation failures return the identical canonical envelope:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Request validation failed.",
    "retryable": false,
    "details": {
      "errors": [
        {
          "loc": ["body", "name"],
          "msg": "String should have at least 3 characters",
          "type": "string_too_short"
        }
      ]
    },
    "request_id": "97d39dbf-ec2c-47fc-9a99-5264b38d7281"
  }
}
```

Internal server errors (500) return `INTERNAL_ERROR` without leaking stack traces, internal paths, or environment variables.

---

## 3. Core DTOs

### 3.1 Health Response (`GET /api/health`)
```json
{
  "status": "ok",
  "database": "ok",
  "ffmpeg_available": false,
  "speech": {
    "state": "unloaded",
    "device": null,
    "model": null,
    "compute_type": null,
    "gpu_name": null,
    "free_vram_mb": null,
    "last_error": null
  },
  "tutor": {
    "enabled": false,
    "provider": null
  }
}
```

### 3.2 Segment DTO
- `id`: integer
- `video_id`: integer
- `position`: integer (0-based)
- `start_seconds`: float
- `end_seconds`: float
- `text`: string
- `timing_quality`: `"caption"` | `"word"` | `"coarse"`
- `completed`: boolean
- `revealed`: boolean
- `shadowing_unlocked`: boolean
- `best_word_match_score`: float | null
- `best_overall_score`: float | null

### 3.3 Video Summary & Detail DTOs
- `VideoSummaryDTO`: `id`, `youtube_id`, `title`, `channel`, `duration_seconds`, `transcription_source`, `segment_count`, `completed_count`, `last_segment_id`, `created_at`.
- `VideoDetailDTO`: inherits all summary fields + `segments: SegmentDTO[]` ordered strictly by `position`.
- *Security Guarantee*: Internal fields `audio_relative_path` and raw foreign key links are excluded.

### 3.4 Job DTO
- `id`: UUID string
- `kind`: `"ingest"` | `"shadowing"`
- `status`: `"queued"` | `"running"` | `"succeeded"` | `"failed"`
- `stage`: string | null
- `progress`: float (0.0 to 1.0) | null
- `result`: object | null
- `error`: `{ code, message, retryable, details }` | null
- `created_at`, `started_at`, `finished_at`: ISO 8601 UTC timestamps
- *Security Guarantee*: Internal `payload_json` and `request_hash` are excluded.

### 3.5 Video Endpoints Contract
- `POST /api/videos/ingest`: Body `{url, force: false, force_gpu_whisper: false, client_request_id}`
  - Returns `200 OK` `{video_id, status: "completed", cached: true}` on cache hit.
  - Returns `202 Accepted` `{job_id, status: "queued", cached: false}` when new job is queued.
  - Returns `409 Conflict` `VIDEO_ALREADY_EXISTS` if `force=true` on existing video.
  - Returns `409 Conflict` `INGEST_IN_PROGRESS` if video is currently processing with another request ID.
- `GET /api/videos`: Query `limit` (default 50, 1-100), `offset` (default 0).
  - Returns `PaginatedResponse[VideoSummaryDTO]` sorted by `last_opened_at DESC NULLS LAST, id DESC`.
- `GET /api/videos/{id}`: Path integer `id`.
  - Returns `VideoDetailDTO` with ordered segments (0-based position). Returns `404 VIDEO_NOT_FOUND` if absent.
- `PATCH /api/videos/{id}/progress`: Body `{last_segment_id: int}`.
  - Validates segment ownership; returns `VideoProgressResponseDTO` `{last_segment_id, last_opened_at}`. Returns `400 INVALID_SEGMENT_ID` if segment does not belong to video.

---

## 4. OpenAPI Specification

The machine-readable OpenAPI schema is exported at [`docs/openapi.json`](file:///c:/Users/crisa/Workspace/system-design/english-learning/docs/openapi.json).
Frontend TypeScript definitions in [`frontend/src/api/types.ts`](file:///c:/Users/crisa/Workspace/system-design/english-learning/frontend/src/api/types.ts) mirror these contracts.

