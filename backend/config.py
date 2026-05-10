import hashlib
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

def hash_password(password: str) -> str:
    """Return the SHA-256 hex digest of a plaintext password."""
    return hashlib.sha256(password.encode()).hexdigest()


# Store a SHA-256 hash of the password in memory so raw string comparisons
# are avoided at login time and the plaintext isn't retained beyond startup.
APP_PASSWORD_HASH: str | None = hash_password(_raw_password) if _raw_password else None
