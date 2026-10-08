/**
 * The orders in the console (plan LIVE RELEASE+ of 2026-10-04, The console → Orders, Clients): the fulfilment board
 * (services/fulfilment.ts), an order's page and its steps (services/orders.ts). It replaces the LIVE plan's Client
 * Services list. An order's piece is bound by the agent's packing scan (routes/admin/logistics.ts): Link a piece,
 * `POST /api/admin/orders/:id/piece`, is removed with the atelier (plan NEXT LOT step 5.13).
 *
 *   GET    /api/admin/orders                    AUDITOR   the board by step (?channel=&dropId=&locationId=&late=&q=)
 *   GET    /api/admin/orders.csv                AUDITOR   every order the same filters keep, as a CSV
 *   GET    /api/admin/orders/alerts             AUDITOR   the delays after which an order stands out (M3)
 *   PUT    /api/admin/orders/alerts             ADMIN     those delays, changed (the console's settings)
 *   GET    /api/admin/orders/shipping-rates     AUDITOR   SHIPPING (plan NEXT-NINE, BP-19 T2): the optional rates below the
 *                                                         free shipping of PLATINE and PALLADIUM, per currency and service
 *   PUT    /api/admin/orders/shipping-rates     ADMIN     those rates, set whole (services/club-program.ts)
 *   GET    /api/admin/orders/:id                AUDITOR   one order: its facts, timing, piece and history; its order cases
 *                                                         (their notes withheld from an AUDITOR) and, once shipped, the
 *                                                         sizes an exchange may take (plan NEXT LOT §3.5.4.4)
 *   POST   /api/admin/orders/:id/transition     OPERATOR  PAID; DELIVERED; CANCELLED (a note); SHIPPED never here since
 *                                                         the SHIPPED gate (plan NEXT LOT §3.5.6.7, step 5.12): 409
 *                                                         ORDER_NOT_PACKED, a parcel ships through its Ship
 *                                                         (routes/admin/logistics.ts), packed and checked
 *   POST   /api/admin/orders/:id/location       OPERATOR  served from another location (what it holds moves)
 *   PATCH  /api/admin/orders/:id/terms          OPERATOR  a draw's or a salon's size, price and currency; any engraving
 *   PUT    /api/admin/orders/:id/buyer          OPERATOR  the buyer's name and address (decision 31)
 *   POST   /api/admin/orders/:id/credit         OPERATOR  APPLY CREDIT (plan NEXT-NINE, BP-19 T5): a tier's credit taken off
 *                                                         a RESERVED order's invoice, within its balance and the price
 *   DELETE /api/admin/orders/:id/credit         OPERATOR  REMOVE CREDIT: what was taken off it, given back
 *   POST   /api/admin/orders/:id/case           OPERATOR  Open a return (plan NEXT LOT §3.5.4.4, step 5.10): a RETURN or a
 *                                                         size EXCHANGE opened by Client Services, with its reason and
 *                                                         note (201 the order case, services/order-cases.ts); ORBES
 *                                                         decides it in routes/admin/order-cases.ts (the old /return,
 *                                                         removed in step 5.11e)
 *
 * An AUDITOR reads the collectors' emails masked (`j***@example.com`) and the buyer's name and address masked
 * (`J*** D***`, the address withheld: serialize.ts), on the board, the order and the CSV; OPERATOR and ADMIN in clear.
 * A return decided from an order case: its note (ORBES's decision's) withheld from an AUDITOR on the order, as on the
 * case (order-cases.ts `orderCaseJson`); the `order.return` event of such a return keeps no words. Every mutation is
 * audited by its service.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  orderAlertsBody,
  orderBoardQuery,
  orderBuyerBody,
  orderLocationBody,
  orderParams,
  openOrderCaseBody,
  orderTermsBody,
  orderCreditBody,
  orderTransitionBody,
  parse,
  shippingRatesBody,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { OrderBoard, OrderBoardFilter, OrderDetail } from '../../services/fulfilment.js';
import type { OrderTransitionInput, OrderView } from '../../services/orders.js';
import type { AdminRouteDeps } from './index.js';
import { sizesForExchange } from '../../services/sizes.js';
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
  const { orders, fulfilment, clubProgram } = ctx.services;
  const detail = async (request: FastifyRequest, id: string) => {
    const inClear = readsClientEmails(request);
    const d = orderDetailJson(await fulfilment.detail(id), inClear);
    // Plan NEXT LOT §3.5.4.4: the order's cases (the Order case section, every note withheld from an AUDITOR), and once
    // it is shipped the sizes an exchange may take (§3.3's sizesForExchange: the others' availability at its location).
    const cases = await ctx.services.orderCases.forOrder(d.order.id);
    const orderCases = cases.map((c) => orderCaseJson(request, c)).reverse();
    const exchangeSizes = d.order.status === 'SHIPPED' || d.order.status === 'DELIVERED' ? await sizesForExchange(ctx.db, d.order.id) : [];
    // A return decided from an order case carries ORBES's decision's note: never read by an AUDITOR.
    if (!inClear && d.order.return && cases.some((c) => c.decision !== null && (c.kind === 'RETURN' || c.kind === 'EXCHANGE'))) {
      return { ...d, order: { ...d.order, return: { ...d.order.return, note: null } }, orderCases, exchangeSizes };
    }
    return { ...d, orderCases, exchangeSizes };
  };

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

  // Plan NEXT LOT §3.5.4.4 (step 5.10): Open a return, as an order case; ORBES decides it once the agent has the parcel.
  app.post('/api/admin/orders/:id/case', async (request, reply) => {
    const { id } = parse(orderParams, request.params);
    const b = parse(openOrderCaseBody, request.body);
    const c = await ctx.services.orderCases.open(id, { kind: b.kind, reason: b.reason, exchangeSkuId: b.exchangeSkuId ?? null, note: b.note }, adminActor(request));
    return reply.code(201).send(orderCaseJson(request, c));
  });
};
