import { getSettings } from "./api.js";

const contentEl = document.getElementById("app-content");

// Apply theme immediately from localStorage to avoid flash, then reconcile with API
export function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
}

applyTheme(localStorage.getItem("theme") || "dark");

getSettings().then((settings) => {
    if (settings.theme) applyTheme(settings.theme);
}).catch(() => {});

let _prevHash = "#/";

function route() {
    const hash = window.location.hash || "#/";
    const [path, query] = hash.slice(2).split("?", 2);
    const parts = path.split("/");

    // Trigger fade-in animation on view change
    contentEl.style.animation = "none";
    contentEl.offsetHeight; // force reflow
    contentEl.style.animation = "fadeIn 0.2s ease";

    const _viewError = (name, err) => {
        console.error(`Failed to load ${name} module:`, err);
        contentEl.innerHTML = `<div class="error-state"><p>Failed to load ${name} page.</p></div>`;
    };

    if (parts[0] === "" || parts[0] === undefined) {
        document.title = "Journal — ImmiJournal";
        import("./views/feed.js").then((m) => m.renderFeed(contentEl)).catch((e) => _viewError("journal", e));
    } else if (parts[0] === "browse") {
        document.title = "Browse Photos — ImmiJournal";
        import("./views/browse.js").then((m) => m.renderBrowse(contentEl)).catch((e) => _viewError("browse", e));
    } else if (parts[0] === "entry" && parts[1]) {
        document.title = "Entry — ImmiJournal";
        const entryId = parseInt(parts[1], 10);
        import("./views/entry.js").then((m) => m.renderEntry(contentEl, entryId, _prevHash)).catch((e) => _viewError("entry", e));
    } else if (parts[0] === "settings") {
        document.title = "Settings — ImmiJournal";
        import("./views/settings.js").then((m) => m.renderSettings(contentEl)).catch((e) => _viewError("settings", e));
    } else if (parts[0] === "stats") {
        document.title = "Statistics — ImmiJournal";
        import("./views/stats.js").then((m) => m.renderStats(contentEl)).catch((e) => _viewError("statistics", e));
    }

    // Update active nav link — entry detail is part of the Journal section
    document.querySelectorAll(".nav-link").forEach((link) => {
        const view = link.dataset.view;
        const isActive =
            (view === "feed" && (hash === "#/" || hash === "#" || hash.startsWith("#/entry"))) ||
            (view === "browse" && hash.startsWith("#/browse")) ||
            (view === "settings" && hash.startsWith("#/settings")) ||
            (view === "stats" && hash.startsWith("#/stats"));
        link.classList.toggle("active", isActive);
    });
}

window.addEventListener("hashchange", (e) => {
    const prev = new URL(e.oldURL).hash || "#/";
    if (!prev.startsWith("#/entry")) _prevHash = prev;
    route();
});
window.addEventListener("DOMContentLoaded", route);

// Global keyboard shortcuts
document.addEventListener("keydown", (e) => {
    // Skip when typing in an input, textarea, or contenteditable
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    // Skip if a modifier key is held (except Shift for ? help)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const hash = window.location.hash || "#/";

    switch (e.key) {
        case "j":
        case "g":
            // Go to journal feed
            window.location.hash = "#/";
            break;
        case "b":
            // Go to browse photos
            window.location.hash = "#/browse";
            break;
        case "s":
            // Go to settings
            window.location.hash = "#/settings";
            break;
        case "t":
            // Go to stats
            window.location.hash = "#/stats";
            break;
        case "/":
            // Focus search bar if on feed
            e.preventDefault();
            document.getElementById("feed-search")?.focus();
            break;
        case "ArrowLeft":
        case "ArrowRight": {
            // Navigate gallery within an entry detail view
            const gallery = document.querySelector(".entry-detail-photos.multi .gallery-control");
            if (!gallery) break;
            const btn = e.key === "ArrowLeft"
                ? document.querySelector(".gallery-control.prev")
                : document.querySelector(".gallery-control.next");
            btn?.click();
            break;
        }
        case "?": {
            // Show keyboard shortcut help
            _toggleShortcutHelp();
            break;
        }
    }
});

function _toggleShortcutHelp() {
    const existing = document.getElementById("shortcut-help-overlay");
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement("div");
    overlay.id = "shortcut-help-overlay";
    overlay.innerHTML = `
        <div class="shortcut-help-box">
            <h3>Keyboard Shortcuts</h3>
            <table class="shortcut-table">
                <tr><td><kbd>j</kbd> or <kbd>g</kbd></td><td>Go to Journal feed</td></tr>
                <tr><td><kbd>b</kbd></td><td>Browse photos</td></tr>
                <tr><td><kbd>s</kbd></td><td>Settings</td></tr>
                <tr><td><kbd>t</kbd></td><td>Statistics</td></tr>
                <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
                <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Navigate photo gallery</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close modal / lightbox</td></tr>
                <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
            </table>
            <button class="btn btn-secondary" style="margin-top:16px" id="shortcut-close">Close</button>
        </div>
    `;
    function _closeHelp() {
        overlay.remove();
        document.removeEventListener("keydown", _escHelp);
    }
    function _escHelp(e) { if (e.key === "Escape") _closeHelp(); }

    overlay.addEventListener("click", (e) => { if (e.target === overlay) _closeHelp(); });
    document.getElementById("shortcut-close")?.addEventListener("click", _closeHelp);
    document.addEventListener("keydown", _escHelp);
    document.body.appendChild(overlay);
}
