/**
 * The orders in the console (plan LIVE RELEASE+: Clients › Orders, an order's page, its packing slip, the settings) —
 * pure helpers, no DOM.
 *
 *  - The words of the board: a channel, a step, why an order is late (M3) and since when, what it holds, the delays.
 *  - The board's filters read from the page's query, kept to the values the server takes.
 *  - What each role may do with an order now (OPERATOR: its steps, its location, its terms, its buyer; its shipping and
 *    its order cases are model/logistics.ts' and model/order-cases.ts', plan NEXT LOT §3.5.4.4), mirroring
 *    services/orders.ts so that nobody is offered a button that will answer 409 or 403.
 *  - The dialogs: the terms, the buyer, the delays, a location, a carrier: what the server would refuse before anything
 *    is sent, and what to send.
 *  - An order's documents (M7): its invoice and credit note, named.
 *  - The packing slip: the piece, its size, its add-ons, the engraving and the surprise; never a price.
 */
import { formatCount, formatDate, humanize } from '../format.js';
import { can } from './permissions.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import {
  ORDER_CHANNELS,
  ORDER_CURRENCIES,
  RETURN_OUTCOMES,
  type AdminRole,
  type InvoiceKind,
  type OrderAlertDelays,
  type OrderCard,
  type OrderBoardFilters,
  type OrderChannel,
  type OrderCurrency,
  type OrderDetail,
  type OrderLateRule,
  type OrderStatus,
  type OrderTermsChange,
  type OrderTransitionInput,
  type OrderView,
} from '../types.js';

/** The words Client Services enters, at most (services/orders.ts ORDER_TEXT_LIMITS; test/web/admin.orders.test.ts). */
export const ORDER_LIMITS = Object.freeze({ note: 500, buyerName: 200, buyerAddress: 1000, engraving: 120, size: 100 });
/** A price or a declared value, at most, in cents (services/orders.ts ORDER_AMOUNT_MAX_MINOR). */
export const ORDER_AMOUNT_MAX_MINOR = 100_000_000;
/** The delays' bounds (services/fulfilment.ts ORDER_ALERT_LIMITS). */
export const ALERT_LIMITS = Object.freeze({
  reservedDays: Object.freeze({ min: 1, max: 90 }),
  readyDays: Object.freeze({ min: 1, max: 90 }),
  shippedDays: Object.freeze({ min: 1, max: 90 }),
  unregisteredDays: Object.freeze({ min: 1, max: 365 }),
});
/** A location's and a carrier's name, a tracking link (services/stock.ts). */
export const LOGISTICS_LIMITS = Object.freeze({ locationName: 60, carrierName: 60, trackingUrl: 500 });
/** Where the tracking number goes in a carrier's link. */
export const TRACKING_PLACEHOLDER = '{tracking}';
/** A tracking number: 3 to 40 letters, digits, spaces and hyphens (services/orders.ts). */
export const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLDING: readonly OrderStatus[] = ['RESERVED', 'PAID'];

// ── Words ──────────────────────────────────────────────────────────────────

/** A channel as the console names it. */
export const CHANNEL_LABELS: Readonly<Record<OrderChannel, string>> = Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW', SALON: 'PRIVATE SALON', GIFT: 'Welcome gift', EXCHANGE: 'SIZE EXCHANGE' });

/** Why an order is late, as its mark says it (no figure: the display face sets it). */
export const LATE_LABELS: Readonly<Record<OrderLateRule, string>> = Object.freeze({
  RESERVED: 'LATE · NOT PAID',
  READY: 'LATE · NOT SHIPPED',
  SHIPPED: 'LATE · NOT DELIVERED',
  UNREGISTERED: 'LATE · NOT REGISTERED',
});

const days = (n: number) => `${formatCount(n)} ${n === 1 ? 'day' : 'days'}`;

