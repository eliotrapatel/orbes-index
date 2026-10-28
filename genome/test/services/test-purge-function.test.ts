/**
 * TEST PURGE (lot PURGE, step PURGE.4; plan §A.2, §A.3, the checks V2/V3): the purge's database functions,
 * `orbes_purge_test_run_batch` and `orbes_purge_test_pool_batch` (migration 0066), proven on test runs the app itself
 * made: TestEntrantService's bots on PGlite, mixed with real collectors' entries and orders. The request is written as
 * TestPurgeService writes it (PURGE.5: in ONE transaction, the step-up consumed and audited, the run set PURGING,
 * `test_run.purge.start`), DONE as its loop sets it once a batch answers ACCOUNTS_DONE.
 *
 *  - a drawn DRAW of PLATINE and other bots with their orders, GIFT orders, grants, sizes and profiles: deleted with
 *    their accounts, a staff MARK PAID order (its invoice: blocking) kept with its GIFT order, its entry and its
 *    account; batches bounded; a `windows` key in the request's summary changes nothing; DONE with the summary written
 *    once; the audit tail kept; no row anywhere names a deleted id but the release's own system rows; verifyChain OK;
 *  - an undrawn (cancelled) draw with a real collector's entry: purged, the real entry untouched;
 *  - a LIVE RELEASE with an after-room: the guests' rows of the test go (positions keep their gaps, every reader of
 *    `after_room_guests.position` still right), a LIVE order of two pieces with one blocking kept whole (no 23503);
 *  - the shared pool (H1, H10): an account of two ended tests on two releases, kept by the first purge, deleted by the
 *    second, one after the other and through PURGE ALL; R1 a draw, R2 a DRAWN draw of test entrants only;
 *  - the refusals, the test_runs guard and the pool sweep's refusals; an account takePool takes meanwhile kept;
 *  - "Test releases only" (D15, G1): a drawn draw holding a real entry, at the request, in a batch, or from between the
 *    request and the first batch;
 *  - what keeps an account (anti-disguise, G11, H11): a founding-list row, a real sign-up disguised as a test account,
 *    a run moved back in time, a real order linked to a test order, a real invitee, a real friend vault;
 *  - step 10 atomic per account against a press (an interleaved sequence and a replaced helper: PGlite has one
 *    connection, the real two-connection proofs are PURGE.13's); one step-10 batch on a 200,000-row log under the
 *    20 s statement timeout; a restore-like seed (one transaction, one xmin) bounded as the same seed row by row (H9).
 *
 * The forbidden windows are answered open here (CI runs at any hour); their own cases replace the window function.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { inTransaction, type Db } from '../../src/server/db/connection.js';
import { pgError, purgeRefusal } from '../../src/server/db/pg-errors.js';
import { jsonText } from '../../src/server/db/schema.js';
import { afterRoomDoors, afterRoomPlace } from '../../src/server/services/after-room.js';
import { accountLiveData } from '../../src/server/services/live.js';
import { testPhrase, type TestEntrantService, type TestRunSettingsInput } from '../../src/server/services/test-entrants.js';
import { createHarness, PASSWORD, type Harness } from '../api/support.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { poolDraw } from '../support/draws.js';
import { accountOfTier, createAccount, createLiveRelease, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

// ── the world: the whole app on PGlite, a manual clock, the bots driven by hand ──

interface World {
  h: Harness;
  f: LiveFixture;
  db: Db;
  tests: TestEntrantService;
  admin: { type: 'admin'; id: string };
}

const WINDOWS_OPEN = `CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`;

/** The forbidden windows' function replaced by `body` (the test owns the throwaway database as its superuser). */
const windowIs = (db: Db, body: string) => sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ ${body} $$`).execute(db);

async function world(): Promise<World> {
  const h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
  const f = await liveFixtureOn(h.ctx, h.clock);
  const tests = h.app.testEntrants;
  tests.useTimers(false);
  tests.sleep = async (ms) => {
    h.clock.advance(ms);
  };
  // CI runs at any hour: the forbidden windows answered open (their cases replace the function, then open it again).
  await sql.raw(WINDOWS_OPEN).execute(h.ctx.db);
  return { h, f, db: h.ctx.db, tests, admin: { type: 'admin', id: f.admin.id } };
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

/** A draw published now, OPEN (its opening an hour ago, its close an hour ahead) unless told otherwise. */
async function openDraw(w: World, o: { title?: string; quantity?: number; opensIn?: number; closesIn?: number; earlyAccessHours?: number; priceMinor?: number } = {}): Promise<string> {
  const now = w.h.clock.now().getTime();
  const d = await poolDraw(
    w.h.ctx.services.drops,
    w.db,
    {
      modelId: w.f.modelId,
      title: o.title ?? 'MONOLITHE · TEST DRAW',
      quantity: o.quantity ?? 10,
      opensAt: new Date(now + (o.opensIn ?? -HOUR)),
      closesAt: new Date(now + (o.closesIn ?? HOUR)),
      earlyAccessHours: o.earlyAccessHours ?? 0,
      ...(o.priceMinor !== undefined ? { priceMinor: o.priceMinor, currency: 'EUR' } : {}),
    },
    w.f.admin,
  );
  return d.id;
}

interface Run {
  id: string;
  drop: string;
  accounts: string[];
}

const accountsOf = async (w: World, runId: string) => (await w.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', runId).orderBy('account_id').execute()).map((r) => r.account_id);

/**
 * A test of a draw, ENDED: the bots enter (and confirm the places they are given by themselves); drawn by the staff
 * (`drawn`), or cancelled after END TEST (an undrawn draw is over once cancelled). `during` runs while the test is
 * DONE, before the draw (the bots' flows that write more rows, the staff's MARK PAID).
 */
async function drawRun(
  w: World,
  o: {
    tiers: Partial<TestRunSettingsInput['tiers']>;
    drawn: boolean;
    quantity?: number;
    priceMinor?: number;
    title?: string;
    behaviour?: TestRunSettingsInput['behaviour'];
    beforeDraw?: (run: Run) => Promise<void>;
    afterDraw?: (run: Run) => Promise<void>;
  },
): Promise<Run> {
  const drop = await openDraw(w, { quantity: o.quantity ?? 2, ...(o.priceMinor !== undefined ? { priceMinor: o.priceMinor } : {}), ...(o.title ? { title: o.title } : {}) });
  const started = await w.tests.start(drop, press(drop, o.tiers, { behaviour: { confirmPct: 100, ...o.behaviour } }), w.f.admin);
  await drive(w, 0);
  const run: Run = { id: started.id, drop, accounts: await accountsOf(w, started.id) };
  await o.beforeDraw?.(run);
  if (o.drawn) {
    w.h.clock.advance(2 * HOUR);
    await w.h.ctx.services.drops.draw(drop, w.f.admin);
    await w.tests.sweep();
    w.h.clock.advance(61_000);
    await w.tests.sweep();
    await o.afterDraw?.(run);
  }
  const ended = await w.tests.end(started.id, testPhrase(drop, true), w.f.admin);
  expect(ended.status).toBe('ENDED');
  if (!o.drawn) await w.h.ctx.services.drops.cancel(drop, w.f.admin);
  w.h.clock.advance(MINUTE);
  return run;
}

// ── the request, the batches, DONE: as TestPurgeService (PURGE.5) writes them ──

/** The request in ONE transaction: the admin's row updated and `admin.step_up` audited, PURGING, `test_run.purge.start`. Answers the step-up's id. */
async function request(w: World, runId: string, o: { summary?: Record<string, unknown>; purpose?: string } = {}, on: Db = w.db): Promise<number> {
  return inTransaction(on, async (tx) => {
    await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', w.admin.id).execute();
    const stepUp = await w.h.ctx.audit.record({ actor: w.admin, action: 'admin.step_up', targetType: 'admin', targetId: w.admin.id, details: { purpose: o.purpose ?? `test_run.purge:${runId}` } }, tx);
    await tx
      .updateTable('test_runs')
      .set({ purge_state: 'PURGING', purge_requested_at: w.h.clock.now(), purge_requested_by: w.admin.id, purge_summary: jsonText(o.summary ?? { all: false }) })
      .where('id', '=', runId)
      .execute();
    await w.h.ctx.audit.record({ actor: w.admin, action: 'test_run.purge.start', targetType: 'test_run', targetId: runId, details: {} }, tx);
    return stepUp.id;
  });
}

/** PURGE ALL's request: one step-up, every run named set PURGING in its transaction, `test_run.purge_all.start`. */
async function requestAll(w: World, runIds: readonly string[]): Promise<number> {
  return inTransaction(w.db, async (tx) => {
    await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', w.admin.id).execute();
    const stepUp = await w.h.ctx.audit.record({ actor: w.admin, action: 'admin.step_up', targetType: 'admin', targetId: w.admin.id, details: { purpose: 'test_run.purge_all' } }, tx);
    for (const id of runIds) {
      await tx
        .updateTable('test_runs')
        .set({ purge_state: 'PURGING', purge_requested_at: w.h.clock.now(), purge_requested_by: w.admin.id, purge_summary: jsonText({ all: true }) })
        .where('id', '=', id)
        .execute();
    }
    await w.h.ctx.audit.record({ actor: w.admin, action: 'test_run.purge_all.start', targetType: 'admin', targetId: w.admin.id, details: { runs: runIds.length, skipped: 0 } }, tx);
    return stepUp.id;
  });
}

interface Batch {
  phase: string;
  left: number;
  deleted: Record<string, number>;
  deletedAccounts: string[];
  kept: { orders?: number; entries?: number; accounts: number };
}

const batch = async (db: Db, runId: string, max = 500): Promise<Batch> => (await sql<{ r: Batch }>`SELECT orbes_purge_test_run_batch(${runId}::uuid, ${max}::int) AS r`.execute(db)).rows[0]!.r;
const poolBatch = async (db: Db, max = 500): Promise<Batch> => (await sql<{ r: Batch }>`SELECT orbes_purge_test_pool_batch(${max}::int) AS r`.execute(db)).rows[0]!.r;

interface Drained {
  last: Batch;
  calls: Batch[];
  phases: string[];
  deleted: Record<string, number>;
  deletedAccounts: string[];
}

/** The batches until ACCOUNTS_DONE (each one in its own transaction, as the loop calls it). */
async function drainBatches(db: Db, runId: string, max = 500): Promise<Drained> {
  const calls: Batch[] = [];
  const phases: string[] = [];
  const deleted: Record<string, number> = {};
  const deletedAccounts: string[] = [];
  for (let i = 0; i < 500; i++) {
    const r = await batch(db, runId, max);
    calls.push(r);
    if (phases.at(-1) !== r.phase) phases.push(r.phase);
    for (const [t, n] of Object.entries(r.deleted)) deleted[t] = (deleted[t] ?? 0) + n;
    deletedAccounts.push(...r.deletedAccounts);
    if (r.phase === 'ACCOUNTS_DONE') break;
  }
  const last = calls.at(-1)!;
  expect(last.phase, `${runId} drained`).toBe('ACCOUNTS_DONE');
  return { last, calls, phases, deleted, deletedAccounts: deletedAccounts.sort() };
}

/** DONE as the loop sets it: its time and result, `test_run.purge.done`. */
async function done(w: World, runId: string, d: Drained): Promise<void> {
  await inTransaction(w.db, async (tx) => {
    await tx
      .updateTable('test_runs')
      .set({ purge_state: 'DONE', purged_at: w.h.clock.now(), purge_result: jsonText({ deleted: d.deleted, kept: d.last.kept }) })
      .where('id', '=', runId)
      .execute();
    await w.h.ctx.audit.record({ actor: w.admin, action: 'test_run.purge.done', targetType: 'test_run', targetId: runId, details: { deleted: d.deleted, kept: d.last.kept } }, tx);
  });
}

/** The whole purge of a run: the request, its batches, DONE. */
async function purge(w: World, runId: string, max = 500): Promise<Drained> {
  await request(w, runId);
  const d = await drainBatches(w.db, runId, max);
  await done(w, runId, d);
  return d;
}

// ── reading the database ──

const refused = (p: Promise<unknown>, reason: string, label = reason) =>
  expect(p, label).rejects.toSatisfy((e) => {
    if (purgeRefusal(e) !== reason) throw new Error(`${label}: expected OR010 ${reason}, got ${pgError(e)?.code} ${(e as Error).message}`);
    return true;
  });

const count = async (db: Db, from: string): Promise<number> => Number((await sql.raw<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`).execute(db)).rows[0]!.n);

/** Every table of public (the kysely ones aside). */
async function tablesOf(db: Db): Promise<string[]> {
  return (
    await sql<{ t: string }>`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'kysely_%' ORDER BY 1`.execute(db)
  ).rows.map((r) => r.t);
}

