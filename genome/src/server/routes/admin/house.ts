/**
 * House messages in the console (plan MACRO M2 §1.3, §1.4, §1.6; lot M2 step M2.3; services/house-moments.ts,
 * services/house-messages.ts), read by the House messages page (Clients, lot M2 step M2.4).
 *
 *   GET    /api/admin/house/moments                   AUDITOR   the six moments: switch, words, defaults, placeholders,
 *                                                               links, delivered and read (30 days, in all)
 *   PUT    /api/admin/house/moments/:moment/enabled   ADMIN     a moment on (nothing sent for the past) or off
 *                                                                                      house.moment.enable/.disable
 *   PUT    /api/admin/house/moments/:moment/words     OPERATOR  its title and words (null: the default's)
 *                                                                                      house.moment.words
 *   GET    /api/admin/house/moments/:moment/preview   AUDITOR   the moment as a collector would read it, example values
 *   POST   /api/admin/house/moments/:moment/preview   OPERATOR  the same with the words being written (nothing stored)
 *   GET    /api/admin/house/messages                  AUDITOR   the custom messages, newest first (?status&page&pageSize)
 *   POST   /api/admin/house/messages                  OPERATOR  a new draft: title, words, a segment or a tier (201)
 *                                                                                      house.message.create
 *   GET    /api/admin/house/messages/:id              AUDITOR   one message, its reach, read and share read; its reach
 *                                                               now while it has not gone
 *   PATCH  /api/admin/house/messages/:id              OPERATOR  a draft's or a scheduled message's words or audience
 *                                                                                      house.message.update
 *   DELETE /api/admin/house/messages/:id              OPERATOR  a draft (204)          house.message.delete
 *   POST   /api/admin/house/count                     OPERATOR  how many an audience reaches now
 *   POST   /api/admin/house/messages/:id/send         ADMIN     now, or `at` a date and time in Paris, the phrase SEND
 *                                                                                      house.message.send/.schedule
 *   POST   /api/admin/house/messages/:id/cancel       ADMIN     a scheduled message    house.message.cancel
 *
 * Errors: 404 HOUSE_MESSAGE_NOT_FOUND, HOUSE_MOMENT_NOT_FOUND, SEGMENT_NOT_FOUND; 409 HOUSE_MESSAGE_SENT (a change after
 * sending), HOUSE_MESSAGE_STATE (a cancelled message changed, a scheduled one deleted, a draft cancelled); 422
 * HOUSE_SEND_PAST, HOUSE_PLACEHOLDER, HOUSE_AUDIENCE (neither or both). No route names a collector: the console reads
 * counts only. Never stored by a cache. RETAIL and LOGISTICS get 403. Every mutation needs the CSRF token and a
 * same-origin request, and is audited by the service.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  emptyBody,
  houseCountBody,
  houseMessageBody,
  houseMessageParams,
  houseMessagePatchBody,
  houseMessagesQuery,
  houseMomentEnabledBody,
  houseMomentParams,
  houseMomentPreviewBody,
  houseMomentWordsBody,
  houseSendBody,
  pageOf,
  parse,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };
const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminHouseRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { houseMoments, houseMessages } = ctx.services;
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  // ── The moments ──────────────────────────────────────────────────────────

  app.get('/api/admin/house/moments', async () => ({ moments: await houseMoments.moments() }));

  app.put('/api/admin/house/moments/:moment/enabled', { config: ADMIN }, async (request) => {
    const { moment } = parse(houseMomentParams, request.params);
    const b = parse(houseMomentEnabledBody, request.body);
    await houseMoments.setMoment(moment, { enabled: b.enabled }, adminActor(request));
    return { moment: (await houseMoments.moments()).find((m) => m.moment === moment)! };
  });

  app.put('/api/admin/house/moments/:moment/words', { config: OPERATOR }, async (request) => {
    const { moment } = parse(houseMomentParams, request.params);
    const b = parse(houseMomentWordsBody, request.body);
    await houseMoments.setMoment(moment, { ...(b.title !== undefined ? { title: b.title } : {}), ...(b.body !== undefined ? { body: b.body } : {}) }, adminActor(request));
    return { moment: (await houseMoments.moments()).find((m) => m.moment === moment)! };
  });

  app.get('/api/admin/house/moments/:moment/preview', async (request) => {
    const { moment } = parse(houseMomentParams, request.params);
    return houseMoments.preview(moment);
  });

  app.post('/api/admin/house/moments/:moment/preview', { config: OPERATOR }, async (request) => {
    const { moment } = parse(houseMomentParams, request.params);
    const b = parse(houseMomentPreviewBody, request.body);
    return houseMoments.preview(moment, { ...(b.title !== undefined ? { title: b.title } : {}), ...(b.body !== undefined ? { body: b.body } : {}) });
  });

  // ── The custom messages ──────────────────────────────────────────────────

  app.get('/api/admin/house/messages', async (request) => {
    const q = parse(houseMessagesQuery, request.query);
    return houseMessages.messages(q.status ? { status: q.status } : {}, pageOf(request.query));
  });

  app.post('/api/admin/house/messages', { config: OPERATOR }, async (request, reply) => {
    const b = parse(houseMessageBody, request.body);
    const m = await houseMessages.create({ title: b.title, body: b.body, audience: b.audience }, adminActor(request));
    reply.code(201);
    return m;
  });

  app.post('/api/admin/house/count', { config: OPERATOR }, async (request) => {
    const b = parse(houseCountBody, request.body);
    return houseMessages.count(b.audience);
  });

  app.get('/api/admin/house/messages/:id', async (request) => {
    const { id } = parse(houseMessageParams, request.params);
    return houseMessages.message(id);
  });

  app.patch('/api/admin/house/messages/:id', { config: OPERATOR }, async (request) => {
    const { id } = parse(houseMessageParams, request.params);
    const b = parse(houseMessagePatchBody, request.body);
    return houseMessages.update(
      id,
      { ...(b.title !== undefined ? { title: b.title } : {}), ...(b.body !== undefined ? { body: b.body } : {}), ...(b.audience !== undefined ? { audience: b.audience } : {}) },
      adminActor(request),
    );
  });

  app.delete('/api/admin/house/messages/:id', { config: OPERATOR }, async (request, reply) => {
    const { id } = parse(houseMessageParams, request.params);
    parse(emptyBody, request.body);
    await houseMessages.remove(id, adminActor(request));
    return reply.code(204).send();
  });

  app.post('/api/admin/house/messages/:id/send', { config: ADMIN }, async (request) => {
    const { id } = parse(houseMessageParams, request.params);
    const b = parse(houseSendBody, request.body);
    return houseMessages.send(id, { at: b.at ?? null, phrase: b.phrase }, adminActor(request));
  });

  app.post('/api/admin/house/messages/:id/cancel', { config: ADMIN }, async (request) => {
    const { id } = parse(houseMessageParams, request.params);
    parse(emptyBody, request.body);
    return houseMessages.cancel(id, adminActor(request));
  });
};
