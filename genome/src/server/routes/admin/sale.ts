/**
 * The sale mode (A-08, `/admin#/sale`): a seller scans the seal of the piece
 * being sold with a phone, sees the piece, picks the point of sale and
 * starts the warranty in one gesture. RETAIL and every higher role.
 *
 * - `POST /api/admin/sale/lookup` takes what the console's decoder read (the
 *   body of /api/v1/verify), records ONE ADMIN_TEST scan naming the console
 *   user without evaluating anomalies, and answers the piece, its warranty
 *   and, when it can be sold, a 10-minute sale token (SaleService);
 * - `POST /api/admin/sale/activate` uses the token up and starts the warranty
 *   today at the chosen point of sale.
 *
 * Both are ordinary admin mutations: session, CSRF, temporary password, MFA,
 * then the role (`minRole: 'RETAIL'`), in the `admin` rate group.
 */
import type { FastifyPluginAsync } from 'fastify';
import { userAgentFamily, userAgentOf } from '../../http/client.js';
import { parse, saleActivateBody, saleLookupBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { SaleLookup, SaleRefusal } from '../../services/sale.js';
import type { ScanMeta } from '../../services/verification.js';
import type { AdminRouteDeps } from './index.js';

const RETAIL = { guard: { minRole: 'RETAIL' as const } };

/** What the console says when a piece cannot be sold (the codes are listed in API §16.9). */
export const SALE_REFUSAL_MESSAGES: Readonly<Record<SaleRefusal, string>> = Object.freeze({
  NOT_AUTHENTIC: 'This code did not verify as a registered ORBES piece. Do not sell it; contact ORBES.',
  WARRANTY_ACTIVE: 'The warranty of this piece has already started: it has been sold before.',
  WARRANTY_VOID: 'The warranty of this piece has been voided. Contact ORBES before selling it.',
  NOT_FOR_SALE: 'The status of this piece does not allow a sale. Contact ORBES.',
});

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
    refusal: r.refusal ? { code: r.refusal, message: SALE_REFUSAL_MESSAGES[r.refusal] } : null,
  };
}

export const adminSaleRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { sale } = ctx.services;

  app.post('/api/admin/sale/lookup', { config: RETAIL }, async (request) => {
    const input = parse(saleLookupBody, request.body);
    const meta: ScanMeta = { ipHash: request.orbes.ipHash, geo: ctx.geo.resolve(request) };
    const family = userAgentFamily(userAgentOf(request));
    if (family) meta.userAgentFamily = family;
    return saleLookupJson(await sale.lookup(input, adminActor(request), meta));
  });

  app.post('/api/admin/sale/activate', { config: RETAIL }, async (request) => {
    const b = parse(saleActivateBody, request.body);
    const r = await sale.activate({ token: b.token, retailerId: b.retailerId }, adminActor(request));
    return { warranty: r.warranty, statusChange: r.statusChange, scanId: r.scanId };
  });
};
