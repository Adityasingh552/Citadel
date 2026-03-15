"""SQLAlchemy ORM models for events, tickets, and active monitors."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Float, Integer, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from app.database import Base


def _gen_uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Event(Base):
    """A detected traffic event (accident or vehicle detection)."""

    __tablename__ = "events"

    id = Column(String, primary_key=True, default=_gen_uuid)
    timestamp = Column(DateTime, default=_utcnow, nullable=False)
    event_type = Column(String, nullable=False)  # 'accident' | 'vehicle'
    confidence = Column(Float, nullable=False)
    severity = Column(String, nullable=False)  # 'high' | 'medium' | 'low'
    evidence_path = Column(String, nullable=True)
    bbox_data = Column(JSON, nullable=True)
    source_video = Column(String, nullable=True)
    frame_number = Column(Integer, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False)

    # Relationship
    tickets = relationship("Ticket", back_populates="event", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Event {self.id[:8]} type={self.event_type} severity={self.severity}>"


class Ticket(Base):
    """A digital violation ticket generated from an event."""

    __tablename__ = "tickets"

    id = Column(String, primary_key=True, default=_gen_uuid)
    event_id = Column(String, ForeignKey("events.id"), nullable=False)
    violation_type = Column(String, nullable=False)
    vehicle_description = Column(String, nullable=True)
    location_info = Column(String, nullable=True)
    evidence_path = Column(String, nullable=True)
    issued_at = Column(DateTime, default=_utcnow, nullable=False)
    status = Column(String, default="issued", nullable=False)  # issued | pending | resolved
    created_at = Column(DateTime, default=_utcnow, nullable=False)

    # Relationship
    event = relationship("Event", back_populates="tickets")

    def __repr__(self) -> str:
        return f"<Ticket {self.id[:8]} type={self.violation_type} status={self.status}>"


class ActiveMonitor(Base):
    """Persists which cameras are actively being monitored.

    Rows are inserted when monitoring starts and deleted when it stops.
    On backend restart the lifespan reads this table and re-starts monitors.
    """

    __tablename__ = "active_monitors"

    camera_id = Column(String, primary_key=True)
    started_at = Column(DateTime, default=_utcnow, nullable=False)
    stream_mode = Column(Boolean, default=False, nullable=False)
    stream_interval = Column(Integer, default=10, nullable=False)

    def __repr__(self) -> str:
        return f"<ActiveMonitor camera={self.camera_id} stream_mode={self.stream_mode}>"
