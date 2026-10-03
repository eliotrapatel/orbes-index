/**
 * AccountRecoveryService (C-04): the one-time code ORBES Client Services
 * issues after an identity check, and the recovery it allows: new password,
 * every session revoked, pending transfers cancelled, links to ownership
 * certificates withdrawn, new transfers paused for 72 hours, the code used
 * once. One answer for an unknown email and a
 * wrong, expired, used or replaced code; 5 wrong guesses per code per hour
 * (attempts without an open code spend nothing). A password change or a
 * sign-in with the old password that was under way when a recovery
 * committed is refused, and so is a certificate link asked for with a
 * session the recovery ended.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { verifySecret } from '../../src/server/crypto/scrypt.js';
import type { ProductStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import {
  AccountRecoveryService,
  RECOVERY_ATTEMPT_LIMIT,
  RECOVERY_ATTEMPT_WINDOW_MS,
  RECOVERY_CODE_TTL_MS,
  TRANSFER_FREEZE_MS,
} from '../../src/server/services/account-recovery.js';
import { AuditService } from '../../src/server/services/audit.js';
import { AuthService, deriveTotpEncryptionKey } from '../../src/server/services/auth.js';
import { normalizeClaimCode } from '../../src/server/services/claim-codes.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { OwnershipCertificateService } from '../../src/server/services/ownership-certificates.js';
import { OwnershipService } from '../../src/server/services/ownership.js';
import { OwnerService } from '../../src/server/services/owners.js';
import { createScanToken } from '../../src/server/services/scan-tokens.js';
import { SessionService } from '../../src/server/services/sessions.js';
import { createManualClock, SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';
const HOUR = 3_600_000;

async function failure(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

async function expectDomainError(p: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  const e = await failure(p);
  expect(e.code).toBe(code);
  expect(e.httpStatus).toBe(status);
  return e;
}

describe('AccountRecoveryService', () => {
  let t: TestDb;
  let audit: AuditService;
  let sessions: SessionService;
  let auth: AuthService;
  let lifecycle: LifecycleService;
  let ownership: OwnershipService;
  let certificates: OwnershipCertificateService;
  let recovery: AccountRecoveryService;
  let admin: Actor;
  let modelId: string;
  let serial = 0;
  let n = 0;
  const clock = createManualClock('2026-10-02T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    sessions = new SessionService({ db: t.db, clock: clock.now, ttlHours: { account: 720, admin: 8 } });
    auth = new AuthService({ db: t.db, audit, sessions, clock: clock.now, totpKey: deriveTotpEncryptionKey(testConfig()) });
    lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
    ownership = new OwnershipService({ db: t.db, audit, lifecycle, clock: clock.now, transferKey: new Uint8Array(32).fill(7) });
    certificates = new OwnershipCertificateService({ db: t.db, audit, ownership, publicOrigin: 'https://verify.orbes.test', clock: clock.now });
    recovery = new AccountRecoveryService({ db: t.db, audit, sessions, ownership, clock: clock.now });
    const a = await auth.createAdmin({ email: 'cs@orbes.test', password: PASSWORD, role: 'ADMIN' }, SYSTEM_ACTOR);
    admin = { type: 'admin', id: a.id, ipHash: 'ip-admin' };
    await t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry', warranty_months: 24 }).execute();
    modelId = (
      await t.db.insertInto('models').values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON' }).returning('id').executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(() => t.close());

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function customer() {
    const email = `client.${++n}@Example.com`;
    const reg = await auth.registerAccount({ email, password: PASSWORD }, {});
    return { id: reg.account.id, email, session: reg.session, actor: { type: 'account', id: reg.account.id } as Actor };
  }

  /** A piece owned by `owner` (first registration from a scan token). */
  async function ownedBy(owner: { id: string; actor: Actor }, path: ProductStatus[] = ['ACTIVATED']) {
    const s = ++serial;
    const productId = `O26-J-${String(s).padStart(5, '0')}`;
    const row = await t.db
      .insertInto('products')
      .values({
        product_id: productId,
        packed_identity: (26 << 25) | (1 << 20) | s,
        year: 2026,
        category_id: 1,
        serial: s,
        sku: `MON-${s}`,
        model_id: modelId,
        material: '925 STERLING SILVER',
        created_at: clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db.insertInto('product_status_history').values({ product_id: row.id, from_status: null, to_status: 'ISSUED', actor_type: 'system', created_at: clock.now() }).execute();
    for (const step of path) await lifecycle.transition(productId, step, {}, admin);
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: row.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_FIRST_REGISTRATION', occurred_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { token } = await createScanToken(t.db, { productId: row.id, scanEventId: scan.id, now: clock.now() });
    await ownership.registerFirst(owner.id, { registrationToken: token }, owner.actor);
    return { id: row.id, productId };
  }

  /** F-03: `who` scans the piece, signed in, then enters the transfer code with that scan. */
  async function receive(who: { id: string; actor: Actor }, transferCode: string, piece: { id: string; productId: string }) {
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: piece.id, account_id: who.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_REGISTERED', occurred_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { token } = await createScanToken(t.db, { productId: piece.id, scanEventId: scan.id, purpose: 'TRANSFER_ACCEPT', now: clock.now() });
    return ownership.acceptTransfer(who.id, { transferCode, productId: piece.productId, transferToken: token }, who.actor);
  }

  const codeRows = (accountId: string) => t.db.selectFrom('account_recovery_codes').selectAll().where('account_id', '=', accountId).orderBy('created_at').execute();
  const accountRow = (id: string) => t.db.selectFrom('accounts').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  // ── issue ─────────────────────────────────────────────────────────────────

  describe('issue', () => {
    it('returns a 12-character Crockford code once, valid 30 minutes, and stores only its scrypt hash', async () => {
      const c = await customer();
      const issued = await recovery.issue(c.id, admin);
      expect(issued.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(issued.expiresAt.getTime()).toBe(clock.now().getTime() + RECOVERY_CODE_TTL_MS);
      expect(RECOVERY_CODE_TTL_MS).toBe(30 * 60_000);
      const [row] = await codeRows(c.id);
      expect(row).toMatchObject({ created_by: admin.id, used_at: null, revoked_at: null });
      expect(row.code_hash).toMatch(/^scrypt\$15\$8\$1\$/);
      expect(row.code_hash).not.toContain(normalizeClaimCode(issued.recoveryCode)!);
      expect(await verifySecret(normalizeClaimCode(issued.recoveryCode)!, row.code_hash)).toBe(true);
      // Audited with the account id and the code's id, never the code or the email.
      const entry = (await audit.list({ action: 'account.recovery_code.issue', targetId: c.id })).items[0];
      expect(entry).toMatchObject({ actorType: 'admin', actorId: admin.id, targetType: 'account', details: { recoveryCodeId: row.id, replaced: 0 } });
      expect(JSON.stringify(entry)).not.toContain(normalizeClaimCode(issued.recoveryCode)!);
      expect(JSON.stringify(entry)).not.toContain(issued.recoveryCode);
      expect(JSON.stringify(entry)).not.toMatch(/example\.com/i);
    });

    it('keeps one open code per account: a new one revokes the previous one, which then fails', async () => {
      const c = await customer();
      const first = await recovery.issue(c.id, admin);
      const second = await recovery.issue(c.id, admin);
      const rows = await codeRows(c.id);
      expect(rows.map((r) => r.revoked_at !== null)).toEqual([true, false]);
      expect((await audit.list({ action: 'account.recovery_code.issue', targetId: c.id })).items[0].details).toMatchObject({ replaced: 1 });
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode: first.recoveryCode, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
      await recovery.recover({ email: c.email, recoveryCode: second.recoveryCode, newPassword: NEW_PASSWORD });
    });

    it('is for an ADMIN, and an ACTIVE account only', async () => {
      const c = await customer();
      await expectDomainError(recovery.issue(c.id, { type: 'account', id: c.id }), 'FORBIDDEN', 403);
      await expectDomainError(recovery.issue(c.id, SYSTEM_ACTOR), 'FORBIDDEN', 403);
      await expectDomainError(recovery.issue('5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', admin), 'ACCOUNT_NOT_FOUND', 404);
      await expectDomainError(recovery.issue('not-a-uuid', admin), 'ACCOUNT_NOT_FOUND', 404);
      await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', c.id).execute();
      await expectDomainError(recovery.issue(c.id, admin), 'ACCOUNT_NOT_ACTIVE', 409);
      expect(await codeRows(c.id)).toEqual([]);
    });
  });

  // ── recover ───────────────────────────────────────────────────────────────

  describe('recover', () => {
    it('sets the new password, revokes every session, cancels pending transfers and uses the code', async () => {
      const c = await customer();
      const other = await auth.login({ email: c.email, password: PASSWORD }, {});
      const piece = await ownedBy(c);
      const offer = await ownership.initiateTransfer(c.id, piece.productId, c.actor);
      expect((await t.db.selectFrom('products').select('ownership_state').where('id', '=', piece.id).executeTakeFirstOrThrow()).ownership_state).toBe('TRANSFER_PENDING');
      const { recoveryCode } = await recovery.issue(c.id, admin);

      clock.advance(5 * 60_000);
      const r = await recovery.recover({ email: ` ${c.email.toUpperCase()} `, recoveryCode: recoveryCode.toLowerCase().replace(/-/g, ' '), newPassword: NEW_PASSWORD }, { ipHash: 'ip-client' });
      expect(r).toMatchObject({ accountId: c.id, sessionsRevoked: 2 });
      expect(r.transfersCancelled).toHaveLength(1);
      expect(r.transfersFrozenUntil.getTime()).toBe(clock.now().getTime() + TRANSFER_FREEZE_MS);

      // Sessions: both gone. Password: the new one only.
      expect(await auth.authenticateAccount(c.session.token)).toBeNull();
      expect(await auth.authenticateAccount(other.session.token)).toBeNull();
      await expectDomainError(auth.login({ email: c.email, password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);

      // The pending transfer is cancelled and its code no longer completes.
      const transfer = await t.db.selectFrom('ownership_transfers').selectAll().where('id', '=', r.transfersCancelled[0]).executeTakeFirstOrThrow();
      expect(transfer.status).toBe('CANCELLED');
      expect((await t.db.selectFrom('products').select('ownership_state').where('id', '=', piece.id).executeTakeFirstOrThrow()).ownership_state).toBe('REGISTERED');
      const stranger = await customer();
      await expectDomainError(receive(stranger, offer.transferCode, piece), 'TRANSFER_CANCELLED', 410);

      // The code is used, once.
      expect((await codeRows(c.id))[0].used_at?.getTime()).toBe(clock.now().getTime());
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode, newPassword: 'yet another passphrase' }), 'RECOVERY_CODE_INVALID', 400);

      // Audited by the account, without the code or the email.
      const entry = (await audit.list({ action: 'account.recover', targetId: c.id })).items[0];
      expect(entry).toMatchObject({ actorType: 'account', actorId: c.id, ipHash: 'ip-client', details: { sessionsRevoked: 2, transfersCancelled: 1 } });
      expect(JSON.stringify(entry)).not.toContain(normalizeClaimCode(recoveryCode)!);
      const cancel = (await audit.list({ action: 'ownership.transfer.cancel', targetId: piece.productId })).items[0];
      expect(cancel.details).toMatchObject({ transferId: transfer.id, reason: 'account_recovery' });
    });

    it('withdraws the open links to ownership certificates of the account (F-06), audited before the recovery itself', async () => {
      const c = await customer();
      const piece = await ownedBy(c);
      const links = [await certificates.create(c.id, piece.productId, {}, c.actor), await certificates.create(c.id, piece.productId, { validDays: 90 }, c.actor)];
      const neighbour = await customer();
      const theirs = await certificates.create(neighbour.id, (await ownedBy(neighbour)).productId, {}, neighbour.actor);
      const { recoveryCode } = await recovery.issue(c.id, admin);
      const before = (await t.db.selectFrom('audit_logs').select((eb) => eb.fn.max('id').as('id')).executeTakeFirstOrThrow()).id;

      const r = await recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }, { ipHash: 'ip-client' });
      expect(r.certificatesRevoked).toBe(2);
      for (const link of links) await expectDomainError(certificates.lookup(link.token), 'CERTIFICATE_NOT_FOUND', 404);
      expect((await certificates.lookup(theirs.token)).status).toBe('VALID');
      expect(await certificates.listForAccount(c.id)).toEqual([]);
      // One entry per link, by the account, with the reason; then the recovery's, which counts them.
      const entries = await t.db.selectFrom('audit_logs').select(['action', 'actor_id', 'target_id', 'details']).where('id', '>', Number(before)).orderBy('id').execute();
      expect(entries.map((e) => e.action)).toEqual(['ownership.certificate.revoke', 'ownership.certificate.revoke', 'account.recover']);
      expect(new Set(entries.slice(0, 2).map((e) => (e.details as { certificateId: string }).certificateId))).toEqual(new Set(links.map((l) => l.id)));
      for (const e of entries.slice(0, 2)) expect(e).toMatchObject({ actor_id: c.id, target_id: piece.productId, details: { reason: 'account_recovery' } });
      expect(entries[2].details).toMatchObject({ transfersCancelled: 0, certificatesRevoked: 2 });
      // The owner, signed in with the new password, shares a new link.
      expect((await certificates.lookup((await certificates.create(c.id, piece.productId, {}, c.actor)).token)).status).toBe('VALID');
    });

    it('gives no link to a creation still on its way with a session the recovery ended: 401, nothing created (F-06)', async () => {
      const c = await customer();
      const piece = await ownedBy(c);
      // The request passed the session guard with this session before the recovery committed.
      const before = (await sessions.validate(c.session.token, 'account'))!.id;
      const { recoveryCode } = await recovery.issue(c.id, admin);
      await recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD });
      // The account is still ACTIVE: only the session tells the request apart from the owner's.
      expect((await accountRow(c.id)).status).toBe('ACTIVE');
      await expectDomainError(certificates.create(c.id, piece.productId, { sessionId: before }, c.actor), 'UNAUTHORIZED', 401);
      expect(await t.db.selectFrom('ownership_certificates').select('id').where('product_id', '=', piece.id).execute()).toEqual([]);
      expect((await audit.list({ action: 'ownership.certificate.create', targetId: piece.productId })).items).toEqual([]);
      // Signed in again with the new password, the owner creates one.
      const after = (await sessions.validate((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).session.token, 'account'))!.id;
      const offer = await certificates.create(c.id, piece.productId, { sessionId: after }, c.actor);
      expect((await certificates.lookup(offer.token)).status).toBe('VALID');
    });

    it('pauses new transfers out of the account for 72 hours, then lets them go', async () => {
      const c = await customer();
      const piece = await ownedBy(c);
      const { recoveryCode } = await recovery.issue(c.id, admin);
      await recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD });
      const paused = await expectDomainError(ownership.initiateTransfer(c.id, piece.productId, c.actor), 'TRANSFERS_PAUSED', 409);
      expect(paused.publicMessage).toMatch(/paused until \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d UTC/);
      expect((await accountRow(c.id)).transfers_frozen_until?.getTime()).toBe(clock.now().getTime() + TRANSFER_FREEZE_MS);
      // A transfer offered TO the account is not affected (the pause protects what it holds).
      const giver = await customer();
      const gift = await ownedBy(giver);
      const offer = await ownership.initiateTransfer(giver.id, gift.productId, giver.actor);
      expect((await receive(c, offer.transferCode, gift)).accountId).toBe(c.id);

      clock.advance(TRANSFER_FREEZE_MS - 1000);
      await expectDomainError(ownership.initiateTransfer(c.id, piece.productId, c.actor), 'TRANSFERS_PAUSED', 409);
      clock.advance(1000);
      expect((await ownership.initiateTransfer(c.id, piece.productId, c.actor)).transferCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    });

    it('gives one answer, at one cost, for an unknown email and a wrong, malformed, expired or used code', async () => {
      const c = await customer();
      const { recoveryCode } = await recovery.issue(c.id, admin);
      const refusals = [
        await failure(recovery.recover({ email: 'nobody@example.com', recoveryCode, newPassword: NEW_PASSWORD })),
        await failure(recovery.recover({ email: c.email, recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword: NEW_PASSWORD })),
        await failure(recovery.recover({ email: c.email, recoveryCode: 'not a code', newPassword: NEW_PASSWORD })),
        await failure(recovery.recover({ email: 'not an email', recoveryCode, newPassword: NEW_PASSWORD })),
      ];
      clock.advance(RECOVERY_CODE_TTL_MS);
      refusals.push(await failure(recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD })));
      for (const e of refusals) expect(e.toResponse()).toEqual(refusals[0].toResponse());
      expect(refusals[0]).toMatchObject({ code: 'RECOVERY_CODE_INVALID', httpStatus: 400 });
      expect(refusals[0].publicMessage).toMatch(/ORBES Client Services/);
      // The expired code stays unused; its failures are recorded with their reason, for staff.
      expect((await codeRows(c.id))[0].used_at).toBeNull();
      const failures = (await audit.list({ action: 'account.recover_failed', targetId: c.id })).items.map((e) => e.details.reason);
      expect(failures.sort()).toEqual(['EXPIRED', 'MISMATCH']);
      // Without an open code, a known email is refused alike.
      await expectDomainError(recovery.recover({ email: (await customer()).email, recoveryCode, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
    });

    it(`stops checking codes after ${RECOVERY_ATTEMPT_LIMIT} failures in an hour, even the right one`, async () => {
      const c = await customer();
      const { recoveryCode } = await recovery.issue(c.id, admin);
      for (let i = 0; i < RECOVERY_ATTEMPT_LIMIT; i++) {
        await expectDomainError(recovery.recover({ email: c.email, recoveryCode: `ZZZZ-ZZZZ-ZZZ${i}`, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
      }
      const held = await failure(recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }));
      expect(held.toResponse()).toEqual((await failure(recovery.recover({ email: 'nobody@example.com', recoveryCode, newPassword: NEW_PASSWORD }))).toResponse());
      expect((await audit.list({ action: 'account.recover_throttled', targetId: c.id })).items[0].details).toMatchObject({ failures: RECOVERY_ATTEMPT_LIMIT });
      expect((await codeRows(c.id))[0].used_at).toBeNull();
      await expectDomainError(auth.login({ email: c.email, password: NEW_PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);

      // An hour later the budget is back; the first code has expired, a new one works.
      clock.advance(RECOVERY_ATTEMPT_WINDOW_MS);
      const again = await recovery.issue(c.id, admin);
      await recovery.recover({ email: c.email, recoveryCode: again.recoveryCode, newPassword: NEW_PASSWORD });
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);
      expect(HOUR).toBe(RECOVERY_ATTEMPT_WINDOW_MS);
    });

    it('refuses a LOCKED account and keeps the code; a weak new password costs no attempt', async () => {
      const c = await customer();
      const { recoveryCode } = await recovery.issue(c.id, admin);
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode, newPassword: 'short' }), 'VALIDATION_FAILED', 400);
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode, newPassword: c.email }), 'VALIDATION_FAILED', 400);
      expect((await audit.list({ action: 'account.recover_failed', targetId: c.id })).items).toEqual([]);

      await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', c.id).execute();
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }), 'ACCOUNT_LOCKED', 403);
      expect((await codeRows(c.id))[0].used_at).toBeNull();
      expect(await auth.authenticateAccount(c.session.token)).toBeNull(); // a LOCKED account's sessions stop anyway
      expect((await accountRow(c.id)).transfers_frozen_until).toBeNull();

      // A DELETED account reads as unknown.
      await t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', c.id).execute();
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
    });

    it('clears the login throttle, so the customer signs in at once', async () => {
      const c = await customer();
      for (let i = 0; i < 10; i++) await expectDomainError(auth.login({ email: c.email, password: `wrong password ${i}` }, {}), 'INVALID_CREDENTIALS', 401);
      const { recoveryCode } = await recovery.issue(c.id, admin);
      await recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD });
      expect(await accountRow(c.id)).toMatchObject({ failed_logins: 0, failed_logins_since: null });
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);
    });

    it('counts only guesses at an open code: attempts without one cost a scrypt and are recorded, but spend nothing', async () => {
      const c = await customer();
      // Someone who knows the email hammers the form while no code is open.
      for (let i = 0; i < 2 * RECOVERY_ATTEMPT_LIMIT; i++) {
        await expectDomainError(recovery.recover({ email: c.email, recoveryCode: `ZZZZ-ZZZZ-ZZZ${i % 10}`, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
      }
      const recorded = (await audit.list({ action: 'account.recover_failed', targetId: c.id }, { page: 1, pageSize: 50 })).items;
      expect(recorded).toHaveLength(2 * RECOVERY_ATTEMPT_LIMIT);
      for (const e of recorded) expect(e.details).toEqual({ reason: 'NO_OPEN_CODE' });
      // The code Client Services then issues starts with the whole budget: it works at once.
      const { recoveryCode } = await recovery.issue(c.id, admin);
      await recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD });
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);
      expect(await audit.list({ action: 'account.recover_throttled', targetId: c.id })).toMatchObject({ items: [] });
    });

    it('hashes an attempt without an open code (none, or expired) only once its transaction has committed: no row lock or connection held meanwhile', async () => {
      const c = await customer();
      // Mark the body of every transaction of the service, and record, for every scrypt of an attempt (the throwaway
      // hash of burnTime), whether it runs inside the body of the attempt's own transaction.
      const inTx = new AsyncLocalStorage<true>();
      const begin = t.db.transaction.bind(t.db);
      const spy = vi.spyOn(t.db, 'transaction').mockImplementation(() => {
        const builder = begin();
        return {
          execute: <R>(fn: Parameters<typeof builder.execute<R>>[0]) => builder.execute((trx) => inTx.run(true, () => fn(trx))),
        } as unknown as ReturnType<typeof begin>;
      });
      const burns: boolean[] = [];
      const internals = recovery as unknown as { burnTime: (code: string | undefined) => Promise<void> };
      const burnTime = internals.burnTime.bind(recovery);
      const burn = vi.spyOn(internals, 'burnTime').mockImplementation(async (code) => {
        burns.push(inTx.getStore() === true);
        await burnTime(code);
      });
      try {
        // A burst naming one known email while no code is open (the account's usual state), then once a code expired.
        const burst = await Promise.allSettled(
          Array.from({ length: 6 }, (_, i) => recovery.recover({ email: c.email, recoveryCode: `ZZZZ-ZZZZ-ZZZ${i}`, newPassword: NEW_PASSWORD })),
        );
        expect(burst.every((r) => r.status === 'rejected' && (r.reason as DomainError).code === 'RECOVERY_CODE_INVALID')).toBe(true);
        await recovery.issue(c.id, admin);
        clock.advance(RECOVERY_CODE_TTL_MS);
        await expectDomainError(recovery.recover({ email: c.email, recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
        // Each paid its scrypt, outside every transaction; each was recorded, with its reason.
        expect(burns).toEqual(Array.from({ length: 7 }, () => false));
        const reasons = (await audit.list({ action: 'account.recover_failed', targetId: c.id }, { page: 1, pageSize: 50 })).items.map((e) => e.details.reason);
        expect(reasons.sort()).toEqual(['EXPIRED', ...Array.from({ length: 6 }, () => 'NO_OPEN_CODE')]);
      } finally {
        burn.mockRestore();
        spy.mockRestore();
      }
      // Meanwhile, and afterwards, the customer still signs in.
      expect((await auth.login({ email: c.email, password: PASSWORD }, {})).account.id).toBe(c.id);
    });

    it('throttles one code after its wrong guesses; a new code starts afresh, and the console says until when', async () => {
      const c = await customer();
      const first = await recovery.issue(c.id, admin);
      const firstId = (await codeRows(c.id))[0].id;
      for (let i = 0; i < RECOVERY_ATTEMPT_LIMIT; i++) {
        clock.advance(60_000);
        await expectDomainError(recovery.recover({ email: c.email, recoveryCode: `ZZZZ-ZZZZ-ZZZ${i}`, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
      }
      const guesses = (await audit.list({ action: 'account.recover_failed', targetId: c.id })).items;
      expect(guesses.map((e) => e.details).reverse()).toEqual([1, 2, 3, 4, 5].map((attempt) => ({ recoveryCodeId: firstId, attempt, reason: 'MISMATCH' })));
      await expectDomainError(recovery.recover({ email: c.email, recoveryCode: first.recoveryCode, newPassword: NEW_PASSWORD }), 'RECOVERY_CODE_INVALID', 400);
      expect((await audit.list({ action: 'account.recover_throttled', targetId: c.id })).items[0].details).toEqual({ recoveryCodeId: firstId, failures: RECOVERY_ATTEMPT_LIMIT });
      // The sheet shows the throttle: until the first of the five guesses is an hour old.
      const owners = new OwnerService({ db: t.db, audit, sessions, ownership, clock: clock.now });
      const throttledUntil = new Date(guesses.at(-1)!.occurredAt.getTime() + RECOVERY_ATTEMPT_WINDOW_MS);
      expect((await owners.sheet(c.id)).owner).toMatchObject({ recoveryCodeExpiresAt: first.expiresAt, recoveryCodeThrottledUntil: throttledUntil });

      // Client Services issues a new code: it works at once, whatever the guesses at the old one.
      const second = await recovery.issue(c.id, admin);
      expect((await owners.sheet(c.id)).owner).toMatchObject({ recoveryCodeExpiresAt: second.expiresAt, recoveryCodeThrottledUntil: null });
      await recovery.recover({ email: c.email, recoveryCode: second.recoveryCode, newPassword: NEW_PASSWORD });
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);
    });

    /** Run `during` (committed) just before the next transaction of the services begins its body. */
    async function interleaved<T>(during: () => Promise<unknown>, request: () => Promise<T>): Promise<T> {
      const begin = t.db.transaction.bind(t.db);
      const spy = vi.spyOn(t.db, 'transaction').mockImplementationOnce(() => {
        const builder = begin();
        return {
          execute: async <R>(fn: Parameters<typeof builder.execute<R>>[0]) => {
            await during();
            return builder.execute(fn);
          },
        } as unknown as ReturnType<typeof begin>;
      });
      try {
        return await request();
      } finally {
        spy.mockRestore();
      }
    }

    it('refuses a password change that was under way when a recovery committed: the recovered password stays', async () => {
      const c = await customer();
      const { recoveryCode } = await recovery.issue(c.id, admin);
      // Whoever holds a hijacked session changes the password they know; the customer's recovery commits between the
      // check of that password and the write.
      await expectDomainError(
        interleaved(
          () => recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }),
          () => auth.changePassword({ type: 'account', id: c.id }, { currentPassword: PASSWORD, newPassword: 'the taker’s passphrase' }, c.actor, { keepToken: c.session.token }),
        ),
        'UNAUTHORIZED',
        401,
      );
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);
      await expectDomainError(auth.login({ email: c.email, password: 'the taker’s passphrase' }, {}), 'INVALID_CREDENTIALS', 401);
      await expectDomainError(auth.login({ email: c.email, password: PASSWORD }, {}), 'INVALID_CREDENTIALS', 401);
      expect(await audit.list({ action: 'account.password_change', targetId: c.id })).toMatchObject({ items: [] });

      // Without a session to keep, the hash that was verified must still be the stored one.
      const d = await customer();
      const second = await recovery.issue(d.id, admin);
      await expectDomainError(
        interleaved(
          () => recovery.recover({ email: d.email, recoveryCode: second.recoveryCode, newPassword: NEW_PASSWORD }),
          () => auth.changePassword({ type: 'account', id: d.id }, { currentPassword: PASSWORD, newPassword: 'the taker’s passphrase' }, d.actor),
        ),
        'CURRENT_PASSWORD_INVALID',
        400,
      );
      expect((await auth.login({ email: d.email, password: NEW_PASSWORD }, {})).account.id).toBe(d.id);
    });

    it('opens no session for a sign-in with the old password that was under way when a recovery committed', async () => {
      const c = await customer();
      const { recoveryCode } = await recovery.issue(c.id, admin);
      await expectDomainError(
        interleaved(
          () => recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }),
          () => auth.login({ email: c.email, password: PASSWORD }, {}),
        ),
        'INVALID_CREDENTIALS',
        401,
      );
      const left = await t.db.selectFrom('sessions').select('subject_id').where('subject_id', '=', c.id).execute();
      expect(left).toEqual([]);
      expect((await auth.login({ email: c.email, password: NEW_PASSWORD }, {})).account.id).toBe(c.id);
    });

    it('lets one of two concurrent attempts with the same code through', async () => {
      const c = await customer();
      const { recoveryCode } = await recovery.issue(c.id, admin);
      const results = await Promise.allSettled([
        recovery.recover({ email: c.email, recoveryCode, newPassword: NEW_PASSWORD }),
        recovery.recover({ email: c.email, recoveryCode, newPassword: 'the other passphrase' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((refused.reason as DomainError).code).toBe('RECOVERY_CODE_INVALID');
    });
  });
});
