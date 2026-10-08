/**
 * TEST ENTRANTS (the owner's lot of 2026-10-07; services/test-entrants.ts, migration 0024_z), against a migrated
 * database, the whole app (its bots act through its own routes) and a manual clock; the runner's and the sweeper's
 * timers off, the tests driving `tick` and `sweep` themselves:
 *
 *  - the pool: `test-0001@orbes.test`, `TEST 0001`, ACTIVE, never signs in; a test not yet ended keeps its accounts (a
 *    DONE draw's tiers hold); once ended, reused by the next test of another release; created when short, capped at
 *    5 000 accounts in all; each account on its own network, the same in every test;
 *  - the two overrides: a test PALLADIUM entry ranks first in a draw (its tier and seniority from its test row), and a
 *    test account passes an owners-only LIVE rule, and a release open to a segment of owners;
 *  - the runner fills a slot as soon as its request ends;
 *  - START, ADD MORE, STOP and END TEST: their refusals and transitions (only RUNNING blocks; END TEST on DONE, STOPPED
 *    and INTERRUPTED); a restart leaves a RUNNING test INTERRUPTED;
 *  - a draw end to end: reservations in the early access, the entries at the opening, the staff's draw, the places
 *    confirmed by themselves (orders created), END TEST (orders cancelled, places lapsed, the report 5/5);
 *  - END TEST and the tier program (the next nine, BP-19 T5): PLATINE test entrants' orders carrying their welcome GIFT
 *    order and a credit taken off them, one paid: every order and GIFT order cancelled (the stock back), every credit
 *    given back (a credit left on a cancelled order too), the report 5/5; the grants stay, their credit whole again;
 *  - the early access by tier (BP-19 T3): PALLADIUM reserves from its time, a PLATINE test entrant waits for its own
 *    window, never refused; a start needs a tier whose window is open;
 *  - the report and the house's guarantee (IN-01): a guaranteed draw place of 2 pieces with its 2 orders, a guaranteed
 *    LIVE holder of no tier first in the line and over the per-account: every check passes;
 *  - a LIVE RELEASE end to end: I'LL BE THERE, the line at T0, PRESS, the hold, SECURE, PAY and RELEASE, END TEST; a
 *    size of the release set aside during the test (plan NEXT LOT §3.3): END TEST puts the stock back on its SKU;
 *  - the report's checks find a fault planted; the sweeper resumes a confirmation due after a restart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { buildApp } from '../../src/server/app.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { CLUB_TIER_THRESHOLDS, clubStandings, tierOf } from '../../src/server/services/club.js';
import { accessOf } from '../../src/server/services/live.js';
import { segmentMembers } from '../../src/server/services/segments.js';
import { ensureSku, stockLevel } from '../../src/server/services/stock.js';
import { creditBalances } from '../../src/server/services/tier-grants.js';
import { shareOf, splitOf, testPhrase, testRunSettings, TEST_RUN_DEFAULTS, TestEntrantService, type TestRunSettingsInput } from '../../src/server/services/test-entrants.js';
import { createHarness, type Harness } from '../api/support.js';
import { countPiecesIn, scanIntoParcel } from '../support/fulfil.js';
import { createAccount, createCollection, createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { poolDraw, withDrawSizes } from '../support/draws.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e, code).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

/** A press: the tiers, everything else by default unless given. */
const press = (dropId: string, tiers: Partial<TestRunSettingsInput['tiers']>, more: Omit<TestRunSettingsInput, 'tiers'> = {}) => ({
  phrase: testPhrase(dropId),
  tiers: { none: 0, titane: 0, platine: 0, palladium: 0, ...tiers },
  arrival: { mode: 'all' as const, interestPct: 0 },
  ...more,
});

interface World {
  h: Harness;
  f: LiveFixture;
  tests: TestEntrantService;
}

async function world(): Promise<World> {
  const h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
  const f = await liveFixtureOn(h.ctx, h.clock);
  const tests = h.app.testEntrants;
  tests.useTimers(false);
  // A bot driven by hand holds the seal on the server's clock.
  tests.sleep = async (ms) => {
    h.clock.advance(ms);
  };
  return { h, f, tests };
}

/** A draw published now: OPEN (its opening an hour ago) unless told otherwise. */
async function openDraw(w: World, o: { quantity?: number; opensIn?: number; closesIn?: number; earlyAccessHours?: number; earlyAccessPlatineHours?: number; priceMinor?: number } = {}) {
  const now = w.h.clock.now().getTime();
  const d = await poolDraw(
    w.h.ctx.services.drops,
    w.h.ctx.db,
    {
      modelId: w.f.modelId,
      title: 'MONOLITHE · TEST DRAW',
      quantity: o.quantity ?? 10,
      opensAt: new Date(now + (o.opensIn ?? -HOUR)),
      closesAt: new Date(now + (o.closesIn ?? HOUR)),
      earlyAccessHours: o.earlyAccessHours ?? 0,
      ...(o.earlyAccessPlatineHours !== undefined ? { earlyAccessPlatineHours: o.earlyAccessPlatineHours } : {}),
      ...(o.priceMinor !== undefined ? { priceMinor: o.priceMinor, currency: 'EUR' } : {}),
    },
    w.f.admin,
  );
  return d.id;
}

/**
 * The runner, `ms` of the server's clock in steps (the LIVE engine's pass with each when `live` is given): each step
 * a pass, its requests finished, and a second pass (the one that sees every bot done).
 */
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

const statusOf = async (w: World, runId: string) => (await w.h.ctx.db.selectFrom('test_runs').select('status').where('id', '=', runId).executeTakeFirstOrThrow()).status;

describe('settings and shares', () => {
  it('a press keeps the groups it does not send; the LIVE shares make 100; a draw never arrives « before »', () => {
    const s = testRunSettings({ tiers: { none: 0, titane: 5, platine: 0, palladium: 0 }, behaviour: { confirmPct: 40 } }, TEST_RUN_DEFAULTS, 'DRAW');
    expect(s.behaviour).toEqual({ ...TEST_RUN_DEFAULTS.behaviour, confirmPct: 40 });
    expect(s.profile).toEqual(TEST_RUN_DEFAULTS.profile);
    const tiers = { none: 1, titane: 0, platine: 0, palladium: 0 };
    expect(() => testRunSettings({ tiers: { none: 0, titane: 0, platine: 0, palladium: 0 } }, TEST_RUN_DEFAULTS, 'DRAW')).toThrow(/1 to 1000/);
    expect(() => testRunSettings({ tiers: { none: 600, titane: 401, platine: 0, palladium: 0 } }, TEST_RUN_DEFAULTS, 'DRAW')).toThrow(/1 to 1000/);
    expect(() => testRunSettings({ tiers, behaviour: { payPct: 90 } }, TEST_RUN_DEFAULTS, 'LIVE')).toThrow(/100 %/);
    expect(() => testRunSettings({ tiers, behaviour: { holdSeconds: 1.2 } }, TEST_RUN_DEFAULTS, 'LIVE')).toThrow(/1.5 to 10/);
    expect(() => testRunSettings({ tiers, arrival: { mode: 'before' } }, TEST_RUN_DEFAULTS, 'DRAW')).toThrow(/LIVE RELEASE/);
    expect(() => testRunSettings({ tiers, profile: { seniorityMin: 4, seniorityMax: 2 } }, TEST_RUN_DEFAULTS, 'DRAW')).toThrow(/Seniority/);
    expect(testRunSettings({ tiers, profile: { countries: ['fr', 'FR', 'gb'] } }, TEST_RUN_DEFAULTS, 'DRAW').profile.countries).toEqual(['FR', 'GB']);
  });

  it('a share is exact (70 % of 10 is 7), a split makes its total', () => {
    expect(shareOf(10, 70).filter(Boolean)).toHaveLength(7);
    expect(shareOf(3, 0).filter(Boolean)).toHaveLength(0);
    const split = splitOf(7, { PAY: 70, RELEASE: 20, MISS: 10, LEAVE: 0 });
    expect(split).toHaveLength(7);
    expect(split.filter((x) => x === 'PAY')).toHaveLength(5);
    expect(split.filter((x) => x === 'LEAVE')).toHaveLength(0);
  });
});

