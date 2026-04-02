"""Iowa DOT Camera Service — ArcGIS FeatureServer GeoJSON integration.

Fetches Iowa traffic cameras from the ArcGIS REST API:
https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0
"""

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)

IOWA_ARCGIS_URL = (
    "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/"
    "Traffic_Cameras_View/FeatureServer/0/query"
)

# Fetch all features in pages of 1000 (ArcGIS default transfer limit)
IOWA_PAGE_SIZE = 1000

# Cache durations
IOWA_CACHE_TTL = 600           # 10 minutes — in-memory cache
IOWA_LOCAL_CACHE_TTL = 3600    # 1 hour — file cache survives restarts

IOWA_FETCH_TIMEOUT = 30        # seconds per HTTP request


@dataclass
class IowaCameraInfo:
    """Parsed Iowa DOT traffic camera from ArcGIS GeoJSON."""

    id: str                  # stable MD5-based ID
    fid: int                 # original ArcGIS FID
    common_id: str           # e.g. "DQTV17"
    location_name: str       # ImageName / Desc_
    latitude: float
    longitude: float
    snapshot_url: str        # ImageURL
    stream_url: str          # VideoURL (HLS .m3u8)
    route: str               # e.g. "US 20"
    region: str              # e.g. "Dubuque"
    camera_type: str         # "Iowa DOT" | "RWIS" | etc.
    org: str                 # "IADOT"
    recorded: str            # "Y" | "N" | "E"
    function: str            # "General" | "RWIS" | etc.

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "fid": self.fid,
            "common_id": self.common_id,
            "source": "iowa",
            "state": "Iowa",
            "location_name": self.location_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "snapshot_url": self.snapshot_url,
            "stream_url": self.stream_url,
            "route": self.route,
            "county": self.region,          # mapped to county field for UI compatibility
            "region": self.region,
            "direction": "",                 # not available in Iowa data
            "camera_type": self.camera_type,
            "org": self.org,
            "recorded": self.recorded,
            "function": self.function,
            "in_service": True,
            "update_frequency": 1,
            # UI compatibility aliases
            "district": 0,
            "district_name": self.region,
        }


@dataclass
class IowaCameraCache:
    """In-memory cache for Iowa camera data."""
    cameras: list[IowaCameraInfo] = field(default_factory=list)
    last_fetched: float = 0.0

    @property
    def expired(self) -> bool:
        return (time.time() - self.last_fetched) > IOWA_CACHE_TTL

    @property
    def empty(self) -> bool:
        return len(self.cameras) == 0


