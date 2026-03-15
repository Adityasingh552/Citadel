"""Monitor service — multi-camera background monitoring with change detection.

Each monitored camera gets its own thread that:
1. Waits for the camera's `update_frequency` (minutes, from Caltrans CSV).
2. Does a HEAD request to check if the snapshot actually changed.
3. Only fetches + runs DETR detection when the image is new.
4. Auto-creates Events and Tickets for any detections found.
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from app.config import get_settings
from app.database import SessionLocal
from app.detection.detector import AccidentDetector, Detection
from app.detection.processor import VideoProcessor
from app.models import ActiveMonitor
from app.services.camera_service import CameraService, CameraInfo, StreamCapture
from app.services import event_service, ticket_service
from app.routes.settings import get_runtime_settings

logger = logging.getLogger(__name__)


@dataclass
class MonitorStatus:
    """Current state of one camera's monitoring session."""
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
    poll_interval: int = 120  # seconds (derived from update_frequency minutes)
    recent_detections: list[dict] = field(default_factory=list)
    error: Optional[str] = None
    skipped_unchanged: int = 0  # frames skipped because snapshot didn't change
    stream_mode: bool = False  # True = grab frames from HLS stream; False = poll snapshots
    stream_interval: int = 10  # seconds between HLS frame grabs (only in stream mode)

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
            "skipped_unchanged": self.skipped_unchanged,
            "stream_mode": self.stream_mode,
            "stream_interval": self.stream_interval,
        }


@dataclass
class _CameraMonitor:
    """Internal state for a single monitored camera thread."""
    camera: CameraInfo
    thread: threading.Thread
    stop_event: threading.Event
    status: MonitorStatus
    stream_capture: Optional[StreamCapture] = None


