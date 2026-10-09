/**
 * MY PIECES' orders view-model (plan LIVE RELEASE+, choice 6): the account's orders (GET /api/v1/account/orders) →
 * what each card of YOUR ORDERS shows. Pure (no DOM) and unit-tested, like the pieces' view-model.
 *
 * One order per piece, the latest first, as the server sends them:
 *   the piece      the model (the card's title), where it was sold (LIVE RELEASE, DRAW or THE PRIVATE SALON, and the
 *                  release's name), what its step means now;
 *   the steps      RESERVED · PAID · IN PREPARATION · SHIPPED · DELIVERED (plan NEXT LOT §3.6.A: IN PREPARATION once
 *                  paid with its piece assigned, a step of the card only), each reached with its date (on this phone's
 *                  calendar), the current one marked, those to come without one; a CANCELLED or RETURNED order shows the
 *                  steps it reached, then that end with its date; while ORBES Client Services looks into its delivery,
 *                  one sentence in place of the step's;
 *   a new code     YOUR NEW CLAIM CODE (plan NEXT LOT §3.4), right after what its step means, only while a new claim code
 *                  ORBES Client Services made for its piece waits to be read (never the code: SHOW THE CODE asks for it);
 *                  REGISTER THIS PIECE offered once the order is shipped;
 *   its request    (plan NEXT LOT §3.6.D) a return or a size exchange asked: RETURN REQUESTED or EXCHANGE REQUESTED, the
 *                  RETURN ADDRESS, PIECE RECEIVED, EXCHANGED FOR, or the answer in MESSAGES;
 *   the terms      SIZE, PRICE, each add-on at its price, its ENGRAVING (plan NEXT LOT §3.6.C: its words, with the price
 *                  of the settings or none when the release's add-on paid for it; ADD AN ENGRAVING or CHANGE THE
 *                  ENGRAVING under the rows until packing begins), its SHIPPING (plan NEXT-NINE, BP-19 T4: free by its tier, at
 *                  its fee, or with the order it travels with; no row without shipping), the CREDIT taken off it (BP-19
 *                  T5: − € 50), and the TOTAL when there are add-ons, a fee or a credit; a draw's or a salon's size and
 *                  price read TO BE CONFIRMED until ORBES Client Services enters them (left out once cancelled); a
 *                  welcome gift (BP-19 T5) reads WELCOME GIFT · its tier, its PRICE WELCOME GIFT, and while it waits
 *                  the order it travels with;
 *   the shipment   once shipped: the CARRIER, the TRACKING NUMBER and TRACK THE SHIPMENT, the carrier's page (https only);
 *   the address    DELIVERY ADDRESS (plan NEXT LOT §3.6.B): its address with CHANGE, ADD THE DELIVERY ADDRESS, the address
 *                  once packing has begun (changed through ORBES Client Services), or the order it travels with;
 *   returns        RETURNS AND EXCHANGES (plan NEXT LOT §3.6.D): on a delivered order for 14 days, REQUEST A RETURN and
 *                  EXCHANGE THE SIZE (absent for a model of one size);
 *   the documents  (M6) its INVOICE and CREDIT NOTE with their numbers (PDFs; the number in the reading face), then its other
 *                  invoices and credit notes (plan NEXT LOT §3.6.C: an engraving after payment), the CARE GUIDE of its model while the
 *                  piece is on its way or kept, its OWNERSHIP CERTIFICATE once the piece is registered to the account;
 *   the reference  ORDER OR-…, what ORBES Client Services finds it by;
 *   the photograph the cover photograph of its model (or of its variant), shown whole above it (plan NOCTURNE,
 *                  addition 3), never a piece's own (decision 9); none when the model has none.
 * An order the app cannot read (an unknown step or channel, a reference that is not one) is left out, never guessed.
 */
import { ORDERS } from './copy.js';
import { formatMoney } from './live-model.js';
import type { OrderDocumentKind } from './api.js';
import { orderContext } from './messages-model.js';
import { addressLines } from './addresses-model.js';
import { ORDER_CHANNELS, ORDER_STATUSES, type AccountOrder, type OrderStatus } from './types.js';
import { formatDate, modelWithVariant, photoModels, upper, type PhotoModel, type Row } from './view-model.js';

