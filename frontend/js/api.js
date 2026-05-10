const API_BASE = "/api";

async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        window.location.href = "/login";
        throw new Error("Unauthorized");
    }
    return res;
}

export async function fetchAssets(page = 1, pageSize = 100) {
    const res = await apiFetch(`${API_BASE}/immich/assets?page=${page}&page_size=${pageSize}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchAssetDetail(assetId) {
    const res = await apiFetch(`${API_BASE}/immich/assets/${assetId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export function thumbnailUrl(assetId) {
    return `${API_BASE}/immich/assets/${assetId}/thumbnail`;
}

export function originalUrl(assetId) {
    return `${API_BASE}/immich/assets/${assetId}/original`;
}

export function previewUrl(assetId) {
    return `${API_BASE}/immich/assets/${assetId}/preview`;
}

export async function fetchEntries(page = 1, pageSize = 20, { dateFrom, dateTo, tag } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (tag) params.set("tag", tag);
    const res = await apiFetch(`${API_BASE}/journal/entries?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function searchEntries(q, page = 1, pageSize = 20) {
    const params = new URLSearchParams({ q, page, page_size: pageSize });
    const res = await apiFetch(`${API_BASE}/journal/search?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchTags() {
    const res = await apiFetch(`${API_BASE}/journal/tags`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchEntry(entryId) {
    const res = await apiFetch(`${API_BASE}/journal/entries/${entryId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchEntriesForAsset(assetId) {
    const res = await apiFetch(`${API_BASE}/journal/entries/by-asset/${assetId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function createEntry(data) {
    const res = await apiFetch(`${API_BASE}/journal/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function updateEntry(entryId, data) {
    const res = await apiFetch(`${API_BASE}/journal/entries/${entryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function deleteEntry(entryId) {
    const res = await apiFetch(`${API_BASE}/journal/entries/${entryId}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function checkAssetsWithEntries(assetIds) {
    const res = await apiFetch(`${API_BASE}/journal/entries/by-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_ids: assetIds }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return new Set(data.asset_ids_with_entries);
}

export async function getAllLinkedAssetIds() {
    const res = await apiFetch(`${API_BASE}/journal/linked-asset-ids`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return new Set(data.asset_ids);
}

export async function addAssetsToEntry(entryId, assetIds) {
    const res = await apiFetch(`${API_BASE}/journal/entries/${entryId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ immich_asset_ids: assetIds }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function removeAssetsFromEntry(entryId, assetIds) {
    const res = await apiFetch(`${API_BASE}/journal/entries/${entryId}/assets/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_ids: assetIds }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

let _immichConfigCache = null;
export async function fetchImmichConfig() {
    if (_immichConfigCache) return _immichConfigCache;
    const res = await apiFetch(`${API_BASE}/immich/assets/config`);
    if (!res.ok) throw new Error(await res.text());
    _immichConfigCache = await res.json();
    return _immichConfigCache;
}

export async function getSettings() {
    const res = await apiFetch(`${API_BASE}/settings`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchOnThisDay() {
    const res = await apiFetch(`${API_BASE}/journal/on-this-day`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchRandomEntry() {
    const res = await apiFetch(`${API_BASE}/journal/entries/random`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchJournalStats() {
    const res = await apiFetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function updateSettings(settings) {
    const res = await apiFetch(`${API_BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function importJournal(data) {
    const res = await apiFetch(`${API_BASE}/journal/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}
