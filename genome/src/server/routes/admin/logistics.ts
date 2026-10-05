/**
 * Locations and carriers, the console's settings (plan LIVE RELEASE+ of 2026-10-04, choices 16 and 17; services/stock.ts):
 * FRANCE WAREHOUSE and LOGISTICS WAREHOUSE created at the first boot, more added, one the default; Colissimo, Chronopost,
 * DHL Express and UPS with their tracking links, editable, more added.
 *
 *   GET    /api/admin/locations         AUDITOR  every location, the default first
 *   POST   /api/admin/locations         ADMIN    a location added
 *   PATCH  /api/admin/locations/:id     ADMIN    renamed, or made the default
 *   GET    /api/admin/carriers          AUDITOR  every carrier, the active ones first
 *   POST   /api/admin/carriers          ADMIN    a carrier added with its tracking link
 *   PATCH  /api/admin/carriers/:id      ADMIN    its name, its tracking link, offered or set aside
 *
 * Audited by StockService (`stock.location.create`, `.update`, `carrier.create`, `carrier.update`).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createCarrierBody, createLocationBody, logisticsParams, parse, updateCarrierBody, updateLocationBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminLogisticsRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { stock } = ctx.services;

  app.get('/api/admin/locations', async () => ({ items: await stock.locations() }));

  app.post('/api/admin/locations', { config: ADMIN }, async (request, reply) => {
    const b = parse(createLocationBody, request.body);
    const created = await stock.createLocation(b, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/locations/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(logisticsParams, request.params);
    const b = parse(updateLocationBody, request.body);
    return stock.updateLocation(id, { ...(b.name !== undefined ? { name: b.name } : {}), ...(b.isDefault ? { isDefault: true as const } : {}) }, adminActor(request));
  });

  app.get('/api/admin/carriers', async () => ({ items: await stock.carriers() }));

  app.post('/api/admin/carriers', { config: ADMIN }, async (request, reply) => {
    const b = parse(createCarrierBody, request.body);
    const created = await stock.createCarrier(b, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/carriers/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(logisticsParams, request.params);
    const b = parse(updateCarrierBody, request.body);
    return stock.updateCarrier(id, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), adminActor(request));
  });
};