describe('the pool, the overrides, START / ADD MORE / STOP / END TEST', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('a press creates test-0001… (TEST 0001, ACTIVE, never signs in), sets each one\'s tier, and the next test of another release reuses them', async () => {
    const drop = await openDraw(w);
    const view = await w.tests.start(drop, press(drop, { none: 1, titane: 2, platine: 1, palladium: 1 }, { profile: { countries: ['FR'], accountAgeDaysMin: 100, accountAgeDaysMax: 100 } }), w.f.admin);
    expect(view.status).toBe('RUNNING');
    expect(view.entrants).toBe(5);
    expect(view.createdBy).toMatch(/@orbes\.test$/);
    const pool = await w.h.ctx.db
      .selectFrom('test_entrants as t')
      .innerJoin('accounts as a', 'a.id', 't.account_id')
      .select(['a.email', 'a.display_name', 'a.status', 'a.country', 'a.created_at', 't.tier'])
      .orderBy('a.email')
      .execute();
    expect(pool.map((p) => p.email)).toEqual(['test-0001@orbes.test', 'test-0002@orbes.test', 'test-0003@orbes.test', 'test-0004@orbes.test', 'test-0005@orbes.test']);
    expect(pool.map((p) => p.display_name)).toEqual(['TEST 0001', 'TEST 0002', 'TEST 0003', 'TEST 0004', 'TEST 0005']);
    expect(pool.every((p) => p.status === 'ACTIVE' && p.country === 'FR')).toBe(true);
    expect(pool.every((p) => w.h.clock.now().getTime() - new Date(p.created_at).getTime() === 100 * 86_400_000)).toBe(true);
    expect(pool.map((p) => p.tier).sort()).toEqual([0, 1, 1, 2, 3]);
    // Never signs in, whatever the password.
    const login = await w.h.client().post('/api/v1/account/login', { email: 'test-0001@orbes.test', password: 'correct horse battery staple' });
    expect(login.statusCode).toBe(401);

    // The bots enter through the route, signed in, each from its own network; then the test is DONE.
    await drive(w, 0);
    expect(await statusOf(w, view.id)).toBe('DONE');
    const after = await w.tests.view(view.id);
    expect(after.byTier.map((t) => [t.label, t.entered, t.inRoom])).toEqual([['NO TIER', 1, 1], ['TITANE', 2, 2], ['PLATINE', 1, 1], ['PALLADIUM', 1, 1]]);
    expect(after.release).toEqual({ real: 0, test: 5, total: 5 });
    const audit = await w.h.ctx.db.selectFrom('audit_logs').select(['actor_type', 'ip_hash']).where('action', '=', 'drop.enter').where('target_id', '=', drop).execute();
    expect(audit).toHaveLength(5);
    expect(audit.every((a) => a.actor_type === 'account')).toBe(true);
    const networks = await w.h.ctx.db.selectFrom('test_run_entrants').select('network').where('run_id', '=', view.id).execute();
    expect(new Set(networks.map((n) => n.network)).size).toBe(5);
    expect(networks.every((n) => /^100\.64\.\d+\.0\/24$/.test(n.network))).toBe(true);

    // Another release while the first test is DONE, its draw still to come: its five accounts stay its own (their tiers
    // hold for its draw, their sessions for its places), seven others are made; a withdrawal for every one asked.
    const poolSize = async () => Number((await w.h.ctx.db.selectFrom('test_entrants').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    const tiersOf = async (runId: string) =>
      (await w.h.ctx.db.selectFrom('test_run_entrants as r').innerJoin('test_entrants as t', 't.account_id', 'r.account_id').select('t.tier').where('r.run_id', '=', runId).execute()).map((r) => r.tier).sort();
    const emailsOf = async (runId: string) =>
      (await w.h.ctx.db.selectFrom('test_run_entrants as r').innerJoin('accounts as a', 'a.id', 'r.account_id').select('a.email').where('r.run_id', '=', runId).orderBy('a.email').execute()).map((r) => r.email);
    const other = await openDraw(w);
    const second = await w.tests.start(other, press(other, { titane: 7 }, { behaviour: { withdrawPct: 100 } }), w.f.admin);
    expect(second.entrants).toBe(7);
    expect(await poolSize()).toBe(12);
    expect(await emailsOf(second.id)).toEqual(Array.from({ length: 7 }, (_, k) => `test-${String(k + 6).padStart(4, '0')}@orbes.test`));
    expect(await tiersOf(view.id)).toEqual([0, 1, 1, 2, 3]);
    await drive(w, 0);
    expect(await statusOf(w, second.id)).toBe('RUNNING');
    await drive(w, 12_000, 1000);
    expect(await statusOf(w, second.id)).toBe('DONE');
    expect((await w.tests.view(second.id)).byTier[1]!.withdrawn).toBe(7);

    // A second test on the first release: other accounts (they entered it once), made since the others are held, each
    // on its own network, none of the first test's.
    await w.tests.end(view.id, testPhrase(drop, true), w.f.admin);
    const again = await w.tests.start(drop, press(drop, { titane: 2 }), w.f.admin);
    expect(await emailsOf(again.id)).toEqual(['test-0013@orbes.test', 'test-0014@orbes.test']);
    const nets = async (runId: string) => (await w.h.ctx.db.selectFrom('test_run_entrants').select('network').where('run_id', '=', runId).execute()).map((n) => n.network).sort();
    expect(await nets(again.id)).toEqual(['100.64.12.0/24', '100.64.13.0/24']);
    expect(await nets(view.id)).toEqual(['100.64.0.0/24', '100.64.1.0/24', '100.64.2.0/24', '100.64.3.0/24', '100.64.4.0/24']);
    await drive(w, 0);
    expect(await statusOf(w, again.id)).toBe('DONE');

    // Once ENDED, the first test's accounts go back to the pool: the next test of another release reuses them.
    const fourth = await openDraw(w);
    const reused = await w.tests.start(fourth, press(fourth, { titane: 5 }), w.f.admin);
    expect(await emailsOf(reused.id)).toEqual(await emailsOf(view.id));
    expect(await poolSize()).toBe(14);
    await drive(w, 0);
    expect(await statusOf(w, reused.id)).toBe('DONE');
  });

  it('the tier override: a test PALLADIUM entry ranks first in a draw, before a real owner; its standing is its test row\'s', async () => {
    const drop = await openDraw(w, { closesIn: 10 * MINUTE });
    const real = await createAccount(w.h.ctx.db);
    await holdPieces(w.h.ctx.db, real.id, 1, w.f.modelId, { startedAt: new Date('2020-01-01T00:00:00Z') });
    await w.h.ctx.services.drops.enter(real.id, drop, real.actor);
    const run = await w.tests.start(drop, press(drop, { none: 2, palladium: 1 }, { profile: { seniorityMin: 0, seniorityMax: 0 } }), w.f.admin);
    await drive(w, 0);
    const palladium = await w.h.ctx.db.selectFrom('test_entrants').select('account_id').where('tier', '=', 3).executeTakeFirstOrThrow();
    const standing = await tierOf(w.h.ctx.db, palladium.account_id, w.h.clock.now());
    // The pieces PALLADIUM starts from (CLUB_TIER_THRESHOLDS: 10 since the next nine's tier program).
    expect(standing).toEqual({ pieces: CLUB_TIER_THRESHOLDS[2], tier: 3, seniority: 0 });
    const many = await clubStandings(w.h.ctx.db, [palladium.account_id, real.id], w.h.clock.now());
    expect(many.get(real.id)!.tier).toBe(1);
    // A segment's TIER rule (a LIVE RELEASE's access by a segment) reads the same test row.
    const inTier = async (tiers: number[]) =>
      (await segmentMembers(w.h.ctx.db, { match: 'ALL', rules: [{ kind: 'TIER', tiers }] }, w.h.clock.now()).select('a.id').where('a.id', 'in', [palladium.account_id, real.id]).execute()).map((r) => r.id).sort();
    expect(await inTier([3])).toEqual([palladium.account_id]);
    expect(await inTier([0])).toEqual([]);
    expect(await inTier([1])).toEqual([real.id]);
    w.h.clock.advance(11 * MINUTE);
    await w.h.ctx.services.drops.draw(drop, w.f.admin);
    const ranked = await w.h.ctx.db.selectFrom('drop_entries').select(['account_id', 'rank', 'tier']).where('drop_id', '=', drop).orderBy('rank').execute();
    expect(ranked[0]).toMatchObject({ account_id: palladium.account_id, rank: 1, tier: 3 });
    expect(ranked[1]).toMatchObject({ account_id: real.id, rank: 2, tier: 1 });
    await w.tests.end(run.id, testPhrase(drop, true), w.f.admin);
  });

  it('the owners override: a test account passes an owners-only LIVE rule; a real account without the piece does not', async () => {
    const release = await createLiveRelease(w.f, { opensAt: new Date(w.h.clock.now().getTime() + 2 * MINUTE), accessModels: [w.f.modelId] });
    const d = await w.h.ctx.db.selectFrom('drops').selectAll().where('id', '=', release.id).executeTakeFirstOrThrow();
    const test = await w.h.ctx.db.selectFrom('test_entrants').select('account_id').limit(1).executeTakeFirstOrThrow();
    const real = await createAccount(w.h.ctx.db);
    expect(await accessOf(w.h.ctx.db, d, test.account_id, w.h.clock.now())).toMatchObject({ allowed: true, missing: null });
    expect(await accessOf(w.h.ctx.db, d, real.id, w.h.clock.now())).toMatchObject({ allowed: false, missing: 'PIECE' });

    // A release open to a segment of owners (a model's, a collection's): the test account is let in, the real one not.
    const collection = await createCollection(w.h.ctx.db, 'ORBIT');
    for (const rule of [{ kind: 'OWNS_MODEL' as const, modelIds: [w.f.modelId] }, { kind: 'OWNS_COLLECTION' as const, collectionIds: [collection] }]) {
      const segment = await w.h.ctx.services.segments.create({ name: `Owners ${rule.kind}`, criteria: { match: 'ALL', rules: [rule] } }, w.f.admin);
      const gated = await createLiveRelease(w.f, { opensAt: new Date(w.h.clock.now().getTime() + 2 * MINUTE), accessSegmentId: segment.id });
      const g = await w.h.ctx.db.selectFrom('drops').selectAll().where('id', '=', gated.id).executeTakeFirstOrThrow();
      expect(await accessOf(w.h.ctx.db, g, test.account_id, w.h.clock.now()), rule.kind).toMatchObject({ allowed: true, missing: null });
      expect(await accessOf(w.h.ctx.db, g, real.id, w.h.clock.now()), rule.kind).toMatchObject({ allowed: false, missing: 'SEGMENT' });
    }
  });

  it('refuses a wrong phrase, a release not open, a second RUNNING test; ADD MORE, STOP, and END TEST on STOPPED, DONE and INTERRUPTED', async () => {
    const drop = await openDraw(w);
    await rejects(w.tests.start(drop, { ...press(drop, { titane: 1 }), phrase: 'TEST 00000000' }, w.f.admin), 'VALIDATION_FAILED', 400);
    await rejects(w.tests.start(drop, press(drop, { titane: 1 }), { type: 'account', id: w.f.admin.id }), 'FORBIDDEN', 403);
    // A draw not open yet (no early access), or drawn; a LIVE RELEASE whose room has not opened.
    const later = await openDraw(w, { opensIn: HOUR, closesIn: 2 * HOUR });
    await rejects(w.tests.start(later, press(later, { titane: 1 }), w.f.admin), 'TEST_DRAW_NOT_OPEN', 409);
    const ahead = await createLiveRelease(w.f, { opensAt: new Date(w.h.clock.now().getTime() + HOUR) });
    await rejects(w.tests.start(ahead.id, press(ahead.id, { titane: 1 }), w.f.admin), 'TEST_ROOM_NOT_OPEN', 409);

    // One test RUNNING at a time: a burst of 60 s keeps it running.
    const run = await w.tests.start(drop, press(drop, { titane: 2 }, { arrival: { mode: 'burst', seconds: 60, interestPct: 0 } }), w.f.admin);
    const other = await openDraw(w);
    await rejects(w.tests.start(other, press(other, { titane: 1 }), w.f.admin), 'TEST_RUNNING', 409);
    expect(await w.tests.active()).toMatchObject({ id: run.id, dropId: drop, dropName: 'MONOLITHE · TEST DRAW', mode: 'DRAW', status: 'RUNNING', entrants: 2 });
    // ADD MORE: the same phrase, the groups left out kept from the last press.
    await rejects(w.tests.addMore(run.id, { ...press(drop, { titane: 1 }), phrase: 'TEST' }, w.f.admin), 'VALIDATION_FAILED');
    const more = await w.tests.addMore(run.id, { phrase: testPhrase(drop), tiers: { none: 0, titane: 0, platine: 1, palladium: 0 } }, w.f.admin);
    expect(more.entrants).toBe(3);
    expect(more.settings).toHaveLength(2);
    expect(more.settings[1]!.arrival).toEqual({ mode: 'burst', seconds: 60, interestPct: 0 });
    // STOP: STOPPED, nothing cleaned; a STOPPED test blocks nothing; STOP again is refused.
    await drive(w, 0);
    const stopped = await w.tests.stop(run.id, w.f.admin);
    expect(stopped.status).toBe('STOPPED');
    await rejects(w.tests.stop(run.id, w.f.admin), 'TEST_NOT_RUNNING', 409);
    await rejects(w.tests.addMore(run.id, press(drop, { titane: 1 }), w.f.admin), 'TEST_NOT_RUNNING', 409);
    expect(await w.tests.active()).toBeNull();
    const entered = await w.h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop).execute();
    expect(entered.length).toBeGreaterThanOrEqual(1);
    // The bots of a STOPPED test act no more.
    await drive(w, 61_000, 5000);
    expect((await w.h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop).execute()).length).toBe(entered.length);
    // END TEST on STOPPED: the phrase END TEST <8>; ENDED; a second END TEST is refused.
    await rejects(w.tests.end(run.id, testPhrase(drop), w.f.admin), 'VALIDATION_FAILED', 400);
    const ended = await w.tests.end(run.id, testPhrase(drop, true), w.f.admin);
    expect(ended.status).toBe('ENDED');
    expect(ended.endedAt).toBeInstanceOf(Date);
    expect(ended.report?.total).toBe(5);
    expect((await w.h.ctx.db.selectFrom('drop_entries').select('status').where('drop_id', '=', drop).execute()).every((e) => e.status === 'WITHDRAWN')).toBe(true);
    await rejects(w.tests.end(run.id, testPhrase(drop, true), w.f.admin), 'TEST_ENDED', 409);

    // DONE blocks nothing; END TEST on DONE.
    const done = await w.tests.start(other, press(other, { titane: 1 }), w.f.admin);
    await drive(w, 0);
    expect(await statusOf(w, done.id)).toBe('DONE');
    const third = await openDraw(w);
    const running = await w.tests.start(third, press(third, { none: 1 }, { arrival: { mode: 'burst', seconds: 30, interestPct: 0 } }), w.f.admin);
    expect((await w.tests.end(done.id, testPhrase(other, true), w.f.admin)).status).toBe('ENDED');
    // A restart: the RUNNING test INTERRUPTED; it blocks nothing; END TEST on it.
    expect(await w.tests.boot()).toEqual([running.id]);
    await w.tests.close();
    expect(await statusOf(w, running.id)).toBe('INTERRUPTED');
    expect(await w.tests.active()).toBeNull();
    expect((await w.tests.current(third))?.status).toBe('INTERRUPTED');
    expect((await w.tests.end(running.id, testPhrase(third, true), w.f.admin)).status).toBe('ENDED');
    expect(await w.tests.current(third)).toBeNull();
    const history = await w.tests.list(third);
    expect(history.map((r) => [r.status, r.checksPassed, r.checksTotal])).toEqual([['ENDED', 5, 5]]);
    // Each step audited.
    const actions = (await w.h.ctx.db.selectFrom('audit_logs').select('action').where('target_type', '=', 'test_run').execute()).map((a) => a.action);
    for (const a of ['test_run.start', 'test_run.add', 'test_run.stop', 'test_run.end']) expect(actions).toContain(a);
  });
});