class MonitorService:
    """Manages concurrent background monitoring for multiple camera feeds.

    Each camera gets its own thread. The poll interval is derived from the
    camera's `update_frequency` field (minutes → seconds).
    """

    def __init__(self):
        self._monitors: dict[str, _CameraMonitor] = {}  # camera_id -> monitor
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

    # ── Public API ──

    def start(self, camera: CameraInfo, stream_mode: bool = False, stream_interval: int = 10) -> dict:
        """Start monitoring a camera. If already monitored, returns existing status.

        Args:
            camera: The camera to monitor.
            stream_mode: If True, grab frames from the HLS video stream instead of polling snapshots.
            stream_interval: Seconds between HLS frame grabs (only used when stream_mode=True). Min 3, max 120.
        """
        with self._lock:
            existing = self._monitors.get(camera.id)
            if existing and existing.status.active:
                return existing.status.to_dict()

        # Validate stream mode settings
        if stream_mode:
            stream_interval = max(3, min(120, stream_interval))
            if not camera.stream_url:
                logger.warning(
                    "Stream mode requested for camera %s but no stream_url available, falling back to snapshot mode",
                    camera.location_name,
                )
                stream_mode = False

        # Derive poll interval: camera update_frequency is in minutes
        if stream_mode:
            poll_seconds = stream_interval
        else:
            poll_seconds = max(camera.update_frequency * 60, 30)  # min 30s

        status = MonitorStatus(
            active=True,
            camera_id=camera.id,
            camera_name=camera.location_name,
            camera_location=f"D{camera.district} — {camera.county}, {camera.route}",
            started_at=datetime.now(timezone.utc).isoformat(),
            poll_interval=poll_seconds,
            last_snapshot_url=camera.snapshot_url,
            stream_mode=stream_mode,
            stream_interval=stream_interval,
        )

        # Start persistent stream capture if in stream mode
        capture: Optional[StreamCapture] = None
        if stream_mode and camera.stream_url:
            capture = StreamCapture(camera.stream_url)
            if not capture.start():
                logger.warning(
                    "Failed to start stream capture for %s, falling back to snapshot mode",
                    camera.location_name,
                )
                capture = None
                stream_mode = False
                status.stream_mode = False
                poll_seconds = max(camera.update_frequency * 60, 30)
                status.poll_interval = poll_seconds

        stop_event = threading.Event()
        thread = threading.Thread(
            target=self._monitor_loop,
            args=(camera, poll_seconds, stop_event, status),
            daemon=True,
            name=f"monitor-{camera.id}",
        )

        monitor = _CameraMonitor(
            camera=camera,
            thread=thread,
            stop_event=stop_event,
            status=status,
            stream_capture=capture,
        )

        with self._lock:
            self._monitors[camera.id] = monitor

        thread.start()

        # Persist to DB so we can restore on restart
        self._persist_start(camera.id, stream_mode, stream_interval)

        mode_label = f"stream (every {stream_interval}s)" if stream_mode else f"snapshot (poll={poll_seconds}s)"
        logger.info(
            "Started monitoring camera: %s (%s, freq=%dm)",
            camera.location_name,
            mode_label,
            camera.update_frequency,
        )
        return status.to_dict()

    def stop(self, camera_id: str, persist: bool = True) -> dict:
        """Stop monitoring a specific camera."""
        with self._lock:
            monitor = self._monitors.get(camera_id)
            if not monitor:
                return {"active": False, "camera_id": camera_id}

        monitor.stop_event.set()

        # Stop the persistent stream capture (kills ffmpeg process)
        if monitor.stream_capture:
            monitor.stream_capture.stop()
            monitor.stream_capture = None

        if monitor.thread.is_alive():
            monitor.thread.join(timeout=10)

        with self._lock:
            monitor.status.active = False

        # Remove from DB (skip during shutdown so we can restore on next boot)
        if persist:
            self._persist_stop(camera_id)

        logger.info("Stopped monitoring camera: %s", monitor.camera.location_name)
        return monitor.status.to_dict()

    def stop_all(self, persist: bool = True) -> int:
        """Stop all active monitors. Returns count of monitors stopped.

        When persist=False (shutdown), leaves DB rows intact for restore on next boot.
        """
        with self._lock:
            camera_ids = list(self._monitors.keys())

        count = 0
        for cid in camera_ids:
            self.stop(cid, persist=persist)
            count += 1

        logger.info("Stopped all monitors (%d)", count)
        return count

    def get_status(self, camera_id: str) -> Optional[dict]:
        """Get status for a specific camera monitor."""
        with self._lock:
            monitor = self._monitors.get(camera_id)
            if not monitor:
                return None
            return monitor.status.to_dict()

    def get_all_statuses(self) -> list[dict]:
        """Get status for all active (and recently stopped) monitors."""
        with self._lock:
            return [m.status.to_dict() for m in self._monitors.values()]

    def get_active_camera_ids(self) -> list[str]:
        """Return IDs of all currently active monitors."""
        with self._lock:
            return [
                cid for cid, m in self._monitors.items()
                if m.status.active
            ]

    def is_monitoring(self, camera_id: str) -> bool:
        """Check if a specific camera is being monitored."""
        with self._lock:
            monitor = self._monitors.get(camera_id)
            return monitor is not None and monitor.status.active

    # ── DB Persistence ──

    def _persist_start(self, camera_id: str, stream_mode: bool = False, stream_interval: int = 10) -> None:
        """Insert a row into active_monitors (idempotent)."""
        db = SessionLocal()
        try:
            existing = db.query(ActiveMonitor).filter_by(camera_id=camera_id).first()
            if not existing:
                db.add(ActiveMonitor(
                    camera_id=camera_id,
                    stream_mode=stream_mode,
                    stream_interval=stream_interval,
                ))
                db.commit()
        except Exception as e:
            logger.warning("Failed to persist monitor start for %s: %s", camera_id, e)
            db.rollback()
        finally:
            db.close()

    def _persist_stop(self, camera_id: str) -> None:
        """Delete the row from active_monitors."""
        db = SessionLocal()
        try:
            db.query(ActiveMonitor).filter_by(camera_id=camera_id).delete()
            db.commit()
        except Exception as e:
            logger.warning("Failed to persist monitor stop for %s: %s", camera_id, e)
            db.rollback()
        finally:
            db.close()

    def _clear_all_persisted(self) -> None:
        """Delete all rows from active_monitors."""
        db = SessionLocal()
        try:
            db.query(ActiveMonitor).delete()
            db.commit()
        except Exception as e:
            logger.warning("Failed to clear persisted monitors: %s", e)
            db.rollback()
        finally:
            db.close()

    def restore_from_db(self) -> int:
        """Re-start monitors for cameras persisted in active_monitors.

        Called once during app lifespan startup, after camera data is loaded.
        Returns the number of monitors restored.
        """
        if not self._camera_service:
            logger.error("Cannot restore monitors — camera_service not set")
            return 0

        db = SessionLocal()
        try:
            rows = db.query(ActiveMonitor).all()
            camera_ids = [
                (r.camera_id, bool(r.stream_mode), int(r.stream_interval or 10))
                for r in rows
            ]
        except Exception as e:
            logger.error("Failed to read active_monitors table: %s", e)
            return 0
        finally:
            db.close()

        if not camera_ids:
            return 0

        logger.info("Restoring %d monitors from previous session...", len(camera_ids))
        restored = 0
        for cid, s_mode, s_interval in camera_ids:
            camera = self._camera_service.get_camera_by_id(cid)
            if camera:
                self.start(camera, stream_mode=s_mode, stream_interval=s_interval)
                restored += 1
                logger.info("Restored monitor: %s (stream_mode=%s)", camera.location_name, s_mode)
            else:
                logger.warning("Cannot restore monitor for unknown camera %s — removing", cid)
                self._persist_stop(cid)

        logger.info("Monitor restore complete: %d/%d restored", restored, len(camera_ids))
        return restored

    # ── Background Loop ──

    def _monitor_loop(
        self,
        camera: CameraInfo,
        poll_seconds: int,
        stop_event: threading.Event,
        status: MonitorStatus,
    ):
        """Background loop: HEAD check → fetch if changed → detect → create events.

        Supports two modes:
        - Snapshot mode (default): Polls the snapshot URL, checks for changes, then analyzes.
        - Stream mode: Reads the latest frame from the persistent StreamCapture.
        """
        settings = get_settings()

        while not stop_event.is_set():
            try:
                if status.stream_mode:
                    # Get the StreamCapture from the monitor object
                    with self._lock:
                        monitor = self._monitors.get(camera.id)
                    capture = monitor.stream_capture if monitor else None
                    self._process_stream_frame(camera, settings, status, stop_event, capture)
                else:
                    self._process_single_frame(camera, settings, status, stop_event)
            except Exception as e:
                logger.error("Monitor loop error for %s: %s", camera.location_name, e)
                status.error = str(e)

            # Wait for the poll interval (or until stopped)
            stop_event.wait(timeout=poll_seconds)

        logger.info("Monitor loop exited for camera: %s", camera.location_name)

    def _process_single_frame(
        self,
        camera: CameraInfo,
        settings,
        status: MonitorStatus,
        stop_event: threading.Event,
    ):
        """HEAD-check, fetch one snapshot if changed, run detection, save results."""
        if not self._camera_service or not self._processor:
            logger.error("Monitor dependencies not initialized")
            return

        # HEAD check: has the snapshot actually changed?
        if not self._camera_service.has_snapshot_changed(camera.snapshot_url):
            status.skipped_unchanged += 1
            logger.debug("Snapshot unchanged for %s, skipping", camera.location_name)
            return

        # Fetch snapshot
        pil_image = self._camera_service.fetch_snapshot_as_pil(camera.snapshot_url)
        if pil_image is None:
            logger.warning("Failed to fetch snapshot for %s", camera.location_name)
            status.error = "Failed to fetch camera snapshot"
            return

        # Clear any previous error on success
        status.error = None

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

        status.frames_analyzed += 1
        status.last_frame_time = now.isoformat()

        if not detections:
            return

        # We have detections — create events and tickets in DB
        db = SessionLocal()
        try:
            for det in detections:
                source_name = f"live:{camera.location_name}"

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

                if det.label == "accident":
                    ticket_service.create_ticket_from_event(
                        db,
                        event,
                        location_info=f"{camera.location_name} | {camera.county}, {camera.route}",
                    )
                    status.accidents_found += 1

                status.detections_found += 1
                status.recent_detections.append({
                    "label": det.label,
                    "confidence": det.confidence,
                    "severity": det.severity,
                    "evidence_path": evidence_path,
                    "timestamp": now.isoformat(),
                    "camera_name": camera.location_name,
                    "event_id": event.id,
                })
                # Trim to prevent unbounded memory growth
                if len(status.recent_detections) > 50:
                    status.recent_detections = status.recent_detections[-50:]

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

    def _process_stream_frame(
        self,
        camera: CameraInfo,
        settings,
        status: MonitorStatus,
        stop_event: threading.Event,
        capture: Optional[StreamCapture] = None,
    ):
        """Read the latest frame from the persistent StreamCapture and run detection."""
        if not self._camera_service or not self._processor:
            logger.error("Monitor dependencies not initialized")
            return

        if not camera.stream_url:
            status.error = "No stream URL available for this camera"
            return

        if not capture or not capture.is_alive:
            # Attempt auto-restart if capture died
            if capture and not capture.is_alive:
                logger.warning("Stream capture died for %s, attempting restart...", camera.location_name)
                capture.stop()
                if capture.start():
                    logger.info("Stream capture restarted successfully for %s", camera.location_name)
                    status.error = None
                    # Give ffmpeg a moment to buffer the first frame
                    time.sleep(3)
                else:
                    status.error = f"Stream capture restart failed: {capture.error}"
                    logger.error("Stream capture restart failed for %s", camera.location_name)
                    return
            else:
                status.error = "No stream capture available"
                logger.warning("No stream capture for %s", camera.location_name)
                return

        # Read the latest frame (instant — no network I/O)
        pil_image = capture.get_latest_frame()
        if pil_image is None:
            # No frame yet (stream may still be buffering)
            logger.debug("No frame available yet from stream capture for %s", camera.location_name)
            return

        # Clear any previous error on success
        status.error = None

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

        status.frames_analyzed += 1
        status.last_frame_time = now.isoformat()

        if not detections:
            return

        # We have detections — create events and tickets in DB
        db = SessionLocal()
        try:
            for det in detections:
                source_name = f"stream:{camera.location_name}"

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
                        "source": "stream_monitor",
                        "stream_interval": status.stream_interval,
                    },
                )

                if det.label == "accident":
                    ticket_service.create_ticket_from_event(
                        db,
                        event,
                        location_info=f"{camera.location_name} | {camera.county}, {camera.route}",
                    )
                    status.accidents_found += 1

                status.detections_found += 1
                status.recent_detections.append({
                    "label": det.label,
                    "confidence": det.confidence,
                    "severity": det.severity,
                    "evidence_path": evidence_path,
                    "timestamp": now.isoformat(),
                    "camera_name": camera.location_name,
                    "event_id": event.id,
                })
                # Trim to prevent unbounded memory growth
                if len(status.recent_detections) > 50:
                    status.recent_detections = status.recent_detections[-50:]

                logger.info(
                    "Stream monitor detection: %s (%.0f%%) at %s",
                    det.label,
                    det.confidence * 100,
                    camera.location_name,
                )
        except Exception as e:
            logger.error("Failed to save stream monitor detection: %s", e)
            db.rollback()
        finally:
            db.close()


# Module-level singleton
monitor_service = MonitorService()
