import logging
import os
import httpx
from backend.config import IMMICH_BASE_URL, IMMICH_API_KEY

_client: httpx.AsyncClient | None = None
logger = logging.getLogger(__name__)

# Get page size from environment or use default
IMMICH_PAGE_SIZE = int(os.environ.get('IMMICH_PAGE_SIZE', '100'))


async def close():
    global _client
    if _client is not None:
        logger.debug("Closing Immich HTTP client")
        await _client.aclose()
        _client = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=IMMICH_BASE_URL,
            headers={"x-api-key": IMMICH_API_KEY},
            timeout=30.0,
        )
    return _client


async def get_assets(page: int = 1, page_size: int = IMMICH_PAGE_SIZE) -> dict:
    logger.debug(f"Fetching assets from Immich - page: {page}, page_size: {page_size}")
    client = _get_client()
    try:
        response = await client.post(
            "/search/metadata",
            json={
                "page": page,
                "size": page_size,
                "type": "IMAGE",
                "order": "desc",
            },
        )
        response.raise_for_status()
        logger.debug(f"Successfully fetched {len(response.json().get('assets', {}).get('items', []))} assets")
        return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch assets from Immich: {e}", exc_info=True)
        raise


async def get_asset(asset_id: str) -> dict:
    client = _get_client()
    response = await client.get(f"/assets/{asset_id}")
    response.raise_for_status()
    return response.json()


async def get_asset_thumbnail(asset_id: str) -> tuple[bytes, str]:
    client = _get_client()
    response = await client.get(f"/assets/{asset_id}/thumbnail")
    response.raise_for_status()
    content_type = response.headers.get("content-type", "image/jpeg")
    return response.content, content_type


async def get_asset_preview(asset_id: str) -> tuple[bytes, str]:
    client = _get_client()
    response = await client.get(f"/assets/{asset_id}/thumbnail", params={"size": "preview"})
    response.raise_for_status()
    content_type = response.headers.get("content-type", "image/jpeg")
    return response.content, content_type


async def get_asset_original(asset_id: str) -> tuple[bytes, str]:
    client = _get_client()
    response = await client.get(f"/assets/{asset_id}/original")
    response.raise_for_status()
    content_type = response.headers.get("content-type", "image/jpeg")
    return response.content, content_type