describe('the runner', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('fills a slot as soon as its request ends: 200 bots due at once all act from one tick, not 32 a tick', async () => {
    const drop = await openDraw(w, { quantity: 200 });
    // A server that answers at once: the runner alone sets the pace.
    let sent = 0;
    const fast = new TestEntrantService({
      ctx: w.h.ctx,
      inject: async () => {
        sent++;
        return { statusCode: 201, body: '{}' };
      },
    });
    fast.useTimers(false);
    const run = await fast.start(drop, press(drop, { titane: 200 }), w.f.admin);
    fast.useTimers(true);
    try {
      await fast.tick();
      await fast.settle();
      expect(sent).toBe(200);
      await fast.tick();
      expect(await statusOf(w, run.id)).toBe('DONE');
    } finally {
      await fast.close();
    }
  });
});

describe('the pool\'s cap', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('refuses a press that would take the pool past 5 000 accounts, with a plain message', async () => {
    // 4 999 test accounts, none free (locked).
    await sql`
      WITH a AS (
        INSERT INTO accounts (email, email_normalized, password_hash, status)
        SELECT 'pool-' || g || '@orbes.test', 'pool-' || g || '@orbes.test', '!x', 'LOCKED' FROM generate_series(1, 4999) AS g
        RETURNING id)
      INSERT INTO test_entrants (account_id) SELECT id FROM a`.execute(w.h.ctx.db);
    const drop = await openDraw(w);
    const e = await rejects(w.tests.start(drop, press(drop, { titane: 2 }), w.f.admin), 'TEST_POOL_FULL', 409);
    expect(e.publicMessage).toBe('The pool holds at most 5000 test accounts: this press needs 2 more, and 1 can still be made. END TEST on an earlier test gives its accounts back.');
    expect(await w.tests.active()).toBeNull();
    const run = await w.tests.start(drop, press(drop, { titane: 1 }), w.f.admin);
    expect(run.entrants).toBe(1);
  });
});

