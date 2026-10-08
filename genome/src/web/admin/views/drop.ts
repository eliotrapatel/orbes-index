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
 *    audited by the server; then the page is read again. A test entrant's
 *    account carries TEST (plan TEST ENTRANTS).
 *  - Its sizes (plan NEXT LOT §3.6.F): Edit in two dialogs (the model, then
 *    the fields with one field of pieces per offered size of that model), and
 *    Sizes and pieces on a DRAFT (the line of a model with none); a Sizes
 *    table, Size · Pieces · Reserved · Entered · Held or sold · Waiting list,
 *    with Offer next per size while it has a place free and a waiting list;
 *    the entries' Size column and their size filter; the draw's outcome said
 *    per size.
 *  - Test entrants (plan TEST ENTRANTS, views/test-entrants.ts): SEND TEST
 *    ENTRANTS while the draw is open (ADMIN), the test not ended, PAST TESTS;
 *    on the right, the server's status (views/server-status.ts).
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
  drawOutcomeText,
  drawPriceText,
  drawSizesChange,
  drawSizesProblem,
  drawSizeValues,
  earlyAccessLine,
  earlyAccessOnPublish,
  entryActions,
  placesTaken,
  releaseAddress,
  sizeFieldLabel,
  sizeInSentence,
  sizeOfferable,
  tierName,
} from '../model/club.js';
import { drawGuaranteeLine, GUARANTEE_STATE_LABELS, guaranteedText, placesLeftForDraw, validUntilText } from '../model/guarantees.js';
import { drawTestStart } from '../model/test-entrants.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { DROP_ENTRY_STATUSES, type DrawSize, type Drop, type DropEntry, type DropEntryStatus, type ReleaseGuarantee } from '../types.js';
import { button, defList, field, filterBar, linkButton, mono, pageHeader, pager, section, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { drawSizeFields, drawSizesBody, drawSizesOfModel, drawSizesPreview, dropFields, dropModelField } from './club.js';
import { pageParam, type ViewContext } from './context.js';
import { serverStatusPanel, withServerPanel } from './server-status.js';
import { loadTestReads, testEntrantsSection, testTag } from './test-entrants.js';

export async function dropView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.dropId ?? '';
  const status = DROP_ENTRY_STATUSES.find((s) => s === ctx.route.query.status) as DropEntryStatus | undefined;
  // Plan NEXT LOT §3.6.F: one size's entries (a UUID only; the server checks it is one of the draw's).
  const sizeId = /^[0-9a-f-]{36}$/i.test(ctx.route.query.size ?? '') ? ctx.route.query.size : undefined;
  const [d, entries, models, guarantees, tests] = await Promise.all([
    ctx.api.drop(id),
    ctx.api.dropEntries(id, { ...(status ? { status } : {}), ...(sizeId ? { sizeId } : {}), page: pageParam(ctx), pageSize: 50 }),
    ctx.api.models(),
    ctx.api.releaseGuarantees(id),
    loadTestReads(ctx, id),
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
  // Plan NEXT LOT §3.6.F: the model first (its sizes are the draw's), then the fields with its sizes' pieces.
  const edit = async () => {
    const chosen = await openDialog({
      title: 'Edit the release',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'Its model first: a draw’s sizes and their pieces are the model’s offered sizes.'),
      fields: [dropModelField(models.items, d.model.id)],
      validate: (v) => (v.modelId ? null : 'Choose the model of the release.'),
      confirmLabel: 'Next',
    });
    if (!chosen) return;
    const modelId = chosen.modelId;
    const { labels, available } = await drawSizesOfModel(ctx.api, modelId);
    await openDialog({
      title: 'Edit the release',
      eyebrow,
      body: [h('p', { class: 'dialog__text' }, 'A draft changes freely. Once published, only its description does.'), ...drawSizesBody(labels)],
      fields: dropFields(models.items, { ...dropFormValues(d, ctx.now()), ...drawSizeValues(labels, modelId === d.model.id ? d : null) }, { model: false, sizes: labels }),
      live: (v) => (labels.length > 0 ? drawSizesPreview(v, available) : []),
      validate: (v) => dropProblem({ ...v, modelId }) ?? (Object.keys(dropChange(d, { ...v, modelId })).length === 0 ? 'Nothing has changed.' : null),
      confirmLabel: 'Save release',
      submit: async (v) => {
        await ctx.api.updateDrop(d.id, dropChange(d, { ...v, modelId }));
      },
    }).then(done('Release saved.'));
  };

  // Plan NEXT LOT §3.6.F: a DRAFT's sizes and their pieces alone (a draft of before this lot gets its first here).
  const sizesDialog = async () => {
    const { labels, available } = await drawSizesOfModel(ctx.api, d.model.id);
    await openDialog({
      title: 'Sizes and pieces',
      eyebrow,
      body: drawSizesBody(labels),
      fields: drawSizeFields(labels, drawSizeValues(labels, d)),
      live: (v) => (labels.length > 0 ? drawSizesPreview(v, available) : []),
      validate: (v) => drawSizesProblem(v) ?? (drawSizesChange(d, v) === null ? 'Nothing has changed.' : null),
      confirmLabel: 'Save sizes',
      submit: async (v) => {
        await ctx.api.updateDrop(d.id, { sizes: drawSizesChange(d, v)! });
      },
    }).then(done('Sizes saved.'));
  };

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
        h('p', { class: 'dialog__text' }, 'Once published, only its description changes: its model, pieces, dates, early access, price and the place held are fixed.'),
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

  const ranked = d.entries.ENTERED - d.guaranteedEntered.places;
  // The places the draw gives: the pieces less those held or sold and those the guaranteed entries take first.
  const left = placesLeftForDraw(d);
  const guaranteedLine = drawGuaranteeLine(d);
  const draw = () =>
    void openDialog({
      title: 'Run the draw',
      eyebrow,
      danger: true,
      body: [
        h(
          'p',
          { class: 'dialog__text' },
          `${formatCount(ranked)} ${ranked === 1 ? 'entry takes' : 'entries take'} part, for ${formatCount(left)} ${left === 1 ? 'place' : 'places'} of ${formatCount(d.quantity)} ${d.quantity === 1 ? 'piece' : 'pieces'}${placesTaken(d) > 0 ? ` (${formatCount(placesTaken(d))} already held or sold by direct reservations: lapse first those whose time has passed)` : ''}.`,
        ),
        // IN-01: the guaranteed places, selected first, apart from the ranking.
        ...(guaranteedLine ? [h('p', { class: 'dialog__text', data: { testid: 'draw-guaranteed' } }, guaranteedLine)] : []),
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
        // Plan NEXT LOT §3.6.F: per size, « 17: 5 selected, 12 on the waiting list. »
        notify(drawOutcomeText(r));
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

  // Plan NEXT LOT §3.6.F: OFFER NEXT per size, the first of that size's waiting list.
  const offerNextIn = (s: DrawSize) =>
    void openDialog({
      title: 'Offer the next place',
      eyebrow: `${eyebrow} · ${sizeFieldLabel(s.label)}`,
      body: h('p', { class: 'dialog__text' }, `The first entry by rank on the waiting list of ${sizeInSentence(s.label)} is held a place for ${d.purchaseWindowHours} hours. ORBES Client Services contacts its entrant.`),
      confirmLabel: 'Offer the place',
      submit: async () => {
        await ctx.api.offerNextDropEntry(d.id, s.id);
      },
    }).then(done('The next entry of the waiting list holds a place.'));

  const published = d.publishedAt !== null;
  const rows = [
    { label: 'State', value: h('span', { data: { testid: 'drop-state' } }, statusMark(humanize(d.state), toneOf('drop', d.state))) },
    { label: 'Model', value: [humanize(d.model.name), humanize(d.model.type), ...(d.model.variant ? [humanize(d.model.variant)] : [])].join(' · '), note: d.model.active ? undefined : 'No longer offered for new pieces.' },
    { label: 'Pieces', value: formatCount(d.quantity) },
    // NOCTURNE (addition 5): shown on its card and page on /verify; each order of the draw takes it.
    { label: 'Price', value: h('span', { data: { testid: 'drop-price' } }, drawPriceText(d)), note: d.priceMinor === null ? 'Each order’s price is entered by Client Services.' : 'Each order of the draw takes it.' },
    {
      label: 'Early access',
      value: h('span', { data: { testid: 'drop-early-access' } }, earlyAccessLine(d)),
      note: d.earlyAccessOpensAt ? 'PLATINE and PALLADIUM owners reserve a place directly until entries open, first come, first served.' : undefined,
    },
    ...(d.earlyAccessOpensAt || d.reserved > 0 ? [{ label: 'Reserved directly', value: h('span', { data: { testid: 'drop-reserved' } }, `${formatCount(d.reserved)} of ${formatCount(d.quantity)}`), note: 'Places held or sold by a direct reservation: the draw gives the others.' }] : []),
    // IN-01: the places the house guarantees, apart from those reserved directly.
    ...(d.guaranteed.places > 0 ? [{ label: 'Guaranteed', value: h('span', { data: { testid: 'drop-guaranteed' } }, guaranteedText(d.guaranteed)), note: 'Selected first at the draw, listed apart on the public page.' }] : []),
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
    acts.edit ? button('Edit', { kind: 'ghost', testId: 'drop-edit', onClick: () => void edit() }) : null,
    acts.sizes ? button('Sizes and pieces', { kind: 'ghost', testId: 'drop-sizes', onClick: () => void sizesDialog() }) : null,
    acts.describe ? button('Description', { kind: 'ghost', testId: 'drop-describe', onClick: describe }) : null,
    acts.publish ? button('Publish', { kind: 'primary', testId: 'drop-publish', onClick: publish }) : null,
    acts.draw ? button('Run the draw', { kind: 'danger', testId: 'drop-draw', onClick: draw }) : null,
    acts.cancel ? button('Cancel', { kind: 'ghost', testId: 'drop-cancel', onClick: cancel }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  const release = section('Release', defList(rows), { id: 'release', tools });

  // ── Sizes (plan NEXT LOT §3.6.F) ─────────────────────────────────────────
  const sizesSection =
    d.sizes.length > 0 || d.state === 'DRAFT'
      ? section(
          'Sizes',
          table<DrawSize>(
            [
              { label: 'Size', cell: (s) => h('span', { data: { testid: 'size-label' } }, sizeFieldLabel(s.label)), kind: ['nowrap'] },
              { label: 'Pieces', cell: (s) => formatCount(s.pieces), kind: ['num'] },
              { label: 'Reserved', cell: (s) => formatCount(s.reserved), kind: ['num'] },
              { label: 'Entered', cell: (s) => formatCount(s.entered), kind: ['num'] },
              { label: 'Held or sold', cell: (s) => formatCount(s.held), kind: ['num'] },
              { label: 'Waiting list', cell: (s) => formatCount(s.waitlisted), kind: ['num'] },
              {
                label: '',
                cell: (s) => h('span', { class: 'row-actions' }, sizeOfferable(d, s, role) ? button('Offer next', { kind: 'ghost', testId: 'size-offer-next', onClick: () => offerNextIn(s) }) : null),
                kind: ['actions'],
              },
            ],
            d.sizes,
            { empty: 'No sizes yet: give the release its sizes and their pieces before publishing it.', caption: 'Sizes' },
          ),
          { id: 'sizes', note: `${formatCount(d.quantity)} ${d.quantity === 1 ? 'piece' : 'pieces'} in all` },
        )
      : null;

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
  // Plan NEXT LOT §3.6.F: a draw with sizes filters its entries by size.
  const sized = d.sizes.length > 0;
  const sizeFilter = sized ? select('size', [{ value: '', label: 'All sizes' }, ...d.sizes.map((s) => ({ value: s.id, label: sizeFieldLabel(s.label) }))], sizeId ?? '') : null;
  sizeFilter?.addEventListener('change', () => ctx.setQuery({ size: sizeFilter.value, page: undefined }));
  const now = ctx.now();
  const list = section(
    'Entries',
    [
      filterBar(field('Status', statusFilter), ...(sizeFilter ? [field('Size', sizeFilter)] : [])),
      table<DropEntry>(
        [
          { label: 'Rank', cell: (e) => (e.rank === null ? h('span', { class: 'soft' }, '—') : formatCount(e.rank)), kind: ['num'] },
          { label: 'Entry', cell: (e) => mono(e.id, e.id.slice(0, 8)), kind: ['nowrap'] },
          {
            label: 'Account',
            cell: (e) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: e.accountId }), 'data-testid': 'entry-account' } }, e.email), testTag(e.email)),
            kind: ['wide'],
          },
          ...(sized ? [{ label: 'Size', cell: (e: DropEntry) => h('span', { data: { testid: 'entry-size' } }, e.size ? sizeFieldLabel(e.size.label) : '—'), kind: ['nowrap' as const] }] : []),
          { label: 'Tier', cell: (e) => tierName(e.tier), kind: ['nowrap'] },
          { label: 'Seniority', cell: (e) => (e.seniority === null ? '—' : `${e.seniority} ${e.seniority === 1 ? 'yr' : 'yrs'}`), kind: ['nowrap'] },
          {
            label: 'Status',
            cell: (e) =>
              h(
                'span',
                { data: { testid: 'entry-status' } },
                statusMark(humanize(e.status), toneOf('dropEntry', e.status)),
                e.guaranteed ? h('span', { class: 'row-marks' }, statusMark('GUARANTEED', 'outline')) : null,
                e.guaranteed && e.pieces > 1 ? h('span', { class: 'cell-sub' }, `${e.pieces} pieces`) : null,
                e.reserved ? h('span', { class: 'cell-sub', data: { testid: 'entry-reserved' } }, 'Reserved directly') : null,
                e.status === 'SELECTED' && e.respondBy ? h('span', { class: 'cell-sub' }, `Held until ${formatDateTime(e.respondBy)}`) : null,
                e.handledBy ? h('span', { class: 'cell-sub' }, `${e.handledBy.email} · ${formatDateTime(e.handledAt)}`) : null,
                e.note ? h('span', { class: 'cell-details' }, e.note) : null,
              ),
          },
          {
            label: '',
            cell: (e) => {
              const a = entryActions(e, role, now, d.state === 'CANCELLED');
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
          empty: status || sizeId
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
    withServerPanel(
      [release, ...(sizesSection ? [sizesSection] : []), testEntrantsSection(ctx, { mode: 'DRAW', dropId: d.id, eyebrow, start: drawTestStart(d, ctx.now()), sizes: d.sizes.map((z) => ({ id: z.id, label: z.label })) }, tests), guaranteesSection(guarantees.items), list],
      serverStatusPanel(ctx),
    ),
  );
}

/** IN-01: the release's guarantees (set aside for it, or used in it); the emails masked for an AUDITOR by the server. */
export function guaranteesSection(items: ReleaseGuarantee[], kind: 'DRAW' | 'LIVE' = 'DRAW'): HTMLElement {
  return section(
    'Guarantees',
    table<ReleaseGuarantee>(
      [
        { label: 'Account', cell: (g) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: g.account.id }), 'data-testid': 'guarantee-account' } }, g.account.email), kind: ['wide'] },
        { label: 'Pieces', cell: (g) => formatCount(g.pieces), kind: ['num'] },
        { label: 'Shown', cell: (g) => (g.visible ? 'Yes' : 'No'), kind: ['nowrap'] },
        { label: 'Status', cell: (g) => statusMark(GUARANTEE_STATE_LABELS[g.state], toneOf('guarantee', g.state)), kind: ['nowrap'] },
        { label: 'Entry', cell: (g) => (g.entry ? mono(g.entry.id, g.entry.id.slice(0, 8)) : '—'), kind: ['nowrap'] },
        { label: 'Valid until', cell: (g) => validUntilText(g), kind: ['nowrap'] },
      ],
      items,
      { empty: 'No guarantee: granted from a client sheet.', caption: 'Guarantees' },
    ),
    { id: 'guarantees', note: kind === 'LIVE' ? 'Places guaranteed by the house: first in line in their size' : 'Places guaranteed by the house: selected first, for their pieces' },
  );
}
