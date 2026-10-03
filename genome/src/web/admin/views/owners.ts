/**
 * Owners: customer accounts with their current and lifetime product counts.
 *
 * ORBES Client Services finds a client by exact email or by the REF the
 * client reads from under a result (A-06): a REF lists the scans it names,
 * each with its piece, the piece's owner and the account that scanned it,
 * then those accounts. Every account opens its sheet (views/owner.ts). An
 * AUDITOR reads the emails masked (j***@example.com): the server masks them.
 *
 * ORBES Client Services, as an ADMIN, issues a client who forgot the
 * password a one-time recovery code from the account's row (C-04) or its
 * sheet, after an identity check: the code is shown once, above the table,
 * until it is hidden; only its hash is kept. The client enters it on /verify
 * (FORGOTTEN PASSWORD?) with a new password: every session of the account
 * then ends, pending transfers are cancelled, links to ownership certificates
 * are withdrawn and new transfers are paused for 72 hours, which the
 * account's status line says, as it says while a code is open.
 */
import { bracket } from '../../shared/corners.js';
import { h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatCount, formatDate, formatDateTime, humanize, shortHash } from '../format.js';
import { OWNER_SEARCH_HINT, ownerSearch } from '../model/owners.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import type { OwnerList, OwnerRecord, RecoveryCode, ReferenceMatch } from '../types.js';
import { button, copyButton, field, filterBar, input, mono, narrowedTo, pageHeader, pager, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function ownersView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query.q ?? '';
  const search = ownerSearch(q);
  const canRecover = can(ctx.session.admin.role, 'issueRecoveryCode');
  // 200: the most the console keeps of a value in its route (router.ts parseQuery).
  const box = input('q', { value: q, placeholder: 'client@example.com or REF 1A2B3C4D', maxlength: 200 });
  const form = h(
    'form',
    { class: 'filters__form', attrs: { role: 'search', 'data-testid': 'owner-search' } },
    filterBar(field('Email or REF', box, { hint: OWNER_SEARCH_HINT, wide: true }), button('Search', { type: 'submit', kind: 'secondary' }), search ? narrowedTo(`Search: ${q.trim()}`, href('owners')) : null),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ q: box.value.trim(), page: undefined });
  });

  let list: OwnerList = { items: [], page: 1, pageSize: 50, total: 0 };
  let refused: string | null = search?.kind === 'invalid' ? search.message : null;
  if (!refused) {
    try {
      list = await ctx.api.owners({
        ...(search?.kind === 'email' ? { email: search.email } : {}),
        ...(search?.kind === 'ref' ? { ref: search.ref } : {}),
        page: pageParam(ctx),
        pageSize: 50,
      });
    } catch (e) {
      // A search the server cannot read is said on the field; anything else fails the view.
      if (!(e instanceof ApiError && e.code === 'VALIDATION_FAILED')) throw e;
      refused = e.message;
    }
  }
  if (refused) {
    const hint = form.querySelector<HTMLElement>('.cfield__hint');
    if (hint) hint.textContent = refused;
    form.querySelector('.cfield')?.classList.add('is-invalid');
    box.setAttribute('aria-invalid', 'true');
  }

  // The one place a recovery code appears, once.
  const slot = h('div', { class: 'owners__recovery' });
  const columns: Column<OwnerRecord>[] = [
    {
      label: 'Account',
      cell: (o) =>
        h(
          'span',
          null,
          h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: o.id }), 'data-testid': 'owner-link' } }, o.email),
          o.displayName ? h('span', { class: 'cell-sub' }, o.displayName) : null,
        ),
      kind: ['wide'],
    },
    { label: 'Status', cell: (o) => ownerStatus(o), kind: ['nowrap'] },
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
      cell: (o) => (o.status === 'ACTIVE' ? button('Recovery code', { kind: 'ghost', testId: 'issue-recovery-code', onClick: () => issueRecoveryCode(ctx, o, slot) }) : '—'),
    });
  }

  const accounts = table(columns, list.items, {
    empty: refused ? 'Nothing searched.' : search ? 'No client account matches this search.' : 'No client account yet.',
    onRow: (o) => href('owner', { accountId: o.id }),
    caption: 'Owners',
  });
  const lead = [
    'Registered client accounts. Ownership never changes a product’s cryptographic identity. Find a client by exact email, or by the REF under a result.',
    canRecover ? 'A client who forgot the password receives a one-time recovery code, after an identity check.' : null,
    can(ctx.session.admin.role, 'readClientEmails') ? null : 'Emails are masked for your role.',
  ]
    .filter(Boolean)
    .join(' ');

  return h(
    'div',
    { class: 'view view--owners' },
    pageHeader({ eyebrow: 'Clients', title: 'Owners', lead }),
    form,
    search?.kind === 'ref' && list.scans ? referencePanel(search.ref, list.scans, list.items) : null,
    slot,
    // Under a REF's scans, the accounts they lead to have their own heading.
    search?.kind === 'ref' && list.scans ? section('Accounts', accounts, { id: 'accounts' }) : accounts,
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}