describe('a draw end to end', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('reservations in the early access, entries at the opening, the staff\'s draw, places confirmed by themselves, END TEST: orders cancelled, places lapsed, report 5/5', async () => {
    const drop = await openDraw(w, { quantity: 8, opensIn: HOUR, closesIn: 2 * HOUR, earlyAccessHours: 48 });
    const reals = [await createAccount(w.h.ctx.db), await createAccount(w.h.ctx.db)];
    for (const r of reals) await holdPieces(w.h.ctx.db, r.id, 1, w.f.modelId);
    // In the early access, START needs some to reserve.
    await rejects(w.tests.start(drop, press(drop, { titane: 1 }), w.f.admin), 'TEST_DRAW_NOT_OPEN', 409);
    const run = await w.tests.start(drop, press(drop, { none: 2, titane: 4, platine: 3, palladium: 3 }, { behaviour: { reservePct: 100, confirmPct: 100 } }), w.f.admin);
    expect(run.entrants).toBe(12);

    // The six PLATINE and PALLADIUM reserve at once; the others wait for the opening.
    await drive(w, 0);
    let view = await w.tests.view(run.id);
    expect(view.status).toBe('RUNNING');
    expect(view.byTier.map((t) => t.selected)).toEqual([0, 0, 3, 3]);
    expect(view.selected).toHaveLength(6);
    expect(view.selected.every((s) => s.status === 'SELECTED' && s.canConfirm && !s.canRelease && s.respondBy instanceof Date)).toBe(true);
    // The sweeper gives each reservation its time, then confirms it with the test's ADMIN: one order each.
    expect(await w.tests.sweep()).toBe(0);
    w.h.clock.advance(61_000);
    expect(await w.tests.sweep()).toBe(6);
    view = await w.tests.view(run.id);
    expect(view.byTier.map((t) => t.confirmed)).toEqual([0, 0, 3, 3]);
    expect(view.selected.every((s) => s.status === 'CONFIRMED' && s.orderRef?.startsWith('OR-') && !s.canConfirm)).toBe(true);
    const handled = await w.h.ctx.db.selectFrom('drop_entries').select('handled_by').where('drop_id', '=', drop).where('status', '=', 'CONFIRMED').execute();
    expect(handled.every((e) => e.handled_by === w.f.admin.id)).toBe(true);

    // The opening: the six others enter; real collectors too; DONE.
    w.h.clock.advance(HOUR);
    for (const r of reals) await w.h.ctx.services.drops.enter(r.id, drop, r.actor);
    await drive(w, 0);
    expect(await statusOf(w, run.id)).toBe('DONE');
    view = await w.tests.view(run.id);
    expect(view.byTier.map((t) => t.entered)).toEqual([2, 4, 3, 3]);
    expect(view.release).toEqual({ real: 2, test: 12, total: 14 });

    // The staff's draw: two places left, the TITANE first (tests and real together), then confirmed by themselves.
    w.h.clock.advance(HOUR);
    const drawn = await w.h.ctx.services.drops.draw(drop, w.f.admin);
    expect(drawn).toMatchObject({ entries: 8, places: 2, selected: 2, waitlisted: 6 });
    await w.tests.sweep();
    w.h.clock.advance(61_000);
    await w.tests.sweep();
    const selectedReal = await w.h.ctx.db.selectFrom('drop_entries').select('account_id').where('drop_id', '=', drop).where('status', '=', 'SELECTED').execute();
    const confirmed = await w.h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop).where('status', '=', 'CONFIRMED').execute();
    // Every test entrant drawn confirmed by itself; a real one waits for Client Services.
    expect(confirmed.length + selectedReal.length).toBe(8);
    expect(selectedReal.every((s) => reals.some((r) => r.id === s.account_id))).toBe(true);

    // END TEST: the report first (5/5), then the test's orders cancelled, its places lapsed; the real ones untouched.
    const ended = await w.tests.end(run.id, testPhrase(drop, true), w.f.admin);
    expect(ended.status).toBe('ENDED');
    expect(ended.report?.checks.map((c) => [c.id, c.pass])).toEqual([['ONE_ENTRY', true], ['ORDER', true], ['ONE_PLACE', true], ['STOCK', true], ['ORDERS', true]]);
    expect(ended.report?.passed).toBe(5);
    const testIds = (await w.h.ctx.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', run.id).execute()).map((r) => r.account_id);
    const testOrders = await w.h.ctx.db.selectFrom('orders').select('status').where('drop_id', '=', drop).where('account_id', 'in', testIds).execute();
    expect(testOrders.length).toBe(confirmed.length);
    expect(testOrders.every((o) => o.status === 'CANCELLED')).toBe(true);
    const testEntries = await w.h.ctx.db.selectFrom('drop_entries').select(['status', 'rank', 'note']).where('drop_id', '=', drop).where('account_id', 'in', testIds).execute();
    expect(testEntries.every((e) => e.status === 'LAPSED' && e.note?.startsWith('END TEST'))).toBe(true);
    const realEntries = await w.h.ctx.db.selectFrom('drop_entries').select('status').where('drop_id', '=', drop).where('account_id', 'in', reals.map((r) => r.id)).execute();
    expect(realEntries.every((e) => e.status === 'SELECTED' || e.status === 'WAITLISTED')).toBe(true);
    expect(await w.h.ctx.db.selectFrom('sessions').select('id_hash').where('subject_id', 'in', testIds).execute()).toEqual([]);
    // The places freed go to real collectors: OFFER NEXT finds the waiting list empty of test entrants.
    const lapses = await w.h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.entry.lapse').where('target_id', '=', drop).execute();
    expect(lapses.length).toBe(testEntries.length);
    // The accounts stay in the pool, ready for the next test.
    expect(Number((await w.h.ctx.db.selectFrom('test_entrants').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n)).toBe(12);
  });

  it('the report\'s checks find a fault planted: a confirmed place without its order', async () => {
    const drop = await openDraw(w);
    const real = await createAccount(w.h.ctx.db);
    await w.h.ctx.services.drops.enter(real.id, drop, real.actor);
    const now = w.h.clock.now();
    await w.h.ctx.db.updateTable('drop_entries').set({ status: 'CONFIRMED', tier: 0, seniority: 0, respond_by: now, handled_at: now, handled_by: w.f.admin.id }).where('drop_id', '=', drop).execute();
    const d = await w.h.ctx.db.selectFrom('drops').selectAll().where('id', '=', drop).executeTakeFirstOrThrow();
    const report = await w.tests.report(d, now);
    expect(report.passed).toBe(3);
    expect(report.checks.find((c) => c.id === 'ORDERS')).toMatchObject({ pass: false, line: '1 of 1 confirmed place has no order.' });
    expect(report.checks.find((c) => c.id === 'STOCK')).toMatchObject({ pass: false, line: '1 place confirmed, 0 orders.' });
  });

  it('the sweeper resumes a confirmation due after a restart', async () => {
    const drop = await openDraw(w, { quantity: 2, opensIn: HOUR, closesIn: 2 * HOUR, earlyAccessHours: 48 });
    const run = await w.tests.start(drop, press(drop, { palladium: 1 }, { behaviour: { reservePct: 100, confirmPct: 100 } }), w.f.admin);
    await drive(w, 0);
    expect(await statusOf(w, run.id)).toBe('DONE');
    await w.tests.sweep();
    const due = await w.h.ctx.db.selectFrom('test_run_entrants').select('confirm_due_at').where('run_id', '=', run.id).executeTakeFirstOrThrow();
    expect(due.confirm_due_at).toBeInstanceOf(Date);
    // A new process on the same database: its sweeper finds the time due and confirms.
    const app = await buildApp(w.h.ctx, { serveStatic: false, liveHub: { pulseMs: 0, cacheMs: 0 } });
    try {
      app.testEntrants.useTimers(false);
      w.h.clock.advance(61_000);
      expect(await app.testEntrants.sweep()).toBe(1);
    } finally {
      await app.close();
    }
    expect((await w.h.ctx.db.selectFrom('drop_entries').select('status').where('drop_id', '=', drop).executeTakeFirstOrThrow()).status).toBe('CONFIRMED');
    expect((await w.h.ctx.db.selectFrom('test_run_entrants').select('outcome').where('run_id', '=', run.id).executeTakeFirstOrThrow()).outcome).toBe('CONFIRMED');
  });
});

