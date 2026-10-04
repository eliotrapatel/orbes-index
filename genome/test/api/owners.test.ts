/**
 * The owner's sheet of ORBES Client Services (A-06): search by exact email
 * and by the REF printed under a result, the sheet (pieces, transfers in
 * progress, 20 latest scans), lock and unlock (ADMIN: sessions end, pending
 * transfers cancelled, links to ownership certificates withdrawn, open
 * entries in the drops withdrawn (P-R03, test/api/drops.test.ts), the open
 * recovery code revoked, sign-in refused), the
 * right-of-access export (ADMIN, no-store, audited, every audit entry that
 * names the account, no other owner's data on a piece sold, no internal
 * flag), emails masked for an AUDITOR everywhere, and the
 * recovery code of C-04 refused once expired or used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, issue, PASSWORD, safeJson, scanToReceive, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const NEW_PASSWORD = 'a brand new passphrase';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface OwnerJson {
  id: string;
  email: string;
  status: string;
  products: number;
  productsEver: number;
  [k: string]: unknown;
}
interface ListJson {
  items: OwnerJson[];
  total: number;
  scans?: { scanId: string; reference: string; productId: string | null; scannedBy: string | null; ownerId: string | null; state: string }[];
}

describe('owner sheet for ORBES Client Services (A-06)', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { verifyPerMinute: 10_000, authPerMinute: 10_000, adminPerMinute: 10_000, apiPerMinute: 10_000 } } });
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  const accountIdOf = async (email: string) =>
    (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;

  /** A piece registered to the customer behind `c`, through a scan and its registration token. */
  async function ownedPiece(c: Client): Promise<{ productId: string; data: string }> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return { productId: p.product.productId, data: p.code.data };
  }

  const list = async (c: Client, query: string) => {
    const res = await c.get(`/api/admin/owners${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as ListJson;
  };

  describe('GET /api/admin/owners?email= and ?ref=', () => {
    it('finds one account by its exact email, in any case; nothing for another; a partial one is refused', async () => {
      const cs = await adminClient(h, 'OPERATOR');
      const { email } = await accountClient(h);
      const found = await list(cs, `?email=${encodeURIComponent(`  ${email.toUpperCase()} `)}`);
      expect(found.total).toBe(1);
      expect(found.items).toEqual([expect.objectContaining({ id: await accountIdOf(email), email, status: 'ACTIVE' })]);
      expect(found.scans).toBeUndefined();
      expect((await list(cs, `?email=${encodeURIComponent('nobody@example.com')}`)).items).toEqual([]);

      const partial = await cs.get(`/api/admin/owners?email=${encodeURIComponent(email.split('@')[0])}`);
      expect(partial.statusCode).toBe(400);
      expect(errorOf(partial)).toEqual({ code: 'VALIDATION_FAILED', message: 'Enter the whole email address of the account.' });
      const both = await cs.get(`/api/admin/owners?email=${encodeURIComponent(email)}&ref=1A2B3C4D`);
      expect(both.statusCode).toBe(400);
      expect(errorOf(both).code).toBe('VALIDATION_FAILED');
    });

    it('finds the scan behind a REF, its piece, the piece’s owner and the account that scanned it', async () => {
      const cs = await adminClient(h, 'OPERATOR');
      const owner = await accountClient(h);
      const { productId, data } = await ownedPiece(owner.client);
      const ownerId = await accountIdOf(owner.email);
      // A stranger, signed in, scans the owner's piece and quotes the REF under the result to Client Services.
      const stranger = await accountClient(h);
      const strangerScan = safeJson(await stranger.client.post('/api/v1/verify', { code: data })) as { scanId: string };
      const ref = strangerScan.scanId.slice(0, 8).toUpperCase();

      for (const spelled of [ref, `REF ${ref}`, ref.toLowerCase(), strangerScan.scanId]) {
        const found = await list(cs, `?ref=${encodeURIComponent(spelled)}`);
        expect(found.scans, spelled).toEqual([
          expect.objectContaining({ scanId: strangerScan.scanId, reference: ref, productId, scannedBy: await accountIdOf(stranger.email), ownerId }),
        ]);
        expect(found.items.map((o) => o.id).sort()).toEqual([ownerId, await accountIdOf(stranger.email)].sort());
      }

      // A visitor who is not signed in: the REF still leads to the piece and its owner.
      const anon = safeJson(await h.client({ ip: '198.51.100.7' }).post('/api/v1/verify', { code: data })) as { scanId: string };
      const byAnon = await list(cs, `?ref=${anon.scanId.slice(0, 8)}`);
      expect(byAnon.scans).toEqual([expect.objectContaining({ scanId: anon.scanId, scannedBy: null, ownerId })]);
      expect(byAnon.items.map((o) => o.id)).toEqual([ownerId]);

      // A code the registry does not know: the scan, with no piece and no account.
      const malformed = safeJson(await h.client({ ip: '198.51.100.8' }).post('/api/v1/verify', { code: 'not-a-code' })) as { scanId: string };
      const byMalformed = await list(cs, `?ref=${malformed.scanId.slice(0, 8)}`);
      expect(byMalformed.scans).toEqual([expect.objectContaining({ scanId: malformed.scanId, productId: null, scannedBy: null, ownerId: null, state: 'MALFORMED_CODE' })]);
      expect(byMalformed.items).toEqual([]);

      for (const bad of ['1A2B', 'ZZZZZZZZ', 'REF 1A2B3C4D5E']) {
        const res = await cs.get(`/api/admin/owners?ref=${encodeURIComponent(bad)}`);
        expect(res.statusCode, bad).toBe(400);
        expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('GET /api/admin/owners/:id', () => {
    it('shows the pieces owned now and before, the transfers in progress and the 20 latest scans', async () => {
      const cs = await adminClient(h, 'OPERATOR');
      const owner = await accountClient(h);
      const id = await accountIdOf(owner.email);
      const kept = await ownedPiece(owner.client);
      const sold = await ownedPiece(owner.client);
      // One piece handed on to a buyer, the other offered and still pending.
      const handed = safeJson(await owner.client.post('/api/v1/ownership/transfers', { productId: sold.productId })) as { transferCode: string };
      const buyer = await accountClient(h);
      expect((await buyer.client.post('/api/v1/ownership/transfers/accept', await scanToReceive(buyer.client, sold.data, handed.transferCode))).statusCode).toBe(200);
      expect((await owner.client.post('/api/v1/ownership/transfers', { productId: kept.productId })).statusCode).toBe(201);
      for (let i = 0; i < 21; i++) {
        h.clock.advance(1_000);
        expect((await owner.client.post('/api/v1/verify', { code: kept.data })).statusCode).toBe(200);
      }

      const res = await cs.get(`/api/admin/owners/${id}`);
      expect(res.statusCode).toBe(200);
      const sheet = safeJson(res) as {
        owner: OwnerJson;
        pieces: { productId: string; until: string | null; endedReason: string | null; acquiredVia: string; model: string; status: string }[];
        transfers: { productId: string; expiresAt: string }[];
        scans: { id: string; reference: string; occurredAt: string; productId: string | null }[];
      };
      expect(sheet.owner).toMatchObject({ id, email: owner.email, status: 'ACTIVE', products: 1, productsEver: 2 });
      expect(sheet.pieces.map((p) => [p.productId, p.until === null, p.endedReason])).toEqual([
        [kept.productId, true, null],
        [sold.productId, false, 'TRANSFERRED_OUT'],
      ]);
      expect(sheet.pieces[0]).toMatchObject({ acquiredVia: 'FIRST_REGISTRATION', model: 'MONOLITHE' });
      expect(sheet.transfers).toEqual([expect.objectContaining({ productId: kept.productId })]);
      // 2 scans to register + 21 since: the 20 latest, newest first, each with the REF printed under its result.
      expect(sheet.scans).toHaveLength(20);
      const times = sheet.scans.map((s) => Date.parse(s.occurredAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      for (const s of sheet.scans) expect(s.reference).toBe(s.id.slice(0, 8).toUpperCase());

      const unknown = await cs.get('/api/admin/owners/5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6');
      expect(unknown.statusCode).toBe(404);
      expect(errorOf(unknown).code).toBe('ACCOUNT_NOT_FOUND');
      expect((await cs.get('/api/admin/owners/not-a-uuid')).statusCode).toBe(400);
    });
  });

  describe('POST /api/admin/owners/:id/lock and /unlock', () => {
    it('locks: every session ends, pending transfers are cancelled, certificate links are withdrawn, the open recovery code is revoked, sign-in is refused; unlocking restores sign-in', async () => {
      const cs = await adminClient(h, 'ADMIN');
      const owner = await accountClient(h);
      const id = await accountIdOf(owner.email);
      const { productId, data } = await ownedPiece(owner.client);
      const offer = safeJson(await owner.client.post('/api/v1/ownership/transfers', { productId })) as { transferCode: string };
      // A recipient has scanned the piece and holds the code (F-03), when the lock comes.
      const recipient = (await accountClient(h)).client;
      const scanned = await scanToReceive(recipient, data, offer.transferCode);
      // A link to an ownership certificate of the piece, shared before the lock (F-06).
      const link = safeJson(await owner.client.post('/api/v1/ownership/certificates', { productId })) as { token: string };
      expect((await h.client().post('/api/v1/certificates/lookup', { token: link.token })).statusCode).toBe(200);
      const elsewhere = h.client({ ip: '203.0.113.77' });
      expect((await elsewhere.post('/api/v1/account/login', { email: owner.email, password: PASSWORD })).statusCode).toBe(200);
      const code = (safeJson(await cs.post(`/api/admin/owners/${id}/recovery-code`)) as { recoveryCode: string }).recoveryCode;

      for (const role of ['AUDITOR', 'OPERATOR'] as const) {
        const res = await (await adminClient(h, role)).post(`/api/admin/owners/${id}/lock`);
        expect(res.statusCode, role).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
      const noCsrf = await cs.post(`/api/admin/owners/${id}/lock`, undefined, { noCsrf: true });
      expect(noCsrf.statusCode).toBe(403);
      expect(errorOf(noCsrf).code).toBe('CSRF_FAILED');
      expect((await cs.post(`/api/admin/owners/${id}/lock`, { reason: 'x' })).statusCode).toBe(400);

      const locked = await cs.post(`/api/admin/owners/${id}/lock`);
      expect(locked.statusCode).toBe(200);
      expect(safeJson(locked)).toEqual({ status: 'LOCKED', sessionsRevoked: 2, transfersCancelled: 1, recoveryCodesRevoked: 1, certificatesRevoked: 1, dropEntriesWithdrawn: 0 });

      // The sessions have ended; the right password is refused with the lock, a wrong one as ever.
      expect((await owner.client.get('/api/v1/account/me')).statusCode).toBe(401);
      expect((await elsewhere.get('/api/v1/account/me')).statusCode).toBe(401);
      const login = await h.client().post('/api/v1/account/login', { email: owner.email, password: PASSWORD });
      expect(login.statusCode).toBe(403);
      expect(errorOf(login)).toEqual({ code: 'ACCOUNT_LOCKED', message: 'This account is locked. ORBES Client Services can assist you.' });
      expect(login.cookies.find((x) => x.name === 'orbes_session')).toBeUndefined();
      const wrong = await h.client().post('/api/v1/account/login', { email: owner.email, password: 'not the password at all' });
      expect(wrong.statusCode).toBe(401);
      expect(errorOf(wrong).code).toBe('INVALID_CREDENTIALS');
      // The recovery code issued before the lock was revoked with it: it fails like a wrong one, and reveals no lock.
      const recover = await h.client().post('/api/v1/account/recover', { email: owner.email, recoveryCode: code, newPassword: NEW_PASSWORD });
      expect(recover.statusCode).toBe(400);
      expect(errorOf(recover).code).toBe('RECOVERY_CODE_INVALID');
      const codeRow = await h.ctx.db.selectFrom('account_recovery_codes').select(['used_at', 'revoked_at']).where('account_id', '=', id).executeTakeFirstOrThrow();
      expect(codeRow).toEqual({ used_at: null, revoked_at: h.clock.now() });
      // The transfer code handed out before the lock no longer completes.
      const taken = await recipient.post('/api/v1/ownership/transfers/accept', scanned);
      expect(taken.statusCode).toBe(410);
      expect(errorOf(taken).code).toBe('TRANSFER_CANCELLED');
      // The certificate link answers as one that never existed.
      const lookup = await h.client().post('/api/v1/certificates/lookup', { token: link.token });
      expect(lookup.statusCode).toBe(404);
      expect(errorOf(lookup).code).toBe('CERTIFICATE_NOT_FOUND');

      const again = await cs.post(`/api/admin/owners/${id}/lock`);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe('ACCOUNT_ALREADY_LOCKED');
      const issue2 = await cs.post(`/api/admin/owners/${id}/recovery-code`);
      expect(issue2.statusCode).toBe(409);
      expect(errorOf(issue2).code).toBe('ACCOUNT_NOT_ACTIVE');
      expect((await list(cs, `?email=${encodeURIComponent(owner.email)}`)).items[0]).toMatchObject({ status: 'LOCKED', products: 1, recoveryCodeExpiresAt: null });

      // The audit log names the account, the counts and the admin; never the email.
      const lockEntry = (await h.ctx.audit.list({ action: 'account.lock', targetId: id })).items;
      expect(lockEntry).toEqual([
        expect.objectContaining({ actorType: 'admin', targetType: 'account', details: { sessionsRevoked: 2, transfersCancelled: 1, recoveryCodesRevoked: 1, certificatesRevoked: 1, dropEntriesWithdrawn: 0 } }),
      ]);
      expect(JSON.stringify(lockEntry)).not.toContain(owner.email);
      expect((await h.ctx.audit.list({ action: 'ownership.transfer.cancel', targetId: productId })).items[0].details).toMatchObject({ reason: 'account_locked' });
      expect((await h.ctx.audit.list({ action: 'ownership.certificate.revoke', targetId: productId })).items[0]).toMatchObject({ actorType: 'admin', details: { reason: 'account_locked' } });

      for (const role of ['AUDITOR', 'OPERATOR'] as const) {
        expect((await (await adminClient(h, role)).post(`/api/admin/owners/${id}/unlock`)).statusCode, role).toBe(403);
      }
      const unlocked = await cs.post(`/api/admin/owners/${id}/unlock`);
      expect(unlocked.statusCode).toBe(200);
      expect(safeJson(unlocked)).toEqual({ status: 'ACTIVE' });
      expect((await h.client().post('/api/v1/account/login', { email: owner.email, password: PASSWORD })).statusCode).toBe(200);
      // The revoked code does not come back with the unlock.
      const afterUnlock = await h.client().post('/api/v1/account/recover', { email: owner.email, recoveryCode: code, newPassword: NEW_PASSWORD });
      expect(afterUnlock.statusCode).toBe(400);
      expect(errorOf(afterUnlock).code).toBe('RECOVERY_CODE_INVALID');
      const twice = await cs.post(`/api/admin/owners/${id}/unlock`);
      expect(twice.statusCode).toBe(409);
      expect(errorOf(twice).code).toBe('ACCOUNT_NOT_LOCKED');
      expect((await h.ctx.audit.list({ action: 'account.unlock', targetId: id })).items).toHaveLength(1);

      const unknown = await cs.post('/api/admin/owners/5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6/lock');
      expect(unknown.statusCode).toBe(404);
      expect(errorOf(unknown).code).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  describe('the recovery code of the sheet (C-04)', () => {
    it('is refused once used, and once its 30 minutes are over', async () => {
      const owner = await accountClient(h);
      const id = await accountIdOf(owner.email);
      const issueCode = async () => (safeJson(await (await adminClient(h, 'ADMIN')).post(`/api/admin/owners/${id}/recovery-code`)) as { recoveryCode: string }).recoveryCode;

      const code = await issueCode();
      expect((await h.client().post('/api/v1/account/recover', { email: owner.email, recoveryCode: code, newPassword: NEW_PASSWORD })).statusCode).toBe(200);
      const reused = await h.client().post('/api/v1/account/recover', { email: owner.email, recoveryCode: code, newPassword: 'yet another passphrase' });
      expect(reused.statusCode).toBe(400);
      expect(errorOf(reused).code).toBe('RECOVERY_CODE_INVALID');

      const late = await issueCode();
      h.clock.advance(30 * 60_000);
      const expired = await h.client().post('/api/v1/account/recover', { email: owner.email, recoveryCode: late, newPassword: 'yet another passphrase' });
      expect(expired.statusCode).toBe(400);
      expect(errorOf(expired).code).toBe('RECOVERY_CODE_INVALID');
      expect((await h.client().post('/api/v1/account/login', { email: owner.email, password: NEW_PASSWORD })).statusCode).toBe(200);
    });
  });

  describe('emails for an AUDITOR', () => {
    it('are masked in the list, both searches, the sheet and the product page; in clear from OPERATOR up', async () => {
      const owner = await accountClient(h);
      const id = await accountIdOf(owner.email);
      const { productId, data } = await ownedPiece(owner.client);
      const scan = safeJson(await owner.client.post('/api/v1/verify', { code: data })) as { scanId: string };
      const masked = `o***@example.com`;
      const auditor = await adminClient(h, 'AUDITOR');

      const bodies: string[] = [];
      const read = async (url: string) => {
        const res = await auditor.get(url);
        expect(res.statusCode, url).toBe(200);
        bodies.push(res.body);
        return safeJson(res) as Record<string, any>;
      };
      const all = await read('/api/admin/owners?pageSize=200');
      for (const o of all.items as OwnerJson[]) expect(o.email).toMatch(/^[^@*]\*\*\*@[^@]+$/);
      expect((all.items as OwnerJson[]).find((o) => o.id === id)!.email).toBe(masked);
      expect((await read(`/api/admin/owners?email=${encodeURIComponent(owner.email)}`)).items[0].email).toBe(masked);
      expect((await read(`/api/admin/owners?ref=${scan.scanId.slice(0, 8)}`)).items[0].email).toBe(masked);
      expect((await read(`/api/admin/owners/${id}`)).owner.email).toBe(masked);
      expect((await read(`/api/admin/products/${productId}`)).ownership.owners[0].email).toBe(masked);
      for (const body of bodies) expect(body).not.toContain(owner.email);

      for (const role of ['OPERATOR', 'ADMIN'] as const) {
        const c = await adminClient(h, role);
        expect((safeJson(await c.get(`/api/admin/owners/${id}`)) as any).owner.email, role).toBe(owner.email);
        expect((safeJson(await c.get(`/api/admin/products/${productId}`)) as any).ownership.owners[0].email, role).toBe(owner.email);
      }
    });
  });

  describe('GET /api/admin/owners/:id/export', () => {
    it('gives an ADMIN everything held about the account, as a no-store JSON attachment, and audits it', async () => {
      const owner = await accountClient(h);
      const id = await accountIdOf(owner.email);
      const { productId } = await ownedPiece(owner.client);
      // A transfer offered then cancelled, a claim code mistyped on another piece, the first piece declared STOLEN,
      // a report on a scan that was not authentic, a recovery code.
      expect((await owner.client.post('/api/v1/ownership/transfers', { productId })).statusCode).toBe(201);
      expect((await owner.client.post('/api/v1/ownership/transfers/cancel', { productId })).statusCode).toBe(200);
      const claimed = await issue(h.ctx, catalog, { withClaimSecret: true });
      await h.ctx.services.warranty.activate(claimed.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
      h.clock.advance(1_000);
      const offered = safeJson(await owner.client.post('/api/v1/verify', { code: claimed.code.data })) as { registration: { token: string } };
      const mistyped = await owner.client.post('/api/v1/ownership/register', { registrationToken: offered.registration.token, claimCode: 'AAAA-AAAA-AAAA' });
      expect(errorOf(mistyped).code).toBe('CLAIM_CODE_INVALID');
      expect((await owner.client.post('/api/v1/ownership/incidents', { productId, type: 'STOLEN' })).statusCode).toBe(201);
      h.clock.advance(1_000);
      const bad = safeJson(await owner.client.post('/api/v1/verify', { code: 'not-a-code' })) as { scanId: string };
      expect((await owner.client.post('/api/v1/reports', { scanId: bad.scanId, channel: 'ONLINE', where: 'a marketplace', note: 'Too cheap.' })).statusCode).toBe(201);
      const cs = await adminClient(h, 'ADMIN');
      expect((await cs.post(`/api/admin/owners/${id}/recovery-code`)).statusCode).toBe(201);

      for (const role of ['AUDITOR', 'OPERATOR'] as const) {
        const res = await (await adminClient(h, role)).get(`/api/admin/owners/${id}/export`);
        expect(res.statusCode, role).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
      const res = await cs.get(`/api/admin/owners/${id}/export`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="orbes-account-${id.slice(0, 8)}-${h.clock.now().toISOString().slice(0, 10)}.json"`);
      const x = safeJson(res) as Record<string, any>;
      expect(x).toMatchObject({ format: 'orbes.account-export', version: 1, truncated: [] });
      expect(x.account).toMatchObject({ id, email: owner.email, displayName: 'Owner', status: 'ACTIVE', transfersPausedUntil: null });
      expect(x.pieces).toEqual([expect.objectContaining({ productId, until: null, acquiredVia: 'FIRST_REGISTRATION', status: 'STOLEN' })]);
      expect(x.transfers).toEqual([expect.objectContaining({ productId, direction: 'OUT', status: 'CANCELLED' })]);
      expect(x.scans.map((s: any) => s.state)).toEqual(['AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_FIRST_REGISTRATION', 'MALFORMED_CODE']);
      const ref = bad.scanId.slice(0, 8).toUpperCase();
      expect(x.scans[2]).toMatchObject({ reference: ref, report: { channel: 'ONLINE', place: 'a marketplace', note: 'Too cheap.' } });
      // Each scan with its browser family and what the app measured (none here: the test client sends no metrics).
      const family = (await h.ctx.db.selectFrom('scan_events').select('user_agent_family').where('id', '=', bad.scanId).executeTakeFirstOrThrow()).user_agent_family;
      expect(family).toEqual(expect.any(String));
      expect(x.scans[2]).toMatchObject({ userAgentFamily: family, clientMetrics: null });
      expect(x.sessions).toEqual([expect.objectContaining({ userAgent: expect.stringContaining('iPhone') })]);
      expect(x.recoveryCodes).toEqual([expect.objectContaining({ usedAt: null, revokedAt: null })]);
      // No link to an ownership certificate here (the service test lists open and withdrawn ones), no entry in a drop
      // (test/api/drops.test.ts lists them), no answer nor vote in the circle (test/api/circle.test.ts lists them).
      expect(x.certificates).toEqual([]);
      expect(x.dropEntries).toEqual([]);
      expect(x.circleAnswers).toEqual([]);
      expect(x.circleVotes).toEqual([]);
      // Every audit entry that names the account: about it, and made by it (the claim code mistyped on a piece it
      // does not own, the STOLEN declaration and its time, the report), each with its piece or the scan's REF.
      expect(x.activity.map((e: any) => [e.action, e.by, e.productId, e.reference, e.status])).toEqual([
        ['account.register', 'account', null, null, null],
        ['product.transition', 'account', productId, null, 'REGISTERED'],
        ['ownership.register', 'account', productId, null, null],
        ['ownership.transfer.initiate', 'account', productId, null, null],
        ['ownership.transfer.cancel', 'account', productId, null, null],
        ['ownership.claim_failed', 'account', claimed.product.productId, null, null],
        ['product.transition', 'account', productId, null, 'STOLEN'],
        ['ownership.incident', 'account', productId, null, 'STOLEN'],
        ['scan.report', 'account', null, ref, null],
        ['account.recovery_code.issue', 'admin', null, null, null],
      ]);
      const declared = await h.ctx.audit.list({ action: 'ownership.incident', targetId: productId });
      expect(x.activity[7].occurredAt).toBe(declared.items[0].occurredAt.toISOString());
      expect(x.notIncluded).toHaveLength(3);
      expect(x.notIncluded[1]).toMatch(/ownership certificates: only a one-way SHA-256 of their token/);
      // No secret and no pseudonym: neither the password hash, the code's hash, nor the scan's IP or device keys.
      const stored = await h.ctx.db.selectFrom('scan_events').select(['ip_hash', 'device_hash']).where('id', '=', bad.scanId).executeTakeFirstOrThrow();
      expect(res.body).not.toContain('scrypt$');
      expect(res.body).not.toContain(stored.ip_hash!);
      expect(res.body).not.toContain(stored.device_hash!);
      expect(res.body).not.toContain(bad.scanId); // a scan by its REF only
      expect(res.body).not.toMatch(/"(ipHash|ip_hash|deviceHash|device_hash|sessionHash|passwordHash|codeHash)"/);
      for (const s of x.scans) expect(s).not.toHaveProperty('id');

      const audit = (await h.ctx.audit.list({ action: 'account.export', targetId: id })).items;
      expect(audit).toEqual([
        expect.objectContaining({ actorType: 'admin', targetType: 'account', details: { pieces: 1, transfers: 1, scans: 3, sessions: 1, recoveryCodes: 1, certificates: 0, dropEntries: 0, circleAnswers: 0, circleVotes: 0, activity: 10 } }),
      ]);
      expect(JSON.stringify(audit)).not.toContain(owner.email);

      expect((await cs.get('/api/admin/owners/5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6/export')).statusCode).toBe(404);
      expect(UUID_RE.test(id)).toBe(true);
    });

    it('names the status a loss withdrawn by its owner returned the piece to (PIECE FOUND, F-01)', async () => {
      const owner = await accountClient(h);
      const id = await accountIdOf(owner.email);
      const { productId } = await ownedPiece(owner.client);
      expect((await owner.client.post('/api/v1/ownership/incidents', { productId, type: 'LOST' })).statusCode).toBe(201);
      h.clock.advance(1_000);
      expect((await owner.client.post('/api/v1/ownership/incidents/resolve', { productId, currentPassword: PASSWORD })).statusCode).toBe(200);
      const x = safeJson(await (await adminClient(h, 'ADMIN')).get(`/api/admin/owners/${id}/export`)) as Record<string, any>;
      expect(x.activity.map((e: any) => [e.action, e.by, e.productId, e.status]).slice(-4)).toEqual([
        ['product.transition', 'account', productId, 'LOST'],
        ['ownership.incident', 'account', productId, 'LOST'],
        ['product.transition', 'account', productId, 'REGISTERED'],
        ['ownership.incident.resolve', 'account', productId, 'REGISTERED'],
      ]);
      expect(x.pieces).toEqual([expect.objectContaining({ productId, status: 'REGISTERED' })]);
    });

    it('gives no current status for a piece owned before, and no internal flag for a piece owned now', async () => {
      const seller = await accountClient(h);
      const id = await accountIdOf(seller.email);
      const sold = await ownedPiece(seller.client);
      const offer = safeJson(await seller.client.post('/api/v1/ownership/transfers', { productId: sold.productId })) as { transferCode: string };
      const buyer = await accountClient(h);
      expect((await buyer.client.post('/api/v1/ownership/transfers/accept', await scanToReceive(buyer.client, sold.data, offer.transferCode))).statusCode).toBe(200);
      // What happens to the piece afterwards is the buyer's: a STOLEN declaration and a transfer under way.
      expect((await buyer.client.post('/api/v1/ownership/incidents', { productId: sold.productId, type: 'STOLEN' })).statusCode).toBe(201);
      // A piece the seller still owns, flagged by staff: an internal status, which reads REVOKED for the public.
      const kept = await ownedPiece(seller.client);
      await h.ctx.services.lifecycle.transition(kept.productId, 'COUNTERFEIT_FLAGGED', { reason: 'copies of its code reported online' }, SYSTEM_ACTOR);

      const res = await (await adminClient(h, 'ADMIN')).get(`/api/admin/owners/${id}/export`);
      expect(res.statusCode).toBe(200);
      const x = safeJson(res) as { pieces: Record<string, unknown>[] };
      expect(x.pieces).toEqual([
        expect.objectContaining({ productId: kept.productId, until: null, status: 'REVOKED', ownershipState: expect.any(String) }),
        expect.objectContaining({ productId: sold.productId, until: expect.any(String), endedReason: 'TRANSFERRED_OUT' }),
      ]);
      expect(x.pieces[1]).not.toHaveProperty('status');
      expect(x.pieces[1]).not.toHaveProperty('ownershipState');
      expect(res.body).not.toMatch(/STOLEN|COUNTERFEIT/);
      // The owner's sheet, for staff, still reads the registry as it is.
      const sheet = safeJson(await (await adminClient(h, 'ADMIN')).get(`/api/admin/owners/${id}`)) as { pieces: { productId: string; status: string }[] };
      expect(sheet.pieces.map((p) => [p.productId, p.status])).toEqual([
        [kept.productId, 'COUNTERFEIT_FLAGGED'],
        [sold.productId, 'STOLEN'],
      ]);
    });
  });
});
