"""Notification service — multi-channel alert dispatcher.

Dispatches notifications across configured channels (Twilio voice, email,
custom webhook) when a critical traffic incident is detected.  Every dispatch
attempt is recorded to the ``alert_logs`` table so the dashboard can show
complete alert history.

All notification payloads include **full** detection details:
  - event type, severity, confidence, timestamp
  - bounding box data (JSON)
  - evidence image frame path
  - CCTV camera name / live feed link (when source == cctv)
"""

from __future__ import annotations

import base64
import json
import logging
import smtplib
import threading
import time
from datetime import datetime, timezone
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

import httpx

from sqlalchemy.orm import Session

from app.models import AlertLog

logger = logging.getLogger(__name__)

# ── Per-channel cooldown state ─────────────────────────────────────────────
_cooldown_lock = threading.Lock()
_last_sent: dict[str, float] = {}  # channel -> epoch monotonic


def _check_cooldown(channel: str, cooldown_seconds: int) -> bool:
    """Return True if the channel is in cooldown (should be suppressed)."""
    with _cooldown_lock:
        now = time.monotonic()
        last = _last_sent.get(channel, 0.0)
        if last > 0 and (now - last) < cooldown_seconds:
            return True
        return False


def _mark_sent(channel: str) -> None:
    """Mark a channel as just having sent a notification."""
    with _cooldown_lock:
        _last_sent[channel] = time.monotonic()


# ── Notification channel config helpers ────────────────────────────────────

def _load_notification_config() -> dict:
    """Load notification channel config from runtime_settings.json."""
    from app.routes.settings import _load_overrides
    overrides = _load_overrides()
    return overrides.get("notification_channels", {})


def _get_evidence_base_url() -> str:
    """Return the base URL for evidence files (relative to API)."""
    return "/evidence"


# ── Rich payload builder ──────────────────────────────────────────────────

def _build_payload(event_details: dict) -> dict:
    """Build a comprehensive notification payload with all detection details."""
    event_type = event_details.get("event_type", "unknown")
    severity = event_details.get("severity", "unknown")
    confidence = event_details.get("confidence", 0.0)
    timestamp = event_details.get("timestamp", datetime.now(timezone.utc).isoformat())
    bbox_data = event_details.get("bbox_data")
    evidence_path = event_details.get("evidence_path")
    source = event_details.get("source", "manual")
    camera_id = event_details.get("camera_id")
    camera_name = event_details.get("camera_name", "")
    source_video = event_details.get("source_video", "")
    event_id = event_details.get("event_id", "")

    payload = {
        "system": "Citadel Traffic Safety Analytics",
        "event_id": event_id,
        "event_type": event_type,
        "severity": severity,
        "confidence": f"{confidence * 100:.1f}%" if isinstance(confidence, float) and confidence <= 1 else str(confidence),
        "timestamp": timestamp,
        "source": source,
        "bounding_boxes": bbox_data or [],
    }

    if evidence_path:
        payload["evidence_image"] = f"{_get_evidence_base_url()}/{evidence_path}"

    if source == "cctv" and camera_id:
        payload["camera_id"] = camera_id
        payload["camera_name"] = camera_name
        # Link to the live camera snapshot proxy
        payload["cctv_live_feed_url"] = f"/api/cameras/{camera_id}/snapshot"
        payload["cctv_info_url"] = f"/api/cameras/{camera_id}/info"
    elif source_video:
        payload["source_file"] = source_video

    return payload


# ── Email channel ──────────────────────────────────────────────────────────

