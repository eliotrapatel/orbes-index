/**
 * Public routes (contract §3): health, public keys, categories, Client
 * Services contact, verify.
 *
 * Nothing here needs a session. /verify reads the account cookie only to
 * recognise the current owner, and the console cookie only to tell a staff
 * scan (S-07: recorded as ADMIN_TEST under that console user, outside
 * UNSOLD_PIECE_SCAN and the history rules, without a registration token); it sets the
 * `orbes_device` cookie and passes pseudonymous request metadata (hashed IP
 * and device, coarse geo and user agent family) to the verification service.
 * The response is the service's public outcome as is: it is built from an
 * allow-list there and never carries risk scores, thresholds or raw statuses.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { pseudonymize, userAgentFamily, userAgentOf } from '../http/client.js';
import { ensureDevice } from '../http/device.js';
import { rateLimitHook, type RateLimiters } from '../http/rate-limit.js';
import { parse, verifyBody } from '../http/schemas.js';
import { loadAccount, loadStaff } from '../http/sessions.js';
import type { ScanMeta } from '../services/verification.js';

export interface RouteDeps {
  ctx: AppContext;
  limiters: RateLimiters;
}

export interface PublicRouteDeps extends RouteDeps {
  /** The console's rule (ADMIN_REQUIRE_MFA): a console session counts as staff only past its second factor. */
  requireAdminMfa: boolean;
}

/** Package version, read once (falls back when the server runs bundled without package.json). */
export const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
})();

const HEALTH_DB_TIMEOUT_MS = 2_000;

export const publicRoutes: FastifyPluginAsync<PublicRouteDeps> = async (app, { ctx, limiters, requireAdminMfa }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));

  app.get('/api/v1/health', async (_request, reply) => {
    // Liveness plus a cheap database round trip; never says WHY it is down (that goes to the log).
    let ok = true;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        sql`SELECT 1`.execute(ctx.db),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('database ping timed out')), HEALTH_DB_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      ok = false;
      ctx.log.error({ err: { message: (e as Error)?.message } }, 'health check: database unavailable');
    } finally {
      clearTimeout(timer);
    }
    reply.code(ok ? 200 : 503);
    return { ok, version: APP_VERSION };
  });

  // Public keys are meant to be fetched by third-party verifiers: cacheable and readable cross-origin.
  const keys = async (_request: unknown, reply: FastifyReply) => {
    reply.header('cache-control', 'public, max-age=300');
    reply.header('access-control-allow-origin', '*');
    reply.header('cross-origin-resource-policy', 'cross-origin');
    return { keys: await ctx.keys.listPublic() };
  };
  app.get('/api/v1/keys', keys);
  app.get('/.well-known/orbes-keys.json', keys);

  app.get('/api/v1/categories', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    const list = await ctx.categories.list({ activeOnly: true });
    return list.map((c) => ({ code: c.code, index: c.index, name: c.name }));
  });

  // How ORBES Client Services is reached (CLIENT_SERVICES_*), for the contact the verification app offers on
  // non-authentic results and on a warranty that no longer applies. `{}` when nothing is configured: no contact shown.
  app.get('/api/v1/client-services', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    const { email, phone, hours } = ctx.config.clientServices;
    return { ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(hours ? { hours } : {}) };
  });

  app.post('/api/v1/verify', { config: { rateGroup: 'verify' } }, async (request, reply) => {
    const input = parse(verifyBody, request.body);
    const viewer = await loadAccount(ctx, request);
    const meta: ScanMeta = {
      deviceHash: ensureDevice(request, reply, ctx.config),
      ipHash: request.orbes.ipHash,
      geo: ctx.geo.resolve(request),
    };
    const family = userAgentFamily(userAgentOf(request));
    if (family) meta.userAgentFamily = family;
    if (viewer) {
      meta.accountId = viewer.account.id;
      // Keyed hash of the session id (itself sha256 of the token): links scans of one session, nothing more.
      meta.sessionHash = pseudonymize(ctx.config.ipHashPepper, 'session', viewer.session.id);
    }
    // A browser signed in to the console scans as staff (S-07): ADMIN_TEST, under that console user.
    const staff = await loadStaff(ctx, request, { requireMfa: requireAdminMfa });
    if (staff) meta.adminId = staff.admin.id;
    return ctx.services.verification.verify(input, meta);
  });
};
