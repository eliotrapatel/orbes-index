/**
 * The emails' public routes (macro scope E0; lot M1 plan §4.1, §4.2).
 *
 *   GET /api/v1/email/monogram.png   the monogram every email shows at its head (email/render.ts): the master outlines
 *                                    in ivory on an ink disc, 96 × 96, drawn once by the server. Public, no cookie,
 *                                    kept a day, readable from any mail client (Cross-Origin-Resource-Policy:
 *                                    cross-origin), on the `media` rate budget.
 *
 *   GET  /api/v1/email/unsubscribe?t=  what a link stops, for the page /verify/unsubscribe (which reads the token from
 *                                    its address's fragment): `{ kind }`, FOUNDING_ANNOUNCEMENT or RELEASE_NOTICE, or
 *                                    null for a token that is not the server's. Never stored by a cache.
 *   POST /api/v1/email/unsubscribe     STOP (lot M1 step M1.17): the page's button (JSON `{ token }`) or a mail client's
 *                                    one click (RFC 8058: `?t=<token>`, a form body List-Unsubscribe=One-Click, from any
 *                                    origin, without a cookie). The founding announcement's pre-registration
 *                                    unsubscribed, or the account's release notices stopped, their QUEUED emails
 *                                    cancelled (services/email-triggers.ts). The same answer, 200 `{ ok: true }`, for any
 *                                    token, a used or a forged one: nothing is said of who it was. No session is read;
 *                                    the token is the HMAC the server signed (services/email.ts), so no CSRF token is
 *                                    asked. The app logs a path without its query (http/logging.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { emailMonogramPng, EMAIL_MONOGRAM_PATH } from '../email/render.js';
import { rateLimitHook } from '../http/rate-limit.js';
import type { RouteDeps } from './public.js';

/** How long a mail client or a proxy keeps the monogram. */
export const EMAIL_MONOGRAM_CACHE_CONTROL = 'public, max-age=86400';

/** The unsubscribe's body, at most (bytes): a token, or a mail client's List-Unsubscribe=One-Click. */
export const UNSUBSCRIBE_BODY_LIMIT = 1024;

/** The token of an unsubscribe request: the page's JSON `{ token }`, else the one click's `?t=`. */
function tokenOf(body: unknown, query: unknown): unknown {
  if (body && typeof body === 'object' && 'token' in body) return (body as { token: unknown }).token;
  return query && typeof query === 'object' ? (query as { t?: unknown }).t : undefined;
}

export const emailRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  // A mail client's one click posts a form (RFC 8058): its words are not read, only the address's token. Here only.
  app.addContentTypeParser(['application/x-www-form-urlencoded', 'multipart/form-data'], { parseAs: 'string', bodyLimit: UNSUBSCRIBE_BODY_LIMIT }, (_request, _body, done) => done(null, {}));

  app.get('/api/v1/email/unsubscribe', async (request, reply) => {
    const t = tokenOf(null, request.query);
    reply.header('cache-control', 'no-store');
    return { kind: ctx.services.emails.unsubscribeKind(typeof t === 'string' && t.length <= 120 ? t : null) };
  });

  app.post('/api/v1/email/unsubscribe', { bodyLimit: UNSUBSCRIBE_BODY_LIMIT }, async (request, reply) => {
    const token = tokenOf(request.body, request.query);
    await ctx.services.emails.unsubscribe(typeof token === 'string' && token.length <= 120 ? token : null, request.orbes.ipHash);
    reply.header('cache-control', 'no-store');
    return { ok: true };
  });

  app.get(EMAIL_MONOGRAM_PATH, { config: { rateGroup: 'media' } }, async (_request, reply) => {
    const png = await emailMonogramPng();
    reply.header('cache-control', EMAIL_MONOGRAM_CACHE_CONTROL);
    reply.header('cross-origin-resource-policy', 'cross-origin');
    return reply.type('image/png').send(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  });
};
