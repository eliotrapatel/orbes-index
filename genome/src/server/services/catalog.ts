/**
 * CatalogService — collections and models (the catalogue around categories,
 * which have their own registry because their 5-bit index is permanent).
 *
 * Each write is one transaction with its audit entry. The HTTP layer
 * validates shapes (http/schemas.ts); this service re-checks what it relies
 * on (non-empty bounded names, a known category and collection, the fields a
 * change may touch) so that scripts and seeds calling it directly get the
 * same rules.
 *
 * Edits (A-10): a model's name, default material, care instructions,
 * collection and `active`, and a collection's name, change after issuance.
 * They are read live by every public result of the pieces issued with them
 * (/verify: model, collection, care), so each change is audited with the
 * values before and after and the number of issued pieces it reaches, and a
 * change that changes nothing writes nothing. A model's category and SKU
 * prefix never change: the category letter is in the identity of every piece
 * issued with it and the prefix starts every SKU issued with it (400, and the
 * database refuses them too: `models_immutable_identity`). An inactive model
 * is no longer offered for new products (IssuanceService: 409
 * MODEL_INACTIVE); its pieces verify as before.
 *
 * The lookbook (P-R02, services/lookbook.ts): a model's place in it
 * (`lookbook`: HIDDEN, PUBLIC, RESERVED), the address of its sheet (`slug`,
 * unique: 409 SLUG_TAKEN), its story and its specifications change through
 * the same edit, audited `model.update` (the story as its length and SHA-256,
 * never its words). A model first shown gets `published_at`; from then on its
 * address never changes (409 SLUG_LOCKED: links to the sheet are out), and a
 * model shown always has one. Its gallery is MediaService's.
 *
 * THE PRIVATE SALON (P-X08, migration 0020): a RESERVED model's price as the
 * salon shows it (`priceLabel`, 1 to 60 characters, null: none) and the lowest
 * tier it is shown to (`privateMinTier`, 1 TITANE by default, 2 PLATINE,
 * 3 PALLADIUM) change through the same edit, audited `model.update`.
 *
 * THE SHOPIFY EXPORT AND MY PIECES (plan LIVE RELEASE+, N2 and M6, migration 0022): a model's base price
 * (`basePriceMinor` with its `baseCurrency`, both or neither: the price the Shopify product export gives it; each
 * release keeps its own) and its care guide (`careGuide`, plain text of at most CARE_GUIDE_MAX characters: MY PIECES
 * shows it with each order of the model, before its care instructions) change through the same edit, audited
 * `model.update` (the care guide as its length and SHA-256, like a story). `shopify` says how far the model is linked
 * to its Shopify product (services/shopify.ts: the ids pasted back).
 *
 * VARIANTS (plan NOCTURNE, N1, migration 0024): a model can have variants, like a product's variants in a shop
 * (MONOLITHE in steel, in gold, in blue). A variant IS a model, linked to its main model (`variantOf`); never chained.
 * ADD A VARIANT (`createVariant`, audited `model.variant.create`) creates one from its main model: a model that copies
 * its category, collection, name, type, story, specifications and care (instructions and guide), with its own label,
 * colour (`variantLabel`, `variantSwatch`: one of the model's dots) and SKU prefix, HIDDEN from the lookbook until its
 * photographs are set and it is published like any model; its material, prices and sizes are its own. The main model
 * carries its own label and colour too (its first variant gives them when it has none, audited `model.update`). A label
 * and its colour change through the same edit (`model.update`), together; a variant and a model with variants keep
 * theirs (409 VARIANT_LABEL_REQUIRED), a label is unique within a model and its variants (409 VARIANT_LABEL_TAKEN).
 *
 * PAIRS WELL WITH (plan NEXT-NINE of 2026-10-06, §3.7 BP-34, migration 0031): a main model or a model alone picks the
 * two or three models its sheet ends with (`setPairs`, audited `model.pairs`), in their order, from any collection; a
 * variant's sheet is its main model's, so are its pairs. Its record read alone carries them (`pairs`, each with whether
 * the sheet shows it) and what the sheet shows without them (`pairsFallback`).
 *
 * DISCONTINUED (P-R06, migration 0019): an ADMIN closes a model's edition
 * (`discontinueModel`, audited `model.discontinue`) and may open it again
 * (`reinstateModel`, `model.reinstate`). Discontinuing sets
 * `discontinued_at`, its author, and `active = false` in one transaction, so
 * the issuance's refusal (409 MODEL_INACTIVE) and the generator's filter
 * apply as to any inactive model; reinstating clears both and sets
 * `active = true` again. A discontinued model is never active: an edit that
 * would make it so is refused (409 MODEL_DISCONTINUED; the database's
 * `models_discontinued_inactive` refuses it too). Its year is said
 * « DISCONTINUED · <year> » on the authentic results of its pieces, its
 * lookbook sheet and their ownership certificates.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { LOOKBOOK_STATES, SIZE_TYPES, type LookbookState, type SizeType } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import type { CategoryRegistry } from './categories.js';
import { normalizeMinTier, normalizePriceLabel, normalizeSlug, normalizeSpecs, normalizeStory, pairsFallbackOf, plainText, storyFingerprint } from './lookbook.js';
import { mediaUrl } from './media.js';
import { ORDER_AMOUNT_MAX_MINOR, ORDER_CURRENCIES } from './orders.js';
import { LISTED_SIZE_TYPES, SIZE_TYPE_KIND } from './sizes.js';
import { ensureSku } from './stock.js';

/** A model's care guide, at most (models.care_guide, migration 0022). */
export const CARE_GUIDE_MAX = 8000;
/** A model's base price, at most, in minor units (models.base_price_minor's CHECK; an order's amount's bound). */
export const BASE_PRICE_MAX_MINOR = ORDER_AMOUNT_MAX_MINOR;
/** A variant's label, at most (models.variant_label's CHECK, migration 0024). */
export const VARIANT_LABEL_MAX = 40;
/** A variant's colour as the database keeps it: `#RRGGBB` in capitals. */
export const VARIANT_SWATCH_RE = /^#[0-9A-F]{6}$/;

export interface CatalogServiceDeps {
  db: Db;
  audit: AuditService;
  categories: CategoryRegistry;
  clock?: Clock;
}

export interface CollectionRecord {
  id: string;
  name: string;
  /** Number of models in the collection. */
  models: number;
  /** Issued pieces whose public result names this collection: their own collection, else their model's (product_overview's rule). */
  products: number;
  createdAt: Date;
}

