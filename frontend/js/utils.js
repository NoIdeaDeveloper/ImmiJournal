/**
 * Render a Markdown string to safe HTML.
 * Supports: headings, bold, italic, inline code, code blocks, links, line breaks, paragraphs.
 */
export function renderMarkdown(md) {
    if (!md) return "";

    // Extract code blocks before escaping so we can restore them after.
    // This prevents the HTML-escaping pass from double-escaping code content.
    const codeBlocks = [];
    const placeholder = "\x00CODE\x00";
    let safe = md.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
        codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
        return placeholder;
    });

    // Escape all remaining user content so nothing outside of explicit
    // markdown syntax can inject HTML.
    safe = escapeHtml(safe);

    let html = safe
        // Restore pre-escaped code blocks
        .replace(new RegExp(placeholder, "g"), () => codeBlocks.shift())
        // Headings
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        // Bold & italic
        .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        // Inline code
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // Links [text](url) — only allow http/https
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        // Horizontal rule
        .replace(/^---$/gm, "<hr>")
        // Unordered lists
        .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
        // Wrap consecutive <li> in <ul>
        .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Paragraphs: split on blank lines, wrap non-block elements
    const blockTags = /^<(h[1-6]|pre|ul|hr|blockquote)/;
    html = html
        .split(/\n{2,}/)
        .map((block) => {
            const trimmed = block.trim();
            if (!trimmed) return "";
            if (blockTags.test(trimmed)) return trimmed;
            // Convert single newlines to <br> within paragraphs
            return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
        })
        .join("\n");

    return html;
}

/** Returns word count and estimated reading time for a string. */
export function wordStats(text) {
    if (!text) return { words: 0, readingTime: "< 1 min read" };
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.ceil(words / 200); // ~200 wpm average
    const readingTime = minutes <= 1 ? "< 1 min read" : `${minutes} min read`;
    return { words, readingTime };
}

export function formatDate(isoString) {
    return new Date(isoString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

/**
 * Safely escape HTML special characters to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string
 */
export function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Escape a string for safe use inside an HTML attribute value (e.g. value="...").
 */
export function escapeAttr(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Parse a comma-separated tag string into a trimmed, non-empty array.
 */
export function parseTags(tagString) {
    if (!tagString) return [];
    return tagString.split(",").map((t) => t.trim()).filter(Boolean);
}
