import asyncio
import hashlib
import secrets
import time
from fastapi import Request, HTTPException

from backend.config import APP_PASSWORD, APP_PASSWORD_HASH
from backend.database import get_db

SESSION_COOKIE = "immijournal_session"
SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 days


async def invalidate_sessions_if_password_changed() -> None:
    """At startup, clear all sessions if APP_PASSWORD has changed since last run.

    The current password hash is stored in the settings table under the key
    'password_hash'. If it differs from APP_PASSWORD_HASH, all sessions are
    deleted and the stored hash is updated.
    """
    if not APP_PASSWORD_HASH:
        return  # Auth disabled — nothing to invalidate
    db = get_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key = 'password_hash'")
    row = await cursor.fetchone()
    stored_hash = row["value"] if row else None
    if stored_hash != APP_PASSWORD_HASH:
        await db.execute("DELETE FROM sessions")
        await db.execute(
            "INSERT INTO settings (key, value) VALUES ('password_hash', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (APP_PASSWORD_HASH,),
        )
        await db.commit()
        if stored_hash is not None:
            import logging
            logging.getLogger(__name__).info(
                "APP_PASSWORD changed — all existing sessions have been invalidated."
            )


async def _prune_expired_sessions() -> None:
    db = get_db()
    await db.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
    await db.commit()


async def schedule_session_pruning():
    """Background task: prune expired sessions hourly."""
    while True:
        try:
            await asyncio.sleep(3600)
            await _prune_expired_sessions()
        except asyncio.CancelledError:
            raise


def _hash_token(token: str) -> str:
    """Return the SHA-256 hex digest of a session token for safe DB storage."""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session() -> str:
    token = secrets.token_hex(32)
    token_hash = _hash_token(token)
    expires_at = time.time() + SESSION_TTL_SECONDS
    db = get_db()
    await db.execute(
        "INSERT INTO sessions (token, expires_at) VALUES (?, ?)", (token_hash, expires_at)
    )
    await db.commit()
    return token  # Return the raw token to the caller (set as cookie); hash is stored in DB


async def validate_session(token: str | None) -> bool:
    if not token:
        return False
    token_hash = _hash_token(token)
    db = get_db()
    cursor = await db.execute(
        "SELECT expires_at FROM sessions WHERE token = ?", (token_hash,)
    )
    row = await cursor.fetchone()
    if row is None:
        return False
    if time.time() > row[0]:
        await db.execute("DELETE FROM sessions WHERE token = ?", (token_hash,))
        await db.commit()
        return False
    return True


async def delete_session(token: str | None) -> None:
    if not token:
        return
    token_hash = _hash_token(token)
    db = get_db()
    await db.execute("DELETE FROM sessions WHERE token = ?", (token_hash,))
    await db.commit()


async def require_auth(request: Request) -> None:
    """Raises 401 if auth is enabled and request has no valid session."""
    if not APP_PASSWORD:
        return  # Auth disabled
    token = request.cookies.get(SESSION_COOKIE)
    if not await validate_session(token):
        raise HTTPException(status_code=401, detail="Unauthorized")
