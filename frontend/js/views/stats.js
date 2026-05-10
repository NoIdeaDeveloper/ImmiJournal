import { fetchJournalStats } from "../api.js";
import { renderMonthlyChart } from "../components/charts.js";
import { escapeHtml } from "../utils.js";

// Lazy load Chart.js only when stats view is loaded
export async function renderStats(container) {
    container.innerHTML = `
        <div class="stats-container">
            <h2 class="stats-title">Journal Statistics</h2>
            <div class="stats-summary">
                <div class="stat-card">
                    <div class="stat-value" id="total-entries">-</div>
                    <div class="stat-label">Total Entries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="active-months">-</div>
                    <div class="stat-label">Active Months</div>
                </div>
            </div>
            <div class="stats-charts">
                <div class="chart-container">
                    <h3>Entries by Month</h3>
                    <div class="chart-wrapper">
                        <canvas id="monthly-chart"></canvas>
                    </div>
                </div>
                <div class="chart-container" id="heatmap-container" style="display:none">
                    <h3>Activity Heatmap</h3>
                    <div id="heatmap-grid" class="heatmap-grid"></div>
                </div>
                <div class="chart-container" id="tagcloud-container" style="display:none">
                    <h3>Top Tags</h3>
                    <div id="tag-cloud" class="tag-cloud"></div>
                </div>
            </div>
        </div>
    `;
    
    try {
        // Fetch statistics from API
        const stats = await fetchJournalStats();
        
        // Update summary cards
        document.getElementById("total-entries").textContent = stats.total_entries;
        document.getElementById("active-months").textContent = stats.by_month.length;

        // Heatmap
        if (stats.by_day && stats.by_day.length > 0) {
            renderHeatmap(stats.by_day);
        }

        // Tag cloud
        if (stats.top_tags && stats.top_tags.length > 0) {
            renderTagCloud(stats.top_tags);
        }

        // Lazy load Chart.js only when needed
        try {
            await import('../vendor/chart.umd.min.js');
            // Render the chart only if Chart.js loaded successfully
            renderMonthlyChart("monthly-chart", stats.by_month);
        } catch (error) {
            console.error("Failed to load Chart.js:", error);
            document.querySelector('.chart-wrapper').innerHTML =
                '<p class="chart-error">Chart visualization unavailable</p>';
        }
        
    } catch (error) {
        console.error("Failed to load statistics:", error);
        container.innerHTML = `
            <div class="error-state">
                <p>Failed to load statistics.</p>
                <p>Please try again later.</p>
            </div>
        `;
    }
}

function renderHeatmap(byDay) {
    const container = document.getElementById("heatmap-container");
    const grid = document.getElementById("heatmap-grid");
    if (!container || !grid) return;

    const countMap = {};
    let maxCount = 0;
    for (const { day, count } of byDay) {
        countMap[day] = count;
        if (count > maxCount) maxCount = count;
    }

    // Build 52 weeks ending today
    const today = new Date();
    // Start from 52 weeks ago, aligned to Sunday
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364);
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);

    grid.innerHTML = "";

    const current = new Date(startDate);
    while (current <= today) {
        const iso = current.toISOString().slice(0, 10);
        const count = countMap[iso] || 0;
        let level = 0;
        if (count > 0) {
            if (maxCount <= 1) level = 4;
            else if (count >= maxCount * 0.75) level = 4;
            else if (count >= maxCount * 0.5) level = 3;
            else if (count >= maxCount * 0.25) level = 2;
            else level = 1;
        }
        const cell = document.createElement("div");
        cell.className = `heatmap-cell heat-${level}`;
        cell.title = count > 0 ? `${iso}: ${count} entr${count === 1 ? "y" : "ies"}` : iso;
        grid.appendChild(cell);
        current.setDate(current.getDate() + 1);
    }

    container.style.display = "";
}

function renderTagCloud(topTags) {
    const container = document.getElementById("tagcloud-container");
    const cloud = document.getElementById("tag-cloud");
    if (!container || !cloud) return;

    const counts = topTags.map(t => t.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    cloud.innerHTML = topTags.map(({ tag, count }) => {
        const ratio = maxCount === minCount ? 1 : (count - minCount) / (maxCount - minCount);
        const size = (0.75 + ratio * 0.75).toFixed(2);
        return `<a class="entry-tag tag-cloud-item" href="#/feed?tag=${encodeURIComponent(tag)}" style="font-size:${size}rem">${escapeHtml(tag)}</a>`;
    }).join(" ");

    container.style.display = "";
}