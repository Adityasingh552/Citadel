/**
 * Citadel — HLS Video Player utility for live CCTV stream playback.
 *
 * Wraps hls.js to provide a simple interface for creating and managing
 * HLS video players. Handles initialization, error recovery, and cleanup.
 */

import Hls from 'hls.js';
import { api } from '../api.js';

export interface VideoPlayerOptions {
    /** The container element to render the video player into. */
    container: HTMLElement;
    /** The proxied HLS playlist URL (from stream-info endpoint). */
    hlsUrl: string;
    /** Optional CSS class to add to the video element. */
    className?: string;
    /** Whether to autoplay (default: true). */
    autoplay?: boolean;
    /** Whether to mute (default: true — required for autoplay). */
    muted?: boolean;
    /** Callback when an unrecoverable error occurs. */
    onError?: (message: string) => void;
    /** Callback when the stream starts playing. */
    onPlaying?: () => void;
}

export class VideoPlayer {
    private hls: Hls | null = null;
    private video: HTMLVideoElement | null = null;
    private container: HTMLElement;
    private destroyed = false;

    constructor(private options: VideoPlayerOptions) {
        this.container = options.container;
        this.init();
    }

    private init(): void {
        // Create video element
        this.video = document.createElement('video');
        this.video.className = this.options.className || 'hls-video-player';
        this.video.playsInline = true;
        this.video.muted = this.options.muted !== false;
        this.video.autoplay = this.options.autoplay !== false;
        this.video.controls = true;

        // Build the full URL with auth token as query param for hls.js XHR requests
        const hlsUrl = this.options.hlsUrl;

        if (Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                xhrSetup: (xhr: XMLHttpRequest) => {
                    // Attach JWT auth header to all HLS requests
                    const token = api.getToken();
                    if (token) {
                        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                    }
                },
                // Retry settings for live streams
                manifestLoadingMaxRetry: 6,
                levelLoadingMaxRetry: 6,
                fragLoadingMaxRetry: 6,
            });

            this.hls.loadSource(hlsUrl);
            this.hls.attachMedia(this.video);

            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (this.destroyed) return;
                this.video?.play().catch(() => {
                    // Autoplay blocked — user needs to click
                });
            });

            this.hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
                if (this.destroyed) return;

                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            // Try to recover from network error
                            console.warn('HLS network error, attempting recovery...');
                            this.hls?.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.warn('HLS media error, attempting recovery...');
                            this.hls?.recoverMediaError();
                            break;
                        default:
                            // Unrecoverable error
                            console.error('HLS fatal error:', data);
                            this.options.onError?.('Stream playback failed. The stream may be offline.');
                            this.destroy();
                            break;
                    }
                }
            });

        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.video.src = hlsUrl;
            this.video.addEventListener('loadedmetadata', () => {
                this.video?.play().catch(() => {});
            });
        } else {
            this.options.onError?.('HLS video playback is not supported in this browser.');
            return;
        }

        // Playing callback
        this.video.addEventListener('playing', () => {
            if (!this.destroyed) {
                this.options.onPlaying?.();
            }
        });

        // Append to container
        this.container.appendChild(this.video);
    }

    /** Stop playback and remove all resources. */
    destroy(): void {
        this.destroyed = true;
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.video) {
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
            if (this.video.parentNode) {
                this.video.parentNode.removeChild(this.video);
            }
            this.video = null;
        }
    }

    /** Check if the player is still active. */
    isActive(): boolean {
        return !this.destroyed && this.video !== null;
    }
}