describe('a draw in sizes (plan NEXT LOT §3.6.F)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  /** A draw in sizes 16 (2 pieces), 17 (2) and 18 (1), published now, open since an hour. */
  async function sizedDraw(): Promise<{ id: string; sizes: { id: string; label: string }[] }> {
    const now = w.h.clock.now().getTime();
    // Its sizes are its model's (plan NEXT LOT §5.1 #20): the fixture's model given 16, 17 and 18 for the draw.
    const d = await withDrawSizes(w.h.ctx.db, w.f.modelId, ['16', '17', '18'], async () => {
      const created = await w.h.ctx.services.drops.create(
        {
          modelId: w.f.modelId,
          title: 'MONOLITHE · TEST DRAW IN SIZES',
          sizes: [
            { label: '16', pieces: 2 },
            { label: '17', pieces: 2 },
            { label: '18', pieces: 1 },
          ],
          opensAt: new Date(now - HOUR),
          closesAt: new Date(now + HOUR),
          earlyAccessHours: 0,
        },
        w.f.admin,
      );
      return w.h.ctx.services.drops.publish(created.id, w.f.admin);
    }, 'BRACELET');
    return { id: d.id, sizes: d.sizes.map((z) => ({ id: z.id, label: z.label })) };
  }
  const entriesOf = (dropId: string) => w.h.ctx.db.selectFrom('drop_entries').select(['id', 'size_id', 'status', 'rank']).where('drop_id', '=', dropId).execute();

  it('the bots enter in a size each, spread over the sizes with pieces; the Choices\' size (by id or label) puts them all in it, one not offered refused; the draw fills each size; END TEST: the report 5/5 with its per-size lines', async () => {
    const d = await sizedDraw();
    await rejects(w.tests.start(d.id, press(d.id, { titane: 2 }, { choices: { size: '19' } }), w.f.admin), 'VALIDATION_FAILED', 400);
    const run = await w.tests.start(d.id, press(d.id, { none: 10, titane: 10 }, { behaviour: { confirmPct: 100 } }), w.f.admin);
    await drive(w, 0);
    expect(await statusOf(w, run.id)).toBe('DONE');
    const entered = await entriesOf(d.id);
    expect(entered).toHaveLength(20);
    expect(entered.every((e) => e.status === 'ENTERED' && d.sizes.some((z) => z.id === e.size_id))).toBe(true);
    expect(new Set(entered.map((e) => e.size_id)).size).toBeGreaterThan(1);
    // The staff's draw, each size in the rank order; the places confirmed by themselves; END TEST.
    w.h.clock.advance(HOUR);
    const drawn = await w.h.ctx.services.drops.draw(d.id, w.f.admin);
    expect(drawn.sizes.map((z) => z.label)).toEqual(['16', '17', '18']);
    await w.tests.sweep();
    w.h.clock.advance(61_000);
    await w.tests.sweep();
    const ended = await w.tests.end(run.id, testPhrase(d.id, true), w.f.admin);
    expect(ended.report?.checks.map((c) => [c.id, c.pass])).toEqual([['ONE_ENTRY', true], ['ORDER', true], ['ONE_PLACE', true], ['STOCK', true], ['ORDERS', true]]);
    expect(ended.report?.checks.find((c) => c.id === 'ORDER')?.line).toContain('In each size, places went in rank order: no entry on the waiting list ranks above one that was given a place.');
    expect(ended.report?.checks.find((c) => c.id === 'STOCK')?.line).toContain('held or sold, within each size’s pieces');
    // Every order of the draw in its entry's size, all cancelled by END TEST.
    const orders = await w.h.ctx.db.selectFrom('orders').select(['status', 'size_label']).where('drop_id', '=', d.id).execute();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.status === 'CANCELLED' && ['16', '17', '18'].includes(o.size_label ?? ''))).toBe(true);

    // The Choices' size, by its label: every bot in it.
    const e = await sizedDraw();
    const in17 = await w.tests.start(e.id, press(e.id, { titane: 4 }, { choices: { size: '17' } }), w.f.admin);
    await drive(w, 0);
    const s17 = e.sizes.find((z) => z.label === '17')!.id;
    expect((await entriesOf(e.id)).map((x) => x.size_id)).toEqual([s17, s17, s17, s17]);
    expect(await statusOf(w, in17.id)).toBe('DONE');
    await w.tests.end(in17.id, testPhrase(e.id, true), w.f.admin);
  });

  it('the report finds a fill broken by hand (a place given in a size above its waiting list) and a size held beyond its pieces', async () => {
    const d = await sizedDraw();
    const s16 = d.sizes.find((z) => z.label === '16')!.id;
    const accounts = [await createAccount(w.h.ctx.db), await createAccount(w.h.ctx.db), await createAccount(w.h.ctx.db)];
    for (const a of accounts) await w.h.ctx.services.drops.enter(a.id, d.id, a.actor, { sizeId: s16 });
    w.h.clock.advance(HOUR);
    await w.h.ctx.services.drops.draw(d.id, w.f.admin);
    const row = await w.h.ctx.db.selectFrom('drops').selectAll().where('id', '=', d.id).executeTakeFirstOrThrow();
    const ranked = (await entriesOf(d.id)).sort((a, b) => a.rank! - b.rank!);
    expect(ranked.map((x) => x.status)).toEqual(['SELECTED', 'SELECTED', 'WAITLISTED']);
    let report = await w.tests.report(row, w.h.clock.now());
    expect(report.checks.find((c) => c.id === 'ORDER')?.pass).toBe(true);
    // Rank 1 put on the waiting list and rank 3 given its place: the fill is out of order.
    await w.h.ctx.db.updateTable('drop_entries').set({ status: 'WAITLISTED', respond_by: null }).where('id', '=', ranked[0]!.id).execute();
    await w.h.ctx.db.updateTable('drop_entries').set({ status: 'SELECTED', respond_by: w.h.clock.now() }).where('id', '=', ranked[2]!.id).execute();
    report = await w.tests.report(row, w.h.clock.now());
    expect(report.checks.find((c) => c.id === 'ORDER')).toMatchObject({ pass: false, line: 'In size 16, rank 1 is on the waiting list above rank 3, which was given a place.' });
    // All three given a place in 16, which has 2 pieces: STOCK fails per size (within the release's 5).
    await w.h.ctx.db.updateTable('drop_entries').set({ status: 'SELECTED', respond_by: w.h.clock.now() }).where('id', '=', ranked[0]!.id).execute();
    report = await w.tests.report(row, w.h.clock.now());
    expect(report.checks.find((c) => c.id === 'STOCK')).toMatchObject({ pass: false, line: 'Size 16: 3 places held or sold for 2 pieces.' });
  });
});

describe('the early access by tier (plan NEXT-NINE, BP-19 T3)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('PALLADIUM reserves from its time, a PLATINE test entrant waits for its own window and reserves there, never refused; a start needs a tier whose window is open', async () => {
    const drop = await openDraw(w, { quantity: 8, opensIn: 3 * HOUR, closesIn: 4 * HOUR, earlyAccessHours: 48, earlyAccessPlatineHours: 2 });
    // Only PALLADIUM's window is open: PLATINE reservers alone cannot start a test.
    await rejects(w.tests.start(drop, press(drop, { platine: 2 }, { behaviour: { reservePct: 100 } }), w.f.admin), 'TEST_DRAW_NOT_OPEN', 409);
    const run = await w.tests.start(drop, press(drop, { platine: 2, palladium: 2 }, { behaviour: { reservePct: 100, confirmPct: 0 } }), w.f.admin);
    const outcomes = async () =>
      (
        await w.h.ctx.db.selectFrom('test_run_entrants as r').innerJoin('test_entrants as t', 't.account_id', 'r.account_id').select(['t.tier', 'r.outcome']).where('r.run_id', '=', run.id).orderBy('t.tier').orderBy('r.outcome').execute()
      ).map((r) => [r.tier, r.outcome]);

    // PALLADIUM reserves now; the PLATINE wait, nothing asked of the server yet.
    await drive(w, 0);
    let view = await w.tests.view(run.id);
    expect(view.status).toBe('RUNNING');
    expect(view.byTier.map((t) => t.selected)).toEqual([0, 0, 0, 2]);
    expect(await outcomes()).toEqual([
      [2, null],
      [2, null],
      [3, 'RESERVED'],
      [3, 'RESERVED'],
    ]);
    expect(view.errors).toEqual([]);

    // PLATINE's own window (2 h before the opening): they reserve, and the test is DONE.
    w.h.clock.advance(HOUR - 1000);
    await drive(w, 0);
    expect((await w.tests.view(run.id)).byTier.map((t) => t.selected)).toEqual([0, 0, 0, 2]);
    w.h.clock.advance(1000);
    await drive(w, 0);
    view = await w.tests.view(run.id);
    expect(view.byTier.map((t) => t.selected)).toEqual([0, 0, 2, 2]);
    expect(await outcomes()).toEqual([
      [2, 'RESERVED'],
      [2, 'RESERVED'],
      [3, 'RESERVED'],
      [3, 'RESERVED'],
    ]);
    expect(view.errors).toEqual([]);
    expect(await statusOf(w, run.id)).toBe('DONE');
    // Once PLATINE's window is open, PLATINE reservers alone may start (the test DONE no longer blocks one).
    const second = await openDraw(w, { quantity: 4, opensIn: HOUR, closesIn: 2 * HOUR, earlyAccessHours: 48, earlyAccessPlatineHours: 2 });
    expect((await w.tests.start(second, press(second, { platine: 1 }, { behaviour: { reservePct: 100, confirmPct: 0 } }), w.f.admin)).status).toBe('RUNNING');
  });
});

