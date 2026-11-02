/**
 * GET /api/export/v1/smart-model?since=YYYY-MM-DD&page=N[&snapshot=ID] (lot EXPORT SMART MODEL): what has been sold, for
 * ORBES Smart Model, server to server (services/smart-model-export.ts). The contract is Smart Model's, exact:
 *
 *   - `Authorization: Bearer <token>`: the SHA-256 of the token, compared in constant time with
 *     SMART_MODEL_EXPORT_TOKEN_SHA256. Without both variables the address is closed: the app's own 404.
 *   - 401 `{ ok: false, reason: 'token' }` without the token or with a wrong one; after SMART_MODEL_FAILURES_MAX of them
 *     in SMART_MODEL_FAILURE_WINDOW_MS from one network, 429 `{ ok: false, reason: 'paused' }` for SMART_MODEL_PAUSE_MS,
 *     whatever it sends.
 *   - 400 `{ ok: false, reason: 'request' }` for a `since` that is not a real day, a page that is not a whole number, or
 *     a page after 0 without its snapshot.
 *   - 503 `live` (a LIVE release open or about to open), `night` (04:00–06:30 Paris), `busy` (a reading in progress);
 *     410 `snapshot` (unknown or expired, or a page it does not have): Smart Model starts again at page 0.
 *   - 200 the page (`ok: true`, format orbes-console/2): page 0 with `meta`, every page with at most 1 000 sales.
 *
 * Outside /api/admin: ADMIN_ALLOWED_IPS does not apply (Cloudflare's addresses change), no session, no cookie, no CORS.
 * The token never reaches the log (the request log is the path without its query and redacts `authorization`; Caddy's
 * drops the headers and the query). The `api` rate group (http/rate-limit.ts) holds it like any public route.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { rateLimitHook } from '../http/rate-limit.js';
import { SmartModelExport, SmartModelExportError, validDay } from '../services/smart-model-export.js';
import type { RouteDeps } from './public.js';

export const SMART_MODEL_EXPORT_ROUTE = '/api/export/v1/smart-model';
/** Wrong tokens allowed from one network in SMART_MODEL_FAILURE_WINDOW_MS (the contract: 10 in an hour). */
export const SMART_MODEL_FAILURES_MAX = 10;
export const SMART_MODEL_FAILURE_WINDOW_MS = 60 * 60_000;
/** How long a network that sent SMART_MODEL_FAILURES_MAX wrong tokens is refused (the contract: an hour). */
export const SMART_MODEL_PAUSE_MS = 60 * 60_000;
/** Networks tracked at most for wrong tokens (the oldest is forgotten first). */
const FAILURES_TRACKED = 10_000;

const STATUS = { token: 401, paused: 429, request: 400, live: 503, night: 503, busy: 503, snapshot: 410 } as const;

function refuse(reply: FastifyReply, reason: keyof typeof STATUS) {
  reply.header('cache-control', 'no-store');
  return reply.code(STATUS[reason]).send({ ok: false, reason });
}

/** Whether `authorization` carries the token whose SHA-256 is `sha256Hex`, compared in constant time. */
export function bearerMatches(authorization: string | undefined, sha256Hex: string): boolean {
  const m = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
  if (!m) return false;
  const got = createHash('sha256').update(m[1]!, 'utf8').digest();
  return timingSafeEqual(got, Buffer.from(sha256Hex, 'hex'));
}

export const exportRoutes: FastifyPluginAsync<RouteDeps & { exporter: SmartModelExport | null }> = async (app, { ctx, limiters, exporter }) => {
  const settings = ctx.config.smartModelExport;
  // Closed (404, the app's own) without its two variables.
  if (!settings || !exporter) return;
  const failures = new Map<string, { count: number; since: number; pausedUntil: number }>();

  app.addHook('onRequest', rateLimitHook(limiters, 'api'));

  app.get(SMART_MODEL_EXPORT_ROUTE, async (request, reply) => {
    const now = ctx.clock().getTime();
    const network = request.orbes.ipHash;
    const seen = failures.get(network);
    if (seen && seen.pausedUntil > now) return refuse(reply, 'paused');
    if (!bearerMatches(request.headers.authorization, settings.tokenSha256)) {
      const f = seen && now - seen.since < SMART_MODEL_FAILURE_WINDOW_MS ? seen : { count: 0, since: now, pausedUntil: 0 };
      f.count += 1;
      if (f.count >= SMART_MODEL_FAILURES_MAX) f.pausedUntil = now + SMART_MODEL_PAUSE_MS;
      failures.delete(network);
      failures.set(network, f);
      while (failures.size > FAILURES_TRACKED) failures.delete(failures.keys().next().value!);
      ctx.log.warn({ failures: f.count }, 'smart model export: wrong token');
      return refuse(reply, 'token');
    }
    failures.delete(network);

    const q = request.query as Record<string, unknown>;
    const since = q.since;
    const page = typeof q.page === 'string' && /^\d{1,6}$/.test(q.page) ? Number(q.page) : null;
    const snapshot = typeof q.snapshot === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q.snapshot) ? q.snapshot : undefined;
    if (!validDay(since) || page === null || (page > 0 && snapshot === undefined) || (q.snapshot !== undefined && snapshot === undefined)) {
      return refuse(reply, 'request');
    }
    try {
      const body = await exporter.page({ since, page, ...(snapshot !== undefined ? { snapshot } : {}) });
      reply.header('cache-control', 'no-store');
      return reply.code(200).send(body);
    } catch (err) {
      if (err instanceof SmartModelExportError) return refuse(reply, err.reason);
      throw err;
    }
  });
};
