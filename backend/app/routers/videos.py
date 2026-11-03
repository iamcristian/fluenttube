import json
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import delete
from sqlmodel import Session, col, func, select

from backend.app.database import get_session
from backend.app.errors import AppException
from backend.app.models import Job, Segment, Video, LocalVideoMedia, TutorCache, VocabularyCache, utc_now
from backend.app.schemas import (
    PaginatedResponse,
    SegmentDTO,
    VideoDetailDTO,
    VideoProgressResponseDTO,
    VideoProgressUpdateDTO,
    VideoSummaryDTO,
)
from backend.app.services.jobs import job_runner
from backend.app.services.local_video import local_media_path
from backend.app.services.audio_service import safe_cleanup

router = APIRouter(tags=["videos"])

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
    local_ids = set(session.exec(select(LocalVideoMedia.video_id).where(LocalVideoMedia.video_id.in_([row[0].id for row in rows]))).all()) if rows else set()
    items = [
        VideoSummaryDTO(
            id=video.id,
            source_key=video.source_key,
            source_type="local" if video.id in local_ids else "unavailable",
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
        source_key=video.source_key,
        source_type="local" if session.get(LocalVideoMedia, video.id) else "unavailable",
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


@router.delete("/videos/{id}", status_code=status.HTTP_200_OK)
def delete_video(id: int, session: Session = Depends(get_session)) -> dict:
    """Remove a video, its practice history, caches, and any owned local media."""
    video = session.get(Video, id)
    if not video:
        raise AppException(
            code="VIDEO_NOT_FOUND",
            message="This video has already been removed from your library.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    removed_segment_ids = session.exec(select(Segment.id).where(Segment.video_id == id)).all()
    active_jobs = session.exec(select(Job).where(Job.status.in_(["queued", "running"]))).all()
    for job in active_jobs:
        payload = json.loads(job.payload_json)
        if payload.get("segment_id") in removed_segment_ids or payload.get("source_key") == video.source_key:
            raise AppException(code="VIDEO_BUSY", message="This video is still being processed. Wait for it to finish, then remove it.", status_code=409)
    media = session.get(LocalVideoMedia, id)
    local_paths = []
    if media:
        try:
            original = local_media_path(media.file_relative_path)
            local_paths.extend((
                original,
                original.with_suffix(".playback.mp4"),
                original.with_suffix(".transcript.json"),
                original.with_suffix(".chunk.wav"),
            ))
        except AppException:
            pass
        session.delete(media)

    segment_ids = select(Segment.id).where(Segment.video_id == id)
    session.exec(delete(TutorCache).where(TutorCache.segment_id.in_(segment_ids)))
    session.exec(delete(VocabularyCache).where(VocabularyCache.segment_id.in_(segment_ids)))
    # Break the progress pointer before removing the segment it references.
    video.last_segment_id = None
    session.add(video)
    session.flush()
    # ORM relationships remove each segment's attempts and practice sessions.
    session.delete(video)
    session.commit()

    safe_cleanup(*local_paths)
    return {"deleted": True, "video_id": id, "segment_ids": removed_segment_ids}
