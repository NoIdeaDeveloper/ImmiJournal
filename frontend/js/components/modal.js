import { thumbnailUrl, createEntry, updateEntry } from "../api.js";
import { escapeHtml, escapeAttr } from "../utils.js";
import { showRemoveImagesModal } from "../views/entry.js";
import { launchConfetti } from "../confetti.js";
import { invalidateLinkedAssetIdsCache } from "../views/browse.js";

const overlay = document.getElementById("modal-overlay");
const container = document.getElementById("modal-container");

// Module-level handles so closeModal can clean them up
let _overlayClickHandler = null;
let _escHandler = null;
let _previousFocus = null;

const SUMMARY_MAX = 200;

/** Attach overlay-click and Escape-key dismissal handlers, replacing any previous ones. */
function _setupDismissal(closeFn) {
    if (_overlayClickHandler) overlay.removeEventListener("click", _overlayClickHandler);
    _overlayClickHandler = (e) => { if (e.target === overlay) closeFn(); };
    overlay.addEventListener("click", _overlayClickHandler);

    if (_escHandler) document.removeEventListener("keydown", _escHandler);
    _escHandler = (e) => { if (e.key === "Escape") closeFn(); };
    document.addEventListener("keydown", _escHandler);
}

/** Convert ISO timestamp or date string to YYYY-MM-DD for <input type="date"> */
function toDateInputValue(isoString) {
    if (!isoString) return new Date().toISOString().slice(0, 10);
    return isoString.slice(0, 10);
}

/** Convert YYYY-MM-DD from date input to ISO string at local midnight */
function dateInputToISO(dateStr) {
    if (!dateStr) return new Date().toISOString();
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day).toISOString();
}

