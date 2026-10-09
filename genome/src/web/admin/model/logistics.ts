/**
 * Logistics in the console (plan NEXT LOT of 2026-10-07, §3.5.3 and §3.5.4.1; `#/logistics`): pure helpers, no DOM.
 *
 *  - The page's words: its lead, its tabs and their counters, each tab's lead and empty line, as §3.5.3 gives them.
 *  - The tab and the Location filter read from the page's query, kept to the values the page offers.
 *  - A size as Logistics names it (`MONOLITHE · BLUE · 52`), the marks of a row (NO PIECE · 3, TO ORDER).
 *  - The dialogs: a correction proposed (the agent) or applied at once (ORBES), a transfer, a minimum, pieces counted in,
 *    a parcel back at the agent: what the server would refuse before anything is sent, and what to send.
 * The server stays the authority (409 STOCK_NOT_AVAILABLE, STOCK_NOT_BACKED, PIECE_NOT_COUNTABLE; 404 outside the
 * login's locations).
 */
import { countryName } from '../../../shared/countries.js';
import { formatCount, formatDateTime } from '../format.js';
import { parseMoney } from './live.js';
import type { CaseToReceive, LogisticsLocation, LogisticsSku, OrderCaseKind, ParcelActor, ParcelStep, ReceptionInput, ReceptionOrder, ReceptionStatus, ReceptionView, ShippingOrderView, StockCorrectionStatus, SupplierReturnItem, ToShipRow } from '../types.js';

