/**
 * MESSAGES for the collector (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; API §10.17): WRITE TO ORBES CLIENT SERVICES,
 * and the conversation the account's MESSAGES shows. An account session is required (401 signed out: the app asks the
 * visitor to sign in or create an account first); every POST needs the CSRF token and a same-origin request
 * (http/sessions.ts). Answers are never cached (`no-store`, the API's default). Nothing is emailed.
 *
 *   GET  /api/v1/account/messages          the conversation, oldest first, and whether an answer is unread
 *   POST /api/v1/account/messages          {body, context?: {kind, id, about?}} → 201 {message}
 *   POST /api/v1/account/messages/read     {upTo} → 204: read up to that time
 *   GET  /api/v1/account/messages/unread   {unread}: NOW's line and the account sheet's NEW
 *
 * services/messages.ts checks the words and the context, and audits `message.write` (never the words).
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../http/rate-limit.js';
import { accountMessageBody, accountMessagesReadBody, parse } from '../http/schemas.js';
import { accountActor, requireAccount, sessionGuard } from '../http/sessions.js';
import type { RouteDeps } from './public.js';

export const messageRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  const { messages } = ctx.services;

  app.get('/api/v1/account/messages', async (request) => {
    const { account } = requireAccount(request);
    return messages.thread(account.id);
  });

  app.post('/api/v1/account/messages', async (request, reply) => {
    const { account } = requireAccount(request);
    const b = parse(accountMessageBody, request.body);
    const out = await messages.write(account.id, { body: b.body, context: b.context ?? null }, accountActor(request));
    reply.code(201);
    return out;
  });

  app.post('/api/v1/account/messages/read', async (request, reply) => {
    const { account } = requireAccount(request);
    const b = parse(accountMessagesReadBody, request.body);
    await messages.markRead(account.id, b.upTo);
    return reply.code(204).send();
  });

  app.get('/api/v1/account/messages/unread', async (request) => {
    const { account } = requireAccount(request);
    return messages.unread(account.id);
  });
};
