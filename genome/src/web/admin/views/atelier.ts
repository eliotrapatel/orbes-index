/**
 * The Atelier (Registry), `#/atelier` (plan LIVE RELEASE+: choices 8, 14 and 15, The console → Atelier).
 *
 *  - Pieces to make, per release (the private salon's and the stock's after), model and size, each group with its
 *    counts: each piece's ORBES identity (reserved), its step TO MAKE → IN PROGRESS → DONE, the order it is made for,
 *    where it goes, its engraving, add-ons and surprise. START, DONE (the piece issued: its material, batch, production
 *    date and claim code, shown once; linked to its order or entered in stock), CANCEL (a piece for the stock), and
 *    its WORK SHEET (OPERATOR); the work sheets of a group or of the filters; the CSV of what to make. Filters:
 *    `?view=OPEN|DONE|CANCELLED|ALL&origin=<release>|SALON|STOCK&skuId=&locationId=`.
 *  - Stock, per SKU and location: on hand, reserved, available, the pieces being made for the stock, its minimum
 *    and what the minimum suggests (L2) — MAKE confirms the suggestion into pieces to make; TRANSFER between locations,
 *    CORRECT a count (with why), MINIMUM (OPERATOR).
 * Each request is audited by the server; the page is read again.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount, formatDate, humanize } from '../format.js';
import {
  adjustProblem,
  ATELIER_LIMITS,
  benchActions,
  benchFilters,
  issueInput,
  issueProblem,
  issueValues,
  makeProblem,
  originLabel,
  skuLabel,
  thresholdProblem,
  thresholdValue,
  transferProblem,
} from '../model/atelier.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { BENCH_VIEWS, type AtelierStock, type AtelierStockRow, type BenchGroup, type BenchItem, type BenchList } from '../types.js';
import { button, copyButton, field, filterBar, linkButton, mono, pageHeader, section, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const LEAD =
  'The stock both ways: the pieces made in advance count in stock, the others are made to order. Each piece to make has its ORBES identity reserved from the start; its work sheet carries its reference and its code. Finished, the piece is issued and goes to its order, or into stock.';

const VIEW_LABELS = Object.freeze({ OPEN: 'Being made', DONE: 'Done', CANCELLED: 'Cancelled', ALL: 'All' });

export async function atelierView(ctx: ViewContext): Promise<HTMLElement> {
  const filters = benchFilters(ctx.route.query);
  const [list, stock] = await Promise.all([ctx.api.bench(filters), ctx.api.atelierStock(filters.locationId ? { locationId: filters.locationId } : {})]);
  const role = ctx.session.admin.role;
  const manage = can(role, 'manageAtelier');
  const done = (msg: string) => (v: unknown) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };

  const csv = button('Download CSV', { kind: 'ghost', testId: 'atelier-csv' });
  csv.addEventListener('click', async () => {
    csv.disabled = true;
    try {
      saveDownload(await ctx.api.benchCsv(filters));
    } catch (e) {
      notifyError(e);
    } finally {
      csv.disabled = false;
    }
  });

  return h(
    'div',
    { class: 'view view--atelier' },
    pageHeader({ eyebrow: 'Registry', title: 'Atelier', lead: LEAD, actions: [linkButton('Locations', href('settings'), 'ghost'), csv] }),
    benchSection(ctx, list, stock, filters, done),
    stockSection(ctx, stock, manage, done),
  );
}

// ── Pieces to make ─────────────────────────────────────────────────────────

function benchSection(
  ctx: ViewContext,
  list: BenchList,
  stock: AtelierStock,
  filters: ReturnType<typeof benchFilters>,
  done: (msg: string) => (v: unknown) => void,
): HTMLElement {
  const role = ctx.session.admin.role;
  const view = select('view', BENCH_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] })), filters.view ?? 'OPEN');
  view.addEventListener('change', () => ctx.setQuery({ view: view.value === 'OPEN' ? undefined : view.value }));
  const origin = select(
    'origin',
    [{ value: '', label: 'Every release, the salon and the stock' }, ...list.releases.map((r) => ({ value: r.id, label: r.title })), { value: 'SALON', label: 'PRIVATE SALON' }, { value: 'STOCK', label: 'FOR STOCK' }],
    filters.origin ?? '',
  );
  origin.addEventListener('change', () => ctx.setQuery({ origin: origin.value }));
  const location = select('locationId', [{ value: '', label: 'Every location' }, ...stock.locations.map((l) => ({ value: l.id, label: l.name }))], filters.locationId ?? '');
  location.addEventListener('change', () => ctx.setQuery({ locationId: location.value }));

  const open = (filters.view ?? 'OPEN') === 'OPEN';
  const sheetsAll =
    can(role, 'printWorkSheets') && open && list.total > 0
      ? [linkButton('Print work sheets', href('workSheets', {}, { origin: filters.origin, skuId: filters.skuId, locationId: filters.locationId }), 'secondary')]
      : [];
  const narrowed = filters.skuId ? h('p', { class: 'panel__text' }, 'Narrowed to one model and size. ', h('a', { class: 'idlink', attrs: { href: href('atelier') } }, 'Show all')) : null;
  const body: Child[] = [filterBar(field('Show', view), field('For', origin), field('Location', location)), narrowed];
  if (list.groups.length === 0) {
    body.push(
      h(
        'p',
        { class: 'panel__text', data: { testid: 'bench-empty' } },
        open ? 'Nothing to make: every order holds a piece in stock, and no suggestion was confirmed.' : 'No piece to make matches.',
      ),
    );
  } else {
    body.push(...list.groups.map((g) => group(ctx, g, done)));
    if (list.total > list.groups.reduce((n, g) => n + g.items.length, 0)) body.push(h('p', { class: 'board__more' }, `The first 500 of ${formatCount(list.total)}: narrow the list with the filters, or download the CSV.`));
  }
  return section('Pieces to make', body, { id: 'atelier-bench', note: `${formatCount(list.total)} ${list.total === 1 ? 'piece' : 'pieces'}`, tools: sheetsAll });
}

function counts(g: BenchGroup): string {
  const parts = [
    g.counts.TO_MAKE ? `${formatCount(g.counts.TO_MAKE)} to make` : null,
    g.counts.IN_PROGRESS ? `${formatCount(g.counts.IN_PROGRESS)} in progress` : null,
    g.counts.DONE ? `${formatCount(g.counts.DONE)} done` : null,
    g.counts.CANCELLED ? `${formatCount(g.counts.CANCELLED)} cancelled` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function group(ctx: ViewContext, g: BenchGroup, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const role = ctx.session.admin.role;
  const openItems = g.items.filter((b) => b.status === 'TO_MAKE' || b.status === 'IN_PROGRESS');
  const originQuery = g.origin.kind === 'RELEASE' ? g.origin.release.id : g.origin.kind;
  const sheets =
    can(role, 'printWorkSheets') && openItems.length
      ? linkButton(openItems.length === 1 ? 'Work sheet' : 'Work sheets', href('workSheets', {}, { origin: originQuery, skuId: g.sku.id }), 'ghost')
      : null;
  return h(
    'div',
    { class: 'bench', data: { testid: 'bench-group' } },
    h(
      'div',
      { class: 'bench__head' },
      h('h3', { class: 'bench__title' }, `${originLabel(g.origin)} · ${skuLabel(g.sku)}`),
      h('span', { class: 'bench__counts' }, counts(g)),
      sheets,
    ),
    table<BenchItem>(
      [
        { label: 'Piece', cell: (b) => h('a', { class: 'idlink mono', attrs: { href: productHref(b.piece.reference) } }, b.piece.reference), kind: ['nowrap'] },
        { label: 'Step', cell: (b) => statusMark(humanize(b.status), toneOf('bench', b.status)), kind: ['nowrap'] },
        {
          label: 'For',
          cell: (b) => (b.order ? h('a', { class: 'idlink mono', attrs: { href: href('order', { orderId: b.order.id }) } }, b.order.reference) : 'Stock'),
          kind: ['nowrap'],
        },
        { label: 'Goes to', cell: (b) => b.location.name, kind: ['nowrap'] },
        {
          label: 'To do',
          cell: (b) =>
            h(
              'span',
              null,
              b.engravingText ? h('span', { class: 'cell-details' }, `Engraving: ${b.engravingText}`) : null,
              b.addons.length ? h('span', { class: 'cell-details' }, b.addons.join(' · ')) : null,
              b.surprise ? h('span', { class: 'cell-details' }, `Surprise: ${b.surprise}`) : null,
              !b.engravingText && !b.addons.length && !b.surprise ? '—' : null,
            ),
          kind: ['wide'],
        },
        { label: 'Since', cell: (b) => formatDate(b.doneAt ?? b.cancelledAt ?? b.startedAt ?? b.createdAt), kind: ['nowrap'] },
        { label: '', cell: (b) => itemActions(ctx, b, done), kind: ['actions'] },
      ],
      g.items,
      { caption: `${originLabel(g.origin)} · ${skuLabel(g.sku)}` },
    ),
  );
}

function itemActions(ctx: ViewContext, b: BenchItem, done: (msg: string) => (v: unknown) => void): HTMLElement | null {
  const a = benchActions(b, ctx.session.admin.role);
  const eyebrow = `${b.piece.reference} · ${skuLabel(b.sku)}`;
  const start = () =>
    void openDialog({
      title: 'Start the piece',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'The piece reads IN PROGRESS at the atelier.'),
      confirmLabel: 'Start',
      submit: async () => {
        await ctx.api.startBench(b.id);
      },
    }).then(done('Piece started.'));
  const finish = () => {
    let issued: { productId: string; claimCode?: string } | null = null;
    void openDialog({
      title: 'The piece is finished',
      eyebrow,
      body: h(
        'p',
        { class: 'dialog__text' },
        b.order
          ? `Its ORBES identity ${b.piece.reference} is issued, and the piece goes to order ${b.order.reference}: the order holds it at ${b.location.name} until it ships.`
          : `Its ORBES identity ${b.piece.reference} is issued, and the piece enters the stock at ${b.location.name}.`,
      ),
      fields: [
        { name: 'material', label: 'Material', maxlength: ATELIER_LIMITS.material, value: issueValues(b, ctx.now()).material, required: true, hint: 'As the piece is made: printed on its certificate.' },
        { name: 'productionBatch', label: 'Production batch', maxlength: ATELIER_LIMITS.batch, hint: 'Optional.' },
        { name: 'productionDate', label: 'Production date', kind: 'date', value: issueValues(b, ctx.now()).productionDate },
        { name: 'withClaimSecret', label: 'Issue a one-time claim code (shown once, stored as a hash)', kind: 'checkbox', value: 'true', hint: 'Its buyer registers the piece with it.' },
      ],
      validate: (v) => issueProblem(b, v, ctx.now()),
      confirmLabel: 'Issue the piece',
      submit: async (v) => {
        issued = await ctx.api.finishBench(b.id, issueInput(v));
      },
    }).then((r) => {
      if (!r || !issued) return;
      const result = issued as { productId: string; claimCode?: string };
      if (result.claimCode) {
        const code = result.claimCode;
        void openDialog({
          title: 'Its claim code',
          eyebrow: result.productId,
          body: [
            h('p', { class: 'dialog__text' }, 'Shown once: write it on the piece’s certificate card now. Only its hash is kept.'),
            h('p', { class: 'claimcode', data: { testid: 'claim-code' } }, mono(code)),
            copyButton(code, 'Copy the claim code'),
          ],
          confirmLabel: 'Done',
          cancelLabel: 'Close',
        }).then(() => done('Piece issued.')(true));
      } else done('Piece issued.')(true);
    });
  };
  const cancel = () =>
    void openDialog({
      title: 'Cancel the piece to make',
      eyebrow,
      danger: true,
      body: h('p', { class: 'dialog__text' }, `The piece will not be made. Its ORBES identity ${b.piece.reference} is retired, its serial never used again, and the code of its work sheet, if one was printed, is revoked.`),
      phrase: 'CANCEL PIECE',
      confirmLabel: 'Cancel the piece',
      submit: async () => {
        await ctx.api.cancelBench(b.id);
      },
    }).then(done('Piece to make cancelled.'));
  const buttons = [
    a.start ? button('Start', { kind: 'ghost', testId: 'bench-start', onClick: start }) : null,
    a.done ? button('Done', { kind: 'ghost', testId: 'bench-done', onClick: finish }) : null,
    a.sheet ? linkButton('Sheet', href('workSheets', {}, { id: b.id }), 'ghost') : null,
    a.cancel ? button('Cancel', { kind: 'ghost', testId: 'bench-cancel', onClick: cancel }) : null,
  ].filter((x): x is HTMLButtonElement | HTMLAnchorElement => x !== null);
  return buttons.length ? h('span', { class: 'row-actions' }, ...buttons) : null;
}

// ── The stock ──────────────────────────────────────────────────────────────

function stockSection(ctx: ViewContext, stock: AtelierStock, manage: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const locationOptions = stock.locations.map((l) => ({ value: l.id, label: l.name }));
  const skuOptions = stock.skus.map((k) => ({ value: k.id, label: `${skuLabel(k)} · ${k.code}` }));
  const make = (r: AtelierStockRow) =>
    void openDialog({
      title: 'Make for the stock',
      eyebrow: `${skuLabel(r.sku)} · ${r.location.name}`,
      body: h(
        'p',
        { class: 'dialog__text' },
        `${formatCount(r.available)} available and ${formatCount(r.toMake)} being made, for a minimum of ${formatCount(r.minimum ?? 0)}: ${formatCount(r.suggestion)} to make. Each piece to make has its ORBES identity reserved now.`,
      ),
      fields: [{ name: 'quantity', label: 'Pieces to make', required: true, maxlength: 2, value: String(Math.min(r.suggestion, ATELIER_LIMITS.make)), hint: `1 to ${ATELIER_LIMITS.make} at a time.` }],
      validate: makeProblem,
      confirmLabel: 'Make',
      submit: async (v) => {
        await ctx.api.makeForStock({ skuId: r.sku.id, locationId: r.location.id, quantity: Number(v.quantity) });
      },
    }).then(done('Pieces to make added.'));
  const transfer = (r: AtelierStockRow) =>
    void openDialog({
      title: 'Transfer',
      eyebrow: skuLabel(r.sku),
      body: h('p', { class: 'dialog__text' }, 'Pieces available move from one location to the other: the pieces reserved by orders stay where their orders are.'),
      fields: [
        { name: 'fromLocationId', label: 'From', kind: 'select', options: locationOptions, value: r.location.id },
        { name: 'toLocationId', label: 'To', kind: 'select', options: locationOptions, value: locationOptions.find((l) => l.value !== r.location.id)?.value ?? '' },
        { name: 'quantity', label: 'Pieces', required: true, maxlength: 5, value: '1' },
        { name: 'note', label: 'Note', kind: 'textarea', maxlength: ATELIER_LIMITS.note, hint: 'Optional.' },
      ],
      validate: transferProblem,
      confirmLabel: 'Transfer',
      submit: async (v) => {
        await ctx.api.transferStock({ skuId: r.sku.id, fromLocationId: v.fromLocationId, toLocationId: v.toLocationId, quantity: Number(v.quantity), ...(v.note.trim() ? { note: v.note.trim() } : {}) });
      },
    }).then(done('Pieces transferred.'));
  const correct = (skuId: string | null, locationId: string | null, title: string) =>
    void openDialog({
      title: 'Correct the count',
      eyebrow: title,
      body: h('p', { class: 'dialog__text' }, 'A count, a piece found or damaged: the stock moves up or down by the pieces given, never below what orders reserve.'),
      fields: [
        ...(skuId ? [] : [{ name: 'skuId', label: 'Model and size', kind: 'select' as const, options: [{ value: '', label: 'Choose' }, ...skuOptions], value: '' }]),
        ...(locationId ? [] : [{ name: 'locationId', label: 'Location', kind: 'select' as const, options: locationOptions, value: locationOptions[0]?.value ?? '' }]),
        { name: 'delta', label: 'Pieces', required: true, maxlength: 6, hint: 'Up: 12. Down: -2.' },
        { name: 'note', label: 'Why', kind: 'textarea', required: true, maxlength: ATELIER_LIMITS.note },
      ],
      validate: (v) => ((skuId ?? v.skuId) ? adjustProblem(v) : 'Choose the model and size.'),
      confirmLabel: 'Correct',
      submit: async (v) => {
        await ctx.api.adjustStock({ skuId: skuId ?? v.skuId, locationId: locationId ?? v.locationId, delta: Number(v.delta.trim()), note: v.note.trim() });
      },
    }).then(done('Count corrected.'));
  const minimum = (skuId: string | null, locationId: string | null, current: number | null, title: string) =>
    void openDialog({
      title: 'Minimum',
      eyebrow: title,
      body: h('p', { class: 'dialog__text' }, 'Below it, the atelier suggests pieces to make for the stock, enough to reach it, for you to confirm. Empty: no minimum.'),
      fields: [
        ...(skuId ? [] : [{ name: 'skuId', label: 'Model and size', kind: 'select' as const, options: [{ value: '', label: 'Choose' }, ...skuOptions], value: '' }]),
        ...(locationId ? [] : [{ name: 'locationId', label: 'Location', kind: 'select' as const, options: locationOptions, value: locationOptions[0]?.value ?? '' }]),
        { name: 'minimum', label: 'Minimum', maxlength: 5, value: current === null ? '' : String(current), hint: `1 to ${formatCount(ATELIER_LIMITS.threshold)} pieces.` },
      ],
      validate: (v) => ((skuId ?? v.skuId) ? thresholdProblem(v) : 'Choose the model and size.'),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setStockThreshold({ skuId: skuId ?? v.skuId, locationId: locationId ?? v.locationId, minimum: thresholdValue(v) });
      },
    }).then(done('Minimum saved.'));

  const suggestions = stock.rows.filter((r) => r.suggestion > 0);
  const tools = manage && stock.skus.length
    ? [
        button('Correct a count', { kind: 'ghost', testId: 'stock-correct', onClick: () => correct(null, null, 'The stock') }),
        button('Set a minimum', { kind: 'ghost', testId: 'stock-minimum', onClick: () => minimum(null, null, null, 'The stock') }),
      ]
    : [];
  return section(
    'Stock',
    [
      suggestions.length
        ? h(
            'p',
            { class: 'panel__text', data: { testid: 'stock-suggestions' } },
            `${formatCount(suggestions.length)} ${suggestions.length === 1 ? 'minimum is' : 'minimums are'} not reached: the atelier suggests pieces to make, marked below, for you to confirm.`,
          )
        : null,
      table<AtelierStockRow>(
        [
          {
            label: 'Model and size',
            cell: (r) =>
              h(
                'span',
                null,
                skuLabel(r.sku),
                h('span', { class: 'cell-sub mono' }, r.sku.code),
                // Plan NEXT LOT §3.3: a size set aside in the Catalogue, listed while something remains.
                r.sku.setAside ? h('span', { class: 'cell-sub', data: { testid: 'stock-set-aside' } }, 'Set aside') : null,
              ),
          },
          { label: 'Location', cell: (r) => r.location.name, kind: ['nowrap'] },
          { label: 'On hand', cell: (r) => formatCount(r.onHand), kind: ['num'] },
          { label: 'Reserved', cell: (r) => formatCount(r.reserved), kind: ['num'] },
          { label: 'Available', cell: (r) => formatCount(r.available), kind: ['num'] },
          { label: 'Being made', cell: (r) => formatCount(r.toMake), kind: ['num'] },
          { label: 'Minimum', cell: (r) => (r.minimum === null ? '—' : formatCount(r.minimum)), kind: ['num'] },
          {
            label: 'Suggested',
            cell: (r) =>
              r.suggestion > 0
                ? h('span', { class: 'stock__suggest', data: { testid: 'stock-suggestion' } }, statusMark('TO MAKE', 'alert'), h('span', { class: 'stock__num' }, formatCount(r.suggestion)))
                : '—',
            kind: ['nowrap'],
          },
          {
            label: '',
            cell: (r) =>
              manage
                ? // MAKE, when the atelier suggests pieces, over the row's other actions: the column keeps its width.
                  h(
                    'span',
                    { class: 'stock__actions' },
                    r.suggestion > 0 ? button('Make', { kind: 'secondary', testId: 'stock-make', onClick: () => make(r) }) : null,
                    h(
                      'span',
                      { class: 'row-actions' },
                      stock.locations.length > 1 && r.available > 0 ? button('Transfer', { kind: 'ghost', testId: 'stock-transfer', onClick: () => transfer(r) }) : null,
                      button('Correct', { kind: 'ghost', onClick: () => correct(r.sku.id, r.location.id, `${skuLabel(r.sku)} · ${r.location.name}`) }),
                      button('Minimum', { kind: 'ghost', onClick: () => minimum(r.sku.id, r.location.id, r.minimum, `${skuLabel(r.sku)} · ${r.location.name}`) }),
                    ),
                  )
                : null,
            kind: ['actions', 'wrap'],
          },
        ],
        stock.rows,
        {
          caption: 'Stock',
          empty: 'No piece in stock yet: a piece the atelier finishes for the stock enters it, and a count corrected here sets it.',
          onRow: (r) => href('atelier', {}, { skuId: r.sku.id }),
        },
      ),
    ],
    { id: 'atelier-stock', note: `${formatCount(stock.rows.reduce((n, r) => n + r.available, 0))} available`, tools },
  );
}
