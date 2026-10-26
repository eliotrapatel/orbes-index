/**
 * The advertising choice (lot M4 plan §3.2, §3.3; macro scope K27 A4): what the collector app's consent banner reads and
 * answers. No session is needed: the choice is the device's (the `__Host-orbes_device` cookie, http/device.ts) and, when
 * an account is signed in, the account's too.
 *
 *   GET  /api/v1/consent   `{ ads: { on, choice, textVersion, since } }` (AdsService.state): off, nothing more is read;
 *                          on, the account's latest choice when signed in, else the device's (null: none, the banner
 *                          shows), and the Paris day the switch was turned on (/legal/privacy reads it, lot M4 step
 *                          M4.14). Writes nothing and sets no cookie.
 *   POST /api/v1/consent   `{ choice, clicks? }` (consentBody): the banner's ACCEPT (GRANTED) or DECLINE (DECLINED), with
 *                          the click ids the address carried (kept only with GRANTED); 409 ADS_OFF while off. The
 *                          device cookie is set when there is none, as /api/v1/seen does. Answers the state after it.
 *
 * Same origin for the POST (assertSameOrigin, as /api/v1/seen: another site cannot record a choice); the rate group of
 * /api/v1/seen (`seen`). Never cached.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { pseudonymize, userAgentOf } from '../http/client.js';
import { ensureDevice, readDeviceId } from '../http/device.js';
import { rateLimitHook } from '../http/rate-limit.js';
import { consentBody, parse } from '../http/schemas.js';
import { assertSameOrigin, loadAccount } from '../http/sessions.js';
import type { RouteDeps } from './public.js';

/** The signed-in account behind the request, or null (no session, or one no longer valid). */
async function accountOf(ctx: AppContext, request: FastifyRequest): Promise<string | null> {
  return (await loadAccount(ctx, request))?.account.id ?? null;
}

export const consentRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'seen'));
  const { ads } = ctx.services;

  app.get('/api/v1/consent', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!(await ads.isOn())) return { ads: await ads.state(null, null) };
    const device = readDeviceId(request, ctx.config);
    const deviceId = device ? await ads.deviceIdOf(pseudonymize(ctx.config.ipHashPepper, 'device', device.id)) : null;
    return { ads: await ads.state(deviceId, await accountOf(ctx, request)) };
  });

  app.post('/api/v1/consent', { onRequest: async (request) => assertSameOrigin(ctx.config, request) }, async (request, reply) => {
    const b = parse(consentBody, request.body);
    reply.header('cache-control', 'no-store');
    // Off: refused before the device cookie is set (nothing captured while off).
    await ads.requireOn();
    const state = await ads.choose({
      deviceHash: ensureDevice(request, reply, ctx.config),
      accountId: await accountOf(ctx, request),
      choice: b.choice,
      source: 'BANNER',
      userAgent: userAgentOf(request),
      clicks: b.clicks ?? null,
    });
    return { ads: state };
  });
};
