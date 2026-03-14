/** Citadel — Dashboard shell with sidebar, header, and view routing. */

import { api } from '../api.js';
import type { DashboardView } from '../types/index.js';
import { renderOverview } from './views/Overview.js';
import { renderEvents } from './views/Events.js';
import { renderTickets } from './views/Tickets.js';
import { renderLiveFeed } from './views/LiveFeed.js';
import { renderMonitor, destroyMonitor } from './views/Monitor.js';
import { renderSettings } from './views/Settings.js';

const NAV_ITEMS: { id: DashboardView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'events', label: 'Events' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'live', label: 'Live Feed' },
  { id: 'monitor', label: 'Live Monitor' },
  { id: 'settings', label: 'Settings' },
];

const VIEW_TITLES: Record<DashboardView, string> = {
  overview: 'Overview',
  events: 'Events',
  tickets: 'Tickets',
  live: 'Live Feed',
  monitor: 'Live Monitor',
  settings: 'Settings',
};

function getActiveView(): DashboardView {
  const hash = window.location.hash;
  const match = hash.match(/#\/dashboard\/(\w+)/);
  if (match && NAV_ITEMS.some(n => n.id === match[1])) {
    return match[1] as DashboardView;
  }
  return 'overview';
}

function renderViewContent(view: DashboardView, container: HTMLElement): void {
  // Clean up previous views that need it
  destroyMonitor();

  switch (view) {
    case 'overview': renderOverview(container); break;
    case 'events': renderEvents(container); break;
    case 'tickets': renderTickets(container); break;
    case 'live': renderLiveFeed(container); break;
    case 'monitor': renderMonitor(container); break;
    case 'settings': renderSettings(container); break;
  }
}

/** Clean up dashboard resources (e.g., monitor timers/map) before leaving. */
export function cleanupDashboard(): void {
  destroyMonitor();
}

export function renderDashboard(container: HTMLElement): void {
  const activeView = getActiveView();

  container.innerHTML = `
    <div class="dashboard">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar__logo">Citadel</div>
        <nav class="sidebar__nav">
          ${NAV_ITEMS.map(item => `
            <a href="#/dashboard/${item.id}"
               class="sidebar__item ${item.id === activeView ? 'sidebar__item--active' : ''}"
               data-view="${item.id}">
              <span>${item.label}</span>
            </a>
          `).join('')}
        </nav>
        <div class="sidebar__footer">
          <div class="sidebar__status">
            <span class="sidebar__status-dot"></span>
            System Online
          </div>
          <button class="sidebar__back" id="logout-btn">Logout</button>
          <a href="#/" class="sidebar__back">← Back to Home</a>
        </div>
      </aside>

      <!-- Header -->
      <header class="header">
        <h1 class="header__title" id="view-title">${VIEW_TITLES[activeView]}</h1>
        <div class="header__actions">
          <input type="text" class="header__search" placeholder="Search..." />
          <button class="header__icon-btn" title="Notifications">
            <span class="header__badge" id="notif-badge">0</span>
          </button>
          <span class="header__clock" id="header-clock"></span>
        </div>
      </header>

      <!-- Content -->
      <main class="content" id="dashboard-content"></main>
    </div>
  `;

  // Render active view
  const content = document.getElementById('dashboard-content')!;
  renderViewContent(activeView, content);

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    api.logout();
  });
}

function updateClock(): void {
  const el = document.getElementById('header-clock');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
  }
}
