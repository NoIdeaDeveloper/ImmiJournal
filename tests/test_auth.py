import time


async def test_login_success(client):
    resp = await client.post("/api/auth/login", json={"password": "test-password"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert "tf_session" in resp.cookies


async def test_login_wrong_password(client):
    resp = await client.post("/api/auth/login", json={"password": "wrong"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Incorrect password"


async def test_login_missing_password_field(client):
    resp = await client.post("/api/auth/login", json={})
    assert resp.status_code == 422


async def test_rate_limiting(client):
    # First 5 bad attempts should each return 401
    for _ in range(5):
        r = await client.post("/api/auth/login", json={"password": "bad"})
        assert r.status_code == 401
    # 6th attempt triggers rate limit
    r = await client.post("/api/auth/login", json={"password": "bad"})
    assert r.status_code == 429


async def test_rate_limit_does_not_block_correct_password(client):
    # 4 failures, then correct password should succeed
    for _ in range(4):
        await client.post("/api/auth/login", json={"password": "bad"})
    resp = await client.post("/api/auth/login", json={"password": "test-password"})
    assert resp.status_code == 200


async def test_logout_success(auth_client):
    resp = await auth_client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_auth_disabled_any_password_succeeds(no_auth_client):
    resp = await no_auth_client.post("/api/auth/login", json={"password": "anything"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_valid_session_allows_access(auth_client):
    resp = await auth_client.get("/api/journal/entries")
    assert resp.status_code == 200


async def test_expired_session_rejected(client, db):
    expired_token = "expired_test_token_abc123"
    await db.execute(
        "INSERT INTO sessions (token, expires_at) VALUES (?, ?)",
        (expired_token, time.time() - 1),
    )
    await db.commit()

    client.cookies.set("tf_session", expired_token)
    resp = await client.get("/api/journal/entries")
    assert resp.status_code == 401
