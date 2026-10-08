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
 *
 * The LOGISTICS role (plan NEXT LOT of 2026-10-07, §3.5.6.1): one login per person at the logistics agent, tied on Team
 * to the locations it works at (admin_user_locations). The Logistics routes name their roles: `LOGISTICS_ACT` (the agent
 * and the roles that mutate: receptions, packing, shipping, returns received) and `LOGISTICS_READ` (the agent and every
 * role from AUDITOR). `logisticsScope` gives a route the login's locations, a set, for LOGISTICS, and null (every
 * location) otherwise; a row of a location outside the scope answers 404, never 403, so other locations are not even
 * confirmed to exist.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import type { AdminRole } from '../../db/schema.js';
import { createCarrierBody, createLocationBody, logisticsParams, parse, updateCarrierBody, updateLocationBody } from '../../http/schemas.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

/** Who acts on the Logistics routes: the agent (its own locations), OPERATOR and ADMIN; never AUDITOR nor RETAIL. */
export const LOGISTICS_ACT: readonly AdminRole[] = Object.freeze(['LOGISTICS', 'OPERATOR', 'ADMIN'] as const);
/** Who reads the Logistics routes: the agent (its own locations) and every role from AUDITOR; never RETAIL. */
export const LOGISTICS_READ: readonly AdminRole[] = Object.freeze(['LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const);

/** The locations a request may see: a LOGISTICS login's own, or null for ORBES staff (every location). */
export type LogisticsScope = ReadonlySet<string> | null;

/** The request's location scope (plan NEXT LOT §3.5.6.1): the LOGISTICS login's locations, read at every request; null otherwise. */
export async function logisticsScope(ctx: AppContext, request: FastifyRequest): Promise<LogisticsScope> {
  const { admin } = requireAdmin(request);
  if (admin.role !== 'LOGISTICS') return null;
  return new Set(await ctx.services.auth.adminLocations(admin.id));
}

/** Whether a location is within a scope (null: every location). */
export function inLogisticsScope(scope: LogisticsScope, locationId: string): boolean {
  return scope === null || scope.has(locationId.toLowerCase());
}

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
