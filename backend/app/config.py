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

    # Detection toggles
    detect_accidents: bool = True
    detect_vehicles: bool = True

    # Processing
    frame_interval: int = 30  # Process every Nth frame

    # Auth — all required, no defaults
    admin_username: str
    admin_password: str
    jwt_secret: str
    jwt_expiry_hours: int = 24

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
