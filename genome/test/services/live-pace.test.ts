/**
 * The pace of a LIVE RELEASE (macro scope of 2026-10-20, W1-W6; lot M1, step M1.2; services/live.ts, migration 0049),
 * against a migrated database and a manual clock:
 *
 *  - the rules, pure: the next batch (T0 before the first), the estimated entry time, the shift of a pause that another
 *    one overlapped;
 *  - batches of exactly X every Y minutes on their logical times, in the line's order (the house's guarantee first),
 *    late arrivals behind, an empty batch moving the clock, overdue batches after a gap each at its own time;
 *  - only an admitted entry takes a turn; with no pace everyone is admitted as they take their place (the room as
 *    before);
 *  - the release's PAUSE and RESUME hold and move the pace, PAUSE PACE and RESUME PACE too, a stretch both held moved
 *    once; NEXT BATCH NOW; LET IN admits; SET PACE before and during the release (raising X, shortening Y, a release
 *    that had no pace), its refusals;
 *  - W6: an absent admitted entry's turn runs out (MISSED) and passes to the next person in its size, the entry keeping
 *    its place and its admission;
 *  - the queue an entry reads (its place, its estimated entry time, PAUSED), the console's pace state and entries, the
 *    audit log as counts, the right-of-access export;
 *  - 5 000 entries admitted in 20 batches of 250, every batch checked;
 *  - (M1.3) the console board's pace figures; the TEST REPORT's PACE check: it passes on the engine's own history
 *    (batches, an empty one, NEXT BATCH NOW, LET IN, the release's PAUSE, SET PACE raising X and shortening Y, a late
 *    arrival, 5 000 entries), and finds each fault planted (a batch not recorded or miscounted, too many, too few while
 *    others waited, out of the line's order, before its time or off the pace, a batch skipped while people waited).
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { GuaranteeService } from '../../src/server/services/guarantees.js';
import { accountLiveData, liveQueueEta, paceNextAt, paceShiftMs } from '../../src/server/services/live.js';
import { livePaceFacts, paceCheck, type PaceFacts } from '../../src/server/services/test-entrants.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, entriesOf, liveFixture, type LiveFixture, type LiveRelease } from '../support/live.js';

const T0 = new Date('2026-11-05T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60_000;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<void> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e, code).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
}

describe('the rules of the pace', () => {
  const d = { opens_at: T0, paused_at: null, pace_batch: 250, pace_minutes: 2, pace_paused_at: null, pace_next_at: null } as const;

  it('dues the first batch at T0, then at the stored next batch; none without a pace', () => {
    expect(paceNextAt(d)).toEqual(T0);
    expect(paceNextAt({ ...d, pace_next_at: at(4 * MINUTE) })).toEqual(at(4 * MINUTE));
    expect(paceNextAt({ ...d, pace_batch: null, pace_minutes: null })).toBeNull();
  });

  it('estimates the entry time as next + (ceil(place / X) − 1) × Y, never before now, none while held', () => {
    expect(liveQueueEta(d, 1, at(-MINUTE))).toEqual(T0);
    expect(liveQueueEta(d, 250, at(-MINUTE))).toEqual(T0);
    expect(liveQueueEta(d, 251, at(-MINUTE))).toEqual(at(2 * MINUTE));
    expect(liveQueueEta(d, 4999, at(-MINUTE))).toEqual(at(38 * MINUTE));
    // A batch due a moment ago, the engine about to run: from now.
    expect(liveQueueEta(d, 1, at(SECOND))).toEqual(at(SECOND));
    expect(liveQueueEta({ ...d, pace_paused_at: T0 }, 1, at(SECOND))).toBeNull();
    expect(liveQueueEta({ ...d, paused_at: T0 }, 1, at(SECOND))).toBeNull();
  });

  it('moves the next batch once for a stretch both pauses held', () => {
    // The pace paused at 1, the release at 2, the release resumed at 3 (nothing: the pace's own pause still holds it),
    // the pace resumed at 4 (the whole 1→4).
    expect(paceShiftMs(at(2 * MINUTE), at(MINUTE), at(3 * MINUTE))).toBe(0);
    expect(paceShiftMs(at(MINUTE), null, at(4 * MINUTE))).toBe(3 * MINUTE);
    // The release paused at 1, the pace at 2, the release resumed at 3 (1→2), the pace at 4 (2→4).
    expect(paceShiftMs(at(MINUTE), at(2 * MINUTE), at(3 * MINUTE))).toBe(MINUTE);
    expect(paceShiftMs(at(2 * MINUTE), null, at(4 * MINUTE))).toBe(2 * MINUTE);
  });
});

describe('LiveService with a pace', () => {
  let t: TestDb;
  let f: LiveFixture;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-04T09:00:00.000Z');
  });
  afterAll(() => t.close());

  const release = (o: Partial<Parameters<typeof createLiveRelease>[1]> = {}) => {
    f.clock.set('2026-11-04T09:00:00.000Z');
    return createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 100 }], ...o });
  };
  const advance = async (r: LiveRelease, when: Date) => {
    f.clock.set(when);
    return f.live.advance(r.id);
  };
  const audits = async (dropId: string, action: string) =>
    (await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('target_id', '=', dropId).where('action', '=', action).orderBy('id').execute()).map((a) => ({
      actor: a.actor_type,
      details: a.details as Record<string, unknown>,
    }));
  const pace = (id: string) => t.db.selectFrom('drops').select(['pace_batch', 'pace_minutes', 'pace_next_at', 'pace_paused_at', 'pace_batches']).where('id', '=', id).executeTakeFirstOrThrow();
  /** `n` accounts entered in the room before T0 (in the release's first size unless told). */
  async function room(r: LiveRelease, n: number, sizeIndex = 0) {
    f.clock.set(at(-MINUTE));
    const people = [];
    for (let i = 0; i < n; i++) {
      const a = await accountOfTier(f, 0);
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[sizeIndex]!.id }, a.actor);
      people.push(a);
    }
    return people;
  }
  /** The line: [position, status, admitted batch, admitted at] by place. */
  const line = async (r: LiveRelease) =>
    (await entriesOf(t.db, r.id)).map((e) => [e.position, e.status, e.admitted_batch, e.admitted_at ? e.admitted_at.getTime() - T0.getTime() : null]);

  it('admits exactly X every Y minutes on the batches’ logical times, in the line’s order; only the admitted take turns', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 } });
    await room(r, 7);
    expect(await advance(r, T0)).toMatchObject({ queued: 7, admitted: 2, turns: 2 });
    expect(await line(r)).toEqual([
      [1, 'TURN', 1, 0],
      [2, 'TURN', 1, 0],
      [3, 'QUEUED', null, null],
      [4, 'QUEUED', null, null],
      [5, 'QUEUED', null, null],
      [6, 'QUEUED', null, null],
      [7, 'QUEUED', null, null],
    ]);
    expect(await pace(r.id)).toMatchObject({ pace_batches: 1, pace_next_at: at(5 * MINUTE) });
    // Nothing before the next batch, even with pieces free.
    expect(await advance(r, at(5 * MINUTE - 1))).toMatchObject({ admitted: 0, turns: 0 });
    expect(await advance(r, at(5 * MINUTE))).toMatchObject({ admitted: 2, turns: 2 });
    // The engine away for 7 minutes: the batch due at T0+10 is stamped T0+10, not when it ran.
    expect(await advance(r, at(12 * MINUTE))).toMatchObject({ admitted: 2 });
    expect((await line(r)).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 2, 5 * MINUTE],
      [4, 2, 5 * MINUTE],
      [5, 3, 10 * MINUTE],
      [6, 3, 10 * MINUTE],
      [7, null, null],
    ]);
    expect(await pace(r.id)).toMatchObject({ pace_batches: 3, pace_next_at: at(15 * MINUTE) });
    // The audit log: each batch as counts, the system as actor, never an entry.
    expect(await audits(r.id, 'drop.live.admit')).toEqual([
      { actor: 'system', details: { batch: 1, at: T0.toISOString(), entries: 2 } },
      { actor: 'system', details: { batch: 2, at: at(5 * MINUTE).toISOString(), entries: 2 } },
      { actor: 'system', details: { batch: 3, at: at(10 * MINUTE).toISOString(), entries: 2 } },
    ]);
  });

  it('puts a late arrival behind, admitted by the first batch after it came; an empty batch moves the clock; overdue batches keep their own times', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 } });
    await room(r, 2);
    await advance(r, T0);
    // Nobody waits at T0+5 and T0+10: two empty batches, no audit entry.
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ admitted: 0 });
    expect(await pace(r.id)).toMatchObject({ pace_batches: 3, pace_next_at: at(15 * MINUTE) });
    // Arrivals at T0+12 and T0+17: the first waits for T0+15 (at most Y), the second for T0+20.
    const late = await accountOfTier(f, 0);
    f.clock.set(at(12 * MINUTE));
    const entered = await f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor);
    expect(entered).toMatchObject({ status: 'QUEUED', position: 3, queue: { place: 1, etaAt: at(15 * MINUTE), paused: false } });
    const later = await accountOfTier(f, 0);
    f.clock.set(at(17 * MINUTE));
    await f.live.enter(later.id, r.id, { sizeId: r.sizes[0]!.id }, later.actor);
    // The engine away from T0+11 to T0+21: the batch of T0+15 takes only the first (the second came after it), the
    // batch of T0+20 the second.
    await advance(r, at(21 * MINUTE));
    expect((await line(r)).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 4, 15 * MINUTE],
      [4, 5, 20 * MINUTE],
    ]);
    expect(await pace(r.id)).toMatchObject({ pace_batches: 5, pace_next_at: at(25 * MINUTE) });
    expect((await audits(r.id, 'drop.live.admit')).map((a) => a.details.batch)).toEqual([1, 4, 5]);
  });

  it('admits the house’s guarantee first, wherever its place', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 } });
    const people = await room(r, 3);
    const holder = await accountOfTier(f, 0);
    await new GuaranteeService({ db: t.db, audit: f.audit, clock: f.clock.now }).grant(holder.id, { scope: 'RELEASE', targetId: r.id, pieces: 1, validUntil: '2026-12-31', visible: true }, f.admin);
    // The holder arrives after T0: behind in the line, first admitted.
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    expect(await f.live.enter(holder.id, r.id, { sizeId: r.sizes[0]!.id }, holder.actor)).toMatchObject({ position: 4, queue: { place: 1 } });
    // The first of the line admitted at T0; the next one waiting reads place 2, behind the holder.
    const second = (await entriesOf(t.db, r.id)).find((e) => e.position === 2)!;
    expect(people.map((p) => p.id)).toContain(second.account_id);
    expect((await f.live.entry(second.account_id, r.id))!.queue).toMatchObject({ place: 2, etaAt: at(10 * MINUTE) });
    await advance(r, at(5 * MINUTE));
    const rows = await entriesOf(t.db, r.id);
    expect(rows.find((e) => e.account_id === holder.id)).toMatchObject({ admitted_batch: 2, status: 'TURN' });
  });

  it('with no pace, admits everyone as they take their place: the turns exactly as before', async () => {
    const r = await release({ sizes: [{ label: '52', stock: 2 }] });
    await room(r, 3);
    expect(await advance(r, T0)).toMatchObject({ queued: 3, admitted: 3, turns: 2 });
    expect(await line(r)).toEqual([
      [1, 'TURN', 0, 0],
      [2, 'TURN', 0, 0],
      [3, 'QUEUED', 0, 0],
    ]);
    const late = await accountOfTier(f, 0);
    f.clock.set(at(MINUTE));
    expect(await f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor)).toMatchObject({ status: 'QUEUED', queue: null, ahead: 1 });
    expect((await entriesOf(t.db, r.id)).at(-1)).toMatchObject({ admitted_batch: 0, admitted_at: at(MINUTE) });
    expect(await audits(r.id, 'drop.live.admit')).toEqual([]);
    expect(await pace(r.id)).toMatchObject({ pace_batch: null, pace_batches: 0, pace_next_at: null });
    expect((await f.live.pause(r.id, f.admin)).pace).toBeNull();
  });

  it('W6: an absent admitted entry’s turn runs out and passes to the next person in its size; the entry keeps its place and its admission', async () => {
    const r = await release({ pace: { batch: 3, minutes: 5 }, sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 5 }], turnSeconds: 30 });
    const [absent, next, other] = await room(r, 3);
    // Two in 52 (one piece), the third in 54.
    f.clock.set(at(-30 * SECOND));
    await f.live.changeSize(other!.id, r.id, { sizeId: r.sizes[1]!.id }, other!.actor);
    await advance(r, T0);
    const rows = await entriesOf(t.db, r.id);
    const first = rows.find((e) => e.size_id === r.sizes[0]!.id && e.status === 'TURN')!;
    const second = rows.find((e) => e.size_id === r.sizes[0]!.id && e.status === 'QUEUED')!;
    expect([first.admitted_batch, second.admitted_batch]).toEqual([1, 1]);
    expect([absent!.id, next!.id]).toContain(first.account_id);
    // Nobody presses: at the turns' deadline both are MISSED (52 and 54), and the next in 52 gets the turn at once.
    expect(await advance(r, at(30 * SECOND))).toMatchObject({ missed: 2, turns: 1 });
    const after = await entriesOf(t.db, r.id);
    expect(after.find((e) => e.id === first.id)).toMatchObject({ status: 'MISSED', position: first.position, admitted_batch: 1, admitted_at: T0, ended_at: at(30 * SECOND) });
    expect(after.find((e) => e.id === second.id)).toMatchObject({ status: 'TURN', position: second.position, admitted_batch: 1 });
  });

  it('the release’s PAUSE holds the pace and RESUME moves the next batch by the time paused', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 } });
    const people = await room(r, 4);
    await advance(r, T0);
    f.clock.set(at(2 * MINUTE));
    const paused = await f.live.pause(r.id, f.admin);
    expect(paused.pace).toMatchObject({ batch: 1, minutes: 5, nextAt: at(5 * MINUTE), paused: false, batches: 1, waiting: 3, admitted: 1 });
    // Paused: the queue reads PAUSED, no estimate; nothing is admitted at the batch's time.
    const waiting = (await entriesOf(t.db, r.id)).find((e) => e.position === 2)!;
    const view = (await f.live.entry(people.find((p) => p.id === waiting.account_id)!.id, r.id))!;
    expect(view.queue).toEqual({ place: 1, etaAt: null, paused: true });
    expect(await advance(r, at(7 * MINUTE))).toMatchObject({ admitted: 0 });
    f.clock.set(at(8 * MINUTE));
    expect((await f.live.resume(r.id, f.admin)).pace).toMatchObject({ nextAt: at(11 * MINUTE), batches: 1 });
    expect((await f.live.entry(waiting.account_id, r.id))!.queue).toEqual({ place: 1, etaAt: at(11 * MINUTE), paused: false });
    expect(await advance(r, at(11 * MINUTE - 1))).toMatchObject({ admitted: 0 });
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ admitted: 1 });
  });

  it('PAUSE PACE holds the batches, the turns of those admitted going on; RESUME PACE moves the next one; a stretch both pauses held is moved once', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 }, sizes: [{ label: '52', stock: 100 }] });
    await room(r, 4);
    await rejects(f.live.pausePace(r.id, f.admin), 'LIVE_NOT_STARTED', 409);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    expect((await f.live.pausePace(r.id, f.admin)).pace).toMatchObject({ paused: true, pausedAt: at(MINUTE), nextAt: at(5 * MINUTE) });
    await rejects(f.live.pausePace(r.id, f.admin), 'LIVE_PACE_ALREADY_PAUSED', 409);
    f.clock.set(at(2 * MINUTE));
    await f.live.pause(r.id, f.admin);
    f.clock.set(at(3 * MINUTE));
    // The release resumed while the pace's own pause still holds it: the next batch not moved yet.
    expect((await f.live.resume(r.id, f.admin)).pace).toMatchObject({ nextAt: at(5 * MINUTE), paused: true });
    expect(await advance(r, at(6 * MINUTE))).toMatchObject({ admitted: 0 });
    f.clock.set(at(7 * MINUTE));
    // Held from 1 to 7: the batch of T0+5 comes at T0+11.
    expect((await f.live.resumePace(r.id, f.admin)).pace).toMatchObject({ nextAt: at(11 * MINUTE), paused: false, pausedAt: null });
    await rejects(f.live.resumePace(r.id, f.admin), 'LIVE_PACE_NOT_PAUSED', 409);
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ admitted: 1 });
    expect((await audits(r.id, 'drop.live.pace.pause')).map((a) => a.details)).toEqual([{ batches: 1 }]);
    expect((await audits(r.id, 'drop.live.pace.resume')).map((a) => a.details)).toEqual([{ pausedMs: 6 * MINUTE, nextAt: at(11 * MINUTE).toISOString() }]);
    // After the end, the pace still held: RESUME PACE refused like PAUSE PACE, nothing written.
    f.clock.set(at(12 * MINUTE));
    await f.live.pausePace(r.id, f.admin);
    f.clock.set(at(61 * MINUTE));
    await rejects(f.live.resumePace(r.id, f.admin), 'LIVE_ENDED', 409);
    expect(await pace(r.id)).toMatchObject({ pace_paused_at: at(12 * MINUTE) });
    expect(await audits(r.id, 'drop.live.pace.resume')).toHaveLength(1);
  });

  it('SET PACE while the release is PAUSED, on a release with no pace: the first batch Y minutes after RESUME', async () => {
    const r = await release();
    await room(r, 2);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    await f.live.pause(r.id, f.admin);
    f.clock.set(at(11 * MINUTE));
    await f.live.setPace(r.id, { batch: 1, minutes: 2 }, f.admin);
    f.clock.set(at(12 * MINUTE));
    // Held from 1 to 12 with no pace for most of it: the first batch at T0+14, not T0+24.
    expect((await f.live.resume(r.id, f.admin)).pace).toMatchObject({ batch: 1, minutes: 2, nextAt: at(14 * MINUTE), paused: false });
    const late = await accountOfTier(f, 0);
    f.clock.set(at(13 * MINUTE));
    expect(await f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor)).toMatchObject({ queue: { place: 1, etaAt: at(14 * MINUTE) } });
    expect(await advance(r, at(14 * MINUTE - 1))).toMatchObject({ admitted: 0 });
    expect(await advance(r, at(14 * MINUTE))).toMatchObject({ admitted: 1 });
  });

  it('NEXT BATCH NOW admits one batch at once, the clock keeping its time; LET IN admits the entry it lets in', async () => {
    const r = await release({ pace: { batch: 2, minutes: 10 } });
    await room(r, 6);
    await rejects(f.live.nextBatch(r.id, f.admin), 'LIVE_NOT_STARTED', 409);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    expect((await f.live.nextBatch(r.id, f.admin)).pace).toMatchObject({ batches: 2, nextAt: at(10 * MINUTE), waiting: 2, admitted: 4 });
    expect((await line(r)).slice(0, 4).map((x) => [x[1], x[2], x[3]])).toEqual([
      ['TURN', 1, 0],
      ['TURN', 1, 0],
      ['TURN', 2, MINUTE],
      ['TURN', 2, MINUTE],
    ]);
    expect((await audits(r.id, 'drop.live.pace.next')).map((a) => a.details)).toEqual([{ batch: 2, entries: 2 }]);
    // LET IN the last of the line, still waiting for its batch: admitted now, its batch the batches so far.
    const last = (await entriesOf(t.db, r.id)).at(-1)!;
    f.clock.set(at(2 * MINUTE));
    expect(await f.live.letIn(r.id, last.id, f.admin)).toMatchObject({ status: 'TURN', letIn: true, admittedAt: at(2 * MINUTE), batch: 2 });
    expect((await audits(r.id, 'drop.live.let_in')).map((a) => a.details)).toEqual([{ entryId: last.id, position: 6, admitted: true }]);
    // The next batch takes the one left (place 5), the one let in not counted twice.
    expect(await advance(r, at(10 * MINUTE))).toMatchObject({ admitted: 1 });
    expect((await f.live.setPace(r.id, { batch: 2, minutes: 10 }, f.admin)).pace).toMatchObject({ waiting: 0, admitted: 6, batches: 3 });
  });

  it('SET PACE: before T0 the first batch stays at T0; during the release from the next batch on (raising X, then shortening Y); on a release with no pace, Y minutes from now', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 } });
    await room(r, 12);
    f.clock.set(at(-30 * SECOND));
    expect((await f.live.setPace(r.id, { batch: 2, minutes: 5 }, f.admin)).pace).toMatchObject({ batch: 2, minutes: 5, nextAt: T0, batches: 0 });
    expect((await pace(r.id)).pace_next_at).toBeNull();
    expect(await advance(r, T0)).toMatchObject({ admitted: 2 });
    // Raised to 4 at T0+1: the next batch keeps T0+5 and admits 4.
    f.clock.set(at(MINUTE));
    expect((await f.live.setPace(r.id, { batch: 4, minutes: 5 }, f.admin)).pace).toMatchObject({ batch: 4, nextAt: at(5 * MINUTE) });
    expect(await advance(r, at(5 * MINUTE))).toMatchObject({ admitted: 4 });
    // Shortened to 2 minutes at T0+6: the batch of T0+10 keeps its time, the ones after come every 2 minutes.
    f.clock.set(at(6 * MINUTE));
    await f.live.setPace(r.id, { batch: 4, minutes: 2 }, f.admin);
    expect(await advance(r, at(10 * MINUTE))).toMatchObject({ admitted: 4 });
    expect(await advance(r, at(12 * MINUTE))).toMatchObject({ admitted: 2 });
    expect((await audits(r.id, 'drop.live.pace')).map((a) => a.details)).toEqual([
      { before: { batch: 1, minutes: 5 }, after: { batch: 2, minutes: 5 }, nextAt: null },
      { before: { batch: 2, minutes: 5 }, after: { batch: 4, minutes: 5 }, nextAt: at(5 * MINUTE).toISOString() },
      { before: { batch: 4, minutes: 5 }, after: { batch: 4, minutes: 2 }, nextAt: at(10 * MINUTE).toISOString() },
    ]);

    // A release with no pace until now: everyone in the line already admitted; from now, a batch every Y.
    const open = await release();
    await room(open, 2);
    await advance(open, T0);
    f.clock.set(at(3 * MINUTE));
    expect((await f.live.setPace(open.id, { batch: 1, minutes: 2 }, f.admin)).pace).toMatchObject({ nextAt: at(5 * MINUTE), waiting: 0, admitted: 2 });
    const late = await accountOfTier(f, 0);
    f.clock.set(at(4 * MINUTE));
    expect(await f.live.enter(late.id, open.id, { sizeId: open.sizes[0]!.id }, late.actor)).toMatchObject({ queue: { place: 1, etaAt: at(5 * MINUTE) } });
    expect(await advance(open, at(5 * MINUTE))).toMatchObject({ admitted: 1, turns: 1 });

    // Refused: outside the bounds, on an after-room, without a pace (PAUSE PACE, NEXT BATCH NOW), after the end, by a customer.
    await rejects(f.live.setPace(r.id, { batch: 0, minutes: 5 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 5001, minutes: 5 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 1, minutes: 61 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 1.5, minutes: 5 }, f.admin), 'VALIDATION_FAILED', 400);
    const parent = await release({ afterRoom: { modelId: f.modelId, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] } as never });
    // Published, as a sell-out with people waiting publishes it (after-room.ts settleAfterRoom).
    await t.db.updateTable('drops').set({ published_at: f.clock.now() }).where('id', '=', parent.afterRoom!.id).execute();
    await rejects(f.live.setPace(parent.afterRoom!.id, { batch: 1, minutes: 5 }, f.admin), 'LIVE_AFTER_ROOM', 409);
    expect((await pace(parent.afterRoom!.id)).pace_batch).toBeNull();
    const none = await release();
    f.clock.set(at(MINUTE));
    await rejects(f.live.pausePace(none.id, f.admin), 'LIVE_NO_PACE', 409);
    await rejects(f.live.resumePace(none.id, f.admin), 'LIVE_NO_PACE', 409);
    await rejects(f.live.nextBatch(none.id, f.admin), 'LIVE_NO_PACE', 409);
    f.clock.set(at(61 * MINUTE));
    await rejects(f.live.setPace(none.id, { batch: 1, minutes: 5 }, f.admin), 'LIVE_ENDED', 409);
    await rejects(f.live.setPace(none.id, { batch: 1, minutes: 5 }, { type: 'account', id: randomUUID() }), 'FORBIDDEN', 403);
  });

  it('reads the queue, the console’s entries and the export with the admission', async () => {
    const r = await release({ pace: { batch: 2, minutes: 3 } });
    const people = await room(r, 6);
    // Before T0: no queue (the room).
    expect((await f.live.entry(people[0]!.id, r.id))!.queue).toBeNull();
    await advance(r, T0);
    const rows = await entriesOf(t.db, r.id);
    const byPlace = (p: number) => rows.find((e) => e.position === p)!.account_id;
    expect((await f.live.entry(byPlace(1), r.id))!.queue).toBeNull();
    expect((await f.live.entry(byPlace(3), r.id))!.queue).toEqual({ place: 1, etaAt: at(3 * MINUTE), paused: false });
    expect((await f.live.entry(byPlace(4), r.id))!.queue).toEqual({ place: 2, etaAt: at(3 * MINUTE), paused: false });
    expect((await f.live.entry(byPlace(6), r.id))!.queue).toEqual({ place: 4, etaAt: at(6 * MINUTE), paused: false });
    // The console's entries say when and by which batch.
    const listed = await f.liveConsole.entries(r.id, {}, { page: 1, pageSize: 10 });
    expect(listed.items.map((e) => [e.position, e.batch, e.admittedAt])).toEqual([
      [1, 1, T0],
      [2, 1, T0],
      [3, null, null],
      [4, null, null],
      [5, null, null],
      [6, null, null],
    ]);
    // The export: when it was admitted, never the batch's own figures.
    const exported = await accountLiveData(t.db, byPlace(1));
    expect(exported.entries[0]).toMatchObject({ admittedAt: T0, queuedAt: T0 });
    expect((await accountLiveData(t.db, byPlace(6))).entries[0]!.admittedAt).toBeNull();
  });

  it('admits 5 000 entries in 20 batches of 250, each in the line’s order at its time', async () => {
    const r = await release({ pace: { batch: 250, minutes: 1 }, sizes: [{ label: '52', stock: 1 }] });
    const N = 5000;
    const ids: string[] = [];
    for (let i = 0; i < N; i += 500) {
      const values = Array.from({ length: Math.min(500, N - i) }, () => {
        const email = `pace-${randomUUID()}@example.com`;
        return { email, email_normalized: email, password_hash: 'unused' };
      });
      ids.push(...(await t.db.insertInto('accounts').values(values).returning('id').execute()).map((a) => a.id));
    }
    for (let i = 0; i < N; i += 500) {
      await t.db
        .insertInto('live_entries')
        .values(ids.slice(i, i + 500).map((id) => ({ drop_id: r.id, account_id: id, size_id: r.sizes[0]!.id, quantity: 1, tier: 0, joined_at: at(-MINUTE), status: 'WAITING' as const })))
        .execute();
    }
    expect(await advance(r, T0)).toMatchObject({ queued: N, admitted: 250, turns: 1 });
    for (let k = 1; k < 20; k++) expect(await advance(r, at(k * MINUTE))).toMatchObject({ admitted: 250 });
    expect(await advance(r, at(20 * MINUTE))).toMatchObject({ admitted: 0 });
    const batches = await sql<{ batch: number; n: number; first: number; last: number; at: Date; times: number }>`
      SELECT admitted_batch AS batch, count(*)::int AS n, min(position) AS first, max(position) AS last, min(admitted_at) AS at,
             count(DISTINCT admitted_at)::int AS times
        FROM live_entries WHERE drop_id = ${r.id} GROUP BY admitted_batch ORDER BY admitted_batch`.execute(t.db);
    expect(batches.rows).toHaveLength(20);
    batches.rows.forEach((b, k) => {
      expect({ batch: Number(b.batch), n: Number(b.n), first: Number(b.first), last: Number(b.last), at: new Date(b.at), times: Number(b.times) }).toEqual({
        batch: k + 1,
        n: 250,
        first: k * 250 + 1,
        last: (k + 1) * 250,
        at: at(k * MINUTE),
        times: 1,
      });
    });
    expect(await pace(r.id)).toMatchObject({ pace_batches: 21, pace_next_at: at(21 * MINUTE) });
    // M1.3: the TEST REPORT's PACE check reads the same.
    const d = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    expect(paceCheck(await livePaceFacts(t.db, d, at(20 * MINUTE)))).toEqual({
      id: 'PACE',
      label: 'The pace',
      pass: true,
      line: '20 batches admitted 5000 entries at 250 every 1 min, each on its time and in the line’s order.',
    });
  }, 120_000);

  it('shows the pace on the console’s live board: in the queue, admitted, the batches, the next batch, its pause; none without a pace', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 } });
    await room(r, 5);
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ batch: 2, minutes: 5, nextAt: T0, paused: false, batches: 0, waiting: 0, admitted: 0 });
    await advance(r, T0);
    const board = (await f.liveConsole.board(r.id))!;
    expect(board.pace).toEqual({ batch: 2, minutes: 5, nextAt: at(5 * MINUTE), pausedAt: null, paused: false, batches: 1, waiting: 3, admitted: 2 });
    // The line carries each entry's batch.
    expect(board.line.map((e) => [e.position, e.batch])).toEqual([
      [1, 1],
      [2, 1],
      [3, null],
      [4, null],
      [5, null],
    ]);
    f.clock.set(at(MINUTE));
    await f.live.pausePace(r.id, f.admin);
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ paused: true, pausedAt: at(MINUTE), waiting: 3 });
    const none = await release();
    expect((await f.liveConsole.board(none.id))!.pace).toBeNull();
  });

  it('the TEST REPORT’s PACE check passes on the engine’s history: batches, NEXT BATCH NOW, LET IN, the release’s PAUSE, SET PACE, a late arrival, empty batches', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 } });
    await room(r, 10);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    await f.live.nextBatch(r.id, f.admin);
    f.clock.set(at(2 * MINUTE));
    const last = (await entriesOf(t.db, r.id)).at(-1)!;
    await f.live.letIn(r.id, last.id, f.admin);
    await advance(r, at(5 * MINUTE));
    f.clock.set(at(6 * MINUTE));
    await f.live.pause(r.id, f.admin);
    f.clock.set(at(8 * MINUTE));
    await f.live.resume(r.id, f.admin);
    await advance(r, at(12 * MINUTE));
    f.clock.set(at(13 * MINUTE));
    await f.live.setPace(r.id, { batch: 3, minutes: 2 }, f.admin);
    const late = await accountOfTier(f, 0);
    f.clock.set(at(14 * MINUTE));
    await f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor);
    await advance(r, at(17 * MINUTE));
    await advance(r, at(25 * MINUTE));
    expect((await line(r)).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 2, MINUTE],
      [4, 2, MINUTE],
      [5, 3, 5 * MINUTE],
      [6, 3, 5 * MINUTE],
      [7, 4, 12 * MINUTE],
      [8, 4, 12 * MINUTE],
      [9, 5, 17 * MINUTE],
      [10, 2, 2 * MINUTE],
      [11, 5, 17 * MINUTE],
    ]);
    const d = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    const check = paceCheck(await livePaceFacts(t.db, d, at(25 * MINUTE)));
    expect(check).toEqual({
      id: 'PACE',
      label: 'The pace',
      pass: true,
      line: '5 batches admitted 10 entries at 2 every 5 min, then 3 every 2 min, each on its time and in the line’s order, 1 by NEXT BATCH NOW; 1 entry let in by hand.',
    });
  });
});

