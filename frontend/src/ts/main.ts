/** Citadel — Main entry point & top-level router with auth gating. */

import { api } from './api.js';
import { renderHome } from './home/Home.js';
import { renderLogin } from './login/Login.js';
import { renderDashboard, cleanupDashboard } from './dashboard/Dashboard.js';

let authGateChecked = false;
let authGateAllowed = false;

const app = document.getElementById('app')!;

/* ── Inject global SVG filter for Liquid Glass bend distortion ── */
(function injectLiquidGlassFilter() {
    if (document.getElementById('liquid-glass-bend')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    svg.innerHTML = `
        <defs>
            <filter id="liquid-glass-bend" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox">
                <feTurbulence type="fractalNoise" baseFrequency="0.003 0.007" numOctaves="1" result="turbulence" />
                <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="200" xChannelSelector="R" yChannelSelector="G" />
            </filter>
        </defs>
    `;
    document.body.prepend(svg);
})();

async function route(): Promise<void> {
    const hash = window.location.hash || '#/';

    // Clean up dashboard resources when navigating away
    if (!hash.startsWith('#/dashboard')) {
        cleanupDashboard();
    }

    if (hash.startsWith('#/login')) {
        authGateChecked = false;
        authGateAllowed = false;
        renderLogin(app);
    } else if (hash.startsWith('#/dashboard')) {
        if (!authGateChecked) {
            // Gate: must be authenticated to access dashboard
            const authenticated = await api.isAuthenticated();
            authGateChecked = true;
            authGateAllowed = authenticated;
            if (!authenticated) {
                window.location.hash = '#/login';
                return;
            }
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
