import os
import pytest
import pytest_asyncio
import aiosqlite

# Must set env vars BEFORE any import of backend.* because backend/config.py
# raises RuntimeError at import time if these are missing.
os.environ.setdefault("IMMICH_BASE_URL", "http://immich-test.invalid/api")
os.environ.setdefault("IMMICH_API_KEY", "test-api-key")
os.environ.setdefault("APP_PASSWORD", "test-password")

import backend.database as db_module  # noqa: E402
from backend.database import init_db  # noqa: E402
from backend.main import app as _real_app  # noqa: E402
from httpx import AsyncClient, ASGITransport  # noqa: E402


# ---------------------------------------------------------------------------
# Autouse: clear rate-limit state between every test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clear_rate_limits():
    import backend.routes.auth as routes_auth
    routes_auth._failed_attempts.clear()
    yield
    routes_auth._failed_attempts.clear()


# ---------------------------------------------------------------------------
# In-memory database
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db():
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys=ON")

    original_db = db_module._db
    db_module._db = conn
    await init_db()

    yield conn

    db_module._db = original_db
    await conn.close()


# ---------------------------------------------------------------------------
# App / HTTP client fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def test_app(db):
    # lifespan does NOT fire when using ASGITransport (only http scope is sent)
    yield _real_app


@pytest_asyncio.fixture
async def client(test_app):
    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as c:
        yield c


@pytest_asyncio.fixture
async def auth_client(client):
    resp = await client.post("/api/auth/login", json={"password": "test-password"})
    assert resp.status_code == 200, f"Login failed in fixture: {resp.text}"
    yield client


# ---------------------------------------------------------------------------
# Auth-disabled client
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def no_auth_client(db, monkeypatch):
    import backend.auth as auth_module
    import backend.routes.auth as routes_auth_module
    import backend.main as main_module

    monkeypatch.setattr(auth_module, "APP_PASSWORD", "")
    monkeypatch.setattr(routes_auth_module, "APP_PASSWORD", "")
    monkeypatch.setattr(main_module, "APP_PASSWORD", "")

    async with AsyncClient(
        transport=ASGITransport(app=_real_app),
        base_url="http://testserver",
    ) as c:
        yield c
