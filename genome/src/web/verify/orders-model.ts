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
 *   the terms      SIZE, PRICE, each add-on at its price, and the TOTAL when there are add-ons; a draw's or a salon's size
 *                  and price read TO BE CONFIRMED until ORBES Client Services enters them (left out once cancelled);
 *   the shipment   once shipped: the CARRIER, the TRACKING NUMBER and TRACK THE SHIPMENT, the carrier's page (https only);
 *   the documents  (M6) its INVOICE and CREDIT NOTE with their numbers (PDFs; the number in the reading face), the CARE GUIDE of its model while the
 *                  piece is on its way or kept, its OWNERSHIP CERTIFICATE once the piece is registered to the account;
 *   the reference  ORDER OR-…, what ORBES Client Services finds it by.
 * An order the app cannot read (an unknown step or channel, a reference that is not one) is left out, never guessed.
 */
import { ORDERS } from './copy.js';
import { formatMoney } from './live-model.js';
import type { OrderDocumentKind } from './api.js';
import { ORDER_CHANNELS, ORDER_STATUSES, type AccountOrder, type OrderStatus } from './types.js';
import { formatDate, modelWithVariant, upper, type Row } from './view-model.js';

/** The four steps of an order that goes its way. */
export const ORDER_PATH: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED'] as const);

/** One step on an order's card: reached (`done`), where the order is now (`current`), or to come (`next`, no date). */
export interface OrderStepModel {
  status: OrderStatus;
  label: string;
  /** `5 OCT 2026`, on this phone's calendar on that date; '' for a step to come. */
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
  /** Where it was sold: `LIVE RELEASE · MONOLITHE — LIVE`, `THE PRIVATE SALON`. */
  line: string;
  sentence: string;
  steps: OrderStepModel[];
  /** SIZE, PRICE, each add-on, TOTAL. */
  rows: Row[];
  /** Once shipped: CARRIER and TRACKING NUMBER, and the carrier's page (null when its address is not https). */
  shipment: { rows: Row[]; href: string | null; label: string } | null;
  /** Its documents (M6), in this order: invoice, credit note, care guide, ownership certificate. */
  documents: OrderDocumentModel[];
  /** `ORDER OR-1A2B3C4D`. */
  reference: string;
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
export function orderDate(iso: string | null | undefined, offsetMinutes?: number): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(t)) return '';
  const offset = offsetMinutes ?? -new Date(t).getTimezoneOffset();
  return formatDate(new Date(t + offset * 60_000).toISOString());
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
  const step = (status: OrderStatus, state: OrderStepModel['state']): OrderStepModel => ({
    status,
    label: ORDERS.step[status],
    date: state === 'next' ? '' : orderDate(at[status], offsetMinutes),
    state,
  });
  const now = ORDER_PATH.indexOf(o.status);
  if (now >= 0) return ORDER_PATH.map((s, i) => step(s, i < now ? 'done' : i === now ? 'current' : 'next'));
  return [...ORDER_PATH.filter((s) => s === 'RESERVED' || at[s] !== null).map((s) => step(s, 'done')), step(o.status, 'current')];
}

/**
 * SIZE, PRICE, each add-on at its price (per piece), and the TOTAL when there are add-ons and a price. A cancelled
 * order never promises a confirmation: the size and the price never entered are left out (possibly every row).
 */
export function orderRows(o: AccountOrder): Row[] {
  const money = (minor: number) => (o.currency ? formatMoney(minor, o.currency) : ORDERS.toConfirm);
  const priced = o.priceMinor !== null && o.currency !== null;
  const cancelled = o.status === 'CANCELLED';
  const size = o.size === null ? ORDERS.toConfirm : o.size.label ? upper(o.size.label) : ORDERS.oneSize;
  const rows: Row[] = [
    ...(cancelled && o.size === null ? [] : [[ORDERS.rows.size, size] as Row]),
    ...(cancelled && !priced ? [] : [[ORDERS.rows.price, priced ? money(o.priceMinor!) : ORDERS.toConfirm] as Row]),
    ...(cancelled && o.currency === null ? [] : o.addons).map((a): Row => [upper(a.label), money(a.priceMinor)]),
  ];
  if (priced && o.addons.length > 0) rows.push([ORDERS.rows.total, money(o.addons.reduce((n, a) => n + a.priceMinor, o.priceMinor!))]);
  return rows;
}

/** One order → its card; null when the app cannot read it. */
export function orderModel(o: AccountOrder, offsetMinutes?: number): OrderModel | null {
  if (!o || typeof o.reference !== 'string' || !REFERENCE.test(o.reference)) return null;
  if (!ORDER_STATUSES.includes(o.status) || !ORDER_CHANNELS.includes(o.channel) || typeof o.reservedAt !== 'string') return null;
  const shipped = o.status === 'SHIPPED' || o.status === 'DELIVERED' || o.status === 'RETURNED';
  const s = shipped ? o.shipment : null;
  return {
    id: o.id,
    key: `order-${o.reference.toLowerCase()}`,
    status: o.status,
    title: upper(o.model),
    line: [ORDERS.channel[o.channel], upper(o.release)].filter((x) => x.length > 0).join(' · '),
    sentence: ORDERS.sentence[o.status],
    steps: orderSteps(o, offsetMinutes),
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
  };
}

/** The account's orders → the cards of YOUR ORDERS, in the server's order (the latest first); dated on this phone's calendar unless `offsetMinutes` is given. */
export function orderModels(list: readonly AccountOrder[], offsetMinutes?: number): OrderModel[] {
  return list.map((o) => orderModel(o, offsetMinutes)).filter((m): m is OrderModel => m !== null);
}
