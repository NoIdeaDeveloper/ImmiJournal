// Chart.js utility for rendering charts
// This file provides a wrapper around Chart.js library

export function renderBarChart(canvasId, data, options) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    return new Chart(ctx, {
        type: 'bar',
        data: data,
        options: options
    });
}

// Function to render monthly statistics chart
export function renderMonthlyChart(canvasId, monthlyData) {
    const labels = monthlyData.map(item => {
        const [year, month] = item.month.split("-");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${monthNames[parseInt(month)-1]} ${year}`;
    });

    const counts = monthlyData.map(item => item.count);

    // Read theme colors from CSS variables so the chart adapts to light/dark mode
    const style = getComputedStyle(document.documentElement);
    const accentRgb = style.getPropertyValue("--accent-rgb").trim();
    const textMuted = style.getPropertyValue("--text-muted").trim() || "#888";
    const border = style.getPropertyValue("--border").trim() || "#ddd";

    const chartData = {
        labels: labels,
        datasets: [{
            label: "Entries",
            data: counts,
            backgroundColor: `rgba(${accentRgb}, 0.5)`,
            borderColor: `rgba(${accentRgb}, 1)`,
            borderWidth: 1
        }]
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                ticks: { stepSize: 1, color: textMuted },
                grid: { color: border }
            },
            x: {
                ticks: { color: textMuted },
                grid: { color: border }
            }
        },
        plugins: {
            legend: { display: false }
        }
    };

    return renderBarChart(canvasId, chartData, chartOptions);
}