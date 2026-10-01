/**
 * Full-stack integration: the whole system in one process, driven only
 * through HTTP (app.inject) and the core decoder, on a manual clock.
 *
 *   createContext (PGlite in memory + MemoryKeyProvider) → buildApp
 *   admin login (bootstrap admin) → catalogue → issue O26-J-00184
 *   → download the PNG artifact → simulated phone capture (camera-sim)
 *   → core decoder → POST /api/v1/verify: AUTHENTIC (in stock)
 *   → warranty activation → AUTHENTIC_FIRST_REGISTRATION
 *   → account + ownership registration (token + claim code)
 *   → AUTHENTIC_OWNERSHIP_VERIFIED → transfer to a second account → accept
 *   → scans from FR, US and JP within minutes (geo headers mode)
 *   → SUSPICIOUS_ACTIVITY for non-owners, UNUSUAL_ACTIVITY notice for the owner
 *   → the admin sees the IMPOSSIBLE_TRAVEL anomaly → revokes the code: REVOKED
 *   → re-issue → the new code, printed and scanned again: AUTHENTIC*.
 *
 * Every public response is also checked for leaks: no risk score, threshold,
 * reasons or raw lifecycle status may ever reach a scanner.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toBase64Url } from '../../src/core/bytes.js';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import type { VerifyOutcome } from '../../src/server/services/verification.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { Client, ORIGIN, safeJson } from '../api/support.js';
import { PRESETS, simulateCapture } from '../support/camera-sim.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { rgbaToGray } from '../support/raster.js';

const START = new Date('2026-09-14T08:00:00.000Z');
const ADMIN = { email: 'admin@example.com', password: 'integration-admin-password' };
const ALICE = { email: 'alice.integration@example.com', password: 'alice-integration-password', displayName: 'Alice' };
const BOB = { email: 'bob.integration@example.com', password: 'bob-integration-password', displayName: 'Bob' };
const GEO = { country: 'x-orbes-country', lat: 'x-orbes-lat', lon: 'x-orbes-lon' };
const PLACES = {
  paris: { [GEO.country]: 'FR', [GEO.lat]: '48.86', [GEO.lon]: '2.35' },
  newYork: { [GEO.country]: 'US', [GEO.lat]: '40.71', [GEO.lon]: '-74.01' },
  tokyo: { [GEO.country]: 'JP', [GEO.lat]: '35.68', [GEO.lon]: '139.69' },
};
/** Keys an outcome must never contain (contract §2.4: internal facts stay internal). */
const FORBIDDEN_KEYS = ['riskScore', 'risk', 'score', 'threshold', 'suspiciousThreshold', 'reasons', 'findings', 'anomalies', 'productStatus', 'codeStatus', 'claimSecretHash'];
/** Raw lifecycle statuses and rule names that must not leak into public text either. */
const FORBIDDEN_VALUES = ['"ACTIVATED"', '"TRANSFERRED"', '"ISSUED"', 'IMPOSSIBLE_TRAVEL', 'RISK_THRESHOLD', 'ANOMALY:'];

let t: TestDb;
let clock: ManualClock;
let ctx: AppContext;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDb();
  clock = createManualClock(START);
  const config = testConfig({
    publicOrigin: ORIGIN,
    geo: { mode: 'headers', countryHeader: GEO.country, latHeader: GEO.lat, lonHeader: GEO.lon },
    bootstrapAdmin: ADMIN,
  });
  ctx = await createContext(config, { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
  app = await buildApp(ctx, { serveStatic: false });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  await t?.close();
});

// ── helpers ────────────────────────────────────────────────────────────────

function json<T = any>(res: LightMyRequestResponse, status: number): T {
  if (res.statusCode !== status) throw new Error(`expected HTTP ${status}, got ${res.statusCode}: ${res.body.slice(0, 300)}`);
  return safeJson(res) as T;
}

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

