import { fetchAssets, checkAssetsWithEntries, addAssetsToEntry, fetchEntry, fetchEntriesForAsset, getAllLinkedAssetIds } from "../api.js";
import { renderPhotoGrid } from "../components/photoGrid.js";
import { showEntryModal, showEntryPickerModal } from "../components/modal.js";
import { escapeHtml } from "../utils.js";

let multiSelectActive = false;
let selectedAssetIds = [];
let _noticeTimer = null;

// Cache for asset IDs that have journal entries
let _linkedAssetIds = null;
let _cacheLoaded = false;
let _cachePromise = null;

async function getLinkedAssetIds() {
    // If we have cached data, return it immediately
    if (_cacheLoaded) {
        return _linkedAssetIds;
    }

    // If there's already a fetch in progress, wait for it
    if (_cachePromise) {
        return _cachePromise;
    }

    // Otherwise, fetch fresh data
    _cachePromise = (async () => {
        try {
            _linkedAssetIds = await getAllLinkedAssetIds();
            _cacheLoaded = true;
            return _linkedAssetIds;
        } catch (err) {
            console.warn("Failed to fetch linked asset IDs cache, falling back to per-page checks:", err);
            _linkedAssetIds = new Set();
            _cacheLoaded = false;
            return _linkedAssetIds;
        } finally {
            _cachePromise = null;
        }
    })();

    return _cachePromise;
}

// Function to invalidate cache when new entries are created
export function invalidateLinkedAssetIdsCache() {
    _linkedAssetIds = null;
    _cacheLoaded = false;
}

/**
 * Renders the photo browsing interface with infinite scroll.
 */
