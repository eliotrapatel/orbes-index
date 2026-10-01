/**
 * Catalogue: categories (ADMIN to create: their 5-bit index is permanent,
 * CategoryRegistry), collections and models (OPERATOR, CatalogService). The
 * services validate, write and audit; these routes only parse and shape.
 */
import type { FastifyPluginAsync } from 'fastify';
import { createCategoryBody, createCollectionBody, createModelBody, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { CategoryRecord } from '../../services/categories.js';
import type { AdminRouteDeps } from './index.js';
import { itemsOf } from './serialize.js';

function categoryJson(c: CategoryRecord) {
  return { index: c.index, code: c.code, name: c.name, warrantyMonths: c.warrantyMonths, active: c.active, createdAt: c.createdAt };
}

export const adminCatalogRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { categories } = ctx;
  const { catalog } = ctx.services;

  // ── Categories ───────────────────────────────────────────────────────────

  app.get('/api/admin/categories', async () => itemsOf((await categories.list()).map(categoryJson)));

  app.post('/api/admin/categories', { config: { guard: { minRole: 'ADMIN' } } }, async (request, reply) => {
    const b = parse(createCategoryBody, request.body);
    const created = await categories.create({ code: b.code, name: b.name, warrantyMonths: b.warrantyMonths }, adminActor(request));
    reply.code(201);
    return categoryJson(created);
  });

  // ── Collections ──────────────────────────────────────────────────────────

  app.get('/api/admin/collections', async () => itemsOf(await catalog.listCollections()));

  app.post('/api/admin/collections', async (request, reply) => {
    const b = parse(createCollectionBody, request.body);
    const created = await catalog.createCollection({ name: b.name }, adminActor(request));
    reply.code(201);
    return created;
  });

  // ── Models ───────────────────────────────────────────────────────────────

  app.get('/api/admin/models', async () => itemsOf(await catalog.listModels()));

  app.post('/api/admin/models', async (request, reply) => {
    const b = parse(createModelBody, request.body);
    const created = await catalog.createModel(
      {
        categoryCode: b.categoryCode,
        collectionId: b.collectionId ?? null,
        name: b.name,
        type: b.type,
        skuPrefix: b.skuPrefix,
        defaultMaterial: b.defaultMaterial ?? null,
        careInstructions: b.careInstructions ?? null,
      },
      adminActor(request),
    );
    reply.code(201);
    return created;
  });
};
