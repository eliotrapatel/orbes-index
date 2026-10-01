/**
 * Two-factor enrolment (RFC 6238 TOTP). Reached voluntarily from the
 * sidebar, or forced when the server enforces admin MFA and this admin has
 * not enrolled yet (every other route answers 403 MFA_REQUIRED until then).
 *
 * The secret is shown once, grouped for manual entry, together with the
 * otpauth:// URI for authenticator apps that accept a pasted link. It only
 * becomes active once a code generated from it is confirmed; the server then
 * replaces the session by a new MFA-passed one (new CSRF token).
 *
 * ADMINs also see the console users and can reset the second factor of an
 * admin who lost the device (typed confirmation; audited; that admin's
 * sessions end and they enrol again at next sign-in).
 */
import { bracket } from '../../shared/corners.js';
import { h, mount } from '../../shared/dom.js';
import { ApiError, type AdminApi } from '../api.js';
import { formatDate, groupChars } from '../format.js';
import { can } from '../model/permissions.js';
import { confirmationPhrase } from '../model/registry.js';
import type { AdminSession, AdminUser } from '../types.js';
import { busy, button, copyButton, defList, field, input, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';

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

  const users = can(session.admin.role, 'manageAdmins') ? consoleUsers(api, session) : null;

  return h(
    'div',
    { class: 'view view--security' },
    pageHeader({
      eyebrow: 'Account',
      title: 'Security',
      lead: opts.forced ? 'Two-factor authentication is required before the console can be used.' : 'Time-based one-time codes protect every console session.',
    }),
    h('div', { class: 'grid grid--split' }, section('Status', status), section('Authenticator', body)),
    users,
  );
}

/** ADMIN: console users with their second factor, and the reset for a lost authenticator. */
function consoleUsers(api: AdminApi, session: AdminSession): HTMLElement {
  const holder = h('div', { class: 'admins', data: { testid: 'admin-users' } }, h('p', { class: 'micro soft' }, 'Loading…'));
  const load = async () => {
    try {
      const list = await api.admins();
      mount(holder, usersTable(list.items));
    } catch (e) {
      mount(holder, h('p', { class: 'form-error', attrs: { role: 'alert' } }, e instanceof ApiError ? e.message : 'The console users could not be loaded.'));
    }
  };
  const usersTable = (items: AdminUser[]) =>
    table(
      [
        { label: 'Email', cell: (a) => a.email, kind: ['wide'] },
        { label: 'Role', cell: (a) => a.role, kind: ['nowrap'] },
        { label: 'Two-factor', cell: (a) => (a.totpEnabled ? statusMark('ENABLED', 'solid') : statusMark('NOT ENROLLED', 'outline')), kind: ['nowrap'] },
        { label: 'State', cell: (a) => (a.disabled ? statusMark('DISABLED', 'muted') : a.locked ? statusMark('LOCKED', 'alert') : statusMark('ACTIVE', 'solid')), kind: ['nowrap'] },
        { label: 'Since', cell: (a) => formatDate(a.createdAt), kind: ['nowrap'] },
        {
          label: 'Action',
          kind: ['actions'],
          cell: (a) =>
            a.totpEnabled
              ? button('Reset two-factor', {
                  kind: 'danger',
                  testId: 'reset-totp',
                  onClick: () =>
                    void openDialog({
                      title: 'Reset two-factor authentication',
                      eyebrow: a.email,
                      danger: true,
                      body: h(
                        'p',
                        { class: 'dialog__text' },
                        a.id === session.admin.id
                          ? 'Your authenticator is removed and every session of yours ends, this one included. Sign in again with your password and enrol a new device.'
                          : 'Only after an identity check. The authenticator is removed and every session of this admin ends; they enrol a new device at the next sign-in. The reset is recorded in the audit log.',
                      ),
                      phrase: confirmationPhrase('reset-totp', a.email),
                      confirmLabel: 'Reset two-factor',
                      submit: async () => {
                        await api.resetAdminTotp(a.id);
                      },
                    }).then((r) => {
                      if (!r) return;
                      notify(`Two-factor authentication reset for ${a.email}.`);
                      void load();
                    }, (e: unknown) => notifyError(e)),
                })
              : '—',
        },
      ],
      items,
      { empty: 'No console user.', caption: 'Console users' },
    );
  void load();
  return section('Console users', holder, { note: 'ADMIN only. Resetting a second factor ends that admin\'s sessions.' });
}
