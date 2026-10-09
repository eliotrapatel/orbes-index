/**
 * Admin API (contract §3, cookie `orbes_admin`; roles ADMIN > OPERATOR > AUDITOR > RETAIL).
 *
 * One guard covers the whole scope (http/sessions.ts): an admin session is
 * required everywhere except login; reads need AUDITOR, mutations OPERATOR
 * unless a route asks for ADMIN (keys, revocations, reinstatement,
 * categories, console users, a customer's recovery code, lock and export,
 * the draw of a drop, a model discontinued or reinstated, a LIVE RELEASE
 * ended now or an entry removed from it, the delays of the order alerts,
 * a location or a carrier added or changed, a conversation of the Messages board
 * assigned, the defaults of THE HOUSE'S GUARANTEE, the answers to « How did you hear about ORBES? »); every
 * mutation needs the CSRF token and a same-origin
 * request. Each mutation is audited by the service it calls (or by the route
 * for the few table writes without a service), with the admin's id and the
 * hashed client IP as the actor. Bodies are JSON (≤ 16 KB) except on the
 * photograph routes (media.ts: an image of at most 1 MiB, F-04; a photograph
 * of a model's lookbook gallery, P-R02; a photograph of a post of the circle,
 * P-X01; the silhouette of a LIVE RELEASE) and the prepaid label of a yearly
 * care (care.ts: a PDF of at most 2 MiB, BP-19 T6). RETAIL (A-08, a seller's account)
 * reaches only the routes that declare it: the sale mode, the list of points
 * of sale and its own session, password and second factor.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../../http/rate-limit.js';
import { sessionGuard } from '../../http/sessions.js';
import type { RouteDeps } from '../public.js';
import { adminUserRoutes } from './admins.js';
import { adminAnalyticsRoutes } from './analytics.js';
import { adminCareRoutes } from './care.js';
import { adminGuaranteeRoutes } from './guarantees.js';
import { adminDocumentRoutes } from './documents.js';
import { adminDropRoutes } from './drops.js';
import { adminAuthRoutes } from './auth.js';
import { adminAuditRoutes } from './audit.js';
import { adminCatalogRoutes } from './catalog.js';
import { adminCertificateRoutes } from './certificates.js';
import { adminCircleRoutes } from './circle.js';
import { adminClubRoutes } from './club.js';
import { adminCodeRoutes } from './codes.js';
import { adminDashboardRoutes } from './dashboard.js';
import { adminGrowthRoutes } from './growth.js';
import { adminInvoiceRoutes } from './invoices.js';
import { adminKeyRoutes } from './keys.js';
import { adminLinkRoutes } from './links.js';
import { adminLiveRoutes } from './live.js';
import { adminLocationRoutes } from './locations.js';
import { adminLogisticsRoutes } from './logistics.js';
import { adminMediaRoutes } from './media.js';
import { adminMessageRoutes } from './messages.js';
import { adminOrderCaseRoutes } from './order-cases.js';
import { adminOrderRoutes } from './orders.js';
import { adminOwnerRoutes } from './owners.js';
import { adminProductRoutes } from './products.js';
import { adminRecordRoutes } from './records.js';
import { adminReportRoutes } from './reports.js';
import { adminRetailerRoutes } from './retailers.js';
import { adminRevocationRoutes } from './revocations.js';
import { adminSaleRoutes } from './sale.js';
import { adminSegmentRoutes } from './segments.js';
import { adminShopifyRoutes } from './shopify.js';
import { adminSignUpRoutes } from './sign-up.js';
import { adminSupplierOrderRoutes } from './supplier-orders.js';
import { adminSystemRoutes } from './system.js';
import { adminTestEntrantRoutes } from './test-entrants.js';

export interface AdminRouteDeps extends RouteDeps {
  /** Admin sessions must have passed TOTP (except on the auth routes). */
  requireMfa: boolean;
}

export const adminRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, deps) => {
  app.addHook('onRequest', rateLimitHook(deps.limiters, 'admin'));
  app.addHook('onRequest', sessionGuard(deps.ctx, { kind: 'admin', requireMfa: deps.requireMfa }));

  await app.register(adminAuthRoutes, deps);
  await app.register(adminDashboardRoutes, deps);
  await app.register(adminSystemRoutes, deps);
  await app.register(adminAnalyticsRoutes, deps);
  await app.register(adminGrowthRoutes, deps);
  await app.register(adminDocumentRoutes, deps);
  await app.register(adminCatalogRoutes, deps);
  await app.register(adminProductRoutes, deps);
  await app.register(adminMediaRoutes, deps);
  await app.register(adminCodeRoutes, deps);
  await app.register(adminCertificateRoutes, deps);
  await app.register(adminRecordRoutes, deps);
  await app.register(adminOwnerRoutes, deps);
  await app.register(adminMessageRoutes, deps);
  await app.register(adminCareRoutes, deps);
  await app.register(adminGuaranteeRoutes, deps);
  await app.register(adminDropRoutes, deps);
  await app.register(adminLiveRoutes, deps);
  await app.register(adminTestEntrantRoutes, deps);
  await app.register(adminOrderRoutes, deps);
  await app.register(adminOrderCaseRoutes, deps);
  await app.register(adminInvoiceRoutes, deps);
  await app.register(adminLocationRoutes, deps);
  await app.register(adminLogisticsRoutes, deps);
  await app.register(adminSupplierOrderRoutes, deps);
  await app.register(adminSegmentRoutes, deps);
  await app.register(adminShopifyRoutes, deps);
  await app.register(adminCircleRoutes, deps);
  await app.register(adminClubRoutes, deps);
  await app.register(adminReportRoutes, deps);
  await app.register(adminRevocationRoutes, deps);
  await app.register(adminKeyRoutes, deps);
  await app.register(adminAuditRoutes, deps);
  await app.register(adminUserRoutes, deps);
  await app.register(adminRetailerRoutes, deps);
  await app.register(adminSaleRoutes, deps);
  await app.register(adminSignUpRoutes, deps);
  await app.register(adminLinkRoutes, deps);
};
