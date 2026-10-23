/**
 * The 5,000 proof (lot Q1, step Q1.4; plan §1.5; D14, ANSWERS B13 and r8: "Proof: 5,000 entrants, both checks (more
 * pieces than entrants: exactly X turns every Y, hold respected; fewer pieces: at most X per batch, in order, nobody
 * eligible left waiting while a piece of their size was free)"; eligible: "past the hold and placed by the batch's
 * time"), against a migrated database (PGlite) and a manual clock.
 *
 * Two LIVE RELEASES of 5,000 entrants in 7 sizes (715, 715, 714, 714, 714, 714, 714), X = 250, Y = 1 minute, a hold of
 * 10 minutes, driven second by second as production drives one: each second a queue frame is built and published (the
 * room, its board and the queue's snapshot, live-room.ts LiveRoomService.frame, as the live streams publish it) and the
 * engine passes (LiveService.advance), so the rule of one batch per frame runs (live-frames.ts); a batch's time is read
 * as its logical time (`admitted_at`, `drop.live.batch`'s `at`):
 *
 *  (a) more pieces than entrants in every size (each size's stock its entrants + 143, 6,001 in all), nobody acting on
 *      their turn (each runs out after 30 s): no turn before T0 + 10, then exactly 20 batches of exactly 250 turns at
 *      T0 + 10 + k minutes (k = 0 … 19), in the line's order, every entrant served once; the TEST REPORT's PACE check
 *      green with "exactly X every Y" read in its line;
 *  (b) 300 pieces, the entrants securing, paying, giving back or missing their turns on a seeded draw: no turn before
 *      T0 + 10, at most 250 a batch, in the line's order in each size, and after every batch that gave fewer than 250
 *      nobody eligible waiting in a size with a piece free (N5), asserted on the database right after each batch; the
 *      PACE check green.
 *
 * Also D8 (ANSWERS note 22:13: "the proof includes a stale-frame + fresh-entry test"): a frame read before a batch,
 * paired with the entry's own state read after it, gives the entry's fresh place and time from the queue as it is
 * after the batch, never a figure computed from the frame (the room carries none). The same race through the app is
 * test/api/live.test.ts « the stale-frame race gone ».
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { LIVE_GESTURE_MIN_MS, liveTurnToken, LiveService } from '../../src/server/services/live.js';
import { LiveFrameGate } from '../../src/server/services/live-frames.js';
import { liveQueueSnapshot, queueView } from '../../src/server/services/live-queue.js';
import { LiveRoomService } from '../../src/server/services/live-room.js';
import { livePaceFacts, paceCheck } from '../../src/server/services/test-entrants.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createLiveRelease, liveFixture, type LiveFixture, type LiveRelease } from '../support/live.js';

const T0 = new Date('2026-11-05T10:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60_000;
const at = (ms: number) => new Date(T0.getTime() + ms);
const X = 250;
const HOLD_MINUTES = 10;
/** The 5,000 entrants over 7 sizes. */
const ENTRANTS = [715, 715, 714, 714, 714, 714, 714] as const;
const LABELS = ['48', '50', '52', '54', '56', '58', '60'] as const;

