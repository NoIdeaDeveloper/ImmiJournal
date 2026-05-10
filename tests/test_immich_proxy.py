import os
import pytest
import httpx
from unittest.mock import AsyncMock, patch


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    cache_dir = str(tmp_path / "immich_cache")
    os.makedirs(cache_dir, exist_ok=True)
    import backend.routes.immich_proxy as proxy
    monkeypatch.setattr(proxy, "CACHE_DIR", cache_dir)


async def test_config_endpoint(auth_client, monkeypatch):
    import backend.routes.immich_proxy as proxy
    monkeypatch.setattr(proxy, "IMMICH_BASE_URL", "http://immich.example.com/api")
    resp = await auth_client.get("/api/immich/assets/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "immich_web_url" in data
    assert data["immich_web_url"] == "http://immich.example.com"


async def test_list_assets(auth_client):
    mock_response = {"assets": {"items": [{"id": "abc"}], "total": 1}}
    with patch("backend.immich_client.get_assets", new=AsyncMock(return_value=mock_response)):
        resp = await auth_client.get("/api/immich/assets")
    assert resp.status_code == 200
    assert resp.json()["assets"]["items"][0]["id"] == "abc"


async def test_get_asset_detail(auth_client):
    mock_asset = {"id": "asset-123", "type": "IMAGE"}
    with patch("backend.immich_client.get_asset", new=AsyncMock(return_value=mock_asset)):
        resp = await auth_client.get("/api/immich/assets/asset-123")
    assert resp.status_code == 200
    assert resp.json()["id"] == "asset-123"


async def test_thumbnail_returns_bytes(auth_client):
    fake_bytes = b"\xff\xd8\xff" + b"\x00" * 100
    with patch(
        "backend.immich_client.get_asset_thumbnail",
        new=AsyncMock(return_value=(fake_bytes, "image/jpeg")),
    ):
        resp = await auth_client.get("/api/immich/assets/thumb-asset/thumbnail")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content == fake_bytes


async def test_thumbnail_served_from_cache_on_second_request(auth_client):
    fake_bytes = b"\xff\xd8\xff" + b"\x00" * 50
    mock_fetcher = AsyncMock(return_value=(fake_bytes, "image/jpeg"))

    with patch("backend.immich_client.get_asset_thumbnail", new=mock_fetcher):
        await auth_client.get("/api/immich/assets/cached-asset/thumbnail")
        await auth_client.get("/api/immich/assets/cached-asset/thumbnail")

    assert mock_fetcher.call_count == 1


async def test_preview_returns_bytes(auth_client):
    fake_bytes = b"\xff\xd8\xff" + b"\x00" * 80
    with patch(
        "backend.immich_client.get_asset_preview",
        new=AsyncMock(return_value=(fake_bytes, "image/jpeg")),
    ):
        resp = await auth_client.get("/api/immich/assets/prev-asset/preview")
    assert resp.status_code == 200
    assert resp.content == fake_bytes


async def test_original_returns_bytes(auth_client):
    fake_bytes = b"RAW_BINARY_DATA"
    with patch(
        "backend.immich_client.get_asset_original",
        new=AsyncMock(return_value=(fake_bytes, "application/octet-stream")),
    ):
        resp = await auth_client.get("/api/immich/assets/orig-asset/original")
    assert resp.status_code == 200
    assert resp.content == fake_bytes


async def test_immich_unreachable_returns_502(auth_client):
    with patch(
        "backend.immich_client.get_asset_thumbnail",
        new=AsyncMock(side_effect=httpx.ConnectError("Connection refused")),
    ):
        resp = await auth_client.get("/api/immich/assets/bad-asset/thumbnail")
    assert resp.status_code == 502
