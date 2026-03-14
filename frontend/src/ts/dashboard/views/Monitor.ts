/** Citadel — Live Monitor view with interactive Leaflet map and auto-monitoring. */

import { api } from '../../api.js';
import { Toast } from '../../utils/toast.js';
import type { CameraInfo, MonitorStatus } from '../../types/index.js';

declare const L: any; // Leaflet global from CDN

// State
let map: any = null;
let cameras: CameraInfo[] = [];
let selectedCamera: CameraInfo | null = null;
let monitorStatus: MonitorStatus | null = null;
let statusPollTimer: number | null = null;
let snapshotRefreshTimer: number | null = null;
let markers: any[] = [];
let snapshotLoading = false;

const DEFAULT_CENTER: [number, number] = [34.05, -118.25]; // Los Angeles
const DEFAULT_ZOOM = 9;

export function renderMonitor(container: HTMLElement): void {
    container.innerHTML = `
        <div class="monitor-layout">
            <!-- Left: Map + Camera selector -->
            <div class="monitor-map-panel">
                <div class="monitor-map-toolbar">
                    <div class="monitor-toolbar-left">
                        <select id="district-select" class="monitor-select">
                            <option value="">All Major Districts</option>
                            <option value="4">D4 — SF Bay Area</option>
                            <option value="7">D7 — Los Angeles</option>
                            <option value="8">D8 — San Bernardino</option>
                            <option value="11">D11 — San Diego</option>
                            <option value="12">D12 — Orange County</option>
                            <option value="3">D3 — Sacramento</option>
                            <option value="5">D5 — Central Coast</option>
                            <option value="6">D6 — Fresno</option>
                            <option value="10">D10 — Stockton</option>
                        </select>
                        <input type="text" id="camera-search" class="monitor-search"
                               placeholder="Search cameras..." />
                    </div>
                    <div class="monitor-toolbar-right">
                        <span class="monitor-cam-count" id="cam-count">0 cameras</span>
                        <button class="btn btn--sm btn--outline" id="refresh-cameras-btn">Refresh</button>
                    </div>
                </div>
                <div id="monitor-map" class="monitor-map"></div>
            </div>

            <!-- Right: Camera feed + monitoring controls -->
            <div class="monitor-control-panel">
                <!-- Camera info -->
                <div class="card" id="camera-info-card">
                    <div class="card__header">
                        <h3 class="card__title">Selected Camera</h3>
                    </div>
                    <div class="card__body" id="camera-info-body">
                        <p class="text-muted">Click a camera pin on the map to select it.</p>
                    </div>
                </div>

                <!-- Live feed -->
                <div class="card" id="live-feed-card" style="display:none;">
                    <div class="card__header">
                        <h3 class="card__title">Live Feed</h3>
                        <div class="feed-video__live-badge">
                            <span class="feed-video__live-dot"></span>
                            LIVE
                        </div>
                    </div>
                    <div class="card__body">
                        <div class="monitor-feed-container">
                            <img id="camera-snapshot" class="monitor-snapshot" alt="Camera feed" />
                            <div class="monitor-feed-overlay" id="feed-overlay" style="display:none;">
                                <span class="monitor-feed-overlay__text">Loading...</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Monitor controls -->
                <div class="card" id="monitor-controls-card" style="display:none;">
                    <div class="card__header">
                        <h3 class="card__title">Auto-Monitor</h3>
                    </div>
                    <div class="card__body">
                        <div class="monitor-controls">
                            <div class="settings-row">
                                <div>
                                    <div class="settings-row__label">Poll Interval</div>
                                    <div class="settings-row__desc">Seconds between snapshots</div>
                                </div>
                                <div style="display:flex;align-items:center;gap:var(--space-2);">
                                    <input type="range" id="poll-interval" class="settings-slider"
                                           min="10" max="120" value="30" step="5" />
                                    <span id="poll-interval-val" class="settings-row__value">30s</span>
                                </div>
                            </div>
                            <div class="monitor-actions">
                                <button class="btn btn--primary" id="start-monitor-btn">Start Monitoring</button>
                                <button class="btn btn--danger" id="stop-monitor-btn" style="display:none;">Stop Monitoring</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Monitoring status -->
                <div class="card" id="monitor-status-card" style="display:none;">
                    <div class="card__header">
                        <h3 class="card__title">Monitoring Status</h3>
                        <span class="badge badge--success" id="status-badge">Active</span>
                    </div>
                    <div class="card__body">
                        <div class="monitor-stats-grid" id="monitor-stats">
                        </div>
                    </div>
                </div>

                <!-- Recent detections -->
                <div class="card" id="detections-card" style="display:none;">
                    <div class="card__header">
                        <h3 class="card__title">Recent Detections</h3>
                        <span class="badge" id="detection-count">0</span>
                    </div>
                    <div class="card__body">
                        <div id="detection-list" class="monitor-detection-list">
                            <p class="text-muted">No detections yet.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    initMap();
    bindEvents();
    loadCameras();
    checkExistingMonitor();
}

function initMap(): void {
    const mapEl = document.getElementById('monitor-map');
    if (!mapEl || typeof L === 'undefined') {
        console.error('Leaflet not loaded or map element missing');
        return;
    }

    map = L.map('monitor-map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(map);

    // Fix Leaflet rendering in dynamically created containers
    setTimeout(() => map.invalidateSize(), 200);
}

function bindEvents(): void {
    document.getElementById('district-select')?.addEventListener('change', (e) => {
        loadCameras((e.target as HTMLSelectElement).value || undefined);
    });

    document.getElementById('camera-search')?.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value;
        filterCamerasOnMap(query);
    });

    document.getElementById('refresh-cameras-btn')?.addEventListener('click', () => {
        const district = (document.getElementById('district-select') as HTMLSelectElement)?.value;
        loadCameras(district || undefined);
    });

    document.getElementById('poll-interval')?.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value;
        const label = document.getElementById('poll-interval-val');
        if (label) label.textContent = `${val}s`;
    });

    document.getElementById('start-monitor-btn')?.addEventListener('click', startMonitoring);
    document.getElementById('stop-monitor-btn')?.addEventListener('click', stopMonitoring);
}

async function loadCameras(district?: string): Promise<void> {
    try {
        const params: Record<string, string> = { limit: '300' };
        if (district) params.district = district;

        const data = await api.get<{ cameras: CameraInfo[]; total: number }>('/cameras', params);
        cameras = data.cameras;

        const countEl = document.getElementById('cam-count');
        if (countEl) countEl.textContent = `${data.total} cameras`;

        plotCamerasOnMap(cameras);
    } catch (err) {
        Toast.show('Failed to load cameras', 'error');
        console.error(err);
    }
}

function plotCamerasOnMap(cams: CameraInfo[]): void {
    if (!map) return;

    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const greenIcon = L.divIcon({
        className: 'monitor-marker',
        html: '<div class="monitor-marker__dot monitor-marker__dot--green"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
    });

    const blueIcon = L.divIcon({
        className: 'monitor-marker',
        html: '<div class="monitor-marker__dot monitor-marker__dot--blue"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
    });

    cams.forEach(cam => {
        const isSelected = selectedCamera?.id === cam.id;
        const icon = isSelected ? blueIcon : greenIcon;

        const marker = L.marker([cam.latitude, cam.longitude], { icon })
            .addTo(map)
            .bindPopup(`
                <strong>${cam.location_name}</strong><br/>
                ${cam.county} &bull; ${cam.route}<br/>
                <em>District ${cam.district} — ${cam.district_name}</em>
            `);

        marker.on('click', () => selectCamera(cam));
        markers.push(marker);
    });

    // Fit bounds if we have cameras
    if (cams.length > 0) {
        const bounds = L.latLngBounds(cams.map(c => [c.latitude, c.longitude]));
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

function filterCamerasOnMap(query: string): void {
    if (!query) {
        plotCamerasOnMap(cameras);
        return;
    }
    const q = query.toLowerCase();
    const filtered = cameras.filter(c =>
        c.location_name.toLowerCase().includes(q)
        || c.county.toLowerCase().includes(q)
        || c.route.toLowerCase().includes(q)
    );
    plotCamerasOnMap(filtered);
}

function selectCamera(cam: CameraInfo): void {
    selectedCamera = cam;

    // Update camera info card
    const infoBody = document.getElementById('camera-info-body');
    if (infoBody) {
        infoBody.innerHTML = `
            <div class="monitor-cam-info">
                <div class="monitor-cam-info__name">${cam.location_name}</div>
                <div class="monitor-cam-info__meta">
                    <span>${cam.county}</span>
                    <span>${cam.route}</span>
                    <span>${cam.direction || 'N/A'}</span>
                </div>
                <div class="monitor-cam-info__district">
                    District ${cam.district} — ${cam.district_name}
                </div>
                <div class="monitor-cam-info__coords">
                    ${cam.latitude.toFixed(4)}, ${cam.longitude.toFixed(4)}
                </div>
            </div>
        `;
    }

    // Show feed and controls
    show('live-feed-card');
    show('monitor-controls-card');

    // Load snapshot
    loadSnapshot(cam);

    // Start auto-refreshing the snapshot preview (every 15 seconds)
    if (snapshotRefreshTimer) clearInterval(snapshotRefreshTimer);
    snapshotRefreshTimer = window.setInterval(() => {
        if (selectedCamera && !monitorStatus?.active) {
            loadSnapshot(selectedCamera);
        }
    }, 15000);

    // Re-plot to highlight selected
    plotCamerasOnMap(cameras);

    // Pan map to camera
    if (map) map.setView([cam.latitude, cam.longitude], 13);
}

async function loadSnapshot(cam: CameraInfo): Promise<void> {
    if (snapshotLoading) return; // Prevent overlapping requests
    snapshotLoading = true;

    const img = document.getElementById('camera-snapshot') as HTMLImageElement;
    const overlay = document.getElementById('feed-overlay');
    if (!img) { snapshotLoading = false; return; }

    // Only show loading overlay if image has no src yet (first load)
    const isFirstLoad = !img.src || img.src === window.location.href;
    if (isFirstLoad && overlay) {
        overlay.style.display = 'flex';
        overlay.querySelector('.monitor-feed-overlay__text')!.textContent = 'Loading...';
    }

    try {
        // Fetch snapshot through our backend proxy (handles auth)
        const res = await fetch(api.getSnapshotProxyUrl(cam.id), {
            headers: api.getAuthHeaders(),
        });
        if (!res.ok) throw new Error('Failed to fetch snapshot');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        // Clean up previous blob URL
        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
        img.src = url;

        if (overlay) overlay.style.display = 'none';
    } catch (err) {
        console.error('Snapshot load failed:', err);
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.querySelector('.monitor-feed-overlay__text')!.textContent = 'Feed unavailable';
        }
    } finally {
        snapshotLoading = false;
    }
}

async function startMonitoring(): Promise<void> {
    if (!selectedCamera) {
        Toast.show('Select a camera first', 'info');
        return;
    }

    const interval = parseInt(
        (document.getElementById('poll-interval') as HTMLInputElement)?.value || '30'
    );

    try {
        const token = api.getToken();
        const res = await fetch(
            `/api/cameras/monitor/start?camera_id=${selectedCamera.id}&interval=${interval}`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail || 'Failed to start monitoring');
        }
        const data = await res.json();
        monitorStatus = data.status;

        Toast.show(`Monitoring started: ${selectedCamera.location_name}`, 'success');
        updateMonitorUI();
        startStatusPolling();
    } catch (err: any) {
        Toast.show(err.message || 'Failed to start monitoring', 'error');
    }
}

async function stopMonitoring(): Promise<void> {
    try {
        const token = api.getToken();
        const res = await fetch('/api/cameras/monitor/stop', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to stop monitoring');

        const data = await res.json();
        monitorStatus = data.status;

        Toast.show('Monitoring stopped', 'info');
        stopStatusPolling();
        updateMonitorUI();
    } catch (err: any) {
        Toast.show(err.message || 'Failed to stop monitoring', 'error');
    }
}

function startStatusPolling(): void {
    stopStatusPolling();
    statusPollTimer = window.setInterval(pollMonitorStatus, 3000);
}

function stopStatusPolling(): void {
    if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
    }
}

async function pollMonitorStatus(): Promise<void> {
    try {
        const data = await api.get<{ status: MonitorStatus }>('/cameras/monitor/status');
        monitorStatus = data.status;
        updateMonitorUI();

        // Also refresh snapshot during monitoring
        if (selectedCamera && monitorStatus.active) {
            loadSnapshot(selectedCamera);
        }

        // Stop polling if monitoring stopped externally
        if (!monitorStatus.active) {
            stopStatusPolling();
        }
    } catch (err) {
        console.error('Status poll error:', err);
    }
}

async function checkExistingMonitor(): Promise<void> {
    try {
        const data = await api.get<{ status: MonitorStatus }>('/cameras/monitor/status');
        monitorStatus = data.status;
        if (monitorStatus.active) {
            updateMonitorUI();
            startStatusPolling();
        }
    } catch {
        // Not monitoring — fine
    }
}

function updateMonitorUI(): void {
    if (!monitorStatus) return;

    const startBtn = document.getElementById('start-monitor-btn');
    const stopBtn = document.getElementById('stop-monitor-btn');
    const statusCard = document.getElementById('monitor-status-card');
    const detectionsCard = document.getElementById('detections-card');
    const statusBadge = document.getElementById('status-badge');

    if (monitorStatus.active) {
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
        show('monitor-status-card');
        show('detections-card');
        if (statusBadge) {
            statusBadge.textContent = 'Active';
            statusBadge.className = 'badge badge--success';
        }
    } else {
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        if (statusBadge) {
            statusBadge.textContent = 'Stopped';
            statusBadge.className = 'badge badge--muted';
        }
    }

    // Update stats
    const statsEl = document.getElementById('monitor-stats');
    if (statsEl) {
        const duration = monitorStatus.started_at
            ? getTimeSince(monitorStatus.started_at)
            : '—';

        statsEl.innerHTML = `
            <div class="monitor-stat">
                <div class="monitor-stat__value">${monitorStatus.frames_analyzed}</div>
                <div class="monitor-stat__label">Frames Analyzed</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value">${monitorStatus.detections_found}</div>
                <div class="monitor-stat__label">Detections</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value monitor-stat__value--danger">${monitorStatus.accidents_found}</div>
                <div class="monitor-stat__label">Accidents</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value">${duration}</div>
                <div class="monitor-stat__label">Duration</div>
            </div>
            ${monitorStatus.error ? `
                <div class="monitor-stat monitor-stat--full">
                    <div class="monitor-stat__value monitor-stat__value--danger" style="font-size: var(--text-xs);">
                        ${monitorStatus.error}
                    </div>
                    <div class="monitor-stat__label">Last Error</div>
                </div>
            ` : ''}
        `;
    }

    // Update detection count badge
    const countBadge = document.getElementById('detection-count');
    if (countBadge) countBadge.textContent = String(monitorStatus.detections_found);

    // Update detections list
    const listEl = document.getElementById('detection-list');
    if (listEl) {
        const dets = monitorStatus.recent_detections;
        if (dets.length === 0) {
            listEl.innerHTML = '<p class="text-muted">No detections yet. Monitoring is running...</p>';
        } else {
            listEl.innerHTML = dets
                .slice()
                .reverse()
                .map(d => `
                    <div class="monitor-detection-item">
                        <div class="monitor-detection-item__icon
                            monitor-detection-item__icon--${d.label === 'accident' ? 'danger' : 'info'}">
                            ${d.label === 'accident' ? '!' : 'V'}
                        </div>
                        <div class="monitor-detection-item__content">
                            <div class="monitor-detection-item__label">
                                ${d.label.charAt(0).toUpperCase() + d.label.slice(1)}
                                <span class="badge badge--${severityColor(d.severity)}">${d.severity}</span>
                            </div>
                            <div class="monitor-detection-item__meta">
                                ${(d.confidence * 100).toFixed(0)}% confidence &bull;
                                ${formatTime(d.timestamp)}
                            </div>
                        </div>
                        ${d.evidence_path ? `
                            <img class="monitor-detection-item__thumb"
                                 src="/evidence/${d.evidence_path}" alt="evidence" />
                        ` : ''}
                    </div>
                `)
                .join('');
        }
    }
}

// ── Helpers ──

function show(id: string): void {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
}

function hide(id: string): void {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
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

// Cleanup on navigation away
export function destroyMonitor(): void {
    stopStatusPolling();
    if (snapshotRefreshTimer) clearInterval(snapshotRefreshTimer);
    snapshotRefreshTimer = null;
    snapshotLoading = false;
    if (map) {
        map.remove();
        map = null;
    }
    markers = [];
    selectedCamera = null;
}
