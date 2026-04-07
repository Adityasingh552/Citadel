/** Citadel — Login page renderer with Supabase auth. */

import { api } from '../api.js';

export function renderLogin(container: HTMLElement): void {
    container.innerHTML = `
    <div class="login">
      <!-- Side labels -->
      <div class="login-side-label">PLATFORM PROTOCOL 8.42</div>

      <div class="login-card">
        <div class="login-card__logo brand-logo">CITADEL</div>
        <h2 class="login-card__title">Access the Platform</h2>
        <p class="login-card__subtitle">Enter your credentials to monitor real-time safety.</p>

        <div class="login-error" id="login-error"></div>

        <form class="login-form" id="login-form">
          <div class="login-field">
            <label class="login-field__label" for="login-email">Email Address</label>
            <input
              class="login-field__input"
              type="email"
              id="login-email"
              name="email"
              placeholder="operator@citadel.ai"
              autocomplete="email"
              required
            />
          </div>
          <div class="login-field">
            <label class="login-field__label" for="login-password">Password</label>
            <input
              class="login-field__input"
              type="password"
              id="login-password"
              name="password"
              placeholder="••••••••••••"
              autocomplete="current-password"
              required
            />
          </div>
          <button type="submit" class="login-submit" id="login-submit">
            Sign In
          </button>
        </form>
      </div>

      <!-- Footer indicators -->
      <div class="login-footer">
          <div class="login-footer__status">
              <div class="login-footer__item">
                  <span class="indicator indicator--active">●</span> SYSTEM ACTIVE
              </div>
              <div class="login-footer__divider">|</div>
              <div class="login-footer__item">
                  <span class="indicator">⬡</span> ENCRYPTED NODE
              </div>
          </div>
          <div class="login-copyright">© 2024 CITADEL SAFETY</div>
      </div>
    </div>
  `;

    const form = document.getElementById('login-form') as HTMLFormElement;
    const errorEl = document.getElementById('login-error')!;
    const submitBtn = document.getElementById('login-submit') as HTMLButtonElement;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = (document.getElementById('login-email') as HTMLInputElement).value.trim();
        const password = (document.getElementById('login-password') as HTMLInputElement).value;

        if (!email || !password) return;

        // Clear previous error
        errorEl.classList.remove('login-error--visible');
        errorEl.textContent = '';

        // Disable button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
            await api.login(email, password);
            // Small delay to ensure session is fully established
            await new Promise(resolve => setTimeout(resolve, 100));
            window.location.hash = '#/dashboard';
        } catch (err) {
            errorEl.textContent = err instanceof Error ? err.message : 'Login failed';
            errorEl.classList.add('login-error--visible');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    });
}
