/** Dashboard — Overview view with stats, charts, and recent events.
 *  Premium editorial layout with large metrics and section headers. */

import { api } from '../../api.js';
import type { SystemStats, ServiceStatus } from '../../types/index.js';
import { formatNumber } from '../../utils/formatters.js';
import { renderBarChart, renderDonutChart } from '../../utils/charts.js';

export async function renderOverview(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="overview-grid">
      <div>
        <div class="overview-section-label">System Services</div>
        <div class="service-status-row" id="service-status-row">
          ${renderServiceStatusPlaceholder()}
        </div>
      </div>

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
        <div class="overview-grid__recent">
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
          <div class="card">
            <div class="card__header">
              <span class="card__title">Recent Alerts</span>
            </div>
            <div id="recent-alerts">
              <div class="empty-state" style="padding: var(--space-8);">
                <div class="empty-state__title">Loading alerts...</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="overview-section-label">Top Incident Locations</div>
        <div class="card">
          <div id="top-locations">
            <div class="empty-state" style="padding: var(--space-8);">
              <div class="empty-state__title">Loading locations...</div>
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

  // Fetch service status
  try {
    const services = await api.get<ServiceStatus>('/stats/services');
    renderServiceStatus(services);
  } catch {
    renderServiceStatus(null);
  }

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

  // Fetch recent alerts
  try {
    const { alerts } = await api.get<{ alerts: Array<Record<string, unknown>> }>('/alerts', { limit: '5' });
    renderRecentAlerts(alerts);
  } catch {
    const el = document.getElementById('recent-alerts');
    if (el) el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No alerts dispatched yet</div>
        <div class="empty-state__desc">Alerts appear here when accident notifications are sent</div>
      </div>
    `;
  }

  // Fetch top incident locations
  try {
    const { events } = await api.get<{ events: Array<Record<string, unknown>> }>('/events', { limit: '200' });
    renderTopLocations(events);
  } catch {
    const el = document.getElementById('top-locations');
    if (el) el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No location data available</div>
        <div class="empty-state__desc">Location data appears when events include camera metadata</div>
      </div>
    `;
  }
}

const SERVICE_ITEMS: Array<{ key: keyof ServiceStatus; label: string; desc: string }> = [
  { key: 'model', label: 'AI Model', desc: 'YOLO26 ONNX model loaded' },
  { key: 'detection', label: 'Detection', desc: 'Accident detection enabled' },
  { key: 'twilio', label: 'Twilio Calls', desc: 'Emergency voice calls' },
  { key: 'telegram', label: 'Telegram', desc: 'Telegram bot alerts' },
  { key: 'email', label: 'Email', desc: 'SMTP email alerts' },
];

function renderServiceStatusPlaceholder(): string {
  return SERVICE_ITEMS.map(item => `
    <div class="service-item">
      <div class="service-item__indicator service-item__indicator--unknown"></div>
      <div class="service-item__info">
        <div class="service-item__label">${item.label}</div>
        <div class="service-item__desc">${item.desc}</div>
      </div>
    </div>
  `).join('');
}

function renderServiceStatus(status: ServiceStatus | null): void {
  const el = document.getElementById('service-status-row');
  if (!el) return;

  el.innerHTML = SERVICE_ITEMS.map(item => {
    const isActive = status ? status[item.key] : false;
    const stateClass = status ? (isActive ? 'service-item__indicator--active' : 'service-item__indicator--inactive') : 'service-item__indicator--unknown';
    const statusText = status ? (isActive ? 'Active' : 'Inactive') : '—';
    return `
      <div class="service-item">
        <div class="service-item__indicator ${stateClass}"></div>
        <div class="service-item__info">
          <div class="service-item__label">${item.label}</div>
          <div class="service-item__desc">${item.desc}</div>
        </div>
        <div class="service-item__status ${isActive ? 'text-success' : 'text-muted'}">${statusText}</div>
      </div>
    `;
  }).join('');
}

const STATS_ICONS: Record<string, string> = {
  'Total Events': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`,
  'Accidents': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  'Tickets': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
  'Alerts Sent': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
  'Delivery Rate': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  'Pending Review': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`
};

