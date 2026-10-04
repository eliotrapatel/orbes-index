/**
 * A drop (P-R03), `#/club/drops/:dropId`, reached from the Club page's Drops
 * tab (no link of its own in the sidebar).
 *
 *  - The release: its state, model, pieces, early access (P-X02: when
 *    PLATINE and PALLADIUM reserve a place directly, and the places so
 *    reserved), window of entries (UTC), how long a place drawn or reserved
 *    is held, its publication, the fingerprint of its seed (committed at
 *    creation) and, once drawn, the seed itself; its page on /verify once
 *    published.
 *  - Edit (every field of a DRAFT), Description (once published: the only
 *    field that still changes), Publish, Cancel (before the draw, a phrase
 *    to type) — OPERATOR; Draw (ADMIN, once its entries are closed, a
 *    phrase to type): tier, then seniority read at that moment, then the
 *    seed's order; the places held 48 hours by default, the others on the
 *    waiting list.
 *  - Its entries, by rank once drawn (the direct reservations, without a
 *    rank, after them): the account (its email masked for an AUDITOR, a link
 *    to its sheet), the tier and seniority of the draw or of the
 *    reservation, the status and until when a place is held; Confirm (the
 *    sale concluded) and
 *    Lapse (only once the place's time has passed) on a place held; Offer
 *    next while places are left. Each is one request under the drop's lock,
 *    audited by the server; then the page is read again.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDateTime, groupChars, humanize } from '../format.js';
import {
  DROP_LIMITS,
  dropActions,
  dropChange,
  dropFormValues,
  dropLead,
  dropPhrase,
  dropProblem,
  dropWindow,
  earlyAccessLine,
  earlyAccessOnPublish,
  entryActions,
  placesTaken,
  placesToDraw,
  releaseAddress,
  tierName,
} from '../model/club.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { DROP_ENTRY_STATUSES, type Drop, type DropEntry, type DropEntryStatus } from '../types.js';
import { button, defList, field, filterBar, linkButton, mono, pageHeader, pager, section, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { dropFields } from './club.js';
import { pageParam, type ViewContext } from './context.js';

export async function dropView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.dropId ?? '';
  const status = DROP_ENTRY_STATUSES.find((s) => s === ctx.route.query.status) as DropEntryStatus | undefined;
  const [d, entries, models] = await Promise.all([
    ctx.api.drop(id),
    ctx.api.dropEntries(id, { ...(status ? { status } : {}), page: pageParam(ctx), pageSize: 50 }),
    ctx.api.models(),
  ]);
  const role = ctx.session.admin.role;
  const acts = dropActions(d, role);
  const eyebrow = `${humanize(d.model.name)} · ${d.id.slice(0, 8).toUpperCase()}`;
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  // ── The release ──────────────────────────────────────────────────────────
  const edit = () =>
    void openDialog({
      title: 'Edit the release',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'A draft changes freely. Once published, only its description does.'),
      fields: dropFields(models.items, dropFormValues(d, ctx.now()), { model: true }),
      validate: (v) => dropProblem(v) ?? (Object.keys(dropChange(d, v)).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save release',
      submit: async (v) => {
        await ctx.api.updateDrop(d.id, dropChange(d, v));
      },
    }).then(done('Release saved.'));

  const describe = () =>
    void openDialog({
      title: 'Description',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'The one field of a published release that still changes: read on its page on /verify.'),
      fields: [{ name: 'description', label: 'Description', kind: 'textarea', rows: 6, maxlength: DROP_LIMITS.description, value: d.description ?? '', hint: 'Plain paragraphs, a blank line between two. Empty: none.' }],
      validate: (v) => (v.description.trim() === (d.description ?? '') ? 'Nothing has changed.' : null),
      confirmLabel: 'Save description',
      submit: async (v) => {
        await ctx.api.updateDrop(d.id, { description: v.description.trim() === '' ? null : v.description.trim() });
      },
    }).then(done('Description saved.'));

  const publish = () =>
    void openDialog({
      title: 'Publish the release',
      eyebrow,
      body: [
        h('p', { class: 'dialog__text' }, `Its page on /verify announces it from now on, with the fingerprint of its seed. Entries: ${dropWindow(d)}.`),
        h('p', { class: 'dialog__text' }, `Direct reservations of PLATINE and PALLADIUM owners: ${earlyAccessOnPublish(d, ctx.now())}.`),
        h('p', { class: 'dialog__text' }, 'Once published, only its description changes: its model, pieces, dates, early access and the place held are fixed.'),
      ],
      confirmLabel: 'Publish',
      submit: async () => {
        await ctx.api.publishDrop(d.id);
      },
    }).then(done('Release published.'));

  const cancel = () =>
    void openDialog({
      title: 'Cancel the release',
      eyebrow,
      danger: true,
      body: h(
        'p',
        { class: 'dialog__text' },
        `${d.publishedAt ? 'Its page says CANCELLED from now on, and its entrants read that there will be no draw.' : 'The draft never shows.'} No entry is taken any more, and no draw can be run.`,
      ),
      phrase: dropPhrase('cancel', d),
      confirmLabel: 'Cancel release',
      cancelLabel: 'Keep it',
      submit: async () => {
        await ctx.api.cancelDrop(d.id);
      },
    }).then(done('Release cancelled.'));

  const draw = () =>
    void openDialog({
      title: 'Run the draw',
      eyebrow,
      danger: true,
      body: [
        h(
          'p',
          { class: 'dialog__text' },
          `${formatCount(d.entries.ENTERED)} ${d.entries.ENTERED === 1 ? 'entry takes' : 'entries take'} part, for ${formatCount(placesToDraw(d))} ${placesToDraw(d) === 1 ? 'place' : 'places'} of ${formatCount(d.quantity)} ${d.quantity === 1 ? 'piece' : 'pieces'}${placesTaken(d) > 0 ? ` (${formatCount(placesTaken(d))} already held or sold by direct reservations: lapse first those whose time has passed)` : ''}.`,
        ),
        h(
          'p',
          { class: 'dialog__text' },
          `Each account's tier and seniority are read now; then the seed's order. The first places are held ${d.purchaseWindowHours} hours, the others go on the waiting list. The seed is published with every entry's rank. Once.`,
        ),
      ],
      phrase: dropPhrase('draw', d),
      confirmLabel: 'Run the draw',
      submit: async () => {
        const r = await ctx.api.drawDrop(d.id);
        notify(`Drawn: ${formatCount(r.selected)} ${r.selected === 1 ? 'place' : 'places'} held, ${formatCount(r.waitlisted)} on the waiting list.`);
      },
    }).then((r) => r && ctx.reload());

  const offerNext = () =>
    void openDialog({
      title: 'Offer the next place',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, `The first entry of the waiting list by rank is held a place for ${d.purchaseWindowHours} hours. ORBES Client Services contacts its entrant.`),
      confirmLabel: 'Offer the place',
      submit: async () => {
        await ctx.api.offerNextDropEntry(d.id);
      },
    }).then(done('The next entry of the waiting list holds a place.'));

  const published = d.publishedAt !== null;
  const rows = [
    { label: 'State', value: h('span', { data: { testid: 'drop-state' } }, statusMark(humanize(d.state), toneOf('drop', d.state))) },
    { label: 'Model', value: `${humanize(d.model.name)} · ${humanize(d.model.type)}`, note: d.model.active ? undefined : 'No longer offered for new pieces.' },
    { label: 'Pieces', value: formatCount(d.quantity) },
    {
      label: 'Early access',
      value: h('span', { data: { testid: 'drop-early-access' } }, earlyAccessLine(d)),
      note: d.earlyAccessOpensAt ? 'PLATINE and PALLADIUM owners reserve a place directly until entries open, first come, first served.' : undefined,
    },
    ...(d.earlyAccessOpensAt || d.reserved > 0 ? [{ label: 'Reserved directly', value: h('span', { data: { testid: 'drop-reserved' } }, `${formatCount(d.reserved)} of ${formatCount(d.quantity)}`), note: 'Places held or sold by a direct reservation: the draw gives the others.' }] : []),
    { label: 'Entries open', value: formatDateTime(d.opensAt) },
    { label: 'Entries close', value: formatDateTime(d.closesAt) },
    { label: 'Place held', value: `${d.purchaseWindowHours} ${d.purchaseWindowHours === 1 ? 'hour' : 'hours'}` },
    { label: 'Published', value: d.publishedAt ? formatDateTime(d.publishedAt) : 'Not yet' },
    ...(d.drawnAt ? [{ label: 'Drawn', value: formatDateTime(d.drawnAt) }] : []),
    ...(d.cancelledAt ? [{ label: 'Cancelled', value: formatDateTime(d.cancelledAt) }] : []),
    { label: 'Created', value: `${formatDateTime(d.createdAt)}${d.createdBy ? ` · ${d.createdBy.email}` : ''}` },
    {
      label: 'Seed fingerprint',
      value: h('span', { data: { testid: 'drop-seed-hash' } }, mono(d.seedHash, groupChars(d.seedHash, 8))),
      note: 'SHA-256 of the seed, drawn when the release was created; public with the release.',
    },
    ...(d.seed ? [{ label: 'Seed', value: h('span', { data: { testid: 'drop-seed' } }, mono(d.seed, groupChars(d.seed, 8))), note: 'Revealed by the draw: anyone ranks the entries again from it.' }] : []),
    ...(published ? [{ label: 'Page', value: h('a', { class: 'mono', attrs: { href: releaseAddress(d), target: '_blank', rel: 'noopener', 'data-testid': 'drop-page' } }, releaseAddress(d)) }] : []),
  ];
  if (d.description) rows.splice(2, 0, { label: 'Description', value: h('span', { class: 'cell-details' }, d.description) });
  const tools = [
    acts.edit ? button('Edit', { kind: 'ghost', testId: 'drop-edit', onClick: edit }) : null,
    acts.describe ? button('Description', { kind: 'ghost', testId: 'drop-describe', onClick: describe }) : null,
    acts.publish ? button('Publish', { kind: 'primary', testId: 'drop-publish', onClick: publish }) : null,
    acts.draw ? button('Run the draw', { kind: 'danger', testId: 'drop-draw', onClick: draw }) : null,
    acts.cancel ? button('Cancel', { kind: 'ghost', testId: 'drop-cancel', onClick: cancel }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  const release = section('Release', defList(rows), { id: 'release', tools });

  // ── Entries ──────────────────────────────────────────────────────────────
  const conclude = (e: DropEntry, to: 'confirm' | 'lapse') =>
    void openDialog({
      title: to === 'confirm' ? 'Sale concluded' : 'Place lapsed',
      eyebrow: `${e.email} · ${e.reserved ? 'RESERVED DIRECTLY' : `RANK ${e.rank ?? '—'}`}`,
      body: h(
        'p',
        { class: 'dialog__text' },
        to === 'confirm'
          ? 'ORBES Client Services concluded the sale of a piece of this release with this entrant: the entry reads CONFIRMED.'
          : e.reserved && !d.drawnAt
            ? 'The place reserved was not taken up in time: the entry reads LAPSED, and the place goes to the draw.'
            : 'The place held was not taken up in time: the entry reads LAPSED, and the place can be offered to the next of the waiting list.',
      ),
      fields: [{ name: 'note', label: 'Note', kind: 'textarea', maxlength: DROP_LIMITS.note, hint: 'For ORBES Client Services: kept with the entry, never in the audit log. Optional.' }],
      confirmLabel: to === 'confirm' ? 'Confirm the sale' : 'Lapse the place',
      submit: async (v) => {
        if (to === 'confirm') await ctx.api.confirmDropEntry(d.id, e.id, v.note.trim());
        else await ctx.api.lapseDropEntry(d.id, e.id, v.note.trim());
      },
    }).then(done(to === 'confirm' ? 'Sale confirmed.' : 'Place lapsed.'));

  const statusFilter = select('status', [{ value: '', label: 'All' }, ...DROP_ENTRY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], status ?? '');
  statusFilter.addEventListener('change', () => ctx.setQuery({ status: statusFilter.value, page: undefined }));
  const now = ctx.now();
  const list = section(
    'Entries',
    [
      filterBar(field('Status', statusFilter)),
      table<DropEntry>(
        [
          { label: 'Rank', cell: (e) => (e.rank === null ? h('span', { class: 'soft' }, '—') : formatCount(e.rank)), kind: ['num'] },
          { label: 'Entry', cell: (e) => mono(e.id, e.id.slice(0, 8)), kind: ['nowrap'] },
          {
            label: 'Account',
            cell: (e) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: e.accountId }), 'data-testid': 'entry-account' } }, e.email),
            kind: ['wide'],
          },
          { label: 'Tier', cell: (e) => tierName(e.tier), kind: ['nowrap'] },
          { label: 'Seniority', cell: (e) => (e.seniority === null ? '—' : `${e.seniority} ${e.seniority === 1 ? 'yr' : 'yrs'}`), kind: ['nowrap'] },
          {
            label: 'Status',
            cell: (e) =>
              h(
                'span',
                { data: { testid: 'entry-status' } },
                statusMark(humanize(e.status), toneOf('dropEntry', e.status)),
                e.reserved ? h('span', { class: 'cell-sub', data: { testid: 'entry-reserved' } }, 'Reserved directly') : null,
                e.status === 'SELECTED' && e.respondBy ? h('span', { class: 'cell-sub' }, `Held until ${formatDateTime(e.respondBy)}`) : null,
                e.handledBy ? h('span', { class: 'cell-sub' }, `${e.handledBy.email} · ${formatDateTime(e.handledAt)}`) : null,
                e.note ? h('span', { class: 'cell-details' }, e.note) : null,
              ),
          },
          {
            label: '',
            cell: (e) => {
              const a = entryActions(e, role, now);
              return h(
                'span',
                { class: 'row-actions' },
                a.confirm ? button('Confirm', { kind: 'ghost', testId: 'entry-confirm', onClick: () => conclude(e, 'confirm') }) : null,
                a.lapse ? button('Lapse', { kind: 'ghost', testId: 'entry-lapse', onClick: () => conclude(e, 'lapse') }) : null,
              );
            },
            kind: ['actions'],
          },
        ],
        entries.items,
        {
          empty: status
            ? 'No entry has this status.'
            : d.state === 'DRAFT' || d.state === 'UPCOMING'
              ? d.earlyAccessOpensAt
                ? 'No entry yet: direct reservations and entries open at the times above.'
                : 'No entry yet: entries open at the time above.'
              : 'No entry.',
          caption: 'Entries',
        },
      ),
      pager(entries, (p) => ctx.setQuery({ page: p })),
    ],
    {
      id: 'entries',
      note: `${formatCount(d.entries.ENTERED + d.entries.SELECTED + d.entries.WAITLISTED + d.entries.CONFIRMED + d.entries.LAPSED)} entered · ${formatCount(placesTaken(d))} of ${formatCount(d.quantity)} held or sold${d.reserved > 0 ? `, ${formatCount(d.reserved)} by direct reservation` : ''}`,
      tools: acts.offerNext ? [button('Offer next', { kind: 'ghost', testId: 'drop-offer-next', onClick: offerNext })] : [],
    },
  );

  return h(
    'div',
    { class: 'view view--drop' },
    pageHeader({
      eyebrow: 'Clients · Club · Drops',
      title: d.title,
      // A title may hold a figure: it is then set in the reading face, as a record's id is.
      identifier: /\d/.test(d.title),
      lead: dropLead(d),
      actions: [linkButton('All drops', href('club', {}, { tab: 'drops' }), 'ghost')],
    }),
    release,
    list,
  );
}
