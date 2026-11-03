"""Network integration tests must be explicitly requested, never run by default."""
import pytest


@pytest.fixture(autouse=True)
def isolate_application_storage(tmp_path, monkeypatch):
    """Test app lifespans must never recover or modify jobs in the user's database."""
    from backend.app import database
    from backend.app.config import settings
    from backend.app.routers import health
    from backend.app.services import jobs, local_video, shadowing_service
    database_url = f"sqlite:///{tmp_path / 'isolated-app.db'}"
    engine = database.get_engine(database_url)
    database.init_db(engine)
    monkeypatch.setattr(settings, "DATABASE_URL", database_url)
    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path / "media"))
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(health, "engine", engine)
    monkeypatch.setattr(jobs, "default_engine", engine)
    monkeypatch.setattr(jobs.job_runner, "engine", engine)
    for module in (local_video, shadowing_service):
        monkeypatch.setattr(module, "default_engine", engine)
    yield
    jobs.job_runner.stop()
    engine.dispose()
