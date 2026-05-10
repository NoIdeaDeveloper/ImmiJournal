import os
import tempfile
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
import httpx
import logging
import time
import asyncio
from pathlib import Path

from backend import immich_client
from backend.config import IMMICH_BASE_URL

router = APIRouter()
logger = logging.getLogger(__name__)

# Cache configuration — directory is configurable via CACHE_DIR env var
CACHE_DIR = os.environ.get("CACHE_DIR", os.path.join(tempfile.gettempdir(), "immijournal_cache"))
CACHE_SIZE_LIMIT_MB = 500  # 500MB cache limit
CACHE_TTL_SECONDS = 86400  # 24 hours

# Ensure cache directory exists
Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)

# Lock to prevent concurrent cache cleanup runs
_cache_cleanup_lock = asyncio.Lock()

# In-memory size tracking: {path_str: size_bytes}. Updated on every write/eviction
# so get_cache_size_mb() is O(1) without needing a directory scan.
_cache_file_sizes: dict[str, int] = {}
_cache_size_mb: float = 0.0


def _raise_immich_error(e: Exception) -> None:
    """Re-raise httpx connectivity/status errors as FastAPI HTTPExceptions."""
    if isinstance(e, httpx.ConnectError):
        raise HTTPException(status_code=502, detail="Cannot reach Immich server. Check IMMICH_BASE_URL.")
    if isinstance(e, httpx.HTTPStatusError):
        raise HTTPException(status_code=e.response.status_code,
                            detail=f"Immich returned {e.response.status_code}")
    raise e


async def schedule_cache_cleanup():
    """Background task: run cache cleanup every hour."""
    while True:
        await asyncio.sleep(3600)
        async with _cache_cleanup_lock:
            await asyncio.to_thread(cleanup_cache_if_needed)


def get_cache_size_mb() -> float:
    """Return the current cache size in MB (O(1), maintained by write/eviction tracking)."""
    return _cache_size_mb


def _track_cache_write(path: Path, size: int) -> None:
    global _cache_size_mb
    old = _cache_file_sizes.get(str(path), 0)
    _cache_file_sizes[str(path)] = size
    _cache_size_mb += (size - old) / (1024 * 1024)


def _track_cache_delete(path: Path) -> None:
    global _cache_size_mb
    removed = _cache_file_sizes.pop(str(path), 0)
    _cache_size_mb = max(0.0, _cache_size_mb - removed / (1024 * 1024))


def get_cache_path(asset_id: str, variant: str) -> Path:
    """Return the cache path for a given asset and variant (thumb/preview/original)."""
    safe_asset_id = Path(asset_id).name
    safe_variant = Path(variant).name
    return Path(CACHE_DIR) / f"{safe_asset_id}_{safe_variant}"


def cleanup_cache_if_needed():
    """Remove oldest cache files if the cache directory exceeds the size limit."""
    global _cache_size_mb
    try:
        # Full scan to reconcile in-memory tracker with disk (handles external changes)
        total_size = 0
        cache_files = []
        _cache_file_sizes.clear()

        for file in Path(CACHE_DIR).iterdir():
            try:
                stat = file.stat()
                total_size += stat.st_size
                cache_files.append((file, stat.st_mtime, stat.st_size))
                _cache_file_sizes[str(file)] = stat.st_size
            except Exception as e:
                logger.warning(f"Failed to stat cache file {file}: {e}")
                continue

        _cache_size_mb = total_size / (1024 * 1024)

        if _cache_size_mb > CACHE_SIZE_LIMIT_MB:
            logger.warning(f"Cache size {_cache_size_mb:.1f}MB exceeds limit, cleaning up")
            cache_files.sort(key=lambda x: x[1])  # oldest first

            for file, _, file_size in cache_files:
                try:
                    file.unlink()
                    _track_cache_delete(file)
                    if _cache_size_mb <= CACHE_SIZE_LIMIT_MB * 0.9:
                        break
                except Exception as e:
                    logger.warning(f"Failed to delete cache file {file}: {e}")
                    continue

            logger.info(f"Cache cleaned. New size: {_cache_size_mb:.1f}MB")

    except Exception as e:
        logger.error(f"Cache cleanup failed: {e}", exc_info=True)


