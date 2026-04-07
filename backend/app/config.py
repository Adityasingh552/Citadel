"""Citadel backend configuration via environment variables."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    database_url: str

    model_path: str = "./models/model.onnx"
    model_url: str = "https://huggingface.co/gopesh353/citadel/resolve/main/exp-2.onnx"
    confidence_threshold_manual: float = 0.7
    confidence_threshold_cctv: float = 0.7
    evidence_dir: str = "./evidence"
    uploads_dir: str = "./uploads"
    data_dir: str = "./data"
    citadel_base_url: str = "http://localhost:8000"

    # Detection toggles
    detect_accidents: bool = True

    # Supabase
    supabase_url: str
    supabase_publishable_key: str
    supabase_secret_key: str

    # Twilio
    twilio_enabled_manual: bool = False
    twilio_enabled_cctv: bool = False
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    emergency_contact_number: str = ""
    twilio_call_cooldown_seconds: int = 300

    # Camera list cache
    camera_list_cache_ttl_hours: float = 24.0

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
