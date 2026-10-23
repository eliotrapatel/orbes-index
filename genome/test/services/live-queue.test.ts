/**
 * ONE QUEUE's snapshot (lot Q1, step Q1.3; plan §1.3, §2; services/live-queue.ts): what each phone reads of its own
 * place, pure first (the place in its size, the estimate, `next` by the per-entry rule, `out`, `beyond`, `pollMs`), then
 * on the engine with a manual clock and a snapshot taken at each published frame: no batch, scheduled or NEXT BATCH
 * NOW, ever gives a turn to an entry that was not `next` in the frame before it (D9, ANSWERS r4: "Whoever a batch can
 * reach next sees every change each second (a turn lasts 30 s, so they must)").
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveService } from '../../src/server/services/live.js';
import { LiveFrameGate } from '../../src/server/services/live-frames.js';
import { liveQueueSnapshot, queuePlaces, queuePollMs, queueView, type QueueEntryInput, type QueueInput, type QueueSizeInput } from '../../src/server/services/live-queue.js';
import { livePaceFacts, paceCheck } from '../../src/server/services/test-entrants.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createLiveRelease, liveFixture, type LiveFixture, type LiveRelease } from '../support/live.js';

const T0 = new Date('2026-11-05T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60_000;

const size = (id: string, o: Partial<QueueSizeInput> = {}): QueueSizeInput => ({ id, stock: 10, turn: 0, secured: 0, confirmed: 0, returns: [], ...o });
const entries = (n: number, sizeId: string, from = 1, quantity = 1): QueueEntryInput[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${sizeId}${from + i}`, sizeIds: [sizeId], quantity }));
const places = (i: Partial<QueueInput> & Pick<QueueInput, 'sizes' | 'entries'>, pace: Partial<NonNullable<QueueInput['pace']>> | null = {}) =>
  queuePlaces({
    now: i.now ?? T0.getTime(),
    pace: pace === null ? null : { batch: 1, minutes: 1, nextAt: T0.getTime(), paused: null, pausedSince: null, ...pace },
    sizes: i.sizes,
    entries: i.entries,
  });
const nextOf = (m: Map<string, { next: boolean }>) => [...m].filter(([, p]) => p.next).map(([id]) => id);

describe('the queue’s snapshot (pure)', () => {
  it('gives each entry its place in its size (D19), a set’s entry the most in any of its sizes + 1', () => {
    const m = places({ sizes: [size('A'), size('B')], entries: [...entries(2, 'A'), ...entries(1, 'B'), ...entries(1, 'A', 3)] });
    expect([...m].map(([id, p]) => [id, p.place])).toEqual([['A1', 1], ['A2', 2], ['B1', 1], ['A3', 3]]);
    const set = places({
      sizes: [size('A'), size('B')],
      entries: [{ id: 'x', sizeIds: ['A'], quantity: 1 }, { id: 'y', sizeIds: ['B'], quantity: 1 }, { id: 'z', sizeIds: ['B'], quantity: 1 }, { id: 's', sizeIds: ['A', 'B'], quantity: 1 }],
    });
    expect(set.get('s')!.place).toBe(3);
  });

  it('estimates the wait by the batches simulated (D20): X turns every Y where a piece is free, the hold counted (D16), never a figure of the pace', () => {
    // X = 2 every 3 minutes, the first batch at T0 + 10 (the hold), read at T0 + 4.
    const m = places({ now: at(4 * MINUTE).getTime(), sizes: [size('A', { stock: 100 })], entries: entries(5, 'A') }, { batch: 2, minutes: 3, nextAt: at(10 * MINUTE).getTime() });
    expect([...m.values()].map((p) => p.waitMs)).toEqual([6, 6, 9, 9, 12].map((x) => x * MINUTE));
    expect(m.get('A1')!.estimatedAt).toBe(at(10 * MINUTE).getTime());
    // An overdue batch (waiting for its frame): the next one now.
    expect(places({ now: at(MINUTE).getTime(), sizes: [size('A')], entries: entries(1, 'A') }).get('A1')!.waitMs).toBe(0);
  });

  it('makes an entry its size cannot serve now wait for a held piece’s deadline, then the first batch after it ("it moves later while pieces are held", r2); passes over one wanting more than its size can give', () => {
    // A: 2 pieces, both in a turn until T0 + 90 s and T0 + 150 s; one free piece in B. X = 5 every minute.
    const sizes = [size('A', { stock: 2, turn: 2, returns: [at(150 * SECOND).getTime(), at(90 * SECOND).getTime()] }), size('B', { stock: 1 })];
    const m = places({ sizes, entries: [...entries(2, 'A'), { id: 'big', sizeIds: ['B'], quantity: 2 }, ...entries(1, 'B')] }, { batch: 5, minutes: 1 });
    expect(m.get('A1')!.waitMs).toBe(2 * MINUTE);
    expect(m.get('A2')!.waitMs).toBe(3 * MINUTE);
    expect(m.get('B1')!.waitMs).toBe(0);
    expect(m.get('big')).toMatchObject({ out: true, next: false });
  });

  it('always gives a time, past the pieces and past the close (r3): those beyond every piece by their order among those left, X a batch; `beyond` past the pieces not confirmed', () => {
    const m = places({ sizes: [size('A', { stock: 3, confirmed: 1 })], entries: entries(6, 'A') }, { batch: 2, minutes: 10 });
    expect([...m.values()].map((p) => p.waitMs)).toEqual([0, 0, 10, 10, 20, 20].map((x) => x * MINUTE));
    expect([...m.values()].map((p) => p.beyond)).toEqual([false, false, true, true, true, true]);
    expect([...m.values()].every((p) => !p.out)).toBe(true);
  });

  it('freezes the time at the pause’s start while PAUSE or PAUSE PACE holds the batches (D17)', () => {
    const run = (now: number) =>
      places({ now, sizes: [size('A', { stock: 100 })], entries: entries(3, 'A') }, { batch: 1, minutes: 5, nextAt: at(5 * MINUTE).getTime(), paused: 'RELEASE', pausedSince: at(2 * MINUTE).getTime() });
    expect([...run(at(3 * MINUTE).getTime()).values()].map((p) => p.waitMs)).toEqual([3, 8, 13].map((x) => x * MINUTE));
    expect([...run(at(40 * MINUTE).getTime()).values()].map((p) => p.waitMs)).toEqual([3, 8, 13].map((x) => x * MINUTE));
    // A reading's view keeps the frozen time; running, it counts down from the snapshot's estimate to the reading.
    const snap = { dropId: 'd', at: at(3 * MINUTE).getTime(), paused: 'RELEASE' as const, entries: run(at(3 * MINUTE).getTime()) };
    expect(queueView(snap, 'A2', at(9 * MINUTE).getTime())).toEqual({ place: 2, waitMs: 8 * MINUTE, paused: 'RELEASE', next: true, out: false });
    const running = { dropId: 'd', at: T0.getTime(), paused: null, entries: places({ sizes: [size('A', { stock: 100 })], entries: entries(3, 'A') }, { batch: 1, minutes: 5 }) };
    expect(queueView(running, 'A3', at(MINUTE + 400).getTime())).toMatchObject({ place: 3, waitMs: 9 * MINUTE, paused: null });
    expect(queueView(running, 'nobody', T0.getTime())).toBeNull();
  });

  it('says next by the per-entry rule (D9): (1) within its size’s free + held pieces, (2) fewer than 2·X sure turns ahead', () => {
    // X = 2: four in a size with free pieces; the fifth has four sure turns ahead.
    expect(nextOf(places({ sizes: [size('A', { stock: 100 })], entries: entries(6, 'A') }, { batch: 2 }))).toEqual(['A1', 'A2', 'A3', 'A4']);
    // (1): a size of 3 pieces (1 free, 2 held) reaches its first three only, whatever X.
    expect(nextOf(places({ sizes: [size('A', { stock: 3, turn: 1, secured: 1, returns: [at(MINUTE).getTime(), at(MINUTE).getTime()] })], entries: entries(5, 'A') }, { batch: 50 }))).toEqual(['A1', 'A2', 'A3']);
    // Two pieces wanted ahead count as two (one-piece entries: place in S ≤ free + held).
    expect(nextOf(places({ sizes: [size('A', { stock: 3 })], entries: [{ id: 'two', sizeIds: ['A'], quantity: 2 }, ...entries(2, 'A')] }, { batch: 50 }))).toEqual(['two', 'A1']);
  });

  it('counts in (2) every entry ahead in its own size but those a batch passes over (X = 1, 3 pieces left, A wanting 5 and B wanting 1 ahead of e: e is next), and a set’s entry its size can no longer serve likewise', () => {
    const m = places({ sizes: [size('S', { stock: 3 })], entries: [{ id: 'A', sizeIds: ['S'], quantity: 5 }, { id: 'B', sizeIds: ['S'], quantity: 1 }, { id: 'e', sizeIds: ['S'], quantity: 1 }] }, { batch: 1 });
    expect([m.get('A')!.out, m.get('A')!.next, m.get('B')!.next, m.get('e')!.next]).toEqual([true, false, true, true]);
    // A set's entry ahead (S and T) that T can no longer serve: passed over, not counted.
    const set = places(
      {
        sizes: [size('S', { stock: 3 }), size('T', { stock: 1, confirmed: 1 })],
        entries: [{ id: 'F', sizeIds: ['S', 'T'], quantity: 1 }, { id: 'B', sizeIds: ['S'], quantity: 1 }, { id: 'e', sizeIds: ['S'], quantity: 1 }],
      },
      { batch: 1 },
    );
    expect([set.get('F')!.out, set.get('e')!.next]).toEqual([true, true]);
  });

  it('counts other sizes only through the pieces free now there (held pieces never outside its size): the counterexample of a full size with held pieces ahead (X = 250)', () => {
    // A: 0 free, 100 held (not returning); 1,000 of its entries ahead in the order of the turns; B: 600 free, 600 entries.
    const held = Array.from({ length: 100 }, () => at(10 * MINUTE).getTime());
    const m = places({ sizes: [size('A', { stock: 100, turn: 100, returns: held }), size('B', { stock: 600 })], entries: [...entries(1000, 'A'), ...entries(600, 'B')] }, { batch: 250 });
    const next = nextOf(m);
    // B entries 1–500: the scheduled batch and one extra can reach them, A's holding no free piece (B's 500th has 499 sure turns ahead).
    expect(next.filter((id) => id.startsWith('B'))).toEqual(Array.from({ length: 500 }, (_, i) => `B${i + 1}`));
    // A entries 1–100: within A's free + held.
    expect(next.filter((id) => id.startsWith('A'))).toEqual(Array.from({ length: 100 }, (_, i) => `A${i + 1}`));
  });

  it('applies the rule to a set’s entry in each of its sizes, and counts a set’s entry ahead elsewhere only when the free pieces surely serve it', () => {
    const m = places(
      {
        sizes: [size('S', { stock: 5 }), size('T', { stock: 5 }), size('U', { stock: 1, turn: 1, returns: [at(MINUTE).getTime()] }), size('V', { stock: 5 })],
        entries: [
          // Sure: every one of its sizes has free pieces for it.
          { id: 'g1', sizeIds: ['T', 'V'], quantity: 1 },
          // Not sure (U's one piece is held): it holds T back (setTurns), so g3 is not sure either.
          { id: 'g2', sizeIds: ['U', 'T'], quantity: 1 },
          { id: 'g3', sizeIds: ['T'], quantity: 1 },
          { id: 'e', sizeIds: ['S', 'V'], quantity: 1 },
        ],
      },
      { batch: 1 },
    );
    // e: in S nothing ahead, in V g1 (sure, counted once), g2 and g3 elsewhere and not sure: 1 < 2. g2 is next too (U's
    // held piece may come back for the extra batch); g3 has g1 and g2 ahead in T: 2, not fewer than 2·X.
    expect([m.get('g2')!.out, m.get('g2')!.next, m.get('g3')!.next, m.get('e')!.next]).toEqual([false, true, false, true]);
    const fuller = places(
      { sizes: [size('S', { stock: 5 }), size('T', { stock: 5 })], entries: [{ id: 'g1', sizeIds: ['T'], quantity: 1 }, { id: 'g2', sizeIds: ['T'], quantity: 1 }, { id: 'e', sizeIds: ['S', 'T'], quantity: 1 }] },
      { batch: 1 },
    );
    expect(fuller.get('e')!.next).toBe(false);
  });

  it('keeps the same rule during the hold (the first batch and one extra) and when paused', () => {
    const run = (pace: Partial<NonNullable<QueueInput['pace']>>) => nextOf(places({ sizes: [size('A', { stock: 100 })], entries: entries(5, 'A') }, { batch: 2, ...pace }));
    expect(run({ nextAt: at(10 * MINUTE).getTime() })).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(run({ paused: 'PACE', pausedSince: T0.getTime() })).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('streams every QUEUED entry of an after-room (D29: no pace, no time, no pollMs), its place in its size', () => {
    const m = places({ sizes: [size('A', { stock: 1, confirmed: 1 })], entries: entries(3, 'A') }, null);
    expect([...m.values()]).toEqual([1, 2, 3].map((place) => ({ place, waitMs: null, estimatedAt: null, next: true, out: true, beyond: true, pollMs: null })));
  });

  it('tells those behind how soon to read again: half the time until they could be next, 10 s to a minute, 30 s while paused, in whole seconds; never those next', () => {
    expect(queuePollMs(0, 1, false)).toBe(10_000);
    expect(queuePollMs(MINUTE + 45_400, 1, false)).toBe(23_000);
    expect(queuePollMs(60 * MINUTE, 1, false)).toBe(60_000);
    expect(queuePollMs(60 * MINUTE, 1, true)).toBe(30_000);
    const m = places({ sizes: [size('A', { stock: 100 })], entries: entries(40, 'A') }, { batch: 2, minutes: 2 });
    expect(m.get('A1')!.pollMs).toBeNull();
    // The 40th: its batch the 20th (38 minutes away); it could be next a batch before: (38 − 2) / 2 → 60 s at most.
    expect(m.get('A40')!.pollMs).toBe(60_000);
    // The 5th (2·X ahead, not next): its batch the 3rd, 4 minutes away: (4 − 2) / 2 = 1 minute.
    expect(m.get('A5')).toMatchObject({ next: false, pollMs: 60_000 });
    // X = 1 every minute: the 3rd, 2 minutes away, (2 − 1) / 2 = 30 s; the 4th, 3 minutes away, 60 s.
    const near = places({ sizes: [size('A', { stock: 100 })], entries: entries(6, 'A') }, { batch: 1, minutes: 1 });
    expect([near.get('A3'), near.get('A4')]).toMatchObject([{ next: false, pollMs: 30_000 }, { next: false, pollMs: 60_000 }]);
  });
});

describe('the queue’s snapshot on the engine: no batch gives a turn to an entry that was not next in the frame before it (D9)', () => {
  let t: TestDb;
  let f: LiveFixture;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-04T09:00:00.000Z');
  });
  afterAll(() => t.close());

  const release = (o: Partial<Parameters<typeof createLiveRelease>[1]> = {}) => {
    f.clock.set('2026-11-04T09:00:00.000Z');
    return createLiveRelease(f, { opensAt: T0, turnSeconds: 300, sizes: [{ label: 'A', stock: 100 }], ...o });
  };
  const row = (id: string) => t.db.selectFrom('drops').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  /** QUEUED entries placed in this order at T0 (positions 1…), each in its size with its quantity, written directly. */
  async function line(r: LiveRelease, specs: { size: string; quantity?: number; n?: number }[]): Promise<string[]> {
    const rows = specs.flatMap((s) => Array.from({ length: s.n ?? 1 }, () => ({ sizeId: r.sizes.find((z) => z.label === s.size)!.id, quantity: s.quantity ?? 1 })));
    const accounts: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const values = rows.slice(i, i + 500).map(() => {
        const email = `queue-${randomUUID()}@example.com`;
        return { email, email_normalized: email, password_hash: 'unused' };
      });
      accounts.push(...(await t.db.insertInto('accounts').values(values).returning('id').execute()).map((a) => a.id));
    }
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const values = rows.slice(i, i + 500).map((x, j) => ({
        drop_id: r.id,
        account_id: accounts[i + j]!,
        size_id: x.sizeId,
        quantity: x.quantity,
        tier: 0,
        joined_at: at(-MINUTE),
        status: 'QUEUED' as const,
        position: i + j + 1,
        queued_at: T0,
      }));
      ids.push(...(await t.db.insertInto('live_entries').values(values).returning('id').execute()).map((e) => e.id));
    }
    return ids;
  }

  /**
   * One engine's process whose frames are published only when the test says (`frame`), each with the queue's snapshot
   * read between its `begin` and its publication, as the hub does; `batch` runs a batch (scheduled or NEXT BATCH NOW)
   * and checks that every turn it gave went to an entry `next` in the last frame published before it.
   */
  function engine(r: LiveRelease) {
    const frames = new LiveFrameGate();
    frames.usePublisher(() => {});
    const live = new LiveService({ db: t.db, audit: f.audit, seedKey: f.seedKey, turnKey: f.turnKey, clock: f.clock.now, frames });
    let next = new Set<string>();
    const given: string[][] = [];
    const frame = async () => {
      const mark = frames.begin(r.id);
      const snap = await liveQueueSnapshot(t.db, await row(r.id), f.clock.now());
      next = new Set([...snap.entries].filter(([, p]) => p.next).map(([id]) => id));
      frames.published(r.id, mark);
      return snap;
    };
    /** The turns of batch number `n` went to entries next in the frame `seen` (the last one before it). */
    const turnsOf = async (n: number) =>
      (await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('admitted_batch', '=', n).where('let_in_by', 'is', null).execute()).map((e) => e.id);
    const batch = async (run: () => Promise<unknown>) => {
      const seen = next;
      const before = Number((await row(r.id)).pace_batches);
      await run();
      const after = Number((await row(r.id)).pace_batches);
      expect(after).toBe(before + 1);
      const turns = await turnsOf(after);
      given.push(turns);
      expect(turns.filter((id) => !seen.has(id)), `batch ${after}: turns given to entries not next in the frame before it`).toEqual([]);
      return turns;
    };
    /**
     * A NEXT BATCH NOW pressed now: with the gate shut (a batch or a change since the last frame), a frame first (the
     * press would wait for it: live-pace.test.ts), then the press, given at once.
     */
    const press = async () => {
      if (!frames.open(r.id)) await frame();
      return batch(() => live.nextBatch(r.id, f.admin));
    };
    const advance = async (when: Date) => {
      f.clock.set(when);
      return live.advance(r.id);
    };
    return { live, frames, frame, batch, press, advance, given, next: () => next };
  }
  const check = async (r: LiveRelease, now: Date) => paceCheck(await livePaceFacts(t.db, await row(r.id), now));

  it('NEXT BATCH NOW right after a scheduled batch, and two presses within one second: each batch waits for a fresh frame and reaches only entries next in it', async () => {
    const r = await release({ pace: { batch: 2, minutes: 1 } });
    await line(r, [{ size: 'A', n: 16 }]);
    const e = engine(r);
    f.clock.set(T0);
    await e.frame();
    await e.batch(() => e.advance(T0));
    f.clock.set(at(MINUTE));
    await e.frame();
    await e.batch(() => e.advance(at(MINUTE)));
    // Right after the scheduled batch: the press waits for the frame recomputed after it.
    f.clock.set(at(MINUTE + 200));
    await e.press();
    // Two presses within one second, then a press right after a scheduled batch followed by a second press.
    f.clock.set(at(MINUTE + 600));
    await e.press();
    f.clock.set(at(MINUTE + 900));
    await e.press();
    f.clock.set(at(2 * MINUTE));
    await e.frame();
    await e.batch(() => e.advance(at(2 * MINUTE)));
    f.clock.set(at(2 * MINUTE + 100));
    await e.press();
    f.clock.set(at(2 * MINUTE + 400));
    await e.press();
    expect(e.given.map((x) => x.length)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect((await check(r, at(2 * MINUTE + 400))).pass).toBe(true);
  });

  it('a returned, freed, missed and expired piece, and ADD PIECES, in a size that was full: the next batch reaches only those next in the frame before it', async () => {
    const r = await release({ pace: { batch: 1, minutes: 1 }, sizes: [{ label: 'A', stock: 2 }], turnSeconds: 60, payMinutes: 1 });
    const ids = await line(r, [{ size: 'A', n: 10 }]);
    const e = engine(r);
    const of = async (n: number) => t.db.selectFrom('live_entries').select(['id', 'account_id', 'status']).where('id', '=', ids[n]!).executeTakeFirstOrThrow();
    /** The seal pressed and held 1.5 s by the entry at place `n` (its turn running): SECURED. */
    const secure = async (n: number) => {
      const x = await of(n);
      const token = (await e.live.entry(x.account_id, r.id))!.turn!.token!;
      await e.live.press(x.account_id, r.id, token);
      f.clock.set(f.clock.now().getTime() + 1500);
      await e.live.secure(x.account_id, r.id, token, { type: 'account', id: x.account_id });
      return x;
    };
    f.clock.set(T0);
    await e.frame();
    await e.batch(() => e.advance(T0));
    f.clock.set(at(5 * SECOND));
    await e.frame();
    await e.press();
    // Full: both pieces in a turn. A piece given back (RELEASE MY PLACE): the next batch reaches only those next.
    const first = await secure(0);
    await e.live.release(first.account_id, r.id, { type: 'account', id: first.account_id });
    f.clock.set(at(9 * SECOND));
    await e.frame();
    await e.press();
    // A hold freed by the console (FREE).
    const second = await secure(1);
    await e.live.freeHold(r.id, second.id, f.admin);
    await e.press();
    // ADD PIECES to the full size (the third secured, the fourth in its turn): a press at once waits for a frame read after it.
    f.clock.set(at(13 * SECOND));
    await secure(2);
    expect((await of(3)).status).toBe('TURN');
    f.clock.set(at(20 * SECOND));
    await e.live.addPieces(r.id, r.sizes[0]!.id, 3, f.admin);
    expect(e.frames.open(r.id)).toBe(false);
    await e.press();
    // The fourth's turn runs out (MISSED) in the pass of the scheduled batch of T0 + 1 min, overdue: the batch after a frame.
    f.clock.set(at(73 * SECOND));
    await e.frame();
    await e.batch(() => e.advance(at(73 * SECOND)));
    expect((await of(3)).status).toBe('MISSED');
    // The third's hold runs out (EXPIRED): the next batch after a frame.
    await e.advance(at(76 * SECOND));
    expect((await of(2)).status).toBe('EXPIRED');
    await e.frame();
    await e.press();
    expect(e.given.map((x) => x.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect((await check(r, at(76 * SECOND))).pass).toBe(true);
  });

  it('SET PACE faster, SHORTEN THE HOLD and END THE HOLD NOW: the next batch waits for a frame read after the change, and reaches only those next in it', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 }, holdMinutes: 20, sizes: [{ label: 'A', stock: 100 }] });
    await line(r, [{ size: 'A', n: 30 }]);
    const e = engine(r);
    f.clock.set(at(MINUTE));
    await e.frame();
    // SHORTEN THE HOLD to 3 minutes, then END THE HOLD NOW: the first batch due now.
    await e.live.shortenHold(r.id, 3, f.admin);
    f.clock.set(at(2 * MINUTE));
    await e.live.endHold(r.id, f.admin);
    // Due, but the frame before the change cannot let it go.
    expect(await e.advance(at(2 * MINUTE))).toMatchObject({ batch: null, waiting: true });
    await e.frame();
    await e.batch(() => e.advance(at(2 * MINUTE)));
    // SET PACE faster (1 → 6): the gate shut by the change, a press waits for the frame that shows the new reach.
    f.clock.set(at(2 * MINUTE + 10 * SECOND));
    await e.frame();
    expect(e.frames.open(r.id)).toBe(true);
    await e.live.setPace(r.id, { batch: 6, minutes: 5 }, f.admin);
    expect(e.frames.open(r.id)).toBe(false);
    const turns = await e.press();
    expect(turns).toHaveLength(6);
    f.clock.set(at(7 * MINUTE));
    await e.frame();
    expect(await e.batch(() => e.advance(at(7 * MINUTE)))).toHaveLength(6);
    expect((await check(r, at(7 * MINUTE))).pass).toBe(true);
  });

  it('the counterexample: X = 250, size A with 0 free and 100 held pieces that do not return, 1,000 of its entries ahead of size B’s free pieces: the scheduled batch and NEXT BATCH NOW give B’s entries 1–500 their turns, every one next', async () => {
    const r = await release({ pace: { batch: 100, minutes: 1 }, sizes: [{ label: 'A', stock: 100 }, { label: 'B', stock: 600 }], turnSeconds: 300, closesAt: at(120 * MINUTE) });
    const ids = await line(r, [{ size: 'A', n: 1100 }, { size: 'B', n: 600 }]);
    const e = engine(r);
    // The first batch (X = 100) gives A's 100 pieces: A has none free, all held (300 s turns: none returns here).
    f.clock.set(T0);
    await e.frame();
    expect(await e.batch(() => e.advance(T0))).toHaveLength(100);
    // SET PACE to 250; the frame read after it: B's entries 1–500 are next, A's next 1,000 not, A having no free piece.
    f.clock.set(at(10 * SECOND));
    await e.live.setPace(r.id, { batch: 250, minutes: 1 }, f.admin);
    await e.frame();
    const b = ids.slice(1100);
    expect(b.filter((id) => e.next().has(id))).toEqual(b.slice(0, 500));
    const before = e.next();
    const scheduled = await e.batch(() => e.advance(at(MINUTE)));
    f.clock.set(at(MINUTE + 200));
    const extra = await e.press();
    expect(new Set([...scheduled, ...extra])).toEqual(new Set(b.slice(0, 500)));
    expect([...scheduled, ...extra].every((id) => before.has(id))).toBe(true);
    expect((await check(r, at(MINUTE + 200))).pass).toBe(true);
  }, 120_000);

  it('a passed-over multi-piece entry ahead in S (X = 1, 3 pieces left, A wanting 5, B 1, e 1): the scheduled batch serves B, NEXT BATCH NOW then e, which was next', async () => {
    const r = await release({ pace: { batch: 1, minutes: 1 }, perAccount: 5, sizes: [{ label: 'S', stock: 3 }] });
    const [, bId, eId] = await line(r, [{ size: 'S', quantity: 5 }, { size: 'S' }, { size: 'S' }]);
    const e = engine(r);
    f.clock.set(at(-SECOND));
    const snap = await e.frame();
    expect([...snap.entries.values()].map((p) => [p.out, p.next])).toEqual([[true, false], [false, true], [false, true]]);
    expect(await e.batch(() => e.advance(T0))).toEqual([bId]);
    f.clock.set(at(200));
    expect(await e.press()).toEqual([eId]);
  });

  it('the restart catch-up: 5 slots overdue (X = 250) go one per published frame, each reaching only entries next in the frame before it, with its slot’s time and number; the PACE check green', async () => {
    const r = await release({ pace: { batch: 250, minutes: 1 }, sizes: [{ label: 'A', stock: 2000 }], closesAt: at(120 * MINUTE) });
    await line(r, [{ size: 'A', n: 1600 }]);
    const first = engine(r);
    f.clock.set(T0);
    await first.frame();
    await first.batch(() => first.advance(T0));
    // The engine down from T0 + 30 s to T0 + 5 min 10 s: a new process, its gate shut until its first frame.
    const after = engine(r);
    const when = at(5 * MINUTE + 10 * SECOND);
    expect(await after.advance(when)).toMatchObject({ batch: null, waiting: true });
    for (let k = 1; k <= 5; k++) {
      await after.frame();
      expect(await after.batch(() => after.advance(when))).toHaveLength(250);
    }
    const batches = await sql<{ batch: number; at: Date }>`
      SELECT admitted_batch AS batch, min(admitted_at) AS at FROM live_entries
       WHERE drop_id = ${r.id} AND admitted_batch IS NOT NULL GROUP BY admitted_batch ORDER BY admitted_batch`.execute(t.db);
    expect(batches.rows.map((x) => [Number(x.batch), new Date(x.at).getTime() - T0.getTime()])).toEqual([0, 1, 2, 3, 4, 5].map((k) => [k + 1, k * MINUTE]));
    expect((await check(r, when)).pass).toBe(true);
  }, 120_000);
});
