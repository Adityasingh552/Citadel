"""Monitor service — background auto-monitoring loop for live camera feeds.

Periodically fetches snapshots from a Caltrans camera, runs DETR detection,
and auto-creates events + tickets for any detections found.
"""

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
from PIL import Image

from app.config import get_settings
from app.database import SessionLocal
from app.detection.detector import AccidentDetector, Detection
from app.detection.processor import VideoProcessor
from app.services.camera_service import CameraService, CameraInfo
from app.services import event_service, ticket_service
from app.routes.settings import get_runtime_settings

logger = logging.getLogger(__name__)


@dataclass
class MonitorDetection:
    """A single detection from the monitoring loop."""
    label: str
    confidence: float
    severity: str
    bbox: dict
    evidence_path: Optional[str] = None
    timestamp: str = ""
    camera_name: str = ""


@dataclass
class MonitorStatus:
    """Current state of the monitoring session."""
    active: bool = False
    camera_id: Optional[str] = None
    camera_name: str = ""
    camera_location: str = ""
    started_at: Optional[str] = None
    frames_analyzed: int = 0
    detections_found: int = 0
    accidents_found: int = 0
    last_frame_time: Optional[str] = None
    last_snapshot_url: Optional[str] = None
    poll_interval: int = 30
    recent_detections: list[dict] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "active": self.active,
            "camera_id": self.camera_id,
            "camera_name": self.camera_name,
            "camera_location": self.camera_location,
            "started_at": self.started_at,
            "frames_analyzed": self.frames_analyzed,
            "detections_found": self.detections_found,
            "accidents_found": self.accidents_found,
            "last_frame_time": self.last_frame_time,
            "last_snapshot_url": self.last_snapshot_url,
            "poll_interval": self.poll_interval,
            "recent_detections": self.recent_detections[-20:],  # Keep last 20
            "error": self.error,
        }


class MonitorService:
    """Manages a background monitoring loop for a single camera feed.

    Only one camera can be monitored at a time. Starting monitoring on
    a new camera will stop the previous one.
    """

    def __init__(self):
        self._status = MonitorStatus()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._camera_service: Optional[CameraService] = None
        self._processor: Optional[VideoProcessor] = None

    def set_dependencies(
        self,
        camera_service: CameraService,
        processor: VideoProcessor,
    ):
        """Inject dependencies (called during app lifespan startup)."""
        self._camera_service = camera_service
        self._processor = processor

    @property
    def status(self) -> MonitorStatus:
        with self._lock:
            return self._status

    def start(self, camera: CameraInfo, poll_interval: int = 30) -> dict:
        """Start monitoring a camera. Stops any existing monitoring first."""
        # Stop existing monitoring if running
        if self._status.active:
            self.stop()

        with self._lock:
            self._status = MonitorStatus(
                active=True,
                camera_id=camera.id,
                camera_name=camera.location_name,
                camera_location=f"D{camera.district} — {camera.county}, {camera.route}",
                started_at=datetime.now(timezone.utc).isoformat(),
                poll_interval=poll_interval,
                last_snapshot_url=camera.snapshot_url,
            )

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._monitor_loop,
            args=(camera, poll_interval),
            daemon=True,
            name=f"monitor-{camera.id}",
        )
        self._thread.start()

        logger.info(
            "Started monitoring camera: %s (interval=%ds)",
            camera.location_name,
            poll_interval,
        )
        return self._status.to_dict()

    def stop(self) -> dict:
        """Stop the current monitoring session."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)

        with self._lock:
            self._status.active = False

        logger.info("Monitoring stopped")
        return self._status.to_dict()

    def _monitor_loop(self, camera: CameraInfo, poll_interval: int):
        """Background loop: fetch snapshot → detect → create events."""
        settings = get_settings()

        while not self._stop_event.is_set():
            try:
                self._process_single_frame(camera, settings)
            except Exception as e:
                logger.error("Monitor loop error: %s", e)
                with self._lock:
                    self._status.error = str(e)

            # Wait for the next poll interval (or until stopped)
            self._stop_event.wait(timeout=poll_interval)

        logger.info("Monitor loop exited for camera: %s", camera.location_name)

    def _process_single_frame(self, camera: CameraInfo, settings):
        """Fetch one snapshot, run detection, and save results."""
        if not self._camera_service or not self._processor:
            logger.error("Monitor dependencies not initialized")
            return

        # Fetch snapshot
        pil_image = self._camera_service.fetch_snapshot_as_pil(camera.snapshot_url)
        if pil_image is None:
            logger.warning("Failed to fetch snapshot for %s", camera.location_name)
            with self._lock:
                self._status.error = "Failed to fetch camera snapshot"
            return

        # Clear any previous error on success
        with self._lock:
            self._status.error = None

        # Read runtime settings for detection config
        rt = get_runtime_settings()
        allowed_labels: set[str] = set()
        if rt["detect_accidents"]:
            allowed_labels.add("accident")
        if rt["detect_vehicles"]:
            allowed_labels.add("vehicle")

        # Run detection
        detections, evidence_path = self._processor.process_image(
            pil_image,
            confidence_threshold=rt["confidence_threshold"],
            allowed_labels=allowed_labels if allowed_labels else None,
        )

        now = datetime.now(timezone.utc)

        with self._lock:
            self._status.frames_analyzed += 1
            self._status.last_frame_time = now.isoformat()

        if not detections:
            return

        # We have detections — create events and tickets in DB
        db = SessionLocal()
        try:
            for det in detections:
                # Build camera-specific source info
                source_name = f"live:{camera.location_name}"

                # Create event with camera metadata
                event = event_service.create_event(
                    db=db,
                    event_type=det.label,
                    confidence=det.confidence,
                    severity=det.severity,
                    evidence_path=evidence_path,
                    bbox_data=[det.bbox],
                    source_video=source_name,
                    metadata={
                        "camera_id": camera.id,
                        "camera_name": camera.location_name,
                        "camera_district": camera.district,
                        "camera_county": camera.county,
                        "camera_route": camera.route,
                        "camera_lat": camera.latitude,
                        "camera_lng": camera.longitude,
                        "source": "live_monitor",
                    },
                )

                # Auto-create ticket for accidents
                if det.label == "accident":
                    ticket_service.create_ticket_from_event(
                        db,
                        event,
                        location_info=f"{camera.location_name} | {camera.county}, {camera.route}",
                    )
                    with self._lock:
                        self._status.accidents_found += 1

                with self._lock:
                    self._status.detections_found += 1
                    self._status.recent_detections.append({
                        "label": det.label,
                        "confidence": det.confidence,
                        "severity": det.severity,
                        "evidence_path": evidence_path,
                        "timestamp": now.isoformat(),
                        "camera_name": camera.location_name,
                        "event_id": event.id,
                    })

                logger.info(
                    "Monitor detection: %s (%.0f%%) at %s",
                    det.label,
                    det.confidence * 100,
                    camera.location_name,
                )
        except Exception as e:
            logger.error("Failed to save monitor detection: %s", e)
            db.rollback()
        finally:
            db.close()


# Module-level singleton
monitor_service = MonitorService()
