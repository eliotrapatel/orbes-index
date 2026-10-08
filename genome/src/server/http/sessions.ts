/**
 * Cookie sessions, CSRF and the admin role guard (contract §2.9, §3).
 *
 * Every route in the account and admin scopes passes through `sessionGuard`,
 * so protection is the default and a route opts OUT explicitly through its
 * `config.guard` (login/register are the only session-less ones):
 *
 *   1. session  — the scope's cookie (`orbes_session` / `orbes_admin`, with the
 *                 `__Host-` prefix in production) must
 *                 resolve to a live session of an active subject (401);
 *   2. CSRF     — unsafe methods need `Origin == PUBLIC_ORIGIN` (or no Origin
 *                 and `Sec-Fetch-Site: same-origin`) and, with a session,
 *                 `x-csrf-token` equal to the session's token (403);
 *   3. password — an admin signed in with a temporary password (a staff
 *                 account created from the console) may only sign out, read
 *                 `me` and change the password (403 PASSWORD_CHANGE_REQUIRED);
 *   4. MFA      — optionally (production default), admin sessions must have
 *                 passed TOTP before using anything but the auth routes (403);
 *                 the own password change is exempt only while the admin has
 *                 no second factor (`mfaExempt: 'until-enrolled'`), so a
 *                 password-only session cannot replace the password of an
 *                 enrolled admin;
 *   5. role     — admin routes: AUDITOR reads, OPERATOR mutates, ADMIN for
 *                 keys/revocations/reinstatement/categories/console users (403).
 *                 RETAIL ranks under AUDITOR, so the default rule refuses it
 *                 everywhere: only the routes that declare `minRole: 'RETAIL'`
 *                 (the list of points of sale and the admin's own session,
 *                 password and second factor) or name it in `roles` (the sale
 *                 mode: RETAIL, OPERATOR and ADMIN, never the read-only
 *                 AUDITOR) let it through.
 *
 * The checks run in `onRequest`, before the body is even parsed, so
 * unauthenticated traffic costs as little as possible.
 */
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AdminRole, SessionSubjectType } from '../db/schema.js';
import { DomainError, unauthorized } from '../errors.js';
import type { AccountProfile, AdminProfile, ClientMeta } from '../services/auth.js';
import { checkCsrf, sessionCookieName, sessionCookieOptions, type IssuedSession, type SessionInfo } from '../services/sessions.js';
import type { Actor } from '../types.js';
import type { AppContext } from '../context.js';

// ── Request state ──────────────────────────────────────────────────────────

export interface AccountAuth {
  account: AccountProfile;
  session: SessionInfo;
  token: string;
}

export interface AdminAuth {
  admin: AdminProfile;
  session: SessionInfo;
  token: string;
}

/** Per-request state, set by the app's first onRequest hook. */
export interface RequestState {
  /** Peppered HMAC of the client IP. */
  ipHash: string;
  /** undefined = not looked up yet; null = no valid session. */
  account?: AccountAuth | null;
  admin?: AdminAuth | null;
}

/** Route-level guard options (`config: { guard: { … } }`). */
export interface RouteGuard {
  /** 'required' (default): no session → 401. 'optional': used when present. 'none': never read. */
  session?: 'required' | 'optional' | 'none';
  /** Admin routes: minimum role. Default AUDITOR for GET/HEAD, OPERATOR otherwise. */
  minRole?: AdminRole;
  /**
   * Admin routes: exactly these roles, in place of `minRole`. The sale mode (A-08) is RETAIL's and every role that
   * mutates (OPERATOR, ADMIN), but not the read-only AUDITOR, who ranks above RETAIL.
   */
  roles?: readonly AdminRole[];
  /**
   * Admin routes: reachable without a TOTP-verified session even when MFA is enforced (auth routes).
   * 'until-enrolled': only while the admin has no second factor (the own password change: the
   * temporary password is replaced before enrolment; once enrolled, the change needs the factor).
   */
  mfaExempt?: boolean | 'until-enrolled';
  /** Admin routes: reachable while the admin must still replace a temporary password (sign-out, me, the change itself). */
  passwordChangeExempt?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    orbes: RequestState;
  }
  interface FastifyContextConfig {
    guard?: RouteGuard;
  }
}

// ── Roles ──────────────────────────────────────────────────────────────────

