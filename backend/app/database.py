"""Database setup with SQLAlchemy — supports SQLite (local) and PostgreSQL (Heroku)."""

import logging

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# Use effective_database_url which handles Heroku's postgres:// -> postgresql:// fix
db_url = settings.effective_database_url

# SQLite requires check_same_thread=False; PostgreSQL doesn't use it
connect_args = {}
if db_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    db_url,
    connect_args=connect_args,
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
    Supports both SQLite and PostgreSQL syntax.
    """
    inspector = inspect(engine)
    is_sqlite = db_url.startswith("sqlite")

    # Migration: add stream_mode and stream_interval to active_monitors
    if "active_monitors" in inspector.get_table_names():
        existing_cols = {col["name"] for col in inspector.get_columns("active_monitors")}

        with engine.begin() as conn:
            if "stream_mode" not in existing_cols:
                logger.info("Migration: adding 'stream_mode' column to active_monitors")
                default_val = "0" if is_sqlite else "false"
                conn.execute(text(
                    f"ALTER TABLE active_monitors ADD COLUMN stream_mode BOOLEAN NOT NULL DEFAULT {default_val}"
                ))

            if "stream_interval" not in existing_cols:
                logger.info("Migration: adding 'stream_interval' column to active_monitors")
                conn.execute(text(
                    "ALTER TABLE active_monitors ADD COLUMN stream_interval INTEGER NOT NULL DEFAULT 10"
                ))

            if "paused" not in existing_cols:
                logger.info("Migration: adding 'paused' column to active_monitors")
                default_val = "0" if is_sqlite else "false"
                conn.execute(text(
                    f"ALTER TABLE active_monitors ADD COLUMN paused BOOLEAN NOT NULL DEFAULT {default_val}"
                ))

    # Migration: create alert_logs table if it doesn't exist
    if "alert_logs" not in inspector.get_table_names():
        logger.info("Migration: creating 'alert_logs' table")
        with engine.begin() as conn:
            if is_sqlite:
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
            else:
                # PostgreSQL syntax
                conn.execute(text("""
                    CREATE TABLE alert_logs (
                        id VARCHAR PRIMARY KEY,
                        event_id VARCHAR NOT NULL REFERENCES events(id),
                        channel VARCHAR NOT NULL,
                        status VARCHAR NOT NULL,
                        recipient VARCHAR,
                        details JSONB,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                """))
