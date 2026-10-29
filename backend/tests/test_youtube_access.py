from datetime import timedelta
from unittest.mock import patch
import pytest
from sqlmodel import Session
from backend.app.database import get_engine, init_db
from backend.app.errors import AppException
from backend.app.models import Job, utc_now
from backend.app.services.youtube_access import youtube_import_wait, ensure_youtube_import_allowed
from backend.app.services.youtube_service import youtube_failure, youtube_download_options, handle_ingest_job


@pytest.fixture
def db(tmp_path):
    engine = get_engine(f"sqlite:///{tmp_path / 'access.db'}")
    init_db(engine)
    return engine


def save_failure(session, code="YOUTUBE_AUTH_REQUIRED", message="", age=0):
    job = Job(client_request_id=f"failure-{code}-{age}", request_hash="test", kind="ingest", status="failed", error_code=code, error_message=message, finished_at=utc_now() - timedelta(seconds=age))
    session.add(job)
    session.commit()


@pytest.mark.parametrize("message,code,status", [
    ("Sign in to confirm you’re not a bot. Use --cookies-from-browser", "YOUTUBE_AUTH_REQUIRED", 403),
    ("HTTP Error 429: Too Many Requests", "RATE_LIMITED", 429),
    ("The request timed out", "YOUTUBE_CONNECTION_FAILED", 502),
    ("Video unavailable", "VIDEO_UNAVAILABLE", 404),
])
def test_errors_are_actionable_without_exposing_cli_instructions(message, code, status):
    error = youtube_failure(Exception(message), "epbFY0DTPxs")
    assert error.code == code
    assert error.status_code == status
    assert "--cookies" not in error.message


def test_no_browser_session_access_and_no_automatic_retries(monkeypatch):
    monkeypatch.setattr("backend.app.services.youtube_service.settings.YOUTUBE_COOKIES_FILE", None)
    with patch("backend.app.services.youtube_service.shutil.which", return_value="C:/node.exe"):
        options = youtube_download_options()
    assert options["js_runtimes"]["node"]["path"] == "C:/node.exe"
    assert options["retries"] == options["extractor_retries"] == options["fragment_retries"] == 0
    assert "cookiefile" not in options
    assert "cookiesfrombrowser" not in options


def test_block_stops_already_queued_jobs_before_any_youtube_request(db):
    with Session(db) as session:
        save_failure(session)
    with patch("backend.app.services.youtube_service.fetch_video_metadata") as fetch:
        with pytest.raises(AppException) as error:
            handle_ingest_job("queued-job", {"youtube_id": "epbFY0DTPxs"}, lambda *_: None, engine=db)
    assert error.value.code == "YOUTUBE_COOLDOWN"
    assert error.value.details["retry_after_seconds"] > 890
    fetch.assert_not_called()


def test_cooldown_survives_new_sessions_and_detects_old_raw_errors(db):
    with Session(db) as session:
        save_failure(session, code="VIDEO_UNAVAILABLE", message="ERROR: Sign in to confirm you're not a bot", age=300)
    with Session(db) as session:
        assert 590 <= youtube_import_wait(session) <= 600


def test_local_refusals_do_not_extend_the_original_block(db):
    with Session(db) as session:
        save_failure(session, age=300)
        save_failure(session, code="YOUTUBE_COOLDOWN")
        assert 590 <= youtube_import_wait(session) <= 600


def test_no_automatic_request_is_sent_when_cooldown_expires(db):
    with Session(db) as session:
        save_failure(session, age=901)
        ensure_youtube_import_allowed(session)
        assert youtube_import_wait(session) == 0


def test_successful_imports_are_spaced_apart(db):
    with Session(db) as session:
        session.add(Job(client_request_id="success", request_hash="test", kind="ingest", status="succeeded", finished_at=utc_now()))
        session.commit()
        assert 25 <= youtube_import_wait(session) <= 30
