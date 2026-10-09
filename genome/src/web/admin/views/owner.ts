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
 *
 * The client sheet (plan LIVE RELEASE+, N4) gathers, beside the account, its
 * tier and its pieces: its orders, each with its steps and their dates (late
 * ones stand out, as on the Orders board) and linked to its page; the releases
 * it took part in with the pieces it secured; its answers to the questions
 * after; its I'LL BE THERE and whether it came; the segments it belongs to
 * now; and the notes Client Services wrote on its orders, draw entries,
 * requests of the private salon and LIVE reservations. One line, Messages
 * (CS-01), gives the status of its conversation with ORBES Client Services
 * and opens it. One line, Lifetime value (plan NEXT-NINE, BP-29), what the
 * client is worth by GROWTH's rule, after the tier and its Club block.
 *
 * Right after Account (plan CUSTOMER INTELLIGENCE §3.6 C.4.1): the Profile (views/client-profile.ts), what the client
 * gave in YOUR PROFILE as the role reads it, with Edit the profile, Change the date of birth and Edit the address for an
 * OPERATOR; Tags and private notes (views/client-notes.ts), never shown to the client; Intelligence
 * (views/owner-intelligence.ts), read after the sheet: origin, wishlist, what they look at, devices and places. A team
 * account (its email a console login's) says so under Status.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate, formatDateTime, humanize, shortHash } from '../format.js';
import { clubBlockLines, tierStanding } from '../model/club.js';
import { lifetimeValueText, NOTES } from '../model/growth.js';
import {
  changeInput,
  changeProblem,
  changeValues,
  COVER_OPTIONS,
  coversText,
  GRANT_HINTS,
  grantInput,
  grantProblem,
  grantToast,
  grantValues,
  GUARANTEE_LIMITS,
  GUARANTEE_SECTION_NOTE,
  GUARANTEE_STATE_LABELS,
  guaranteeActions,
  modelOptions,
  parisToday,
  PIECES_OPTIONS,
  releaseOptions,
  REVOKE_TEXT,
  validUntilText,
} from '../model/guarantees.js';
import { STATUS_LABELS } from '../model/messages.js';
import { formatMoney } from '../model/live.js';
import { CHANNEL_LABELS, LATE_LABELS, sizeText } from '../model/orders.js';
import { INTEREST_OUTCOME_LABELS, NOTE_ABOUT_LABELS, orderSteps, participationLine, RELEASE_KIND_LABELS } from '../model/owners.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import type { ClientRelease, Guarantee, OwnerSheet } from '../types.js';
import { button, busy, defList, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { issueRecoveryCode, ownerStatus } from './owners.js';
import { profileSection } from './client-profile.js';
import { tagsNotesSection } from './client-notes.js';
import { intelligenceSection } from './owner-intelligence.js';
import { OWNER_LEAD, OWNER_LEAD_MASKED, TEAM_ACCOUNT_LINE } from '../model/client-profile.js';

/** Under Status: a lock's consequence, and the team account's line (§3.0 (d)). */
function statusNote(status: string, teamAccount: boolean): string | undefined {
  const lines = [status === 'LOCKED' ? 'Cannot sign in or use a recovery code until unlocked' : null, teamAccount ? TEAM_ACCOUNT_LINE : null].filter((x): x is string => x !== null);
  return lines.length ? lines.join('. ') : undefined;
}

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
              h('p', { class: 'dialog__text' }, 'Every session of the account ends now, the transfers it offered are cancelled, the links it shared to ownership certificates are withdrawn, its open requests of the private salon are closed, its places in the live releases are given up and an open recovery code stops working.'),
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
              const live = r.liveEntriesRemoved > 0 ? `, ${formatCount(r.liveEntriesRemoved)} ${r.liveEntriesRemoved === 1 ? 'place' : 'places'} in the live releases given up` : '';
              const code = r.recoveryCodesRevoked > 0 ? ', the open recovery code revoked' : '';
              notify(
                `Account locked. ${formatCount(r.sessionsRevoked)} ${r.sessionsRevoked === 1 ? 'session' : 'sessions'} ended, ${formatCount(r.transfersCancelled)} ${r.transfersCancelled === 1 ? 'transfer' : 'transfers'} cancelled${links}${requests}${live}${code}.`,
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
      lead: can(role, 'readClientEmails') ? OWNER_LEAD : OWNER_LEAD_MASKED,
      actions,
    }),
    slot,
    section(
      'Account',
      defList([
        { label: 'Status', value: ownerStatus(o), note: statusNote(o.status, sheet.teamAccount) },
        { label: 'Email', value: o.email },
        { label: 'Name', value: o.displayName ?? '—' },
        { label: 'Country', value: o.country ?? '—' },
        { label: 'Tier', value: h('span', { data: { testid: 'owner-tier' } }, tierStanding(sheet.tier)), note: 'In the club now: from the pieces held, never a revoked, flagged or retired one' },
        // BP-19 T10: the Club block under the tier line: the credits and what is left, the welcome gifts, the yearly care.
        ...clubBlockLines(sheet.club).map((l) => ({
          label: l.label,
          value: h(
            'span',
            { data: { testid: 'owner-club' } },
            l.link
              ? h('a', { class: 'idlink', attrs: { href: l.link.kind === 'order' ? href('order', { orderId: l.link.id }) : href('careRequest', { careId: l.link.id }) } }, l.value)
              : l.value,
          ),
        })),
        // BP-29: what the client is worth, by GROWTH's rule.
        { label: 'Lifetime value', value: h('span', { data: { testid: 'owner-lifetime-value' } }, lifetimeValueText(sheet.lifetimeValue)), note: NOTES.ltv },
        {
          label: 'Messages',
          value: sheet.messages
            ? h(
                'a',
                { class: 'idlink', attrs: { href: href('conversation', { conversationId: sheet.messages.conversationId }), 'data-testid': 'owner-messages' } },
                STATUS_LABELS[sheet.messages.status],
              )
            : '—',
          note: sheet.messages ? 'The client’s conversation with ORBES Client Services' : 'The client has not written to ORBES Client Services',
        },
        { label: 'Since', value: formatDate(o.createdAt) },
        { label: 'Account id', value: mono(o.id) },
      ]),
      { id: 'account' },
    ),
    // Plan CUSTOMER INTELLIGENCE §3.6 C.4.1: Profile, Tags and private notes and Intelligence, right after Account.
    profileSection(ctx, sheet),
    tagsNotesSection(ctx, sheet),
    intelligenceSection(ctx, sheet),
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
    ordersPanel(sheet),
    releasesPanel(sheet),
    guaranteesPanel(ctx, sheet),
    answersPanel(sheet),
    interestPanel(sheet),
    segmentsPanel(sheet),
    notesPanel(sheet),
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

/** N4: the collector's orders, the latest first, each with its steps and their dates, linked to its page. */
function ordersPanel(sheet: OwnerSheet): HTMLElement {
  const late = sheet.orders.filter((o) => o.timing.late).length;
  return section(
    'Orders',
    table(
      [
        { label: 'Order', cell: (o) => h('a', { class: 'idlink', attrs: { href: href('order', { orderId: o.id }) }, data: { testid: 'client-order' } }, o.reference), kind: ['nowrap'] },
        { label: 'Sold', cell: (o) => h('span', null, CHANNEL_LABELS[o.channel], o.release ? h('span', { class: 'cell-sub' }, o.release.title) : null) },
        { label: 'Piece', cell: (o) => h('span', null, o.model.name, h('span', { class: 'cell-sub' }, sizeText({ sizeLabel: o.sizeLabel, skuKnown: o.skuCode !== null }))) },
        { label: 'Price', cell: (o) => (o.priceMinor === null || o.currency === null ? 'To enter' : formatMoney(o.priceMinor, o.currency)), kind: ['nowrap'] },
        {
          label: 'Step',
          cell: (o) =>
            h(
              'span',
              { class: 'row-marks' },
              statusMark(humanize(o.status), toneOf('order', o.status)),
              o.timing.late && o.timing.rule ? statusMark(LATE_LABELS[o.timing.rule], 'alert') : null,
            ),
          kind: ['nowrap'],
        },
        {
          label: 'Steps',
          cell: (o) => h('span', { class: 'client-steps', data: { testid: 'client-order-steps' } }, ...orderSteps(o).map((x) => h('span', { class: 'client-steps__step' }, `${humanize(x.step)} ${formatDate(x.at)}`))),
          kind: ['wide'],
        },
      ],
      sheet.orders,
      { empty: 'No order.', onRow: (o) => href('order', { orderId: o.id }), caption: 'Orders' },
    ),
    { id: 'orders', note: `${formatCount(sheet.orders.length)} ${sheet.orders.length === 1 ? 'order' : 'orders'} · ${formatCount(late)} late` },
  );
}

/** A release's page in the console: a LIVE RELEASE's, or a draw's on the Club page. */
const releaseHref = (r: Pick<ClientRelease, 'id' | 'kind'>) => (r.kind === 'LIVE' ? href('liveRelease', { dropId: r.id }) : href('drop', { dropId: r.id }));

/** N4: the releases the collector took part in, the latest first, with the pieces it secured in each. */
function releasesPanel(sheet: OwnerSheet): HTMLElement {
  return section(
    'Releases',
    table(
      [
        { label: 'Release', cell: (r) => h('a', { class: 'idlink', attrs: { href: releaseHref(r) } }, r.title) },
        { label: 'Kind', cell: (r) => RELEASE_KIND_LABELS[r.kind], kind: ['nowrap'] },
        { label: 'Opened', cell: (r) => formatDate(r.opensAt), kind: ['nowrap'] },
        { label: 'Part', cell: (r) => statusMark(r.secured > 0 ? 'SECURED A PIECE' : 'TOOK PART', r.secured > 0 ? 'solid' : 'outline'), kind: ['nowrap'] },
        { label: 'Pieces secured', cell: (r) => formatCount(r.secured), kind: ['num'] },
      ],
      sheet.releases.items,
      { empty: 'No release taken part in.', caption: 'Releases' },
    ),
    { id: 'releases', note: participationLine(sheet.releases) },
  );
}

/**
 * IN-01: THE HOUSE'S GUARANTEE, after Releases: the client's guarantees (what each covers, its pieces, until when, shown
 * or not, its state, its release, who granted it and its note); Grant a guarantee (OPERATOR, the account ACTIVE), Change
 * and Revoke while it is ACTIVE.
 */
function guaranteesPanel(ctx: ViewContext, sheet: OwnerSheet): HTMLElement {
  const o = sheet.owner;
  const canGrant = can(ctx.session.admin.role, 'grantGuarantee');
  const today = parisToday(ctx.now());
  const done = (msg: string | ((r: unknown) => string)) => (r: unknown) => {
    if (!r) return;
    notify(typeof msg === 'string' ? msg : msg(r));
    ctx.reload();
  };
  const termsFields = (v: Record<string, string>) => [
    { name: 'pieces', label: 'Pieces', kind: 'select' as const, options: [...PIECES_OPTIONS], value: v.pieces, hint: GRANT_HINTS.pieces },
    { name: 'validUntil', label: 'Valid until', kind: 'date' as const, required: true, value: v.validUntil, hint: GRANT_HINTS.validUntil },
    { name: 'visible', label: 'Shown to the client', kind: 'checkbox' as const, value: v.visible, hint: GRANT_HINTS.visible },
    { name: 'note', label: 'Note', kind: 'textarea' as const, maxlength: GUARANTEE_LIMITS.note, value: v.note, hint: GRANT_HINTS.note },
  ];
  const grant = async () => {
    const [settings, models, collections, draws, lives] = await Promise.all([
      ctx.api.guaranteeSettings(),
      ctx.api.models(),
      ctx.api.collections(),
      ctx.api.drops(1, 50),
      ctx.api.liveReleases(1, 50),
    ]);
    const open = lives.items.filter((r) => r.phase !== 'ENDED' && r.phase !== 'CANCELLED' && !r.over);
    const releases = releaseOptions(draws.items, await Promise.all(open.map((r) => ctx.api.liveRelease(r.id))));
    const start = grantValues(settings);
    let granted: unknown = null;
    const r = await openDialog({
      title: 'Grant the house’s guarantee',
      eyebrow: o.email,
      fields: [
        { name: 'scope', label: 'Covers', kind: 'select', options: [...COVER_OPTIONS], value: start.scope },
        { name: 'modelId', label: 'Model', kind: 'select', options: [{ value: '', label: 'Choose a model' }, ...modelOptions(models.items)], value: '', hint: GRANT_HINTS.model },
        { name: 'collectionId', label: 'Collection', kind: 'select', options: [{ value: '', label: 'Choose a collection' }, ...collections.items.map((c) => ({ value: c.id, label: c.name }))], value: '' },
        { name: 'releaseId', label: 'Release', kind: 'select', options: [{ value: '', label: releases.length ? 'Choose a release' : 'No release to choose' }, ...releases.map((x) => ({ value: x.value, label: x.label }))], value: '' },
        ...termsFields(start),
      ],
      live: (v) => {
        const chosen = v.scope === 'RELEASE' ? releases.find((x) => x.value === v.releaseId) : undefined;
        return h('p', { class: 'dialog__text', data: { testid: 'guarantee-rule' } }, chosen ? chosen.rule : '');
      },
      validate: (v) => grantProblem(v, today),
      confirmLabel: 'Grant',
      submit: async (v) => {
        granted = await ctx.api.grantGuarantee(o.id, grantInput(v));
      },
    });
    if (r && granted) done(() => grantToast(granted as { setAsideFor: { id: string; title: string } | null }))(true);
  };
  const change = (g: Guarantee) =>
    void openDialog({
      title: 'Change the guarantee',
      eyebrow: `${o.email} · ${coversText(g)}`,
      fields: termsFields(changeValues(g)),
      validate: (v) => changeProblem(g, v, today),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.changeGuarantee(g.id, changeInput(g, v));
      },
    }).then(done('Guarantee saved.'), notifyError);
  const revoke = (g: Guarantee) =>
    void openDialog({
      title: 'Revoke the guarantee',
      eyebrow: `${o.email} · ${coversText(g)}`,
      danger: true,
      body: h('p', { class: 'dialog__text' }, REVOKE_TEXT),
      fields: [{ name: 'note', label: 'Note', kind: 'textarea', maxlength: GUARANTEE_LIMITS.note, hint: 'For Client Services: why it was revoked. Optional.' }],
      confirmLabel: 'Revoke',
      cancelLabel: 'Keep it',
      submit: async (v) => {
        await ctx.api.revokeGuarantee(g.id, v.note.trim() === '' ? null : v.note.trim());
      },
    }).then(done('Guarantee revoked.'), notifyError);
  const tools = canGrant && o.status === 'ACTIVE' ? [button('Grant a guarantee', { kind: 'ghost', testId: 'guarantee-grant', onClick: () => void grant().catch(notifyError) })] : [];
  return section(
    'House guarantee',
    [
      h('p', { class: 'notice' }, GUARANTEE_SECTION_NOTE),
      table<Guarantee>(
        [
          { label: 'Covers', cell: (g) => h('span', { data: { testid: 'guarantee-covers' } }, coversText(g)) },
          { label: 'Pieces', cell: (g) => formatCount(g.pieces), kind: ['num'] },
          { label: 'Valid until', cell: (g) => validUntilText(g), kind: ['nowrap'] },
          { label: 'Shown', cell: (g) => (g.visible ? 'Yes' : 'No'), kind: ['nowrap'] },
          { label: 'Status', cell: (g) => h('span', { data: { testid: 'guarantee-state' } }, statusMark(GUARANTEE_STATE_LABELS[g.state], toneOf('guarantee', g.state))), kind: ['nowrap'] },
          { label: 'Release', cell: (g) => (g.release ? h('a', { class: 'idlink', attrs: { href: releaseHref({ id: g.release.id, kind: g.release.mode }) } }, g.release.title) : '—') },
          { label: 'Granted', cell: (g) => h('span', null, formatDate(g.grantedAt), h('span', { class: 'cell-sub' }, g.grantedBy?.email ?? 'ORBES')), kind: ['nowrap'] },
          { label: 'Note', cell: (g) => (g.note ? h('span', { class: 'cell-details' }, g.note) : '—'), kind: ['wide'] },
          {
            label: '',
            cell: (g) => {
              const a = guaranteeActions(g, canGrant);
              return h(
                'span',
                { class: 'row-actions' },
                a.change ? button('Change', { kind: 'ghost', testId: 'guarantee-change', onClick: () => change(g) }) : null,
                a.revoke ? button('Revoke', { kind: 'ghost', testId: 'guarantee-revoke', onClick: () => revoke(g) }) : null,
              );
            },
            kind: ['actions'],
          },
        ],
        sheet.guarantees,
        { empty: 'No guarantee.', caption: 'House guarantee' },
      ),
    ],
    { id: 'guarantees', tools },
  );
}

