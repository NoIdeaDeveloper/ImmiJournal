import { fetchEntries, searchEntries, fetchOnThisDay, fetchRandomEntry, fetchJournalStats } from "../api.js";
import { renderEntryCard } from "../components/entryCard.js";
import { escapeHtml } from "../utils.js";

export async function renderFeed(container) {
    // Parse optional tag filter from URL hash e.g. #/feed?tag=travel
    const hashQuery = window.location.hash.includes("?")
        ? window.location.hash.slice(window.location.hash.indexOf("?") + 1)
        : "";
    const urlParams = new URLSearchParams(hashQuery);
    const initialTag = urlParams.get("tag") || "";

    container.innerHTML = `
        <div class="feed-container">
            <div class="feed-header-row">
                <h2 class="feed-header">My Journal</h2>
                <div class="feed-header-actions">
                    <span id="streak-pill" class="streak-pill" style="display:none"></span>
                    <button id="surprise-btn" class="btn btn-secondary btn-small">Surprise me</button>
                </div>
            </div>
            <div id="on-this-day-banner"></div>
            <div class="feed-filters">
                <input
                    type="search"
                    id="feed-search"
                    class="feed-search-input"
                    placeholder="Search entries…"
                    autocomplete="off"
                >
                <div class="feed-date-filters">
                    <label class="feed-date-label">From <input type="date" id="feed-date-from" class="feed-date-input"></label>
                    <label class="feed-date-label">To <input type="date" id="feed-date-to" class="feed-date-input"></label>
                    <button class="btn btn-small btn-ghost" id="feed-clear-filters" style="display:none">Clear filters</button>
                </div>
            </div>
            <div class="feed-entries" id="feed-entries">
                ${skeletonCards(3)}
            </div>
            <div class="load-more-container hidden" id="feed-load-more">
                <button class="btn btn-secondary">Load more</button>
            </div>
        </div>
    `;

    let currentPage = 1;
    const pageSize = 20;
    let currentQuery = "";
    let currentDateFrom = "";
    let currentDateTo = "";
    let currentTag = initialTag;

    const entriesEl = document.getElementById("feed-entries");
    const loadMoreEl = document.getElementById("feed-load-more");
    const searchInput = document.getElementById("feed-search");
    const dateFromInput = document.getElementById("feed-date-from");
    const dateToInput = document.getElementById("feed-date-to");
    const clearBtn = document.getElementById("feed-clear-filters");
    const streakPill = document.getElementById("streak-pill");
    const onThisDayBanner = document.getElementById("on-this-day-banner");
    const surpriseBtn = document.getElementById("surprise-btn");

    function updateClearButton() {
        const hasFilters = currentQuery.trim() || currentDateFrom || currentDateTo || currentTag;
        clearBtn.style.display = hasFilters ? "inline-block" : "none";
    }

    async function loadPage(page) {
        if (currentQuery.trim()) {
            return searchEntries(currentQuery, page, pageSize);
        }
        return fetchEntries(page, pageSize, {
            dateFrom: currentDateFrom || undefined,
            dateTo: currentDateTo || undefined,
            tag: currentTag || undefined,
        });
    }

    const hasActiveFilters = () => currentQuery.trim() || currentDateFrom || currentDateTo || currentTag;

    async function renderFirstPage() {
        currentPage = 1;
        entriesEl.innerHTML = skeletonCards(3);
        loadMoreEl.classList.add("hidden");
        updateClearButton();

        // On first unfiltered load, fetch On This Day + stats in parallel
        const isUnfiltered = !hasActiveFilters();
        const sidePromises = isUnfiltered
            ? [fetchOnThisDay().catch(() => []), fetchJournalStats().catch(() => null)]
            : [Promise.resolve(null), Promise.resolve(null)];

        try {
            const [data, [onThisDayEntries, stats]] = await Promise.all([
                loadPage(1),
                Promise.all(sidePromises),
            ]);

            // Streak pill
            if (stats && stats.current_streak > 0) {
                const label = stats.current_streak === 1 ? "day streak" : "day streak";
                streakPill.textContent = `\uD83D\uDD25 ${stats.current_streak} ${label}`;
                streakPill.style.display = "inline-flex";
                if (stats.current_streak >= 7) streakPill.classList.add("streak-pill--hot");
            }

            // On This Day banner
            if (isUnfiltered && onThisDayEntries && onThisDayEntries.length > 0) {
                const bannerEl = document.createElement("div");
                bannerEl.className = "on-this-day-banner";
                bannerEl.innerHTML = `<h3 class="on-this-day-title">On this day</h3>`;
                const list = document.createElement("div");
                list.className = "on-this-day-list";
                for (const entry of onThisDayEntries) {
                    list.appendChild(renderEntryCard(entry));
                }
                bannerEl.appendChild(list);
                onThisDayBanner.innerHTML = "";
                onThisDayBanner.appendChild(bannerEl);
            } else {
                onThisDayBanner.innerHTML = "";
            }

            entriesEl.innerHTML = "";

            if (!data || !data.entries || !Array.isArray(data.entries)) {
                entriesEl.innerHTML = `<div class="error-state"><p>Received unexpected data from server.</p></div>`;
                return;
            }

            if (data.entries.length === 0) {
                if (hasActiveFilters()) {
                    entriesEl.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">🔍</div>
                            <h2>Nothing found</h2>
                            <p>Try different keywords or date range.</p>
                            <button class="btn-link" id="empty-clear-filters">Clear filters</button>
                        </div>
                    `;
                    document.getElementById("empty-clear-filters")?.addEventListener("click", () => clearBtn.click());
                } else {
                    entriesEl.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">📷</div>
                            <h2>Your journal is waiting</h2>
                            <p>Browse your photos and write about your memories.</p>
                            <a href="#/browse" class="btn btn-primary">Start with a photo</a>
                        </div>
                    `;
                    document.title = "Journal Empty - ImmiJournal";
                }
                return;
            }

            const fragment = document.createDocumentFragment();
            for (const entry of data.entries) {
                try {
                    fragment.appendChild(renderEntryCard(entry));
                } catch (renderError) {
                    console.error(`Failed to render entry ${entry.id}:`, renderError);
                }
            }
            entriesEl.appendChild(fragment);

            if (data.total > currentPage * pageSize) {
                loadMoreEl.classList.remove("hidden");
                const btn = loadMoreEl.querySelector("button");
                btn.textContent = "Load more";
                btn.disabled = false;
            }
        } catch (err) {
            console.error("Failed to load journal entries:", err);
            entriesEl.innerHTML = `
                <div class="error-state">
                    <p>Could not load journal entries.</p>
                    <p>${escapeHtml(err.message)}</p>
                </div>
            `;
        }
    }

    await renderFirstPage();

    // Surprise me button
    surpriseBtn.addEventListener("click", async () => {
        surpriseBtn.innerHTML = `Surprise me <span class="spinner"></span>`;
        surpriseBtn.disabled = true;
        try {
            const entry = await fetchRandomEntry();
            window.location.hash = `#/entry/${entry.id}`;
        } catch (err) {
            console.error("Failed to fetch random entry:", err);
        } finally {
            surpriseBtn.textContent = "Surprise me";
            surpriseBtn.disabled = false;
        }
    });

    // Load more
    const loadMoreBtn = loadMoreEl.querySelector("button");

    // Declared before loadNextPage so the closure can reference it
    const loadMoreObserver = new IntersectionObserver(
        (entries) => { if (entries[0].isIntersecting) loadNextPage(); },
        { rootMargin: "200px" }
    );

    async function loadNextPage() {
        if (loadMoreBtn.disabled) return;
        currentPage++;
        loadMoreBtn.innerHTML = `Loading… <span class="spinner"></span>`;
        loadMoreBtn.disabled = true;
        try {
            const moreData = await loadPage(currentPage);
            const fragment = document.createDocumentFragment();
            for (const entry of moreData.entries) {
                fragment.appendChild(renderEntryCard(entry));
            }
            entriesEl.appendChild(fragment);
            if (moreData.total <= currentPage * pageSize) {
                loadMoreEl.innerHTML = `<p class="all-caught-up">✓ You're all caught up</p>`;
                loadMoreObserver.disconnect();
            } else {
                loadMoreBtn.textContent = "Load more";
                loadMoreBtn.disabled = false;
            }
        } catch (err) {
            loadMoreBtn.textContent = "Load more";
            loadMoreBtn.disabled = false;
        }
    }

    loadMoreBtn.addEventListener("click", loadNextPage);
    loadMoreObserver.observe(loadMoreBtn);

    // Debounced search
    let debounceTimer = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (!document.getElementById("feed-entries")) return;
            const newQuery = searchInput.value;
            if (newQuery === currentQuery) return;
            currentQuery = newQuery;
            currentTag = "";
            renderFirstPage();
        }, 300);
    });

    // Disconnect observer and cancel debounce when navigating away (SPA teardown)
    function onHashChange() {
        loadMoreObserver.disconnect();
        clearTimeout(debounceTimer);
        window.removeEventListener("hashchange", onHashChange);
    }
    window.addEventListener("hashchange", onHashChange);

    // Date filters
    dateFromInput.addEventListener("change", () => {
        currentQuery = "";
        currentTag = "";
        searchInput.value = "";
        currentDateFrom = dateFromInput.value;
        renderFirstPage();
    });
    dateToInput.addEventListener("change", () => {
        currentQuery = "";
        currentTag = "";
        searchInput.value = "";
        currentDateTo = dateToInput.value;
        renderFirstPage();
    });

    // If there's an initial tag filter, show the clear button
    if (initialTag) updateClearButton();

    // Clear filters
    clearBtn.addEventListener("click", () => {
        currentQuery = "";
        currentDateFrom = "";
        currentDateTo = "";
        currentTag = "";
        searchInput.value = "";
        dateFromInput.value = "";
        dateToInput.value = "";
        window.history.replaceState(null, "", "#/");
        renderFirstPage();
    });
}

function skeletonCards(count) {
    return Array.from({ length: count })
        .map(
            () => `
        <div class="skeleton-card">
            <div class="skeleton skeleton-thumb"></div>
            <div class="skeleton-body">
                <div class="skeleton skeleton-line short"></div>
                <div class="skeleton skeleton-line long"></div>
                <div class="skeleton skeleton-line medium"></div>
            </div>
        </div>
    `
        )
        .join("");
}
