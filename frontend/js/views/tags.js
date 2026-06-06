import { fetchTags, renameTag, deleteTag } from "../api.js";
import { escapeHtml, escapeAttr, showToast } from "../utils.js";

export async function renderTags(container) {
    container.innerHTML = `
        <div class="tags-page">
            <div class="tags-page-header">
                <h1 class="tags-page-title">Tag Management</h1>
                <a href="#/settings" class="btn btn-secondary btn-small">Back to Settings</a>
            </div>
            <p class="tags-page-description">Rename, merge, or delete tags. Renaming a tag to an existing name merges them.</p>
            <div class="tags-search-bar">
                <input type="search" id="tags-filter" class="tags-filter-input" placeholder="Filter tags…" autocomplete="off">
            </div>
            <div id="tags-list" class="tags-list">
                <div class="skeleton skeleton-line long"></div>
                <div class="skeleton skeleton-line medium"></div>
                <div class="skeleton skeleton-line short"></div>
            </div>
        </div>
    `;

    let allTags = [];

    const tagsListEl = document.getElementById("tags-list");
    const filterInput = document.getElementById("tags-filter");

    async function loadTags() {
        try {
            const data = await fetchTags();
            allTags = data.tags || [];
            renderTagList(allTags);
        } catch (err) {
            tagsListEl.innerHTML = `<div class="error-state"><p>Failed to load tags.</p><p>${escapeHtml(err.message)}</p></div>`;
        }
    }

    function renderTagList(tags) {
        if (tags.length === 0) {
            tagsListEl.innerHTML = `<div class="empty-state"><p>No tags found.</p></div>`;
            return;
        }

        tagsListEl.innerHTML = tags.map((t, i) => {
            const name = typeof t === "string" ? t : t.name;
            const count = typeof t === "string" ? 0 : t.usage_count;
            return `
                <div class="tag-manage-item" data-tag="${escapeAttr(name)}" data-index="${i}">
                    <div class="tag-manage-info">
                        <span class="tag-manage-name">${escapeHtml(name)}</span>
                        <span class="tag-manage-count">${count} ${count === 1 ? "entry" : "entries"}</span>
                    </div>
                    <div class="tag-manage-actions">
                        <button class="btn btn-small btn-secondary tag-rename-btn" data-tag="${escapeAttr(name)}">Rename</button>
                        <button class="btn btn-small btn-danger tag-delete-btn" data-tag="${escapeAttr(name)}">Delete</button>
                    </div>
                </div>
            `;
        }).join("");

        // Attach handlers
        tagsListEl.querySelectorAll(".tag-rename-btn").forEach(btn => {
            btn.addEventListener("click", () => showRenameUI(btn.dataset.tag));
        });
        tagsListEl.querySelectorAll(".tag-delete-btn").forEach(btn => {
            btn.addEventListener("click", () => confirmDelete(btn.dataset.tag));
        });
    }

    function showRenameUI(tagName) {
        const item = tagsListEl.querySelector(`.tag-manage-item[data-tag="${CSS.escape(tagName)}"]`);
        if (!item) return;

        // Don't double-add
        if (item.querySelector(".tag-rename-form")) return;

        const form = document.createElement("div");
        form.className = "tag-rename-form";
        form.innerHTML = `
            <input type="text" class="tag-rename-input" value="${escapeAttr(tagName)}" autocomplete="off">
            <button class="btn btn-small btn-primary tag-rename-save">Save</button>
            <button class="btn btn-small btn-ghost tag-rename-cancel">Cancel</button>
            <span class="tag-rename-error hidden"></span>
        `;
        item.appendChild(form);

        const input = form.querySelector(".tag-rename-input");
        input.focus();
        input.select();

        form.querySelector(".tag-rename-cancel").addEventListener("click", () => form.remove());

        form.querySelector(".tag-rename-save").addEventListener("click", async () => {
            const newName = input.value.trim();
            if (!newName || newName.toLowerCase() === tagName.toLowerCase()) {
                form.remove();
                return;
            }

            const saveBtn = form.querySelector(".tag-rename-save");
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving…";

            try {
                await renameTag(tagName, newName);
                showToast(`Tag renamed to "${newName}"`);
                await loadTags();
            } catch (err) {
                const errEl = form.querySelector(".tag-rename-error");
                errEl.textContent = err.message;
                errEl.classList.remove("hidden");
                saveBtn.disabled = false;
                saveBtn.textContent = "Save";
            }
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") form.querySelector(".tag-rename-save").click();
            if (e.key === "Escape") form.remove();
        });
    }

    function confirmDelete(tagName) {
        const item = tagsListEl.querySelector(`.tag-manage-item[data-tag="${CSS.escape(tagName)}"]`);
        if (!item) return;

        // Don't double-add
        if (item.querySelector(".tag-delete-confirm")) return;

        const confirm = document.createElement("div");
        confirm.className = "tag-delete-confirm";
        confirm.innerHTML = `
            <span>Delete "<strong>${escapeHtml(tagName)}</strong>" from all entries?</span>
            <button class="btn btn-small btn-danger tag-delete-confirm-btn">Delete</button>
            <button class="btn btn-small btn-ghost tag-delete-cancel-btn">Cancel</button>
        `;
        item.appendChild(confirm);

        confirm.querySelector(".tag-delete-cancel-btn").addEventListener("click", () => confirm.remove());

        confirm.querySelector(".tag-delete-confirm-btn").addEventListener("click", async () => {
            const delBtn = confirm.querySelector(".tag-delete-confirm-btn");
            delBtn.disabled = true;
            delBtn.textContent = "Deleting…";

            try {
                await deleteTag(tagName);
                showToast(`Tag "${tagName}" deleted`);
                await loadTags();
            } catch (err) {
                delBtn.disabled = false;
                delBtn.textContent = "Delete";
                showToast(`Failed to delete: ${err.message}`, "error");
            }
        });
    }

    // Filter
    let filterDebounce = null;
    filterInput.addEventListener("input", () => {
        clearTimeout(filterDebounce);
        filterDebounce = setTimeout(() => {
            const q = filterInput.value.trim().toLowerCase();
            if (!q) {
                renderTagList(allTags);
            } else {
                renderTagList(allTags.filter(t => {
                    const name = typeof t === "string" ? t : t.name;
                    return name.toLowerCase().includes(q);
                }));
            }
        }, 200);
    });

    await loadTags();
}
