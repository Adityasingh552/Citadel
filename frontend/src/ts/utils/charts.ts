/** High-performance Chart.js integration for premium dashboard metrics. */

import type { ChartDataPoint } from '../types/index.js';
import { Chart, registerables, type ChartConfiguration, type ScriptableContext } from 'chart.js';

Chart.register(...registerables);

/** Read a CSS custom property from :root */
function cssVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function renderBarChart(
    canvas: HTMLCanvasElement,
    data: ChartDataPoint[],
    options?: { barColor?: string },
): void {
    // Destroy previous chart if it exists
    Chart.getChart(canvas)?.destroy();

    const gridColor = cssVar('--chart-grid', 'rgba(255,255,255,0.05)');
    const labelColor = cssVar('--chart-label', '#64748b');
    const primaryStr = options?.barColor || cssVar('--chart-bar', '#6366f1');

    const config: ChartConfiguration<'bar'> = {
        type: 'bar',
        data: {
            labels: data.map(d => d.label),
            datasets: [{
                label: 'Events',
                data: data.map(d => d.value),
                backgroundColor: (context: ScriptableContext<'bar'>) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                    gradient.addColorStop(0, primaryStr);
                    gradient.addColorStop(1, 'rgba(0,0,0,0)');
                    return gradient;
                },
                borderColor: primaryStr,
                borderWidth: 1,
                borderSkipped: false,
                borderRadius: 4,
                hoverBackgroundColor: primaryStr,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 750,
                easing: 'easeOutQuart',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: cssVar('--bg-popover', '#1e293b'),
                    titleColor: cssVar('--text-primary', '#f8fafc'),
                    bodyColor: cssVar('--text-muted', '#94a3b8'),
                    borderColor: cssVar('--border-default', '#334155'),
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: (ctx) => `${ctx.formattedValue} Events`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor, drawTicks: false },
                    border: { display: false },
                    ticks: {
                        color: labelColor,
                        font: { family: 'Inter', size: 11 },
                        padding: 8,
                        stepSize: 1
                    }
                },
                x: {
                    grid: { display: false, drawTicks: false },
                    border: { display: false },
                    ticks: {
                        color: labelColor,
                        font: { family: 'Inter', size: 10 },
                        padding: 8
                    }
                }
            }
        }
    };

    new Chart(canvas, config);
}

export function renderDonutChart(
    canvas: HTMLCanvasElement,
    data: ChartDataPoint[],
    options?: { centerLabel?: string },
): void {
    // Destroy previous chart if it exists
    Chart.getChart(canvas)?.destroy();

    const labelColor = cssVar('--chart-label', '#64748b');

    const total = data.reduce((sum, d) => sum + d.value, 0);

    const config: ChartConfiguration<'doughnut'> = {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.label),
            datasets: [{
                data: data.map(d => d.value),
                backgroundColor: data.map(d => d.color || cssVar('--chart-bar', '#6366f1')),
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            animation: {
                duration: 800,
                easing: 'easeOutExpo'
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: labelColor,
                        font: { family: 'Inter', size: 11 },
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: cssVar('--bg-popover', '#1e293b'),
                    titleColor: cssVar('--text-primary', '#f8fafc'),
                    bodyColor: cssVar('--text-muted', '#94a3b8'),
                    borderColor: cssVar('--border-default', '#334155'),
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => ` ${ctx.label}: ${ctx.formattedValue} `
                    }
                }
            }
        },
        plugins: [{
            id: 'centerTextPlugin',
            beforeDraw: (chart) => {
                const { width } = chart;
                const { ctx } = chart;
                
                // Adjust Y calculation based on where the legend creates the chart area
                const yPos = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
                
                ctx.restore();
                
                // Draw total value
                ctx.font = 'bold 24px Inter, sans-serif';
                ctx.textBaseline = 'middle';
                const text = options?.centerLabel || String(total);
                const textX = Math.round((width - ctx.measureText(text).width) / 2);
                const textY = yPos - 8;
                
                ctx.fillStyle = cssVar('--text-primary', '#f8fafc');
                ctx.fillText(text, textX, textY);
                
                // Draw "Total" label
                ctx.font = '12px Inter, sans-serif';
                const label = 'Total';
                const labelX = Math.round((width - ctx.measureText(label).width) / 2);
                
                ctx.fillStyle = cssVar('--text-muted', '#94a3b8');
                ctx.fillText(label, labelX, yPos + 18);
                
                ctx.save();
            }
        }]
    };

    new Chart(canvas, config);
}
