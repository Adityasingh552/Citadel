/** Citadel — Main entry point & top-level router. */

import { renderHome } from './home/Home.js';
import { renderDashboard } from './dashboard/Dashboard.js';

const app = document.getElementById('app')!;

function route(): void {
    const hash = window.location.hash || '#/';

    if (hash.startsWith('#/dashboard')) {
        renderDashboard(app);
    } else {
        renderHome(app);
    }
}

// Listen for hash changes
window.addEventListener('hashchange', route);

// Initial route
route();