def _content_type_path(cache_path: Path) -> Path:
    """Return the sidecar path used to persist the content-type alongside cached bytes."""
    return cache_path.with_suffix(cache_path.suffix + ".ct")


async def get_cached_image(asset_id: str, variant: str, fetcher) -> tuple[bytes, str]:
    """
    Return image bytes + content-type for an asset variant, using a disk cache.
    `fetcher` is a coroutine that fetches (bytes, content_type) from Immich when needed.
    The real content-type is stored in a sidecar file so cache hits return the correct type.
    """
    cache_path = get_cache_path(asset_id, variant)
    ct_path = _content_type_path(cache_path)

    # Serve from cache if fresh
    if cache_path.exists():
        cache_age = time.time() - cache_path.stat().st_mtime
        if cache_age < CACHE_TTL_SECONDS:
            logger.debug(f"Cache hit for {asset_id}/{variant} (age {cache_age:.0f}s)")
            try:
                content_type = ct_path.read_text().strip() if ct_path.exists() else _fallback_content_type(variant)
                return cache_path.read_bytes(), content_type
            except Exception as e:
                logger.warning(f"Cache read failed for {asset_id}/{variant}: {e}")

    # Fetch from Immich
    try:
        image_bytes, content_type = await fetcher()
    except (httpx.ConnectError, httpx.HTTPStatusError) as e:
        _raise_immich_error(e)

    try:
        cache_path.write_bytes(image_bytes)
        ct_path.write_text(content_type)
        _track_cache_write(cache_path, len(image_bytes))
        _track_cache_write(ct_path, len(content_type.encode()))
    except Exception as e:
        logger.warning(f"Failed to write cache for {asset_id}/{variant}: {e}")

    return image_bytes, content_type


def _fallback_content_type(variant: str) -> str:
    """Fallback content-type when no sidecar file exists."""
    if variant in ("thumb", "preview"):
        return "image/jpeg"
    return "application/octet-stream"


@router.get("/assets/config")
async def get_config():
    """Return the Immich web URL for deep-linking to assets."""
    # IMMICH_BASE_URL ends with /api (e.g. http://host:2283/api); strip it for the web URL
    web_url = IMMICH_BASE_URL.rstrip("/")
    if web_url.endswith("/api"):
        web_url = web_url[:-4]
    return {"immich_web_url": web_url}


@router.get("/assets")
async def list_assets(page: int = 1, page_size: int = 50):
    page_size = min(page_size, 1000)
    try:
        data = await immich_client.get_assets(page, page_size)

        # Log a warning if Immich omits total (frontend handles this gracefully via page-size fallback)
        if data and "assets" in data and "items" in data["assets"]:
            if "total" not in data["assets"] or data["assets"]["total"] is None:
                logger.warning("Immich didn't provide total count; frontend will use page-size fallback")

        return data
    except (httpx.ConnectError, httpx.HTTPStatusError) as e:
        _raise_immich_error(e)


@router.get("/assets/{asset_id}")
async def get_asset_detail(asset_id: str):
    try:
        return await immich_client.get_asset(asset_id)
    except (httpx.ConnectError, httpx.HTTPStatusError) as e:
        _raise_immich_error(e)


async def _image_response(asset_id: str, variant: str, fetcher) -> Response:
    image_bytes, content_type = await get_cached_image(asset_id, variant, fetcher)
    return Response(
        content=image_bytes,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/assets/{asset_id}/thumbnail")
async def get_thumbnail(asset_id: str):
    return await _image_response(asset_id, "thumb", lambda: immich_client.get_asset_thumbnail(asset_id))


@router.get("/assets/{asset_id}/preview")
async def get_preview(asset_id: str):
    """Returns Immich's high-quality preview; browser-compatible JPEG for HEIC/DNG/RAW."""
    return await _image_response(asset_id, "preview", lambda: immich_client.get_asset_preview(asset_id))


@router.get("/assets/{asset_id}/original")
async def get_original(asset_id: str):
    """Returns the raw original file. Use /preview for display — may be an unsupported browser format."""
    return await _image_response(asset_id, "original", lambda: immich_client.get_asset_original(asset_id))
