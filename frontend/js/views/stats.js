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
                <div class="stat-card">
                    <div class="stat-value" id="current-streak">-</div>
                    <div class="stat-label">Day Streak</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="longest-streak">-</div>
                    <div class="stat-label">Longest Streak</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="most-active-month">-</div>
                    <div class="stat-label">Most Active Month</div>
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
        document.getElementById("current-streak").textContent = fmtStreak(stats.current_streak);
        document.getElementById("longest-streak").textContent = fmtStreak(stats.longest_streak);
        if (stats.by_month.length > 0) {
            const best = stats.by_month.reduce((a, b) => (b.count > a.count ? b : a));
            const [year, month] = best.month.split("-").map(Number);
            const localDate = new Date(year, month - 1, 1);
            document.getElementById("most-active-month").textContent =
                localDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        } else {
            document.getElementById("most-active-month").textContent = "—";
        }

        // Heatmap
        if (stats.by_day && stats.by_day.length > 0) {
            renderHeatmap(stats.by_day);
        } else {
            showChartEmpty("heatmap-container", ".heatmap-grid", "No activity yet — write your first entry!");
        }

        // Tag cloud
        if (stats.top_tags && stats.top_tags.length > 0) {
            renderTagCloud(stats.top_tags);
        } else {
            showChartEmpty("tagcloud-container", ".tag-cloud", "No tags yet — add tags to your entries.");
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

function fmtStreak(n) {
    return n > 0 ? `${n} day${n === 1 ? "" : "s"}` : "—";
}

function showChartEmpty(containerId, childSelector, message) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.style.display = "";
    el.querySelector(childSelector).innerHTML = `<p class="chart-error">${message}</p>`;
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

    // Add month labels along the top
    const monthRow = document.createElement("div");
    monthRow.className = "heatmap-month-labels";
    let lastMonth = -1;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const tempDate = new Date(startDate);
    let weekIndex = 0;
    while (tempDate <= today) {
        const m = tempDate.getMonth();
        if (m !== lastMonth) {
            const label = document.createElement("span");
            label.className = "heatmap-month-label";
            label.textContent = monthNames[m];
            // Position: each week is ~13px wide (cell + gap)
            label.style.gridColumn = `${weekIndex + 1}`;
            monthRow.appendChild(label);
            lastMonth = m;
        }
        if (tempDate.getDay() === 6 || tempDate >= today) {
            weekIndex++;
        }
        tempDate.setDate(tempDate.getDate() + 1);
    }
    container.insertBefore(monthRow, grid);

    // Add weekday labels
    const weekdayLabels = document.createElement("div");
    weekdayLabels.className = "heatmap-weekday-labels";
    ["", "Mon", "", "Wed", "", "Fri", ""].forEach(label => {
        const el = document.createElement("span");
        el.textContent = label;
        weekdayLabels.appendChild(el);
    });
    container.insertBefore(weekdayLabels, grid);

    const current = new Date(startDate);
    while (current <= today) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, "0");
        const d = String(current.getDate()).padStart(2, "0");
        const iso = `${y}-${m}-${d}`;
        const count = countMap[iso] || 0;
        let level = 0;
        if (count > 0) {
            if (maxCount <= 1) level = 4;
            else if (count >= maxCount * 0.75) level = 4;
            else if (count >= maxCount * 0.5) level = 3;
            else if (count >= maxCount * 0.25) level = 2;
            else level = 1;
        }
        const cell = document.createElement("button");
        cell.className = `heatmap-cell heat-${level}`;
        cell.title = count > 0 ? `${iso}: ${count} entr${count === 1 ? "y" : "ies"}` : iso;
        cell.setAttribute("aria-label", cell.title);
        // Clickable — navigate to feed filtered to that day
        if (count > 0) {
            cell.addEventListener("click", () => {
                window.location.hash = `#/?dateFrom=${iso}&dateTo=${iso}`;
            });
            cell.style.cursor = "pointer";
        }
        grid.appendChild(cell);
        current.setDate(current.getDate() + 1);
    }

    container.style.display = "";

    // Add legend
    const existingLegend = container.querySelector(".heatmap-legend");
    if (existingLegend) existingLegend.remove();
    const legend = document.createElement("div");
    legend.className = "heatmap-legend";
    legend.innerHTML = `<span>Less</span>` +
        [0, 1, 2, 3, 4].map(l => `<div class="heatmap-legend-cell heat-${l}"></div>`).join("") +
        `<span>More</span>`;
    container.appendChild(legend);
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
        return `<a class="entry-tag tag-cloud-item" href="#/?tag=${encodeURIComponent(tag)}" style="font-size:${size}rem">${escapeHtml(tag)}</a>`;
    }).join(" ");

    container.style.display = "";
}