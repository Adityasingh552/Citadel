"""Twilio emergency voice call service.

Dispatches a voice call to the configured emergency contact when a critical
traffic incident is detected. Calls are placed via the Twilio REST API
using inline TwiML (no external webhook needed).

This module has been refactored to serve strictly as a channel sender.
Cooldown and threading logic are now handled by the notification_service.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _clean_for_speech(text: str) -> str:
    """Remove special characters that Twilio might read verbatim, like underscores, dashes, etc."""
    if not isinstance(text, str):
        text = str(text)
    # Replace anything that isn't a letter, number, space, comma, or period.
    # \w includes underscore, so we also explicitly replace underscore.
    cleaned = re.sub(r'[^\w\s\.,]|_', ' ', text)
    # Condense multiple spaces
    return re.sub(r'\s+', ' ', cleaned).strip()


def _format_spoken_time(ts_str: str) -> str:
    """Parse an ISO 8601 timestamp string and convert it into a natural spoken format."""
    try:
        # Standardize for fromisoformat
        dt_str = str(ts_str).replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(dt_str)
        except ValueError:
            # Fallback if there are parsing issues, grab exactly "YYYY-MM-DDTHH:MM:SS"
            dt = datetime.fromisoformat(dt_str[:19])
            
        # Format string on Linux handles %-d and %-I to remove leading zeroes.
        # e.g., "March 31 at 6 14 PM" instead of "06:14 PM"
        return dt.strftime("%B %-d at %-I %M %p")
    except Exception as e:
        logger.warning(f"Twilio spoken time formatting failed for '{ts_str}': {e}")
        return str(ts_str)


def _build_twiml(event_details: dict) -> str:
    """Return TwiML XML that narrates the incident details via <Say>."""
    event_type = event_details.get("event_type", "unknown")
    severity   = event_details.get("severity", "unknown")
    raw_timestamp = event_details.get("timestamp", datetime.now(timezone.utc).isoformat())
    timestamp = _format_spoken_time(raw_timestamp)

    # Formulate a source description
    if event_details.get("upload_source", event_details.get("source", "manual")) == "manual":
        source = "4905 Webster Street,Bound Brook,New Jersey, pincode 08805"
    else:
        source = (
            event_details.get("camera_name")
            or event_details.get("camera_id")
            or "unknown CCTV source"
        )

    # Clean fields so Twilio doesn't read out symbols like 'underscore' or 'dash'
    event_type = _clean_for_speech(event_type)
    severity = _clean_for_speech(severity)
    source = _clean_for_speech(source)
    timestamp = _clean_for_speech(timestamp)

    message = (
        f"Alert. Citadel traffic monitoring system has detected "
        f"a {severity} severity {event_type} event. "
        f"Source: {source}. "
        f"Time {timestamp}. "
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
