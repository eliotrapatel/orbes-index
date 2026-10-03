import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, createHarness, errorOf, issue, PASSWORD, safeJson, scanToReceive, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('ownership API', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  /** An ACTIVATED product (warranty started) ready for first registration. */
  async function sellable(withClaimSecret: boolean) {
    const p = await issue(h.ctx, catalog, { withClaimSecret });
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
    return p;
  }

  async function scanForToken(c: Client, data: string) {
    const res = await c.post('/api/v1/verify', { code: data });
    const body = safeJson(res) as any;
    expect(body.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    return body.registration as { token: string; expiresAt: string; claimCodeRequired: boolean };
  }

  it('first registration with a claim code, then transfer to a second owner', async () => {
    const p = await sellable(true);
    const a = (await accountClient(h)).client;
    const b = (await accountClient(h)).client;

    const reg = await scanForToken(a, p.code.data);
    expect(reg.claimCodeRequired).toBe(true);
    expect(reg.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const wrong = await a.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: 'AAAA-AAAA-AAAA' });
    expect(wrong.statusCode).toBe(403);
    expect(errorOf(wrong).code).toBe('CLAIM_CODE_INVALID');

    const ok = await a.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: p.claimCode });
    expect(ok.statusCode).toBe(201);
    expect(safeJson(ok)).toMatchObject({ productId: p.product.productId, verified: true });
    expect(ok.body).not.toMatch(/OWNED|ACTIVATED|status/); // no internal statuses

    const reused = await a.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: p.claimCode });
    expect(reused.statusCode).toBe(409);

    const mine = safeJson(await a.get('/api/v1/account/products')) as { products: any[] };
    expect(mine.products).toHaveLength(1);
    expect(mine.products[0]).toMatchObject({
      productId: p.product.productId,
      verified: true,
      genome: { fingerprint: p.genome.fingerprint },
      warranty: { status: 'ACTIVE' },
    });

    // Transfer A → B.
    const offer = await a.post('/api/v1/ownership/transfers', { productId: p.product.productId });
    expect(offer.statusCode).toBe(201);
    const { transferCode, expiresAt } = safeJson(offer) as { transferCode: string; expiresAt: string };
    expect(transferCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(h.ctx.clock().getTime());
    expect((await a.post('/api/v1/ownership/transfers', { productId: p.product.productId })).statusCode).toBe(409);

    const notTheOwner = await b.post('/api/v1/ownership/transfers', { productId: p.product.productId });
    expect(notTheOwner.statusCode).toBe(403);

    // B scans the piece, signed in, and enters the code with that scan (F-03).
    const scanned = await scanToReceive(b, p.code.data, transferCode);
    const badCode = await b.post('/api/v1/ownership/transfers/accept', { ...scanned, transferCode: '0000-0000-0000' });
    expect(badCode.statusCode).toBe(404);
    const accepted = await b.post('/api/v1/ownership/transfers/accept', scanned);
    expect(accepted.statusCode).toBe(200);
    expect(safeJson(accepted)).toMatchObject({ productId: p.product.productId, verified: true });

    expect((safeJson(await a.get('/api/v1/account/products')) as any).products).toHaveLength(0);
    expect((safeJson(await b.get('/api/v1/account/products')) as any).products).toHaveLength(1);

    // B starts a transfer and withdraws it; A can no longer act on the product.
    expect((await b.post('/api/v1/ownership/transfers', { productId: p.product.productId })).statusCode).toBe(201);
    expect((await a.post('/api/v1/ownership/transfers/cancel', { productId: p.product.productId })).statusCode).toBe(403);
    const cancel = await b.post('/api/v1/ownership/transfers/cancel', { productId: p.product.productId });
    expect(cancel.statusCode).toBe(200);
    expect(safeJson(cancel)).toEqual({ ok: true });
    expect((await b.post('/api/v1/ownership/transfers/cancel', { productId: p.product.productId })).statusCode).toBe(404);
  });

  it('registration without a claim secret is unverified; tokens are bound to a fresh scan', async () => {
    const p = await sellable(false);
    const a = (await accountClient(h)).client;
    const reg = await scanForToken(a, p.code.data);
    expect(reg.claimCodeRequired).toBe(false);
    const ok = await a.post('/api/v1/ownership/register', { registrationToken: reg.token });
    expect(ok.statusCode).toBe(201);
    expect((safeJson(ok) as any).verified).toBe(false);

    const bogus = await a.post('/api/v1/ownership/register', { registrationToken: 'A'.repeat(43) });
    expect(bogus.statusCode).toBe(400);
    expect(errorOf(bogus).code).toBe('REGISTRATION_TOKEN_INVALID');
    const malformed = await a.post('/api/v1/ownership/register', { registrationToken: 'not a token!' });
    expect(malformed.statusCode).toBe(400);
    expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');
  });

  it('owner-only service history and incident reports', async () => {
    const p = await sellable(false);
    const owner = (await accountClient(h)).client;
    const stranger = (await accountClient(h)).client;
    const reg = await scanForToken(owner, p.code.data);
    expect((await owner.post('/api/v1/ownership/register', { registrationToken: reg.token })).statusCode).toBe(201);

    const svc = await h.ctx.services.warranty.openService(p.product.productId, { type: 'POLISH', location: 'Paris atelier', notes: 'internal note' }, SYSTEM_ACTOR);
    await h.ctx.services.warranty.completeService(svc.id, { notes: 'done' }, SYSTEM_ACTOR);

    const history = await owner.get(`/api/v1/products/${p.product.productId}/service-history`);
    expect(history.statusCode).toBe(200);
    const body = safeJson(history) as { productId: string; services: any[] };
    expect(body.productId).toBe(p.product.productId);
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({ type: 'POLISH', status: 'COMPLETED', location: 'Paris atelier' });
    expect(history.body).not.toContain('internal note'); // staff notes stay internal

    expect((await stranger.get(`/api/v1/products/${p.product.productId}/service-history`)).statusCode).toBe(403);
    // Unknown ids answer like products of someone else (no enumeration of issued serials).
    expect((await owner.get('/api/v1/products/O26-J-99999/service-history')).statusCode).toBe(403);
    expect((await owner.get('/api/v1/products/not-a-product/service-history')).statusCode).toBe(400);

    expect((await stranger.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'STOLEN' })).statusCode).toBe(403);
    const bad = await owner.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'BROKEN' });
    expect(bad.statusCode).toBe(400);
    const report = await owner.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'STOLEN' });
    expect(report.statusCode).toBe(201);
    expect(safeJson(report)).toMatchObject({ productId: p.product.productId, type: 'STOLEN' });

    const after = await h.client().post('/api/v1/verify', { code: p.code.data });
    expect((safeJson(after) as any).state).toBe('SUSPICIOUS_ACTIVITY');
  });

  it('MY PIECES (F-01): the owner lists, reports LOST, then withdraws it (PIECE FOUND) with the password; a STOLEN stays with Client Services', async () => {
    const lost = await sellable(true);
    const stolen = await sellable(true);
    const signedUp = await accountClient(h);
    const owner = signedUp.client;
    const stranger = (await accountClient(h)).client;
    // Another session of the account, opened before the declaration (another device, or a taken one).
    const other = h.client();
    expect((await other.post('/api/v1/account/login', { email: signedUp.email, password: PASSWORD })).statusCode).toBe(200);
    const found_ = (c: Client, productId: string, currentPassword: string | null = PASSWORD) =>
      c.post('/api/v1/ownership/incidents/resolve', { productId, ...(currentPassword !== null ? { currentPassword } : {}) });
    for (const p of [lost, stolen]) {
      const reg = await scanForToken(owner, p.code.data);
      expect((await owner.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: p.claimCode })).statusCode).toBe(201);
    }

    expect((await owner.post('/api/v1/ownership/incidents', { productId: lost.product.productId, type: 'LOST' })).statusCode).toBe(201);
    expect((await owner.post('/api/v1/ownership/incidents', { productId: stolen.product.productId, type: 'STOLEN' })).statusCode).toBe(201);
    const listed = (safeJson(await owner.get('/api/v1/account/products')) as { products: any[] }).products;
    const byId = new Map(listed.map((p) => [p.productId, p]));
    expect(byId.get(lost.product.productId)).toMatchObject({ incident: 'LOST', incidentResolvable: true, certificateAllowed: false });
    expect(byId.get(stolen.product.productId)).toMatchObject({ incident: 'STOLEN', incidentResolvable: false, certificateAllowed: false });
    // A stranger's scan of the lost piece: UNUSUAL ACTIVITY.
    expect((safeJson(await h.client().post('/api/v1/verify', { code: lost.code.data })) as any).state).toBe('SUSPICIOUS_ACTIVITY');

    // Only the owner (who types their password); an unknown id answers alike.
    expect(errorOf(await found_(stranger, lost.product.productId)).code).toBe('NOT_OWNER');
    expect((await found_(stranger, 'O26-J-99999')).statusCode).toBe(403);
    expect((await owner.post('/api/v1/ownership/incidents/resolve', { productId: lost.product.productId, currentPassword: PASSWORD, type: 'LOST' })).statusCode).toBe(400);
    expect((await owner.post('/api/v1/ownership/incidents/resolve', {})).statusCode).toBe(400);

    // A session alone is not enough: without the password, or with a wrong one, the loss stays (400, never a 401 that
    // would sign the app out); the session that predates the declaration is refused as the owner's own is.
    for (const c of [other, owner]) {
      const bare = await found_(c, lost.product.productId, null);
      expect(bare.statusCode, bare.body).toBe(400);
      expect(errorOf(bare).code).toBe('VALIDATION_FAILED');
      const wrong = await found_(c, lost.product.productId, 'not the password of this account');
      expect(wrong.statusCode).toBe(400);
      expect(errorOf(wrong)).toEqual({ code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is not correct.' });
    }
    expect((safeJson(await h.client().post('/api/v1/verify', { code: lost.code.data })) as any).state).toBe('SUSPICIOUS_ACTIVITY');
    // Each wrong password counts towards the account's sign-in throttle, said where it was typed.
    const failures = await h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'account.login_failed').orderBy('id', 'desc').limit(2).execute();
    for (const f of failures) expect(f.details).toMatchObject({ via: 'incident_resolve' });

    const theft = await found_(owner, stolen.product.productId);
    expect(theft.statusCode).toBe(409);
    expect(errorOf(theft)).toEqual({ code: 'INCIDENT_NOT_RESOLVABLE', message: 'Only a loss you reported yourself can be withdrawn here. ORBES Client Services can assist you.' });

    const found = await found_(owner, lost.product.productId);
    expect(found.statusCode).toBe(200);
    const body = safeJson(found) as { productId: string; type: string; resolvedAt: string };
    expect(body).toEqual({ productId: lost.product.productId, type: 'LOST', resolvedAt: expect.any(String) });
    expect(found.body).not.toMatch(/OWNED|REGISTERED|status/); // no internal statuses
    expect((safeJson(await h.client().post('/api/v1/verify', { code: lost.code.data })) as any).state).toBe('AUTHENTIC_REGISTERED');
    // Found again, it takes new certificate links (F-06; the earlier ones stay ended).
    const relisted = (safeJson(await owner.get('/api/v1/account/products')) as { products: any[] }).products;
    expect(relisted.find((p) => p.productId === lost.product.productId)).toMatchObject({ incident: null, certificateAllowed: true });
    const again = await found_(owner, lost.product.productId);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('NO_INCIDENT');

    // A session and the CSRF token, like every ownership mutation.
    expect((await found_(h.client(), lost.product.productId)).statusCode).toBe(401);
    expect(errorOf(await owner.post('/api/v1/ownership/incidents/resolve', { productId: stolen.product.productId, currentPassword: PASSWORD }, { noCsrf: true })).code).toBe('CSRF_FAILED');
  });

  it('MY PIECES (F-01): a piece revoked, retired or flagged is not reportable, and a report of it is refused in words about the piece', async () => {
    const owner = (await accountClient(h)).client;
    const pieces = { REVOKED: await sellable(false), RETIRED: await sellable(false), COUNTERFEIT_FLAGGED: await sellable(false) } as const;
    for (const p of Object.values(pieces)) {
      expect((await owner.post('/api/v1/ownership/register', { registrationToken: (await scanForToken(owner, p.code.data)).token })).statusCode).toBe(201);
    }
    const reportable = async () => new Map(((safeJson(await owner.get('/api/v1/account/products')) as { products: any[] }).products).map((p) => [p.productId, p.incidentReportable]));
    for (const p of Object.values(pieces)) expect((await reportable()).get(p.product.productId)).toBe(true);
    for (const [to, p] of Object.entries(pieces)) await h.ctx.services.lifecycle.transition(p.product.productId, to as 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    const listed = await reportable();
    for (const p of Object.values(pieces)) expect(listed.get(p.product.productId)).toBe(false);
    for (const p of Object.values(pieces)) {
      const res = await owner.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'LOST' });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toEqual({ code: 'INCIDENT_NOT_ALLOWED', message: 'This piece cannot be reported here. ORBES Client Services can assist you.' });
    }
  });

  it('F-03: a transfer is accepted for the piece scanned, with the transfer token of that scan', async () => {
    // A seller owns two pieces and offers both: the buyer of one must not be handed the other's code.
    const sold = await sellable(false);
    const kept = await sellable(false);
    const seller = (await accountClient(h)).client;
    for (const p of [sold, kept]) {
      expect((await seller.post('/api/v1/ownership/register', { registrationToken: (await scanForToken(seller, p.code.data)).token })).statusCode).toBe(201);
    }
    const offer = async (p: typeof sold) => (safeJson(await seller.post('/api/v1/ownership/transfers', { productId: p.product.productId })) as { transferCode: string }).transferCode;
    const soldCode = await offer(sold);
    const keptCode = await offer(kept);
    const buyer = (await accountClient(h)).client;
    const accept = (body: unknown) => buyer.post('/api/v1/ownership/transfers/accept', body);

    // The scan of a signed-in reader who does not own the piece carries its transfer token; the owner's and a signed-out reader's do not.
    const scan = safeJson(await buyer.post('/api/v1/verify', { code: sold.code.data })) as any;
    expect(scan).toMatchObject({ state: 'AUTHENTIC_REGISTERED', ownership: { registered: true, you: false, transferPending: true } });
    expect(scan.transfer).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: new Date(h.clock.now().getTime() + 15 * 60_000).toISOString() });
    expect((safeJson(await seller.post('/api/v1/verify', { code: sold.code.data })) as any).transfer).toBeUndefined();
    expect((safeJson(await h.client().post('/api/v1/verify', { code: sold.code.data })) as any).transfer).toBeUndefined();
    const scanned = { transferCode: soldCode, productId: sold.product.productId, transferToken: scan.transfer.token as string };

    // The piece is required (schema), and so is the scan (service): a code alone is refused.
    const noPiece = await accept({ transferCode: soldCode, transferToken: scanned.transferToken });
    expect(noPiece.statusCode).toBe(400);
    expect(errorOf(noPiece).code).toBe('VALIDATION_FAILED');
    const noScan = await accept({ transferCode: soldCode, productId: sold.product.productId });
    expect(noScan.statusCode).toBe(400);
    expect(errorOf(noScan)).toEqual({ code: 'TRANSFER_SCAN_REQUIRED', message: 'Scan this piece while signed in to your ORBES account, then enter its transfer code.' });
    expect((await accept({ ...scanned, transferToken: 'not a scan!' })).statusCode).toBe(400);
    expect((await accept({ ...scanned, extra: true })).statusCode).toBe(400);

    // The code of the other piece: 409, naming neither piece.
    const mismatch = await accept({ ...scanned, transferCode: keptCode });
    expect(mismatch.statusCode).toBe(409);
    expect(errorOf(mismatch)).toEqual({ code: 'TRANSFER_PRODUCT_MISMATCH', message: 'This transfer code is not for this piece. Check the code with the owner of this piece.' });
    expect(mismatch.body).not.toContain(kept.product.productId);
    // The scan of another piece, or another account's scan: refused before the code is read.
    const keptScan = await scanToReceive(buyer, kept.code.data, keptCode);
    expect(errorOf(await accept({ ...scanned, transferToken: keptScan.transferToken })).code).toBe('TRANSFER_TOKEN_INVALID');
    const onlooker = (await accountClient(h)).client;
    const stolenToken = await onlooker.post('/api/v1/ownership/transfers/accept', scanned);
    expect(stolenToken.statusCode).toBe(400);
    expect(errorOf(stolenToken).code).toBe('TRANSFER_TOKEN_INVALID');

    // 15 minutes later the scan has expired: scan again.
    h.clock.advance(15 * 60_000);
    const late = await accept(scanned);
    expect(late.statusCode).toBe(410);
    expect(errorOf(late).code).toBe('TRANSFER_TOKEN_EXPIRED');

    const ok = await accept(await scanToReceive(buyer, sold.code.data, soldCode));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(safeJson(ok)).toMatchObject({ productId: sold.product.productId, verified: false });
    expect(ok.body).not.toContain('transferToken');
    // The kept piece is still the seller's, its transfer still pending.
    expect((safeJson(await h.client().post('/api/v1/verify', { code: kept.code.data })) as any).ownership).toEqual({ registered: true, you: false, transferPending: true });
    expect((safeJson(await buyer.post('/api/v1/verify', { code: sold.code.data })) as any).state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');
  });

  it('F-03: TRANSFER_ACCEPT_REQUIRE_PRODUCT=false (an acceptance assisted by ORBES Client Services) makes the piece and the scan optional, still checked when sent', async () => {
    const assisted = await createHarness({ config: { transferAcceptRequireProduct: false } });
    try {
      const cat = await seedCatalog(assisted.ctx);
      const pieces = [await issue(assisted.ctx, cat), await issue(assisted.ctx, cat)];
      const seller = (await accountClient(assisted)).client;
      const codes: string[] = [];
      for (const p of pieces) {
        await assisted.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
        const reg = (safeJson(await seller.post('/api/v1/verify', { code: p.code.data })) as any).registration.token as string;
        expect((await seller.post('/api/v1/ownership/register', { registrationToken: reg })).statusCode).toBe(201);
        codes.push((safeJson(await seller.post('/api/v1/ownership/transfers', { productId: p.product.productId })) as { transferCode: string }).transferCode);
      }
      const buyer = (await accountClient(assisted)).client;
      const mismatch = await buyer.post('/api/v1/ownership/transfers/accept', { transferCode: codes[1], productId: pieces[0].product.productId });
      expect(errorOf(mismatch).code).toBe('TRANSFER_PRODUCT_MISMATCH');
      // An id never issued gets what an issued one gets, with the code of another piece and with a code that is no
      // one's: no account learns which ids exist.
      const unissued = `${pieces[1].product.productId.slice(0, -5)}99999`;
      expect(await assisted.ctx.db.selectFrom('products').select('id').where('product_id', '=', unissued).executeTakeFirst()).toBeUndefined();
      const pairs: [string, string][] = [];
      for (const transferCode of [codes[1], 'ZZZZ-ZZZZ-ZZZZ']) {
        const issued = await buyer.post('/api/v1/ownership/transfers/accept', { transferCode, productId: pieces[0].product.productId });
        const never = await buyer.post('/api/v1/ownership/transfers/accept', { transferCode, productId: unissued });
        expect(never.statusCode, transferCode).toBe(issued.statusCode);
        expect(errorOf(never), transferCode).toEqual(errorOf(issued));
        pairs.push([String(issued.statusCode), errorOf(issued).code]);
      }
      expect(pairs).toEqual([
        ['409', 'TRANSFER_PRODUCT_MISMATCH'],
        ['404', 'TRANSFER_NOT_FOUND'],
      ]);
      const ok = await buyer.post('/api/v1/ownership/transfers/accept', { transferCode: codes[1] });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(safeJson(ok)).toMatchObject({ productId: pieces[1].product.productId });
    } finally {
      await assisted.close();
    }
  });

  it('every ownership mutation needs a session and the CSRF token', async () => {
    const anon = h.client();
    expect((await anon.post('/api/v1/ownership/transfers', { productId: 'O26-J-00001' })).statusCode).toBe(401);
    const { client } = await accountClient(h);
    const noToken = await client.post('/api/v1/ownership/transfers', { productId: 'O26-J-00001' }, { noCsrf: true });
    expect(noToken.statusCode).toBe(403);
    expect(errorOf(noToken).code).toBe('CSRF_FAILED');
  });
});
