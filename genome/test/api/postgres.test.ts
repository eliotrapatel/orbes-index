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
    const model = safeJson(await op.post('/api/admin/models', { categoryCode: 'J', collectionId: col.id, name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL' })) as { id: string };
    const issued = await op.post('/api/admin/products', { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER', withClaimSecret: true });
    expect(issued.statusCode, issued.body).toBe(201);
    const p = safeJson(issued) as any;
    const svg = await op.get(`/api/admin/codes/${p.code.id}/artifact.svg`);
    expect(svg.statusCode).toBe(200);
    expect((await op.post(`/api/admin/products/${p.product.productId}/warranty/activate`, { retailer: 'ORBES PARIS', country: 'FR' })).statusCode).toBe(200);

    // ── Customer: scan, register with the claim code ──
    const owner = client();
    expect((await owner.post('/api/v1/account/register', { email: 'owner@example.com', password: PASSWORD })).statusCode).toBe(201);
    const scan = safeJson(await owner.post('/api/v1/verify', { code: p.code.data, genome: { glyphs: p.genome.glyphs } })) as any;
    expect(scan.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    const reg = await owner.post('/api/v1/ownership/register', { registrationToken: scan.registration.token, claimCode: p.claimCode });
    expect(reg.statusCode, reg.body).toBe(201);
    expect((safeJson(await owner.post('/api/v1/verify', { code: p.code.data })) as any).state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');

    // ── Transfer to a second customer ──
    const offer = safeJson(await owner.post('/api/v1/ownership/transfers', { productId: p.product.productId })) as any;
    const buyer = client();
    await buyer.post('/api/v1/account/register', { email: 'buyer@example.com', password: PASSWORD });
    expect((await buyer.post('/api/v1/ownership/transfers/accept', { transferCode: offer.transferCode })).statusCode).toBe(200);
    expect((safeJson(await buyer.get('/api/v1/account/products')) as any).products).toHaveLength(1);

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
    const edited = await op.patch(`/api/admin/models/${model.id}`, { name: 'MONOLITHE II', careInstructions: 'Wipe with a soft, dry cloth.' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(safeJson(edited)).toMatchObject({ name: 'MONOLITHE II', active: true, products: 1 });
    expect((await op.patch(`/api/admin/models/${model.id}`, { skuPrefix: 'NEW' })).statusCode).toBe(400);
    expect((await op.patch(`/api/admin/collections/${col.id}`, { name: 'ORBIT NOIR' })).statusCode).toBe(200);
    expect((safeJson(await client().post('/api/v1/verify', { code: p.code.data })) as any).product).toMatchObject({ model: 'MONOLITHE II', collection: 'ORBIT NOIR', care: 'Wipe with a soft, dry cloth.' });
    expect((safeJson(await op.get('/api/admin/collections')) as any).items[0]).toMatchObject({ name: 'ORBIT NOIR', models: 1, products: 1 });
    expect((await op.patch(`/api/admin/models/${model.id}`, { active: false })).statusCode).toBe(200);
    expect((await op.post('/api/admin/products', { categoryCode: 'J', modelId: model.id, material: '925 STERLING SILVER' })).statusCode).toBe(409);
    expect((await op.post('/api/admin/categories/J/active', { active: false })).statusCode).toBe(200);
    expect((await op.post('/api/admin/categories/J/active', { active: true })).statusCode).toBe(200);

    // ── Row locks on pg (C-04, A-06) ──
    // Concurrent sign-ins of one account after a wrong password: each resets the throttle under the account's row
    // lock, so they run one after the other; with a share lock they would deadlock (40P01, a 500).
    expect((await client().post('/api/v1/account/login', { email: 'buyer@example.com', password: 'not the password at all' })).statusCode).toBe(401);
    const logins = await Promise.all(Array.from({ length: 6 }, () => client().post('/api/v1/account/login', { email: 'buyer@example.com', password: PASSWORD })));
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
      ...Array.from({ length: 4 }, () => client().post('/api/v1/account/login', { email: 'buyer@example.com', password: PASSWORD })),
    ]);
    expect(locked.statusCode, locked.body).toBe(200);
    expect(safeJson(locked)).toMatchObject({ status: 'LOCKED', transfersCancelled: 2 });
    for (const r of during) expect([200, 403], r.body).toContain(r.statusCode);
    expect((await client().post('/api/v1/account/login', { email: 'buyer@example.com', password: PASSWORD })).statusCode).toBe(403);
    expect((safeJson(await op.get('/api/admin/audit/verify')) as any).ok).toBe(true);
  });
});