describe('the report and the house\'s guarantee (plan NEXT-NINE, IN-01)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());
  const until = () => new Date(w.h.clock.now().getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  it('a draw: a real guaranteed place of 2 pieces, confirmed with its 2 orders, counts 2 pieces against the stock; STOCK and ORDERS pass', async () => {
    const drop = await openDraw(w, { quantity: 4 });
    const holder = await createAccount(w.h.ctx.db);
    await w.h.ctx.services.guarantees.grant(holder.id, { scope: 'RELEASE', targetId: drop, pieces: 2, validUntil: until(), visible: true }, w.f.admin);
    await w.h.ctx.services.drops.enter(holder.id, drop, holder.actor);
    const run = await w.tests.start(drop, press(drop, { titane: 3 }, { behaviour: { confirmPct: 0 } }), w.f.admin);
    await drive(w, 0);
    expect(await statusOf(w, run.id)).toBe('DONE');
    w.h.clock.advance(HOUR);
    expect(await w.h.ctx.services.drops.draw(drop, w.f.admin)).toMatchObject({ guaranteed: 1, guaranteedPieces: 2, selected: 2 });
    const entry = await w.h.ctx.db.selectFrom('drop_entries').select(['id', 'pieces']).where('drop_id', '=', drop).where('account_id', '=', holder.id).executeTakeFirstOrThrow();
    expect(entry.pieces).toBe(2);
    await w.h.ctx.services.drops.confirm(drop, entry.id, null, w.f.admin);
    expect(await w.h.ctx.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry.id).execute()).toHaveLength(2);
    const d = await w.h.ctx.db.selectFrom('drops').selectAll().where('id', '=', drop).executeTakeFirstOrThrow();
    const report = await w.tests.report(d, w.h.clock.now());
    expect(report.checks.find((c) => c.id === 'STOCK')).toEqual({ id: 'STOCK', label: 'Stock matches the orders', pass: true, line: '4 of 4 places held or sold, 1 confirmed with 2 orders; no stock below zero.' });
    expect(report.checks.find((c) => c.id === 'ORDERS')).toMatchObject({ pass: true });
    expect(report.passed).toBe(5);
  });

  it('a LIVE RELEASE: a real guaranteed holder of no tier first in the line, asking 3 pieces over a per-account of 1; ORDER and ONE_PLACE pass', async () => {
    const t0 = new Date(w.h.clock.now().getTime() + 2 * MINUTE);
    const release = await createLiveRelease(w.f, { opensAt: t0, sizes: [{ label: '52', stock: 6 }], perAccount: 1 });
    const holder = await createAccount(w.h.ctx.db);
    await w.h.ctx.services.guarantees.grant(holder.id, { scope: 'RELEASE', targetId: release.id, pieces: 3, validUntil: until(), visible: true }, w.f.admin);
    await w.h.ctx.services.live.enter(holder.id, release.id, { sizeId: release.sizes[0]!.id, quantity: 3 }, holder.actor);
    const run = await w.tests.start(
      release.id,
      press(release.id, { palladium: 2 }, { behaviour: { payPct: 0, releasePct: 0, missPct: 100, leavePct: 0, holdSeconds: 1.5 }, choices: { size: '52', quantity: 1, addOnsPct: 0 } }),
      w.f.admin,
    );
    await drive(w, 0, 500, release.id);
    w.h.clock.set(t0);
    await drive(w, 1000, 500, release.id);
    const line = await w.h.ctx.db.selectFrom('live_entries').select(['account_id', 'tier', 'quantity', 'guarantee_id']).where('drop_id', '=', release.id).orderBy('position').execute();
    expect(line.map((e) => [e.account_id === holder.id, e.tier])).toEqual([
      [true, 0],
      [false, 3],
      [false, 3],
    ]);
    expect(line[0]!.quantity).toBe(3);
    const d = await w.h.ctx.db.selectFrom('drops').selectAll().where('id', '=', release.id).executeTakeFirstOrThrow();
    const report = await w.tests.report(d, w.h.clock.now());
    expect(report.checks.find((c) => c.id === 'ORDER')).toEqual({ id: 'ORDER', label: 'The line’s order', pass: true, line: '3 placed at T0 by tier, the highest first.' });
    expect(report.checks.find((c) => c.id === 'ONE_PLACE')).toMatchObject({ pass: true });
    expect(report.passed).toBe(5);
    await w.tests.stop(run.id, w.f.admin);
  });
});

describe('END TEST and the tier program', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('END TEST cancels the test\'s GIFT orders and gives back its credits: parents first, a GIFT order closed with its order skipped, a credit left on a cancelled order released; the grants stay; the report 5/5', async () => {
    const admin = w.f.admin;
    const france = (await w.h.ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    // THE PROGRAM: PLATINE's welcome gift, a model of one size with three pieces in stock; its credit by default (50.00 EUR).
    const giftModel = await createModel(w.h.ctx.db, 'ANNEAU CADEAU');
    const giftSku = await inTransaction(w.h.ctx.db, (tx) => ensureSku(tx, giftModel, null));
    await w.h.ctx.services.stock.adjust({ skuId: giftSku, locationId: france, delta: 3, note: 'Counted.' }, admin);
    const program = await w.h.ctx.services.clubProgram.read();
    await w.h.ctx.services.clubProgram.update({ ...program, giftPlatineModelId: giftModel }, admin);
    const giftStock = async () => (await stockLevel(w.h.ctx.db, giftSku, france)).available;
    expect(await giftStock()).toBe(3);

    // Three PLATINE test entrants reserve in the early access of a priced draw and confirm by themselves: an order each,
    // its welcome gift travelling with it (holding its piece).
    const drop = await openDraw(w, { quantity: 4, opensIn: HOUR, closesIn: 2 * HOUR, earlyAccessHours: 48, priceMinor: 120_000 });
    const run = await w.tests.start(drop, press(drop, { platine: 3 }, { behaviour: { reservePct: 100, confirmPct: 100 } }), admin);
    await drive(w, 0);
    await w.tests.sweep();
    w.h.clock.advance(61_000);
    expect(await w.tests.sweep()).toBe(3);
    const testIds = (await w.h.ctx.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', run.id).execute()).map((r) => r.account_id);
    const parents = await w.h.ctx.db.selectFrom('orders').select(['id', 'account_id', 'status', 'currency']).where('drop_id', '=', drop).orderBy('reserved_at').orderBy('id').execute();
    expect(parents.map((o) => [o.status, o.currency])).toEqual(Array.from({ length: 3 }, () => ['RESERVED', 'EUR']));
    const gifts = await w.h.ctx.db.selectFrom('orders').select(['id', 'with_order_id', 'status', 'drop_id']).where('channel', '=', 'GIFT').where('account_id', 'in', testIds).execute();
    expect(gifts.map((g) => g.with_order_id).sort()).toEqual(parents.map((o) => o.id).sort());
    expect(gifts.every((g) => g.status === 'RESERVED' && g.drop_id === null)).toBe(true);
    expect(await giftStock()).toBe(0);
    // Client Services takes credit off each; the second is paid (its gift paid with it, its invoice issued); the third
    // cancelled by hand (its gift with it, its credit given back).
    const [first, second, third] = parents;
    await w.h.ctx.services.orders.applyCredit(first!.id, 3000, admin);
    await w.h.ctx.services.orders.applyCredit(second!.id, 2000, admin);
    await w.h.ctx.services.orders.transition(second!.id, { to: 'PAID' }, admin);
    expect((await w.h.ctx.db.selectFrom('orders').select('status').where('with_order_id', '=', second!.id).executeTakeFirstOrThrow()).status).toBe('PAID');
    expect((await creditBalances(w.h.ctx.db, second!.account_id)).map((c) => c.balanceMinor)).toEqual([3000]);
    await w.h.ctx.services.orders.applyCredit(third!.id, 1000, admin);
    await w.h.ctx.services.orders.transition(third!.id, { to: 'CANCELLED', note: 'Cancelled by Client Services.' }, admin);
    expect(await giftStock()).toBe(1);
    // A fault planted: that credit left taken off the cancelled order, as if its cancellation had not given it back.
    await w.h.ctx.db.updateTable('credit_uses').set({ released_at: null, released_reason: null, released_by: null }).where('order_id', '=', third!.id).execute();

    // END TEST: the report first (5/5), then every order of the test cancelled, its gifts with it, its credit given back.
    const ended = await w.tests.end(run.id, testPhrase(drop, true), admin);
    expect(ended.report?.checks.map((c) => [c.id, c.pass])).toEqual([['ONE_ENTRY', true], ['ORDER', true], ['ONE_PLACE', true], ['STOCK', true], ['ORDERS', true]]);
    const all = await w.h.ctx.db.selectFrom('orders').select(['id', 'channel', 'status']).where('account_id', 'in', testIds).execute();
    expect(all.filter((o) => o.channel === 'GIFT')).toHaveLength(3);
    expect(all.every((o) => o.status === 'CANCELLED')).toBe(true);
    expect(await giftStock()).toBe(3);
    const uses = await w.h.ctx.db.selectFrom('credit_uses').select(['order_id', 'released_at', 'released_reason']).where('order_id', 'in', [first!.id, second!.id, third!.id]).execute();
    expect(uses).toHaveLength(3);
    expect(uses.every((u) => u.released_at !== null && u.released_reason === 'CANCELLED')).toBe(true);
    // Audited `order.credit.release` at each cancellation, the third's twice (by hand, then END TEST's check).
    const releases = await w.h.ctx.db.selectFrom('audit_logs').select(['target_id', 'details']).where('action', '=', 'order.credit.release').where('target_id', 'in', [first!.id, second!.id, third!.id]).execute();
    expect(releases.map((r) => r.target_id).sort()).toEqual([first!.id, second!.id, third!.id, third!.id].sort());
    // A GIFT order is cancelled with its order (audited `order.cancel`), never cancelled twice.
    const giftCancels = await w.h.ctx.db.selectFrom('audit_logs').select('target_id').where('action', '=', 'order.cancel').where('target_id', 'in', gifts.map((g) => g.id)).execute();
    expect(giftCancels.map((c) => c.target_id).sort()).toEqual(gifts.map((g) => g.id).sort());
    const endAudit = await w.h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'test_run.end').where('target_id', '=', run.id).executeTakeFirstOrThrow();
    // Two orders cancelled by END TEST (the third was already), their two gifts with them; three credits given back.
    expect((endAudit.details as { cleaned: Record<string, number> }).cleaned).toMatchObject({ ordersCancelled: 2, giftOrdersCancelled: 2, creditsReleased: 3 });
    // The grants stay with the pool's accounts (once per tier and account, never deleted): the gift waits again, the credit is whole.
    expect((await w.h.ctx.db.selectFrom('tier_grants').select('kind').where('account_id', 'in', testIds).execute()).map((g) => g.kind).sort()).toEqual(['CREDIT', 'CREDIT', 'CREDIT', 'GIFT', 'GIFT', 'GIFT']);
    for (const id of testIds) expect((await creditBalances(w.h.ctx.db, id)).map((c) => c.balanceMinor)).toEqual([5000]);
  });
});

