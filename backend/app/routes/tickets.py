"""Ticket routes — list, retrieve, and update violation tickets."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_admin
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import TicketOut, TicketList, TicketUpdate
from app.services import ticket_service

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("", response_model=TicketList)
async def list_tickets(
    status: Optional[str] = None,
    violation_type: Optional[str] = Query(None, alias="type"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """List tickets with optional status/type filters."""
    tickets, total = ticket_service.list_tickets(
        db, status=status, violation_type=violation_type,
        limit=limit, offset=offset,
    )
    return TicketList(
        tickets=[TicketOut.model_validate(t) for t in tickets],
        total=total, limit=limit, offset=offset,
    )


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: str, db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Get a single ticket by ID."""
    ticket = ticket_service.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return TicketOut.model_validate(ticket)


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    update: TicketUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Update a ticket's status (issued → pending → resolved)."""
    try:
        ticket = ticket_service.update_ticket_status(db, ticket_id, update.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return TicketOut.model_validate(ticket)
