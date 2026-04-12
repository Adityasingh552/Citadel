"""Camera service — Caltrans CCTV feed discovery, caching, and snapshot proxy."""

import csv
import io
import logging
import os
import shutil
import subprocess
import threading
import time
import hashlib
from dataclasses import dataclass, field
from typing import Optional

import requests
from PIL import Image

from app.config import get_settings

# Max consecutive ffmpeg restart attempts before giving up
STREAM_MAX_RETRIES = 5
# Initial back-off in seconds; doubles on each failure (capped at STREAM_MAX_BACKOFF)
STREAM_BACKOFF_INITIAL = 5
STREAM_MAX_BACKOFF = 300  # 5 minutes

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
SNAPSHOT_TIMEOUT = 10           # seconds
STARTUP_CACHE_ENABLED = True    # Pre-load cameras on startup


def _local_csv_ttl() -> float:
    """Return the on-disk CSV cache TTL in seconds, read from CAMERA_LIST_CACHE_TTL_HOURS."""
    return get_settings().camera_list_cache_ttl_hours * 3600


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


class StreamCapture:
    """Persistent HLS stream capture using a long-running ffmpeg process.

    Keeps a single ffmpeg process alive that reads the HLS stream and outputs
    raw RGB frames to stdout. A background reader thread continuously consumes
    frames and keeps only the latest one in memory, so ``get_latest_frame()``
    returns instantly without any network I/O.

    Lifecycle:
        capture = StreamCapture(stream_url, width, height)
        capture.start()          # spawns ffmpeg + reader thread
        frame = capture.get_latest_frame()  # PIL Image or None
        capture.stop()           # kills ffmpeg, joins reader thread
    """

    def __init__(self, stream_url: str, width: int = 0, height: int = 0):
        self._stream_url = stream_url
        self._width = width
        self._height = height
        self._process: Optional[subprocess.Popen] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._latest_frame: Optional[bytes] = None  # raw JPEG bytes
        self._frame_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._started = False
        self._error: Optional[str] = None
        self._retry_count: int = 0
        self._backoff: float = STREAM_BACKOFF_INITIAL

    @property
    def is_alive(self) -> bool:
        return (
            self._started
            and not self._stop_event.is_set()
            and self._process is not None
            and self._process.poll() is None
        )

    @property
    def error(self) -> Optional[str]:
        return self._error

    def start(self, reset_retry_state: bool = True) -> bool:
        """Start ffmpeg + reader thread. Returns True on success.

        Args:
            reset_retry_state: Reset retry/backoff counters (True for first start,
                False when restarting after a failed stream capture).
        """
        if self._started:
            return self.is_alive

        if not shutil.which("ffmpeg"):
            self._error = "ffmpeg not installed"
            logger.warning("StreamCapture: ffmpeg is not installed")
            return False

        process, start_error = self._start_ffmpeg_process()
        if not process:
            self._error = f"Failed to start ffmpeg: {start_error}"
            logger.error("StreamCapture: failed to start ffmpeg: %s", start_error)
            return False

        self._process = process

        self._stop_event.clear()
        self._started = True
        self._error = None
        if reset_retry_state:
            self._retry_count = 0
            self._backoff = STREAM_BACKOFF_INITIAL

        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            daemon=True,
            name=f"stream-reader-{id(self)}",
        )
        self._reader_thread.start()

        logger.info("StreamCapture: started persistent ffmpeg for %s", self._stream_url)
        return True

    def _start_ffmpeg_process(self) -> tuple[Optional[subprocess.Popen], str]:
        """Start ffmpeg with compatibility fallbacks for older versions."""
        attempts = [
            ("fps_mode", ["-fps_mode", "vfr"]),
            ("vsync", ["-vsync", "vfr"]),
            ("plain", []),
        ]

        for mode, mode_args in attempts:
            process, start_error = self._spawn_ffmpeg(mode_args)
            if process:
                if mode != "fps_mode":
                    logger.info("StreamCapture: using ffmpeg compatibility mode '%s'", mode)
                return process, ""

            if mode == "fps_mode" and self._is_unknown_option_error(start_error, "fps_mode"):
                logger.info("StreamCapture: ffmpeg does not support -fps_mode, falling back to -vsync")
                continue
            if mode == "vsync" and self._is_unknown_option_error(start_error, "vsync"):
                logger.info("StreamCapture: ffmpeg does not support -vsync, falling back to plain mode")
                continue

            return None, start_error

        return None, "ffmpeg exited immediately in all compatibility modes"

    def _spawn_ffmpeg(self, mode_args: list[str]) -> tuple[Optional[subprocess.Popen], str]:
        """Spawn ffmpeg once and verify it did not exit immediately."""
        try:
            cmd = [
                "ffmpeg",
                "-nostdin",
                "-y",
                "-loglevel", "error",
                "-i", self._stream_url,
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "-q:v", "5",  # quality (2=best, 31=worst); 5 is good for analysis
                *mode_args,
                "pipe:1",
            ]
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=10 * 1024 * 1024,  # 10MB buffer
            )
        except Exception as e:
            return None, str(e)

        # Invalid ffmpeg options fail immediately; detect that and surface stderr.
        time.sleep(0.2)
        if process.poll() is not None:
            stderr_bytes = b""
            if process.stderr:
                try:
                    stderr_bytes = process.stderr.read() or b""
                except Exception:
                    stderr_bytes = b""
            stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()
            if not stderr_text:
                stderr_text = f"ffmpeg exited immediately (rc={process.returncode})"
            return None, stderr_text[:2000]

        return process, ""

    @staticmethod
    def _is_unknown_option_error(stderr_text: str, option_name: str) -> bool:
        text = stderr_text.lower()
        option = option_name.lower()
        return (
            f"unrecognized option '{option}'" in text
            or f"option {option} not found" in text
            or f"unknown option '{option}'" in text
        )

    def _read_stderr_snippet(self, max_chars: int = 500) -> str:
        if not self._process or not self._process.stderr:
            return ""
        try:
            data = self._process.stderr.read() or b""
        except Exception:
            return ""
        if not data:
            return ""
        return data.decode("utf-8", errors="replace").strip()[:max_chars]

    def stop(self) -> None:
        """Stop the ffmpeg process and reader thread."""
        self._stop_event.set()
        self._started = False

        if self._process:
            try:
                self._process.kill()
                self._process.wait(timeout=5)
            except Exception:
                pass
            self._process = None

        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=5)
        self._reader_thread = None

        with self._frame_lock:
            self._latest_frame = None

        logger.info("StreamCapture: stopped for %s", self._stream_url)

    def get_latest_frame(self) -> Optional[Image.Image]:
        """Return the most recently captured frame as a PIL Image, or None."""
        with self._frame_lock:
            jpeg_bytes = self._latest_frame

        if not jpeg_bytes:
            return None

        try:
            return Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        except Exception as e:
            logger.warning("StreamCapture: failed to decode frame: %s", e)
            return None

    def _reader_loop(self) -> None:
        """Background thread: read JPEG frames from ffmpeg stdout.

        ffmpeg in image2pipe + mjpeg mode outputs a stream of concatenated
        JPEG images. Each JPEG starts with SOI marker (0xFFD8) and ends with
        EOI marker (0xFFD9). We accumulate bytes and split on these markers.
        """
        JPEG_SOI = b'\xff\xd8'
        JPEG_EOI = b'\xff\xd9'
        buf = bytearray()
        stdout = self._process.stdout

        while not self._stop_event.is_set():
            try:
                chunk = stdout.read(65536)  # 64KB chunks
                if not chunk:
                    # ffmpeg closed stdout — process probably died
                    if not self._stop_event.is_set():
                        rc = self._process.poll() if self._process else None
                        stderr_snippet = self._read_stderr_snippet()
                        self._error = f"ffmpeg process ended unexpectedly (rc={rc})"
                        if stderr_snippet:
                            logger.warning(
                                "StreamCapture: ffmpeg stdout closed unexpectedly (rc=%s): %s",
                                rc,
                                stderr_snippet,
                            )
                        else:
                            logger.warning("StreamCapture: ffmpeg stdout closed unexpectedly (rc=%s)", rc)
                    break

                buf.extend(chunk)

                # Extract the latest complete JPEG from the buffer
                while True:
                    soi = buf.find(JPEG_SOI)
                    if soi == -1:
                        buf.clear()
                        break

                    # Discard any garbage before SOI
                    if soi > 0:
                        del buf[:soi]
                        soi = 0

                    # Look for EOI after SOI
                    eoi = buf.find(JPEG_EOI, soi + 2)
                    if eoi == -1:
                        # Incomplete frame — wait for more data
                        break

                    # Complete JPEG: SOI to EOI+2
                    frame_end = eoi + 2
                    jpeg_data = bytes(buf[soi:frame_end])
                    del buf[:frame_end]

                    # Store as latest (overwrite previous — we only keep the newest)
                    if len(jpeg_data) > 1000:  # sanity check: valid JPEG is >1KB
                        with self._frame_lock:
                            self._latest_frame = jpeg_data

            except Exception as e:
                if not self._stop_event.is_set():
                    self._error = f"Reader error: {e}"
                    logger.warning("StreamCapture: reader error: %s", e)
                break

        logger.debug("StreamCapture: reader loop exited for %s", self._stream_url)


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
        self._ffmpeg_available: bool = self.check_ffmpeg()

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
        """Check if a local CSV file exists and is younger than the configured cache TTL."""
        try:
            ttl = _local_csv_ttl()
            if ttl <= 0:
                return False  # TTL=0 means always refetch
            mtime = os.path.getmtime(path)
            age = time.time() - mtime
            return age < ttl
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

    def grab_frame_from_stream(self, stream_url: str, timeout: int = 15) -> Optional[Image.Image]:
        """Grab a single frame from an HLS video stream using ffmpeg.

        Uses a subprocess to download one HLS segment and extract one frame.
        Returns a PIL Image (RGB) or None on failure.

        This is designed to be called periodically (every N seconds) for
        AI analysis of the live video stream. Each call is independent —
        no persistent connection is kept open.

        Args:
            stream_url: The full HLS .m3u8 URL.
            timeout: Maximum seconds to wait for ffmpeg to complete.
        """
        if not stream_url:
            return None

        if not self._ffmpeg_available:
            logger.warning("ffmpeg is not installed — cannot grab frames from HLS streams")
            return None

        try:
            # ffmpeg command:
            # -i <stream_url>  : input from HLS stream
            # -frames:v 1      : grab exactly 1 frame
            # -f image2pipe    : output as raw image data to stdout
            # -vcodec mjpeg    : encode as JPEG
            # pipe:1           : write to stdout
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",                    # overwrite
                    "-loglevel", "error",    # suppress verbose output
                    "-i", stream_url,
                    "-frames:v", "1",
                    "-f", "image2pipe",
                    "-vcodec", "mjpeg",
                    "pipe:1",
                ],
                capture_output=True,
                timeout=timeout,
            )

            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")[:500]
                logger.warning("ffmpeg frame grab failed (rc=%d): %s", result.returncode, stderr)
                return None

            if not result.stdout or len(result.stdout) < 1000:
                logger.warning("ffmpeg produced no/tiny output for stream: %s", stream_url)
                return None

            return Image.open(io.BytesIO(result.stdout)).convert("RGB")

        except subprocess.TimeoutExpired:
            logger.warning("ffmpeg frame grab timed out after %ds for: %s", timeout, stream_url)
            return None
        except Exception as e:
            logger.warning("ffmpeg frame grab error: %s", e)
            return None

    @staticmethod
    def check_ffmpeg() -> bool:
        """Check if ffmpeg is available on the system PATH."""
        return shutil.which("ffmpeg") is not None

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
