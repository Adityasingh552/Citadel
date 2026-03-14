/** Citadel — Toast notification utility. */

type ToastType = 'success' | 'error' | 'info';

const ICONS: Record<ToastType, string> = {
  success: '&#10003;',
  error: '&#10005;',
  info: '&#8505;',
};

function getContainer(): HTMLElement {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export const Toast = {
  show(message: string, type: ToastType = 'info', duration = 3500): void {
    const container = getContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
      <span class="toast__icon" aria-hidden="true">${ICONS[type]}</span>
      <span class="toast__message">${message}</span>
    `;

    container.appendChild(toast);

    // Auto-remove after duration with fade-out animation
    const remove = () => {
      toast.classList.add('toast--out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = setTimeout(remove, duration);

    // Clicking the toast dismisses it immediately
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    }, { once: true });
  },
};
