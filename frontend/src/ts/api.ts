/** Citadel API client — Fetch wrapper for /api/* endpoints with JWT auth. */

const TOKEN_KEY = 'citadel_token';

class ApiClient {
    private baseUrl = '/api';

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

    async post<T>(path: string, body?: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
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

    // ── Caltrans Camera & Monitor API ──

    /** Get the snapshot proxy URL for a Caltrans camera. */
    getSnapshotProxyUrl(cameraId: string): string {
        return `${this.baseUrl}/cameras/${cameraId}/snapshot`;
    }

    /** Fetch stream info for a Caltrans camera. */
    async getStreamInfo(cameraId: string): Promise<{ has_stream: boolean; stream_url: string } | null> {
        try {
            const data = await this.get<{ camera: { stream_url: string } }>(`/cameras/${cameraId}/info`);
            const streamUrl = data.camera?.stream_url || '';
            return {
                has_stream: Boolean(streamUrl),
                stream_url: streamUrl,
            };
        } catch {
            return null;
        }
    }

    // ── Iowa DOT Camera API ──

    /** Fetch Iowa DOT cameras from ArcGIS FeatureServer. Cached server-side. */
    async getIowaCameras(params?: {
        region?: string;
        search?: string;
        camera_type?: string;
        limit?: number;
        force_refresh?: boolean;
    }): Promise<{ cameras: IowaCameraData[]; total: number; source: string }> {
        const queryParams: Record<string, string> = {};
        if (params?.region) queryParams.region = params.region;
        if (params?.search) queryParams.search = params.search;
        if (params?.camera_type) queryParams.camera_type = params.camera_type;
        if (params?.limit) queryParams.limit = String(params.limit);
        if (params?.force_refresh) queryParams.force_refresh = 'true';
        return this.get('/iowa/cameras', queryParams, { ttlMs: 5 * 60 * 1000 });
    }

    /** Fetch available Iowa regions. */
    async getIowaRegions(): Promise<{ regions: string[] }> {
        return this.get('/iowa/cameras/regions', undefined, { ttlMs: 10 * 60 * 1000 });
    }

    /** Get the snapshot proxy URL for an Iowa DOT camera. */
    getIowaSnapshotProxyUrl(cameraId: string): string {
        return `${this.baseUrl}/iowa/cameras/${cameraId}/snapshot`;
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