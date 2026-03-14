"""Camera service — Caltrans CCTV feed discovery, caching, and snapshot proxy."""

import csv
import io
import logging
import os
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
CAMERA_CACHE_TTL = 600          # 10 minutes — in-memory cache within a running process
LOCAL_CSV_TTL = 86400           # 24 hours — local file cache survives restarts
SNAPSHOT_TIMEOUT = 10           # seconds
STARTUP_CACHE_ENABLED = True    # Pre-load cameras on startup


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
    update_frequency: int = 2  # minutes — from currentImageUpdateFrequency

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
            "update_frequency": self.update_frequency,
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
        # Track last-known snapshot metadata per camera URL for change detection
        self._snapshot_etags: dict[str, str] = {}  # url -> ETag or Last-Modified
        self._startup_loaded = False
        self._data_dir: str | None = None  # Set via set_data_dir() before startup

    def set_data_dir(self, data_dir: str) -> None:
        """Set the directory for local CSV file cache."""
        self._data_dir = data_dir
        logger.info("Camera CSV cache directory: %s", os.path.abspath(data_dir))

    def _csv_path(self, district: int) -> str | None:
        """Return local file path for a district's CSV cache, or None if no data_dir."""
        if not self._data_dir:
            return None
        return os.path.join(self._data_dir, f"cctvStatusD{district:02d}.csv")

    def _is_local_csv_fresh(self, path: str) -> bool:
        """Check if a local CSV file exists and is younger than LOCAL_CSV_TTL."""
        try:
            mtime = os.path.getmtime(path)
            age = time.time() - mtime
            return age < LOCAL_CSV_TTL
        except OSError:
            return False

    def load_cameras_on_startup(self, districts: list[int] | None = None):
        """Pre-load camera data from all districts on startup.
        
        This ensures the first API request is fast and data is already cached.
        """
        if not STARTUP_CACHE_ENABLED:
            return
        
        if districts is None:
            districts = sorted(CALTRANS_DISTRICTS.keys())
        
        logger.info("Pre-loading camera data for districts %s...", districts)
        all_cameras: list[CameraInfo] = []
        
        for d in districts:
            cams = self.fetch_cameras_for_district(d)
            all_cameras.extend(cams)
            logger.info("Loaded %d cameras for district %d", len(cams), d)
        
        self._all_cameras_cache = all_cameras
        self._all_cameras_fetched = time.time()
        self._startup_loaded = True
        logger.info("Camera startup cache complete: %d total cameras", len(all_cameras))

    def fetch_cameras_for_district(self, district: int) -> list[CameraInfo]:
        """Fetch and parse camera list for a Caltrans district.

        Cache hierarchy:
        1. In-memory cache (TTL: 10 min) — fastest, within running process
        2. Local CSV file (TTL: 24 hrs) — survives restarts, no HTTP
        3. Caltrans HTTP fetch — slowest, saves to local file after download
        """
        # 1. Check in-memory cache
        cache = self._cache.get(district)
        if cache and not cache.expired:
            return cache.cameras

        # 2. Check local CSV file cache
        csv_path = self._csv_path(district)
        if csv_path and self._is_local_csv_fresh(csv_path):
            logger.info("Loading district %d from local cache: %s", district, csv_path)
            csv_text = self._read_local_csv(csv_path)
            if csv_text:
                cameras = self._parse_csv(csv_text, district)
                if cameras:
                    self._cache[district] = CameraCache(
                        cameras=cameras,
                        last_fetched=time.time(),
                        is_stale=False,
                    )
                    logger.info("Loaded %d cameras for district %d (from local file)", len(cameras), district)
                    return cameras

        # 3. Fetch from Caltrans over HTTP
        url = CALTRANS_CSV_URL.format(district=district)
        logger.info("Fetching Caltrans cameras for district %d: %s", district, url)

        try:
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            csv_text = resp.text

            # Save to local file for next restart
            if csv_path:
                self._write_local_csv(csv_path, csv_text)

            cameras = self._parse_csv(csv_text, district)
            logger.info("Loaded %d cameras for district %d (from HTTP)", len(cameras), district)
        except requests.RequestException as e:
            logger.error("Failed to fetch district %d cameras: %s", district, e)
            # Try stale local file as last resort
            if csv_path and os.path.exists(csv_path):
                logger.warning("Using stale local CSV for district %d", district)
                csv_text = self._read_local_csv(csv_path)
                if csv_text:
                    cameras = self._parse_csv(csv_text, district)
                    if cameras:
                        self._cache[district] = CameraCache(
                            cameras=cameras, last_fetched=time.time(), is_stale=True,
                        )
                        return cameras
            # Return stale in-memory cache if available
            if cache:
                return cache.cameras
            return []

        # Update in-memory cache
        self._cache[district] = CameraCache(
            cameras=cameras,
            last_fetched=time.time(),
            is_stale=False,
        )
        return cameras

    def _read_local_csv(self, path: str) -> str | None:
        """Read a local CSV file and return its text content."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except OSError as e:
            logger.warning("Failed to read local CSV %s: %s", path, e)
            return None

    def _write_local_csv(self, path: str, content: str) -> None:
        """Write CSV text to a local file."""
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            logger.debug("Saved local CSV cache: %s", path)
        except OSError as e:
            logger.warning("Failed to write local CSV %s: %s", path, e)

    def _parse_csv(self, csv_text: str, district: int) -> list[CameraInfo]:
        """Parse raw CSV text into a list of CameraInfo objects."""
        cameras: list[CameraInfo] = []
        reader = csv.DictReader(io.StringIO(csv_text))

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

                # Parse update frequency (minutes)
                try:
                    update_freq = int(row.get("currentImageUpdateFrequency") or 2)
                except (ValueError, TypeError):
                    update_freq = 2
                if update_freq < 1:
                    update_freq = 2

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
                    update_frequency=update_freq,
                ))
            except Exception as e:
                logger.debug("Failed to parse CSV row: %s", e)

        return cameras

    def fetch_all_cameras(self, districts: list[int] | None = None) -> list[CameraInfo]:
        """Fetch cameras from multiple districts (defaults to all districts)."""
        if districts is None:
            districts = sorted(CALTRANS_DISTRICTS.keys())

        # Check if aggregate cache is still valid
        if (
            self._all_cameras_cache
            and (time.time() - self._all_cameras_fetched) < CAMERA_CACHE_TTL
        ):
            return self._all_cameras_cache

        # If not loaded yet and we're past startup, load now
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

            # Store ETag / Last-Modified for change detection
            etag = resp.headers.get("ETag") or resp.headers.get("Last-Modified") or ""
            if etag:
                self._snapshot_etags[snapshot_url] = etag

            return resp.content
        except requests.RequestException as e:
            logger.warning("Failed to fetch snapshot from %s: %s", snapshot_url, e)
            return None

    def has_snapshot_changed(self, snapshot_url: str) -> bool:
        """Use HTTP HEAD to check if a snapshot has changed since last fetch.

        Returns True if the snapshot appears to have changed (or if we can't
        determine — defaults to True so caller fetches anyway).
        """
        try:
            resp = requests.head(snapshot_url, timeout=5)
            if resp.status_code != 200:
                return True  # Can't tell, assume changed

            current = resp.headers.get("ETag") or resp.headers.get("Last-Modified") or ""
            if not current:
                return True  # No caching headers, assume changed

            previous = self._snapshot_etags.get(snapshot_url, "")
            if not previous:
                # First check — record it and report changed
                self._snapshot_etags[snapshot_url] = current
                return True

            changed = current != previous
            if changed:
                self._snapshot_etags[snapshot_url] = current
            return changed
        except requests.RequestException:
            return True  # On error, assume changed so we still try to fetch

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
