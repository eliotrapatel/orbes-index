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

  describe('GET /api/v1/client-services', () => {
    it('answers {} when nothing is configured (the app then shows no contact), cacheable for 5 minutes', async () => {
      const res = await h.client().get('/api/v1/client-services');
      expect(res.statusCode).toBe(200);
      expect(safeJson(res)).toEqual({});
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });

    it('serves the configured email, phone and hours, and nothing else of the configuration', async () => {
      const cs = await createHarness({
        config: {
          clientServices: { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' },
          // A distinct budget per group, so the header names the group the route draws on.
          rateLimits: { verifyPerMinute: 9_001, authPerMinute: 9_002, adminPerMinute: 9_003, apiPerMinute: 9_004 },
        },
      });
      try {
        const res = await cs.client().get('/api/v1/client-services');
        expect(res.statusCode).toBe(200);
        expect(safeJson(res)).toEqual({ email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' });
        expect(res.headers['cache-control']).toBe('public, max-age=300');
        // A public route of the api group: no session needed, rate-limited like the other reads.
        expect(res.headers['x-ratelimit-limit']).toBe(String(cs.ctx.config.rateLimits.apiPerMinute));
        expect(cs.ctx.config.rateLimits.apiPerMinute).toBe(9_004);
        // Only what was set: a phone alone is served alone.
        const phoneOnly = await createHarness({ config: { clientServices: { phone: '+33 1 23 45 67 89' } } });
        try {
          expect(safeJson(await phoneOnly.client().get('/api/v1/client-services'))).toEqual({ phone: '+33 1 23 45 67 89' });
        } finally {
          await phoneOnly.close();
        }
      } finally {
        await cs.close();
      }
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

  describe('POST /api/v1/reports', () => {
    /** A scan the customer may report on: an undecodable code reads UNREADABLE CODE (MALFORMED_CODE). */
    const unreadableScan = async (c = h.client()) => (safeJson(await c.post('/api/v1/verify', { code: 'abc+/=def' })) as { scanId: string; state: string }).scanId;
    const auditOf = (scanId: string) => h.ctx.db.selectFrom('audit_logs').selectAll().where('target_id', '=', scanId).orderBy('id').execute();

    it('attaches the report to a scan that was not authentic (201), audited with the scan id alone, once per scan', async () => {
      const c = h.client();
      const scanId = await unreadableScan(c);
      const res = await c.post('/api/v1/reports', { scanId, channel: 'ONLINE', where: '  a marketplace listing  ', note: 'Listed at a third of the boutique price.' });
      expect(res.statusCode).toBe(201);
      expect(safeJson(res)).toEqual({ ok: true });
      expect(res.headers['cache-control']).toBe('no-store');
      const row = await h.ctx.db.selectFrom('scan_reports').selectAll().where('scan_event_id', '=', scanId).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ channel: 'ONLINE', place: 'a marketplace listing', note: 'Listed at a third of the boutique price.', status: 'OPEN', handled_by: null });
      expect(row.created_at).toEqual(h.clock.now());

      // The audit names the scan and nothing the customer wrote (the log is permanent; the report is purged with the scan).
      const audit = await auditOf(scanId);
      expect(audit.map((a) => [a.action, a.target_type, a.actor_type, a.actor_id, a.details])).toEqual([['scan.report', 'scan', 'system', 'public', {}]]);
      expect(audit[0].ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(audit)).not.toMatch(/marketplace|third of the boutique/);

      // One report per scan.
      const again = await c.post('/api/v1/reports', { scanId, channel: 'OTHER' });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again)).toEqual({ code: 'REPORT_ALREADY_SENT', message: 'A report has already been sent for this reference.' });
      expect(await h.ctx.db.selectFrom('scan_reports').select('id').where('scan_event_id', '=', scanId).execute()).toHaveLength(1);
      // Optional fields may be left out, or sent empty or blank: all mean "not given".
      const bare = await c.post('/api/v1/reports', { scanId: await unreadableScan(c), channel: 'PRIVATE', where: '', note: null });
      expect(bare.statusCode).toBe(201);
      const blankScan = await unreadableScan(c);
      const blank = await c.post('/api/v1/reports', { scanId: blankScan, channel: 'OTHER', where: '   ', note: ' \n\t ' });
      expect(blank.statusCode, blank.body).toBe(201);
      expect(await h.ctx.db.selectFrom('scan_reports').select(['place', 'note']).where('scan_event_id', '=', blankScan).executeTakeFirstOrThrow()).toEqual({ place: null, note: null });
    });

    it('refuses an authentic scan, a scan 24 hours old and an unknown scan alike: 409 REPORT_NOT_ALLOWED', async () => {
      const notAllowed = async (scanId: string, message: RegExp = /within 24 hours of a result that was not authentic/) => {
        const res = await h.client().post('/api/v1/reports', { scanId, channel: 'BOUTIQUE' });
        expect(res.statusCode, scanId).toBe(409);
        expect(errorOf(res).code).toBe('REPORT_NOT_ALLOWED');
        expect(errorOf(res).message).toMatch(message);
      };
      // Authentic: nothing to report.
      const p = await issue(h.ctx, catalog);
      const authentic = safeJson(await h.client().post('/api/v1/verify', { code: p.code.data })) as { scanId: string; state: string };
      expect(authentic.state).toBe('AUTHENTIC');
      await notAllowed(authentic.scanId);
      // 24 hours after the scan the window has closed; a minute before, it is still open.
      const at = (msAgo: number) =>
        h.ctx.db
          .insertInto('scan_events')
          .values({ occurred_at: new Date(h.clock.now().getTime() - msAgo), event_type: 'VERIFY', result_state: 'UNKNOWN' })
          .returning('id')
          .executeTakeFirstOrThrow();
      await notAllowed((await at(24 * 3_600_000)).id);
      expect((await h.client().post('/api/v1/reports', { scanId: (await at(24 * 3_600_000 - 60_000)).id, channel: 'BOUTIQUE' })).statusCode).toBe(201);
      // Not a customer's verification (a staff scan: the same code, a message that says why), and no scan at all.
      const test = await h.ctx.db.insertInto('scan_events').values({ event_type: 'ADMIN_TEST', result_state: 'UNKNOWN' }).returning('id').executeTakeFirstOrThrow();
      await notAllowed(test.id, /signed in to the ORBES console, so this scan was recorded as a staff test/);
      await notAllowed('00000000-0000-4000-8000-000000000000');
      expect(await h.ctx.db.selectFrom('scan_reports').select('id').where('scan_event_id', '=', authentic.scanId).execute()).toEqual([]);
    });

    it('validates the body (400) and refuses a cross-site request (403)', async () => {
      const scanId = await unreadableScan();
      for (const body of [
        { scanId, channel: 'MARKET' },
        { scanId, channel: 'ONLINE', where: 'x'.repeat(201) },
        { scanId, channel: 'ONLINE', note: 'x'.repeat(501) },
        { scanId, channel: 'ONLINE', note: 'bell\u0007' },
        { scanId: 'not-a-uuid', channel: 'ONLINE' },
        { channel: 'ONLINE' },
        { scanId, channel: 'ONLINE', email: 'me@example.com' },
      ]) {
        const res = await h.client().post('/api/v1/reports', body);
        expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      }
      for (const origin of ['https://evil.example', null]) {
        const res = await h.client({ origin }).post('/api/v1/reports', { scanId, channel: 'ONLINE' });
        expect(res.statusCode, String(origin)).toBe(403);
        expect(errorOf(res).code).toBe('CSRF_FAILED');
      }
      expect(await h.ctx.db.selectFrom('scan_reports').select('id').where('scan_event_id', '=', scanId).execute()).toEqual([]);
    });

    it('records a signed-in customer as the reporting account, and draws on the verify budget', async () => {
      const { client } = await accountClient(h);
      const scanId = await unreadableScan(client);
      expect((await client.post('/api/v1/reports', { scanId, channel: 'BOUTIQUE', where: 'Rue de Rivoli' })).statusCode).toBe(201);
      const account = await h.ctx.db.selectFrom('scan_events').select('account_id').where('id', '=', scanId).executeTakeFirstOrThrow();
      expect(account.account_id).not.toBeNull();
      expect((await auditOf(scanId)).map((a) => [a.action, a.actor_type, a.actor_id])).toEqual([['scan.report', 'account', account.account_id]]);

      const budgets = await createHarness({ config: { rateLimits: { verifyPerMinute: 9_001, authPerMinute: 9_002, adminPerMinute: 9_003, apiPerMinute: 9_004 } } });
      try {
        const c = budgets.client();
        const scan = safeJson(await c.post('/api/v1/verify', { code: 'abc+/=def' })) as { scanId: string };
        const res = await c.post('/api/v1/reports', { scanId: scan.scanId, channel: 'OTHER' });
        expect(res.statusCode).toBe(201);
        expect(res.headers['x-ratelimit-limit']).toBe('9001');
      } finally {
        await budgets.close();
      }
    });
  });

  it('answers unknown routes with a 404 error body', async () => {
    const res = await h.client().get('/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(safeJson(res)).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
});
