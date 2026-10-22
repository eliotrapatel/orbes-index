/**
 * THE SET's catalogue (macro scope of 2026-10-20, K44 T1; lot M3 plan §5.1 and §5.2, step M3.14; migration 0057): staff
 * group 2 to 4 models into a set with one price, sold as its own release (a draw or a LIVE RELEASE, services/drops.ts
 * from M3.15, services/live-console.ts from M3.16), one entry and one price, each piece's size chosen at entry; each set
 * sold is a set sale with one order per piece (services/set-sales.ts).
 *
 *   a set        its name (1 to 60 characters, one line, unique whatever the case: 409 SET_NAME_TAKEN), its code (its
 *                reference and its future Shopify handle, S5: 2 to 40 capitals, digits and hyphens, a capital or a digit
 *                first, kept in capitals: 409 SET_CODE_TAKEN), its base price and currency (both or neither, as a
 *                model's: 0.01 to 1 000 000.00 in a house currency; a release carries its own price), `active`.
 *   its pieces   2 to 4 models in order (positions 1 to n), each a main model or a variant, each once, each active and
 *                sized (its size type declared and at least one size offered: a set's release gives its sizes per piece
 *                from them): 422 SET_MODELS otherwise, naming what is wrong (404 MODEL_NOT_FOUND for an unknown one).
 *                Frozen once a release names the set (409 SET_IN_USE): a set's releases, its set sales and its orders
 *                keep reading the pieces they were made with.
 *   set aside    `setAside` (active false): no new release of it; its releases, set sales and history kept;
 *                `reinstate` offers it again. Never deleted.
 *   Shopify      (S5) one Shopify product per set (`sets.shopify_product_id`, once), its code the handle; `setShopify`
 *                keeps the id pasted back, under the product's advisory lock (the one a model's and an add-on's link
 *                take): 409 SHOPIFY_PRODUCT_TAKEN when a model, an add-on or another set has that product. The product
 *                export lists each active set priced in the store's currency (services/shopify.ts).
 *   its releases each release that names it (Catalogue → Sets; a set's release is never listed under one of its
 *                models, services/release-offer.ts), the newest opening first.
 *
 * OPERATOR writes (as the models and the add-ons), AUDITOR reads (routes/admin/sets.ts). Audited `set.create`,
 * `set.update` (each field before and after, the pieces as their model ids), `set.set_aside`, `set.reinstate`,
 * `set.shopify` (the id before and after); a change that changes nothing writes nothing. Nothing here is read by a
 * collector: a set reaches the collector through its releases.
 */
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { SET_CODE_PATTERN, SET_NAME_MAX, SET_PIECES_MAX, SET_PIECES_MIN, type DropMode, type JsonObject } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { normalizeBasePrice } from './catalog.js';
import { setPieces, type OfferModel } from './release-offer.js';
import { lockKeyOf, shopifyIdOf, shopifyProductTaken } from './shopify.js';
import { compareSizes } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

export const SET_LIMITS = Object.freeze({ name: SET_NAME_MAX, code: 40, piecesMin: SET_PIECES_MIN, piecesMax: SET_PIECES_MAX });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// ── Errors ─────────────────────────────────────────────────────────────────

export const setNotFound = () => notFound('Set', 'SET_NOT_FOUND');
const setNameTaken = () => conflict('SET_NAME_TAKEN', 'Another set has this name.');
const setCodeTaken = () => conflict('SET_CODE_TAKEN', 'Another set has this code.');
/** 422 SET_MODELS: the pieces are not 2 to 4 distinct models, active and sized; `detail` says which. */
export const setModels = (detail: string) => new DomainError('SET_MODELS', 422, `A set groups ${SET_PIECES_MIN} to ${SET_PIECES_MAX} different models, each active with its sizes declared. ${detail}`);
export const setInUse = () => conflict('SET_IN_USE', 'A release already names this set: its pieces no longer change.');

// ── Views ──────────────────────────────────────────────────────────────────

