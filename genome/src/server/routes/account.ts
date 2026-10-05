/**
 * Customer account routes (contract §3, cookie `orbes_session`).
 *
 * The scope's guard (http/sessions.ts) requires a live account session and,
 * for every POST, the CSRF token and a same-origin request. Registration,
 * login and the assisted recovery are the only session-less routes
 * (same-origin check only); they and the password change share the `auth`
 * rate-limit budget with the other credential-guessing surfaces.
 *
 * Password (C-04): a signed-in customer changes it with the current one
 * (keeping this session, ending the others); one who forgot it sets a new
 * one with the recovery code ORBES Client Services issued
 * (services/account-recovery.ts).
 *
 * Responses never expose internal ids of other people, product statuses or
 * staff data; the account itself is described by email and display name.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { forbidden } from '../errors.js';
import { userAgentOf } from '../http/client.js';
import { rateLimitHook } from '../http/rate-limit.js';
import { accountOrderParams, changePasswordBody, loginBody, parse, productParams, recoverAccountBody, registerAccountBody } from '../http/schemas.js';
import { accountActor, clearSessionCookie, clientMeta, requireAccount, sessionGuard, sessionToken, setSessionCookie } from '../http/sessions.js';
import type { AccountProfile } from '../services/auth.js';
import { findProduct } from '../services/lifecycle.js';
import { safeFilename } from './admin/codes.js';
import type { RouteDeps } from './public.js';

/** The public view of an account (contract: `{ email, displayName }`). */
export function accountJson(a: AccountProfile): { email: string; displayName: string | null } {
  return { email: a.email, displayName: a.displayName };
}

export const accountRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  const { auth, invoices, orders, ownership, ownershipCertificates, recovery, warranty } = ctx.services;

  app.post('/api/v1/account/register', { config: { guard: { session: 'none' }, rateGroup: 'auth' } }, async (request, reply) => {
    const b = parse(registerAccountBody, request.body);
    const { account, session } = await auth.registerAccount(
      { email: b.email, password: b.password, displayName: b.displayName ?? null, country: b.country ?? null },
      clientMeta(request, ctx.config, 'account', userAgentOf(request)),
    );
    setSessionCookie(reply, ctx.config, 'account', session);
    reply.code(201);
    return { account: accountJson(account), csrfToken: session.csrfToken };
  });

  app.post('/api/v1/account/login', { config: { guard: { session: 'none' }, rateGroup: 'auth' } }, async (request, reply) => {
    const b = parse(loginBody, request.body);
    const { account, session } = await auth.login({ email: b.email, password: b.password }, clientMeta(request, ctx.config, 'account', userAgentOf(request)));
    setSessionCookie(reply, ctx.config, 'account', session);
    return { account: accountJson(account), csrfToken: session.csrfToken };
  });

  app.post('/api/v1/account/logout', { config: { guard: { session: 'optional' } } }, async (request, reply) => {
    const token = sessionToken(request, ctx.config, 'account');
    if (token && request.orbes.account) await auth.logout(token, 'account', { ipHash: request.orbes.ipHash });
    clearSessionCookie(reply, ctx.config, 'account');
    return { ok: true };
  });

  // A wrong current password is 400 CURRENT_PASSWORD_INVALID, never a 401 (which signs the app out).
  app.post('/api/v1/account/password', { config: { rateGroup: 'auth' } }, async (request) => {
    const { account, token } = requireAccount(request);
    const b = parse(changePasswordBody, request.body);
    await auth.changePassword({ type: 'account', id: account.id }, { currentPassword: b.currentPassword, newPassword: b.newPassword }, accountActor(request), {
      keepToken: token,
    });
    return { ok: true };
  });

  // One answer for an unknown email and a wrong, expired or used code (400 RECOVERY_CODE_INVALID). No session is
  // opened: every session of the account ends, and the customer signs in with the new password.
  app.post('/api/v1/account/recover', { config: { guard: { session: 'none' }, rateGroup: 'auth' } }, async (request) => {
    const b = parse(recoverAccountBody, request.body);
    const r = await recovery.recover(
      { email: b.email, recoveryCode: b.recoveryCode, newPassword: b.newPassword },
      { ipHash: request.orbes.ipHash, userAgent: userAgentOf(request) },
    );
    return { ok: true, transfersPausedUntil: r.transfersFrozenUntil };
  });

  // Session probe for pages that only want to know whether someone is signed in: an anonymous visitor
  // gets 200 { account: null } instead of /me's 401 (which browsers log as a console error).
  app.get('/api/v1/account/session', { config: { guard: { session: 'optional' } } }, async (request) => {
    const auth = request.orbes.account;
    if (!auth) return { account: null };
    return { account: accountJson(auth.account), csrfToken: auth.session.csrfToken };
  });

  app.get('/api/v1/account/me', async (request) => {
    const { account, session } = requireAccount(request);
    return { account: accountJson(account), csrfToken: session.csrfToken };
  });

  app.get('/api/v1/account/products', async (request) => {
    const { account } = requireAccount(request);
    return { products: await ownership.listForAccount(account.id) };
  });

  // MY PIECES (plan LIVE RELEASE+, choice 6): the account's own orders, step by step; never another account's.
  app.get('/api/v1/account/orders', async (request) => {
    const { account } = requireAccount(request);
    return { orders: await orders.forAccount(account.id) };
  });

  // An order's documents in MY PIECES (plan LIVE RELEASE+, M6), its own only (404 for any other): the invoice and the
  // credit note, the ownership certificate once its piece is registered to the account (PDFs, never stored by a
  // cache), and the model's care guide.
  const sendPdf = (reply: FastifyReply, file: { contentType: string; body: Uint8Array | string; filename: string }) => {
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    const body = file.body as Uint8Array;
    return reply.send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  };

  app.get('/api/v1/account/orders/:id/invoice.pdf', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    return sendPdf(reply, await invoices.accountDocument(account.id, id, 'INVOICE'));
  });

  app.get('/api/v1/account/orders/:id/credit-note.pdf', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    return sendPdf(reply, await invoices.accountDocument(account.id, id, 'CREDIT_NOTE'));
  });

  app.get('/api/v1/account/orders/:id/certificate.pdf', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    return sendPdf(reply, await ownershipCertificates.orderCertificatePdf(account.id, id));
  });

  app.get('/api/v1/account/orders/:id/care-guide', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    return { careGuide: await orders.careGuide(account.id, id) };
  });

  app.get('/api/v1/products/:productId/service-history', async (request) => {
    const { account } = requireAccount(request);
    const { productId } = parse(productParams, request.params);
    // Unknown and not-owned products answer alike, so product ids cannot be enumerated here.
    const notYours = () => forbidden('Only the current owner can see the service history of this product.');
    const product = await findProduct(ctx.db, productId);
    if (!product) throw notYours();
    const owner = await ownership.currentOwner(product.id);
    if (!owner || owner.accountId !== account.id) throw notYours();
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
