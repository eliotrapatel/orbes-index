/**
 * WORN in the console (plan MACRO M2 §2.2 and §2.4, D31 G2; lot M2 step M2.7; services/worn.ts), read by the WORN page
 * (Clients, lot M2 step M2.9).
 *
 *   GET    /api/admin/worn                   AUDITOR   one list (?queue=TO_REVIEW|PUBLISHED|ENDED, TO_REVIEW by default;
 *                                                      ?model= a model's group; ?page&pageSize): the photograph's address
 *                                                      while live, the credit, the piece, the owner (email masked for an
 *                                                      AUDITOR), the dates, the reviewer
 *   GET    /api/admin/worn/summary           AUDITOR   the badge: how many TO REVIEW, how many published, the oldest
 *   GET    /api/admin/worn/:id/photo         AUDITOR   a photograph in review or published (no-store)
 *   POST   /api/admin/worn/:id/publish       OPERATOR  PUBLISH a photograph in review              worn.publish
 *   POST   /api/admin/worn/:id/refuse        OPERATOR  REFUSE it {refusal}, its bytes erased      worn.refuse
 *   POST   /api/admin/worn/:id/take-down     OPERATOR  TAKE DOWN a published one {refusal}, erased worn.take_down
 *
 * Errors: 404 WORN_NOT_FOUND; 409 WORN_STATE (reviewed already, or not published). Never stored by a cache. RETAIL and
 * LOGISTICS get 403. Every mutation needs the CSRF token and a same-origin request, and is audited by the service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { adminWornQuery, emptyBody, pageOf, parse, wornParams, wornRefusalBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };

export const adminWornRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { worn } = ctx.services;
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/api/admin/worn', async (request) => {
    const q = parse(adminWornQuery, request.query);
    const page = await worn.queue({ queue: q.queue ?? 'TO_REVIEW', modelId: q.model ?? null }, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((w) => ({ ...w, owner: { ...w.owner, email: clientEmail(w.owner.email, inClear) } })) };
  });

  app.get('/api/admin/worn/summary', async () => worn.summary());

  app.get('/api/admin/worn/:id/photo', { config: { rateGroup: 'media' } }, async (request, reply) => {
    const { id } = parse(wornParams, request.params);
    const p = await worn.photo(id, { kind: 'staff' });
    const bytes = p.bytes!;
    return reply.type(p.mime).send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });

  app.post('/api/admin/worn/:id/publish', { config: OPERATOR }, async (request, reply) => {
    const { id } = parse(wornParams, request.params);
    parse(emptyBody, request.body);
    await worn.publish(id, adminActor(request));
    return reply.code(204).send();
  });

  app.post('/api/admin/worn/:id/refuse', { config: OPERATOR }, async (request, reply) => {
    const { id } = parse(wornParams, request.params);
    const b = parse(wornRefusalBody, request.body);
    await worn.refuse(id, b.refusal, adminActor(request));
    return reply.code(204).send();
  });

  app.post('/api/admin/worn/:id/take-down', { config: OPERATOR }, async (request, reply) => {
    const { id } = parse(wornParams, request.params);
    const b = parse(wornRefusalBody, request.body);
    await worn.takeDown(id, b.refusal, adminActor(request));
    return reply.code(204).send();
  });
};
