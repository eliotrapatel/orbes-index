/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.4.1, `#/logistics`): the page of a LOGISTICS login, a person
 * at the logistics agent, and its only one (`logisticsOnly`: any other address leads back here); for ORBES staff, the
 * same page for every location, in the Atelier's place in the sidebar. Its tabs, by `?tab=`:
 *
 *  - To ship (n), first: the parcels whose paid orders all hold their piece in stock, the oldest first, each with its
 *    pieces, add-ons, engraving, where it goes, its step and the marks LATE and ADDRESS CHANGED, to its parcel's page
 *    (views/shipping.ts); On its way: the parcels shipped, Mark delivered.
 *  - Receptions (n): the agent opens a delivery by its supplier order's reference (never a list of them); ORBES staff
 *    read the supplier orders Expected. To confirm (ORBES: Confirm, Send back; the agent: Count again), Cards to print
 *    in fixed runs once every identity is issued, then Cards attached; Back to the supplier (Sent back).
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
  addToOrderText,
  cardsLine,
  expectedEmpty,
  expectedLead,
  issuingLine,
  RECEPTION_STATUS_LABELS,
  RECEPTION_TEXT,
  receptionSummary,
  referenceProblem,
  runLabel,
  skippedLine,
  supplierReturnLine,
  supplierReturnProblem,
  othersText,
  PACKING_TEXT,
  PARCEL_STEP_LABELS,
  shipToLine,
  TO_SHIP_TEXT,
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
import { addQuantityProblem } from '../model/supplier-orders.js';
import type { Tone } from '../model/tone.js';
import { href } from '../router.js';
import type { CaseToReceive, ExpectedSupplierOrder, LogisticsLocation, LogisticsStock, LogisticsStockRow, OnItsWayRow, ReceptionsBoard, ReceptionView, StockCorrection, StockCorrectionStatus, SupplierReturnItem, ToShipRow } from '../types.js';
import { button, emptyState, field, filterBar, input, linkButton, mono, pageHeader, section, select, statusMark, table, type Column } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import { confirmButton, sendBackButton } from './reception.js';
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
  const [parcels, cases, corrections, receptions] = await Promise.all([ctx.api.parcels(), ctx.api.casesToReceive(), ctx.api.stockCorrections(), ctx.api.receptions()]);
  const locations = parcels.locations;
  const locationId = locationFilter(ctx.route.query, locations);
  const here = <T extends { location: { id: string } }>(rows: readonly T[]) => (locationId ? rows.filter((r) => r.location.id === locationId) : [...rows]);
  const toReceive = here(cases.items);
  const listed = here(corrections.items);
  const toShip = here(parcels.toShip);
  const onItsWay = here(parcels.onItsWay);
  const board: ReceptionsBoard = {
    toConfirm: here(receptions.toConfirm),
    cardsToPrint: here(receptions.cardsToPrint),
    backToSupplier: receptions.backToSupplier,
    carriers: receptions.carriers,
    ...(receptions.expected ? { expected: here(receptions.expected) } : {}),
    count: 0,
  };
  // The server's rule, on the location shown: the agent's receptions waiting or sent back and its cards to print; ORBES's to confirm.
  board.count = logisticsOnly(ctx.session.admin.role) ? board.toConfirm.length + board.cardsToPrint.length : board.toConfirm.filter((r) => r.status === 'TO_CONFIRM').length;
  const counts: LogisticsCounts = { ship: toShip.length, receptions: board.count, returns: toReceive.length, corrections: listed.filter((c) => c.status === 'TO_APPROVE').length };

  let body: Child[];
  if (tab === 'ship') body = shipTab(ctx, toShip, onItsWay, locations);
  else if (tab === 'receptions') body = receptionsTab(ctx, board, locations, locationId);
  else if (tab === 'returns') body = [returnsTab(ctx, toReceive, locations)];
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

// ── To ship ────────────────────────────────────────────────────────────────

