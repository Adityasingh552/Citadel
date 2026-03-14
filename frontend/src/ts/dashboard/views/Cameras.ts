/** Citadel — Cameras dashboard view: list + detail with map, snapshot, and stats. */

import { api } from '../../api.js';
import { Toast } from '../../utils/toast.js';
import type { CameraInfo, MonitorStatus, MonitorStatusResponse } from '../../types/index.js';

declare const L: any; // Leaflet global from CDN

// State
let refreshTimer: number | null = null;
let detailRefreshTimer: number | null = null;
let detailSnapshotTimer: number | null = null;
let detailMap: any = null;
let currentView: 'list' | 'detail' = 'list';
let cachedMonitors: MonitorStatusResponse | null = null;
let snapshotLoading = false;
let mainContainer: HTMLElement | null = null;

export function renderCameras(container: HTMLElement): void {
    mainContainer = container;
    currentView = 'list';
    renderList(container);
}

export function destroyCameras(): void {
    cleanupTimers();
    destroyDetailMap();
    mainContainer = null;
    cachedMonitors = null;
    currentView = 'list';
}

function cleanupTimers(): void {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (detailRefreshTimer) { clearInterval(detailRefreshTimer); detailRefreshTimer = null; }
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

    document.getElementById('cameras-refresh-btn')?.addEventListener('click', loadMonitors);
    document.getElementById('cameras-stop-all-btn')?.addEventListener('click', stopAllMonitors);

    loadMonitors();
    refreshTimer = window.setInterval(loadMonitors, 5000);
}

async function loadMonitors(): Promise<void> {
    // Don't refresh the list if we're in detail view
    if (currentView !== 'list') return;
    try {
        const data = await api.get<MonitorStatusResponse>('/cameras/monitor/status');
        cachedMonitors = data;
        renderMonitorList(data);
    } catch (err) {
        console.error('Failed to load monitors:', err);
    }
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
    const duration = m.started_at ? getTimeSince(m.started_at) : '--';
    const statusClass = m.active ? 'cameras-card--active' : 'cameras-card--stopped';
    const statusLabel = m.active ? 'Active' : 'Stopped';
    const statusBadge = m.active ? 'badge--success' : 'badge--muted';

    return `
        <div class="cameras-card ${statusClass}">
            <div class="cameras-card__header">
                <div class="cameras-card__title">
                    <span class="cameras-card__name">${m.camera_name || 'Unknown Camera'}</span>
                    <span class="badge ${statusBadge}">${statusLabel}</span>
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
                    <span class="cameras-card__stat-value">${m.poll_interval}s</span>
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

    const statusLabel = monitor.active ? 'Active' : 'Stopped';
    const statusBadge = monitor.active ? 'badge--success' : 'badge--muted';

    container.innerHTML = `
        <div class="camdetail">
            <div class="camdetail__topbar">
                <button class="btn btn--sm btn--outline" id="camdetail-back-btn">&larr; Back to Cameras</button>
                <div class="camdetail__topbar-right">
                    <span class="badge ${statusBadge}" id="camdetail-status-badge">${statusLabel}</span>
                    ${monitor.active ? `
                        <button class="btn btn--sm btn--danger" id="camdetail-stop-btn">Stop Monitoring</button>
                    ` : ''}
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
                            <h3 class="card__title">Live Snapshot</h3>
                            <div class="feed-video__live-badge">
                                <span class="feed-video__live-dot"></span>
                                LIVE
                            </div>
                        </div>
                        <div class="card__body">
                            <div class="camdetail__snapshot-wrap">
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
        if (mainContainer) renderList(mainContainer);
    });

    // Bind stop button
    document.getElementById('camdetail-stop-btn')?.addEventListener('click', async () => {
        await stopCamera(cameraId);
        // Refresh detail status
        refreshDetailStatus(cameraId);
    });

    // Render initial stats & detections
    renderDetailStats(monitor);
    renderDetailDetections(monitor);

    // Fetch camera info (for map + full details) and load snapshot in parallel
    fetchCameraInfoAndInitMap(cameraId);
    loadDetailSnapshot(cameraId);

    // Auto-refresh status every 5s
    detailRefreshTimer = window.setInterval(() => {
        refreshDetailStatus(cameraId);
    }, 5000);

    // Auto-refresh snapshot every 30s
    detailSnapshotTimer = window.setInterval(() => {
        loadDetailSnapshot(cameraId);
    }, 30000);
}

