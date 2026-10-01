import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../../src/server/http/security.js';
import type { VerificationService } from '../../src/server/services/verification.js';
import { DomainError } from '../../src/server/errors.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, issue, ORIGIN, PASSWORD, safeJson, seedCatalog, type Harness } from './support.js';

const EXACT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

describe('security headers', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('sends the contract CSP verbatim and the hardening headers on every response', async () => {
    expect(CONTENT_SECURITY_POLICY).toBe(EXACT_CSP);
    const c = h.client();
    for (const res of [await c.get('/api/v1/health'), await c.get('/api/v1/nope'), await c.post('/api/v1/verify', { code: '!' })]) {
      expect(res.headers['content-security-policy']).toBe(EXACT_CSP);
      expect(res.headers['permissions-policy']).toBe('camera=(self)');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['strict-transport-security']).toBeUndefined(); // not production
    }
  });
});

describe('production configuration', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ config: { env: 'production' } });
  });
  afterAll(() => h?.close());

  it('adds HSTS', async () => {
    const res = await h.client().get('/api/v1/health');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+; includeSubDomains/);
  });

  it('marks every cookie Secure, HttpOnly and SameSite', async () => {
    const { client } = await accountClient(h);
    const me = await client.post('/api/v1/account/login', { email: (safeJson(await client.get('/api/v1/account/me')) as any).account.email, password: PASSWORD });
    const session = me.cookies.find((x) => x.name === '__Host-orbes_session')!;
    expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(session.domain).toBeUndefined();
    expect(me.cookies.find((x) => x.name === 'orbes_session')).toBeUndefined();

    const creds = await createAdmin(h.ctx, 'ADMIN');
    const admin = await h.client().post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(admin.cookies.find((x) => x.name === '__Host-orbes_admin')).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });

    const catalog = await seedCatalog(h.ctx);
    const p = await issue(h.ctx, catalog);
    const v = await h.client().post('/api/v1/verify', { code: p.code.data });
    expect(v.cookies.find((x) => x.name === '__Host-orbes_device')).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
    // An unprefixed cookie planted by a sibling subdomain or over plain HTTP is not a session in production.
    const planted = h.client();
    planted.cookies.set('orbes_session', session.value);
    expect((await planted.get('/api/v1/account/me')).statusCode).toBe(401);
  });

  it('enforces admin MFA by default', async () => {
    const c = await adminClient(h, 'ADMIN');
    const res = await c.get('/api/admin/dashboard');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('MFA_REQUIRED');
  });
});

describe('CSRF protection', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  const transfer = { productId: 'O26-J-00001' };

  it('requires the session CSRF token on cookie-authenticated mutations', async () => {
    const { client } = await accountClient(h);
    const missing = await client.post('/api/v1/ownership/transfers', transfer, { noCsrf: true });
    expect(missing.statusCode).toBe(403);
    expect(errorOf(missing).code).toBe('CSRF_FAILED');

    const wrong = await client.post('/api/v1/ownership/transfers', transfer, { noCsrf: true, headers: { 'x-csrf-token': 'A'.repeat(43) } });
    expect(wrong.statusCode).toBe(403);

    // Another session's token does not work either.
    const { client: other } = await accountClient(h);
    const foreign = await client.post('/api/v1/ownership/transfers', transfer, { noCsrf: true, headers: { 'x-csrf-token': other.csrf! } });
    expect(foreign.statusCode).toBe(403);

    // With the right token the request reaches the service (NOT_OWNER: unknown ids answer like others' products).
    const ok = await client.post('/api/v1/ownership/transfers', transfer);
    expect(ok.statusCode).toBe(403);
    expect(errorOf(ok).code).toBe('NOT_OWNER');
  });

  it('requires Origin == PUBLIC_ORIGIN, or no Origin with Sec-Fetch-Site: same-origin', async () => {
    const { client } = await accountClient(h);
    const evil = await client.post('/api/v1/ownership/transfers', transfer, { origin: 'https://evil.example' });
    expect(evil.statusCode).toBe(403);
    expect(errorOf(evil).code).toBe('CSRF_FAILED');
    const nullOrigin = await client.post('/api/v1/ownership/transfers', transfer, { origin: 'null' });
    expect(nullOrigin.statusCode).toBe(403);
    const lookalike = await client.post('/api/v1/ownership/transfers', transfer, { origin: `${ORIGIN}.evil.example` });
    expect(lookalike.statusCode).toBe(403);
    const none = await client.post('/api/v1/ownership/transfers', transfer, { origin: null });
    expect(none.statusCode).toBe(403);
    const crossSite = await client.post('/api/v1/ownership/transfers', transfer, { origin: null, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.statusCode).toBe(403);
    const sameOrigin = await client.post('/api/v1/ownership/transfers', transfer, { origin: null, headers: { 'sec-fetch-site': 'same-origin' } });
    expect(errorOf(sameOrigin).code).toBe('NOT_OWNER'); // passed the CSRF check, refused by the service
  });

  it('protects admin mutations the same way, and reads need no token', async () => {
    const admin = await adminClient(h, 'ADMIN');
    expect((await admin.post('/api/admin/collections', { name: 'X' }, { noCsrf: true })).statusCode).toBe(403);
    expect((await admin.post('/api/admin/collections', { name: 'X' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await admin.post('/api/admin/collections', { name: 'CSRF-OK' })).statusCode).toBe(201);
    expect((await admin.get('/api/admin/collections')).statusCode).toBe(200);
  });

  it('session-less mutations (register/login) still need a same-origin request', async () => {
    const res = await h.client({ origin: 'https://evil.example' }).post('/api/v1/account/register', { email: 'csrf@example.com', password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(res.cookies.find((x) => x.name === 'orbes_session')).toBeUndefined();
  });

  it('public verify needs no CSRF token (no session is required)', async () => {
    const res = await h.client({ origin: null }).post('/api/v1/verify', { code: 'AAAA' });
    expect(res.statusCode).toBe(200);
  });
});

describe('rate limiting', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { verifyPerMinute: 3, authPerMinute: 3, adminPerMinute: 4 } } });
  });
  afterAll(() => h?.close());

  it('limits /verify per client and answers 429 with Retry-After', async () => {
    const c = h.client({ ip: '198.51.100.1' });
    for (let i = 0; i < 3; i++) expect((await c.post('/api/v1/verify', { code: 'AAAA' })).statusCode).toBe(200);
    const limited = await c.post('/api/v1/verify', { code: 'AAAA' });
    expect(limited.statusCode).toBe(429);
    expect(errorOf(limited)).toEqual({ code: 'RATE_LIMITED', message: expect.any(String) });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await h.client({ ip: '198.51.100.2' }).post('/api/v1/verify', { code: 'AAAA' })).statusCode).toBe(200);
    // IPv6 clients are grouped per /64.
    const v6a = h.client({ ip: '2001:db8:1:2::a' });
    const v6b = h.client({ ip: '2001:db8:1:2::b' });
    for (let i = 0; i < 3; i++) await v6a.post('/api/v1/verify', { code: 'AAAA' });
    expect((await v6b.post('/api/v1/verify', { code: 'AAAA' })).statusCode).toBe(429);
  });

  it('shares one auth budget across account login, registration and admin login', async () => {
    const ip = '198.51.100.3';
    const c = h.client({ ip });
    expect((await c.post('/api/v1/account/login', { email: 'a@example.com', password: 'whatever-whatever' })).statusCode).toBe(401);
    expect((await c.post('/api/v1/account/register', { email: 'b@example.com', password: 'short' })).statusCode).toBe(400);
    expect((await c.post('/api/admin/auth/login', { email: 'c@example.com', password: 'whatever-whatever' })).statusCode).toBe(401);
    const limited = await c.post('/api/admin/auth/login', { email: 'c@example.com', password: 'whatever-whatever' });
    expect(limited.statusCode).toBe(429);
    // The verify budget of the same client is separate.
    expect((await c.post('/api/v1/verify', { code: 'AAAA' })).statusCode).toBe(200);
  });

  it('limits the admin API per client', async () => {
    const admin = await adminClient(h, 'AUDITOR', { ip: '198.51.100.4' });
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await admin.get('/api/admin/dashboard')).statusCode;
    expect(last).toBe(429);
  });
});

