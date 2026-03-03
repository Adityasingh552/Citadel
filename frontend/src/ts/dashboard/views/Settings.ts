/** Dashboard — Settings view with detection config and system info. */

import { api } from '../../api.js';
import type { AppSettings } from '../../types/index.js';

export async function renderSettings(container: HTMLElement): Promise<void> {
  let settings: AppSettings | null = null;

  try {
    settings = await api.get<AppSettings>('/settings');
  } catch {
    // Use defaults
  }

  const conf = settings || {
    model_name: 'hilmantm/detr-traffic-accident-detection',
    confidence_threshold: 0.7,
    detect_accidents: true,
    detect_vehicles: true,
    frame_interval: 30,
  };

  container.innerHTML = `
    <div class="settings-sections">
      <!-- Detection Configuration -->
      <div class="settings-section">
        <h3 class="settings-section__title">Detection Configuration</h3>
        <div class="settings-row">
          <div>
            <div class="settings-row__label">Confidence Threshold</div>
            <div class="settings-row__desc">Minimum detection confidence (0–100%)</div>
          </div>
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <input type="range" class="settings-slider" id="conf-slider"
              min="0" max="100" value="${Math.round(conf.confidence_threshold * 100)}" />
            <span id="conf-value" style="font-weight: 600; width: 40px; text-align: right;">
              ${Math.round(conf.confidence_threshold * 100)}%
            </span>
          </div>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row__label">Frame Interval</div>
            <div class="settings-row__desc">Process every Nth frame</div>
          </div>
          <div style="display: flex; align-items: center; gap: var(--space-3);">
            <input type="range" class="settings-slider" id="frame-slider"
              min="1" max="120" value="${conf.frame_interval}" />
            <span id="frame-value" style="font-weight: 600; width: 40px; text-align: right;">
              ${conf.frame_interval}
            </span>
          </div>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row__label">Accident Detection</div>
            <div class="settings-row__desc">Detect traffic accidents</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="toggle-accidents" ${conf.detect_accidents ? 'checked' : ''} />
            <span class="toggle__slider"></span>
          </label>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row__label">Vehicle Detection</div>
            <div class="settings-row__desc">Detect vehicles in scene</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="toggle-vehicles" ${conf.detect_vehicles ? 'checked' : ''} />
            <span class="toggle__slider"></span>
          </label>
        </div>
      </div>

      <!-- System Information -->
      <div class="settings-section">
        <h3 class="settings-section__title">System Information</h3>
        <div class="settings-row">
          <div class="settings-row__label">Version</div>
          <div class="settings-row__value">1.0.0-alpha</div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label">AI Model</div>
          <div class="settings-row__value">${conf.model_name.split('/').pop()}</div>
        </div>

        <div class="settings-row">
          <div class="settings-row__label">Database</div>
          <div class="settings-row__value">SQLite</div>
        </div>
        <div class="settings-row">
          <div class="settings-row__label">System Status</div>
          <div class="settings-row__value">
            <span class="status-dot status-dot--online"></span> Online
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="settings-section" style="border-color: var(--danger);">
        <h3 class="settings-section__title" style="color: var(--danger);">Danger Zone</h3>
        <div class="settings-row">
          <div>
            <div class="settings-row__label">Delete All Data</div>
            <div class="settings-row__desc">Permanently removes all events, tickets, evidence images, and uploaded videos</div>
          </div>
          <button class="btn btn--danger" id="delete-all-data">Delete All</button>
        </div>
      </div>

      <!-- Actions -->
      <div class="settings-actions">
        <button class="btn btn--primary" id="save-settings">Save Changes</button>
        <button class="btn btn--outline" id="reset-settings">Reset to Defaults</button>
      </div>
    </div>
  `;

  // Slider live updates
  const confSlider = document.getElementById('conf-slider') as HTMLInputElement;
  const confValue = document.getElementById('conf-value')!;
  confSlider.addEventListener('input', () => {
    confValue.textContent = confSlider.value + '%';
  });

  const frameSlider = document.getElementById('frame-slider') as HTMLInputElement;
  const frameValue = document.getElementById('frame-value')!;
  frameSlider.addEventListener('input', () => {
    frameValue.textContent = frameSlider.value;
  });

  // Save
  document.getElementById('save-settings')?.addEventListener('click', async () => {
    const accidents = (document.getElementById('toggle-accidents') as HTMLInputElement).checked;
    const vehicles = (document.getElementById('toggle-vehicles') as HTMLInputElement).checked;

    try {
      await api.put('/settings', {
        confidence_threshold: parseInt(confSlider.value) / 100,
        frame_interval: parseInt(frameSlider.value),
        detect_accidents: accidents,
        detect_vehicles: vehicles,
      });
      alert('Settings saved!');
    } catch (err) {
      alert('Failed to save settings');
    }
  });

  // Reset
  document.getElementById('reset-settings')?.addEventListener('click', async () => {
    try {
      await api.put('/settings', {
        confidence_threshold: 0.7,
        frame_interval: 30,
        detect_accidents: true,
        detect_vehicles: true,
      });
      renderSettings(container);
    } catch {
      alert('Failed to reset');
    }
  });

  // Delete all data
  document.getElementById('delete-all-data')?.addEventListener('click', async () => {
    if (!confirm('WARNING: This will permanently delete ALL events, tickets, evidence images, and uploaded videos.\n\nAre you sure?')) {
      return;
    }

    const btn = document.getElementById('delete-all-data') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    try {
      const res = await fetch('/api/settings/data', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const d = data.deleted;
      alert(`Deleted: ${d.events} events, ${d.tickets} tickets, ${d.evidence_files} evidence files, ${d.upload_files} uploads`);
    } catch {
      alert('Failed to delete data');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete All';
    }
  });
}
