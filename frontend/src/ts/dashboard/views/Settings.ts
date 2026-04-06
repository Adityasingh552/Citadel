/** Dashboard — Settings view: premium editorial layout with section icons,
 *  inline form groups, and refined notification channel configuration. */

import { api } from '../../api.js';
import type { AppSettings } from '../../types/index.js';
import { Toast } from '../../utils/toast.js';

/* ── Inline SVG icons for each section header ── */
const IC = {
  detection: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  notif:     `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`,
  system:    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  danger:    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  phone:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`,
  mail:      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  webhook:   `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
  telegram:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
};

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
    model_path: '',
    confidence_threshold: 0.7,
    detect_accidents: true,
  };

  const notifs = notifications || {
    twilio: { enabled_manual: false, enabled_cctv: false },
    email: { enabled: false, smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', from_address: '', to_addresses: [] },
    webhook: { enabled: false, url: '' },
    telegram: { enabled: false },
    cooldown_seconds: 300,
  };

  const confPct = Math.round(conf.confidence_threshold * 100);

  container.innerHTML = `
    <div class="stg">
      <!-- ─── Header bar ─── -->
      <div class="stg__header">
        <div>
          <h2 class="stg__heading">Settings</h2>
          <p class="stg__sub">Configure detection, notifications, and system parameters.</p>
        </div>
        <div class="stg__header-actions">
          <button class="stg__btn stg__btn--outline" id="reset-settings">Reset Defaults</button>
          <button class="stg__btn stg__btn--primary" id="save-settings">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save Changes
          </button>
        </div>
      </div>

      <!-- ─── Two-column grid ─── -->
      <div class="stg__grid">

        <!-- LEFT COLUMN -->
        <div class="stg__col">

          <!-- Detection Config -->
          <section class="stg__card">
            <div class="stg__card-header">
              <span class="stg__card-icon">${IC.detection}</span>
              <div>
                <h3 class="stg__card-title">Detection Engine</h3>
                <p class="stg__card-desc">AI model parameters and detection toggles</p>
              </div>
            </div>

            <div class="stg__field">
              <div class="stg__field-top">
                <label class="stg__label">Confidence Threshold</label>
                <span class="stg__badge" id="conf-value">${confPct}%</span>
              </div>
              <input type="range" class="stg__range" id="conf-slider"
                min="0" max="100" value="${confPct}" />
              <div class="stg__range-labels">
                <span>Low (0%)</span><span>High (100%)</span>
              </div>
            </div>

            <div class="stg__divider"></div>

            <div class="stg__toggle-row">
              <div>
                <div class="stg__label">Accident Detection</div>
                <div class="stg__hint">Detect traffic collisions in video feeds</div>
              </div>
              <label class="toggle">
                <input type="checkbox" id="toggle-accidents" ${conf.detect_accidents ? 'checked' : ''} />
                <span class="toggle__slider"></span>
              </label>
            </div>
          </section>

          <!-- System Information -->
          <section class="stg__card">
            <div class="stg__card-header">
              <span class="stg__card-icon">${IC.system}</span>
              <div>
                <h3 class="stg__card-title">System Information</h3>
                <p class="stg__card-desc">Runtime details and component status</p>
              </div>
            </div>

            <div class="stg__info-grid">
              <div class="stg__info-item">
                <span class="stg__info-label">Version</span>
                <span class="stg__info-value">1.0.0-alpha</span>
              </div>
              <div class="stg__info-item">
                <span class="stg__info-label">AI Model</span>
                <span class="stg__info-value stg__info-value--mono">YOLO26 (ONNX)</span>
              </div>
              <div class="stg__info-item">
                <span class="stg__info-label">Database</span>
                <span class="stg__info-value">SQLite</span>
              </div>
              <div class="stg__info-item">
                <span class="stg__info-label">Status</span>
                <span class="stg__info-value stg__info-value--online">
                  <span class="status-dot status-dot--online"></span>
                  Online
                </span>
              </div>
            </div>
          </section>

        </div>

        <!-- RIGHT COLUMN -->
        <div class="stg__col">

          <!-- Notification Channels -->
          <section class="stg__card">
            <div class="stg__card-header">
              <span class="stg__card-icon">${IC.notif}</span>
              <div>
                <h3 class="stg__card-title">Notification Channels</h3>
                <p class="stg__card-desc">Configure how alerts are dispatched</p>
              </div>
            </div>

            <!-- Cooldown -->
            <div class="stg__field">
              <label class="stg__label">Alert Cooldown</label>
              <div class="stg__inline">
                <input type="number" class="stg__input stg__input--sm" id="notif-cooldown"
                  value="${notifs.cooldown_seconds}" min="0" />
                <span class="stg__hint">seconds between duplicate alerts</span>
              </div>
            </div>

            <div class="stg__divider"></div>

            <!-- Twilio -->
            <div class="stg__channel">
              <div class="stg__channel-header">
                <span class="stg__channel-icon">${IC.phone}</span>
                <span class="stg__channel-name">Twilio Voice Alerts</span>
              </div>
              <div class="stg__toggle-row stg__toggle-row--compact">
                <span class="stg__label">Manual Trigger</span>
                <label class="toggle"><input type="checkbox" id="twilio-manual" ${notifs.twilio.enabled_manual ? 'checked' : ''} /><span class="toggle__slider"></span></label>
              </div>
              <div class="stg__toggle-row stg__toggle-row--compact">
                <span class="stg__label">CCTV Trigger</span>
                <label class="toggle"><input type="checkbox" id="twilio-cctv" ${notifs.twilio.enabled_cctv ? 'checked' : ''} /><span class="toggle__slider"></span></label>
              </div>
            </div>

            <div class="stg__divider"></div>

            <!-- Email -->
            <div class="stg__channel">
              <div class="stg__channel-header">
                <span class="stg__channel-icon">${IC.mail}</span>
                <span class="stg__channel-name">Email Alerts</span>
                <label class="toggle" style="margin-left:auto;"><input type="checkbox" id="email-enabled" ${notifs.email.enabled ? 'checked' : ''} /><span class="toggle__slider"></span></label>
              </div>

              <div class="stg__form-grid" id="email-fields">
                <div class="stg__form-row stg__form-row--full">
                  <label class="stg__micro-label">SMTP Host</label>
                  <input type="text" class="stg__input" id="email-host" placeholder="smtp.gmail.com" value="${notifs.email.smtp_host}" />
                </div>
                <div class="stg__form-row">
                  <label class="stg__micro-label">Port</label>
                  <input type="number" class="stg__input" id="email-port" value="${notifs.email.smtp_port}" />
                </div>
                <div class="stg__form-row">
                  <label class="stg__micro-label">Username</label>
                  <input type="text" class="stg__input" id="email-user" placeholder="user@example.com" value="${notifs.email.smtp_user}" />
                </div>
                <div class="stg__form-row stg__form-row--full">
                  <label class="stg__micro-label">Password</label>
                  <input type="password" class="stg__input" id="email-pass" placeholder="••••••••" value="${notifs.email.smtp_password}" />
                </div>
                <div class="stg__form-row">
                  <label class="stg__micro-label">From Address</label>
                  <input type="text" class="stg__input" id="email-from" placeholder="alerts@citadel.io" value="${notifs.email.from_address}" />
                </div>
                <div class="stg__form-row">
                  <label class="stg__micro-label">To Addresses</label>
                  <input type="text" class="stg__input" id="email-to" placeholder="a@b.com, c@d.com" value="${(notifs.email.to_addresses || []).join(', ')}" />
                </div>
              </div>
            </div>

            <div class="stg__divider"></div>

            <!-- Webhook -->
            <div class="stg__channel">
              <div class="stg__channel-header">
                <span class="stg__channel-icon">${IC.webhook}</span>
                <span class="stg__channel-name">Webhook</span>
                <label class="toggle" style="margin-left:auto;"><input type="checkbox" id="webhook-enabled" ${notifs.webhook.enabled ? 'checked' : ''} /><span class="toggle__slider"></span></label>
              </div>
              <div class="stg__form-row stg__form-row--full">
                <label class="stg__micro-label">POST URL</label>
                <input type="text" class="stg__input" id="webhook-url" placeholder="https://hooks.example.com/alert" value="${notifs.webhook.url}" />
              </div>
            </div>

            <div class="stg__divider"></div>

            <!-- Telegram -->
            <div class="stg__channel">
              <div class="stg__channel-header">
                <span class="stg__channel-icon">${IC.telegram}</span>
                <span class="stg__channel-name">Telegram Bot</span>
                <label class="toggle" style="margin-left:auto;"><input type="checkbox" id="telegram-enabled" ${notifs.telegram.enabled ? 'checked' : ''} /><span class="toggle__slider"></span></label>
              </div>
            </div>
          </section>

          <!-- Danger Zone -->
          <section class="stg__card stg__card--danger">
            <div class="stg__card-header">
              <span class="stg__card-icon stg__card-icon--danger">${IC.danger}</span>
              <div>
                <h3 class="stg__card-title stg__card-title--danger">Danger Zone</h3>
                <p class="stg__card-desc">Irreversible operations — proceed with caution</p>
              </div>
            </div>

            <div class="stg__toggle-row">
              <div>
                <div class="stg__label">Purge All Data</div>
                <div class="stg__hint">Permanently delete events, tickets, evidence, and uploads</div>
              </div>
              <button class="stg__btn stg__btn--danger" id="delete-all-data">Delete All</button>
            </div>
          </section>

        </div>
      </div>
    </div>
  `;

  /* ── Interactivity ── */

  // Confidence slider live update
  const slider = document.getElementById('conf-slider') as HTMLInputElement;
  const badge  = document.getElementById('conf-value')!;
  slider.addEventListener('input', () => { badge.textContent = slider.value + '%'; });

  // Save
  document.getElementById('save-settings')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-settings') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      await api.put('/settings', {
        confidence_threshold: parseInt(slider.value) / 100,
        detect_accidents: (document.getElementById('toggle-accidents') as HTMLInputElement).checked,
      });

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
          to_addresses: (document.getElementById('email-to') as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean),
        },
        webhook: {
          enabled: (document.getElementById('webhook-enabled') as HTMLInputElement).checked,
          url: (document.getElementById('webhook-url') as HTMLInputElement).value,
        },
        telegram: {
          enabled: (document.getElementById('telegram-enabled') as HTMLInputElement).checked,
        },
      });

      Toast.show('Settings saved successfully', 'success');
    } catch {
      Toast.show('Failed to save settings', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Changes`;
    }
  });

  // Reset
  document.getElementById('reset-settings')?.addEventListener('click', async () => {
    try {
      await api.put('/settings', {
        confidence_threshold: 0.7,
        detect_accidents: true,
      });
      renderSettings(container);
    } catch {
      Toast.show('Failed to reset settings', 'error');
    }
  });

  // Delete all data
  document.getElementById('delete-all-data')?.addEventListener('click', async () => {
    if (!confirm('WARNING: This will permanently delete ALL events, tickets, evidence images, and uploaded videos.\n\nAre you sure?')) return;

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
        'success', 5000,
      );
    } catch {
      Toast.show('Failed to delete data', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete All';
    }
  });
}
