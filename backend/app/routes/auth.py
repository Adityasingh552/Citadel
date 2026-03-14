"""Auth routes — admin login endpoint."""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.auth import verify_password, create_access_token, hash_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Hash the admin password once at module level for fast comparison.
# We re-hash on every import so env changes take effect on restart.
_admin_hash: str | None = None


def _get_admin_hash() -> str:
    """Lazy-init the bcrypt hash of the configured admin password."""
    global _admin_hash
    if _admin_hash is None:
        settings = get_settings()
        _admin_hash = hash_password(settings.admin_password)
    return _admin_hash


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    """Authenticate with admin credentials and receive a JWT."""
    settings = get_settings()

    if body.username != settings.admin_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not verify_password(body.password, _get_admin_hash()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token(data={"sub": settings.admin_username})
    logger.info("Admin login successful")
    return TokenResponse(access_token=token)
