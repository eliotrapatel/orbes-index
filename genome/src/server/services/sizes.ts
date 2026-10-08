/**
 * YOUR SIZES (plan NEXT-NINE of 2026-10-06, §3.4 AC-01; migration 0030; API §10.19 and §13.4, DATABASE §5.71): the sizes
 * a collector keeps in its account (a ring size, a bracelet size, a wrist for watches, a necklace length), which
 * preselect a model's size in I'LL BE THERE, the LIVE ready check and a salon request. The collector confirms it every
 * time: a preselection is never a choice made for it, and nothing is sent until it presses.
 *
 *   saved       `account_sizes`, one row per account and kind, in whole millimetres (SIZE_RANGES): the French ring size
 *               itself (40 to 76), or the centimetres × 10 (a bracelet 14 to 24 cm by 0.5, a wrist 12 to 24 cm by 0.5,
 *               a necklace 35 to 100 cm by 1). The API speaks the collector's units (a ring size, centimetres:
 *               `{ RING: 52, WRIST: 16.5 }`). Set whole (`SizeService.set`, PUT /api/v1/account/sizes): a kind given a
 *               value is saved, a kind null or left out is cleared (its row deleted). Audited `account.sizes.update`
 *               with the kinds set and cleared, never the measures.
 *   a model's   `models.size_kind`: which saved size preselects its size; a variant without one reads its main model's
 *   kind        (`sizeKindOf`). Set from the console's Sizes section (`SizeService.setModelSizes`, OPERATOR, audited
 *               `model.sizes.update`), with each size's fit (`skus.fit_min_mm`, `fit_max_mm`, in the kind's millimetres).
 *   matched     `matchSavedSize`: among a model's sizes (its SKUs, or a release's sizes; one without stock left out), a
 *               size whose fit range holds the saved measure, or, without a range, whose label read as a measure
 *               (`labelToMm`) equals it. A size only when exactly one matches; otherwise none, and nothing is
 *               preselected.
 *
 * Nothing here writes on its own: the room (services/live-room.ts), the salon (services/salon.ts) and a GIFT order's page
 * (services/orders.ts) read the saved size; only the collector's own press (I'LL BE THERE, ENTER THE ROOM, REQUEST THIS
 * PIECE) sends it. Saved sizes are not in segments, the owner sheet or the draws (§6); the right of access exports them
 * (OwnerService.exportData).
 *
 * DECLARED SIZES (plan NEXT LOT of 2026-10-07, §3.3; migration 0033; API §13.4, DATABASE §5.3 and §5.47): « each model,
 * variant needs to have its sizes and each size must have its own stock count, with different skus ».
 *
 *   size type   `models.size_type`: RING, BRACELET, NECKLACE (its sizes ticked from a fixed list, `standardSizes`: French
 *               sizes 40 to 76; 14 to 24 cm by 0.5; 35 to 100 cm by 1, each label the bare number, '52', '17.5'), WATCH
 *               or ONE_SIZE (a single SKU, its label NULL: ONE SIZE). NULL: 'To give'. Giving it derives `size_kind`
 *               (`SIZE_TYPE_KIND`: a watch preselects with the wrist). Once given, never cleared, only changed; giving or
 *               changing it never removes a size (sizes off the new list stay offered, flagged).
 *   declared    each SKU of a model is one of its declared sizes, offered (`set_aside_at` NULL) or set aside. Ticking a
 *               size creates its SKU (`ensureSku`: its code the prefix and the size), or reinstates the set-aside one that
 *               reads as it; unticking removes every offered SKU that reads as it when nothing uses it (`SKU_USES`,
 *               `skuUsed`), otherwise sets it aside. A model keeps at least one offered size. `SizeService.declare`,
 *               `removeSize`, `reinstateSize`, audited `model.sizes.declare` (SKU codes, never personal data); each
 *               write locks the model FOR NO KEY UPDATE first (never FOR UPDATE, which would deadlock against an order
 *               inserted for the model), then each SKU it removes or sets aside FOR UPDATE in id order.
 *   offered     `offeredSku` is how every flow names a size (a release, an order, the salon, the Generator): a model
 *               with no type works as before (`ensureSku`, sizes created by accident included); a typed model's size
 *               must be one of its declared sizes, matched by its label whatever the case or by its measure ('SIZE
 *               52' is 52), 400 SIZE_NOT_DECLARED otherwise, 409 SIZE_SET_ASIDE for a size set aside (the Generator
 *               and orders of earlier requests and releases allow it). It takes the SKU FOR KEY SHARE, so a removal
 *               running at the same moment either waits and then sets the size aside, or went first and the flow
 *               refuses cleanly.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { SIZE_KINDS, SIZE_TYPES, type SizeKind, type SizeType } from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { compareSizes, ensureSku, ONE_SIZE_LABEL, sizeLabelOf, stockLevel } from './stock.js';

export { SIZE_KINDS, SIZE_TYPES, type SizeKind, type SizeType };

// ── Rules ──────────────────────────────────────────────────────────────────

/**
 * Each kind's measures, in whole millimetres (as `account_sizes_value` holds them), and how the collector reads them:
 * `unit` FR, the French ring size itself; CM, centimetres (the millimetres / 10).
 */
export const SIZE_RANGES: Readonly<Record<SizeKind, Readonly<{ min: number; max: number; step: number; unit: 'FR' | 'CM' }>>> = Object.freeze({
  RING: Object.freeze({ min: 40, max: 76, step: 1, unit: 'FR' as const }),
  BRACELET: Object.freeze({ min: 140, max: 240, step: 5, unit: 'CM' as const }),
  WRIST: Object.freeze({ min: 120, max: 240, step: 5, unit: 'CM' as const }),
  NECKLACE: Object.freeze({ min: 350, max: 1000, step: 10, unit: 'CM' as const }),
});

/** A size's fit range (skus.fit_min_mm, fit_max_mm), in whole millimetres: within these bounds (`skus_fit`). */
export const FIT_RANGE_MM = Object.freeze({ min: 1, max: 1000 });

