/**
 * Customer account routes (contract §3, cookie `orbes_session`).
 *
 * The scope's guard (http/sessions.ts) requires a live account session and,
 * for every POST, the CSRF token and a same-origin request. Registration and
 * login are the only session-less routes (same-origin check only) and share
 * the `auth` rate-limit budget with the other credential-guessing surfaces.
 *
 * Responses never expose internal ids of other people, product statuses or
 * staff data; the account itself is described by email and display name.
 */
import type { FastifyPluginAsync } from 'fastify';
import { forbidden } from '../errors.js';
import { userAgentOf } from '../http/client.js';
import { rateLimitHook } from '../http/rate-limit.js';
import { loginBody, parse, productParams, registerAccountBody } from '../http/schemas.js';
import { clearSessionCookie, clientMeta, requireAccount, sessionGuard, sessionToken, setSessionCookie } from '../http/sessions.js';
import type { AccountProfile } from '../services/auth.js';
import { requireProduct } from '../services/lifecycle.js';
import type { RouteDeps } from './public.js';

/** The public view of an account (contract: `{ email, displayName }`). */
export function accountJson(a: AccountProfile): { email: string; displayName: string | null } {
  return { email: a.email, displayName: a.displayName };
}

export const accountRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  const { auth, ownership, warranty } = ctx.services;

  app.post('/api/v1/account/register', { config: { guard: { session: 'none' }, rateGroup: 'auth' } }, async (request, reply) => {
    const b = parse(registerAccountBody, request.body);
    const { account, session } = await auth.registerAccount(
      { email: b.email, password: b.password, displayName: b.displayName ?? null },
      clientMeta(request, 'account', userAgentOf(request)),
    );
    setSessionCookie(reply, ctx.config, 'account', session);
    reply.code(201);
    return { account: accountJson(account), csrfToken: session.csrfToken };
  });

  app.post('/api/v1/account/login', { config: { guard: { session: 'none' }, rateGroup: 'auth' } }, async (request, reply) => {
    const b = parse(loginBody, request.body);
    const { account, session } = await auth.login({ email: b.email, password: b.password }, clientMeta(request, 'account', userAgentOf(request)));
    setSessionCookie(reply, ctx.config, 'account', session);
    return { account: accountJson(account), csrfToken: session.csrfToken };
  });

  app.post('/api/v1/account/logout', { config: { guard: { session: 'optional' } } }, async (request, reply) => {
    const token = sessionToken(request, 'account');
    if (token && request.orbes.account) await auth.logout(token, 'account', { ipHash: request.orbes.ipHash });
    clearSessionCookie(reply, ctx.config, 'account');
    return { ok: true };
  });

  app.get('/api/v1/account/me', async (request) => {
    const { account, session } = requireAccount(request);
    return { account: accountJson(account), csrfToken: session.csrfToken };
  });

  app.get('/api/v1/account/products', async (request) => {
    const { account } = requireAccount(request);
    return { products: await ownership.listForAccount(account.id) };
  });

  app.get('/api/v1/products/:productId/service-history', async (request) => {
    const { account } = requireAccount(request);
    const { productId } = parse(productParams, request.params);
    const product = await requireProduct(ctx.db, productId);
    const owner = await ownership.currentOwner(product.id);
    if (!owner || owner.accountId !== account.id) throw forbidden('Only the current owner can see the service history of this product.');
    const services = await warranty.services(product.id);
    // Owner view: what was done and when. Staff notes and technician names stay internal.
    return {
      productId: product.product_id,
      services: services.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        location: s.location,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
      })),
    };
  });
};