/** A step of an order's card: its status, or IN PREPARATION (plan NEXT LOT §3.6.A), a step of the card only. */
export type OrderStepKey = OrderStatus | 'IN_PREPARATION';

/** The five steps of an order that goes its way. */
export const ORDER_PATH: readonly OrderStepKey[] = Object.freeze(['RESERVED', 'PAID', 'IN_PREPARATION', 'SHIPPED', 'DELIVERED'] as const);

/** One step on an order's card: reached (`done`), where the order is now (`current`), or to come (`next`, no date). */
export interface OrderStepModel {
  status: OrderStepKey;
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
  /** Its return or size exchange as asked (plan NEXT LOT §3.6.D), under the claim block; null without one to show. */
  request: OrderRequestModel | null;
  /** SIZE, PRICE, each add-on, ENGRAVING, SHIPPING, CREDIT, TOTAL. */
  rows: Row[];
  /** Its engraving under the rows (plan NEXT LOT §3.6.C): its link and its sheet, or the line once packing has begun; null for none. */
  engraving: OrderEngravingModel | null;
  /** DELIVERY ADDRESS (plan NEXT LOT §3.6.B); null for none (a cancelled order, or nothing to say). */
  address: OrderAddressModel | null;
  /** RETURNS AND EXCHANGES (plan NEXT LOT §3.6.D), while they may be asked; null otherwise. */
  returns: OrderReturnsModel | null;
  /** What its sheets name it by: `ORDER OR-3F9A21C4 · MONOLITHE IN BLUE` (as a message's CONCERNING says it). */
  concerning: string;
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
  /** The PDF it saves; null for the care guide and for a document read by its number. */
  file: OrderDocumentKind | null;
  /** Plan NEXT LOT §3.6.C: another invoice or credit note of the order (an engraving after payment), saved by its number. */
  byNumber: boolean;
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
  if (typeof invoice === 'string' && DOCUMENT_NUMBER.test(invoice) && invoice.startsWith('INV-')) out.push({ kind: 'INVOICE', label: D.invoice, number: invoice, ariaLabel: D.invoiceLabel(invoice), file: 'invoice', byNumber: false });
  const credit = d.creditNote?.number;
  if (typeof credit === 'string' && DOCUMENT_NUMBER.test(credit) && credit.startsWith('CN-')) out.push({ kind: 'CREDIT_NOTE', label: D.creditNote, number: credit, ariaLabel: D.creditNoteLabel(credit), file: 'credit-note', byNumber: false });
  // Plan NEXT LOT §3.6.C: its other documents (an engraving added or removed after payment), in order of issue.
  for (const x of Array.isArray(d.others) ? d.others : []) {
    const n = x?.number;
    if (typeof n !== 'string' || !DOCUMENT_NUMBER.test(n)) continue;
    if (x.kind === 'INVOICE' && n.startsWith('INV-')) out.push({ kind: 'INVOICE', label: D.invoice, number: n, ariaLabel: D.invoiceLabel(n), file: null, byNumber: true });
    else if (x.kind === 'CREDIT_NOTE' && n.startsWith('CN-')) out.push({ kind: 'CREDIT_NOTE', label: D.creditNote, number: n, ariaLabel: D.creditNoteLabel(n), file: null, byNumber: true });
  }
  if (d.careGuide === true) out.push({ kind: 'CARE_GUIDE', label: D.careGuide, number: null, ariaLabel: D.careGuideLabel(model), file: null, byNumber: false });
  if (d.certificate === true) out.push({ kind: 'CERTIFICATE', label: D.certificate, number: null, ariaLabel: D.certificateLabel(model), file: 'certificate', byNumber: false });
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

/** IN PREPARATION's time as the server says it (plan NEXT LOT §3.6.A), or null: never reached, or a server before it. */
function preparingAt(o: AccountOrder): string | null {
  return typeof o.preparingAt === 'string' && o.preparingAt !== '' ? o.preparingAt : null;
}

/** When the order reached each step (null: not reached); IN PREPARATION kept once reached, whatever its status now. */
function reachedAt(o: AccountOrder): Record<OrderStepKey, string | null> {
  return { RESERVED: o.reservedAt, PAID: o.paidAt, IN_PREPARATION: preparingAt(o), SHIPPED: o.shippedAt, DELIVERED: o.deliveredAt, CANCELLED: o.cancelledAt, RETURNED: o.returnedAt };
}

/** Where the order is on its way: IN PREPARATION once paid with its piece assigned (plan NEXT LOT §3.6.A), else its status. */
function stepNow(o: AccountOrder): OrderStepKey {
  return o.status === 'PAID' && preparingAt(o) !== null ? 'IN_PREPARATION' : o.status;
}

/**
 * The steps of an order: on its way, the five steps, those reached with their dates (an order shipped before IN
 * PREPARATION existed shows it done, without a date); CANCELLED or RETURNED, the steps it reached, then that end.
 */
export function orderSteps(o: AccountOrder, offsetMinutes?: number): OrderStepModel[] {
  const at = reachedAt(o);
  // One step reached is dated in full (5 OCT 2026, C24); several, each by its day and month in the same year as the
  // first (15 SEP · 16 SEP …, C24 and C32: five columns hold no year), a step of another year with its own.
  const reached = (Object.keys(at) as OrderStepKey[]).filter((s) => at[s] !== null && orderDate(at[s], offsetMinutes) !== '');
  const first = orderDate(o.reservedAt, offsetMinutes).slice(-4);
  const date = (status: OrderStepKey) => {
    const full = orderDate(at[status], offsetMinutes);
    return reached.length > 1 && full.slice(-4) === first ? orderDate(at[status], offsetMinutes, { year: false }) : full;
  };
  const step = (status: OrderStepKey, state: OrderStepModel['state']): OrderStepModel => ({
    status,
    label: ORDERS.step[status],
    date: state === 'next' ? '' : date(status),
    state,
  });
  const now = ORDER_PATH.indexOf(stepNow(o));
  if (now >= 0) return ORDER_PATH.map((s, i) => step(s, i < now ? 'done' : i === now ? 'current' : 'next'));
  return [...ORDER_PATH.filter((s) => s === 'RESERVED' || at[s] !== null).map((s) => step(s, 'done')), step(o.status, 'current')];
}

/** What the order's step means now: one sentence while its delivery is looked into, a welcome gift's while it waits. */
export function orderSentence(o: AccountOrder): string {
  if (o.deliveryIssue === true) return ORDERS.deliveryIssue;
  const parent = typeof o.withOrder === 'string' && REFERENCE.test(o.withOrder) ? o.withOrder : null;
  // A welcome gift waiting says the order it travels with (BP-19 T5).
  if (o.channel === 'GIFT' && parent && (o.status === 'RESERVED' || o.status === 'PAID')) return ORDERS.gift.travels(parent);
  const now = stepNow(o);
  return now === 'IN_PREPARATION' ? ORDERS.sentence.IN_PREPARATION : ORDERS.sentence[o.status];
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

/** Its engraving's words and the price it took (null: the release's add-on paid for it, or one of before); null for none. */
function engravingOf(o: AccountOrder): { text: string; priceMinor: number | null } | null {
  const e = o.engraving;
  if (!e || typeof e !== 'object' || typeof e.text !== 'string' || e.text.trim() === '') return null;
  const price = typeof e.priceMinor === 'number' && Number.isInteger(e.priceMinor) && e.priceMinor >= 0 ? e.priceMinor : null;
  return { text: e.text.trim(), priceMinor: price };
}

/**
 * SIZE, PRICE, each add-on at its price (per piece), its ENGRAVING (plan NEXT LOT §3.6.C: its words, with the price of
 * the settings it took; the words alone when the release's add-on paid for it, its price on the add-on's row), its
 * SHIPPING (BP-19 T4), and the TOTAL when there are add-ons, a priced engraving or a fee, and a price. A cancelled order
 * never promises a confirmation: the size and the price never entered are left out (possibly every row).
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
  const engraving = engravingOf(o);
  const engravingMinor = engraving?.priceMinor && o.currency ? engraving.priceMinor : 0;
  if (engraving) rows.push([ORDERS.rows.engraving, ORDERS.engraving.value(engraving.text, engravingMinor > 0 ? money(engravingMinor) : null)]);
  const shipping = shippingValue(o);
  if (shipping) rows.push([ORDERS.rows.shipping, shipping]);
  const fee = shippingFee(o);
  const credit = !gift && priced && typeof o.creditMinor === 'number' && Number.isInteger(o.creditMinor) && o.creditMinor > 0 ? o.creditMinor : 0;
  if (credit > 0) rows.push([ORDERS.rows.credit, ORDERS.credit(money(credit))]);
  if (!gift && priced && (o.addons.length > 0 || engravingMinor > 0 || fee > 0 || credit > 0)) rows.push([ORDERS.rows.total, money(o.addons.reduce((n, a) => n + a.priceMinor, o.priceMinor! + engravingMinor + fee - credit))]);
  return rows;
}

// ── The collector's side of the order (plan NEXT LOT §3.6) ──────────────────

/** A size as a card names it: `SIZE 18` (a label that already carries its word, as written). */
export function sizeName(label: string): string {
  const l = upper(label);
  return /^(SIZE|ONE SIZE)\b/.test(l) ? l : `SIZE ${l}`;
}

/** DELIVERY ADDRESS (plan NEXT LOT §3.6.B), on an order's card. */
export interface OrderAddressModel {
  /**
   * `editable`: its address and CHANGE; `empty`: the sentence and ADD THE DELIVERY ADDRESS; `locked`: its address, then
   * that packing has begun; `read`: its address (shipped, delivered, returned); `travels`: the order it travels with.
   */
  state: 'editable' | 'empty' | 'locked' | 'read' | 'travels';
  /** The name, each line as typed, the country's English name, the phone; none for `empty` and `travels`. */
  lines: string[];
  /** Under the address: the empty one's, packing begun, or the order it travels with; null for none. */
  sentence: string | null;
  /** The address now on the order, to select its saved twin in the sheet; null without one. */
  current: { name: string; address: string; country: string | null; phone: string | null } | null;
}

/**
 * An order's DELIVERY ADDRESS: none once cancelled; the order it travels with (or, that one cancelled, that ORBES Client
 * Services will contact the collector: `parentCancelled`); its address with CHANGE while the collector may change it,
 * ADD THE DELIVERY ADDRESS without one, the address and that packing has begun once it has, read only once shipped.
 */
export function orderAddress(o: AccountOrder, opts: { parentCancelled?: boolean } = {}): OrderAddressModel | null {
  if (o.status === 'CANCELLED') return null;
  const A = ORDERS.address;
  const travels = typeof o.addressOf === 'string' && REFERENCE.test(o.addressOf) ? o.addressOf : null;
  if (travels) return { state: 'travels', lines: [], sentence: opts.parentCancelled ? A.travelsCancelled : A.travels(travels), current: null };
  const a = o.address;
  const current = a && typeof a.name === 'string' && typeof a.lines === 'string' ? { name: a.name, address: a.lines, country: a.country ?? null, phone: a.phone ?? null } : null;
  const lines = current ? addressLines(current) : [];
  if (o.status !== 'RESERVED' && o.status !== 'PAID') return current ? { state: 'read', lines, sentence: null, current } : null;
  if (o.editable?.address) return current ? { state: 'editable', lines, sentence: null, current } : { state: 'empty', lines: [], sentence: A.empty, current: null };
  return current ? { state: 'locked', lines, sentence: A.locked, current } : null;
}

/** An order's engraving under its rows (plan NEXT LOT §3.6.C): its link and what its sheet holds, or the line once packing has begun. */
export interface OrderEngravingModel {
  /** ADD AN ENGRAVING, CHANGE THE ENGRAVING or ENTER YOUR ENGRAVING (the release's add-on); null once packing has begun. */
  action: string | null;
  /** 'Packing has begun. The engraving no longer changes.' in place of the link; null otherwise. */
  locked: string | null;
  /** Its words now ('' for none). */
  text: string;
  /** The most characters the collector types (20). */
  maxLength: number;
  /** The release's add-on paid for it: no price, no REMOVE. */
  included: boolean;
  /** `ENGRAVING · + € 30`, or the add-on's sentence; null when nothing is to be said of its price. */
  priceLine: string | null;
  /** Said before SAVE once paid: its own invoice (adding a priced one); null otherwise. */
  addNote: string | null;
  /** REMOVE THE ENGRAVING offered (one there, not the add-on's), and once paid the credit note's line before it. */
  removable: boolean;
  removeNote: string | null;
}

/** An order's engraving under its rows: the link while the collector may change it, the line once packing has begun, none otherwise. */
export function orderEngraving(o: AccountOrder): OrderEngravingModel | null {
  const E = ORDERS.engraving;
  const current = engravingOf(o);
  const offer = o.engravingOffer && typeof o.engravingOffer === 'object' ? o.engravingOffer : null;
  if (!o.editable?.engraving || !offer) {
    // The server offers an engraving on every order that carries one (a welcome gift aside), so on a holding order
    // with an offer its engraving stops being editable only once packing has begun, the order travelling or not.
    const locked = !!current && (o.status === 'RESERVED' || o.status === 'PAID') && offer !== null && o.editable?.engraving === false;
    return locked ? { action: null, locked: E.locked, text: current.text, maxLength: 0, included: false, priceLine: null, addNote: null, removable: false, removeNote: null } : null;
  }
  const included = offer.included === true;
  const priceMinor = !included && typeof offer.priceMinor === 'number' && offer.priceMinor >= 0 ? offer.priceMinor : null;
  // The price the engraving took, else the settings' price now.
  const taken = current?.priceMinor ?? priceMinor;
  const price = taken !== null && o.currency ? formatMoney(taken, o.currency) : null;
  const paid = o.status === 'PAID';
  return {
    action: current ? E.change : included ? E.enter : E.add,
    locked: null,
    text: current?.text ?? '',
    maxLength: typeof offer.maxLength === 'number' && offer.maxLength > 0 ? offer.maxLength : 20,
    included,
    priceLine: included ? E.included : price ? E.price(price) : null,
    // A free one issues no document; words changed after payment, none either.
    addNote: paid && !included && !current && (priceMinor ?? 0) > 0 ? E.paidAdd : null,
    removable: !!current && !included,
    removeNote: paid && !included && (current?.priceMinor ?? 0) > 0 ? E.paidRemove : null,
  };
}

/** RETURNS AND EXCHANGES (plan NEXT LOT §3.6.D) on a delivered order. */
export interface OrderReturnsModel {
  /** 'You may return this piece or exchange its size until 21 OCT 2026. …' */
  lead: string;
  /** The model's other sizes, in stock or greyed out; none for a model of one size (no EXCHANGE THE SIZE). */
  sizes: { label: string; available: boolean }[];
  /** What the request's sheet names: `ORDER OR-3F9A21C4 · MONOLITHE IN BLUE · SIZE 17`. */
  concerning: string;
}

/** RETURNS AND EXCHANGES while the server says they may be asked (DELIVERED, not a welcome gift, 14 days, none asked). */
export function orderReturns(o: AccountOrder, offsetMinutes?: number): OrderReturnsModel | null {
  const r = o.returnable;
  if (!r || typeof r !== 'object' || o.status !== 'DELIVERED' || o.channel === 'GIFT') return null;
  const until = orderDate(r.until, offsetMinutes);
  if (!until) return null;
  const sizes = Array.isArray(r.sizes) ? r.sizes.filter((z) => z && typeof z.label === 'string' && z.label.trim() !== '').map((z) => ({ label: z.label.trim(), available: z.available === true })) : [];
  const size = o.size?.label ? sizeName(o.size.label) : null;
  const concerning = [orderContext({ id: o.id, model: o.model, modelVariant: o.modelVariant }).label, size].filter(Boolean).join(' · ');
  return { lead: ORDERS.returns.lead(until), sizes, concerning };
}

/** A return or a size exchange as asked (plan NEXT LOT §3.6.D): what the card says of it now. */
export interface OrderRequestModel {
  /** RETURN REQUESTED · 12 OCT 2026, EXCHANGE REQUESTED · SIZE 18 · 12 OCT 2026, or EXCHANGED FOR SIZE 18 · ORDER OR-…. */
  label: string;
  /** PIECE RECEIVED · 15 OCT 2026, once the agent has it; null before. */
  received: string | null;
  /** What to do, or what follows. */
  sentences: string[];
  /** RETURN ADDRESS and the address of the order's location, while the piece is to be sent back; null otherwise. */
  returnAddress: string[] | null;
}

/**
 * The card's lines of its return or size exchange: asked (with the return address, or that it follows in MESSAGES),
 * received, exchanged for its other size's order, or answered in MESSAGES (cancelled); none once a return is decided
 * (the order reads RETURNED, with its credit note).
 */
export function orderRequest(o: AccountOrder, offsetMinutes?: number): OrderRequestModel | null {
  const c = o.case;
  if (!c || typeof c !== 'object' || (c.kind !== 'RETURN' && c.kind !== 'EXCHANGE')) return null;
  const R = ORDERS.returns;
  const opened = orderDate(c.openedAt, offsetMinutes);
  if (!opened) return null;
  const size = c.kind === 'EXCHANGE' && typeof c.sizeLabel === 'string' && c.sizeLabel.trim() !== '' ? sizeName(c.sizeLabel) : null;
  const label = size ? R.exchangeRequested(size, opened) : R.returnRequested(opened);
  const reference = o.reference;
  switch (c.status) {
    case 'OPEN': {
      const address = typeof c.returnAddress === 'string' && c.returnAddress.trim() !== '' ? c.returnAddress.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : null;
      return address ? { label, received: null, sentences: [R.sendBack(reference)], returnAddress: address } : { label, received: null, sentences: [R.noReturnAddress], returnAddress: null };
    }
    case 'RECEIVED': {
      const at = orderDate(c.receivedAt, offsetMinutes);
      return { label, received: at ? R.received(at) : null, sentences: [R.receivedText], returnAddress: null };
    }
    case 'CLOSED': {
      const next = c.exchangeOrder && typeof c.exchangeOrder.reference === 'string' && REFERENCE.test(c.exchangeOrder.reference) ? c.exchangeOrder.reference : null;
      return c.outcome === 'EXCHANGE' && next && size ? { label: R.exchangedFor(size, next), received: null, sentences: [], returnAddress: null } : null;
    }
    case 'CANCELLED':
      return { label, received: null, sentences: [R.answered], returnAddress: null };
    default:
      return null;
  }
}

/** One order → its card; null when the app cannot read it. */
export function orderModel(o: AccountOrder, offsetMinutes?: number, opts: { parentCancelled?: boolean } = {}): OrderModel | null {
  if (!o || typeof o.reference !== 'string' || !REFERENCE.test(o.reference)) return null;
  if (!ORDER_STATUSES.includes(o.status) || !ORDER_CHANNELS.includes(o.channel) || typeof o.reservedAt !== 'string') return null;
  const shipped = o.status === 'SHIPPED' || o.status === 'DELIVERED' || o.status === 'RETURNED';
  const s = shipped ? o.shipment : null;
  const giftTier = o.channel === 'GIFT' && (o.giftTier === 'PLATINE' || o.giftTier === 'PALLADIUM') ? o.giftTier : null;
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
    sentence: orderSentence(o),
    steps: orderSteps(o, offsetMinutes),
    claim: orderClaim(o),
    request: orderRequest(o, offsetMinutes),
    rows: orderRows(o),
    engraving: orderEngraving(o),
    address: orderAddress(o, opts),
    returns: orderReturns(o, offsetMinutes),
    concerning: orderContext({ id: o.id, model: o.model, modelVariant: o.modelVariant }).label,
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
  // An order travelling with one of the account's that was cancelled says so (plan NEXT LOT §3.6, edge cases).
  const cancelled = new Set(list.filter((o) => o && o.status === 'CANCELLED').map((o) => o.reference));
  return list.map((o) => orderModel(o, offsetMinutes, { parentCancelled: typeof o?.addressOf === 'string' && cancelled.has(o.addressOf) })).filter((m): m is OrderModel => m !== null);
}
