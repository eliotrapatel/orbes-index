/**
 * Server-side sessions for accounts and admins (contract §2.9).
 *
 * - The client holds a 32-byte random token (base64url) in an httpOnly,
 *   SameSite=Strict cookie (`orbes_session` / `orbes_admin`; in production
 *   `__Host-orbes_session` / `__Host-orbes_admin`, Secure, Path=/, no Domain). The database stores only sha256(token): a leaked sessions
 *   table cannot be replayed as cookies.
 * - Every session has its own CSRF token, compared in constant time.
 * - Expiry is absolute (no sliding renewal): a stolen cookie dies with its
 *   session. Login always issues a NEW token and can retire the previous one
 *   (session fixation defence).
 * - `last_seen_at` is refreshed at most once per `touchIntervalMs` so that a
 *   busy session does not turn every read into a write.
 *
 * Authentication of the subject behind a session (account still active,
 * admin not disabled) is AuthService's job; this module only manages tokens.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { fromBase64Url, toBase64Url } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { inTransaction, type Db } from '../db/connection.js';
import { SESSION_SUBJECT_TYPES, type SessionRow, type SessionSubjectType } from '../db/schema.js';
import { validationError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';

/** Base cookie names; production prefixes them with `__Host-` (see sessionCookieName). */
export const SESSION_COOKIE: Readonly<Record<SessionSubjectType, string>> = Object.freeze({
  account: 'orbes_session',
  admin: 'orbes_admin',
});

/**
 * The cookie prefix browsers enforce for host-only cookies: Secure, Path=/,
 * no Domain. A sibling subdomain or a plain-HTTP response cannot set or
 * shadow such a cookie. Production only (it needs Secure, hence HTTPS).
 */
export const HOST_COOKIE_PREFIX = '__Host-';

/** `__Host-` + base name in production; the base name in development and test. */
export function cookieName(config: Pick<AppConfig, 'env'>, base: string): string {
  return config.env === 'production' ? `${HOST_COOKIE_PREFIX}${base}` : base;
}

export function sessionCookieName(config: Pick<AppConfig, 'env'>, kind: SessionSubjectType): string {
  return cookieName(config, SESSION_COOKIE[kind]);
}

export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 32;
const TOKEN_CHARS = Math.ceil((SESSION_TOKEN_BYTES * 4) / 3); // 43, unpadded base64url
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_USER_AGENT = 256;
const MAX_IP_HASH = 128;
const HOUR_MS = 3_600_000;

export interface SessionServiceDeps {
  db: Db;
  clock?: Clock;
  /** Absolute lifetime per subject type (AppConfig.sessionTtlHours). */
  ttlHours: { account: number; admin: number };
  /** Oldest sessions beyond this many per subject are revoked on create (default 20). */
  maxPerSubject?: number;
  /** Minimum interval between last_seen_at writes (default 60 s). */
  touchIntervalMs?: number;
}

export interface CreateSessionInput {
  subjectType: SessionSubjectType;
  subjectId: string;
  mfaPassed?: boolean;
  ipHash?: string | null;
  userAgent?: string | null;
  /** Token of the session being replaced (rotation on login); it is revoked atomically. */
  replaceToken?: string | null;
}

