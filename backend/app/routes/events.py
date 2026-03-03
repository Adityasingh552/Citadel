"""Event routes — list and retrieve detected events."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import EventOut, EventList
from app.services import event_service

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=EventList)
async def list_events(
    event_type: Optional[str] = Query(None, alias="type"),
    severity: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    """List events with optional filters."""
    events, total = event_service.list_events(
        db, event_type=event_type, severity=severity,
        limit=limit, offset=offset,
        date_from=date_from, date_to=date_to,
    )
    return EventList(
        events=[EventOut.model_validate(e) for e in events],
        total=total, limit=limit, offset=offset,
    )


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: str, db: Session = Depends(get_db)):
    """Get a single event by ID."""
    event = event_service.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return EventOut.model_validate(event)
