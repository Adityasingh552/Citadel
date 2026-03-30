/** Citadel — Live Monitor view with interactive Leaflet map and multi-camera monitoring. */

import { api } from '../../api.js';
import { Toast } from '../../utils/toast.js';
import { VideoPlayer } from '../../utils/videoPlayer.js';
import type { CameraInfo, MonitorStatus, MonitorStatusResponse } from '../../types/index.js';

declare const L: any; // Leaflet global from CDN

// State
let map: any = null;
let cameras: CameraInfo[] = [];
let selectedCamera: CameraInfo | null = null;
let monitorStatuses: MonitorStatus[] = [];
let statusPollTimer: number | null = null;
let snapshotRefreshTimer: number | null = null;
let snapshotLoading = false;

// Video player state
let videoPlayer: VideoPlayer | null = null;
let feedMode: 'snapshot' | 'video' = 'snapshot';

// Marker layer — all markers live in here for fast add/remove
let markerLayer: any = null;
// Map from camera id → circleMarker for efficient individual updates
let markerMap: Map<string, any> = new Map();
// Track if initial fitBounds has been done
let initialBoundsDone = false;

const DEFAULT_CENTER: [number, number] = [36.78, -119.42]; // Central California
const DEFAULT_ZOOM = 6;

// District boundary centers and zoom levels (approximate)
const DISTRICT_BOUNDS: Record<string, { center: [number, number]; zoom: number }> = {
    '1': { center: [40.80, -124.16], zoom: 8 },   // Northwest
    '2': { center: [40.58, -122.39], zoom: 8 },   // Northeast
    '3': { center: [38.58, -121.49], zoom: 10 },  // Sacramento
    '4': { center: [37.77, -122.42], zoom: 10 },  // SF Bay Area
    '5': { center: [36.97, -122.03], zoom: 8 },   // Central Coast
    '6': { center: [36.74, -119.79], zoom: 9 },   // Fresno
    '7': { center: [34.05, -118.25], zoom: 9 },   // Los Angeles
    '8': { center: [34.10, -117.29], zoom: 9 },   // San Bernardino
    '9': { center: [37.36, -118.40], zoom: 8 },   // Bishop
    '10': { center: [37.96, -121.29], zoom: 10 }, // Stockton
    '11': { center: [32.72, -117.16], zoom: 10 }, // San Diego
    '12': { center: [33.74, -117.87], zoom: 10 }, // Orange County
};