/** The scans a REF names: each leads to its scan, its piece, the account that scanned it and the piece's owner. */
function referencePanel(ref: string, scans: ReferenceMatch[], accounts: OwnerRecord[]): HTMLElement {
  const email = new Map(accounts.map((a) => [a.id, a.email]));
  const account = (id: string | null, none: string) =>
    id ? h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: id }) } }, email.get(id) ?? shortHash(id, 8, 4)) : h('span', { class: 'soft' }, none);
  return section(
    'Reference',
    table(
      [
        {
          label: 'Scan',
          cell: (s) =>
            h('span', null, h('a', { class: 'idlink', attrs: { href: href('scans', {}, { scanId: s.scanId }), 'data-testid': 'ref-scan' } }, `REF ${s.reference}`), h('span', { class: 'cell-sub' }, formatDateTime(s.occurredAt, { seconds: true }))),
          kind: ['nowrap'],
        },
        { label: 'Result', cell: (s) => h('span', null, statusMark(humanize(s.state), toneOf('verification', s.state)), h('span', { class: 'cell-sub' }, humanize(s.eventType))), kind: ['wide'] },
        { label: 'Piece', cell: (s) => (s.productId ? h('a', { class: 'idlink', attrs: { href: productHref(s.productId) } }, s.productId) : h('span', { class: 'soft' }, 'Not in the registry')), kind: ['nowrap'] },
        { label: 'Scanned by', cell: (s) => account(s.scannedBy, 'Not signed in') },
        { label: 'Owner of the piece', cell: (s) => account(s.ownerId, 'No owner') },
      ],
      scans,
      { empty: 'No verification has this REF.', caption: `Verifications with REF ${ref}` },
    ),
    // The REF is set in the reading face (panel note): Gravesend's one is its capital I.
    { id: 'reference', note: `REF ${ref.slice(0, 8)} · the start of a scan’s id, printed under every result` },
  );
}

/** The account's status, then what a recovery left: an open code (and its attempts throttled), or transfers paused until a date. */
export function ownerStatus(o: OwnerRecord): HTMLElement {
  return h(
    'span',
    { data: { testid: 'owner-status' } },
    statusMark(humanize(o.status), toneOf('account', o.status)),
    o.recoveryCodeExpiresAt ? h('span', { class: 'cell-sub' }, `Recovery code open until ${formatDateTime(o.recoveryCodeExpiresAt)}`) : null,
    // Five wrong guesses at the code within an hour: it is refused unchecked until then; a new code starts afresh.
    o.recoveryCodeThrottledUntil ? h('span', { class: 'cell-sub' }, `Recovery attempts throttled until ${formatDateTime(o.recoveryCodeThrottledUntil)}`) : null,
    o.transfersPausedUntil ? h('span', { class: 'cell-sub' }, `Transfers paused until ${formatDateTime(o.transfersPausedUntil)}`) : null,
  );
}

/**
 * ADMIN, after checking the identity of the client: a one-time recovery code (C-04), shown once in `slot`
 * until it is hidden. From the owner's row here and from the owner's sheet.
 */
export function issueRecoveryCode(ctx: ViewContext, o: OwnerRecord, slot: HTMLElement): void {
  let issued: RecoveryCode | null = null;
  void openDialog({
    title: 'Issue a recovery code',
    eyebrow: o.email,
    body: [
      h('p', { class: 'dialog__text' }, 'Only after checking the identity of the client. The code is shown once, works once and expires after 30 minutes; a code issued before stops working.'),
      h(
        'p',
        { class: 'dialog__text' },
        'When the client uses it on /verify with a new password, every session of the account ends, its pending transfers are cancelled, the links it shared to ownership certificates are withdrawn and new transfers are paused for 72 hours. The issue is recorded in the audit log.',
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
