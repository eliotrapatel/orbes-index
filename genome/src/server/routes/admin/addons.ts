/**
 * The add-ons' catalogue (macro scope of 2026-10-20, K48 D1; plan MACRO M3 §4.2, services/addons.ts): the care kit, the
 * polishing cloth, the chain extender… each with its own SKU and stock, its prices per currency and its supplier, sold
 * with a piece. Beside the models (routes/admin/catalog.ts): an AUDITOR reads, an OPERATOR writes.
 *
 *   GET    /api/admin/addons                    AUDITOR   every add-on, the active ones first, with its SKU, prices
 *                                                         and stock per location; with ?moment=LIVE|DRAW&currency=
 *                                                         (lot Q2), the active ones a release's form picks from, each
 *                                                         with its price there, pickable or why not (SWITCH_OFF,
 *                                                         NO_PRICE)
 *   GET    /api/admin/addons/:id                AUDITOR   one add-on (404 ADDON_NOT_FOUND)
 *   POST   /api/admin/addons                    OPERATOR  an add-on listed with its SKU code (409 ADDON_NAME_TAKEN,
 *                                                         409 SKU_CODE_TAKEN, 404 SUPPLIER_NOT_FOUND), its kind
 *                                                         (PRODUCT or SERVICE, lot Q2), its switches, the engraving
 *                                                         and its most characters (409 ADDON_ENGRAVING_TAKEN)
 *   PATCH  /api/admin/addons/:id                OPERATOR  its name, line, supplier, weight, position, switches, the
 *                                                         engraving and its most characters (its kind never: 409
 *                                                         ADDON_KIND_FIXED; the engraving once sold: 409
 *                                                         ADDON_ENGRAVING_FIXED)
 *   PUT    /api/admin/addons/:id/prices         OPERATOR  its prices by currency (null removes one)
 *   POST   /api/admin/addons/:id/set-aside      OPERATOR  offered nowhere again
 *   POST   /api/admin/addons/:id/reinstate      OPERATOR  offered again
 *   PUT    /api/admin/addons/:id/shopify        OPERATOR  its Shopify product and variant, pasted back (409
 *                                                         SHOPIFY_PRODUCT_TAKEN, SHOPIFY_VARIANT_TAKEN)
 *
 * Audited by AddonService (`addon.create`, `.update`, `.prices`, `.set_aside`, `.reinstate`, `.shopify`). A product's
 * stock is moved through Logistics (corrections, transfers, minimums) and the supplier orders, as a size's
 * (routes/admin/logistics.ts, routes/admin/supplier-orders.ts); a service has none (409 ADDON_SERVICE there).
 */
import type { FastifyPluginAsync } from 'fastify';
import { addonParams, addonPricesBody, addonShopifyBody, addonsQuery, createAddonBody, emptyBody, parse, updateAddonBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };

/** The fields given, an undefined one left out (the service leaves a field not given as it is). */
const given = <T extends object>(b: T): Partial<T> => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as Partial<T>;

export const adminAddonRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { addons } = ctx.services;

  app.get('/api/admin/addons', async (request) => {
    const q = parse(addonsQuery, request.query);
    // Lot Q2, step Q2.3: a release's form lists the add-ons it may pick, and why not.
    if (q.moment !== undefined && q.currency !== undefined) return { items: await addons.pickable(q.moment, q.currency) };
    return { items: await addons.list() };
  });

  app.get('/api/admin/addons/:id', async (request) => {
    const { id } = parse(addonParams, request.params);
    return addons.get(id);
  });

  app.post('/api/admin/addons', { config: OPERATOR }, async (request, reply) => {
    const b = parse(createAddonBody, request.body);
    const created = await addons.create({ ...given(b), name: b.name, skuCode: b.skuCode, ...(b.prices ? { prices: given(b.prices) } : {}) }, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/addons/:id', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    return addons.update(id, given(parse(updateAddonBody, request.body)), adminActor(request));
  });

  app.put('/api/admin/addons/:id/prices', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    const b = parse(addonPricesBody, request.body);
    return addons.setPrices(id, given(b.prices), adminActor(request));
  });

  app.post('/api/admin/addons/:id/set-aside', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    parse(emptyBody, request.body);
    return addons.setAside(id, adminActor(request));
  });

  app.post('/api/admin/addons/:id/reinstate', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    parse(emptyBody, request.body);
    return addons.reinstate(id, adminActor(request));
  });

  app.put('/api/admin/addons/:id/shopify', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    const b = parse(addonShopifyBody, request.body);
    return addons.setShopify(id, b, adminActor(request));
  });
};
