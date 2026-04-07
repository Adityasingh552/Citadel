/** Dashboard — Manual Feed view with centered drag & drop and auto-analyze.
 *
 * Files are analyzed automatically on drop. Results shown below with thumbnails.
 */

import { api } from '../../api.js';
import type { VideoProcessingResult } from '../../types/index.js';
import { getActiveJob, setActiveJob, onJobChange } from '../../state.js';

let _unsubscribe: (() => void) | null = null;

interface FileItem {
  file: File;
  id: string;
  type: 'video' | 'image';
  previewUrl: string;
}

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

interface UnifiedResult {
  fileName: string;
  fileType: 'video' | 'image';
  status: 'processed' | 'skipped' | 'error';
  reason?: string;
  detections: Array<{ label: string; confidence: number; severity: string }>;
  events: number;
  tickets: number;
  previewUrl?: string;
}

export function renderLiveFeed(container: HTMLElement): void {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  container.innerHTML = `
    <div class="feed-layout--single">
      <div id="drop-zone-area"></div>
      <div class="progress-bar-wrapper" id="progress-wrapper" style="display:none;">
        <div class="progress-bar">
          <div class="progress-bar__fill" id="progress-fill" style="width: 0%;"></div>
        </div>
        <span class="progress-bar__text" id="progress-text">0%</span>
      </div>
      <div id="status-text" style="font-size: var(--text-sm); color: var(--text-muted); text-align: center; margin-top: var(--space-3);"></div>
      <div id="results-area"></div>
    </div>
  `;

  const dropZoneArea = document.getElementById('drop-zone-area')!;
  const progressWrapper = document.getElementById('progress-wrapper')!;
  const progressFill = document.getElementById('progress-fill')!;
  const progressText = document.getElementById('progress-text')!;
  const statusText = document.getElementById('status-text')!;
  const resultsArea = document.getElementById('results-area')!;

  const existingJob = getActiveJob();
  if (existingJob && existingJob.status === 'done' && existingJob.result) {
    renderResultsFromVideoResult(existingJob.result);
  }

  _unsubscribe = onJobChange((job) => {
    if (job?.status === 'done' && job.result) {
      renderResultsFromVideoResult(job.result);
    }
  });

  renderDropZone(dropZoneArea);
  setupDropZone(dropZoneArea, progressWrapper, progressFill, progressText, statusText, resultsArea);
}

function renderDropZone(area: HTMLElement): void {
  area.innerHTML = `
    <div class="drop-zone" id="drop-zone">
      <svg class="drop-zone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <div class="drop-zone__text">Drop video or image files here</div>
      <div class="drop-zone__hint">or click to browse — supports MP4, AVI, MOV, JPG, PNG, WebP</div>
    </div>
  `;
}

function setupDropZone(
  area: HTMLElement,
  progressWrapper: HTMLElement,
  progressFill: HTMLElement,
  progressText: HTMLElement,
  statusText: HTMLElement,
  resultsArea: HTMLElement,
): void {
  const dropZone = document.getElementById('drop-zone')!;
  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'file';
  hiddenInput.multiple = true;
  hiddenInput.accept = 'video/*,image/*';
  hiddenInput.style.display = 'none';
  document.body.appendChild(hiddenInput);

  dropZone.addEventListener('click', () => hiddenInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (!e.dataTransfer) return;
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles, progressWrapper, progressFill, progressText, statusText, resultsArea, dropZone);
  });

  hiddenInput.addEventListener('change', () => {
    const pickedFiles = Array.from(hiddenInput.files || []);
    handleFiles(pickedFiles, progressWrapper, progressFill, progressText, statusText, resultsArea, dropZone);
    hiddenInput.value = '';
  });
}

