import asyncio
import secrets
import time
from fastapi import Request, HTTPException

from backend.config import APP_PASSWORD
from backend.database import get_db

SESSION_COOKIE = "tf_session"
SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 days


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


async def create_session() -> str:
    token = secrets.token_hex(32)
    expires_at = time.time() + SESSION_TTL_SECONDS
    db = get_db()
    await db.execute(
        "INSERT INTO sessions (token, expires_at) VALUES (?, ?)", (token, expires_at)
    )
    await db.commit()
    return token


async def validate_session(token: str | None) -> bool:
    if not token:
        return False
    db = get_db()
    cursor = await db.execute(
        "SELECT expires_at FROM sessions WHERE token = ?", (token,)
    )
    row = await cursor.fetchone()
    if row is None:
        return False
    if time.time() > row[0]:
        await db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        await db.commit()
        return False
    return True


async def delete_session(token: str | None) -> None:
    if not token:
        return
    db = get_db()
    await db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    await db.commit()


async def require_auth(request: Request) -> None:
    """Raises 401 if auth is enabled and request has no valid session."""
    if not APP_PASSWORD:
        return  # Auth disabled
    token = request.cookies.get(SESSION_COOKIE)
    if not await validate_session(token):
        raise HTTPException(status_code=401, detail="Unauthorized")