describe('pagination and error hygiene', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({
      context: {
        services: {
          verification: {
            verify: async () => {
              const e = new Error('database exploded: password=hunter2 at /srv/orbes/src/server/x.ts:42');
              throw e;
            },
          } as unknown as VerificationService,
        },
      },
    });
  });
  afterAll(() => h?.close());

  it('clamps pagination to 1..200 and falls back on garbage', async () => {
    const admin = await adminClient(h, 'AUDITOR');
    const cases: [string, number, number][] = [
      ['', 1, 50],
      ['?pageSize=1000', 1, 200],
      ['?pageSize=0', 1, 50],
      ['?page=-3&pageSize=-1', 1, 50],
      ['?page=abc&pageSize=1e3', 1, 50],
      ['?page=2&pageSize=7', 2, 7],
    ];
    for (const [q, page, pageSize] of cases) {
      const res = await admin.get(`/api/admin/audit${q}`);
      expect(res.statusCode, q).toBe(200);
      const body = safeJson(res) as any;
      expect({ page: body.page, pageSize: body.pageSize }, q).toEqual({ page, pageSize });
      expect(body.items.length).toBeLessThanOrEqual(pageSize);
      expect(typeof body.total).toBe('number');
    }
    const far = safeJson(await admin.get('/api/admin/audit?page=999999')) as any;
    expect(far.items).toEqual([]);
  });

  it('never leaks stack traces or internal messages in error responses', async () => {
    const res = await h.client().post('/api/v1/verify', { code: 'AAAA' });
    expect(res.statusCode).toBe(500);
    expect(safeJson(res)).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
    expect(res.body).not.toMatch(/stack|exploded|hunter2|\.ts:|at \//);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('deliberate 5xx domain errors keep their public message only', async () => {
    const h2 = await createHarness({
      context: {
        services: {
          verification: {
            verify: async () => {
              throw new DomainError('VERIFY_UNAVAILABLE', 503, 'Verification is temporarily unavailable.', { detail: 'pool exhausted', cause: new Error('secret cause') });
            },
          } as unknown as VerificationService,
        },
      },
    });
    try {
      const res = await h2.client().post('/api/v1/verify', { code: 'AAAA' });
      expect(res.statusCode).toBe(503);
      expect(safeJson(res)).toEqual({ error: { code: 'VERIFY_UNAVAILABLE', message: 'Verification is temporarily unavailable.' } });
      expect(res.body).not.toMatch(/pool|secret cause/);
    } finally {
      await h2.close();
    }
  });

  it('validation errors name the field, never echo the value', async () => {
    const res = await h.client().post('/api/v1/account/register', { email: 'x@example.com', password: PASSWORD, displayName: 'y'.repeat(81) });
    expect(res.statusCode).toBe(400);
    const e = errorOf(res);
    expect(e.message).toMatch(/displayName/);
    expect(e.message).not.toContain('yyyy');
  });
});
