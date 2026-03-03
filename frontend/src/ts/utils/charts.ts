/** Simple canvas-based chart rendering. */

import type { ChartDataPoint } from '../types/index.js';

export function renderBarChart(
    canvas: HTMLCanvasElement,
    data: ChartDataPoint[],
    options?: { barColor?: string },
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    if (!data.length || data.every(d => d.value === 0)) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', w / 2, h / 2);
        return;
    }

    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barWidth = Math.max(4, (chartW / data.length) * 0.6);
    const gap = (chartW / data.length) * 0.4;

    // Gridlines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + chartH - (chartH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.round((maxVal * i) / 4)), padding.left - 6, y + 3);
    }

    // Bars
    data.forEach((d, i) => {
        const x = padding.left + i * (barWidth + gap) + gap / 2;
        const barH = (d.value / maxVal) * chartH;
        const y = padding.top + chartH - barH;

        ctx.fillStyle = d.color || options?.barColor || '#3b82f6';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, [3, 3, 0, 0]);
        ctx.fill();

        // Labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.label, x + barWidth / 2, h - 6);
    });
}

export function renderDonutChart(
    canvas: HTMLCanvasElement,
    data: ChartDataPoint[],
    options?: { centerLabel?: string },
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 30;
    const innerRadius = radius * 0.6;

    ctx.clearRect(0, 0, w, h);

    const total = data.reduce((sum, d) => sum + d.value, 0);

    if (!total) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', cx, cy);
        return;
    }

    let angle = -Math.PI / 2;
    data.forEach(d => {
        const sliceAngle = (d.value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle, angle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = d.color;
        ctx.fill();
        angle += sliceAngle;
    });

    // Inner circle (donut hole)
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Center label
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(options?.centerLabel || String(total), cx, cy - 6);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('Total', cx, cy + 14);

    // Legend
    let legendY = h - 16;
    const legendX = 10;
    data.forEach((d, i) => {
        const lx = legendX + i * (w / data.length);
        ctx.fillStyle = d.color;
        ctx.fillRect(lx, legendY, 10, 10);
        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${d.label} (${d.value})`, lx + 14, legendY + 9);
    });
}
