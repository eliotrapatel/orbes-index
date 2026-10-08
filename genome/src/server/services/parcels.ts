/**
 * Parcels (plan NEXT LOT of 2026-10-07, §3.5.6.6 and §3.5.6.8, step 5.9; migration 0037): how the agent and ORBES read
 * the orders to ship. « An order ships complete »: a parcel is an order and the orders travelling with it
 * (`with_order_id`: a LIVE entry's further pieces, a welcome gift), keyed by that first order (`shipments.order_id`),
 * minus its cancelled orders. A cancelled first order still keys the parcel, and its address is still the parcel's.
 *
 *   open orders   the parcel's orders RESERVED or PAID: what is left to ship (an order already shipped on its own before
 *                 this lot, or a cancelled one, is not waited for).
 *   to ship       a parcel whose open orders are all PAID and hold their piece in stock (`reservation` STOCK), at one
 *                 location: the oldest ready first. Its Ready since is the latest ready time of its open orders (each the
 *                 later of its payment and the moment it took its piece, services/fulfilment.ts readySince); it is LATE
 *                 past the delay of the READY rule (5 days, Orders → Settings). Its step: READY_TO_PACK, or its open
 *                 shipment's PACKING or PACKED.
 *   on its way    the shipments SHIPPED, the latest first.
 *   the view      `ShippingOrderView`: the parcel's pieces (model, variant, size, add-on labels, engraving words,
 *                 surprise, the piece its scan bound), where it ships (the first order's name and address; the country
 *                 and the phone come with the delivery address, §3.6.B), the checklist, the shipment, its history (who
 *                 by their role only) and the active carriers for Ship. No price, no email, no account, no release: what
 *                 the agent may read, which also prints its packing slip.
 *   housekeeping  `purgePackingPhotos`: a parcel's photo erased 14 days after its delivery (RETURN_WINDOW_DAYS), unless a
 *                 return or an exchange of its orders is still open (it is erased once that case is closed or
 *                 cancelled); a parcel never delivered, 14 days after its parcel problem was decided or cancelled, or
 *                 after the shipment was cancelled. Journaled `shipment.photo.erase`.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { AdminRole, JsonObject, OrderRow, ShipmentRow, ShipmentStatus } from '../db/schema.js';
import { readySince, ORDER_ALERT_DEFAULTS } from './fulfilment.js';
import { writeJournal } from './journal.js';
import { orderReference, trackingLink } from './orders.js';
import type { LocationScope } from './receptions.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The return window and the packing photo's keeping, in days (the owner's « fixed 14 days after delivery »). */
export const RETURN_WINDOW_DAYS = 14;
/** The packing photo, at most (the console scales it to 1600 px as JPEG first). */
export const PACKING_PHOTO_MAX_BYTES = 1_048_576;
/** The shipments still on their way through the agent's hands. */
export const OPEN_SHIPMENT_STATUSES: readonly ShipmentStatus[] = Object.freeze(['PACKING', 'PACKED', 'SHIPPED']);
/** The steps of a parcel on the agent's list. */
export type ParcelStep = 'NOT_READY' | 'READY_TO_PACK' | Exclude<ShipmentStatus, 'CANCELLED'>;
/** Who made a change of a parcel, as the agent may read it: never a name. */
export type ParcelActor = 'ORBES' | 'LOGISTICS' | 'COLLECTOR' | 'SYSTEM';
/** The order events a parcel's history shows. */
export const PARCEL_HISTORY_ACTIONS = Object.freeze([
  'order.pack.start',
  'order.pack.scan',
  'order.pack.photo',
  'order.pack.check',
  'order.ship',
  'order.deliver',
  'order.reship',
  'order.case.open',
  'order.case.receive',
  'order.case.decide',
  'order.case.cancel',
  'order.cancel',
] as const);

const DAY_MS = 86_400_000;
const HOLDING = ['RESERVED', 'PAID'] as const;
const inScope = (scope: LocationScope, locationId: string) => scope === null || scope.has(locationId);

// ── Views ──────────────────────────────────────────────────────────────────

