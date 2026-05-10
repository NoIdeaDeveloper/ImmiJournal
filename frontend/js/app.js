import { renderFeed } from "./views/feed.js";
import { renderBrowse } from "./views/browse.js";
import { renderEntry } from "./views/entry.js";
import { renderSettings } from "./views/settings.js";
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

function route() {
    const hash = window.location.hash || "#/";
    const [path, query] = hash.slice(2).split("?", 2);
    const parts = path.split("/");

    // Trigger fade-in animation on view change
    contentEl.style.animation = "none";
    contentEl.offsetHeight; // force reflow
    contentEl.style.animation = "fadeIn 0.2s ease";

    if (parts[0] === "" || parts[0] === undefined) {
        renderFeed(contentEl);
    } else if (parts[0] === "browse") {
        renderBrowse(contentEl);
    } else if (parts[0] === "entry" && parts[1]) {
        renderEntry(contentEl, parseInt(parts[1], 10));
    } else if (parts[0] === "settings") {
        renderSettings(contentEl);
    } else if (parts[0] === "stats") {
        // Import dynamically to avoid loading chart library unnecessarily
        import("./views/stats.js").then((module) => {
            module.renderStats(contentEl);
        }).catch((error) => {
            console.error("Failed to load stats module:", error);
            contentEl.innerHTML = `
                <div class="error-state">
                    <p>Failed to load statistics page.</p>
                </div>
            `;
        });
    }

    // Update active nav link
    document.querySelectorAll(".nav-link").forEach((link) => {
        const view = link.dataset.view;
        const isActive =
            (view === "feed" && (hash === "#/" || hash === "#")) ||
            (view === "browse" && hash.startsWith("#/browse")) ||
            (view === "settings" && hash.startsWith("#/settings")) ||
            (view === "stats" && hash.startsWith("#/stats"));
        link.classList.toggle("active", isActive);
    });
}

window.addEventListener("hashchange", route);
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
                <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
                <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Navigate photo gallery</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close modal / lightbox</td></tr>
                <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
            </table>
            <button class="btn btn-secondary" style="margin-top:16px" id="shortcut-close">Close</button>
        </div>
    `;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById("shortcut-close")?.addEventListener("click", () => overlay.remove());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.remove(); }, { once: true });
    document.body.appendChild(overlay);
}
