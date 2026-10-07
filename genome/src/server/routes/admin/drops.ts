/**
 * Drops (P-R03; API §16.19): the console's Club page, its Drops tab.
 *
 *   GET   /api/admin/drops                                  AUDITOR   every drop, the latest created first
 *   POST  /api/admin/drops                                  OPERATOR  a DRAFT, its seed drawn and committed (its price optional)
 *   GET   /api/admin/drops/:id                              AUDITOR   one drop, its entries counted by status
 *   PATCH /api/admin/drops/:id                              OPERATOR  any field of a DRAFT; the description after
 *   POST  /api/admin/drops/:id/publish                      OPERATOR  on /verify/releases, with its seed's SHA-256
 *   POST  /api/admin/drops/:id/cancel                       OPERATOR  before its draw only
 *   POST  /api/admin/drops/:id/draw                         ADMIN     after `closes_at`, once
 *   GET   /api/admin/drops/:id/entries                      AUDITOR   its entries (by rank once drawn)
 *   POST  /api/admin/drops/:id/entries/:entryId/confirm     OPERATOR  CONFIRMED: the sale concluded
 *   POST  /api/admin/drops/:id/entries/:entryId/lapse       OPERATOR  LAPSED, after `respond_by` only
 *   POST  /api/admin/drops/:id/offer-next                   OPERATOR  the next of the waiting list, SELECTED
 *
 * A drop and its entries carry THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01): `guaranteed` (places and pieces), and each
 * entry's `guaranteed` and `pieces`; the guarantees of a release are GET /api/admin/drops/:id/guarantees (guarantees.ts).
 *
 * An AUDITOR reads the customers' emails masked (`j***@example.com`);
 * OPERATOR and ADMIN read them in clear (serialize.ts `clientEmail`). No
 * route returns a drop's seed before its draw, nor ever its sealed seed.
 * services/drops.ts validates, locks and audits; these routes parse and shape.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  createDropBody,
  dropEntriesQuery,
  dropEntryNoteBody,
  dropEntryParams,
  dropParams,
  emptyBody,
  pageOf,
  parse,
  updateDropBody,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminDropEntry } from '../../services/drops.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

function entryJson(e: AdminDropEntry, inClear: boolean) {
  return { ...e, email: clientEmail(e.email, inClear) };
}

export const adminDropRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { drops } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  app.get('/api/admin/drops', async (request) => drops.list(pageOf(request.query)));

  app.post('/api/admin/drops', async (request, reply) => {
    const b = parse(createDropBody, request.body);
    const created = await drops.create(
      {
        modelId: b.modelId,
        title: b.title,
        description: b.description ?? null,
        quantity: b.quantity,
        opensAt: b.opensAt,
        closesAt: b.closesAt,
        ...(b.purchaseWindowHours !== undefined ? { purchaseWindowHours: b.purchaseWindowHours } : {}),
        ...(b.earlyAccessHours !== undefined ? { earlyAccessHours: b.earlyAccessHours } : {}),
        ...(b.earlyAccessPlatineHours !== undefined ? { earlyAccessPlatineHours: b.earlyAccessPlatineHours } : {}),
        ...(b.priceMinor !== undefined ? { priceMinor: b.priceMinor, currency: b.currency } : {}),
      },
      adminActor(request),
    );
    reply.code(201);
    return created;
  });

  app.get('/api/admin/drops/:id', async (request) => {
    const { id } = parse(dropParams, request.params);
    return drops.get(id);
  });

  app.patch('/api/admin/drops/:id', async (request) => {
    const { id } = parse(dropParams, request.params);
    const b = parse(updateDropBody, request.body);
    return drops.update(
      id,
      {
        ...(b.modelId !== undefined ? { modelId: b.modelId } : {}),
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.quantity !== undefined ? { quantity: b.quantity } : {}),
        ...(b.opensAt !== undefined ? { opensAt: b.opensAt } : {}),
        ...(b.closesAt !== undefined ? { closesAt: b.closesAt } : {}),
        ...(b.purchaseWindowHours !== undefined ? { purchaseWindowHours: b.purchaseWindowHours } : {}),
        ...(b.earlyAccessHours !== undefined ? { earlyAccessHours: b.earlyAccessHours } : {}),
        ...(b.earlyAccessPlatineHours !== undefined ? { earlyAccessPlatineHours: b.earlyAccessPlatineHours } : {}),
        ...(b.priceMinor !== undefined ? { priceMinor: b.priceMinor, currency: b.currency } : {}),
      },
      adminActor(request),
    );
  });

  app.post('/api/admin/drops/:id/publish', async (request) => {
    const { id } = parse(dropParams, request.params);
    parse(emptyBody, request.body);
    return drops.publish(id, adminActor(request));
  });

  app.post('/api/admin/drops/:id/cancel', async (request) => {
    const { id } = parse(dropParams, request.params);
    parse(emptyBody, request.body);
    return drops.cancel(id, adminActor(request));
  });

  // The draw: ADMIN only (the console asks for a typed phrase first).
  app.post('/api/admin/drops/:id/draw', { config: ADMIN }, async (request) => {
    const { id } = parse(dropParams, request.params);
    parse(emptyBody, request.body);
    return drops.draw(id, adminActor(request));
  });

  app.get('/api/admin/drops/:id/entries', async (request) => {
    const { id } = parse(dropParams, request.params);
    const q = parse(dropEntriesQuery, request.query);
    const page = await drops.entries(id, q.status ? { status: q.status } : {}, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((e) => entryJson(e, inClear)) };
  });

  app.post('/api/admin/drops/:id/entries/:entryId/confirm', async (request) => {
    const { id, entryId } = parse(dropEntryParams, request.params);
    const b = parse(dropEntryNoteBody, request.body);
    return entryJson(await drops.confirm(id, entryId, b.note ?? null, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/drops/:id/entries/:entryId/lapse', async (request) => {
    const { id, entryId } = parse(dropEntryParams, request.params);
    const b = parse(dropEntryNoteBody, request.body);
    return entryJson(await drops.lapse(id, entryId, b.note ?? null, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/drops/:id/offer-next', async (request) => {
    const { id } = parse(dropParams, request.params);
    parse(emptyBody, request.body);
    return entryJson(await drops.offerNext(id, adminActor(request)), readsClientEmails(request));
  });
};
