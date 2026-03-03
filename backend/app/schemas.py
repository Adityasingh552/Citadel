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
    model_name: str
    confidence_threshold: float
    detect_accidents: bool
    detect_vehicles: bool
    frame_interval: int


class SettingsUpdate(BaseModel):
    confidence_threshold: Optional[float] = None
    detect_accidents: Optional[bool] = None
    detect_vehicles: Optional[bool] = None
    frame_interval: Optional[int] = None
