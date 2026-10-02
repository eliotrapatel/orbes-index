/**
 * AccountRecoveryService — assisted recovery of a customer account (C-04;
 * API §10.8 and §16.10, SECURITY-MODEL §3.3).
 *
 * There is no email channel, so a forgotten password goes through ORBES
 * Client Services: after checking the customer's identity (the procedure is
 * written with counsel), an ADMIN issues a one-time code in the console,
 * reads it to the customer, and the customer enters it on /verify with a new
 * password.
 *
 *   issue    POST /api/admin/owners/:id/recovery-code (ADMIN): 12 Crockford
 *            base32 characters (60 bits), shown once as XXXX-XXXX-XXXX and
 *            stored only as an scrypt hash (like claim codes); valid 30
 *            minutes (RECOVERY_CODE_TTL_MS), used once; a new code revokes
 *            the open one (one open code per account, also a partial UNIQUE
 *            index). Only for an ACTIVE account. Audited
 *            `account.recovery_code.issue`, never with the code.
 *   recover  POST /api/v1/account/recover (public, rate group `auth`): the
 *            same answer, 400 RECOVERY_CODE_INVALID, for an unknown email, a
 *            wrong, expired, used or replaced code, and while the account is
 *            throttled, with the same cost (one scrypt). At most 5 failures
 *            per account per rolling hour (RECOVERY_ATTEMPT_LIMIT): they are
 *            counted from the audit log (`account.recover_failed`, committed
 *            before the answer), and attempts on one account are serialised
 *            by its row lock, so the limit is exact across instances. Then,
 *            in one transaction: the new password, every session of the
 *            account revoked, its pending transfers cancelled, new transfers
 *            paused for 72 hours (`accounts.transfers_frozen_until`, 409
 *            TRANSFERS_PAUSED) against a takeover by social engineering, and
 *            the code marked used. Audited `account.recover`. A LOCKED
 *            account is refused (403 ACCOUNT_LOCKED, the code is kept).
 *
 * Lock order: the account row, then the products of its pending transfers
 * (OwnershipService.cancelPendingTransfersFrom), as in initiateTransfer.
 *
 * The audit log is permanent: entries name the account id, never the email
 * or the code.
 */
import { hashSecret, MAX_SECRET_BYTES, verifySecret } from '../crypto/scrypt.js';
import { inTransaction, type Db } from '../db/connection.js';
import { conflict, DomainError, forbidden, notFound } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { checkPasswordPolicy, customerAccountLocked, normalizeEmail, type ClientMeta } from './auth.js';
import { formatGrouped, normalizeCrockford, randomCrockford } from './claim-codes.js';
import type { OwnershipService } from './ownership.js';
import type { SessionService } from './sessions.js';

/** A recovery code lives 30 minutes (the same delay as the A-06 brief, the safer of the two briefs). */
export const RECOVERY_CODE_TTL_MS = 30 * 60_000;
export const RECOVERY_CODE_LENGTH = 12;
/** Failures per account per rolling hour before attempts are refused without checking the code. */
export const RECOVERY_ATTEMPT_LIMIT = 5;
export const RECOVERY_ATTEMPT_WINDOW_MS = 60 * 60_000;
/** New transfers out of a recovered account are paused this long. */
export const TRANSFER_FREEZE_MS = 72 * 60 * 60_000;
/** Audit action whose entries count towards RECOVERY_ATTEMPT_LIMIT. */
export const RECOVERY_FAILED_ACTION = 'account.recover_failed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IssuedRecoveryCode {
  /** XXXX-XXXX-XXXX, shown once; only its scrypt hash is stored. */
  recoveryCode: string;
  expiresAt: Date;
}

export interface RecoverInput {
  email: string;
  recoveryCode: string;
  newPassword: string;
}

export interface RecoveryOutcome {
  accountId: string;
  sessionsRevoked: number;
  /** Ids of the pending transfers the recovery cancelled. */
  transfersCancelled: string[];
  /** New transfers out of the account are refused until then. */
  transfersFrozenUntil: Date;
}

