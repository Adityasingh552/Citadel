"""Camera routes — live CCTV feed discovery, snapshot proxy, monitoring, and HLS stream proxy."""

import asyncio
import logging
import re
from io import BytesIO
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from app.auth import get_current_admin
from app.services.camera_service import camera_service
from app.services.monitor_service import monitor_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

# ── HLS proxy config ──
HLS_UPSTREAM_BASE = "https://wzmedia.dot.ca.gov/"
HLS_PROXY_TIMEOUT = 15.0


@router.get("/districts")
async def list_districts(_admin: str = Depends(get_current_admin)):
    """List available Caltrans districts."""
    return {"districts": camera_service.get_districts()}


@router.get("")
async def list_cameras(
    district: int | None = Query(None, description="Filter by district number"),
    search: str | None = Query(None, description="Search by location name"),
    limit: int = Query(100, ge=1, le=5000),
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


@router.get("/{camera_id}/info")
async def get_camera_info(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get full camera details by ID (used by the Cameras detail view)."""
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    return {"camera": camera.to_dict()}


# ── Monitoring endpoints ──────────────────────────────────────────

@router.post("/monitor/start")
async def start_monitoring(
    camera_id: str = Query(..., description="Camera ID to monitor"),
    stream_mode: bool = Query(False, description="Use HLS video stream instead of snapshot polling"),
    stream_interval: int = Query(10, ge=3, le=120, description="Seconds between stream frame grabs (only in stream mode)"),
    _admin: str = Depends(get_current_admin),
):
    """Start auto-monitoring a camera feed.

    Uses the camera's own update_frequency for the poll interval in snapshot mode.
    In stream mode, frames are grabbed from the HLS video stream every `stream_interval` seconds.
    AI detection runs on each new frame. Creates events and tickets automatically.
    Multiple cameras can be monitored simultaneously.
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found. Fetch the camera list first.")

    result = await asyncio.to_thread(
        monitor_service.start, camera, stream_mode=stream_mode, stream_interval=stream_interval
    )
    return {"message": "Monitoring started", "status": result}


@router.post("/monitor/{camera_id}/stop")
async def stop_monitoring_camera(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Stop monitoring a specific camera."""
    result = await asyncio.to_thread(monitor_service.stop, camera_id)
    return {"message": "Monitoring stopped", "status": result}


@router.post("/monitor/{camera_id}/pause")
async def pause_monitoring_camera(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Pause monitoring a specific camera."""
    result = await asyncio.to_thread(monitor_service.pause, camera_id)
    if not result:
        raise HTTPException(status_code=404, detail="Monitor not found or not active")
    return {"message": "Monitoring paused", "status": result}


@router.post("/monitor/{camera_id}/resume")
async def resume_monitoring_camera(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Resume monitoring a specific camera."""
    result = await asyncio.to_thread(monitor_service.resume, camera_id)
    if not result:
        raise HTTPException(status_code=404, detail="Monitor not found or not active")
    return {"message": "Monitoring resumed", "status": result}


@router.post("/monitor/stop")
async def stop_all_monitoring(_admin: str = Depends(get_current_admin)):
    """Stop all active monitoring sessions."""
    count = await asyncio.to_thread(monitor_service.stop_all)
    return {"message": f"Stopped {count} monitor(s)", "stopped": count}


@router.get("/monitor/status")
async def get_all_monitor_statuses(_admin: str = Depends(get_current_admin)):
    """Get status for all active (and recently stopped) monitors."""
    statuses = monitor_service.get_all_statuses()
    active_count = sum(1 for s in statuses if s["active"])
    return {
        "monitors": statuses,
        "active_count": active_count,
        "total_count": len(statuses),
    }


@router.get("/monitor/{camera_id}/status")
async def get_camera_monitor_status(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get monitoring status for a specific camera."""
    status = monitor_service.get_status(camera_id)
    if status is None:
        return {"status": {"active": False, "camera_id": camera_id}}
    return {"status": status}


@router.get("/{camera_id}/snapshot-changed")
async def check_snapshot_changed(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """HEAD-based check: has the camera snapshot changed since last fetch?

    Used by the frontend to avoid downloading unchanged images.
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    changed = await asyncio.to_thread(
        camera_service.has_snapshot_changed, camera.snapshot_url
    )
    return {"camera_id": camera.id, "changed": changed}


# ── HLS Stream Proxy ──────────────────────────────────────────────

@router.get("/{camera_id}/stream-info")
async def get_stream_info(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get HLS stream information for a camera.

    Returns the proxied HLS URL that the frontend can use with hls.js.
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    if not camera.stream_url:
        raise HTTPException(status_code=404, detail="No video stream available for this camera")

    # Build the proxied URL path from the original stream URL
    proxy_path = _stream_url_to_proxy_path(camera.stream_url)
    if not proxy_path:
        raise HTTPException(status_code=400, detail="Could not parse stream URL")

    return {
        "camera_id": camera.id,
        "has_stream": True,
        "proxy_url": f"/api/cameras/hls-proxy/{proxy_path}",
        "location_name": camera.location_name,
    }


@router.get("/hls-proxy/{path:path}")
async def hls_proxy(
    path: str,
    _admin: str = Depends(get_current_admin),
):
    """Proxy HLS playlist and segment requests to Caltrans wzmedia server.

    This is required because wzmedia.dot.ca.gov does not set CORS headers,
    so the browser cannot fetch .m3u8 playlists or .ts segments directly.

    For .m3u8 playlists, segment URLs are rewritten to route through this proxy.
    For .ts segments, raw bytes are streamed through.
    """
    # Security: only allow safe HLS-related file extensions
    if not _is_safe_hls_path(path):
        raise HTTPException(status_code=400, detail="Invalid HLS path")

    upstream_url = HLS_UPSTREAM_BASE + path

    try:
        async with httpx.AsyncClient(timeout=HLS_PROXY_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(upstream_url)

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Upstream returned {resp.status_code}",
            )

        content_type = resp.headers.get("content-type", "")

        # For .m3u8 playlists: rewrite relative URLs to go through our proxy
        if path.endswith(".m3u8") or "mpegurl" in content_type.lower():
            playlist_text = resp.text
            rewritten = _rewrite_m3u8_urls(playlist_text, path)
            return Response(
                content=rewritten,
                media_type="application/vnd.apple.mpegurl",
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Access-Control-Allow-Origin": "*",
                },
            )

        # For .ts segments and other binary content: stream through
        media = "video/mp2t" if path.endswith(".ts") else (content_type or "application/octet-stream")
        return Response(
            content=resp.content,
            media_type=media,
            headers={
                "Cache-Control": "public, max-age=5",
                "Access-Control-Allow-Origin": "*",
            },
        )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Upstream stream server timed out")
    except httpx.RequestError as e:
        logger.error("HLS proxy error for %s: %s", path, e)
        raise HTTPException(status_code=502, detail="Failed to connect to stream server")


def _stream_url_to_proxy_path(stream_url: str) -> str | None:
    """Convert a full Caltrans stream URL to a relative proxy path.

    Example:
        https://wzmedia.dot.ca.gov/D7/CCTV-196.stream/playlist.m3u8
        -> D7/CCTV-196.stream/playlist.m3u8
    """
    prefix = "https://wzmedia.dot.ca.gov/"
    if stream_url.startswith(prefix):
        return stream_url[len(prefix):]
    # Try http variant
    prefix_http = "http://wzmedia.dot.ca.gov/"
    if stream_url.startswith(prefix_http):
        return stream_url[len(prefix_http):]
    return None


def _is_safe_hls_path(path: str) -> bool:
    """Validate that the proxy path is a safe HLS-related request."""
    # Only allow alphanumeric, hyphens, underscores, dots, slashes
    if not re.match(r'^[a-zA-Z0-9_\-./]+$', path):
        return False
    # Must not traverse directories
    if '..' in path:
        return False
    # Must be an HLS-related file
    return path.endswith('.m3u8') or path.endswith('.ts') or path.endswith('.m3u')


def _rewrite_m3u8_urls(playlist: str, playlist_path: str) -> str:
    """Rewrite relative URLs in an m3u8 playlist to route through our proxy.

    Relative segment references like 'media_123.ts' or 'chunklist.m3u8'
    become '/api/cameras/hls-proxy/D7/CCTV-196.stream/media_123.ts'.
    """
    # Get the directory of the current playlist
    base_dir = playlist_path.rsplit("/", 1)[0] if "/" in playlist_path else ""

    lines = playlist.split("\n")
    rewritten = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            rewritten.append(line)
            continue

        # This is a URI line (segment or sub-playlist reference)
        if stripped.startswith("http://") or stripped.startswith("https://"):
            # Absolute URL — rewrite to proxy if it's from wzmedia
            proxy_path = _stream_url_to_proxy_path(stripped)
            if proxy_path:
                rewritten.append(f"/api/cameras/hls-proxy/{proxy_path}")
            else:
                rewritten.append(line)  # External URL, leave as-is
        else:
            # Relative URL — prepend the base directory
            if base_dir:
                rewritten.append(f"/api/cameras/hls-proxy/{base_dir}/{stripped}")
            else:
                rewritten.append(f"/api/cameras/hls-proxy/{stripped}")

    return "\n".join(rewritten)