class IowaCameraService:
    """Fetches and caches Iowa DOT traffic camera data from ArcGIS REST API."""

    def __init__(self):
        self._cache = IowaCameraCache()
        self._data_dir: str | None = None

    def set_data_dir(self, data_dir: str) -> None:
        """Set directory for local JSON file cache."""
        self._data_dir = data_dir

    @property
    def _local_cache_path(self) -> str | None:
        if not self._data_dir:
            return None
        return os.path.join(self._data_dir, "iowa_cameras.json")

    def _is_local_cache_fresh(self) -> bool:
        path = self._local_cache_path
        if not path or not os.path.exists(path):
            return False
        age = time.time() - os.path.getmtime(path)
        return age < IOWA_LOCAL_CACHE_TTL

    def _load_local_cache(self) -> list[IowaCameraInfo] | None:
        path = self._local_cache_path
        if not path:
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            cameras = [self._dict_to_camera(d) for d in raw]
            logger.info("Iowa cameras: loaded %d from local file cache", len(cameras))
            return cameras
        except Exception as e:
            logger.warning("Iowa cameras: failed to load local cache: %s", e)
            return None

    def _save_local_cache(self, cameras: list[IowaCameraInfo]) -> None:
        path = self._local_cache_path
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump([c.to_dict() for c in cameras], f)
            logger.debug("Iowa cameras: saved %d to local cache", len(cameras))
        except Exception as e:
            logger.warning("Iowa cameras: failed to save local cache: %s", e)

    def _dict_to_camera(self, d: dict) -> IowaCameraInfo:
        """Reconstruct IowaCameraInfo from a cached dict."""
        return IowaCameraInfo(
            id=d["id"],
            fid=d.get("fid", 0),
            common_id=d.get("common_id", ""),
            location_name=d.get("location_name", ""),
            latitude=d.get("latitude", 0.0),
            longitude=d.get("longitude", 0.0),
            snapshot_url=d.get("snapshot_url", ""),
            stream_url=d.get("stream_url", ""),
            route=d.get("route", ""),
            region=d.get("region", ""),
            camera_type=d.get("camera_type", "Iowa DOT"),
            org=d.get("org", "IADOT"),
            recorded=d.get("recorded", "N"),
            function=d.get("function", "General"),
        )

    def _fetch_from_api(self) -> list[IowaCameraInfo]:
        """Fetch all Iowa cameras from ArcGIS REST API (paginated)."""
        cameras: list[IowaCameraInfo] = []
        offset = 0

        while True:
            params = {
                "outFields": "*",
                "where": "1=1",
                "f": "geojson",
                "resultOffset": str(offset),
                "resultRecordCount": str(IOWA_PAGE_SIZE),
                "orderByFields": "FID",
            }

            try:
                resp = requests.get(
                    IOWA_ARCGIS_URL,
                    params=params,
                    timeout=IOWA_FETCH_TIMEOUT,
                )
                resp.raise_for_status()
                data = resp.json()
            except requests.RequestException as e:
                logger.error("Iowa camera API request failed (offset=%d): %s", offset, e)
                break
            except Exception as e:
                logger.error("Iowa camera API parse error (offset=%d): %s", offset, e)
                break

            features = data.get("features", [])
            if not features:
                break

            for feat in features:
                cam = self._parse_feature(feat)
                if cam:
                    cameras.append(cam)

            # Check if there are more pages
            exceeded = data.get("properties", {}).get("exceededTransferLimit", False)
            if not exceeded or len(features) < IOWA_PAGE_SIZE:
                break

            offset += IOWA_PAGE_SIZE
            logger.debug("Iowa cameras: fetched page at offset %d, got %d features", offset, len(features))

        logger.info("Iowa cameras: fetched %d total from API", len(cameras))
        return cameras

    def _parse_feature(self, feature: dict) -> Optional[IowaCameraInfo]:
        """Parse a single GeoJSON feature into IowaCameraInfo."""
        try:
            props = feature.get("properties", {})
            geom = feature.get("geometry", {})

            fid = feature.get("id") or props.get("FID") or 0

            # Coordinates from geometry (most reliable) or properties fallback
            coords = geom.get("coordinates", [])
            if len(coords) >= 2:
                longitude = float(coords[0])
                latitude = float(coords[1])
            else:
                latitude = float(props.get("latitude") or 0)
                longitude = float(props.get("longitude") or 0)

            # Iowa bounding box (with a small margin for border cameras)
            # Iowa: lat 40.35–43.5, lon -96.7 to -90.1
            IOWA_LAT_MIN, IOWA_LAT_MAX = 40.0, 44.0
            IOWA_LON_MIN, IOWA_LON_MAX = -97.5, -89.5
            if not (IOWA_LAT_MIN <= latitude <= IOWA_LAT_MAX and IOWA_LON_MIN <= longitude <= IOWA_LON_MAX):
                logger.debug(
                    "Iowa: dropping camera fid=%s with out-of-bounds coordinates (%.4f, %.4f)",
                    fid, latitude, longitude,
                )
                return None

            snapshot_url = props.get("ImageURL") or ""
            if not snapshot_url:
                return None  # Skip cameras with no image

            stream_url = props.get("VideoURL") or ""
            location_name = props.get("ImageName") or props.get("Desc_") or f"Iowa Camera {fid}"
            common_id = props.get("COMMON_ID") or str(fid)
            route = props.get("Route") or ""
            region = props.get("REGION") or "Iowa"
            camera_type = props.get("Type") or "Iowa DOT"
            org = props.get("ORG") or "IADOT"
            recorded = props.get("RECORDED") or "N"
            function = props.get("FUNCTION") or "General"

            # Stable ID from COMMON_ID + FID
            raw_id = f"iowa_{common_id}_{fid}"
            cam_id = "ia_" + hashlib.md5(raw_id.encode()).hexdigest()[:10]

            return IowaCameraInfo(
                id=cam_id,
                fid=int(fid),
                common_id=common_id,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                snapshot_url=snapshot_url,
                stream_url=stream_url,
                route=route,
                region=region,
                camera_type=camera_type,
                org=org,
                recorded=recorded,
                function=function,
            )
        except Exception as e:
            logger.debug("Iowa: failed to parse feature %s: %s", feature.get("id"), e)
            return None

    def fetch_cameras(self, force: bool = False) -> list[IowaCameraInfo]:
        """Return Iowa cameras, using cache when possible.

        Cache hierarchy:
        1. In-memory (10 min TTL) — fastest
        2. Local JSON file (1 hr TTL) — survives restarts
        3. ArcGIS REST API — full network fetch with pagination
        """
        # 1. In-memory cache
        if not force and not self._cache.expired and not self._cache.empty:
            return self._cache.cameras

        # 2. Local file cache
        if not force and self._is_local_cache_fresh():
            cameras = self._load_local_cache()
            if cameras:
                self._cache.cameras = cameras
                self._cache.last_fetched = time.time()
                return cameras

        # 3. Fetch from API
        logger.info("Iowa cameras: fetching from ArcGIS API...")
        cameras = self._fetch_from_api()

        if not cameras:
            # Fall back to stale caches
            if not self._cache.empty:
                logger.warning("Iowa cameras: API failed, using stale in-memory cache")
                return self._cache.cameras
            stale = self._load_local_cache()
            if stale:
                logger.warning("Iowa cameras: API failed, using stale local cache")
                return stale
            return []

        # Update caches
        self._cache.cameras = cameras
        self._cache.last_fetched = time.time()
        self._save_local_cache(cameras)
        return cameras

    def get_camera_by_id(self, camera_id: str) -> Optional[IowaCameraInfo]:
        """Look up a single Iowa camera by its ID.

        If the in-memory cache is empty (e.g. called before preload), attempts
        to load from the local file cache before giving up.
        """
        if not self._cache.cameras and self._is_local_cache_fresh():
            cameras = self._load_local_cache()
            if cameras:
                self._cache.cameras = cameras
                self._cache.last_fetched = time.time()

        for cam in self._cache.cameras:
            if cam.id == camera_id:
                return cam
        return None

    def fetch_snapshot_bytes(self, snapshot_url: str) -> Optional[bytes]:
        """Fetch raw JPEG bytes from an Iowa DOT camera snapshot URL.

        Used by the monitor service when running Iowa cameras in snapshot mode.
        Returns raw bytes or ``None`` on failure.
        """
        try:
            resp = requests.get(
                snapshot_url,
                timeout=IOWA_FETCH_TIMEOUT,
                allow_redirects=True,
            )
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "image" not in content_type and len(resp.content) < 500:
                logger.warning("Iowa snapshot doesn't look like an image: %s", content_type)
                return None
            return resp.content
        except requests.RequestException as e:
            logger.warning("Iowa snapshot fetch failed (%s): %s", snapshot_url, e)
            return None

    def get_regions(self) -> list[str]:
        """Return distinct Iowa regions (equivalent of districts)."""
        seen: set[str] = set()
        regions = []
        for cam in self._cache.cameras:
            if cam.region not in seen:
                seen.add(cam.region)
                regions.append(cam.region)
        return sorted(regions)

    def preload(self) -> None:
        """Pre-load Iowa camera data on startup."""
        logger.info("Iowa cameras: pre-loading...")
        cameras = self.fetch_cameras()
        logger.info("Iowa cameras: pre-loaded %d cameras", len(cameras))


# Module-level singleton
iowa_camera_service = IowaCameraService()
