/**
 * The founding list in the console (plan MACRO M1 §3.1, §3.2; macro scope F2 to F5; services/founding.ts): the people
 * theorbes.com's form added, read by the Founding list page (Clients, lot M1 step M1.12).
 *
 *   GET    /api/admin/founding                   AUDITOR   the rows, newest first, paged (?page&pageSize), filtered
 *                                                          (?matched&unsubscribed&country&sourceKind); emails masked for
 *                                                          an AUDITOR
 *   GET    /api/admin/founding/summary           AUDITOR   on the list, matched, unsubscribed; by country; by source
 *   GET    /api/admin/founding.csv               OPERATOR  every row, in a Shopify customers import's columns
 *   POST   /api/admin/founding/:id/remove        ADMIN     erasure on request, the phrase REMOVE <8> (204)   founding.remove
 *
 * Reads need AUDITOR by the console's default rule (routes/admin/index.ts), the CSV OPERATOR, the removal ADMIN; RETAIL
 * and LOGISTICS get 403. The removal needs the CSRF token and a same-origin request, and is audited by FoundingService.
 */
import type { FastifyPluginAsync } from 'fastify';
import { foundingParams, foundingQuery, foundingRemoveBody, pageOf, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };
const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminFoundingRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { founding } = ctx.services;

  app.get('/api/admin/founding', async (request) => {
    const q = parse(foundingQuery, request.query);
    const page = await founding.list(
      {
        ...(q.matched !== undefined ? { matched: q.matched } : {}),
        ...(q.unsubscribed !== undefined ? { unsubscribed: q.unsubscribed } : {}),
        ...(q.country !== undefined ? { country: q.country } : {}),
        ...(q.sourceKind !== undefined ? { sourceKind: q.sourceKind } : {}),
      },
      pageOf(request.query),
    );
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((e) => ({ ...e, email: clientEmail(e.email, inClear) })) };
  });

  app.get('/api/admin/founding/summary', async () => founding.summary());

  app.get('/api/admin/founding.csv', { config: OPERATOR }, async (request, reply) => {
    const inClear = readsClientEmails(request);
    const file = await founding.csv({ email: (e) => clientEmail(e, inClear) });
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.post('/api/admin/founding/:id/remove', { config: ADMIN }, async (request, reply) => {
    const { id } = parse(foundingParams, request.params);
    const { phrase } = parse(foundingRemoveBody, request.body);
    await founding.remove(id, phrase, adminActor(request));
    return reply.code(204).send();
  });
};
