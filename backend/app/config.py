"""Citadel backend configuration via environment variables."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    database_url: str = "sqlite:///./citadel.db"
    model_name: str = "gopesh353/traffic-accident-detection-detr"
    confidence_threshold: float = 0.7
    evidence_dir: str = "./evidence"
    uploads_dir: str = "./uploads"
    data_dir: str = "./data"  # Local cache for Caltrans CSV files

    # Detection toggles
    detect_accidents: bool = True
    detect_vehicles: bool = True

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

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
