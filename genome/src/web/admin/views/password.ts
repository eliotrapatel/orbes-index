/**
 * The signed-in admin's own password (A-02).
 *
 * - `openPasswordDialog`: CHANGE PASSWORD at the foot of the sidebar, beside
 *   SIGN OUT, for every role at any time.
 * - `passwordView`: the only screen of a staff account that signed in with
 *   the temporary password an ADMIN gave it; the server refuses everything
 *   else meanwhile (403 PASSWORD_CHANGE_REQUIRED). Then, when the server
 *   enforces MFA, the console moves on to the enrolment of a second factor.
 *
 * Either way the current session stays and every other session of the
 * account ends. A wrong current password answers 400 CURRENT_PASSWORD_INVALID
 * (never a 401, which would sign the console out) and counts as a failed
 * sign-in. The passwords live only in the form fields, which are dropped with
 * the dialog or the screen.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type AdminApi } from '../api.js';
import { newPasswordProblem } from '../model/team.js';
import type { AdminSession } from '../types.js';
import { busy, button, field, input, pageHeader, section } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';

const NEW_HINT = 'Twelve characters at least; a few unrelated words are easy to type and hard to guess.';

/** The voluntary change. Resolves true once the password has changed. */
export async function openPasswordDialog(api: AdminApi, session: AdminSession): Promise<boolean> {
  const r = await openDialog({
    title: 'Change password',
    eyebrow: session.admin.email,
    body: h('p', { class: 'dialog__text' }, 'This session stays open; every other session of your account ends.'),
    fields: [
      { name: 'currentPassword', label: 'Current password', kind: 'password', autocomplete: 'current-password', required: true },
      { name: 'newPassword', label: 'New password', kind: 'password', autocomplete: 'new-password', required: true, hint: NEW_HINT },
      { name: 'confirmPassword', label: 'New password again', kind: 'password', autocomplete: 'new-password', required: true },
    ],
    validate: (v) => newPasswordProblem(v.currentPassword, v.newPassword, v.confirmPassword),
    confirmLabel: 'Change password',
    submit: async (v) => {
      await api.changePassword(v.currentPassword, v.newPassword);
    },
  });
  return r !== null;
}

/** The forced change after a sign-in with a temporary password. */
export function passwordView(api: AdminApi, session: AdminSession, onChanged: () => void): HTMLElement {
  const current = input('currentPassword', { type: 'password', autocomplete: 'current-password', maxlength: 1024 });
  const next = input('newPassword', { type: 'password', autocomplete: 'new-password', maxlength: 1024 });
  const again = input('confirmPassword', { type: 'password', autocomplete: 'new-password', maxlength: 1024 });
  const error = h('p', { class: 'form-error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
  const save = button('Save password', { kind: 'primary', type: 'submit', testId: 'password-save' });
  const form = h(
    'form',
    { class: 'account-form', attrs: { novalidate: true, 'data-testid': 'password-form' } },
    // The account name for password managers, which file the new password under it.
    h('input', { attrs: { type: 'email', name: 'username', autocomplete: 'username', value: session.admin.email, hidden: true, readonly: true } }),
    // Compared exactly, unlike a claim code of the same look: a wrong try counts as a failed sign-in.
    field('Temporary password', current, { hint: 'The password you were given with this account, typed exactly as shown: capitals and dashes included.' }),
    field('New password', next, { hint: NEW_HINT }),
    field('New password again', again),
    error,
    save,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    error.textContent = '';
    const problem = newPasswordProblem(current.value, next.value, again.value);
    if (problem) {
      error.textContent = problem;
      return;
    }
    void busy(save, async () => {
      try {
        await api.changePassword(current.value, next.value);
        current.value = next.value = again.value = '';
        session.admin.passwordChangeRequired = false;
        onChanged();
      } catch (e) {
        error.textContent = e instanceof ApiError ? e.message : 'The password could not be changed.';
        if (e instanceof ApiError && e.code === 'CURRENT_PASSWORD_INVALID') current.focus();
      }
    }, 'Saving…');
  });
  queueMicrotask(() => current.focus());

  return h(
    'div',
    { class: 'view view--password' },
    pageHeader({
      eyebrow: 'Account',
      title: 'New password',
      lead: 'Your account was created with a temporary password. Choose your own before using the console.',
    }),
    section('Password', form),
  );
}
