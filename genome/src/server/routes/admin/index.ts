/**
 * Admin API (contract §3, cookie `orbes_admin`; roles ADMIN > OPERATOR > AUDITOR).
 *
 * One guard covers the whole scope (http/sessions.ts): an admin session is
 * required everywhere except login; reads need AUDITOR, mutations OPERATOR
 * unless a route asks for ADMIN (keys, revocations, reinstatement,
 * categories, console users); every mutation needs the CSRF token and a same-origin
 * request. Each mutation is audited by the service it calls (or by the route
 * for the few table writes without a service), with the admin's id and the
 * hashed client IP as the actor.
 */
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitHook } from '../../http/rate-limit.js';
import { sessionGuard } from '../../http/sessions.js';
import type { RouteDeps } from '../public.js';
import { adminUserRoutes } from './admins.js';
import { adminAuthRoutes } from './auth.js';
import { adminAuditRoutes } from './audit.js';
import { adminCatalogRoutes } from './catalog.js';
import { adminCertificateRoutes } from './certificates.js';
import { adminCodeRoutes } from './codes.js';
import { adminDashboardRoutes } from './dashboard.js';
import { adminKeyRoutes } from './keys.js';
import { adminProductRoutes } from './products.js';
import { adminRecordRoutes } from './records.js';
import { adminReportRoutes } from './reports.js';
import { adminRevocationRoutes } from './revocations.js';

export interface AdminRouteDeps extends RouteDeps {
  /** Admin sessions must have passed TOTP (except on the auth routes). */
  requireMfa: boolean;
}

export const adminRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, deps) => {
  app.addHook('onRequest', rateLimitHook(deps.limiters, 'admin'));
  app.addHook('onRequest', sessionGuard(deps.ctx, { kind: 'admin', requireMfa: deps.requireMfa }));

  await app.register(adminAuthRoutes, deps);
  await app.register(adminDashboardRoutes, deps);
  await app.register(adminCatalogRoutes, deps);
  await app.register(adminProductRoutes, deps);
  await app.register(adminCodeRoutes, deps);
  await app.register(adminCertificateRoutes, deps);
  await app.register(adminRecordRoutes, deps);
  await app.register(adminReportRoutes, deps);
  await app.register(adminRevocationRoutes, deps);
  await app.register(adminKeyRoutes, deps);
  await app.register(adminAuditRoutes, deps);
  await app.register(adminUserRoutes, deps);
};