def _build_email_html(payload: dict, event_details: dict) -> str:
    """Build a rich HTML email with all detection details."""
    severity_colors = {
        "high": "#ef4444",
        "medium": "#f59e0b",
        "low": "#10b981",
    }
    sev = event_details.get("severity", "unknown")
    sev_color = severity_colors.get(sev, "#6b7280")

    bbox_html = ""
    if payload.get("bounding_boxes"):
        bbox_rows = ""
        for i, box in enumerate(payload["bounding_boxes"]):
            bbox_rows += f"""
            <tr>
                <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">{i+1}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">{box.get('label','—')}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">{box.get('confidence', 0):.1%}</td>
                <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">
                    ({box.get('x',0):.0f}, {box.get('y',0):.0f}) {box.get('width',0):.0f}×{box.get('height',0):.0f}
                </td>
            </tr>"""
        bbox_html = f"""
        <h3 style="margin:16px 0 8px;">Bounding Boxes</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <tr style="background:#f1f5f9;">
                <th style="padding:8px 12px;text-align:left;">#</th>
                <th style="padding:8px 12px;text-align:left;">Label</th>
                <th style="padding:8px 12px;text-align:left;">Confidence</th>
                <th style="padding:8px 12px;text-align:left;">Region</th>
            </tr>
            {bbox_rows}
        </table>"""

    camera_html = ""
    if payload.get("camera_id"):
        camera_html = f"""
        <h3 style="margin:16px 0 8px;">CCTV Source</h3>
        <table style="border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:4px 12px;font-weight:600;">Camera ID</td><td style="padding:4px 12px;">{payload['camera_id']}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:600;">Camera Name</td><td style="padding:4px 12px;">{payload.get('camera_name','—')}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:600;">Live Feed</td><td style="padding:4px 12px;"><a href="{payload.get('cctv_live_feed_url','')}">View Live Snapshot</a></td></tr>
        </table>"""

    evidence_note = ""
    if payload.get("evidence_image"):
        evidence_note = """<p style="margin:12px 0;color:#64748b;font-size:13px;">📎 Evidence frame image is attached to this email.</p>"""

    return f"""
    <div style="font-family:'Inter',-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
        <div style="background:#111827;padding:20px 24px;border-radius:8px 8px 0 0;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;">🏰 Citadel Alert</h1>
        </div>
        <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
            <div style="background:{sev_color}15;border-left:4px solid {sev_color};padding:12px 16px;border-radius:4px;margin-bottom:16px;">
                <span style="font-size:18px;font-weight:700;color:{sev_color};text-transform:uppercase;">{sev} Severity {payload['event_type']}</span>
            </div>

            <table style="border-collapse:collapse;width:100%;font-size:14px;">
                <tr><td style="padding:6px 12px;font-weight:600;width:140px;">Event ID</td><td style="padding:6px 12px;">{payload['event_id'][:12]}...</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;">Type</td><td style="padding:6px 12px;">{payload['event_type']}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;">Severity</td><td style="padding:6px 12px;color:{sev_color};font-weight:600;">{sev.upper()}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;">Confidence</td><td style="padding:6px 12px;">{payload['confidence']}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;">Timestamp</td><td style="padding:6px 12px;">{payload['timestamp']}</td></tr>
                <tr><td style="padding:6px 12px;font-weight:600;">Source</td><td style="padding:6px 12px;">{payload['source']}</td></tr>
            </table>

            {camera_html}
            {bbox_html}
            {evidence_note}

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
            <p style="color:#94a3b8;font-size:12px;margin:0;">Automated alert from Citadel Traffic Safety Analytics</p>
        </div>
    </div>"""


