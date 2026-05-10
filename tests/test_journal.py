async def _create(client, **kwargs):
    payload = {"immich_asset_ids": ["asset-1"], "body": "Test body", **kwargs}
    return await client.post("/api/journal/entries", json=payload)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def test_create_success(auth_client):
    resp = await _create(
        auth_client,
        title="My Entry",
        summary="A summary",
        body="Hello world",
        tags="travel,family",
        immich_asset_ids=["asset-abc", "asset-def"],
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "My Entry"
    assert data["summary"] == "A summary"
    assert data["body"] == "Hello world"
    assert data["tags"] == "travel,family"
    assert set(data["immich_asset_ids"]) == {"asset-abc", "asset-def"}
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data


async def test_create_missing_body_returns_422(auth_client):
    resp = await auth_client.post(
        "/api/journal/entries",
        json={"immich_asset_ids": ["asset-1"]},
    )
    assert resp.status_code == 422


async def test_create_empty_asset_ids_returns_400(auth_client):
    resp = await auth_client.post(
        "/api/journal/entries",
        json={"immich_asset_ids": [], "body": "Hello"},
    )
    assert resp.status_code == 400


async def test_create_tags_stored_in_normalized_tables(auth_client, db):
    resp = await _create(auth_client, tags="nature,hiking")
    assert resp.status_code == 201
    entry_id = resp.json()["id"]

    cursor = await db.execute(
        "SELECT t.name FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?",
        (entry_id,),
    )
    rows = await cursor.fetchall()
    tag_names = {r["name"] for r in rows}
    assert "nature" in tag_names
    assert "hiking" in tag_names


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

async def test_get_entry(auth_client):
    created = (await _create(auth_client, title="Read Me")).json()
    resp = await auth_client.get(f"/api/journal/entries/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Read Me"


async def test_get_entry_not_found(auth_client):
    resp = await auth_client.get("/api/journal/entries/99999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def test_update_fields(auth_client):
    created = (await _create(auth_client, title="Old", body="Old body")).json()
    resp = await auth_client.put(
        f"/api/journal/entries/{created['id']}",
        json={"title": "New", "body": "New body"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "New"
    assert data["body"] == "New body"


async def test_update_assets_replaces_list(auth_client):
    created = (await _create(auth_client, immich_asset_ids=["old-asset"])).json()
    resp = await auth_client.put(
        f"/api/journal/entries/{created['id']}",
        json={"immich_asset_ids": ["new-1", "new-2"]},
    )
    assert resp.status_code == 200
    assert set(resp.json()["immich_asset_ids"]) == {"new-1", "new-2"}


async def test_update_empty_assets_returns_400(auth_client):
    created = (await _create(auth_client)).json()
    resp = await auth_client.put(
        f"/api/journal/entries/{created['id']}",
        json={"immich_asset_ids": []},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

async def test_delete_entry(auth_client):
    created = (await _create(auth_client)).json()
    resp = await auth_client.delete(f"/api/journal/entries/{created['id']}")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert (await auth_client.get(f"/api/journal/entries/{created['id']}")).status_code == 404


async def test_delete_not_found(auth_client):
    resp = await auth_client.delete("/api/journal/entries/99999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# List / pagination / filtering
# ---------------------------------------------------------------------------

async def test_pagination(auth_client):
    for i in range(5):
        await _create(auth_client, body=f"Entry {i}")

    r1 = await auth_client.get("/api/journal/entries?page=1&page_size=3")
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["total"] == 5
    assert len(d1["entries"]) == 3
    assert d1["page"] == 1

    r2 = await auth_client.get("/api/journal/entries?page=2&page_size=3")
    assert len(r2.json()["entries"]) == 2


async def test_filter_by_tag(auth_client):
    await _create(auth_client, tags="alpha")
    await _create(auth_client, tags="beta")
    await _create(auth_client, tags="alpha,beta")

    resp = await auth_client.get("/api/journal/entries?tag=alpha")
    data = resp.json()
    assert data["total"] == 2
    for e in data["entries"]:
        assert "alpha" in e["tags"]


async def test_filter_by_date_range(auth_client):
    await _create(auth_client, created_at="2024-01-15T00:00:00Z")
    await _create(auth_client, created_at="2024-06-15T00:00:00Z")
    await _create(auth_client, created_at="2025-01-15T00:00:00Z")

    resp = await auth_client.get("/api/journal/entries?date_from=2024-01-01&date_to=2024-12-31")
    assert resp.json()["total"] == 2


# ---------------------------------------------------------------------------
# Asset management
# ---------------------------------------------------------------------------

async def test_add_assets(auth_client):
    created = (await _create(auth_client, immich_asset_ids=["asset-1"])).json()
    resp = await auth_client.post(
        f"/api/journal/entries/{created['id']}/assets",
        json={"immich_asset_ids": ["asset-2", "asset-3"]},
    )
    assert resp.status_code == 200
    assert "asset-2" in resp.json()["added"]

    entry = (await auth_client.get(f"/api/journal/entries/{created['id']}")).json()
    assert set(entry["immich_asset_ids"]) == {"asset-1", "asset-2", "asset-3"}


async def test_remove_assets(auth_client):
    created = (await _create(
        auth_client, immich_asset_ids=["keep", "remove"]
    )).json()
    resp = await auth_client.post(
        f"/api/journal/entries/{created['id']}/assets/remove",
        json={"asset_ids": ["remove"]},
    )
    assert resp.status_code == 200

    entry = (await auth_client.get(f"/api/journal/entries/{created['id']}")).json()
    assert entry["immich_asset_ids"] == ["keep"]


async def test_remove_last_asset_returns_400(auth_client):
    created = (await _create(auth_client, immich_asset_ids=["only"])).json()
    resp = await auth_client.post(
        f"/api/journal/entries/{created['id']}/assets/remove",
        json={"asset_ids": ["only"]},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Search (FTS)
# ---------------------------------------------------------------------------

async def test_search_matches_title(auth_client):
    await _create(auth_client, title="Yellowstone Trip", body="Great park")
    await _create(auth_client, title="Beach Day", body="Sun and sand")

    resp = await auth_client.get("/api/journal/search?q=Yellowstone")
    data = resp.json()
    assert data["total"] == 1
    assert data["entries"][0]["title"] == "Yellowstone Trip"


async def test_search_matches_body(auth_client):
    await _create(auth_client, title="Vacation", body="Visited the Grand Canyon")
    await _create(auth_client, title="Work", body="Long meeting day")

    resp = await auth_client.get("/api/journal/search?q=Grand+Canyon")
    assert resp.json()["total"] == 1


async def test_search_matches_summary(auth_client):
    await _create(auth_client, summary="Northern lights viewing", body="Dark sky")
    await _create(auth_client, summary="Normal day", body="At home")

    resp = await auth_client.get("/api/journal/search?q=Northern+lights")
    assert resp.json()["total"] == 1


async def test_search_no_results(auth_client):
    await _create(auth_client, body="mundane content")
    resp = await auth_client.get("/api/journal/search?q=xyznonexistent")
    data = resp.json()
    assert data["total"] == 0
    assert data["entries"] == []


# ---------------------------------------------------------------------------
# Asset lookup
# ---------------------------------------------------------------------------

async def test_entries_by_asset_id(auth_client):
    created = (await _create(auth_client, immich_asset_ids=["shared-asset", "other"])).json()
    resp = await auth_client.get("/api/journal/entries/by-asset/shared-asset")
    assert resp.status_code == 200
    assert any(e["id"] == created["id"] for e in resp.json())


async def test_entries_by_multiple_asset_ids(auth_client):
    await _create(auth_client, immich_asset_ids=["asset-x"])
    await _create(auth_client, immich_asset_ids=["asset-y"])
    await _create(auth_client, immich_asset_ids=["asset-z"])

    resp = await auth_client.post(
        "/api/journal/entries/by-assets",
        json={"asset_ids": ["asset-x", "asset-y"]},
    )
    assert resp.status_code == 200
    returned = set(resp.json()["asset_ids_with_entries"])
    assert "asset-x" in returned
    assert "asset-y" in returned
    assert "asset-z" not in returned


async def test_linked_asset_ids(auth_client):
    await _create(auth_client, immich_asset_ids=["link-1", "link-2"])
    await _create(auth_client, immich_asset_ids=["link-3"])

    resp = await auth_client.get("/api/journal/linked-asset-ids")
    assert resp.status_code == 200
    asset_ids = set(resp.json()["asset_ids"])
    assert {"link-1", "link-2", "link-3"}.issubset(asset_ids)


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

async def test_get_tags(auth_client):
    await _create(auth_client, tags="mountains,lakes")
    await _create(auth_client, tags="mountains,trails")

    resp = await auth_client.get("/api/journal/tags")
    assert resp.status_code == 200
    tags = resp.json()["tags"]
    assert "mountains" in tags
    assert "lakes" in tags
    assert "trails" in tags
    assert len(tags) == len(set(tags))


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------

async def test_export(auth_client):
    await _create(auth_client, title="Export me", body="content here")
    resp = await auth_client.get("/api/journal/export")
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    data = resp.json()
    assert data["version"] == "1"
    assert "exported_at" in data
    assert isinstance(data["entries"], list)
    assert any(e["title"] == "Export me" for e in data["entries"])


async def test_import_valid(auth_client):
    payload = {
        "version": "1",
        "exported_at": "2024-01-01T00:00:00Z",
        "entries": [
            {
                "title": "Imported Entry",
                "summary": "summary",
                "body": "Imported body",
                "tags": "import",
                "created_at": "2024-01-01T10:00:00Z",
                "updated_at": "2024-01-01T10:00:00Z",
                "immich_asset_ids": ["import-asset-1"],
            }
        ],
    }
    resp = await auth_client.post("/api/journal/import", json=payload)
    assert resp.status_code == 200
    result = resp.json()
    assert result["imported"] == 1
    assert result["errors"] == []


async def test_import_wrong_version_returns_400(auth_client):
    resp = await auth_client.post(
        "/api/journal/import",
        json={"version": "99", "entries": []},
    )
    assert resp.status_code == 400


async def test_import_missing_body_or_assets_skipped(auth_client):
    payload = {
        "version": "1",
        "entries": [
            {"title": "No body", "immich_asset_ids": ["a1"]},
            {"title": "No assets", "body": "has body", "immich_asset_ids": []},
            {"title": "Good", "body": "has body", "immich_asset_ids": ["a2"]},
        ],
    }
    resp = await auth_client.post("/api/journal/import", json=payload)
    result = resp.json()
    assert result["imported"] == 1
    assert len(result["errors"]) == 2
