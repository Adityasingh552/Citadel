/** Dashboard — Tickets view with status tabs, card grid, and detail panel. */

import { api } from '../../api.js';
import type { ViolationTicket, TicketListResponse } from '../../types/index.js';
import { formatDateTime, formatRelative, eventTypeLabel } from '../../utils/formatters.js';
import { Toast } from '../../utils/toast.js';

let currentTab = '';
let allTickets: ViolationTicket[] = [];

export async function renderTickets(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="tickets-summary" id="tickets-summary"></div>

    <div class="tickets-tabs" id="ticket-tabs">
      <button class="tickets-tabs__btn tickets-tabs__btn--active" data-status="">All</button>
      <button class="tickets-tabs__btn" data-status="issued">Issued</button>
      <button class="tickets-tabs__btn" data-status="pending">Pending</button>
      <button class="tickets-tabs__btn" data-status="resolved">Resolved</button>
    </div>

    <div class="tickets-grid" id="tickets-grid">
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">Loading tickets…</div>
      </div>
    </div>

    <!-- Ticket Detail Modal -->
    <div class="modal-overlay" id="ticket-modal" style="display: none;">
      <div class="modal" style="max-width: 520px;">
        <div class="modal__header">
          <span class="modal__title">Ticket Detail</span>
          <button class="btn btn--outline btn--sm" id="close-modal">✕</button>
        </div>
        <div class="modal__body" id="ticket-modal-body"></div>
        <div class="modal__footer" id="ticket-modal-footer"></div>
      </div>
    </div>
  `;

  // Tab clicks
  document.getElementById('ticket-tabs')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.tickets-tabs__btn') as HTMLElement;
    if (!btn) return;
    document.querySelectorAll('.tickets-tabs__btn').forEach(b => b.classList.remove('tickets-tabs__btn--active'));
    btn.classList.add('tickets-tabs__btn--active');
    currentTab = btn.dataset.status || '';
    renderGrid(filterTickets());
  });

  // Close modal
  document.getElementById('close-modal')?.addEventListener('click', closeModal);
  document.getElementById('ticket-modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'ticket-modal') closeModal();
  });

  await loadTickets();
}

async function loadTickets(): Promise<void> {
  try {
    const data = await api.get<TicketListResponse>('/tickets', { limit: '200' });
    allTickets = data.tickets;
    renderSummary();
    renderGrid(filterTickets());
  } catch {
    const el = document.getElementById('tickets-grid');
    if (el) el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No tickets yet</div>
        <div class="empty-state__desc">Tickets are auto-created when violations are detected</div>
      </div>
    `;
  }
}

function filterTickets(): ViolationTicket[] {
  if (!currentTab) return allTickets;
  return allTickets.filter(t => t.status === currentTab);
}

function renderSummary(): void {
  const el = document.getElementById('tickets-summary');
  if (!el) return;
  const counts = { issued: 0, pending: 0, resolved: 0 };
  for (const t of allTickets) {
    if (t.status in counts) counts[t.status as keyof typeof counts]++;
  }
  el.innerHTML = `
    <div class="tickets-summary__bar">
      <div class="tickets-summary__stat">
        <span class="tickets-summary__num">${allTickets.length}</span>
        <span class="tickets-summary__label">Total</span>
      </div>
      <div class="tickets-summary__divider"></div>
      <div class="tickets-summary__stat">
        <span class="tickets-summary__num tickets-summary__num--issued">${counts.issued}</span>
        <span class="tickets-summary__label">Issued</span>
      </div>
      <div class="tickets-summary__stat">
        <span class="tickets-summary__num tickets-summary__num--pending">${counts.pending}</span>
        <span class="tickets-summary__label">Pending</span>
      </div>
      <div class="tickets-summary__stat">
        <span class="tickets-summary__num tickets-summary__num--resolved">${counts.resolved}</span>
        <span class="tickets-summary__label">Resolved</span>
      </div>
    </div>
  `;
}

/** Strip source paths / frame refs — return only the human-readable road/location part. */
function locationShort(info: string | null | undefined): string {
  if (!info) return 'Unknown location';
  const clean = info
    .replace(/Source:\s*\S+/gi, '')
    .replace(/Frame:\s*\d+/gi, '')
    .trim()
    .replace(/\s{2,}/g, ' ');
  return clean || info;
}

/** Returns null if the description is the generic boilerplate. */
function vehicleDesc(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const boilerplate = ['vehicles involved in detected accident', 'no vehicle description'];
  if (boilerplate.includes(desc.toLowerCase().trim())) return null;
  return desc;
}

