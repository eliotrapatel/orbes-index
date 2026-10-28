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
 * Staff accounts (A-02): an ADMIN creates OPERATOR, AUDITOR, RETAIL (a
 * seller's sale mode, A-08) and LOGISTICS (a person at the logistics agent,
 * tied to the locations it works at, admin_user_locations, plan NEXT LOT
 * §3.5.6.1) accounts from the console with a temporary
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
import { lockFoundingAddress, matchPreregistration } from './founding-match.js';
import { hashSessionToken, type IssuedSession, type SessionInfo, type SessionService } from './sessions.js';
import { insertSignUpProfile, signUpNames, type SignUpHeard } from './sign-up.js';
import { knownLocation } from './stock.js';
import { inviterOf } from './vault.js';

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
  /** A LOGISTICS login's locations (admin_user_locations, plan NEXT LOT §3.5.6.1), sorted; empty for every other role. */
  stockLocationIds: string[];
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
  /** Ignored when the first and last name are given: the account's name is then « First Last ». */
  displayName?: string | null;
  country?: string | null;
  /** The sign-up's profile (services/sign-up.ts): required by the public route only, optional here for seeds and tests. */
  firstName?: string | null;
  lastName?: string | null;
  heard?: SignUpHeard | null;
  /**
   * A friend's personal invitation code (THE VAULT's A FRIEND, N10: `/verify/join/<code>`, kept on the device for the
   * sign-up): a known code sets `accounts.invited_by` once; an unknown or malformed one is ignored, never a refusal.
   */
  invite?: string | null;
}

export interface CreateAdminInput {
  email: string;
  password: string;
  role: AdminRole;
  /** A LOGISTICS login's locations: at least one, each a known location; none for any other role. */
  stockLocationIds?: readonly string[];
}

/** Plan NEXT LOT §3.5.6.1: a LOGISTICS login works at one location or more, chosen on Team. */
export const LOGISTICS_LOCATIONS_REQUIRED = 'Choose at least one location.';
/** At most this many locations per login (a guard on the request, far above any real network of warehouses). */
export const MAX_LOGIN_LOCATIONS = 50;

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
 * A customer account LOCKED by ORBES Client Services (A-06, POST /api/admin/owners/:id/lock): refused after a
 * correct password (login, also when the lock took effect during the password check) or recovery code (§10.8),
 * and by a transfer begun before the lock took effect.
 */
