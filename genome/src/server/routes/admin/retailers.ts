/**
 * Points of sale (A-08): the register a warranty's point of sale is chosen
 * from, in the product page's Activate warranty dialog and in the sale mode.
 *
 * - `GET /api/admin/retailers` (RETAIL, AUDITOR, OPERATOR and ADMIN, read
 *   only; `?active=true` for the lists a sale is chosen from): the sale mode of
 *   a seller's phone must show them, so this read is open to RETAIL, the only
 *   one besides the sale routes and the seller's own session; the roles are
 *   named so that LOGISTICS, ranked with RETAIL, never gets them (plan NEXT LOT
 *   §3.5.6.1);
 * - `POST /api/admin/retailers` and `PATCH /api/admin/retailers/:id`
 *   (ADMIN): create, rename, move, deactivate or reactivate. A point of sale
 *   is never deleted (warranties point to it); an inactive one leaves the
 *   lists and refuses new activations (409 RETAILER_INACTIVE).
 *
 * Every write is audited by RetailerService (`retailer.create`,
 * `retailer.update` with the values before and after).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { AdminRole } from '../../db/schema.js';
import { createRetailerBody, parse, retailerListQuery, retailerParams, updateRetailerBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { RetailerRecord } from '../../services/retailers.js';
import type { AdminRouteDeps } from './index.js';
import { itemsOf } from './serialize.js';

/** Who reads the points of sale: every role but LOGISTICS. */
const RETAILER_READERS: readonly AdminRole[] = Object.freeze(['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const);

export function retailerJson(r: RetailerRecord) {
  return { id: r.id, name: r.name, city: r.city, country: r.country, active: r.active, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export const adminRetailerRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { retailers } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  // Plan NEXT LOT §3.5.6.1: the roles named, so that LOGISTICS, ranked with RETAIL, never gets the points of sale.
  app.get('/api/admin/retailers', { config: { guard: { roles: RETAILER_READERS } } }, async (request) => {
    const q = parse(retailerListQuery, request.query);
    return itemsOf((await retailers.list({ activeOnly: q.active === true })).map(retailerJson));
  });

  app.post('/api/admin/retailers', { config: ADMIN }, async (request, reply) => {
    const b = parse(createRetailerBody, request.body);
    reply.code(201);
    return { retailer: retailerJson(await retailers.create({ name: b.name, city: b.city ?? null, country: b.country ?? null }, adminActor(request))) };
  });

  app.patch('/api/admin/retailers/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(retailerParams, request.params);
    const b = parse(updateRetailerBody, request.body);
    return { retailer: retailerJson(await retailers.update(id, b, adminActor(request))) };
  });
};
