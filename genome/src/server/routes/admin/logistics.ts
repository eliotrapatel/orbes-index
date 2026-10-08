/**
 * Logistics (plan NEXT LOT of 2026-10-07, §3.5.6.9): the stock, the receptions, the orders to ship and the order cases of
 * the agent's locations (steps 5.7 to 5.10). Today's locations and carriers moved to routes/admin/locations.ts (step 5.6).
 *
 * The LOGISTICS role (plan NEXT LOT of 2026-10-07, §3.5.6.1): one login per person at the logistics agent, tied on Team
 * to the locations it works at (admin_user_locations). The Logistics routes name their roles: `LOGISTICS_ACT` (the agent
 * and the roles that mutate: receptions, packing, shipping, returns received) and `LOGISTICS_READ` (the agent and every
 * role from AUDITOR). `logisticsScope` gives a route the login's locations, a set, for LOGISTICS, and null (every
 * location) otherwise; a row of a location outside the scope answers 404, never 403, so other locations are not even
 * confirmed to exist.
 *
 * The receptions (step 5.7, services/receptions.ts; API §16.32):
 *
 *   GET    /api/admin/logistics/receptions                      LOGISTICS_READ  To confirm, Cards to print, Back to the
 *                                                                               supplier; Expected for ORBES staff only
 *   GET    /api/admin/logistics/receptions/supplier-order       LOGISTICS_ACT   ?reference=SO-…: the agent's one way in, the
 *                                                                               order's lines without a price (404 otherwise)
 *   GET    /api/admin/logistics/receptions/lines/:id            LOGISTICS_ACT   an open supplier order's lines, no price
 *   GET    /api/admin/logistics/receptions/:id                  LOGISTICS_READ  one reception
 *   POST   /api/admin/logistics/receptions                      LOGISTICS_ACT   a delivery counted (TO_CONFIRM)
 *   PUT    /api/admin/logistics/receptions/:id                  LOGISTICS_ACT   counted again, until confirmed
 *   POST   /api/admin/logistics/receptions/:id/send-back        OPERATOR        sent back with ORBES's note
 *   POST   /api/admin/logistics/receptions/:id/confirm          OPERATOR        confirmed: the identities are issued
 *   POST   /api/admin/logistics/receptions/:id/cards            LOGISTICS_ACT   a run of cards, PDF (no-store); the pieces
 *                                                                               skipped in `x-orbes-cards-skipped`
 *   POST   /api/admin/logistics/receptions/:id/cards-attached   LOGISTICS_ACT   every card is with its piece
 *   POST   /api/admin/logistics/supplier-returns/:id/sent       LOGISTICS_ACT   rejected pieces sent back to the supplier
 *
 * The stock (step 5.8, services/logistics.ts):
 *
 *   GET    /api/admin/logistics/stock                           LOGISTICS_READ  every size at each location (?locationId=
 *                                                                               &modelId=); expected, to order and the
 *                                                                               pieces without an identity for ORBES staff
 *   GET    /api/admin/logistics/corrections                     LOGISTICS_READ  the corrections (?status=), the newest first
 *   POST   /api/admin/logistics/corrections                     LOGISTICS_ACT   proposed by the agent; ORBES staff's applied
 *   POST   /api/admin/logistics/corrections/:id/approve         OPERATOR        the count moves
 *   POST   /api/admin/logistics/corrections/:id/decline         OPERATOR        with ORBES's note
 *   POST   /api/admin/logistics/transfers                       OPERATOR        pieces moved between locations
 *   PUT    /api/admin/logistics/minimums                        OPERATOR        a size's minimum at a location (204)
 *   POST   /api/admin/logistics/count-in                        OPERATOR        named pieces enter the stock with their identity
 *
 * Packing and shipping (step 5.9, services/logistics.ts and parcels.ts):
 *
 *   GET    /api/admin/logistics/orders                          LOGISTICS_READ  To ship and On its way (?locationId=)
 *   GET    /api/admin/logistics/orders/:id                      LOGISTICS_READ  one parcel (ShippingOrderView: no price,
 *                                                                               email, account nor release; its carriers)
 *   POST   /api/admin/logistics/orders/:id/packing              LOGISTICS_ACT   Start packing
 *   POST   /api/admin/logistics/orders/:id/packing/scan         LOGISTICS_ACT   a card's ORBES CODE scanned (rate group
 *                                                                               `verify`, as /api/v1/verify)
 *   PUT    /api/admin/logistics/orders/:id/packing/photo        LOGISTICS_ACT   the photo: registered in media.ts (its
 *                                                                               image parsers), rate group `media`
 *   POST   /api/admin/logistics/orders/:id/packing/check        LOGISTICS_ACT   Packed
 *   POST   /api/admin/logistics/orders/:id/ship                 LOGISTICS_ACT   Ship (declared values: ORBES staff only,
 *                                                                               403 from the agent)
 *   POST   /api/admin/logistics/orders/:id/delivered            LOGISTICS_ACT   Mark delivered
 *   GET    /api/admin/logistics/shipments/:id/photo             LOGISTICS_READ  the packing photo, no-store
 *
 * Order cases (step 5.10, services/order-cases.ts; ORBES decides in routes/admin/order-cases.ts):
 *
 *   POST   /api/admin/logistics/orders/:id/order-case           LOGISTICS_ACT   a parcel problem reported (BACK_TO_SENDER,
 *                                                                               LOST, DAMAGED) with a note (201)
 *   GET    /api/admin/logistics/order-cases                     LOGISTICS_READ  the parcels expected back (?locationId=)
 *   POST   /api/admin/logistics/order-cases/:id/received        LOGISTICS_ACT   the parcel back, the piece OK or DAMAGED
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context.js';
import type { AdminRole } from '../../db/schema.js';
import {
  correctionBody,
  correctionParams,
  correctionsQuery,
  countInBody,
  createReceptionBody,
  declineCorrectionBody,
  casesToReceiveQuery,
  logisticsStockQuery,
  orderCaseParams,
  receiveOrderCaseBody,
  reportParcelBody,
  orderParams,
  packingCheckBody,
  packingScanBody,
  parcelsQuery,
  shipmentParams,
  shipParcelBody,
  stockThresholdBody,
  stockTransferBody,
  emptyBody,
  parse,
  receptionCardsBody,
  receptionParams,
  receptionReferenceQuery,
  receptionsQuery,
  sendBackReceptionBody,
  supplierOrderParams,
  supplierReturnParams,
  supplierReturnSentBody,
  updateReceptionBody,
} from '../../http/schemas.js';
import { userAgentFamily, userAgentOf } from '../../http/client.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import type { ScanMeta } from '../../services/verification.js';
import { safeFilename } from './codes.js';
import type { AdminRouteDeps } from './index.js';

/** Who acts on the Logistics routes: the agent (its own locations), OPERATOR and ADMIN; never AUDITOR nor RETAIL. */
export const LOGISTICS_ACT: readonly AdminRole[] = Object.freeze(['LOGISTICS', 'OPERATOR', 'ADMIN'] as const);
/** Who reads the Logistics routes: the agent (its own locations) and every role from AUDITOR; never RETAIL. */
export const LOGISTICS_READ: readonly AdminRole[] = Object.freeze(['LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const);

/** The locations a request may see: a LOGISTICS login's own, or null for ORBES staff (every location). */
export type LogisticsScope = ReadonlySet<string> | null;

/** The request's location scope (plan NEXT LOT §3.5.6.1): the LOGISTICS login's locations, read at every request; null otherwise. */
export async function logisticsScope(ctx: AppContext, request: FastifyRequest): Promise<LogisticsScope> {
  const { admin } = requireAdmin(request);
  if (admin.role !== 'LOGISTICS') return null;
  return new Set(await ctx.services.auth.adminLocations(admin.id));
}

/** Whether a location is within a scope (null: every location). */
export function inLogisticsScope(scope: LogisticsScope, locationId: string): boolean {
  return scope === null || scope.has(locationId.toLowerCase());
}

const ACT = { guard: { roles: LOGISTICS_ACT } };
const READ = { guard: { roles: LOGISTICS_READ } };
const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };

export const adminLogisticsRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { receptions, logistics } = ctx.services;
  const scopeOf = (request: FastifyRequest) => logisticsScope(ctx, request);

  // ── The stock (step 5.8) ─────────────────────────────────────────────────
  app.get('/api/admin/logistics/stock', { config: READ }, async (request) => {
    const q = parse(logisticsStockQuery, request.query);
    return logistics.stock({ ...(q.locationId ? { locationId: q.locationId } : {}), ...(q.modelId ? { modelId: q.modelId } : {}) }, await scopeOf(request));
  });

  app.get('/api/admin/logistics/corrections', { config: READ }, async (request) => {
    const q = parse(correctionsQuery, request.query);
    return logistics.corrections(await scopeOf(request), q.status ? { status: q.status } : {});
  });

  app.post('/api/admin/logistics/corrections', { config: ACT }, async (request, reply) => {
    const b = parse(correctionBody, request.body);
    return reply.code(201).send(await logistics.proposeCorrection(b, adminActor(request), await scopeOf(request)));
  });

  app.post('/api/admin/logistics/corrections/:id/approve', { config: OPERATOR }, async (request) => {
    const { id } = parse(correctionParams, request.params);
    parse(emptyBody, request.body);
    return logistics.approveCorrection(id, adminActor(request));
  });

  app.post('/api/admin/logistics/corrections/:id/decline', { config: OPERATOR }, async (request) => {
    const { id } = parse(correctionParams, request.params);
    return logistics.declineCorrection(id, parse(declineCorrectionBody, request.body), adminActor(request));
  });

  app.post('/api/admin/logistics/transfers', { config: OPERATOR }, async (request) => {
    const b = parse(stockTransferBody, request.body);
    return logistics.transfer({ ...b, note: b.note ?? null }, adminActor(request));
  });

  app.put('/api/admin/logistics/minimums', { config: OPERATOR }, async (request, reply) => {
    await logistics.setMinimum(parse(stockThresholdBody, request.body), adminActor(request));
    return reply.code(204).send();
  });

  app.post('/api/admin/logistics/count-in', { config: OPERATOR }, async (request) => {
    const b = parse(countInBody, request.body);
    return logistics.countIn(b.skuId, { productRefs: b.productIds, note: b.note }, adminActor(request));
  });

  // ── The receptions (step 5.7) ────────────────────────────────────────────
  app.get('/api/admin/logistics/receptions', { config: READ }, async (request) => {
    const q = parse(receptionsQuery, request.query);
    return receptions.board(await scopeOf(request), q.locationId ? { locationId: q.locationId } : {});
  });

  app.get('/api/admin/logistics/receptions/supplier-order', { config: ACT }, async (request) => {
    const { reference } = parse(receptionReferenceQuery, request.query);
    return receptions.findForReception(reference, await scopeOf(request));
  });

  app.get('/api/admin/logistics/receptions/lines/:id', { config: ACT }, async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    return receptions.linesFor(id, await scopeOf(request));
  });

  app.get('/api/admin/logistics/receptions/:id', { config: READ }, async (request) => {
    const { id } = parse(receptionParams, request.params);
    return receptions.view(id, await scopeOf(request));
  });

  app.post('/api/admin/logistics/receptions', { config: ACT }, async (request, reply) => {
    const { supplierOrderId, ...input } = parse(createReceptionBody, request.body);
    const r = await receptions.record(supplierOrderId, input, adminActor(request), await scopeOf(request));
    return reply.code(201).send(r);
  });

  app.put('/api/admin/logistics/receptions/:id', { config: ACT }, async (request) => {
    const { id } = parse(receptionParams, request.params);
    return receptions.update(id, parse(updateReceptionBody, request.body), adminActor(request), await scopeOf(request));
  });

  app.post('/api/admin/logistics/receptions/:id/send-back', { config: OPERATOR }, async (request) => {
    const { id } = parse(receptionParams, request.params);
    return receptions.sendBack(id, parse(sendBackReceptionBody, request.body), adminActor(request));
  });

  app.post('/api/admin/logistics/receptions/:id/confirm', { config: OPERATOR }, async (request) => {
    const { id } = parse(receptionParams, request.params);
    parse(emptyBody, request.body);
    return receptions.confirm(id, adminActor(request));
  });

  app.post('/api/admin/logistics/receptions/:id/cards', { config: ACT }, async (request, reply) => {
    const { id } = parse(receptionParams, request.params);
    const b = parse(receptionCardsBody, request.body);
    const out = await receptions.printCards(id, { layout: b.layout, ...(b.run ? { run: b.run } : {}) }, adminActor(request), await scopeOf(request));
    const file = out.file;
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    reply.header('x-orbes-cards-printed', String(out.printed.length));
    if (out.skipped.length > 0) reply.header('x-orbes-cards-skipped', out.skipped.map((s) => `${s.productId}:${s.reason}`).join(','));
    const body = file.body;
    return reply.send(typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  });

  app.post('/api/admin/logistics/receptions/:id/cards-attached', { config: ACT }, async (request) => {
    const { id } = parse(receptionParams, request.params);
    parse(emptyBody, request.body);
    return receptions.cardsAttached(id, adminActor(request), await scopeOf(request));
  });

  app.post('/api/admin/logistics/supplier-returns/:id/sent', { config: ACT }, async (request) => {
    const { id } = parse(supplierReturnParams, request.params);
    const b = parse(supplierReturnSentBody, request.body);
    return receptions.supplierReturnSent(id, { carrierId: b.carrierId ?? null, trackingNumber: b.trackingNumber ?? null }, adminActor(request), await scopeOf(request));
  });

  // ── Packing and shipping (step 5.9) ──────────────────────────────────────
  app.get('/api/admin/logistics/orders', { config: READ }, async (request) => {
    const q = parse(parcelsQuery, request.query);
    return logistics.parcels(await scopeOf(request), q.locationId ? { locationId: q.locationId } : {});
  });

  app.get('/api/admin/logistics/orders/:id', { config: READ }, async (request) => {
    const { id } = parse(orderParams, request.params);
    return logistics.parcel(id, await scopeOf(request));
  });

  app.post('/api/admin/logistics/orders/:id/packing', { config: ACT }, async (request) => {
    const { id } = parse(orderParams, request.params);
    parse(emptyBody, request.body);
    return logistics.startPacking(id, adminActor(request), await scopeOf(request));
  });

  app.post('/api/admin/logistics/orders/:id/packing/scan', { config: { ...ACT, rateGroup: 'verify' } }, async (request) => {
    const { id } = parse(orderParams, request.params);
    const input = parse(packingScanBody, request.body);
    const meta: ScanMeta = { ipHash: request.orbes.ipHash, geo: ctx.geo.resolve(request) };
    const family = userAgentFamily(userAgentOf(request));
    if (family) meta.userAgentFamily = family;
    return logistics.scanCard(id, input, adminActor(request), meta, await scopeOf(request));
  });

  app.post('/api/admin/logistics/orders/:id/packing/check', { config: ACT }, async (request) => {
    const { id } = parse(orderParams, request.params);
    return logistics.checkPacked(id, parse(packingCheckBody, request.body), adminActor(request), await scopeOf(request));
  });

  app.post('/api/admin/logistics/orders/:id/ship', { config: ACT }, async (request) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(shipParcelBody, request.body);
    return logistics.ship(id, { carrierId: b.carrierId, trackingNumber: b.trackingNumber, ...(b.declaredValues ? { declaredValues: b.declaredValues } : {}) }, adminActor(request), await scopeOf(request));
  });

  app.post('/api/admin/logistics/orders/:id/delivered', { config: ACT }, async (request) => {
    const { id } = parse(orderParams, request.params);
    parse(emptyBody, request.body);
    return logistics.markDelivered(id, adminActor(request), await scopeOf(request));
  });

  app.get('/api/admin/logistics/shipments/:id/photo', { config: READ }, async (request, reply) => {
    const { id } = parse(shipmentParams, request.params);
    const photo = await logistics.photo(id, await scopeOf(request));
    reply.header('content-type', photo.mime);
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(Buffer.from(photo.bytes.buffer, photo.bytes.byteOffset, photo.bytes.byteLength));
  });

  // ── Order cases (step 5.10) ──────────────────────────────────────────────
  app.post('/api/admin/logistics/orders/:id/order-case', { config: ACT }, async (request, reply) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(reportParcelBody, request.body);
    const c = await ctx.services.orderCases.report(id, { kind: b.kind, note: b.note }, adminActor(request), await scopeOf(request));
    // The agent reads the case it opened, its words included; an AUDITOR never reports.
    return reply.code(201).send(c);
  });

  app.get('/api/admin/logistics/order-cases', { config: READ }, async (request) => {
    const q = parse(casesToReceiveQuery, request.query);
    const items = await ctx.services.orderCases.toReceive(await scopeOf(request), q.locationId ? { locationId: q.locationId } : {});
    return { items };
  });

  app.post('/api/admin/logistics/order-cases/:id/received', { config: ACT }, async (request) => {
    const { id } = parse(orderCaseParams, request.params);
    const b = parse(receiveOrderCaseBody, request.body);
    const c = await ctx.services.orderCases.receive(id, { pieceState: b.pieceState, note: b.note ?? null }, adminActor(request), await scopeOf(request));
    return { id: c.id, status: c.status, kind: c.kind, received: c.received };
  });
};
