/** Dashboard — Overview view with stats, charts, and recent events.
 *  Premium editorial layout with large metrics and section headers. */

import { api } from '../../api.js';
import type { SystemStats } from '../../types/index.js';
import { formatNumber } from '../../utils/formatters.js';
import { renderBarChart, renderDonutChart } from '../../utils/charts.js';

export async function renderOverview(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="overview-grid">
      <div>
        <div class="overview-section-label">System Pulse</div>
        <div class="overview-grid__stats" id="stats-row">
          ${renderStatsPlaceholder()}
        </div>
      </div>

      <div>
        <div class="overview-section-label">Timeline Analysis</div>
        <div class="overview-grid__charts">
          <div class="card" style="position: relative;">
            <div class="card__header">
              <span class="card__title">Event Timeline (24h)</span>
              <div id="alert-indicator-wrapper" style="display:none; align-items:center; gap:6px;">
                 <div class="alert-pulse"></div>
                 <span style="font-size:0.75rem; color:var(--text-muted);">Recent Alerts Dispatched</span>
              </div>
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
      </div>

      <div>
        <div class="overview-section-label">Recent Activity</div>
        <div class="card">
          <div class="card__header">
            <span class="card__title">Recent Events</span>
          </div>
          <div id="recent-events">
            <div class="empty-state" style="padding: var(--space-8);">
              <div class="empty-state__title">Loading events...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  let alertStats: any = null;
  try {
      alertStats = await api.get('/alerts/stats');
      if (alertStats && alertStats.total_sent > 0) {
          const mEl = document.getElementById('alert-indicator-wrapper');
          if (mEl) mEl.style.display = 'flex';
      }
  } catch(e) {}

  // Fetch stats and render
  try {
    const stats = await api.get<SystemStats>('/stats');
    renderStatsCards(stats, alertStats ? alertStats.total_sent : null);
    renderCharts(stats);
  } catch {
    renderStatsCards(null, null);
  }

  // Fetch recent events
  try {
    const { events } = await api.get<{ events: Array<Record<string, unknown>> }>('/events', { limit: '5' });
    renderRecentEvents(events);
  } catch {
    const el = document.getElementById('recent-events');
    if (el) el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No events detected yet</div>
        <div class="empty-state__desc">Upload a video in Manual Feed to start detecting</div>
      </div>
    `;
  }
}

const STATS_ICONS: Record<string, string> = {
  'Total Events': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`,
  'Accidents': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  'Vehicles': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>`,
  'Tickets': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
  'Alerts Sent': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`
};

function renderStatsPlaceholder(): string {
  return ['Total Events', 'Accidents', 'Vehicles', 'Tickets', 'Alerts Sent'].map(label => `
      <div class="stats-card">
        <div class="stats-card__header">
          <div class="stats-card__label">${label}</div>
          <div class="stats-card__icon">${STATS_ICONS[label] || ''}</div>
        </div>
        <div class="stats-card__content">
          <div class="stats-card__value">—</div>
        </div>
      </div>
    `).join('');
}

function renderStatsCards(stats: SystemStats | null, alertsCount: number | null): void {
  const el = document.getElementById('stats-row');
  if (!el) return;

  const vals = stats
    ? [
      { label: 'Total Events', value: formatNumber(stats.total_events) },
      { label: 'Accidents',    value: formatNumber(stats.total_accidents) },
      { label: 'Vehicles',     value: formatNumber(stats.total_vehicles) },
      { label: 'Tickets',      value: formatNumber(stats.total_tickets) },
      { label: 'Alerts Sent',  value: alertsCount !== null ? formatNumber(alertsCount) : '—' },
    ]
    : [
      { label: 'Total Events', value: '—' },
      { label: 'Accidents',    value: '—' },
      { label: 'Vehicles',     value: '—' },
      { label: 'Tickets',      value: '—' },
      { label: 'Alerts Sent',  value: '—' },
    ];

  el.innerHTML = vals.map(s => `
    <div class="stats-card">
      <div class="stats-card__header">
        <div class="stats-card__label">${s.label}</div>
        <div class="stats-card__icon">${STATS_ICONS[s.label] || ''}</div>
      </div>
      <div class="stats-card__content">
        <div class="stats-card__value">${s.value}</div>
      </div>
    </div>
  `).join('');
}

function renderCharts(stats: SystemStats): void {
  const timelineCanvas = document.getElementById('timeline-chart') as HTMLCanvasElement;
  if (timelineCanvas) {
    renderBarChart(timelineCanvas, stats.timeline_24h.map(t => ({
      label: t.hour,
      value: t.count,
      color: getComputedStyle(document.documentElement).getPropertyValue('--chart-bar').trim() || '#6366f1',
    })));
  }

  const severityCanvas = document.getElementById('severity-chart') as HTMLCanvasElement;
  if (severityCanvas) {
    const sb = stats.severity_breakdown;
    renderDonutChart(severityCanvas, [
      { label: 'High',   value: sb.high,   color: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#f87171' },
      { label: 'Medium', value: sb.medium,  color: getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() || '#fbbf24' },
      { label: 'Low',    value: sb.low,    color: getComputedStyle(document.documentElement).getPropertyValue('--success').trim() || '#34d399' },
    ]);
  }
}

function renderRecentEvents(events: Array<Record<string, unknown>>): void {
  const el = document.getElementById('recent-events');
  if (!el) return;

  if (!events.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
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
            <td style="color: var(--text-muted);">${e.source_video || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
