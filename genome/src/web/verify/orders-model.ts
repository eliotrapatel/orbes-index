/**
 * MY PIECES' orders view-model (plan LIVE RELEASE+, choice 6): the account's orders (GET /api/v1/account/orders) →
 * what each card of YOUR ORDERS shows. Pure (no DOM) and unit-tested, like the pieces' view-model.
 *
 * One order per piece, the latest first, as the server sends them:
 *   the piece      the model (the card's title), where it was sold (LIVE RELEASE, DRAW or THE PRIVATE SALON, and the
 *                  release's name), what its step means now;
 *   the steps      RESERVED · PAID · SHIPPED · DELIVERED, each reached with its date (on this phone's calendar), the
 *                  current one marked, those to come without one; a CANCELLED or RETURNED order shows the steps it
 *                  reached, then that end with its date;
 *   a new code     YOUR NEW CLAIM CODE (plan NEXT LOT §3.4), right after what its step means, only while a new claim code
 *                  ORBES Client Services made for its piece waits to be read (never the code: SHOW THE CODE asks for it);
 *                  REGISTER THIS PIECE offered once the order is shipped;
 *   the terms      SIZE, PRICE, each add-on at its price, its SHIPPING (plan NEXT-NINE, BP-19 T4: free by its tier, at
 *                  its fee, or with the order it travels with; no row without shipping), the CREDIT taken off it (BP-19
 *                  T5: − € 50), and the TOTAL when there are add-ons, a fee or a credit; a draw's or a salon's size and
 *                  price read TO BE CONFIRMED until ORBES Client Services enters them (left out once cancelled); a
 *                  welcome gift (BP-19 T5) reads WELCOME GIFT · its tier, its PRICE WELCOME GIFT, and while it waits
 *                  the order it travels with;
 *   the shipment   once shipped: the CARRIER, the TRACKING NUMBER and TRACK THE SHIPMENT, the carrier's page (https only);
 *   the documents  (M6) its INVOICE and CREDIT NOTE with their numbers (PDFs; the number in the reading face), the CARE GUIDE of its model while the
 *                  piece is on its way or kept, its OWNERSHIP CERTIFICATE once the piece is registered to the account;
 *   the reference  ORDER OR-…, what ORBES Client Services finds it by;
 *   the photograph the cover photograph of its model (or of its variant), shown whole above it (plan NOCTURNE,
 *                  addition 3), never a piece's own (decision 9); none when the model has none.
 * An order the app cannot read (an unknown step or channel, a reference that is not one) is left out, never guessed.
 */
import { ORDERS } from './copy.js';
import { formatMoney } from './live-model.js';
import type { OrderDocumentKind } from './api.js';
import { ORDER_CHANNELS, ORDER_STATUSES, type AccountOrder, type OrderStatus } from './types.js';
import { formatDate, modelWithVariant, photoModels, upper, type PhotoModel, type Row } from './view-model.js';

/** The four steps of an order that goes its way. */
export const ORDER_PATH: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED'] as const);

/** One step on an order's card: reached (`done`), where the order is now (`current`), or to come (`next`, no date). */
export interface OrderStepModel {
  status: OrderStatus;
  label: string;
  /** `5 OCT 2026`, on this phone's calendar on that date (`15 SEP` among several of one year); '' for a step to come. */
  date: string;
  state: 'done' | 'current' | 'next';
}

export interface OrderModel {
  /** The order's id: its documents' routes. */
  id: string;
  /** For element ids: `order-or-1a2b3c4d`. */
  key: string;
  status: OrderStatus;
  /** The model, as the card's title. */
  title: string;
  /** The model's label among its variants (« Gold »), null without one: the message's CONCERNING names it (CS-01). */
  modelVariant: string | null;
  /** Where it was sold: `LIVE RELEASE · MONOLITHE IN STEEL`, `THE PRIVATE SALON · ZENITH` (the salon names its model, C32). */
  line: string;
  sentence: string;
  steps: OrderStepModel[];
  /** YOUR NEW CLAIM CODE (plan NEXT LOT §3.4): while a new claim code waits for this account on this order; null otherwise. */
  claim: OrderClaimModel | null;
  /** SIZE, PRICE, each add-on, TOTAL. */
  rows: Row[];
  /** Once shipped: CARRIER and TRACKING NUMBER, and the carrier's page (null when its address is not https). */
  shipment: { rows: Row[]; href: string | null; label: string } | null;
  /** Its documents (M6), in this order: invoice, credit note, care guide, ownership certificate. */
  documents: OrderDocumentModel[];
  /** `ORDER OR-1A2B3C4D`. */
  reference: string;
  /** The model's cover photograph (addition 3), with its alternative text; null when it has none. */
  photo: PhotoModel | null;
}