function shipTab(ctx: ViewContext, toShip: ToShipRow[], onItsWay: OnItsWayRow[], locations: readonly LogisticsLocation[]): HTMLElement[] {
  const act = can(ctx.session.admin.role, 'logistics');
  const several = locations.length > 1;
  // The agent packs on the parcel's page; ORBES staff take every step from the order's page (§3.5.4.1).
  const target = (id: string) => (logisticsOnly(ctx.session.admin.role) ? href('logisticsOrder', { orderId: id }) : href('order', { orderId: id }));
  const parcelLink = (id: string, reference: string) => h('a', { class: 'idlink mono', attrs: { href: target(id) }, data: { testid: 'parcel-link' } }, reference);
  const deliver = (r: OnItsWayRow) =>
    void openDialog({
      title: PACKING_TEXT.deliveredTitle,
      eyebrow: r.reference,
      body: h('p', { class: 'dialog__text' }, PACKING_TEXT.deliveredText),
      confirmLabel: PACKING_TEXT.deliveredTitle,
      submit: async () => {
        await ctx.api.markParcelDelivered(r.id);
      },
    }).then(after(ctx, PACKING_TEXT.deliveredToast));
  const toShipColumns: Column<ToShipRow>[] = [
    {
      label: 'Order',
      cell: (r) => h('span', null, parcelLink(r.id, r.reference), othersText(r.others) ? h('span', { class: 'cell-sub', data: { testid: 'parcel-others' } }, othersText(r.others)!) : null),
      kind: ['nowrap'],
    },
    { label: 'Ready since', cell: (r) => formatDate(r.readySince), kind: ['nowrap'] },
    { label: 'Pieces', cell: (r) => h('span', { data: { testid: 'parcel-pieces' } }, ...r.pieces.map((p) => h('span', { class: 'cell-details' }, skuWords(p)))) },
    { label: 'Add-ons', cell: (r) => (r.addons.length ? r.addons.join(' · ') : '—') },
    { label: 'Engraving', cell: (r) => (r.engraving ? 'Yes' : '—'), kind: ['nowrap'] },
    { label: 'Ship to', cell: (r) => shipToLine(r.shipTo) },
    ...(several ? [{ label: 'Location', cell: (r) => r.location.name, kind: ['nowrap'] } satisfies Column<ToShipRow>] : []),
    {
      label: 'Step',
      cell: (r) =>
        h(
          'span',
          { class: 'parcel__marks', data: { testid: 'parcel-step' } },
          statusMark(PARCEL_STEP_LABELS[r.step], r.step === 'PACKED' ? 'solid' : 'outline'),
          r.late ? h('span', { class: 'cell-sub', data: { testid: 'parcel-late' } }, statusMark('LATE', 'alert')) : null,
          r.addressChanged ? h('span', { class: 'cell-sub', data: { testid: 'parcel-address-changed' } }, statusMark('ADDRESS CHANGED', 'alert')) : null,
        ),
      kind: ['nowrap'],
    },
  ];
  const onItsWayColumns: Column<OnItsWayRow>[] = [
    { label: 'Order', cell: (r) => parcelLink(r.id, r.reference), kind: ['nowrap'] },
    { label: 'Shipped', cell: (r) => formatDate(r.shippedAt), kind: ['nowrap'] },
    { label: 'Carrier', cell: (r) => r.carrier.name },
    { label: 'Tracking number', cell: (r) => h('a', { class: 'idlink', attrs: { href: r.trackingUrl, target: '_blank', rel: 'noopener noreferrer' } }, r.trackingNumber), kind: ['nowrap'] },
    ...(several ? [{ label: 'Location', cell: (r) => r.location.name, kind: ['nowrap'] } satisfies Column<OnItsWayRow>] : []),
    ...(act ? [{ label: '', cell: (r) => button(PACKING_TEXT.deliveredTitle, { kind: 'ghost', testId: 'parcel-delivered', onClick: () => deliver(r) }), kind: ['actions'] } satisfies Column<OnItsWayRow>] : []),
  ];
  return [
    section(TO_SHIP_TEXT.title, [h('p', { class: 'panel__text' }, TO_SHIP_TEXT.lead), table(toShipColumns, toShip, { caption: TO_SHIP_TEXT.title, empty: TO_SHIP_TEXT.empty })], { id: 'logistics-ship' }),
    section(TO_SHIP_TEXT.onItsWay, table(onItsWayColumns, onItsWay, { caption: TO_SHIP_TEXT.onItsWay, empty: TO_SHIP_TEXT.onItsWayEmpty }), { id: 'logistics-on-its-way' }),
  ];
}

