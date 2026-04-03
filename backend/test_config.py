from app.config import get_settings
settings = get_settings()
print(f"CITADEL_BASE_URL: '{settings.citadel_base_url}'")
