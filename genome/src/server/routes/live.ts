/**
 * The LIVE RELEASES (plan of 2026-10-04; services/live.ts, services/live-room.ts, http/live-stream.ts).
 *
 * Public, no session (each stage at its time, 404 DROP_NOT_FOUND before the announcement):
 *
 *   GET  /api/v1/live                       THE RELEASES' LIVE half: announced, not ended, the next opening first
 *   GET  /api/v1/live/next                  the banner of /verify and MY PIECES ({ release: null } when none)
 *   GET  /api/v1/live/clock                 the server's time, for the page's 3-sample clock sync
 *   GET  /api/v1/live/:id                   a release's page (once ended, only that it is)
 *   GET  /api/v1/live/:id/calendar.ics      ADD TO CALENDAR
 *   POST /api/v1/live/:id/board             the boutique board, by its secret link (in the body, from the page's fragment)
 *   POST /api/v1/live/:id/board/stream      its stream (SSE)
 *
 * A signed-in account (cookie `orbes_session`; for a mutation the CSRF token and a same-origin request):
 *
 *   GET    /api/v1/live/mine                its entries, with their releases (MY PIECES)
 *   GET    /api/v1/live/:id/state           the room, its own entry and interest: the page's fallback when its stream is lost
 *   GET    /api/v1/live/:id/stream          the room and its own entry in real time (SSE), at most two per account
 *   PUT    /api/v1/live/:id/interest        I'LL BE THERE, with a size
 *   DELETE /api/v1/live/:id/interest        withdrawn
 *   POST   /api/v1/live/:id/enter           ENTER the room (or, after T0, the line), with a size and a quantity
 *   POST   /api/v1/live/:id/size            CHANGE SIZE, before T0
 *   POST   /api/v1/live/:id/leave           LEAVE
 *   POST   /api/v1/live/:id/press           the seal pressed (the turn's secret)
 *   POST   /api/v1/live/:id/secure          the seal held (the turn's secret)
 *   PUT    /api/v1/live/:id/addons          the add-ons of the piece held
 *   POST   /api/v1/live/:id/confirm         PAY (a placeholder: the reservation confirmed)
 *   POST   /api/v1/live/:id/release         RELEASE MY PLACE
 *
 * The state and the stream are only for an account allowed to enter the release, or holding an entry in it (403
 * LIVE_NOT_ELIGIBLE otherwise, with the rule in words; 401 without a session): no live view for anyone else, the
 * spectator mode was declined. The board's link is its only key: a missing, malformed, wrong or revoked secret, a
 * release not announced or over, all answer 404, and its answers are never indexed.
 *
 * Rate group `live` (rate-limit.ts): every route draws on its network's budget first, and a signed-in account's routes
 * on the account's own too. The account's answers are never stored (`no-store`); the public ones are kept
 * LIVE_PUBLIC_CACHE_CONTROL, a stage or a count showing within it, never before its time.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { LiveHub } from '../http/live-stream.js';
import { rateLimitHook } from '../http/rate-limit.js';
import { emptyBody, liveAddonsBody, liveBoardBody, liveEntryBody, liveInterestBody, liveParams, liveTurnBody, parse } from '../http/schemas.js';
import { accountActor, requireAccount, sessionGuard } from '../http/sessions.js';
import { dropNotFound } from '../services/drops.js';
import { liveNetworkHash } from '../services/live.js';
import type { RouteDeps } from './public.js';

/** The public reads (list, banner, page, .ics): the same for everyone, kept 15 seconds. */
export const LIVE_PUBLIC_CACHE_CONTROL = 'public, max-age=15';

export interface LiveRouteDeps extends RouteDeps {
  hub: LiveHub;
}

const PUBLIC = { guard: { session: 'none' } } as const;

