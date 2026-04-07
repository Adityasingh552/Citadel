"""Ticket service — CRUD operations and auto-generation from events."""

import logging
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Event, Ticket

logger = logging.getLogger(__name__)


def create_ticket_from_event(
    db: Session,
    event: Event,
    vehicle_description: Optional[str] = None,
    location_info: Optional[str] = None,
) -> Ticket:
    """Auto-generate a violation ticket from a detected event."""
    # Build vehicle description from detection metadata
    if not vehicle_description:
        vehicle_description = _build_vehicle_description(event)
    if not location_info:
        location_info = _build_location_info(event)

    ticket = Ticket(
        event_id=event.id,
        violation_type=event.event_type,
        vehicle_description=vehicle_description,
        location_info=location_info,
        evidence_path=event.evidence_path,
        status="issued",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    logger.info("Created ticket: %s", ticket)
    return ticket


def list_tickets(
    db: Session,
    status: Optional[str] = None,
    violation_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Ticket], int]:
    """List tickets with optional filtering."""
    query = db.query(Ticket)

    if status:
        query = query.filter(Ticket.status == status)
    if violation_type:
        query = query.filter(Ticket.violation_type == violation_type)

    total = query.count()
    tickets = query.order_by(Ticket.issued_at.desc()).offset(offset).limit(limit).all()
    return tickets, total


def get_ticket(db: Session, ticket_id: str) -> Optional[Ticket]:
    """Get a single ticket by ID."""
    return db.query(Ticket).filter(Ticket.id == ticket_id).first()


def update_ticket_status(db: Session, ticket_id: str, status: str) -> Optional[Ticket]:
    """Update a ticket's status."""
    valid_statuses = {"issued", "pending", "resolved"}
    if status not in valid_statuses:
        raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")

    ticket = get_ticket(db, ticket_id)
    if not ticket:
        return None

    ticket.status = status
    db.commit()
    db.refresh(ticket)
    logger.info("Updated ticket %s status to %s", ticket_id[:8], status)
    return ticket


def get_ticket_count(db: Session) -> int:
    """Get total number of tickets."""
    return db.query(func.count(Ticket.id)).scalar() or 0


def _build_vehicle_description(event: Event) -> str:
    """Generate a vehicle description from event data."""
    return "Vehicles involved in detected accident"


def _build_location_info(event: Event) -> str:
    """Generate location info from event data."""
    parts = []
    if event.source_video:
        parts.append(f"Source: {event.source_video}")
    if event.frame_number is not None:
        parts.append(f"Frame: {event.frame_number}")
    return " | ".join(parts) if parts else "Unknown location"
