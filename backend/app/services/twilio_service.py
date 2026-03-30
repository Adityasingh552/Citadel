"""Twilio emergency voice call service.

Dispatches a fire-and-forget voice call to the configured emergency contact
when a critical traffic incident is detected. Calls are placed via the Twilio
REST API using inline TwiML (no external webhook needed).

Cooldown:
    A module-level timestamp prevents calls from being placed more frequently
    than ``twilio_call_cooldown_seconds`` (default 300 s / 5 min). This avoids
    flooding the contact when a CCTV feed continuously detects accidents.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Cooldown state (module-level, shared across all threads) ───────────────
_cooldown_lock = threading.Lock()
_last_call_ts: float = 0.0   # epoch seconds of the most recent initiated call


# ─────────────────────────────────────────────────────────────────────────────

def _build_twiml(event_details: dict) -> str:
    """Return TwiML XML that narrates the incident details via <Say>."""
    event_type = event_details.get("event_type", "unknown")
    severity   = event_details.get("severity", "unknown")
    source     = (
        event_details.get("source_video")
        or event_details.get("camera_id")
        or "unknown source"
    )
    timestamp  = event_details.get("timestamp", datetime.now(timezone.utc).isoformat())

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


def _do_call(event_details: dict) -> None:
    """Blocking Twilio REST call — runs inside a daemon thread.

    Imports twilio lazily so the server starts cleanly even if the package
    is not yet installed or TWILIO_ENABLED_* is False.
    """
    from app.config import get_settings  # deferred to avoid circular imports at module load
    settings = get_settings()

    try:
        from twilio.rest import Client  # type: ignore[import]
    except ImportError:
        logger.error(
            "twilio package is not installed. "
            "Run: pip install twilio>=9.0"
        )
        return

    if not settings.twilio_account_sid or not settings.twilio_auth_token:
        logger.error("Twilio SID/token not configured — skipping emergency call.")
        return

    if not settings.twilio_from_number or not settings.emergency_contact_number:
        logger.error("Twilio from/to numbers not configured — skipping emergency call.")
        return

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
    except Exception as exc:
        logger.error("Emergency call failed: %s", exc)


def make_emergency_call(event_details: dict) -> bool:
    """Dispatch an emergency voice call in a background daemon thread.

    Enforces a per-process cooldown so calls are not placed more frequently
    than ``twilio_call_cooldown_seconds``.

    Args:
        event_details: Dict containing at least ``event_type``, ``severity``,
            and one of ``source_video`` / ``camera_id``, plus ``timestamp``.

    Returns:
        ``True`` if a call thread was started, ``False`` if suppressed by cooldown.
    """
    from app.config import get_settings
    settings = get_settings()

    global _last_call_ts

    with _cooldown_lock:
        now = time.monotonic()
        elapsed = now - _last_call_ts
        cooldown = settings.twilio_call_cooldown_seconds

        if _last_call_ts > 0 and elapsed < cooldown:
            remaining = int(cooldown - elapsed)
            logger.info(
                "Emergency call suppressed by cooldown (%ds remaining). "
                "event_type=%s severity=%s",
                remaining,
                event_details.get("event_type"),
                event_details.get("severity"),
            )
            return False

        _last_call_ts = now  # reserve the slot before releasing the lock

    t = threading.Thread(
        target=_do_call,
        args=(event_details,),
        daemon=True,
        name="twilio-emergency-call",
    )
    t.start()
    logger.debug(
        "Emergency call thread started. event_type=%s severity=%s",
        event_details.get("event_type"),
        event_details.get("severity"),
    )
    return True
