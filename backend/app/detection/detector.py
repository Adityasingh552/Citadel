"""YOLO26 ONNX accident detector.

Uses a local ONNX model for accident detection.
Detects two classes: 'Accident' (class 0) and 'Non Accident' (class 1).
Only 'Accident' detections are reported.
"""

import logging
from dataclasses import dataclass

import numpy as np
import onnxruntime as ort
from PIL import Image

from app.config import get_settings

logger = logging.getLogger(__name__)

INPUT_SIZE = 640  # YOLO26 input dimensions


@dataclass
class Detection:
    """A single detection result."""
    label: str          # 'accident' only
    confidence: float   # 0.0 - 1.0
    bbox: dict          # {x, y, width, height} in pixels
    severity: str       # 'high' | 'medium' | 'low'


class AccidentDetector:
    """Wraps the YOLO26 ONNX model for accident detection.

    The model is loaded once and reused for all inference calls.
    Runs on CPU via ONNX Runtime.
    """

    def __init__(self, model_path: str | None = None, confidence_threshold: float | None = None):
        settings = get_settings()
        self.model_path = model_path or settings.model_path
        self.confidence_threshold = confidence_threshold or settings.confidence_threshold_manual

        if not self.model_path:
            raise ValueError("MODEL_PATH must be set in environment variables")

        self._session: ort.InferenceSession | None = None
        self._loaded = False

    def load(self) -> None:
        """Load the ONNX model. Call once before detect()."""
        if self._loaded:
            return

        logger.info("Loading YOLO26 model: %s (runtime: CPU)", self.model_path)

        self._session = ort.InferenceSession(
            self.model_path,
            providers=["CPUExecutionProvider"]
        )
        self._loaded = True

        logger.info("YOLO26 model loaded successfully")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def detect(self, image: Image.Image, confidence_threshold: float | None = None) -> list[Detection]:
        """Run detection on a PIL Image.

        Args:
            image: RGB PIL Image to analyze.
            confidence_threshold: Override threshold for this call.

        Returns:
            List of Detection objects (only 'accident' class, above threshold).
        """
        if not self._loaded:
            self.load()

        threshold = confidence_threshold if confidence_threshold is not None else self.confidence_threshold
        orig_w, orig_h = image.size

        # Ensure RGB mode
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Preprocess
        input_tensor = self._preprocess(image)

        # Inference
        outputs = self._session.run(None, {self._session.get_inputs()[0].name: input_tensor})

        # Postprocess
        detections = self._postprocess(outputs, orig_w, orig_h, threshold)

        logger.info("Detected %d accidents (threshold=%.2f)", len(detections), threshold)
        return detections

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        """Preprocess image for YOLO26 inference.
        
        Resizes to INPUT_SIZE x INPUT_SIZE, normalizes to 0-1, and
        converts to NCHW format with batch dimension.
        """
        # Resize to model input size
        resized = image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)

        # Convert to numpy, normalize to 0-1
        img_array = np.array(resized, dtype=np.float32) / 255.0

        # HWC -> CHW
        img_array = np.transpose(img_array, (2, 0, 1))

        # Add batch dimension: (1, C, H, W)
        return np.expand_dims(img_array, axis=0)

    def _postprocess(
        self,
        outputs: list[np.ndarray],
        orig_w: int,
        orig_h: int,
        threshold: float
    ) -> list[Detection]:
        """Parse YOLO26 outputs and create Detection objects.
        
        YOLO26 is NMS-free, so we directly parse the output tensor.
        Output format varies but is typically (1, num_detections, 6) or (1, 6, num_detections).
        Each detection: [x_center, y_center, width, height, confidence, class_id]
        or with class scores: [x_center, y_center, width, height, class0_score, class1_score, ...]
        """
        output = outputs[0]

        # Handle batch dimension
        if output.ndim == 3 and output.shape[0] == 1:
            output = output[0]

        # If shape is (6, N) or similar where first dim < last dim, transpose to (N, 6+)
        if output.ndim == 2 and output.shape[0] < output.shape[1]:
            output = output.T

        detections: list[Detection] = []
        scale_x = orig_w / INPUT_SIZE
        scale_y = orig_h / INPUT_SIZE

        for row in output:
            # Parse YOLO output format
            # Format 1: [x, y, w, h, conf, class_id] - 6 values
            # Format 2: [x, y, w, h, class0_score, class1_score, ...] - 4 + num_classes values
            x_center, y_center, w, h = row[:4]
            
            if len(row) == 6:
                # Format: [x, y, w, h, confidence, class_id]
                conf = float(row[4])
                class_id = int(row[5])
            else:
                # Format: [x, y, w, h, class_scores...]
                # Class scores start at index 4
                class_scores = row[4:]
                class_id = int(np.argmax(class_scores))
                conf = float(class_scores[class_id])

            # Only keep 'Accident' class (class_id=0) above threshold
            if class_id != 0 or conf < threshold:
                continue

            # Convert center format to corner format and scale to original image size
            x_min = (x_center - w / 2) * scale_x
            y_min = (y_center - h / 2) * scale_y
            box_w = w * scale_x
            box_h = h * scale_y

            # Clamp to image bounds
            x_min = max(0, x_min)
            y_min = max(0, y_min)
            box_w = min(box_w, orig_w - x_min)
            box_h = min(box_h, orig_h - y_min)

            detection = Detection(
                label="accident",
                confidence=round(float(conf), 4),
                bbox={
                    "x": round(float(x_min), 1),
                    "y": round(float(y_min), 1),
                    "width": round(float(box_w), 1),
                    "height": round(float(box_h), 1),
                },
                severity=self._classify_severity(conf),
            )
            detections.append(detection)

        return detections

    @staticmethod
    def _classify_severity(confidence: float) -> str:
        """Classify detection severity based on confidence.
        
        - high: confidence >= 85%
        - medium: confidence >= 70%
        - low: confidence < 70%
        """
        if confidence >= 0.85:
            return "high"
        elif confidence >= 0.7:
            return "medium"
        return "low"