export function showEntryModal(assetIds, existingEntry = null, photoCreatedAt = null) {
    _previousFocus = document.activeElement;
    const isEdit = existingEntry !== null;
    const todayISO = toDateInputValue(existingEntry?.created_at || photoCreatedAt || null);

    container.innerHTML = `
        <h2 class="modal-title">${isEdit ? "Edit Entry" : "Write"}</h2>
        <div class="modal-photos">
            ${assetIds.map((id) => `<img src="${thumbnailUrl(id)}" alt="Photo">`).join("")}
        </div>
        <div class="modal-field modal-field-body">
            <textarea id="modal-entry-body" class="modal-body-textarea" placeholder="Write about this moment...">${isEdit ? escapeHtml(existingEntry.body) : ""}</textarea>
            <div id="modal-body-error" class="modal-inline-error hidden">Please write something before saving.</div>
        </div>
        <div class="modal-secondary-fields">
            <div class="modal-field">
                <label for="modal-entry-title">Title <span class="modal-field-hint">(optional)</span></label>
                <input type="text" id="modal-entry-title" placeholder="Give this memory a title..."
                       value="${isEdit ? escapeAttr(existingEntry.title) : ""}">
            </div>
            <div class="modal-field">
                <label for="modal-entry-date">Date</label>
                <input type="date" id="modal-entry-date" value="${todayISO}">
            </div>
            <div class="modal-field">
                <label for="modal-entry-tags">Tags <span class="modal-field-hint">(comma-separated)</span></label>
                <input type="text" id="modal-entry-tags" placeholder="travel, family, vacation..."
                       value="${isEdit ? escapeAttr(existingEntry.tags || "") : ""}">
            </div>
            ${isEdit ? `
            <div class="modal-field">
                <label for="modal-entry-summary">
                    Summary
                    <span class="modal-field-hint">(shown on journal card)</span>
                </label>
                <textarea id="modal-entry-summary" class="modal-summary-input"
                          placeholder="A short summary shown on your journal feed..."
                          maxlength="${SUMMARY_MAX}">${escapeHtml(existingEntry.summary || "")}</textarea>
                <div class="summary-char-count">
                    <span id="summary-char-current">${(existingEntry.summary || "").length}</span> / ${SUMMARY_MAX} characters
                </div>
            </div>
            <div class="modal-field">
                <label>Manage Images</label>
                <div class="modal-image-actions">
                    <button class="btn btn-secondary" id="modal-add-images">Add Images</button>
                    ${existingEntry.immich_asset_ids.length > 1 ? `
                        <button class="btn btn-secondary" id="modal-remove-images">Remove Images</button>
                        <button class="btn btn-secondary" id="modal-reorder-images">Reorder Images</button>
                    ` : ''}
                </div>
            </div>
            ` : ''}
        </div>
        <div class="modal-actions">
            <div id="modal-save-error" class="modal-inline-error hidden"></div>
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">${isEdit ? "Save Changes" : "Save Entry"}</button>
        </div>
    `;

    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Summary character count (edit mode only)
    const summaryEl = document.getElementById("modal-entry-summary");
    if (summaryEl) {
        const charCountEl = document.getElementById("summary-char-current");
        summaryEl.addEventListener("input", () => {
            const len = summaryEl.value.length;
            charCountEl.textContent = len;
            charCountEl.classList.toggle("at-limit", len >= SUMMARY_MAX);
        });
    }

    // Auto-resize main textarea and clear validation error
    const textarea = document.getElementById("modal-entry-body");
    textarea.addEventListener("input", () => {
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
        document.getElementById("modal-body-error").classList.add("hidden");
    });

    // Focus the body textarea — the primary writing surface
    textarea.focus();

    // Cancel
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    _setupDismissal(closeModal);

    // Add/Remove image buttons (edit mode only)
    if (isEdit) {
        const addImagesBtn = document.getElementById("modal-add-images");
        const removeImagesBtn = document.getElementById("modal-remove-images");

        if (addImagesBtn) {
            addImagesBtn.addEventListener("click", () => {
                sessionStorage.setItem('addImagesToEntry', existingEntry.id);
                closeModal();
                window.location.hash = `#/browse?entry=${existingEntry.id}&mode=add`;
            });
        }

        if (removeImagesBtn) {
            removeImagesBtn.addEventListener("click", () => {
                closeModal();
                showRemoveImagesModal(existingEntry.id, existingEntry.immich_asset_ids);
            });
        }

        const reorderImagesBtn = document.getElementById("modal-reorder-images");
        if (reorderImagesBtn) {
            reorderImagesBtn.addEventListener("click", () => {
                closeModal();
                showReorderImagesModal(existingEntry.id, existingEntry.immich_asset_ids);
            });
        }
    }

    // Save
    document.getElementById("modal-save").addEventListener("click", async () => {
        const title = document.getElementById("modal-entry-title").value.trim();
        const tags = document.getElementById("modal-entry-tags").value.trim();
        const summary = document.getElementById("modal-entry-summary").value.trim();
        const body = document.getElementById("modal-entry-body").value.trim();
        const dateInput = document.getElementById("modal-entry-date").value;

        if (!body) {
            document.getElementById("modal-body-error").classList.remove("hidden");
            document.getElementById("modal-entry-body").focus();
            return;
        }

        const saveBtn = document.getElementById("modal-save");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
            let entry;
            if (isEdit) {
                entry = await updateEntry(existingEntry.id, {
                    title,
                    tags,
                    summary,
                    body,
                    immich_asset_ids: assetIds,
                    created_at: dateInput ? dateInputToISO(dateInput) : undefined,
                });
            } else {
                entry = await createEntry({
                    immich_asset_ids: assetIds,
                    title,
                    tags,
                    summary,
                    body,
                    created_at: dateInput ? dateInputToISO(dateInput) : undefined,
                });
            }
            closeModal();

            // Invalidate linked asset IDs cache so browse view reflects the new/updated entry
            invalidateLinkedAssetIdsCache();

            // Confetti on new entries (if enabled in settings)
            if (!isEdit && localStorage.getItem("confettiEnabled") !== "false") {
                launchConfetti();
            }

            window.location.hash = `#/entry/${entry.id}`;
        } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? "Save Changes" : "Save Entry";
            const errEl = document.getElementById("modal-save-error");
            errEl.textContent = "Failed to save: " + err.message;
            errEl.classList.remove("hidden");
        }
    });
}

