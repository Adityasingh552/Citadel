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

    async get<T>(path: string, params?: Record<string, string>): Promise<T> {
        const url = new URL(this.baseUrl + path, window.location.origin);
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                if (v) url.searchParams.set(k, v);
            });
        }
        const res = await fetch(url.toString(), {
            headers: this.authHeaders(),
        });
        if (!res.ok) {
            this.handleUnauthorized(res);
            throw new Error(`API ${res.status}: ${res.statusText}`);
        }
        return res.json();
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

    // ── Camera & Monitor API ──

    /** Get the snapshot proxy URL for a camera (returns image bytes via backend). */
    getSnapshotProxyUrl(cameraId: string): string {
        return `${this.baseUrl}/cameras/${cameraId}/snapshot`;
    }

    /** Fetch stream info for a camera. Returns direct stream URL when available. */
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

    /** Build auth headers object for use in <img> fetch or manual requests. */
    getAuthHeaders(): Record<string, string> {
        return this.authHeaders();
    }
}

export const api = new ApiClient();