/** Returned once, at creation: the raw token exists nowhere else. */
export interface IssuedSession {
  token: string;
  csrfToken: string;
  subjectType: SessionSubjectType;
  subjectId: string;
  mfaPassed: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionInfo {
  /** hex sha256 of the token: safe to log or use as a key (never the token itself). */
  id: string;
  subjectType: SessionSubjectType;
  subjectId: string;
  csrfToken: string;
  mfaPassed: boolean;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

/** sha256 of the token bytes, or undefined when `token` is not a well-formed session token. */
export function hashSessionToken(token: unknown): Uint8Array | undefined {
  if (typeof token !== 'string' || token.length !== TOKEN_CHARS || !TOKEN_RE.test(token)) return undefined;
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(token);
  } catch {
    return undefined;
  }
  if (raw.length !== SESSION_TOKEN_BYTES) return undefined;
  return new Uint8Array(createHash('sha256').update(raw).digest());
}

/** Constant-time CSRF check: `presented` must equal the session's token exactly. */
export function checkCsrf(session: Pick<SessionInfo, 'csrfToken'>, presented: unknown): boolean {
  if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) return false;
  const a = Buffer.from(session.csrfToken, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cookie attributes for a session cookie (for @fastify/cookie's setCookie / clearCookie). */
export function sessionCookieOptions(
  config: Pick<AppConfig, 'env'>,
  expiresAt?: Date,
): { httpOnly: true; secure: boolean; sameSite: 'strict'; path: '/'; expires?: Date } {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict',
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export class SessionService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly ttlMs: Record<SessionSubjectType, number>;
  private readonly maxPerSubject: number;
  private readonly touchIntervalMs: number;

  constructor(deps: SessionServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
    for (const t of SESSION_SUBJECT_TYPES) {
      const h = deps.ttlHours[t];
      if (!Number.isFinite(h) || h <= 0) throw new RangeError(`session TTL for ${t} must be positive`);
    }
    this.ttlMs = { account: deps.ttlHours.account * HOUR_MS, admin: deps.ttlHours.admin * HOUR_MS };
    this.maxPerSubject = deps.maxPerSubject ?? 20;
    this.touchIntervalMs = deps.touchIntervalMs ?? 60_000;
    if (!Number.isInteger(this.maxPerSubject) || this.maxPerSubject < 1) throw new RangeError('maxPerSubject must be ≥ 1');
  }

  /** Issue a new session. Pass the caller's transaction to commit it with the login it belongs to. */
  async create(input: CreateSessionInput, trx?: Db): Promise<IssuedSession> {
    if (!SESSION_SUBJECT_TYPES.includes(input.subjectType)) throw validationError('Invalid session subject.');
    if (typeof input.subjectId !== 'string' || !UUID_RE.test(input.subjectId)) throw validationError('Invalid session subject.');
    const ipHash = clip(input.ipHash, MAX_IP_HASH);
    const userAgent = clip(input.userAgent, MAX_USER_AGENT);

    const token = toBase64Url(randomBytes(SESSION_TOKEN_BYTES));
    const csrfToken = toBase64Url(randomBytes(CSRF_TOKEN_BYTES));
    const idHash = hashSessionToken(token)!;
    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs[input.subjectType]);
    const mfaPassed = input.mfaPassed === true;

    await inTransaction(trx ?? this.db, async (tx) => {
      const old = hashSessionToken(input.replaceToken);
      if (old) await tx.deleteFrom('sessions').where('id_hash', '=', old).execute();
      await tx
        .insertInto('sessions')
        .values({
          id_hash: idHash,
          subject_type: input.subjectType,
          subject_id: input.subjectId,
          csrf_token: csrfToken,
          mfa_passed: mfaPassed,
          created_at: createdAt,
          expires_at: expiresAt,
          last_seen_at: createdAt,
          ip_hash: ipHash,
          user_agent: userAgent,
        })
        .execute();
      // Bound the sessions one subject can hold (credential-stuffing bots, forgotten devices).
      await sql`
        DELETE FROM sessions WHERE id_hash IN (
          SELECT id_hash FROM sessions
          WHERE subject_type = ${input.subjectType} AND subject_id = ${input.subjectId}
          ORDER BY created_at DESC, id_hash
          OFFSET ${this.maxPerSubject}
        )`.execute(tx);
    });

    return { token, csrfToken, subjectType: input.subjectType, subjectId: input.subjectId, mfaPassed, createdAt, expiresAt };
  }

  /**
   * Resolve a cookie token to its live session, or null when the token is
   * malformed, unknown, expired or of another subject type. Expired rows are
   * deleted on sight.
   */
  async validate(token: unknown, subjectType: SessionSubjectType): Promise<SessionInfo | null> {
    const idHash = hashSessionToken(token);
    if (!idHash) return null;
    const row = await this.db.selectFrom('sessions').selectAll().where('id_hash', '=', idHash).executeTakeFirst();
    if (!row || row.subject_type !== subjectType) return null;
    const now = this.clock();
    if (row.expires_at.getTime() <= now.getTime()) {
      await this.db.deleteFrom('sessions').where('id_hash', '=', idHash).execute();
      return null;
    }
    if (now.getTime() - row.last_seen_at.getTime() >= this.touchIntervalMs) {
      await this.db.updateTable('sessions').set({ last_seen_at: now }).where('id_hash', '=', idHash).execute();
      row.last_seen_at = now;
    }
    return toInfo(row);
  }

  /** Delete the session behind `token`. Returns whether one existed. */
  async revoke(token: unknown, trx?: Db): Promise<boolean> {
    const idHash = hashSessionToken(token);
    if (!idHash) return false;
    const r = await (trx ?? this.db).deleteFrom('sessions').where('id_hash', '=', idHash).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /** Delete every session of a subject (password change, lock, disable), optionally keeping one. */
  async revokeAllForSubject(
    subjectType: SessionSubjectType,
    subjectId: string,
    opts: { exceptToken?: string } = {},
    trx?: Db,
  ): Promise<number> {
    if (!UUID_RE.test(subjectId)) return 0;
    let q = (trx ?? this.db).deleteFrom('sessions').where('subject_type', '=', subjectType).where('subject_id', '=', subjectId);
    const keep = hashSessionToken(opts.exceptToken);
    if (keep) q = q.where('id_hash', '!=', keep);
    const r = await q.executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  /**
   * Replace a live session by a new token (privilege change, e.g. the admin
   * step-up to MFA after TOTP enrolment): same subject, client metadata and
   * absolute expiry, new token and CSRF token, `mfaPassed` as given. The old
   * token stops working in the same transaction, so a token captured before
   * the step-up never carries MFA. Null when `token` is not a live session of
   * `subjectType`.
   */
  async rotate(token: unknown, subjectType: SessionSubjectType, opts: { mfaPassed: boolean }, trx?: Db): Promise<IssuedSession | null> {
    const oldHash = hashSessionToken(token);
    if (!oldHash) return null;
    return inTransaction(trx ?? this.db, async (tx) => {
      const old = await tx.selectFrom('sessions').selectAll().where('id_hash', '=', oldHash).forUpdate().executeTakeFirst();
      const now = this.clock();
      if (!old || old.subject_type !== subjectType || old.expires_at.getTime() <= now.getTime()) return null;
      const next = toBase64Url(randomBytes(SESSION_TOKEN_BYTES));
      const csrfToken = toBase64Url(randomBytes(CSRF_TOKEN_BYTES));
      await tx.deleteFrom('sessions').where('id_hash', '=', oldHash).execute();
      await tx
        .insertInto('sessions')
        .values({
          id_hash: hashSessionToken(next)!,
          subject_type: old.subject_type,
          subject_id: old.subject_id,
          csrf_token: csrfToken,
          mfa_passed: opts.mfaPassed,
          created_at: now,
          expires_at: old.expires_at,
          last_seen_at: now,
          ip_hash: old.ip_hash,
          user_agent: old.user_agent,
        })
        .execute();
      return {
        token: next,
        csrfToken,
        subjectType: old.subject_type,
        subjectId: old.subject_id,
        mfaPassed: opts.mfaPassed,
        createdAt: now,
        expiresAt: old.expires_at,
      };
    });
  }

  /** Housekeeping: delete expired sessions. */
  async purgeExpired(): Promise<number> {
    const r = await this.db.deleteFrom('sessions').where('expires_at', '<=', this.clock()).executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  /** Live sessions of a subject, newest first (for "signed-in devices" views). */
  async listForSubject(subjectType: SessionSubjectType, subjectId: string): Promise<SessionInfo[]> {
    if (!UUID_RE.test(subjectId)) return [];
    const rows = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('subject_type', '=', subjectType)
      .where('subject_id', '=', subjectId)
      .where('expires_at', '>', this.clock())
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(toInfo);
  }
}

function toInfo(r: SessionRow): SessionInfo {
  return {
    id: Buffer.from(r.id_hash).toString('hex'),
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    csrfToken: r.csrf_token,
    mfaPassed: r.mfa_passed,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at,
  };
}

function clip(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null;
  // Strip control characters: these values end up in admin UIs and logs.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s === '' ? null : s.slice(0, max);
}
