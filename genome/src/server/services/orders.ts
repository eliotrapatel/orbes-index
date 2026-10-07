/**
 * Orders (plan LIVE RELEASE+ of 2026-10-04: choice 6, Interconnection, decision 31; migration 0022): one order per
 * piece sold, by every sales channel, step by step.
 *
 *   created      automatically, in the transaction that commits the sale: an entry of a LIVE RELEASE CONFIRMED (PAY:
 *                one order per piece of its quantity, `ordersForLiveEntry`), an entry of a draw confirmed by Client
 *                Services (`orderForDrawEntry`), a request of the private salon closed as ACCEPTED
 *                (`orderForShopRequest`). RESERVED, at the release's default location (`drops.stock_location_id`) or
 *                at the default location (FRANCE WAREHOUSE). A LIVE order carries its size, price, currency and add-ons
 *                as sold; a draw's order its draw's price and currency when the draw has one (plan NOCTURNE, addition 5);
 *                a draw's and a salon's size, and their price and currency when none is known, are entered by Client
 *                Services (`setTerms`).
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
 *   shipping     (plan NEXT-NINE, BP-19 T4; migration 0027) fixed at the order's creation (`shippingFor`, the tier read
 *                then): PLATINE's free standard and PALLADIUM's free express (THE PROGRAM), otherwise the optional rate of
 *                the order's currency (Orders → Settings, SHIPPING), otherwise none, as before. An order keeps it if the
 *                tier changes later. An order travelling with another (`with_order_id`: the 2nd to 5th piece of a LIVE
 *                entry, or of a draw's place guaranteed by the house for several pieces, IN-01) carries its parent's
 *                service at 0 and follows it; only the parent's invoice carries the fee.
 *                A known limit: a parent cancelled leaves the others travelling with it, at 0, the entry's fee gone
 *                with it (handing its role to the next piece is the owner's decision, API §16.24).
 *                Client Services enters a fee by hand (`setTerms`, RESERVED; 409 ORDER_SHIPPING_FREE over a free
 *                benefit); MARK PAID is never refused for shipping. Audited `order.shipping`. Returns are unchanged.
 *   the gift     (BP-19 T5) the account's welcome gift added to its next order (`attachGifts`, at the end of the three
 *                sale paths, the first order of a sale only): for each GIFT grant whose tier it holds now, with no open
 *                GIFT order, while its tier has an active gift model (THE PROGRAM), a GIFT order at 0 in its order's
 *                currency (none yet: NULL, until its price is entered), travelling with it (`with_order_id`, its
 *                shipping at 0). A model of one size gets its SKU and holds stock (or a piece to make) at once; several
 *                leave its size TO BE CONFIRMED until Client Services chooses one of its model's SKUs (`setTerms`,
 *                never a new SKU). Paid with its order, in its transaction, without an invoice of its own (its order's
 *                carries the GIFT line); its order is not paid while a gift's size is to be chosen (409
 *                ORDER_GIFT_SIZE_MISSING); cancelled with its order (its grant waits again); a return of its order
 *                leaves it. An order reaching PLATINE and PALLADIUM at once carries both tiers' gifts. Audited
 *                `order.create` and `order.gift`.
 *   the credit   (BP-19 T5) taken off a RESERVED order by Client Services (`applyCredit`): its channel one THE PROGRAM
 *                names, its currency the credit's, the account at the grant's tier now, the grant not expired, the
 *                amount within the balance and the piece's price; PALLADIUM's grant first, then the earliest expiry. A
 *                CREDIT line on the invoice. Removed while RESERVED (`removeCredit`), released when the order is
 *                cancelled or returned, the expiry unchanged. Audited `order.credit.apply`, `.remove`, `.release`.
 *
 * The LIVE RELEASES' Client Services resolution is retired into the orders (the console's Orders board steps them): the
 * sales committed before migration 0022, or by the previous image, get their orders at boot (`OrderService.prepare`),
 * a resolution already given mapped (CONCLUDED → PAID, CANCELLED → CANCELLED).
 *
 * Lock order: the source's rows (the release, then the entry; the request), the order, the SKU (stock.ts lockSku), the
 * piece to make and its identity; a return takes the piece returned before the order (as a registration does:
 * OwnershipService.registerFirst holds the piece, then delivers its order), then the SKU, the piece's ownership and
 * transfer; the invoice numbers (invoices.ts); the journal; the audit log last: the functions a sale's transaction calls
 * return their audit entries for it to write after its own (a return's change of the piece's status, LifecycleService,
 * writes its own, last).
 */
import { inTransaction, type Db } from '../db/connection.js';
import {
  ORDER_STATUSES,
  RETURN_OUTCOMES,
  SHIPPING_SERVICES,
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
  type ShippingService,
  type CreditReleaseReason,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, SYSTEM_ACTOR, type Actor, type Clock, type Logger, noopLogger } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import { issueCreditNote, issueInvoice, orderInvoices, type InvoiceBuyer } from './invoices.js';
import { reserveIdentity, retireReservedIdentity } from './issuance.js';
import { mediaUrl } from './media.js';
import { writeJournal } from './journal.js';
import { isTransitionAllowed, LifecycleService, returnTargetOf } from './lifecycle.js';
import { CERTIFICATE_ENDING_STATUSES } from './ownership.js';
import { tierOf } from './club.js';
import { giftModelOf, readProgram, shippingRate } from './club-program.js';
import { creditBalances, ensureGrants } from './tier-grants.js';
import { offeredSku, savedSizeHint } from './sizes.js';
import { defaultLocationId, ensureSku, ensureStockSetup, knownLocation, linkSkus, lockSku, recordMovement, sizeLabelOf, stockBalances, stockLevel } from './stock.js';

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
/**
 * The statuses in which an order offers its piece's ownership certificate (M6): paid and not cancelled nor returned. A
 * piece its account later buys again through a new order is certified by that order only.
 */
export const ORDER_CERTIFICATE_STATUSES: readonly OrderStatus[] = Object.freeze(['PAID', 'SHIPPED', 'DELIVERED']);

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
const shippingFree = () => conflict('ORDER_SHIPPING_FREE', 'This order’s shipping is free with its tier: no fee is added to it.');
const shippingWith = () => conflict('ORDER_SHIPPING_WITH', 'This order travels with another: its shipping is that order’s.');
const giftSizeMissing = () => conflict('ORDER_GIFT_SIZE_MISSING', 'Choose the welcome gift’s size before marking it paid.');
const giftTermsFixed = () => conflict('ORDER_TERMS_FIXED', 'A welcome gift has no price of its own: it travels with its order.');
const creditNone = () => conflict('ORDER_CREDIT_NONE', 'This client has no credit to take off this order.');
const creditCurrency = () => conflict('ORDER_CREDIT_CURRENCY', 'The credit is in another currency than this order.');
const creditChannel = () => conflict('ORDER_CREDIT_CHANNEL', 'The credit is not taken off this kind of order.');
const creditExceeds = () => conflict('ORDER_CREDIT_EXCEEDS', 'This is more than the credit left, or than the piece’s price.');
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

/** A return done: the order, its piece, and the claim code of the piece's new card when it went back to stock. */
export interface OrderReturned {
  order: OrderView;
  /** The piece's reference. */
  productId: string;
  /** Shown once: only its hash is kept (back to stock: the card that left with the piece no longer registers it). */
  claimCode?: string;
}

/**
 * What Client Services enters on an order: a draw's or a salon's size, price and currency; any order's engraving text;
 * its shipping while RESERVED (BP-19 T4: the service with its fee, both together; null for both: no shipping).
 */
