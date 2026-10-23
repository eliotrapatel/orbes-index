/**
 * ONE QUEUE's engine (lot Q1, step Q1.2; plan §1.2, §1.4, §2; services/live.ts, live-frames.ts, live-queue.ts; migrations
 * 0049 and 0058), against a migrated database and a manual clock. It replaces K30 as built in M1 (macro scope note of
 * 2026-10-21, D55); each M1 assertion replaced is named where its new rule is tested:
 *
 *  - M1 « admits exactly X every Y … only the admitted take turns » → batches give TURNS, up to X, in the order of the
 *    turns, only where a size has a free piece, fewer while pieces are held, stamped with the batch (D3);
 *  - M1 « late arrival … an empty batch moves the clock; overdue batches keep their own times » → the same, late comers
 *    at the next batch (D15), the overdue batches one per frame (D9);
 *  - M1 « admits the house's guarantee first » → its turn first in its size (D2);
 *  - M1 « with no pace, admits everyone as they take their place » → no LIVE release without a pace (D1): creation
 *    refuses one, the database too (drops_live_paced); the after-room alone has none, and gives its turns at once (D29);
 *  - M1 « W6: an absent admitted entry's turn runs out and passes to the next … at once » → it passes at the next batch,
 *    as every returned, freed, expired piece and ADD PIECES (D5);
 *  - M1 « PAUSE holds the pace », « PAUSE PACE … » → kept (D7), with NEXT BATCH NOW and LET IN working under PAUSE PACE;
 *  - M1 « SET PACE while PAUSED, on a release with no pace » and « … on a release with no pace, Y minutes from now » →
 *    gone with the no-pace branch: SET PACE slower or faster from the next batch, which keeps its time (D7);
 *  - M1 « NEXT BATCH NOW admits one batch at once … LET IN admits » → up to X extra turns where a piece is free, refused
 *    when none (LIVE_NOTHING_FREE) or while PAUSED, the clock keeping its time; LET IN as today, during the hold too (D6);
 *  - M1 « reads the queue, the console's entries and the export with the admission » → the turn's batch and time;
 *  - M1 « 5 000 entries in 20 batches of 250 » → 20 batches of 250 turns (more pieces than entrants);
 *  - M1 « the console's live board » → its figures, with ONE QUEUE's added: turns given, LET IN, the hold, beyond the
 *    pieces, the close guard (D10, D11);
 *  - M1 « the PACE check passes / finds a fault planted » → read from ONE QUEUE's records (`drop.live.batch`); its two
 *    rules that need each batch's free pieces (« too few while others waited », « a batch skipped while people waited »)
 *    come back in step Q1.4's check (D14, N5), named in the planted faults below.
 * New: the hold after the opening (D4: everyone waits it; SHORTEN THE HOLD and END THE HOLD NOW, never later; before
 * the announcement a setting, after it the house's settings lock: N14), at most one batch per published frame (D9: a
 * restart's overdue slots one per frame, a NEXT BATCH NOW within the frame of another batch waiting for the next one),
 * a batch after the first waiting until the phones it reaches have READ that they are next (G2, PLAN amendment 1: a
 * restart's overdue slots, NEXT BATCH NOW twice right after a scheduled batch, a back-of-line reader on a 60 s cadence;
 * capped at 60 s), sets under the cap.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { GuaranteeService } from '../../src/server/services/guarantees.js';
import { accountLiveData, holdEndsAt, liveQueueEta, liveReadsNext, LiveService, paceNextAt, paceShiftMs } from '../../src/server/services/live.js';
import { LiveFrameGate } from '../../src/server/services/live-frames.js';
import { LiveInsightsService, queueFigures } from '../../src/server/services/live-insights.js';
import { closeGuard } from '../../src/server/services/live-queue.js';
import { livePaceFacts, paceCheck, type PaceFacts } from '../../src/server/services/test-entrants.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, createSet, createSetLiveRelease, entriesOf, liveFixture, pieceSize, sizedModel, type LiveFixture, type LiveRelease } from '../support/live.js';

const T0 = new Date('2026-11-05T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR_MS = 60 * MINUTE;

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

describe('the rules of the pace', () => {
  const d = { opens_at: T0, paused_at: null, pace_batch: 250, pace_minutes: 2, pace_paused_at: null, pace_next_at: null, pace_hold_minutes: 0, pace_batches: 0, pace_extra_batches: 0 } as const;

  it('dues the first batch at T0 + the hold, then at the stored next batch; none without a pace (an after-room)', () => {
    expect(paceNextAt(d)).toEqual(T0);
    expect(paceNextAt({ ...d, pace_hold_minutes: 10 })).toEqual(at(10 * MINUTE));
    expect(paceNextAt({ ...d, pace_hold_minutes: 10, pace_next_at: at(4 * MINUTE) })).toEqual(at(4 * MINUTE));
    expect(paceNextAt({ ...d, pace_batch: null, pace_minutes: null })).toBeNull();
  });

  it('says when the hold ends while it lasts: a hold set, no scheduled batch given yet (a NEXT BATCH NOW leaves it: D4, A 157, A 160)', () => {
    expect(holdEndsAt({ ...d, pace_hold_minutes: 10 })).toEqual(at(10 * MINUTE));
    expect(holdEndsAt(d)).toBeNull();
    expect(holdEndsAt({ ...d, pace_hold_minutes: 10, pace_batches: 1 })).toBeNull();
    // Two NEXT BATCH NOW batches during the hold, its first scheduled batch still to come at T0 + 10.
    expect(holdEndsAt({ ...d, pace_hold_minutes: 10, pace_batches: 2, pace_extra_batches: 2, pace_next_at: at(10 * MINUTE) })).toEqual(at(10 * MINUTE));
    expect(holdEndsAt({ ...d, pace_hold_minutes: 10, pace_batches: 3, pace_extra_batches: 2, pace_next_at: at(12 * MINUTE) })).toBeNull();
    expect(holdEndsAt({ ...d, pace_hold_minutes: 10, pace_batch: null })).toBeNull();
  });

  it('estimates the time as next + (ceil(place / X) − 1) × Y, the hold counted, never before now, none while held (Q1.3 replaces it with the queue snapshot)', () => {
    expect(liveQueueEta(d, 1, at(-MINUTE))).toEqual(T0);
    expect(liveQueueEta(d, 251, at(-MINUTE))).toEqual(at(2 * MINUTE));
    expect(liveQueueEta({ ...d, pace_hold_minutes: 10 }, 251, at(-MINUTE))).toEqual(at(12 * MINUTE));
    expect(liveQueueEta({ ...d, pace_paused_at: T0 }, 1, at(SECOND))).toBeNull();
  });

  it('moves the next batch once for a stretch both pauses held', () => {
    expect(paceShiftMs(at(2 * MINUTE), at(MINUTE), at(3 * MINUTE))).toBe(0);
    expect(paceShiftMs(at(MINUTE), null, at(4 * MINUTE))).toBe(3 * MINUTE);
    expect(paceShiftMs(at(MINUTE), at(2 * MINUTE), at(3 * MINUTE))).toBe(MINUTE);
  });

  it('warns at the close (D10, advice only): the pieces the batches left before the close cannot offer', () => {
    const p = { batch: 2, minutes: 5, nextAt: T0, closesAt: at(60 * MINUTE), ended: false };
    // 12 batches before the close (T0, T0+5 … T0+55), 24 turns: 100 pieces leave 76.
    expect(closeGuard({ ...p, notConfirmed: 100 })).toEqual({ remain: 76 });
    expect(closeGuard({ ...p, notConfirmed: 24 })).toBeNull();
    expect(closeGuard({ ...p, nextAt: at(58 * MINUTE), notConfirmed: 3 })).toEqual({ remain: 1 });
    expect(closeGuard({ ...p, nextAt: at(60 * MINUTE), notConfirmed: 3 })).toEqual({ remain: 3 });
    expect(closeGuard({ ...p, ended: true, notConfirmed: 100 })).toBeNull();
  });

  it('reads the report’s queue figures (D11): the longest wait, the turns given by the pace, the people who left the queue', () => {
    const e = (o: Partial<Parameters<typeof queueFigures>[0][number]>) => ({
      id: randomUUID(), accountId: 'a', sizeId: 's', quantity: 1, status: 'QUEUED' as const, tier: 0, position: 1, joinedAt: T0, queuedAt: T0,
      turnAt: null, turnExpiresAt: null, securedAt: null, holdExpiresAt: null, confirmedAt: null, endedAt: null, gestureMs: null, resolution: null, country: null, ...o,
    });
    const figures = queueFigures(
      [
        e({ status: 'CONFIRMED', turnAt: at(3 * MINUTE), batch: 4 }),
        e({ status: 'MISSED', turnAt: at(MINUTE), batch: 2, letIn: true }),
        e({ status: 'LEFT', endedAt: at(7 * MINUTE) }),
        e({ status: 'LEFT', position: null, queuedAt: null, endedAt: at(-MINUTE) }),
        e({ status: 'QUEUED' }),
      ],
      null,
      at(5 * MINUTE),
    );
    expect(figures).toEqual({ longestWaitMs: 7 * MINUTE, turnsByPace: 1, leftQueue: 1 });
    expect(queueFigures([], null, T0)).toEqual({ longestWaitMs: null, turnsByPace: 0, leftQueue: 0 });
  });
});

describe('LiveService: ONE QUEUE’s batches', () => {
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
  const advance = async (r: LiveRelease, when: Date, live: LiveService = f.live) => {
    f.clock.set(when);
    return live.advance(r.id);
  };
  const audits = async (dropId: string, action: string) =>
    (await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('target_id', '=', dropId).where('action', '=', action).orderBy('id').execute()).map((a) => ({
      actor: a.actor_type,
      details: a.details as Record<string, unknown>,
    }));
  const pace = (id: string) =>
    t.db.selectFrom('drops').select(['pace_batch', 'pace_minutes', 'pace_next_at', 'pace_paused_at', 'pace_batches', 'pace_extra_batches', 'pace_hold_minutes']).where('id', '=', id).executeTakeFirstOrThrow();
  /** `n` accounts entered in the room before T0 (in the release's size `sizeIndex`). */
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
  /** The line: [position, status, its turn's batch, the batch's time from T0] by place. */
  const line = async (r: LiveRelease) =>
    (await entriesOf(t.db, r.id)).map((e) => [e.position, e.status, e.admitted_batch, e.admitted_at ? e.admitted_at.getTime() - T0.getTime() : null]);
  const statuses = async (r: LiveRelease) => (await entriesOf(t.db, r.id)).map((e) => e.status);
  const check = async (r: LiveRelease, now: Date) => paceCheck(await livePaceFacts(t.db, await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow(), now));
  /**
   * A LiveService whose frames are published only when the test says (`frame`): the engine of one process. With
   * `readings` (G2), its batches after the first wait for the phones' readings: `read` is the phone of the entry at a
   * place in the line reading its state (its own entry, as the stream's `you` event and GET /state serve it), recorded
   * as the app records it; `readings` lists them, in order.
   */
  const process = (o: { readings?: boolean } = {}) => {
    const frames = new LiveFrameGate();
    frames.usePublisher(() => {});
    frames.useReadings(o.readings ?? false);
    const live = new LiveService({ db: t.db, audit: f.audit, seedKey: f.seedKey, turnKey: f.turnKey, clock: f.clock.now, frames });
    const readings: { position: number; next: boolean; at: number }[] = [];
    const read = async (r: LiveRelease, position: number) => {
      const e = (await entriesOf(t.db, r.id)).find((x) => x.position === position)!;
      const view = (await live.entry(e.account_id, r.id))!;
      const next = liveReadsNext(view);
      frames.read(r.id, view.id, next);
      readings.push({ position, next, at: f.clock.now().getTime() - T0.getTime() });
      return next;
    };
    return { live, frame: (r: LiveRelease) => frames.published(r.id, frames.begin(r.id)), read, readings };
  };
  /**
   * Whether every turn given by a batch after the first, up to the place `upTo`, went to an entry whose phone's last
   * reading before it (by the clock) said it was next.
   */
  const turnsRead = async (r: LiveRelease, readings: readonly { position: number; next: boolean; at: number }[], upTo = Infinity) => {
    for (const e of await entriesOf(t.db, r.id)) {
      if (e.admitted_batch === null || e.admitted_batch < 2 || e.let_in_by || e.position! > upTo) continue;
      const given = e.turn_at!.getTime() - T0.getTime();
      const last = readings.filter((x) => x.position === e.position && x.at <= given).at(-1);
      if (!last?.next) return `place ${e.position} (batch ${e.admitted_batch}) was given its turn without having read that it was next`;
    }
    return 'every turn read';
  };
  const settledWithin = async <T,>(p: Promise<T>, ms = 400): Promise<boolean> => {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    await new Promise((resolve) => setTimeout(resolve, ms));
    return done;
  };

  it('gives TURNS by batches (D3; M1 « admits exactly X every Y … only the admitted take turns »): up to X every Y minutes on the batches’ logical times, in the line’s order, each turn stamped with its batch', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 }, turnSeconds: 300 });
    await room(r, 7);
    expect(await advance(r, T0)).toMatchObject({ queued: 7, batch: 1, turns: 2 });
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
    // Nothing before the next batch, with 98 pieces free: no turn outside a batch.
    expect(await advance(r, at(5 * MINUTE - 1))).toMatchObject({ batch: null, turns: 0 });
    expect(await advance(r, at(5 * MINUTE))).toMatchObject({ batch: 2, turns: 2 });
    // The engine away for 7 minutes: the batch due at T0+10 is stamped T0+10 (its turns run from when it went).
    expect(await advance(r, at(12 * MINUTE))).toMatchObject({ batch: 3, turns: 2 });
    expect((await line(r)).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 2, 5 * MINUTE],
      [4, 2, 5 * MINUTE],
      [5, 3, 10 * MINUTE],
      [6, 3, 10 * MINUTE],
      [7, null, null],
    ]);
    expect((await entriesOf(t.db, r.id))[4]).toMatchObject({ turn_at: at(12 * MINUTE), turn_expires_at: at(17 * MINUTE) });
    expect(await pace(r.id)).toMatchObject({ pace_batches: 3, pace_next_at: at(15 * MINUTE) });
    // The audit log: each batch as counts, the system as actor, never an entry.
    expect(await audits(r.id, 'drop.live.batch')).toEqual([
      { actor: 'system', details: { batch: 1, at: T0.toISOString(), turns: 2 } },
      { actor: 'system', details: { batch: 2, at: at(5 * MINUTE).toISOString(), turns: 2 } },
      { actor: 'system', details: { batch: 3, at: at(10 * MINUTE).toISOString(), turns: 2 } },
    ]);
    expect(await audits(r.id, 'drop.live.admit')).toEqual([]);
  });

  it('gives turns only where a size has a piece nobody holds: fewer while pieces are held, the batch passing over a full size (D3)', async () => {
    const r = await release({ pace: { batch: 3, minutes: 1 }, turnSeconds: 300, sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 2 }] });
    const in50 = await room(r, 2, 0);
    const in52 = await room(r, 3, 1);
    await advance(r, T0);
    const bySize = async (i: number) => (await entriesOf(t.db, r.id)).filter((e) => e.size_id === r.sizes[i]!.id).map((e) => e.status);
    // Three turns: the one piece of 50, the two of 52.
    expect([await bySize(0), await bySize(1)]).toEqual([['TURN', 'QUEUED'], ['TURN', 'TURN', 'QUEUED']]);
    // Every piece held: the batch of T0+1 gives none, and still moves the clock (no audit entry).
    expect(await advance(r, at(MINUTE))).toMatchObject({ batch: 2, turns: 0 });
    expect(await audits(r.id, 'drop.live.batch')).toHaveLength(1);
    // The piece of 50 returns (RELEASED): the next batch gives one turn, in 50; 52's pieces are still held.
    const first50 = (await entriesOf(t.db, r.id)).find((e) => e.size_id === r.sizes[0]!.id && e.status === 'TURN')!;
    const who = in50.find((p) => p.id === first50.account_id)!;
    const token = (await f.live.entry(who.id, r.id))!.turn!.token!;
    f.clock.set(at(MINUTE + 10 * SECOND));
    await f.live.press(who.id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(who.id, r.id, token, who.actor);
    await f.live.release(who.id, r.id, who.actor);
    expect(await bySize(0)).toEqual(['RELEASED', 'QUEUED']);
    expect(await advance(r, at(2 * MINUTE))).toMatchObject({ batch: 3, turns: 1 });
    expect([await bySize(0), await bySize(1)]).toEqual([['RELEASED', 'TURN'], ['TURN', 'TURN', 'QUEUED']]);
    expect(in52).toHaveLength(3);
  });

  it('places a late comer behind, given its turn by the first batch after it came (D15); an empty batch moves the clock; overdue batches go one per pass, each with its own time and number (D9; M1 « … overdue batches keep their own times »)', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 } });
    await room(r, 2);
    await advance(r, T0);
    // Nobody waits at T0+5 and T0+10: two empty batches, no audit entry, one per pass.
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ batch: 2, turns: 0 });
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ batch: 3, turns: 0 });
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ batch: null });
    expect(await pace(r.id)).toMatchObject({ pace_batches: 3, pace_next_at: at(15 * MINUTE) });
    // Arrivals at T0+12 and T0+17: the first waits for T0+15 (at most Y), the second for T0+20.
    const late = await accountOfTier(f, 0);
    f.clock.set(at(12 * MINUTE));
    expect(await f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor)).toMatchObject({ status: 'QUEUED', position: 3 });
    const later = await accountOfTier(f, 0);
    f.clock.set(at(17 * MINUTE));
    await f.live.enter(later.id, r.id, { sizeId: r.sizes[0]!.id }, later.actor);
    // The engine away from T0+11 to T0+21: the batch of T0+15 takes only the first (the second came after it), the
    // batch of T0+20 the second, each in its own pass.
    expect(await advance(r, at(21 * MINUTE))).toMatchObject({ batch: 4, turns: 1 });
    expect(await advance(r, at(21 * MINUTE))).toMatchObject({ batch: 5, turns: 1 });
    expect((await line(r)).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 4, 15 * MINUTE],
      [4, 5, 20 * MINUTE],
    ]);
    expect(await pace(r.id)).toMatchObject({ pace_batches: 5, pace_next_at: at(25 * MINUTE) });
    expect((await audits(r.id, 'drop.live.batch')).map((a) => a.details.batch)).toEqual([1, 4, 5]);
    expect((await check(r, at(21 * MINUTE))).pass).toBe(true);
  });

  it('gives the house’s guarantee its turn first in its size, wherever its place (D2; M1 « admits the house’s guarantee first »)', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 } });
    const people = await room(r, 3);
    const holder = await accountOfTier(f, 0);
    await new GuaranteeService({ db: t.db, audit: f.audit, clock: f.clock.now }).grant(holder.id, { scope: 'RELEASE', targetId: r.id, pieces: 1, validUntil: '2026-12-31', visible: true }, f.admin);
    await advance(r, T0);
    // The holder arrives after T0: behind in the line, its turn first at the next batch.
    f.clock.set(at(MINUTE));
    expect(await f.live.enter(holder.id, r.id, { sizeId: r.sizes[0]!.id }, holder.actor)).toMatchObject({ position: 4 });
    await advance(r, at(5 * MINUTE));
    const rows = await entriesOf(t.db, r.id);
    expect(rows.find((e) => e.account_id === holder.id)).toMatchObject({ admitted_batch: 2, status: 'TURN' });
    expect(rows.filter((e) => e.status === 'QUEUED').map((e) => e.position)).toEqual([2, 3]);
    expect(people).toHaveLength(3);
  });

  it('has a pace on every LIVE release (D1; M1 « with no pace, admits everyone … »): created without one, refused; the database refuses one open without it; an after-room alone has none and gives its turns at once (D29)', async () => {
    const settings = {
      modelId: f.modelId,
      title: 'NO PACE',
      opensAt: T0,
      closesAt: at(60 * MINUTE),
      priceMinor: 100_000,
      sizes: [{ label: '52', stock: 1 }],
    };
    f.clock.set('2026-11-04T09:00:00.000Z');
    const message = 'A LIVE release needs a pace: people per batch, every how many minutes, and a hold after the opening (0 for none).';
    expect((await rejects(f.liveConsole.create(settings, f.admin), 'VALIDATION_FAILED', 400)).message).toBe(message);
    expect((await rejects(f.liveConsole.create({ ...settings, pace: { batch: 10, minutes: 1 } }, f.admin), 'VALIDATION_FAILED', 400)).message).toBe(message);
    expect((await rejects(f.liveConsole.create({ ...settings, holdMinutes: 0 }, f.admin), 'VALIDATION_FAILED', 400)).message).toBe(message);
    await rejects(f.liveConsole.create({ ...settings, pace: { batch: 10, minutes: 1 }, holdMinutes: 121 }, f.admin), 'VALIDATION_FAILED', 400);
    // The hold ends before the end of the sales.
    expect((await rejects(f.liveConsole.create({ ...settings, pace: { batch: 10, minutes: 1 }, holdMinutes: 60 }, f.admin), 'VALIDATION_FAILED', 400)).message).toBe(
      'The hold after the opening ends before the end of the sales.',
    );
    const created = await f.liveConsole.create({ ...settings, pace: { batch: 10, minutes: 1 }, holdMinutes: 5 }, f.admin);
    expect(created).toMatchObject({ pace: { batch: 10, minutes: 1 }, holdMinutes: 5 });
    // Its pace never taken away by the settings.
    await rejects(f.liveConsole.update(created.id, { pace: null }, f.admin), 'VALIDATION_FAILED', 400);
    await expect(t.db.updateTable('drops').set({ pace_batch: null, pace_minutes: null, pace_hold_minutes: 0 }).where('id', '=', created.id).execute()).rejects.toThrow(/drops_live_paced/);
    // An after-room: no pace, its turns at once (a returned piece too).
    const parent = await release({ afterRoom: { modelId: f.modelId, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] } as never });
    expect((await pace(parent.afterRoom!.id)).pace_batch).toBeNull();
    await t.db.updateTable('drops').set({ published_at: f.clock.now() }).where('id', '=', parent.afterRoom!.id).execute();
    await rejects(f.live.setPace(parent.afterRoom!.id, { batch: 1, minutes: 5 }, f.admin), 'LIVE_AFTER_ROOM', 409);
  });

  it('holds the opening for everyone, guarantees included (D4): the first batch at T0 + the hold; LET IN works during it; NEXT BATCH NOW starts the first turns early, the first scheduled batch keeping its time and the hold lasting until it (still shortened or ended: A 157, A 160)', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 }, holdMinutes: 10, turnSeconds: 300 });
    const holder = await accountOfTier(f, 0);
    await new GuaranteeService({ db: t.db, audit: f.audit, clock: f.clock.now }).grant(holder.id, { scope: 'RELEASE', targetId: r.id, pieces: 1, validUntil: '2026-12-31', visible: true }, f.admin);
    await room(r, 4);
    f.clock.set(at(-30 * SECOND));
    expect(await f.live.enter(holder.id, r.id, { sizeId: r.sizes[0]!.id }, holder.actor)).toMatchObject({ guaranteed: true });
    // T0: the line forms, nobody has a turn, the guarantee neither.
    expect(await advance(r, T0)).toMatchObject({ queued: 5, batch: null, turns: 0 });
    expect(await statuses(r)).toEqual(['QUEUED', 'QUEUED', 'QUEUED', 'QUEUED', 'QUEUED']);
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ holdMinutes: 10, holdEndsAt: at(10 * MINUTE), nextAt: at(10 * MINUTE), batches: 0 });
    expect(await advance(r, at(10 * MINUTE - 1))).toMatchObject({ batch: null });
    // LET IN during the hold: its turn now, stamped with the batches so far (none).
    const last = (await entriesOf(t.db, r.id)).at(-1)!;
    f.clock.set(at(2 * MINUTE));
    expect(await f.live.letIn(r.id, last.id, f.admin)).toMatchObject({ status: 'TURN', letIn: true, admittedAt: at(2 * MINUTE), batch: 0 });
    // NEXT BATCH NOW during the hold: up to X turns now; the first scheduled batch keeps T0 + 10.
    f.clock.set(at(3 * MINUTE));
    expect((await f.live.nextBatch(r.id, f.admin)).pace).toMatchObject({ batches: 1, nextAt: at(10 * MINUTE), holdEndsAt: at(10 * MINUTE), turnsGiven: 2, letIn: 1, admitted: 3 });
    expect(await pace(r.id)).toMatchObject({ pace_batches: 1, pace_extra_batches: 1, pace_next_at: at(10 * MINUTE), pace_hold_minutes: 10 });
    // The guarantee first, then the line's first place.
    expect((await entriesOf(t.db, r.id)).filter((e) => e.admitted_batch === 1).map((e) => e.account_id)).toContain(holder.id);
    // The hold lasts after it: the board still shows its end, and it can still be shortened (or ended).
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ holdEndsAt: at(10 * MINUTE), nextAt: at(10 * MINUTE), batches: 1 });
    f.clock.set(at(4 * MINUTE));
    expect((await f.live.shortenHold(r.id, 9, f.admin)).pace).toMatchObject({ holdMinutes: 9, holdEndsAt: at(9 * MINUTE), nextAt: at(9 * MINUTE), batches: 1 });
    // The turns given at T0 + 2 and + 3 have run out (5 minutes each); no batch before the hold's end.
    expect(await advance(r, at(9 * MINUTE - 1))).toMatchObject({ batch: null, missed: 3 });
    // The first scheduled batch at T0 + 9 gives the next two and ends the hold.
    expect(await advance(r, at(9 * MINUTE))).toMatchObject({ batch: 2, turns: 2 });
    expect(await statuses(r)).toEqual(['MISSED', 'MISSED', 'TURN', 'TURN', 'MISSED']);
    expect(await pace(r.id)).toMatchObject({ pace_batches: 2, pace_extra_batches: 1, pace_next_at: at(14 * MINUTE) });
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ holdEndsAt: null, nextAt: at(14 * MINUTE) });
    await rejects(f.live.endHold(r.id, f.admin), 'LIVE_NO_HOLD', 409);
    expect((await check(r, at(9 * MINUTE))).pass).toBe(true);
  });

  it('SHORTENS THE HOLD and ENDS THE HOLD NOW from the announcement, earlier only (D4); before the announcement the hold is a setting, set longer or shorter; after it, the settings are locked as ever (N14)', async () => {
    f.clock.set('2026-11-04T09:00:00.000Z');
    const created = await f.liveConsole.create(
      { modelId: f.modelId, title: 'THE HOLD', opensAt: T0, closesAt: at(HOUR_MS), priceMinor: 100_000, sizes: [{ label: '52', stock: 10 }], pace: { batch: 5, minutes: 2 }, holdMinutes: 10, announceAt: new Date('2026-11-04T12:00:00.000Z') },
      f.admin,
    );
    // Before the announcement: a setting, longer or shorter.
    expect((await f.liveConsole.update(created.id, { holdMinutes: 20 }, f.admin)).holdMinutes).toBe(20);
    expect((await f.liveConsole.update(created.id, { holdMinutes: 15 }, f.admin)).holdMinutes).toBe(15);
    await f.liveConsole.publish(created.id, {}, f.admin);
    await rejects(f.live.shortenHold(created.id, 5, f.admin), 'LIVE_NOT_ANNOUNCED', 409);
    await rejects(f.live.endHold(created.id, f.admin), 'LIVE_NOT_ANNOUNCED', 409);
    // Announced: the settings no longer change, the hold included; only shortened or ended.
    f.clock.set('2026-11-04T13:00:00.000Z');
    await rejects(f.liveConsole.update(created.id, { holdMinutes: 30 }, f.admin), 'LIVE_ANNOUNCED', 409);
    await rejects(f.liveConsole.update(created.id, { holdMinutes: 5 }, f.admin), 'LIVE_ANNOUNCED', 409);
    await rejects(f.live.shortenHold(created.id, 15, f.admin), 'LIVE_HOLD_LATER', 409);
    await rejects(f.live.shortenHold(created.id, 20, f.admin), 'LIVE_HOLD_LATER', 409);
    await rejects(f.live.shortenHold(created.id, 121, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.shortenHold(created.id, 5, { type: 'account', id: randomUUID() }), 'FORBIDDEN', 403);
    // Between the announcement and T0: shortened to 5, then ended (the first batch at T0).
    expect((await f.live.shortenHold(created.id, 5, f.admin)).pace).toMatchObject({ holdMinutes: 5, holdEndsAt: at(5 * MINUTE), nextAt: at(5 * MINUTE) });
    expect((await f.live.endHold(created.id, f.admin)).pace).toMatchObject({ holdMinutes: 0, holdEndsAt: null, nextAt: T0 });
    await rejects(f.live.endHold(created.id, f.admin), 'LIVE_NO_HOLD', 409);
    await rejects(f.live.shortenHold(created.id, 0, f.admin), 'LIVE_NO_HOLD', 409);
    expect((await audits(created.id, 'drop.live.hold.shorten')).map((a) => a.details)).toEqual([{ before: at(15 * MINUTE).toISOString(), after: at(5 * MINUTE).toISOString(), minutes: 5 }]);
    expect((await audits(created.id, 'drop.live.hold.end')).map((a) => a.details)).toEqual([{ before: at(5 * MINUTE).toISOString(), at: T0.toISOString() }]);

    // After T0, during the hold: shortened (never before now), then ended now; the batches every Y from it.
    const r = await release({ pace: { batch: 5, minutes: 2 }, holdMinutes: 20 });
    await room(r, 3);
    await advance(r, T0);
    f.clock.set(at(6 * MINUTE));
    expect((await rejects(f.live.shortenHold(r.id, 5, f.admin), 'VALIDATION_FAILED', 400)).message).toBe('A shortened hold ends later than now: END THE HOLD NOW starts the turns at once.');
    expect((await f.live.shortenHold(r.id, 8, f.admin)).pace).toMatchObject({ holdEndsAt: at(8 * MINUTE) });
    f.clock.set(at(7 * MINUTE));
    expect((await f.live.endHold(r.id, f.admin)).pace).toMatchObject({ nextAt: at(7 * MINUTE), holdEndsAt: null });
    expect(await advance(r, at(7 * MINUTE))).toMatchObject({ batch: 1, turns: 3 });
    expect(await pace(r.id)).toMatchObject({ pace_next_at: at(9 * MINUTE) });
    await rejects(f.live.shortenHold(r.id, 0, f.admin), 'LIVE_NO_HOLD', 409);
    expect((await check(r, at(9 * MINUTE))).pass).toBe(true);
    // Never on an after-room.
    const parent = await release({ afterRoom: { modelId: f.modelId, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] } as never });
    await t.db.updateTable('drops').set({ published_at: f.clock.now() }).where('id', '=', parent.afterRoom!.id).execute();
    await rejects(f.live.shortenHold(parent.afterRoom!.id, 0, f.admin), 'LIVE_AFTER_ROOM', 409);
  });

  it('gives a returned, freed, missed or expired piece and ADD PIECES at the next batch, never at once (D5; M1 « W6: … passes to the next person in its size at once »); the entry keeps its place', async () => {
    const r = await release({ pace: { batch: 10, minutes: 5 }, sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 5 }], turnSeconds: 30, payMinutes: 1 });
    const [, , other] = await room(r, 3);
    f.clock.set(at(-30 * SECOND));
    await f.live.changeSize(other!.id, r.id, { sizeId: r.sizes[1]!.id }, other!.actor);
    await advance(r, T0);
    const rows = await entriesOf(t.db, r.id);
    const first = rows.find((e) => e.size_id === r.sizes[0]!.id && e.status === 'TURN')!;
    const second = rows.find((e) => e.size_id === r.sizes[0]!.id && e.status === 'QUEUED')!;
    // Nobody presses: at the deadline both turns are MISSED; the piece of 52 waits for the batch of T0+5.
    expect(await advance(r, at(30 * SECOND))).toMatchObject({ missed: 2, turns: 0 });
    expect((await entriesOf(t.db, r.id)).find((e) => e.id === first.id)).toMatchObject({ status: 'MISSED', position: first.position, admitted_batch: 1, admitted_at: T0, ended_at: at(30 * SECOND) });
    expect((await entriesOf(t.db, r.id)).find((e) => e.id === second.id)!.status).toBe('QUEUED');
    expect(await advance(r, at(5 * MINUTE))).toMatchObject({ batch: 2, turns: 1 });
    expect((await entriesOf(t.db, r.id)).find((e) => e.id === second.id)).toMatchObject({ status: 'TURN', position: second.position, admitted_batch: 2 });
    // A hold that runs out (EXPIRED) and one freed: their pieces at the next batch.
    const later = [await accountOfTier(f, 0), await accountOfTier(f, 0)];
    f.clock.set(at(5 * MINUTE + 5 * SECOND));
    for (const a of later) await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    const token = (await f.live.entry(second.account_id, r.id))!.turn!.token!;
    await f.live.press(second.account_id, r.id, token);
    f.clock.advance(1500);
    await f.live.secure(second.account_id, r.id, token, { type: 'account', id: second.account_id });
    expect(await advance(r, at(6 * MINUTE + 10 * SECOND))).toMatchObject({ expired: 1, turns: 0 });
    expect(await advance(r, at(10 * MINUTE))).toMatchObject({ batch: 3, turns: 1 });
    // ADD PIECES: offered at the next batch, at the release's pace.
    f.clock.set(at(11 * MINUTE));
    await f.live.addPieces(r.id, r.sizes[0]!.id, 1, f.admin);
    const waiting = () => entriesOf(t.db, r.id).then((xs) => xs.filter((e) => e.size_id === r.sizes[0]!.id && e.status === 'QUEUED').length);
    expect(await waiting()).toBe(1);
    expect(await advance(r, at(15 * MINUTE))).toMatchObject({ batch: 4, turns: 1 });
    expect(await waiting()).toBe(0);
    expect((await check(r, at(15 * MINUTE))).pass).toBe(true);
  });

  it('PAUSE holds the batches and RESUME moves the next one by the time paused (D7; M1 « the release’s PAUSE holds the pace »)', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 } });
    await room(r, 4);
    await advance(r, T0);
    f.clock.set(at(2 * MINUTE));
    const paused = await f.live.pause(r.id, f.admin);
    expect(paused.pace).toMatchObject({ batch: 1, minutes: 5, nextAt: at(5 * MINUTE), paused: false, batches: 1, waiting: 3, admitted: 1, turnsGiven: 1, letIn: 0 });
    expect(await advance(r, at(7 * MINUTE))).toMatchObject({ batch: null, turns: 0 });
    f.clock.set(at(8 * MINUTE));
    expect((await f.live.resume(r.id, f.admin)).pace).toMatchObject({ nextAt: at(11 * MINUTE), batches: 1 });
    expect(await advance(r, at(11 * MINUTE - 1))).toMatchObject({ batch: null });
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ batch: 2, turns: 1 });
  });

  it('PAUSE PACE holds the batches, the turns given going on, NEXT BATCH NOW and LET IN still working; RESUME PACE moves the next one; a stretch both pauses held is moved once (D7)', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 } });
    await room(r, 5);
    await rejects(f.live.pausePace(r.id, f.admin), 'LIVE_NOT_STARTED', 409);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    expect((await f.live.pausePace(r.id, f.admin)).pace).toMatchObject({ paused: true, pausedAt: at(MINUTE), nextAt: at(5 * MINUTE) });
    await rejects(f.live.pausePace(r.id, f.admin), 'LIVE_PACE_ALREADY_PAUSED', 409);
    // Under PAUSE PACE: NEXT BATCH NOW gives its extra turn; LET IN gives one.
    expect((await f.live.nextBatch(r.id, f.admin)).pace).toMatchObject({ batches: 2, turnsGiven: 2, nextAt: at(5 * MINUTE) });
    const last = (await entriesOf(t.db, r.id)).at(-1)!;
    expect(await f.live.letIn(r.id, last.id, f.admin)).toMatchObject({ status: 'TURN', batch: 2 });
    f.clock.set(at(2 * MINUTE));
    await f.live.pause(r.id, f.admin);
    f.clock.set(at(3 * MINUTE));
    expect((await f.live.resume(r.id, f.admin)).pace).toMatchObject({ nextAt: at(5 * MINUTE), paused: true });
    expect(await advance(r, at(6 * MINUTE))).toMatchObject({ batch: null });
    f.clock.set(at(7 * MINUTE));
    // Held from 1 to 7: the batch of T0+5 comes at T0+11.
    expect((await f.live.resumePace(r.id, f.admin)).pace).toMatchObject({ nextAt: at(11 * MINUTE), paused: false, pausedAt: null });
    await rejects(f.live.resumePace(r.id, f.admin), 'LIVE_PACE_NOT_PAUSED', 409);
    expect(await advance(r, at(11 * MINUTE))).toMatchObject({ batch: 3, turns: 1 });
    expect((await audits(r.id, 'drop.live.pace.pause')).map((a) => a.details)).toEqual([{ batches: 1 }]);
    expect((await audits(r.id, 'drop.live.pace.resume')).map((a) => a.details)).toEqual([{ pausedMs: 6 * MINUTE, nextAt: at(11 * MINUTE).toISOString() }]);
    f.clock.set(at(12 * MINUTE));
    await f.live.pausePace(r.id, f.admin);
    f.clock.set(at(61 * MINUTE));
    await rejects(f.live.resumePace(r.id, f.admin), 'LIVE_ENDED', 409);
    expect(await audits(r.id, 'drop.live.pace.resume')).toHaveLength(1);
  });

  it('SET PACE slower or faster takes effect from the next batch, which keeps its time; before T0 the first stays at T0 + the hold (D7; M1’s no-pace branch gone); its refusals', async () => {
    const r = await release({ pace: { batch: 1, minutes: 5 }, holdMinutes: 2 });
    await room(r, 12);
    f.clock.set(at(-30 * SECOND));
    expect((await f.live.setPace(r.id, { batch: 2, minutes: 5 }, f.admin)).pace).toMatchObject({ batch: 2, minutes: 5, nextAt: at(2 * MINUTE), batches: 0 });
    expect((await pace(r.id)).pace_next_at).toBeNull();
    expect(await advance(r, at(2 * MINUTE))).toMatchObject({ turns: 2 });
    // Faster (4 a batch) at T0+3: the next batch keeps T0+7 and gives 4.
    f.clock.set(at(3 * MINUTE));
    expect((await f.live.setPace(r.id, { batch: 4, minutes: 5 }, f.admin)).pace).toMatchObject({ batch: 4, nextAt: at(7 * MINUTE) });
    expect(await advance(r, at(7 * MINUTE))).toMatchObject({ turns: 4 });
    // Every 2 minutes from T0+8: the batch of T0+12 keeps its time, the ones after come every 2 minutes; then slower.
    f.clock.set(at(8 * MINUTE));
    await f.live.setPace(r.id, { batch: 4, minutes: 2 }, f.admin);
    expect(await advance(r, at(12 * MINUTE))).toMatchObject({ turns: 4 });
    f.clock.set(at(13 * MINUTE));
    await f.live.setPace(r.id, { batch: 1, minutes: 10 }, f.admin);
    expect(await advance(r, at(14 * MINUTE))).toMatchObject({ turns: 1 });
    expect(await pace(r.id)).toMatchObject({ pace_next_at: at(24 * MINUTE) });
    expect((await audits(r.id, 'drop.live.pace')).map((a) => a.details)).toEqual([
      { before: { batch: 1, minutes: 5 }, after: { batch: 2, minutes: 5 }, nextAt: null },
      { before: { batch: 2, minutes: 5 }, after: { batch: 4, minutes: 5 }, nextAt: at(7 * MINUTE).toISOString() },
      { before: { batch: 4, minutes: 5 }, after: { batch: 4, minutes: 2 }, nextAt: at(12 * MINUTE).toISOString() },
      { before: { batch: 4, minutes: 2 }, after: { batch: 1, minutes: 10 }, nextAt: at(14 * MINUTE).toISOString() },
    ]);
    // Refused: outside the bounds, after the end, by a customer.
    await rejects(f.live.setPace(r.id, { batch: 0, minutes: 5 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 5001, minutes: 5 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 1, minutes: 61 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 1.5, minutes: 5 }, f.admin), 'VALIDATION_FAILED', 400);
    await rejects(f.live.setPace(r.id, { batch: 1, minutes: 5 }, { type: 'account', id: randomUUID() }), 'FORBIDDEN', 403);
    f.clock.set(at(61 * MINUTE));
    await rejects(f.live.setPace(r.id, { batch: 1, minutes: 5 }, f.admin), 'LIVE_ENDED', 409);
    expect((await check(r, at(60 * MINUTE))).pass).toBe(true);
  });

  it('NEXT BATCH NOW gives up to X extra turns where a piece is free, the clock keeping its time; refused when none is free, while PAUSED, before T0 (D6; M1 « NEXT BATCH NOW admits one batch at once »); LET IN as today', async () => {
    const r = await release({ pace: { batch: 2, minutes: 10 }, sizes: [{ label: '52', stock: 5 }], turnSeconds: 300 });
    await room(r, 7);
    await rejects(f.live.nextBatch(r.id, f.admin), 'LIVE_NOT_STARTED', 409);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    expect((await f.live.nextBatch(r.id, f.admin)).pace).toMatchObject({ batches: 2, nextAt: at(10 * MINUTE), waiting: 3, admitted: 4, turnsGiven: 4 });
    expect((await line(r)).slice(0, 4).map((x) => [x[1], x[2], x[3]])).toEqual([
      ['TURN', 1, 0],
      ['TURN', 1, 0],
      ['TURN', 2, MINUTE],
      ['TURN', 2, MINUTE],
    ]);
    expect((await audits(r.id, 'drop.live.pace.next')).map((a) => [a.actor, a.details])).toEqual([['admin', { batch: 2, turns: 2 }]]);
    expect((await audits(r.id, 'drop.live.batch')).map((a) => a.details).at(-1)).toEqual({ batch: 2, at: at(MINUTE).toISOString(), turns: 2, extra: true });
    // One piece left: up to X, so one turn.
    f.clock.set(at(2 * MINUTE));
    expect((await f.live.nextBatch(r.id, f.admin)).pace).toMatchObject({ batches: 3, turnsGiven: 5 });
    // None free: refused, nothing written.
    f.clock.set(at(3 * MINUTE));
    expect((await rejects(f.live.nextBatch(r.id, f.admin), 'LIVE_NOTHING_FREE', 409)).message).toBe('No piece is free for anyone waiting.');
    expect((await pace(r.id)).pace_batches).toBe(3);
    // LET IN: refused with no free piece; while PAUSED, as NEXT BATCH NOW.
    const last = (await entriesOf(t.db, r.id)).at(-1)!;
    await rejects(f.live.letIn(r.id, last.id, f.admin), 'LIVE_NO_FREE_PIECE', 409);
    await f.live.pause(r.id, f.admin);
    await rejects(f.live.nextBatch(r.id, f.admin), 'LIVE_PAUSED', 409);
    await rejects(f.live.letIn(r.id, last.id, f.admin), 'LIVE_PAUSED', 409);
    await f.live.resume(r.id, f.admin);
    await f.live.addPieces(r.id, r.sizes[0]!.id, 1, f.admin);
    expect(await f.live.letIn(r.id, last.id, f.admin)).toMatchObject({ status: 'TURN', letIn: true, admittedAt: at(3 * MINUTE), batch: 3 });
    expect((await audits(r.id, 'drop.live.let_in')).map((a) => a.details)).toEqual([{ entryId: last.id, position: 7, admitted: true }]);
    expect((await check(r, at(3 * MINUTE))).pass).toBe(true);
  });

  it('gives at most one batch per published frame (D9): after a restart the first batch waits for the first frame, and 5 overdue slots go one per frame, each with its slot’s time and number; the PACE check green', async () => {
    const r = await release({ pace: { batch: 2, minutes: 1 } });
    await room(r, 14);
    const before = process();
    // No frame published since the start: the batch of T0 waits for one.
    expect(await advance(r, T0, before.live)).toMatchObject({ batch: null, waiting: true, turns: 0 });
    before.frame(r);
    expect(await advance(r, T0, before.live)).toMatchObject({ batch: 1, turns: 2 });
    // The engine down from T0 + 30 s until T0 + 5 min 10 s: a new process, 5 slots overdue (T0+1 … T0+5).
    const after = process();
    const when = at(5 * MINUTE + 10 * SECOND);
    expect(await advance(r, when, after.live)).toMatchObject({ batch: null, waiting: true });
    for (let k = 1; k <= 5; k++) {
      after.frame(r);
      expect(await advance(r, when, after.live)).toMatchObject({ batch: k + 1, turns: 2 });
      // A second pass within the same frame gives nothing.
      expect(await advance(r, when, after.live)).toMatchObject({ batch: null, waiting: k < 5 });
    }
    expect((await line(r)).filter((x) => x[2] !== null).map((x) => [x[2], x[3]])).toEqual(
      [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5].map((k, i) => [Math.floor(i / 2) + 1, k * MINUTE]),
    );
    // Their turns run from when they went, about a second apart in production.
    expect((await entriesOf(t.db, r.id)).slice(2, 12).every((e) => e.turn_at!.getTime() === when.getTime())).toBe(true);
    expect(await pace(r.id)).toMatchObject({ pace_batches: 6, pace_next_at: at(6 * MINUTE) });
    expect(await check(r, when)).toMatchObject({ pass: true, line: '6 batches admitted 12 entries at 2 every 1 min, each on its time and in the line’s order.' });
  });

  it('waits for the next frame with a NEXT BATCH NOW pressed in the frame of another batch (D9): checked at once, given after the frame with its press time; two presses within a second, two frames', async () => {
    const r = await release({ pace: { batch: 1, minutes: 1 }, turnSeconds: 300 });
    await room(r, 6);
    const p = process();
    p.frame(r);
    expect(await advance(r, T0, p.live)).toMatchObject({ batch: 1, turns: 1 });
    p.frame(r);
    // The batch of T0 + 1, then a press in the same frame.
    expect(await advance(r, at(MINUTE), p.live)).toMatchObject({ batch: 2, turns: 1 });
    f.clock.set(at(MINUTE + 300));
    let answered = false;
    const pressed = p.live.nextBatch(r.id, f.admin).then((s) => {
      answered = true;
      return s;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(answered).toBe(false);
    expect((await pace(r.id)).pace_batches).toBe(2);
    // Its frame: given at once after it, stamped with the press time.
    f.clock.set(at(MINUTE + 800));
    p.frame(r);
    expect((await pressed).pace).toMatchObject({ batches: 3, nextAt: at(2 * MINUTE) });
    expect((await entriesOf(t.db, r.id)).find((e) => e.admitted_batch === 3)).toMatchObject({ admitted_at: at(MINUTE + 300), turn_at: at(MINUTE + 800) });
    // Two presses within a second after a frame: the first at once, the second after the next frame.
    p.frame(r);
    f.clock.set(at(MINUTE + 1200));
    const first = await p.live.nextBatch(r.id, f.admin);
    expect(first.pace).toMatchObject({ batches: 4 });
    f.clock.set(at(MINUTE + 1500));
    const second = p.live.nextBatch(r.id, f.admin);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await pace(r.id)).pace_batches).toBe(4);
    p.frame(r);
    expect((await second).pace).toMatchObject({ batches: 5 });
    expect((await entriesOf(t.db, r.id)).find((e) => e.admitted_batch === 5)!.admitted_at).toEqual(at(MINUTE + 1500));
    // The refusals are checked at once, whatever the frame: a release PAUSED.
    f.clock.set(at(MINUTE + 1600));
    await p.live.pause(r.id, f.admin);
    await rejects(p.live.nextBatch(r.id, f.admin), 'LIVE_PAUSED', 409);
    await p.live.resume(r.id, f.admin);
    expect((await audits(r.id, 'drop.live.pace.next')).map((a) => a.details.batch)).toEqual([3, 4, 5]);
    expect((await check(r, at(MINUTE + 1600))).pass).toBe(true);
  });

  it('G2 (PLAN amendment 1): after a restart, an overdue batch after the first waits until every phone it reaches has READ that it is next, a frame not being enough; each keeps its slot’s time and number; an absent phone holds it 60 s at most after the previous batch', async () => {
    const r = await release({ pace: { batch: 2, minutes: 1 } });
    await room(r, 10);
    const before = process({ readings: true });
    before.frame(r);
    // The first batch never waits for readings: everyone has waited for it (T0, or the hold's end).
    expect(await advance(r, T0, before.live)).toMatchObject({ batch: 1, turns: 2 });
    // The phones read: the 3rd and 4th are next, the 5th and 6th behind (a 10 to 60 s cadence).
    expect([await before.read(r, 3), await before.read(r, 4), await before.read(r, 5), await before.read(r, 6)]).toEqual([true, true, false, false]);
    // The engine down from T0 + 30 s until T0 + 3 min 10 s: a new process, 3 slots overdue (T0+1, +2, +3), no reading in it yet.
    const after = process({ readings: true });
    const when = at(3 * MINUTE + 10 * SECOND);
    after.frame(r);
    expect(await advance(r, when, after.live)).toMatchObject({ batch: null, waiting: true, turns: 0 });
    // The 3rd reads (its stream back): the 4th has not yet, the batch still waits, frames or not.
    expect(await after.read(r, 3)).toBe(true);
    after.frame(r);
    expect(await advance(r, when, after.live)).toMatchObject({ batch: null, waiting: true });
    expect(await after.read(r, 4)).toBe(true);
    expect(await advance(r, when, after.live)).toMatchObject({ batch: 2, turns: 2 });
    // The next slot (T0 + 2) reaches the 5th and 6th, who last read that they were behind: a fresh frame is not enough.
    after.frame(r);
    expect(await advance(r, when, after.live)).toMatchObject({ batch: null, waiting: true });
    expect([await after.read(r, 5), await after.read(r, 6)]).toEqual([true, true]);
    expect(await advance(r, when, after.live)).toMatchObject({ batch: 3, turns: 2 });
    // The slot of T0 + 3 reaches the 7th and 8th, whose phones are away: it waits up to 60 s after the batch before it.
    after.frame(r);
    expect(await advance(r, at(3 * MINUTE + 69 * SECOND), after.live)).toMatchObject({ batch: null, waiting: true });
    expect(await advance(r, at(3 * MINUTE + 70 * SECOND), after.live)).toMatchObject({ batch: 4, turns: 2 });
    // Each with its slot's time and number; the PACE check green.
    expect((await line(r)).filter((x) => x[2] !== null).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 2, MINUTE],
      [4, 2, MINUTE],
      [5, 3, 2 * MINUTE],
      [6, 3, 2 * MINUTE],
      [7, 4, 3 * MINUTE],
      [8, 4, 3 * MINUTE],
    ]);
    // What the phones read: every turn of batches 2 and 3 went to a phone that had read that it was next.
    expect(await turnsRead(r, after.readings, 6)).toBe('every turn read');
    expect((await check(r, at(3 * MINUTE + 70 * SECOND))).pass).toBe(true);
  });

  it('G2: NEXT BATCH NOW pressed twice right after a scheduled batch waits each time until the phones it reaches have READ that they are next, then goes with its press time and number', async () => {
    const r = await release({ pace: { batch: 1, minutes: 1 }, turnSeconds: 300 });
    await room(r, 6);
    const p = process({ readings: true });
    p.frame(r);
    expect(await advance(r, T0, p.live)).toMatchObject({ batch: 1, turns: 1 });
    // The 2nd has read that it is next: the scheduled batch of T0 + 1 goes after the frame.
    f.clock.set(at(30 * SECOND));
    expect([await p.read(r, 2), await p.read(r, 3)]).toEqual([true, false]);
    p.frame(r);
    expect(await advance(r, at(MINUTE), p.live)).toMatchObject({ batch: 2, turns: 1 });
    // A press right after it: its frame comes, but the 3rd last read that it was behind.
    f.clock.set(at(MINUTE + 300));
    const first = p.live.nextBatch(r.id, f.admin);
    expect(await settledWithin(first)).toBe(false);
    p.frame(r);
    expect(await settledWithin(first)).toBe(false);
    expect((await pace(r.id)).pace_batches).toBe(2);
    // Its phone reads that it is next (its next reading): the press goes, with its press time.
    f.clock.set(at(MINUTE + 900));
    expect(await p.read(r, 3)).toBe(true);
    expect((await first).pace).toMatchObject({ batches: 3, nextAt: at(2 * MINUTE) });
    expect((await entriesOf(t.db, r.id)).find((e) => e.admitted_batch === 3)).toMatchObject({ position: 3, admitted_at: at(MINUTE + 300), turn_at: at(MINUTE + 900) });
    // Pressed again at once: it waits for a frame, then for the 4th to read that it is next.
    f.clock.set(at(MINUTE + 1000));
    const second = p.live.nextBatch(r.id, f.admin);
    p.frame(r);
    expect(await settledWithin(second)).toBe(false);
    f.clock.set(at(MINUTE + 1800));
    expect(await p.read(r, 4)).toBe(true);
    expect((await second).pace).toMatchObject({ batches: 4 });
    expect((await entriesOf(t.db, r.id)).find((e) => e.admitted_batch === 4)).toMatchObject({ position: 4, admitted_at: at(MINUTE + 1000), turn_at: at(MINUTE + 1800) });
    expect((await audits(r.id, 'drop.live.pace.next')).map((a) => a.details)).toEqual([{ batch: 3, turns: 1 }, { batch: 4, turns: 1 }]);
    expect(await turnsRead(r, p.readings)).toBe('every turn read');
    expect((await check(r, at(MINUTE + 1800))).pass).toBe(true);
  });

  it('G2: a phone at the back of the line reading every 60 s is never given a turn before it has read that it is next: two quick presses, the second waiting for its reading, not for the cap', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 }, turnSeconds: 300 });
    await room(r, 8);
    const p = process({ readings: true });
    p.frame(r);
    expect(await advance(r, T0, p.live)).toMatchObject({ batch: 1, turns: 2 });
    // At T0 every phone reads: the 3rd and 4th are next (they follow the stream), the 5th to 8th behind (every 60 s).
    for (const position of [3, 4, 5, 6, 7, 8]) await p.read(r, position);
    expect(p.readings.map((x) => x.next)).toEqual([true, true, false, false, false, false]);
    // NEXT BATCH NOW at T0 + 10 s reaches the 3rd and 4th, who have read it: given after its frame.
    f.clock.set(at(10 * SECOND));
    const first = p.live.nextBatch(r.id, f.admin);
    p.frame(r);
    expect((await first).pace).toMatchObject({ batches: 2 });
    // Pressed again at T0 + 11 s: it reaches the 5th and 6th, whose last reading (T0) said they were behind.
    f.clock.set(at(11 * SECOND));
    const second = p.live.nextBatch(r.id, f.admin);
    p.frame(r);
    expect(await settledWithin(second)).toBe(false);
    f.clock.set(at(40 * SECOND));
    expect(await settledWithin(second)).toBe(false);
    // Their 60 s cadence: they read at T0 + 60 s, before the cap (T0 + 70 s, 60 s after the batch before): given then.
    f.clock.set(at(60 * SECOND));
    expect(await p.read(r, 5)).toBe(true);
    expect(await settledWithin(second)).toBe(false);
    expect(await p.read(r, 6)).toBe(true);
    expect((await second).pace).toMatchObject({ batches: 3 });
    expect((await entriesOf(t.db, r.id)).filter((e) => e.admitted_batch === 3).map((e) => [e.position, e.admitted_at, e.turn_at])).toEqual([
      [5, at(11 * SECOND), at(60 * SECOND)],
      [6, at(11 * SECOND), at(60 * SECOND)],
    ]);
    // The 7th and 8th then read nothing (away): a third press waits 60 s after the batch before it, then goes.
    f.clock.set(at(61 * SECOND));
    const third = p.live.nextBatch(r.id, f.admin);
    p.frame(r);
    f.clock.set(at(119 * SECOND));
    expect(await settledWithin(third)).toBe(false);
    f.clock.set(at(120 * SECOND));
    expect((await third).pace).toMatchObject({ batches: 4 });
    expect(await turnsRead(r, p.readings, 6)).toBe('every turn read');
    expect((await check(r, at(120 * SECOND))).pass).toBe(true);
  });

  it('gives a set’s turns by the set rule within the cap (macro scope K44 T1)', async () => {
    const ring = await sizedModel(t.db, 'HALO', ['52', '54']);
    const chain = await sizedModel(t.db, 'LINEA', ['45', '50'], 'NECKLACE');
    const setId = await createSet(f, [ring, chain]);
    f.clock.set('2026-11-04T09:00:00.000Z');
    const r = await createSetLiveRelease(f, { setId, opensAt: T0, pace: { batch: 2, minutes: 1 }, turnSeconds: 300, sizes: [{ piece: 1, label: '52', stock: 5 }, { piece: 2, label: '45', stock: 5 }] });
    f.clock.set(at(-MINUTE));
    const people = [];
    for (let i = 0; i < 3; i++) {
      const a = await accountOfTier(f, 0);
      await f.live.enter(a.id, r.id, { sizes: [{ piece: 1, sizeId: pieceSize(r, 1, '52') }, { piece: 2, sizeId: pieceSize(r, 2, '45') }] }, a.actor);
      people.push(a);
    }
    f.clock.set(T0);
    expect(await f.live.advance(r.id)).toMatchObject({ batch: 1, turns: 2 });
    f.clock.set(at(MINUTE));
    expect(await f.live.advance(r.id)).toMatchObject({ batch: 2, turns: 1 });
    expect(people).toHaveLength(3);
  });

  it('reads the console’s figures (D10, D11; M1 « the console’s live board », « … the console’s entries and the export with the admission »): in the queue, given a turn all ways, by the pace and by LET IN, the batches, the next batch, the hold, beyond the pieces, the close guard; each entry’s batch; the export; the report’s queue', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 }, sizes: [{ label: '52', stock: 3 }] });
    const people = await room(r, 6);
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ batch: 2, minutes: 5, nextAt: T0, paused: false, batches: 0, waiting: 0, admitted: 0, beyond: 0, holdMinutes: 0, holdEndsAt: null });
    await advance(r, T0);
    const board = (await f.liveConsole.board(r.id))!;
    // In the queue 4: places 1 to 4 in size 52 against 3 pieces not confirmed: the 4th is beyond the pieces.
    expect(board.pace).toEqual({
      batch: 2,
      minutes: 5,
      nextAt: at(5 * MINUTE),
      pausedAt: null,
      paused: false,
      batches: 1,
      waiting: 4,
      admitted: 2,
      turnsGiven: 2,
      letIn: 0,
      holdMinutes: 0,
      holdEndsAt: null,
      beyond: 1,
      // 11 batches before the close (T0+5 … T0+55), 22 turns for 3 pieces: none left.
      closeGuard: null,
    });
    expect(board.sizes.map((s) => [s.label, s.beyond])).toEqual([['52', 1]]);
    expect(board.totals.beyond).toBe(1);
    expect(board.line.map((e) => [e.position, e.batch, e.beyond])).toEqual([
      [1, 1, false],
      [2, 1, false],
      [3, null, false],
      [4, null, false],
      [5, null, false],
      [6, null, true],
    ]);
    const listed = await f.liveConsole.entries(r.id, {}, { page: 1, pageSize: 10 });
    expect(listed.items.map((e) => [e.position, e.batch, e.admittedAt, e.beyond])).toEqual([
      [1, 1, T0, false],
      [2, 1, T0, false],
      [3, null, null, false],
      [4, null, null, false],
      [5, null, null, false],
      [6, null, null, true],
    ]);
    // The export: when its turn was given, never a batch's figures.
    const rows = await entriesOf(t.db, r.id);
    expect((await accountLiveData(t.db, rows[0]!.account_id)).entries[0]).toMatchObject({ admittedAt: T0, queuedAt: T0 });
    expect((await accountLiveData(t.db, rows[5]!.account_id)).entries[0]!.admittedAt).toBeNull();
    // The close guard: a pace too slow for the pieces left.
    const slow = await release({ pace: { batch: 1, minutes: 30 }, sizes: [{ label: '52', stock: 10 }] });
    expect((await f.liveConsole.board(slow.id))!.pace!.closeGuard).toEqual({ remain: 8 });
    // The report: the longest wait, the turns given by the pace, the people who left the queue.
    f.clock.set(at(2 * MINUTE));
    const leaver = people.find((p) => p.id === rows[3]!.account_id)!;
    await f.live.leave(leaver.id, r.id, leaver.actor);
    f.clock.set(at(3 * MINUTE));
    const report = await new LiveInsightsService({ db: t.db, clock: f.clock.now }).report(r.id);
    expect(report.queue).toEqual({ longestWaitMs: 3 * MINUTE, turnsByPace: 2, leftQueue: 1 });
    // After the end, the figures stand; PAUSE PACE's mark.
    f.clock.set(at(4 * MINUTE));
    await f.live.pausePace(r.id, f.admin);
    expect((await f.liveConsole.board(r.id))!.pace).toMatchObject({ paused: true, pausedAt: at(4 * MINUTE), waiting: 3 });
  });

  it('gives 20 batches of 250 turns to 5 000 entries, each in the line’s order at its time (M1 « admits 5 000 entries in 20 batches of 250 »: more pieces than entrants)', async () => {
    const r = await release({ pace: { batch: 250, minutes: 1 }, sizes: [{ label: '52', stock: 6000 }], closesAt: at(120 * MINUTE) });
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
    expect(await advance(r, T0)).toMatchObject({ queued: N, batch: 1, turns: 250 });
    for (let k = 1; k < 20; k++) expect(await advance(r, at(k * MINUTE))).toMatchObject({ batch: k + 1, turns: 250 });
    expect(await advance(r, at(20 * MINUTE))).toMatchObject({ batch: 21, turns: 0 });
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
    expect(await check(r, at(20 * MINUTE))).toEqual({
      id: 'PACE',
      label: 'The pace',
      pass: true,
      line: '20 batches admitted 5000 entries at 250 every 1 min, each on its time and in the line’s order.',
    });
  }, 180_000);

  it('the TEST REPORT’s PACE check passes on the engine’s history: batches, NEXT BATCH NOW, LET IN, the release’s PAUSE, SET PACE, a late arrival, empty batches, the hold ended', async () => {
    const r = await release({ pace: { batch: 2, minutes: 5 }, holdMinutes: 3, turnSeconds: 300 });
    await room(r, 10);
    await advance(r, T0);
    f.clock.set(at(MINUTE));
    await f.live.nextBatch(r.id, f.admin);
    f.clock.set(at(2 * MINUTE));
    const last = (await entriesOf(t.db, r.id)).at(-1)!;
    await f.live.letIn(r.id, last.id, f.admin);
    await advance(r, at(3 * MINUTE));
    f.clock.set(at(6 * MINUTE));
    await f.live.pause(r.id, f.admin);
    f.clock.set(at(8 * MINUTE));
    await f.live.resume(r.id, f.admin);
    await advance(r, at(10 * MINUTE));
    f.clock.set(at(13 * MINUTE));
    await f.live.setPace(r.id, { batch: 3, minutes: 2 }, f.admin);
    const late = await accountOfTier(f, 0);
    f.clock.set(at(14 * MINUTE));
    await f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor);
    await advance(r, at(15 * MINUTE));
    await advance(r, at(17 * MINUTE));
    await advance(r, at(25 * MINUTE));
    expect((await line(r)).map((x) => [x[0], x[2], x[3]])).toEqual([
      [1, 1, MINUTE],
      [2, 1, MINUTE],
      [3, 2, 3 * MINUTE],
      [4, 2, 3 * MINUTE],
      [5, 3, 10 * MINUTE],
      [6, 3, 10 * MINUTE],
      [7, 4, 15 * MINUTE],
      [8, 4, 15 * MINUTE],
      [9, 4, 15 * MINUTE],
      [10, 1, 2 * MINUTE],
      [11, 5, 17 * MINUTE],
    ]);
    expect(await check(r, at(25 * MINUTE))).toEqual({
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
    holdMinutes: 0,
    entries: [1, 2, 3, 4, 5].map((p) => ({
      id: `e${p}`,
      position: p,
      guaranteed: false,
      sizeId: 's52',
      quantity: 1,
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

  it('too many in a batch (« too few while others waited » needs the free pieces of each batch: step Q1.4’s check, N5)', () => {
    const f = facts();
    f.entries[2] = { ...f.entries[2]!, admittedAt: T0, batch: 1 };
    f.events[0] = { kind: 'BATCH', at: T0, batch: 1, entries: 3, extra: false, recordedAt: T0 };
    f.events[1] = { kind: 'BATCH', at: at(5 * MINUTE), batch: 2, entries: 1, extra: false, recordedAt: at(5 * MINUTE) };
    expect(lineOf(f)).toBe('Batch 1 admitted 3, more than the 2 of the pace.');
  });

  it('a batch out of the line’s order within a size; the house’s guarantee first; another size, or a place wanting more pieces, may be passed over', () => {
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
    // Place 2 in another size (none free there), or wanting two pieces: place 3 may go before it.
    for (const ahead of [{ sizeId: 's54' }, { quantity: 2 }]) {
      const k = facts();
      k.entries[1] = { ...k.entries[1]!, ...ahead, admittedAt: at(5 * MINUTE), batch: 2 };
      k.entries[2] = { ...k.entries[2]!, admittedAt: T0, batch: 1 };
      expect(lineOf(k)).toMatch(/^PASS /);
    }
  });

  it('a batch before its time (T0 + the hold for the first) or off the pace (« a batch skipped while people waited » needs the free pieces: step Q1.4’s check)', () => {
    const f = facts();
    for (const e of f.entries.slice(2, 4)) e.admittedAt = at(4 * MINUTE);
    f.events[1] = { kind: 'BATCH', at: at(4 * MINUTE), batch: 2, entries: 2, extra: false, recordedAt: at(4 * MINUTE) };
    expect(lineOf(f)).toBe('Batch 2 came at 11:04:00 PARIS, before its time, 11:05:00 PARIS.');
    const g = facts();
    for (const e of g.entries.slice(2, 4)) e.admittedAt = at(6 * MINUTE);
    g.events[1] = { kind: 'BATCH', at: at(6 * MINUTE), batch: 2, entries: 2, extra: false, recordedAt: at(6 * MINUTE) };
    expect(lineOf(g)).toBe('Batch 2 came at 11:06:00 PARIS, off the pace of every 5 min.');
    // A hold of 3 minutes: the first batch at T0 is before its time.
    expect(lineOf({ ...facts(), holdMinutes: 3 })).toBe('Batch 1 came at 11:00:00 PARIS, before its time, 11:03:00 PARIS.');
  });
});
