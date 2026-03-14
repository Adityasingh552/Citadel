"""Camera routes — live CCTV feed discovery, snapshot proxy, and monitoring."""

import asyncio
import logging
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth import get_current_admin
from app.services.camera_service import camera_service
from app.services.monitor_service import monitor_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("/districts")
async def list_districts(_admin: str = Depends(get_current_admin)):
    """List available Caltrans districts."""
    return {"districts": camera_service.get_districts()}


@router.get("")
async def list_cameras(
    district: int | None = Query(None, description="Filter by district number"),
    search: str | None = Query(None, description="Search by location name"),
    limit: int = Query(100, ge=1, le=500),
    _admin: str = Depends(get_current_admin),
):
    """List available traffic cameras from Caltrans CCTV network.

    Fetches camera data from Caltrans CSV feeds with caching.
    """
    if district is not None:
        cameras = await asyncio.to_thread(
            camera_service.fetch_cameras_for_district, district
        )
    else:
        cameras = await asyncio.to_thread(camera_service.fetch_all_cameras)

    # Apply search filter
    if search:
        search_lower = search.lower()
        cameras = [
            c for c in cameras
            if search_lower in c.location_name.lower()
            or search_lower in c.county.lower()
            or search_lower in c.route.lower()
        ]

    # Apply limit
    total = len(cameras)
    cameras = cameras[:limit]

    return {
        "cameras": [c.to_dict() for c in cameras],
        "total": total,
        "limit": limit,
    }


@router.get("/{camera_id}/snapshot")
async def get_camera_snapshot(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Fetch the latest snapshot image from a specific camera.

    Returns the JPEG image directly (proxied from Caltrans).
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found. Fetch the camera list first.")

    raw = await asyncio.to_thread(camera_service.fetch_snapshot, camera.snapshot_url)
    if raw is None:
        raise HTTPException(status_code=502, detail="Failed to fetch camera snapshot")

    return Response(
        content=raw,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/{camera_id}/snapshot-url")
async def get_snapshot_url(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get the direct Caltrans snapshot URL for a camera (for frontend display)."""
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    return {
        "camera_id": camera.id,
        "snapshot_url": camera.snapshot_url,
        "stream_url": camera.stream_url,
        "location_name": camera.location_name,
    }


# ── Monitoring endpoints ──────────────────────────────────────────

@router.post("/monitor/start")
async def start_monitoring(
    camera_id: str = Query(..., description="Camera ID to monitor"),
    interval: int = Query(30, ge=10, le=300, description="Poll interval in seconds"),
    _admin: str = Depends(get_current_admin),
):
    """Start auto-monitoring a camera feed.

    Polls the camera snapshot at the specified interval and runs
    AI detection on each frame. Creates events and tickets automatically.
    Only one camera can be monitored at a time.
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found. Fetch the camera list first.")

    result = await asyncio.to_thread(monitor_service.start, camera, interval)
    return {"message": "Monitoring started", "status": result}


@router.post("/monitor/stop")
async def stop_monitoring(_admin: str = Depends(get_current_admin)):
    """Stop the current monitoring session."""
    result = await asyncio.to_thread(monitor_service.stop)
    return {"message": "Monitoring stopped", "status": result}


@router.get("/monitor/status")
async def get_monitor_status(_admin: str = Depends(get_current_admin)):
    """Get the current monitoring session status, including recent detections."""
    status = monitor_service.status
    return {"status": status.to_dict()}