export function renderMonitor(container: HTMLElement): void {
    container.innerHTML = `
        <div class="monitor-layout">
            <!-- Left: Map + Camera selector -->
            <div class="monitor-map-panel">
                <div class="monitor-map-toolbar">
                    <div class="monitor-toolbar-left">
                        <select id="district-select" class="monitor-select">
                            <option value="">All Districts</option>
                            <option value="1">D1 — Northwest</option>
                            <option value="2">D2 — Northeast</option>
                            <option value="3">D3 — Sacramento</option>
                            <option value="4">D4 — SF Bay Area</option>
                            <option value="5">D5 — Central Coast</option>
                            <option value="6">D6 — Fresno</option>
                            <option value="7">D7 — Los Angeles</option>
                            <option value="8">D8 — San Bernardino</option>
                            <option value="9">D9 — Bishop</option>
                            <option value="10">D10 — Stockton</option>
                            <option value="11">D11 — San Diego</option>
                            <option value="12">D12 — Orange County</option>
                        </select>
                        <input type="text" id="camera-search" class="monitor-search"
                               placeholder="Search cameras..." />
                    </div>
                    <div class="monitor-toolbar-right">
                        <span class="monitor-cam-count" id="cam-count">0 cameras</span>
                        <span class="monitor-active-count" id="active-monitor-count"></span>
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

                <!-- Live Feed -->
                <div class="card" id="live-feed-card" style="display:none;">
                    <div class="card__header">
                        <h3 class="card__title">Live Feed</h3>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div class="feed-mode-toggle" id="feed-mode-toggle" style="display:none;">
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
                        <div class="monitor-feed-container" id="feed-container">
                            <img id="camera-snapshot" class="monitor-snapshot" alt="Camera feed" />
                            <div class="monitor-feed-overlay" id="feed-overlay" style="display:none;">
                                <span class="monitor-feed-overlay__text">Loading...</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Monitor controls (no poll slider — uses camera's update_frequency) -->
                <div class="card" id="monitor-controls-card" style="display:none;">
                    <div class="card__header">
                        <h3 class="card__title">Auto-Monitor</h3>
                    </div>
                    <div class="card__body">
                        <div class="monitor-controls">
                            <div class="monitor-freq-info" id="camera-freq-info">
                                <span class="monitor-freq-info__label">Update Frequency:</span>
                                <span class="monitor-freq-info__value" id="camera-freq-val">—</span>
                            </div>
                            <div class="stream-config" id="stream-config" style="display:none;">
                                <label class="stream-config__checkbox-label">
                                    <input type="checkbox" id="stream-mode-checkbox" />
                                    <span>Use video stream for analysis</span>
                                </label>
                                <div class="stream-config__interval" id="stream-interval-group" style="display:none;">
                                    <label class="stream-config__interval-label" for="stream-interval-input">
                                        Frame capture interval (seconds):
                                    </label>
                                    <input type="number" id="stream-interval-input" class="stream-config__interval-input"
                                           min="3" max="120" value="10" step="1" />
                                    <span class="stream-config__interval-hint">3–120s (lower = more frames, more CPU)</span>
                                </div>
                            </div>
                            <div class="monitor-actions">
                                <button class="btn btn--primary" id="start-monitor-btn">Start Monitoring</button>
                                <button class="btn btn--warning" id="pause-monitor-btn" style="display:none;">Pause</button>
                                <button class="btn btn--success" id="resume-monitor-btn" style="display:none;">Resume</button>
                                <button class="btn btn--danger" id="stop-monitor-btn" style="display:none;">Stop</button>
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
    checkExistingMonitors();
}

function initMap(): void {
    const mapEl = document.getElementById('monitor-map');
    if (!mapEl || typeof L === 'undefined') {
        console.error('Leaflet not loaded or map element missing');
        return;
    }

    map = L.map('monitor-map', {
        preferCanvas: true,  // Use canvas renderer for much better performance
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);

    // Fix Leaflet rendering in dynamically created containers
    setTimeout(() => map.invalidateSize(), 200);
}

function bindEvents(): void {
    document.getElementById('district-select')?.addEventListener('change', (e) => {
        const district = (e.target as HTMLSelectElement).value || undefined;

        if (district && DISTRICT_BOUNDS[district] && map) {
            // Zoom to district — pins stay on map
            const { center, zoom } = DISTRICT_BOUNDS[district];
            map.setView(center, zoom);
        } else if (map && cameras.length > 0) {
            // "All Districts" — fit bounds to show everything
            const bounds = L.latLngBounds(cameras.map((c: CameraInfo) => [c.latitude, c.longitude]));
            map.fitBounds(bounds, { padding: [30, 30] });
        }
    });

    document.getElementById('camera-search')?.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value;
        filterCamerasOnMap(query);
    });

    document.getElementById('refresh-cameras-btn')?.addEventListener('click', () => {
        loadCameras();
    });

    document.getElementById('start-monitor-btn')?.addEventListener('click', startMonitoring);
    document.getElementById('pause-monitor-btn')?.addEventListener('click', pauseMonitoring);
    document.getElementById('resume-monitor-btn')?.addEventListener('click', resumeMonitoring);
    document.getElementById('stop-monitor-btn')?.addEventListener('click', stopMonitoring);

    // Feed mode toggle (Snapshot / Video)
    document.getElementById('feed-mode-toggle')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
        if (!btn) return;
        const mode = btn.dataset.mode as 'snapshot' | 'video';
        if (mode === feedMode) return;
        switchFeedMode(mode);
    });

    // Stream mode checkbox — show/hide interval input
    document.getElementById('stream-mode-checkbox')?.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        const intervalGroup = document.getElementById('stream-interval-group');
        if (intervalGroup) intervalGroup.style.display = checked ? '' : 'none';
    });
}

async function loadCameras(): Promise<void> {
    try {
        const params: Record<string, string> = { limit: '5000' };

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

/** Get set of camera IDs currently being actively monitored. */
function getActiveMonitorIds(): Set<string> {
    return new Set(
        monitorStatuses
            .filter(s => s.active && s.camera_id)
            .map(s => s.camera_id!)
    );
}

// Marker style constants
const STYLE_DEFAULT = { radius: 5, color: '#16a34a', fillColor: '#22c55e', fillOpacity: 0.8, weight: 1 };
const STYLE_HAS_STREAM = { radius: 5, color: '#7c3aed', fillColor: '#a855f7', fillOpacity: 0.85, weight: 1 };
const STYLE_SELECTED = { radius: 7, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 };
const STYLE_MONITORED = { radius: 7, color: '#dc2626', fillColor: '#ef4444', fillOpacity: 1, weight: 2 };

function plotCamerasOnMap(cams: CameraInfo[]): void {
    if (!map || !markerLayer) return;

    // Clear all existing markers
    markerLayer.clearLayers();
    markerMap.clear();

    const activeIds = getActiveMonitorIds();

    cams.forEach(cam => {
        const isSelected = selectedCamera?.id === cam.id;
        const isMonitored = activeIds.has(cam.id);
        const hasStream = Boolean(cam.stream_url);
        const style = isMonitored ? STYLE_MONITORED
            : isSelected ? STYLE_SELECTED
            : hasStream ? STYLE_HAS_STREAM
            : STYLE_DEFAULT;

        const marker = L.circleMarker([cam.latitude, cam.longitude], style)
            .bindPopup(`
                <strong>${cam.location_name}</strong><br/>
                ${cam.county} &bull; ${cam.route}<br/>
                <em>District ${cam.district} — ${cam.district_name}</em>
                ${hasStream ? '<br/><span style="color:#a855f7;">Video Stream Available</span>' : ''}
                ${isMonitored ? '<br/><strong style="color:#ef4444;">Monitoring Active</strong>' : ''}
            `);

        marker.on('click', () => selectCamera(cam));
        markerLayer.addLayer(marker);
        markerMap.set(cam.id, marker);
    });

    // Fit bounds only on initial load
    if (!initialBoundsDone && cams.length > 0) {
        const bounds = L.latLngBounds(cams.map(c => [c.latitude, c.longitude]));
        map.fitBounds(bounds, { padding: [30, 30] });
        initialBoundsDone = true;
    }
}

/** Update marker styles without re-creating them. */
function updateMarkerStyles(): void {
    if (!markerMap.size) return;

    const activeIds = getActiveMonitorIds();

    markerMap.forEach((marker, camId) => {
        const isSelected = selectedCamera?.id === camId;
        const isMonitored = activeIds.has(camId);
        const cam = cameras.find(c => c.id === camId);
        const hasStream = Boolean(cam?.stream_url);
        const style = isMonitored ? STYLE_MONITORED
            : isSelected ? STYLE_SELECTED
            : hasStream ? STYLE_HAS_STREAM
            : STYLE_DEFAULT;
        marker.setStyle(style);
        marker.setRadius(style.radius);
    });
}

function filterCamerasOnMap(query: string): void {
    if (!markerLayer) return;

    if (!query) {
        // Show all — restore any hidden markers
        markerMap.forEach((marker) => {
            if (!markerLayer.hasLayer(marker)) {
                markerLayer.addLayer(marker);
            }
        });
        return;
    }

    const q = query.toLowerCase();
    cameras.forEach(cam => {
        const marker = markerMap.get(cam.id);
        if (!marker) return;

        const matches = cam.location_name.toLowerCase().includes(q)
            || cam.county.toLowerCase().includes(q)
            || cam.route.toLowerCase().includes(q);

        if (matches && !markerLayer.hasLayer(marker)) {
            markerLayer.addLayer(marker);
        } else if (!matches && markerLayer.hasLayer(marker)) {
            markerLayer.removeLayer(marker);
        }
    });
}

/** Switch between snapshot and video feed modes. */
function switchFeedMode(mode: 'snapshot' | 'video'): void {
    feedMode = mode;
    updateFeedModeToggleUI();

    if (!selectedCamera) return;

    const container = document.getElementById('feed-container');
    if (!container) return;

    if (mode === 'video') {
        // Hide snapshot elements
        const img = document.getElementById('camera-snapshot') as HTMLImageElement;
        const overlay = document.getElementById('feed-overlay');
        if (img) img.style.display = 'none';
        if (overlay) overlay.style.display = 'none';

        // Stop snapshot auto-refresh while video is playing
        if (snapshotRefreshTimer) {
            clearInterval(snapshotRefreshTimer);
            snapshotRefreshTimer = null;
        }

        // Start video player
        startVideoPlayer(selectedCamera, container);
    } else {
        // Destroy video player
        destroyVideoPlayer();

        // Show snapshot elements
        const img = document.getElementById('camera-snapshot') as HTMLImageElement;
        if (img) img.style.display = '';

        // Reload snapshot and restart auto-refresh
        loadSnapshot(selectedCamera);
        const refreshMs = Math.max(selectedCamera.update_frequency * 60 * 1000, 30000);
        if (snapshotRefreshTimer) clearInterval(snapshotRefreshTimer);
        snapshotRefreshTimer = window.setInterval(() => {
            if (selectedCamera) loadSnapshotIfChanged(selectedCamera);
        }, refreshMs);
    }
}

/** Start the HLS video player for a camera. */
async function startVideoPlayer(cam: CameraInfo, container: HTMLElement): Promise<void> {
    // Remove any existing video player message
    container.querySelector('.video-player-message')?.remove();
    container.querySelector('.video-player-loading')?.remove();

    // Check if camera has a stream
    if (!cam.stream_url) {
        const msg = document.createElement('div');
        msg.className = 'video-player-message';
        msg.textContent = 'No video stream available for this camera.';
        container.appendChild(msg);
        return;
    }

    // Show loading state
    const loading = document.createElement('div');
    loading.className = 'video-player-loading';
    loading.innerHTML = '<span>Connecting to stream...</span>';
    container.appendChild(loading);

    // Remove loading indicator
    loading.remove();

    // Create video player
    videoPlayer = new VideoPlayer({
        container: container,
        hlsUrl: cam.stream_url,
        className: 'hls-video-player monitor-snapshot',
        onError: (message) => {
            const msg = document.createElement('div');
            msg.className = 'video-player-message';
            msg.textContent = message;
            container.appendChild(msg);
        },
        onPlaying: () => {
            // Stream is playing
        },
    });
}

/** Destroy the active video player. */
function destroyVideoPlayer(): void {
    if (videoPlayer) {
        videoPlayer.destroy();
        videoPlayer = null;
    }
    // Remove any message elements
    const container = document.getElementById('feed-container');
    if (container) {
        container.querySelector('.video-player-message')?.remove();
        container.querySelector('.video-player-loading')?.remove();
    }
}

/** Update the toggle button UI to reflect current mode. */
function updateFeedModeToggleUI(): void {
    const toggle = document.getElementById('feed-mode-toggle');
    if (!toggle) return;

    toggle.querySelectorAll('[data-mode]').forEach(btn => {
        const el = btn as HTMLElement;
        if (el.dataset.mode === feedMode) {
            el.classList.add('feed-mode-toggle__btn--active');
        } else {
            el.classList.remove('feed-mode-toggle__btn--active');
        }
    });
}

function selectCamera(cam: CameraInfo): void {
    selectedCamera = cam;

    // Destroy any active video player when switching cameras
    destroyVideoPlayer();
    feedMode = 'snapshot';
    updateFeedModeToggleUI();

    // Show/hide feed mode toggle based on whether camera has a video stream
    const feedToggle = document.getElementById('feed-mode-toggle');
    if (feedToggle) feedToggle.style.display = cam.stream_url ? '' : 'none';

    // Check if this camera is already being monitored
    const camStatus = monitorStatuses.find(s => s.camera_id === cam.id && s.active);

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
                <div class="monitor-cam-info__freq">
                    Updates every ${cam.update_frequency} min
                </div>
            </div>
        `;
    }

    // Show feed and controls
    show('live-feed-card');
    show('monitor-controls-card');

    // Update frequency display
    const freqVal = document.getElementById('camera-freq-val');
    if (freqVal) freqVal.textContent = `Every ${cam.update_frequency} min`;

    // Show/hide stream config based on whether camera has a video stream
    const streamConfig = document.getElementById('stream-config');
    if (streamConfig) {
        streamConfig.style.display = cam.stream_url ? '' : 'none';
    }
    // Reset stream mode controls when switching cameras
    const streamCheckbox = document.getElementById('stream-mode-checkbox') as HTMLInputElement;
    if (streamCheckbox) streamCheckbox.checked = false;
    const intervalGroup = document.getElementById('stream-interval-group');
    if (intervalGroup) intervalGroup.style.display = 'none';

    // Update start/stop button visibility based on whether this camera is monitored
    updateControlButtons(camStatus);

    // Load snapshot
    loadSnapshot(cam);

    // Start auto-refreshing the snapshot preview using camera's update frequency
    // Convert minutes to ms, but cap at a minimum of 30s for the preview
    const refreshMs = Math.max(cam.update_frequency * 60 * 1000, 30000);
    if (snapshotRefreshTimer) clearInterval(snapshotRefreshTimer);
    snapshotRefreshTimer = window.setInterval(() => {
        if (selectedCamera) {
            loadSnapshotIfChanged(selectedCamera);
        }
    }, refreshMs);

    // Show status card if this camera is being monitored
    if (camStatus) {
        updateMonitorUI(camStatus);
    } else {
        hide('monitor-status-card');
        hide('detections-card');
    }

    // Update marker styles to highlight selected (no full re-plot)
    updateMarkerStyles();

    // Pan map to camera
    if (map) map.setView([cam.latitude, cam.longitude], 13);
}

