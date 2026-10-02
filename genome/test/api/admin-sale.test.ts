/**
 * The sale mode (A-08): a RETAIL account created on the Team page, the
 * points of sale, the staff scan (`POST /api/admin/sale/lookup`: one
 * ADMIN_TEST scan naming the console user, outside the history rules but
 * with the code's own findings of steps 6–7 marked staffScan, a 10-minute
 * token when the piece can be sold) and the activation it allows
 * (`POST /api/admin/sale/activate`), and the point of sale chosen from the
 * register in the console's own warranty activation.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData, signingMessage, unframeCodeData } from '../../src/core/payload.js';
import { SALE_REFUSAL_MESSAGES, SALE_REVIEW_MESSAGE } from '../../src/server/routes/admin/sale.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SALE_TOKEN_TTL_MS } from '../../src/server/services/sale.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { adminClient, accountClient, createAdmin, createHarness, errorOf, issue, PASSWORD, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface LookupJson {
  scanId: string;
  state: string;
  piece: null | {
    productId: string;
    status: string;
    category: { code: string; name: string };
    collection: string | null;
    model: string;
    type: string;
    variant: string | null;
    material: string;
    createdYear: number;
    registered: boolean;
    warranty: { status: string; startDate: string | null; endDate: string | null };
  };
  sale: { token: string; expiresAt: string } | null;
  refusal: { code: string; message: string } | null;
}

interface RetailerJson {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  active: boolean;
}

const body = <T>(res: { body: string }) => safeJson(res as never) as T;

/** What the console's decoder sends for a printed code: the data and the genome it read. */
const scanOf = (r: IssueResult) => ({ code: r.code.data, genome: { glyphs: [...r.genome.glyphs] }, client: { source: 'camera' as const, decodeMs: 180 } });

async function signIn(h: Harness, email: string, password: string): Promise<Client> {
  const c = h.client();
  const res = await c.post('/api/admin/auth/login', { email, password });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return c;
}

