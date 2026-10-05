/**
 * Shopify readiness in the console (plan LIVE RELEASE+ of 2026-10-04, choices 9, 24 and 25: N2 and N3;
 * services/shopify.ts): files in Shopify's own import formats, and the ids its store gives back. Nothing calls Shopify.
 *
 *   GET  /api/admin/shopify/products.csv   AUDITOR   the product CSV of the models priced in a currency (?currency=)
 *   GET  /api/admin/models/:id/shopify     AUDITOR   a model's Shopify product: its handle, its sizes, their ids
 *   PUT  /api/admin/models/:id/shopify     OPERATOR  the product's and the variants' ids pasted back from Shopify
 *   GET  /api/admin/shopify/orders.csv     AUDITOR   the order CSV of a period (?from=YYYY-MM-DD&to=YYYY-MM-DD)
 *
 * The product CSV holds no personal data. The order CSV names the collectors by email and their buyers' details: an
 * AUDITOR reads them masked (`j***@example.com`, `J*** D***`, the address withheld: serialize.ts), OPERATOR and ADMIN
 * in clear. Files are attachments, never stored by a cache. The service audits the ids pasted back (`model.shopify`).
 */
import type { FastifyPluginAsync } from 'fastify';
import { catalogParams, parse, shopifyLinkBody, shopifyOrdersQuery, shopifyProductsQuery } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { safeFilename } from './codes.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, orderBuyer, readsClientEmails } from './serialize.js';

export const adminShopifyRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { shopify } = ctx.services;

  app.get('/api/admin/shopify/products.csv', async (request, reply) => {
    const { currency } = parse(shopifyProductsQuery, request.query);
    const file = await shopify.productCsv(currency);
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.get('/api/admin/models/:id/shopify', async (request) => {
    const { id } = parse(catalogParams, request.params);
    return shopify.product(id);
  });

  app.put('/api/admin/models/:id/shopify', async (request) => {
    const { id } = parse(catalogParams, request.params);
    const b = parse(shopifyLinkBody, request.body);
    return shopify.link(id, { productId: b.productId, variants: b.variants }, adminActor(request));
  });

  app.get('/api/admin/shopify/orders.csv', async (request, reply) => {
    const { from, to } = parse(shopifyOrdersQuery, request.query);
    const inClear = readsClientEmails(request);
    const file = await shopify.orderCsv({ from, to }, { email: (e) => clientEmail(e, inClear), buyer: (b) => orderBuyer(b, inClear) });
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    return reply.type(file.contentType).send(file.body);
  });
};
