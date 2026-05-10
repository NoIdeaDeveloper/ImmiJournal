import { getSettings, updateSettings, importJournal } from "../api.js";
import { applyTheme } from "../app.js";
import { showToast } from "../utils.js";

export async function renderSettings(container) {
    container.innerHTML = `
        <div class="settings-page">
            <h1 class="settings-title">Settings</h1>
            <div class="settings-section">
                <h2 class="settings-section-title">Appearance</h2>
                <div class="setting-item">
                    <label class="setting-label">
                        <span class="setting-description">
                            <strong>Theme</strong>
                            <span class="setting-subtext">Choose between dark and light mode</span>
                        </span>
                    </label>
                    <div class="theme-toggle-group">
                        <button class="theme-btn" id="theme-dark">🌙 Dark</button>
                        <button class="theme-btn" id="theme-light">☀️ Light</button>
                    </div>
                </div>
            </div>
            <div class="settings-section">
                <h2 class="settings-section-title">Journal Settings</h2>
                <div class="setting-item">
                    <label class="setting-label">
                        <input type="checkbox" id="auto-slide-toggle" class="setting-toggle">
                        <span class="setting-description">
                            <strong>Auto-sliding Gallery</strong>
                            <span class="setting-subtext">Automatically slide through multiple images in journal entries</span>
                        </span>
                    </label>
                </div>
                <div class="setting-item">
                    <label class="setting-label">
                        <input type="checkbox" id="confetti-toggle" class="setting-toggle">
                        <span class="setting-description">
                            <strong>Confetti on New Entry</strong>
                            <span class="setting-subtext">Show a confetti animation when you save a new journal entry</span>
                        </span>
                    </label>
                </div>
            </div>
            <div class="settings-section">
                <h2 class="settings-section-title">Data</h2>
                <div class="setting-item">
                    <span class="setting-description">
                        <strong>Export Journal</strong>
                        <span class="setting-subtext">Download all journal entries as a JSON file</span>
                    </span>
                    <a href="/api/journal/export" download class="btn btn-secondary">Export</a>
                </div>
                <div class="setting-item">
                    <span class="setting-description">
                        <strong>Import Journal</strong>
                        <span class="setting-subtext">Restore entries from a previously exported JSON file</span>
                    </span>
                    <label class="btn btn-secondary" style="cursor: pointer;">
                        Import
                        <input type="file" id="import-file" accept=".json" style="display: none;">
                    </label>
                </div>
                <p class="settings-about settings-about--warning">Re-importing the same file will create duplicate entries.</p>
                <div id="import-status" style="margin-top: 8px; font-size: 0.85rem;"></div>
            </div>
            <div class="settings-section">
                <h2 class="settings-section-title">About</h2>
                <p class="settings-about">ImmiJournal - A journaling app for your photos and memories.</p>
                <p class="settings-version">Version 1.0.0</p>
            </div>
            <div class="settings-section">
                <div class="setting-item">
                    <span class="setting-description">
                        <strong>Sign Out</strong>
                        <span class="setting-subtext">End your current session</span>
                    </span>
                    <button class="btn btn-secondary" id="logout-btn">Sign out</button>
                </div>
            </div>
        </div>
    `;

    // Track current settings so toggle handlers can send complete payloads
    let currentSettings = {
        auto_slide_gallery: true,
        theme: localStorage.getItem("theme") || "dark",
        confetti_enabled: true,
    };

    function getCurrentPayload() {
        return {
            auto_slide_gallery: document.getElementById("auto-slide-toggle").checked,
            theme: currentSettings.theme,
            confetti_enabled: document.getElementById("confetti-toggle").checked,
        };
    }

    function updateThemeButtons(theme) {
        document.getElementById("theme-dark").classList.toggle("active", theme === "dark");
        document.getElementById("theme-light").classList.toggle("active", theme === "light");
    }

    async function saveTheme(theme) {
        currentSettings.theme = theme;
        applyTheme(theme);
        updateThemeButtons(theme);
        try {
            await updateSettings(getCurrentPayload());
        } catch (err) {
            console.error("Failed to save theme:", err);
        }
    }

    try {
        const settings = await getSettings();
        currentSettings = { ...currentSettings, ...settings };

        updateThemeButtons(currentSettings.theme);

        document.getElementById("theme-dark").addEventListener("click", () => saveTheme("dark"));
        document.getElementById("theme-light").addEventListener("click", () => saveTheme("light"));

        // Auto-slide toggle
        document.getElementById("auto-slide-toggle").checked = settings.auto_slide_gallery ?? true;
        document.getElementById("auto-slide-toggle").addEventListener("change", async (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem("autoSlideEnabled", isEnabled.toString());
            try {
                await updateSettings(getCurrentPayload());
                showToast("Setting saved");
            } catch {
                e.target.checked = !isEnabled;
            }
        });

        // Confetti toggle
        const confettiEnabled = settings.confetti_enabled ?? true;
        document.getElementById("confetti-toggle").checked = confettiEnabled;
        localStorage.setItem("confettiEnabled", confettiEnabled.toString());

        document.getElementById("confetti-toggle").addEventListener("change", async (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem("confettiEnabled", isEnabled.toString());
            try {
                await updateSettings(getCurrentPayload());
                showToast("Setting saved");
            } catch {
                e.target.checked = !isEnabled;
                localStorage.setItem("confettiEnabled", (!isEnabled).toString());
            }
        });

    } catch (error) {
        console.error("Failed to load settings:", error);

        // Fallback from localStorage
        const localTheme = localStorage.getItem("theme") || "dark";
        updateThemeButtons(localTheme);
        document.getElementById("theme-dark").addEventListener("click", () => saveTheme("dark"));
        document.getElementById("theme-light").addEventListener("click", () => saveTheme("light"));

        const autoSlide = localStorage.getItem("autoSlideEnabled");
        if (autoSlide !== null) document.getElementById("auto-slide-toggle").checked = autoSlide === "true";

        const confetti = localStorage.getItem("confettiEnabled");
        document.getElementById("confetti-toggle").checked = confetti !== "false";
    }

    // Logout handler
    document.getElementById("logout-btn").addEventListener("click", async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch { /* ignore network errors */ }
        window.location.href = "/login";
    });

    // Import handler
    document.getElementById("import-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const statusEl = document.getElementById("import-status");
        statusEl.textContent = `Selected: ${file.name}`;
        statusEl.style.color = "var(--text-muted)";

        if (!window.confirm(`Import "${file.name}"? This will add all entries from the file. Re-importing the same file creates duplicates.`)) {
            e.target.value = "";
            statusEl.textContent = "";
            return;
        }

        statusEl.textContent = "Importing...";
        e.target.disabled = true;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const result = await importJournal(data);
            statusEl.textContent = `Imported ${result.imported} entries successfully.`;
            statusEl.style.color = "";
            showToast(`Imported ${result.imported} entries`);
        } catch (err) {
            statusEl.textContent = "Import failed: " + err.message;
            statusEl.style.color = "var(--danger)";
        } finally {
            e.target.disabled = false;
            e.target.value = "";
        }
    });
}

