import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import { AuditService } from '../../src/server/services/audit.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import {
  CLAIM_ATTEMPT_LIMIT,
  hashTransferCode,
  OwnershipService,
  ownershipStateFor,
  TRANSFER_TTL_MS,
} from '../../src/server/services/ownership.js';
import { createScanToken, inspectScanToken } from '../../src/server/services/scan-tokens.js';
import { WarrantyService } from '../../src/server/services/warranty.js';
import { generateClaimCode, hashClaimCode } from '../../src/server/services/claim-codes.js';
import type { ProductStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { createManualClock, type Actor } from '../../src/server/types.js';

const admin: Actor = { type: 'admin', id: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' };
const MIN = 60_000;
const HOUR = 60 * MIN;

async function expectDomainError(p: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('OwnershipService', () => {
  let t: TestDb;
  let audit: AuditService;
  let lifecycle: LifecycleService;
  let ownership: OwnershipService;
  let warranty: WarrantyService;
  let modelId: string;
  let serial = 0;
  const clock = createManualClock('2026-07-01T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
    ownership = new OwnershipService({ db: t.db, audit, lifecycle, clock: clock.now });
    warranty = new WarrantyService({ db: t.db, audit, lifecycle, clock: clock.now });
    await t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry', warranty_months: 24 }).execute();
    const col = await t.db.insertInto('collections').values({ name: 'ORBIT' }).returning('id').executeTakeFirstOrThrow();
    modelId = (
      await t.db
        .insertInto('models')
        .values({ category_id: 1, collection_id: col.id, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(() => t.close());

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function account(status: 'ACTIVE' | 'LOCKED' | 'DELETED' = 'ACTIVE') {
    const email = `owner-${randomUUID()}@example.com`;
    const row = await t.db
      .insertInto('accounts')
      .values({ email, email_normalized: email, password_hash: 'unused', status })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, email, actor: { type: 'account', id: row.id } as Actor };
  }

  async function product(opts: { path?: ProductStatus[]; claimCode?: string } = {}) {
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
        variant: 'SIZE 54',
        material: '925 STERLING SILVER',
        claim_secret_hash: opts.claimCode ? await hashClaimCode(opts.claimCode) : null,
        created_at: clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('product_status_history')
      .values({ product_id: row.id, from_status: null, to_status: 'ISSUED', actor_type: 'system', created_at: clock.now() })
      .execute();
    for (const step of opts.path ?? ['ACTIVATED']) await lifecycle.transition(productId, step, {}, admin);
    return { id: row.id, productId };
  }

  async function scanToken(productUuid: string, ttlMs?: number) {
    const scan = await t.db
      .insertInto('scan_events')
      .values({ product_id: productUuid, event_type: 'VERIFY', result_state: 'AUTHENTIC_FIRST_REGISTRATION', occurred_at: clock.now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await createScanToken(t.db, { productId: productUuid, scanEventId: scan.id, now: clock.now(), ttlMs })).token;
  }

  async function owned(opts: { claimCode?: string; path?: ProductStatus[] } = {}) {
    const p = await product(opts);
    const owner = await account();
    await ownership.registerFirst(owner.id, { registrationToken: await scanToken(p.id), claimCode: opts.claimCode }, owner.actor);
    return { p, owner };
  }

  const productRow = (id: string) => t.db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const currentRows = (id: string) => t.db.selectFrom('ownership').selectAll().where('product_id', '=', id).where('ended_at', 'is', null).execute();

  // ── registerFirst ─────────────────────────────────────────────────────────

  describe('registerFirst', () => {
    it('registers an unverified owner (no claim secret) → REGISTERED', async () => {
      const p = await product();
      const a = await account();
      const token = await scanToken(p.id);
      const r = await ownership.registerFirst(a.id, { registrationToken: token }, a.actor);
      expect(r).toMatchObject({ productId: p.productId, accountId: a.id, acquiredVia: 'FIRST_REGISTRATION', verified: false, ownershipState: 'REGISTERED' });
      expect(r.statusChange).toMatchObject({ from: 'ACTIVATED', to: 'REGISTERED' });
      expect(await productRow(p.id)).toMatchObject({ status: 'REGISTERED', ownership_state: 'REGISTERED' });
      const rows = await currentRows(p.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ account_id: a.id, acquired_via: 'FIRST_REGISTRATION', verified: false });
      expect(await inspectScanToken(t.db, token, { now: clock.now() })).toEqual({ ok: false, reason: 'USED' });
      const entry = (await audit.list({ action: 'ownership.register', targetId: p.productId })).items[0];
      expect(entry).toMatchObject({ actorType: 'account', actorId: a.id, details: { accountId: a.id, verified: false } });
    });

    it('registers a verified owner with the claim code → OWNED (any accepted spelling)', async () => {
      const code = generateClaimCode();
      const p = await product({ claimCode: code });
      const a = await account();
      const typed = code.toLowerCase().replace(/-/g, ' ');
      const r = await ownership.registerFirst(a.id, { registrationToken: await scanToken(p.id), claimCode: typed }, a.actor);
      expect(r).toMatchObject({ verified: true, ownershipState: 'OWNED' });
      expect(await productRow(p.id)).toMatchObject({ status: 'OWNED', ownership_state: 'OWNED' });
    });

    it('requires the claim code when the product has one; malformed codes are not counted', async () => {
      const code = generateClaimCode();
      const p = await product({ claimCode: code });
      const a = await account();
      const token = await scanToken(p.id);
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: token }, a.actor), 'CLAIM_CODE_REQUIRED', 400);
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: token, claimCode: '  ' }, a.actor), 'CLAIM_CODE_REQUIRED', 400);
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: token, claimCode: 'ABCD-EFGH' }, a.actor), 'CLAIM_CODE_MALFORMED', 400);
      expect((await audit.list({ action: 'ownership.claim_failed', targetId: p.productId })).total).toBe(0);
      // The token survives failed attempts: it is consumed only by a successful registration.
      expect((await inspectScanToken(t.db, token, { now: clock.now() })).ok).toBe(true);
    });

    it(`limits wrong claim codes to ${CLAIM_ATTEMPT_LIMIT} per product per hour (then 429, even for the right code)`, async () => {
      const code = generateClaimCode();
      const wrong = code.startsWith('0') ? `1${code.slice(1)}` : `0${code.slice(1)}`;
      const p = await product({ claimCode: code });
      const a = await account();
      const token = await scanToken(p.id, 3 * HOUR);
      for (let i = 1; i <= CLAIM_ATTEMPT_LIMIT; i++) {
        const e = await expectDomainError(ownership.registerFirst(a.id, { registrationToken: token, claimCode: wrong }, a.actor), 'CLAIM_CODE_INVALID', 403);
        expect(e.publicMessage).not.toContain(code);
        clock.advance(MIN);
      }
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: token, claimCode: code }, a.actor), 'RATE_LIMITED', 429);
      // Another account does not get a fresh budget: the limit is per product.
      const b = await account();
      await expectDomainError(ownership.registerFirst(b.id, { registrationToken: token, claimCode: code }, b.actor), 'RATE_LIMITED', 429);
      const failures = await audit.list({ action: 'ownership.claim_failed', targetId: p.productId });
      expect(failures.total).toBe(CLAIM_ATTEMPT_LIMIT);
      expect(JSON.stringify(failures.items)).not.toContain(code.replace(/-/g, ''));

      // The window rolls: one hour after the first failure, one attempt is available again.
      clock.advance(HOUR - CLAIM_ATTEMPT_LIMIT * MIN + 1);
      const r = await ownership.registerFirst(a.id, { registrationToken: token, claimCode: code }, a.actor);
      expect(r.verified).toBe(true);
    });

    it('serialises concurrent wrong guesses so the limit is exact', async () => {
      const code = generateClaimCode();
      const wrong = code.startsWith('0') ? `1${code.slice(1)}` : `0${code.slice(1)}`;
      const p = await product({ claimCode: code });
      const a = await account();
      const token = await scanToken(p.id);
      const results = await Promise.allSettled(
        Array.from({ length: CLAIM_ATTEMPT_LIMIT + 3 }, () => ownership.registerFirst(a.id, { registrationToken: token, claimCode: wrong }, a.actor)),
      );
      const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as DomainError).code : 'OK'));
      expect(codes.filter((c) => c === 'CLAIM_CODE_INVALID')).toHaveLength(CLAIM_ATTEMPT_LIMIT);
      expect(codes.filter((c) => c === 'RATE_LIMITED')).toHaveLength(3);
    });

    it('rejects unknown, malformed, used and expired registration tokens', async () => {
      const p = await product();
      const a = await account();
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: 'nope' }, a.actor), 'REGISTRATION_TOKEN_INVALID', 400);
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: 'A'.repeat(43) }, a.actor), 'REGISTRATION_TOKEN_INVALID', 400);
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: '' }, a.actor), 'VALIDATION_FAILED', 400);

      const expiring = await scanToken(p.id, 15 * MIN);
      clock.advance(15 * MIN);
      await expectDomainError(ownership.registerFirst(a.id, { registrationToken: expiring }, a.actor), 'REGISTRATION_TOKEN_EXPIRED', 410);

      const token = await scanToken(p.id);
      await ownership.registerFirst(a.id, { registrationToken: token }, a.actor);
      const b = await account();
      await expectDomainError(ownership.registerFirst(b.id, { registrationToken: token }, b.actor), 'REGISTRATION_TOKEN_USED', 409);
    });

    it('refuses a product that already has an owner, leaving the second token unused', async () => {
      const { p } = await owned();
      const b = await account();
      const token = await scanToken(p.id);
      await expectDomainError(ownership.registerFirst(b.id, { registrationToken: token }, b.actor), 'ALREADY_REGISTERED', 409);
      expect((await inspectScanToken(t.db, token, { now: clock.now() })).ok).toBe(true);
      expect(await currentRows(p.id)).toHaveLength(1);
    });

    it('only one of two concurrent first registrations wins', async () => {
      const p = await product();
      const [a, b] = [await account(), await account()];
      const [ta, tb] = [await scanToken(p.id), await scanToken(p.id)];
      const results = await Promise.allSettled([
        ownership.registerFirst(a.id, { registrationToken: ta }, a.actor),
        ownership.registerFirst(b.id, { registrationToken: tb }, b.actor),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as DomainError).code).toBe('ALREADY_REGISTERED');
      expect(await currentRows(p.id)).toHaveLength(1);
    });

    it('refuses statuses that are not open for registration, without revealing them', async () => {
      for (const path of [[], ['LOST'], ['REVOKED'], ['COUNTERFEIT_FLAGGED'], ['ACTIVATED', 'RETIRED']] as ProductStatus[][]) {
        const p = await product({ path });
        const a = await account();
        const e = await expectDomainError(ownership.registerFirst(a.id, { registrationToken: await scanToken(p.id) }, a.actor), 'REGISTRATION_NOT_ALLOWED', 409);
        expect(e.publicMessage).not.toMatch(/ISSUED|LOST|REVOKED|COUNTERFEIT|RETIRED/);
      }
    });

    it('registers from RESOLD, and from SERVICED even when the pre-service status was ACTIVATED', async () => {
      const resold = await product({ path: ['ACTIVATED', 'RESOLD'] });
      const a = await account();
      expect((await ownership.registerFirst(a.id, { registrationToken: await scanToken(resold.id) }, a.actor)).statusChange?.to).toBe('REGISTERED');

      const serviced = await product({ path: ['ACTIVATED', 'SERVICED'] });
      const b = await account();
      const r = await ownership.registerFirst(b.id, { registrationToken: await scanToken(serviced.id) }, b.actor);
      expect(r.statusChange).toMatchObject({ from: 'SERVICED', to: 'REGISTERED' });
    });

    it('refuses inactive accounts and invalid account ids', async () => {
      const p = await product();
      const locked = await account('LOCKED');
      await expectDomainError(ownership.registerFirst(locked.id, { registrationToken: await scanToken(p.id) }, locked.actor), 'FORBIDDEN', 403);
      await expectDomainError(ownership.registerFirst('nope', { registrationToken: await scanToken(p.id) }, locked.actor), 'VALIDATION_FAILED', 400);
    });
  });

  // ── transfers ─────────────────────────────────────────────────────────────

  describe('transfers', () => {
    it('initiate → accept moves ownership, carries `verified` over and sets TRANSFERRED', async () => {
      const code = generateClaimCode();
      const { p, owner } = await owned({ claimCode: code });
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      expect(offer.transferCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(offer.expiresAt.getTime() - clock.now().getTime()).toBe(TRANSFER_TTL_MS);
      expect(await productRow(p.id)).toMatchObject({ ownership_state: 'TRANSFER_PENDING', status: 'OWNED' });

      // Only the hash is stored.
      const tr = await t.db.selectFrom('ownership_transfers').selectAll().where('product_id', '=', p.id).executeTakeFirstOrThrow();
      expect(Buffer.from(tr.token_hash).equals(Buffer.from(hashTransferCode(offer.transferCode)!))).toBe(true);
      expect(JSON.stringify(tr)).not.toContain(offer.transferCode.replace(/-/g, ''));
      expect(JSON.stringify((await audit.list({ targetId: p.productId })).items)).not.toContain(offer.transferCode.replace(/-/g, ''));
      expect((await ownership.currentOwner(p.productId))?.transferPending).toBe(true);

      const buyer = await account();
      clock.advance(HOUR);
      const r = await ownership.acceptTransfer(buyer.id, offer.transferCode.toLowerCase().replace(/-/g, ''), buyer.actor);
      expect(r).toMatchObject({ productId: p.productId, accountId: buyer.id, acquiredVia: 'TRANSFER', verified: true, ownershipState: 'OWNED' });
      expect(r.statusChange).toMatchObject({ from: 'OWNED', to: 'TRANSFERRED' });
      expect(await productRow(p.id)).toMatchObject({ status: 'TRANSFERRED', ownership_state: 'OWNED' });

      const all = await t.db.selectFrom('ownership').selectAll().where('product_id', '=', p.id).orderBy('started_at').execute();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ account_id: owner.id, ended_reason: 'TRANSFERRED_OUT' });
      expect(all[0].ended_at?.toISOString()).toBe(clock.now().toISOString());
      expect(all[1]).toMatchObject({ account_id: buyer.id, acquired_via: 'TRANSFER', verified: true, ended_at: null });
      const done = await t.db.selectFrom('ownership_transfers').selectAll().where('id', '=', tr.id).executeTakeFirstOrThrow();
      expect(done).toMatchObject({ status: 'ACCEPTED', to_account_id: buyer.id });

      await expectDomainError(ownership.acceptTransfer((await account()).id, offer.transferCode, admin), 'TRANSFER_ALREADY_ACCEPTED', 409);

      // TRANSFERRED → TRANSFERRED: the new owner can pass it on again.
      const next = await ownership.initiateTransfer(buyer.id, p.productId, buyer.actor);
      const third = await account();
      expect((await ownership.acceptTransfer(third.id, next.transferCode, third.actor)).statusChange).toMatchObject({ from: 'TRANSFERRED', to: 'TRANSFERRED' });
    });

    it('an unverified owner hands over an unverified ownership (REGISTERED)', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      const buyer = await account();
      const r = await ownership.acceptTransfer(buyer.id, offer.transferCode, buyer.actor);
      expect(r).toMatchObject({ verified: false, ownershipState: 'REGISTERED' });
    });

    it('only the current owner can initiate; one pending transfer at a time', async () => {
      const { p, owner } = await owned();
      const stranger = await account();
      await expectDomainError(ownership.initiateTransfer(stranger.id, p.productId, stranger.actor), 'NOT_OWNER', 403);
      const unowned = await product();
      await expectDomainError(ownership.initiateTransfer(owner.id, unowned.productId, owner.actor), 'NOT_OWNER', 403);
      await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      await expectDomainError(ownership.initiateTransfer(owner.id, p.productId, owner.actor), 'TRANSFER_ALREADY_PENDING', 409);
      const pending = await t.db.selectFrom('ownership_transfers').select('id').where('product_id', '=', p.id).where('status', '=', 'PENDING').execute();
      expect(pending).toHaveLength(1);
    });

    it('the current owner cannot accept their own transfer', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      await expectDomainError(ownership.acceptTransfer(owner.id, offer.transferCode, owner.actor), 'CANNOT_ACCEPT_OWN_TRANSFER', 409);
      expect((await currentRows(p.id))[0].account_id).toBe(owner.id);
    });

    it('expired transfers cannot be accepted and release TRANSFER_PENDING', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      clock.advance(TRANSFER_TTL_MS);
      const buyer = await account();
      await expectDomainError(ownership.acceptTransfer(buyer.id, offer.transferCode, buyer.actor), 'TRANSFER_EXPIRED', 410);
      expect(await productRow(p.id)).toMatchObject({ ownership_state: 'REGISTERED' });
      const tr = await t.db.selectFrom('ownership_transfers').select('status').where('product_id', '=', p.id).executeTakeFirstOrThrow();
      expect(tr.status).toBe('EXPIRED');
      await expectDomainError(ownership.acceptTransfer(buyer.id, offer.transferCode, buyer.actor), 'TRANSFER_EXPIRED', 410);
      // A new transfer can be started after expiry.
      expect((await ownership.initiateTransfer(owner.id, p.productId, owner.actor)).transferCode).not.toBe(offer.transferCode);
    });

    it('expireStaleTransfers sweeps overdue transfers', async () => {
      const { p, owner } = await owned();
      await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      clock.advance(TRANSFER_TTL_MS + 1);
      expect(await ownership.expireStaleTransfers()).toBeGreaterThanOrEqual(1);
      expect(await productRow(p.id)).toMatchObject({ ownership_state: 'REGISTERED' });
      expect((await ownership.history(p.productId)).transfers.at(-1)?.status).toBe('EXPIRED');
      expect((await audit.list({ action: 'ownership.transfer.expire', targetId: p.productId })).items[0].actorType).toBe('system');
    });

    it('cancel: owner only; the code stops working', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      const stranger = await account();
      await expectDomainError(ownership.cancelTransfer(stranger.id, p.productId, stranger.actor), 'NOT_OWNER', 403);
      await ownership.cancelTransfer(owner.id, p.productId, owner.actor);
      expect(await productRow(p.id)).toMatchObject({ ownership_state: 'REGISTERED' });
      await expectDomainError(ownership.acceptTransfer(stranger.id, offer.transferCode, stranger.actor), 'TRANSFER_CANCELLED', 410);
      await expectDomainError(ownership.cancelTransfer(owner.id, p.productId, owner.actor), 'NO_PENDING_TRANSFER', 404);
    });

    it('rejects malformed and unknown transfer codes', async () => {
      const a = await account();
      await expectDomainError(ownership.acceptTransfer(a.id, 'ABCD', a.actor), 'VALIDATION_FAILED', 400);
      await expectDomainError(ownership.acceptTransfer(a.id, 'UUUU-UUUU-UUUU', a.actor), 'VALIDATION_FAILED', 400);
      await expectDomainError(ownership.acceptTransfer(a.id, '0000-0000-0000', a.actor), 'TRANSFER_NOT_FOUND', 404);
    });

    it('refuses transfers of products that are not transferable, and stale transfers', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      // Client services moves the product into service meanwhile.
      await warranty.openService(p.productId, { type: 'INSPECTION' }, admin);
      const buyer = await account();
      await expectDomainError(ownership.acceptTransfer(buyer.id, offer.transferCode, buyer.actor), 'TRANSFER_NOT_ALLOWED', 409);
      await ownership.cancelTransfer(owner.id, p.productId, owner.actor);
      await expectDomainError(ownership.initiateTransfer(owner.id, p.productId, owner.actor), 'TRANSFER_NOT_ALLOWED', 409);

      // Ownership changed by other means after the code was issued.
      const q = await owned();
      const offer2 = await ownership.initiateTransfer(q.owner.id, q.p.productId, q.owner.actor);
      await t.db.updateTable('ownership').set({ ended_at: clock.now(), ended_reason: 'ADMIN' }).where('product_id', '=', q.p.id).execute();
      await t.db.insertInto('ownership').values({ product_id: q.p.id, account_id: buyer.id, acquired_via: 'ADMIN', started_at: clock.now() }).execute();
      const other = await account();
      await expectDomainError(ownership.acceptTransfer(other.id, offer2.transferCode, other.actor), 'TRANSFER_STALE', 409);
    });
  });

  // ── confirm / incidents / reads ───────────────────────────────────────────

  describe('confirmOwnership', () => {
    it('REGISTERED → OWNED once client services verified the proof', async () => {
      const { p, owner } = await owned();
      const r = await ownership.confirmOwnership(p.productId, admin);
      expect(r).toMatchObject({ accountId: owner.id, verified: true, ownershipState: 'OWNED' });
      expect(r.statusChange).toMatchObject({ from: 'REGISTERED', to: 'OWNED' });
      expect(await productRow(p.id)).toMatchObject({ status: 'OWNED', ownership_state: 'OWNED' });
      await expectDomainError(ownership.confirmOwnership(p.productId, admin), 'ALREADY_VERIFIED', 409);
      await expectDomainError(ownership.confirmOwnership((await product()).productId, admin), 'NO_OWNER', 409);
    });

    it('keeps TRANSFER_PENDING and the status when not REGISTERED', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      const buyer = await account();
      await ownership.acceptTransfer(buyer.id, offer.transferCode, buyer.actor);
      await ownership.initiateTransfer(buyer.id, p.productId, buyer.actor);
      const r = await ownership.confirmOwnership(p.productId, admin);
      expect(r.statusChange).toBeNull();
      expect(await productRow(p.id)).toMatchObject({ status: 'TRANSFERRED', ownership_state: 'TRANSFER_PENDING' });
    });
  });

  describe('reportIncident', () => {
    it('owner reports LOST; a pending transfer is cancelled', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      const change = await ownership.reportIncident(owner.id, p.productId, 'LOST', owner.actor);
      expect(change).toMatchObject({ from: 'REGISTERED', to: 'LOST' });
      expect(await productRow(p.id)).toMatchObject({ status: 'LOST', ownership_state: 'REGISTERED' });
      const thief = await account();
      await expectDomainError(ownership.acceptTransfer(thief.id, offer.transferCode, thief.actor), 'TRANSFER_CANCELLED', 410);
      // LOST → STOLEN is not in the table.
      await expectDomainError(ownership.reportIncident(owner.id, p.productId, 'STOLEN', owner.actor), 'TRANSITION_NOT_ALLOWED', 409);
      // Recovery (admin) returns to the pre-incident status.
      expect((await lifecycle.allowedTransitions(p.productId))[0]).toBe('REGISTERED');
    });

    it('only the owner can report; the type is validated', async () => {
      const { p, owner } = await owned();
      const stranger = await account();
      await expectDomainError(ownership.reportIncident(stranger.id, p.productId, 'STOLEN', stranger.actor), 'NOT_OWNER', 403);
      await expectDomainError(ownership.reportIncident(owner.id, p.productId, 'BROKEN' as 'LOST', owner.actor), 'VALIDATION_FAILED', 400);
      expect((await ownership.reportIncident(owner.id, p.productId, 'STOLEN', owner.actor)).to).toBe('STOLEN');
    });
  });

  describe('reads', () => {
    it('listForAccount returns current products with genome, warranty and flags', async () => {
      const code = generateClaimCode();
      const { p, owner } = await owned({ claimCode: code });
      await t.db
        .insertInto('genomes')
        .values({
          product_id: p.id,
          genome_version: 1,
          genome_id: p.productId,
          value: 0x1234abcd + serial,
          glyphs: [1, 2, 3, 4, 10, 11, 12, 13],
          pattern: 'a·b·c·d·e·f·g·h',
          fingerprint: `G1-1234-${(0xabcd + serial).toString(16).toUpperCase().slice(-4)}`,
        })
        .execute();
      await warranty.activate(p.productId, { purchaseDate: '2026-06-01' }, admin);
      await ownership.initiateTransfer(owner.id, p.productId, owner.actor);

      const list = await ownership.listForAccount(owner.id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        productId: p.productId,
        category: { code: 'J', name: 'Jewelry' },
        collection: 'ORBIT',
        model: 'MONOLITHE',
        type: 'RING',
        variant: 'SIZE 54',
        material: '925 STERLING SILVER',
        createdYear: 2026,
        acquiredVia: 'FIRST_REGISTRATION',
        verified: true,
        transfer: { pending: true },
        incident: null,
        inService: false,
        genome: { id: p.productId, version: 1, glyphs: [1, 2, 3, 4, 10, 11, 12, 13] },
        warranty: { status: 'ACTIVE', startDate: '2026-06-01', endDate: '2028-06-01' },
      });
      // No raw lifecycle status in the owner view.
      expect(list[0]).not.toHaveProperty('status');
      expect(await ownership.listForAccount((await account()).id)).toEqual([]);
    });

    it('history lists every owner and transfer; currentOwner reflects the latest', async () => {
      const { p, owner } = await owned();
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      const buyer = await account();
      clock.advance(MIN);
      await ownership.acceptTransfer(buyer.id, offer.transferCode, buyer.actor);
      const h = await ownership.history(p.productId);
      expect(h.owners.map((o) => [o.accountId, o.acquiredVia, o.endedReason])).toEqual([
        [owner.id, 'FIRST_REGISTRATION', 'TRANSFERRED_OUT'],
        [buyer.id, 'TRANSFER', null],
      ]);
      expect(h.owners[0].email).toBe(owner.email);
      expect(h.transfers).toHaveLength(1);
      expect(h.transfers[0]).toMatchObject({ fromAccountId: owner.id, toAccountId: buyer.id, status: 'ACCEPTED' });
      expect(await ownership.currentOwner(p.productId)).toMatchObject({ accountId: buyer.id, acquiredVia: 'TRANSFER', transferPending: false });
      expect(await ownership.currentOwner((await product()).productId)).toBeNull();
    });

    it('never touches cryptographic identity columns', async () => {
      const { p, owner } = await owned();
      const before = await productRow(p.id);
      const offer = await ownership.initiateTransfer(owner.id, p.productId, owner.actor);
      await ownership.acceptTransfer((await account()).id, offer.transferCode, admin);
      const after = await productRow(p.id);
      for (const k of ['product_id', 'packed_identity', 'year', 'category_id', 'serial', 'claim_secret_hash'] as const) {
        expect(after[k]).toEqual(before[k]);
      }
      expect((await audit.verifyChain()).ok).toBe(true);
    });
  });

  it('ownershipStateFor maps owner + pending transfer to ownership_state', () => {
    expect(ownershipStateFor(null, false)).toBe('UNREGISTERED');
    expect(ownershipStateFor({ verified: false }, false)).toBe('REGISTERED');
    expect(ownershipStateFor({ verified: true }, false)).toBe('OWNED');
    expect(ownershipStateFor({ verified: true }, true)).toBe('TRANSFER_PENDING');
  });
});