/** Why an order is late, in a sentence, with its delay (M3). */
export function lateSentence(rule: OrderLateRule, d: OrderAlertDelays): string {
  switch (rule) {
    case 'RESERVED':
      return `Reserved for over ${days(d.reservedDays)}, not paid yet.`;
    case 'READY':
      return `Paid, its piece ready, and not shipped for over ${days(d.readyDays)}.`;
    case 'SHIPPED':
      return `Shipped over ${days(d.shippedDays)} ago, not delivered yet.`;
    case 'UNREGISTERED':
      return `Delivered over ${days(d.unregisteredDays)} ago, its piece not registered by its buyer.`;
  }
}

/** The delays in one line: `Reserved 2 days · paid and ready 3 days · shipped 10 days · delivered, not registered 30 days`. */
export function delaysLine(d: OrderAlertDelays): string {
  return `Reserved ${days(d.reservedDays)} · paid and ready ${days(d.readyDays)} · shipped ${days(d.shippedDays)} · delivered, not registered ${days(d.unregisteredDays)}`;
}

/** A time spent in a step: `3 d 4 h`, `5 h 12 min`, `12 min`, `under a minute`. */
export function durationText(since: string | Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(since).getTime());
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return h ? `${formatCount(d)} d ${h} h` : `${formatCount(d)} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return m > 0 ? `${m} min` : 'under a minute';
}

/** What an order holds or what fulfils it, in a few words (a card's line, an order's page). */
export function holdsLine(o: Pick<OrderCard, 'status' | 'reservation' | 'piece' | 'location' | 'sizeLabel'> & { skuKnown: boolean }): string {
  if (o.piece) return `Piece ${o.piece}`;
  if (!HOLDING.includes(o.status)) return '—';
  if (!o.skuKnown) return 'Size to enter';
  if (o.reservation === 'STOCK') return `In stock at ${o.location.name}`;
  if (o.reservation === 'AWAITING') return 'Awaiting stock';
  return '—';
}

/** The hold of an order whose piece is ready while its parcel waits for another order's (plan NEXT LOT §3.5.6.6). */
export const WAITING_FOR_PARCEL = 'Waiting for the rest of its parcel';

/** A card's holds line (its SKU known when it has a SKU code). */
export function cardHolds(c: OrderCard): string {
  if (c.waitingForParcel && !c.piece) return WAITING_FOR_PARCEL;
  return holdsLine({ ...c, skuKnown: c.skuCode !== null });
}

/** An order page's holds line. */
export function viewHolds(o: OrderView): string {
  return holdsLine({ status: o.status, reservation: o.reservation, piece: o.productId, location: o.location, sizeLabel: o.sizeLabel, skuKnown: o.skuId !== null });
}

/**
 * A size as the console reads it: the label, or ONE SIZE once the size is entered without one; before it is, `To enter`,
 * or `To be confirmed` for a welcome gift whose size Client Services chooses (BP-19 T5).
 */
export function sizeText(o: { sizeLabel: string | null; skuKnown: boolean; gift?: boolean }): string {
  if (o.sizeLabel) return o.sizeLabel;
  if (o.skuKnown) return 'ONE SIZE';
  return o.gift ? 'To be confirmed' : 'To enter';
}

/** A carrier's tracking link for a number (as services/orders.ts trackingLink). */
export function trackingLink(pattern: string, trackingNumber: string): string {
  return pattern.replace(TRACKING_PLACEHOLDER, encodeURIComponent(trackingNumber.replace(/\s+/g, '')));
}

/** An order's price with its add-ons, as its page says it; `To enter` before it is. */
export function priceLine(o: Pick<OrderView, 'priceMinor' | 'currency'>): string {
  return o.priceMinor === null || o.currency === null ? 'To enter' : formatMoney(o.priceMinor, o.currency);
}

const TIER_NAMES: Readonly<Record<2 | 3, string>> = Object.freeze({ 2: 'PLATINE', 3: 'PALLADIUM' });

/**
 * An order's shipping (plan NEXT-NINE, BP-19 T4): `Standard · free (PLATINE)`, `Express · free (PALLADIUM)`, `Standard ·
 * € 20`, `With OR-…` for an order travelling with another, or `None`.
 */
export function shippingLine(o: Pick<OrderView, 'shipping' | 'withOrder' | 'currency'>): string {
  const s = o.shipping;
  if (o.withOrder) return `With ${o.withOrder.reference}`;
  if (!s || s.service === null || s.minor === null) return 'None';
  const service = s.service === 'EXPRESS' ? 'Express' : 'Standard';
  if (s.benefit === 2 || s.benefit === 3) return `${service} · free (${TIER_NAMES[s.benefit]})`;
  return `${service} · ${o.currency ? formatMoney(s.minor, o.currency) : moneyField(s.minor)}`;
}

// ── The welcome gift and the credit (plan NEXT-NINE, BP-19 T5) ─────────────

/** A GIFT order's header line: `Welcome gift · PLATINE · travels with OR-…`; null for any other order. */
export function giftHeaderLine(o: Pick<OrderView, 'channel' | 'giftOf' | 'withOrder'>): string | null {
  if (o.channel !== 'GIFT' || !o.giftOf) return null;
  return `Welcome gift · ${TIER_NAMES[o.giftOf.tier]}${o.withOrder ? ` · travels with ${o.withOrder.reference}` : ''}`;
}

/** A welcome gift travelling with an order: `OR-… · MODEL · RESERVED` (its step), or `… · Size to choose`. */
export function giftLine(g: OrderView['gifts'][number]): string {
  return `${g.reference} · ${g.model} · ${giftSizeToChoose(g) ? 'Size to choose' : humanize(g.status)}`;
}

/**
 * The rows of the welcome gifts travelling with an order, one per gift: `Welcome gift`, or `Welcome gift · PLATINE` and
 * `Welcome gift · PALLADIUM` when it carries both tiers' gifts.
 */
export function giftRows(o: Pick<OrderView, 'gifts'>): { label: string; id: string; line: string }[] {
  const gifts = o.gifts ?? [];
  return gifts.map((g) => ({ label: gifts.length > 1 ? `Welcome gift · ${TIER_NAMES[g.tier]}` : 'Welcome gift', id: g.id, line: giftLine(g) }));
}

/** A welcome gift whose size is still to be chosen, while it is reserved. */
const giftSizeToChoose = (g: Pick<OrderView['gifts'][number], 'sizeToChoose' | 'status'>): boolean => g.sizeToChoose && g.status === 'RESERVED';

/** Whether any welcome gift travelling with the order waits for its size (its order is not paid before: BP-19 T5). */
export function giftsWaitForSize(o: Pick<OrderView, 'gifts'>): boolean {
  return (o.gifts ?? []).some(giftSizeToChoose);
}

/**
 * CHOOSE SIZE on a welcome gift's order (BP-19 T5): while its size may change (`terms.size`) and is still to be
 * confirmed among its model's sizes, which the server lists then.
 */
export function canChooseGiftSize(o: Pick<OrderView, 'channel' | 'skuId' | 'giftOf'>, a: OrderActions['terms']): boolean {
  return a.size && o.channel === 'GIFT' && o.skuId === null && (o.giftOf?.sizes.length ?? 0) > 0;
}

/** The terms a welcome gift's CHOOSE SIZE changes: its size only. */
export const GIFT_SIZE_TERMS: OrderActions['terms'] = Object.freeze({ size: true, price: false, engraving: false, shipping: false });

/** A GIFT order's sizes to choose from, with the pieces available: `52 · 2 available`, `One size · none available`. */
export function giftSizeOptions(o: Pick<OrderView, 'giftOf'>): { value: string; label: string }[] {
  return (o.giftOf?.sizes ?? []).map((s) => ({
    value: s.label ?? ONE_SIZE_VALUE,
    label: `${s.label ?? 'One size'} · ${s.available > 0 ? `${formatCount(s.available)} available` : 'none available'}`,
  }));
}

/**
 * AC-01: the collector's saved size on a GIFT order's Choose size, a hint only (`Saved size: 52 (YOUR SIZES)`); null
 * without one. It preselects nothing.
 */
export function giftSavedSizeHint(o: Pick<OrderView, 'giftOf'>): string | null {
  return o.giftOf?.savedSize ? `Saved size: ${o.giftOf.savedSize} (YOUR SIZES)` : null;
}

/** The value of the one-size choice in the gift's sizes (the server reads ONE SIZE as the model in one size). */
export const ONE_SIZE_VALUE = 'ONE SIZE';

/** The credit taken off the order now (its open uses), in its currency's minor units. */
export function creditTaken(o: Pick<OrderView, 'credit'>): number {
  return (o.credit?.applied ?? []).filter((u) => u.releasedAt === null).reduce((n, u) => n + u.amountMinor, 0);
}

/** The client's credit usable now: `PLATINE € 50 until 06 OCT 2027`, several joined by ` · `, or None. */
export function creditAvailableLine(o: Pick<OrderView, 'credit'>): string {
  const a = o.credit?.available ?? [];
  if (a.length === 0) return 'None';
  return a.map((c) => `${TIER_NAMES[c.tier]} ${formatMoney(c.balanceMinor, c.currency)} until ${formatDate(c.expiresAt)}`).join(' · ');
}

/** The credit taken off this order, per tier: `− € 50 (PLATINE)`, or None. */
export function creditAppliedLine(o: Pick<OrderView, 'credit' | 'currency'>): string {
  const open = (o.credit?.applied ?? []).filter((u) => u.releasedAt === null);
  if (open.length === 0 || !o.currency) return 'None';
  const byTier = new Map<2 | 3, number>();
  for (const u of open) byTier.set(u.tier, (byTier.get(u.tier) ?? 0) + u.amountMinor);
  return [...byTier.entries()]
    .sort((x, y) => y[0] - x[0])
    .map(([tier, minor]) => `\u2212 ${formatMoney(minor, o.currency!)} (${TIER_NAMES[tier]})`)
    .join(' · ');
}

/** The credit usable on this order: the balances in its currency, and what its price leaves (null before it is priced). */
export function creditRoom(o: Pick<OrderView, 'credit' | 'currency' | 'priceMinor'>): number {
  if (o.priceMinor === null || o.currency === null) return 0;
  const balance = (o.credit?.available ?? []).filter((c) => c.currency === o.currency).reduce((n, c) => n + c.balanceMinor, 0);
  return Math.max(0, Math.min(balance, o.priceMinor - creditTaken(o)));
}

/** APPLY CREDIT and REMOVE CREDIT: an OPERATOR's, on a RESERVED order other than a welcome gift. */
export function creditActions(o: OrderView, role: AdminRole | null | undefined): { apply: boolean; remove: boolean } {
  const ok = can(role, 'manageOrders') && o.status === 'RESERVED' && o.channel !== 'GIFT';
  return { apply: ok && creditRoom(o) > 0, remove: ok && creditTaken(o) > 0 };
}

/** APPLY CREDIT's amount, prefilled: the most the order takes (its balance, within the price). */
export function creditValue(o: OrderView): string {
  return moneyField(creditRoom(o));
}

/** What the server would refuse in APPLY CREDIT. */
export function creditProblem(o: OrderView, v: Record<string, string>): string | null {
  const minor = parseMoney(v.amount);
  if (minor === null || minor < 1) return 'The credit is an amount in units above 0: 50, or 50.50.';
  if (minor > creditRoom(o)) return `At most ${formatMoney(creditRoom(o), o.currency ?? 'EUR')}: the credit left in ${o.currency ?? 'its currency'}, within the piece’s price.`;
  return null;
}

/** An order's add-ons with their prices: `ENGRAVING € 150 · GIFT BOX € 0`, or None. */
export function addonsLine(o: Pick<OrderView, 'addons' | 'currency'>): string {
  if (o.addons.length === 0) return 'None';
  return o.addons.map((a) => (o.currency ? `${a.label} ${formatMoney(a.priceMinor, o.currency)}` : a.label)).join(' · ');
}

/** A document's kind as the console names it. */
export const DOCUMENT_LABELS: Readonly<Record<InvoiceKind, string>> = Object.freeze({ INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note' });

/** Where a returned piece went. */
export const RETURN_LABELS: Readonly<Record<(typeof RETURN_OUTCOMES)[number], string>> = Object.freeze({ RESTOCKED: 'Back to stock', ARCHIVED: 'To the archive' });

/** The event of an order's history in words. */
export const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'order.create': 'Reserved',
  'order.pay': 'Paid',
  'order.ship': 'Shipped',
  'order.deliver': 'Delivered',
  'order.cancel': 'Cancelled',
  'order.return': 'Returned',
  'order.location': 'Location changed',
  'order.terms': 'Terms entered',
  'order.buyer': 'Buyer entered',
  'order.link': 'Piece linked',
  'order.shipping': 'Shipping',
  'order.gift': 'Welcome gift added',
  'order.credit.apply': 'Credit applied',
  'order.credit.remove': 'Credit removed',
  'order.credit.release': 'Credit given back',
  // Plan NEXT LOT §3.5: the stock that serves it, the agent's packing, its order cases.
  'order.serve': 'Piece held in stock',
  'order.pack.start': 'Packing started',
  'order.pack.scan': 'Card scanned',
  'order.pack.photo': 'Photo added',
  'order.pack.check': 'Packed',
  'order.reship': 'To ship again',
  'order.exchange': 'Size exchange',
  'order.case.open': 'Request opened',
  'order.case.receive': 'Parcel back',
  'order.case.decide': 'Decided by ORBES',
  'order.case.cancel': 'Request cancelled',
});

/** Who made a change of an order: a console user by email, the collector, or ORBES itself. */
export function eventActor(e: OrderView['events'][number], actors: Record<string, string>): string {
  if (e.actor.type === 'admin') return (e.actor.id && actors[e.actor.id]) || 'A console user';
  if (e.actor.type === 'account') return 'The collector';
  return 'ORBES';
}

// ── The board's filters ────────────────────────────────────────────────────

/** The board's filters from the page's query: only the values the server takes. */
export function boardFilters(query: Record<string, string>): OrderBoardFilters {
  const f: OrderBoardFilters = {};
  if ((ORDER_CHANNELS as readonly string[]).includes(query.channel ?? '')) f.channel = query.channel as OrderChannel;
  if (UUID_RE.test(query.dropId ?? '')) f.dropId = query.dropId!.toLowerCase();
  if (UUID_RE.test(query.locationId ?? '')) f.locationId = query.locationId!.toLowerCase();
  if (query.late === 'true') f.late = true;
  const q = (query.q ?? '').trim().slice(0, 100);
  if (q) f.q = q;
  return f;
}

// ── What a role may do ─────────────────────────────────────────────────────

export interface OrderActions {
  pay: boolean;
  /** MARK DELIVERED from the step (an order shipped before its parcel was packed through Logistics). */
  deliver: boolean;
  cancel: boolean;
  /** A return to the archive (its piece RETIRED): ADMIN only, as the server. */
  archive: boolean;
  location: boolean;
  /** The size, the price and the currency (a draw's or a salon's), the engraving text (any order), the shipping (RESERVED, its own). */
  terms: { size: boolean; price: boolean; engraving: boolean; shipping: boolean };
  buyer: boolean;
}

/** What `role` may do with the order now (the server holds the same rules: services/orders.ts). */
export function orderActions(o: OrderView, role: AdminRole | null | undefined): OrderActions {
  const ok = can(role, 'manageOrders');
  const holding = HOLDING.includes(o.status);
  const sale = o.channel !== 'LIVE';
  return {
    // A welcome gift is paid with its order; an order waits for its gift's size (BP-19 T5).
    pay: ok && o.status === 'RESERVED' && o.priceMinor !== null && o.channel !== 'GIFT' && !giftsWaitForSize(o),
    deliver: ok && o.status === 'SHIPPED',
    cancel: ok && holding,
    archive: can(role, 'archiveReturn') && (o.status === 'SHIPPED' || o.status === 'DELIVERED') && o.productId !== null,
    location: ok && holding && o.productId === null,
    terms: {
      size: ok && holding && sale && o.productId === null,
      price: ok && o.status === 'RESERVED' && sale && o.channel !== 'GIFT',
      engraving: ok && holding,
      shipping: ok && o.status === 'RESERVED' && !o.withOrder,
    },
    buyer: ok,
  };
}

/** Why the order cannot ship yet, said under its step (null when it can, or once past it). */
export function shipWaitsFor(o: OrderView): string | null {
  if (o.status !== 'PAID' && o.status !== 'RESERVED') return null;
  if (o.channel === 'GIFT') {
    if (o.skuId === null) return 'Its size is to be chosen.';
    if (o.status === 'RESERVED') return o.withOrder ? `It is paid with ${o.withOrder.reference}.` : 'It is paid with its order.';
  }
  if (o.skuId === null) return 'Its size is to be entered.';
  if (o.status === 'RESERVED' && o.priceMinor !== null && giftsWaitForSize(o)) return 'Choose the welcome gift’s size first.';
  if (o.reservation === 'AWAITING') return o.status === 'RESERVED' && o.priceMinor === null ? 'It waits for supplier stock; its price is to be entered.' : 'It waits for supplier stock.';
  if (o.status === 'RESERVED') return o.priceMinor === null ? 'Its price is to be entered: it is paid once priced, and its invoice issued then.' : 'It ships once paid.';
  if (o.reservation === 'STOCK' && o.productId === null) return 'It ships with its parcel: the agent packs it and scans its card (Shipping).';
  return null;
}

// ── The dialogs ────────────────────────────────────────────────────────────

/** A note, required (a cancellation, a return) or not (a payment, a delivery). */
export function noteProblem(note: string | undefined, required: boolean): string | null {
  const t = (note ?? '').trim();
  if (required && !t) return 'Say in the note why.';
  if (t.length > ORDER_LIMITS.note) return `A note has at most ${ORDER_LIMITS.note} characters.`;
  return null;
}

/** The terms as the dialog holds them. */
export function termsValues(o: OrderView): Record<string, string> {
  return {
    size: o.sizeLabel ?? '',
    oneSize: o.skuId !== null && o.sizeLabel === null ? 'true' : '',
    price: o.priceMinor === null ? '' : moneyField(o.priceMinor),
    currency: o.currency ?? 'EUR',
    engraving: o.engravingText ?? '',
    shippingService: o.shipping?.service ?? 'STANDARD',
    shippingFee: o.shipping?.service && o.shipping.minor !== null ? moneyField(o.shipping.minor) : '',
    giftSize: o.channel === 'GIFT' && o.skuId !== null ? (o.sizeLabel ?? ONE_SIZE_VALUE) : '',
  };
}

/** What the server would refuse in the terms' dialog. */
export function termsProblem(o: OrderView, v: Record<string, string>, a: OrderActions['terms']): string | null {
  if (a.size) {
    const size = (v.size ?? '').trim();
    if (v.oneSize === 'true' && size) return 'A piece in one size has no size label.';
    if (size.length > ORDER_LIMITS.size) return `A size has at most ${ORDER_LIMITS.size} characters.`;
  }
  if (a.price) {
    const price = (v.price ?? '').trim();
    if (price && (parseMoney(price) === null || parseMoney(price)! > ORDER_AMOUNT_MAX_MINOR)) return 'The price is an amount in units: 4800, or 4800.50.';
    if (price && !(ORDER_CURRENCIES as readonly string[]).includes(v.currency ?? '')) return 'Choose the currency.';
  }
  if (a.shipping) {
    const fee = (v.shippingFee ?? '').trim();
    if (fee && (parseMoney(fee) === null || parseMoney(fee)! > ORDER_AMOUNT_MAX_MINOR)) return 'The shipping fee is an amount in units: 20, or 20.50; empty for no shipping.';
    if (fee && v.shippingService !== 'STANDARD' && v.shippingService !== 'EXPRESS') return 'Choose the shipping service.';
    if (fee && parseMoney(fee)! > 0 && o.shipping?.benefit && v.shippingService === o.shipping.service) return 'This order’s shipping is free with its tier: no fee is added to it.';
  }
  if ((v.engraving ?? '').trim().length > ORDER_LIMITS.engraving) return `An engraving has at most ${ORDER_LIMITS.engraving} characters.`;
  if (/[\r\n]/.test(v.engraving ?? '')) return 'An engraving is one line.';
  return Object.keys(termsChange(o, v, a)).length === 0 ? 'Nothing has changed.' : null;
}

/** The terms that change: the size when one is said (or ONE SIZE), the price with its currency, the engraving. */
export function termsChange(o: OrderView, v: Record<string, string>, a: OrderActions['terms']): OrderTermsChange {
  const change: OrderTermsChange = {};
  if (a.size && o.channel === 'GIFT') {
    // A welcome gift's size, chosen among its model's (BP-19 T5).
    const size = v.giftSize ?? '';
    if (size && size !== (o.skuId === null ? '' : (o.sizeLabel ?? ONE_SIZE_VALUE))) change.sizeLabel = size === ONE_SIZE_VALUE ? null : size;
  } else if (a.size) {
    const size = (v.size ?? '').trim();
    if (v.oneSize === 'true') {
      if (o.skuId === null || o.sizeLabel !== null) change.sizeLabel = null;
    } else if (size && size !== o.sizeLabel) change.sizeLabel = size;
  }
  if (a.price) {
    const price = (v.price ?? '').trim();
    const minor = price ? parseMoney(price) : null;
    const currency = price ? ((v.currency ?? 'EUR') as OrderCurrency) : null;
    if (price && minor !== null && (minor !== o.priceMinor || currency !== o.currency)) {
      change.priceMinor = minor;
      change.currency = currency;
    }
  }
  if (a.engraving) {
    const engraving = (v.engraving ?? '').trim() || null;
    if (engraving !== o.engravingText) change.engravingText = engraving;
  }
  if (a.shipping) {
    // An empty fee: no shipping line.
    const fee = (v.shippingFee ?? '').trim();
    const minor = fee ? parseMoney(fee) : null;
    const service = minor === null ? null : v.shippingService === 'EXPRESS' ? 'EXPRESS' : 'STANDARD';
    if (service !== (o.shipping?.service ?? null) || minor !== (o.shipping?.minor ?? null)) {
      change.shippingService = service;
      change.shippingMinor = minor;
    }
  }
  return change;
}

/** The buyer's dialog: a name on one line, an address on several; either may be cleared. */
export function buyerProblem(o: OrderView, v: Record<string, string>): string | null {
  const name = (v.name ?? '').trim();
  const address = (v.address ?? '').trim();
  if (/[\r\n]/.test(name)) return 'A name is one line.';
  if (name.length > ORDER_LIMITS.buyerName) return `A name has at most ${ORDER_LIMITS.buyerName} characters.`;
  if (address.length > ORDER_LIMITS.buyerAddress) return `An address has at most ${ORDER_LIMITS.buyerAddress} characters.`;
  if ((name || null) === o.buyer.name && (address || null) === o.buyer.address) return 'Nothing has changed.';
  return null;
}

export function buyerInput(v: Record<string, string>): { name: string | null; address: string | null } {
  return { name: (v.name ?? '').trim() || null, address: (v.address ?? '').replace(/\r\n?/g, '\n').trim() || null };
}

/** The delays' dialog: whole days within their bounds. */
export function alertsProblem(v: Record<string, string>): string | null {
  for (const [k, label] of [
    ['reservedDays', 'Reserved'],
    ['readyDays', 'Paid and ready'],
    ['shippedDays', 'Shipped'],
    ['unregisteredDays', 'Delivered, not registered'],
  ] as const) {
    const n = Number((v[k] ?? '').trim());
    const { min, max } = ALERT_LIMITS[k];
    if (!/^\d+$/.test((v[k] ?? '').trim()) || n < min || n > max) return `${label}: ${min} to ${max} days.`;
  }
  return null;
}

export function alertsInput(v: Record<string, string>): OrderAlertDelays {
  return { reservedDays: Number(v.reservedDays), readyDays: Number(v.readyDays), shippedDays: Number(v.shippedDays), unregisteredDays: Number(v.unregisteredDays) };
}

/** A location's name. */
export function locationProblem(name: string | undefined): string | null {
  const t = (name ?? '').trim();
  if (!t) return 'Name the location.';
  if (t.length > LOGISTICS_LIMITS.locationName) return `A name has at most ${LOGISTICS_LIMITS.locationName} characters.`;
  return null;
}

/** A tracking link as the server takes it: https, no space, {tracking} exactly once (services/stock.ts checkTrackingUrl). */
export function trackingUrlProblem(url: string | undefined): string | null {
  const s = (url ?? '').trim();
  if (!s) return 'Enter the tracking link.';
  if (s.length > LOGISTICS_LIMITS.trackingUrl) return `A tracking link has at most ${LOGISTICS_LIMITS.trackingUrl} characters.`;
  if (!/^https:\/\/[^\s]+$/.test(s)) return 'A tracking link starts with https:// and holds no space.';
  if (s.split(TRACKING_PLACEHOLDER).length !== 2) return `A tracking link holds ${TRACKING_PLACEHOLDER} once, where the number goes.`;
  try {
    const u = new URL(s.replace(TRACKING_PLACEHOLDER, '0'));
    if (u.protocol !== 'https:' || !u.hostname) return 'The tracking link is not a valid address.';
  } catch {
    return 'The tracking link is not a valid address.';
  }
  return null;
}

/** A carrier's dialog: its name and its tracking link. */
export function carrierProblem(v: Record<string, string>): string | null {
  const name = (v.name ?? '').trim();
  if (!name) return 'Name the carrier.';
  if (name.length > LOGISTICS_LIMITS.carrierName) return `A name has at most ${LOGISTICS_LIMITS.carrierName} characters.`;
  return trackingUrlProblem(v.trackingUrl);
}

// ── The packing slip ───────────────────────────────────────────────────────

/** What the packing slip lists (M2): the piece, its size, its add-ons, the engraving and the surprise; never a price. */
export interface PackingSlip {
  reference: string;
  sourceReference: string | null;
  channel: string;
  release: string | null;
  model: string;
  piece: string | null;
  size: string;
  addons: string[];
  engraving: string | null;
  surprise: string | null;
  buyer: { name: string | null; address: string | null };
}

export function packingSlip(d: OrderDetail): PackingSlip {
  const o = d.order;
  return {
    reference: o.reference,
    sourceReference: d.sourceReference,
    channel: CHANNEL_LABELS[o.channel],
    release: o.release?.title ?? null,
    // The variant after the model (plan NEXT LOT §3.5.3): the agent picks by model, variant and size.
    model: o.model.variant ? `${o.model.name} · ${o.model.variant}` : o.model.name,
    piece: o.productId,
    size: sizeText({ sizeLabel: o.sizeLabel, skuKnown: o.skuId !== null }),
    addons: o.addons.map((a) => a.label),
    engraving: o.engravingText,
    surprise: o.surprise,
    buyer: o.buyer,
  };
}