describe('END TEST and a new claim code (plan NEXT LOT §3.4.8)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('END TEST cancels an order whose piece has a waiting code: the code withdrawn, an UNSHOWN code nobody sees, the piece needing a card; the report 5/5', async () => {
    const admin = w.f.admin;
    const db = w.h.ctx.db;
    const france = (await db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const drop = await openDraw(w, { quantity: 2, opensIn: HOUR, closesIn: 2 * HOUR, earlyAccessHours: 48, priceMinor: 120_000 });
    const run = await w.tests.start(drop, press(drop, { platine: 1 }, { behaviour: { reservePct: 100, confirmPct: 100 } }), admin);
    await drive(w, 0);
    await w.tests.sweep();
    w.h.clock.advance(61_000);
    expect(await w.tests.sweep()).toBe(1);
    const order = await db.selectFrom('orders').select(['id', 'account_id']).where('drop_id', '=', drop).executeTakeFirstOrThrow();
    // Client Services enters its size and marks it paid; the packing scan binds a piece of the stock to it; its card is
    // lost: a new code waits for the buyer.
    const sku = await inTransaction(db, (tx) => ensureSku(tx, w.f.modelId, '52'));
    const piece = await w.h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: w.f.modelId, variant: '52', material: '925 STERLING SILVER', withClaimSecret: true }, admin);
    await countPiecesIn(w.h.ctx, { skuId: sku, locationId: france, productRefs: [piece.product.productId] }, admin);
    await w.h.ctx.services.orders.setTerms(order.id, { sizeLabel: '52' }, admin);
    await w.h.ctx.services.orders.transition(order.id, { to: 'PAID' }, admin);
    await scanIntoParcel(w.h.ctx, order.id, { pieces: { [order.id]: piece.product.productId } }, admin);
    await w.h.ctx.services.claimRenewals.renew(piece.product.productId, { reason: 'Card lost at the warehouse.', expect: 'SOLD', after: null }, admin);
    const hash = (await db.selectFrom('products').select('claim_secret_hash').where('id', '=', piece.product.id).executeTakeFirstOrThrow()).claim_secret_hash;
    // END TEST: through OrderService.transition, the cancellation's hook.
    w.h.clock.advance(MINUTE);
    const ended = await w.tests.end(run.id, testPhrase(drop, true), admin);
    expect(ended.report?.checks.map((c) => [c.id, c.pass])).toEqual([['ONE_ENTRY', true], ['ORDER', true], ['ONE_PLACE', true], ['STOCK', true], ['ORDERS', true]]);
    expect((await db.selectFrom('orders').select('status').where('id', '=', order.id).executeTakeFirstOrThrow()).status).toBe('CANCELLED');
    const rows = await db.selectFrom('claim_code_renewals').select(['kind', 'status', 'withdrawn_reason', 'order_id', 'claim_hash']).where('product_id', '=', piece.product.id).orderBy('created_at').orderBy('id').execute();
    expect(rows.map((r) => [r.kind, r.status, r.withdrawn_reason, r.order_id])).toEqual([
      ['BUYER', 'WITHDRAWN', 'ORDER_CANCELLED', order.id],
      ['UNSHOWN', 'UNSHOWN', null, order.id],
    ]);
    const after = (await db.selectFrom('products').select('claim_secret_hash').where('id', '=', piece.product.id).executeTakeFirstOrThrow()).claim_secret_hash;
    expect(after).not.toBe(hash);
    expect(rows[1]!.claim_hash).toBe(after);
    expect((await w.h.ctx.services.claimRenewals.situation(piece.product.productId)).cardNeeded).toBe(true);
  });
});

