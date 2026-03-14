"""Camera service — Caltrans CCTV feed discovery, caching, and snapshot proxy."""

import io
import logging
import time
import hashlib
from dataclasses import dataclass, field
from typing import Optional

import requests
from PIL import Image

logger = logging.getLogger(__name__)

# Caltrans districts with traffic cameras
CALTRANS_DISTRICTS = {
    1: "Northwest",
    2: "Northeast",
    3: "Sacramento",
    4: "SF Bay Area",
    5: "Central Coast",
    6: "Fresno",
    7: "Los Angeles",
    8: "San Bernardino",
    9: "Bishop",
    10: "Stockton",
    11: "San Diego",
    12: "Orange County",
}

CALTRANS_CSV_URL = (
    "https://cwwp2.dot.ca.gov/data/d{district}/cctv/cctvStatusD{district:02d}.csv"
)

# Cache duration in seconds
CAMERA_CACHE_TTL = 600  # 10 minutes
SNAPSHOT_TIMEOUT = 10   # seconds


@dataclass
class CameraInfo:
    """Parsed camera information from Caltrans CSV."""
    id: str
    district: int
    location_name: str
    latitude: float
    longitude: float
    snapshot_url: str
    stream_url: str
    direction: str
    county: str
    route: str
    in_service: bool

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "district": self.district,
            "district_name": CALTRANS_DISTRICTS.get(self.district, f"District {self.district}"),
            "location_name": self.location_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "snapshot_url": self.snapshot_url,
            "stream_url": self.stream_url,
            "direction": self.direction,
            "county": self.county,
            "route": self.route,
            "in_service": self.in_service,
        }


@dataclass
class CameraCache:
    """In-memory cache for camera data per district."""
    cameras: list[CameraInfo] = field(default_factory=list)
    last_fetched: float = 0.0
    is_stale: bool = True

    @property
    def expired(self) -> bool:
        return (time.time() - self.last_fetched) > CAMERA_CACHE_TTL


class CameraService:
    """Manages Caltrans CCTV camera discovery and snapshot retrieval."""

    def __init__(self):
        self._cache: dict[int, CameraCache] = {}
        self._all_cameras_cache: list[CameraInfo] = []
        self._all_cameras_fetched: float = 0.0

    def fetch_cameras_for_district(self, district: int) -> list[CameraInfo]:
        """Fetch and parse camera list for a Caltrans district."""
        # Check cache
        cache = self._cache.get(district)
        if cache and not cache.expired:
            return cache.cameras

        url = CALTRANS_CSV_URL.format(district=district)
        logger.info("Fetching Caltrans cameras for district %d: %s", district, url)

        cameras: list[CameraInfo] = []
        try:
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()

            import csv
            reader = csv.DictReader(io.StringIO(resp.text))
            
            for row in reader:
                try:
                    cctv_id = row.get("index") or row.get("cctv_id") or row.get("CCTV_ID") or ""
                    if not cctv_id:
                        continue
                        
                    location = row.get("locationName") or row.get("location_name") or row.get("location") or ""
                    route = row.get("route") or ""
                    county = row.get("county") or ""
                    direction = row.get("direction") or ""
                    
                    try:
                        latitude = float(row.get("latitude") or 0.0)
                        longitude = float(row.get("longitude") or 0.0)
                    except ValueError:
                        continue
                        
                    if latitude == 0 or longitude == 0:
                        continue
                        
                    snapshot_url = row.get("currentImageURL") or row.get("image_url") or ""
                    if not snapshot_url:
                        continue
                        
                    stream_url = row.get("streamingVideoURL") or row.get("stream_url") or ""
                    
                    in_service_str = str(row.get("inService") or row.get("in_service") or "true").lower()
                    in_service = in_service_str in ("true", "1", "yes", "")
                    
                    raw_id = f"d{district}_{cctv_id}_{location}"
                    cam_id = hashlib.md5(raw_id.encode()).hexdigest()[:12]
                    
                    cameras.append(CameraInfo(
                        id=cam_id,
                        district=district,
                        location_name=location,
                        latitude=latitude,
                        longitude=longitude,
                        snapshot_url=snapshot_url,
                        stream_url=stream_url,
                        direction=direction,
                        county=county,
                        route=route,
                        in_service=in_service,
                    ))
                except Exception as e:
                    logger.debug("Failed to parse CSV row: %s", e)

            logger.info("Loaded %d active cameras for district %d", len(cameras), district)
        except requests.RequestException as e:
            logger.error("Failed to fetch district %d cameras: %s", district, e)
            # Return stale cache if available
            if cache:
                return cache.cameras
            return []

        # Update cache
        self._cache[district] = CameraCache(
            cameras=cameras,
            last_fetched=time.time(),
            is_stale=False,
        )
        return cameras

    def fetch_all_cameras(self, districts: list[int] | None = None) -> list[CameraInfo]:
        """Fetch cameras from multiple districts (defaults to major ones)."""
        if districts is None:
            # Default to most populated districts for faster loading
            districts = [4, 7, 8, 11, 12]  # SF Bay, LA, San Bernardino, San Diego, OC

        # Check if aggregate cache is still valid
        if (
            self._all_cameras_cache
            and (time.time() - self._all_cameras_fetched) < CAMERA_CACHE_TTL
        ):
            return self._all_cameras_cache

        all_cameras: list[CameraInfo] = []
        for d in districts:
            all_cameras.extend(self.fetch_cameras_for_district(d))

        self._all_cameras_cache = all_cameras
        self._all_cameras_fetched = time.time()
        return all_cameras

    def fetch_snapshot(self, snapshot_url: str) -> Optional[bytes]:
        """Fetch the latest JPEG snapshot from a camera URL.

        Returns raw JPEG bytes or None on failure.
        """
        try:
            resp = requests.get(snapshot_url, timeout=SNAPSHOT_TIMEOUT)
            resp.raise_for_status()

            # Validate it's an image
            content_type = resp.headers.get("content-type", "")
            if "image" not in content_type and len(resp.content) < 1000:
                logger.warning("Snapshot doesn't look like an image: %s", content_type)
                return None

            return resp.content
        except requests.RequestException as e:
            logger.warning("Failed to fetch snapshot from %s: %s", snapshot_url, e)
            return None

    def fetch_snapshot_as_pil(self, snapshot_url: str) -> Optional[Image.Image]:
        """Fetch a snapshot and return it as a PIL Image (RGB)."""
        raw = self.fetch_snapshot(snapshot_url)
        if not raw:
            return None
        try:
            return Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as e:
            logger.warning("Failed to decode snapshot image: %s", e)
            return None

    def get_camera_by_id(self, camera_id: str) -> Optional[CameraInfo]:
        """Look up a camera by its ID from cached data."""
        # Search all cached districts
        for cache in self._cache.values():
            for cam in cache.cameras:
                if cam.id == camera_id:
                    return cam
        # Also search the aggregate cache
        for cam in self._all_cameras_cache:
            if cam.id == camera_id:
                return cam
        return None

    def get_districts(self) -> list[dict]:
        """Return available districts with metadata."""
        return [
            {"id": d, "name": name}
            for d, name in sorted(CALTRANS_DISTRICTS.items())
        ]


# Module-level singleton
camera_service = CameraService()
