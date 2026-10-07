/**
 * The Messages board of the console (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; API §16.28): one conversation per client.
 * Clients write from the app; the answers appear in their account. No email is sent, and staff never open a
 * conversation: they answer one a client opened.
 *
 *   GET  /api/admin/messages                 AUDITOR   the board: `?status=` TO_ANSWER (default), ANSWERED, CLOSED or
 *                                                      ALL; `?who=` mine or unassigned; `?q=` an email (part of it;
 *                                                      the whole email for a reader who sees it masked) or a scan's REF
 *   GET  /api/admin/messages/summary         AUDITOR   the sidebar's badge: To answer, and those answered first
 *   GET  /api/admin/messages/:id             AUDITOR   a conversation and its messages
 *   POST /api/admin/messages/:id/answer      OPERATOR  an answer, signed ORBES Client Services for the client
 *   POST /api/admin/messages/:id/take        OPERATOR  the reader answers it from now
 *   POST /api/admin/messages/:id/assign      ADMIN     an active OPERATOR or ADMIN answers it
 *   POST /api/admin/messages/:id/close       OPERATOR  CLOSED; the client writing again reopens it
 *
 * services/messages.ts orders, checks and audits (`message.answer`, `message.take`, `message.assign`,
 * `message.close`: never the words). An AUDITOR reads the clients' emails masked (serialize.ts `clientEmail`); staff
 * emails are the console's own and read in clear. RETAIL has no access (the default rule).
 */
import type { FastifyPluginAsync } from 'fastify';
import { adminMessagesQuery, answerMessageBody, assignMessageBody, conversationParams, emptyBody, pageOf, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { BoardConversation, StaffConversation } from '../../services/messages.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

function rowJson<T extends BoardConversation | StaffConversation>(c: T, inClear: boolean): T {
  return { ...c, account: { ...c.account, email: clientEmail(c.account.email, inClear) } };
}

export const adminMessageRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { messages } = ctx.services;

  app.get('/api/admin/messages', async (request) => {
    const q = parse(adminMessagesQuery, request.query);
    const inClear = readsClientEmails(request);
    // A reader who sees the emails masked searches by the whole email only: part of it would rebuild the address.
    const page = await messages.board({ ...(q.status ? { status: q.status } : {}), ...(q.who ? { who: q.who } : {}), ...(q.q ? { q: q.q } : {}), exactEmail: !inClear }, pageOf(request.query), adminActor(request));
    return { ...page, items: page.items.map((c) => rowJson(c, inClear)) };
  });

  app.get('/api/admin/messages/summary', async () => messages.summary());

  app.get('/api/admin/messages/:id', async (request) => {
    const { id } = parse(conversationParams, request.params);
    return rowJson(await messages.conversation(id), readsClientEmails(request));
  });

  app.post('/api/admin/messages/:id/answer', async (request) => {
    const { id } = parse(conversationParams, request.params);
    const b = parse(answerMessageBody, request.body);
    return rowJson(await messages.answer(id, adminActor(request), { body: b.body }), readsClientEmails(request));
  });

  app.post('/api/admin/messages/:id/take', async (request) => {
    const { id } = parse(conversationParams, request.params);
    parse(emptyBody, request.body);
    return rowJson(await messages.take(id, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/messages/:id/assign', { config: { guard: { minRole: 'ADMIN' } } }, async (request) => {
    const { id } = parse(conversationParams, request.params);
    const b = parse(assignMessageBody, request.body);
    return rowJson(await messages.assign(id, b.adminId, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/messages/:id/close', async (request) => {
    const { id } = parse(conversationParams, request.params);
    parse(emptyBody, request.body);
    return rowJson(await messages.close(id, adminActor(request)), readsClientEmails(request));
  });
};
