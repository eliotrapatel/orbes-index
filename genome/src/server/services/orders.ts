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
 *                is available (STOCK: counted as reserved, services/stock.ts); otherwise it waits for supplier stock
 *                (AWAITING, plan NEXT LOT §3.5: no piece to make, no identity reserved; never shown to the collector).
 *                Waiting orders are served strictly by date, whatever their channel (a reshipment after a parcel lost
 *                or damaged first, `queue_first`), each time a piece becomes available at their location
 *                (`serveWaiting`: a count corrected up, a transfer in, a cancellation, a location change away, a
 *                return to stock). Changing the order's location moves what it holds (`changeLocation`): a piece in
 *                stock is released and taken again at the new location, or the order waits there.
 *   steps        exactly ORDER_TRANSITIONS (`transition`): RESERVED → PAID | CANCELLED; PAID → SHIPPED | CANCELLED;
 *                SHIPPED → DELIVERED | RETURNED; DELIVERED → RETURNED.
 *                PAID: by Client Services (later Whop or Shopify, through the same transition), once its price is
 *                entered (409 ORDER_PRICE_MISSING before): its invoice is issued in the same transaction
 *                (services/invoices.ts issueInvoice).
 *                SHIPPED: with an active carrier and the tracking number (the value declared for the insurance
 *                optional), once the piece is in stock at the order's location (409 ORDER_NOT_READY before) and
 *                bound to the order (409 ORDER_PIECE_NOT_LINKED before: the packing scan binds it), and only through
 *                its parcel's Ship, the parcel PACKED with every card scanned (409 ORDER_NOT_PACKED otherwise, plan
 *                NEXT LOT §3.5.6.7: services/logistics.ts ships every order of the parcel together): it leaves the
 *                ledger (SHIPPED, −1).
 *                DELIVERED: by Client Services, or by itself when the buyer registers the piece linked to the order
 *                while it is SHIPPED (`deliverOnRegistration`, OwnershipService.registerFirst).
 *                CANCELLED, with a note: a piece in stock is released, and serves the next order waiting for it; once
 *                PAID, a credit note cancels its invoice.
 *                RETURNED (`returnOrder`, choice 20), opened by Client Services with a note and where the piece goes:
 *                back to stock at a location (the ledger's RETURNED, +1; the piece RESOLD, ready to be sold again, unless
 *                it was never sold: ISSUED) or to the archive (the piece RETIRED). When its buyer had registered it, ORBES
 *                takes the ownership back (`returns.ownership_id`, ended RETURNED; a transfer pending is cancelled): back
 *                to stock, the piece is not registered and carries a new claim code, shown once for its new card;
 *                archived, it is retired. A credit note cancels its invoice.
 *   history      every change is one event of the order (order_events: its audit action, the status after it, a note,
 *                who, when), one audit entry (`order.create`, `.pay`, `.ship`, `.deliver`, `.cancel`, `.return`,
 *                `.location`, `.terms`, `.buyer`, `.link`, `.serve`: a waiting order served, by the system) and one entry
 *                of the event journal (the order as it stands after it; services/journal.ts), in the transaction of the
 *                change; the identities (`product.issue`, `product.transition`), the stock (`stock.move`) and the
 *                invoices (`invoice.issue`, `invoice.credit`) journal their own changes; a return that takes an
 *                ownership back is audited `ownership.reclaim` too.
 *   the piece    the one that fulfils the order, bound by the agent's packing scan of its card (`attachPiece` via
 *                `scan`, `order.link`, services/logistics.ts): the order then holds it in stock until it is shipped.
 *   the buyer    the delivery address: name, address lines, country and phone (plan NEXT LOT §3.6.B; until then
 *                entered by Client Services only, decision 31). A new order takes the account's default address (YOUR
 *                ADDRESSES, services/addresses.ts) at its creation; the collector sets or changes it in YOUR ORDERS
 *                while RESERVED or PAID until packing starts (`setAddress`; 409 ORDER_PACKING_STARTED after), Client
 *                Services until SHIPPED (`setBuyer`); who entered it and when (`address_by`, `address_at`), and when it
 *                was replaced after it was first entered (`address_changed_at`: the agent's ADDRESS CHANGED). An order
 *                travelling with another is delivered with it, to its address (`addressOf`; 409 ORDER_TRAVELS_WITH to
 *                set its own). Kept on the order only, never in the audit log, the order's events nor the journal (which
 *                say it was entered, its country and who, never its words), and exported to the account under the right
 *                of access (`accountOrders`); the console's routes give it masked to an AUDITOR (the name masked, the
 *                address and the phone withheld, the country shown). The engraving text likewise stays on the order.
 *   engraving    (plan NEXT LOT §3.6.C) the collector types it in YOUR ORDERS (`setEngraving`), RESERVED or PAID, until
 *                packing starts. Since lot Q2, step Q2.5 (D4, N3, N4, N5, N8) it is one system: the engraving is a
 *                catalogue add-on (a service, services/addons.ts) and an order's engraving is its unit
 *                (order_addon_items) with the words on the order (`engraving_text`), at most the add-on's `textMax`
 *                characters. Words on an order without the unit add it (COLLECTOR) at the price of the engraving YOUR
 *                ORDERS offers in its currency (its switch alone, whatever the order's release; none: 409
 *                ORDER_ENGRAVING_UNAVAILABLE): added after PAID, a supplementary invoice of its ADD_ON_ITEM line; the
 *                words removed remove it, after PAID with a credit note for its line; its words changed, no document. A
 *                unit bought with the order (PURCHASE, chosen at a LIVE hold) has its words changed until packing, and
 *                is never removed by the collector (409 ORDER_ENGRAVING_INCLUDED). Client Services' words (`setTerms`)
 *                go the same way through the staff path (STAFF). YOUR ORDERS draws the unit in the order's ENGRAVING,
 *                never among its add-on rows. An order of before reads as it did, at 20 characters: its LIVE RELEASE's
 *                ENGRAVING add-on (a label holding the word ENGRAVING, `hasEngravingAddon`), its words only, never
 *                removed by the collector; words priced from Orders → Settings (`engraving_minor`, their ENGRAVING
 *                line), changed at that price, removed with a credit note for that line. Audited `order.engraving`,
 *                never the words.
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
 *                names, its currency the credit's, the account at the grant's tier now (a birthday credit, plan
 *                CUSTOMER INTELLIGENCE §3.5 SB.4, a vault's or a warranty credit, whatever the tier), the grant not
 *                expired, the amount within the balance and the piece's price; the birthday credit first, then a
 *                vault's, the warranty credit, PALLADIUM's, then the earliest expiry. A CREDIT line on the invoice.
 *                Removed while RESERVED (`removeCredit`), released when the order is cancelled or returned, the
 *                expiry unchanged. Audited `order.credit.apply`, `.remove`, `.release`.
 *
 * The LIVE RELEASES' Client Services resolution is retired into the orders (the console's Orders board steps them): the
 * sales committed before migration 0022, or by the previous image, get their orders at boot (`OrderService.prepare`),
 * a resolution already given mapped (CONCLUDED → PAID, CANCELLED → CANCELLED).
 *
 * Lock order: the source's rows (the release, then the entry; the request), the order, the SKU (stock.ts lockSku), the
 * orders waiting for that SKU in queue order (`serveWaiting`); a return takes the piece returned before the order (as a registration does:
 * OwnershipService.registerFirst holds the piece, then delivers its order), then the SKU, the piece's ownership and
 * transfer; the invoice numbers (invoices.ts); the journal; the audit log last: the functions a sale's transaction calls
 * return their audit entries for it to write after its own (a return's change of the piece's status, LifecycleService,
 * writes its own, last).
 */