export interface OrderTermsInput {
  /** null: one size. */
  sizeLabel?: string | null;
  priceMinor?: number | null;
  currency?: string | null;
  engravingText?: string | null;
  shippingService?: ShippingService | null;
  shippingMinor?: number | null;
}

/** An order's shipping (BP-19 T4): its service and fee, and the tier that made it free; all null for none. */
export interface OrderShipping {
  service: ShippingService | null;
  minor: number | null;
  /** 2 PLATINE, 3 PALLADIUM: the tier that made it free; null otherwise. */
  benefit: 2 | 3 | null;
}

/** No shipping: as an order before migration 0027, or below the free tiers without a rate. */
export const NO_SHIPPING: Readonly<OrderShipping> = Object.freeze({ service: null, minor: null, benefit: null });

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
  /** BP-19 T4: its shipping (service, fee, free tier), all null for none. */
  shipping: OrderShipping;
  /**
   * BP-19: the order it travels with (a GIFT order, the 2nd to 5th piece of a LIVE entry), by id and reference, and once
   * that order has shipped its carrier and tracking number (SHIP WITH ITS ORDER).
   */
  withOrder: { id: string; reference: string; shipment: { carrierId: string; trackingNumber: string } | null } | null;
  /**
   * BP-19 T5: the welcome gifts travelling with it (not cancelled; PLATINE's and PALLADIUM's when both tiers are reached
   * at once), by tier, then oldest first: each its order, model, step, whether its size is to be chosen, and its tier.
   */
  gifts: { id: string; reference: string; model: string; status: OrderStatus; sizeToChoose: boolean; tier: 2 | 3 }[];
  /**
   * BP-19 T5, on a GIFT order: its tier, and while its size is to be chosen, its model's sizes with the pieces available
   * and (AC-01) the client's saved size as a hint only (`savedSize`: the matching size's label, or the saved measure;
   * null without one). Nothing is chosen for Client Services.
   */
  giftOf: { tier: 2 | 3; sizes: { skuId: string; label: string | null; available: number }[]; savedSize: string | null } | null;
  /** BP-19 T5: the client's credit usable now (balance, currency, expiry) and the credit taken off this order (released or not). */
  credit: {
    available: { grantId: string; tier: 2 | 3; balanceMinor: number; currency: string; expiresAt: Date }[];
    applied: { id: string; grantId: string; tier: 2 | 3; amountMinor: number; appliedAt: Date; releasedAt: Date | null; releasedReason: CreditReleaseReason | null }[];
  };
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
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), or null. */
  modelVariant: string | null;
  size: string | null;
  priceMinor: number | null;
  currency: string | null;
  addons: { label: string; priceMinor: number }[];
  /** BP-19 T4: its shipping, all null for none. */
  shipping: OrderShipping;
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
  /**
   * Its invoice and credit note as issued: their numbers, dates and totals, the buyer each was issued to (a snapshot,
   * which may differ from the order's buyer entered since: its name, address and the account's email at issue) and
   * their lines.
   */
  invoices: {
    number: string;
    kind: InvoiceKind;
    issuedAt: Date;
    currency: string;
    totalMinor: number;
    buyer: InvoiceBuyer;
    lines: { label: string; detail: string | null; amountMinor: number }[];
  }[];
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
  /** NOCTURNE N1: the model's label among its variants (« Blue »: the order names MONOLITHE in blue), or null. */
  modelVariant: string | null;
  /** null while ORBES Client Services has not entered it (a draw's, a salon's order); `{ label: null }`: one size. */
  size: { label: string | null } | null;
  /** null, with the currency, while ORBES Client Services has not entered it. */
  priceMinor: number | null;
  currency: string | null;
  /** As sold, each at its price per piece. */
  addons: { label: string; priceMinor: number }[];
  /**
   * BP-19 T4: its shipping (the service, the fee in its currency, the tier that made it free), and for an order
   * travelling with another the reference of that order (`withOrder`), which carries the fee; null without shipping.
   */
  shipping: (OrderShipping & { withOrder: string | null }) | null;
  /** BP-19: the reference of the order it travels with (a welcome gift's, a LIVE entry's further pieces), or null. */
  withOrder: string | null;
  /** BP-19 T5: a welcome gift's tier (PLATINE, PALLADIUM); null for any other order. */
  giftTier: 'PLATINE' | 'PALLADIUM' | null;
  /** BP-19 T5: the credit taken off it (its open uses), in its currency; 0 for none. */
  creditMinor: number;
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
  /**
   * The cover photograph of its model (or of its variant, itself a model): `/api/v1/media/<sha256>`, or null (plan
   * NOCTURNE, addition 3). Never a piece's own photograph (decision 9).
   */
  imageUrl: string | null;
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
    withOrderId: o.with_order_id,
    giftGrantId: o.gift_grant_id,
    shippingService: o.shipping_service,
    shippingMinor: o.shipping_minor,
    shippingBenefit: o.shipping_benefit,
  };
}

/** An order's shipping as its row holds it. */
export function shippingOf(o: Pick<OrderRow, 'shipping_service' | 'shipping_minor' | 'shipping_benefit'>): OrderShipping {
  if (o.shipping_service === null || o.shipping_minor === null) return { ...NO_SHIPPING };
  return { service: o.shipping_service, minor: o.shipping_minor, benefit: o.shipping_benefit === 2 || o.shipping_benefit === 3 ? o.shipping_benefit : null };
}

/**
 * The shipping of an order created now for `accountId` in `currency` (BP-19 T4), read in the sale's transaction: the
 * free shipping of the account's tier now (PALLADIUM's, then PLATINE's, as THE PROGRAM sets them: NONE gives none),
 * otherwise the optional STANDARD rate of the order's currency, otherwise none (no shipping line, as before). A currency
 * not known yet (a salon's order, a draw without a price) takes the free service only; its rate comes when `setTerms`
 * gives it its currency.
 */
export async function shippingFor(tx: Db, accountId: string, currency: string | null, now: Date): Promise<OrderShipping> {
  const [standing, program] = await Promise.all([tierOf(tx, accountId, now), readProgram(tx)]);
  for (const tier of [3, 2] as const) {
    if (standing.tier < tier) continue;
    const free = tier === 3 ? program.shippingFreePalladium : program.shippingFreePlatine;
    if (free !== 'NONE') return { service: free, minor: 0, benefit: tier };
  }
  const rate = await shippingRate(tx, currency, 'STANDARD');
  return rate === null ? { ...NO_SHIPPING } : { service: 'STANDARD', minor: rate, benefit: null };
}

/**
 * Whether an order's shipping now is the optional rate it took (BP-19 T4), not a fee entered by hand: the last of its
 * events that set its shipping is its creation with a shipping not free (a creation fixes none other than a tier's or
 * a rate), or a change audited as the rate's (`rate: true`).
 */
async function shippingFromRate(tx: Db, orderId: string): Promise<boolean> {
  const last = await tx
    .selectFrom('order_events')
    .select(['action', 'details'])
    .where('order_id', '=', orderId)
    .where('action', 'in', ['order.create', 'order.shipping'])
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!last) return false;
  const details = (last.details ?? {}) as JsonObject;
  if (last.action === 'order.shipping') return details.rate === true;
  const created = details.shipping as JsonObject | undefined;
  return !!created && created.service !== null && created.service !== undefined && (created.benefit === null || created.benefit === undefined);
}

/** The shipping of an order travelling with `parent`: its service at 0 (none when it has none), never a benefit of its own. */
export function travellingShipping(parent: Pick<OrderRow, 'shipping_service'>): OrderShipping {
  return parent.shipping_service === null ? { ...NO_SHIPPING } : { service: parent.shipping_service, minor: 0, benefit: null };
}

