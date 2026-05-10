async def test_get_default_settings(auth_client):
    resp = await auth_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["auto_slide_gallery"] is True
    assert data["theme"] == "dark"
    assert data["confetti_enabled"] is True


async def test_update_settings_persisted(auth_client):
    resp = await auth_client.put(
        "/api/settings",
        json={"auto_slide_gallery": False, "theme": "light", "confetti_enabled": False},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["auto_slide_gallery"] is False
    assert data["theme"] == "light"
    assert data["confetti_enabled"] is False

    resp2 = await auth_client.get("/api/settings")
    assert resp2.json()["theme"] == "light"
    assert resp2.json()["auto_slide_gallery"] is False


async def test_update_settings_invalid_theme_returns_400(auth_client):
    resp = await auth_client.put(
        "/api/settings",
        json={"auto_slide_gallery": True, "theme": "purple", "confetti_enabled": True},
    )
    assert resp.status_code == 400


async def test_stats_no_entries(auth_client):
    resp = await auth_client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_entries"] == 0
    assert data["by_month"] == []


async def test_stats_with_entries(auth_client):
    for created_at, asset_id in [
        ("2024-01-15T10:00:00Z", "a1"),
        ("2024-01-20T10:00:00Z", "a2"),
        ("2024-03-10T10:00:00Z", "a3"),
    ]:
        await auth_client.post(
            "/api/journal/entries",
            json={"immich_asset_ids": [asset_id], "body": "x", "created_at": created_at},
        )

    resp = await auth_client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_entries"] == 3

    by_month = {row["month"]: row["count"] for row in data["by_month"]}
    assert by_month.get("2024-01") == 2
    assert by_month.get("2024-03") == 1
