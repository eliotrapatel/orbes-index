/**
 * Ownership routes (contract §3, cookie `orbes_session`): first registration
 * with a scan token (+ claim code), transfers, incident reports and the
 * withdrawal of a loss the owner reported (PIECE FOUND, MY PIECES), and the
 * owner's ownership certificates (F-06: create, list, withdraw; read through
 * the public `/api/v1/certificates/*`, routes/public.ts). A transfer
 * is accepted for the piece the recipient scanned, with the transfer token of
 * that scan (F-03): both required unless TRANSFER_ACCEPT_REQUIRE_PRODUCT=false.
 *
 * All are account-authenticated (the list of certificates is the one read),
 * so the scope guard enforces the session, and for every mutation the CSRF
 * token and same-origin checks. Registration, transfer acceptance and PIECE
 * FOUND take secrets (claim codes, transfer codes, the account's password)
 * and therefore draw from the `auth` rate-limit budget, on top of the
 * service's own per-product claim-attempt limit and the account's sign-in
 * throttle.
 *
 * WORN (plan MACRO M2 §2.2, D31 G1 to G3; services/worn.ts), the owner's
 * photograph of a piece for the model's sheet:
 *
 *   GET    /api/v1/account/products/:productId/worn   the piece's photograph, whether one may be sent and why not,
 *                                                     the credit it would carry, the consent's version
 *   POST   /api/v1/account/products/:productId/worn   ?instagram=0|1&consent=<version>, the body the image itself
 *                                                     (image/jpeg or image/webp, at most 1 MiB); 201 the piece's WORN
 *   DELETE /api/v1/account/worn/:id                   WITHDRAW, its bytes erased (204)
 *   GET    /api/v1/account/worn/:id/photo             its own photograph while in review or published (no-store)
 *
 * The POST is the only route here that takes an image: its parsers live in its own encapsulation context
 * (routes/admin/media.ts acceptImageBodies), so no other route accepts one. Its answers, the piece's WORN and the
 * photograph, are the owner's: never stored by a cache. Errors: 403 WORN_NOT_ALLOWED, 409 WORN_PROFILE_INCOMPLETE and
 * WORN_ALREADY, 429 WORN_LIMIT, 422 WORN_CONSENT, 404 WORN_NOT_FOUND, and the images' 400 IMAGE_INVALID, IMAGE_ANIMATED,
 * 413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE.
 *
 * Responses describe the ownership, never the product's internal status.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../http/rate-limit.js';
import {
  acceptTransferBody,
  assistedAcceptTransferBody,
  certificateParams,
  createCertificateBody,
  incidentBody,
  parse,
  productParams,
  productRefBody,
  registerOwnershipBody,
  resolveIncidentBody,
  wornParams,
  wornSendQuery,
} from '../http/schemas.js';
import { accountActor, requireAccount, sessionGuard } from '../http/sessions.js';
import type { OwnershipResult } from '../services/ownership.js';
import { acceptImageBodies, imageOf, MEDIA_BODY_LIMIT_BYTES } from './admin/media.js';
import type { RouteDeps } from './public.js';

/**
 * The collector's WORN upload (POST): the only collector route whose body is an image. The edge gives it the console's
 * photographs' limit (deploy/vps/Caddyfile @photo_upload, 1200KB over MEDIA_BODY_LIMIT_BYTES), every other collector
 * route keeps 64KB; test/ops/vps-stack.test.ts holds the two together.
 */
export const WORN_UPLOAD_ROUTE = '/api/v1/account/products/:productId/worn';

function ownershipJson(r: OwnershipResult) {
  return { productId: r.productId, verified: r.verified, since: r.since };
}

