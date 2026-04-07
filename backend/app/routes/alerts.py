"""Alerts routes — API for notification logs and statistics."""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.database import get_db
from app.models import AlertLog
from app.schemas import AlertLogList, AlertLogOut, AlertStatsOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=AlertLogList)
async def list_alerts(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
    channel: Optional[str] = None,
    status: Optional[str] = None,
    event_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """List alert notification logs."""
    query = db.query(AlertLog)

    if channel:
        query = query.filter(AlertLog.channel == channel)
    if status:
        query = query.filter(AlertLog.status == status)
    if event_id:
        query = query.filter(AlertLog.event_id == event_id)

    total = query.count()
    alerts = query.order_by(AlertLog.created_at.desc()).offset(offset).limit(limit).all()

    return AlertLogList(
        alerts=[AlertLogOut.model_validate(a) for a in alerts],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/stats", response_model=AlertStatsOut)
async def get_alert_stats(db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Get aggregate statistics for alert notifications."""
    totals = db.query(
        func.sum(case((AlertLog.status == "sent", 1), else_=0)).label("sent"),
        func.sum(case((AlertLog.status == "failed", 1), else_=0)).label("failed"),
        func.sum(case((AlertLog.status == "suppressed", 1), else_=0)).label("suppressed"),
    ).one()

    total_sent = int(totals.sent or 0)
    total_failed = int(totals.failed or 0)
    total_suppressed = int(totals.suppressed or 0)

    # Aggregate stats per channel
    by_channel = {}
    channel_stats = (
        db.query(AlertLog.channel, AlertLog.status, func.count(AlertLog.id))
        .group_by(AlertLog.channel, AlertLog.status)
        .all()
    )

    for channel, status, count in channel_stats:
        if channel not in by_channel:
            by_channel[channel] = {"sent": 0, "failed": 0, "suppressed": 0}
        if status in by_channel[channel]:
            by_channel[channel][status] = count

    return AlertStatsOut(
        total_sent=total_sent,
        total_failed=total_failed,
        total_suppressed=total_suppressed,
        by_channel=by_channel,
    )
