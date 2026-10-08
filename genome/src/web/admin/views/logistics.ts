/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.4.1, `#/logistics`): the page of a LOGISTICS login, a person
 * at the logistics agent, and its only one (`logisticsOnly`: any other address leads back here); for ORBES staff, the
 * same page for every location, in the Atelier's place in the sidebar. Its tabs, by `?tab=`:
 *
 *  - Stock: every size of every model and variant at each location, 0 included: on hand, reserved, available, waiting,
 *    the minimum. The agent proposes a correction, which ORBES approves. ORBES staff read the location, what to order
 *    (TO ORDER) and the sizes whose count no ORBES identity backs (NO PIECE · 3, with the notice over the table), and
 *    act at once (OPERATOR): Transfer, Correct, Minimum, Count pieces in. An AUDITOR reads.
 *  - Returns (n): the parcels expected back at the location (returns, size exchanges, parcels back to sender or
 *    damaged); the agent records each one, the piece OK or damaged, and ORBES decides on the order's page.
 *  - Corrections (n): the agent's proposals and their status; ORBES approves or declines (with a note) those to approve.
 *
 * With several locations, a Location filter (`?locationId=`). The server narrows every list to the login's locations
 * and never sends the agent a price, an email, an account or a release. Each request is audited by the server; the page
 * is read again.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount, formatDate } from '../format.js';
