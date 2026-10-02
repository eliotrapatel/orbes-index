/**
 * CategoryRegistry — product categories and their immutable 5-bit indices
 * (contract §2.1).
 *
 * The index (1..31) is packed into every product identity and therefore into
 * every signed code and genome. Once assigned it can never change or be
 * reused: the database rejects updates of `id`/`code` and any DELETE, and
 * deactivation (`active = false`) is the only way to retire a category.
 *
 * `resolver()` is synchronous (core identity functions need it that way) and
 * reads an in-memory cache filled by `load()`. Inactive categories stay
 * resolvable so historical products keep verifying. Other server instances'
 * new categories appear after the next `load()`; `getByCode()` reloads on a
 * cache miss.
 */
import { z } from 'zod';
import type { CategoryInfo, CategoryResolver } from '../../core/identity.js';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { CategoryRow } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';

export const CATEGORY_INDEX_MIN = 1;
export const CATEGORY_INDEX_MAX = 31;
export const DEFAULT_WARRANTY_MONTHS = 24;

export interface CategoryRecord {
  index: number;
  code: string;
  name: string;
  warrantyMonths: number;
  active: boolean;
  createdAt: Date;
}

export interface CreateCategoryInput {
  code: string;
  name: string;
  warrantyMonths?: number;
}

const createSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]$/, 'Category code must be a single letter A–Z.')),
  name: z
    .string()
    .trim()
    .min(1, 'Category name is required.')
    .max(64, 'Category name is too long.')
    // Control characters have no place in a label printed on product pages.
    .regex(/^[^\p{Cc}]+$/u, 'Category name contains invalid characters.'),
  warrantyMonths: z.number().int().min(0).max(600).optional(),
});

export class CategoryRegistry {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;
  private cache: { byCode: Map<string, CategoryRecord>; byIndex: Map<number, CategoryRecord> } | undefined;
  private readonly stableResolver: CategoryResolver;

  constructor(deps: { db: Db; audit: AuditService; clock?: Clock }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    // One resolver object for the registry's lifetime: holders see categories added later.
    this.stableResolver = {
      byCode: (code) => toInfo(this.loadedCache().byCode.get(code)),
      byIndex: (index) => toInfo(this.loadedCache().byIndex.get(index)),
    };
  }

  /** (Re)load all categories from the database into the cache. */
  async load(): Promise<CategoryRecord[]> {
    const rows = await this.db.selectFrom('categories').selectAll().orderBy('id').execute();
    const records = rows.map(fromRow);
    this.cache = { byCode: new Map(), byIndex: new Map() };
    for (const r of records) this.remember(r);
    return records;
  }

  /** Synchronous resolver for core identity functions. Requires a prior `load()`. */
  resolver(): CategoryResolver {
    this.loadedCache();
    return this.stableResolver;
  }

  /** All categories, ordered by index, fresh from the database (also refreshes the cache). */
  async list(opts: { activeOnly?: boolean } = {}): Promise<CategoryRecord[]> {
    const all = await this.load();
    return opts.activeOnly ? all.filter((c) => c.active) : all;
  }

  async getByCode(code: string): Promise<CategoryRecord | undefined> {
    const hit = this.cache?.byCode.get(code);
    if (hit) return hit;
    await this.load();
    return this.cache?.byCode.get(code);
  }

  async getByIndex(index: number): Promise<CategoryRecord | undefined> {
    const hit = this.cache?.byIndex.get(index);
    if (hit) return hit;
    await this.load();
    return this.cache?.byIndex.get(index);
  }

  /**
   * Create a category with the lowest free index in 1..31. Serialised by an
   * advisory lock so concurrent creates (even across instances) never race
   * for the same index.
   */
  async create(input: CreateCategoryInput, actor: Actor): Promise<CategoryRecord> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? 'Invalid category.');
    const { code, name } = parsed.data;
    const warrantyMonths = parsed.data.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS;

    let record: CategoryRecord;
    try {
      record = await inTransaction(this.db, async (trx) => {
        await advisoryXactLock(trx, ADVISORY_LOCK.CATEGORY_ALLOCATION);
        const existing = await trx.selectFrom('categories').select(['id', 'code']).execute();
        if (existing.some((c) => c.code === code)) throw codeTaken(code);
        const used = new Set(existing.map((c) => c.id));
        let index = 0;
        for (let i = CATEGORY_INDEX_MIN; i <= CATEGORY_INDEX_MAX; i++) {
          if (!used.has(i)) {
            index = i;
            break;
          }
        }
        if (index === 0) {
          throw conflict('CATEGORY_INDEX_EXHAUSTED', 'All 31 category indices are in use.');
        }

        const row = await trx
          .insertInto('categories')
          .values({ id: index, code, name, warranty_months: warrantyMonths, active: true, created_at: this.clock() })
          .returningAll()
          .executeTakeFirstOrThrow();
        const created = fromRow(row);
        await this.audit.record(
          {
            actor,
            action: 'category.create',
            targetType: 'category',
            targetId: code,
            details: { index: created.index, code: created.code, name: created.name, warrantyMonths: created.warrantyMonths },
          },
          trx,
        );
        return created;
      });
    } catch (e) {
      // Belt and braces: a writer bypassing the lock still cannot reuse a code or index.
      if (isUniqueViolation(e)) throw codeTaken(code);
      throw e;
    }
    if (this.cache) this.remember(record);
    return record;
  }

  /**
   * Activate or deactivate a category. Deactivated categories still resolve (old products stay verifiable).
   * Asking for the state the category already has changes nothing and writes no audit entry. The row is locked
   * first: an issuance under way (which reads `active` under a share lock) is waited for.
   */
  async setActive(code: string, active: boolean, actor: Actor): Promise<CategoryRecord> {
    const record = await inTransaction(this.db, async (trx) => {
      const current = await trx.selectFrom('categories').selectAll().where('code', '=', code).forNoKeyUpdate().executeTakeFirst();
      if (!current) throw notFound('Category', 'CATEGORY_NOT_FOUND');
      if (current.active === active) return fromRow(current);
      const row = await trx.updateTable('categories').set({ active }).where('code', '=', code).returningAll().executeTakeFirstOrThrow();
      const updated = fromRow(row);
      await this.audit.record(
        {
          actor,
          action: active ? 'category.activate' : 'category.deactivate',
          targetType: 'category',
          targetId: code,
          details: { index: updated.index, code: updated.code },
        },
        trx,
      );
      return updated;
    });
    if (this.cache) this.remember(record);
    return record;
  }

  private loadedCache() {
    if (!this.cache) throw new Error('CategoryRegistry.load() must complete before the resolver is used');
    return this.cache;
  }

  private remember(r: CategoryRecord): void {
    const c = this.loadedCache();
    c.byCode.set(r.code, r);
    c.byIndex.set(r.index, r);
  }
}

function codeTaken(code: string) {
  return conflict('CATEGORY_CODE_TAKEN', `Category code ${code} is already in use.`);
}

function fromRow(r: CategoryRow): CategoryRecord {
  return Object.freeze({
    index: r.id,
    code: r.code.trim(), // char(1); trim defends against bpchar padding on other drivers
    name: r.name,
    warrantyMonths: r.warranty_months,
    active: r.active,
    createdAt: r.created_at,
  });
}

function toInfo(r: CategoryRecord | undefined): CategoryInfo | undefined {
  return r ? { code: r.code, index: r.index, name: r.name } : undefined;
}