/**
 * The SKU of a welcome gift's model in `size` (null: one size), whatever its case, as `ensureSku` finds it; 400
 * VALIDATION_FAILED when the model has no such SKU: a gift's size is chosen among its model's offered sizes (plan NEXT
 * LOT §3.3: never one set aside), never created.
 */
async function giftSku(tx: Db, modelId: string, size: string | null): Promise<string> {
  const found = await tx
    .selectFrom('skus')
    .select('id')
    .where('model_id', '=', modelId)
    .where('set_aside_at', 'is', null)
    .where((eb) => (size === null ? eb('size_label', 'is', null) : eb(eb.fn('upper', ['size_label']), '=', eb.fn('upper', [eb.val(size)]))))
    .executeTakeFirst();
  if (!found) throw validationError('Choose one of the gift model’s sizes.');
  return found.id;
}

/**
 * The SKU an order's size names (Client Services' EDIT): `offeredSku`, so a typed model's offered sizes only (400
 * SIZE_NOT_DECLARED, 409 SIZE_SET_ASIDE), except that the order's current SKU stays accepted though set aside since.
 */
async function termsSku(tx: Db, o: OrderRow, size: string | null): Promise<string> {
  try {
    return (await offeredSku(tx, o.model_id, size)).skuId;
  } catch (e) {
    if (e instanceof DomainError && e.code === 'SIZE_SET_ASIDE' && o.sku_id !== null) {
      const again = await offeredSku(tx, o.model_id, size, { allowSetAside: true });
      if (again.skuId === o.sku_id) return again.skuId;
    }
    throw e;
  }
}

/** An order's welcome gifts still open (not cancelled), oldest first. */
async function openGifts(tx: Db, parentId: string, opts: { forUpdate?: boolean } = {}): Promise<OrderRow[]> {
  let q = tx.selectFrom('orders').selectAll().where('with_order_id', '=', parentId).where('channel', '=', 'GIFT').where('status', '<>', 'CANCELLED').orderBy('reserved_at').orderBy('id');
  if (opts.forUpdate) q = q.forUpdate();
  return q.execute();
}

/** An order's credit taken off it and not released, with each grant's tier. */
async function openCreditUses(tx: Db, orderId: string, opts: { forUpdate?: boolean } = {}) {
  let q = tx
    .selectFrom('credit_uses as u')
    .innerJoin('tier_grants as g', 'g.id', 'u.grant_id')
    .select(['u.id', 'u.grant_id', 'u.amount_minor', 'u.applied_at', 'g.tier', 'g.currency'])
    .where('u.order_id', '=', orderId)
    .where('u.released_at', 'is', null)
    .orderBy('g.tier', 'desc')
    .orderBy('u.applied_at')
    .orderBy('u.id');
  if (opts.forUpdate) q = q.forUpdate();
  return q.execute();
}

/**
 * Release the credit taken off an order (BP-19 T5): its open uses given back, their grant's expiry unchanged; audited
 * `order.credit.remove` or `order.credit.release`, with an event and a journal entry. Nothing when none is open.
 */
async function releaseCredit(tx: Db, o: OrderRow, reason: CreditReleaseReason, actor: Actor, now: Date): Promise<AuditRecordInput[]> {
  const uses = await openCreditUses(tx, o.id, { forUpdate: true });
  if (uses.length === 0) return [];
  await tx
    .updateTable('credit_uses')
    .set({ released_at: now, released_reason: reason, released_by: actor.type === 'admin' ? actor.id! : null })
    .where('id', 'in', uses.map((u) => u.id))
    .execute();
  const amount = uses.reduce((n, u) => n + u.amount_minor, 0);
  return [await recordChange(tx, o, o, reason === 'REMOVED' ? 'order.credit.remove' : 'order.credit.release', { details: { reason, amountMinor: amount, uses: uses.map((u) => u.id) } }, actor, now)];
}

/**
 * The welcome gifts of the account, added to `parent`, the first order of a sale (BP-19 T5), in its transaction: for
 * each GIFT grant whose tier the account holds now, with no open GIFT order, while its tier has an active gift model
 * (THE PROGRAM), a GIFT order travelling with `parent`: the gift's model at 0 in `parent`'s currency (NULL while it has
 * none), at its location, its shipping at 0; a model of one size (or none yet) with its SKU, holding stock or a piece to
 * make at once, several with its size to be chosen. The grant's rows are locked, then the open gift orders read again:
 * two sales at once never give one grant two gifts. Audited `order.create` (GIFT) and `order.gift` (on `parent`).
 */
