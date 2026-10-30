/**
 * PLATFORM RESET and LOCK RESET over HTTP (lot PURGE, step PURGE.11; plan §B.4, §S; D1, D2, D10, D11, D12, D13, B4.get,
 * B4.post, B5.lock, B7.pglite, M8, F6, F22, F29, G16, G17, G18, H6): GET /api/admin/platform-reset, POST
 * /api/admin/platform-reset and POST /api/admin/platform-reset/lock (routes/admin/platform-reset.ts).
 *
 *  - GET: the holder reads his state and the preview; another ADMIN `{ holder: false }` and nothing else; an OPERATOR
 *    and an AUDITOR 403; read only. `?part=holder` (the Settings page's link, PURGE.12): `{ holder }` and nothing else.
 *  - Every refusal of both presses, each with its code and its words, through the route: the body and the phrase (400),
 *    an OPERATOR and an AUDITOR (403), CSRF (403), another ADMIN (403 RESET_NOT_HOLDER), every answer of the step-up
 *    (STEP_UP_PASSWORD_INVALID, STEP_UP_CODE_INVALID, STEP_UP_CODE_USED, STEP_UP_TOTP_NOT_ENABLED, INSUFFICIENT_ROLE,
 *    STEP_UP_SESSION_WITHOUT_CODE, STEP_UP_TOO_SOON, 429 ACCOUNT_LOCKED, 429 STEP_UP_LOCKED), the 409s of the reset
 *    (RESET_NO_HOLDER, LIVE_OPEN with its Paris time, RESET_TEST_RUNNING, RESET_COLLECTORS_CHANGED both ways (G18),
 *    RESET_WINDOW for the night and for the 5-minute margin's end, RESET_LOCKED), consume's re-check at the route (the
 *    password changed between verify and consume: 400 STEP_UP_PASSWORD_CHANGED, nothing committed) on both presses.
 *    After each: the gate unchanged column by column (launched_at NULL), no admin.step_up row, no request row, the
 *    code not used, and for the reset the lifecycle hook NOT called (G17). None answers 401 (the console signs out on
 *    a 401): the session lives on after each.
 *  - Then the 202 (the hook called once, after the answer, with what the page showed), LOCK RESET's 200, a second lock
 *    409 RESET_LOCKED, the reset 409 RESET_LOCKED with its Paris time, LOCK one way. No code, password or session token
 *    reaches an audit row or the log, written by the production logger at level `trace`.
 *
 * The database's forbidden windows are answered open (CI runs at any hour), and replaced on purpose for the window
 * cases; the app's words follow the manual clock, moved into the night and before the hub backup for them.
 */
import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../../src/server/crypto/scrypt.js';
import { seal } from '../../src/server/crypto/secretbox.js';
import { base32Decode, generateTotpSecret, totp } from '../../src/server/crypto/totp.js';
import type { Db } from '../../src/server/db/connection.js';
import { createForwardingLogger, loggerOptions } from '../../src/server/http/logging.js';
import { deriveTotpEncryptionKey, STEP_UP_DAILY_FAILURES, STEP_UP_RECENT_MS } from '../../src/server/services/auth.js';
import { MAINTENANCE_MARGIN_MS, maintenanceWindow, parisClock, parisWhen, windowWords } from '../../src/server/services/maintenance-window.js';
import { LOCK_PHRASE, RESET_PHRASE, type PlatformResetPreview } from '../../src/server/services/platform-reset.js';
import { testPhrase } from '../../src/server/services/test-entrants.js';
import { poolDraw } from '../support/draws.js';
import { createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, PASSWORD, safeJson, type Client, type Harness } from './support.js';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const RESET_URL = '/api/admin/platform-reset';
const LOCK_URL = '/api/admin/platform-reset/lock';
const WRONG_PASSWORD = 'not the password of this account';

