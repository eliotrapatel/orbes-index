/**
 * The supplier orders in the console (plan NEXT LOT of 2026-10-07, §3.5.4.2 and §3.5.6.3-4; step 5.11d): pure helpers,
 * no DOM. The words of To order (the proposal), of the list and of a supplier order's page; the list's filters; what
 * may be done with an order in each status; a line's and an order's money in the order's currency; the dialogs' checks
 * and what they send. The server stays the authority (409 SUPPLIER_ORDER_NOT_DRAFT, 422 SUPPLIER_ORDER_INCOMPLETE,
 * 409 SKU_NO_SUPPLIER, 409 RECEPTION_OPEN).
 */
import { formatCount } from '../format.js';
import { formatMoney } from './live.js';
import { skuWords } from './logistics.js';
import { SUPPLIER_ORDER_STATUSES, type LogisticsSku, type SupplierDraftChange, type SupplierOrderDetail, type SupplierOrderStatus } from '../types.js';

/** The bounds of services/supplier-orders.ts (SUPPLIER_ORDER_LIMITS). */
export const SUPPLIER_ORDER_LIMITS = Object.freeze({ quantity: 10_000, amountMinor: 100_000_000, invoiceMinor: 100_000_000_000, note: 1000, invoiceNumber: 60, returnNote: 500 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PROPOSAL_TEXT = Object.freeze({
  title: 'To order',
  empty: 'Nothing to order: every waiting order and every minimum is covered.',
  add: 'Add to the draft',
  added: 'Added to the draft.',
  noSupplierTitle: 'No supplier',
});

export const LIST_TEXT = Object.freeze({
  title: 'Supplier orders',
  empty: 'No supplier order yet: the console proposes one under To order.',
});

/** A size the proposal cannot order: it has no supplier. */
export function noSupplierLine(sku: Pick<LogisticsSku, 'model' | 'variant' | 'sizeLabel'>): string {
  return `No supplier set for ${skuWords(sku)}: set it on the model’s page.`;
}

/** A supplier order's status as its mark and the filter read it. */
export const SUPPLIER_ORDER_STATUS_LABELS: Readonly<Record<SupplierOrderStatus, string>> = Object.freeze({
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  EXPECTED: 'EXPECTED',
  PARTLY_RECEIVED: 'PARTLY RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
});

/** The Status filter's words (§3.5.4.2): Draft · Sent · Expected · Partly received · Received · Cancelled · All. */
const STATUS_FILTER_LABELS: Readonly<Record<SupplierOrderStatus, string>> = Object.freeze({
  DRAFT: 'Draft',
  SENT: 'Sent',
  EXPECTED: 'Expected',
  PARTLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
});

/** The Status filter's options, All last (no filter, the default). */
export function statusOptions(): { value: string; label: string }[] {
  return [...SUPPLIER_ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] })), { value: '', label: 'All' }];
}

/** The list's filters from the page's query: only the values the server takes. */
export function listFilters(query: Record<string, string>): { status?: SupplierOrderStatus; supplierId?: string } {
  const out: { status?: SupplierOrderStatus; supplierId?: string } = {};
  if ((SUPPLIER_ORDER_STATUSES as readonly string[]).includes(query.status ?? '')) out.status = query.status as SupplierOrderStatus;
  if (UUID_RE.test(query.supplierId ?? '')) out.supplierId = query.supplierId!.toLowerCase();
  return out;
}

/** An amount in an order's currency, or '—'. */
export function money(minor: number | null | undefined, currency: string | null): string {
  return minor === null || minor === undefined || !currency ? '—' : formatMoney(minor, currency);
}

/** Pieces received of ordered: '12 / 50'. */
export function piecesLine(p: { ordered: number; received: number }): string {
  return `${formatCount(p.received)} / ${formatCount(p.ordered)}`;
}

/** The Invoice cell: '—', or its number, with PAID once paid. */
export function invoiceCell(invoice: { number: string; paid: boolean } | null): string {
  return invoice ? (invoice.paid ? `${invoice.number} · PAID` : invoice.number) : '—';
}

