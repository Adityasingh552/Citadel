"""Pydantic schemas for API request/response models."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# --- Bounding Box ---

class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float
    label: str
    confidence: float


# --- Events ---

class EventOut(BaseModel):
    id: str
    timestamp: datetime
    event_type: str
    confidence: float
    severity: str
    evidence_path: Optional[str] = None
    bbox_data: Optional[list[dict]] = None
    source_video: Optional[str] = None
    frame_number: Optional[int] = None
    metadata: Optional[dict] = Field(None, alias="metadata_")
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class EventList(BaseModel):
    events: list[EventOut]
    total: int
    limit: int
    offset: int


# --- Tickets ---

class TicketOut(BaseModel):
    id: str
    event_id: str
    violation_type: str
    vehicle_description: Optional[str] = None
    location_info: Optional[str] = None
    evidence_path: Optional[str] = None
    issued_at: datetime
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TicketList(BaseModel):
    tickets: list[TicketOut]
    total: int
    limit: int
    offset: int


class TicketUpdate(BaseModel):
    status: str  # issued | pending | resolved


# --- Stats ---

class TimelinePoint(BaseModel):
    hour: str
    count: int


class SeverityBreakdown(BaseModel):
    high: int
    medium: int
    low: int


class StatsOut(BaseModel):
    total_events: int
    total_accidents: int
    total_vehicles: int
    total_tickets: int
    severity_breakdown: SeverityBreakdown
    timeline_24h: list[TimelinePoint]


# --- Detection ---

class DetectionResult(BaseModel):
    label: str
    confidence: float
    bbox: BoundingBox


class VideoProcessingResult(BaseModel):
    video_name: str
    total_frames: int
    frames_processed: int
    events_created: int
    tickets_created: int
    detections: list[DetectionResult]
    job_id: Optional[str] = None


# --- Settings ---

class SettingsOut(BaseModel):
    model_path: str
    confidence_threshold_manual: float
    confidence_threshold_cctv: float
    detect_accidents: bool


class SettingsUpdate(BaseModel):
    confidence_threshold_manual: Optional[float] = None
    confidence_threshold_cctv: Optional[float] = None
    detect_accidents: Optional[bool] = None


# --- Alert Logs ---

class AlertLogOut(BaseModel):
    id: str
    event_id: str
    channel: str
    status: str
    recipient: Optional[str] = None
    details: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertLogList(BaseModel):
    alerts: list[AlertLogOut]
    total: int
    limit: int
    offset: int


class AlertStatsOut(BaseModel):
    total_sent: int
    total_failed: int
    total_suppressed: int
    by_channel: dict  # e.g. {"twilio": {"sent": 5, "failed": 1}, ...}


# --- Notification Channels ---

class TwilioChannelConfig(BaseModel):
    enabled_manual: bool = False
    enabled_cctv: bool = False

class EmailChannelConfig(BaseModel):
    enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    from_address: str = ""
    to_addresses: list[str] = []

class WebhookChannelConfig(BaseModel):
    enabled: bool = False
    url: str = ""
    headers: dict = {}

class TelegramChannelConfig(BaseModel):
    enabled: bool = False

class NotificationChannelsOut(BaseModel):
    twilio: TwilioChannelConfig
    email: EmailChannelConfig
    webhook: WebhookChannelConfig
    telegram: TelegramChannelConfig
    cooldown_seconds: int = 300

class NotificationChannelsUpdate(BaseModel):
    twilio: Optional[TwilioChannelConfig] = None
    email: Optional[EmailChannelConfig] = None
    webhook: Optional[WebhookChannelConfig] = None
    telegram: Optional[TelegramChannelConfig] = None
    cooldown_seconds: Optional[int] = None