/** The database's forbidden windows, replaced: `body` is the SQL answer for `p_at` (NULL: open). */
const windowsAs = (db: Db, body = 'NULL::text') =>
  sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT ${body} $$`).execute(db);

/** The first minute, from `from`, at least 15 minutes into the next night window. */
function intoTheNight(from: Date): Date {
  for (let t = from.getTime(); t < from.getTime() + 3 * 24 * HOUR; t += MINUTE) {
    const w = maintenanceWindow(new Date(t));
    if (w?.kind === 'NIGHT' && t - w.startsAt.getTime() >= 15 * MINUTE) return new Date(t);
  }
  throw new Error('no night in three days');
}

/** `before` ms before the next 03:00 Paris (the hub backup). */
function beforeTheBackup(from: Date, before: number): Date {
  const start = Math.ceil(from.getTime() / MINUTE) * MINUTE + before;
  for (let t = start; t < start + 2 * 24 * HOUR; t += MINUTE) if (parisClock(new Date(t)) === '03:00') return new Date(t - before);
  throw new Error('no 03:00 in two days');
}

/** Every value of a JSON tree, to look for secrets in audit details. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (v === null || v === undefined) return out;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => leaves(x, out));
  else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => leaves(x, out));
  return out;
}

/**
 * Whether `text` holds the secret `s`. A six-digit code counts wherever it stands between two non-digits; the ISO
 * times and the identifiers and hashes (runs of 16 or more hex characters and hyphens) are set aside first, as a
 * code's six digits fall inside one of them by chance. Anything else: anywhere.
 */
function holds(text: string, s: string): boolean {
  if (!/^\d{6}$/.test(s)) return text.includes(s);
  return new RegExp(`(^|\\D)${s}(\\D|$)`).test(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})/g, '~').replace(/[0-9a-f-]{16,}/gi, '~'));
}

interface Staff {
  id: string;
  addr: string;
  key: Uint8Array;
}

type Page = { holder: true; launched: { at: string; by: string | null } | null; refusal: { code: string; message: string } | null; preview: PlatformResetPreview | null };

describe('admin: PLATFORM RESET and LOCK RESET over HTTP', () => {
  let h: Harness;
  let db: Db;
  let f: LiveFixture;
  let holder: Staff;
  let ally: Staff;
  let admin: Client;
  let other: Client;
  let operator: Client;
  let auditor: Client;
  const lines: string[] = [];
  const sink = { write: (s: string) => lines.push(s) };
  /** Every code, password and session token the tests typed or were given: none may reach an audit row or the log. */
  const secrets = new Set<string>([PASSWORD, WRONG_PASSWORD]);
  /** Every answer of the three routes: never a 401. */
  const answers: { url: string; status: number; code: string | null }[] = [];
  const clients: Client[] = [];
  /** What the lifecycle hook was asked (the route's onResponse, after a 202 only). */
  const asked: { adminId: string; seen: number; until: string | null }[] = [];

  beforeAll(async () => {
    const log = createForwardingLogger(sink);
    h = await createHarness({ app: { logger: { ...(loggerOptions({ logLevel: 'trace' }) as object), stream: sink }, liveHub: { pulseMs: 0, cacheMs: 0 } }, context: { log } });
    log.attach(h.app.log);
    db = h.ctx.db;
    h.app.testEntrants.useTimers(false);
    h.ctx.lifecycle = {
      requestPlatformReset(adminId, seen, until) {
        asked.push({ adminId, seen, until });
      },
    };
    await windowsAs(db);
    f = await liveFixtureOn(h.ctx, h.clock);
    holder = await enrolledAdmin('holder');
    ally = await enrolledAdmin('ally');
    await holderIs(holder);
    admin = await signIn(holder);
    other = await signIn(ally);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    clients.push(operator, auditor);
    // Two collectors signed up through the app: what a reset would delete.
    for (let i = 0; i < 2; i++) clients.push((await accountClient(h)).client);
  }, 120_000);

  afterAll(async () => {
    if (!h) return;
    try {
      // Nothing secret anywhere: every audit row (each column, each value of its details) and every log line.
      for (const c of clients) for (const v of c.cookies.values()) secrets.add(v);
      const rows = await db.selectFrom('audit_logs').select(['action', 'actor_id', 'target_type', 'target_id', 'details', 'ip_hash']).execute();
      for (const r of rows) {
        const values = [r.action, r.actor_id, r.target_type, r.target_id, r.ip_hash, ...leaves(r.details)].filter((x): x is string => typeof x === 'string');
        for (const s of secrets) for (const v of values) if (holds(v, s)) throw new Error(`a secret is in the audit row ${r.action}`);
      }
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) for (const s of secrets) if (holds(line, s)) throw new Error(`a secret is in the log: ${line.slice(0, 120)}`);
      // Never a 401 from the three routes.
      expect(answers.length).toBeGreaterThan(60);
      expect(answers.filter((x) => x.status === 401)).toEqual([]);
    } finally {
      await h.close();
    }
  });

  // ── helpers ──

  /** An ADMIN whose second factor is enrolled, with no enrolment row of the last 24 h (as one enrolled long ago). */
  async function enrolledAdmin(name: string): Promise<Staff> {
    const id = randomUUID();
    const addr = `${name}.${id.slice(0, 8)}@example.com`;
    const secret = generateTotpSecret();
    await db
      .insertInto('admin_users')
      .values({
        id,
        email: addr,
        email_normalized: addr,
        password_hash: await hashSecret(PASSWORD),
        role: 'ADMIN',
        totp_secret_enc: seal(deriveTotpEncryptionKey(h.ctx.config), JSON.stringify({ v: 1, s: secret, c: 0 }), `orbes/admin-totp/v1|${id}`),
      })
      .execute();
    return { id, addr, key: base32Decode(secret) };
  }

  /** The reset holder recorded in the gate (as the migration records it at the deploy; the superuser only). */
  const holderIs = (s: Staff) => sql`UPDATE platform_reset_gate SET holder_admin_id = ${s.id}::uuid WHERE id = 1`.execute(db);

  /** The code of the next time step (30 s later), never used before. */
  function code(s: Staff): string {
    h.clock.advance(30 * SECOND);
    const c = totp(s.key, h.clock.now().getTime());
    secrets.add(c);
    return c;
  }

  /** A code that is none of the current step's and its neighbours'. */
  function wrongCode(s: Staff): string {
    const now = h.clock.now().getTime();
    const near = [-1, 0, 1].map((d) => totp(s.key, now + d * 30 * SECOND));
    for (let i = 1; ; i++) {
      const c = String((Number(near[1]) + 111_111 * i) % 1_000_000).padStart(6, '0');
      if (!near.includes(c)) {
        secrets.add(c);
        return c;
      }
    }
  }

  /** Signed in through the console's route with the password and a code: a session that passed the second factor. */
  async function signIn(s: Staff): Promise<Client> {
    const c = h.client();
    const res = await c.post('/api/admin/auth/login', { email: s.addr, password: PASSWORD, totp: code(s) });
    expect(res.statusCode, res.body).toBe(200);
    expect((safeJson(res) as { mfaPassed: boolean }).mfaPassed).toBe(true);
    clients.push(c);
    return c;
  }

  /** A press of either route; for the reset, after the answer is out, the hook asked only when it was a 202 (G17). */
  async function post(c: Client, url: string, body: unknown, opts = {}): Promise<LightMyRequestResponse> {
    const before = asked.length;
    const res = await c.post(url, body, opts);
    answers.push({ url, status: res.statusCode, code: res.statusCode >= 400 ? errorOf(res).code : null });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    if (!(url === RESET_URL && res.statusCode === 202)) expect(asked, `${url} ${res.statusCode} ${res.body}`).toHaveLength(before);
    return res;
  }
  const reset = (c: Client, body: unknown, opts = {}) => post(c, RESET_URL, body, opts);
  const lock = (c: Client, body: unknown, opts = {}) => post(c, LOCK_URL, body, opts);

  async function page(c: Client): Promise<Page> {
    const res = await c.get(RESET_URL);
    answers.push({ url: `GET ${RESET_URL}`, status: res.statusCode, code: res.statusCode >= 400 ? errorOf(res).code : null });
    expect(res.statusCode, res.body).toBe(200);
    const p = safeJson(res) as Page;
    expect(p.holder).toBe(true);
    return p;
  }
  /** What the holder's page showed, as the press sends it back. */
  const seen = async (c: Client = admin) => {
    const p = (await page(c)).preview!;
    return { collectorsSeen: p.collectorsSeen, collectorsSeenUntil: p.collectorsSeenUntil };
  };

  const resetBody = (s: Staff, shown: { collectorsSeen: number; collectorsSeenUntil: string | null }, extra: Record<string, unknown> = {}) => ({
    phrase: RESET_PHRASE,
    password: PASSWORD,
    totp: code(s),
    ...shown,
    ...extra,
  });
  const lockBody = (s: Staff, extra: Record<string, unknown> = {}) => ({ phrase: LOCK_PHRASE, password: PASSWORD, totp: code(s), ...extra });

  /** A refusal: its status, code and words; the session still alive (GET me 200: no sign-out). */
  async function refused(res: LightMyRequestResponse | Promise<LightMyRequestResponse>, c: Client, status: number, codeWanted: string): Promise<string> {
    const r = await res;
    expect({ status: r.statusCode, code: errorOf(r).code }, r.body).toEqual({ status, code: codeWanted });
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(200);
    return errorOf(r).message;
  }

  const count = async (action: string) => Number((await sql<{ n: string | number }>`SELECT count(*) AS n FROM audit_logs WHERE action = ${action}`.execute(db)).rows[0]!.n);
  const failures = async (adminId: string) =>
    db.selectFrom('audit_logs').select(['id', 'details', 'occurred_at']).where('action', '=', 'admin.login_failed').where('target_id', '=', adminId).orderBy('id').execute();
  const sealedOf = async (adminId: string) => (await db.selectFrom('admin_users').select('totp_secret_enc').where('id', '=', adminId).executeTakeFirstOrThrow()).totp_secret_enc;
  const gateRow = async () => (await sql<Record<string, unknown>>`SELECT * FROM platform_reset_gate`.execute(db)).rows[0]!;

  interface Snapshot {
    gate: Record<string, unknown>;
    stepUps: number;
    requested: number;
    lockRequested: number;
    locked: number;
    sealed: string | null;
    failed: number;
    asked: number;
  }
  async function snapshot(s: Staff): Promise<Snapshot> {
    return {
      gate: await gateRow(),
      stepUps: await count('admin.step_up'),
      requested: await count('platform.reset.requested'),
      lockRequested: await count('platform.reset.lock.requested'),
      locked: await count('platform.reset.lock'),
      sealed: await sealedOf(s.id),
      failed: (await failures(s.id)).length,
      asked: asked.length,
    };
  }
  /**
   * Nothing written by a refusal: the gate unchanged column by column (launched_at still NULL), no admin.step_up row, no
   * request or lock row, the code not used, the hook not asked; `counted` wrong secrets recorded (via the step-up).
   */
  async function unchanged(before: Snapshot, s: Staff, counted = 0): Promise<void> {
    const now = await snapshot(s);
    expect(now).toEqual({ ...before, failed: before.failed + counted });
    expect(now.gate.launched_at).toBeNull();
    expect(now.gate.launched_by).toBeNull();
  }

  // ── the cases ──

  it('GET: the holder reads his state and the preview; another ADMIN { holder: false } and nothing else; an OPERATOR and an AUDITOR 403; read only', async () => {
    const audits = await sql<{ n: string | number }>`SELECT count(*) AS n FROM audit_logs`.execute(db);
    const gate = await gateRow();
    const mine = await page(admin);
    expect(mine).toMatchObject({ holder: true, email: holder.addr, launched: null, lastReset: null, lastFailure: null, refusal: null });
    expect(mine.preview).toMatchObject({ collectorsSeen: 2, collectors: { count: 2 } });
    expect(mine.preview!.collectorsSeenUntil).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    expect(JSON.stringify(mine.preview!.collectors)).not.toContain('@');
    const others = await other.get(RESET_URL);
    expect({ status: others.statusCode, body: safeJson(others) }).toEqual({ status: 200, body: { holder: false } });
    for (const c of [operator, auditor]) {
      const res = await c.get(RESET_URL);
      expect({ status: res.statusCode, code: errorOf(res).code }).toEqual({ status: 403, code: 'FORBIDDEN' });
    }
    // The Settings page's link (?part=holder): whether he is the holder, and nothing else; an OPERATOR and an AUDITOR 403.
    for (const [c, holds] of [[admin, true], [other, false]] as const) {
      const res = await c.get(`${RESET_URL}?part=holder`);
      answers.push({ url: `GET ${RESET_URL}?part=holder`, status: res.statusCode, code: null });
      expect({ status: res.statusCode, body: safeJson(res) }).toEqual({ status: 200, body: { holder: holds } });
    }
    for (const c of [operator, auditor]) {
      const res = await c.get(`${RESET_URL}?part=holder`);
      expect({ status: res.statusCode, code: errorOf(res).code }).toEqual({ status: 403, code: 'FORBIDDEN' });
    }
    expect((await sql<{ n: string | number }>`SELECT count(*) AS n FROM audit_logs`.execute(db)).rows).toEqual(audits.rows);
    expect(await gateRow()).toEqual(gate);
  });

  it('the bodies (strict) and the phrases of both presses: 400 with the phrase to type, before anything is read; nothing counted, nothing written, the hook not asked', async () => {
    const before = await snapshot(holder);
    const shown = await seen();
    const good = resetBody(holder, shown);
    for (const bad of [
      undefined,
      {},
      { ...good, phrase: undefined },
      { ...good, password: undefined },
      { ...good, totp: undefined },
      { ...good, collectorsSeen: undefined },
      { ...good, collectorsSeenUntil: undefined },
      { ...good, collectorsSeen: -1 },
      { ...good, collectorsSeen: 1.5 },
      { ...good, collectorsSeen: '2' },
      { ...good, collectorsSeenUntil: 'yesterday' },
      { ...good, totp: 'abcdef' },
      { ...good, totp: '12345' },
      { ...good, phrase: 'R'.repeat(41) },
      { ...good, surprise: true },
    ]) {
      await refused(reset(admin, bad), admin, 400, 'VALIDATION_FAILED');
    }
    const lockGood = lockBody(holder);
    for (const bad of [undefined, {}, { ...lockGood, password: undefined }, { ...lockGood, totp: undefined }, { ...lockGood, totp: '12345' }, { ...lockGood, surprise: true }]) {
      await refused(lock(admin, bad), admin, 400, 'VALIDATION_FAILED');
    }
    // The wrong phrase names the one to type; each press's phrase is refused by the other.
    expect(await refused(reset(admin, { ...good, phrase: 'RESET' }), admin, 400, 'VALIDATION_FAILED')).toBe('Type RESET PLATFORM to confirm.');
    expect(await refused(reset(admin, { ...good, phrase: LOCK_PHRASE }), admin, 400, 'VALIDATION_FAILED')).toBe('Type RESET PLATFORM to confirm.');
    expect(await refused(lock(admin, { ...lockGood, phrase: 'LOCK' }), admin, 400, 'VALIDATION_FAILED')).toBe('Type LOCK RESET to confirm.');
    expect(await refused(lock(admin, { ...lockGood, phrase: RESET_PHRASE }), admin, 400, 'VALIDATION_FAILED')).toBe('Type LOCK RESET to confirm.');
    await unchanged(before, holder);
  });

  it('ADMIN only, the holder only, CSRF: an OPERATOR and an AUDITOR 403, another ADMIN 403 RESET_NOT_HOLDER (his code not read), without the token or from another site 403; nothing counted, nothing written', async () => {
    const before = await snapshot(holder);
    const allyBefore = await snapshot(ally);
    const shown = await seen();
    for (const c of [operator, auditor]) {
      await refused(reset(c, resetBody(holder, shown)), c, 403, 'FORBIDDEN');
      await refused(lock(c, lockBody(holder)), c, 403, 'FORBIDDEN');
    }
    expect(await refused(reset(other, resetBody(ally, shown)), other, 403, 'RESET_NOT_HOLDER')).toBe('Only the reset holder can do this.');
    expect(await refused(lock(other, lockBody(ally)), other, 403, 'RESET_NOT_HOLDER')).toBe('Only the reset holder can do this.');
    // Another ADMIN's wrong code is never read: still 403, nothing counted.
    h.clock.advance(30 * SECOND);
    await refused(reset(other, { ...resetBody(ally, shown), totp: wrongCode(ally) }), other, 403, 'RESET_NOT_HOLDER');
    await refused(lock(other, { ...lockBody(ally), totp: wrongCode(ally), password: WRONG_PASSWORD }), other, 403, 'RESET_NOT_HOLDER');
    // The holder's right code and password, but no CSRF token; then from another site.
    await refused(reset(admin, resetBody(holder, shown), { noCsrf: true }), admin, 403, 'CSRF_FAILED');
    await refused(reset(admin, resetBody(holder, shown), { origin: 'https://evil.example' }), admin, 403, 'CSRF_FAILED');
    await refused(lock(admin, lockBody(holder), { noCsrf: true }), admin, 403, 'CSRF_FAILED');
    await refused(lock(admin, lockBody(holder), { origin: 'https://evil.example' }), admin, 403, 'CSRF_FAILED');
    await unchanged(before, holder);
    await unchanged(allyBefore, ally);
  });

  it('409 before the step-up, the hook not asked: a LIVE room open (until its Paris time), a test running, the collectors changed (one more; two more; one deleted and one signed up), no active holder; a wrong code answers the same, uncounted', async () => {
    const before = await snapshot(holder);
    // A LIVE room open: its room opened (5 minutes before T0, on the database's clock), not ended.
    const live = await createLiveRelease(f, { opensAt: new Date(Date.now() + 2 * MINUTE) });
    const closes = (await db.selectFrom('drops').select('closes_at').where('id', '=', live.id).executeTakeFirstOrThrow()).closes_at;
    const liveWords = `A LIVE room is open until ${parisWhen(closes)}.`;
    expect(liveWords).toMatch(/Paris\.$/);
    let shown = await seen();
    expect(await refused(reset(admin, resetBody(holder, shown)), admin, 409, 'LIVE_OPEN')).toBe(liveWords);
    h.clock.advance(30 * SECOND);
    expect(await refused(reset(admin, { ...resetBody(holder, shown), totp: wrongCode(holder) }), admin, 409, 'LIVE_OPEN')).toBe(liveWords);
    expect((await page(admin)).refusal).toEqual({ code: 'LIVE_OPEN', message: liveWords });
    // A LIVE release has no draw to cancel: its room set aside in the database (as migration 0067's test does).
    await sql`UPDATE drops SET cancelled_at = now() WHERE id = ${live.id}::uuid`.execute(db);
    expect((await page(admin)).refusal).toBeNull();

    // A test RUNNING anywhere.
    const now = h.clock.now().getTime();
    const draw = (await poolDraw(h.ctx.services.drops, db, { modelId: f.modelId, title: 'RUNNING', quantity: 1, opensAt: new Date(now - HOUR), closesAt: new Date(now + 3 * 24 * HOUR), earlyAccessHours: 0 }, f.admin)).id;
    const run = await h.app.testEntrants.start(
      draw,
      { phrase: testPhrase(draw), tiers: { none: 0, titane: 1, platine: 0, palladium: 0 }, arrival: { mode: 'all', interestPct: 0 }, behaviour: { confirmPct: 100 } },
      f.admin,
    );
    shown = await seen();
    expect(await refused(reset(admin, resetBody(holder, shown)), admin, 409, 'RESET_TEST_RUNNING')).toBe('A test is running. Reset once it has ended.');
    h.clock.advance(30 * SECOND);
    expect(await refused(reset(admin, { ...resetBody(holder, shown), totp: wrongCode(holder) }), admin, 409, 'RESET_TEST_RUNNING')).toBe('A test is running. Reset once it has ended.');
    await h.app.testEntrants.stop(run.id, f.admin);
    await h.app.testEntrants.end(run.id, testPhrase(draw, true), f.admin);
    await h.ctx.services.drops.cancel(draw, f.admin);
    expect((await page(admin)).refusal).toBeNull();

    // The collectors changed since the page was read (G18): an account signed up after the GET.
    shown = await seen();
    clients.push((await accountClient(h)).client);
    expect(await refused(reset(admin, resetBody(holder, shown)), admin, 409, 'RESET_COLLECTORS_CHANGED')).toBe('1 account signed up since you opened this page. Reload it and check them.');
    clients.push((await accountClient(h)).client);
    expect(await refused(reset(admin, resetBody(holder, shown)), admin, 409, 'RESET_COLLECTORS_CHANGED')).toBe('2 accounts signed up since you opened this page. Reload it and check them.');
    h.clock.advance(30 * SECOND);
    await refused(reset(admin, { ...resetBody(holder, shown), totp: wrongCode(holder) }), admin, 409, 'RESET_COLLECTORS_CHANGED');
    // One account set DELETED and one new sign-up after the GET: the count is the same, the newest sign-up is not.
    shown = await seen();
    // The oldest collector counted (neither a test entrant nor the team's).
    const gone = (
      await db
        .selectFrom('accounts')
        .select('id')
        .where('status', '<>', 'DELETED')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('test_entrants').select('account_id').whereRef('test_entrants.account_id', '=', 'accounts.id'))))
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;
    await db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', gone).execute();
    h.clock.advance(SECOND);
    clients.push((await accountClient(h)).client);
    expect((await seen()).collectorsSeen).toBe(shown.collectorsSeen);
    expect(await refused(reset(admin, resetBody(holder, shown)), admin, 409, 'RESET_COLLECTORS_CHANGED')).toBe('1 account signed up since you opened this page. Reload it and check them.');
    // What the page showed then, once more: the 202 path is not reached by a stale count either way.
    await refused(reset(admin, resetBody(holder, { ...shown, collectorsSeen: shown.collectorsSeen - 1 })), admin, 409, 'RESET_COLLECTORS_CHANGED');

    // No active holder (his second factor turned off: the database's holder must have one): 409 on both presses,
    // before the step-up, whose STEP_UP_TOTP_NOT_ENABLED the holder therefore never meets first (it is met below, when
    // the second factor goes between the two checks).
    const sealed = await sealedOf(holder.id);
    await db.updateTable('admin_users').set({ totp_secret_enc: null }).where('id', '=', holder.id).execute();
    const words = 'There is no reset holder: the reset needs an active ADMIN with two-factor authentication.';
    expect(await refused(reset(admin, resetBody(holder, await seen())), admin, 409, 'RESET_NO_HOLDER')).toBe(words);
    expect(await refused(lock(admin, lockBody(holder)), admin, 409, 'RESET_NO_HOLDER')).toBe(words);
    await db.updateTable('admin_users').set({ totp_secret_enc: sealed }).where('id', '=', holder.id).execute();
    await unchanged(before, holder);
  });

  it('every answer of the step-up, through both presses: the password, a wrong code, the sign-in\'s own code (each counted), the second factor or the role gone between the two checks; each with its words, nothing written, never a 401', async () => {
    const before = await snapshot(holder);
    const shown = await seen();
    // A wrong password: 400 STEP_UP_PASSWORD_INVALID, counted via the step-up (reason password).
    expect(await refused(reset(admin, resetBody(holder, shown, { password: WRONG_PASSWORD })), admin, 400, 'STEP_UP_PASSWORD_INVALID')).toBe('The password is not correct.');
    expect(await refused(lock(admin, lockBody(holder, { password: WRONG_PASSWORD })), admin, 400, 'STEP_UP_PASSWORD_INVALID')).toBe('The password is not correct.');
    // A wrong code: 400 STEP_UP_CODE_INVALID, counted.
    const invalid = 'The code is not valid. Check the time on your device and try again.';
    h.clock.advance(30 * SECOND);
    expect(await refused(reset(admin, { ...resetBody(holder, shown), totp: wrongCode(holder) }), admin, 400, 'STEP_UP_CODE_INVALID')).toBe(invalid);
    h.clock.advance(30 * SECOND);
    expect(await refused(lock(admin, { ...lockBody(holder), totp: wrongCode(holder) }), admin, 400, 'STEP_UP_CODE_INVALID')).toBe(invalid);
    const counted = (await failures(holder.id)).slice(before.failed).map((r) => r.details);
    expect(counted).toEqual([
      expect.objectContaining({ reason: 'password', via: 'step_up', locked: false }),
      expect.objectContaining({ reason: 'password', via: 'step_up', locked: false }),
      expect.objectContaining({ reason: 'totp', via: 'step_up', locked: false }),
      expect.objectContaining({ reason: 'totp', via: 'step_up', locked: false }),
    ]);
    await unchanged(before, holder, 4);

    // The code a sign-in just used: 400 STEP_UP_CODE_USED on both presses (counted too).
    const used = 'This code was just used. Wait for the next code.';
    for (const press of ['reset', 'lock'] as const) {
      const fresh = h.client();
      clients.push(fresh);
      const c = code(holder);
      expect((await fresh.post('/api/admin/auth/login', { email: holder.addr, password: PASSWORD, totp: c })).statusCode).toBe(200);
      const at = await snapshot(holder);
      const res = press === 'reset' ? reset(fresh, { ...resetBody(holder, shown), totp: c }) : lock(fresh, { ...lockBody(holder), totp: c });
      expect(await refused(res, fresh, 400, 'STEP_UP_CODE_USED')).toBe(used);
      await unchanged(at, holder, 1);
    }

    // The second factor turned off, then the role changed, between the precheck and the step-up's own checks.
    const auth = h.ctx.services.auth;
    const real = auth.verifyAdminStepUp.bind(auth);
    let first: (() => Promise<void>) | null = null;
    auth.verifyAdminStepUp = async (input, meta) => {
      if (first) await first();
      return real(input, meta);
    };
    try {
      const sealed = await sealedOf(holder.id);
      for (const press of ['reset', 'lock'] as const) {
        const at = await snapshot(holder);
        first = async () => {
          await db.updateTable('admin_users').set({ totp_secret_enc: null }).where('id', '=', holder.id).execute();
        };
        const res = press === 'reset' ? reset(admin, resetBody(holder, shown)) : lock(admin, lockBody(holder));
        expect(await refused(res, admin, 403, 'STEP_UP_TOTP_NOT_ENABLED')).toBe('Turn on two-factor authentication on the Security page first.');
        await db.updateTable('admin_users').set({ totp_secret_enc: sealed }).where('id', '=', holder.id).execute();
        first = async () => {
          await db.updateTable('admin_users').set({ role: 'OPERATOR' }).where('id', '=', holder.id).execute();
        };
        const again = press === 'reset' ? reset(admin, resetBody(holder, shown)) : lock(admin, lockBody(holder));
        const r = await again;
        await db.updateTable('admin_users').set({ role: 'ADMIN' }).where('id', '=', holder.id).execute();
        expect({ status: r.statusCode, code: errorOf(r).code }).toEqual({ status: 403, code: 'INSUFFICIENT_ROLE' });
        await unchanged(at, holder);
      }
    } finally {
      delete (auth as { verifyAdminStepUp?: unknown }).verifyAdminStepUp;
    }
    expect(auth.verifyAdminStepUp).toBe(Object.getPrototypeOf(auth).verifyAdminStepUp);
    expect((await admin.get('/api/admin/auth/me')).statusCode).toBe(200);
  });

  it('the holder\'s session opened without the code: 403 STEP_UP_SESSION_WITHOUT_CODE; his second factor enrolled in the console less than 24 h ago: 403 STEP_UP_TOO_SOON, the hour in Paris; both presses, nothing written', async () => {
    // A session opened with the password alone, the second factor enrolled since (from the shell).
    const creds = await createAdmin(h.ctx, 'ADMIN');
    const late = h.client();
    clients.push(late);
    expect((await late.post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    const lateSecret = generateTotpSecret();
    await db
      .updateTable('admin_users')
      .set({ totp_secret_enc: seal(deriveTotpEncryptionKey(h.ctx.config), JSON.stringify({ v: 1, s: lateSecret, c: 0 }), `orbes/admin-totp/v1|${creds.id}`) })
      .where('id', '=', creds.id)
      .execute();
    const lateStaff: Staff = { id: creds.id, addr: creds.email, key: base32Decode(lateSecret) };
    await holderIs(lateStaff);
    try {
      const at = await snapshot(lateStaff);
      const shown = await seen(late);
      const words = 'Sign out, then sign in again with your authenticator code.';
      expect(await refused(reset(late, resetBody(lateStaff, shown)), late, 403, 'STEP_UP_SESSION_WITHOUT_CODE')).toBe(words);
      expect(await refused(lock(late, lockBody(lateStaff)), late, 403, 'STEP_UP_SESSION_WITHOUT_CODE')).toBe(words);
      await unchanged(at, lateStaff);
    } finally {
      await holderIs(holder);
    }

    // An ADMIN who enrolled his second factor in the console's own routes 2 h ago, recorded as the holder.
    const fresh = await createAdmin(h.ctx, 'ADMIN');
    const c = h.client();
    clients.push(c);
    expect((await c.post('/api/admin/auth/login', { email: fresh.email, password: fresh.password })).statusCode).toBe(200);
    const { secret } = safeJson(await c.post('/api/admin/auth/totp/setup', {})) as { secret: string };
    secrets.add(secret);
    const staff: Staff = { id: fresh.id, addr: fresh.email, key: base32Decode(secret) };
    expect((await c.post('/api/admin/auth/totp/enable', { secret, code: code(staff) })).statusCode).toBe(200);
    const enabled = await db.selectFrom('audit_logs').select('occurred_at').where('action', '=', 'admin.totp.enable').where('target_id', '=', fresh.id).executeTakeFirstOrThrow();
    h.clock.advance(2 * HOUR);
    const signedIn = await signIn(staff);
    await holderIs(staff);
    try {
      const at = await snapshot(staff);
      const words = `Two-factor authentication or the role of this account changed less than 24 hours ago. Try again after ${parisWhen(new Date(enabled.occurred_at.getTime() + STEP_UP_RECENT_MS))}.`;
      expect(await refused(reset(signedIn, resetBody(staff, await seen(signedIn))), signedIn, 403, 'STEP_UP_TOO_SOON')).toBe(words);
      expect(await refused(lock(signedIn, lockBody(staff)), signedIn, 403, 'STEP_UP_TOO_SOON')).toBe(words);
      await unchanged(at, staff);
    } finally {
      await holderIs(holder);
    }
    // The holder's sessions are 8 h long: opened again after the two hours.
    admin = await signIn(holder);
    other = await signIn(ally);
  });

  it('429 ACCOUNT_LOCKED after ten wrong codes, before the code is read; unlocked by another ADMIN, 429 STEP_UP_LOCKED with the right code and password until 24 h after (Paris time); both presses, nothing written; sign-in itself unchanged', async () => {
    const locky = await enrolledAdmin('locky');
    const c = await signIn(locky);
    await holderIs(locky);
    try {
      const at = await snapshot(locky);
      const shown = await seen(c);
      for (let i = 0; i < STEP_UP_DAILY_FAILURES; i++) {
        h.clock.advance(30 * SECOND);
        const press = i % 2 === 0 ? reset(c, { ...resetBody(locky, shown), totp: wrongCode(locky) }) : lock(c, { ...lockBody(locky), totp: wrongCode(locky) });
        await refused(press, c, 400, 'STEP_UP_CODE_INVALID');
      }
      const counted = await failures(locky.id);
      expect(counted).toHaveLength(STEP_UP_DAILY_FAILURES);
      expect(counted.at(-1)!.details).toMatchObject({ failedLogins: 10, locked: true, via: 'step_up' });
      await unchanged(at, locky, STEP_UP_DAILY_FAILURES);
      const lockedAt = await snapshot(locky);
      expect(await refused(reset(c, resetBody(locky, shown)), c, 429, 'ACCOUNT_LOCKED')).toMatch(/./);
      await refused(lock(c, lockBody(locky)), c, 429, 'ACCOUNT_LOCKED');
      await unchanged(lockedAt, locky);
      // Another ADMIN unlocks it from the Team page: the step-up's own daily limit holds, with the right code.
      expect((await admin.post(`/api/admin/admins/${locky.id}/unlock`, {})).statusCode).toBe(200);
      const unlocked = await snapshot(locky);
      const words = `Too many wrong codes today. Try again after ${parisWhen(new Date(counted[0]!.occurred_at.getTime() + STEP_UP_RECENT_MS))}.`;
      expect(await refused(reset(c, resetBody(locky, shown)), c, 429, 'STEP_UP_LOCKED')).toBe(words);
      expect(await refused(lock(c, lockBody(locky)), c, 429, 'STEP_UP_LOCKED')).toBe(words);
      expect(words).toMatch(/Paris\.$/);
      await unchanged(unlocked, locky);
      // Sign-in is the same as ever: the right code opens a session.
      await signIn(locky);
    } finally {
      await holderIs(holder);
    }
  });

  it('409 RESET_WINDOW before the step-up: the night (Paris time first) and the 5-minute margin\'s end before the hub backup; six minutes ahead the window lets it through; LOCK RESET is not held by a window', async () => {
    const before = await snapshot(holder);
    try {
      // The night: the database says so, the words follow the app's clock (moved into the night).
      h.clock.set(intoTheNight(h.clock.now()));
      let c = await signIn(holder);
      const shown = await seen(c);
      await windowsAs(db, `'NIGHT'::text`);
      const night = await refused(reset(c, resetBody(holder, shown)), c, 409, 'RESET_WINDOW');
      expect(night).toBe(windowWords(h.clock.now(), MAINTENANCE_MARGIN_MS.reset));
      expect(night).toMatch(/^The platform's night maintenance runs from 04:00 to 0[67]:30 Paris \(0[23]:00–05:30 UTC\)\. Try again at 0[67]:30\.$/);
      h.clock.advance(30 * SECOND);
      await refused(reset(c, { ...resetBody(holder, shown), totp: wrongCode(holder) }), c, 409, 'RESET_WINDOW');
      expect((await page(c)).refusal).toMatchObject({ code: 'RESET_WINDOW' });
      // LOCK RESET in the night: not held by the window, it reaches the step-up (a wrong password, counted).
      expect(await refused(lock(c, lockBody(holder, { password: WRONG_PASSWORD })), c, 400, 'STEP_UP_PASSWORD_INVALID')).toBe('The password is not correct.');

      // Three minutes before the hub backup: only the 5-minute margin's end is in a window.
      h.clock.set(beforeTheBackup(h.clock.now(), 3 * MINUTE));
      c = await signIn(holder);
      const margin = await seen(c);
      await windowsAs(db, `CASE WHEN p_at > now() + interval '30 seconds' THEN 'BACKUP' END`);
      const body = resetBody(holder, margin);
      expect(maintenanceWindow(h.clock.now())).toBeNull();
      expect(await refused(reset(c, body), c, 409, 'RESET_WINDOW')).toBe('The hub backup starts at 03:00 Paris; try again at 03:10.');
      // Six minutes ahead: outside the margin, the precheck lets it through to its next answer (the count he saw, stale
      // on purpose, so no code is read).
      await windowsAs(db, `CASE WHEN p_at > now() + interval '6 minutes' THEN 'BACKUP' END`);
      await refused(reset(c, resetBody(holder, { ...margin, collectorsSeen: margin.collectorsSeen - 1 })), c, 409, 'RESET_COLLECTORS_CHANGED');
    } finally {
      await windowsAs(db);
    }
    // Nothing written but the night's wrong password; the sign-ins used their codes.
    const after = await snapshot(holder);
    expect({ ...after, sealed: null }).toEqual({ ...before, sealed: null, failed: before.failed + 1 });
    admin = await signIn(holder);
    other = await signIn(ally);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    clients.push(operator, auditor);
  });

  it('RESET PLATFORM: consume\'s re-check at the route (the password changed between verify and consume) 400 STEP_UP_PASSWORD_CHANGED, nothing committed, the hook not asked; the same code then 202, the hook asked once after the answer with what the page showed', async () => {
    const auth = h.ctx.services.auth;
    const real = auth.verifyAdminStepUp.bind(auth);
    let between: (() => Promise<void>) | null = null;
    auth.verifyAdminStepUp = async (input, meta) => {
      const v = await real(input, meta);
      if (between) await between();
      return v;
    };
    try {
      const hash = (await db.selectFrom('admin_users').select('password_hash').where('id', '=', holder.id).executeTakeFirstOrThrow()).password_hash;
      const before = await snapshot(holder);
      const shown = await seen();
      const same = resetBody(holder, shown);
      const at = h.clock.now();
      between = async () => {
        await db.updateTable('admin_users').set({ password_hash: await hashSecret('another password, long enough') }).where('id', '=', holder.id).execute();
      };
      expect(await refused(reset(admin, same), admin, 400, 'STEP_UP_PASSWORD_CHANGED')).toBe('Your password changed. Sign in again.');
      await db.updateTable('admin_users').set({ password_hash: hash }).where('id', '=', holder.id).execute();
      await unchanged(before, holder);
      expect(await gateRow()).toMatchObject({ authorized_by: null, authorized_at: null, authorized_purpose: null });
      between = null;

      // The same code, at the same time: it was never used, so the press goes through now.
      h.clock.set(at);
      const res = await reset(admin, same);
      expect(res.statusCode, res.body).toBe(202);
      expect(safeJson(res)).toEqual({ restartsIn: 'about a minute' });
      expect(asked).toEqual([{ adminId: holder.id, seen: shown.collectorsSeen, until: shown.collectorsSeenUntil }]);
      const after = await snapshot(holder);
      expect({ stepUps: after.stepUps, requested: after.requested, failed: after.failed }).toEqual({ stepUps: before.stepUps + 1, requested: before.requested + 1, failed: before.failed });
      expect(after.sealed).not.toBe(before.sealed);
      expect(after.gate).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset', launched_at: null, resets: 0 });
      const step = await db.selectFrom('audit_logs').select('details').where('action', '=', 'admin.step_up').where('target_id', '=', holder.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(step.details).toEqual({ purpose: 'platform.reset' });
      const requested = await db.selectFrom('audit_logs').select(['details', 'actor_id', 'target_id']).where('action', '=', 'platform.reset.requested').executeTakeFirstOrThrow();
      expect(requested).toEqual({ details: { collectorsSeen: shown.collectorsSeen, collectorsSeenUntil: shown.collectorsSeenUntil }, actor_id: holder.id, target_id: holder.id });
      // The same code again: used.
      await refused(reset(admin, same), admin, 400, 'STEP_UP_CODE_USED');
      expect(asked).toHaveLength(1);
    } finally {
      delete (auth as { verifyAdminStepUp?: unknown }).verifyAdminStepUp;
    }
    expect(auth.verifyAdminStepUp).toBe(Object.getPrototypeOf(auth).verifyAdminStepUp);
    expect((await h.ctx.audit.verifyChain()).ok).toBe(true);
  });

  it('LOCK RESET: consume\'s re-check (the password changed between verify and consume) commits nothing; then 200 for good; a second lock 409 RESET_LOCKED; the reset 409 RESET_LOCKED with its Paris time, the hook not asked; LOCK one way', async () => {
    const auth = h.ctx.services.auth;
    const real = auth.verifyAdminStepUp.bind(auth);
    let between: (() => Promise<void>) | null = null;
    auth.verifyAdminStepUp = async (input, meta) => {
      const v = await real(input, meta);
      if (between) await between();
      return v;
    };
    try {
      const hash = (await db.selectFrom('admin_users').select('password_hash').where('id', '=', holder.id).executeTakeFirstOrThrow()).password_hash;
      const before = await snapshot(holder);
      const same = lockBody(holder);
      const at = h.clock.now();
      between = async () => {
        await db.updateTable('admin_users').set({ password_hash: await hashSecret('another password, long enough') }).where('id', '=', holder.id).execute();
      };
      expect(await refused(lock(admin, same), admin, 400, 'STEP_UP_PASSWORD_CHANGED')).toBe('Your password changed. Sign in again.');
      await db.updateTable('admin_users').set({ password_hash: hash }).where('id', '=', holder.id).execute();
      await unchanged(before, holder);
      between = null;

      // The same code: never used, so LOCK RESET goes through now, for good.
      h.clock.set(at);
      const res = await lock(admin, same);
      expect(res.statusCode, res.body).toBe(200);
      const out = safeJson(res) as { launched: { at: string; by: string } };
      expect(out.launched.by).toBe(holder.addr);
      const gate = await gateRow();
      expect((gate.launched_at as Date).toISOString()).toBe(out.launched.at);
      expect(gate).toMatchObject({ launched_by: holder.id, authorized_by: null, authorized_at: null, authorized_purpose: null });
      const after = await snapshot(holder);
      expect({ stepUps: after.stepUps, lockRequested: after.lockRequested, locked: after.locked }).toEqual({
        stepUps: before.stepUps + 1,
        lockRequested: before.lockRequested + 1,
        locked: before.locked + 1,
      });
      const step = await db.selectFrom('audit_logs').select('details').where('action', '=', 'admin.step_up').where('target_id', '=', holder.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(step.details).toEqual({ purpose: 'platform.reset.lock' });
    } finally {
      delete (auth as { verifyAdminStepUp?: unknown }).verifyAdminStepUp;
    }
    expect(auth.verifyAdminStepUp).toBe(Object.getPrototypeOf(auth).verifyAdminStepUp);

    // Locked: a second lock and every reset refused for good, before the step-up (a wrong code is not read).
    const locked = await snapshot(holder);
    const gate = await gateRow();
    const words = `LOCK RESET was pressed on ${parisWhen(gate.launched_at as Date)}: the reset is refused for good.`;
    expect(await refused(lock(admin, lockBody(holder)), admin, 409, 'RESET_LOCKED')).toBe(words);
    h.clock.advance(30 * SECOND);
    await refused(lock(admin, { ...lockBody(holder), totp: wrongCode(holder) }), admin, 409, 'RESET_LOCKED');
    const shown = { collectorsSeen: 0, collectorsSeenUntil: null };
    expect(await refused(reset(admin, resetBody(holder, shown)), admin, 409, 'RESET_LOCKED')).toBe(words);
    await refused(reset(other, resetBody(ally, shown)), other, 403, 'RESET_NOT_HOLDER');
    expect(await snapshot(holder)).toEqual(locked);
    expect(asked).toHaveLength(1);
    // The page: locked, by whom, and no preview any more.
    const p = await page(admin);
    expect(p).toMatchObject({ launched: { at: (gate.launched_at as Date).toISOString(), by: holder.addr }, preview: null, refusal: { code: 'RESET_LOCKED', message: words } });
    expect(safeJson(await other.get(RESET_URL))).toEqual({ holder: false });
    // One way: not even the database's owner takes it back.
    await expect(sql`UPDATE platform_reset_gate SET launched_at = NULL, launched_by = NULL WHERE id = 1`.execute(db)).rejects.toThrow(/LOCK RESET is one way/);
    expect(await gateRow()).toEqual(gate);
  });
});

describe('admin: the platform reset presses draw on the auth budget', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { verifyPerMinute: 10_000, authPerMinute: 4, adminPerMinute: 10_000, apiPerMinute: 10_000 } } });
  });
  afterAll(() => h?.close());

  it('the sign-in and three presses spend the budget of 4; the fifth answers 429 RATE_LIMITED; the page and the other admin routes still answer', async () => {
    const c = await adminClient(h, 'ADMIN');
    expect((await c.post(RESET_URL, { phrase: 'x' })).statusCode).toBe(400);
    expect((await c.post(LOCK_URL, { phrase: 'x' })).statusCode).toBe(400);
    expect((await c.post(RESET_URL, { phrase: 'x' })).statusCode).toBe(400);
    const limited = await c.post(LOCK_URL, { phrase: 'x' });
    expect({ status: limited.statusCode, code: errorOf(limited).code }).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(safeJson(await c.get(RESET_URL))).toEqual({ holder: false });
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(200);
  });
});
