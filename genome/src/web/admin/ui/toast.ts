/**
 * Transient notices (top right, polite live region). Errors stay until
 * dismissed; confirmations fade after a few seconds.
 */
import { h } from '../../shared/dom.js';
import { ApiError } from '../api.js';

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement {
  if (region && document.body.contains(region)) return region;
  region = h('div', { class: 'toasts', attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' } });
  document.body.appendChild(region);
  return region;
}

/** Show a notice; returns it, so a notice that stops being true can be taken down. */
export function notify(message: string, kind: 'ok' | 'error' = 'ok'): HTMLElement {
  const r = ensureRegion();
  const close = h('button', { class: 'toast__close', attrs: { type: 'button', 'aria-label': 'Dismiss' } }, '×');
  const t = h('div', { class: ['toast', `toast--${kind}`], attrs: { role: kind === 'error' ? 'alert' : 'status' } }, h('span', { class: 'toast__text' }, message), close);
  close.addEventListener('click', () => t.remove());
  r.appendChild(t);
  if (kind === 'ok') setTimeout(() => t.remove(), 4200);
  return t;
}

/** Notify an error from any failure; server messages are already public-safe. */
export function notifyError(e: unknown, fallback = 'The action could not be completed.'): void {
  notify(e instanceof ApiError ? e.message : fallback, 'error');
}
