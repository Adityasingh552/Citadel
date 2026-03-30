/** Dashboard — Settings view with detection config and system info. */

import { api } from '../../api.js';
import type { AppSettings } from '../../types/index.js';
import { Toast } from '../../utils/toast.js';

export async function renderSettings(container: HTMLElement): Promise<void> {
  let settings: AppSettings | null = null;
  let notifications: any = null;

  try {
    settings = await api.get<AppSettings>('/settings');
    notifications = await api.get<any>('/settings/notifications');
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

  const notifs = notifications || {
      twilio: { enabled_manual: false, enabled_cctv: false },
      email: { enabled: false, smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', from_address: '', to_addresses: [] },
      webhook: { enabled: false, url: '' },
      cooldown_seconds: 300,
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

      <!-- Notification Channels -->
      <div class="settings-section">
        <h3 class="settings-section__title">Notification Channels</h3>
        
        <div class="settings-row">
           <div>
             <div class="settings-row__label">Alert Cooldown (Seconds)</div>
             <div class="settings-row__desc">Time to wait before sending duplicate alerts</div>
           </div>
           <input type="number" id="notif-cooldown" class="input" style="width:100px;" value="${notifs.cooldown_seconds}" />
        </div>

        <h4 style="margin: var(--space-4) 0 var(--space-2); color: var(--text-main);">📞 Twilio Voice Alerts</h4>
        <div class="settings-row">
           <span>Manual Trigger</span>
           <label class="toggle"><input type="checkbox" id="twilio-manual" ${notifs.twilio.enabled_manual ? 'checked' : ''} /><span class="toggle__slider"></span></label>
        </div>
        <div class="settings-row">
           <span>CCTV Trigger</span>
           <label class="toggle"><input type="checkbox" id="twilio-cctv" ${notifs.twilio.enabled_cctv ? 'checked' : ''} /><span class="toggle__slider"></span></label>
        </div>

        <h4 style="margin: var(--space-4) 0 var(--space-2); color: var(--text-main);">✉️ Email Alerts</h4>
        <div class="settings-row">
           <span>Enable Email</span>
           <label class="toggle"><input type="checkbox" id="email-enabled" ${notifs.email.enabled ? 'checked' : ''} /><span class="toggle__slider"></span></label>
        </div>
        <div class="settings-row" style="display:flex; flex-direction:column; gap:8px;">
           <input type="text" id="email-host" class="input" placeholder="SMTP Host (e.g. smtp.gmail.com)" value="${notifs.email.smtp_host}" />
           <div style="display:flex; gap:8px;">
               <input type="number" id="email-port" class="input" placeholder="Port" value="${notifs.email.smtp_port}" style="width:100px;" />
               <input type="text" id="email-user" class="input" placeholder="SMTP User" value="${notifs.email.smtp_user}" style="flex:1;" />
               <input type="password" id="email-pass" class="input" placeholder="SMTP Password" value="${notifs.email.smtp_password}" style="flex:1;" />
           </div>
           <div style="display:flex; gap:8px;">
               <input type="text" id="email-from" class="input" placeholder="From Address" value="${notifs.email.from_address}" style="flex:1;" />
               <input type="text" id="email-to" class="input" placeholder="To Addresses (comma separated)" value="${(notifs.email.to_addresses || []).join(', ')}" style="flex:2;" />
           </div>
        </div>

        <h4 style="margin: var(--space-4) 0 var(--space-2); color: var(--text-main);">🔗 Webhook Alerts</h4>
        <div class="settings-row">
           <span>Enable Webhook</span>
           <label class="toggle"><input type="checkbox" id="webhook-enabled" ${notifs.webhook.enabled ? 'checked' : ''} /><span class="toggle__slider"></span></label>
        </div>
        <div class="settings-row">
           <input type="text" id="webhook-url" class="input" style="width:100%;" placeholder="Webhook POST URL" value="${notifs.webhook.url}" />
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

      // Save notification settings
      await api.put('/settings/notifications', {
         cooldown_seconds: parseInt((document.getElementById('notif-cooldown') as HTMLInputElement).value) || 300,
         twilio: {
             enabled_manual: (document.getElementById('twilio-manual') as HTMLInputElement).checked,
             enabled_cctv: (document.getElementById('twilio-cctv') as HTMLInputElement).checked,
         },
         email: {
             enabled: (document.getElementById('email-enabled') as HTMLInputElement).checked,
             smtp_host: (document.getElementById('email-host') as HTMLInputElement).value,
             smtp_port: parseInt((document.getElementById('email-port') as HTMLInputElement).value) || 587,
             smtp_user: (document.getElementById('email-user') as HTMLInputElement).value,
             smtp_password: (document.getElementById('email-pass') as HTMLInputElement).value,
             from_address: (document.getElementById('email-from') as HTMLInputElement).value,
             to_addresses: (document.getElementById('email-to') as HTMLInputElement).value.split(',').map(s=>s.trim()).filter(Boolean),
         },
         webhook: {
             enabled: (document.getElementById('webhook-enabled') as HTMLInputElement).checked,
             url: (document.getElementById('webhook-url') as HTMLInputElement).value,
         }
      });

      Toast.show('Settings saved successfully', 'success');
    } catch (err) {
      Toast.show('Failed to save settings', 'error');
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
      Toast.show('Failed to reset settings', 'error');
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
      const token = localStorage.getItem('citadel_token');
      const res = await fetch('/api/settings/data', {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const d = data.deleted;
      Toast.show(
        `Deleted: ${d.events} events, ${d.tickets} tickets, ${d.evidence_files} evidence files, ${d.upload_files} uploads`,
        'success',
        5000,
      );
    } catch {
      Toast.show('Failed to delete data', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete All';
    }
  });
}
