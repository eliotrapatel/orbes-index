/**
 * Order cases (plan NEXT LOT of 2026-10-07, §1.1 (b) and §3.5.6.7, step 5.10; migration 0037, DATABASE §5.87): one
 * service for every return, size exchange and parcel problem. « Client Services opens them, the agent receives the
 * parcel and records the piece's state (OK or damaged), and ORBES decides: back to stock, refund, or ship the other
 * size »; « A lost or damaged parcel: the agent or Client Services marks it LOST or DAMAGED, which opens a case. ORBES
 * decides whether to re-ship from stock (ahead of the oldest-first queue) or refund. The lost piece's identity is
 * revoked ».
 *
 *   open      Client Services (OPERATOR) opens a RETURN or a size EXCHANGE on an order SHIPPED or DELIVERED, at any
 *             time (question 20 as built: the collector's own 14 days do not bind Client Services), with a reason and a
 *             note; an exchange names one of its model's other sizes in stock at the order's location (409
 *             EXCHANGE_SIZE_NOT_IN_STOCK).
 *   request   the collector's own (plan NEXT LOT §3.6.D, step 6.9; POST /api/v1/account/orders/:id/case): a RETURN or a
 *             size EXCHANGE of its own order DELIVERED, not a welcome gift (409 RETURN_NOT_ALLOWED), within 14 days of
 *             its delivery (409 RETURN_WINDOW_CLOSED), with one of the four reasons and an optional note; an exchange
 *             names another of its model's sizes, available at the order's location now (409
 *             EXCHANGE_SIZE_NOT_IN_STOCK; the size is not held). The case opens at once, and the request is written into
 *             the collector's MESSAGES as its own message, in the same transaction (MessageService.writeIn, without the
 *             message rate).
 *   report    the agent or Client Services reports a parcel SHIPPED BACK_TO_SENDER, LOST or DAMAGED, with a note: a case
 *             naming the shipment, whose status takes its kind.
 *   receive   the agent records the parcel back (a return, an exchange, a parcel back to sender or damaged; never a lost
 *             one) and the piece's state, OK or DAMAGED: RECEIVED.
 *   decide    ORBES (OPERATOR; a LOST parcel and the archive: ADMIN), once the agent recorded the parcel back (409
 *             ORDER_CASE_NOT_RECEIVED; a LOST parcel from OPEN):
 *               a return or an exchange: the return's core (services/orders.ts returnInTransaction: back to stock with
 *               a new claim code shown once, or to the archive; the ownership taken back; the credit note), then for an
 *               EXCHANGE the EXCHANGE order, PAID at once with its own invoice, the original's credit carried onto it;
 *               a parcel problem: each order of the parcel SHIPPED → PAID (`order.reship`). BACK_TO_SENDER: its pieces
 *               back in stock (RETURNED +1), still bound, to pack again (RESHIP), or freed (REFUND: the order
 *               cancelled, a credit note). DAMAGED: each piece back to stock (RETURNED +1, unbound, at the location
 *               ORBES chose, the order's by default; a new claim code, shown once to staff in the answer, as a
 *               return's, so its new card is printed) or to the archive (RETIRED, ADMIN), as ORBES chooses from the
 *               agent's record. LOST: each piece REVOKED (ADMIN), unbound. RESHIP after DAMAGED or LOST holds new
 *               pieces ahead of the queue (`queue_first`); REFUND cancels. Each order's `order.reship` event says what
 *               it holds after the decision (`reservation`), so its readiness restarts then (fulfilment.ts readySince).
 *   cancel    Client Services ends a case with no decision (a request refused or withdrawn; a damaged parcel that never
 *             came back, to report it lost): CANCELLED; a parcel problem's shipment SHIPPED again.
 *
 * One case not ended per order (409 ORDER_CASE_OPEN). Each method takes the order's row (a parcel's orders) FOR UPDATE,
 * then the case's; a decision takes the pieces first, as a return does. The note, the agent's and ORBES's words are
 * personal data: never in the audit log, the order's events nor the journal (`order.case.open`, `.receive`, `.decide`,
 * `.cancel` carry ids, kinds, states and outcomes). The agent reaches only the cases of its locations (404 outside).
 */
import { inRetriedTransaction, inTransaction, type Db } from '../db/connection.js';
import type {
  OrderCaseKind,
  OrderCaseOutcome,
  OrderCasePieceDestination,
  OrderCasePieceState,
  OrderCaseReason,
  OrderCaseRow,
  OrderCaseStatus,
  OrderRow,
  ProductRow,
  ProductStatus,
} from '../db/schema.js';
import { ORDER_CASE_PIECE_STATES, ORDER_CASE_REASONS } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import { lockPieces, peekClaimRenewals, withdrawWaiting } from './claim-renewals.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { LifecycleService } from './lifecycle.js';
import { createExchangeOrder, hold, lockOrder, orderReference, recordChange, returnInTransaction, serveWaiting, step, updateOrder } from './orders.js';
import { parcelKeyOf, parcelOrders } from './parcels.js';
import type { LocationScope } from './receptions.js';
import { sizesForExchange } from './sizes.js';
import type { MessageService } from './messages.js';
import { customerAccountLocked } from './auth.js';
import { RETURN_WINDOW_DAYS } from './parcels.js';
import { knownLocation, lockSku, recordMovement } from './stock.js';

/** A size as the request names it: SIZE 18, or a label that already carries its word as written (SIZE 52, ONE SIZE), as the app's sizeName and drops.ts inSize do. */
const sizeWords = (label: string) => (/^(SIZE\b|ONE SIZE$)/i.test(label.trim()) ? label : `SIZE ${label}`);

// ── Rules ──────────────────────────────────────────────────────────────────

