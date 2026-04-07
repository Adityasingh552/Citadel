/** Dashboard — Incidents view. Unified table combining detection data (confidence, severity, evidence) with ticket workflow (status). */

import { api } from '../../api.js';
import type { Incident, IncidentListResponse, IncidentStats } from '../../types/index.js';
import { formatDateTime, formatRelative } from '../../utils/formatters.js';
import { Toast } from '../../utils/toast.js';

let currentTab = '';
let allIncidents: Incident[] = [];

export async function renderIncidents(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="incidents-summary" id="incidents-summary">
      <div class="empty-state"><div class="empty-state__title">Loading…</div></div>
    </div>

    <div class="incidents-tabs" id="incident-tabs">
      <button class="incidents-tabs__btn incidents-tabs__btn--active" data-status="">All</button>
      <button class="incidents-tabs__btn" data-status="issued">Issued</button>
      <button class="incidents-tabs__btn" data-status="pending">Pending</button>
      <button class="incidents-tabs__btn" data-status="resolved">Resolved</button>
    </div>

    <div class="card" id="incidents-table-card">
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">Loading incidents…</div>
      </div>
    </div>

    <!-- Incident Detail Modal -->
    <div class="modal-overlay" id="incident-modal" style="display: none;">
      <div class="modal" style="max-width: 560px;">
        <div class="modal__header">
          <span class="modal__title">Incident Detail</span>
          <button class="btn btn--outline btn--sm" id="close-modal">✕</button>
        </div>
        <div class="modal__body" id="incident-modal-body"></div>
        <div class="modal__footer" id="incident-modal-footer"></div>
      </div>
    </div>
  `;

  document.getElementById('incident-tabs')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.incidents-tabs__btn') as HTMLElement;
    if (!btn) return;
    document.querySelectorAll('.incidents-tabs__btn').forEach(b => b.classList.remove('incidents-tabs__btn--active'));
    btn.classList.add('incidents-tabs__btn--active');
    currentTab = btn.dataset.status || '';
    renderTable(filterIncidents());
  });

  document.getElementById('close-modal')?.addEventListener('click', closeModal);
  document.getElementById('incident-modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'incident-modal') closeModal();
  });

  await loadIncidents();
}

async function loadIncidents(): Promise<void> {
  try {
    const [data, stats] = await Promise.all([
      api.get<IncidentListResponse>('/incidents', { limit: '200' }),
      api.get<IncidentStats>('/incidents/stats/overview').catch(() => null),
    ]);
    allIncidents = data.incidents;
    renderSummary(stats);
    renderTable(filterIncidents());
  } catch {
    const el = document.getElementById('incidents-table-card');
    if (el) el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No incidents yet</div>
        <div class="empty-state__desc">Incidents appear when accidents are detected</div>
      </div>
    `;
  }
}

function filterIncidents(): Incident[] {
  if (!currentTab) return allIncidents;
  return allIncidents.filter(i => i.status === currentTab);
}

