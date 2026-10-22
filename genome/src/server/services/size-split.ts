/**
 * ORDER A MODEL, the split by size (macro scope of 2026-10-20, K11 Z1 and Z2; plan MACRO M3 §3, step M3.6): when staff
 * order a model (or a variant) from its supplier, the console proposes how the pieces are shared by size and by
 * location; staff change any line, and nothing is applied without them (ADD TO DRAFTS: SupplierOrderService
 * `addSplitToDrafts`). SizeSplitService (`ctx.services.sizeSplit`) only reads, in one REPEATABLE READ, READ ONLY
 * transaction, nothing cached, nothing audited.
 *
 *   splitProposal({ modelId, quantity, locationIds? })   POST /api/admin/supplier-orders/split (OPERATOR)
 *
 * Each offered size of the model (a size set aside is left out, as the supplier orders' proposal does) at each location
 * considered (every location by default, the default first) is weighed by:
 *   - orders: past orders of the size, any channel, test orders included (the owner: test entrants count everywhere),
 *     at the order's own location, net of size exchanges: an order CANCELLED or RETURNED does not count, and an EXCHANGE
 *     order counts in its new size (the order it replaced is RETURNED), so the size kept is the size counted;
 *   - saved sizes: the collectors who wish for or own that kind of piece, each counted once: an open wish
 *     (`account_wishes`, not removed) on any model whose size kind (`sizeKindOf`: its own, else its main model's) is the
 *     ordered model's, this model included, or a piece held now (an ownership not ended) of a model of that kind; a wish
 *     or a piece of another kind does not count. Their saved size of that kind (`account_sizes`) is matched to the
 *     model's offered sizes (`matchSavedSize`: a size's fit, else its label read as a measure, exactly one match); a saved
 *     size matching none is counted apart (`unmatched`). A collector counts at the location that serves their country
 *     (their default address's, else their profile's: `stock_location_countries`), a country no location serves at the
 *     default location; a DELETED account never counts. A model of no size kind (one size, a model without a size type)
 *     reads no saved size.
 * The pieces are shared in proportion to `orders + saved sizes` by the largest remainder (a line without weight gets 0);
 * with no weight at all, evenly over the offered sizes at the default location (the first location considered when the
 * default is not among them), and the source says so (`EVEN`). A model without an offered size: 409 MODEL_NO_SIZES.
 *
 * Counts only: the answer never names an account (the security model: saved sizes read only as counts by size and
 * location). A Shopify order packed by the platform is an order like the others, so the store's sales feed the orders'
 * weight as the platform's (S3); a location's countries follow the store's order routing (S4).
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { SizeKind } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { matchSavedSize, sizeKindOf, type SizeCandidate } from './sizes.js';
import { compareSizes, locationCountryMap, stockNotReady } from './stock.js';

/** The pieces a split shares, at most (a supplier order line's own limit). */
export const SPLIT_QUANTITY_MAX = 10_000;
/** The locations a split considers, at most (as many as the console lists). */
export const SPLIT_LOCATIONS_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');
const locationNotFound = () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND');
export const modelNoSizes = () => conflict('MODEL_NO_SIZES', 'This model has no offered size: declare its sizes in the Catalogue.');

export interface SplitInput {
  modelId: string;
  /** The pieces to share, 1 to SPLIT_QUANTITY_MAX. */
  quantity: number;
  /** The locations to consider; every location when omitted. */
  locationIds?: readonly string[] | null;
}

/** A line of the proposal: one offered size at one location. */
export interface SplitLine {
  sku: { id: string; code: string; sizeLabel: string | null };
  location: { id: string; name: string };
  /** Past orders of the size there, net of size exchanges. */
  orders: number;
  /** Collectors counted there whose saved size matches this size. */
  savedSizes: number;
  /** The pieces proposed. */
  proposed: number;
}

