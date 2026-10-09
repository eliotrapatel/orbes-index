/**
 * POST /api/v1/seen (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.8.7, §3.0 (c)): the views the collector app
 * records, in batches, handed to TrackingService.ingest. Anyone may send one: no session is needed, and the account and
 * console cookies are read when present (an account's views carry it; a console session marks the device staff's and
 * nothing is recorded).
 *
 *   - Same origin (assertSameOrigin, as /api/v1/reports): another site cannot send views (403). No CSRF token: the
 *     batch is sent while the page closes, when the token may be stale, and it changes no one's account; both session
 *     cookies are SameSite=Strict, so a cross-site POST carries neither.
 *   - Its own rate group, `seen` (http/rate-limit.ts): a boutique's customers share one address.
 *   - The device cookie (http/device.ts ensureDevice) is set when there is none, as /api/v1/verify does: a first visit
 *     that never scans is remembered too.
 *   - 204 whatever happened (recorded or dropped); 400 VALIDATION_FAILED for a malformed body, 403 for a foreign
 *     origin, 429 RATE_LIMITED.
 *   - The path is `seen`, not `track` or `collect`: content blockers drop requests to those names.
 *
 * The sessions (SeenSessions): a phone sends a batch every 30 ± 10 s, so the resolved session (its account, or a
 * console session) is kept SEEN_SESSION_CACHE_MS in memory, keyed by the token's hash, at most SEEN_SESSION_CACHE_MAX
 * entries: about one session read a minute per signed-in phone instead of one per batch. A session signed out or
 * revoked can record views for at most those 30 seconds; nothing else reads this cache.
 */
import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { connectionPlace } from '../geo/place.js';
import { ensureDevice } from '../http/device.js';
import { rateLimitHook } from '../http/rate-limit.js';
import { parse, seenBody } from '../http/schemas.js';
import { assertSameOrigin, loadAccount, loadAdmin, sessionToken } from '../http/sessions.js';
import type { SeenBatch, SeenMeta } from '../services/tracking.js';
import type { RouteDeps } from './public.js';

/** How long a resolved session is kept for /api/v1/seen. */
export const SEEN_SESSION_CACHE_MS = 30_000;
/** The resolved sessions kept at most (≈ 1 MB). */
export const SEEN_SESSION_CACHE_MAX = 5_000;

type Account = { id: string; email: string };

/** The sessions behind /api/v1/seen's batches, kept SEEN_SESSION_CACHE_MS by the hash of their token (an LRU). */
export class SeenSessions {
  private readonly cache = new Map<string, { until: number; value: Account | boolean | null }>();

  constructor(private readonly ctx: AppContext) {}

  /** How many entries the cache holds (tests). */
  get size(): number {
    return this.cache.size;
  }

  /** The request's account (id and email) and whether it carries a console session. */
  async of(request: FastifyRequest): Promise<{ account: Account | null; staff: boolean }> {
    const { ctx } = this;
    const adminToken = sessionToken(request, ctx.config, 'admin');
    const staff = adminToken ? await this.resolve(`admin\u0000${adminToken}`, async () => (await loadAdmin(ctx, request)) !== null) : false;
    const accountToken = sessionToken(request, ctx.config, 'account');
    const account = accountToken
      ? await this.resolve(`account\u0000${accountToken}`, async () => {
          const a = await loadAccount(ctx, request);
          return a ? { id: a.account.id, email: a.account.email } : null;
        })
      : null;
    return { account: account as Account | null, staff: staff === true };
  }

  private async resolve<T extends Account | boolean | null>(token: string, read: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(token).digest('base64url');
    const now = this.ctx.clock().getTime();
    const hit = this.cache.get(key);
    this.cache.delete(key);
    if (hit && hit.until > now) {
      this.cache.set(key, hit);
      return hit.value as T;
    }
    const value = await read();
    this.cache.set(key, { until: now + SEEN_SESSION_CACHE_MS, value });
    while (this.cache.size > SEEN_SESSION_CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }
}

export const seenRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'seen'));
  const sessions = new SeenSessions(ctx);
  const sameOrigin = async (request: FastifyRequest) => assertSameOrigin(ctx.config, request);

  app.post('/api/v1/seen', { onRequest: sameOrigin }, async (request, reply) => {
    const batch = parse(seenBody, request.body) as SeenBatch;
    const deviceHash = ensureDevice(request, reply, ctx.config);
    const { account, staff } = await sessions.of(request);
    const agent = request.headers['user-agent'];
    const meta: SeenMeta = {
      deviceHash,
      account,
      staff,
      ip: request.ip,
      userAgent: typeof agent === 'string' ? agent : null,
      headers: request.headers,
      place: connectionPlace(ctx, request),
      now: ctx.clock(),
    };
    await ctx.services.tracking.ingest(batch, meta);
    reply.header('cache-control', 'no-store');
    return reply.code(204).send();
  });
};
