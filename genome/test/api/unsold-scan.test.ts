/**
 * S-07 through HTTP: POST /api/v1/verify of a piece ORBES has not sold yet
 * records UNSOLD_PIECE_SCAN (with the country, once per piece and per UTC day)
 * and answers exactly what it answered before; a request that carries a
 * console session the console would let in is a staff scan: ADMIN_TEST under
 * that console user, no finding, no registration token.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { accountClient, adminClient, createAdmin, createHarness, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const COUNTRY_HEADER = 'x-orbes-geo-country';

interface VerifyJson {
  state: string;
  scanId: string;
  registration?: { token: string };
  [k: string]: unknown;
}

/** A harness whose edge reports the client's country in a header (GEO_MODE=headers behind TRUST_PROXY). */
function geoHarness(opts: { requireAdminMfa?: boolean } = {}): Promise<Harness> {
  return createHarness({
    config: { trustProxy: true, geo: { mode: 'headers', countryHeader: COUNTRY_HEADER } },
    ...(opts.requireAdminMfa ? { app: { requireAdminMfa: true } } : {}),
  });
}

async function scan(c: Client, code: string, country = 'FR'): Promise<VerifyJson> {
  const res = await c.post('/api/v1/verify', { code }, { headers: { [COUNTRY_HEADER]: country } });
  expect(res.statusCode).toBe(200);
  return safeJson(res) as VerifyJson;
}

async function scanRow(h: Harness, scanId: string) {
  return h.ctx.db.selectFrom('scan_events').select(['event_type', 'admin_id', 'device_hash', 'session_hash', 'account_id', 'country']).where('id', '=', scanId).executeTakeFirstOrThrow();
}

async function unsold(h: Harness, productUuid: string) {
  return h.ctx.db.selectFrom('anomalies').selectAll().where('product_id', '=', productUuid).where('type', '=', 'UNSOLD_PIECE_SCAN').execute();
}

async function findings(h: Harness, productUuid: string) {
  return h.ctx.db.selectFrom('anomalies').select('type').where('product_id', '=', productUuid).execute();
}

const adminIdOf = async (c: Client) => (safeJson(await c.get('/api/admin/auth/me')) as { admin: { id: string } }).admin.id;

