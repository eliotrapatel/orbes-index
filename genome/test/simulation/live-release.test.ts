/**
 * The LIVE RELEASE's engine under a seeded randomised simulation (plan of 2026-10-04, Quality bar 1).
 *
 * Each scenario, drawn from its seed: a release with 1 to 4 sizes and their stock (some 0), 1 to 3 pieces per person,
 * turn and pay windows with per-tier overrides, tier priority or not, an access tier; 3 to 16 accounts of every tier
 * from a pool, arriving before T0 (in the room) or after (behind), some saying I'LL BE THERE first. Then steps at
 * random intervals (from a tenth of a second to a three-minute outage of the engine, i.e. clock jumps): the engine's
 * pass, presses (some too short, some twice), secures, add-ons, PAY, RELEASE MY PLACE, size changes before T0, leaves;
 * the console's pauses, resumes, extensions, pieces added, holds freed, entries let in or removed, a host message, an
 * early end; restarts (a new service on the same database). After every step the invariants hold:
 *
 *  - per size, the quantities in TURN, SECURED and CONFIRMED never exceed its stock;
 *  - places are unique; the cohort of T0 holds places 1..n in the order of the rule (tier at T0, then
 *    sha256(seed ‖ id)), the later arrivals the places after it in arrival order; a size and quantity never change once
 *    in the line;
 *  - a turn goes only to the first QUEUED entry of its size that the size can still serve (or by a LET IN), never while
 *    paused, before T0, after the close or the end, with its tier's window;
 *  - legal transitions only; add-ons only on a held or confirmed piece;
 *  - paused time never consumes a turn or a hold: a MISSED turn and an EXPIRED hold (not freed) ran exactly their
 *    windows outside the pauses, a freed hold until it was freed or its end; a refusal for a passed turn (SECURE,
 *    PRESS, LEAVE) or an ended hold comes exactly then; a press held 1.4 s secures, a shorter one never;
 *  - the end: SOLD_OUT exactly when every piece is confirmed before the close (at the last confirmation), CLOSED at
 *    `closes_at`, ENDED only by the console; set once, on time, never changed; a pause ends by RESUME, END or with the
 *    release, never outlives it; after it no WAITING or QUEUED entry (nor TURN after ENDED) and no new turn; in the
 *    end every release is over, with no RESUME forced;
 *  - the engine's pass is idempotent: a second pass at the same time changes nothing;
 *  - the after-room (plan LIVE RELEASE+, choice 2), in half the scenarios: at the release's sell-out exactly the entries
 *    still WAITING or QUEUED are remembered, places 1..n in their order in the line, and the after-room is published
 *    then, its T0 its delay later, its close its length after that; any other end (or nobody waiting) cancels it then.
 *    Opened, it runs the same engine under the same invariants, but for its line: each guest enters straight into it at
 *    its remembered place (nobody else ever enters, a guest never before its T0), the turns by those places with the
 *    release's per-tier windows; it ends SOLD_OUT, CLOSED at its length or ENDED, and never has an after-room of its
 *    own.
 *
 * Entry ids and sealed seeds are random (the database draws them): a failure prints the scenario's seed and its trace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DropRow, LiveEntryRow, LiveEntryStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { openDropSeed } from '../../src/server/services/drops.js';
import { LIVE_GESTURE_MIN_MS, lineOrder, LiveService } from '../../src/server/services/live.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, createModel, liveFixture, type LiveFixture, type LiveRelease } from '../support/live.js';
import { hashSeed, Prng } from '../support/prng.js';

/** Scenarios run, in batches of BATCH (one test each). */
const SCENARIOS = 320;
const BATCH = 20;
const MAX_STEPS = 140;
const T0 = new Date('2027-01-05T10:00:00.000Z').getTime();
const SECOND = 1000;
const MINUTE = 60_000;

type Tier = 0 | 1 | 2 | 3;

const LEGAL: Readonly<Record<LiveEntryStatus, readonly LiveEntryStatus[]>> = {
  WAITING: ['WAITING', 'QUEUED', 'TURN', 'LEFT', 'REMOVED', 'ENDED'],
  QUEUED: ['QUEUED', 'TURN', 'LEFT', 'REMOVED', 'ENDED'],
  TURN: ['TURN', 'SECURED', 'MISSED', 'LEFT', 'REMOVED', 'ENDED'],
  SECURED: ['SECURED', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'REMOVED'],
  CONFIRMED: ['CONFIRMED'],
  MISSED: ['MISSED'],
  EXPIRED: ['EXPIRED'],
  RELEASED: ['RELEASED'],
  // A LEFT entry that never had a place (it left the room) enters again: WAITING before T0, QUEUED after.
  LEFT: ['LEFT', 'WAITING', 'QUEUED'],
  REMOVED: ['REMOVED'],
  ENDED: ['ENDED'],
};
const OPEN: readonly LiveEntryStatus[] = ['WAITING', 'QUEUED', 'TURN', 'SECURED'];
/** The steps after which a turn may be given in the order of the line. */
const GIVES_TURNS = new Set(['tick', 'tick again', 'release', 'leave', 'free', 'remove', 'add pieces', 'resume']);

interface Snapshot {
  now: number;
  drop: DropRow;
  sizes: { id: string; stock: number }[];
  entries: Map<string, LiveEntryRow>;
  /** Entries that have add-ons. */
  withAddons: Set<string>;
}

