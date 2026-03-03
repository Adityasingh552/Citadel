/** Dashboard — Events view with filterable table and detail panel. */

import { api } from '../../api.js';
import type { CitadelEvent, EventListResponse } from '../../types/index.js';
import { formatDateTime, eventTypeLabel } from '../../utils/formatters.js';

let selectedEvent: CitadelEvent | null = null;

export async function renderEvents(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="filter-bar">
      <select id="filter-type">
        <option value="">All Types</option>
        <option value="accident">Accident</option>
        <option value="vehicle">Vehicle</option>
      </select>
      <select id="filter-severity">
        <option value="">All Severities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <button class="btn btn--primary btn--sm" id="apply-filters">Apply</button>
    </div>
    <div class="events-layout events-layout--no-detail" id="events-container">
      <div class="card" id="events-table-card">
        <div class="empty-state">
          <div class="empty-state__icon"></div>
          <div class="empty-state__title">Loading events...</div>
        </div>
      </div>
    </div>
  `;

  // Load events
  await loadEvents();

  // Filter button
  document.getElementById('apply-filters')?.addEventListener('click', loadEvents);
}

async function loadEvents(): Promise<void> {
  const typeFilter = (document.getElementById('filter-type') as HTMLSelectElement)?.value || '';
  const sevFilter = (document.getElementById('filter-severity') as HTMLSelectElement)?.value || '';

  const params: Record<string, string> = { limit: '50' };
  if (typeFilter) params.type = typeFilter;
  if (sevFilter) params.severity = sevFilter;

  try {
    const data = await api.get<EventListResponse>('/events', params);
    renderTable(data.events);
  } catch {
    const el = document.getElementById('events-table-card');
    if (el) el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No events detected yet</div>
        <div class="empty-state__desc">Upload a traffic video to get started</div>
      </div>
    `;
  }
}

function renderTable(events: CitadelEvent[]): void {
  const el = document.getElementById('events-table-card');
  if (!el) return;

  if (!events.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No events found</div>
        <div class="empty-state__desc">Try adjusting your filters</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Type</th>
          <th>Severity</th>
          <th>Confidence</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${events.map(e => `
          <tr data-event-id="${e.id}" class="event-row">
            <td>${formatDateTime(e.timestamp)}</td>
            <td><span class="badge badge--${e.event_type}">${eventTypeLabel(e.event_type)}</span></td>
            <td><span class="badge badge--${e.severity}">${e.severity}</span></td>
            <td>${(e.confidence * 100).toFixed(1)}%</td>
            <td>${e.source_video || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Row click → show detail
  el.querySelectorAll('.event-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = (row as HTMLElement).dataset.eventId!;
      const event = events.find(e => e.id === id);
      if (event) showDetail(event);
    });
  });
}

function showDetail(event: CitadelEvent): void {
  selectedEvent = event;
  const container = document.getElementById('events-container');
  if (!container) return;

  container.classList.remove('events-layout--no-detail');

  // Remove existing detail
  const existing = document.getElementById('event-detail');
  if (existing) existing.remove();

  const detail = document.createElement('div');
  detail.id = 'event-detail';
  detail.className = 'event-detail';
  detail.innerHTML = `
    <div class="card__header">
      <span class="card__title">Event Detail</span>
      <button class="btn btn--outline btn--sm" id="close-detail">X</button>
    </div>
    <div class="event-detail__evidence">
      ${event.evidence_path
      ? `<img src="/evidence/${event.evidence_path}" alt="Evidence" />`
      : '<span style="color: var(--text-muted)">No evidence image</span>'
    }
    </div>
    <div class="event-detail__meta">
      <div class="event-detail__meta-item">
        <div class="event-detail__meta-label">Event ID</div>
        <div class="event-detail__meta-value">${event.id.slice(0, 12)}...</div>
      </div>
      <div class="event-detail__meta-item">
        <div class="event-detail__meta-label">Type</div>
        <div class="event-detail__meta-value">
          <span class="badge badge--${event.event_type}">${eventTypeLabel(event.event_type)}</span>
        </div>
      </div>
      <div class="event-detail__meta-item">
        <div class="event-detail__meta-label">Severity</div>
        <div class="event-detail__meta-value">
          <span class="badge badge--${event.severity}">${event.severity}</span>
        </div>
      </div>
      <div class="event-detail__meta-item">
        <div class="event-detail__meta-label">Confidence</div>
        <div class="event-detail__meta-value">${(event.confidence * 100).toFixed(1)}%</div>
      </div>
      <div class="event-detail__meta-item">
        <div class="event-detail__meta-label">Timestamp</div>
        <div class="event-detail__meta-value">${formatDateTime(event.timestamp)}</div>
      </div>
      <div class="event-detail__meta-item">
        <div class="event-detail__meta-label">Frame</div>
        <div class="event-detail__meta-value">${event.frame_number ?? '—'}</div>
      </div>
    </div>
  `;
  container.appendChild(detail);

  document.getElementById('close-detail')?.addEventListener('click', () => {
    detail.remove();
    container.classList.add('events-layout--no-detail');
    selectedEvent = null;
  });
}