export interface ModelRecord {
  id: string;
  name: string;
  type: string;
  skuPrefix: string;
  category: { index: number; code: string; name: string };
  collection: { id: string; name: string } | null;
  defaultMaterial: string | null;
  careInstructions: string | null;
  /** Offered for new products; an inactive model's pieces verify as before. */
  active: boolean;
  /**
   * The model's reference photograph (F-04, MediaService): `/api/v1/media/<sha256>`, shown above the GENOME on the
   * authentic results of its pieces; null without one. It is the cover of its lookbook sheet.
   */
  imageUrl: string | null;
  /** Pieces issued with this model: a change of its name, care instructions or collection reaches each of their public results. */
  products: number;
  /** Its place in the lookbook (P-R02): HIDDEN, PUBLIC (everyone) or RESERVED (the owners of a piece). */
  lookbook: LookbookState;
  /** The address of its sheet, /verify/lookbook/<slug>; null until named. Fixed once `publishedAt` is set. */
  slug: string | null;
  /** Plain paragraphs, ≤ 4 000 characters. */
  story: string | null;
  /** One `Label: value` line per specification, ≤ 1 000 characters. */
  specs: string | null;
  /** When the model first left HIDDEN; null while it never has. */
  publishedAt: Date | null;
  /** When an ADMIN discontinued it (P-R06): then it is inactive, and said DISCONTINUED with this year; null while it is not. */
  discontinuedAt: Date | null;
  /** P-X08: the price THE PRIVATE SALON shows while the model is RESERVED; null: none. */
  priceLabel: string | null;
  /** P-X08: the lowest tier the model is shown to while it is RESERVED: 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  privateMinTier: number;
  /** The gallery of its sheet (MediaService), in its order, the cover aside. */
  gallery: GalleryImageRecord[];
  /** N2: its base price in minor units, with its currency (both or neither): the Shopify product export's price. */
  basePriceMinor: number | null;
  baseCurrency: string | null;
  /** M6: its care guide, shown in MY PIECES with each order of the model; null: its care instructions stand in. */
  careGuide: string | null;
  /**
   * N2: its Shopify product, once its ids are pasted back: the product id (null: not linked), how many sizes the
   * export gives it as variants (its SKUs, at least one) and how many of them have their variant id.
   */
  shopify: { productId: string | null; variants: number; linked: number };
  /** N1 (migration 0024): the main model this model is a variant of (its id, name and label), or null. */
  variantOf: { id: string; name: string; label: string | null } | null;
  /** N1: its label among its model's dots (« Steel »), and the dot's colour (`#RRGGBB`); null for both on a model alone. */
  variantLabel: string | null;
  variantSwatch: string | null;
  /** N1: a main model's variants, in the order they were added; none for a variant, nor for a model alone. */
  variants: ModelVariantRecord[];
  /** Plan NEXT LOT §3.3: its size type (null: to give), and how many of its declared sizes are offered. */
  sizeType: SizeType | null;
  sizesOffered: number;
  createdAt: Date;
  /**
   * Plan NEXT-NINE, BP-34 (PAIRS WELL WITH), on one model read alone (getModel): the models its sheet ends with, in their
   * order, as picked on its main model (a variant's record carries its main model's, read only); none picked: empty.
   */
  pairs?: ModelPairRecord[];
  /**
   * BP-34: what the sheet shows when no pick is shown, up to three models of its collection as an owner of the highest
   * tier reads them, whatever the picks (services/lookbook.ts pairsFallbackOf); empty: nothing (no other model shown in its collection, or none).
   */
  pairsFallback?: { name: string; label: string | null }[];
}

/**
 * A model picked for PAIRS WELL WITH (BP-34), as the console lists it: its place, the model (its name and label among
 * its variants), its place in the lookbook and whether the sheet shows it: to EVERYONE (PUBLIC), to the owners of the
 * salon's tier (SALON: RESERVED), or not (HIDDEN: hidden or without an address; DISCONTINUED).
 */
export interface ModelPairRecord {
  position: number;
  id: string;
  name: string;
  label: string | null;
  swatch: string | null;
  lookbook: LookbookState;
  slug: string | null;
  shown: ModelPairShown;
}

/** Whether a model's sheet shows a pair (BP-34; mirrored in web/admin/types.ts PAIR_SHOWN). */
export const MODEL_PAIR_SHOWN = Object.freeze(['EVERYONE', 'SALON', 'HIDDEN', 'DISCONTINUED'] as const);
export type ModelPairShown = (typeof MODEL_PAIR_SHOWN)[number];

/** PAIRS WELL WITH (BP-34): a model picks none, or two or three models. */
export const MODEL_PAIRS_MAX = 3;

/** A variant of a model as its main model's page lists it (VARIANTS). */
export interface ModelVariantRecord {
  id: string;
  name: string;
  label: string | null;
  swatch: string | null;
  skuPrefix: string;
  /** Its own reference photograph, or null. */
  imageUrl: string | null;
  lookbook: LookbookState;
  slug: string | null;
  active: boolean;
}

/** One photograph of a model's gallery, as the console reads it. */
export interface GalleryImageRecord {
  sha256: string;
  url: string;
  /** null: the sheet's default alternative text. */
  alt: string | null;
  /** 1…n, the order of the sheet. */
  position: number;
}

/** What `updateModel` may change: never the category nor the SKU prefix. Absent = unchanged; null or '' clears an optional text or the collection. */
export interface UpdateModelInput {
  name?: string;
  defaultMaterial?: string | null;
  careInstructions?: string | null;
  collectionId?: string | null;
  active?: boolean;
  /** The lookbook (P-R02). */
  lookbook?: LookbookState;
  slug?: string | null;
  story?: string | null;
  specs?: string | null;
  /** THE PRIVATE SALON (P-X08). */
  priceLabel?: string | null;
  privateMinTier?: number;
  /** N2: the base price and its currency, given together; null for both clears it. */
  basePriceMinor?: number | null;
  baseCurrency?: string | null;
  /** M6: the care guide. */
  careGuide?: string | null;
  /** N1: its label among its model's dots and the dot's colour, given together; null for both clears them (a model alone only). */
  variantLabel?: string | null;
  variantSwatch?: string | null;
}

/** The fields of a model a change may touch, in their API spelling. */
export const MODEL_EDITABLE_FIELDS = Object.freeze([
  'name',
  'defaultMaterial',
  'careInstructions',
  'collectionId',
  'active',
  'lookbook',
  'slug',
  'story',
  'specs',
  'priceLabel',
  'privateMinTier',
  'basePriceMinor',
  'baseCurrency',
  'careGuide',
  'variantLabel',
  'variantSwatch',
] as const);

/** Refused by `updateModel` (and by the PATCH body): a model's identity, written in the pieces already issued. */
export const MODEL_IDENTITY_FIELDS = Object.freeze(['category', 'categoryCode', 'skuPrefix'] as const);

