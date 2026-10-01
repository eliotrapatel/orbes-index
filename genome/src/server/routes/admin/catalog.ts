/**
 * Catalogue: categories (ADMIN to create: their 5-bit index is permanent),
 * collections and models (OPERATOR).
 *
 * Collections and models have no service of their own; the writes here are
 * single inserts, done in a transaction with their audit entry.
 */
import type { FastifyPluginAsync } from 'fastify';
import { inTransaction } from '../../db/connection.js';
import { isUniqueViolation } from '../../db/pg-errors.js';
import { conflict, notFound } from '../../errors.js';
import { createCategoryBody, createCollectionBody, createModelBody, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { CategoryRecord } from '../../services/categories.js';
import type { AdminRouteDeps } from './index.js';
import { itemsOf } from './serialize.js';

function categoryJson(c: CategoryRecord) {
  return { index: c.index, code: c.code, name: c.name, warrantyMonths: c.warrantyMonths, active: c.active, createdAt: c.createdAt };
}

export const adminCatalogRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db, audit, categories } = ctx;

  // ── Categories ───────────────────────────────────────────────────────────

  app.get('/api/admin/categories', async () => itemsOf((await categories.list()).map(categoryJson)));

  app.post('/api/admin/categories', { config: { guard: { minRole: 'ADMIN' } } }, async (request, reply) => {
    const b = parse(createCategoryBody, request.body);
    const created = await categories.create({ code: b.code, name: b.name, warrantyMonths: b.warrantyMonths }, adminActor(request));
    reply.code(201);
    return categoryJson(created);
  });

  // ── Collections ──────────────────────────────────────────────────────────

  app.get('/api/admin/collections', async () => {
    const rows = await db
      .selectFrom('collections as c')
      .leftJoin('models as m', 'm.collection_id', 'c.id')
      .select((eb) => ['c.id', 'c.name', 'c.created_at', eb.fn.count<number>('m.id').as('models')])
      .groupBy(['c.id', 'c.name', 'c.created_at'])
      .orderBy('c.name')
      .execute();
    return itemsOf(rows.map((r) => ({ id: r.id, name: r.name, models: Number(r.models), createdAt: r.created_at })));
  });

  app.post('/api/admin/collections', async (request, reply) => {
    const b = parse(createCollectionBody, request.body);
    const actor = adminActor(request);
    try {
      const row = await inTransaction(db, async (tx) => {
        const r = await tx.insertInto('collections').values({ name: b.name, created_at: ctx.clock() }).returningAll().executeTakeFirstOrThrow();
        await audit.record({ actor, action: 'collection.create', targetType: 'collection', targetId: r.id, details: { name: r.name } }, tx);
        return r;
      });
      reply.code(201);
      return { id: row.id, name: row.name, models: 0, createdAt: row.created_at };
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('COLLECTION_EXISTS', 'A collection with this name already exists.');
      throw e;
    }
  });

  // ── Models ───────────────────────────────────────────────────────────────

  const modelQuery = () =>
    db
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

  type ModelRow = Awaited<ReturnType<ReturnType<typeof modelQuery>['executeTakeFirstOrThrow']>>;
  const modelJson = (r: ModelRow) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    skuPrefix: r.sku_prefix,
    category: { index: r.category_index, code: r.category_code.trim(), name: r.category_name },
    collection: r.collection_id ? { id: r.collection_id, name: r.collection_name } : null,
    defaultMaterial: r.default_material,
    careInstructions: r.care_instructions,
    createdAt: r.created_at,
  });

  app.get('/api/admin/models', async () => itemsOf((await modelQuery().orderBy('c.code').orderBy('m.name').execute()).map(modelJson)));

  app.post('/api/admin/models', async (request, reply) => {
    const b = parse(createModelBody, request.body);
    const actor = adminActor(request);
    const category = await categories.getByCode(b.categoryCode);
    if (!category) throw notFound('Category', 'CATEGORY_NOT_FOUND');
    if (b.collectionId !== undefined) {
      const col = await db.selectFrom('collections').select('id').where('id', '=', b.collectionId).executeTakeFirst();
      if (!col) throw notFound('Collection', 'COLLECTION_NOT_FOUND');
    }
    try {
      const id = await inTransaction(db, async (tx) => {
        const r = await tx
          .insertInto('models')
          .values({
            category_id: category.index,
            collection_id: b.collectionId ?? null,
            name: b.name,
            type: b.type,
            sku_prefix: b.skuPrefix,
            default_material: b.defaultMaterial ?? null,
            care_instructions: b.careInstructions ?? null,
            created_at: ctx.clock(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await audit.record(
          {
            actor,
            action: 'model.create',
            targetType: 'model',
            targetId: r.id,
            details: { name: b.name, type: b.type, skuPrefix: b.skuPrefix, category: category.code, collectionId: b.collectionId ?? null },
          },
          tx,
        );
        return r.id;
      });
      reply.code(201);
      return modelJson(await modelQuery().where('m.id', '=', id).executeTakeFirstOrThrow());
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('SKU_PREFIX_TAKEN', 'Another model already uses this SKU prefix.');
      throw e;
    }
  });
};