import {
  approveText,
  CASE_KIND_LABELS,
  casePieces,
  CORRECTION_STATUS_LABELS,
  correctionInput,
  correctionProblem,
  CORRECTIONS_TEXT,
  countInProblem,
  countInText,
  deltaText,
  LOGISTICS_LEAD,
  LOGISTICS_LIMITS,
  LOGISTICS_TABS,
  locationFilter,
  logisticsTab,
  minimumProblem,
  minimumValue,
  noPieceMark,
  offersLocationFilter,
  receiveProblem,
  RETURNS_TEXT,
  serialsOf,
  sizeText,
  skuWords,
  STOCK_TEXT,
  tabText,
  transferProblem,
  unbackedNotice,
  type LogisticsCounts,
  type LogisticsTab,
} from '../model/logistics.js';
import { can, logisticsOnly } from '../model/permissions.js';
import type { Tone } from '../model/tone.js';
import { href } from '../router.js';
import type { CaseToReceive, LogisticsLocation, LogisticsStock, LogisticsStockRow, StockCorrection, StockCorrectionStatus } from '../types.js';
import { button, field, filterBar, mono, pageHeader, section, select, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const CORRECTION_TONES: Readonly<Record<StockCorrectionStatus, Tone>> = Object.freeze({ TO_APPROVE: 'outline', APPROVED: 'solid', DECLINED: 'muted' });

/** The tabs: links, the current one marked (as the Club's), each counter in the reading face. */
function logisticsTabs(current: LogisticsTab, counts: LogisticsCounts, locationId: string | undefined): HTMLElement {
  return h(
    'nav',
    { class: 'range logistics__tabs', attrs: { 'aria-label': 'Logistics' } },
    ...LOGISTICS_TABS.flatMap((t, i) => {
      const [label, figure] = tabText(t.id, counts);
      return [
        i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
        h(
          'a',
          { class: 'range__tab', attrs: { href: href('logistics', {}, { tab: t.id, locationId }), 'aria-current': t.id === current ? 'page' : null, 'data-testid': `logistics-tab-${t.id}` } },
          label,
          figure ? ' ' : null,
          figure ? h('span', { class: 'range__figure' }, figure) : null,
        ),
      ];
    }),
  );
}

export async function logisticsView(ctx: ViewContext): Promise<HTMLElement> {
  const tab = logisticsTab(ctx.route.query);
  // Every tab reads the counters, and the scope's locations come with the parcels' board.
  const [parcels, cases, corrections] = await Promise.all([ctx.api.parcels(), ctx.api.casesToReceive(), ctx.api.stockCorrections()]);
  const locations = parcels.locations;
  const locationId = locationFilter(ctx.route.query, locations);
  const here = <T extends { location: { id: string } }>(rows: readonly T[]) => (locationId ? rows.filter((r) => r.location.id === locationId) : [...rows]);
  const toReceive = here(cases.items);
  const listed = here(corrections.items);
  const counts: LogisticsCounts = { returns: toReceive.length, corrections: listed.filter((c) => c.status === 'TO_APPROVE').length };

  let body: Child[];
  if (tab === 'returns') body = [returnsTab(ctx, toReceive, locations)];
  else if (tab === 'corrections') body = [correctionsTab(ctx, listed, locations)];
  else body = [stockTab(ctx, await ctx.api.logisticsStock(locationId ? { locationId } : {}))];

  let filter: HTMLElement | null = null;
  if (offersLocationFilter(locations)) {
    const where = select('locationId', [{ value: '', label: 'Every location' }, ...locations.map((l) => ({ value: l.id, label: l.name }))], locationId ?? '');
    where.setAttribute('data-testid', 'logistics-location');
    where.addEventListener('change', () => ctx.setQuery({ locationId: where.value }));
    filter = filterBar(field('Location', where));
  }

  return h(
    'div',
    { class: 'view view--logistics', data: { testid: 'logistics' } },
    pageHeader({ eyebrow: 'Registry', title: 'Logistics', lead: LOGISTICS_LEAD, actions: [logisticsTabs(tab, counts, locationId)] }),
    filter,
    ...body,
  );
}

/** After a dialog: its toast, and the page read again. */
function after(ctx: ViewContext, message: string): (v: unknown) => void {
  return (v) => {
    if (!v) return;
    notify(message);
    ctx.reload();
  };
}

// ── Stock ──────────────────────────────────────────────────────────────────

function stockTab(ctx: ViewContext, stock: LogisticsStock): HTMLElement {
  const role = ctx.session.admin.role;
  const agent = logisticsOnly(role);
  const manage = !agent && can(role, 'manageStock');
  const propose = agent && can(role, 'logistics');
  const showLocation = !agent || stock.locations.length > 1;
  const locationOptions = stock.locations.map((l) => ({ value: l.id, label: l.name }));
  const title = (r: LogisticsStockRow) => `${skuWords(r.sku)} · ${r.location.name}`;
  const deltaField = { name: 'delta', label: 'Pieces', required: true, maxlength: 6, hint: STOCK_TEXT.piecesHint };
  const reasonField = { name: 'reason', label: 'Why', kind: 'textarea' as const, required: true, maxlength: LOGISTICS_LIMITS.reason };

  const proposeCorrection = (r: LogisticsStockRow) =>
    void openDialog({
      title: STOCK_TEXT.propose,
      eyebrow: title(r),
      body: h('p', { class: 'dialog__text' }, STOCK_TEXT.proposeText),
      fields: [deltaField, reasonField],
      validate: correctionProblem,
      confirmLabel: 'Propose',
      submit: async (v) => {
        await ctx.api.proposeCorrection(correctionInput(r.sku.id, r.location.id, v));
      },
    }).then(after(ctx, STOCK_TEXT.proposed));
  const correct = (r: LogisticsStockRow) =>
    void openDialog({
      title: STOCK_TEXT.correctTitle,
      eyebrow: title(r),
      body: h('p', { class: 'dialog__text' }, STOCK_TEXT.correctText),
      fields: [deltaField, reasonField],
      validate: correctionProblem,
      confirmLabel: STOCK_TEXT.correct,
      submit: async (v) => {
        await ctx.api.proposeCorrection(correctionInput(r.sku.id, r.location.id, v));
      },
    }).then(after(ctx, STOCK_TEXT.corrected));
  const transfer = (r: LogisticsStockRow) =>
    void openDialog({
      title: STOCK_TEXT.transfer,
      eyebrow: skuWords(r.sku),
      body: h('p', { class: 'dialog__text' }, STOCK_TEXT.transferText),
      fields: [
        { name: 'fromLocationId', label: 'From', kind: 'select', options: locationOptions, value: r.location.id },
        { name: 'toLocationId', label: 'To', kind: 'select', options: locationOptions, value: locationOptions.find((l) => l.value !== r.location.id)?.value ?? '' },
        { name: 'quantity', label: 'Pieces', required: true, maxlength: 5, value: '1' },
        { name: 'note', label: 'Note', kind: 'textarea', maxlength: LOGISTICS_LIMITS.note, hint: 'Optional.' },
      ],
      validate: transferProblem,
      confirmLabel: STOCK_TEXT.transfer,
      submit: async (v) => {
        await ctx.api.logisticsTransfer({ skuId: r.sku.id, fromLocationId: v.fromLocationId, toLocationId: v.toLocationId, quantity: Number(v.quantity), ...(v.note.trim() ? { note: v.note.trim() } : {}) });
      },
    }).then(after(ctx, STOCK_TEXT.transferred));
  const minimum = (r: LogisticsStockRow) =>
    void openDialog({
      title: STOCK_TEXT.minimum,
      eyebrow: title(r),
      body: h('p', { class: 'dialog__text' }, STOCK_TEXT.minimumText),
      fields: [{ name: 'minimum', label: 'Minimum', maxlength: 5, value: r.minimum === null ? '' : String(r.minimum), hint: `1 to ${formatCount(LOGISTICS_LIMITS.minimum)} pieces.` }],
      validate: minimumProblem,
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setLogisticsMinimum({ skuId: r.sku.id, locationId: r.location.id, minimum: minimumValue(v) });
      },
    }).then(after(ctx, STOCK_TEXT.minimumSaved));
  const countIn = (r: LogisticsStockRow) =>
    void openDialog({
      title: STOCK_TEXT.countIn,
      eyebrow: skuWords(r.sku),
      body: h('p', { class: 'dialog__text' }, countInText(r.sku)),
      fields: [
        { name: 'serials', label: 'Serials', kind: 'textarea', required: true, rows: 4, maxlength: 2000, hint: STOCK_TEXT.serialsHint },
        { name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: LOGISTICS_LIMITS.reason },
      ],
      validate: countInProblem,
      confirmLabel: STOCK_TEXT.countInConfirm,
      submit: async (v) => {
        await ctx.api.countIn({ skuId: r.sku.id, productIds: serialsOf(v.serials), note: v.note.trim() });
      },
    }).then(after(ctx, STOCK_TEXT.countedIn));

  const actions = (r: LogisticsStockRow): HTMLElement | null => {
    const buttons = propose
      ? [button(STOCK_TEXT.propose, { kind: 'ghost', testId: 'stock-propose', onClick: () => proposeCorrection(r) })]
      : manage
        ? [
            noPieceMark(r.unbacked) ? button(STOCK_TEXT.countIn, { kind: 'secondary', testId: 'stock-count-in', onClick: () => countIn(r) }) : null,
            stock.locations.length > 1 && r.available > 0 ? button(STOCK_TEXT.transfer, { kind: 'ghost', testId: 'stock-transfer', onClick: () => transfer(r) }) : null,
            button(STOCK_TEXT.correct, { kind: 'ghost', testId: 'stock-correct', onClick: () => correct(r) }),
            button(STOCK_TEXT.minimum, { kind: 'ghost', testId: 'stock-minimum', onClick: () => minimum(r) }),
          ]
        : [];
    const shown = buttons.filter((b): b is HTMLButtonElement => b !== null);
    return shown.length ? h('span', { class: 'row-actions' }, ...shown) : null;
  };

  const columns: Column<LogisticsStockRow>[] = [
    { label: 'Model', cell: (r) => r.sku.model.name },
    { label: 'Variant', cell: (r) => r.sku.variant ?? '—', kind: ['nowrap'] },
    {
      label: 'Size',
      cell: (r) => {
        const mark = agent ? null : noPieceMark(r.unbacked);
        return h(
          'span',
          { data: { testid: 'stock-size' } },
          sizeText(r.sku.sizeLabel),
          h('span', { class: 'cell-sub mono' }, r.sku.code),
          r.sku.setAside ? h('span', { class: 'cell-sub', data: { testid: 'stock-set-aside' } }, STOCK_TEXT.setAside) : null,
          mark ? h('span', { class: 'cell-sub', data: { testid: 'stock-no-piece' } }, statusMark(mark, 'alert')) : null,
        );
      },
      kind: ['nowrap'],
    },
    ...(showLocation ? [{ label: 'Location', cell: (r) => r.location.name, kind: ['nowrap'] } satisfies Column<LogisticsStockRow>] : []),
    { label: 'On hand', cell: (r) => formatCount(r.onHand), kind: ['num'] },
    { label: 'Reserved', cell: (r) => formatCount(r.reserved), kind: ['num'] },
    { label: 'Available', cell: (r) => formatCount(r.available), kind: ['num'] },
    { label: 'Waiting', cell: (r) => h('span', { data: { testid: 'stock-waiting' } }, formatCount(r.waiting)), kind: ['num'] },
    { label: 'Minimum', cell: (r) => (r.minimum === null ? '—' : formatCount(r.minimum)), kind: ['num'] },
    ...(agent
      ? []
      : [
          {
            label: 'To order',
            cell: (r) =>
              (r.toOrder ?? 0) > 0
                ? h('span', { class: 'stock__suggest', data: { testid: 'stock-to-order' } }, statusMark('TO ORDER', 'alert'), h('span', { class: 'stock__num' }, formatCount(r.toOrder ?? 0)))
                : '—',
            kind: ['nowrap'],
          } satisfies Column<LogisticsStockRow>,
        ]),
    ...(propose || manage ? [{ label: '', cell: actions, kind: ['actions', 'wrap'] } satisfies Column<LogisticsStockRow>] : []),
  ];
  const notice = agent ? null : unbackedNotice(stock.unbackedSizes);
  return section(
    'Stock',
    [
      h('p', { class: 'panel__text' }, agent ? STOCK_TEXT.leadAgent : STOCK_TEXT.leadStaff),
      notice ? h('p', { class: 'notice', data: { testid: 'stock-unbacked' } }, notice) : null,
      table(columns, stock.rows, { caption: 'Stock', empty: agent ? STOCK_TEXT.emptyAgent : STOCK_TEXT.emptyStaff }),
    ],
    { id: 'logistics-stock', note: `${formatCount(stock.rows.reduce((n, r) => n + r.available, 0))} available` },
  );
}