/** The proposal (POST /api/admin/supplier-orders/split). */
export interface SplitProposal {
  model: { id: string; name: string; variant: string | null };
  /** The model's size kind (its main model's for a variant without one); null: no saved size is read. */
  sizeKind: SizeKind | null;
  quantity: number;
  /** The locations considered, the default first, then by name. */
  locations: { id: string; name: string; isDefault: boolean }[];
  /** Every offered size at every location considered, by size, then location. */
  lines: SplitLine[];
  totals: { orders: number; savedSizes: number; proposed: number };
  /** Saved sizes of collectors counted at the locations considered that match none of the offered sizes. */
  unmatched: number;
  /** DATA: from orders and saved sizes; EVEN: no data, split evenly at the default location. */
  source: 'DATA' | 'EVEN';
}

/**
 * `quantity` shared in proportion to `weights` by the largest remainder (pure): each share's whole part, then one more
 * piece to the largest remainders, ties to the larger weight, then the earlier line. A weight of 0 gets 0; all zero (or
 * none): all zero.
 */
export function largestRemainder(quantity: number, weights: readonly number[]): number[] {
  const total = weights.reduce((n, w) => n + w, 0);
  if (total <= 0 || quantity <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((quantity * w) / total));
  let left = quantity - out.reduce((n, x) => n + x, 0);
  const order = weights
    .map((w, i) => ({ i, w, rest: (quantity * w) % total }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.rest - a.rest || b.w - a.w || a.i - b.i);
  for (const x of order) {
    if (left <= 0) break;
    out[x.i]! += 1;
    left -= 1;
  }
  return out;
}

/** The locations a split considers: every one (undefined, null), or those named, each known, each once. */
function cleanLocationIds(v: unknown): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length === 0) throw validationError('Choose at least one location.');
  if (v.length > SPLIT_LOCATIONS_MAX) throw validationError(`Choose at most ${SPLIT_LOCATIONS_MAX} locations.`);
  const out = new Set<string>();
  for (const id of v) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw locationNotFound();
    out.add(id.toLowerCase());
  }
  return [...out];
}

export class SizeSplitService {
  private readonly db: Db;

  constructor(deps: { db: Db }) {
    this.db = deps.db;
  }

