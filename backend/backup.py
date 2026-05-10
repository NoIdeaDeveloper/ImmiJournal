"""
Automated SQLite database backup.

Backups are stored in {data_dir}/backups/ alongside the main DB file.
Up to BACKUP_KEEP_COUNT daily backups are retained; older ones are pruned.
"""

import asyncio
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from backend.config import DATABASE_PATH

logger = logging.getLogger(__name__)

BACKUP_KEEP_COUNT = 7  # Number of daily backups to retain


def _backup_dir() -> Path:
    return Path(DATABASE_PATH).parent / "backups"


def run_backup() -> str:
    """Copy the SQLite database to the backup directory. Returns the backup file path."""
    backup_dir = _backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    backup_path = backup_dir / f"immijournal_{timestamp}.db"

    shutil.copy2(DATABASE_PATH, backup_path)
    logger.info(f"Database backup created: {backup_path}")

    _prune_old_backups(backup_dir)
    return str(backup_path)


def _prune_old_backups(backup_dir: Path) -> None:
    backups = sorted(backup_dir.glob("immijournal_*.db"))
    to_delete = backups[:-BACKUP_KEEP_COUNT] if len(backups) > BACKUP_KEEP_COUNT else []
    for old in to_delete:
        try:
            old.unlink()
            logger.info(f"Pruned old backup: {old}")
        except OSError as e:
            logger.warning(f"Failed to prune backup {old}: {e}")


def list_backups() -> list[dict]:
    """Return a list of existing backups with name, size, and timestamp."""
    backup_dir = _backup_dir()
    if not backup_dir.exists():
        return []
    backups = []
    for p in sorted(backup_dir.glob("immijournal_*.db"), reverse=True):
        stat = p.stat()
        backups.append({
            "name": p.name,
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return backups


async def schedule_daily_backups(interval_seconds: int = 86400) -> None:
    """Coroutine that runs a backup once per day indefinitely."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await asyncio.to_thread(run_backup)
        except Exception as e:
            logger.error(f"Scheduled backup failed: {e}", exc_info=True)