// ── Returns ────────────────────────────────────────────────────────────────

function returnsTab(ctx: ViewContext, items: CaseToReceive[], locations: readonly LogisticsLocation[]): HTMLElement {
  const role = ctx.session.admin.role;
  const agent = logisticsOnly(role);
  const act = can(role, 'logistics');
  const received = (c: CaseToReceive) =>
    void openDialog({
      title: RETURNS_TEXT.dialogTitle,
      eyebrow: `${c.order.reference} · ${CASE_KIND_LABELS[c.kind]}`,
      body: h('p', { class: 'dialog__text' }, RETURNS_TEXT.dialogText),
      fields: [
        {
          name: 'pieceState',
          label: 'The piece',
          kind: 'select',
          required: true,
          options: [
            { value: '', label: 'Choose' },
            { value: 'OK', label: 'OK' },
            { value: 'DAMAGED', label: 'Damaged' },
          ],
          value: '',
        },
        { name: 'note', label: 'Note', kind: 'textarea', maxlength: LOGISTICS_LIMITS.receiveNote, hint: 'Optional.' },
      ],
      validate: receiveProblem,
      confirmLabel: RETURNS_TEXT.received,
      submit: async (v) => {
        await ctx.api.receiveCase(c.id, { pieceState: v.pieceState as 'OK' | 'DAMAGED', note: v.note.trim() || null });
      },
    }).then(after(ctx, RETURNS_TEXT.done));
  const columns: Column<CaseToReceive>[] = [
    {
      label: 'Order',
      // The agent never reads an order's page: its reference only.
      cell: (c) => (agent ? mono(c.order.reference) : h('a', { class: 'idlink mono', attrs: { href: href('order', { orderId: c.order.id }) } }, c.order.reference)),
      kind: ['nowrap'],
    },
    { label: 'Kind', cell: (c) => h('span', { data: { testid: 'case-kind' } }, statusMark(CASE_KIND_LABELS[c.kind], 'outline')), kind: ['nowrap'] },
    { label: 'Piece', cell: (c) => h('span', null, ...casePieces(c).map((p) => h('span', { class: 'cell-details' }, p))), kind: ['wide'] },
    ...(locations.length > 1 ? [{ label: 'Location', cell: (c) => c.location.name, kind: ['nowrap'] } satisfies Column<CaseToReceive>] : []),
    { label: 'Opened on', cell: (c) => formatDate(c.openedAt), kind: ['nowrap'] },
    ...(act ? [{ label: '', cell: (c) => button(RETURNS_TEXT.received, { kind: 'ghost', testId: 'case-received', onClick: () => received(c) }), kind: ['actions'] } satisfies Column<CaseToReceive>] : []),
  ];
  return section(RETURNS_TEXT.title, table(columns, items, { caption: RETURNS_TEXT.title, empty: RETURNS_TEXT.empty }), { id: 'logistics-returns' });
}

