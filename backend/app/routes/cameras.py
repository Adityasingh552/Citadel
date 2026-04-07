"""Camera routes — unified CCTV feed discovery, snapshot proxy, monitoring, and HLS stream proxy.

Serves both Caltrans (California) and Iowa DOT cameras from the same endpoints.
Iowa cameras are identified by the ``ia_`` prefix in their ID.
"""

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
from app.services.iowa_camera_service import iowa_camera_service
from app.services.monitor_service import monitor_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])

# ── HLS proxy config ──
HLS_UPSTREAM_BASE = "https://wzmedia.dot.ca.gov/"
HLS_PROXY_TIMEOUT = 15.0
IOWA_SNAPSHOT_TIMEOUT = 10.0


@router.get("/districts")
async def list_districts(_admin: str = Depends(get_current_admin)):
    """List available Caltrans districts."""
    return {"districts": camera_service.get_districts()}


@router.get("")
async def list_cameras(
    district: int | None = Query(None, description="Filter by Caltrans district number (excludes Iowa cameras)"),
    search: str | None = Query(None, description="Search by location name, county/region, or route"),
    limit: int = Query(100, ge=1, le=5000),
    source: str | None = Query(None, description="Filter by source: 'caltrans' or 'iowa'"),
    _admin: str = Depends(get_current_admin),
):
    """List available traffic cameras from all supported networks.

    Returns cameras from Caltrans (California) and Iowa DOT, merged into a
    single list. Use ``source`` to restrict to one provider. Use ``district``
    to restrict to a specific California district (automatically excludes Iowa).
    """
    # ── Caltrans cameras ──
    include_caltrans = source != "iowa"
    if include_caltrans:
        if district is not None:
            ca_cameras = await asyncio.to_thread(
                camera_service.fetch_cameras_for_district, district
            )
        else:
            ca_cameras = await asyncio.to_thread(camera_service.fetch_all_cameras)
    else:
        ca_cameras = []

    # ── Iowa cameras (skip when district filter is active) ──
    include_iowa = source != "caltrans" and district is None
    if include_iowa:
        iowa_cams = await asyncio.to_thread(iowa_camera_service.fetch_cameras)
    else:
        iowa_cams = []

    # Merge into unified list
    all_cameras = [c.to_dict() for c in ca_cameras] + [c.to_dict() for c in iowa_cams]

    # Apply search filter (works uniformly across both sources)
    if search:
        search_lower = search.lower()
        all_cameras = [
            c for c in all_cameras
            if search_lower in c.get("location_name", "").lower()
            or search_lower in c.get("county", "").lower()
            or search_lower in c.get("route", "").lower()
            or search_lower in c.get("region", "").lower()
        ]

    total = len(all_cameras)
    all_cameras = all_cameras[:limit]

    return {
        "cameras": all_cameras,
        "total": total,
        "limit": limit,
    }


