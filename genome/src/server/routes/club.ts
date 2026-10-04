/**
 * The owners' club (contract §3 extension; API §10.9, §10.10;
 * services/club.ts, services/drops.ts), cookie `orbes_session`.
 *
 * P-R02 opens the lookbook's RESERVED models to the owners of a piece:
 *
 *   GET  /api/v1/club/lookbook              the RESERVED models (no story)
 *   GET  /api/v1/club/lookbook/:slug        a sheet, PUBLIC or RESERVED
 *
 * P-R03, the drops (any ORBES account: one that holds no piece is drawn after
 * the tiers):
 *
 *   GET  /api/v1/club/status                the account's tier, pieces and seniority, and its entries
 *   POST /api/v1/club/drops/:id/enter       ENTER an open drop (the same entry again after a withdrawal)
 *   POST /api/v1/club/drops/:id/withdraw    WITHDRAW, before the draw
 *   POST /api/v1/club/drops/:id/reserve     P-X02: a place held at once, during the early access, PLATINE and PALLADIUM
 *
 * P-X01, the circle (services/circle.ts: an account that holds a piece now,
 * each post from its tier up):
 *
 *   GET  /api/v1/club/circle                the feed, paginated, without the posts' bodies (its first page counts a visit)
 *   GET  /api/v1/club/circle/:id            a post (404 below its tier)
 *   POST /api/v1/club/circle/:id/rsvp       YES or NO to an invitation, within its capacity
 *   POST /api/v1/club/circle/:id/vote       one vote in a poll, final; its results then shown
 *
 * Every route needs a signed-in account (the scope's guard: 401 without one,
 * and for an unsafe method the CSRF token and a same-origin request); what
 * the account holds now decides the rest (403 OWNERS_ONLY for an account
 * that holds no piece, on the lookbook's routes and the circle's). The club's
 * mutations are POSTs only. Its answers depend on the account, so they are
 * never stored (`no-store`). Rate group `api`, like the account's other reads.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../http/rate-limit.js';
import { circleRsvpBody, circleVoteBody, emptyBody, lookbookParams, parse, publicCircleParams, publicDropParams } from '../http/schemas.js';
import { accountActor, requireAccount, sessionGuard } from '../http/sessions.js';
import { circleFeedPage } from '../services/circle.js';
import type { RouteDeps } from './public.js';

export const clubRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  // An owner's view: never kept by a browser or a proxy, whatever the route.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });
  const { club, drops, circle } = ctx.services;

  app.get('/api/v1/club/lookbook', async (request) => {
    const { account } = requireAccount(request);
    return { models: await club.reservedLookbook(account.id) };
  });

  app.get('/api/v1/club/lookbook/:slug', async (request) => {
    const { account } = requireAccount(request);
    const { slug } = parse(lookbookParams, request.params);
    return club.lookbookSheet(account.id, slug);
  });

  // P-R03: the account's tier and its entries in the drops, for MY PIECES and a release's page.
  app.get('/api/v1/club/status', async (request) => {
    const { account } = requireAccount(request);
    return club.status(account.id);
  });

  app.post('/api/v1/club/drops/:id/enter', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(publicDropParams, request.params);
    parse(emptyBody, request.body);
    return { entry: await drops.enter(account.id, id, accountActor(request)) };
  });

  app.post('/api/v1/club/drops/:id/withdraw', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(publicDropParams, request.params);
    parse(emptyBody, request.body);
    return { entry: await drops.withdraw(account.id, id, accountActor(request)) };
  });

  // P-X02: during a release's early access, an account PLATINE or PALLADIUM now reserves a place directly.
  app.post('/api/v1/club/drops/:id/reserve', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(publicDropParams, request.params);
    parse(emptyBody, request.body);
    return { entry: await drops.reserve(account.id, id, accountActor(request)) };
  });

  // P-X01: the circle, for an account that holds a piece now; each post from its tier up.
  app.get('/api/v1/club/circle', async (request) => {
    const { account } = requireAccount(request);
    return circle.feed(account.id, circleFeedPage(request.query));
  });

  app.get('/api/v1/club/circle/:id', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(publicCircleParams, request.params);
    return circle.post(account.id, id);
  });

  app.post('/api/v1/club/circle/:id/rsvp', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(publicCircleParams, request.params);
    const b = parse(circleRsvpBody, request.body);
    return circle.rsvp(account.id, id, b.answer, accountActor(request));
  });

  app.post('/api/v1/club/circle/:id/vote', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(publicCircleParams, request.params);
    const b = parse(circleVoteBody, request.body);
    return circle.vote(account.id, id, b.option);
  });
};