// ── Corrections ────────────────────────────────────────────────────────────

function correctionsTab(ctx: ViewContext, items: StockCorrection[], locations: readonly LogisticsLocation[]): HTMLElement {
  const role = ctx.session.admin.role;
  const decide = !logisticsOnly(role) && can(role, 'approveCorrections');
  const eyebrow = (c: StockCorrection) => `${skuWords(c.sku)} · ${c.location.name}`;
  const approve = (c: StockCorrection) =>
    void openDialog({
      title: CORRECTIONS_TEXT.approveTitle,
      eyebrow: eyebrow(c),
      body: [h('p', { class: 'dialog__text' }, approveText(c)), h('p', { class: 'dialog__text prewrap' }, `Why: ${c.reason}`)],
      confirmLabel: CORRECTIONS_TEXT.approve,
      submit: async () => {
        await ctx.api.approveCorrection(c.id);
      },
    }).then(after(ctx, CORRECTIONS_TEXT.approved));
  const decline = (c: StockCorrection) =>
    void openDialog({
      title: CORRECTIONS_TEXT.declineTitle,
      eyebrow: eyebrow(c),
      body: h('p', { class: 'dialog__text' }, CORRECTIONS_TEXT.declineText),
      fields: [{ name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: LOGISTICS_LIMITS.note }],
      validate: (v) => (v.note.trim().length > LOGISTICS_LIMITS.note ? `A note has at most ${LOGISTICS_LIMITS.note} characters.` : null),
      confirmLabel: CORRECTIONS_TEXT.decline,
      submit: async (v) => {
        await ctx.api.declineCorrection(c.id, v.note.trim());
      },
    }).then(after(ctx, CORRECTIONS_TEXT.declined));
  const columns: Column<StockCorrection>[] = [
    { label: 'Proposed', cell: (c) => formatDate(c.proposedAt), kind: ['nowrap'] },
    { label: 'Size', cell: (c) => h('span', null, skuWords(c.sku), h('span', { class: 'cell-sub mono' }, c.sku.code)) },
    ...(locations.length > 1 ? [{ label: 'Location', cell: (c) => c.location.name, kind: ['nowrap'] } satisfies Column<StockCorrection>] : []),
    { label: 'Pieces', cell: (c) => h('span', { data: { testid: 'correction-delta' } }, deltaText(c.delta)), kind: ['num'] },
    { label: 'Why', cell: (c) => h('span', { class: 'prewrap' }, c.reason), kind: ['wide'] },
    {
      label: 'Status',
      cell: (c) =>
        h(
          'span',
          { data: { testid: 'correction-status' } },
          statusMark(CORRECTION_STATUS_LABELS[c.status], CORRECTION_TONES[c.status]),
          c.decisionNote ? h('span', { class: 'cell-sub prewrap', data: { testid: 'correction-note' } }, c.decisionNote) : null,
        ),
      kind: ['nowrap'],
    },
    ...(decide
      ? [
          {
            label: '',
            cell: (c) =>
              c.status === 'TO_APPROVE'
                ? h(
                    'span',
                    { class: 'row-actions' },
                    button(CORRECTIONS_TEXT.approve, { kind: 'secondary', testId: 'correction-approve', onClick: () => approve(c) }),
                    button(CORRECTIONS_TEXT.decline, { kind: 'ghost', testId: 'correction-decline', onClick: () => decline(c) }),
                  )
                : null,
            kind: ['actions'],
          } satisfies Column<StockCorrection>,
        ]
      : []),
  ];
  return section('Corrections', [h('p', { class: 'panel__text' }, CORRECTIONS_TEXT.lead), table(columns, items, { caption: 'Corrections', empty: CORRECTIONS_TEXT.empty })], { id: 'logistics-corrections' });
}
