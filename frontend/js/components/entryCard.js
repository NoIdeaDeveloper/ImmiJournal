import { thumbnailUrl } from "../api.js";
import { formatDate, escapeHtml, parseTags, wordStats } from "../utils.js";

export function renderEntryCard(entry) {
    if (!entry || !entry.id || !entry.immich_asset_ids || !Array.isArray(entry.immich_asset_ids) || entry.immich_asset_ids.length === 0) {
        console.error("Invalid entry data:", entry);
        const errorCard = document.createElement("div");
        errorCard.className = "error-card";
        errorCard.innerHTML = `<div class="error-card-content"><p>Invalid entry data</p></div>`;
        return errorCard;
    }

    const isMulti = entry.immich_asset_ids.length > 1;
    const card = document.createElement("a");
    card.href = `#/entry/${entry.id}`;
    card.className = "entry-card";

    const safeBody = entry.body || "";
    const safeTitle = entry.title || "";
    const safeSummary = entry.summary || "";
    const safeCreatedAt = entry.created_at || new Date().toISOString();
    const wasEdited = entry.updated_at && entry.updated_at !== entry.created_at;
    const tags = parseTags(entry.tags);

    // Show summary if provided, otherwise fall back to truncated body
    const previewText = safeSummary
        ? escapeHtml(safeSummary)
        : escapeHtml(truncate(safeBody, 200));

    const tagsHtml = tags.length
        ? `<div class="entry-card-tags">${tags.map(t => `<a class="entry-tag" href="#/feed?tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("")}</div>`
        : "";

    const { readingTime } = wordStats(safeBody);
    const dateHtml = `
        <span class="entry-card-date">${formatDate(safeCreatedAt)}</span>
        ${wasEdited ? `<span class="entry-card-edited">&middot; edited</span>` : ""}
        <span class="entry-reading-time">&middot; ${readingTime}</span>
    `;

    if (isMulti) {
        card.innerHTML = `
            <div class="photo-scroll-row">
                ${entry.immich_asset_ids
                    .map((id) => `<img src="${thumbnailUrl(id)}" loading="lazy" alt="Photo">`)
                    .join("")}
            </div>
            <div class="entry-card-body">
                ${safeTitle ? `<h3 class="entry-card-title">${escapeHtml(safeTitle)}</h3>` : ""}
                <p class="entry-card-text">${previewText}</p>
                ${tagsHtml}
                <div class="entry-card-meta">${dateHtml}</div>
            </div>
        `;
    } else {
        card.classList.add("entry-card-single");
        card.innerHTML = `
            <img class="entry-card-thumb" src="${thumbnailUrl(entry.immich_asset_ids[0])}" loading="lazy" alt="Photo">
            <div class="entry-card-body">
                ${safeTitle ? `<h3 class="entry-card-title">${escapeHtml(safeTitle)}</h3>` : ""}
                <p class="entry-card-text">${previewText}</p>
                ${tagsHtml}
                <div class="entry-card-meta">${dateHtml}</div>
            </div>
        `;
    }

    return card;
}

export function truncate(str, max) {
    if (!str || typeof str !== 'string') return "";
    if (str.length <= max) return str;
    return str.slice(0, max).trimEnd() + "...";
}
