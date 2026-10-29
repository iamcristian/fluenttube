import shutil
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from backend.app.config import settings
from backend.app.database import get_engine, get_session, init_db
from backend.app.errors import AppException
from backend.app.main import app
from backend.app.models import Video, Job, utc_now
from backend.app.services.jobs import job_runner
from backend.app.services.local_video import handle_local_ingest_job, local_media_path, _mp4_needs_preparation


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("FFmpeg is required for the local media integration test")
    path = tmp_path_factory.mktemp("local-media") / "practice.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)], check=True, capture_output=True, timeout=30)
    return path.read_bytes()


@pytest.fixture
def local_app(tmp_path, monkeypatch):
    engine = get_engine(f"sqlite:///{tmp_path / 'local.db'}")
    init_db(engine)
    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path / "media"))
    monkeypatch.setattr("backend.app.services.audio_service.TEMP_DIR", tmp_path / "temp")
    original_engine = job_runner.engine
    job_runner.engine = engine
    def session_override():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_session] = session_override
    with TestClient(app) as client:
        yield client, engine, tmp_path
    app.dependency_overrides.clear()
    job_runner.engine = original_engine


def test_local_video_import_playback_and_library_work_during_youtube_cooldown(local_app, clip):
    client, engine, _ = local_app
    with Session(engine) as session:
        session.add(Job(client_request_id="blocked-youtube", request_hash="test", kind="ingest", status="failed", error_code="YOUTUBE_AUTH_REQUIRED", finished_at=utc_now()))
        session.commit()
    words = [{"word": "Hello", "start": 0.1, "end": 0.5, "probability": 1}, {"word": "world.", "start": 0.6, "end": 1.5, "probability": 1}]
    with patch("backend.app.services.local_video.whisper_engine.load_model"), patch("backend.app.services.local_video.whisper_engine.transcribe", return_value={"text": "Hello world.", "words": words, "segments": [{"start": 0.1, "end": 1.5, "text": "Hello world.", "words": words}]}), patch("yt_dlp.YoutubeDL", side_effect=AssertionError("Local import must never contact YouTube")) as youtube:
        response = client.post("/api/videos/upload", files={"video_file": ("my practice.mp4", clip, "video/mp4")})
        assert response.status_code == 202
        job_id = response.json()["job_id"]
        for _ in range(50):
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["status"] in {"succeeded", "failed"}:
                break
            time.sleep(0.05)
        assert job["status"] == "succeeded", job
        video_id = job["result"]["video_id"]
        video = client.get(f"/api/videos/{video_id}").json()
        assert video["title"] == "my practice"
        assert video["source_type"] == "local"
        assert video["segments"][0]["text"] == "Hello world."
        library = client.get("/api/videos").json()
        assert library["items"][0]["source_type"] == "local"
        media = client.get(f"/api/videos/{video_id}/media", headers={"Range": "bytes=0-31"})
        assert media.status_code == 206
        from backend.app.models import LocalVideoMedia
        with Session(engine) as session:
            source = local_media_path(session.get(LocalVideoMedia, video_id).file_relative_path)
        prepared = source.with_suffix(".playback.mp4")
        assert source.read_bytes() == clip
        assert prepared.is_file()
        assert not _mp4_needs_preparation(prepared)
        assert media.content == prepared.read_bytes()[:32]
        assert media.headers["content-type"].startswith("video/mp4")
        headers = client.head(f"/api/videos/{video_id}/media")
        assert headers.status_code == 200
        assert int(headers.headers["content-length"]) == prepared.stat().st_size
        assert headers.content == b""
        assert headers.headers["content-disposition"].startswith("inline;")
        with patch("backend.app.services.local_video.subprocess.run", side_effect=AssertionError("Reuse the prepared file")):
            tail = client.get(f"/api/videos/{video_id}/media", headers={"Range": "bytes=-32"})
        assert tail.status_code == 206
        assert tail.content == prepared.read_bytes()[-32:]
        youtube.assert_not_called()


@pytest.mark.parametrize("name,content,status", [("notes.txt", b"hello", 415), ("empty.mp4", b"", 422), ("invalid.mp4", b"not video", 415)])
def test_rejects_invalid_uploads_without_enqueuing(local_app, name, content, status):
    client, _, root = local_app
    with patch.object(job_runner, "enqueue_job") as enqueue:
        result = client.post("/api/videos/upload", files={"video_file": (name, content, "video/mp4")})
    assert result.status_code == status
    enqueue.assert_not_called()
    assert not list((root / "temp").glob("*"))


