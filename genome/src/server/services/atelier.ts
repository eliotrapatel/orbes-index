/**
 * The atelier (plan LIVE RELEASE+ of 2026-10-04: choices 8, 14 and 15, The console → Atelier, Interconnection): the
 * stock per SKU and location, its thresholds and what they suggest to make, the pieces to make per release, model and
 * size, their work sheets, and the piece issued from each, linked to the order it fulfils or entered in stock.
 *
 *   the stock      per SKU and location: on hand, reserved, available (services/stock.ts, from the ledger), the pieces
 *                  being made for the stock there, its minimum when one is set (`sku_thresholds`, L2) and what that
 *                  minimum suggests: enough pieces to make to reach it (minimum − available − being made), which the
 *                  console confirms (`makeForStock`: pieces to make for the stock, each with its ORBES identity
 *                  reserved at once, L6). Transfers and counts corrected are StockService's.
 *   pieces to make each for an order (made to order, services/orders.ts) or for the stock, of a SKU, for a location
 *                  and a release: TO_MAKE → IN_PROGRESS (`start`) → DONE (`done`); a piece to make for the stock may
 *                  be CANCELLED (`cancel`; an order's goes with the order). Listed per release, model and size, with
 *                  the CSV of what to make.
 *   work sheets    one per piece to make (`sheets`): its reference (O26-J-00184) and its ORBES code drawn at print size
 *                  — the code of its reserved identity, signed for the sheet when it has none yet
 *                  (IssuanceService.signReserved: /verify still answers it as an unknown code) — the model, size,
 *                  add-ons, engraving text and the surprise. The answer carries the code's data: OPERATOR only.
 *   issuing        DONE issues the piece (L6: issuing confirms its identity), in one transaction with the signer held
 *                  (IssuanceService.inSigningTransaction): its code signed if no sheet signed it, the identity ISSUED
 *                  with its material, batch, production date and claim code (shown once), the piece entering the
 *                  ledger at the location it was made for (PRODUCED, +1), and, made for an order, linked to it (the
 *                  order then holds it in stock: `attachPiece`, `order.link`). A piece of an order held in stock is
 *                  linked by picking one piece of its SKU from the stock (`linkFromStock`): issued and never sold, or
 *                  back from a return. An order holding a piece to make may take a finished piece the same way (one
 *                  made in advance, choice 8): its piece to make is cancelled and its reserved identity retired, and
 *                  the piece is taken from what is available at the order's location or, nothing being available
 *                  there and the piece never having entered the ledger (issued in the Generator), counted in with
 *                  the order (PRODUCED, +1).
 *
 * Lock order (as services/orders.ts): the order, the SKU, the piece to make, the piece; the serials, the journal; the
 * audit log last. Journaled: `bench.create`, `.start`, `.done`, `.cancel`, `product.issue`, `product.retire`,
 * `stock.move`, `order.link`. Audited: `stock.threshold`, `bench.create`, `bench.start`, `bench.done`, `bench.cancel`,
 * `bench.sheet`, `product.issue`, `order.link` (and `code.sign` for a sheet's code), by ids and counts, never an
 * engraving text.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { BenchItemRow, BenchItemStatus, OrderChannel, OrderStatus, ProductStatus } from '../db/schema.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import { confirmReservedIdentity, RESERVED_MATERIAL_PENDING, reserveIdentity, retireReservedIdentity, type IssuanceService } from './issuance.js';
import { writeJournal } from './journal.js';
import { attachPiece, benchPayload, ORDER_HOLDING_STATUSES, orderReference, release, type OrderService, type OrderView } from './orders.js';
import { knownLocation, lockSku, recordMovement, STOCK_MOVE_MAX, stockLevel } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The steps of a piece to make: TO_MAKE → IN_PROGRESS → DONE; CANCELLED before DONE (a piece for the stock only). */
export const BENCH_TRANSITIONS: Readonly<Record<BenchItemStatus, readonly BenchItemStatus[]>> = Object.freeze({
  TO_MAKE: Object.freeze(['IN_PROGRESS', 'CANCELLED'] as const),
  IN_PROGRESS: Object.freeze(['DONE', 'CANCELLED'] as const),
  DONE: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
});
/** The open steps: a piece being made. */
export const BENCH_OPEN: readonly BenchItemStatus[] = Object.freeze(['TO_MAKE', 'IN_PROGRESS']);
/** A piece picked from the stock for an order: issued and never sold, or back from a return (services/orders.ts returnOrder). */
export const STOCK_PIECE_STATUSES: readonly ProductStatus[] = Object.freeze(['ISSUED', 'RESOLD']);
/** What the list of pieces to make shows: the open ones (the default), the finished, the cancelled, or all. */
export const BENCH_VIEWS = Object.freeze(['OPEN', 'DONE', 'CANCELLED', 'ALL'] as const);
export type BenchView = (typeof BENCH_VIEWS)[number];
/** Pieces to make for the stock confirmed at once, at most. */
export const ATELIER_MAKE_MAX = 50;
/** Work sheets printed at once, at most. */
export const WORK_SHEETS_MAX = 100;
/** Pieces to make the list carries, at most (its count says how many the filters keep). */
export const BENCH_LIST_MAX = 500;
/** A minimum per SKU and location (sku_thresholds.minimum). */
export const THRESHOLD_MAX = STOCK_MOVE_MAX;
/** What the atelier says of a finished piece, at most. */
export const ISSUE_TEXT_LIMITS = Object.freeze({ material: 200, productionBatch: 100 });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIECE_REF_RE = /^O\d{2}-[A-Z]-\d{5,6}$/i;
const CONTROL_CHARS = /[\p{Cc}�]/u;