/** YOUR NEW CLAIM CODE of an order (plan NEXT LOT §3.4): what its block offers, never the code (read once, on a press). */
export interface OrderClaimModel {
  /** When ORBES Client Services made it (ISO). */
  madeAt: string;
  /** REGISTER THIS PIECE is offered: the order is shipped or delivered (a piece not received yet is not registered here). */
  registerable: boolean;
  /** Accessible names of SAVE YOUR NEW CARD and REGISTER THIS PIECE, with the model and its variant. */
  saveLabel: string;
  registerLabel: string;
}

/** An order's YOUR NEW CLAIM CODE: only with a code WAITING as the server says it (status and date only), else null. */
export function orderClaim(o: AccountOrder): OrderClaimModel | null {
  const c = o.claimCode;
  if (!c || typeof c !== 'object' || c.status !== 'WAITING' || typeof c.madeAt !== 'string') return null;
  const model = modelWithVariant(upper(o.model), o.modelVariant);
  return {
    madeAt: c.madeAt,
    registerable: o.status === 'SHIPPED' || o.status === 'DELIVERED',
    saveLabel: ORDERS.claim.saveLabel(model),
    registerLabel: ORDERS.claim.registerLabel(model),
  };
}

/** One document of an order: a PDF to save (`file`), or its model's care guide, shown under the documents. */
export interface OrderDocumentModel {
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'CARE_GUIDE' | 'CERTIFICATE';
  /** `INVOICE`, `CARE GUIDE`: the display face. */
  label: string;
  /** `INV-2026-000001`: the reading face, after the label; null for the care guide and the certificate. */
  number: string | null;
  /** What the link does, for a screen reader. */
  ariaLabel: string;
  /** The PDF it saves; null for the care guide. */
  file: OrderDocumentKind | null;
}

const DOCUMENT_NUMBER = /^(INV|CN)-20\d{2}-\d{6}$/;

/** An order's documents, as the server lists them; a number the app cannot read is left out. */
export function orderDocuments(o: AccountOrder): OrderDocumentModel[] {
  const d = o.documents;
  if (!d || typeof d !== 'object') return [];
  const D = ORDERS.documents;
  // The model with its variant (NOCTURNE N1: « MONOLITHE in blue »), as the labels read aloud say it.
  const model = modelWithVariant(upper(o.model), o.modelVariant);
  const out: OrderDocumentModel[] = [];
  const invoice = d.invoice?.number;
  if (typeof invoice === 'string' && DOCUMENT_NUMBER.test(invoice) && invoice.startsWith('INV-')) out.push({ kind: 'INVOICE', label: D.invoice, number: invoice, ariaLabel: D.invoiceLabel(invoice), file: 'invoice' });
  const credit = d.creditNote?.number;
  if (typeof credit === 'string' && DOCUMENT_NUMBER.test(credit) && credit.startsWith('CN-')) out.push({ kind: 'CREDIT_NOTE', label: D.creditNote, number: credit, ariaLabel: D.creditNoteLabel(credit), file: 'credit-note' });
  if (d.careGuide === true) out.push({ kind: 'CARE_GUIDE', label: D.careGuide, number: null, ariaLabel: D.careGuideLabel(model), file: null });
  if (d.certificate === true) out.push({ kind: 'CERTIFICATE', label: D.certificate, number: null, ariaLabel: D.certificateLabel(model), file: 'certificate' });
  return out;
}

const REFERENCE = /^OR-[0-9A-F]{8}$/;

/**
 * An ISO time → its date on a calendar `offsetMinutes` east of UTC: `5 OCT 2026`; '' when unreadable. Without an
 * offset, this phone's on that date (its summer or winter time, not today's), as ownership.ts dates a piece's events.
 */
export function orderDate(iso: string | null | undefined, offsetMinutes?: number, opts: { year?: boolean } = {}): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) return '';
  const offset = offsetMinutes ?? -new Date(t).getTimezoneOffset();
  const date = formatDate(new Date(t + offset * 60_000).toISOString());
  return opts.year === false ? date.replace(/ \d{4}$/, '') : date;
}