/** A piece of a set as Catalogue → Sets reads it: its position, its model and the sizes it offers. */
export interface SetPieceView {
  position: number;
  model: Pick<OfferModel, 'id' | 'name' | 'variant' | 'variantOf' | 'type' | 'active' | 'sizeType' | 'imageUrl'>;
  /** The model's offered sizes (its SKUs not set aside), in a client's order; ONE SIZE as null. */
  sizes: { skuId: string; label: string | null }[];
  /** The model's base price (a variant's own, else its main model's), or null: the set's price is shared by them (§15 note 11). */
  basePrice: { priceMinor: number; currency: string } | null;
}

/** A release that names the set. */
export interface SetRelease {
  id: string;
  mode: DropMode;
  title: string;
  opensAt: Date;
  publishedAt: Date | null;
  cancelledAt: Date | null;
}

/** A set as Catalogue → Sets reads it (AUDITOR and above). */
export interface SetView {
  id: string;
  name: string;
  code: string;
  basePriceMinor: number | null;
  baseCurrency: string | null;
  active: boolean;
  shopifyProductId: string | null;
  pieces: SetPieceView[];
  /** The releases that name it, the newest opening first: once there is one, its pieces are frozen. */
  releases: SetRelease[];
  createdAt: Date;
  updatedAt: Date;
}

/** What a set is created with, or changed with (`undefined` leaves a field). */
export interface SetInput {
  name?: string;
  code?: string;
  /** Its pieces in order: 2 to 4 model ids. */
  modelIds?: string[];
  /** Its base price with its currency, both or neither (null for both clears it). */
  basePriceMinor?: number | null;
  baseCurrency?: string | null;
}

export interface SetCreateInput extends SetInput {
  name: string;
  code: string;
  modelIds: string[];
}

// ── Checking ───────────────────────────────────────────────────────────────

