/**
 * The fulfilment board (plan LIVE RELEASE+ of 2026-10-04: choices 7 and 19, The console → Orders): every order of every
 * channel, by step, with the time it has spent in its step; the late ones stand out (M3); its CSV; one order as its page
 * reads it; the delays of the alerts, edited in the console's settings. Reads only, but for the delays: the changes of
 * an order are services/orders.ts's.
 *
 *   timing     an order's step started when it reached it (`reserved_at`, `paid_at`…). It is late (M3) past the delay
 *              of its rule, each editable (`order_alert_settings`, the defaults its columns'):
 *                RESERVED      over 2 days since it was reserved;
 *                READY         PAID with its piece ready (held in stock at its location) but not shipped, over 3 days
 *                              since it was both paid and ready, whichever came last (`readySince`, from its history);
 *                SHIPPED       not delivered, over 10 days since it was shipped;
 *                UNREGISTERED  DELIVERED, its piece not registered by its buyer (no ownership of that account on that
 *                              piece), over 30 days since it was delivered.
 *              A PAID order whose piece is still being made, a CANCELLED or RETURNED one, is never late.
 *   the board  the columns RESERVED, PAID, SHIPPED, DELIVERED, CANCELLED, RETURNED, each with its count, its late count
 *              and its first BOARD_COLUMN_MAX cards: the steps in progress the longest waiting first, CANCELLED and
 *              RETURNED the latest first. Narrowed by channel, release, location, the late ones only, and a search (an
 *              order's reference OR-…, a LIVE reservation's LR-…, a piece's O26-J-…, or words of the model or the
 *              release). Each card: its channel and release, the collector (the routes mask the email for an AUDITOR),
 *              the model and size, the add-ons, the surprise, what it holds, its time in its step and whether it is late.
 *   a client   every order of one collector, the latest first, each with its steps' times and its timing: the client
 *              sheet's (N4, routes/admin/owners.ts).
 *   the CSV    every order the filters keep, the oldest first, with its buyer's details as `buyer` gives them (masked for
 *              an AUDITOR by the route) and never a price hidden: the CSV is Client Services' own (the packing slip is
 *              the document without prices).
 */
