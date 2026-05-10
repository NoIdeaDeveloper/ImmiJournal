import { thumbnailUrl } from "../api.js";
import { formatDate, escapeAttr } from "../utils.js";

const _dateCache = {};

/**
 * Renders a grid of photo items as a DocumentFragment.
 *
 * @param {Array} assets - Array of Immich asset objects
 * @param {Set} assetsWithEntries - Set of asset IDs that have any journal entry
 * @param {Set} alreadyInEntry - Set of asset IDs already in the current entry (add-mode only)
 */
export function renderPhotoGrid(assets, assetsWithEntries, alreadyInEntry = new Set()) {
    const fragment = document.createDocumentFragment();
    let currentDate = null;

    for (const asset of assets) {
        const dayKey = asset.fileCreatedAt ? asset.fileCreatedAt.slice(0, 10) : null;
        const assetDate = dayKey ? (_dateCache[dayKey] ??= formatDate(asset.fileCreatedAt)) : null;
        if (assetDate && assetDate !== currentDate) {
            const header = document.createElement("div");
            header.className = "date-group-header";
            header.textContent = assetDate;
            fragment.appendChild(header);
            currentDate = assetDate;
        }

        const item = document.createElement("div");
        const isAlreadyAdded = alreadyInEntry.has(asset.id);
        const hasEntry = assetsWithEntries.has(asset.id);

        item.className = `photo-grid-item${isAlreadyAdded ? " already-in-entry" : ""}`;
        item.dataset.assetId = asset.id;
        if (asset.fileCreatedAt) item.dataset.fileCreatedAt = asset.fileCreatedAt;
        if (!isAlreadyAdded) {
            item.setAttribute("role", "button");
            item.setAttribute("tabindex", "0");
        }

        item.innerHTML = `
            <img src="${thumbnailUrl(asset.id)}" loading="lazy" alt="${escapeAttr(asset.originalFileName || 'Photo')}">
            <span class="entry-badge ${hasEntry && !isAlreadyAdded ? "" : "hidden"}" title="Has a journal entry">&#9998;</span>
            <span class="select-check">&#10003;</span>
            ${isAlreadyAdded ? `<span class="already-added-badge">&#10003; Added</span>` : ""}
        `;

        fragment.appendChild(item);
    }

    return fragment;
}