/**
 * RETAIL (A-08) under AUDITOR, and LOGISTICS (plan NEXT LOT §3.5.6.1) with it: the default rule (AUDITOR reads, OPERATOR
 * writes) refuses both everywhere, and only the routes that name them let them in. A role unknown to this table ranks 0
 * and is refused everywhere.
 */
export const ROLE_RANK: Readonly<Record<AdminRole, number>> = Object.freeze({ RETAIL: 1, LOGISTICS: 1, AUDITOR: 2, OPERATOR: 3, ADMIN: 4 });

export function hasRole(role: AdminRole, min: AdminRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

// ── Errors ─────────────────────────────────────────────────────────────────

export const csrfFailed = (detail: string) =>
  new DomainError('CSRF_FAILED', 403, 'The request could not be verified. Reload the page and try again.', { detail });

const insufficientRole = (role: AdminRole, min: AdminRole) =>
  new DomainError('FORBIDDEN', 403, 'Your role does not allow this action.', { detail: `role ${role} < ${min}` });

const roleNotListed = (role: AdminRole, roles: readonly AdminRole[]) =>
  new DomainError('FORBIDDEN', 403, 'Your role does not allow this action.', { detail: `role ${role} not in ${roles.join(', ')}` });

const mfaRequired = () =>
  new DomainError('MFA_REQUIRED', 403, 'Two-factor authentication is required. Enable it and sign in again.');

const passwordChangeRequired = () =>
  new DomainError('PASSWORD_CHANGE_REQUIRED', 403, 'Choose a new password before using the console.');

// ── Cookies ────────────────────────────────────────────────────────────────

export function sessionToken(request: FastifyRequest, config: Pick<AppConfig, 'env'>, kind: SessionSubjectType): string | undefined {
  const v = request.cookies?.[sessionCookieName(config, kind)];
  return typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : undefined;
}

export function setSessionCookie(reply: FastifyReply, config: Pick<AppConfig, 'env'>, kind: SessionSubjectType, session: IssuedSession): void {
  reply.setCookie(sessionCookieName(config, kind), session.token, sessionCookieOptions(config, session.expiresAt));
}

export function clearSessionCookie(reply: FastifyReply, config: Pick<AppConfig, 'env'>, kind: SessionSubjectType): void {
  reply.clearCookie(sessionCookieName(config, kind), sessionCookieOptions(config));
}

// ── CSRF ───────────────────────────────────────────────────────────────────

/** Contract §3: Origin equals PUBLIC_ORIGIN, or is absent with `Sec-Fetch-Site: same-origin`. */
export function originAllowed(config: Pick<AppConfig, 'publicOrigin'>, request: Pick<FastifyRequest, 'headers'>): boolean {
  const origin = request.headers.origin;
  if (typeof origin === 'string') return origin === config.publicOrigin;
  return request.headers['sec-fetch-site'] === 'same-origin';
}

export function assertSameOrigin(config: Pick<AppConfig, 'publicOrigin'>, request: Pick<FastifyRequest, 'headers'>): void {
  if (!originAllowed(config, request)) throw csrfFailed('origin');
}

/** Origin check plus the session's CSRF token in `x-csrf-token`. */
export function assertCsrf(config: Pick<AppConfig, 'publicOrigin'>, request: Pick<FastifyRequest, 'headers'>, session: Pick<SessionInfo, 'csrfToken'>): void {
  assertSameOrigin(config, request);
  if (!checkCsrf(session, request.headers['x-csrf-token'])) throw csrfFailed('token');
}

// ── Session lookup ─────────────────────────────────────────────────────────

/** The caller's account session, looked up once per request (null when absent or invalid). */
export async function loadAccount(ctx: AppContext, request: FastifyRequest): Promise<AccountAuth | null> {
  if (request.orbes.account !== undefined) return request.orbes.account;
  const token = sessionToken(request, ctx.config, 'account');
  let auth: AccountAuth | null = null;
  if (token) {
    const r = await ctx.services.auth.authenticateAccount(token);
    if (r) auth = { ...r, token };
  }
  request.orbes.account = auth;
  return auth;
}

export async function loadAdmin(ctx: AppContext, request: FastifyRequest): Promise<AdminAuth | null> {
  if (request.orbes.admin !== undefined) return request.orbes.admin;
  const token = sessionToken(request, ctx.config, 'admin');
  let auth: AdminAuth | null = null;
  if (token) {
    const r = await ctx.services.auth.authenticateAdmin(token);
    if (r) auth = { ...r, token };
  }
  request.orbes.admin = auth;
  return auth;
}

/**
 * The console user behind a public request (S-07: a staff scan on /api/v1/verify): the caller's
 * admin session when the console itself would let it in — alive, of an enabled account with a role
 * this server knows, its password the member's own, past the second factor when the console
 * requires one — and null otherwise. The admin cookie is SameSite=Strict: a cross-site request
 * never carries it, so no other site can make a visitor's scan count as a staff scan.
 */
export async function loadStaff(ctx: AppContext, request: FastifyRequest, opts: { requireMfa: boolean }): Promise<AdminAuth | null> {
  const auth = await loadAdmin(ctx, request);
  if (!auth || auth.admin.passwordChangeRequired) return null;
  if (opts.requireMfa && !auth.session.mfaPassed) return null;
  return hasRole(auth.admin.role, 'RETAIL') ? auth : null;
}

/** The authenticated account (the guard already ran; throws 401 defensively otherwise). */
export function requireAccount(request: FastifyRequest): AccountAuth {
  const a = request.orbes.account;
  if (!a) throw unauthorized();
  return a;
}

export function requireAdmin(request: FastifyRequest): AdminAuth {
  const a = request.orbes.admin;
  if (!a) throw unauthorized();
  return a;
}

// ── Actors & client metadata ───────────────────────────────────────────────

export function accountActor(request: FastifyRequest): Actor {
  return { type: 'account', id: requireAccount(request).account.id, ipHash: request.orbes.ipHash };
}

export function adminActor(request: FastifyRequest): Actor {
  return { type: 'admin', id: requireAdmin(request).admin.id, ipHash: request.orbes.ipHash };
}

export function clientMeta(request: FastifyRequest, config: Pick<AppConfig, 'env'>, kind: SessionSubjectType, userAgent: string | null): ClientMeta {
  return { ipHash: request.orbes.ipHash, userAgent, previousToken: sessionToken(request, config, kind) ?? null };
}

// ── The guard ──────────────────────────────────────────────────────────────

export interface SessionGuardOptions {
  kind: SessionSubjectType;
  /** Admin scope: refuse sessions that did not pass TOTP (except `mfaExempt` routes). */
  requireMfa?: boolean;
}

/** onRequest hook enforcing the scope's session, CSRF, MFA and role rules (see file header). */
export function sessionGuard(ctx: AppContext, opts: SessionGuardOptions): onRequestAsyncHookHandler {
  const { config } = ctx;
  return async function guard(request, reply) {
    const g = request.routeOptions.config.guard ?? {};
    const mode = g.session ?? 'required';
    const unsafe = !isSafeMethod(request.method);

    if (mode === 'none') {
      // Login/registration: no session yet, but a cross-site form must still not reach them.
      if (unsafe) assertSameOrigin(config, request);
      return;
    }

    const auth = opts.kind === 'admin' ? await loadAdmin(ctx, request) : await loadAccount(ctx, request);
    if (!auth && sessionToken(request, config, opts.kind)) {
      // Expired or revoked: drop the dead cookie so the browser stops presenting it.
      clearSessionCookie(reply, config, opts.kind);
    }
    if (!auth) {
      if (mode === 'required') throw unauthorized();
      if (unsafe) assertSameOrigin(config, request);
      return;
    }
    if (unsafe) assertCsrf(config, request, auth.session);

    if (opts.kind === 'admin') {
      const { admin, session } = auth as AdminAuth;
      // First the temporary password, then the second factor: the TOTP routes are not open before the password is the admin's own.
      if (admin.passwordChangeRequired && !g.passwordChangeExempt) throw passwordChangeRequired();
      const mfaExempt = g.mfaExempt === true || (g.mfaExempt === 'until-enrolled' && !admin.totpEnabled);
      if (opts.requireMfa && !mfaExempt && !session.mfaPassed) throw mfaRequired();
      if (g.roles) {
        // A role unknown to ROLE_RANK is in no list either.
        if (!(admin.role in ROLE_RANK) || !g.roles.includes(admin.role)) throw roleNotListed(admin.role, g.roles);
        return;
      }
      const min = g.minRole ?? (unsafe ? 'OPERATOR' : 'AUDITOR');
      if (!hasRole(admin.role, min)) throw insufficientRole(admin.role, min);
    }
  };
}