/** Every row of every table, by table, as text (the whole database, to compare before and after). */
async function everyRow(db: Db): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const t of await tablesOf(db)) {
    out.set(t, (await sql.raw<{ r: string }>(`SELECT x::text AS r FROM public.${t} x ORDER BY 1`).execute(db)).rows.map((r) => r.r));
  }
  return out;
}

/** The rows of any table whose text names one of `ids`, by table (`except` left out). */
async function rowsNaming(db: Db, ids: readonly string[], except: readonly string[] = []): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (ids.length === 0) return out;
  const re = ids.map((i) => i.toLowerCase()).join('|');
  for (const t of await tablesOf(db)) {
    if (except.includes(t)) continue;
    const rows = (await sql.raw<{ r: string }>(`SELECT x::text AS r FROM public.${t} x WHERE x::text ~ '${re}' ORDER BY 1`).execute(db)).rows.map((r) => r.r);
    if (rows.length) out[t] = rows;
  }
  return out;
}

/**
 * The release-level system rows a purge never deletes (plan §A.3, A3.never): they may name a deleted account, entry
 * or order by its id (no personal data): the LIVE engine's batches, line, end and after-room rows, a vault given at a
 * sell-out, and the test's own `test_run.*` rows (its report and its purge stay).
 */
const SYSTEM_ACTIONS = /^(drop\.live\.(batch|queue|end|after_room\..+)|vault\.give|test_run\..+)$/;

/**
 * Every row still naming a deleted id: the audit log's system rows and the test's own row aside (A3.never), and the
 * audit rows `tail` (the chain's tail when a batch ran, which the purge never deletes, §A.2).
 */
async function leftovers(db: Db, ids: readonly string[], tail: readonly number[] = []): Promise<Record<string, string[]>> {
  const found = await rowsNaming(db, ids, ['test_runs']);
  if (found.audit_logs) {
    const rows = (
      await sql.raw<{ id: string; action: string; r: string }>(`SELECT id, action, x::text AS r FROM audit_logs x WHERE x::text ~ '${ids.map((i) => i.toLowerCase()).join('|')}' ORDER BY id`).execute(db)
    ).rows.filter((r) => !SYSTEM_ACTIONS.test(r.action) && !tail.includes(Number(r.id)));
    if (rows.length) found.audit_logs = rows.map((r) => r.r);
    else delete found.audit_logs;
  }
  return found;
}

/** No audit row has one of `accounts` as its actor or its target. */
const auditNaming = (db: Db, accounts: readonly string[]) =>
  accounts.length === 0
    ? Promise.resolve(0)
    : count(db, `audit_logs WHERE (actor_type = 'account' AND actor_id = ANY ('{${accounts.join(',')}}'::text[])) OR (target_type = 'account' AND target_id = ANY ('{${accounts.join(',')}}'::text[]))`);

const exists = async (db: Db, account: string) => (await count(db, `accounts WHERE id = '${account}'`)) === 1;

/** The chain over the tombstones: OK, every entry checked, the purged ones stepped over. */
async function chainOk(w: World): Promise<number> {
  const v = await w.h.ctx.audit.verifyChain({ batchSize: 97 });
  expect(v.ok, JSON.stringify(v)).toBe(true);
  return v.purged ?? 0;
}


/** What changed between two readings of every row: per table, the rows gone and the rows new (an UPDATE is both). */
function diffRows(before: Map<string, string[]>, after: Map<string, string[]>): { removed: Record<string, string[]>; added: Record<string, string[]> } {
  const removed: Record<string, string[]> = {};
  const added: Record<string, string[]> = {};
  for (const [t, rows] of before) {
    const now = new Set(after.get(t) ?? []);
    const gone = rows.filter((r) => !now.has(r));
    if (gone.length) removed[t] = gone;
  }
  for (const [t, rows] of after) {
    const was = new Set(before.get(t) ?? []);
    const fresh = rows.filter((r) => !was.has(r));
    if (fresh.length) added[t] = fresh;
  }
  return { removed, added };
}

/** `p` refused with `reason`, and every row of the database as it was. */
async function refusedAsWas(db: Db, p: () => Promise<unknown>, reason: string, label = reason): Promise<void> {
  const before = await everyRow(db);
  await refused(p(), reason, label);
  expect(diffRows(before, await everyRow(db)), label).toEqual({ removed: {}, added: {} });
}

