from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Optional

BODY_MAX_LENGTH = 100_000  # ~100k characters (~50k words)


def _validate_iso_datetime(v: str | None) -> str | None:
    """Validate that a string is a valid ISO 8601 datetime."""
    if v is None:
        return v
    try:
        datetime.fromisoformat(v)
    except (ValueError, TypeError):
        raise ValueError("Must be a valid ISO 8601 datetime string (e.g. 2024-01-15T10:30:00)")
    return v


class EntryCreate(BaseModel):
    immich_asset_ids: list[str]
    title: str = Field(default="", max_length=500)
    summary: str = Field(default="", max_length=500)
    body: str = Field(..., min_length=1, max_length=BODY_MAX_LENGTH)
    tags: str = Field(default="", max_length=1000)
    created_at: Optional[str] = None

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, v: str | None) -> str | None:
        return _validate_iso_datetime(v)


class EntryUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=500)
    summary: Optional[str] = Field(default=None, max_length=500)
    body: Optional[str] = Field(default=None, min_length=1, max_length=BODY_MAX_LENGTH)
    tags: Optional[str] = Field(default=None, max_length=1000)
    immich_asset_ids: Optional[list[str]] = None
    created_at: Optional[str] = None

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, v: str | None) -> str | None:
        return _validate_iso_datetime(v)


class EntryResponse(BaseModel):
    id: int
    immich_asset_ids: list[str]
    title: str
    summary: str
    body: str
    tags: str
    created_at: str
    updated_at: str


class EntryListResponse(BaseModel):
    entries: list[EntryResponse]
    total: int
    page: int
    page_size: int


class AssetIdsRequest(BaseModel):
    asset_ids: list[str]


class AssetIdsWithEntriesResponse(BaseModel):
    asset_ids_with_entries: list[str]


class SettingsResponse(BaseModel):
    auto_slide_gallery: bool = True
    theme: str = "dark"
    confetti_enabled: bool = True


class SettingsUpdate(BaseModel):
    auto_slide_gallery: bool = True
    theme: str = "dark"
    confetti_enabled: bool = True
