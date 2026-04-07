"""Incidents routes — unified view combining events with their tickets."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.database import get_db
from app.schemas import IncidentOut, IncidentList, IncidentStatsOut, ConfidenceBin
from app.services import event_service
from app.services import ticket_service

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


@router.get("", response_model=IncidentList)
async def list_incidents(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """List incidents — events joined with their ticket workflow data."""
    events, total = event_service.list_events(
        db, severity=severity,
        limit=limit, offset=offset,
        date_from=date_from, date_to=date_to,
    )

    incidents = []
    for event in events:
        ticket = event.tickets[0] if event.tickets else None
        if status and ticket and ticket.status != status:
            continue
        if status and not ticket:
            continue

        incidents.append(IncidentOut(
            id=event.id,
            ticket_id=ticket.id if ticket else None,
            timestamp=event.timestamp,
            event_type=event.event_type,
            confidence=event.confidence,
            severity=event.severity,
            evidence_path=event.evidence_path,
            source_video=event.source_video,
            metadata=event.metadata_,
            status=ticket.status if ticket else "no_ticket",
            issued_at=ticket.issued_at if ticket else None,
            created_at=event.created_at,
        ))

    return IncidentList(
        incidents=incidents,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{incident_id}", response_model=IncidentOut)
async def get_incident(
    incident_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Get a single incident by event ID."""
    event = event_service.get_event(db, incident_id)
    if not event:
        raise HTTPException(status_code=404, detail="Incident not found")

    ticket = event.tickets[0] if event.tickets else None

    return IncidentOut(
        id=event.id,
        ticket_id=ticket.id if ticket else None,
        timestamp=event.timestamp,
        event_type=event.event_type,
        confidence=event.confidence,
        severity=event.severity,
        evidence_path=event.evidence_path,
        source_video=event.source_video,
        metadata=event.metadata_,
        status=ticket.status if ticket else "no_ticket",
        issued_at=ticket.issued_at if ticket else None,
        created_at=event.created_at,
    )


@router.patch("/{incident_id}/status", response_model=IncidentOut)
async def update_incident_status(
    incident_id: str,
    status: str = Query(..., description="New status: issued, pending, or resolved"),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Update the ticket status for an incident."""
    event = event_service.get_event(db, incident_id)
    if not event:
        raise HTTPException(status_code=404, detail="Incident not found")

    if not event.tickets:
        raise HTTPException(status_code=404, detail="No ticket found for this incident")

    ticket = ticket_service.update_ticket_status(db, event.tickets[0].id, status)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    return IncidentOut(
        id=event.id,
        ticket_id=ticket.id,
        timestamp=event.timestamp,
        event_type=event.event_type,
        confidence=event.confidence,
        severity=event.severity,
        evidence_path=event.evidence_path,
        source_video=event.source_video,
        metadata=event.metadata_,
        status=ticket.status,
        issued_at=ticket.issued_at,
        created_at=event.created_at,
    )


@router.get("/stats/overview", response_model=IncidentStatsOut)
async def get_incident_stats(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Get aggregate incident statistics with confidence distribution."""
    from sqlalchemy import func as sa_func
    from app.models import Event, Ticket

    total = db.query(sa_func.count(Event.id)).scalar() or 0

    avg_conf = db.query(sa_func.avg(Event.confidence)).scalar()
    avg_confidence = round(float(avg_conf), 2) if avg_conf else 0.0

    resolved = db.query(sa_func.count(Ticket.id)).filter(Ticket.status == "resolved").scalar() or 0
    pending = db.query(sa_func.count(Ticket.id)).filter(Ticket.status == "pending").scalar() or 0
    issued = db.query(sa_func.count(Ticket.id)).filter(Ticket.status == "issued").scalar() or 0

    confidence_distribution = _build_confidence_distribution(db)

    return IncidentStatsOut(
        total_incidents=total,
        resolved_count=resolved,
        pending_count=pending,
        issued_count=issued,
        avg_confidence=avg_confidence,
        confidence_distribution=confidence_distribution,
    )


def _build_confidence_distribution(db: Session) -> list[ConfidenceBin]:
    """Build confidence histogram with 10 bins (50-55%, 55-60%, ..., 95-100%)."""
    from sqlalchemy import func as sa_func
    from app.models import Event

    bins = []
    for i in range(10):
        low = 0.50 + i * 0.05
        high = low + 0.05
        count = db.query(sa_func.count(Event.id)).filter(
            Event.confidence >= low,
            Event.confidence < high,
        ).scalar() or 0
        bins.append(ConfidenceBin(
            label=f"{int(low * 100)}-{int(high * 100)}%",
            count=count,
        ))

    return bins
