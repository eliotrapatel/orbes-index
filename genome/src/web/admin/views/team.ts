/**
 * Team (ADMIN, A-02): the console users and what an ADMIN does to them when
 * someone joins, changes post or leaves.
 *
 * - NEW STAFF ACCOUNT: an OPERATOR, AUDITOR, RETAIL (a seller, who gets
 *   the sale mode only, A-08) or LOGISTICS (a person at the logistics agent,
 *   with the locations it works at, plan NEXT LOT §3.5.4.5) with a temporary password,
 *   shown once on an ivory, bracketed panel (BRAND §6, secrets are shown
 *   once) with COPY and "I have handed it over — hide". The staff member signs
 *   in with it and must choose their own password before anything else.
 * - Per row: change the role (and a LOGISTICS login's locations), disable (a departure: sign-in refused, every
 *   session ends at once) or enable, lift a lockout, see and end the
 *   sessions, reset a lost second factor (typed confirmation).
 *
 * Nothing is offered on one's own row but the reset of one's own second
 * factor (the server answers 409 SELF_ACTION), and ADMIN accounts and the
 * ADMIN role are left to the shell (scripts/admin.ts), where the second
 * factor is enrolled out of band (SECURITY-MODEL §3.3). Every change is
 * recorded in the audit log, with the acting ADMIN's email.
 */
import { bracket } from '../../shared/corners.js';
import { h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatDate, formatDateTime, humanize } from '../format.js';
import { confirmationPhrase } from '../model/registry.js';
import { adminState, deviceLabel, initialLocations, locationNames, locationsProblem, ROLE_HINT, teamActions } from '../model/team.js';
import { STAFF_ROLES, type AdminSessionInfo, type AdminUser, type StaffRole, type StockLocation } from '../types.js';
import { button, copyButton, pageHeader, section, statusMark, table } from '../ui/components.js';
import { checkedOf, openDialog, type DialogField } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: humanize(r) }));

