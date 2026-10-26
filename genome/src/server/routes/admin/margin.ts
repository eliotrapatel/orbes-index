/**
 * The margin's settings (macro scope of 2026-10-20, K43 N1 and N2; lot M4 plan §1.2, step M4.2;
 * services/margin-settings.ts). An AUDITOR reads (amounts and keys, nothing personal); an ADMIN writes, as Orders →
 * Settings. Every write answers the whole settings. The margin itself (GET /api/admin/margin and its CSV) joins this
 * file in step M4.3.
 *
 *   GET    /api/admin/margin/settings                  AUDITOR  the rates (and the currencies without one), the bands, the
 *                                                               unit costs and the allowances
 *   PUT    /api/admin/margin/rates/:currency           ADMIN    a currency's euro rate (422 MARGIN_RATE_EUR for EUR)
 *   DELETE /api/admin/margin/rates/:currency           ADMIN    cleared: its amounts left out again
 *   POST   /api/admin/margin/shipping-costs            ADMIN    a band added (409 SHIPPING_COST_TAKEN)
 *   PATCH  /api/admin/margin/shipping-costs/:id        ADMIN    a band changed (404 SHIPPING_COST_NOT_FOUND, 409)
 *   DELETE /api/admin/margin/shipping-costs/:id        ADMIN    a band removed (404 SHIPPING_COST_NOT_FOUND)
 *   PUT    /api/admin/margin/unit-costs/:key           ADMIN    the POUCH, the CARD, THE VAULT CARD, a care service or a
 *                                                               claim outcome's cost
 *   DELETE /api/admin/margin/unit-costs/:key           ADMIN    cleared
 *   PUT    /api/admin/margin/allowances/:categoryId    ADMIN    a category's allowance, a percent (404 CATEGORY_NOT_FOUND)
 *   DELETE /api/admin/margin/allowances/:categoryId    ADMIN    cleared
 *
 * Audited by MarginSettingsService (`margin.rate`, `margin.shipping_cost.*`, `margin.unit_cost`, `margin.allowance`).
 * Validation: the margin schemas of http/schemas.ts (400 VALIDATION_FAILED).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  allowanceBody,
  allowanceParams,
  createShippingCostBody,
  emptyBody,
  marginRateBody,
  marginRateParams,
  parse,
  shippingCostParams,
  unitCostBody,
  unitCostParams,
  updateShippingCostBody,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminMarginRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { marginSettings } = ctx.services;

  app.get('/api/admin/margin/settings', async () => marginSettings.read());

  app.put('/api/admin/margin/rates/:currency', { config: ADMIN }, async (request) => {
    const { currency } = parse(marginRateParams, request.params);
    const b = parse(marginRateBody, request.body);
    return marginSettings.setRate(currency, b.rate, adminActor(request));
  });

  app.delete('/api/admin/margin/rates/:currency', { config: ADMIN }, async (request) => {
    const { currency } = parse(marginRateParams, request.params);
    parse(emptyBody, request.body);
    return marginSettings.clearRate(currency, adminActor(request));
  });

  app.post('/api/admin/margin/shipping-costs', { config: ADMIN }, async (request, reply) => {
    const b = parse(createShippingCostBody, request.body);
    const settings = await marginSettings.addShippingCost(b, adminActor(request));
    reply.code(201);
    return settings;
  });

  app.patch('/api/admin/margin/shipping-costs/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(shippingCostParams, request.params);
    const b = parse(updateShippingCostBody, request.body);
    return marginSettings.updateShippingCost(id, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), adminActor(request));
  });

  app.delete('/api/admin/margin/shipping-costs/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(shippingCostParams, request.params);
    parse(emptyBody, request.body);
    return marginSettings.removeShippingCost(id, adminActor(request));
  });

  app.put('/api/admin/margin/unit-costs/:key', { config: ADMIN }, async (request) => {
    const { key } = parse(unitCostParams, request.params);
    const b = parse(unitCostBody, request.body);
    return marginSettings.setUnitCost(key, b, adminActor(request));
  });

  app.delete('/api/admin/margin/unit-costs/:key', { config: ADMIN }, async (request) => {
    const { key } = parse(unitCostParams, request.params);
    parse(emptyBody, request.body);
    return marginSettings.clearUnitCost(key, adminActor(request));
  });

  app.put('/api/admin/margin/allowances/:categoryId', { config: ADMIN }, async (request) => {
    const { categoryId } = parse(allowanceParams, request.params);
    const b = parse(allowanceBody, request.body);
    return marginSettings.setAllowance(categoryId, b.percent, adminActor(request));
  });

  app.delete('/api/admin/margin/allowances/:categoryId', { config: ADMIN }, async (request) => {
    const { categoryId } = parse(allowanceParams, request.params);
    parse(emptyBody, request.body);
    return marginSettings.clearAllowance(categoryId, adminActor(request));
  });
};
