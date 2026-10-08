/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.6.9): the stock, the receptions, the orders to ship and the order cases of
 * the agent's locations (steps 5.7 to 5.10). Today's locations and carriers moved to routes/admin/locations.ts (step 5.6).
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
import { requireAdmin } from '../../http/sessions.js';
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

export const adminLogisticsRoutes: FastifyPluginAsync<AdminRouteDeps> = async () => {
  // The Logistics routes come with steps 5.7 to 5.10.
};
