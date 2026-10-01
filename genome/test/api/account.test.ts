import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../src/server/services/sessions.js';
import { createHarness, errorOf, PASSWORD, safeJson, type Harness } from './support.js';

describe('account API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  const uniqueEmail = (tag: string) => `${tag}-${Math.random().toString(36).slice(2, 10)}@example.com`;

  it('registers, reads /me, logs out and in again', async () => {
    const c = h.client();
    const email = uniqueEmail('reg');
    const reg = await c.post('/api/v1/account/register', { email, password: PASSWORD, displayName: 'Ada' });
    expect(reg.statusCode).toBe(201);
    const body = safeJson(reg) as { account: Record<string, unknown>; csrfToken: string };
    expect(body.account).toEqual({ email, displayName: 'Ada' });
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = reg.cookies.find((x) => x.name === 'orbes_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.path).toBe('/');
    expect(cookie.secure).toBeFalsy(); // not production
    // Only the hash of the token is stored.
    const rows = await h.ctx.db.selectFrom('sessions').select('id_hash').execute();
    expect(rows.some((r) => Buffer.from(r.id_hash).equals(Buffer.from(hashSessionToken(cookie.value)!)))).toBe(true);
    expect(rows.some((r) => Buffer.from(r.id_hash).toString('utf8').includes(cookie.value))).toBe(false);

    const me = await c.get('/api/v1/account/me');
    expect(me.statusCode).toBe(200);
    expect(safeJson(me)).toEqual({ account: { email, displayName: 'Ada' }, csrfToken: body.csrfToken });

    const out = await c.post('/api/v1/account/logout');
    expect(out.statusCode).toBe(200);
    const cleared = out.cookies.find((x) => x.name === 'orbes_session');
    expect(cleared?.value).toBe('');
    expect((await c.get('/api/v1/account/me')).statusCode).toBe(401);

    const login = await c.post('/api/v1/account/login', { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    expect((safeJson(login) as any).account.email).toBe(email);
    expect((await c.get('/api/v1/account/me')).statusCode).toBe(200);
  });

  it('rotates the session id on login and kills the old token', async () => {
    const c = h.client();
    const email = uniqueEmail('rot');
    await c.post('/api/v1/account/register', { email, password: PASSWORD });
    const before = c.cookies.get('orbes_session')!;
    const login = await c.post('/api/v1/account/login', { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const after = c.cookies.get('orbes_session')!;
    expect(after).not.toBe(before);
    const stale = h.client();
    stale.cookies.set('orbes_session', before);
    const res = await stale.get('/api/v1/account/me');
    expect(res.statusCode).toBe(401);
    // The dead cookie is cleared for the browser.
    expect(res.cookies.find((x) => x.name === 'orbes_session')?.value).toBe('');
  });

  it('refuses a duplicate email (409), a weak password (400) and bad credentials (401)', async () => {
    const c = h.client();
    const email = uniqueEmail('dup');
    expect((await c.post('/api/v1/account/register', { email, password: PASSWORD })).statusCode).toBe(201);
    const dup = await h.client().post('/api/v1/account/register', { email: email.toUpperCase(), password: PASSWORD });
    expect(dup.statusCode).toBe(409);
    expect(errorOf(dup).code).toBe('EMAIL_TAKEN');
    const weak = await h.client().post('/api/v1/account/register', { email: uniqueEmail('weak'), password: 'short' });
    expect(weak.statusCode).toBe(400);
    const wrong = await h.client().post('/api/v1/account/login', { email, password: 'not the right password' });
    expect(wrong.statusCode).toBe(401);
    expect(errorOf(wrong).code).toBe('INVALID_CREDENTIALS');
    const unknown = await h.client().post('/api/v1/account/login', { email: uniqueEmail('nobody'), password: PASSWORD });
    expect(unknown.statusCode).toBe(401);
    expect(errorOf(unknown)).toEqual(errorOf(wrong)); // no account enumeration
  });

  it('validates bodies strictly', async () => {
    const extra = await h.client().post('/api/v1/account/register', { email: uniqueEmail('x'), password: PASSWORD, role: 'ADMIN' });
    expect(extra.statusCode).toBe(400);
    expect(errorOf(extra).message).toMatch(/unknown fields/);
    const typed = await h.client().post('/api/v1/account/login', { email: 42, password: PASSWORD });
    expect(typed.statusCode).toBe(400);
  });

  it('requires a session for /me and /products (401)', async () => {
    const c = h.client();
    for (const url of ['/api/v1/account/me', '/api/v1/account/products']) {
      const res = await c.get(url);
      expect(res.statusCode).toBe(401);
      expect(errorOf(res).code).toBe('UNAUTHORIZED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('logout without a session is a harmless no-op (same-origin still required)', async () => {
    expect((await h.client().post('/api/v1/account/logout')).statusCode).toBe(200);
    expect((await h.client({ origin: 'https://evil.example' }).post('/api/v1/account/logout')).statusCode).toBe(403);
  });

  it('lists the caller’s products (empty for a new account)', async () => {
    const c = h.client();
    await c.post('/api/v1/account/register', { email: uniqueEmail('list'), password: PASSWORD });
    const res = await c.get('/api/v1/account/products');
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toEqual({ products: [] });
  });
});