function renderSummary(stats: IncidentStats | null): void {
  const el = document.getElementById('incidents-summary');
  if (!el) return;

  if (!stats) {
    const counts = { issued: 0, pending: 0, resolved: 0 };
    for (const i of allIncidents) {
      if (i.status in counts) counts[i.status as keyof typeof counts]++;
    }
    el.innerHTML = `
      <div class="incidents-summary__bar">
        <div class="incidents-summary__stat">
          <span class="incidents-summary__num">${allIncidents.length}</span>
          <span class="incidents-summary__label">Total</span>
        </div>
        <div class="incidents-summary__divider"></div>
        <div class="incidents-summary__stat">
          <span class="incidents-summary__num incidents-summary__num--issued">${counts.issued}</span>
          <span class="incidents-summary__label">Issued</span>
        </div>
        <div class="incidents-summary__stat">
          <span class="incidents-summary__num incidents-summary__num--pending">${counts.pending}</span>
          <span class="incidents-summary__label">Pending</span>
        </div>
        <div class="incidents-summary__stat">
          <span class="incidents-summary__num incidents-summary__num--resolved">${counts.resolved}</span>
          <span class="incidents-summary__label">Resolved</span>
        </div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="incidents-summary__bar">
      <div class="incidents-summary__stat">
        <span class="incidents-summary__num">${stats.total_incidents}</span>
        <span class="incidents-summary__label">Total</span>
      </div>
      <div class="incidents-summary__divider"></div>
      <div class="incidents-summary__stat">
        <span class="incidents-summary__num incidents-summary__num--issued">${stats.issued_count}</span>
        <span class="incidents-summary__label">Issued</span>
      </div>
      <div class="incidents-summary__stat">
        <span class="incidents-summary__num incidents-summary__num--pending">${stats.pending_count}</span>
        <span class="incidents-summary__label">Pending</span>
      </div>
      <div class="incidents-summary__stat">
        <span class="incidents-summary__num incidents-summary__num--resolved">${stats.resolved_count}</span>
        <span class="incidents-summary__label">Resolved</span>
      </div>
      <div class="incidents-summary__divider"></div>
      <div class="incidents-summary__stat">
        <span class="incidents-summary__num">${stats.avg_confidence > 0 ? (stats.avg_confidence * 100).toFixed(0) + '%' : '—'}</span>
        <span class="incidents-summary__label">Avg Confidence</span>
      </div>
    </div>
  `;
}

function renderTable(incidents: Incident[]): void {
  const el = document.getElementById('incidents-table-card');
  if (!el) return;

  if (!incidents.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No incidents found</div>
        <div class="empty-state__desc">${currentTab ? `No ${currentTab} incidents` : 'Upload a video to start detecting'}</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Confidence</th>
          <th>Severity</th>
          <th>Source</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${incidents.map(i => {
          const confPct = (i.confidence * 100).toFixed(1);
          const statusClass = i.status === 'resolved' ? 'text-success' : i.status === 'pending' ? 'text-warning' : 'text-info';
          return `
          <tr data-incident-id="${i.id}" class="incident-row">
            <td>${formatDateTime(i.timestamp)}</td>
            <td>
              <div class="confidence-bar">
                <div class="confidence-bar__fill" style="width:${confPct}%"></div>
              </div>
              <span class="confidence-bar__label">${confPct}%</span>
            </td>
            <td><span class="badge badge--${i.severity}">${i.severity}</span></td>
            <td style="color: var(--text-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i.source_video || '—'}</td>
            <td><span class="${statusClass}" style="font-weight:600; text-transform:capitalize;">${i.status}</span></td>
            <td>
              <button class="btn btn--outline btn--sm incident-view-btn" data-id="${i.id}">View</button>
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;

  el.querySelectorAll('.incident-view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      const incident = incidents.find(i => i.id === id);
      if (incident) showIncidentDetail(incident);
    });
  });
}

function showIncidentDetail(incident: Incident): void {
  const modal = document.getElementById('incident-modal');
  const body = document.getElementById('incident-modal-body');
  const footer = document.getElementById('incident-modal-footer');
  if (!modal || !body || !footer) return;

  const confPct = (incident.confidence * 100).toFixed(1);
  const statusColors: Record<string, string> = {
    issued: 'var(--info)',
    pending: 'var(--warning)',
    resolved: 'var(--success)',
  };

  const meta = incident.metadata as Record<string, unknown> | null;
  const cameraName = meta?.camera_name as string | undefined;
  const cameraLocation = meta?.camera_route as string | undefined;
  const cameraCounty = meta?.camera_county as string | undefined;

  let locationStr = incident.source_video || 'Unknown';
  if (cameraName) locationStr = cameraName;
  if (cameraCounty && cameraLocation) locationStr = `${cameraCounty}, ${cameraLocation}`;

  body.innerHTML = `
    <div style="display: grid; gap: var(--space-4);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: var(--text-lg); font-weight: 700; font-family: monospace;">
          ${incident.id.slice(0, 12).toUpperCase()}
        </span>
        <span class="badge badge--${incident.status}" style="font-size: var(--text-sm);">
          ${incident.status.toUpperCase()}
        </span>
      </div>

      ${incident.evidence_path
        ? `<div style="border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border);">
             <img src="/evidence/${incident.evidence_path}" alt="Evidence"
               style="width: 100%; max-height: 240px; object-fit: cover;" />
           </div>`
        : ''
      }

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Confidence</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="confidence-bar" style="flex:1;">
              <div class="confidence-bar__fill" style="width:${confPct}%"></div>
            </div>
            <span style="font-weight:600; font-size:0.85rem;">${confPct}%</span>
          </div>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Severity</div>
          <span class="badge badge--${incident.severity}">${incident.severity}</span>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Status</div>
          <span style="color: ${statusColors[incident.status] || 'inherit'}; font-weight: 600;">${incident.status}</span>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Detected</div>
          <div style="font-size: var(--text-sm);">${formatDateTime(incident.timestamp)}</div>
        </div>
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Location</div>
          <div style="font-size: var(--text-sm);">${locationStr}</div>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Event ID</div>
          <div style="font-size: var(--text-xs); font-family: monospace; color: var(--text-muted);">${incident.id}</div>
        </div>
        ${incident.ticket_id ? `
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Ticket ID</div>
          <div style="font-size: var(--text-xs); font-family: monospace; color: var(--text-muted);">${incident.ticket_id}</div>
        </div>` : ''}
      </div>
    </div>
  `;

  const nextStatus: Record<string, string> = {
    issued: 'pending',
    pending: 'resolved',
  };
  const next = nextStatus[incident.status];

  footer.innerHTML = next
    ? `<button class="btn btn--primary btn--sm" id="advance-status">
        Mark as ${next.charAt(0).toUpperCase() + next.slice(1)}
       </button>`
    : `<span style="font-size: var(--text-sm); color: var(--success);">✓ Resolved</span>`;

  if (next) {
    document.getElementById('advance-status')?.addEventListener('click', async () => {
      try {
        await api.patch<Incident>(`/incidents/${incident.id}/status?status=${next}`, {});
        allIncidents = allIncidents.map(i => i.id === incident.id ? { ...i, status: next as Incident['status'] } : i);
        renderSummary(null);
        renderTable(filterIncidents());
        closeModal();
        Toast.show(`Incident marked as ${next}`, 'success');
      } catch {
        Toast.show('Failed to update incident status', 'error');
      }
    });
  }

  modal.style.display = '';
}

function closeModal(): void {
  const modal = document.getElementById('incident-modal');
  if (modal) modal.style.display = 'none';
}
