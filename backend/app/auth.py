"""Authentication utilities — Supabase token verification."""

import logging
import threading
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from supabase import create_client, Client

from app.config import get_settings

logger = logging.getLogger(__name__)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

_TOKEN_CACHE_TTL_SECONDS = 60.0
_TOKEN_CACHE_MAX_SIZE = 2048

_supabase_admin_client: Client | None = None
_supabase_client_lock = threading.Lock()

_token_cache: dict[str, tuple[str, float]] = {}
_token_cache_lock = threading.Lock()

_token_validation_locks: dict[str, threading.Lock] = {}
_token_validation_locks_lock = threading.Lock()


def _get_validation_lock(token: str) -> threading.Lock:
    """Return a per-token lock to dedupe concurrent remote validations."""
    with _token_validation_locks_lock:
        lock = _token_validation_locks.get(token)
        if lock is None:
            lock = threading.Lock()
            _token_validation_locks[token] = lock
        return lock


def _prune_cache(now: float) -> None:
    """Drop expired entries and cap cache size."""
    expired_tokens = [token for token, (_, expiry) in _token_cache.items() if expiry <= now]
    for token in expired_tokens:
        _token_cache.pop(token, None)

    if len(_token_cache) <= _TOKEN_CACHE_MAX_SIZE:
        return

    # Remove entries with the shortest remaining TTL first.
    for token, _ in sorted(_token_cache.items(), key=lambda item: item[1][1])[: len(_token_cache) - _TOKEN_CACHE_MAX_SIZE]:
        _token_cache.pop(token, None)


def _get_supabase_admin() -> Client:
    """Get singleton Supabase admin client."""
    global _supabase_admin_client
    if _supabase_admin_client is None:
        with _supabase_client_lock:
            if _supabase_admin_client is None:
                settings = get_settings()
                _supabase_admin_client = create_client(
                    settings.supabase_url,
                    settings.supabase_secret_key,
                )
    return _supabase_admin_client


def get_supabase_admin_client() -> Client:
    """Shared Supabase admin client accessor for auth routes/dependencies."""
    return _get_supabase_admin()


def get_current_admin(token: str = Depends(oauth2_scheme)) -> str:
    """FastAPI dependency — validates Supabase JWT and returns the user email.

    Raises 401 if the token is missing, expired, or invalid.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    now = time.monotonic()
    with _token_cache_lock:
        cached = _token_cache.get(token)
        if cached and cached[1] > now:
            return cached[0]
        if cached:
            _token_cache.pop(token, None)

    validation_lock = _get_validation_lock(token)
    with validation_lock:
        # Double-check cache after acquiring token-specific lock so concurrent
        # requests can reuse the first validation result.
        now = time.monotonic()
        with _token_cache_lock:
            cached = _token_cache.get(token)
            if cached and cached[1] > now:
                return cached[0]
            if cached:
                _token_cache.pop(token, None)

        supabase = _get_supabase_admin()

        try:
            user = supabase.auth.get_user(token)
            if not user or not user.user or not user.user.email:
                raise credentials_exception
            email = user.user.email
        except Exception:
            raise credentials_exception

        with _token_cache_lock:
            _prune_cache(now)
            _token_cache[token] = (email, now + _TOKEN_CACHE_TTL_SECONDS)

        return email
