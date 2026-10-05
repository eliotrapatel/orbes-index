/**
 * Orders (plan LIVE RELEASE+ of 2026-10-04: choice 6, Interconnection, decision 31; migration 0022): one order per
 * piece sold, by every sales channel, step by step.
 *
 *   created      automatically, in the transaction that commits the sale: an entry of a LIVE RELEASE CONFIRMED (PAY:
 *                one order per piece of its quantity, `ordersForLiveEntry`), an entry of a draw confirmed by Client
 *                Services (`orderForDrawEntry`), a request of the private salon closed as ACCEPTED
 *                (`orderForShopRequest`). RESERVED, at the release's default location (`drops.stock_location_id`) or
 *                at the default location (FRANCE WAREHOUSE). A LIVE order carries its size, price, currency and add-ons
 *                as sold; a draw's and a salon's size, price and currency are entered by Client Services (`setTerms`).
 *   held         while RESERVED or PAID, an order whose SKU is known holds one piece of it at its location when one
 *                is available (STOCK: counted as reserved, services/stock.ts); otherwise it creates a piece to make
 *                (bench_items: BENCH) whose ORBES identity is reserved at once (issuance.ts reserveIdentity, L6).
 *                Changing the order's location moves what it holds (`changeLocation`): a piece in stock is released
 *                and taken again at the new location (or made for it); a piece to make goes there.
 *   steps        exactly ORDER_TRANSITIONS (`transition`): RESERVED → PAID | CANCELLED; PAID → SHIPPED | CANCELLED;
 *                SHIPPED → DELIVERED | RETURNED; DELIVERED → RETURNED.
 *                PAID: by Client Services (later Whop or Shopify, through the same transition), once its price is
 *                entered (409 ORDER_PRICE_MISSING before): its invoice is issued in the same transaction
 *                (services/invoices.ts issueInvoice).
 *                SHIPPED: with an active carrier and the tracking number (the value declared for the insurance
 *                optional), once the piece is in stock at the order's location (409 ORDER_NOT_READY before) and
 *                linked to the order (409 ORDER_PIECE_NOT_LINKED before: the atelier issues it, or picks it from
 *                stock): it leaves the ledger (SHIPPED, −1).
 *                DELIVERED: by Client Services, or by itself when the buyer registers the piece linked to the order
 *                while it is SHIPPED (`deliverOnRegistration`, OwnershipService.registerFirst).
 *                CANCELLED, with a note: a piece in stock is released; a piece to make is cancelled and its reserved
 *                identity retired (RETIRED: its serial is never reused); once PAID, a credit note cancels its invoice.
 *                RETURNED (`returnOrder`, choice 20), opened by Client Services with a note and where the piece goes:
 *                back to stock at a location (the ledger's RETURNED, +1; the piece RESOLD, ready to be sold again, unless
 *                it was never sold: ISSUED) or to the archive (the piece RETIRED). When its buyer had registered it, ORBES
 *                takes the ownership back (`returns.ownership_id`, ended RETURNED; a transfer pending is cancelled): back
 *                to stock, the piece is not registered and carries a new claim code, shown once for its new card;
 *                archived, it is retired. A credit note cancels its invoice.
 *   history      every change is one event of the order (order_events: its audit action, the status after it, a note,
 *                who, when), one audit entry (`order.create`, `.pay`, `.ship`, `.deliver`, `.cancel`, `.return`,
 *                `.location`, `.terms`, `.buyer`, `.link`) and one entry of the event journal (the order as it stands after
 *                it; services/journal.ts), in the transaction of the change; the pieces to make (`bench.create`,
 *                `.cancel`, `.move`, `.engrave`, and the atelier's `.start` and `.done`: services/atelier.ts), the
 *                identities (`product.reserve`, `product.retire`, `product.issue`, `product.transition`), the stock
 *                (`stock.move`) and the invoices (`invoice.issue`, `invoice.credit`) journal their own changes; a return
 *                that takes an ownership back is audited `ownership.reclaim` too.
 *   the piece    the one that fulfils the order, linked when the atelier issues its piece to make or picks one from
 *                stock (`attachPiece`, `order.link`): the order then holds it in stock until it is shipped.
 *   the buyer    name and address, entered by Client Services (decision 31; no form for collectors): kept on the order
 *                only, never in the audit log, the order's events nor the journal (which say they were entered, never
 *                what they are), and exported to the account under the right of access (`accountOrders`); the
 *                console's routes give them masked to an AUDITOR (OrderView carries them as stored, as the emails).
 *                The engraving text likewise stays on the order and its piece to make.
 *   MY PIECES    the collector reads their own orders (`forAccount`, choice 6): the steps and their times, the model,
 *                the size, the add-ons and the price, the carrier and the tracking link once shipped, and its documents
 *                (M6): the invoice and the credit note, the model's care guide, the ownership certificate once the piece
 *                is registered to them; nothing of the house's side (the location, what it holds, the surprise, the
 *                value declared, the notes, who handled it).
 *   Shopify      an order keeps its future Shopify id (`shopify_order_id`); nothing calls Shopify in this lot.
 *
 * The LIVE RELEASES' Client Services resolution is retired into the orders (the console's Orders board steps them): the
 * sales committed before migration 0022, or by the previous image, get their orders at boot (`OrderService.prepare`),
 * a resolution already given mapped (CONCLUDED → PAID, CANCELLED → CANCELLED).
 *
 * Lock order: the source's rows (the release, then the entry; the request), the order, the SKU (stock.ts lockSku), the
 * piece to make and its identity (or the piece returned, then its ownership and transfer); the invoice numbers
 * (invoices.ts); the journal; the audit log last: the functions a sale's transaction calls return their audit entries
 * for it to write after its own (a return's change of the piece's status, LifecycleService, writes its own, last).
 */
import { inTransaction, type Db } from '../db/connection.js';
import {
  ORDER_STATUSES,
  RETURN_OUTCOMES,
  jsonText,
  type InvoiceKind,
  type JsonObject,
  type OrderAddonSnapshot,
  type OrderChannel,
  type OrderReservation,
  type OrderRow,
  type OrderStatus,
  type OrderUpdate,
  type ProductStatus,
  type ReturnOutcome,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, SYSTEM_ACTOR, type Actor, type Clock, type Logger, noopLogger } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import { issueCreditNote, issueInvoice, orderInvoices } from './invoices.js';
import { reserveIdentity, retireReservedIdentity } from './issuance.js';
import { writeJournal } from './journal.js';
import { isTransitionAllowed, LifecycleService, returnTargetOf } from './lifecycle.js';
import { CERTIFICATE_ENDING_STATUSES } from './ownership.js';
import { defaultLocationId, ensureSku, ensureStockSetup, knownLocation, linkSkus, lockSku, recordMovement, sizeLabelOf, stockLevel } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The legal steps of an order (Interconnection): every other move is refused. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  RESERVED: Object.freeze(['PAID', 'CANCELLED'] as const),
  PAID: Object.freeze(['SHIPPED', 'CANCELLED'] as const),
  SHIPPED: Object.freeze(['DELIVERED', 'RETURNED'] as const),
  DELIVERED: Object.freeze(['RETURNED'] as const),
  CANCELLED: Object.freeze([] as const),
  RETURNED: Object.freeze([] as const),
});

/** The audit action (and the event's, and the journal's type) of each step reached. */
export const ORDER_STEP_ACTIONS: Readonly<Record<Exclude<OrderStatus, 'RESERVED'>, string>> = Object.freeze({
  PAID: 'order.pay',
  SHIPPED: 'order.ship',
  DELIVERED: 'order.deliver',
  CANCELLED: 'order.cancel',
  RETURNED: 'order.return',
});

/** The statuses in which an order holds a piece (STOCK) or a piece to make (BENCH). */
export const ORDER_HOLDING_STATUSES: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID']);

/** The currencies an order is priced in: the house's, as a LIVE RELEASE's (live-console.ts LIVE_CURRENCIES). */
export const ORDER_CURRENCIES = Object.freeze(['EUR', 'GBP', 'USD', 'CHF'] as const);
/** A price, a declared value: 0 to 1 000 000.00 in minor units. */
export const ORDER_AMOUNT_MAX_MINOR = 100_000_000;
/** The words Client Services enters on an order, at most (the CHECKs of migration 0022). */
export const ORDER_TEXT_LIMITS = Object.freeze({ note: 500, buyerName: 200, buyerAddress: 1000, engraving: 120, size: 100 });
/** A tracking number: 3 to 40 letters, digits, spaces and hyphens. */
const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Control characters but the line breaks (an address and a note keep theirs). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LINE_BREAKS = /[\r\n]/;

