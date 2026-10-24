"""
Database configuration and session management for FluentTube AI.

SQLite Pragma and Transaction Rules:
- Enforces PRAGMA foreign_keys = ON on every connection.
- Enforces PRAGMA journal_mode = WAL for concurrent reads without blocking writes.
- Enforces PRAGMA busy_timeout = 5000 to prevent immediate lock errors.
- One DB session per request or worker task unit; sessions are never shared across threads.

Migration Strategy:
- In V1, SQLModel.metadata.create_all initializes all declared entities.
- Table structures are immutable in V1.
- Future schema evolutions must be managed via versioned Alembic migrations
  (`alembic revision --autogenerate`) with mandatory SQLite backups prior to upgrade.
- Dropping or wiping production database files to bypass migrations is prohibited.
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
    SQLModel.metadata.create_all(target_engine)

def get_session() -> Generator[Session, None, None]:
    """Dependency for providing a transactional session per request."""
    with Session(engine) as session:
        yield session
