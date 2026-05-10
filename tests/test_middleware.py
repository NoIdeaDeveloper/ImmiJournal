async def test_protected_route_no_session(client):
    resp = await client.get("/api/journal/entries")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Unauthorized"


async def test_protected_route_valid_session(auth_client):
    resp = await auth_client.get("/api/journal/entries")
    assert resp.status_code == 200


async def test_auth_login_bypasses_middleware(client):
    # Route 401 says "Incorrect password"; middleware 401 says "Unauthorized"
    resp = await client.post("/api/auth/login", json={"password": "wrong"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Incorrect password"


async def test_health_bypasses_middleware(client):
    resp = await client.get("/api/health")
    assert resp.status_code != 401


async def test_auth_logout_bypasses_middleware(client):
    # logout should be reachable without a session (just a no-op)
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