/** The reference of an order for ORBES Client Services and its buyer: `OR-` and the first eight figures of its id. */
export function orderReference(orderId: string): string {
  return `OR-${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Whether `from → to` is one of the order's legal steps. */
export function isOrderTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** A carrier's tracking link for a number: its pattern, the number in place of `{tracking}`. */
export function trackingLink(pattern: string, trackingNumber: string): string {
  return pattern.replace('{tracking}', encodeURIComponent(trackingNumber.replace(/\s+/g, '')));
}

// ── Errors ─────────────────────────────────────────────────────────────────

const orderNotFound = () => notFound('Order', 'ORDER_NOT_FOUND');
const stepNotAllowed = (from: OrderStatus, to: OrderStatus) =>
  new DomainError('ORDER_TRANSITION_NOT_ALLOWED', 409, 'This order cannot move to that step.', { detail: `${from} → ${to}` });
const notReady = () => conflict('ORDER_NOT_READY', 'The piece is not in stock at the order’s location yet.');
const pieceNotLinked = () => conflict('ORDER_PIECE_NOT_LINKED', 'Link the piece that fulfils this order before it ships.');
const pieceLinked = () => conflict('ORDER_PIECE_LINKED', 'A piece is already linked to this order: transfer the piece instead.');
const termsFixed = () => conflict('ORDER_TERMS_FIXED', 'The size and the price of a LIVE RELEASE order are those of its release.');
const orderClosed = () => conflict('ORDER_CLOSED', 'This order can no longer change.');
const carrierUnknown = () => notFound('Carrier', 'CARRIER_NOT_FOUND');
const priceMissing = () => conflict('ORDER_PRICE_MISSING', 'Enter the order’s price before it is paid: its invoice is issued then.');
const returnChanged = () => conflict('ORDER_RETURN_CHANGED', 'The piece changed during the return. Please try again.');
const notRestockable = (status: ProductStatus) =>
  new DomainError('ORDER_RETURN_NOT_RESTOCKABLE', 409, 'The piece’s record does not let it go back to stock now: settle its record first, or archive it.', { detail: `status ${status}` });

// ── Input ──────────────────────────────────────────────────────────────────

/** One step of an order, with what it requires. */
export type OrderTransitionInput =
  | { to: 'PAID'; note?: string | null }
  | { to: 'SHIPPED'; carrierId: string; trackingNumber: string; declaredValueMinor?: number | null; note?: string | null }
  | { to: 'DELIVERED'; note?: string | null }
  | { to: 'CANCELLED'; note: string };

/** A return opened by Client Services (choice 20): back to stock at a location, or to the archive, with a note. */
export interface OrderReturnInput {
  outcome: ReturnOutcome;
  /** Where the piece goes back to stock (RESTOCKED only). */
  locationId?: string | null;
  note: string;
}

/** A return done: the order, its piece, and the claim code of the piece's new card when ORBES took its ownership back. */
export interface OrderReturned {
  order: OrderView;
  /** The piece's reference. */
  productId: string;
  /** Shown once: only its hash is kept (back to stock, the buyer's ownership taken back). */
  claimCode?: string;
}

/** What Client Services enters on an order: a draw's or a salon's size, price and currency; any order's engraving text. */
export interface OrderTermsInput {
  /** null: one size. */
  sizeLabel?: string | null;
  priceMinor?: number | null;
  currency?: string | null;
  engravingText?: string | null;
}

/** The buyer's name and address (decision 31); null clears. */
export interface OrderBuyerInput {
  name: string | null;
  address: string | null;
}

/** Text as Client Services types it: trimmed, line breaks as \n (or none), bounded; '' and null are null. */
function cleanText(v: unknown, max: number, label: string, opts: { multiline?: boolean; required?: boolean } = {}): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw validationError(`${label} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (CONTROL_CHARS.test(s) || (!opts.multiline && LINE_BREAKS.test(s))) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

function cleanAmount(v: unknown, label: string): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > ORDER_AMOUNT_MAX_MINOR) throw validationError(`${label} must be 0 to 1 000 000.00.`);
  return v as number;
}

function knownOrderId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw orderNotFound();
  return id.toLowerCase();
}

/** Client Services (a console user) or the system (a connection, the boot): never a customer. */
function assertOperator(actor: Actor): void {
  const admin = actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id);
  if (!admin && actor?.type !== 'system') throw forbidden('Only ORBES Client Services changes an order.');
}

// ── Views ──────────────────────────────────────────────────────────────────

/** An order as the console reads it, the buyer's details as stored: the routes mask them for an AUDITOR, as the emails. */
export interface OrderView {
  id: string;
  reference: string;
  channel: OrderChannel;
  source: { liveEntryId: string | null; piece: number; dropEntryId: string | null; shopRequestId: string | null };
  release: { id: string; title: string } | null;
  accountId: string;
  model: { id: string; name: string };
  sizeLabel: string | null;
  skuId: string | null;
  priceMinor: number | null;
  currency: string | null;
  addons: OrderAddonSnapshot[];
  surprise: string | null;
  engravingText: string | null;
  buyer: { name: string | null; address: string | null };
  status: OrderStatus;
  reservedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  returnedAt: Date | null;
  location: { id: string; name: string };
  reservation: OrderReservation | null;
  /** Its open piece to make, and the reference of the identity reserved for it. */
  bench: { id: string; status: string; productId: string } | null;
  shipment: { carrier: { id: string; name: string }; trackingNumber: string; trackingUrl: string; declaredValueMinor: number | null } | null;
  /** The piece that fulfils it, by its reference. */
  productId: string | null;
  shopifyOrderId: string | null;
  /** Its return (RETURNED): where the piece went, the note, and whether ORBES took its buyer's ownership back. */
  return: { outcome: ReturnOutcome; location: { id: string; name: string } | null; note: string; at: Date; ownershipReclaimed: boolean } | null;
  /** Its invoice and credit note (services/invoices.ts), in order of issue. */
  invoices: OrderDocument[];
  /** Its history, oldest first. */
  events: { action: string; status: OrderStatus; note: string | null; at: Date; actor: { type: string; id: string | null } }[];
}

/** An invoice or a credit note of an order, as its page lists it. */
export interface OrderDocument {
  id: string;
  kind: InvoiceKind;
  number: string;
  issuedAt: Date;
  currency: string;
  totalMinor: number;
}

/** An order as the right of access exports it to its account: never who handled it, nor where it is kept. */
export interface ExportedOrder {
  reference: string;
  channel: OrderChannel;
  release: string | null;
  model: string;
  size: string | null;
  priceMinor: number | null;
  currency: string | null;
  addons: { label: string; priceMinor: number }[];
  engravingText: string | null;
  buyer: { name: string | null; address: string | null };
  status: OrderStatus;
  reservedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  returnedAt: Date | null;
  carrier: string | null;
  trackingNumber: string | null;
  /** Its invoice and credit note: their numbers, dates and totals (their buyer is the order's). */
  invoices: { number: string; kind: InvoiceKind; issuedAt: Date; currency: string; totalMinor: number }[];
  /** Each step with its time and the note Client Services added. */
  history: { status: OrderStatus; at: Date; note: string | null }[];
}

/** The orders MY PIECES reads, at most: the account's latest (GET /api/v1/account/orders). */
export const ACCOUNT_ORDERS_LIMIT = 100;

/**
 * An order as its collector reads it in MY PIECES (choice 6; GET /api/v1/account/orders): its steps and their times,
 * the model, the size, the add-ons and the price as sold, and once shipped the carrier and the tracking number with
 * its link. Never where it is served from, what it holds, the surprise, the buyer's details nor the engraving's words
 * (entered by Client Services), the value declared, the notes, nor who handled it.
 */
export interface AccountOrder {
  id: string;
  reference: string;
  channel: OrderChannel;
  /** The release it was sold in (a LIVE RELEASE, a draw); null for the private salon. */
  release: string | null;
  model: string;
  /** null while ORBES Client Services has not entered it (a draw's, a salon's order); `{ label: null }`: one size. */
  size: { label: string | null } | null;
  /** null, with the currency, while ORBES Client Services has not entered it. */
  priceMinor: number | null;
  currency: string | null;
  /** As sold, each at its price per piece. */
  addons: { label: string; priceMinor: number }[];
  status: OrderStatus;
  reservedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  returnedAt: Date | null;
  shipment: { carrier: string; trackingNumber: string; trackingUrl: string } | null;
  /** Its documents (M6), each read by its own route (GET /api/v1/account/orders/:id/…). */
  documents: AccountOrderDocuments;
}

