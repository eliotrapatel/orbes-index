/**
 * TEST PURGE over HTTP (lot PURGE, step PURGE.6; plan §A.4, §S; D10, D11, D16, A0.6, M6, M7, F6, F23, F28, G1, G14,
 * G16, H12): POST /api/admin/test-runs/:id/purge, POST /api/admin/test-runs/purge-all and GET
 * /api/admin/test-runs/ended (routes/admin/test-entrants.ts).
 *
 * Every refusal through the route, each with its code and its words: the body, the phrase, every answer of the
 * step-up (no second factor, a session opened without the code, a wrong code, the code of the sign-in, 429
 * ACCOUNT_LOCKED, then 429 STEP_UP_LOCKED once another ADMIN unlocked, the 24-hour rule after an enrolment made in the
 * console), the 409s of a window (Paris time first), a running test and the test's state, a drawn draw holding a real
 * collector's entry; an OPERATOR and an AUDITOR 403, CSRF, the `auth` budget. None answers 401: the session lives on
 * after each (the console signs out on a 401). Then the 202s: a purge, its resume when PAUSED (H12), 409
 * PURGE_IN_PROGRESS while it is under way, OFFER NEXT refused while it is PURGING and answering as today once it is
 * PAUSED with PURGE_NOT_TEST (G14), consume's re-checks at the route (the password or the role changed between verify
 * and consume; a test started meanwhile): nothing committed, no `admin.step_up` row, and the same code then works,
 * because a code is used only by a request that commits. No code, password or session token reaches an audit row or
 * the log, written by the production logger at level `trace`.
 *
 * The database's forbidden windows are answered open (CI runs at any hour); the app's own windows follow the manual
 * clock, set to 10:00 Paris and moved into the night on purpose.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { hashSecret } from '../../src/server/crypto/scrypt.js';
import { seal } from '../../src/server/crypto/secretbox.js';
import { base32Decode, generateTotpSecret, totp } from '../../src/server/crypto/totp.js';
import type { Db } from '../../src/server/db/connection.js';
import { createForwardingLogger, loggerOptions } from '../../src/server/http/logging.js';
import { deriveTotpEncryptionKey, STEP_UP_DAILY_FAILURES, STEP_UP_RECENT_MS } from '../../src/server/services/auth.js';
import { MAINTENANCE_MARGIN_MS, maintenanceWindow, parisClock, parisWhen, windowWords } from '../../src/server/services/maintenance-window.js';
import { testPhrase } from '../../src/server/services/test-entrants.js';
import { PURGE_ALL_PHRASE, purgePhrase, type PurgePass } from '../../src/server/services/test-purge.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { adminClient, createAdmin, createHarness, errorOf, PASSWORD, safeJson, type Client, type Harness } from './support.js';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

const WINDOWS_OPEN = `CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`;
/** The batch's first call (the window function) raises `code`: an injected failure of the database. */
const failWith = (db: Db, code: string) =>
  sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'injected' USING ERRCODE = '${code}'; END $$`).execute(db);
const windowsOpen = (db: Db) => sql.raw(WINDOWS_OPEN).execute(db);

/** The first 10:00 Paris at or after `from`. */
function tenInParis(from: Date): Date {
  const start = Math.ceil(from.getTime() / MINUTE) * MINUTE;
  for (let t = start; t < start + 2 * 24 * HOUR; t += MINUTE) if (parisClock(new Date(t)) === '10:00') return new Date(t);
  throw new Error('no 10:00 in two days');
}

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
  const start = Math.ceil(from.getTime() / MINUTE) * MINUTE;
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

interface Staff {
  id: string;
  addr: string;
  key: Uint8Array;
}

interface Run {
  id: string;
  drop: string;
}

describe('admin: TEST PURGE over HTTP', () => {
  let h: Harness;
  let f: LiveFixture;
  let db: Db;
  let purger: Staff;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  /** A drawn draw's ended test, purged last by the first 202. */
  let a: Run;
  const lines: string[] = [];
  const sink = { write: (s: string) => lines.push(s) };
  /** Every code, password and session token the tests typed or were given: none may reach an audit row or the log. */
  const secrets = new Set<string>([PASSWORD]);
  /** Every answer of the two purge routes: never a 401. */
  const answers: { url: string; status: number; code: string | null }[] = [];
  const clients: Client[] = [];

  beforeAll(async () => {
    const log = createForwardingLogger(sink);
    h = await createHarness({ app: { logger: { ...(loggerOptions({ logLevel: 'trace' }) as object), stream: sink }, liveHub: { pulseMs: 0, cacheMs: 0 } }, context: { log } });
    log.attach(h.app.log);
    db = h.ctx.db;
    h.app.testEntrants.useTimers(false);
    h.app.testEntrants.sleep = async (ms) => {
      h.clock.advance(ms);
    };
    h.ctx.services.testPurge.sleep = async () => undefined;
    await windowsOpen(db);
    h.clock.set(tenInParis(new Date()));
    f = await liveFixtureOn(h.ctx, h.clock);
    purger = await enrolledAdmin('purger');
    admin = await signIn(purger);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    clients.push(operator, auditor);
    a = await drawRun(3, 'A');
  }, 120_000);

  afterAll(async () => {
    if (!h) return;
    try {
      // Nothing secret anywhere: every audit row (each column, each value of its details) and every log line.
      for (const c of clients) for (const v of c.cookies.values()) secrets.add(v);
      const rows = await db.selectFrom('audit_logs').select(['action', 'actor_id', 'target_type', 'target_id', 'details', 'ip_hash']).execute();
      for (const r of rows) {
        const values = [r.action, r.actor_id, r.target_type, r.target_id, r.ip_hash, ...leaves(r.details)].filter((x): x is string => typeof x === 'string');
        for (const s of secrets) for (const v of values) if (/^\d{6}$/.test(s) ? v === s : v.includes(s)) throw new Error(`a secret is in the audit row ${r.action}`);
      }
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        for (const s of secrets) {
          if (/^\d{6}$/.test(s) ? new RegExp(`(^|\\D)${s}(\\D|$)`).test(line) : line.includes(s)) throw new Error(`a secret is in the log: ${line.slice(0, 120)}`);
        }
      }
      // Never a 401 from the purge routes.
      expect(answers.filter((x) => x.status === 401)).toEqual([]);
    } finally {
      await h.close();
    }
  });

  // ── helpers ──

  /** An ADMIN whose second factor is enrolled, with no enrolment row of the last 24 h (as one enrolled long ago). */
  async function enrolledAdmin(name: string, role: 'ADMIN' | 'OPERATOR' = 'ADMIN'): Promise<Staff> {
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
        role,
        totp_secret_enc: seal(deriveTotpEncryptionKey(h.ctx.config), JSON.stringify({ v: 1, s: secret, c: 0 }), `orbes/admin-totp/v1|${id}`),
      })
      .execute();
    return { id, addr, key: base32Decode(secret) };
  }

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
      if (!near.includes(c)) return c;
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

  async function post(c: Client, url: string, body: unknown, opts = {}): Promise<LightMyRequestResponse> {
    const res = await c.post(url, body, opts);
    answers.push({ url, status: res.statusCode, code: res.statusCode >= 400 ? errorOf(res).code : null });
    return res;
  }
  const purge = (c: Client, runId: string, body: unknown, opts = {}) => post(c, `/api/admin/test-runs/${runId}/purge`, body, opts);
  const purgeAll = (c: Client, body: unknown, opts = {}) => post(c, '/api/admin/test-runs/purge-all', body, opts);

  /** A refusal: its status, code and words; the session still alive (GET me 200: no sign-out). */
  async function refused(res: LightMyRequestResponse | Promise<LightMyRequestResponse>, c: Client, status: number, codeWanted: string): Promise<string> {
    const r = await res;
    expect({ status: r.statusCode, code: errorOf(r).code }, r.body).toEqual({ status, code: codeWanted });
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(200);
    return errorOf(r).message;
  }

  const stepUps = async (adminId: string) =>
    (await db.selectFrom('audit_logs').select(['id', 'details']).where('action', '=', 'admin.step_up').where('target_id', '=', adminId).orderBy('id').execute()).map((r) => r.details);
  const failures = async (adminId: string) =>
    db.selectFrom('audit_logs').select(['id', 'details', 'occurred_at']).where('action', '=', 'admin.login_failed').where('target_id', '=', adminId).orderBy('id').execute();
  const auditOf = (action: string, targetId: string) =>
    db.selectFrom('audit_logs').select(['id', 'details']).where('action', '=', action).where('target_id', '=', targetId).orderBy('id').execute();
  const sealedOf = async (adminId: string) => (await db.selectFrom('admin_users').select('totp_secret_enc').where('id', '=', adminId).executeTakeFirstOrThrow()).totp_secret_enc;
  const runRow = (id: string) => db.selectFrom('test_runs').select(['purge_state', 'purge_reason', 'purge_windows', 'purge_step_up_id']).where('id', '=', id).executeTakeFirstOrThrow();

  /** The bots for `ms` of the server's clock. */
  async function drive(ms: number, step = 500): Promise<void> {
    for (let t = 0; ; t += step) {
      for (let pass = 0; pass < 2; pass++) {
        await h.app.testEntrants.tick();
        await h.app.testEntrants.settle();
      }
      if (t >= ms) break;
      h.clock.advance(step);
    }
  }

  const press = (dropId: string, titane: number) => ({
    phrase: testPhrase(dropId),
    tiers: { none: 0, titane, platine: 0, palladium: 0 },
    arrival: { mode: 'all' as const, interestPct: 0 },
    behaviour: { confirmPct: 100 },
  });

  /** A draw OPEN now. */
  async function openDraw(title: string, closesIn = 5 * MINUTE): Promise<string> {
    const now = h.clock.now().getTime();
    return (
      await poolDraw(h.ctx.services.drops, db, { modelId: f.modelId, title, quantity: 3, opensAt: new Date(now - HOUR), closesAt: new Date(now + closesIn), earlyAccessHours: 0 }, f.admin)
    ).id;
  }

  /** An ENDED test of a draw the staff drew, every bot's place confirmed: its release over. */
  async function drawRun(titane: number, title: string): Promise<Run> {
    const now = h.clock.now().getTime();
    const drop = (
      await poolDraw(h.ctx.services.drops, db, { modelId: f.modelId, title, quantity: titane, opensAt: new Date(now - HOUR), closesAt: new Date(now + 5 * MINUTE), earlyAccessHours: 0 }, f.admin)
    ).id;
    const started = await h.app.testEntrants.start(drop, press(drop, titane), f.admin);
    await drive(0);
    h.clock.advance(6 * MINUTE);
    await h.ctx.services.drops.draw(drop, f.admin);
    await h.app.testEntrants.sweep();
    h.clock.advance(61 * SECOND);
    await h.app.testEntrants.sweep();
    expect((await h.app.testEntrants.end(started.id, testPhrase(drop, true), f.admin)).status).toBe('ENDED');
    h.clock.advance(MINUTE);
    return { id: started.id, drop };
  }

  /** A drawn draw's entry a real collector holds, crafted in the database (as no route makes one after the draw). */
  async function realEntry(dropId: string): Promise<string> {
    const real = await createAccount(db);
    return (
      await db
        .insertInto('drop_entries')
        .values({ drop_id: dropId, account_id: real.id, status: 'WAITLISTED', created_at: new Date(h.clock.now().getTime() - HOUR), tier: 0, seniority: 0, rank: 99 })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** The loop's passes until `until` answers (DONE by default). */
  async function passes(until: (p: PurgePass) => boolean = (p) => p === 'done'): Promise<void> {
    for (let i = 0; i < 2000; i++) {
      const p = await h.ctx.services.testPurge.pass();
      if (until(p)) return;
      if (p === 'idle') throw new Error('the loop went idle');
    }
    throw new Error('the loop never ended');
  }

  const offerNext = (dropId: string) => operator.post(`/api/admin/drops/${dropId}/offer-next`, {});

  /** The body of a purge: its phrase and the next code (spelt `000 000` when `spaced`). */
  const body = (runId: string, s: Staff = purger, spaced = false) => {
    const c = code(s);
    return { phrase: purgePhrase(runId), totp: spaced ? `${c.slice(0, 3)} ${c.slice(3)}` : c };
  };

  /** Nothing written by a refusal: the run as it was, no step-up row, no code used (the sealed counter unchanged). */
  async function nothingWritten(runId: string, s: Staff, sealed: string | null, stepUpRows: number): Promise<void> {
    expect((await runRow(runId)).purge_state).toBeNull();
    expect(await stepUps(s.id)).toHaveLength(stepUpRows);
    expect(await sealedOf(s.id)).toBe(sealed);
    expect(await auditOf('test_run.purge.start', runId)).toEqual([]);
  }

  // ── the cases ──

  it('validates the bodies (strict, the phrase at most 40 characters, a code of 6 to 8 digits); the wrong phrase names the one to type; an unknown test 404; none counts a failure or reads a code', async () => {
    const sealed = await sealedOf(purger.id);
    const good = body(a.id);
    for (const bad of [
      undefined,
      {},
      { phrase: good.phrase },
      { totp: good.totp },
      { ...good, surprise: true },
      { ...good, totp: 'abcdef' },
      { ...good, totp: '12345' },
      { ...good, totp: '123456789' },
      { ...good, totp: 123456 },
      { ...good, totp: `${good.totp}${' '.repeat(12)}` },
      { ...good, phrase: '' },
      { ...good, phrase: 'P'.repeat(41) },
    ]) {
      await refused(purge(admin, a.id, bad), admin, 400, 'VALIDATION_FAILED');
      await refused(purgeAll(admin, bad), admin, 400, 'VALIDATION_FAILED');
    }
    expect(await refused(purge(admin, a.id, { ...good, phrase: 'PURGE TEST 12345678' }), admin, 400, 'VALIDATION_FAILED')).toBe(`Type ${purgePhrase(a.id)} to confirm.`);
    expect(await refused(purgeAll(admin, { ...good, phrase: 'PURGE ALL' }), admin, 400, 'VALIDATION_FAILED')).toBe(`Type ${PURGE_ALL_PHRASE} to confirm.`);
    await refused(purge(admin, randomUUID(), good), admin, 404, 'TEST_RUN_NOT_FOUND');
    await refused(purge(admin, 'not-a-test', good), admin, 400, 'VALIDATION_FAILED');
    expect(await failures(purger.id)).toEqual([]);
    await nothingWritten(a.id, purger, sealed, 0);
  });

  it('ADMIN only: an OPERATOR and an AUDITOR 403 before anything is read; both read the ended tests, a seller does not; CSRF: without the token or from another site 403, nothing counted, no code used', async () => {
    const sealed = await sealedOf(purger.id);
    for (const c of [operator, auditor]) {
      await refused(purge(c, a.id, body(a.id)), c, 403, 'FORBIDDEN');
      await refused(purgeAll(c, { phrase: PURGE_ALL_PHRASE, totp: code(purger) }), c, 403, 'FORBIDDEN');
      expect((await c.get('/api/admin/test-runs/ended')).statusCode).toBe(200);
    }
    const seller = await adminClient(h, 'RETAIL');
    clients.push(seller);
    await refused(seller.get('/api/admin/test-runs/ended'), seller, 403, 'FORBIDDEN');
    // The right code, but no CSRF token; then from another site.
    await refused(purge(admin, a.id, body(a.id), { noCsrf: true }), admin, 403, 'CSRF_FAILED');
    await refused(purge(admin, a.id, body(a.id), { origin: 'https://evil.example' }), admin, 403, 'CSRF_FAILED');
    await refused(purgeAll(admin, { phrase: PURGE_ALL_PHRASE, totp: code(purger) }, { noCsrf: true }), admin, 403, 'CSRF_FAILED');
    expect(await failures(purger.id)).toEqual([]);
    await nothingWritten(a.id, purger, sealed, 0);
  });

  it('the step-up through the route: no second factor, a session opened without the code, a wrong code (counted), the sign-in\'s own code; each with its words, none a 401', async () => {
    // An ADMIN without a second factor (ADMIN_REQUIRE_MFA off here): 403, whatever the code.
    const bare = await adminClient(h, 'ADMIN');
    clients.push(bare);
    expect(await refused(purge(bare, a.id, body(a.id)), bare, 403, 'STEP_UP_TOTP_NOT_ENABLED')).toBe('Turn on two-factor authentication on the Security page first.');
    // A session opened with the password alone, the second factor enrolled since (from the shell): 403.
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
    expect(await refused(purge(late, a.id, body(a.id, lateStaff)), late, 403, 'STEP_UP_SESSION_WITHOUT_CODE')).toBe('Sign out, then sign in again with your authenticator code.');
    expect(await failures(creds.id)).toEqual([]);

    // A wrong code: 400, counted (via step_up), the session alive.
    const sealed = await sealedOf(purger.id);
    h.clock.advance(30 * SECOND);
    expect(await refused(purge(admin, a.id, { phrase: purgePhrase(a.id), totp: wrongCode(purger) }), admin, 400, 'STEP_UP_CODE_INVALID')).toBe(
      'The code is not valid. Check the time on your device and try again.',
    );
    const counted = await failures(purger.id);
    expect(counted.map((r) => r.details)).toEqual([{ reason: 'totp', failedLogins: 1, locked: false, via: 'step_up' }]);
    // The code the session was just opened with: 400 STEP_UP_CODE_USED.
    const fresh = h.client();
    clients.push(fresh);
    const used = code(purger);
    expect((await fresh.post('/api/admin/auth/login', { email: purger.addr, password: PASSWORD, totp: used })).statusCode).toBe(200);
    expect(await refused(purge(fresh, a.id, { phrase: purgePhrase(a.id), totp: used }), fresh, 400, 'STEP_UP_CODE_USED')).toBe('This code was just used. Wait for the next code.');
    // Counted too, as a wrong code is (a code seen at sign-in is a guess the step-up does not take).
    expect((await failures(purger.id)).map((r) => r.details)).toEqual([
      { reason: 'totp', failedLogins: 1, locked: false, via: 'step_up' },
      { reason: 'totp', failedLogins: 1, locked: false, via: 'step_up' },
    ]);
    await nothingWritten(a.id, purger, await sealedOf(purger.id), 0);
    expect(await sealedOf(purger.id)).not.toBe(sealed); // the sign-in used its code, nothing else did
  });

  it('429 ACCOUNT_LOCKED after ten wrong codes, before the code is read; unlocked by another ADMIN, 429 STEP_UP_LOCKED with the right code until 24 h after the tenth (Paris time); sign-in itself unchanged', async () => {
    const locky = await enrolledAdmin('locky');
    const c = await signIn(locky);
    for (let i = 0; i < STEP_UP_DAILY_FAILURES; i++) {
      h.clock.advance(30 * SECOND);
      await refused(purge(c, a.id, { phrase: purgePhrase(a.id), totp: wrongCode(locky) }), c, 400, 'STEP_UP_CODE_INVALID');
    }
    const counted = await failures(locky.id);
    expect(counted.at(-1)!.details).toMatchObject({ failedLogins: 10, locked: true, via: 'step_up' });
    const sealed = await sealedOf(locky.id);
    await refused(purge(c, a.id, body(a.id, locky)), c, 429, 'ACCOUNT_LOCKED');
    expect(await failures(locky.id)).toHaveLength(STEP_UP_DAILY_FAILURES);
    // Another ADMIN unlocks it from the Team page: the step-up's own daily limit holds, with the right code.
    expect((await admin.post(`/api/admin/admins/${locky.id}/unlock`, {})).statusCode).toBe(200);
    const words = await refused(purge(c, a.id, body(a.id, locky)), c, 429, 'STEP_UP_LOCKED');
    expect(words).toBe(`Too many wrong codes today. Try again after ${parisWhen(new Date(counted[0]!.occurred_at.getTime() + STEP_UP_RECENT_MS))}.`);
    expect(words).toMatch(/Paris/);
    expect(await sealedOf(locky.id)).toBe(sealed);
    // Sign-in is the same as ever: the right code opens a session.
    await signIn(locky);
    await nothingWritten(a.id, locky, await sealedOf(locky.id), 0);
  });

  it('the 24-hour rule: an ADMIN who enrolled the second factor in the console less than 24 h ago is refused 403 STEP_UP_TOO_SOON, the hour in Paris', async () => {
    const creds = await createAdmin(h.ctx, 'ADMIN');
    const c = h.client();
    clients.push(c);
    expect((await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password })).statusCode).toBe(200);
    const { secret } = safeJson(await c.post('/api/admin/auth/totp/setup', {})) as { secret: string };
    const staff: Staff = { id: creds.id, addr: creds.email, key: base32Decode(secret) };
    const enable = await c.post('/api/admin/auth/totp/enable', { secret, code: code(staff) });
    expect(enable.statusCode, enable.body).toBe(200);
    const enabled = (await auditOf('admin.totp.enable', creds.id))[0]!;
    const at = (await db.selectFrom('audit_logs').select('occurred_at').where('id', '=', enabled.id).executeTakeFirstOrThrow()).occurred_at;
    h.clock.advance(2 * HOUR);
    const words = await refused(purge(c, a.id, body(a.id, staff)), c, 403, 'STEP_UP_TOO_SOON');
    expect(words).toBe(`Two-factor authentication or the role of this account changed less than 24 hours ago. Try again after ${parisWhen(new Date(at.getTime() + STEP_UP_RECENT_MS))}.`);
    await nothingWritten(a.id, staff, await sealedOf(staff.id), 0);
  });

  it('409 before the code is read: a forbidden window (the night, the hub backup\'s margin) in Paris words, a test running, a test not ended, a release not over, a drawn draw holding a real collector\'s entry', async () => {
    const back = h.clock.now();
    // The night: both routes, the window's words (Paris first, UTC in parentheses).
    h.clock.set(intoTheNight(back));
    let c = await signIn(purger);
    const sealed = await sealedOf(purger.id);
    const night = await refused(purge(c, a.id, body(a.id)), c, 409, 'PURGE_WINDOW');
    expect(night).toBe(windowWords(h.clock.now(), MAINTENANCE_MARGIN_MS.purgeBatch));
    expect(night).toMatch(/^The platform's night maintenance runs from 04:00 to 0[67]:30 Paris \(0[23]:00–05:30 UTC\)\. Try again at 0[67]:30\.$/);
    expect(await refused(purgeAll(c, { phrase: PURGE_ALL_PHRASE, totp: code(purger) }), c, 409, 'PURGE_WINDOW')).toBe(windowWords(h.clock.now(), MAINTENANCE_MARGIN_MS.purgeBatch));
    // 30 s before the hub backup (each code is the next time step: the clock moves 30 s for each): inside the batch's 1-minute margin.
    h.clock.set(beforeTheBackup(h.clock.now(), 90 * SECOND));
    c = await signIn(purger);
    const margin = body(a.id);
    expect(maintenanceWindow(h.clock.now())).toBeNull();
    expect(await refused(purge(c, a.id, margin), c, 409, 'PURGE_WINDOW')).toBe('The hub backup starts at 03:00 Paris; try again at 03:10.');
    expect(await sealedOf(purger.id)).not.toBe(sealed); // the sign-ins' codes only
    h.clock.set(tenInParis(h.clock.now()));
    // A day on: the console's sessions (8 h) opened again.
    admin = await signIn(purger);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    clients.push(operator, auditor);

    // A test RUNNING anywhere: both routes.
    const open = await openDraw('RUNNING ELSEWHERE', 3 * 24 * HOUR);
    const running = await h.app.testEntrants.start(open, press(open, 1), f.admin);
    expect(await refused(purge(admin, a.id, body(a.id)), admin, 409, 'PURGE_TEST_RUNNING')).toBe('A test is running. Purge once it has ended.');
    expect(await refused(purgeAll(admin, { phrase: PURGE_ALL_PHRASE, totp: code(purger) }), admin, 409, 'PURGE_TEST_RUNNING')).toBe('A test is running. Purge once it has ended.');
    // STOPPED, not ended: 409 PURGE_NOT_ENDED; ENDED with its draw still open: 409 PURGE_RELEASE_NOT_OVER.
    await h.app.testEntrants.stop(running.id, f.admin);
    expect(await refused(purge(admin, running.id, body(running.id)), admin, 409, 'PURGE_NOT_ENDED')).toBe('Only an ended test can be purged: END TEST first.');
    await h.app.testEntrants.end(running.id, testPhrase(open, true), f.admin);
    expect(await refused(purge(admin, running.id, body(running.id)), admin, 409, 'PURGE_RELEASE_NOT_OVER')).toBe('Purge once the release is over.');

    // A drawn draw holding a real collector's entry (test releases only, G1): 409 PURGE_NOT_TEST with its words.
    const b = await drawRun(2, 'B');
    await realEntry(b.drop);
    expect(await refused(purge(admin, b.id, body(b.id)), admin, 409, 'PURGE_NOT_TEST')).toBe(
      'This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.',
    );
    const listed = (safeJson(await auditor.get('/api/admin/test-runs/ended')) as { runs: { id: string; purgeable: unknown }[] }).runs;
    expect(listed.find((r) => r.id === b.id)!.purgeable).toEqual({
      reason: 'PURGE_NOT_TEST',
      message: 'This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.',
    });
    expect(listed.find((r) => r.id === running.id)!.purgeable).toEqual({ reason: 'PURGE_RELEASE_NOT_OVER', message: 'Purge once the release is over.' });
    for (const id of [a.id, b.id, running.id]) await nothingWritten(id, purger, await sealedOf(purger.id), 0);
    expect((await failures(purger.id)).length).toBe(2); // the wrong code and the sign-in's code of the step-up case only
  });

  it('PURGE: 202 { run } PURGING, the code (spelt 000 000) consumed once, test_run.purge.start; a second POST 409 PURGE_IN_PROGRESS; OFFER NEXT 409 RELEASE_BEING_PURGED meanwhile; ended reads its progress; DONE; then 409 PURGE_DONE and OFFER NEXT as today', async () => {
    const today = await offerNext(a.drop);
    expect({ status: today.statusCode, code: errorOf(today).code }).toEqual({ status: 409, code: 'DROP_WAITLIST_EMPTY' });
    const res = await purge(admin, a.id, body(a.id, purger, true));
    expect(res.statusCode, res.body).toBe(202);
    const { run } = safeJson(res) as { run: { id: string; status: string; purge: { state: string; requestedBy: string; reason: string | null }; purgeable: unknown } };
    expect(run).toMatchObject({ id: a.id, status: 'ENDED', purge: { state: 'PURGING', requestedBy: purger.addr, reason: null }, purgeable: { reason: 'PURGE_IN_PROGRESS' } });
    expect(await stepUps(purger.id)).toEqual([{ purpose: `test_run.purge:${a.id}` }]);
    const start = await auditOf('test_run.purge.start', a.id);
    expect(start).toHaveLength(1);
    expect(start[0]!.details).toMatchObject({ dropId: a.drop, drawn: true, planned: { accounts: 3 } });
    // Under way: 409 PURGE_IN_PROGRESS before any code is read.
    expect(await refused(purge(admin, a.id, body(a.id)), admin, 409, 'PURGE_IN_PROGRESS')).toBe('This test is being purged.');
    expect(await stepUps(purger.id)).toHaveLength(1);
    // The staff's OFFER NEXT on that release: 409 RELEASE_BEING_PURGED with its words.
    const meanwhile = await offerNext(a.drop);
    expect({ status: meanwhile.statusCode, ...errorOf(meanwhile) }).toEqual({ status: 409, code: 'RELEASE_BEING_PURGED', message: 'A test of this release is being purged. Try again once it is done.' });
    const during = (safeJson(await auditor.get('/api/admin/test-runs/ended')) as { runs: { id: string; dropId: string; dropName: string; purge: { state: string } | null }[] }).runs;
    expect(during.find((r) => r.id === a.id)).toMatchObject({ dropId: a.drop, dropName: 'A', purge: { state: 'PURGING' } });

    await passes();
    const ended = (safeJson(await auditor.get('/api/admin/test-runs/ended')) as { runs: { id: string; purge: { state: string; deleted: Record<string, number> } }[] }).runs;
    // Its entries deleted; its accounts too, but those a later test took from the pool (kept by that test).
    expect(ended.find((r) => r.id === a.id)!.purge).toMatchObject({ state: 'DONE', deleted: { drop_entries: 3, test_run_entrants: 3 } });
    expect(await refused(purge(admin, a.id, body(a.id)), admin, 409, 'PURGE_DONE')).toBe('This test is already purged.');
    const after = await offerNext(a.drop);
    expect({ status: after.statusCode, code: errorOf(after).code }).toEqual({ status: 409, code: 'DROP_WAITLIST_EMPTY' });
    expect((await h.ctx.audit.verifyChain({ batchSize: 97 })).ok).toBe(true);
  });

  it('OFFER NEXT answers as today once the purge is PAUSED with PURGE_NOT_TEST (a real collector\'s entry appeared in its drawn draw), and a POST then answers 409 PURGE_NOT_TEST', async () => {
    const c = await drawRun(2, 'C');
    expect((await purge(admin, c.id, body(c.id))).statusCode).toBe(202);
    expect(errorOf(await offerNext(c.drop)).code).toBe('RELEASE_BEING_PURGED');
    // Up to its windows and the run's entrants gone; then a real collector's entry: the next call pauses it.
    for (let i = 0; ; i++) {
      expect(i).toBeLessThan(200);
      expect(await h.ctx.services.testPurge.pass()).toBe('called');
      const row = await runRow(c.id);
      const left = await db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', c.id).execute();
      if (row.purge_windows !== null && left.length === 0) break;
    }
    const real = await realEntry(c.drop);
    expect(await h.ctx.services.testPurge.pass()).toBe('paused');
    expect(await runRow(c.id)).toMatchObject({ purge_state: 'PAUSED', purge_reason: 'PURGE_NOT_TEST' });
    expect(await refused(purge(admin, c.id, body(c.id)), admin, 409, 'PURGE_NOT_TEST')).toBe(
      'This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.',
    );
    // The guard lifted: the staff offer the real collector a place, as today (the release then has an offer open).
    const offered = await offerNext(c.drop);
    expect(offered.statusCode, offered.body).toBe(200);
    expect(safeJson(offered)).toMatchObject({ id: real, status: 'SELECTED' });
    expect(await refused(purge(admin, c.id, body(c.id)), admin, 409, 'PURGE_RELEASE_NOT_OVER')).toBe('Purge once the release is over.');
    const view = (safeJson(await auditor.get('/api/admin/test-runs/ended')) as { runs: { id: string; purge: { state: string; message: string } }[] }).runs.find((r) => r.id === c.id)!;
    expect(view.purge).toMatchObject({ state: 'PAUSED', message: 'A real collector’s entry is now in this drawn draw: the purge stopped here.' });
  });

  it('a PAUSED purge (the database refused a step) resumes on a new POST: 202, the step-up consumed again, test_run.purge.resume; then 409 PURGE_IN_PROGRESS; DONE', async () => {
    const d = await drawRun(2, 'D');
    expect((await purge(admin, d.id, body(d.id))).statusCode).toBe(202);
    const first = await runRow(d.id);
    await failWith(db, '23503');
    try {
      expect(await h.ctx.services.testPurge.pass()).toBe('paused');
    } finally {
      await windowsOpen(db);
    }
    expect(await runRow(d.id)).toMatchObject({ purge_state: 'PAUSED', purge_reason: 'SQLSTATE_23503' });
    const rows = (await stepUps(purger.id)).length;
    const res = await purge(admin, d.id, body(d.id));
    expect(res.statusCode, res.body).toBe(202);
    expect((safeJson(res) as { run: { purge: { state: string; reason: string | null } } }).run.purge).toMatchObject({ state: 'PURGING', reason: null });
    expect(await stepUps(purger.id)).toHaveLength(rows + 1);
    expect((await stepUps(purger.id)).at(-1)).toEqual({ purpose: `test_run.purge:${d.id}` });
    const resumes = await auditOf('test_run.purge.resume', d.id);
    expect(resumes.map((r) => r.details)).toEqual([{ reason: 'SQLSTATE_23503', via: 'request', purpose: `test_run.purge:${d.id}` }]);
    // The first request's step-up stays the run's (write-once).
    expect(Number((await runRow(d.id)).purge_step_up_id)).toBe(Number(first.purge_step_up_id));
    await refused(purge(admin, d.id, body(d.id)), admin, 409, 'PURGE_IN_PROGRESS');
    expect(await stepUps(purger.id)).toHaveLength(rows + 1);
    await passes();
    expect((await runRow(d.id)).purge_state).toBe('DONE');
  });

  it('consume\'s re-checks at the route: the password changed, the role changed, a test started between verify and consume: refused, nothing committed, no admin.step_up row; the same code then purges', async () => {
    const e = await drawRun(2, 'E');
    const auth = h.ctx.services.auth;
    const real = auth.verifyAdminStepUp.bind(auth);
    let between: (() => Promise<void>) | null = null;
    auth.verifyAdminStepUp = async (input, meta) => {
      const v = await real(input, meta);
      if (between) await between();
      return v;
    };
    try {
      const hash = (await db.selectFrom('admin_users').select('password_hash').where('id', '=', purger.id).executeTakeFirstOrThrow()).password_hash;
      const rows = (await stepUps(purger.id)).length;
      const sealed = await sealedOf(purger.id);
      const same = body(e.id);
      const at = h.clock.now();
      // The password changed meanwhile.
      between = async () => {
        await db.updateTable('admin_users').set({ password_hash: await hashSecret('another password, long enough') }).where('id', '=', purger.id).execute();
      };
      expect(await refused(purge(admin, e.id, same), admin, 400, 'STEP_UP_PASSWORD_CHANGED')).toBe('Your password changed. Sign in again.');
      await db.updateTable('admin_users').set({ password_hash: hash }).where('id', '=', purger.id).execute();
      await nothingWritten(e.id, purger, sealed, rows);
      // The role changed meanwhile.
      between = async () => {
        await db.updateTable('admin_users').set({ role: 'OPERATOR' }).where('id', '=', purger.id).execute();
      };
      await refused(purge(admin, e.id, same), admin, 403, 'INSUFFICIENT_ROLE');
      await db.updateTable('admin_users').set({ role: 'ADMIN' }).where('id', '=', purger.id).execute();
      await nothingWritten(e.id, purger, sealed, rows);
      // A test started meanwhile: consumed inside the transaction, then refused under the lock: rolled back with it.
      const open = await openDraw('STARTED MEANWHILE', 3 * 24 * HOUR);
      let started: string | null = null;
      between = async () => {
        started = (await h.app.testEntrants.start(open, press(open, 1), f.admin)).id;
      };
      await refused(purge(admin, e.id, same), admin, 409, 'PURGE_TEST_RUNNING');
      await nothingWritten(e.id, purger, sealed, rows);
      between = null;
      await h.app.testEntrants.stop(started!, f.admin);
      await h.app.testEntrants.end(started!, testPhrase(open, true), f.admin);
      // The same code, at the same time: it was never used, so it purges now.
      h.clock.set(at);
      const res = await purge(admin, e.id, same);
      expect(res.statusCode, res.body).toBe(202);
      expect(await stepUps(purger.id)).toHaveLength(rows + 1);
      expect(await sealedOf(purger.id)).not.toBe(sealed);
    } finally {
      delete (auth as { verifyAdminStepUp?: unknown }).verifyAdminStepUp;
    }
    expect(auth.verifyAdminStepUp).toBe(Object.getPrototypeOf(auth).verifyAdminStepUp);
    await passes();
  });

  it('PURGE ALL: 202 { runs, resumed, skipped }, the skipped with their words, one step-up; refused in a window and while a test runs (above)', async () => {
    const g = await drawRun(1, 'G');
    const rows = (await stepUps(purger.id)).length;
    const res = await purgeAll(admin, { phrase: 'purge all tests', totp: code(purger) });
    expect(res.statusCode, res.body).toBe(202);
    const out = safeJson(res) as { runs: string[]; resumed: string[]; skipped: { runId: string; reason: string; message: string }[] };
    expect(Object.keys(out).sort()).toEqual(['resumed', 'runs', 'skipped']);
    expect(out.runs).toEqual([g.id]);
    expect(out.resumed).toEqual([]);
    const reasons = new Set(out.skipped.map((s) => s.reason));
    expect([...reasons].sort()).toEqual(['PURGE_NOT_TEST', 'PURGE_RELEASE_NOT_OVER']);
    for (const s of out.skipped) expect(s.message.length).toBeGreaterThan(10);
    expect((await stepUps(purger.id)).slice(rows)).toEqual([{ purpose: 'test_run.purge_all' }]);
    await passes();
    expect((await runRow(g.id)).purge_state).toBe('DONE');
  });

  it('GET ended: every ENDED test of every release, the newest ended first, with its release, purge and purgeable; no test still running or stopped', async () => {
    const { runs } = safeJson(await auditor.get('/api/admin/test-runs/ended')) as { runs: Record<string, unknown>[] };
    const wanted = await db.selectFrom('test_runs').select('id').where('status', '=', 'ENDED').orderBy('ended_at', 'desc').orderBy('created_at', 'desc').orderBy('id').execute();
    expect(runs.map((r) => r.id)).toEqual(wanted.map((r) => r.id));
    expect(runs.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(runs[0]!).sort()).toEqual(
      ['checksPassed', 'checksTotal', 'createdAt', 'createdBy', 'dropId', 'dropName', 'endedAt', 'entrants', 'id', 'mode', 'peaks', 'purge', 'purgeable', 'report', 'status'].sort(),
    );
    for (const r of runs) expect(r.status).toBe('ENDED');
    expect(runs.find((r) => r.id === a.id)).toMatchObject({ dropId: a.drop, dropName: 'A', mode: 'DRAW', purge: { state: 'DONE' }, purgeable: { reason: 'PURGE_DONE' } });
  });
});

describe('admin: the purge routes draw on the auth budget', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { verifyPerMinute: 10_000, authPerMinute: 4, adminPerMinute: 10_000, apiPerMinute: 10_000 } } });
  });
  afterAll(() => h?.close());

  it('the sign-in and three purge requests spend the budget of 4; the fifth answers 429 RATE_LIMITED, the other admin routes still answer', async () => {
    const c = await adminClient(h, 'ADMIN');
    const id = randomUUID();
    expect((await c.post(`/api/admin/test-runs/${id}/purge`, { phrase: 'x' })).statusCode).toBe(400);
    expect((await c.post('/api/admin/test-runs/purge-all', { phrase: 'x' })).statusCode).toBe(400);
    expect((await c.post(`/api/admin/test-runs/${id}/purge`, { phrase: 'x' })).statusCode).toBe(400);
    const limited = await c.post('/api/admin/test-runs/purge-all', { phrase: 'x' });
    expect({ status: limited.statusCode, code: errorOf(limited).code }).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect((await c.get('/api/admin/test-runs/ended')).statusCode).toBe(200);
    expect((await c.get('/api/admin/auth/me')).statusCode).toBe(200);
  });
});