/** One order of a parcel as the agent packs it. */
export interface ParcelPiece {
  orderId: string;
  reference: string;
  status: OrderRow['status'];
  model: string;
  /** The model's variant (BLUE), or null. */
  variant: string | null;
  /** Null: one size. */
  sizeLabel: string | null;
  skuCode: string | null;
  /** The add-ons' labels only, never their prices. */
  addons: string[];
  /** The engraving's words, or null. */
  engraving: string | null;
  surprise: string | null;
  /** The piece bound to the order (by its packing scan), and whether it is scanned in the current shipment. */
  piece: { productId: string; scanned: boolean } | null;
}

/** A line of the packing checklist: ticked by hand, or (`byScan`) only by the card's scan. */
export interface ChecklistLine {
  key: string;
  label: string;
  byScan: boolean;
  ticked: boolean;
}

/** A parcel as the agent and ORBES read it (GET /api/admin/logistics/orders/:id). No price, email, account nor release. */
export interface ShippingOrderView {
  /** The parcel's key: its first order. */
  id: string;
  reference: string;
  location: { id: string; name: string };
  step: ParcelStep;
  readySince: Date | null;
  late: boolean;
  orders: ParcelPiece[];
  shipTo: { name: string | null; address: string | null; country: string | null; phone: string | null };
  /** ADDRESS CHANGED (§3.6.B, step 6.7): when and by whom the address was replaced; null until then. */
  addressChanged: { at: Date; by: 'COLLECTOR' | 'STAFF' } | null;
  shipment: {
    id: string;
    status: ShipmentStatus;
    packingStartedAt: Date;
    packedAt: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    photo: boolean;
    carrier: { id: string; name: string } | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null;
  checklist: ChecklistLine[];
  history: { action: string; at: Date; by: ParcelActor; order: string }[];
  /** The active carriers, for Ship (the agent never reads the carriers' route). */
  carriers: { id: string; name: string }[];
}

/** A parcel on the agent's To ship list. */
export interface ToShipRow {
  id: string;
  reference: string;
  /** The other orders travelling in it ('+ 2 pieces'). */
  others: number;
  location: { id: string; name: string };
  readySince: Date;
  late: boolean;
  pieces: { model: string; variant: string | null; sizeLabel: string | null }[];
  addons: string[];
  engraving: boolean;
  shipTo: { name: string | null; address: string | null; country: string | null };
  step: 'READY_TO_PACK' | 'PACKING' | 'PACKED';
  addressChanged: boolean;
}

/** A parcel on its way. */
export interface OnItsWayRow {
  id: string;
  reference: string;
  location: { id: string; name: string };
  shippedAt: Date;
  carrier: { id: string; name: string };
  trackingNumber: string;
  trackingUrl: string;
}

// ── Reading ────────────────────────────────────────────────────────────────

/** The key of the parcel an order belongs to: its first order (itself, or the order it travels with); null when unknown. */
export async function parcelKeyOf(db: Db, orderId: string): Promise<string | null> {
  const o = await db.selectFrom('orders').select(['id', 'with_order_id']).where('id', '=', orderId).executeTakeFirst();
  return o ? (o.with_order_id ?? o.id) : null;
}

/**
 * Every order of a parcel, its first order first, then the oldest; `forUpdate` locks them in that order (the order every
 * parcel path takes, so two never wait for each other).
 */
export async function parcelOrders(db: Db, key: string, opts: { forUpdate?: boolean } = {}): Promise<OrderRow[]> {
  let q = db
    .selectFrom('orders')
    .selectAll()
    .where((eb) => eb.or([eb('id', '=', key), eb('with_order_id', '=', key)]))
    .orderBy(sql`(id = ${key})`, 'desc')
    .orderBy('reserved_at')
    .orderBy('id');
  if (opts.forUpdate) q = q.forUpdate();
  return q.execute();
}

/** The orders left to ship: RESERVED or PAID. */
export const openOrders = (orders: readonly OrderRow[]): OrderRow[] => orders.filter((o) => (HOLDING as readonly string[]).includes(o.status));

/** Whether the parcel's open orders are all paid, hold their piece in stock and share one location. */
export function parcelReady(open: readonly OrderRow[]): boolean {
  return open.length > 0 && open.every((o) => o.status === 'PAID' && o.reservation === 'STOCK') && new Set(open.map((o) => o.location_id)).size === 1;
}

/** The parcel's open shipment (PACKING, PACKED, SHIPPED), or undefined. */
export async function openShipment(db: Db, key: string, opts: { forUpdate?: boolean } = {}): Promise<ShipmentRow | undefined> {
  let q = db.selectFrom('shipments').selectAll().where('order_id', '=', key).where('status', 'in', [...OPEN_SHIPMENT_STATUSES]);
  if (opts.forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The READY delay in days, as Orders → Settings has it. */
export async function readyDays(db: Db): Promise<number> {
  const row = await db.selectFrom('order_alert_settings').select('ready_days').where('id', '=', 1).executeTakeFirst();
  return row?.ready_days ?? ORDER_ALERT_DEFAULTS.readyDays;
}

/** Each order's ready time (the later of its payment and the moment it took its piece in stock). */
async function readyTimes(db: Db, orders: readonly OrderRow[]): Promise<Map<string, Date>> {
  const ids = orders.map((o) => o.id);
  const events = ids.length ? await db.selectFrom('order_events').select(['order_id', 'created_at', 'details']).where('order_id', 'in', ids).orderBy('id').execute() : [];
  const byOrder = new Map<string, { at: Date; details: JsonObject }[]>();
  for (const e of events) byOrder.set(e.order_id, [...(byOrder.get(e.order_id) ?? []), { at: e.created_at, details: e.details }]);
  const out = new Map<string, Date>();
  for (const o of orders) {
    const since = readySince(byOrder.get(o.id) ?? []);
    const paid = o.paid_at ?? o.reserved_at;
    out.set(o.id, since && since > paid ? since : paid);
  }
  return out;
}

/** A parcel's Ready since (the latest ready time of its open orders) and whether it is LATE at `now`. */
export async function parcelTiming(db: Db, open: readonly OrderRow[], now: Date, days?: number): Promise<{ readySince: Date; late: boolean }> {
  const times = await readyTimes(db, open);
  const readySinceAt = new Date(Math.max(...open.map((o) => times.get(o.id)!.getTime())));
  const delay = days ?? (await readyDays(db));
  return { readySince: readySinceAt, late: now.getTime() > readySinceAt.getTime() + delay * DAY_MS };
}

/** The checklist a parcel's orders expect (question 12 as built: one card line per piece). */
export function checklistOf(orders: readonly Pick<OrderRow, 'id' | 'addons' | 'engraving_text'>[], ticked: ReadonlySet<string>, scanned: ReadonlySet<string>): ChecklistLine[] {
  const many = orders.length > 1;
  const lines: ChecklistLine[] = [];
  orders.forEach((o, i) => {
    const which = many ? ` (${i + 1} of ${orders.length})` : '';
    lines.push({ key: `piece:${o.id}`, label: `The right piece: its card scanned${which}`, byScan: true, ticked: scanned.has(o.id) });
    lines.push({ key: `card:${o.id}`, label: `The card, its claim code visible${which}`, byScan: false, ticked: ticked.has(`card:${o.id}`) });
  });
  lines.push({ key: 'box', label: 'The box and the pouch', byScan: false, ticked: ticked.has('box') });
  for (const o of orders) {
    o.addons.forEach((a, j) => lines.push({ key: `addon:${o.id}:${j}`, label: `Add-on: ${a.label}`, byScan: false, ticked: ticked.has(`addon:${o.id}:${j}`) }));
    if (o.engraving_text !== null) lines.push({ key: `engraving:${o.id}`, label: `Engraving done: "${o.engraving_text}"`, byScan: false, ticked: ticked.has(`engraving:${o.id}`) });
  }
  return lines;
}

/** Who a change was made by, as a parcel's history says it: a role, never a name. */
async function actorsOf(db: Db, events: readonly { actor_type: string; actor_id: string | null }[]): Promise<Map<string, AdminRole>> {
  const ids = [...new Set(events.filter((e) => e.actor_type === 'admin' && e.actor_id).map((e) => e.actor_id!))];
  const rows = ids.length ? await db.selectFrom('admin_users').select(['id', 'role']).where('id', 'in', ids).execute() : [];
  return new Map(rows.map((r) => [r.id, r.role]));
}

/** The models, variants and SKUs of orders. */
async function modelsOf(db: Db, orders: readonly OrderRow[]): Promise<Map<string, { model: string; variant: string | null; skuCode: string | null }>> {
  if (orders.length === 0) return new Map();
  const rows = await db
    .selectFrom('orders as o')
    .innerJoin('models as m', 'm.id', 'o.model_id')
    .leftJoin('skus as k', 'k.id', 'o.sku_id')
    .select(['o.id', 'm.name', 'm.variant_label', 'k.code'])
    .where('o.id', 'in', orders.map((o) => o.id))
    .execute();
  return new Map(rows.map((r) => [r.id, { model: r.name, variant: r.variant_label, skuCode: r.code ?? null }]));
}

/** The location a parcel ships from: its shipment's, or its open orders' when they share one, or its first order's. */
function locationOf(orders: readonly OrderRow[], shipment: ShipmentRow | undefined): string {
  if (shipment) return shipment.location_id;
  const open = openOrders(orders);
  return (open[0] ?? orders[0]!).location_id;
}

/**
 * A parcel as the agent and ORBES read it, keyed by any of its orders (404 ORDER_NOT_FOUND, also outside the scope).
 * The shipment shown: the open one; otherwise, while orders are left to ship, none; otherwise the latest not cancelled.
 */
export async function parcelView(db: Db, orderId: string, scope: LocationScope, now: Date): Promise<ShippingOrderView | null> {
  const key = await parcelKeyOf(db, orderId);
  if (!key) return null;
  const all = await parcelOrders(db, key);
  const first = all.find((o) => o.id === key)!;
  const open = openOrders(all);
  let shipment = await openShipment(db, key);
  if (!shipment && open.length === 0) {
    shipment = await db.selectFrom('shipments').selectAll().where('order_id', '=', key).where('status', '<>', 'CANCELLED').orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
  }
  const locationId = locationOf(all, shipment);
  if (!inScope(scope, locationId)) return null;
  const items = shipment ? await db.selectFrom('shipment_items').selectAll().where('shipment_id', '=', shipment.id).execute() : [];
  const members = shipment ? all.filter((o) => items.some((i) => i.order_id === o.id)) : open.length > 0 ? open : all.filter((o) => o.status !== 'CANCELLED');
  const scanned = new Set(items.filter((i) => i.product_id !== null).map((i) => i.order_id));
  const models = await modelsOf(db, members);
  const pieceIds = [...new Set(members.map((o) => o.product_id).filter((p): p is string => p !== null))];
  const pieces = pieceIds.length ? await db.selectFrom('products').select(['id', 'product_id']).where('id', 'in', pieceIds).execute() : [];
  const pieceRef = new Map(pieces.map((p) => [p.id, p.product_id]));
  const location = await db.selectFrom('stock_locations').select(['id', 'name']).where('id', '=', locationId).executeTakeFirstOrThrow();
  const carrier = shipment?.carrier_id ? await db.selectFrom('carriers').select(['id', 'name', 'tracking_url']).where('id', '=', shipment.carrier_id).executeTakeFirst() : undefined;
  const carriers = await db.selectFrom('carriers').select(['id', 'name']).where('active', '=', true).orderBy('name').execute();
  const events = members.length
    ? await db
        .selectFrom('order_events')
        .select(['order_id', 'action', 'created_at', 'actor_type', 'actor_id'])
        .where('order_id', 'in', members.map((o) => o.id))
        .where('action', 'in', [...PARCEL_HISTORY_ACTIONS])
        .orderBy('created_at')
        .orderBy('id')
        .execute()
    : [];
  const roles = await actorsOf(db, events);
  const ready = parcelReady(open);
  const timing = ready ? await parcelTiming(db, open, now) : null;
  const step: ParcelStep = shipment ? (shipment.status as Exclude<ShipmentStatus, 'CANCELLED'>) : ready ? 'READY_TO_PACK' : 'NOT_READY';
  const ticked = new Set((shipment?.checklist ?? []).map((l) => l.key));
  return {
    id: key,
    reference: orderReference(key),
    location: { id: location.id, name: location.name },
    step,
    readySince: timing?.readySince ?? null,
    late: timing?.late ?? false,
    orders: members.map((o) => {
      const m = models.get(o.id)!;
      return {
        orderId: o.id,
        reference: orderReference(o.id),
        status: o.status,
        model: m.model,
        variant: m.variant,
        sizeLabel: o.size_label,
        skuCode: m.skuCode,
        addons: o.addons.map((a) => a.label),
        engraving: o.engraving_text,
        surprise: o.surprise,
        piece: o.product_id ? { productId: pieceRef.get(o.product_id)!, scanned: scanned.has(o.id) } : null,
      };
    }),
    shipTo: { name: first.buyer_name, address: first.buyer_address, country: null, phone: null },
    addressChanged: null,
    shipment: shipment
      ? {
          id: shipment.id,
          status: shipment.status,
          packingStartedAt: shipment.packing_started_at,
          packedAt: shipment.packed_at,
          shippedAt: shipment.shipped_at,
          deliveredAt: shipment.delivered_at,
          photo: shipment.photo_sha256 !== null,
          carrier: carrier ? { id: carrier.id, name: carrier.name } : null,
          trackingNumber: shipment.tracking_number,
          trackingUrl: carrier && shipment.tracking_number ? trackingLink(carrier.tracking_url, shipment.tracking_number) : null,
        }
      : null,
    checklist: checklistOf(members, ticked, scanned),
    history: events.map((e) => ({
      action: e.action,
      at: e.created_at,
      by: e.actor_type === 'account' ? 'COLLECTOR' : e.actor_type === 'admin' ? (roles.get(e.actor_id ?? '') === 'LOGISTICS' ? 'LOGISTICS' : 'ORBES') : 'SYSTEM',
      order: orderReference(e.order_id),
    })),
    carriers: carriers.map((c) => ({ id: c.id, name: c.name })),
  };
}

/**
 * The parcels to ship at the scope's locations: their open orders all PAID and holding their piece in stock, at one
 * location; the oldest ready first.
 */
export async function toShip(db: Db, scope: LocationScope, now: Date, filter: { locationId?: string } = {}): Promise<ToShipRow[]> {
  const rows = await sql<OrderRow & { parcel: string }>`
    WITH open AS (SELECT o.*, coalesce(o.with_order_id, o.id) AS parcel FROM orders o WHERE o.status IN ('RESERVED', 'PAID')),
         ready AS (SELECT parcel FROM open GROUP BY parcel
                    HAVING bool_and(status = 'PAID' AND reservation = 'STOCK') AND count(DISTINCT location_id) = 1)
    SELECT open.* FROM open JOIN ready USING (parcel)
     ORDER BY open.parcel, (open.id = open.parcel) DESC, open.reserved_at, open.id`.execute(db);
  const byParcel = new Map<string, OrderRow[]>();
  for (const r of rows.rows) {
    if (!inScope(scope, r.location_id) || (filter.locationId && r.location_id !== filter.locationId)) continue;
    byParcel.set(r.parcel, [...(byParcel.get(r.parcel) ?? []), r]);
  }
  if (byParcel.size === 0) return [];
  const all = [...byParcel.values()].flat();
  const models = await modelsOf(db, all);
  const times = await readyTimes(db, all);
  const days = await readyDays(db);
  const keys = [...byParcel.keys()];
  const firsts = await db.selectFrom('orders').select(['id', 'buyer_name', 'buyer_address']).where('id', 'in', keys).execute();
  const shipTo = new Map(firsts.map((f) => [f.id, f]));
  const shipments = await db.selectFrom('shipments').select(['order_id', 'status']).where('order_id', 'in', keys).where('status', 'in', ['PACKING', 'PACKED']).execute();
  const steps = new Map(shipments.map((s) => [s.order_id, s.status as 'PACKING' | 'PACKED']));
  const locations = new Map((await db.selectFrom('stock_locations').select(['id', 'name']).execute()).map((l) => [l.id, l.name]));
  const out: ToShipRow[] = [];
  for (const [key, orders] of byParcel) {
    const readySinceAt = new Date(Math.max(...orders.map((o) => times.get(o.id)!.getTime())));
    const to = shipTo.get(key);
    out.push({
      id: key,
      reference: orderReference(key),
      others: orders.length - 1,
      location: { id: orders[0]!.location_id, name: locations.get(orders[0]!.location_id) ?? '' },
      readySince: readySinceAt,
      late: now.getTime() > readySinceAt.getTime() + days * DAY_MS,
      pieces: orders.map((o) => ({ model: models.get(o.id)!.model, variant: models.get(o.id)!.variant, sizeLabel: o.size_label })),
      addons: orders.flatMap((o) => o.addons.map((a) => a.label)),
      engraving: orders.some((o) => o.engraving_text !== null),
      shipTo: { name: to?.buyer_name ?? null, address: to?.buyer_address ?? null, country: null },
      step: steps.get(key) ?? 'READY_TO_PACK',
      addressChanged: false,
    });
  }
  return out.sort((a, b) => a.readySince.getTime() - b.readySince.getTime() || a.id.localeCompare(b.id));
}

/** The parcels shipped and not delivered at the scope's locations, the latest first. */
export async function onItsWay(db: Db, scope: LocationScope, filter: { locationId?: string } = {}): Promise<OnItsWayRow[]> {
  const rows = await db
    .selectFrom('shipments as s')
    .innerJoin('carriers as c', 'c.id', 's.carrier_id')
    .innerJoin('stock_locations as l', 'l.id', 's.location_id')
    .select(['s.order_id', 's.location_id', 's.shipped_at', 's.tracking_number', 'c.id as carrier_id', 'c.name as carrier_name', 'c.tracking_url', 'l.name as location_name'])
    .where('s.status', '=', 'SHIPPED')
    .orderBy('s.shipped_at', 'desc')
    .orderBy('s.id')
    .execute();
  return rows
    .filter((r) => inScope(scope, r.location_id) && (!filter.locationId || r.location_id === filter.locationId))
    .map((r) => ({
      id: r.order_id,
      reference: orderReference(r.order_id),
      location: { id: r.location_id, name: r.location_name },
      shippedAt: r.shipped_at!,
      carrier: { id: r.carrier_id, name: r.carrier_name },
      trackingNumber: r.tracking_number!,
      trackingUrl: trackingLink(r.tracking_url, r.tracking_number!),
    }));
}

// ── Housekeeping ───────────────────────────────────────────────────────────

/**
 * The packing photos past their keeping, erased (§3.5.6.8): a parcel DELIVERED more than RETURN_WINDOW_DAYS ago with no
 * return nor exchange of its orders open (one opened in time keeps it until it is closed or cancelled); a parcel never
 * delivered, RETURN_WINDOW_DAYS after its parcel problem was decided or cancelled (none still open), or after the
 * shipment was cancelled. Journaled `shipment.photo.erase`. Returns how many were erased.
 */
export async function purgePackingPhotos(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETURN_WINDOW_DAYS * DAY_MS);
  const due = await sql<{ id: string }>`
    SELECT s.id FROM shipments s
     WHERE s.photo IS NOT NULL
       AND CASE
         WHEN s.status = 'DELIVERED' THEN s.delivered_at < ${cutoff}
           AND NOT EXISTS (SELECT 1 FROM order_cases c JOIN shipment_items i ON i.order_id = c.order_id
                            WHERE i.shipment_id = s.id AND c.kind IN ('RETURN', 'EXCHANGE') AND c.status IN ('OPEN', 'RECEIVED'))
         WHEN s.status = 'CANCELLED' THEN s.cancelled_at < ${cutoff}
         WHEN s.status IN ('BACK_TO_SENDER', 'LOST', 'DAMAGED') THEN
           EXISTS (SELECT 1 FROM order_cases c WHERE c.shipment_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM order_cases c WHERE c.shipment_id = s.id
                            AND (c.status IN ('OPEN', 'RECEIVED') OR coalesce(c.closed_at, c.cancelled_at) >= ${cutoff}))
         ELSE false END
     ORDER BY s.id`.execute(db);
  let erased = 0;
  for (const { id } of due.rows) {
    const done = await db.transaction().execute(async (tx) => {
      const row = await tx.updateTable('shipments').set({ photo: null, photo_mime: null, photo_sha256: null, photo_erased_at: now }).where('id', '=', id).where('photo', 'is not', null).returning(['id', 'order_id']).executeTakeFirst();
      if (!row) return false;
      await writeJournal(tx, [{ type: 'shipment.photo.erase', entityType: 'shipment', entityId: row.id, payload: { id: row.id, orderId: row.order_id, erasedAt: now.toISOString() } }], now);
      return true;
    });
    if (done) erased += 1;
  }
  return erased;
}
