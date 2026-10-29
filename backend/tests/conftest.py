"""Network integration tests must be explicitly requested, never run by default."""
import pytest


@pytest.fixture(autouse=True)
def isolate_application_storage(tmp_path, monkeypatch):
    """Test app lifespans must never recover or modify jobs in the user's database."""
    from backend.app import database
    from backend.app.config import settings
    from backend.app.routers import health
    from backend.app.services import jobs, local_video, youtube_service, shadowing_service
    database_url = f"sqlite:///{tmp_path / 'isolated-app.db'}"
    engine = database.get_engine(database_url)
    database.init_db(engine)
    monkeypatch.setattr(settings, "DATABASE_URL", database_url)
    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path / "media"))
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(health, "engine", engine)
    monkeypatch.setattr(jobs, "default_engine", engine)
    monkeypatch.setattr(jobs.job_runner, "engine", engine)
    for module in (local_video, youtube_service, shadowing_service):
        monkeypatch.setattr(module, "default_engine", engine)
    yield
    jobs.job_runner.stop()
    engine.dispose()


def pytest_addoption(parser):
    parser.addoption("--live-youtube", action="store_true", default=False,
                     help="Explicitly allow integration tests to make real YouTube requests")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--live-youtube"):
        return
    skip = pytest.mark.skip(reason="Live network tests are disabled; explicitly opt in with --live-youtube")
    for item in items:
        if item.get_closest_marker("integration"):
            item.add_marker(skip)
