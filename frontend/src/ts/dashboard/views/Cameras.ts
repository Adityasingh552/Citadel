/** Citadel — Cameras dashboard view: list + detail with map, snapshot, and stats. */

import { api } from '../../api.js';
import { Toast } from '../../utils/toast.js';
import { VideoPlayer } from '../../utils/videoPlayer.js';
import type { CameraInfo, MonitorStatus, MonitorStatusResponse } from '../../types/index.js';

declare const L: any; // Leaflet global from CDN

// State
let refreshTimer: number | null = null;
let detailRefreshTimer: number | null = null;
let detailSnapshotTimer: number | null = null;
let detailMap: any = null;
let currentView: 'list' | 'detail' | 'inactive' = 'inactive';
let cachedMonitors: MonitorStatusResponse | null = null;
let monitorsCacheAt = 0;
const MONITOR_REVALIDATE_MS = 20000;
const MONITOR_MAX_STALE_MS = 10 * 60 * 1000;
const MONITOR_STORAGE_KEY = 'citadel:view:cameras:monitor:v1';
let snapshotLoading = false;
let mainContainer: HTMLElement | null = null;

let monitorRefreshPromise: Promise<void> | null = null;

function loadMonitorsCache(): void {
    if (cachedMonitors) return;
    try {
        const raw = localStorage.getItem(MONITOR_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { at: number; data: MonitorStatusResponse };
        if (!parsed || typeof parsed.at !== 'number' || !parsed.data) return;
        if ((Date.now() - parsed.at) > MONITOR_MAX_STALE_MS) {
            localStorage.removeItem(MONITOR_STORAGE_KEY);
            return;
        }
        monitorsCacheAt = parsed.at;
        cachedMonitors = parsed.data;
    } catch {
        // Ignore invalid cache data.
    }
}

function persistMonitorsCache(data: MonitorStatusResponse): void {
    cachedMonitors = data;
    monitorsCacheAt = Date.now();
    try {
        localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ at: monitorsCacheAt, data }));
    } catch {
        // Ignore storage quota issues.
    }
}

// Video player state for detail view
let detailVideoPlayer: VideoPlayer | null = null;
let detailFeedMode: 'snapshot' | 'video' = 'snapshot';
let detailCameraId: string | null = null;
let detailCameraStreamUrl: string | null = null;

export function renderCameras(container: HTMLElement): void {
    mainContainer = container;
    currentView = 'list';
    renderList(container);
}

export function destroyCameras(): void {
    cleanupTimers();
    destroyDetailMap();
    destroyDetailVideoPlayer();
    detailFeedMode = 'snapshot';
    detailCameraId = null;
    detailCameraStreamUrl = null;
    mainContainer = null;
    cachedMonitors = null;
    currentView = 'inactive';
}

function cleanupTimers(): void {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (detailRefreshTimer) { clearTimeout(detailRefreshTimer); detailRefreshTimer = null; }
    if (detailSnapshotTimer) { clearInterval(detailSnapshotTimer); detailSnapshotTimer = null; }
    snapshotLoading = false;
}

function destroyDetailMap(): void {
    if (detailMap) { detailMap.remove(); detailMap = null; }
}

// ══════════════════════════════════════════════
//  LIST VIEW
// ══════════════════════════════════════════════

function renderList(container: HTMLElement): void {
    cleanupTimers();
    destroyDetailMap();
    currentView = 'list';
    loadMonitorsCache();

    container.innerHTML = `
        <div class="cameras-layout">
            <div class="cameras-header">
                <div class="cameras-header__left">
                    <h2 class="cameras-header__title">Monitored Cameras</h2>
                    <span class="cameras-header__subtitle" id="cameras-subtitle">Loading...</span>
                </div>
                <div class="cameras-header__actions">
                    <button class="btn btn--sm btn--outline" id="cameras-refresh-btn">Refresh</button>
                    <button class="btn btn--sm btn--danger" id="cameras-stop-all-btn" style="display:none;">Stop All</button>
                </div>
            </div>

            <div class="cameras-grid" id="cameras-grid">
                <div class="cameras-empty">
                    <p class="text-muted">Loading monitors...</p>
                </div>
            </div>
        </div>
    `;

    document.getElementById('cameras-refresh-btn')?.addEventListener('click', () => {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        loadMonitors(true);
    });
    document.getElementById('cameras-stop-all-btn')?.addEventListener('click', stopAllMonitors);

    if (cachedMonitors) {
        renderMonitorList(cachedMonitors);
        if ((Date.now() - monitorsCacheAt) >= MONITOR_REVALIDATE_MS) {
            void loadMonitors(true);
        }
    } else {
        void loadMonitors(true);
    }
}

