"""Citadel Backend — FastAPI application entry point."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import create_tables
from app.config import get_settings
from app.detection.detector import AccidentDetector
from app.detection.processor import VideoProcessor
from app.services.camera_service import camera_service
from app.services.monitor_service import monitor_service
from app.routes import auth, detection, events, tickets, stats, settings, cameras

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

    # Create database tables
    logger.info("Initializing database...")
    create_tables()

    # Create required directories
    os.makedirs(config.evidence_dir, exist_ok=True)
    os.makedirs(config.uploads_dir, exist_ok=True)
    os.makedirs(config.data_dir, exist_ok=True)

    # Load DETR model
    logger.info("Loading AI detection model...")
    detector = AccidentDetector()
    detector.load()

    # Initialize processor and share with routes
    processor = VideoProcessor(detector)
    detection.set_processor(processor)

    # Initialize camera monitoring service
    monitor_service.set_dependencies(camera_service, processor)

    # Pre-load camera data (uses local CSV cache — fast on reload)
    camera_service.set_data_dir(config.data_dir)
    logger.info("Pre-loading camera data...")
    camera_service.load_cameras_on_startup()

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

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount evidence directory for serving saved frames
config = get_settings()
os.makedirs(config.evidence_dir, exist_ok=True)
app.mount("/evidence", StaticFiles(directory=config.evidence_dir), name="evidence")

# Include API routes
app.include_router(auth.router)
app.include_router(detection.router)
app.include_router(events.router)
app.include_router(tickets.router)
app.include_router(stats.router)
app.include_router(settings.router)
app.include_router(cameras.router)


@app.get("/api/health", tags=["system"])
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "version": "1.0.0-alpha",
        "model": config.model_name,
    }
