/** Citadel API client — Fetch wrapper for /api/* endpoints with JWT auth. */

declare const __API_URL__: string;

const TOKEN_KEY = 'citadel_token';

class ApiClient {
    // Use environment-injected URL in production, fallback to relative /api for dev
    private baseUrl = __API_URL__ ? `${__API_URL__}/api` : '/api';

    /** Get the stored JWT token. */
    getToken(): string | null {
        return localStorage.getItem(TOKEN_KEY);
    }

    /** Check if the user is authenticated. */
    isAuthenticated(): boolean {
        return !!this.getToken();
    }

    /** Log in and store the JWT token. */
    async login(username: string, password: string): Promise<void> {
        const res = await fetch(this.baseUrl + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.detail || 'Invalid credentials');
        }
        const data = await res.json();
        localStorage.setItem(TOKEN_KEY, data.access_token);
    }

    /** Log out — clear token and redirect to login. */
    logout(): void {
        localStorage.removeItem(TOKEN_KEY);
        window.location.hash = '#/login';
    }

    /** Build headers with Authorization if token exists. */
    private authHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = { ...extra };
        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    /** Handle 401 responses — clear token and redirect. */
    private handleUnauthorized(res: Response): void {
        if (res.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            window.location.hash = '#/login';
        }
    }

    async get<T>(path: string, params?: Record<string, string>, cacheOptions?: { ttlMs: number, force?: boolean }): Promise<T> {
        const url = new URL(this.baseUrl + path, window.location.origin);
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                if (v) url.searchParams.set(k, v);
            });
        }

        const cacheKey = `api_cache_${url.toString()}`;

        // Check cache if requested and not forced to bypass
        if (cacheOptions && !cacheOptions.force) {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    if (parsed.expiry > Date.now()) {
                        return parsed.data as T;
                    } else {
                        localStorage.removeItem(cacheKey); // Clean up expired
                    }
                } catch {
                    localStorage.removeItem(cacheKey); // Clean up invalid JSON
                }
            }
        }

        const res = await fetch(url.toString(), {
            headers: this.authHeaders(),
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        // Save to cache if requested
        if (cacheOptions) {
            try {
                localStorage.setItem(cacheKey, JSON.stringify({
                    data: data,
                    expiry: Date.now() + cacheOptions.ttlMs
                }));
            } catch (err) {
                console.warn('Failed to cache API response:', err);
            }
        }

        return data;
    }

    async post<T>(path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
        const url = new URL(this.baseUrl + path, window.location.origin);
        if (params) {
            Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        }
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers: this.authHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || `API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async patch<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'PATCH',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async put<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'PUT',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async upload<T>(path: string, file: File, params?: Record<string, string>): Promise<T> {
        const formData = new FormData();
        formData.append('file', file);
        const url = new URL(this.baseUrl + path, window.location.origin);
        if (params) {
            Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        }
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers: this.authHeaders(),
            body: formData,
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async uploadMultiple<T>(path: string, files: File[]): Promise<T> {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers: this.authHeaders(),
            body: formData,
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async delete<T>(path: string): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'DELETE',
            headers: this.authHeaders(),
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    // ── Camera Snapshot & Stream API (unified — works for Caltrans and Iowa) ──

    /**
     * Get the snapshot proxy URL for any camera.
     * Routes through /api/cameras/{id}/snapshot which handles both
     * Caltrans (ca prefix) and Iowa DOT (ia_ prefix) cameras uniformly.
     */
    getSnapshotProxyUrl(cameraId: string): string {
        return `${this.baseUrl}/cameras/${cameraId}/snapshot`;
    }

    /**
     * Legacy alias — kept for backward compatibility.
     * Iowa snapshots are now also accessible via the unified /api/cameras endpoint.
     */
    getIowaSnapshotProxyUrl(cameraId: string): string {
        return this.getSnapshotProxyUrl(cameraId);
    }

    /**
     * Fetch HLS stream info for any camera (Caltrans or Iowa DOT).
     * Returns a proxied URL ready for hls.js, or null if not available.
     */
    async getStreamInfo(cameraId: string): Promise<{ has_stream: boolean; proxy_url: string; direct_url?: string } | null> {
        try {
            type StreamInfoResponse = {
                has_stream: boolean;
                proxy_url: string;
                direct_url?: string;
                location_name: string;
            };
            const data = await this.get<StreamInfoResponse>(`/cameras/${cameraId}/stream-info`);
            return {
                has_stream: data.has_stream,
                proxy_url: data.proxy_url,
                direct_url: data.direct_url,
            };
        } catch {
            return null;
        }
    }

    /** Fetch available Iowa regions (used by iowa-specific filter UI). */
    async getIowaRegions(): Promise<{ regions: string[] }> {
        return this.get('/iowa/cameras/regions', undefined, { ttlMs: 10 * 60 * 1000 });
    }

    /** Build auth headers object for use in <img> fetch or manual requests. */
    getAuthHeaders(): Record<string, string> {
        return this.authHeaders();
    }
}

// ── Iowa DOT Camera type ──
export interface IowaCameraData {
    id: string;
    fid: number;
    common_id: string;
    source: 'iowa';
    state: string;
    location_name: string;
    latitude: number;
    longitude: number;
    snapshot_url: string;
    stream_url: string;
    route: string;
    county: string;
    region: string;
    direction: string;
    camera_type: string;
    org: string;
    recorded: string;
    function: string;
    in_service: boolean;
    update_frequency: number;
    district: number;
    district_name: string;
}

export const api = new ApiClient();