/** THE PROGRAM's PLATINE welcome gift: a model of one size with pieces in stock (a PLATINE order then carries a GIFT order). */
async function platineGift(w: World): Promise<void> {
  const { ensureSku } = await import('../../src/server/services/stock.js');
  const france = (await w.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
  const giftModel = await createModel(w.db, 'ANNEAU CADEAU');
  const giftSku = await inTransaction(w.db, (tx) => ensureSku(tx, giftModel, null));
  await w.h.ctx.services.stock.adjust({ skuId: giftSku, locationId: france, delta: 50, note: 'Counted.' }, w.admin);
  const program = await w.h.ctx.services.clubProgram.read();
  await w.h.ctx.services.clubProgram.update({ ...program, giftPlatineModelId: giftModel }, w.admin);
}

/** The run's entries and orders (its accounts', in its release and travelling with them). */
async function rowsOfRun(w: World, run: Run): Promise<{ entries: string[]; liveEntries: string[]; orders: string[] }> {
  const rel = (await w.db.selectFrom('drops').select('id').where((eb) => eb.or([eb('id', '=', run.drop), eb('parent_drop_id', '=', run.drop)])).execute()).map((d) => d.id);
  const entries = (await w.db.selectFrom('drop_entries').select('id').where('drop_id', 'in', rel).where('account_id', 'in', run.accounts).execute()).map((r) => r.id);
  const liveEntries = (await w.db.selectFrom('live_entries').select('id').where('drop_id', 'in', rel).where('account_id', 'in', run.accounts).execute()).map((r) => r.id);
  const orders = (await w.db.selectFrom('orders').select('id').where('account_id', 'in', run.accounts).execute()).map((r) => r.id);
  return { entries: entries.sort(), liveEntries: liveEntries.sort(), orders: orders.sort() };
}

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

/** `fn` in a transaction always rolled back; answers what it returned. */
async function rolledBack<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  try {
    await db.transaction().execute(async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error('unreachable');
}

// ═════════════════════════════════════════════════════════════════════════════

describe('a drawn draw of the test, real collectors around it', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
    await platineGift(w);
  }, 120_000);
  afterAll(() => w?.h.close());

  it('deletes the run\'s rows and its accounts with their grants, sizes and profiles; keeps a staff MARK PAID order with its GIFT order, entry and account; touches nothing else; bounded batches; a summary\'s `windows` changes nothing; DONE once; the audit tail kept; the chain OK', async () => {
    const db = w.db;
    // A real collector in another draw, drawn: its place confirmed by the staff, its order RESERVED.
    const other = await openDraw(w, { title: 'MONOLITHE · REAL DRAW', quantity: 1, priceMinor: 90_000 });
    const real = await createAccount(db);
    await w.h.ctx.services.drops.enter(real.id, other, real.actor);

    let paid = '';
    const run = await drawRun(w, {
      tiers: { none: 2, titane: 2, platine: 3 },
      drawn: true,
      quantity: 7,
      priceMinor: 120_000,
      behaviour: { reservePct: 0, confirmPct: 100 },
      afterDraw: async (r) => {
        // The real draw, drawn and confirmed meanwhile.
        await w.h.ctx.services.drops.draw(other, w.f.admin);
        const place = await db.selectFrom('drop_entries').select('id').where('drop_id', '=', other).where('account_id', '=', real.id).executeTakeFirstOrThrow();
        await w.h.ctx.services.drops.confirm(other, place.id, null, w.f.admin);
        // Client Services marks a PLATINE order of the test PAID: its invoice holds it, with its GIFT order, for good.
        const orders = await db.selectFrom('orders').select('id').where('drop_id', '=', r.drop).where('channel', '=', 'DRAW').execute();
        expect(orders.length).toBe(7);
        const withGift = await db.selectFrom('orders').select('with_order_id').where('channel', '=', 'GIFT').where('account_id', 'in', r.accounts).orderBy('with_order_id').execute();
        expect(withGift).toHaveLength(3);
        paid = withGift[0]!.with_order_id!;
        await w.h.ctx.services.orders.transition(paid, { to: 'PAID' }, w.admin);
        // Two other bots' own settings while the test runs (a ring size, a city): rows of the plan's DELETE tables, audited.
        const owner = (await db.selectFrom('orders').select('account_id').where('id', '=', paid).executeTakeFirstOrThrow()).account_id;
        const [x, y] = r.accounts.filter((a) => a !== owner);
        await w.h.ctx.services.sizes.set(x!, { RING: 52 }, { type: 'account', id: x! });
        await w.h.ctx.services.profiles.save(y!, { version: 0, city: 'Lyon' }, { type: 'account', id: y! });
      },
    });
    const holder = (await db.selectFrom('orders').select('account_id').where('id', '=', paid).executeTakeFirstOrThrow()).account_id;
    const gift = await db.selectFrom('orders').select(['id', 'status']).where('with_order_id', '=', paid).executeTakeFirstOrThrow();
    // Its invoice, and the credit note END TEST's cancellation issued.
    expect(await count(db, `invoices WHERE order_id = '${paid}'`)).toBe(2);
    const own = (t: string) => count(db, `${t} WHERE account_id = ANY ('{${run.accounts.join(',')}}')`);
    // What the flows wrote for the test's accounts: three PLATINE grants each (a gift, a credit), a size, a profile.
    expect([await own('tier_grants'), await own('account_sizes'), await own('account_profiles')]).toEqual([6, 1, 1]);
    expect(await count(db, `audit_logs WHERE action = 'club.grant' AND target_id = ANY ('{${run.accounts.join(',')}}')`)).toBe(6);
    const before = await rowsOfRun(w, run);
    expect(before.entries).toHaveLength(7);
    expect(before.orders).toHaveLength(10);
    const keptOrders = [paid, gift.id].sort();
    const keptEntry = (await db.selectFrom('drop_entries').select('id').where('drop_id', '=', run.drop).where('account_id', '=', holder).executeTakeFirstOrThrow()).id;
    const goneAccounts = run.accounts.filter((a) => a !== holder).sort();
    const goneEntries = before.entries.filter((e) => e !== keptEntry);
    const goneOrders = before.orders.filter((o) => !keptOrders.includes(o));
    const realRows = await rowsNaming(db, [real.id, other], ['test_runs']);
    const holderRows = await rowsNaming(db, [holder], ['test_runs']);

    // The same purge with a request whose summary carries a `windows` key, rolled back: the same rows deleted.
    const tried = await rolledBack(db, async (tx) => {
      await request(w, run.id, { summary: { all: false, windows: { fromId: 1, toId: 9_000_000_000, from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z', accounts: [real.id, holder] } } }, tx);
      const d = await drainBatches(tx, run.id, 500);
      return {
        accounts: d.deletedAccounts,
        gaps: (await sql<{ id: string }>`SELECT id FROM audit_purge_gaps WHERE run_id = ${run.id} ORDER BY id`.execute(tx)).rows.map((r) => Number(r.id)),
        windows: (await tx.selectFrom('test_runs').select('purge_windows').where('id', '=', run.id).executeTakeFirstOrThrow()).purge_windows as Record<string, unknown>,
        kept: d.last.kept,
      };
    });
    expect(await count(db, 'audit_purge_gaps')).toBe(0);
    expect((await db.selectFrom('test_runs').select('purge_state').where('id', '=', run.id).executeTakeFirstOrThrow()).purge_state).toBeNull();

    // A session of one of the bots still open (END TEST ended theirs): step 10 deletes it with its account.
    await w.h.ctx.sessions.create({ subjectType: 'account', subjectId: goneAccounts[0]! });
    expect(await count(db, `sessions WHERE subject_id = '${goneAccounts[0]}'`)).toBe(1);

    // The request; then, the newest row of the log names an entry the purge deletes: it stays (the audit tail).
    const all0 = await everyRow(db);
    const stepUp = await request(w, run.id);
    const tail = await w.h.ctx.audit.record({ actor: w.admin, action: 'drop.entry.note', targetType: 'drop', targetId: run.drop, details: { entryId: goneEntries[0] } });

    // The batches, 7 rows a call at most (or one whole order), 1 account a call at step 10 (7 / 10, at least one).
    const calls: Batch[] = [];
    const phases: string[] = [];
    let atStep10: { entrants: string[]; stored: string[] } | null = null;
    for (let i = 0; i < 300; i++) {
      const r = await batch(db, run.id, 7);
      calls.push(r);
      if (phases.at(-1) !== r.phase) phases.push(r.phase);
      const rows = Object.values(r.deleted).reduce((n, x) => n + x, 0);
      if (r.phase === 'ORDERS') expect(rows <= 7 || r.deleted.orders === 1, `a call of ${rows} rows`).toBe(true);
      else if (r.phase !== 'ACCOUNTS') expect(rows, r.phase).toBeLessThanOrEqual(7);
      expect(r.deletedAccounts.length).toBeLessThanOrEqual(1);
      if (r.phase === 'ACCOUNTS' && !atStep10) {
        // Step 10 after step 9: the run's entrants gone (but the holder's), its accounts read from its stored windows (H10).
        atStep10 = {
          entrants: await accountsOf(w, run.id),
          stored: ((await db.selectFrom('test_runs').select('purge_windows').where('id', '=', run.id).executeTakeFirstOrThrow()).purge_windows as { accounts: string[] }).accounts.sort(),
        };
      }
      if (r.phase === 'ACCOUNTS_DONE') break;
    }
    const last = calls.at(-1)!;
    expect(last.phase).toBe('ACCOUNTS_DONE');
    expect(phases).toEqual(['ORDERS', 'ENTRY_AUDIT', 'ENTRIES', 'RUN_ENTRANTS', 'ACCOUNTS', 'ACCOUNTS_DONE']);
    expect(calls.filter((c) => c.phase === 'ORDERS').length).toBeGreaterThan(1);
    expect(atStep10).toEqual({ entrants: [holder], stored: [...run.accounts].sort() });
    const deletedAccounts = calls.flatMap((c) => c.deletedAccounts).sort();
    expect(deletedAccounts).toEqual(goneAccounts);
    expect(last.kept).toEqual({ orders: 2, entries: 1, accounts: 1 });
    const deleted: Record<string, number> = {};
    for (const c of calls) for (const [t, n] of Object.entries(c.deleted)) deleted[t] = (deleted[t] ?? 0) + n;
    expect(deleted).toMatchObject({ orders: 8, drop_entries: 6, test_run_entrants: 6, test_entrants: 6, accounts: 6, tier_grants: 4, account_sizes: 1, account_profiles: 1, sessions: 1 });

    // The `windows` key changed nothing: the same accounts, the same audit rows, the same stored range and accounts.
    const gaps = (await db.selectFrom('audit_purge_gaps').select('id').where('run_id', '=', run.id).orderBy('id').execute()).map((g) => Number(g.id));
    const windows = (await db.selectFrom('test_runs').select('purge_windows').where('id', '=', run.id).executeTakeFirstOrThrow()).purge_windows as Record<string, unknown>;
    expect(tried.accounts).toEqual(deletedAccounts);
    expect(tried.gaps).toEqual(gaps);
    expect(tried.kept).toEqual(last.kept);
    expect({ ...tried.windows, toId: 0 }).toEqual({ ...windows, toId: 0 });
    expect(windows.toId).toBe(stepUp);
    expect(windows.fromId).toBe(Number((await db.selectFrom('audit_logs').select('id').where('action', '=', 'test_run.start').where('target_id', '=', run.id).executeTakeFirstOrThrow()).id));

    // Gone: the run's other accounts with every row of theirs (grants, the size, the profile, the club.grant rows).
    for (const a of goneAccounts) expect(await exists(db, a)).toBe(false);
    expect([await own('tier_grants'), await own('account_sizes'), await own('account_profiles')]).toEqual([2, 0, 0]);
    expect(await auditNaming(db, goneAccounts)).toBe(0);
    // Kept: the holder whole, every row naming it as it was; the real collector's rows as they were.
    expect(await rowsNaming(db, [holder], ['test_runs'])).toEqual(holderRows);
    expect(await rowsNaming(db, [real.id, other], ['test_runs'])).toEqual(realRows);
    expect((await db.selectFrom('orders').select(['id', 'status']).where('id', 'in', keptOrders).orderBy('id').execute()).map((o) => o.status)).toEqual(['CANCELLED', 'CANCELLED']);
    // The audit tail: the newest row named an entry deleted; it stays.
    expect(await count(db, `audit_logs WHERE id = ${tail.id}`)).toBe(1);

    // Nothing else changed: the rows gone are the run's (each names a deleted account, entry or order, or is a
    // tombstoned audit row); new rows only in the log, the tombstones, the run's row and the admin's (the request).
    const all1 = await everyRow(db);
    const { removed, added } = diffRows(all0, all1);
    const goneIds = new RegExp([...goneAccounts, ...goneEntries, ...goneOrders].join('|'));
    for (const [t, rows] of Object.entries(removed)) {
      if (t === 'test_runs' || t === 'admin_users') continue;
      for (const r of rows) expect(goneIds.test(r), `${t}: ${r}`).toBe(true);
    }
    expect(Object.keys(removed).sort()).toEqual(
      ['accounts', 'account_profiles', 'account_sizes', 'admin_users', 'audit_logs', 'drop_entries', 'event_journal', 'order_events', 'orders', 'sessions', 'test_entrants', 'test_run_entrants', 'test_runs', 'tier_grants'].sort(),
    );
    expect(Object.keys(added).sort()).toEqual(['admin_users', 'audit_logs', 'audit_purge_gaps', 'test_runs']);
    expect(removed.audit_logs!.length).toBe(gaps.length);
    expect(added.audit_logs!.length).toBe(3);
    // No row anywhere names a deleted id, but the release's own system rows (A3.never).
    expect(await leftovers(db, [...goneAccounts, ...goneEntries, ...goneOrders], [tail.id])).toEqual({});

    // DONE: the summary written once, before and after; nothing more to purge.
    await refused(db.updateTable('test_runs').set({ purge_summary: jsonText({ all: true }) }).where('id', '=', run.id).execute(), 'PURGE_WRITE_ONCE');
    await done(w, run.id, { last, calls, phases, deleted, deletedAccounts });
    const final = await db.selectFrom('test_runs').selectAll().where('id', '=', run.id).executeTakeFirstOrThrow();
    expect(final).toMatchObject({ purge_state: 'DONE', purge_summary: { all: false }, purge_step_up_id: stepUp, purge_reason: null });
    expect(final.report).not.toBeNull();
    await refused(db.updateTable('test_runs').set({ purge_summary: jsonText({ all: false, again: true }) }).where('id', '=', run.id).execute(), 'PURGE_DONE');
    await refused(batch(db, run.id), 'PURGE_DONE');

    // The chain: OK, every tombstone stepped over; and after a new entry written on the purged log.
    expect(await chainOk(w)).toBe(gaps.length);
    await w.h.ctx.audit.record({ actor: w.admin, action: 'admin.note', targetType: 'admin', targetId: w.admin.id, details: {} });
    expect(await chainOk(w)).toBe(gaps.length);
  }, 240_000);

});

describe('an undrawn draw of the test', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  it('an undrawn draw, cancelled, holding a real collector\'s entry: purged, the real entry and account untouched', async () => {
    const db = w.db;
    const real = await createAccount(db);
    const run = await drawRun(w, {
      tiers: { titane: 3 },
      drawn: false,
      beforeDraw: async (r) => {
        await w.h.ctx.services.drops.enter(real.id, r.drop, real.actor);
      },
    });
    const realRows = await rowsNaming(db, [real.id], ['test_runs']);
    expect(realRows.drop_entries).toHaveLength(1);
    const before = await rowsOfRun(w, run);
    const d = await purge(w, run.id);
    expect(d.deletedAccounts).toEqual(run.accounts);
    expect(d.last.kept).toEqual({ orders: 0, entries: 0, accounts: 0 });
    expect(await rowsNaming(db, [real.id], ['test_runs'])).toEqual(realRows);
    expect(await leftovers(db, [...run.accounts, ...before.entries, ...before.orders])).toEqual({});
    expect(await chainOk(w)).toBeGreaterThan(0);
  }, 240_000);
});

describe('a LIVE RELEASE of the test with its after-room', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  const AFTER = async () => ({ modelId: await createModel(w.db, 'AFTERGLOW'), priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }], addonIds: [], delayMinutes: 10, lengthMinutes: 15 });
  const childRow = (id: string) => w.db.selectFrom('drops').select(['id', 'parent_drop_id', 'published_at', 'cancelled_at', 'opens_at', 'ended_at', 'ended_reason']).where('id', '=', id).executeTakeFirstOrThrow();
  const placesOf = async (child: string) => (await w.db.selectFrom('after_room_guests').select(['entry_id', 'position']).where('drop_id', '=', child).orderBy('position').execute()).map((g) => [g.entry_id, g.position] as const);

  it('two bots buy two pieces each, the line left waiting becomes the after-room\'s guests; a test guest enters it; the purge deletes the test\'s guests, entries and orders, keeps a two-piece order with one piece blocking whole (no 23503), the real guest\'s place with its gap, and every reader of the place still answers right', async () => {
    const db = w.db;
    const t0 = new Date(w.h.clock.now().getTime() + HOUR);
    const release = await createLiveRelease(w.f, { opensAt: t0, sizes: [{ label: '52', stock: 4 }], perAccount: 2, afterRoom: await AFTER() });
    const child = release.afterRoom!.id;
    // The room open (five minutes before T0): the bots come in.
    w.h.clock.set(new Date(t0.getTime() - 4 * MINUTE));
    // A real collector in the line, behind the bots (no tier): one of the after-room's guests.
    const real = await accountOfTier(w.f, 0);
    const run = await w.tests.start(
      release.id,
      press(release.id, { titane: 2, palladium: 2 }, {
        arrival: { mode: 'all', interestPct: 100 },
        behaviour: { payPct: 100, releasePct: 0, missPct: 0, leavePct: 0, holdSeconds: 1.5 },
        choices: { size: '52', quantity: 2, addOnsPct: 0 },
      }),
      w.f.admin,
    );
    await drive(w, 0, 500, release.id);
    await w.h.ctx.services.live.enter(real.id, release.id, { sizeId: release.sizes[0]!.id }, real.actor);
    w.h.clock.set(t0);
    await drive(w, 20_000, 500, release.id);
    const parent = await childRow(release.id);
    expect(parent.ended_reason).toBe('SOLD_OUT');
    const accounts = await accountsOf(w, run.id);
    // The two PALLADIUM bots paid two pieces each: two orders an entry, the second travelling with the first.
    const orders = await db.selectFrom('orders').select(['id', 'account_id', 'with_order_id', 'piece', 'status']).where('drop_id', '=', release.id).orderBy('account_id').orderBy('piece').execute();
    expect(orders.map((o) => o.piece)).toEqual([1, 2, 1, 2]);
    expect(orders[1]!.with_order_id).toBe(orders[0]!.id);
    // Client Services takes credit off the second piece of the first: a staff act, it holds that piece for good.
    const [first, second] = [orders[0]!, orders[1]!];
    await w.h.ctx.services.orders.applyCredit(second.id, 1_000, w.admin);
    // Two other bots' own settings meanwhile (a ring size, a city); the other PALLADIUM bot's grants (PLATINE's and
    // PALLADIUM's: a gift and a credit each).
    const others = accounts.filter((a) => a !== first.account_id);
    await w.h.ctx.services.sizes.set(others[0]!, { RING: 52 }, { type: 'account', id: others[0]! });
    await w.h.ctx.services.profiles.save(others[1]!, { version: 0, city: 'Lille' }, { type: 'account', id: others[1]! });
    const own = (t: string) => count(db, `${t} WHERE account_id = ANY ('{${others.join(',')}}')`);
    expect([await own('tier_grants'), await own('account_sizes'), await own('account_profiles')]).toEqual([4, 1, 1]);
    // The guests: the two TITANE bots, then the real collector, at their places in the line.
    const guests = await placesOf(child);
    expect(guests.map((g) => g[1])).toEqual([1, 2, 3]);
    const realEntry = (await db.selectFrom('live_entries').select('id').where('drop_id', '=', release.id).where('account_id', '=', real.id).executeTakeFirstOrThrow()).id;
    expect(guests[2]![0]).toBe(realEntry);
    // At the after-room's T0 a test guest (by hand, as anyone through the routes) and the real one enter it; it closes at its length.
    const opens = (await childRow(child)).opens_at;
    w.h.clock.set(new Date(opens.getTime() + 5 * SECOND));
    const testGuest = (await db.selectFrom('live_entries').select('account_id').where('id', '=', guests[0]![0]).executeTakeFirstOrThrow()).account_id;
    await w.h.ctx.services.live.enter(testGuest, child, { sizeId: release.afterRoom!.sizes[0]!.id }, { type: 'account', id: testGuest });
    await w.h.ctx.services.live.enter(real.id, child, { sizeId: release.afterRoom!.sizes[0]!.id }, real.actor);
    w.h.clock.set(new Date(opens.getTime() + 16 * MINUTE));
    await w.h.ctx.services.live.advance(child);
    expect((await childRow(child)).ended_at).not.toBeNull();
    const ended = await w.tests.end(run.id, testPhrase(release.id, true), w.f.admin);
    expect(ended.status).toBe('ENDED');
    w.h.clock.advance(MINUTE);
    const realChildEntry = (await db.selectFrom('live_entries').select(['id', 'position']).where('drop_id', '=', child).where('account_id', '=', real.id).executeTakeFirstOrThrow());
    expect(realChildEntry.position).toBe(3);

    const r = { id: run.id, drop: release.id, accounts };
    const before = await rowsOfRun(w, r);
    expect(before.liveEntries.length).toBe(5);
    const realRows = await rowsNaming(db, [real.id, realEntry, realChildEntry.id], ['test_runs']);
    const holderRows = await rowsNaming(db, [first.account_id], ['test_runs']);
    const d = await purge(w, run.id, 7);
    expect(d.phases).toEqual(['AFTER_ROOM_GUESTS', 'ORDERS', 'ENTRY_AUDIT', 'ENTRIES', 'INTEREST', 'RUN_ENTRANTS', 'ACCOUNTS', 'ACCOUNTS_DONE']);
    expect(d.deleted.live_interest).toBe(4);
    expect([await own('tier_grants'), await own('account_sizes'), await own('account_profiles')]).toEqual([0, 0, 0]);
    expect(d.deleted.after_room_guests).toBe(2);
    // Kept whole: the two pieces of the first PALLADIUM bot (one held by the staff's credit), its entry, its account.
    expect(d.last.kept).toEqual({ orders: 2, entries: 1, accounts: 1 });
    expect((await db.selectFrom('orders').select('id').where('id', 'in', [first.id, second.id]).orderBy('id').execute()).map((o) => o.id)).toEqual([first.id, second.id].sort());
    // Every row of it as it was, but its I'LL BE THERE in the release: the scope's interest goes at step 8 (§A.3).
    expect(holderRows.live_interest).toHaveLength(1);
    expect(await rowsNaming(db, [first.account_id], ['test_runs'])).toEqual({ ...holderRows, live_interest: undefined });
    expect(d.deletedAccounts).toEqual(accounts.filter((a) => a !== first.account_id).sort());
    expect(await count(db, `live_entries WHERE drop_id = '${child}' AND account_id = '${testGuest}'`)).toBe(0);
    expect(await rowsNaming(db, [real.id, realEntry, realChildEntry.id], ['test_runs'])).toEqual(realRows);
    const goneOrders = before.orders.filter((o) => o !== first.id && o !== second.id);
    const keptEntry = (await db.selectFrom('live_entries').select('id').where('drop_id', '=', release.id).where('account_id', '=', first.account_id).executeTakeFirstOrThrow()).id;
    expect(await leftovers(db, [...d.deletedAccounts, ...before.liveEntries.filter((e) => e !== keptEntry), ...goneOrders])).toEqual({});
    expect(await chainOk(w)).toBeGreaterThan(0);

    // The real guest's place, 3 after a gap of two: every reader of after_room_guests.position answers it as before.
    expect(await placesOf(child)).toEqual([[realEntry, 3]]);
    const row = await childRow(child);
    expect(await afterRoomPlace(db, row, real.id, w.h.clock.now())).toBe(3);
    expect(await afterRoomPlace(db, row, testGuest, w.h.clock.now())).toBeNull();
    expect((await accountLiveData(db, real.id)).entries.find((e) => e.dropId === release.id)!.afterRoomPlace).toBe(3);
    expect((await w.h.ctx.services.liveConsole.get(release.id)).afterRoom).toMatchObject({ state: 'OVER', guests: 1 });
    expect((await afterRoomDoors(db, [realEntry])).size).toBe(0);
    expect(await w.h.ctx.services.liveRoom.afterRoomSheet(real.id, release.id)).toMatchObject({ id: child, phase: 'ENDED', afterRoom: { parentId: release.id } });
    expect((await w.h.ctx.services.liveRoom.viewer(real.id, child, 'state')).entry).toBe('ENDED');
  }, 240_000);

  it('an after-room open with a gap in its guests\' places (two rows deleted as the purge deletes them): the third guest enters at its place, is given its turn, holds, secures and pays; the console and the export read its place', async () => {
    const db = w.db;
    const t0 = new Date(w.h.clock.now().getTime() + HOUR);
    const r = await createLiveRelease(w.f, { opensAt: t0, sizes: [{ label: '52', stock: 1 }], afterRoom: await AFTER() });
    const child = r.afterRoom!.id;
    const people = [await accountOfTier(w.f, 3), await accountOfTier(w.f, 2), await accountOfTier(w.f, 1), await accountOfTier(w.f, 0)];
    w.h.clock.set(new Date(t0.getTime() - MINUTE));
    for (const p of people) await w.h.ctx.services.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
    w.h.clock.set(t0);
    await w.h.ctx.services.live.advance(r.id);
    const buyer = people[0]!;
    const token = (await w.h.ctx.services.live.entry(buyer.id, r.id))!.turn!.token!;
    await w.h.ctx.services.live.press(buyer.id, r.id, token);
    w.h.clock.advance(1500);
    await w.h.ctx.services.live.secure(buyer.id, r.id, token, buyer.actor);
    await w.h.ctx.services.live.confirm(buyer.id, r.id, buyer.actor);
    const guests = await placesOf(child);
    expect(guests.map((g) => g[1])).toEqual([1, 2, 3]);
    // The first two guests' rows deleted as the purge's step 1 deletes them (renumbering is forbidden).
    await db.deleteFrom('after_room_guests').where('entry_id', 'in', [guests[0]![0], guests[1]![0]]).execute();
    const third = people[3]!;
    const opens = (await childRow(child)).opens_at;
    w.h.clock.set(new Date(opens.getTime() + SECOND));
    expect(await afterRoomPlace(db, await childRow(child), third.id, w.h.clock.now())).toBe(3);
    const entered = await w.h.ctx.services.live.enter(third.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, third.actor);
    expect(entered).toMatchObject({ status: 'QUEUED', placed: true });
    expect((await db.selectFrom('live_entries').select('position').where('drop_id', '=', child).where('account_id', '=', third.id).executeTakeFirstOrThrow()).position).toBe(3);
    expect((await w.h.ctx.services.liveConsole.get(r.id)).afterRoom).toMatchObject({ state: 'OPEN', guests: 1 });
    w.h.clock.advance(SECOND);
    await w.h.ctx.services.live.advance(child);
    const turn = (await w.h.ctx.services.live.entry(third.id, child))!;
    expect(turn.status).toBe('TURN');
    await w.h.ctx.services.live.press(third.id, child, turn.turn!.token!);
    w.h.clock.advance(1500);
    await w.h.ctx.services.live.secure(third.id, child, turn.turn!.token!, third.actor);
    await w.h.ctx.services.live.confirm(third.id, child, third.actor);
    expect((await childRow(child)).ended_reason).toBe('SOLD_OUT');
    expect((await accountLiveData(db, third.id)).entries.find((e) => e.dropId === r.id)!.afterRoomPlace).toBe(3);
    // The other guests read an unknown release, as anyone but a guest.
    await expect(w.h.ctx.services.liveRoom.afterRoomSheet(people[1]!.id, r.id)).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
  }, 240_000);
});

