"""Video frame processor — extracts frames and runs detection pipeline."""

import logging
import os
import uuid
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image

from app.config import get_settings
from app.detection.detector import AccidentDetector, Detection

logger = logging.getLogger(__name__)


@dataclass
class FrameDetection:
    """Detection result for a single video frame."""
    frame_number: int
    timestamp_sec: float
    detections: list[Detection]
    evidence_path: str | None = None


@dataclass
class VideoProcessingOutput:
    """Complete result of processing a video file."""
    video_path: str
    total_frames: int
    frames_processed: int
    frame_detections: list[FrameDetection] = field(default_factory=list)

    @property
    def all_detections(self) -> list[Detection]:
        """Flatten all detections across frames."""
        return [d for fd in self.frame_detections for d in fd.detections]

    @property
    def accident_count(self) -> int:
        return sum(1 for d in self.all_detections if d.label == "accident")


class VideoProcessor:
    """Processes video files frame-by-frame through the DETR detector.

    Extracts frames at a configurable interval, runs detection,
    saves evidence frames for detections, and deduplicates results.
    """

    def __init__(self, detector: AccidentDetector):
        self.detector = detector
        self.settings = get_settings()

        os.makedirs(self.settings.evidence_dir, exist_ok=True)

    def process_video(
        self,
        video_path: str,
        frame_interval: int | None = None,
        confidence_threshold: float | None = None,
        allowed_labels: set[str] | None = None,
        on_progress: "None | (lambda cur, total: None)" = None,
    ) -> VideoProcessingOutput:
        """Process a video file and return all detections.

        Args:
            video_path: Path to the video file.
            frame_interval: Process every Nth frame. Defaults to config value.
            confidence_threshold: Override detector threshold for this run.
            allowed_labels: If set, only keep detections with these labels.
            on_progress: Optional callback(current_frame, total_frames).

        Returns:
            VideoProcessingOutput with all frame detections.
        """
        interval = frame_interval or self.settings.frame_interval

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        total_to_process = max(1, total_frames // interval)

        logger.info(
            "Processing video: %s (frames=%d, fps=%.1f, interval=%d)",
            video_path, total_frames, fps, interval,
        )

        output = VideoProcessingOutput(
            video_path=video_path,
            total_frames=total_frames,
            frames_processed=0,
        )

        frame_idx = 0
        prev_accident_frame = -999  # Track last accident frame for dedup

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % interval == 0:
                    # Convert BGR (OpenCV) to RGB (PIL)
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    pil_image = Image.fromarray(rgb_frame)

                    detections = self.detector.detect(pil_image, confidence_threshold=confidence_threshold)
                    output.frames_processed += 1

                    # Report progress
                    if on_progress:
                        on_progress(output.frames_processed, total_to_process)

                    # Filter by allowed labels (from detection toggles)
                    if allowed_labels:
                        detections = [d for d in detections if d.label in allowed_labels]

                    if detections:
                        # Dedup: skip if accident was detected within last N frames
                        has_accident = any(d.label == "accident" for d in detections)

                        if has_accident and (frame_idx - prev_accident_frame) < interval * 3:
                            # Too close to the previous accident detection — skip
                            frame_idx += 1
                            continue

                        if has_accident:
                            prev_accident_frame = frame_idx

                        # Save evidence frame
                        evidence_path = self._save_evidence(frame, frame_idx)

                        timestamp_sec = frame_idx / fps

                        frame_det = FrameDetection(
                            frame_number=frame_idx,
                            timestamp_sec=round(timestamp_sec, 2),
                            detections=detections,
                            evidence_path=evidence_path,
                        )
                        output.frame_detections.append(frame_det)

                        logger.info(
                            "Frame %d (%.1fs): %d detections",
                            frame_idx, timestamp_sec, len(detections),
                        )

                frame_idx += 1
        finally:
            cap.release()

        logger.info(
            "Video processing complete: %d frames processed, %d detections",
            output.frames_processed, len(output.all_detections),
        )
        return output

    def process_image(
        self,
        image: Image.Image,
        confidence_threshold: float | None = None,
        allowed_labels: set[str] | None = None,
    ) -> list[Detection]:
        """Process a single image and return detections."""
        detections = self.detector.detect(image, confidence_threshold=confidence_threshold)
        if allowed_labels:
            detections = [d for d in detections if d.label in allowed_labels]
        return detections

    def _save_evidence(self, frame: np.ndarray, frame_number: int) -> str:
        """Save a frame as a JPEG evidence file.

        Returns:
            Relative path to the saved file.
        """
        filename = f"evidence_{uuid.uuid4().hex[:12]}_f{frame_number}.jpg"
        filepath = os.path.join(self.settings.evidence_dir, filename)
        cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return filename
