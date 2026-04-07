"""Detection routes — video/image upload and processing."""

import asyncio
import logging
import os
import shutil
import uuid
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from PIL import Image

from app.database import get_db
from app.config import get_settings
from app.schemas import VideoProcessingResult, DetectionResult, BoundingBox
from app.models import Event
from app.services import event_service, ticket_service
from app.routes.settings import get_runtime_settings
from app.storage import enqueue_event_evidence_upload, is_remote_evidence_path


_DEDUP_WINDOW_SECONDS = 60

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/detect", tags=["detection"])

# Will be set by main.py lifespan
_processor = None


def set_processor(processor):
    global _processor
    _processor = processor


def get_processor():
    if _processor is None:
        raise HTTPException(status_code=503, detail="Detection model not loaded")
    return _processor


# ── Progress tracking ──────────────────────────────────────────────
_progress: dict[str, dict] = {}  # job_id -> {current, total, percent, status}
_progress_lock = threading.Lock()


def _is_near_frame(frame_number: int, prior_frames: list[int], window: int) -> bool:
    for frame in prior_frames:
        if abs(frame_number - frame) <= window:
            return True
    return False


def _existing_recent_accident(db: Session, source_video: str) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_DEDUP_WINDOW_SECONDS)
    return (
        db.query(Event.id)
        .filter(
            Event.event_type == "accident",
            Event.source_video == source_video,
            Event.timestamp >= cutoff,
        )
        .first()
        is not None
    )


def _update_progress(job_id: str, current: int, total: int):
    with _progress_lock:
        _progress[job_id] = {
            "current": current,
            "total": total,
            "percent": round(current / total * 100) if total else 0,
            "status": "processing",
        }


@router.get("/progress/{job_id}")
async def get_progress(job_id: str):
    """Poll the progress of a video processing job."""
    with _progress_lock:
        info = _progress.get(job_id)
    if not info:
        return {"status": "unknown", "percent": 0, "current": 0, "total": 0}
    return info