describe('sale mode (A-08)', () => {
  let h: Harness;
  let catalog: Catalog;
  let boss: Client;
  let seller: Client;
  let sellerId: string;
  let shop: RetailerJson;
  let online: RetailerJson;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    boss = await adminClient(h, 'ADMIN');
    const a = await createAdmin(h.ctx, 'RETAIL');
    sellerId = a.id;
    seller = await signIn(h, a.email, a.password);
    shop = body<{ retailer: RetailerJson }>(await boss.post('/api/admin/retailers', { name: 'ORBES Paris — Saint-Honoré', city: 'Paris', country: 'fr' })).retailer;
    online = body<{ retailer: RetailerJson }>(await boss.post('/api/admin/retailers', { name: 'ORBES.COM — Online boutique', country: 'DE' })).retailer;
  });
  afterAll(() => h?.close());

  const lookup = async (c: Client, input: unknown) => {
    const res = await c.post('/api/admin/sale/lookup', input);
    expect(res.statusCode, res.body).toBe(200);
    return body<LookupJson>(res);
  };

  it('a RETAIL account created on the Team page signs in, must replace its temporary password, then reaches the sale mode and nothing else', async () => {
    const email = `seller-${randomUUID().slice(0, 6)}@orbes.test`;
    const created = await boss.post('/api/admin/admins', { email, role: 'RETAIL' });
    expect(created.statusCode, created.body).toBe(201);
    const { admin, temporaryPassword } = body<{ admin: { role: string; passwordChangeRequired: boolean }; temporaryPassword: string }>(created);
    expect(admin).toMatchObject({ role: 'RETAIL', passwordChangeRequired: true });

    const c = await signIn(h, email, temporaryPassword);
    const me = body<{ admin: { role: string; passwordChangeRequired: boolean } }>(await c.get('/api/admin/auth/me'));
    expect(me.admin).toMatchObject({ role: 'RETAIL', passwordChangeRequired: true });
    for (const [method, url] of [
      ['POST', '/api/admin/sale/lookup'],
      ['GET', '/api/admin/retailers'],
      ['POST', '/api/admin/auth/totp/setup'],
    ] as const) {
      const res = await c.request(method, url, method === 'POST' ? { body: { code: 'x' } } : {});
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const changed = await c.post('/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'boutique passphrase 2026' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(body<{ admin: { passwordChangeRequired: boolean } }>(changed).admin.passwordChangeRequired).toBe(false);

    const piece = await issue(h.ctx, catalog);
    const r = await lookup(c, scanOf(piece));
    expect(r.state).toBe('AUTHENTIC');
    expect(r.sale?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await c.get('/api/admin/retailers?active=true')).statusCode).toBe(200);
    for (const [method, url] of [
      ['GET', '/api/admin/products'],
      ['GET', `/api/admin/products/${piece.product.productId}`],
      ['POST', '/api/admin/products'],
      ['GET', `/api/admin/codes/${piece.code.id}/artifact.svg`],
      ['POST', '/api/admin/certificates'],
      ['GET', '/api/admin/owners'],
      ['GET', '/api/admin/scans'],
      ['POST', `/api/admin/products/${piece.product.productId}/warranty/activate`],
      ['POST', '/api/admin/retailers'],
      ['GET', '/api/admin/admins'],
      ['GET', '/api/admin/dashboard'],
    ] as const) {
      const res = await c.request(method, url, method === 'POST' ? { body: {} } : {});
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('FORBIDDEN');
    }
    // A sign-out like any console user.
    expect((await c.post('/api/admin/auth/logout')).statusCode).toBe(200);
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(401);
  });

  it('lookup records one ADMIN_TEST scan naming the seller, without any anomaly for a piece in order, and returns the piece with a 10-minute token', async () => {
    const piece = await issue(h.ctx, catalog, { variant: '52' });
    const anomaliesBefore = await h.ctx.db.selectFrom('anomalies').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const r = await lookup(seller, scanOf(piece));
    expect(r).toEqual({
      scanId: expect.any(String),
      state: 'AUTHENTIC',
      piece: {
        productId: piece.product.productId,
        status: 'ISSUED',
        category: { code: 'J', name: 'Jewelry' },
        collection: expect.stringMatching(/^ORBIT-/),
        model: 'MONOLITHE',
        type: 'RING',
        variant: '52',
        material: '925 STERLING SILVER',
        createdYear: piece.product.year,
        registered: false,
        warranty: { status: 'NOT_STARTED', startDate: null, endDate: null },
      },
      sale: { token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: new Date(h.clock.now().getTime() + SALE_TOKEN_TTL_MS).toISOString() },
      refusal: null,
    });

    const scan = await h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', r.scanId).executeTakeFirstOrThrow();
    expect(scan).toMatchObject({ event_type: 'ADMIN_TEST', admin_id: sellerId, account_id: null, result_state: 'AUTHENTIC', product_id: piece.product.id, code_id: piece.code.id });
    expect(scan.client_metrics).toEqual({ source: 'camera', decodeMs: 180 });
    const auth = await h.ctx.db.selectFrom('authentication_events').selectAll().where('scan_event_id', '=', r.scanId).executeTakeFirstOrThrow();
    expect(auth).toMatchObject({ state: 'AUTHENTIC', signature_valid: true, genome_check: 'MATCH', risk_score: 0 });
    const token = await h.ctx.db.selectFrom('scan_tokens').selectAll().where('scan_event_id', '=', r.scanId).executeTakeFirstOrThrow();
    expect(token).toMatchObject({ purpose: 'SALE_ACTIVATION', product_id: piece.product.id, used_at: null });
    const anomaliesAfter = await h.ctx.db.selectFrom('anomalies').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(anomaliesAfter.n)).toBe(Number(anomaliesBefore.n));

    // The console's scan list names the seller.
    const scans = body<{ items: { id: string; eventType: string; adminEmail: string | null }[] }>(await boss.get(`/api/admin/scans?productId=${piece.product.productId}`));
    const row = scans.items.find((s) => s.id === r.scanId)!;
    expect(row.eventType).toBe('ADMIN_TEST');
    expect(row.adminEmail).toMatch(/^retail-/);
  });

  it('activate uses the token up and starts the warranty today at the point of sale, audited with the scan', async () => {
    const piece = await issue(h.ctx, catalog);
    const r = await lookup(seller, scanOf(piece));
    const res = await seller.post('/api/admin/sale/activate', { token: r.sale!.token, retailerId: shop.id });
    expect(res.statusCode, res.body).toBe(200);
    const today = h.clock.now().toISOString().slice(0, 10);
    const out = body<{ warranty: Record<string, unknown>; statusChange: { from: string; to: string } | null; scanId: string }>(res);
    expect(out.warranty).toMatchObject({ productId: piece.product.productId, purchaseDate: today, startDate: today, status: 'ACTIVE', retailer: shop.name, retailerId: shop.id, country: 'FR' });
    expect(out.statusChange).toMatchObject({ from: 'ISSUED', to: 'ACTIVATED' });
    expect(out.scanId).toBe(r.scanId);

    const entries = await h.ctx.audit.list({ action: 'warranty.activate', targetId: piece.product.productId });
    expect(entries.items[0]).toMatchObject({ actorType: 'admin', actorId: sellerId });
    expect(entries.items[0].details).toMatchObject({ retailer: shop.name, retailerId: shop.id, country: 'FR', saleScanId: r.scanId });

    // Used once.
    const again = await seller.post('/api/admin/sale/activate', { token: r.sale!.token, retailerId: shop.id });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('SALE_TOKEN_USED');
    // A second scan of the sold piece gets no token, and says why.
    const sold = await lookup(seller, scanOf(piece));
    expect(sold.sale).toBeNull();
    expect(sold.refusal?.code).toBe('WARRANTY_ACTIVE');
    expect(sold.piece?.warranty.status).toBe('ACTIVE');
    // The console shows the point of sale by name.
    const detail = body<{ warranty: { retailer: string; retailerId: string } }>(await boss.get(`/api/admin/products/${piece.product.productId}`));
    expect(detail.warranty).toMatchObject({ retailer: shop.name, retailerId: shop.id });
    // The client can now register it from the card, as the sale screen tells them.
    const pub = await h.client().post('/api/v1/verify', { code: piece.code.data });
    expect(body<{ state: string }>(pub).state).toBe('AUTHENTIC_FIRST_REGISTRATION');
  });

  it('the token ties the activation to the seller, the piece and the time of the scan', async () => {
    const other = await adminClient(h, 'RETAIL');
    const piece = await issue(h.ctx, catalog);
    const r = await lookup(seller, scanOf(piece));

    // Another console user cannot use it, and the refusal leaves it usable.
    const stolen = await other.post('/api/admin/sale/activate', { token: r.sale!.token, retailerId: shop.id });
    expect(stolen.statusCode).toBe(400);
    expect(errorOf(stolen).code).toBe('SALE_TOKEN_INVALID');
    // An inactive or unknown point of sale is refused, the token stays usable.
    const closed = body<{ retailer: RetailerJson }>(await boss.post('/api/admin/retailers', { name: `Pop-up ${randomUUID().slice(0, 4)}`, city: 'Cannes', country: 'FR' })).retailer;
    expect((await boss.patch(`/api/admin/retailers/${closed.id}`, { active: false })).statusCode).toBe(200);
    const inactive = await seller.post('/api/admin/sale/activate', { token: r.sale!.token, retailerId: closed.id });
    expect(inactive.statusCode).toBe(409);
    expect(errorOf(inactive).code).toBe('RETAILER_INACTIVE');
    const unknown = await seller.post('/api/admin/sale/activate', { token: r.sale!.token, retailerId: randomUUID() });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('RETAILER_NOT_FOUND');
    expect((await seller.post('/api/admin/sale/activate', { token: r.sale!.token, retailerId: online.id })).statusCode).toBe(200);
    expect((await h.ctx.services.warranty.get(piece.product.productId))?.country).toBe('DE');

    // Ten minutes, then a new scan.
    const late = await issue(h.ctx, catalog);
    const l = await lookup(seller, scanOf(late));
    h.clock.advance(SALE_TOKEN_TTL_MS + 1_000);
    const expired = await seller.post('/api/admin/sale/activate', { token: l.sale!.token, retailerId: shop.id });
    expect(expired.statusCode).toBe(410);
    expect(errorOf(expired).code).toBe('SALE_TOKEN_EXPIRED');

    // A registration token (the public result) is not a sale token, nor the other way round.
    await h.ctx.services.warranty.activate(late.product.productId, {}, SYSTEM_ACTOR);
    const pub = body<{ registration?: { token: string } }>(await h.client().post('/api/v1/verify', { code: late.code.data }));
    expect(pub.registration?.token).toBeDefined();
    const wrongPurpose = await seller.post('/api/admin/sale/activate', { token: pub.registration!.token, retailerId: shop.id });
    expect(errorOf(wrongPurpose).code).toBe('SALE_TOKEN_INVALID');
    const fresh = await issue(h.ctx, catalog);
    const f = await lookup(seller, scanOf(fresh));
    await h.ctx.services.warranty.activate(fresh.product.productId, {}, SYSTEM_ACTOR);
    const { client: customer } = await accountClient(h);
    const register = await customer.post('/api/v1/ownership/register', { registrationToken: f.sale!.token });
    expect(errorOf(register).code).toBe('REGISTRATION_TOKEN_INVALID');

    for (const token of ['', 'not a token', 'A'.repeat(43)]) {
      const res = await seller.post('/api/admin/sale/activate', { token, retailerId: shop.id });
      expect(res.statusCode, token).toBe(400);
      expect(['VALIDATION_FAILED', 'SALE_TOKEN_INVALID']).toContain(errorOf(res).code);
    }
    expect((await seller.post('/api/admin/sale/activate', { token: f.sale!.token })).statusCode).toBe(400);
  });

  it('a code that does not verify, a lost piece or a void warranty gets no token; the code’s own findings are recorded, never the history rules', async () => {
    const count = async () => Number((await h.ctx.db.selectFrom('anomalies').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    const before = await count();

    // A forged signature: no piece, no token, an ADMIN_TEST scan all the same, and nothing to page on (no key vouches for it).
    const genuine = await issue(h.ctx, catalog);
    const { payloadBytes, signature } = unframeCodeData(fromBase64Url(genuine.code.data));
    const sig = signature.slice();
    sig[9] ^= 0x10;
    const forged = await lookup(seller, { code: toBase64Url(frameCodeData(payloadBytes, sig)) });
    expect(forged).toMatchObject({ state: 'INVALID_SIGNATURE', piece: null, sale: null, refusal: { code: 'NOT_AUTHENTIC', message: SALE_REFUSAL_MESSAGES.NOT_AUTHENTIC } });
    expect(forged.refusal?.message).toMatch(/did not verify/);
    expect((await h.ctx.db.selectFrom('scan_events').select(['event_type', 'admin_id']).where('id', '=', forged.scanId).executeTakeFirstOrThrow())).toEqual({ event_type: 'ADMIN_TEST', admin_id: sellerId });
    expect((await lookup(seller, { code: 'not-a-code' })).state).toBe('MALFORMED_CODE');
    expect(await count()).toBe(before);

    // A genome that does not match the signed identity (a copied seal, redrawn): the piece is ORBES's, so the
    // sentence asks for a review, and the finding is recorded as /verify records it, marked staffScan.
    const g = [...genuine.genome.glyphs];
    g[0] = (g[0] + 1) % 16;
    g[1] = (g[1] + 1) % 16;
    const mismatch = await lookup(seller, { code: genuine.code.data, genome: { glyphs: g } });
    expect(mismatch).toMatchObject({ state: 'SUSPICIOUS_ACTIVITY', sale: null, refusal: { code: 'NOT_AUTHENTIC', message: SALE_REVIEW_MESSAGE }, piece: { productId: genuine.product.productId } });
    const seal = await h.ctx.db.selectFrom('anomalies').selectAll().where('product_id', '=', genuine.product.id).execute();
    expect(seal).toEqual([expect.objectContaining({ type: 'GENOME_MISMATCH', severity: 'HIGH', status: 'OPEN', details: expect.objectContaining({ staffScan: true }) })]);
    expect(await h.ctx.db.selectFrom('authentication_events').select(['risk_score', 'reasons']).where('scan_event_id', '=', mismatch.scanId).executeTakeFirstOrThrow()).toEqual({
      risk_score: 60,
      reasons: ['GENOME_MISMATCH'],
    });

    // A code validly signed by ORBES for an identity it never registered (a possible key compromise, shown at
    // the counter): CRITICAL, as on /verify, marked staffScan.
    const signer = await h.ctx.keys.activeSigner();
    const identity = { year: 2026, categoryIndex: 1, serial: 99_901 };
    const payload = encodePayload({ codeVersion: 1, genomeVersion: 1, keyId: signer.keyId, identity, issue: 1, issuedDay: 880, nonce: Uint8Array.from(randomBytes(4)) });
    const unregistered = await lookup(seller, { code: toBase64Url(frameCodeData(payload, await signer.sign(signingMessage(payload)))) });
    expect(unregistered).toMatchObject({ state: 'UNKNOWN', piece: null, sale: null, refusal: { code: 'NOT_AUTHENTIC', message: SALE_REFUSAL_MESSAGES.NOT_AUTHENTIC } });
    const critical = (await h.ctx.db.selectFrom('anomalies').selectAll().where('type', '=', 'VALID_SIGNATURE_UNREGISTERED').execute()).filter(
      (a) => (a.details as { packedIdentity?: number }).packedIdentity === packIdentity(identity),
    );
    expect(critical).toEqual([
      expect.objectContaining({ severity: 'CRITICAL', risk_score: 100, product_id: null, details: expect.objectContaining({ reason: 'PRODUCT_NOT_REGISTERED', staffScan: true }) }),
    ]);
    expect(await count()).toBe(before + 2);

    // Known, but reported lost; or a warranty voided.
    const lost = await issue(h.ctx, catalog);
    await h.ctx.services.lifecycle.transition(lost.product.productId, 'LOST', { reason: 'test' }, SYSTEM_ACTOR);
    const l = await lookup(seller, scanOf(lost));
    expect(l).toMatchObject({
      state: 'SUSPICIOUS_ACTIVITY',
      sale: null,
      refusal: { code: 'NOT_AUTHENTIC', message: SALE_REVIEW_MESSAGE },
      piece: { productId: lost.product.productId, status: 'LOST' },
    });
    const voided = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.void(voided.product.productId, 'grey market', SYSTEM_ACTOR);
    expect((await lookup(seller, scanOf(voided))).refusal?.code).toBe('WARRANTY_VOID');
    // A lost piece scanned by staff adds no LOST_STOLEN_SCAN: the history rules stay out.
    expect(await count()).toBe(before + 2);

    // Thirty scans of one code in a minute: verify() would flag the velocity, a staff scan never does.
    const busy = await issue(h.ctx, catalog);
    for (let i = 0; i < 30; i++) await lookup(seller, scanOf(busy));
    expect(await count()).toBe(before + 2);
    // …and they do not count in the public history either.
    const pub = body<{ state: string }>(await h.client().post('/api/v1/verify', { code: busy.code.data }));
    expect(pub.state).toBe('AUTHENTIC');
  });

  it('a piece in a pre-sale service, or one a client already holds, gets no token', async () => {
    // In a service opened before any sale (ISSUED → SERVICED, an inspection): at the workshop, not for sale.
    const inspected = await issue(h.ctx, catalog);
    const svc = await h.ctx.services.warranty.openService(inspected.product.productId, { type: 'INSPECTION' }, SYSTEM_ACTOR);
    const preSale = await lookup(seller, scanOf(inspected));
    expect(preSale).toMatchObject({ state: 'AUTHENTIC', sale: null, refusal: { code: 'NOT_FOR_SALE' }, piece: { status: 'SERVICED', registered: false } });
    expect(await h.ctx.db.selectFrom('scan_tokens').select('id_hash').where('product_id', '=', inspected.product.id).execute()).toEqual([]);
    // Once the inspection is over, the piece is ISSUED again and can be sold.
    await h.ctx.services.warranty.completeService(svc.id, {}, SYSTEM_ACTOR);
    expect((await lookup(seller, scanOf(inspected))).sale?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Moved to ACTIVATED by a transition (no warranty started), then registered by its buyer: sold, whatever the warranty says.
    const held = await issue(h.ctx, catalog);
    await h.ctx.services.lifecycle.transition(held.product.productId, 'ACTIVATED', { reason: 'delivered' }, SYSTEM_ACTOR);
    const token = body<{ registration?: { token: string } }>(await h.client().post('/api/v1/verify', { code: held.code.data })).registration!.token;
    const { client: buyer } = await accountClient(h);
    const registration = await buyer.post('/api/v1/ownership/register', { registrationToken: token });
    expect(registration.statusCode, registration.body).toBe(201);
    const registered = await lookup(seller, scanOf(held));
    expect(registered).toMatchObject({
      state: 'AUTHENTIC',
      sale: null,
      refusal: { code: 'ALREADY_REGISTERED', message: SALE_REFUSAL_MESSAGES.ALREADY_REGISTERED },
      piece: { registered: true, warranty: { status: 'NOT_STARTED' } },
    });
    expect(await h.ctx.db.selectFrom('scan_tokens').select('purpose').where('product_id', '=', held.product.id).where('purpose', '=', 'SALE_ACTIVATION').execute()).toEqual([]);
  });

  it('points of sale: ADMIN creates, renames and deactivates; every role down to RETAIL reads the list', async () => {
    const dup = await boss.post('/api/admin/retailers', { name: 'orbes paris — saint-honoré', city: 'PARIS' });
    expect(dup.statusCode).toBe(409);
    expect(errorOf(dup).code).toBe('RETAILER_EXISTS');
    const created = await boss.post('/api/admin/retailers', { name: 'ORBES Tokyo — Ginza', city: 'Tokyo', country: 'JP' });
    expect(created.statusCode).toBe(201);
    const tokyo = body<{ retailer: RetailerJson }>(created).retailer;
    expect(tokyo).toMatchObject({ name: 'ORBES Tokyo — Ginza', city: 'Tokyo', country: 'JP', active: true });
    const renamed = await boss.patch(`/api/admin/retailers/${tokyo.id}`, { name: 'ORBES Tokyo — Ginza Six', active: false });
    expect(body<{ retailer: RetailerJson }>(renamed).retailer).toMatchObject({ name: 'ORBES Tokyo — Ginza Six', active: false });
    expect((await boss.patch(`/api/admin/retailers/${tokyo.id}`, {})).statusCode).toBe(400);
    expect((await boss.patch(`/api/admin/retailers/${randomUUID()}`, { active: true })).statusCode).toBe(404);

    const all = body<{ items: RetailerJson[] }>(await seller.get('/api/admin/retailers')).items;
    const active = body<{ items: RetailerJson[] }>(await seller.get('/api/admin/retailers?active=true')).items;
    expect(all.some((r) => r.id === tokyo.id)).toBe(true);
    expect(active.some((r) => r.id === tokyo.id)).toBe(false);
    expect(active.every((r) => r.active)).toBe(true);
    const auditor = await adminClient(h, 'AUDITOR');
    expect((await auditor.get('/api/admin/retailers')).statusCode).toBe(200);
    const operator = await adminClient(h, 'OPERATOR');
    expect((await operator.post('/api/admin/retailers', { name: 'X' })).statusCode).toBe(403);
    expect((await operator.patch(`/api/admin/retailers/${tokyo.id}`, { active: true })).statusCode).toBe(403);
    const entries = await h.ctx.audit.list({ action: 'retailer.update', targetId: tokyo.id });
    expect(entries.items[0].details).toEqual({ before: { name: 'ORBES Tokyo — Ginza', active: true }, after: { name: 'ORBES Tokyo — Ginza Six', active: false } });
  });

  it('the console warranty activation takes a point of sale from the register; the free text stays accepted', async () => {
    const operator = await adminClient(h, 'OPERATOR');
    const a = await issue(h.ctx, catalog);
    const res = await operator.post(`/api/admin/products/${a.product.productId}/warranty/activate`, { purchaseDate: '', retailerId: shop.id, retailer: '', country: '' });
    expect(res.statusCode, res.body).toBe(200);
    expect(body<{ warranty: Record<string, unknown> }>(res).warranty).toMatchObject({ retailer: shop.name, retailerId: shop.id, country: 'FR' });
    const b = await issue(h.ctx, catalog);
    const text = await operator.post(`/api/admin/products/${b.product.productId}/warranty/activate`, { retailer: 'Atelier Rive Gauche', country: 'FR' });
    expect(body<{ warranty: Record<string, unknown> }>(text).warranty).toMatchObject({ retailer: 'Atelier Rive Gauche', retailerId: null });
    const bad = await operator.post(`/api/admin/products/${b.product.productId}/warranty/activate`, { retailerId: 'shop-1' });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad).code).toBe('VALIDATION_FAILED');
    // Warranties list: the name from the register.
    const list = body<{ items: { productId: string; retailer: string | null }[] }>(await operator.get('/api/admin/warranties?pageSize=200'));
    expect(list.items.find((w) => w.productId === a.product.productId)?.retailer).toBe(shop.name);
  });

  it('a seller keeps a password of their own and can sign in again after a sale', async () => {
    const c = await signIn(h, (await h.ctx.services.auth.getAdmin(sellerId)).email, PASSWORD);
    expect(body<{ admin: { role: string } }>(await c.get('/api/admin/auth/me')).admin.role).toBe('RETAIL');
  });
});
