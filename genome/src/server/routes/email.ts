/**
 * The emails' public routes (macro scope E0; lot M1 plan §4.1, §4.2).
 *
 *   GET /api/v1/email/monogram.png   the monogram every email shows at its head (email/render.ts): the master outlines
 *                                    in ivory on an ink disc, 96 × 96, drawn once by the server. Public, no cookie,
 *                                    kept a day, readable from any mail client (Cross-Origin-Resource-Policy:
 *                                    cross-origin), on the `media` rate budget.
 *
 * The unsubscribe routes (POST /api/v1/email/unsubscribe, one click and the page's button) are lot M1 step M1.17's.
 */
import type { FastifyPluginAsync } from 'fastify';
import { emailMonogramPng, EMAIL_MONOGRAM_PATH } from '../email/render.js';
import { rateLimitHook } from '../http/rate-limit.js';
import type { RouteDeps } from './public.js';

/** How long a mail client or a proxy keeps the monogram. */
export const EMAIL_MONOGRAM_CACHE_CONTROL = 'public, max-age=86400';

export const emailRoutes: FastifyPluginAsync<RouteDeps> = async (app, { limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));

  app.get(EMAIL_MONOGRAM_PATH, { config: { rateGroup: 'media' } }, async (_request, reply) => {
    const png = await emailMonogramPng();
    reply.header('cache-control', EMAIL_MONOGRAM_CACHE_CONTROL);
    reply.header('cross-origin-resource-policy', 'cross-origin');
    return reply.type('image/png').send(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  });
};