@router.post("/video", response_model=VideoProcessingResult)
async def detect_video(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    job_id: str | None = None,
    _admin: str = Depends(get_current_admin),
):
    """Upload a video file and run accident detection on it.

    Processes frames, creates events and tickets for detections.
    """
    settings = get_settings()
    processor = get_processor()

    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    allowed_exts = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Allowed: {allowed_exts}",
        )

    # Save uploaded file
    os.makedirs(settings.uploads_dir, exist_ok=True)
    upload_name = f"{uuid.uuid4().hex[:12]}_{file.filename}"
    upload_path = os.path.join(settings.uploads_dir, upload_name)

    with open(upload_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    logger.info("Saved upload: %s", upload_path)

    # Read runtime settings (from Settings page)
    rt = get_runtime_settings()
    allowed_labels: set[str] = set()
    if rt["detect_accidents"]:
        allowed_labels.add("accident")

    # Process video in a thread pool (prevents blocking the event loop)
    job_id = job_id or uuid.uuid4().hex[:16]
    try:
        result = await asyncio.to_thread(
            processor.process_video,
            upload_path,
            confidence_threshold=rt["confidence_threshold_manual"],
            allowed_labels=allowed_labels if allowed_labels else None,
            on_progress=lambda cur, tot: _update_progress(job_id, cur, tot),
        )
    except Exception as e:
        logger.error("Video processing failed: %s", e)
        with _progress_lock:
            _progress.pop(job_id, None)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

    # Create events and tickets in DB
    events_created = 0
    tickets_created = 0
    all_detections: list[DetectionResult] = []
    frame_interval = 30
    near_dup_window = frame_interval * 3

    accident_frames = [
        frame_det.frame_number
        for frame_det in result.frame_detections
        if any(det.label == "accident" for det in frame_det.detections)
    ]
    existing_accident_frames: list[int] = []
    if accident_frames:
        lo = min(accident_frames) - near_dup_window
        hi = max(accident_frames) + near_dup_window
        existing_accident_frames = [
            int(frame)
            for (frame,) in (
                db.query(Event.frame_number)
                .filter(
                    Event.event_type == "accident",
                    Event.source_video == file.filename,
                    Event.frame_number >= lo,
                    Event.frame_number <= hi,
                )
                .all()
            )
            if frame is not None
        ]

    created_accident_frames: list[int] = []
    created_events = []
    evidence_backfill: list[tuple[str, str]] = []

    try:
        for frame_det in result.frame_detections:
            for det in frame_det.detections:
                # Cross-run + in-request dedup for accidents.
                if det.label == "accident":
                    prior_frames = existing_accident_frames + created_accident_frames
                    if _is_near_frame(frame_det.frame_number, prior_frames, near_dup_window):
                        logger.debug(
                            "Skipping duplicate accident at frame %d for source %s",
                            frame_det.frame_number,
                            file.filename,
                        )
                        continue

                event = event_service.create_event(
                    db=db,
                    event_type=det.label,
                    confidence=det.confidence,
                    severity=det.severity,
                    evidence_path=frame_det.evidence_path,
                    bbox_data=[det.bbox],
                    source_video=file.filename,
                    frame_number=frame_det.frame_number,
                    metadata={"timestamp_sec": frame_det.timestamp_sec},
                    source="manual",
                    commit=False,
                    dispatch_notifications=False,
                )
                created_events.append(event)
                events_created += 1

                if event.evidence_path and not is_remote_evidence_path(event.evidence_path):
                    evidence_backfill.append((event.id, event.evidence_path))

                if det.label == "accident":
                    created_accident_frames.append(frame_det.frame_number)
                    ticket_service.create_ticket_from_event(db, event, commit=False)
                    tickets_created += 1

                all_detections.append(DetectionResult(
                    label=det.label,
                    confidence=det.confidence,
                    bbox=BoundingBox(
                        x=det.bbox["x"],
                        y=det.bbox["y"],
                        width=det.bbox["width"],
                        height=det.bbox["height"],
                        label=det.label,
                        confidence=det.confidence,
                    ),
                ))

        if created_events:
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to persist video detections: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save detection results")

    for event in created_events:
        try:
            event_service.dispatch_event_notifications(db, event, source="manual")
        except Exception as e:
            logger.warning("Notification dispatch failed for event %s: %s", event.id, e)

    for event_id, local_path in evidence_backfill:
        enqueue_event_evidence_upload(event_id, local_path)

    # Mark progress done and clean up
    with _progress_lock:
        if job_id in _progress:
            _progress[job_id]["status"] = "done"
            _progress[job_id]["percent"] = 100

    return VideoProcessingResult(
        video_name=file.filename,
        total_frames=result.total_frames,
        frames_processed=result.frames_processed,
        events_created=events_created,
        tickets_created=tickets_created,
        detections=all_detections,
        job_id=job_id,
    )


@router.post("/image")
async def detect_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Upload a single image and run accident detection."""
    processor = get_processor()

    # Validate
    allowed_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Allowed: {allowed_exts}",
        )

    # Read image
    try:
        image = Image.open(file.file).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")

    # Read runtime settings
    rt = get_runtime_settings()
    allowed_labels: set[str] = set()
    if rt["detect_accidents"]:
        allowed_labels.add("accident")

    # Detect (returns tuple of detections + annotated evidence path)
    detections, evidence_path = processor.process_image(
        image,
        confidence_threshold=rt["confidence_threshold_manual"],
        allowed_labels=allowed_labels if allowed_labels else None,
    )

    results = []
    created_events = []
    evidence_backfill: list[tuple[str, str]] = []

    existing_recent_accident = False
    if any(det.label == "accident" for det in detections):
        existing_recent_accident = _existing_recent_accident(db, file.filename)

    try:
        for det in detections:
            if det.label == "accident" and existing_recent_accident:
                logger.debug("Skipping duplicate accident for image %s", file.filename)
                continue

            event = event_service.create_event(
                db=db,
                event_type=det.label,
                confidence=det.confidence,
                severity=det.severity,
                evidence_path=evidence_path,
                bbox_data=[det.bbox],
                source_video=file.filename,
                source="manual",
                commit=False,
                dispatch_notifications=False,
            )
            created_events.append(event)

            if event.evidence_path and not is_remote_evidence_path(event.evidence_path):
                evidence_backfill.append((event.id, event.evidence_path))

            if det.label == "accident":
                existing_recent_accident = True
                ticket_service.create_ticket_from_event(db, event, commit=False)

            results.append({
                "label": det.label,
                "confidence": det.confidence,
                "bbox": det.bbox,
                "severity": det.severity,
            })

        if created_events:
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to persist image detection: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save detection results")

    for event in created_events:
        try:
            event_service.dispatch_event_notifications(db, event, source="manual")
        except Exception as e:
            logger.warning("Notification dispatch failed for event %s: %s", event.id, e)

    for event_id, local_path in evidence_backfill:
        enqueue_event_evidence_upload(event_id, local_path)

    return {"detections": results, "count": len(results)}


@router.post("/images")
async def detect_images_batch(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Upload multiple images and run accident detection on each.

    Returns per-image results and aggregate totals.
    """
    processor = get_processor()
    allowed_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

    # Read runtime settings
    rt = get_runtime_settings()
    allowed_labels: set[str] = set()
    if rt["detect_accidents"]:
        allowed_labels.add("accident")

    image_results = []
    total_events = 0
    total_tickets = 0
    created_events = []
    evidence_backfill: list[tuple[str, str]] = []

    for file in files:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in allowed_exts:
            image_results.append({
                "filename": file.filename,
                "status": "skipped",
                "reason": f"Unsupported format: {ext}",
                "detections": [],
            })
            continue

        try:
            image = Image.open(file.file).convert("RGB")
        except Exception:
            image_results.append({
                "filename": file.filename,
                "status": "error",
                "reason": "Invalid image file",
                "detections": [],
            })
            continue

        # Run detection in thread pool (returns tuple: detections, evidence_path)
        detections, evidence_path = await asyncio.to_thread(
            processor.process_image,
            image,
            confidence_threshold=rt["confidence_threshold_manual"],
            allowed_labels=allowed_labels if allowed_labels else None,
        )

        file_detections = []
        existing_recent_accident = False
        if any(det.label == "accident" for det in detections):
            existing_recent_accident = _existing_recent_accident(db, file.filename)

        for det in detections:
            if det.label == "accident":
                if existing_recent_accident:
                    logger.debug("Skipping duplicate accident for image %s", file.filename)
                    continue

            event = event_service.create_event(
                db=db,
                event_type=det.label,
                confidence=det.confidence,
                severity=det.severity,
                evidence_path=evidence_path,
                bbox_data=[det.bbox],
                source_video=file.filename,
                source="manual",
                commit=False,
                dispatch_notifications=False,
            )
            created_events.append(event)

            if event.evidence_path and not is_remote_evidence_path(event.evidence_path):
                evidence_backfill.append((event.id, event.evidence_path))

            total_events += 1

            if det.label == "accident":
                existing_recent_accident = True
                ticket_service.create_ticket_from_event(db, event, commit=False)
                total_tickets += 1

            file_detections.append({
                "label": det.label,
                "confidence": det.confidence,
                "bbox": det.bbox,
                "severity": det.severity,
            })

        image_results.append({
            "filename": file.filename,
            "status": "processed",
            "detections": file_detections,
        })

    try:
        if created_events:
            db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to persist batch image detections: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save batch detection results")

    for event in created_events:
        try:
            event_service.dispatch_event_notifications(db, event, source="manual")
        except Exception as e:
            logger.warning("Notification dispatch failed for event %s: %s", event.id, e)

    for event_id, local_path in evidence_backfill:
        enqueue_event_evidence_upload(event_id, local_path)

    return {
        "images_processed": len([r for r in image_results if r["status"] == "processed"]),
        "images_skipped": len([r for r in image_results if r["status"] != "processed"]),
        "total_events": total_events,
        "total_tickets": total_tickets,
        "results": image_results,
    }
