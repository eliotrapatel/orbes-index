/**
 * The orders in the console (plan LIVE RELEASE+ of 2026-10-04, The console → Orders, Clients): the fulfilment board
 * (services/fulfilment.ts), an order's page and its steps (services/orders.ts), a piece picked from the stock
 * (services/atelier.ts). It replaces the LIVE plan's Client Services list.
 *
 *   GET    /api/admin/orders                    AUDITOR   the board by step (?channel=&dropId=&locationId=&late=&q=)
 *   GET    /api/admin/orders.csv                AUDITOR   every order the same filters keep, as a CSV
 *   GET    /api/admin/orders/alerts             AUDITOR   the delays after which an order stands out (M3)
 *   PUT    /api/admin/orders/alerts             ADMIN     those delays, changed (the console's settings)
 *   GET    /api/admin/orders/shipping-rates     AUDITOR   SHIPPING (plan NEXT-NINE, BP-19 T2): the optional rates below the
 *                                                         free shipping of PLATINE and PALLADIUM, per currency and service
 *   PUT    /api/admin/orders/shipping-rates     ADMIN     those rates, set whole (services/club-program.ts)
 *   GET    /api/admin/orders/:id                AUDITOR   one order: its facts, timing, piece and history
 *   POST   /api/admin/orders/:id/transition     OPERATOR  PAID; SHIPPED (its piece linked; carrier, tracking number,
 *                                                         declared value); DELIVERED; CANCELLED (a note)
 *   POST   /api/admin/orders/:id/location       OPERATOR  served from another location (what it holds moves)
 *   PATCH  /api/admin/orders/:id/terms          OPERATOR  a draw's or a salon's size, price and currency; any engraving
 *   PUT    /api/admin/orders/:id/buyer          OPERATOR  the buyer's name and address (decision 31)
 *   POST   /api/admin/orders/:id/piece          OPERATOR  the piece that fulfils it, picked from the stock
 *   POST   /api/admin/orders/:id/credit         OPERATOR  APPLY CREDIT (plan NEXT-NINE, BP-19 T5): a tier's credit taken off
 *                                                         a RESERVED order's invoice, within its balance and the price
 *   DELETE /api/admin/orders/:id/credit         OPERATOR  REMOVE CREDIT: what was taken off it, given back
 *   POST   /api/admin/orders/:id/case           OPERATOR  Open a return (plan NEXT LOT §3.5.4.4, step 5.10): a RETURN or a
 *                                                         size EXCHANGE opened by Client Services, with its reason and
 *                                                         note (201 the order case, services/order-cases.ts); kept
 *                                                         beside /return until the console moves to it (step 5.11e)
 *   POST   /api/admin/orders/:id/return         OPERATOR  RETURNED (choice 20): back to stock at a location, with a
 *                                                         note; the claim code of the piece's new card when ORBES took
 *                                                         its buyer's ownership back (shown once, no-store)
 *                                               ADMIN     to the archive (its piece RETIRED: revocation-class, as on the
 *                                                         products' routes; 403 for an OPERATOR)
 *
 * An AUDITOR reads the collectors' emails masked (`j***@example.com`) and the buyer's name and address masked
 * (`J*** D***`, the address withheld: serialize.ts), on the board, the order and the CSV; OPERATOR and ADMIN in clear.
 * Every mutation is audited by its service.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { forbidden } from '../../errors.js';
import {
  orderAlertsBody,
  orderBoardQuery,
  orderBuyerBody,
  orderLocationBody,
  orderParams,
  openOrderCaseBody,
  orderPieceBody,
  orderReturnBody,
  orderTermsBody,
  orderCreditBody,
  orderTransitionBody,
  parse,
  shippingRatesBody,
} from '../../http/schemas.js';
import { adminActor, hasRole, requireAdmin } from '../../http/sessions.js';
import type { OrderBoard, OrderBoardFilter, OrderDetail } from '../../services/fulfilment.js';
import type { OrderTransitionInput, OrderView } from '../../services/orders.js';
import type { AdminRouteDeps } from './index.js';
import { orderCaseJson } from './order-cases.js';
import { clientEmail, orderBuyer, readsClientEmails } from './serialize.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

/** The board as the caller may read it. */
export function orderBoardJson(board: OrderBoard, inClear: boolean): OrderBoard {
  return {
    ...board,
    columns: board.columns.map((c) => ({ ...c, items: c.items.map((x) => ({ ...x, account: { ...x.account, email: clientEmail(x.account.email, inClear) } })) })),
  };
}

/** An order as the caller may read it. */
export function orderViewJson(o: OrderView, inClear: boolean): OrderView {
  return { ...o, buyer: orderBuyer(o.buyer, inClear) };
}

/** An order's page as the caller may read it. */
export function orderDetailJson(d: OrderDetail, inClear: boolean): OrderDetail {
  return { ...d, order: orderViewJson(d.order, inClear), account: { ...d.account, email: clientEmail(d.account.email, inClear) } };
}

