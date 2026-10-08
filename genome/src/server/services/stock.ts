/**
 * The stock (plan LIVE RELEASE+ of 2026-10-04, choices 8, 9 and 16; migration 0022): the pieces counted at each
 * location; an order without a piece available waits for supplier stock (services/orders.ts, plan NEXT LOT §3.5).
 *
 *   locations  FRANCE WAREHOUSE (the default: draws and the private salon's orders go there when nothing else names a
 *              location) and LOGISTICS WAREHOUSE, created at the first boot (`ensureStockSetup`, idempotent: only while
 *              no location exists, so a location renamed is never created again); the carriers' presets likewise
 *              (Colissimo, Chronopost, DHL Express, UPS, each with its tracking link).
 *   SKUs       a model in one size (`ensureSku`): the size a release sells, or a piece's variant; its code is the
 *              model's SKU prefix and the size (`deriveSku`), as a piece's SKU by default. The pieces and the sizes on
 *              sale are linked to theirs when written (issuance, the console's sizes), and those written before, or by
 *              the previous image, at boot (`linkSkus`). Since plan NEXT LOT §3.3 a model's sizes are declared in the
 *              Catalogue (services/sizes.ts): every flow names a size through `offeredSku`, so `ensureSku` is reached
 *              only through it for a model with no size type, through a declaration, or at boot.
 *   the ledger every movement of a SKU at a location (stock_movements), never changed: a piece finished (+1), a count
 *              corrected (± `adjust`), a transfer between locations (`transfer`: two movements, out and in, paired by
 *              their transfer id), an order shipped (−1) or returned (+1).
 *   balances   per SKU and location, derived from the ledger: on hand (the sum of its movements), reserved (the orders
 *              holding one of them, `orders.reservation` STOCK), available (on hand less reserved). An adjustment or a
 *              transfer never takes a reserved piece: on hand never falls below what is reserved.
 *
 * The console's settings (Locations and carriers): a location added or renamed, made the default; a carrier added, its
 * name or tracking link changed, set aside (`active` false: never offered for a shipment again, the orders shipped with
 * it keep it). Audited `stock.location.create`, `stock.location.update`, `carrier.create`, `carrier.update`.
 *
 * Every change of a SKU's stock or of its reservations takes the SKU's row FOR NO KEY UPDATE first (`lockSku`), after
 * the rows of the order or the release it serves: two orders never take the same last piece, and a transfer never moves
 * a piece an order has just reserved. Each movement is journaled (`stock.move`, services/journal.ts) in its transaction; the
 * console's are audited (`stock.transfer`, `stock.adjust`, ids and counts only), as are the first boot's presets
 * (`stock.setup`). A count corrected up and a transfer in serve the orders waiting for that size there, the oldest
 * first (services/orders.ts serveWaiting), in the same transaction.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { JsonObject, StockMovementReason } from '../db/schema.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { writeJournal } from './journal.js';
import { serveWaiting } from './orders.js';
import { offeredSku } from './sizes.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The locations of the first boot, in this order; FRANCE WAREHOUSE is the default. */
export const STOCK_LOCATION_PRESETS = Object.freeze([
  Object.freeze({ name: 'FRANCE WAREHOUSE', isDefault: true }),
  Object.freeze({ name: 'LOGISTICS WAREHOUSE', isDefault: false }),
]);