function oneLine(v: unknown, max: number, label: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError(`${label} is required.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if ([...s].length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

/** A set's code as staff type it: trimmed, in capitals (SET_CODE_PATTERN). */
export function cleanSetCode(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError('The code is required.');
  const code = v.trim().toUpperCase();
  if (!SET_CODE_PATTERN.test(code)) throw validationError('The code is 2 to 40 capitals, digits and hyphens, starting with a capital or a digit.');
  return code;
}

function knownId(v: unknown, missing: () => Error): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw missing();
  return v.toLowerCase();
}

/** The pieces' model ids: 2 to 4, each a model id once (422 SET_MODELS otherwise). */
function cleanModelIds(v: unknown): string[] {
  if (!Array.isArray(v)) throw setModels('Choose its pieces in order.');
  if (v.length < SET_PIECES_MIN || v.length > SET_PIECES_MAX) throw setModels(`It has ${v.length} ${v.length === 1 ? 'piece' : 'pieces'}.`);
  const ids = v.map((x) => knownId(x, () => notFound('Model', 'MODEL_NOT_FOUND')));
  if (new Set(ids).size !== ids.length) throw setModels('A model is chosen twice.');
  return ids;
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only ORBES staff can change the sets.');
}

const adminIdOf = (actor: Actor): string | null => (actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null);

/**
 * Each model of `ids` exists (404 MODEL_NOT_FOUND), is active and sized (its size type declared and one size offered at
 * least), else 422 SET_MODELS naming it; read FOR KEY SHARE in the caller's transaction.
 */
async function assertPieces(tx: Db, ids: readonly string[]): Promise<void> {
  const models = await tx.selectFrom('models').select(['id', 'name', 'variant_label', 'active', 'size_type']).where('id', 'in', [...ids]).forKeyShare().execute();
  const offered = new Set(
    (await tx.selectFrom('skus').select('model_id').where('model_id', 'in', [...ids]).where('set_aside_at', 'is', null).execute()).map((k) => k.model_id),
  );
  for (const id of ids) {
    const m = models.find((x) => x.id === id);
    if (!m) throw notFound('Model', 'MODEL_NOT_FOUND');
    const named = m.variant_label ? `${m.name} in ${m.variant_label}` : m.name;
    if (!m.active) throw setModels(`${named} is not active.`);
    if (m.size_type === null || !offered.has(m.id)) throw setModels(`${named} has no size declared: declare its sizes in the Catalogue.`);
  }
}

// ── The service ────────────────────────────────────────────────────────────

export interface SetServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class SetService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: SetServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** Every set: the active ones first, then by name (GET /api/admin/sets, AUDITOR). */
  list(): Promise<SetView[]> {
    return this.rows();
  }

  /** One set with its pieces, their sizes and photographs, and its releases (404 SET_NOT_FOUND). */
  async get(setId: string): Promise<SetView> {
    const row = (await this.rows(knownId(setId, setNotFound)))[0];
    if (!row) throw setNotFound();
    return row;
  }

  /**
   * A set made (POST /api/admin/sets, OPERATOR): its name and code free (409 SET_NAME_TAKEN, SET_CODE_TAKEN), its pieces
   * 2 to 4 different models, active and sized (422 SET_MODELS), its base price with its currency or none. Audited
   * `set.create` with its name, code, pieces and price.
   */
  async create(input: SetCreateInput, actor: Actor): Promise<SetView> {
    assertStaff(actor);
    const name = oneLine(input?.name, SET_NAME_MAX, 'The name');
    const code = cleanSetCode(input?.code);
    const modelIds = cleanModelIds(input?.modelIds);
    const price = input?.basePriceMinor === undefined && input?.baseCurrency === undefined ? null : normalizeBasePrice(input.basePriceMinor, input.baseCurrency);
    const id = await this.taken(() =>
      inTransaction(this.db, async (tx) => {
        await assertPieces(tx, modelIds);
        const now = this.clock();
        const row = await tx
          .insertInto('sets')
          .values({ name, code, base_price_minor: price?.minor ?? null, base_currency: price?.currency ?? null, created_by: adminIdOf(actor), created_at: now, updated_at: now })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tx.insertInto('set_models').values(modelIds.map((model_id, i) => ({ set_id: row.id, position: i + 1, model_id }))).execute();
        const details: JsonObject = { name, code, modelIds, basePriceMinor: price?.minor ?? null, baseCurrency: price?.currency ?? null };
        await this.audit.record({ actor, action: 'set.create', targetType: 'set', targetId: row.id, details }, tx);
        return row.id;
      }),
    );
    return this.get(id);
  }

  /**
   * A set changed (PATCH /api/admin/sets/:id, OPERATOR), under its row lock: its name, code and base price; its pieces
   * only while no release names it (409 SET_IN_USE), checked as at its creation. A release keeps its own price. Audited
   * `set.update` with each field changed, before and after; nothing changed, nothing written.
   */
  async update(setId: string, input: SetInput, actor: Actor): Promise<SetView> {
    assertStaff(actor);
    const id = knownId(setId, setNotFound);
    const i = input ?? {};
    const name = i.name === undefined ? undefined : oneLine(i.name, SET_NAME_MAX, 'The name');
    const code = i.code === undefined ? undefined : cleanSetCode(i.code);
    const modelIds = i.modelIds === undefined ? undefined : cleanModelIds(i.modelIds);
    const pricing = i.basePriceMinor !== undefined || i.baseCurrency !== undefined;
    const price = pricing ? normalizeBasePrice(i.basePriceMinor, i.baseCurrency) : undefined;
    if (name === undefined && code === undefined && modelIds === undefined && !pricing) throw validationError('Nothing to change.');
    await this.taken(() =>
      inTransaction(this.db, async (tx) => {
        const before = await tx.selectFrom('sets').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!before) throw setNotFound();
        const was = (await tx.selectFrom('set_models').select('model_id').where('set_id', '=', id).orderBy('position').execute()).map((m) => m.model_id);
        const details: JsonObject = {};
        const set: { name?: string; code?: string; base_price_minor?: number | null; base_currency?: string | null } = {};
        if (name !== undefined && name !== before.name) {
          set.name = name;
          details.name = { from: before.name, to: name };
        }
        if (code !== undefined && code !== before.code) {
          set.code = code;
          details.code = { from: before.code, to: code };
        }
        if (price !== undefined && ((price?.minor ?? null) !== before.base_price_minor || (price?.currency ?? null) !== before.base_currency)) {
          set.base_price_minor = price?.minor ?? null;
          set.base_currency = price?.currency ?? null;
          details.basePrice = { from: before.base_price_minor === null ? null : { minor: before.base_price_minor, currency: before.base_currency }, to: price ? { minor: price.minor, currency: price.currency } : null };
        }
        const repiece = modelIds !== undefined && JSON.stringify(modelIds) !== JSON.stringify(was);
        if (repiece) {
          // Frozen once a release names it: its releases, set sales and orders read the pieces they were made with.
          if (await tx.selectFrom('drops').select('id').where('set_id', '=', id).limit(1).executeTakeFirst()) throw setInUse();
          await assertPieces(tx, modelIds!);
          await tx.deleteFrom('set_models').where('set_id', '=', id).execute();
          await tx.insertInto('set_models').values(modelIds!.map((model_id, k) => ({ set_id: id, position: k + 1, model_id }))).execute();
          details.modelIds = { from: was, to: modelIds! };
        }
        if (Object.keys(details).length === 0) return;
        await tx.updateTable('sets').set({ ...set, updated_at: this.clock() }).where('id', '=', id).execute();
        await this.audit.record({ actor, action: 'set.update', targetType: 'set', targetId: id, details }, tx);
      }),
    );
    return this.get(id);
  }

  /** A set set aside (POST /api/admin/sets/:id/set-aside, OPERATOR): no new release of it. Audited `set.set_aside`; one already set aside: nothing written. */
  setAside(setId: string, actor: Actor): Promise<SetView> {
    return this.setActive(setId, false, actor);
  }

  /** A set offered again (POST /api/admin/sets/:id/reinstate, OPERATOR). Audited `set.reinstate`; one active: nothing written. */
  reinstate(setId: string, actor: Actor): Promise<SetView> {
    return this.setActive(setId, true, actor);
  }

  /**
   * The set's Shopify product, pasted back (PUT /api/admin/sets/:id/shopify, OPERATOR; S5): the number or its page's
   * address; null clears it. Under the set's row lock, then the product's advisory lock: 409 SHOPIFY_PRODUCT_TAKEN when a
   * model's SKUs, an add-on or another set has it. Audited `set.shopify` with the id before and after; nothing changed,
   * nothing written.
   */
  async setShopify(setId: string, input: { productId: string | null }, actor: Actor): Promise<SetView> {
    assertStaff(actor);
    const id = knownId(setId, setNotFound);
    if (input === null || typeof input !== 'object') throw validationError('Send the product id.');
    const productId = shopifyIdOf(input.productId, 'products');
    try {
      await inTransaction(this.db, async (tx) => {
        const s = await tx.selectFrom('sets').select(['id', 'shopify_product_id']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!s) throw setNotFound();
        if (s.shopify_product_id === productId) return;
        if (productId !== null) {
          await advisoryXactLock(tx, ADVISORY_LOCK.SHOPIFY_PRODUCT, lockKeyOf(productId));
          const sku = await tx.selectFrom('skus').select('id').where('shopify_product_id', '=', productId).executeTakeFirst();
          const addon = await tx.selectFrom('addon_items').select('id').where('shopify_product_id', '=', productId).executeTakeFirst();
          const other = await tx.selectFrom('sets').select('id').where('shopify_product_id', '=', productId).where('id', '<>', id).executeTakeFirst();
          if (sku || addon || other) throw shopifyProductTaken();
        }
        await tx.updateTable('sets').set({ shopify_product_id: productId, updated_at: this.clock() }).where('id', '=', id).execute();
        await this.audit.record({ actor, action: 'set.shopify', targetType: 'set', targetId: id, details: { product: { from: s.shopify_product_id, to: productId } } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'sets_shopify_product_key')) throw shopifyProductTaken();
      throw e;
    }
    return this.get(id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async setActive(setId: string, active: boolean, actor: Actor): Promise<SetView> {
    assertStaff(actor);
    const id = knownId(setId, setNotFound);
    await inTransaction(this.db, async (tx) => {
      const before = await tx.selectFrom('sets').select(['active', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw setNotFound();
      if (before.active === active) return;
      await tx.updateTable('sets').set({ active, updated_at: this.clock() }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: active ? 'set.reinstate' : 'set.set_aside', targetType: 'set', targetId: id, details: { name: before.name } }, tx);
    });
    return this.get(id);
  }

  /** The sets with their pieces, sizes, base prices and releases; active first, then by name (`id` narrows to one). */
  private async rows(id?: string): Promise<SetView[]> {
    let q = this.db.selectFrom('sets').selectAll();
    if (id !== undefined) q = q.where('id', '=', id);
    const sets = await q.orderBy('active', 'desc').orderBy(sql`lower(name)`).orderBy('id').execute();
    if (sets.length === 0) return [];
    const ids = sets.map((s) => s.id);
    const pieces = new Map<string, Awaited<ReturnType<typeof setPieces>>>();
    for (const s of sets) pieces.set(s.id, await setPieces(this.db, s.id));
    const modelIds = [...new Set([...pieces.values()].flat().map((p) => p.model.id))];
    const skus = modelIds.length ? await this.db.selectFrom('skus').select(['id', 'model_id', 'size_label']).where('model_id', 'in', modelIds).where('set_aside_at', 'is', null).execute() : [];
    const prices = modelIds.length
      ? await this.db
          .selectFrom('models as m')
          .leftJoin('models as main', 'main.id', 'm.variant_of')
          .select(['m.id', 'm.base_price_minor', 'm.base_currency', 'main.base_price_minor as main_price', 'main.base_currency as main_currency'])
          .where('m.id', 'in', modelIds)
          .execute()
      : [];
    const releases = await this.db
      .selectFrom('drops')
      .select(['id', 'set_id', 'mode', 'title', 'opens_at', 'published_at', 'cancelled_at'])
      .where('set_id', 'in', ids)
      .orderBy('opens_at', 'desc')
      .orderBy('id')
      .execute();
    return sets.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      basePriceMinor: s.base_price_minor,
      baseCurrency: s.base_currency,
      active: s.active,
      shopifyProductId: s.shopify_product_id,
      pieces: (pieces.get(s.id) ?? []).map((p) => {
        const price = prices.find((x) => x.id === p.model.id);
        const own = price && price.base_price_minor !== null && price.base_currency !== null;
        const main = price && price.main_price !== null && price.main_currency !== null;
        return {
          position: p.piece!,
          model: { id: p.model.id, name: p.model.name, variant: p.model.variant, variantOf: p.model.variantOf, type: p.model.type, active: p.model.active, sizeType: p.model.sizeType, imageUrl: p.model.imageUrl },
          sizes: skus
            .filter((k) => k.model_id === p.model.id)
            .sort((a, b) => compareSizes(a.size_label, b.size_label))
            .map((k) => ({ skuId: k.id, label: k.size_label })),
          basePrice: own ? { priceMinor: price.base_price_minor!, currency: price.base_currency! } : main ? { priceMinor: price.main_price!, currency: price.main_currency! } : null,
        };
      }),
      releases: releases
        .filter((r) => r.set_id === s.id)
        .map((r) => ({ id: r.id, mode: r.mode, title: r.title, opensAt: r.opens_at, publishedAt: r.published_at, cancelledAt: r.cancelled_at })),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }

  /** A name or a code in use answers 409 SET_NAME_TAKEN or SET_CODE_TAKEN. */
  private async taken<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e, 'sets_name_key')) throw setNameTaken();
      if (isUniqueViolation(e, 'sets_code_key')) throw setCodeTaken();
      throw e;
    }
  }
}