export const MODEL_IDENTITY_MESSAGE =
  'The category and SKU prefix of a model never change: the category letter is in the identity of every piece issued with it, the prefix starts every SKU issued with it.';

export interface CreateModelInput {
  categoryCode: string;
  collectionId?: string | null;
  name: string;
  type: string;
  skuPrefix: string;
  defaultMaterial?: string | null;
  careInstructions?: string | null;
  /**
   * Plan NEXT LOT §3.3: its size type (POST /api/admin/models requires it; optional here for the fixtures and the demo
   * seed that build models directly). A watch or a model of one size declares ONE SIZE at once.
   */
  sizeType?: SizeType;
}

/**
 * ADD A VARIANT (N1): the new variant's label, colour and SKU prefix; and the main model's own label and colour, read
 * only while it has none (its first variant): the main model is one of the dots too.
 */
export interface CreateVariantInput {
  label: string;
  swatch: string;
  skuPrefix: string;
  mainLabel?: string | null;
  mainSwatch?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKU_PREFIX_RE = /^[A-Z0-9][A-Z0-9._-]*$/;

function requiredText(v: unknown, label: string, max: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > max || /[\u0000-\u001f\u007f]/.test(s)) throw validationError(`${label} must be 1–${max} characters.`);
  return s;
}

function optionalText(v: unknown, label: string, max: number): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string' || v.trim().length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return v.trim();
}

