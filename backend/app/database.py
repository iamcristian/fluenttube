"""
Database configuration and session management for FluentTube AI.

SQLite Pragma and Transaction Rules:
- Enforces PRAGMA foreign_keys = ON on every connection.
- Enforces PRAGMA journal_mode = WAL for concurrent reads without blocking writes.
- Enforces PRAGMA busy_timeout = 5000 to prevent immediate lock errors.
- One DB session per request or worker task unit; sessions are never shared across threads.

Migration Strategy:
- Versioned Alembic upgrades run on startup after a consistent SQLite backup.
- Rollback restores that backup while the app is stopped.
"""

from pathlib import Path
from typing import Generator, Optional
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine
from backend.app.config import BACKEND_DIR, settings

# Ensure SQLite engine applies WAL, foreign keys, and busy timeout
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

def get_engine(database_url: Optional[str] = None) -> Engine:
    url = database_url or settings.DATABASE_URL
    # Ensure local directory exists for file-based sqlite URLs
    if url.startswith("sqlite:///") and not url.startswith("sqlite:///:memory:"):
        path_part = url[len("sqlite:///"):]
        p = Path(path_part)
        if not p.is_absolute():
            p = (BACKEND_DIR / p).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        url = f"sqlite:///{p.as_posix()}"

    connect_args = {"check_same_thread": False} if "sqlite" in url else {}
    return create_engine(url, connect_args=connect_args, echo=False)

engine = get_engine()

def init_db(engine_override: Optional[Engine] = None) -> None:
    """Initialize database tables."""
    target_engine = engine_override or engine
    from alembic import command
    from alembic.config import Config
    import sqlite3
    import uuid
    from sqlalchemy import inspect
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    with target_engine.connect() as connection:
        tables = inspect(connection).get_table_names()
        current = None
        if "alembic_version" in tables:
            current = connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
        connection.rollback()
        if current != "0002_reviews" and tables and target_engine.url.database not in (None, "", ":memory:"):
            source = Path(target_engine.url.database)
            backup = source.with_name(source.name + ".pre-phonetics-" + uuid.uuid4().hex + ".bak")
            with sqlite3.connect(str(source)) as origin, sqlite3.connect(str(backup)) as destination:
                origin.backup(destination)
        config.attributes["connection"] = connection
        # Explicit transaction keeps SQLite DDL and revision stamping atomic.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            command.upgrade(config, "head")
            connection.commit()
        except Exception:
            connection.rollback()
            raise

def get_session() -> Generator[Session, None, None]:
    """Dependency for providing a transactional session per request."""
    with Session(engine) as session:
        yield session
