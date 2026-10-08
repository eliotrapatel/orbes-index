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
import { accountAddressBody, accountAddressParams, accountAddressUpdateBody, accountClaimCodeBody, accountOrderAddressBody, accountOrderParams, accountSizesBody, careParams, careRequestBody, changePasswordBody, emptyBody, loginBody, parse, productParams, recoverAccountBody, registerAccountBody } from '../http/schemas.js';
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
  const { addresses, auth, care, claimRenewals, invoices, orders, ownership, ownershipCertificates, pastReleases, questions, recovery, sizes, warranty } = ctx.services;

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

  // YOUR SIZES (plan NEXT-NINE, AC-01; API §10.19): the sizes the account saved, in its units (a ring size, centimetres),
  // and saved whole: a kind null or left out is cleared. They preselect a size the collector then confirms; nothing else.
  app.get('/api/v1/account/sizes', async (request) => {
    const { account } = requireAccount(request);
    return { sizes: await sizes.get(account.id) };
  });

  app.put('/api/v1/account/sizes', async (request) => {
    const { account } = requireAccount(request);
    const b = parse(accountSizesBody, request.body);
    return { sizes: await sizes.set(account.id, b.sizes, accountActor(request)) };
  });

  // YOUR ADDRESSES (plan NEXT LOT §3.6.B; API §10.21): the delivery addresses the account keeps, at most 5, one of them the
  // default (put on each new order), with its registration country (`defaultCountry`, which preselects COUNTRY). Never
  // stored by a cache.
  app.get('/api/v1/account/addresses', async (request, reply) => {
    const { account } = requireAccount(request);
    reply.header('cache-control', 'no-store');
    return addresses.list(account.id);
  });

  app.post('/api/v1/account/addresses', async (request, reply) => {
    const { account } = requireAccount(request);
    const b = parse(accountAddressBody, request.body);
    const r = await addresses.create(account.id, b, accountActor(request));
    reply.header('cache-control', 'no-store');
    reply.code(201);
    return r;
  });

  app.put('/api/v1/account/addresses/:id', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountAddressParams, request.params);
    const b = parse(accountAddressUpdateBody, request.body);
    reply.header('cache-control', 'no-store');
    return addresses.update(account.id, id, b, accountActor(request));
  });

  app.delete('/api/v1/account/addresses/:id', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountAddressParams, request.params);
    await addresses.remove(account.id, id, accountActor(request));
    return reply.code(204).send();
  });

  app.post('/api/v1/account/addresses/:id/default', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountAddressParams, request.params);
    parse(emptyBody, request.body);
    await addresses.makeDefault(account.id, id, accountActor(request));
    return reply.code(204).send();
  });

  // An order's delivery address (plan NEXT LOT §3.6.B): one of the account's saved addresses, or a new one, until packing
  // starts (409 ORDER_PACKING_STARTED after: ORBES Client Services changes it); the order as MY PIECES reads it.
  app.put('/api/v1/account/orders/:id/address', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    const b = parse(accountOrderAddressBody, request.body);
    reply.header('cache-control', 'no-store');
    return { order: await orders.setAddress(account.id, id, b as Parameters<typeof orders.setAddress>[2], accountActor(request)) };
  });

  // MY PIECES (plan LIVE RELEASE+, choice 6): the account's own orders, step by step; never another account's.
  app.get('/api/v1/account/orders', async (request) => {
    const { account } = requireAccount(request);
    return { orders: await orders.forAccount(account.id) };
  });

  // THE RELEASES' PAST (plan LIVE RELEASE+, choice 5): the releases the account took part in, each with whether it
  // secured a piece there (YOU TOOK PART, YOU SECURED A PIECE), and how many (« You have taken part in N releases »).
  app.get('/api/v1/account/participation', async (request) => {
    const { account } = requireAccount(request);
    return pastReleases.participation(account.id);
  });

  // MY PIECES (plan LIVE RELEASE+, choice 11): the questions after the LIVE RELEASES the account said I'LL BE THERE to
  // and never came to, open for a week after each one's end, with its answer when it gave one.
  app.get('/api/v1/account/questions', async (request) => {
    const { account } = requireAccount(request);
    return { questions: await questions.forPieces(account.id) };
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

  // NEW CLAIM CODE (plan NEXT LOT §3.4; API §10.20): a new claim code ORBES Client Services made for the piece of one of the
  // account's orders, read once (SHOW THE CODE: a POST, never on a page load); its new card (the code in the body, never
  // in a URL); REGISTER THIS PIECE with it, without a scan, once the order is shipped. Never stored by a cache.
  app.post('/api/v1/account/orders/:id/claim-code', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    parse(emptyBody, request.body);
    reply.header('cache-control', 'no-store');
    return claimRenewals.reveal(account.id, id, accountActor(request));
  });

  app.post('/api/v1/account/orders/:id/claim-card.pdf', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    const b = parse(accountClaimCodeBody, request.body);
    return sendPdf(reply, await claimRenewals.newCard(account.id, id, b.claimCode, accountActor(request)));
  });

  app.post('/api/v1/account/orders/:id/register', { config: { rateGroup: 'auth' } }, async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    const b = parse(accountClaimCodeBody, request.body);
    const r = await ownership.registerFromOrder(account.id, id, b.claimCode, accountActor(request));
    reply.code(201);
    reply.header('cache-control', 'no-store');
    return { productId: r.productId, verified: r.verified, since: r.since };
  });

  app.get('/api/v1/account/orders/:id/care-guide', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(accountOrderParams, request.params);
    return { careGuide: await orders.careGuide(account.id, id) };
  });

  // The yearly care (plan NEXT-NINE, BP-19 T6; API §10.18): asked for from a piece the account holds, with the address
  // it returns to in the request's own form (prefilled from the account's last order); its prepaid label downloaded
  // here only, by its own account (404 for any other). Nothing is written in MESSAGES.
  // Every answer of the piece's care carries the address hint, the POSTs' too, so that after CANCEL REQUEST the form
  // opens prefilled again (to change the address, the collector cancels and asks again). It is read once the status
  // has settled, so a request's transaction never waits on a read beside it.
  const withHint = async <T extends object>(accountId: string, status: Promise<T>) => {
    const s = await status;
    return { ...s, addressHint: await care.addressHint(accountId) };
  };

  app.get('/api/v1/account/products/:productId/care', async (request) => {
    const { account } = requireAccount(request);
    const { productId } = parse(productParams, request.params);
    return withHint(account.id, care.status(account.id, productId));
  });

  app.post('/api/v1/account/products/:productId/care', async (request, reply) => {
    const { account } = requireAccount(request);
    const { productId } = parse(productParams, request.params);
    const b = parse(careRequestBody, request.body);
    const status = await withHint(account.id, care.request(account.id, productId, { name: b.name, address: b.address }, accountActor(request)));
    reply.code(201);
    return status;
  });

  app.post('/api/v1/account/care/:id/cancel', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(careParams, request.params);
    return withHint(account.id, care.cancelByAccount(account.id, id, accountActor(request)));
  });

  app.get('/api/v1/account/care/:id/label.pdf', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(careParams, request.params);
    return sendPdf(reply, await care.labelPdf(account.id, id));
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