import { sql } from 'kysely';
import { inRetriedTransaction, inTransaction, type Db } from '../db/connection.js';
import {
  ORDER_STATUSES,
  RETURN_OUTCOMES,
  SHIPPING_SERVICES,
  WARRANTY_CLAIM_LIVE_STATUSES,
  jsonText,
  type AddressSource,
  type OrderCaseOutcome,
  type OrderCaseStatus,
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
  type HouseCurrency,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { countryName } from '../../shared/countries.js';
import { renderCareConditionsPdf } from '../render/care-conditions.js';
import { systemClock, SYSTEM_ACTOR, type Actor, type Clock, type Logger, noopLogger } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { addressNotFound, checkAddress, checkCountry, checkPhone, defaultAddress, insertAddress, lockAccountAddresses, type DeliveryAddress } from './addresses.js';
import { customerAccountLocked } from './auth.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import { lockPieces, peekClaimRenewals, waitingClaimCodes, withdrawOnCancel, withdrawWaiting, type AccountOrderClaimCode } from './claim-renewals.js';
import { engravingLine, issueCreditNote, issueInvoice, issueLineCreditNote, issueSupplementaryInvoice, orderInvoices, type InvoiceBuyer } from './invoices.js';
import { mediaUrl } from './media.js';
import { writeJournal } from './journal.js';
import { isTransitionAllowed, LifecycleService, returnTargetOf } from './lifecycle.js';
import { CERTIFICATE_ENDING_STATUSES } from './ownership.js';
import { tierOf } from './club.js';
import { giftModelOf, readProgram, shippingRate } from './club-program.js';
import { creditBalances, creditKindOrder, ensureGrants, usableAt, type CreditKind } from './tier-grants.js';
import { giveTierVaults, revokeReturnedPieceVaults } from './vault.js';
import { modelSizeCandidates, offeredSku, savedSizeAmong, savedSizeHint, sizesForExchange } from './sizes.js';
import { ordersForSetSale } from './set-sales.js';
import { parcelOrders, RETURN_WINDOW_DAYS } from './parcels.js';
import {
  accountAddonItems,
  accountAddonOpen,
  addEngravingUnit,
  addonCurrencyFixed,
  assertEngravingNotPacked,
  engravingUnits,
  engravingWordsInvalid,
  ordersEngraving,
  removeEngravingUnit,
  type AddonBy,
  type EngravingUnit,
  type OrdersEngraving,
  adminAddonUnits,
  attachVaultAddons,
  cancelUnits,
  carryChoices,
  exportedAddonItems,
  heldCurrency,
  moveUnits,
  returnUnits,
  shipUnits,
  type AccountOrderAddonItem,
  type AdminOrderAddonUnit,
  type LeftOutAddon,
} from './order-addons.js';
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

/** The statuses in which an order holds a piece (STOCK) or waits for one (AWAITING). */
export const ORDER_HOLDING_STATUSES: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID']);
/** The steps in which an order holds its piece for its buyer (orders_product_key): neither CANCELLED nor RETURNED. */
const OPEN_STATUSES: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED']);
/** No hash prepared for a cancellation (plan NEXT LOT §3.4): its orders hold no buyer's new claim code. */
const NO_CLAIM_HASHES: ReadonlyMap<string, string> = new Map();
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
/** Plan NEXT LOT §3.5.6.7 (step 5.12): an order ships only through its parcel's Ship, packed and checked. */
export const orderNotPacked = () => conflict('ORDER_NOT_PACKED', 'Pack the parcel and check it before it ships.');
/** Plan ORBES CARE §2(c): a return never takes a piece from a warranty claim under way (it would go to a former owner). */
const claimUnderWay = () => conflict('CLAIM_OPEN', 'A warranty claim is under way for this piece: finish or close it first.');
const pieceLinked = () => conflict('ORDER_PIECE_LINKED', 'A piece is already linked to this order: transfer the piece instead.');
const termsFixed = () => conflict('ORDER_TERMS_FIXED', 'The size and the price of a LIVE RELEASE order are those of its release.');
/**
 * THE VAULT (lot Q3, §2.4; 0062's `orders_vault`): a VAULT order at 0 holds the unit reserved for its winner until the
 * claim (the collector's CLAIM IT chooses its size), never waits for stock, and stays at 0; a VAULT order bought under a
 * right to buy keeps a price. Client Services' edits that would break that are refused in words.
 */
const vaultFree = (o: Pick<OrderRow, 'channel' | 'price_minor'>) => o.channel === 'VAULT' && o.price_minor === 0;
const vaultUnclaimed = () => conflict('ORDER_VAULT_UNCLAIMED', 'A piece won in a vault keeps the unit held for its winner until it is claimed: its location, size and price do not change before.');
const vaultNoUnit = () => conflict('ORDER_VAULT_NO_UNIT', 'A piece won in a vault never waits for stock: none is available there in its size.');
const vaultPrice = () => conflict('ORDER_VAULT_PRICE', 'A piece won in a vault stays free, and one bought from a vault keeps its price.');
/** Plan NEXT LOT §3.6.F and §3.6.G: a draw's entry and a salon's request with a size fix it; an exchange goes through an order case. */
const sizeFixed = () => conflict('ORDER_SIZE_FIXED', 'The size of this order is the one chosen at its entry or request.');
const orderClosed = () => conflict('ORDER_CLOSED', 'This order can no longer change.');
/** Plan NEXT LOT §3.6.B: an order travelling with another is delivered to that order's address. */
const travelsWith = (parentId: string) => conflict('ORDER_TRAVELS_WITH', `This piece travels with order ${orderReference(parentId)}: its address is that order’s.`);
const packingStarted = () => conflict('ORDER_PACKING_STARTED', 'Packing has begun: write to ORBES Client Services to change this order.');
/** Plan NEXT LOT §3.6.C. */
const engravingIncluded = () =>
  conflict('ORDER_ENGRAVING_INCLUDED', 'Your engraving was bought with your order: its words may change until packing begins. ORBES Client Services can assist you.');
const engravingUnavailable = () => conflict('ORDER_ENGRAVING_UNAVAILABLE', 'Engraving is not offered on this order.');

/**
 * The collector's engraving (plan NEXT LOT §3.6.C): at most 20 characters of letters, figures, spaces and . & ' ’ -; since
 * lot Q2, step Q2.5 (N3), at most its engraving add-on's `textMax` (1 to 20), 20 still for an order of before (its
 * Settings price or its release's ENGRAVING) and as the ceiling every engraving is first held to.
 */
export const ENGRAVING_COLLECTOR_MAX = 20;
const ENGRAVING_RE = (max: number = ENGRAVING_COLLECTOR_MAX) => new RegExp(`^[\\p{L}\\p{M}0-9 .&'’-]{1,${max}}$`, 'u');
const engravingWords = (max: number = ENGRAVING_COLLECTOR_MAX) => engravingWordsInvalid(max);

/**
 * Whether an order carries the release's engraving add-on (plan NEXT LOT §3.6.C, Default: one of its add-ons' labels
 * holds the word ENGRAVING, whatever its case): its engraving is paid there, no second price.
 */
export function hasEngravingAddon(addons: readonly { label: string }[]): boolean {
  return addons.some((a) => /\bENGRAVING\b/i.test(a.label));
}
const carrierUnknown = () => notFound('Carrier', 'CARRIER_NOT_FOUND');
const priceMissing = () => conflict('ORDER_PRICE_MISSING', 'Enter the order’s price before it is paid: its invoice is issued then.');
const returnChanged = () => conflict('ORDER_RETURN_CHANGED', 'The piece changed during the return. Please try again.');
const shippingFree = () => conflict('ORDER_SHIPPING_FREE', 'This order’s shipping is free with its tier: no fee is added to it.');
const shippingWith = () => conflict('ORDER_SHIPPING_WITH', 'This order travels with another: its shipping is that order’s.');
/** Macro scope K44 (plan MACRO M3 §5.1, §15 note 12): a set sold is cancelled whole, and returned whole. */
export const setShipped = () => conflict('SET_SHIPPED', 'A piece of this set has shipped: a set is cancelled whole, never in part.');
export const setReturnWhole = () => conflict('SET_RETURN_WHOLE', 'A set is returned whole: open the return of the set as an order case.');
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
  /**
   * Plan MACRO M3 §4.2: the add-on units (their ids) ORBES marks not to be sold again; every other unit returned goes
   * back to stock, at the piece's location or, the piece archived, at the order's.
   */
  addonsOut?: string[];
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

/**
 * The buyer's name and address (decision 31) and, since plan NEXT LOT §3.6.B, the delivery address's country and phone;
 * null clears one; a country or a phone left out (undefined) stays as it is.
 */
export interface OrderBuyerInput {
  name: string | null;
  address: string | null;
  country?: string | null;
  phone?: string | null;
}

/**
 * What the collector puts on an order (PUT /api/v1/account/orders/:id/address, plan NEXT LOT §3.6.B): one of its saved
 * addresses, or a new one (all four fields), saved to YOUR ADDRESSES too when asked.
 */
export type OrderAddressInput = { addressId: string } | { address: DeliveryAddress; save?: boolean };

/**
 * An order's delivery address (plan NEXT LOT §3.6.B): its own, or, for an order travelling with another, that order's
 * (`travelsWith`: its id); who entered it and when, and when it was replaced after it was first entered.
 */
export interface OrderAddress {
  name: string | null;
  address: string | null;
  country: string | null;
  phone: string | null;
  by: AddressSource | null;
  at: Date | null;
  changedAt: Date | null;
  travelsWith: string | null;
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
  model: { id: string; name: string; /** Plan NEXT LOT §3.5.3: the slip's Piece reads MONOLITHE · BLUE. */ variant: string | null };
  sizeLabel: string | null;
  skuId: string | null;
  priceMinor: number | null;
  currency: string | null;
  addons: OrderAddonSnapshot[];
  surprise: string | null;
  engravingText: string | null;
  /**
   * Plan NEXT LOT §3.6.C: the price its engraving was taken at (its unit's since lot Q2, step Q2.5; on an order of before,
   * Orders → Settings'), null for one bought as the release's add-on of before or entered without a price; who typed its
   * words (COLLECTOR, STAFF).
   */
  engravingMinor: number | null;
  engravingBy: AddressSource | null;
  /**
   * The delivery address (plan NEXT LOT §3.6.B): its own, or the order's it travels with (`addressOf`), as stored; the
   * routes mask it for an AUDITOR (the name masked, the address and the phone withheld, the country shown).
   */
  buyer: { name: string | null; address: string | null; country: string | null; phone: string | null };
  /** Who entered the delivery address and when (COLLECTOR, STAFF), and when it was replaced after it was first entered. */
  addressBy: AddressSource | null;
  addressAt: Date | null;
  addressChangedAt: Date | null;
  status: OrderStatus;
  reservedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  returnedAt: Date | null;
  location: { id: string; name: string };
  reservation: OrderReservation | null;
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
  /**
   * BP-19 T5: the client's credit usable now (balance, currency, expiry) and the credit taken off this order (released or
   * not); each a tier's (CREDIT, its tier), the birthday credit (BIRTHDAY, no tier; plan CUSTOMER INTELLIGENCE §3.5 SB.4.3)
   * or a warranty credit (WARRANTY, no tier; plan ORBES CARE).
   */
  credit: {
    available: { grantId: string; kind: CreditKind; tier: 2 | 3 | null; balanceMinor: number; currency: string; expiresAt: Date }[];
    applied: { id: string; grantId: string; kind: CreditKind; tier: 2 | 3 | null; amountMinor: number; appliedAt: Date; releasedAt: Date | null; releasedReason: CreditReleaseReason | null }[];
  };
  /** Its return (RETURNED): where the piece went, the note, and whether ORBES took its buyer's ownership back. */
  /** Its note null for an AUDITOR when the return was decided from an order case (routes/admin/orders.ts). */
  return: { outcome: ReturnOutcome; location: { id: string; name: string } | null; note: string | null; at: Date; ownershipReclaimed: boolean } | null;
  /** Its invoice and credit note (services/invoices.ts), in order of issue. */
  invoices: OrderDocument[];
  /** Its history, oldest first. */
  events: { action: string; status: OrderStatus; note: string | null; at: Date; actor: { type: string; id: string | null } }[];
  /** Plan MACRO M3 §4.2 (D1, D2): its catalogue add-ons, unit by unit, oldest first (services/order-addons.ts). */
  addonItems: AdminOrderAddonUnit[];
  /**
   * Macro scope K44 (T1, T3): an order of a set sale, its set, the one price and this order's piece, with every order of
   * the sale in the set's order (a piece's size EXCHANGE order among them, in its piece's place); null for any other order.
   */
  set: AdminOrderSet | null;
}

/** An order's set sale as the console reads it (macro scope K44): the order page's « Part of THE SET ». */
export interface AdminOrderSet {
  saleId: string;
  setId: string;
  name: string;
  /** The set's one price and its currency (null for both: a draw without a price). */
  priceMinor: number | null;
  currency: string | null;
  /** This order's piece (1 to 4). */
  piece: number;
  orders: { id: string; reference: string; piece: number | null; channel: OrderChannel; status: OrderStatus; model: string; variant: string | null; sizeLabel: string | null; priceMinor: number | null; currency: string | null }[];
}

/** The set sale of an order (OrderView.set): its set, price and orders in the set's order; null without one. */
async function adminOrderSet(db: Db, saleId: string | null, piece: number | null): Promise<AdminOrderSet | null> {
  if (saleId === null) return null;
  const sale = await db.selectFrom('set_sales as s').innerJoin('sets as t', 't.id', 's.set_id').select(['s.id', 's.set_id', 't.name', 's.price_minor', 's.currency']).where('s.id', '=', saleId).executeTakeFirst();
  if (!sale) return null;
  const orders = await db
    .selectFrom('orders as o')
    .innerJoin('models as m', 'm.id', 'o.model_id')
    .select(['o.id', 'o.set_piece', 'o.channel', 'o.status', 'm.name', 'm.variant_label', 'o.size_label', 'o.price_minor', 'o.currency'])
    .where('o.set_sale_id', '=', saleId)
    .orderBy('o.set_piece')
    .orderBy('o.reserved_at')
    .orderBy('o.id')
    .execute();
  return {
    saleId: sale.id,
    setId: sale.set_id,
    name: sale.name,
    priceMinor: sale.price_minor,
    currency: sale.currency,
    piece: piece ?? 1,
    orders: orders.map((o) => ({
      id: o.id,
      reference: orderReference(o.id),
      piece: o.set_piece,
      channel: o.channel,
      status: o.status,
      model: o.name,
      variant: o.variant_label,
      sizeLabel: o.size_label,
      priceMinor: o.price_minor,
      currency: o.currency,
    })),
  };
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
  /** Plan MACRO M3 §4.2: its catalogue add-ons, unit by unit: each its name, price, state and times. */
  addonItems: { name: string; priceMinor: number; currency: string; status: string; addedAt: Date; endedAt: Date | null; returnedAt: Date | null }[];
  /**
   * Macro scope K44 (plan MACRO M3 §5.2): on a piece of a set, the set's name, this order's piece, and the set sale's one
   * price and currency (each order's own price is its share); absent on an order of its own.
   */
  set?: { name: string; piece: number; salePriceMinor: number | null; saleCurrency: string | null; saleOrders: string[] };
  /** BP-19 T4: its shipping, all null for none. */
  shipping: OrderShipping;
  engravingText: string | null;
  /** Its delivery address as stored on it (plan NEXT LOT §3.6.B: with its country and phone). */
  buyer: { name: string | null; address: string | null; country: string | null; phone: string | null };
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
  /**
   * Plan NEXT LOT §3.6.D: its order cases (returns, size exchanges, parcel problems), oldest first: the kind, who opened
   * it (the collector or ORBES Client Services, never by name), the reason and the collector's own note, the size asked,
   * the times and the outcome; never staff's notes nor who handled it.
   */
  cases: {
    kind: string;
    openedBy: 'YOU' | 'ORBES_CLIENT_SERVICES';
    openedAt: Date;
    reason: string | null;
    note: string | null;
    sizeLabel: string | null;
    status: string;
    receivedAt: Date | null;
    closedAt: Date | null;
    outcome: string | null;
    cancelledAt: Date | null;
  }[];
}

/** The orders MY PIECES reads, at most: the account's latest (GET /api/v1/account/orders). */
export const ACCOUNT_ORDERS_LIMIT = 100;

/**
 * An order as its collector reads it in MY PIECES (choice 6; GET /api/v1/account/orders): its steps and their times,
 * the model, the size, the add-ons and the price as sold, and once shipped the carrier and the tracking number with
 * its link. Plan NEXT LOT §3.6: also their own delivery address (the name, the lines, the country, the phone), the
 * engraving's words and the price it was taken at, the engraving offered and what they may still change, and, for an
 * open return or size exchange, the address to send the piece back to. Never where it is served from (its location),
 * what it holds (its piece, whether it is reserved or waiting for supplier stock), the surprise, the value declared,
 * the notes, the packing photo, nor who handled it (who entered the address, who opened or decided its case).
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
   * Plan MACRO M3 §4.2 (D2): its catalogue add-ons (POLISHING CLOTH × 2), one row per add-on and price, each removable
   * while it may be (held, before packing); and whether ADD AN ADD-ON is offered on it now (`canAddAddons`: RESERVED or
   * PAID, before packing, its currency entered, and at least one add-on available at its location in its currency that
   * it may still take; never on a welcome gift, a size exchange nor a Shopify order).
   */
  addonItems: AccountOrderAddonItem[];
  canAddAddons: boolean;
  /**
   * BP-19 T4: its shipping (the service, the fee in its currency, the tier that made it free), and for an order
   * travelling with another the reference of that order (`withOrder`), which carries the fee; null without shipping.
   */
  shipping: (OrderShipping & { withOrder: string | null }) | null;
  /** BP-19: the reference of the order it travels with (a welcome gift's, a LIVE entry's further pieces), or null. */
  withOrder: string | null;
  /**
   * Macro scope K44 (plan MACRO M3 §5.2, §5.4): the set sale this order is a piece of, so YOUR ORDERS groups the pieces
   * of one set under « THE SET · <name> » with the set's one price: the sale, the set's name, the one price and currency
   * (null until entered), this order's piece, and the set's orders in its order (an exchanged piece's EXCHANGE order
   * after its original); null for an order of its own. Each order's own price is its share (§15 note 11).
   */
  set: AccountOrderSet | null;
  /** BP-19 T5: a welcome gift's tier (PLATINE, PALLADIUM); null for any other order. */
  giftTier: 'PLATINE' | 'PALLADIUM' | null;
  /** THE VAULT (lot Q3 §3.8): a VAULT order's, won free (at 0, its end to be claimed) or bought under a right to buy; null otherwise. */
  vault: { free: boolean; claimBy: Date | null } | null;
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
  /**
   * Plan NEXT LOT §3.4: a new claim code ORBES Client Services made for its piece, waiting for this account's one reading
   * (POST …/claim-code): its status and when it was made, never the code; null otherwise (and once it is read).
   */
  claimCode: AccountOrderClaimCode | null;
  /**
   * Plan NEXT LOT §3.6.B: its delivery address (its own, or the order's it travels with): the name, the lines as typed,
   * the country (ISO 3166-1 alpha-2) and the phone; null while none is entered. Never who entered it.
   */
  address: { name: string; lines: string; country: string | null; phone: string | null } | null;
  /** The reference of the order it travels with, whose address it is delivered to; null for an order of its own. */
  addressOf: string | null;
  /**
   * Plan NEXT LOT §3.6.C: its engraving's words and the price it was taken at (its unit's since lot Q2, step Q2.5; null:
   * bought as the release's add-on of before, or entered before, no price); null without words.
   */
  engraving: { text: string; priceMinor: number | null } | null;
  /**
   * The engraving it may carry (lot Q2, step Q2.5): its unit's when it carries one (the price it was sold at; `included`
   * when bought with the order or while its words are not entered: its words only, never removed by the collector),
   * otherwise the engraving YOUR ORDERS offers in its currency (`priceMinor`); on an order of before, the release's
   * add-on (`included`, no price) or the price its words took; the words' `maxLength` (the engraving add-on's `textMax`,
   * 20 on an order of before); null when none is offered (a welcome gift, a currency without a price or not entered yet,
   * the engraving's YOUR ORDERS switch off).
   */
  engravingOffer: { priceMinor: number | null; included: boolean; maxLength: number } | null;
  /**
   * What the collector may change on it now, as the server reads it: the address (RESERVED or PAID, its own, packing not
   * started) and the engraving (RESERVED or PAID, packing not started, one offered).
   */
  editable: { address: boolean; engraving: boolean };
  /**
   * Plan NEXT LOT §3.6.A: IN PREPARATION's time, the later of its payment and the moment it took its piece in the stock
   * (its creation, or a waiting order served); kept once reached, whatever its status now; null when never reached.
   */
  preparingAt: Date | null;
  /** A LOST, DAMAGED or BACK_TO_SENDER order case of its parcel not ended: one sentence replaces the step's. */
  deliveryIssue: boolean;
  /**
   * Plan NEXT LOT §3.6.D: RETURNS AND EXCHANGES, while it may be asked: DELIVERED, not a welcome gift, within 14 days of
   * its delivery (`until`), no order case not ended; each other size of its model and whether it is in stock at the
   * order's location now (none for a model of one size). null otherwise. `savedSize` (plan CUSTOMER INTELLIGENCE §3.7):
   * the size YOUR SIZES preselects among those in stock, by label; null without a saved size of the model's kind, when it
   * matches none in stock, or only the order's own size.
   */
  returnable: { until: Date; sizes: { label: string; available: boolean }[]; savedSize: { label: string } | null } | null;
  /**
   * Its latest return or size exchange (asked by the collector or opened by Client Services): its kind, status, when it
   * was opened and the parcel received, the size asked, the address to send the piece back to (its location's; null
   * without one), the outcome and the EXCHANGE order. Never a note, a reason, the piece's state nor who handled it. null
   * without one.
   */
  case: {
    kind: 'RETURN' | 'EXCHANGE';
    status: OrderCaseStatus;
    openedAt: Date;
    receivedAt: Date | null;
    sizeLabel: string | null;
    returnAddress: string | null;
    outcome: OrderCaseOutcome | null;
    exchangeOrder: { id: string; reference: string } | null;
  } | null;
}

/** A set's piece in YOUR ORDERS (macro scope K44, AccountOrder.set). */
export interface AccountOrderSet {
  saleId: string;
  name: string;
  priceMinor: number | null;
  currency: string | null;
  piece: number;
  /** The set's orders (their ids), in the set's order. */
  pieces: string[];
}