export const ownershipRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  const { auth, ownership, ownershipCertificates, worn } = ctx.services;
  // F-03: the scanned piece is required, unless ORBES Client Services assists acceptances (TRANSFER_ACCEPT_REQUIRE_PRODUCT=false).
  const acceptBody = ctx.config.transferAcceptRequireProduct ? acceptTransferBody : assistedAcceptTransferBody;

  app.post('/api/v1/ownership/register', { config: { rateGroup: 'auth' } }, async (request, reply) => {
    const { account } = requireAccount(request);
    const b = parse(registerOwnershipBody, request.body);
    const r = await ownership.registerFirst(account.id, { registrationToken: b.registrationToken, claimCode: b.claimCode ?? null }, accountActor(request));
    reply.code(201);
    return ownershipJson(r);
  });

  app.post('/api/v1/ownership/transfers', async (request, reply) => {
    const { account } = requireAccount(request);
    const b = parse(productRefBody, request.body);
    const offer = await ownership.initiateTransfer(account.id, b.productId, accountActor(request));
    reply.code(201);
    return { transferCode: offer.transferCode, expiresAt: offer.expiresAt };
  });

  app.post('/api/v1/ownership/transfers/accept', { config: { rateGroup: 'auth' } }, async (request) => {
    const { account } = requireAccount(request);
    const b = parse(acceptBody, request.body);
    const input = { transferCode: b.transferCode, productId: b.productId ?? null, transferToken: b.transferToken ?? null };
    return ownershipJson(await ownership.acceptTransfer(account.id, input, accountActor(request)));
  });

  app.post('/api/v1/ownership/transfers/cancel', async (request) => {
    const { account } = requireAccount(request);
    const b = parse(productRefBody, request.body);
    await ownership.cancelTransfer(account.id, b.productId, accountActor(request));
    return { ok: true };
  });

  app.post('/api/v1/ownership/incidents', async (request, reply) => {
    const { account } = requireAccount(request);
    const b = parse(incidentBody, request.body);
    const change = await ownership.reportIncident(account.id, b.productId, b.type, accountActor(request));
    reply.code(201);
    return { productId: change.productId, type: b.type, reportedAt: change.at };
  });

  // PIECE FOUND (MY PIECES, F-01): the owner withdraws a loss they reported themselves; a theft stays with ORBES Client Services.
  // The account's password is typed again (400 CURRENT_PASSWORD_INVALID when wrong, counted like a failed sign-in): a
  // session alone, left open on another device or taken over, does not make a piece reported lost read as clean.
  app.post('/api/v1/ownership/incidents/resolve', { config: { rateGroup: 'auth' } }, async (request) => {
    const { account } = requireAccount(request);
    const b = parse(resolveIncidentBody, request.body);
    const actor = accountActor(request);
    await auth.confirmAccountPassword(account.id, b.currentPassword, actor, 'incident_resolve');
    const change = await ownership.resolveIncident(account.id, b.productId, actor);
    return { productId: change.productId, type: 'LOST', resolvedAt: change.at };
  });

  // Ownership certificates (F-06, MY PIECES): the owner's links to the live record of a piece. The link is answered once,
  // at creation: only the hash of its token is kept. The session is read again in the creation's transaction: one ended
  // meanwhile by an assisted recovery or a password change gets no link (401).
  app.post('/api/v1/ownership/certificates', async (request, reply) => {
    const { account, session } = requireAccount(request);
    const b = parse(createCertificateBody, request.body);
    const opts = { sessionId: session.id, ...(b.validDays !== undefined ? { validDays: b.validDays } : {}) };
    const offer = await ownershipCertificates.create(account.id, b.productId, opts, accountActor(request));
    reply.code(201);
    return offer;
  });

  app.get('/api/v1/ownership/certificates', async (request) => {
    const { account } = requireAccount(request);
    return { certificates: await ownershipCertificates.listForAccount(account.id) };
  });

  // Withdrawn, a link answers 404 as one that never existed. Another account's link, or one already withdrawn, is a 404 too.
  app.delete('/api/v1/ownership/certificates/:id', async (request) => {
    const { account } = requireAccount(request);
    const { id } = parse(certificateParams, request.params);
    await ownershipCertificates.revoke(account.id, id, accountActor(request));
    return { ok: true };
  });

  // ── WORN (plan MACRO M2 §2.2) ──────────────────────────────────────────────

  app.get('/api/v1/account/products/:productId/worn', async (request, reply) => {
    const { account } = requireAccount(request);
    const { productId } = parse(productParams, request.params);
    reply.header('cache-control', 'no-store');
    return worn.ofPiece(account.id, productId);
  });

  // The sending: the only image this file takes, in its own context (the session, CSRF and same-origin checks inherited).
  await app.register(async (app) => {
    acceptImageBodies(app);
    app.post(WORN_UPLOAD_ROUTE, { bodyLimit: MEDIA_BODY_LIMIT_BYTES }, async (request, reply) => {
      const { account } = requireAccount(request);
      const { productId } = parse(productParams, request.params);
      const q = parse(wornSendQuery, request.query);
      const out = await worn.send(account.id, productId, imageOf(request.body), { instagram: q.instagram === '1', consent: q.consent }, accountActor(request));
      reply.header('cache-control', 'no-store');
      reply.code(201);
      return out;
    });
  });

  // WITHDRAW: another account's photograph, or one not live, is the same 404 as an unknown one.
  app.delete('/api/v1/account/worn/:id', async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(wornParams, request.params);
    await worn.withdraw(account.id, id, accountActor(request));
    return reply.code(204).send();
  });

  app.get('/api/v1/account/worn/:id/photo', { config: { rateGroup: 'media' } }, async (request, reply) => {
    const { account } = requireAccount(request);
    const { id } = parse(wornParams, request.params);
    const p = await worn.photo(id, { kind: 'owner', accountId: account.id });
    reply.header('cache-control', 'no-store');
    const bytes = p.bytes!;
    return reply.type(p.mime).send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
};
