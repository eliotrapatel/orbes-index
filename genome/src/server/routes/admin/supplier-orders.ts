/**
 * Supplier orders and suppliers (plan NEXT LOT of 2026-10-07, §3.5.6.9; API §16.32): ORBES's own page, never a
 * LOGISTICS login's (« The agent has no supplier-orders page »). Reads AUDITOR, writes OPERATOR, by the default rule,
 * which refuses LOGISTICS (ranked with RETAIL) everywhere here.
 *
 *   GET    /api/admin/suppliers               AUDITOR   every supplier, by name, with how many models name it
 *   POST   /api/admin/suppliers               OPERATOR  a supplier added (409 SUPPLIER_NAME_TAKEN)
 *   PATCH  /api/admin/suppliers/:id           OPERATOR  its fields changed, or set inactive (404 SUPPLIER_NOT_FOUND)
 *   PUT    /api/admin/models/:id/supplier     OPERATOR  a model's supplier and its sizes' own; answers its Sizes section
 *
 * The supplier orders (step 5.6, services/supplier-orders.ts):
 *
 *   GET    /api/admin/supplier-orders                          AUDITOR   the list (?status=&supplierId=), the latest first
 *   GET    /api/admin/supplier-orders/proposal                 AUDITOR   « the console proposes » (?locationId=&supplierId=)
 *   POST   /api/admin/supplier-orders/draft-lines              OPERATOR  pieces of a size added to its supplier's draft
 *   GET    /api/admin/supplier-orders/:id                      AUDITOR   one order: lines, not on the order, receptions,
 *                                                                        returns, invoice, history
 *   PATCH  /api/admin/supplier-orders/:id                      OPERATOR  a draft's lines, currency, shipping, date, note
 *   DELETE /api/admin/supplier-orders/:id                      OPERATOR  a draft discarded (204)
 *   POST   /api/admin/supplier-orders/:id/send                 OPERATOR  DRAFT → SENT
 *   POST   /api/admin/supplier-orders/:id/supplier-confirmed   OPERATOR  SENT → EXPECTED
 *   POST   /api/admin/supplier-orders/:id/cancel-rest          OPERATOR  what has not come stops being expected
 *   GET    /api/admin/supplier-orders/:id/pdf                  AUDITOR   its PDF, ORBES-SO-….pdf (no-store)
 *   PUT    /api/admin/supplier-orders/:id/invoice              OPERATOR  the supplier's invoice
 *   POST   /api/admin/supplier-orders/:id/invoice/paid         OPERATOR  ORBES has paid it
 *   POST   /api/admin/supplier-returns/:id/settle              OPERATOR  the supplier's answer to rejected pieces
 *
 * Audited by SupplierService (`supplier.create`, `supplier.update` with the fields' names only, `model.supplier`) and
 * SupplierOrderService (`supplier_order.*`, `supplier_return.settle`). Every answer carries prices: never a LOGISTICS
 * login's (the default rule refuses it).
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  catalogParams,
  createSupplierBody,
  emptyBody,
  modelSupplierBody,
  parse,
  settleSupplierReturnBody,
  supplierCancelRestBody,
  supplierConfirmedBody,
  supplierDraftLineBody,
  supplierInvoiceBody,
  supplierOrderParams,
  supplierOrdersQuery,
  supplierParams,
  supplierProposalQuery,
  supplierReturnParams,
  updateSupplierBody,
  updateSupplierOrderBody,
} from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { SupplierView } from '../../services/suppliers.js';
import { safeFilename } from './codes.js';
import type { AdminRouteDeps } from './index.js';
import { itemsOf } from './serialize.js';

export function supplierJson(s: SupplierView) {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    email: s.email,
    phone: s.phone,
    address: s.address,
    currency: s.currency,
    note: s.note,
    active: s.active,
    models: s.models,
    createdAt: s.createdAt,
  };
}

export const adminSupplierOrderRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { suppliers, sizes, supplierOrders } = ctx.services;

  app.get('/api/admin/suppliers', async () => itemsOf((await suppliers.list()).map(supplierJson)));

  app.post('/api/admin/suppliers', async (request, reply) => {
    const b = parse(createSupplierBody, request.body);
    const created = await suppliers.create(b, adminActor(request));
    reply.code(201);
    return supplierJson(created);
  });

  app.patch('/api/admin/suppliers/:id', async (request) => {
    const { id } = parse(supplierParams, request.params);
    const b = parse(updateSupplierBody, request.body);
    return supplierJson(await suppliers.update(id, b, adminActor(request)));
  });

  app.put('/api/admin/models/:id/supplier', async (request) => {
    const { id } = parse(catalogParams, request.params);
    const b = parse(modelSupplierBody, request.body);
    await suppliers.setModelSupplier(
      id,
      { ...(b.supplierId !== undefined ? { supplierId: b.supplierId } : {}), ...(b.sizes !== undefined ? { sizes: b.sizes } : {}) },
      adminActor(request),
    );
    return sizes.modelSizes(id);
  });

  // ── The supplier orders ────────────────────────────────────────────────

  app.get('/api/admin/supplier-orders', async (request) => {
    const q = parse(supplierOrdersQuery, request.query);
    return itemsOf(await supplierOrders.list({ ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) }));
  });

  app.get('/api/admin/supplier-orders/proposal', async (request) => {
    const q = parse(supplierProposalQuery, request.query);
    return supplierOrders.proposal({ ...(q.locationId ? { locationId: q.locationId } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) });
  });

  app.post('/api/admin/supplier-orders/draft-lines', async (request) => {
    const b = parse(supplierDraftLineBody, request.body);
    return supplierOrders.addToDraft(b, adminActor(request));
  });

  app.get('/api/admin/supplier-orders/:id', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    return supplierOrders.get(id);
  });

  app.patch('/api/admin/supplier-orders/:id', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    const b = parse(updateSupplierOrderBody, request.body);
    return supplierOrders.updateDraft(id, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), adminActor(request));
  });

  app.delete('/api/admin/supplier-orders/:id', async (request, reply) => {
    const { id } = parse(supplierOrderParams, request.params);
    parse(emptyBody, request.body);
    await supplierOrders.discardDraft(id, adminActor(request));
    reply.code(204);
  });

  app.post('/api/admin/supplier-orders/:id/send', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    parse(emptyBody, request.body);
    return supplierOrders.send(id, adminActor(request));
  });

  app.post('/api/admin/supplier-orders/:id/supplier-confirmed', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    const b = parse(supplierConfirmedBody, request.body);
    return supplierOrders.supplierConfirmed(id, { expectedOn: b.expectedOn ?? null }, adminActor(request));
  });

  app.post('/api/admin/supplier-orders/:id/cancel-rest', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    const b = parse(supplierCancelRestBody, request.body);
    return supplierOrders.cancelRest(id, b, adminActor(request));
  });

  app.get('/api/admin/supplier-orders/:id/pdf', async (request, reply) => {
    const { id } = parse(supplierOrderParams, request.params);
    const file = await supplierOrders.pdf(id);
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(file.body));
  });

  app.put('/api/admin/supplier-orders/:id/invoice', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    const b = parse(supplierInvoiceBody, request.body);
    return supplierOrders.setInvoice(id, b, adminActor(request));
  });

  app.post('/api/admin/supplier-orders/:id/invoice/paid', async (request) => {
    const { id } = parse(supplierOrderParams, request.params);
    parse(emptyBody, request.body);
    return supplierOrders.markInvoicePaid(id, adminActor(request));
  });

  app.post('/api/admin/supplier-returns/:id/settle', async (request) => {
    const { id } = parse(supplierReturnParams, request.params);
    const b = parse(settleSupplierReturnBody, request.body);
    return supplierOrders.settleReturn(id, { settlement: b.settlement, ...(b.creditMinor !== undefined ? { creditMinor: b.creditMinor } : {}), ...(b.note !== undefined ? { note: b.note } : {}) }, adminActor(request));
  });
};
