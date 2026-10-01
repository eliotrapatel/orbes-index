/**
 * Admin authentication (contract §3 + TOTP enrolment).
 *
 * Login is password, then TOTP when enrolled (401 TOTP_REQUIRED tells the UI
 * to ask for the code). Every route here is `mfaExempt` so that an admin
 * who has not enrolled yet can reach the enrolment routes when the server
 * enforces MFA; enrolling with a valid code replaces the current session by
 * a NEW, MFA-passed one (new token and CSRF token, same expiry: the admin has
 * just proven possession of the authenticator, and a token captured before
 * the step-up must not inherit it).
 *
 * The two enrolment routes are not in the contract table: without them TOTP
 * could only be enabled from a shell, and MFA could not be enforced.
 */
import type { FastifyPluginAsync } from 'fastify';
import { userAgentOf } from '../../http/client.js';
import { adminLoginBody, parse, totpEnableBody } from '../../http/schemas.js';
import { adminActor, clearSessionCookie, clientMeta, requireAdmin, sessionToken, setSessionCookie } from '../../http/sessions.js';
import { unauthorized } from '../../errors.js';
import type { AdminRouteDeps } from './index.js';
import { adminJson } from './serialize.js';

export const adminAuthRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx, requireMfa }) => {
  const { auth } = ctx.services;

  app.post(
    '/api/admin/auth/login',
    { config: { guard: { session: 'none', mfaExempt: true }, rateGroup: 'auth' } },
    async (request, reply) => {
      const b = parse(adminLoginBody, request.body);
      const { admin, session } = await auth.adminLogin(
        { email: b.email, password: b.password, totp: b.totp ?? null },
        clientMeta(request, 'admin', userAgentOf(request)),
      );
      setSessionCookie(reply, ctx.config, 'admin', session);
      return { admin: adminJson(admin), csrfToken: session.csrfToken, mfaPassed: session.mfaPassed, mfaRequired: requireMfa };
    },
  );

  app.post(
    '/api/admin/auth/logout',
    { config: { guard: { session: 'optional', mfaExempt: true, minRole: 'AUDITOR' } } },
    async (request, reply) => {
      const token = sessionToken(request, 'admin');
      if (token && request.orbes.admin) await auth.logout(token, 'admin', { ipHash: request.orbes.ipHash });
      clearSessionCookie(reply, ctx.config, 'admin');
      return { ok: true };
    },
  );

  app.get('/api/admin/auth/me', { config: { guard: { mfaExempt: true } } }, async (request) => {
    const { admin, session } = requireAdmin(request);
    return { admin: adminJson(admin), csrfToken: session.csrfToken, mfaPassed: session.mfaPassed, mfaRequired: requireMfa };
  });

  app.post(
    '/api/admin/auth/totp/setup',
    { config: { guard: { mfaExempt: true, minRole: 'AUDITOR' }, rateGroup: 'auth' } },
    async (request) => {
      const { admin } = requireAdmin(request);
      // Nothing is stored yet: the secret only becomes active once a code from it is confirmed.
      return auth.createTotpEnrollment(admin.id);
    },
  );

  app.post(
    '/api/admin/auth/totp/enable',
    { config: { guard: { mfaExempt: true, minRole: 'AUDITOR' }, rateGroup: 'auth' } },
    async (request, reply) => {
      const { admin, token } = requireAdmin(request);
      const b = parse(totpEnableBody, request.body);
      await auth.enableTotp(admin.id, { secret: b.secret.replace(/[\s=]/g, '').toUpperCase(), code: b.code.replace(/\s/g, '') }, adminActor(request));
      // Privilege change: the MFA-passed session gets a NEW token (and CSRF token); the old one dies.
      const session = await ctx.sessions.rotate(token, 'admin', { mfaPassed: true });
      if (!session) throw unauthorized();
      setSessionCookie(reply, ctx.config, 'admin', session);
      return { ok: true, mfaPassed: true, csrfToken: session.csrfToken };
    },
  );
};