  /** The split proposed (see the file header). 404 MODEL_NOT_FOUND, STOCK_LOCATION_NOT_FOUND; 409 MODEL_NO_SIZES. */
  async splitProposal(input: SplitInput): Promise<SplitProposal> {
    const modelId = input?.modelId;
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
    const quantity = input.quantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > SPLIT_QUANTITY_MAX) throw validationError(`Order 1 to ${SPLIT_QUANTITY_MAX} pieces.`);
    const locationIds = cleanLocationIds(input.locationIds);
    return this.readOnly(async (tx) => {
      const m = await tx.selectFrom('models').select(['id', 'name', 'variant_of', 'variant_label']).where('id', '=', modelId.toLowerCase()).executeTakeFirst();
      if (!m) throw modelNotFound();

      const all = await tx.selectFrom('stock_locations').select(['id', 'name', 'is_default']).orderBy('is_default', 'desc').orderBy('name').execute();
      const defaultId = all.find((l) => l.is_default)?.id;
      if (!defaultId) throw stockNotReady();
      if (locationIds) for (const id of locationIds) if (!all.some((l) => l.id === id)) throw locationNotFound();
      const considered = locationIds ? all.filter((l) => locationIds.includes(l.id)) : all;
      const consideredIds = new Set(considered.map((l) => l.id));

      const skus = (
        await tx.selectFrom('skus').select(['id', 'code', 'size_label', 'fit_min_mm', 'fit_max_mm']).where('model_id', '=', m.id).where('set_aside_at', 'is', null).execute()
      ).sort((a, b) => compareSizes(a.size_label, b.size_label) || a.code.localeCompare(b.code));
      if (skus.length === 0) throw modelNoSizes();
      const skuIds = skus.map((k) => k.id);
      const key = (skuId: string, locationId: string) => `${skuId}:${locationId}`;

      // Orders net of size exchanges: neither CANCELLED nor RETURNED, at their own location.
      const orders = new Map<string, number>();
      const orderRows = await tx
        .selectFrom('orders')
        .select(['sku_id', 'location_id', (eb) => eb.fn.countAll<number>().as('n')])
        .where('sku_id', 'in', skuIds)
        .where('status', 'not in', ['CANCELLED', 'RETURNED'])
        .groupBy(['sku_id', 'location_id'])
        .execute();
      for (const r of orderRows) if (r.sku_id && consideredIds.has(r.location_id)) orders.set(key(r.sku_id, r.location_id), Number(r.n));

      // Saved sizes of the collectors who wish for or own that kind of piece, each once, at the location of their country.
      const kind = await sizeKindOf(tx, m.id);
      const saved = new Map<string, number>();
      let unmatched = 0;
      if (kind !== null) {
        const people = await sql<{ account_id: string; value_mm: number; country: string | null }>`
          WITH kinded AS (
                 SELECT m.id FROM models m LEFT JOIN models main ON main.id = m.variant_of
                  WHERE coalesce(m.size_kind, main.size_kind) = ${kind}),
               collectors AS (
                 SELECT w.account_id FROM account_wishes w
                  WHERE w.removed_at IS NULL AND w.model_id IN (SELECT id FROM kinded)
                 UNION
                 SELECT o.account_id FROM ownership o JOIN products p ON p.id = o.product_id
                  WHERE o.ended_at IS NULL AND p.model_id IN (SELECT id FROM kinded))
          SELECT c.account_id, s.value_mm, coalesce(ad.country, a.country) AS country
            FROM collectors c
            JOIN accounts a ON a.id = c.account_id AND a.status <> 'DELETED'
            JOIN account_sizes s ON s.account_id = c.account_id AND s.kind = ${kind}
            LEFT JOIN account_addresses ad ON ad.account_id = c.account_id AND ad.is_default`.execute(tx);
        const served = await locationCountryMap(tx);
        const candidates: SizeCandidate[] = skus
          .filter((k) => k.size_label !== null)
          .map((k) => ({ id: k.id, label: k.size_label!, fitMinMm: k.fit_min_mm, fitMaxMm: k.fit_max_mm }));
        for (const p of people.rows) {
          const country = typeof p.country === 'string' ? p.country.trim() : null;
          const locationId = (country && served.get(country)) || defaultId;
          if (!consideredIds.has(locationId)) continue;
          const match = matchSavedSize(kind, Number(p.value_mm), candidates);
          if (match) saved.set(key(match.id, locationId), (saved.get(key(match.id, locationId)) ?? 0) + 1);
          else unmatched += 1;
        }
      }

      const cells = skus.flatMap((k) => considered.map((l) => ({ k, l, orders: orders.get(key(k.id, l.id)) ?? 0, saved: saved.get(key(k.id, l.id)) ?? 0 })));
      const weights = cells.map((c) => c.orders + c.saved);
      const hasData = weights.some((w) => w > 0);
      const evenAt = consideredIds.has(defaultId) ? defaultId : considered[0]!.id;
      const proposed = largestRemainder(quantity, hasData ? weights : cells.map((c) => (c.l.id === evenAt ? 1 : 0)));
      const lines: SplitLine[] = cells.map((c, i) => ({
        sku: { id: c.k.id, code: c.k.code, sizeLabel: c.k.size_label },
        location: { id: c.l.id, name: c.l.name },
        orders: c.orders,
        savedSizes: c.saved,
        proposed: proposed[i]!,
      }));
      return {
        model: { id: m.id, name: m.name, variant: m.variant_of !== null ? m.variant_label : null },
        sizeKind: kind,
        quantity,
        locations: considered.map((l) => ({ id: l.id, name: l.name, isDefault: l.is_default })),
        lines,
        totals: {
          orders: lines.reduce((n, l) => n + l.orders, 0),
          savedSizes: lines.reduce((n, l) => n + l.savedSizes, 0),
          proposed: lines.reduce((n, l) => n + l.proposed, 0),
        },
        unmatched,
        source: hasData ? 'DATA' : 'EVEN',
      };
    });
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction: every table of the proposal sees the same moment. */
  private async readOnly<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      return fn(tx);
    });
  }
}