/** When the order reached each step (null: not reached). */
function reachedAt(o: AccountOrder): Record<OrderStatus, string | null> {
  return { RESERVED: o.reservedAt, PAID: o.paidAt, SHIPPED: o.shippedAt, DELIVERED: o.deliveredAt, CANCELLED: o.cancelledAt, RETURNED: o.returnedAt };
}

/**
 * The steps of an order: on its way, the four steps, those reached with their dates; CANCELLED or RETURNED, the steps
 * it reached, then that end.
 */
export function orderSteps(o: AccountOrder, offsetMinutes?: number): OrderStepModel[] {
  const at = reachedAt(o);
  // One step reached is dated in full (5 OCT 2026, C24); several, each by its day and month in the same year as the
  // first (15 SEP · 16 SEP …, C24 and C32: five columns hold no year), a step of another year with its own.
  const reached = (Object.keys(at) as OrderStatus[]).filter((s) => at[s] !== null && orderDate(at[s], offsetMinutes) !== '');
  const first = orderDate(o.reservedAt, offsetMinutes).slice(-4);
  const date = (status: OrderStatus) => {
    const full = orderDate(at[status], offsetMinutes);
    return reached.length > 1 && full.slice(-4) === first ? orderDate(at[status], offsetMinutes, { year: false }) : full;
  };
  const step = (status: OrderStatus, state: OrderStepModel['state']): OrderStepModel => ({
    status,
    label: ORDERS.step[status],
    date: state === 'next' ? '' : date(status),
    state,
  });
  const now = ORDER_PATH.indexOf(o.status);
  if (now >= 0) return ORDER_PATH.map((s, i) => step(s, i < now ? 'done' : i === now ? 'current' : 'next'));
  return [...ORDER_PATH.filter((s) => s === 'RESERVED' || at[s] !== null).map((s) => step(s, 'done')), step(o.status, 'current')];
}

const TIER_WORDS: Readonly<Record<2 | 3, string>> = Object.freeze({ 2: 'PLATINE', 3: 'PALLADIUM' });

/**
 * An order's SHIPPING row (BP-19 T4): FREE · PLATINE, FREE EXPRESS · PALLADIUM, its fee (EXPRESS · € 40 for express),
 * WITH ORDER OR-… when it travels with another; null without shipping, or a fee the app cannot say.
 */
export function shippingValue(o: Pick<AccountOrder, 'shipping' | 'currency'>): string | null {
  const s = o.shipping;
  if (!s || (s.service !== 'STANDARD' && s.service !== 'EXPRESS') || typeof s.minor !== 'number') return null;
  if (typeof s.withOrder === 'string' && REFERENCE.test(s.withOrder)) return ORDERS.shipping.withOrder(s.withOrder);
  if (s.benefit === 2 || s.benefit === 3) return s.service === 'EXPRESS' ? ORDERS.shipping.freeExpress(TIER_WORDS[s.benefit]) : ORDERS.shipping.free(TIER_WORDS[s.benefit]);
  if (!o.currency) return null;
  const fee = formatMoney(s.minor, o.currency);
  return s.service === 'EXPRESS' ? ORDERS.shipping.express(fee) : fee;
}

/** The fee an order adds to its TOTAL: its own shipping, never one it travels with. */
function shippingFee(o: AccountOrder): number {
  const s = o.shipping;
  return s && typeof s.minor === 'number' && s.minor > 0 && !s.withOrder ? s.minor : 0;
}

/**
 * SIZE, PRICE, each add-on at its price (per piece), its SHIPPING (BP-19 T4), and the TOTAL when there are add-ons or a
 * fee, and a price. A cancelled order never promises a confirmation: the size and the price never entered are left out
 * (possibly every row).
 */
