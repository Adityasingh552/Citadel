"""Citadel Backend — FastAPI application entry point."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import ensure_performance_indexes, verify_connection
from app.config import get_settings
from app.detection.detector import AccidentDetector
from app.detection.processor import VideoProcessor
from app.services.camera_service import camera_service
from app.services.iowa_camera_service import iowa_camera_service
from app.services.monitor_service import monitor_service
from app.routes import auth, detection, events, tickets, stats, settings, cameras, alerts
from app.routes import iowa_cameras, incidents

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — initialize DB and load model on startup."""
    config = get_settings()

    # Verify Supabase database connection
    logger.info("Verifying Supabase database connection...")
    verify_connection()
    ensure_performance_indexes()

    # Create required directories
    os.makedirs(config.evidence_dir, exist_ok=True)
    os.makedirs(config.uploads_dir, exist_ok=True)
    os.makedirs(config.data_dir, exist_ok=True)

    # Load YOLO26 model
    logger.info("Loading YOLO26 accident detection model...")
    detector = AccidentDetector()
    detector.load()

    # Initialize processor and share with routes
    processor = VideoProcessor(detector)
    detection.set_processor(processor)

    # Initialize camera monitoring service (supports both Caltrans + Iowa cameras)
    monitor_service.set_dependencies(camera_service, processor, iowa_camera_service)

    # Pre-load Caltrans camera data (uses local CSV cache — fast on reload)
    camera_service.set_data_dir(config.data_dir)
    logger.info("Pre-loading Caltrans camera data...")
    camera_service.load_cameras_on_startup()

    # Pre-load Iowa DOT camera data (ArcGIS GeoJSON — cached to disk)
    iowa_camera_service.set_data_dir(config.data_dir)
    logger.info("Pre-loading Iowa DOT camera data...")
    iowa_camera_service.preload()

    # Restore previously active monitors from DB
    restored = monitor_service.restore_from_db()
    if restored:
        logger.info("Restored %d camera monitors from previous session", restored)

    logger.info("Citadel backend ready")
    yield

    # Shutdown: stop all active monitors but keep DB rows for next restart
    monitor_service.stop_all(persist=False)
    logger.info("Citadel backend shutting down")


app = FastAPI(
    title="Citadel API",
    description="AI-Powered Traffic Safety Analytics",
    version="1.0.0-alpha",
    lifespan=lifespan,
)

# CORS — allow frontend origins (dev + production)
cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
# Add production frontend URL from environment if set
if os.getenv("FRONTEND_URL"):
    cors_origins.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount evidence directory for serving local evidence files.
# Aggressive evidence mode writes locally first, then uploads asynchronously.
config = get_settings()
os.makedirs(config.evidence_dir, exist_ok=True)
app.mount("/evidence", StaticFiles(directory=config.evidence_dir), name="evidence")
logger.info("Mounted local evidence directory")

# Include API routes
app.include_router(auth.router)
app.include_router(detection.router)
app.include_router(events.router)
app.include_router(tickets.router)
app.include_router(stats.router)
app.include_router(settings.router)
app.include_router(cameras.router)
app.include_router(iowa_cameras.router)
app.include_router(alerts.router)
app.include_router(incidents.router)


@app.get("/api/health", tags=["system"])
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "version": "1.0.0-alpha",
        "model": "YOLO26 (ONNX)",
    }
