import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse
from backend.auth import require_auth
from backend.config import DATABASE_PATH
from backend.database import get_db
from backend import backup as backup_module
from backend.models import (
    EntryCreate,
    EntryUpdate,
    EntryResponse,
    EntryListResponse,
    AssetIdsRequest,
    AssetIdsWithEntriesResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


async def _sync_tags(db, entry_id: int, tags_str: str) -> None:
    """Sync the normalized tags tables for an entry from its comma-separated tags string."""
    await db.execute("DELETE FROM entry_tags WHERE entry_id = ?", (entry_id,))
    if not tags_str:
        return
    tag_names = [t.strip() for t in tags_str.split(",") if t.strip()]
    if not tag_names:
        return

    # Batch upsert: one INSERT for all tags, then one SELECT to get their IDs
    placeholders = _sql_placeholders(tag_names)
    await db.executemany(
        "INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
        [(name,) for name in tag_names],
    )
    cursor = await db.execute(
        f"SELECT id FROM tags WHERE name IN ({placeholders})",
        tag_names,
    )
    tag_rows = await cursor.fetchall()
    await db.executemany(
        "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
        [(entry_id, row["id"]) for row in tag_rows],
    )


async def _get_current_asset_ids(db, entry_id: int) -> list[str]:
    cursor = await db.execute(
        "SELECT immich_asset_id FROM entry_assets WHERE entry_id = ?", (entry_id,)
    )
    return [row["immich_asset_id"] for row in await cursor.fetchall()]


def _sql_placeholders(items) -> str:
    """Return a comma-separated string of '?' placeholders for an IN clause."""
    return ",".join("?" for _ in items)


async def _verify_entry_exists(db, entry_id: int) -> None:
    """Raise 404 if the entry does not exist."""
    cursor = await db.execute(
        "SELECT id FROM journal_entries WHERE id = ?", (entry_id,)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Entry not found")


async def _get_next_position(db, entry_id: int) -> int:
    cursor = await db.execute(
        "SELECT MAX(position) FROM entry_assets WHERE entry_id = ?", (entry_id,)
    )
    row = await cursor.fetchone()
    return row[0] + 1 if row and row[0] is not None else 0


async def _build_entry_response(db, entry_row) -> EntryResponse:
    cursor = await db.execute(
        "SELECT immich_asset_id FROM entry_assets WHERE entry_id = ? ORDER BY position",
        (entry_row["id"],),
    )
    asset_rows = await cursor.fetchall()
    return EntryResponse(
        id=entry_row["id"],
        immich_asset_ids=[r["immich_asset_id"] for r in asset_rows],
        title=entry_row["title"],
        summary=entry_row["summary"],
        body=entry_row["body"],
        tags=entry_row["tags"],
        created_at=entry_row["created_at"],
        updated_at=entry_row["updated_at"],
    )


async def _build_entries_response(db, entry_rows) -> list[EntryResponse]:
    if not entry_rows:
        return []
    entry_ids = [r["id"] for r in entry_rows]
    
    # Safe parameterized query - build IN clause with proper placeholders
    placeholders = _sql_placeholders(entry_ids)
    query = f"SELECT entry_id, immich_asset_id FROM entry_assets WHERE entry_id IN ({placeholders}) ORDER BY entry_id, position"
    cursor = await db.execute(query, entry_ids)
    asset_rows = await cursor.fetchall()
    
    assets_by_entry = {}
    for row in asset_rows:
        assets_by_entry.setdefault(row["entry_id"], []).append(row["immich_asset_id"])
    return [
        EntryResponse(
            id=r["id"],
            immich_asset_ids=assets_by_entry.get(r["id"], []),
            title=r["title"],
            summary=r["summary"],
            body=r["body"],
            tags=r["tags"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in entry_rows
    ]


@router.get("/entries", response_model=EntryListResponse)
async def list_entries(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    date_from: str = Query(None, description="ISO date string (inclusive lower bound)"),
    date_to: str = Query(None, description="ISO date string (inclusive upper bound)"),
    tag: str = Query(None, description="Filter entries by tag"),
):
    logger.debug(f"Listing entries - page: {page}, page_size: {page_size}, date_from: {date_from}, date_to: {date_to}")

    # Validate ISO date strings early to return a clean 400 instead of a DB error
    for param_name, param_val in (("date_from", date_from), ("date_to", date_to)):
        if param_val:
            try:
                datetime.fromisoformat(param_val)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid {param_name}: must be an ISO date string (e.g. 2024-01-15)")

    db = get_db()
    try:
        offset = (page - 1) * page_size

        conditions = []
        params: list = []
        if date_from:
            conditions.append("created_at >= ?")
            params.append(date_from)
        if date_to:
            conditions.append("created_at <= ?")
            params.append(date_to + "T23:59:59.999999Z")
        if tag:
            conditions.append(
                "id IN (SELECT et.entry_id FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE t.name = ? COLLATE NOCASE)"
            )
            params.append(tag)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        cursor = await db.execute(f"SELECT COUNT(*) as cnt FROM journal_entries {where}", params)
        row = await cursor.fetchone()
        total = row["cnt"]

        cursor = await db.execute(
            f"SELECT * FROM journal_entries {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [page_size, offset],
        )
        entries = await cursor.fetchall()

        result = await _build_entries_response(db, entries)

        return EntryListResponse(
            entries=result, total=total, page=page, page_size=page_size
        )
    except Exception as e:
        logger.error(f"Failed to list entries: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list entries")


@router.get("/entries/by-asset/{asset_id}", response_model=list[EntryResponse])
async def get_entries_for_asset(asset_id: str):
    db = get_db()
    try:
        cursor = await db.execute(
            """
            SELECT je.* FROM journal_entries je
            JOIN entry_assets ea ON je.id = ea.entry_id
            WHERE ea.immich_asset_id = ?
            ORDER BY je.created_at DESC
            """,
            (asset_id,),
        )
        entries = await cursor.fetchall()
        return await _build_entries_response(db, entries)
    except Exception as e:
        logger.error(f"Failed to get entries for asset {asset_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get entries for asset")


@router.get("/on-this-day", response_model=list[EntryResponse])
async def on_this_day():
    db = get_db()
    try:
        cursor = await db.execute(
            """SELECT * FROM journal_entries
               WHERE strftime('%m-%d', created_at) = strftime('%m-%d', 'now')
               AND strftime('%Y', created_at) < strftime('%Y', 'now')
               ORDER BY created_at DESC LIMIT 20"""
        )
        entries = await cursor.fetchall()
        return await _build_entries_response(db, entries)
    except Exception as e:
        logger.error(f"Failed to get on-this-day entries: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get on-this-day entries")


@router.get("/entries/random", response_model=EntryResponse)
async def get_random_entry():
    db = get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM journal_entries ORDER BY RANDOM() LIMIT 1"
        )
        entry = await cursor.fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="No entries found")
        return await _build_entry_response(db, entry)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get random entry: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get random entry")


@router.get("/entries/{entry_id}", response_model=EntryResponse)
async def get_entry(entry_id: int):
    db = get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM journal_entries WHERE id = ?", (entry_id,)
        )
        entry = await cursor.fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        return await _build_entry_response(db, entry)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get entry {entry_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get entry")




@router.post("/entries", response_model=EntryResponse, status_code=201)
async def create_entry(data: EntryCreate):
    logger.info(f"Creating new entry with {len(data.immich_asset_ids)} assets")
    if not data.immich_asset_ids:
        logger.warning("Create entry attempt with no asset IDs")
        raise HTTPException(status_code=400, detail="At least one asset ID is required")

    now = datetime.now(timezone.utc).isoformat()
    created_at = data.created_at if data.created_at else now
    db = get_db()
    try:
        # Start transaction
        cursor = await db.execute(
            "INSERT INTO journal_entries (title, summary, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (data.title, data.summary, data.body, data.tags, created_at, now),
        )
        entry_id = cursor.lastrowid

        # Insert all assets using batch operation
        await db.executemany(
            "INSERT INTO entry_assets (entry_id, immich_asset_id, position) VALUES (?, ?, ?)",
            [(entry_id, asset_id, position) for position, asset_id in enumerate(data.immich_asset_ids)]
        )

        await _sync_tags(db, entry_id, data.tags)

        # Commit transaction
        await db.commit()

        # Fetch and return the created entry
        cursor = await db.execute(
            "SELECT * FROM journal_entries WHERE id = ?", (entry_id,)
        )
        entry = await cursor.fetchone()
        return await _build_entry_response(db, entry)

    except HTTPException:
        raise
    except Exception as e:
        # Rollback on error
        await db.rollback()
        logger.error(f"Failed to create entry: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create entry: {str(e)}")



@router.put("/entries/{entry_id}", response_model=EntryResponse)
async def update_entry(entry_id: int, data: EntryUpdate):
    db = get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM journal_entries WHERE id = ?", (entry_id,)
        )
        entry = await cursor.fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")

        now = datetime.now(timezone.utc).isoformat()
        new_title = data.title if data.title is not None else entry["title"]
        new_summary = data.summary if data.summary is not None else entry["summary"]
        new_body = data.body if data.body is not None else entry["body"]
        new_tags = data.tags if data.tags is not None else entry["tags"]
        new_created_at = data.created_at if data.created_at is not None else entry["created_at"]

        await db.execute(
            "UPDATE journal_entries SET title = ?, summary = ?, body = ?, tags = ?, created_at = ?, updated_at = ? WHERE id = ?",
            (new_title, new_summary, new_body, new_tags, new_created_at, now, entry_id),
        )

        if data.immich_asset_ids is not None:
            if not data.immich_asset_ids:
                raise HTTPException(
                    status_code=400, detail="At least one asset ID is required"
                )

            # Always replace with the exact submitted list (preserves order, handles add/remove/reorder)
            await db.execute(
                "DELETE FROM entry_assets WHERE entry_id = ?", (entry_id,)
            )
            await db.executemany(
                "INSERT INTO entry_assets (entry_id, immich_asset_id, position) VALUES (?, ?, ?)",
                [(entry_id, asset_id, position) for position, asset_id in enumerate(data.immich_asset_ids)]
            )

        await _sync_tags(db, entry_id, new_tags)

        # Commit transaction
        await db.commit()

        cursor = await db.execute(
            "SELECT * FROM journal_entries WHERE id = ?", (entry_id,)
        )
        entry = await cursor.fetchone()
        return await _build_entry_response(db, entry)

    except HTTPException:
        raise
    except Exception as e:
        # Rollback on error
        await db.rollback()
        logger.error(f"Failed to update entry: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update entry: {str(e)}")



@router.post("/entries/{entry_id}/assets")
async def add_assets_to_entry(entry_id: int, data: EntryUpdate):
    """
    Add assets to an existing entry without replacing all assets.
    
    Request body should contain:
    {
        "immich_asset_ids": ["asset_id_1", "asset_id_2"]
    }
    """
    if not data.immich_asset_ids:
        raise HTTPException(status_code=400, detail="At least one asset ID is required")
    
    db = get_db()
    try:
        await _verify_entry_exists(db, entry_id)
        current_assets = await _get_current_asset_ids(db, entry_id)
        new_assets = [a for a in data.immich_asset_ids if a not in current_assets]

        if not new_assets:
            return {"message": "All specified assets already exist in this entry", "added": []}

        start_pos = await _get_next_position(db, entry_id)
        # Insert all assets using batch operation
        await db.executemany(
            "INSERT INTO entry_assets (entry_id, immich_asset_id, position) VALUES (?, ?, ?)",
            [(entry_id, asset_id, position) for position, asset_id in enumerate(new_assets, start=start_pos)]
        )
        
        await db.commit()
        return {"message": f"Successfully added {len(new_assets)} assets", "added": new_assets}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to add assets to entry: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to add assets: {str(e)}")


@router.post("/entries/{entry_id}/assets/remove")
async def remove_assets_from_entry(entry_id: int, request: AssetIdsRequest):
    """
    Remove specific assets from an entry.

    Request body should contain:
    {
        "asset_ids": ["asset_id_1", "asset_id_2"]
    }
    """
    asset_ids = request.asset_ids
    if not asset_ids:
        raise HTTPException(status_code=400, detail="At least one asset ID is required")
    
    db = get_db()
    try:
        await _verify_entry_exists(db, entry_id)

        # Atomically check that removal won't leave zero assets, then delete
        placeholders = _sql_placeholders(asset_ids)
        cursor = await db.execute(
            f"SELECT COUNT(*) as cnt FROM entry_assets WHERE entry_id = ? AND immich_asset_id NOT IN ({placeholders})",
            [entry_id, *asset_ids],
        )
        row = await cursor.fetchone()
        if row["cnt"] == 0:
            raise HTTPException(status_code=400, detail="Cannot remove all assets from an entry")

        cursor = await db.execute(
            f"DELETE FROM entry_assets WHERE entry_id = ? AND immich_asset_id IN ({placeholders})",
            [entry_id, *asset_ids],
        )
        removed_count = cursor.rowcount

        await db.commit()
        
        if removed_count == 0:
            return {"message": "No assets were removed (may not exist in entry)", "removed": 0}
        
        return {"message": f"Successfully removed {removed_count} assets", "removed": removed_count}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to remove assets from entry: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to remove assets: {str(e)}")


@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: int):
    db = get_db()
    try:
        await _verify_entry_exists(db, entry_id)
        await db.execute("DELETE FROM journal_entries WHERE id = ?", (entry_id,))
        await db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to delete entry {entry_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete entry")


@router.get("/tags")
async def list_tags(
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
):
    """Return distinct tags used across journal entries, paginated."""
    db = get_db()
    try:
        offset = (page - 1) * page_size
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM tags")
        total = (await cursor.fetchone())["cnt"]
        cursor = await db.execute(
            "SELECT name FROM tags ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",
            (page_size, offset),
        )
        rows = await cursor.fetchall()
        return {"tags": [r["name"] for r in rows], "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        logger.error(f"Failed to list tags: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list tags")


@router.get("/search", response_model=EntryListResponse)
async def search_entries(
    q: str = Query("", min_length=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    """Search journal entries by keyword across title, summary, and body."""
    db = get_db()
    try:
        if not q.strip():
            return await list_entries(page=page, page_size=page_size)

        # Wrap query in double quotes for FTS5 phrase matching; escape internal quotes
        fts_query = '"' + q.replace('"', '""') + '"'
        offset = (page - 1) * page_size

        cursor = await db.execute(
            """SELECT *, COUNT(*) OVER() AS total_count FROM journal_entries
               WHERE id IN (SELECT rowid FROM journal_entries_fts WHERE journal_entries_fts MATCH ?)
               ORDER BY created_at DESC LIMIT ? OFFSET ?""",
            (fts_query, page_size, offset),
        )
        entries = await cursor.fetchall()
        total = entries[0]["total_count"] if entries else 0
        result = await _build_entries_response(db, entries)
        return EntryListResponse(entries=result, total=total, page=page, page_size=page_size)
    except Exception as e:
        logger.error(f"Failed to search entries: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to search entries")


@router.post("/entries/by-assets", response_model=AssetIdsWithEntriesResponse)
async def get_assets_with_entries(data: AssetIdsRequest):
    if not data.asset_ids:
        return AssetIdsWithEntriesResponse(asset_ids_with_entries=[])

    db = get_db()
    try:
        placeholders = _sql_placeholders(data.asset_ids)
        query = f"SELECT DISTINCT immich_asset_id FROM entry_assets WHERE immich_asset_id IN ({placeholders})"
        cursor = await db.execute(query, data.asset_ids)
        rows = await cursor.fetchall()
        return AssetIdsWithEntriesResponse(
            asset_ids_with_entries=[r["immich_asset_id"] for r in rows]
        )
    except Exception as e:
        logger.error(f"Failed to get assets with entries: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get assets with entries")


@router.get("/linked-asset-ids")
async def get_all_linked_asset_ids():
    """Get all Immich asset IDs that have journal entries (for frontend caching)."""
    db = get_db()
    try:
        cursor = await db.execute("SELECT DISTINCT immich_asset_id FROM entry_assets")
        rows = await cursor.fetchall()
        return {"asset_ids": [r["immich_asset_id"] for r in rows]}
    except Exception as e:
        logger.error(f"Failed to get linked asset IDs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get linked asset IDs")


@router.get("/export")
async def export_journal():
    """Export all journal entries as a downloadable JSON file, streamed in chunks."""
    db = get_db()
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"immijournal-{date_str}.json"
    exported_at = datetime.now(timezone.utc).isoformat()

    async def generate():
        yield f'{{"version":"1","exported_at":"{exported_at}","entries":['
        first = True
        page_size = 100
        offset = 0
        try:
            while True:
                cursor = await db.execute(
                    "SELECT * FROM journal_entries ORDER BY created_at ASC LIMIT ? OFFSET ?",
                    (page_size, offset),
                )
                rows = await cursor.fetchall()
                if not rows:
                    break
                entries = await _build_entries_response(db, rows)
                for e in entries:
                    chunk = json.dumps({
                        "title": e.title,
                        "summary": e.summary,
                        "body": e.body,
                        "tags": e.tags,
                        "created_at": e.created_at,
                        "updated_at": e.updated_at,
                        "immich_asset_ids": e.immich_asset_ids,
                    })
                    yield ("" if first else ",") + chunk
                    first = False
                offset += page_size
                if len(rows) < page_size:
                    break
        except Exception as e:
            logger.error(f"Failed during export streaming: {e}", exc_info=True)
        yield "]}"

    return StreamingResponse(
        generate(),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/backups", dependencies=[Depends(require_auth)])
async def list_backups():
    """List all database backups."""
    return {"backups": backup_module.list_backups()}


@router.get("/backups/{filename}", dependencies=[Depends(require_auth)])
async def download_backup(filename: str):
    """Download a specific database backup file."""
    backup_dir = Path(DATABASE_PATH).parent / "backups"
    # Sanitize: only allow the bare filename, no path traversal
    safe_name = Path(filename).name
    backup_path = backup_dir / safe_name
    if not backup_path.exists() or not backup_path.is_file():
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(
        path=str(backup_path),
        filename=safe_name,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.post("/backup", dependencies=[Depends(require_auth)])
async def trigger_backup():
    """Trigger an immediate database backup."""
    try:
        path = await asyncio.to_thread(backup_module.run_backup)
        return {"ok": True, "backup_path": path}
    except Exception as e:
        logger.error(f"Backup failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")


_IMPORT_BATCH_SIZE = 50
_IMPORT_MAX_ENTRIES = 1000


@router.post("/import")
async def import_journal(data: dict):
    """Import journal entries from an exported JSON file."""
    if data.get("version") != "1":
        raise HTTPException(status_code=400, detail="Unsupported export version")

    entries_data = data.get("entries", [])
    if not isinstance(entries_data, list):
        raise HTTPException(status_code=400, detail="Invalid export format")

    if len(entries_data) > _IMPORT_MAX_ENTRIES:
        raise HTTPException(
            status_code=413,
            detail=f"Too many entries: max {_IMPORT_MAX_ENTRIES} per import. Split into smaller files.",
        )

    imported = 0
    errors = []
    db = get_db()

    # Process in batches so a large import doesn't hold a single huge transaction
    # Note: asset IDs are not validated against Immich here; orphaned references
    # will simply show broken images until the matching asset exists in Immich.
    for batch_start in range(0, len(entries_data), _IMPORT_BATCH_SIZE):
        batch = entries_data[batch_start: batch_start + _IMPORT_BATCH_SIZE]
        batch_imported = 0
        try:
            for i, entry in enumerate(batch, start=batch_start):
                try:
                    title = entry.get("title", "")
                    summary = entry.get("summary", "")
                    body = entry.get("body", "")
                    tags = entry.get("tags", "")
                    asset_ids = entry.get("immich_asset_ids", [])
                    created_at = entry.get("created_at") or datetime.now(timezone.utc).isoformat()
                    updated_at = entry.get("updated_at") or created_at

                    if not body or not asset_ids:
                        errors.append(f"Entry {i}: missing body or asset IDs")
                        continue

                    cursor = await db.execute(
                        "INSERT INTO journal_entries (title, summary, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (title, summary, body, tags, created_at, updated_at),
                    )
                    entry_id = cursor.lastrowid

                    await db.executemany(
                        "INSERT INTO entry_assets (entry_id, immich_asset_id, position) VALUES (?, ?, ?)",
                        [(entry_id, asset_id, pos) for pos, asset_id in enumerate(asset_ids)],
                    )

                    await _sync_tags(db, entry_id, tags)
                    batch_imported += 1
                except Exception as e:
                    errors.append(f"Entry {i}: {str(e)}")

            await db.commit()
            imported += batch_imported
        except Exception as e:
            await db.rollback()
            errors.append(f"Batch starting at entry {batch_start} failed to commit: {str(e)}")

    return {"imported": imported, "errors": errors}