function boardFilter(query: unknown): OrderBoardFilter {
  const q = parse(orderBoardQuery, query);
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as OrderBoardFilter;
}

export const adminOrderRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { orders, fulfilment, atelier, clubProgram } = ctx.services;
  const detail = async (request: FastifyRequest, id: string) => orderDetailJson(await fulfilment.detail(id), readsClientEmails(request));

  app.get('/api/admin/orders', async (request) => orderBoardJson(await fulfilment.board(boardFilter(request.query)), readsClientEmails(request)));

  app.get('/api/admin/orders.csv', async (request, reply) => {
    const filter = boardFilter(request.query);
    const inClear = readsClientEmails(request);
    const file = await fulfilment.csv(filter, { email: (e) => clientEmail(e, inClear), buyer: (b) => orderBuyer(b, inClear) });
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.get('/api/admin/orders/alerts', async () => fulfilment.delays());

  app.put('/api/admin/orders/alerts', { config: ADMIN }, async (request) => {
    const b = parse(orderAlertsBody, request.body);
    return fulfilment.setDelays(b, adminActor(request));
  });

  app.get('/api/admin/orders/shipping-rates', async () => clubProgram.shippingRates());

  app.put('/api/admin/orders/shipping-rates', { config: ADMIN }, async (request) => {
    const b = parse(shippingRatesBody, request.body);
    return clubProgram.setShippingRates(b.rates, adminActor(request));
  });

  app.get('/api/admin/orders/:id', async (request) => {
    const { id } = parse(orderParams, request.params);
    return detail(request, id);
  });

  app.post('/api/admin/orders/:id/transition', async (request) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(orderTransitionBody, request.body);
    await orders.transition(id, b as OrderTransitionInput, adminActor(request));
    return detail(request, id);
  });

  app.post('/api/admin/orders/:id/location', async (request) => {
    const { id } = parse(orderParams, request.params);
    const { locationId } = parse(orderLocationBody, request.body);
    await orders.changeLocation(id, locationId, adminActor(request));
    return detail(request, id);
  });

  app.patch('/api/admin/orders/:id/terms', async (request) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(orderTermsBody, request.body);
    await orders.setTerms(id, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), adminActor(request));
    return detail(request, id);
  });

  app.put('/api/admin/orders/:id/buyer', async (request) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(orderBuyerBody, request.body);
    await orders.setBuyer(id, { name: b.name, address: b.address }, adminActor(request));
    return detail(request, id);
  });

  app.post('/api/admin/orders/:id/piece', async (request) => {
    const { id } = parse(orderParams, request.params);
    const { productId } = parse(orderPieceBody, request.body);
    await atelier.linkFromStock(id, productId, adminActor(request));
    return detail(request, id);
  });

  app.post('/api/admin/orders/:id/credit', async (request) => {
    const { id } = parse(orderParams, request.params);
    const { amountMinor } = parse(orderCreditBody, request.body);
    await orders.applyCredit(id, amountMinor, adminActor(request));
    return detail(request, id);
  });

  app.delete('/api/admin/orders/:id/credit', async (request) => {
    const { id } = parse(orderParams, request.params);
    await orders.removeCredit(id, adminActor(request));
    return detail(request, id);
  });

  // The answer may carry a claim code (only its hash is kept): never stored by a cache.
  app.post('/api/admin/orders/:id/return', async (request, reply) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(orderReturnBody, request.body);
    const { admin } = requireAdmin(request);
    // The archive retires the piece: revocation-class, ADMIN's alone (routes/admin/products.ts ADMIN_ONLY_TARGETS).
    if (b.outcome === 'ARCHIVED' && !hasRole(admin.role, 'ADMIN')) throw forbidden('Only an ADMIN can archive a returned piece.');
    const r = await orders.returnOrder(id, { outcome: b.outcome, locationId: b.locationId ?? null, note: b.note }, adminActor(request));
    reply.header('cache-control', 'no-store');
    // `claimCode` here is the new card's code (a string), never the order page's block of plan NEXT LOT §3.4, left out.
    const { claimCode: _block, ...page } = await detail(request, id);
    return { ...page, productId: r.productId, ...(r.claimCode ? { claimCode: r.claimCode } : {}) };
  });

  // Plan NEXT LOT §3.5.4.4 (step 5.10): Open a return, as an order case; ORBES decides it once the agent has the parcel.
  app.post('/api/admin/orders/:id/case', async (request, reply) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(openOrderCaseBody, request.body);
    const c = await ctx.services.orderCases.open(id, { kind: b.kind, reason: b.reason, exchangeSkuId: b.exchangeSkuId ?? null, note: b.note }, adminActor(request));
    return reply.code(201).send(orderCaseJson(request, c));
  });
};