function renderGrid(tickets: ViolationTicket[]): void {
  const el = document.getElementById('tickets-grid');
  if (!el) return;

  if (!tickets.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No tickets found</div>
        <div class="empty-state__desc">${currentTab ? `No ${currentTab} tickets` : 'Upload a video to start detecting'}</div>
      </div>
    `;
    return;
  }

  el.innerHTML = tickets.map(t => {
    const loc = locationShort(t.location_info);
    const veh = vehicleDesc(t.vehicle_description);
    const type = eventTypeLabel(t.violation_type);
    return `
    <div class="ticket-card ticket-card--${t.violation_type}" data-ticket-id="${t.id}" title="Click for details">
      <div class="ticket-card__accent-bar"></div>
      <div class="ticket-card__inner">
        <div class="ticket-card__top">
          <code class="ticket-card__id">TKT-${t.id.slice(0, 8).toUpperCase()}</code>
          <span class="badge badge--${t.violation_type}">${type}</span>
        </div>
        <div class="ticket-card__location">${loc}</div>
        ${veh ? `<div class="ticket-card__vehicle">${veh}</div>` : ''}
        <div class="ticket-card__footer">
          <span class="ticket-card__time">${formatRelative(t.issued_at)}</span>
          <span class="badge badge--${t.status}">${t.status}</span>
        </div>
      </div>
    </div>
  `}).join('');

  el.querySelectorAll('.ticket-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.ticketId!;
      const ticket = tickets.find(t => t.id === id);
      if (ticket) showTicketDetail(ticket);
    });
  });
}

function showTicketDetail(ticket: ViolationTicket): void {
  const modal = document.getElementById('ticket-modal');
  const body = document.getElementById('ticket-modal-body');
  const footer = document.getElementById('ticket-modal-footer');
  if (!modal || !body || !footer) return;

  const statusColors: Record<string, string> = {
    issued:   'var(--info)',
    pending:  'var(--warning)',
    resolved: 'var(--success)',
  };

  const loc = locationShort(ticket.location_info);
  const veh = vehicleDesc(ticket.vehicle_description);

  body.innerHTML = `
    <div style="display: grid; gap: var(--space-4);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: var(--text-lg); font-weight: 700; font-family: monospace;">
          TKT-${ticket.id.slice(0, 8).toUpperCase()}
        </span>
        <span class="badge badge--${ticket.status}" style="font-size: var(--text-sm);">
          ${ticket.status.toUpperCase()}
        </span>
      </div>

      ${ticket.evidence_path
        ? `<div style="border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border);">
             <img src="/evidence/${ticket.evidence_path}" alt="Evidence"
               style="width: 100%; max-height: 240px; object-fit: cover;" />
           </div>`
        : ''
      }

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Violation</div>
          <span class="badge badge--${ticket.violation_type}">${eventTypeLabel(ticket.violation_type)}</span>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Status</div>
          <span style="color: ${statusColors[ticket.status] || 'inherit'}; font-weight: 600;">${ticket.status}</span>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Issued</div>
          <div style="font-size: var(--text-sm);">${formatDateTime(ticket.issued_at)}</div>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Created</div>
          <div style="font-size: var(--text-sm);">${formatDateTime(ticket.created_at)}</div>
        </div>
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Location</div>
          <div style="font-size: var(--text-sm);">${loc}</div>
        </div>
        ${veh ? `
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Vehicle</div>
          <div style="font-size: var(--text-sm);">${veh}</div>
        </div>` : ''}
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Ticket ID</div>
          <div style="font-size: var(--text-xs); font-family: monospace; color: var(--text-muted);">${ticket.id}</div>
        </div>
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Event ID</div>
          <div style="font-size: var(--text-xs); font-family: monospace; color: var(--text-muted);">${ticket.event_id}</div>
        </div>
      </div>
    </div>
  `;

  const nextStatus: Record<string, string> = {
    issued:  'pending',
    pending: 'resolved',
  };
  const next = nextStatus[ticket.status];

  footer.innerHTML = next
    ? `<button class="btn btn--primary btn--sm" id="advance-status">
        Mark as ${next.charAt(0).toUpperCase() + next.slice(1)}
       </button>`
    : `<span style="font-size: var(--text-sm); color: var(--success);">✓ Resolved</span>`;

  if (next) {
    document.getElementById('advance-status')?.addEventListener('click', async () => {
      try {
        await api.patch(`/tickets/${ticket.id}`, { status: next });
        // Optimistic update — no full reload needed
        allTickets = allTickets.map(t => t.id === ticket.id ? { ...t, status: next as any } : t);
        renderSummary();
        renderGrid(filterTickets());
        closeModal();
      } catch {
        Toast.show('Failed to update ticket status', 'error');
      }
    });
  }

  modal.style.display = '';
}

function closeModal(): void {
  const modal = document.getElementById('ticket-modal');
  if (modal) modal.style.display = 'none';
}