/** The documents of an order in MY PIECES (M6). */
export interface AccountOrderDocuments {
  /** Its invoice (PDF), once PAID. */
  invoice: { number: string; issuedAt: Date } | null;
  /** The credit note that cancels it (PDF), once cancelled after PAID or returned. */
  creditNote: { number: string; issuedAt: Date } | null;
  /**
   * Plan NEXT LOT §3.6.C: its other documents, in order of issue: a supplementary invoice (an engraving added after
   * PAID), a credit note for single lines (an engraving removed after PAID), the credit note of a supplementary invoice;
   * each read by its number (GET /api/v1/account/orders/:id/documents/:number).
   */
  others: { kind: InvoiceKind; number: string; issuedAt: Date }[];
  /** The model's care guide: for an order whose piece is on its way or kept (neither cancelled nor returned). */
  careGuide: boolean;
  /** Its ownership certificate (PDF): once its piece is registered to this account, and while it may have one. */
  certificate: boolean;
  /**
   * Plan ORBES CARE, answer 14: the ORBES CARE conditions (PDF, article 11 of the terms in force), given with every
   * order whatever its status (GET /api/v1/account/orders/:id/care-conditions.pdf).
   */
  careConditions: true;
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
    engravingMinor: o.engraving_minor,
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
    // Macro scope K44 (S5): a set's piece names its set sale, the store's line item the future sync maps it to.
    ...(o.set_sale_id ? { setSaleId: o.set_sale_id, setPiece: o.set_piece } : {}),
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
 * The order's own size named again (whatever its case) is its own SKU, even when another of the model's sizes reads as
 * the same measure ('SIZE 52' and '52', both made before the model had its type): no change.
 */
async function termsSku(tx: Db, o: OrderRow, size: string | null): Promise<string> {
  if (o.sku_id !== null) {
    const own = await tx.selectFrom('skus').select('size_label').where('id', '=', o.sku_id).executeTakeFirst();
    const asked = sizeLabelOf(size);
    if (own && (own.size_label === null ? asked === null : asked !== null && own.size_label.toUpperCase() === asked.toUpperCase())) return o.sku_id;
  }
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

/** An order's credit taken off it and not released, with each grant's kind and tier: the birthday credit's first (§3.5 SB.4.3), then the warranty credit's (plan ORBES CARE). */
async function openCreditUses(tx: Db, orderId: string, opts: { forUpdate?: boolean } = {}) {
  let q = tx
    .selectFrom('credit_uses as u')
    .innerJoin('tier_grants as g', 'g.id', 'u.grant_id')
    .select(['u.id', 'u.grant_id', 'u.amount_minor', 'u.applied_at', 'g.kind', 'g.tier', 'g.currency'])
    .where('u.order_id', '=', orderId)
    .where('u.released_at', 'is', null)
    .orderBy(creditKindOrder(sql.ref('g.kind')))
    .orderBy(sql`g.tier desc nulls last`)
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
export async function lockOrder(tx: Db, orderId: string): Promise<OrderRow> {
  const o = await tx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
  if (!o) throw orderNotFound();
  return o;
}

/**
 * Every order of a set sale FOR UPDATE, in the set's order (set_piece, reserved_at, id): the one order every path that
 * holds more than one of a set's orders locks them in (a set cancelled whole, a set's return opened), so two of them on
 * different pieces of one set never deadlock.
 */
export async function lockSetSale(tx: Db, setSaleId: string): Promise<OrderRow[]> {
  return tx.selectFrom('orders').selectAll().where('set_sale_id', '=', setSaleId).orderBy('set_piece').orderBy('reserved_at').orderBy('id').forUpdate().execute();
}

/** Update an order and read it back. */
export async function updateOrder(tx: Db, id: string, set: OrderUpdate): Promise<OrderRow> {
  return tx.updateTable('orders').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
}

type AddressColumns = Pick<OrderRow, 'with_order_id' | 'buyer_name' | 'buyer_address' | 'buyer_country' | 'buyer_phone' | 'address_by' | 'address_at' | 'address_changed_at'>;

/** An order's own delivery address, as its row holds it. */
function ownAddress(o: AddressColumns, travelsWith: string | null = null): OrderAddress {
  return { name: o.buyer_name, address: o.buyer_address, country: o.buyer_country, phone: o.buyer_phone, by: o.address_by, at: o.address_at, changedAt: o.address_changed_at, travelsWith };
}

/**
 * An order's delivery address (plan NEXT LOT §3.6.B): its own, or, for an order travelling with another (a welcome gift,
 * a LIVE entry's 2nd to 5th piece, a guaranteed draw place's further pieces), that order's, which it is delivered with
 * (« an order ships complete »): read by MY PIECES, the order's page, the parcel, SHIP and a travelling order's invoice.
 * A travelling order's own old name and address (entered before 0039) are never read.
 */
export async function addressOf(db: Db, o: AddressColumns): Promise<OrderAddress> {
  if (o.with_order_id === null) return ownAddress(o);
  const parent = await db
    .selectFrom('orders')
    .select(['with_order_id', 'buyer_name', 'buyer_address', 'buyer_country', 'buyer_phone', 'address_by', 'address_at', 'address_changed_at'])
    .where('id', '=', o.with_order_id)
    .executeTakeFirstOrThrow();
  return ownAddress(parent, o.with_order_id);
}

/** Whether a delivery address is enough to pack and ship (§1.1 (d)): its name, its lines and its country; the phone may be missing. */
export const shippable = (a: Pick<OrderAddress, 'name' | 'address' | 'country'>): boolean => a.name !== null && a.address !== null && a.country !== null;

/**
 * Record one change of an order: its event (the status after it), its journal entry (the order as it stands), and the
 * audit entry the caller writes last. The note and the details are Client Services' words and ids, never the buyer's.
 */
export async function recordChange(
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
 * one is available (STOCK), otherwise it waits for supplier stock (AWAITING: no piece to make, no identity reserved;
 * plan NEXT LOT §3.5). Under the SKU's lock.
 */
export async function hold(tx: Db, o: OrderRow, _actor: Actor, _now: Date, _notes: AuditRecordInput[]): Promise<OrderRow> {
  if (o.sku_id === null || o.reservation !== null || !ORDER_HOLDING_STATUSES.includes(o.status)) return o;
  await lockSku(tx, o.sku_id);
  const level = await stockLevel(tx, o.sku_id, o.location_id);
  return updateOrder(tx, o.id, { reservation: level.available >= 1 ? 'STOCK' : 'AWAITING' });
}

/**
 * The parcel of an order being packed (a shipment PACKING or PACKED with an item for it), cancelled when the order is
 * (plan NEXT LOT §3.5.6.7): the shipment CANCELLED, this order's item unbound from its piece. The other items keep the
 * pieces their scans bound: their orders keep them (`orders.product_id`) for the next shipment. Under the order's lock.
 */
async function cancelOpenShipment(tx: Db, orderId: string, now: Date): Promise<void> {
  const open = await tx
    .selectFrom('shipment_items as i')
    .innerJoin('shipments as s', 's.id', 'i.shipment_id')
    .select('s.id')
    .where('i.order_id', '=', orderId)
    .where('s.status', 'in', ['PACKING', 'PACKED'])
    .executeTakeFirst();
  if (!open) return;
  const shipment = await tx.selectFrom('shipments').select(['id', 'status', 'packing_started_at']).where('id', '=', open.id).forUpdate().executeTakeFirstOrThrow();
  if (shipment.status !== 'PACKING' && shipment.status !== 'PACKED') return;
  await tx.updateTable('shipment_items').set({ product_id: null, scan_event_id: null, scanned_at: null }).where('shipment_id', '=', shipment.id).where('order_id', '=', orderId).execute();
  const at = now < shipment.packing_started_at ? shipment.packing_started_at : now;
  await tx.updateTable('shipments').set({ status: 'CANCELLED', cancelled_at: at }).where('id', '=', shipment.id).execute();
}

/**
 * An order delivered (plan NEXT LOT §3.5.6.8): its parcel's shipment SHIPPED becomes DELIVERED once every order of the
 * parcel is (by the agent, by Client Services, or by a registration: `deliverOnRegistration`). Under the order's lock.
 */
async function settleShipmentDelivered(tx: Db, orderId: string, now: Date): Promise<void> {
  const shipped = await tx
    .selectFrom('shipment_items as i')
    .innerJoin('shipments as s', 's.id', 'i.shipment_id')
    .select('s.id')
    .where('i.order_id', '=', orderId)
    .where('s.status', '=', 'SHIPPED')
    .executeTakeFirst();
  if (!shipped) return;
  const pending = await tx
    .selectFrom('shipment_items as i')
    .innerJoin('orders as o', 'o.id', 'i.order_id')
    .select('o.id')
    .where('i.shipment_id', '=', shipped.id)
    .where('o.status', '=', 'SHIPPED')
    .where('o.id', '<>', orderId)
    .executeTakeFirst();
  if (pending) return;
  const s = await tx.selectFrom('shipments').select(['status', 'shipped_at']).where('id', '=', shipped.id).forUpdate().executeTakeFirstOrThrow();
  if (s.status !== 'SHIPPED') return;
  await tx.updateTable('shipments').set({ status: 'DELIVERED', delivered_at: s.shipped_at && now < s.shipped_at ? s.shipped_at : now }).where('id', '=', shipped.id).execute();
}

/**
 * Give back what an order holds: a piece in stock is released (under the SKU's lock) and serves the next order waiting
 * for it there (`serveWaiting`: the owner's « puts the piece back in stock automatically, where it serves the next
 * waiting order »); an order waiting for stock stops waiting. The audit entries of the orders served are added to
 * `notes`.
 */
export async function release(tx: Db, o: OrderRow, actor: Actor, now: Date, notes: AuditRecordInput[], also: OrderUpdate = {}): Promise<OrderRow> {
  // Its parcel being packed (plan NEXT LOT §3.5.6.7): the shipment is cancelled and this order's piece unbound from it;
  // the other orders of the parcel keep their pieces and their packing start, and Start packing opens a new shipment.
  await cancelOpenShipment(tx, o.id, now);
  if (o.reservation === null) return o;
  // `also` (a cancellation's status) in the same write: a VAULT order at 0 holds its unit while RESERVED (orders_vault).
  if (o.reservation === 'AWAITING') return updateOrder(tx, o.id, { reservation: null, ...also });
  await lockSku(tx, o.sku_id!);
  const after = await updateOrder(tx, o.id, { reservation: null, ...also });
  notes.push(...(await serveWaiting(tx, o.sku_id!, o.location_id, actor, now)));
  return after;
}

/**
 * Serve the orders waiting for supplier stock of a SKU at a location (plan NEXT LOT §3.5.6.7), in the caller's
 * transaction: while a piece is available there, the waiting order first in line takes it (STOCK) — a reshipment after
 * a parcel lost or damaged first (`queue_first`), then strictly the oldest (`reserved_at`, then the id), whatever its
 * channel. Lock order: the caller's order rows, then the SKU (`lockSku`), then the waiting orders' rows FOR UPDATE in
 * queue order. Each order served gets its event and journal entry `order.serve` with `reservation: STOCK` (so its
 * readiness reads it, services/fulfilment.ts readySince) and its audit entry, by the system, returned for the caller to
 * write last. Called after every increase of what is available: a count corrected up, a transfer in, a cancellation, a
 * location change away, a size changed, a return to stock.
 */
export async function serveWaiting(tx: Db, skuId: string, locationId: string, _actor: Actor, now: Date): Promise<AuditRecordInput[]> {
  await lockSku(tx, skuId);
  const level = await stockLevel(tx, skuId, locationId);
  if (level.available < 1) return [];
  const waiting = await tx
    .selectFrom('orders')
    .selectAll()
    .where('sku_id', '=', skuId)
    .where('location_id', '=', locationId)
    .where('reservation', '=', 'AWAITING')
    .orderBy('queue_first', 'desc')
    .orderBy('reserved_at')
    .orderBy('id')
    .limit(level.available)
    .forUpdate()
    .execute();
  const notes: AuditRecordInput[] = [];
  for (const o of waiting) {
    const after = await updateOrder(tx, o.id, { reservation: 'STOCK' });
    notes.push(await recordChange(tx, o, after, 'order.serve', { details: { reservation: 'STOCK', skuId, locationId, ...(o.queue_first ? { queueFirst: true } : {}) } }, SYSTEM_ACTOR, now));
  }
  return notes;
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
  /** Plan NEXT LOT §3.5.6.7: an EXCHANGE order's original. */
  exchangeOfOrderId?: string;
  /** Macro scope K44 T2 (plan MACRO M3 §5.2): the set sale this order is a piece of, and that piece (services/set-sales.ts). */
  setSaleId?: string;
  setPiece?: number;
  /** THE VAULT (lot Q3, §2.4): a VAULT order's vault; won free, its end to be claimed and the unit reserved at once (STOCK). */
  vaultId?: string;
  claimBy?: Date;
  reservation?: 'STOCK';
}

/**
 * Create an order RESERVED, take what it holds (unless `hold` is false), and record its creation: its RESERVED step,
 * in its history too, at the time of the sale. Exported for the set sale's core (services/set-sales.ts), whose orders
 * are created as any.
 */
export async function createOrder(tx: Db, n: NewOrder, opts: { hold: boolean }, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<OrderRow> {
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
      exchange_of_order_id: n.exchangeOfOrderId ?? null,
      set_sale_id: n.setSaleId ?? null,
      set_piece: n.setSaleId ? (n.setPiece ?? null) : null,
      // THE VAULT (lot Q3): only on a VAULT order (the other channels' rows are written as before).
      ...(n.vaultId ? { vault_id: n.vaultId, claim_by: n.claimBy ?? null } : {}),
      ...(n.reservation ? { reservation: n.reservation } : {}),
      shipping_service: n.shipping?.service ?? null,
      shipping_minor: n.shipping?.service ? n.shipping.minor : null,
      shipping_benefit: n.shipping?.service ? n.shipping.benefit : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  // Plan NEXT LOT §3.6.B: an order of its own (not a welcome gift, not travelling with another, not a size exchange,
  // which takes its original's) takes the account's default address at its creation, the collector's.
  if (n.channel !== 'GIFT' && n.channel !== 'EXCHANGE' && o.with_order_id === null) {
    const saved = await defaultAddress(tx, o.account_id);
    if (saved) {
      o = await updateOrder(tx, o.id, { buyer_name: saved.name, buyer_address: saved.address, buyer_country: saved.country, buyer_phone: saved.phone, address_by: 'COLLECTOR', address_at: o.reserved_at });
    }
  }
  const holdNotes: AuditRecordInput[] = [];
  if (opts.hold) o = await hold(tx, o, actor, now, holdNotes);
  const source: JsonObject = n.liveEntryId
    ? { liveEntryId: n.liveEntryId, piece: o.piece }
    : n.dropEntryId
      ? { dropEntryId: n.dropEntryId }
      : n.giftGrantId
        ? { giftGrantId: n.giftGrantId }
        : n.exchangeOfOrderId
          ? { exchangeOfOrderId: n.exchangeOfOrderId }
          : n.vaultId
            ? { vaultId: n.vaultId }
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
          // Macro scope K44 T2: the set sale it is a piece of.
          ...(o.set_sale_id ? { setSaleId: o.set_sale_id, setPiece: o.set_piece } : {}),
          // Its delivery address, the account's default (never its words).
          ...(o.address_by ? { address: { by: 'collector', country: o.buyer_country } } : {}),
        },
        at: o.reserved_at,
      },
      actor,
      now,
    ),
    ...holdNotes,
  );
  return o;
}

/** The location a release's orders go to: its own, or the default. */
async function releaseLocation(tx: Db, stockLocationId: string | null): Promise<string> {
  return stockLocationId ?? (await defaultLocationId(tx));
}

/**
 * The orders of an entry of a LIVE RELEASE CONFIRMED, in the transaction that confirms it (the release's row and the
 * entry's held): one per piece of its quantity, each with the release's price and currency, one unit of each add-on
 * chosen with the hold (lot Q2, step Q2.4, N1: carryChoices; no snapshot written), and the release's surprise when it has one (an after-room's: its parent's, as its location), RESERVED at the
 * release's location and holding what it can (`hold` false: nothing, for a reservation cancelled
 * before its orders existed; `reservedAt`: the time of the sale, for one confirmed before its orders existed). Idempotent:
 * only the pieces without an order get one. Returns the orders created and the audit entries to write last.
 */
export async function ordersForLiveEntry(
  tx: Db,
  entryId: string,
  actor: Actor,
  now: Date,
  opts: { hold?: boolean; reservedAt?: Date } = {},
): Promise<{ orders: OrderRow[]; notes: AuditRecordInput[]; addonsLeftOut: LeftOutAddon[] }> {
  const e = await tx
    .selectFrom('live_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    // An after-room inherits its parent's location and surprise (services/after-room.ts).
    .leftJoin('drops as p', 'p.id', 'd.parent_drop_id')
    .innerJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select((eb) => [
      'e.id', 'e.account_id', 'e.quantity', 'e.status', 'd.id as drop_id', 'd.model_id', 'd.set_id', 'd.price_minor', 'd.currency', 's.id as size_id', 's.label', 's.sku_id',
      eb.fn.coalesce('p.stock_location_id', 'd.stock_location_id').as('stock_location_id'),
      eb.fn.coalesce('p.surprise_enabled', 'd.surprise_enabled').as('surprise_enabled'),
      eb.fn.coalesce('p.surprise_text', 'd.surprise_text').as('surprise_text'),
    ])
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  if (!e || e.status !== 'CONFIRMED') throw new Error(`ordersForLiveEntry: entry ${entryId} is not CONFIRMED`);
  // Macro scope K44 (plan MACRO M3 §5.2): a set's entry makes one set sale per set of its quantity.
  if (e.set_id !== null) return setOrdersForLiveEntry(tx, { ...e, set_id: e.set_id }, actor, now, opts);
  const existing = new Set((await tx.selectFrom('orders').select('piece').where('live_entry_id', '=', e.id).execute()).map((r) => r.piece));
  const notes: AuditRecordInput[] = [];
  const orders: OrderRow[] = [];
  if (existing.size >= e.quantity) return { orders, notes, addonsLeftOut: [] };
  let skuId = e.sku_id;
  if (skuId === null) {
    // The size was offered when the release was made (plan NEXT LOT §3.3): a size set aside since stays its own.
    skuId = (await offeredSku(tx, e.model_id!, e.label, { allowSetAside: true })).skuId;
    await tx.updateTable('drop_sizes').set({ sku_id: skuId }).where('id', '=', e.size_id).execute();
  }
  const locationId = await releaseLocation(tx, e.stock_location_id);
  // BP-19 T5: the account's grants, its tier read now.
  notes.push(...(await ensureGrants(tx, e.account_id, now)), ...(await giveTierVaults(tx, e.account_id, now)));
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
        modelId: e.model_id!,
        sizeLabel: sizeLabelOf(e.label),
        skuId,
        priceMinor: e.price_minor,
        currency: e.currency,
        // Lot Q2, step Q2.4 (D2, N15): no add-on snapshot; the add-ons chosen are units (carryChoices below).
        addons: [],
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
  // Plan MACRO M3 §4.2 (D2) and lot Q2, step Q2.4 (N1): the catalogue add-ons chosen at the hold, one unit on each
  // piece's order, in the release's currency, each unit held or left out (never blocking PAY); a reservation cancelled
  // before its orders existed takes none.
  let addonsLeftOut: LeftOutAddon[] = [];
  if (first && (opts.hold ?? true)) {
    const carried = await carryChoices(tx, [...orders].sort((a, b) => a.piece - b.piece), { liveEntryId: e.id }, houseCurrencyOf(e.currency), actor, now);
    notes.push(...carried.notes);
    addonsLeftOut = carried.leftOut;
    // THE VAULT (lot Q3, §2.4 ADDON): a free add-on won in a vault, on the sale's first order, after the add-ons bought.
    notes.push(...(await attachVaultAddons(tx, first, actor, now)).notes);
  }
  return { orders, notes, addonsLeftOut };
}

/**
 * The orders of an entry of a draw confirmed by Client Services, in the transaction that confirms it (the drop's row and
 * the entry's held): one per piece of the entry (`pieces`: 1, or a house's guarantee's, plan NEXT-NINE IN-01), RESERVED
 * at the drop's location, with the draw's price and currency when it has one (plan NOCTURNE, addition 5: instead of « to
 * be confirmed »), and (plan NEXT LOT §3.6.F) the size the entry chose with its SKU, held or waiting for stock at once, a
 * size set aside since staying its own; an entry of a draw without sizes has its size (and a price the draw does not
 * give) to be entered (`setTerms`) (`reservedAt`: the time of the sale, for an entry confirmed before its order existed). Following BP-19, the first carries the shipping and any
 * welcome gift; the others travel with it (its service, shipping 0). Idempotent (only the pieces without an order get
 * one; `order` is the first created, null when the entry has its orders).
 */
export async function orderForDrawEntry(
  tx: Db,
  entryId: string,
  actor: Actor,
  now: Date,
  opts: { reservedAt?: Date } = {},
): Promise<{ order: OrderRow | null; orders: OrderRow[]; notes: AuditRecordInput[]; addonsLeftOut: LeftOutAddon[] }> {
  const e = await tx
    .selectFrom('drop_entries as e')
    .innerJoin('drops as d', 'd.id', 'e.drop_id')
    .leftJoin('drop_sizes as s', 's.id', 'e.size_id')
    .select(['e.id', 'e.account_id', 'e.status', 'e.pieces', 'd.id as drop_id', 'd.model_id', 'd.set_id', 'd.stock_location_id', 'd.price_minor', 'd.currency', 'e.size_id', 's.label as size_label', 's.sku_id'])
    .where('e.id', '=', entryId)
    .executeTakeFirst();
  if (!e || e.status !== 'CONFIRMED') throw new Error(`orderForDrawEntry: entry ${entryId} is not CONFIRMED`);
  // Macro scope K44 (plan MACRO M3 §5.2): a set's entry makes its set sale, one order per piece.
  if (e.set_id !== null) return setOrderForDrawEntry(tx, { ...e, set_id: e.set_id }, actor, now, opts);
  // Plan NEXT LOT §3.6.F: the entry's size and its SKU (offered when the draw was made: a size set aside since stays its own).
  let sized: { label: string | null; skuId: string } | null = null;
  if (e.size_id !== null && e.size_label !== null && e.size_label !== undefined) {
    let skuId = e.sku_id ?? null;
    if (skuId === null) {
      skuId = (await offeredSku(tx, e.model_id!, e.size_label, { allowSetAside: true })).skuId;
      await tx.updateTable('drop_sizes').set({ sku_id: skuId }).where('id', '=', e.size_id).execute();
    }
    sized = { label: sizeLabelOf(e.size_label), skuId };
  }
  // The draw's price, both or neither (drops_draw_price), within an order's bounds.
  const priced = e.price_minor !== null && e.currency !== null && e.price_minor <= ORDER_AMOUNT_MAX_MINOR;
  const existing = new Set((await tx.selectFrom('orders').select('piece').where('drop_entry_id', '=', e.id).execute()).map((r) => r.piece));
  const pieces = Math.max(1, Number(e.pieces) || 1);
  if (existing.size >= pieces) return { order: null, orders: [], notes: [], addonsLeftOut: [] };
  const notes: AuditRecordInput[] = [...(await ensureGrants(tx, e.account_id, now)), ...(await giveTierVaults(tx, e.account_id, now))];
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
        modelId: e.model_id!,
        sizeLabel: sized?.label ?? null,
        skuId: sized?.skuId ?? null,
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
  // Plan MACRO M3 §4.2 (D2): the add-ons chosen on the place held, on the first order, in the draw's currency.
  let addonsLeftOut: LeftOutAddon[] = [];
  if (first) {
    const carried = await carryChoices(tx, [first], { dropEntryId: e.id }, priced ? houseCurrencyOf(e.currency) : null, actor, now);
    notes.push(...carried.notes);
    addonsLeftOut = carried.leftOut;
    // THE VAULT (lot Q3, §2.4 ADDON): a free add-on won in a vault, on the sale's first order, after the add-ons bought.
    notes.push(...(await attachVaultAddons(tx, first, actor, now)).notes);
  }
  return { order: orders[0] ?? null, orders, notes, addonsLeftOut };
}

/**
 * A set's LIVE entry CONFIRMED (macro scope K44 T1, T2, T4; plan MACRO M3 §5.2): one set sale per set of its quantity
 * (services/set-sales.ts `ordersForSetSale`), each set's orders its pieces in the sizes the entry chose
 * (`live_entry_sizes`), every order travelling with the entry's first (its shipping), the release's add-ons on each
 * set's first piece, the welcome gift and the catalogue add-ons chosen on the entry's first order. Idempotent: only the
 * sets without their orders get them (a set's pieces are its orders `(set - 1) × pieces + piece`).
 */
async function setOrdersForLiveEntry(
  tx: Db,
  e: {
    id: string;
    account_id: string;
    quantity: number;
    drop_id: string;
    set_id: string;
    price_minor: number | null;
    currency: string | null;
    stock_location_id: string | null;
    surprise_enabled: boolean | null;
    surprise_text: string | null;
  },
  actor: Actor,
  now: Date,
  opts: { hold?: boolean; reservedAt?: Date },
): Promise<{ orders: OrderRow[]; notes: AuditRecordInput[]; addonsLeftOut: LeftOutAddon[] }> {
  const sizes = await tx.selectFrom('live_entry_sizes').select(['piece', 'size_id']).where('entry_id', '=', e.id).orderBy('piece').execute();
  const pieces = Number((await tx.selectFrom('set_models').select((eb) => eb.fn.countAll<number>().as('n')).where('set_id', '=', e.set_id).executeTakeFirstOrThrow()).n);
  const existing = await tx.selectFrom('orders').selectAll().where('live_entry_id', '=', e.id).orderBy('piece').execute();
  const done = new Set(existing.map((o) => Math.ceil(o.piece / pieces)));
  const notes: AuditRecordInput[] = [];
  const orders: OrderRow[] = [];
  if (done.size >= e.quantity) return { orders, notes, addonsLeftOut: [] };
  const locationId = await releaseLocation(tx, e.stock_location_id);
  notes.push(...(await ensureGrants(tx, e.account_id, now)), ...(await giveTierVaults(tx, e.account_id, now)));
  let parent: OrderRow | null = existing.find((o) => o.piece === 1) ?? null;
  /** Each set's first piece's order, as created (lot Q2, step Q2.4, D25): what carries the set's add-ons. */
  const carriers: OrderRow[] = [];
  for (let set = 1; set <= e.quantity; set++) {
    if (done.has(set)) continue;
    const sold = await ordersForSetSale(
      tx,
      {
        setId: e.set_id,
        dropId: e.drop_id,
        accountId: e.account_id,
        source: { channel: 'LIVE', liveEntryId: e.id, set },
        sizes: sizes.map((z) => ({ piece: z.piece, sizeId: z.size_id })),
        priceMinor: e.price_minor,
        currency: e.currency,
        locationId,
        surprise: e.surprise_enabled === true ? e.surprise_text : null,
        parent,
        reservedAt: opts.reservedAt,
        hold: opts.hold ?? true,
      },
      actor,
      now,
    );
    orders.push(...sold.orders);
    notes.push(...sold.notes);
    carriers.push(sold.orders[0]!);
    if (parent === null) parent = sold.orders[0]!;
  }
  // BP-19 T5: the welcome gift, on the entry's first order. Plan MACRO M3 §4.2 (D2) and lot Q2, step Q2.4 (D25, N1): the
  // catalogue add-ons chosen, one unit per set, on each set's first piece's order (its words with its engraving unit).
  const first = orders.find((o) => o.piece === 1);
  if (first) notes.push(...(await attachGifts(tx, first, actor, now)).notes);
  let addonsLeftOut: LeftOutAddon[] = [];
  if (first && (opts.hold ?? true)) {
    const carried = await carryChoices(tx, carriers, { liveEntryId: e.id }, houseCurrencyOf(e.currency), actor, now);
    notes.push(...carried.notes);
    addonsLeftOut = carried.leftOut;
    // THE VAULT (lot Q3, §2.4 ADDON): a free add-on won in a vault, on the sale's first order, after the add-ons bought.
    notes.push(...(await attachVaultAddons(tx, first, actor, now)).notes);
  }
  return { orders, notes, addonsLeftOut };
}

/**
 * A set's draw entry confirmed (macro scope K44 T1, T2; plan MACRO M3 §5.2): its one set sale (services/set-sales.ts
 * `ordersForSetSale`) in the sizes it chose (`drop_entry_sizes`), the draw's price shared over its pieces when it has
 * one; the welcome gift and the add-ons chosen on its first order. A set's draw is never guaranteed, so an entry is one
 * set. Idempotent: an entry with its orders gets none.
 */
async function setOrderForDrawEntry(
  tx: Db,
  e: { id: string; account_id: string; drop_id: string; set_id: string; stock_location_id: string | null; price_minor: number | null; currency: string | null },
  actor: Actor,
  now: Date,
  opts: { reservedAt?: Date },
): Promise<{ order: OrderRow | null; orders: OrderRow[]; notes: AuditRecordInput[]; addonsLeftOut: LeftOutAddon[] }> {
  if (await tx.selectFrom('orders').select('id').where('drop_entry_id', '=', e.id).executeTakeFirst()) return { order: null, orders: [], notes: [], addonsLeftOut: [] };
  const sizes = await tx.selectFrom('drop_entry_sizes').select(['piece', 'size_id']).where('entry_id', '=', e.id).orderBy('piece').execute();
  const priced = e.price_minor !== null && e.currency !== null && e.price_minor <= ORDER_AMOUNT_MAX_MINOR;
  const notes: AuditRecordInput[] = [...(await ensureGrants(tx, e.account_id, now)), ...(await giveTierVaults(tx, e.account_id, now))];
  const sold = await ordersForSetSale(
    tx,
    {
      setId: e.set_id,
      dropId: e.drop_id,
      accountId: e.account_id,
      source: { channel: 'DRAW', dropEntryId: e.id },
      sizes: sizes.map((z) => ({ piece: z.piece, sizeId: z.size_id })),
      priceMinor: priced ? e.price_minor : null,
      currency: priced ? e.currency : null,
      locationId: await releaseLocation(tx, e.stock_location_id),
      reservedAt: opts.reservedAt,
    },
    actor,
    now,
  );
  notes.push(...sold.notes);
  const first = sold.orders[0]!;
  notes.push(...(await attachGifts(tx, first, actor, now)).notes);
  const carried = await carryChoices(tx, [first], { dropEntryId: e.id }, priced ? houseCurrencyOf(e.currency) : null, actor, now);
  notes.push(...carried.notes);
  // THE VAULT (lot Q3, §2.4 ADDON): a free add-on won in a vault, on the sale's first order, after the add-ons bought.
  notes.push(...(await attachVaultAddons(tx, first, actor, now)).notes);
  return { order: first, orders: sold.orders, notes, addonsLeftOut: carried.leftOut };
}

/**
 * The order of a request of the private salon closed as ACCEPTED, in the transaction that closes it (the request's row
 * held): RESERVED at the default location, with the size the collector asked and its SKU (AC-01; held then as any
 * order's), its price, currency (and size, when none was asked) to be entered (`setTerms`). Idempotent.
 */
export async function orderForShopRequest(tx: Db, requestId: string, actor: Actor, now: Date): Promise<{ order: OrderRow | null; notes: AuditRecordInput[]; addonsLeftOut: LeftOutAddon[] }> {
  const r = await tx.selectFrom('shop_requests').select(['id', 'account_id', 'model_id', 'status', 'outcome', 'size_label']).where('id', '=', requestId).executeTakeFirst();
  if (!r || r.status !== 'CLOSED' || r.outcome !== 'ACCEPTED') throw new Error(`orderForShopRequest: request ${requestId} is not ACCEPTED`);
  if (await tx.selectFrom('orders').select('id').where('shop_request_id', '=', r.id).executeTakeFirst()) return { order: null, notes: [], addonsLeftOut: [] };
  const notes: AuditRecordInput[] = [...(await ensureGrants(tx, r.account_id, now)), ...(await giveTierVaults(tx, r.account_id, now))];
  // AC-01: the size the collector asked, with its SKU (held as any order's); none asked, entered later. Offered when it
  // was asked (plan NEXT LOT §3.3): a size set aside since stays its own. A typed model's order keeps the declared label
  // of the SKU it resolves to (SIZE 52 asked where 52 is declared too: 52), so the order and its SKU name one size.
  const sized = r.size_label === null ? null : await offeredSku(tx, r.model_id, r.size_label, { allowSetAside: true });
  const order = await createOrder(
    tx,
    {
      channel: 'SALON',
      shopRequestId: r.id,
      dropId: null,
      accountId: r.account_id,
      modelId: r.model_id,
      sizeLabel: sized === null ? null : sized.typed ? sized.label : r.size_label,
      skuId: sized?.skuId ?? null,
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
  // Plan MACRO M3 §4.2 (D2): the add-ons chosen with the request, in the currency of the model's base price (the one the
  // collector read them in); Client Services then enters the piece's price in that currency (setTerms).
  const carried = await carryChoices(tx, [order], { shopRequestId: r.id }, await baseCurrency(tx, r.model_id), actor, now);
  notes.push(...carried.notes);
  // THE VAULT (lot Q3, §2.4 ADDON): a free add-on won in a vault, on the sale's first order, after the add-ons bought.
  notes.push(...(await attachVaultAddons(tx, order, actor, now)).notes);
  return { order, notes, addonsLeftOut: carried.leftOut };
}

/** A house currency, or null (an amount in another currency offers no add-on). */
const houseCurrencyOf = (c: string | null | undefined): HouseCurrency | null => (typeof c === 'string' && (ORDER_CURRENCIES as readonly string[]).includes(c) ? (c as HouseCurrency) : null);

/**
 * The currency of a model's base price (a variant's own, else its main model's), as a house currency; null without one.
 * The salon's add-ons are offered and priced in it (plan MACRO M3 §4.4).
 */
export async function baseCurrency(db: Db, modelId: string): Promise<HouseCurrency | null> {
  const m = await db
    .selectFrom('models as m')
    .leftJoin('models as mm', 'mm.id', 'm.variant_of')
    .select(['m.base_price_minor', 'm.base_currency', 'mm.base_price_minor as main_minor', 'mm.base_currency as main_currency'])
    .where('m.id', '=', modelId)
    .executeTakeFirst();
  if (!m) return null;
  return houseCurrencyOf(m.base_price_minor !== null ? m.base_currency : m.main_minor !== null ? m.main_currency : null);
}

/**
 * Whether an order's size was chosen by its collector (plan NEXT LOT §3.6.F, §3.6.G): a DRAW order whose entry chose a
 * size (a draw with sizes), a SALON order whose request named one. NOT SURE YET (no size asked) leaves it to Client
 * Services, as a draw without sizes does.
 */
async function sizeChosen(tx: Db, o: Pick<OrderRow, 'channel' | 'drop_entry_id' | 'shop_request_id'>): Promise<boolean> {
  if (o.channel === 'DRAW' && o.drop_entry_id !== null) {
    const e = await tx.selectFrom('drop_entries').select('size_id').where('id', '=', o.drop_entry_id).executeTakeFirst();
    return (e?.size_id ?? null) !== null;
  }
  if (o.channel === 'SALON' && o.shop_request_id !== null) {
    const r = await tx.selectFrom('shop_requests').select('size_label').where('id', '=', o.shop_request_id).executeTakeFirst();
    return (r?.size_label ?? null) !== null;
  }
  return false;
}

/** What a step requires, checked before the transaction. */
export type CheckedStep =
  | { to: 'PAID'; note: string | null }
  | {
      to: 'SHIPPED';
      carrierId: string;
      trackingNumber: string;
      declaredValueMinor: number | null;
      note: string | null;
      /**
       * Plan NEXT LOT §3.5.6.7 (step 5.12): the parcel's shipment, PACKED, that this order ships in. Only the parcel's Ship
       * names it (LogisticsService.ship), never a request: a SHIPPED step without it answers 409 ORDER_NOT_PACKED.
       */
      shipmentId?: string;
    }
  | { to: 'DELIVERED'; note: string | null; details?: JsonObject }
  | {
      to: 'CANCELLED';
      note: string;
      /**
       * Plan NEXT LOT §3.4: the fresh hash of a code nobody sees, per piece (products.id) whose current claim code is its
       * buyer's new one (WAITING or READ), prepared before the transaction (`peekClaimRenewals`: scrypt never runs under
       * the locks); `withdrawOnCancel` writes it. Empty when none is given: such a piece then answers 409 ORDER_CHANGED.
       */
      claimHashes?: ReadonlyMap<string, string>;
    };

export function checkStep(input: OrderTransitionInput): CheckedStep {
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
function checkReturn(input: OrderReturnInput): { outcome: ReturnOutcome; locationId: string | null; note: string; addonsOut: string[] } {
  if (!input || typeof input !== 'object' || !(RETURN_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw validationError('A return goes back to stock (RESTOCKED) or to the archive (ARCHIVED).');
  }
  const locationId = input.outcome === 'RESTOCKED' ? input.locationId ?? null : null;
  if (input.outcome === 'RESTOCKED' && (typeof locationId !== 'string' || !UUID_RE.test(locationId))) throw notFound('Location', 'STOCK_LOCATION_NOT_FOUND');
  if (input.outcome === 'ARCHIVED' && input.locationId) throw validationError('A piece archived goes to no location.');
  const note = cleanText(input.note, ORDER_TEXT_LIMITS.note, 'The note', { multiline: true, required: true })!;
  const out = input.addonsOut ?? [];
  if (!Array.isArray(out) || out.length > 100 || out.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) throw validationError('Name the add-on units not to be sold again by their ids.');
  return { outcome: input.outcome, locationId: locationId?.toLowerCase() ?? null, note, addonsOut: out.map((x) => x.toLowerCase()) };
}

/**
 * What an order's step writes for its buyer (lot M1 step M1.17: the emails E4 and ORDER_CANCELLED, services/email-triggers.ts
 * EmailTriggers.orderStep), in the step's transaction, once the order has moved; null writes nothing (the boot's
 * backfill of sales made before the orders existed). Required by `step`, so that no path that moves an order forgets it.
 */
export type OrderMail = ((tx: Db, order: OrderRow, to: OrderStatus) => Promise<void>) | null;

/** Move a locked order one step (the step's own rules); returns the order after it. Its buyer's email through `mail`. */
export async function step(tx: Db, o: OrderRow, s: CheckedStep, actor: Actor, now: Date, notes: AuditRecordInput[], mail: OrderMail): Promise<OrderRow> {
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
      await assertPacked(tx, o, s.shipmentId);
      const carrier = await tx.selectFrom('carriers').select(['id', 'active']).where('id', '=', s.carrierId).executeTakeFirst();
      if (!carrier || !carrier.active) throw carrierUnknown();
      if (s.declaredValueMinor !== null && o.currency === null) throw validationError('Enter the order’s price and currency before declaring a value.');
      await lockSku(tx, o.sku_id!);
      await recordMovement(tx, { skuId: o.sku_id!, locationId: o.location_id, delta: -1, reason: 'SHIPPED', orderId: o.id, productId: o.product_id }, actor, now);
      // Plan MACRO M3 §4.2: its add-ons leave with it, one movement per unit.
      const addonUnits = await shipUnits(tx, o, actor, now);
      after = await updateOrder(tx, o.id, {
        status: 'SHIPPED',
        shipped_at: now,
        reservation: null,
        carrier_id: carrier.id,
        tracking_number: s.trackingNumber,
        declared_value_minor: s.declaredValueMinor,
      });
      // `reservation`: what it holds now (nothing), as every change that moves it says (fulfilment.ts readySince), so a
      // parcel reshipped after a problem is ready again from its decision, not from its first sale.
      details = { carrierId: carrier.id, reservation: null, ...(s.declaredValueMinor !== null ? { declaredValueMinor: s.declaredValueMinor } : {}), ...(addonUnits > 0 ? { addonUnits } : {}) };
      break;
    }
    case 'DELIVERED':
      after = await updateOrder(tx, o.id, { status: 'DELIVERED', delivered_at: now });
      details = s.details ?? {};
      await settleShipmentDelivered(tx, o.id, now);
      break;
    case 'CANCELLED': {
      const cancelled = { status: 'CANCELLED' as const, cancelled_at: now };
      const released = await release(tx, o, actor, now, extra, cancelled);
      after = released.status === 'CANCELLED' ? released : await updateOrder(tx, released.id, cancelled);
      // Plan MACRO M3 §4.2: its add-ons cancelled with it, the stock they held free again.
      const addonUnits = await cancelUnits(tx, after, now);
      details = { released: o.reservation, ...(addonUnits > 0 ? { addonUnits } : {}) };
      // Plan NEXT LOT §3.4: a buyer's new claim code withdrawn, and the piece given a code nobody sees.
      await withdrawOnCancel(tx, after, s.claimHashes ?? NO_CLAIM_HASHES, actor, now, extra);
      // BP-19 T5: the credit taken off it given back, its expiry unchanged.
      extra.push(...(await releaseCredit(tx, after, 'CANCELLED', actor, now)));
      break;
    }
  }
  notes.push(await recordChange(tx, o, after, ORDER_STEP_ACTIONS[s.to], { note: s.note, details }, actor, now), ...extra);
  // PAID issues the invoice; paid, then cancelled, a credit note cancels it, and any supplementary invoice, for what is
  // still invoiced (services/invoices.ts).
  const document = s.to === 'PAID' ? await issueInvoice(tx, after, actor, now) : null;
  if (document) notes.push(document);
  if (s.to === 'CANCELLED' && o.status === 'PAID') notes.push(...(await issueCreditNote(tx, after, 'cancel', actor, now)));
  // BP-19 T5: its welcome gift follows it: paid with it, cancelled with it (its grant then waits again).
  if (o.channel !== 'GIFT' && (s.to === 'PAID' || s.to === 'CANCELLED')) {
    for (const g of await openGifts(tx, o.id, { forUpdate: true })) {
      if (s.to === 'PAID' && g.status === 'RESERVED') await step(tx, g, { to: 'PAID', note: null }, actor, now, notes, mail);
      if (s.to === 'CANCELLED' && (g.status === 'RESERVED' || g.status === 'PAID')) await step(tx, g, { to: 'CANCELLED', note: 'Its order was cancelled.', claimHashes: s.claimHashes }, actor, now, notes, mail);
    }
  }
  if (mail) await mail(tx, after, s.to);
  return after;
}

/**
 * The SHIPPED gate (plan NEXT LOT §3.5.6.7, step 5.12): the order ships in its parcel's open shipment, named by the
 * parcel's Ship, PACKED, every item of it scanned, this order's item bound to the order's piece. Anything else (a SHIPPED
 * step from POST /api/admin/orders/:id/transition, a parcel not packed or not checked) answers 409 ORDER_NOT_PACKED: a
 * parcel ships whole, through Logistics (LogisticsService.ship).
 */
async function assertPacked(tx: Db, o: OrderRow, shipmentId: string | undefined): Promise<void> {
  if (shipmentId === undefined) throw orderNotPacked();
  const shipment = await tx.selectFrom('shipments').select(['id', 'status']).where('id', '=', shipmentId).executeTakeFirst();
  if (!shipment || shipment.status !== 'PACKED') throw orderNotPacked();
  const items = await tx.selectFrom('shipment_items').select(['order_id', 'product_id']).where('shipment_id', '=', shipment.id).execute();
  const mine = items.find((i) => i.order_id === o.id);
  if (!mine || mine.product_id !== o.product_id || items.some((i) => i.product_id === null)) throw orderNotPacked();
}

/**
 * DELIVERED by itself (Interconnection, the plan's decision): the buyer registers the piece linked to their order while
 * it is SHIPPED, in the transaction of the registration (the piece's row held), before its audit entries. Returns the
 * audit entries to write; none when no such order exists.
 */
export async function deliverOnRegistration(tx: Db, productUuid: string, accountId: string, actor: Actor, now: Date, mail: OrderMail): Promise<AuditRecordInput[]> {
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
  // Plan NEXT LOT §3.5.6.7: a parcel reported lost, damaged or back to sender, whose piece its buyer registers meanwhile,
  // arrived: its order case, not yet recorded back by the agent, is cancelled ('Registered by its buyer.'), never decided.
  await cancelParcelProblem(tx, o, now, notes);
  await step(tx, o, { to: 'DELIVERED', note: null, details: { by: 'registration' } }, actor, now, notes, mail);
  return notes;
}

/** The note of a parcel problem cancelled by its buyer's registration. */
export const REGISTERED_BY_BUYER = 'Registered by its buyer.';

/**
 * A parcel problem still OPEN on the shipment of a shipped order, cancelled by the system (the parcel arrived: its
 * buyer registered its piece); the shipment SHIPPED again. Audited `order.case.cancel` `{ caseId, kind, by: 'registration' }`.
 */
async function cancelParcelProblem(tx: Db, o: OrderRow, now: Date, notes: AuditRecordInput[]): Promise<void> {
  const open = await tx
    .selectFrom('order_cases as c')
    .innerJoin('shipment_items as i', 'i.shipment_id', 'c.shipment_id')
    .select(['c.id', 'c.order_id', 'c.kind', 'c.shipment_id', 'c.opened_at'])
    .where('i.order_id', '=', o.id)
    .where('c.status', '=', 'OPEN')
    .where('c.kind', 'in', ['BACK_TO_SENDER', 'LOST', 'DAMAGED'])
    .execute();
  for (const c of open) {
    const owner = c.order_id === o.id ? o : await lockOrder(tx, c.order_id);
    await tx.selectFrom('order_cases').select('id').where('id', '=', c.id).forUpdate().execute();
    await tx
      .updateTable('order_cases')
      .set({ status: 'CANCELLED', cancelled_at: now < c.opened_at ? c.opened_at : now, cancelled_by: null, cancel_note: REGISTERED_BY_BUYER })
      .where('id', '=', c.id)
      .execute();
    await tx.updateTable('shipments').set({ status: 'SHIPPED' }).where('id', '=', c.shipment_id!).where('status', '=', c.kind as 'BACK_TO_SENDER' | 'LOST' | 'DAMAGED').execute();
    notes.push(await recordChange(tx, owner, owner, 'order.case.cancel', { details: { caseId: c.id, kind: c.kind, by: 'registration' } }, SYSTEM_ACTOR, now));
  }
}

/**
 * Bind the piece that fulfils an order, in the caller's transaction, the order's row and its SKU locked, the piece
 * issued: the order RESERVED or PAID now holds that piece in stock at its location (`reservation` STOCK, `product_id`).
 * Its one way since the atelier went (plan NEXT LOT step 5.13): the packing scan of its card (`via` `scan`, §3.5.6.8;
 * the vias `bench` and `stock` of the atelier and of Link a piece are gone, their past entries kept). One event, one
 * journal entry and the audit entry returned for the caller to write last (`order.link`).
 */
export async function attachPiece(tx: Db, o: OrderRow, productUuid: string, via: 'scan', actor: Actor, now: Date): Promise<{ order: OrderRow; note: AuditRecordInput }> {
  if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
  if (o.product_id !== null) throw pieceLinked();
  const after = await updateOrder(tx, o.id, { product_id: productUuid, reservation: 'STOCK' });
  const note = await recordChange(tx, o, after, 'order.link', { details: { productId: productUuid, via, reservation: 'STOCK' } }, actor, now);
  return { order: after, note };
}

/**
 * The core of a return (choice 20; services/order-cases.ts decides a return or an exchange with it, plan NEXT LOT
 * §3.5.6.7), in the caller's transaction, the piece's row and the order's locked: as `OrderService.returnOrder` says,
 * the piece back to stock at a location with its new claim code (its hash prepared before the transaction), or to the
 * archive; the ownership taken back; the credit given back; the credit note; its parcel, shipped and never marked
 * delivered, DELIVERED once no order of it is still SHIPPED. `expected` is what the caller read before its transaction
 * (409 ORDER_RETURN_CHANGED when it changed); 409 CLAIM_OPEN while a warranty claim of the piece is live (plan ORBES
 * CARE §2(c)). Returns the order after it, the piece's reference, the credit given back
 * (`credit`, which an exchange carries onto its EXCHANGE order) and `finish`, the piece's change of status, which the
 * caller runs last (LifecycleService audits at once). From an order case (`caseId`), the note is ORBES's decision's,
 * which an AUDITOR never reads: the `order.return` event keeps no words (`caseId` and `noted` only), the return's row
 * and the case keep them.
 */
export async function returnInTransaction(
  tx: Db,
  o: OrderRow,
  r: { outcome: ReturnOutcome; locationId: string | null; note: string; caseId?: string; keepAddons?: boolean; addonsOut?: readonly string[]; keepVault?: boolean },
  expected: { productId: string | null; reclaim: boolean; claimHash: string | null },
  actor: Actor,
  now: Date,
  notes: AuditRecordInput[],
  lifecycle: LifecycleService,
): Promise<{ after: OrderRow; productId: string; credit: CarriedCredit[]; finish: () => Promise<void> }> {
  const claimHash = expected.claimHash;
  if (!isOrderTransitionAllowed(o.status, 'RETURNED')) throw stepNotAllowed(o.status, 'RETURNED');
  if (o.product_id === null || o.sku_id === null) throw pieceNotLinked();
  if (o.product_id !== expected.productId) throw returnChanged();
  const locationId = r.outcome === 'RESTOCKED' ? await knownLocation(tx, r.locationId!) : null;
  if (locationId) await lockSku(tx, o.sku_id);
  const p = await tx.selectFrom('products').selectAll().where('id', '=', o.product_id).forUpdate().executeTakeFirstOrThrow();
  // A warranty claim live on the piece (services/warranty-claims.ts): its next steps would carry on for a former owner.
  const claim = await tx.selectFrom('warranty_claims').select('id').where('product_id', '=', p.id).where('status', 'in', [...WARRANTY_CLAIM_LIVE_STATUSES]).executeTakeFirst();
  if (claim) throw claimUnderWay();
  const owner = await tx.selectFrom('ownership').selectAll().where('product_id', '=', p.id).where('ended_at', 'is', null).forUpdate().executeTakeFirst();
  if ((owner !== undefined) !== expected.reclaim) throw returnChanged();
  // Plan NEXT LOT §3.4: a buyer's new claim code still waiting is withdrawn (RESTOCKED writes its own new code, shown
  // to staff; ARCHIVED retires the piece).
  const withdrawn = await withdrawWaiting(tx, p.id, 'ORDER_RETURNED', actor, now);
  // The piece's status once back: ready to be sold again (RESOLD; ISSUED if it never was), or retired.
  let to: ProductStatus | null;
  if (r.outcome === 'ARCHIVED') to = p.status === 'RETIRED' || p.status === 'REVOKED' ? null : 'RETIRED';
  else to = p.status === 'ISSUED' || p.status === 'RESOLD' ? null : 'RESOLD';
  if (to !== null && !isTransitionAllowed(p.status, to, await returnTargetOf(tx, p))) throw notRestockable(p.status);
  if (locationId) await recordMovement(tx, { skuId: o.sku_id, locationId, delta: 1, reason: 'RETURNED', orderId: o.id, productId: p.id, note: r.note }, actor, now);
  const extra: AuditRecordInput[] = [];
  // Back to stock, the piece serves the next order waiting for it there (plan NEXT LOT §3.5).
  if (locationId) extra.push(...(await serveWaiting(tx, o.sku_id, locationId, actor, now)));
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
  // Plan MACRO M3 §4.2: its add-ons come back with it (to stock at the return's location, else the order's, unless ORBES
  // marks one not to be sold again); a size exchange leaves them with the collector.
  const addons = await returnUnits(tx, after, { keep: r.keepAddons === true, locationId, out: new Set(r.addonsOut ?? []) }, actor, now);
  // Its parcel, shipped and never marked delivered, has reached the collector: once no order of it is still on its way,
  // DELIVERED, so it leaves the agent's On its way and its packing photo follows the delivered parcel's keeping.
  await settleShipmentDelivered(tx, o.id, now);
  const details: JsonObject = {
    outcome: r.outcome,
    ...(locationId ? { locationId } : {}),
    ownershipReclaimed: owner !== undefined,
    ...(claimHash ? { claimCodeReissued: true } : {}),
    ...(to ? { pieceStatus: to } : {}),
    ...(r.caseId ? { caseId: r.caseId, noted: true } : {}),
    ...(addons.returned > 0 ? { addonUnits: addons.returned, addonUnitsRestocked: addons.restocked } : {}),
  };
  notes.push(await recordChange(tx, o, after, ORDER_STEP_ACTIONS.RETURNED, { note: r.caseId ? null : r.note, details }, actor, now), ...extra, ...withdrawn);
  // THE VAULT (round 5, D5): a returned piece takes its unopened PIECE vault back; a size exchange keeps it.
  if (r.keepVault !== true) notes.push(...(await revokeReturnedPieceVaults(tx, p.id, now)));
  // BP-19 T5: the credit taken off it given back; its welcome gift stays as it is. A size exchange carries it onto its
  // EXCHANGE order (`createExchangeOrder`), from what is released here.
  const carried = (await openCreditUses(tx, after.id, { forUpdate: true })).map((u): CarriedCredit => ({ grantId: u.grant_id, kind: creditKind(u.kind), tier: creditTier(u), amountMinor: u.amount_minor }));
  notes.push(...(await releaseCredit(tx, after, 'RETURNED', actor, now)));
  notes.push(...(await issueCreditNote(tx, after, 'return', actor, now)));
  // The piece's status, which LifecycleService audits at once: left to the caller to run last (no row is locked after it).
  const finish = async () => {
    if (to !== null) {
      await lifecycle.applyForService(tx, p, to, { reason: `Order ${orderReference(o.id)} returned`, via: 'order.return', ...(owner ? { ownershipState: 'UNREGISTERED' as const } : {}) }, actor);
    }
  };
  return { after, productId: p.product_id, credit: carried, finish };
}

/** A returned order's credit, given back by its return, which its EXCHANGE order takes again (one per grant), the birthday and warranty credits' included. */
export interface CarriedCredit {
  grantId: string;
  kind: CreditKind;
  /** Null on a birthday, a warranty or a vault's credit. */
  tier: 2 | 3 | null;
  amountMinor: number;
}

/** A credit grant's kind as an order reads it: a tier's (CREDIT), the birthday credit (BIRTHDAY) or a warranty credit (WARRANTY). */
const creditKind = (kind: string): CreditKind => (kind === 'BIRTHDAY' || kind === 'WARRANTY' || kind === 'VAULT' ? kind : 'CREDIT');
/** A credit grant's tier as an order reads it: a tier's credit's only, none on a birthday or a warranty credit. */
const creditTier = (g: { kind: string; tier: number | null }): 2 | 3 | null => (g.kind !== 'CREDIT' || g.tier === null ? null : (g.tier as 2 | 3));

/**
 * The EXCHANGE order of a size exchange decided (plan NEXT LOT §3.5.6.7), in the caller's transaction, its original
 * RETURNED: the original's account, release, price, currency, add-ons, surprise, engraving (its words and price),
 * shipping and buyer (its delivery address), the new size, at the original's location; it holds a piece in stock or
 * waits like any order, and is PAID at once with its own invoice (SIZE EXCHANGE beneath the piece, ENGRAVING as the
 * original's invoice had it, which its return credits). `credit`, what the original's return gave
 * back (`returnInTransaction`), is taken off it again before PAID, so its invoice carries the original's CREDIT lines and
 * the balance does not grow. Audited `order.create` (EXCHANGE), `order.credit.apply` (with a credit), `order.pay` with
 * `invoice.issue`, and `order.exchange` on the original.
 */
export async function createExchangeOrder(
  tx: Db,
  original: OrderRow,
  sku: { id: string; label: string | null },
  actor: Actor,
  now: Date,
  notes: AuditRecordInput[],
  mail: OrderMail,
  credit: readonly CarriedCredit[] = [],
): Promise<OrderRow> {
  let o = await createOrder(
    tx,
    {
      channel: 'EXCHANGE',
      exchangeOfOrderId: original.id,
      // Macro scope K44 T3: a piece of a set exchanged joins the set sale in its piece's place.
      ...(original.set_sale_id ? { setSaleId: original.set_sale_id, setPiece: original.set_piece ?? undefined } : {}),
      dropId: original.drop_id,
      accountId: original.account_id,
      modelId: original.model_id,
      sizeLabel: sku.label,
      skuId: sku.id,
      priceMinor: original.price_minor,
      currency: original.currency,
      addons: original.addons,
      surprise: original.surprise,
      locationId: original.location_id,
      shipping: shippingOf(original),
    },
    { hold: true },
    actor,
    now,
    notes,
  );
  // The original's delivery address (plan NEXT LOT §3.6.B: where the first piece went, not the account's default),
  // entered by Client Services at its creation; its engraving, its words, author and price: the original's return credits
  // its ENGRAVING line with the rest, so the exchange's invoice bills it again as it bills the add-ons, and the two
  // documents net to nothing (an add-on's engraving has no price of its own: its ADDON line).
  const delivered = await addressOf(tx, original);
  const hasAddress = delivered.name !== null || delivered.address !== null || delivered.country !== null || delivered.phone !== null;
  if (original.engraving_text !== null || hasAddress) {
    o = await updateOrder(tx, o.id, {
      engraving_text: original.engraving_text,
      engraving_minor: original.engraving_minor,
      engraving_by: original.engraving_by,
      buyer_name: delivered.name,
      buyer_address: delivered.address,
      buyer_country: delivered.country,
      buyer_phone: delivered.phone,
      ...(hasAddress ? { address_by: 'STAFF' as const, address_at: o.reserved_at } : {}),
    });
  }
  if (credit.length) {
    // The credit the original's return gave back is taken off the exchange again, before PAID: its invoice carries the
    // same CREDIT lines, and the collector's balance ends as it was before the exchange. Audited `order.credit.apply`.
    const uses: JsonObject[] = [];
    for (const c of credit) {
      const row = await tx
        .insertInto('credit_uses')
        .values({ grant_id: c.grantId, order_id: o.id, amount_minor: c.amountMinor, applied_by: actor.type === 'admin' ? actor.id! : null, applied_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      uses.push({ useId: row.id, grantId: c.grantId, kind: c.kind, tier: c.tier, amountMinor: c.amountMinor });
    }
    const amountMinor = credit.reduce((n, c) => n + c.amountMinor, 0);
    notes.push(await recordChange(tx, o, o, 'order.credit.apply', { details: { amountMinor, currency: o.currency, uses, exchangeOfOrderId: original.id } }, actor, now));
  }
  const paid = await step(tx, o, { to: 'PAID', note: null }, actor, now, notes, mail);
  notes.push(await recordChange(tx, original, original, 'order.exchange', { details: { exchangeOrderId: paid.id, skuId: sku.id } }, actor, now));
  return paid;
}

/** The set sales of `saleIds` as YOUR ORDERS and the account's export read them: each its set's name, price and orders in order. */
export async function accountSets(db: Db, saleIds: readonly (string | null)[]): Promise<Map<string, Omit<AccountOrderSet, 'piece'>>> {
  const ids = [...new Set(saleIds.filter((x): x is string => x !== null))];
  const out = new Map<string, Omit<AccountOrderSet, 'piece'>>();
  if (ids.length === 0) return out;
  const sales = await db.selectFrom('set_sales as s').innerJoin('sets as t', 't.id', 's.set_id').select(['s.id', 't.name', 's.price_minor', 's.currency']).where('s.id', 'in', ids).execute();
  const orders = await db.selectFrom('orders').select(['id', 'set_sale_id']).where('set_sale_id', 'in', ids).orderBy('set_piece').orderBy('reserved_at').orderBy('id').execute();
  for (const x of sales) out.set(x.id, { saleId: x.id, name: x.name, priceMinor: x.price_minor, currency: x.currency, pieces: orders.filter((o) => o.set_sale_id === x.id).map((o) => o.id) });
  return out;
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
  const cases = rows.length ? await db.selectFrom('order_cases').selectAll().where('order_id', 'in', rows.map((r) => r.id)).orderBy('opened_at').orderBy('id').execute() : [];
  const addonItems = await exportedAddonItems(db, rows.map((r) => r.id));
  const sets = await accountSets(db, rows.map((r) => r.set_sale_id));
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
    addonItems: addonItems.get(r.id) ?? [],
    ...(r.set_sale_id !== null && sets.has(r.set_sale_id)
      ? (() => {
          const x = sets.get(r.set_sale_id)!;
          return { set: { name: x.name, piece: r.set_piece!, salePriceMinor: x.priceMinor, saleCurrency: x.currency, saleOrders: x.pieces.map(orderReference) } };
        })()
      : {}),
    shipping: shippingOf(r),
    engravingText: r.engraving_text,
    buyer: { name: r.buyer_name, address: r.buyer_address, country: r.buyer_country, phone: r.buyer_phone },
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
    cases: cases
      .filter((c) => c.order_id === r.id)
      .map((c) => ({
        kind: c.kind,
        openedBy: c.opened_by_type === 'account' ? ('YOU' as const) : ('ORBES_CLIENT_SERVICES' as const),
        openedAt: c.opened_at,
        reason: c.reason,
        note: c.opened_by_type === 'account' ? c.note : null,
        sizeLabel: c.exchange_size_label,
        status: c.status,
        receivedAt: c.received_at,
        closedAt: c.closed_at,
        outcome: c.outcome,
        cancelledAt: c.cancelled_at,
      })),
  }));
}

/**
 * IN PREPARATION's time (plan NEXT LOT §3.6.A, §1.1 (c)): the first moment the order was both paid and holding its piece
 * in the stock, the later of its payment and the change that made it hold the piece (its creation holding stock at once,
 * a waiting order served: `reservation` in each change's details, as fulfilment.ts readySince reads them); kept once
 * reached, whatever its status now; null when never reached (an order waiting for stock, one cancelled while waiting).
 */
export function preparingAt(paidAt: Date | null, events: readonly { at: Date; details: JsonObject }[]): Date | null {
  if (paidAt === null) return null;
  let holding: unknown = null;
  let since: Date | null = null;
  for (const e of events) {
    if (Object.prototype.hasOwnProperty.call(e.details, 'reservation')) {
      const r = e.details.reservation;
      if (r === 'STOCK' && holding !== 'STOCK') since = e.at;
      if (r !== 'STOCK') since = null;
      holding = r;
    }
    if (holding === 'STOCK' && since !== null && e.at.getTime() >= paidAt.getTime()) return since.getTime() > paidAt.getTime() ? since : paidAt;
  }
  return null;
}

/**
 * An order's delivery address and engraving as its collector reads them (AccountOrder `address`, `addressOf`,
 * `engraving`, `engravingOffer`, `editable`): `engraving` its unit (lot Q2, step Q2.5) when it carries one, `offer` the
 * engraving YOUR ORDERS offers in its currency now.
 */
function accountDelivery(
  o: Pick<OrderRow, 'status' | 'channel' | 'with_order_id' | 'packing_started_at' | 'currency' | 'addons' | 'engraving_text' | 'engraving_minor'>,
  a: OrderAddress,
  e: { unit: EngravingUnit | null; offer: OrdersEngraving | null },
): Pick<AccountOrder, 'address' | 'addressOf' | 'engraving' | 'engravingOffer' | 'editable'> {
  const open = ORDER_HOLDING_STATUSES.includes(o.status) && o.packing_started_at === null;
  const offer = engravingOfferOf(o, e.unit, e.offer);
  // Its words with the price its unit was sold at (lot Q2, step Q2.5), or, on an order of before, the price it took.
  const unit = o.channel === 'GIFT' || hasEngravingAddon(o.addons) ? null : e.unit;
  return {
    address: a.name !== null && a.address !== null ? { name: a.name, lines: a.address, country: a.country, phone: a.phone } : null,
    addressOf: a.travelsWith ? orderReference(a.travelsWith) : null,
    engraving: o.engraving_text !== null ? { text: o.engraving_text, priceMinor: unit ? unit.priceMinor : o.engraving_minor } : null,
    engravingOffer: offer,
    editable: { address: o.with_order_id === null && open, engraving: open && offer !== null },
  };
}

/**
 * The engraving an order may carry (plan NEXT LOT §3.6.C; lot Q2, step Q2.5, N3, N4, N5, N8): none on a welcome gift; an
 * order of before reads as it did, at 20 characters (its release's ENGRAVING add-on: included, no price; words with the
 * price they took); its engraving's unit: the price it was sold at, its add-on's most characters, included (its words
 * only, never removed by the collector) when bought with the order or while it has no words yet; otherwise the
 * engraving YOUR ORDERS offers in its currency now (its price and most characters); none without one.
 */
function engravingOfferOf(
  o: Pick<OrderRow, 'channel' | 'currency' | 'addons' | 'engraving_text' | 'engraving_minor'>,
  unit: EngravingUnit | null,
  offer: OrdersEngraving | null,
): AccountOrder['engravingOffer'] {
  if (o.channel === 'GIFT') return null;
  if (hasEngravingAddon(o.addons)) return { priceMinor: null, included: true, maxLength: ENGRAVING_COLLECTOR_MAX };
  if (unit) return { priceMinor: unit.priceMinor, included: unit.addedBy === 'PURCHASE' || o.engraving_text === null, maxLength: unit.textMax };
  if (o.engraving_text !== null) return { priceMinor: o.engraving_minor, included: false, maxLength: ENGRAVING_COLLECTOR_MAX };
  return offer === null || o.currency === null ? null : { priceMinor: offer.priceMinor, included: false, maxLength: offer.textMax };
}

/**
 * An engraving's price changing on an order already invoiced (plan NEXT LOT §3.6.C), in its transaction: added after
 * PAID at a price above 0, a supplementary invoice with its ENGRAVING line; removed after PAID, a credit note for that
 * line (a free one, one bought as an add-on, or a welcome gift's, issues no document). The invoice already issued never
 * changes.
 */
async function engravingDocuments(tx: Db, before: OrderRow, after: OrderRow, actor: Actor, now: Date): Promise<AuditRecordInput[]> {
  // A welcome gift has no invoice of its own (its line is on its parent's) and its engraving no price: no document.
  if (before.status !== 'PAID' || after.channel === 'GIFT') return [];
  const notes: AuditRecordInput[] = [];
  if (before.engraving_minor !== null && before.engraving_minor > 0 && after.engraving_minor === null) {
    const n = await issueLineCreditNote(tx, after, 'ENGRAVING', actor, now);
    if (n) notes.push(n);
  }
  if (after.engraving_minor !== null && after.engraving_minor > 0 && before.engraving_minor === null) {
    notes.push(await issueSupplementaryInvoice(tx, after, engravingLine(after.engraving_minor), actor, now));
  }
  return notes;
}

/** A collector's delivery address for an order, checked before the transaction (`setAddress`, THE VAULT's claim and right to buy). */
export interface CheckedOrderAddress {
  savedId: string | undefined;
  fresh: DeliveryAddress | null;
  save: boolean;
}

/** An address input checked: one of YOUR ADDRESSES by its id (404 ADDRESS_NOT_FOUND), or a new one (400), saved when asked. */
export function checkOrderAddress(input: OrderAddressInput): CheckedOrderAddress {
  if (!input || typeof input !== 'object') throw validationError('Enter the name and the address.');
  const savedId = 'addressId' in input ? input.addressId : undefined;
  if (savedId !== undefined && (typeof savedId !== 'string' || !UUID_RE.test(savedId))) throw addressNotFound();
  const fresh = savedId === undefined ? checkAddress((input as { address: unknown }).address) : null;
  const save = savedId === undefined && (input as { save?: unknown }).save === true;
  return { savedId, fresh, save };
}

/**
 * A collector's address written on a locked order of theirs (`setAddress`'s rule; the account's addresses locked by the
 * caller): saved to YOUR ADDRESSES when asked; the first address sets `address_at`, a later one `address_changed_at`; the
 * same address again changes nothing. Returns the order after it and the audit entries (`order.address` first).
 */
export async function writeOrderAddress(tx: Db, o: OrderRow, checked: CheckedOrderAddress, actor: Actor, now: Date): Promise<{ order: OrderRow; notes: AuditRecordInput[] }> {
  const notes: AuditRecordInput[] = [];
  let a: DeliveryAddress;
  if (checked.savedId !== undefined) {
    const row = await tx.selectFrom('account_addresses').select(['name', 'address', 'country', 'phone']).where('id', '=', checked.savedId.toLowerCase()).where('account_id', '=', o.account_id).executeTakeFirst();
    if (!row) throw addressNotFound();
    a = row;
  } else {
    a = checked.fresh!;
    if (checked.save) {
      const saved = await insertAddress(tx, o.account_id, a, false, actor, now);
      notes.push(saved.note, ...saved.vaulted);
    }
  }
  const same = o.buyer_name === a.name && o.buyer_address === a.address && o.buyer_country === a.country && o.buyer_phone === a.phone;
  if (same) return { order: o, notes };
  const changed = o.address_at !== null;
  const after = await updateOrder(tx, o.id, {
    buyer_name: a.name,
    buyer_address: a.address,
    buyer_country: a.country,
    buyer_phone: a.phone,
    address_by: 'COLLECTOR',
    address_at: o.address_at ?? now,
    address_changed_at: changed ? (now < o.address_at! ? o.address_at : now) : null,
  });
  notes.unshift(await recordChange(tx, o, after, 'order.address', { details: { by: 'collector', country: a.country, changed } }, actor, now));
  return { order: after, notes };
}

// ── Service ────────────────────────────────────────────────────────────────

export interface OrderServiceDeps {
  db: Db;
  audit: AuditService;
  /** The piece's status after a return (its own, by default). */
  lifecycle?: LifecycleService;
  clock?: Clock;
  log?: Logger;
  /** The buyer's emails at each step (lot M1 step M1.17, EmailTriggers.orderStep); none when not given. */
  mail?: OrderMail;
}

export class OrderService {
  private readonly db: Db;
  private readonly audit: AuditService;
  /** The buyer's emails at each step (`step`'s `mail`). */
  readonly mail: OrderMail;
  private readonly lifecycle: LifecycleService;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: OrderServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.lifecycle = deps.lifecycle ?? new LifecycleService({ db: deps.db, audit: deps.audit, clock: this.clock });
    this.log = deps.log ?? noopLogger;
    this.mail = deps.mail ?? null;
  }

  /** An order with its model, location, shipment and history (404 ORDER_NOT_FOUND). */
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
      .select(['m.name as model_name', 'm.variant_label as model_variant', 'l.name as location_name', 'd.title as release_title', 'c.name as carrier_name', 'c.tracking_url', 'p.product_id as piece_reference'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!r) throw orderNotFound();
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
    const delivery = await addressOf(this.db, r);
    // Lot Q2, step Q2.5: its engraving's unit, whose price the engraving's line reads.
    const engravingUnit = r.channel === 'GIFT' || hasEngravingAddon(r.addons) ? null : ((await engravingUnits(this.db, [id])).get(id) ?? null);
    const now = this.clock();
    const standing = await tierOf(this.db, r.account_id, now);
    const credit: OrderView['credit'] = {
      available: (await creditBalances(this.db, r.account_id))
        .filter((c) => usableAt(c, standing.tier) && c.balanceMinor > 0 && c.expiresAt.getTime() > now.getTime())
        .map((c) => ({ grantId: c.grantId, kind: c.kind, tier: c.tier, balanceMinor: c.balanceMinor, currency: c.currency, expiresAt: c.expiresAt })),
      applied: (
        await this.db
          .selectFrom('credit_uses as u')
          .innerJoin('tier_grants as t', 't.id', 'u.grant_id')
          .select(['u.id', 'u.grant_id', 'u.amount_minor', 'u.applied_at', 'u.released_at', 'u.released_reason', 't.kind', 't.tier'])
          .where('u.order_id', '=', id)
          .orderBy('u.applied_at')
          .orderBy('u.id')
          .execute()
      ).map((u) => ({
        id: u.id,
        grantId: u.grant_id,
        kind: creditKind(u.kind),
        tier: creditTier(u),
        amountMinor: u.amount_minor,
        appliedAt: u.applied_at,
        releasedAt: u.released_at,
        releasedReason: u.released_reason,
      })),
    };
    return {
      id: r.id,
      reference: orderReference(r.id),
      channel: r.channel,
      source: { liveEntryId: r.live_entry_id, piece: r.piece, dropEntryId: r.drop_entry_id, shopRequestId: r.shop_request_id },
      release: r.drop_id && r.release_title ? { id: r.drop_id, title: r.release_title } : null,
      accountId: r.account_id,
      model: { id: r.model_id, name: r.model_name, variant: r.model_variant },
      sizeLabel: r.size_label,
      skuId: r.sku_id,
      priceMinor: r.price_minor,
      currency: r.currency,
      addons: r.addons,
      surprise: r.surprise,
      engravingText: r.engraving_text,
      engravingMinor: engravingUnit ? engravingUnit.priceMinor : r.engraving_minor,
      engravingBy: r.engraving_by,
      buyer: { name: delivery.name, address: delivery.address, country: delivery.country, phone: delivery.phone },
      addressBy: delivery.by,
      addressAt: delivery.at,
      addressChangedAt: delivery.changedAt,
      status: r.status,
      reservedAt: r.reserved_at,
      paidAt: r.paid_at,
      shippedAt: r.shipped_at,
      deliveredAt: r.delivered_at,
      cancelledAt: r.cancelled_at,
      returnedAt: r.returned_at,
      location: { id: r.location_id, name: r.location_name },
      reservation: r.reservation,
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
      addonItems: await adminAddonUnits(this.db, id),
      set: await adminOrderSet(this.db, r.set_sale_id, r.set_piece),
    };
  }

  /**
   * The account's own orders as MY PIECES shows them (AccountOrder), the latest first (ACCOUNT_ORDERS_LIMIT), the pieces
   * of one sale in their order. Only the account's: the route passes its session's account, never an id it was sent.
   */
  async forAccount(accountId: string, opts: { orderId?: string } = {}): Promise<AccountOrder[]> {
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
        'o.model_id',
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
        'o.buyer_name',
        'o.buyer_address',
        'o.buyer_country',
        'o.buyer_phone',
        'o.address_by',
        'o.address_at',
        'o.address_changed_at',
        'o.packing_started_at',
        'o.engraving_text',
        'o.engraving_minor',
        'o.shopify_order_id',
        'o.location_id',
        'o.set_sale_id',
        'o.set_piece',
        'o.vault_id',
        'o.claim_by',
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
      .$if(opts.orderId !== undefined, (q) => q.where('o.id', '=', opts.orderId!))
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
    const claimCodes = await waitingClaimCodes(this.db, accountId.toLowerCase(), rows.map((r) => r.id));
    // Plan NEXT LOT §3.6.B: each order's delivery address, a travelling order's its parent's.
    const parentIds = [...new Set(rows.map((r) => r.with_order_id).filter((x): x is string => x !== null))];
    const parents = new Map(
      parentIds.length
        ? (
            await this.db
              .selectFrom('orders')
              .select(['id', 'with_order_id', 'buyer_name', 'buyer_address', 'buyer_country', 'buyer_phone', 'address_by', 'address_at', 'address_changed_at'])
              .where('id', 'in', parentIds)
              .execute()
          ).map((p) => [p.id, p])
        : [],
    );
    // Lot Q2, step Q2.5: each order's engraving unit, and the engraving YOUR ORDERS offers in each currency.
    const engravings = await engravingUnits(this.db, rows.map((r) => r.id));
    const engravingOffers = new Map<string, OrdersEngraving | null>();
    for (const c of new Set(rows.map((r) => r.currency).filter((c): c is NonNullable<typeof c> => c !== null))) engravingOffers.set(c, await ordersEngraving(this.db, c));
    const care = await this.accountCases(accountId.toLowerCase(), rows);
    // Plan MACRO M3 §4.2 (D2): each order's catalogue add-ons.
    const addonItems = await accountAddonItems(this.db, rows);
    // ADD AN ADD-ON only while one is available for the order now (§4.1, §4.4).
    const addonOpen = await accountAddonOpen(this.db, rows);
    const deliveryOf = (r: (typeof rows)[number]): OrderAddress => (r.with_order_id === null ? ownAddress(r) : ownAddress(parents.get(r.with_order_id)!, r.with_order_id));
    // Macro scope K44: each set sale's name, one price and orders, for its pieces' grouping.
    const sets = await accountSets(this.db, rows.map((r) => r.set_sale_id));
    // The order's own invoice and the credit note that cancels it; the others (plan NEXT LOT §3.6.C) listed apart.
    const mainOf = (orderId: string) => invoices.find((x) => x.order.id === orderId && x.kind === 'INVOICE' && x.supplements === null);
    const documentOf = (orderId: string, kind: InvoiceKind) => {
      const main = mainOf(orderId);
      const i = kind === 'INVOICE' ? main : main ? invoices.find((x) => x.kind === 'CREDIT_NOTE' && x.scope === 'FULL' && x.credits?.id === main.id) : undefined;
      return i ? { number: i.number, issuedAt: i.issuedAt } : null;
    };
    const othersOf = (orderId: string) => {
      const shown = [documentOf(orderId, 'INVOICE')?.number, documentOf(orderId, 'CREDIT_NOTE')?.number];
      return invoices.filter((x) => x.order.id === orderId && !shown.includes(x.number)).map((x) => ({ kind: x.kind, number: x.number, issuedAt: x.issuedAt }));
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
      addonItems: addonItems.get(r.id) ?? [],
      canAddAddons: addonOpen.has(r.id),
      shipping: r.shipping_service === null ? null : { ...shippingOf(r), withOrder: r.with_order_id ? orderReference(r.with_order_id) : null },
      withOrder: r.with_order_id ? orderReference(r.with_order_id) : null,
      set: r.set_sale_id !== null && sets.has(r.set_sale_id) ? { ...sets.get(r.set_sale_id)!, piece: r.set_piece! } : null,
      giftTier: r.gift_grant_id ? (giftTiers.get(r.gift_grant_id) === 3 ? 'PALLADIUM' : 'PLATINE') : null,
      vault: r.channel === 'VAULT' ? { free: r.price_minor === 0, claimBy: r.claim_by ?? null } : null,
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
        others: othersOf(r.id),
        careGuide: r.status !== 'CANCELLED' && r.status !== 'RETURNED',
        certificate: ORDER_CERTIFICATE_STATUSES.includes(r.status) && r.ownership_id !== null && r.piece_status !== null && !CERTIFICATE_ENDING_STATUSES.includes(r.piece_status),
        careConditions: true,
      },
      imageUrl: mediaUrl(r.model_image),
      claimCode: claimCodes.get(r.id) ?? null,
      ...accountDelivery(r, deliveryOf(r), { unit: engravings.get(r.id) ?? null, offer: r.currency === null ? null : (engravingOffers.get(r.currency) ?? null) }),
      ...care.get(r.id)!,
    }));
  }

  /**
   * Plan CUSTOMER INTELLIGENCE §3.7: the size YOUR SIZES preselects in EXCHANGE THE SIZE, among the order's other sizes in
   * stock (`sizesForExchange`: the order's own left out), by the model's kind and each size's fit (`savedSizeAmong`);
   * null when none or several match, or without a saved size of that kind.
   */
  private async savedExchangeSize(accountId: string, modelId: string, sizes: readonly { skuId: string; label: string | null; selectable: boolean }[]): Promise<{ label: string } | null> {
    const inStock = new Set(sizes.filter((x) => x.selectable && x.label !== null).map((x) => x.skuId));
    if (inStock.size === 0) return null;
    const candidates = (await modelSizeCandidates(this.db, modelId, { offered: true })).filter((c) => inStock.has(c.id));
    const saved = await savedSizeAmong(this.db, accountId, modelId, candidates);
    return saved ? { label: saved.label } : null;
  }

  /**
   * The steps and cases of the account's orders as MY PIECES reads them (plan NEXT LOT §3.6.A, §3.6.D): `preparingAt`,
   * `deliveryIssue`, `returnable` and `case`, per order.
   */
  private async accountCases(
    accountId: string,
    rows: readonly Pick<OrderRow, 'id' | 'channel' | 'status' | 'paid_at' | 'delivered_at' | 'sku_id' | 'model_id'>[],
  ): Promise<Map<string, Pick<AccountOrder, 'preparingAt' | 'deliveryIssue' | 'returnable' | 'case'>>> {
    const out = new Map<string, Pick<AccountOrder, 'preparingAt' | 'deliveryIssue' | 'returnable' | 'case'>>();
    if (rows.length === 0) return out;
    const ids = rows.map((r) => r.id);
    // What each held, in order: the changes that say it (`reservation`), each at its time.
    const events = await this.db.selectFrom('order_events').select(['order_id', 'created_at', 'details']).where('order_id', 'in', ids).orderBy('id').execute();
    const cases = await this.db.selectFrom('order_cases').selectAll().where('order_id', 'in', ids).orderBy('opened_at').orderBy('id').execute();
    // A parcel problem names its shipment: every order of the parcel reads it.
    const problems = await this.db
      .selectFrom('order_cases as c')
      .innerJoin('shipment_items as i', 'i.shipment_id', 'c.shipment_id')
      .select('i.order_id')
      .where('i.order_id', 'in', ids)
      .where('c.kind', 'in', ['BACK_TO_SENDER', 'LOST', 'DAMAGED'])
      .where('c.status', 'in', ['OPEN', 'RECEIVED'])
      .execute();
    const troubled = new Set(problems.map((p) => p.order_id));
    const locations = new Map(
      (await this.db.selectFrom('orders as o').innerJoin('stock_locations as l', 'l.id', 'o.location_id').select(['o.id', 'l.address']).where('o.id', 'in', ids).execute()).map((x) => [x.id, x.address]),
    );
    const now = this.clock();
    for (const r of rows) {
      const mine = cases.filter((c) => c.order_id === r.id);
      const open = mine.some((c) => c.status === 'OPEN' || c.status === 'RECEIVED');
      const last = [...mine].reverse().find((c) => c.kind === 'RETURN' || c.kind === 'EXCHANGE');
      let returnable: AccountOrder['returnable'] = null;
      if (r.status === 'DELIVERED' && r.channel !== 'GIFT' && r.delivered_at !== null && !open) {
        const until = new Date(r.delivered_at.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60_000);
        if (now.getTime() < until.getTime()) {
          const sizes = r.sku_id === null ? [] : await sizesForExchange(this.db, r.id);
          returnable = { until, sizes: sizes.filter((x) => x.label !== null).map((x) => ({ label: x.label!, available: x.selectable })), savedSize: await this.savedExchangeSize(accountId, r.model_id, sizes) };
        }
      }
      out.set(r.id, {
        preparingAt: preparingAt(r.paid_at, events.filter((e) => e.order_id === r.id).map((e) => ({ at: e.created_at, details: (e.details ?? {}) as JsonObject }))),
        deliveryIssue: troubled.has(r.id),
        returnable,
        case: last
          ? {
              kind: last.kind as 'RETURN' | 'EXCHANGE',
              status: last.status,
              openedAt: last.opened_at,
              receivedAt: last.received_at,
              sizeLabel: last.exchange_size_label,
              returnAddress: locations.get(r.id) ?? null,
              outcome: last.outcome,
              exchangeOrder: last.exchange_order_id ? { id: last.exchange_order_id, reference: orderReference(last.exchange_order_id) } : null,
            }
          : null,
      });
    }
    return out;
  }

  /** One of the account's own orders as MY PIECES shows it (404 ORDER_NOT_FOUND for any other). */
  async accountOrder(accountId: string, orderId: string): Promise<AccountOrder> {
    const id = knownOrderId(orderId);
    const [o] = await this.forAccount(accountId, { orderId: id });
    if (!o) throw orderNotFound();
    return o;
  }

  /**
   * The collector's delivery address on one of its orders (PUT /api/v1/account/orders/:id/address; plan NEXT LOT §3.6.B:
   * « enters it on the order and can change it until the agent starts packing; after that, only through Client
   * Services »): one of its saved addresses (404 ADDRESS_NOT_FOUND for another account's), or a new one, all four fields,
   * saved to YOUR ADDRESSES too when asked (409 ADDRESS_LIMIT at five). Its own order (404 ORDER_NOT_FOUND), not
   * travelling with another (409 ORDER_TRAVELS_WITH), RESERVED or PAID (409 ORDER_CLOSED), packing not started (409
   * ORDER_PACKING_STARTED); the account ACTIVE (403 ACCOUNT_LOCKED). The first address sets `address_at`; any later one
   * `address_changed_at` (the agent's ADDRESS CHANGED); the same address again changes nothing. Under the account's
   * lock, then the order's row. Event, journal and audit `order.address` `{ by: 'collector', country, changed }`, with the
   * account as actor, never the words (`account.address.create` too when saved).
   */
  async setAddress(accountId: string, orderId: string, input: OrderAddressInput, actor: Actor): Promise<AccountOrder> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const account = accountId.toLowerCase();
    const id = knownOrderId(orderId);
    const checked = checkOrderAddress(input);
    await inRetriedTransaction(this.db, async (tx) => {
      await lockAccountAddresses(tx, account);
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (!o) throw orderNotFound();
      if (o.with_order_id !== null) throw travelsWith(o.with_order_id);
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      if (o.packing_started_at !== null) throw packingStarted();
      const written = await writeOrderAddress(tx, o, checked, actor, this.clock());
      for (const n of written.notes) await this.audit.record(n, tx);
    });
    return this.accountOrder(account, id);
  }

  /**
   * The collector's engraving on one of its orders (PUT and DELETE /api/v1/account/orders/:id/engraving; plan NEXT LOT
   * §3.6.C: « with its price … until packing starts »), `text` null to remove it. Its own order (404 ORDER_NOT_FOUND),
   * not a welcome gift (409 ORDER_ENGRAVING_UNAVAILABLE), RESERVED or PAID (409 ORDER_CLOSED), packing not started (409
   * ORDER_PACKING_STARTED); the account ACTIVE (403 ACCOUNT_LOCKED). The words: 1 to its most characters of letters,
   * figures, spaces and . & ' ’ - (400): its engraving add-on's `textMax` (lot Q2, step Q2.5, N3), 20 on an order of
   * before. The engraving is one system (lot Q2, step Q2.5, D4, N4, N5, N8):
   *  - an order carrying the engraving's unit: its words only, no second price; a unit bought with the order (PURCHASE)
   *    is never removed here (409 ORDER_ENGRAVING_INCLUDED), any other is removed with its words (REMOVED; after PAID a
   *    credit note for its line);
   *  - any other order: new words add the engraving's unit (COLLECTOR) at the price of the engraving YOUR ORDERS offers
   *    in its currency, its switch alone deciding, whatever the order's release (409 ORDER_ENGRAVING_UNAVAILABLE
   *    without one); after PAID, its supplementary invoice;
   *  - an order of before reads as it did: its release's ENGRAVING add-on, its words only, never removed (409
   *    ORDER_ENGRAVING_INCLUDED); words with a Settings price (`engraving_minor`), changed at that price, removed with a
   *    credit note for its ENGRAVING line after PAID.
   * Its words changed, no document. The same words again change nothing. The account's lock, then the order's row.
   * Event and audit `order.engraving` `{ by: 'collector', priced, addon, removed? }`, never the words; a unit added or
   * removed also `order.addon.add` / `order.addon.remove`.
   */
  async setEngraving(accountId: string, orderId: string, text: string | null, actor: Actor): Promise<AccountOrder> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const account = accountId.toLowerCase();
    const id = knownOrderId(orderId);
    let words: string | null = null;
    if (text !== null) {
      if (typeof text !== 'string') throw engravingWords();
      words = text.replace(/\s+/g, ' ').trim();
      // The house's ceiling first; the engraving's own most characters once the order is read.
      if (!ENGRAVING_RE().test(words)) throw engravingWords();
    }
    await inRetriedTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', account).forShare().executeTakeFirst();
      if (!a) throw orderNotFound();
      if (a.status !== 'ACTIVE') throw customerAccountLocked();
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (!o) throw orderNotFound();
      if (o.channel === 'GIFT') throw engravingUnavailable();
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      if (o.packing_started_at !== null) throw packingStarted();
      const legacy = hasEngravingAddon(o.addons);
      const unit = legacy ? null : ((await engravingUnits(tx, [o.id])).get(o.id) ?? null);
      const by: AddonBy = { type: 'COLLECTOR', id: o.account_id, actor };
      const now = this.clock();
      let next: Pick<OrderRow, 'engraving_text' | 'engraving_minor' | 'engraving_by'>;
      // What its unit does: added at this price (COLLECTOR), or removed.
      let adding: OrdersEngraving | null = null;
      let removing = false;
      if (words === null) {
        if (legacy || unit?.addedBy === 'PURCHASE') throw engravingIncluded();
        if (o.engraving_text === null && unit === null) return;
        next = { engraving_text: null, engraving_minor: null, engraving_by: null };
        removing = unit !== null;
      } else if (o.engraving_text !== null || legacy || unit !== null) {
        // Its words change (or, with the add-on or its unit, are typed): the price stays as it is.
        if ([...words].length > (unit ? unit.textMax : ENGRAVING_COLLECTOR_MAX)) throw engravingWords(unit ? unit.textMax : ENGRAVING_COLLECTOR_MAX);
        if (o.engraving_text === words) return;
        next = { engraving_text: words, engraving_minor: legacy ? null : o.engraving_minor, engraving_by: 'COLLECTOR' };
      } else {
        adding = await ordersEngraving(tx, o.currency);
        if (adding === null) throw engravingUnavailable();
        if ([...words].length > adding.textMax) throw engravingWords(adding.textMax);
        next = { engraving_text: words, engraving_minor: null, engraving_by: 'COLLECTOR' };
      }
      // The words first, so that the unit's journal entry carries the order as it now stands.
      const after = await updateOrder(tx, o.id, next);
      const priced = adding ? adding.priceMinor : unit ? (removing ? null : unit.priceMinor) : after.engraving_minor;
      const notes: AuditRecordInput[] = [
        await recordChange(tx, o, after, 'order.engraving', { details: { by: 'collector', priced, addon: legacy || unit?.addedBy === 'PURCHASE', ...(words === null ? { removed: true } : {}) } }, actor, now),
        ...(adding ? await addEngravingUnit(tx, after, adding, by, now) : []),
        ...(removing ? await removeEngravingUnit(tx, after, unit!.unitId, by, now) : []),
        ...(await engravingDocuments(tx, o, after, actor, now)),
      ];
      for (const n of notes) await this.audit.record(n, tx);
    });
    return this.accountOrder(account, id);
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
   * The ORBES CARE conditions of an order, for its own account (plan ORBES CARE, answer 14): article 11 of the terms in
   * force, in English and in French, naming the order (render/care-conditions.ts), for every order whatever its status.
   * Drawn on each request, never stored; a read, not audited. 404 ORDER_NOT_FOUND for another account's order or an
   * unknown one.
   */
  async careConditions(accountId: string, orderId: string): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const id = knownOrderId(orderId);
    const r = await this.db.selectFrom('orders').select('id').where('id', '=', id).where('account_id', '=', accountId.toLowerCase()).executeTakeFirst();
    if (!r) throw orderNotFound();
    return renderCareConditionsPdf({ orderReference: orderReference(r.id) });
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
    let s = checkStep(input);
    // Plan NEXT LOT §3.4: a cancellation replaces a buyer's new claim code (WAITING or READ) on the order, its welcome
    // gifts and the orders travelling with it by a code nobody sees: its hashes made before the transaction, its pieces
    // locked first (the piece before the order, as returns and registrations).
    let first: ((tx: Db) => Promise<void>) | undefined;
    if (s.to === 'CANCELLED') {
      // Macro scope K44 (§15 note 12): a set's order is cancelled with its set's other orders, so their codes too. A size
      // exchange's EXCHANGE order, made once the set had shipped, is cancelled alone.
      const sale = await this.db.selectFrom('orders').select(['set_sale_id', 'channel']).where('id', '=', id).executeTakeFirst();
      const saleId = sale?.set_sale_id && sale.channel !== 'EXCHANGE' ? sale.set_sale_id : null;
      const set = saleId ? (await this.db.selectFrom('orders').select('id').where('set_sale_id', '=', saleId).where('channel', '<>', 'EXCHANGE').execute()).map((r) => r.id) : [];
      const ids = [...new Set([id, ...set])];
      const related = await this.db
        .selectFrom('orders')
        .select('id')
        .where((eb) => eb.or([eb('id', 'in', ids), eb('with_order_id', 'in', ids)]))
        .where('status', 'in', OPEN_STATUSES)
        .execute();
      const claimHashes = await peekClaimRenewals(this.db, related.map((r) => r.id));
      s = { ...s, claimHashes };
      // The pieces first, then the set's orders in the set's order (set_piece, reserved_at, id) before the order itself,
      // so two cancellations on different pieces of one set lock them in one order.
      if (claimHashes.size || saleId) {
        first = async (tx) => {
          if (claimHashes.size) await lockPieces(tx, claimHashes.keys());
          if (saleId) await lockSetSale(tx, saleId);
        };
      }
    }
    const checked = s;
    await this.change(
      id,
      async (tx, o, now, notes) => {
        // A welcome gift is paid with its order (BP-19 T5), never alone.
        if (o.channel === 'GIFT' && checked.to === 'PAID') throw stepNotAllowed(o.status, checked.to);
        // Macro scope K44 (plan MACRO M3 §5.1, §15 note 12): a set sold is cancelled whole, its other open orders in the
        // same transaction (each locked, in the set's order), refused once one of its pieces has shipped.
        if (checked.to === 'CANCELLED' && o.set_sale_id !== null && o.channel !== 'EXCHANGE') {
          const others = (await lockSetSale(tx, o.set_sale_id)).filter((x) => x.id !== o.id && x.channel !== 'EXCHANGE');
          if (o.shipped_at !== null || others.some((x) => x.shipped_at !== null)) throw setShipped();
          await step(tx, o, checked, actor, now, notes, this.mail);
          for (const x of others) if (x.status === 'RESERVED' || x.status === 'PAID') await step(tx, x, checked, actor, now, notes, this.mail);
          return;
        }
        await step(tx, o, checked, actor, now, notes, this.mail);
      },
      first,
    );
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
    await this.change(
      id,
      async (tx, o, now, notes) => {
        // Macro scope K44 T3: a set is returned whole, as a group of order cases (services/order-cases.ts).
        if (o.set_sale_id !== null) throw setReturnWhole();
        const done = await returnInTransaction(tx, o, r, { productId: peek.product_id, reclaim, claimHash }, actor, now, notes, this.lifecycle);
        // Last: the piece's status, which LifecycleService audits at once (the audit chain's lock: no row is locked after it).
        await done.finish();
        productId = done.productId;
      },
      pieceFirst,
    );
    return { order: await this.get(id), productId, ...(claimCode ? { claimCode } : {}) };
  }

  /**
   * Change where an order is served from (RESERVED or PAID; 409 ORDER_CLOSED after): what it holds moves with it, a
   * piece in stock released (serving the next order waiting for it) and taken again there, or the order waits there;
   * refused once a piece is linked to it (409 ORDER_PIECE_LINKED: the piece is transferred instead). A parcel ships
   * complete from one location (plan NEXT LOT §3.5.6.6), so the orders travelling together move together: every open
   * order of its parcel (its first order and the orders travelling with it) moves in the same transaction, refused while
   * any of them has a piece linked. Each order moved is audited `order.location`. A VAULT order at 0 moves only once
   * claimed (409 ORDER_VAULT_UNCLAIMED) and only where a unit of its size is (409 ORDER_VAULT_NO_UNIT).
   */
  async changeLocation(orderId: string, locationId: string, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    const to = await knownLocation(this.db, locationId);
    const peek = await this.db.selectFrom('orders').select('with_order_id').where('id', '=', id).executeTakeFirst();
    if (!peek) throw orderNotFound();
    const key = peek.with_order_id ?? id;
    // The parcel's rows first, in the order every parcel path locks them (its first order, then the oldest).
    const parcelFirst = async (tx: Db) => {
      await parcelOrders(tx, key, { forUpdate: true });
    };
    await this.change(
      id,
      async (tx, o, now, notes) => {
        if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
        const open = (await parcelOrders(tx, key)).filter((p) => ORDER_HOLDING_STATUSES.includes(p.status));
        if (open.some((p) => p.product_id !== null)) throw pieceLinked();
        // THE VAULT: a piece won free moves only once claimed, and only where a unit of its size is (below).
        if (open.some((p) => vaultFree(p) && p.status === 'RESERVED')) throw vaultUnclaimed();
        const moving = open.filter((p) => p.location_id !== to);
        if (moving.length === 0) throw validationError('The order is already served from there.');
        // What they hold is given back first, the orders waiting first, so a piece freed never serves an order of the
        // same parcel about to move; then each is held at its new location.
        const extra: AuditRecordInput[] = [];
        const released: OrderRow[] = [];
        for (const m of [...moving].sort((a, b) => Number(b.reservation === 'AWAITING') - Number(a.reservation === 'AWAITING'))) {
          const cur = await lockOrder(tx, m.id);
          released.push(cur.reservation !== null ? await release(tx, cur, actor, now, extra) : cur);
        }
        for (const m of moving) {
          const r = released.find((x) => x.id === m.id)!;
          if (vaultFree(r)) {
            await lockSku(tx, r.sku_id!);
            if ((await stockLevel(tx, r.sku_id!, to)).available < 1) throw vaultNoUnit();
          }
          // Plan MACRO M3 §4.2: its add-ons move with it, or the change is refused (ORDER_ADDON_NOT_AT_LOCATION).
          await moveUnits(tx, r, to);
          const after = await hold(tx, await updateOrder(tx, r.id, { location_id: to }), actor, now, extra);
          notes.push(
            await recordChange(
              tx,
              m,
              after,
              'order.location',
              { details: { fromLocationId: m.location_id, toLocationId: to, reservation: after.reservation, ...(m.id === o.id ? {} : { movedWith: o.id }) } },
              actor,
              now,
            ),
          );
        }
        notes.push(...extra);
      },
      parcelFirst,
    );
    return this.get(id);
  }

  /**
   * What Client Services enters on an order (RESERVED or PAID): a draw's or a salon's size (it then holds a piece of
   * that size, or waits for one; plan NEXT LOT §3.6.F and §3.6.G: never another size than the one its draw entry or its
   * salon request chose, 409 ORDER_SIZE_FIXED), price and currency (before PAID only; 409 ORDER_TERMS_FIXED for a LIVE
   * order, whose are its release's), and any order's engraving text. A size changes until a
   * piece is linked (409 ORDER_PIECE_LINKED). Audited `order.terms` with the fields changed, never the engraving text.
   *
   * Its shipping (plan NEXT-NINE, BP-19 T4), while RESERVED: a service with its fee, or null for both (no shipping); 409
   * ORDER_SHIPPING_FREE for a fee on the service its tier makes free (another service, express, is paid at the fee
   * entered), 409 ORDER_SHIPPING_WITH for an order travelling with another. The first price of an order without
   * shipping takes the optional rate of its currency; a rate it took follows a change of its currency (the new
   * currency's rate, or no shipping when none is set), while a fee entered by hand stays as entered, for Client Services
   * to enter again. The orders travelling with it follow (its service at 0). Audited
   * `order.shipping` (each order), the service, the fee and the free tier.
   *
   * THE VAULT (lot Q3): a VAULT order at 0 changes size or price only once claimed (409 ORDER_VAULT_UNCLAIMED), then a
   * size only to one with a unit at its location (409 ORDER_VAULT_NO_UNIT); a VAULT order's price is never set to 0 nor
   * cleared, nor changed from 0 (409 ORDER_VAULT_PRICE).
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
      if ((sizeChange || priceChange) && vaultFree(o) && o.status === 'RESERVED') throw vaultUnclaimed();
      if (priceChange && o.channel === 'VAULT' && (o.price_minor === 0 || price === null || price === 0)) throw vaultPrice();
      if (sizeChange && (await sizeChosen(tx, o))) throw sizeFixed();
      if (priceChange && o.channel === 'GIFT') throw giftTermsFixed();
      if (priceChange) {
        if (o.status !== 'RESERVED') throw conflict('ORDER_PAID', 'The price of an order paid no longer changes.');
        // BP-19 T5: a credit taken off it stays in its currency and within the piece's price.
        const credited = await openCreditUses(tx, o.id);
        if (credited.length > 0 && credited.some((u) => u.currency !== currency)) throw creditCurrency();
        if (credited.reduce((n, u) => n + u.amount_minor, 0) > (price ?? 0)) throw creditExceeds();
        // Plan MACRO M3 §4.2: its add-ons keep the currency they were added in (a salon's, its model's base currency).
        const held = await heldCurrency(tx, o.id);
        if (held !== null && currency !== null && currency !== held) throw addonCurrencyFixed(held);
        // Plan NEXT LOT §3.6.C: a currency changed on a RESERVED order: an engraving of before priced from the settings
        // takes the new currency's price (since lot Q2, step Q2.5, N4: the engraving YOUR ORDERS offers in it), or is
        // removed (with its event) when that currency has none, a currency cleared included; the add-on's (no price of
        // its own) is not touched, nor is an engraving's unit (its currency the units', above). Worked out first and
        // written with the price in one update, so the row never holds an engraving price without its currency (0039's
        // orders_engraving_price).
        const repriced = o.engraving_minor !== null && currency !== o.currency ? ((await ordersEngraving(tx, currency ?? null))?.priceMinor ?? null) : undefined;
        const engravingFields = repriced === undefined ? {} : repriced === null ? { engraving_text: null, engraving_minor: null, engraving_by: null } : { engraving_minor: repriced };
        after = await updateOrder(tx, o.id, { price_minor: price, currency, ...engravingFields });
        fields.push('price');
        // Its welcome gift takes 0 in its currency.
        for (const g of await openGifts(tx, o.id, { forUpdate: true })) {
          if (g.status !== 'RESERVED' || (g.price_minor === 0 && g.currency === currency)) continue;
          const priced = await updateOrder(tx, g.id, { price_minor: currency === null ? null : 0, currency });
          extra.push(await recordChange(tx, g, priced, 'order.terms', { details: { fields: ['price'], withOrderId: o.id } }, actor, now));
        }
        if (repriced !== undefined) {
          extra.push(await recordChange(tx, o, after, 'order.engraving', { details: { by: 'staff', priced: after.engraving_minor, addon: false, currency: true, ...(repriced === null ? { removed: true } : {}) } }, actor, now));
        }
      }
      if (engraving !== undefined && engraving !== after.engraving_text) {
        // Client Services' words (STAFF), the engraving one system (lot Q2, step Q2.5): an order carrying the engraving's
        // unit, or of before (its release's add-on, or words with a Settings price), has its words changed at its price;
        // new words on any other order add the engraving's unit (STAFF) at the price of the engraving YOUR ORDERS offers
        // in its currency, as the collector's would (none offered: the words alone, no price); words removed remove a
        // unit not bought with the order (a credit note after PAID). A unit added or removed only until the parcel is
        // packed (409 PACKING_PACKED). A welcome gift takes none: it has no price of its own (plan NEXT LOT §3.6.C), its
        // words only.
        const addon = hasEngravingAddon(after.addons);
        const gift = after.channel === 'GIFT';
        const unit = addon || gift ? null : ((await engravingUnits(tx, [o.id])).get(o.id) ?? null);
        const adding = engraving !== null && !addon && !gift && unit === null && after.engraving_text === null ? await ordersEngraving(tx, after.currency) : null;
        const removing = engraving === null && unit !== null && unit.addedBy !== 'PURCHASE';
        if (adding || removing) await assertEngravingNotPacked(tx, after);
        const minor = engraving === null || addon || gift || unit !== null || adding !== null ? null : after.engraving_minor;
        const before = after;
        after = await updateOrder(tx, o.id, { engraving_text: engraving, engraving_minor: minor, engraving_by: engraving === null ? null : 'STAFF' });
        fields.push('engraving');
        const by: AddonBy = { type: 'STAFF', id: actor.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null, actor };
        if (adding) extra.push(...(await addEngravingUnit(tx, after, adding, by, now)));
        if (removing) extra.push(...(await removeEngravingUnit(tx, after, unit.unitId, by, now)));
        extra.push(...(await engravingDocuments(tx, before, after, actor, now)));
      }
      if (sizeChange) {
        if (o.product_id !== null) throw pieceLinked();
        // Both SKUs locked first, in one order (two orders swapping sizes never wait for each other).
        for (const id of [...new Set([o.sku_id, skuId].filter((x): x is string => x !== null))].sort()) await lockSku(tx, id);
        const released = await release(tx, after, actor, now, extra);
        // THE VAULT: a piece won free, once claimed, changes only to a size with a unit to hold (never waiting).
        if (vaultFree(o) && (skuId === null || (await stockLevel(tx, skuId, o.location_id)).available < 1)) throw vaultNoUnit();
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
   * what is already taken off it, within the piece's price (409 ORDER_CREDIT_EXCEEDS). The birthday credit (plan CUSTOMER
   * INTELLIGENCE §3.5 SB.4) is one of them whatever the account's tier, a collector without a piece included, and is
   * taken first (it expires soonest); then a warranty credit (plan ORBES CARE), whatever the tier too; then PALLADIUM's
   * grant, then the earliest expiry, split over several when one does not cover it. The order's row, then the grants
   * FOR UPDATE: two at once never take more than the balance. Audited `order.credit.apply`.
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
      const grants = (await creditBalances(tx, o.account_id, { forUpdate: true })).filter((g) => usableAt(g, standing.tier) && g.expiresAt.getTime() > now.getTime() && g.balanceMinor > 0);
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
        uses.push({ useId: row.id, grantId: g.grantId, kind: g.kind, tier: g.tier, amountMinor: part });
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
   * The buyer's delivery address, entered by Client Services (decision 31; plan NEXT LOT §3.6.B): the name and the address
   * lines, and the country and the phone (null clears one; left out, it stays), while RESERVED or PAID, packing started
   * or not (409 ORDER_CLOSED once shipped or ended; a cancelled order whose travelling orders are still to ship keeps
   * their parcel's address, editable); never on an order travelling with another, whose address is its
   * parent's (409 ORDER_TRAVELS_WITH, a welcome gift included). A country is one of the house's list (400 'Choose a
   * country.'), a phone with its country code (400 'Enter a phone number with its country code.'). It is STAFF's from
   * then on (`address_by`); replacing an address entered before sets `address_changed_at` (ADDRESS CHANGED); clearing
   * every field clears who and when. Personal data: audited `order.buyer` with the fields changed and `changed`, never
   * their words.
   */
  async setBuyer(orderId: string, input: OrderBuyerInput, actor: Actor): Promise<OrderView> {
    assertOperator(actor);
    const id = knownOrderId(orderId);
    if (!input || typeof input !== 'object') throw validationError('Enter the buyer’s name and address.');
    const name = cleanText(input.name, ORDER_TEXT_LIMITS.buyerName, 'The name');
    const address = cleanText(input.address, ORDER_TEXT_LIMITS.buyerAddress, 'The address', { multiline: true });
    const country = input.country === undefined ? undefined : input.country === null || (typeof input.country === 'string' && input.country.trim() === '') ? null : checkCountry(input.country);
    const phone = input.phone === undefined ? undefined : input.phone === null || (typeof input.phone === 'string' && input.phone.trim() === '') ? null : checkPhone(input.phone);
    await this.change(id, async (tx, o, now, notes) => {
      if (o.with_order_id !== null) throw travelsWith(o.with_order_id);
      // A cancelled order whose travelling orders are still to ship keeps the address of their parcel (§3.5.6.6: it
      // still keys it), which Client Services may still correct.
      const keysOpenParcel =
        o.status === 'CANCELLED' &&
        (await tx.selectFrom('orders').select('id').where('with_order_id', '=', o.id).where('status', 'in', [...ORDER_HOLDING_STATUSES]).executeTakeFirst()) !== undefined;
      if (!ORDER_HOLDING_STATUSES.includes(o.status) && !keysOpenParcel) throw orderClosed();
      const next = { name, address, country: country === undefined ? o.buyer_country : country, phone: phone === undefined ? o.buyer_phone : phone };
      const fields = [
        ...(next.name !== o.buyer_name ? ['name'] : []),
        ...(next.address !== o.buyer_address ? ['address'] : []),
        ...(next.country !== o.buyer_country ? ['country'] : []),
        ...(next.phone !== o.buyer_phone ? ['phone'] : []),
      ];
      if (fields.length === 0) throw validationError('Nothing to change.');
      const cleared = next.name === null && next.address === null && next.country === null && next.phone === null;
      const changed = !cleared && o.address_at !== null;
      const after = await updateOrder(tx, o.id, {
        buyer_name: next.name,
        buyer_address: next.address,
        buyer_country: next.country,
        buyer_phone: next.phone,
        address_by: cleared ? null : 'STAFF',
        address_at: cleared ? null : (o.address_at ?? now),
        address_changed_at: cleared ? null : changed ? (now < o.address_at! ? o.address_at : now) : o.address_changed_at,
      });
      notes.push(await recordChange(tx, o, after, 'order.buyer', { details: { fields, cleared, changed, ...(next.country ? { country: next.country } : {}) } }, actor, now));
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
          // A sale of the past, written now: no email (null).
          if (entry.resolution === 'CONCLUDED') await step(tx, o, { to: 'PAID', note: entry.resolution_note }, SYSTEM_ACTOR, now, notes, null);
          // Its orders are new: none can hold a new claim code (plan NEXT LOT §3.4), so no hash is prepared.
          if (entry.resolution === 'CANCELLED') await step(tx, o, { to: 'CANCELLED', note: entry.resolution_note ?? 'Cancelled by ORBES Client Services.', claimHashes: NO_CLAIM_HASHES }, SYSTEM_ACTOR, now, notes, null);
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
    // A change may serve the orders waiting for a piece (a cancellation, a location or a size changed, a return): retried
    // on a deadlock or a serialization failure (plan NEXT LOT §3.5.6.7), from the start.
    await inRetriedTransaction(this.db, async (tx) => {
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