import { orderClaimCode, type OrderClaimCode } from './claim-renewals.js';
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { BenchItemStatus, JsonObject, OrderChannel, OrderReservation, OrderStatus } from '../db/schema.js';
import { ORDER_STATUSES } from '../db/schema.js';
import { validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { liveReference, majorUnits } from './live-console.js';
import { orderReference, trackingLink, type OrderService, type OrderView } from './orders.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The delays of the alerts (M3), in days: the columns' defaults of migration 0022. */
export const ORDER_ALERT_DEFAULTS = Object.freeze({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 });
/** Each delay's bounds, as the CHECKs of migration 0022 hold them. */
export const ORDER_ALERT_LIMITS = Object.freeze({
  reservedDays: Object.freeze({ min: 1, max: 90 }),
  readyDays: Object.freeze({ min: 1, max: 90 }),
  shippedDays: Object.freeze({ min: 1, max: 90 }),
  unregisteredDays: Object.freeze({ min: 1, max: 365 }),
});
export type OrderAlertDelays = { -readonly [K in keyof typeof ORDER_ALERT_DEFAULTS]: number };

/** The cards a column of the board carries, at most (its count says how many it holds). */
export const BOARD_COLUMN_MAX = 100;
/** A search, at most. */
export const BOARD_SEARCH_MAX = 100;

/** Why an order is late (M3). */
export const ORDER_LATE_RULES = Object.freeze(['RESERVED', 'READY', 'SHIPPED', 'UNREGISTERED'] as const);
export type OrderLateRule = (typeof ORDER_LATE_RULES)[number];

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_REF_RE = /^OR-?([0-9A-F]{1,8})$/i;
const LIVE_REF_RE = /^LR-?([0-9A-F]{1,8})$/i;
const PIECE_REF_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;

/** The steps in progress: their board column puts the longest waiting first. */
const IN_PROGRESS: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED']);

export interface OrderTiming {
  /** When the order reached its step. */
  since: Date;
  /** When it becomes late by its rule; null when no rule applies now. */
  dueAt: Date | null;
  rule: OrderLateRule | null;
  late: boolean;
}

/** What `orderTiming` reads of an order. */
export interface TimedOrder {
  status: OrderStatus;
  reservedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  returnedAt: Date | null;
  reservation: OrderReservation | null;
  /** When its piece became ready at its location (held in stock), for a PAID order holding one. */
  readySince: Date | null;
  /** Its piece registered by its buyer. */
  registered: boolean;
}

const plusDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

/** An order's time in its step and whether it is late (M3), at `now` (pure). Late: strictly past the delay. */
export function orderTiming(o: TimedOrder, delays: OrderAlertDelays, now: Date): OrderTiming {
  let since: Date;
  let rule: OrderLateRule | null = null;
  let dueAt: Date | null = null;
  switch (o.status) {
    case 'RESERVED':
      since = o.reservedAt;
      rule = 'RESERVED';
      dueAt = plusDays(o.reservedAt, delays.reservedDays);
      break;
    case 'PAID':
      since = o.paidAt!;
      if (o.reservation === 'STOCK') {
        const ready = o.readySince && o.readySince > o.paidAt! ? o.readySince : o.paidAt!;
        rule = 'READY';
        dueAt = plusDays(ready, delays.readyDays);
      }
      break;
    case 'SHIPPED':
      since = o.shippedAt!;
      rule = 'SHIPPED';
      dueAt = plusDays(o.shippedAt!, delays.shippedDays);
      break;
    case 'DELIVERED':
      since = o.deliveredAt!;
      if (!o.registered) {
        rule = 'UNREGISTERED';
        dueAt = plusDays(o.deliveredAt!, delays.unregisteredDays);
      }
      break;
    case 'CANCELLED':
      since = o.cancelledAt!;
      break;
    case 'RETURNED':
      since = o.returnedAt!;
      break;
  }
  return { since, dueAt, rule: dueAt ? rule : null, late: dueAt !== null && now.getTime() > dueAt.getTime() };
}

/**
 * When an order's piece became ready, from its history (oldest first): the time of the change that last made it hold a
 * piece in stock after it held none or a piece to make (each change that moves what it holds says so in its details,
 * `reservation`). Null when it holds no piece in stock.
 */
export function readySince(events: readonly { at: Date; details: JsonObject }[]): Date | null {
  let holding: unknown = null;
  let since: Date | null = null;
  for (const e of events) {
    if (!Object.prototype.hasOwnProperty.call(e.details, 'reservation')) continue;
    const r = e.details.reservation;
    if (r === 'STOCK' && holding !== 'STOCK') since = e.at;
    if (r !== 'STOCK') since = null;
    holding = r;
  }
  return holding === 'STOCK' ? since : null;
}

// ── Views ──────────────────────────────────────────────────────────────────

export interface OrderAlertSettings extends OrderAlertDelays {
  updatedAt: Date | null;
  updatedBy: { id: string; email: string } | null;
}

/** An order on the board; the routes mask the email for an AUDITOR. */
export interface OrderCard {
  id: string;
  reference: string;
  /** The reference the collector holds: a LIVE reservation's LR-…; null for the other channels. */
  sourceReference: string | null;
  channel: OrderChannel;
  status: OrderStatus;
  release: { id: string; title: string } | null;
  account: { id: string; email: string };
  model: { id: string; name: string };
  sizeLabel: string | null;
  skuCode: string | null;
  addons: { label: string }[];
  surprise: string | null;
  /** An engraving text is entered (its words are on the order's page). */
  engraving: boolean;
  location: { id: string; name: string };
  reservation: OrderReservation | null;
  /** Its open piece to make. */
  bench: { status: BenchItemStatus } | null;
  /** The piece that fulfils it, by its reference. */
  piece: string | null;
  shipment: { carrier: string; trackingNumber: string } | null;
  timing: OrderTiming;
}

export interface OrderBoardColumn {
  status: OrderStatus;
  /** The orders of this step the filters keep. */
  total: number;
  late: number;
  /** The first BOARD_COLUMN_MAX of them. */
  items: OrderCard[];
}

export interface OrderBoard {
  now: Date;
  delays: OrderAlertSettings;
  columns: OrderBoardColumn[];
  /** The releases with orders, the latest first, and every location: the filters' choices. */
  releases: { id: string; title: string }[];
  locations: { id: string; name: string }[];
}

export interface OrderBoardFilter {
  channel?: OrderChannel;
  dropId?: string;
  locationId?: string;
  late?: boolean;
  q?: string;
}

/** An order of a collector as the client sheet lists it (N4): the board's card and the time it reached each step. */
export interface ClientOrder extends Omit<OrderCard, 'account'> {
  priceMinor: number | null;
  currency: string | null;
  steps: { reservedAt: Date; paidAt: Date | null; shippedAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null; returnedAt: Date | null };
}

/** An order as its page reads it: the order, its collector, its timing, its piece; the routes mask for an AUDITOR. */
export interface OrderDetail {
  order: OrderView;
  sourceReference: string | null;
  account: { id: string; email: string };
  timing: OrderTiming;
  /** The piece that fulfils it: its status and whether its buyer registered it. */
  piece: { productId: string; status: string; registered: boolean } | null;
  /** Who made each change of its history (the console users by email). */
  actors: Record<string, string>;
  delays: OrderAlertDelays;
  /**
   * NEW CLAIM CODE (plan NEXT LOT §3.4): the order's newest new claim code made for its buyer (its status and dates, and
   * whether no card registers its piece), for Client Services who answers the buyer from here; null without one. Never
   * the code.
   */
  claimCode: OrderClaimCode | null;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface FulfilmentServiceDeps {
  db: Db;
  audit: AuditService;
  orders: OrderService;
  clock?: Clock;
}

interface BoardRow {
  id: string;
  channel: OrderChannel;
  live_entry_id: string | null;
  drop_id: string | null;
  account_id: string;
  model_id: string;
  size_label: string | null;
  price_minor: number | null;
  currency: string | null;
  addons: { label: string; priceMinor: number }[];
  surprise: string | null;
  engraving_text: string | null;
  buyer_name: string | null;
  buyer_address: string | null;
  status: OrderStatus;
  reserved_at: Date;
  paid_at: Date | null;
  shipped_at: Date | null;
  delivered_at: Date | null;
  cancelled_at: Date | null;
  returned_at: Date | null;
  location_id: string;
  reservation: OrderReservation | null;
  tracking_number: string | null;
  declared_value_minor: number | null;
  model_name: string;
  email: string;
  location_name: string;
  release_title: string | null;
  sku_code: string | null;
  carrier_name: string | null;
  tracking_url: string | null;
  piece_reference: string | null;
  bench_status: BenchItemStatus | null;
  registered: boolean;
}

/** LIKE's own characters, taken literally. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class FulfilmentService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly orders: OrderService;
  private readonly clock: Clock;

  constructor(deps: FulfilmentServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.orders = deps.orders;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The delays (M3) ──────────────────────────────────────────────────────

  /** The delays of the alerts: as set in the console's settings, or the defaults. */
  async delays(): Promise<OrderAlertSettings> {
    const row = await this.db
      .selectFrom('order_alert_settings as s')
      .leftJoin('admin_users as u', 'u.id', 's.updated_by')
      .select(['s.reserved_days', 's.ready_days', 's.shipped_days', 's.unregistered_days', 's.updated_at', 's.updated_by', 'u.email'])
      .where('s.id', '=', 1)
      .executeTakeFirst();
    if (!row) return { ...ORDER_ALERT_DEFAULTS, updatedAt: null, updatedBy: null };
    return {
      reservedDays: row.reserved_days,
      readyDays: row.ready_days,
      shippedDays: row.shipped_days,
      unregisteredDays: row.unregistered_days,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by && row.email ? { id: row.updated_by, email: row.email } : null,
    };
  }

  /** The delays changed, each within its bounds (ORDER_ALERT_LIMITS). Audited `order.alerts`, before and after. */
  async setDelays(input: OrderAlertDelays, actor: Actor): Promise<OrderAlertSettings> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string') throw validationError('Only a console user sets the delays.');
    const next = {} as OrderAlertDelays;
    for (const k of Object.keys(ORDER_ALERT_DEFAULTS) as (keyof OrderAlertDelays)[]) {
      const v = input?.[k];
      const { min, max } = ORDER_ALERT_LIMITS[k];
      if (!Number.isInteger(v) || v < min || v > max) throw validationError(`Each delay is ${min} to ${max} days.`, `field ${k}`);
      next[k] = v;
    }
    const before = await this.delays();
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const values = { reserved_days: next.reservedDays, ready_days: next.readyDays, shipped_days: next.shippedDays, unregistered_days: next.unregisteredDays, updated_by: actor.id!, updated_at: now };
      await tx
        .insertInto('order_alert_settings')
        .values({ id: 1, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet(values))
        .execute();
      const from: JsonObject = { reservedDays: before.reservedDays, readyDays: before.readyDays, shippedDays: before.shippedDays, unregisteredDays: before.unregisteredDays };
      await this.audit.record({ actor, action: 'order.alerts', targetType: 'order_alert_settings', targetId: null, details: { from, to: { ...next } } }, tx);
    });
    return this.delays();
  }

  // ── The board ────────────────────────────────────────────────────────────

  /** The board: every order the filters keep, by step (see the header). */
  async board(filter: OrderBoardFilter = {}): Promise<OrderBoard> {
    const now = this.clock();
    const delays = await this.delays();
    const cards = await this.cards(filter, delays, now);
    const columns = ORDER_STATUSES.map((status): OrderBoardColumn => {
      const own = cards.filter((c) => c.status === status);
      const progress = IN_PROGRESS.includes(status);
      own.sort((a, b) => (progress ? a.timing.since.getTime() - b.timing.since.getTime() : b.timing.since.getTime() - a.timing.since.getTime()) || a.id.localeCompare(b.id));
      return { status, total: own.length, late: own.filter((c) => c.timing.late).length, items: own.slice(0, BOARD_COLUMN_MAX) };
    });
    const releases = await this.db
      .selectFrom('drops as d')
      .select(['d.id', 'd.title'])
      .where((eb) => eb.exists(eb.selectFrom('orders as o').select('o.id').whereRef('o.drop_id', '=', 'd.id')))
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .execute();
    const locations = await this.db.selectFrom('stock_locations').select(['id', 'name']).orderBy('is_default', 'desc').orderBy('name').execute();
    return { now, delays, columns, releases, locations };
  }

  /**
   * Every order the filters keep as a CSV (render/csv.ts: RFC 4180, every field quoted, a formula never run), the
   * oldest first: its references, channel, release, collector (`email`), model, size, SKU, price, add-ons, surprise,
   * engraving, buyer (`buyer`), step and its time, whether it is late and why, location, what it holds, its piece, its
   * shipment and each step's time.
   */
  async csv(
    filter: OrderBoardFilter,
    view: { email: (stored: string) => string; buyer: (b: { name: string | null; address: string | null }) => { name: string | null; address: string | null } },
  ): Promise<{ filename: string; contentType: string; body: string }> {
    const now = this.clock();
    const delays = await this.delays();
    const rows = await this.rows(filter);
    const timed = await this.timed(rows, delays, now);
    const kept = filter.late ? timed.filter((t) => t.timing.late) : timed;
    kept.sort((a, b) => a.row.reserved_at.getTime() - b.row.reserved_at.getTime() || a.row.id.localeCompare(b.row.id));
    const iso = (d: Date | null) => (d ? d.toISOString() : '');
    const header = [
      'reference', 'source reference', 'channel', 'release', 'collector', 'model', 'size', 'sku', 'currency', 'price', 'add-ons', 'surprise', 'engraving',
      'buyer name', 'buyer address', 'status', 'in step since', 'late', 'late rule', 'location', 'holds', 'piece', 'carrier', 'tracking number', 'tracking link',
      'declared value', 'reserved at', 'paid at', 'shipped at', 'delivered at', 'cancelled at', 'returned at',
    ];
    const body = csvDocument([
      header,
      ...kept.map(({ row: r, timing }) => {
        const buyer = view.buyer({ name: r.buyer_name, address: r.buyer_address });
        return [
          orderReference(r.id),
          r.live_entry_id ? liveReference(r.live_entry_id) : '',
          r.channel,
          r.release_title ?? '',
          view.email(r.email),
          r.model_name,
          r.size_label ?? '',
          r.sku_code ?? '',
          r.currency ?? '',
          r.price_minor === null ? '' : majorUnits(r.price_minor),
          r.addons.map((a) => (r.currency ? `${a.label} (${majorUnits(a.priceMinor)})` : a.label)).join('; '),
          r.surprise ?? '',
          r.engraving_text ?? '',
          buyer.name ?? '',
          buyer.address ?? '',
          r.status,
          timing.since.toISOString(),
          timing.late ? 'yes' : 'no',
          timing.late ? timing.rule ?? '' : '',
          r.location_name,
          r.reservation ?? '',
          r.piece_reference ?? '',
          r.carrier_name ?? '',
          r.tracking_number ?? '',
          r.tracking_url && r.tracking_number ? trackingLink(r.tracking_url, r.tracking_number) : '',
          r.declared_value_minor === null ? '' : majorUnits(r.declared_value_minor),
          iso(r.reserved_at),
          iso(r.paid_at),
          iso(r.shipped_at),
          iso(r.delivered_at),
          iso(r.cancelled_at),
          iso(r.returned_at),
        ];
      }),
    ]);
    return { filename: `ORBES-orders-${now.toISOString().slice(0, 10)}.csv`, contentType: CSV_CONTENT_TYPE, body };
  }

  /** Every order of one collector, the latest first (the client sheet, N4). An unknown account has none. */
  async forAccount(accountId: string): Promise<ClientOrder[]> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) return [];
    const now = this.clock();
    const delays = await this.delays();
    const rows = await this.rows({}, accountId.toLowerCase());
    const timed = await this.timed(rows, delays, now);
    timed.sort((a, b) => b.row.reserved_at.getTime() - a.row.reserved_at.getTime() || a.row.id.localeCompare(b.row.id));
    return timed.map(({ row: r, timing }) => {
      const { account: _account, ...card } = this.card(r, timing);
      return {
        ...card,
        priceMinor: r.price_minor,
        currency: r.currency,
        steps: { reservedAt: r.reserved_at, paidAt: r.paid_at, shippedAt: r.shipped_at, deliveredAt: r.delivered_at, cancelledAt: r.cancelled_at, returnedAt: r.returned_at },
      };
    });
  }

  /** One order as its page reads it (404 ORDER_NOT_FOUND). */
  async detail(orderId: string): Promise<OrderDetail> {
    const order = await this.orders.get(orderId);
    const now = this.clock();
    const delays = await this.delays();
    const row = await this.db
      .selectFrom('orders as o')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .leftJoin('products as p', 'p.id', 'o.product_id')
      .select(['a.email', 'o.live_entry_id', 'p.status as piece_status', sql<boolean>`EXISTS (SELECT 1 FROM ownership w WHERE w.product_id = o.product_id AND w.account_id = o.account_id)`.as('registered')])
      .where('o.id', '=', order.id)
      .executeTakeFirstOrThrow();
    const history = await this.db.selectFrom('order_events').select(['created_at', 'details']).where('order_id', '=', order.id).orderBy('id').execute();
    const timing = orderTiming(
      {
        status: order.status,
        reservedAt: order.reservedAt,
        paidAt: order.paidAt,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
        returnedAt: order.returnedAt,
        reservation: order.reservation,
        readySince: readySince(history.map((e) => ({ at: e.created_at, details: e.details }))),
        registered: Boolean(row.registered),
      },
      delays,
      now,
    );
    const adminIds = [...new Set(order.events.filter((e) => e.actor.type === 'admin' && e.actor.id && UUID_RE.test(e.actor.id)).map((e) => e.actor.id!))];
    const admins = adminIds.length ? await this.db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', adminIds).execute() : [];
    return {
      order,
      sourceReference: row.live_entry_id ? liveReference(row.live_entry_id) : null,
      account: { id: order.accountId, email: row.email },
      timing,
      piece: order.productId ? { productId: order.productId, status: row.piece_status!, registered: Boolean(row.registered) } : null,
      actors: Object.fromEntries(admins.map((a) => [a.id, a.email])),
      delays: { reservedDays: delays.reservedDays, readyDays: delays.readyDays, shippedDays: delays.shippedDays, unregisteredDays: delays.unregisteredDays },
      claimCode: await orderClaimCode(this.db, order.id),
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The cards the filters keep, timed. */
  private async cards(filter: OrderBoardFilter, delays: OrderAlertDelays, now: Date): Promise<OrderCard[]> {
    const timed = await this.timed(await this.rows(filter), delays, now);
    return timed.filter((t) => !filter.late || t.timing.late).map(({ row, timing }) => this.card(row, timing));
  }

  /** A row as the board's card. */
  private card(r: BoardRow, timing: OrderTiming): OrderCard {
    return {
      id: r.id,
      reference: orderReference(r.id),
      sourceReference: r.live_entry_id ? liveReference(r.live_entry_id) : null,
      channel: r.channel,
      status: r.status,
      release: r.drop_id && r.release_title ? { id: r.drop_id, title: r.release_title } : null,
      account: { id: r.account_id, email: r.email },
      model: { id: r.model_id, name: r.model_name },
      sizeLabel: r.size_label,
      skuCode: r.sku_code,
      addons: r.addons.map((a) => ({ label: a.label })),
      surprise: r.surprise,
      engraving: r.engraving_text !== null,
      location: { id: r.location_id, name: r.location_name },
      reservation: r.reservation,
      bench: r.bench_status ? { status: r.bench_status } : null,
      piece: r.piece_reference,
      shipment: r.carrier_name && r.tracking_number ? { carrier: r.carrier_name, trackingNumber: r.tracking_number } : null,
      timing,
    };
  }

  /** Each row with its timing; the history read only for the PAID orders holding a piece in stock (their readiness). */
  private async timed(rows: BoardRow[], delays: OrderAlertDelays, now: Date): Promise<{ row: BoardRow; timing: OrderTiming }[]> {
    const ready = rows.filter((r) => r.status === 'PAID' && r.reservation === 'STOCK').map((r) => r.id);
    const events = ready.length ? await this.db.selectFrom('order_events').select(['order_id', 'created_at', 'details']).where('order_id', 'in', ready).orderBy('id').execute() : [];
    const byOrder = new Map<string, { at: Date; details: JsonObject }[]>();
    for (const e of events) byOrder.set(e.order_id, [...(byOrder.get(e.order_id) ?? []), { at: e.created_at, details: e.details }]);
    return rows.map((r) => ({
      row: r,
      timing: orderTiming(
        {
          status: r.status,
          reservedAt: r.reserved_at,
          paidAt: r.paid_at,
          shippedAt: r.shipped_at,
          deliveredAt: r.delivered_at,
          cancelledAt: r.cancelled_at,
          returnedAt: r.returned_at,
          reservation: r.reservation,
          readySince: readySince(byOrder.get(r.id) ?? []),
          registered: Boolean(r.registered),
        },
        delays,
        now,
      ),
    }));
  }

  /** The orders the filters keep (but `late`, which needs their timing), with what the board and the CSV show; one collector's. */
  private async rows(filter: OrderBoardFilter, accountId?: string): Promise<BoardRow[]> {
    const q = (filter.q ?? '').trim().slice(0, BOARD_SEARCH_MAX);
    let query = this.db
      .selectFrom('orders as o')
      .innerJoin('models as m', 'm.id', 'o.model_id')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .innerJoin('stock_locations as l', 'l.id', 'o.location_id')
      .leftJoin('drops as d', 'd.id', 'o.drop_id')
      .leftJoin('skus as k', 'k.id', 'o.sku_id')
      .leftJoin('carriers as c', 'c.id', 'o.carrier_id')
      .leftJoin('products as p', 'p.id', 'o.product_id')
      .leftJoin('bench_items as b', (j) => j.onRef('b.order_id', '=', 'o.id').on('b.status', 'in', ['TO_MAKE', 'IN_PROGRESS']))
      .select([
        'o.id', 'o.channel', 'o.live_entry_id', 'o.drop_id', 'o.account_id', 'o.model_id', 'o.size_label', 'o.price_minor', 'o.currency', 'o.addons', 'o.surprise',
        'o.engraving_text', 'o.buyer_name', 'o.buyer_address', 'o.status', 'o.reserved_at', 'o.paid_at', 'o.shipped_at', 'o.delivered_at', 'o.cancelled_at',
        'o.returned_at', 'o.location_id', 'o.reservation', 'o.tracking_number', 'o.declared_value_minor', 'm.name as model_name', 'a.email',
        'l.name as location_name', 'd.title as release_title', 'k.code as sku_code', 'c.name as carrier_name', 'c.tracking_url',
        'p.product_id as piece_reference', 'b.status as bench_status',
      ])
      .select(sql<boolean>`EXISTS (SELECT 1 FROM ownership w WHERE w.product_id = o.product_id AND w.account_id = o.account_id)`.as('registered'));
    if (accountId) query = query.where('o.account_id', '=', accountId);
    if (filter.channel) query = query.where('o.channel', '=', filter.channel);
    if (filter.dropId) query = query.where('o.drop_id', '=', filter.dropId);
    if (filter.locationId) query = query.where('o.location_id', '=', filter.locationId);
    if (q) {
      const order = ORDER_REF_RE.exec(q);
      const live = LIVE_REF_RE.exec(q);
      if (order) query = query.where(sql<boolean>`replace(o.id::text, '-', '') LIKE ${`${order[1].toLowerCase()}%`}`);
      else if (live) query = query.where(sql<boolean>`replace(o.live_entry_id::text, '-', '') LIKE ${`${live[1].toLowerCase()}%`}`);
      else if (PIECE_REF_RE.test(q)) {
        const ref = q.toUpperCase();
        query = query.where((eb) =>
          eb.or([eb('p.product_id', '=', ref), eb.exists(eb.selectFrom('bench_items as x').innerJoin('products as xp', 'xp.id', 'x.product_id').select('x.id').whereRef('x.order_id', '=', 'o.id').where('xp.product_id', '=', ref))]),
        );
      } else {
        const like = `%${likeLiteral(q)}%`;
        query = query.where((eb) => eb.or([eb('m.name', 'ilike', like), eb('d.title', 'ilike', like)]));
      }
    }
    return (await query.execute()) as BoardRow[];
  }
}
