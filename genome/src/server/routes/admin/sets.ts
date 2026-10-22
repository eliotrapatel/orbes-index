/**
 * THE SET's catalogue (macro scope of 2026-10-20, K44 T1; plan MACRO M3 §5.2, services/sets.ts): 2 to 4 models grouped
 * at one price, sold as their own release. Beside the models and the add-ons: an AUDITOR reads, an OPERATOR writes.
 *
 *   GET    /api/admin/sets                    AUDITOR   every set, the active ones first, with its pieces, their sizes
 *                                                       and photographs, and its releases
 *   GET    /api/admin/sets/:id                AUDITOR   one set (404 SET_NOT_FOUND)
 *   POST   /api/admin/sets                    OPERATOR  a set made (409 SET_NAME_TAKEN, SET_CODE_TAKEN; 422 SET_MODELS;
 *                                                       404 MODEL_NOT_FOUND)
 *   PATCH  /api/admin/sets/:id                OPERATOR  its name, code, base price; its pieces while no release names it
 *                                                       (409 SET_IN_USE)
 *   POST   /api/admin/sets/:id/set-aside      OPERATOR  no new release of it
 *   POST   /api/admin/sets/:id/reinstate      OPERATOR  offered again
 *   PUT    /api/admin/sets/:id/shopify        OPERATOR  its Shopify product, pasted back (409 SHOPIFY_PRODUCT_TAKEN)
 *
 * Audited by SetService (`set.create`, `.update`, `.set_aside`, `.reinstate`, `.shopify`).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createSetBody, emptyBody, parse, setParams, setShopifyBody, updateSetBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };

/** The fields given, an undefined one left out (the service leaves a field not given as it is). */
const given = <T extends object>(b: T): Partial<T> => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as Partial<T>;

export const adminSetRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { sets } = ctx.services;

  app.get('/api/admin/sets', async () => ({ items: await sets.list() }));

  app.get('/api/admin/sets/:id', async (request) => {
    const { id } = parse(setParams, request.params);
    return sets.get(id);
  });

  app.post('/api/admin/sets', { config: OPERATOR }, async (request, reply) => {
    const b = parse(createSetBody, request.body);
    const created = await sets.create({ ...given(b), name: b.name, code: b.code, modelIds: b.modelIds }, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/sets/:id', { config: OPERATOR }, async (request) => {
    const { id } = parse(setParams, request.params);
    return sets.update(id, given(parse(updateSetBody, request.body)), adminActor(request));
  });

  app.post('/api/admin/sets/:id/set-aside', { config: OPERATOR }, async (request) => {
    const { id } = parse(setParams, request.params);
    parse(emptyBody, request.body);
    return sets.setAside(id, adminActor(request));
  });

  app.post('/api/admin/sets/:id/reinstate', { config: OPERATOR }, async (request) => {
    const { id } = parse(setParams, request.params);
    parse(emptyBody, request.body);
    return sets.reinstate(id, adminActor(request));
  });

  app.put('/api/admin/sets/:id/shopify', { config: OPERATOR }, async (request) => {
    const { id } = parse(setParams, request.params);
    return sets.setShopify(id, parse(setShopifyBody, request.body), adminActor(request));
  });
};