describe('the shared pool: accounts of two ended tests on two releases (H1, H10)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
    await platineGift(w);
  }, 120_000);
  afterAll(() => w?.h.close());

  /**
   * Two tests one after the other on two releases: the first a drawn draw of PLATINE bots (their orders, GIFT orders,
   * grants and `club.grant` rows written during it), the second a DRAWN draw of test entrants only, taking the first's
   * three accounts back from the pool (takePool reuses an ENDED test's) and one more.
   */
  async function pair(label: string): Promise<{ r1: Run; r2: Run; shared: string[]; grants: number[] }> {
    const r1 = await drawRun(w, { title: `${label} 1`, tiers: { platine: 3 }, drawn: true, quantity: 3, priceMinor: 120_000 });
    const r2 = await drawRun(w, { title: `${label} 2`, tiers: { titane: 4 }, drawn: true, quantity: 2 });
    const shared = r1.accounts.filter((a) => r2.accounts.includes(a)).sort();
    expect(shared).toEqual([...r1.accounts].sort());
    expect(r2.accounts).toHaveLength(4);
    // Rows of the first test naming the shared accounts: their grants and the `club.grant` rows.
    expect(await count(w.db, `tier_grants WHERE account_id = ANY ('{${shared.join(',')}}')`)).toBe(6);
    const grants = (await w.db.selectFrom('audit_logs').select('id').where('action', '=', 'club.grant').where('target_id', 'in', shared).orderBy('id').execute()).map((g) => Number(g.id));
    expect(grants).toHaveLength(6);
    return { r1, r2, shared, grants };
  }

  /** After the second purge: the shared accounts gone, every row of theirs, nothing in the log names one; the chain OK. */
  async function sharedGone(p: { r1: Run; r2: Run; shared: string[]; grants: number[] }, first: Drained, second: Drained) {
    const db = w.db;
    // The first purge kept them (the second test still held them), and said so.
    expect(first.deletedAccounts).toEqual([]);
    expect(first.last.kept.accounts).toBe(3);
    // The second deleted them with its own.
    expect(second.deletedAccounts).toEqual([...p.r2.accounts].sort());
    expect(second.deletedAccounts.filter((a) => p.shared.includes(a))).toEqual(p.shared);
    expect(second.last.kept).toEqual({ orders: 0, entries: 0, accounts: 0 });
    for (const a of p.shared) expect(await exists(db, a)).toBe(false);
    expect(await count(db, `tier_grants WHERE account_id = ANY ('{${p.shared.join(',')}}')`)).toBe(0);
    expect(await auditNaming(db, [...p.r1.accounts, ...p.r2.accounts])).toBe(0);
    // Their club.grant rows (written during the first test) went with the second purge, their tombstones its own.
    expect((await db.selectFrom('audit_purge_gaps').select(['id', 'run_id']).where('id', 'in', p.grants).orderBy('id').execute()).map((g) => [Number(g.id), g.run_id])).toEqual(p.grants.map((id) => [id, p.r2.id]));
    const e1 = await rowsOfRun(w, p.r1);
    const e2 = await rowsOfRun(w, p.r2);
    expect([...e1.entries, ...e2.entries, ...e1.orders, ...e2.orders]).toEqual([]);
    expect(await chainOk(w)).toBeGreaterThan(0);
  }

  it('one purge after the other: the first keeps the shared accounts, the second deletes them; R2, a DRAWN draw of test entrants only, is not refused (PURGE_NOT_TEST)', async () => {
    const p = await pair('ONE AFTER THE OTHER');
    const before1 = await rowsOfRun(w, p.r1);
    const before2 = await rowsOfRun(w, p.r2);
    const first = await purge(w, p.r1.id);
    const stored = ((await w.db.selectFrom('test_runs').select('purge_windows').where('id', '=', p.r1.id).executeTakeFirstOrThrow()).purge_windows as { accounts: string[] }).accounts.sort();
    expect(stored).toEqual(p.shared);
    const second = await purge(w, p.r2.id);
    await sharedGone(p, first, second);
    expect(await leftovers(w.db, [...p.r2.accounts, ...before1.entries, ...before1.orders, ...before2.entries, ...before2.orders])).toEqual({});
  }, 240_000);

  it('PURGE ALL: both asked with one step-up, purged in turn: the same; then its pool sweep finds nothing left', async () => {
    const p = await pair('PURGE ALL');
    const before1 = await rowsOfRun(w, p.r1);
    const before2 = await rowsOfRun(w, p.r2);
    const stepUp = await requestAll(w, [p.r1.id, p.r2.id]);
    // The sweep waits while a run of that PURGE ALL is under way.
    await refused(poolBatch(w.db), 'PURGE_ALL_NOT_DONE');
    const first = await drainBatches(w.db, p.r1.id);
    await done(w, p.r1.id, first);
    await refused(poolBatch(w.db), 'PURGE_ALL_NOT_DONE');
    const second = await drainBatches(w.db, p.r2.id);
    await done(w, p.r2.id, second);
    for (const id of [p.r1.id, p.r2.id]) expect((await w.db.selectFrom('test_runs').select('purge_step_up_id').where('id', '=', id).executeTakeFirstOrThrow()).purge_step_up_id).toBe(stepUp);
    await sharedGone(p, first, second);
    const sweep = await poolBatch(w.db);
    expect(sweep).toMatchObject({ phase: 'POOL_DONE', deletedAccounts: [], left: 0 });
    expect(await leftovers(w.db, [...p.r2.accounts, ...before1.entries, ...before1.orders, ...before2.entries, ...before2.orders])).toEqual({});
  }, 240_000);
});

