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
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, issue, PASSWORD, safeJson, seedCatalog, type Harness } from './support.js';

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
    expect(safeJson(signed)).toEqual({ account: { email, displayName: 'Owner Test' }, csrfToken: expect.any(String) });

    // A dead cookie reads as anonymous and is cleared.
    const stale = h.client();
    stale.cookies.set('orbes_session', 'A'.repeat(43));
    const res = await stale.get('/api/v1/account/session');
    expect(safeJson(res)).toEqual({ account: null });
    expect(res.cookies.find((x) => x.name === 'orbes_session')?.value).toBe('');
  });

  // The country is required at sign-up since the customer intelligence lot (plan §3.1 P.4.2): an ISO 3166-1 code of H2's list.
  it('registration requires an ISO 3166-1 country', async () => {
    const names = { firstName: 'Ada', lastName: 'Lovelace' };
    const c = h.client();
    const res = await c.post('/api/v1/account/register', { email: 'country@example.com', password: PASSWORD, ...names, country: 'fr' });
    expect(res.statusCode).toBe(201);
    const row = await h.ctx.db.selectFrom('accounts').select('country').where('email_normalized', '=', 'country@example.com').executeTakeFirstOrThrow();
    expect(row.country).toBe('FR');
    const bad = await h.client().post('/api/v1/account/register', { email: 'country2@example.com', password: PASSWORD, ...names, country: 'FRA' });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad).message).toMatch(/^country: /);
    for (const country of ['', null, undefined, 'ZZ']) {
      const none = await h.client().post('/api/v1/account/register', { email: 'country3@example.com', password: PASSWORD, ...names, ...(country === undefined ? {} : { country }) });
      expect(none.statusCode, String(country)).toBe(400);
      expect(errorOf(none)).toEqual({ code: 'VALIDATION_FAILED', message: 'Choose your country.' });
    }
    expect(await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', 'country3@example.com').executeTakeFirst()).toBeUndefined();
  });
});

describe('admin management routes', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('ADMIN lists console users and resets another admin\'s TOTP (audited, their sessions end)', async () => {
    const admin = await adminClient(h, 'ADMIN');
    const target = await createAdmin(h.ctx, 'OPERATOR');
    const op = h.client();
    expect((await op.post('/api/admin/auth/login', { email: target.email, password: target.password })).statusCode).toBe(200);
    const { secret } = safeJson(await op.post('/api/admin/auth/totp/setup')) as { secret: string };
    expect((await op.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), h.clock.now().getTime()) })).statusCode).toBe(200);

    const list = safeJson(await admin.get('/api/admin/admins')) as { items: { id: string; email: string; role: string; totpEnabled: boolean; locked: boolean; disabled: boolean }[] };
    expect(list.items.find((a) => a.id === target.id)).toEqual({ id: target.id, email: target.email, role: 'OPERATOR', totpEnabled: true, passwordChangeRequired: false, locked: false, disabled: false, createdAt: expect.any(String), stockLocationIds: [] });

    const reset = await admin.post(`/api/admin/admins/${target.id}/totp/reset`, {});
    expect(reset.statusCode).toBe(200);
    expect(safeJson(reset)).toMatchObject({ admin: { id: target.id, totpEnabled: false } });
    expect((await h.ctx.services.auth.getAdmin(target.id)).totpEnabled).toBe(false);
    expect((await op.get('/api/admin/auth/me')).statusCode).toBe(401); // the lost device's sessions are gone
    const entry = (await h.ctx.audit.list({ action: 'admin.totp.disable' })).items[0];
    expect(entry).toMatchObject({ actorType: 'admin', targetType: 'admin', targetId: target.id, details: { sessionsRevoked: 1 } });

    const again = await admin.post(`/api/admin/admins/${target.id}/totp/reset`, {});
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('TOTP_NOT_ENABLED');
    const unknown = await admin.post('/api/admin/admins/00000000-0000-4000-8000-000000000000/totp/reset', {});
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('ADMIN_NOT_FOUND');
  });

  it('OPERATOR extends an activated warranty by whole months', async () => {
    const op = await adminClient(h, 'OPERATOR');
    const catalog = await seedCatalog(h.ctx);
    const p = await issue(h.ctx, catalog);
    const pid = p.product.productId;
    const early = await op.post(`/api/admin/products/${pid}/warranty/extend`, { months: 12 });
    expect(early.statusCode).toBe(409);
    expect(errorOf(early).code).toBe('WARRANTY_NOT_STARTED');
    expect((await op.post(`/api/admin/products/${pid}/warranty/activate`, { purchaseDate: '2026-01-15' })).statusCode).toBe(200);
    const res = await op.post(`/api/admin/products/${pid}/warranty/extend`, { months: 12 });
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ warranty: { durationMonths: 36, endDate: '2029-01-15' } });
    for (const months of [0, 1.5, 121, '12']) {
      const bad = await op.post(`/api/admin/products/${pid}/warranty/extend`, { months });
      expect(bad.statusCode, String(months)).toBe(400);
    }
    expect((await h.ctx.audit.list({ action: 'warranty.extend' })).items[0]).toMatchObject({ targetId: pid });
  });
});

describe('pre-sale service (ISSUED → SERVICED)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('does not open first registration for a piece that was never sold', async () => {
    const catalog = await seedCatalog(h.ctx);
    const p = await issue(h.ctx, catalog);
    const svc = await h.ctx.services.warranty.openService(p.product.productId, { type: 'INSPECTION' }, { type: 'system', id: 'qa' });
    const res = await h.client().post('/api/v1/verify', { code: p.code.data });
    const outcome = safeJson(res) as { state: string; registration?: unknown };
    expect(outcome.state).toBe('AUTHENTIC');
    expect(outcome.registration).toBeUndefined();
    // After the inspection the piece is ISSUED again; once sold (activated) it opens for registration.
    await h.ctx.services.warranty.completeService(svc.id, {}, { type: 'system', id: 'qa' });
    await h.ctx.services.warranty.activate(p.product.productId, {}, { type: 'system', id: 'retail' });
    const sold = safeJson(await h.client().post('/api/v1/verify', { code: p.code.data })) as { state: string };
    expect(sold.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
  });
});
