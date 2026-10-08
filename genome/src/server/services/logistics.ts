/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.6.6, step 5.8; API §16.33): the stock of every size at each location as
 * the agent and ORBES read it, the corrections the agent proposes and ORBES approves, the transfers and minimums, and the
 * pieces counted in. It sits beside the atelier (services/atelier.ts), whose routes serve the Atelier page until the
 * console moves to Logistics. The packing and the shipping (step 5.9, §3.5.6.8; the parcels read in services/parcels.ts):
 *
 *   to ship        the parcels whose open orders are all paid and hold their piece in stock (`toShip`), the oldest ready
 *                  first, LATE past the READY delay; those on their way (`onItsWay`); one parcel (`parcel`, the
 *                  ShippingOrderView: no price, email, account nor release).
 *   start packing  every open order of the parcel PAID and holding STOCK (409 PACKING_NOT_READY), the first order's
 *                  address entered (409 ORDER_ADDRESS_MISSING): a shipment PACKING with one item per order, and
 *                  `orders.packing_started_at` set on each (never cleared: the address and the engraving lock there).
 *                  Audited `order.pack.start`.
 *   the scan       the card's ORBES CODE judged as /verify judges it (VerificationService.staffScan, an ADMIN_TEST scan
 *                  naming the login); AUTHENTIC only (422 PACKING_SCAN_NOT_ORBES); a piece of an unscanned item's model,
 *                  variant and size (409 PACKING_SCAN_OTHER_PIECE); a piece in stock (counted in or received:
 *                  `stock_entered_at`; ISSUED or RESOLD, unregistered, in no open order; 409 PACKING_SCAN_NOT_IN_STOCK),
 *                  or the piece already bound to that order; bound to the item and its order (`order.link` via scan,
 *                  `order.pack.scan`). Every item scanned: 409 PACKING_SCAN_DONE.
 *   the photo      JPEG or WebP, at most 1 MiB, EXIF removed (media/image.ts sanitizeImage; 422 PACKING_PHOTO_INVALID),
 *                  kept on the shipment (never in media_objects, which /api/v1/media serves), replaced until packed;
 *                  audited `order.pack.photo` with its SHA-256 and size; served to the agent and AUDITOR+, no-store.
 *   packed         every line ticked, every card scanned, the photo added (422 PACKING_INCOMPLETE): PACKED, the lines'
 *                  keys kept. Audited `order.pack.check`.
 *   ship           PACKED (409 ORDER_NOT_PACKED), its address still entered (409 ORDER_ADDRESS_MISSING): every order of the parcel SHIPPED in one transaction with the parcel's
 *                  carrier and tracking number (an active carrier), and, from ORBES staff only, a declared value per
 *                  order in its currency (403 FORBIDDEN from the agent); each piece's warranty started if it has none
 *                  (question 14: the shipping day, no point of sale, `warranty.activate` via ship).
 *   delivered      every order SHIPPED → DELIVERED (`order.deliver`); the shipment DELIVERED (also when the last of its
 *                  orders is delivered by a registration, services/orders.ts).
 *
 * The parcel's orders are locked first (its first order, then the oldest), then its shipment, then the pieces' SKUs;
 * the warranties (which audit at once) last.
 *
 *   stock          every offered size of every active model at each location, 0 included, plus a size set aside or an
 *                  inactive model's that still holds something: on hand, reserved, available, waiting (orders AWAITING
 *                  a piece there), minimum; for ORBES staff also expected (what sent supplier orders still owe there),
 *                  to order (the proposal's figure, services/supplier-orders.ts toOrderOf) and the pieces counted
 *                  without an ORBES identity behind them (`unbacked`, per SKU, every location together). The agent's view
 *                  has none of those three, and only its own locations (a location outside them: 404).
 *   unbacked       per SKU: the on-hand count of every location together minus the identities that back it (that SKU,
 *                  `stock_entered_at` set, unregistered, not retired, revoked, lost, stolen or flagged, not on a SHIPPED
 *                  or DELIVERED order). A hand count and a Generator piece have none until counted in.
 *   corrections    the agent proposes (TO_APPROVE, `stock.correction.propose`); ORBES staff's proposal is applied at
 *                  once and recorded APPROVED with themselves as approver. Applying is an ADJUSTED movement with the
 *                  reason as its note: never below what orders reserve (409 STOCK_NOT_AVAILABLE), never above the
 *                  pieces that back the count (409 STOCK_NOT_BACKED); up, it serves the orders waiting there
 *                  (`order.serve`). Approved (`stock.correction.approve`, with the movement's `stock.adjust`) or declined
 *                  with a note (`stock.correction.decline`) once (409 CORRECTION_NOT_PENDING). A correction is never
 *                  deleted.
 *   transfers      StockService.transfer (only available pieces; the destination's waiting orders served).
 *   minimums       a SKU's minimum at a location (`stock.threshold`), as the atelier set it.
 *   count in       named pieces of a SKU (ISSUED or RESOLD, unregistered, in no open order, never counted in) get
 *                  `stock_entered_at`: no movement, the count already holds them or a correction up follows (409
 *                  PIECE_NOT_COUNTABLE otherwise). Audited `stock.count_in` `{ skuId, productIds }`, never the note.
 *
 * A LOGISTICS login reaches only its own locations (`scope`): any row of another answers 404, never 403. No price,
 * total or supplier ever reaches it from here.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { inRetriedTransaction, inTransaction, type Db } from '../db/connection.js';
import { jsonText, type OrderRow, type ShipmentRow, type StockCorrectionStatus } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { sanitizeImage } from '../media/image.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import type { ImageUpload } from './media.js';
import { attachPiece, checkStep, lockOrder, ORDER_AMOUNT_MAX_MINOR, recordChange, serveWaiting, step, updateOrder } from './orders.js';
import {
  checklistOf,
  onItsWay,
  openOrders,
  openShipment,
  PACKING_PHOTO_MAX_BYTES,
  parcelKeyOf,
  parcelOrders,
  parcelReady,
  parcelView,
  toShip,
  type OnItsWayRow,
  type ShippingOrderView,
  type ToShipRow,
} from './parcels.js';
import type { ScanMeta, VerificationService, VerifyInput } from './verification.js';
import type { WarrantyService } from './warranty.js';
import { skusOf, type LocationScope } from './receptions.js';
import { assertSkuOffered } from './sizes.js';
import { knownLocation, lockSku, notAvailable, recordMovement, STOCK_MOVE_MAX, STOCK_NOTE_MAX, stockLevel, type StockLevel, type StockService } from './stock.js';
import { expectedBySku, skuWords, toOrderOf, type SupplierOrderSku } from './supplier-orders.js';

// ── Rules ──────────────────────────────────────────────────────────────────

export const LOGISTICS_LIMITS = Object.freeze({ reason: STOCK_NOTE_MAX, decisionNote: STOCK_NOTE_MAX, countIn: 100, minimum: STOCK_MOVE_MAX });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** The statuses whose identity no longer backs a count (§3.5.6.6). */
const NOT_BACKING = ['RESERVED', 'RETIRED', 'REVOKED', 'LOST', 'STOLEN', 'COUNTERFEIT_FLAGGED'] as const;
const inScope = (scope: LocationScope, locationId: string) => scope === null || scope.has(locationId);

// ── Errors ─────────────────────────────────────────────────────────────────

const locationNotFound = () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND');
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');
const correctionNotFound = () => notFound('Correction', 'CORRECTION_NOT_FOUND');
const notPending = () => conflict('CORRECTION_NOT_PENDING', 'This correction has already been decided.');
const notBacked = (pieces: number, named: string) =>
  conflict('STOCK_NOT_BACKED', `Only ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} of ${named} ${pieces === 1 ? 'exists' : 'exist'} to back this count: count a piece in first.`);
const notCountable = (productId: string) => conflict('PIECE_NOT_COUNTABLE', `${productId} cannot be counted in: it is registered, in an order, retired, or already in stock.`);
const orderNotFound = () => notFound('Order', 'ORDER_NOT_FOUND');
const shipmentNotFound = () => notFound('Shipment', 'SHIPMENT_NOT_FOUND');
const packingNotReady = () => conflict('PACKING_NOT_READY', 'This parcel is not ready: every order in it must be paid and hold its piece.');
export const addressMissing = () => conflict('ORDER_ADDRESS_MISSING', 'This order has no delivery address yet.');
const packingNotStarted = () => conflict('PACKING_NOT_STARTED', 'Start packing first.');
const packingPacked = () => conflict('PACKING_PACKED', 'The parcel is packed: it no longer changes.');
const scanNotOrbes = () => new DomainError('PACKING_SCAN_NOT_ORBES', 422, 'This card did not verify as an ORBES code. Put it aside and tell ORBES.');
const scanOtherPiece = (card: string, needed: string) =>
  conflict('PACKING_SCAN_OTHER_PIECE', `This card is ${card}. This order needs ${needed}: take a piece of that model, variant and size.`);
const scanNotInStock = (productId: string) =>
  conflict('PACKING_SCAN_NOT_IN_STOCK', `${productId} is not a piece in stock (it is registered, shipped, in another order, retired, or not counted in). Put it aside and tell ORBES.`);
const scanDone = () => conflict('PACKING_SCAN_DONE', 'Every piece of this parcel is already scanned.');
const packingIncomplete = () => new DomainError('PACKING_INCOMPLETE', 422, 'Tick every line, scan every card and add the photo before it is packed.');
const photoInvalid = () => new DomainError('PACKING_PHOTO_INVALID', 422, 'The photo could not be read: take it again.');
const notPacked = () => conflict('ORDER_NOT_PACKED', 'Pack the parcel and check it before it ships.');
const notShipped = () => new DomainError('ORDER_TRANSITION_NOT_ALLOWED', 409, 'This order cannot move to that step.', { detail: 'the parcel has not shipped' });
const carrierUnknown = () => notFound('Carrier', 'CARRIER_NOT_FOUND');
/** The statuses a piece in stock has (§3.5.6.8): issued, or back on sale. */
const IN_STOCK_STATUSES = ['ISSUED', 'RESOLD'] as const;
const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;

// ── Views ──────────────────────────────────────────────────────────────────

/** A size at a location. `expected`, `toOrder` and `unbacked` are ORBES staff's only: absent from the agent's rows. */
export interface LogisticsStockRow {
  sku: SupplierOrderSku;
  location: { id: string; name: string };
  onHand: number;
  reserved: number;
  available: number;
  /** Orders waiting for a piece of this size there (reservation AWAITING). */
  waiting: number;
  minimum: number | null;
  expected?: number;
  toOrder?: number;
  /** The SKU's pieces counted without an ORBES identity behind them, every location together (the mark NO PIECE · n). */
  unbacked?: number;
}

export interface LogisticsStock {
  rows: LogisticsStockRow[];
  /** The sizes a correction, a transfer, a minimum or a count in may name: every offered size. */
  skus: SupplierOrderSku[];
  /** The scope's locations, the default first. */
  locations: { id: string; name: string; isDefault: boolean }[];
  /** ORBES staff's only: how many sizes have pieces counted that no identity backs. */
  unbackedSizes?: number;
}

export interface CorrectionView {
  id: string;
  sku: SupplierOrderSku;
  location: { id: string; name: string };
  delta: number;
  reason: string;
  status: StockCorrectionStatus;
  proposedAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
}

// ── Checks ─────────────────────────────────────────────────────────────────

function known(id: unknown, err: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw err();
  return id.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only ORBES staff and the logistics agent change the stock.');
}

function cleanText(v: unknown, max: number, label: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError(`${label} is required.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} has at most ${max} characters.`);
  return s;
}

/** The pieces of a SKU that back its count (every location together, §3.5.6.6). */
export async function backingPieces(db: Db, skuId: string): Promise<number> {
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM products p
     WHERE p.sku_id = ${skuId} AND p.stock_entered_at IS NOT NULL AND p.ownership_state = 'UNREGISTERED'
       AND p.status NOT IN (${sql.join(NOT_BACKING.map((s) => sql`${s}`))})
       AND NOT EXISTS (SELECT 1 FROM ownership w WHERE w.product_id = p.id AND w.ended_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.product_id = p.id AND o.status IN ('SHIPPED', 'DELIVERED'))`.execute(db);
  return Number(r.rows[0]?.n ?? 0);
}

/** A SKU's on-hand count, every location together. */
async function onHandEverywhere(db: Db, skuId: string): Promise<number> {
  const r = await sql<{ n: number }>`SELECT coalesce(sum(delta), 0)::int AS n FROM stock_movements WHERE sku_id = ${skuId}`.execute(db);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * `unbacked` for many SKUs at once (the Stock read lists every offered size): the on-hand counts and the backing pieces
 * in two grouped queries per 1,000 SKUs, never two per SKU, then subtracted here. The same predicate as `backingPieces`.
 */
async function unbackedBySku(db: Db, skuIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Bounded IN lists (a parameter each): a few queries for thousands of sizes, never one per size.
  for (let i = 0; i < skuIds.length; i += 1000) for (const [id, n] of await unbackedOf(db, skuIds.slice(i, i + 1000))) out.set(id, n);
  return out;
}

async function unbackedOf(db: Db, skuIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const ids = sql.join(skuIds.map((id) => sql`${id}::uuid`));
  const onHand = await sql<{ sku_id: string; n: number }>`
    SELECT sku_id, coalesce(sum(delta), 0)::int AS n FROM stock_movements WHERE sku_id IN (${ids}) GROUP BY sku_id`.execute(db);
  const backing = await sql<{ sku_id: string; n: number }>`
    SELECT p.sku_id, count(*)::int AS n FROM products p
     WHERE p.sku_id IN (${ids}) AND p.stock_entered_at IS NOT NULL AND p.ownership_state = 'UNREGISTERED'
       AND p.status NOT IN (${sql.join(NOT_BACKING.map((s) => sql`${s}`))})
       AND NOT EXISTS (SELECT 1 FROM ownership w WHERE w.product_id = p.id AND w.ended_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.product_id = p.id AND o.status IN ('SHIPPED', 'DELIVERED'))
     GROUP BY p.sku_id`.execute(db);
  const backed = new Map(backing.rows.map((r) => [r.sku_id, Number(r.n)]));
  for (const id of skuIds) out.set(id, 0);
  for (const r of onHand.rows) out.set(r.sku_id, Math.max(0, Number(r.n) - (backed.get(r.sku_id) ?? 0)));
  return out;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface LogisticsServiceDeps {
  db: Db;
  audit: AuditService;
  stock: Pick<StockService, 'transfer'>;
  /** The packing scan (step 5.9): the card judged as /verify judges it. */
  verification?: Pick<VerificationService, 'staffScan'>;
  /** The warranty started at SHIP (step 5.9, question 14). */
  warranty?: Pick<WarrantyService, 'activate'>;
  clock?: Clock;
}

/** The agent's and ORBES's lists of parcels (GET /api/admin/logistics/orders). */
export interface ParcelsBoard {
  toShip: ToShipRow[];
  onItsWay: OnItsWayRow[];
  /** The scope's locations, the default first (the Location filter). */
  locations: { id: string; name: string; isDefault: boolean }[];
}

/** What Ship takes: the carrier and the tracking number; ORBES staff may declare a value per order (never the agent). */
export interface ShipInput {
  carrierId: string;
  trackingNumber: string;
  declaredValues?: { orderId: string; minor: number | null }[];
}

/** A card scanned: the piece it named and the parcel after it. */
export interface PackingScan {
  piece: { productId: string; sku: SupplierOrderSku };
  parcel: ShippingOrderView;
}

export class LogisticsService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly stockService: Pick<StockService, 'transfer'>;
  private readonly verification: Pick<VerificationService, 'staffScan'> | undefined;
  private readonly warranty: Pick<WarrantyService, 'activate'> | undefined;
  private readonly clock: Clock;

  constructor(deps: LogisticsServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.stockService = deps.stock;
    this.verification = deps.verification;
    this.warranty = deps.warranty;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The stock ────────────────────────────────────────────────────────────

  /**
   * Every offered size of every active model at each of the scope's locations, 0 included, and every other pair that
   * holds something (on hand, reserved, waiting, a minimum). By model, variant, size and location.
   */
  async stock(filter: { locationId?: string; modelId?: string } = {}, scope: LocationScope = null): Promise<LogisticsStock> {
    const loc = filter.locationId === undefined ? null : known(filter.locationId, locationNotFound);
    if (loc !== null && !inScope(scope, loc)) throw locationNotFound();
    const model = filter.modelId === undefined ? null : known(filter.modelId, () => notFound('Model', 'MODEL_NOT_FOUND'));
    const rows = await sql<{ sku_id: string; location_id: string; on_hand: number; reserved: number; waiting: number; minimum: number | null; location: string }>`
      WITH moved AS (SELECT sku_id, location_id, sum(delta)::int AS on_hand FROM stock_movements GROUP BY sku_id, location_id),
           held AS (SELECT sku_id, location_id, count(*)::int AS reserved FROM orders WHERE reservation = 'STOCK' GROUP BY sku_id, location_id),
           waits AS (SELECT sku_id, location_id, count(*)::int AS waiting FROM orders WHERE reservation = 'AWAITING' GROUP BY sku_id, location_id),
           pairs AS (SELECT sku_id, location_id FROM moved UNION SELECT sku_id, location_id FROM held UNION SELECT sku_id, location_id FROM waits
                     UNION SELECT sku_id, location_id FROM sku_thresholds
                     UNION SELECT k.id, l.id FROM skus k JOIN models m ON m.id = k.model_id CROSS JOIN stock_locations l
                            WHERE k.set_aside_at IS NULL AND m.active)
      SELECT p.sku_id, p.location_id, coalesce(m.on_hand, 0) AS on_hand, coalesce(h.reserved, 0) AS reserved,
             coalesce(w.waiting, 0) AS waiting, t.minimum, l.name AS location
        FROM pairs p
        LEFT JOIN moved m ON m.sku_id = p.sku_id AND m.location_id = p.location_id
        LEFT JOIN held h ON h.sku_id = p.sku_id AND h.location_id = p.location_id
        LEFT JOIN waits w ON w.sku_id = p.sku_id AND w.location_id = p.location_id
        LEFT JOIN sku_thresholds t ON t.sku_id = p.sku_id AND t.location_id = p.location_id
        JOIN skus k ON k.id = p.sku_id
        JOIN models md ON md.id = k.model_id
        JOIN stock_locations l ON l.id = p.location_id
       WHERE (${model}::uuid IS NULL OR k.model_id = ${model}::uuid)
         AND (${loc}::uuid IS NULL OR p.location_id = ${loc}::uuid)
         AND ((k.set_aside_at IS NULL AND md.active)
              OR coalesce(m.on_hand, 0) <> 0 OR coalesce(h.reserved, 0) > 0 OR coalesce(w.waiting, 0) > 0 OR t.minimum IS NOT NULL)`.execute(this.db);
    const kept = rows.rows.filter((r) => inScope(scope, r.location_id));
    const offered = await this.db
      .selectFrom('skus as k')
      .innerJoin('models as m', 'm.id', 'k.model_id')
      .select('k.id')
      .where('k.set_aside_at', 'is', null)
      .where('m.active', '=', true)
      .execute();
    const skus = await skusOf(this.db, [...kept.map((r) => r.sku_id), ...offered.map((k) => k.id)]);
    const natural = (a: SupplierOrderSku, b: SupplierOrderSku) =>
      a.model.name.localeCompare(b.model.name, 'en', { numeric: true }) ||
      a.model.id.localeCompare(b.model.id) ||
      (a.variant ?? '').localeCompare(b.variant ?? '', 'en') ||
      (a.sizeLabel ?? '').localeCompare(b.sizeLabel ?? '', 'en', { numeric: true }) ||
      a.code.localeCompare(b.code);
    const locations = (await this.db.selectFrom('stock_locations').select(['id', 'name', 'is_default']).orderBy('is_default', 'desc').orderBy('name').execute())
      .filter((l) => inScope(scope, l.id))
      .map((l) => ({ id: l.id, name: l.name, isDefault: l.is_default }));
    const out: LogisticsStock = {
      rows: [],
      skus: offered.map((k) => skus.get(k.id)!).sort(natural),
      locations,
    };
    const staff = scope === null;
    const expected = staff ? await expectedBySku(this.db) : new Map<string, number>();
    const drafts = staff ? await this.inDrafts() : new Map<string, number>();
    const unbacked = staff ? await unbackedBySku(this.db, [...new Set(kept.map((r) => r.sku_id))]) : new Map<string, number>();
    out.rows = kept
      .map((r) => {
        const sku = skus.get(r.sku_id)!;
        const onHand = Number(r.on_hand);
        const reserved = Number(r.reserved);
        const waiting = Number(r.waiting);
        const minimum = r.minimum === null ? null : Number(r.minimum);
        const row: LogisticsStockRow = { sku, location: { id: r.location_id, name: r.location }, onHand, reserved, available: onHand - reserved, waiting, minimum };
        if (staff) {
          const key = `${r.sku_id}:${r.location_id}`;
          row.expected = expected.get(key) ?? 0;
          // A size set aside is never proposed (question 7, as built).
          row.toOrder = sku.setAside ? 0 : toOrderOf({ waiting, underMinimum: Math.max(0, (minimum ?? 0) - (onHand - reserved)), expected: row.expected, inDraft: drafts.get(key) ?? 0 });
          row.unbacked = unbacked.get(r.sku_id) ?? 0;
        }
        return row;
      })
      .sort((a, b) => natural(a.sku, b.sku) || a.location.name.localeCompare(b.location.name) || a.location.id.localeCompare(b.location.id));
    if (staff) out.unbackedSizes = [...unbacked.values()].filter((n) => n > 0).length;
    return out;
  }

  /** What the drafts hold, per SKU and location. */
  private async inDrafts(): Promise<Map<string, number>> {
    const rows = await this.db
      .selectFrom('supplier_order_lines as l')
      .innerJoin('supplier_orders as o', 'o.id', 'l.supplier_order_id')
      .select(['l.sku_id', 'o.location_id', 'l.quantity'])
      .where('o.status', '=', 'DRAFT')
      .execute();
    const out = new Map<string, number>();
    for (const r of rows) out.set(`${r.sku_id}:${r.location_id}`, (out.get(`${r.sku_id}:${r.location_id}`) ?? 0) + r.quantity);
    return out;
  }

  /** A SKU's pieces counted without an ORBES identity behind them, every location together (ORBES staff, the runbook). */
  async unbacked(skuId: string): Promise<number> {
    const id = known(skuId, skuNotFound);
    return Math.max(0, (await onHandEverywhere(this.db, id)) - (await backingPieces(this.db, id)));
  }

  // ── Corrections ──────────────────────────────────────────────────────────

  /**
   * A correction of a size's count at a location: the agent's waits for ORBES (TO_APPROVE); ORBES staff's (`scope`
   * null) is applied at once and recorded APPROVED with themselves as approver. Audited `stock.correction.propose`
   * (then `.approve` for ORBES staff's).
   */
  async proposeCorrection(input: { skuId: string; locationId: string; delta: number; reason: string }, actor: Actor, scope: LocationScope): Promise<CorrectionView> {
    assertStaff(actor);
    const skuId = known(input?.skuId, skuNotFound);
    const locationId = known(input?.locationId, locationNotFound);
    if (!inScope(scope, locationId)) throw locationNotFound();
    await knownLocation(this.db, locationId);
    const delta = input.delta;
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > STOCK_MOVE_MAX) throw validationError(`Correct the count by 1 to ${STOCK_MOVE_MAX} pieces, up or down.`);
    const reason = cleanText(input.reason, LOGISTICS_LIMITS.reason, 'Why');
    const id = await inRetriedTransaction(this.db, async (tx) => {
      const sku = await tx.selectFrom('skus').select('id').where('id', '=', skuId).executeTakeFirst();
      if (!sku) throw skuNotFound();
      const now = this.clock();
      const row = await tx.insertInto('stock_corrections').values({ sku_id: skuId, location_id: locationId, delta, reason, proposed_by: actor.id!, proposed_at: now }).returning('id').executeTakeFirstOrThrow();
      await this.audit.record({ actor, action: 'stock.correction.propose', targetType: 'sku', targetId: skuId, details: { correctionId: row.id, locationId, delta } }, tx);
      if (scope === null) await this.apply(tx, row.id, actor, now);
      return row.id;
    });
    return this.correction(id, scope);
  }

  /** ORBES approves an agent's correction: the count moves (`stock.adjust`), never below reserved nor above its pieces. */
  async approveCorrection(correctionId: string, actor: Actor): Promise<CorrectionView> {
    assertStaff(actor);
    const id = known(correctionId, correctionNotFound);
    await inRetriedTransaction(this.db, (tx) => this.apply(tx, id, actor, this.clock()));
    return this.correction(id, null);
  }

  /** ORBES declines an agent's correction, with its note. Audited `stock.correction.decline`. */
  async declineCorrection(correctionId: string, input: { note: string }, actor: Actor): Promise<CorrectionView> {
    assertStaff(actor);
    const id = known(correctionId, correctionNotFound);
    const note = cleanText(input?.note, LOGISTICS_LIMITS.decisionNote, 'The note');
    await inTransaction(this.db, async (tx) => {
      const c = await tx.selectFrom('stock_corrections').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c) throw correctionNotFound();
      if (c.status !== 'TO_APPROVE') throw notPending();
      await tx.updateTable('stock_corrections').set({ status: 'DECLINED', decided_at: this.clock(), decided_by: actor.id!, decision_note: note }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'stock.correction.decline', targetType: 'sku', targetId: c.sku_id, details: { correctionId: id, locationId: c.location_id, delta: c.delta } }, tx);
    });
    return this.correction(id, null);
  }

  /** A correction applied: the SKU locked, the count checked both ways, an ADJUSTED movement, the waiting orders served. */
  private async apply(tx: Db, id: string, actor: Actor, now: Date): Promise<void> {
    const peek = await tx.selectFrom('stock_corrections').select('sku_id').where('id', '=', id).executeTakeFirst();
    if (!peek) throw correctionNotFound();
    await lockSku(tx, peek.sku_id);
    const c = await tx.selectFrom('stock_corrections').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
    if (c.status !== 'TO_APPROVE') throw notPending();
    const level = await stockLevel(tx, c.sku_id, c.location_id);
    if (c.delta < 0 && level.available + c.delta < 0) throw notAvailable(Math.max(0, level.available));
    if (c.delta > 0) {
      const backing = await backingPieces(tx, c.sku_id);
      if ((await onHandEverywhere(tx, c.sku_id)) + c.delta > backing) {
        const sku = (await skusOf(tx, [c.sku_id])).get(c.sku_id)!;
        throw notBacked(backing, skuWords(sku));
      }
    }
    const movementId = await recordMovement(tx, { skuId: c.sku_id, locationId: c.location_id, delta: c.delta, reason: 'ADJUSTED', note: c.reason }, actor, now);
    const served: AuditRecordInput[] = c.delta > 0 ? await serveWaiting(tx, c.sku_id, c.location_id, actor, now) : [];
    await tx.updateTable('stock_corrections').set({ status: 'APPROVED', decided_at: now, decided_by: actor.id!, movement_id: movementId }).where('id', '=', id).execute();
    await this.audit.record({ actor, action: 'stock.adjust', targetType: 'sku', targetId: c.sku_id, details: { locationId: c.location_id, delta: c.delta } }, tx);
    await this.audit.record({ actor, action: 'stock.correction.approve', targetType: 'sku', targetId: c.sku_id, details: { correctionId: id, locationId: c.location_id, delta: c.delta, movementId } }, tx);
    for (const n of served) await this.audit.record(n, tx);
  }

  /** The corrections of the scope's locations, the newest first (`status` to narrow). */
  async corrections(scope: LocationScope, filter: { status?: StockCorrectionStatus } = {}): Promise<{ items: CorrectionView[]; toApprove: number }> {
    let q = this.db.selectFrom('stock_corrections').select('id').orderBy('proposed_at', 'desc').orderBy('id');
    if (filter.status) q = q.where('status', '=', filter.status);
    const ids = await q.execute();
    const items = (await Promise.all(ids.map((r) => this.correction(r.id, null)))).filter((c) => inScope(scope, c.location.id));
    const pending = await this.db.selectFrom('stock_corrections').select(['location_id']).where('status', '=', 'TO_APPROVE').execute();
    return { items, toApprove: pending.filter((p) => inScope(scope, p.location_id)).length };
  }

  /** One correction (404 CORRECTION_NOT_FOUND, also outside the scope). */
  async correction(correctionId: string, scope: LocationScope): Promise<CorrectionView> {
    const id = known(correctionId, correctionNotFound);
    const c = await this.db
      .selectFrom('stock_corrections as c')
      .innerJoin('stock_locations as l', 'l.id', 'c.location_id')
      .selectAll('c')
      .select('l.name as location')
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c || !inScope(scope, c.location_id)) throw correctionNotFound();
    const sku = (await skusOf(this.db, [c.sku_id])).get(c.sku_id)!;
    return {
      id: c.id,
      sku,
      location: { id: c.location_id, name: c.location },
      delta: c.delta,
      reason: c.reason,
      status: c.status,
      proposedAt: c.proposed_at,
      decidedAt: c.decided_at,
      decisionNote: c.decision_note,
    };
  }

  // ── Transfers and minimums ───────────────────────────────────────────────

  /** Pieces moved between locations (StockService.transfer: available pieces only; the destination's waiting orders served). */
  transfer(input: { skuId: string; fromLocationId: string; toLocationId: string; quantity: number; note?: string | null }, actor: Actor): Promise<{ transferId: string; from: StockLevel; to: StockLevel }> {
    assertStaff(actor);
    return this.stockService.transfer(input, actor);
  }

  /**
   * A SKU's minimum at a location (1 to STOCK_MOVE_MAX), or none (`null`). A size set aside takes no new minimum (409
   * SIZE_SET_ASIDE); its minimum can still be removed. Audited `stock.threshold`.
   */
  async setMinimum(input: { skuId: string; locationId: string; minimum: number | null }, actor: Actor): Promise<void> {
    assertStaff(actor);
    const skuId = known(input?.skuId, skuNotFound);
    const locationId = await knownLocation(this.db, input?.locationId);
    const minimum = input.minimum;
    if (minimum !== null && (!Number.isInteger(minimum) || minimum < 1 || minimum > LOGISTICS_LIMITS.minimum)) throw validationError(`A minimum is 1 to ${LOGISTICS_LIMITS.minimum} pieces.`);
    await inTransaction(this.db, async (tx) => {
      const sku = await tx.selectFrom('skus').select('id').where('id', '=', skuId).executeTakeFirst();
      if (!sku) throw skuNotFound();
      if (minimum !== null) await assertSkuOffered(tx, skuId);
      const now = this.clock();
      const before = await tx.selectFrom('sku_thresholds').select('minimum').where('sku_id', '=', skuId).where('location_id', '=', locationId).forUpdate().executeTakeFirst();
      if ((before?.minimum ?? null) === minimum) throw validationError('Nothing to change.');
      if (minimum === null) await tx.deleteFrom('sku_thresholds').where('sku_id', '=', skuId).where('location_id', '=', locationId).execute();
      else {
        await tx
          .insertInto('sku_thresholds')
          .values({ sku_id: skuId, location_id: locationId, minimum, updated_by: actor.id!, updated_at: now })
          .onConflict((oc) => oc.columns(['sku_id', 'location_id']).doUpdateSet({ minimum, updated_by: actor.id!, updated_at: now }))
          .execute();
      }
      await this.audit.record({ actor, action: 'stock.threshold', targetType: 'sku', targetId: skuId, details: { locationId, from: before?.minimum ?? null, to: minimum } }, tx);
    });
  }

  // ── Count in ─────────────────────────────────────────────────────────────

  /**
   * Named pieces of a SKU enter the stock with their identity (`stock_entered_at`): each ISSUED or RESOLD, unregistered,
   * in no open order, never counted in (409 PIECE_NOT_COUNTABLE, the first such piece named); of that size (409
   * PIECE_NOT_COUNTABLE). No movement. Audited `stock.count_in` `{ skuId, productIds }`, never the note's words. The note
   * is checked but not stored: no column of the plan's data (§3.5.5) holds it, and the audit never does (hand-over).
   */
  async countIn(skuId: string, input: { productRefs: string[]; note: string }, actor: Actor): Promise<{ skuId: string; productIds: string[]; unbacked: number }> {
    assertStaff(actor);
    const sku = known(skuId, skuNotFound);
    cleanText(input?.note, LOGISTICS_LIMITS.reason, 'The note');
    const refs = Array.isArray(input?.productRefs) ? input.productRefs : [];
    if (refs.length === 0 || refs.length > LOGISTICS_LIMITS.countIn) throw validationError(`Name 1 to ${LOGISTICS_LIMITS.countIn} pieces.`);
    const wanted = refs.map((r) => {
      const s = typeof r === 'string' ? r.trim() : '';
      if (UUID_RE.test(s)) return { uuid: s.toLowerCase(), productId: null };
      if (PRODUCT_ID_RE.test(s)) return { uuid: null, productId: s.toUpperCase() };
      throw validationError(`${s || 'A piece'} is not an ORBES serial, such as O26-J-00184.`);
    });
    const productIds = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const exists = await tx.selectFrom('skus').select('id').where('id', '=', sku).executeTakeFirst();
      if (!exists) throw skuNotFound();
      await lockSku(tx, sku);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const w of wanted) {
        const p = await tx
          .selectFrom('products')
          .select(['id', 'product_id', 'sku_id', 'status', 'ownership_state', 'stock_entered_at'])
          .where(w.uuid ? 'id' : 'product_id', '=', (w.uuid ?? w.productId)!)
          .forUpdate()
          .executeTakeFirst();
        if (!p) throw notFound('Product', 'PRODUCT_NOT_FOUND');
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        if (p.sku_id !== sku) {
          const named = (await skusOf(tx, [sku])).get(sku)!;
          throw conflict('PIECE_NOT_COUNTABLE', `${p.product_id} is not a piece of ${skuWords(named)}.`);
        }
        const open = await tx.selectFrom('orders').select('id').where('product_id', '=', p.id).where('status', 'not in', ['CANCELLED', 'RETURNED']).executeTakeFirst();
        const owned = await tx.selectFrom('ownership').select('product_id').where('product_id', '=', p.id).where('ended_at', 'is', null).executeTakeFirst();
        if (!['ISSUED', 'RESOLD'].includes(p.status) || p.ownership_state !== 'UNREGISTERED' || owned || open || p.stock_entered_at !== null) throw notCountable(p.product_id);
        await tx.updateTable('products').set({ stock_entered_at: now, updated_at: now }).where('id', '=', p.id).execute();
        out.push(p.product_id);
      }
      await this.audit.record({ actor, action: 'stock.count_in', targetType: 'sku', targetId: sku, details: { skuId: sku, productIds: out } }, tx);
      return out;
    });
    return { skuId: sku, productIds, unbacked: await this.unbacked(sku) };
  }

  // ── Packing and shipping (step 5.9, §3.5.6.8) ────────────────────────────

  /** The parcels to ship and those on their way, at the scope's locations (?locationId= to narrow). */
  async parcels(scope: LocationScope, filter: { locationId?: string } = {}): Promise<ParcelsBoard> {
    const loc = filter.locationId === undefined ? undefined : known(filter.locationId, locationNotFound);
    if (loc !== undefined && !inScope(scope, loc)) throw locationNotFound();
    const now = this.clock();
    const locations = (await this.db.selectFrom('stock_locations').select(['id', 'name', 'is_default']).orderBy('is_default', 'desc').orderBy('name').execute())
      .filter((l) => inScope(scope, l.id))
      .map((l) => ({ id: l.id, name: l.name, isDefault: l.is_default }));
    const narrow = loc ? { locationId: loc } : {};
    return { toShip: await toShip(this.db, scope, now, narrow), onItsWay: await onItsWay(this.db, scope, narrow), locations };
  }

  /** One parcel, by any of its orders (404 ORDER_NOT_FOUND, also outside the scope). */
  async parcel(orderId: string, scope: LocationScope): Promise<ShippingOrderView> {
    const id = known(orderId, orderNotFound);
    const view = await parcelView(this.db, id, scope, this.clock());
    if (!view) throw orderNotFound();
    return view;
  }

  /**
   * Start packing: a shipment PACKING for the parcel's open orders, each PAID and holding its piece in stock, the first
   * order's address entered; `packing_started_at` set on each (kept when set before). Audited `order.pack.start`.
   * Pressed again while packing, nothing changes.
   */
  async startPacking(orderId: string, actor: Actor, scope: LocationScope): Promise<ShippingOrderView> {
    assertStaff(actor);
    const key = await this.parcelKey(orderId);
    await inTransaction(this.db, async (tx) => {
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const open = openOrders(all);
      this.assertParcelScope(all, undefined, scope);
      const shipment = await openShipment(tx, key, { forUpdate: true });
      if (shipment && (shipment.status === 'PACKING' || shipment.status === 'PACKED')) return;
      if (shipment || !parcelReady(open)) throw packingNotReady();
      const first = all.find((o) => o.id === key)!;
      if (first.buyer_name === null || first.buyer_address === null) throw addressMissing();
      const now = this.clock();
      const created = await tx
        .insertInto('shipments')
        .values({ order_id: key, location_id: open[0]!.location_id, status: 'PACKING', packing_started_at: now, packing_started_by: actor.id!, created_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('shipment_items').values(open.map((o) => ({ shipment_id: created.id, order_id: o.id }))).execute();
      const notes: AuditRecordInput[] = [];
      for (const o of open) {
        const after = o.packing_started_at === null ? await updateOrder(tx, o.id, { packing_started_at: now < o.paid_at! ? o.paid_at! : now }) : o;
        notes.push(await recordChange(tx, o, after, 'order.pack.start', { details: { shipmentId: created.id, parcel: key } }, actor, now));
      }
      for (const n of notes) await this.audit.record(n, tx);
    });
    return this.parcel(key, scope);
  }

  /**
   * The packing scan of a card (`input`: what the console's decoder read, the body of /verify), recorded as one staff scan
   * naming the login (rate group `verify` on its route). See the header for its refusals.
   */
  async scanCard(orderId: string, input: VerifyInput, actor: Actor, meta: ScanMeta, scope: LocationScope): Promise<PackingScan> {
    assertStaff(actor);
    if (!this.verification) throw new Error('LogisticsService: the packing scan needs the verification service');
    const key = await this.parcelKey(orderId);
    // The parcel's scope and step are checked before the scan is recorded, then again under the locks.
    const view = await this.parcel(key, scope);
    if (view.shipment === null || !['PACKING', 'PACKED'].includes(view.shipment.status)) throw packingNotStarted();
    const scanned = await this.verification.staffScan(input, { adminId: actor.id!, meta }, async (tx, scan) => {
      if (scan.state !== 'AUTHENTIC' || !scan.piece) throw scanNotOrbes();
      const now = this.clock();
      // The piece first (as a return, a registration), then the parcel's orders, then the shipment.
      const p = await tx
        .selectFrom('products')
        .select(['id', 'product_id', 'sku_id', 'status', 'ownership_state', 'stock_entered_at'])
        .where('id', '=', scan.piece.productUuid)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const shipment = await openShipment(tx, key, { forUpdate: true });
      if (!shipment || shipment.status === 'SHIPPED') throw packingNotStarted();
      const items = await tx.selectFrom('shipment_items').selectAll().where('shipment_id', '=', shipment.id).execute();
      const already = items.find((i) => i.product_id === p.id);
      if (already) return { productId: p.product_id, skuId: p.sku_id };
      const unscanned = items.filter((i) => i.product_id === null).map((i) => all.find((o) => o.id === i.order_id)!);
      if (unscanned.length === 0) throw scanDone();
      if (shipment.status === 'PACKED') throw packingPacked();
      // The order of this size that already holds this piece, else one holding none.
      const sameSku = unscanned.filter((o) => p.sku_id !== null && o.sku_id === p.sku_id);
      const target = sameSku.find((o) => o.product_id === p.id) ?? sameSku.find((o) => o.product_id === null);
      if (!target) {
        const skus = await skusOf(tx, [...(p.sku_id ? [p.sku_id] : []), ...unscanned.map((o) => o.sku_id!).filter(Boolean)]);
        const card = p.sku_id ? skuWords(skus.get(p.sku_id)!) : p.product_id;
        const needed = (sameSku[0] ?? unscanned[0])!;
        if (sameSku.length > 0) throw scanNotInStock(p.product_id);
        throw scanOtherPiece(card, skuWords(skus.get(needed.sku_id!)!));
      }
      if (target.product_id !== p.id) {
        const openOrder = await tx.selectFrom('orders').select('id').where('product_id', '=', p.id).where('status', 'not in', ['CANCELLED', 'RETURNED']).executeTakeFirst();
        const owned = await tx.selectFrom('ownership').select('product_id').where('product_id', '=', p.id).where('ended_at', 'is', null).executeTakeFirst();
        if (p.stock_entered_at === null || !(IN_STOCK_STATUSES as readonly string[]).includes(p.status) || p.ownership_state !== 'UNREGISTERED' || owned || openOrder) {
          throw scanNotInStock(p.product_id);
        }
      }
      const notes: AuditRecordInput[] = [];
      let order = target;
      if (target.product_id !== p.id) {
        const linked = await attachPiece(tx, target, p.id, 'scan', actor, now);
        order = linked.order;
        notes.push(linked.note);
      }
      await tx
        .updateTable('shipment_items')
        .set({ product_id: p.id, scan_event_id: scan.scanId, scanned_at: now })
        .where('shipment_id', '=', shipment.id)
        .where('order_id', '=', target.id)
        .execute();
      notes.push(await recordChange(tx, target, order, 'order.pack.scan', { details: { shipmentId: shipment.id, productId: p.id, scanId: scan.scanId } }, actor, now));
      for (const n of notes) await this.audit.record(n, tx);
      return { productId: p.product_id, skuId: p.sku_id };
    });
    const sku = scanned.skuId ? (await skusOf(this.db, [scanned.skuId])).get(scanned.skuId)! : null;
    if (!sku) throw scanNotOrbes();
    return { piece: { productId: scanned.productId, sku }, parcel: await this.parcel(key, scope) };
  }

  /**
   * The photo of the packed parcel (JPEG or WebP, at most 1 MiB, EXIF removed), kept on the shipment until replaced, then
   * erased 14 days after delivery. Audited `order.pack.photo` with its SHA-256 and size, never the bytes.
   */
  async setPhoto(orderId: string, upload: ImageUpload, actor: Actor, scope: LocationScope): Promise<ShippingOrderView> {
    assertStaff(actor);
    const key = await this.parcelKey(orderId);
    let clean: ReturnType<typeof sanitizeImage>;
    try {
      if (upload.bytes.length > PACKING_PHOTO_MAX_BYTES) throw photoInvalid();
      clean = sanitizeImage(upload.bytes, upload.mime);
    } catch (e) {
      if (e instanceof DomainError && e.code === 'PAYLOAD_TOO_LARGE') throw e;
      throw photoInvalid();
    }
    const sha256 = createHash('sha256').update(clean.bytes).digest('hex');
    await inTransaction(this.db, async (tx) => {
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const shipment = await openShipment(tx, key, { forUpdate: true });
      this.assertParcelScope(all, shipment, scope);
      if (!shipment) throw packingNotStarted();
      if (shipment.status !== 'PACKING') throw packingPacked();
      const now = this.clock();
      await tx.updateTable('shipments').set({ photo: clean.bytes, photo_mime: clean.mime, photo_sha256: sha256 }).where('id', '=', shipment.id).execute();
      const notes: AuditRecordInput[] = [];
      for (const o of await this.itemOrders(tx, shipment, all)) notes.push(await recordChange(tx, o, o, 'order.pack.photo', { details: { shipmentId: shipment.id, sha256, bytes: clean.bytes.length } }, actor, now));
      for (const n of notes) await this.audit.record(n, tx);
    });
    return this.parcel(key, scope);
  }

  /** A parcel's packing photo (404 SHIPMENT_NOT_FOUND without one, erased, or outside the scope): ORBES and the agent only. */
  async photo(shipmentId: string, scope: LocationScope): Promise<{ mime: string; bytes: Uint8Array; sha256: string }> {
    const id = known(shipmentId, shipmentNotFound);
    const s = await this.db.selectFrom('shipments').select(['location_id', 'photo', 'photo_mime', 'photo_sha256']).where('id', '=', id).executeTakeFirst();
    if (!s || !inScope(scope, s.location_id) || s.photo === null) throw shipmentNotFound();
    return { mime: s.photo_mime!, bytes: s.photo, sha256: s.photo_sha256! };
  }

  /**
   * Packed: every line of the checklist ticked (`ticked`, by key; the scan lines by their scans), every card scanned,
   * the photo added (422 PACKING_INCOMPLETE). Audited `order.pack.check` with the lines' keys.
   */
  async checkPacked(orderId: string, input: { ticked: string[] }, actor: Actor, scope: LocationScope): Promise<ShippingOrderView> {
    assertStaff(actor);
    const key = await this.parcelKey(orderId);
    const ticked = new Set(Array.isArray(input?.ticked) ? input.ticked.filter((k): k is string => typeof k === 'string') : []);
    await inTransaction(this.db, async (tx) => {
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const shipment = await openShipment(tx, key, { forUpdate: true });
      this.assertParcelScope(all, shipment, scope);
      if (!shipment) throw packingNotStarted();
      if (shipment.status !== 'PACKING') throw packingPacked();
      const items = await tx.selectFrom('shipment_items').selectAll().where('shipment_id', '=', shipment.id).execute();
      const members = await this.itemOrders(tx, shipment, all);
      const scanned = new Set(items.filter((i) => i.product_id !== null).map((i) => i.order_id));
      const lines = checklistOf(members, ticked, scanned);
      if (lines.some((l) => !l.ticked) || shipment.photo === null) throw packingIncomplete();
      const now = this.clock();
      await tx
        .updateTable('shipments')
        .set({ status: 'PACKED', packed_at: now < shipment.packing_started_at ? shipment.packing_started_at : now, packed_by: actor.id!, checklist: jsonText(lines.map((l) => ({ key: l.key, label: l.label }))) })
        .where('id', '=', shipment.id)
        .execute();
      const notes: AuditRecordInput[] = [];
      for (const o of members) notes.push(await recordChange(tx, o, o, 'order.pack.check', { details: { shipmentId: shipment.id, keys: lines.map((l) => l.key) } }, actor, now));
      for (const n of notes) await this.audit.record(n, tx);
    });
    return this.parcel(key, scope);
  }

  /**
   * Ship the parcel, PACKED (409 ORDER_NOT_PACKED): every order SHIPPED in one transaction with the carrier (an active
   * one, 404 CARRIER_NOT_FOUND) and the tracking number; ORBES staff (`scope` null) may declare a value per order, the
   * agent never (403). Each piece whose warranty has not started gets it now (question 14). Audited `order.ship` per
   * order, `warranty.activate` via ship.
   */
  async ship(orderId: string, input: ShipInput, actor: Actor, scope: LocationScope): Promise<ShippingOrderView> {
    assertStaff(actor);
    if (scope !== null && input?.declaredValues !== undefined) throw forbidden('Only ORBES staff declare a value.');
    const key = await this.parcelKey(orderId);
    if (typeof input?.carrierId !== 'string' || !UUID_RE.test(input.carrierId)) throw carrierUnknown();
    const tracking = typeof input.trackingNumber === 'string' ? input.trackingNumber.trim() : '';
    if (!TRACKING_RE.test(tracking)) throw validationError('A tracking number has 3 to 40 letters and digits.');
    const declared = new Map<string, number | null>();
    for (const d of input.declaredValues ?? []) {
      if (typeof d?.orderId !== 'string' || !UUID_RE.test(d.orderId)) throw validationError('A declared value names an order of the parcel.');
      if (d.minor !== null && (!Number.isInteger(d.minor) || d.minor < 0 || d.minor > ORDER_AMOUNT_MAX_MINOR)) throw validationError('The declared value must be 0 to 1 000 000.00.');
      declared.set(d.orderId.toLowerCase(), d.minor);
    }
    await inRetriedTransaction(this.db, async (tx) => {
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const shipment = await openShipment(tx, key, { forUpdate: true });
      this.assertParcelScope(all, shipment, scope);
      if (!shipment || shipment.status !== 'PACKED') throw notPacked();
      // §1.1 (d): Ship refuses a parcel without its delivery address too (Client Services may have cleared it meanwhile).
      const first = all.find((o) => o.id === key)!;
      if (first.buyer_name === null || first.buyer_address === null) throw addressMissing();
      const members = await this.itemOrders(tx, shipment, all);
      for (const id of declared.keys()) if (!members.some((o) => o.id === id)) throw validationError('A declared value names an order of the parcel.');
      const carrier = await tx.selectFrom('carriers').select(['id', 'active']).where('id', '=', input.carrierId.toLowerCase()).executeTakeFirst();
      if (!carrier || !carrier.active) throw carrierUnknown();
      const items = await tx.selectFrom('shipment_items').selectAll().where('shipment_id', '=', shipment.id).execute();
      if (items.some((i) => i.product_id === null)) throw notPacked();
      const now = this.clock();
      const notes: AuditRecordInput[] = [];
      for (const o of members) {
        const s = checkStep({ to: 'SHIPPED', carrierId: carrier.id, trackingNumber: tracking, declaredValueMinor: declared.get(o.id) ?? null });
        await step(tx, o, s, actor, now, notes);
      }
      await tx
        .updateTable('shipments')
        .set({ status: 'SHIPPED', carrier_id: carrier.id, tracking_number: tracking, shipped_at: now < shipment.packed_at! ? shipment.packed_at! : now, shipped_by: actor.id! })
        .where('id', '=', shipment.id)
        .execute();
      for (const n of notes) await this.audit.record(n, tx);
      // Last (the warranties audit at once): each piece without a started warranty gets it, for its order.
      if (this.warranty) {
        for (const o of members) {
          const productId = items.find((i) => i.order_id === o.id)!.product_id!;
          const w = await tx.selectFrom('warranties').select(['start_date', 'voided_at']).where('product_id', '=', productId).executeTakeFirst();
          if (w?.start_date || w?.voided_at) continue;
          // Open point (H2's hand-over): question 14 as built names the delivery address's country (§3.5.6.8b, §5.1).
          // The order's country arrives with migration <N+6>_order_delivery (step 6.6); from step 6.7, pass the
          // parcel's delivery country here (`addressOf(first order).country`), asserted in packing.test (the warranty's
          // country and the `warranty.activate` audit). Until then: null.
          await this.warranty.activate(productId, { retailerId: null, country: null }, actor, { tx, via: { via: 'ship', orderId: o.id } });
        }
      }
    });
    return this.parcel(key, scope);
  }

  /** The parcel has reached the collector: every order SHIPPED → DELIVERED, the shipment DELIVERED. Audited `order.deliver`. */
  async markDelivered(orderId: string, actor: Actor, scope: LocationScope): Promise<ShippingOrderView> {
    assertStaff(actor);
    const key = await this.parcelKey(orderId);
    await inTransaction(this.db, async (tx) => {
      const all = await parcelOrders(tx, key, { forUpdate: true });
      const shipment = await openShipment(tx, key, { forUpdate: true });
      this.assertParcelScope(all, shipment, scope);
      if (!shipment || shipment.status !== 'SHIPPED') throw notShipped();
      const members = (await this.itemOrders(tx, shipment, all)).filter((o) => o.status === 'SHIPPED');
      if (members.length === 0) throw notShipped();
      const now = this.clock();
      const notes: AuditRecordInput[] = [];
      for (const o of members) await step(tx, o, { to: 'DELIVERED', note: null, details: { by: 'logistics' } }, actor, now, notes);
      for (const n of notes) await this.audit.record(n, tx);
    });
    return this.parcel(key, scope);
  }

  /** The key of the parcel of an order (404 ORDER_NOT_FOUND). */
  private async parcelKey(orderId: string): Promise<string> {
    const id = known(orderId, orderNotFound);
    const key = await parcelKeyOf(this.db, id);
    if (!key) throw orderNotFound();
    return key;
  }

  /** 404 ORDER_NOT_FOUND for a parcel outside the scope: its shipment's location, or its open orders'. */
  private assertParcelScope(all: readonly OrderRow[], shipment: ShipmentRow | undefined, scope: LocationScope): void {
    const open = openOrders(all);
    const location = shipment?.location_id ?? (open[0] ?? all[0])?.location_id;
    if (!location || !inScope(scope, location)) throw orderNotFound();
  }

  /** The orders of a shipment, as the parcel's locked rows. */
  private async itemOrders(tx: Db, shipment: ShipmentRow, all: readonly OrderRow[]): Promise<OrderRow[]> {
    const items = await tx.selectFrom('shipment_items').select('order_id').where('shipment_id', '=', shipment.id).execute();
    const ids = new Set(items.map((i) => i.order_id));
    const members = all.filter((o) => ids.has(o.id));
    // An item's order is always one of the parcel's (its key's or travelling with it); re-read defensively otherwise.
    for (const id of ids) if (!members.some((o) => o.id === id)) members.push(await lockOrder(tx, id));
    return members;
  }
}
