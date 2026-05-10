from fastapi import APIRouter, HTTPException
from backend.models import SettingsResponse, SettingsUpdate
from backend.database import get_db
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    """Get current application settings"""
    logger.debug("Fetching application settings")
    
    db = get_db()
    try:
        cursor = await db.execute("SELECT key, value FROM settings WHERE key IN ('auto_slide_gallery', 'theme', 'confetti_enabled')")
        rows = await cursor.fetchall()
        row_map = {r[0]: r[1] for r in rows}

        auto_slide_gallery = row_map.get("auto_slide_gallery", "true").lower() == "true"
        theme = row_map.get("theme", "dark")
        confetti_enabled = row_map.get("confetti_enabled", "true").lower() == "true"

        return SettingsResponse(auto_slide_gallery=auto_slide_gallery, theme=theme, confetti_enabled=confetti_enabled)
        
    except Exception as e:
        logger.error(f"Failed to fetch settings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch settings")


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(settings: SettingsUpdate):
    """Update application settings"""
    logger.debug(f"Updating settings: {settings}")
    
    if settings.theme not in ("dark", "light"):
        raise HTTPException(status_code=400, detail="theme must be 'dark' or 'light'")

    db = get_db()
    try:
        # Batch insert all settings in a single operation
        await db.executemany(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [
                ("auto_slide_gallery", str(settings.auto_slide_gallery)),
                ("theme", settings.theme),
                ("confetti_enabled", str(settings.confetti_enabled))
            ]
        )
        await db.commit()

        return SettingsResponse(
            auto_slide_gallery=settings.auto_slide_gallery,
            theme=settings.theme,
            confetti_enabled=settings.confetti_enabled,
        )
        
    except Exception as e:
        logger.error(f"Failed to update settings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update settings")


@router.get("/stats", response_model=dict)
async def get_journal_stats():
    """Get journal statistics by month"""
    db = get_db()
    try:
        # Query entries grouped by month
        cursor = await db.execute("""
            SELECT
                substr(created_at, 1, 7) as month,
                COUNT(*) as count
            FROM journal_entries
            GROUP BY substr(created_at, 1, 7)
            ORDER BY month DESC
        """)
        rows = await cursor.fetchall()

        # Per-day counts for heatmap
        cursor = await db.execute("""
            SELECT
                substr(created_at, 1, 10) as day,
                COUNT(*) as count
            FROM journal_entries
            GROUP BY substr(created_at, 1, 10)
            ORDER BY day ASC
        """)
        day_rows = await cursor.fetchall()

        # Top 30 tags
        cursor = await db.execute("""
            SELECT t.name as tag, COUNT(*) as count
            FROM entry_tags et
            JOIN tags t ON et.tag_id = t.id
            GROUP BY t.id
            ORDER BY count DESC
            LIMIT 30
        """)
        tag_rows = await cursor.fetchall()

        # Streak calculation — walk backwards from today over per-day set
        day_set = {r["day"] for r in day_rows}
        from datetime import date, timedelta
        today = date.today()
        current_streak = 0
        check = today
        while check.isoformat() in day_set:
            current_streak += 1
            check -= timedelta(days=1)

        longest_streak = 0
        streak = 0
        sorted_days = sorted(day_set)
        for i, d in enumerate(sorted_days):
            if i == 0:
                streak = 1
            else:
                prev = date.fromisoformat(sorted_days[i - 1])
                cur = date.fromisoformat(d)
                if (cur - prev).days == 1:
                    streak += 1
                else:
                    streak = 1
            longest_streak = max(longest_streak, streak)

        stats = {
            "by_month": [{"month": row["month"], "count": row["count"]} for row in rows],
            "total_entries": sum(row["count"] for row in rows),
            "by_day": [{"day": r["day"], "count": r["count"]} for r in day_rows],
            "top_tags": [{"tag": r["tag"], "count": r["count"]} for r in tag_rows],
            "current_streak": current_streak,
            "longest_streak": longest_streak,
        }

        return stats
    except Exception as e:
        logger.error(f"Failed to get journal stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to get journal stats")