def test_upload_size_limit_and_cleanup(local_app, monkeypatch):
    client, _, root = local_app
    monkeypatch.setattr(settings, "MAX_SOURCE_AUDIO_BYTES", 32)
    result = client.post("/api/videos/upload", files={"video_file": ("large.mp4", b"x" * 64, "video/mp4")})
    assert result.status_code == 413
    assert not list((root / "temp").glob("*"))


def test_long_video_is_rejected_before_transcription(local_app, clip):
    client, _, root = local_app
    with patch("backend.app.services.local_video.probe_audio", return_value={"format": {"duration": settings.MAX_VIDEO_SECONDS + 1}, "streams": [{"codec_type": "video", "codec_name": "h264"}]}):
        result = client.post("/api/videos/upload", files={"video_file": ("long.mp4", clip, "video/mp4")})
    assert result.status_code == 422
    assert result.json()["error"]["code"] == "VIDEO_TOO_LONG"
    assert not list((root / "temp").glob("*"))


def test_40_minute_local_video_is_accepted(local_app, clip):
    client, _, _ = local_app
    probe = {"format": {"duration": 40 * 60}, "streams": [{"codec_type": "video", "codec_name": "h264"}, {"codec_type": "audio", "codec_name": "aac"}]}
    with patch("backend.app.services.local_video.probe_audio", return_value=probe), patch.object(job_runner, "enqueue_job", return_value=(SimpleNamespace(id="forty-minute-job", status="queued"), True)) as enqueue:
        response = client.post("/api/videos/upload", files={"video_file": ("forty minutes.mp4", clip, "video/mp4")})
    assert response.status_code == 202
    assert response.json()["job_id"] == "forty-minute-job"
    assert enqueue.call_args.args[0] == "local_ingest"
    assert enqueue.call_args.args[2]["duration"] == 2400


def test_failed_transcription_preserves_uploaded_file_without_orphaned_video(local_app):
    _, engine, root = local_app
    path = root / "media" / "local" / "failed.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"sample")
    with patch("backend.app.services.local_video.whisper_engine.load_model", side_effect=AppException(code="MODEL_UNAVAILABLE", message="Model unavailable")):
        with pytest.raises(AppException):
            handle_local_ingest_job("failed-job", {"file_relative_path": "local/failed.mp4", "duration": 3, "title": "test", "source_key": "local:test"}, lambda *_: None, engine=engine)
    assert path.exists()
    with Session(engine) as session:
        assert not session.exec(select(Video)).all()


def test_transcription_resumes_after_last_checkpoint_and_is_idempotent(local_app):
    import json
    _, engine, root = local_app
    path = root / "media/local/recover.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"local test video")
    payload = {"file_relative_path": "local/recover.mp4", "duration": 610, "title": "Recoverable", "source_key": "local:recover"}
    result = {"words": [{"word": "Hello", "start": 0.1, "end": 0.5}, {"word": "again.", "start": 0.6, "end": 1.0}]}
    def extract(_source, output, _offset, _duration):
        output.write_bytes(b"audio")
    with patch("backend.app.services.local_video.whisper_engine.load_model"), patch("backend.app.services.local_video.extract_audio_chunk", side_effect=extract), patch("backend.app.services.local_video.whisper_engine.transcribe", side_effect=[result, RuntimeError("simulated interruption")]):
        with pytest.raises(RuntimeError):
            handle_local_ingest_job("interrupted", payload, lambda *_: None, engine=engine)
    assert path.exists()
    checkpoint = path.with_suffix(".transcript.json")
    assert json.loads(checkpoint.read_text())["next_part"] == 1
    with patch("backend.app.services.local_video.whisper_engine.load_model"), patch("backend.app.services.local_video.extract_audio_chunk", side_effect=extract) as extract_mock, patch("backend.app.services.local_video.whisper_engine.transcribe", return_value=result) as transcribe:
        completed = handle_local_ingest_job("continued", payload, lambda *_: None, engine=engine)
    assert transcribe.call_count == 2
    assert [call.args[2] for call in extract_mock.call_args_list] == [300, 600]
    with Session(engine) as session:
        from backend.app.models import Segment
        segments = session.exec(select(Segment).where(Segment.video_id == completed["video_id"]).order_by(Segment.position)).all()
        assert [segment.start_seconds for segment in segments] == [0.1, 300.1, 600.1]
    assert not checkpoint.exists()
    with patch("backend.app.services.local_video.whisper_engine.transcribe") as transcribe:
        duplicate = handle_local_ingest_job("same-file", payload, lambda *_: None, engine=engine)
    assert duplicate == completed
    transcribe.assert_not_called()


