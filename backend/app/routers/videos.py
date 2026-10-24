import json
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query, Response, status
from sqlmodel import Session, col, func, select

from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import Job, Segment, Video, utc_now
from backend.app.schemas import (
    IngestRequestDTO,
    IngestResponseDTO,
    PaginatedResponse,
    SegmentDTO,
    VideoDetailDTO,
    VideoProgressResponseDTO,
    VideoProgressUpdateDTO,
    VideoSummaryDTO,
)
from backend.app.services.jobs import job_runner
from backend.app.services.youtube_service import parse_youtube_url

router = APIRouter(tags=["videos"])

@router.post(
    "/videos/ingest",
    response_model=IngestResponseDTO,
    status_code=status.HTTP_200_OK,
)
def ingest_video(
    req: IngestRequestDTO,
    response: Response,
    session: Session = Depends(get_session),
) -> IngestResponseDTO:
    # 1. Validate YouTube URL
    youtube_id = parse_youtube_url(req.url)

    # 2. Check if video already exists in database
    existing_video = session.exec(
        select(Video).where(Video.youtube_id == youtube_id)
    ).first()

    if existing_video:
        if not req.force:
            # Cache hit: return 200 with video_id
            return IngestResponseDTO(
                job_id=None,
                video_id=existing_video.id,
                status="completed",
                cached=True,
            )
        else:
            # Force=true on existing video: 409 VIDEO_ALREADY_EXISTS (Section 6.3, 14.7)
            raise AppException(
                code="VIDEO_ALREADY_EXISTS",
                message="This video has already been ingested. Re-ingestion without prior deletion is not supported in V1.",
                status_code=status.HTTP_409_CONFLICT,
                retryable=False,
                details={"video_id": existing_video.id},
            )

    # 3. Check if there is an in-progress ingest job for this video
    active_jobs = session.exec(
        select(Job).where(Job.kind == "ingest", Job.status.in_(["queued", "running"]))
    ).all()

    for job in active_jobs:
        try:
            job_payload = json.loads(job.payload_json)
            if job_payload.get("youtube_id") == youtube_id:
                # If exact client_request_id matches, allow idempotent return
                if req.client_request_id and job.client_request_id == req.client_request_id:
                    response.status_code = status.HTTP_202_ACCEPTED
                    return IngestResponseDTO(
                        job_id=job.id,
                        video_id=None,
                        status=job.status,
                        cached=False,
                    )
                raise AppException(
                    code="INGEST_IN_PROGRESS",
                    message="This video is currently being processed.",
                    status_code=status.HTTP_409_CONFLICT,
                    retryable=False,
                    details={"existing_job_id": job.id},
                )
        except (json.JSONDecodeError, KeyError):
            continue

    # 4. Enqueue new background job
    client_request_id = req.client_request_id or str(uuid.uuid4())
    payload = {
        "url": req.url,
        "youtube_id": youtube_id,
        "force": req.force,
        "force_gpu_whisper": req.force_gpu_whisper,
    }
    job, _ = job_runner.enqueue_job("ingest", client_request_id, payload)
    response.status_code = status.HTTP_202_ACCEPTED
    return IngestResponseDTO(
        job_id=job.id,
        video_id=None,
        status=job.status,
        cached=False,
    )

@router.get(
    "/videos",
    response_model=PaginatedResponse[VideoSummaryDTO],
)
def list_videos(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> PaginatedResponse[VideoSummaryDTO]:
    stmt = (
        select(
            Video,
            func.count(Segment.id).label("segment_count"),
            func.count(Segment.completed_at).label("completed_count"),
        )
        .outerjoin(Segment, Segment.video_id == Video.id)
        .group_by(Video.id)
        .order_by(col(Video.last_opened_at).desc().nullslast(), col(Video.id).desc())
        .offset(offset)
        .limit(limit)
    )
    rows = session.exec(stmt).all()
    items = [
        VideoSummaryDTO(
            id=video.id,
            youtube_id=video.youtube_id,
            title=video.title,
            channel=video.channel,
            duration_seconds=video.duration_seconds,
            transcription_source=video.transcription_source,
            segment_count=seg_count,
            completed_count=comp_count,
            last_segment_id=video.last_segment_id,
            created_at=video.created_at,
        )
        for video, seg_count, comp_count in rows
    ]
    total = session.exec(select(func.count(Video.id))).one()
    return PaginatedResponse(items=items, total=total)

@router.get(
    "/videos/{id}",
    response_model=VideoDetailDTO,
)
def get_video_detail(
    id: int,
    session: Session = Depends(get_session),
) -> VideoDetailDTO:
    video = session.get(Video, id)
    if not video:
        raise AppException(
            code="VIDEO_NOT_FOUND",
            message=f"Video {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    segments = session.exec(
        select(Segment).where(Segment.video_id == id).order_by(Segment.position.asc())
    ).all()

    segment_dtos = []
    completed_count = 0
    for seg in segments:
        is_completed = seg.completed_at is not None
        is_revealed = seg.revealed_at is not None
        if is_completed:
            completed_count += 1

        best_wm = None
        if seg.dictation_attempts:
            best_wm = max(
                (a.score for a in seg.dictation_attempts if a.score is not None),
                default=None,
            )

        best_ov = None
        if seg.shadowing_attempts:
            best_ov = max(
                (a.overall_score for a in seg.shadowing_attempts if a.overall_score is not None),
                default=None,
            )

        segment_dtos.append(
            SegmentDTO(
                id=seg.id,
                video_id=seg.video_id,
                position=seg.position,
                start_seconds=seg.start_seconds,
                end_seconds=seg.end_seconds,
                text=seg.text,
                timing_quality=seg.timing_quality,
                completed=is_completed,
                revealed=is_revealed,
                shadowing_unlocked=is_completed or is_revealed,
                best_word_match_score=best_wm,
                best_overall_score=best_ov,
            )
        )

    return VideoDetailDTO(
        id=video.id,
        youtube_id=video.youtube_id,
        title=video.title,
        channel=video.channel,
        duration_seconds=video.duration_seconds,
        transcription_source=video.transcription_source,
        segment_count=len(segments),
        completed_count=completed_count,
        last_segment_id=video.last_segment_id,
        created_at=video.created_at,
        segments=segment_dtos,
    )

@router.patch(
    "/videos/{id}/progress",
    response_model=VideoProgressResponseDTO,
)
def update_video_progress(
    id: int,
    payload: VideoProgressUpdateDTO,
    session: Session = Depends(get_session),
) -> VideoProgressResponseDTO:
    video = session.get(Video, id)
    if not video:
        raise AppException(
            code="VIDEO_NOT_FOUND",
            message=f"Video {id} not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            retryable=False,
        )

    # Validate segment ownership
    seg = session.exec(
        select(Segment).where(
            Segment.id == payload.last_segment_id,
            Segment.video_id == id,
        )
    ).first()

    if not seg:
        raise AppException(
            code="INVALID_SEGMENT_ID",
            message=f"Segment {payload.last_segment_id} does not belong to video {id}.",
            status_code=status.HTTP_400_BAD_REQUEST,
            retryable=False,
            details={"video_id": id, "segment_id": payload.last_segment_id},
        )

    now = utc_now()
    video.last_segment_id = payload.last_segment_id
    video.last_opened_at = now
    session.add(video)
    session.commit()

    return VideoProgressResponseDTO(
        last_segment_id=payload.last_segment_id,
        last_opened_at=now,
    )
