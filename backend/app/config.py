"""Citadel backend configuration via environment variables."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    database_url: str = "sqlite:///./citadel.db"
    
    # Heroku provides DATABASE_URL for Postgres; we need to handle both
    # For Postgres on Heroku, the URL starts with postgres:// but SQLAlchemy needs postgresql://
    @property
    def effective_database_url(self) -> str:
        """Return database URL with Heroku postgres:// fix."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return url
    model_path: str = "./models/model.onnx"  # Path to YOLO26 ONNX model file
    model_url: str = "https://huggingface.co/gopesh353/citadel/resolve/main/exp-2.onnx"  # Auto-download URL
    confidence_threshold_manual: float = 0.7
    confidence_threshold_cctv: float = 0.7
    evidence_dir: str = "./evidence"
    uploads_dir: str = "./uploads"
    data_dir: str = "./data"  # Local cache for Caltrans CSV files
    citadel_base_url: str = "http://localhost:8000"  # Base URL for public links (e.g. for Telegram)

    # Detection toggles
    detect_accidents: bool = True

    # Processing
    # Auth — all required, no defaults
    admin_username: str
    admin_password: str
    jwt_secret: str
    jwt_expiry_hours: int = 24

    # Twilio — emergency voice calls
    twilio_enabled_manual: bool = False   # trigger calls for manual upload detections
    twilio_enabled_cctv: bool = False     # trigger calls for live CCTV detections
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""          # US E.164 e.g. +12015551234
    emergency_contact_number: str = ""   # Indian E.164 e.g. +919876543210
    twilio_call_cooldown_seconds: int = 300  # minimum gap between calls (default: 5 min)

    # Camera list cache — how many hours before the on-disk camera list is
    # considered stale and a fresh network fetch is triggered.
    # Applies to both Iowa DOT (ArcGIS) and Caltrans (CSV) camera lists.
    # Default: 24 hours.  Set to 0 to always refetch on startup.
    camera_list_cache_ttl_hours: float = 24.0

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