def test_media_paths_cannot_escape_storage(local_app):
    from backend.app.services.local_video import local_media_path
    _, _, root = local_app
    (root / "private.txt").write_text("private")
    with pytest.raises(AppException) as error:
        local_media_path("../private.txt")
    assert error.value.code == "LOCAL_MEDIA_NOT_FOUND"


def test_playback_preparation_failure_preserves_original_and_removes_partial(tmp_path, clip):
    from backend.app.services.local_video import local_playback_path
    source = tmp_path / "original.mp4"
    source.write_bytes(clip)
    def failed_remux(arguments, **_kwargs):
        Path(arguments[-1]).write_bytes(b"incomplete")
        raise subprocess.TimeoutExpired(arguments, 90)
    with patch("backend.app.services.local_video.subprocess.run", side_effect=failed_remux):
        with pytest.raises(AppException) as error:
            local_playback_path(source)
    assert error.value.code == "LOCAL_PLAYBACK_PREPARATION_FAILED"
    assert source.read_bytes() == clip
    assert list(tmp_path.glob("*.mp4")) == [source]


def test_webm_and_faststart_mp4_do_not_need_another_copy(tmp_path, clip):
    from backend.app.services.local_video import local_playback_path
    source = tmp_path / "original.mp4"
    source.write_bytes(clip)
    prepared = local_playback_path(source)
    webm = tmp_path / "original.webm"
    webm.write_bytes(b"webm test")
    with patch("backend.app.services.local_video.subprocess.run", side_effect=AssertionError("No remux needed")):
        assert local_playback_path(prepared) == prepared
        assert local_playback_path(webm) == webm


def test_fragmented_mp4_gets_an_indexed_playback_copy(tmp_path, clip):
    from backend.app.services.local_video import local_playback_path
    from backend.app.services.audio_service import probe_audio
    regular = tmp_path / "regular.mp4"
    regular.write_bytes(clip)
    source = tmp_path / "fragmented.mp4"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-i", str(regular), "-c", "copy", "-movflags", "frag_keyframe+empty_moov", str(source)], check=True, capture_output=True, timeout=30)
    original = source.read_bytes()
    assert _mp4_needs_preparation(source)
    prepared = local_playback_path(source)
    assert prepared != source
    assert not _mp4_needs_preparation(prepared)
    assert source.read_bytes() == original
    before, after = probe_audio(source), probe_audio(prepared)
    assert [(s["codec_type"], s["codec_name"]) for s in before["streams"]] == [(s["codec_type"], s["codec_name"]) for s in after["streams"]]
    assert abs(float(before["format"]["duration"]) - float(after["format"]["duration"])) < 0.1


def test_saved_import_can_be_found_and_continued_without_upload(local_app, clip):
    import json
    client, engine, root = local_app
    path = root / "media/local/interrupted.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(clip)
    payload = {"file_relative_path": "local/interrupted.mp4", "duration": 3, "title": "Saved import", "source_key": "local:interrupted"}
    with Session(engine) as session:
        job = Job(client_request_id="interrupted-local", request_hash="test", kind="local_ingest", status="failed", error_code="JOB_INTERRUPTED", payload_json=json.dumps(payload))
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id
    discovered = client.get("/api/jobs/recoverable/local")
    assert discovered.status_code == 200
    assert discovered.json()[0]["id"] == job_id
    assert discovered.json()[0]["error"]["details"]["can_resume"] is True
    assert "file_relative_path" not in discovered.text
    result = {"words": [{"word": "Welcome.", "start": 0.1, "end": 0.9}]}
    with patch("backend.app.services.local_video.whisper_engine.load_model"), patch("backend.app.services.local_video.whisper_engine.transcribe", return_value=result), patch("yt_dlp.YoutubeDL") as youtube:
        resumed = client.post(f"/api/jobs/{job_id}/resume")
        assert resumed.status_code == 200
        assert resumed.json()["id"] == job_id
        for _ in range(50):
            status = client.get(f"/api/jobs/{job_id}").json()
            if status["status"] in {"succeeded", "failed"}:
                break
            time.sleep(0.05)
        assert status["status"] == "succeeded", status
        youtube.assert_not_called()
    assert client.get("/api/jobs/recoverable/local").json() == []