/** What each kind's range error says (the collector's units). */
const RANGE_WORDS: Readonly<Record<SizeKind, string>> = Object.freeze({
  RING: 'A ring size is 40 to 76.',
  BRACELET: 'A bracelet size is 14 to 24 cm, by 0.5 cm.',
  WRIST: 'A wrist is 12 to 24 cm, by 0.5 cm.',
  NECKLACE: 'A necklace length is 35 to 100 cm, by 1 cm.',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sizes of an account, in the collector's units (a ring size; centimetres); null: not saved. */
export type AccountSizes = Record<SizeKind, number | null>;

/** A size of a model a saved size may preselect: a SKU, or a LIVE RELEASE's size with its SKU's fit and its stock. */
export interface SizeCandidate {
  /** The size's own id (a release's size, a SKU). */
  id: string;
  label: string;
  fitMinMm: number | null;
  fitMaxMm: number | null;
  /** Its stock when it is counted (a release's size): 0 or less is never preselected. Undefined: not counted. */
  stock?: number;
}

/**
 * A model's declared size in the console's Sizes section (plan NEXT LOT §3.3): its SKU, its label (null: ONE SIZE), its
 * fit, and where it stands.
 */
export interface ModelSizeRow {
  skuId: string;
  /** null: ONE SIZE. */
  label: string | null;
  code: string;
  fitMinMm: number | null;
  fitMaxMm: number | null;
  /** When it was set aside; null: offered. */
  setAsideAt: Date | null;
  /** Its label reads as a size of its model's type's list (ONE SIZE for a watch or a model of one size); true without a type. */
  onList: boolean;
  /** The list's label another declared size reads as too, when this one's label is not the list's own ('SIZE 52': '52'); else null. */
  sameAs: string | null;
  /** Something uses it (SKU_USES): removing it sets it aside. */
  used: boolean;
  /** The orders waiting for supplier stock in this size (reservation AWAITING, from H2); 0 before. */
  awaiting: number;
}

/** The console's Sizes section of a model (GET /api/admin/models/:id/sizes). */
export interface ModelSizes {
  modelId: string;
  /** Its size type (plan NEXT LOT §3.3); null: to give. */
  sizeType: SizeType | null;
  /** The model's own size kind; null: none. */
  sizeKind: SizeKind | null;
  /**
   * A variant without a type nor a kind of its own: its main model's kind and name (« Reads Ring size from MONOLITHE »);
   * else null.
   */
  inherited: { sizeKind: SizeKind; from: string } | null;
  /** Its type's sizes to tick (standardSizes); empty without a type, and for a watch or a model of one size. */
  list: string[];
  /** Its declared sizes, ONE SIZE included, in the order a client reads them, the offered ones first. */
  sizes: ModelSizeRow[];
  /** How many are offered, and how many set aside. */
  offered: number;
  setAside: number;
}

/** A model's offered size (offeredSizes): its SKU, its label (null: ONE SIZE) and its code. */
export interface OfferedSize {
  skuId: string;
  label: string | null;
  code: string;
}

/** A size an order may be exchanged for (sizesForExchange): its stock at the order's location, selectable when some is available. */
export interface ExchangeSize {
  skuId: string;
  label: string | null;
  available: number;
  selectable: boolean;
}

// ── Declared sizes: the rules ──────────────────────────────────────────────

/** The saved size each size type preselects with (models_size_type_kind): a watch the wrist, a model of one size none. */
export const SIZE_TYPE_KIND: Readonly<Record<SizeType, SizeKind | null>> = Object.freeze({
  RING: 'RING',
  BRACELET: 'BRACELET',
  NECKLACE: 'NECKLACE',
  WATCH: 'WRIST',
  ONE_SIZE: null,
});

/** What each size type is called in the errors and the console. */
export const SIZE_TYPE_WORDS: Readonly<Record<SizeType, string>> = Object.freeze({
  RING: 'Ring size',
  BRACELET: 'Bracelet size',
  NECKLACE: 'Necklace length',
  WATCH: 'Watch',
  ONE_SIZE: 'One size',
});

/** The size types whose sizes are ticked from a list (the others have a single SKU, ONE SIZE). */
export const LISTED_SIZE_TYPES: readonly SizeType[] = Object.freeze(['RING', 'BRACELET', 'NECKLACE'] as const);

/** A ticked size's label, at most (the PUT's `ticked`). */
export const TICKED_LABEL_MAX = 12;

const listedKind = (type: SizeType | null): SizeKind | null => (type !== null && LISTED_SIZE_TYPES.includes(type) ? SIZE_TYPE_KIND[type] : null);

/**
 * The sizes a type's model is ticked from, never a setting (the owner fixed the lists): a ring '40' to '76' (37), a
 * bracelet '14', '14.5' to '24' (21), a necklace '35' to '100' (66), each the bare number with a dot; a watch and a model
 * of one size none (their only size is ONE SIZE, a SKU with a NULL label).
 */
export function standardSizes(type: SizeType | null): string[] {
  const kind = listedKind(type);
  if (kind === null) return [];
  const r = SIZE_RANGES[kind];
  const out: string[] = [];
  for (let mm = r.min; mm <= r.max; mm += r.step) out.push(String(fromMm(kind, mm)));
  return out;
}

/**
 * The label of a type's list a size's label reads as ('SIZE 52' → '52', '17,5 cm' → '17.5', '45' a necklace → '45'), by
 * its measure (`labelToMm`); null for a label off the list (S, ONE SIZE, a measure the list has not) and for a type without
 * a list.
 */
export function listEntryOf(type: SizeType | null, label: string | null | undefined): string | null {
  const kind = listedKind(type);
  if (kind === null) return null;
  const mm = labelToMm(kind, label);
  if (mm === null) return null;
  const entry = String(fromMm(kind, mm));
  return standardSizes(type).includes(entry) ? entry : null;
}

/** How a size is named in a sentence: « Size 52 », or « ONE SIZE ». */
const sizeName = (label: string | null) => (label === null ? ONE_SIZE_LABEL : `Size ${label}`);
/** How a size is listed: « 52 », or « ONE SIZE ». */
const sizeText = (label: string | null) => label ?? ONE_SIZE_LABEL;

/**
 * Everything that makes a declared size used (plan NEXT LOT §3.3): a removal sets it aside rather than deleting it. Every
 * foreign key to `skus` is one of `references` (test/db/schema.test.ts compares them with pg_constraint, so a table added
 * later without being listed fails the build); `others` are the uses without a foreign key.
 */
export const SKU_USES = Object.freeze({
  references: Object.freeze([
    Object.freeze({ table: 'stock_movements', column: 'sku_id' }),
    Object.freeze({ table: 'orders', column: 'sku_id' }),
    Object.freeze({ table: 'products', column: 'sku_id' }),
    Object.freeze({ table: 'drop_sizes', column: 'sku_id' }),
    Object.freeze({ table: 'sku_thresholds', column: 'sku_id' }),
    Object.freeze({ table: 'bench_items', column: 'sku_id' }),
  ]),
  others: Object.freeze([
    'an OPEN salon request (shop_requests) of the model in the same size, whatever its case',
    'a Shopify id (skus.shopify_product_id or shopify_variant_id)',
  ]),
});

/** For each SKU, whether something uses it (SKU_USES), in SQL over a row `k` of `skus`. */
const usedSql = sql<boolean>`(${sql.join(
  [
    ...SKU_USES.references.map((u) => sql`EXISTS (SELECT 1 FROM ${sql.table(u.table)} x WHERE x.${sql.ref(u.column)} = k.id)`),
    sql`EXISTS (SELECT 1 FROM shop_requests r WHERE r.model_id = k.model_id AND r.status = 'OPEN' AND k.size_label IS NOT NULL AND upper(r.size_label) = upper(k.size_label))`,
    sql`k.shopify_product_id IS NOT NULL`,
    sql`k.shopify_variant_id IS NOT NULL`,
  ],
  sql` OR `,
)})`;

/** Whether something uses a SKU (SKU_USES): a removal then sets it aside. */
export async function skuUsed(tx: Db, skuId: string): Promise<boolean> {
  const r = await sql<{ used: boolean }>`SELECT ${usedSql} AS used FROM skus k WHERE k.id = ${skuId}`.execute(tx);
  return r.rows[0]?.used === true;
}

/** A model's SKUs as the declared sizes read them. */
interface SkuRow {
  id: string;
  size_label: string | null;
  code: string;
  fit_min_mm: number | null;
  fit_max_mm: number | null;
  set_aside_at: Date | null;
  created_at: Date;
}

const skuRows = (db: Db, modelId: string): Promise<SkuRow[]> =>
  db
    .selectFrom('skus')
    .select(['id', 'size_label', 'code', 'fit_min_mm', 'fit_max_mm', 'set_aside_at', 'created_at'])
    .where('model_id', '=', modelId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

/** Declared sizes in the order a client reads them, the offered ones first. */
const byOffer = (a: { label: string | null; setAsideAt: Date | null }, b: { label: string | null; setAsideAt: Date | null }) =>
  Number(a.setAsideAt !== null) - Number(b.setAsideAt !== null) || compareSizes(a.label, b.label);

/** Whether a SKU's label is on its type's list: a list size for a ring, a bracelet, a necklace; ONE SIZE for the others; any without a type. */
function onListOf(type: SizeType | null, label: string | null): boolean {
  if (type === null) return true;
  if (listedKind(type) === null) return label === null;
  return listEntryOf(type, label) !== null;
}

/** The model's type and how its sizes' errors name it: « MONOLITHE », a variant « MONOLITHE · BLUE ». */
async function sizedModel(db: Db, modelId: string): Promise<{ id: string; sizeType: SizeType | null; named: string } | undefined> {
  const m = await db.selectFrom('models').select(['id', 'name', 'size_type', 'variant_of', 'variant_label']).where('id', '=', modelId).executeTakeFirst();
  if (!m) return undefined;
  return { id: m.id, sizeType: m.size_type, named: m.variant_of !== null && m.variant_label ? `${m.name} · ${m.variant_label.toUpperCase()}` : m.name };
}

/**
 * A model's declared sizes (the console's Sizes section): every SKU, ONE SIZE included, offered first, each with whether
 * its label is on its type's list, the list size another size reads as too (`sameAs`), whether something uses it, and
 * the orders waiting for supplier stock in it (reservation AWAITING, from H2; 0 before).
 */
export async function declaredSizes(db: Db, modelId: string): Promise<ModelSizeRow[]> {
  const m = await db.selectFrom('models').select('size_type').where('id', '=', modelId).executeTakeFirst();
  const type = m?.size_type ?? null;
  const rows = await sql<SkuRow & { used: boolean; awaiting: number }>`
    SELECT k.id, k.size_label, k.code, k.fit_min_mm, k.fit_max_mm, k.set_aside_at, k.created_at, ${usedSql} AS used,
           (SELECT count(*)::int FROM orders o WHERE o.sku_id = k.id AND o.reservation = 'AWAITING') AS awaiting
      FROM skus k WHERE k.model_id = ${modelId}`.execute(db);
  const entries = rows.rows.map((r) => ({ r, entry: listEntryOf(type, r.size_label) }));
  return entries
    .map(({ r, entry }) => ({
      skuId: r.id,
      label: r.size_label,
      code: r.code,
      fitMinMm: r.fit_min_mm,
      fitMaxMm: r.fit_max_mm,
      setAsideAt: r.set_aside_at,
      onList: onListOf(type, r.size_label),
      sameAs: entry !== null && entry !== r.size_label && entries.some((o) => o.r.id !== r.id && o.entry === entry) ? entry : null,
      used: r.used === true,
      awaiting: Number(r.awaiting ?? 0),
    }))
    .sort(byOffer);
}

/** A model's offered sizes (LOGISTICS, the supplier-order draft, exchanges), in the order a client reads them. */
export async function offeredSizes(db: Db, modelId: string): Promise<OfferedSize[]> {
  const rows = await db.selectFrom('skus').select(['id', 'size_label', 'code']).where('model_id', '=', modelId).where('set_aside_at', 'is', null).execute();
  return rows.map((r) => ({ skuId: r.id, label: r.size_label, code: r.code })).sort((a, b) => compareSizes(a.label, b.label));
}

/** 400 SIZE_NOT_DECLARED: a size a typed model was not declared in, its offered sizes listed. */
async function sizeNotDeclared(db: Db, model: { id: string; named: string }, label: string | null) {
  const offered = (await offeredSizes(db, model.id)).map((o) => sizeText(o.label));
  return badRequest(
    'SIZE_NOT_DECLARED',
    `${sizeName(label)} is not one of ${model.named}’s sizes (${offered.length ? offered.join(', ') : 'none yet'}). Add it on the model’s page, in the Catalogue.`,
  );
}

/** 409 SIZE_SET_ASIDE: a size set aside, named. */
export const sizeSetAside = (label: string | null, named: string) =>
  conflict('SIZE_SET_ASIDE', `${sizeName(label)} of ${named} is set aside. Reinstate it on the model’s page to offer it again.`);

/**
 * A SKU that must be offered (the stock's minimum, a piece to make for the stock: plan NEXT LOT §3.3, step 3.5), read
 * FOR KEY SHARE in the caller's transaction: 409 SIZE_SET_ASIDE for a size set aside, 404 SKU_NOT_FOUND when it is gone.
 */
export async function assertSkuOffered(tx: Db, skuId: string): Promise<void> {
  const k = await tx.selectFrom('skus').select(['model_id', 'size_label', 'set_aside_at']).where('id', '=', skuId).forKeyShare().executeTakeFirst();
  if (!k) throw notFound('SKU', 'SKU_NOT_FOUND');
  if (k.set_aside_at === null) return;
  const model = await sizedModel(tx, k.model_id);
  throw sizeSetAside(k.size_label, model?.named ?? 'its model');
}

/** What offeredSku returns: the SKU, its declared label (null: ONE SIZE), and whether the model has its type (false: as before). */
export interface OfferedSku {
  skuId: string;
  /** The label to store: the declared one on a typed model; on a model with no type, the label asked (sizeLabelOf). */
  label: string | null;
  /** The model has its size type: the label was matched to a declared size. */
  typed: boolean;
}

/**
 * The SKU of a model in the size a flow names (a release, an order, the salon, the Generator), in the caller's
 * transaction. A model with no type: `ensureSku` as before (sizes by accident included). A typed model: one of its
 * declared sizes whose label matches whatever the case, or (a ring, a bracelet, a necklace) reads as the same measure;
 * several: the offered ones, then the list's own label, then the oldest. Not declared: 400 SIZE_NOT_DECLARED with its
 * sizes; set aside: 409 SIZE_SET_ASIDE, unless `allowSetAside` (the Generator, orders of earlier requests and releases).
 * The SKU's row is taken FOR KEY SHARE, so a removal at the same moment waits and then sees the size used, or went first
 * and this refuses cleanly (never a foreign-key failure).
 */
export async function offeredSku(tx: Db, modelId: string, label: string | null | undefined, opts: { allowSetAside?: boolean } = {}): Promise<OfferedSku> {
  const model = await sizedModel(tx, modelId);
  if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
  const asked = sizeLabelOf(label);
  if (model.sizeType === null) return { skuId: await ensureSku(tx, modelId, asked), label: asked, typed: false };
  const type = model.sizeType;
  const wanted = listEntryOf(type, asked);
  const rows = await skuRows(tx, modelId);
  const matches = rows.filter((r) =>
    asked === null ? r.size_label === null : (r.size_label !== null && r.size_label.toUpperCase() === asked.toUpperCase()) || (wanted !== null && listEntryOf(type, r.size_label) === wanted),
  );
  if (matches.length === 0) throw await sizeNotDeclared(tx, model, asked);
  const own = (r: SkuRow) => r.size_label !== null && listEntryOf(type, r.size_label) === r.size_label;
  const best = [...matches].sort((a, b) => Number(a.set_aside_at !== null) - Number(b.set_aside_at !== null) || Number(own(b)) - Number(own(a)))[0]!;
  if (best.set_aside_at !== null && !opts.allowSetAside) throw sizeSetAside(best.size_label, model.named);
  // The row taken FOR KEY SHARE, read again: a removal that went first has deleted it or set it aside.
  const held = await tx.selectFrom('skus').select(['id', 'size_label', 'set_aside_at']).where('id', '=', best.id).forKeyShare().executeTakeFirst();
  if (!held) throw await sizeNotDeclared(tx, model, asked);
  if (held.set_aside_at !== null && !opts.allowSetAside) throw sizeSetAside(held.size_label, model.named);
  return { skuId: held.id, label: held.size_label, typed: true };
}

/**
 * The sizes an order may be exchanged for (EXCHANGE THE SIZE, plan NEXT LOT §3.6.D): its model's offered sizes but its
 * own, each with what is available at the order's location (on hand less reserved), selectable when some is; none for a
 * model of a single size.
 */
export async function sizesForExchange(db: Db, orderId: string): Promise<ExchangeSize[]> {
  const o = await db.selectFrom('orders').select(['model_id', 'sku_id', 'location_id']).where('id', '=', orderId).executeTakeFirst();
  if (!o) throw notFound('Order', 'ORDER_NOT_FOUND');
  const others = (await offeredSizes(db, o.model_id)).filter((s) => s.skuId !== o.sku_id);
  const out: ExchangeSize[] = [];
  for (const s of others) {
    const available = o.location_id === null ? 0 : (await stockLevel(db, s.skuId, o.location_id)).available;
    out.push({ skuId: s.skuId, label: s.label, available, selectable: available > 0 });
  }
  return out;
}

// ── Errors ─────────────────────────────────────────────────────────────────

const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');
const nothingChanged = () => validationError('Nothing has changed.');
const sizeTypeRequired = () => conflict('SIZE_TYPE_REQUIRED', 'Give the model its size type first.');
const sizeTypeGiven = () => conflict('SIZE_TYPE_GIVEN', 'This model has its size type: change it in Size type.');
const lastOffered = () => conflict('SIZE_LAST_OFFERED', 'A model keeps at least one size offered.');

// ── Reading a measure ──────────────────────────────────────────────────────

/** A collector's value of a kind (a ring size; centimetres) as whole millimetres; a DomainError 400 off its range or step. */
export function toMm(kind: SizeKind, value: unknown): number {
  const r = SIZE_RANGES[kind];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw validationError(RANGE_WORDS[kind]);
  const mm = r.unit === 'FR' ? value : value * 10;
  const whole = Math.round(mm);
  if (Math.abs(mm - whole) > 1e-6 || whole < r.min || whole > r.max || whole % r.step !== 0) throw validationError(RANGE_WORDS[kind]);
  return whole;
}

/** Whole millimetres as the collector reads them: a ring size, or centimetres (16.5). */
export function fromMm(kind: SizeKind, mm: number): number {
  return SIZE_RANGES[kind].unit === 'FR' ? mm : mm / 10;
}

/**
 * The body of PUT /api/v1/account/sizes, `{ RING: 52, BRACELET: null, WRIST: 16.5 }`: each kind given a number is saved
 * (400 off its range or step, 'A ring size is 40 to 76.'), each kind null or left out cleared.
 */
export function parseSizesInput(input: unknown): Map<SizeKind, number> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw validationError('Your sizes are a ring size, a bracelet size, a wrist and a necklace length.');
  const out = new Map<SizeKind, number>();
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(SIZE_KINDS as readonly string[]).includes(key)) throw validationError('Your sizes are a ring size, a bracelet size, a wrist and a necklace length.');
    if (value === null || value === undefined) continue;
    out.set(key as SizeKind, toMm(key as SizeKind, value));
  }
  return out;
}

