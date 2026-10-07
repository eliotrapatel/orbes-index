/**
 * The circle (P-X01): the console's Club page, its Circle tab.
 *
 *   GET   /api/admin/circle/posts                     AUDITOR   every post, the latest created first (no body)
 *   POST  /api/admin/circle/posts                     OPERATOR  a NOTE, an INVITATION or a POLL, not published yet
 *   GET   /api/admin/circle/posts/:id                 AUDITOR   a post, its photographs, answers counted, a poll's results
 *   PATCH /api/admin/circle/posts/:id                 OPERATOR  any field but its kind
 *   POST  /api/admin/circle/posts/:id/publish         OPERATOR  shown in the circle, from its tier up
 *   POST  /api/admin/circle/posts/:id/unpublish       OPERATOR  withdrawn from it (its answers and votes kept)
 *   GET   /api/admin/circle/posts/:id/answers         AUDITOR   the answers to an invitation
 *
 * Its photographs are routes/admin/media.ts's (the image itself, through
 * MediaService); the panel of Analytics, routes/admin/analytics.ts's. An
 * AUDITOR reads the customers' emails masked (`j***@example.com`); OPERATOR
 * and ADMIN read them in clear (serialize.ts `clientEmail`).
 * services/circle.ts validates, locks and audits; these routes parse and shape.
 */
import type { FastifyPluginAsync } from 'fastify';
import { circleAnswersQuery, circlePostParams, createCirclePostBody, emptyBody, pageOf, parse, updateCirclePostBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

export const adminCircleRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { circle } = ctx.services;

  app.get('/api/admin/circle/posts', async (request) => circle.list(pageOf(request.query)));

  app.post('/api/admin/circle/posts', async (request, reply) => {
    const b = parse(createCirclePostBody, request.body);
    const created = await circle.create(
      {
        kind: b.kind,
        title: b.title,
        ...(b.body !== undefined ? { body: b.body } : {}),
        ...(b.minTier !== undefined ? { minTier: b.minTier } : {}),
        ...(b.eventAt !== undefined ? { eventAt: b.eventAt } : {}),
        ...(b.eventPlace !== undefined ? { eventPlace: b.eventPlace } : {}),
        ...(b.capacity !== undefined ? { capacity: b.capacity } : {}),
        ...(b.pollOptions !== undefined ? { pollOptions: b.pollOptions } : {}),
        ...(b.dropId !== undefined ? { dropId: b.dropId } : {}),
        ...(b.modelId !== undefined ? { modelId: b.modelId } : {}),
        ...(b.externalUrl !== undefined ? { externalUrl: b.externalUrl } : {}),
        ...(b.segmentId !== undefined ? { segmentId: b.segmentId } : {}),
        ...(b.experience !== undefined ? { experience: b.experience } : {}),
      },
      adminActor(request),
    );
    reply.code(201);
    return created;
  });

  app.get('/api/admin/circle/posts/:id', async (request) => {
    const { id } = parse(circlePostParams, request.params);
    return circle.get(id);
  });

  app.patch('/api/admin/circle/posts/:id', async (request) => {
    const { id } = parse(circlePostParams, request.params);
    const b = parse(updateCirclePostBody, request.body);
    return circle.update(
      id,
      {
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.body !== undefined ? { body: b.body } : {}),
        ...(b.minTier !== undefined ? { minTier: b.minTier } : {}),
        ...(b.eventAt !== undefined ? { eventAt: b.eventAt } : {}),
        ...(b.eventPlace !== undefined ? { eventPlace: b.eventPlace } : {}),
        ...(b.capacity !== undefined ? { capacity: b.capacity } : {}),
        ...(b.pollOptions !== undefined ? { pollOptions: b.pollOptions } : {}),
        ...(b.dropId !== undefined ? { dropId: b.dropId } : {}),
        ...(b.modelId !== undefined ? { modelId: b.modelId } : {}),
        ...(b.externalUrl !== undefined ? { externalUrl: b.externalUrl } : {}),
        ...(b.segmentId !== undefined ? { segmentId: b.segmentId } : {}),
        ...(b.experience !== undefined ? { experience: b.experience } : {}),
      },
      adminActor(request),
    );
  });

  app.post('/api/admin/circle/posts/:id/publish', async (request) => {
    const { id } = parse(circlePostParams, request.params);
    parse(emptyBody, request.body);
    return circle.publish(id, adminActor(request));
  });

  app.post('/api/admin/circle/posts/:id/unpublish', async (request) => {
    const { id } = parse(circlePostParams, request.params);
    parse(emptyBody, request.body);
    return circle.unpublish(id, adminActor(request));
  });

  app.get('/api/admin/circle/posts/:id/answers', async (request) => {
    const { id } = parse(circlePostParams, request.params);
    const q = parse(circleAnswersQuery, request.query);
    const page = await circle.answers(id, q.answer ? { answer: q.answer } : {}, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((a) => ({ ...a, email: clientEmail(a.email, inClear) })) };
  });
};
