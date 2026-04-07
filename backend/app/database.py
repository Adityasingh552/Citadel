"""Database setup with SQLAlchemy — connects to Supabase PostgreSQL."""

import logging
import os

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

db_url = settings.database_url

if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    db_url,
    connect_args={
        "sslmode": "require",
    },
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Base class for ORM models."""
    pass


def get_db():
    """FastAPI dependency — yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_connection():
    """Verify database connectivity on startup."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Supabase PostgreSQL connection verified")
    except Exception as e:
        logger.error("Failed to connect to Supabase: %s", e)
        raise


def ensure_performance_indexes() -> None:
    """Create non-destructive performance indexes if they don't exist."""
    index_sql_by_table = {
        "events": [
            "CREATE INDEX IF NOT EXISTS idx_events_timestamp_desc ON events (timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS idx_events_event_type ON events (event_type)",
            "CREATE INDEX IF NOT EXISTS idx_events_severity ON events (severity)",
            "CREATE INDEX IF NOT EXISTS idx_events_confidence ON events (confidence)",
            "CREATE INDEX IF NOT EXISTS idx_events_source_video ON events (source_video)",
            "CREATE INDEX IF NOT EXISTS idx_events_source_video_frame ON events (source_video, frame_number)",
            "CREATE INDEX IF NOT EXISTS idx_events_source_video_timestamp ON events (source_video, timestamp DESC)",
        ],
        "tickets": [
            "CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status)",
            "CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets (event_id)",
            "CREATE INDEX IF NOT EXISTS idx_tickets_issued_at_desc ON tickets (issued_at DESC)",
        ],
        "alert_logs": [
            "CREATE INDEX IF NOT EXISTS idx_alert_logs_status ON alert_logs (status)",
            "CREATE INDEX IF NOT EXISTS idx_alert_logs_channel ON alert_logs (channel)",
            "CREATE INDEX IF NOT EXISTS idx_alert_logs_event_id ON alert_logs (event_id)",
            "CREATE INDEX IF NOT EXISTS idx_alert_logs_created_at_desc ON alert_logs (created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_alert_logs_channel_status ON alert_logs (channel, status)",
        ],
    }

    created = 0
    try:
        with engine.begin() as conn:
            inspector = inspect(conn)
            for table, statements in index_sql_by_table.items():
                if not inspector.has_table(table):
                    continue
                for statement in statements:
                    try:
                        conn.execute(text(statement))
                        created += 1
                    except Exception as e:
                        logger.warning("Failed to ensure index on %s: %s", table, e)
        if created:
            logger.info("Ensured performance indexes (%d statements)", created)
    except Exception as e:
        logger.warning("Failed to ensure performance indexes: %s", e)
