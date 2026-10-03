/**
 * Catalogue: categories (ADMIN to create, activate and deactivate: their
 * 5-bit index is permanent, CategoryRegistry), collections and models
 * (OPERATOR to create and edit, CatalogService). A model's name, default
 * material, care instructions, collection and `active` change after
 * issuance, and a collection's name; never a model's category nor its SKU
 * prefix (A-10). A model's lookbook (P-R02: its place, address, story and
 * specifications) changes through the same edit; one model is read alone by
 * the console's Lookbook page (its gallery is routes/admin/media.ts's). The
 * services validate, write and audit; these routes only parse and shape.
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

/** `products`: the pieces issued in the category, which a deactivation leaves verifying as before (A-10). */
function categoryJson(c: CategoryRecord, issued: ReadonlyMap<number, number>) {
  return { index: c.index, code: c.code, name: c.name, warrantyMonths: c.warrantyMonths, active: c.active, createdAt: c.createdAt, products: issued.get(c.index) ?? 0 };
}

export const adminCatalogRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { categories } = ctx;
  const { catalog } = ctx.services;

  // ── Categories ───────────────────────────────────────────────────────────

  app.get('/api/admin/categories', async () => {
    const list = await categories.list();
    const issued = await catalog.issuedByCategory();
    return itemsOf(list.map((c) => categoryJson(c, issued)));
  });

  app.post('/api/admin/categories', { config: { guard: { minRole: 'ADMIN' } } }, async (request, reply) => {
    const b = parse(createCategoryBody, request.body);
    const created = await categories.create({ code: b.code, name: b.name, warrantyMonths: b.warrantyMonths }, adminActor(request));
    reply.code(201);
    return categoryJson(created, new Map());
  });

  // A deactivated category receives no new product; its pieces keep verifying (the registry still resolves it).
  app.post('/api/admin/categories/:code/active', { config: { guard: { minRole: 'ADMIN' } } }, async (request) => {
    const { code } = parse(categoryParams, request.params);
    const b = parse(categoryActiveBody, request.body);
    const updated = await categories.setActive(code, b.active, adminActor(request));
    return categoryJson(updated, await catalog.issuedByCategory());
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

  // One model, as the list has it (P-R02: the console's Lookbook page of the model).
  app.get('/api/admin/models/:id', async (request) => {
    const { id } = parse(catalogParams, request.params);
    return catalog.getModel(id);
  });

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
        ...(b.lookbook !== undefined ? { lookbook: b.lookbook } : {}),
        ...(b.slug !== undefined ? { slug: b.slug } : {}),
        ...(b.story !== undefined ? { story: b.story } : {}),
        ...(b.specs !== undefined ? { specs: b.specs } : {}),
      },
      adminActor(request),
    );
  });
};
