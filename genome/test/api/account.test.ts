import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../src/server/services/sessions.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, issue, PASSWORD, safeJson, scanToReceive, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('account API', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  const uniqueEmail = (tag: string) => `${tag}-${Math.random().toString(36).slice(2, 10)}@example.com`;
  /** What CREATE ACCOUNT requires besides the email and the password (plan CUSTOMER INTELLIGENCE §3.1 P.4.2). */
  const SIGN_UP = { firstName: 'Ada', lastName: 'Lovelace', country: 'GB' };

  it('registers, reads /me, logs out and in again', async () => {
    const c = h.client();
    const email = uniqueEmail('reg');
    const reg = await c.post('/api/v1/account/register', { email, password: PASSWORD, ...SIGN_UP });
    expect(reg.statusCode).toBe(201);
    const body = safeJson(reg) as { account: Record<string, unknown>; csrfToken: string };
    expect(body.account).toEqual({ email, displayName: 'Ada Lovelace' });
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
    expect(safeJson(me)).toEqual({ account: { email, displayName: 'Ada Lovelace' }, csrfToken: body.csrfToken });

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
    await c.post('/api/v1/account/register', { email, password: PASSWORD, ...SIGN_UP });
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
    expect((await c.post('/api/v1/account/register', { email, password: PASSWORD, ...SIGN_UP })).statusCode).toBe(201);
    const dup = await h.client().post('/api/v1/account/register', { email: email.toUpperCase(), password: PASSWORD, ...SIGN_UP });
    expect(dup.statusCode).toBe(409);
    expect(errorOf(dup).code).toBe('EMAIL_TAKEN');
    const weak = await h.client().post('/api/v1/account/register', { email: uniqueEmail('weak'), password: 'short', ...SIGN_UP });
    expect(weak.statusCode).toBe(400);
    const wrong = await h.client().post('/api/v1/account/login', { email, password: 'not the right password' });
    expect(wrong.statusCode).toBe(401);
    expect(errorOf(wrong).code).toBe('INVALID_CREDENTIALS');
    const unknown = await h.client().post('/api/v1/account/login', { email: uniqueEmail('nobody'), password: PASSWORD });
    expect(unknown.statusCode).toBe(401);
    expect(errorOf(unknown)).toEqual(errorOf(wrong)); // no account enumeration
  });

  it('validates bodies strictly', async () => {
    const extra = await h.client().post('/api/v1/account/register', { email: uniqueEmail('x'), password: PASSWORD, ...SIGN_UP, role: 'ADMIN' });
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
    // Body-less routes accept an empty JSON body (clients that always send the header).
    const res = await h.client().request('POST', '/api/v1/account/logout', { body: '', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(200);
  });

  it('lists the caller’s products (empty for a new account)', async () => {
    const c = h.client();
    await c.post('/api/v1/account/register', { email: uniqueEmail('list'), password: PASSWORD, ...SIGN_UP });
    const res = await c.get('/api/v1/account/products');
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toEqual({ products: [] });
  });
});

describe('password change and assisted recovery (C-04)', () => {
  let h: Harness;
  let catalog: Catalog;
  const NEW_PASSWORD = 'a brand new passphrase';

  beforeAll(async () => {
    // A distinct budget per group, so x-ratelimit-limit names the group a route draws on.
    h = await createHarness({ config: { rateLimits: { verifyPerMinute: 9_001, authPerMinute: 9_002, adminPerMinute: 9_003, apiPerMinute: 9_004 } } });
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  const accountIdOf = async (email: string) =>
    (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;

  /** An ADMIN of ORBES Client Services, signed in now (the tests move the clock past admin sessions). */
  const clientServices = (): Promise<Client> => adminClient(h, 'ADMIN');

  /** The recovery code ORBES Client Services reads to the customer (ADMIN, console). */
  async function issueCode(email: string): Promise<string> {
    const cs = await clientServices();
    const res = await cs.post(`/api/admin/owners/${await accountIdOf(email)}/recovery-code`);
    expect(res.statusCode).toBe(201);
    return (safeJson(res) as { recoveryCode: string }).recoveryCode;
  }

  /** A piece registered to the customer behind `c`, through a scan and its registration token. */
  async function ownedPiece(c: Client): Promise<{ productId: string; data: string }> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return { productId: p.product.productId, data: p.code.data };
  }

  describe('POST /api/v1/account/password', () => {
    it('changes the password, keeps this session and ends the others', async () => {
      const { client, email } = await accountClient(h);
      const elsewhere = h.client({ ip: '203.0.113.99' });
      expect((await elsewhere.post('/api/v1/account/login', { email, password: PASSWORD })).statusCode).toBe(200);
      const res = await client.post('/api/v1/account/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(safeJson(res)).toEqual({ ok: true });
      // An auth-group route: password guessing draws on the login budget.
      expect(res.headers['x-ratelimit-limit']).toBe('9002');
      expect((await client.get('/api/v1/account/me')).statusCode).toBe(200);
      expect((await elsewhere.get('/api/v1/account/me')).statusCode).toBe(401);
      expect((await h.client().post('/api/v1/account/login', { email, password: PASSWORD })).statusCode).toBe(401);
      expect((await h.client().post('/api/v1/account/login', { email, password: NEW_PASSWORD })).statusCode).toBe(200);
    });

    it('answers a wrong current password with 400 CURRENT_PASSWORD_INVALID, never a 401, and keeps the session', async () => {
      const { client, email } = await accountClient(h);
      const res = await client.post('/api/v1/account/password', { currentPassword: 'not my password at all', newPassword: NEW_PASSWORD });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toEqual({ code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is not correct.' });
      // The session cookie is not cleared, and the session still works.
      expect(res.cookies.find((x) => x.name === 'orbes_session')).toBeUndefined();
      expect((await client.get('/api/v1/account/me')).statusCode).toBe(200);
      expect((await h.client().post('/api/v1/account/login', { email, password: PASSWORD })).statusCode).toBe(200);
      const weak = await client.post('/api/v1/account/password', { currentPassword: PASSWORD, newPassword: 'short' });
      expect(weak.statusCode).toBe(400);
      expect(errorOf(weak).code).toBe('VALIDATION_FAILED');
    });

    it('needs a session, the CSRF token and a strict body', async () => {
      expect((await h.client().post('/api/v1/account/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).statusCode).toBe(401);
      const { client } = await accountClient(h);
      const noCsrf = await client.post('/api/v1/account/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { noCsrf: true });
      expect(noCsrf.statusCode).toBe(403);
      expect(errorOf(noCsrf).code).toBe('CSRF_FAILED');
      const extra = await client.post('/api/v1/account/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, email: 'x@example.com' });
      expect(extra.statusCode).toBe(400);
      expect(errorOf(extra).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /api/v1/account/recover', () => {
    it('sets a new password with the code of ORBES Client Services: sessions end, transfers are cancelled and paused 72 h', async () => {
      const { client, email } = await accountClient(h);
      const { productId, data } = await ownedPiece(client);
      const offer = await client.post('/api/v1/ownership/transfers', { productId });
      expect(offer.statusCode).toBe(201);
      // Someone has scanned the piece and holds the code (F-03) when the owner's password is recovered.
      const taker = (await accountClient(h)).client;
      const scanned = await scanToReceive(taker, data, (safeJson(offer) as { transferCode: string }).transferCode);
      const code = await issueCode(email);

      const anon = h.client({ ip: '203.0.113.50' });
      const res = await anon.post('/api/v1/account/recover', { email: email.toUpperCase(), recoveryCode: code.toLowerCase(), newPassword: NEW_PASSWORD });
      expect(res.statusCode).toBe(200);
      const body = safeJson(res) as { ok: boolean; transfersPausedUntil: string };
      expect(body.ok).toBe(true);
      expect(new Date(body.transfersPausedUntil).getTime()).toBe(h.clock.now().getTime() + 72 * 3_600_000);
      expect(res.headers['x-ratelimit-limit']).toBe('9002');
      // No session is opened; the old one has ended.
      expect(res.cookies.find((x) => x.name === 'orbes_session')).toBeUndefined();
      expect((await client.get('/api/v1/account/me')).statusCode).toBe(401);

      // Sign in with the new password: the transfer offered before is cancelled, new ones are paused.
      const again = h.client();
      expect((await again.post('/api/v1/account/login', { email, password: NEW_PASSWORD })).statusCode).toBe(200);
      const mine = safeJson(await again.get('/api/v1/account/products')) as { products: { productId: string; transfer: { pending: boolean } }[] };
      expect(mine.products).toEqual([expect.objectContaining({ productId, transfer: { pending: false } })]);
      const paused = await again.post('/api/v1/ownership/transfers', { productId });
      expect(paused.statusCode).toBe(409);
      expect(errorOf(paused).code).toBe('TRANSFERS_PAUSED');
      expect(errorOf(paused).message).toMatch(/ORBES Client Services can assist you\.$/);
      const accept = await h.client().post('/api/v1/ownership/transfers/accept', scanned);
      expect(accept.statusCode).toBe(401); // a session is needed first…
      const taken = await taker.post('/api/v1/ownership/transfers/accept', scanned);
      expect(taken.statusCode).toBe(410); // …and the cancelled code no longer completes
      expect(errorOf(taken).code).toBe('TRANSFER_CANCELLED');

      // 72 hours later, transfers go again.
      h.clock.advance(72 * 3_600_000);
      expect((await again.post('/api/v1/ownership/transfers', { productId })).statusCode).toBe(201);
    });

    it('gives one answer for an unknown email and a wrong, expired or used code', async () => {
      const { email } = await accountClient(h);
      const code = await issueCode(email);
      const answers = [];
      for (const b of [
        { email: `nobody-${Math.random().toString(36).slice(2)}@example.com`, recoveryCode: code, newPassword: NEW_PASSWORD },
        { email, recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword: NEW_PASSWORD },
        { email, recoveryCode: 'not-a-code', newPassword: NEW_PASSWORD },
      ]) {
        const res = await h.client().post('/api/v1/account/recover', b);
        expect(res.statusCode).toBe(400);
        answers.push(safeJson(res));
      }
      expect((await h.client().post('/api/v1/account/recover', { email, recoveryCode: code, newPassword: NEW_PASSWORD })).statusCode).toBe(200);
      const used = await h.client().post('/api/v1/account/recover', { email, recoveryCode: code, newPassword: 'another passphrase here' });
      answers.push(safeJson(used));
      const expiring = await issueCode(email);
      h.clock.advance(30 * 60_000);
      answers.push(safeJson(await h.client().post('/api/v1/account/recover', { email, recoveryCode: expiring, newPassword: 'another passphrase here' })));
      for (const a of answers) expect(a).toEqual(answers[0]);
      expect(answers[0]).toEqual({ error: { code: 'RECOVERY_CODE_INVALID', message: expect.stringMatching(/ORBES Client Services/) } });
    });

    it('allows 5 wrong guesses at a code per hour, then refuses even the right code; a new code starts afresh', async () => {
      const { email } = await accountClient(h);
      // Attempts while no code is open guess nothing: they do not spend the budget of the code issued next.
      for (let i = 0; i < 6; i++) {
        expect((await h.client({ ip: `198.51.100.${30 + i}` }).post('/api/v1/account/recover', { email, recoveryCode: `YYYY-YYYY-YYY${i}`, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
      }
      const code = await issueCode(email);
      for (let i = 0; i < 5; i++) {
        expect((await h.client({ ip: `198.51.100.${10 + i}` }).post('/api/v1/account/recover', { email, recoveryCode: `ZZZZ-ZZZZ-ZZZ${i}`, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
      }
      const held = await h.client({ ip: '198.51.100.99' }).post('/api/v1/account/recover', { email, recoveryCode: code, newPassword: NEW_PASSWORD });
      expect(held.statusCode).toBe(400);
      expect(errorOf(held).code).toBe('RECOVERY_CODE_INVALID');
      expect((await h.client().post('/api/v1/account/login', { email, password: NEW_PASSWORD })).statusCode).toBe(401);
      // Client Services sees the throttle on the owner, and issues a new code, which works at once.
      const owners = safeJson(await (await adminClient(h, 'ADMIN')).get(`/api/admin/owners?email=${encodeURIComponent(email)}`)) as { items: { recoveryCodeThrottledUntil: string | null }[] };
      expect(owners.items[0].recoveryCodeThrottledUntil).toEqual(expect.any(String));
      const fresh = await issueCode(email);
      expect((await h.client().post('/api/v1/account/recover', { email, recoveryCode: fresh, newPassword: NEW_PASSWORD })).statusCode).toBe(200);
      expect((await h.client().post('/api/v1/account/login', { email, password: NEW_PASSWORD })).statusCode).toBe(200);
    });

    it('refuses a LOCKED account with 403 ACCOUNT_LOCKED', async () => {
      const { email } = await accountClient(h);
      const code = await issueCode(email);
      await h.ctx.db.updateTable('accounts').set({ status: 'LOCKED' }).where('email_normalized', '=', email.toLowerCase()).execute();
      const res = await h.client().post('/api/v1/account/recover', { email, recoveryCode: code, newPassword: NEW_PASSWORD });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('ACCOUNT_LOCKED');
    });

    it('is session-less but same-origin only, with a strict body', async () => {
      const cross = await h.client({ origin: 'https://evil.example' }).post('/api/v1/account/recover', { email: 'a@example.com', recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword: NEW_PASSWORD });
      expect(cross.statusCode).toBe(403);
      expect(errorOf(cross).code).toBe('CSRF_FAILED');
      const extra = await h.client().post('/api/v1/account/recover', { email: 'a@example.com', recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword: NEW_PASSWORD, code: 'x' });
      expect(extra.statusCode).toBe(400);
      expect(errorOf(extra).code).toBe('VALIDATION_FAILED');
      const weak = await h.client().post('/api/v1/account/recover', { email: 'a@example.com', recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword: 'short' });
      expect(weak.statusCode).toBe(400);
      expect(errorOf(weak).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /api/admin/owners/:id/recovery-code', () => {
    it('is ADMIN only, shows the code once and lists its expiry on the owner, never the code', async () => {
      const cs = await clientServices();
      const { email } = await accountClient(h);
      const id = await accountIdOf(email);
      for (const role of ['AUDITOR', 'OPERATOR'] as const) {
        const res = await (await adminClient(h, role)).post(`/api/admin/owners/${id}/recovery-code`);
        expect(res.statusCode, role).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
      const res = await cs.post(`/api/admin/owners/${id}/recovery-code`);
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const issued = safeJson(res) as { recoveryCode: string; expiresAt: string };
      expect(issued.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(new Date(issued.expiresAt).getTime()).toBe(h.clock.now().getTime() + 30 * 60_000);

      const list = safeJson(await (await adminClient(h, 'AUDITOR')).get('/api/admin/owners?pageSize=200')) as { items: Record<string, unknown>[] };
      const owner = list.items.find((o) => o.id === id)!;
      // An AUDITOR reads the email masked (A-06).
      expect(owner).toMatchObject({ email: `o***@example.com`, status: 'ACTIVE', recoveryCodeExpiresAt: issued.expiresAt, recoveryCodeThrottledUntil: null, transfersPausedUntil: null });
      expect(JSON.stringify(list)).not.toContain(issued.recoveryCode);

      // Used: no open code any more, and transfers are paused.
      expect((await h.client().post('/api/v1/account/recover', { email, recoveryCode: issued.recoveryCode, newPassword: NEW_PASSWORD })).statusCode).toBe(200);
      const after = (safeJson(await cs.get('/api/admin/owners?pageSize=200')) as { items: Record<string, unknown>[] }).items.find((o) => o.id === id)!;
      expect(after.recoveryCodeExpiresAt).toBeNull();
      expect(after.transfersPausedUntil).toBe(new Date(h.clock.now().getTime() + 72 * 3_600_000).toISOString());

      // The audit log names the account and the code's id, never the code or the email.
      const audit = await h.ctx.audit.list({ action: 'account.recovery_code.issue', targetId: id });
      expect(audit.items).toHaveLength(1);
      expect(JSON.stringify(audit.items)).not.toContain(issued.recoveryCode);
      expect(JSON.stringify(audit.items)).not.toContain(email);
    });

    it('answers 404 for an unknown account, 409 for one that is not active, 400 for a body', async () => {
      const cs = await clientServices();
      const unknown = await cs.post('/api/admin/owners/5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6/recovery-code');
      expect(unknown.statusCode).toBe(404);
      expect(errorOf(unknown).code).toBe('ACCOUNT_NOT_FOUND');
      expect((await cs.post('/api/admin/owners/not-a-uuid/recovery-code')).statusCode).toBe(400);
      const { email } = await accountClient(h);
      expect((await cs.post(`/api/admin/owners/${await accountIdOf(email)}/recovery-code`, { force: true })).statusCode).toBe(400);
      await h.ctx.db.updateTable('accounts').set({ status: 'LOCKED' }).where('email_normalized', '=', email.toLowerCase()).execute();
      const locked = await cs.post(`/api/admin/owners/${await accountIdOf(email)}/recovery-code`);
      expect(locked.statusCode).toBe(409);
      expect(errorOf(locked).code).toBe('ACCOUNT_NOT_ACTIVE');
    });
  });

  it('lists in the club’s status only the house’s guarantees shown to the client (plan NEXT-NINE, IN-01): nothing of one not shown', async () => {
    const catalog = await seedCatalog(h.ctx);
    const operator = await adminClient(h, 'OPERATOR');
    const { client, email } = await accountClient(h);
    const id = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
    const grant = async (visible: boolean, validUntil: string) => {
      const res = await operator.post(`/api/admin/owners/${id}/guarantees`, { scope: 'MODEL', targetId: catalog.modelId, pieces: 1, validUntil, visible, note: 'Internal.' });
      expect(res.statusCode, res.body).toBe(201);
      return (safeJson(res) as { guarantee: { id: string } }).guarantee.id;
    };
    const status = async () => safeJson(await client.get('/api/v1/club/status')) as { guarantees: Record<string, unknown>[] };
    expect((await status()).guarantees).toEqual([]);
    const hiddenId = await grant(false, '2027-06-30');
    expect((await status()).guarantees).toEqual([]);
    const later = await grant(true, '2027-09-30');
    const sooner = await grant(true, '2027-03-31');
    const shown = (await status()).guarantees;
    expect(shown.map((g) => g.id)).toEqual([sooner, later]);
    expect(shown[0]).toEqual({ id: sooner, scope: 'MODEL', target: 'MONOLITHE', pieces: 1, validUntil: '2027-03-31T21:59:59.999Z', release: null });
    expect(JSON.stringify(shown)).not.toContain(hiddenId);
    expect(JSON.stringify(shown)).not.toContain('Internal.');
  });
});

describe('CREATE ACCOUNT with its profile (plan CUSTOMER INTELLIGENCE §3.1 P.4.2, step 1.5)', () => {
  const COUNTRY_HEADER = 'x-orbes-geo-country';
  let h: Harness;
  beforeAll(async () => {
    // The edge reports the client's country in a header (GEO_MODE=headers behind TRUST_PROXY), as in production.
    h = await createHarness({ config: { trustProxy: true, geo: { mode: 'headers', countryHeader: COUNTRY_HEADER } } });
  });
  afterAll(() => h?.close());

  const uniqueEmail = (tag: string) => `${tag}-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const accountOf = (email: string) => h.ctx.db.selectFrom('accounts').selectAll().where('email_normalized', '=', email).executeTakeFirst();
  const profileOf = (accountId: string) => h.ctx.db.selectFrom('account_profiles').selectAll().where('account_id', '=', accountId).executeTakeFirst();
  const heardByLabel = async () => new Map((await h.ctx.db.selectFrom('heard_options').select(['id', 'label']).execute()).map((r) => [r.label, r.id]));

  it('requires the first name, the last name and the country, each refused in the collector’s words; nothing is created', async () => {
    const email = uniqueEmail('required');
    const full = { email, password: PASSWORD, firstName: 'Ada', lastName: 'Lovelace', country: 'GB' };
    const cases: [Record<string, unknown>, string][] = [
      [{ ...full, firstName: undefined }, 'Enter your first name.'],
      [{ ...full, firstName: '   ' }, 'Enter your first name.'],
      [{ ...full, firstName: null }, 'Enter your first name.'],
      [{ ...full, lastName: undefined }, 'Enter your last name.'],
      [{ ...full, lastName: '' }, 'Enter your last name.'],
      [{ ...full, country: undefined }, 'Choose your country.'],
      [{ ...full, country: '' }, 'Choose your country.'],
      [{ ...full, country: 'ZZ' }, 'Choose your country.'],
      // The first name first, as the form checks it.
      [{ email, password: PASSWORD }, 'Enter your first name.'],
      [{ ...full, firstName: 'A'.repeat(51) }, 'Your first name is 50 characters at most.'],
      [{ ...full, lastName: 'L'.repeat(51) }, 'Your last name is 50 characters at most.'],
      [{ ...full, firstName: 'Ada <b>' }, 'Your first name contains characters that cannot be kept.'],
    ];
    for (const [body, message] of cases) {
      const res = await h.client().post('/api/v1/account/register', JSON.parse(JSON.stringify(body)));
      expect(res.statusCode, message).toBe(400);
      expect(errorOf(res), JSON.stringify(body)).toEqual({ code: 'VALIDATION_FAILED', message });
    }
    expect(await accountOf(email)).toBeUndefined();
  });

  it('refuses the body of an app page loaded before the deploy (displayName only) on the first name', async () => {
    const email = uniqueEmail('old');
    const res = await h.client().post('/api/v1/account/register', { email, password: PASSWORD, displayName: 'Ada' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toEqual({ code: 'VALIDATION_FAILED', message: 'Enter your first name.' });
    expect(await accountOf(email)).toBeUndefined();
  });

  it('writes the profile with the account, « First Last » as its name and the country on the account; displayName is then ignored', async () => {
    const email = uniqueEmail('profile');
    const res = await h.client().post('/api/v1/account/register', { email, password: PASSWORD, firstName: '  Zoë ', lastName: 'Le Gall', country: 'fr', displayName: 'Ignored' });
    expect(res.statusCode).toBe(201);
    expect((safeJson(res) as { account: unknown }).account).toEqual({ email, displayName: 'Zoë Le Gall' });
    const account = (await accountOf(email))!;
    expect(account).toMatchObject({ display_name: 'Zoë Le Gall', country: 'FR', status: 'ACTIVE' });
    const profile = await profileOf(account.id);
    expect(profile).toMatchObject({
      first_name: 'Zoë',
      last_name: 'Le Gall',
      phone: null,
      birth_date: null,
      city: null,
      instagram: null,
      heard_option_id: null,
      heard_other: null,
      heard_at: null,
      version: 1,
      updated_by: 'COLLECTOR',
    });
  });

  it('keeps an offered answer to « How did you hear about ORBES? », Other’s words only with Other, and drops an unknown or set-aside one', async () => {
    const heard = await heardByLabel();
    const other = heard.get('Other')!;
    const instagram = heard.get('Instagram')!;
    const tiktok = heard.get('TikTok')!;
    await h.ctx.db.updateTable('heard_options').set({ active: false }).where('id', '=', tiktok).execute();
    const signUp = async (tag: string, answer: unknown) => {
      const email = uniqueEmail(tag);
      const res = await h.client().post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Ada', lastName: 'Lovelace', country: 'GB', heard: answer });
      expect(res.statusCode, `${tag} ${res.body}`).toBe(201);
      const account = (await accountOf(email))!;
      return { account, profile: (await profileOf(account.id))! };
    };
    const withOther = await signUp('other', { optionId: other.toUpperCase(), other: '  A pop-up in Lyon ' });
    expect(withOther.profile).toMatchObject({ heard_option_id: other, heard_other: 'A pop-up in Lyon', heard_at: expect.any(Date) });
    const plain = await signUp('instagram', { optionId: instagram, other: 'dropped' });
    expect(plain.profile).toMatchObject({ heard_option_id: instagram, heard_other: null, heard_at: expect.any(Date) });
    for (const [tag, answer] of [
      ['aside', { optionId: tiktok }],
      ['unknown', { optionId: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' }],
      ['malformed', { optionId: 'not-an-id', other: 'words' }],
      ['none', null],
    ] as const) {
      const r = await signUp(tag, answer);
      expect(r.profile, tag).toMatchObject({ first_name: 'Ada', heard_option_id: null, heard_other: null, heard_at: null });
    }
    // Other's words that cannot be kept are dropped, never a refusal.
    const words = await signUp('words', { optionId: other, other: 'x'.repeat(101) });
    expect(words.profile).toMatchObject({ heard_option_id: other, heard_other: null });
    await h.ctx.db.updateTable('heard_options').set({ active: true }).where('id', '=', tiktok).execute();
  });

  it('audits account.register with { profile, heardOptionId }, never the names nor the country', async () => {
    const heard = await heardByLabel();
    const email = uniqueEmail('audit');
    const res = await h.client().post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Grace', lastName: 'Hopperton', country: 'US', heard: { optionId: heard.get('The press') } });
    expect(res.statusCode).toBe(201);
    const account = (await accountOf(email))!;
    const entries = (await h.ctx.audit.list({ action: 'account.register', targetId: account.id })).items;
    expect(entries).toEqual([expect.objectContaining({ actorType: 'account', details: { profile: true, heardOptionId: heard.get('The press') } })]);
    expect(JSON.stringify(entries)).not.toMatch(/Grace|Hopperton|"US"/);
  });

  it('creates the profile in the account’s transaction: a failing profile insert leaves no account and no session', async () => {
    const { sql } = await import('kysely');
    await sql`CREATE FUNCTION test_refuse_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.first_name = 'Rollback' THEN RAISE EXCEPTION 'refused by the test'; END IF; RETURN NEW; END $$`.execute(h.ctx.db);
    await sql`CREATE TRIGGER test_refuse_profile BEFORE INSERT ON account_profiles FOR EACH ROW EXECUTE FUNCTION test_refuse_profile()`.execute(h.ctx.db);
    try {
      const email = uniqueEmail('rollback');
      const c = h.client();
      const res = await c.post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Rollback', lastName: 'Test', country: 'FR' });
      expect(res.statusCode).toBe(500);
      expect(await accountOf(email)).toBeUndefined();
      expect(res.cookies.find((x) => x.name === 'orbes_session')?.value ?? '').toBe('');
    } finally {
      await sql`DROP TRIGGER test_refuse_profile ON account_profiles`.execute(h.ctx.db);
      await sql`DROP FUNCTION test_refuse_profile()`.execute(h.ctx.db);
    }
  });

  it('GET /api/v1/account/sign-up: the connection’s country when it is one, and the answers offered in their order, Other last; no session, no-store, nothing recorded', async () => {
    const before = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const c = h.client();
    const fr = await c.get('/api/v1/account/sign-up', { headers: { [COUNTRY_HEADER]: 'FR' } });
    expect(fr.statusCode).toBe(200);
    expect(fr.headers['cache-control']).toBe('no-store');
    expect(fr.cookies).toEqual([]);
    const body = safeJson(fr) as { country: string | null; heard: { id: string; label: string; other: boolean }[] };
    expect(body.country).toBe('FR');
    expect(body.heard.map((x) => x.label)).toEqual(['Instagram', 'TikTok', 'A friend', 'The press', 'A shop', 'A web search', 'An influencer', 'Other']);
    expect(body.heard.map((x) => x.other)).toEqual([false, false, false, false, false, false, false, true]);
    expect(Object.keys(body).sort()).toEqual(['country', 'heard']);
    for (const header of [undefined, 'ZZ', 'EU', 'XX', 'T1']) {
      const res = await c.get('/api/v1/account/sign-up', header ? { headers: { [COUNTRY_HEADER]: header } } : {});
      expect((safeJson(res) as { country: unknown }).country, String(header)).toBeNull();
    }
    // A set-aside answer is no longer offered; a reordered list reads in its new order, Other still last.
    const heard = await heardByLabel();
    await h.ctx.db.updateTable('heard_options').set({ active: false }).where('id', '=', heard.get('A shop')!).execute();
    await h.ctx.db.updateTable('heard_options').set({ position: 20 }).where('id', '=', heard.get('Instagram')!).execute();
    const after = safeJson(await c.get('/api/v1/account/sign-up')) as typeof body;
    expect(after.heard.map((x) => x.label)).toEqual(['TikTok', 'A friend', 'The press', 'A web search', 'An influencer', 'Instagram', 'Other']);
    await h.ctx.db.updateTable('heard_options').set({ active: true }).where('id', '=', heard.get('A shop')!).execute();
    await h.ctx.db.updateTable('heard_options').set({ position: 1 }).where('id', '=', heard.get('Instagram')!).execute();
    const now = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(now.n)).toBe(Number(before.n));
  });
});