interface Person {
  id: string;
  tier: Tier;
  arriveAt: number;
  size: number;
  quantity: number;
  interested: boolean;
  entered: boolean;
}

/** An after-room's settings in a scenario. */
interface AfterRoomPlan {
  sizes: { label: string; stock: number }[];
  addons: boolean;
  delay: number;
  length: number;
}

interface World {
  seed: number;
  rng: Prng;
  f: LiveFixture;
  live: LiveService;
  r: LiveRelease;
  dropId: string;
  turnSeconds: number;
  payMinutes: number;
  overrides: Map<number, { turn: number | null; pay: number | null }>;
  tierPriority: boolean;
  people: Person[];
  pauses: { from: number; to: number | null }[];
  freed: Set<string>;
  /** Each account's entry in the release, once it has one. */
  accountEntries: Map<string, string>;
  /** Each account's last press the server accepted (the server keeps the latest: a SECURE counts from it). */
  lastPress: Map<string, number>;
  prev: Snapshot | null;
  trace: string[];
  stats: Record<string, number>;
  /** The after-room's settings, when the release has one. */
  afterRoom: AfterRoomPlan | null;
  /** The release's own phase, or its after-room's (then each guest's place in its line, by account). */
  phase: 'release' | 'afterRoom';
  places: Map<string, number>;
  /** The release's end: its time, its reason, the entries it ENDED that were WAITING or QUEUED (in the line's order). */
  end: { at: Date; reason: string; waiting: string[] } | null;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(11, 23);

describe('the LIVE RELEASE engine, simulated', () => {
  let t: TestDb;
  let f: LiveFixture;
  let afterModel: string;
  const pool: { id: string; tier: Tier }[] = [];
  const totals: Record<string, number> = {};

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2027-01-04T09:00:00.000Z');
    afterModel = await createModel(t.db, 'AFTERGLOW');
    const tiers: Tier[] = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3];
    for (const tier of [...tiers, ...tiers]) pool.push({ id: (await accountOfTier(f, tier)).id, tier });
  });
  let batchesRun = 0;
  afterAll(async () => {
    await t.close();
    // The harness did what it says when it ran whole: every kind of step ran, every end and refusal it checks happened.
    if (batchesRun < SCENARIOS / BATCH) return;
    for (const k of ['enter', 'tick', 'press', 'secure', 'confirm', 'release', 'leave', 'change size', 'add-ons', 'pause', 'resume', 'extend', 'add pieces', 'free', 'let in', 'remove', 'end', 'restart']) {
      expect(totals[`${k}:ok`] ?? 0, k).toBeGreaterThan(0);
    }
    for (const k of [
      'end:SOLD_OUT', 'end:CLOSED', 'end:ENDED', 'pause ended:CLOSED',
      'status:QUEUED', 'status:TURN', 'status:SECURED', 'status:CONFIRMED', 'status:MISSED', 'status:EXPIRED', 'status:RELEASED', 'status:LEFT', 'status:REMOVED', 'status:ENDED',
      'refused:LIVE_HOLD_TOO_SHORT', 'refused:LIVE_TURN_PASSED', 'refused:LIVE_HOLD_ENDED', 'refused:LIVE_PAUSED', 'refused:LIVE_NO_FREE_PIECE', 'refused:LIVE_SIZE_LOCKED',
      // The after-room: opened, and not, for each reason; refused to anyone but its guests and before its T0; run to each end.
      'afterRoom:opened', 'afterRoom:skipped:NO_GUESTS', 'afterRoom:skipped:NOT_SOLD_OUT', 'afterRoom:refused:stranger', 'afterRoom:refused:early',
      'afterRoom:enter:ok', 'afterRoom:status:CONFIRMED', 'afterRoom:status:MISSED', 'afterRoom:end:SOLD_OUT', 'afterRoom:end:CLOSED',
    ]) {
      expect(totals[k] ?? 0, k).toBeGreaterThan(0);
    }
  });

  const batches = Array.from({ length: SCENARIOS / BATCH }, (_, i) => i);
  it.each(batches)('scenarios of batch %i hold every invariant', async (batch) => {
    for (let s = batch * BATCH; s < (batch + 1) * BATCH; s++) {
      const w = await scenario(s);
      try {
        await run(w);
      } catch (e) {
        throw new Error(`scenario ${s} failed: ${(e as Error).message}\n${w.trace.slice(-40).join('\n')}`, { cause: e });
      }
      for (const [k, n] of Object.entries(w.stats)) totals[k] = (totals[k] ?? 0) + n;
    }
    batchesRun++;
  });

  // ── A scenario ─────────────────────────────────────────────────────────────

  async function scenario(seed: number): Promise<World> {
    const rng = new Prng(hashSeed('live-release', seed));
    const sizes = Array.from({ length: rng.int(1, 4) }, (_, i) => ({ label: `${50 + 2 * i}`, stock: rng.chance(0.15) ? 0 : rng.int(1, 4) }));
    if (sizes.every((s) => s.stock === 0)) sizes[0]!.stock = rng.int(1, 3);
    const turnSeconds = rng.pick([10, 15, 20, 30, 40]);
    const payMinutes = rng.int(1, 3);
    const windows = ([0, 1, 2, 3] as const)
      .filter(() => rng.chance(0.25))
      .map((tier) => ({ tier, turnSeconds: rng.chance(0.5) ? rng.pick([10, 25, 60]) : null, payMinutes: rng.chance(0.6) ? rng.int(1, 4) : null }))
      .filter((x) => x.turnSeconds !== null || x.payMinutes !== null);
    const tierPriority = rng.chance(0.8);
    const minTier = rng.chance(0.75) ? 0 : rng.int(1, 2);
    const perAccount = rng.pick([1, 1, 2, 3]);
    // Half the releases have an after-room: few pieces, so that it sells out often; a delay and a length of its own. Drawn
    // from a generator of its own, so the release's scenario is the one its seed has always drawn.
    const arng = new Prng(hashSeed('live-after-room', seed));
    const afterRoom: AfterRoomPlan | null = arng.chance(0.5)
      ? {
          sizes: Array.from({ length: arng.int(1, 2) }, (_, i) => ({ label: `A${i + 1}`, stock: arng.int(i === 0 ? 1 : 0, 3) })),
          addons: arng.chance(0.5),
          delay: arng.int(1, 15),
          length: arng.int(5, 12),
        }
      : null;
    f.clock.set(T0 - 6 * MINUTE);
    const r = await createLiveRelease(f, {
      opensAt: new Date(T0),
      closesAt: new Date(T0 + rng.int(2, 8) * MINUTE),
      sizes,
      addons: rng.chance(0.6) ? [{ label: 'ENGRAVING', priceMinor: 15_000 }, { label: 'GIFT BOX', priceMinor: 5_000 }] : [],
      minTier,
      tierPriority,
      turnSeconds,
      payMinutes,
      perAccount,
      windows,
      ...(afterRoom
        ? {
            afterRoom: {
              modelId: afterModel,
              priceMinor: 90_000,
              sizes: afterRoom.sizes,
              addons: afterRoom.addons ? [{ label: 'GIFT BOX', priceMinor: 5_000 }] : [],
              delayMinutes: afterRoom.delay,
              lengthMinutes: afterRoom.length,
            },
          }
        : {}),
    });
    const chosen = new Set<number>();
    const n = rng.int(3, 16);
    while (chosen.size < n) chosen.add(rng.int(0, pool.length - 1));
    const people = [...chosen].map((i) => ({
      ...pool[i]!,
      arriveAt: rng.chance(0.6) ? T0 - rng.int(1, 5 * 60) * SECOND : T0 + rng.int(0, 4 * 60) * SECOND + rng.int(1, 999),
      size: rng.int(0, sizes.length - 1),
      quantity: rng.int(1, perAccount + (rng.chance(0.1) ? 1 : 0)),
      interested: rng.chance(0.3),
      entered: false,
    }));
    return {
      seed,
      rng,
      f,
      live: f.live,
      r,
      dropId: r.id,
      turnSeconds,
      payMinutes,
      overrides: new Map(windows.map((x) => [x.tier, { turn: x.turnSeconds, pay: x.payMinutes }])),
      tierPriority,
      people,
      pauses: [],
      freed: new Set(),
      accountEntries: new Map(),
      lastPress: new Map(),
      prev: null,
      trace: [
        `seed ${seed}: sizes ${JSON.stringify(sizes)}, turn ${turnSeconds}s, pay ${payMinutes}min, windows ${JSON.stringify(windows)}, priority ${tierPriority}, minTier ${minTier}, perAccount ${perAccount}, afterRoom ${JSON.stringify(afterRoom)}`,
      ],
      stats: {},
      afterRoom,
      phase: 'release',
      places: new Map(),
      end: null,
    };
  }

  async function run(w: World): Promise<void> {
    w.f.clock.set(T0 - 6 * MINUTE);
    w.prev = await snapshot(w);
    for (const p of w.people.filter((x) => x.interested)) {
      await step(w, 'interest', () => w.live.setInterest(p.id, w.dropId, w.r.sizes[p.size]!.id, { type: 'account', id: p.id }));
    }
    await live(w);
    count(w, `end:${w.prev!.drop.ended_reason}`);
    if (w.afterRoom) await afterRoom(w);
  }

  /** The steps of the release (or of its after-room) until it is over, with a reason. */
  async function live(w: World): Promise<void> {
    const { rng } = w;
    for (let i = 0; i < MAX_STEPS; i++) {
      // Small steps while turns and holds run (most are taken), larger ones otherwise; now and then an outage.
      const jump = rng.float();
      const busy = [...w.prev!.entries.values()].some((e) => e.status === 'TURN' || e.status === 'SECURED');
      const [small, medium, large] = busy ? [0.85, 0.97, 0.995] : [0.7, 0.9, 0.98];
      w.f.clock.advance(jump < small ? rng.int(100, 2500) : jump < medium ? rng.int(3, 15) * SECOND : jump < large ? rng.int(20, 70) * SECOND : rng.int(90, 200) * SECOND);
      const now = w.f.clock.now().getTime();
      const due = w.people.find((p) => !p.entered && p.arriveAt <= now);
      if (due) {
        due.entered = true;
        await step(w, 'enter', () => w.live.enter(due.id, w.dropId, { sizeId: w.r.sizes[due.size]!.id, quantity: due.quantity }, { type: 'account', id: due.id }));
        continue;
      }
      const roll = rng.float();
      if (roll < 0.4) await tick(w);
      else if (roll < 0.86) await customer(w);
      else if (roll < 0.98) await consoleControl(w);
      else {
        // A restart: a new service on the same database; the turns' secrets are the same.
        w.live = new LiveService({ db: w.f.db, audit: w.f.audit, seedKey: w.f.seedKey, turnKey: w.f.turnKey, clock: w.f.clock.now });
        count(w, 'restart:ok');
      }
      if (await over(w)) break;
    }
    // Then time runs on until every turn and hold has ended: the release is over, with a reason.
    for (let i = 0; i < 40 && !(await over(w)); i++) {
      w.f.clock.advance(rng.int(30, 120) * SECOND);
      if (w.prev!.drop.paused_at && rng.chance(0.5)) await step(w, 'resume', () => w.live.resume(w.dropId, w.f.admin));
      await tick(w);
    }
    // No RESUME forced here: a pause still in progress at the close ends with the release, by the engine's pass.
    w.f.clock.advance(20 * MINUTE);
    await tick(w);
    expect(await over(w), 'over').toBe(true);
    expect(w.prev!.drop.ended_reason, 'ended').not.toBeNull();
  }

  /**
   * The release over, its after-room: opened at its sell-out for exactly those it ENDED in the line, in that order, or
   * cancelled at its end; opened, run as a release of its own by its guests (strangers and early guests refused).
   */
  async function afterRoom(w: World): Promise<void> {
    const { rng } = w;
    const plan = w.afterRoom!;
    const parent = w.prev!.drop;
    const end = w.end!;
    const child = await w.f.db.selectFrom('drops').selectAll().where('parent_drop_id', '=', w.dropId).executeTakeFirstOrThrow();
    const guests = await w.f.db
      .selectFrom('after_room_guests as g')
      .innerJoin('live_entries as e', 'e.id', 'g.entry_id')
      .select(['g.entry_id', 'g.position', 'g.remembered_at', 'e.account_id'])
      .where('g.drop_id', '=', child.id)
      .orderBy('g.position')
      .execute();
    expect(end.at, 'the end is the release’s').toEqual(parent.ended_at);
    if (end.reason !== 'SOLD_OUT' || end.waiting.length === 0) {
      // Never opened: cancelled when the release ended, nobody remembered.
      expect(child.published_at, 'not opened').toBeNull();
      expect(child.cancelled_at, 'cancelled at the end').toEqual(parent.ended_at);
      expect(guests).toEqual([]);
      count(w, `afterRoom:skipped:${end.reason === 'SOLD_OUT' ? 'NO_GUESTS' : 'NOT_SOLD_OUT'}`);
      return;
    }
    // Opened at the sell-out for those it ENDED in the line, in that order; its T0 its delay later, its length after that.
    expect(guests.map((g) => g.entry_id), 'the guests: the line at the sell-out, in order').toEqual(end.waiting);
    expect(guests.map((g) => g.position)).toEqual(guests.map((_, i) => i + 1));
    for (const g of guests) expect(g.remembered_at).toEqual(parent.ended_at);
    const opens = parent.ended_at!.getTime() + plan.delay * MINUTE;
    expect(child).toMatchObject({ published_at: parent.ended_at, cancelled_at: null, opens_at: new Date(opens), closes_at: new Date(opens + plan.length * MINUTE) });
    count(w, 'afterRoom:opened');

    // Its own phase: its id, sizes, add-ons; its guests and their places; its own pauses and presses.
    const sizes = await w.f.db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', child.id).orderBy('position').execute();
    const addons = await w.f.db.selectFrom('live_addons').select(['id', 'label', 'price_minor']).where('drop_id', '=', child.id).orderBy('position').execute();
    const tiers = new Map(w.people.map((p) => [p.id, p.tier]));
    const strangers = w.people.filter((p) => !guests.some((g) => g.account_id === p.id));
    w.phase = 'afterRoom';
    w.dropId = child.id;
    w.r = { id: child.id, sizes, addons: addons.map((a) => ({ id: a.id, label: a.label, priceMinor: a.price_minor })), afterRoom: null };
    w.places = new Map(guests.map((g) => [g.account_id, g.position]));
    w.pauses = [];
    w.freed = new Set();
    w.accountEntries = new Map();
    w.lastPress = new Map();
    w.end = null;
    // Most guests come, at a moment of its opening; some never do.
    w.people = guests
      .filter(() => rng.chance(0.85))
      .map((g) => ({ id: g.account_id, tier: tiers.get(g.account_id)!, arriveAt: opens + rng.int(0, Math.floor(plan.length * MINUTE * 0.6)), size: rng.int(0, sizes.length - 1), quantity: rng.int(1, 2), interested: false, entered: false }));
    // Its phase starts at a moment between the sell-out and its T0 (the release's own phase ran its clock on to make sure
    // it was over: nothing of the after-room happened meanwhile, the engine never touching it before its T0).
    w.f.clock.set(new Date(parent.ended_at!.getTime() + rng.int(0, plan.delay * MINUTE)));
    w.prev = await snapshot(w);
    w.trace.push(`after-room ${child.id.slice(0, 8)}: guests ${guests.length}, opens ${iso(opens)}`);
    // Before its T0, a guest reads an unknown release; at any time, anyone else does.
    if (w.f.clock.now().getTime() < opens - SECOND) {
      const g = guests[0]!;
      const outcome = await step(w, 'enter early', () => w.live.enter(g.account_id, child.id, { sizeId: sizes[0]!.id }, { type: 'account', id: g.account_id }));
      expect(outcome, 'a guest before its T0').toBe('DROP_NOT_FOUND');
      count(w, 'afterRoom:refused:early');
    }
    w.f.clock.set(new Date(Math.max(w.f.clock.now().getTime(), opens)));
    for (const p of strangers.slice(0, 2)) {
      const outcome = await step(w, 'enter stranger', () => w.live.enter(p.id, child.id, { sizeId: sizes[0]!.id }, { type: 'account', id: p.id }));
      expect(outcome, 'anyone but a guest').toBe('DROP_NOT_FOUND');
      count(w, 'afterRoom:refused:stranger');
    }
    await live(w);
    count(w, `afterRoom:end:${w.prev!.drop.ended_reason}`);
    for (const e of w.prev!.entries.values()) count(w, `afterRoom:status:${e.status}`);
    // It never has an after-room of its own.
    expect(await w.f.db.selectFrom('drops').select('id').where('parent_drop_id', '=', child.id).execute()).toEqual([]);
  }

  async function over(w: World): Promise<boolean> {
    const s = w.prev!;
    return s.drop.ended_at !== null && [...s.entries.values()].every((e) => !OPEN.includes(e.status));
  }

  async function tick(w: World): Promise<void> {
    await step(w, 'tick', () => w.live.advance(w.dropId));
    if (w.rng.chance(0.3)) {
      const before = w.prev!;
      await step(w, 'tick again', () => w.live.advance(w.dropId));
      expect(rowsOf(w.prev!), 'a second pass at the same time changes nothing').toEqual(rowsOf(before));
    }
  }

  async function customer(w: World): Promise<void> {
    const { rng } = w;
    const inIt = w.people.filter((p) => w.prev!.entries.has(entryKey(w, p.id)));
    if (inIt.length === 0) return tick(w);
    // Those whose turn or hold runs act more often than those who wait.
    const active = inIt.filter((p) => ['TURN', 'SECURED'].includes(w.prev!.entries.get(entryKey(w, p.id))!.status));
    const p = active.length && rng.chance(0.75) ? rng.pick(active) : rng.pick(inIt);
    const e = w.prev!.entries.get(entryKey(w, p.id))!;
    const actor = { type: 'account' as const, id: p.id };
    const now = w.f.clock.now().getTime();
    switch (e.status) {
      case 'WAITING':
        if (rng.chance(0.25)) await step(w, 'change size', () => w.live.changeSize(p.id, w.dropId, { sizeId: rng.pick(w.r.sizes).id, quantity: rng.int(1, 2) }, actor));
        else if (rng.chance(0.15)) {
          await step(w, 'leave', () => w.live.leave(p.id, w.dropId, actor));
          // Some come back: before T0 to the room, after it behind the line.
          if (rng.chance(0.6)) {
            p.entered = false;
            p.arriveAt = now + rng.int(1, 120) * SECOND;
          }
        } else await tick(w);
        return;
      case 'QUEUED':
        if (rng.chance(0.06)) await step(w, 'leave', () => w.live.leave(p.id, w.dropId, actor));
        else await tick(w);
        return;
      case 'TURN': {
        if (rng.chance(0.05)) return void (await step(w, 'leave', () => w.live.leave(p.id, w.dropId, actor), { person: p }));
        if (rng.chance(0.25)) return tick(w); // slow: the turn may run out
        const token = (await w.live.entry(p.id, w.dropId))?.turn?.token ?? 'none';
        const kind = rng.float();
        // Most hold the seal long enough; some let go too soon; some send SECURE without a new press.
        const hold = kind < 0.72 ? rng.int(LIVE_GESTURE_MIN_MS, 2600) : kind < 0.92 ? rng.int(200, LIVE_GESTURE_MIN_MS - 1) : -1;
        if (hold >= 0) {
          await step(w, 'press', () => w.live.press(p.id, w.dropId, token), { person: p });
          if (rng.chance(0.15)) {
            // A double press: the second one restarts the ring.
            w.f.clock.advance(rng.int(1, 300));
            await step(w, 'press', () => w.live.press(p.id, w.dropId, token), { person: p });
          }
          w.f.clock.advance(hold);
        }
        const pressed = w.lastPress.get(p.id);
        await step(w, 'secure', () => w.live.secure(p.id, w.dropId, token, actor), { person: p, hold: pressed === undefined ? -1 : w.f.clock.now().getTime() - pressed });
        return;
      }
      case 'SECURED': {
        const k = rng.float();
        if (k < 0.2 && w.r.addons.length) {
          await step(w, 'add-ons', () => w.live.setAddons(p.id, w.dropId, w.r.addons.filter(() => rng.chance(0.5)).map((a) => a.id), actor));
        } else if (k < 0.75) await step(w, 'confirm', () => w.live.confirm(p.id, w.dropId, actor), { person: p });
        else if (k < 0.83) await step(w, 'release', () => w.live.release(p.id, w.dropId, actor));
        else await tick(w);
        return;
      }
      default:
        return tick(w);
    }
  }

  async function consoleControl(w: World): Promise<void> {
    const { rng } = w;
    const admin = w.f.admin;
    const entries = [...w.prev!.entries.values()];
    const pick = (statuses: LiveEntryStatus[]) => {
      const xs = entries.filter((e) => statuses.includes(e.status));
      return xs.length ? rng.pick(xs) : null;
    };
    const k = rng.float();
    if (k < 0.1) await step(w, w.prev!.drop.paused_at ? 'resume' : 'pause', () => (w.prev!.drop.paused_at ? w.live.resume(w.dropId, admin) : w.live.pause(w.dropId, admin)));
    else if (k < 0.3 && w.prev!.drop.paused_at) await step(w, 'resume', () => w.live.resume(w.dropId, admin));
    else if (k < 0.4) await step(w, 'extend', () => w.live.extend(w.dropId, rng.int(1, 3), admin));
    else if (k < 0.52) await step(w, 'add pieces', () => w.live.addPieces(w.dropId, rng.pick(w.r.sizes).id, rng.int(1, 2), admin));
    else if (k < 0.66) {
      const e = pick(['SECURED']);
      if (e) await step(w, 'free', () => w.live.freeHold(w.dropId, e.id, admin), { entry: e.id });
    } else if (k < 0.8) {
      // Mostly one whose size has a piece free for it (a line stalled by a quantity), else anyone waiting.
      const held = (size: string) => entries.filter((x) => x.size_id === size && ['TURN', 'SECURED', 'CONFIRMED'].includes(x.status)).reduce((n, x) => n + x.quantity, 0);
      const stock = (size: string) => w.prev!.sizes.find((x) => x.id === size)!.stock;
      const fits = entries.filter((x) => x.status === 'QUEUED' && x.quantity <= stock(x.size_id) - held(x.size_id));
      const e = fits.length && rng.chance(0.7) ? rng.pick(fits) : pick(['QUEUED']);
      if (e) await step(w, 'let in', () => w.live.letIn(w.dropId, e.id, admin));
    } else if (k < 0.9) {
      const e = pick(['WAITING', 'QUEUED', 'TURN', 'SECURED']);
      if (e) await step(w, 'remove', () => w.live.remove(w.dropId, e.id, admin));
    } else if (k < 0.95) await step(w, 'message', () => w.live.message(w.dropId, 'The atelier thanks you for waiting.', admin));
    else if (rng.chance(0.4)) await step(w, 'end', () => w.live.end(w.dropId, admin));
  }

  // ── A step and its invariants ──────────────────────────────────────────────

  async function step(w: World, name: string, fn: () => Promise<unknown>, ctx: { person?: Person; hold?: number; entry?: string } = {}): Promise<string> {
    const before = w.prev!;
    let outcome = 'ok';
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof DomainError) || e.httpStatus >= 500) throw e;
      outcome = e.code;
    }
    const after = await snapshot(w);
    w.trace.push(`${iso(after.now)} ${name}${ctx.person ? ` ${ctx.person.id.slice(0, 8)}` : ''}${ctx.hold !== undefined ? ` hold ${ctx.hold}` : ''} → ${outcome}`);
    count(w, `${name}:${outcome}`);
    if (w.phase === 'afterRoom') count(w, `afterRoom:${name}:${outcome}`);
    if (outcome !== 'ok') count(w, `refused:${outcome}`);
    // The end begins: the entries it ENDS that were waiting in the room or the line, in the line's order (the after-room's
    // guests, at a sell-out).
    if (!before.drop.ended_at && after.drop.ended_at) {
      const waiting = [...after.entries.values()]
        .filter((e) => e.status === 'ENDED' && ['WAITING', 'QUEUED'].includes(before.entries.get(e.id)?.status ?? ''))
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.joined_at.getTime() - b.joined_at.getTime() || (a.id < b.id ? -1 : 1));
      w.end = { at: after.drop.ended_at, reason: after.drop.ended_reason!, waiting: waiting.map((e) => e.id) };
    }
    for (const e of after.entries.values()) if (before.entries.get(e.id)?.status !== e.status) count(w, `status:${e.status}`);
    // The console's controls change the pauses' record only when they succeed.
    if (outcome === 'ok' && name === 'pause') w.pauses.push({ from: after.now, to: null });
    if (before.drop.paused_at && !after.drop.paused_at) {
      // A pause ends by RESUME, by END, or with the release (its close or its sell-out).
      expect(name === 'resume' || name === 'end' || (after.drop.ended_at !== null && !before.drop.ended_at), `a pause ended by ${name}`).toBe(true);
      w.pauses.at(-1)!.to = after.now;
      if (name !== 'resume' && name !== 'end') count(w, `pause ended:${after.drop.ended_reason}`);
    }
    if (outcome === 'ok' && name === 'free' && ctx.entry) w.freed.add(ctx.entry);
    if (outcome === 'ok' && name === 'press' && ctx.person) w.lastPress.set(ctx.person.id, after.now);
    check(w, name, outcome, before, after, ctx);
    w.prev = after;
    return outcome;
  }

  function check(w: World, name: string, outcome: string, before: Snapshot, after: Snapshot, ctx: { person?: Person; hold?: number }): void {
    const d = after.drop;
    const now = after.now;
    const opens = d.opens_at.getTime();
    const closes = d.closes_at.getTime();
    const entries = [...after.entries.values()];
    const stockOf = new Map(after.sizes.map((s) => [s.id, s.stock]));
    const sum = (size: string, statuses: LiveEntryStatus[]) => entries.filter((e) => e.size_id === size && statuses.includes(e.status)).reduce((n, e) => n + e.quantity, 0);

    // Per size: TURN + SECURED + CONFIRMED ≤ stock.
    for (const [size, stock] of stockOf) expect(sum(size, ['TURN', 'SECURED', 'CONFIRMED']), `held in size ${size}`).toBeLessThanOrEqual(stock);

    // Unique places; the cohort of T0 in 1..n by the rule; the late ones after it by arrival. In an after-room, every
    // place is the one its guest was given at the sell-out (its order in the release's line), and only a guest has one.
    const placed = entries.filter((e) => e.position !== null).sort((a, b) => a.position! - b.position!);
    expect(new Set(placed.map((e) => e.position)).size).toBe(placed.length);
    if (w.phase === 'afterRoom') {
      for (const e of entries) {
        expect(w.places.has(e.account_id), 'only a guest enters the after-room').toBe(true);
        expect(e.position, 'the guest at its place').toBe(w.places.get(e.account_id));
        expect(e.joined_at.getTime(), 'never before its T0').toBeGreaterThanOrEqual(opens);
      }
    }
    if (w.phase === 'release') {
      const cohort = placed.filter((e) => e.joined_at.getTime() < opens);
      const late = placed.filter((e) => e.joined_at.getTime() >= opens);
      expect(cohort.map((e) => e.position), 'the cohort holds the first places').toEqual(cohort.map((_, i) => i + 1));
      if (cohort.length > 1) {
        const seed = openDropSeed(w.f.seedKey, d);
        expect(cohort.map((e) => e.id), 'the cohort by tier then seed').toEqual(lineOrder(cohort, seed, w.tierPriority).map((e) => e.id));
        seed.fill(0);
      }
      for (const e of cohort) expect(e.tier, 'the tier at T0').toBe(w.people.find((p) => p.id === e.account_id)!.tier);
      expect(late.map((e) => e.id), 'the late ones by arrival').toEqual([...late].sort((a, b) => a.joined_at.getTime() - b.joined_at.getTime() || (a.id < b.id ? -1 : 1)).map((e) => e.id));
      if (cohort.length && late.length) expect(late[0]!.position).toBeGreaterThan(cohort.length);
    }
    if (now < opens) expect(placed, 'no place before T0').toEqual([]);

    // Add-ons only on a held or confirmed piece.
    for (const id of after.withAddons) expect(['SECURED', 'CONFIRMED'], 'add-ons').toContain(after.entries.get(id)!.status);

    // The end: once, on time, for its reason, never changed.
    if (before.drop.ended_at) {
      expect(d.ended_at).toEqual(before.drop.ended_at);
      expect(d.ended_reason).toBe(before.drop.ended_reason);
    }
    const stock = after.sizes.reduce((n, s) => n + s.stock, 0);
    const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
    const confirmedQty = confirmed.reduce((n, e) => n + e.quantity, 0);
    if (d.ended_reason === 'SOLD_OUT') {
      expect(confirmedQty).toBe(stock);
      expect(d.ended_at).toEqual(new Date(Math.max(...confirmed.map((e) => e.confirmed_at!.getTime()))));
      expect(d.ended_at!.getTime()).toBeLessThan(closes);
    }
    if (d.ended_reason === 'CLOSED') expect(d.ended_at).toEqual(d.closes_at);
    if (d.ended_reason === 'ENDED' && !before.drop.ended_at) expect(name).toBe('end');
    if (!before.drop.ended_at && d.ended_at) expect(['tick', 'confirm', 'end']).toContain(name);
    if ((name === 'tick' && now >= closes) || ((name === 'tick' || name === 'confirm') && confirmedQty >= stock)) expect(d.ended_at, 'the end on time').not.toBeNull();
    if (!d.ended_at) expect(confirmedQty < stock || name !== 'tick').toBe(true);
    if (d.ended_at) {
      expect(d.paused_at, 'no pause after the end').toBeNull();
      for (const e of entries) expect(['WAITING', 'QUEUED'], 'nothing waits after the end').not.toContain(e.status);
      if (d.ended_reason === 'ENDED') for (const e of entries) expect(e.status, 'no turn after an END').not.toBe('TURN');
    }

    for (const e of entries) {
      const was = before.entries.get(e.id);
      // Legal transitions only.
      if (!was) expect(w.phase === 'afterRoom' ? ['QUEUED'] : ['WAITING', 'QUEUED'], `a new entry ${e.status}`).toContain(e.status);
      else {
        expect(LEGAL[was.status], `${was.status} → ${e.status} by ${name}`).toContain(e.status);
        if (was.status === 'LEFT' && e.status !== 'LEFT') expect(was.position, 'back in the line').toBeNull();
        if (was.position !== null) {
          expect(e.size_id, 'the size never changes after T0').toBe(was.size_id);
          expect(e.quantity).toBe(was.quantity);
          expect(e.position).toBe(was.position);
        }
      }
      const tier = e.tier;
      const turnMs = (w.overrides.get(tier)?.turn ?? w.turnSeconds) * SECOND;
      const payMs = (w.overrides.get(tier)?.pay ?? w.payMinutes) * MINUTE;
      // A turn given now: to the first of its size the size can still serve (or let in), with its window, never paused.
      if (e.status === 'TURN' && was?.status !== 'TURN') {
        expect(e.turn_at!.getTime()).toBe(now);
        expect(e.turn_expires_at!.getTime() - now, 'the turn window of its tier').toBe(turnMs);
        expect(d.paused_at, 'no turn while paused').toBeNull();
        if (before.drop.paused_at) expect(name, 'a turn after a pause, by RESUME').toBe('resume');
        expect(now).toBeGreaterThanOrEqual(opens);
        expect(now).toBeLessThan(closes);
        expect(d.ended_at, 'no turn after the end').toBeNull();
        if (e.let_in_by) expect(name).toBe('let in');
        else {
          expect(GIVES_TURNS.has(name), `a turn given by ${name}`).toBe(true);
          const servable = (stockOf.get(e.size_id) ?? 0) - sum(e.size_id, ['CONFIRMED']);
          const ahead = entries.filter((x) => x.size_id === e.size_id && x.status === 'QUEUED' && x.position! < e.position! && x.quantity <= servable);
          expect(ahead.map((x) => x.position), `a turn only to the first of its size (place ${e.position})`).toEqual([]);
        }
      }
      // Paused time never consumes a turn or a hold.
      if (e.status === 'MISSED' && was?.status !== 'MISSED') expect(running(w, e.turn_at!, e.ended_at!), 'a missed turn ran its window').toBe(turnMs);
      if (e.status === 'EXPIRED' && was?.status !== 'EXPIRED' && !w.freed.has(e.id)) expect(running(w, e.secured_at!, e.ended_at!), 'an ended hold ran its window').toBe(payMs);
      if (e.status === 'EXPIRED' && was?.status !== 'EXPIRED' && w.freed.has(e.id)) {
        expect(running(w, e.secured_at!, e.ended_at!), 'a hold freed now, or at its end when that has passed').toBe(Math.min(running(w, e.secured_at!, new Date(now)), payMs));
      }
      if (e.status === 'SECURED' && was?.status === 'TURN') {
        expect(running(w, e.turn_at!, new Date(now)), 'secured within its turn').toBeLessThan(turnMs);
        expect(e.hold_expires_at!.getTime() - now, 'the pay window of its tier').toBe(payMs);
        expect(e.gesture_ms!).toBeGreaterThanOrEqual(LIVE_GESTURE_MIN_MS);
      }
      if (e.status === 'CONFIRMED' && was?.status === 'SECURED') expect(running(w, e.secured_at!, new Date(now)), 'confirmed within its hold').toBeLessThan(payMs);
    }
    for (const id of before.entries.keys()) expect(after.entries.has(id), 'an entry never disappears').toBe(true);

    // What the customer was told agrees with the clock and the gesture.
    const mine = ctx.person ? before.entries.get(entryKey(w, ctx.person.id)) : undefined;
    if (mine && (name === 'secure' || name === 'press' || name === 'leave') && mine.status === 'TURN') {
      const tier = mine.tier;
      const turnMs = (w.overrides.get(tier)?.turn ?? w.turnSeconds) * SECOND;
      if (outcome === 'LIVE_TURN_PASSED') expect(running(w, mine.turn_at!, new Date(now))).toBeGreaterThanOrEqual(turnMs);
      if (name === 'leave' && outcome === 'ok') expect(running(w, mine.turn_at!, new Date(now)), 'a turn given back while it runs').toBeLessThan(turnMs);
      if (name === 'secure' && outcome === 'LIVE_HOLD_TOO_SHORT') expect(ctx.hold!).toBeLessThan(LIVE_GESTURE_MIN_MS);
      if (name === 'secure' && outcome === 'ok') {
        expect(ctx.hold!, 'the gesture from the last press').toBeGreaterThanOrEqual(LIVE_GESTURE_MIN_MS);
        expect(after.entries.get(mine.id)!.gesture_ms).toBe(ctx.hold);
      }
      if (name === 'secure' && ctx.hold! >= LIVE_GESTURE_MIN_MS && !before.drop.paused_at && running(w, mine.turn_at!, new Date(now)) < turnMs && outcome !== 'LIVE_NOT_ELIGIBLE') {
        expect(outcome, 'a press held 1.4 s within a running turn secures').toBe('ok');
      }
    }
    if (mine && name === 'confirm' && mine.status === 'SECURED') {
      const payMs = (w.overrides.get(mine.tier)?.pay ?? w.payMinutes) * MINUTE;
      const ran = running(w, mine.secured_at!, new Date(now));
      expect(outcome, 'PAY within the hold, refused after it').toBe(ran < payMs ? 'ok' : 'LIVE_HOLD_ENDED');
    }
  }

  /** The time from `from` to `to` outside the console's pauses. */
  function running(w: World, from: Date, to: Date): number {
    const a = from.getTime();
    const b = to.getTime();
    let paused = 0;
    for (const p of w.pauses) {
      const end = p.to ?? b;
      paused += Math.max(0, Math.min(b, end) - Math.max(a, p.from));
    }
    return b - a - paused;
  }

  function entryKey(w: World, accountId: string): string {
    return w.accountEntries.get(accountId) ?? '';
  }

  async function snapshot(w: World): Promise<Snapshot> {
    const db = w.f.db;
    const drop = await db.selectFrom('drops').selectAll().where('id', '=', w.dropId).executeTakeFirstOrThrow();
    const sizes = await db.selectFrom('drop_sizes').select(['id', 'stock']).where('drop_id', '=', w.dropId).execute();
    const rows = await db.selectFrom('live_entries').selectAll().where('drop_id', '=', w.dropId).execute();
    const addons = rows.length ? await db.selectFrom('live_entry_addons').select('entry_id').distinct().where('entry_id', 'in', rows.map((r) => r.id)).execute() : [];
    for (const r of rows) w.accountEntries.set(r.account_id, r.id);
    return { now: w.f.clock.now().getTime(), drop, sizes, entries: new Map(rows.map((r) => [r.id, r])), withAddons: new Set(addons.map((a) => a.entry_id)) };
  }

  function rowsOf(s: Snapshot) {
    return { drop: s.drop, sizes: s.sizes, entries: [...s.entries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), withAddons: [...s.withAddons].sort() };
  }

  function count(w: World, key: string): void {
    w.stats[key] = (w.stats[key] ?? 0) + 1;
  }
});
