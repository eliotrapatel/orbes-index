/**
 * Public routes (contract §3): health, public keys, categories, Client
 * Services contact, verify, the photographs an authentic result shows
 * (F-04), the report a customer may attach to a scan that was not
 * authentic, and the ownership certificate an owner shares (F-06: its
 * live record and its PDF, by the token of the link).
 *
 * Nothing here needs a session. /verify reads the account cookie only to
 * recognise the current owner, and the console cookie only to tell a staff
 * scan (S-07: recorded as ADMIN_TEST under that console user, outside
 * UNSOLD_PIECE_SCAN and the history rules, without a registration token); it sets the
 * `orbes_device` cookie and passes pseudonymous request metadata (hashed IP
 * and device, coarse geo and user agent family) to the verification service.
 * The response is the service's public outcome as is: it is built from an
 * allow-list there and never carries risk scores, thresholds or raw statuses.
 *
 * /reports needs no session either, but it writes: a cross-site form must
 * not reach it (same-origin check, as for registration and login), and it
 * draws on the `verify` budget, like the scan it follows.
 *
 * /certificates/lookup and /certificates/pdf read only. The token travels in
 * the body: the page takes it from the link's fragment (`/verify/c#…`), which
 * no request line or proxy log ever holds. One 404 for an unknown, malformed
 * or withdrawn link; the `verify` budget, like a scan.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { pseudonymize, userAgentFamily, userAgentOf } from '../http/client.js';
import { ensureDevice } from '../http/device.js';
import { rateLimitHook, type RateLimiters } from '../http/rate-limit.js';
import { certificateTokenBody, mediaParams, parse, reportBody, verifyBody } from '../http/schemas.js';
import { assertSameOrigin, loadAccount, loadStaff } from '../http/sessions.js';
import { notFound } from '../errors.js';
import type { Actor } from '../types.js';
import type { ScanMeta } from '../services/verification.js';
import { safeFilename } from './admin/codes.js';

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

/** A stored photograph never changes (its name is the SHA-256 of its bytes): browsers keep it for a year. */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Whether an If-None-Match header names `etag` (a list, weak validators and `*` included). */
function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) return false;
  return value.split(',').some((t) => {
    const tag = t.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

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

  // The photographs of an authentic result (§8.6): a model's reference photograph, a piece's own. Public, like the
  // result that names them; the URL is the SHA-256 of the bytes, so the answer never changes and is cached for good.
  app.get('/api/v1/media/:sha256', async (request, reply) => {
    const { sha256 } = parse(mediaParams, request.params);
    const etag = `"${sha256}"`;
    const revalidating = matchesEtag(request.headers['if-none-match'], etag);
    const found = await ctx.services.media.get(sha256, { withBytes: !revalidating });
    if (!found) throw notFound('Image', 'MEDIA_NOT_FOUND');
    reply.header('cache-control', MEDIA_CACHE_CONTROL);
    reply.header('etag', etag);
    if (revalidating || !found.bytes) return reply.code(304).send();
    const bytes = found.bytes;
    return reply.type(found.mime).send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
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

  // Where the customer saw or bought the piece of a scan that was not authentic (§8.5): one report per
  // scan, within 24 hours; it opens a case in the console's Cases queue.
  const sameOrigin = async (request: FastifyRequest) => assertSameOrigin(ctx.config, request);
  app.post('/api/v1/reports', { config: { rateGroup: 'verify' }, onRequest: sameOrigin }, async (request, reply) => {
    const input = parse(reportBody, request.body);
    const viewer = await loadAccount(ctx, request);
    // A signed-in customer reports as their account; anyone else as the public visitor of /verify.
    const actor: Actor = viewer
      ? { type: 'account', id: viewer.account.id, ipHash: request.orbes.ipHash }
      : { type: 'system', id: 'public', ipHash: request.orbes.ipHash };
    await ctx.services.reports.submit({ scanId: input.scanId, channel: input.channel, place: input.where ?? null, note: input.note ?? null }, actor);
    reply.code(201);
    return { ok: true };
  });

  // The ownership certificate (F-06, §8.7): VALID with the record read now, or NO_LONGER_VALID; never a name or an email.
  app.post('/api/v1/certificates/lookup', { config: { rateGroup: 'verify' } }, async (request) => {
    const { token } = parse(certificateTokenBody, request.body);
    return ctx.services.ownershipCertificates.lookup(token);
  });

  // Its PDF, an attachment never stored: only while VALID (409 CERTIFICATE_NO_LONGER_VALID otherwise).
  app.post('/api/v1/certificates/pdf', { config: { rateGroup: 'verify' } }, async (request, reply) => {
    const { token } = parse(certificateTokenBody, request.body);
    const file = await ctx.services.ownershipCertificates.renderPdf(token);
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    const body = file.body as Uint8Array;
    return reply.send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  });
};
