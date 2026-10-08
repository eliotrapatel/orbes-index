/**
 * Locations and carriers, the console's settings (plan LIVE RELEASE+ of 2026-10-04, choices 16 and 17; services/stock.ts):
 * FRANCE WAREHOUSE and LOGISTICS WAREHOUSE created at the first boot, more added, one the default; Colissimo, Chronopost,
 * DHL Express and UPS with their tracking links, editable, more added. Moved unchanged from routes/admin/logistics.ts
 * (plan NEXT LOT §3.5.6.9, step 5.6), which now holds the Logistics routes; a location gains its postal address.
 *
 *   GET    /api/admin/locations         AUDITOR  every location, the default first, with its address
 *   POST   /api/admin/locations         ADMIN    a location added, with its address when given
 *   PATCH  /api/admin/locations/:id     ADMIN    renamed, made the default, or its address entered or cleared (null)
 *   GET    /api/admin/carriers          AUDITOR  every carrier, the active ones first
 *   POST   /api/admin/carriers          ADMIN    a carrier added with its tracking link
 *   PATCH  /api/admin/carriers/:id      ADMIN    its name, its tracking link, offered or set aside
 *
 * Audited by StockService (`stock.location.create`, `.update` — the address by `fields: ['address']`, never its words —,
 * `carrier.create`, `carrier.update`).
 */
import type { FastifyPluginAsync } from 'fastify';
import { createCarrierBody, createLocationBody, logisticsParams, parse, updateCarrierBody, updateLocationBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminLocationRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { stock } = ctx.services;

  app.get('/api/admin/locations', async () => ({ items: await stock.locations() }));

  app.post('/api/admin/locations', { config: ADMIN }, async (request, reply) => {
    const b = parse(createLocationBody, request.body);
    const created = await stock.createLocation({ name: b.name, ...(b.address !== undefined ? { address: b.address } : {}) }, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/locations/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(logisticsParams, request.params);
    const b = parse(updateLocationBody, request.body);
    return stock.updateLocation(
      id,
      { ...(b.name !== undefined ? { name: b.name } : {}), ...(b.isDefault ? { isDefault: true as const } : {}), ...(b.address !== undefined ? { address: b.address } : {}) },
      adminActor(request),
    );
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
