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
 * The ENGRAVING's prices and its YOUR ORDERS switch are an ADMIN's (the owner's amendment of 25 Oct, single-queue/
 * ANSWERS.md "Q2 BUILD QUESTIONS — DECIDED": "ADMIN ONLY in the console (not OPERATOR)"; lot Q3, step Q3.9): an OPERATOR
 * changing either (or creating the engraving with a price or that switch) gets 403 FORBIDDEN; every other field of the
 * engraving, and every other add-on, stays an OPERATOR's.
 *
 * Audited by AddonService (`addon.create`, `.update`, `.prices`, `.set_aside`, `.reinstate`, `.shopify`). A product's
 * stock is moved through Logistics (corrections, transfers, minimums) and the supplier orders, as a size's
 * (routes/admin/logistics.ts, routes/admin/supplier-orders.ts); a service has none (409 ADDON_SERVICE there).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { addonParams, addonPricesBody, addonShopifyBody, addonsQuery, createAddonBody, emptyBody, parse, updateAddonBody } from '../../http/schemas.js';
import { forbidden } from '../../errors.js';
import { adminActor, hasRole, requireAdmin } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };

/** The amendment of 25 Oct: the ENGRAVING's prices and its YOUR ORDERS switch, changed by an ADMIN only. */
function engravingAdminOnly(request: FastifyRequest, touched: boolean): void {
  if (touched && !hasRole(requireAdmin(request).admin.role, 'ADMIN')) throw forbidden('Only an ADMIN changes the ENGRAVING’s prices and its YOUR ORDERS switch.');
}

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
    engravingAdminOnly(request, b.engraving === true && (Object.values(b.prices ?? {}).some((v) => v !== undefined) || b.offeredAt?.orders !== undefined));
    const created = await addons.create({ ...given(b), name: b.name, skuCode: b.skuCode, ...(b.prices ? { prices: given(b.prices) } : {}) }, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/addons/:id', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    const b = parse(updateAddonBody, request.body);
    if (b.offeredAt?.orders !== undefined) {
      const a = await addons.get(id);
      engravingAdminOnly(request, (a.engraving || b.engraving === true) && b.offeredAt.orders !== a.offeredAt.orders);
    }
    return addons.update(id, given(b), adminActor(request));
  });

  app.put('/api/admin/addons/:id/prices', { config: OPERATOR }, async (request) => {
    const { id } = parse(addonParams, request.params);
    const b = parse(addonPricesBody, request.body);
    const a = await addons.get(id);
    if (a.engraving) {
      const now = new Map(a.prices.map((p) => [p.currency, p.priceMinor]));
      engravingAdminOnly(request, Object.entries(b.prices).some(([currency, v]) => v !== undefined && v !== (now.get(currency as (typeof a.prices)[number]['currency']) ?? null)));
    }
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