/** A care guide (M6): plain text, line breaks kept, 1 to CARE_GUIDE_MAX characters; '' and null clear it. */
export function normalizeCareGuide(v: unknown): string | null {
  const s = plainText(v, 'The care guide', CARE_GUIDE_MAX);
  if (s === null) return null;
  return s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * A base price (N2) as a change gives it: both the amount (whole minor units, 1 to BASE_PRICE_MAX_MINOR) and its
 * currency (one of the house's), or null for both. One without the other is refused.
 */
export function normalizeBasePrice(minor: unknown, currency: unknown): { minor: number; currency: string } | null {
  if (minor === null && (currency === null || currency === undefined || currency === '')) return null;
  if (minor === undefined || currency === undefined || currency === null || currency === '') throw validationError('A base price is given with its currency, or both are cleared.');
  if (typeof minor !== 'number' || !Number.isInteger(minor) || minor < 1 || minor > BASE_PRICE_MAX_MINOR) throw validationError('The base price is 0.01 to 1 000 000.00.');
  if (typeof currency !== 'string' || !(ORDER_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`The base price is in ${ORDER_CURRENCIES.join(', ')}.`);
  return { minor, currency };
}

/** A variant's label (N1): one line, runs of spaces kept to one, 1 to VARIANT_LABEL_MAX characters; null, '' and blank text: none. */
export function normalizeVariantLabel(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw validationError('A variant’s label must be text.');
  const s = v.trim().replace(/\s+/g, ' ');
  if (s === '') return null;
  if (/[\u0000-\u001f\u007f]/.test(s) || s.length > VARIANT_LABEL_MAX) throw validationError(`A variant’s label is one line of 1 to ${VARIANT_LABEL_MAX} characters: Steel.`);
  return s;
}

/** A variant's colour (N1): `#RRGGBB` (the `#` optional, any case), kept in capitals; null, '' and blank text: none. */
export function normalizeSwatch(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  const hex = s.startsWith('#') ? s : `#${s}`;
  if (!VARIANT_SWATCH_RE.test(hex)) throw validationError('A variant’s colour is #RRGGBB: #16224A.');
  return hex;
}

export class CatalogService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly categories: CategoryRegistry;
  private readonly clock: Clock;

  constructor(deps: CatalogServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.categories = deps.categories;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Collections ──────────────────────────────────────────────────────────

  async listCollections(): Promise<CollectionRecord[]> {
    return this.collectionQuery().orderBy('c.name').execute().then((rows) => rows.map(toCollectionRecord));
  }

  async getCollection(collectionId: string): Promise<CollectionRecord> {
    if (typeof collectionId !== 'string' || !UUID_RE.test(collectionId)) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    const row = await this.collectionQuery().where('c.id', '=', collectionId.toLowerCase()).executeTakeFirst();
    if (!row) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    return toCollectionRecord(row);
  }

  async createCollection(input: { name: string }, actor: Actor): Promise<CollectionRecord> {
    const name = requiredText(input?.name, 'Collection name', 100);
    try {
      return await inTransaction(this.db, async (tx) => {
        const r = await tx.insertInto('collections').values({ name, created_at: this.clock() }).returningAll().executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'collection.create', targetType: 'collection', targetId: r.id, details: { name: r.name } }, tx);
        return { id: r.id, name: r.name, models: 0, products: 0, createdAt: r.created_at };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('COLLECTION_EXISTS', 'A collection with this name already exists.');
      throw e;
    }
  }

  /**
   * Rename a collection (PATCH /api/admin/collections/:id). The name reads on the public result of every piece in it,
   * so the change is audited `collection.update` with the name before and after and the number of those pieces.
   */
  async updateCollection(collectionId: string, input: { name: string }, actor: Actor): Promise<CollectionRecord> {
    const name = requiredText(input?.name, 'Collection name', 100);
    if (typeof collectionId !== 'string' || !UUID_RE.test(collectionId)) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    const id = collectionId.toLowerCase();
    try {
      await inTransaction(this.db, async (tx) => {
        const before = await tx.selectFrom('collections').select(['id', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!before) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
        if (before.name === name) return;
        await tx.updateTable('collections').set({ name }).where('id', '=', id).execute();
        await this.audit.record(
          {
            actor,
            action: 'collection.update',
            targetType: 'collection',
            targetId: id,
            details: { before: { name: before.name }, after: { name }, issuedPieces: await issuedInCollection(tx, id) },
          },
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('COLLECTION_EXISTS', 'A collection with this name already exists.');
      throw e;
    }
    return this.getCollection(id);
  }

  // ── Models ───────────────────────────────────────────────────────────────

  async listModels(): Promise<ModelRecord[]> {
    const rows = await this.modelQuery().orderBy('c.code').orderBy('m.name').execute();
    const galleries = await this.galleries();
    return rows.map((r) => toModelRecord(r, galleries.get(r.id) ?? [], rows));
  }

  async getModel(modelId: string): Promise<ModelRecord> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const id = modelId.toLowerCase();
    const row = await this.modelQuery().where('m.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
    // N1: its main model, or its variants.
    const mainId = row.variant_of;
    const related = await this.modelQuery()
      .where((eb) => (mainId ? eb.or([eb('m.variant_of', '=', id), eb('m.id', '=', mainId)]) : eb('m.variant_of', '=', id)))
      .execute();
    // BP-34: the pairs of its main model (a variant's sheet is its main model's), and what the sheet shows without them.
    const root = mainId ?? id;
    const rootCollection = mainId ? (related.find((r) => r.id === mainId)?.collection_id ?? null) : row.collection_id;
    const [pairs, fallback] = await Promise.all([this.pairRecords(root), pairsFallbackOf(this.db, root, rootCollection, 3)]);
    return {
      ...toModelRecord(row, (await this.galleries(id)).get(id) ?? [], related),
      pairs,
      pairsFallback: fallback.map((f) => ({ name: f.name, label: f.variant })),
    };
  }

  /** BP-34: the models `modelId` (a main model or a model alone) pairs with, in their order, with whether its sheet shows each. */
  private async pairRecords(modelId: string): Promise<ModelPairRecord[]> {
    const rows = await this.db
      .selectFrom('model_pairs as p')
      .innerJoin('models as m', 'm.id', 'p.paired_model_id')
      .select(['p.position', 'm.id', 'm.name', 'm.variant_label', 'm.variant_swatch', 'm.lookbook', 'm.slug', 'm.discontinued_at'])
      .where('p.model_id', '=', modelId)
      .orderBy('p.position')
      .execute();
    return rows.map((r) => ({
      position: r.position,
      id: r.id,
      name: r.name,
      label: r.variant_label,
      swatch: r.variant_swatch,
      lookbook: r.lookbook,
      slug: r.slug,
      shown: r.discontinued_at ? 'DISCONTINUED' : r.lookbook === 'HIDDEN' || !r.slug ? 'HIDDEN' : r.lookbook === 'RESERVED' ? 'SALON' : 'EVERYONE',
    }));
  }

  /**
   * PAIRS WELL WITH (plan NEXT-NINE, BP-34; PUT /api/admin/models/:id/pairs): the models a main model or a model alone
   * ends its sheet with, in their order: none, or two or three (400 VALIDATION_FAILED otherwise), each once (400), never
   * the model itself nor one of its variants (409 PAIR_SAME_MODEL), each a known model (404 MODEL_NOT_FOUND). A variant's
   * pairs are its main model's (409 MODEL_IS_VARIANT). The model is locked while its rows are replaced, in one
   * transaction; no change writes nothing. Audited `model.pairs` with the ids before and after.
   */
  async setPairs(modelId: string, ids: readonly string[], actor: Actor): Promise<ModelRecord> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const id = modelId.toLowerCase();
    if (!Array.isArray(ids)) throw validationError('Pick two or three models, or none.');
    const after = ids.map((x) => (typeof x === 'string' ? x.toLowerCase() : ''));
    if (after.length === 1 || after.length > MODEL_PAIRS_MAX) throw validationError('Pick two or three models, or none: the sheet then shows other models of its collection.');
    if (after.some((x) => !UUID_RE.test(x))) throw notFound('Model', 'MODEL_NOT_FOUND');
    if (new Set(after).size !== after.length) throw validationError('Each model is picked once.');
    await inTransaction(this.db, async (tx) => {
      const m = await tx.selectFrom('models').select(['id', 'variant_of']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!m) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (m.variant_of) throw conflict('MODEL_IS_VARIANT', 'A variant’s pairs are set on its main model: its sheet is the same.');
      const picked = after.length ? await tx.selectFrom('models').select(['id', 'variant_of']).where('id', 'in', after).execute() : [];
      if (picked.length !== after.length) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (picked.some((p) => p.id === id || p.variant_of === id)) throw conflict('PAIR_SAME_MODEL', 'A model pairs with another model, not with itself or one of its variants.');
      const before = (await tx.selectFrom('model_pairs').select('paired_model_id').where('model_id', '=', id).orderBy('position').execute()).map((r) => r.paired_model_id);
      if (before.length === after.length && before.every((x, i) => x === after[i])) return;
      await tx.deleteFrom('model_pairs').where('model_id', '=', id).execute();
      if (after.length) {
        const now = this.clock();
        await tx
          .insertInto('model_pairs')
          .values(after.map((paired, i) => ({ model_id: id, position: i + 1, paired_model_id: paired, created_at: now, created_by: adminIdOf(actor) })))
          .execute();
      }
      await this.audit.record({ actor, action: 'model.pairs', targetType: 'model', targetId: id, details: { before, after } }, tx);
    });
    return this.getModel(id);
  }

  /** The galleries of every model (or of one), each in its order. */
  private async galleries(modelId?: string): Promise<Map<string, GalleryImageRecord[]>> {
    let q = this.db.selectFrom('model_images').select(['model_id', 'sha256', 'alt', 'position']).orderBy('model_id').orderBy('position');
    if (modelId) q = q.where('model_id', '=', modelId);
    const out = new Map<string, GalleryImageRecord[]>();
    for (const r of await q.execute()) {
      const url = mediaUrl(r.sha256);
      if (!url) continue;
      const list = out.get(r.model_id) ?? [];
      list.push({ sha256: r.sha256, url, alt: r.alt, position: r.position });
      out.set(r.model_id, list);
    }
    return out;
  }

  async createModel(input: CreateModelInput, actor: Actor): Promise<ModelRecord> {
    const categoryCode = typeof input?.categoryCode === 'string' ? input.categoryCode.trim().toUpperCase() : '';
    const name = requiredText(input.name, 'Model name', 100);
    const type = requiredText(input.type, 'Model type', 60);
    const skuPrefix = requiredText(input.skuPrefix, 'SKU prefix', 32).toUpperCase();
    if (!SKU_PREFIX_RE.test(skuPrefix)) throw validationError('SKU prefix may contain letters, digits, dot, underscore and hyphen only.');
    const defaultMaterial = optionalText(input.defaultMaterial, 'Default material', 200);
    const careInstructions = optionalText(input.careInstructions, 'Care instructions', 2000);
    const collectionId = input.collectionId ?? null;
    const sizeType = input.sizeType;
    if (sizeType !== undefined && !(SIZE_TYPES as readonly string[]).includes(sizeType)) throw validationError('Give the model its size type.');

    const category = /^[A-Z]$/.test(categoryCode) ? await this.categories.getByCode(categoryCode) : undefined;
    if (!category) throw notFound('Category', 'CATEGORY_NOT_FOUND');
    if (collectionId !== null) {
      const col = UUID_RE.test(collectionId) ? await this.db.selectFrom('collections').select('id').where('id', '=', collectionId).executeTakeFirst() : undefined;
      if (!col) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    }
    try {
      const id = await inTransaction(this.db, async (tx) => {
        const r = await tx
          .insertInto('models')
          .values({
            category_id: category.index,
            collection_id: collectionId,
            name,
            type,
            sku_prefix: skuPrefix,
            default_material: defaultMaterial,
            care_instructions: careInstructions,
            ...(sizeType !== undefined ? { size_type: sizeType, size_kind: SIZE_TYPE_KIND[sizeType] } : {}),
            created_at: this.clock(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // §3.3 item 6b: a watch or a model of one size has its one size at once; a ring's, a bracelet's or a necklace's
        // sizes are ticked next, on its page (until then, every flow naming a size of it is refused).
        if (sizeType !== undefined && !LISTED_SIZE_TYPES.includes(sizeType)) await ensureSku(tx, r.id, null);
        await this.audit.record(
          {
            actor,
            action: 'model.create',
            targetType: 'model',
            targetId: r.id,
            details: { name, type, skuPrefix, category: category.code, collectionId, ...(sizeType !== undefined ? { sizeType } : {}) },
          },
          tx,
        );
        return r.id;
      });
      return this.getModel(id);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('SKU_PREFIX_TAKEN', 'Another model already uses this SKU prefix.');
      throw e;
    }
  }

  /**
   * ADD A VARIANT (POST /api/admin/models/:id/variants, N1): a new model, a variant of `mainId`, that copies its
   * category, collection, name, type, story, specifications and care (instructions and guide), with its own label,
   * colour and SKU prefix; HIDDEN from the lookbook (its photographs come next, then its publication), active, without a
   * material nor prices of its own yet. A main model without its own label and colour takes `mainLabel` and
   * `mainSwatch` in the same transaction (400 when they are missing), audited `model.update`. Refused: a main model that
   * is itself a variant (409 MODEL_IS_VARIANT: variants are never chained), a label its model or another of its variants
   * has (409 VARIANT_LABEL_TAKEN), a SKU prefix another model has (409 SKU_PREFIX_TAKEN). Audited `model.variant.create`
   * with its main model, its label and colour, and what was copied.
   */
  async createVariant(mainId: string, input: CreateVariantInput, actor: Actor): Promise<ModelRecord> {
    const id = modelKey(mainId);
    if (input === null || typeof input !== 'object') throw validationError('Send the variant’s label, colour and SKU prefix.');
    const label = normalizeVariantLabel(input.label);
    const swatch = normalizeSwatch(input.swatch);
    if (label === null || swatch === null) throw validationError('A variant has its label and its colour: one of its model’s dots.');
    const skuPrefix = requiredText(input.skuPrefix, 'SKU prefix', 32).toUpperCase();
    if (!SKU_PREFIX_RE.test(skuPrefix)) throw validationError('SKU prefix may contain letters, digits, dot, underscore and hyphen only.');
    try {
      const variantId = await inTransaction(this.db, async (tx) => {
        const main = await tx
          .selectFrom('models as m')
          .innerJoin('categories as c', 'c.id', 'm.category_id')
          .select([
            'm.id',
            'm.category_id',
            'm.collection_id',
            'm.name',
            'm.type',
            'm.story',
            'm.specs',
            'm.care_instructions',
            'm.care_guide',
            'm.variant_of',
            'm.variant_label',
            'm.variant_swatch',
            'c.code as category_code',
          ])
          .where('m.id', '=', id)
          .forUpdate('m')
          .executeTakeFirst();
        if (!main) throw notFound('Model', 'MODEL_NOT_FOUND');
        if (main.variant_of !== null) throw conflict('MODEL_IS_VARIANT', 'This model is a variant of another: add the variant to its main model.');
        const now = this.clock();
        if (main.variant_label === null) {
          const mainLabel = normalizeVariantLabel(input.mainLabel);
          const mainSwatch = normalizeSwatch(input.mainSwatch);
          if (mainLabel === null || mainSwatch === null) throw validationError('Give this model its own label and colour first: it is one of the dots of its variants.');
          await tx.updateTable('models').set({ variant_label: mainLabel, variant_swatch: mainSwatch }).where('id', '=', id).execute();
          await this.audit.record(
            {
              actor,
              action: 'model.update',
              targetType: 'model',
              targetId: id,
              details: { before: { variantLabel: null, variantSwatch: null }, after: { variantLabel: mainLabel, variantSwatch: mainSwatch }, issuedPieces: await issuedWithModel(tx, id) },
            },
            tx,
          );
        }
        const r = await tx
          .insertInto('models')
          .values({
            category_id: main.category_id,
            collection_id: main.collection_id,
            name: main.name,
            type: main.type,
            sku_prefix: skuPrefix,
            default_material: null,
            care_instructions: main.care_instructions,
            story: main.story,
            specs: main.specs,
            care_guide: main.care_guide,
            variant_of: id,
            variant_label: label,
            variant_swatch: swatch,
            created_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(
          {
            actor,
            action: 'model.variant.create',
            targetType: 'model',
            targetId: r.id,
            details: {
              mainId: id,
              name: main.name,
              type: main.type,
              skuPrefix,
              category: main.category_code.trim(),
              collectionId: main.collection_id,
              label,
              swatch,
              copied: ['type', 'collection', 'story', 'specs', 'care'],
            },
          },
          tx,
        );
        return r.id;
      });
      return this.getModel(variantId);
    } catch (e) {
      if (isUniqueViolation(e, 'models_variant_label_key')) throw variantLabelTaken();
      if (isUniqueViolation(e)) throw conflict('SKU_PREFIX_TAKEN', 'Another model already uses this SKU prefix.');
      throw e;
    }
  }

  /**
   * Change what a model shows or offers (PATCH /api/admin/models/:id): its name, default material, care instructions,
   * collection and `active`, its lookbook (P-R02: `lookbook`, `slug`, `story`, `specs`) and its place in the private salon
   * (P-X08: `priceLabel`, `privateMinTier`). Never its category nor its
   * SKU prefix (400, MODEL_IDENTITY_MESSAGE). Audited `model.update` with the changed fields before and after (a story as
   * its length and SHA-256) and the number of pieces issued with the model; nothing is written when nothing changes.
   *
   * The lookbook's rules: a model shown (PUBLIC or RESERVED) has its slug (400); a slug another model has is 409
   * SLUG_TAKEN; the first time a model is shown, `published_at` is set (audited as `publishedAt`), and from then on
   * its slug never changes (409 SLUG_LOCKED), whatever its place in the lookbook.
   */
  async updateModel(modelId: string, input: UpdateModelInput, actor: Actor): Promise<ModelRecord> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw validationError('Send the fields of the model to change.');
    const given = Object.entries(input).filter(([, v]) => v !== undefined);
    for (const [key] of given) {
      if ((MODEL_IDENTITY_FIELDS as readonly string[]).includes(key)) throw validationError(MODEL_IDENTITY_MESSAGE);
      if (!(MODEL_EDITABLE_FIELDS as readonly string[]).includes(key)) throw validationError(`A model has no field ${key.slice(0, 40)} to change.`);
    }
    if (given.length === 0) throw validationError('Send at least one field of the model to change.');

    const after: ModelChange = {};
    if (input.name !== undefined) after.name = requiredText(input.name, 'Model name', 100);
    if (input.defaultMaterial !== undefined) after.defaultMaterial = optionalText(input.defaultMaterial, 'Default material', 200);
    if (input.careInstructions !== undefined) after.careInstructions = optionalText(input.careInstructions, 'Care instructions', 2000);
    if (input.active !== undefined) {
      if (typeof input.active !== 'boolean') throw validationError('active must be true or false.');
      after.active = input.active;
    }
    if (input.collectionId !== undefined) {
      const c = input.collectionId === null || input.collectionId === '' ? null : input.collectionId;
      if (c !== null && (typeof c !== 'string' || !UUID_RE.test(c))) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
      after.collectionId = c === null ? null : c.toLowerCase();
    }
    if (input.lookbook !== undefined) {
      if (!(LOOKBOOK_STATES as readonly unknown[]).includes(input.lookbook)) throw validationError(`lookbook must be ${LOOKBOOK_STATES.join(', ')}.`);
      after.lookbook = input.lookbook;
    }
    if (input.slug !== undefined) after.slug = normalizeSlug(input.slug);
    if (input.story !== undefined) after.story = normalizeStory(input.story);
    if (input.specs !== undefined) after.specs = normalizeSpecs(input.specs);
    if (input.priceLabel !== undefined) after.priceLabel = normalizePriceLabel(input.priceLabel);
    if (input.privateMinTier !== undefined) after.privateMinTier = normalizeMinTier(input.privateMinTier);
    if (input.basePriceMinor !== undefined || input.baseCurrency !== undefined) {
      const price = normalizeBasePrice(input.basePriceMinor, input.baseCurrency);
      after.basePriceMinor = price?.minor ?? null;
      after.baseCurrency = price?.currency ?? null;
    }
    if (input.careGuide !== undefined) after.careGuide = normalizeCareGuide(input.careGuide);
    if (input.variantLabel !== undefined) after.variantLabel = normalizeVariantLabel(input.variantLabel);
    if (input.variantSwatch !== undefined) after.variantSwatch = normalizeSwatch(input.variantSwatch);
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const id = modelId.toLowerCase();

    try {
      await inTransaction(this.db, async (tx) => {
        const row = await tx
          .selectFrom('models')
          .select([
            'name',
            'default_material',
            'care_instructions',
            'collection_id',
            'active',
            'lookbook',
            'slug',
            'story',
            'specs',
            'price_label',
            'private_min_tier',
            'base_price_minor',
            'base_currency',
            'care_guide',
            'variant_of',
            'variant_label',
            'variant_swatch',
            'published_at',
            'discontinued_at',
          ])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
        const current: Required<ModelChange> = {
          name: row.name,
          defaultMaterial: row.default_material,
          careInstructions: row.care_instructions,
          collectionId: row.collection_id,
          active: row.active,
          lookbook: row.lookbook,
          slug: row.slug,
          story: row.story,
          specs: row.specs,
          priceLabel: row.price_label,
          privateMinTier: row.private_min_tier,
          basePriceMinor: row.base_price_minor,
          baseCurrency: row.base_currency,
          careGuide: row.care_guide,
          variantLabel: row.variant_label,
          variantSwatch: row.variant_swatch,
        };
        const changed = (Object.keys(after) as (keyof ModelChange)[]).filter((k) => after[k] !== current[k]);
        if (changed.length === 0) return;
        // N1: a label and its colour go together; a variant and a model with variants keep theirs (one of the dots).
        if (changed.includes('variantLabel') || changed.includes('variantSwatch')) {
          const label = changed.includes('variantLabel') ? (after.variantLabel ?? null) : current.variantLabel;
          const swatch = changed.includes('variantSwatch') ? (after.variantSwatch ?? null) : current.variantSwatch;
          if ((label === null) !== (swatch === null)) throw validationError('A variant’s label and its colour go together: give both, or clear both.');
          if (label === null && (row.variant_of !== null || (await tx.selectFrom('models').select('id').where('variant_of', '=', id).executeTakeFirst()) !== undefined)) {
            throw conflict('VARIANT_LABEL_REQUIRED', 'A variant, and a model with variants, keep their label and colour: each is one of the model’s dots.');
          }
        }
        // P-R06: a discontinued model is offered again only by reinstating it (an ADMIN's, audited as such).
        if (changed.includes('active') && after.active === true && row.discontinued_at !== null) throw modelDiscontinued();
        if (changed.includes('collectionId') && after.collectionId) {
          const col = await tx.selectFrom('collections').select('id').where('id', '=', after.collectionId).executeTakeFirst();
          if (!col) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
        }
        // The lookbook: a published model keeps its address; a model shown has one.
        if (changed.includes('slug') && row.published_at !== null) {
          throw conflict('SLUG_LOCKED', 'The address of a model shown in the lookbook never changes once it is published: links to its sheet are out.');
        }
        const lookbook = after.lookbook ?? current.lookbook;
        const slug = changed.includes('slug') ? (after.slug ?? null) : current.slug;
        if (lookbook !== 'HIDDEN' && slug === null) throw validationError('A model shown in the lookbook needs the address of its sheet (slug).');
        const publishedAt = row.published_at === null && lookbook !== 'HIDDEN' ? this.clock() : null;

        const set: {
          name?: string;
          default_material?: string | null;
          care_instructions?: string | null;
          collection_id?: string | null;
          active?: boolean;
          lookbook?: LookbookState;
          slug?: string | null;
          story?: string | null;
          specs?: string | null;
          price_label?: string | null;
          private_min_tier?: number;
          base_price_minor?: number | null;
          base_currency?: string | null;
          care_guide?: string | null;
          variant_label?: string | null;
          variant_swatch?: string | null;
          published_at?: Date;
        } = {};
        for (const k of changed) {
          if (k === 'name') set.name = after.name;
          else if (k === 'defaultMaterial') set.default_material = after.defaultMaterial;
          else if (k === 'careInstructions') set.care_instructions = after.careInstructions;
          else if (k === 'collectionId') set.collection_id = after.collectionId;
          else if (k === 'active') set.active = after.active;
          else if (k === 'lookbook') set.lookbook = after.lookbook;
          else if (k === 'slug') set.slug = after.slug;
          else if (k === 'story') set.story = after.story;
          else if (k === 'specs') set.specs = after.specs;
          else if (k === 'priceLabel') set.price_label = after.priceLabel;
          else if (k === 'basePriceMinor') set.base_price_minor = after.basePriceMinor;
          else if (k === 'baseCurrency') set.base_currency = after.baseCurrency;
          else if (k === 'careGuide') set.care_guide = after.careGuide;
          else if (k === 'variantLabel') set.variant_label = after.variantLabel;
          else if (k === 'variantSwatch') set.variant_swatch = after.variantSwatch;
          else set.private_min_tier = after.privateMinTier;
        }
        if (publishedAt) set.published_at = publishedAt;
        await tx.updateTable('models').set(set).where('id', '=', id).execute();
        const issued = await tx.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).where('model_id', '=', id).executeTakeFirstOrThrow();
        // The audit log is permanent: a story and a care guide are recorded as their length and SHA-256, never in words.
        const audited = (k: keyof ModelChange, v: ModelChange[keyof ModelChange]) => (k === 'story' || k === 'careGuide' ? storyFingerprint((v as string | null | undefined) ?? null) : v);
        await this.audit.record(
          {
            actor,
            action: 'model.update',
            targetType: 'model',
            targetId: id,
            details: {
              before: { ...Object.fromEntries(changed.map((k) => [k, audited(k, current[k])])), ...(publishedAt ? { publishedAt: null } : {}) },
              after: { ...Object.fromEntries(changed.map((k) => [k, audited(k, after[k])])), ...(publishedAt ? { publishedAt: publishedAt.toISOString() } : {}) },
              issuedPieces: Number(issued.n),
            },
          },
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e, 'models_slug_key')) throw conflict('SLUG_TAKEN', 'Another model already has this address in the lookbook (slug).');
      if (isUniqueViolation(e, 'models_variant_label_key')) throw variantLabelTaken();
      throw e;
    }
    return this.getModel(id);
  }

  /**
   * Discontinue a model (POST /api/admin/models/:id/discontinue, ADMIN; P-R06): `discontinued_at` now, its author
   * (null for a script), and `active = false`, in one transaction. Its pieces verify as before, said DISCONTINUED with
   * the year; no new piece is issued with it (409 MODEL_INACTIVE). Audited `model.discontinue` with whether it was
   * active and the number of its issued pieces. 409 MODEL_ALREADY_DISCONTINUED when it already is.
   */
  async discontinueModel(modelId: string, actor: Actor): Promise<ModelRecord> {
    const id = modelKey(modelId);
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('models').select(['name', 'sku_prefix', 'active', 'discontinued_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (row.discontinued_at !== null) throw conflict('MODEL_ALREADY_DISCONTINUED', 'This model is already discontinued.');
      const now = this.clock();
      await tx.updateTable('models').set({ discontinued_at: now, discontinued_by: adminIdOf(actor), active: false }).where('id', '=', id).execute();
      await this.audit.record(
        {
          actor,
          action: 'model.discontinue',
          targetType: 'model',
          targetId: id,
          details: { name: row.name, skuPrefix: row.sku_prefix, discontinuedAt: now.toISOString(), wasActive: row.active, issuedPieces: await issuedWithModel(tx, id) },
        },
        tx,
      );
    });
    return this.getModel(id);
  }

  /**
   * Reinstate a discontinued model (POST /api/admin/models/:id/reinstate, ADMIN; P-R06): `discontinued_at` and its
   * author cleared, `active = true` again (offered for new pieces), in one transaction. Audited `model.reinstate` with
   * the date it had been discontinued. 409 MODEL_NOT_DISCONTINUED when it is not.
   */
  async reinstateModel(modelId: string, actor: Actor): Promise<ModelRecord> {
    const id = modelKey(modelId);
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('models').select(['name', 'sku_prefix', 'discontinued_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
      if (row.discontinued_at === null) throw conflict('MODEL_NOT_DISCONTINUED', 'This model is not discontinued.');
      await tx.updateTable('models').set({ discontinued_at: null, discontinued_by: null, active: true }).where('id', '=', id).execute();
      await this.audit.record(
        {
          actor,
          action: 'model.reinstate',
          targetType: 'model',
          targetId: id,
          details: { name: row.name, skuPrefix: row.sku_prefix, discontinuedAt: row.discontinued_at.toISOString(), issuedPieces: await issuedWithModel(tx, id) },
        },
        tx,
      );
    });
    return this.getModel(id);
  }

  private modelQuery() {
    return this.db
      .selectFrom('models as m')
      .innerJoin('categories as c', 'c.id', 'm.category_id')
      .leftJoin('collections as col', 'col.id', 'm.collection_id')
      .leftJoin(
        (eb) => eb.selectFrom('products').select((p) => ['model_id', p.fn.countAll<number>().as('n')]).groupBy('model_id').as('issued'),
        (j) => j.onRef('issued.model_id', '=', 'm.id'),
      )
      .select([
        'm.id',
        'm.name',
        'm.type',
        'm.sku_prefix',
        'm.default_material',
        'm.care_instructions',
        'm.active',
        'm.image_sha256',
        'm.lookbook',
        'm.slug',
        'm.story',
        'm.specs',
        'm.published_at',
        'm.discontinued_at',
        'm.price_label',
        'm.private_min_tier',
        'm.base_price_minor',
        'm.base_currency',
        'm.care_guide',
        'm.variant_of',
        'm.variant_label',
        'm.variant_swatch',
        'm.size_type',
        'm.created_at',
        'c.id as category_index',
        'c.code as category_code',
        'c.name as category_name',
        'col.id as collection_id',
        'col.name as collection_name',
        'issued.n as products',
      ])
      // N2: the model's Shopify product (one id on all its SKUs, services/shopify.ts) and how many sizes have their variant.
      .select((eb) => [
        eb.selectFrom('skus as k').select((k) => k.fn.max('k.shopify_product_id').as('p')).whereRef('k.model_id', '=', 'm.id').as('shopify_product_id'),
        // Plan NEXT LOT §3.3: as the export, its offered sizes only.
        eb.selectFrom('skus as k').select((k) => k.fn.countAll<number>().as('n')).whereRef('k.model_id', '=', 'm.id').where('k.set_aside_at', 'is', null).as('sku_count'),
        eb.selectFrom('skus as k').select((k) => k.fn.countAll<number>().as('n')).whereRef('k.model_id', '=', 'm.id').where('k.set_aside_at', 'is', null).where('k.shopify_variant_id', 'is not', null).as('variants_linked'),
        // Plan NEXT LOT §3.3: its offered sizes (the Catalogue's line).
        eb.selectFrom('skus as k').select((k) => k.fn.countAll<number>().as('n')).whereRef('k.model_id', '=', 'm.id').where('k.set_aside_at', 'is', null).as('sizes_offered'),
      ]);
  }

  /**
   * Collections with their counts. The issued pieces are counted once for all collections (one pass over the
   * products, grouped), not once per collection: no index can serve product_overview's rule below.
   */
  private collectionQuery() {
    const shownIn = sql<string>`coalesce(p.collection_id, pm.collection_id)`;
    return this.db
      .selectFrom('collections as c')
      .leftJoin(
        (eb) => eb.selectFrom('models as m').select((m) => ['m.collection_id', m.fn.countAll<number>().as('n')]).groupBy('m.collection_id').as('modelled'),
        (j) => j.onRef('modelled.collection_id', '=', 'c.id'),
      )
      .leftJoin(
        // product_overview's rule: the piece's own collection, else its model's.
        (eb) =>
          eb
            .selectFrom('products as p')
            .innerJoin('models as pm', 'pm.id', 'p.model_id')
            .select((p) => [shownIn.as('collection_id'), p.fn.countAll<number>().as('n')])
            .groupBy(shownIn)
            .as('issued'),
        (j) => j.onRef('issued.collection_id', '=', 'c.id'),
      )
      .select(['c.id', 'c.name', 'c.created_at', 'modelled.n as models', 'issued.n as products']);
  }

  /** Issued pieces per category index (the console's categories list: what a deactivation touches). */
  async issuedByCategory(): Promise<Map<number, number>> {
    const rows = await this.db.selectFrom('products').select((eb) => ['category_id', eb.fn.countAll<number>().as('n')]).groupBy('category_id').execute();
    return new Map(rows.map((r) => [r.category_id, Number(r.n)]));
  }
}

/** The editable fields of a model, in their API spelling (`updateModel`). */
interface ModelChange {
  name?: string;
  defaultMaterial?: string | null;
  careInstructions?: string | null;
  collectionId?: string | null;
  active?: boolean;
  lookbook?: LookbookState;
  slug?: string | null;
  story?: string | null;
  specs?: string | null;
  priceLabel?: string | null;
  privateMinTier?: number;
  basePriceMinor?: number | null;
  baseCurrency?: string | null;
  careGuide?: string | null;
  variantLabel?: string | null;
  variantSwatch?: string | null;
}

/** 409 VARIANT_LABEL_TAKEN: the label of another dot of the same model (N1). */
const variantLabelTaken = () => conflict('VARIANT_LABEL_TAKEN', 'This model or another of its variants already has this label.');

/** 409 MODEL_DISCONTINUED: an edit that would offer a discontinued model again (P-R06). */
export const modelDiscontinued = () =>
  conflict('MODEL_DISCONTINUED', 'This model is discontinued: it is offered for new pieces again only once an ADMIN reinstates it.');

function modelKey(modelId: string): string {
  if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
  return modelId.toLowerCase();
}

/** The console user behind an action, for a column naming one; null for a script (an actor that is no admin's uuid). */
function adminIdOf(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

/** Pieces issued with the model: what a change of it reaches. */
async function issuedWithModel(db: Db, modelId: string): Promise<number> {
  const r = await db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).where('model_id', '=', modelId).executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Issued pieces whose public result names the collection (their own collection, else their model's). */
async function issuedInCollection(db: Db, collectionId: string): Promise<number> {
  const r = await db
    .selectFrom('products as p')
    .innerJoin('models as m', 'm.id', 'p.model_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where((w) => w(w.fn.coalesce('p.collection_id', 'm.collection_id'), '=', collectionId))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

type CollectionQueryRow = { id: string; name: string; created_at: Date; models: number | string | null; products: number | string | null };

function toCollectionRecord(r: CollectionQueryRow): CollectionRecord {
  return { id: r.id, name: r.name, models: Number(r.models ?? 0), products: Number(r.products ?? 0), createdAt: r.created_at };
}

type ModelQueryRow = {
  id: string;
  name: string;
  type: string;
  sku_prefix: string;
  default_material: string | null;
  care_instructions: string | null;
  active: boolean;
  image_sha256: string | null;
  lookbook: LookbookState;
  slug: string | null;
  story: string | null;
  specs: string | null;
  published_at: Date | null;
  discontinued_at: Date | null;
  price_label: string | null;
  private_min_tier: number;
  base_price_minor: number | null;
  base_currency: string | null;
  care_guide: string | null;
  variant_of: string | null;
  variant_label: string | null;
  variant_swatch: string | null;
  shopify_product_id: string | null;
  sku_count: number | string | null;
  variants_linked: number | string | null;
  size_type: SizeType | null;
  sizes_offered: number | string | null;
  created_at: Date;
  category_index: number;
  category_code: string;
  category_name: string;
  collection_id: string | null;
  collection_name: string | null;
  products: number | string | null;
};

/** A variant as its main model's page lists it. */
function toVariantRecord(r: ModelQueryRow): ModelVariantRecord {
  return {
    id: r.id,
    name: r.name,
    label: r.variant_label,
    swatch: r.variant_swatch,
    skuPrefix: r.sku_prefix,
    imageUrl: mediaUrl(r.image_sha256),
    lookbook: r.lookbook,
    slug: r.slug,
    active: r.active,
  };
}

/** A model's record; `others` hold its main model and its variants (N1), when it has them. */
function toModelRecord(r: ModelQueryRow, gallery: GalleryImageRecord[], others: readonly ModelQueryRow[]): ModelRecord {
  const main = r.variant_of ? others.find((o) => o.id === r.variant_of) : undefined;
  const variants = others
    .filter((o) => o.variant_of === r.id)
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(toVariantRecord);
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    skuPrefix: r.sku_prefix,
    category: { index: r.category_index, code: r.category_code.trim(), name: r.category_name },
    collection: r.collection_id ? { id: r.collection_id, name: r.collection_name ?? '' } : null,
    defaultMaterial: r.default_material,
    careInstructions: r.care_instructions,
    active: r.active,
    imageUrl: mediaUrl(r.image_sha256),
    products: Number(r.products ?? 0),
    lookbook: r.lookbook,
    slug: r.slug,
    story: r.story,
    specs: r.specs,
    publishedAt: r.published_at,
    discontinuedAt: r.discontinued_at,
    priceLabel: r.price_label,
    privateMinTier: r.private_min_tier,
    gallery,
    basePriceMinor: r.base_price_minor,
    baseCurrency: r.base_currency,
    careGuide: r.care_guide,
    shopify: { productId: r.shopify_product_id, variants: Math.max(1, Number(r.sku_count ?? 0)), linked: Number(r.variants_linked ?? 0) },
    variantOf: main ? { id: main.id, name: main.name, label: main.variant_label } : null,
    variantLabel: r.variant_label,
    variantSwatch: r.variant_swatch,
    variants,
    sizeType: r.size_type,
    sizesOffered: Number(r.sizes_offered ?? 0),
    createdAt: r.created_at,
  };
}
