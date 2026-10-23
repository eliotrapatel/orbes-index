/**
 * The LIVE RELEASES' load test of the one queue (scripts/live-load.ts --one-queue; ONE QUEUE, lot Q1 §1.5, D14): its
 * options within the console's bounds (the pace, the hold), the batches a level needs, and the two judges of a run, the
 * batches on the server against the plan and the one queue on the phones (every one served, each after the first batch
 * having read « next » (G2), none reading the pace (D8)). The run itself is a measurement (docs/reports/live-load.md),
 * not a test.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_PACE_BATCH, LIVE_PACE_MINUTES } from '../../src/server/db/schema.js';
import { LIVE_ROOM_OPENS_MINUTES } from '../../src/server/services/live.js';
import { LIVE_HOLD_MINUTES } from '../../src/server/db/schema.js';
import { entryBurstSeconds, ONE_QUEUE_STOCK_SHARE, PACED_ROOM_MINUTES, pacedBatchesProblem, pacePlan, parseArgs, parseFootprint, parsePace, peakPerSecond, queueVerdict, releaseTimes, type PacedBatch, type QueuePhone } from '../../scripts/live-load.js';

const T0 = Date.parse('2026-10-21T17:00:00.000Z');
const MIN = 60_000;

describe('live-load --one-queue', () => {
  it('reads X,Y within the console’s bounds, and refuses anything else', () => {
    expect(parsePace('250,1')).toEqual({ batch: 250, minutes: 1 });
    expect(parsePace(' 40 , 5 ')).toEqual({ batch: 40, minutes: 5 });
    expect(parsePace(`${LIVE_PACE_BATCH.max},${LIVE_PACE_MINUTES.max}`)).toEqual({ batch: LIVE_PACE_BATCH.max, minutes: LIVE_PACE_MINUTES.max });
    for (const bad of [undefined, '', '250', '250,', ',1', '0,1', '250,0', `${LIVE_PACE_BATCH.max + 1},1`, `250,${LIVE_PACE_MINUTES.max + 1}`, '2.5,1', '-1,1', '250;1']) {
      expect(() => parsePace(bad), String(bad)).toThrow(/--pace is X,Y/);
    }
    expect(parseArgs(['--pace', '250,1', '--levels', '5000'])).toMatchObject({ pace: { batch: 250, minutes: 1 }, levels: [5000], holdMinutes: 0 });
    expect(parseArgs([]).pace).toBeNull();
    expect(() => parseArgs(['--pace'])).toThrow(/--pace is X,Y/);
  });

  it('runs the one queue: 250 turns every minute unless --pace says otherwise, a hold within the console’s bounds (D14: the 5,000 proof)', () => {
    expect(parseArgs(['--one-queue', '--levels', '5000'])).toMatchObject({ pace: { batch: 250, minutes: 1 }, holdMinutes: 0, levels: [5000] });
    expect(parseArgs(['--one-queue', '--pace', '100,2', '--hold', '2'])).toMatchObject({ pace: { batch: 100, minutes: 2 }, holdMinutes: 2 });
    expect(parseArgs(['--hold', `${LIVE_HOLD_MINUTES.max}`, '--one-queue']).holdMinutes).toBe(LIVE_HOLD_MINUTES.max);
    for (const bad of ['-1', `${LIVE_HOLD_MINUTES.max + 1}`, '1.5', 'x']) expect(() => parseArgs(['--one-queue', '--hold', bad]), bad).toThrow(/--hold is the hold after the opening/);
    expect(() => parseArgs(['--hold', '2'])).toThrow(/--hold needs --one-queue/);
    // More pieces than entrants in each of the three sizes, as the runbook's run A.
    expect(3 * ONE_QUEUE_STOCK_SHARE).toBeGreaterThan(1);
  });

  it('opens the paced door as the house does: the console’s default room, the entries over its first minutes', () => {
    expect(PACED_ROOM_MINUTES).toBe(LIVE_ROOM_OPENS_MINUTES.default);
    expect(entryBurstSeconds(parseArgs(['--pace', '250,1']))).toBe((PACED_ROOM_MINUTES - 1) * 60);
    expect(entryBurstSeconds(parseArgs([]))).toBe(10);
    expect(entryBurstSeconds(parseArgs(['--pace', '250,1', '--burst-seconds', '30']))).toBe(30);
    // The streams come over two minutes before the room for 5 000; a paced release has no after-room (the run measures
    // the queue), where a release without a pace keeps the room of a minute and its after-room.
    expect(releaseTimes(parseArgs(['--pace', '250,1']), 5000)).toEqual({ leadMs: 120_000, roomMinutes: PACED_ROOM_MINUTES, afterRoom: false });
    expect(releaseTimes(parseArgs(['--pace', '75,1']), 150)).toEqual({ leadMs: 10_000, roomMinutes: PACED_ROOM_MINUTES, afterRoom: false });
    expect(releaseTimes(parseArgs([]), 1000)).toEqual({ leadMs: 10_000, roomMinutes: 1, afterRoom: true });
  });

  it('plans the batches a level needs: the first at T0 + the hold, every Y minutes, the last the rest', () => {
    expect(pacePlan(5000, { batch: 250, minutes: 1 }, T0)).toEqual({ batches: 20, lastBatchAt: T0 + 19 * MIN, lastBatchSize: 250, spanMs: 19 * MIN });
    expect(pacePlan(5100, { batch: 250, minutes: 2 }, T0)).toEqual({ batches: 21, lastBatchAt: T0 + 40 * MIN, lastBatchSize: 100, spanMs: 40 * MIN });
    expect(pacePlan(100, { batch: 250, minutes: 1 }, T0)).toEqual({ batches: 1, lastBatchAt: T0, lastBatchSize: 100, spanMs: 0 });
    // After a hold of 2 minutes: the first batch at T0 + 2.
    expect(pacePlan(5000, { batch: 250, minutes: 1 }, T0 + 2 * MIN)).toMatchObject({ batches: 20, lastBatchAt: T0 + 21 * MIN });
  });

  it('holds the batches on the server to exactly X turns every Y from the first (T0 + the hold), on their logical times, and names the first fault', () => {
    const pace = { batch: 250, minutes: 1 };
    const exact: PacedBatch[] = Array.from({ length: 20 }, (_, i) => ({ batch: i + 1, at: T0 + i * MIN, entries: 250, recordedAt: T0 + i * MIN + 400 }));
    expect(pacedBatchesProblem(exact, 5000, pace, T0)).toBeNull();
    // In any order the log gives them.
    expect(pacedBatchesProblem([...exact].reverse(), 5000, pace, T0)).toBeNull();
    // The last batch admits the rest.
    const rest = exact.slice(0, 19).concat({ batch: 20, at: T0 + 19 * MIN, entries: 100, recordedAt: T0 + 19 * MIN + 400 });
    expect(pacedBatchesProblem(rest, 4850, pace, T0)).toBeNull();

    expect(pacedBatchesProblem(exact.slice(0, 19), 5000, pace, T0)).toBe('19 batches recorded, 20 expected.');
    expect(pacedBatchesProblem(exact.map((b) => (b.batch === 7 ? { ...b, entries: 249 } : b)), 5000, pace, T0)).toBe('Batch 7 gave 249 turns, 250 expected.');
    expect(pacedBatchesProblem(exact.map((b) => (b.batch === 3 ? { ...b, at: b.at + 1 } : b)), 5000, pace, T0)).toBe('Batch 3 came 1 ms after its time (the first + 2 min).');
    // After a hold of 2 minutes, the same batches are 2 minutes early.
    expect(pacedBatchesProblem(exact, 5000, pace, T0 + 2 * MIN)).toBe('Batch 1 came 120000 ms before its time (the first + 0 min).');
    expect(pacedBatchesProblem(exact.map((b) => (b.batch === 20 ? { ...b, batch: 21 } : b)), 5000, pace, T0)).toBe('Batch 21 recorded where batch 20 was expected.');
  });

  it('reads the one queue on the phones: every one served, each turn after the first batch read « next » first (G2), no figure of the pace (D8), the first estimate’s error and the turn’s delivery', () => {
    const later = T0 + MIN / 2;
    const phone = (q: Partial<QueuePhone>): QueuePhone => ({ waited: false, firstEstimate: null, lastPlace: null, lastNext: null, turnAt: null, turnSeenAt: null, leaks: 0, ...q });
    const phones = [
      // Never waited (its turn at T0 before a reading of the queue).
      phone({ turnAt: T0, turnSeenAt: T0 + 100 }),
      // The first batch: G2 does not hold for it (everyone has waited for it), read 300 ms after.
      phone({ waited: true, firstEstimate: T0, lastPlace: 4, lastNext: false, turnAt: T0 + 200, turnSeenAt: T0 + 500 }),
      // Batch 2: read « next » first, estimated 2 s late, read 450 ms after.
      phone({ waited: true, firstEstimate: T0 + MIN - 2000, lastPlace: 1, lastNext: true, turnAt: T0 + MIN, turnSeenAt: T0 + MIN + 450 }),
    ];
    expect(queueVerdict(phones, later)).toEqual({ waited: 2, served: 2, unread: 0, leaks: 0, estimateError: [200, 2000], delivery: [300, 450] });
    // A later batch reaching a phone whose last reading said « not next »; a reading with more than its own figures; one that waited and was never served.
    const faulty = queueVerdict(
      [...phones, phone({ waited: true, firstEstimate: T0 + 2 * MIN, lastNext: false, turnAt: T0 + 2 * MIN, turnSeenAt: T0 + 2 * MIN + 100, leaks: 1 }), phone({ waited: true, lastNext: true })],
      later,
    );
    expect(faulty).toMatchObject({ waited: 4, served: 3, unread: 1, leaks: 1 });
  });

  it('counts the most state reads within one second (W2: the phones behind the next batch read their state instead of a stream)', () => {
    expect(peakPerSecond([])).toBe(0);
    expect(peakPerSecond([T0, T0 + 999, T0 + 1000, T0 + 1500, T0 + 1999, T0 + 5000])).toBe(3);
  });

  it('reads macOS footprint’s header and its reclaimable memory, in MiB (the app\'s memory beside its resident size)', () => {
    const out = [
      '======================================================================',
      'node [72234]: 64-bit    Footprint: 1.5 GB (16384 bytes per page)',
      '======================================================================',
      '',
      '  Dirty      Clean  Reclaimable    Regions    Category',
      '    ---        ---          ---        ---    ---',
      ' 412 MB        0 B       256 MB         34    MALLOC_SMALL',
      '4288 KB        0 B       512 KB          1    app-specific tag 16',
      ' 158 KB        0 B          0 B         54    __DATA',
      '',
      'Auxiliary data:',
      '    phys_footprint: 1.5 GB',
      '    phys_footprint_peak: 1700 MB',
    ].join('\n');
    expect(parseFootprint(out)).toEqual({ footprintMib: 1536, peakMib: 1700, reclaimableMib: 256.5 });
    expect(parseFootprint(out.split('\nAuxiliary')[0]!)).toMatchObject({ peakMib: null });
    expect(parseFootprint('footprint: no process')).toBeNull();
  });
});