/** A seeded draw (mulberry32): the same entrants act the same way every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ONE QUEUE: the 5,000 proof (D14, both checks)', () => {
  let t: TestDb;
  let f: LiveFixture;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-04T09:00:00.000Z');
  }, 120_000);
  afterAll(() => t?.close());

  /** The engine of one process: its frames published only by `second`, as the live streams publish them once a second. */
  const engine = () => {
    const frames = new LiveFrameGate();
    frames.usePublisher(() => {});
    const live = new LiveService({ db: t.db, audit: f.audit, seedKey: f.seedKey, turnKey: f.turnKey, clock: f.clock.now, frames });
    const room = new LiveRoomService({ db: t.db, turnKey: f.turnKey, publicOrigin: testConfig().publicOrigin, clock: f.clock.now });
    /** A queue frame built and published (live-stream.ts publishNow): the room, its board and the queue's snapshot. */
    const frame = async (r: LiveRelease) => {
      const mark = frames.begin(r.id);
      const built = await room.frame(r.id);
      frames.published(r.id, mark);
      return built;
    };
    return { live, frame };
  };

  /** A LIVE RELEASE of 5,000 entrants in 7 sizes, X = 250 every minute, a hold of 10 minutes; `stock(i)`: size i's pieces. */
  async function release(stock: (i: number) => number): Promise<{ r: LiveRelease; accounts: string[] }> {
    f.clock.set('2026-11-04T09:00:00.000Z');
    const r = await createLiveRelease(f, {
      opensAt: T0,
      closesAt: at(60 * MINUTE),
      pace: { batch: X, minutes: 1 },
      holdMinutes: HOLD_MINUTES,
      turnSeconds: 30,
      payMinutes: 5,
      sizes: LABELS.map((label, i) => ({ label, stock: stock(i) })),
    });
    const accounts: string[] = [];
    const sizeOf: string[] = [];
    ENTRANTS.forEach((n, i) => {
      for (let k = 0; k < n; k++) sizeOf.push(r.sizes[i]!.id);
    });
    for (let i = 0; i < sizeOf.length; i += 500) {
      const values = sizeOf.slice(i, i + 500).map(() => {
        const email = `proof-${randomUUID()}@example.com`;
        return { email, email_normalized: email, password_hash: 'unused' };
      });
      accounts.push(...(await t.db.insertInto('accounts').values(values).returning('id').execute()).map((a) => a.id));
    }
    for (let i = 0; i < sizeOf.length; i += 500) {
      await t.db
        .insertInto('live_entries')
        .values(accounts.slice(i, i + 500).map((id, k) => ({ drop_id: r.id, account_id: id, size_id: sizeOf[i + k]!, quantity: 1, tier: 0, joined_at: at(-MINUTE), status: 'WAITING' as const })))
        .execute();
    }
    return { r, accounts };
  }

  /** The batches the audit log recorded: number, logical time from T0, turns. */
  const batchesOf = async (dropId: string) =>
    (await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', dropId).where('action', '=', 'drop.live.batch').orderBy('id').execute()).map((a) => {
      const d = a.details as { batch: number; at: string; turns: number; extra?: boolean };
      return { batch: d.batch, at: Date.parse(d.at) - T0.getTime(), turns: d.turns, extra: d.extra === true };
    });
  const row = (id: string) => t.db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const check = async (id: string, now: Date) => paceCheck(await livePaceFacts(t.db, await row(id), now));

  it(
    '(a) more pieces than entrants in every size: no turn before T0 + 10, then exactly 20 batches of exactly 250 turns at T0 + 10 + k min, in the line’s order, every entrant served; the PACE check green; a stale frame never gives a place (D8)',
    async () => {
      const { r } = await release((i) => ENTRANTS[i]! + 143);
      const { live, frame } = engine();
      let stale: { entryId: string; accountId: string; place: number; waitMs: number | null } | null = null;
      for (let s = 0; s <= 31 * 60; s++) {
        f.clock.set(at(s * SECOND));
        const built = await frame(r);
        // D8: one second before the first batch, an entry 300th in its size reads its place from this frame.
        if (s === HOLD_MINUTES * 60 - 1) {
          const e = await t.db.selectFrom('live_entries').select(['id', 'account_id']).where('drop_id', '=', r.id).where('size_id', '=', r.sizes[0]!.id).orderBy('position').offset(299).limit(1).executeTakeFirstOrThrow();
          const view = queueView(built!.queue!, e.id, f.clock.now().getTime())!;
          stale = { entryId: e.id, accountId: e.account_id, place: view.place, waitMs: view.waitMs };
          for (const key of ['line', 'held', 'queue', 'waiting', 'batch', 'nextBatchAt']) expect(built!.room).not.toHaveProperty(key);
        }
        const out = await live.advance(r.id);
        // None before the hold's end; one batch a minute from it, each of exactly X.
        if (s < HOLD_MINUTES * 60) expect(out?.batch ?? null).toBeNull();
        if (s === HOLD_MINUTES * 60) {
          // D8: its state read after the batch gives its own fresh place and time, from the queue as it is now.
          expect(out).toMatchObject({ batch: 1, turns: X });
          const fresh = queueView(await liveQueueSnapshot(t.db, await row(r.id), f.clock.now()), stale!.entryId, f.clock.now().getTime())!;
          const mine = (await live.entry(stale!.accountId, r.id))!.queue!;
          expect(mine).toEqual(fresh);
          expect(mine.place).toBeLessThan(stale!.place);
          expect(stale!.place).toBe(300);
        }
      }
      const batches = await batchesOf(r.id);
      expect(batches).toEqual(Array.from({ length: 20 }, (_, k) => ({ batch: k + 1, at: (HOLD_MINUTES + k) * MINUTE, turns: X, extra: false })));
      // On the entries: each batch's 250 places, in the line's order, at its logical time; no turn before T0 + 10.
      const rows = await sql<{ batch: number; n: number; first: number; last: number; at: Date; times: number; turn: Date }>`
        SELECT admitted_batch AS batch, count(*)::int AS n, min(position) AS first, max(position) AS last, min(admitted_at) AS at,
               count(DISTINCT admitted_at)::int AS times, min(turn_at) AS turn
          FROM live_entries WHERE drop_id = ${r.id} GROUP BY admitted_batch ORDER BY admitted_batch`.execute(t.db);
      expect(rows.rows.map((b) => ({ batch: Number(b.batch), n: Number(b.n), first: Number(b.first), last: Number(b.last), at: new Date(b.at).getTime() - T0.getTime(), times: Number(b.times) }))).toEqual(
        Array.from({ length: 20 }, (_, k) => ({ batch: k + 1, n: X, first: k * X + 1, last: (k + 1) * X, at: (HOLD_MINUTES + k) * MINUTE, times: 1 })),
      );
      expect(Math.min(...rows.rows.map((b) => new Date(b.turn).getTime()))).toBe(at(HOLD_MINUTES * MINUTE).getTime());
      // Every entrant served once: 5,000 turns, each missed after its 30 s (nobody acted), none still waiting.
      const left = await t.db.selectFrom('live_entries').select((eb) => ['status', eb.fn.countAll<number>().as('n')]).where('drop_id', '=', r.id).groupBy('status').execute();
      expect(left.map((x) => [x.status, Number(x.n)])).toEqual([['MISSED', 5000]]);
      expect(await check(r.id, at(31 * MINUTE))).toEqual({
        id: 'PACE',
        label: 'The pace',
        pass: true,
        line: '20 batches gave 5000 turns at 250 every 1 min, the first on the pace at 11:10:00 PARIS, each on its time and in the line’s order; none gave more than the pace, and none left anyone waiting while a piece of their size was free.',
      });
    },
    600_000,
  );

  it(
    '(b) 300 pieces, entrants securing, paying, giving back and missing on a seeded draw: no turn before T0 + 10, at most 250 a batch, in the line’s order, nobody eligible waiting while a piece of their size was free; the PACE check green',
    async () => {
      const { r } = await release((i) => (i < 6 ? 43 : 42));
      const { live, frame } = engine();
      const random = seeded(20261023);
      /** What each entrant given a turn does: its PRESS, SECURE and last act's moments (ms), and that act. */
      const plans = new Map<string, { press: number; secure: number; last: number; act: 'PAY' | 'RELEASE' | 'MISS' | 'LAPSE'; done: Set<string> }>();
      const sizeIds = new Set(r.sizes.map((s) => s.id));
      const faults: string[] = [];
      let ended = false;
      for (let s = 0; s <= 60 * 60 && !ended; s++) {
        const now = at(s * SECOND).getTime();
        f.clock.set(now);
        await frame(r);
        // The phones act first, then the engine passes (a piece given back at this second is free for its batch).
        const turns = await t.db.selectFrom('live_entries').select(['id', 'account_id', 'status', 'turn_at']).where('drop_id', '=', r.id).where('status', 'in', ['TURN', 'SECURED']).execute();
        for (const e of turns) {
          const given = e.turn_at!.getTime();
          let p = plans.get(e.id);
          if (!p) {
            const roll = random();
            const act = roll < 0.3 ? 'MISS' : roll < 0.7 ? 'PAY' : roll < 0.9 ? 'RELEASE' : 'LAPSE';
            const press = given + Math.ceil(2 + random() * 18) * SECOND;
            p = { press, secure: press + 2 * SECOND, last: press + 2 * SECOND + Math.ceil(5 + random() * 85) * SECOND, act, done: new Set() };
            plans.set(e.id, p);
          }
          if (p.act === 'MISS') continue;
          const actor = { type: 'account' as const, id: e.account_id };
          const token = liveTurnToken(f.turnKey, e.id, e.turn_at!);
          if (e.status === 'TURN' && now >= p.press && !p.done.has('press')) {
            await live.press(e.account_id, r.id, token);
            p.done.add('press');
          } else if (e.status === 'TURN' && now >= p.secure && now - p.press >= LIVE_GESTURE_MIN_MS && p.done.has('press')) {
            await live.secure(e.account_id, r.id, token, actor);
          } else if (e.status === 'SECURED' && now >= p.last && !p.done.has('last')) {
            p.done.add('last');
            if (p.act === 'PAY') await live.confirm(e.account_id, r.id, actor);
            else if (p.act === 'RELEASE') await live.release(e.account_id, r.id, actor);
          }
        }
        const out = await live.advance(r.id);
        if (s < HOLD_MINUTES * 60) expect(out?.batch ?? null).toBeNull();
        ended = (await row(r.id)).ended_at !== null;
        if (out?.batch == null) continue;
        // Right after each batch, on the database: at most X, in the line's order in each size, and (fewer than X)
        // nobody placed by its time waiting in a size with a piece free (N5).
        if (out.turns > X) faults.push(`batch ${out.batch}: ${out.turns} turns`);
        const slot = (await t.db.selectFrom('live_entries').select('admitted_at').where('drop_id', '=', r.id).where('admitted_batch', '=', out.batch).executeTakeFirst())?.admitted_at ?? null;
        const entries = await t.db.selectFrom('live_entries').select(['size_id', 'status', 'position', 'queued_at', 'admitted_batch']).where('drop_id', '=', r.id).execute();
        const stock = new Map((await t.db.selectFrom('drop_sizes').select(['id', 'stock']).where('drop_id', '=', r.id).execute()).map((x) => [x.id, x.stock]));
        for (const size of sizeIds) {
          const own = entries.filter((e) => e.size_id === size);
          const free = stock.get(size)! - own.filter((e) => e.status === 'TURN' || e.status === 'SECURED' || e.status === 'CONFIRMED').length;
          const waiting = own.filter((e) => e.status === 'QUEUED' && (slot === null || e.queued_at!.getTime() <= slot.getTime()));
          const given = own.filter((e) => e.admitted_batch === out.batch);
          const first = Math.min(...waiting.map((e) => e.position!));
          if (given.some((e) => e.position! > first)) faults.push(`batch ${out.batch}: a turn behind place ${first} in its size`);
          if (out.turns < X && free > 0 && waiting.length > 0) faults.push(`batch ${out.batch}: ${out.turns} turns, place ${first} waiting with ${free} free`);
        }
      }
      expect(faults).toEqual([]);
      expect(ended).toBe(true);
      const batches = await batchesOf(r.id);
      // The first at the hold's end, of X (300 pieces free); every one of at most X, on the minute, none extra.
      expect(batches[0]).toEqual({ batch: 1, at: HOLD_MINUTES * MINUTE, turns: X, extra: false });
      expect(batches.every((b) => b.turns <= X && b.at % MINUTE === 0 && !b.extra)).toBe(true);
      expect(batches.length).toBeGreaterThan(3);
      // Batches short of X, nobody eligible waiting with a piece free after them: the check's N5 reading at work.
      expect(batches.some((b) => b.turns < X)).toBe(true);
      const sold = await t.db.selectFrom('live_entries').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', r.id).where('status', '=', 'CONFIRMED').executeTakeFirstOrThrow();
      expect(Number(sold.n)).toBe(300);
      const facts = await livePaceFacts(t.db, await row(r.id), f.clock.now());
      // Some turns were missed, given back or ran out: pieces came back and went to the next batches.
      expect(facts.entries.filter((e) => e.turnAt !== null).length).toBeGreaterThan(300);
      const verdict = paceCheck(facts);
      expect(verdict).toMatchObject({ id: 'PACE', pass: true });
      expect(verdict.line).toMatch(new RegExp(`^${batches.length} batches gave \\d+ turns at 250 every 1 min, the first on the pace at 11:10:00 PARIS, each on its time and in the line’s order; none gave more than the pace, and none left anyone waiting while a piece of their size was free\\.$`));
    },
    600_000,
  );
});