describe('POST /api/v1/verify: unsold pieces and staff scans (S-07)', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await geoHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  it('a stranger scanning an ISSUED piece: AUTHENTIC as before, and one UNSOLD_PIECE_SCAN with the country a day', async () => {
    const r = await issue(h.ctx, catalog);
    const first = await scan(h.client({ ip: '198.51.100.7' }), r.code.data, 'IT');
    expect(first.state).toBe('AUTHENTIC');
    expect(first.title).toBe('AUTHENTIC');
    expect(first.registration).toBeUndefined();
    expect(Object.keys(first).sort()).toEqual(['genome', 'message', 'ownership', 'product', 'scanId', 'state', 'title', 'verification', 'verifiedAt', 'warranty']);
    expect(await scanRow(h, first.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null, country: 'IT' });
    // Another phone the same day: the same answer, nothing more recorded.
    const second = await scan(h.client({ ip: '198.51.100.8' }), r.code.data, 'FR');
    expect(second.state).toBe('AUTHENTIC');
    const rows = await unsold(h, r.product.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 'MEDIUM', risk_score: 0, status: 'OPEN', occurrences: 1, details: { country: 'IT', productStatus: 'ISSUED', scanEventId: first.scanId } });
  });

  it('a sold piece (ACTIVATED) records none', async () => {
    const r = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(r.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, { type: 'system' });
    const out = await scan(h.client({ ip: '198.51.100.9' }), r.code.data);
    expect(out.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect(out.registration?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await findings(h, r.product.id)).toEqual([]);
  });

  it('a browser signed in to the console scans as staff: ADMIN_TEST under that console user, no finding, nothing of the browser recorded', async () => {
    const r = await issue(h.ctx, catalog);
    const seller = await adminClient(h, 'RETAIL', { ip: '198.51.100.20' });
    const sellerId = await adminIdOf(seller);
    const out = await scan(seller, r.code.data, 'FR');
    expect(out.state).toBe('AUTHENTIC');
    expect(JSON.stringify(out)).not.toContain(sellerId);
    expect(await scanRow(h, out.scanId)).toEqual({ event_type: 'ADMIN_TEST', admin_id: sellerId, device_hash: null, session_hash: null, account_id: null, country: 'FR' });
    expect(await findings(h, r.product.id)).toEqual([]);
    // The console lists it among the verification events, naming the seller.
    const ops = await adminClient(h, 'AUDITOR');
    const events = safeJson(await ops.get(`/api/admin/scans?productId=${r.product.productId}`)) as { items: { eventType: string; adminEmail: string | null }[] };
    expect(events.items).toEqual([expect.objectContaining({ eventType: 'ADMIN_TEST', adminEmail: expect.stringMatching(/^retail-.*@orbes\.test$/) })]);
  });

  it('a staff scan of a sold piece offers no registration, even with a customer account signed in beside the console', async () => {
    const r = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.warranty.activate(r.product.id, { purchaseDate: '2026-09-20', retailer: 'ORBES PARIS', country: 'FR' }, { type: 'system' });
    const { client } = await accountClient(h, { ip: '198.51.100.30' });
    const creds = await createAdmin(h.ctx, 'OPERATOR');
    expect((await client.post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    const out = await scan(client, r.code.data);
    expect(out.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    expect(out.registration).toBeUndefined();
    expect(await scanRow(h, out.scanId)).toMatchObject({ event_type: 'ADMIN_TEST', admin_id: creds.id, account_id: null, session_hash: null });
    expect(await h.ctx.db.selectFrom('scan_tokens').select('id_hash').where('product_id', '=', r.product.id).execute()).toEqual([]);

    // Signed out of the console, the same browser is a buyer again.
    expect((await client.post('/api/admin/auth/logout')).statusCode).toBe(200);
    const again = await scan(client, r.code.data);
    expect(again.registration?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await scanRow(h, again.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null });
  });

  it('a console session the console would refuse is no staff session: temporary password, disabled account', async () => {
    const r = await issue(h.ctx, catalog);
    const pending = await adminClient(h, 'OPERATOR', { ip: '198.51.100.40' });
    const pendingId = await adminIdOf(pending);
    await h.ctx.db.updateTable('admin_users').set({ password_change_required: true }).where('id', '=', pendingId).execute();
    const a = await scan(pending, r.code.data);
    expect(await scanRow(h, a.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null });
    expect(await unsold(h, r.product.id)).toHaveLength(1);

    const gone = await adminClient(h, 'RETAIL', { ip: '198.51.100.41' });
    await h.ctx.db.updateTable('admin_users').set({ disabled_at: new Date() }).where('id', '=', await adminIdOf(gone)).execute();
    const b = await scan(gone, r.code.data);
    expect(await scanRow(h, b.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null });
  });
});

describe('POST /api/v1/verify: staff scans when the console requires its second factor (S-07)', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await geoHarness({ requireAdminMfa: true });
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  it('a console session counts as staff only once past its second factor', async () => {
    const r = await issue(h.ctx, catalog);
    const creds = await createAdmin(h.ctx, 'RETAIL');
    const c = h.client({ ip: '198.51.100.50' });
    expect((await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    // Password only: a public scan, which records the finding.
    const before = await scan(c, r.code.data);
    expect(await scanRow(h, before.scanId)).toMatchObject({ event_type: 'VERIFY', admin_id: null });
    expect(await unsold(h, r.product.id)).toHaveLength(1);

    const { secret } = safeJson(await c.post('/api/admin/auth/totp/setup')) as { secret: string };
    expect((await c.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), h.clock.now().getTime()) })).statusCode).toBe(200);
    const after = await scan(c, r.code.data);
    expect(await scanRow(h, after.scanId)).toMatchObject({ event_type: 'ADMIN_TEST', admin_id: creds.id });
  });
});
