/**
 * Catalogue: categories (ADMIN to create, activate and deactivate: their
 * 5-bit index is permanent, CategoryRegistry), collections and models
 * (OPERATOR to create and edit, CatalogService). A model's name, default
 * material, care instructions, collection and `active` change after
 * issuance, and a collection's name; never a model's category nor its SKU
 * prefix (A-10). The services validate, write and audit; these routes only
 * parse and shape.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  catalogParams,
  categoryActiveBody,
  categoryParams,
  createCategoryBody,
  createCollectionBody,
  createModelBody,
  parse,
  updateCollectionBody,
  updateModelBody,
} from '../../http/schemas.js';
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

  // A deactivated category receives no new product; its pieces keep verifying (the registry still resolves it).
  app.post('/api/admin/categories/:code/active', { config: { guard: { minRole: 'ADMIN' } } }, async (request) => {
    const { code } = parse(categoryParams, request.params);
    const b = parse(categoryActiveBody, request.body);
    return categoryJson(await categories.setActive(code, b.active, adminActor(request)));
  });

  // ── Collections ──────────────────────────────────────────────────────────

  app.get('/api/admin/collections', async () => itemsOf(await catalog.listCollections()));

  app.post('/api/admin/collections', async (request, reply) => {
    const b = parse(createCollectionBody, request.body);
    const created = await catalog.createCollection({ name: b.name }, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/collections/:id', async (request) => {
    const { id } = parse(catalogParams, request.params);
    const b = parse(updateCollectionBody, request.body);
    return catalog.updateCollection(id, { name: b.name }, adminActor(request));
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

  app.patch('/api/admin/models/:id', async (request) => {
    const { id } = parse(catalogParams, request.params);
    const b = parse(updateModelBody, request.body);
    return catalog.updateModel(
      id,
      {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.defaultMaterial !== undefined ? { defaultMaterial: b.defaultMaterial } : {}),
        ...(b.careInstructions !== undefined ? { careInstructions: b.careInstructions } : {}),
        ...(b.collectionId !== undefined ? { collectionId: b.collectionId } : {}),
        ...(b.active !== undefined ? { active: b.active } : {}),
      },
      adminActor(request),
    );
  });
};