async function fetchCameraInfoAndInitMap(cameraId: string): Promise<void> {
    try {
        const data = await api.get<{ camera: CameraInfo }>(`/cameras/${cameraId}/info`);
        const cam = data.camera;

        // Render camera info
        const infoEl = document.getElementById('camdetail-info');
        if (infoEl) {
            infoEl.innerHTML = `
                <div class="camdetail__info-grid">
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">Name</span>
                        <span class="camdetail__info-value">${cam.location_name}</span>
                    </div>
                    <div class="camdetail__info-row">
                        <span class="camdetail__info-label">District</span>
                        <span class="camdetail__info-value">D${cam.district} -- ${cam.district_name}</span>
                    </div>
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
    } catch (err) {
        console.error('Failed to fetch camera info:', err);
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
            headers: api.getAuthHeaders(),
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

async function refreshDetailStatus(cameraId: string): Promise<void> {
    if (currentView !== 'detail') return;
    try {
        const data = await api.get<{ status: MonitorStatus }>(`/cameras/monitor/${cameraId}/status`);
        const status = data.status;

        renderDetailStats(status);
        renderDetailDetections(status);

        // Update badge
        const badge = document.getElementById('camdetail-status-badge');
        if (badge) {
            badge.textContent = status.active ? 'Active' : 'Stopped';
            badge.className = `badge ${status.active ? 'badge--success' : 'badge--muted'}`;
        }

        // Update detection count
        const countBadge = document.getElementById('camdetail-det-count');
        if (countBadge) countBadge.textContent = String(status.detections_found);

        // Show/hide stop button
        const stopBtn = document.getElementById('camdetail-stop-btn');
        if (stopBtn) {
            stopBtn.style.display = status.active ? '' : 'none';
        }
    } catch (err) {
        console.error('Detail status refresh failed:', err);
    }
}

function renderDetailStats(m: MonitorStatus): void {
    const el = document.getElementById('camdetail-stats');
    if (!el) return;

    const duration = m.started_at ? getTimeSince(m.started_at) : '--';

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
            <span class="camdetail__stat-value">${m.poll_interval}s</span>
            <span class="camdetail__stat-label">Poll Interval</span>
        </div>
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
            <div class="camdetail__det-icon camdetail__det-icon--${d.label === 'accident' ? 'danger' : 'info'}">
                ${d.label === 'accident' ? '!' : 'V'}
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
                <img class="camdetail__det-thumb" src="/evidence/${d.evidence_path}" alt="evidence" />
            ` : ''}
        </div>
    `).join('');
}

// ══════════════════════════════════════════════
//  SHARED ACTIONS
// ══════════════════════════════════════════════

async function stopCamera(cameraId: string): Promise<void> {
    try {
        const token = api.getToken();
        const res = await fetch(`/api/cameras/monitor/${cameraId}/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to stop monitoring');
        Toast.show('Camera monitoring stopped', 'info');
        if (currentView === 'list') loadMonitors();
    } catch (err: any) {
        Toast.show(err.message || 'Failed to stop', 'error');
    }
}

async function stopAllMonitors(): Promise<void> {
    try {
        const token = api.getToken();
        const res = await fetch('/api/cameras/monitor/stop', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to stop all monitors');
        const data = await res.json();
        Toast.show(`Stopped ${data.stopped} monitor(s)`, 'info');
        loadMonitors();
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