export function orderRows(o: AccountOrder): Row[] {
  const money = (minor: number) => (o.currency ? formatMoney(minor, o.currency) : ORDERS.toConfirm);
  const priced = o.priceMinor !== null && o.currency !== null;
  const cancelled = o.status === 'CANCELLED';
  const size = o.size === null ? ORDERS.toConfirm : o.size.label ? upper(o.size.label) : ORDERS.oneSize;
  // A welcome gift has no price of its own (BP-19 T5): it travels with its order.
  const gift = o.channel === 'GIFT';
  const rows: Row[] = [
    ...(cancelled && o.size === null ? [] : [[ORDERS.rows.size, size] as Row]),
    ...(gift ? [[ORDERS.rows.price, ORDERS.gift.price] as Row] : cancelled && !priced ? [] : [[ORDERS.rows.price, priced ? money(o.priceMinor!) : ORDERS.toConfirm] as Row]),
    // An add-on adds to the price: « + € 150 » (C24), its words the app's.
    ...(cancelled && o.currency === null ? [] : o.addons).map((a): Row => [upper(a.label), o.currency ? `+ ${money(a.priceMinor)}` : money(a.priceMinor)]),
  ];
  const shipping = shippingValue(o);
  if (shipping) rows.push([ORDERS.rows.shipping, shipping]);
  const fee = shippingFee(o);
  const credit = !gift && priced && typeof o.creditMinor === 'number' && Number.isInteger(o.creditMinor) && o.creditMinor > 0 ? o.creditMinor : 0;
  if (credit > 0) rows.push([ORDERS.rows.credit, ORDERS.credit(money(credit))]);
  if (!gift && priced && (o.addons.length > 0 || fee > 0 || credit > 0)) rows.push([ORDERS.rows.total, money(o.addons.reduce((n, a) => n + a.priceMinor, o.priceMinor! + fee - credit))]);
  return rows;
}

/** One order → its card; null when the app cannot read it. */
export function orderModel(o: AccountOrder, offsetMinutes?: number): OrderModel | null {
  if (!o || typeof o.reference !== 'string' || !REFERENCE.test(o.reference)) return null;
  if (!ORDER_STATUSES.includes(o.status) || !ORDER_CHANNELS.includes(o.channel) || typeof o.reservedAt !== 'string') return null;
  const shipped = o.status === 'SHIPPED' || o.status === 'DELIVERED' || o.status === 'RETURNED';
  const s = shipped ? o.shipment : null;
  const giftTier = o.channel === 'GIFT' && (o.giftTier === 'PLATINE' || o.giftTier === 'PALLADIUM') ? o.giftTier : null;
  const parent = typeof o.withOrder === 'string' && REFERENCE.test(o.withOrder) ? o.withOrder : null;
  return {
    id: o.id,
    key: `order-${o.reference.toLowerCase()}`,
    status: o.status,
    title: upper(o.model),
    modelVariant: typeof o.modelVariant === 'string' && o.modelVariant.trim() !== '' ? o.modelVariant.trim() : null,
    // A release names itself; the private salon has none: the model with its variant follows it (C32).
    line: [
      ORDERS.channel[o.channel],
      o.channel === 'GIFT' ? (giftTier ?? '') : o.release ? upper(o.release) : o.channel === 'SALON' ? modelWithVariant(upper(o.model), o.modelVariant).toUpperCase() : '',
    ]
      .filter((x) => x.length > 0)
      .join(' · '),
    // A welcome gift waiting says the order it travels with (BP-19 T5).
    sentence: o.channel === 'GIFT' && parent && (o.status === 'RESERVED' || o.status === 'PAID') ? ORDERS.gift.travels(parent) : ORDERS.sentence[o.status],
    steps: orderSteps(o, offsetMinutes),
    claim: orderClaim(o),
    rows: orderRows(o),
    shipment: s
      ? {
          rows: [
            [ORDERS.rows.carrier, upper(s.carrier)],
            [ORDERS.rows.tracking, s.trackingNumber],
          ],
          href: typeof s.trackingUrl === 'string' && /^https:\/\/\S+$/.test(s.trackingUrl) ? s.trackingUrl : null,
          label: ORDERS.trackLabel(s.trackingNumber, s.carrier),
        }
      : null,
    documents: orderDocuments(o),
    reference: ORDERS.reference(o.reference),
    photo: photoModels({ model: o.model, type: '', modelVariant: o.modelVariant, imageUrl: o.imageUrl })[0] ?? null,
  };
}

/** The account's orders → the cards of YOUR ORDERS, in the server's order (the latest first); dated on this phone's calendar unless `offsetMinutes` is given. */
export function orderModels(list: readonly AccountOrder[], offsetMinutes?: number): OrderModel[] {
  return list.map((o) => orderModel(o, offsetMinutes)).filter((m): m is OrderModel => m !== null);
}
