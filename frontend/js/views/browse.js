import { fetchAssets, checkAssetsWithEntries, addAssetsToEntry, fetchEntry, fetchEntriesForAsset, getAllLinkedAssetIds, fetchAlbums, fetchAlbumDetail } from "../api.js";
import { renderPhotoGrid } from "../components/photoGrid.js";
import { showEntryModal, showEntryPickerModal } from "../components/modal.js";
import { escapeHtml, showToast } from "../utils.js";

let multiSelectActive = false;
let selectedAssetIds = [];

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
            ${isAddMode ? `<div class="add-mode-banner">Select photos to add to your entry, then click <strong>Add to Entry</strong>.</div>` : ""}
            <div class="browse-header">
                <h2 class="browse-title">${isAddMode ? 'Select Photos to Add' : 'Your Photos'}</h2>
                <div class="browse-header-actions">
                    <button class="btn btn-secondary" id="browse-view-toggle">📁 Albums</button>
                    <button class="btn btn-secondary" id="toggle-select">${isAddMode ? 'Cancel' : 'Select Multiple'}</button>
                    ${isAddMode ? `<button class="btn btn-primary" id="add-to-entry">Add to Entry</button>` : ''}
                </div>
            </div>
            <div class="browse-search-bar">
                <input type="search" id="browse-search" class="feed-search-input" placeholder="Search photos…" autocomplete="off">
            </div>
            <div class="photo-grid" id="photo-grid">
                ${skeletonGrid(12)}
            </div>
            <div class="pagination-controls" id="pagination-controls">
                <button class="btn btn-secondary" id="prev-page" disabled>← Previous</button>
                <span class="pagination-page-indicator" id="page-indicator">Page 1</span>
                <button class="btn btn-secondary" id="next-page" disabled>Next →</button>
            </div>
        </div>
    `;

    const gridEl = document.getElementById("photo-grid");
    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    const toggleBtn = document.getElementById("toggle-select");
    const addToEntryBtn = document.getElementById("add-to-entry");
    const searchInput = document.getElementById("browse-search");
    const viewToggleBtn = document.getElementById("browse-view-toggle");
    const pageIndicator = document.getElementById("page-indicator");

    let currentPage = 1;
    const pageSize = 100;
    let isLoading = false;
    let hasMore = true;
    let currentQuery = null;
    let isAlbumView = false;

    const returnToEntry = () => { window.location.hash = `#/entry/${entryIdForAdding}`; };

    // Auto-enable multi-select in add-mode so photos are immediately tappable
    if (isAddMode) {
        multiSelectActive = true;
        gridEl.classList.add("multi-select-active");
    }

    // Toggle multi-select mode
    toggleBtn.addEventListener("click", () => {
        if (isAddMode && multiSelectActive) {
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
                showToast("Select at least one photo to add.", "error");
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
                showToast("Failed to add images: " + err.message, "error");
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
            const data = await fetchAssets(page, pageSize, currentQuery);
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
            } else if (page === 1) {
                gridEl.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📷</div>
                        <h2>No photos found</h2>
                        <p>Your Immich library appears to be empty, or photos are still syncing.</p>
                    </div>`;
            }

            hasMore = hasMorePages(data, page, pageSize);
            currentPage = page;

            prevBtn.disabled = currentPage <= 1;
            nextBtn.disabled = !hasMore;
            pageIndicator.textContent = `Page ${currentPage}`;

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
                    const albumTag = gridEl.dataset.albumName || "";
                    showEntryModal([...selectedAssetIds], null, null, albumTag);
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
                            const albumTag = gridEl.dataset.albumName || "";
                            showEntryModal([assetId], null, item.dataset.fileCreatedAt || null, albumTag);
                        } else if (entries.length === 1) {
                            window.location.hash = `#/entry/${entries[0].id}`;
                        } else {
                            const albumTag = gridEl.dataset.albumName || "";
                            showEntryPickerModal(assetId, entries, albumTag);
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

    // Search photos
    let searchDebounce = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            const newQuery = searchInput.value.trim() || null;
            if (newQuery === currentQuery) return;
            currentQuery = newQuery;
            currentPage = 1;
            loadPage(1);
        }, 400);
    });

    // Album view toggle
    viewToggleBtn.addEventListener("click", () => {
        if (isAlbumView) {
            isAlbumView = false;
            viewToggleBtn.textContent = "📁 Albums";
            searchInput.style.display = "";
            document.querySelector(".browse-title").textContent = "Your Photos";
            pageIndicator.textContent = "Page 1";
            loadPage(1);
        } else {
            isAlbumView = true;
            viewToggleBtn.textContent = "📷 Photos";
            searchInput.style.display = "none";
            document.querySelector(".browse-title").textContent = "Albums";
            pageIndicator.textContent = "";
            loadAlbums();
        }
    });

    async function loadAlbums() {
        if (isLoading) return;
        isLoading = true;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        gridEl.innerHTML = skeletonGrid(12);

        try {
            const data = await fetchAlbums(1, 100);
            const albums = data.items || data || [];
            gridEl.innerHTML = "";

            if (albums.length === 0) {
                gridEl.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📁</div>
                        <h2>No albums found</h2>
                        <p>Create albums in Immich to browse them here.</p>
                    </div>`;
            } else {
                const fragment = document.createDocumentFragment();
                for (const album of albums) {
                    const card = document.createElement("button");
                    card.className = "album-card";
                    const coverAsset = album.albumThumbnailAssetId || (album.assets && album.assets[0]?.id);
                    card.innerHTML = `
                        ${coverAsset ? `<img class="album-card-cover" src="${thumbnailUrl(coverAsset)}" loading="lazy" alt="">` : `<div class="album-card-cover album-card-placeholder">📁</div>`}
                        <div class="album-card-info">
                            <span class="album-card-name">${escapeHtml(album.albumName || "Untitled")}</span>
                            <span class="album-card-count">${album.assetCount || 0} photos</span>
                        </div>
                    `;
                    card.addEventListener("click", () => loadAlbumAssets(album.id, album.albumName));
                    fragment.appendChild(card);
                }
                gridEl.appendChild(fragment);
            }

            hasMore = false;
            prevBtn.disabled = true;
            nextBtn.disabled = true;
        } catch (err) {
            gridEl.innerHTML = `
                <div class="error-state">
                    <p>Could not load albums.</p>
                    <p>${escapeHtml(err.message)}</p>
                </div>`;
        } finally {
            isLoading = false;
        }
    }

    async function loadAlbumAssets(albumId, albumName) {
        if (isLoading) return;
        isLoading = true;
        gridEl.innerHTML = skeletonGrid(12);

        try {
            const album = await fetchAlbumDetail(albumId);
            const assets = album.assets || [];
            gridEl.innerHTML = "";

            // Store album name for tag suggestion
            gridEl.dataset.albumName = albumName || "";

            if (assets.length === 0) {
                gridEl.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📷</div>
                        <h2>Album is empty</h2>
                        <p>This album has no photos.</p>
                    </div>`;
            } else {
                const assetIds = assets.map(a => a.id);
                const linkedAssetIds = await getLinkedAssetIds();
                let assetsWithEntries;
                if (_cacheLoaded) {
                    assetsWithEntries = new Set(assetIds.filter(id => linkedAssetIds.has(id)));
                } else {
                    assetsWithEntries = await checkAssetsWithEntries(assetIds);
                }

                // Add album context for tag suggestion
                gridEl.appendChild(renderPhotoGrid(assets, assetsWithEntries, existingAssetIds));
                attachGridClickHandlers(gridEl);
            }

            hasMore = false;
            prevBtn.disabled = true;
            nextBtn.disabled = true;
        } catch (err) {
            gridEl.innerHTML = `
                <div class="error-state">
                    <p>Could not load album.</p>
                    <p>${escapeHtml(err.message)}</p>
                </div>`;
        } finally {
            isLoading = false;
        }
    }

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


function skeletonGrid(count) {
    const header = `<div class="skeleton date-group-header-skeleton"></div>`;
    const items = Array.from({ length: count })
        .map(() => `<div class="skeleton skeleton-grid-item"></div>`)
        .join("");
    return header + items;
}
