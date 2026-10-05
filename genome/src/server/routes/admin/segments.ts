/**
 * The segments in the console (plan LIVE RELEASE+ of 2026-10-04, choice 27, N5: the Segments page, Clients;
 * services/segments.ts).
 *
 *   GET    /api/admin/segments                  AUDITOR   every segment, its members now and what uses it
 *   GET    /api/admin/segments/options          AUDITOR   what the builder names: releases, models, collections, sizes,
 *                                                         countries
 *   POST   /api/admin/segments/count            OPERATOR  the members criteria being built would have now (live count)
 *   POST   /api/admin/segments                  OPERATOR  a new segment
 *   GET    /api/admin/segments/:id              AUDITOR   one segment
 *   PATCH  /api/admin/segments/:id              OPERATOR  its name, its criteria
 *   DELETE /api/admin/segments/:id              OPERATOR  a segment nothing uses (409 SEGMENT_IN_USE otherwise)
 *   GET    /api/admin/segments/:id/members.csv  AUDITOR   its members now, as a CSV: emails masked for an AUDITOR
 *
 * Every mutation is audited by the service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { createSegmentBody, parse, segmentCountBody, segmentParams, updateSegmentBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

export const adminSegmentRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { segments } = ctx.services;

  app.get('/api/admin/segments', async () => ({ items: await segments.list() }));

  app.get('/api/admin/segments/options', async () => segments.options());

  app.post('/api/admin/segments/count', async (request) => {
    const { criteria } = parse(segmentCountBody, request.body);
    return segments.count(criteria);
  });

  app.post('/api/admin/segments', async (request, reply) => {
    const b = parse(createSegmentBody, request.body);
    const created = await segments.create(b, adminActor(request));
    return reply.code(201).send(created);
  });

  app.get('/api/admin/segments/:id', async (request) => {
    const { id } = parse(segmentParams, request.params);
    return segments.get(id);
  });

  app.patch('/api/admin/segments/:id', async (request) => {
    const { id } = parse(segmentParams, request.params);
    const b = parse(updateSegmentBody, request.body);
    return segments.update(id, b, adminActor(request));
  });

  app.delete('/api/admin/segments/:id', async (request, reply) => {
    const { id } = parse(segmentParams, request.params);
    await segments.remove(id, adminActor(request));
    return reply.code(204).send();
  });

  app.get('/api/admin/segments/:id/members.csv', async (request, reply) => {
    const { id } = parse(segmentParams, request.params);
    const inClear = readsClientEmails(request);
    const file = await segments.csv(id, { email: (e) => clientEmail(e, inClear) });
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type(file.contentType).send(file.body);
  });
};
