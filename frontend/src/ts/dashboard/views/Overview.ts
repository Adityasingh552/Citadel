/** Dashboard — Overview view with stats, charts, and recent events. */

import { api } from '../../api.js';
import type { SystemStats } from '../../types/index.js';
import { formatNumber } from '../../utils/formatters.js';
import { renderBarChart, renderDonutChart } from '../../utils/charts.js';

export async function renderOverview(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="overview-grid">
      <div class="overview-grid__stats" id="stats-row">
        ${renderStatsPlaceholder()}
      </div>
      <div class="overview-grid__charts">
        <div class="card">
          <div class="card__header">
            <span class="card__title">Event Timeline (24h)</span>
          </div>
          <div class="chart-container" style="height: 220px;">
            <canvas id="timeline-chart"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card__header">
            <span class="card__title">Severity Breakdown</span>
          </div>
          <div class="chart-container" style="height: 220px;">
            <canvas id="severity-chart"></canvas>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card__header">
          <span class="card__title">Recent Events</span>
        </div>
        <div id="recent-events">
          <div class="empty-state">
            <div class="empty-state__icon"></div>
            <div class="empty-state__title">Loading events...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Fetch stats and render
  try {
    const stats = await api.get<SystemStats>('/stats');
    renderStatsCards(stats);
    renderCharts(stats);
  } catch {
    renderStatsCards(null);
  }

  // Fetch recent events
  try {
    const { events } = await api.get<{ events: Array<Record<string, unknown>> }>('/events', { limit: '5' });
    renderRecentEvents(events);
  } catch {
    const el = document.getElementById('recent-events');
    if (el) el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No events detected yet</div>
        <div class="empty-state__desc">Upload a video in Manual Feed to start detecting</div>
      </div>
    `;
  }
}

function renderStatsPlaceholder(): string {
  return ['Total Events', 'Accidents', 'Vehicles', 'Tickets'].map(label => `
      <div class="stats-card">
        <div class="stats-card__content">
          <div class="stats-card__value">—</div>
          <div class="stats-card__label">${label}</div>
        </div>
      </div>
    `).join('');
}

function renderStatsCards(stats: SystemStats | null): void {
  const el = document.getElementById('stats-row');
  if (!el) return;

  const vals = stats
    ? [
      { label: 'Total Events', value: formatNumber(stats.total_events), color: 'blue' },
      { label: 'Accidents', value: formatNumber(stats.total_accidents), color: 'red' },
      { label: 'Vehicles', value: formatNumber(stats.total_vehicles), color: 'amber' },
      { label: 'Tickets', value: formatNumber(stats.total_tickets), color: 'green' },
    ]
    : [
      { label: 'Total Events', value: '—', color: 'blue' },
      { label: 'Accidents', value: '—', color: 'red' },
      { label: 'Vehicles', value: '—', color: 'amber' },
      { label: 'Tickets', value: '—', color: 'green' },
    ];

  el.innerHTML = vals.map(s => `
    <div class="stats-card">
      <div class="stats-card__content">
        <div class="stats-card__value">${s.value}</div>
        <div class="stats-card__label">${s.label}</div>
      </div>
    </div>
  `).join('');
}

function renderCharts(stats: SystemStats): void {
  // Timeline bar chart
  const timelineCanvas = document.getElementById('timeline-chart') as HTMLCanvasElement;
  if (timelineCanvas) {
    renderBarChart(timelineCanvas, stats.timeline_24h.map(t => ({
      label: t.hour,
      value: t.count,
      color: '#3b82f6',
    })));
  }

  // Severity donut chart
  const severityCanvas = document.getElementById('severity-chart') as HTMLCanvasElement;
  if (severityCanvas) {
    const sb = stats.severity_breakdown;
    renderDonutChart(severityCanvas, [
      { label: 'High', value: sb.high, color: '#ef4444' },
      { label: 'Medium', value: sb.medium, color: '#f59e0b' },
      { label: 'Low', value: sb.low, color: '#10b981' },
    ]);
  }
}

function renderRecentEvents(events: Array<Record<string, unknown>>): void {
  const el = document.getElementById('recent-events');
  if (!el) return;

  if (!events.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No events detected yet</div>
        <div class="empty-state__desc">Upload a video in Manual Feed to start detecting</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Severity</th>
          <th>Confidence</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${events.map(e => `
          <tr>
            <td>${new Date(e.timestamp as string).toLocaleString()}</td>
            <td><span class="badge badge--${e.event_type}">${e.event_type}</span></td>
            <td><span class="badge badge--${e.severity}">${e.severity}</span></td>
            <td>${((e.confidence as number) * 100).toFixed(1)}%</td>
            <td>${e.source_video || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