describe('the refusals, on real test runs: each one changes nothing', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  const refusedUnchanged = (p: () => Promise<unknown>, reason: string, label = reason) => refusedAsWas(w.db, p, reason, label);

  it('not asked, not ended (DONE, STOPPED), a test running, the release not over, another test of the release not ended, a forbidden window and its 1-minute margin, the replica role, a definer owned by no superuser; then done: PURGE_DONE', async () => {
    const db = w.db;
    const a = await drawRun(w, { tiers: { titane: 2 }, drawn: false, title: 'REFUSALS A' });
    await refusedUnchanged(() => batch(db, a.id), 'PURGE_NOT_REQUESTED');

    // A test DONE, then one STOPPED, of another release: not ended.
    const d2 = await openDraw(w, { title: 'REFUSALS B' });
    const b = await w.tests.start(d2, press(d2, { titane: 1 }), w.f.admin);
    await drive(w, 0);
    expect((await w.tests.view(b.id)).status).toBe('DONE');
    await refusedUnchanged(() => batch(db, b.id), 'PURGE_NOT_ENDED', 'a test DONE');
    await w.tests.end(b.id, testPhrase(d2, true), w.f.admin);
    const c = await w.tests.start(d2, press(d2, { titane: 1 }), w.f.admin);
    // A test RUNNING anywhere: no batch.
    await request(w, a.id);
    await refusedUnchanged(() => batch(db, a.id), 'PURGE_TEST_RUNNING');
    await refusedUnchanged(() => poolBatch(db), 'PURGE_TEST_RUNNING', 'the pool sweep, a test running');
    await w.tests.stop(c.id, w.f.admin);
    await refusedUnchanged(() => batch(db, c.id), 'PURGE_NOT_ENDED', 'a test STOPPED');

    // The release of B and C: B ended and asked; C STOPPED on it. Not over first (the draw neither drawn nor cancelled).
    await request(w, b.id);
    await refusedUnchanged(() => batch(db, b.id), 'PURGE_RELEASE_NOT_OVER');
    await w.h.ctx.services.drops.cancel(d2, w.f.admin);
    await refusedUnchanged(() => batch(db, b.id), 'PURGE_RUNS_NOT_ENDED');
    await w.tests.end(c.id, testPhrase(d2, true), w.f.admin);

    // A forbidden window: now, then only at the margin's end (30 s ahead): refused; 2 minutes ahead: the batch runs.
    await windowIs(w.db, `SELECT 'NIGHT'::text`);
    await refusedUnchanged(() => batch(db, b.id), 'PURGE_WINDOW', 'the night');
    await refusedUnchanged(() => poolBatch(db), 'PURGE_WINDOW', 'the pool sweep in the night');
    await windowIs(w.db, `SELECT CASE WHEN p_at > now() + interval '30 seconds' THEN 'BACKUP' END`);
    await refusedUnchanged(() => batch(db, b.id), 'PURGE_WINDOW', 'the 1-minute margin');
    await windowIs(w.db, `SELECT CASE WHEN p_at > now() + interval '2 minutes' THEN 'BACKUP' END`);
    expect((await batch(db, b.id)).phase).not.toBe('ACCOUNTS_DONE');
    await sql.raw(WINDOWS_OPEN).execute(db);

    // The 9 Oct start guards: the replica role set by this superuser; the function owned by a NOSUPERUSER role.
    await refusedUnchanged(
      () =>
        db.transaction().execute(async (tx) => {
          await sql`SET LOCAL session_replication_role = replica`.execute(tx);
          await batch(tx, b.id);
        }),
      'PURGE_REPLICA_MODE',
    );
    const role = `orbes_t4_${randomUUID().slice(0, 8)}`;
    await sql.raw(`CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`).execute(db);
    for (const fn of ['orbes_purge_test_run_batch(uuid, int)', 'orbes_purge_test_pool_batch(int)']) {
      await refusedUnchanged(
        () =>
          db.transaction().execute(async (tx) => {
            await sql.raw(`ALTER FUNCTION ${fn} OWNER TO ${role}`).execute(tx);
            await (fn.startsWith('orbes_purge_test_run') ? batch(tx, b.id) : poolBatch(tx));
          }),
        'PURGE_NOT_SUPERUSER',
        fn,
      );
    }
    expect((await sql<{ su: boolean }>`SELECT bool_and(r.rolsuper) AS su FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname IN ('orbes_purge_test_run_batch', 'orbes_purge_test_pool_batch')`.execute(db)).rows[0]!.su).toBe(true);
    await sql.raw(`DROP ROLE ${role}`).execute(db);

    // Both purged; then a batch: PURGE_DONE.
    for (const id of [a.id, b.id]) await done(w, id, await drainBatches(db, id));
    await refusedUnchanged(() => batch(db, a.id), 'PURGE_DONE');
    await refusedUnchanged(() => batch(db, b.id), 'PURGE_DONE', 'PURGE_DONE after a window and the start guards');
    expect(await chainOk(w)).toBeGreaterThan(0);
  }, 240_000);

  it('the locks (M12, F23; PGlite has one connection, so the source): the batch takes its run, then the release and its after-room FOR UPDATE (the row lock OFFER NEXT takes) before it reads whether the release is over or holds a real entry; the window and the start guards first of all', async () => {
    const src = (await sql<{ def: string }>`SELECT pg_get_functiondef('orbes_purge_test_run_batch(uuid, int)'::regprocedure) AS def`.execute(w.db)).rows[0]!.def;
    const at = (x: string) => {
      const i = src.indexOf(x);
      expect(i, x).toBeGreaterThan(0);
      return i;
    };
    const order = [
      at("RAISE EXCEPTION USING ERRCODE = 'OR010', MESSAGE = 'PURGE_NOT_SUPERUSER'"),
      at("RAISE EXCEPTION USING ERRCODE = 'OR010', MESSAGE = 'PURGE_REPLICA_MODE'"),
      at("orbes_maintenance_window_within(now(), interval '1 minute')"),
      at('SELECT * INTO r FROM test_runs WHERE id = p_run FOR UPDATE'),
      at("MESSAGE = 'PURGE_TEST_RUNNING'"),
      at('PERFORM 1 FROM drops WHERE id = r.drop_id OR parent_drop_id = r.drop_id ORDER BY id FOR UPDATE'),
      at("MESSAGE = 'PURGE_RELEASE_NOT_OVER'"),
      at("MESSAGE = 'PURGE_RUNS_NOT_ENDED'"),
      at("MESSAGE = 'PURGE_NOT_TEST'"),
      at('DELETE FROM after_room_guests'),
    ];
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('the test_runs guard: NULL -> PURGING refused without a step-up row of the same transaction, with one of another purpose, with one of an earlier transaction, and outside any step-up transaction', async () => {
    const db = w.db;
    const r = await drawRun(w, { tiers: { titane: 1 }, drawn: false, title: 'GUARD' });
    const purging = (tx: Db) =>
      tx.updateTable('test_runs').set({ purge_state: 'PURGING', purge_requested_at: w.h.clock.now(), purge_requested_by: w.admin.id, purge_summary: jsonText({ all: false }) }).where('id', '=', r.id).execute();
    const touched = (tx: Db) => tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', w.admin.id).execute();
    const stepUp = (tx: Db, purpose: string) => w.h.ctx.audit.record({ actor: w.admin, action: 'admin.step_up', targetType: 'admin', targetId: w.admin.id, details: { purpose } }, tx);
    await refusedUnchanged(
      () =>
        inTransaction(db, async (tx) => {
          await touched(tx);
          await purging(tx);
        }),
      'PURGE_NOT_AUTHORIZED',
      'no step-up row in the transaction',
    );
    await refused(
      inTransaction(db, async (tx) => {
        await touched(tx);
        await stepUp(tx, 'platform.reset');
        await purging(tx);
      }),
      'PURGE_NOT_AUTHORIZED',
      'a step-up of another purpose',
    );
    await refused(
      inTransaction(db, async (tx) => {
        await touched(tx);
        await stepUp(tx, `test_run.purge:${randomUUID()}`);
        await purging(tx);
      }),
      'PURGE_NOT_AUTHORIZED',
      'a step-up for another test',
    );
    await stepUp(db, `test_run.purge:${r.id}`);
    await refusedUnchanged(() => inTransaction(db, async (tx) => purging(tx)), 'PURGE_NOT_AUTHORIZED', 'outside a step-up transaction');
    await refusedUnchanged(
      () =>
        inTransaction(db, async (tx) => {
          await touched(tx);
          await purging(tx);
        }),
      'PURGE_NOT_AUTHORIZED',
      'a step-up of an earlier transaction',
    );
    expect((await db.selectFrom('test_runs').select(['purge_state', 'purge_step_up_id']).where('id', '=', r.id).executeTakeFirstOrThrow())).toEqual({ purge_state: null, purge_step_up_id: null });
    // The request as the service writes it passes.
    const su = await request(w, r.id);
    expect((await db.selectFrom('test_runs').select(['purge_state', 'purge_step_up_id']).where('id', '=', r.id).executeTakeFirstOrThrow())).toEqual({ purge_state: 'PURGING', purge_step_up_id: su });
  }, 240_000);
});

describe('test releases only (D15, G1): a drawn draw holding an entry outside the test', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  const refusedUnchanged = (p: () => Promise<unknown>, reason: string, label = reason) => refusedAsWas(w.db, p, reason, label);

  it('real winners: a real collector selected (still to answer: not over), then confirmed with its order: PURGE_NOT_TEST, nothing deleted', async () => {
    const db = w.db;
    const real = await createAccount(db);
    const r = await drawRun(w, {
      tiers: { titane: 3 },
      drawn: true,
      quantity: 10,
      title: 'REAL WINNER',
      beforeDraw: async (x) => {
        await w.h.ctx.services.drops.enter(real.id, x.drop, real.actor);
      },
      afterDraw: async () => undefined,
    });
    const place = await db.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', r.drop).where('account_id', '=', real.id).executeTakeFirstOrThrow();
    expect(place.status).toBe('SELECTED');
    await request(w, r.id);
    await refusedUnchanged(() => batch(db, r.id), 'PURGE_RELEASE_NOT_OVER', 'a real place still to answer');
    // As the loop does with that refusal (PURGE.5): PAUSED with it, which lifts the staff's guard on the release.
    await db.updateTable('test_runs').set({ purge_state: 'PAUSED', purge_reason: 'PURGE_RELEASE_NOT_OVER' }).where('id', '=', r.id).execute();
    await w.h.ctx.services.drops.confirm(r.drop, place.id, null, w.f.admin);
    await refusedUnchanged(() => batch(db, r.id), 'PURGE_NOT_TEST', 'a real winner confirmed');
  }, 240_000);

  it('a real entry never selected (entered, then withdrawn): PURGE_NOT_TEST at the first batch, nothing deleted', async () => {
    const db = w.db;
    const real = await createAccount(db);
    const r = await drawRun(w, {
      tiers: { titane: 3 },
      drawn: true,
      quantity: 1,
      title: 'NEVER SELECTED',
      beforeDraw: async (x) => {
        await w.h.ctx.services.drops.enter(real.id, x.drop, real.actor);
        await w.h.ctx.services.drops.withdraw(real.id, x.drop, real.actor);
      },
    });
    expect((await db.selectFrom('drop_entries').select('status').where('drop_id', '=', r.drop).where('account_id', '=', real.id).executeTakeFirstOrThrow()).status).toBe('WITHDRAWN');
    await request(w, r.id);
    await refusedUnchanged(() => batch(db, r.id), 'PURGE_NOT_TEST');
    await refusedUnchanged(() => batch(db, r.id, 1), 'PURGE_NOT_TEST', 'again, whatever the batch');
  }, 240_000);

  it('a drawn draw of test entrants only: a real winner selected between the request and the first batch, then a real entry appearing between two batches: each batch refused PURGE_NOT_TEST, no test row deleted after it; gone again, the purge ends', async () => {
    const db = w.db;
    const real = await createAccount(db);
    const r = await drawRun(w, { tiers: { titane: 3 }, drawn: true, quantity: 1, title: 'TEST ONLY' });
    await request(w, r.id);
    // A crafted change (the staff's draw actions refuse while a purge runs, PURGE.5): a real place SELECTED, its time up.
    const crafted = (status: 'SELECTED' | 'WITHDRAWN') =>
      db
        .insertInto('drop_entries')
        .values({
          drop_id: r.drop,
          account_id: real.id,
          status,
          created_at: new Date(Date.now() - HOUR),
          ...(status === 'SELECTED' ? { tier: 0, seniority: 0, rank: 99, respond_by: new Date(Date.now() - MINUTE) } : {}),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    const winner = await crafted('SELECTED');
    for (const max of [500, 7, 1]) await refusedUnchanged(() => batch(db, r.id, max), 'PURGE_NOT_TEST', `a real winner, max ${max}`);
    await db.deleteFrom('drop_entries').where('id', '=', winner.id).execute();
    // Two batches go; then a real entry appears: refused, nothing more deleted.
    const one = await batch(db, r.id, 3);
    const two = await batch(db, r.id, 3);
    expect([one, two].every((b) => Object.keys(b.deleted).length > 0)).toBe(true);
    const late = await crafted('WITHDRAWN');
    await refusedUnchanged(() => batch(db, r.id), 'PURGE_NOT_TEST', 'a real entry between two batches');
    await db.deleteFrom('drop_entries').where('id', '=', late.id).execute();
    // The pool's accounts the two tests above still hold (ended, refused, not purged) stay with them; the others go.
    const held = [...new Set((await db.selectFrom('test_run_entrants').select('account_id').where('run_id', '!=', r.id).where('account_id', 'in', r.accounts).execute()).map((x) => x.account_id))].sort();
    expect(held.length).toBeGreaterThan(0);
    const d = await drainBatches(db, r.id);
    expect(d.last.kept).toEqual({ orders: 0, entries: 0, accounts: held.length });
    expect(d.deletedAccounts).toEqual(r.accounts.filter((a) => !held.includes(a)).sort());
    expect(await count(db, `drop_entries WHERE drop_id = '${r.drop}'`)).toBe(0);
    for (const a of r.accounts) expect(await exists(db, a)).toBe(held.includes(a));
  }, 240_000);
});

/**
 * A press taking `account` between step 10's first reading and its lock, in the same call (PGlite has one connection:
 * the helper the step calls first is wrapped, and on its first answer naming the account, a new test RUNNING takes it
 * as takePool does). Answers the run made; `restore` puts the helper back.
 */
async function takeMeanwhile(w: World, account: string, dropId: string): Promise<{ run: string; restore: () => Promise<void> }> {
  const run = randomUUID();
  await sql.raw(`ALTER FUNCTION orbes_purge_free(uuid[], bigint) RENAME TO orbes_purge_free_t4`).execute(w.db);
  await sql.raw(`CREATE TABLE t4_take (account uuid NOT NULL, run uuid NOT NULL, drop_id uuid NOT NULL, admin uuid NOT NULL, done boolean NOT NULL DEFAULT false)`).execute(w.db);
  await sql`INSERT INTO t4_take (account, run, drop_id, admin) VALUES (${account}, ${run}, ${dropId}, ${w.admin.id})`.execute(w.db);
  await sql.raw(`
    CREATE FUNCTION orbes_purge_free(p_ids uuid[], p_cap bigint) RETURNS uuid[] LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE v_out uuid[]; k record;
    BEGIN
      v_out := orbes_purge_free_t4(p_ids, p_cap);
      FOR k IN SELECT * FROM t4_take WHERE NOT done AND account = ANY (v_out) LOOP
        INSERT INTO test_runs (id, drop_id, mode, settings, entrants, created_by) VALUES (k.run, k.drop_id, 'DRAW', '[]', 1, k.admin);
        INSERT INTO test_run_entrants (run_id, account_id, network, plan) VALUES (k.run, k.account, '100.64.200.0/24', '{}');
        UPDATE t4_take SET done = true WHERE account = k.account;
      END LOOP;
      RETURN v_out;
    END $$`).execute(w.db);
  return {
    run,
    restore: async () => {
      expect((await sql<{ done: boolean }>`SELECT done FROM t4_take`.execute(w.db)).rows).toEqual([{ done: true }]);
      await sql.raw(`DROP FUNCTION orbes_purge_free(uuid[], bigint)`).execute(w.db);
      await sql.raw(`ALTER FUNCTION orbes_purge_free_t4(uuid[], bigint) RENAME TO orbes_purge_free`).execute(w.db);
      await sql.raw(`DROP TABLE t4_take`).execute(w.db);
      // The press's test, ended (its bots never came).
      await sql`UPDATE test_runs SET status = 'ENDED', ended_at = now(), ended_by = ${w.admin.id} WHERE id = ${run}`.execute(w.db);
    },
  };
}

describe('PURGE ALL\'s pool sweep', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  const refusedUnchanged = (p: () => Promise<unknown>, reason: string, label = reason) => refusedAsWas(w.db, p, reason, label);
  const setState = (id: string, state: 'PURGING' | 'PAUSED', reason: string | null) => w.db.updateTable('test_runs').set({ purge_state: state, purge_reason: reason }).where('id', '=', id).execute();
  /** A run's batches through step 9 (its windows written, its entrants gone), step 10 not begun. */
  async function throughStep9(id: string) {
    for (let i = 0; i < 100; i++) {
      const r = await batch(w.db, id);
      if (r.phase === 'RUN_ENTRANTS' && r.left === 0) return;
      expect(['ACCOUNTS', 'ACCOUNTS_DONE']).not.toContain(r.phase);
    }
    throw new Error('step 9 not reached');
  }

  it('refused without a PURGE ALL, with one of 24 h 01 min ago, a test running, a test neither running nor ended, a run of that PURGE ALL purging or paused for a window or a test, a forbidden window; a run paused for good does not hold it back: it deletes that run\'s accounts by their stored range; an account a press takes between two calls, or within one, is kept whole', async () => {
    const db = w.db;
    const r5 = await drawRun(w, { tiers: { titane: 8 }, drawn: false, title: 'SWEEP' });
    // No PURGE ALL at all; then one 24 h 01 min old (the chain's step-up, read against the database's clock).
    await refusedUnchanged(() => poolBatch(db), 'PURGE_ALL_NOT_REQUESTED');
    const saved = w.h.clock.now();
    w.h.clock.set(new Date(Date.now() - 24 * HOUR - MINUTE));
    await w.h.ctx.audit.record({ actor: w.admin, action: 'admin.step_up', targetType: 'admin', targetId: w.admin.id, details: { purpose: 'test_run.purge_all' } });
    w.h.clock.set(saved);
    await refusedUnchanged(() => poolBatch(db), 'PURGE_ALL_NOT_REQUESTED', 'a PURGE ALL of yesterday');
    // A test running; then STOPPED: neither running nor ended.
    const d7 = await openDraw(w, { title: 'SWEEP, ANOTHER RELEASE' });
    const running = await w.tests.start(d7, press(d7, { titane: 1 }), w.f.admin);
    await refusedUnchanged(() => poolBatch(db), 'PURGE_TEST_RUNNING');
    await w.tests.stop(running.id, w.f.admin);
    await refusedUnchanged(() => poolBatch(db), 'PURGE_RUNS_NOT_ENDED');
    await w.tests.end(running.id, testPhrase(d7, true), w.f.admin);
    // A test asked alone, its summary saying PURGE ALL: the chain decides, nothing the app wrote.
    await request(w, running.id, { summary: { all: true } });
    await refusedUnchanged(() => poolBatch(db), 'PURGE_ALL_NOT_REQUESTED', 'a summary saying all');

    // PURGE ALL asked: its run purging, or paused for a window or a running test, holds the sweep back.
    const su = await requestAll(w, [r5.id]);
    expect((await db.selectFrom('test_runs').select('purge_step_up_id').where('id', '=', r5.id).executeTakeFirstOrThrow()).purge_step_up_id).toBe(su);
    await refusedUnchanged(() => poolBatch(db), 'PURGE_ALL_NOT_DONE', 'its run PURGING');
    await setState(r5.id, 'PAUSED', 'PURGE_WINDOW');
    await refusedUnchanged(() => poolBatch(db), 'PURGE_ALL_NOT_DONE', 'its run paused for a window');
    await setState(r5.id, 'PAUSED', 'PURGE_TEST_RUNNING');
    await refusedUnchanged(() => poolBatch(db), 'PURGE_ALL_NOT_DONE', 'its run paused for a running test');
    // Its run through step 9, then stopped for good (a database refusal): no longer in the way.
    await setState(r5.id, 'PURGING', null);
    await throughStep9(r5.id);
    await setState(r5.id, 'PAUSED', 'PURGE_STUCK');
    expect(await count(db, `test_run_entrants WHERE run_id = '${r5.id}'`)).toBe(0);
    // The accounts the sweep may take: the run's, in no test any more (the test of d7 took one of them back from the pool).
    const free = (await db.selectFrom('test_entrants').select('account_id').where('account_id', 'in', r5.accounts).where((eb) => eb.not(eb.exists(eb.selectFrom('test_run_entrants as e').select('e.account_id').whereRef('e.account_id', '=', 'test_entrants.account_id')))).orderBy('account_id').execute()).map((x) => x.account_id);
    expect(free.length).toBeGreaterThanOrEqual(7);
    const wholeBefore = new Map<string, Record<string, string[]>>();
    for (const a of free) wholeBefore.set(a, await rowsNaming(db, [a], ['test_runs', 'accounts', 'test_entrants']));
    /**
     * Every row the account had is still there (a press may have added its own, and writes its country, age, tier and
     * seniority on its account and pool rows: those two rows are there, one each).
     */
    const whole = async (a: string) => {
      const now = await rowsNaming(db, [a], ['test_runs', 'accounts', 'test_entrants']);
      for (const [t, rows] of Object.entries(wholeBefore.get(a)!)) for (const r of rows) expect(now[t] ?? [], `${a} ${t}`).toContain(r);
      expect([await count(db, `accounts WHERE id = '${a}'`), await count(db, `test_entrants WHERE account_id = '${a}'`)]).toEqual([1, 1]);
    };
    // In a forbidden window, now or at the 1-minute margin's end: refused.
    await windowIs(w.db, `SELECT 'BACKUP'::text`);
    await refusedUnchanged(() => poolBatch(db), 'PURGE_WINDOW');
    await windowIs(w.db, `SELECT CASE WHEN p_at > now() + interval '30 seconds' THEN 'NIGHT' END`);
    await refusedUnchanged(() => poolBatch(db), 'PURGE_WINDOW', 'the 1-minute margin');
    await sql.raw(WINDOWS_OPEN).execute(db);

    // One account a call (10 / 10): the first goes, whole.
    const deleted: string[] = [];
    const one = await poolBatch(db, 10);
    expect(one).toMatchObject({ phase: 'POOL', deletedAccounts: [free[0]] });
    deleted.push(...one.deletedAccounts);
    // A press between two calls: takePool takes two accounts of the pool; whole, never half deleted, kept by the sweep.
    const d9 = await openDraw(w, { title: 'SWEEP, A PRESS BETWEEN' });
    const pressed = await w.tests.start(d9, press(d9, { titane: 3 }), w.f.admin);
    // (takePool takes the pool's first addresses: the one d7's test holds may be among them.)
    const taken = (await accountsOf(w, pressed.id)).filter((a) => free.includes(a));
    expect(taken.length).toBeGreaterThanOrEqual(2);
    expect(taken).not.toContain(free[0]);
    await refusedUnchanged(() => poolBatch(db, 10), 'PURGE_TEST_RUNNING', 'the press running');
    await drive(w, 0);
    await w.tests.end(pressed.id, testPhrase(d9, true), w.f.admin);
    // A press within a call: the account taken between step 10's first reading and its lock stays whole; the others go.
    const rest = free.filter((a) => a !== free[0] && !taken.includes(a));
    expect(rest.length).toBeGreaterThanOrEqual(3);
    const within = rest[0]!;
    const hook = await takeMeanwhile(w, within, await openDraw(w, { title: 'SWEEP, A PRESS WITHIN' }));
    const two = await poolBatch(db, 500);
    await hook.restore();
    expect(two.deletedAccounts).toEqual(rest.filter((a) => a !== within));
    deleted.push(...two.deletedAccounts);
    // Nothing left: the pool's accounts held by a test are none of its business.
    expect(await poolBatch(db, 500)).toMatchObject({ phase: 'POOL_DONE', deletedAccounts: [], left: 0 });
    for (const a of [...taken, within]) {
      expect(await exists(db, a)).toBe(true);
      await whole(a);
    }
    for (const a of deleted) expect(await exists(db, a)).toBe(false);
    expect(await auditNaming(db, deleted)).toBe(0);
    expect(await leftovers(db, deleted)).toEqual({});
    expect(await chainOk(w)).toBeGreaterThan(0);
  }, 240_000);
});

describe('what keeps a test account, or an order, where it is (anti-disguise G11, H11, G20)', () => {
  // A world each: no test account of another case's run comes back from the pool.
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, 120_000);
  afterEach(() => w?.h.close());

  const register = async (o: { invite?: string } = {}) => {
    const email = `real-${randomUUID().slice(0, 8)}@example.com`;
    const r = await w.h.ctx.services.auth.registerAccount({ email, password: PASSWORD, firstName: 'Léa', lastName: 'Martin', country: 'FR', ...(o.invite ? { invite: o.invite } : {}) });
    return r.account.id;
  };

  it('a founding-list row, a real invitee through the account\'s own link, a real account naming it as its inviter, a real friend vault naming it, and a real sign-up disguised as a test account: each kept, counted, every row byte-identical, no 23503, no pause; the others deleted', async () => {
    const db = w.db;
    let disguised = '';
    const run = await drawRun(w, {
      tiers: { titane: 7 },
      drawn: false,
      title: 'KEEPS',
      beforeDraw: async (r) => {
        // A real collector, registered through AuthService (its account.register row), in the test's release too.
        disguised = await register();
        await w.h.ctx.services.drops.enter(disguised, r.drop, { type: 'account', id: disguised });
      },
    });
    const [t0, t1, t2, t3] = run.accounts;
    // t0: matched to a row of the founding list (a crafted match: the service never matches a test account).
    const pre = await w.h.ctx.services.founding.register({ email: `founding-${randomUUID().slice(0, 8)}@example.com`, firstName: 'Léa', country: 'FR', consent: true }, { type: 'system', id: 'public' });
    expect(pre.outcome).toBe('ADDED');
    await sql`UPDATE preregistrations SET account_id = ${t0}, matched_at = now() WHERE account_id IS NULL`.execute(db);
    // t1: a real collector signed up through t1's personal invitation link.
    const { code } = await w.h.ctx.services.vault.invitation(t1!);
    const invitee = await register({ invite: code });
    expect((await db.selectFrom('accounts').select('invited_by').where('id', '=', invitee).executeTakeFirstOrThrow()).invited_by).toBe(t1);
    // t2: named as the inviter of a real account, and by nothing else.
    const named = await register();
    await db.updateTable('accounts').set({ invited_by: t2!, invited_at: w.h.clock.now() }).where('id', '=', named).execute();
    // t3: the friend of a real collector's vault (THE VAULT never gives one for a test account: crafted).
    const giver = await register();
    const at = w.h.clock.now();
    await db
      .insertInto('vaults')
      .values({ account_id: giver, source: 'FRIEND', friend_account_id: t3!, occasion_key: `FRIEND:${t3}`, occasion_index: 1, given_at: at, waits_until: new Date(at.getTime() + 30 * 24 * HOUR) })
      .execute();
    // The real sign-up disguised as a test account: in the pool and in the test, its address and hash the test's.
    const n = 9000 + Math.floor(Math.random() * 900);
    await db.insertInto('test_entrants').values({ account_id: disguised }).execute();
    await db.insertInto('test_run_entrants').values({ run_id: run.id, account_id: disguised, network: '100.64.250.0/24', plan: jsonText({}) }).execute();
    await db.updateTable('accounts').set({ email: `test-${n}@orbes.test`, email_normalized: `test-${n}@orbes.test`, password_hash: '!test-entrant: never signs in' }).where('id', '=', disguised).execute();
    expect(await count(db, `audit_logs WHERE action = 'account.register' AND target_id = '${disguised}'`)).toBe(1);

    const kept = [t0!, t1!, t2!, t3!, disguised];
    const reals = [invitee, named, giver];
    const before = new Map<string, Record<string, string[]>>();
    for (const a of [...kept, ...reals]) before.set(a, await rowsNaming(db, [a], ['test_runs']));
    const d = await purge(w, run.id);
    // No pause, no foreign key met: every batch answered, ACCOUNTS_DONE.
    expect(d.last.phase).toBe('ACCOUNTS_DONE');
    expect(d.last.kept.accounts).toBe(5);
    expect(d.deletedAccounts).toEqual(run.accounts.slice(4).sort());
    // The real accounts and the disguised one: every row, every row of the log, byte for byte.
    for (const a of [...reals, disguised]) expect(await rowsNaming(db, [a], ['test_runs']), a).toEqual(before.get(a));
    // The four test accounts: kept whole (the account, its pool row, what named it: the founding-list row, the invitation,
    // the invitee's and the vault's rows); their rows of the test itself (entry, its audit row, the run's entrant) went
    // with the test, as every test account's do (steps 6, 7 and 9).
    const theTest = ['drop_entries', 'audit_logs', 'test_run_entrants'];
    for (const a of kept.slice(0, 4)) {
      const was = Object.fromEntries(Object.entries(before.get(a)!).filter(([t]) => !theTest.includes(t)));
      expect(await rowsNaming(db, [a], ['test_runs', ...theTest]), a).toEqual(was);
      expect(Object.keys(was)).toEqual(expect.arrayContaining(['accounts', 'test_entrants']));
    }
    expect(Object.keys(before.get(t0!)!)).toContain('preregistrations');
    expect(Object.keys(before.get(t1!)!)).toContain('invitations');
    expect(before.get(t2!)!.accounts).toHaveLength(2);
    expect(Object.keys(before.get(t3!)!)).toContain('vaults');
    // The disguised account: not even its entry in the release, nor its pool rows, nor a row of the log naming it.
    expect(before.get(disguised)!.drop_entries).toHaveLength(1);
    expect(before.get(disguised)!.test_run_entrants).toHaveLength(1);
    expect(before.get(disguised)!.audit_logs!.length).toBeGreaterThan(1);
    expect(await chainOk(w)).toBeGreaterThan(0);
  }, 240_000);

  it('a real collector\'s CANCELLED order linked to a test order (crafted): both kept, the real one byte-identical, the test order with its entry and account', async () => {
    const db = w.db;
    const other = await openDraw(w, { title: 'A REAL ORDER', quantity: 1, priceMinor: 90_000 });
    const real = await createAccount(db);
    await w.h.ctx.services.drops.enter(real.id, other, real.actor);
    let realOrder = '';
    const run = await drawRun(w, {
      tiers: { titane: 3 },
      drawn: true,
      quantity: 3,
      priceMinor: 50_000,
      title: 'A TEST ORDER LINKED',
      afterDraw: async () => {
        await w.h.ctx.services.drops.draw(other, w.f.admin);
        const place = await db.selectFrom('drop_entries').select('id').where('drop_id', '=', other).where('account_id', '=', real.id).executeTakeFirstOrThrow();
        await w.h.ctx.services.drops.confirm(other, place.id, null, w.f.admin);
        realOrder = (await db.selectFrom('orders').select('id').where('account_id', '=', real.id).executeTakeFirstOrThrow()).id;
        await w.h.ctx.services.orders.transition(realOrder, { to: 'CANCELLED', note: 'Cancelled by Client Services.' }, w.admin);
      },
    });
    const testOrders = await db.selectFrom('orders').select(['id', 'account_id']).where('drop_id', '=', run.drop).orderBy('id').execute();
    expect(testOrders).toHaveLength(3);
    const linked = testOrders[0]!;
    // The crafted link: the real order travelling with a test order.
    await sql.raw(`ALTER TABLE orders DISABLE TRIGGER orders_immutable_identity`).execute(db);
    await db.updateTable('orders').set({ with_order_id: linked.id }).where('id', '=', realOrder).execute();
    await sql.raw(`ALTER TABLE orders ENABLE TRIGGER orders_immutable_identity`).execute(db);
    const realRows = await rowsNaming(db, [real.id, realOrder], ['test_runs']);
    const holderRows = await rowsNaming(db, [linked.account_id], ['test_runs']);
    const d = await purge(w, run.id);
    expect(d.last.kept).toEqual({ orders: 1, entries: 1, accounts: 1 });
    expect(await rowsNaming(db, [real.id, realOrder], ['test_runs'])).toEqual(realRows);
    expect(await rowsNaming(db, [linked.account_id], ['test_runs'])).toEqual(holderRows);
    expect(d.deletedAccounts).toEqual(run.accounts.filter((a) => a !== linked.account_id).sort());
    expect(await count(db, `orders WHERE id IN ('${testOrders[1]!.id}', '${testOrders[2]!.id}')`)).toBe(0);
    expect(await chainOk(w)).toBeGreaterThan(0);
  }, 240_000);

  it('a run whose created_at was moved back a day (an UPDATE): no audit row older than its test_run.start is deleted', async () => {
    const db = w.db;
    const drop = await openDraw(w, { title: 'MOVED BACK' });
    // Before the test: a row an earlier test's END TEST would write on this release (an interest withdrawn), and a
    // row of a real collector there; both match the purge's entry rows but by their place in the chain.
    const early = await w.h.ctx.audit.record({ actor: w.admin, action: 'drop.live.interest.withdraw', targetType: 'drop', targetId: drop, details: { reason: 'test_ended' } });
    const real = await createAccount(db);
    await w.h.ctx.services.drops.enter(real.id, drop, real.actor);
    w.h.clock.advance(MINUTE);
    const started = await w.tests.start(drop, press(drop, { titane: 3 }), w.f.admin);
    await drive(w, 0);
    await w.tests.end(started.id, testPhrase(drop, true), w.f.admin);
    await w.h.ctx.services.drops.cancel(drop, w.f.admin);
    await db.updateTable('test_runs').set({ created_at: new Date(w.h.clock.now().getTime() - 24 * HOUR) }).where('id', '=', started.id).execute();
    const fromId = Number((await db.selectFrom('audit_logs').select('id').where('action', '=', 'test_run.start').where('target_id', '=', started.id).executeTakeFirstOrThrow()).id);
    const older = (await db.selectFrom('audit_logs').select('id').where('id', '<', fromId).execute()).map((r) => Number(r.id));
    expect(older).toContain(early.id);
    const d = await purge(w, started.id);
    expect(d.deletedAccounts).toHaveLength(3);
    const gaps = (await db.selectFrom('audit_purge_gaps').select('id').where('run_id', '=', started.id).execute()).map((g) => Number(g.id));
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThan(fromId);
    expect((await db.selectFrom('audit_logs').select('id').where('id', '<', fromId).execute()).map((r) => Number(r.id))).toEqual(older);
    expect(await chainOk(w)).toBeGreaterThan(0);
  }, 240_000);
});