export async function renderBrowse(container) {
    removeSelectionBar();
    multiSelectActive = false;
    selectedAssetIds = [];
    clearTimeout(_noticeTimer);
    _noticeTimer = null;

    // Parse URL params from the hash (e.g. #/browse?entry=1&mode=add)
    // window.location.search is empty in hash-based routing
    const hashQuery = window.location.hash.includes('?')
        ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
        : '';
    const urlParams = new URLSearchParams(hashQuery);
    const modeParam = urlParams.get('mode');
    let entryIdForAdding = urlParams.get('entry');
    if (!entryIdForAdding && modeParam === 'add') {
        entryIdForAdding = sessionStorage.getItem('addImagesToEntry');
    }

    const isAddMode = modeParam === 'add' && entryIdForAdding;

    // In add-mode, fetch the entry's existing asset IDs so we can mark them
    let existingAssetIds = new Set();
    if (isAddMode) {
        try {
            const entry = await fetchEntry(entryIdForAdding);
            existingAssetIds = new Set(entry.immich_asset_ids);
        } catch (err) {
            console.error("Failed to fetch entry for add-mode:", err);
        }
    }

    container.innerHTML = `
        <div class="browse-container">
            <div class="browse-header">
                <h2 class="browse-title">${isAddMode ? 'Select Photos to Add' : 'Your Photos'}</h2>
                <button class="btn btn-secondary" id="toggle-select">${isAddMode ? 'Cancel' : 'Select Multiple'}</button>
                ${isAddMode ? `<button class="btn btn-primary" id="add-to-entry">Add to Entry</button>` : ''}
            </div>
            <div class="photo-grid" id="photo-grid">
                ${skeletonGrid(12)}
            </div>
            <div class="pagination-controls" id="pagination-controls">
                <button class="btn btn-secondary" id="prev-page" disabled>← Previous</button>
                <button class="btn btn-secondary" id="next-page" disabled>Next →</button>
            </div>
        </div>
    `;

    const gridEl = document.getElementById("photo-grid");
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    const toggleBtn = document.getElementById("toggle-select");
    const addToEntryBtn = document.getElementById("add-to-entry");

    let currentPage = 1;
    const pageSize = 100;
    let isLoading = false;
    let hasMore = true;

    const returnToEntry = () => { window.location.hash = `#/entry/${entryIdForAdding}`; };

    // Toggle multi-select mode
    toggleBtn.addEventListener("click", () => {
        if (isAddMode && !multiSelectActive) {
            returnToEntry();
            return;
        }

        multiSelectActive = !multiSelectActive;
        toggleBtn.textContent = multiSelectActive ? "Cancel Selection" : (isAddMode ? 'Cancel' : 'Select Multiple');
        gridEl.classList.toggle("multi-select-active", multiSelectActive);

        if (!multiSelectActive) {
            selectedAssetIds = [];
            gridEl.querySelectorAll(".photo-grid-item.selected").forEach((el) => {
                el.classList.remove("selected");
            });
            removeSelectionBar();
            if (isAddMode) returnToEntry();
        }
    });

    // Handle "Add to Entry" button
    if (addToEntryBtn) {
        addToEntryBtn.addEventListener("click", async () => {
            if (selectedAssetIds.length === 0) {
                showBrowseNotice("Select at least one photo to add.", "error");
                return;
            }

            addToEntryBtn.disabled = true;
            addToEntryBtn.textContent = "Adding...";
            try {
                await addAssetsToEntry(entryIdForAdding, selectedAssetIds);
                selectedAssetIds = [];
                gridEl.querySelectorAll(".photo-grid-item.selected").forEach((el) => {
                    el.classList.remove("selected");
                });
                window.location.hash = `#/entry/${entryIdForAdding}`;
            } catch (err) {
                showBrowseNotice("Failed to add images: " + err.message, "error");
                addToEntryBtn.disabled = false;
                addToEntryBtn.textContent = "Add to Entry";
            }
        });
    }

    async function loadPage(page) {
        if (isLoading) return;
        isLoading = true;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        gridEl.innerHTML = skeletonGrid(12);

        try {
            const data = await fetchAssets(page, pageSize);
            const assets = extractAssets(data);

            gridEl.innerHTML = "";

            if (assets.length > 0) {
                const assetIds = assets.map((a) => a.id);

                const linkedAssetIds = await getLinkedAssetIds();
                let assetsWithEntries;

                if (_cacheLoaded) {
                    assetsWithEntries = new Set(assetIds.filter(id => linkedAssetIds.has(id)));
                } else {
                    console.log("Using fallback per-page check for asset entries");
                    assetsWithEntries = await checkAssetsWithEntries(assetIds);
                }

                gridEl.appendChild(renderPhotoGrid(assets, assetsWithEntries, existingAssetIds));
                attachGridClickHandlers(gridEl);
            }

            hasMore = hasMorePages(data, page, pageSize);
            currentPage = page;

            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = !hasMore;

            gridEl.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
            gridEl.innerHTML = `
                <div class="error-state">
                    <p>Could not load photos. Is the Immich server running?</p>
                    <p>${escapeHtml(err.message)}</p>
                </div>
            `;
            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = true;
        } finally {
            isLoading = false;
        }
    }

    function updateSelectionBar() {
        let bar = document.querySelector(".selection-bar");

        if (selectedAssetIds.length === 0) {
            removeSelectionBar();
            return;
        }

        if (!bar) {
            bar = document.createElement("div");
            bar.className = "selection-bar";
            document.body.appendChild(bar);
        }

        document.querySelector(".browse-container")?.classList.add("has-selection-bar");
        const count = selectedAssetIds.length;
        bar.innerHTML = `
            <span class="selection-count">${count} photo${count !== 1 ? "s" : ""} selected</span>
            <div class="selection-actions">
                <button class="btn btn-secondary" id="selection-clear">Clear</button>
                ${!isAddMode ? '<button class="btn btn-primary" id="selection-write">Write Entry</button>' : ''}
            </div>
        `;

        document.getElementById("selection-clear").addEventListener("click", () => {
            selectedAssetIds = [];
            document.querySelectorAll(".photo-grid-item.selected").forEach((el) => {
                el.classList.remove("selected");
            });
            removeSelectionBar();
        });

        if (!isAddMode) {
            document.getElementById("selection-write").addEventListener("click", () => {
                if (selectedAssetIds.length > 0) {
                    showEntryModal([...selectedAssetIds]);
                }
            });
        }
    }

    function attachGridClickHandlers(grid) {
        grid.querySelectorAll(".photo-grid-item").forEach((item) => {
            if (item.dataset.clickAttached) return;
            item.dataset.clickAttached = "true";

            if (item.classList.contains("already-in-entry")) return;

            item.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    item.click();
                }
            });

            item.addEventListener("click", async () => {
                const assetId = item.dataset.assetId;

                if (multiSelectActive) {
                    const idx = selectedAssetIds.indexOf(assetId);
                    if (idx >= 0) {
                        selectedAssetIds.splice(idx, 1);
                        item.classList.remove("selected");
                    } else {
                        selectedAssetIds.push(assetId);
                        item.classList.add("selected");
                    }
                    updateSelectionBar();
                } else {
                    if (isAddMode) {
                        multiSelectActive = true;
                        toggleBtn.textContent = "Cancel Selection";
                        gridEl.classList.add("multi-select-active");
                        selectedAssetIds = [assetId];
                        item.classList.add("selected");
                        updateSelectionBar();
                        return;
                    }
                    try {
                        const entries = await fetchEntriesForAsset(assetId);
                        if (entries.length === 0) {
                            showEntryModal([assetId], null, item.dataset.fileCreatedAt || null);
                        } else if (entries.length === 1) {
                            window.location.hash = `#/entry/${entries[0].id}`;
                        } else {
                            showEntryPickerModal(assetId, entries);
                        }
                    } catch {
                        showEntryModal([assetId]);
                    }
                }
            });
        });
    }

    prevBtn.addEventListener("click", () => { if (!prevBtn.disabled) loadPage(currentPage - 1); });
    nextBtn.addEventListener("click", () => { if (!nextBtn.disabled) loadPage(currentPage + 1); });

    await loadPage(1);
}


function removeSelectionBar() {
    const bar = document.querySelector(".selection-bar");
    if (bar) bar.remove();
    document.querySelector(".browse-container")?.classList.remove("has-selection-bar");
}

function extractAssets(data) {
    if (data.assets && data.assets.items) {
        return data.assets.items;
    }
    if (Array.isArray(data)) {
        return data;
    }
    return [];
}

function hasMorePages(data, currentPage, pageSize) {
    if (data.assets && data.assets.nextPage) {
        return true;
    }
    const items = extractAssets(data);
    return items.length === pageSize;
}

function showBrowseNotice(message, type = "info") {
    let notice = document.querySelector(".browse-notice");
    if (!notice) {
        notice = document.createElement("div");
        notice.className = "browse-notice";
        const container = document.querySelector(".browse-container");
        if (container) container.prepend(notice);
        else document.body.prepend(notice);
    }
    notice.textContent = message;
    notice.dataset.type = type;
    notice.classList.remove("browse-notice-hidden");
    clearTimeout(_noticeTimer);
    _noticeTimer = setTimeout(() => notice.classList.add("browse-notice-hidden"), 3500);
}

function skeletonGrid(count) {
    const header = `<div class="skeleton date-group-header-skeleton"></div>`;
    const items = Array.from({ length: count })
        .map(() => `<div class="skeleton skeleton-grid-item"></div>`)
        .join("");
    return header + items;
}
