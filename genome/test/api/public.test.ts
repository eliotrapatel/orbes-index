import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toBase64Url } from '../../src/core/bytes.js';
import { accountClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Harness } from './support.js';

const INTERNAL_FIELDS = ['riskScore', 'risk_score', 'reasons', 'threshold', 'suspiciousThreshold', 'anomalies', 'productStatus', 'ownershipState'];

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe('public API', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  describe('GET /api/v1/health', () => {
    it('reports ok and the version', async () => {
      const res = await h.client().get('/api/v1/health');
      expect(res.statusCode).toBe(200);
      expect(safeJson(res)).toEqual({ ok: true, version: expect.any(String) });
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('public keys', () => {
    it('serves the same key list on /api/v1/keys and /.well-known/orbes-keys.json', async () => {
      const c = h.client();
      const a = await c.get('/api/v1/keys');
      const b = await c.get('/.well-known/orbes-keys.json');
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(safeJson(a)).toEqual(safeJson(b));
      const { keys } = safeJson(a) as { keys: { keyId: number; alg: string; publicKey: string; status: string }[] };
      expect(keys.length).toBeGreaterThanOrEqual(1);
      expect(keys[0]).toMatchObject({ keyId: 1, alg: 'Ed25519', status: 'ACTIVE' });
      expect(keys[0].publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Public, cacheable, readable by third-party verifiers; never any private material.
      expect(a.headers['access-control-allow-origin']).toBe('*');
      expect(a.headers['cache-control']).toMatch(/public/);
      expect(a.body).not.toMatch(/provider|seed|private|secret/i);
    });
  });

  describe('GET /api/v1/categories', () => {
    it('lists active categories as { code, index, name }', async () => {
      const res = await h.client().get('/api/v1/categories');
      expect(res.statusCode).toBe(200);
      const list = safeJson(res) as unknown[];
      expect(list).toContainEqual({ code: 'J', index: expect.any(Number), name: 'Jewelry' });
      for (const c of list) expect(Object.keys(c as object).sort()).toEqual(['code', 'index', 'name']);
    });
  });

  describe('POST /api/v1/verify', () => {
    it('verifies an issued code (happy path) and sets the device cookie', async () => {
      const p = await issue(h.ctx, catalog);
      const c = h.client();
      const res = await c.post('/api/v1/verify', {
        code: p.code.data,
        genome: { glyphs: p.genome.glyphs, confidence: p.genome.glyphs.map(() => 0.9) },
        client: { rsErrors: 0, rsErasures: 0, moduleSizePx: 6.5, decodeMs: 42, source: 'camera' },
      });
      expect(res.statusCode).toBe(200);
      const body = safeJson(res) as Record<string, any>;
      expect(body.state).toBe('AUTHENTIC');
      expect(body.verification).toMatchObject({ signature: 'VALID', keyId: 1, codeVersion: 'CODE-01', genomeVersion: 'GENOME-01' });
      expect(body.product.productId).toBe(p.product.productId);
      expect(body.genome.fingerprint).toBe(p.genome.fingerprint);
      // Never internal facts.
      const keys = keysOf(body);
      for (const f of INTERNAL_FIELDS) expect(keys.has(f)).toBe(false);
      expect(res.body).not.toContain('"ISSUED"'); // the raw product status

      const device = res.cookies.find((x) => x.name === 'orbes_device');
      expect(device).toBeDefined();
      expect(device!.httpOnly).toBe(true);
      expect(device!.sameSite).toBe('Lax');
      expect(device!.maxAge).toBe(2 * 365 * 24 * 60 * 60);
      expect(device!.secure).toBeFalsy(); // test config is not production

      // The scan was recorded with pseudonymous metadata only.
      const scan = await h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', body.scanId).executeTakeFirstOrThrow();
      expect(scan.device_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(scan.ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(scan.ip_hash).not.toContain('203.0.113.10');
      expect(scan.user_agent_family).toBe('Safari/iOS');

      // The same device keeps its id (and hash) on the next scan.
      const again = await c.post('/api/v1/verify', { code: p.code.data });
      const scan2 = await h.ctx.db
        .selectFrom('scan_events')
        .selectAll()
        .where('id', '=', (safeJson(again) as { scanId: string }).scanId)
        .executeTakeFirstOrThrow();
      expect(scan2.device_hash).toBe(scan.device_hash);
      expect(again.cookies.find((x) => x.name === 'orbes_device')).toBeUndefined();
    });

    it('replaces a forged device cookie instead of trusting it', async () => {
      const p = await issue(h.ctx, catalog);
      const c = h.client();
      c.cookies.set('orbes_device', 'AAAAAAAAAAAAAAAAAAAAAA.forged-signature');
      const res = await c.post('/api/v1/verify', { code: p.code.data });
      expect(res.statusCode).toBe(200);
      const set = res.cookies.find((x) => x.name === 'orbes_device');
      expect(set).toBeDefined();
      expect(set!.value.startsWith('AAAAAAAAAAAAAAAAAAAAAA.')).toBe(false);
    });

    it('recognises the logged-in owner', async () => {
      const p = await issue(h.ctx, catalog);
      const { client } = await accountClient(h);
      const me = await client.get('/api/v1/account/me');
      expect(me.statusCode).toBe(200);
      const account = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', (safeJson(me) as any).account.email).executeTakeFirstOrThrow();
      // Register ownership directly (the ownership API flow has its own tests).
      await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, { type: 'system' });
      const scan = await client.post('/api/v1/verify', { code: p.code.data });
      const token = (safeJson(scan) as any).registration.token as string;
      await h.ctx.services.ownership.registerFirst(account.id, { registrationToken: token }, { type: 'account', id: account.id });
      const res = await client.post('/api/v1/verify', { code: p.code.data });
      expect((safeJson(res) as any).state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');
      expect((safeJson(res) as any).ownership).toMatchObject({ registered: true, you: true });
      // Anonymous viewer of the same product.
      const anon = await h.client().post('/api/v1/verify', { code: p.code.data });
      expect((safeJson(anon) as any).state).toBe('AUTHENTIC_REGISTERED');
    });

    it('answers MALFORMED_CODE (200) for well-formed base64url that is not a code', async () => {
      const res = await h.client().post('/api/v1/verify', { code: toBase64Url(new Uint8Array(79).fill(7)) });
      expect(res.statusCode).toBe(200);
      expect((safeJson(res) as any).state).toBe('MALFORMED_CODE');
    });

    // Contract §2.4 step 1: any failure to decode the code (alphabet, length ≤ 200, framing) is the
    // MALFORMED_CODE state, recorded as a scan, not a request error.
    it('answers MALFORMED_CODE (200) for characters outside base64url, and records the scan', async () => {
      const res = await h.client().post('/api/v1/verify', { code: 'abc+/=def' });
      expect(res.statusCode).toBe(200);
      const body = safeJson(res) as any;
      expect(body.state).toBe('MALFORMED_CODE');
      const scan = await h.ctx.db.selectFrom('scan_events').select('result_state').where('id', '=', body.scanId).executeTakeFirstOrThrow();
      expect(scan.result_state).toBe('MALFORMED_CODE');
    });

    it('answers MALFORMED_CODE (200) for an empty code or one longer than 200 characters', async () => {
      for (const code of ['', 'A'.repeat(201)]) {
        const res = await h.client().post('/api/v1/verify', { code });
        expect(res.statusCode).toBe(200);
        expect((safeJson(res) as any).state).toBe('MALFORMED_CODE');
      }
    });

    it('still rejects a non-string or absurdly long code field with 400', async () => {
      for (const code of [42, null, 'A'.repeat(1025)]) {
        const res = await h.client().post('/api/v1/verify', { code });
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      }
      const missing = await h.client().post('/api/v1/verify', {});
      expect(missing.statusCode).toBe(400);
    });

    it('rejects unknown fields (top level and nested) with 400', async () => {
      const p = await issue(h.ctx, catalog);
      const c = h.client();
      const top = await c.post('/api/v1/verify', { code: p.code.data, admin: true });
      expect(top.statusCode).toBe(400);
      expect(errorOf(top).message).toMatch(/unknown fields/i);
      const nested = await c.post('/api/v1/verify', { code: p.code.data, client: { source: 'camera', riskScore: 0 } });
      expect(nested.statusCode).toBe(400);
    });

    it('rejects a malformed genome reading with 400', async () => {
      const p = await issue(h.ctx, catalog);
      const res = await h.client().post('/api/v1/verify', { code: p.code.data, genome: { glyphs: [1, 2, 3] } });
      expect(res.statusCode).toBe(400);
      const res2 = await h.client().post('/api/v1/verify', { code: p.code.data, genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 16] } });
      expect(res2.statusCode).toBe(400);
    });

    it('rejects oversized bodies with 413', async () => {
      const res = await h.client().post('/api/v1/verify', { code: 'A', pad: 'x'.repeat(20_000) });
      expect(res.statusCode).toBe(413);
      expect(errorOf(res).code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects invalid JSON, a missing body and non-JSON content types', async () => {
      const c = h.client();
      const bad = await c.request('POST', '/api/v1/verify', { body: '{"code":', headers: { 'content-type': 'application/json' } });
      expect(bad.statusCode).toBe(400);
      expect(errorOf(bad).code).toBe('INVALID_JSON');
      const none = await c.request('POST', '/api/v1/verify');
      expect(none.statusCode).toBe(400);
      expect(errorOf(none).code).toBe('VALIDATION_FAILED');
      const text = await c.request('POST', '/api/v1/verify', { body: 'code=abc', headers: { 'content-type': 'text/plain' } });
      expect(text.statusCode).toBe(415);
      const form = await c.request('POST', '/api/v1/verify', { body: 'code=abc', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      expect(form.statusCode).toBe(415);
      // An empty JSON body is "no body": still a validation error where a body is required.
      const empty = await c.request('POST', '/api/v1/verify', { body: '', headers: { 'content-type': 'application/json' } });
      expect(empty.statusCode).toBe(400);
      expect(errorOf(empty).code).toBe('VALIDATION_FAILED');
      const charset = await c.request('POST', '/api/v1/verify', { body: '{"code":"AAAA"}', headers: { 'content-type': 'application/json; charset=utf-8' } });
      expect(charset.statusCode).toBe(200);
    });

    it('rejects prototype-poisoning payloads', async () => {
      const res = await h.client().request('POST', '/api/v1/verify', {
        body: '{"code":"AAAA","__proto__":{"admin":true}}',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).not.toBe('INTERNAL_ERROR');
    });
  });

  it('answers unknown routes with a 404 error body', async () => {
    const res = await h.client().get('/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(safeJson(res)).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
});
