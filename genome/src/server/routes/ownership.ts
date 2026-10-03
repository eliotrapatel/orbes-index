/**
 * Ownership routes (contract §3, cookie `orbes_session`): first registration
 * with a scan token (+ claim code), transfers, incident reports and the
 * withdrawal of a loss the owner reported (PIECE FOUND, MY PIECES). A transfer
 * is accepted for the piece the recipient scanned, with the transfer token of
 * that scan (F-03): both required unless TRANSFER_ACCEPT_REQUIRE_PRODUCT=false.
 *
 * All are account-authenticated mutations, so the scope guard enforces the
 * session, CSRF token and same-origin checks. Registration and transfer
 * acceptance take secrets (claim codes, transfer codes) and therefore draw
 * from the `auth` rate-limit budget on top of the service's own per-product
 * claim-attempt limit.
 *
 * Responses describe the ownership, never the product's internal status.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../http/rate-limit.js';
import { acceptTransferBody, assistedAcceptTransferBody, incidentBody, parse, productRefBody, registerOwnershipBody } from '../http/schemas.js';
import { accountActor, requireAccount, sessionGuard } from '../http/sessions.js';
import type { OwnershipResult } from '../services/ownership.js';
import type { RouteDeps } from './public.js';

function ownershipJson(r: OwnershipResult) {
  return { productId: r.productId, verified: r.verified, since: r.since };
}

export const ownershipRoutes: FastifyPluginAsync<RouteDeps> = async (app, { ctx, limiters }) => {
  app.addHook('onRequest', rateLimitHook(limiters, 'api'));
  app.addHook('onRequest', sessionGuard(ctx, { kind: 'account' }));
  const { ownership } = ctx.services;
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
};