// ── Receptions ─────────────────────────────────────────────────────────────

function receptionsTab(ctx: ViewContext, board: ReceptionsBoard, locations: readonly LogisticsLocation[], locationId: string | undefined): HTMLElement[] {
  const role = ctx.session.admin.role;
  const agent = logisticsOnly(role);
  const act = can(role, 'logistics');
  const confirm = !agent && can(role, 'confirmReceptions');
  const several = locations.length > 1;
  const where = locationId ? (locations.find((l) => l.id === locationId)?.name ?? null) : locations.length === 1 ? locations[0]!.name : null;
  const out: HTMLElement[] = [];

  // The agent's one way in: the reference on the delivery note.
  if (agent && act) {
    const reference = input('reference', { maxlength: 40, placeholder: 'SO-7C21A0B9', mono: true });
    reference.setAttribute('data-testid', 'reception-reference');
    const error = h('p', { class: 'form-error', attrs: { role: 'alert', 'aria-live': 'assertive' }, data: { testid: 'reception-reference-error' } });
    const open = button(RECEPTION_TEXT.open, { kind: 'primary', type: 'submit', testId: 'reception-open' });
    const form = h('form', { class: 'filters', attrs: { novalidate: true } }, field('Supplier order', reference, { hint: RECEPTION_TEXT.referenceHint }), open);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const problem = referenceProblem(reference.value);
      if (problem) {
        error.textContent = problem;
        return;
      }
      open.disabled = true;
      try {
        const order = await ctx.api.findReception(reference.value.trim());
        ctx.navigate(href('receptionNew', {}, { supplierOrder: order.id }));
      } catch (e) {
        open.disabled = false;
        error.textContent = e instanceof Error ? e.message : 'The supplier order could not be found.';
      }
    });
    out.push(section(RECEPTION_TEXT.receiveTitle, [h('p', { class: 'panel__text' }, RECEPTION_TEXT.receiveLead), form, error], { id: 'logistics-receive' }));
  }

  // ORBES staff: the supplier orders on their way (never the agent's).
  if (board.expected) {
    out.push(
      section(
        RECEPTION_TEXT.expectedTitle,
        [
          h('p', { class: 'panel__text' }, expectedLead(where)),
          table(
            [
              { label: 'Supplier order', cell: (x) => h('span', { class: 'mono' }, x.reference), kind: ['nowrap'] },
              { label: 'Supplier', cell: (x) => x.supplierName },
              ...(several ? [{ label: 'Location', cell: (x) => x.location.name, kind: ['nowrap'] } satisfies Column<ExpectedSupplierOrder>] : []),
              { label: 'Expected on', cell: (x) => (x.expectedOn ? formatDate(x.expectedOn) : '—'), kind: ['nowrap'] },
              { label: 'Pieces expected', cell: (x) => formatCount(x.piecesExpected), kind: ['num'] },
              ...(act ? [{ label: '', cell: (x) => linkButton(RECEPTION_TEXT.receive, href('receptionNew', {}, { supplierOrder: x.id }), 'ghost'), kind: ['actions'] } satisfies Column<ExpectedSupplierOrder>] : []),
            ],
            board.expected,
            { caption: RECEPTION_TEXT.expectedTitle, empty: expectedEmpty(where) },
          ),
        ],
        { id: 'logistics-expected' },
      ),
    );
  }

  // To confirm: the counts waiting for ORBES, or sent back to the agent.
  const sendBack = (r: ReceptionView) => sendBackButton(ctx, r);
  out.push(
    section(
      RECEPTION_TEXT.toConfirmTitle,
      table(
        [
          { label: 'Reception', cell: (r) => h('a', { class: 'idlink', attrs: { href: href('reception', { receptionId: r.id }) }, data: { testid: 'reception-summary' } }, receptionSummary(r)) },
          ...(several ? [{ label: 'Location', cell: (r) => r.location.name, kind: ['nowrap'] } satisfies Column<ReceptionView>] : []),
          { label: 'Counted', cell: (r) => formatDate(r.countedAt), kind: ['nowrap'] },
          {
            label: 'Status',
            cell: (r) =>
              h(
                'span',
                { data: { testid: 'reception-status' } },
                statusMark(RECEPTION_STATUS_LABELS[r.status], r.status === 'SENT_BACK' ? 'alert' : 'outline'),
                r.sentBack ? h('span', { class: 'cell-sub prewrap', data: { testid: 'reception-sent-back-note' } }, r.sentBack.note) : null,
              ),
            kind: ['nowrap'],
          },
          {
            label: '',
            cell: (r) =>
              h(
                'span',
                { class: 'row-actions' },
                act && r.status === 'SENT_BACK' ? linkButton(RECEPTION_TEXT.countAgain, href('reception', { receptionId: r.id }), 'secondary') : null,
                confirm && r.status === 'TO_CONFIRM' ? confirmButton(ctx, r) : null,
                confirm && r.status === 'TO_CONFIRM' ? sendBack(r) : null,
              ),
            kind: ['actions'],
          },
        ],
        board.toConfirm,
        { caption: RECEPTION_TEXT.toConfirmTitle, empty: RECEPTION_TEXT.toConfirmEmpty },
      ),
      { id: 'logistics-to-confirm' },
    ),
  );

  // Cards to print, in fixed runs; Cards attached.
  const printRun = (r: ReceptionView, layout: 'sheet' | 'card', run: number, runs: number) => {
    const b = button(runLabel(layout, run, runs), { kind: 'ghost', testId: `reception-print-${layout}`, disabled: !r.issuing.done });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const file = await ctx.api.receptionCards(r.id, { layout, run });
        saveDownload(file);
        const skipped = skippedLine(file.skipped);
        notify(skipped ?? 'Cards printed.');
      } catch (e) {
        notifyError(e);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  const attached = (r: ReceptionView) =>
    button(RECEPTION_TEXT.attached, {
      kind: 'primary',
      testId: 'reception-attached',
      disabled: !r.issuing.done,
      onClick: () =>
        void openDialog({
          title: RECEPTION_TEXT.attached,
          eyebrow: r.supplierOrder.reference,
          body: h('p', { class: 'dialog__text' }, RECEPTION_TEXT.attachedText),
          confirmLabel: RECEPTION_TEXT.attached,
          submit: async () => {
            await ctx.api.cardsAttached(r.id);
          },
        }).then(after(ctx, RECEPTION_TEXT.attachedToast)),
    });
  out.push(
    section(
      RECEPTION_TEXT.cardsTitle,
      [
        h('p', { class: 'panel__text' }, RECEPTION_TEXT.cardsText),
        board.cardsToPrint.length
          ? h(
              'div',
              { class: 'cards-to-print' },
              ...board.cardsToPrint.map((r) =>
                h(
                  'div',
                  { class: 'cards-to-print__item', data: { testid: 'reception-cards' } },
                  h('p', { class: 'cards-to-print__title' }, cardsLine(r)),
                  issuingLine(r) ? h('p', { class: 'panel__text', data: { testid: 'reception-issuing' } }, issuingLine(r)!) : null,
                  act
                    ? h(
                        'div',
                        { class: 'row-actions' },
                        // While the identities are issued, no run exists yet: the two buttons wait, disabled.
                        ...(r.cards.runs.sheet.length ? r.cards.runs.sheet : [{ run: 1 }]).map((x) => printRun(r, 'sheet', x.run, r.cards.runs.sheet.length)),
                        ...(r.cards.runs.card.length ? r.cards.runs.card : [{ run: 1 }]).map((x) => printRun(r, 'card', x.run, r.cards.runs.card.length)),
                        attached(r),
                      )
                    : null,
                ),
              ),
            )
          : emptyState(RECEPTION_TEXT.cardsEmpty),
      ],
      { id: 'logistics-cards' },
    ),
  );

  // Back to the supplier: the rejected pieces, sent back by the agent.
  const sent = (x: SupplierReturnItem) =>
    void openDialog({
      title: RECEPTION_TEXT.returnSentTitle,
      eyebrow: supplierReturnLine(x),
      fields: [
        { name: 'carrierId', label: 'Carrier', kind: 'select', options: [{ value: '', label: 'None' }, ...board.carriers.map((c) => ({ value: c.id, label: c.name }))], value: '', hint: 'Optional.' },
        { name: 'trackingNumber', label: 'Tracking number', maxlength: 40, hint: 'Optional, with its carrier.' },
      ],
      validate: supplierReturnProblem,
      confirmLabel: RECEPTION_TEXT.returnSent,
      submit: async (v) => {
        await ctx.api.supplierReturnSent(x.id, { carrierId: v.carrierId || null, trackingNumber: v.trackingNumber.trim() || null });
      },
    }).then(after(ctx, RECEPTION_TEXT.returnSentToast));
  out.push(
    section(
      RECEPTION_TEXT.backTitle,
      table(
        [
          { label: 'Pieces', cell: (x) => h('span', { data: { testid: 'supplier-return' } }, supplierReturnLine(x)) },
          ...(act ? [{ label: '', cell: (x) => button(RECEPTION_TEXT.returnSent, { kind: 'ghost', testId: 'supplier-return-sent', onClick: () => sent(x) }), kind: ['actions'] } satisfies Column<SupplierReturnItem>] : []),
        ],
        board.backToSupplier,
        { caption: RECEPTION_TEXT.backTitle, empty: RECEPTION_TEXT.backEmpty },
      ),
      { id: 'logistics-back-to-supplier' },
    ),
  );
  return out;
}

