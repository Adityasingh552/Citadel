"""Twilio emergency voice call service.

Dispatches a voice call to the configured emergency contact when a critical
traffic incident is detected. Calls are placed via the Twilio REST API
using inline TwiML (no external webhook needed).

This module has been refactored to serve strictly as a channel sender.
Cooldown and threading logic are now handled by the notification_service.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _build_twiml(event_details: dict) -> str:
    """Return TwiML XML that narrates the incident details via <Say>."""
    event_type = event_details.get("event_type", "unknown")
    severity   = event_details.get("severity", "unknown")
    timestamp  = event_details.get("timestamp", datetime.now(timezone.utc).isoformat())

    # Formulate a source description
    if event_details.get("upload_source", event_details.get("source", "manual")) == "manual":
        source = "demo address"
    else:
        source = (
            event_details.get("camera_name")
            or event_details.get("camera_id")
            or "unknown CCTV source"
        )

    # Sanitise angle brackets that would break inline XML
    for val in (event_type, severity, source, timestamp):
        if isinstance(val, str):
            val = val.replace("<", "").replace(">", "")

    message = (
        f"Alert. Citadel traffic monitoring system has detected "
        f"a {severity} severity {event_type} event. "
        f"Source: {source}. "
        f"Time: {timestamp}. "
        f"Please take appropriate action immediately. "
        # Repeat once for intelligibility
        f"Repeating. "
        f"A {severity} severity {event_type} event was detected at {source}."
    )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say voice="alice" language="en-IN">{message}</Say>'
        "</Response>"
    )


def make_emergency_call(event_details: dict) -> dict:
    """Make the Twilio REST call.

    Imports twilio lazily so the server starts cleanly even if the package
    is not yet installed or TWILIO_ENABLED_* is False.

    Returns:
        dict: containing 'success' (bool) and optionally 'sid' or 'error' (str).
    """
    from app.config import get_settings  # deferred to avoid circular imports at module load
    settings = get_settings()

    try:
        from twilio.rest import Client  # type: ignore[import]
    except ImportError:
        err = "twilio package is not installed."
        logger.error(err)
        return {"success": False, "error": err}

    if not settings.twilio_account_sid or not settings.twilio_auth_token:
        err = "Twilio SID/token not configured."
        logger.error(err)
        return {"success": False, "error": err}

    if not settings.twilio_from_number or not settings.emergency_contact_number:
        err = "Twilio from/to numbers not configured."
        logger.error(err)
        return {"success": False, "error": err}

    try:
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        twiml  = _build_twiml(event_details)

        call = client.calls.create(
            twiml=twiml,
            to=settings.emergency_contact_number,
            from_=settings.twilio_from_number,
        )
        logger.info(
            "Emergency call initiated. SID=%s to=%s event_type=%s severity=%s",
            call.sid,
            settings.emergency_contact_number,
            event_details.get("event_type"),
            event_details.get("severity"),
        )
        return {"success": True, "sid": call.sid}
    except Exception as exc:
        logger.error("Emergency call failed: %s", exc)
        return {"success": False, "error": str(exc)}