def _send_email(config: dict, event_details: dict, payload: dict) -> dict:
    """Send an email alert with full detection details + evidence image attachment.

    Returns: {"status": "sent"|"failed", "error": str|None}
    """
    try:
        smtp_host = config.get("smtp_host", "")
        smtp_port = config.get("smtp_port", 587)
        smtp_user = config.get("smtp_user", "")
        smtp_password = config.get("smtp_password", "")
        from_addr = config.get("from_address", smtp_user)
        to_addrs = config.get("to_addresses", [])

        if not smtp_host or not to_addrs:
            return {"status": "failed", "error": "SMTP host or recipients not configured"}

        # Build email
        msg = MIMEMultipart("mixed")
        msg["Subject"] = (
            f"🚨 Citadel Alert: {event_details.get('severity', 'unknown').upper()} "
            f"{event_details.get('event_type', 'event')}"
        )
        msg["From"] = from_addr
        msg["To"] = ", ".join(to_addrs)

        # HTML body
        html = _build_email_html(payload, event_details)
        msg.attach(MIMEText(html, "html"))

        # Attach evidence image if available
        evidence_path = event_details.get("evidence_path")
        if evidence_path:
            from app.config import get_settings
            settings = get_settings()
            full_path = Path(settings.evidence_dir) / evidence_path
            if full_path.exists():
                with open(full_path, "rb") as f:
                    img_data = f.read()
                img_mime = MIMEImage(img_data, name=full_path.name)
                img_mime.add_header("Content-ID", "<evidence_frame>")
                msg.attach(img_mime)

        # Send
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
            server.starttls()

        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)

        server.sendmail(from_addr, to_addrs, msg.as_string())
        server.quit()

        logger.info("Email alert sent to %s", to_addrs)
        return {"status": "sent", "error": None}

    except Exception as exc:
        logger.error("Email alert failed: %s", exc)
        return {"status": "failed", "error": str(exc)}


# ── Webhook channel ────────────────────────────────────────────────────────

def _send_webhook(config: dict, event_details: dict, payload: dict) -> dict:
    """POST full detection details as JSON to a custom webhook URL.

    If the event has an evidence image, it is base64-encoded and included.
    Returns: {"status": "sent"|"failed", "error": str|None, "status_code": int|None}
    """
    try:
        url = config.get("url", "")
        custom_headers = config.get("headers", {})

        if not url:
            return {"status": "failed", "error": "Webhook URL not configured"}

        # Add base64 evidence image to the payload
        webhook_payload = {**payload}
        evidence_path = event_details.get("evidence_path")
        if evidence_path:
            from app.config import get_settings
            settings = get_settings()
            full_path = Path(settings.evidence_dir) / evidence_path
            if full_path.exists() and full_path.stat().st_size < 5 * 1024 * 1024:  # < 5 MB
                with open(full_path, "rb") as f:
                    webhook_payload["evidence_image_base64"] = base64.b64encode(f.read()).decode()
                    webhook_payload["evidence_image_filename"] = full_path.name

        headers = {"Content-Type": "application/json", **custom_headers}

        with httpx.Client(timeout=15) as client:
            resp = client.post(url, json=webhook_payload, headers=headers)

        if resp.status_code < 400:
            logger.info("Webhook alert sent to %s — HTTP %d", url, resp.status_code)
            return {"status": "sent", "error": None, "status_code": resp.status_code}
        else:
            err = f"HTTP {resp.status_code}: {resp.text[:200]}"
            logger.warning("Webhook alert returned error: %s", err)
            return {"status": "failed", "error": err, "status_code": resp.status_code}

    except Exception as exc:
        logger.error("Webhook alert failed: %s", exc)
        return {"status": "failed", "error": str(exc)}


# ── Central Dispatcher ─────────────────────────────────────────────────────

