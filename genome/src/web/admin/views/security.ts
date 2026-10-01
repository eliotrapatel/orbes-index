/**
 * Two-factor enrolment (RFC 6238 TOTP). Reached voluntarily from the
 * sidebar, or forced when the server enforces admin MFA and this admin has
 * not enrolled yet (every other route answers 403 MFA_REQUIRED until then).
 *
 * The secret is shown once, grouped for manual entry, together with the
 * otpauth:// URI for authenticator apps that accept a pasted link. It only
 * becomes active once a code generated from it is confirmed.
 */
import { bracket } from '../../shared/corners.js';
import { h, mount } from '../../shared/dom.js';
import { ApiError, type AdminApi } from '../api.js';
import { groupChars } from '../format.js';
import type { AdminSession } from '../types.js';
import { busy, button, copyButton, defList, field, input, pageHeader, section, statusMark } from '../ui/components.js';

export function securityView(api: AdminApi, session: AdminSession, onEnrolled: () => void, opts: { forced?: boolean } = {}): HTMLElement {
  const body = h('div', { class: 'enrol' });
  const status = defList([
    { label: 'Account', value: session.admin.email },
    { label: 'Role', value: session.admin.role },
    { label: 'Two-factor', value: session.admin.totpEnabled ? statusMark('ENABLED', 'solid') : statusMark('NOT ENROLLED', 'alert') },
    { label: 'Policy', value: session.mfaRequired ? 'REQUIRED FOR CONSOLE ACCESS' : 'RECOMMENDED' },
  ]);

  if (session.admin.totpEnabled) {
    // The server refuses a second enrolment (TOTP_ALREADY_ENABLED): replacing a lost device is an identity-checked reset.
    mount(
      body,
      h('p', { class: 'prose' }, 'An authenticator is enrolled for this account. If the device is lost, ask another ADMIN to reset two-factor authentication after an identity check; codes cannot be re-enrolled from here.'),
    );
  } else {
    const start = button('Begin enrolment', { kind: 'primary', testId: 'totp-begin' });
    start.addEventListener('click', () => {
      void busy(start, async () => {
        try {
          const e = await api.totpSetup();
          showSecret(e.secret, e.otpauthUri);
        } catch (err) {
          mount(body, h('p', { class: 'form-error', attrs: { role: 'alert' } }, err instanceof ApiError ? err.message : 'Enrolment is unavailable.'));
        }
      });
    });
    mount(body, start);
  }

  function showSecret(secret: string, uri: string) {
    const code = input('code', { inputmode: 'numeric', maxlength: 8, mono: true, autocomplete: 'one-time-code', placeholder: '000 000' });
    const error = h('p', { class: 'form-error', attrs: { role: 'alert' } });
    const confirm = button('Confirm and enable', { kind: 'primary', type: 'submit', testId: 'totp-confirm' });
    const form = h('form', { class: 'enrol__form', attrs: { novalidate: true } }, field('Code from the app', code, { hint: 'Enter the current six-digit code to activate.' }), error, confirm);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const c = code.value.replace(/\s/g, '');
      if (!/^\d{6,8}$/.test(c)) {
        error.textContent = 'Enter the six-digit code.';
        return;
      }
      void busy(confirm, async () => {
        try {
          await api.totpEnable(secret, c);
          session.admin.totpEnabled = true;
          session.mfaPassed = true;
          onEnrolled();
        } catch (err) {
          error.textContent = err instanceof ApiError ? err.message : 'The code could not be verified.';
        }
      });
    });
    mount(
      body,
      bracket(
        h(
          'div',
          { class: 'enrol__secret' },
          h('p', { class: 'enrol__step' }, '1 · Add to your authenticator'),
          h('p', { class: 'enrol__code mono', data: { testid: 'totp-secret' } }, groupChars(secret, 4)),
          h('div', { class: 'enrol__tools' }, copyButton(secret, 'Copy secret'), copyButton(uri, 'Copy otpauth link')),
          h('p', { class: 'enrol__note' }, 'Shown once. Do not store it anywhere else; it is encrypted on the server.'),
        ),
      ),
      h('p', { class: 'enrol__step' }, '2 · Confirm'),
      form,
    );
    code.focus();
  }

  return h(
    'div',
    { class: 'view view--security' },
    pageHeader({
      eyebrow: 'Account',
      title: 'Security',
      lead: opts.forced ? 'Two-factor authentication is required before the console can be used.' : 'Time-based one-time codes protect every console session.',
    }),
    h('div', { class: 'grid grid--split' }, section('Status', status), section('Authenticator', body)),
  );
}
