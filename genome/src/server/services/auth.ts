/**
 * AuthService — customer accounts, admin users, TOTP and login sessions
 * (contract §2.9).
 *
 * Passwords: scrypt (N = 2^15, r = 8, p = 1, 16-byte salt, 32-byte key) via
 * ../crypto/scrypt.ts, encoded `scrypt$15$8$1$<salt>$<hash>`, compared in
 * constant time. Minimum 12 characters; NFKC-normalised before hashing so
 * the same password typed on different keyboards verifies (NIST SP 800-63B
 * §5.1.1.2). Unknown emails still pay for one scrypt evaluation, so response
 * time does not reveal which emails have accounts.
 *
 * Admins: password, then TOTP when enrolled (RFC 6238, SHA-1, 30 s, 6
 * digits, ±1 step). A code is accepted once: the last used time step is kept
 * inside the encrypted TOTP blob and advanced with a compare-and-swap.
 * 10 consecutive failures lock the admin for 15 minutes; while the counter
 * stays at or above the threshold, each further failure re-locks, so the
 * lockout does not reset into a fresh 10-guess budget.
 *
 * TOTP secrets are stored AES-256-GCM encrypted (secretbox) with the admin
 * id as AAD, under a key derived for this purpose only.
 *
 * The audit log is append-only and cannot be erased, so customer PII
 * (emails, names) never goes into it: entries name account ids only.
 *
 * Staff accounts (A-02): an ADMIN creates OPERATOR, AUDITOR and RETAIL (a
 * seller's sale mode, A-08) accounts from the console with a temporary
 * password shown once and never audited; the
 * account must choose its own password before anything else
 * (`password_change_required`, 403 PASSWORD_CHANGE_REQUIRED in the guard).
 * ADMIN accounts and the ADMIN role come from the shell only (scripts/admin.ts),
 * where the second factor is enrolled out of band (SECURITY-MODEL §3.3). Role
 * changes, (de)activation, unlocking and ending sessions are audited, refused
 * on one's own account (409 SELF_ACTION), and never leave the console without
 * an active ADMIN (409 LAST_ADMIN, serialised by an advisory lock).
 */
