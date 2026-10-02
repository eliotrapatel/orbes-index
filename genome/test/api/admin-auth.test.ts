import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { createAdmin, createHarness, errorOf, safeJson, type Harness } from './support.js';

describe('admin authentication', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('logs in with a password, reads /me and logs out', async () => {
    const creds = await createAdmin(h.ctx, 'OPERATOR');
    const c = h.client();
    const res = await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(res.statusCode).toBe(200);
    const body = safeJson(res) as any;
    expect(body.admin).toEqual({ id: creds.id, email: creds.email, role: 'OPERATOR', totpEnabled: false, passwordChangeRequired: false });
    expect(body.mfaPassed).toBe(false);
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.cookies.find((x) => x.name === 'orbes_admin')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');

    const me = await c.get('/api/admin/auth/me');
    expect(me.statusCode).toBe(200);
    expect((safeJson(me) as any).admin.role).toBe('OPERATOR');

    // An account cookie is no admin session and vice versa.
    const confused = h.client();
    confused.cookies.set('orbes_session', cookie.value);
    expect((await confused.get('/api/admin/auth/me')).statusCode).toBe(401);
    const confused2 = h.client();
    confused2.cookies.set('orbes_admin', cookie.value);
    expect((await confused2.get('/api/v1/account/me')).statusCode).toBe(401);

    expect((await c.post('/api/admin/auth/logout')).statusCode).toBe(200);
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(401);

    // The login and logout were audited with the hashed client IP.
    const entries = await h.ctx.db.selectFrom('audit_logs').selectAll().where('actor_id', '=', creds.id).orderBy('id').execute();
    expect(entries.map((e) => e.action)).toEqual(['admin.login', 'admin.logout']);
    for (const e of entries) expect(e.ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('refuses wrong passwords and unknown admins alike (401)', async () => {
    const creds = await createAdmin(h.ctx, 'AUDITOR');
    const wrong = await h.client().post('/api/admin/auth/login', { email: creds.email, password: 'definitely wrong pw' });
    const unknown = await h.client().post('/api/admin/auth/login', { email: 'ghost@orbes.test', password: 'definitely wrong pw' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(errorOf(wrong)).toEqual(errorOf(unknown));
  });

  it('enrols TOTP, then requires the code at login', async () => {
    const creds = await createAdmin(h.ctx, 'ADMIN');
    const c = h.client();
    await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password });

    const setup = await c.post('/api/admin/auth/totp/setup');
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUri } = safeJson(setup) as { secret: string; otpauthUri: string };
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const badCode = await c.post('/api/admin/auth/totp/enable', { secret, code: '000000' });
    expect(badCode.statusCode).toBe(400);
    const code = totp(base32Decode(secret), h.clock.now().getTime());
    const before = c.cookies.get('orbes_admin')!;
    const enable = await c.post('/api/admin/auth/totp/enable', { secret, code });
    expect(enable.statusCode).toBe(200);
    expect(safeJson(enable)).toEqual({ ok: true, mfaPassed: true, csrfToken: expect.any(String) });
    // The step-up issues a NEW session token: the pre-MFA cookie is dead.
    expect(c.cookies.get('orbes_admin')).not.toBe(before);
    const stale = h.client();
    stale.cookies.set('orbes_admin', before);
    expect((await stale.get('/api/admin/auth/me')).statusCode).toBe(401);
    expect((safeJson(await c.get('/api/admin/auth/me')) as any).mfaPassed).toBe(true);

    await c.post('/api/admin/auth/logout');
    const noCode = await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(noCode.statusCode).toBe(401);
    expect(errorOf(noCode).code).toBe('TOTP_REQUIRED');

    // The enrolment code was consumed; the next time step is a fresh code.
    h.clock.advance(30_000);
    const wrong = await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password, totp: '123456' === code ? '654321' : '123456' });
    expect(wrong.statusCode).toBe(401);
    const fresh = totp(base32Decode(secret), h.clock.now().getTime());
    const ok = await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password, totp: fresh });
    expect(ok.statusCode).toBe(200);
    expect((safeJson(ok) as any).mfaPassed).toBe(true);
    expect((safeJson(ok) as any).admin.totpEnabled).toBe(true);
    // Replay of the same code is refused.
    const replay = await h.client().post('/api/admin/auth/login', { email: creds.email, password: creds.password, totp: fresh });
    expect(replay.statusCode).toBe(401);
  });

  it('an AUDITOR (read-only) can still manage its own session and second factor', async () => {
    const creds = await createAdmin(h.ctx, 'AUDITOR');
    const c = h.client();
    await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    const setup = await c.post('/api/admin/auth/totp/setup');
    expect(setup.statusCode).toBe(200);
    const { secret } = safeJson(setup) as { secret: string };
    expect((await c.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), h.clock.now().getTime()) })).statusCode).toBe(200);
    expect((await c.post('/api/admin/auth/totp/setup')).statusCode).toBe(409); // already enrolled
    expect((await c.post('/api/admin/auth/logout')).statusCode).toBe(200);
  });

  it('login is same-origin only (cross-site login CSRF)', async () => {
    const creds = await createAdmin(h.ctx, 'AUDITOR');
    const evil = await h.client({ origin: 'https://evil.example' }).post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(evil.statusCode).toBe(403);
    expect(errorOf(evil).code).toBe('CSRF_FAILED');
    expect(evil.cookies.find((x) => x.name === 'orbes_admin')).toBeUndefined();
  });
});

describe('admin MFA enforcement (production default)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ app: { requireAdminMfa: true } });
  });
  afterAll(() => h?.close());

  it('an admin without TOTP may only use the auth routes until enrolled', async () => {
    const creds = await createAdmin(h.ctx, 'ADMIN');
    const c = h.client();
    const login = await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password });
    expect(login.statusCode).toBe(200);
    expect((safeJson(login) as any).mfaRequired).toBe(true);

    const blocked = await c.get('/api/admin/dashboard');
    expect(blocked.statusCode).toBe(403);
    expect(errorOf(blocked).code).toBe('MFA_REQUIRED');
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(200);

    const { secret } = safeJson(await c.post('/api/admin/auth/totp/setup')) as { secret: string };
    const enable = await c.post('/api/admin/auth/totp/enable', { secret, code: totp(base32Decode(secret), h.clock.now().getTime()) });
    expect(enable.statusCode).toBe(200);
    expect((await c.get('/api/admin/dashboard')).statusCode).toBe(200);
  });
});
