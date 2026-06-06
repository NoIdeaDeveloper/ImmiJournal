import asyncio
import logging
import os
import time
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import httpx
from backend.database import open_db, close_db, init_db, get_db
from backend.routes import journal, immich_proxy, settings
from backend.routes import auth as auth_routes
from backend import immich_client
from backend.auth import require_auth, schedule_session_pruning, invalidate_sessions_if_password_changed
from backend.routes.immich_proxy import schedule_cache_cleanup, get_cache_size_mb
from backend.config import APP_PASSWORD, DATABASE_PATH, _init_config
from backend.backup import schedule_daily_backups, list_backups

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)


class CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
            filename = path.split('/')[-1]
            if filename.endswith(('.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.woff', '.woff2')):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        except Exception as e:
            logger.error(f"Failed to serve static file {path}: {e}", exc_info=True)
            raise


uvicorn_logger = logging.getLogger("uvicorn")
uvicorn_logger.setLevel(logging.INFO)
uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application starting up...")
    _init_config()
    logger.debug("Opening database connection...")
    await open_db()
    logger.debug("Initializing database schema...")
    await init_db()
    logger.info("Database initialized successfully")
    await invalidate_sessions_if_password_changed()
    backup_task = asyncio.create_task(schedule_daily_backups())
    session_prune_task = asyncio.create_task(schedule_session_pruning())
    cache_cleanup_task = asyncio.create_task(schedule_cache_cleanup())
    yield
    backup_task.cancel()
    session_prune_task.cancel()
    cache_cleanup_task.cancel()
    logger.info("Application shutting down...")
    await close_db()
    await immich_client.close()
    logger.info("Shutdown complete")


# Expose /docs and /redoc only when DEBUG=true; they are auth-bypassed below.
_DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
app = FastAPI(
    title="ImmiJournal",
    lifespan=lifespan,
    docs_url="/docs" if _DEBUG else None,
    redoc_url="/redoc" if _DEBUG else None,
)

# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------
UNPROTECTED_PREFIXES = ("/api/auth/", "/api/health", "/docs", "/redoc", "/openapi.json")

MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Simple per-IP rate limiter for write endpoints: 60 requests per 60 seconds.
_write_rate: dict[str, list[float]] = defaultdict(list)
_write_rate_order: list[str] = []  # Tracks insertion order for LRU eviction
_WRITE_RATE_WINDOW = 60
_WRITE_RATE_MAX = 60
_WRITE_RATE_MAX_KEYS = 10000


def _check_write_rate(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _write_rate[ip] if now - t < _WRITE_RATE_WINDOW]
    if recent:
        _write_rate[ip] = recent
    else:
        _write_rate.pop(ip, None)
        if ip in _write_rate_order:
            _write_rate_order.remove(ip)
    if len(recent) >= _WRITE_RATE_MAX:
        return False
    is_new = ip not in _write_rate
    _write_rate[ip] = recent + [now]
    if is_new:
        _write_rate_order.append(ip)
    # Evict least-recently-used entry if dict grows too large
    if len(_write_rate) > _WRITE_RATE_MAX_KEYS:
        oldest_key = _write_rate_order.pop(0)
        _write_rate.pop(oldest_key, None)
    return True


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Reject oversized request bodies (10 MB limit)
    max_body_size = 10 * 1024 * 1024  # 10 MB
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > max_body_size:
        return JSONResponse(
            status_code=413,
            content={"detail": "Request body too large"},
        )

    # Rate-limit write endpoints before auth check
    if request.method in MUTATION_METHODS and path.startswith("/api/"):
        ip = request.client.host if request.client else "unknown"
        if not _check_write_rate(ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
            )

    if APP_PASSWORD and path.startswith("/api/"):
        if not any(path.startswith(p) for p in UNPROTECTED_PREFIXES):
            try:
                await require_auth(request)
            except HTTPException:
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
            except Exception as e:
                logger.error(f"Unexpected auth error: {e}", exc_info=True)
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    response = await call_next(request)

    # Add Cache-Control: no-store to mutable API responses so browsers never
    # serve stale data from cache.
    if path.startswith("/api/") and not path.startswith("/api/immich/assets/"):
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"

    # Content-Security-Policy — restrict resource loading to same origin.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    return response


app.include_router(auth_routes.router, prefix="/api")
app.include_router(immich_proxy.router, prefix="/api/immich")
app.include_router(journal.router, prefix="/api/journal")
app.include_router(settings.router, prefix="/api")

_health_cache: dict = {}
_HEALTH_CACHE_TTL = 60


@app.get("/api/health")
async def health_check(full: bool = False, request: Request = None):
    logger.info("Health check endpoint called")

    now = time.time()
    cached = _health_cache.get("data")
    # Only serve cached result if it is healthy — unhealthy results are rechecked immediately
    if cached and cached.get("healthy") and not full and (now - _health_cache.get("ts", 0)) < _HEALTH_CACHE_TTL:
        return cached

    # Check if request is authenticated
    is_authenticated = False
    if request:
        from backend.auth import validate_session, SESSION_COOKIE
        token = request.cookies.get(SESSION_COOKIE)
        is_authenticated = await validate_session(token) if token else False

    status: dict = {"database": "ok"}
    details: dict = {}

    try:
        db = get_db()
        await db.execute("SELECT 1")
        # Only expose details to authenticated requests
        if is_authenticated:
            cursor = await db.execute("SELECT COUNT(*) as cnt FROM journal_entries")
            row = await cursor.fetchone()
            details["entry_count"] = row["cnt"]
            cursor = await db.execute("SELECT COUNT(*) as cnt FROM sessions WHERE expires_at > ?", (time.time(),))
            row = await cursor.fetchone()
            details["active_sessions"] = row["cnt"]
            if os.path.exists(DATABASE_PATH):
                details["db_size_bytes"] = os.path.getsize(DATABASE_PATH)
    except Exception as e:
        status["database"] = f"error: {e}"
        logger.error(f"Database health check failed: {e}", exc_info=True)

    if full and is_authenticated:
        status["immich"] = "ok"
        try:
            t0 = time.monotonic()
            await immich_client.get_assets(page=1, page_size=1)
            details["immich_latency_ms"] = round((time.monotonic() - t0) * 1000)
        except httpx.ConnectError:
            status["immich"] = "error: cannot reach Immich server"
            logger.error("Immich health check failed: cannot reach Immich server")
        except Exception as e:
            status["immich"] = f"error: {e}"
            logger.error(f"Immich health check failed: {e}")

    if is_authenticated:
        details["backup_count"] = len(list_backups())
        details["cache_size_mb"] = round(get_cache_size_mb(), 1)

    healthy = all(v == "ok" for v in status.values())
    result = {"healthy": healthy, **status, **details}

    if healthy:
        _health_cache["data"] = result
        _health_cache["ts"] = now

    return result


app.mount(
    "/static",
    CachedStaticFiles(directory="frontend", html=True),
    name="static"
)


@app.get("/")
async def serve_index():
    return FileResponse(
        "frontend/index.html",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    )


@app.get("/login")
async def serve_login():
    return FileResponse(
        "frontend/login.html",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    )
