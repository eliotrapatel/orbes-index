/**
 * The warranty claims of the console (plan ORBES CARE of 2026-10-15, §2(c) « Routes », step 1.7): a claim opened by
 * Client Services from the collector's conversation, its prepaid label, the piece received, the decision and the
 * shipment. Every step is an OPERATOR's (answer 11: Client Services decide every outcome, not only an ADMIN).
 *
 *   GET  /api/admin/warranty-claims             AUDITOR   the Claims tab: the claims under way first, then the others,
 *                                                         newest first; `?status=` one step
 *   GET  /api/admin/warranty-claims/:id         AUDITOR   a claim: the piece, the claimant and the registered owner, its
 *                                                         basis, steps, decision, and what a decision may be now
 *   POST /api/admin/warranty-claims             OPERATOR  open {conversationId, productId, basis, note}: the ORBES warranty
 *                                                         (its kind read from the piece) or the legal guarantee;
 *                                                         `conversationId` null for a buyer without an account
 *   POST /api/admin/warranty-claims/:id/receive OPERATOR  RECEIVED BY ORBES: the INSPECTION record opened
 *   POST /api/admin/warranty-claims/:id/decide  OPERATOR  DECIDE {outcome, refusalReason?, replacementProductId?,
 *                                                         otherSize?, valueMinor?}
 *   POST /api/admin/warranty-claims/:id/legal   OPERATOR  MOVE TO THE LEGAL GUARANTEE {note?}: a received 2-year claim
 *   POST /api/admin/warranty-claims/:id/ship    OPERATOR  SHIP {carrierId, tracking, replacementProductId?}: the new piece
 *                                                         (its identity chosen again when needed), or the piece back
 *   POST /api/admin/warranty-claims/:id/cancel  OPERATOR  CLOSE {note}: OPEN or LABEL_SENT
 *
 * The claim's prepaid label is sent through PRIVATE CARE's upload path, POST /api/admin/care/:id/label with the claim's
 * id (routes/admin/care.ts): the edge lets a body over 64 KB through on that path only (deploy/vps/Caddyfile), and
 * deploy/vps never changes. An AUDITOR reads the clients' emails masked (serialize.ts), and no note on a claim of a buyer
 * without an account. services/warranty-claims.ts
 * checks, steps and audits each change (`warranty.claim.*`: never the note nor an email).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  adminWarrantyClaimsQuery,
  emptyBody,
  pageOf,
  parse,
  warrantyClaimCancelBody,
  warrantyClaimDecideBody,
  warrantyClaimLegalBody,
  warrantyClaimOpenBody,
  warrantyClaimParams,
  warrantyClaimShipBody,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { ClaimBoardRow, ClaimSheet } from '../../services/warranty-claims.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

function rowJson<T extends ClaimBoardRow>(r: T, inClear: boolean): T {
  return { ...r, account: r.account ? { ...r.account, email: clientEmail(r.account.email, inClear) } : null };
}

/**
 * A claim as the console reads it: the claimant's and the registered owner's emails masked for an AUDITOR, and the note
 * of a buyer without an account withheld from an AUDITOR (the boutique sale's receipt, the only place staff write about
 * such a buyer).
 */
export function claimSheetJson(s: ClaimSheet, inClear: boolean): ClaimSheet {
  return {
    ...rowJson(s, inClear),
    registeredOwner: s.registeredOwner ? { ...s.registeredOwner, email: clientEmail(s.registeredOwner.email, inClear) } : null,
    note: !inClear && s.account === null ? null : s.note,
  };
}

export const adminWarrantyClaimRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { warrantyClaims } = ctx.services;

  app.get('/api/admin/warranty-claims', async (request) => {
    const q = parse(adminWarrantyClaimsQuery, request.query);
    const page = await warrantyClaims.list({ ...(q.status ? { status: q.status } : {}) }, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((r) => rowJson(r, inClear)) };
  });

  app.get('/api/admin/warranty-claims/:id', async (request) => {
    const { id } = parse(warrantyClaimParams, request.params);
    return claimSheetJson(await warrantyClaims.sheet(id), readsClientEmails(request));
  });

  app.post('/api/admin/warranty-claims', async (request, reply) => {
    const b = parse(warrantyClaimOpenBody, request.body);
    const sheet = await warrantyClaims.open({ conversationId: b.conversationId, productId: b.productId, basis: b.basis, note: b.note ?? null }, adminActor(request));
    reply.code(201);
    return claimSheetJson(sheet, readsClientEmails(request));
  });

  app.post('/api/admin/warranty-claims/:id/receive', async (request) => {
    const { id } = parse(warrantyClaimParams, request.params);
    parse(emptyBody, request.body);
    return claimSheetJson(await warrantyClaims.receive(id, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/warranty-claims/:id/decide', async (request) => {
    const { id } = parse(warrantyClaimParams, request.params);
    const b = parse(warrantyClaimDecideBody, request.body);
    const sheet = await warrantyClaims.decide(
      id,
      { outcome: b.outcome, refusalReason: b.refusalReason ?? null, replacementProductId: b.replacementProductId ?? null, otherSize: b.otherSize ?? false, valueMinor: b.valueMinor ?? null },
      adminActor(request),
    );
    return claimSheetJson(sheet, readsClientEmails(request));
  });

  app.post('/api/admin/warranty-claims/:id/legal', async (request) => {
    const { id } = parse(warrantyClaimParams, request.params);
    const b = parse(warrantyClaimLegalBody, request.body);
    return claimSheetJson(await warrantyClaims.moveToLegal(id, { note: b.note ?? null }, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/warranty-claims/:id/ship', async (request) => {
    const { id } = parse(warrantyClaimParams, request.params);
    const b = parse(warrantyClaimShipBody, request.body);
    return claimSheetJson(await warrantyClaims.ship(id, { carrierId: b.carrierId, tracking: b.tracking, replacementProductId: b.replacementProductId ?? null }, adminActor(request)), readsClientEmails(request));
  });

  app.post('/api/admin/warranty-claims/:id/cancel', async (request) => {
    const { id } = parse(warrantyClaimParams, request.params);
    const b = parse(warrantyClaimCancelBody, request.body);
    return claimSheetJson(await warrantyClaims.cancel(id, { note: b.note }, adminActor(request)), readsClientEmails(request));
  });
};
