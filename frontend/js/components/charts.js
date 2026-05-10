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
    // Prepare data for chart
    const labels = monthlyData.map(item => {
        const [year, month] = item.month.split("-");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", 
                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${monthNames[parseInt(month)-1]} ${year}`;
    });
    
    const counts = monthlyData.map(item => item.count);
    
    // Chart configuration
    const chartData = {
        labels: labels,
        datasets: [{
            label: "Entries",
            data: counts,
            backgroundColor: "rgba(75, 192, 192, 0.6)",
            borderColor: "rgba(75, 192, 192, 1)",
            borderWidth: 1
        }]
    };
    
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    stepSize: 1
                }
            }
        },
        plugins: {
            legend: {
                display: false
            }
        }
    };
    
    return renderBarChart(canvasId, chartData, chartOptions);
}