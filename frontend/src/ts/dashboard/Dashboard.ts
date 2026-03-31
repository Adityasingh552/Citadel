/** Citadel — Dashboard shell with sidebar, header, view routing, and theme toggle. */

import { api } from '../api.js';
import type { DashboardView } from '../types/index.js';
import { renderOverview } from './views/Overview.js';
import { renderEvents } from './views/Events.js';
import { renderTickets } from './views/Tickets.js';
import { renderLiveFeed } from './views/LiveFeed.js';
import { renderMonitor, destroyMonitor } from './views/Monitor.js';
import { renderCameras, destroyCameras } from './views/Cameras.js';
import { renderSettings } from './views/Settings.js';

/* ── SVG Icons (minimal line-style, 18×18) ── */
const ICONS: Record<string, string> = {
  overview: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  events:   `<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
  tickets:  `<svg viewBox="0 0 24 24"><path d="M15 5v2m0 4v2m0 4v2"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/></svg>`,
  live:     `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>`,
  monitor:  `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  cameras:  `<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
};

const ICON_SUN = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;

const NAV_ITEMS: { id: DashboardView; label: string; section?: string }[] = [
  { id: 'overview', label: 'Overview', section: 'Analytics' },
  { id: 'events',   label: 'Events' },
  { id: 'tickets',  label: 'Tickets' },
  { id: 'live',     label: 'Manual Feed', section: 'Operations' },
  { id: 'monitor',  label: 'Live Monitor' },
  { id: 'cameras',  label: 'Cameras' },
  { id: 'settings', label: 'Settings', section: 'System' },
];

const VIEW_TITLES: Record<DashboardView, string> = {
  overview: 'Overview',
  events:   'Events',
  tickets:  'Tickets',
  live:     'Manual Feed',
  monitor:  'Live Monitor',
  cameras:  'Cameras',
  settings: 'Settings',
};

/* ── Theme management ── */
function getStoredTheme(): 'dark' | 'light' {
  return (localStorage.getItem('citadel-theme') as 'dark' | 'light') || 'dark';
}

function applyTheme(theme: 'dark' | 'light'): void {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('citadel-theme', theme);
}

function toggleTheme(): void {
  const current = getStoredTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);

  // Update toggle UI
  const thumb = document.getElementById('theme-thumb');
  const label = document.getElementById('theme-label');
  if (thumb) thumb.innerHTML = next === 'dark' ? ICON_MOON : ICON_SUN;
  if (label) label.textContent = next === 'dark' ? 'Dark' : 'Light';
}

// Apply stored theme on load
applyTheme(getStoredTheme());

/* ── Routing ── */
function getActiveView(): DashboardView {
  const hash = window.location.hash;
  const match = hash.match(/#\/dashboard\/(\w+)/);
  if (match && NAV_ITEMS.some(n => n.id === match[1])) {
    return match[1] as DashboardView;
  }
  return 'overview';
}

function renderViewContent(view: DashboardView, container: HTMLElement): void {
  destroyMonitor();
  destroyCameras();

  switch (view) {
    case 'overview': renderOverview(container); break;
    case 'events':   renderEvents(container);   break;
    case 'tickets':  renderTickets(container);   break;
    case 'live':     renderLiveFeed(container);  break;
    case 'monitor':  renderMonitor(container);   break;
    case 'cameras':  renderCameras(container);   break;
    case 'settings': renderSettings(container);  break;
  }
}

export function cleanupDashboard(): void {
  destroyMonitor();
  destroyCameras();
}

/* ── Build sidebar nav HTML ── */
function buildNavHTML(activeView: DashboardView): string {
  let html = '';
  let currentSection = '';

  for (const item of NAV_ITEMS) {
    if (item.section && item.section !== currentSection) {
      currentSection = item.section;
      html += `<div class="sidebar__section-label">${item.section}</div>`;
    }

    const isActive = item.id === activeView;
    html += `
      <a href="#/dashboard/${item.id}"
         class="sidebar__item ${isActive ? 'sidebar__item--active' : ''}"
         data-view="${item.id}">
        <span class="nav-icon-glass">${ICONS[item.id] || ''}</span>
        <span>${item.label}</span>
      </a>`;
  }

  return html;
}

/* ── Render ── */
export function renderDashboard(container: HTMLElement): void {
  const activeView = getActiveView();
  const currentTheme = getStoredTheme();
  const themeIcon = currentTheme === 'dark' ? ICON_MOON : ICON_SUN;
  const themeLabel = currentTheme === 'dark' ? 'Dark' : 'Light';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  container.innerHTML = `
    <div class="dashboard">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar__logo">
          <span class="sidebar__logo-mark">C</span>
          Citadel
        </div>

        <nav class="sidebar__nav">
          ${buildNavHTML(activeView)}
        </nav>

        <div class="sidebar__footer">
          <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle theme">
            <div class="theme-toggle__track">
              <div class="theme-toggle__thumb" id="theme-thumb">${themeIcon}</div>
            </div>
            <span class="theme-toggle__label" id="theme-label">${themeLabel}</span>
          </button>

          <div class="sidebar__status">
            <span class="sidebar__status-dot"></span>
            System Online
          </div>

          <div class="sidebar__footer-actions">
            <button class="sidebar__back" id="logout-btn">Logout</button>
            <a href="#/" class="sidebar__back">← Back to Home</a>
          </div>
        </div>
      </aside>

      <!-- Header -->
      <header class="header">
        <h1 class="header__title" id="view-title">${VIEW_TITLES[activeView]}</h1>
        <div class="header__actions">
          <input type="text" class="header__search" placeholder="Search..." />
          <span class="header__date">${dateStr}</span>
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

  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // Logout
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