/** The documents of an order in MY PIECES (M6). */
export interface AccountOrderDocuments {
  /** Its invoice (PDF), once PAID. */
  invoice: { number: string; issuedAt: Date } | null;
  /** The credit note that cancels it (PDF), once cancelled after PAID or returned. */
  creditNote: { number: string; issuedAt: Date } | null;
  /** The model's care guide: for an order whose piece is on its way or kept (neither cancelled nor returned). */
  careGuide: boolean;
  /** Its ownership certificate (PDF): once its piece is registered to this account, and while it may have one. */
  certificate: boolean;
}

/** The model's care guide of an order (GET /api/v1/account/orders/:id/care-guide): its own words, or null for the house's general care text. */
export interface OrderCareGuide {
  model: string;
  text: string | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** An order as the event journal says it after a change: ids and facts, never the buyer's details nor the engraving text. */
export function orderPayload(o: OrderRow): JsonObject {
  return {
    id: o.id,
    reference: orderReference(o.id),
    channel: o.channel,
    liveEntryId: o.live_entry_id,
    piece: o.piece,
    dropEntryId: o.drop_entry_id,
    shopRequestId: o.shop_request_id,
    dropId: o.drop_id,
    accountId: o.account_id,
    modelId: o.model_id,
    sizeLabel: o.size_label,
    skuId: o.sku_id,
    priceMinor: o.price_minor,
    currency: o.currency,
    addons: o.addons,
    surprise: o.surprise,
    engraving: o.engraving_text !== null,
    buyer: o.buyer_name !== null || o.buyer_address !== null,
    status: o.status,
    reservedAt: iso(o.reserved_at),
    paidAt: iso(o.paid_at),
    shippedAt: iso(o.shipped_at),
    deliveredAt: iso(o.delivered_at),
    cancelledAt: iso(o.cancelled_at),
    returnedAt: iso(o.returned_at),
    locationId: o.location_id,
    reservation: o.reservation,
    carrierId: o.carrier_id,
    trackingNumber: o.tracking_number,
    declaredValueMinor: o.declared_value_minor,
    productId: o.product_id,
    shopifyOrderId: o.shopify_order_id,
  };
}

/** A piece to make as the event journal says it (`bench.create`, `.cancel`, `.move`, `.engrave`): never its engraving text. */
export function benchPayload(b: {
  id: string;
  order_id: string | null;
  sku_id: string;
  location_id: string;
  drop_id: string | null;
  product_id: string;
  status: string;
  engraving_text: string | null;
  surprise: string | null;
  created_at: Date;
  started_at: Date | null;
  done_at: Date | null;
  cancelled_at: Date | null;
}): JsonObject {
  return {
    id: b.id,
    orderId: b.order_id,
    skuId: b.sku_id,
    locationId: b.location_id,
    dropId: b.drop_id,
    productId: b.product_id,
    status: b.status,
    engraving: b.engraving_text !== null,
    surprise: b.surprise,
    createdAt: iso(b.created_at),
    startedAt: iso(b.started_at),
    doneAt: iso(b.done_at),
    cancelledAt: iso(b.cancelled_at),
  };
}

// ── The changes (inside a transaction) ─────────────────────────────────────

/** An order's row FOR UPDATE (404 ORDER_NOT_FOUND). */
async function lockOrder(tx: Db, orderId: string): Promise<OrderRow> {
  const o = await tx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
  if (!o) throw orderNotFound();
  return o;
}

/** Update an order and read it back. */
async function updateOrder(tx: Db, id: string, set: OrderUpdate): Promise<OrderRow> {
  return tx.updateTable('orders').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
}

/**
 * Record one change of an order: its event (the status after it), its journal entry (the order as it stands), and the
 * audit entry the caller writes last. The note and the details are Client Services' words and ids, never the buyer's.
 */
async function recordChange(
  tx: Db,
  before: OrderRow | null,
  after: OrderRow,
  action: string,
  change: { note?: string | null; details?: JsonObject; at?: Date },
  actor: Actor,
  now: Date,
): Promise<AuditRecordInput> {
  const details = change.details ?? {};
  await tx
    .insertInto('order_events')
    .values({
      order_id: after.id,
      action,
      status: after.status,
      note: change.note ?? null,
      details: jsonText(details),
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      created_at: change.at ?? now,
    })
    .execute();
  await writeJournal(tx, [{ type: action, entityType: 'order', entityId: after.id, payload: orderPayload(after) }], now);
  return {
    actor,
    action,
    targetType: 'order',
    targetId: after.id,
    details: { ...(before ? { from: before.status } : { channel: after.channel }), to: after.status, ...details, ...(change.note ? { noted: true } : {}) },
  };
}

/**
 * What an order RESERVED or PAID, its SKU known and holding nothing, takes at its location: one piece in stock when
 * one is available (STOCK), otherwise a piece to make with its identity reserved (BENCH). Under the SKU's lock.
 */
async function hold(tx: Db, o: OrderRow, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<OrderRow> {
  if (o.sku_id === null || o.reservation !== null || !ORDER_HOLDING_STATUSES.includes(o.status)) return o;
  await lockSku(tx, o.sku_id);
  const level = await stockLevel(tx, o.sku_id, o.location_id);
  if (level.available >= 1) return updateOrder(tx, o.id, { reservation: 'STOCK' });
  const identity = await reserveIdentity(tx, { modelId: o.model_id, skuId: o.sku_id, sizeLabel: o.size_label }, now);
  const bench = await tx
    .insertInto('bench_items')
    .values({
      order_id: o.id,
      sku_id: o.sku_id,
      location_id: o.location_id,
      drop_id: o.drop_id,
      product_id: identity.id,
      engraving_text: o.engraving_text,
      surprise: o.surprise,
      created_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeJournal(tx, [{ type: 'bench.create', entityType: 'bench_item', entityId: bench.id, payload: benchPayload(bench) }], now);
  notes.push({
    actor,
    action: 'bench.create',
    targetType: 'bench_item',
    targetId: bench.id,
    details: { orderId: o.id, skuId: o.sku_id, locationId: o.location_id, dropId: o.drop_id, productId: identity.productId },
  });
  return updateOrder(tx, o.id, { reservation: 'BENCH' });
}

/**
 * Give back what an order holds: a piece in stock is released (under the SKU's lock); its open piece to make is
 * cancelled and the identity reserved for it retired (its serial never reused).
 */
async function release(tx: Db, o: OrderRow, reason: string, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<OrderRow> {
  if (o.reservation === null) return o;
  if (o.reservation === 'STOCK') {
    await lockSku(tx, o.sku_id!);
    return updateOrder(tx, o.id, { reservation: null });
  }
  const bench = await tx.selectFrom('bench_items').selectAll().where('order_id', '=', o.id).where('status', 'in', ['TO_MAKE', 'IN_PROGRESS']).forUpdate().executeTakeFirst();
  if (bench) {
    const cancelled = await tx
      .updateTable('bench_items')
      .set({ status: 'CANCELLED', cancelled_at: now })
      .where('id', '=', bench.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeJournal(tx, [{ type: 'bench.cancel', entityType: 'bench_item', entityId: bench.id, payload: benchPayload(cancelled) }], now);
    const retired = await retireReservedIdentity(tx, bench.product_id, reason, actor, now);
    notes.push({ actor, action: 'bench.cancel', targetType: 'bench_item', targetId: bench.id, details: { orderId: o.id, productId: bench.product_id, retired } });
  }
  return updateOrder(tx, o.id, { reservation: null });
}

interface NewOrder {
  channel: OrderChannel;
  liveEntryId?: string;
  piece?: number;
  dropEntryId?: string;
  shopRequestId?: string;
  dropId: string | null;
  accountId: string;
  modelId: string;
  sizeLabel: string | null;
  skuId: string | null;
  priceMinor: number | null;
  currency: string | null;
  addons: OrderAddonSnapshot[];
  surprise: string | null;
  locationId: string;
  /** When the sale was made, for an order created after it (at boot: `OrderService.prepare`); `now` otherwise. */
  reservedAt?: Date;
}

/**
 * Create an order RESERVED, take what it holds (unless `hold` is false), and record its creation: its RESERVED step,
 * in its history too, at the time of the sale.
 */
async function createOrder(tx: Db, n: NewOrder, opts: { hold: boolean }, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<OrderRow> {
  let o = await tx
    .insertInto('orders')
    .values({
      channel: n.channel,
      live_entry_id: n.liveEntryId ?? null,
      piece: n.piece ?? 1,
      drop_entry_id: n.dropEntryId ?? null,
      shop_request_id: n.shopRequestId ?? null,
      drop_id: n.dropId,
      account_id: n.accountId,
      model_id: n.modelId,
      size_label: n.sizeLabel,
      sku_id: n.skuId,
      price_minor: n.priceMinor,
      currency: n.currency,
      addons: jsonText(n.addons),
      surprise: n.surprise,
      location_id: n.locationId,
      reserved_at: n.reservedAt && n.reservedAt < now ? n.reservedAt : now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const benchNotes: AuditRecordInput[] = [];
  if (opts.hold) o = await hold(tx, o, actor, now, benchNotes);
  const source: JsonObject = n.liveEntryId ? { liveEntryId: n.liveEntryId, piece: o.piece } : n.dropEntryId ? { dropEntryId: n.dropEntryId } : { shopRequestId: n.shopRequestId! };
  notes.push(
    await recordChange(tx, null, o, 'order.create', { details: { ...source, dropId: n.dropId, skuId: o.sku_id, locationId: o.location_id, reservation: o.reservation }, at: o.reserved_at }, actor, now),
    ...benchNotes,
  );
  return o;
}

/** The location a release's orders go to: its own, or the default. */
async function releaseLocation(tx: Db, stockLocationId: string | null): Promise<string> {
  return stockLocationId ?? (await defaultLocationId(tx));
}

/**
 * The orders of an entry of a LIVE RELEASE CONFIRMED, in the transaction that confirms it (the release's row and the
 * entry's held): one per piece of its quantity, each with the release's price and currency and the entry's add-ons as
 * sold, RESERVED at the release's location and holding what it can (`hold` false: nothing, for a reservation cancelled
 * before its orders existed; `reservedAt`: the time of the sale, for one confirmed before its orders existed). Idempotent:
 * only the pieces without an order get one. Returns the orders created and the audit entries to write last.
 */
export async function ordersForLiveEntry(tx: Db, entryId: string, actor: Actor, now: Date, opts: { hold?: boolean; reservedAt?: Date } = {}): Promise<{ orders: OrderRow[]; notes: AuditRecordInput[] }> {
  const e = await tx
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select(['e.id', 'e.account_id', 'e.quantity', 'e.status', 'd.id as drop_id', 'd.model_id', 'd.price_minor', 'd.currency', 'd.stock_location_id', 's.id as size_id', 's.label', 's.sku_id'])
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  if (!e || e.status !== 'CONFIRMED') throw new Error(`ordersForLiveEntry: entry ${entryId} is not CONFIRMED`);
  const existing = new Set((await tx.selectFrom('orders').select('piece').where('live_entry_id', '=', e.id).execute()).map((r) => r.piece));
  const notes: AuditRecordInput[] = [];
  const orders: OrderRow[] = [];
  if (existing.size >= e.quantity) return { orders, notes };
  let skuId = e.sku_id;
  if (skuId === null) {
    skuId = await ensureSku(tx, e.model_id, e.label);
    await tx.updateTable('drop_sizes').set({ sku_id: skuId }).where('id', '=', e.size_id).execute();
  }
  const addons = await tx
    .selectFrom('live_entry_addons as x')
    .innerJoin('live_addons as l', 'l.id', 'x.addon_id')
    .select(['l.id', 'l.label', 'x.price_minor'])
    .where('x.entry_id', '=', e.id)
    .orderBy('l.position')
    .execute();
  const locationId = await releaseLocation(tx, e.stock_location_id);
  for (let piece = 1; piece <= e.quantity; piece++) {
    if (existing.has(piece)) continue;
    orders.push(
      await createOrder(
        tx,
        {
          channel: 'LIVE',
          liveEntryId: e.id,
          piece,
          dropId: e.drop_id,
          accountId: e.account_id,
          modelId: e.model_id,
          sizeLabel: sizeLabelOf(e.label),
          skuId,
          priceMinor: e.price_minor,
          currency: e.currency,
          addons: addons.map((a) => ({ id: a.id, label: a.label, priceMinor: a.price_minor })),
          surprise: null,
          locationId,
          reservedAt: opts.reservedAt,
        },
        { hold: opts.hold ?? true },
        actor,
        now,
        notes,
      ),
    );
  }
  return { orders, notes };
}

/**
 * The order of an entry of a draw confirmed by Client Services, in the transaction that confirms it (the drop's row and
 * the entry's held): RESERVED at the drop's location, its size, price and currency to be entered (`setTerms`)
 * (`reservedAt`: the time of the sale, for an entry confirmed before its order existed). Idempotent (null when the entry
 * has its order).
 */
export async function orderForDrawEntry(tx: Db, entryId: string, actor: Actor, now: Date, opts: { reservedAt?: Date } = {}): Promise<{ order: OrderRow | null; notes: AuditRecordInput[] }> {
  const e = await tx
    .selectFrom('drop_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .select(['e.id', 'e.account_id', 'e.status', 'd.id as drop_id', 'd.model_id', 'd.stock_location_id'])
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  if (!e || e.status !== 'CONFIRMED') throw new Error(`orderForDrawEntry: entry ${entryId} is not CONFIRMED`);
  if (await tx.selectFrom('orders').select('id').where('drop_entry_id', '=', e.id).executeTakeFirst()) return { order: null, notes: [] };
  const notes: AuditRecordInput[] = [];
  const order = await createOrder(
    tx,
    {
      channel: 'DRAW',
      dropEntryId: e.id,
      dropId: e.drop_id,
      accountId: e.account_id,
      modelId: e.model_id,
      sizeLabel: null,
      skuId: null,
      priceMinor: null,
      currency: null,
      addons: [],
      surprise: null,
      locationId: await releaseLocation(tx, e.stock_location_id),
      reservedAt: opts.reservedAt,
    },
    { hold: true },
    actor,
    now,
    notes,
  );
  return { order, notes };
}

/**
 * The order of a request of the private salon closed as ACCEPTED, in the transaction that closes it (the request's row
 * held): RESERVED at the default location, its size, price and currency to be entered (`setTerms`). Idempotent.
 */
export async function orderForShopRequest(tx: Db, requestId: string, actor: Actor, now: Date): Promise<{ order: OrderRow | null; notes: AuditRecordInput[] }> {
  const r = await tx.selectFrom('shop_requests').select(['id', 'account_id', 'model_id', 'status', 'outcome']).where('id', '=', requestId).executeTakeFirst();
  if (!r || r.status !== 'CLOSED' || r.outcome !== 'ACCEPTED') throw new Error(`orderForShopRequest: request ${requestId} is not ACCEPTED`);
  if (await tx.selectFrom('orders').select('id').where('shop_request_id', '=', r.id).executeTakeFirst()) return { order: null, notes: [] };
  const notes: AuditRecordInput[] = [];
  const order = await createOrder(
    tx,
    {
      channel: 'SALON',
      shopRequestId: r.id,
      dropId: null,
      accountId: r.account_id,
      modelId: r.model_id,
      sizeLabel: null,
      skuId: null,
      priceMinor: null,
      currency: null,
      addons: [],
      surprise: null,
      locationId: await defaultLocationId(tx),
    },
    { hold: true },
    actor,
    now,
    notes,
  );
  return { order, notes };
}

/** What a step requires, checked before the transaction. */
type CheckedStep =
  | { to: 'PAID'; note: string | null }
  | { to: 'SHIPPED'; carrierId: string; trackingNumber: string; declaredValueMinor: number | null; note: string | null }
  | { to: 'DELIVERED'; note: string | null; details?: JsonObject }
  | { to: 'CANCELLED'; note: string };

function checkStep(input: OrderTransitionInput): CheckedStep {
  if (!input || typeof input !== 'object' || !(ORDER_STATUSES as readonly string[]).includes((input as { to: unknown }).to as string)) {
    throw validationError('Unknown order step.');
  }
  const note = (required = false) => cleanText((input as { note?: unknown }).note, ORDER_TEXT_LIMITS.note, 'The note', { multiline: true, required });
  switch (input.to) {
    case 'PAID':
      return { to: 'PAID', note: note() };
    case 'SHIPPED': {
      if (typeof input.carrierId !== 'string' || !UUID_RE.test(input.carrierId)) throw carrierUnknown();
      const tracking = typeof input.trackingNumber === 'string' ? input.trackingNumber.trim() : '';
      if (!TRACKING_RE.test(tracking)) throw validationError('A tracking number has 3 to 40 letters and digits.');
      const declared = input.declaredValueMinor === null || input.declaredValueMinor === undefined ? null : cleanAmount(input.declaredValueMinor, 'The declared value');
      return { to: 'SHIPPED', carrierId: input.carrierId.toLowerCase(), trackingNumber: tracking, declaredValueMinor: declared, note: note() };
    }
    case 'DELIVERED':
      return { to: 'DELIVERED', note: note() };
    case 'CANCELLED':
      return { to: 'CANCELLED', note: note(true)! };
    default:
      if ((input as { to: unknown }).to === 'RETURNED') throw validationError('A return is opened with where the piece goes (returnOrder).');
      throw validationError('An order is created RESERVED: it never moves back to it.');
  }
}

/** What a return requires, checked before the transaction: where the piece goes, and a note. */
function checkReturn(input: OrderReturnInput): { outcome: ReturnOutcome; locationId: string | null; note: string } {
  if (!input || typeof input !== 'object' || !(RETURN_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw validationError('A return goes back to stock (RESTOCKED) or to the archive (ARCHIVED).');
  }
  const locationId = input.outcome === 'RESTOCKED' ? input.locationId ?? null : null;
  if (input.outcome === 'RESTOCKED' && (typeof locationId !== 'string' || !UUID_RE.test(locationId))) throw notFound('Location', 'STOCK_LOCATION_NOT_FOUND');
  if (input.outcome === 'ARCHIVED' && input.locationId) throw validationError('A piece archived goes to no location.');
  const note = cleanText(input.note, ORDER_TEXT_LIMITS.note, 'The note', { multiline: true, required: true })!;
  return { outcome: input.outcome, locationId: locationId?.toLowerCase() ?? null, note };
}

/** Move a locked order one step (the step's own rules); returns the order after it. */
async function step(tx: Db, o: OrderRow, s: CheckedStep, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<OrderRow> {
  if (!isOrderTransitionAllowed(o.status, s.to)) throw stepNotAllowed(o.status, s.to);
  const extra: AuditRecordInput[] = [];
  let after: OrderRow;
  let details: JsonObject = {};
  switch (s.to) {
    case 'PAID': {
      if (o.price_minor === null || o.currency === null) throw priceMissing();
      after = await updateOrder(tx, o.id, { status: 'PAID', paid_at: now });
      break;
    }
    case 'SHIPPED': {
      if (o.reservation !== 'STOCK') throw notReady();
      if (o.product_id === null) throw pieceNotLinked();
      const carrier = await tx.selectFrom('carriers').select(['id', 'active']).where('id', '=', s.carrierId).executeTakeFirst();
      if (!carrier || !carrier.active) throw carrierUnknown();
      if (s.declaredValueMinor !== null && o.currency === null) throw validationError('Enter the order’s price and currency before declaring a value.');
      await lockSku(tx, o.sku_id!);
      await recordMovement(tx, { skuId: o.sku_id!, locationId: o.location_id, delta: -1, reason: 'SHIPPED', orderId: o.id, productId: o.product_id }, actor, now);
      after = await updateOrder(tx, o.id, {
        status: 'SHIPPED',
        shipped_at: now,
        reservation: null,
        carrier_id: carrier.id,
        tracking_number: s.trackingNumber,
        declared_value_minor: s.declaredValueMinor,
      });
      details = { carrierId: carrier.id, ...(s.declaredValueMinor !== null ? { declaredValueMinor: s.declaredValueMinor } : {}) };
      break;
    }
    case 'DELIVERED':
      after = await updateOrder(tx, o.id, { status: 'DELIVERED', delivered_at: now });
      details = s.details ?? {};
      break;
    case 'CANCELLED': {
      const released = await release(tx, o, 'Reserved identity retired: its order was cancelled', actor, now, extra);
      after = await updateOrder(tx, released.id, { status: 'CANCELLED', cancelled_at: now });
      details = { released: o.reservation };
      break;
    }
  }
  notes.push(await recordChange(tx, o, after, ORDER_STEP_ACTIONS[s.to], { note: s.note, details }, actor, now), ...extra);
  // PAID issues the invoice; paid, then cancelled, a credit note cancels it (services/invoices.ts).
  const document = s.to === 'PAID' ? await issueInvoice(tx, after, actor, now) : s.to === 'CANCELLED' && o.status === 'PAID' ? await issueCreditNote(tx, after, 'cancel', actor, now) : null;
  if (document) notes.push(document);
  return after;
}

/**
 * DELIVERED by itself (Interconnection, the plan's decision): the buyer registers the piece linked to their order while
 * it is SHIPPED, in the transaction of the registration (the piece's row held), before its audit entries. Returns the
 * audit entries to write; none when no such order exists.
 */
export async function deliverOnRegistration(tx: Db, productUuid: string, accountId: string, actor: Actor, now: Date): Promise<AuditRecordInput[]> {
  const o = await tx
    .selectFrom('orders')
    .selectAll()
    .where('product_id', '=', productUuid)
    .where('account_id', '=', accountId)
    .where('status', '=', 'SHIPPED')
    .forUpdate()
    .executeTakeFirst();
  if (!o) return [];
  const notes: AuditRecordInput[] = [];
  await step(tx, o, { to: 'DELIVERED', note: null, details: { by: 'registration' } }, actor, now, notes);
  return notes;
}

/**
 * Link the piece that fulfils an order (Interconnection: the atelier issues it, or picks one from stock), in the
 * caller's transaction, the order's row and its SKU locked, the piece issued: the order RESERVED or PAID now holds
 * that piece in stock at its location (`reservation` STOCK, `product_id`); `via` says how (`bench`: its piece to make
 * finished, `stock`: a piece picked from the stock). One event, one journal entry and the audit entry returned for the
 * caller to write last (`order.link`).
 */
export async function attachPiece(tx: Db, o: OrderRow, productUuid: string, via: 'bench' | 'stock', actor: Actor, now: Date): Promise<{ order: OrderRow; note: AuditRecordInput }> {
  if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
  if (o.product_id !== null) throw pieceLinked();
  const after = await updateOrder(tx, o.id, { product_id: productUuid, reservation: 'STOCK' });
  const note = await recordChange(tx, o, after, 'order.link', { details: { productId: productUuid, via, reservation: 'STOCK' } }, actor, now);
  return { order: after, note };
}

/** Every order of an account, oldest first, for its right-of-access export (OwnerService.exportData). */
export async function accountOrders(db: Db, accountId: string): Promise<ExportedOrder[]> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const rows = await db
    .selectFrom('orders as o')
    .innerJoin('models as m', 'm.id', 'o.model_id')
    .leftJoin('drops as d', 'd.id', 'o.drop_id')
    .leftJoin('carriers as c', 'c.id', 'o.carrier_id')
    .selectAll('o')
    .select(['m.name as model_name', 'd.title as release_title', 'c.name as carrier_name'])
    .where('o.account_id', '=', accountId.toLowerCase())
    .orderBy('o.reserved_at')
    .orderBy('o.id')
    .execute();
  const events = rows.length
    ? await db.selectFrom('order_events').select(['order_id', 'status', 'note', 'created_at']).where('order_id', 'in', rows.map((r) => r.id)).orderBy('id').execute()
    : [];
  const invoices = await orderInvoices(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    reference: orderReference(r.id),
    channel: r.channel,
    release: r.release_title ?? null,
    model: r.model_name,
    size: r.size_label,
    priceMinor: r.price_minor,
    currency: r.currency,
    addons: r.addons.map((a) => ({ label: a.label, priceMinor: a.priceMinor })),
    engravingText: r.engraving_text,
    buyer: { name: r.buyer_name, address: r.buyer_address },
    status: r.status,
    reservedAt: r.reserved_at,
    paidAt: r.paid_at,
    shippedAt: r.shipped_at,
    deliveredAt: r.delivered_at,
    cancelledAt: r.cancelled_at,
    returnedAt: r.returned_at,
    carrier: r.carrier_name ?? null,
    trackingNumber: r.tracking_number,
    invoices: invoices.filter((i) => i.order.id === r.id).map((i) => ({ number: i.number, kind: i.kind, issuedAt: i.issuedAt, currency: i.currency, totalMinor: i.totalMinor })),
    history: events.filter((e) => e.order_id === r.id).map((e) => ({ status: e.status, at: e.created_at, note: e.note })),
  }));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface OrderServiceDeps {
  db: Db;
  audit: AuditService;
  /** The piece's status after a return (its own, by default). */
  lifecycle?: LifecycleService;
  clock?: Clock;
  log?: Logger;
}

export class OrderService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly lifecycle: LifecycleService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: OrderServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.lifecycle = deps.lifecycle ?? new LifecycleService({ db: deps.db, audit: deps.audit, clock: this.clock });
    this.log = deps.log ?? noopLogger;
  }

  /** An order with its model, location, piece to make, shipment and history (404 ORDER_NOT_FOUND). */
  async get(orderId: string): Promise<OrderView> {
    const id = knownOrderId(orderId);
    const r = await this.db
      .selectFrom('orders as o')
      .innerJoin('models as m', 'm.id', 'o.model_id')
      .innerJoin('stock_locations as l', 'l.id', 'o.location_id')
      .leftJoin('drops as d', 'd.id', 'o.drop_id')
      .leftJoin('carriers as c', 'c.id', 'o.carrier_id')
      .leftJoin('products as p', 'p.id', 'o.product_id')
      .selectAll('o')
      .select(['m.name as model_name', 'l.name as location_name', 'd.title as release_title', 'c.name as carrier_name', 'c.tracking_url', 'p.product_id as piece_reference'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!r) throw orderNotFound();
    const bench = await this.db
      .selectFrom('bench_items as b')
      .innerJoin('products as p', 'p.id', 'b.product_id')
      .select(['b.id', 'b.status', 'p.product_id'])
      .where('b.order_id', '=', id)
      .where('b.status', 'in', ['TO_MAKE', 'IN_PROGRESS'])
      .executeTakeFirst();
    const events = await this.db.selectFrom('order_events').selectAll().where('order_id', '=', id).orderBy('id').execute();
    const returned = await this.db
      .selectFrom('returns as x')
      .leftJoin('stock_locations as l', 'l.id', 'x.location_id')
      .select(['x.outcome', 'x.location_id', 'l.name as location_name', 'x.note', 'x.ownership_id', 'x.created_at'])
      .where('x.order_id', '=', id)
      .executeTakeFirst();
    const invoices = await orderInvoices(this.db, [id]);
    return {
      id: r.id,
      reference: orderReference(r.id),
      channel: r.channel,
      source: { liveEntryId: r.live_entry_id, piece: r.piece, dropEntryId: r.drop_entry_id, shopRequestId: r.shop_request_id },
      release: r.drop_id && r.release_title ? { id: r.drop_id, title: r.release_title } : null,
      accountId: r.account_id,
      model: { id: r.model_id, name: r.model_name },
      sizeLabel: r.size_label,
      skuId: r.sku_id,
      priceMinor: r.price_minor,
      currency: r.currency,
      addons: r.addons,
      surprise: r.surprise,
      engravingText: r.engraving_text,
      buyer: { name: r.buyer_name, address: r.buyer_address },
      status: r.status,
      reservedAt: r.reserved_at,
      paidAt: r.paid_at,
      shippedAt: r.shipped_at,
      deliveredAt: r.delivered_at,
      cancelledAt: r.cancelled_at,
      returnedAt: r.returned_at,
      location: { id: r.location_id, name: r.location_name },
      reservation: r.reservation,
      bench: bench ? { id: bench.id, status: bench.status, productId: bench.product_id } : null,
      shipment:
        r.carrier_id && r.tracking_number
          ? {
              carrier: { id: r.carrier_id, name: r.carrier_name! },
              trackingNumber: r.tracking_number,
              trackingUrl: trackingLink(r.tracking_url!, r.tracking_number),
              declaredValueMinor: r.declared_value_minor,
            }
          : null,
      productId: r.piece_reference ?? null,
      shopifyOrderId: r.shopify_order_id,
      return: returned
        ? {
            outcome: returned.outcome,
            location: returned.location_id && returned.location_name ? { id: returned.location_id, name: returned.location_name } : null,
            note: returned.note,
            at: returned.created_at,
            ownershipReclaimed: returned.ownership_id !== null,
          }
        : null,
      invoices: invoices.map((i) => ({ id: i.id, kind: i.kind, number: i.number, issuedAt: i.issuedAt, currency: i.currency, totalMinor: i.totalMinor })),
      events: events.map((e) => ({ action: e.action, status: e.status, note: e.note, at: e.created_at, actor: { type: e.actor_type, id: e.actor_id } })),
    };
  }

  /**
   * The account's own orders as MY PIECES shows them (AccountOrder), the latest first (ACCOUNT_ORDERS_LIMIT), the pieces
   * of one sale in their order. Only the account's: the route passes its session's account, never an id it was sent.
   */
  async forAccount(accountId: string): Promise<AccountOrder[]> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const rows = await this.db
      .selectFrom('orders as o')
      .innerJoin('models as m', 'm.id', 'o.model_id')
      .leftJoin('drops as d', 'd.id', 'o.drop_id')
      .leftJoin('carriers as c', 'c.id', 'o.carrier_id')
      .leftJoin('products as p', 'p.id', 'o.product_id')
      // Its piece registered to this account now: the one ownership still open, the account's.
      .leftJoin('ownership as w', (j) => j.onRef('w.product_id', '=', 'o.product_id').onRef('w.account_id', '=', 'o.account_id').on('w.ended_at', 'is', null))
      .select([
        'o.id',
        'o.channel',
        'o.sku_id',
        'o.size_label',
        'o.price_minor',
        'o.currency',
        'o.addons',
        'o.status',
        'o.reserved_at',
        'o.paid_at',
        'o.shipped_at',
        'o.delivered_at',
        'o.cancelled_at',
        'o.returned_at',
        'o.tracking_number',
        'm.name as model_name',
        'd.title as release_title',
        'c.name as carrier_name',
        'c.tracking_url',
        'p.status as piece_status',
        'w.id as ownership_id',
      ])
      .where('o.account_id', '=', accountId.toLowerCase())
      .orderBy('o.reserved_at', 'desc')
      .orderBy('o.piece')
      .orderBy('o.id')
      .limit(ACCOUNT_ORDERS_LIMIT)
      .execute();
    const invoices = await orderInvoices(this.db, rows.map((r) => r.id));
    const documentOf = (orderId: string, kind: InvoiceKind) => {
      const i = invoices.find((x) => x.order.id === orderId && x.kind === kind);
      return i ? { number: i.number, issuedAt: i.issuedAt } : null;
    };
    return rows.map((r) => ({
      id: r.id,
      reference: orderReference(r.id),
      channel: r.channel,
      release: r.release_title ?? null,
      model: r.model_name,
      // A size is known once its SKU is (null: one size); before, ORBES Client Services has still to enter it.
      size: r.sku_id === null ? null : { label: r.size_label },
      priceMinor: r.price_minor,
      currency: r.price_minor === null ? null : r.currency,
      addons: r.addons.map((a) => ({ label: a.label, priceMinor: a.priceMinor })),
      status: r.status,
      reservedAt: r.reserved_at,
      paidAt: r.paid_at,
      shippedAt: r.shipped_at,
      deliveredAt: r.delivered_at,
      cancelledAt: r.cancelled_at,
      returnedAt: r.returned_at,
      shipment:
        r.carrier_name && r.tracking_url && r.tracking_number
          ? { carrier: r.carrier_name, trackingNumber: r.tracking_number, trackingUrl: trackingLink(r.tracking_url, r.tracking_number) }
          : null,
      documents: {
        invoice: documentOf(r.id, 'INVOICE'),
        creditNote: documentOf(r.id, 'CREDIT_NOTE'),
        careGuide: r.status !== 'CANCELLED' && r.status !== 'RETURNED',
        certificate: r.ownership_id !== null && r.piece_status !== null && !CERTIFICATE_ENDING_STATUSES.includes(r.piece_status),
      },
    }));
  }

  /**
   * The care guide of an order's model, for its own account (M6): the model's guide, or its care instructions (the
   * CARE text of a scan), or null for the house's general care text (shared/care.ts). 404 ORDER_NOT_FOUND for another
   * account's order or an unknown one.
   */
  async careGuide(accountId: string, orderId: string): Promise<OrderCareGuide> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const id = knownOrderId(orderId);
    const r = await this.db
      .selectFrom('orders as o')
      .innerJoin('models as m', 'm.id', 'o.model_id')
      .select(['m.name', 'm.care_guide', 'm.care_instructions'])
      .where('o.id', '=', id)
      .where('o.account_id', '=', accountId.toLowerCase())
      .executeTakeFirst();
    if (!r) throw orderNotFound();
    return { model: r.name, text: r.care_guide ?? r.care_instructions ?? null };
  }

  /**
   * Move an order one step (ORDER_TRANSITIONS; 409 ORDER_TRANSITION_NOT_ALLOWED otherwise), with what the step
   * requires: PAID its price (its invoice issued); SHIPPED a carrier and a tracking number, the piece in stock at the
   * order's location; CANCELLED a note (a credit note once paid). A return is `returnOrder`. Audited `order.pay`,
   * `.ship`, `.deliver`, `.cancel`, and `invoice.issue` or `invoice.credit`.
   */
  async transition(orderId: string, input: OrderTransitionInput, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    const s = checkStep(input);
    await this.change(id, async (tx, o, now, notes) => {
      await step(tx, o, s, actor, now, notes);
    });
    return this.get(id);
  }

  /**
   * RETURNED (choice 20; from SHIPPED or DELIVERED, 409 ORDER_TRANSITION_NOT_ALLOWED otherwise), opened by Client
   * Services with a note: the piece goes back to stock at a location (the ledger's RETURNED, +1; the piece RESOLD, ready
   * to be sold again, or still ISSUED if it never was: 409 ORDER_RETURN_NOT_RESTOCKABLE when its record is in service,
   * reported or flagged) or to the archive (RETIRED, unless already retired or revoked). When its buyer had registered
   * it, ORBES takes the ownership back: it ends (RETURNED, `returns.ownership_id`), a transfer pending is cancelled, the
   * piece is not registered any more and, back to stock, carries a new claim code (returned once, for its new card;
   * only its hash is kept). A credit note cancels the invoice. Audited `order.return`, `ownership.reclaim` (and
   * `ownership.transfer.cancel`), `invoice.credit` and the piece's `product.transition`, in one transaction.
   */
  async returnOrder(orderId: string, input: OrderReturnInput, actor: Actor): Promise<OrderReturned> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    const r = checkReturn(input);
    // Whether an ownership is taken back is read first: the new claim code's scrypt runs outside the transaction, which
    // refuses the return if that changed meanwhile.
    const peek = await this.db
      .selectFrom('orders as o')
      .leftJoin('ownership as w', (j) => j.onRef('w.product_id', '=', 'o.product_id').on('w.ended_at', 'is', null))
      .select(['o.id', 'w.id as ownership_id'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!peek) throw orderNotFound();
    const reclaim = peek.ownership_id !== null;
    const claimCode = reclaim && r.outcome === 'RESTOCKED' ? generateClaimCode() : undefined;
    const claimHash = claimCode ? await hashClaimCode(claimCode) : null;
    let productId = '';
    await this.change(id, async (tx, o, now, notes) => {
      if (!isOrderTransitionAllowed(o.status, 'RETURNED')) throw stepNotAllowed(o.status, 'RETURNED');
      if (o.product_id === null || o.sku_id === null) throw pieceNotLinked();
      const locationId = r.outcome === 'RESTOCKED' ? await knownLocation(tx, r.locationId!) : null;
      if (locationId) await lockSku(tx, o.sku_id);
      const p = await tx.selectFrom('products').selectAll().where('id', '=', o.product_id).forUpdate().executeTakeFirstOrThrow();
      const owner = await tx.selectFrom('ownership').selectAll().where('product_id', '=', p.id).where('ended_at', 'is', null).forUpdate().executeTakeFirst();
      if ((owner !== undefined) !== reclaim) throw returnChanged();
      // The piece's status once back: ready to be sold again (RESOLD; ISSUED if it never was), or retired.
      let to: ProductStatus | null;
      if (r.outcome === 'ARCHIVED') to = p.status === 'RETIRED' || p.status === 'REVOKED' ? null : 'RETIRED';
      else to = p.status === 'ISSUED' || p.status === 'RESOLD' ? null : 'RESOLD';
      if (to !== null && !isTransitionAllowed(p.status, to, await returnTargetOf(tx, p))) throw notRestockable(p.status);
      if (locationId) await recordMovement(tx, { skuId: o.sku_id, locationId, delta: 1, reason: 'RETURNED', orderId: o.id, productId: p.id, note: r.note }, actor, now);
      const extra: AuditRecordInput[] = [];
      if (owner) {
        // ORBES takes the ownership back: it ends, a transfer pending with it is cancelled, the piece is unregistered.
        const endedAt = now < owner.started_at ? owner.started_at : now;
        await tx.updateTable('ownership').set({ ended_at: endedAt, ended_reason: 'RETURNED' }).where('id', '=', owner.id).execute();
        const transfers = await tx
          .updateTable('ownership_transfers')
          .set({ status: 'CANCELLED', completed_at: now })
          .where('product_id', '=', p.id)
          .where('status', '=', 'PENDING')
          .returning('id')
          .execute();
        await tx
          .updateTable('products')
          .set({ ownership_state: 'UNREGISTERED', updated_at: now, ...(claimHash ? { claim_secret_hash: claimHash } : {}) })
          .where('id', '=', p.id)
          .execute();
        p.ownership_state = 'UNREGISTERED';
        extra.push(
          {
            actor,
            action: 'ownership.reclaim',
            targetType: 'product',
            targetId: p.product_id,
            details: { accountId: owner.account_id, orderId: o.id, outcome: r.outcome, claimCodeReissued: claimHash !== null },
          },
          ...transfers.map((t): AuditRecordInput => ({ actor, action: 'ownership.transfer.cancel', targetType: 'product', targetId: p.product_id, details: { transferId: t.id, reason: 'order_returned' } })),
        );
      }
      await tx
        .insertInto('returns')
        .values({ order_id: o.id, outcome: r.outcome, location_id: locationId, note: r.note, ownership_id: owner?.id ?? null, created_by: actor.type === 'admin' ? actor.id! : null, created_at: now })
        .execute();
      const after = await updateOrder(tx, o.id, { status: 'RETURNED', returned_at: now });
      const details: JsonObject = { outcome: r.outcome, ...(locationId ? { locationId } : {}), ownershipReclaimed: owner !== undefined, ...(to ? { pieceStatus: to } : {}) };
      notes.push(await recordChange(tx, o, after, ORDER_STEP_ACTIONS.RETURNED, { note: r.note, details }, actor, now), ...extra);
      const credit = await issueCreditNote(tx, after, 'return', actor, now);
      if (credit) notes.push(credit);
      // Last: the piece's status, which LifecycleService audits at once (the audit chain's lock: no row is locked after it).
      if (to !== null) {
        await this.lifecycle.applyForService(tx, p, to, { reason: `Order ${orderReference(o.id)} returned`, via: 'order.return', ...(owner ? { ownershipState: 'UNREGISTERED' } : {}) }, actor);
      }
      productId = p.product_id;
    });
    return { order: await this.get(id), productId, ...(claimCode ? { claimCode } : {}) };
  }

  /**
   * Change where an order is served from (RESERVED or PAID; 409 ORDER_CLOSED after): what it holds moves with it, a
   * piece in stock released and taken again there (or made for it), a piece to make going there; refused once a piece
   * is linked to it (409 ORDER_PIECE_LINKED: the piece is transferred instead). Audited `order.location`.
   */
  async changeLocation(orderId: string, locationId: string, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    const to = await knownLocation(this.db, locationId);
    await this.change(id, async (tx, o, now, notes) => {
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      if (o.product_id !== null) throw pieceLinked();
      if (o.location_id === to) throw validationError('The order is already served from there.');
      const extra: AuditRecordInput[] = [];
      let after: OrderRow;
      if (o.reservation === 'STOCK') {
        const released = await release(tx, o, 'Reserved identity retired: its order moved', actor, now, extra);
        after = await hold(tx, await updateOrder(tx, released.id, { location_id: to }), actor, now, extra);
      } else {
        if (o.reservation === 'BENCH') {
          const moved = await tx
            .updateTable('bench_items')
            .set({ location_id: to })
            .where('order_id', '=', o.id)
            .where('status', 'in', ['TO_MAKE', 'IN_PROGRESS'])
            .returningAll()
            .executeTakeFirst();
          if (moved) await writeJournal(tx, [{ type: 'bench.move', entityType: 'bench_item', entityId: moved.id, payload: benchPayload(moved) }], now);
        }
        after = await updateOrder(tx, o.id, { location_id: to });
      }
      notes.push(await recordChange(tx, o, after, 'order.location', { details: { fromLocationId: o.location_id, toLocationId: to, reservation: after.reservation } }, actor, now), ...extra);
    });
    return this.get(id);
  }

  /**
   * What Client Services enters on an order (RESERVED or PAID): a draw's or a salon's size (it then holds a piece of
   * that size, or one to make), price and currency (before PAID only; 409 ORDER_TERMS_FIXED for a LIVE order, whose
   * are its release's), and any order's engraving text (its piece to make carries it too). A size changes until a
   * piece is linked (409 ORDER_PIECE_LINKED). Audited `order.terms` with the fields changed, never the engraving text.
   */
  async setTerms(orderId: string, input: OrderTermsInput, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    if (!input || typeof input !== 'object') throw validationError('Nothing to change.');
    const has = (k: keyof OrderTermsInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
    const size = has('sizeLabel') ? cleanText(input.sizeLabel, ORDER_TEXT_LIMITS.size, 'The size') : undefined;
    const price = has('priceMinor') ? (input.priceMinor === null ? null : cleanAmount(input.priceMinor, 'The price')) : undefined;
    const currency = has('currency') ? (input.currency === null ? null : String(input.currency)) : undefined;
    if (currency !== undefined && currency !== null && !(ORDER_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`A price is in ${ORDER_CURRENCIES.join(', ')}.`);
    if ((price === undefined) !== (currency === undefined) || (price === null) !== (currency === null)) throw validationError('A price comes with its currency.');
    const engraving = has('engravingText') ? cleanText(input.engravingText, ORDER_TEXT_LIMITS.engraving, 'The engraving text') : undefined;
    if (size === undefined && price === undefined && engraving === undefined) throw validationError('Nothing to change.');
    await this.change(id, async (tx, o, now, notes) => {
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      const fields: string[] = [];
      const extra: AuditRecordInput[] = [];
      let after = o;
      // A size is entered once its SKU is known: null is one size, as soon as it is said.
      const sizeChange = size !== undefined && (o.sku_id === null || size !== o.size_label);
      const priceChange = price !== undefined && (price !== o.price_minor || currency !== o.currency);
      if ((sizeChange || priceChange) && o.channel === 'LIVE') throw termsFixed();
      if (priceChange) {
        if (o.status !== 'RESERVED') throw conflict('ORDER_PAID', 'The price of an order paid no longer changes.');
        after = await updateOrder(tx, o.id, { price_minor: price, currency });
        fields.push('price');
      }
      if (engraving !== undefined && engraving !== o.engraving_text) {
        after = await updateOrder(tx, o.id, { engraving_text: engraving });
        const engraved = await tx
          .updateTable('bench_items')
          .set({ engraving_text: engraving })
          .where('order_id', '=', o.id)
          .where('status', 'in', ['TO_MAKE', 'IN_PROGRESS'])
          .returningAll()
          .executeTakeFirst();
        if (engraved) await writeJournal(tx, [{ type: 'bench.engrave', entityType: 'bench_item', entityId: engraved.id, payload: benchPayload(engraved) }], now);
        fields.push('engraving');
      }
      if (sizeChange) {
        if (o.product_id !== null) throw pieceLinked();
        // Both SKUs locked first, in one order (two orders swapping sizes never wait for each other).
        const skuId = await ensureSku(tx, o.model_id, size ?? null);
        for (const id of [...new Set([o.sku_id, skuId].filter((x): x is string => x !== null))].sort()) await lockSku(tx, id);
        const released = await release(tx, after, 'Reserved identity retired: its order changed size', actor, now, extra);
        after = await hold(tx, await updateOrder(tx, released.id, { size_label: size ?? null, sku_id: skuId }), actor, now, extra);
        fields.push('size');
      }
      if (fields.length === 0) throw validationError('Nothing to change.');
      notes.push(await recordChange(tx, o, after, 'order.terms', { details: { fields, reservation: after.reservation } }, actor, now), ...extra);
    });
    return this.get(id);
  }

  /**
   * The buyer's name and address (decision 31: entered by Client Services, no form for collectors), at any step; null
   * clears one. Personal data: audited `order.buyer` with the fields changed only, never their words.
   */
  async setBuyer(orderId: string, input: OrderBuyerInput, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    if (!input || typeof input !== 'object') throw validationError('Enter the buyer’s name and address.');
    const name = cleanText(input.name, ORDER_TEXT_LIMITS.buyerName, 'The name');
    const address = cleanText(input.address, ORDER_TEXT_LIMITS.buyerAddress, 'The address', { multiline: true });
    await this.change(id, async (tx, o, now, notes) => {
      const fields = [...(name !== o.buyer_name ? ['name'] : []), ...(address !== o.buyer_address ? ['address'] : [])];
      if (fields.length === 0) throw validationError('Nothing to change.');
      const after = await updateOrder(tx, o.id, { buyer_name: name, buyer_address: address });
      notes.push(await recordChange(tx, o, after, 'order.buyer', { details: { fields, cleared: name === null && address === null } }, actor, now));
    });
    return this.get(id);
  }

  /**
   * At boot: the locations and carriers of the first boot (stock.ts ensureStockSetup), the pieces and the sizes on sale
   * linked to their SKUs (linkSkus), and the orders of the sales committed without them (before migration 0022, or by
   * the previous image): every entry of a LIVE RELEASE CONFIRMED gets one order per piece, its resolution mapped
   * (CONCLUDED → PAID, CANCELLED → CANCELLED), every entry of a draw CONFIRMED its order; each RESERVED when the sale
   * was made (the entry's confirmation, the draw entry's handling), its later steps now. Idempotent; a sale whose
   * orders cannot be created is logged and left for the next boot.
   */
  async prepare(): Promise<{ locations: string[]; carriers: string[]; linked: { products: number; sizes: number }; orders: number }> {
    const setup = await ensureStockSetup(this.db, this.audit, SYSTEM_ACTOR, this.clock());
    const linked = await linkSkus(this.db);
    let orders = 0;
    const live = await this.db
      .selectFrom('live_entries as e')
      .select(['e.id', 'e.drop_id', 'e.confirmed_at'])
      .where('e.status', '=', 'CONFIRMED')
      .where((eb) => eb(eb.selectFrom('orders as o').select((x) => x.fn.countAll<number>().as('n')).whereRef('o.live_entry_id', '=', 'e.id'), '<', eb.ref('e.quantity')))
      .orderBy('e.confirmed_at')
      .execute();
    for (const e of live) {
      orders += await this.backfill(`live entry ${e.id}`, async (tx, now, notes) => {
        await tx.selectFrom('drops').select('id').where('id', '=', e.drop_id).forUpdate().executeTakeFirstOrThrow();
        const entry = await tx.selectFrom('live_entries').select(['resolution', 'resolution_note']).where('id', '=', e.id).forUpdate().executeTakeFirstOrThrow();
        const created = await ordersForLiveEntry(tx, e.id, SYSTEM_ACTOR, now, { hold: entry.resolution !== 'CANCELLED', reservedAt: e.confirmed_at ?? now });
        notes.push(...created.notes);
        for (const o of created.orders) {
          if (entry.resolution === 'CONCLUDED') await step(tx, o, { to: 'PAID', note: entry.resolution_note }, SYSTEM_ACTOR, now, notes);
          if (entry.resolution === 'CANCELLED') await step(tx, o, { to: 'CANCELLED', note: entry.resolution_note ?? 'Cancelled by ORBES Client Services.' }, SYSTEM_ACTOR, now, notes);
        }
        return created.orders.length;
      });
    }
    const draws = await this.db
      .selectFrom('drop_entries as e')
      .select(['e.id', 'e.drop_id', 'e.handled_at'])
      .where('e.status', '=', 'CONFIRMED')
      .where((eb) => eb.not(eb.exists(eb.selectFrom('orders as o').select('o.id').whereRef('o.drop_entry_id', '=', 'e.id'))))
      .orderBy('e.handled_at')
      .execute();
    for (const e of draws) {
      orders += await this.backfill(`draw entry ${e.id}`, async (tx, now, notes) => {
        await tx.selectFrom('drops').select('id').where('id', '=', e.drop_id).forUpdate().executeTakeFirstOrThrow();
        await tx.selectFrom('drop_entries').select('id').where('id', '=', e.id).forUpdate().executeTakeFirstOrThrow();
        const created = await orderForDrawEntry(tx, e.id, SYSTEM_ACTOR, now, { reservedAt: e.handled_at ?? now });
        notes.push(...created.notes);
        return created.order ? 1 : 0;
      });
    }
    return { ...setup, linked, orders };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One change of an order in its transaction: the order's row first, the audit entries last. */
  private async change(id: string, fn: (tx: Db, o: OrderRow, now: Date, notes: AuditRecordInput[]) => Promise<void>): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const o = await lockOrder(tx, id);
      const now = this.clock();
      const notes: AuditRecordInput[] = [];
      await fn(tx, o, now, notes);
      for (const n of notes) await this.audit.record(n, tx);
    });
  }

  /** One sale's orders created at boot, in their own transaction; a failure is logged and the next sale goes on. */
  private async backfill(what: string, fn: (tx: Db, now: Date, notes: AuditRecordInput[]) => Promise<number>): Promise<number> {
    try {
      return await inTransaction(this.db, async (tx) => {
        const now = this.clock();
        const notes: AuditRecordInput[] = [];
        const n = await fn(tx, now, notes);
        for (const x of notes) await this.audit.record({ ...x, details: { ...x.details, backfill: true } }, tx);
        return n;
      });
    } catch (e) {
      this.log.error({ sale: what, err: { message: (e as Error)?.message } }, 'the orders of a sale could not be created at boot');
      return 0;
    }
  }
}
