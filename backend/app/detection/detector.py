"""DETR-based traffic accident detector.

Uses the gopesh353/traffic-accident-detection-detr model from HuggingFace.
Detects two classes: 'accident' and 'vehicle' in traffic scene images.
"""

import logging
from dataclasses import dataclass

import torch
from PIL import Image
from transformers import DetrImageProcessor, DetrForObjectDetection

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class Detection:
    """A single detection result."""
    label: str          # 'accident' or 'vehicle'
    confidence: float   # 0.0 - 1.0
    bbox: dict          # {x, y, width, height} in pixels
    severity: str       # 'high' | 'medium' | 'low'


class AccidentDetector:
    """Wraps the DETR model for traffic accident/vehicle detection.

    The model is loaded once and reused for all inference calls.
    Auto-downloads from HuggingFace on first use (~170MB).
    """

    def __init__(self, model_name: str | None = None, confidence_threshold: float | None = None):
        settings = get_settings()
        self.model_name = model_name or settings.model_name
        self.confidence_threshold = confidence_threshold or settings.confidence_threshold
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self._processor: DetrImageProcessor | None = None
        self._model: DetrForObjectDetection | None = None
        self._loaded = False

    def load(self) -> None:
        """Load the DETR model and processor. Call once before detect()."""
        if self._loaded:
            return

        logger.info("Loading DETR model: %s (device: %s)", self.model_name, self.device)

        self._processor = DetrImageProcessor.from_pretrained(self.model_name)
        self._model = DetrForObjectDetection.from_pretrained(self.model_name)
        self._model.to(self.device)
        self._model.eval()
        self._loaded = True

        logger.info("DETR model loaded successfully")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def detect(self, image: Image.Image, confidence_threshold: float | None = None) -> list[Detection]:
        """Run detection on a PIL Image.

        Args:
            image: RGB PIL Image to analyze.
            confidence_threshold: Override threshold for this call. If None, uses init value.

        Returns:
            List of Detection objects above the confidence threshold.
        """
        if not self._loaded:
            self.load()

        threshold = confidence_threshold if confidence_threshold is not None else self.confidence_threshold

        # Preprocess
        inputs = self._processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        # Inference
        with torch.no_grad():
            outputs = self._model(**inputs)

        # Post-process: convert to COCO format
        target_sizes = torch.tensor([image.size[::-1]], device=self.device)
        results = self._processor.post_process_object_detection(
            outputs,
            target_sizes=target_sizes,
            threshold=threshold,
        )[0]

        detections: list[Detection] = []
        id2label = self._model.config.id2label

        for score, label_id, box in zip(
            results["scores"].cpu().tolist(),
            results["labels"].cpu().tolist(),
            results["boxes"].cpu().tolist(),
        ):
            label = id2label.get(label_id, f"unknown_{label_id}")
            x_min, y_min, x_max, y_max = box

            detection = Detection(
                label=label,
                confidence=round(score, 4),
                bbox={
                    "x": round(x_min, 1),
                    "y": round(y_min, 1),
                    "width": round(x_max - x_min, 1),
                    "height": round(y_max - y_min, 1),
                },
                severity=self._classify_severity(label, score),
            )
            detections.append(detection)

        logger.info("Detected %d objects (threshold=%.2f)", len(detections), threshold)
        return detections

    @staticmethod
    def _classify_severity(label: str, confidence: float) -> str:
        """Classify detection severity based on label and confidence."""
        if label == "accident":
            if confidence >= 0.85:
                return "high"
            elif confidence >= 0.7:
                return "medium"
            else:
                return "low"
        # Vehicles are always low severity (informational)
        return "low"
