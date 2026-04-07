import { api } from '../api.js';

const PREFETCH_TTL_MS = 20000;

let prefetchTimer: number | null = null;
let prefetchInFlight = false;

function prefetchOverviewData(): Promise<void> {
  return Promise.allSettled([
    api.get('/alerts/stats', undefined, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/stats/services', undefined, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/incidents/stats/overview', undefined, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/stats', undefined, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/incidents', { limit: '200' }, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/alerts', { limit: '5' }, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/cameras/monitor/status', undefined, { ttlMs: PREFETCH_TTL_MS }),
  ]).then(() => undefined);
}

function prefetchIncidentsData(): Promise<void> {
  return Promise.allSettled([
    api.get('/incidents', { limit: '200' }, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/incidents/stats/overview', undefined, { ttlMs: PREFETCH_TTL_MS }),
  ]).then(() => undefined);
}

function prefetchSettingsData(): Promise<void> {
  return Promise.allSettled([
    api.get('/settings', undefined, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/settings/notifications', undefined, { ttlMs: PREFETCH_TTL_MS }),
  ]).then(() => undefined);
}

function prefetchCamerasData(): Promise<void> {
  return Promise.allSettled([
    api.get('/cameras/monitor/status', undefined, { ttlMs: PREFETCH_TTL_MS }),
    api.get('/cameras', { limit: '5000' }, { ttlMs: PREFETCH_TTL_MS }),
  ]).then(() => undefined);
}

export function scheduleDashboardPrefetch(activeView: string): void {
  if (document.hidden) return;
  if (prefetchInFlight) return;

  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }

  prefetchTimer = window.setTimeout(() => {
    prefetchTimer = null;
    if (document.hidden || prefetchInFlight) return;
    prefetchInFlight = true;

    const tasks: Promise<void>[] = [];
    if (activeView !== 'overview') tasks.push(prefetchOverviewData());
    if (activeView !== 'incidents') tasks.push(prefetchIncidentsData());
    if (activeView !== 'settings') tasks.push(prefetchSettingsData());
    if (activeView !== 'cameras') tasks.push(prefetchCamerasData());

    Promise.allSettled(tasks).finally(() => {
      prefetchInFlight = false;
    });
  }, 150);
}

export function cancelDashboardPrefetch(): void {
  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }
}