import { sql } from 'kysely';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { hashSecret, MAX_SECRET_BYTES, needsRehash, verifySecret } from '../crypto/scrypt.js';
import { deriveSubkey, openText, seal, SecretboxError } from '../crypto/secretbox.js';
import { base32Decode, base32Encode, generateTotpSecret, totpUri, verifyTotp } from '../crypto/totp.js';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { ADMIN_ROLES, STAFF_ROLES, type AccountRow, type AdminRole, type AdminUserRow, type SessionSubjectType, type StaffRole } from '../db/schema.js';
import { conflict, DomainError, isDomainError, notFound, unauthorized, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { randomCrockford } from './claim-codes.js';
import type { IssuedSession, SessionInfo, SessionService } from './sessions.js';

export const PASSWORD_MIN_LENGTH = 12;
export const ADMIN_LOCKOUT_THRESHOLD = 10;
export const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;
/**
 * Per-account login throttle for customers: after `maxFailures` wrong
 * passwords inside `windowMs` (counted from the first failure of the window),
 * further attempts on that account are refused WITHOUT checking the password,
 * with the same INVALID_CREDENTIALS answer as any wrong password (no lockout
 * oracle, no account enumeration). The window then expires on its own; a
 * successful login resets the counter. The per-IP `auth` rate limit still
 * applies on top.
 */
export const ACCOUNT_LOGIN_THROTTLE = Object.freeze({ maxFailures: 10, windowMs: 15 * 60 * 1000 });
/** Temporary passwords of staff accounts: 16 Crockford base32 characters (80 bits), shown once as XXXX-XXXX-XXXX-XXXX. */
export const TEMPORARY_PASSWORD_LENGTH = 16;
const TOTP_KEY_INFO = 'orbes/admin-totp/v1';
const MAX_EMAIL = 254;
const MAX_DISPLAY_NAME = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthServiceDeps {
  db: Db;
  audit: AuditService;
  sessions: SessionService;
  /** 32-byte key for TOTP secrets at rest; see deriveTotpEncryptionKey(). */
  totpKey: Uint8Array;
  clock?: Clock;
  /** Issuer shown in authenticator apps (default 'ORBES'). */
  totpIssuer?: string;
}

/** Request context for logins. `previousToken` is the session cookie being replaced (rotation). */
export interface ClientMeta {
  ipHash?: string | null;
  userAgent?: string | null;
  previousToken?: string | null;
}

export interface AccountProfile {
  id: string;
  email: string;
  displayName: string | null;
  country: string | null;
  status: AccountRow['status'];
  createdAt: Date;
}

export interface AdminProfile {
  id: string;
  email: string;
  role: AdminRole;
  totpEnabled: boolean;
  /** Signed in with a temporary password: only sign-out, `me` and the password change are open (403 PASSWORD_CHANGE_REQUIRED). */
  passwordChangeRequired: boolean;
  createdAt: Date;
}

export interface AdminSummary extends AdminProfile {
  /** Temporarily locked after repeated failed sign-ins. */
  locked: boolean;
  disabled: boolean;
}

/** A staff account just created from the console, with its temporary password (returned once, stored only as a hash). */
export interface StaffAccount {
  admin: AdminSummary;
  temporaryPassword: string;
}

/** One live console session of an admin, as the Team page shows it (never the token, its hash or the CSRF token). */
export interface AdminSessionSummary {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  mfaPassed: boolean;
  userAgent: string | null;
  /** The session making the request. */
  current: boolean;
}

export interface RegisterAccountInput {
  email: string;
  password: string;
  displayName?: string | null;
  country?: string | null;
}

export interface CreateAdminInput {
  email: string;
  password: string;
  role: AdminRole;
}

/** Decrypted TOTP state kept in admin_users.totp_secret_enc. */
interface TotpState {
  v: 1;
  /** base32 secret */
  s: string;
  /** last accepted time step (replay protection) */
  c: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Trimmed email plus its lookup key (lowercased), or undefined when not a plausible address. */
export function normalizeEmail(input: unknown): { email: string; normalized: string } | undefined {
  if (typeof input !== 'string') return undefined;
  const email = input.trim().normalize('NFC');
  if (email.length === 0 || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(email)) return undefined;
  return { email, normalized: email.toLowerCase() };
}

/** NFKC form used for hashing and verifying passwords. */
function normalizePassword(pw: string): string {
  return pw.normalize('NFKC');
}

/** Enforce the password policy; returns the normalised password. */
export function checkPasswordPolicy(password: unknown, email?: string): string {
  if (typeof password !== 'string') throw validationError('A password is required.');
  const pw = normalizePassword(password);
  if ([...pw].length < PASSWORD_MIN_LENGTH) throw validationError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (Buffer.byteLength(pw, 'utf8') > MAX_SECRET_BYTES) throw validationError('Password is too long.');
  if (pw.trim().length === 0 || new Set(pw).size < 3) throw validationError('Password is too simple.');
  if (email !== undefined && pw.toLowerCase() === email.toLowerCase()) throw validationError('Password must not be your email address.');
  return pw;
}

/**
 * Purpose-bound key for TOTP secrets: HKDF from the key-encryption key when
 * configured (local key provider), else from the cookie secret. Changing
 * that source makes enrolled TOTP secrets undecryptable (admins re-enrol).
 */
export function deriveTotpEncryptionKey(config: Pick<AppConfig, 'keys' | 'cookieSecret'>): Uint8Array {
  const ikm = config.keys.encryptionKey ? fromBase64Url(config.keys.encryptionKey) : utf8(config.cookieSecret);
  return deriveSubkey(ikm, TOTP_KEY_INFO, { salt: 'ORBES' });
}

const invalidCredentials = () => new DomainError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
/** A 400, not a 401: a 401 ends the session in both web apps, and the caller is signed in (API §5.2). */
const currentPasswordInvalid = () => new DomainError('CURRENT_PASSWORD_INVALID', 400, 'The current password is not correct.');

/** A temporary password for a new staff account: XXXX-XXXX-XXXX-XXXX in Crockford base32 (80 bits). */
export function generateTemporaryPassword(): string {
  for (;;) {
    const raw = randomCrockford(TEMPORARY_PASSWORD_LENGTH);
    // The password policy refuses fewer than three distinct characters (odds about 2^-70; retried, never weakened).
    if (new Set(raw).size >= 3) return raw.match(/.{4}/g)!.join('-');
  }
}

/**
 * Emails of the console users among `ids` (anything that is not an admin id is ignored), for the
 * read views that name who acted (audit log, anomaly triage). Read at display time: the audit log
 * itself keeps ids only.
 */
export async function adminEmailsById(db: Db, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)).map((v) => v.toLowerCase()))];
  if (wanted.length === 0) return new Map();
  const rows = await db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', wanted).execute();
  return new Map(rows.map((r) => [r.id, r.email]));
}

/**
 * The normalised password of a login attempt, or undefined when it cannot match any stored hash
 * (not a string, empty, or over the scrypt input limit). Such attempts are refused BEFORE the
 * account lookup and still pay one scrypt (burnTime): verifySecret refuses them instantly, so a
 * lookup-then-verify would answer known emails ~50x faster than unknown ones (enumeration oracle).
 */
function loginPassword(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const pw = normalizePassword(raw);
  const bytes = Buffer.byteLength(pw, 'utf8');
  return bytes > 0 && bytes <= MAX_SECRET_BYTES ? pw : undefined;
}

// ── Service ────────────────────────────────────────────────────────────────

