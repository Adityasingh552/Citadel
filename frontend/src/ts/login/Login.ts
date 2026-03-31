/** Citadel — Login page renderer. */

import { api } from '../api.js';

export function renderLogin(container: HTMLElement): void {
    container.innerHTML = `
    <div class="login">
      <!-- Side labels -->
      <div class="login-side-label">PLATFORM PROTOCOL 8.42</div>

      <div class="login-card">
        <div class="login-card__logo">CITADEL</div>
        <h2 class="login-card__title">Access the Platform</h2>
        <p class="login-card__subtitle">Enter your credentials to monitor real-time safety.</p>

        <div class="login-error" id="login-error"></div>

        <form class="login-form" id="login-form">
          <div class="login-field">
            <label class="login-field__label" for="login-username">Email Address</label>
            <input
              class="login-field__input"
              type="text"
              id="login-username"
              name="username"
              placeholder="operator@citadel.ai"
              autocomplete="username"
              required
            />
          </div>
          <div class="login-field">
            <div class="login-field__header">
                <label class="login-field__label" for="login-password">Password</label>
                <a href="#/forgot-password" class="login-field__link">Forgot Password?</a>
            </div>
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

        <div class="login-footer-link">
            Don't have access? <a href="#/request-access" class="login-link">Request Access</a>
        </div>
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

        const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
        const password = (document.getElementById('login-password') as HTMLInputElement).value;

        if (!username || !password) return;

        // Clear previous error
        errorEl.classList.remove('login-error--visible');
        errorEl.textContent = '';

        // Disable button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
            await api.login(username, password);
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