export async function teamView(ctx: ViewContext): Promise<HTMLElement> {
  const [list, locations] = await Promise.all([ctx.api.admins(), ctx.api.locations().then((r) => r.items as StockLocation[])]);
  /** A LOGISTICS login's locations (plan NEXT LOT §3.5.4.5): shown for that role only, at least one. */
  const locationsField = (a: AdminUser | null): DialogField => ({
    name: 'locations',
    label: 'Locations',
    kind: 'checklist',
    required: true,
    options: locations.map((l) => ({ value: l.id, label: l.name })),
    value: initialLocations(a, locations).join(','),
    hint: 'Where this person works: the stock, the receptions and the orders to ship of these locations only.',
    shown: (v) => v.role === 'LOGISTICS',
  });
  const selfId = ctx.session.admin.id;
  // No live region here: a screen reader would read the secret aloud the moment it appears. A toast
  // says, without it, that the panel is there (as the generator's claim-code panel, read on demand).
  const secret = h('div', { class: 'team__secret' });

  const create = button('New staff account', { kind: 'primary', testId: 'team-create' });
  create.addEventListener('click', () => {
    let created: { email: string; temporaryPassword: string } | null = null;
    void openDialog({
      title: 'New staff account',
      body: h(
        'p',
        { class: 'dialog__text' },
        'The account receives a temporary password, shown once on this page. Hand it over in person or over a trusted channel: at the first sign-in it must be replaced. ADMIN accounts are created from the shell.',
      ),
      fields: [
        { name: 'email', label: 'Email', kind: 'email', required: true },
        { name: 'role', label: 'Role', kind: 'select', required: true, options: ROLE_OPTIONS, value: 'OPERATOR', hint: ROLE_HINT },
        locationsField(null),
      ],
      validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) ? locationsProblem(v.role, checkedOf(v, 'locations')) : 'Enter a valid email address.'),
      confirmLabel: 'Create account',
      submit: async (v) => {
        const r = await ctx.api.createStaff(v.email.trim(), v.role as StaffRole, checkedOf(v, 'locations'));
        created = { email: r.admin.email, temporaryPassword: r.temporaryPassword };
      },
    }).then((r) => {
      if (!r || !created) return;
      showTemporaryPassword(created.email, created.temporaryPassword);
      notify(`Account created for ${created.email}. Its temporary password is shown below, once.`);
      void refresh();
    });
  });

  /** The temporary password, once: it lives only in this panel until hidden or the page changes. */
  function showTemporaryPassword(email: string, password: string): void {
    const code = h('p', { class: 'claim__code mono', data: { testid: 'temporary-password' } }, password);
    const copy = copyButton(password, 'Copy');
    const hide = button('I have handed it over — hide', {
      kind: 'ghost',
      testId: 'temporary-password-hide',
      onClick: () => mount(secret),
    });
    mount(
      secret,
      bracket(
        h(
          'section',
          { class: 'claim', attrs: { 'aria-label': 'Temporary password' } },
          h('p', { class: 'claim__label' }, 'Temporary password · shown once'),
          code,
          h('p', { class: 'claim__note' }, `For ${email}. Typed exactly as shown, capitals and dashes included, it signs in only to choose a new password, until replaced. Only its scrypt hash is stored; it cannot be displayed again.`),
          h('div', { class: 'claim__tools' }, copy, hide),
        ),
      ),
    );
  }

  const holder = h('div', { class: 'team', data: { testid: 'admin-users' } });
  const refresh = async () => {
    try {
      mount(holder, usersTable((await ctx.api.admins()).items));
    } catch (e) {
      mount(holder, h('p', { class: 'form-error', attrs: { role: 'alert' } }, e instanceof ApiError ? e.message : 'The console users could not be loaded.'));
    }
  };

  /** Run a row action through a dialog, then say what happened and reload the table. */
  const act = (p: Promise<unknown>, done: string) =>
    p.then(
      (r) => {
        if (!r) return;
        notify(done);
        void refresh();
      },
      (e: unknown) => notifyError(e),
    );

  function rowActions(a: AdminUser): HTMLElement | string {
    const can = teamActions(a, selfId);
    const buttons: HTMLElement[] = [];
    if (can.role) {
      buttons.push(
        button('Role', {
          kind: 'ghost',
          testId: 'team-role',
          onClick: () =>
            void act(
              openDialog({
                title: 'Change the role',
                eyebrow: a.email,
                body: h(
                  'p',
                  { class: 'dialog__text' },
                  a.role === 'ADMIN'
                    ? 'This account stops being an ADMIN at its next request. The last active ADMIN cannot step down; the ADMIN role is given back from the shell only.'
                    : 'The new role applies at the next request of this account. The ADMIN role is given from the shell only.',
                ),
                fields: [{ name: 'role', label: 'Role', kind: 'select', required: true, options: ROLE_OPTIONS, value: a.role === 'ADMIN' ? 'OPERATOR' : a.role, hint: ROLE_HINT }, locationsField(a)],
                validate: (v) => locationsProblem(v.role, checkedOf(v, 'locations')),
                confirmLabel: 'Change role',
                submit: async (v) => {
                  await ctx.api.setAdminRole(a.id, v.role as StaffRole, checkedOf(v, 'locations'));
                },
              }),
              `Role changed for ${a.email}.`,
            ),
        }),
      );
    }
    if (can.unlock) {
      buttons.push(
        button('Unlock', {
          kind: 'ghost',
          testId: 'team-unlock',
          onClick: () =>
            void act(
              openDialog({
                title: 'Lift the lockout',
                eyebrow: a.email,
                body: h('p', { class: 'dialog__text' }, 'The account was locked after repeated failed sign-ins. Unlock it only once you know who was trying: the failed attempts are in the audit log.'),
                confirmLabel: 'Unlock',
                submit: async () => {
                  await ctx.api.unlockAdmin(a.id);
                },
              }),
              `${a.email} can sign in again.`,
            ),
        }),
      );
    }
    if (can.sessions) buttons.push(button('Sessions', { kind: 'ghost', testId: 'team-sessions', onClick: () => void openSessions(a) }));
    if (can.disable) {
      buttons.push(
        button('Disable', {
          kind: 'danger',
          testId: 'team-disable',
          onClick: () =>
            void act(
              openDialog({
                title: 'Disable the account',
                eyebrow: a.email,
                danger: true,
                body: h('p', { class: 'dialog__text' }, 'For a departure. Sign-in is refused and every session of this account ends at once. The account and its history stay; it can be enabled again.'),
                confirmLabel: 'Disable',
                submit: async () => {
                  await ctx.api.disableAdmin(a.id);
                },
              }),
              `${a.email} is disabled; their sessions have ended.`,
            ),
        }),
      );
    }
    if (can.enable) {
      buttons.push(
        button('Enable', {
          kind: 'ghost',
          testId: 'team-enable',
          onClick: () =>
            void act(
              openDialog({
                title: 'Enable the account',
                eyebrow: a.email,
                body: h('p', { class: 'dialog__text' }, 'The account can sign in again with its password, in its current role.'),
                confirmLabel: 'Enable',
                submit: async () => {
                  await ctx.api.enableAdmin(a.id);
                },
              }),
              `${a.email} can sign in again.`,
            ),
        }),
      );
    }
    if (can.resetTotp) {
      buttons.push(
        button('Reset two-factor', {
          kind: 'danger',
          testId: 'reset-totp',
          onClick: () =>
            void act(
              openDialog({
                title: 'Reset two-factor authentication',
                eyebrow: a.email,
                danger: true,
                body: h(
                  'p',
                  { class: 'dialog__text' },
                  a.id === selfId
                    ? 'Your authenticator is removed and every session of yours ends, this one included. Sign in again with your password and enrol a new device.'
                    : 'Only after an identity check. The authenticator is removed and every session of this admin ends; they enrol a new device at the next sign-in. The reset is recorded in the audit log.',
                ),
                phrase: confirmationPhrase('reset-totp', a.email),
                confirmLabel: 'Reset two-factor',
                submit: async () => {
                  await ctx.api.resetAdminTotp(a.id);
                },
              }),
              `Two-factor authentication reset for ${a.email}.`,
            ),
        }),
      );
    }
    return buttons.length ? h('span', { class: 'team__actions' }, ...buttons) : '—';
  }

  async function openSessions(a: AdminUser): Promise<void> {
    let items: AdminSessionInfo[];
    try {
      items = (await ctx.api.adminSessions(a.id)).items;
    } catch (e) {
      notifyError(e, 'The sessions could not be loaded.');
      return;
    }
    // Two columns: the dialog is 540 px wide.
    const body = table(
      [
        {
          label: 'Device',
          cell: (s) =>
            h(
              'span',
              { attrs: { title: s.userAgent ?? '' } },
              deviceLabel(s.userAgent),
              h('span', { class: 'cell-sub' }, `Signed in ${formatDateTime(s.createdAt)} · ${s.mfaPassed ? 'two-factor passed' : 'password only'}`),
            ),
          kind: ['wide'],
        },
        { label: 'Last seen', cell: (s) => formatDateTime(s.lastSeenAt), kind: ['nowrap'] },
      ],
      items,
      { empty: 'No session open.', caption: `Sessions of ${a.email}` },
    );
    await act(
      openDialog({
        title: 'Sessions',
        eyebrow: a.email,
        danger: items.length > 0,
        body: [body, h('p', { class: 'dialog__text' }, items.length ? 'Ending them signs this account out everywhere; its password still works.' : 'Nothing to end.')],
        confirmLabel: items.length ? 'End all sessions' : 'Close',
        submit: async () => {
          if (items.length) await ctx.api.revokeAdminSessions(a.id);
        },
      }).then((r) => (r && items.length ? r : null)),
      `Every session of ${a.email} has ended.`,
    );
  }

  const usersTable = (items: AdminUser[]) =>
    table(
      [
        { label: 'Email', cell: (a) => h('span', null, a.email, a.id === selfId ? h('span', { class: 'cell-sub' }, 'You') : null), kind: ['wide'] },
        { label: 'Role', cell: (a) => (a.role === 'LOGISTICS' ? h('span', null, a.role, h('span', { class: 'cell-sub' }, locationNames(a, locations))) : a.role), kind: ['nowrap'] },
        { label: 'Two-factor', cell: (a) => (a.totpEnabled ? statusMark('ENABLED', 'solid') : statusMark('NOT ENROLLED', 'outline')), kind: ['nowrap'] },
        {
          label: 'State',
          cell: (a) => {
            const st = adminState(a);
            return statusMark(st.label, st.tone);
          },
          kind: ['nowrap'],
        },
        { label: 'Since', cell: (a) => formatDate(a.createdAt), kind: ['nowrap'] },
        { label: 'Actions', cell: rowActions, kind: ['actions'] },
      ],
      items,
      { empty: 'No console user.', caption: 'Console users' },
    );

  mount(holder, usersTable(list.items));

  return h(
    'div',
    { class: 'view view--team' },
    pageHeader({
      eyebrow: 'Security',
      title: 'Team',
      lead: 'Console accounts: create staff accounts, change roles, disable a departing account, lift a lockout, end sessions. ADMIN accounts and the ADMIN role come from the shell.',
      actions: [create],
    }),
    secret,
    section('Console users', holder, { note: 'Every change is recorded in the audit log' }),
  );
}