// ── Stock ──────────────────────────────────────────────────────────────────

function stockTab(ctx: ViewContext, stock: LogisticsStock): HTMLElement {
  const role = ctx.session.admin.role;
  const agent = logisticsOnly(role);
  const manage = !agent && (can(role, 'manageStock') || can(role, 'manageSupplierOrders'));
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

  const order = !agent && can(role, 'manageSupplierOrders');
  const addToOrder = (r: LogisticsStockRow) =>
    void openDialog({
      title: STOCK_TEXT.addToOrder,
      eyebrow: title(r),
      body: h('p', { class: 'dialog__text' }, addToOrderText(r)),
      fields: [{ name: 'quantity', label: 'Pieces', required: true, maxlength: 5, value: String(r.toOrder ?? 1) }],
      validate: addQuantityProblem,
      confirmLabel: STOCK_TEXT.addToOrder,
      submit: async (v) => {
        await ctx.api.addToSupplierDraft({ skuId: r.sku.id, locationId: r.location.id, quantity: Number(v.quantity), from: 'PROPOSAL' });
      },
    }).then(after(ctx, STOCK_TEXT.addedToOrder));
  const actions = (r: LogisticsStockRow): HTMLElement | null => {
    const buttons = propose
      ? [button(STOCK_TEXT.propose, { kind: 'ghost', testId: 'stock-propose', onClick: () => proposeCorrection(r) })]
      : manage
        ? [
            order && (r.toOrder ?? 0) > 0 && !r.sku.setAside ? button(STOCK_TEXT.addToOrder, { kind: 'secondary', testId: 'stock-add-to-order', onClick: () => addToOrder(r) }) : null,
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
          { label: 'Expected', cell: (r) => h('span', { data: { testid: 'stock-expected' } }, formatCount(r.expected ?? 0)), kind: ['num'] } satisfies Column<LogisticsStockRow>,
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