/** What may be done with a supplier order now, by a role that manages them (`manage`). */
export function supplierOrderActions(o: Pick<SupplierOrderDetail, 'status' | 'invoice'>, manage: boolean) {
  const open = o.status === 'SENT' || o.status === 'EXPECTED' || o.status === 'PARTLY_RECEIVED';
  return {
    edit: manage && o.status === 'DRAFT',
    send: manage && o.status === 'DRAFT',
    discard: manage && o.status === 'DRAFT',
    confirmed: manage && o.status === 'SENT',
    cancelRest: manage && open,
    invoice: manage && o.status !== 'DRAFT' && !o.invoice?.paidAt,
    invoicePaid: manage && !!o.invoice && o.invoice.paidAt === null,
  };
}

export const ORDER_TEXT = Object.freeze({
  markSent: 'Mark sent',
  markSentText: 'The order is SENT: its lines and prices no longer change. Download its PDF and send it to the supplier yourself.',
  sent: 'Supplier order sent.',
  discard: 'Discard the draft',
  discardText: 'The draft is deleted: it never left ORBES.',
  discarded: 'Draft discarded.',
  confirmed: 'Confirmed by the supplier',
  confirmedText: 'The supplier has confirmed the order and its delivery date.',
  confirmedToast: 'Confirmed by the supplier.',
  cancelRest: 'Cancel the rest',
  cancelRestText: 'What has not arrived stops being expected. The orders waiting for it go back into the next proposal.',
  cancelRestToast: 'The rest is cancelled.',
  editText: 'While it is a draft: its currency, its expected delivery date, its shipping costs and the note printed on its PDF.',
  saved: 'Supplier order saved.',
  addLine: 'Add a line',
  lineSaved: 'Line saved.',
  lineRemoved: 'Line removed.',
  extrasTitle: 'Not on the order',
  receptionsTitle: 'Receptions',
  receptionsEmpty: 'No reception yet.',
  backTitle: 'Back to the supplier',
  backEmpty: 'No piece sent back to the supplier.',
  settle: 'Note the supplier’s answer',
  replacementText: 'The supplier sends new pieces: they stay expected on this order.',
  settled: 'Answer noted.',
  invoiceTitle: 'Supplier invoice',
  invoiceEnter: 'Enter the invoice',
  invoiceSaved: 'Invoice saved.',
  invoicePaid: 'Mark the invoice paid',
  invoicePaidText: 'ORBES has paid this invoice.',
  invoicePaidToast: 'Invoice paid.',
  historyTitle: 'History',
});

/** 'Expected on other supplier orders: 5' under a draft's line, when so. */
export function expectedElsewhereLine(n: number): string | null {
  return n > 0 ? `Expected on other supplier orders: ${formatCount(n)}` : null;
}

/** A return's Settled cell: 'Replacement', or 'Credit · EUR 120', or '—'. */
export function settledCell(r: { settlement: 'REPLACEMENT' | 'CREDIT' | null; creditMinor: number | null }, currency: string | null): string {
  if (r.settlement === 'REPLACEMENT') return 'Replacement';
  if (r.settlement === 'CREDIT') return `Credit · ${money(r.creditMinor, currency)}`;
  return '—';
}

/** A supplier order's history, step by step (its audit actions). */
export const HISTORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'supplier_order.create': 'Draft made',
  'supplier_order.draft': 'Added to the draft',
  'supplier_order.update': 'Draft changed',
  'supplier_order.send': 'Sent',
  'supplier_order.confirm': 'Confirmed by the supplier',
  'supplier_order.cancel_rest': 'The rest cancelled',
  'supplier_order.invoice': 'Invoice entered',
  'supplier_order.invoice_paid': 'Invoice paid',
  'supplier_return.returned': 'Rejected pieces sent back',
  'supplier_return.settle': 'The supplier’s answer noted',
  'reception.record': 'Reception counted',
  'reception.update': 'Reception counted again',
  'reception.send_back': 'Reception sent back',
  'reception.confirm': 'Reception confirmed',
});

// ── The dialogs ────────────────────────────────────────────────────────────

