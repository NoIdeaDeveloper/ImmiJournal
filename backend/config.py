import hashlib
import hmac
import logging
import os

logger = logging.getLogger(__name__)


def _init_config():
    """Load and validate configuration from environment variables.

    Called once at app startup (not at module import time) so that tests can
    set env vars before importing this module without dotenv overriding them.
    """
    from dotenv import load_dotenv
    load_dotenv()

    required_vars = ["IMMICH_BASE_URL", "IMMICH_API_KEY"]
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    if missing_vars:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing_vars)}")

    immich_url = os.environ["IMMICH_BASE_URL"].rstrip("/")
    if not immich_url.startswith("http"):
        raise RuntimeError(
            f"IMMICH_BASE_URL must start with 'http' or 'https', got: {immich_url!r}"
        )

    password = os.environ.get("APP_PASSWORD")
    if password is not None and len(password.strip()) < 8:
        logger.warning(
            "APP_PASSWORD is shorter than 8 characters. Consider using a stronger password."
        )

    return immich_url, password


# Module-level constants populated on first import (dotenv not called here).
# Tests that need to override values should do so before importing this module
# or patch these directly.
_immich_url = os.environ.get("IMMICH_BASE_URL", "").rstrip("/")
_raw_password = os.environ.get("APP_PASSWORD")

IMMICH_BASE_URL: str = _immich_url
IMMICH_API_KEY: str = os.environ.get("IMMICH_API_KEY", "")
DATABASE_PATH: str = os.environ.get("DATABASE_PATH", "/data/immijournal.db")
APP_PASSWORD: str | None = _raw_password
SECURE_COOKIES: bool = os.environ.get("SECURE_COOKIES", "false").lower() == "true"

_PBKDF2_ITERATIONS = 600_000
_PBKDF2_SALT = b"immijournal-v1"  # fixed salt; security comes from PBKDF2 iteration count


def hash_password(password: str) -> str:
    """Return a PBKDF2-HMAC-SHA256 hex digest of the plaintext password."""
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), _PBKDF2_SALT, _PBKDF2_ITERATIONS
    ).hex()


def verify_password(password: str, hashed: str) -> bool:
    """Constant-time comparison of a plaintext password against a stored hash."""
    return hmac.compare_digest(hash_password(password), hashed)


# Hash the password at startup so the plaintext isn't retained beyond config load.
APP_PASSWORD_HASH: str | None = hash_password(_raw_password) if _raw_password else None