/** The carriers of the first boot (M1), each with its tracking link: `{tracking}` is where the number goes. */
export const CARRIER_PRESETS = Object.freeze([
  Object.freeze({ name: 'Colissimo', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code={tracking}' }),
  Object.freeze({ name: 'Chronopost', trackingUrl: 'https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT={tracking}' }),
  Object.freeze({ name: 'DHL Express', trackingUrl: 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id={tracking}' }),
  Object.freeze({ name: 'UPS', trackingUrl: 'https://www.ups.com/track?loc=en_US&tracknum={tracking}' }),
]);

/** A count moved at once (stock_movements.delta). */
export const STOCK_MOVE_MAX = 10_000;
/** A note on a movement, at most (stock_movements.note). */
export const STOCK_NOTE_MAX = 500;
/** A location's name and a carrier's, at most (stock_locations.name, carriers.name). */
export const LOCATION_NAME_MAX = 60;
/** A location's postal address, at most (stock_locations.address, migration 0035). */
export const LOCATION_ADDRESS_MAX = 500;
export const CARRIER_NAME_MAX = 60;
/** A carrier's tracking link, at most (carriers.tracking_url): https, `{tracking}` where the number goes. */
export const TRACKING_URL_MAX = 500;
/** Where the tracking number goes in a carrier's link. */
export const TRACKING_PLACEHOLDER = '{tracking}';
/** A size label a SKU keeps, at most (skus.size_label). */
const SIZE_LABEL_MAX = 100;
const SKU_CODE_MAX = 64;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** SKU when none is given: the model's prefix plus the variant, e.g. MNL-RG-52. */
export function deriveSku(skuPrefix: string, variant: string | undefined): string {
  const prefix = skuPrefix.trim().toUpperCase();
  if (!variant) return prefix.slice(0, SKU_CODE_MAX);
  const slug = variant
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return (slug ? `${prefix}-${slug}` : prefix).slice(0, SKU_CODE_MAX);
}

/** What the house calls a model in one size: a release's size « ONE SIZE » is the SKU of the pieces without a variant. */
export const ONE_SIZE_LABEL = 'ONE SIZE';

/**
 * The size label of a SKU for a piece's variant or a release's size: trimmed, at most 100 characters; '' and « ONE SIZE »
 * (whatever the case) are one size (null), so a one-size release sells the very SKU of the pieces issued without a
 * variant, and the stock of one is the stock of the other (the feasibility check and the size mix, services/live-console.ts).
 */
export function sizeLabelOf(label: string | null | undefined): string | null {
  const t = typeof label === 'string' ? label.trim().slice(0, SIZE_LABEL_MAX).trim() : '';
  return t === '' || t.toUpperCase() === ONE_SIZE_LABEL ? null : t;
}

/** Sizes in the order a client reads them: ONE SIZE (null) first, then naturally (48, 50, 52; S, M, L as written). */
export function compareSizes(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || a.localeCompare(b);
}

/**
 * The sizes of models from their SKUs (plan NOCTURNE, addition 8: SIZES 16 · 17 · 18), by model id: each size label once
 * whatever its case (the first written kept), in compareSizes' order; a SKU in one size (null) names no size. A model
 * without a SKU has none. Its offered sizes only (plan NEXT LOT §3.3): a size set aside is no longer shown as available.
 */
export async function skuSizes(db: Db, modelIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (modelIds.length === 0) return out;
  const rows = await db.selectFrom('skus').select(['model_id', 'size_label']).where('model_id', 'in', [...modelIds]).where('set_aside_at', 'is', null).orderBy('created_at').orderBy('id').execute();
  for (const r of rows) if (r.size_label !== null) out.set(r.model_id, [...(out.get(r.model_id) ?? []), r.size_label]);
  for (const [id, sizes] of out) out.set(id, sizesOnce(sizes));
  return out;
}

/** Size labels once each whatever their case (the first kept), in compareSizes' order: the sizes of a model and its variants together. */
export function sizesOnce(sizes: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const s of sizes) if (!seen.has(s.toUpperCase())) seen.set(s.toUpperCase(), s);
  return [...seen.values()].sort(compareSizes);
}

/** sizeLabelOf in SQL, over a column of text (a piece's variant). */
const sizeLabelSql = (column: string) =>
  sql<string | null>`(CASE WHEN upper(btrim(left(btrim(${sql.ref(column)}), ${SIZE_LABEL_MAX}))) = ${ONE_SIZE_LABEL} THEN NULL ELSE nullif(btrim(left(btrim(${sql.ref(column)}), ${SIZE_LABEL_MAX})), '') END)`;

// ── Errors ─────────────────────────────────────────────────────────────────

export const stockNotReady = () => new DomainError('STOCK_NOT_READY', 503, 'The stock locations are not set up yet.', { detail: 'no default stock location: ensureStockSetup has not run' });
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');
const locationNotFound = () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND');
const locationTaken = () => conflict('STOCK_LOCATION_NAME_TAKEN', 'Another location has this name.');
const carrierTaken = () => conflict('CARRIER_NAME_TAKEN', 'Another carrier has this name.');
export const notAvailable = (available: number) =>
  conflict('STOCK_NOT_AVAILABLE', available === 1 ? 'Only 1 piece is available there: the others are reserved by orders.' : `Only ${available} pieces are available there: the others are reserved by orders.`);

/** A location as the console reads it. */
export interface StockLocationView {
  id: string;
  name: string;
  /** Where draws and the private salon's orders go when nothing else names a location. */
  isDefault: boolean;
  shopifyLocationId: string | null;
  /**
   * Its postal address (plan NEXT LOT §3.5, migration 0035): the « Deliver to » of a supplier order's PDF and a return's
   * address; null while none is entered.
   */
  address: string | null;
}

/** A carrier as the console reads it. */
export interface CarrierView {
  id: string;
  name: string;
  /** https, with `{tracking}` where the number goes. */
  trackingUrl: string;
  active: boolean;
}

/** A name as the console types it: trimmed, one line, 1 to `max` characters. */
function cleanName(v: unknown, max: number, label: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError(`${label} is required.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

/**
 * A carrier's tracking link as the console types it (M1, editable): https, no space, at most TRACKING_URL_MAX
 * characters, `{tracking}` exactly once, and a valid address once a number takes its place.
 */
export function checkTrackingUrl(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError('The tracking link is required.');
  const s = v.trim();
  if (s.length > TRACKING_URL_MAX) throw validationError(`A tracking link has at most ${TRACKING_URL_MAX} characters.`);
  if (!/^https:\/\/[^\s]+$/.test(s)) throw validationError('A tracking link starts with https:// and holds no space.');
  if (s.split(TRACKING_PLACEHOLDER).length !== 2) throw validationError(`A tracking link holds ${TRACKING_PLACEHOLDER} once, where the number goes.`);
  try {
    const url = new URL(s.replace(TRACKING_PLACEHOLDER, '0'));
    if (url.protocol !== 'https:' || url.hostname === '') throw new Error('not https');
  } catch {
    throw validationError('The tracking link is not a valid address.');
  }
  return s;
}

const locationView = (r: { id: string; name: string; is_default: boolean; shopify_location_id: string | null; address: string | null }): StockLocationView => ({
  id: r.id,
  name: r.name,
  isDefault: r.is_default,
  shopifyLocationId: r.shopify_location_id,
  address: r.address,
});
const LOCATION_COLUMNS = ['id', 'name', 'is_default', 'shopify_location_id', 'address'] as const;

/** A location's postal address (plan NEXT LOT §3.5.6.9): 1 to LOCATION_ADDRESS_MAX characters, trimmed, line breaks kept; null (or blank) clears it. */
export function cleanLocationAddress(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') throw validationError('The address must be text.');
  const s = v
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
  if (CONTROL_CHARS.test(s.replace(/\n/g, ''))) throw validationError('The address contains invalid characters.');
  if (s.length > LOCATION_ADDRESS_MAX) throw validationError(`An address has at most ${LOCATION_ADDRESS_MAX} characters.`);
  return s;
}
const carrierView = (r: { id: string; name: string; tracking_url: string; active: boolean }): CarrierView => ({ id: r.id, name: r.name, trackingUrl: r.tracking_url, active: r.active });

// ── Setup ──────────────────────────────────────────────────────────────────

/**
 * The first boot's locations and carriers, each set only while its table is empty (a renamed or deactivated one is
 * never created again); two processes starting together create them once. Audited `stock.setup` when it created any.
 */
export async function ensureStockSetup(db: Db, audit: AuditService, actor: Actor, now: Date): Promise<{ locations: string[]; carriers: string[] }> {
  return inTransaction(db, async (tx) => {
    const locations = await sql<{ name: string }>`
      INSERT INTO stock_locations (name, is_default, created_at)
      SELECT v.name, v.is_default, ${now}::timestamptz FROM (VALUES ${sql.join(STOCK_LOCATION_PRESETS.map((l) => sql`(${l.name}::text, ${l.isDefault}::boolean)`))}) AS v (name, is_default)
      WHERE NOT EXISTS (SELECT 1 FROM stock_locations)
      ON CONFLICT DO NOTHING RETURNING name`.execute(tx);
    const carriers = await sql<{ name: string }>`
      INSERT INTO carriers (name, tracking_url, created_at)
      SELECT v.name, v.tracking_url, ${now}::timestamptz FROM (VALUES ${sql.join(CARRIER_PRESETS.map((c) => sql`(${c.name}::text, ${c.trackingUrl}::text)`))}) AS v (name, tracking_url)
      WHERE NOT EXISTS (SELECT 1 FROM carriers)
      ON CONFLICT DO NOTHING RETURNING name`.execute(tx);
    const created = { locations: locations.rows.map((r) => r.name), carriers: carriers.rows.map((r) => r.name) };
    if (created.locations.length + created.carriers.length > 0) {
      await audit.record({ actor, action: 'stock.setup', targetType: 'stock', targetId: null, details: created }, tx);
    }
    return created;
  });
}

/** The default location's id (draws and the private salon's orders without one); 503 STOCK_NOT_READY before the setup. */
export async function defaultLocationId(db: Db): Promise<string> {
  const row = await db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirst();
  if (!row) throw stockNotReady();
  return row.id;
}

/** A location's id, checked (404 STOCK_LOCATION_NOT_FOUND). */
export async function knownLocation(db: Db, locationId: string): Promise<string> {
  if (typeof locationId !== 'string' || !UUID_RE.test(locationId)) throw locationNotFound();
  const row = await db.selectFrom('stock_locations').select('id').where('id', '=', locationId.toLowerCase()).executeTakeFirst();
  if (!row) throw locationNotFound();
  return row.id;
}

// ── SKUs ───────────────────────────────────────────────────────────────────

/**
 * The SKU of a model in a size (null: one size), created when it does not exist yet; a size matches whatever its case
 * (`Small` finds the SKU created as `SMALL`, as skus_model_size_key holds one). Its code is `deriveSku` of the
 * model's prefix and the size; when another SKU has that code (two sizes whose labels read the same once simplified),
 * `-2`, `-3`… is added. Safe under concurrency: a SKU created meanwhile by another transaction is the one returned.
 */
export async function ensureSku(tx: Db, modelId: string, sizeLabel: string | null | undefined): Promise<string> {
  const label = sizeLabelOf(sizeLabel);
  const find = () =>
    tx
      .selectFrom('skus')
      .select('id')
      .where('model_id', '=', modelId)
      .where((eb) => (label === null ? eb('size_label', 'is', null) : eb(eb.fn('upper', ['size_label']), '=', eb.fn('upper', [eb.val(label)]))))
      .executeTakeFirst();
  const found = await find();
  if (found) return found.id;
  const model = await tx.selectFrom('models').select('sku_prefix').where('id', '=', modelId).executeTakeFirst();
  if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
  const base = deriveSku(model.sku_prefix, label ?? undefined).replace(/^[^A-Za-z0-9]+/, '') || 'SKU';
  for (let n = 1; n <= 50; n++) {
    const code = n === 1 ? base : `${base.slice(0, SKU_CODE_MAX - String(n).length - 1)}-${n}`;
    const inserted = await tx.insertInto('skus').values({ model_id: modelId, size_label: label, code }).onConflict((oc) => oc.doNothing()).returning('id').executeTakeFirst();
    if (inserted) return inserted.id;
    const again = await find();
    if (again) return again.id;
  }
  throw new Error(`no free SKU code for ${base}`);
}

/**
 * Link the pieces and the sizes on sale written without their SKU (before migration 0022, or by the previous image) to
 * it: one SKU per model and variant, per release's model and size. Idempotent; returns how many rows it linked.
 */
export async function linkSkus(db: Db): Promise<{ products: number; sizes: number }> {
  let products = 0;
  let sizes = 0;
  const pieces = await db
    .selectFrom('products')
    .select(['model_id', sizeLabelSql('variant').as('label')])
    .where('sku_id', 'is', null)
    .groupBy(['model_id', 'label'])
    .execute();
  for (const p of pieces) {
    products += await inTransaction(db, async (tx) => {
      const skuId = await ensureSku(tx, p.model_id, p.label);
      const r = await tx
        .updateTable('products')
        .set({ sku_id: skuId })
        .where('model_id', '=', p.model_id)
        .where('sku_id', 'is', null)
        .where(sql<boolean>`${sizeLabelSql('variant')} IS NOT DISTINCT FROM ${p.label}`)
        .executeTakeFirst();
      return Number(r.numUpdatedRows);
    });
  }
  const onSale = await db
    .selectFrom('drop_sizes as s')
    .innerJoin('drops as d', 'd.id', 's.drop_id')
    .select(['s.id', 'd.model_id', 's.label'])
    .where('s.sku_id', 'is', null)
    .execute();
  for (const s of onSale) {
    sizes += await inTransaction(db, async (tx) => {
      const skuId = await ensureSku(tx, s.model_id, s.label);
      const r = await tx.updateTable('drop_sizes').set({ sku_id: skuId }).where('id', '=', s.id).where('sku_id', 'is', null).executeTakeFirst();
      return Number(r.numUpdatedRows);
    });
  }
  return { products, sizes };
}

/**
 * Link every size of a release to its SKU (the release's model in that size): after its sizes or its model changed.
 * Through `offeredSku` (plan NEXT LOT §3.3): a model with no size type as before (its SKU created when missing); a typed
 * model's sizes must be its offered sizes (400 SIZE_NOT_DECLARED, 409 SIZE_SET_ASIDE), each label written again as the
 * declared one ('SIZE 52' is 52; a size of none 'ONE SIZE'). Two lines of one size ('52' and 'SIZE 52') are refused
 * before anything is written: 400 'The size 52 is listed twice.'
 */
export async function linkDropSizes(tx: Db, dropId: string, modelId: string): Promise<void> {
  const rows = await tx.selectFrom('drop_sizes').select(['id', 'label', 'sku_id']).where('drop_id', '=', dropId).orderBy('position').execute();
  const resolved: { id: string; label: string; sku_id: string | null; skuId: string; declared: string | null; typed: boolean }[] = [];
  for (const r of rows) {
    const s = await offeredSku(tx, modelId, r.label);
    resolved.push({ ...r, skuId: s.skuId, declared: s.label, typed: s.typed });
  }
  const seen = new Set<string>();
  for (const r of resolved) {
    if (seen.has(r.skuId)) throw validationError(`The size ${r.declared ?? ONE_SIZE_LABEL} is listed twice.`);
    seen.add(r.skuId);
  }
  for (const r of resolved) {
    const label = r.typed ? (r.declared ?? ONE_SIZE_LABEL) : r.label;
    if (r.sku_id !== r.skuId || label !== r.label) await tx.updateTable('drop_sizes').set({ sku_id: r.skuId, label }).where('id', '=', r.id).execute();
  }
}

// ── The ledger ─────────────────────────────────────────────────────────────

/**
 * A SKU's row FOR NO KEY UPDATE: every change of its stock or of its reservations takes it first (404 SKU_NOT_FOUND).
 * It serialises those changes but, unlike FOR UPDATE, does not conflict with the FOR KEY SHARE lock that a foreign-key
 * check on skus takes (an order, a piece, a bench item or a movement inserted with its SKU), so a transaction that
 * wrote such a row before taking the SKU waits for nobody holding that SKU's key share.
 */
export async function lockSku(tx: Db, skuId: string): Promise<void> {
  if (!tx.isTransaction) throw new Error('lockSku must run inside a transaction');
  const row = await tx.selectFrom('skus').select('id').where('id', '=', skuId).forNoKeyUpdate().executeTakeFirst();
  if (!row) throw skuNotFound();
}

export interface StockLevel {
  /** The sum of the ledger's movements. */
  onHand: number;
  /** The orders holding one of them (orders.reservation STOCK). */
  reserved: number;
  /** On hand less reserved. */
  available: number;
}

/** The stock of a SKU at a location (under lockSku when a decision depends on it). */
export async function stockLevel(db: Db, skuId: string, locationId: string): Promise<StockLevel> {
  const moved = await db
    .selectFrom('stock_movements')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('delta'), eb.lit(0)).as('n'))
    .where('sku_id', '=', skuId)
    .where('location_id', '=', locationId)
    .executeTakeFirstOrThrow();
  const held = await db
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('sku_id', '=', skuId)
    .where('location_id', '=', locationId)
    .where('reservation', '=', 'STOCK')
    .executeTakeFirstOrThrow();
  const onHand = Number(moved.n);
  const reserved = Number(held.n);
  return { onHand, reserved, available: onHand - reserved };
}

/** One row of the stock: a SKU at a location, with its model, size and location named. */
export interface StockBalance extends StockLevel {
  sku: { id: string; code: string; modelId: string; model: string; sizeLabel: string | null };
  location: { id: string; name: string };
}

/**
 * The stock per SKU and location, derived from the ledger and the orders' reservations: every pair that ever moved or
 * is reserved, by model, size and location; narrowed to a SKU, a model or a location.
 */
export async function stockBalances(db: Db, filter: { skuId?: string; modelId?: string; locationId?: string } = {}): Promise<StockBalance[]> {
  const rows = await sql<{
    sku_id: string;
    location_id: string;
    on_hand: number;
    reserved: number;
    code: string;
    model_id: string;
    model: string;
    size_label: string | null;
    location: string;
  }>`
    WITH moved AS (SELECT sku_id, location_id, sum(delta)::int AS on_hand FROM stock_movements GROUP BY sku_id, location_id),
         held AS (SELECT sku_id, location_id, count(*)::int AS reserved FROM orders WHERE reservation = 'STOCK' GROUP BY sku_id, location_id),
         pairs AS (SELECT coalesce(m.sku_id, h.sku_id) AS sku_id, coalesce(m.location_id, h.location_id) AS location_id,
                          coalesce(m.on_hand, 0) AS on_hand, coalesce(h.reserved, 0) AS reserved
                     FROM moved m FULL JOIN held h ON h.sku_id = m.sku_id AND h.location_id = m.location_id)
    SELECT p.sku_id, p.location_id, p.on_hand, p.reserved, k.code, k.model_id, md.name AS model, k.size_label, l.name AS location
      FROM pairs p
      JOIN skus k ON k.id = p.sku_id
      JOIN models md ON md.id = k.model_id
      JOIN stock_locations l ON l.id = p.location_id
     WHERE (${filter.skuId ?? null}::uuid IS NULL OR p.sku_id = ${filter.skuId ?? null}::uuid)
       AND (${filter.modelId ?? null}::uuid IS NULL OR k.model_id = ${filter.modelId ?? null}::uuid)
       AND (${filter.locationId ?? null}::uuid IS NULL OR p.location_id = ${filter.locationId ?? null}::uuid)
     ORDER BY md.name, k.model_id, k.size_label NULLS FIRST, k.code, l.name, l.id`.execute(db);
  return rows.rows.map((r) => ({
    sku: { id: r.sku_id, code: r.code, modelId: r.model_id, model: r.model, sizeLabel: r.size_label },
    location: { id: r.location_id, name: r.location },
    onHand: Number(r.on_hand),
    reserved: Number(r.reserved),
    available: Number(r.on_hand) - Number(r.reserved),
  }));
}

export interface MovementInput {
  skuId: string;
  locationId: string;
  delta: number;
  reason: StockMovementReason;
  orderId?: string | null;
  productId?: string | null;
  transferId?: string | null;
  /** RECEIVED only (migration 0036): the reception line whose pieces enter the stock. */
  receptionLineId?: string | null;
  note?: string | null;
}

/** A movement as the journal says it (`stock.move`): the ledger's row, its note aside. */
export function movementPayload(m: {
  id: number;
  sku_id: string;
  location_id: string;
  delta: number;
  reason: StockMovementReason;
  order_id: string | null;
  product_id: string | null;
  transfer_id: string | null;
  reception_line_id?: string | null;
  created_at: Date;
}): JsonObject {
  return {
    id: m.id,
    skuId: m.sku_id,
    locationId: m.location_id,
    delta: m.delta,
    reason: m.reason,
    orderId: m.order_id,
    productId: m.product_id,
    transferId: m.transfer_id,
    ...(m.reception_line_id ? { receptionLineId: m.reception_line_id } : {}),
    at: m.created_at.toISOString(),
  };
}

/** Append a movement to the ledger and journal it (`stock.move`), in the caller's transaction, under its lockSku. */
export async function recordMovement(tx: Db, m: MovementInput, actor: Actor, now: Date): Promise<number> {
  const row = await tx
    .insertInto('stock_movements')
    .values({
      sku_id: m.skuId,
      location_id: m.locationId,
      delta: m.delta,
      reason: m.reason,
      order_id: m.orderId ?? null,
      product_id: m.productId ?? null,
      transfer_id: m.transferId ?? null,
      reception_line_id: m.receptionLineId ?? null,
      note: m.note ?? null,
      actor_type: actor.type,
      actor_id: actor.id ?? null,
      created_at: now,
    })
    .returning(['id', 'sku_id', 'location_id', 'delta', 'reason', 'order_id', 'product_id', 'transfer_id', 'reception_line_id', 'created_at'])
    .executeTakeFirstOrThrow();
  const id = Number(row.id);
  await writeJournal(tx, [{ type: 'stock.move', entityType: 'stock_movement', entityId: String(id), payload: movementPayload({ ...row, id }) }], now);
  return id;
}

// ── Service (the console's movements) ──────────────────────────────────────

export interface StockServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

function cleanNote(v: unknown, required: boolean): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw validationError('Say in the note why the stock changes.');
    return null;
  }
  if (typeof v !== 'string') throw validationError('The note must be text.');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s.length > STOCK_NOTE_MAX || CONTROL_CHARS.test(s)) throw validationError(`A note has at most ${STOCK_NOTE_MAX} characters.`);
  return s;
}

function knownSku(skuId: unknown): string {
  if (typeof skuId !== 'string' || !UUID_RE.test(skuId)) throw skuNotFound();
  return skuId.toLowerCase();
}

export class StockService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: StockServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** The stock per SKU and location (stockBalances). */
  balances(filter: { skuId?: string; modelId?: string; locationId?: string } = {}): Promise<StockBalance[]> {
    return stockBalances(this.db, filter);
  }

  /**
   * Move `quantity` pieces (1 to STOCK_MOVE_MAX) of a SKU from one location to another: two movements, TRANSFER_OUT
   * and TRANSFER_IN, paired by one transfer id, in one transaction. Only available pieces move (409
   * STOCK_NOT_AVAILABLE): those reserved by orders stay where their orders are. The pieces moved in serve the orders
   * waiting for them there (`order.serve`). Audited `stock.transfer`.
   */
  async transfer(input: { skuId: string; fromLocationId: string; toLocationId: string; quantity: number; note?: string | null }, actor: Actor): Promise<{ transferId: string; from: StockLevel; to: StockLevel }> {
    const skuId = knownSku(input?.skuId);
    const quantity = input.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > STOCK_MOVE_MAX) throw validationError(`Move 1 to ${STOCK_MOVE_MAX} pieces at a time.`);
    const note = cleanNote(input.note, false);
    const from = await knownLocation(this.db, input.fromLocationId);
    const to = await knownLocation(this.db, input.toLocationId);
    if (from === to) throw validationError('A transfer goes to another location.');
    return inTransaction(this.db, async (tx) => {
      await lockSku(tx, skuId);
      const now = this.clock();
      const level = await stockLevel(tx, skuId, from);
      if (level.available < quantity) throw notAvailable(Math.max(0, level.available));
      const transferId = randomUUID();
      await recordMovement(tx, { skuId, locationId: from, delta: -quantity, reason: 'TRANSFER_OUT', transferId, note }, actor, now);
      await recordMovement(tx, { skuId, locationId: to, delta: quantity, reason: 'TRANSFER_IN', transferId, note }, actor, now);
      const served = await serveWaiting(tx, skuId, to, actor, now);
      await this.audit.record({ actor, action: 'stock.transfer', targetType: 'sku', targetId: skuId, details: { transferId, from, to, quantity, ...(note ? { noted: true } : {}) } }, tx);
      for (const n of served) await this.audit.record(n, tx);
      return { transferId, from: await stockLevel(tx, skuId, from), to: await stockLevel(tx, skuId, to) };
    });
  }

  /**
   * Correct the count of a SKU at a location by `delta` (± 1 to STOCK_MOVE_MAX), with the reason in a note (required):
   * a count, a piece found, a piece damaged. Never below what orders reserve there (409 STOCK_NOT_AVAILABLE). A count
   * up serves the orders waiting there (`order.serve`). Audited `stock.adjust`.
   */
  async adjust(input: { skuId: string; locationId: string; delta: number; note: string }, actor: Actor): Promise<StockLevel> {
    const skuId = knownSku(input?.skuId);
    const delta = input.delta;
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > STOCK_MOVE_MAX) throw validationError(`Correct the count by 1 to ${STOCK_MOVE_MAX} pieces, up or down.`);
    const note = cleanNote(input.note, true);
    const locationId = await knownLocation(this.db, input.locationId);
    return inTransaction(this.db, async (tx) => {
      await lockSku(tx, skuId);
      const now = this.clock();
      const level = await stockLevel(tx, skuId, locationId);
      if (delta < 0 && level.available + delta < 0) throw notAvailable(Math.max(0, level.available));
      await recordMovement(tx, { skuId, locationId, delta, reason: 'ADJUSTED', note }, actor, now);
      const served = delta > 0 ? await serveWaiting(tx, skuId, locationId, actor, now) : [];
      await this.audit.record({ actor, action: 'stock.adjust', targetType: 'sku', targetId: skuId, details: { locationId, delta } }, tx);
      for (const n of served) await this.audit.record(n, tx);
      return stockLevel(tx, skuId, locationId);
    });
  }

  // ── Locations and carriers (the console's settings) ──────────────────────

  /** Every location, the default first, then by name. */
  async locations(): Promise<StockLocationView[]> {
    const rows = await this.db.selectFrom('stock_locations').select([...LOCATION_COLUMNS]).orderBy('is_default', 'desc').orderBy('name').execute();
    return rows.map(locationView);
  }

  /**
   * A location added (its name unique whatever the case: 409 STOCK_LOCATION_NAME_TAKEN), with its postal address when
   * given. Audited `stock.location.create` with its name, and `fields: ['address']` for an address, never its words.
   */
  async createLocation(input: { name: string; address?: string | null }, actor: Actor): Promise<StockLocationView> {
    const name = cleanName(input?.name, LOCATION_NAME_MAX, 'The name');
    const address = cleanLocationAddress(input?.address);
    return this.named(locationTaken, () =>
      inTransaction(this.db, async (tx) => {
        const row = await tx.insertInto('stock_locations').values({ name, address, created_at: this.clock() }).returning([...LOCATION_COLUMNS]).executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'stock.location.create', targetType: 'stock_location', targetId: row.id, details: { name, ...(address ? { fields: ['address'] } : {}) } }, tx);
        return locationView(row);
      }),
    );
  }

  /**
   * A location renamed, made the default (`isDefault: true`: the previous default stops being one; there is always
   * exactly one, so a location stops being the default only when another becomes it), or given its postal address
   * (`address`, null clearing it; plan NEXT LOT §3.5.6.9). Audited `stock.location.update`: a name's change, the default,
   * and `fields: ['address']` for the address, never its words.
   */
  async updateLocation(locationId: string, input: { name?: string; isDefault?: true; address?: string | null }, actor: Actor): Promise<StockLocationView> {
    const id = await knownLocation(this.db, locationId);
    const name = input?.name === undefined ? undefined : cleanName(input.name, LOCATION_NAME_MAX, 'The name');
    if (input?.isDefault !== undefined && input.isDefault !== true) throw validationError('Make another location the default instead.');
    const address = input?.address === undefined ? undefined : cleanLocationAddress(input.address);
    if (name === undefined && input?.isDefault === undefined && address === undefined) throw validationError('Nothing to change.');
    return this.named(locationTaken, () =>
      inTransaction(this.db, async (tx) => {
        const before = await tx.selectFrom('stock_locations').select(['name', 'is_default', 'address']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
        const details: JsonObject = {};
        if (name !== undefined && name !== before.name) {
          await tx.updateTable('stock_locations').set({ name }).where('id', '=', id).execute();
          details.name = { from: before.name, to: name };
        }
        if (address !== undefined && address !== before.address) {
          await tx.updateTable('stock_locations').set({ address }).where('id', '=', id).execute();
          details.fields = ['address'];
        }
        if (input.isDefault && !before.is_default) {
          // The current default locked first: two locations made the default at once queue here, and the second one
          // then moves the default from the first (never a violation of stock_locations_one_default).
          await tx.selectFrom('stock_locations').select('id').where('is_default', '=', true).forUpdate().execute();
          const previous = await tx.updateTable('stock_locations').set({ is_default: false }).where('is_default', '=', true).returning('id').executeTakeFirst();
          await tx.updateTable('stock_locations').set({ is_default: true }).where('id', '=', id).execute();
          details.default = { from: previous?.id ?? null, to: id };
        }
        if (Object.keys(details).length === 0) throw validationError('Nothing to change.');
        await this.audit.record({ actor, action: 'stock.location.update', targetType: 'stock_location', targetId: id, details }, tx);
        return locationView(await tx.selectFrom('stock_locations').select([...LOCATION_COLUMNS]).where('id', '=', id).executeTakeFirstOrThrow());
      }),
    );
  }

  /** Every carrier, the active ones first, then by name. */
  async carriers(): Promise<CarrierView[]> {
    const rows = await this.db.selectFrom('carriers').select(['id', 'name', 'tracking_url', 'active']).orderBy('active', 'desc').orderBy('name').execute();
    return rows.map(carrierView);
  }

  /** A carrier added with its tracking link (409 CARRIER_NAME_TAKEN for a name in use). Audited `carrier.create`. */
  async createCarrier(input: { name: string; trackingUrl: string }, actor: Actor): Promise<CarrierView> {
    const name = cleanName(input?.name, CARRIER_NAME_MAX, 'The name');
    const trackingUrl = checkTrackingUrl(input?.trackingUrl);
    return this.named(carrierTaken, () =>
      inTransaction(this.db, async (tx) => {
        const row = await tx.insertInto('carriers').values({ name, tracking_url: trackingUrl, created_at: this.clock() }).returning(['id', 'name', 'tracking_url', 'active']).executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'carrier.create', targetType: 'carrier', targetId: row.id, details: { name, trackingUrl } }, tx);
        return carrierView(row);
      }),
    );
  }

  /** A carrier's name or tracking link changed, or the carrier set aside or offered again (`active`). Audited `carrier.update`. */
  async updateCarrier(carrierId: string, input: { name?: string; trackingUrl?: string; active?: boolean }, actor: Actor): Promise<CarrierView> {
    if (typeof carrierId !== 'string' || !UUID_RE.test(carrierId)) throw notFound('Carrier', 'CARRIER_NOT_FOUND');
    const id = carrierId.toLowerCase();
    const name = input?.name === undefined ? undefined : cleanName(input.name, CARRIER_NAME_MAX, 'The name');
    const trackingUrl = input?.trackingUrl === undefined ? undefined : checkTrackingUrl(input.trackingUrl);
    if (input?.active !== undefined && typeof input.active !== 'boolean') throw validationError('A carrier is active or not.');
    return this.named(carrierTaken, () =>
      inTransaction(this.db, async (tx) => {
        const before = await tx.selectFrom('carriers').select(['name', 'tracking_url', 'active']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!before) throw notFound('Carrier', 'CARRIER_NOT_FOUND');
        const set: { name?: string; tracking_url?: string; active?: boolean } = {};
        const details: JsonObject = {};
        if (name !== undefined && name !== before.name) {
          set.name = name;
          details.name = { from: before.name, to: name };
        }
        if (trackingUrl !== undefined && trackingUrl !== before.tracking_url) {
          set.tracking_url = trackingUrl;
          details.trackingUrl = { from: before.tracking_url, to: trackingUrl };
        }
        if (input.active !== undefined && input.active !== before.active) {
          set.active = input.active;
          details.active = input.active;
        }
        if (Object.keys(set).length === 0) throw validationError('Nothing to change.');
        const row = await tx.updateTable('carriers').set(set).where('id', '=', id).returning(['id', 'name', 'tracking_url', 'active']).executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'carrier.update', targetType: 'carrier', targetId: id, details }, tx);
        return carrierView(row);
      }),
    );
  }

  /** A name in use (the unique index whatever the case) answers 409. */
  private async named<T>(taken: () => DomainError, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw taken();
      throw e;
    }
  }
}