export const liveRoutes: FastifyPluginAsync<LiveRouteDeps> = async (app, { ctx, limiters, hub }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'live'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  app.addHook('onRequest', limiters.liveAccount);
  const { live, liveRoom } = ctx.services;

  // ── Public ───────────────────────────────────────────────────────────────

  app.get('/api/v1/live', { config: PUBLIC }, async (_request, reply) => {
    const releases = await liveRoom.list();
    reply.header('cache-control', LIVE_PUBLIC_CACHE_CONTROL);
    return { releases };
  });

  app.get('/api/v1/live/next', { config: PUBLIC }, async (_request, reply) => {
    const release = await liveRoom.next();
    reply.header('cache-control', LIVE_PUBLIC_CACHE_CONTROL);
    return { now: ctx.clock(), release };
  });

  // The clock sync: the page times three round trips and keeps the offset of the shortest.
  app.get('/api/v1/live/clock', { config: PUBLIC }, async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { now: ctx.clock() };
  });

  app.get('/api/v1/live/:id', { config: PUBLIC }, async (request, reply) => {
    const { id } = parse(liveParams, request.params);
    const sheet = await liveRoom.sheet(id);
    reply.header('cache-control', LIVE_PUBLIC_CACHE_CONTROL);
    return sheet;
  });

  app.get('/api/v1/live/:id/calendar.ics', { config: PUBLIC }, async (request, reply) => {
    const { id } = parse(liveParams, request.params);
    const file = await liveRoom.calendar(id);
    reply.header('cache-control', LIVE_PUBLIC_CACHE_CONTROL);
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type('text/calendar; charset=utf-8').send(file.body);
  });

  // The boutique board (the plan's choice 31): by its secret link only, never indexed.
  app.post('/api/v1/live/:id/board', { config: PUBLIC }, async (request, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow');
    const { id } = parse(liveParams, request.params);
    const { token } = parse(liveBoardBody, request.body);
    const { dropId } = await liveRoom.board(id, token);
    const board = await hub.boardOf(dropId);
    if (!board) throw dropNotFound();
    return { now: ctx.clock(), ...board };
  });

  app.post('/api/v1/live/:id/board/stream', { config: PUBLIC }, async (request, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow');
    const { id } = parse(liveParams, request.params);
    const { token } = parse(liveBoardBody, request.body);
    const { dropId } = await liveRoom.board(id, token);
    await hub.openBoard(request, reply, dropId);
    return reply;
  });

  // ── The account ──────────────────────────────────────────────────────────

  app.get('/api/v1/live/mine', async (request) => {
    const { account } = requireAccount(request);
    return { entries: await liveRoom.mine(account.id) };
  });

  app.get('/api/v1/live/:id/state', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const viewer = await liveRoom.viewer(account.id, id, 'state');
    const [room, own] = await Promise.all([hub.roomOf(viewer.dropId), liveRoom.own(account.id, viewer)]);
    if (!room) throw dropNotFound();
    return { now: ctx.clock(), room, ...own };
  });

  app.get('/api/v1/live/:id/stream', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const viewer = await liveRoom.viewer(account.id, id, 'stream');
    await hub.openViewer(request, reply, viewer.dropId, account.id);
    return reply;
  });

  app.put('/api/v1/live/:id/interest', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const { sizeId } = parse(liveInterestBody, request.body);
    return { interest: await live.setInterest(account.id, id, sizeId, accountActor(request)) };
  });

  app.delete('/api/v1/live/:id/interest', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    parse(emptyBody, request.body);
    await live.withdrawInterest(account.id, id, accountActor(request));
    return { interest: null };
  });

  app.post('/api/v1/live/:id/enter', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const b = parse(liveEntryBody, request.body);
    // The bot radar's inputs: the network's keyed hash (never the address) and the country, nothing finer.
    const client = { networkHash: liveNetworkHash(ctx.config.ipHashPepper, request.ip), country: ctx.geo.resolve(request).country ?? null };
    return { entry: await live.enter(account.id, id, { sizeId: b.sizeId, ...(b.quantity !== undefined ? { quantity: b.quantity } : {}) }, accountActor(request), client) };
  });

  app.post('/api/v1/live/:id/size', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const b = parse(liveEntryBody, request.body);
    return { entry: await live.changeSize(account.id, id, { sizeId: b.sizeId, ...(b.quantity !== undefined ? { quantity: b.quantity } : {}) }, accountActor(request)) };
  });

  app.post('/api/v1/live/:id/leave', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    parse(emptyBody, request.body);
    return { entry: await live.leave(account.id, id, accountActor(request)) };
  });

  app.post('/api/v1/live/:id/press', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const { token } = parse(liveTurnBody, request.body);
    return { entry: await live.press(account.id, id, token) };
  });

  app.post('/api/v1/live/:id/secure', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const { token } = parse(liveTurnBody, request.body);
    return { entry: await live.secure(account.id, id, token, accountActor(request)) };
  });

  app.put('/api/v1/live/:id/addons', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    const { addonIds } = parse(liveAddonsBody, request.body);
    return { entry: await live.setAddons(account.id, id, addonIds, accountActor(request)) };
  });

  app.post('/api/v1/live/:id/confirm', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    parse(emptyBody, request.body);
    return { entry: await live.confirm(account.id, id, accountActor(request)) };
  });

  app.post('/api/v1/live/:id/release', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(liveParams, request.params);
    parse(emptyBody, request.body);
    return { entry: await live.release(account.id, id, accountActor(request)) };
  });
};