describe('the TEST REPORT’s PACE check finds a fault planted', () => {
  /** Five entries in the line at T0, a pace of 2 every 5 minutes: batch 1 at T0 (places 1, 2), batch 2 at T0+5 (3, 4). */
  const facts = (): PaceFacts => ({
    opensAt: T0,
    end: at(7 * MINUTE),
    pace: { batch: 2, minutes: 5 },
    entries: [1, 2, 3, 4, 5].map((p) => ({
      id: `e${p}`,
      position: p,
      guaranteed: false,
      queuedAt: T0,
      admittedAt: p <= 2 ? T0 : p <= 4 ? at(5 * MINUTE) : null,
      batch: p <= 2 ? 1 : p <= 4 ? 2 : null,
      endedAt: null,
    })),
    events: [
      { kind: 'BATCH', at: T0, batch: 1, entries: 2, extra: false, recordedAt: T0 },
      { kind: 'BATCH', at: at(5 * MINUTE), batch: 2, entries: 2, extra: false, recordedAt: at(5 * MINUTE) },
    ],
  });
  const lineOf = (f: PaceFacts) => {
    const c = paceCheck(f);
    return c.pass ? `PASS ${c.line}` : c.line;
  };

  it('passes the history as it should be', () => {
    expect(lineOf(facts())).toBe('PASS 2 batches admitted 4 entries at 2 every 5 min, each on its time and in the line’s order.');
    const nothing = { ...facts(), entries: facts().entries.map((e) => ({ ...e, admittedAt: null, batch: null })), events: [], end: at(-MINUTE) };
    expect(lineOf(nothing)).toBe('PASS No batch has admitted anyone yet (2 every 5 min): nothing to check.');
  });

  it('a batch not recorded, or recorded with another count', () => {
    const f = facts();
    f.entries[4] = { ...f.entries[4]!, admittedAt: at(6 * MINUTE), batch: 7 };
    expect(lineOf(f)).toBe('Place 5 was admitted in batch 7, which no batch recorded.');
    const g = facts();
    g.events[0] = { kind: 'BATCH', at: T0, batch: 1, entries: 3, extra: false, recordedAt: T0 };
    expect(lineOf(g)).toBe('Batch 1 recorded 3 entries; 2 carry its number.');
  });

  it('too many in a batch, or too few while others waited', () => {
    const f = facts();
    f.entries[2] = { ...f.entries[2]!, admittedAt: T0, batch: 1 };
    f.events[0] = { kind: 'BATCH', at: T0, batch: 1, entries: 3, extra: false, recordedAt: T0 };
    f.events[1] = { kind: 'BATCH', at: at(5 * MINUTE), batch: 2, entries: 1, extra: false, recordedAt: at(5 * MINUTE) };
    expect(lineOf(f)).toBe('Batch 1 admitted 3, more than the 2 of the pace.');
    const g = facts();
    g.entries[1] = { ...g.entries[1]!, admittedAt: null, batch: null };
    g.events[0] = { kind: 'BATCH', at: T0, batch: 1, entries: 1, extra: false, recordedAt: T0 };
    expect(lineOf(g)).toBe('Batch 1 admitted 1 of 2 while 4 entries more waited.');
  });

  it('a batch out of the line’s order; the house’s guarantee first', () => {
    const f = facts();
    f.entries[1] = { ...f.entries[1]!, admittedAt: at(5 * MINUTE), batch: 2 };
    f.entries[2] = { ...f.entries[2]!, admittedAt: T0, batch: 1 };
    expect(lineOf(f)).toBe('Place 3 was admitted in batch 1 while place 2, ahead of it, waited.');
    // A guaranteed place 5 admitted first is in order.
    const g = facts();
    g.entries[4] = { ...g.entries[4]!, guaranteed: true, admittedAt: T0, batch: 1 };
    g.entries[1] = { ...g.entries[1]!, admittedAt: at(5 * MINUTE), batch: 2 };
    g.entries[3] = { ...g.entries[3]!, admittedAt: null, batch: null };
    expect(lineOf(g)).toMatch(/^PASS /);
  });

  it('a batch before its time, off the pace, or one skipped while people waited', () => {
    const f = facts();
    for (const e of f.entries.slice(2, 4)) e.admittedAt = at(4 * MINUTE);
    f.events[1] = { kind: 'BATCH', at: at(4 * MINUTE), batch: 2, entries: 2, extra: false, recordedAt: at(4 * MINUTE) };
    expect(lineOf(f)).toBe('Batch 2 came at 11:04:00 PARIS, before its time, 11:05:00 PARIS.');
    const g = facts();
    for (const e of g.entries.slice(2, 4)) e.admittedAt = at(6 * MINUTE);
    g.events[1] = { kind: 'BATCH', at: at(6 * MINUTE), batch: 2, entries: 2, extra: false, recordedAt: at(6 * MINUTE) };
    expect(lineOf(g)).toBe('Batch 2 came at 11:06:00 PARIS, off the pace of every 5 min.');
    const k = facts();
    for (const e of k.entries.slice(2, 4)) e.admittedAt = at(10 * MINUTE);
    k.events[1] = { kind: 'BATCH', at: at(10 * MINUTE), batch: 3, entries: 2, extra: false, recordedAt: at(10 * MINUTE) };
    for (const e of k.entries.slice(2, 4)) e.batch = 3;
    k.end = at(12 * MINUTE);
    expect(lineOf(k)).toBe('No batch came at 11:05:00 PARIS, while 3 entries waited.');
    // The last one waiting, never admitted by the batch of T0+10 while the release ran on.
    const tail = facts();
    tail.end = at(11 * MINUTE);
    expect(lineOf(tail)).toBe('No batch came at 11:10:00 PARIS, while 1 entry waited.');
    // Left the line before the batch ran: nobody waited.
    tail.entries[4] = { ...tail.entries[4]!, endedAt: at(9 * MINUTE) };
    expect(lineOf(tail)).toMatch(/^PASS /);
  });
});
