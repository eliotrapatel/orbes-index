/**
 * The console links' short addresses (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.3, A.7.2, A.11; step 4.3; API
 * §8.15): `GET /go/<code>` (and HEAD; a trailing `/` accepted; the code compared in lower case) answers 302 to the
 * link's destination inside the app with `?o=<code>` added, which the app reads, removes from the address and sends
 * once as the page load's arrival (§3.4 A.9). An unknown code answers 302 `/verify`, counted for no link.
 *
 *   - Nothing is written here: a visit is counted by the app's arrival, never at the redirect, so the preview robots of
 *     Instagram, WhatsApp or iMessage, which fetch a link to draw its card, count nothing.
 *   - One read by `links_code_key` and the model's current slug (LinkService.resolve): a renamed sheet never breaks a
 *     link. Destinations are ORBES pages only: no open redirect.
 *   - `cache-control: no-store` (a link moved to another release redirects there at once), `x-robots-tag: noindex,
 *     nofollow`, and `Referrer-Policy: strict-origin-when-cross-origin` on this 302 only, over helmet's `no-referrer`:
 *     under the Fetch standard a redirect's own policy applies to the redirected request, so the referring site's origin
 *     (never its path) reaches the app's `document.referrer`. Every other response keeps `no-referrer`.
 *   - The `api` rate group. Registered here, not with the web apps (http/static.ts), so it works without the web build.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { rateLimitHook } from '../http/rate-limit.js';
import { parse } from '../http/schemas.js';
import { REDIRECT_REFERRER_POLICY } from '../http/security.js';
import { NOINDEX } from '../http/static.js';
import type { RouteDeps } from './public.js';

/** Any code the router passes: one that is no link's answers like an unknown one. */
const goParams = z.object({ code: z.string().max(200) });

export const acquisitionRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));

  const go = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = parse(goParams, request.params);
    const c = code.trim().toLowerCase();
    const path = await ctx.services.links.resolve(c);
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', NOINDEX);
    reply.header('referrer-policy', REDIRECT_REFERRER_POLICY);
    return reply.redirect(path === null ? '/verify' : `${path}?o=${encodeURIComponent(c)}`, 302);
  };
  // The app ignores a trailing slash (app.ts): /go/<code>/ is the same route.
  app.get('/go/:code', go);
};
