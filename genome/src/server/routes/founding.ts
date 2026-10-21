/**
 * POST and OPTIONS /api/v1/founding (plan MACRO M1 §3.1; macro scope F2, F3): theorbes.com's form adds a person to the
 * founding list (services/founding.ts). No session: nobody is signed in on theorbes.com, and no cookie is read or set.
 *
 *   - CORS for https://theorbes.com only (FOUNDING_ORIGIN): `Access-Control-Allow-Origin` exactly that origin and `Vary:
 *     Origin` on every answer of these routes, errors and 429 included, so that the form can read them; the preflight
 *     (OPTIONS, 204) allows POST and `content-type`, `Access-Control-Max-Age` 600, no credentials.
 *   - Any other Origin, or none, is refused 403 FOUNDING_ORIGIN by the server itself: CORS only stops a browser from
 *     reading the answer, never a script from sending.
 *   - JSON only (app.ts drops the text/plain parser, so a cross-site « simple » POST never reaches the handler), 2 KB at
 *     most (FOUNDING_BODY_LIMIT, under the edge's 64 KB).
 *   - The rate group `founding` (http/rate-limit.ts: the api budget ÷ 12, about 10 a minute per network) for the POST;
 *     the preflight, which does no work, draws on `api`.
 *   - 202 `{ ok: true }` whether the person was added, was on the list already, or filled the honeypot: nobody learns
 *     whether an address is on the list. 400 VALIDATION_FAILED with `fields` in the collector's words, 403
 *     FOUNDING_ORIGIN, 413 over 2 KB, 429 RATE_LIMITED.
 *
 * Caddy (deploy/vps) passes OPTIONS and POST to the app as it is: nothing changes at the edge.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../errors.js';
import { rateLimitHook } from '../http/rate-limit.js';
import { foundingBody, parse } from '../http/schemas.js';
import { FOUNDING_ORIGIN } from '../services/founding.js';
import type { Actor } from '../types.js';
import type { RouteDeps } from './public.js';

/** The form's body, at most (bytes). */
export const FOUNDING_BODY_LIMIT = 2 * 1024;
/** How long a browser keeps the preflight's answer (seconds). */
export const FOUNDING_PREFLIGHT_MAX_AGE = 600;

const ROUTE = '/api/v1/founding';

const foreignOrigin = () => new DomainError('FOUNDING_ORIGIN', 403, 'This form is only available on theorbes.com.');

/** Whether the request comes from theorbes.com's page (its Origin header exactly). */
export function foundingOriginAllowed(request: Pick<FastifyRequest, 'headers'>): boolean {
  return request.headers.origin === FOUNDING_ORIGIN;
}

export const foundingRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  // First: the CORS headers, on every answer of these routes (a refusal included, so the form reads its words), then the
  // server's own Origin check, then the rate limit.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('vary', 'Origin');
    if (foundingOriginAllowed(request)) reply.header('access-control-allow-origin', FOUNDING_ORIGIN);
  });
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!foundingOriginAllowed(request)) throw foreignOrigin();
  });
  app.addHook('onRequest', rateLimitHook(limiters, 'founding'));

  app.options(ROUTE, { config: { rateGroup: 'api' } }, async (_request, reply) => {
    reply.header('access-control-allow-methods', 'POST');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-max-age', String(FOUNDING_PREFLIGHT_MAX_AGE));
    reply.header('cache-control', 'no-store');
    return reply.code(204).send();
  });

  app.post(ROUTE, { bodyLimit: FOUNDING_BODY_LIMIT }, async (request, reply) => {
    const input = parse(foundingBody, request.body);
    const actor: Actor = { type: 'system', id: 'public', ipHash: request.orbes.ipHash };
    await ctx.services.founding.register(input, actor);
    reply.header('cache-control', 'no-store');
    return reply.code(202).send({ ok: true });
  });
};
