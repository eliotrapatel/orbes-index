/**
 * TEST PURGE's service (lot PURGE, step PURGE.5; plan §A.4, §N, H12, G14, G21): TestPurgeService's request with its
 * step-up, its loop of bounded batches on a manual clock, its pauses and resumes, what it does with each refusal, the
 * in-memory state it forgets, the staff's guard on the release, the views' buffer, the boot, PURGE ALL and its pool
 * sweep. The tests are the app's own (TestEntrantService's bots on PGlite), the purger an ADMIN with a second factor
 * whose session passed it.
 *
 * The database's forbidden windows are answered open (CI runs at any hour); the app's own windows follow the manual
 * clock. An injected SQLSTATE replaces the window function the batch calls first (the test owns the throwaway database).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { hashSecret } from '../../src/server/crypto/scrypt.js';
import { seal } from '../../src/server/crypto/secretbox.js';
import { base32Decode, generateTotpSecret, totp } from '../../src/server/crypto/totp.js';
import { inTransaction, type Db } from '../../src/server/db/connection.js';
import { purgeRefusal } from '../../src/server/db/pg-errors.js';
import { jsonText } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { deriveTotpEncryptionKey } from '../../src/server/services/auth.js';
import { maintenanceWindow, parisClock } from '../../src/server/services/maintenance-window.js';
import { testPhrase, type TestEntrantService, type TestRunSettingsInput } from '../../src/server/services/test-entrants.js';
import { PURGE_ALL_PHRASE, PURGE_RETRY_MS, pauseWords, purgePhrase, TestPurgeService, type PurgeAsker, type PurgePass } from '../../src/server/services/test-purge.js';
import type { SeenBatch, SeenMeta } from '../../src/server/services/tracking.js';
import { createHarness, PASSWORD, type Harness } from '../api/support.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ── the world: the whole app on PGlite, a manual clock, the bots driven by hand ──

interface Purger {
  id: string;
  addr: string;
  key: Uint8Array;
}

interface World {
  h: Harness;
  f: LiveFixture;
  db: Db;
  tests: TestEntrantService;
  purge: TestPurgeService;
  purger: Purger;
}

const WINDOWS_OPEN = `CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`;
/** The batch's first call (the window function) raises `code`: an injected failure of the database. */
const failWith = (db: Db, code: string) =>
  sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'injected' USING ERRCODE = '${code}'; END $$`).execute(db);
const windowsOpen = (db: Db) => sql.raw(WINDOWS_OPEN).execute(db);

async function world(opts: { liveHub?: { pulseMs: number; cacheMs: number } } = {}): Promise<World> {
  const h = await createHarness({ app: { liveHub: opts.liveHub ?? { pulseMs: 0, cacheMs: 0 } } });
  const f = await liveFixtureOn(h.ctx, h.clock);
  const tests = h.app.testEntrants;
  tests.useTimers(false);
  tests.sleep = async (ms) => {
    h.clock.advance(ms);
  };
  await windowsOpen(h.ctx.db);
  // The app's clock at the next 10:00 Paris (never behind the database's): the tests' hours stay out of the forbidden
  // windows whatever the hour they run at; the window cases move into the night on purpose.
  h.clock.set(tenInParis(new Date()));
  // The purger: an ADMIN whose second factor is enrolled (no enrolment row of the last 24 h: the step-up's 24-hour rule).
  const id = randomUUID();
  const addr = `purger.${id.slice(0, 8)}@example.com`;
  const secret = generateTotpSecret();
  await h.ctx.db
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
  const purge = h.ctx.services.testPurge;
  purge.sleep = async () => undefined;
  return { h, f, db: h.ctx.db, tests, purge, purger: { id, addr, key: base32Decode(secret) } };
}

/** The code of the next time step (30 s later), never used before. */
function code(w: World): string {
  w.h.clock.advance(30 * SECOND);
  return totp(w.purger.key, w.h.clock.now().getTime());
}

/** Signed in with the password and a code: the session the step-up needs. */
async function asker(w: World): Promise<PurgeAsker> {
  const { session } = await w.h.ctx.services.auth.adminLogin({ email: w.purger.addr, password: PASSWORD, totp: code(w) }, {});
  return { actor: { type: 'admin', id: w.purger.id }, token: session.token };
}

async function purgeRun(w: World, runId: string, totpCode?: string) {
  const a = await asker(w);
  return w.purge.request(runId, { phrase: purgePhrase(runId), totp: totpCode ?? code(w) }, a);
}

/** A press: the tiers, everything else by default unless given. */
const press = (dropId: string, tiers: Partial<TestRunSettingsInput['tiers']>, more: Omit<TestRunSettingsInput, 'tiers'> = {}) => ({
  phrase: testPhrase(dropId),
  tiers: { none: 0, titane: 0, platine: 0, palladium: 0, ...tiers },
  arrival: { mode: 'all' as const, interestPct: 0 },
  ...more,
});

/** The runner, `ms` of the server's clock in steps (the LIVE engine's pass with each when `live` is given). */
async function drive(w: World, ms: number, step = 500, live?: string): Promise<void> {
  for (let t = 0; ; t += step) {
    if (live) await w.h.ctx.services.live.advance(live);
    for (let pass = 0; pass < 2; pass++) {
      await w.tests.tick();
      await w.tests.settle();
    }
    if (t >= ms) break;
    w.h.clock.advance(step);
  }
}

interface Run {
  id: string;
  drop: string;
  accounts: string[];
}

const accountsOf = async (w: World, runId: string) => (await w.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', runId).orderBy('account_id').execute()).map((r) => r.account_id);

/** A test of a draw OPEN now, ENDED: the bots enter and confirm their places; drawn by the staff, or cancelled when not `drawn`. */
async function drawRun(w: World, o: { titane: number; drawn: boolean; quantity?: number; title?: string }): Promise<Run> {
  const now = w.h.clock.now().getTime();
  const drop = (
    await poolDraw(
      w.h.ctx.services.drops,
      w.db,
      { modelId: w.f.modelId, title: o.title ?? 'MONOLITHE · TEST DRAW', quantity: o.quantity ?? o.titane, opensAt: new Date(now - HOUR), closesAt: new Date(now + 5 * MINUTE), earlyAccessHours: 0 },
      w.f.admin,
    )
  ).id;
  const started = await w.tests.start(drop, press(drop, { titane: o.titane }, { behaviour: { confirmPct: 100 } }), w.f.admin);
  await drive(w, 0);
  const run: Run = { id: started.id, drop, accounts: await accountsOf(w, started.id) };
  if (o.drawn) {
    w.h.clock.advance(6 * MINUTE);
    await w.h.ctx.services.drops.draw(drop, w.f.admin);
    await w.tests.sweep();
    w.h.clock.advance(61 * SECOND);
    await w.tests.sweep();
  }
  expect((await w.tests.end(started.id, testPhrase(drop, true), w.f.admin)).status).toBe('ENDED');
  if (!o.drawn) await w.h.ctx.services.drops.cancel(drop, w.f.admin);
  w.h.clock.advance(MINUTE);
  return run;
}

/** The loop's passes until `until` answers (DONE by default), each outcome kept. */
async function passes(w: World, until: (p: PurgePass) => boolean = (p) => p === 'done', svc: TestPurgeService = w.purge): Promise<PurgePass[]> {
  const out: PurgePass[] = [];
  for (let i = 0; i < 2000; i++) {
    const p = await svc.pass();
    out.push(p);
    if (until(p)) return out;
    if (p === 'idle') throw new Error(`the loop went idle: ${out.join(' ')}`);
  }
  throw new Error('the loop never ended');
}

const runRow = (w: World, id: string) =>
  w.db.selectFrom('test_runs').select(['purge_state', 'purge_reason', 'purge_summary', 'purge_step_up_id', 'purge_requested_at', 'purge_windows', 'purge_result', 'purged_at']).where('id', '=', id).executeTakeFirstOrThrow();

const auditOf = (w: World, action: string, targetId?: string) =>
  w.db
    .selectFrom('audit_logs')
    .select(['id', 'actor_type', 'actor_id', 'details', 'target_id'])
    .where('action', '=', action)
    .$if(targetId !== undefined, (q) => q.where('target_id', '=', targetId!))
    .orderBy('id')
    .execute();

/**
 * The run's accounts another test still holds (a press takes the pool's accounts of ended tests, so tests share them):
 * the purge keeps those whole; every other one goes.
 */
const heldElsewhere = async (w: World, run: Run) =>
  (await w.db.selectFrom('test_run_entrants').select('account_id').distinct().where('run_id', '<>', run.id).where('account_id', 'in', run.accounts).execute()).map((r) => r.account_id).sort();

const existing = async (w: World, ids: readonly string[]) =>
  ids.length === 0 ? [] : (await w.db.selectFrom('accounts').select('id').where('id', 'in', [...ids]).execute()).map((r) => r.id).sort();

async function refusal(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof DomainError)) throw new Error(`expected a DomainError, got ${String((e as Error)?.message ?? e)}`);
  return e;
}

async function refused(p: Promise<unknown>, codeWanted: string, status: number): Promise<DomainError> {
  const e = await refusal(p);
  expect({ code: e.code, status: e.httpStatus }, e.message).toEqual({ code: codeWanted, status });
  return e;
}

/** The answer of a call as the console sees it: its error code, or OK. */
async function answer(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof DomainError ? e.code : `THROWN ${(e as Error).message}`;
  }
}

/** A drawn draw's entry a real collector holds, crafted in the database (as a change no route makes after the draw). */
async function realEntry(w: World, dropId: string, status: 'WAITLISTED' | 'SELECTED'): Promise<{ account: string; entry: string }> {
  const real = await createAccount(w.db);
  const e = await w.db
    .insertInto('drop_entries')
    .values({ drop_id: dropId, account_id: real.id, status, created_at: new Date(Date.now() - HOUR), tier: 0, seniority: 0, rank: 99 })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { account: real.id, entry: e.id };
}

/** The first 10:00 Paris at or after `from`. */
function tenInParis(from: Date): Date {
  const start = Math.ceil(from.getTime() / MINUTE) * MINUTE;
  for (let t = start; t < start + 2 * 24 * HOUR; t += MINUTE) if (parisClock(new Date(t)) === '10:00') return new Date(t);
  throw new Error('no 10:00 in two days');
}

/** The first minute, from `from`, at least 15 minutes into the next night window, on the manual clock. */
function intoTheNight(from: Date): Date {
  for (let t = from.getTime(); t < from.getTime() + 3 * 24 * HOUR; t += MINUTE) {
    const w = maintenanceWindow(new Date(t));
    if (w?.kind === 'NIGHT' && t - w.startsAt.getTime() >= 15 * MINUTE) return new Date(t);
  }
  throw new Error('no night in three days');
}

// ═════════════════════════════════════════════════════════════════════════════

describe('one test\'s purge: the request, the batches, DONE; the staff\'s guard; the pauses and their reasons', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  it('refuses without a step-up or before it; then PURGING with its figures stored once, bounded calls, DONE with its result; OFFER NEXT refused while PURGING and answering as today once DONE', async () => {
    const run = await drawRun(w, { titane: 3, drawn: true });
    const before = await w.tests.view(run.id);
    expect(before.purge).toBeNull();
    expect(before.purgeable).toBe(true);
    const asToday = await answer(w.h.ctx.services.drops.offerNext(run.drop, w.f.admin));
    expect(asToday).toBe('DROP_WAITLIST_EMPTY');
    const lapsed = (await w.db.selectFrom('drop_entries').select('id').where('drop_id', '=', run.drop).executeTakeFirstOrThrow()).id;
    const confirmToday = await answer(w.h.ctx.services.drops.confirm(run.drop, lapsed, null, w.f.admin));

    // Refused before the step-up: the phrase; an unknown run; nothing written, no code used.
    const a = await asker(w);
    await refused(w.purge.request(run.id, { phrase: 'PURGE TEST', totp: code(w) }, a), 'VALIDATION_FAILED', 400);
    await refused(w.purge.request(randomUUID(), { phrase: 'PURGE TEST', totp: code(w) }, a), 'TEST_RUN_NOT_FOUND', 404);
    await refused(w.purge.request(run.id, { phrase: purgePhrase(run.id), totp: code(w) }, { ...a, actor: { type: 'account', id: run.accounts[0]! } }), 'FORBIDDEN', 403);
    // A wrong code: 400, counted, nothing purged.
    await refused(w.purge.request(run.id, { phrase: purgePhrase(run.id), totp: '000000' === code(w) ? '111111' : '000000' }, a), 'STEP_UP_CODE_INVALID', 400);
    expect((await runRow(w, run.id)).purge_state).toBeNull();
    expect(await auditOf(w, 'admin.step_up', w.purger.id)).toEqual([]);

    // The request: PURGING, the step-up consumed and audited, the figures stored, test_run.purge.start.
    expect(await w.purge.request(run.id, { phrase: ` purge  test ${run.id.slice(0, 8)} `, totp: code(w) }, a)).toEqual({ runId: run.id, resumed: false });
    const row = await runRow(w, run.id);
    const stepUps = await auditOf(w, 'admin.step_up', w.purger.id);
    expect(stepUps.map((s) => s.details)).toEqual([{ purpose: `test_run.purge:${run.id}` }]);
    expect({ state: row.purge_state, stepUp: Number(row.purge_step_up_id) }).toEqual({ state: 'PURGING', stepUp: Number(stepUps[0]!.id) });
    const summary = row.purge_summary as Record<string, unknown>;
    expect(summary).toMatchObject({ all: false, drawn: true, planned: { accounts: 3, entries: 3 }, blockingOrders: 0 });
    expect(JSON.parse(JSON.stringify(summary.byTier))).toEqual(JSON.parse(JSON.stringify(before.byTier)));
    const start = await auditOf(w, 'test_run.purge.start', run.id);
    expect(start).toHaveLength(1);
    expect(start[0]!.details).toMatchObject({ dropId: run.drop, drawn: true, planned: { accounts: 3 } });

    // A second request while it is under way: 409 PURGE_IN_PROGRESS before any code is read.
    await refused(purgeRun(w, run.id), 'PURGE_IN_PROGRESS', 409);
    expect(await auditOf(w, 'admin.step_up', w.purger.id)).toHaveLength(1);

    // The staff's draw actions on the release refuse while it is PURGING (under the release's row lock).
    expect(await answer(w.h.ctx.services.drops.offerNext(run.drop, w.f.admin))).toBe('RELEASE_BEING_PURGED');
    expect(await answer(w.h.ctx.services.drops.confirm(run.drop, lapsed, null, w.f.admin))).toBe('RELEASE_BEING_PURGED');
    expect(await answer(w.h.ctx.services.drops.lapse(run.drop, lapsed, null, w.f.admin))).toBe('RELEASE_BEING_PURGED');

    // The view reads the stored figures while the rows go; purge and purgeable say where it stands.
    const during = await w.tests.view(run.id);
    expect(during.byTier).toEqual(JSON.parse(JSON.stringify(before.byTier)));
    expect(during.purge).toMatchObject({ state: 'PURGING', reason: null, requestedBy: w.purger.addr, all: false, deleted: null });
    expect(during.purgeable).toMatchObject({ reason: 'PURGE_IN_PROGRESS' });

    // The loop: bounded calls (20 rows, 2 accounts a call), one after the other, then DONE.
    w.purge.batchRows = 20;
    try {
      const out = await passes(w);
      expect(out.filter((p) => p === 'called').length).toBeGreaterThan(3);
    } finally {
      w.purge.batchRows = 500;
    }
    const after = await runRow(w, run.id);
    expect(after.purge_state).toBe('DONE');
    expect(after.purged_at).not.toBeNull();
    expect(after.purge_summary).toEqual(row.purge_summary);
    expect(Number(after.purge_step_up_id)).toBe(Number(row.purge_step_up_id));
    const result = after.purge_result as { deleted: Record<string, number>; kept: Record<string, number> };
    expect(result.deleted).toMatchObject({ drop_entries: 3, test_run_entrants: 3, test_entrants: 3, accounts: 3 });
    expect(result.kept).toMatchObject({ accounts: 0 });
    const done = await auditOf(w, 'test_run.purge.done', run.id);
    expect(done).toHaveLength(1);
    expect(done[0]!.details).toEqual(result);
    expect(await existing(w, run.accounts)).toEqual([]);
    const chain = await w.h.ctx.audit.verifyChain({ batchSize: 97 });
    expect(chain.ok, JSON.stringify(chain)).toBe(true);
    expect(chain.purged ?? 0).toBeGreaterThan(0);

    // Once DONE: the staff's actions answer as today; a new request 409 PURGE_DONE; the view as purged.
    expect(await answer(w.h.ctx.services.drops.offerNext(run.drop, w.f.admin))).toBe(asToday);
    expect(await answer(w.h.ctx.services.drops.confirm(run.drop, lapsed, null, w.f.admin))).toBe(confirmToday === 'DROP_ENTRY_NOT_SELECTED' ? 'DROP_ENTRY_NOT_FOUND' : confirmToday);
    await refused(purgeRun(w, run.id), 'PURGE_DONE', 409);
    const view = await w.tests.view(run.id);
    expect(view.purge).toMatchObject({ state: 'DONE', deleted: result.deleted, purgedAt: after.purged_at });
    expect(view.purgeable).toMatchObject({ reason: 'PURGE_DONE' });
    expect(view.byTier).toEqual(JSON.parse(JSON.stringify(before.byTier)));
    const listed = (await w.tests.list(run.drop))[0]!;
    expect(listed.purge?.state).toBe('DONE');
    expect(await w.purge.pass()).toBe('idle');
  });

  it('pauses in a forbidden window and while a test runs (audited once per pause, the guard held), resumes by itself after each', async () => {
    const run = await drawRun(w, { titane: 2, drawn: true });
    await purgeRun(w, run.id);
    // The night: PAUSED PURGE_WINDOW, its end in Paris words; a second pass changes nothing.
    w.h.clock.set(intoTheNight(w.h.clock.now()));
    expect(await w.purge.pass()).toBe('paused');
    expect(await w.purge.pass()).toBe('paused');
    let row = await runRow(w, run.id);
    expect({ state: row.purge_state, reason: row.purge_reason }).toEqual({ state: 'PAUSED', reason: 'PURGE_WINDOW' });
    const pauses = await auditOf(w, 'test_run.purge.pause', run.id);
    expect(pauses.map((p) => p.details)).toEqual([{ reason: 'PURGE_WINDOW' }]);
    expect(pauses[0]).toMatchObject({ actor_type: 'system', actor_id: 'test-purge' });
    const view = await w.tests.view(run.id);
    expect(view.purge?.message).toBe(pauseWords('PURGE_WINDOW', w.h.clock.now()));
    expect(view.purge?.message).toMatch(/^Paused for the night maintenance until \d\d:\d\d Paris\.$/);
    expect(await answer(w.h.ctx.services.drops.offerNext(run.drop, w.f.admin))).toBe('RELEASE_BEING_PURGED');
    // A request inside the window: 409 with the window's words, before the step-up.
    const inWindow = await refused(purgeRun(w, run.id), 'PURGE_WINDOW', 409);
    expect(inWindow.message).toMatch(/Paris/);
    // After the window: the next call goes through, PURGING again.
    const end = maintenanceWindow(w.h.clock.now())!.endsAt;
    w.h.clock.set(new Date(end.getTime() + 2 * MINUTE));
    expect(await w.purge.pass()).toBe('called');
    row = await runRow(w, run.id);
    expect({ state: row.purge_state, reason: row.purge_reason }).toEqual({ state: 'PURGING', reason: null });

    // A test RUNNING elsewhere: PAUSED PURGE_TEST_RUNNING; STOP it, and the purge goes on.
    const now = w.h.clock.now().getTime();
    const other = (
      await poolDraw(w.h.ctx.services.drops, w.db, { modelId: w.f.modelId, title: 'OTHER', quantity: 1, opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR), earlyAccessHours: 0 }, w.f.admin)
    ).id;
    const running = await w.tests.start(other, press(other, { titane: 1 }), w.f.admin);
    expect(await w.purge.pass()).toBe('paused');
    row = await runRow(w, run.id);
    expect(row.purge_reason).toBe('PURGE_TEST_RUNNING');
    expect((await auditOf(w, 'test_run.purge.pause', run.id)).map((p) => (p.details as { reason: string }).reason)).toEqual(['PURGE_WINDOW', 'PURGE_TEST_RUNNING']);
    expect((await w.tests.view(run.id)).purge?.message).toBe(pauseWords('PURGE_TEST_RUNNING', w.h.clock.now()));
    await w.tests.stop(running.id, w.f.admin);
    await passes(w);
    expect((await runRow(w, run.id)).purge_state).toBe('DONE');
    // The account the other test took from the pool meanwhile is still in a test: kept whole; the others are gone.
    const taken = await accountsOf(w, running.id);
    expect(await existing(w, run.accounts)).toEqual(run.accounts.filter((x) => taken.includes(x)).sort());
    expect(await auditOf(w, 'test_run.purge.pause', run.id)).toHaveLength(2);
    // The stopped test ended (one test at a time; the pool sweep waits for every test to end).
    await w.tests.end(running.id, testPhrase(other, true), w.f.admin);
  });

  it('a PAUSED purge\'s reason follows the hold: the window over while a test runs, then a window while it still runs (each change audited once, its own words)', async () => {
    const run = await drawRun(w, { titane: 2, drawn: true });
    await purgeRun(w, run.id);
    const now = w.h.clock.now().getTime();
    const other = (
      await poolDraw(w.h.ctx.services.drops, w.db, { modelId: w.f.modelId, title: 'HELD', quantity: 1, opensAt: new Date(now - HOUR), closesAt: new Date(now + 3 * 24 * HOUR), earlyAccessHours: 0 }, w.f.admin)
    ).id;
    const running = await w.tests.start(other, press(other, { titane: 1 }), w.f.admin);
    const reasons = async () => (await auditOf(w, 'test_run.purge.pause', run.id)).map((p) => (p.details as { reason: string }).reason);
    // The night, the test running too: the window holds first.
    w.h.clock.set(intoTheNight(w.h.clock.now()));
    expect(await w.purge.pass()).toBe('paused');
    expect((await runRow(w, run.id)).purge_reason).toBe('PURGE_WINDOW');
    // The night over, the test still running: PURGE_TEST_RUNNING, its words, a second pause row; a second pass adds none.
    w.h.clock.set(new Date(maintenanceWindow(w.h.clock.now())!.endsAt.getTime() + 2 * MINUTE));
    expect(await w.purge.pass()).toBe('paused');
    expect(await w.purge.pass()).toBe('paused');
    let row = await runRow(w, run.id);
    expect({ state: row.purge_state, reason: row.purge_reason }).toEqual({ state: 'PAUSED', reason: 'PURGE_TEST_RUNNING' });
    expect((await w.tests.view(run.id)).purge?.message).toBe(pauseWords('PURGE_TEST_RUNNING', w.h.clock.now()));
    expect(await reasons()).toEqual(['PURGE_WINDOW', 'PURGE_TEST_RUNNING']);
    // The next night, the test still running: PURGE_WINDOW again with the night's words; the test stopped inside it changes nothing.
    w.h.clock.set(intoTheNight(w.h.clock.now()));
    expect(await w.purge.pass()).toBe('paused');
    row = await runRow(w, run.id);
    expect({ state: row.purge_state, reason: row.purge_reason }).toEqual({ state: 'PAUSED', reason: 'PURGE_WINDOW' });
    expect((await w.tests.view(run.id)).purge?.message).toMatch(/^Paused for the night maintenance until \d\d:\d\d Paris\.$/);
    await w.tests.stop(running.id, w.f.admin);
    expect(await w.purge.pass()).toBe('paused');
    expect(await reasons()).toEqual(['PURGE_WINDOW', 'PURGE_TEST_RUNNING', 'PURGE_WINDOW']);
    // The night over: the purge goes on to DONE.
    w.h.clock.set(new Date(maintenanceWindow(w.h.clock.now())!.endsAt.getTime() + 2 * MINUTE));
    await passes(w);
    expect((await runRow(w, run.id)).purge_state).toBe('DONE');
    await w.tests.end(running.id, testPhrase(other, true), w.f.admin);
    w.h.clock.set(tenInParis(w.h.clock.now()));
  });

  it('a statement timeout (57014) is tried again with its waits and pauses PURGE_STUCK at the 5th; the staff\'s actions answer as today; a new request resumes it to DONE, its summary and step-up unchanged, one test_run.purge.resume', async () => {
    const run = await drawRun(w, { titane: 2, drawn: true });
    const lapsed = (await w.db.selectFrom('drop_entries').select('id').where('drop_id', '=', run.drop).executeTakeFirstOrThrow()).id;
    const offerToday = await answer(w.h.ctx.services.drops.offerNext(run.drop, w.f.admin));
    const confirmToday = await answer(w.h.ctx.services.drops.confirm(run.drop, lapsed, null, w.f.admin));
    await purgeRun(w, run.id);
    const asked = await runRow(w, run.id);
    await failWith(w.db, '57014');
    try {
      const seen: PurgePass[] = [];
      for (let i = 0; i < 4; i++) {
        seen.push(await w.purge.pass());
        // Not before its wait.
        expect(await w.purge.pass()).toBe('waiting');
        w.h.clock.advance(PURGE_RETRY_MS[i]!);
      }
      seen.push(await w.purge.pass());
      expect(seen).toEqual(['retry', 'retry', 'retry', 'retry', 'paused']);
    } finally {
      await windowsOpen(w.db);
    }
    const row = await runRow(w, run.id);
    expect({ state: row.purge_state, reason: row.purge_reason }).toEqual({ state: 'PAUSED', reason: 'PURGE_STUCK_57014' });
    expect((await auditOf(w, 'test_run.purge.pause', run.id)).map((p) => p.details)).toEqual([{ reason: 'PURGE_STUCK_57014', sqlstate: '57014', name: 'query_canceled' }]);
    expect((await w.tests.view(run.id)).purge?.message).toBe('Stopped: the database refused a step (query_canceled). Nothing more is deleted until it is asked again.');
    // Paused for good: the loop leaves it, the guard is lifted.
    expect(await w.purge.pass()).toBe('idle');
    expect(await answer(w.h.ctx.services.drops.offerNext(run.drop, w.f.admin))).toBe(offerToday);
    expect(await answer(w.h.ctx.services.drops.confirm(run.drop, lapsed, null, w.f.admin))).toBe(confirmToday);
    expect((await w.tests.view(run.id)).purgeable).toBe(true);

    // A new request (a step-up again) resumes it.
    expect(await purgeRun(w, run.id)).toEqual({ runId: run.id, resumed: true });
    const resumed = await runRow(w, run.id);
    expect({ state: resumed.purge_state, reason: resumed.purge_reason }).toEqual({ state: 'PURGING', reason: null });
    const resumes = await auditOf(w, 'test_run.purge.resume', run.id);
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.details).toMatchObject({ reason: 'PURGE_STUCK_57014', via: 'request' });
    expect((await auditOf(w, 'admin.step_up', w.purger.id)).at(-1)!.details).toEqual({ purpose: `test_run.purge:${run.id}` });
    await passes(w);
    const done = await runRow(w, run.id);
    expect(done.purge_state).toBe('DONE');
    expect(done.purge_summary).toEqual(asked.purge_summary);
    expect(Number(done.purge_step_up_id)).toBe(Number(asked.purge_step_up_id));
    expect(done.purge_requested_at).toEqual(asked.purge_requested_at);
    expect(await auditOf(w, 'test_run.purge.resume', run.id)).toHaveLength(1);
    expect(await existing(w, run.accounts)).toEqual(await heldElsewhere(w, run));
  });

  it('any other SQLSTATE (23503) pauses at once with its name, never tried again', async () => {
    const run = await drawRun(w, { titane: 1, drawn: true });
    await purgeRun(w, run.id);
    await failWith(w.db, '23503');
    try {
      expect(await w.purge.pass()).toBe('paused');
    } finally {
      await windowsOpen(w.db);
    }
    const row = await runRow(w, run.id);
    expect({ state: row.purge_state, reason: row.purge_reason }).toEqual({ state: 'PAUSED', reason: 'SQLSTATE_23503' });
    expect((await auditOf(w, 'test_run.purge.pause', run.id)).map((p) => p.details)).toEqual([{ reason: 'SQLSTATE_23503', sqlstate: '23503', name: 'foreign_key_violation' }]);
    expect(await w.purge.pass()).toBe('idle');
    // Resumed and finished, so the next cases start from a quiet loop.
    await purgeRun(w, run.id);
    await passes(w);
    expect((await runRow(w, run.id)).purge_state).toBe('DONE');
  });

  it('the views: a stale device entry of an account the first step-10 call deletes, then a flush before DONE, writes the real views; after DONE as well', async () => {
    const tracking = w.h.ctx.services.tracking;
    const devices = (tracking as unknown as { devices: Map<string, { accountId: string | null; linkedAt: Date | null; previousLinkedAt?: Date | null }> }).devices;
    const real = await createAccount(w.db);
    const meta = (hash: string, account: { id: string; email: string } | null = null): SeenMeta => ({
      deviceHash: hash,
      account,
      staff: false,
      ip: '198.51.100.7',
      userAgent: IPHONE,
      headers: {},
      place: null,
      now: w.h.clock.now(),
    });
    const seen = (ago: number): SeenBatch => ({ v: 1, d: { s: false, t: 5, w: 390 }, e: [{ p: 'NOW', ms: 3_000, ago }] });
    const hash = (c: string) => c.repeat(43);
    /** A device of this process's cache made stale: linked (in memory only) to `account`, its late views then named after it. */
    const stale = async (h: string, account: string) => {
      expect(await tracking.ingest(seen(0), meta(h))).toEqual({ recorded: 1 });
      const entry = devices.get(h)!;
      Object.assign(entry, { accountId: account, linkedAt: w.h.clock.now(), previousLinkedAt: null });
      expect(await tracking.ingest(seen(MINUTE), meta(h))).toEqual({ recorded: 1 });
    };
    const named = async (ids: readonly string[]) => Number((await w.db.selectFrom('collector_views').select((eb) => eb.fn.countAll<number>().as('n')).where('account_id', 'in', [...ids]).executeTakeFirstOrThrow()).n);

    const run = await drawRun(w, { titane: 4, drawn: true });
    await tracking.flushNow();
    await purgeRun(w, run.id);
    w.purge.batchRows = 10;
    // The first two accounts step 10 deletes (in id order; one another test still holds is kept, so passed over).
    const shared = await heldElsewhere(w, run);
    const [first, second] = run.accounts.filter((x) => !shared.includes(x)) as [string, string];
    expect(second).toBeDefined();
    const realOne = { id: real.id, email: real.email };
    try {
      // Steps 1 to 9: until the run's windows are written and its test_run_entrants gone.
      for (let i = 0; ; i++) {
        expect(i).toBeLessThan(200);
        expect(await w.purge.pass()).toBe('called');
        const row = await runRow(w, run.id);
        const left = await w.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', run.id).execute();
        if (row.purge_windows !== null && left.length === 0) break;
      }
      // The pass of the first step-10 call writes the views first; right after that write (inside the same pass, before
      // the call), a device of the cache goes stale on `first` and names it in a late view, among a real collector's views.
      const realFlush = tracking.flushNow.bind(tracking);
      let flushes = 0;
      tracking.flushNow = async () => {
        const r = await realFlush();
        flushes += 1;
        // The real collector's device first: its sign-in link writes the buffer itself (TrackingService.link).
        expect(await tracking.ingest(seen(0), meta(hash('r'), realOne))).toEqual({ recorded: 1 });
        await stale(hash('a'), first);
        return r;
      };
      try {
        expect(await w.purge.pass()).toBe('called');
      } finally {
        tracking.flushNow = realFlush;
      }
      expect(flushes).toBe(1);
      expect(await existing(w, [first, second])).toEqual([second]);
      // Forgotten by the call that deleted it: the device's entry and the buffered row's account.
      expect(devices.has(hash('a'))).toBe(false);
      expect(tracking.buffer.peek().some((r) => r.accountId === first)).toBe(false);
      // A view of that device now reads its row again (no account), and the flush writes every row.
      expect(await tracking.ingest(seen(MINUTE), meta(hash('a')))).toEqual({ recorded: 1 });
      const flushed = await tracking.buffer.flush();
      expect(flushed).toMatchObject({ failed: false });
      expect(flushed.written).toBeGreaterThanOrEqual(4);
      expect(await named([real.id])).toBeGreaterThanOrEqual(1);
      expect(await named([first])).toBe(0);

      // The next call deletes `second`; a device goes stale on it afterwards: DONE forgets it once more.
      expect(await w.purge.pass()).toBe('called');
      expect(await existing(w, [second])).toEqual([]);
      expect(await tracking.ingest(seen(0), meta(hash('r'), realOne))).toEqual({ recorded: 1 });
      await stale(hash('b'), second);
      expect(tracking.buffer.peek().some((r) => r.accountId === second)).toBe(true);
      await passes(w);
    } finally {
      w.purge.batchRows = 500;
    }
    expect((await runRow(w, run.id)).purge_state).toBe('DONE');
    expect(devices.has(hash('b'))).toBe(false);
    expect(tracking.buffer.peek().some((r) => r.accountId === second)).toBe(false);
    const after = await tracking.buffer.flush();
    expect(after).toMatchObject({ failed: false });
    expect(after.written).toBeGreaterThanOrEqual(3);
    expect(await named(run.accounts)).toBe(0);
    expect(await named([real.id])).toBeGreaterThanOrEqual(2);
    expect(await existing(w, run.accounts)).toEqual(shared);
  });

  it('boot: the tests left PURGING or PAUSED for a window go on in a new process; one paused for good stays', async () => {
    const a = await drawRun(w, { titane: 1, drawn: true, title: 'BOOT A' });
    const b = await drawRun(w, { titane: 1, drawn: true, title: 'BOOT B' });
    const c = await drawRun(w, { titane: 1, drawn: true, title: 'BOOT C' });
    // c paused for good, b paused for a window, a PURGING: as a process leaves them when it stops.
    await purgeRun(w, c.id);
    await failWith(w.db, '23503');
    try {
      expect(await w.purge.pass()).toBe('paused');
    } finally {
      await windowsOpen(w.db);
    }
    await purgeRun(w, b.id);
    const awake = w.h.clock.now();
    w.h.clock.set(intoTheNight(awake));
    expect(await w.purge.pass()).toBe('paused');
    expect((await runRow(w, b.id)).purge_reason).toBe('PURGE_WINDOW');
    w.h.clock.set(new Date(maintenanceWindow(w.h.clock.now())!.endsAt.getTime() + 2 * MINUTE));
    await purgeRun(w, a.id);
    await w.purge.stop();

    // The next process.
    const ctx = w.h.ctx;
    const next = new TestPurgeService({
      db: ctx.db,
      audit: ctx.audit,
      auth: ctx.services.auth,
      clock: ctx.clock,
      testEntrantAccounts: { invalidate: () => undefined },
      tracking: ctx.services.tracking,
      liveFrames: ctx.services.live.frames,
    });
    next.sleep = async () => undefined;
    const booted = await next.boot();
    expect(booted).toEqual({ runs: [a.id, b.id].sort(), sweep: false });
    await passes(w, (p) => p === 'done', next);
    await passes(w, (p) => p === 'done', next);
    expect(await next.pass()).toBe('idle');
    for (const r of [a, b]) {
      const row = await runRow(w, r.id);
      expect(row.purge_state).toBe('DONE');
      expect(row.purge_result).toMatchObject({ countedFromRestart: true });
      expect(await existing(w, r.accounts)).toEqual(await heldElsewhere(w, r));
    }
    expect((await runRow(w, c.id)).purge_reason).toBe('SQLSTATE_23503');
    await next.stop();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('PURGE ALL: a test paused for good does not stop it; its sweep is authorized by the chain alone', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  const poolBatch = async () => (await sql<{ r: { phase: string } }>`SELECT orbes_purge_test_pool_batch(500) AS r`.execute(w.db)).rows[0]!.r;

  it('PURGE ALL while a test is PAUSED PURGE_NOT_TEST succeeds; OFFER NEXT and Confirm answer as today on that release; a forged summary or request time opens no sweep, the PURGE ALL step-up does', async () => {
    // B: an ended test of two bots; A: four bots after it (two of B's, two new), on a drawn draw.
    const b = await drawRun(w, { titane: 2, drawn: true, title: 'B' });
    const a = await drawRun(w, { titane: 4, drawn: true, title: 'A' });
    const onlyA = a.accounts.filter((x) => !b.accounts.includes(x));
    expect(onlyA.length).toBe(2);
    // C: one more ended test, which PURGE ALL will purge.
    const c = await drawRun(w, { titane: 1, drawn: true, title: 'C' });

    // A's purge, up to its windows; then a real collector's entry appears in its drawn draw: PAUSED PURGE_NOT_TEST.
    await purgeRun(w, a.id);
    for (let i = 0; ; i++) {
      expect(i).toBeLessThan(200);
      expect(await w.purge.pass()).toBe('called');
      if ((await runRow(w, a.id)).purge_windows !== null && (await accountsOf(w, a.id)).length === 0) break;
    }
    const real = await realEntry(w, a.drop, 'WAITLISTED');
    expect(await w.purge.pass()).toBe('paused');
    const paused = await runRow(w, a.id);
    expect({ state: paused.purge_state, reason: paused.purge_reason }).toEqual({ state: 'PAUSED', reason: 'PURGE_NOT_TEST' });
    expect((await w.tests.view(a.id)).purge?.message).toBe('A real collector’s entry is now in this drawn draw: the purge stopped here.');
    expect((await w.tests.view(a.id)).purgeable).toMatchObject({ reason: 'PURGE_NOT_TEST' });
    await refused(purgeRun(w, a.id), 'PURGE_NOT_TEST', 409);
    // The guard is lifted: the staff offer the real collector a place and confirm it, as today.
    const offered = await w.h.ctx.services.drops.offerNext(a.drop, w.f.admin);
    expect(offered.id).toBe(real.entry);
    expect(offered.status).toBe('SELECTED');
    expect((await w.h.ctx.services.drops.confirm(a.drop, real.entry, null, w.f.admin)).status).toBe('CONFIRMED');
    expect(await w.purge.pass()).toBe('idle');

    // B requested by a forged hand: its summary says `all` and its request time is set, in a step-up of B alone.
    await inTransaction(w.db, async (tx) => {
      await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', w.purger.id).execute();
      await w.h.ctx.audit.record({ actor: { type: 'admin', id: w.purger.id }, action: 'admin.step_up', targetType: 'admin', targetId: w.purger.id, details: { purpose: `test_run.purge:${b.id}` } }, tx);
      await tx
        .updateTable('test_runs')
        .set({ purge_state: 'PURGING', purge_requested_at: w.h.clock.now(), purge_requested_by: w.purger.id, purge_summary: jsonText({ all: true }) })
        .where('id', '=', b.id)
        .execute();
    });
    await passes(w);
    expect((await runRow(w, b.id)).purge_state).toBe('DONE');
    // No sweep: the database finds no PURGE ALL step-up; a new process finds none to go on with.
    await expect(poolBatch()).rejects.toSatisfy((e) => purgeRefusal(e) === 'PURGE_ALL_NOT_REQUESTED');
    const fresh = new TestPurgeService({
      db: w.db,
      audit: w.h.ctx.audit,
      auth: w.h.ctx.services.auth,
      clock: w.h.ctx.clock,
      testEntrantAccounts: { invalidate: () => undefined },
      tracking: w.h.ctx.services.tracking,
      liveFrames: w.h.ctx.services.live.frames,
    });
    expect(await fresh.boot()).toEqual({ runs: [], sweep: false });
    expect(await w.purge.pass()).toBe('idle');
    expect(await existing(w, onlyA)).toEqual([...onlyA].sort());

    // PURGE ALL: A skipped (PURGE_NOT_TEST), C purged; then the sweep, which A paused for good does not hold back.
    const asking = await asker(w);
    const all = await w.purge.requestAll({ phrase: 'purge all tests', totp: code(w) }, asking);
    expect(all).toMatchObject({ runs: [c.id], resumed: [], skipped: [{ runId: a.id, reason: 'PURGE_NOT_TEST' }] });
    expect((await runRow(w, c.id)).purge_summary).toMatchObject({ all: true });
    const started = await auditOf(w, 'test_run.purge_all.start', w.purger.id);
    expect(started.map((s) => s.details)).toEqual([{ runs: [c.id], resumed: [], skipped: [{ runId: a.id, reason: 'PURGE_NOT_TEST' }] }]);
    expect((await auditOf(w, 'admin.step_up', w.purger.id)).at(-1)!.details).toEqual({ purpose: 'test_run.purge_all' });
    expect(await fresh.boot()).toEqual({ runs: [c.id], sweep: true });
    await passes(w);
    expect((await runRow(w, c.id)).purge_state).toBe('DONE');
    await passes(w);
    const swept = await auditOf(w, 'test_run.purge_all.done', w.purger.id);
    expect(swept).toHaveLength(1);
    // C's one bot came from the pool (maybe one of A's own): what the sweep deleted is A's accounts no test holds.
    expect((swept[0]!.details as { deleted: Record<string, number> }).deleted.accounts).toBeGreaterThanOrEqual(1);
    expect(await existing(w, onlyA)).toEqual([]);
    expect(await w.purge.pass()).toBe('idle');
    expect((await runRow(w, a.id)).purge_reason).toBe('PURGE_NOT_TEST');
    expect((await w.h.ctx.audit.verifyChain({ batchSize: 97 })).ok).toBe(true);
    // A second PURGE ALL with nothing left: answers, sweeps nothing more.
    const again = await asker(w);
    expect(await w.purge.requestAll({ phrase: PURGE_ALL_PHRASE, totp: code(w) }, again)).toMatchObject({ runs: [], resumed: [] });
    await passes(w);
    expect(await auditOf(w, 'test_run.purge_all.done', w.purger.id)).toHaveLength(2);
  });

  it('a PURGE ALL\'s sweep waits while a test is not ENDED, without a row; at its step-up\'s 24 h it stops, audited with that reason', async () => {
    const now = w.h.clock.now().getTime();
    const drop = (
      await poolDraw(w.h.ctx.services.drops, w.db, { modelId: w.f.modelId, title: 'STOPPED', quantity: 1, opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR), earlyAccessHours: 0 }, w.f.admin)
    ).id;
    const stopped = await w.tests.start(drop, press(drop, { titane: 1 }), w.f.admin);
    await w.tests.stop(stopped.id, w.f.admin);
    const pausesBefore = (await auditOf(w, 'test_run.purge_all.pause', w.purger.id)).length;
    const doneBefore = (await auditOf(w, 'test_run.purge_all.done', w.purger.id)).length;
    const asking = await asker(w);
    await w.purge.requestAll({ phrase: PURGE_ALL_PHRASE, totp: code(w) }, asking);
    expect(await w.purge.pass()).toBe('waiting');
    w.h.clock.advance(2 * SECOND);
    expect(await w.purge.pass()).toBe('waiting');
    expect(await auditOf(w, 'test_run.purge_all.pause', w.purger.id)).toHaveLength(pausesBefore);
    // 24 h later (at 10:00 Paris, out of every window): stopped, one row with what held it; then nothing more to do.
    w.h.clock.set(tenInParis(new Date(w.h.clock.now().getTime() + 24 * HOUR)));
    expect(await w.purge.pass()).toBe('paused');
    const stops = await auditOf(w, 'test_run.purge_all.pause', w.purger.id);
    expect(stops).toHaveLength(pausesBefore + 1);
    expect(stops.at(-1)).toMatchObject({ actor_type: 'system', actor_id: 'test-purge', details: { reason: 'PURGE_RUNS_NOT_ENDED' } });
    expect(await w.purge.pass()).toBe('idle');
    expect(await auditOf(w, 'test_run.purge_all.done', w.purger.id)).toHaveLength(doneBefore);
    await w.tests.end(stopped.id, testPhrase(drop, true), w.f.admin);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('a LIVE RELEASE\'s test purged: its room built again from the database', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  it('after DONE the release\'s frame is asked again (the hub drops what it cached), its readings dropped, and the public sheet and room read as END TEST left them', async () => {
    const t0 = new Date(w.h.clock.now().getTime() + HOUR);
    const release = await createLiveRelease(w.f, { opensAt: t0, sizes: [{ label: '52', stock: 2 }], perAccount: 1 });
    w.h.clock.set(new Date(t0.getTime() - 4 * MINUTE));
    const real = await createAccount(w.db);
    const run = await w.tests.start(
      release.id,
      press(release.id, { titane: 2 }, { behaviour: { payPct: 100, releasePct: 0, missPct: 0, leavePct: 0, holdSeconds: 1.5 }, choices: { size: '52', quantity: 1, addOnsPct: 0 } }),
      w.f.admin,
    );
    await drive(w, 0, 500, release.id);
    await w.h.ctx.services.live.enter(real.id, release.id, { sizeId: release.sizes[0]!.id }, real.actor);
    w.h.clock.set(t0);
    await drive(w, 20_000, 500, release.id);
    expect((await w.db.selectFrom('drops').select('ended_reason').where('id', '=', release.id).executeTakeFirstOrThrow()).ended_reason).toBe('SOLD_OUT');
    const accounts = await accountsOf(w, run.id);
    const testEntries = (await w.db.selectFrom('live_entries').select('id').where('drop_id', '=', release.id).where('account_id', 'in', accounts).execute()).map((e) => e.id);
    expect(testEntries).toHaveLength(2);
    expect((await w.tests.end(run.id, testPhrase(release.id, true), w.f.admin)).status).toBe('ENDED');
    w.h.clock.advance(MINUTE);
    const frames = w.h.ctx.services.live.frames;
    for (const e of testEntries) frames.read(release.id, e, true);
    // The public sheet and room never name an entry or an account (LiveRoom: no personal data): what the purge must
    // leave of them is what END TEST left, the same figures, built again from the database.
    const sheetBefore = JSON.stringify((await w.h.client().request('GET', `/api/v1/live/${release.id}`)).json());
    const roomBefore = (await w.h.ctx.services.liveRoom.frame(release.id))!.room;
    expect(roomBefore).toMatchObject({ phase: 'ENDED', over: true, endedReason: 'SOLD_OUT', quantity: 2 });

    const asked: string[] = [];
    const hub = w.h.app.liveHub;
    const publish = hub.publishFrame.bind(hub);
    hub.publishFrame = (dropId: string) => {
      asked.push(dropId);
      return publish(dropId);
    };
    try {
      await purgeRun(w, run.id);
      await passes(w);
    } finally {
      hub.publishFrame = publish;
    }
    expect((await runRow(w, run.id)).purge_state).toBe('DONE');
    expect(asked).toContain(release.id);
    for (const e of testEntries) expect(frames.hasReadNext(release.id, e)).toBe(false);
    expect(JSON.stringify((await w.h.client().request('GET', `/api/v1/live/${release.id}`)).json())).toBe(sheetBefore);
    const frame = (await w.h.ctx.services.liveRoom.frame(release.id))!;
    expect(frame.room).toEqual(roomBefore);
    expect(frame.queue?.entries.size ?? 0).toBe(0);
    expect(await existing(w, accounts)).toEqual([]);
  });
});
