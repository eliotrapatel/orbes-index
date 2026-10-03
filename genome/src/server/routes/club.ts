/**
 * The owners' club (contract §3 extension; API §10.9; services/club.ts),
 * cookie `orbes_session`. P-R02 opens the lookbook's RESERVED models to the
 * owners of a piece:
 *
 *   GET /api/v1/club/lookbook          the RESERVED models (no story)
 *   GET /api/v1/club/lookbook/:slug    a sheet, PUBLIC or RESERVED
 *
 * Every route needs a signed-in account (the scope's guard: 401 without one,
 * and for an unsafe method the CSRF token and a same-origin request); what
 * the account holds now decides the rest (403 OWNERS_ONLY for an account
 * that holds no piece). The club's mutations are POSTs only. Its answers
 * depend on the account, so they are never stored (`no-store`). Rate group
 * `api`, like the account's other reads.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../http/rate-limit.js';
import { lookbookParams, parse } from '../http/schemas.js';
import { requireAccount, sessionGuard } from '../http/sessions.js';
import type { RouteDeps } from './public.js';

export const clubRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  // An owner's view: never kept by a browser or a proxy, whatever the route.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  const { club } = ctx.services;

  app.get('/api/v1/club/lookbook', async (request) => {
    const { account } = requireAccount(request);
    return { models: await club.reservedLookbook(account.id) };
  });

  app.get('/api/v1/club/lookbook/:slug', async (request) => {
    const { account } = requireAccount(request);
    const { slug } = parse(lookbookParams, request.params);
    return club.lookbookSheet(account.id, slug);
  });
};
