/**
 * The standard boxes, a setting of the orders (macro scope of 2026-10-20, D16 B1; plan MACRO M3 §1.2, services/boxes.ts):
 * the owner's real boxes, each with its inside sides, empty weight and cost, the 95 × 62 mm certificate card taken flat.
 * Beside the locations and carriers (routes/admin/locations.ts): an AUDITOR reads, an ADMIN writes.
 *
 *   GET    /api/admin/boxes                   AUDITOR  every box, the active ones first, with how many models name it
 *   POST   /api/admin/boxes                   ADMIN    a box added (422 BOX_TOO_SMALL_FOR_CARD, 409 BOX_NAME_TAKEN)
 *   PATCH  /api/admin/boxes/:id               ADMIN    any of its fields
 *   POST   /api/admin/boxes/:id/set-aside     ADMIN    offered for no model nor parcel (409 BOX_IN_USE while an active
 *                                                      model packs in it)
 *   POST   /api/admin/boxes/:id/reinstate     ADMIN    offered again
 *
 * Audited by BoxService (`box.create`, `box.update`, `box.set_aside`, `box.reinstate`). A model's box and packed weight
 * are set on its page (PUT /api/admin/models/:id/packing, OPERATOR, routes/admin/catalog.ts); a parcel's box is chosen
 * while it is packed (POST /api/admin/logistics/orders/:id/packing/box, routes/admin/logistics.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { boxParams, createBoxBody, emptyBody, parse, updateBoxBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminBoxRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { boxes } = ctx.services;

  app.get('/api/admin/boxes', async () => ({ items: await boxes.list() }));

  app.post('/api/admin/boxes', { config: ADMIN }, async (request, reply) => {
    const b = parse(createBoxBody, request.body);
    const created = await boxes.create(b, adminActor(request));
    reply.code(201);
    return created;
  });

  app.patch('/api/admin/boxes/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(boxParams, request.params);
    const b = parse(updateBoxBody, request.body);
    return boxes.update(id, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), adminActor(request));
  });

  app.post('/api/admin/boxes/:id/set-aside', { config: ADMIN }, async (request) => {
    const { id } = parse(boxParams, request.params);
    parse(emptyBody, request.body);
    return boxes.setAside(id, adminActor(request));
  });

  app.post('/api/admin/boxes/:id/reinstate', { config: ADMIN }, async (request) => {
    const { id } = parse(boxParams, request.params);
    parse(emptyBody, request.body);
    return boxes.reinstate(id, adminActor(request));
  });
};
