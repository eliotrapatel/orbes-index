/**
 * Platform behaviour of the HTTP layer: configuration wiring (api rate-limit
 * group, admin MFA switch, log level), the shutdown 503, the anonymous
 * session probe and account registration details.
 */
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loggerOptions } from '../../src/server/http/logging.js';
import { groupLimits } from '../../src/server/http/rate-limit.js';
import { testConfig } from '../../src/server/config.js';
import type { VerificationService } from '../../src/server/services/verification.js';
import { accountClient, adminClient, createHarness, errorOf, PASSWORD, safeJson, type Harness } from './support.js';

describe('configuration wiring', () => {
  it('the api route group has its own budget (RATE_LIMIT_API_PER_MINUTE), separate from the admin one', async () => {
    expect(groupLimits(testConfig({ rateLimits: { apiPerMinute: 7, adminPerMinute: 9 } }))).toMatchObject({ api: 7, admin: 9 });
    const h = await createHarness({ config: { rateLimits: { apiPerMinute: 2, adminPerMinute: 1000 } } });
    try {
      const c = h.client({ ip: '198.51.100.20' });
      expect((await c.get('/api/v1/categories')).statusCode).toBe(200);
      expect((await c.get('/api/v1/categories')).statusCode).toBe(200);
      const limited = await c.get('/api/v1/categories');
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).code).toBe('RATE_LIMITED');
      const admin = await adminClient(h, 'AUDITOR', { ip: '198.51.100.21' });
      for (let i = 0; i < 4; i++) expect((await admin.get('/api/admin/dashboard')).statusCode).toBe(200);
    } finally {
      await h.close();
    }
  });

  it('ADMIN_REQUIRE_MFA (config.adminRequireMfa) decides whether admin sessions need TOTP', async () => {
    expect(testConfig({ env: 'production' }).adminRequireMfa).toBe(true);
    expect(testConfig().adminRequireMfa).toBe(false);
    const enforced = await createHarness({ config: { adminRequireMfa: true } });
    const relaxed = await createHarness({ config: { env: 'production', adminRequireMfa: false } });
    try {
      const blocked = await (await adminClient(enforced, 'ADMIN')).get('/api/admin/dashboard');
      expect(blocked.statusCode).toBe(403);
      expect(errorOf(blocked).code).toBe('MFA_REQUIRED');
      expect((await (await adminClient(relaxed, 'ADMIN')).get('/api/admin/dashboard')).statusCode).toBe(200);
    } finally {
      await enforced.close();
      await relaxed.close();
    }
  });

  it('LOG_LEVEL (config.logLevel) sets the server log level', () => {
    expect((loggerOptions(testConfig({ logLevel: 'error' })) as { level: string }).level).toBe('error');
    expect((loggerOptions(testConfig()) as { level: string }).level).toBe('warn');
  });
});

describe('graceful shutdown', () => {
  it('answers requests that arrive while closing with 503 in the standard error shape', async () => {
    let release: () => void = () => {};
    let started: () => void = () => {};
    const inFlight = new Promise<void>((r) => (started = r));
    const slow = {
      verify: async () => {
        started();
        await new Promise<void>((r) => (release = r));
        return { state: 'MALFORMED_CODE' };
      },
    } as unknown as VerificationService;
    const h = await createHarness({ context: { services: { verification: slow } } });
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = h.app.server.address() as { port: number };

    const socket = connect(port, '127.0.0.1');
    let raw = '';
    socket.on('data', (d) => (raw += d.toString('utf8')));
    const body = JSON.stringify({ code: 'AAAA' });
    socket.write(`POST /api/v1/verify HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    await inFlight;
    const closed = h.app.close();
    await new Promise((r) => setTimeout(r, 50));
    // Same keep-alive connection, new request: the server is draining.
    socket.write('GET /api/v1/health HTTP/1.1\r\nHost: x\r\n\r\n');
    await new Promise((r) => setTimeout(r, 50));
    release();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    socket.destroy();
    await h.ctx.close();
    await h.t.close();

    const second = raw.slice(raw.indexOf('HTTP/1.1', 5));
    expect(second).toMatch(/^HTTP\/1\.1 503 /);
    expect(second.toLowerCase()).toContain('connection: close');
    expect(second.toLowerCase()).toContain("content-security-policy: default-src 'self'");
    expect(JSON.parse(second.slice(second.indexOf('\r\n\r\n') + 4))).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: expect.any(String) },
    });
  });
});

describe('account session probe and registration', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('GET /api/v1/account/session answers 200 { account: null } for anonymous visitors (no console 401)', async () => {
    const anon = await h.client().get('/api/v1/account/session');
    expect(anon.statusCode).toBe(200);
    expect(safeJson(anon)).toEqual({ account: null });
    expect(anon.headers['cache-control']).toBe('no-store');

    const { client, email } = await accountClient(h);
    const signed = await client.get('/api/v1/account/session');
    expect(signed.statusCode).toBe(200);
    expect(safeJson(signed)).toEqual({ account: { email, displayName: 'Owner' }, csrfToken: expect.any(String) });

    // A dead cookie reads as anonymous and is cleared.
    const stale = h.client();
    stale.cookies.set('orbes_session', 'A'.repeat(43));
    const res = await stale.get('/api/v1/account/session');
    expect(safeJson(res)).toEqual({ account: null });
    expect(res.cookies.find((x) => x.name === 'orbes_session')?.value).toBe('');
  });

  it('registration accepts an optional ISO 3166-1 country', async () => {
    const c = h.client();
    const res = await c.post('/api/v1/account/register', { email: 'country@example.com', password: PASSWORD, country: 'fr' });
    expect(res.statusCode).toBe(201);
    const row = await h.ctx.db.selectFrom('accounts').select('country').where('email_normalized', '=', 'country@example.com').executeTakeFirstOrThrow();
    expect(row.country).toBe('FR');
    const bad = await h.client().post('/api/v1/account/register', { email: 'country2@example.com', password: PASSWORD, country: 'FRA' });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad).message).toMatch(/^country: /);
    const none = await h.client().post('/api/v1/account/register', { email: 'country3@example.com', password: PASSWORD, country: '' });
    expect(none.statusCode).toBe(201);
  });
});
