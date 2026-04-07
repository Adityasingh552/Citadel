"""Stats routes — aggregate dashboard statistics."""

from fastapi import APIRouter, Depends
from pathlib import Path

from app.auth import get_current_admin
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import StatsOut, ServiceStatusOut
from app.services import event_service, ticket_service
from app.routes.settings import _load_overrides, get_runtime_settings
from app.routes.detection import get_processor

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
async def get_stats(db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Get aggregate statistics for the dashboard overview."""
    stats = event_service.get_stats(db)
    stats["total_tickets"] = ticket_service.get_ticket_count(db)
    return StatsOut(**stats)


@router.get("/services", response_model=ServiceStatusOut)
async def get_service_status(_admin: str = Depends(get_current_admin)):
    """Get operational status of all system services."""
    overrides = _load_overrides()
    nc = overrides.get("notification_channels", {})
    rt = get_runtime_settings()

    model_loaded = False
    model_path = ""
    try:
        processor = get_processor()
        model_loaded = processor.detector.is_loaded
        model_path = processor.detector.model_path
    except Exception:
        pass

    model_file_exists = False
    if model_path:
        model_file_exists = Path(model_path).exists()

    twilio_cfg = nc.get("twilio", {})
    twilio_enabled = twilio_cfg.get("enabled_manual", False) or twilio_cfg.get("enabled_cctv", False)

    email_cfg = nc.get("email", {})
    email_enabled = email_cfg.get("enabled", False)

    telegram_cfg = nc.get("telegram", {})
    telegram_enabled = telegram_cfg.get("enabled", False)

    from app.config import get_settings
    settings = get_settings()
    twilio_configured = bool(settings.twilio_account_sid and settings.twilio_auth_token
                             and settings.twilio_from_number and settings.emergency_contact_number)

    return ServiceStatusOut(
        model=model_loaded and model_file_exists,
        detection=rt["detect_accidents"],
        twilio=twilio_enabled and twilio_configured,
        telegram=telegram_enabled,
        email=email_enabled,
    )