describe('a LIVE RELEASE end to end', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w?.h.close());

  it('I\'LL BE THERE, the line at T0 by tier, PRESS, the hold, SECURE, PAY and RELEASE; END TEST cancels the orders; report 5/5', async () => {
    const t0 = new Date(w.h.clock.now().getTime() + 2 * MINUTE);
    const release = await createLiveRelease(w.f, { opensAt: t0, sizes: [{ label: '52', stock: 6 }], addons: [{ label: 'Box', priceMinor: 2000 }], accessModels: [w.f.modelId] });
    const run = await w.tests.start(
      release.id,
      press(release.id, { titane: 3, palladium: 3 }, {
        arrival: { mode: 'all', interestPct: 50 },
        behaviour: { payPct: 50, releasePct: 50, missPct: 0, leavePct: 0, holdSeconds: 1.5 },
        choices: { size: '52', quantity: 1, addOnsPct: 100 },
      }),
      w.f.admin,
    );
    await drive(w, 0, 500, release.id);
    let view = await w.tests.view(run.id);
    expect(view.byTier.map((t) => t.inRoom)).toEqual([0, 3, 0, 3]);
    expect(await w.h.ctx.db.selectFrom('live_interest').select('account_id').where('drop_id', '=', release.id).execute()).toHaveLength(3);
    // T0: the line forms, the turns go, each bot presses, holds 1.5 s, secures, adds its add-on, then pays or releases.
    w.h.clock.set(t0);
    await drive(w, 20_000, 500, release.id);
    expect(await statusOf(w, run.id)).toBe('DONE');
    view = await w.tests.view(run.id);
    const sum = (k: 'confirmed' | 'released') => view.byTier.reduce((n, t) => n + t[k], 0);
    expect([sum('confirmed'), sum('released')]).toEqual([3, 3]);
    const entries = await w.h.ctx.db.selectFrom('live_entries').select(['status', 'gesture_ms', 'network_hash', 'tier', 'position']).where('drop_id', '=', release.id).orderBy('position').execute();
    expect(entries.every((e) => (e.gesture_ms ?? 0) >= 1400)).toBe(true);
    expect(new Set(entries.map((e) => Buffer.from(e.network_hash!).toString('hex'))).size).toBe(6);
    expect(entries.slice(0, 3).every((e) => e.tier === 3)).toBe(true);
    const orders = await w.h.ctx.db.selectFrom('orders').select(['status', 'addons']).where('drop_id', '=', release.id).execute();
    expect(orders).toHaveLength(3);
    expect(orders.every((o) => o.status === 'RESERVED' && (o.addons as unknown[]).length === 1)).toBe(true);
    expect((await w.h.ctx.services.liveRoom.frame(release.id))?.room).toMatchObject({ left: 3 });

    const ended = await w.tests.end(run.id, testPhrase(release.id, true), w.f.admin);
    expect(ended.report?.checks.map((c) => c.pass)).toEqual([true, true, true, true, true]);
    expect((await w.h.ctx.db.selectFrom('orders').select('status').where('drop_id', '=', release.id).execute()).every((o) => o.status === 'CANCELLED')).toBe(true);
    // The places paid are closed too (REMOVED, `confirmed_at` cleared): the room sells their three pieces again.
    const after = await w.h.ctx.db.selectFrom('live_entries').select(['status', 'confirmed_at', 'removed_by', 'removed_at', 'ended_at']).where('drop_id', '=', release.id).execute();
    expect(after.map((e) => e.status).sort()).toEqual(['RELEASED', 'RELEASED', 'RELEASED', 'REMOVED', 'REMOVED', 'REMOVED']);
    expect(after.filter((e) => e.status === 'REMOVED').every((e) => e.confirmed_at === null && e.removed_by === w.f.admin.id && e.removed_at?.getTime() === e.ended_at?.getTime())).toBe(true);
    const removals = await w.h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.live.remove').where('target_id', '=', release.id).execute();
    expect(removals.map((r) => r.details)).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({ from: 'CONFIRMED', reason: 'test_ended' })));
    expect((await w.h.ctx.services.liveRoom.frame(release.id))?.room).toMatchObject({ left: 6, held: 0 });
  });

  it('a size of the release set aside during the test (plan NEXT LOT §3.3): END TEST cancels the orders, their stock back on that SKU, the report 5/5, the size still there and set aside', async () => {
    const db = w.h.ctx.db;
    const model = await createModel(db, 'ECLAT');
    await w.h.ctx.services.sizes.declare(model, { sizeType: 'RING', ticked: ['52', '54'] }, w.f.admin);
    const sku52 = (await db.selectFrom('skus').select('id').where('model_id', '=', model).where('size_label', '=', '52').executeTakeFirstOrThrow()).id;
    const france = (await db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    await w.h.ctx.services.stock.adjust({ skuId: sku52, locationId: france, delta: 3, note: 'Counted.' }, w.f.admin);
    const t0 = new Date(w.h.clock.now().getTime() + 2 * MINUTE);
    const release = await createLiveRelease(w.f, { modelId: model, opensAt: t0, sizes: [{ label: '52', stock: 3 }] });
    const run = await w.tests.start(
      release.id,
      press(release.id, { titane: 3 }, { behaviour: { payPct: 100, releasePct: 0, missPct: 0, leavePct: 0, holdSeconds: 1.5 }, choices: { size: '52', quantity: 1, addOnsPct: 0 } }),
      w.f.admin,
    );
    await drive(w, 0, 500, release.id);
    w.h.clock.set(t0);
    await drive(w, 20_000, 500, release.id);
    const orders = await db.selectFrom('orders').select(['status', 'sku_id', 'location_id', 'reservation']).where('drop_id', '=', release.id).execute();
    expect(orders).toHaveLength(3);
    expect(orders.every((o) => o.status === 'RESERVED' && o.sku_id === sku52 && o.reservation === 'STOCK')).toBe(true);
    const location = orders[0]!.location_id;
    expect((await stockLevel(db, sku52, location)).available).toBe(0);
    // Set aside while the test's orders hold it: used, so never deleted.
    expect((await w.h.ctx.services.sizes.removeSize(model, sku52, w.f.admin)).outcome).toBe('SET_ASIDE');

    const ended = await w.tests.end(run.id, testPhrase(release.id, true), w.f.admin);
    expect(ended.report?.checks.map((c) => [c.id, c.pass])).toEqual([['ONE_ENTRY', true], ['ORDER', true], ['ONE_PLACE', true], ['STOCK', true], ['ORDERS', true]]);
    expect((await db.selectFrom('orders').select('status').where('drop_id', '=', release.id).execute()).every((o) => o.status === 'CANCELLED')).toBe(true);
    expect(await stockLevel(db, sku52, location)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    const sku = await db.selectFrom('skus').select(['id', 'set_aside_at']).where('id', '=', sku52).executeTakeFirstOrThrow();
    expect(sku.set_aside_at).not.toBeNull();
    expect(await db.selectFrom('skus').select('id').where('model_id', '=', model).execute()).toHaveLength(2);
  });

  it('END TEST cancels the test\'s orders waiting for supplier stock before those holding stock (plan NEXT LOT §3.5.9): the piece freed serves the real collector waiting, never a test order; no serial is retired; the report 5/5', async () => {
    const db = w.h.ctx.db;
    const model = await createModel(db, 'HALO');
    await w.h.ctx.services.sizes.declare(model, { sizeType: 'RING', ticked: ['52'] }, w.f.admin);
    const sku52 = (await db.selectFrom('skus').select('id').where('model_id', '=', model).where('size_label', '=', '52').executeTakeFirstOrThrow()).id;
    const france = (await db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    await w.h.ctx.services.stock.adjust({ skuId: sku52, locationId: france, delta: 1, note: 'Counted.' }, w.f.admin);
    const t0 = new Date(w.h.clock.now().getTime() + 2 * MINUTE);
    const release = await createLiveRelease(w.f, { modelId: model, opensAt: t0, sizes: [{ label: '52', stock: 3 }] });
    const run = await w.tests.start(
      release.id,
      press(release.id, { titane: 3 }, { behaviour: { payPct: 100, releasePct: 0, missPct: 0, leavePct: 0, holdSeconds: 1.5 }, choices: { size: '52', quantity: 1, addOnsPct: 0 } }),
      w.f.admin,
    );
    await drive(w, 0, 500, release.id);
    w.h.clock.set(t0);
    await drive(w, 20_000, 500, release.id);
    const tests = await db.selectFrom('orders').select(['id', 'reservation', 'location_id']).where('drop_id', '=', release.id).execute();
    expect(tests.map((o) => o.reservation).sort()).toEqual(['AWAITING', 'AWAITING', 'STOCK']);
    // A real collector's order of the same size waits behind them, at the same location.
    w.h.clock.advance(MINUTE);
    const real = await createAccount(db);
    const request = await db.insertInto('shop_requests').values({ account_id: real.id, model_id: model, created_at: w.h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await w.h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, w.f.admin);
    const realOrder = (await db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    expect(tests.every((o) => o.location_id === france)).toBe(true);
    await w.h.ctx.services.orders.setTerms(realOrder, { sizeLabel: '52' }, w.f.admin);
    expect((await db.selectFrom('orders').select('reservation').where('id', '=', realOrder).executeTakeFirstOrThrow()).reservation).toBe('AWAITING');
    const retired = (await db.selectFrom('products').select('id').where('status', '=', 'RETIRED').execute()).length;

    const ended = await w.tests.end(run.id, testPhrase(release.id, true), w.f.admin);
    expect(ended.report?.checks.map((c) => [c.id, c.pass])).toEqual([['ONE_ENTRY', true], ['ORDER', true], ['ONE_PLACE', true], ['STOCK', true], ['ORDERS', true]]);
    expect((await db.selectFrom('orders').select('status').where('drop_id', '=', release.id).execute()).every((o) => o.status === 'CANCELLED')).toBe(true);
    // The waiting test orders went first: the piece freed last served the real order, and no test order was served.
    expect((await db.selectFrom('orders').select('reservation').where('id', '=', realOrder).executeTakeFirstOrThrow()).reservation).toBe('STOCK');
    const served = await db.selectFrom('order_events').select('order_id').where('action', '=', 'order.serve').where('order_id', 'in', [...tests.map((o) => o.id), realOrder]).execute();
    expect(served.map((e) => e.order_id)).toEqual([realOrder]);
    expect((await db.selectFrom('products').select('id').where('status', '=', 'RETIRED').execute()).length).toBe(retired);
  });

  it('by hand: a bot on its turn secures and pays now (CONFIRM); RELEASE needs a held piece, and a draw\'s place is never released', async () => {
    const t0 = new Date(w.h.clock.now().getTime() + 2 * MINUTE);
    const release = await createLiveRelease(w.f, { opensAt: t0, sizes: [{ label: '52', stock: 2 }] });
    const run = await w.tests.start(release.id, press(release.id, { titane: 2 }, { behaviour: { payPct: 0, releasePct: 0, missPct: 100, leavePct: 0, holdSeconds: 1.5 } }), w.f.admin);
    await drive(w, 0, 500, release.id);
    w.h.clock.set(t0);
    await drive(w, 1000, 500, release.id);
    let view = await w.tests.view(run.id);
    expect(view.selected.map((s) => [s.status, s.canConfirm, s.canRelease])).toEqual([
      ['TURN', true, false],
      ['TURN', true, false],
    ]);
    const [first, second] = view.selected;
    await rejects(w.tests.releaseEntrant(run.id, first!.accountId, w.f.admin), 'TEST_HOLD_NOT_HELD', 409);
    view = await w.tests.confirmEntrant(run.id, first!.accountId, w.f.admin);
    expect(view.selected.find((s) => s.accountId === first!.accountId)).toMatchObject({ status: 'CONFIRMED', canConfirm: false });
    expect(view.selected.find((s) => s.accountId === first!.accountId)!.orderRef).toMatch(/^OR-/);
    const actions = (await w.h.ctx.db.selectFrom('audit_logs').select('action').where('target_id', '=', run.id).execute()).map((a) => a.action);
    expect(actions).toContain('test_run.confirm');
    // The other misses its turn.
    await drive(w, 31_000, 1000, release.id);
    expect((await w.tests.view(run.id)).byTier[1]).toMatchObject({ confirmed: 1, missed: 1 });
    await rejects(w.tests.confirmEntrant(run.id, second!.accountId, w.f.admin), 'TEST_PLACE_NOT_HELD', 409);
    await w.tests.end(run.id, testPhrase(release.id, true), w.f.admin);
    await rejects(w.tests.confirmEntrant(run.id, second!.accountId, w.f.admin), 'TEST_ENDED', 409);

    const drop = await openDraw(w);
    const drawRun = await w.tests.start(drop, press(drop, { titane: 1 }), w.f.admin);
    await drive(w, 0);
    const bot = await w.h.ctx.db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', drawRun.id).executeTakeFirstOrThrow();
    await rejects(w.tests.releaseEntrant(drawRun.id, bot.account_id, w.f.admin), 'TEST_DRAW_NO_RELEASE', 409);
    await rejects(w.tests.confirmEntrant(drawRun.id, bot.account_id, w.f.admin), 'TEST_PLACE_NOT_HELD', 409);
    await rejects(w.tests.confirmEntrant(drawRun.id, w.f.admin.id, w.f.admin), 'TEST_ENTRANT_NOT_FOUND', 404);
  });
});
