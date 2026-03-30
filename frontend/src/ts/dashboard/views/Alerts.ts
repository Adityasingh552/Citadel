/** Dashboard — Alerts view with filterable table of notification logs. */

import { api } from '../../api.js';
import type { AlertLogListResponse, AlertLog } from '../../types/index.js';
import { formatDateTime } from '../../utils/formatters.js';

export async function renderAlerts(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="filter-bar">
      <select id="filter-channel">
        <option value="">All Channels</option>
        <option value="twilio">Twilio Voice</option>
        <option value="email">Email</option>
        <option value="webhook">Webhook</option>
      </select>
      <select id="filter-status">
        <option value="">All Statuses</option>
        <option value="sent">Sent</option>
        <option value="dispatched">Dispatched</option>
        <option value="failed">Failed</option>
        <option value="suppressed">Suppressed</option>
      </select>
      <button class="btn btn--primary btn--sm" id="apply-filters">Apply</button>
      <button class="btn btn--outline btn--sm" id="refresh-alerts" style="margin-left: auto;">Refresh</button>
    </div>
    <div class="events-layout" id="alerts-container">
      <div class="card" id="alerts-table-card">
        <div class="empty-state">
          <div class="empty-state__icon"></div>
          <div class="empty-state__title">Loading alerts...</div>
        </div>
      </div>
    </div>
  `;

  // Load alerts
  await loadAlerts();

  // Filter button
  document.getElementById('apply-filters')?.addEventListener('click', loadAlerts);
  document.getElementById('refresh-alerts')?.addEventListener('click', loadAlerts);
}

async function loadAlerts(): Promise<void> {
  const channelFilter = (document.getElementById('filter-channel') as HTMLSelectElement)?.value || '';
  const statusFilter = (document.getElementById('filter-status') as HTMLSelectElement)?.value || '';

  const params: Record<string, string> = { limit: '50' };
  if (channelFilter) params.channel = channelFilter;
  if (statusFilter) params.status = statusFilter;

  const tableCard = document.getElementById('alerts-table-card');
  if (tableCard) {
      tableCard.innerHTML = `<div class="empty-state"><div class="empty-state__title">Loading alerts...</div></div>`;
  }

  try {
    const data = await api.get<AlertLogListResponse>('/alerts', params);
    renderTable(data.alerts);
  } catch (e) {
    console.error('Failed to load alerts', e);
    const el = document.getElementById('alerts-table-card');
    if (el) el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">Failed to load alerts</div>
        <div class="empty-state__desc">There was an error connecting to the API</div>
      </div>
    `;
  }
}

function getChannelIcon(channel: string): string {
    switch (channel) {
        case 'twilio': return '📞 Twilio';
        case 'email': return '✉️ Email';
        case 'webhook': return '🔗 Webhook';
        default: return '🔔 ' + channel;
    }
}

function getStatusBadge(status: string): string {
    let type = 'default';
    if (status === 'sent' || status === 'dispatched') type = 'success';
    else if (status === 'failed') type = 'danger';
    else if (status === 'suppressed') type = 'warning';
    
    return `<span class="badge badge--${type} alert-status-badge">${status}</span>`;
}

function renderTable(alerts: AlertLog[]): void {
  const el = document.getElementById('alerts-table-card');
  if (!el) return;

  if (!alerts.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No alerts found</div>
        <div class="empty-state__desc">Adjust filters or wait for detections</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Channel</th>
          <th>Recipient</th>
          <th>Status</th>
          <th>Event ID</th>
        </tr>
      </thead>
      <tbody>
        ${alerts.map(a => `
          <tr class="alert-row" data-details='${JSON.stringify(a.details).replace(/'/g, "&#39;")}'>
            <td>${formatDateTime(a.created_at)}</td>
            <td><strong>${getChannelIcon(a.channel)}</strong></td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${a.recipient || ''}">
                ${a.recipient || '—'}
            </td>
            <td>${getStatusBadge(a.status)}</td>
            <td><a href="#/dashboard/events" title="Go to Events" style="color:var(--accent); text-decoration:none;">${a.event_id.slice(0, 12)}...</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Row click
  el.querySelectorAll('.alert-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Ignore click if it was on the link
      if ((e.target as HTMLElement).tagName === 'A') return;
      
      const detailsRaw = (row as HTMLElement).dataset.details;
      if (detailsRaw && detailsRaw !== 'null') {
         try {
             const details = JSON.parse(detailsRaw);
             alert(JSON.stringify(details, null, 2));
         } catch(e) {}
      }
    });
  });
}
