/** Citadel — Main entry point & top-level router with auth gating. */

import { api } from './api.js';
import { renderHome } from './home/Home.js';
import { renderLogin } from './login/Login.js';
import { renderDashboard, cleanupDashboard } from './dashboard/Dashboard.js';

const app = document.getElementById('app')!;

function route(): void {
    const hash = window.location.hash || '#/';

    // Clean up dashboard resources when navigating away
    if (!hash.startsWith('#/dashboard')) {
        cleanupDashboard();
    }

    if (hash.startsWith('#/login')) {
        renderLogin(app);
    } else if (hash.startsWith('#/dashboard')) {
        // Gate: must be authenticated to access dashboard
        if (!api.isAuthenticated()) {
            window.location.hash = '#/login';
            return;
        }
        renderDashboard(app);
    } else {
        renderHome(app);
    }
}

// Listen for hash changes
window.addEventListener('hashchange', route);

// Initial route
route();