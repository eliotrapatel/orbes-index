/**
 * End-to-end API run on real PostgreSQL with a production configuration
 * (opt-in): local AES-GCM key custody, migrations on request, bootstrap
 * admin with enforced TOTP, Secure cookies, then the whole product journey
 * over HTTP and a burst of concurrent verifications on an 8-connection pool.
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/api/postgres.test.ts
 *
 * The role needs CREATEDB; the throwaway database is dropped afterwards.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { addDays, aggregateScanStats, utcDay } from '../../src/server/services/scan-stats.js';
import { Client, PASSWORD, safeJson } from './support.js';
import type { FastifyInstance } from 'fastify';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
const ORIGIN = 'https://verify.orbes.example';

describe.skipIf(!adminUrl)('API on PostgreSQL (production configuration)', () => {
  let admin: Db;
  let ctx: AppContext;
  let app: FastifyInstance;
  let keyDir: string;
  const dbName = `orbes_api_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    keyDir = mkdtempSync(join(tmpdir(), 'orbes-keys-'));
    const config = testConfig({
      env: 'production',
      publicOrigin: ORIGIN,
      databaseUrl: u.toString(),
      cookieSecret: randomBytes(36).toString('base64url'),
      ipHashPepper: randomBytes(36).toString('base64url'),
      keys: { provider: 'local', dir: join(keyDir, 'k'), encryptionKey: randomBytes(32).toString('base64url') },
      bootstrapAdmin: { email: 'root@orbes.example', password: PASSWORD },
      rateLimits: { verifyPerMinute: 10_000, authPerMinute: 10_000, adminPerMinute: 10_000 },
    });
    ctx = await createContext(config, { migrate: true, ensureActiveKey: true });
    app = await buildApp(ctx, { serveStatic: false });
  });

  afterAll(async () => {
    await app?.close();
    await ctx?.close();
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  const client = () => new Client(app, { origin: ORIGIN });

  it('runs the product journey end to end', async () => {
    // ── Admin: password, TOTP enrolment (MFA is enforced in production) ──
    const op = client();
    const login = await op.post('/api/admin/auth/login', { email: 'root@orbes.example', password: PASSWORD });
    expect(login.statusCode).toBe(200);
    expect(login.cookies.find((x) => x.name === '__Host-orbes_admin')?.secure).toBe(true);
    expect((await op.get('/api/admin/dashboard')).statusCode).toBe(403);
    const { secret } = safeJson(await op.post('/api/admin/auth/totp/setup')) as { secret: string };
    expect((await op.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), Date.now()) })).statusCode).toBe(200);

    // ── Catalogue and issuance ──
    expect((await op.post('/api/admin/categories', { code: 'J', name: 'Jewelry' })).statusCode).toBe(201);
    const col = safeJson(await op.post('/api/admin/collections', { name: 'ORBIT' })) as { id: string };
    const model = safeJson(await op.post('/api/admin/models', { categoryCode: 'J', collectionId: col.id, name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL', sizeType: 'RING' })) as { id: string };
    // Its pieces are issued as on a model of before H1 (plan NEXT LOT §3.3: its size type to give), the Generator's sizes
    // free text as before.
    await ctx.db.updateTable('models').set({ size_type: null }).where('id', '=', model.id).execute();
    const issued = await op.post('/api/admin/products', { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER', withClaimSecret: true });
    expect(issued.statusCode, issued.body).toBe(201);
    const p = safeJson(issued) as any;
    const svg = await op.get(`/api/admin/codes/${p.code.id}/artifact.svg`);
    expect(svg.statusCode).toBe(200);
    expect((await op.post(`/api/admin/products/${p.product.productId}/warranty/activate`, { retailer: 'ORBES PARIS', country: 'FR' })).statusCode).toBe(200);

    // ── Customer: scan, register with the claim code ──
    const owner = client();
    expect((await owner.post('/api/v1/account/register', { email: 'owner@example.com', password: PASSWORD, firstName: 'Owner', lastName: 'Test', country: 'FR' })).statusCode).toBe(201);
    const scan = safeJson(await owner.post('/api/v1/verify', { code: p.code.data, genome: { glyphs: p.genome.glyphs } })) as any;
    expect(scan.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    const reg = await owner.post('/api/v1/ownership/register', { registrationToken: scan.registration.token, claimCode: p.claimCode });
    expect(reg.statusCode, reg.body).toBe(201);
    expect((safeJson(await owner.post('/api/v1/verify', { code: p.code.data })) as any).state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');

    // ── Ownership certificate (F-06, the table of 0013 on pg): the owner's link reads VALID to anyone, its PDF renders ──
    const certificate = safeJson(await owner.post('/api/v1/ownership/certificates', { productId: p.product.productId, validDays: 90 })) as any;
    expect(certificate.url).toBe(`${ORIGIN}/verify/c#${certificate.token}`);
    const visitor = client();
    expect(safeJson(await visitor.post('/api/v1/certificates/lookup', { token: certificate.token }))).toMatchObject({ status: 'VALID', ownership: { verified: true }, incidentReported: false });
    const certificatePdf = await visitor.post('/api/v1/certificates/pdf', { token: certificate.token });
    expect(certificatePdf.statusCode, certificatePdf.body.slice(0, 200)).toBe(200);
    expect(certificatePdf.headers['content-type']).toBe('application/pdf');

    // ── Transfer to a second customer ──
    const offer = safeJson(await owner.post('/api/v1/ownership/transfers', { productId: p.product.productId })) as any;
    const buyer = client();
    await buyer.post('/api/v1/account/register', { email: 'buyer@example.com', password: PASSWORD, firstName: 'Buyer', lastName: 'Test', country: 'FR' });
    // F-03: the buyer scans the piece signed in, then enters the code with that scan (the TRANSFER_ACCEPT purpose of 0011).
    const toReceive = safeJson(await buyer.post('/api/v1/verify', { code: p.code.data })) as any;
    expect(toReceive.transfer?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const unknownCode = await buyer.post('/api/v1/ownership/transfers/accept', { transferCode: '0000-0000-0000', productId: p.product.productId, transferToken: toReceive.transfer.token });
    expect(unknownCode.statusCode).toBe(404);
    const received = await buyer.post('/api/v1/ownership/transfers/accept', { transferCode: offer.transferCode, productId: p.product.productId, transferToken: toReceive.transfer.token });
    expect(received.statusCode, received.body).toBe(200);
    expect((safeJson(await buyer.get('/api/v1/account/products')) as any).products).toHaveLength(1);
    // The seller's certificate ended with the sale; the buyer makes their own.
    expect((safeJson(await visitor.post('/api/v1/certificates/lookup', { token: certificate.token })) as any).status).toBe('NO_LONGER_VALID');
    const buyerCertificate = safeJson(await buyer.post('/api/v1/ownership/certificates', { productId: p.product.productId })) as any;
    expect((safeJson(await visitor.post('/api/v1/certificates/lookup', { token: buyerCertificate.token })) as any).status).toBe('VALID');

    // ── MY PIECES (F-01): the new owner reports it lost, then finds it again (the status history read on pg) ──
    expect((await buyer.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'LOST' })).statusCode).toBe(201);
    expect((safeJson(await buyer.get('/api/v1/account/products')) as any).products[0]).toMatchObject({ incident: 'LOST', incidentResolvable: true });
    const found = await buyer.post('/api/v1/ownership/incidents/resolve', { productId: p.product.productId, currentPassword: PASSWORD });
    expect(found.statusCode, found.body).toBe(200);
    expect((safeJson(await buyer.get('/api/v1/account/products')) as any).products[0]).toMatchObject({ incident: null, incidentResolvable: false });
    // A certificate made before the loss stays ended once the piece is found (the status history read on pg), until withdrawn.
    expect((safeJson(await visitor.post('/api/v1/certificates/lookup', { token: buyerCertificate.token })) as any).status).toBe('NO_LONGER_VALID');
    expect((safeJson(await buyer.get('/api/v1/ownership/certificates')) as any).certificates).toMatchObject([{ id: buyerCertificate.id, valid: false }]);
    expect((await buyer.request('DELETE', `/api/v1/ownership/certificates/${buyerCertificate.id}`)).statusCode).toBe(200);
    expect((await visitor.post('/api/v1/certificates/lookup', { token: buyerCertificate.token })).statusCode).toBe(404);

    // ── Concurrency: a burst of verifications on the pool ──
    const burst = await Promise.all(Array.from({ length: 24 }, () => client().post('/api/v1/verify', { code: p.code.data })));
    for (const r of burst) expect(r.statusCode).toBe(200);
    const states = new Set(burst.map((r) => (safeJson(r) as any).state));
    for (const s of states) expect(['AUTHENTIC_REGISTERED', 'SUSPICIOUS_ACTIVITY']).toContain(s);

    // ── Console views on pg ──
    for (const url of ['/api/admin/dashboard', '/api/admin/products?q=O', '/api/admin/scans', '/api/admin/owners', '/api/admin/warranties', '/api/admin/anomalies', '/api/admin/codes', '/api/admin/genomes', '/api/admin/revocations', '/api/admin/keys', '/api/admin/models', '/api/admin/collections']) {
      const r = await op.get(url);
      expect(r.statusCode, `${url} ${r.body.slice(0, 200)}`).toBe(200);
    }
    // ── Triage on pg: a finding's type and product filters and the orders, the badge, its scans and the scans window ──
    const wrong = p.genome.glyphs.map((g: number) => (g + 1) % 16);
    const mismatch = safeJson(await client().post('/api/v1/verify', { code: p.code.data, genome: { glyphs: wrong } })) as any;
    const findings = safeJson(await op.get(`/api/admin/anomalies?productId=${p.product.productId}&type=GENOME_MISMATCH&sort=severity`)) as any;
    expect(findings.items).toHaveLength(1);
    expect(findings.items[0].details.scanEventId).toBe(mismatch.scanId);
    for (const sort of ['risk', 'lastSeen']) expect((await op.get(`/api/admin/anomalies?sort=${sort}`)).statusCode).toBe(200);
    expect((safeJson(await op.get('/api/admin/anomalies/summary')) as any).attention).toBeGreaterThanOrEqual(1);
    const context = safeJson(await op.get(`/api/admin/anomalies/${findings.items[0].id}/context`)) as any;
    expect(context.trigger.id).toBe(mismatch.scanId);
    expect(context.scans.total).toBeGreaterThanOrEqual(27);
    expect(context.devices).toBeGreaterThan(1);
    expect(context.product.lifecycle.allowed).toContain('STOLEN');
    const windowed = safeJson(await op.get(`/api/admin/scans?productId=${p.product.productId}&from=${context.window.from}&to=${context.window.to}`)) as any;
    expect(windowed.total).toBe(context.scans.total);

    // ── Printing a production batch on pg: filters, ids, manifest ──
    const batched = safeJson(await op.post('/api/admin/products', { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER', productionBatch: 'B-PG-1', variant: 'Size 52' })) as any;
    const day = batched.code.issuedAt;
    const filtered = safeJson(await op.get(`/api/admin/codes?productionBatch=B-PG-1&modelId=${model.id}&status=ACTIVE&issuedFrom=${day}&issuedTo=${day}`)) as any;
    expect(filtered.items.map((c: any) => c.id)).toEqual([batched.code.id]);
    expect(filtered.items[0].printable).toBe(true);
    expect((safeJson(await op.get(`/api/admin/codes?productionBatch=B-PG-1&issuedTo=2000-01-01`)) as any).total).toBe(0);
    // The last day of year 9999 holds every code; a bound in year 10000 is refused before any query.
    expect((safeJson(await op.get(`/api/admin/codes?productionBatch=B-PG-1&issuedTo=9999-12-31`)) as any).total).toBe(1);
    expect((await op.get(`/api/admin/scans?to=9999-12-31T23:00:00-05:00`)).statusCode).toBe(400);
    expect((await op.get(`/api/admin/scans?productId=${p.product.productId}&to=9999-12-31`)).statusCode).toBe(200);
    expect(safeJson(await op.get('/api/admin/codes/ids?productionBatch=B-PG-1'))).toEqual({ ids: [batched.code.id], total: 1, truncated: false });
    expect((safeJson(await op.get('/api/admin/products?productionBatch=B-PG-1')) as any).total).toBe(1);
    const manifest = await op.post('/api/admin/codes/print-sheet/manifest', { codeIds: [batched.code.id] });
    expect(manifest.statusCode, manifest.body).toBe(200);
    expect(manifest.body.split('\r\n')[1]).toBe(`"1","1","1","${batched.product.productId}","${batched.product.sku}","Size 52","925 STERLING SILVER","${batched.code.id}"`);

    // ── A batch on pg: a transaction per piece, a serial already taken failing its piece alone ──
    const lot = await op.post('/api/admin/products/batch', {
      template: { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER', productionBatch: 'B-PG-2', withClaimSecret: true },
      items: [{ variant: 'Size 50' }, { serial: batched.product.serial }, { variant: 'Size 54' }],
    });
    expect(lot.statusCode, lot.body).toBe(200);
    const lotBody = safeJson(lot) as any;
    expect(lotBody.items.map((i: any) => i.status)).toEqual(['ISSUED', 'FAILED', 'ISSUED']);
    expect(lotBody.items[1].error.code).toBe('SERIAL_TAKEN');
    expect(lotBody.items[0].claimCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect((safeJson(await op.get('/api/admin/products?productionBatch=B-PG-2')) as any).total).toBe(2);

    // ── Daily scan statistics on pg: concurrent passes count each scan once, the route reads them ──
    const statsDay = addDays(utcDay(new Date()), -2);
    const at = new Date(`${statsDay}T12:00:00.000Z`);
    await ctx.db
      .insertInto('scan_events')
      .values([
        ...Array.from({ length: 3 }, () => ({ occurred_at: at, event_type: 'VERIFY' as const, result_state: 'AUTHENTIC', country: 'BR' })),
        { occurred_at: at, event_type: 'VERIFY', result_state: 'INVALID_SIGNATURE', country: 'BR' },
        { occurred_at: at, event_type: 'VERIFY', result_state: 'MALFORMED_CODE', country: null },
        { occurred_at: at, event_type: 'ADMIN_TEST', result_state: 'AUTHENTIC', country: 'BR' },
      ])
      .execute();
    await Promise.all(Array.from({ length: 4 }, () => aggregateScanStats(ctx.db, new Date())));
    expect(await ctx.db.selectFrom('scan_daily_stats').select(['day', 'country', 'result_state', 'event_type', 'n']).orderBy('country').orderBy('result_state').execute()).toEqual([
      { day: statsDay, country: 'BR', result_state: 'AUTHENTIC', event_type: 'VERIFY', n: 3 },
      { day: statsDay, country: 'BR', result_state: 'INVALID_SIGNATURE', event_type: 'VERIFY', n: 1 },
      { day: statsDay, country: 'ZZ', result_state: 'MALFORMED_CODE', event_type: 'VERIFY', n: 1 },
    ]);
    const stats = safeJson(await op.get('/api/admin/analytics?days=7')) as any;
    expect(stats).toMatchObject({ days: 7, total: 5, signals: { INVALID_SIGNATURE: 1, MALFORMED_CODE: 1, total: 2 } });
    expect(stats.countries.map((c: any) => [c.country, c.total, c.signals])).toEqual([
      ['BR', 4, 1],
      ['ZZ', 1, 1],
    ]);

    const detail = safeJson(await op.get(`/api/admin/products/${p.product.productId}`)) as any;
    expect(detail.codes[0].verification.valid).toBe(true);
    expect(detail.scans.count).toBeGreaterThanOrEqual(26);
    expect(detail.ownership.owners).toHaveLength(2);
    const dash = safeJson(await op.get('/api/admin/dashboard')) as any;
    expect(typeof dash.scans.last24h).toBe('number');
    // The owner's sheet on pg (A-06): exact email, the REF under the owner's first scan (a uuid range), the sheet, the export.
    const byEmail = safeJson(await op.get('/api/admin/owners?email=OWNER%40example.com')) as any;
    expect(byEmail.items).toHaveLength(1);
    const ownerId = byEmail.items[0].id;
    const byRef = safeJson(await op.get(`/api/admin/owners?ref=${scan.scanId.slice(0, 8)}`)) as any;
    expect(byRef.scans.map((s: any) => s.scanId)).toContain(scan.scanId);
    expect(byRef.items.map((o: any) => o.id)).toContain(ownerId);
    const sheet = safeJson(await op.get(`/api/admin/owners/${ownerId}`)) as any;
    expect(sheet.pieces).toEqual([expect.objectContaining({ productId: p.product.productId, endedReason: 'TRANSFERRED_OUT' })]);
    expect(sheet.scans.length).toBeGreaterThanOrEqual(2);
    const exported = await op.get(`/api/admin/owners/${ownerId}/export`);
    expect(exported.statusCode).toBe(200);
    expect((safeJson(exported) as any).account.email).toBe('owner@example.com');
    // The editable catalogue on pg (A-10): row lock, guard trigger, live public text, counts, an inactive model refused.
    // The model's issued pieces, all in its collection: the ring, the piece of batch B-PG-1 and the two of B-PG-2.
    const issuedOfModel = 2 + lotBody.items.filter((i: any) => i.status === 'ISSUED').length;
    expect(issuedOfModel).toBe(4);
    const edited = await op.patch(`/api/admin/models/${model.id}`, { name: 'MONOLITHE II', careInstructions: 'Wipe with a soft, dry cloth.' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(safeJson(edited)).toMatchObject({ name: 'MONOLITHE II', active: true, products: issuedOfModel });
    expect((await op.patch(`/api/admin/models/${model.id}`, { skuPrefix: 'NEW' })).statusCode).toBe(400);
    expect((await op.patch(`/api/admin/collections/${col.id}`, { name: 'ORBIT NOIR' })).statusCode).toBe(200);
    expect((safeJson(await client().post('/api/v1/verify', { code: p.code.data })) as any).product).toMatchObject({ model: 'MONOLITHE II', collection: 'ORBIT NOIR', care: 'Wipe with a soft, dry cloth.' });
    expect((safeJson(await op.get('/api/admin/collections')) as any).items[0]).toMatchObject({ name: 'ORBIT NOIR', models: 1, products: issuedOfModel });
    expect((await op.patch(`/api/admin/models/${model.id}`, { active: false })).statusCode).toBe(200);
    expect((await op.post('/api/admin/products', { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER' })).statusCode).toBe(409);
    expect((await op.post('/api/admin/categories/J/active', { active: false })).statusCode).toBe(200);
    expect((await op.post('/api/admin/categories/J/active', { active: true })).statusCode).toBe(200);

    // ── Row locks on pg (C-04, A-06) ──
    // Concurrent sign-ins of one account after a wrong password: each resets the throttle under the account's row
    // lock, so they run one after the other; with a share lock they would deadlock (40P01, a 500).
    expect((await client().post('/api/v1/account/login', { email: 'buyer@example.com', password: 'not the password at all' })).statusCode).toBe(401);
    const logins = await Promise.all(Array.from({ length: 6 }, () => client().post('/api/v1/account/login', { email: 'buyer@example.com', password: PASSWORD, firstName: 'Buyer', lastName: 'Test', country: 'FR' })));
    for (const r of logins) expect(r.statusCode, r.body).toBe(200);
    // A lock of an account with two pending transfers while it signs in: the products are locked first, the audit last.
    expect((await op.patch(`/api/admin/models/${model.id}`, { active: true })).statusCode).toBe(200);
    const second = safeJson(await op.post('/api/admin/products', { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER' })) as any;
    expect((await op.post(`/api/admin/products/${second.product.productId}/warranty/activate`, { retailer: 'ORBES PARIS', country: 'FR' })).statusCode).toBe(200);
    const buyerScan = safeJson(await buyer.post('/api/v1/verify', { code: second.code.data })) as any;
    expect((await buyer.post('/api/v1/ownership/register', { registrationToken: buyerScan.registration.token })).statusCode).toBe(201);
    for (const productId of [p.product.productId, second.product.productId]) {
      const t = await buyer.post('/api/v1/ownership/transfers', { productId });
      expect(t.statusCode, t.body).toBe(201);
    }
    const buyerId = (safeJson(await op.get('/api/admin/owners?email=buyer%40example.com')) as any).items[0].id;
    const [locked, ...during] = await Promise.all([
      op.post(`/api/admin/owners/${buyerId}/lock`),
      ...Array.from({ length: 4 }, () => client().post('/api/v1/account/login', { email: 'buyer@example.com', password: PASSWORD, firstName: 'Buyer', lastName: 'Test', country: 'FR' })),
    ]);
    expect(locked.statusCode, locked.body).toBe(200);
    expect(safeJson(locked)).toMatchObject({ status: 'LOCKED', transfersCancelled: 2 });
    for (const r of during) expect([200, 403], r.body).toContain(r.statusCode);
    expect((await client().post('/api/v1/account/login', { email: 'buyer@example.com', password: PASSWORD, firstName: 'Buyer', lastName: 'Test', country: 'FR' })).statusCode).toBe(403);
    expect((safeJson(await op.get('/api/admin/audit/verify')) as any).ok).toBe(true);
  });
});
