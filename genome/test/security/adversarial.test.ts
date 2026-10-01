/**
 * Adversarial security review (spec §23/§24): the attacker reads the
 * frontend, the network traffic, the printed code and the public API. Each
 * test pins one attack and the property that defeats it; the ones added for
 * review findings name the finding (SEC-n) they cover.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import {
  accountClient,
  adminClient,
  createAdmin,
  createHarness,
  errorOf,
  issue,
  safeJson,
  seedCatalog,
  type Catalog,
  type Client,
  type Harness,
} from '../api/support.js';

const PROD = {
  ORBES_ENV: 'production',
  PUBLIC_ORIGIN: 'https://verify.orbes.test',
  DATABASE_URL: 'postgres://orbes:pw@db:5432/orbes',
  COOKIE_SECRET: 'Zq8vN3kL0pW2xR7tY5uI9oA1sD4fG6hJ',
  IP_HASH_PEPPER: 'Mn4bV7cX1zQ9wE3rT6yU8iO2pA5sD0fG',
  KEY_PROVIDER: 'local',
  KEY_DIR: '/var/lib/orbes/keys',
  KEY_ENCRYPTION_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
};

function configIssues(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    return (e as { issues?: string[] }).issues ?? [String(e)];
  }
}

// ── SEC-1 / SEC-2: client IP trust (rate limits, IP pseudonyms, geo) ─────────

describe('SEC-1 TRUST_PROXY: never "trust every X-Forwarded-For hop" by accident', () => {
  it('a bare number is refused (it used to mean "trust everything")', () => {
    expect(configIssues({ TRUST_PROXY: '1' })).toEqual([
      'TRUST_PROXY: hop counts are not supported; list the proxy addresses or ranges (e.g. loopback, uniquelocal, 10.0.0.0/8)',
    ]);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: 'loopback, 10.0.0.0/8' }).trustProxy).toBe('loopback, 10.0.0.0/8');
  });

  it('production refuses TRUST_PROXY=true: X-Forwarded-For would be fully client-controlled', () => {
    expect(configIssues({ ...PROD, TRUST_PROXY: 'true' })).toEqual([
      'TRUST_PROXY: "true" trusts every X-Forwarded-For hop (client-forgeable); list the proxy addresses or ranges instead',
    ]);
    expect(configIssues({ ...PROD, TRUST_PROXY: 'uniquelocal' })).toEqual([]);
  });

  it('with trust-all, a client rotating X-Forwarded-For escapes the per-IP limit (why production refuses it)', async () => {
    const h = await createHarness({ config: { trustProxy: true, rateLimits: { authPerMinute: 2 } } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await h.client().post('/api/v1/account/login', { email: 'nobody@example.com', password: 'x'.repeat(12) }, {
          headers: { 'x-forwarded-for': `198.51.100.${i + 1}` },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).not.toContain(429);
    } finally {
      await h.close();
    }
  });

  it('trusting only the proxy address, the forged left-most entry is ignored and the limit holds', async () => {
    // The harness client connects from 203.0.113.10: that is "the proxy".
    const h = await createHarness({ config: { trustProxy: '203.0.113.10', rateLimits: { authPerMinute: 2 } } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        // The proxy appends the real client (192.0.2.7); the client forged the first entry.
        const res = await h.client().post('/api/v1/account/login', { email: 'nobody@example.com', password: 'x'.repeat(12) }, {
          headers: { 'x-forwarded-for': `198.51.100.${i + 1}, 192.0.2.7` },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([401, 401, 429, 429]);
    } finally {
      await h.close();
    }
  });
});

describe('SEC-2 GEO_MODE=cloudflare in production needs TRUST_PROXY', () => {
  it('refuses cf-* geo headers when the client address is not taken from the edge', () => {
    expect(configIssues({ ...PROD, GEO_MODE: 'cloudflare' })).toContain('GEO_MODE: cloudflare mode requires TRUST_PROXY in production');
    expect(configIssues({ ...PROD, GEO_MODE: 'cloudflare', TRUST_PROXY: '10.0.0.0/8' })).toEqual([]);
  });
});

// ── Sessions, CSRF, authorisation ─────────────────────────────────────────

describe('sessions, CSRF and authorisation under attack', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  async function sellable(withClaimSecret: boolean) {
    const p = await issue(h.ctx, catalog, { withClaimSecret });
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES BOUTIQUE', country: 'FR' }, SYSTEM_ACTOR);
    return p;
  }

  async function tokenFor(c: Client, data: string): Promise<string> {
    const body = safeJson(await c.post('/api/v1/verify', { code: data })) as any;
    expect(body.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    return body.registration.token as string;
  }

  it('session fixation: a cookie planted before login is never the authenticated session', async () => {
    const attacker = await accountClient(h);
    const planted = attacker.client.cookies.get('orbes_session')!;
    const victim = await accountClient(h);
    const victimEmail = victim.email;
    // The victim's browser carries the attacker's cookie, then the victim logs in.
    const browser = h.client();
    browser.cookies.set('orbes_session', planted);
    const login = await browser.post('/api/v1/account/login', { email: victimEmail, password: 'correct horse battery staple' });
    expect(login.statusCode).toBe(200);
    expect(browser.cookies.get('orbes_session')).not.toBe(planted);
    // The planted token was retired by the rotation: it does not open the victim's account (nor the attacker's).
    const replay = h.client();
    replay.cookies.set('orbes_session', planted);
    expect((await replay.get('/api/v1/account/me')).statusCode).toBe(401);
  });

  it("CSRF: another session's token, or a token with a cross-site Origin, is refused", async () => {
    const a = await accountClient(h);
    const b = await accountClient(h);
    const stolen = a.client.csrf!;
    const res = await b.client.post('/api/v1/ownership/transfers/cancel', { productId: 'O26-J-00001' }, { headers: { 'x-csrf-token': stolen } });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('CSRF_FAILED');
    const evil = await b.client.post('/api/v1/ownership/transfers/cancel', { productId: 'O26-J-00001' }, { origin: 'https://evil.example' });
    expect(errorOf(evil).code).toBe('CSRF_FAILED');
    const nullOrigin = await b.client.post('/api/v1/ownership/transfers/cancel', { productId: 'O26-J-00001' }, { origin: 'null' });
    expect(errorOf(nullOrigin).code).toBe('CSRF_FAILED');
  });

  it('logout kills the server-side session: a copied cookie is dead afterwards', async () => {
    const a = await accountClient(h);
    const copy = a.client.cookies.get('orbes_session')!;
    expect((await a.client.post('/api/v1/account/logout')).statusCode).toBe(200);
    const replay = h.client();
    replay.cookies.set('orbes_session', copy);
    expect((await replay.get('/api/v1/account/me')).statusCode).toBe(401);
  });

  it('a locked account loses its live sessions and is anonymous to /verify', async () => {
    const p = await sellable(false);
    const a = await accountClient(h);
    const token = await tokenFor(a.client, p.code.data);
    expect((await a.client.post('/api/v1/ownership/register', { registrationToken: token })).statusCode).toBe(201);
    const mine = safeJson(await a.client.post('/api/v1/verify', { code: p.code.data })) as any;
    expect(mine.state).toBe('AUTHENTIC_OWNERSHIP_VERIFIED');

    await h.ctx.db.updateTable('accounts').set({ status: 'LOCKED' }).where('email_normalized', '=', a.email.toLowerCase()).execute();
    expect((await a.client.get('/api/v1/account/me')).statusCode).toBe(401);
    const after = safeJson(await a.client.post('/api/v1/verify', { code: p.code.data })) as any;
    expect(after.state).toBe('AUTHENTIC_REGISTERED');
    expect(after.ownership.you).toBe(false);
  });

  it('a disabled admin is locked out at once, even with a live session', async () => {
    const creds = await createAdmin(h.ctx, 'ADMIN');
    const c = h.client();
    expect((await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    expect((await c.get('/api/admin/dashboard')).statusCode).toBe(200);
    await h.ctx.db.updateTable('admin_users').set({ disabled_at: h.ctx.clock() }).where('id', '=', creds.id).execute();
    expect((await c.get('/api/admin/dashboard')).statusCode).toBe(401);
    expect((await c.post('/api/admin/keys/rotate')).statusCode).toBe(401);
  });

  it('IDOR: a customer cannot act on, or read the service history of, a product they do not own', async () => {
    const p = await sellable(false);
    const owner = await accountClient(h);
    const token = await tokenFor(owner.client, p.code.data);
    expect((await owner.client.post('/api/v1/ownership/register', { registrationToken: token })).statusCode).toBe(201);
    await h.ctx.services.warranty.openService(p.product.productId, { type: 'CLEANING', location: 'PARIS', notes: 'staff note' }, SYSTEM_ACTOR);

    const other = (await accountClient(h)).client;
    const pid = p.product.productId;
    for (const [url, body] of [
      ['/api/v1/ownership/transfers', { productId: pid }],
      ['/api/v1/ownership/transfers/cancel', { productId: pid }],
      ['/api/v1/ownership/incidents', { productId: pid, type: 'STOLEN' }],
    ] as const) {
      const res = await other.post(url, body);
      expect([403, 404]).toContain(res.statusCode);
    }
    const history = await other.get(`/api/v1/products/${pid}/service-history`);
    expect(history.statusCode).toBe(403);
    expect(history.body).not.toMatch(/CLEANING|PARIS|staff/);
    // The product's status was not changed by any of it.
    const row = await h.ctx.db.selectFrom('products').select('status').where('product_id', '=', pid).executeTakeFirstOrThrow();
    expect(row.status).toBe('SERVICED');
    // The owner sees the history without staff notes.
    const own = await owner.client.get(`/api/v1/products/${pid}/service-history`);
    expect(own.statusCode).toBe(200);
    expect(own.body).not.toMatch(/staff note/);
  });

  it('SEC-4 customer routes do not reveal which product ids exist (issued volumes stay private)', async () => {
    const p = await sellable(false);
    const owner = (await accountClient(h)).client;
    const token = await tokenFor(owner, p.code.data);
    expect((await owner.post('/api/v1/ownership/register', { registrationToken: token })).statusCode).toBe(201);
    const stranger = (await accountClient(h)).client;
    const existing = p.product.productId;
    const missing = 'O26-J-99998';
    const probe = async (pid: string) => {
      const out: string[] = [];
      for (const [url, body] of [
        ['/api/v1/ownership/transfers', { productId: pid }],
        ['/api/v1/ownership/transfers/cancel', { productId: pid }],
        ['/api/v1/ownership/incidents', { productId: pid, type: 'LOST' }],
      ] as const) {
        const res = await stranger.post(url, body);
        out.push(`${res.statusCode} ${res.body}`);
      }
      const hist = await stranger.get(`/api/v1/products/${pid}/service-history`);
      out.push(`${hist.statusCode} ${hist.body}`);
      return out;
    };
    expect(await probe(missing)).toEqual(await probe(existing));
  });

  it('claim codes: the per-product limit holds across accounts and tokens, then even the right code waits', async () => {
    const p = await sellable(true);
    for (let i = 0; i < 5; i++) {
      const c = (await accountClient(h)).client;
      const token = await tokenFor(c, p.code.data);
      const res = await c.post('/api/v1/ownership/register', { registrationToken: token, claimCode: `AAAA-AAAA-AAA${i}` });
      expect(res.statusCode).toBe(403);
    }
    const legit = (await accountClient(h)).client;
    const token = await tokenFor(legit, p.code.data);
    const blocked = await legit.post('/api/v1/ownership/register', { registrationToken: token, claimCode: p.claimCode });
    expect(blocked.statusCode).toBe(429);
    h.clock.advance(61 * 60_000);
    const fresh = await tokenFor(legit, p.code.data);
    expect((await legit.post('/api/v1/ownership/register', { registrationToken: fresh, claimCode: p.claimCode })).statusCode).toBe(201);
  });

  it('transfer codes are single-use and die with an incident report', async () => {
    const p = await sellable(false);
    const owner = (await accountClient(h)).client;
    const token = await tokenFor(owner, p.code.data);
    expect((await owner.post('/api/v1/ownership/register', { registrationToken: token })).statusCode).toBe(201);
    const { transferCode } = safeJson(await owner.post('/api/v1/ownership/transfers', { productId: p.product.productId })) as any;

    const thief = (await accountClient(h)).client;
    expect((await owner.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'STOLEN' })).statusCode).toBe(201);
    const late = await thief.post('/api/v1/ownership/transfers/accept', { transferCode });
    expect(late.statusCode).toBe(410);
    expect(errorOf(late).code).toBe('TRANSFER_CANCELLED');
  });

  it('a registration token is bound to its product and single-use', async () => {
    const p1 = await sellable(false);
    const p2 = await sellable(false);
    const a = (await accountClient(h)).client;
    const b = (await accountClient(h)).client;
    const t1 = await tokenFor(a, p1.code.data);
    await tokenFor(a, p2.code.data);
    expect((await a.post('/api/v1/ownership/register', { registrationToken: t1 })).statusCode).toBe(201);
    const replay = await b.post('/api/v1/ownership/register', { registrationToken: t1 });
    expect(replay.statusCode).toBe(409);
    expect(errorOf(replay).code).toBe('REGISTRATION_TOKEN_USED');
  });

  it('AUDITOR cannot mutate anything, including through PATCH and artifact downloads', async () => {
    const auditor = await adminClient(h, 'AUDITOR');
    const p = await issue(h.ctx, catalog);
    const finding = await h.ctx.db
      .insertInto('anomalies')
      .values({ product_id: p.product.id, code_id: p.code.id, type: 'SCAN_VELOCITY', severity: 'MEDIUM', risk_score: 35, details: '{}', status: 'OPEN' })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await auditor.patch(`/api/admin/anomalies/${finding.id}`, { status: 'DISMISSED' })).statusCode).toBe(403);
    expect((await auditor.get(`/api/admin/codes/${p.code.id}/artifact.svg`)).statusCode).toBe(403);
    expect((await auditor.post('/api/admin/codes/print-sheet', { codeIds: [p.code.id] })).statusCode).toBe(403);
    expect((await auditor.post('/api/admin/auth/totp/setup')).statusCode).toBe(200); // own enrolment only
    const row = await h.ctx.db.selectFrom('anomalies').select('status').where('id', '=', finding.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('OPEN');
  });

  it('SEC-5 OPERATOR cannot retire a product: RETIRED is terminal and verifies as REVOKED forever', async () => {
    const operator = await adminClient(h, 'OPERATOR');
    const admin = await adminClient(h, 'ADMIN');
    const p = await issue(h.ctx, catalog);
    const res = await operator.post(`/api/admin/products/${p.product.productId}/transitions`, { to: 'RETIRED', reason: 'x' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    const row = await h.ctx.db.selectFrom('products').select('status').where('id', '=', p.product.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('ISSUED');
    // Reversible triage stays with OPERATOR.
    expect((await operator.post(`/api/admin/products/${p.product.productId}/transitions`, { to: 'COUNTERFEIT_FLAGGED', reason: 'x' })).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/products/${p.product.productId}/transitions`, { to: 'RETIRED', reason: 'x' })).statusCode).toBe(200);
  });

  it('the auditor-readable product detail never carries a printable code', async () => {
    const auditor = await adminClient(h, 'AUDITOR');
    const p = await issue(h.ctx, catalog, { withClaimSecret: true });
    const res = await auditor.get(`/api/admin/products/${p.product.productId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(p.code.data);
    expect(res.body).not.toContain(p.claimCode!);
    expect(res.body).not.toMatch(/claim_secret_hash|scrypt\$/);
  });

  it('prototype-poisoning bodies are rejected before any handler', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/verify',
      headers: { 'content-type': 'application/json' },
      payload: '{"code":"AAAA","__proto__":{"admin":true}}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('a cross-site "simple" request (text/plain, form) never reaches a handler', async () => {
    const a = await accountClient(h);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/logout',
        headers: { 'content-type': type, cookie: `orbes_session=${a.client.cookies.get('orbes_session')}` },
        payload: 'x=1',
      });
      expect(res.statusCode).not.toBe(200);
    }
    expect((await a.client.get('/api/v1/account/me')).statusCode).toBe(200);
  });
});

// ── Public verification response: nothing internal leaves ─────────────────

describe('verify responses carry no internal facts', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  const FORBIDDEN_KEYS = /^(risk|riskScore|score|threshold|reasons?|productStatus|codeStatus|email|accountId|ownerId|owner|retailer|country|anomal\w*|findings?|ipHash|deviceHash|claimSecret\w*|payloadHash|nonce|signature_valid|authenticators)$/;

  function keysOf(v: unknown, out: string[] = []): string[] {
    if (Array.isArray(v)) for (const x of v) keysOf(x, out);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), keysOf(x, out));
    return out;
  }

  it('across every reachable state, the body holds only allow-listed fields', async () => {
    const owner = await accountClient(h);
    const sold = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.warranty.activate(sold.product.productId, { retailer: 'SECRET RETAILER', country: 'FR' }, SYSTEM_ACTOR);
    const first = safeJson(await owner.client.post('/api/v1/verify', { code: sold.code.data })) as any;
    expect((await owner.client.post('/api/v1/ownership/register', { registrationToken: first.registration.token, claimCode: sold.claimCode })).statusCode).toBe(201);

    const revoked = await issue(h.ctx, catalog);
    await h.ctx.services.lifecycle.transition(revoked.product.productId, 'REVOKED', { reason: 'internal reason text' }, SYSTEM_ACTOR);
    const stolen = await issue(h.ctx, catalog);
    await h.ctx.services.lifecycle.transition(stolen.product.productId, 'STOLEN', { reason: 'police report 123' }, SYSTEM_ACTOR);

    const bodies: any[] = [];
    const anon = h.client();
    for (const data of [sold.code.data, revoked.code.data, stolen.code.data, 'AAAA', sold.code.data.slice(0, -2) + 'AA']) {
      bodies.push(safeJson(await anon.post('/api/v1/verify', { code: data })));
    }
    bodies.push(safeJson(await owner.client.post('/api/v1/verify', { code: sold.code.data })));
    const states = bodies.map((b) => b.state);
    expect(states).toEqual(expect.arrayContaining(['AUTHENTIC_REGISTERED', 'REVOKED', 'SUSPICIOUS_ACTIVITY', 'MALFORMED_CODE', 'AUTHENTIC_OWNERSHIP_VERIFIED']));
    for (const b of bodies) {
      const bad = keysOf(b).filter((k) => FORBIDDEN_KEYS.test(k));
      expect(bad, JSON.stringify(b)).toEqual([]);
      const text = JSON.stringify(b);
      expect(text).not.toMatch(/SECRET RETAILER|internal reason|police report|@example\.com|STOLEN|COUNTERFEIT|RETIRED|"ISSUED"|"ACTIVATED"|"OWNED"/);
    }
  });
});

// ── SEC-3: login timing must not reveal which emails have accounts ──────────

describe('SEC-3 oversized passwords do not open an account-enumeration timing oracle', () => {
  let h: Harness;
  let known: string;
  let admin: { email: string };
  // 1000 three-byte characters: within the 1024-character body limit, over the 1024-byte scrypt limit.
  const OVERSIZED = '€'.repeat(1000);

  beforeAll(async () => {
    h = await createHarness();
    known = (await accountClient(h)).email;
    admin = await createAdmin(h.ctx, 'OPERATOR');
  });
  afterAll(() => h?.close());

  async function timed(fn: () => Promise<unknown>): Promise<number> {
    const t0 = performance.now();
    await fn();
    return performance.now() - t0;
  }

  it('answers a known and an unknown email the same way, without touching the account', async () => {
    const auditBefore = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const c = h.client();
    const a = await c.post('/api/v1/account/login', { email: known, password: OVERSIZED });
    const b = await c.post('/api/v1/account/login', { email: 'nobody-here@example.com', password: OVERSIZED });
    const d = await c.post('/api/admin/auth/login', { email: admin.email, password: OVERSIZED });
    for (const r of [a, b, d]) {
      expect(r.statusCode).toBe(401);
      expect(errorOf(r).code).toBe('INVALID_CREDENTIALS');
    }
    // The known account was never looked at: no failed-login entry, no admin failure counted.
    const auditAfter = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(auditAfter.n)).toBe(Number(auditBefore.n));
    const row = await h.ctx.db.selectFrom('admin_users').select('failed_logins').where('email_normalized', '=', admin.email.toLowerCase()).executeTakeFirstOrThrow();
    expect(row.failed_logins).toBe(0);
  });

  it('spends one password-hash evaluation on a known email too (timing parity)', async () => {
    const auth = h.ctx.services.auth;
    const login = (email: string) => auth.login({ email, password: OVERSIZED }).catch(() => undefined);
    await login('warm-up@example.com');
    let knownMs = 0;
    let unknownMs = 0;
    for (let i = 0; i < 3; i++) {
      knownMs += await timed(() => login(known));
      unknownMs += await timed(() => login(`nobody-${i}@example.com`));
    }
    // Before the fix a known email answered ~50x faster (no scrypt). Parity within a wide margin.
    expect(knownMs).toBeGreaterThan(unknownMs * 0.4);
  });
});

// ── SEC-6: admin lockout cannot be raced ────────────────────────────────────

describe('SEC-6 a login whose password check overlaps a lockout cannot succeed', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('the lock set by parallel failures while the hash was computed is honoured at commit', async () => {
    const creds = await createAdmin(h.ctx, 'ADMIN');
    // The login reads the (unlocked) admin row first, then spends ~50 ms in scrypt…
    const attempt = h.ctx.services.auth.adminLogin({ email: creds.email, password: creds.password });
    // …during which parallel wrong guesses (simulated) reach the threshold and lock the account.
    await h.ctx.db
      .updateTable('admin_users')
      .set({ failed_logins: 10, locked_until: new Date(h.ctx.clock().getTime() + 15 * 60_000) })
      .where('id', '=', creds.id)
      .execute();
    await expect(attempt).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', httpStatus: 429 });
    const sessions = await h.ctx.db.selectFrom('sessions').select('id_hash').where('subject_id', '=', creds.id).execute();
    expect(sessions).toHaveLength(0);
    // Once the lock has expired, the right password works again.
    h.clock.advance(16 * 60_000);
    await expect(h.ctx.services.auth.adminLogin({ email: creds.email, password: creds.password })).resolves.toMatchObject({ admin: { id: creds.id } });
  });
});

// ── Anomaly poisoning: what one client can and cannot do ───────────────────

describe('anomaly poisoning from a single client', () => {
  let h: Harness;
  let catalog: Catalog;
  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { verifyPerMinute: 1000 } } });
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  it('cookie-less bursts from one IP stay below the public threshold (default config, no geo)', async () => {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'R', country: 'FR' }, SYSTEM_ACTOR);
    let last: any;
    for (let i = 0; i < 40; i++) {
      // A fresh client per request: no cookies, so every scan mints a new device id.
      last = safeJson(await h.client({ ip: '198.51.100.77' }).post('/api/v1/verify', { code: p.code.data }));
      h.clock.advance(30_000);
    }
    // Known residual (review SEC-7): device diversity is inflated (cookies are free), but the
    // velocity + diversity weights combine to 55 < 60, so the public result does not flip and the
    // genuine buyer can still register.
    expect(last.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    const types = (await h.ctx.db.selectFrom('anomalies').select('type').where('product_id', '=', p.product.id).execute()).map((r) => r.type).sort();
    expect(types).toEqual(['DEVICE_DIVERSITY', 'SCAN_VELOCITY']);
  });
});

// ── SEC-8: router-level rejections use the API error shape and headers ──────

describe('SEC-8 URLs rejected by the router (before any hook) are answered like every other error', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('an over-long path parameter or a broken percent-escape neither echoes the URL nor drops the security headers', async () => {
    for (const url of [`/api/admin/products/${'x'.repeat(200)}`, '/api/v1/products/%E0%A4%A/service-history']) {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(safeJson(res)).toEqual({ error: { code: 'BAD_REQUEST', message: 'The request URL is invalid.' } });
      expect(res.body).not.toContain('xxxx');
      expect(res.body).not.toMatch(/FST_|E0%A4/);
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

// ── Hostile input never produces a 500 or echoes internals ─────────────────

describe('hostile input', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('malformed paths, queries and bodies answer 4xx with the generic error shape', async () => {
    const admin = await adminClient(h, 'ADMIN');
    const account = (await accountClient(h)).client;
    const nasty = ["'; DROP TABLE products; --", '%00', '..%2F..%2Fetc%2Fpasswd', 'O26-J-0000%2F1', '‮', 'x'.repeat(129), '%E0%A4%A'];
    const requests: [Client, string, string, unknown?][] = [];
    for (const n of nasty) {
      requests.push([admin, 'GET', `/api/admin/products/${n}`]);
      requests.push([admin, 'GET', `/api/admin/codes/${n}/artifact.svg`]);
      requests.push([admin, 'GET', `/api/admin/products?q=${encodeURIComponent(n)}&status=${encodeURIComponent(n)}`]);
      requests.push([admin, 'GET', `/api/admin/scans?productId=${encodeURIComponent(n)}&page=${encodeURIComponent(n)}`]);
      requests.push([admin, 'GET', `/api/admin/audit?action=${encodeURIComponent(n)}&targetId=${encodeURIComponent(n)}`]);
      requests.push([admin, 'POST', `/api/admin/keys/${n}/retire`]);
      requests.push([admin, 'POST', '/api/admin/revocations', { targetType: 'KEY', targetId: n, reason: 'x' }]);
      requests.push([admin, 'POST', '/api/admin/revocations', { targetType: 'PRODUCT', targetId: n, reason: 'x' }]);
      requests.push([account, 'GET', `/api/v1/products/${n}/service-history`]);
      requests.push([account, 'POST', '/api/v1/ownership/transfers/accept', { transferCode: n }]);
      requests.push([account, 'POST', '/api/v1/ownership/register', { registrationToken: n, claimCode: n }]);
    }
    requests.push([admin, 'GET', '/api/admin/products?page=99999999999999999999&pageSize=-5']);
    requests.push([admin, 'POST', '/api/admin/products', { categoryCode: 'J', modelId: 'not-a-uuid', material: 'x', serial: 1e300 }]);
    requests.push([admin, 'POST', '/api/admin/products', { categoryCode: 'J', modelId: '00000000-0000-4000-8000-000000000000', material: 'x', year: 1999 }]);
    requests.push([admin, 'POST', '/api/admin/codes/print-sheet', { codeIds: ['00000000-0000-4000-8000-000000000000'], widthMm: 1e9 }]);
    requests.push([account, 'POST', '/api/v1/verify', { code: 'A'.repeat(1024), genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 99] } }]);
    requests.push([account, 'POST', '/api/v1/verify', { code: { $ne: 1 } }]);
    requests.push([account, 'POST', '/api/v1/verify', [1, 2, 3]]);

    for (const [c, method, url, body] of requests) {
      const res = await c.request(method, url, body === undefined ? {} : { body });
      expect(res.statusCode, `${method} ${url} → ${res.body}`).toBeLessThan(500);
      if (res.statusCode >= 400) {
        const parsed = safeJson(res) as Record<string, unknown>;
        expect(Object.keys(parsed), `${method} ${url} → ${res.statusCode} ${res.body}`).toEqual(["error"]);
        expect(res.body).not.toMatch(/stack|at \w+ \(|kysely|postgres|pglite|syntax error|SELECT|relation "/i);
      }
    }
  });
});

// ── Audit coverage of every admin mutation ─────────────────────────────────

describe('every admin mutation lands in the hash-chained audit log, attributed to the admin', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h?.close());

  it('one audited entry per mutation, with actor id and IP pseudonym, and the chain verifies', async () => {
    const creds = await createAdmin(h.ctx, 'ADMIN');
    const admin = h.client();
    expect((await admin.post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);

    const step = async (label: string, run: () => Promise<{ statusCode: number; body: string }>, ok = [200, 201]) => {
      const before = await h.ctx.db.selectFrom('audit_logs').select((eb) => eb.fn.max('id').as('max')).executeTakeFirstOrThrow();
      const res = await run();
      expect(ok, `${label}: ${res.statusCode} ${res.body}`).toContain(res.statusCode);
      const entries = await h.ctx.db
        .selectFrom('audit_logs')
        .select(['action', 'actor_type', 'actor_id', 'ip_hash'])
        .where('id', '>', Number(before.max ?? 0))
        .execute();
      const mine = entries.filter((e) => e.actor_type === 'admin' && e.actor_id === creds.id && e.ip_hash);
      expect(mine.length, `${label} produced no attributed audit entry (${JSON.stringify(entries)})`).toBeGreaterThan(0);
      return safeJson(res as never) as any;
    };

    const cat = await step('category', () => admin.post('/api/admin/categories', { code: 'K', name: 'Leather', warrantyMonths: 24 }));
    const col = await step('collection', () => admin.post('/api/admin/collections', { name: 'AUDIT-COLLECTION' }));
    const model = await step('model', () => admin.post('/api/admin/models', { categoryCode: cat.code, collectionId: col.id, name: 'M', type: 'BAG', skuPrefix: 'AUD-1' }));
    const issued = await step('issue', () => admin.post('/api/admin/products', { categoryCode: cat.code, modelId: model.id, material: 'CALF' }));
    const pid = issued.product.productId as string;
    await step('artifact', () => admin.get(`/api/admin/codes/${issued.code.id}/artifact.svg`));
    await step('print sheet', () => admin.post('/api/admin/codes/print-sheet', { codeIds: [issued.code.id] }));
    await step('warranty activate', () => admin.post(`/api/admin/products/${pid}/warranty/activate`, { retailer: 'R', country: 'FR' }));
    const svc = await step('service open', () => admin.post(`/api/admin/products/${pid}/services`, { type: 'CLEANING' }));
    await step('service complete', () => admin.post(`/api/admin/services/${svc.service.id}/complete`, {}));

    // An unverified first registration, so ownership can be confirmed by staff.
    const customer = (await accountClient(h)).client;
    const reg = safeJson(await customer.post('/api/v1/verify', { code: issued.code.data })) as any;
    expect((await customer.post('/api/v1/ownership/register', { registrationToken: reg.registration.token })).statusCode).toBe(201);
    await step('ownership confirm', () => admin.post(`/api/admin/products/${pid}/ownership/confirm`));

    await step('warranty void', () => admin.post(`/api/admin/products/${pid}/warranty/void`, { reason: 'audit test' }));
    const reissued = await step('reissue', () => admin.post(`/api/admin/products/${pid}/codes/reissue`, { reason: 'damaged label' }));
    await step('code revoke', () => admin.post(`/api/admin/codes/${reissued.code.id}/revoke`, { reason: 'test' }));
    await step('transition', () => admin.post(`/api/admin/products/${pid}/transitions`, { to: 'REVOKED', reason: 'test' }));
    await step('reinstate', () => admin.post(`/api/admin/products/${pid}/reinstate`, { reason: 'test' }));

    const other = await step('issue 2', () => admin.post('/api/admin/products', { categoryCode: cat.code, modelId: model.id, material: 'CALF' }));
    await step('revocation (code)', () => admin.post('/api/admin/revocations', { targetType: 'CODE', targetId: other.code.id, reason: 'test' }));

    const finding = await h.ctx.db
      .insertInto('anomalies')
      .values({ product_id: issued.product.id, code_id: issued.code.id, type: 'SCAN_VELOCITY', severity: 'MEDIUM', risk_score: 35, details: '{}', status: 'OPEN' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await step('anomaly triage', () => admin.patch(`/api/admin/anomalies/${finding.id}`, { status: 'DISMISSED', note: 'noise' }));

    const rotated = await step('key rotate', () => admin.post('/api/admin/keys/rotate'));
    const keys = (safeJson(await admin.get('/api/admin/keys')) as any).items as { keyId: number; status: string }[];
    const retired = keys.find((k) => k.status === 'RETIRED')!;
    await step('key revoke', () => admin.post(`/api/admin/keys/${retired.keyId}/revoke`, { reason: 'test' }));
    await step('key retire', () => admin.post(`/api/admin/keys/${rotated.keyId}/retire`));

    const verify = safeJson(await admin.get('/api/admin/audit/verify')) as any;
    expect(verify.ok).toBe(true);
  });
});
