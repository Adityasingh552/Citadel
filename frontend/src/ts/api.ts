/** Citadel API client — Fetch wrapper for /api/* endpoints. */

class ApiClient {
    private baseUrl = '/api';

    async get<T>(path: string, params?: Record<string, string>): Promise<T> {
        const url = new URL(this.baseUrl + path, window.location.origin);
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                if (v) url.searchParams.set(k, v);
            });
        }
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async post<T>(path: string, body?: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async patch<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async put<T>(path: string, body: unknown): Promise<T> {
        const res = await fetch(this.baseUrl + path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
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
            body: formData,
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async uploadMultiple<T>(path: string, files: File[]): Promise<T> {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
        return res.json();
    }
}

export const api = new ApiClient();