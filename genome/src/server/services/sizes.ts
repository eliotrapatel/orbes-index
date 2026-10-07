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
 */
import { inTransaction, type Db } from '../db/connection.js';
import { SIZE_KINDS, type SizeKind } from '../db/schema.js';
import { forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { compareSizes } from './stock.js';

export { SIZE_KINDS, type SizeKind };

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

/** A model's size in the console's Sizes section: its SKU, its label and its fit. */
export interface ModelSizeRow {
  skuId: string;
  label: string;
  code: string;
  fitMinMm: number | null;
  fitMaxMm: number | null;
}

/** The console's Sizes section of a model (GET /api/admin/models/:id/sizes). */
export interface ModelSizes {
  modelId: string;
  /** The model's own size kind; null: none. */
  sizeKind: SizeKind | null;
  /** A variant without a kind of its own: its main model's kind and name (« Reads Ring size from MONOLITHE »); else null. */
  inherited: { sizeKind: SizeKind; from: string } | null;
  /** Its sizes (its SKUs of a size, ONE SIZE left out), in the order a client reads them. */
  sizes: ModelSizeRow[];
}

// ── Errors ─────────────────────────────────────────────────────────────────

const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');

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

/** A model's sizes from its SKUs (ONE SIZE left out), with their fit, in the order a client reads them. */
export async function modelSizeCandidates(db: Db, modelId: string): Promise<(SizeCandidate & { code: string })[]> {
  const rows = await db
    .selectFrom('skus')
    .select(['id', 'size_label', 'code', 'fit_min_mm', 'fit_max_mm'])
    .where('model_id', '=', modelId)
    .where('size_label', 'is not', null)
    .execute();
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

  /** A model's Sizes section (GET /api/admin/models/:id/sizes, AUDITOR): its kind, what a variant reads, its sizes. */
  async modelSizes(modelId: string): Promise<ModelSizes> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
    const id = modelId.toLowerCase();
    const m = await this.db
      .selectFrom('models as m')
      .leftJoin('models as main', 'main.id', 'm.variant_of')
      .select(['m.id', 'm.size_kind', 'main.size_kind as main_kind', 'main.name as main_name'])
      .where('m.id', '=', id)
      .executeTakeFirst();
    if (!m) throw modelNotFound();
    const sizes = await modelSizeCandidates(this.db, id);
    return {
      modelId: m.id,
      sizeKind: m.size_kind,
      inherited: m.size_kind === null && m.main_kind !== null && m.main_kind !== undefined ? { sizeKind: m.main_kind, from: m.main_name! } : null,
      sizes: sizes.map((s) => ({ skuId: s.id, label: s.label, code: s.code, fitMinMm: s.fitMinMm, fitMaxMm: s.fitMaxMm })),
    };
  }

  /**
   * A model's size kind and its sizes' fits (PUT /api/admin/models/:id/sizes, OPERATOR): `sizeKind` when given (null:
   * none), and each fit given (a SKU of this model: 404 SKU_NOT_FOUND otherwise; both or neither, 1 to 1 000 mm, the first
   * at most the second). Audited `model.sizes.update` with the kind before and after and the SKUs changed.
   */
  async setModelSizes(
    modelId: string,
    input: { sizeKind?: SizeKind | null; fits?: readonly { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[] },
    actor: Actor,
  ): Promise<ModelSizes> {
    if (actor?.type !== 'admin') throw forbidden('Only an ORBES admin can change a model’s sizes.');
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
    const id = modelId.toLowerCase();
    if (input.sizeKind !== undefined && input.sizeKind !== null && !(SIZE_KINDS as readonly string[]).includes(input.sizeKind)) throw validationError('Unknown size type.');
    const fits = (input.fits ?? []).map((f) => {
      if (typeof f.skuId !== 'string' || !UUID_RE.test(f.skuId)) throw skuNotFound();
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
    await inTransaction(this.db, async (tx) => {
      const m = await tx.selectFrom('models').select(['id', 'size_kind']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!m) throw modelNotFound();
      if (fits.length > 0) {
        const own = await tx.selectFrom('skus').select('id').where('model_id', '=', id).where('id', 'in', fits.map((f) => f.skuId)).execute();
        if (own.length !== fits.length) throw skuNotFound();
      }
      const kindChanged = input.sizeKind !== undefined && input.sizeKind !== m.size_kind;
      if (kindChanged) await tx.updateTable('models').set({ size_kind: input.sizeKind ?? null }).where('id', '=', id).execute();
      for (const f of fits) await tx.updateTable('skus').set({ fit_min_mm: f.fitMinMm, fit_max_mm: f.fitMaxMm }).where('id', '=', f.skuId).execute();
      if (!kindChanged && fits.length === 0) return;
      await this.audit.record(
        {
          actor,
          action: 'model.sizes.update',
          targetType: 'model',
          targetId: id,
          details: { ...(kindChanged ? { sizeKind: { before: m.size_kind, after: input.sizeKind ?? null } } : {}), skus: fits.map((f) => f.skuId) },
        },
        tx,
      );
    });
    return this.modelSizes(id);
  }
}
