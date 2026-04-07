"""Auth routes — Supabase session exchange endpoints."""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import get_supabase_admin_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    expires_in: int


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    """Authenticate with Supabase and return the session tokens."""
    supabase = get_supabase_admin_client()

    try:
        response = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
    except Exception as e:
        logger.warning("Login failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not response.session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    logger.info("Admin login successful: %s", response.user.email)
    return TokenResponse(
        access_token=response.session.access_token,
        refresh_token=response.session.refresh_token,
        user_id=response.user.id,
        expires_in=response.session.expires_in,
    )