export async function attachGifts(tx: Db, parent: OrderRow, actor: Actor, now: Date): Promise<{ orders: OrderRow[]; notes: AuditRecordInput[] }> {
  const notes: AuditRecordInput[] = [];
  const orders: OrderRow[] = [];
  if (parent.channel === 'GIFT' || parent.with_order_id !== null) return { orders, notes };
  const standing = await tierOf(tx, parent.account_id, now);
  if (standing.tier < 2) return { orders, notes };
  const grants = await tx
    .selectFrom('tier_grants')
    .selectAll()
    .where('account_id', '=', parent.account_id)
    .where('kind', '=', 'GIFT')
    .where('tier', '<=', standing.tier)
    .orderBy('tier')
    .forUpdate()
    .execute();
  if (grants.length === 0) return { orders, notes };
  const taken = new Set(
    (await tx.selectFrom('orders').select('gift_grant_id').where('gift_grant_id', 'in', grants.map((g) => g.id)).where('status', '<>', 'CANCELLED').execute()).map((r) => r.gift_grant_id),
  );
  const program = await readProgram(tx);
  for (const g of grants) {
    if (taken.has(g.id)) continue;
    const modelId = giftModelOf(program, g.tier as 2 | 3);
    if (!modelId) continue;
    const model = await tx.selectFrom('models').select(['id', 'active', 'discontinued_at', 'size_type']).where('id', '=', modelId).executeTakeFirst();
    if (!model || !model.active || model.discontinued_at !== null) continue;
    // Its offered sizes (plan NEXT LOT §3.3); a model with no type and no SKU yet has its one size created, as before.
    const skus = await tx.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', modelId).where('set_aside_at', 'is', null).orderBy('code').execute();
    const one = skus.length === 0 ? (model.size_type === null ? { id: await ensureSku(tx, modelId, null), size_label: null } : null) : skus.length === 1 ? skus[0]! : null;
    const gift = await createOrder(
      tx,
      {
        channel: 'GIFT',
        giftGrantId: g.id,
        withOrderId: parent.id,
        dropId: null,
        accountId: parent.account_id,
        modelId,
        sizeLabel: one?.size_label ?? null,
        skuId: one?.id ?? null,
        priceMinor: parent.currency === null ? null : 0,
        currency: parent.currency,
        addons: [],
        surprise: null,
        locationId: parent.location_id,
        shipping: travellingShipping(parent),
      },
      { hold: true },
      actor,
      now,
      notes,
    );
    await tx.updateTable('tier_grants').set({ model_id: modelId }).where('id', '=', g.id).execute();
    notes.push(await recordChange(tx, parent, parent, 'order.gift', { details: { giftOrderId: gift.id, grantId: g.id, tier: g.tier, modelId, sizeToChoose: one === null } }, actor, now));
    orders.push(gift);
  }
  return { orders, notes };
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
 * cancelled and the identity reserved for it retired (its serial never reused). Also the atelier's, when an order
 * holding a piece to make takes a finished piece instead (AtelierService.linkFromStock).
 */
export async function release(tx: Db, o: OrderRow, reason: string, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<OrderRow> {
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
  /** BP-19 T4: its shipping (none by default), and the order it travels with. */
  shipping?: OrderShipping;
  withOrderId?: string | null;
  /** BP-19 T5: a GIFT order's grant. */
  giftGrantId?: string;
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
      with_order_id: n.withOrderId ?? null,
      gift_grant_id: n.giftGrantId ?? null,
      shipping_service: n.shipping?.service ?? null,
      shipping_minor: n.shipping?.service ? n.shipping.minor : null,
      shipping_benefit: n.shipping?.service ? n.shipping.benefit : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const benchNotes: AuditRecordInput[] = [];
  if (opts.hold) o = await hold(tx, o, actor, now, benchNotes);
  const source: JsonObject = n.liveEntryId
    ? { liveEntryId: n.liveEntryId, piece: o.piece }
    : n.dropEntryId
      ? { dropEntryId: n.dropEntryId }
      : n.giftGrantId
        ? { giftGrantId: n.giftGrantId }
        : { shopRequestId: n.shopRequestId! };
  notes.push(
    await recordChange(
      tx,
      null,
      o,
      'order.create',
      {
        details: {
          ...source,
          dropId: n.dropId,
          skuId: o.sku_id,
          locationId: o.location_id,
          reservation: o.reservation,
          ...(o.shipping_service ? { shipping: { service: o.shipping_service, minor: o.shipping_minor, benefit: o.shipping_benefit } } : {}),
          ...(o.with_order_id ? { withOrderId: o.with_order_id } : {}),
        },
        at: o.reserved_at,
      },
      actor,
      now,
    ),
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
 * entry's held): one per piece of its quantity, each with the release's price and currency, the entry's add-ons as sold
 * and the release's surprise when it has one (an after-room's: its parent's, as its location), RESERVED at the
 * release's location and holding what it can (`hold` false: nothing, for a reservation cancelled
 * before its orders existed; `reservedAt`: the time of the sale, for one confirmed before its orders existed). Idempotent:
 * only the pieces without an order get one. Returns the orders created and the audit entries to write last.
 */
export async function ordersForLiveEntry(tx: Db, entryId: string, actor: Actor, now: Date, opts: { hold?: boolean; reservedAt?: Date } = {}): Promise<{ orders: OrderRow[]; notes: AuditRecordInput[] }> {
  const e = await tx
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    // An after-room inherits its parent's location and surprise (services/after-room.ts).
    .leftJoin('drops as p', 'p.id', 'd.parent_drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select((eb) => [
      'e.id', 'e.account_id', 'e.quantity', 'e.status', 'd.id as drop_id', 'd.model_id', 'd.price_minor', 'd.currency', 's.id as size_id', 's.label', 's.sku_id',
      eb.fn.coalesce('p.stock_location_id', 'd.stock_location_id').as('stock_location_id'),
      eb.fn.coalesce('p.surprise_enabled', 'd.surprise_enabled').as('surprise_enabled'),
      eb.fn.coalesce('p.surprise_text', 'd.surprise_text').as('surprise_text'),
    ])
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  if (!e || e.status !== 'CONFIRMED') throw new Error(`ordersForLiveEntry: entry ${entryId} is not CONFIRMED`);
  const existing = new Set((await tx.selectFrom('orders').select('piece').where('live_entry_id', '=', e.id).execute()).map((r) => r.piece));
  const notes: AuditRecordInput[] = [];
  const orders: OrderRow[] = [];
  if (existing.size >= e.quantity) return { orders, notes };
  let skuId = e.sku_id;
  if (skuId === null) {
    // The size was offered when the release was made (plan NEXT LOT §3.3): a size set aside since stays its own.
    skuId = (await offeredSku(tx, e.model_id, e.label, { allowSetAside: true })).skuId;
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
  // BP-19 T5: the account's grants, its tier read now.
  notes.push(...(await ensureGrants(tx, e.account_id, now)));
  // BP-19 T4: one fee for the entry, on its first piece; the others travel with it (its service at 0).
  let parent = existing.has(1) ? await tx.selectFrom('orders').selectAll().where('live_entry_id', '=', e.id).where('piece', '=', 1).executeTakeFirst() : undefined;
  for (let piece = 1; piece <= e.quantity; piece++) {
    if (existing.has(piece)) continue;
    const shipping = parent ? travellingShipping(parent) : await shippingFor(tx, e.account_id, e.currency, now);
    const created = await createOrder(
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
        surprise: e.surprise_enabled === true ? e.surprise_text : null,
        locationId,
        reservedAt: opts.reservedAt,
        shipping,
        withOrderId: parent?.id ?? null,
      },
      { hold: opts.hold ?? true },
      actor,
      now,
      notes,
    );
    orders.push(created);
    if (piece === 1) parent = created;
  }
  // BP-19 T5: the welcome gift, on the sale's first order only.
  const first = orders.find((o) => o.piece === 1);
  if (first) notes.push(...(await attachGifts(tx, first, actor, now)).notes);
  return { orders, notes };
}

/**
 * The orders of an entry of a draw confirmed by Client Services, in the transaction that confirms it (the drop's row and
 * the entry's held): one per piece of the entry (`pieces`: 1, or a house's guarantee's, plan NEXT-NINE IN-01), RESERVED
 * at the drop's location, with the draw's price and currency when it has one (plan NOCTURNE, addition 5: instead of « to
 * be confirmed »), its size (and a price the draw does not give) to be entered (`setTerms`) (`reservedAt`: the time of
 * the sale, for an entry confirmed before its order existed). Following BP-19, the first carries the shipping and any
 * welcome gift; the others travel with it (its service, shipping 0). Idempotent (only the pieces without an order get
 * one; `order` is the first created, null when the entry has its orders).
 */
export async function orderForDrawEntry(tx: Db, entryId: string, actor: Actor, now: Date, opts: { reservedAt?: Date } = {}): Promise<{ order: OrderRow | null; orders: OrderRow[]; notes: AuditRecordInput[] }> {
  const e = await tx
    .selectFrom('drop_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .select(['e.id', 'e.account_id', 'e.status', 'e.pieces', 'd.id as drop_id', 'd.model_id', 'd.stock_location_id', 'd.price_minor', 'd.currency'])
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  if (!e || e.status !== 'CONFIRMED') throw new Error(`orderForDrawEntry: entry ${entryId} is not CONFIRMED`);
  // The draw's price, both or neither (drops_draw_price), within an order's bounds.
  const priced = e.price_minor !== null && e.currency !== null && e.price_minor <= ORDER_AMOUNT_MAX_MINOR;
  const existing = new Set((await tx.selectFrom('orders').select('piece').where('drop_entry_id', '=', e.id).execute()).map((r) => r.piece));
  const pieces = Math.max(1, Number(e.pieces) || 1);
  if (existing.size >= pieces) return { order: null, orders: [], notes: [] };
  const notes: AuditRecordInput[] = [...(await ensureGrants(tx, e.account_id, now))];
  const locationId = await releaseLocation(tx, e.stock_location_id);
  let parent = existing.has(1) ? await tx.selectFrom('orders').selectAll().where('drop_entry_id', '=', e.id).where('piece', '=', 1).executeTakeFirst() : undefined;
  const orders: OrderRow[] = [];
  for (let piece = 1; piece <= pieces; piece++) {
    if (existing.has(piece)) continue;
    const created = await createOrder(
      tx,
      {
        channel: 'DRAW',
        dropEntryId: e.id,
        piece,
        dropId: e.drop_id,
        accountId: e.account_id,
        modelId: e.model_id,
        sizeLabel: null,
        skuId: null,
        priceMinor: priced ? e.price_minor : null,
        currency: priced ? e.currency : null,
        addons: [],
        surprise: null,
        locationId,
        reservedAt: opts.reservedAt,
        shipping: parent ? travellingShipping(parent) : await shippingFor(tx, e.account_id, priced ? e.currency : null, now),
        withOrderId: parent?.id ?? null,
      },
      { hold: true },
      actor,
      now,
      notes,
    );
    orders.push(created);
    if (piece === 1) parent = created;
  }
  // BP-19 T5: the welcome gift, on the sale's first order only.
  const first = orders.find((o) => o.piece === 1);
  if (first) notes.push(...(await attachGifts(tx, first, actor, now)).notes);
  return { order: orders[0] ?? null, orders, notes };
}

/**
 * The order of a request of the private salon closed as ACCEPTED, in the transaction that closes it (the request's row
 * held): RESERVED at the default location, with the size the collector asked and its SKU (AC-01; held then as any
 * order's), its price, currency (and size, when none was asked) to be entered (`setTerms`). Idempotent.
 */
export async function orderForShopRequest(tx: Db, requestId: string, actor: Actor, now: Date): Promise<{ order: OrderRow | null; notes: AuditRecordInput[] }> {
  const r = await tx.selectFrom('shop_requests').select(['id', 'account_id', 'model_id', 'status', 'outcome', 'size_label']).where('id', '=', requestId).executeTakeFirst();
  if (!r || r.status !== 'CLOSED' || r.outcome !== 'ACCEPTED') throw new Error(`orderForShopRequest: request ${requestId} is not ACCEPTED`);
  if (await tx.selectFrom('orders').select('id').where('shop_request_id', '=', r.id).executeTakeFirst()) return { order: null, notes: [] };
  const notes: AuditRecordInput[] = [...(await ensureGrants(tx, r.account_id, now))];
  const order = await createOrder(
    tx,
    {
      channel: 'SALON',
      shopRequestId: r.id,
      dropId: null,
      accountId: r.account_id,
      modelId: r.model_id,
      // AC-01: the size the collector asked, with its SKU (held as any order's); none asked, entered later. Offered when
      // it was asked (plan NEXT LOT §3.3): a size set aside since stays its own.
      sizeLabel: r.size_label,
      skuId: r.size_label === null ? null : (await offeredSku(tx, r.model_id, r.size_label, { allowSetAside: true })).skuId,
      priceMinor: null,
      currency: null,
      addons: [],
      surprise: null,
      locationId: await defaultLocationId(tx),
      shipping: await shippingFor(tx, r.account_id, null, now),
    },
    { hold: true },
    actor,
    now,
    notes,
  );
  notes.push(...(await attachGifts(tx, order, actor, now)).notes);
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
      // BP-19 T5: its welcome gift's size chosen first; the gift is paid with it, below.
      if ((await openGifts(tx, o.id, { forUpdate: true })).some((g) => g.status === 'RESERVED' && g.sku_id === null)) throw giftSizeMissing();
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
      // BP-19 T5: the credit taken off it given back, its expiry unchanged.
      extra.push(...(await releaseCredit(tx, after, 'CANCELLED', actor, now)));
      break;
    }
  }
  notes.push(await recordChange(tx, o, after, ORDER_STEP_ACTIONS[s.to], { note: s.note, details }, actor, now), ...extra);
  // PAID issues the invoice; paid, then cancelled, a credit note cancels it (services/invoices.ts).
  const document = s.to === 'PAID' ? await issueInvoice(tx, after, actor, now) : s.to === 'CANCELLED' && o.status === 'PAID' ? await issueCreditNote(tx, after, 'cancel', actor, now) : null;
  if (document) notes.push(document);
  // BP-19 T5: its welcome gift follows it: paid with it, cancelled with it (its grant then waits again).
  if (o.channel !== 'GIFT' && (s.to === 'PAID' || s.to === 'CANCELLED')) {
    for (const g of await openGifts(tx, o.id, { forUpdate: true })) {
      if (s.to === 'PAID' && g.status === 'RESERVED') await step(tx, g, { to: 'PAID', note: null }, actor, now, notes);
      if (s.to === 'CANCELLED' && (g.status === 'RESERVED' || g.status === 'PAID')) await step(tx, g, { to: 'CANCELLED', note: 'Its order was cancelled.' }, actor, now, notes);
    }
  }
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
    .select(['m.name as model_name', 'm.variant_label as model_variant', 'd.title as release_title', 'c.name as carrier_name'])
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
    modelVariant: r.model_variant,
    size: r.size_label,
    priceMinor: r.price_minor,
    currency: r.currency,
    addons: r.addons.map((a) => ({ label: a.label, priceMinor: a.priceMinor })),
    shipping: shippingOf(r),
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
    invoices: invoices
      .filter((i) => i.order.id === r.id)
      .map((i) => ({
        number: i.number,
        kind: i.kind,
        issuedAt: i.issuedAt,
        currency: i.currency,
        totalMinor: i.totalMinor,
        buyer: { name: i.buyer.name, address: i.buyer.address, email: i.buyer.email },
        lines: i.lines.map((l) => ({ label: l.label, detail: l.detail, amountMinor: l.amountMinor })),
      })),
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
    // BP-19: what travels with it, what it travels with, its credit.
    const parent = r.with_order_id ? await this.db.selectFrom('orders').select(['carrier_id', 'tracking_number']).where('id', '=', r.with_order_id).executeTakeFirst() : undefined;
    const parentShipment = parent?.carrier_id && parent.tracking_number ? { carrierId: parent.carrier_id, trackingNumber: parent.tracking_number } : null;
    const gifts: OrderView['gifts'] = (
      await this.db
        .selectFrom('orders as g')
        .innerJoin('models as m', 'm.id', 'g.model_id')
        .innerJoin('tier_grants as t', 't.id', 'g.gift_grant_id')
        .select(['g.id', 'g.status', 'g.sku_id', 'm.name', 'm.variant_label', 't.tier'])
        .where('g.with_order_id', '=', id)
        .where('g.channel', '=', 'GIFT')
        .where('g.status', '<>', 'CANCELLED')
        .orderBy('t.tier')
        .orderBy('g.reserved_at')
        .orderBy('g.id')
        .execute()
    ).map((g) => ({
      id: g.id,
      reference: orderReference(g.id),
      model: g.variant_label ? `${g.name} in ${g.variant_label}` : g.name,
      status: g.status,
      sizeToChoose: g.sku_id === null,
      tier: g.tier as 2 | 3,
    }));
    let giftOf: OrderView['giftOf'] = null;
    if (r.channel === 'GIFT' && r.gift_grant_id) {
      const grant = await this.db.selectFrom('tier_grants').select('tier').where('id', '=', r.gift_grant_id).executeTakeFirstOrThrow();
      const sizes =
        r.sku_id === null
          ? await Promise.all(
              (await this.db.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', r.model_id).where('set_aside_at', 'is', null).orderBy('code').execute()).map(async (k) => ({
                skuId: k.id,
                label: k.size_label,
                available: (await stockBalances(this.db, { skuId: k.id })).reduce((n, b) => n + Math.max(0, b.available), 0),
              })),
            )
          : [];
      giftOf = { tier: grant.tier as 2 | 3, sizes, savedSize: r.sku_id === null ? await savedSizeHint(this.db, r.account_id, r.model_id) : null };
    }
    const now = this.clock();
    const standing = await tierOf(this.db, r.account_id, now);
    const credit: OrderView['credit'] = {
      available: (await creditBalances(this.db, r.account_id))
        .filter((c) => c.tier <= standing.tier && c.balanceMinor > 0 && c.expiresAt.getTime() > now.getTime())
        .map((c) => ({ grantId: c.grantId, tier: c.tier, balanceMinor: c.balanceMinor, currency: c.currency, expiresAt: c.expiresAt })),
      applied: (
        await this.db
          .selectFrom('credit_uses as u')
          .innerJoin('tier_grants as t', 't.id', 'u.grant_id')
          .select(['u.id', 'u.grant_id', 'u.amount_minor', 'u.applied_at', 'u.released_at', 'u.released_reason', 't.tier'])
          .where('u.order_id', '=', id)
          .orderBy('u.applied_at')
          .orderBy('u.id')
          .execute()
      ).map((u) => ({ id: u.id, grantId: u.grant_id, tier: u.tier as 2 | 3, amountMinor: u.amount_minor, appliedAt: u.applied_at, releasedAt: u.released_at, releasedReason: u.released_reason })),
    };
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
      shipping: shippingOf(r),
      withOrder: r.with_order_id ? { id: r.with_order_id, reference: orderReference(r.with_order_id), shipment: parentShipment } : null,
      gifts,
      giftOf,
      credit,
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
        'o.shipping_service',
        'o.shipping_minor',
        'o.shipping_benefit',
        'o.with_order_id',
        'o.gift_grant_id',
        'o.status',
        'o.reserved_at',
        'o.paid_at',
        'o.shipped_at',
        'o.delivered_at',
        'o.cancelled_at',
        'o.returned_at',
        'o.tracking_number',
        'm.name as model_name',
        'm.variant_label as model_variant',
        'm.image_sha256 as model_image',
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
    // BP-19 T5: each welcome gift's tier, and the credit taken off each order.
    const grantIds = rows.map((r) => r.gift_grant_id).filter((x): x is string => x !== null);
    const giftTiers = new Map(grantIds.length ? (await this.db.selectFrom('tier_grants').select(['id', 'tier']).where('id', 'in', grantIds).execute()).map((g) => [g.id, g.tier]) : []);
    const credits = new Map(
      rows.length
        ? (
            await this.db
              .selectFrom('credit_uses')
              .select((eb) => ['order_id', eb.fn.sum<string>('amount_minor').as('n')])
              .where('order_id', 'in', rows.map((r) => r.id))
              .where('released_at', 'is', null)
              .groupBy('order_id')
              .execute()
          ).map((c) => [c.order_id, Number(c.n)])
        : [],
    );
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
      modelVariant: r.model_variant,
      // A size is known once its SKU is (null: one size); before, ORBES Client Services has still to enter it.
      size: r.sku_id === null ? null : { label: r.size_label },
      priceMinor: r.price_minor,
      currency: r.price_minor === null ? null : r.currency,
      addons: r.addons.map((a) => ({ label: a.label, priceMinor: a.priceMinor })),
      shipping: r.shipping_service === null ? null : { ...shippingOf(r), withOrder: r.with_order_id ? orderReference(r.with_order_id) : null },
      withOrder: r.with_order_id ? orderReference(r.with_order_id) : null,
      giftTier: r.gift_grant_id ? (giftTiers.get(r.gift_grant_id) === 3 ? 'PALLADIUM' : 'PLATINE') : null,
      creditMinor: credits.get(r.id) ?? 0,
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
        certificate: ORDER_CERTIFICATE_STATUSES.includes(r.status) && r.ownership_id !== null && r.piece_status !== null && !CERTIFICATE_ENDING_STATUSES.includes(r.piece_status),
      },
      imageUrl: mediaUrl(r.model_image),
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
      // A welcome gift is paid with its order (BP-19 T5), never alone.
      if (o.channel === 'GIFT' && s.to === 'PAID') throw stepNotAllowed(o.status, s.to);
      await step(tx, o, s, actor, now, notes);
    });
    return this.get(id);
  }

  /**
   * RETURNED (choice 20; from SHIPPED or DELIVERED, 409 ORDER_TRANSITION_NOT_ALLOWED otherwise), opened by Client
   * Services with a note: the piece goes back to stock at a location (the ledger's RETURNED, +1; the piece RESOLD, ready
   * to be sold again, or still ISSUED if it never was: 409 ORDER_RETURN_NOT_RESTOCKABLE when its record is in service,
   * reported or flagged) or to the archive (RETIRED, unless already retired or revoked). When its buyer had registered
   * it, ORBES takes the ownership back: it ends (RETURNED, `returns.ownership_id`), a transfer pending is cancelled and
   * the piece is not registered any more. Back to stock, the piece carries a new claim code whether or not its buyer had
   * registered it (they kept its card and could read its code: returned once, for its new card; only its hash is kept).
   * A credit note cancels the invoice. Audited `order.return`, `ownership.reclaim` (and `ownership.transfer.cancel`),
   * `invoice.credit` and the piece's `product.transition`, in one transaction, the piece's row locked before the order's.
   */
  async returnOrder(orderId: string, input: OrderReturnInput, actor: Actor): Promise<OrderReturned> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    const r = checkReturn(input);
    // The piece and whether an ownership is taken back are read first: the piece's row is locked before the order's, and
    // the transaction refuses the return if either changed meanwhile. Back to stock, the new claim code's scrypt runs
    // outside it.
    const peek = await this.db
      .selectFrom('orders as o')
      .leftJoin('ownership as w', (j) => j.onRef('w.product_id', '=', 'o.product_id').on('w.ended_at', 'is', null))
      .select(['o.id', 'o.product_id', 'w.id as ownership_id'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!peek) throw orderNotFound();
    const reclaim = peek.ownership_id !== null;
    const claimCode = r.outcome === 'RESTOCKED' ? generateClaimCode() : undefined;
    const claimHash = claimCode ? await hashClaimCode(claimCode) : null;
    const pieceFirst = async (tx: Db) => {
      if (peek.product_id !== null) await tx.selectFrom('products').select('id').where('id', '=', peek.product_id).forUpdate().execute();
    };
    let productId = '';
    await this.change(id, async (tx, o, now, notes) => {
      if (!isOrderTransitionAllowed(o.status, 'RETURNED')) throw stepNotAllowed(o.status, 'RETURNED');
      if (o.product_id === null || o.sku_id === null) throw pieceNotLinked();
      if (o.product_id !== peek.product_id) throw returnChanged();
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
      if (owner || claimHash) {
        // Unregistered once its ownership is taken back; back to stock, a new claim code: the card that left with it no
        // longer registers it.
        await tx
          .updateTable('products')
          .set({ updated_at: now, ...(owner ? { ownership_state: 'UNREGISTERED' as const } : {}), ...(claimHash ? { claim_secret_hash: claimHash } : {}) })
          .where('id', '=', p.id)
          .execute();
        if (owner) p.ownership_state = 'UNREGISTERED';
        if (claimHash) p.claim_secret_hash = claimHash;
      }
      await tx
        .insertInto('returns')
        .values({ order_id: o.id, outcome: r.outcome, location_id: locationId, note: r.note, ownership_id: owner?.id ?? null, created_by: actor.type === 'admin' ? actor.id! : null, created_at: now })
        .execute();
      const after = await updateOrder(tx, o.id, { status: 'RETURNED', returned_at: now });
      const details: JsonObject = {
        outcome: r.outcome,
        ...(locationId ? { locationId } : {}),
        ownershipReclaimed: owner !== undefined,
        ...(claimHash ? { claimCodeReissued: true } : {}),
        ...(to ? { pieceStatus: to } : {}),
      };
      notes.push(await recordChange(tx, o, after, ORDER_STEP_ACTIONS.RETURNED, { note: r.note, details }, actor, now), ...extra);
      // BP-19 T5: the credit taken off it given back; its welcome gift stays as it is.
      notes.push(...(await releaseCredit(tx, after, 'RETURNED', actor, now)));
      const credit = await issueCreditNote(tx, after, 'return', actor, now);
      if (credit) notes.push(credit);
      // Last: the piece's status, which LifecycleService audits at once (the audit chain's lock: no row is locked after it).
      if (to !== null) {
        await this.lifecycle.applyForService(tx, p, to, { reason: `Order ${orderReference(o.id)} returned`, via: 'order.return', ...(owner ? { ownershipState: 'UNREGISTERED' } : {}) }, actor);
      }
      productId = p.product_id;
    }, pieceFirst);
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
   *
   * Its shipping (plan NEXT-NINE, BP-19 T4), while RESERVED: a service with its fee, or null for both (no shipping); 409
   * ORDER_SHIPPING_FREE for a fee on the service its tier makes free (another service, express, is paid at the fee
   * entered), 409 ORDER_SHIPPING_WITH for an order travelling with another. The first price of an order without
   * shipping takes the optional rate of its currency; a rate it took follows a change of its currency (the new
   * currency's rate, or no shipping when none is set), while a fee entered by hand stays as entered, for Client Services
   * to enter again. The orders travelling with it follow (its service at 0). Audited
   * `order.shipping` (each order), the service, the fee and the free tier.
   */
  async setTerms(orderId: string, input: OrderTermsInput, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    if (!input || typeof input !== 'object') throw validationError('Nothing to change.');
    const has = (k: keyof OrderTermsInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
    // Read as its SKU reads it (stock.ts sizeLabelOf): ONE SIZE, whatever its case, is the model in one size (null).
    const size = has('sizeLabel') ? sizeLabelOf(cleanText(input.sizeLabel, ORDER_TEXT_LIMITS.size, 'The size')) : undefined;
    const price = has('priceMinor') ? (input.priceMinor === null ? null : cleanAmount(input.priceMinor, 'The price')) : undefined;
    const currency = has('currency') ? (input.currency === null ? null : String(input.currency)) : undefined;
    if (currency !== undefined && currency !== null && !(ORDER_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`A price is in ${ORDER_CURRENCIES.join(', ')}.`);
    if ((price === undefined) !== (currency === undefined) || (price === null) !== (currency === null)) throw validationError('A price comes with its currency.');
    const engraving = has('engravingText') ? cleanText(input.engravingText, ORDER_TEXT_LIMITS.engraving, 'The engraving text') : undefined;
    let shipping: OrderShipping | undefined;
    if (has('shippingService') || has('shippingMinor') || input.shippingService === null || input.shippingMinor === null) {
      const service = input.shippingService ?? null;
      const minor = input.shippingMinor ?? null;
      if ((service === null) !== (minor === null)) throw validationError('A shipping fee comes with its service.');
      if (service !== null && !(SHIPPING_SERVICES as readonly string[]).includes(service)) throw validationError(`A shipping service is ${SHIPPING_SERVICES.join(' or ')}.`);
      shipping = service === null ? { ...NO_SHIPPING } : { service, minor: cleanAmount(minor, 'The shipping fee'), benefit: null };
    }
    if (size === undefined && price === undefined && engraving === undefined && shipping === undefined) throw validationError('Nothing to change.');
    await this.change(id, async (tx, o, now, notes) => {
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      const fields: string[] = [];
      const extra: AuditRecordInput[] = [];
      let after = o;
      // A size is entered once its SKU is known: null is one size, as soon as it is said. The same SKU named again
      // (its size in another case: 52, or Small for SMALL) is no change: what the order holds stays.
      // A welcome gift's size is one of its model's SKUs (BP-19 T5: Choose size lists them), never a new one. Any other
      // order's is named through offeredSku (plan NEXT LOT §3.3): one of a typed model's offered sizes, its current one
      // always accepted (even set aside since).
      const skuId = size === undefined ? null : o.channel === 'GIFT' ? await giftSku(tx, o.model_id, size) : await termsSku(tx, o, size);
      const sizeChange = size !== undefined && o.sku_id !== skuId;
      const priceChange = price !== undefined && (price !== o.price_minor || currency !== o.currency);
      if ((sizeChange || priceChange) && o.channel === 'LIVE') throw termsFixed();
      if (priceChange && o.channel === 'GIFT') throw giftTermsFixed();
      if (priceChange) {
        if (o.status !== 'RESERVED') throw conflict('ORDER_PAID', 'The price of an order paid no longer changes.');
        // BP-19 T5: a credit taken off it stays in its currency and within the piece's price.
        const credited = await openCreditUses(tx, o.id);
        if (credited.length > 0 && credited.some((u) => u.currency !== currency)) throw creditCurrency();
        if (credited.reduce((n, u) => n + u.amount_minor, 0) > (price ?? 0)) throw creditExceeds();
        after = await updateOrder(tx, o.id, { price_minor: price, currency });
        fields.push('price');
        // Its welcome gift takes 0 in its currency.
        for (const g of await openGifts(tx, o.id, { forUpdate: true })) {
          if (g.status !== 'RESERVED' || (g.price_minor === 0 && g.currency === currency)) continue;
          const priced = await updateOrder(tx, g.id, { price_minor: currency === null ? null : 0, currency });
          extra.push(await recordChange(tx, g, priced, 'order.terms', { details: { fields: ['price'], withOrderId: o.id } }, actor, now));
        }
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
        for (const id of [...new Set([o.sku_id, skuId].filter((x): x is string => x !== null))].sort()) await lockSku(tx, id);
        const released = await release(tx, after, 'Reserved identity retired: its order changed size', actor, now, extra);
        // Named as its SKU names it (Small typed for a SKU created SMALL reads SMALL, on the invoice too).
        const label = skuId === null ? null : (await tx.selectFrom('skus').select('size_label').where('id', '=', skuId).executeTakeFirstOrThrow()).size_label;
        after = await hold(tx, await updateOrder(tx, released.id, { size_label: label, sku_id: skuId }), actor, now, extra);
        fields.push('size');
      }
      // The shipping (BP-19 T4): entered by hand while RESERVED, or the rate of the first currency of an order without one.
      let shipped: JsonObject | null = null;
      if (shipping !== undefined) {
        if (o.status !== 'RESERVED') throw conflict('ORDER_PAID', 'The shipping of an order paid no longer changes.');
        if (o.with_order_id !== null) throw shippingWith();
        const was = shippingOf(after);
        if (was.service !== shipping.service || was.minor !== shipping.minor) {
          if (was.benefit !== null && shipping.service === was.service && (shipping.minor ?? 0) > 0) throw shippingFree();
          if ((shipping.minor ?? 0) > 0 && after.currency === null) throw validationError('Enter the order’s price and currency before a shipping fee.');
          after = await updateOrder(tx, o.id, { shipping_service: shipping.service, shipping_minor: shipping.minor, shipping_benefit: null });
          shipped = { service: shipping.service, minor: shipping.minor, benefit: null, ...(was.benefit !== null ? { freeBefore: was.benefit } : {}) };
        }
      } else if (priceChange && o.currency === null && currency && o.with_order_id === null && after.shipping_service === null) {
        // An order travelling with another takes no fee of its own: it follows its first order's service at 0.
        const rate = await shippingRate(tx, currency, 'STANDARD');
        if (rate !== null) {
          after = await updateOrder(tx, o.id, { shipping_service: 'STANDARD', shipping_minor: rate, shipping_benefit: null });
          shipped = { service: 'STANDARD', minor: rate, benefit: null, rate: true };
        }
      } else if (priceChange && o.currency !== null && currency !== o.currency && o.with_order_id === null && after.shipping_service !== null && after.shipping_benefit === null && (await shippingFromRate(tx, o.id))) {
        // Its fee came from the rate of its former currency: the new currency's rate, or no shipping when it has none. A
        // fee entered by hand stays as entered: Client Services enters it again in the new currency.
        const rate = await shippingRate(tx, currency ?? null, 'STANDARD');
        const next: OrderShipping = rate === null ? { ...NO_SHIPPING } : { service: 'STANDARD', minor: rate, benefit: null };
        if (next.service !== after.shipping_service || next.minor !== after.shipping_minor) {
          after = await updateOrder(tx, o.id, { shipping_service: next.service, shipping_minor: next.minor, shipping_benefit: null });
          shipped = { service: next.service, minor: next.minor, benefit: null, rate: true };
        }
      }
      if (fields.length === 0 && shipped === null) throw validationError('Nothing to change.');
      if (fields.length > 0) notes.push(await recordChange(tx, o, after, 'order.terms', { details: { fields, reservation: after.reservation } }, actor, now), ...extra);
      if (shipped !== null) {
        notes.push(await recordChange(tx, o, after, 'order.shipping', { details: shipped }, actor, now));
        notes.push(...(await this.followShipping(tx, after, actor, now)));
      }
    });
    return this.get(id);
  }

  /** The RESERVED orders travelling with `parent` take its service at 0 (none when it has none), in its transaction; a paid one keeps its shipping. Audited `order.shipping`. */
  private async followShipping(tx: Db, parent: OrderRow, actor: Actor, now: Date): Promise<AuditRecordInput[]> {
    const notes: AuditRecordInput[] = [];
    const followers = await tx.selectFrom('orders').selectAll().where('with_order_id', '=', parent.id).where('status', '=', 'RESERVED').orderBy('piece').orderBy('id').forUpdate().execute();
    const next = travellingShipping(parent);
    for (const f of followers) {
      if (f.shipping_service === next.service && f.shipping_minor === next.minor && f.shipping_benefit === null) continue;
      const after = await updateOrder(tx, f.id, { shipping_service: next.service, shipping_minor: next.minor, shipping_benefit: null });
      notes.push(await recordChange(tx, f, after, 'order.shipping', { details: { service: next.service, minor: next.minor, benefit: null, withOrderId: parent.id } }, actor, now));
    }
    return notes;
  }

  /**
   * APPLY CREDIT (plan NEXT-NINE, BP-19 T5; OPERATOR): `amountMinor` of the client's credit taken off a RESERVED order,
   * until real payment exists (the invoice then carries a CREDIT line): the order's channel one THE PROGRAM names (409
   * ORDER_CREDIT_CHANNEL); its price entered; grants of the account's tier now, not expired, with a balance (409
   * ORDER_CREDIT_NONE), in the order's currency (409 ORDER_CREDIT_CURRENCY); the amount within their balance and, with
   * what is already taken off it, within the piece's price (409 ORDER_CREDIT_EXCEEDS). PALLADIUM's grant first, then the
   * earliest expiry, split over several when one does not cover it. The order's row, then the grants FOR UPDATE: two at
   * once never take more than the balance. Audited `order.credit.apply`.
   */
  async applyCredit(orderId: string, amountMinor: number, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > ORDER_AMOUNT_MAX_MINOR) throw validationError('A credit is an amount above 0.');
    await this.change(id, async (tx, o, now, notes) => {
      if (o.status !== 'RESERVED') throw orderClosed();
      if (o.channel === 'GIFT') throw creditChannel();
      const program = await readProgram(tx);
      if (!(program.creditChannels as readonly string[]).includes(o.channel)) throw creditChannel();
      if (o.price_minor === null || o.currency === null) throw validationError('Enter the order’s price and currency before taking a credit off it.');
      const standing = await tierOf(tx, o.account_id, now);
      const grants = (await creditBalances(tx, o.account_id, { forUpdate: true })).filter((g) => g.tier <= standing.tier && g.expiresAt.getTime() > now.getTime() && g.balanceMinor > 0);
      if (grants.length === 0) throw creditNone();
      const usable = grants.filter((g) => g.currency === o.currency);
      if (usable.length === 0) throw creditCurrency();
      const taken = (await openCreditUses(tx, o.id)).reduce((n, u) => n + u.amount_minor, 0);
      if (amountMinor > usable.reduce((n, g) => n + g.balanceMinor, 0) || taken + amountMinor > o.price_minor) throw creditExceeds();
      let left = amountMinor;
      const uses: JsonObject[] = [];
      for (const g of usable) {
        if (left === 0) break;
        const part = Math.min(left, g.balanceMinor);
        const open = await tx.selectFrom('credit_uses').select(['id', 'amount_minor']).where('grant_id', '=', g.grantId).where('order_id', '=', o.id).where('released_at', 'is', null).executeTakeFirst();
        if (open) {
          // One open use per grant and order: a second application adds to it (released, then taken again whole).
          await tx.updateTable('credit_uses').set({ released_at: now, released_reason: 'REMOVED', released_by: actor.type === 'admin' ? actor.id! : null }).where('id', '=', open.id).execute();
        }
        const row = await tx
          .insertInto('credit_uses')
          .values({ grant_id: g.grantId, order_id: o.id, amount_minor: part + (open?.amount_minor ?? 0), applied_by: actor.type === 'admin' ? actor.id! : null, applied_at: now })
          .returning('id')
          .executeTakeFirstOrThrow();
        uses.push({ useId: row.id, grantId: g.grantId, tier: g.tier, amountMinor: part });
        left -= part;
      }
      notes.push(await recordChange(tx, o, o, 'order.credit.apply', { details: { amountMinor, currency: o.currency, uses } }, actor, now));
    });
    return this.get(id);
  }

  /** REMOVE CREDIT (BP-19 T5; OPERATOR): the credit taken off a RESERVED order given back whole, its expiry unchanged. Audited `order.credit.remove`. */
  async removeCredit(orderId: string, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    await this.change(id, async (tx, o, now, notes) => {
      if (o.status !== 'RESERVED') throw orderClosed();
      const released = await releaseCredit(tx, o, 'REMOVED', actor, now);
      if (released.length === 0) throw conflict('ORDER_CREDIT_NONE', 'No credit is taken off this order.');
      notes.push(...released);
    });
    return this.get(id);
  }

  /**
   * A credit still taken off a CANCELLED order given back (BP-19 T5), as its cancellation gives it back: its open uses
   * released with the reason CANCELLED, their grant's expiry unchanged; audited `order.credit.release`. Nothing on an
   * order not cancelled or with no open use. No route: END TEST's check (services/test-entrants.ts) calls it, after
   * cancelling a test's orders, for any use their cancellation did not give back. Returns the uses released.
   */
  async releaseCancelledCredit(orderId: string, actor: Actor): Promise<number> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    let released = 0;
    await this.change(id, async (tx, o, now, notes) => {
      if (o.status !== 'CANCELLED') return;
      released = (await openCreditUses(tx, o.id)).length;
      notes.push(...(await releaseCredit(tx, o, 'CANCELLED', actor, now)));
    });
    return released;
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
        await tx.selectFrom('drops').select('id').where('id', '=', e.drop_id).forNoKeyUpdate().executeTakeFirstOrThrow();
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
        await tx.selectFrom('drops').select('id').where('id', '=', e.drop_id).forNoKeyUpdate().executeTakeFirstOrThrow();
        await tx.selectFrom('drop_entries').select('id').where('id', '=', e.id).forUpdate().executeTakeFirstOrThrow();
        const created = await orderForDrawEntry(tx, e.id, SYSTEM_ACTOR, now, { reservedAt: e.handled_at ?? now });
        notes.push(...created.notes);
        return created.orders.length;
      });
    }
    return { ...setup, linked, orders };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One change of an order in its transaction: the order's row first (after what `first` locks), the audit entries last. */
  private async change(id: string, fn: (tx: Db, o: OrderRow, now: Date, notes: AuditRecordInput[]) => Promise<void>, first?: (tx: Db) => Promise<void>): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      if (first) await first(tx);
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