export function showEntryPickerModal(assetId, entries) {
    container.innerHTML = `
        <h2 class="modal-title">Choose an Entry</h2>
        <p style="margin-bottom: 16px; color: var(--text-muted);">This photo belongs to multiple entries. Where would you like to go?</p>
        <div class="entry-picker-list">
            ${entries.map((e) => `
                <button class="entry-picker-item" data-entry-id="${e.id}">
                    <span style="flex: 1">${escapeHtml(e.title || "Untitled")}</span>
                    <span class="picker-date">${e.created_at ? e.created_at.slice(0, 10) : ""}</span>
                </button>
            `).join("")}
            <button class="entry-picker-item new-entry" id="picker-new">+ Create New Entry</button>
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="picker-cancel">Cancel</button>
        </div>
    `;

    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    _setupDismissal(closeModal);

    container.querySelectorAll(".entry-picker-item[data-entry-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
            closeModal();
            window.location.hash = `#/entry/${btn.dataset.entryId}`;
        });
    });

    document.getElementById("picker-new").addEventListener("click", () => {
        closeModal();
        showEntryModal([assetId]);
    });

    document.getElementById("picker-cancel").addEventListener("click", closeModal);
}

export function showReorderImagesModal(entryId, assetIds) {
    _previousFocus = document.activeElement;
    // Work on a mutable copy
    let ordered = [...assetIds];

    function buildList() {
        return ordered.map((id, i) => `
            <div class="reorder-item" draggable="true" data-id="${id}" data-index="${i}">
                <span class="reorder-handle" title="Drag to reorder">⠿</span>
                <img src="${thumbnailUrl(id)}" alt="Photo">
                <span class="reorder-index">${i + 1}</span>
            </div>
        `).join("");
    }

    function renderList() {
        document.getElementById("reorder-list").innerHTML = buildList();
        attachDragHandlers();
    }

    container.innerHTML = `
        <h2 class="modal-title">Reorder Images</h2>
        <p style="margin-bottom: 16px; color: var(--text-muted);">Drag images into the order you want them to appear.</p>
        <div class="reorder-list" id="reorder-list">${buildList()}</div>
        <div class="modal-actions">
            <div id="reorder-error" class="modal-inline-error hidden"></div>
            <button class="btn btn-secondary" id="reorder-cancel">Cancel</button>
            <button class="btn btn-primary" id="reorder-save">Save Order</button>
        </div>
    `;

    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    _setupDismissal(closeModal);

    let dragSrcIndex = null;

    function attachDragHandlers() {
        document.querySelectorAll(".reorder-item").forEach((item) => {
            item.addEventListener("dragstart", (e) => {
                dragSrcIndex = parseInt(item.dataset.index, 10);
                item.classList.add("dragging");
                e.dataTransfer.effectAllowed = "move";
            });
            item.addEventListener("dragend", () => {
                item.classList.remove("dragging");
                document.querySelectorAll(".reorder-item").forEach((el) => el.classList.remove("drag-over"));
            });
            item.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                document.querySelectorAll(".reorder-item").forEach((el) => el.classList.remove("drag-over"));
                item.classList.add("drag-over");
            });
            item.addEventListener("drop", (e) => {
                e.preventDefault();
                const dropIndex = parseInt(item.dataset.index, 10);
                if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;
                const [moved] = ordered.splice(dragSrcIndex, 1);
                ordered.splice(dropIndex, 0, moved);
                renderList();
            });
        });
    }

    attachDragHandlers();

    document.getElementById("reorder-cancel").addEventListener("click", closeModal);

    document.getElementById("reorder-save").addEventListener("click", async () => {
        const saveBtn = document.getElementById("reorder-save");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        try {
            await updateEntry(entryId, { immich_asset_ids: ordered });
            closeModal();
            window.location.hash = `#/entry/${entryId}`;
        } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Order";
            const errEl = document.getElementById("reorder-error");
            errEl.textContent = "Failed to save order: " + err.message;
            errEl.classList.remove("hidden");
        }
    });
}

export function closeModal() {
    overlay.classList.add("hidden");
    container.innerHTML = "";
    document.body.style.overflow = "";

    if (_overlayClickHandler) {
        overlay.removeEventListener("click", _overlayClickHandler);
        _overlayClickHandler = null;
    }
    if (_escHandler) {
        document.removeEventListener("keydown", _escHandler);
        _escHandler = null;
    }

    _previousFocus?.focus();
    _previousFocus = null;
}
