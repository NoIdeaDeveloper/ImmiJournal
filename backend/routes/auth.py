import hmac
import time
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Response, Request
from pydantic import BaseModel

from backend.config import APP_PASSWORD, SECURE_COOKIES
from backend.auth import SESSION_COOKIE, SESSION_TTL_SECONDS, create_session, delete_session

router = APIRouter()

# Rate limiting: track failed attempts per IP {ip: [timestamp, ...]}
_failed_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX = 5  # max attempts per window


def _check_rate_limit(ip: str) -> None:
    now = time.time()
    attempts = _failed_attempts[ip]
    # Prune attempts outside the window; remove key entirely when empty
    recent = [t for t in attempts if now - t < _RATE_LIMIT_WINDOW]
    if recent:
        _failed_attempts[ip] = recent
    else:
        _failed_attempts.pop(ip, None)
    if len(recent) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please wait a minute and try again.",
        )


class LoginRequest(BaseModel):
    password: str


@router.post("/auth/login")
async def login(body: LoginRequest, response: Response, request: Request):
    if not APP_PASSWORD:
        return {"ok": True}  # Auth disabled — always succeed
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)
    if not hmac.compare_digest(body.password, APP_PASSWORD):
        _failed_attempts[ip].append(time.time())
        raise HTTPException(status_code=401, detail="Incorrect password")
    # Clear failed attempts on successful login
    _failed_attempts.pop(ip, None)
    token = await create_session()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="strict",
        secure=SECURE_COOKIES,
        path="/",
    )
    return {"ok": True}


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    await delete_session(token)
    response.delete_cookie(key=SESSION_COOKIE, path="/", samesite="strict", secure=SECURE_COOKIES)
    return {"ok": True}