export const customerAccountLocked = () => new DomainError('ACCOUNT_LOCKED', 403, 'This account is locked. ORBES Client Services can assist you.');

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
    const names = signUpNames(input);
    const displayName = names ? `${names.first} ${names.last}` : cleanDisplayName(input.displayName);
    const country = cleanCountry(input.country);
    const passwordHash = await hashSecret(password);
    const now = this.clock();
    try {
      return await inTransaction(this.db, async (tx) => {
        // The founding list's registration of the same address at the same instant waits, or is waited for (F3).
        await lockFoundingAddress(tx, email.normalized);
        // A friend's invitation (N10): its inviter, set once with the account (never the account itself: it is new).
        const invitedBy = input.invite ? await inviterOf(tx, input.invite) : null;
        const row = await tx
          .insertInto('accounts')
          .values({
            email: email.email,
            email_normalized: email.normalized,
            password_hash: passwordHash,
            display_name: displayName,
            country,
            status: 'ACTIVE',
            invited_by: invitedBy,
            invited_at: invitedBy ? now : null,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        const session = await this.sessions.create(
          { subjectType: 'account', subjectId: row.id, ipHash: meta.ipHash, userAgent: meta.userAgent, replaceToken: meta.previousToken },
          tx,
        );
        const profile = names ? await insertSignUpProfile(tx, row.id, names, input.heard, now) : null;
        const details = { ...(profile ? { profile: true, heardOptionId: profile.heardOptionId } : {}), ...(invitedBy ? { invitedBy } : {}) };
        await this.audit.record({ actor: accountActor(row.id, meta), action: 'account.register', targetType: 'account', targetId: row.id, ...(Object.keys(details).length ? { details } : {}) }, tx);
        // The founding list (plan MACRO M1 §3.1, F3): the address's pre-registration takes the account, in its transaction.
        await matchPreregistration(tx, this.audit, { accountId: row.id, emailNormalized: email.normalized, now, at: 'SIGN_UP' }, accountActor(row.id, meta));
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
    if (account.status === 'LOCKED') throw customerAccountLocked();
    if (account.status !== 'ACTIVE') throw invalidCredentials();

    const rehash = needsRehash(account.password_hash) ? await hashSecret(password) : undefined;
    return inTransaction(this.db, async (tx) => {
      // Read again under the row lock. A lock by Client Services (A-06) or an assisted recovery (C-04) that committed
      // during the scrypt check above has already ended the account's sessions: the session opened here would outlive
      // it (and, after a lock, work again after the unlock). A recovery also replaced the password that was checked,
      // so the old one must not open a session, nor be written back by a rehash.
      // FOR NO KEY UPDATE: a lock, a recovery or a password change still in progress is waited for, and one that starts
      // now waits for this session, then ends it. An exclusive lock, not FOR SHARE: this transaction may then write the
      // row (the throttle reset, a rehash), and two logins that both held a share lock and both wrote would deadlock;
      // concurrent logins of one account run one after the other instead. Foreign-key checks (FOR KEY SHARE) still pass.
      const fresh = await tx.selectFrom('accounts').select(['status', 'password_hash']).where('id', '=', account.id).forNoKeyUpdate().executeTakeFirst();
      if (fresh?.status === 'LOCKED') throw customerAccountLocked();
      if (fresh?.status !== 'ACTIVE') throw invalidCredentials();
      const unchanged = fresh.password_hash === account.password_hash;
      // Changed meanwhile: by a recovery or a password change (then the password checked above no longer opens a
      // session), or by a concurrent login's rehash of this same password (rare: checked again, under the lock).
      if (!unchanged && !(await verifySecret(password, fresh.password_hash))) throw invalidCredentials();
      if (rehash && unchanged) await tx.updateTable('accounts').set({ password_hash: rehash, updated_at: this.clock() }).where('id', '=', account.id).execute();
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

  /** A console user with the given password (shell and first-run bootstrap; any role, a LOGISTICS one with its locations). */
  async createAdmin(input: CreateAdminInput, actor: Actor): Promise<AdminProfile> {
    return adminProfile(await this.insertAdmin(input, actor, false));
  }

  /**
   * A staff account created by an ADMIN from the console: OPERATOR, AUDITOR, RETAIL or LOGISTICS (with its
   * locations, at least one), with a temporary password returned once (only its hash is stored; it is never
   * audited or logged) that must be replaced at the first sign-in. ADMIN accounts are created from the shell
   * (createAdmin).
   */
  async createStaff(input: { email: string; role: StaffRole; stockLocationIds?: readonly string[] }, actor: Actor): Promise<StaffAccount> {
    if (!STAFF_ROLES.includes(input?.role)) throw validationError('The console creates OPERATOR, AUDITOR, RETAIL and LOGISTICS accounts; ADMIN accounts are created from the shell.');
    const temporaryPassword = generateTemporaryPassword();
    const row = await this.insertAdmin({ email: input.email, password: temporaryPassword, role: input.role, stockLocationIds: input.stockLocationIds }, actor, true);
    return { admin: await summaryOf(this.db, row, this.clock()), temporaryPassword };
  }

  /**
   * The locations a console login works at (admin_user_locations, plan NEXT LOT §3.5.6.1): a LOGISTICS login's, sorted;
   * empty for any other role (and for a login that does not exist).
   */
  async adminLocations(adminId: string): Promise<string[]> {
    if (typeof adminId !== 'string' || !UUID_RE.test(adminId)) return [];
    return locationsOf(this.db, adminId.toLowerCase());
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
        .select(['locked_until', 'disabled_at', 'password_hash', 'password_change_required'])
        .where('id', '=', admin.id)
        .forUpdate()
        .executeTakeFirst();
      if (!fresh || fresh.disabled_at !== null) throw invalidCredentials();
      if (fresh.locked_until !== null && fresh.locked_until.getTime() > this.clock().getTime()) throw accountLocked();
      // A password change (A-02: the admin's own, or the forced replacement of a temporary password) that committed
      // during the scrypt check above has ended every other session: the password checked there no longer opens one,
      // nor is it written back by a rehash. A concurrent login's rehash of this same password still matches (rare:
      // checked again, under the lock), as for customers (login).
      const unchanged = fresh.password_hash === admin.password_hash;
      if (!unchanged && !(await verifySecret(password, fresh.password_hash))) throw invalidCredentials();
      let q = tx
        .updateTable('admin_users')
        .set({
          failed_logins: 0,
          locked_until: null,
          updated_at: now,
          ...(totpUpdate ? { totp_secret_enc: totpUpdate.to } : {}),
          ...(rehash && unchanged ? { password_hash: rehash } : {}),
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
      return {
        admin: adminProfile({
          ...admin,
          password_change_required: fresh.password_change_required,
          totp_secret_enc: totpUpdate?.to ?? admin.totp_secret_enc,
        }),
        session,
      };
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
   * a current code; only then is the secret stored (encrypted). Every session
   * of that admin ends in the same transaction, except `opts.keepToken` (the
   * console's own, which the route then rotates into an MFA-passed one): they
   * were opened with the password alone, and one left alive could still use
   * what MFA does not guard. Audited `admin.totp.enable` with `sessionsRevoked`.
   */
  async enableTotp(adminId: string, input: { secret: string; code: string }, actor: Actor, opts: { keepToken?: string } = {}): Promise<{ sessionsRevoked: number }> {
    let secretBytes: Uint8Array;
    try {
      secretBytes = base32Decode(input?.secret);
    } catch {
      throw validationError('Invalid TOTP secret.');
    }
    if (secretBytes.length < 16 || secretBytes.length > 64) throw validationError('Invalid TOTP secret.');
    const r = verifyTotp(secretBytes, input.code, this.clock().getTime());
    if (!r.ok) throw new DomainError('TOTP_CODE_INVALID', 400, 'The code is not valid. Check the time on your device and try again.');

    return inTransaction(this.db, async (tx) => {
      const admin = await this.requireAdmin(tx, adminId);
      const sealed = this.sealTotp(admin.id, { v: 1, s: base32Encode(secretBytes), c: r.counter });
      const u = await tx
        .updateTable('admin_users')
        .set({ totp_secret_enc: sealed, updated_at: this.clock() })
        .where('id', '=', admin.id)
        .where('totp_secret_enc', 'is', null)
        .executeTakeFirst();
      if (Number(u.numUpdatedRows) !== 1) throw conflict('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already enabled.');
      const sessionsRevoked = await this.sessions.revokeAllForSubject('admin', admin.id, { exceptToken: opts.keepToken }, tx);
      await this.audit.record({ actor, action: 'admin.totp.enable', targetType: 'admin', targetId: admin.id, details: { sessionsRevoked } }, tx);
      return { sessionsRevoked };
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
    const tied = await this.db.selectFrom('admin_user_locations').select(['admin_user_id', 'stock_location_id']).orderBy('stock_location_id').execute();
    const now = this.clock();
    return rows.map((r) => adminSummary(r, now, tied.filter((t) => t.admin_user_id === r.id).map((t) => t.stock_location_id)));
  }

  /**
   * Change a console user's role. Refused on one's own account (SELF_ACTION) and when it would
   * leave no active ADMIN (LAST_ADMIN). Takes effect at the next request: the guard reads the role
   * from the database every time. The console only offers STAFF_ROLES; ADMIN comes from the shell.
   * LOGISTICS (plan NEXT LOT §3.5.6.1) comes with its locations (`stockLocationIds`, at least one): a
   * LOGISTICS login keeping its role has its locations changed to these; a role changed away from
   * LOGISTICS deletes them in the same transaction. Audited `admin.role_change` (`{ from, to }`, and the
   * locations when the role is LOGISTICS).
   */
  async setAdminRole(adminId: string, role: AdminRole, actor: Actor, opts: { stockLocationIds?: readonly string[] } = {}): Promise<AdminSummary> {
    if (!ADMIN_ROLES.includes(role)) throw validationError('Unknown admin role.');
    assertNotSelf(adminId, actor);
    const locations = await cleanLocations(this.db, role, opts.stockLocationIds);
    return this.rosterChange(adminId, async (tx, row) => {
      const before = row.role === 'LOGISTICS' ? await locationsOf(tx, row.id) : [];
      const sameLocations = before.length === locations.length && before.every((id, i) => id === locations[i]);
      if (row.role === role && sameLocations) return row;
      if (role !== 'ADMIN') await assertNotLastAdmin(tx, row);
      const next =
        row.role === role ? row : await tx.updateTable('admin_users').set({ role, updated_at: this.clock() }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();
      // The locations follow the role: those no longer chosen deleted, the new ones tied by this ADMIN.
      const gone = before.filter((id) => !locations.includes(id));
      if (gone.length > 0) await tx.deleteFrom('admin_user_locations').where('admin_user_id', '=', row.id).where('stock_location_id', 'in', gone).execute();
      const added = locations.filter((id) => !before.includes(id));
      if (added.length > 0) {
        await tx
          .insertInto('admin_user_locations')
          .values(added.map((id) => ({ admin_user_id: row.id, stock_location_id: id, created_by: actorAdminId(actor), created_at: this.clock() })))
          .execute();
      }
      await this.audit.record(
        { actor, action: 'admin.role_change', targetType: 'admin', targetId: row.id, details: { from: row.role, to: role, ...(role === 'LOGISTICS' ? { stockLocationIds: locations } : {}) } },
        tx,
      );
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
      if (row.failed_logins === 0 && row.locked_until === null) return summaryOf(tx, row, this.clock());
      const next = await tx
        .updateTable('admin_users')
        .set({ failed_logins: 0, locked_until: null, updated_at: this.clock() })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const locked = row.locked_until !== null && row.locked_until.getTime() > this.clock().getTime();
      await this.audit.record({ actor, action: 'admin.unlock', targetType: 'admin', targetId: row.id, details: { failedLogins: row.failed_logins, locked } }, tx);
      return summaryOf(tx, next, this.clock());
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
   * A wrong current password answers `400 CURRENT_PASSWORD_INVALID`, never a
   * 401: the apps sign a user out on any 401. For a customer it also counts
   * in the login throttle (ACCOUNT_LOGIN_THROTTLE): whoever holds a session
   * cannot guess the password faster than a login could, and while the
   * account is throttled the current password is not even looked at (same
   * answer). For an admin it counts as a failed sign-in (the lockout of
   * adminLogin), and a locked admin is refused before the password is looked
   * at and again under the row lock before the new one is written, so a
   * stolen session cookie cannot be used to guess the password, not even
   * with a burst of guesses in flight when the lockout fires. The new
   * password is checked against the policy before the current one, so a
   * weak choice costs no attempt; it must differ from the current one. An
   * admin's change also clears `password_change_required` (the temporary
   * password of a staff account).
   *
   * The two scrypts run outside the transaction; the write then re-reads the
   * subject's row under its lock and goes ahead only if nothing happened
   * meanwhile (C-04, A-06): a customer account LOCKED by Client Services
   * answers 403 ACCOUNT_LOCKED; an account no longer active, a disabled
   * admin, or a `keepToken` session that has ended (a recovery, a lock or
   * another password change ended it) answers 401; an admin locked out
   * meanwhile answers 429 ACCOUNT_LOCKED; a password replaced meanwhile (by a
   * recovery or a concurrent change: the current password no longer matches
   * the stored hash) answers 400 CURRENT_PASSWORD_INVALID. So a change under
   * way can never undo a recovery or outlive a lock.
   */
  /**
   * The account's password, typed again to confirm an action a session alone must not be enough for: PIECE FOUND
   * (POST /api/v1/ownership/incidents/resolve, F-01), which makes a piece the owner reported lost read as clean.
   * Checked as the current password of a password change is: a wrong one answers 400 CURRENT_PASSWORD_INVALID (never
   * a 401, which would sign the app out) and counts towards the account's sign-in throttle (`account.login_failed`
   * with `via`), and while the account is throttled the password is not even looked at (same answer). Nothing is
   * written when it is right. 401 when the account is no longer active, 403 ACCOUNT_LOCKED when it is locked.
   */
  async confirmAccountPassword(accountId: string, password: unknown, actor: Actor, via: 'incident_resolve'): Promise<void> {
    const row = await this.requireAccount(this.db, accountId);
    if (row.status === 'LOCKED') throw customerAccountLocked();
    if (row.status !== 'ACTIVE') throw unauthorized();
    const current = loginPassword(password);
    if (this.accountThrottled(row)) {
      await this.burnTime(current);
      throw currentPasswordInvalid();
    }
    if (current === undefined || !(await verifySecret(current, row.password_hash))) {
      await this.recordAccountFailure(row.id, actor.ipHash ? { ipHash: actor.ipHash } : {}, via);
      throw currentPasswordInvalid();
    }
  }

  async changePassword(
    subject: { type: SessionSubjectType; id: string },
    input: { currentPassword: string; newPassword: string },
    actor: Actor,
    opts: { keepToken?: string } = {},
  ): Promise<void> {
    const admin = subject.type === 'admin' ? await this.requireAdmin(this.db, subject.id) : undefined;
    const row = admin ?? (await this.requireAccount(this.db, subject.id));
    if (admin?.locked_until && admin.locked_until.getTime() > this.clock().getTime()) throw accountLocked();
    const next = checkPasswordPolicy(input?.newPassword, row.email);
    const current = loginPassword(input?.currentPassword);
    if (!admin && this.accountThrottled(row as AccountRow)) {
      await this.burnTime(current);
      throw currentPasswordInvalid();
    }
    if (current === undefined || !(await verifySecret(current, row.password_hash))) {
      if (admin) await this.recordAdminFailure(admin.id, 'password', { ipHash: actor.ipHash ?? null });
      else await this.recordAccountFailure(row.id, actor.ipHash ? { ipHash: actor.ipHash } : {}, 'password_change');
      throw currentPasswordInvalid();
    }
    if (next === current) throw validationError('Choose a new password, different from the current one.');
    const hash = await hashSecret(next);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // Under the row lock (as login, the lock and the recovery take it): what was verified must still hold.
      let verified: string | undefined;
      if (admin) {
        // A burst of guesses through a stolen session may have locked the admin (or an ADMIN disabled it)
        // while this attempt was hashing. Without this, every guess in flight is evaluated and a correct
        // one still changes the password.
        const fresh = await tx
          .selectFrom('admin_users')
          .select(['password_hash', 'locked_until', 'disabled_at'])
          .where('id', '=', admin.id)
          .forNoKeyUpdate()
          .executeTakeFirst();
        // Disabled: its sessions ended with it, so the answer the session guard gives (and the console signs out).
        if (!fresh || fresh.disabled_at !== null) throw unauthorized();
        if (fresh.locked_until !== null && fresh.locked_until.getTime() > now.getTime()) throw accountLocked();
        verified = fresh.password_hash;
      } else {
        const fresh = await tx.selectFrom('accounts').select(['password_hash', 'status']).where('id', '=', row.id).forNoKeyUpdate().executeTakeFirst();
        if (fresh?.status === 'LOCKED') throw customerAccountLocked();
        if (!fresh || fresh.status !== 'ACTIVE') throw unauthorized();
        verified = fresh.password_hash;
      }
      if (opts.keepToken !== undefined && !(await this.sessions.isLive(opts.keepToken, subject.type, row.id, tx))) throw unauthorized();
      // Replaced meanwhile: by a recovery or another change, the current password no longer matches it; a concurrent
      // sign-in's re-hash of the same password still does (rare: checked again, under the lock).
      if (verified !== row.password_hash && !(await verifySecret(current, verified))) throw currentPasswordInvalid();
      if (admin) {
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

  // ── Step-up (plan PURGE §S) ─────────────────────────────────────────────

  /**
   * Step 1 of the step-up that confirms the console's most destructive actions (a test's PURGE, PURGE ALL ENDED TESTS,
   * the PLATFORM RESET, LOCK RESET): a fresh code of the admin's authenticator app, and the current password when
   * `requirePassword`. Called BEFORE the action's transaction, as changePassword checks the current password before
   * its own (a wrong code is counted in its own commit on the outer connection, which a query from inside an open
   * transaction would deadlock on PGlite and would take a second connection for on PostgreSQL). Nothing is written when
   * it passes: the code is consumed by consumeAdminStepUp inside the action's transaction, so only an action that
   * commits uses it. There is no step-up token.
   *
   * Refused, in this order, before any code or password is looked at:
   *   1. the admin disabled or unknown, or the session not a live one of this admin: 401 (the guard already said so);
   *   2. a role other than ADMIN: 403 INSUFFICIENT_ROLE;
   *   3. no second factor enrolled, whatever ADMIN_REQUIRE_MFA says: 403 STEP_UP_TOTP_NOT_ENABLED;
   *   4. a session opened without the code (password only): 403 STEP_UP_SESSION_WITHOUT_CODE;
   *   5. the sign-in lockout: 429 ACCOUNT_LOCKED;
   *   6. 10 step-up failures in the last 24 h, read from the audit chain (so an unlock from Team does not clear it):
   *      429 STEP_UP_LOCKED;
   *   7. a second factor enrolled or removed, an ADMIN role given or taken, or the account created as ADMIN, less than
   *      24 h ago: 403 STEP_UP_TOO_SOON.
   * Rules 6 and 7 also count the facts a platform reset carried into entry 1 of the new chain (§S.2.8), so a reset
   * clears neither. Then the password (400 STEP_UP_PASSWORD_INVALID), then the code (400 STEP_UP_CODE_INVALID, or 400
   * STEP_UP_CODE_USED when its time step was already used, e.g. at sign-in: wait for the next code). A wrong password
   * or code counts as a failed sign-in (the lockout of adminLogin) with `via: 'step_up'`. Never a 401 for a wrong
   * secret: the console signs out on any 401.
   */
  async verifyAdminStepUp(input: StepUpInput, meta: ClientMeta = {}): Promise<VerifiedStepUp> {
    assertStepUpPurpose(input?.purpose);
    if (typeof input.adminId !== 'string' || !UUID_RE.test(input.adminId)) throw unauthorized();
    const adminId = input.adminId.toLowerCase();
    const admin = await this.db.selectFrom('admin_users').selectAll().where('id', '=', adminId).executeTakeFirst();
    if (!admin || admin.disabled_at !== null) throw unauthorized();
    if (admin.role !== 'ADMIN') throw stepUpInsufficientRole();
    if (admin.totp_secret_enc === null) {
      throw new DomainError('STEP_UP_TOTP_NOT_ENABLED', 403, 'Turn on two-factor authentication on the Security page first.');
    }
    const session = await this.stepUpSession(input.token, admin.id);
    if (!session) throw unauthorized();
    if (!session.mfa_passed) throw new DomainError('STEP_UP_SESSION_WITHOUT_CODE', 403, 'Sign out, then sign in again with your authenticator code.');
    const now = this.clock();
    if (admin.locked_until !== null && admin.locked_until.getTime() > now.getTime()) throw accountLocked();

    const recent = await this.stepUpRecentFacts(admin.id, now);
    if (recent.failures.length >= STEP_UP_DAILY_FAILURES) {
      // The limit holds until the 10th newest failure is 24 h old.
      const tenth = recent.failures.sort((a, b) => b - a)[STEP_UP_DAILY_FAILURES - 1]!;
      throw new DomainError('STEP_UP_LOCKED', 429, `Too many wrong codes today. Try again after ${parisWhen(new Date(tenth + STEP_UP_RECENT_MS))}.`);
    }
    if (recent.changes.length > 0) {
      const newest = Math.max(...recent.changes);
      throw new DomainError(
        'STEP_UP_TOO_SOON',
        403,
        `Two-factor authentication or the role of this account changed less than 24 hours ago. Try again after ${parisWhen(new Date(newest + STEP_UP_RECENT_MS))}.`,
      );
    }

    if (input.requirePassword) {
      const password = loginPassword(input.password);
      if (password === undefined || !(await verifySecret(password, admin.password_hash))) {
        await this.recordAdminFailure(admin.id, 'password', meta, 'step_up');
        throw new DomainError('STEP_UP_PASSWORD_INVALID', 400, 'The password is not correct.');
      }
    }

    const code = typeof input.totp === 'string' ? input.totp.trim() : '';
    // Nothing typed is not a guess: refused, not counted (as adminLogin's TOTP_REQUIRED).
    if (code === '') throw stepUpCodeInvalid();
    const state = this.openTotp(admin.id, admin.totp_secret_enc);
    const secret = base32Decode(state.s);
    const r = verifyTotp(secret, code, now.getTime(), { afterCounter: state.c });
    if (!r.ok) {
      // Which refusal (crypto/totp.ts): the right code of a step already used, or a wrong code. Both are counted.
      const any = verifyTotp(secret, code, now.getTime());
      await this.recordAdminFailure(admin.id, 'totp', meta, 'step_up');
      if (any.ok && any.counter <= state.c) throw stepUpCodeUsed();
      throw stepUpCodeInvalid();
    }
    return verifiedStepUp({ adminId: admin.id, token: input.token, purpose: input.purpose, step: r.counter, sealedRead: admin.totp_secret_enc, passwordHash: admin.password_hash });
  }

  /**
   * Step 2: consume a verified step-up INSIDE the action's transaction `tx`, first in it, so the code is used only if
   * the action commits (a rollback leaves the code usable). Under the admin's row lock, everything verified must
   * still hold, each with its own answer: disabled 401, locked 429 ACCOUNT_LOCKED, no longer ADMIN 403
   * INSUFFICIENT_ROLE, password changed meanwhile 400 STEP_UP_PASSWORD_CHANGED, session ended 401; then a
   * compare-and-swap of the sealed TOTP state from the value read to the accepted step (0 rows: the code was used
   * meanwhile, or the second factor reset: 400 STEP_UP_CODE_USED). Every refusal throws, so the action's transaction
   * commits nothing and no `admin.step_up` row exists. On success the failed sign-in counter is back to 0 and the
   * audit row `admin.step_up { purpose }` (target the admin) is written in `tx`: the database's own checks of a purge
   * request and of a reset authorization look for it in the same transaction. No code, password or phrase is written
   * anywhere.
   */
  async consumeAdminStepUp(verified: VerifiedStepUp, tx: Db, meta: ClientMeta = {}): Promise<void> {
    assertStepUpPurpose(verified?.purpose);
    const fresh = await tx
      .selectFrom('admin_users')
      .select(['role', 'disabled_at', 'locked_until', 'password_hash', 'totp_secret_enc'])
      .where('id', '=', verified.adminId)
      .forUpdate()
      .executeTakeFirst();
    const now = this.clock();
    if (!fresh || fresh.disabled_at !== null) throw unauthorized();
    if (fresh.locked_until !== null && fresh.locked_until.getTime() > now.getTime()) throw accountLocked();
    if (fresh.role !== 'ADMIN') throw stepUpInsufficientRole();
    if (fresh.password_hash !== verified.passwordHash) throw new DomainError('STEP_UP_PASSWORD_CHANGED', 400, 'Your password changed. Sign in again.');
    if (!(await this.sessions.isLive(verified.token, 'admin', verified.adminId, tx))) throw unauthorized();
    const state = this.openTotp(verified.adminId, verified.sealedRead);
    const r = await tx
      .updateTable('admin_users')
      .set({ totp_secret_enc: this.sealTotp(verified.adminId, { v: 1, s: state.s, c: verified.step }), failed_logins: 0, updated_at: now })
      .where('id', '=', verified.adminId)
      .where('totp_secret_enc', '=', verified.sealedRead)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) !== 1) throw stepUpCodeUsed();
    await this.audit.record(
      { actor: adminActor(verified.adminId, meta), action: 'admin.step_up', targetType: 'admin', targetId: verified.adminId, details: { purpose: verified.purpose } },
      tx,
    );
  }

  /** The live console session behind `token` when it is this admin's (its MFA flag read, nothing touched), else undefined. */
  private async stepUpSession(token: unknown, adminId: string): Promise<{ mfa_passed: boolean } | undefined> {
    const idHash = hashSessionToken(token);
    if (!idHash) return undefined;
    const row = await this.db.selectFrom('sessions').select(['subject_type', 'subject_id', 'mfa_passed', 'expires_at']).where('id_hash', '=', idHash).executeTakeFirst();
    if (!row || row.subject_type !== 'admin' || row.subject_id !== adminId || row.expires_at.getTime() <= this.clock().getTime()) return undefined;
    return { mfa_passed: row.mfa_passed };
  }

  /**
   * The times (ms) of what the step-up's rules 6 and 7 count for this admin in the 24 h before `now`: its step-up
   * failures, and its second-factor and ADMIN role changes. Read from the audit chain through its target index, plus
   * the facts a platform reset carried into entry 1 (§S.2.8): the `platform.reset` row at id 1, read by its primary key
   * (a `platform.reset` row anywhere else is not entry 1 and is ignored).
   */
  private async stepUpRecentFacts(adminId: string, now: Date): Promise<{ failures: number[]; changes: number[] }> {
    const since = new Date(now.getTime() - STEP_UP_RECENT_MS);
    const recent = (t: number) => Number.isFinite(t) && t > since.getTime();
    const failures = (
      await this.db
        .selectFrom('audit_logs')
        .select('occurred_at')
        .where('target_type', '=', 'admin')
        .where('target_id', '=', adminId)
        .where('action', '=', 'admin.login_failed')
        .where(sql<string>`details->>'via'`, '=', 'step_up')
        .where('occurred_at', '>', since)
        .execute()
    ).map((r) => r.occurred_at.getTime());
    const changes = (
      await this.db
        .selectFrom('audit_logs')
        .select(['action', 'details', 'occurred_at'])
        .where('target_type', '=', 'admin')
        .where('target_id', '=', adminId)
        .where('action', 'in', [...STEP_UP_CHANGE_ACTIONS])
        .where('occurred_at', '>', since)
        .execute()
    )
      .filter((r) => stepUpChangeCounts(r.action, stringOf(r.details.from), stringOf(r.details.to ?? r.details.role), true))
      .map((r) => r.occurred_at.getTime());

    const entry1 = await this.db.selectFrom('audit_logs').select(['action', 'details']).where('id', '=', 1).executeTakeFirst();
    const carried = entry1?.action === 'platform.reset' && Array.isArray(entry1.details.recent24h) ? entry1.details.recent24h : [];
    for (const raw of carried) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const fact = raw as Record<string, unknown>;
      if (typeof fact.targetAdminId !== 'string' || fact.targetAdminId.toLowerCase() !== adminId || typeof fact.occurredAt !== 'string') continue;
      const at = Date.parse(fact.occurredAt);
      if (!recent(at)) continue;
      if (fact.action === 'admin.login_failed') failures.push(at);
      else if (typeof fact.action === 'string' && stepUpChangeCounts(fact.action, stringOf(fact.from), stringOf(fact.to), false)) changes.push(at);
    }
    return { failures, changes };
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

  /**
   * Count a wrong customer password in the current throttle window (a new window once the old one expired).
   * `via`: where it was typed, when not at sign-in (the current password of a password change).
   */
  private async recordAccountFailure(accountId: string, meta: ClientMeta, via?: 'password_change' | 'incident_resolve'): Promise<void> {
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
          details: { failedLogins: r.failed_logins, throttled: r.failed_logins >= ACCOUNT_LOGIN_THROTTLE.maxFailures, ...(via ? { via } : {}) },
        },
        tx,
      );
    });
  }

  /**
   * Count a failed admin login (committed on its own) and lock at the threshold. `via: 'step_up'`: typed to confirm a
   * console action (verifyAdminStepUp), not at sign-in; only then does the row carry `via`.
   */
  private async recordAdminFailure(adminId: string, reason: 'password' | 'totp', meta: ClientMeta, via?: 'step_up'): Promise<void> {
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
        {
          actor: adminActor(adminId, meta),
          action: 'admin.login_failed',
          targetType: 'admin',
          targetId: adminId,
          details: { reason, failedLogins: r.failed_logins, locked, ...(via ? { via } : {}) },
        },
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
    const locations = await cleanLocations(this.db, input.role, input.stockLocationIds);
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
        // A LOGISTICS login's locations, in the same transaction (plan NEXT LOT §3.5.6.1).
        if (locations.length > 0) {
          await tx
            .insertInto('admin_user_locations')
            .values(locations.map((id) => ({ admin_user_id: row.id, stock_location_id: id, created_by: actorAdminId(actor), created_at: now })))
            .execute();
        }
        // Never the password, temporary or not: the audit log is permanent.
        await this.audit.record(
          {
            actor,
            action: 'admin.create',
            targetType: 'admin',
            targetId: row.id,
            details: { role: row.role, ...(row.role === 'LOGISTICS' ? { stockLocationIds: locations } : {}), ...(passwordChangeRequired ? { passwordChangeRequired } : {}) },
          },
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
      return summaryOf(tx, await fn(tx, row), this.clock());
    });
  }
}

// ── Mapping & validation ───────────────────────────────────────────────────


// ── Step-up (plan PURGE §S) ────────────────────────────────────────────────

// Imported here, below the class, so that the lines of this file docs/legal/TERMS-FACTS.md cites do not move (plan
// PURGE §L: the lot changes nothing legal). ES imports are hoisted: it is bound before any code of the module runs.
import { parisWhen } from './maintenance-window.js';

/**
 * What a step-up confirms (plan PURGE §S): the code is bound to one action, and the audit row `admin.step_up` names it.
 * `test_run.purge:<run id>` one test's PURGE, `test_run.purge_all` PURGE ALL ENDED TESTS, `platform.reset` the
 * PLATFORM RESET, `platform.reset.lock` LOCK RESET.
 */
export type StepUpPurpose = `test_run.purge:${string}` | 'test_run.purge_all' | 'platform.reset' | 'platform.reset.lock';

export interface StepUpInput {
  adminId: string;
  /** The console session's token (the `orbes_admin` cookie): it must have passed MFA, and still be live when the code is consumed. */
  token: string;
  /** The current code of the admin's authenticator app. */
  totp: unknown;
  /** The admin's current password, checked when `requirePassword` (the reset and LOCK RESET), ignored otherwise. */
  password?: unknown;
  purpose: StepUpPurpose;
  requirePassword: boolean;
}

/**
 * A step-up verified by verifyAdminStepUp and not yet consumed: the TOTP step accepted, and what was read (the sealed
 * TOTP state and the password hash), which consumeAdminStepUp requires unchanged. The session token, the sealed value
 * and the hash are not even enumerable, so a log line of this object never shows them.
 */
export interface VerifiedStepUp {
  readonly adminId: string;
  readonly token: string;
  readonly purpose: StepUpPurpose;
  readonly step: number;
  readonly sealedRead: string;
  readonly passwordHash: string;
}

/**
 * A fact a platform reset carried over into entry 1 of the new chain (`details.recent24h` of the `platform.reset` row
 * at id 1, plan PURGE §S.2.8, H5): one audit row of the 24 h before the reset that the step-up's daily limit or its
 * 24-hour rule counts. Only these fields: never a code, a password, an IP or any other detail.
 */
export interface StepUpCarriedFact {
  action: 'admin.login_failed' | 'admin.totp.enable' | 'admin.totp.disable' | 'admin.role_change' | 'admin.create';
  targetAdminId: string;
  /** ISO-8601. */
  occurredAt: string;
  /** A role change's roles (an admin.create's role in `to`). */
  from?: string;
  to?: string;
}

/** Step-up failures (wrong codes or passwords typed to confirm an action) in 24 h that close the step-up for the day (§S.2.6). */
export const STEP_UP_DAILY_FAILURES = 10;
/** The step-up's look-back: its daily limit and its rule after a second-factor or ADMIN role change (§S.2.6, §S.2.7). */
export const STEP_UP_RECENT_MS = 24 * 60 * 60 * 1000;
const STEP_UP_PURPOSE_RE = /^(?:test_run\.purge:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|test_run\.purge_all|platform\.reset|platform\.reset\.lock)$/;
/** The actions behind the 24-hour rule (§S.2.7): a second factor enrolled or removed, an ADMIN role given or taken. */
const STEP_UP_CHANGE_ACTIONS = ['admin.totp.enable', 'admin.totp.disable', 'admin.role_change', 'admin.create'] as const;

const stepUpInsufficientRole = () => new DomainError('INSUFFICIENT_ROLE', 403, 'Your role does not allow this action.');
const stepUpCodeInvalid = () => new DomainError('STEP_UP_CODE_INVALID', 400, 'The code is not valid. Check the time on your device and try again.');
const stepUpCodeUsed = () => new DomainError('STEP_UP_CODE_USED', 400, 'This code was just used. Wait for the next code.');

/** A purpose the step-up knows (a programming error otherwise: the routes name it, never the request). */
function assertStepUpPurpose(purpose: unknown): asserts purpose is StepUpPurpose {
  if (typeof purpose !== 'string' || !STEP_UP_PURPOSE_RE.test(purpose)) throw new RangeError('unknown step-up purpose');
}

function stringOf(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Whether a row of a 24-hour-rule action counts (§S.2.7): a second factor enrolled or removed always; a role change
 * from or to ADMIN; an account created as ADMIN. `exact`: a row of the chain, read as written. A carried fact
 * (§S.2.8) lists only rows that counted, so one whose roles are missing still counts (the refusal is the safe side).
 */
function stepUpChangeCounts(action: string, from: string | undefined, to: string | undefined, exact: boolean): boolean {
  if (action === 'admin.totp.enable' || action === 'admin.totp.disable') return true;
  if (action === 'admin.role_change') return from === 'ADMIN' || to === 'ADMIN' || (!exact && from === undefined && to === undefined);
  if (action === 'admin.create') return to === 'ADMIN' || (!exact && to === undefined);
  return false;
}

/** A frozen verified step-up whose session token, sealed TOTP value and password hash are not enumerable (never shown by a log of it). */
function verifiedStepUp(v: VerifiedStepUp): VerifiedStepUp {
  const out = { adminId: v.adminId, token: v.token, purpose: v.purpose, step: v.step } as VerifiedStepUp;
  Object.defineProperties(out, {
    sealedRead: { value: v.sealedRead, enumerable: false },
    passwordHash: { value: v.passwordHash, enumerable: false },
    token: { value: v.token, enumerable: false },
  });
  return Object.freeze(out);
}

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

function adminSummary(r: AdminUserRow, now: Date, stockLocationIds: string[]): AdminSummary {
  return {
    ...adminProfile(r),
    locked: r.locked_until !== null && r.locked_until.getTime() > now.getTime(),
    disabled: r.disabled_at !== null,
    stockLocationIds,
  };
}

/** An admin's summary with its locations, read in `db` (the caller's transaction when there is one). */
async function summaryOf(db: Db, r: AdminUserRow, now: Date): Promise<AdminSummary> {
  return adminSummary(r, now, await locationsOf(db, r.id));
}

/** A login's locations (admin_user_locations), sorted. */
async function locationsOf(db: Db, adminId: string): Promise<string[]> {
  const rows = await db.selectFrom('admin_user_locations').select('stock_location_id').where('admin_user_id', '=', adminId).orderBy('stock_location_id').execute();
  return rows.map((r) => r.stock_location_id);
}

/**
 * The locations given with a role (plan NEXT LOT §3.5.6.1): for LOGISTICS at least one (400 'Choose at least one
 * location.'), each a known location (404 STOCK_LOCATION_NOT_FOUND), each once, sorted; for any other role none.
 */
async function cleanLocations(db: Db, role: AdminRole, ids: unknown): Promise<string[]> {
  const list = ids === undefined || ids === null ? [] : ids;
  if (!Array.isArray(list) || list.some((id) => typeof id !== 'string')) throw validationError('The locations must be a list of location ids.');
  if (role !== 'LOGISTICS') {
    if (list.length > 0) throw validationError('Only a LOGISTICS login works at locations.');
    return [];
  }
  if (list.length === 0) throw validationError(LOGISTICS_LOCATIONS_REQUIRED);
  if (list.length > MAX_LOGIN_LOCATIONS) throw validationError(`At most ${MAX_LOGIN_LOCATIONS} locations per login.`);
  const known: string[] = [];
  for (const id of list as string[]) known.push(await knownLocation(db, id));
  return [...new Set(known)].sort();
}

/** The admin behind an actor, who ties a login to its locations; null for the shell or the system. */
function actorAdminId(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id : null;
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