def dispatch_alerts(event_details: dict, db: Session) -> list[dict]:
    """Dispatch notifications to all enabled channels for a detection event.

    Evaluates channel configs from runtime_settings.json, enforces per-channel
    cooldown, dispatches in background threads, and logs every attempt to
    the ``alert_logs`` table.

    Args:
        event_details: Dict containing full detection details:
            - event_id, event_type, severity, confidence, timestamp
            - evidence_path, bbox_data, source_video
            - source ("manual"|"cctv"), camera_id, camera_name
        db: SQLAlchemy session for logging

    Returns:
        List of result dicts for each channel attempt.
    """
    config = _load_notification_config()
    cooldown = config.get("cooldown_seconds", 300)
    source = event_details.get("source", "manual")
    results: list[dict] = []

    # Build the rich payload once
    payload = _build_payload(event_details)

    # ── Twilio Voice ───────────────────────────────────────────────────────
    twilio_cfg = config.get("twilio", {})
    twilio_enabled = (
        (source == "manual" and twilio_cfg.get("enabled_manual", False))
        or (source == "cctv" and twilio_cfg.get("enabled_cctv", False))
    )

    if twilio_enabled:
        if _check_cooldown("twilio", cooldown):
            _log_alert(db, event_details, "twilio", "suppressed",
                       recipient="(cooldown)", details={"reason": "cooldown"})
            results.append({"channel": "twilio", "status": "suppressed"})
        else:
            # Fire in background thread
            t = threading.Thread(
                target=_dispatch_twilio_thread,
                args=(event_details, payload, db),
                daemon=True,
                name="notify-twilio",
            )
            t.start()
            _mark_sent("twilio")
            results.append({"channel": "twilio", "status": "dispatched"})

    # ── Email ──────────────────────────────────────────────────────────────
    email_cfg = config.get("email", {})
    if email_cfg.get("enabled", False):
        if _check_cooldown("email", cooldown):
            _log_alert(db, event_details, "email", "suppressed",
                       recipient=str(email_cfg.get("to_addresses", [])),
                       details={"reason": "cooldown"})
            results.append({"channel": "email", "status": "suppressed"})
        else:
            t = threading.Thread(
                target=_dispatch_email_thread,
                args=(email_cfg, event_details, payload, db),
                daemon=True,
                name="notify-email",
            )
            t.start()
            _mark_sent("email")
            results.append({"channel": "email", "status": "dispatched"})

    # ── Custom Webhook ─────────────────────────────────────────────────────
    webhook_cfg = config.get("webhook", {})
    if webhook_cfg.get("enabled", False):
        if _check_cooldown("webhook", cooldown):
            _log_alert(db, event_details, "webhook", "suppressed",
                       recipient=webhook_cfg.get("url", ""),
                       details={"reason": "cooldown"})
            results.append({"channel": "webhook", "status": "suppressed"})
        else:
            t = threading.Thread(
                target=_dispatch_webhook_thread,
                args=(webhook_cfg, event_details, payload, db),
                daemon=True,
                name="notify-webhook",
            )
            t.start()
            _mark_sent("webhook")
            results.append({"channel": "webhook", "status": "dispatched"})

    return results


# ── Background dispatch threads ────────────────────────────────────────────

def _dispatch_twilio_thread(event_details: dict, payload: dict, db_unused: Session) -> None:
    """Run Twilio call in background and log the result."""
    from app.services.twilio_service import make_emergency_call
    result = make_emergency_call(event_details)

    # Log to DB in a new session (thread-safe)
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        from app.config import get_settings
        settings = get_settings()
        _log_alert(
            db, event_details, "twilio",
            "sent" if result.get("success") else "failed",
            recipient=settings.emergency_contact_number,
            details=result,
        )
    finally:
        db.close()


def _dispatch_email_thread(email_cfg: dict, event_details: dict, payload: dict, db_unused: Session) -> None:
    """Send email in background and log the result."""
    result = _send_email(email_cfg, event_details, payload)

    from app.database import SessionLocal
    db = SessionLocal()
    try:
        _log_alert(
            db, event_details, "email",
            result["status"],
            recipient=", ".join(email_cfg.get("to_addresses", [])),
            details=result,
        )
    finally:
        db.close()


def _dispatch_webhook_thread(webhook_cfg: dict, event_details: dict, payload: dict, db_unused: Session) -> None:
    """Send webhook in background and log the result."""
    result = _send_webhook(webhook_cfg, event_details, payload)

    from app.database import SessionLocal
    db = SessionLocal()
    try:
        _log_alert(
            db, event_details, "webhook",
            result["status"],
            recipient=webhook_cfg.get("url", ""),
            details=result,
        )
    finally:
        db.close()


# ── Alert logging ──────────────────────────────────────────────────────────

def _log_alert(
    db: Session,
    event_details: dict,
    channel: str,
    status: str,
    recipient: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    """Write an alert log entry to the database."""
    try:
        log = AlertLog(
            event_id=event_details.get("event_id", ""),
            channel=channel,
            status=status,
            recipient=recipient,
            details=details,
        )
        db.add(log)
        db.commit()
    except Exception as exc:
        logger.error("Failed to log alert: %s", exc)
        db.rollback()
"""