function handleFiles(
  newFiles: File[],
  progressWrapper: HTMLElement,
  progressFill: HTMLElement,
  progressText: HTMLElement,
  statusText: HTMLElement,
  resultsArea: HTMLElement,
  dropZone: HTMLElement,
): void {
  const fileItems: FileItem[] = [];
  for (const file of newFiles) {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (isVideo || isImage) {
      fileItems.push({
        file,
        id: crypto.randomUUID(),
        type: isVideo ? 'video' : 'image',
        previewUrl: URL.createObjectURL(file),
      });
    }
  }

  if (!fileItems.length) return;

  dropZone.innerHTML = `
    <div class="file-preview-grid">
      ${fileItems.map(f => {
        if (f.type === 'image') {
          return `
            <div class="file-preview-item">
              <img class="file-preview-item__thumb" src="${f.previewUrl}" alt="${f.file.name}" />
              <div class="file-preview-item__name" title="${f.file.name}">${f.file.name}</div>
            </div>
          `;
        }
        return `
          <div class="file-preview-item file-preview-item--video">
            <svg class="file-preview-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <div class="file-preview-item__name" title="${f.file.name}">${f.file.name}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  dropZone.style.cursor = 'default';
  dropZone.onclick = null;

  processAllFiles(fileItems, progressWrapper, progressFill, progressText, statusText, resultsArea);
}

async function processAllFiles(
  files: FileItem[],
  progressWrapper: HTMLElement,
  progressFill: HTMLElement,
  progressText: HTMLElement,
  statusText: HTMLElement,
  resultsArea: HTMLElement,
): Promise<void> {
  const imageFiles = files.filter(f => f.type === 'image');
  const videoFiles = files.filter(f => f.type === 'video');
  const totalTasks = (imageFiles.length > 0 ? 1 : 0) + videoFiles.length;
  let completedTasks = 0;

  const unifiedResults: UnifiedResult[] = [];

  showProgress(progressWrapper, progressFill, progressText, 0);

  try {
    if (imageFiles.length > 0) {
      statusText.textContent = `Processing ${imageFiles.length} image(s)...`;
      try {
        const result = await api.uploadMultiple<BatchResult>('/detect/images', imageFiles.map(f => f.file));
        completedTasks++;
        showProgress(progressWrapper, progressFill, progressText, (completedTasks / totalTasks) * 100);

        for (const r of result.results) {
          const imgFile = imageFiles.find(f => f.file.name === r.filename);
          unifiedResults.push({
            fileName: r.filename,
            fileType: 'image',
            status: r.status as UnifiedResult['status'],
            reason: r.reason,
            detections: r.detections,
            events: r.status === 'processed' ? r.detections.length : 0,
            tickets: r.status === 'processed' ? r.detections.filter(d => d.label === 'accident').length : 0,
            previewUrl: imgFile?.previewUrl,
          });
        }
      } catch (err) {
        unifiedResults.push({
          fileName: `${imageFiles.length} images`,
          fileType: 'image',
          status: 'error',
          reason: err instanceof Error ? err.message : 'Batch processing failed',
          detections: [],
          events: 0,
          tickets: 0,
        });
        completedTasks++;
      }
    }

    for (const vf of videoFiles) {
      statusText.textContent = `Processing video: ${vf.file.name}...`;
      const jobId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

      const pollTimer = setInterval(async () => {
        try {
          const prog = await api.get<{ percent: number; status: string }>(`/detect/progress/${jobId}`);
          if (prog.status === 'processing' || prog.status === 'done') {
            const basePercent = (completedTasks / totalTasks) * 100;
            const videoPercent = (prog.percent / 100) * (100 / totalTasks);
            showProgress(progressWrapper, progressFill, progressText, basePercent + videoPercent);
          }
        } catch { /* ignore */ }
      }, 800);

      try {
        const result = await api.upload<VideoProcessingResult>('/detect/video', vf.file, { job_id: jobId });
        clearInterval(pollTimer);
        completedTasks++;
        showProgress(progressWrapper, progressFill, progressText, (completedTasks / totalTasks) * 100);

        unifiedResults.push({
          fileName: vf.file.name,
          fileType: 'video',
          status: 'processed',
          detections: result.detections.map(d => ({ label: d.label, confidence: d.confidence, severity: 'medium' })),
          events: result.events_created,
          tickets: result.tickets_created,
          previewUrl: vf.previewUrl,
        });

        setActiveJob({ fileName: vf.file.name, startedAt: Date.now(), status: 'done', result });
      } catch (err) {
        clearInterval(pollTimer);
        completedTasks++;
        unifiedResults.push({
          fileName: vf.file.name,
          fileType: 'video',
          status: 'error',
          reason: err instanceof Error ? err.message : 'Processing failed',
          detections: [],
          events: 0,
          tickets: 0,
        });
      }
    }

    showProgress(progressWrapper, progressFill, progressText, 100);
    statusText.textContent = `Done — ${unifiedResults.filter(r => r.status === 'processed').length} file(s) processed`;
    renderResultsWithThumbnails(unifiedResults, resultsArea);

    // Invalidate dashboard summary caches so Overview/Incidents reflect
    // newly created events and tickets on next navigation.
    api.invalidateViewCaches();

    setTimeout(() => hideProgress(progressWrapper, progressFill, progressText), 2000);
  } finally {
    statusText.textContent = `Done — ${unifiedResults.filter(r => r.status === 'processed').length} file(s) processed`;
  }
}

