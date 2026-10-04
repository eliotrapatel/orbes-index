/**
 * The LIVE RELEASES in the console (plan of 2026-10-04, The console; Clients › Club › Drops): services/live-console.ts
 * creates, edits, publishes and reads them, services/live.ts holds the live controls, MediaService the silhouette
 * (routes/admin/media.ts, an image body).
 *
 *   GET    /api/admin/live                                   AUDITOR   every LIVE RELEASE, the latest created first
 *   POST   /api/admin/live                                   OPERATOR  a DRAFT with its settings, its seed sealed and committed
 *   GET    /api/admin/live/:id                               AUDITOR   one, every setting
 *   PATCH  /api/admin/live/:id                               OPERATOR  any setting, until its announcement (409 LIVE_ANNOUNCED)
 *   POST   /api/admin/live/:id/publish                       OPERATOR  announced at its time; `circlePost`: a post of the circle
 *   POST   /api/admin/live/:id/circle-post                   OPERATOR  its post of the circle, published, until its announcement
 *   DELETE /api/admin/live/:id/circle-post                   OPERATOR  that post withdrawn, until its announcement
 *   POST   /api/admin/live/:id/cancel                        OPERATOR  before its room opens
 *   POST   /api/admin/live/:id/board-link                    OPERATOR  the boutique board's secret link, shown once (replaces one)
 *   DELETE /api/admin/live/:id/board-link                    OPERATOR  revoked
 *   GET    /api/admin/live/:id/board                         AUDITOR   the live board: the counters, per size, the line
 *   GET    /api/admin/live/:id/stream                        AUDITOR   the live board in real time (SSE, `console` events)
 *   GET    /api/admin/live/:id/entries                       AUDITOR   the entries (?status=, OPEN for the open ones)
 *   POST   /api/admin/live/:id/pause, /resume                OPERATOR  no new turn, the deadlines frozen; and back
 *   POST   /api/admin/live/:id/extend                        OPERATOR  the end of the sales later
 *   POST   /api/admin/live/:id/stock                         OPERATOR  ADD PIECES to a size
 *   POST   /api/admin/live/:id/messages                      OPERATOR  a host message for the room
 *   POST   /api/admin/live/:id/end                           ADMIN     END NOW (the console asks for a typed phrase first)
 *   POST   /api/admin/live/:id/entries/:entryId/free         OPERATOR  a hold freed: the piece to the next in line
 *   POST   /api/admin/live/:id/entries/:entryId/let-in       OPERATOR  a person in the line takes their turn now
 *   POST   /api/admin/live/:id/entries/:entryId/remove       ADMIN     removed from the release
 *   GET    /api/admin/live/:id/reservations                  AUDITOR   Client Services: the confirmed reservations
 *   GET    /api/admin/live/:id/reservations.csv              AUDITOR   the same, every one, as a CSV
 *   POST   /api/admin/live/:id/entries/:entryId/resolve      OPERATOR  CONCLUDED or CANCELLED, with a note
 *
 * The intelligence (services/live-insights.ts; each answer carries its reasoning; the live alerts and the live sell-out
 * forecast ride on the live board and its stream, `alerts` and `sellOut`):
 *
 *   GET    /api/admin/live/:id/plan                          AUDITOR   the release planner: quantity and size mix
 *   GET    /api/admin/live/:id/forecast                      AUDITOR   the audience forecast: the room at T0
 *   GET    /api/admin/live/:id/radar                         AUDITOR   the demand radar, before T0
 *   GET    /api/admin/live/:id/bots                          AUDITOR   the bot radar (REMOVE: the control above, ADMIN)
 *   GET    /api/admin/live/:id/report                        AUDITOR   the release report
 *   GET    /api/admin/live/:id/report.csv                    AUDITOR   the same, as a CSV
 *   GET    /api/admin/live/:id/collectors                    AUDITOR   the collector insights
 *   GET    /api/admin/live/:id/comparison                    AUDITOR   the release beside the others
 *
 * An AUDITOR reads the customers' emails masked (`j***@example.com`), in the board, its stream, the entries, the
 * reservations and their CSV, the bot radar and the collector insights; OPERATOR and ADMIN in clear (serialize.ts). The
 * board link's secret is in the answer that issues it and nowhere else. Every mutation is audited by its service.
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  emptyBody,
  liveAdminEntryParams,
  liveAdminParams,
  liveEntriesQuery,
  liveExtendBody,
  liveMessageBody,
  liveResolveBody,
  liveStockBody,
  createLiveBody,
  pageOf,
  parse,
  publishLiveBody,
  updateLiveBody,
} from '../../http/schemas.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import { dropNotFound } from '../../services/drops.js';
import type { AdminLiveEntry } from '../../services/live.js';
import type { AdminLiveBoard, AdminLiveReservation } from '../../services/live-console.js';
import type { BotRadar, CollectorInsights } from '../../services/live-insights.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

/** An entry as the caller may read it: its email in clear (OPERATOR, ADMIN) or masked (AUDITOR). */
export function liveEntryJson(e: AdminLiveEntry, inClear: boolean): AdminLiveEntry {
  return { ...e, email: clientEmail(e.email, inClear) };
}

