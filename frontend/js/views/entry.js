import { fetchEntry, deleteEntry, previewUrl, thumbnailUrl, removeAssetsFromEntry, fetchImmichConfig, getSettings } from "../api.js";
import { formatDate, escapeHtml, parseTags, renderMarkdown, wordStats } from "../utils.js";
import { showEntryModal, closeModal } from "../components/modal.js";

/**
 * Sets up an auto-sliding gallery for multi-photo entries
 * 
 * @param {HTMLElement} photosContainer - The container element holding the photos
 * @param {boolean} autoSlide - Whether to automatically start sliding (default: true)
 * 
 * @description
 * Creates a gallery with navigation controls that automatically slides through images.
 * Includes pause/play functionality, previous/next navigation, and hover-to-pause behavior.
 * Gracefully degrades if errors occur during setup.
 */
function setupAutoSlidingGallery(photosContainer, autoSlide = true) {
    try {
        const slideInterval = 5000; // 5 seconds between slides
        const pauseOnHover = true;
        
        let slideIntervalId = null;
        let isPaused = false;
        let currentPosition = 0;
        
        // Only set up sliding if there are multiple images
        const images = photosContainer.querySelectorAll("img");
        if (images.length <= 1) {
            return;
        }
        
        // Add gallery controls
        const controls = document.createElement("div");
        controls.className = "gallery-controls";
        controls.innerHTML = `
            <button class="gallery-control pause" title="Pause" aria-label="Pause">&#9646;&#9646;</button>
            <button class="gallery-control play hidden" title="Play" aria-label="Play">&#9654;</button>
            <button class="gallery-control prev" title="Previous">&#8249;</button>
            <button class="gallery-control next" title="Next">&#8250;</button>
        `;
        
        // Insert controls after the photos container
        photosContainer.parentNode.insertBefore(controls, photosContainer.nextSibling);
        
        // Style the gallery container for sliding
        photosContainer.style.overflow = "hidden";
        photosContainer.style.position = "relative";
        
        // Create a wrapper for the images
        const imagesWrapper = document.createElement("div");
        imagesWrapper.className = "images-wrapper";
        imagesWrapper.style.display = "flex";
        imagesWrapper.style.transition = "transform 0.5s ease-in-out";
        imagesWrapper.style.width = "fit-content";
        
        // Move images into wrapper
        while (photosContainer.firstChild) {
            imagesWrapper.appendChild(photosContainer.firstChild);
        }
        photosContainer.appendChild(imagesWrapper);
        
        function getSlideWidth() {
            const firstImg = imagesWrapper.querySelector("img");
            return firstImg ? firstImg.offsetWidth : photosContainer.clientWidth;
        }

        // Control functions
        function startSliding() {
            if (slideIntervalId || isPaused) return;

            slideIntervalId = setInterval(() => {
                if (isPaused) return;

                const slideWidth = getSlideWidth();
                const maxScroll = imagesWrapper.scrollWidth - photosContainer.clientWidth;
                currentPosition += slideWidth;

                if (currentPosition >= maxScroll) {
                    currentPosition = 0; // Loop back to start
                }

                imagesWrapper.style.transform = `translateX(-${currentPosition}px)`;
            }, slideInterval);
        }

        function stopSliding() {
            if (slideIntervalId) {
                clearInterval(slideIntervalId);
                slideIntervalId = null;
            }
        }

        function pauseSliding() {
            isPaused = true;
            stopSliding();
        }

        function resumeSliding() {
            isPaused = false;
            if (!slideIntervalId) {
                startSliding();
            }
        }

        function slideTo(position) {
            currentPosition = position;
            imagesWrapper.style.transform = `translateX(-${currentPosition}px)`;
        }

        function nextSlide() {
            const slideWidth = getSlideWidth();
            const maxScroll = imagesWrapper.scrollWidth - photosContainer.clientWidth;
            currentPosition += slideWidth;
            if (currentPosition >= maxScroll) {
                currentPosition = 0;
            }
            imagesWrapper.style.transform = `translateX(-${currentPosition}px)`;
        }

        function prevSlide() {
            const slideWidth = getSlideWidth();
            currentPosition -= slideWidth;
            if (currentPosition < 0) {
                currentPosition = imagesWrapper.scrollWidth - photosContainer.clientWidth;
            }
            imagesWrapper.style.transform = `translateX(-${currentPosition}px)`;
        }
        
        // Trackpad / mouse-wheel scroll
        let wheelThrottle = false;
        function onWheel(e) {
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (delta === 0 || wheelThrottle) return;
            e.preventDefault();
            wheelThrottle = true;
            if (delta > 0) nextSlide(); else prevSlide();
            setTimeout(() => { wheelThrottle = false; }, 100);
        }
        photosContainer.addEventListener("wheel", onWheel, { passive: false });

        // Event listeners for controls
        controls.querySelector(".pause").addEventListener("click", () => {
            pauseSliding();
            controls.querySelector(".pause").classList.add("hidden");
            controls.querySelector(".play").classList.remove("hidden");
        });
        
        controls.querySelector(".play").addEventListener("click", () => {
            resumeSliding();
            controls.querySelector(".play").classList.add("hidden");
            controls.querySelector(".pause").classList.remove("hidden");
        });
        
        controls.querySelector(".prev").addEventListener("click", prevSlide);
        controls.querySelector(".next").addEventListener("click", nextSlide);
        
        // Pause on hover
        if (pauseOnHover) {
            photosContainer.addEventListener("mouseenter", pauseSliding);
            photosContainer.addEventListener("mouseleave", resumeSliding);
        }
        
        // Start sliding automatically if enabled
        if (autoSlide) {
            startSliding();
        } else {
            // If auto-slide is disabled, show play button by default
            controls.querySelector(".pause").classList.add("hidden");
            controls.querySelector(".play").classList.remove("hidden");
        }
        
        // Store cleanup function for manual cleanup
        function cleanup() {
            stopSliding();
            if (controls && controls.className === "gallery-controls") {
                controls.querySelector(".pause")?.removeEventListener("click", pauseSliding);
                controls.querySelector(".play")?.removeEventListener("click", resumeSliding);
                controls.querySelector(".prev")?.removeEventListener("click", prevSlide);
                controls.querySelector(".next")?.removeEventListener("click", nextSlide);
                photosContainer.removeEventListener("mouseenter", pauseSliding);
                photosContainer.removeEventListener("mouseleave", resumeSliding);
            }
            photosContainer.removeEventListener("wheel", onWheel);
            window.removeEventListener("beforeunload", cleanup);
            window.removeEventListener("hashchange", cleanup);
        }
        photosContainer._cleanupGallery = cleanup;

        // Cleanup on real page unload or SPA hash navigation
        window.addEventListener("beforeunload", cleanup);
        window.addEventListener("hashchange", cleanup, { once: true });
        
    } catch (error) {
        console.error("Gallery setup failed:", error);
    }
}

