/**
 * OwnerService (A-06) and its helpers: the REF a customer reads under a
 * result, the email mask of an AUDITOR, the lock (staff only, sessions and
 * pending transfers ended, links to ownership certificates withdrawn and the
 * open recovery code revoked in one transaction, a transfer or a sign-in
 * begun before the lock refused) and the unlock.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { DomainError } from '../../src/server/errors.js';
import { clientEmail, maskEmail } from '../../src/server/routes/admin/serialize.js';
import { AccountRecoveryService, RECOVERY_CODE_TTL_MS } from '../../src/server/services/account-recovery.js';
import { AuditService } from '../../src/server/services/audit.js';
import { AuthService, deriveTotpEncryptionKey } from '../../src/server/services/auth.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { OwnershipCertificateService } from '../../src/server/services/ownership-certificates.js';
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
  let certificates: OwnershipCertificateService;
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
    certificates = new OwnershipCertificateService({ db: t.db, audit, ownership, publicOrigin: 'https://verify.orbes.test', clock: clock.now });
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
    const { productId, token } = await forSale(owner);
    await ownership.registerFirst(owner.id, { registrationToken: token }, owner.actor);
    return productId;
  }

  /** A piece sold and not registered yet, and the registration token of `scanner`'s scan of it. */
  async function forSale(scanner: { id: string }): Promise<{ productId: string; token: string }> {
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
      .values({ product_id: row.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_FIRST_REGISTRATION', occurred_at: clock.now(), account_id: scanner.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { token } = await createScanToken(t.db, { productId: row.id, scanEventId: scan.id, now: clock.now() });
    return { productId, token };
  }

  /** F-03: `who` scans the piece (by product id), signed in: the transfer code is then accepted with that scan. */
  async function receive(who: { id: string; actor: Actor }, transferCode: string, productId: string) {
    const piece = await t.db.selectFrom('products').select('id').where('product_id', '=', productId).executeTakeFirstOrThrow();
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: piece.id, account_id: who.id, event_type: 'VERIFY', result_state: 'AUTHENTIC_REGISTERED', occurred_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { token } = await createScanToken(t.db, { productId: piece.id, scanEventId: scan.id, purpose: 'TRANSFER_ACCEPT', now: clock.now() });
    return { transferCode, productId, transferToken: token };
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
    await expectDomainError(ownership.acceptTransfer(other.id, await receive(other, offer.transferCode, piece), other.actor), 'TRANSFER_CANCELLED', 410);
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

  it('refuses a registration whose checks were under way when the lock committed: no piece reaches a LOCKED account', async () => {
    const c = await customer();
    const { productId, token } = await forSale(c);
    // The lock commits after registerFirst has checked the token, the account and the piece, before it writes.
    await expectDomainError(
      interleaved(
        () => owners.lock(c.id, admin),
        () => ownership.registerFirst(c.id, { registrationToken: token }, c.actor),
      ),
      'ACCOUNT_LOCKED',
      403,
    );
    expect((await owners.sheet(c.id)).pieces).toEqual([]);
    const product = await t.db.selectFrom('products').select('id').where('product_id', '=', productId).executeTakeFirstOrThrow();
    expect(await t.db.selectFrom('ownership').select('id').where('product_id', '=', product.id).execute()).toEqual([]);
    // Nothing was spent: after the unlock, the same token registers the piece.
    await owners.unlock(c.id, admin);
    expect((await ownership.registerFirst(c.id, { registrationToken: token }, c.actor)).productId).toBe(productId);
  });

  it('refuses a transfer acceptance that was under way when the lock of the recipient committed', async () => {
    const seller = await customer();
    const piece = await ownedBy(seller);
    const { transferCode } = await ownership.initiateTransfer(seller.id, piece, seller.actor);
    const buyer = await customer();
    const scanned = await receive(buyer, transferCode, piece);
    await expectDomainError(
      interleaved(
        () => owners.lock(buyer.id, admin),
        () => ownership.acceptTransfer(buyer.id, scanned, buyer.actor),
      ),
      'ACCOUNT_LOCKED',
      403,
    );
    // The piece stays with its owner, the transfer still pending; after the unlock the buyer accepts it.
    expect((await owners.sheet(seller.id)).pieces.map((p) => [p.productId, p.until])).toEqual([[piece, null]]);
    expect((await owners.sheet(buyer.id)).pieces).toEqual([]);
    await owners.unlock(buyer.id, admin);
    expect((await ownership.acceptTransfer(buyer.id, scanned, buyer.actor)).productId).toBe(piece);
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

  it('withdraws the open links to ownership certificates of the account (F-06): they answer 404 for good, the others are left as they were', async () => {
    const c = await customer();
    const [a, b] = [await ownedBy(c), await ownedBy(c)];
    const open = [await certificates.create(c.id, b, {}, c.actor), await certificates.create(c.id, a, {}, c.actor), await certificates.create(c.id, a, { validDays: 7 }, c.actor)];
    const short = await certificates.create(c.id, b, { validDays: 1 }, c.actor);
    const withdrawn = await certificates.create(c.id, b, {}, c.actor);
    await certificates.revoke(c.id, withdrawn.id, c.actor);
    const neighbour = await customer();
    const theirs = await certificates.create(neighbour.id, await ownedBy(neighbour), {}, neighbour.actor);
    await ownership.initiateTransfer(c.id, a, c.actor);
    clock.advance(86_400_000);
    const revokedAt = async (id: string) => (await t.db.selectFrom('ownership_certificates').select('revoked_at').where('id', '=', id).executeTakeFirstOrThrow()).revoked_at;
    const withdrawnAt = await revokedAt(withdrawn.id);
    const before = (await t.db.selectFrom('audit_logs').select((eb) => eb.fn.max('id').as('id')).executeTakeFirstOrThrow()).id;

    const r = await owners.lock(c.id, admin);
    expect(r.certificatesRevoked).toBe(3);
    for (const link of open) {
      expect((await revokedAt(link.id))?.getTime()).toBe(clock.now().getTime());
      await expectDomainError(certificates.lookup(link.token), 'CERTIFICATE_NOT_FOUND', 404);
    }
    // An expired link, one already withdrawn and another account's are left as they were.
    expect(await revokedAt(short.id)).toBeNull();
    expect((await certificates.lookup(short.token)).status).toBe('NO_LONGER_VALID');
    expect(await revokedAt(withdrawn.id)).toEqual(withdrawnAt);
    expect((await certificates.lookup(theirs.token)).status).toBe('VALID');
    // The transfers' entries, then one per link (by piece, as the owner's own withdrawal, with the reason), then the lock's.
    const entries = await t.db.selectFrom('audit_logs').select(['action', 'actor_id', 'target_id', 'details']).where('id', '>', Number(before)).orderBy('id').execute();
    expect(entries.map((e) => e.action)).toEqual([
      'ownership.transfer.cancel',
      'ownership.certificate.revoke',
      'ownership.certificate.revoke',
      'ownership.certificate.revoke',
      'account.lock',
    ]);
    const revokes = entries.slice(1, 4);
    expect(revokes.map((e) => e.target_id)).toEqual([a, a, b]);
    expect(new Set(revokes.map((e) => (e.details as { certificateId: string }).certificateId))).toEqual(new Set(open.map((l) => l.id)));
    for (const e of revokes) {
      expect(e.actor_id).toBe(admin.id);
      expect(Object.keys(e.details as object).sort()).toEqual(['certificateId', 'reason']);
      expect(e.details).toMatchObject({ reason: 'account_locked' });
    }
    expect(entries[4].details).toMatchObject({ transfersCancelled: 1, certificatesRevoked: 3 });

    // They stay withdrawn after the unlock; the owner creates new links as before.
    await owners.unlock(c.id, admin);
    await expectDomainError(certificates.lookup(open[0].token), 'CERTIFICATE_NOT_FOUND', 404);
    expect((await certificates.listForAccount(c.id)).map((l) => l.id)).toEqual([]);
    const fresh = await certificates.create(c.id, b, {}, c.actor);
    expect((await certificates.lookup(fresh.token)).status).toBe('VALID');
    // Another account's lock withdraws its own link only; a lock with none open withdraws nothing.
    expect((await owners.lock(neighbour.id, admin)).certificatesRevoked).toBe(1);
    await expectDomainError(certificates.lookup(theirs.token), 'CERTIFICATE_NOT_FOUND', 404);
    expect((await certificates.lookup(fresh.token)).status).toBe('VALID');
    expect((await owners.lock((await customer()).id, admin)).certificatesRevoked).toBe(0);
  });

  it('withdraws a link created after the lock read its clock (committed while the lock waited for the account row) at its own creation time', async () => {
    const c = await customer();
    const piece = await ownedBy(c);
    const link = await certificates.create(c.id, piece, {}, c.actor);
    // On PostgreSQL a creation's FOR SHARE on the account can go ahead of a lock already waiting with its clock read:
    // the link then bears a later time than the lock's. Its withdrawal keeps revoked_at >= created_at (0013's CHECK).
    const later = new Date(clock.now().getTime() + 1_000);
    await t.db.updateTable('ownership_certificates').set({ created_at: later }).where('id', '=', link.id).execute();
    expect((await owners.lock(c.id, admin)).certificatesRevoked).toBe(1);
    const row = await t.db.selectFrom('ownership_certificates').select(['created_at', 'revoked_at']).where('id', '=', link.id).executeTakeFirstOrThrow();
    expect(row.revoked_at).toEqual(later);
    expect(row.created_at).toEqual(later);
    await expectDomainError(certificates.lookup(link.token), 'CERTIFICATE_NOT_FOUND', 404);
  });

  it('exports the links to ownership certificates the account created, open, ended and withdrawn, with their state and never a token (F-06)', async () => {
    const c = await customer();
    const [a, b, d] = [await ownedBy(c), await ownedBy(c), await ownedBy(c)];
    const step = () => clock.advance(1000);
    const open = await certificates.create(c.id, a, {}, c.actor);
    step();
    const withdrawn = await certificates.create(c.id, a, { validDays: 7 }, c.actor);
    step();
    await certificates.revoke(c.id, withdrawn.id, c.actor);
    const withdrawnAt = clock.now();
    step();
    const reported = await certificates.create(c.id, b, {}, c.actor);
    step();
    await ownership.reportIncident(c.id, b, 'LOST', c.actor);
    step();
    // A link of a piece the account no longer owns: it stays the account's, ended with its ownership period.
    const sold = await certificates.create(c.id, d, { validDays: 90 }, c.actor);
    step();
    const buyer = await customer();
    const offer = await ownership.initiateTransfer(c.id, d, c.actor);
    await ownership.acceptTransfer(buyer.id, await receive(buyer, offer.transferCode, d), buyer.actor);
    const theirs = await certificates.create(buyer.id, d, {}, buyer.actor);
    step();

    const x = await owners.exportData(c.id, admin);
    const row = (l: { createdAt: Date; expiresAt: Date }, productId: string, revokedAt: Date | null, status: string) => ({
      productId,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      revokedAt,
      status,
    });
    expect(x.certificates).toEqual([
      row(open, a, null, 'VALID'),
      row(withdrawn, a, withdrawnAt, 'WITHDRAWN'),
      row(reported, b, null, 'NO_LONGER_VALID'),
      row(sold, d, null, 'NO_LONGER_VALID'),
    ]);
    expect(x.notIncluded).toContain('The links to ownership certificates: only a one-way SHA-256 of their token is stored.');
    const text = JSON.stringify(x);
    for (const l of [open, withdrawn, reported, sold, theirs]) {
      expect(text).not.toContain(l.token);
      expect(text).not.toContain(l.id);
    }
    const hashes = await t.db.selectFrom('ownership_certificates').select('token_hash').execute();
    for (const { token_hash } of hashes) {
      expect(text).not.toContain(Buffer.from(token_hash).toString('hex'));
      expect(text).not.toContain(Buffer.from(token_hash).toString('base64'));
    }
    // The buyer's link is in the buyer's export, not the seller's.
    expect((await owners.exportData(buyer.id, admin)).certificates).toEqual([row(theirs, d, null, 'VALID')]);

    // Links withdrawn by the lock of the account (every one not withdrawn nor expired, of a piece it owns now, an
    // ended one too): their audit entries name the ADMIN and the piece, not the account, so the activity does not show
    // them; the list does, WITHDRAWN at the lock's time.
    const lockedAt = clock.now();
    expect((await owners.lock(c.id, admin)).certificatesRevoked).toBe(2);
    await owners.unlock(c.id, admin);
    step();
    const after = await owners.exportData(c.id, admin);
    expect(after.certificates).toEqual([
      row(open, a, lockedAt, 'WITHDRAWN'),
      row(withdrawn, a, withdrawnAt, 'WITHDRAWN'),
      row(reported, b, lockedAt, 'WITHDRAWN'),
      row(sold, d, null, 'NO_LONGER_VALID'),
    ]);
    expect(after.activity.filter((e) => e.action.startsWith('ownership.certificate.')).map((e) => [e.action, e.by, e.productId])).toEqual([
      ['ownership.certificate.create', 'account', a],
      ['ownership.certificate.create', 'account', a],
      ['ownership.certificate.revoke', 'account', a],
      ['ownership.certificate.create', 'account', b],
      ['ownership.certificate.create', 'account', d],
    ]);
    const audited = (await audit.list({ action: 'account.export', targetId: c.id })).items;
    expect(audited.map((e) => e.details.certificates)).toEqual([4, 4]);
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

/**
 * The right of access and NEW CLAIM CODE (plan NEXT LOT of 2026-10-07, §3.4): the export lists the new claim codes made
 * for the account's orders (the order, when, the status, when read), and the reading in its activity; never the code.
 */
describe('the export and the new claim codes (plan NEXT LOT §3.4)', () => {
  it('lists each new claim code of the account\'s orders, its reading in the activity, never the code', async () => {
    const { createContext } = await import('../../src/server/context.js');
    const { MemoryKeyProvider } = await import('../../src/server/keys/memory-provider.js');
    const { inTransaction } = await import('../../src/server/db/connection.js');
    const { ensureSku } = await import('../../src/server/services/stock.js');
    const { orderReference } = await import('../../src/server/services/orders.js');
    const { createAccount, liveFixtureOn } = await import('../support/live.js');
    const t = await createTestDb();
    const clock = createManualClock('2026-11-05T09:00:00.000Z');
    const ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    try {
      const f = await liveFixtureOn(ctx, clock);
      const france = (await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
      const { countPiecesIn, scanIntoParcel } = await import('../support/fulfil.js');
      const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '52'));
      const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '52', material: '925 STERLING SILVER', withClaimSecret: true }, f.admin);
      await countPiecesIn(ctx, { skuId: sku, locationId: france, productRefs: [piece.product.productId] }, f.admin);
      const buyer = await createAccount(t.db);
      const request = await t.db.insertInto('shop_requests').values({ account_id: buyer.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
      await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
      const orderId = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
      await ctx.services.orders.setTerms(orderId, { sizeLabel: '52', priceMinor: 300_000, currency: 'EUR' }, f.admin);
      // Sold: paid, its piece bound to it by the packing scan.
      await ctx.services.orders.transition(orderId, { to: 'PAID' }, f.admin);
      await scanIntoParcel(ctx, orderId, { pieces: { [orderId]: piece.product.productId } }, f.admin);
      clock.advance(60_000);
      const made = clock.now();
      await ctx.services.claimRenewals.renew(piece.product.productId, { reason: 'Card lost.', expect: 'SOLD', after: null }, f.admin);
      clock.advance(60_000);
      const { claimCode } = await ctx.services.claimRenewals.reveal(buyer.id, orderId, buyer.actor);
      const x = await ctx.services.owners.exportData(buyer.id, f.admin);
      expect(x.claimCodes).toEqual([{ order: orderReference(orderId), madeAt: made, status: 'READ', readAt: clock.now() }]);
      expect(x.activity.filter((a) => a.action === 'claim_code.read')).toEqual([{ occurredAt: clock.now(), action: 'claim_code.read', by: 'account', productId: piece.product.productId, reference: null, status: null }]);
      const text = JSON.stringify(x);
      expect(text).not.toContain(claimCode);
      expect(text).not.toContain(claimCode.replace(/-/g, ''));
      const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'account.export').executeTakeFirstOrThrow();
      expect(audit.details).toMatchObject({ claimCodes: 1 });
    } finally {
      await ctx.close();
      await t.close();
    }
  });
});