async function loadMonitors(force: boolean = false): Promise<void> {
    // Don't refresh the list if we're in detail view
    if (currentView !== 'list') return;

    if (monitorRefreshPromise) {
        return monitorRefreshPromise;
    }

    monitorRefreshPromise = (async () => {
    try {
        const data = await api.get<MonitorStatusResponse>('/cameras/monitor/status', undefined, { ttlMs: MONITOR_REVALIDATE_MS, force });
        persistMonitorsCache(data);
        renderMonitorList(data);
        
        // Schedule next poll based on whether there are active monitors
        scheduleNextListPoll(data.active_count > 0);
    } catch (err) {
        console.error('Failed to load monitors:', err);
        if (cachedMonitors) {
            renderMonitorList(cachedMonitors);
            scheduleNextListPoll(cachedMonitors.active_count > 0);
        }
    }
    })();

    try {
        await monitorRefreshPromise;
    } finally {
        monitorRefreshPromise = null;
    }
}

function scheduleNextListPoll(hasActive: boolean): void {
    if (currentView !== 'list') return;
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    if (document.hidden) {
        refreshTimer = window.setTimeout(() => loadMonitors(), 30000);
        return;
    }

    const interval = hasActive ? 5000 : 30000;
    refreshTimer = window.setTimeout(() => loadMonitors(), interval);
}

function renderMonitorList(data: MonitorStatusResponse): void {
    const grid = document.getElementById('cameras-grid');
    const subtitle = document.getElementById('cameras-subtitle');
    const stopAllBtn = document.getElementById('cameras-stop-all-btn');

    if (subtitle) {
        subtitle.textContent = `${data.active_count} active / ${data.total_count} total`;
    }

    if (stopAllBtn) {
        stopAllBtn.style.display = data.active_count > 0 ? '' : 'none';
    }

    if (!grid) return;

    if (data.monitors.length === 0) {
        grid.innerHTML = `
            <div class="cameras-empty">
                <p class="cameras-empty__text">No cameras are being monitored.</p>
                <p class="cameras-empty__hint">Go to <a href="#/dashboard/monitor">Live Monitor</a> to start monitoring cameras.</p>
            </div>
        `;
        return;
    }

    const sorted = [...data.monitors].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
        const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
        return bTime - aTime;
    });

    grid.innerHTML = sorted.map(m => renderCameraCard(m)).join('');

    // Bind stop buttons
    grid.querySelectorAll('[data-stop-camera]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cameraId = (e.currentTarget as HTMLElement).dataset.stopCamera!;
            stopCamera(cameraId);
        });
    });

    // Bind pause buttons
    grid.querySelectorAll('[data-pause-camera]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cameraId = (e.currentTarget as HTMLElement).dataset.pauseCamera!;
            pauseCamera(cameraId);
        });
    });

    // Bind resume buttons
    grid.querySelectorAll('[data-resume-camera]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cameraId = (e.currentTarget as HTMLElement).dataset.resumeCamera!;
            resumeCamera(cameraId);
        });
    });

    // Bind View buttons -> open detail view
    grid.querySelectorAll('[data-view-camera]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const cameraId = (e.currentTarget as HTMLElement).dataset.viewCamera!;
            const monitor = data.monitors.find(m => m.camera_id === cameraId);
            if (monitor && mainContainer) {
                openDetail(mainContainer, cameraId, monitor);
            }
        });
    });
}