describe('step 10, one account at a time, whole (M15, F25; PGlite: the logic, PURGE.13 the two connections)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  }, 120_000);
  afterAll(() => w?.h.close());

  it('each account deleted in one call with all its rows; a press between two calls takes accounts that are whole and keeps them; one within a call (the step\'s helper wrapped) too; the step locks the pool rows, then the accounts, re-checks, then deletes', async () => {
    const db = w.db;
    const r = await drawRun(w, {
      tiers: { titane: 5 },
      drawn: false,
      title: 'ATOMIC',
      beforeDraw: async (x) => {
        for (const a of x.accounts) await w.h.ctx.services.sizes.set(a, { RING: 54 }, { type: 'account', id: a });
      },
    });
    const own = async (a: string) => ({
      accounts: await count(db, `accounts WHERE id = '${a}'`),
      test_entrants: await count(db, `test_entrants WHERE account_id = '${a}'`),
      account_sizes: await count(db, `account_sizes WHERE account_id = '${a}'`),
      audit: await count(db, `audit_logs WHERE (actor_type = 'account' AND actor_id = '${a}') OR (target_type = 'account' AND target_id = '${a}')`),
    });
    // Whole once steps 1 to 9 are done: its account, pool row, size and the log's row of its size (its entry's went at step 6).
    const WHOLE = { accounts: 1, test_entrants: 1, account_sizes: 1, audit: 1 };
    const GONE = { accounts: 0, test_entrants: 0, account_sizes: 0, audit: 0 };
    for (const a of r.accounts) expect(await own(a)).toEqual({ ...WHOLE, audit: 2 });
    await request(w, r.id);
    // Through step 9, then step 10 one account a call (10 / 10): the first goes, every row of it, in that one call.
    let first: Batch | undefined;
    for (let i = 0; i < 50 && first?.phase !== 'ACCOUNTS'; i++) first = await batch(db, r.id, 10);
    expect(first!.deletedAccounts).toHaveLength(1);
    expect(first!.deleted).toMatchObject({ accounts: 1, test_entrants: 1, account_sizes: 1, audit_logs: 1 });
    const gone = first!.deletedAccounts[0]!;
    expect(await own(gone)).toEqual(GONE);
    // Every other account is still whole between the two calls.
    const rest = r.accounts.filter((a) => a !== gone);
    for (const a of rest) expect(await own(a)).toEqual(WHOLE);
    // A press between two calls: takePool takes two of them (in no test since step 9), whole.
    const d2 = await openDraw(w, { title: 'ATOMIC, A PRESS BETWEEN' });
    const pressed = await w.tests.start(d2, press(d2, { titane: 2 }), w.f.admin);
    const taken = await accountsOf(w, pressed.id);
    expect(taken.every((a) => rest.includes(a))).toBe(true);
    await refused(batch(db, r.id, 10), 'PURGE_TEST_RUNNING');
    await drive(w, 0);
    await w.tests.end(pressed.id, testPhrase(d2, true), w.f.admin);
    for (const a of taken) expect((await own(a)).account_sizes).toBe(1);
    // A press within a call, between the step's first reading and its lock: that account too stays whole.
    const left = rest.filter((a) => !taken.includes(a));
    const within = left[0]!;
    const hook = await takeMeanwhile(w, within, await openDraw(w, { title: 'ATOMIC, A PRESS WITHIN' }));
    const second = await batch(db, r.id, 500);
    await hook.restore();
    expect(second.deletedAccounts).toEqual(left.filter((a) => a !== within).sort());
    expect(await own(within)).toEqual(WHOLE);
    const d = await drainBatches(db, r.id, 10);
    expect(d.deletedAccounts).toEqual([]);
    // The three kept: in a test again (two by the press between, one within).
    expect(d.last.kept.accounts).toBe(3);
    for (const a of [...taken, within]) expect(await exists(db, a)).toBe(true);
    for (const a of [gone, ...second.deletedAccounts]) expect(await own(a)).toEqual(GONE);
    expect(await chainOk(w)).toBeGreaterThan(0);

    // The source: the pool rows then the accounts FOR UPDATE (takePool's lock first, as it takes it), the re-check under
    // them, and only then the deletes, the accounts last.
    const src = (await sql<{ def: string }>`SELECT pg_get_functiondef('orbes_purge_accounts(uuid[], int, bigint, uuid)'::regprocedure) AS def`.execute(db)).rows[0]!.def;
    const at = (s: string) => {
      const i = src.indexOf(s);
      expect(i, s).toBeGreaterThan(0);
      return i;
    };
    const order = [
      at('PERFORM 1 FROM test_entrants WHERE account_id = ANY (v_take) ORDER BY account_id FOR UPDATE'),
      at('PERFORM 1 FROM accounts WHERE id = ANY (v_take) ORDER BY id FOR UPDATE'),
      at('v_take := orbes_purge_scope(v_take)'),
      at('NOT EXISTS (SELECT 1 FROM test_run_entrants e WHERE e.account_id = x)'),
      at('v_take := orbes_purge_free(v_take, v_cap)'),
      at('DELETE FROM sessions'),
      at('DELETE FROM audit_logs'),
      at("EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)'"),
      at('DELETE FROM accounts WHERE id = ANY (v_take)'),
    ];
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  }, 240_000);
});

