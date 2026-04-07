"""Settings routes — detection configuration management."""

import json
import logging
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends

from app.auth import get_current_admin
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Event, Ticket
from app.schemas import SettingsOut, SettingsUpdate
from app.storage import get_storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Persist runtime settings to a JSON file so they survive server restarts
_SETTINGS_FILE = Path(__file__).resolve().parent.parent.parent / "runtime_settings.json"


def _load_overrides() -> dict:
    """Load persisted runtime overrides from disk."""
    try:
        if _SETTINGS_FILE.exists():
            return json.loads(_SETTINGS_FILE.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load runtime settings: %s", e)
    return {}


def _save_overrides(overrides: dict) -> None:
    """Persist runtime overrides to disk."""
    try:
        _SETTINGS_FILE.write_text(json.dumps(overrides, indent=2))
    except OSError as e:
        logger.error("Failed to save runtime settings: %s", e)


def get_runtime_settings() -> dict:
    """Get the effective runtime settings (overrides merged with defaults).

    This is used by the detection pipeline to read the current config
    at request time, so settings changes take effect immediately.
    """
    settings = get_settings()
    overrides = _load_overrides()

    # Backward compatibility: if old single threshold exists but new ones don't,
    # use it as the default for both
    legacy_default = overrides.get("confidence_threshold", settings.confidence_threshold_manual)

    return {
        "confidence_threshold_manual": overrides.get(
            "confidence_threshold_manual", legacy_default
        ),
        "confidence_threshold_cctv": overrides.get(
            "confidence_threshold_cctv", legacy_default
        ),
        "detect_accidents": overrides.get(
            "detect_accidents", settings.detect_accidents
        ),
    }


@router.get("", response_model=SettingsOut)
async def get_current_settings(_admin: str = Depends(get_current_admin)):
    """Get current detection configuration."""
    settings = get_settings()
    overrides = _load_overrides()
    legacy_default = overrides.get("confidence_threshold", settings.confidence_threshold_manual)
    return SettingsOut(
        model_path=settings.model_path,
        confidence_threshold_manual=overrides.get(
            "confidence_threshold_manual", legacy_default
        ),
        confidence_threshold_cctv=overrides.get(
            "confidence_threshold_cctv", legacy_default
        ),
        detect_accidents=overrides.get(
            "detect_accidents", settings.detect_accidents
        ),
    )


@router.put("", response_model=SettingsOut)
async def update_settings(update: SettingsUpdate, _admin: str = Depends(get_current_admin)):
    """Update detection configuration.

    Changes are persisted to runtime_settings.json.
    """
    overrides = _load_overrides()
    if update.confidence_threshold_manual is not None:
        overrides["confidence_threshold_manual"] = update.confidence_threshold_manual
    if update.confidence_threshold_cctv is not None:
        overrides["confidence_threshold_cctv"] = update.confidence_threshold_cctv
    if update.detect_accidents is not None:
        overrides["detect_accidents"] = update.detect_accidents
    _save_overrides(overrides)

    return await get_current_settings()


@router.get("/notifications", response_model=dict)
async def get_notification_settings(_admin: str = Depends(get_current_admin)):
    """Get the current configuration for notification channels."""
    overrides = _load_overrides()
    config = overrides.get("notification_channels", {})
    return {
        "twilio": config.get("twilio", {"enabled_manual": False, "enabled_cctv": False}),
        "email": config.get("email", {
            "enabled": False, "smtp_host": "", "smtp_port": 587,
            "smtp_user": "", "smtp_password": "", "from_address": "", "to_addresses": []
        }),
        "webhook": config.get("webhook", {"enabled": False, "url": "", "headers": {}}),
        "telegram": config.get("telegram", {"enabled": False}),
        "cooldown_seconds": config.get("cooldown_seconds", 300)
    }


@router.put("/notifications")
async def update_notification_settings(update: dict, _admin: str = Depends(get_current_admin)):
    """Update notification channels configuration."""
    overrides = _load_overrides()
    channels = overrides.get("notification_channels", {})

    if "twilio" in update:
        channels["twilio"] = update["twilio"]
    if "email" in update:
        channels["email"] = update["email"]
    if "webhook" in update:
        channels["webhook"] = update["webhook"]
    if "telegram" in update:
        channels["telegram"] = update["telegram"]
    if "cooldown_seconds" in update:
        channels["cooldown_seconds"] = int(update["cooldown_seconds"])

    overrides["notification_channels"] = channels
    _save_overrides(overrides)

    return await get_notification_settings()


@router.delete("/data")
async def delete_all_data(db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Delete all events, tickets, and evidence files (both Supabase and local)."""
    settings = get_settings()

    # Delete all tickets first (FK constraint)
    ticket_count = db.query(Ticket).delete()
    event_count = db.query(Event).delete()
    db.commit()

    # Clear evidence from Supabase Storage
    storage = get_storage_service()
    evidence_cleared = storage.delete_all_evidence()
    logger.info("Deleted %d evidence files from Supabase Storage", evidence_cleared)

    # Clear local evidence directory (for any legacy files)
    local_evidence_cleared = 0
    if os.path.isdir(settings.evidence_dir):
        for f in os.listdir(settings.evidence_dir):
            filepath = os.path.join(settings.evidence_dir, f)
            if os.path.isfile(filepath):
                os.remove(filepath)
                local_evidence_cleared += 1
    
    if local_evidence_cleared > 0:
        logger.info("Deleted %d local evidence files", local_evidence_cleared)

    # Clear uploads directory
    uploads_cleared = 0
    if os.path.isdir(settings.uploads_dir):
        for f in os.listdir(settings.uploads_dir):
            filepath = os.path.join(settings.uploads_dir, f)
            if os.path.isfile(filepath):
                os.remove(filepath)
                uploads_cleared += 1

    logger.info(
        "Deleted all data: %d events, %d tickets, %d evidence files (Supabase + %d local), %d uploads",
        event_count, ticket_count, evidence_cleared, local_evidence_cleared, uploads_cleared,
    )

    return {
        "deleted": {
            "events": event_count,
            "tickets": ticket_count,
            "evidence_files": evidence_cleared + local_evidence_cleared,
            "upload_files": uploads_cleared,
        }
    }

