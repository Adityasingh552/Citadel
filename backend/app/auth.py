"""Authentication utilities — JWT token management and password verification."""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import hashlib
import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

logger = logging.getLogger(__name__)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _prepare_password(password: str) -> bytes:
    """Pre-hash password to bypass bcrypt's 72-byte limit."""
    return hashlib.sha256(password.encode('utf-8')).hexdigest().encode('utf-8')


def hash_password(password: str) -> str:
    """Hash a plaintext password."""
    pwd_bytes = _prepare_password(password)
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a hash."""
    pwd_bytes = _prepare_password(plain_password)
    try:
        return bcrypt.checkpw(pwd_bytes, hashed_password.encode('utf-8'))
    except ValueError:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a JWT access token."""
    settings = get_settings()
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=settings.jwt_expiry_hours)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm="HS256")


def get_current_admin(token: str = Depends(oauth2_scheme)) -> str:
    """FastAPI dependency — validates JWT and returns the admin username.

    Raises 401 if the token is missing, expired, or invalid.
    """
    settings = get_settings()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Verify the token subject matches the configured admin
    if username != settings.admin_username:
        raise credentials_exception

    return username
