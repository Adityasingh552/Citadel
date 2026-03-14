"""Stats routes — aggregate dashboard statistics."""

from fastapi import APIRouter, Depends

from app.auth import get_current_admin
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import StatsOut
from app.services import event_service, ticket_service

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
async def get_stats(db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Get aggregate statistics for the dashboard overview."""
    stats = event_service.get_stats(db)
    stats["total_tickets"] = ticket_service.get_ticket_count(db)
    return StatsOut(**stats)
