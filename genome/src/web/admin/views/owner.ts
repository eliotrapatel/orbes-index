/**
 * An owner's sheet (A-06): what ORBES Client Services needs while a client
 * is on the line. The account and its status, its tier in the club (P-X04:
 * TITANE, PLATINE or PALLADIUM, the pieces it counts and the full years since
 * its first ownership), the pieces it owns and owned,
 * its transfers in progress and its 20 latest scans, each linked to its
 * piece and its verification event.
 *
 * ADMIN actions, each recorded in the audit log:
 *   - Recovery code: the one-time code of C-04 (views/owners.ts
 *     `issueRecoveryCode`), shown once above the sheet;
 *   - Lock account / Unlock account: a locked client cannot sign in or use a
 *     recovery code; the lock ends every session, cancels the pending
 *     transfers, withdraws the links to ownership certificates and revokes an
 *     open recovery code;
 *   - Export data: everything held about the account, as a JSON file, for a
 *     request under the right of access.
 * An AUDITOR reads the sheet with the email masked, without the actions.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate, formatDateTime, humanize, shortHash } from '../format.js';
import { tierStanding } from '../model/club.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import type { OwnerSheet } from '../types.js';
import { button, busy, defList, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { issueRecoveryCode, ownerStatus } from './owners.js';

export async function ownerView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.accountId;
  const sheet = await ctx.api.owner(id);
  const o = sheet.owner;
  const role = ctx.session.admin.role;
  // The one place a recovery code appears, once.
  const slot = h('div', { class: 'owners__recovery' });

  const actions: HTMLElement[] = [];
  if (can(role, 'issueRecoveryCode') && o.status === 'ACTIVE') {
    actions.push(button('Recovery code', { kind: 'secondary', testId: 'issue-recovery-code', onClick: () => issueRecoveryCode(ctx, o, slot) }));
  }
  if (can(role, 'lockAccount') && o.status === 'ACTIVE') {
    actions.push(
      button('Lock account', {
        kind: 'danger',
        testId: 'lock-account',
        onClick: () =>
          void openDialog({
            title: 'Lock this account',
            eyebrow: o.email,
            body: [
              h('p', { class: 'dialog__text' }, 'Every session of the account ends now, the transfers it offered are cancelled, the links it shared to ownership certificates are withdrawn, its open requests of the private salon are closed and an open recovery code stops working.'),
              h(
                'p',
                { class: 'dialog__text' },
                'Until the account is unlocked, the client cannot sign in or use a recovery code, and is told that ORBES Client Services can assist. The pieces stay registered to the account. The lock is recorded in the audit log.',
              ),
            ],
            confirmLabel: 'Lock account',
            danger: true,
            submit: async () => {
              const r = await ctx.api.lockOwner(o.id);
              const links = r.certificatesRevoked > 0 ? `, ${formatCount(r.certificatesRevoked)} certificate ${r.certificatesRevoked === 1 ? 'link' : 'links'} withdrawn` : '';
              const requests = r.shopRequestsClosed > 0 ? `, ${formatCount(r.shopRequestsClosed)} ${r.shopRequestsClosed === 1 ? 'request' : 'requests'} of the private salon closed` : '';
              const code = r.recoveryCodesRevoked > 0 ? ', the open recovery code revoked' : '';
              notify(
                `Account locked. ${formatCount(r.sessionsRevoked)} ${r.sessionsRevoked === 1 ? 'session' : 'sessions'} ended, ${formatCount(r.transfersCancelled)} ${r.transfersCancelled === 1 ? 'transfer' : 'transfers'} cancelled${links}${requests}${code}.`,
              );
            },
          }).then((r) => r && ctx.reload(), notifyError),
      }),
    );
  }
  if (can(role, 'lockAccount') && o.status === 'LOCKED') {
    actions.push(
      button('Unlock account', {
        kind: 'secondary',
        testId: 'unlock-account',
        onClick: () =>
          void openDialog({
            title: 'Unlock this account',
            eyebrow: o.email,
            body: h(
              'p',
              { class: 'dialog__text' },
              'The client can sign in again. Transfers cancelled by the lock stay cancelled, and a recovery code it revoked does not come back: issue a new one if the client needs it. The unlock is recorded in the audit log.',
            ),
            confirmLabel: 'Unlock account',
            submit: async () => {
              await ctx.api.unlockOwner(o.id);
              notify('Account unlocked.');
            },
          }).then((r) => r && ctx.reload(), notifyError),
      }),
    );
  }
  if (can(role, 'exportAccount')) {
    const exp = button('Export data', { kind: 'ghost', testId: 'export-account', title: 'Everything held about this account, as a JSON file (right of access)' });
    exp.addEventListener('click', () => void busy(exp, async () => saveDownload(await ctx.api.exportOwner(o.id)), 'Exporting…').catch(notifyError));
    actions.push(exp);
  }

  const owned = sheet.pieces.filter((p) => p.until === null);
  return h(
    'div',
    { class: 'view view--owner' },
    pageHeader({
      eyebrow: 'Owner',
      title: o.email,
      identifier: true,
      lead: can(role, 'readClientEmails')
        ? 'The client’s account, pieces, transfers in progress and latest verifications.'
        : 'The client’s account, pieces, transfers in progress and latest verifications. Emails are masked for your role.',
      actions,
    }),
    slot,
    section(
      'Account',
      defList([
        { label: 'Status', value: ownerStatus(o), note: o.status === 'LOCKED' ? 'Cannot sign in or use a recovery code until unlocked' : undefined },
        { label: 'Email', value: o.email },
        { label: 'Name', value: o.displayName ?? '—' },
        { label: 'Country', value: o.country ?? '—' },
        { label: 'Tier', value: h('span', { data: { testid: 'owner-tier' } }, tierStanding(sheet.tier)), note: 'In the club now: from the pieces held, never a revoked, flagged or retired one' },
        { label: 'Since', value: formatDate(o.createdAt) },
        { label: 'Account id', value: mono(o.id) },
      ]),
      { id: 'account' },
    ),
    section(
      'Pieces',
      table(
        [
          { label: 'Product', cell: (p) => h('a', { class: 'idlink', attrs: { href: productHref(p.productId) } }, p.productId), kind: ['nowrap'] },
          { label: 'Model', cell: (p) => h('span', null, humanize(p.model), h('span', { class: 'cell-sub' }, [humanize(p.type), p.variant].filter(Boolean).join(' · '))) },
          { label: 'Material', cell: (p) => humanize(p.material), kind: ['wide'] },
          { label: 'Status', cell: (p) => statusMark(humanize(p.status), toneOf('product', p.status)), kind: ['nowrap'] },
          { label: 'Acquired', cell: (p) => h('span', null, humanize(p.acquiredVia), h('span', { class: 'cell-sub' }, p.verified ? 'VERIFIED' : 'UNVERIFIED')), kind: ['nowrap'] },
          { label: 'From', cell: (p) => formatDate(p.since), kind: ['nowrap'] },
          { label: 'Until', cell: (p) => (p.until ? `${formatDate(p.until)} · ${humanize(p.endedReason)}` : 'CURRENT'), kind: ['nowrap'] },
        ],
        sheet.pieces,
        { empty: 'No piece registered to this account.', onRow: (p) => productHref(p.productId), caption: 'Pieces' },
      ),
      { id: 'pieces', note: `${formatCount(owned.length)} owned now · ${formatCount(sheet.pieces.length)} ever` },
    ),
    section(
      'Transfers in progress',
      table(
        [
          { label: 'Product', cell: (t) => h('a', { class: 'idlink', attrs: { href: productHref(t.productId) } }, t.productId), kind: ['nowrap'] },
          { label: 'Transfer', cell: (t) => mono(t.id, shortHash(t.id, 8, 4)), kind: ['wide'] },
          { label: 'Offered', cell: (t) => formatDateTime(t.createdAt), kind: ['nowrap'] },
          { label: 'Expires', cell: (t) => formatDateTime(t.expiresAt), kind: ['nowrap'] },
        ],
        sheet.transfers,
        { empty: 'No transfer in progress.', caption: 'Transfers in progress' },
      ),
      { id: 'transfers' },
    ),
    scansPanel(sheet),
  );
}

/** The latest verifications made while signed in to the account, each with its REF. */
function scansPanel(sheet: OwnerSheet): HTMLElement {
  return section(
    'Latest verifications',
    table(
      [
        {
          label: 'When',
          cell: (s) => h('a', { class: 'idlink', attrs: { href: href('scans', {}, { scanId: s.id }), 'data-testid': 'owner-scan' } }, formatDateTime(s.occurredAt, { seconds: true })),
          kind: ['nowrap'],
        },
        { label: 'REF', cell: (s) => mono(s.reference), kind: ['nowrap'] },
        { label: 'Product', cell: (s) => (s.productId ? h('a', { class: 'idlink', attrs: { href: productHref(s.productId) } }, s.productId) : h('span', { class: 'soft' }, '—')), kind: ['nowrap'] },
        { label: 'Event', cell: (s) => humanize(s.eventType), kind: ['nowrap'] },
        { label: 'Result', cell: (s) => statusMark(humanize(s.state), toneOf('verification', s.state)), kind: ['wide'] },
        { label: 'Where', cell: (s) => s.country ?? '—', kind: ['nowrap'] },
      ],
      sheet.scans,
      { empty: 'No verification made while signed in to this account.', caption: 'Latest verifications' },
    ),
    { id: 'scans', note: 'The 20 most recent, made while signed in' },
  );
}