/** POST /api/v1/verify and check the public body for leaks. */
async function verify(client: Client, scan: Scan, headers: Record<string, string> = {}): Promise<VerifyOutcome> {
  const res = await client.post('/api/v1/verify', scan.body, { headers });
  const body = json<VerifyOutcome>(res, 200);
  const keys = keysDeep(body);
  for (const k of FORBIDDEN_KEYS) expect(keys.has(k), `public outcome exposes "${k}"`).toBe(false);
  for (const v of FORBIDDEN_VALUES) expect(res.body, `public outcome contains ${v}`).not.toContain(v);
  return body;
}

interface Scan {
  data: string;
  body: { code: string; genome: { glyphs: (number | null)[]; confidence: number[] }; client: Record<string, unknown> };
}

/**
 * The phone side: download the code artifact as an OPERATOR would print it,
 * photograph it with the camera simulator and read it with the core decoder,
 * exactly what the web app's worker does with a camera frame.
 */
async function printAndScan(admin: Client, codeId: string, seed: number): Promise<Scan> {
  const res = await admin.get(`/api/admin/codes/${codeId}/artifact.png?widthMm=30&dpi=600`);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('image/png');
  expect(String(res.headers['content-disposition'])).toMatch(/^attachment; filename="ORBES-O26-J-00184-I\d-/);
  const png = PNG.sync.read(res.rawPayload);
  const printed = rgbaToGray(png.data, png.width, png.height, 255);
  const photo = simulateCapture(printed, PRESETS.typicalPhone, seed);
  const decoded = decodeOrbesCode(photo, { readGenome: true });
  if (!decoded.ok) throw new Error(`decoder failed on the simulated capture: ${decoded.reason} ${decoded.detail ?? ''}`);
  const genome = decoded.genome ?? { glyphs: Array<number | null>(8).fill(null), confidence: Array<number>(8).fill(0) };
  return {
    data: toBase64Url(decoded.data),
    body: {
      code: toBase64Url(decoded.data),
      genome: { glyphs: genome.glyphs, confidence: genome.confidence.map((c) => Math.min(1, Math.max(0, c))) },
      client: {
        source: 'camera',
        rsErrors: decoded.quality.rsErrors,
        rsErasures: decoded.quality.rsErasures,
        moduleSizePx: Math.round(decoded.quality.moduleSizePx * 100) / 100,
        decodeMs: Math.round(decoded.quality.elapsedMs),
      },
    },
  };
}

function minutes(n: number): void {
  clock.advance(n * 60_000);
}

// ── the flow ───────────────────────────────────────────────────────────────

describe('full flow: issue → print → scan → verify → own → transfer → anomaly → revoke → re-issue', () => {
  // Shared across the ordered steps below (vitest runs them sequentially in file order).
  const s = {} as {
    admin: Client;
    alice: Client;
    bob: Client;
    modelId: string;
    collectionId: string;
    productId: string;
    codeId: string;
    issuedData: string;
    claimCode: string;
    scan: Scan;
    registrationToken: string;
    fingerprint: string;
  };

  it('admin signs in with the bootstrap account and builds the catalogue', async () => {
    s.admin = new Client(app, { ip: '198.51.100.7' });
    const login = json(await s.admin.post('/api/admin/auth/login', { email: ADMIN.email, password: ADMIN.password }), 200);
    expect(login.csrfToken).toEqual(expect.any(String));
    expect(json(await s.admin.get('/api/admin/auth/me'), 200)).toMatchObject({ admin: { email: ADMIN.email, role: 'ADMIN' } });

    const category = json(await s.admin.post('/api/admin/categories', { code: 'J', name: 'Jewelry', warrantyMonths: 24 }), 201);
    expect(category).toMatchObject({ code: 'J', index: 1 });
    s.collectionId = json(await s.admin.post('/api/admin/collections', { name: 'ORBITAL' }), 201).id;
    const model = json(
      await s.admin.post('/api/admin/models', {
        categoryCode: 'J',
        collectionId: s.collectionId,
        name: 'MONOLITHE',
        type: 'RING',
        skuPrefix: 'MNL-RG',
        defaultMaterial: '925 STERLING SILVER',
        careInstructions: 'Wipe with a soft, dry cloth after wear.',
      }),
      201,
    );
    s.modelId = model.id;
  });

  it('issues O26-J-00184 with a signed code, a genome and a claim code', async () => {
    minutes(5);
    const issued = json(
      await s.admin.post('/api/admin/products', {
        categoryCode: 'J',
        year: 2026,
        serial: 184,
        modelId: s.modelId,
        collectionId: s.collectionId,
        variant: 'SIZE 52',
        material: '925 STERLING SILVER',
        productionBatch: 'B2609-MNL',
        withClaimSecret: true,
      }),
      201,
    );
    expect(issued.product).toMatchObject({ productId: 'O26-J-00184', status: 'ISSUED', ownershipState: 'UNREGISTERED', hasClaimSecret: true });
    expect(issued.genome.fingerprint).toMatch(/^G1-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(issued.code).toMatchObject({ issue: 1, status: 'ACTIVE', codeVersion: 1 });
    expect(issued.claimCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    s.productId = issued.product.productId;
    s.codeId = issued.code.id;
    s.issuedData = issued.code.data;
    s.claimCode = issued.claimCode;
    s.fingerprint = issued.genome.fingerprint;
  });

  it('the printed PNG, photographed by a phone and decoded, carries exactly the issued code', async () => {
    s.scan = await printAndScan(s.admin, s.codeId, 184);
    expect(s.scan.data).toBe(s.issuedData);
    // The genome ring is read as well (it is the cross-check of step 7).
    expect(s.scan.body.genome.glyphs.filter((g) => g !== null).length).toBeGreaterThanOrEqual(6);
  });

  it('verifies as AUTHENTIC while in stock, then FIRST REGISTRATION once the warranty is activated', async () => {
    s.alice = new Client(app, { ip: '203.0.113.21' });
    minutes(30);
    const inStock = await verify(s.alice, s.scan);
    expect(inStock).toMatchObject({
      state: 'AUTHENTIC',
      verification: { signature: 'VALID', codeVersion: 'CODE-01', genomeVersion: 'GENOME-01', issue: 1 },
      product: { productId: 'O26-J-00184', model: 'MONOLITHE', type: 'RING', material: '925 STERLING SILVER', createdYear: 2026, category: { code: 'J', name: 'Jewelry' } },
      genome: { id: 'O26-J-00184', version: 'GENOME-01', fingerprint: s.fingerprint },
      warranty: { status: 'NOT_STARTED' },
    });
    expect(inStock.registration).toBeUndefined();

    minutes(60);
    const activated = json(
      await s.admin.post(`/api/admin/products/${s.productId}/warranty/activate`, { purchaseDate: '2026-09-14', retailer: 'ORBES PARIS — SAINT-HONORÉ', country: 'FR' }),
      200,
    );
    expect(activated.statusChange).toMatchObject({ from: 'ISSUED', to: 'ACTIVATED' });

    minutes(120);
    const first = await verify(s.alice, s.scan);
    expect(first).toMatchObject({
      state: 'AUTHENTIC_FIRST_REGISTRATION',
      title: 'AUTHENTIC — FIRST REGISTRATION',
      warranty: { status: 'ACTIVE', startDate: '2026-09-14', endDate: '2028-09-14' },
      ownership: { registered: false, you: false },
      registration: { claimCodeRequired: true },
    });
    s.registrationToken = first.registration!.token;
  });

  it('a new account registers the piece with the scan token and its claim code', async () => {
    minutes(2);
    const account = json(await s.alice.post('/api/v1/account/register', ALICE), 201);
    expect(account.account.email).toBe(ALICE.email);

    // A wrong claim code is refused without burning the single-use token.
    const wrong = await s.alice.post('/api/v1/ownership/register', { registrationToken: s.registrationToken, claimCode: '0000-0000-0000' });
    expect(wrong.statusCode).toBe(403);
    const registered = json(await s.alice.post('/api/v1/ownership/register', { registrationToken: s.registrationToken, claimCode: s.claimCode }), 201);
    expect(registered).toMatchObject({ productId: 'O26-J-00184', verified: true });
    // Single use.
    expect((await s.alice.post('/api/v1/ownership/register', { registrationToken: s.registrationToken, claimCode: s.claimCode })).statusCode).toBe(409);

    minutes(1);
    const owner = await verify(s.alice, s.scan);
    expect(owner).toMatchObject({ state: 'AUTHENTIC_OWNERSHIP_VERIFIED', ownership: { registered: true, you: true } });
    expect(owner.notice).toBeUndefined();
    const mine = json(await s.alice.get('/api/v1/account/products'), 200);
    expect(mine.products.map((p: { productId: string }) => p.productId)).toEqual(['O26-J-00184']);
  });

  it('transfers ownership to a second account', async () => {
    minutes(24 * 60);
    const offer = json(await s.alice.post('/api/v1/ownership/transfers', { productId: s.productId }), 201);
    expect(offer.transferCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect((await verify(new Client(app, { ip: '203.0.113.40' }), s.scan)).ownership).toMatchObject({ registered: true, you: false, transferPending: true });

    minutes(90);
    s.bob = new Client(app, { ip: '203.0.113.22' });
    json(await s.bob.post('/api/v1/account/register', BOB), 201);
    const accepted = json(await s.bob.post('/api/v1/ownership/transfers/accept', { transferCode: offer.transferCode }), 200);
    expect(accepted).toMatchObject({ productId: 'O26-J-00184', verified: true });

    minutes(5);
    expect(await verify(s.bob, s.scan)).toMatchObject({ state: 'AUTHENTIC_OWNERSHIP_VERIFIED', ownership: { you: true } });
    expect(await verify(s.alice, s.scan)).toMatchObject({ state: 'AUTHENTIC_REGISTERED', ownership: { registered: true, you: false } });
    expect(json(await s.alice.get('/api/v1/account/products'), 200).products).toEqual([]);
  });

  it('scans from Paris, New York and Tokyo within minutes are SUSPICIOUS for anyone but the owner', async () => {
    minutes(24 * 60);
    const paris = await verify(new Client(app, { ip: '203.0.113.51' }), s.scan, PLACES.paris);
    expect(paris.state).toBe('AUTHENTIC_REGISTERED');

    minutes(4);
    const newYork = await verify(new Client(app, { ip: '203.0.113.52' }), s.scan, PLACES.newYork);
    expect(newYork).toMatchObject({ state: 'SUSPICIOUS_ACTIVITY', title: 'UNUSUAL ACTIVITY DETECTED' });
    // Suspicious answers keep the identity (genome) but not the product sheet, warranty or ownership.
    expect(newYork.genome?.fingerprint).toBe(s.fingerprint);
    expect(newYork.product).toBeUndefined();
    expect(newYork.ownership).toBeUndefined();
    expect(newYork.registration).toBeUndefined();

    minutes(4);
    const tokyo = await verify(new Client(app, { ip: '203.0.113.53' }), s.scan, PLACES.tokyo);
    expect(tokyo.state).toBe('SUSPICIOUS_ACTIVITY');

    // The authenticated owner still sees the piece as theirs, with a notice.
    clock.advance(30_000);
    const owner = await verify(s.bob, s.scan, PLACES.tokyo);
    expect(owner).toMatchObject({ state: 'AUTHENTIC_OWNERSHIP_VERIFIED', notice: 'UNUSUAL_ACTIVITY', ownership: { you: true } });
  });

  it('the admin console shows the open impossible-travel anomaly and the suspicious scans', async () => {
    const anomalies = json(await s.admin.get('/api/admin/anomalies?status=OPEN'), 200);
    const travel = anomalies.items.find((a: { type: string }) => a.type === 'IMPOSSIBLE_TRAVEL');
    expect(travel).toMatchObject({ productId: 'O26-J-00184', severity: 'HIGH', status: 'OPEN' });
    expect(travel.occurrences).toBeGreaterThanOrEqual(2);

    const scans = json(await s.admin.get(`/api/admin/scans?productId=${s.productId}&state=SUSPICIOUS_ACTIVITY`), 200);
    expect(scans.items.map((x: { country: string }) => x.country).sort()).toEqual(['JP', 'US']);

    const dashboard = json(await s.admin.get('/api/admin/dashboard'), 200);
    expect(dashboard.anomalies.openBySeverity.HIGH).toBeGreaterThanOrEqual(1);
    expect(dashboard.products.byStatus.TRANSFERRED).toBe(1);
  });

  it('revoking the code makes every scan of it REVOKED', async () => {
    minutes(15);
    const revoked = json(await s.admin.post(`/api/admin/codes/${s.codeId}/revoke`, { reason: 'Code copied: impossible travel across three continents.' }), 200);
    expect(revoked.code).toMatchObject({ id: s.codeId, status: 'REVOKED' });

    minutes(1);
    const outcome = await verify(new Client(app, { ip: '203.0.113.60' }), s.scan);
    expect(outcome).toMatchObject({ state: 'REVOKED', title: 'REVOKED' });
    expect(outcome.product).toBeUndefined();
    // The owner is told the same: a revoked code proves nothing about the piece in hand.
    expect((await verify(s.bob, s.scan)).state).toBe('REVOKED');
  });

  it('a re-issued code, printed and scanned again, is AUTHENTIC; the old one stays REVOKED', async () => {
    minutes(30);
    const reissued = json(await s.admin.post(`/api/admin/products/${s.productId}/codes/reissue`, { reason: 'Replacement after revocation.' }), 201);
    expect(reissued.code).toMatchObject({ issue: 2, status: 'ACTIVE' });
    expect(reissued.code.data).not.toBe(s.issuedData);

    const fresh = await printAndScan(s.admin, reissued.code.id, 1842);
    expect(fresh.data).toBe(reissued.code.data);

    minutes(10);
    const anonymous = await verify(new Client(app, { ip: '203.0.113.70' }), fresh);
    expect(anonymous).toMatchObject({
      state: 'AUTHENTIC_REGISTERED',
      verification: { signature: 'VALID', issue: 2 },
      // Same identity, same genome: re-issue never changes who the piece is.
      genome: { id: 'O26-J-00184', fingerprint: s.fingerprint },
    });
    const owner = await verify(s.bob, fresh);
    expect(owner).toMatchObject({ state: 'AUTHENTIC_OWNERSHIP_VERIFIED', ownership: { you: true } });
    expect(owner.notice).toBeUndefined();

    expect((await verify(new Client(app, { ip: '203.0.113.71' }), s.scan)).state).toBe('REVOKED');
  });

  it('leaves an intact audit chain and a public key list that matches the codes', async () => {
    expect(json(await s.admin.get('/api/admin/audit/verify'), 200)).toMatchObject({ ok: true });
    const keys = json(await new Client(app).get('/api/v1/keys'), 200);
    expect(keys.keys).toEqual([expect.objectContaining({ keyId: 1, status: 'ACTIVE', alg: 'Ed25519' })]);
    const audit = json(await s.admin.get('/api/admin/audit?pageSize=200'), 200);
    const actions = new Set(audit.items.map((e: { action: string }) => e.action));
    for (const a of ['product.issue', 'code.render', 'warranty.activate', 'ownership.register', 'code.revoke', 'code.reissue']) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});