/**
 * A log of 200,000 rows around one ended test of 60 accounts, written as a restore writes it (every row in ONE
 * transaction: one xmin) and row by row (each its own transaction), with the same ids (H9). Rows just before the test's
 * `test_run.start`: five grants naming five of its accounts, and an interest withdrawn on its release by an earlier
 * test's END TEST. Each part of the log the purge reads: before the test, inside it (the test's own rows among 120,000
 * of other collectors), after it.
 */
function restoreSeed() {
  const uuid = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const admin = uuid('a', 1);
  const model = uuid('e', 1);
  const drop = uuid('f', 1);
  const other = uuid('f', 2);
  const run = uuid('9', 1);
  const N = 60;
  const accounts = Array.from({ length: N }, (_, i) => uuid('b', i + 1));
  const entries = Array.from({ length: N }, (_, i) => uuid('c', i + 1));
  const T = Date.parse('2026-10-20T08:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const rows: string[] = [];
  rows.push(`INSERT INTO admin_users (id, email_normalized, email, password_hash, role) VALUES ('${admin}', 'seed-admin@orbes.test', 'seed-admin@orbes.test', 'scrypt$x', 'ADMIN')`);
  rows.push(`INSERT INTO categories (id, code, name) VALUES (29, 'X', 'SEED CAT')`);
  rows.push(`INSERT INTO models (id, category_id, name, type, sku_prefix) VALUES ('${model}', 29, 'SEED MODEL', 'RING', 'SEE')`);
  for (const [id, title] of [[drop, 'SEED TEST'], [other, 'SEED OTHER']] as const) {
    rows.push(
      `INSERT INTO drops (id, model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, cancelled_at)
       VALUES ('${id}', '${model}', '${title}', 1, '${iso(T)}', '${iso(T + 4 * HOUR)}', 'v1.${'A'.repeat(16)}.${'B'.repeat(64)}', '\\x${'00'.repeat(32)}', '${iso(T + 5 * HOUR)}')`,
    );
  }
  accounts.forEach((a, i) => {
    const email = `test-${String(i + 1).padStart(4, '0')}@orbes.test`;
    rows.push(`INSERT INTO accounts (id, email, email_normalized, password_hash, display_name, created_at) VALUES ('${a}', '${email}', '${email}', '!test-entrant: never signs in', 'TEST ${i + 1}', '${iso(T)}')`);
    rows.push(`INSERT INTO test_entrants (account_id, created_at) VALUES ('${a}', '${iso(T)}')`);
  });
  rows.push(`INSERT INTO test_runs (id, drop_id, mode, settings, entrants, created_by, created_at) VALUES ('${run}', '${drop}', 'DRAW', '[]', ${N}, '${admin}', '${iso(T + HOUR)}')`);
  accounts.forEach((a, i) => {
    rows.push(`INSERT INTO test_run_entrants (run_id, account_id, network, plan) VALUES ('${run}', '${a}', '100.64.${i}.0/24', '{}')`);
    rows.push(`INSERT INTO drop_entries (id, drop_id, account_id, status, created_at) VALUES ('${entries[i]}', '${drop}', '${a}', 'WITHDRAWN', '${iso(T + HOUR + 1000 + i)}')`);
  });
  rows.push(`UPDATE test_runs SET status = 'ENDED', ended_at = '${iso(T + 2 * HOUR)}', ended_by = '${admin}' WHERE id = '${run}'`);
  // The log, by id.
  let id = 0;
  const log = (at: number, actorType: string, actorId: string | null, action: string, targetType: string, targetId: string, details: object = {}) => {
    id++;
    rows.push(
      `INSERT INTO audit_logs (id, occurred_at, actor_type, actor_id, action, target_type, target_id, details, prev_hash, hash)
       VALUES (${id}, '${iso(at)}', '${actorType}', ${actorId ? `'${actorId}'` : 'NULL'}, '${action}', '${targetType}', '${targetId}', '${JSON.stringify(details)}', sha256(convert_to('p${id}', 'UTF8')), sha256(convert_to('h${id}', 'UTF8')))`,
    );
    return id;
  };
  const collector = (k: number) => uuid('d', k % 5000);
  const TOTAL = 200_000;
  const BEFORE = 40_000;
  for (let k = 0; k < BEFORE; k++) log(T + 30 * MINUTE + k, 'account', collector(k), 'drop.enter', 'drop', other);
  // Just before the test's start: its accounts' grants (rows naming five of them, before any range of theirs), an
  // interest an earlier test's END TEST withdrew on its release.
  const preStart = [
    ...accounts.slice(0, 5).map((a) => log(T + 59 * MINUTE, 'system', null, 'club.grant', 'account', a, { tier: 2 })),
    log(T + 59 * MINUTE + 1, 'admin', admin, 'drop.live.interest.withdraw', 'drop', drop, { reason: 'test_ended' }),
  ];
  const start = log(T + HOUR, 'admin', admin, 'test_run.start', 'test_run', run, { dropId: drop });
  const INSIDE = 120_000;
  const every = Math.floor(INSIDE / N);
  let n = 0;
  for (let k = 0; k < INSIDE; k++) {
    const at = T + HOUR + 1000 + k * 20;
    if (k % every === 0 && n < N) {
      const a = accounts[n]!;
      log(at, 'account', a, 'drop.enter', 'drop', drop, { entryId: entries[n] });
      log(at + 1, 'system', null, 'club.grant', 'account', a, { tier: 1 });
      log(at + 2, 'account', a, 'account.sizes.update', 'account', a, { set: ['RING'], cleared: [] });
      n++;
    } else log(at, 'account', collector(k), 'drop.enter', 'drop', other);
  }
  log(T + 2 * HOUR, 'admin', admin, 'test_run.end', 'test_run', run, { dropId: drop });
  while (id < TOTAL) log(T + 3 * HOUR + id, 'account', collector(id), 'drop.enter', 'drop', other);
  rows.push(`SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), ${TOTAL})`);
  return { rows, admin, drop, run, accounts, entries, preStart, start, total: TOTAL };
}

describe('the log as a restore writes it (H9), and one step-10 batch on 200,000 rows', () => {
  const seed = restoreSeed();
  const dbs: Record<'one' | 'each', TestDb> = {} as Record<'one' | 'each', TestDb>;
  beforeAll(async () => {
    for (const mode of ['one', 'each'] as const) {
      const t = await createTestDb();
      await sql.raw(WINDOWS_OPEN).execute(t.db);
      if (mode === 'one') {
        await t.pglite.exec('BEGIN');
        for (let i = 0; i < seed.rows.length; i += 5000) await t.pglite.exec(seed.rows.slice(i, i + 5000).join(';\n'));
        await t.pglite.exec('COMMIT');
      } else {
        for (let i = 0; i < seed.rows.length; i += 5000) await t.pglite.exec(seed.rows.slice(i, i + 5000).map((r) => `BEGIN; ${r}; COMMIT;`).join('\n'));
      }
      dbs[mode] = t;
    }
  }, 300_000);
  afterAll(async () => {
    for (const t of Object.values(dbs)) await t?.close();
  });

  /** The request as the service writes it, on a raw database: the admin's row, its step-up, PURGING, purge.start. */
  const requestRaw = (db: Db) =>
    db.transaction().execute(async (tx) => {
      await sql`UPDATE admin_users SET failed_logins = 0 WHERE id = ${seed.admin}`.execute(tx);
      const su = await sql<{ id: string }>`
        INSERT INTO audit_logs (occurred_at, actor_type, actor_id, action, target_type, target_id, details, prev_hash, hash)
        VALUES (now(), 'admin', ${seed.admin}, 'admin.step_up', 'admin', ${seed.admin}, ${jsonText({ purpose: `test_run.purge:${seed.run}` })}::jsonb,
                sha256(convert_to('p-step-up', 'UTF8')), sha256(convert_to('h-step-up', 'UTF8'))) RETURNING id`.execute(tx);
      await sql`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = ${seed.admin}, purge_summary = '{"all": false}' WHERE id = ${seed.run}`.execute(tx);
      await sql`
        INSERT INTO audit_logs (occurred_at, actor_type, actor_id, action, target_type, target_id, details, prev_hash, hash)
        VALUES (now(), 'admin', ${seed.admin}, 'test_run.purge.start', 'test_run', ${seed.run}, '{}', sha256(convert_to('p-start', 'UTF8')), sha256(convert_to('h-start', 'UTF8')))`.execute(tx);
      return Number(su.rows[0]!.id);
    });

  it('one xmin for the whole log or one a row: the same bounds (fromId the test_run.start id), the same rows deleted, the rows before the start kept; every call of step 10 far under the 20 s statement timeout', async () => {
    const xmins = async (db: Db) => Number((await sql<{ n: string }>`SELECT count(DISTINCT xmin::text) AS n FROM audit_logs`.execute(db)).rows[0]!.n);
    expect(await xmins(dbs.one.db)).toBe(1);
    expect(await xmins(dbs.each.db)).toBe(seed.total);
    const out: Record<string, unknown> = {};
    for (const mode of ['one', 'each'] as const) {
      const db = dbs[mode].db;
      const stepUp = await requestRaw(db);
      const calls: { phase: string; ms: number; accounts: number }[] = [];
      const deletedAccounts: string[] = [];
      for (let i = 0; i < 100; i++) {
        const t0 = Date.now();
        // As the loop calls it (PURGE.5): one transaction a call, the statement timeout of 20 s.
        const r = await db.transaction().execute(async (tx) => {
          await sql`SET LOCAL statement_timeout = '20s'`.execute(tx);
          return batch(tx, seed.run, 500);
        });
        calls.push({ phase: r.phase, ms: Date.now() - t0, accounts: r.deletedAccounts.length });
        deletedAccounts.push(...r.deletedAccounts);
        if (r.phase === 'ACCOUNTS_DONE') break;
      }
      expect(calls.at(-1)!.phase).toBe('ACCOUNTS_DONE');
      const step10 = calls.filter((c) => c.phase === 'ACCOUNTS');
      expect(step10.length).toBeGreaterThan(0);
      expect(step10.every((c) => c.accounts <= 50)).toBe(true);
      const slowest = Math.max(...calls.map((c) => c.ms));
      expect(slowest, `the slowest call took ${slowest} ms`).toBeLessThan(10_000);
      const windows = (await sql<{ w: Record<string, unknown> }>`SELECT purge_windows AS w FROM test_runs WHERE id = ${seed.run}`.execute(db)).rows[0]!.w;
      expect(windows.fromId).toBe(seed.start);
      expect(windows.toId).toBe(stepUp);
      const gaps = (await sql<{ id: string }>`SELECT id FROM audit_purge_gaps ORDER BY id`.execute(db)).rows.map((g) => Number(g.id));
      expect(Math.min(...gaps)).toBeGreaterThan(seed.start);
      for (const p of seed.preStart) expect(await count(db, `audit_logs WHERE id = ${p}`)).toBe(1);
      expect(await count(db, `audit_logs WHERE id < ${seed.start}`)).toBe(seed.start - 1);
      out[mode] = { windows, gaps, deletedAccounts: deletedAccounts.sort(), stepUp, phases: [...new Set(calls.map((c) => c.phase))] };
    }
    expect(out.each).toEqual(out.one);
    const one = out.one as { gaps: number[]; deletedAccounts: string[]; windows: { accounts: string[] } };
    // The five accounts named before the test's start are out of its scope (kept); the 55 others go, with their rows.
    expect(one.windows.accounts).toEqual(seed.accounts.slice(5));
    expect(one.deletedAccounts).toEqual(seed.accounts.slice(5));
    expect(one.gaps).toHaveLength(55 * 3);
  }, 300_000);
});
