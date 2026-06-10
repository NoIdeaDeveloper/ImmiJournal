import logging
import os
import httpx
from backend.config import IMMICH_BASE_URL, IMMICH_API_KEY

_client: httpx.AsyncClient | None = None
logger = logging.getLogger(__name__)

_DEFAULT_PAGE_SIZE = 100


def _get_page_size() -> int:
    return int(os.environ.get('IMMICH_PAGE_SIZE', str(_DEFAULT_PAGE_SIZE)))


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


async def get_assets(page: int = 1, page_size: int | None = None, query: str | None = None) -> dict:
    if page_size is None:
        page_size = _get_page_size()
    logger.debug(f"Fetching assets from Immich - page: {page}, page_size: {page_size}, query: {query}")
    client = _get_client()
    try:
        if query:
            # Free-text queries use Immich's smart/CLIP search endpoint
            payload = {
                "query": query,
                "page": page,
                "size": page_size,
                "type": "IMAGE",
            }
            response = await client.post("/search/smart", json=payload)
        else:
            payload = {
                "page": page,
                "size": page_size,
                "type": "IMAGE",
                "order": "desc",
            }
            response = await client.post("/search/metadata", json=payload)
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
    """Fetch a high-quality preview image. Uses the dedicated /preview endpoint
    introduced in Immich v1.92+; falls back to thumbnail with size=preview for
    older server versions."""
    client = _get_client()
    response = await client.get(f"/assets/{asset_id}/preview")
    if response.status_code == 404:
        # Older Immich versions — fall back to thumbnail endpoint with size param
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


async def stream_asset_original(asset_id: str):
    """Yield (chunk, content_type) tuples for streaming an original asset.
    The first yield contains only the content-type; subsequent yields are byte chunks."""
    client = _get_client()
    async with client.stream("GET", f"/assets/{asset_id}/original") as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg")
        yield b"", content_type
        async for chunk in response.aiter_bytes(chunk_size=65536):
            if chunk:
                yield chunk, content_type


async def get_albums(page: int = 1, page_size: int | None = None) -> dict:
    if page_size is None:
        page_size = _get_page_size()
    client = _get_client()
    response = await client.get("/albums", params={"page": page, "size": page_size})
    response.raise_for_status()
    return response.json()


async def get_album_assets(album_id: str) -> dict:
    client = _get_client()
    response = await client.get(f"/albums/{album_id}")
    response.raise_for_status()
    return response.json()