/** An amount typed in units (4800, 4 800, 4800.50, 4800,5) in hundredths, up to `maxMinor`; null when it is not one. */
export function amountOf(text: string | null | undefined, maxMinor: number = SUPPLIER_ORDER_LIMITS.amountMinor): number | null {
  const s = (text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [units, cents = ''] = s.split('.');
  const minor = Number(units) * 100 + Number(cents.padEnd(2, '0'));
  return minor <= maxMinor ? minor : null;
}

/** Hundredths as a field shows them: 120, 120.50. */
export function amountField(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return minor % 100 === 0 ? String(minor / 100) : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

const wholeIn = (text: string | undefined, min: number, max: number): number | null => {
  const t = (text ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** The draft's Edit: a currency of three letters, a day, an amount, a note. */
export function draftProblem(v: Record<string, string>): string | null {
  const c = (v.currency ?? '').trim();
  if (c && !/^[A-Za-z]{3}$/.test(c)) return 'A currency is a three-letter code, such as EUR.';
  const d = (v.expectedOn ?? '').trim();
  if (d && !DATE_RE.test(d)) return 'The expected delivery is a day.';
  if ((v.shipping ?? '').trim() && amountOf(v.shipping) === null) return 'Shipping costs read 120, or 120.50.';
  if ((v.note ?? '').trim().length > SUPPLIER_ORDER_LIMITS.note) return `A note has at most ${formatCount(SUPPLIER_ORDER_LIMITS.note)} characters.`;
  return null;
}

export function draftChange(v: Record<string, string>): SupplierDraftChange {
  const shipping = (v.shipping ?? '').trim();
  return {
    currency: (v.currency ?? '').trim().toUpperCase() || null,
    expectedOn: (v.expectedOn ?? '').trim() || null,
    shippingMinor: shipping ? amountOf(shipping) : null,
    note: (v.note ?? '').trim() || null,
  };
}

/** A line's dialog: a size (when added), its quantity, its unit price (empty while not known). */
export function lineProblem(v: Record<string, string>, needsSku: boolean): string | null {
  if (needsSku && !UUID_RE.test(v.skuId ?? '')) return 'Choose the size.';
  if (wholeIn(v.quantity, 1, SUPPLIER_ORDER_LIMITS.quantity) === null) return `A line holds 1 to ${formatCount(SUPPLIER_ORDER_LIMITS.quantity)} pieces.`;
  if ((v.unitPrice ?? '').trim() && amountOf(v.unitPrice) === null) return 'A unit price reads 120, or 120.50.';
  return null;
}

/** The draft's lines whole, one changed, added or removed (the PATCH sends them all). */
export function linesWith(o: Pick<SupplierOrderDetail, 'lines'>, change: { skuId: string; quantity: number; unitPriceMinor: number | null } | { remove: string }): NonNullable<SupplierDraftChange['lines']> {
  const lines = o.lines.map((l) => ({ skuId: l.sku.id, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor }));
  if ('remove' in change) return lines.filter((l) => l.skuId !== change.remove);
  const i = lines.findIndex((l) => l.skuId === change.skuId);
  if (i >= 0) lines[i] = change;
  else lines.push(change);
  return lines;
}

/** The invoice's dialog: its number, amount and date. */
export function invoiceProblem(v: Record<string, string>): string | null {
  const n = (v.number ?? '').trim();
  if (!n) return 'Give the invoice’s number.';
  if (n.length > SUPPLIER_ORDER_LIMITS.invoiceNumber) return `A number has at most ${SUPPLIER_ORDER_LIMITS.invoiceNumber} characters.`;
  if (amountOf(v.amount, SUPPLIER_ORDER_LIMITS.invoiceMinor) === null) return 'The amount reads 4800, or 4800.50.';
  if (!DATE_RE.test((v.date ?? '').trim())) return 'The invoice’s date is a day.';
  return null;
}

/** The supplier's answer: a replacement, or a credit with its amount; a note. */
export function settleProblem(v: Record<string, string>): string | null {
  if (v.settlement !== 'REPLACEMENT' && v.settlement !== 'CREDIT') return 'Choose the supplier’s answer.';
  if (v.settlement === 'CREDIT' && amountOf(v.credit) === null) return 'A credit carries its amount: 120, or 120.50.';
  if ((v.note ?? '').trim().length > SUPPLIER_ORDER_LIMITS.returnNote) return `A note has at most ${SUPPLIER_ORDER_LIMITS.returnNote} characters.`;
  return null;
}

/** Add to supplier order, from the stock or a release: 1 to 10 000 pieces. */
export function addQuantityProblem(v: Record<string, string>): string | null {
  return wholeIn(v.quantity, 1, SUPPLIER_ORDER_LIMITS.quantity) === null ? `Add 1 to ${formatCount(SUPPLIER_ORDER_LIMITS.quantity)} pieces.` : null;
}