function updateControlButtons(camStatus: MonitorStatus | undefined): void {
    const startBtn = document.getElementById('start-monitor-btn');
    const pauseBtn = document.getElementById('pause-monitor-btn');
    const resumeBtn = document.getElementById('resume-monitor-btn');
    const stopBtn = document.getElementById('stop-monitor-btn');

    if (camStatus && camStatus.active) {
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
        
        if (camStatus.paused) {
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'inline-flex';
        } else {
            if (pauseBtn) pauseBtn.style.display = 'inline-flex';
            if (resumeBtn) resumeBtn.style.display = 'none';
        }
    } else {
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'none';
    }
}

/** Check if snapshot changed via HEAD, then fetch only if new. */
async function loadSnapshotIfChanged(cam: CameraInfo): Promise<void> {
    if (snapshotLoading) return;

    try {
        const data = await api.get<{ changed: boolean }>(
            `/cameras/${cam.id}/snapshot-changed`
        );
        if (data.changed) {
            loadSnapshot(cam);
        }
    } catch {
        // Fallback: just load it anyway
        loadSnapshot(cam);
    }
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

    // Read stream mode configuration
    const streamCheckbox = document.getElementById('stream-mode-checkbox') as HTMLInputElement;
    const streamIntervalInput = document.getElementById('stream-interval-input') as HTMLInputElement;
    const useStreamMode = streamCheckbox?.checked ?? false;
    const streamInterval = streamIntervalInput ? parseInt(streamIntervalInput.value, 10) || 10 : 10;

    try {
        const token = api.getToken();
        const params = new URLSearchParams({
            camera_id: selectedCamera.id,
            stream_mode: String(useStreamMode),
            stream_interval: String(streamInterval),
        });
        const res = await fetch(
            `/api/cameras/monitor/start?${params.toString()}`,
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

        Toast.show(`Monitoring started: ${selectedCamera.location_name}`, 'success');

        // Refresh all statuses and update UI
        await pollAllMonitorStatuses();
        startStatusPolling();
    } catch (err: any) {
        Toast.show(err.message || 'Failed to start monitoring', 'error');
    }
}

async function stopMonitoring(): Promise<void> {
    if (!selectedCamera) return;

    try {
        const token = api.getToken();
        const res = await fetch(`/api/cameras/monitor/${selectedCamera.id}/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to stop monitoring');

        Toast.show('Monitoring stopped', 'info');

        await pollAllMonitorStatuses();

        // Update UI for this camera
        const camStatus = monitorStatuses.find(s => s.camera_id === selectedCamera?.id);
        updateControlButtons(camStatus);
        if (!camStatus || !camStatus.active) {
            const statusBadge = document.getElementById('status-badge');
            if (statusBadge) {
                statusBadge.textContent = 'Stopped';
                statusBadge.className = 'badge badge--muted';
            }
        }

        // Update marker styles to remove red indicator
        updateMarkerStyles();
    } catch (err: any) {
        Toast.show(err.message || 'Failed to stop monitoring', 'error');
    }
}

async function pauseMonitoring(): Promise<void> {
    if (!selectedCamera) return;

    try {
        const token = api.getToken();
        const res = await fetch(`/api/cameras/monitor/${selectedCamera.id}/pause`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to pause monitoring');

        Toast.show('Monitoring paused', 'info');

        await pollAllMonitorStatuses();

        const camStatus = monitorStatuses.find(s => s.camera_id === selectedCamera?.id);
        updateControlButtons(camStatus);
        if (camStatus) updateMonitorUI(camStatus);
    } catch (err: any) {
        Toast.show(err.message || 'Failed to pause monitoring', 'error');
    }
}

async function resumeMonitoring(): Promise<void> {
    if (!selectedCamera) return;

    try {
        const token = api.getToken();
        const res = await fetch(`/api/cameras/monitor/${selectedCamera.id}/resume`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to resume monitoring');

        Toast.show('Monitoring resumed', 'success');

        await pollAllMonitorStatuses();

        const camStatus = monitorStatuses.find(s => s.camera_id === selectedCamera?.id);
        updateControlButtons(camStatus);
        if (camStatus) updateMonitorUI(camStatus);
    } catch (err: any) {
        Toast.show(err.message || 'Failed to resume monitoring', 'error');
    }
}

function startStatusPolling(): void {
    stopStatusPolling();
    statusPollTimer = window.setInterval(pollAllMonitorStatuses, 5000);
}

function stopStatusPolling(): void {
    if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
    }
}

async function pollAllMonitorStatuses(): Promise<void> {
    try {
        const data = await api.get<MonitorStatusResponse>('/cameras/monitor/status');
        monitorStatuses = data.monitors;

        // Update active count badge
        const activeCountEl = document.getElementById('active-monitor-count');
        if (activeCountEl) {
            if (data.active_count > 0) {
                activeCountEl.textContent = `${data.active_count} monitoring`;
                activeCountEl.style.display = '';
            } else {
                activeCountEl.style.display = 'none';
            }
        }

        // If we have a selected camera, update its specific UI
        if (selectedCamera) {
            const camStatus = monitorStatuses.find(s => s.camera_id === selectedCamera?.id);
            if (camStatus && camStatus.active) {
                updateMonitorUI(camStatus);
                updateControlButtons(camStatus);
                // Refresh snapshot during active monitoring (skip if viewing video)
                if (feedMode !== 'video') {
                    loadSnapshotIfChanged(selectedCamera);
                }
            } else {
                updateControlButtons(undefined);
            }
        }

        // Stop polling if no monitors are active
        if (data.active_count === 0) {
            stopStatusPolling();
        }

        // Re-style markers to reflect monitoring state (no full re-plot)
        updateMarkerStyles();
    } catch (err) {
        console.error('Status poll error:', err);
    }
}

async function checkExistingMonitors(): Promise<void> {
    try {
        const data = await api.get<MonitorStatusResponse>('/cameras/monitor/status');
        monitorStatuses = data.monitors;

        if (data.active_count > 0) {
            startStatusPolling();

            const activeCountEl = document.getElementById('active-monitor-count');
            if (activeCountEl) {
                activeCountEl.textContent = `${data.active_count} monitoring`;
                activeCountEl.style.display = '';
            }
        }
    } catch {
        // Not monitoring — fine
    }
}

function updateMonitorUI(status: MonitorStatus): void {
    const startBtn = document.getElementById('start-monitor-btn');
    const pauseBtn = document.getElementById('pause-monitor-btn');
    const resumeBtn = document.getElementById('resume-monitor-btn');
    const stopBtn = document.getElementById('stop-monitor-btn');
    const statusBadge = document.getElementById('status-badge');

    if (status.active) {
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-flex';
        
        if (status.paused) {
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (resumeBtn) resumeBtn.style.display = 'inline-flex';
            if (statusBadge) {
                statusBadge.textContent = 'Paused';
                statusBadge.className = 'badge badge--warning';
            }
        } else {
            if (pauseBtn) pauseBtn.style.display = 'inline-flex';
            if (resumeBtn) resumeBtn.style.display = 'none';
            if (statusBadge) {
                statusBadge.textContent = 'Active';
                statusBadge.className = 'badge badge--success';
            }
        }
        show('monitor-status-card');
        show('detections-card');
    } else {
        if (startBtn) startBtn.style.display = 'inline-flex';
        if (stopBtn) stopBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (statusBadge) {
            statusBadge.textContent = 'Stopped';
            statusBadge.className = 'badge badge--muted';
        }
    }

    // Update stats
    const statsEl = document.getElementById('monitor-stats');
    if (statsEl) {
        const duration = status.started_at
            ? getTimeSince(status.started_at)
            : '—';

        statsEl.innerHTML = `
            <div class="monitor-stat">
                <div class="monitor-stat__value">${status.frames_analyzed}</div>
                <div class="monitor-stat__label">Frames Analyzed</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value">${status.detections_found}</div>
                <div class="monitor-stat__label">Detections</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value monitor-stat__value--danger">${status.accidents_found}</div>
                <div class="monitor-stat__label">Accidents</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value">${duration}</div>
                <div class="monitor-stat__label">Duration</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value">${status.skipped_unchanged}</div>
                <div class="monitor-stat__label">Skipped (Unchanged)</div>
            </div>
            <div class="monitor-stat">
                <div class="monitor-stat__value">${status.stream_mode ? 'Stream' : 'Snapshot'}</div>
                <div class="monitor-stat__label">Source Mode</div>
            </div>
            ${status.stream_mode ? `
                <div class="monitor-stat">
                    <div class="monitor-stat__value">${status.stream_interval}s</div>
                    <div class="monitor-stat__label">Stream Interval</div>
                </div>
            ` : `
                <div class="monitor-stat">
                    <div class="monitor-stat__value">${status.poll_interval}s</div>
                    <div class="monitor-stat__label">Poll Interval</div>
                </div>
            `}
            ${status.error ? `
                <div class="monitor-stat monitor-stat--full">
                    <div class="monitor-stat__value monitor-stat__value--danger" style="font-size: var(--text-xs);">
                        ${status.error}
                    </div>
                    <div class="monitor-stat__label">Last Error</div>
                </div>
            ` : ''}
        `;
    }

    // Update detection count badge
    const countBadge = document.getElementById('detection-count');
    if (countBadge) countBadge.textContent = String(status.detections_found);

    // Update detections list
    const listEl = document.getElementById('detection-list');
    if (listEl) {
        const dets = status.recent_detections;
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
    destroyVideoPlayer();
    feedMode = 'snapshot';
    if (map) {
        map.remove();
        map = null;
    }
    markerLayer = null;
    markerMap.clear();
    initialBoundsDone = false;
    selectedCamera = null;
    monitorStatuses = [];
}
