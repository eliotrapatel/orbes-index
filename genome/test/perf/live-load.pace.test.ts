/**
 * The LIVE RELEASES' load test with a pace (scripts/live-load.ts --pace, plan of 2026-10-20 §1.5, W2 and W4): its option
 * within the console's bounds, the batches a level needs, and the two judges of a paced run, the batches on the server
 * against the plan and the queue on the phones. The run itself is a measurement (docs/reports/live-load.md), not a test.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_PACE_BATCH, LIVE_PACE_MINUTES } from '../../src/server/db/schema.js';
import { LIVE_ROOM_OPENS_MINUTES } from '../../src/server/services/live.js';
import { entryBurstSeconds, PACED_ROOM_MINUTES, pacedBatchesProblem, pacePlan, parseArgs, parseFootprint, parsePace, peakPerSecond, queueVerdict, releaseTimes, type PacedBatch, type QueuePhone } from '../../scripts/live-load.js';

const T0 = Date.parse('2026-10-21T17:00:00.000Z');
const MIN = 60_000;

describe('live-load --pace', () => {
  it('reads X,Y within the console’s bounds, and refuses anything else', () => {
    expect(parsePace('250,1')).toEqual({ batch: 250, minutes: 1 });
    expect(parsePace(' 40 , 5 ')).toEqual({ batch: 40, minutes: 5 });
    expect(parsePace(`${LIVE_PACE_BATCH.max},${LIVE_PACE_MINUTES.max}`)).toEqual({ batch: LIVE_PACE_BATCH.max, minutes: LIVE_PACE_MINUTES.max });
    for (const bad of [undefined, '', '250', '250,', ',1', '0,1', '250,0', `${LIVE_PACE_BATCH.max + 1},1`, `250,${LIVE_PACE_MINUTES.max + 1}`, '2.5,1', '-1,1', '250;1']) {
      expect(() => parsePace(bad), String(bad)).toThrow(/--pace is X,Y/);
    }
    expect(parseArgs(['--pace', '250,1', '--levels', '5000'])).toMatchObject({ pace: { batch: 250, minutes: 1 }, levels: [5000] });
    expect(parseArgs([]).pace).toBeNull();
    expect(() => parseArgs(['--pace'])).toThrow(/--pace is X,Y/);
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

  it('plans the batches a level needs: the first at T0, every Y minutes, the last the rest', () => {
    expect(pacePlan(5000, { batch: 250, minutes: 1 }, T0)).toEqual({ batches: 20, lastBatchAt: T0 + 19 * MIN, lastBatchSize: 250, spanMs: 19 * MIN });
    expect(pacePlan(5100, { batch: 250, minutes: 2 }, T0)).toEqual({ batches: 21, lastBatchAt: T0 + 40 * MIN, lastBatchSize: 100, spanMs: 40 * MIN });
    expect(pacePlan(100, { batch: 250, minutes: 1 }, T0)).toEqual({ batches: 1, lastBatchAt: T0, lastBatchSize: 100, spanMs: 0 });
  });

  it('holds the batches on the server to exactly X every Y, on their times, and names the first fault', () => {
    const pace = { batch: 250, minutes: 1 };
    const exact: PacedBatch[] = Array.from({ length: 20 }, (_, i) => ({ batch: i + 1, at: T0 + i * MIN, entries: 250, recordedAt: T0 + i * MIN + 400 }));
    expect(pacedBatchesProblem(exact, 5000, pace, T0)).toBeNull();
    // In any order the log gives them.
    expect(pacedBatchesProblem([...exact].reverse(), 5000, pace, T0)).toBeNull();
    // The last batch admits the rest.
    const rest = exact.slice(0, 19).concat({ batch: 20, at: T0 + 19 * MIN, entries: 100, recordedAt: T0 + 19 * MIN + 400 });
    expect(pacedBatchesProblem(rest, 4850, pace, T0)).toBeNull();

    expect(pacedBatchesProblem(exact.slice(0, 19), 5000, pace, T0)).toBe('19 batches recorded, 20 expected.');
    expect(pacedBatchesProblem(exact.map((b) => (b.batch === 7 ? { ...b, entries: 249 } : b)), 5000, pace, T0)).toBe('Batch 7 admitted 249, 250 expected.');
    expect(pacedBatchesProblem(exact.map((b) => (b.batch === 3 ? { ...b, at: b.at + 1 } : b)), 5000, pace, T0)).toBe('Batch 3 came at T0 + 120001 ms, T0 + 120000 ms expected.');
    expect(pacedBatchesProblem(exact.map((b) => (b.batch === 20 ? { ...b, batch: 21 } : b)), 5000, pace, T0)).toBe('Batch 21 recorded where batch 20 was expected.');
  });

  it('reads the queue on the phones: admitted, in the line’s order, at the time first estimated, and how long it took to reach them', () => {
    const pace = { batch: 2, minutes: 1 };
    const phone = (q: Partial<QueuePhone>): QueuePhone => ({ waited: false, firstEta: null, lastPlace: null, waitingFor: null, admittedSeenAt: null, admittedFor: null, ...q });
    const phones = [
      // The first batch, admitted at T0 without waiting.
      phone({}),
      phone({}),
      // Batch 2: places 1 and 2 after the first, estimated at T0 + 1 min, read 300 and 450 ms after it.
      phone({ waited: true, firstEta: T0 + MIN, lastPlace: 1, waitingFor: T0 + MIN, admittedSeenAt: T0 + MIN + 300, admittedFor: T0 + MIN }),
      phone({ waited: true, firstEta: T0 + MIN, lastPlace: 2, waitingFor: T0 + MIN, admittedSeenAt: T0 + MIN + 450, admittedFor: T0 + MIN }),
      // Batch 3, its first estimate a minute off.
      phone({ waited: true, firstEta: T0 + MIN, lastPlace: 1, waitingFor: T0 + 2 * MIN, admittedSeenAt: T0 + 2 * MIN + 200, admittedFor: T0 + 2 * MIN }),
    ];
    expect(queueVerdict(phones, pace)).toEqual({ waited: 3, admitted: 3, orderBroken: 0, etaKept: 2, batchesSeen: 2, delivery: [300, 450, 200] });

    // A phone let in from a place beyond X breaks the line's order; one that waited and was never let in is not admitted.
    const broken = queueVerdict([...phones, phone({ waited: true, lastPlace: 3, waitingFor: T0 + 2 * MIN, admittedSeenAt: T0 + 2 * MIN + 100, admittedFor: T0 + 2 * MIN }), phone({ waited: true, lastPlace: 1, waitingFor: T0 + 3 * MIN })], pace);
    expect(broken).toMatchObject({ waited: 5, admitted: 4, orderBroken: 1 });
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