@router.get("/{camera_id}/snapshot")
async def get_camera_snapshot(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Fetch the latest snapshot image from a specific camera.

    Works for both Caltrans and Iowa DOT cameras. Iowa cameras are identified
    by the ``ia_`` prefix and their images are fetched via httpx.
    """
    # ── Caltrans ──
    camera = camera_service.get_camera_by_id(camera_id)
    if camera:
        raw = await asyncio.to_thread(camera_service.fetch_snapshot, camera.snapshot_url)
        if raw is None:
            raise HTTPException(status_code=502, detail="Failed to fetch camera snapshot")
        return Response(
            content=raw,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    # ── Iowa DOT ──
    iowa_cam = iowa_camera_service.get_camera_by_id(camera_id)
    if iowa_cam:
        if not iowa_cam.snapshot_url:
            raise HTTPException(status_code=404, detail="No snapshot URL for this camera")
        try:
            async with httpx.AsyncClient(timeout=IOWA_SNAPSHOT_TIMEOUT, follow_redirects=True) as client:
                resp = await client.get(iowa_cam.snapshot_url)
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

    raise HTTPException(status_code=404, detail="Camera not found. Fetch the camera list first.")


@router.get("/{camera_id}/snapshot-url")
async def get_snapshot_url(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get the direct snapshot URL for a camera (for frontend display).

    Works for both Caltrans and Iowa DOT cameras.
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if camera:
        return {
            "camera_id": camera.id,
            "snapshot_url": camera.snapshot_url,
            "stream_url": camera.stream_url,
            "location_name": camera.location_name,
        }

    iowa_cam = iowa_camera_service.get_camera_by_id(camera_id)
    if iowa_cam:
        return {
            "camera_id": iowa_cam.id,
            "snapshot_url": iowa_cam.snapshot_url,
            "stream_url": iowa_cam.stream_url,
            "location_name": iowa_cam.location_name,
        }

    raise HTTPException(status_code=404, detail="Camera not found")


@router.get("/{camera_id}/info")
async def get_camera_info(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get full camera details by ID — works for both Caltrans and Iowa cameras."""
    camera = camera_service.get_camera_by_id(camera_id)
    if camera:
        return {"camera": camera.to_dict()}

    iowa_cam = iowa_camera_service.get_camera_by_id(camera_id)
    if iowa_cam:
        return {"camera": iowa_cam.to_dict()}

    raise HTTPException(status_code=404, detail="Camera not found")


# ── Monitoring endpoints ──────────────────────────────────────────

@router.post("/monitor/start")
async def start_monitoring(
    camera_id: str = Query(..., description="Camera ID to monitor"),
    stream_mode: bool = Query(False, description="Use HLS video stream instead of snapshot polling"),
    stream_interval: int = Query(10, ge=1, le=120, description="Seconds between stream frame grabs (only in stream mode)"),
    _admin: str = Depends(get_current_admin),
):
    """Start auto-monitoring a camera feed.

    Works for both Caltrans and Iowa DOT cameras. Iowa cameras are identified
    by the ``ia_`` prefix. Uses snapshot polling by default; pass
    ``stream_mode=true`` to grab frames from the HLS stream.
    """
    # Try Caltrans first, then Iowa
    camera = camera_service.get_camera_by_id(camera_id)
    if not camera:
        camera = iowa_camera_service.get_camera_by_id(camera_id)
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

    For Iowa cameras, always returns ``changed: true`` since their servers
    don't reliably expose ETag / Last-Modified headers.
    """
    camera = camera_service.get_camera_by_id(camera_id)
    if camera:
        changed = await asyncio.to_thread(
            camera_service.has_snapshot_changed, camera.snapshot_url
        )
        return {"camera_id": camera.id, "changed": changed}

    iowa_cam = iowa_camera_service.get_camera_by_id(camera_id)
    if iowa_cam:
        # Iowa DOT snapshot servers don't expose reliable cache headers,
        # so we always report changed to ensure fresh images are fetched.
        return {"camera_id": iowa_cam.id, "changed": True}

    raise HTTPException(status_code=404, detail="Camera not found")


# ── HLS Stream Proxy ──────────────────────────────────────────────

@router.get("/{camera_id}/stream-info")
async def get_stream_info(
    camera_id: str,
    _admin: str = Depends(get_current_admin),
):
    """Get HLS stream information for a camera.

    For Caltrans cameras, returns a proxied URL routed through the backend
    to solve the wzmedia CORS restriction.

    For Iowa DOT cameras, returns the direct HLS URL from Iowa DOT's CDN.
    CORS policy on Iowa's CDN may vary; if playback fails, use snapshot mode.
    """
    # ── Caltrans ──
    camera = camera_service.get_camera_by_id(camera_id)
    if camera:
        if not camera.stream_url:
            raise HTTPException(status_code=404, detail="No video stream available for this camera")
        proxy_path = _stream_url_to_proxy_path(camera.stream_url)
        if not proxy_path:
            raise HTTPException(status_code=400, detail="Could not parse stream URL")
        return {
            "camera_id": camera.id,
            "has_stream": True,
            "proxy_url": f"/api/cameras/hls-proxy/{proxy_path}",
            "location_name": camera.location_name,
        }

    # ── Iowa DOT ──
    iowa_cam = iowa_camera_service.get_camera_by_id(camera_id)
    if iowa_cam:
        if not iowa_cam.stream_url:
            raise HTTPException(status_code=404, detail="No video stream available for this camera")
        return {
            "camera_id": iowa_cam.id,
            "has_stream": True,
            # Iowa streams are served from Iowa DOT's own CDN; proxy via iowa-hls-proxy
            "proxy_url": f"/api/cameras/iowa-hls-proxy/{iowa_cam.stream_url.lstrip('/')}",
            "direct_url": iowa_cam.stream_url,
            "location_name": iowa_cam.location_name,
        }

    raise HTTPException(status_code=404, detail="Camera not found")


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


@router.get("/iowa-hls-proxy/{path:path}")
async def iowa_hls_proxy(
    path: str,
    _admin: str = Depends(get_current_admin),
):
    """Proxy HLS playlist and segment requests for Iowa DOT camera streams.

    Iowa DOT streams may not expose CORS headers, so we proxy them just like
    Caltrans. Handles full absolute URLs passed via the path component.
    """
    # Reconstruct the upstream URL (the path is the full URL minus the scheme)
    if not path.startswith("http"):
        path = f"https://{path}"

    if not _is_safe_iowa_hls_url(path):
        raise HTTPException(status_code=400, detail="Invalid Iowa HLS URL")

    try:
        async with httpx.AsyncClient(timeout=HLS_PROXY_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(path)

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Iowa upstream returned {resp.status_code}",
            )

        content_type = resp.headers.get("content-type", "")

        if path.endswith(".m3u8") or "mpegurl" in content_type.lower():
            return Response(
                content=resp.content,
                media_type="application/vnd.apple.mpegurl",
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Access-Control-Allow-Origin": "*",
                },
            )

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
        raise HTTPException(status_code=504, detail="Iowa stream server timed out")
    except httpx.RequestError as e:
        logger.error("Iowa HLS proxy error for %s: %s", path, e)
        raise HTTPException(status_code=502, detail="Failed to connect to Iowa stream server")


# ── Private helpers ───────────────────────────────────────────────

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


def _is_safe_iowa_hls_url(url: str) -> bool:
    """Basic safety check for Iowa HLS proxy URLs."""
    if '..' in url:
        return False
    return url.endswith('.m3u8') or url.endswith('.ts') or url.endswith('.m3u')


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