/** N4: the collector's answers to the questions after the LIVE RELEASES, the latest first. */
function answersPanel(sheet: OwnerSheet): HTMLElement {
  return section(
    'Answers to the question after',
    table(
      [
        { label: 'Release', cell: (a) => h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: a.dropId }) } }, a.title) },
        { label: 'Question', cell: (a) => a.question, kind: ['wide'] },
        { label: 'Answer', cell: (a) => a.answerText ?? `Answer ${a.answer}`, kind: ['nowrap'] },
        { label: 'Answered', cell: (a) => formatDateTime(a.answeredAt), kind: ['nowrap'] },
      ],
      sheet.answers,
      { empty: 'No answer.', caption: 'Answers to the question after' },
    ),
    { id: 'answers' },
  );
}

/** N4: the collector's I'LL BE THERE, the latest release first, and whether it came. */
function interestPanel(sheet: OwnerSheet): HTMLElement {
  return section(
    'Interest',
    table(
      [
        { label: 'Release', cell: (i) => h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: i.dropId }) } }, i.title) },
        { label: 'Size', cell: (i) => i.size, kind: ['nowrap'] },
        { label: 'Said', cell: (i) => formatDate(i.since), kind: ['nowrap'] },
        { label: 'Opens', cell: (i) => formatDateTime(i.opensAt), kind: ['nowrap'] },
        {
          label: 'Outcome',
          cell: (i) => statusMark(INTEREST_OUTCOME_LABELS[i.outcome], i.outcome === 'CAME' ? 'solid' : i.outcome === 'UPCOMING' ? 'outline' : 'muted'),
          kind: ['nowrap'],
        },
      ],
      sheet.interest,
      { empty: 'No I’LL BE THERE.', caption: 'Interest' },
    ),
    { id: 'interest', note: 'I’LL BE THERE, and whether the collector came into the line' },
  );
}

