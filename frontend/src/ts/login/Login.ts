/** Citadel — Login page renderer. */

import { api } from '../api.js';

export function renderLogin(container: HTMLElement): void {
    container.innerHTML = `
    <div class="login">
      <div class="login-card">
        <div class="login-card__logo">
          <div class="login-card__logo-text">Citadel</div>
        </div>
        <p class="login-card__subtitle">Admin Authentication Required</p>

        <div class="login-error" id="login-error"></div>

        <form class="login-form" id="login-form">
          <div class="login-field">
            <label class="login-field__label" for="login-username">Username</label>
            <input
              class="login-field__input"
              type="text"
              id="login-username"
              name="username"
              placeholder="Enter username"
              autocomplete="username"
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
              placeholder="Enter password"
              autocomplete="current-password"
              required
            />
          </div>
          <button type="submit" class="login-submit" id="login-submit">
            Sign In
          </button>
        </form>
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
