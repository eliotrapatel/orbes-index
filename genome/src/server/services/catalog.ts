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
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { LOOKBOOK_STATES, type LookbookState } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import type { CategoryRegistry } from './categories.js';
import { normalizeSlug, normalizeSpecs, normalizeStory, storyFingerprint } from './lookbook.js';
import { mediaUrl } from './media.js';

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
  /** The gallery of its sheet (MediaService), in its order, the cover aside. */
  gallery: GalleryImageRecord[];
  createdAt: Date;
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
}

/** The fields of a model a change may touch, in their API spelling. */
export const MODEL_EDITABLE_FIELDS = Object.freeze(['name', 'defaultMaterial', 'careInstructions', 'collectionId', 'active', 'lookbook', 'slug', 'story', 'specs'] as const);

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
    return rows.map((r) => toModelRecord(r, galleries.get(r.id) ?? []));
  }

  async getModel(modelId: string): Promise<ModelRecord> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const id = modelId.toLowerCase();
    const row = await this.modelQuery().where('m.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
    return toModelRecord(row, (await this.galleries(id)).get(id) ?? []);
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
            created_at: this.clock(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record(
          {
            actor,
            action: 'model.create',
            targetType: 'model',
            targetId: r.id,
            details: { name, type, skuPrefix, category: category.code, collectionId },
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
   * Change what a model shows or offers (PATCH /api/admin/models/:id): its name, default material, care instructions,
   * collection and `active`, and its lookbook (P-R02: `lookbook`, `slug`, `story`, `specs`). Never its category nor its
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
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const id = modelId.toLowerCase();

    try {
      await inTransaction(this.db, async (tx) => {
        const row = await tx
          .selectFrom('models')
          .select(['name', 'default_material', 'care_instructions', 'collection_id', 'active', 'lookbook', 'slug', 'story', 'specs', 'published_at'])
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
        };
        const changed = (Object.keys(after) as (keyof ModelChange)[]).filter((k) => after[k] !== current[k]);
        if (changed.length === 0) return;
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
          else set.specs = after.specs;
        }
        if (publishedAt) set.published_at = publishedAt;
        await tx.updateTable('models').set(set).where('id', '=', id).execute();
        const issued = await tx.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).where('model_id', '=', id).executeTakeFirstOrThrow();
        // The audit log is permanent: a story is recorded as its length and SHA-256, never in words.
        const audited = (k: keyof ModelChange, v: ModelChange[keyof ModelChange]) => (k === 'story' ? storyFingerprint((v as string | null | undefined) ?? null) : v);
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
      throw e;
    }
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
        'm.created_at',
        'c.id as category_index',
        'c.code as category_code',
        'c.name as category_name',
        'col.id as collection_id',
        'col.name as collection_name',
        'issued.n as products',
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
  created_at: Date;
  category_index: number;
  category_code: string;
  category_name: string;
  collection_id: string | null;
  collection_name: string | null;
  products: number | string | null;
};

function toModelRecord(r: ModelQueryRow, gallery: GalleryImageRecord[]): ModelRecord {
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
    gallery,
    createdAt: r.created_at,
  };
}
