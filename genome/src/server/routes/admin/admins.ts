/**
 * Console users (ADMIN only): the list of admins with their role and second
 * factor, and the TOTP reset for a lost authenticator.
 *
 * The reset (AuthService.disableTotp) is the identity-checked recovery path
 * the security page points to: it removes the enrolment, ends every session
 * of that admin and is audited (`admin.totp.disable`, actor = the ADMIN who
 * reset it). The admin then signs in with the password and enrols again,
 * which the MFA guard allows on the auth routes only.
 */
import type { FastifyPluginAsync } from 'fastify';
import { adminParams, emptyBody, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminSummary } from '../../services/auth.js';
import type { AdminRouteDeps } from './index.js';
import { adminJson, itemsOf } from './serialize.js';

function adminSummaryJson(a: AdminSummary) {
  return { ...adminJson(a), locked: a.locked, disabled: a.disabled, createdAt: a.createdAt };
}

export const adminUserRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { auth } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  app.get('/api/admin/admins', { config: ADMIN }, async () => itemsOf((await auth.listAdmins()).map(adminSummaryJson)));

  app.post('/api/admin/admins/:id/totp/reset', { config: ADMIN }, async (request) => {
    const { id } = parse(adminParams, request.params);
    parse(emptyBody, request.body);
    return { admin: adminJson(await auth.disableTotp(id, adminActor(request))) };
  });
};
