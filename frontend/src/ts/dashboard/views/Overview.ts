/** Dashboard — Overview view with stats, charts, and recent events.
 *  Premium editorial layout with large metrics and section headers. */

import { api } from '../../api.js';
import type { SystemStats, ServiceStatus, IncidentStats } from '../../types/index.js';
import { formatNumber } from '../../utils/formatters.js';
import { renderBarChart } from '../../utils/charts.js';

type OverviewCacheEntry = {
  at: number;
  services: ServiceStatus | null;
  alertStats: any;
  incidentStats: IncidentStats | null;
  systemStats: SystemStats | null;
  incidentsForView: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  activeMonitors: number | null;
};

const OVERVIEW_REVALIDATE_MS = 20000;
const OVERVIEW_MAX_STALE_MS = 10 * 60 * 1000;
const OVERVIEW_STORAGE_KEY = 'citadel:view:overview:v1';

let _overviewCache: OverviewCacheEntry | null = loadOverviewCache();
let _overviewRefreshPromise: Promise<void> | null = null;

function loadOverviewCache(): OverviewCacheEntry | null {
  try {
    const raw = localStorage.getItem(OVERVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverviewCacheEntry;
    if (!parsed || typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistOverviewCache(entry: OverviewCacheEntry): void {
  _overviewCache = entry;
  try {
    localStorage.setItem(OVERVIEW_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage quota issues.
  }
}

function getOverviewCache(): OverviewCacheEntry | null {
  if (!_overviewCache) {
    _overviewCache = loadOverviewCache();
  }
  if (!_overviewCache) return null;

  if ((Date.now() - _overviewCache.at) > OVERVIEW_MAX_STALE_MS) {
    _overviewCache = null;
    localStorage.removeItem(OVERVIEW_STORAGE_KEY);
    return null;
  }

  return _overviewCache;
}

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
              <span class="card__title">Confidence Distribution</span>
            </div>
            <div class="chart-container" style="height: 220px;">
              <canvas id="confidence-chart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="overview-section-label">Recent Activity</div>
        <div class="overview-grid__recent">
          <div class="card">
            <div class="card__header">
              <span class="card__title">Recent Incidents</span>
            </div>
            <div id="recent-incidents">
              <div class="empty-state" style="padding: var(--space-8);">
                <div class="empty-state__title">Loading incidents...</div>
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

  const cached = getOverviewCache();
  if (cached) {
    applyOverviewData(cached);
    if ((Date.now() - cached.at) >= OVERVIEW_REVALIDATE_MS) {
      void refreshOverviewData(true);
    }
    return;
  }

  await refreshOverviewData(true);
}

async function refreshOverviewData(force: boolean = false): Promise<void> {
  if (_overviewRefreshPromise) {
    return _overviewRefreshPromise;
  }

  _overviewRefreshPromise = (async () => {
  const [
    alertsStatsRes,
    servicesRes,
    incidentStatsRes,
    systemStatsRes,
    incidentsRes,
    alertsRes,
    monitorRes,
  ] = await Promise.allSettled([
    api.get('/alerts/stats', undefined, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
    api.get<ServiceStatus>('/stats/services', undefined, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
    api.get<IncidentStats>('/incidents/stats/overview', undefined, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
    api.get<SystemStats>('/stats', undefined, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
    api.get<{ incidents: Array<Record<string, unknown>> }>('/incidents', { limit: '200' }, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
    api.get<{ alerts: Array<Record<string, unknown>> }>('/alerts', { limit: '5' }, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
    api.get<{ active_count: number; total_count: number }>('/cameras/monitor/status', undefined, { ttlMs: OVERVIEW_REVALIDATE_MS, force }),
  ]);

  const successCount = [
    alertsStatsRes,
    servicesRes,
    incidentStatsRes,
    systemStatsRes,
    incidentsRes,
    alertsRes,
    monitorRes,
  ].filter(r => r.status === 'fulfilled').length;

  if (successCount === 0) {
    // Preserve existing stale cache if network failed.
    const stale = getOverviewCache();
    if (stale) applyOverviewData(stale);
    return;
  }

  const payload = {
    at: Date.now(),
    alertStats: alertsStatsRes.status === 'fulfilled' ? alertsStatsRes.value : null,
    services: servicesRes.status === 'fulfilled' ? servicesRes.value : null,
    incidentStats: incidentStatsRes.status === 'fulfilled' ? incidentStatsRes.value : null,
    systemStats: systemStatsRes.status === 'fulfilled' ? systemStatsRes.value : null,
    incidentsForView: incidentsRes.status === 'fulfilled' ? incidentsRes.value.incidents : [],
    alerts: alertsRes.status === 'fulfilled' ? alertsRes.value.alerts : [],
    activeMonitors: monitorRes.status === 'fulfilled' ? monitorRes.value.active_count : null,
  };

  persistOverviewCache(payload);
  applyOverviewData(payload);
  })();

  try {
    await _overviewRefreshPromise;
  } finally {
    _overviewRefreshPromise = null;
  }
}

function applyOverviewData(data: {
  at: number;
  alertStats: any;
  services: ServiceStatus | null;
  incidentStats: IncidentStats | null;
  systemStats: SystemStats | null;
  incidentsForView: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  activeMonitors: number | null;
}): void {
  if (data.alertStats && data.alertStats.total_sent > 0) {
    const mEl = document.getElementById('alert-indicator-wrapper');
    if (mEl) mEl.style.display = 'flex';
  } else {
    const mEl = document.getElementById('alert-indicator-wrapper');
    if (mEl) mEl.style.display = 'none';
  }

  renderServiceStatus(data.services);
  renderStatsCards(data.incidentStats, data.alertStats, data.activeMonitors);
  renderCharts(data.systemStats, data.incidentStats);

  if (data.incidentsForView.length) {
    renderRecentIncidents(data.incidentsForView.slice(0, 5));
    renderTopLocations(data.incidentsForView);
  } else {
    const incidentsEl = document.getElementById('recent-incidents');
    if (incidentsEl) {
      incidentsEl.innerHTML = `
        <div class="empty-state" style="padding: var(--space-8);">
          <div class="empty-state__title">No incidents detected yet</div>
          <div class="empty-state__desc">Upload a video in Manual Feed to start detecting</div>
        </div>
      `;
    }

    const topLocationsEl = document.getElementById('top-locations');
    if (topLocationsEl) {
      topLocationsEl.innerHTML = `
        <div class="empty-state" style="padding: var(--space-8);">
          <div class="empty-state__title">No location data available</div>
          <div class="empty-state__desc">Location data appears when incidents include camera metadata</div>
        </div>
      `;
    }
  }

  if (data.alerts.length) {
    renderRecentAlerts(data.alerts);
  } else {
    const el = document.getElementById('recent-alerts');
    if (el) el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No alerts dispatched yet</div>
        <div class="empty-state__desc">Alerts appear here when accident notifications are sent</div>
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
  'Total Incidents': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  'Resolved': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  'Avg Confidence': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
  'Alert Success Rate': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
  'Pending Review': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  'Active Monitors': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`
};

function renderStatsPlaceholder(): string {
  return ['Total Incidents', 'Resolved', 'Avg Confidence', 'Alert Success Rate', 'Pending Review', 'Active Monitors'].map(label => `
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

function renderStatsCards(incidentStats: IncidentStats | null, alertStats: any, activeMonitors: number | null): void {
  const el = document.getElementById('stats-row');
  if (!el) return;

  const totalIncidents = incidentStats ? formatNumber(incidentStats.total_incidents) : '—';
  const resolved = incidentStats ? formatNumber(incidentStats.resolved_count) : '—';
  const avgConf = incidentStats && incidentStats.avg_confidence > 0
    ? `${(incidentStats.avg_confidence * 100).toFixed(0)}%`
    : '—';
  const pending = incidentStats ? formatNumber(incidentStats.pending_count) : '—';

  const alertTotal = alertStats ? alertStats.total_sent + alertStats.total_failed : 0;
  const alertRate = alertTotal > 0
    ? `${((alertStats.total_sent / alertTotal) * 100).toFixed(0)}%`
    : '—';

  const vals = [
    { label: 'Total Incidents',   value: totalIncidents },
    { label: 'Resolved',          value: resolved },
    { label: 'Avg Confidence',    value: avgConf },
    { label: 'Alert Success Rate',value: alertRate },
    { label: 'Pending Review',    value: pending },
    { label: 'Active Monitors',   value: activeMonitors === null ? '—' : String(activeMonitors) },
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

function renderCharts(stats: SystemStats | null, incidentStats: IncidentStats | null): void {
  const timelineCanvas = document.getElementById('timeline-chart') as HTMLCanvasElement;
  if (timelineCanvas && stats) {
    renderBarChart(timelineCanvas, stats.timeline_24h.map(t => ({
      label: t.hour,
      value: t.count,
      color: getComputedStyle(document.documentElement).getPropertyValue('--chart-bar').trim() || '#6366f1',
    })));
  }

  const confidenceCanvas = document.getElementById('confidence-chart') as HTMLCanvasElement;
  if (confidenceCanvas && incidentStats && incidentStats.confidence_distribution.length > 0) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
    renderBarChart(confidenceCanvas, incidentStats.confidence_distribution.map(bin => ({
      label: bin.label,
      value: bin.count,
      color: bin.count > 0 ? accent : 'var(--text-muted)',
    })));
  } else if (confidenceCanvas) {
    renderBarChart(confidenceCanvas, [
      { label: '50-55%', value: 0, color: 'var(--text-muted)' },
      { label: '55-60%', value: 0, color: 'var(--text-muted)' },
      { label: '60-65%', value: 0, color: 'var(--text-muted)' },
      { label: '65-70%', value: 0, color: 'var(--text-muted)' },
      { label: '70-75%', value: 0, color: 'var(--text-muted)' },
      { label: '75-80%', value: 0, color: 'var(--text-muted)' },
      { label: '80-85%', value: 0, color: 'var(--text-muted)' },
      { label: '85-90%', value: 0, color: 'var(--text-muted)' },
      { label: '90-95%', value: 0, color: 'var(--text-muted)' },
      { label: '95-100%', value: 0, color: 'var(--text-muted)' },
    ]);
  }
}

function renderRecentIncidents(incidents: Array<Record<string, unknown>>): void {
  const el = document.getElementById('recent-incidents');
  if (!el) return;

  if (!incidents.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No incidents detected yet</div>
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
          <th>Confidence</th>
          <th>Severity</th>
          <th>Status</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${incidents.map(i => {
          const statusClass = i.status === 'resolved' ? 'text-success' : i.status === 'pending' ? 'text-warning' : 'text-muted';
          return `
          <tr>
            <td>${new Date(i.timestamp as string).toLocaleString()}</td>
            <td>${((i.confidence as number) * 100).toFixed(1)}%</td>
            <td><span class="badge badge--${i.severity}">${i.severity}</span></td>
            <td><span class="${statusClass}" style="font-weight:600; text-transform:capitalize; font-size:0.8rem;">${i.status}</span></td>
            <td style="color: var(--text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i.source_video || '—'}</td>
          </tr>
        `}).join('')}
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

function renderTopLocations(incidents: Array<Record<string, unknown>>): void {
  const el = document.getElementById('top-locations');
  if (!el) return;

  if (!incidents.length) {
    el.innerHTML = `
      <div class="empty-state" style="padding: var(--space-8);">
        <div class="empty-state__title">No location data available</div>
        <div class="empty-state__desc">Location data appears when incidents include camera metadata</div>
      </div>
    `;
    return;
  }

  const locationCounts: Record<string, number> = {};
  for (const i of incidents) {
    const meta = i.metadata as Record<string, unknown> | null;
    const cameraName = meta?.camera_name as string | undefined;
    const sourceVideo = i.source_video as string | undefined;
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
        <div class="empty-state__desc">Location data appears when incidents include camera metadata</div>
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
