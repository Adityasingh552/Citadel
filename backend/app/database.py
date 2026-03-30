"""SQLite database setup with SQLAlchemy."""

import logging

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # Required for SQLite
    echo=False,
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


def create_tables():
    """Create all tables in the database."""
    Base.metadata.create_all(bind=engine)


def run_migrations():
    """Run lightweight schema migrations for new columns on existing tables.

    SQLAlchemy's create_all only creates missing tables, not missing columns.
    This function adds any new columns that were introduced after the initial schema.
    """
    inspector = inspect(engine)

    # Migration: add stream_mode and stream_interval to active_monitors
    if "active_monitors" in inspector.get_table_names():
        existing_cols = {col["name"] for col in inspector.get_columns("active_monitors")}

        with engine.begin() as conn:
            if "stream_mode" not in existing_cols:
                logger.info("Migration: adding 'stream_mode' column to active_monitors")
                conn.execute(text(
                    "ALTER TABLE active_monitors ADD COLUMN stream_mode BOOLEAN NOT NULL DEFAULT 0"
                ))

            if "stream_interval" not in existing_cols:
                logger.info("Migration: adding 'stream_interval' column to active_monitors")
                conn.execute(text(
                    "ALTER TABLE active_monitors ADD COLUMN stream_interval INTEGER NOT NULL DEFAULT 10"
                ))

    # Migration: create alert_logs table if it doesn't exist
    if "alert_logs" not in inspector.get_table_names():
        logger.info("Migration: creating 'alert_logs' table")
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE alert_logs (
                    id VARCHAR PRIMARY KEY,
                    event_id VARCHAR NOT NULL REFERENCES events(id),
                    channel VARCHAR NOT NULL,
                    status VARCHAR NOT NULL,
                    recipient VARCHAR,
                    details JSON,
                    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
                )
            """))
