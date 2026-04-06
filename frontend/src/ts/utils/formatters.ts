/** Formatting utilities. */

export function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
    });
}

export function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

export function formatDateTime(iso: string): string {
    return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

export function formatPercent(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
}

export function eventTypeLabel(type: string): string {
    const labels: Record<string, string> = {
        accident: 'Accident',
    };
    return labels[type] || type;
}

export function severityColor(severity: string): string {
    const colors: Record<string, string> = {
        high: 'var(--danger)',
        medium: 'var(--warning)',
        low: 'var(--success)',
    };
    return colors[severity] || 'var(--text-muted)';
}
