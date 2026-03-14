/** Dashboard — Manual Feed view with interactive video player and detection.
 *
 * Uses global processing state so the user can navigate away
 * and come back to see the ongoing/completed processing status.
 */

import { api } from '../../api.js';
import type { VideoProcessingResult } from '../../types/index.js';
import { getActiveJob, setActiveJob, onJobChange } from '../../state.js';

let _unsubscribe: (() => void) | null = null;

export function renderLiveFeed(container: HTMLElement): void {
  // Clean up previous listener
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  container.innerHTML = `
    <div class="feed-layout">
      <!-- Video Area -->
      <div>
        <div class="feed-video" id="video-container">
          <div class="empty-state" style="height: 100%; color: white;">
            <div class="empty-state__icon"></div>
            <div class="empty-state__title" style="color: white;">No Active Feed</div>
            <div class="empty-state__desc" style="color: rgba(255,255,255,0.6);">
              Upload a video or images to analyze
            </div>
          </div>
        </div>
        <div class="feed-controls">
          <input type="file" id="video-upload" accept="video/*" style="display:none" />
          <input type="file" id="image-upload" accept="image/*" multiple style="display:none" />
          <button class="btn btn--primary" id="upload-btn">Upload Video</button>
          <button class="btn btn--outline" id="upload-images-btn">Upload Images</button>
          <button class="btn btn--primary" id="process-btn" style="display:none;">Analyze</button>
          <span id="upload-status" style="font-size: var(--text-sm); color: var(--text-muted); flex:1; text-align:center;"></span>
        </div>
        <!-- Progress Bar -->
        <div class="progress-bar-wrapper" id="progress-wrapper" style="display:none;">
          <div class="progress-bar">
            <div class="progress-bar__fill" id="progress-fill" style="width: 0%;"></div>
          </div>
          <span class="progress-bar__text" id="progress-text">0%</span>
        </div>
      </div>

      <!-- Detection Panel -->
      <div class="detection-panel">
        <div class="detection-panel__header">
          <span class="card__title">Detected Objects</span>
          <span class="badge badge--vehicle" id="detection-count">0</span>
        </div>
        <div id="detection-list">
          <div class="empty-state" style="padding: var(--space-8);">
            <div class="empty-state__icon"></div>
            <div class="empty-state__title">No detections</div>
            <div class="empty-state__desc">Upload and analyze a video first</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Processing Progress -->
    <div id="processing-result" style="margin-top: var(--space-6);"></div>
  `;

  const fileInput = document.getElementById('video-upload') as HTMLInputElement;
  const imageInput = document.getElementById('image-upload') as HTMLInputElement;
  const uploadBtn = document.getElementById('upload-btn')!;
  const uploadImagesBtn = document.getElementById('upload-images-btn')!;
  const processBtn = document.getElementById('process-btn')!;
  const statusEl = document.getElementById('upload-status')!;
  const progressWrapper = document.getElementById('progress-wrapper')!;
  const progressFill = document.getElementById('progress-fill')!;
  const progressText = document.getElementById('progress-text')!;
  let selectedFile: File | null = null;
  let _progressPollTimer: ReturnType<typeof setInterval> | null = null;

  // Restore state if there's an active or completed job
  const existingJob = getActiveJob();
  if (existingJob) {
    restoreJobUI(existingJob, statusEl, processBtn);
  }

  // Listen for job updates (fires if processing finishes while we're on this page)
  _unsubscribe = onJobChange((job) => {
    if (job) restoreJobUI(job, statusEl, processBtn);
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  uploadImagesBtn.addEventListener('click', () => imageInput.click());

  // Video: User selects a file → show video player immediately
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    selectedFile = file;
    showVideoPlayer(file);
    processBtn.style.display = '';
    statusEl.textContent = `Loaded: ${file.name} — click Analyze to process`;
  });

  // Images: User selects multiple images → process one-by-one with progress
  imageInput.addEventListener('change', async () => {
    const files = imageInput.files;
    if (!files || !files.length) return;
    const fileList = Array.from(files);

    // Show image thumbnails in the video area
    const videoContainer = document.getElementById('video-container')!;
    videoContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; padding: 12px; height: 100%; overflow-y: auto; align-content: start;">
        ${fileList.map(f => `
          <div style="border-radius: var(--radius-md); overflow: hidden; border: 1px solid rgba(255,255,255,0.1); aspect-ratio: 1;">
            <img src="${URL.createObjectURL(f)}" alt="${f.name}"
              style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
        `).join('')}
      </div>
      <div class="feed-video__live-badge">
        <span class="feed-video__live-dot" style="background: var(--warning);"></span>
        ${fileList.length} IMAGES
      </div>
    `;

    statusEl.textContent = `Processing ${fileList.length} images...`;
    uploadImagesBtn.setAttribute('disabled', 'true');
    uploadImagesBtn.textContent = 'Processing...';
    showProgress(0);

    try {
      interface BatchResult {
        images_processed: number;
        images_skipped: number;
        total_events: number;
        total_tickets: number;
        results: Array<{
          filename: string;
          status: string;
          reason?: string;
          detections: Array<{ label: string; confidence: number; severity: string }>;
        }>;
      }

      const result = await api.uploadMultiple<BatchResult>('/detect/images', fileList);

      showProgress(100);
      statusEl.textContent = `Done — ${result.images_processed} images processed — ${result.total_events} events, ${result.total_tickets} tickets`;

      // Update badge
      const badge = document.querySelector('.feed-video__live-badge');
      if (badge) {
        badge.innerHTML = `<span class="feed-video__live-dot"></span> PROCESSED`;
      }

      // Show batch results in detection panel
      renderBatchDetections(result);

      // Hide progress bar after delay
      setTimeout(() => hideProgress(), 2000);
    } catch (err) {
      statusEl.textContent = `Error: ${err instanceof Error ? err.message : 'Batch processing failed'}`;
      hideProgress();
    } finally {
      uploadImagesBtn.removeAttribute('disabled');
      uploadImagesBtn.textContent = 'Upload Images';
    }
  });

  // Video: User clicks Analyze → send to backend with progress polling
  processBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    const file = selectedFile;

    // Generate a job_id so we can poll progress immediately
    const jobId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    setActiveJob({ fileName: file.name, startedAt: Date.now(), status: 'processing' });
    statusEl.textContent = `Analyzing ${file.name}...`;
    processBtn.setAttribute('disabled', 'true');
    processBtn.textContent = 'Analyzing...';
    showProgress(0);

    // Start polling for progress right away
    _progressPollTimer = setInterval(async () => {
      try {
        const prog = await api.get<{ percent: number; status: string; current: number; total: number }>(
          `/detect/progress/${jobId}`
        );
        if (prog.status === 'processing' || prog.status === 'done') {
          showProgress(prog.percent);
          statusEl.textContent = `Analyzing ${file.name}... ${prog.percent}% (${prog.current}/${prog.total} frames)`;
        }
      } catch { /* ignore poll errors */ }
    }, 800);

    try {
      // Upload with job_id param so backend uses same ID for progress tracking
      const result = await api.upload<VideoProcessingResult>('/detect/video', file, { job_id: jobId });

      // Stop polling
      if (_progressPollTimer) { clearInterval(_progressPollTimer); _progressPollTimer = null; }

      showProgress(100);
      setTimeout(() => hideProgress(), 2000);

      setActiveJob({ fileName: file.name, startedAt: Date.now(), status: 'done', result });
    } catch (err) {
      if (_progressPollTimer) { clearInterval(_progressPollTimer); _progressPollTimer = null; }
      hideProgress();
      const msg = err instanceof Error ? err.message : 'Processing failed';
      setActiveJob({ fileName: file.name, startedAt: Date.now(), status: 'error', error: msg });
    }
  });

  // --- Progress bar helpers ---
  function showProgress(percent: number) {
    progressWrapper.style.display = '';
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${Math.round(percent)}%`;
  }

  function hideProgress() {
    progressWrapper.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
  }
}

function showVideoPlayer(file: File): void {
  const videoContainer = document.getElementById('video-container');
  if (!videoContainer) return;
  const videoUrl = URL.createObjectURL(file);
  videoContainer.innerHTML = `
    <div class="feed-video__live-badge">
      <span class="feed-video__live-dot" style="background: var(--warning);"></span> READY
    </div>
    <video
      src="${videoUrl}"
      controls
      style="width:100%; height:100%; object-fit:contain; background:#000; border-radius: var(--radius-md);"
      id="video-player"
    ></video>
  `;
}

function restoreJobUI(
  job: ReturnType<typeof getActiveJob>,
  statusEl: HTMLElement,
  processBtn: HTMLElement,
): void {
  if (!job) return;

  if (job.status === 'processing') {
    const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
    statusEl.textContent = `Analyzing ${job.fileName}... (${elapsed}s elapsed — you can navigate freely)`;
    processBtn.style.display = '';
    processBtn.setAttribute('disabled', 'true');
    processBtn.textContent = 'Analyzing...';

    // Update badge
    const badge = document.querySelector('.feed-video__live-badge');
    if (badge) {
      badge.innerHTML = `<span class="feed-video__live-dot" style="background: var(--warning);"></span> PROCESSING`;
    }
  } else if (job.status === 'done' && job.result) {
    statusEl.textContent = `Done — ${job.result.events_created} events, ${job.result.tickets_created} tickets`;
    processBtn.style.display = '';
    processBtn.removeAttribute('disabled');
    processBtn.textContent = 'Analyze';
    renderDetections(job.result);

    const badge = document.querySelector('.feed-video__live-badge');
    if (badge) {
      badge.innerHTML = `<span class="feed-video__live-dot"></span> PROCESSED`;
    }
  } else if (job.status === 'error') {
    statusEl.textContent = `Error: ${job.error}`;
    processBtn.style.display = '';
    processBtn.removeAttribute('disabled');
    processBtn.textContent = 'Analyze';
  }
}

function renderDetections(result: VideoProcessingResult): void {
  const listEl = document.getElementById('detection-list');
  const countEl = document.getElementById('detection-count');
  const resultEl = document.getElementById('processing-result');

  if (countEl) countEl.textContent = String(result.detections.length);

  if (listEl) {
    if (!result.detections.length) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding: var(--space-8);">
          <div class="empty-state__icon"></div>
          <div class="empty-state__title">No incidents detected</div>
          <div class="empty-state__desc">Video processed — no accidents found</div>
        </div>
      `;
    } else {
      listEl.innerHTML = result.detections.map(d => `
        <div class="detection-item">
          <span class="detection-item__label">
            ${d.label}
          </span>
          <span class="detection-item__confidence">${(d.confidence * 100).toFixed(1)}%</span>
          <div class="detection-item__bar">
            <div class="detection-item__bar-fill" style="width: ${d.confidence * 100}%"></div>
          </div>
        </div>
      `).join('');
    }
  }

  if (resultEl) {
    resultEl.innerHTML = `
      <div class="card">
        <div class="card__header">
          <span class="card__title">Processing Summary</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); text-align: center;">
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800;">${result.total_frames}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Total Frames</div>
          </div>
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800;">${result.frames_processed}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Processed</div>
          </div>
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800; color: var(--danger);">${result.events_created}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Events</div>
          </div>
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800; color: var(--warning);">${result.tickets_created}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Tickets</div>
          </div>
        </div>
      </div>
    `;
  }
}

function renderBatchDetections(result: {
  images_processed: number;
  images_skipped: number;
  total_events: number;
  total_tickets: number;
  results: Array<{
    filename: string;
    status: string;
    reason?: string;
    detections: Array<{ label: string; confidence: number; severity: string }>;
  }>;
}): void {
  const listEl = document.getElementById('detection-list');
  const countEl = document.getElementById('detection-count');
  const resultEl = document.getElementById('processing-result');

  const totalDetections = result.results.reduce((sum, r) => sum + r.detections.length, 0);
  if (countEl) countEl.textContent = String(totalDetections);

  if (listEl) {
    if (!totalDetections) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding: var(--space-8);">
          <div class="empty-state__icon"></div>
          <div class="empty-state__title">No incidents detected</div>
          <div class="empty-state__desc">${result.images_processed} images processed — no accidents found</div>
        </div>
      `;
    } else {
      listEl.innerHTML = result.results
        .filter(r => r.detections.length > 0)
        .map(r => `
          <div style="padding: var(--space-3); border-bottom: 1px solid var(--card-border);">
            <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-2);">
              ${r.filename}
            </div>
            ${r.detections.map(d => `
              <div class="detection-item">
                <span class="detection-item__label">
                  ${d.label}
                </span>
                <span class="detection-item__confidence">${(d.confidence * 100).toFixed(1)}%</span>
                <div class="detection-item__bar">
                  <div class="detection-item__bar-fill" style="width: ${d.confidence * 100}%"></div>
                </div>
              </div>
            `).join('')}
          </div>
        `).join('');
    }
  }

  if (resultEl) {
    resultEl.innerHTML = `
      <div class="card">
        <div class="card__header">
          <span class="card__title">Batch Processing Summary</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); text-align: center;">
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800;">${result.images_processed}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Processed</div>
          </div>
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800; color: var(--text-muted);">${result.images_skipped}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Skipped</div>
          </div>
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800; color: var(--danger);">${result.total_events}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Events</div>
          </div>
          <div>
            <div style="font-size: var(--text-2xl); font-weight: 800; color: var(--warning);">${result.total_tickets}</div>
            <div style="font-size: var(--text-xs); color: var(--text-muted);">Tickets</div>
          </div>
        </div>
      </div>
    `;
  }
}