/** Why an attempt failed, for the audit log (staff read it when a customer calls back); never shown to the public. */
type FailureReason = 'NO_OPEN_CODE' | 'EXPIRED' | 'MISMATCH';

/** One answer for every refusal: the caller learns neither whether the email has an account nor why the code failed. */
export const recoveryCodeInvalid = () =>
  new DomainError(
    'RECOVERY_CODE_INVALID',
    400,
    'This email and recovery code do not match, or the code has expired or was already used. Check them, or ask ORBES Client Services for a new code.',
  );

function accountActor(id: string, meta: ClientMeta): Actor {
  return meta.ipHash ? { type: 'account', id, ipHash: meta.ipHash } : { type: 'account', id };
}

export interface AccountRecoveryServiceDeps {
  db: Db;
  audit: AuditService;
  sessions: SessionService;
  ownership: OwnershipService;
  clock?: Clock;
}

export class AccountRecoveryService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly sessions: SessionService;
  private readonly ownership: OwnershipService;
  private readonly clock: Clock;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: AccountRecoveryServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.sessions = deps.sessions;
    this.ownership = deps.ownership;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Issue a recovery code for an ACTIVE account (an ADMIN of ORBES Client Services, after an identity
   * check). The code that was open, if any, stops working. The code is returned once.
   */
  async issue(accountId: string, actor: Actor): Promise<IssuedRecoveryCode> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) {
      throw forbidden('Only an ORBES admin can issue a recovery code.');
    }
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    // Hashed before the account is locked: the lock is held for the writes only.
    const canonical = randomCrockford(RECOVERY_CODE_LENGTH);
    const codeHash = await hashSecret(canonical);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await tx.selectFrom('accounts').select(['id', 'status']).where('id', '=', accountId).forUpdate().executeTakeFirst();
      if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (account.status !== 'ACTIVE') throw conflict('ACCOUNT_NOT_ACTIVE', 'A recovery code can be issued only for an active account.');
      const replaced = await tx
        .updateTable('account_recovery_codes')
        .set({ revoked_at: now })
        .where('account_id', '=', account.id)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .returning('id')
        .execute();
      const expiresAt = new Date(now.getTime() + RECOVERY_CODE_TTL_MS);
      const row = await tx
        .insertInto('account_recovery_codes')
        .values({ account_id: account.id, code_hash: codeHash, created_by: actor.id!, created_at: now, expires_at: expiresAt })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          actor,
          action: 'account.recovery_code.issue',
          targetType: 'account',
          targetId: account.id,
          details: { recoveryCodeId: row.id, expiresAt, replaced: replaced.length },
        },
        tx,
      );
      return { recoveryCode: formatGrouped(canonical), expiresAt };
    });
  }

  /**
   * Set a new password with a recovery code (see the file header). The new password is checked
   * against the policy first (400 VALIDATION_FAILED), so a weak choice costs no attempt.
   */
  async recover(input: RecoverInput, meta: ClientMeta = {}): Promise<RecoveryOutcome> {
    const email = normalizeEmail(input?.email);
    const newPassword = checkPasswordPolicy(input?.newPassword, email?.email);
    const code = normalizeCrockford(input?.recoveryCode, RECOVERY_CODE_LENGTH);
    const account =
      email && code !== undefined
        ? await this.db.selectFrom('accounts').select(['id', 'status']).where('email_normalized', '=', email.normalized).executeTakeFirst()
        : undefined;
    if (!account || code === undefined || account.status === 'DELETED') {
      await this.burnTime(code);
      throw recoveryCodeInvalid();
    }

    // One attempt, serialised per account by its row lock; a failure is committed before the answer.
    const attempt = await inTransaction(this.db, async (tx) => {
      await tx.selectFrom('accounts').select('id').where('id', '=', account.id).forUpdate().executeTakeFirstOrThrow();
      const now = this.clock();
      const since = new Date(now.getTime() - RECOVERY_ATTEMPT_WINDOW_MS);
      const recent = await tx
        .selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('target_type', '=', 'account')
        .where('target_id', '=', account.id)
        .where('action', '=', RECOVERY_FAILED_ACTION)
        .where('occurred_at', '>', since)
        .executeTakeFirstOrThrow();
      const failures = Number(recent.n);
      if (failures >= RECOVERY_ATTEMPT_LIMIT) return { kind: 'throttled' as const, failures };
      const open = await tx
        .selectFrom('account_recovery_codes')
        .select(['id', 'code_hash', 'expires_at'])
        .where('account_id', '=', account.id)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      let reason: FailureReason;
      if (!open) reason = 'NO_OPEN_CODE';
      else if (open.expires_at.getTime() <= now.getTime()) reason = 'EXPIRED';
      else if (await verifySecret(code, open.code_hash)) return { kind: 'ok' as const, codeId: open.id };
      else reason = 'MISMATCH';
      // Same cost as a check against an open code.
      if (reason !== 'MISMATCH') await this.burnTime(code);
      await this.audit.record(
        { actor: accountActor(account.id, meta), action: RECOVERY_FAILED_ACTION, targetType: 'account', targetId: account.id, details: { attempt: failures + 1, reason } },
        tx,
      );
      return { kind: 'failed' as const };
    });
    if (attempt.kind === 'throttled') {
      // The code is not even looked at; same cost and answer as a wrong one.
      await this.burnTime(code);
      await this.audit.record({ actor: accountActor(account.id, meta), action: 'account.recover_throttled', targetType: 'account', targetId: account.id, details: { failures: attempt.failures } });
      throw recoveryCodeInvalid();
    }
    if (attempt.kind === 'failed') throw recoveryCodeInvalid();

    const passwordHash = await hashSecret(newPassword);
    const actor = accountActor(account.id, meta);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const fresh = await tx.selectFrom('accounts').select(['id', 'status']).where('id', '=', account.id).forUpdate().executeTakeFirstOrThrow();
      // Locked by staff: refused like a login with the right password; the code stays for when it is unlocked.
      if (fresh.status === 'LOCKED') throw customerAccountLocked();
      if (fresh.status !== 'ACTIVE') throw recoveryCodeInvalid();
      // Used by a concurrent attempt, or replaced by a newer code, since it was checked.
      const used = await tx
        .updateTable('account_recovery_codes')
        .set({ used_at: now })
        .where('id', '=', attempt.codeId)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(used.numUpdatedRows) !== 1) throw recoveryCodeInvalid();
      const transfersFrozenUntil = new Date(now.getTime() + TRANSFER_FREEZE_MS);
      await tx
        .updateTable('accounts')
        .set({ password_hash: passwordHash, failed_logins: 0, failed_logins_since: null, transfers_frozen_until: transfersFrozenUntil, updated_at: now })
        .where('id', '=', fresh.id)
        .execute();
      const sessionsRevoked = await this.sessions.revokeAllForSubject('account', fresh.id, {}, tx);
      const transfersCancelled = await this.ownership.cancelPendingTransfersFrom(tx, fresh.id, actor, 'account_recovery');
      await this.audit.record(
        {
          actor,
          action: 'account.recover',
          targetType: 'account',
          targetId: fresh.id,
          details: { recoveryCodeId: attempt.codeId, sessionsRevoked, transfersCancelled: transfersCancelled.length, transfersFrozenUntil },
        },
        tx,
      );
      return { accountId: fresh.id, sessionsRevoked, transfersCancelled, transfersFrozenUntil };
    });
  }

  /** One scrypt evaluation against a throwaway hash: an unknown email or a missing code costs what a real check does. */
  private async burnTime(code: string | undefined): Promise<void> {
    this.dummyHash ??= hashSecret(`orbes-recovery-dummy-${Math.random()}`);
    const candidate = code && Buffer.byteLength(code, 'utf8') <= MAX_SECRET_BYTES ? code : 'x';
    await verifySecret(candidate, await this.dummyHash);
  }
}
