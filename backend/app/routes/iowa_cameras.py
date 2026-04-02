"""Iowa DOT camera routes — ArcGIS-based traffic camera discovery and snapshot proxy."""

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth import get_current_admin
from app.services.iowa_camera_service import iowa_camera_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/iowa", tags=["iowa-cameras"])

SNAPSHOT_TIMEOUT = 10.0


@router.get("/cameras")
async def list_iowa_cameras(
    region: str | None = Query(None, description="Filter by Iowa region (e.g. 'Dubuque')"),
    search: str | None = Query(None, description="Search by name, route, or region"),
    camera_type: str | None = Query(None, description="Filter by type: 'Iowa DOT', 'RWIS', etc."),
    limit: int = Query(500, ge=1, le=5000),
    force_refresh: bool = Query(False, description="Bypass cache and re-fetch from ArcGIS API"),
    _admin: str = Depends(get_current_admin),
):
    """List Iowa DOT traffic cameras from the ArcGIS FeatureServer.

    Data is fetched from:
    https://services.arcgis.com/.../Traffic_Cameras_View/FeatureServer/0

    Results are cached (10 min in-memory, 1 hr on-disk) for performance.
    """
    cameras = await asyncio.to_thread(iowa_camera_service.fetch_cameras, force_refresh)

    # Apply region filter
    if region:
        region_lower = region.lower()
        cameras = [c for c in cameras if region_lower in c.region.lower()]

    # Apply type filter
    if camera_type:
        type_lower = camera_type.lower()
        cameras = [c for c in cameras if type_lower in c.camera_type.lower()]

    # Apply search filter
    if search:
        search_lower = search.lower()
        cameras = [
            c for c in cameras
            if (search_lower in c.location_name.lower()
                or search_lower in c.route.lower()
                or search_lower in c.region.lower()
                or search_lower in c.common_id.lower())
        ]

    total = len(cameras)
    cameras = cameras[:limit]

    return {
        "source": "iowa",
        "cameras": [c.to_dict() for c in cameras],
        "total": total,
        "limit": limit,
    }


@router.get("/cameras/regions")
async def list_iowa_regions(_admin: str = Depends(get_current_admin)):
    """List distinct Iowa regions available in the camera dataset."""
    regions = await asyncio.to_thread(iowa_camera_service.get_regions)
    return {"regions": regions}


@router.get("/cameras/{camera_id}/snapshot")
async def get_iowa_camera_snapshot(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Proxy the snapshot image from an Iowa DOT camera.

    Returns the JPEG image bytes directly so the frontend can display it
    without CORS issues.
    """
    camera = iowa_camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(
            status_code=404,
            detail="Iowa camera not found. Make sure to fetch the camera list first.",
        )

    if not camera.snapshot_url:
        raise HTTPException(status_code=404, detail="No snapshot URL for this camera")

    try:
        async with httpx.AsyncClient(timeout=SNAPSHOT_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(camera.snapshot_url)

        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Iowa snapshot server returned {resp.status_code}",
            )

        content_type = resp.headers.get("content-type", "image/jpeg")
        return Response(
            content=resp.content,
            media_type=content_type,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Iowa snapshot server timed out")
    except httpx.RequestError as e:
        logger.error("Iowa snapshot proxy error for %s: %s", camera_id, e)
        raise HTTPException(status_code=502, detail="Failed to fetch Iowa camera snapshot")


@router.get("/cameras/{camera_id}/info")
async def get_iowa_camera_info(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get full Iowa camera details by ID."""
    camera = iowa_camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Iowa camera not found")
    return {"camera": camera.to_dict()}
