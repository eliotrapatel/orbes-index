/**
 * The sale mode (A-08, `/admin#/sale`): a seller scans the seal of the piece
 * being sold with a phone, sees the piece, picks the point of sale and
 * starts the warranty in one gesture. RETAIL, OPERATOR and ADMIN: starting
 * a warranty is a mutation, so not the read-only AUDITOR, who ranks above
 * RETAIL (`roles` in the guard rather than `minRole`).
 *
 * - `POST /api/admin/sale/lookup` takes what the console's decoder read (the
 *   body of /api/v1/verify), records ONE ADMIN_TEST scan naming the console
 *   user outside the history rules (the code's own findings of steps 6–7 are
 *   recorded, marked staffScan), and answers the piece, its warranty and,
 *   when it can be sold, a 10-minute sale token (SaleService). It draws from
 *   the `verify` rate group, the budget of /api/v1/verify: the counter is not
 *   a faster way to judge codes than the public route;
 * - `POST /api/admin/sale/activate` uses the token up and starts the warranty
 *   today at the chosen point of sale (`admin` rate group).
 *
 * Both are ordinary admin mutations: session, CSRF, temporary password, MFA,
 * then the role (`roles: SALE_ROLES`).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { AdminRole } from '../../db/schema.js';
import { userAgentFamily, userAgentOf } from '../../http/client.js';
import { parse, saleActivateBody, saleLookupBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { SaleLookup, SaleRefusal } from '../../services/sale.js';
import type { ScanMeta } from '../../services/verification.js';
import type { AdminRouteDeps } from './index.js';

/** Who may sell (A-08): the seller, and every role that may mutate the registry. Never the read-only AUDITOR. */
export const SALE_ROLES: readonly AdminRole[] = Object.freeze(['RETAIL', 'OPERATOR', 'ADMIN'] as const);

const SELLERS = { guard: { roles: SALE_ROLES } };

/** What the console says when a piece cannot be sold (the codes are listed in API §16.18). */
export const SALE_REFUSAL_MESSAGES: Readonly<Record<SaleRefusal, string>> = Object.freeze({
  NOT_AUTHENTIC: 'This code did not verify as a registered ORBES piece. Do not sell it; contact ORBES.',
  WARRANTY_ACTIVE: 'The warranty of this piece has already started: it has been sold before.',
  WARRANTY_VOID: 'The warranty of this piece has been voided. Contact ORBES before selling it.',
  ALREADY_REGISTERED: 'This piece is registered to a client: it has been sold. Contact ORBES.',
  NOT_FOR_SALE: 'The status of this piece does not allow a sale. Contact ORBES.',
});

/**
 * NOT_AUTHENTIC for a piece the registry knows (reported lost or stolen, revoked, a superseded code,
 * a seal that does not match its code): the code is ORBES's, so "did not verify" would be untrue.
 */
export const SALE_REVIEW_MESSAGE = 'ORBES must review this piece before it can be sold. Do not sell it; contact ORBES.';

/** The sentence under a refusal: the code's, or the review sentence for a known piece that did not verify. */
export function saleRefusalMessage(refusal: SaleRefusal, pieceKnown: boolean): string {
  return refusal === 'NOT_AUTHENTIC' && pieceKnown ? SALE_REVIEW_MESSAGE : SALE_REFUSAL_MESSAGES[refusal];
}

export function saleLookupJson(r: SaleLookup) {
  const p = r.piece;
  return {
    scanId: r.scanId,
    state: r.state,
    piece: p
      ? {
          productId: p.productId,
          status: p.status,
          category: p.category,
          collection: p.collection,
          model: p.model,
          type: p.type,
          variant: p.variant,
          material: p.material,
          createdYear: p.createdYear,
          registered: p.registered,
          warranty: { status: p.warranty.status, startDate: p.warranty.startDate, endDate: p.warranty.endDate },
        }
      : null,
    sale: r.sale,
    refusal: r.refusal ? { code: r.refusal, message: saleRefusalMessage(r.refusal, p !== null) } : null,
  };
}

export const adminSaleRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { sale } = ctx.services;

  app.post('/api/admin/sale/lookup', { config: { ...SELLERS, rateGroup: 'verify' } }, async (request) => {
    const input = parse(saleLookupBody, request.body);
    const meta: ScanMeta = { ipHash: request.orbes.ipHash, geo: ctx.geo.resolve(request) };
    const family = userAgentFamily(userAgentOf(request));
    if (family) meta.userAgentFamily = family;
    return saleLookupJson(await sale.lookup(input, adminActor(request), meta));
  });

  app.post('/api/admin/sale/activate', { config: SELLERS }, async (request) => {
    const b = parse(saleActivateBody, request.body);
    const r = await sale.activate({ token: b.token, retailerId: b.retailerId }, adminActor(request));
    return { warranty: r.warranty, statusChange: r.statusChange, scanId: r.scanId };
  });
};