function renderCameraCard(m: MonitorStatus): string {
    const duration = formatDuration(m);
    const statusClass = m.active ? 'cameras-card--active' : 'cameras-card--stopped';
    let statusLabel = m.active ? 'Active' : 'Stopped';
    let statusBadge = m.active ? 'badge--success' : 'badge--muted';
    if (m.active && m.paused) {
        statusLabel = 'Paused';
        statusBadge = 'badge--warning';
    }
    const modeLabel = m.stream_mode ? 'Stream' : 'Snapshot';
    const intervalLabel = m.stream_mode ? `${m.stream_interval}s` : `${m.poll_interval}s`;

    return `
        <div class="cameras-card ${statusClass}">
            <div class="cameras-card__header">
                <div class="cameras-card__title">
                    <span class="cameras-card__name">${m.camera_name || 'Unknown Camera'}</span>
                    <span class="badge ${statusBadge}">${statusLabel}</span>
                    ${m.stream_mode ? '<span class="badge badge--info stream-mode-badge">Stream</span>' : ''}
                </div>
                <div class="cameras-card__location">${m.camera_location || '--'}</div>
            </div>

            <div class="cameras-card__stats">
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value">${m.frames_analyzed}</span>
                    <span class="cameras-card__stat-label">Frames</span>
                </div>
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value">${m.detections_found}</span>
                    <span class="cameras-card__stat-label">Detections</span>
                </div>
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value cameras-card__stat-value--danger">${m.accidents_found}</span>
                    <span class="cameras-card__stat-label">Accidents</span>
                </div>
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value">${duration}</span>
                    <span class="cameras-card__stat-label">Duration</span>
                </div>
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value">${m.skipped_unchanged}</span>
                    <span class="cameras-card__stat-label">Skipped</span>
                </div>
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value">${modeLabel}</span>
                    <span class="cameras-card__stat-label">Mode</span>
                </div>
                <div class="cameras-card__stat">
                    <span class="cameras-card__stat-value">${intervalLabel}</span>
                    <span class="cameras-card__stat-label">Interval</span>
                </div>
            </div>

            ${m.error ? `
                <div class="cameras-card__error">
                    <span class="cameras-card__error-label">Error:</span> ${m.error}
                </div>
            ` : ''}

            ${m.recent_detections.length > 0 ? `
                <div class="cameras-card__detections">
                    <div class="cameras-card__detections-title">Recent Detections (${m.recent_detections.length})</div>
                    ${m.recent_detections.slice(-3).reverse().map(d => `
                        <div class="cameras-card__detection-row">
                            <span class="cameras-card__detection-label">${capitalize(d.label)}</span>
                            <span class="badge badge--${severityColor(d.severity)}">${d.severity}</span>
                            <span class="cameras-card__detection-conf">${(d.confidence * 100).toFixed(0)}%</span>
                            <span class="cameras-card__detection-time">${formatTime(d.timestamp)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="cameras-card__actions">
                <button class="btn btn--sm btn--outline" data-view-camera="${m.camera_id}">View</button>
                ${m.active ? `
                    ${m.paused ? `
                        <button class="btn btn--sm btn--success" data-resume-camera="${m.camera_id}">Resume</button>
                    ` : `
                        <button class="btn btn--sm btn--warning" data-pause-camera="${m.camera_id}">Pause</button>
                    `}
                    <button class="btn btn--sm btn--danger" data-stop-camera="${m.camera_id}">Stop</button>
                ` : ''}
            </div>
        </div>
    `;
}

// ══════════════════════════════════════════════
//  DETAIL VIEW
// ══════════════════════════════════════════════

async function openDetail(
    container: HTMLElement,
    cameraId: string,
    monitor: MonitorStatus,
): Promise<void> {
    cleanupTimers();
    destroyDetailMap();
    currentView = 'detail';

    let statusLabel = monitor.active ? 'Active' : 'Stopped';
    let statusBadge = monitor.active ? 'badge--success' : 'badge--muted';
    if (monitor.active && monitor.paused) {
        statusLabel = 'Paused';
        statusBadge = 'badge--warning';
    }

    container.innerHTML = `
        <div class="camdetail">
            <div class="camdetail__topbar">
                <button class="btn btn--sm btn--outline" id="camdetail-back-btn">&larr; Back to Cameras</button>
                <div class="camdetail__topbar-right">
                    <span class="badge ${statusBadge}" id="camdetail-status-badge">${statusLabel}</span>
                    <button class="btn btn--sm btn--warning" id="camdetail-pause-btn" style="display:${monitor.active && !monitor.paused ? '' : 'none'}">Pause</button>
                    <button class="btn btn--sm btn--success" id="camdetail-resume-btn" style="display:${monitor.active && monitor.paused ? '' : 'none'}">Resume</button>
                    <button class="btn btn--sm btn--danger" id="camdetail-stop-btn" style="display:${monitor.active ? '' : 'none'}">Stop Monitoring</button>
                </div>
            </div>

            <div class="camdetail__grid">
                <!-- Left column: map + snapshot -->
                <div class="camdetail__left">
                    <!-- Map -->
                    <div class="card">
                        <div class="card__header">
                            <h3 class="card__title">Camera Location</h3>
                        </div>
                        <div class="card__body camdetail__map-wrap">
                            <div id="camdetail-map" class="camdetail__map"></div>
                        </div>
                    </div>

                    <!-- Live snapshot -->
                    <div class="card">
                        <div class="card__header">
                            <h3 class="card__title">Live Feed</h3>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div class="feed-mode-toggle" id="camdetail-feed-toggle" style="display:none;">
                                    <button class="feed-mode-toggle__btn feed-mode-toggle__btn--active" data-mode="snapshot">Snapshot</button>
                                    <button class="feed-mode-toggle__btn" data-mode="video">Video</button>
                                </div>
                                <div class="feed-video__live-badge">
                                    <span class="feed-video__live-dot"></span>
                                    LIVE
                                </div>
                            </div>
                        </div>
                        <div class="card__body">
                            <div class="camdetail__snapshot-wrap" id="camdetail-feed-container">
                                <img id="camdetail-snapshot" class="camdetail__snapshot" alt="Camera snapshot" />
                                <div class="camdetail__snapshot-overlay" id="camdetail-overlay">
                                    <span>Loading snapshot...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Right column: details + stats + detections -->
                <div class="camdetail__right">
                    <!-- Camera details -->
                    <div class="card">
                        <div class="card__header">
                            <h3 class="card__title">Camera Details</h3>
                        </div>
                        <div class="card__body" id="camdetail-info">
                            <p class="text-muted">Loading camera info...</p>
                        </div>
                    </div>

                    <!-- Monitor stats -->
                    <div class="card">
                        <div class="card__header">
                            <h3 class="card__title">Monitor Stats</h3>
                        </div>
                        <div class="card__body">
                            <div class="camdetail__stats" id="camdetail-stats"></div>
                        </div>
                    </div>

                    <!-- Recent detections -->
                    <div class="card">
                        <div class="card__header">
                            <h3 class="card__title">Recent Detections</h3>
                            <span class="badge" id="camdetail-det-count">${monitor.detections_found}</span>
                        </div>
                        <div class="card__body">
                            <div id="camdetail-detections" class="camdetail__detections"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Bind back button
    document.getElementById('camdetail-back-btn')?.addEventListener('click', () => {
        destroyDetailVideoPlayer();
        detailFeedMode = 'snapshot';
        if (mainContainer) renderList(mainContainer);
    });

    // Bind stop button
    document.getElementById('camdetail-stop-btn')?.addEventListener('click', async () => {
        await stopCamera(cameraId);
        // Refresh detail status (force)
        refreshDetailStatus(cameraId, true);
    });

    document.getElementById('camdetail-pause-btn')?.addEventListener('click', async () => {
        await pauseCamera(cameraId);
        refreshDetailStatus(cameraId, true);
    });

    document.getElementById('camdetail-resume-btn')?.addEventListener('click', async () => {
        await resumeCamera(cameraId);
        refreshDetailStatus(cameraId, true);
    });

    // Bind feed mode toggle
    detailCameraId = cameraId;
    detailFeedMode = 'snapshot';
    document.getElementById('camdetail-feed-toggle')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
        if (!btn) return;
        const mode = btn.dataset.mode as 'snapshot' | 'video';
        if (mode === detailFeedMode) return;
        switchDetailFeedMode(mode, cameraId);
    });

    // Render initial stats & detections
    renderDetailStats(monitor);
    renderDetailDetections(monitor);

    // Fetch camera info (for map + full details) and load snapshot in parallel
    fetchCameraInfoAndInitMap(cameraId);
    loadDetailSnapshot(cameraId);

    // Variable-rate polling for status (active=5s, inactive/paused=30s)
    scheduleNextDetailPoll(cameraId, monitor.active, monitor.paused);

    // Auto-refresh snapshot every 30s
    detailSnapshotTimer = window.setInterval(() => {
        if (document.hidden) return;
        void loadDetailSnapshot(cameraId);
    }, 30000);
}

async function fetchCameraInfoAndInitMap(cameraId: string): Promise<void> {
    try {
        const data = await api.get<{ camera: CameraInfo }>(
            `/cameras/${cameraId}/info`,
            undefined,
            { ttlMs: 5 * 60 * 1000 } // 5 minutes cache
        );
        const cam = data.camera;

        // Render camera info
        const isIowa = cameraId.startsWith('ia_');
        const infoEl = document.getElementById('camdetail-info');
        if (infoEl) {
            const locationRow = isIowa
                ? `<div class="camdetail__info-row">
                    <span class="camdetail__info-label">Source</span>
                    <span class="camdetail__info-value">Iowa DOT${cam.region ? ` — ${cam.region}` : ''}</span>
                   </div>`
                : `<div class="camdetail__info-row">
                    <span class="camdetail__info-label">District</span>
                    <span class="camdetail__info-value">D${cam.district} — ${cam.district_name}</span>
                   </div>`;
            infoEl.innerHTML = `
                <div class="camdetail__info-grid">
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Name</span>
                        <span class="camdetail__info-value">${cam.location_name}</span>
                    </div>
                    ${locationRow}
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">County</span>
                        <span class="camdetail__info-value">${cam.county}</span>
                    </div>
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Route</span>
                        <span class="camdetail__info-value">${cam.route}</span>
                    </div>
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Direction</span>
                        <span class="camdetail__info-value">${cam.direction || 'N/A'}</span>
                    </div>
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Coordinates</span>
                        <span class="camdetail__info-value">${cam.latitude.toFixed(4)}, ${cam.longitude.toFixed(4)}</span>
                    </div>
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Update Freq</span>
                        <span class="camdetail__info-value">Every ${cam.update_frequency} min</span>
                    </div>
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Status</span>
                        <span class="camdetail__info-value">${cam.in_service ? 'In Service' : 'Out of Service'}</span>
                    </div>
                </div>
            `;
        }

        // Init Leaflet map
        initDetailMap(cam.latitude, cam.longitude, cam.location_name);

        // Show feed mode toggle only if camera has a video stream
        // Load proxied stream URL from backend so both Caltrans and Iowa go through the proxy
        detailCameraStreamUrl = null;
        if (cam.stream_url) {
            const streamInfo = await api.getStreamInfo(cameraId).catch(() => null);
            detailCameraStreamUrl = streamInfo?.proxy_url ?? cam.stream_url;
        }
        const feedToggle = document.getElementById('camdetail-feed-toggle');
        if (feedToggle) feedToggle.style.display = cam.stream_url ? '' : 'none';
    } catch (err) {
        console.error('Failed to fetch camera info:', err);
        detailCameraStreamUrl = null;
        const infoEl = document.getElementById('camdetail-info');
        if (infoEl) infoEl.innerHTML = '<p class="text-muted">Camera details unavailable.</p>';
    }
}

function initDetailMap(lat: number, lng: number, name: string): void {
    const mapEl = document.getElementById('camdetail-map');
    if (!mapEl || typeof L === 'undefined') return;

    detailMap = L.map('camdetail-map', { zoomControl: true, scrollWheelZoom: true })
        .setView([lat, lng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(detailMap);

    const redIcon = L.divIcon({
        className: 'monitor-marker',
        html: '<div class="monitor-marker__dot monitor-marker__dot--red"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
    });

    L.marker([lat, lng], { icon: redIcon })
        .addTo(detailMap)
        .bindPopup(`<strong>${name}</strong>`)
        .openPopup();

    setTimeout(() => detailMap?.invalidateSize(), 200);
}

async function loadDetailSnapshot(cameraId: string): Promise<void> {
    if (snapshotLoading) return;
    snapshotLoading = true;

    const img = document.getElementById('camdetail-snapshot') as HTMLImageElement;
    const overlay = document.getElementById('camdetail-overlay');
    if (!img) { snapshotLoading = false; return; }

    try {
        const res = await fetch(api.getSnapshotProxyUrl(cameraId), {
            headers: await api.getAuthHeaders(),
        });
        if (!res.ok) throw new Error('Failed to fetch snapshot');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
        img.src = url;

        if (overlay) overlay.style.display = 'none';
    } catch (err) {
        console.error('Detail snapshot load failed:', err);
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.querySelector('span')!.textContent = 'Feed unavailable';
        }
    } finally {
        snapshotLoading = false;
    }
}

async function refreshDetailStatus(cameraId: string, force: boolean = false): Promise<void> {
    if (currentView !== 'detail') return;
    if (document.hidden && !force) {
        scheduleNextDetailPoll(cameraId, false, true);
        return;
    }
    try {
        const data = await api.get<{ status: MonitorStatus }>(`/cameras/monitor/${cameraId}/status`);
        const status = data.status;

        renderDetailStats(status);
        renderDetailDetections(status);

        // Update badge
        const badge = document.getElementById('camdetail-status-badge');
        if (badge) {
            let label = status.active ? 'Active' : 'Stopped';
            let bclass = status.active ? 'badge--success' : 'badge--muted';
            if (status.active && status.paused) {
                label = 'Paused';
                bclass = 'badge--warning';
            }
            badge.textContent = label;
            badge.className = `badge ${bclass}`;
        }

        // Update detection count
        const countBadge = document.getElementById('camdetail-det-count');
        if (countBadge) countBadge.textContent = String(status.detections_found);

        // Show/hide action buttons
        const stopBtn = document.getElementById('camdetail-stop-btn');
        const pauseBtn = document.getElementById('camdetail-pause-btn');
        const resumeBtn = document.getElementById('camdetail-resume-btn');

        if (stopBtn) stopBtn.style.display = status.active ? '' : 'none';
        if (pauseBtn) pauseBtn.style.display = status.active && !status.paused ? '' : 'none';
        if (resumeBtn) resumeBtn.style.display = status.active && status.paused ? '' : 'none';

        // Schedule next poll based on current status
        scheduleNextDetailPoll(cameraId, status.active, status.paused);
    } catch (err) {
        console.error('Detail status refresh failed:', err);
    }
}

function scheduleNextDetailPoll(cameraId: string, isActive: boolean, isPaused: boolean): void {
    if (currentView !== 'detail') return;

    if (detailRefreshTimer) {
        clearTimeout(detailRefreshTimer);
        detailRefreshTimer = null;
    }

    const interval = (isActive && !isPaused) ? 5000 : 30000;
    detailRefreshTimer = window.setTimeout(() => {
        refreshDetailStatus(cameraId);
    }, interval);
}

function renderDetailStats(m: MonitorStatus): void {
    const el = document.getElementById('camdetail-stats');
    if (!el) return;

    const duration = formatDuration(m);

    el.innerHTML = `
        <div class="camdetail__stat">
            <span class="camdetail__stat-value">${m.frames_analyzed}</span>
            <span class="camdetail__stat-label">Frames Analyzed</span>
        </div>
        <div class="camdetail__stat">
            <span class="camdetail__stat-value">${m.detections_found}</span>
            <span class="camdetail__stat-label">Detections</span>
        </div>
        <div class="camdetail__stat">
            <span class="camdetail__stat-value camdetail__stat-value--danger">${m.accidents_found}</span>
            <span class="camdetail__stat-label">Accidents</span>
        </div>
        <div class="camdetail__stat">
            <span class="camdetail__stat-value">${duration}</span>
            <span class="camdetail__stat-label">Duration</span>
        </div>
        <div class="camdetail__stat">
            <span class="camdetail__stat-value">${m.skipped_unchanged}</span>
            <span class="camdetail__stat-label">Skipped (Unchanged)</span>
        </div>
        <div class="camdetail__stat">
            <span class="camdetail__stat-value">${m.stream_mode ? 'Stream' : 'Snapshot'}</span>
            <span class="camdetail__stat-label">Source Mode</span>
        </div>
        ${m.stream_mode ? `
            <div class="camdetail__stat">
                <span class="camdetail__stat-value">${m.stream_interval}s</span>
                <span class="camdetail__stat-label">Stream Interval</span>
            </div>
        ` : `
            <div class="camdetail__stat">
                <span class="camdetail__stat-value">${m.poll_interval}s</span>
                <span class="camdetail__stat-label">Poll Interval</span>
            </div>
        `}
        ${m.error ? `
            <div class="camdetail__stat camdetail__stat--full">
                <span class="camdetail__stat-value camdetail__stat-value--danger" style="font-size:var(--text-xs);">${m.error}</span>
                <span class="camdetail__stat-label">Last Error</span>
            </div>
        ` : ''}
    `;
}

function renderDetailDetections(m: MonitorStatus): void {
    const el = document.getElementById('camdetail-detections');
    if (!el) return;

    const dets = m.recent_detections;
    if (dets.length === 0) {
        el.innerHTML = '<p class="text-muted">No detections yet.</p>';
        return;
    }

    el.innerHTML = dets.slice().reverse().map(d => `
        <div class="camdetail__det-item">
            <div class="camdetail__det-icon camdetail__det-icon--danger">
                !
            </div>
            <div class="camdetail__det-content">
                <div class="camdetail__det-label">
                    ${capitalize(d.label)}
                    <span class="badge badge--${severityColor(d.severity)}">${d.severity}</span>
                </div>
                <div class="camdetail__det-meta">
                    ${(d.confidence * 100).toFixed(0)}% confidence &bull; ${formatTime(d.timestamp)}
                </div>
            </div>
            ${d.evidence_path ? `
                <img class="camdetail__det-thumb" src="${resolveEvidenceSrc(d.evidence_path)}" alt="evidence" />
            ` : ''}
        </div>
    `).join('');
}

// ══════════════════════════════════════════════
//  DETAIL VIDEO PLAYER
// ══════════════════════════════════════════════

/** Switch between snapshot and video in the detail view. */
function switchDetailFeedMode(mode: 'snapshot' | 'video', cameraId: string): void {
    detailFeedMode = mode;
    updateDetailFeedToggleUI();

    const container = document.getElementById('camdetail-feed-container');
    if (!container) return;

    if (mode === 'video') {
        // Hide snapshot elements
        const img = document.getElementById('camdetail-snapshot') as HTMLImageElement;
        const overlay = document.getElementById('camdetail-overlay');
        if (img) img.style.display = 'none';
        if (overlay) overlay.style.display = 'none';

        // Stop snapshot auto-refresh
        if (detailSnapshotTimer) {
            clearInterval(detailSnapshotTimer);
            detailSnapshotTimer = null;
        }

        // Start video player
        startDetailVideoPlayer(cameraId, container);
    } else {
        // Destroy video player
        destroyDetailVideoPlayer();

        // Show snapshot elements
        const img = document.getElementById('camdetail-snapshot') as HTMLImageElement;
        if (img) img.style.display = '';

        // Reload snapshot and restart auto-refresh
        loadDetailSnapshot(cameraId);
        detailSnapshotTimer = window.setInterval(() => {
            loadDetailSnapshot(cameraId);
        }, 30000);
    }
}

/** Start the HLS video player in the detail view. */
async function startDetailVideoPlayer(cameraId: string, container: HTMLElement): Promise<void> {
    // Remove any existing messages
    container.querySelector('.video-player-message')?.remove();
    container.querySelector('.video-player-loading')?.remove();

    // Show loading
    const loading = document.createElement('div');
    loading.className = 'video-player-loading';
    loading.innerHTML = '<span>Connecting to stream...</span>';
    container.appendChild(loading);

    // Use direct stream URL loaded from camera info
    if (!detailCameraStreamUrl) {
        loading.remove();
        const msg = document.createElement('div');
        msg.className = 'video-player-message';
        msg.textContent = 'Video stream is not available for this camera.';
        container.appendChild(msg);
        return;
    }

    loading.remove();

    detailVideoPlayer = new VideoPlayer({
        container: container,
        hlsUrl: detailCameraStreamUrl,
        className: 'hls-video-player camdetail__snapshot',
        onError: (message) => {
            const msg = document.createElement('div');
            msg.className = 'video-player-message';
            msg.textContent = message;
            container.appendChild(msg);
        },
    });
}

/** Destroy the detail view video player. */
function destroyDetailVideoPlayer(): void {
    if (detailVideoPlayer) {
        detailVideoPlayer.destroy();
        detailVideoPlayer = null;
    }
    const container = document.getElementById('camdetail-feed-container');
    if (container) {
        container.querySelector('.video-player-message')?.remove();
        container.querySelector('.video-player-loading')?.remove();
    }
}

/** Update the toggle UI in detail view. */
function updateDetailFeedToggleUI(): void {
    const toggle = document.getElementById('camdetail-feed-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('[data-mode]').forEach(btn => {
        const el = btn as HTMLElement;
        if (el.dataset.mode === detailFeedMode) {
            el.classList.add('feed-mode-toggle__btn--active');
        } else {
            el.classList.remove('feed-mode-toggle__btn--active');
        }
    });
}


// ══════════════════════════════════════════════
//  SHARED ACTIONS
// ══════════════════════════════════════════════

async function stopCamera(cameraId: string): Promise<void> {
    try {
        await api.post(`/cameras/monitor/${cameraId}/stop`);
        Toast.show('Camera monitoring stopped', 'info');
        if (currentView === 'list') loadMonitors(true);
    } catch (err: any) {
        Toast.show(err.message || 'Failed to stop', 'error');
    }
}

async function pauseCamera(cameraId: string): Promise<void> {
    try {
        await api.post(`/cameras/monitor/${cameraId}/pause`);
        Toast.show('Camera monitoring paused', 'info');
        if (currentView === 'list') loadMonitors(true);
    } catch (err: any) {
        Toast.show(err.message || 'Failed to pause', 'error');
    }
}

async function resumeCamera(cameraId: string): Promise<void> {
    try {
        await api.post(`/cameras/monitor/${cameraId}/resume`);
        Toast.show('Camera monitoring resumed', 'success');
        if (currentView === 'list') loadMonitors(true);
    } catch (err: any) {
        Toast.show(err.message || 'Failed to resume', 'error');
    }
}

async function stopAllMonitors(): Promise<void> {
    try {
        const data = await api.post<{ stopped: number }>('/cameras/monitor/stop');
        Toast.show(`Stopped ${data.stopped} monitor(s)`, 'info');
        loadMonitors(true);
    } catch (err: any) {
        Toast.show(err.message || 'Failed to stop all', 'error');
    }
}

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function severityColor(severity: string): string {
    switch (severity) {
        case 'high': return 'danger';
        case 'medium': return 'warning';
        case 'low': return 'info';
        default: return 'muted';
    }
}

function formatTime(iso: string): string {
    try {
        return new Date(iso).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return iso;
    }
}

function getTimeSince(isoDate: string): string {
    const start = new Date(isoDate).getTime();
    const now = Date.now();
    const diff = Math.floor((now - start) / 1000);

    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m`;
}

function formatDuration(status: MonitorStatus): string {
    if (!status.started_at) return '--';

    const start = new Date(status.started_at).getTime();
    const end = !status.active
        ? new Date(status.stopped_at ?? status.last_frame_time ?? status.started_at).getTime()
        : Date.now();
    const safeEnd = Number.isFinite(end) ? end : Date.now();
    const diff = Math.max(0, Math.floor((safeEnd - start) / 1000));

    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return `${h}h ${m}m`;
}

function resolveEvidenceSrc(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `/evidence/${path}`;
}
