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
    return {
        "confidence_threshold": overrides.get(
            "confidence_threshold", settings.confidence_threshold
        ),
        "detect_accidents": overrides.get(
            "detect_accidents", settings.detect_accidents
        ),
        "detect_vehicles": overrides.get(
            "detect_vehicles", settings.detect_vehicles
        ),
        "frame_interval": overrides.get(
            "frame_interval", settings.frame_interval
        ),
    }


@router.get("", response_model=SettingsOut)
async def get_current_settings(_admin: str = Depends(get_current_admin)):
    """Get current detection configuration."""
    settings = get_settings()
    overrides = _load_overrides()
    return SettingsOut(
        model_name=settings.model_name,
        confidence_threshold=overrides.get(
            "confidence_threshold", settings.confidence_threshold
        ),
        detect_accidents=overrides.get(
            "detect_accidents", settings.detect_accidents
        ),
        detect_vehicles=overrides.get(
            "detect_vehicles", settings.detect_vehicles
        ),
        frame_interval=overrides.get(
            "frame_interval", settings.frame_interval
        ),
    )


@router.put("", response_model=SettingsOut)
async def update_settings(update: SettingsUpdate, _admin: str = Depends(get_current_admin)):
    """Update detection configuration.

    Changes are persisted to runtime_settings.json.
    """
    overrides = _load_overrides()
    if update.confidence_threshold is not None:
        overrides["confidence_threshold"] = update.confidence_threshold
    if update.detect_accidents is not None:
        overrides["detect_accidents"] = update.detect_accidents
    if update.detect_vehicles is not None:
        overrides["detect_vehicles"] = update.detect_vehicles
    if update.frame_interval is not None:
        overrides["frame_interval"] = update.frame_interval
    _save_overrides(overrides)

    return await get_current_settings()


@router.delete("/data")
async def delete_all_data(db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Delete all events, tickets, and evidence files."""
    settings = get_settings()

    # Delete all tickets first (FK constraint)
    ticket_count = db.query(Ticket).delete()
    event_count = db.query(Event).delete()
    db.commit()

    # Clear evidence directory
    evidence_cleared = 0
    if os.path.isdir(settings.evidence_dir):
        for f in os.listdir(settings.evidence_dir):
            filepath = os.path.join(settings.evidence_dir, f)
            if os.path.isfile(filepath):
                os.remove(filepath)
                evidence_cleared += 1

    # Clear uploads directory
    uploads_cleared = 0
    if os.path.isdir(settings.uploads_dir):
        for f in os.listdir(settings.uploads_dir):
            filepath = os.path.join(settings.uploads_dir, f)
            if os.path.isfile(filepath):
                os.remove(filepath)
                uploads_cleared += 1

    logger.info(
        "Deleted all data: %d events, %d tickets, %d evidence files, %d uploads",
        event_count, ticket_count, evidence_cleared, uploads_cleared,
    )

    return {
        "deleted": {
            "events": event_count,
            "tickets": ticket_count,
            "evidence_files": evidence_cleared,
            "upload_files": uploads_cleared,
        }
    }

