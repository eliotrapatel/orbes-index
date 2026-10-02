/**
 * Owners: customer accounts with their current and lifetime product counts.
 *
 * ORBES Client Services, as an ADMIN, issues a client who forgot the
 * password a one-time recovery code from the account's row (C-04), after an
 * identity check: the code is shown once, above the table, until it is
 * hidden; only its hash is kept. The client enters it on /verify (FORGOTTEN
 * PASSWORD?) with a new password: every session of the account then ends,
 * pending transfers are cancelled and new ones are paused for 72 hours,
 * which the account's status line says, as it says while a code is open.
 */
import { bracket } from '../../shared/corners.js';
import { h, mount } from '../../shared/dom.js';
import { formatCount, formatDate, formatDateTime, humanize, shortHash } from '../format.js';
import { can } from '../model/permissions.js';
import type { OwnerRecord, RecoveryCode } from '../types.js';
import { button, copyButton, mono, pageHeader, pager, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function ownersView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.owners(pageParam(ctx), 50);
  const canRecover = can(ctx.session.admin.role, 'issueRecoveryCode');
  // The one place a recovery code appears, once.
  const slot = h('div', { class: 'owners__recovery' });

  const issue = (o: OwnerRecord) => {
    let issued: RecoveryCode | null = null;
    void openDialog({
      title: 'Issue a recovery code',
      eyebrow: o.email,
      body: [
        h('p', { class: 'dialog__text' }, 'Only after checking the identity of the client. The code is shown once, works once and expires after 30 minutes; a code issued before stops working.'),
        h(
          'p',
          { class: 'dialog__text' },
          'When the client uses it on /verify with a new password, every session of the account ends, its pending transfers are cancelled and new transfers are paused for 72 hours. The issue is recorded in the audit log.',
        ),
      ],
      confirmLabel: 'Issue code',
      submit: async () => {
        issued = await ctx.api.issueRecoveryCode(o.id);
      },
    }).then(
      (r) => {
        if (!r || !issued) return;
        mount(slot, recoveryPanel(o, issued, () => ctx.reload()));
        slot.scrollIntoView?.({ block: 'start' });
      },
      (e: unknown) => notifyError(e),
    );
  };

  const columns: Column<OwnerRecord>[] = [
    { label: 'Account', cell: (o) => h('span', null, o.email, o.displayName ? h('span', { class: 'cell-sub' }, o.displayName) : null), kind: ['wide'] },
    { label: 'Status', cell: (o) => statusCell(o), kind: ['nowrap'] },
    { label: 'Country', cell: (o) => o.country ?? '—', kind: ['nowrap'] },
    { label: 'Products', cell: (o) => formatCount(o.products), kind: ['num'] },
    { label: 'Ever owned', cell: (o) => formatCount(o.productsEver), kind: ['num'] },
    { label: 'Since', cell: (o) => formatDate(o.createdAt), kind: ['nowrap'] },
    { label: 'Id', cell: (o) => mono(o.id, shortHash(o.id, 8, 4)), kind: ['nowrap'] },
  ];
  if (canRecover) {
    columns.push({
      label: 'Action',
      kind: ['actions'],
      cell: (o) => (o.status === 'ACTIVE' ? button('Recovery code', { kind: 'ghost', testId: 'issue-recovery-code', onClick: () => issue(o) }) : '—'),
    });
  }

  return h(
    'div',
    { class: 'view view--owners' },
    pageHeader({
      eyebrow: 'Clients',
      title: 'Owners',
      lead: canRecover
        ? 'Registered client accounts. Ownership never changes a product’s cryptographic identity. A client who forgot the password receives a one-time recovery code, after an identity check.'
        : 'Registered client accounts. Ownership never changes a product’s cryptographic identity.',
    }),
    slot,
    table(columns, list.items, { empty: 'No client account yet.', caption: 'Owners' }),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}

/** The account's status, then what a recovery left: an open code, or transfers paused until a date. */
function statusCell(o: OwnerRecord): HTMLElement {
  return h(
    'span',
    { data: { testid: 'owner-status' } },
    statusMark(humanize(o.status), o.status === 'ACTIVE' ? 'solid' : 'alert'),
    o.recoveryCodeExpiresAt ? h('span', { class: 'cell-sub' }, `Recovery code open until ${formatDateTime(o.recoveryCodeExpiresAt)}`) : null,
    o.transfersPausedUntil ? h('span', { class: 'cell-sub' }, `Transfers paused until ${formatDateTime(o.transfersPausedUntil)}`) : null,
  );
}

/** The code, once: copied or read to the client, then hidden (the console keeps no other copy). */
function recoveryPanel(o: OwnerRecord, r: RecoveryCode, onHidden: () => void): HTMLElement {
  const text = h('p', { class: 'claim__code mono', data: { testid: 'recovery-code' } }, r.recoveryCode);
  const copy = copyButton(r.recoveryCode, 'Copy');
  const hide = button('Given to the client — hide', {
    kind: 'ghost',
    testId: 'hide-recovery-code',
    onClick: () => {
      text.textContent = '•••• - •••• - ••••';
      panel.classList.add('is-hidden');
      hide.remove();
      copy.remove();
      onHidden();
    },
  });
  const panel = bracket(
    h(
      'section',
      { class: 'claim claim--recovery', attrs: { 'aria-label': 'One-time recovery code' } },
      h('p', { class: 'claim__label' }, 'Recovery code · shown once'),
      text,
      h(
        'p',
        { class: 'claim__note' },
        `For ${o.email}, valid once until ${formatDateTime(r.expiresAt)}. Read it to the client, who enters it on /verify under FORGOTTEN PASSWORD? with a new password. Only its hash is stored: it cannot be shown again.`,
      ),
      h('div', { class: 'claim__tools' }, copy, hide),
    ),
  );
  return panel;
}
