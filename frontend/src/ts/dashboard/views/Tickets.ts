/** Dashboard — Tickets view with status tabs, card grid, and detail panel. */

import { api } from '../../api.js';
import type { ViolationTicket, TicketListResponse } from '../../types/index.js';
import { formatDateTime, eventTypeLabel } from '../../utils/formatters.js';

let currentTab = '';

export async function renderTickets(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="tickets-tabs" id="ticket-tabs">
      <button class="tickets-tabs__btn tickets-tabs__btn--active" data-status="">All</button>
      <button class="tickets-tabs__btn" data-status="issued">Issued</button>
      <button class="tickets-tabs__btn" data-status="pending">Pending</button>
      <button class="tickets-tabs__btn" data-status="resolved">Resolved</button>
    </div>
    <div class="tickets-grid" id="tickets-grid">
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">Loading tickets...</div>
      </div>
    </div>

    <!-- Ticket Detail Modal -->
    <div class="modal-overlay" id="ticket-modal" style="display: none;">
      <div class="modal" style="max-width: 520px;">
        <div class="modal__header">
          <span class="modal__title">Ticket Detail</span>
          <button class="btn btn--outline btn--sm" id="close-modal">X</button>
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
    loadTickets();
  });

  // Close modal
  document.getElementById('close-modal')?.addEventListener('click', closeModal);
  document.getElementById('ticket-modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'ticket-modal') closeModal();
  });

  await loadTickets();
}

async function loadTickets(): Promise<void> {
  const params: Record<string, string> = { limit: '50' };
  if (currentTab) params.status = currentTab;

  try {
    const data = await api.get<TicketListResponse>('/tickets', params);
    renderGrid(data.tickets);
  } catch {
    const el = document.getElementById('tickets-grid');
    if (el) el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No tickets yet</div>
        <div class="empty-state__desc">Tickets are auto-created when accidents are detected</div>
      </div>
    `;
  }
}

function renderGrid(tickets: ViolationTicket[]): void {
  const el = document.getElementById('tickets-grid');
  if (!el) return;

  if (!tickets.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon"></div>
        <div class="empty-state__title">No tickets found</div>
        <div class="empty-state__desc">${currentTab ? 'No tickets with this status' : 'Upload a video to start detecting'}</div>
      </div>
    `;
    return;
  }

  el.innerHTML = tickets.map(t => `
    <div class="ticket-card" data-ticket-id="${t.id}" style="cursor: pointer;" title="Click for details">
      <div class="ticket-card__header ticket-card__header--${t.violation_type}">
        ${eventTypeLabel(t.violation_type)} Violation
      </div>
      <div class="ticket-card__body">
        <div class="ticket-card__id">TKT-${t.id.slice(0, 8).toUpperCase()}</div>
        <div class="ticket-card__info">${t.vehicle_description || 'No vehicle description'}</div>
        <div class="ticket-card__info">${t.location_info || 'Unknown location'}</div>
      </div>
      <div class="ticket-card__footer">
        <span>${formatDateTime(t.issued_at)}</span>
        <span class="badge badge--${t.status}">${t.status}</span>
      </div>
    </div>
  `).join('');

  // Card click → show detail modal
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
    issued: 'var(--info)',
    pending: 'var(--warning)',
    resolved: 'var(--success)',
  };

  body.innerHTML = `
    <div style="display: grid; gap: var(--space-4);">
      <!-- Header info -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: var(--text-lg); font-weight: 700;">
          TKT-${ticket.id.slice(0, 8).toUpperCase()}
        </span>
        <span class="badge badge--${ticket.status}" style="font-size: var(--text-sm);">
          ${ticket.status.toUpperCase()}
        </span>
      </div>

      <!-- Evidence image -->
      ${ticket.evidence_path
      ? `<div style="border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border);">
            <img src="/evidence/${ticket.evidence_path}" alt="Evidence"
              style="width: 100%; max-height: 240px; object-fit: cover;" />
          </div>`
      : ''
    }

      <!-- Details grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Violation Type</div>
          <span class="badge badge--${ticket.violation_type}">${eventTypeLabel(ticket.violation_type)}</span>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Status</div>
          <span style="color: ${statusColors[ticket.status] || 'inherit'}; font-weight: 600;">${ticket.status}</span>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Issued At</div>
          <div style="font-size: var(--text-sm);">${formatDateTime(ticket.issued_at)}</div>
        </div>
        <div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Created</div>
          <div style="font-size: var(--text-sm);">${formatDateTime(ticket.created_at)}</div>
        </div>
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Vehicle</div>
          <div style="font-size: var(--text-sm);">${ticket.vehicle_description || 'Not identified'}</div>
        </div>
        <div style="grid-column: 1 / -1;">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 2px;">Location</div>
          <div style="font-size: var(--text-sm);">${ticket.location_info || 'Unknown'}</div>
        </div>
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

  // Footer with status change buttons
  const nextStatus: Record<string, string> = {
    issued: 'pending',
    pending: 'resolved',
  };
  const next = nextStatus[ticket.status];

  footer.innerHTML = next
    ? `<button class="btn btn--primary btn--sm" id="advance-status">
        Mark as ${next.charAt(0).toUpperCase() + next.slice(1)}
      </button>`
    : `<span style="font-size: var(--text-sm); color: var(--success);">Resolved</span>`;

  if (next) {
    document.getElementById('advance-status')?.addEventListener('click', async () => {
      try {
        await api.patch(`/tickets/${ticket.id}`, { status: next });
        closeModal();
        await loadTickets();
      } catch {
        alert('Failed to update status');
      }
    });
  }

  modal.style.display = '';
}

function closeModal(): void {
  const modal = document.getElementById('ticket-modal');
  if (modal) modal.style.display = 'none';
}
