/**
 * Sign-in: email + password, then the authenticator code when the account
 * has TOTP enrolled (the server answers 401 TOTP_REQUIRED). The password is
 * kept in memory only for the second step and cleared as soon as the
 * attempt ends.
 */
import { bracket, viewportCorners } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { ApiError, type AdminApi } from '../api.js';
import type { AdminSession } from '../types.js';
import { busy, button, field, input } from '../ui/components.js';

export function loginView(api: AdminApi, onSuccess: (s: AdminSession) => void, opts: { notice?: string } = {}): HTMLElement {
  const email = input('email', { type: 'email', autocomplete: 'username', maxlength: 254 });
  const password = input('password', { type: 'password', autocomplete: 'current-password', maxlength: 1024 });
  const totp = input('totp', { autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 8, mono: true, placeholder: '000 000' });
  const totpField = field('Authenticator code', totp, { hint: 'Six digits from your authenticator app.' });
  totpField.hidden = true;
  const error = h('p', { class: 'login__error', attrs: { role: 'alert', 'aria-live': 'assertive' } }, opts.notice ?? '');
  const submit = button('Sign in', { kind: 'primary', type: 'submit', testId: 'login-submit' });

  const form = h(
    'form',
    { class: 'login__form', attrs: { novalidate: true, 'data-testid': 'login-form' } },
    field('Email', email),
    field('Password', password),
    totpField,
    error,
    submit,
  );

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    error.textContent = '';
    if (!email.value.trim() || !password.value) {
      error.textContent = 'Enter your email and password.';
      return;
    }
    const code = totp.value.replace(/\s/g, '');
    if (!totpField.hidden && !/^\d{6,8}$/.test(code)) {
      error.textContent = 'Enter the six-digit code.';
      totp.focus();
      return;
    }
    void busy(submit, async () => {
      try {
        const session = await api.login(email.value.trim(), password.value, totpField.hidden ? undefined : code);
        password.value = '';
        totp.value = '';
        onSuccess(session);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'TOTP_REQUIRED') {
          totpField.hidden = false;
          email.readOnly = true;
          error.textContent = '';
          totp.focus();
          return;
        }
        totp.value = '';
        if (e instanceof ApiError && (e.code === 'INVALID_TOTP' || e.code === 'TOTP_CODE_INVALID')) {
          error.textContent = e.message;
          totp.focus();
          return;
        }
        password.value = '';
        error.textContent = e instanceof ApiError ? e.message : 'Sign-in failed.';
        password.focus();
      }
    }, 'Signing in…');
  });

  queueMicrotask(() => email.focus());

  return h(
    'div',
    { class: 'login' },
    viewportCorners(),
    h(
      'main',
      { class: 'login__main' },
      h('p', { class: 'wordmark login__wordmark' }, 'Orbes'),
      h('p', { class: 'login__subtitle' }, 'Genome console'),
      bracket(h('div', { class: 'login__card' }, h('h1', { class: 'login__title' }, 'Restricted access'), form)),
      h('p', { class: 'login__foot' }, 'Internal use only · All actions are recorded'),
    ),
    h('p', { class: 'login__place' }, 'Paris'),
  );
}