/** The bounds of services/logistics.ts and services/stock.ts (LOGISTICS_LIMITS, STOCK_MOVE_MAX, THRESHOLD_MAX). */
export const LOGISTICS_LIMITS = Object.freeze({ move: 10_000, reason: 500, note: 500, minimum: 10_000, countIn: 100, receiveNote: 500 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^O\d{2}-[A-Z]-\d{5,6}$/;

// ── The page ───────────────────────────────────────────────────────────────

/** The page's lead (plan NEXT LOT §3.5.3). */
export const LOGISTICS_LEAD =
  'The stock of every model, variant and size at each location, the receptions from the suppliers, and the orders to ship. The agent counts what arrives and ships; ORBES confirms each reception, which gives every piece its ORBES identity and its card.';

/** The tabs, in their order (`?tab=`). */
export const LOGISTICS_TABS = Object.freeze([
  { id: 'ship', label: 'To ship' },
  { id: 'receptions', label: 'Receptions' },
  { id: 'stock', label: 'Stock' },
  { id: 'returns', label: 'Returns' },
  { id: 'corrections', label: 'Corrections' },
] as const);
export type LogisticsTab = (typeof LOGISTICS_TABS)[number]['id'];

/** The tabs with a counter (§3.5.3): To ship, the parcels listed; Receptions, the server's count; Returns, the parcels to receive; Corrections, those waiting for ORBES. */
export type LogisticsCounts = Partial<Record<LogisticsTab, number>>;

/** The tab the query names, the first one otherwise. */
export function logisticsTab(query: Record<string, string>): LogisticsTab {
  return LOGISTICS_TABS.find((t) => t.id === query.tab)?.id ?? LOGISTICS_TABS[0].id;
}

/** A tab's words and its counter, apart (the figure reads in --font inside the display-face tab): ['Returns', '(2)']. */
export function tabText(tab: LogisticsTab, counts: LogisticsCounts): [string, string | null] {
  const label = LOGISTICS_TABS.find((t) => t.id === tab)!.label;
  const n = counts[tab];
  return [label, n === undefined ? null : `(${formatCount(n)})`];
}

/** The location the query names, when it is one of the scope's; undefined (every location) otherwise. */
export function locationFilter(query: Record<string, string>, locations: readonly LogisticsLocation[]): string | undefined {
  const id = (query.locationId ?? '').toLowerCase();
  return UUID_RE.test(id) && locations.some((l) => l.id === id) ? id : undefined;
}

/** The Location filter is offered when there are several locations to choose from. */
export function offersLocationFilter(locations: readonly LogisticsLocation[]): boolean {
  return locations.length > 1;
}

// ── A size ─────────────────────────────────────────────────────────────────

/** A size's words: ONE SIZE for a model of one size. */
export function sizeText(sizeLabel: string | null): string {
  return sizeLabel ?? 'ONE SIZE';
}

/** A size as Logistics names it: `MONOLITHE · BLUE · 52`, `MONOLITHE · ONE SIZE`. */
export function skuWords(sku: Pick<LogisticsSku, 'model' | 'variant' | 'sizeLabel'> | { model: string; variant: string | null; sizeLabel: string | null }): string {
  const model = typeof sku.model === 'string' ? sku.model : sku.model.name;
  return [model, sku.variant, sizeText(sku.sizeLabel)].filter((x): x is string => !!x).join(' · ');
}

/** The mark of a size whose count no ORBES identity backs: `NO PIECE · 3` (ORBES staff only); null otherwise. */
export function noPieceMark(unbacked: number | undefined): string | null {
  return unbacked && unbacked > 0 ? `NO PIECE · ${formatCount(unbacked)}` : null;
}

// ── The tabs' words ────────────────────────────────────────────────────────

export const STOCK_TEXT = Object.freeze({
  leadAgent:
    'Every size of every model and variant at your locations, 0 included. On hand is what the stock holds; reserved, what orders hold; waiting, the orders without a piece yet.',
  leadStaff:
    'Every size of every model and variant at each location, 0 included. On hand is what the stock holds; reserved, what orders hold; waiting, the orders without a piece yet; expected, what the suppliers still owe.',
  emptyAgent: 'No size declared yet: ORBES declares each model’s sizes.',
  emptyStaff: 'No size declared yet: declare a model’s sizes in the Catalogue.',
  setAside: 'Set aside',
  propose: 'Propose a correction',
  proposeText: 'A count, a piece found or damaged: ORBES approves it before the stock moves.',
  proposed: 'Correction proposed: ORBES approves it.',
  correct: 'Correct',
  correctTitle: 'Correct the count',
  correctText: 'A count, a piece found or damaged: the stock moves up or down by the pieces given, never below what orders reserve.',
  corrected: 'Count corrected.',
  piecesHint: 'Up: 12. Down: -2.',
  transfer: 'Transfer',
  transferText: 'Pieces available move from one location to the other: the pieces reserved by orders stay where their orders are.',
  transferred: 'Pieces transferred.',
  minimum: 'Minimum',
  minimumText: 'Below it, Supplier orders proposes the pieces to order to reach it, for you to confirm. Empty: no minimum.',
  minimumSaved: 'Minimum saved.',
  addToOrder: 'Add to supplier order',
  addedToOrder: 'Added to the draft.',
  countIn: 'Count pieces in',
  countInConfirm: 'Count in',
  countedIn: 'Pieces counted in.',
  serialsHint: 'One per line: O26-J-00184.',
});

/** Add to supplier order, from ORBES's Stock: the size, the pieces and where they go; the draft is confirmed before it is sent. */
export function addToOrderText(r: { sku: LogisticsSku; location: { name: string } }): string {
  return `The pieces of ${skuWords(r.sku)} go to the draft of its supplier, to deliver to ${r.location.name}. You confirm the draft before it is sent.`;
}

/** The text of Count pieces in, for a size. */
export function countInText(sku: LogisticsSku): string {
  return `Name the pieces of ${skuWords(sku)} that are on the shelf: they enter the stock with their ORBES identity. The count does not move.`;
}

/** The notice over ORBES's Stock: how many sizes hold pieces counted that no identity backs; null when none. */
export function unbackedNotice(sizes: number | undefined): string | null {
  if (!sizes) return null;
  return `${formatCount(sizes)} ${sizes === 1 ? 'size has' : 'sizes have'} pieces counted that no ORBES identity backs. An order holding them cannot be packed: count their pieces in, or correct the count down.`;
}

export const RETURNS_TEXT = Object.freeze({
  title: 'To receive',
  empty: 'No parcel expected back.',
  received: 'Received',
  dialogTitle: 'The parcel is back',
  dialogText: 'ORBES then decides: back to stock, a refund, or the other size.',
  done: 'Recorded: ORBES decides.',
});

/** An order case's kind as Logistics names it (Returns → To receive; the order page). */
export const CASE_KIND_LABELS: Readonly<Record<OrderCaseKind, string>> = Object.freeze({
  RETURN: 'RETURN',
  EXCHANGE: 'SIZE EXCHANGE',
  BACK_TO_SENDER: 'BACK TO SENDER',
  LOST: 'LOST',
  DAMAGED: 'DAMAGED',
});

/** The pieces of a parcel expected back, one line each. */
export function casePieces(c: Pick<CaseToReceive, 'pieces'>): string[] {
  return c.pieces.map((p) => skuWords(p));
}

export const CORRECTIONS_TEXT = Object.freeze({
  lead: 'A correction proposed by the agent moves the stock only once ORBES approves it.',
  empty: 'No correction proposed.',
  approve: 'Approve',
  approveTitle: 'Approve the correction',
  approved: 'Correction approved.',
  decline: 'Decline',
  declineTitle: 'Decline the correction',
  declineText: 'The stock does not move. The agent reads your note with the correction.',
  declined: 'Correction declined.',
});

/** A correction's status as its mark reads. */
export const CORRECTION_STATUS_LABELS: Readonly<Record<StockCorrectionStatus, string>> = Object.freeze({ TO_APPROVE: 'TO APPROVE', APPROVED: 'APPROVED', DECLINED: 'DECLINED' });

/** A count's change: `+12`, `-2`. */
export function deltaText(delta: number): string {
  return delta > 0 ? `+${formatCount(delta)}` : `-${formatCount(-delta)}`;
}

/** What approving a correction does, said in its dialog. */
export function approveText(c: { sku: LogisticsSku; location: { name: string }; delta: number }): string {
  return `The count of ${skuWords(c.sku)} at ${c.location.name} moves by ${deltaText(c.delta)}${c.delta > 0 ? ', and the orders waiting there are served, the oldest first' : ''}.`;
}

// ── The dialogs ────────────────────────────────────────────────────────────

const wholeIn = (text: string | undefined, min: number, max: number): number | null => {
  const t = (text ?? '').trim();
  if (!/^[-+]?\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** A correction: up or down, never 0, with why. */
export function correctionProblem(v: Record<string, string>): string | null {
  const n = wholeIn(v.delta, -LOGISTICS_LIMITS.move, LOGISTICS_LIMITS.move);
  if (n === null || n === 0) return 'Correct the count by a number of pieces, up (12) or down (-2).';
  const why = (v.reason ?? '').trim();
  if (!why) return 'Say why the count changes.';
  if (why.length > LOGISTICS_LIMITS.reason) return `Why has at most ${LOGISTICS_LIMITS.reason} characters.`;
  return null;
}

export function correctionInput(skuId: string, locationId: string, v: Record<string, string>): { skuId: string; locationId: string; delta: number; reason: string } {
  return { skuId, locationId, delta: Number((v.delta ?? '').trim()), reason: (v.reason ?? '').trim() };
}

/** A transfer: pieces of the size from one location to another. */
export function transferProblem(v: Record<string, string>): string | null {
  if (!UUID_RE.test(v.fromLocationId ?? '') || !UUID_RE.test(v.toLocationId ?? '')) return 'Choose both locations.';
  if (v.fromLocationId === v.toLocationId) return 'A transfer goes to another location.';
  if (wholeIn(v.quantity, 1, LOGISTICS_LIMITS.move) === null) return `Move 1 to ${formatCount(LOGISTICS_LIMITS.move)} pieces.`;
  if ((v.note ?? '').trim().length > LOGISTICS_LIMITS.note) return `A note has at most ${LOGISTICS_LIMITS.note} characters.`;
  return null;
}

/** A minimum: 1 to 10 000 pieces, or none (empty). */
export function minimumProblem(v: Record<string, string>): string | null {
  const t = (v.minimum ?? '').trim();
  if (t === '') return null;
  return wholeIn(t, 1, LOGISTICS_LIMITS.minimum) === null ? `A minimum is 1 to ${formatCount(LOGISTICS_LIMITS.minimum)} pieces, or none.` : null;
}

export function minimumValue(v: Record<string, string>): number | null {
  const t = (v.minimum ?? '').trim();
  return t === '' ? null : Number(t);
}

/** The serials typed in Count pieces in: one per line (or separated by commas or spaces), in capitals, each once. */
export function serialsOf(text: string | undefined): string[] {
  const out: string[] = [];
  for (const s of (text ?? '').split(/[\s,;]+/)) {
    const v = s.trim().toUpperCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Count pieces in: 1 to 100 serials that read as ORBES serials, and why. */
export function countInProblem(v: Record<string, string>): string | null {
  const serials = serialsOf(v.serials);
  if (serials.length === 0) return 'Name at least one piece: O26-J-00184.';
  if (serials.length > LOGISTICS_LIMITS.countIn) return `Count in at most ${LOGISTICS_LIMITS.countIn} pieces at a time.`;
  const wrong = serials.find((s) => !PRODUCT_ID_RE.test(s));
  if (wrong) return `${wrong} is not a serial: a serial reads O26-J-00184.`;
  const note = (v.note ?? '').trim();
  if (!note) return 'Say in the note where the pieces come from.';
  if (note.length > LOGISTICS_LIMITS.reason) return `A note has at most ${LOGISTICS_LIMITS.reason} characters.`;
  return null;
}

/** The parcel back: the piece's state, and a note of at most 500 characters. */
export function receiveProblem(v: Record<string, string>): string | null {
  if (v.pieceState !== 'OK' && v.pieceState !== 'DAMAGED') return 'Say whether the piece is OK or damaged.';
  if ((v.note ?? '').trim().length > LOGISTICS_LIMITS.receiveNote) return `A note has at most ${LOGISTICS_LIMITS.receiveNote} characters.`;
  return null;
}

// ── To ship and a parcel (step 5.11b) ──────────────────────────────────────

/** The packing photo's longer side, at most, as the console scales it before sending (≤ 1 MiB as a JPEG). */
export const PACKING_PHOTO_MAX_SIDE = 1600;

export const TO_SHIP_TEXT = Object.freeze({
  title: 'To ship',
  lead: 'Paid orders whose pieces are all in stock, the oldest first. An order of several pieces ships in one parcel, once every piece is there.',
  empty: 'Nothing to ship: no paid order has its pieces in stock.',
  onItsWay: 'On its way',
  onItsWayEmpty: 'No parcel on its way.',
});

/** A parcel's step as its mark reads. */
export const PARCEL_STEP_LABELS: Readonly<Record<ParcelStep, string>> = Object.freeze({
  NOT_READY: 'NOT READY',
  READY_TO_PACK: 'READY TO PACK',
  PACKING: 'PACKING',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  BACK_TO_SENDER: 'BACK TO SENDER',
  LOST: 'LOST',
  DAMAGED: 'DAMAGED',
});

/** The other orders travelling in a parcel: '+ 2 pieces'; null when it holds one. */
export function othersText(others: number): string | null {
  return others > 0 ? `+ ${formatCount(others)} ${others === 1 ? 'piece' : 'pieces'}` : null;
}

/** A piece as the agent picks it: `MONOLITHE · BLUE`. */
export function pieceWords(p: { model: string; variant: string | null }): string {
  return p.variant ? `${p.model} · ${p.variant}` : p.model;
}

/** Ship to on the list: the name · the city (the address's last line) · the country, what is known of them. */
export function shipToLine(to: ToShipRow['shipTo']): string {
  const lines = (to.address ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const parts = [to.name, lines.at(-1) ?? null, to.country ? countryName(to.country) : null].filter((x): x is string => !!x);
  return parts.length ? parts.join(' · ') : 'Not entered';
}

export const PACKING_TEXT = Object.freeze({
  startTitle: 'Start packing',
  startText: 'From now on, the collector can no longer change the address or the engraving: only ORBES Client Services can.',
  started: 'Packing started.',
  scan: 'Scan the card',
  photo: 'Add the photo',
  photoAgain: 'Replace the photo',
  viewPhoto: 'View the photo',
  noPhoto: 'No photo yet.',
  photoNote: 'Seen by ORBES only, never by the collector. Deleted 14 days after delivery.',
  photoAdded: 'Photo added.',
  packed: 'Packed',
  packedToast: 'Packed.',
  shipTitle: 'Ship the parcel',
  shipText: 'The collector sees the carrier and the tracking link in YOUR ORDERS. Make the label and the customs papers with your carrier’s own tools.',
  trackingHint: '3 to 40 letters and digits.',
  shipped: 'Shipped.',
  notShipped: 'Not shipped yet.',
  deliveredTitle: 'Mark delivered',
  deliveredText: 'The parcel has reached the collector. It is also marked delivered by itself when the collector registers the piece with its card.',
  deliveredToast: 'Delivered.',
  reportTitle: 'Report a parcel problem',
  reportConfirm: 'Report',
  reportText: 'ORBES decides whether to ship another piece or refund the collector.',
  reported: 'Reported to ORBES.',
});

/** What happened to a parcel, as the agent reports it. */
export const PARCEL_PROBLEM_LABELS = Object.freeze({ BACK_TO_SENDER: 'Back to sender', LOST: 'Lost', DAMAGED: 'Damaged' } as const);

/** A parcel's history, step by step (services/parcels.ts PARCEL_HISTORY_ACTIONS). */
export const HISTORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'order.pack.start': 'Packing started',
  'order.pack.scan': 'Card scanned',
  'order.pack.photo': 'Photo added',
  'order.pack.check': 'Packed',
  'order.ship': 'Shipped',
  'order.deliver': 'Delivered',
  'order.reship': 'To ship again',
  'order.case.open': 'Request opened',
  'order.case.receive': 'Parcel back',
  'order.case.decide': 'Decided by ORBES',
  'order.case.cancel': 'Request cancelled',
  'order.cancel': 'Order cancelled',
});

/** Who made a parcel's change: a role, never a name. */
export const HISTORY_BY: Readonly<Record<ParcelActor, string>> = Object.freeze({ ORBES: 'ORBES', LOGISTICS: 'The agent', COLLECTOR: 'The collector', SYSTEM: 'ORBES' });

/** ADDRESS CHANGED's line: 'Changed on 7 Oct 2026 at 14:02 by the collector.' */
export function addressChangedLine(c: { at: string | Date; by: 'COLLECTOR' | 'STAFF' }): string {
  const [day, time] = formatDateTime(c.at).split(' · ');
  return `Changed on ${day}${time ? ` at ${time.replace(/ .*$/, '')}` : ''} by ${c.by === 'COLLECTOR' ? 'the collector' : 'ORBES Client Services'}.`;
}

/** A card scanned: the right piece, named. */
export function scanMessage(piece: { productId: string; sku: Pick<LogisticsSku, 'model' | 'variant' | 'sizeLabel'> }): string {
  return `${skuWords(piece.sku)} · ${piece.productId}: the right piece.`;
}

/** What may be done with a parcel now, by a role that acts on Logistics (`act`); the server stays the authority. */
export function parcelActions(view: Pick<ShippingOrderView, 'step' | 'shipment'>, act: boolean): { start: boolean; scan: boolean; photo: boolean; check: boolean; ship: boolean; deliver: boolean; report: boolean } {
  const packing = view.shipment?.status === 'PACKING';
  return {
    start: act && view.step === 'READY_TO_PACK',
    scan: act && packing,
    photo: act && packing,
    check: act && packing,
    ship: act && view.shipment?.status === 'PACKED',
    deliver: act && view.shipment?.status === 'SHIPPED',
    report: act && view.shipment?.status === 'SHIPPED',
  };
}

/** Packed may be pressed: every line ticked (the cards by their scans), and the photo added. */
export function checklistComplete(view: Pick<ShippingOrderView, 'checklist' | 'shipment'>, ticked: ReadonlySet<string>): boolean {
  return !!view.shipment?.photo && view.checklist.every((l) => (l.byScan ? l.ticked : ticked.has(l.key)));
}

const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

/** Ship: a carrier, a tracking number the server takes, each declared value an amount (ORBES staff). */
export function shipProblem(v: Record<string, string>, declared: readonly { orderId: string; currency: string | null }[]): string | null {
  if (!UUID_RE.test(v.carrierId ?? '')) return 'Choose a carrier.';
  if (!TRACKING_RE.test((v.trackingNumber ?? '').trim())) return 'A tracking number has 3 to 40 letters and digits.';
  for (const d of declared) {
    const t = (v[`declared_${d.orderId}`] ?? '').trim();
    if (t === '') continue;
    if (!d.currency) return 'Enter the order’s price first to declare a value.';
    // As Ship sends it (parseMoney): a value it cannot read is refused here, never dropped.
    if (parseMoney(t) === null) return 'A declared value reads 4800, or 4800.50.';
  }
  return null;
}

/** A parcel problem: what happened, and a note. */
export function reportProblem(v: Record<string, string>): string | null {
  if (!(v.kind in PARCEL_PROBLEM_LABELS)) return 'Say what happened.';
  const note = (v.note ?? '').trim();
  if (!note) return 'Say what happened in the note.';
  if (note.length > 1000) return 'A note has at most 1000 characters.';
  return null;
}

/** The agent's packing slip (§3.5.3): ORBES's rows without Channel, Release and Source, one block per piece. */
/** The For block of a packing slip (plan NEXT LOT §3.6.B, §1.1 (d)). */
export interface SlipBuyer {
  name: string | null;
  address: string | null;
  /** The country's English name, or null when none is entered. */
  country: string | null;
  /** The phone, or 'Not entered'. */
  phone: string;
  /** ADDRESS CHANGED's line, while the address was replaced after it was first entered and the parcel has not shipped. */
  changed: string | null;
}

/** A slip's For block from a delivery address and its change mark (null once shipped). */
export function slipBuyer(to: { name: string | null; address: string | null; country?: string | null; phone?: string | null }, changed: { at: string | Date; by: 'COLLECTOR' | 'STAFF' } | null): SlipBuyer {
  return {
    name: to.name,
    address: to.address,
    country: to.country ? countryName(to.country) : null,
    phone: to.phone ?? 'Not entered',
    changed: changed ? addressChangedLine(changed) : null,
  };
}

export interface ShippingSlip {
  reference: string;
  /** Where it ships: the country by its English name, the phone ('Not entered' without one), ADDRESS CHANGED's line until it ships. */
  buyer: SlipBuyer;
  pieces: { reference: string; piece: string; serial: string | null; size: string; addons: string[]; engraving: string | null; surprise: string | null }[];
}

export function shippingSlip(view: ShippingOrderView): ShippingSlip {
  return {
    reference: view.reference,
    buyer: slipBuyer(view.shipTo, view.addressChanged),
    pieces: view.orders.map((o) => ({
      reference: o.reference,
      piece: pieceWords(o),
      serial: o.piece?.productId ?? null,
      size: sizeText(o.sizeLabel),
      addons: o.addons,
      engraving: o.engraving,
      surprise: o.surprise,
    })),
  };
}

// ── Receptions (step 5.11c) ────────────────────────────────────────────────

/** The bounds of services/receptions.ts (RECEPTION_LIMITS, RECEPTION_RUNS). */
export const RECEPTION_LIMITS = Object.freeze({ pieces: 10_000, deliveryNote: 60, note: 1000, lineNote: 500, sheetRun: 48, cardRun: 50 });

export const RECEPTION_TEXT = Object.freeze({
  receiveTitle: 'Receive a delivery',
  receiveLead: 'A delivery has arrived: enter the supplier order’s reference from its delivery note, then count what is in it.',
  referenceHint: 'Its reference, for example SO-7C21A0B9.',
  open: 'Open',
  expectedTitle: 'Expected',
  receive: 'Receive',
  countText: 'Count every piece. A defective piece goes in Rejected: it gets no identity and goes back to the supplier. More pieces than ordered are accepted with a note. What is missing stays expected.',
  addExtra: 'Add a piece not on this order',
  notOnOrder: 'Not on the order',
  record: 'Record the reception',
  recorded: 'Reception recorded: ORBES confirms it.',
  toConfirmTitle: 'To confirm',
  toConfirmEmpty: 'No reception waiting for ORBES.',
  countAgain: 'Count again',
  confirmed: 'Reception confirmed: the identities are being issued.',
  sendBackText: 'The agent counts again and records the reception anew.',
  sentBack: 'Reception sent back.',
  cardsTitle: 'Cards to print',
  cardsText: 'Print the cards, put each card with its piece, then store the pieces. Each card carries the piece’s ORBES code and its claim code: keep them out of sight.',
  cardsEmpty: 'No cards to print.',
  printSheets: 'Print A4 sheets',
  printCards: 'Print one per page',
  attached: 'Cards attached',
  attachedText: 'Every card is with its piece. The cards can no longer be printed from here: a lost card needs a new claim code from ORBES.',
  attachedToast: 'Cards attached.',
  backTitle: 'Back to the supplier',
  backEmpty: 'Nothing to send back to a supplier.',
  returnSent: 'Sent back',
  returnSentTitle: 'Sent back to the supplier',
  returnSentToast: 'Sent back to the supplier.',
});

/** A reception's status as its mark reads. */
export const RECEPTION_STATUS_LABELS: Readonly<Record<ReceptionStatus, string>> = Object.freeze({ TO_CONFIRM: 'TO CONFIRM', SENT_BACK: 'SENT BACK', CONFIRMED: 'CONFIRMED' });

const pieces = (n: number) => `${formatCount(n)} ${n === 1 ? 'piece' : 'pieces'}`;

/** ORBES's Expected list's lead and empty line, for a location (or every one). */
export function expectedLead(location: string | null): string {
  return `Supplier orders on their way to ${location ?? 'your locations'}. Open one when its parcel arrives, and count what is in it.`;
}

export function expectedEmpty(location: string | null): string {
  return `No supplier order on its way to ${location ?? 'your locations'}.`;
}

/** A reception waiting for ORBES: 'SO-7C21A0B9 · 48 OK · 2 rejected · waiting for ORBES'. */
export function receptionSummary(v: Pick<ReceptionView, 'supplierOrder' | 'accepted' | 'rejected' | 'status'>): string {
  const counts = `${v.supplierOrder.reference} · ${formatCount(v.accepted)} OK · ${formatCount(v.rejected)} rejected`;
  return v.status === 'TO_CONFIRM' ? `${counts} · waiting for ORBES` : counts;
}

/** A confirmed reception's cards: 'SO-7C21A0B9 · 48 cards'. */
export function cardsLine(v: Pick<ReceptionView, 'supplierOrder' | 'issuing'>): string {
  return `${v.supplierOrder.reference} · ${formatCount(v.issuing.accepted)} ${v.issuing.accepted === 1 ? 'card' : 'cards'}`;
}

/** While the identities are issued: 'Issuing the identities: 150 of 500.'; null once every one is. */
export function issuingLine(v: Pick<ReceptionView, 'issuing'>): string | null {
  return v.issuing.done ? null : `Issuing the identities: ${formatCount(v.issuing.issued)} of ${formatCount(v.issuing.accepted)}.`;
}

/** Rejected pieces to send back: 'SO-7C21A0B9 · MONOLITHE · BLUE · 52 · 2 pieces · TO RETURN'. */
export function supplierReturnLine(x: SupplierReturnItem): string {
  return `${x.supplierOrder.reference} · ${skuWords(x.sku)} · ${pieces(x.quantity)} · ${x.status === 'TO_RETURN' ? 'TO RETURN' : 'RETURNED'}`;
}

/** What confirming a reception does, said in its dialog (§3.5.4.1). */
export function confirmReceptionText(v: Pick<ReceptionView, 'supplierOrder' | 'accepted' | 'rejected' | 'location'>): string {
  const out: string[] = [];
  if (v.accepted > 0) {
    out.push(
      `${pieces(v.accepted)} ${v.accepted === 1 ? 'gets its' : 'get their'} ORBES identity now: a serial, a signed ORBES code and a claim code each. ${v.accepted === 1 ? 'It enters' : 'They enter'} the stock at ${v.location.name} and ${v.accepted === 1 ? 'goes' : 'go'} to the orders waiting for ${v.accepted === 1 ? 'it' : 'them'}, the oldest first. The agent then prints their cards.`,
    );
  }
  if (v.rejected > 0) out.push(`${formatCount(v.rejected)} rejected ${v.rejected === 1 ? 'piece gets' : 'pieces get'} no identity: ${v.rejected === 1 ? 'it is' : 'they are'} listed TO RETURN on ${v.supplierOrder.reference}.`);
  return out.join(' ');
}

/** The reference typed from the delivery note, as the server reads it (SO-7C21A0B9, any case, the dash optional). */
export function referenceProblem(text: string | undefined): string | null {
  return /^SO-?[0-9A-F]{8}$/i.test((text ?? '').trim()) ? null : 'A supplier order’s reference reads SO-7C21A0B9.';
}

const countOf = (text: string | undefined): number | null => {
  const t = (text ?? '').trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= RECEPTION_LIMITS.pieces ? n : null;
};

/** A count's check: whole numbers, at least one piece, a note where more than expected or a size not on the order came in. */
export function receptionProblem(order: Pick<ReceptionOrder, 'lines'>, extras: readonly Pick<LogisticsSku, 'id'>[], v: Record<string, string>): string | null {
  let any = false;
  const rows = [...order.lines.map((l) => ({ id: l.sku.id, expected: l.expected as number | null })), ...extras.map((k) => ({ id: k.id, expected: null }))];
  for (const r of rows) {
    const accepted = countOf(v[`accepted_${r.id}`]);
    const rejected = countOf(v[`rejected_${r.id}`]);
    if (accepted === null || rejected === null) return `Count each line in whole pieces, 0 to ${formatCount(RECEPTION_LIMITS.pieces)}.`;
    if (accepted + rejected > 0) any = true;
    const note = (v[`note_${r.id}`] ?? '').trim();
    if (note.length > RECEPTION_LIMITS.lineNote) return `A line’s note has at most ${RECEPTION_LIMITS.lineNote} characters.`;
    if (!note && ((r.expected === null && accepted + rejected > 0) || (r.expected !== null && accepted > r.expected))) return 'Say in a note why more pieces than expected, or a piece not on the order, came in.';
  }
  if (!any) return 'Count at least one piece.';
  const delivery = (v.deliveryNote ?? '').trim();
  if (delivery.length > RECEPTION_LIMITS.deliveryNote || delivery.includes('\n')) return `The delivery note is one line of at most ${RECEPTION_LIMITS.deliveryNote} characters.`;
  if ((v.note ?? '').trim().length > RECEPTION_LIMITS.note) return `A note has at most ${formatCount(RECEPTION_LIMITS.note)} characters.`;
  return null;
}

/** What Record the reception sends: every line counted (none at 0), its note; the delivery note and the note. */
export function receptionInputOf(order: Pick<ReceptionOrder, 'lines'>, extras: readonly Pick<LogisticsSku, 'id'>[], v: Record<string, string>): ReceptionInput {
  const ids = [...order.lines.map((l) => l.sku.id), ...extras.map((k) => k.id)];
  const lines = ids
    .map((id) => ({ skuId: id, accepted: countOf(v[`accepted_${id}`]) ?? 0, rejected: countOf(v[`rejected_${id}`]) ?? 0, note: (v[`note_${id}`] ?? '').trim() || null }))
    .filter((l) => l.accepted + l.rejected > 0);
  return { lines, deliveryNote: (v.deliveryNote ?? '').trim() || null, note: (v.note ?? '').trim() || null };
}

/** A run's button: the layout's words alone for a single run, its number when there are several. */
export function runLabel(layout: 'sheet' | 'card', run: number, runs: number): string {
  const words = layout === 'sheet' ? RECEPTION_TEXT.printSheets : RECEPTION_TEXT.printCards;
  return runs > 1 ? `${words} · run ${formatCount(run)}` : words;
}

/** What a printed run skipped, said after it: null when nothing was. */
export function skippedLine(skipped: readonly { productId: string; reason: string }[]): string | null {
  if (skipped.length === 0) return null;
  return `Not printed: ${skipped.map((x) => x.productId).join(', ')} (registered, packed for an order, replaced or no longer readable). Tell ORBES.`;
}

/** Sent back to the supplier: a tracking number comes with its carrier, as the server takes it. */
export function supplierReturnProblem(v: Record<string, string>): string | null {
  const tracking = (v.trackingNumber ?? '').trim();
  if (tracking === '') return null;
  if (!v.carrierId) return 'A tracking number comes with its carrier.';
  return TRACKING_RE.test(tracking) ? null : 'A tracking number has 3 to 40 letters and digits.';
}
