/**
 * CatalogService — collections and models (the catalogue around categories,
 * which have their own registry because their 5-bit index is permanent).
 *
 * Each write is one insert in a transaction with its audit entry. The HTTP
 * layer validates shapes (http/schemas.ts); this service re-checks what it
 * relies on (non-empty bounded names, a known category and collection) so
 * that scripts and seeds calling it directly get the same rules.
 */
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { conflict, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import type { CategoryRegistry } from './categories.js';

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
  createdAt: Date;
}

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
    const rows = await this.db
      .selectFrom('collections as c')
      .leftJoin('models as m', 'm.collection_id', 'c.id')
      .select((eb) => ['c.id', 'c.name', 'c.created_at', eb.fn.count<number>('m.id').as('models')])
      .groupBy(['c.id', 'c.name', 'c.created_at'])
      .orderBy('c.name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, models: Number(r.models), createdAt: r.created_at }));
  }

  async createCollection(input: { name: string }, actor: Actor): Promise<CollectionRecord> {
    const name = requiredText(input?.name, 'Collection name', 100);
    try {
      return await inTransaction(this.db, async (tx) => {
        const r = await tx.insertInto('collections').values({ name, created_at: this.clock() }).returningAll().executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'collection.create', targetType: 'collection', targetId: r.id, details: { name: r.name } }, tx);
        return { id: r.id, name: r.name, models: 0, createdAt: r.created_at };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('COLLECTION_EXISTS', 'A collection with this name already exists.');
      throw e;
    }
  }

  // ── Models ───────────────────────────────────────────────────────────────

  async listModels(): Promise<ModelRecord[]> {
    const rows = await this.modelQuery().orderBy('c.code').orderBy('m.name').execute();
    return rows.map(toModelRecord);
  }

  async getModel(modelId: string): Promise<ModelRecord> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const row = await this.modelQuery().where('m.id', '=', modelId).executeTakeFirst();
    if (!row) throw notFound('Model', 'MODEL_NOT_FOUND');
    return toModelRecord(row);
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

  private modelQuery() {
    return this.db
      .selectFrom('models as m')
      .innerJoin('categories as c', 'c.id', 'm.category_id')
      .leftJoin('collections as col', 'col.id', 'm.collection_id')
      .select([
        'm.id',
        'm.name',
        'm.type',
        'm.sku_prefix',
        'm.default_material',
        'm.care_instructions',
        'm.created_at',
        'c.id as category_index',
        'c.code as category_code',
        'c.name as category_name',
        'col.id as collection_id',
        'col.name as collection_name',
      ]);
  }
}

type ModelQueryRow = {
  id: string;
  name: string;
  type: string;
  sku_prefix: string;
  default_material: string | null;
  care_instructions: string | null;
  created_at: Date;
  category_index: number;
  category_code: string;
  category_name: string;
  collection_id: string | null;
  collection_name: string | null;
};

function toModelRecord(r: ModelQueryRow): ModelRecord {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    skuPrefix: r.sku_prefix,
    category: { index: r.category_index, code: r.category_code.trim(), name: r.category_name },
    collection: r.collection_id ? { id: r.collection_id, name: r.collection_name ?? '' } : null,
    defaultMaterial: r.default_material,
    careInstructions: r.care_instructions,
    createdAt: r.created_at,
  };
}