function renderStatsPlaceholder(): string {
  return ['Total Events', 'Accidents', 'Tickets', 'Alerts Sent', 'Delivery Rate', 'Pending Review'].map(label => `
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

  const totalSent = alertsCount ?? 0;
  const totalFailed = 0;
  const deliveryRate = totalSent + totalFailed > 0
    ? `${((totalSent / (totalSent + totalFailed)) * 100).toFixed(0)}%`
    : '—';

  const vals = stats
    ? [
      { label: 'Total Events',   value: formatNumber(stats.total_events) },
      { label: 'Accidents',      value: formatNumber(stats.total_accidents) },
      { label: 'Tickets',        value: formatNumber(stats.total_tickets) },
      { label: 'Alerts Sent',    value: alertsCount !== null ? formatNumber(alertsCount) : '—' },
      { label: 'Delivery Rate',  value: deliveryRate },
      { label: 'Pending Review', value: '—' },
    ]
    : [
      { label: 'Total Events',   value: '—' },
      { label: 'Accidents',      value: '—' },
      { label: 'Tickets',        value: '—' },
      { label: 'Alerts Sent',    value: '—' },
      { label: 'Delivery Rate',  value: '—' },
      { label: 'Pending Review', value: '—' },
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

  // Fetch pending tickets count
  api.get<{ total: number }>('/tickets', { status: 'pending', limit: '1' })
    .then(resp => {
      const pendingEl = el.querySelector('.stats-card:nth-child(6) .stats-card__value');
      if (pendingEl) pendingEl.textContent = formatNumber(resp.total);
    })
    .catch(() => {});

  // Compute real delivery rate from alert stats
  api.get<{ total_sent: number; total_failed: number }>('/alerts/stats')
    .then(resp => {
      const total = resp.total_sent + resp.total_failed;
      const rate = total > 0 ? `${((resp.total_sent / total) * 100).toFixed(0)}%` : '—';
      const rateEl = el.querySelector('.stats-card:nth-child(5) .stats-card__value');
      if (rateEl) rateEl.textContent = rate;
    })
    .catch(() => {});
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

function renderRecentAlerts(alerts: Array<Record<string, unknown>>): void {
  const el = document.getElementById('recent-alerts');
  if (!el) return;

  if (!alerts.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No alerts dispatched yet</div>
        <div class="empty-state__desc">Alerts appear here when accident notifications are sent</div>
      </div>
    `;
    return;
  }

  const channelLabels: Record<string, string> = {
    twilio: 'Twilio',
    email: 'Email',
    webhook: 'Webhook',
    telegram: 'Telegram',
  };

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Channel</th>
          <th>Status</th>
          <th>Event</th>
        </tr>
      </thead>
      <tbody>
        ${alerts.map(a => {
          const channel = channelLabels[a.channel as string] || a.channel;
          const status = a.status as string;
          const statusClass = status === 'sent' ? 'text-success' : status === 'failed' ? 'text-danger' : 'text-muted';
          const eventId = (a.event_id as string).slice(0, 8);
          return `
          <tr>
            <td>${new Date(a.created_at as string).toLocaleString()}</td>
            <td><span class="badge badge--${a.channel}">${channel}</span></td>
            <td><span class="${statusClass}">${status}</span></td>
            <td style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem;">${eventId}…</td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;
}

function renderTopLocations(events: Array<Record<string, unknown>>): void {
  const el = document.getElementById('top-locations');
  if (!el) return;

  if (!events.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No location data available</div>
        <div class="empty-state__desc">Location data appears when events include camera metadata</div>
      </div>
    `;
    return;
  }

  const locationCounts: Record<string, number> = {};
  for (const e of events) {
    const meta = e.metadata as Record<string, unknown> | null;
    const cameraName = meta?.camera_name as string | undefined;
    const sourceVideo = e.source_video as string | undefined;
    const location = cameraName || sourceVideo || 'Unknown';
    locationCounts[location] = (locationCounts[location] || 0) + 1;
  }

  const sorted = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (!sorted.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No location data available</div>
        <div class="empty-state__desc">Location data appears when events include camera metadata</div>
      </div>
    `;
    return;
  }

  const maxCount = sorted[0][1];

  el.innerHTML = `
    <div class="top-locations-list">
      ${sorted.map(([location, count], i) => {
        const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
        return `
        <div class="top-location-item">
          <div class="top-location-item__rank">${i + 1}</div>
          <div class="top-location-item__info">
            <div class="top-location-item__name">${location}</div>
            <div class="top-location-item__bar">
              <div class="top-location-item__bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>
          <div class="top-location-item__count">${count}</div>
        </div>
      `}).join('')}
    </div>
  `;
}