/** N4: the segments the collector belongs to now. */
function segmentsPanel(sheet: OwnerSheet): HTMLElement {
  return section(
    'Segments',
    sheet.segments.length === 0
      ? h('p', { class: 'soft', data: { testid: 'client-segments' } }, 'In no segment.')
      : h(
          'ul',
          { class: 'client-segments', data: { testid: 'client-segments' } },
          ...sheet.segments.map((x) => h('li', null, h('a', { class: 'idlink', attrs: { href: href('segment', { segmentId: x.id }) } }, x.name))),
        ),
    { id: 'segments', note: 'Read now, as a release’s access rule reads them' },
  );
}

/** N4: the notes Client Services wrote on the collector's orders, entries and requests, the latest first. */
function notesPanel(sheet: OwnerSheet): HTMLElement {
  return section(
    'Notes',
    table(
      [
        { label: 'When', cell: (n) => formatDateTime(n.at), kind: ['nowrap'] },
        {
          label: 'About',
          cell: (n) =>
            h(
              'span',
              null,
              NOTE_ABOUT_LABELS[n.about],
              h('span', { class: 'cell-sub' }, n.orderId ? h('a', { class: 'idlink', attrs: { href: href('order', { orderId: n.orderId }) } }, n.subject) : n.subject),
            ),
          kind: ['nowrap'],
        },
        { label: 'Note', cell: (n) => h('span', { class: 'client-note', data: { testid: 'client-note' } }, n.text), kind: ['wide'] },
        { label: 'By', cell: (n) => n.by ?? '—', kind: ['nowrap'] },
      ],
      sheet.notes,
      { empty: 'No note.', caption: 'Notes' },
    ),
    { id: 'notes', note: 'Written by ORBES Client Services on the orders, draw entries, requests of the private salon and LIVE reservations' },
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