const LABEL_RE = /^(?:SIZE\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(MM|CM)?$/;

/**
 * A size's label read as a measure of the kind, in whole millimetres: '52', 'SIZE 52', '52 MM', '17.5 CM', '17,5 cm'. A
 * number without a unit is millimetres for a ring (its French size) and centimetres otherwise. ONE SIZE, a letter
 * (S, M) or anything else: null.
 */
export function labelToMm(kind: SizeKind, label: string | null | undefined): number | null {
  if (typeof label !== 'string') return null;
  const m = LABEL_RE.exec(label.trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const unit = m[2] ?? (SIZE_RANGES[kind].unit === 'FR' ? 'MM' : 'CM');
  const mm = unit === 'MM' ? n : n * 10;
  return Number.isFinite(mm) && mm > 0 ? Math.round(mm) : null;
}

/**
 * The size a saved measure preselects among a model's sizes: those with stock (when counted), a size's fit range first,
 * otherwise its label read as a measure. Only when exactly one size matches; null otherwise, and null without a kind or
 * a saved measure.
 */
export function matchSavedSize<C extends SizeCandidate>(kind: SizeKind | null, savedMm: number | null, candidates: readonly C[]): C | null {
  if (kind === null || savedMm === null) return null;
  const matches = candidates.filter((c) => {
    if (c.stock !== undefined && c.stock <= 0) return false;
    if (c.fitMinMm !== null && c.fitMaxMm !== null) return c.fitMinMm <= savedMm && savedMm <= c.fitMaxMm;
    return labelToMm(kind, c.label) === savedMm;
  });
  return matches.length === 1 ? matches[0]! : null;
}

/** A saved measure as the collector reads it: a ring size ('52'), or centimetres ('16.5 CM'). */
export function sizeWords(kind: SizeKind, mm: number): string {
  return SIZE_RANGES[kind].unit === 'FR' ? String(mm) : `${mm / 10} CM`;
}

// ── Reads (the room, the salon, an order) ──────────────────────────────────

/** A model's size kind: its own, or, a variant without one, its main model's; null for none (or an unknown model). */
export async function sizeKindOf(db: Db, modelId: string): Promise<SizeKind | null> {
  const m = await db
    .selectFrom('models as m')
    .leftJoin('models as main', 'main.id', 'm.variant_of')
    .select(['m.size_kind', 'main.size_kind as main_kind'])
    .where('m.id', '=', modelId)
    .executeTakeFirst();
  return m ? (m.size_kind ?? m.main_kind ?? null) : null;
}

/** An account's saved measure of a kind, in whole millimetres; null when none is saved. */
export async function savedMm(db: Db, accountId: string, kind: SizeKind): Promise<number | null> {
  const r = await db.selectFrom('account_sizes').select('value_mm').where('account_id', '=', accountId).where('kind', '=', kind).executeTakeFirst();
  return r?.value_mm ?? null;
}

/**
 * The size an account's saved size preselects for a model among `candidates` (its sizes): null without a kind, a saved
 * size of it, or exactly one match. Reads only.
 */
export async function savedSizeAmong<C extends SizeCandidate>(db: Db, accountId: string, modelId: string, candidates: readonly C[]): Promise<C | null> {
  if (candidates.length === 0) return null;
  const kind = await sizeKindOf(db, modelId);
  if (kind === null) return null;
  return matchSavedSize(kind, await savedMm(db, accountId, kind), candidates);
}

/**
 * A hint for Client Services choosing a size for an account (a GIFT order's Choose size): the label of the model's size
 * the saved size matches, or else the saved measure in words; null without a kind or a saved size. It never chooses.
 */
export async function savedSizeHint(db: Db, accountId: string, modelId: string): Promise<string | null> {
  const kind = await sizeKindOf(db, modelId);
  if (kind === null) return null;
  const mm = await savedMm(db, accountId, kind);
  if (mm === null) return null;
  return matchSavedSize(kind, mm, await modelSizeCandidates(db, modelId, { offered: true }))?.label ?? sizeWords(kind, mm);
}

/**
 * A model's sizes from its SKUs (ONE SIZE left out), with their fit, in the order a client reads them; `offered`: its
 * offered sizes only (plan NEXT LOT §3.3: the salon and a gift's hint).
 */
export async function modelSizeCandidates(db: Db, modelId: string, opts: { offered?: boolean } = {}): Promise<(SizeCandidate & { code: string })[]> {
  let q = db.selectFrom('skus').select(['id', 'size_label', 'code', 'fit_min_mm', 'fit_max_mm']).where('model_id', '=', modelId).where('size_label', 'is not', null);
  if (opts.offered) q = q.where('set_aside_at', 'is', null);
  const rows = await q.execute();
  return rows
    .map((r) => ({ id: r.id, label: r.size_label!, code: r.code, fitMinMm: r.fit_min_mm, fitMaxMm: r.fit_max_mm }))
    .sort((a, b) => compareSizes(a.label, b.label));
}

/** A saved size in the account's export (the right of access): its kind, its value in the collector's units, when saved. */
export interface ExportedSize {
  kind: SizeKind;
  value: number;
  /** FR: a French ring size; CM: centimetres. */
  unit: 'FR' | 'CM';
  updatedAt: Date;
}

/** Every size the account saved, in the order ring, bracelet, wrist, necklace (OwnerService.exportData). */
export async function exportedSizes(db: Db, accountId: string): Promise<ExportedSize[]> {
  const rows = await db.selectFrom('account_sizes').select(['kind', 'value_mm', 'updated_at']).where('account_id', '=', accountId).execute();
  return rows
    .sort((a, b) => SIZE_KINDS.indexOf(a.kind) - SIZE_KINDS.indexOf(b.kind))
    .map((r) => ({ kind: r.kind, value: fromMm(r.kind, r.value_mm), unit: SIZE_RANGES[r.kind].unit, updatedAt: r.updated_at }));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface SizeServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

function knownAccount(accountId: string): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

export class SizeService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: SizeServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** The account's sizes (GET /api/v1/account/sizes), in the collector's units; null where none is saved. */
  async get(accountId: string): Promise<AccountSizes> {
    const id = knownAccount(accountId);
    const rows = await this.db.selectFrom('account_sizes').select(['kind', 'value_mm']).where('account_id', '=', id).execute();
    const out = Object.fromEntries(SIZE_KINDS.map((k) => [k, null])) as AccountSizes;
    for (const r of rows) out[r.kind] = fromMm(r.kind, r.value_mm);
    return out;
  }

  /**
   * Save the account's sizes whole (PUT /api/v1/account/sizes): each kind given a value saved, each kind null or left
   * out cleared. Audited `account.sizes.update` with the kinds set (new or changed) and cleared, never the measures;
   * nothing changed, nothing audited.
   */
  async set(accountId: string, input: unknown, actor: Actor): Promise<AccountSizes> {
    const id = knownAccount(accountId);
    const next = parseSizesInput(input);
    await inTransaction(this.db, async (tx) => {
      const a = await tx.selectFrom('accounts').select('status').where('id', '=', id).forShare().executeTakeFirst();
      if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (a.status !== 'ACTIVE') throw forbidden('This account cannot save its sizes.');
      const before = new Map((await tx.selectFrom('account_sizes').select(['kind', 'value_mm']).where('account_id', '=', id).forUpdate().execute()).map((r) => [r.kind, r.value_mm]));
      const set = SIZE_KINDS.filter((k) => next.has(k) && before.get(k) !== next.get(k));
      const cleared = SIZE_KINDS.filter((k) => !next.has(k) && before.has(k));
      if (set.length === 0 && cleared.length === 0) return;
      const now = this.clock();
      for (const kind of set) {
        await tx
          .insertInto('account_sizes')
          .values({ account_id: id, kind, value_mm: next.get(kind)!, updated_at: now })
          .onConflict((oc) => oc.columns(['account_id', 'kind']).doUpdateSet({ value_mm: next.get(kind)!, updated_at: now }))
          .execute();
      }
      if (cleared.length > 0) await tx.deleteFrom('account_sizes').where('account_id', '=', id).where('kind', 'in', cleared).execute();
      await this.audit.record({ actor, action: 'account.sizes.update', targetType: 'account', targetId: id, details: { set: [...set], cleared: [...cleared] } }, tx);
    });
    return this.get(id);
  }

  /** The size the account's saved size preselects for a model among its sizes (see savedSizeAmong). */
  savedSizeFor<C extends SizeCandidate>(accountId: string, modelId: string, candidates: readonly C[]): Promise<C | null> {
    return savedSizeAmong(this.db, knownAccount(accountId), modelId, candidates);
  }

  // ── The console (a model's Sizes) ────────────────────────────────────────

  /**
   * A model's Sizes section (GET /api/admin/models/:id/sizes, AUDITOR): its size type and kind, what a variant without
   * either reads, its type's list, its declared sizes and how many are offered and set aside.
   */
  async modelSizes(modelId: string): Promise<ModelSizes> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
    const id = modelId.toLowerCase();
    const m = await this.db
      .selectFrom('models as m')
      .leftJoin('models as main', 'main.id', 'm.variant_of')
      .select(['m.id', 'm.size_type', 'm.size_kind', 'main.size_kind as main_kind', 'main.name as main_name'])
      .where('m.id', '=', id)
      .executeTakeFirst();
    if (!m) throw modelNotFound();
    const sizes = await declaredSizes(this.db, id);
    const setAside = sizes.filter((z) => z.setAsideAt !== null).length;
    return {
      modelId: m.id,
      sizeType: m.size_type,
      sizeKind: m.size_kind,
      inherited: m.size_type === null && m.size_kind === null && m.main_kind !== null && m.main_kind !== undefined ? { sizeKind: m.main_kind, from: m.main_name! } : null,
      list: standardSizes(m.size_type),
      sizes,
      offered: sizes.length - setAside,
      setAside,
    };
  }

  /**
   * A model's size kind and its sizes' fits (PUT /api/admin/models/:id/sizes, OPERATOR): `sizeKind` when given (null:
   * none), and each fit given (a SKU of this model: 404 SKU_NOT_FOUND otherwise; both or neither, 1 to 1 000 mm, the first
   * at most the second). Audited `model.sizes.update` with the kind before and after and the SKUs changed. The kind is
   * set this way only on a model with no size type (409 SIZE_TYPE_GIVEN: a type derives it); the fits on any.
   */
  async setModelSizes(
    modelId: string,
    input: { sizeKind?: SizeKind | null; fits?: readonly { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[] },
    actor: Actor,
  ): Promise<ModelSizes> {
    const id = this.knownWrite(modelId, actor);
    if (input.sizeKind !== undefined && input.sizeKind !== null && !(SIZE_KINDS as readonly string[]).includes(input.sizeKind)) throw validationError('Unknown size type.');
    const fits = cleanFits(input.fits);
    await inTransaction(this.db, async (tx) => {
      const m = await this.lockModel(tx, id);
      if (input.sizeKind !== undefined && m.size_type !== null) throw sizeTypeGiven();
      await this.writeKindAndFits(tx, m, input.sizeKind, fits, actor);
    });
    return this.modelSizes(id);
  }

  /**
   * PUT /api/admin/models/:id/sizes (OPERATOR): a size type or the sizes ticked (`declare`, with the fits in the same
   * transaction), otherwise next-nine's size kind (a model with no type only) and the fits (`setModelSizes`). A size kind
   * with a size type or the sizes ticked: 400.
   */
  async change(
    modelId: string,
    input: { sizeType?: SizeType; sizeKind?: SizeKind | null; ticked?: readonly string[]; fits?: readonly { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[] },
    actor: Actor,
  ): Promise<ModelSizes> {
    if ((input.sizeType !== undefined || input.ticked !== undefined) && input.sizeKind !== undefined) throw validationError('Give a size type or a size kind, not both.');
    if (input.sizeType !== undefined || input.ticked !== undefined) {
      return this.declare(modelId, { ...(input.sizeType !== undefined ? { sizeType: input.sizeType } : {}), ...(input.ticked !== undefined ? { ticked: input.ticked } : {}), ...(input.fits !== undefined ? { fits: input.fits } : {}) }, actor);
    }
    return this.setModelSizes(modelId, { ...(input.sizeKind !== undefined ? { sizeKind: input.sizeKind } : {}), ...(input.fits !== undefined ? { fits: input.fits } : {}) }, actor);
  }

  /**
   * Declare a model's sizes (PUT /api/admin/models/:id/sizes with `sizeType` or `ticked`, OPERATOR; plan NEXT LOT §3.3).
   *
   *  - `sizeType`: the model's type, and its kind with it (SIZE_TYPE_KIND); never cleared, only changed, and never
   *    removing a size by itself. A watch or a model of one size declares ONE SIZE (or reinstates it).
   *  - `ticked` (a ring, a bracelet, a necklace only: 409 SIZE_TYPE_REQUIRED otherwise): the list's sizes the model is
   *    made in (400 off the list). A ticked size that no SKU reads as is created (`ensureSku`); one a set-aside SKU reads as
   *    is reinstated. A list size not ticked: every offered SKU that reads as it is removed when nothing uses it, otherwise
   *    set aside. At least one offered size remains, counting those off the list (400 'Leave at least one size offered.').
   *  - `fits`: each size's fit, as setModelSizes (audited `model.sizes.update`).
   *
   * In one transaction: the model FOR NO KEY UPDATE, then each SKU it may remove or set aside FOR UPDATE in id order,
   * then the audit last, `model.sizes.declare` with the type before and after and the SKU codes added, reinstated, set
   * aside and removed. Nothing changed: nothing written, 400 'Nothing has changed.'
   */
  async declare(
    modelId: string,
    input: { sizeType?: SizeType; ticked?: readonly string[]; fits?: readonly { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[] },
    actor: Actor,
  ): Promise<ModelSizes> {
    const id = this.knownWrite(modelId, actor);
    if (input.sizeType !== undefined && !(SIZE_TYPES as readonly string[]).includes(input.sizeType)) throw validationError('Unknown size type.');
    const fits = cleanFits(input.fits);
    await inTransaction(this.db, async (tx) => {
      const m = await this.lockModel(tx, id);
      const type = input.sizeType ?? m.size_type;
      const changes: DeclaredChanges = { added: [], reinstated: [], setAside: [], removed: [] };
      let ticked: string[] | undefined;
      if (input.ticked !== undefined) {
        if (listedKind(type) === null) throw sizeTypeRequired();
        const list = standardSizes(type);
        ticked = [...new Set(input.ticked.map((t) => (typeof t === 'string' ? t.trim() : '')))];
        const off = ticked.find((t) => !list.includes(t));
        if (off !== undefined) throw validationError(`Size ${off || '(empty)'} is not on the ${SIZE_TYPE_WORDS[type!]} list.`);
      }
      const typeChanged = input.sizeType !== undefined && input.sizeType !== m.size_type;
      if (typeChanged) await tx.updateTable('models').set({ size_type: type, size_kind: SIZE_TYPE_KIND[type!] }).where('id', '=', id).execute();
      const rows = await skuRows(tx, id);
      // A watch or a model of one size: its one size declared, or reinstated.
      if (input.sizeType !== undefined && listedKind(type) === null) {
        const one = rows.find((r) => r.size_label === null);
        if (!one) changes.added.push(await this.created(tx, id, null));
        else if (one.set_aside_at !== null) changes.reinstated.push(await this.reinstated(tx, one.id));
      }
      if (ticked !== undefined) {
        const entry = new Map(rows.map((r) => [r.id, listEntryOf(type, r.size_label)]));
        const own = (r: SkuRow) => entry.get(r.id) === r.size_label;
        for (const t of standardSizes(type).filter((x) => ticked!.includes(x))) {
          const reading = rows.filter((r) => entry.get(r.id) === t);
          if (reading.length === 0) changes.added.push(await this.created(tx, id, t));
          else if (reading.every((r) => r.set_aside_at !== null)) changes.reinstated.push(await this.reinstated(tx, [...reading].sort((a, b) => Number(own(b)) - Number(own(a)))[0]!.id));
        }
        const unticked = rows.filter((r) => r.set_aside_at === null && entry.get(r.id) !== null && !ticked!.includes(entry.get(r.id)!));
        await this.takeOff(tx, unticked, actor, changes);
        const left = await tx.selectFrom('skus').select((eb) => eb.fn.countAll<number>().as('n')).where('model_id', '=', id).where('set_aside_at', 'is', null).executeTakeFirstOrThrow();
        if (Number(left.n) === 0) throw validationError('Leave at least one size offered.');
      }
      const declared = typeChanged || changes.added.length + changes.reinstated.length + changes.setAside.length + changes.removed.length > 0;
      if (!declared && fits.length === 0) throw nothingChanged();
      if (fits.length > 0) await this.writeKindAndFits(tx, { id, size_kind: typeChanged ? SIZE_TYPE_KIND[type!] : m.size_kind }, undefined, fits, actor);
      if (declared) {
        await this.audit.record(
          {
            actor,
            action: 'model.sizes.declare',
            targetType: 'model',
            targetId: id,
            details: { ...(typeChanged ? { sizeType: { before: m.size_type, after: type } } : {}), ...changes },
          },
          tx,
        );
      }
    });
    return this.modelSizes(id);
  }

  /**
   * Take one size off a model (POST /api/admin/models/:id/sizes/:skuId/remove, OPERATOR): removed (its SKU deleted) when
   * nothing uses it, otherwise set aside. The last offered size stays (409 SIZE_LAST_OFFERED); a SKU of another model is
   * 404 SKU_NOT_FOUND; a size already set aside that something still uses changes nothing (400). Audited
   * `model.sizes.declare` with its code in `removed` or `setAside`.
   */
  async removeSize(modelId: string, skuId: string, actor: Actor): Promise<{ outcome: 'REMOVED' | 'SET_ASIDE' }> {
    const id = this.knownWrite(modelId, actor);
    const sku = knownSku(skuId);
    return inTransaction(this.db, async (tx) => {
      await this.lockModel(tx, id);
      const row = await tx.selectFrom('skus').select(['id', 'size_label', 'code', 'set_aside_at']).where('id', '=', sku).where('model_id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw skuNotFound();
      if (row.set_aside_at === null) {
        const offered = await tx.selectFrom('skus').select((eb) => eb.fn.countAll<number>().as('n')).where('model_id', '=', id).where('set_aside_at', 'is', null).executeTakeFirstOrThrow();
        if (Number(offered.n) <= 1) throw lastOffered();
      } else if (await skuUsed(tx, row.id)) {
        throw nothingChanged();
      }
      const changes: DeclaredChanges = { added: [], reinstated: [], setAside: [], removed: [] };
      await this.takeOff(tx, [row], actor, changes);
      await this.audit.record({ actor, action: 'model.sizes.declare', targetType: 'model', targetId: id, details: { ...changes } }, tx);
      return { outcome: changes.removed.length > 0 ? 'REMOVED' : 'SET_ASIDE' };
    });
  }

  /**
   * Offer a set-aside size again (POST /api/admin/models/:id/sizes/:skuId/reinstate, OPERATOR); a size off its type's
   * list too (it was declared). Already offered: 400 'Nothing has changed.' Audited `model.sizes.declare` `{reinstated}`.
   */
  async reinstateSize(modelId: string, skuId: string, actor: Actor): Promise<ModelSizes> {
    const id = this.knownWrite(modelId, actor);
    const sku = knownSku(skuId);
    await inTransaction(this.db, async (tx) => {
      await this.lockModel(tx, id);
      const row = await tx.selectFrom('skus').select(['id', 'set_aside_at']).where('id', '=', sku).where('model_id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw skuNotFound();
      if (row.set_aside_at === null) throw nothingChanged();
      const changes: DeclaredChanges = { added: [], reinstated: [await this.reinstated(tx, row.id)], setAside: [], removed: [] };
      await this.audit.record({ actor, action: 'model.sizes.declare', targetType: 'model', targetId: id, details: { ...changes } }, tx);
    });
    return this.modelSizes(id);
  }

  /**
   * A write's model id, checked: by an admin (the console), or by a script (the system: the demo seed, set_aside_by
   * then null); never by an account.
   */
  private knownWrite(modelId: string, actor: Actor): string {
    if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only an ORBES admin can change a model’s sizes.');
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
    return modelId.toLowerCase();
  }

  /**
   * The model's row FOR NO KEY UPDATE: two size writes on one model queue here, but an order or a piece inserted for it
   * (whose foreign key takes KEY SHARE) does not wait (a FOR UPDATE would deadlock against offeredSku's KEY SHARE).
   */
  private async lockModel(tx: Db, id: string): Promise<{ id: string; size_kind: SizeKind | null; size_type: SizeType | null }> {
    const m = await tx.selectFrom('models').select(['id', 'size_kind', 'size_type']).where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
    if (!m) throw modelNotFound();
    return m;
  }

  /** The kind (a model with no type) and the fits written, audited `model.sizes.update` when either changed or was given. */
  private async writeKindAndFits(
    tx: Db,
    m: { id: string; size_kind: SizeKind | null },
    sizeKind: SizeKind | null | undefined,
    fits: readonly { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[],
    actor: Actor,
  ): Promise<void> {
    if (fits.length > 0) {
      const own = await tx.selectFrom('skus').select('id').where('model_id', '=', m.id).where('id', 'in', fits.map((f) => f.skuId)).execute();
      if (own.length !== fits.length) throw skuNotFound();
    }
    const kindChanged = sizeKind !== undefined && sizeKind !== m.size_kind;
    if (kindChanged) await tx.updateTable('models').set({ size_kind: sizeKind ?? null }).where('id', '=', m.id).execute();
    for (const f of fits) await tx.updateTable('skus').set({ fit_min_mm: f.fitMinMm, fit_max_mm: f.fitMaxMm }).where('id', '=', f.skuId).execute();
    if (!kindChanged && fits.length === 0) return;
    await this.audit.record(
      {
        actor,
        action: 'model.sizes.update',
        targetType: 'model',
        targetId: m.id,
        details: { ...(kindChanged ? { sizeKind: { before: m.size_kind, after: sizeKind ?? null } } : {}), skus: fits.map((f) => f.skuId) },
      },
      tx,
    );
  }

  /** A size declared: its SKU created (`ensureSku`: the prefix and the size, `-2` on a code collision); its code. */
  private async created(tx: Db, modelId: string, label: string | null): Promise<string> {
    const skuId = await ensureSku(tx, modelId, label);
    return (await tx.selectFrom('skus').select('code').where('id', '=', skuId).executeTakeFirstOrThrow()).code;
  }

  /** A set-aside size offered again; its code. */
  private async reinstated(tx: Db, skuId: string): Promise<string> {
    const r = await tx.updateTable('skus').set({ set_aside_at: null, set_aside_by: null }).where('id', '=', skuId).returning('code').executeTakeFirstOrThrow();
    return r.code;
  }

  /**
   * Sizes taken off a model: each SKU locked FOR UPDATE in id order, then deleted when nothing uses it, otherwise set
   * aside (its time and admin), its code noted in `changes`.
   */
  private async takeOff(tx: Db, rows: readonly { id: string }[], actor: Actor, changes: DeclaredChanges): Promise<void> {
    const ids = [...new Set(rows.map((r) => r.id))].sort();
    const now = this.clock();
    for (const skuId of ids) {
      const row = await tx.selectFrom('skus').select(['id', 'code', 'set_aside_at']).where('id', '=', skuId).forUpdate().executeTakeFirst();
      if (!row) continue;
      if (await skuUsed(tx, row.id)) {
        if (row.set_aside_at !== null) continue;
        await tx.updateTable('skus').set({ set_aside_at: now, set_aside_by: adminIdOf(actor) }).where('id', '=', row.id).execute();
        changes.setAside.push(row.code);
      } else {
        await tx.deleteFrom('skus').where('id', '=', row.id).execute();
        changes.removed.push(row.code);
      }
    }
  }
}

/** What a declaration changed, by SKU code (a removed SKU's id no longer exists). */
interface DeclaredChanges {
  added: string[];
  reinstated: string[];
  setAside: string[];
  removed: string[];
}

/** A SKU id from the console, checked (404 SKU_NOT_FOUND). */
function knownSku(skuId: string): string {
  if (typeof skuId !== 'string' || !UUID_RE.test(skuId)) throw notFound('SKU', 'SKU_NOT_FOUND');
  return skuId.toLowerCase();
}

/** The admin behind a console write, for set_aside_by; null for a script. */
function adminIdOf(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

/** Each fit given: a SKU id, both bounds or neither, 1 to 1 000 mm, the first at most the second; each size once. */
function cleanFits(input: readonly { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[] | undefined) {
  const fits = (input ?? []).map((f) => {
    if (typeof f.skuId !== 'string' || !UUID_RE.test(f.skuId)) throw notFound('SKU', 'SKU_NOT_FOUND');
    const both = f.fitMinMm !== null && f.fitMaxMm !== null;
    if (!both && (f.fitMinMm !== null || f.fitMaxMm !== null)) throw validationError('Give Fits from and Fits to, or neither.');
    if (both) {
      for (const v of [f.fitMinMm!, f.fitMaxMm!]) {
        if (!Number.isInteger(v) || v < FIT_RANGE_MM.min || v > FIT_RANGE_MM.max) throw validationError('A fit is 1 to 1 000 mm.');
      }
      if (f.fitMinMm! > f.fitMaxMm!) throw validationError('Fits from is at most Fits to.');
    }
    return { skuId: f.skuId.toLowerCase(), fitMinMm: f.fitMinMm, fitMaxMm: f.fitMaxMm };
  });
  if (new Set(fits.map((f) => f.skuId)).size !== fits.length) throw validationError('Each size once.');
  return fits;
}
