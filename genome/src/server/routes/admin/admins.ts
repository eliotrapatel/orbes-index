/**
 * Console users (ADMIN only): the Team page of the console (A-02).
 *
 * - list the console users with their role, second factor, lock, disable
 *   and temporary-password state;
 * - create a staff account (OPERATOR, AUDITOR, RETAIL, a seller limited to
 *   the sale mode, A-08, or LOGISTICS, a person at the logistics agent with
 *   the locations it works at, `stockLocationIds`, plan NEXT LOT §3.5.6.1) with
 *   a temporary password returned once and never audited; the first sign-in
 *   must replace it;
 * - change a role (OPERATOR, AUDITOR, RETAIL or LOGISTICS with its locations,
 *   which also changes a LOGISTICS login's locations: the ADMIN role, like
 *   ADMIN accounts, comes from the shell, where its second factor is enrolled
 *   out of band);
 * - disable (a departure: every session ends at once) and enable again;
 * - lift a sign-in lockout;
 * - list and end the sessions of an admin;
 * - reset a lost second factor (AuthService.disableTotp, the identity-checked
 *   recovery the security page points to: the enrolment goes, every session
 *   of that admin ends, audited as `admin.totp.disable`).
 *
 * Every change is audited by AuthService with the acting ADMIN as actor.
 * Acting on one's own account is refused (409 SELF_ACTION, except the TOTP
 * reset), and so is any change that would leave no active ADMIN (409
 * LAST_ADMIN).
 */
import type { FastifyPluginAsync } from 'fastify';
import { adminParams, adminRoleBody, createStaffBody, emptyBody, parse } from '../../http/schemas.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import type { AdminSessionSummary, AdminSummary } from '../../services/auth.js';
import type { AdminRouteDeps } from './index.js';
import { adminJson, itemsOf } from './serialize.js';

function adminSummaryJson(a: AdminSummary) {
  return { ...adminJson(a), locked: a.locked, disabled: a.disabled, createdAt: a.createdAt, stockLocationIds: a.stockLocationIds };
}

function adminSessionJson(s: AdminSessionSummary) {
  return { createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, mfaPassed: s.mfaPassed, userAgent: s.userAgent, current: s.current };
}

export const adminUserRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { auth } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  app.get('/api/admin/admins', { config: ADMIN }, async () => itemsOf((await auth.listAdmins()).map(adminSummaryJson)));

  app.post('/api/admin/admins', { config: ADMIN }, async (request, reply) => {
    const b = parse(createStaffBody, request.body);
    const { admin, temporaryPassword } = await auth.createStaff({ email: b.email, role: b.role, stockLocationIds: b.stockLocationIds }, adminActor(request));
    reply.code(201);
    return { admin: adminSummaryJson(admin), temporaryPassword };
  });

  app.patch('/api/admin/admins/:id/role', { config: ADMIN }, async (request) => {
    const { id } = parse(adminParams, request.params);
    const b = parse(adminRoleBody, request.body);
    return { admin: adminSummaryJson(await auth.setAdminRole(id, b.role, adminActor(request), { stockLocationIds: b.stockLocationIds })) };
  });

  for (const [path, disabled] of [
    ['disable', true],
    ['enable', false],
  ] as const) {
    app.post(`/api/admin/admins/:id/${path}`, { config: ADMIN }, async (request) => {
      const { id } = parse(adminParams, request.params);
      parse(emptyBody, request.body);
      const r = await auth.setAdminDisabled(id, disabled, adminActor(request));
      return { admin: adminSummaryJson(r.admin), sessionsRevoked: r.sessionsRevoked };
    });
  }

  app.post('/api/admin/admins/:id/unlock', { config: ADMIN }, async (request) => {
    const { id } = parse(adminParams, request.params);
    parse(emptyBody, request.body);
    return { admin: adminSummaryJson(await auth.unlockAdmin(id, adminActor(request))) };
  });

  app.get('/api/admin/admins/:id/sessions', { config: ADMIN }, async (request) => {
    const { id } = parse(adminParams, request.params);
    const sessions = await auth.listAdminSessions(id, { currentSessionId: requireAdmin(request).session.id });
    return itemsOf(sessions.map(adminSessionJson));
  });

  app.delete('/api/admin/admins/:id/sessions', { config: ADMIN }, async (request) => {
    const { id } = parse(adminParams, request.params);
    parse(emptyBody, request.body);
    return { sessionsRevoked: await auth.revokeAdminSessions(id, adminActor(request)) };
  });

  app.post('/api/admin/admins/:id/totp/reset', { config: ADMIN }, async (request) => {
    const { id } = parse(adminParams, request.params);
    parse(emptyBody, request.body);
    return { admin: adminJson(await auth.disableTotp(id, adminActor(request))) };
  });
};