function renderResultsWithThumbnails(results: UnifiedResult[], area: HTMLElement): void {
  const totalEvents = results.reduce((sum, r) => sum + r.events, 0);
  const totalTickets = results.reduce((sum, r) => sum + r.tickets, 0);
  const totalDetections = results.reduce((sum, r) => sum + r.detections.length, 0);
  const processedCount = results.filter(r => r.status === 'processed').length;

  area.innerHTML = `
    <div class="results-summary">
      <div class="results-summary__stats">
        <div class="summary-stat">
          <div class="summary-stat__value">${processedCount}</div>
          <div class="summary-stat__label">Files Processed</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat__value" style="color: var(--accent-text);">${totalDetections}</div>
          <div class="summary-stat__label">Detections</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat__value" style="color: var(--danger-text);">${totalEvents}</div>
          <div class="summary-stat__label">Events</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat__value" style="color: var(--warning);">${totalTickets}</div>
          <div class="summary-stat__label">Tickets</div>
        </div>
      </div>
    </div>

    ${results.length > 0 ? `
      <div class="results-cards">
        ${results.map(r => `
          <div class="result-card">
            ${r.previewUrl && r.fileType === 'image' ? `
              <div class="result-card__thumb">
                <img src="${r.previewUrl}" alt="${r.fileName}" />
              </div>
            ` : r.previewUrl && r.fileType === 'video' ? `
              <div class="result-card__thumb result-card__thumb--video">
                <video src="${r.previewUrl}" muted style="width:100%;height:100%;object-fit:cover;"></video>
                <div class="result-card__thumb-overlay">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                </div>
              </div>
            ` : `
              <div class="result-card__thumb result-card__thumb--placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
                </svg>
              </div>
            `}
            <div class="result-card__info">
              <div class="result-card__name" title="${r.fileName}">${r.fileName}</div>
              <div class="result-card__status result-card__status--${r.status}">${r.status}</div>
              ${r.detections.length > 0 ? `
                <div class="result-card__detections">
                  ${r.detections.map(d => `
                    <span class="result-card__tag">
                      <span class="result-card__tag-label">${d.label}</span>
                      <span class="result-card__tag-confidence">${(d.confidence * 100).toFixed(0)}%</span>
                    </span>
                  `).join('')}
                </div>
              ` : r.status === 'processed' ? `
                <div class="result-card__no-detections">No incidents detected</div>
              ` : ''}
              ${r.reason ? `<div class="result-card__reason">${r.reason}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function renderResultsFromVideoResult(result: VideoProcessingResult): void {
  const resultsArea = document.getElementById('results-area');
  if (!resultsArea) return;

  const unified: UnifiedResult[] = [{
    fileName: result.video_name,
    fileType: 'video',
    status: 'processed',
    detections: result.detections.map(d => ({ label: d.label, confidence: d.confidence, severity: 'medium' })),
    events: result.events_created,
    tickets: result.tickets_created,
  }];

  renderResultsWithThumbnails(unified, resultsArea);
}

function showProgress(wrapper: HTMLElement, fill: HTMLElement, text: HTMLElement, percent: number): void {
  wrapper.style.display = '';
  fill.style.width = `${percent}%`;
  text.textContent = `${Math.round(percent)}%`;
}

function hideProgress(wrapper: HTMLElement, fill: HTMLElement, text: HTMLElement): void {
  wrapper.style.display = 'none';
  fill.style.width = '0%';
  text.textContent = '0%';
}
