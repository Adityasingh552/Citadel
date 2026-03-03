/** Global state for tracking active video processing jobs.
 *
 * This persists across page navigations within the SPA so the
 * LiveFeed view can show processing status even after the user
 * navigates away and comes back.
 */

import type { VideoProcessingResult } from './types/index.js';

export interface ProcessingJob {
    fileName: string;
    startedAt: number;
    status: 'processing' | 'done' | 'error';
    result?: VideoProcessingResult;
    error?: string;
}

/** Singleton state — survives view re-renders. */
let _activeJob: ProcessingJob | null = null;
const _listeners: Array<(job: ProcessingJob | null) => void> = [];

export function getActiveJob(): ProcessingJob | null {
    return _activeJob;
}

export function setActiveJob(job: ProcessingJob | null): void {
    _activeJob = job;
    _listeners.forEach(fn => fn(_activeJob));
}

export function onJobChange(listener: (job: ProcessingJob | null) => void): () => void {
    _listeners.push(listener);
    return () => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) _listeners.splice(idx, 1);
    };
}
