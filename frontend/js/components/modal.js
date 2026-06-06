import { thumbnailUrl, createEntry, updateEntry, fetchTags, fetchAssetDetail } from "../api.js";
import { escapeHtml, escapeAttr, formatDate, showToast, renderMarkdown } from "../utils.js";
import { showRemoveImagesModal } from "../views/entry.js";
import { launchConfetti } from "../confetti.js";
import { invalidateLinkedAssetIdsCache } from "../views/browse.js";

const overlay = document.getElementById("modal-overlay");
const container = document.getElementById("modal-container");

// Module-level handles so closeModal can clean them up
let _overlayClickHandler = null;
let _escHandler = null;
let _focusTrapHandler = null;
let _ctrlEnterHandler = null;
let _previousFocus = null;

const SUMMARY_MAX = 200;
const DRAFT_KEY = "immijournal_draft";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function saveDraft(data) {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    } catch { /* quota exceeded, ignore */ }
}

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (Date.now() - draft.ts > DRAFT_MAX_AGE_MS) {
            localStorage.removeItem(DRAFT_KEY);
            return null;
        }
        return draft;
    } catch { return null; }
}

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

/** Trap Tab/Shift+Tab focus within the modal container. */
function _setupFocusTrap() {
    if (_focusTrapHandler) container.removeEventListener("keydown", _focusTrapHandler);
    _focusTrapHandler = (e) => {
        if (e.key !== "Tab") return;
        const focusable = Array.from(container.querySelectorAll(
            'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
        )).filter((el) => !el.disabled && el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
    container.addEventListener("keydown", _focusTrapHandler);
}

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

/** Convert YYYY-MM-DD from date input to ISO string at UTC midnight.
 *  Uses UTC so the stored timestamp matches the displayed date regardless of
 *  the user's local timezone.
 */
function dateInputToISO(dateStr) {
    if (!dateStr) return new Date().toISOString();
    const [year, month, day] = dateStr.split("-").map(Number);
    if (
        !year || month < 1 || month > 12 || day < 1 || day > 31
    ) {
        return new Date().toISOString();
    }
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

export function showEntryModal(assetIds = [], existingEntry = null, photoCreatedAt = null, albumTag = "") {
    _previousFocus = document.activeElement;
    const isEdit = existingEntry !== null;
    const hasPhotos = assetIds.length > 0;
    const todayISO = toDateInputValue(existingEntry?.created_at || photoCreatedAt || null);

    // Check for stashed draft (only for new entries without photos)
    const draft = (!isEdit && !hasPhotos) ? loadDraft() : null;
    const initialTags = isEdit ? (existingEntry.tags || "") : (draft?.tags || (albumTag ? albumTag : ""));

    container.innerHTML = `
        <h2 class="modal-title">${isEdit ? "Edit Entry" : (hasPhotos ? "New Entry" : "New Journal Entry")}</h2>
        ${hasPhotos ? `
        <div class="modal-photos">
            ${assetIds.map((id) => `<img src="${thumbnailUrl(id)}" alt="Photo">`).join("")}
        </div>
        ` : ""}
        ${draft ? `
        <div class="draft-restore-banner">
            You have an unsaved draft from ${formatDate(new Date(draft.ts).toISOString())}.
            <button class="btn-link" id="draft-restore-btn">Restore</button>
            <button class="btn-link" id="draft-discard-btn">Discard</button>
        </div>
        ` : ""}
        <div class="modal-field">
            <label for="modal-entry-title">Title <span class="modal-field-hint">(optional)</span></label>
            <input type="text" id="modal-entry-title" placeholder="Give this memory a title..."
                   value="${isEdit ? escapeAttr(existingEntry.title) : (draft?.title || "")}">
        </div>
        <div class="modal-field modal-field-body">
            <div class="modal-body-toolbar">
                <button class="btn btn-small btn-ghost modal-preview-toggle" id="modal-preview-toggle" title="Toggle markdown preview">
                    <span class="preview-icon">Preview</span>
                </button>
            </div>
            <textarea id="modal-entry-body" class="modal-body-textarea" placeholder="Write about this moment..."></textarea>
            <div id="modal-body-preview" class="modal-body-preview hidden"></div>
            <div id="modal-body-error" class="modal-inline-error hidden">Please write something before saving.</div>
            <p class="modal-field-hint markdown-hint">Markdown supported: **bold**, *italic*, # headings, - lists, [links](url)</p>
        </div>
        <div class="modal-secondary-fields">
            <div class="modal-field">
                <label for="modal-entry-date">Date</label>
                <input type="date" id="modal-entry-date" value="${todayISO}">
            </div>
            <div class="modal-field">
                <label for="modal-entry-tags">Tags <span class="modal-field-hint">(comma-separated)</span></label>
                <div class="tags-input-wrapper">
                    <input type="text" id="modal-entry-tags" placeholder="travel, family, vacation..."
                           value="${escapeAttr(initialTags)}" autocomplete="off">
                    <div id="tags-autocomplete" class="tags-autocomplete hidden"></div>
                </div>
            </div>
            ${isEdit ? `
            <div class="modal-field">
                <label for="modal-entry-summary">
                    Summary
                    <span class="modal-field-hint">(shown on journal card)</span>
                </label>
                <textarea id="modal-entry-summary" class="modal-summary-input"
                          placeholder="A short summary shown on your journal feed..."
                          maxlength="${SUMMARY_MAX}"></textarea>
                <div class="summary-char-count">
                    <span id="summary-char-current">0</span> / ${SUMMARY_MAX} characters
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
    _setupFocusTrap();

    // Set textarea values via .value to avoid HTML double-encoding
    const textarea = document.getElementById("modal-entry-body");
    if (isEdit) textarea.value = existingEntry.body;
    else if (draft) textarea.value = draft.body || "";

    // Draft restore/discard handlers
    const draftRestoreBtn = document.getElementById("draft-restore-btn");
    const draftDiscardBtn = document.getElementById("draft-discard-btn");
    if (draftRestoreBtn) {
        draftRestoreBtn.addEventListener("click", () => {
            document.getElementById("modal-entry-title").value = draft.title || "";
            textarea.value = draft.body || "";
            document.getElementById("modal-entry-tags").value = draft.tags || "";
            document.getElementById("modal-entry-date").value = draft.date || todayISO;
            textarea.style.height = "auto";
            textarea.style.height = textarea.scrollHeight + "px";
            draftRestoreBtn.closest(".draft-restore-banner")?.remove();
        });
    }
    if (draftDiscardBtn) {
        draftDiscardBtn.addEventListener("click", () => {
            clearDraft();
            draftDiscardBtn.closest(".draft-restore-banner")?.remove();
        });
    }

    // Summary character count (edit mode only)
    const summaryEl = document.getElementById("modal-entry-summary");
    if (summaryEl) {
        summaryEl.value = existingEntry.summary || "";
        const charCountEl = document.getElementById("summary-char-current");
        charCountEl.textContent = summaryEl.value.length;
        summaryEl.addEventListener("input", () => {
            const len = summaryEl.value.length;
            charCountEl.textContent = len;
            charCountEl.classList.toggle("at-limit", len >= SUMMARY_MAX);
        });
    }
    textarea.addEventListener("input", () => {
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
        document.getElementById("modal-body-error").classList.add("hidden");
        // Update preview if visible
        if (!_previewHidden) {
            document.getElementById("modal-body-preview").innerHTML = renderMarkdown(textarea.value);
        }
    });

    // Markdown preview toggle
    let _previewHidden = true;
    const previewToggle = document.getElementById("modal-preview-toggle");
    const previewEl = document.getElementById("modal-body-preview");
    previewToggle.addEventListener("click", () => {
        _previewHidden = !_previewHidden;
        if (_previewHidden) {
            previewEl.classList.add("hidden");
            textarea.classList.remove("hidden");
            previewToggle.querySelector(".preview-icon").textContent = "Preview";
            previewToggle.classList.remove("active");
        } else {
            previewEl.innerHTML = renderMarkdown(textarea.value);
            previewEl.classList.remove("hidden");
            textarea.classList.add("hidden");
            previewToggle.querySelector(".preview-icon").textContent = "Edit";
            previewToggle.classList.add("active");
        }
    });

    // Focus the body textarea — the primary writing surface
    textarea.focus();

    // Fetch EXIF metadata for the first photo (new entries with photos only)
    if (hasPhotos && !isEdit) {
        fetchAssetDetail(assetIds[0]).then(asset => {
            // Pre-fill date from fileCreatedAt if not already set
            if (asset.fileCreatedAt && !photoCreatedAt) {
                document.getElementById("modal-entry-date").value = toDateInputValue(asset.fileCreatedAt);
            }

            // Build EXIF tag suggestions
            const suggestions = [];
            if (asset.exifInfo) {
                if (asset.exifInfo.city) suggestions.push(asset.exifInfo.city);
                if (asset.exifInfo.state) suggestions.push(asset.exifInfo.state);
                if (asset.exifInfo.country) suggestions.push(asset.exifInfo.country);
            }
            if (asset.people && asset.people.length > 0) {
                for (const person of asset.people.slice(0, 5)) {
                    if (person.name) suggestions.push(person.name);
                }
            }

            if (suggestions.length > 0) {
                const sugEl = document.createElement("div");
                sugEl.className = "exif-suggestions";
                sugEl.innerHTML = `<span class="exif-suggestions-label">Suggested tags:</span>` +
                    suggestions.map(s => `<button class="exif-suggestion-pill" data-tag="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join("");
                tagsInput.parentNode.appendChild(sugEl);

                sugEl.querySelectorAll(".exif-suggestion-pill").forEach(btn => {
                    btn.addEventListener("click", () => {
                        const tag = btn.dataset.tag;
                        const current = tagsInput.value.trim();
                        if (current) {
                            const existing = current.split(",").map(t => t.trim().toLowerCase());
                            if (!existing.includes(tag.toLowerCase())) {
                                tagsInput.value = current + ", " + tag;
                            }
                        } else {
                            tagsInput.value = tag;
                        }
                        btn.remove();
                    });
                });
            }
        }).catch(() => {});
    }

    // Tag autocomplete
    const tagsInput = document.getElementById("modal-entry-tags");
    const autocompleteEl = document.getElementById("tags-autocomplete");
    let allTags = [];
    let autocompleteIndex = -1;

    fetchTags().then(data => {
        allTags = (data.tags || []).map(t => (typeof t === "string" ? t : t.name).toLowerCase());
    }).catch(() => {});

    function showTagAutocomplete() {
        const val = tagsInput.value;
        const parts = val.split(",");
        const currentPart = (parts[parts.length - 1] || "").trim().toLowerCase();
        if (!currentPart) { autocompleteEl.classList.add("hidden"); return; }

        const existingTags = new Set(parts.slice(0, -1).map(t => t.trim().toLowerCase()).filter(Boolean));
        const matches = allTags.filter(t => t.startsWith(currentPart) && !existingTags.has(t)).slice(0, 8);
        if (matches.length === 0) { autocompleteEl.classList.add("hidden"); return; }

        autocompleteIndex = -1;
        autocompleteEl.innerHTML = matches.map((t, i) =>
            `<div class="tags-autocomplete-item" data-index="${i}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</div>`
        ).join("");
        autocompleteEl.classList.remove("hidden");

        autocompleteEl.querySelectorAll(".tags-autocomplete-item").forEach(item => {
            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                selectTag(item.dataset.tag);
            });
        });
    }

    function selectTag(tag) {
        const parts = tagsInput.value.split(",");
        parts[parts.length - 1] = " " + tag;
        tagsInput.value = parts.join(",").replace(/^,/, "").trim();
        autocompleteEl.classList.add("hidden");
        tagsInput.focus();
    }

    tagsInput.addEventListener("input", showTagAutocomplete);
    tagsInput.addEventListener("keydown", (e) => {
        const items = autocompleteEl.querySelectorAll(".tags-autocomplete-item");
        if (!items.length || autocompleteEl.classList.contains("hidden")) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle("active", i === autocompleteIndex));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
            items.forEach((el, i) => el.classList.toggle("active", i === autocompleteIndex));
        } else if (e.key === "Enter" || e.key === "Tab") {
            if (autocompleteIndex >= 0 && autocompleteIndex < items.length) {
                e.preventDefault();
                selectTag(items[autocompleteIndex].dataset.tag);
            }
        } else if (e.key === "Escape") {
            autocompleteEl.classList.add("hidden");
        }
    });
    tagsInput.addEventListener("blur", () => {
        setTimeout(() => autocompleteEl.classList.add("hidden"), 150);
    });

    // Draft autosave (new entries only, no photos)
    if (!isEdit && !hasPhotos) {
        const autosaveDraft = () => {
            saveDraft({
                title: document.getElementById("modal-entry-title").value,
                body: textarea.value,
                tags: tagsInput.value,
                date: document.getElementById("modal-entry-date").value,
            });
        };
        container.querySelectorAll("input, textarea").forEach(el => el.addEventListener("input", autosaveDraft));
    }

    if (_ctrlEnterHandler) container.removeEventListener("keydown", _ctrlEnterHandler);
    _ctrlEnterHandler = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            document.getElementById("modal-save")?.click();
        }
    };
    container.addEventListener("keydown", _ctrlEnterHandler);

    // Track whether any field has been modified so we can warn before discarding
    let _dirty = false;
    const markDirty = () => { _dirty = true; };
    container.querySelectorAll("input, textarea").forEach(el => el.addEventListener("input", markDirty));

    function closeWithGuard() {
        if (_dirty && !window.confirm("Discard unsaved changes?")) return;
        closeModal();
    }

    // Cancel
    document.getElementById("modal-cancel").addEventListener("click", closeWithGuard);
    _setupDismissal(closeWithGuard);

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
        const summary = document.getElementById("modal-entry-summary")?.value.trim() ?? "";
        const body = document.getElementById("modal-entry-body").value.trim();
        const dateInput = document.getElementById("modal-entry-date").value;

        if (!body) {
            // Switch to edit mode if in preview
            if (!_previewHidden) {
                previewToggle.click();
            }
            document.getElementById("modal-body-error").classList.remove("hidden");
            document.getElementById("modal-entry-body").focus();
            return;
        }

        const saveBtn = document.getElementById("modal-save");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
            const payload = {
                title, tags, summary, body,
                immich_asset_ids: assetIds,
                created_at: dateInput ? dateInputToISO(dateInput) : undefined,
            };
            const entry = isEdit
                ? await updateEntry(existingEntry.id, payload)
                : await createEntry(payload);
            closeModal();
            clearDraft();

            // Invalidate linked asset IDs cache so browse view reflects the new/updated entry
            invalidateLinkedAssetIdsCache();

            if (isEdit) {
                showToast("Entry saved");
            } else if (localStorage.getItem("confettiEnabled") !== "false") {
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

export function showEntryPickerModal(assetId, entries, albumTag = "") {
    container.innerHTML = `
        <h2 class="modal-title">Choose an Entry</h2>
        <p style="margin-bottom: 16px; color: var(--text-muted);">This photo belongs to multiple entries. Where would you like to go?</p>
        <div class="entry-picker-list">
            ${entries.map((e) => `
                <button class="entry-picker-item" data-entry-id="${e.id}">
                    <span style="flex: 1">${escapeHtml(e.title || "Untitled")}</span>
                    <span class="picker-date">${e.created_at ? formatDate(e.created_at) : ""}</span>
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
    _setupFocusTrap();

    _setupDismissal(closeModal);

    container.querySelectorAll(".entry-picker-item[data-entry-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
            closeModal();
            window.location.hash = `#/entry/${btn.dataset.entryId}`;
        });
    });

    document.getElementById("picker-new").addEventListener("click", () => {
        closeModal();
        showEntryModal([assetId], null, null, albumTag);
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
    _setupFocusTrap();

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
    if (_focusTrapHandler) {
        container.removeEventListener("keydown", _focusTrapHandler);
        _focusTrapHandler = null;
    }
    if (_ctrlEnterHandler) {
        container.removeEventListener("keydown", _ctrlEnterHandler);
        _ctrlEnterHandler = null;
    }

    _previousFocus?.focus();
    _previousFocus = null;
}
