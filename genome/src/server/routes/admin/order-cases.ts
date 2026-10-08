/**
 * Order cases in the console (plan NEXT LOT of 2026-10-07, §1.1 (b) and §3.5.6.9, step 5.10; services/order-cases.ts):
 * returns, size exchanges and parcel problems, decided by ORBES. Not `cases`: the console's Cases are the customers'
 * reports on scans (`/api/admin/reports`, §16.8). The agent's own routes (report a parcel problem, the parcels to
 * receive, received) are in routes/admin/logistics.ts; Client Services opens a return in routes/admin/orders.ts.
 *
 *   GET    /api/admin/order-cases/:id           AUDITOR   one order case (its notes withheld from an AUDITOR)
 *   POST   /api/admin/order-cases/:id/decide    OPERATOR  ORBES's decision (a LOST parcel and the archive: ADMIN, 403
 *                                                         otherwise); the claim code of a piece back to stock (a
 *                                                         return's `claimCode`, a damaged parcel's `claimCodes`), once,
 *                                                         no-store
 *   POST   /api/admin/order-cases/:id/cancel    OPERATOR  ended with no decision, with a note
 *
 * A LOGISTICS login never reaches them (the default rule ranks it below AUDITOR).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { cancelOrderCaseBody, decideOrderCaseBody, orderCaseParams, parse } from '../../http/schemas.js';
import { adminActor, hasRole, requireAdmin } from '../../http/sessions.js';
import type { OrderCaseRecord } from '../../services/order-cases.js';
import type { AdminRouteDeps } from './index.js';

/**
 * An order case as the caller may read it: every note withheld from an AUDITOR (the opening note, the agent's on the
 * parcel back, ORBES's decision's and the cancellation's, which often quotes the client), the rest as it is.
 */
export function orderCaseJson(request: FastifyRequest, c: OrderCaseRecord): OrderCaseRecord {
  const { admin } = requireAdmin(request);
  if (hasRole(admin.role, 'OPERATOR')) return c;
  return {
    ...c,
    note: null,
    received: c.received ? { ...c.received, note: null } : null,
    decision: c.decision ? { ...c.decision, note: null } : null,
    cancelled: c.cancelled ? { ...c.cancelled, note: null } : null,
  };
}

export const adminOrderCaseRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { orderCases } = ctx.services;

  app.get('/api/admin/order-cases/:id', async (request) => {
    const { id } = parse(orderCaseParams, request.params);
    return orderCaseJson(request, await orderCases.get(id));
  });

  // The answer may carry a claim code (only its hash is kept): never stored by a cache.
  app.post('/api/admin/order-cases/:id/decide', async (request, reply) => {
    const { id } = parse(orderCaseParams, request.params);
    const b = parse(decideOrderCaseBody, request.body);
    const { admin } = requireAdmin(request);
    const r = await orderCases.decide(id, { decision: b.decision, pieceTo: b.pieceTo ?? null, locationId: b.locationId ?? null, note: b.note ?? null }, adminActor(request), { admin: hasRole(admin.role, 'ADMIN') });
    reply.header('cache-control', 'no-store');
    return { case: orderCaseJson(request, r.case), ...(r.productId ? { productId: r.productId } : {}), ...(r.claimCode ? { claimCode: r.claimCode } : {}), ...(r.claimCodes ? { claimCodes: r.claimCodes } : {}) };
  });

  app.post('/api/admin/order-cases/:id/cancel', async (request) => {
    const { id } = parse(orderCaseParams, request.params);
    const b = parse(cancelOrderCaseBody, request.body);
    return orderCaseJson(request, await orderCases.cancel(id, { note: b.note }, adminActor(request)));
  });

};
