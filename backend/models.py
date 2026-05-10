from pydantic import BaseModel
from typing import Optional


class EntryCreate(BaseModel):
    immich_asset_ids: list[str]
    title: str = ""
    summary: str = ""
    body: str
    tags: str = ""  # Comma-separated tag list e.g. "travel,family"
    created_at: Optional[str] = None  # If provided, overrides the auto-generated timestamp


class EntryUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    body: Optional[str] = None
    tags: Optional[str] = None
    immich_asset_ids: Optional[list[str]] = None
    created_at: Optional[str] = None  # Allow backdating / changing the publish date


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
    auto_slide_gallery: bool
    theme: str = "dark"
    confetti_enabled: bool = True
