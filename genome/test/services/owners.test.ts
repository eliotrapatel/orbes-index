/**
 * OwnerService (A-06) and its helpers: the REF a customer reads under a
 * result, the email mask of an AUDITOR, the lock (staff only, sessions and
 * pending transfers ended and the open recovery code revoked in one
 * transaction, a transfer or a sign-in begun before the lock refused) and the
 * unlock.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { DomainError } from '../../src/server/errors.js';
import { clientEmail, maskEmail } from '../../src/server/routes/admin/serialize.js';
import { AccountRecoveryService, RECOVERY_CODE_TTL_MS } from '../../src/server/services/account-recovery.js';
import { AuditService } from '../../src/server/services/audit.js';
import { AuthService, deriveTotpEncryptionKey } from '../../src/server/services/auth.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { OwnershipService } from '../../src/server/services/ownership.js';
import { OwnerService, parseScanReference, scanReference } from '../../src/server/services/owners.js';
import { createScanToken } from '../../src/server/services/scan-tokens.js';
import { SessionService } from '../../src/server/services/sessions.js';
import { createManualClock, SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const PASSWORD = 'correct horse battery staple';

async function expectDomainError(p: Promise<unknown>, code: string, status: number): Promise<void> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
}

describe('REF and email helpers', () => {
  it('reads the REF under a result as the range of scan ids it names', () => {
    const id = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    expect(scanReference(id)).toBe('1A2B3C4D');
    const range = { from: '1a2b3c4d-0000-0000-0000-000000000000', to: '1a2b3c4d-ffff-ffff-ffff-ffffffffffff' };
    for (const spelled of ['1A2B3C4D', '1a2b3c4d', 'REF 1A2B3C4D', 'ref:1a2b3c4d', '  REF1A2B3C4D ']) expect(parseScanReference(spelled), spelled).toEqual(range);
    expect(parseScanReference(id.toUpperCase())).toEqual({ from: id, to: id });
    for (const bad of ['', '1A2B3C4', '1A2B3C4D5', 'GGGGGGGG', 'REF', '1a2b3c4d-5e6f', null, 42]) expect(parseScanReference(bad), String(bad)).toBeUndefined();
  });

  it('masks an email as its first character and its domain', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com');
    expect(maskEmail('Élodie@exemple.fr')).toBe('É***@exemple.fr');
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(clientEmail('jane@example.com', true)).toBe('jane@example.com');
    expect(clientEmail('jane@example.com', false)).toBe('j***@example.com');
  });
});

describe('OwnerService', () => {
  let t: TestDb;
  let audit: AuditService;
  let sessions: SessionService;
  let auth: AuthService;
  let lifecycle: LifecycleService;
  let ownership: OwnershipService;
  let owners: OwnerService;
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
    owners = new OwnerService({ db: t.db, audit, sessions, ownership, clock: clock.now });
    recovery = new AccountRecoveryService({ db: t.db, audit, sessions, ownership, clock: clock.now });
    const a = await auth.createAdmin({ email: 'cs@orbes.test', password: PASSWORD, role: 'ADMIN' }, SYSTEM_ACTOR);
    admin = { type: 'admin', id: a.id, ipHash: 'ip-admin' };
    await t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry', warranty_months: 24 }).execute();
    modelId = (
      await t.db.insertInto('models').values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON' }).returning('id').executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(() => t.close());

  async function customer() {
    const reg = await auth.registerAccount({ email: `client.${++n}@example.com`, password: PASSWORD }, {});
    return { id: reg.account.id, token: reg.session.token, actor: { type: 'account', id: reg.account.id } as Actor };
  }

  /** A piece owned by `owner` (first registration from a scan token). */
  async function ownedBy(owner: { id: string; actor: Actor }): Promise<string> {
    const s = ++serial;
    const productId = `O26-J-${String(s).padStart(5, '0')}`;
    const row = await t.db
      .insertInto('products')
      .values({ product_id: productId, packed_identity: (26 << 25) | (1 << 20) | s, year: 2026, category_id: 1, serial: s, sku: `MON-${s}`, model_id: modelId, material: '925 STERLING SILVER', created_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db.insertInto('product_status_history').values({ product_id: row.id, from_status: null, to_status: 'ISSUED', actor_type: 'system', created_at: clock.now() }).execute();
    await lifecycle.transition(productId, 'ACTIVATED', {}, admin);
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: row.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_FIRST_REGISTRATION', occurred_at: clock.now(), account_id: owner.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { token } = await createScanToken(t.db, { productId: row.id, scanEventId: scan.id, now: clock.now() });
    await ownership.registerFirst(owner.id, { registrationToken: token }, owner.actor);
    return productId;
  }

  const status = async (id: string) => (await t.db.selectFrom('accounts').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

  it('locks in one transaction: sessions end and pending transfers are cancelled; only staff may', async () => {
    const c = await customer();
    const piece = await ownedBy(c);
    const offer = await ownership.initiateTransfer(c.id, piece, c.actor);
    await expectDomainError(owners.lock(c.id, c.actor), 'FORBIDDEN', 403);
    await expectDomainError(owners.lock(c.id, SYSTEM_ACTOR), 'FORBIDDEN', 403);

    const r = await owners.lock(c.id, admin);
    expect(r.sessionsRevoked).toBe(1);
    expect(r.transfersCancelled).toHaveLength(1);
    expect(await status(c.id)).toBe('LOCKED');
    expect(await auth.authenticateAccount(c.token)).toBeNull();
    const t1 = await t.db.selectFrom('ownership_transfers').select(['status']).where('id', '=', r.transfersCancelled[0]).executeTakeFirstOrThrow();
    expect(t1.status).toBe('CANCELLED');
    const other = await customer();
    await expectDomainError(ownership.acceptTransfer(other.id, offer.transferCode, other.actor), 'TRANSFER_CANCELLED', 410);
    // The pieces stay registered to the account.
    expect((await owners.sheet(c.id)).pieces.map((p) => [p.productId, p.until])).toEqual([[piece, null]]);
  });

  it('refuses a transfer begun by a request that was on its way when the lock took effect', async () => {
    const c = await customer();
    const piece = await ownedBy(c);
    await owners.lock(c.id, admin);
    // The session guard ran before the lock; the service re-reads the account under its row lock.
    await expectDomainError(ownership.initiateTransfer(c.id, piece, c.actor), 'ACCOUNT_LOCKED', 403);
    await owners.unlock(c.id, admin);
    expect((await ownership.initiateTransfer(c.id, piece, c.actor)).transferCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('refuses a sign-in whose password check was under way when the lock committed, after the unlock too', async () => {
    const c = await customer();
    const email = `client.${n}@example.com`;
    // The lock commits after login has read the account and checked the password, before it opens the session.
    const begin = t.db.transaction.bind(t.db);
    const spy = vi.spyOn(t.db, 'transaction').mockImplementationOnce(() => {
      const builder = begin();
      return {
        execute: async <T>(fn: Parameters<typeof builder.execute<T>>[0]) => {
          await owners.lock(c.id, admin);
          return builder.execute(fn);
        },
      } as unknown as ReturnType<typeof begin>;
    });
    try {
      await expectDomainError(auth.login({ email, password: PASSWORD }), 'ACCOUNT_LOCKED', 403);
    } finally {
      spy.mockRestore();
    }
    expect(await status(c.id)).toBe('LOCKED');
    const left = async () => (await t.db.selectFrom('sessions').select('subject_id').where('subject_id', '=', c.id).execute()).length;
    expect(await left()).toBe(0);
    // Nothing comes back with the unlock: the client signs in again, with a session of their own.
    await owners.unlock(c.id, admin);
    expect(await left()).toBe(0);
    expect((await auth.login({ email, password: PASSWORD })).account.id).toBe(c.id);
    expect(await left()).toBe(1);
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

  it('refuses a password change whose password check was under way when the lock committed, after the unlock too', async () => {
    const c = await customer();
    const email = `client.${n}@example.com`;
    // The lock commits after the change has checked the current password and hashed the new one, before it writes.
    await expectDomainError(
      interleaved(
        () => owners.lock(c.id, admin),
        () => auth.changePassword({ type: 'account', id: c.id }, { currentPassword: PASSWORD, newPassword: 'the taker’s new passphrase' }, c.actor, { keepToken: c.token }),
      ),
      'ACCOUNT_LOCKED',
      403,
    );
    expect(await audit.list({ action: 'account.password_change', targetId: c.id })).toMatchObject({ items: [] });
    // The password is the client's own: after the unlock it signs in, the taker's does not.
    await owners.unlock(c.id, admin);
    await expectDomainError(auth.login({ email, password: 'the taker’s new passphrase' }), 'INVALID_CREDENTIALS', 401);
    expect((await auth.login({ email, password: PASSWORD })).account.id).toBe(c.id);
  });

  it('refuses a LOST or STOLEN declaration that was on its way when the lock took effect', async () => {
    const c = await customer();
    const piece = await ownedBy(c);
    await owners.lock(c.id, admin);
    // The session guard ran before the lock; the service re-reads the account under its row lock, as for a transfer.
    await expectDomainError(ownership.reportIncident(c.id, piece, 'STOLEN', c.actor), 'ACCOUNT_LOCKED', 403);
    expect((await owners.sheet(c.id)).pieces[0].status).toBe('REGISTERED');
    await owners.unlock(c.id, admin);
    expect((await ownership.reportIncident(c.id, piece, 'LOST', c.actor)).to).toBe('LOST');
  });

  it('cancels every pending transfer of the account, and audits them once every piece is locked', async () => {
    const c = await customer();
    const pieces = [await ownedBy(c), await ownedBy(c), await ownedBy(c)];
    for (const piece of pieces) await ownership.initiateTransfer(c.id, piece, c.actor);
    const before = (await t.db.selectFrom('audit_logs').select((eb) => eb.fn.max('id').as('id')).executeTakeFirstOrThrow()).id;
    const r = await owners.lock(c.id, admin);
    expect(r.transfersCancelled).toHaveLength(3);
    const states = await t.db.selectFrom('products').select('ownership_state').where('product_id', 'in', pieces).execute();
    expect(states.map((s) => s.ownership_state)).toEqual(['REGISTERED', 'REGISTERED', 'REGISTERED']);
    // One entry per cancelled transfer, then the lock's: the audit chain is taken after the last product lock.
    const entries = await t.db.selectFrom('audit_logs').select(['action', 'target_id', 'details']).where('id', '>', Number(before)).orderBy('id').execute();
    expect(entries.map((e) => e.action)).toEqual(['ownership.transfer.cancel', 'ownership.transfer.cancel', 'ownership.transfer.cancel', 'account.lock']);
    expect(entries.slice(0, 3).map((e) => e.target_id).sort()).toEqual([...pieces].sort());
    expect(new Set(entries.slice(0, 3).map((e) => (e.details as { transferId: string }).transferId))).toEqual(new Set(r.transfersCancelled));
    for (const e of entries.slice(0, 3)) expect(e.details).toMatchObject({ reason: 'account_locked' });
  });

  it('revokes the open recovery code: a code handed out before the lock does not work after the unlock', async () => {
    const c = await customer();
    const email = `client.${n}@example.com`;
    const { recoveryCode } = await recovery.issue(c.id, admin);
    const r = await owners.lock(c.id, admin);
    expect(r.recoveryCodesRevoked).toBe(1);
    expect((await owners.sheet(c.id)).owner.recoveryCodeExpiresAt).toBeNull();
    await owners.unlock(c.id, admin);
    await expectDomainError(recovery.recover({ email, recoveryCode, newPassword: 'a brand new passphrase' }), 'RECOVERY_CODE_INVALID', 400);
    // A code that has already expired is left as it was: the lock revokes only one that still works.
    await recovery.issue(c.id, admin);
    clock.advance(RECOVERY_CODE_TTL_MS);
    expect((await owners.lock(c.id, admin)).recoveryCodesRevoked).toBe(0);
    const entries = await audit.list({ action: 'account.lock', targetId: c.id });
    expect(entries.items.map((e) => e.details.recoveryCodesRevoked)).toEqual([0, 1]);
    const rows = await t.db.selectFrom('account_recovery_codes').select(['revoked_at', 'used_at']).where('account_id', '=', c.id).orderBy('created_at').execute();
    expect(rows.map((r) => [r.revoked_at !== null, r.used_at])).toEqual([
      [true, null],
      [false, null],
    ]);
  });

  it('locks an ACTIVE account only, unlocks a LOCKED one only, and refuses an unknown one', async () => {
    const c = await customer();
    await expectDomainError(owners.unlock(c.id, admin), 'ACCOUNT_NOT_LOCKED', 409);
    await owners.lock(c.id, admin);
    await expectDomainError(owners.lock(c.id, admin), 'ACCOUNT_ALREADY_LOCKED', 409);
    await owners.unlock(c.id, admin);
    expect(await status(c.id)).toBe('ACTIVE');
    await t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', c.id).execute();
    await expectDomainError(owners.lock(c.id, admin), 'ACCOUNT_NOT_ACTIVE', 409);
    await expectDomainError(owners.lock('5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', admin), 'ACCOUNT_NOT_FOUND', 404);
    await expectDomainError(owners.lock('not-a-uuid', admin), 'ACCOUNT_NOT_FOUND', 404);
    await expectDomainError(owners.exportData(c.id, c.actor), 'FORBIDDEN', 403);
    const audited = await audit.list({ targetType: 'account', targetId: c.id });
    expect(audited.items.map((e) => e.action).reverse()).toEqual(['account.register', 'account.lock', 'account.unlock']);
  });

  it('searches by exact email or by REF, never both', async () => {
    const c = await customer();
    const email = `client.${n}@example.com`;
    expect((await owners.list({ email: email.toUpperCase() }, { page: 1, pageSize: 50 })).items.map((o) => o.id)).toEqual([c.id]);
    await expectDomainError(owners.list({ email, ref: '1A2B3C4D' }, { page: 1, pageSize: 50 }), 'VALIDATION_FAILED', 400);
    await expectDomainError(owners.list({ email: 'client' }, { page: 1, pageSize: 50 }), 'VALIDATION_FAILED', 400);
    await expectDomainError(owners.list({ ref: 'XYZ' }, { page: 1, pageSize: 50 }), 'VALIDATION_FAILED', 400);
    const scanner = await customer();
    await ownedBy(scanner);
    const scan = await t.db.selectFrom('scan_events').select('id').where('account_id', '=', scanner.id).executeTakeFirstOrThrow();
    const byRef = await owners.list({ ref: scanReference(scan.id) }, { page: 1, pageSize: 50 });
    expect(byRef.scans).toEqual([expect.objectContaining({ scanId: scan.id, reference: scanReference(scan.id) })]);
    expect(byRef.items).toHaveLength(1);
  });
});
