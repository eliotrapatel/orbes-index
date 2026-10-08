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
 * Audited by SupplierService (`supplier.create`, `supplier.update` with the fields' names only, `model.supplier`). The
 * supplier orders themselves come with step 5.6.
 */
import type { FastifyPluginAsync } from 'fastify';
import { catalogParams, createSupplierBody, modelSupplierBody, parse, supplierParams, updateSupplierBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { SupplierView } from '../../services/suppliers.js';
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
  const { suppliers, sizes } = ctx.services;

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
};