/** The words of an order case, at most (the CHECKs of migration 0037). */
export const ORDER_CASE_LIMITS = Object.freeze({ note: 1000, receiveNote: 500, decisionNote: 1000, cancelNote: 1000 });
/** The kinds Client Services opens; the parcel problems the agent or Client Services reports. */
export const OPENED_KINDS = Object.freeze(['RETURN', 'EXCHANGE'] as const);
export const PARCEL_PROBLEMS = Object.freeze(['BACK_TO_SENDER', 'LOST', 'DAMAGED'] as const);
export type ParcelProblem = (typeof PARCEL_PROBLEMS)[number];
/** The cases whose parcel comes back to the agent: every kind but a lost parcel. */
const RECEIVABLE: readonly OrderCaseKind[] = Object.freeze(['RETURN', 'EXCHANGE', 'BACK_TO_SENDER', 'DAMAGED']);
const NOT_ENDED: readonly OrderCaseStatus[] = Object.freeze(['OPEN', 'RECEIVED']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const inScope = (scope: LocationScope, locationId: string) => scope === null || scope.has(locationId);

// ── Errors ─────────────────────────────────────────────────────────────────

const caseNotFound = () => notFound('Order case', 'ORDER_CASE_NOT_FOUND');
const orderNotFound = () => notFound('Order', 'ORDER_NOT_FOUND');
export const caseOpen = () => conflict('ORDER_CASE_OPEN', 'A request is already open for this order.');
const notReceived = () => conflict('ORDER_CASE_NOT_RECEIVED', 'The agent records the parcel before you decide.');
const caseEnded = () => conflict('ORDER_CASE_CLOSED', 'This request is already decided or cancelled.');
const alreadyReceived = () => conflict('ORDER_CASE_RECEIVED', 'The parcel of this request is already recorded.');
const lostNotReceived = () => conflict('ORDER_CASE_NOT_RECEIVABLE', 'A lost parcel does not come back: ORBES decides it as it stands.');
export const exchangeSizeOut = () => conflict('EXCHANGE_SIZE_NOT_IN_STOCK', 'This size is no longer in stock. Choose another.');
const notShippedOrDelivered = (from: string) => new DomainError('ORDER_TRANSITION_NOT_ALLOWED', 409, 'This order cannot move to that step.', { detail: `${from} → order case` });
const noShippedParcel = () => notFound('Shipment', 'SHIPMENT_NOT_FOUND');
/** Plan NEXT LOT §3.6.D: the collector's own request. */
export const returnWindowClosed = () => conflict('RETURN_WINDOW_CLOSED', 'The 14 days to return this piece have passed. ORBES Client Services can assist you.');
const returnNotAllowed = () => conflict('RETURN_NOT_ALLOWED', 'This piece cannot be returned from here. ORBES Client Services can assist you.');

/** The reasons a collector gives, as its message in MESSAGES says them (plan NEXT LOT §3.6.D). */
export const ORDER_CASE_REASON_WORDS: Readonly<Record<OrderCaseReason, string>> = Object.freeze({
  SIZE: 'The size does not fit',
  NOT_AS_EXPECTED: 'The piece is not as I expected',
  DAMAGED: 'The piece arrived damaged',
  OTHER: 'Another reason',
});
/** The collector's note, at most (the app's field; the table takes 1 000). */
export const ORDER_CASE_COLLECTOR_NOTE_MAX = 500;
const DAY_MS = 24 * 60 * 60_000;

// ── Views ──────────────────────────────────────────────────────────────────

/** An order case as the console reads it (GET /api/admin/order-cases/:id); the route withholds every note from an AUDITOR. */
export interface OrderCaseRecord {
  id: string;
  order: { id: string; reference: string };
  kind: OrderCaseKind;
  status: OrderCaseStatus;
  openedBy: 'COLLECTOR' | 'CLIENT_SERVICES';
  openedAt: Date;
  reason: OrderCaseReason | null;
  /** The client's or the staff member's words. */
  note: string | null;
  /** An exchange's size asked, and what is available of it at the order's location now. */
  exchange: { skuId: string; sizeLabel: string; available: number } | null;
  /** A parcel problem's shipment, and the orders it carried. */
  shipment: { id: string; orders: { id: string; reference: string }[] } | null;
  messageId: string | null;
  /** The collector's conversation its request was written into (plan NEXT LOT §3.6.D: the order page links it); null without one. */
  conversationId: string | null;
  received: { at: Date; pieceState: OrderCasePieceState; note: string | null } | null;
  decision: { at: Date; outcome: OrderCaseOutcome; pieceTo: OrderCasePieceDestination | null; exchangeOrder: { id: string; reference: string } | null; note: string | null } | null;
  /** Its note withheld (null) from an AUDITOR, as every note of the case. */
  cancelled: { at: Date; note: string | null } | null;
}

/** A case whose parcel the agent expects back (Logistics → Returns → To receive): no note, no price, no account. */
export interface CaseToReceive {
  id: string;
  order: { id: string; reference: string };
  kind: OrderCaseKind;
  pieces: { model: string; variant: string | null; sizeLabel: string | null }[];
  openedAt: Date;
  location: { id: string; name: string };
}

/** What Client Services opens (`Open a return`). */
export interface OpenCaseInput {
  kind: 'RETURN' | 'EXCHANGE';
  reason: OrderCaseReason;
  /** An exchange's new size. */
  exchangeSkuId?: string | null;
  note: string;
}

/** ORBES's decision: a return's or an exchange's (REFUND, EXCHANGE), or a parcel problem's (RESHIP, REFUND). */
export interface DecideCaseInput {
  decision: 'REFUND' | 'EXCHANGE' | 'RESHIP';
  /** Where the piece goes: back to stock (at `locationId`, the order's location by default) or to the archive (ADMIN). */
  pieceTo?: 'RESTOCKED' | 'ARCHIVED' | null;
  locationId?: string | null;
  note?: string | null;
}

/**
 * A decision taken: the case, and the claim code of a returned piece's new card (shown once); for a damaged parcel's
 * pieces back to stock, each piece's new claim code (shown once), so staff print the card that goes with it again.
 */
export interface CaseDecided {
  case: OrderCaseRecord;
  claimCode?: string;
  productId?: string;
  claimCodes?: { productId: string; claimCode: string }[];
}

// ── Checks ─────────────────────────────────────────────────────────────────

function known(id: unknown, err: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw err();
  return id.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only ORBES staff and the logistics agent handle an order case.');
}

function cleanText(v: unknown, max: number, label: string, required: boolean): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw validationError(`${label} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

const isParcelProblem = (k: OrderCaseKind): k is ParcelProblem => (PARCEL_PROBLEMS as readonly string[]).includes(k);

// ── Service ────────────────────────────────────────────────────────────────

export interface OrderCaseServiceDeps {
  db: Db;
  audit: AuditService;
  lifecycle?: LifecycleService;
  clock?: Clock;
  /** Writes a collector's request into its MESSAGES (plan NEXT LOT §3.6.D). */
  messages?: MessageService;
}

/** What the collector asks (POST /api/v1/account/orders/:id/case). */
export interface RequestCaseInput {
  kind: 'RETURN' | 'EXCHANGE';
  reason: OrderCaseReason;
  note?: string | null;
  /** An exchange's new size, by its label. */
  sizeLabel?: string | null;
}

export class OrderCaseService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly lifecycle: LifecycleService;
  private readonly clock: Clock;
  private readonly messages: MessageService | undefined;

  constructor(deps: OrderCaseServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.messages = deps.messages;
    this.lifecycle = deps.lifecycle ?? new LifecycleService({ db: deps.db, audit: deps.audit, clock: this.clock });
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  /** One order case (404 ORDER_CASE_NOT_FOUND). */
  async get(caseId: string): Promise<OrderCaseRecord> {
    const id = known(caseId, caseNotFound);
    const c = await this.db.selectFrom('order_cases').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) throw caseNotFound();
    return this.record(this.db, c);
  }

  /** The order cases of an order, the newest first (the order page's Order case section). */
  async forOrder(orderId: string): Promise<OrderCaseRecord[]> {
    const id = known(orderId, orderNotFound);
    const rows = await this.db.selectFrom('order_cases').selectAll().where('order_id', '=', id).orderBy('opened_at', 'desc').orderBy('id').execute();
    return Promise.all(rows.map((c) => this.record(this.db, c)));
  }

  private async record(db: Db, c: OrderCaseRow): Promise<OrderCaseRecord> {
    const order = await db.selectFrom('orders').select(['id', 'location_id']).where('id', '=', c.order_id).executeTakeFirstOrThrow();
    let exchange: OrderCaseRecord['exchange'] = null;
    if (c.exchange_sku_id && c.exchange_size_label) {
      const sizes = await sizesForExchange(db, c.order_id);
      exchange = { skuId: c.exchange_sku_id, sizeLabel: c.exchange_size_label, available: sizes.find((s) => s.skuId === c.exchange_sku_id)?.available ?? 0 };
    }
    const items = c.shipment_id ? await db.selectFrom('shipment_items').select('order_id').where('shipment_id', '=', c.shipment_id).orderBy('order_id').execute() : [];
    const message = c.message_id ? await db.selectFrom('client_messages').select('conversation_id').where('id', '=', c.message_id).executeTakeFirst() : undefined;
    return {
      id: c.id,
      order: { id: order.id, reference: orderReference(order.id) },
      kind: c.kind,
      status: c.status,
      openedBy: c.opened_by_type === 'account' ? 'COLLECTOR' : 'CLIENT_SERVICES',
      openedAt: c.opened_at,
      reason: c.reason,
      note: c.note,
      exchange,
      shipment: c.shipment_id ? { id: c.shipment_id, orders: items.map((i) => ({ id: i.order_id, reference: orderReference(i.order_id) })) } : null,
      messageId: c.message_id,
      conversationId: message?.conversation_id ?? null,
      received: c.received_at && c.piece_state ? { at: c.received_at, pieceState: c.piece_state, note: c.receive_note } : null,
      decision:
        c.closed_at && c.outcome
          ? { at: c.closed_at, outcome: c.outcome, pieceTo: c.piece_to, exchangeOrder: c.exchange_order_id ? { id: c.exchange_order_id, reference: orderReference(c.exchange_order_id) } : null, note: c.decision_note }
          : null,
      cancelled: c.cancelled_at && c.cancel_note ? { at: c.cancelled_at, note: c.cancel_note } : null,
    };
  }

  /** Where a case's parcel comes back: its shipment's location, or its order's. */
  private async locationOf(db: Db, c: Pick<OrderCaseRow, 'order_id' | 'shipment_id'>): Promise<string> {
    if (c.shipment_id) return (await db.selectFrom('shipments').select('location_id').where('id', '=', c.shipment_id).executeTakeFirstOrThrow()).location_id;
    return (await db.selectFrom('orders').select('location_id').where('id', '=', c.order_id).executeTakeFirstOrThrow()).location_id;
  }

  /**
   * The cases whose parcel the agent expects back at the scope's locations (OPEN returns, exchanges, parcels back to
   * sender or damaged), the oldest first; `?locationId=` narrows.
   */
  async toReceive(scope: LocationScope, filter: { locationId?: string } = {}): Promise<CaseToReceive[]> {
    const rows = await this.db.selectFrom('order_cases').selectAll().where('status', '=', 'OPEN').where('kind', 'in', [...RECEIVABLE]).orderBy('opened_at').orderBy('id').execute();
    const out: CaseToReceive[] = [];
    const names = new Map((await this.db.selectFrom('stock_locations').select(['id', 'name']).execute()).map((l) => [l.id, l.name]));
    for (const c of rows) {
      const locationId = await this.locationOf(this.db, c);
      if (!inScope(scope, locationId) || (filter.locationId && filter.locationId !== locationId)) continue;
      const orderIds = c.shipment_id ? (await this.db.selectFrom('shipment_items').select('order_id').where('shipment_id', '=', c.shipment_id).execute()).map((i) => i.order_id) : [c.order_id];
      const pieces = await this.db
        .selectFrom('orders as o')
        .innerJoin('models as m', 'm.id', 'o.model_id')
        .select(['m.name', 'm.variant_label', 'o.size_label', 'o.reserved_at', 'o.id'])
        .where('o.id', 'in', orderIds)
        .orderBy('o.reserved_at')
        .orderBy('o.id')
        .execute();
      out.push({
        id: c.id,
        order: { id: c.order_id, reference: orderReference(c.order_id) },
        kind: c.kind,
        pieces: pieces.map((p) => ({ model: p.name, variant: p.variant_label, sizeLabel: p.size_label })),
        openedAt: c.opened_at,
        location: { id: locationId, name: names.get(locationId) ?? '' },
      });
    }
    return out;
  }

  // ── Opening ──────────────────────────────────────────────────────────────

  /**
   * Client Services opens a return or a size exchange (`Open a return`) on an order SHIPPED or DELIVERED, at any time.
   * Audited `order.case.open` `{ caseId, kind, reason, sizeLabel?, by: 'admin' }`, never the note.
   */
  async open(orderId: string, input: OpenCaseInput, actor: Actor): Promise<OrderCaseRecord> {
    assertStaff(actor);
    const id = known(orderId, orderNotFound);
    if (!input || !(['RETURN', 'EXCHANGE'] as const).includes(input.kind)) throw validationError('An order case opened by Client Services is a RETURN or an EXCHANGE.');
    if (!(ORDER_CASE_REASONS as readonly string[]).includes(input.reason)) throw validationError(`A reason is ${ORDER_CASE_REASONS.join(', ')}.`);
    const note = cleanText(input.note, ORDER_CASE_LIMITS.note, 'The note', true)!;
    const exchangeSkuId = input.kind === 'EXCHANGE' ? known(input.exchangeSkuId, () => validationError('Choose the new size.')) : null;
    if (input.kind === 'RETURN' && input.exchangeSkuId) throw validationError('A return names no new size.');
    const caseId = await inTransaction(this.db, async (tx) => {
      const o = await lockOrder(tx, id);
      if (o.status !== 'SHIPPED' && o.status !== 'DELIVERED') throw notShippedOrDelivered(o.status);
      await this.assertNoOpenCase(tx, [o.id]);
      let sizeLabel: string | null = null;
      if (exchangeSkuId) {
        const size = (await sizesForExchange(tx, o.id)).find((s) => s.skuId === exchangeSkuId);
        if (!size || size.label === null) throw validationError("Choose one of the model's other sizes.");
        if (!size.selectable) throw exchangeSizeOut();
        sizeLabel = size.label;
      }
      const now = this.clock();
      const c = await tx
        .insertInto('order_cases')
        .values({ order_id: o.id, kind: input.kind, opened_by_type: 'admin', opened_by_id: actor.id!, opened_at: now, reason: input.reason, note, exchange_sku_id: exchangeSkuId, exchange_size_label: sizeLabel })
        .returning('id')
        .executeTakeFirstOrThrow();
      const n = await recordChange(tx, o, o, 'order.case.open', { details: { caseId: c.id, kind: input.kind, reason: input.reason, ...(sizeLabel ? { sizeLabel } : {}), by: 'admin' } }, actor, now);
      await this.audit.record(n, tx);
      return c.id;
    });
    return this.get(caseId);
  }

  /**
   * The collector's own request (REQUEST A RETURN, EXCHANGE THE SIZE; plan NEXT LOT §3.6.D): see the header. In one
   * transaction, the account FOR SHARE (403 ACCOUNT_LOCKED), its order's row FOR UPDATE (404 ORDER_NOT_FOUND for another
   * account's), the case inserted after its message (`message_id`). Audited `order.case.open` `{ caseId, kind, reason,
   * sizeLabel?, by: 'account' }` with the account as actor, and `message.write`; never the note. Returns the case's id.
   */
  async request(accountId: string, orderId: string, input: RequestCaseInput, actor: Actor): Promise<string> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const account = accountId.toLowerCase();
    const id = known(orderId, orderNotFound);
    if (!input || !(['RETURN', 'EXCHANGE'] as const).includes(input.kind)) throw validationError('Ask for a return or an exchange of size.');
    if (!(ORDER_CASE_REASONS as readonly string[]).includes(input.reason)) throw validationError('Choose a reason.');
    const note = cleanText(input.note, ORDER_CASE_COLLECTOR_NOTE_MAX, 'Your note', false);
    const asked = input.kind === 'EXCHANGE' ? (typeof input.sizeLabel === 'string' ? input.sizeLabel.trim() : '') : null;
    if (input.kind === 'EXCHANGE' && !asked) throw validationError('Choose the new size.');
    if (input.kind === 'RETURN' && input.sizeLabel) throw validationError('A return names no new size.');
    if (!this.messages) throw new Error('OrderCaseService.request: no MessageService');
    const messages = this.messages;
    return inTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', account).forShare().executeTakeFirst();
      if (!a) throw orderNotFound();
      if (a.status !== 'ACTIVE') throw customerAccountLocked();
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).where('account_id', '=', account).forUpdate().executeTakeFirst();
      if (!o) throw orderNotFound();
      if (o.status !== 'DELIVERED' || o.channel === 'GIFT' || o.delivered_at === null) throw returnNotAllowed();
      const now = this.clock();
      if (now.getTime() >= o.delivered_at.getTime() + RETURN_WINDOW_DAYS * DAY_MS) throw returnWindowClosed();
      await this.assertNoOpenCase(tx, [o.id]);
      let exchange: { skuId: string; label: string } | null = null;
      if (asked !== null) {
        const size = (await sizesForExchange(tx, o.id)).find((s) => s.label !== null && s.label.toUpperCase() === asked.toUpperCase());
        if (!size) throw validationError("Choose one of the model's other sizes.");
        if (!size.selectable) throw exchangeSizeOut();
        exchange = { skuId: size.skuId, label: size.label! };
      }
      // The request, as the collector's own message in MESSAGES: its reason, then its note.
      const head = exchange ? `EXCHANGE REQUESTED: ${sizeWords(exchange.label)} — ${ORDER_CASE_REASON_WORDS[input.reason]}.` : `RETURN REQUESTED — ${ORDER_CASE_REASON_WORDS[input.reason]}.`;
      const { message } = await messages.writeIn(tx, account, { body: note ? `${head}\n\n${note}` : head, context: { kind: 'ORDER', orderId: o.id } }, actor, { rate: false });
      const c = await tx
        .insertInto('order_cases')
        .values({
          order_id: o.id,
          kind: input.kind,
          opened_by_type: 'account',
          opened_by_id: account,
          opened_at: now,
          reason: input.reason,
          note,
          exchange_sku_id: exchange?.skuId ?? null,
          exchange_size_label: exchange?.label ?? null,
          message_id: message.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const n = await recordChange(tx, o, o, 'order.case.open', { details: { caseId: c.id, kind: input.kind, reason: input.reason, ...(exchange ? { sizeLabel: exchange.label } : {}), by: 'account' } }, actor, now);
      await this.audit.record(n, tx);
      return c.id;
    });
  }

  /**
   * A parcel problem reported (the agent's `Report a parcel problem`, or Client Services'): the parcel of `orderId`,
   * SHIPPED (404 SHIPMENT_NOT_FOUND otherwise), BACK_TO_SENDER, LOST or DAMAGED with a note. The case names the shipment,
   * whose status takes its kind. Audited `order.case.open` `{ caseId, kind, shipmentId, by: 'admin' }`, never the note.
   */
  async report(orderId: string, input: { kind: ParcelProblem; note: string }, actor: Actor, scope: LocationScope): Promise<OrderCaseRecord> {
    assertStaff(actor);
    const id = known(orderId, orderNotFound);
    if (!input || !(PARCEL_PROBLEMS as readonly string[]).includes(input.kind)) throw validationError(`A parcel problem is ${PARCEL_PROBLEMS.join(', ')}.`);
    const note = cleanText(input.note, ORDER_CASE_LIMITS.note, 'The note', true)!;
    const key = await parcelKeyOf(this.db, id);
    if (!key) throw orderNotFound();
    const caseId = await inTransaction(this.db, async (tx) => {
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const shipment = await tx.selectFrom('shipments').selectAll().where('order_id', '=', key).where('status', 'in', ['PACKING', 'PACKED', 'SHIPPED']).forUpdate().executeTakeFirst();
      if (shipment && !inScope(scope, shipment.location_id)) throw orderNotFound();
      if (!shipment && !inScope(scope, all[0]!.location_id)) throw orderNotFound();
      if (!shipment || shipment.status !== 'SHIPPED') throw noShippedParcel();
      const items = await tx.selectFrom('shipment_items').select('order_id').where('shipment_id', '=', shipment.id).execute();
      const members = all.filter((o) => items.some((i) => i.order_id === o.id));
      await this.assertNoOpenCase(tx, members.map((o) => o.id));
      const target = members.find((o) => o.id === id) ?? members[0]!;
      const now = this.clock();
      const c = await tx
        .insertInto('order_cases')
        .values({ order_id: target.id, shipment_id: shipment.id, kind: input.kind, opened_by_type: 'admin', opened_by_id: actor.id!, opened_at: now, note })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('shipments').set({ status: input.kind }).where('id', '=', shipment.id).execute();
      const n = await recordChange(tx, target, target, 'order.case.open', { details: { caseId: c.id, kind: input.kind, shipmentId: shipment.id, by: 'admin' } }, actor, now);
      await this.audit.record(n, tx);
      return c.id;
    });
    return this.get(caseId);
  }

  // ── The parcel back ──────────────────────────────────────────────────────

  /**
   * The agent records the parcel back and the piece's state (`OK`, `DAMAGED`), with an optional note: RECEIVED. A lost
   * parcel is never received (409 ORDER_CASE_NOT_RECEIVABLE). Audited `order.case.receive` `{ caseId, kind, pieceState }`.
   */
  async receive(caseId: string, input: { pieceState: OrderCasePieceState; note?: string | null }, actor: Actor, scope: LocationScope): Promise<OrderCaseRecord> {
    assertStaff(actor);
    const id = known(caseId, caseNotFound);
    if (!input || !(ORDER_CASE_PIECE_STATES as readonly string[]).includes(input.pieceState)) throw validationError('The piece is OK or DAMAGED.');
    const note = cleanText(input.note, ORDER_CASE_LIMITS.receiveNote, 'The note', false);
    const peek = await this.db.selectFrom('order_cases').select(['order_id', 'shipment_id']).where('id', '=', id).executeTakeFirst();
    if (!peek || !inScope(scope, await this.locationOf(this.db, peek))) throw caseNotFound();
    await inTransaction(this.db, async (tx) => {
      const o = await lockOrder(tx, peek.order_id);
      const c = await tx.selectFrom('order_cases').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (c.kind === 'LOST') throw lostNotReceived();
      if (c.status === 'RECEIVED') throw alreadyReceived();
      if (c.status !== 'OPEN') throw caseEnded();
      const now = this.clock();
      await tx.updateTable('order_cases').set({ status: 'RECEIVED', received_at: now < c.opened_at ? c.opened_at : now, received_by: actor.id!, piece_state: input.pieceState, receive_note: note }).where('id', '=', id).execute();
      const n = await recordChange(tx, o, o, 'order.case.receive', { details: { caseId: id, kind: c.kind, pieceState: input.pieceState } }, actor, now);
      await this.audit.record(n, tx);
    });
    return this.get(id);
  }

  // ── Deciding ─────────────────────────────────────────────────────────────

  /**
   * ORBES decides (OPERATOR; `admin` for a LOST parcel and for the archive, 403 otherwise). See the header. Audited
   * `order.case.decide` `{ caseId, kind, outcome, pieceTo }`, with what the decision does audited by its own steps.
   */
  async decide(caseId: string, input: DecideCaseInput, actor: Actor, opts: { admin: boolean }): Promise<CaseDecided> {
    assertStaff(actor);
    const id = known(caseId, caseNotFound);
    const c = await this.db.selectFrom('order_cases').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) throw caseNotFound();
    const decision = input?.decision;
    const allowed: Record<OrderCaseKind, readonly string[]> = { RETURN: ['REFUND'], EXCHANGE: ['REFUND', 'EXCHANGE'], BACK_TO_SENDER: ['RESHIP', 'REFUND'], LOST: ['RESHIP', 'REFUND'], DAMAGED: ['RESHIP', 'REFUND'] };
    if (!allowed[c.kind].includes(decision)) throw validationError(`This order case is decided ${allowed[c.kind].join(' or ')}.`);
    const note = cleanText(input.note, ORDER_CASE_LIMITS.decisionNote, 'The note', !isParcelProblem(c.kind));
    const pieceTo = input.pieceTo ?? null;
    if (pieceTo !== null && pieceTo !== 'RESTOCKED' && pieceTo !== 'ARCHIVED') throw validationError('The piece goes back to stock (RESTOCKED) or to the archive (ARCHIVED).');
    if ((c.kind === 'RETURN' || c.kind === 'EXCHANGE' || c.kind === 'DAMAGED') && pieceTo === null) throw validationError('Say where the piece goes: back to stock or to the archive.');
    if ((c.kind === 'BACK_TO_SENDER' || c.kind === 'LOST') && pieceTo !== null) throw validationError('This parcel problem decides no destination for its pieces.');
    if (pieceTo === 'ARCHIVED' && input.locationId) throw validationError('A piece archived goes to no location.');
    if ((c.kind === 'LOST' || pieceTo === 'ARCHIVED') && !opts.admin) throw forbidden(c.kind === 'LOST' ? 'Only an ADMIN decides a lost parcel: its pieces are revoked.' : 'Only an ADMIN can archive a returned piece.');
    if (!NOT_ENDED.includes(c.status)) throw caseEnded();
    if (c.kind !== 'LOST' && c.status !== 'RECEIVED') throw notReceived();
    const locationId = pieceTo === 'RESTOCKED' && input.locationId ? await knownLocation(this.db, input.locationId) : null;
    return isParcelProblem(c.kind)
      ? this.decideParcel(c, { decision: decision as 'RESHIP' | 'REFUND', pieceTo, locationId, note }, actor)
      : this.decideReturn(c, { decision: decision as 'REFUND' | 'EXCHANGE', pieceTo: pieceTo!, locationId, note: note! }, actor);
  }

  /** A return or an exchange decided: the return's core, then the EXCHANGE order. */
  private async decideReturn(c: OrderCaseRow, d: { decision: 'REFUND' | 'EXCHANGE'; pieceTo: 'RESTOCKED' | 'ARCHIVED'; locationId: string | null; note: string }, actor: Actor): Promise<CaseDecided> {
    const peek = await this.db
      .selectFrom('orders as o')
      .leftJoin('ownership as w', (j) => j.onRef('w.product_id', '=', 'o.product_id').on('w.ended_at', 'is', null))
      .select(['o.id', 'o.product_id', 'o.location_id', 'w.id as ownership_id'])
      .where('o.id', '=', c.order_id)
      .executeTakeFirstOrThrow();
    const claimCode = d.pieceTo === 'RESTOCKED' ? generateClaimCode() : undefined;
    const claimHash = claimCode ? await hashClaimCode(claimCode) : null;
    let productId = '';
    await inRetriedTransaction(this.db, async (tx) => {
      if (peek.product_id !== null) await tx.selectFrom('products').select('id').where('id', '=', peek.product_id).forUpdate().execute();
      const o = await lockOrder(tx, c.order_id);
      const fresh = await tx.selectFrom('order_cases').selectAll().where('id', '=', c.id).forUpdate().executeTakeFirstOrThrow();
      if (!NOT_ENDED.includes(fresh.status)) throw caseEnded();
      if (fresh.status !== 'RECEIVED') throw notReceived();
      const now = this.clock();
      const notes: AuditRecordInput[] = [];
      const location = d.pieceTo === 'RESTOCKED' ? (d.locationId ?? o.location_id) : null;
      const done = await returnInTransaction(tx, o, { outcome: d.pieceTo, locationId: location, note: d.note, caseId: c.id }, { productId: peek.product_id, reclaim: peek.ownership_id !== null, claimHash }, actor, now, notes, this.lifecycle);
      let exchangeOrderId: string | null = null;
      if (d.decision === 'EXCHANGE') {
        // The size asked, still one of the model's (in stock or not: the exchange order then waits like any order).
        const sku = await tx.selectFrom('skus').select(['id', 'size_label']).where('id', '=', fresh.exchange_sku_id!).executeTakeFirstOrThrow();
        exchangeOrderId = (await createExchangeOrder(tx, done.after, { id: sku.id, label: sku.size_label }, actor, now, notes, done.credit)).id;
      }
      await tx
        .updateTable('order_cases')
        .set({ status: 'CLOSED', outcome: d.decision, piece_to: d.pieceTo, exchange_order_id: exchangeOrderId, decision_note: d.note, closed_at: now < fresh.opened_at ? fresh.opened_at : now, closed_by: actor.id! })
        .where('id', '=', c.id)
        .execute();
      notes.push(await recordChange(tx, done.after, done.after, 'order.case.decide', { details: { caseId: c.id, kind: c.kind, outcome: d.decision, pieceTo: d.pieceTo, ...(exchangeOrderId ? { exchangeOrderId } : {}) } }, actor, now));
      // Last: the piece's status (LifecycleService audits at once), then the entries of the decision.
      await done.finish();
      for (const n of notes) await this.audit.record(n, tx);
      productId = done.productId;
    });
    return { case: await this.get(c.id), productId, ...(claimCode ? { claimCode } : {}) };
  }

  /** A parcel problem decided: the parcel's orders shipped again, or refunded (see the header). */
  private async decideParcel(c: OrderCaseRow, d: { decision: 'RESHIP' | 'REFUND'; pieceTo: 'RESTOCKED' | 'ARCHIVED' | null; locationId: string | null; note: string | null }, actor: Actor): Promise<CaseDecided> {
    const shipment = await this.db.selectFrom('shipments').selectAll().where('id', '=', c.shipment_id!).executeTakeFirstOrThrow();
    const items = await this.db.selectFrom('shipment_items').select(['order_id', 'product_id']).where('shipment_id', '=', shipment.id).execute();
    // A refund cancels: a buyer's new claim code on its pieces is replaced by one nobody sees, its hashes made first.
    let claimHashes: ReadonlyMap<string, string> = new Map();
    if (d.decision === 'REFUND') {
      const related = await this.db
        .selectFrom('orders')
        .select('id')
        .where((eb) => eb.or([eb('id', 'in', items.map((i) => i.order_id)), eb('with_order_id', 'in', items.map((i) => i.order_id))]))
        .execute();
      claimHashes = await peekClaimRenewals(this.db, related.map((r) => r.id));
    }
    const pieceTo: OrderCasePieceDestination = c.kind === 'LOST' ? 'REVOKED' : c.kind === 'DAMAGED' ? d.pieceTo! : 'RESTOCKED';
    // A damaged parcel reached its collector, who saw the card in it: each piece back to stock takes a new claim code
    // (as a return's), its hash made first, so that card no longer registers it. The code is shown once to staff in the
    // answer, so the piece's new card is printed before it ships again (it may serve a waiting order at once).
    const reissued = new Map<string, { code: string; hash: string }>();
    if (c.kind === 'DAMAGED' && pieceTo === 'RESTOCKED') {
      for (const i of items) {
        if (i.product_id === null || reissued.has(i.product_id)) continue;
        const code = generateClaimCode();
        reissued.set(i.product_id, { code, hash: await hashClaimCode(code) });
      }
    }
    let claimCodes: { productId: string; claimCode: string }[] = [];
    await inRetriedTransaction(this.db, async (tx) => {
      claimCodes = [];
      // The pieces first (as a return), then the parcel's orders, the case and the shipment.
      if (claimHashes.size) await lockPieces(tx, claimHashes.keys());
      const pieceIds = items.map((i) => i.product_id).filter((p): p is string => p !== null);
      const pieces = new Map<string, ProductRow>();
      for (const pid of [...pieceIds].sort()) pieces.set(pid, (await tx.selectFrom('products').selectAll().where('id', '=', pid).forUpdate().executeTakeFirstOrThrow()) as ProductRow);
      const all = await parcelOrders(tx, shipment.order_id, { forUpdate: true });
      const fresh = await tx.selectFrom('order_cases').selectAll().where('id', '=', c.id).forUpdate().executeTakeFirstOrThrow();
      if (!NOT_ENDED.includes(fresh.status)) throw caseEnded();
      if (fresh.kind !== 'LOST' && fresh.status !== 'RECEIVED') throw notReceived();
      await tx.selectFrom('shipments').select('id').where('id', '=', shipment.id).forUpdate().execute();
      const now = this.clock();
      const notes: AuditRecordInput[] = [];
      const statusChanges: { piece: ProductRow; to: ProductStatus; orderId: string }[] = [];
      const members = all.filter((o) => items.some((i) => i.order_id === o.id) && o.status === 'SHIPPED');
      const restocked = new Set<string>();
      const reshipped: OrderRow[] = [];
      for (const o of members) {
        const pid = items.find((i) => i.order_id === o.id)!.product_id;
        const piece = pid ? pieces.get(pid)! : null;
        const keep = c.kind === 'BACK_TO_SENDER';
        // Back to PAID, its shipment's columns cleared (this path only), the parcel kept in `shipments`.
        if (keep && piece && o.sku_id) {
          await lockSku(tx, o.sku_id);
          await recordMovement(tx, { skuId: o.sku_id, locationId: o.location_id, delta: 1, reason: 'RETURNED', orderId: o.id, productId: piece.id, note: null }, actor, now);
        }
        let after = await updateOrder(tx, o.id, {
          status: 'PAID',
          shipped_at: null,
          carrier_id: null,
          tracking_number: null,
          declared_value_minor: null,
          reservation: keep ? 'STOCK' : null,
          product_id: keep ? o.product_id : null,
          queue_first: !keep && d.decision === 'RESHIP',
        });
        const reissuedHere = piece && !keep ? reissued.get(piece.id) : undefined;
        if (piece && !keep) {
          // Unbound: a buyer's new claim code waiting on it is withdrawn.
          notes.push(...(await withdrawWaiting(tx, piece.id, 'ORDER_RETURNED', actor, now)));
          if (pieceTo === 'RESTOCKED' && o.sku_id) {
            // At the location ORBES chose, the order's by default.
            const at = d.locationId ?? o.location_id;
            await lockSku(tx, o.sku_id);
            await recordMovement(tx, { skuId: o.sku_id, locationId: at, delta: 1, reason: 'RETURNED', orderId: o.id, productId: piece.id, note: null }, actor, now);
            restocked.add(`${o.sku_id}:${at}`);
          }
          if (reissuedHere) {
            await tx.updateTable('products').set({ claim_secret_hash: reissuedHere.hash, updated_at: now }).where('id', '=', piece.id).execute();
            claimCodes.push({ productId: piece.product_id, claimCode: reissuedHere.code });
          }
        }
        if (piece) {
          // Its status: back on sale once it is free in stock again (RESOLD), archived (RETIRED) or revoked (REVOKED).
          const freed = (keep && d.decision === 'REFUND') || (!keep && pieceTo === 'RESTOCKED');
          const to: ProductStatus | null = pieceTo === 'REVOKED' ? 'REVOKED' : pieceTo === 'ARCHIVED' ? 'RETIRED' : freed && !['ISSUED', 'RESOLD'].includes(piece.status) ? 'RESOLD' : null;
          if (to !== null && piece.status !== to) statusChanges.push({ piece, to, orderId: o.id });
        }
        if (d.decision === 'RESHIP' && !keep) after = await hold(tx, after, actor, now, notes);
        // Its event once it holds what the decision gives it (a piece in stock, or waiting for one): its readiness
        // restarts from here (fulfilment.ts readySince), never from the first sale's dates.
        notes.push(
          await recordChange(
            tx,
            o,
            after,
            'order.reship',
            { details: { caseId: c.id, shipmentId: shipment.id, reservation: after.reservation, ...(after.queue_first ? { queueFirst: true } : {}), ...(reissuedHere ? { claimCodeReissued: true } : {}) } },
            actor,
            now,
          ),
        );
        reshipped.push(after);
      }
      // The pieces back in stock serve the orders waiting there, the reshipments first.
      for (const k of restocked) {
        const [skuId, locationId] = k.split(':') as [string, string];
        notes.push(...(await serveWaiting(tx, skuId, locationId, actor, now)));
      }
      if (d.decision === 'REFUND') {
        for (const o of reshipped) {
          const current = await tx.selectFrom('orders').selectAll().where('id', '=', o.id).executeTakeFirstOrThrow();
          if (current.status !== 'PAID') continue; // a welcome gift its order's cancellation already ended
          await step(tx, current, { to: 'CANCELLED', note: 'Refunded: its parcel did not arrive.', claimHashes }, actor, now, notes);
        }
      }
      await tx
        .updateTable('order_cases')
        .set({ status: 'CLOSED', outcome: d.decision, piece_to: pieceTo, decision_note: d.note, closed_at: now < fresh.opened_at ? fresh.opened_at : now, closed_by: actor.id! })
        .where('id', '=', c.id)
        .execute();
      const owner = all.find((o) => o.id === c.order_id)!;
      notes.push(await recordChange(tx, owner, owner, 'order.case.decide', { details: { caseId: c.id, kind: c.kind, outcome: d.decision, pieceTo, shipmentId: shipment.id } }, actor, now));
      // Last (LifecycleService audits at once): the pieces' statuses, then the entries of the decision.
      for (const s of statusChanges) {
        const current = (await tx.selectFrom('products').selectAll().where('id', '=', s.piece.id).executeTakeFirstOrThrow()) as ProductRow;
        await this.lifecycle.applyForService(tx, current, s.to, { reason: `Order ${orderReference(s.orderId)}: parcel ${c.kind.replace(/_/g, ' ').toLowerCase()}`, via: 'order.case.decide' }, actor);
      }
      for (const n of notes) await this.audit.record(n, tx);
    });
    claimCodes.sort((a, b) => a.productId.localeCompare(b.productId));
    return { case: await this.get(c.id), ...(claimCodes.length ? { claimCodes } : {}) };
  }

  // ── Cancelling ───────────────────────────────────────────────────────────

  /**
   * Client Services ends an order case with no decision, with a note: CANCELLED; a parcel problem's shipment SHIPPED
   * again, to report it anew. Audited `order.case.cancel` `{ caseId, kind }`, never the note.
   */
  async cancel(caseId: string, input: { note: string }, actor: Actor): Promise<OrderCaseRecord> {
    assertStaff(actor);
    const id = known(caseId, caseNotFound);
    const note = cleanText(input?.note, ORDER_CASE_LIMITS.cancelNote, 'The note', true)!;
    const peek = await this.db.selectFrom('order_cases').select('order_id').where('id', '=', id).executeTakeFirst();
    if (!peek) throw caseNotFound();
    await inTransaction(this.db, async (tx) => {
      const o = await lockOrder(tx, peek.order_id);
      const c = await tx.selectFrom('order_cases').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (!NOT_ENDED.includes(c.status)) throw caseEnded();
      const now = this.clock();
      await tx.updateTable('order_cases').set({ status: 'CANCELLED', cancelled_at: now < c.opened_at ? c.opened_at : now, cancelled_by: actor.id!, cancel_note: note }).where('id', '=', id).execute();
      if (c.shipment_id && isParcelProblem(c.kind)) await tx.updateTable('shipments').set({ status: 'SHIPPED' }).where('id', '=', c.shipment_id).where('status', '=', c.kind).execute();
      const n = await recordChange(tx, o, o, 'order.case.cancel', { details: { caseId: id, kind: c.kind } }, actor, now);
      await this.audit.record(n, tx);
    });
    return this.get(id);
  }

  /** 409 ORDER_CASE_OPEN when one of the orders has an order case not ended. */
  private async assertNoOpenCase(tx: Db, orderIds: readonly string[]): Promise<void> {
    if (orderIds.length === 0) return;
    const open = await tx.selectFrom('order_cases').select('id').where('order_id', 'in', [...orderIds]).where('status', 'in', [...NOT_ENDED]).executeTakeFirst();
    if (open) throw caseOpen();
  }
}
