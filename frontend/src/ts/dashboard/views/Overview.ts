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

function renderStatsPlaceholder(): string {
  return ['Total Events', 'Accidents', 'Vehicles', 'Tickets', 'Alerts Sent'].map(label => `
      <div class="stats-card">
        <div class="stats-card__content">
          <div class="stats-card__value">—</div>
          <div class="stats-card__label">${label}</div>
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
      <div class="stats-card__content">
        <div class="stats-card__value">${s.value}</div>
        <div class="stats-card__label">${s.label}</div>
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