/** What the stock suggests making for a SKU at a location (L2): enough to reach its minimum; 0 without one. */
export function suggestedPieces(minimum: number | null, available: number, toMake: number): number {
  return minimum === null ? 0 : Math.max(0, minimum - available - toMake);
}

// ── Errors ─────────────────────────────────────────────────────────────────

const benchNotFound = () => notFound('Piece to make', 'BENCH_ITEM_NOT_FOUND');
const stepNotAllowed = (from: BenchItemStatus, to: BenchItemStatus) =>
  new DomainError('BENCH_STEP_NOT_ALLOWED', 409, from === 'TO_MAKE' && to === 'DONE' ? 'Start the piece before it is finished.' : 'This piece to make cannot move to that step.', { detail: `${from} → ${to}` });
const forOrder = () => conflict('BENCH_FOR_ORDER', 'This piece is made for an order: cancel the order instead.');
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');

// ── Views ──────────────────────────────────────────────────────────────────

/** A SKU as the atelier names it. */
export interface SkuView {
  id: string;
  code: string;
  model: { id: string; name: string };
  sizeLabel: string | null;
}

/** One row of the stock: a SKU at a location. */
export interface AtelierStockRow {
  sku: SkuView;
  location: { id: string; name: string };
  onHand: number;
  reserved: number;
  available: number;
  /** Pieces to make for the stock there, open. */
  toMake: number;
  /** Its minimum (L2), or null. */
  minimum: number | null;
  /** What the minimum suggests making (suggestedPieces). */
  suggestion: number;
}

export interface AtelierStock {
  rows: AtelierStockRow[];
  /** Every SKU and every location: the choices of a threshold, a transfer, a count. */
  skus: SkuView[];
  locations: { id: string; name: string; isDefault: boolean }[];
}

/** A piece to make as the atelier reads it. */
export interface BenchItemView {
  id: string;
  status: BenchItemStatus;
  createdAt: Date;
  startedAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
  /** Its ORBES identity: reserved while it is made, issued once DONE. */
  piece: { id: string; reference: string; status: string; material: string; signed: boolean };
  order: { id: string; reference: string; status: OrderStatus; channel: OrderChannel } | null;
  origin: BenchOrigin;
  sku: SkuView;
  location: { id: string; name: string };
  engravingText: string | null;
  surprise: string | null;
  /** The add-ons of its order, as sold (labels). */
  addons: string[];
}

/** Whom pieces to make are for: the orders of a release, the private salon's orders, or the stock. */
export type BenchOrigin = { kind: 'RELEASE'; release: { id: string; title: string } } | { kind: 'SALON' } | { kind: 'STOCK' };

/** The pieces to make of one origin (a release, the private salon, the stock), one model and one size. */
export interface BenchGroup {
  origin: BenchOrigin;
  sku: SkuView;
  counts: Record<BenchItemStatus, number>;
  items: BenchItemView[];
}

export interface BenchList {
  groups: BenchGroup[];
  /** The pieces to make the filters keep (the groups carry the first BENCH_LIST_MAX). */
  total: number;
  /** The releases with pieces to make, the latest first: the filter's choices (with SALON and STOCK). */
  releases: { id: string; title: string }[];
}

export interface BenchFilter {
  view?: BenchView;
  /** A release's id; 'SALON' for the private salon's orders; 'STOCK' for the pieces made for the stock. */
  origin?: string;
  skuId?: string;
  locationId?: string;
}

/** A work sheet: one piece to make, its code drawn at print size. */
export interface WorkSheet {
  benchItemId: string;
  status: BenchItemStatus;
  reference: string;
  code: { codeId: string; data: string; glyphs: number[] };
  model: string;
  sizeLabel: string | null;
  skuCode: string;
  addons: string[];
  engravingText: string | null;
  surprise: string | null;
  /** The release's title; null for the private salon's orders and the stock (`order` says which). */
  release: string | null;
  order: { reference: string; channel: OrderChannel } | null;
  location: string;
  createdAt: Date;
}

/** What the atelier says of a finished piece when it issues it. */
export interface IssueBenchInput {
  /** Required when the reserved identity's material is still to be confirmed; the model's otherwise. */
  material?: string | null;
  productionBatch?: string | null;
  /** YYYY-MM-DD, never after tomorrow. */
  productionDate?: string | null;
  /** A one-time claim code for its buyer (shown once): true by default. */
  withClaimSecret?: boolean;
}

