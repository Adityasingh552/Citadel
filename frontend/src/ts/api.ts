/** Citadel API client — Fetch wrapper for /api/* endpoints with Supabase auth. */

import { getSupabase } from './supabase.js';

declare const __API_URL__: string;

class ApiClient {
    // Use environment-injected URL in production, fallback to relative /api for dev
    private baseUrl = __API_URL__ ? `${__API_URL__}/api` : '/api';

    /** Get the current Supabase access token. */
    async getToken(): Promise<string | null> {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? localStorage.getItem('citadel_token') ?? null;
    }

    /** Check if the user is authenticated. */
    async isAuthenticated(): Promise<boolean> {
        const supabase = getSupabase();
        
        // Primary: check Supabase session
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            console.log('[Auth] isAuthenticated: session found');
            return true;
        }
        
        // Fallback: check localStorage for token
        const token = localStorage.getItem('citadel_token');
        if (token) {
            console.log('[Auth] isAuthenticated: localStorage token found');
            return true;
        }
        
        console.log('[Auth] isAuthenticated: no auth found');
        return false;
    }

    /** Log in via backend auth endpoint and set up Supabase session. */
    async login(email: string, password: string): Promise<void> {
        const res = await fetch(this.baseUrl + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.detail || 'Invalid credentials');
        }
        const data = await res.json();
        
        console.log('[Auth] Login response received:', {
            hasAccessToken: !!data.access_token,
            hasRefreshToken: !!data.refresh_token,
            userId: data.user_id,
        });
        
        // Establish Supabase session with both tokens
        const supabase = getSupabase();
        const { error } = await supabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
        });
        
        if (error) {
            console.error('[Auth] setSession error:', error);
            throw new Error('Failed to establish session: ' + error.message);
        }
        
        // Verify session was established
        const { data: sessionData } = await supabase.auth.getSession();
        console.log('[Auth] Session after setSession:', {
            hasSession: !!sessionData.session,
            hasAccessToken: !!sessionData.session?.access_token,
        });
        
        // Store the access token for backward compatibility
        localStorage.setItem('citadel_token', data.access_token);
    }

    /** Log out — clear session and redirect to login. */
    async logout(): Promise<void> {
        try {
            const supabase = getSupabase();
            await supabase.auth.signOut();
        } catch {
            // Ignore sign-out errors
        }
        localStorage.removeItem('citadel_token');
        window.location.hash = '#/login';
    }

    invalidateViewCaches(): void {
        const prefixes = [
            `${this.baseUrl}/stats`,
            `${this.baseUrl}/incidents`,
            `${this.baseUrl}/alerts`,
            `${this.baseUrl}/cameras`,
            `${this.baseUrl}/settings`,
        ];
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('api_cache_')) continue;
            const cacheUrl = key.slice('api_cache_'.length);
            if (prefixes.some(p => cacheUrl.startsWith(p))) {
                localStorage.removeItem(key);
            }
        }

        const viewCacheKeys = [
            'citadel:view:overview:v1',
            'citadel:view:incidents:v1',
            'citadel:view:cameras:monitor:v1',
            'citadel:view:monitor:status:v1',
            'citadel:view:settings:v1',
        ];
        for (const key of viewCacheKeys) {
            localStorage.removeItem(key);
        }
    }

    /** Build headers with Authorization if token exists. */
    private async authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
        const headers: Record<string, string> = { ...extra };
        const token = localStorage.getItem('citadel_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    /** Handle 401 responses — clear token and redirect. */
    private handleUnauthorized(res: Response): void {
        if (res.status === 401) {
            localStorage.removeItem('citadel_token');
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

        const headers = await this.authHeaders();
        const res = await fetch(url.toString(), {
            headers,
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
        const headers = await this.authHeaders(body ? { 'Content-Type': 'application/json' } : undefined);
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers,
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
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' });
        const res = await fetch(this.baseUrl + path, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async put<T>(path: string, body: unknown): Promise<T> {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' });
        const res = await fetch(this.baseUrl + path, {
            method: 'PUT',
            headers,
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
        const headers = await this.authHeaders();
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers,
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
        const headers = await this.authHeaders();
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
    }

    async delete<T>(path: string): Promise<T> {
        const headers = await this.authHeaders();
        const res = await fetch(this.baseUrl + path, {
            method: 'DELETE',
            headers,
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
    async getAuthHeaders(): Promise<Record<string, string>> {
        return await this.authHeaders();
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