/**
 * Renders a journal entry detail view
 * 
 * @param {HTMLElement} container - The DOM container to render the entry into
 * @param {string} entryId - The ID of the journal entry to fetch and render
 * 
 * @description
 * Fetches a journal entry from the API and renders it with photos, title, body, and action buttons.
 * Handles both single and multi-photo entries with appropriate layouts.
 * Includes error handling for failed API requests and image loading issues.
 * 
 * @returns {Promise<void>} Resolves when rendering is complete
 */
export async function renderEntry(container, entryId) {
    // Show loading skeleton while fetching data
    container.innerHTML = `
        <div class="entry-detail">
            <div class="skeleton" style="height: 300px; margin-bottom: 24px; border-radius: 8px;"></div>
            <div class="skeleton skeleton-line medium" style="height: 28px; margin-bottom: 12px;"></div>
            <div class="skeleton skeleton-line short" style="height: 14px; margin-bottom: 24px;"></div>
            <div class="skeleton skeleton-line long" style="height: 14px; margin-bottom: 8px;"></div>
            <div class="skeleton skeleton-line long" style="height: 14px; margin-bottom: 8px;"></div>
            <div class="skeleton skeleton-line medium" style="height: 14px;"></div>
        </div>
    `;

    try {
        // Clean up any existing gallery from previous entry
        const existingGallery = document.querySelector(".entry-detail-photos.multi");
        if (existingGallery && existingGallery._cleanupGallery) {
            existingGallery._cleanupGallery();
        }
        
        const [entry, immichConfig] = await Promise.all([
            fetchEntry(entryId),
            fetchImmichConfig().catch(() => null),
        ]);
        const isMulti = entry.immich_asset_ids.length > 1;

        const totalPhotos = entry.immich_asset_ids.length;
        function photoWrapper(id, index, lazy = true) {
            const altText = totalPhotos > 1 ? `Photo ${index + 1} of ${totalPhotos}` : "Photo";
            const link = immichConfig
                ? `<a class="immich-link" href="${immichConfig.immich_web_url}/photos/${id}" target="_blank" rel="noopener" title="View in Immich">&#x2197;</a>`
                : "";
            return `<div class="entry-photo-wrapper"><img src="${previewUrl(id)}"${lazy ? ' loading="lazy"' : ""} alt="${altText}" data-asset-id="${id}">${link}</div>`;
        }

        const entryTags = parseTags(entry.tags);
        let photosHtml;
        if (isMulti) {
            photosHtml = `
                <div class="entry-detail-photos multi">
                    ${entry.immich_asset_ids.map((id, i) => photoWrapper(id, i, i > 0)).join("")}
                </div>
            `;
        } else {
            photosHtml = `
                <div class="entry-detail-photos single">
                    ${photoWrapper(entry.immich_asset_ids[0], 0, false)}
                </div>
            `;
        }

        container.innerHTML = `
            <div class="entry-detail">
                ${photosHtml}
                <div id="image-load-errors" style="color: var(--accent); margin: 10px 0; display: none;">
                    Some images failed to load. <button id="retry-images" class="btn btn-small">Retry</button>
                </div>
                <div class="entry-detail-date">
                    ${formatDate(entry.created_at)}
                    ${entry.updated_at !== entry.created_at ? ` &middot; edited ${formatDate(entry.updated_at)}` : ""}
                </div>
                ${entry.title ? `<h2 class="entry-detail-title">${escapeHtml(entry.title)}</h2>` : ""}
                ${entryTags.length ? `<div class="entry-detail-tags">${entryTags.map(t => `<a class="entry-tag" href="#/feed?tag=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("")}</div>` : ""}
                <div class="entry-detail-body markdown-body">${renderMarkdown(entry.body)}</div>
                <div class="entry-detail-actions">
                    <button class="btn btn-secondary" id="entry-edit">Edit</button>
                    <button class="btn btn-danger" id="entry-delete">Delete</button>
                    <a href="#/" class="btn btn-secondary">Back to Journal</a>
                </div>
            </div>
        `;

        // Add error handling for image loading
        const errorHandler = (img) => {
            return () => {
                const errorDiv = document.getElementById("image-load-errors");
                if (errorDiv) {
                    errorDiv.style.display = "block";
                }
                // Fallback to thumbnail if original fails
                img.src = thumbnailUrl(img.dataset.assetId);
                // Remove error handler to prevent infinite loops
                img.onerror = null;
            };
        };

        // Add event listeners for all images
        container.querySelectorAll("img").forEach((img) => {
            if (img.dataset.assetId) {
                img.onerror = errorHandler(img);
            }
        });

        // Retry button — reset image src to force re-fetch without a full page reload
        const retryBtn = document.getElementById("retry-images");
        if (retryBtn) {
            retryBtn.addEventListener("click", () => {
                container.querySelectorAll("img[data-asset-id]").forEach(img => {
                    const src = img.src;
                    img.src = "";
                    img.src = src;
                });
            });
        }

        // Auto-sliding gallery for multi-photo entries
        if (isMulti) {
            const photosContainer = container.querySelector(".entry-detail-photos.multi");
            if (photosContainer) {
                try {
                    const settings = await getSettings();
                    const shouldAutoSlide = settings.auto_slide_gallery ?? true;
                    setupAutoSlidingGallery(photosContainer, shouldAutoSlide);
                } catch (error) {
                    console.warn("Failed to fetch settings, falling back to localStorage:", error);
                    const autoSlideEnabled = localStorage.getItem("autoSlideEnabled");
                    const shouldAutoSlide = autoSlideEnabled === null ? true : autoSlideEnabled === "true";
                    setupAutoSlidingGallery(photosContainer, shouldAutoSlide);
                }
            }
        }

        // Lightbox — all photos (single and multi)
        const allPhotos = Array.from(container.querySelectorAll(".entry-detail-photos img"));
        const photoSrcs = allPhotos.map(img => img.src);
        allPhotos.forEach((img, index) => {
            img.style.cursor = "zoom-in";
            img.addEventListener("click", () => showLightbox(photoSrcs, index));
        });

        // Edit
        document.getElementById("entry-edit").addEventListener("click", () => {
            showEntryModal(entry.immich_asset_ids, entry);
        });

        // Delete
        document.getElementById("entry-delete").addEventListener("click", () => {
            showDeleteConfirm(entry.id);
        });


    } catch (err) {
        container.innerHTML = `
            <div class="entry-detail">
                <div class="error-state">
                    <p>Could not load this entry.</p>
                    <p>${escapeHtml(err.message)}</p>
                    <a href="#/" class="btn btn-secondary">Back to Journal</a>
                </div>
            </div>
        `;
    }
}

/**
 * Displays a full-size image in a lightbox overlay
 * 
 * @param {string} src - The URL of the image to display
 * 
 * @description
 * Creates a modal lightbox that shows a full-size version of an image.
 * The lightbox can be dismissed by clicking anywhere on it or pressing the Escape key.
 * Automatically removes event listeners after use to prevent memory leaks.
 */
function showLightbox(srcs, startIndex = 0) {
    let current = startIndex;
    const total = srcs.length;

    const lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.innerHTML = `
        <button class="lightbox-close" aria-label="Close">&times;</button>
        ${total > 1 ? `
            <button class="lightbox-nav lightbox-prev" aria-label="Previous">&#8249;</button>
            <button class="lightbox-nav lightbox-next" aria-label="Next">&#8250;</button>
            <div class="lightbox-counter"><span id="lb-current">${current + 1}</span> / ${total}</div>
        ` : ""}
        <img src="${srcs[current]}" alt="Full size photo">
    `;

    document.body.style.overflow = "hidden";
    document.body.appendChild(lightbox);

    const img = lightbox.querySelector("img");
    const counterEl = lightbox.querySelector("#lb-current");

    function goTo(index) {
        current = (index + total) % total;
        img.src = srcs[current];
        if (counterEl) counterEl.textContent = current + 1;
    }

    function close() {
        lightbox.remove();
        document.body.style.overflow = "";
        document.removeEventListener("keydown", keyHandler);
    }

    // Close on dark background click only (not the image or controls)
    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) close();
    });

    lightbox.querySelector(".lightbox-close").addEventListener("click", close);

    if (total > 1) {
        lightbox.querySelector(".lightbox-prev").addEventListener("click", () => goTo(current - 1));
        lightbox.querySelector(".lightbox-next").addEventListener("click", () => goTo(current + 1));
    }

    function keyHandler(e) {
        if (e.key === "Escape") close();
        if (e.key === "ArrowRight" && total > 1) goTo(current + 1);
        if (e.key === "ArrowLeft" && total > 1) goTo(current - 1);
    }
    document.addEventListener("keydown", keyHandler);

    // Clean up if user navigates away without closing the lightbox
    window.addEventListener("hashchange", close, { once: true });
}

/**
 * Shows a confirmation dialog for deleting a journal entry
 * 
 * @param {string} entryId - The ID of the entry to delete
 * 
 * @description
 * Displays a modal dialog asking the user to confirm deletion of a journal entry.
 * If confirmed, calls the API to delete the entry and redirects to the journal feed.
 * Shows error messages if the deletion fails.
 */
function showDeleteConfirm(entryId) {
    const overlay = document.getElementById("modal-overlay");
    const container = document.getElementById("modal-container");
    const triggerEl = document.activeElement;

    container.innerHTML = `
        <h2 class="modal-title">Delete Entry</h2>
        <p style="margin-bottom: 20px; color: var(--text-muted);">Are you sure you want to delete this journal entry? This cannot be undone.</p>
        <div id="delete-error" class="modal-inline-error hidden"></div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="delete-cancel">Cancel</button>
            <button class="btn btn-danger" id="delete-confirm">Delete</button>
        </div>
    `;

    overlay.classList.remove("hidden");

    document.getElementById("delete-cancel").addEventListener("click", () => {
        closeModal();
        triggerEl?.focus();
    });

    document.getElementById("delete-confirm").addEventListener("click", async () => {
        const btn = document.getElementById("delete-confirm");
        btn.disabled = true;
        btn.textContent = "Deleting...";

        try {
            await deleteEntry(entryId);
            closeModal();
            window.location.hash = "#/";
        } catch (err) {
            btn.disabled = false;
            btn.textContent = "Delete";
            const errEl = document.getElementById("delete-error");
            errEl.textContent = "Failed to delete: " + err.message;
            errEl.classList.remove("hidden");
        }
    });
}



/**
 * Shows a modal for removing images from a journal entry
 * 
 * @param {string} entryId - The ID of the entry to remove images from
 * @param {Array<string>} currentAssetIds - Array of asset IDs currently in the entry
 * 
 * @description
 * Displays a modal dialog with checkboxes for each image in the entry.
 * Allows users to select multiple images for removal and confirms the action.
 * On successful removal, refreshes the entry view and shows a success message.
 * Handles errors and validates that at least one image is selected.
 */
export function showRemoveImagesModal(entryId, currentAssetIds) {
    const overlay = document.getElementById("modal-overlay");
    const container = document.getElementById("modal-container");

    container.innerHTML = `
        <h2 class="modal-title">Remove Images</h2>
        <p style="margin-bottom: 16px; color: var(--text-muted);">Tap images to mark them for removal.</p>
        <div id="remove-images-error" class="modal-inline-error hidden"></div>
        <div class="modal-asset-list">
            ${currentAssetIds.map(assetId => `
                <label class="modal-asset-item">
                    <input type="checkbox" value="${assetId}" class="asset-checkbox">
                    <img src="${thumbnailUrl(assetId)}" loading="lazy" alt="Photo">
                    <span class="asset-remove-overlay">&#10005;</span>
                </label>
            `).join("")}
        </div>
        <div class="modal-actions">
            <button class="btn btn-secondary" id="remove-images-cancel">Cancel</button>
            <button class="btn btn-danger" id="remove-images-confirm">Remove Selected</button>
        </div>
    `;

    overlay.classList.remove("hidden");

    document.getElementById("remove-images-cancel").addEventListener("click", closeModal);

    document.getElementById("remove-images-confirm").addEventListener("click", async () => {
        const btn = document.getElementById("remove-images-confirm");
        const errorEl = document.getElementById("remove-images-error");
        const checkboxes = document.querySelectorAll(".asset-checkbox:checked");
        const assetIds = Array.from(checkboxes).map(cb => cb.value);

        if (assetIds.length === 0) {
            errorEl.textContent = "Please select at least one image to remove.";
            errorEl.classList.remove("hidden");
            return;
        }

        errorEl.classList.add("hidden");
        btn.disabled = true;
        btn.textContent = "Removing...";

        try {
            await removeAssetsFromEntry(entryId, assetIds);
            closeModal();
            await renderEntry(document.getElementById("app-content"), entryId);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = "Remove Selected";
            errorEl.textContent = "Failed to remove images: " + err.message;
            errorEl.classList.remove("hidden");
        }
    });
}