export interface IssuedBenchItem {
  item: BenchItemView;
  productId: string;
  codeId: string;
  /** XXXX-XXXX-XXXX, shown once; only its hash is stored. */
  claimCode?: string;
}

const EMPTY_COUNTS = (): Record<BenchItemStatus, number> => ({ TO_MAKE: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 });

function cleanText(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.trim();
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

function knownBench(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw benchNotFound();
  return id.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw new DomainError('FORBIDDEN', 403, 'Only the atelier changes a piece to make.');
}

// ── Service ────────────────────────────────────────────────────────────────

export interface AtelierServiceDeps {
  db: Db;
  audit: AuditService;
  issuance: IssuanceService;
  orders: OrderService;
  clock?: Clock;
}

interface BenchRow extends BenchItemRow {
  piece_reference: string;
  piece_status: string;
  material: string;
  signed: boolean;
  sku_code: string;
  size_label: string | null;
  model_id: string;
  model_name: string;
  location_name: string;
  release_title: string | null;
  order_status: OrderStatus | null;
  order_channel: OrderChannel | null;
  order_addons: { label: string }[] | null;
}

export class AtelierService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly issuance: IssuanceService;
  private readonly orders: OrderService;
  private readonly clock: Clock;

  constructor(deps: AtelierServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.issuance = deps.issuance;
    this.orders = deps.orders;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The stock ────────────────────────────────────────────────────────────

  /**
   * The stock per SKU and location: every pair that moved, is reserved, has a minimum or pieces being made for it, by
   * model, size and location; narrowed to a model or a location.
   */
  async stock(filter: { modelId?: string; locationId?: string } = {}): Promise<AtelierStock> {
    const rows = await sql<{
      sku_id: string;
      location_id: string;
      on_hand: number;
      reserved: number;
      minimum: number | null;
      to_make: number;
      code: string;
      model_id: string;
      model: string;
      size_label: string | null;
      location: string;
    }>`
      WITH moved AS (SELECT sku_id, location_id, sum(delta)::int AS on_hand FROM stock_movements GROUP BY sku_id, location_id),
           held AS (SELECT sku_id, location_id, count(*)::int AS reserved FROM orders WHERE reservation = 'STOCK' GROUP BY sku_id, location_id),
           made AS (SELECT sku_id, location_id, count(*)::int AS to_make FROM bench_items
                     WHERE order_id IS NULL AND status IN ('TO_MAKE', 'IN_PROGRESS') GROUP BY sku_id, location_id),
           pairs AS (SELECT sku_id, location_id FROM moved UNION SELECT sku_id, location_id FROM held
                     UNION SELECT sku_id, location_id FROM sku_thresholds UNION SELECT sku_id, location_id FROM made)
      SELECT p.sku_id, p.location_id, coalesce(m.on_hand, 0) AS on_hand, coalesce(h.reserved, 0) AS reserved, t.minimum,
             coalesce(b.to_make, 0) AS to_make, k.code, k.model_id, md.name AS model, k.size_label, l.name AS location
        FROM pairs p
        LEFT JOIN moved m ON m.sku_id = p.sku_id AND m.location_id = p.location_id
        LEFT JOIN held h ON h.sku_id = p.sku_id AND h.location_id = p.location_id
        LEFT JOIN made b ON b.sku_id = p.sku_id AND b.location_id = p.location_id
        LEFT JOIN sku_thresholds t ON t.sku_id = p.sku_id AND t.location_id = p.location_id
        JOIN skus k ON k.id = p.sku_id
        JOIN models md ON md.id = k.model_id
        JOIN stock_locations l ON l.id = p.location_id
       WHERE (${filter.modelId ?? null}::uuid IS NULL OR k.model_id = ${filter.modelId ?? null}::uuid)
         AND (${filter.locationId ?? null}::uuid IS NULL OR p.location_id = ${filter.locationId ?? null}::uuid)
       ORDER BY md.name, k.model_id, k.size_label NULLS FIRST, k.code, l.name, l.id`.execute(this.db);
    const skus = await this.db
      .selectFrom('skus as k')
      .innerJoin('models as m', 'm.id', 'k.model_id')
      .select(['k.id', 'k.code', 'k.model_id', 'm.name', 'k.size_label'])
      .orderBy('m.name')
      .orderBy('k.model_id')
      .orderBy(sql`k.size_label NULLS FIRST`)
      .orderBy('k.code')
      .execute();
    const locations = await this.db.selectFrom('stock_locations').select(['id', 'name', 'is_default']).orderBy('is_default', 'desc').orderBy('name').execute();
    return {
      rows: rows.rows.map((r) => {
        const onHand = Number(r.on_hand);
        const reserved = Number(r.reserved);
        const toMake = Number(r.to_make);
        const minimum = r.minimum === null ? null : Number(r.minimum);
        return {
          sku: { id: r.sku_id, code: r.code, model: { id: r.model_id, name: r.model }, sizeLabel: r.size_label },
          location: { id: r.location_id, name: r.location },
          onHand,
          reserved,
          available: onHand - reserved,
          toMake,
          minimum,
          suggestion: suggestedPieces(minimum, onHand - reserved, toMake),
        };
      }),
      skus: skus.map((k) => ({ id: k.id, code: k.code, model: { id: k.model_id, name: k.name }, sizeLabel: k.size_label })),
      locations: locations.map((l) => ({ id: l.id, name: l.name, isDefault: l.is_default })),
    };
  }

  /** A SKU's minimum at a location (1 to THRESHOLD_MAX), or none (`null`). Audited `stock.threshold`. */
  async setThreshold(input: { skuId: string; locationId: string; minimum: number | null }, actor: Actor): Promise<void> {
    assertStaff(actor);
    const skuId = await this.knownSku(input?.skuId);
    const locationId = await knownLocation(this.db, input?.locationId);
    const minimum = input.minimum;
    if (minimum !== null && (!Number.isInteger(minimum) || minimum < 1 || minimum > THRESHOLD_MAX)) throw validationError(`A minimum is 1 to ${THRESHOLD_MAX} pieces.`);
    await inTransaction(this.db, async (tx) => {
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

  /**
   * Pieces to make for the stock (L2: a suggestion confirmed, its count adjustable, 1 to ATELIER_MAKE_MAX): each for the
   * SKU at the location, its ORBES identity reserved at once (L6). Audited and journaled `bench.create`, each.
   */
  async makeForStock(input: { skuId: string; locationId: string; quantity: number }, actor: Actor): Promise<BenchItemView[]> {
    assertStaff(actor);
    const skuId = await this.knownSku(input?.skuId);
    const locationId = await knownLocation(this.db, input?.locationId);
    const quantity = input.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ATELIER_MAKE_MAX) throw validationError(`Make 1 to ${ATELIER_MAKE_MAX} pieces at a time.`);
    const ids = await inTransaction(this.db, async (tx) => {
      await lockSku(tx, skuId);
      const now = this.clock();
      const sku = await tx.selectFrom('skus').select(['model_id', 'size_label']).where('id', '=', skuId).executeTakeFirstOrThrow();
      const created: string[] = [];
      const notes: AuditRecordInput[] = [];
      for (let i = 0; i < quantity; i++) {
        const identity = await reserveIdentity(tx, { modelId: sku.model_id, skuId, sizeLabel: sku.size_label }, now);
        const bench = await tx
          .insertInto('bench_items')
          .values({ sku_id: skuId, location_id: locationId, product_id: identity.id, created_at: now })
          .returningAll()
          .executeTakeFirstOrThrow();
        await writeJournal(tx, [{ type: 'bench.create', entityType: 'bench_item', entityId: bench.id, payload: benchPayload(bench) }], now);
        notes.push({ actor, action: 'bench.create', targetType: 'bench_item', targetId: bench.id, details: { orderId: null, skuId, locationId, dropId: null, productId: identity.productId } });
        created.push(bench.id);
      }
      for (const n of notes) await this.audit.record(n, tx);
      return created;
    });
    return (await this.rows({ ids })).map(benchView);
  }

  // ── Pieces to make ───────────────────────────────────────────────────────

  /** The pieces to make per release (the latest first, then the stock), model and size; the open ones by default. */
  async bench(filter: BenchFilter = {}): Promise<BenchList> {
    const rows = await this.rows(filter);
    const total = rows.length;
    const groups: BenchGroup[] = [];
    const byKey = new Map<string, BenchGroup>();
    for (const r of rows.slice(0, BENCH_LIST_MAX)) {
      const origin = originOf(r);
      const key = `${origin.kind === 'RELEASE' ? origin.release.id : origin.kind}:${r.sku_id}`;
      let g = byKey.get(key);
      if (!g) {
        g = { origin, sku: skuOf(r), counts: EMPTY_COUNTS(), items: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.counts[r.status] += 1;
      g.items.push(benchView(r));
    }
    const releases = await this.db
      .selectFrom('drops as d')
      .select(['d.id', 'd.title'])
      .where((eb) => eb.exists(eb.selectFrom('bench_items as b').select('b.id').whereRef('b.drop_id', '=', 'd.id')))
      .orderBy('d.opens_at', 'desc')
      .orderBy('d.id')
      .execute();
    return { groups, total, releases };
  }

  /** What to make, as a CSV (the filters of `bench`, the open pieces by default): one line per piece. */
  async benchCsv(filter: BenchFilter = {}): Promise<{ filename: string; contentType: string; body: string }> {
    const rows = await this.rows(filter);
    const iso = (d: Date | null) => (d ? d.toISOString() : '');
    const body = csvDocument([
      ['for', 'model', 'size', 'sku', 'location', 'piece', 'status', 'order', 'channel', 'add-ons', 'engraving', 'surprise', 'created at', 'started at', 'done at'],
      ...rows.map((r) => [
        r.release_title ?? (r.order_id ? 'PRIVATE SALON' : 'FOR STOCK'),
        r.model_name,
        r.size_label ?? '',
        r.sku_code,
        r.location_name,
        r.piece_reference,
        r.status,
        r.order_id ? orderReference(r.order_id) : '',
        r.order_channel ?? '',
        (r.order_addons ?? []).map((a) => a.label).join('; '),
        r.engraving_text ?? '',
        r.surprise ?? '',
        iso(r.created_at),
        iso(r.started_at),
        iso(r.done_at),
      ]),
    ]);
    return { filename: `ORBES-atelier-${this.clock().toISOString().slice(0, 10)}.csv`, contentType: CSV_CONTENT_TYPE, body };
  }

  /** TO_MAKE → IN_PROGRESS. Audited and journaled `bench.start`. */
  async start(benchItemId: string, actor: Actor): Promise<BenchItemView> {
    assertStaff(actor);
    const id = knownBench(benchItemId);
    await inTransaction(this.db, async (tx) => {
      const b = await tx.selectFrom('bench_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!b) throw benchNotFound();
      if (!BENCH_TRANSITIONS[b.status].includes('IN_PROGRESS')) throw stepNotAllowed(b.status, 'IN_PROGRESS');
      const now = this.clock();
      const started = await tx.updateTable('bench_items').set({ status: 'IN_PROGRESS', started_at: now }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await writeJournal(tx, [{ type: 'bench.start', entityType: 'bench_item', entityId: id, payload: benchPayload(started) }], now);
      await this.audit.record({ actor, action: 'bench.start', targetType: 'bench_item', targetId: id, details: { orderId: b.order_id, skuId: b.sku_id } }, tx);
    });
    return this.view(id);
  }

  /**
   * A piece to make for the stock cancelled (TO_MAKE or IN_PROGRESS): its reserved identity retired, its serial never
   * reused, the code of its sheet revoked. A piece made for an order goes with the order (409 BENCH_FOR_ORDER).
   * Audited and journaled `bench.cancel`.
   */
  async cancel(benchItemId: string, actor: Actor): Promise<BenchItemView> {
    assertStaff(actor);
    const id = knownBench(benchItemId);
    const peek = await this.db.selectFrom('bench_items').select(['sku_id', 'order_id']).where('id', '=', id).executeTakeFirst();
    if (!peek) throw benchNotFound();
    if (peek.order_id !== null) throw forOrder();
    await inTransaction(this.db, async (tx) => {
      await lockSku(tx, peek.sku_id);
      const b = await tx.selectFrom('bench_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (b.order_id !== null) throw forOrder();
      if (!BENCH_TRANSITIONS[b.status].includes('CANCELLED')) throw stepNotAllowed(b.status, 'CANCELLED');
      const now = this.clock();
      const cancelled = await tx.updateTable('bench_items').set({ status: 'CANCELLED', cancelled_at: now }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await writeJournal(tx, [{ type: 'bench.cancel', entityType: 'bench_item', entityId: id, payload: benchPayload(cancelled) }], now);
      const retired = await retireReservedIdentity(tx, b.product_id, 'Reserved identity retired: its piece to make was cancelled', actor, now);
      await this.audit.record({ actor, action: 'bench.cancel', targetType: 'bench_item', targetId: id, details: { orderId: null, skuId: b.sku_id, productId: b.product_id, retired } }, tx);
    });
    return this.view(id);
  }

  /**
   * IN_PROGRESS → DONE: the piece issued (see the header), linked to its order or entered in stock. The material is the
   * reserved identity's unless given (required while it is still to be confirmed); a claim code by default, shown once.
   * Audited `product.issue`, `bench.done` and, for an order, `order.link`.
   */
  async done(benchItemId: string, input: IssueBenchInput, actor: Actor): Promise<IssuedBenchItem> {
    assertStaff(actor);
    const id = knownBench(benchItemId);
    const material = cleanText(input?.material, ISSUE_TEXT_LIMITS.material, 'The material');
    const productionBatch = cleanText(input?.productionBatch, ISSUE_TEXT_LIMITS.productionBatch, 'The production batch');
    const productionDate = input?.productionDate === null || input?.productionDate === undefined || input.productionDate === '' ? null : String(input.productionDate);
    if (productionDate !== null) {
      const d = new Date(`${productionDate}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== productionDate) throw validationError('The production date is YYYY-MM-DD.');
      if (productionDate > new Date(this.clock().getTime() + 86_400_000).toISOString().slice(0, 10)) throw validationError('The production date cannot be in the future.');
    }
    const withClaim = input?.withClaimSecret ?? true;
    if (typeof withClaim !== 'boolean') throw validationError('A claim code is issued or not.');
    const peek = await this.db.selectFrom('bench_items').select(['order_id', 'sku_id', 'status']).where('id', '=', id).executeTakeFirst();
    if (!peek) throw benchNotFound();
    if (peek.status !== 'IN_PROGRESS') throw stepNotAllowed(peek.status, 'DONE');
    // scrypt on the thread pool, outside the transaction (as an issue).
    const claimCode = withClaim ? generateClaimCode() : undefined;
    const claimHash = claimCode ? await hashClaimCode(claimCode) : null;

    const issued = await this.issuance.inSigningTransaction(async (tx, signFirst) => {
      const now = this.clock();
      const notes: AuditRecordInput[] = [];
      const order = peek.order_id ? await tx.selectFrom('orders').selectAll().where('id', '=', peek.order_id).forUpdate().executeTakeFirstOrThrow() : null;
      await lockSku(tx, peek.sku_id);
      const b = await tx.selectFrom('bench_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (b.status !== 'IN_PROGRESS') throw stepNotAllowed(b.status, 'DONE');
      if (order && (!ORDER_HOLDING_STATUSES.includes(order.status) || order.reservation !== 'BENCH')) throw conflict('ORDER_CLOSED', 'This order no longer waits for this piece.');
      const p = await tx.selectFrom('products').selectAll().where('id', '=', b.product_id).forUpdate().executeTakeFirstOrThrow();
      const finalMaterial = material ?? p.material;
      if (finalMaterial === RESERVED_MATERIAL_PENDING) throw validationError('Confirm the material of the piece.');
      const existing = await tx.selectFrom('codes').selectAll().where('product_id', '=', p.id).where('status', '=', 'ACTIVE').executeTakeFirst();
      const code = existing ? { id: existing.id, issue: existing.issue, keyId: existing.key_id } : await signFirst(p, now);
      const product = await confirmReservedIdentity(tx, p, { material: finalMaterial, productionBatch, productionDate, claimHash }, actor, now);
      const doneRow = await tx.updateTable('bench_items').set({ status: 'DONE', done_at: now }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await writeJournal(tx, [{ type: 'bench.done', entityType: 'bench_item', entityId: id, payload: benchPayload(doneRow) }], now);
      await recordMovement(tx, { skuId: b.sku_id, locationId: b.location_id, delta: 1, reason: 'PRODUCED', orderId: b.order_id, productId: p.id }, actor, now);
      notes.push(
        {
          actor,
          action: 'product.issue',
          targetType: 'product',
          targetId: product.product_id,
          details: {
            productId: product.product_id,
            packedIdentity: Number(product.packed_identity),
            year: product.year,
            serial: product.serial,
            modelId: product.model_id,
            sku: product.sku,
            claimSecret: claimHash !== null,
            codeId: code.id,
            issue: code.issue,
            keyId: code.keyId,
            reserved: true,
            benchItemId: id,
            orderId: b.order_id,
          },
        },
        { actor, action: 'bench.done', targetType: 'bench_item', targetId: id, details: { orderId: b.order_id, skuId: b.sku_id, locationId: b.location_id, productId: product.product_id } },
      );
      if (order) notes.push((await attachPiece(tx, order, p.id, 'bench', actor, now)).note);
      for (const n of notes) await this.audit.record(n, tx);
      return { productId: product.product_id, codeId: code.id };
    });
    return { item: await this.view(id), ...issued, ...(claimCode ? { claimCode } : {}) };
  }

  /**
   * The work sheets of open pieces to make: those named (`benchItemIds`), or those the filters keep; at most
   * WORK_SHEETS_MAX. The code of each identity without one is signed now (IssuanceService.signReserved). Audited
   * `bench.sheet`. The answer carries each code's data: the routes give it to an OPERATOR only.
   */
  async sheets(input: { benchItemIds?: string[]; origin?: string; skuId?: string; locationId?: string }, actor: Actor): Promise<WorkSheet[]> {
    assertStaff(actor);
    const named = input?.benchItemIds;
    if (named !== undefined && (!Array.isArray(named) || named.length < 1 || named.length > WORK_SHEETS_MAX)) throw validationError(`Print 1 to ${WORK_SHEETS_MAX} sheets at a time.`);
    const ids = named ? [...new Set(named.map(knownBench))] : undefined;
    const rows = (await this.rows({ view: 'OPEN', ...(ids ? { ids } : { origin: input?.origin, skuId: input?.skuId, locationId: input?.locationId }) })).filter((r) => BENCH_OPEN.includes(r.status));
    if (rows.length > WORK_SHEETS_MAX) throw validationError(`Print at most ${WORK_SHEETS_MAX} sheets at a time: narrow the selection.`);
    if (ids && rows.length !== ids.length) throw conflict('BENCH_NOT_OPEN', 'Only a piece being made has a work sheet.');
    const sheets: WorkSheet[] = [];
    let signed = 0;
    for (const r of rows) {
      const s = await this.issuance.signReserved(r.product_id, actor);
      if (s.signed) signed += 1;
      const code = await this.issuance.printableCode(s.codeId);
      sheets.push({
        benchItemId: r.id,
        status: r.status,
        reference: r.piece_reference,
        code: { codeId: code.codeId, data: code.data, glyphs: code.glyphs },
        model: r.model_name,
        sizeLabel: r.size_label,
        skuCode: r.sku_code,
        addons: (r.order_addons ?? []).map((a) => a.label),
        engravingText: r.engraving_text,
        surprise: r.surprise,
        release: r.release_title,
        order: r.order_id && r.order_channel ? { reference: orderReference(r.order_id), channel: r.order_channel } : null,
        location: r.location_name,
        createdAt: r.created_at,
      });
    }
    if (sheets.length > 0) {
      await this.audit.record({
        actor,
        action: 'bench.sheet',
        targetType: 'bench_item',
        targetId: null,
        details: { benchItemIds: sheets.map((x) => x.benchItemId), productIds: sheets.map((x) => x.reference), signed },
      });
    }
    return sheets;
  }

  /**
   * The piece that fulfils an order, picked from the stock (Interconnection): a piece of the order's SKU issued and
   * never sold, or back in stock from a return (STOCK_PIECE_STATUSES), not registered, linked to no other open order.
   * The order then holds that piece. An order holding one in stock takes it as it is. An order holding a piece to make
   * (TO_MAKE or IN_PROGRESS) takes it instead (choice 8: a piece made in advance counts): one piece available at the
   * order's location is taken for it; with none available there, a piece that never entered the ledger (issued in the
   * Generator) is counted in with the order (PRODUCED, +1), and one already counted elsewhere answers 409
   * STOCK_NOT_AVAILABLE (transfer it first). Its piece to make is then cancelled and its reserved identity retired (the
   * code of its work sheet revoked). Audited `order.link` (and `bench.cancel`; the movement journaled `stock.move`).
   */
  async linkFromStock(orderId: string, productRef: string, actor: Actor): Promise<OrderView> {
    assertStaff(actor);
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw notFound('Order', 'ORDER_NOT_FOUND');
    if (typeof productRef !== 'string' || !(PIECE_REF_RE.test(productRef.trim()) || UUID_RE.test(productRef.trim()))) throw notFound('Product', 'PRODUCT_NOT_FOUND');
    const ref = productRef.trim();
    const id = orderId.toLowerCase();
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!o) throw notFound('Order', 'ORDER_NOT_FOUND');
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw conflict('ORDER_CLOSED', 'This order can no longer change.');
      if (o.product_id !== null) throw conflict('ORDER_PIECE_LINKED', 'A piece is already linked to this order.');
      if (o.reservation !== 'STOCK' && o.reservation !== 'BENCH') throw conflict('ORDER_NOT_READY', 'The piece is not in stock at the order’s location yet.');
      await lockSku(tx, o.sku_id!);
      // Its piece to make, while it is made: a piece made for it once finished is linked by `done`, not here.
      const bench =
        o.reservation === 'BENCH'
          ? await tx.selectFrom('bench_items').select(['id', 'status']).where('order_id', '=', o.id).where('status', 'in', [...BENCH_OPEN]).forUpdate().executeTakeFirst()
          : null;
      if (o.reservation === 'BENCH' && !bench) throw conflict('ORDER_PIECE_TO_MAKE', 'Its piece is being made: the atelier links it when it is finished.');
      const p = await tx
        .selectFrom('products')
        .selectAll()
        .where(UUID_RE.test(ref) ? 'id' : 'product_id', '=', UUID_RE.test(ref) ? ref.toLowerCase() : ref.toUpperCase())
        .forUpdate()
        .executeTakeFirst();
      if (!p) throw notFound('Product', 'PRODUCT_NOT_FOUND');
      if (p.sku_id !== o.sku_id) throw conflict('PIECE_OTHER_SKU', `${p.product_id} is not of this order’s model and size.`);
      // Issued and never sold (ISSUED), or back in stock from a return (RESOLD: its buyer's ownership taken back).
      const owned = await tx.selectFrom('ownership').select('id').where('product_id', '=', p.id).where('ended_at', 'is', null).executeTakeFirst();
      if (!STOCK_PIECE_STATUSES.includes(p.status) || p.ownership_state !== 'UNREGISTERED' || owned) {
        throw conflict('PIECE_NOT_IN_STOCK', `${p.product_id} is not a piece in stock: it must be issued, or back from a return, and not registered.`);
      }
      const taken = await tx.selectFrom('orders').select('id').where('product_id', '=', p.id).where('status', 'in', ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED']).executeTakeFirst();
      if (taken) throw conflict('PIECE_TAKEN', `${p.product_id} fulfils another order.`);
      const notes: AuditRecordInput[] = [];
      if (bench) {
        const level = await stockLevel(tx, o.sku_id!, o.location_id);
        const counted = await tx.selectFrom('stock_movements').select('id').where('product_id', '=', p.id).executeTakeFirst();
        if (level.available < 1 && counted) {
          throw conflict('STOCK_NOT_AVAILABLE', `${p.product_id} is counted in the stock, but no piece of this size is available at the order’s location: transfer it there first.`);
        }
        await release(tx, o, 'Reserved identity retired: its order took a finished piece from the stock', actor, now, notes);
        if (level.available < 1) {
          await recordMovement(
            tx,
            { skuId: o.sku_id!, locationId: o.location_id, delta: 1, reason: 'PRODUCED', orderId: o.id, productId: p.id, note: 'A finished piece never counted in the stock, counted in with the order it fulfils.' },
            actor,
            now,
          );
        }
      }
      notes.push((await attachPiece(tx, o, p.id, 'stock', actor, now)).note);
      for (const n of notes) await this.audit.record(n, tx);
    });
    return this.orders.get(id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async knownSku(skuId: unknown): Promise<string> {
    if (typeof skuId !== 'string' || !UUID_RE.test(skuId)) throw skuNotFound();
    const row = await this.db.selectFrom('skus').select('id').where('id', '=', skuId.toLowerCase()).executeTakeFirst();
    if (!row) throw skuNotFound();
    return row.id;
  }

  private async view(id: string): Promise<BenchItemView> {
    const [r] = await this.rows({ ids: [id], view: 'ALL' });
    if (!r) throw benchNotFound();
    return benchView(r);
  }

  /**
   * The pieces to make the filters keep: by release (the latest first; the private salon's and the stock's last), model,
   * size, then the oldest.
   */
  private async rows(filter: BenchFilter & { ids?: string[] }): Promise<BenchRow[]> {
    const view = filter.view ?? 'OPEN';
    let q = this.db
      .selectFrom('bench_items as b')
      .innerJoin('products as p', 'p.id', 'b.product_id')
      .innerJoin('skus as k', 'k.id', 'b.sku_id')
      .innerJoin('models as m', 'm.id', 'k.model_id')
      .innerJoin('stock_locations as l', 'l.id', 'b.location_id')
      .leftJoin('drops as d', 'd.id', 'b.drop_id')
      .leftJoin('orders as o', 'o.id', 'b.order_id')
      .selectAll('b')
      .select([
        'p.product_id as piece_reference', 'p.status as piece_status', 'p.material', 'k.code as sku_code', 'k.size_label', 'k.model_id', 'm.name as model_name',
        'l.name as location_name', 'd.title as release_title', 'o.status as order_status', 'o.channel as order_channel', 'o.addons as order_addons',
      ])
      .select(sql<boolean>`EXISTS (SELECT 1 FROM codes c WHERE c.product_id = b.product_id)`.as('signed'));
    if (filter.ids) q = q.where('b.id', 'in', filter.ids.length ? filter.ids : ['00000000-0000-0000-0000-000000000000']);
    if (view === 'OPEN') q = q.where('b.status', 'in', [...BENCH_OPEN]);
    else if (view !== 'ALL') q = q.where('b.status', '=', view);
    if (filter.origin === 'STOCK') q = q.where('b.order_id', 'is', null);
    else if (filter.origin === 'SALON') q = q.where('b.order_id', 'is not', null).where('b.drop_id', 'is', null);
    else if (filter.origin) {
      if (!UUID_RE.test(filter.origin)) throw notFound('Release', 'DROP_NOT_FOUND');
      q = q.where('b.drop_id', '=', filter.origin.toLowerCase());
    }
    if (filter.skuId) q = q.where('b.sku_id', '=', filter.skuId);
    if (filter.locationId) q = q.where('b.location_id', '=', filter.locationId);
    const rows = await q
      .orderBy(sql`d.opens_at DESC NULLS LAST`)
      .orderBy('b.drop_id')
      .orderBy(sql`b.order_id IS NULL`)
      .orderBy('m.name')
      .orderBy('k.model_id')
      .orderBy(sql`k.size_label NULLS FIRST`)
      .orderBy('b.sku_id')
      .orderBy('b.created_at')
      .orderBy('p.serial')
      .orderBy('b.id')
      .execute();
    return rows as BenchRow[];
  }
}

const originOf = (r: BenchRow): BenchOrigin =>
  r.drop_id && r.release_title ? { kind: 'RELEASE', release: { id: r.drop_id, title: r.release_title } } : r.order_id ? { kind: 'SALON' } : { kind: 'STOCK' };

const skuOf = (r: BenchRow): SkuView => ({ id: r.sku_id, code: r.sku_code, model: { id: r.model_id, name: r.model_name }, sizeLabel: r.size_label });

function benchView(r: BenchRow): BenchItemView {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    startedAt: r.started_at,
    doneAt: r.done_at,
    cancelledAt: r.cancelled_at,
    piece: { id: r.product_id, reference: r.piece_reference, status: r.piece_status, material: r.material, signed: Boolean(r.signed) },
    order: r.order_id && r.order_status && r.order_channel ? { id: r.order_id, reference: orderReference(r.order_id), status: r.order_status, channel: r.order_channel } : null,
    origin: originOf(r),
    sku: skuOf(r),
    location: { id: r.location_id, name: r.location_name },
    engravingText: r.engraving_text,
    surprise: r.surprise,
    addons: (r.order_addons ?? []).map((a) => a.label),
  };
}