/** The live board as the caller may read it (the console's stream reads it the same way). */
export function liveBoardJson(board: AdminLiveBoard, inClear: boolean): AdminLiveBoard {
  return { ...board, line: board.line.map((e) => liveEntryJson(e, inClear)) };
}

function reservationJson(r: AdminLiveReservation, inClear: boolean): AdminLiveReservation {
  return { ...r, email: clientEmail(r.email, inClear) };
}

/** The bot radar as the caller may read it. */
export function botRadarJson(radar: BotRadar, inClear: boolean): BotRadar {
  return { ...radar, items: radar.items.map((x) => ({ ...x, email: clientEmail(x.email, inClear) })) };
}

/** The collector insights as the caller may read them. */
export function collectorInsightsJson(c: CollectorInsights, inClear: boolean): CollectorInsights {
  return { ...c, unsecured: { ...c.unsecured, items: c.unsecured.items.map((x) => ({ ...x, email: clientEmail(x.email, inClear) })) } };
}

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminLiveRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { live, liveConsole, liveInsights } = ctx.services;

  // ── The release ──────────────────────────────────────────────────────────

  app.get('/api/admin/live', async (request) => liveConsole.list(pageOf(request.query)));

  app.post('/api/admin/live', async (request, reply) => {
    const b = parse(createLiveBody, request.body);
    const created = await liveConsole.create(b, adminActor(request));
    reply.code(201);
    return created;
  });

  app.get('/api/admin/live/:id', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return liveConsole.get(id);
  });

  app.patch('/api/admin/live/:id', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const b = parse(updateLiveBody, request.body);
    const change = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    return liveConsole.update(id, change, adminActor(request));
  });

  app.post('/api/admin/live/:id/publish', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const b = parse(publishLiveBody, request.body);
    return liveConsole.publish(id, { circlePost: b.circlePost === true }, adminActor(request));
  });

  app.post('/api/admin/live/:id/circle-post', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    return liveConsole.setCirclePost(id, true, adminActor(request));
  });

  app.delete('/api/admin/live/:id/circle-post', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    return liveConsole.setCirclePost(id, false, adminActor(request));
  });

  app.post('/api/admin/live/:id/cancel', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    return liveConsole.cancel(id, adminActor(request));
  });

  // The boutique board's link: its secret leaves the server in this answer only, never stored in clear.
  app.post('/api/admin/live/:id/board-link', async (request, reply) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    const { token, issuedAt } = await live.issueBoardLink(id, adminActor(request));
    reply.header('cache-control', 'no-store');
    return { url: liveConsole.boardUrl(id, token), issuedAt };
  });

  app.delete('/api/admin/live/:id/board-link', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    await live.revokeBoardLink(id, adminActor(request));
    return liveConsole.get(id);
  });

  // ── The live board ───────────────────────────────────────────────────────

  app.get('/api/admin/live/:id/board', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const board = await liveConsole.board(id);
    if (!board) throw dropNotFound();
    return { now: ctx.clock(), board: liveBoardJson(board, readsClientEmails(request)) };
  });

  app.get('/api/admin/live/:id/stream', async (request, reply) => {
    const { id } = parse(liveAdminParams, request.params);
    const { admin, session } = requireAdmin(request);
    if (!(await app.liveHub.openConsole(request, reply, id, { adminId: admin.id, sessionId: session.id, inClear: readsClientEmails(request) }))) throw dropNotFound();
    return reply;
  });

  app.get('/api/admin/live/:id/entries', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const q = parse(liveEntriesQuery, request.query);
    const page = await liveConsole.entries(id, q.status ? { status: q.status } : {}, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((e) => liveEntryJson(e, inClear)) };
  });

  // ── The controls (OPERATOR; END NOW and REMOVE: ADMIN) ───────────────────

  app.post('/api/admin/live/:id/pause', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    return live.pause(id, adminActor(request));
  });

  app.post('/api/admin/live/:id/resume', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    return live.resume(id, adminActor(request));
  });

  app.post('/api/admin/live/:id/extend', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const { minutes } = parse(liveExtendBody, request.body);
    return live.extend(id, minutes, adminActor(request));
  });

  app.post('/api/admin/live/:id/stock', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const { sizeId, pieces } = parse(liveStockBody, request.body);
    return live.addPieces(id, sizeId, pieces, adminActor(request));
  });

  app.post('/api/admin/live/:id/messages', async (request, reply) => {
    const { id } = parse(liveAdminParams, request.params);
    const { text } = parse(liveMessageBody, request.body);
    const message = await live.message(id, text, adminActor(request));
    reply.code(201);
    return message;
  });

  app.post('/api/admin/live/:id/end', { config: ADMIN }, async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    parse(emptyBody, request.body);
    return live.end(id, adminActor(request));
  });

  app.post('/api/admin/live/:id/entries/:entryId/free', async (request) => {
    const { id, entryId } = parse(liveAdminEntryParams, request.params);
    parse(emptyBody, request.body);
    return liveEntryJson(await live.freeHold(id, entryId, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/live/:id/entries/:entryId/let-in', async (request) => {
    const { id, entryId } = parse(liveAdminEntryParams, request.params);
    parse(emptyBody, request.body);
    return liveEntryJson(await live.letIn(id, entryId, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/live/:id/entries/:entryId/remove', { config: ADMIN }, async (request) => {
    const { id, entryId } = parse(liveAdminEntryParams, request.params);
    parse(emptyBody, request.body);
    return liveEntryJson(await live.remove(id, entryId, adminActor(request)), readsClientEmails(request));
  });

  // ── Client Services ──────────────────────────────────────────────────────

  app.get('/api/admin/live/:id/reservations', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    const page = await liveConsole.reservations(id, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((r) => reservationJson(r, inClear)) };
  });

  app.get('/api/admin/live/:id/reservations.csv', async (request, reply) => {
    const { id } = parse(liveAdminParams, request.params);
    const inClear = readsClientEmails(request);
    const file = await liveConsole.reservationsCsv(id, (email) => clientEmail(email, inClear));
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.post('/api/admin/live/:id/entries/:entryId/resolve', async (request) => {
    const { id, entryId } = parse(liveAdminEntryParams, request.params);
    const b = parse(liveResolveBody, request.body);
    return reservationJson(await liveConsole.resolve(id, entryId, { resolution: b.resolution, note: b.note ?? null }, adminActor(request)), readsClientEmails(request));
  });

  // ── The intelligence (reads only) ────────────────────────────────────────

  app.get('/api/admin/live/:id/plan', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return liveInsights.plan(id);
  });

  app.get('/api/admin/live/:id/forecast', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return liveInsights.forecast(id);
  });

  app.get('/api/admin/live/:id/radar', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return liveInsights.radar(id);
  });

  app.get('/api/admin/live/:id/bots', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return botRadarJson(await liveInsights.bots(id), readsClientEmails(request));
  });

  app.get('/api/admin/live/:id/report', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return liveInsights.report(id);
  });

  app.get('/api/admin/live/:id/report.csv', async (request, reply) => {
    const { id } = parse(liveAdminParams, request.params);
    const file = await liveInsights.reportCsv(id);
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.get('/api/admin/live/:id/collectors', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return collectorInsightsJson(await liveInsights.collectors(id), readsClientEmails(request));
  });

  app.get('/api/admin/live/:id/comparison', async (request) => {
    const { id } = parse(liveAdminParams, request.params);
    return liveInsights.comparison(id);
  });
};
