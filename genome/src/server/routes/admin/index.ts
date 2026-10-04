/**
 * Admin API (contract §3, cookie `orbes_admin`; roles ADMIN > OPERATOR > AUDITOR > RETAIL).
 *
 * One guard covers the whole scope (http/sessions.ts): an admin session is
 * required everywhere except login; reads need AUDITOR, mutations OPERATOR
 * unless a route asks for ADMIN (keys, revocations, reinstatement,
 * categories, console users, a customer's recovery code, lock and export,
 * the draw of a drop); every mutation needs the CSRF token and a same-origin
 * request. Each mutation is audited by the service it calls (or by the route
 * for the few table writes without a service), with the admin's id and the
 * hashed client IP as the actor. Bodies are JSON (≤ 16 KB) except on the
 * photograph routes (media.ts: an image of at most 1 MiB, F-04; a photograph
 * of a model's lookbook gallery, P-R02; a photograph of a post of the circle,
 * P-X01). RETAIL (A-08, a seller's account)
 * reaches only the routes that declare it: the sale mode, the list of points
 * of sale and its own session, password and second factor.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../../http/rate-limit.js';
import { sessionGuard } from '../../http/sessions.js';
import type { RouteDeps } from '../public.js';
import { adminUserRoutes } from './admins.js';
import { adminAnalyticsRoutes } from './analytics.js';
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
import { adminKeyRoutes } from './keys.js';
import { adminMediaRoutes } from './media.js';
import { adminOwnerRoutes } from './owners.js';
import { adminProductRoutes } from './products.js';
import { adminRecordRoutes } from './records.js';
import { adminReportRoutes } from './reports.js';
import { adminRetailerRoutes } from './retailers.js';
import { adminRevocationRoutes } from './revocations.js';
import { adminSaleRoutes } from './sale.js';

export interface AdminRouteDeps extends RouteDeps {
  /** Admin sessions must have passed TOTP (except on the auth routes). */
  requireMfa: boolean;
}

export const adminRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, deps) => {
  app.addHook('onRequest', rateLimitHook(deps.limiters, 'admin'));
  app.addHook('onRequest', sessionGuard(deps.ctx, { kind: 'admin', requireMfa: deps.requireMfa }));

  await app.register(adminAuthRoutes, deps);
  await app.register(adminDashboardRoutes, deps);
  await app.register(adminAnalyticsRoutes, deps);
  await app.register(adminDocumentRoutes, deps);
  await app.register(adminCatalogRoutes, deps);
  await app.register(adminProductRoutes, deps);
  await app.register(adminMediaRoutes, deps);
  await app.register(adminCodeRoutes, deps);
  await app.register(adminCertificateRoutes, deps);
  await app.register(adminRecordRoutes, deps);
  await app.register(adminOwnerRoutes, deps);
  await app.register(adminDropRoutes, deps);
  await app.register(adminCircleRoutes, deps);
  await app.register(adminClubRoutes, deps);
  await app.register(adminReportRoutes, deps);
  await app.register(adminRevocationRoutes, deps);
  await app.register(adminKeyRoutes, deps);
  await app.register(adminAuditRoutes, deps);
  await app.register(adminUserRoutes, deps);
  await app.register(adminRetailerRoutes, deps);
  await app.register(adminSaleRoutes, deps);
};
