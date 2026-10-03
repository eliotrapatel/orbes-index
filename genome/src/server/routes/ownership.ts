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
 * token and same-origin checks. Registration and transfer
 * acceptance take secrets (claim codes, transfer codes) and therefore draw
 * from the `auth` rate-limit budget on top of the service's own per-product
 * claim-attempt limit.
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
  productRefBody,
  registerOwnershipBody,
} from '../http/schemas.js';
import { accountActor, requireAccount, sessionGuard } from '../http/sessions.js';
import type { OwnershipResult } from '../services/ownership.js';
import type { RouteDeps } from './public.js';

function ownershipJson(r: OwnershipResult) {
  return { productId: r.productId, verified: r.verified, since: r.since };
}

export const ownershipRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  const { ownership, ownershipCertificates } = ctx.services;
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
  app.post('/api/v1/ownership/incidents/resolve', async (request) => {
    const { account } = requireAccount(request);
    const b = parse(productRefBody, request.body);
    const change = await ownership.resolveIncident(account.id, b.productId, accountActor(request));
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
};