export class AuthService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly sessions: SessionService;
  private readonly clock: Clock;
  private readonly totpKey: Uint8Array;
  private readonly totpIssuer: string;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: AuthServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.sessions = deps.sessions;
    this.clock = deps.clock ?? systemClock;
    if (!(deps.totpKey instanceof Uint8Array) || deps.totpKey.length !== 32) throw new RangeError('totpKey must be 32 bytes');
    this.totpKey = deps.totpKey;
    this.totpIssuer = deps.totpIssuer ?? 'ORBES';
  }

  // ── Accounts ─────────────────────────────────────────────────────────────

  /** Create a customer account and log it in. */
  async registerAccount(input: RegisterAccountInput, meta: ClientMeta = {}): Promise<{ account: AccountProfile; session: IssuedSession }> {
    const email = normalizeEmail(input?.email);
    if (!email) throw validationError('A valid email address is required.');
    const password = checkPasswordPolicy(input.password, email.email);
    const displayName = cleanDisplayName(input.displayName);
    const country = cleanCountry(input.country);
    const passwordHash = await hashSecret(password);
    const now = this.clock();
    try {
      return await inTransaction(this.db, async (tx) => {
        const row = await tx
          .insertInto('accounts')
          .values({
            email: email.email,
            email_normalized: email.normalized,
            password_hash: passwordHash,
            display_name: displayName,
            country,
            status: 'ACTIVE',
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        const session = await this.sessions.create(
          { subjectType: 'account', subjectId: row.id, ipHash: meta.ipHash, userAgent: meta.userAgent, replaceToken: meta.previousToken },
          tx,
        );
        await this.audit.record({ actor: accountActor(row.id, meta), action: 'account.register', targetType: 'account', targetId: row.id }, tx);
        return { account: accountProfile(row), session };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
      throw e;
    }
  }

  /** Customer login. Issues a new session (rotating `meta.previousToken` out). */
  async login(input: { email: string; password: string }, meta: ClientMeta = {}): Promise<{ account: AccountProfile; session: IssuedSession }> {
    const email = normalizeEmail(input?.email);
    const password = loginPassword(input?.password);
    const account = email && password ? await this.db.selectFrom('accounts').selectAll().where('email_normalized', '=', email.normalized).executeTakeFirst() : undefined;
    if (!account || password === undefined) {
      await this.burnTime(password);
      throw invalidCredentials();
    }
    if (this.accountThrottled(account)) {
      // Same cost and answer as a wrong password; the password is not even looked at.
      await this.burnTime(password);
      await this.audit.record({ actor: accountActor(account.id, meta), action: 'account.login_throttled', targetType: 'account', targetId: account.id });
      throw invalidCredentials();
    }
    if (!(await verifySecret(password, account.password_hash))) {
      await this.recordAccountFailure(account.id, meta);
      throw invalidCredentials();
    }
    if (account.status === 'LOCKED') throw new DomainError('ACCOUNT_LOCKED', 403, 'This account is locked. Please contact client services.');
    if (account.status !== 'ACTIVE') throw invalidCredentials();

    const rehash = needsRehash(account.password_hash) ? await hashSecret(password) : undefined;
    return inTransaction(this.db, async (tx) => {
      if (rehash) await tx.updateTable('accounts').set({ password_hash: rehash, updated_at: this.clock() }).where('id', '=', account.id).execute();
      if (account.failed_logins !== 0 || account.failed_logins_since !== null) {
        await tx.updateTable('accounts').set({ failed_logins: 0, failed_logins_since: null }).where('id', '=', account.id).execute();
      }
      const session = await this.sessions.create(
        { subjectType: 'account', subjectId: account.id, ipHash: meta.ipHash, userAgent: meta.userAgent, replaceToken: meta.previousToken },
        tx,
      );
      await this.audit.record({ actor: accountActor(account.id, meta), action: 'account.login', targetType: 'account', targetId: account.id }, tx);
      return { account: accountProfile(account), session };
    });
  }

  /** Resolve an `orbes_session` cookie to an active account, or null. */
  async authenticateAccount(token: unknown): Promise<{ account: AccountProfile; session: SessionInfo } | null> {
    const session = await this.sessions.validate(token, 'account');
    if (!session) return null;
    const account = await this.db.selectFrom('accounts').selectAll().where('id', '=', session.subjectId).executeTakeFirst();
    if (!account || account.status !== 'ACTIVE') {
      await this.sessions.revoke(token);
      return null;
    }
    return { account: accountProfile(account), session };
  }

  async getAccount(accountId: string): Promise<AccountProfile> {
    return accountProfile(await this.requireAccount(this.db, accountId));
  }

  // ── Admins ───────────────────────────────────────────────────────────────

  /** A console user with the given password (shell and first-run bootstrap; any role). */
  async createAdmin(input: CreateAdminInput, actor: Actor): Promise<AdminProfile> {
    return adminProfile(await this.insertAdmin(input, actor, false));
  }

  /**
   * A staff account created by an ADMIN from the console: OPERATOR, AUDITOR or RETAIL, with a temporary
   * password returned once (only its hash is stored; it is never audited or logged) that must be
   * replaced at the first sign-in. ADMIN accounts are created from the shell (createAdmin).
   */
  async createStaff(input: { email: string; role: StaffRole }, actor: Actor): Promise<StaffAccount> {
    if (!STAFF_ROLES.includes(input?.role)) throw validationError('The console creates OPERATOR, AUDITOR and RETAIL accounts; ADMIN accounts are created from the shell.');
    const temporaryPassword = generateTemporaryPassword();
    const row = await this.insertAdmin({ email: input.email, password: temporaryPassword, role: input.role }, actor, true);
    return { admin: adminSummary(row, this.clock()), temporaryPassword };
  }

  /**
   * Admin login: password, then TOTP when enrolled. Without a TOTP code for
   * an enrolled admin, a correct password answers 401 TOTP_REQUIRED (the UI
   * then asks for the code) and does not count as a failure.
   */
  async adminLogin(
    input: { email: string; password: string; totp?: string | null },
    meta: ClientMeta = {},
  ): Promise<{ admin: AdminProfile; session: IssuedSession }> {
    const email = normalizeEmail(input?.email);
    const password = loginPassword(input?.password);
    const admin = email && password ? await this.db.selectFrom('admin_users').selectAll().where('email_normalized', '=', email.normalized).executeTakeFirst() : undefined;
    if (!admin || password === undefined || admin.disabled_at !== null) {
      await this.burnTime(password);
      throw invalidCredentials();
    }
    const now = this.clock();
    // Locked: refuse before looking at the password, so guessing makes no progress.
    if (admin.locked_until !== null && admin.locked_until.getTime() > now.getTime()) throw accountLocked();
    if (!(await verifySecret(password, admin.password_hash))) {
      await this.recordAdminFailure(admin.id, 'password', meta);
      throw invalidCredentials();
    }

    let totpUpdate: { from: string; to: string } | undefined;
    if (admin.totp_secret_enc !== null) {
      const code = typeof input.totp === 'string' ? input.totp.trim() : '';
      if (code === '') throw new DomainError('TOTP_REQUIRED', 401, 'Enter the code from your authenticator app.');
      const state = this.openTotp(admin.id, admin.totp_secret_enc);
      const r = verifyTotp(base32Decode(state.s), code, now.getTime(), { afterCounter: state.c });
      if (!r.ok) {
        await this.recordAdminFailure(admin.id, 'totp', meta);
        throw invalidTotp();
      }
      totpUpdate = { from: admin.totp_secret_enc, to: this.sealTotp(admin.id, { v: 1, s: state.s, c: r.counter }) };
    }

    const rehash = needsRehash(admin.password_hash) ? await hashSecret(password) : undefined;
    return inTransaction(this.db, async (tx) => {
      // Re-check under the row lock: parallel wrong guesses may have locked (or an admin disabled)
      // the account while this attempt was hashing. Without this, a burst of guesses gets every
      // in-flight attempt evaluated and a correct one still logs in past the lockout.
      const fresh = await tx
        .selectFrom('admin_users')
        .select(['locked_until', 'disabled_at'])
        .where('id', '=', admin.id)
        .forUpdate()
        .executeTakeFirst();
      if (!fresh || fresh.disabled_at !== null) throw invalidCredentials();
      if (fresh.locked_until !== null && fresh.locked_until.getTime() > this.clock().getTime()) throw accountLocked();
      let q = tx
        .updateTable('admin_users')
        .set({
          failed_logins: 0,
          locked_until: null,
          updated_at: now,
          ...(totpUpdate ? { totp_secret_enc: totpUpdate.to } : {}),
          ...(rehash ? { password_hash: rehash } : {}),
        })
        .where('id', '=', admin.id);
      // Compare-and-swap: of two concurrent logins with the same code, only one advances the counter.
      if (totpUpdate) q = q.where('totp_secret_enc', '=', totpUpdate.from);
      const r = await q.executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) throw invalidTotp();
      const session = await this.sessions.create(
        { subjectType: 'admin', subjectId: admin.id, mfaPassed: totpUpdate !== undefined, ipHash: meta.ipHash, userAgent: meta.userAgent, replaceToken: meta.previousToken },
        tx,
      );
      await this.audit.record(
        { actor: adminActor(admin.id, meta), action: 'admin.login', targetType: 'admin', targetId: admin.id, details: { mfa: totpUpdate !== undefined } },
        tx,
      );
      return { admin: adminProfile({ ...admin, totp_secret_enc: totpUpdate?.to ?? admin.totp_secret_enc }), session };
    });
  }

  /** Resolve an `orbes_admin` cookie to an enabled admin, or null. */
  async authenticateAdmin(token: unknown): Promise<{ admin: AdminProfile; session: SessionInfo } | null> {
    const session = await this.sessions.validate(token, 'admin');
    if (!session) return null;
    const admin = await this.db.selectFrom('admin_users').selectAll().where('id', '=', session.subjectId).executeTakeFirst();
    if (!admin || admin.disabled_at !== null) {
      await this.sessions.revoke(token);
      return null;
    }
    return { admin: adminProfile(admin), session };
  }

  async getAdmin(adminId: string): Promise<AdminProfile> {
    return adminProfile(await this.requireAdmin(this.db, adminId));
  }

  /** Step 1 of TOTP enrolment: a fresh secret and its otpauth:// URI (nothing is stored yet). */
  async createTotpEnrollment(adminId: string): Promise<{ secret: string; otpauthUri: string }> {
    const admin = await this.requireAdmin(this.db, adminId);
    if (admin.totp_secret_enc !== null) throw conflict('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled.');
    const secret = generateTotpSecret();
    return { secret, otpauthUri: totpUri({ secret, account: admin.email, issuer: this.totpIssuer }) };
  }

  /**
   * Step 2: the admin proves the authenticator app holds `secret` by sending
   * a current code; only then is the secret stored (encrypted).
   */
  async enableTotp(adminId: string, input: { secret: string; code: string }, actor: Actor): Promise<void> {
    let secretBytes: Uint8Array;
    try {
      secretBytes = base32Decode(input?.secret);
    } catch {
      throw validationError('Invalid TOTP secret.');
    }
    if (secretBytes.length < 16 || secretBytes.length > 64) throw validationError('Invalid TOTP secret.');
    const r = verifyTotp(secretBytes, input.code, this.clock().getTime());
    if (!r.ok) throw new DomainError('TOTP_CODE_INVALID', 400, 'The code is not valid. Check the time on your device and try again.');

    await inTransaction(this.db, async (tx) => {
      const admin = await this.requireAdmin(tx, adminId);
      const sealed = this.sealTotp(admin.id, { v: 1, s: base32Encode(secretBytes), c: r.counter });
      const u = await tx
        .updateTable('admin_users')
        .set({ totp_secret_enc: sealed, updated_at: this.clock() })
        .where('id', '=', admin.id)
        .where('totp_secret_enc', 'is', null)
        .executeTakeFirst();
      if (Number(u.numUpdatedRows) !== 1) throw conflict('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled.');
      await this.audit.record({ actor, action: 'admin.totp.enable', targetType: 'admin', targetId: admin.id }, tx);
    });
  }

  /**
   * Remove an admin's TOTP enrolment (lost device, after identity checks; the
   * console's reset action, ADMIN only). Every session of that admin ends in
   * the same transaction: they were opened with the lost device. The admin
   * then signs in with the password and enrols a new authenticator.
   */
  async disableTotp(adminId: string, actor: Actor): Promise<AdminProfile> {
    return inTransaction(this.db, async (tx) => {
      const admin = await this.requireAdmin(tx, adminId);
      if (admin.totp_secret_enc === null) throw conflict('TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled.');
      const row = await tx
        .updateTable('admin_users')
        .set({ totp_secret_enc: null, updated_at: this.clock() })
        .where('id', '=', admin.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const sessionsRevoked = await this.sessions.revokeAllForSubject('admin', admin.id, {}, tx);
      await this.audit.record({ actor, action: 'admin.totp.disable', targetType: 'admin', targetId: admin.id, details: { sessionsRevoked } }, tx);
      return adminProfile(row);
    });
  }

  /** The admin with this email (case-insensitive), or undefined. For operator tooling (scripts/admin.ts). */
  async findAdminByEmail(email: string): Promise<AdminProfile | undefined> {
    const e = normalizeEmail(email);
    if (!e) return undefined;
    const row = await this.db.selectFrom('admin_users').selectAll().where('email_normalized', '=', e.normalized).executeTakeFirst();
    return row ? adminProfile(row) : undefined;
  }

  /** Console users, by email (ADMIN view: role, second factor, lock and disable state; never secrets). */
  async listAdmins(): Promise<AdminSummary[]> {
    const rows = await this.db.selectFrom('admin_users').selectAll().orderBy('email_normalized').execute();
    const now = this.clock();
    return rows.map((r) => adminSummary(r, now));
  }

  /**
   * Change a console user's role. Refused on one's own account (SELF_ACTION) and when it would
   * leave no active ADMIN (LAST_ADMIN). Takes effect at the next request: the guard reads the role
   * from the database every time. The console only offers STAFF_ROLES; ADMIN comes from the shell.
   */
  async setAdminRole(adminId: string, role: AdminRole, actor: Actor): Promise<AdminSummary> {
    if (!ADMIN_ROLES.includes(role)) throw validationError('Unknown admin role.');
    assertNotSelf(adminId, actor);
    return this.rosterChange(adminId, async (tx, row) => {
      if (row.role === role) return row;
      if (role !== 'ADMIN') await assertNotLastAdmin(tx, row);
      const next = await tx.updateTable('admin_users').set({ role, updated_at: this.clock() }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record({ actor, action: 'admin.role_change', targetType: 'admin', targetId: row.id, details: { from: row.role, to: role } }, tx);
      return next;
    });
  }

  /**
   * Disable (a departure) or re-enable a console user. Disabling sets `disabled_at` and ends every
   * session of that user in the same transaction; sign-in is then refused like a wrong password.
   * Idempotent (no audit entry when nothing changes); SELF_ACTION and LAST_ADMIN as for roles.
   */
  async setAdminDisabled(adminId: string, disabled: boolean, actor: Actor): Promise<{ admin: AdminSummary; sessionsRevoked: number }> {
    assertNotSelf(adminId, actor);
    let sessionsRevoked = 0;
    const admin = await this.rosterChange(adminId, async (tx, row) => {
      if ((row.disabled_at !== null) === disabled) return row;
      if (disabled) await assertNotLastAdmin(tx, row);
      const now = this.clock();
      const next = await tx
        .updateTable('admin_users')
        .set({ disabled_at: disabled ? now : null, updated_at: now })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (disabled) sessionsRevoked = await this.sessions.revokeAllForSubject('admin', row.id, {}, tx);
      await this.audit.record(
        { actor, action: disabled ? 'admin.disable' : 'admin.enable', targetType: 'admin', targetId: row.id, ...(disabled ? { details: { sessionsRevoked } } : {}) },
        tx,
      );
      return next;
    });
    return { admin, sessionsRevoked };
  }

  /** Lift a sign-in lockout (failed-login counter back to 0) before the 15 minutes run out. Idempotent. */
  async unlockAdmin(adminId: string, actor: Actor): Promise<AdminSummary> {
    assertNotSelf(adminId, actor);
    return inTransaction(this.db, async (tx) => {
      const row = await this.requireAdmin(tx, adminId, { forUpdate: true });
      if (row.failed_logins === 0 && row.locked_until === null) return adminSummary(row, this.clock());
      const next = await tx
        .updateTable('admin_users')
        .set({ failed_logins: 0, locked_until: null, updated_at: this.clock() })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const locked = row.locked_until !== null && row.locked_until.getTime() > this.clock().getTime();
      await this.audit.record({ actor, action: 'admin.unlock', targetType: 'admin', targetId: row.id, details: { failedLogins: row.failed_logins, locked } }, tx);
      return adminSummary(next, this.clock());
    });
  }

  /** The live console sessions of an admin, newest first; `currentSessionId` (SessionInfo.id) marks the caller's own. */
  async listAdminSessions(adminId: string, opts: { currentSessionId?: string } = {}): Promise<AdminSessionSummary[]> {
    const admin = await this.requireAdmin(this.db, adminId);
    return (await this.sessions.listForSubject('admin', admin.id)).map((s) => ({
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      mfaPassed: s.mfaPassed,
      userAgent: s.userAgent,
      current: s.id === opts.currentSessionId,
    }));
  }

  /** End every session of another admin (a lost laptop, a shared screen). Returns how many ended. */
  async revokeAdminSessions(adminId: string, actor: Actor): Promise<number> {
    assertNotSelf(adminId, actor);
    return inTransaction(this.db, async (tx) => {
      const admin = await this.requireAdmin(tx, adminId);
      const sessionsRevoked = await this.sessions.revokeAllForSubject('admin', admin.id, {}, tx);
      await this.audit.record({ actor, action: 'admin.sessions_revoke', targetType: 'admin', targetId: admin.id, details: { sessionsRevoked } }, tx);
      return sessionsRevoked;
    });
  }

  /** First start: create the configured ADMIN when no admin exists yet. Idempotent and race-safe. */
  async bootstrapAdmin(config: Pick<AppConfig, 'bootstrapAdmin'>): Promise<{ created: boolean; adminId?: string }> {
    if (!config.bootstrapAdmin) return { created: false };
    const existing = await this.db.selectFrom('admin_users').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    if (Number(existing.n) > 0) return { created: false };
    try {
      const admin = await this.createAdmin({ ...config.bootstrapAdmin, role: 'ADMIN' }, { type: 'system', id: 'bootstrap' });
      return { created: true, adminId: admin.id };
    } catch (e) {
      // Another instance bootstrapped the same admin concurrently.
      if (isDomainError(e) && e.code === 'EMAIL_TAKEN') return { created: false };
      throw e;
    }
  }

  // ── Both ─────────────────────────────────────────────────────────────────

  /** End the session behind `token` (no-op when unknown). */
  async logout(token: unknown, subjectType: SessionSubjectType, meta: ClientMeta = {}): Promise<void> {
    const session = await this.sessions.validate(token, subjectType);
    if (!(await this.sessions.revoke(token)) || !session) return;
    const actor = subjectType === 'admin' ? adminActor(session.subjectId, meta) : accountActor(session.subjectId, meta);
    await this.audit.record({ actor, action: `${subjectType}.logout`, targetType: subjectType, targetId: session.subjectId });
  }

  /**
   * Change a password after re-checking the current one. Every other session
   * of the subject is revoked; pass `keepToken` to keep the caller's.
   *
   * A wrong current password answers 400 CURRENT_PASSWORD_INVALID (a 401 would
   * end the caller's session in the web apps). For an admin it also counts as a
   * failed sign-in (the lockout of adminLogin), and a locked admin is refused
   * before the password is looked at and again under the row lock before the
   * new one is written, so a stolen session cookie cannot be used to guess the
   * password, not even with a burst of guesses in flight when the lockout
   * fires. An admin's change also clears
   * `password_change_required` (the temporary password of a staff account).
   */
  async changePassword(
    subject: { type: SessionSubjectType; id: string },
    input: { currentPassword: string; newPassword: string },
    actor: Actor,
    opts: { keepToken?: string } = {},
  ): Promise<void> {
    const admin = subject.type === 'admin' ? await this.requireAdmin(this.db, subject.id) : undefined;
    const row = admin ?? (await this.requireAccount(this.db, subject.id));
    if (admin?.locked_until && admin.locked_until.getTime() > this.clock().getTime()) throw accountLocked();
    const current = typeof input?.currentPassword === 'string' ? normalizePassword(input.currentPassword) : undefined;
    if (current === undefined || !(await verifySecret(current, row.password_hash))) {
      if (admin) await this.recordAdminFailure(admin.id, 'password', { ipHash: actor.ipHash ?? null });
      throw currentPasswordInvalid();
    }
    const next = checkPasswordPolicy(input.newPassword, row.email);
    if (next === current) throw validationError('Choose a new password, different from the current one.');
    const hash = await hashSecret(next);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      if (admin) {
        // Re-check under the row lock, as adminLogin does: a burst of guesses through a stolen session
        // may have locked the admin (or an ADMIN disabled it) while this attempt was hashing. Without
        // this, every guess in flight is evaluated and a correct one still changes the password.
        const fresh = await tx.selectFrom('admin_users').select(['locked_until', 'disabled_at']).where('id', '=', admin.id).forUpdate().executeTakeFirst();
        // Disabled: its sessions ended with it, so the answer the session guard gives (and the console signs out).
        if (!fresh || fresh.disabled_at !== null) throw unauthorized();
        if (fresh.locked_until !== null && fresh.locked_until.getTime() > now.getTime()) throw accountLocked();
        await tx
          .updateTable('admin_users')
          .set({ password_hash: hash, password_change_required: false, failed_logins: 0, locked_until: null, updated_at: now })
          .where('id', '=', admin.id)
          .execute();
      } else {
        await tx.updateTable('accounts').set({ password_hash: hash, updated_at: now }).where('id', '=', row.id).execute();
      }
      const sessionsRevoked = await this.sessions.revokeAllForSubject(subject.type, row.id, { exceptToken: opts.keepToken }, tx);
      await this.audit.record(
        {
          actor,
          action: `${subject.type}.password_change`,
          targetType: subject.type,
          targetId: row.id,
          details: { sessionsRevoked, ...(admin?.password_change_required ? { temporaryReplaced: true } : {}) },
        },
        tx,
      );
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One scrypt evaluation against a throwaway hash: equalises timing for unknown users. */
  private async burnTime(password: string | undefined): Promise<void> {
    this.dummyHash ??= hashSecret(`orbes-dummy-${Math.random()}`);
    const candidate = password && Buffer.byteLength(password, 'utf8') <= MAX_SECRET_BYTES ? password : 'x';
    await verifySecret(candidate, await this.dummyHash);
  }

  private accountThrottled(a: Pick<AccountRow, 'failed_logins' | 'failed_logins_since'>): boolean {
    if (a.failed_logins < ACCOUNT_LOGIN_THROTTLE.maxFailures || a.failed_logins_since === null) return false;
    return this.clock().getTime() - a.failed_logins_since.getTime() < ACCOUNT_LOGIN_THROTTLE.windowMs;
  }

  /** Count a wrong customer password in the current throttle window (a new window once the old one expired). */
  private async recordAccountFailure(accountId: string, meta: ClientMeta): Promise<void> {
    const now = this.clock();
    const windowStart = new Date(now.getTime() - ACCOUNT_LOGIN_THROTTLE.windowMs);
    await inTransaction(this.db, async (tx) => {
      const r = await tx
        .updateTable('accounts')
        .set({
          failed_logins: sql<number>`CASE WHEN failed_logins_since IS NULL OR failed_logins_since <= ${windowStart} THEN 1 ELSE failed_logins + 1 END`,
          failed_logins_since: sql<Date>`CASE WHEN failed_logins_since IS NULL OR failed_logins_since <= ${windowStart} THEN ${now}::timestamptz ELSE failed_logins_since END`,
        })
        .where('id', '=', accountId)
        .returning('failed_logins')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          actor: accountActor(accountId, meta),
          action: 'account.login_failed',
          targetType: 'account',
          targetId: accountId,
          details: { failedLogins: r.failed_logins, throttled: r.failed_logins >= ACCOUNT_LOGIN_THROTTLE.maxFailures },
        },
        tx,
      );
    });
  }

  /** Count a failed admin login (committed on its own) and lock at the threshold. */
  private async recordAdminFailure(adminId: string, reason: 'password' | 'totp', meta: ClientMeta): Promise<void> {
    const now = this.clock();
    await inTransaction(this.db, async (tx) => {
      const r = await tx
        .updateTable('admin_users')
        .set({ failed_logins: sql<number>`failed_logins + 1`, updated_at: now })
        .where('id', '=', adminId)
        .returning('failed_logins')
        .executeTakeFirstOrThrow();
      const locked = r.failed_logins >= ADMIN_LOCKOUT_THRESHOLD;
      if (locked) {
        await tx.updateTable('admin_users').set({ locked_until: new Date(now.getTime() + ADMIN_LOCKOUT_MS) }).where('id', '=', adminId).execute();
      }
      await this.audit.record(
        { actor: adminActor(adminId, meta), action: 'admin.login_failed', targetType: 'admin', targetId: adminId, details: { reason, failedLogins: r.failed_logins, locked } },
        tx,
      );
    });
  }

  private sealTotp(adminId: string, state: TotpState): string {
    return seal(this.totpKey, JSON.stringify(state), totpAad(adminId));
  }

  private openTotp(adminId: string, sealed: string): TotpState {
    try {
      const state = JSON.parse(openText(this.totpKey, sealed, totpAad(adminId))) as TotpState;
      if (state?.v !== 1 || typeof state.s !== 'string' || !Number.isSafeInteger(state.c)) throw new SecretboxError('bad TOTP state');
      return state;
    } catch (e) {
      // Wrong key (configuration changed) or tampered row: fail closed, never fall back to password-only.
      throw new DomainError('TOTP_UNAVAILABLE', 503, 'Two-factor authentication is temporarily unavailable.', {
        detail: e instanceof Error ? e.name : 'unknown',
      });
    }
  }

  private async requireAccount(db: Db, accountId: string): Promise<AccountRow> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const row = await db.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();
    if (!row) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    return row;
  }

  private async requireAdmin(db: Db, adminId: string, opts: { forUpdate?: boolean } = {}): Promise<AdminUserRow> {
    if (typeof adminId !== 'string' || !UUID_RE.test(adminId)) throw notFound('Admin', 'ADMIN_NOT_FOUND');
    let q = db.selectFrom('admin_users').selectAll().where('id', '=', adminId);
    if (opts.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) throw notFound('Admin', 'ADMIN_NOT_FOUND');
    return row;
  }

  private async insertAdmin(input: CreateAdminInput, actor: Actor, passwordChangeRequired: boolean): Promise<AdminUserRow> {
    const email = normalizeEmail(input?.email);
    if (!email) throw validationError('A valid email address is required.');
    if (!ADMIN_ROLES.includes(input.role)) throw validationError('Unknown admin role.');
    const password = checkPasswordPolicy(input.password, email.email);
    const passwordHash = await hashSecret(password);
    const now = this.clock();
    try {
      return await inTransaction(this.db, async (tx) => {
        const row = await tx
          .insertInto('admin_users')
          .values({
            email: email.email,
            email_normalized: email.normalized,
            password_hash: passwordHash,
            role: input.role,
            password_change_required: passwordChangeRequired,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        // Never the password, temporary or not: the audit log is permanent.
        await this.audit.record(
          { actor, action: 'admin.create', targetType: 'admin', targetId: row.id, details: { role: row.role, ...(passwordChangeRequired ? { passwordChangeRequired } : {}) } },
          tx,
        );
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('EMAIL_TAKEN', 'An admin with this email already exists.');
      throw e;
    }
  }

  /**
   * One change to the roster of console users (role, disabled state), serialised with every other
   * such change by an advisory lock so that the last-ADMIN check sees concurrent changes: two
   * ADMINs disabling each other at the same moment cannot leave the console without one.
   */
  private async rosterChange(adminId: string, fn: (tx: Db, row: AdminUserRow) => Promise<AdminUserRow>): Promise<AdminSummary> {
    return inTransaction(this.db, async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.ADMIN_ROSTER);
      const row = await this.requireAdmin(tx, adminId, { forUpdate: true });
      return adminSummary(await fn(tx, row), this.clock());
    });
  }
}

// ── Mapping & validation ───────────────────────────────────────────────────

const invalidTotp = () => new DomainError('INVALID_TOTP', 401, 'The authentication code is not valid.');
const accountLocked = () => new DomainError('ACCOUNT_LOCKED', 429, 'Too many failed attempts. Please try again later.');

/** An admin may not change their own role, disable, unlock or end the sessions of their own account. */
function assertNotSelf(adminId: string, actor: Actor): void {
  if (actor?.type === 'admin' && typeof adminId === 'string' && typeof actor.id === 'string' && actor.id.toLowerCase() === adminId.toLowerCase()) {
    throw conflict('SELF_ACTION', 'You cannot do this to your own account. Ask another ADMIN.');
  }
}

/** Refuse a change that would take `row` (an active ADMIN) out of the active ADMINs when it is the last one. Call under ADMIN_ROSTER. */
async function assertNotLastAdmin(tx: Db, row: AdminUserRow): Promise<void> {
  if (row.role !== 'ADMIN' || row.disabled_at !== null) return;
  const others = await tx
    .selectFrom('admin_users')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('role', '=', 'ADMIN')
    .where('disabled_at', 'is', null)
    .where('id', '!=', row.id)
    .executeTakeFirstOrThrow();
  if (Number(others.n) === 0) throw conflict('LAST_ADMIN', 'This is the last active ADMIN. Create another ADMIN from the shell first.');
}

function totpAad(adminId: string): string {
  return `${TOTP_KEY_INFO}|${adminId}`;
}

function accountActor(id: string, meta: ClientMeta): Actor {
  return meta.ipHash ? { type: 'account', id, ipHash: meta.ipHash } : { type: 'account', id };
}

function adminActor(id: string, meta: ClientMeta): Actor {
  return meta.ipHash ? { type: 'admin', id, ipHash: meta.ipHash } : { type: 'admin', id };
}

function accountProfile(r: AccountRow): AccountProfile {
  return { id: r.id, email: r.email, displayName: r.display_name, country: r.country?.trim() ?? null, status: r.status, createdAt: r.created_at };
}

function adminProfile(r: AdminUserRow): AdminProfile {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    totpEnabled: r.totp_secret_enc !== null,
    passwordChangeRequired: r.password_change_required,
    createdAt: r.created_at,
  };
}

function adminSummary(r: AdminUserRow, now: Date): AdminSummary {
  return { ...adminProfile(r), locked: r.locked_until !== null && r.locked_until.getTime() > now.getTime(), disabled: r.disabled_at !== null };
}

function cleanDisplayName(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw validationError('Display name must be text.');
  const s = v.trim().normalize('NFC');
  if (s === '') return null;
  if ([...s].length > MAX_DISPLAY_NAME) throw validationError('Display name is too long.');
  if (/[\u0000-\u001f\u007f<>]/.test(s)) throw validationError('Display name contains invalid characters.');
  return s;
}

function cleanCountry(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v.trim())) throw validationError('Country must be an ISO 3166-1 alpha-2 code.');
  return v.trim().toUpperCase();
}

