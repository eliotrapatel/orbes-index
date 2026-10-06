/**
 * The console's intelligence on the LIVE RELEASES (services/live-insights.ts; plan of 2026-10-04, The console ›
 * Intelligence), on fixtures whose figures are worked out by hand in each test:
 *
 *  - the rules, pure: the audience forecast (from the interest, from each tier's eligible accounts, without a basis,
 *    capped by the rule, above the room's capacity), the release planner (the quantity and its size mix), the demand
 *    radar (pressure, rounds, expected sell-out, ADD PIECES with the quantity line), exactly three live alerts and none
 *    falsely, the live sell-out forecast (each outlook), the bot radar (each sign), the release report and its CSV, the
 *    collector insights, the release comparison; each with its reasoning;
 *  - the reads, on PGlite: the eligible accounts by tier under a rule (tier, models, collection; a locked account and an
 *    ended or revoked piece left out), the sizes of their pieces of the model's type, a past release run end to end by the
 *    live service and read back (its show-up, its demand, a repeat collector), the bot radar's network and new account,
 *    the line stalled when the engine stops and cleared once it runs, ADD PIECES in the report, the comparison.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apportion,
  audienceForecast,
  botRadar,
  collectorInsights,
  compareReleases,
  count,
  demandRadar,
  duration,
  LIVE_ALERT_KINDS,
  LIVE_HOUSE_RING_MS,
  LIVE_INSIGHT_RULES,
  LIVE_ROOM_CAPACITY,
  LiveInsightsService,
  liveAlerts,
  lineRates,
  median,
  releasePlan,
  releaseReport,
  releaseReportCsv,
  sellOutForecast,
  summarize,
  utc,
  type BotEntryFacts,
  type InsightEntry,
  type InsightRelease,
  type LineRates,
} from '../../src/server/services/live-insights.js';
import { OrderService } from '../../src/server/services/orders.js';
import { liveNetworkHash, LIVE_GESTURE_MIN_MS } from '../../src/server/services/live.js';
import { HOLD_MS } from '../../src/web/verify/live-model.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, createCollection, createLiveRelease, createModel, holdPieces, liveFixture, type LiveFixture } from '../support/live.js';

const T0 = new Date('2026-11-02T10:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(T0.getTime() + ms);

const release = (o: Partial<InsightRelease> = {}): InsightRelease => ({
  id: 'r',
  title: 'THE MONOLITHE RING',
  opensAt: T0,
  closesAt: at(HOUR),
  roomOpensAt: at(-5 * MINUTE),
  endedAt: null,
  endedReason: null,
  pausedAt: null,
  pausedMs: 0,
  turnSeconds: 30,
  payMinutes: 5,
  perAccount: 1,
  priceMinor: 480_000,
  currency: 'EUR',
  quantityLine: '5 PIECES · NEVER MORE',
  sizes: [
    { id: 's52', label: '52', stock: 3 },
    { id: 's54', label: '54', stock: 2 },
  ],
  ...o,
});

let seq = 0;
/** An entry in the line at T0 by default (its place its number). */
const entry = (o: Partial<InsightEntry> = {}): InsightEntry => {
  seq++;
  return {
    id: `e${seq}`,
    accountId: `a${seq}`,
    sizeId: 's52',
    quantity: 1,
    status: 'QUEUED',
    tier: 0,
    position: seq,
    joinedAt: at(-MINUTE),
    queuedAt: T0,
    turnAt: null,
    turnExpiresAt: null,
    securedAt: null,
    holdExpiresAt: null,
    confirmedAt: null,
    endedAt: null,
    gestureMs: null,
    resolution: null,
    country: null,
    ...o,
  };
};
/** In the room before T0. */
const waiting = (o: Partial<InsightEntry> = {}) => entry({ status: 'WAITING', position: null, queuedAt: null, ...o });
const confirmed = (turn: number, secured: number, paid: number, o: Partial<InsightEntry> = {}) =>
  entry({ status: 'CONFIRMED', turnAt: at(turn), turnExpiresAt: at(turn + 30 * SECOND), securedAt: at(secured), holdExpiresAt: at(secured + 5 * MINUTE), confirmedAt: at(paid), gestureMs: 1500, ...o });
const missed = (turn: number, o: Partial<InsightEntry> = {}) => entry({ status: 'MISSED', turnAt: at(turn), turnExpiresAt: at(turn + 30 * SECOND), endedAt: at(turn + 30 * SECOND), ...o });

describe('the intelligence: figures and words', () => {
  it('reads the holds against the house\'s own ring and the server\'s floor', () => {
    expect(LIVE_HOUSE_RING_MS).toBe(HOLD_MS);
    expect(LIVE_INSIGHT_RULES.gestureFloorMs).toBeGreaterThan(LIVE_GESTURE_MIN_MS);
    expect(LIVE_INSIGHT_RULES.gestureFloorMs).toBeLessThan(HOLD_MS);
  });

  it('counts, shares out and times as the console writes them', () => {
    expect(apportion(50, [40, 20])).toEqual([33, 17]);
    expect(apportion(5, [1, 1, 1])).toEqual([2, 2, 1]);
    expect(apportion(4, [0, 0])).toEqual([2, 2]);
    expect(apportion(0, [3, 1])).toEqual([0, 0]);
    expect(median([5, 1, 3, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(duration(35_000)).toBe('35 s');
    expect(duration(245_000)).toBe('4 min 05 s');
    expect(duration(3_720_000)).toBe('1 h 02 min');
    expect(utc(at(5 * SECOND))).toBe('02 NOV 2026 · 10:00:05 UTC');
  });
});

describe('the audience forecast', () => {
  const pastA = { title: 'A', interest: 80, presentAtT0: 60, presentByTier: [40, 10, 6, 4], eligibleByTier: [400, 100, 40, 10] };
  const pastB = { title: 'B', interest: 50, presentAtT0: 45, presentByTier: [30, 10, 5, 0], eligibleByTier: [300, 100, 40, 10] };

  it('reads the interest at the share past releases held at T0, the eligible accounts as a cross-check', () => {
    const f = audienceForecast({ interest: 100, eligibleByTier: [500, 200, 50, 10], past: [pastA, pastB], inRoom: null });
    // 60 / 80 = 0.75 and 45 / 50 = 0.9 of the interest: 75 to 90.
    expect(f).toMatchObject({ basis: 'INTEREST', low: 75, high: 90, expected: 83, eligible: 760, aboveCapacity: false, capacity: LIVE_ROOM_CAPACITY.inRoom, pastReleases: 2 });
    expect(f.reasoning[0]).toContain('100 collectors said I\'LL BE THERE. In 2 past releases, the line at T0 held 75 % to 90 % of the interest: 75 to 90.');
    // 45 / 450 = 10 % and 60 / 550 = 11 % of 760.
    expect(f.reasoning.join(' ')).toContain('(10 % to 11 %) give 76 to 83');
    expect(f.reasoning.join(' ')).toContain(`Within the ${count(LIVE_ROOM_CAPACITY.inRoom)} in the room the load test measured the server to hold.`);
  });

  it('assumes half to all of the interest without a past release, and says when it passes the room the server holds', () => {
    const f = audienceForecast({ interest: 1500, eligibleByTier: [3000, 0, 0, 0], past: [], inRoom: 12 });
    expect(f).toMatchObject({ basis: 'INTEREST', low: 750, high: 1500, expected: 1125, aboveCapacity: true, inRoom: 12 });
    expect(f.reasoning.join(' ')).toContain(`The upper end, 1\u2009500, is above the ${count(LIVE_ROOM_CAPACITY.inRoom)} in the room the load test measured the server to hold.`);
    expect(f.reasoning.at(-1)).toBe('In the room now: 12 people.');
  });

  it('before any interest, reads each tier at its own share at T0 (all tiers pooled for a tier without one)', () => {
    const past = [
      { title: 'P1', interest: 0, presentAtT0: 130, presentByTier: [80, 40, 10, 0], eligibleByTier: [800, 80, 20, 0] },
      { title: 'P2', interest: 0, presentAtT0: 95, presentByTier: [50, 30, 15, 0], eligibleByTier: [1000, 100, 25, 0] },
    ];
    const f = audienceForecast({ interest: 0, eligibleByTier: [1000, 100, 20, 5], past, inRoom: null });
    // no tier: 5 % to 10 % of 1 000; TITANE 30 % to 50 % of 100; PLATINE 50 % to 60 % of 20; PALLADIUM (none in the
    // past) at all tiers' 95 / 1 125 to 130 / 900 of 5: 90.42 to 162.72.
    expect(f).toMatchObject({ basis: 'ELIGIBLE', low: 90, high: 163, expected: 127, eligible: 1125 });
    expect(f.reasoning[0]).toContain('PALLADIUM 5 at 8 % to 14 % (all tiers)');
  });

  it('has no basis without interest nor past release, and never forecasts more than the rule lets in', () => {
    expect(audienceForecast({ interest: 0, eligibleByTier: [7, 2, 0, 0], past: [], inRoom: null })).toMatchObject({ basis: 'NONE', low: 0, high: 9, expected: 5 });
    const capped = audienceForecast({ interest: 100, eligibleByTier: [60, 0, 0, 0], past: [], inRoom: null });
    expect(capped).toMatchObject({ low: 50, high: 60, expected: 55 });
    expect(capped.reasoning.join(' ')).toContain('Never more than the 60 accounts the rule lets in.');
  });
});

describe('the release planner', () => {
  const forecast = audienceForecast({ interest: 100, eligibleByTier: [500, 200, 50, 10], past: [], inRoom: null });

  it('suggests the forecast × the pieces asked per person, shared by size by interest and the collectors\' sizes', () => {
    const f = { ...forecast, expected: 83 };
    const plan = releasePlan({
      sizes: release().sizes,
      forecast: f,
      past: [
        { presentAtT0: 60, demandPieces: 30 },
        { presentAtT0: 45, demandPieces: 33 },
      ],
      interestBySize: new Map([
        ['s52', 30],
        ['s54', 10],
      ]),
      collectorsBySize: new Map([
        ['52', 10],
        ['54', 10],
        ['56', 4],
      ]),
      modelType: 'RING',
    });
    // 63 / 105 = 0.60 a person; 83 × 0.60 = 49.8 → 50; weights 40 and 20 → 33.3 and 16.7 → 33 and 17.
    expect(plan.demandPerPerson).toBeCloseTo(0.6, 10);
    expect(plan).toMatchObject({ quantity: 50, pastReleases: 2, otherSizes: [{ label: '56', collectors: 4 }] });
    expect(plan.sizes.map((s) => [s.label, s.interest, s.collectors, s.suggested])).toEqual([
      ['52', 30, 10, 33],
      ['54', 10, 10, 17],
    ]);
    expect(plan.reasoning.join(' ')).toContain('83 × 0.60 = 50 pieces');
    expect(plan.reasoning.join(' ')).toContain('(52: 40, 54: 20)');
    expect(plan.reasoning.join(' ')).toContain('this release does not offer: 56: 4.');
  });

  it('assumes half a piece a person without a past release, and suggests nothing without an audience', () => {
    const none = audienceForecast({ interest: 0, eligibleByTier: [3, 0, 0, 0], past: [], inRoom: null });
    const plan = releasePlan({ sizes: release().sizes, forecast: none, past: [], interestBySize: new Map(), collectorsBySize: new Map(), modelType: 'RING' });
    expect(plan.demandPerPerson).toBe(LIVE_INSIGHT_RULES.defaultDemandPerPerson);
    expect(plan.quantity).toBeNull();
    expect(plan.sizes.every((s) => s.suggested === null)).toBe(true);
    expect(plan.reasoning).toContain('No audience to forecast yet: no quantity is suggested.');
  });
});

describe('the demand radar', () => {
  it('before the room: the interest per size, every turn assumed confirmed, ADD PIECES with the quantity line', () => {
    const interest = [3, 3, 2, 1, 0, 0, 0].map((tier) => ({ sizeId: 's52', tier })).concat([{ sizeId: 's54', tier: 1 }]);
    const r = demandRadar({ release: release(), room: [], interest, past: null, now: at(-HOUR) });
    expect(r).toMatchObject({ roomOpen: false, formed: false, interest: 8, stock: 5, conversion: 1, sellOutAt: null });
    const [s52, s54] = r.sizes;
    // 7 for 3: one round, the seal after 15 s and PAY after 2 min 30 s: T0 + 2 min 45 s; twice the stock: 4 more.
    expect(s52).toMatchObject({ demand: 7, pressure: 7 / 3, sellsOut: true, sellOutAt: at(165 * SECOND), expectedSold: 3, addPieces: 4 });
    expect(s54).toMatchObject({ demand: 1, sellsOut: false, sellOutAt: null, expectedSold: 1, addPieces: null });
    expect(r.byTier).toEqual([
      { tier: 0, interest: 3, inRoom: 0 },
      { tier: 1, interest: 2, inRoom: 0 },
      { tier: 2, interest: 1, inRoom: 0 },
      { tier: 3, interest: 2, inRoom: 0 },
    ]);
    const words = r.reasoning.join(' ');
    expect(words).toContain('adding 4 in 52 would serve it. The announcement says « 5 PIECES · NEVER MORE »');
    expect(words).toContain('T0 + 2 min 45 s');
  });

  it('once the room is open: the room\'s pieces at the past conversion, in rounds of a turn each', () => {
    const past: LineRates = { turns: 10, turnsEnded: 10, secured: 8, holdsEnded: 8, confirmed: 4, secureRate: 0.8, payRate: 0.5, secureDelayMs: 12 * SECOND, payDelayMs: MINUTE };
    const room = [...Array.from({ length: 4 }, () => waiting({ sizeId: 's52', tier: 2 })), ...Array.from({ length: 6 }, () => waiting({ sizeId: 's54' }))];
    const r = demandRadar({ release: release(), room, interest: [], past, now: at(-MINUTE) });
    // 0.8 × 0.5 = 0.4: three rounds; 12 s + 60 s + 2 × 30 s = 2 min 12 s.
    expect(r).toMatchObject({ roomOpen: true, inRoom: 10, conversion: 0.4 });
    expect(r.sizes[0]).toMatchObject({ demand: 4, sellsOut: false, expectedSold: 1, addPieces: null });
    expect(r.sizes[1]).toMatchObject({ demand: 6, sellsOut: true, sellOutAt: at(132 * SECOND), addPieces: null });
    expect(r.byTier.find((t) => t.tier === 2)!.inRoom).toBe(4);
  });
});

describe('the live alerts: exactly three', () => {
  const now = at(10 * MINUTE);
  const none = { resumedAt: null, stockAt: null };

  it('names its three kinds', () => {
    expect(LIVE_ALERT_KINDS).toEqual(['SIZE_SOLD_OUT', 'MISSED_WAVE', 'LINE_STALLED']);
  });

  it('a size sells out at its last confirmation', () => {
    const entries = [confirmed(0, 20 * SECOND, 2 * MINUTE, { sizeId: 's54' }), confirmed(0, 30 * SECOND, 3 * MINUTE, { sizeId: 's54' }), entry({ sizeId: 's54' })];
    const alerts = liveAlerts(release(), entries, none, now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'SIZE_SOLD_OUT', size: { id: 's54', label: '54' }, since: at(3 * MINUTE), text: 'Size 54 is sold out.' });
    expect(alerts[0]!.reasoning).toEqual(['Its 2 pieces are all confirmed, the last at 02 NOV 2026 · 10:03:00 UTC.', '1 person still waits in this size, in case ADD PIECES serves them.']);
    // A size of one piece is said in the singular.
    const one = liveAlerts(release({ sizes: [{ id: 's52', label: '52', stock: 1 }] }), [confirmed(0, 20 * SECOND, 2 * MINUTE, { sizeId: 's52' })], none, now);
    expect(one[0]!.reasoning).toEqual(['Its one piece is confirmed, at 02 NOV 2026 · 10:02:00 UTC.', 'Nobody waits in this size.']);
  });

  it('a wave: five turns missed in two minutes, half the turns that ended or more', () => {
    const wave = [8.5, 9, 9.2, 9.5, 9.6].map((m) => missed(m * MINUTE - 30 * SECOND, { sizeId: 's52' }));
    const one = entry({ status: 'SECURED', turnAt: at(9 * MINUTE), turnExpiresAt: at(9.5 * MINUTE), securedAt: at(9 * MINUTE + 10 * SECOND), holdExpiresAt: at(15 * MINUTE), gestureMs: 1500 });
    const alerts = liveAlerts(release({ sizes: [{ id: 's52', label: '52', stock: 1 }] }), [...wave, one], none, now);
    expect(alerts.map((a) => a.kind)).toEqual(['MISSED_WAVE']);
    expect(alerts[0]).toMatchObject({ since: at(8.5 * MINUTE), text: '5 turns missed in 2 min.' });
    expect(alerts[0]!.reasoning[0]).toBe('In the last 2 min, 6 turns ended: 5 ran out, 1 secured, 0 left or removed (83 % missed).');
    // Six secured in the same time: five missed is less than half.
    const secured = Array.from({ length: 6 }, () => confirmed(9 * MINUTE, 9 * MINUTE + 5 * SECOND, 9.5 * MINUTE));
    expect(liveAlerts(release({ sizes: [{ id: 's52', label: '52', stock: 20 }] }), [...wave, ...secured], none, now).filter((a) => a.kind === 'MISSED_WAVE')).toHaveLength(0);
    // Four is not a wave.
    expect(liveAlerts(release(), wave.slice(1), none, now).filter((a) => a.kind === 'MISSED_WAVE')).toHaveLength(0);
  });

  it('a line stalled while pieces are free: a turn due ten seconds and none given', () => {
    const turn = entry({ status: 'TURN', sizeId: 's52', turnAt: at(9 * MINUTE), turnExpiresAt: at(11 * MINUTE) });
    const next = entry({ sizeId: 's52', position: 7 });
    const alerts = liveAlerts(release(), [turn, next], none, now);
    expect(alerts.map((a) => [a.kind, a.size?.label, a.since])).toEqual([['LINE_STALLED', '52', at(9 * MINUTE)]]);
    expect(alerts[0]!.text).toBe('The line of size 52 has stalled for 1 min.');
    expect(alerts[0]!.reasoning[0]).toBe('2 pieces free in size 52, 1 person in its line, and place 7 could take it: no turn has begun since 02 NOV 2026 · 10:09:00 UTC.');
    // A RESUME five seconds ago: the turn is due since then, not yet a stall.
    expect(liveAlerts(release(), [turn, next], { resumedAt: at(10 * MINUTE - 5 * SECOND), stockAt: null }, now)).toEqual([]);
    // Paused, ended, or before T0: no turn is due.
    expect(liveAlerts(release({ pausedAt: at(9.5 * MINUTE) }), [turn, next], none, now)).toEqual([]);
    expect(liveAlerts(release(), [turn, next], none, at(-MINUTE))).toEqual([]);
  });

  it('a turn the engine did not mark frees its piece at its deadline: stalled ten seconds after it', () => {
    const lapsed = entry({ status: 'TURN', sizeId: 's54', turnAt: at(9 * MINUTE), turnExpiresAt: at(9 * MINUTE + 30 * SECOND) });
    const head = entry({ sizeId: 's54', position: 9 });
    const r = release({ sizes: [{ id: 's54', label: '54', stock: 1 }] });
    expect(liveAlerts(r, [lapsed, head], none, at(9 * MINUTE + 39 * SECOND))).toEqual([]);
    expect(liveAlerts(r, [lapsed, head], none, at(9 * MINUTE + 40 * SECOND)).map((a) => [a.kind, a.since])).toEqual([['LINE_STALLED', at(9 * MINUTE + 30 * SECOND)]]);
    // A head that wants more than the size can ever give is passed over, as the engine does: nothing is due.
    const big = entry({ sizeId: 's54', position: 9, quantity: 2 });
    expect(liveAlerts(r, [lapsed, big], none, at(11 * MINUTE))).toEqual([]);
  });

  it('a busy line does not hide a stopped engine: arrivals and departures behind the head leave its clock where it was', () => {
    const r = release({ sizes: [{ id: 's52', label: '52', stock: 2 }] });
    const stalled = (entries: InsightEntry[]) => liveAlerts(r, entries, none, now).map((a) => [a.kind, a.since]);
    const head = entry({ position: 1 });
    // A late arrival every five seconds for ten minutes, each behind the head: no turn is given, the line is stalled since T0.
    const arrivals = Array.from({ length: 120 }, (_, i) => entry({ position: 2 + i, joinedAt: at((i + 1) * 5 * SECOND), queuedAt: at((i + 1) * 5 * SECOND) }));
    const alerts = liveAlerts(r, [head, ...arrivals], none, now);
    expect(alerts.map((a) => [a.kind, a.since])).toEqual([['LINE_STALLED', T0]]);
    expect(alerts[0]!.text).toBe('The line of size 52 has stalled for 10 min.');
    // One behind the head left its place a second ago: still stalled since T0.
    expect(stalled([head, entry({ status: 'LEFT', position: 200, endedAt: at(10 * MINUTE - SECOND) })])).toEqual([['LINE_STALLED', T0]]);
    // What makes the head's turn due does move it: a place ahead left, a turn that ran out, a confirmation passing over a
    // place ahead that wants more than the size can still give (a confirmation alone does not).
    expect(stalled([entry({ status: 'LEFT', position: 0, endedAt: at(10 * MINUTE - 5 * SECOND) }), head])).toEqual([]);
    expect(stalled([missed(10 * MINUTE - 35 * SECOND), head])).toEqual([]);
    const paid = confirmed(MINUTE, MINUTE + 10 * SECOND, 10 * MINUTE - 5 * SECOND);
    expect(stalled([head, paid])).toEqual([['LINE_STALLED', at(MINUTE)]]);
    expect(stalled([entry({ position: 0, quantity: 2 }), head, paid])).toEqual([]);
  });
});

describe('the live sell-out forecast', () => {
  const none = { resumedAt: null };
  const entries = () => [
    confirmed(0, MINUTE, 2 * MINUTE),
    entry({ status: 'SECURED', turnAt: at(3 * MINUTE), turnExpiresAt: at(3.5 * MINUTE), securedAt: at(4 * MINUTE), holdExpiresAt: at(9 * MINUTE), gestureMs: 1500 }),
    missed(0),
    ...Array.from({ length: 5 }, () => entry()),
  ];

  it('per size, from the pace secured and the line it can still serve; overall', () => {
    const f = sellOutForecast(release(), entries(), none, at(5 * MINUTE))!;
    // 52: two secured in 5 min (0.4 a minute), every hold confirmed so far: 2 to confirm in 5 min; the line can give
    // 1 + 5 × 2/3 = 4.3. 54: nobody to serve it.
    expect(f.sizes.map((s) => [s.size.label, s.outlook, s.at, s.expectedLeft, s.remaining])).toEqual([
      ['52', 'SELLS_OUT', at(10 * MINUTE), null, 2],
      ['54', 'LINE_SHORT', null, 2, 2],
    ]);
    expect(f).toMatchObject({ outlook: 'PARTIAL', expectedLeft: 2, windowMs: 5 * MINUTE, secureRate: 2 / 3, payRate: 1 });
    expect(f.sizes[0]!.reasoning[0]).toBe(
      '2 pieces to confirm; the line can still give 4 (1 held, 0 in a turn, 5 waiting, at those shares). At 0.4 secured a minute, 0.4 confirmed: sold out about 02 NOV 2026 · 10:10:00 UTC.',
    );
  });

  it('the close first, no pace yet, paused; none before T0 or after the end', () => {
    const close = sellOutForecast(release({ closesAt: at(8 * MINUTE) }), entries(), none, at(5 * MINUTE))!;
    expect(close.sizes[0]).toMatchObject({ outlook: 'CLOSE_FIRST', expectedLeft: 1 });
    expect(sellOutForecast(release(), entries(), none, at(20 * SECOND))!.sizes[0]!.outlook).toBe('NO_PACE');
    expect(sellOutForecast(release({ pausedAt: at(4 * MINUTE) }), entries(), none, at(5 * MINUTE))!.sizes[0]).toMatchObject({ outlook: 'NO_PACE' });
    expect(sellOutForecast(release(), entries(), none, at(-MINUTE))).toBeNull();
    expect(sellOutForecast(release({ endedAt: at(MINUTE), endedReason: 'ENDED' }), entries(), none, at(5 * MINUTE))).toBeNull();
    const done = [confirmed(0, 10 * SECOND, MINUTE, { sizeId: 's54' }), confirmed(0, 10 * SECOND, 2 * MINUTE, { sizeId: 's54' })];
    expect(sellOutForecast(release({ sizes: [{ id: 's54', label: '54', stock: 2 }] }), done, none, at(3 * MINUTE))).toMatchObject({ outlook: 'SOLD_OUT', at: at(2 * MINUTE) });
  });

  it('after a RESUME, the pace runs from it: a pause that has ended is not time on sale', () => {
    // Paused from 10:06 to 10:09 (3 min), read at 10:10, sales until 10:13. In 52: a piece secured at 10:05:30 (before
    // the pause) and confirmed, one secured at 10:09:30 and held, five waiting.
    const r = release({ closesAt: at(13 * MINUTE), pausedMs: 3 * MINUTE });
    const xs = [
      confirmed(5 * MINUTE, 5.5 * MINUTE, 5.8 * MINUTE),
      entry({ status: 'SECURED', turnAt: at(9 * MINUTE + 10 * SECOND), turnExpiresAt: at(9 * MINUTE + 40 * SECOND), securedAt: at(9.5 * MINUTE), holdExpiresAt: at(14.5 * MINUTE), gestureMs: 1500 }),
      ...Array.from({ length: 5 }, () => entry()),
    ];
    const f = sellOutForecast(r, xs, { resumedAt: at(9 * MINUTE) }, at(10 * MINUTE))!;
    // The window starts at the RESUME, not at 10:05: 1 min of sales and 1 piece secured in it, 1 a minute; 2 to confirm
    // in 52 at every hold confirmed so far: sold out about 10:12, before the close. (Read over 10:05–10:10 with the pause
    // in it, the pace would be 2 in 5 min, 0.4 a minute: the close first.)
    expect(f).toMatchObject({ windowMs: MINUTE, secureRate: 1, payRate: 1 });
    expect(f.sizes.map((z) => [z.size.label, z.outlook, z.pace, z.at, z.expectedLeft])).toEqual([
      ['52', 'SELLS_OUT', 1, at(12 * MINUTE), null],
      ['54', 'LINE_SHORT', 0, null, 2],
    ]);
    expect(f.reasoning[0]).toBe('The pace: the pieces secured since 02 NOV 2026 · 10:09:00 UTC, the latest RESUME (1 min of sales, the pause before it left out).');
    expect(f.sizes[0]!.reasoning[0]).toBe(
      '2 pieces to confirm; the line can still give 6 (1 held, 0 in a turn, 5 waiting, at those shares). At 1.0 secured a minute, 1.0 confirmed: sold out about 02 NOV 2026 · 10:12:00 UTC.',
    );
    // A RESUME before the window changes nothing: the last 5 min, 2 secured in them.
    expect(sellOutForecast(r, xs, { resumedAt: at(4 * MINUTE) }, at(10 * MINUTE))!).toMatchObject({ windowMs: 5 * MINUTE, sizes: [{ pace: 0.4, outlook: 'CLOSE_FIRST' }, {}] });
    // Just resumed: no pace yet.
    const fresh = sellOutForecast(r, xs, { resumedAt: at(9.9 * MINUTE) }, at(10 * MINUTE))!;
    expect(fresh.windowMs).toBe(6 * SECOND);
    expect(fresh.sizes[0]!.reasoning[0]).toContain('no pace to forecast from: the sales have run less than 30 s since the RESUME.');
    // Paused again at 10:09:30: the 30 s since the RESUME, that pause left out too.
    const again = sellOutForecast({ ...r, pausedAt: at(9.5 * MINUTE) }, xs, { resumedAt: at(9 * MINUTE) }, at(10 * MINUTE))!;
    expect(again.windowMs).toBe(30 * SECOND);
    expect(again.reasoning[0]).toBe('The pace: the pieces secured since 02 NOV 2026 · 10:09:00 UTC, the latest RESUME (30 s of sales, the pause before it and the pause running now left out).');
  });
});

describe('the bot radar', () => {
  it('flags a very new account, a crowded network and machine-regular holds, the most signs first', () => {
    const r = release();
    const made = (e: InsightEntry, o: Partial<BotEntryFacts> = {}): BotEntryFacts => ({ entry: e, email: `${e.accountId}@example.com`, accountCreatedAt: at(-30 * 24 * HOUR), network: null, gestures: [], ...o });
    const facts = [
      made(entry({ position: 1 }), { accountCreatedAt: at(-MINUTE - 2 * HOUR) }),
      made(entry({ position: 5 }), { network: 'aa', accountCreatedAt: at(-MINUTE - HOUR) }),
      made(entry({ position: 3 }), { network: 'aa' }),
      made(entry({ position: 4 }), { network: 'aa' }),
      made(entry({ position: 6 }), { network: 'bb' }),
      made(entry({ position: 7 }), { network: 'bb' }),
      made(entry({ position: 8, status: 'CONFIRMED', gestureMs: 1420 }), { gestures: [1420] }),
      made(entry({ position: 9, status: 'MISSED' }), { gestures: [1503, 1511, 1508] }),
      made(entry({ position: 10 }), { gestures: [1500, 1520, 1530] }),
    ];
    const radar = botRadar(r, facts);
    expect(radar).toMatchObject({ entries: 9, flagged: 6, bySign: { NEW_ACCOUNT: 2, NETWORK: 3, GESTURE_FLOOR: 1, GESTURE_REPEAT: 1 }, networks: [{ group: 1, entries: 3 }] });
    expect(radar.items.map((x) => [x.position, x.signs, x.open])).toEqual([
      [5, ['NEW_ACCOUNT', 'NETWORK'], true],
      [1, ['NEW_ACCOUNT'], true],
      [3, ['NETWORK'], true],
      [4, ['NETWORK'], true],
      [8, ['GESTURE_FLOOR'], false],
      [9, ['GESTURE_REPEAT'], false],
    ]);
    expect(radar.items[0]!.reasons).toEqual(['Account created 1 h before it entered.', 'One of 3 entries from network 1.']);
    expect(radar.items.at(-1)!.reasons).toEqual(['3 holds across releases within 8 ms of each other (1\u2009503, 1\u2009511, 1\u2009508 ms).']);
    expect(radar.reasoning.join(' ')).toContain('erased 30 days after the end');
  });
});

/** A release that ended CLOSED with one piece of 54 unsold, worked by hand in the report's test. */
function reportFixture() {
  const r = release({ endedAt: at(HOUR), endedReason: 'CLOSED', pausedMs: 0 });
  const e = {
    e1: confirmed(0, 20 * SECOND, MINUTE, { id: 'x1', accountId: 'p1', tier: 3, resolution: 'CONCLUDED', country: 'FR', position: 1 }),
    // Confirmed, then cancelled by ORBES Client Services: no revenue, its add-on neither.
    e2: confirmed(0, 25 * SECOND, 2 * MINUTE, { id: 'x2', accountId: 'p2', tier: 2, resolution: 'CANCELLED', country: 'FR', position: 2 }),
    e3: missed(0, { id: 'x3', accountId: 'p3', tier: 1, position: 3 }),
    e4: confirmed(30 * SECOND, 50 * SECOND, 4 * MINUTE, { id: 'x4', accountId: 'p4', tier: 0, country: 'GB', position: 4 }),
    e5: entry({ id: 'x5', accountId: 'p5', status: 'ENDED', position: 5, endedAt: at(HOUR) }),
    e6: entry({ id: 'x6', accountId: 'p6', sizeId: 's54', tier: 1, status: 'EXPIRED', position: 6, turnAt: at(0), turnExpiresAt: at(30 * SECOND), securedAt: at(10 * SECOND), holdExpiresAt: at(5 * MINUTE + 10 * SECOND), endedAt: at(5 * MINUTE + 10 * SECOND), gestureMs: 1500 }),
    e7: confirmed(5 * MINUTE + 10 * SECOND, 5 * MINUTE + 20 * SECOND, 6 * MINUTE, { id: 'x7', accountId: 'p7', sizeId: 's54', position: 7 }),
    e8: entry({ id: 'x8', accountId: 'p8', sizeId: 's54', status: 'LEFT', position: 8, endedAt: at(20 * MINUTE) }),
    e9: entry({ id: 'x9', accountId: 'p9', sizeId: 's54', status: 'LEFT', position: null, queuedAt: null, endedAt: at(-2 * MINUTE) }),
  };
  return { r, entries: Object.values(e) };
}

describe('the release report', () => {
  it('every figure, the funnel, the additions and next time\'s mix, worked by hand', () => {
    const { r, entries } = reportFixture();
    const rep = releaseReport({
      release: r,
      entries,
      interest: 12,
      addons: [
        { id: 'eng', label: 'ENGRAVING' },
        { id: 'box', label: 'GIFT BOX' },
      ],
      entryAddons: [
        { entryId: 'x1', addonId: 'eng', priceMinor: 15_000 },
        { entryId: 'x2', addonId: 'eng', priceMinor: 15_000 },
        { entryId: 'x7', addonId: 'eng', priceMinor: 15_000 },
        { entryId: 'x7', addonId: 'box', priceMinor: 0 },
        // An add-on of a hold that ended is not revenue.
        { entryId: 'x6', addonId: 'eng', priceMinor: 15_000 },
      ],
      additions: [{ at: at(2 * MINUTE), sizeId: 's52', size: '52', pieces: 1, before: 2, after: 3 }],
      over: true,
    });
    expect(rep.funnel).toEqual([
      { step: 'INTEREST', people: 12, share: null },
      { step: 'ROOM', people: 9, share: 9 / 12 },
      { step: 'TURN', people: 6, share: 6 / 9 },
      { step: 'SECURED', people: 5, share: 5 / 6 },
      { step: 'CONFIRMED', people: 4, share: 4 / 5 },
      { step: 'CONCLUDED', people: 1, share: 1 / 4 },
    ]);
    // 5 of 6 turns secured, 4 of 5 holds confirmed: 2/3; next time 52: 3 + 1, 54: 1 + 1.
    expect(rep.conversion).toBeCloseTo(2 / 3, 10);
    expect(rep.sizes.map((s) => [s.label, s.stock, s.added, s.confirmedPieces, s.sellOutMs, s.unservedPeople, s.unservedPieces, s.missed, s.expired, s.nextDemand])).toEqual([
      ['52', 3, 1, 3, 4 * MINUTE, 1, 1, 1, 0, 4],
      ['54', 2, 0, 1, null, 1, 1, 0, 1, 2],
    ]);
    // The revenue: 4 pieces confirmed, 1 of them cancelled: 3 × € 4 800; the add-ons of x1 and x7 (x2's cancelled).
    expect(rep).toMatchObject({ final: true, sellOutMs: null, missed: 1, expired: 1, released: 0, cancelled: { reservations: 1, pieces: 1 }, piecesRevenueMinor: 1_440_000, addonsRevenueMinor: 30_000, next: { quantity: 6 } });
    expect(rep.addons).toEqual([
      { id: 'eng', label: 'ENGRAVING', reservations: 2, pieces: 2, revenueMinor: 30_000 },
      { id: 'box', label: 'GIFT BOX', reservations: 1, pieces: 1, revenueMinor: 0 },
    ]);
    expect(rep.byTier).toEqual([
      { tier: 0, entries: 5, turns: 2, secured: 2, confirmed: 2, missed: 0, expired: 0 },
      { tier: 1, entries: 2, turns: 2, secured: 1, confirmed: 0, missed: 1, expired: 1 },
      { tier: 2, entries: 1, turns: 1, secured: 1, confirmed: 1, missed: 0, expired: 0 },
      { tier: 3, entries: 1, turns: 1, secured: 1, confirmed: 1, missed: 0, expired: 0 },
    ]);
    const words = rep.reasoning.join(' ');
    expect(words).toContain('Not sold out: 4 pieces confirmed of 5.');
    // The house's money: a no-break space after the sign and between the thousands (live-console.ts liveMoney).
    expect(words).toContain('€\u00a014\u00a0400 for the pieces, €\u00a0300 for the add-ons. The reservation ORBES Client Services cancelled (1 piece) is left out, add-ons included.');
    expect(words).toContain('Pieces were added after the announcement (« 5 PIECES · NEVER MORE »): 1 in 52 at 02 NOV 2026 · 10:02:00 UTC.');
    expect(words).toContain('52 × 4, 54 × 2: 6 pieces');

    const csv = releaseReportCsv(rep);
    expect(csv.split('\r\n')[0]).toBe('"section","item","value"');
    for (const row of ['"funnel","interest","12"', '"size 52","seconds to sell out","240"', '"size 54","unserved pieces","1"', '"tier PALLADIUM","confirmed","1"', '"add-on ENGRAVING","revenue EUR","300.00"', '"revenue","pieces EUR","14400.00"', '"revenue","cancelled reservations left out","1"', '"revenue","cancelled pieces left out","1"', '"pieces added","2026-11-02T10:02:00.000Z size 52","1 (2 to 3)"', '"next time","quantity","6"']) {
      expect(csv, row).toContain(row);
    }
  });

  it('a sold-out release gives its time to sell out overall', () => {
    const r = release({ sizes: [{ id: 's52', label: '52', stock: 2 }], endedAt: at(3 * MINUTE), endedReason: 'SOLD_OUT' });
    const rep = releaseReport({ release: r, entries: [confirmed(0, 10 * SECOND, MINUTE), confirmed(0, 20 * SECOND, 3 * MINUTE)], interest: 0, addons: [], entryAddons: [], additions: [], over: true });
    expect(rep.sellOutMs).toBe(3 * MINUTE);
    expect(rep.reasoning.join(' ')).toContain('Sold out 3 min after T0');
    expect(rep.reasoning.join(' ')).toContain('No piece was added after the announcement');
    expect(rep.reasoning.join(' ')).toContain('A reservation ORBES Client Services cancels is left out: none so far.');
    expect(rep).toMatchObject({ cancelled: { reservations: 0, pieces: 0 }, piecesRevenueMinor: 960_000 });
  });
});

describe('the collector insights', () => {
  it('converts by tier, by country, repeat collectors against first-timers, and lists who came without a piece', () => {
    const { r, entries } = reportFixture();
    const emails = new Map(entries.map((e) => [e.accountId, `${e.accountId}@example.com`]));
    // A removed entry is left out of every figure.
    const bot = entry({ id: 'x10', accountId: 'p10', status: 'REMOVED', position: 10, endedAt: at(MINUTE), country: 'FR' });
    const c = collectorInsights(r, [...entries, bot], emails, new Set(['p1', 'p3', 'p10']));
    expect(c.byTier.map((t) => [t.tier, t.entered, t.secured, t.confirmed, t.conversion])).toEqual([
      [0, 5, 2, 2, 0.4],
      [1, 2, 1, 0, 0],
      [2, 1, 1, 1, 1],
      [3, 1, 1, 1, 1],
    ]);
    expect(c.byCountry.map((x) => [x.country, x.entered, x.confirmed])).toEqual([
      [null, 6, 1],
      ['FR', 2, 2],
      ['GB', 1, 1],
    ]);
    expect(c.repeat).toEqual({ entered: 2, secured: 1, confirmed: 1, conversion: 0.5 });
    expect(c.firstTime).toMatchObject({ entered: 7, confirmed: 3 });
    expect(c.unsecured.total).toBe(4);
    expect(c.unsecured.items.map((x) => [x.accountId, x.tier, x.size, x.status, x.email])).toEqual([
      ['p3', 1, '52', 'MISSED', 'p3@example.com'],
      ['p5', 0, '52', 'ENDED', 'p5@example.com'],
      ['p8', 0, '54', 'LEFT', 'p8@example.com'],
      ['p9', 0, '54', 'LEFT', 'p9@example.com'],
    ]);
    expect(c.reasoning.join(' ')).toContain('A repeat collector entered an earlier LIVE RELEASE: 2 people, 50 % converted, against 43 % for the 7 people here for the first time.');
    expect(c.reasoning[0]).toBe('The conversion of a group: those who pressed PAY, of those who entered (1 entry removed by ORBES left out).');
  });
});

describe('the release comparison', () => {
  it('sets each release\'s figures beside the others', () => {
    const { r, entries } = reportFixture();
    const sold = release({ id: 'q', title: 'THE OTHER', opensAt: at(-30 * 24 * HOUR), sizes: [{ id: 's52', label: '52', stock: 1 }] });
    const soldEntries = [confirmed(-30 * 24 * HOUR, -30 * 24 * HOUR + 10 * SECOND, -30 * 24 * HOUR + MINUTE)];
    const cmp = compareReleases([
      { summary: summarize(r, entries, 12), current: true, added: 1, addonsRevenueMinor: 30_000 },
      { summary: summarize(sold, soldEntries, 3), current: false, added: 0, addonsRevenueMinor: 0 },
    ]);
    expect(cmp.releases.map((x) => [x.id, x.current, x.stock, x.room, x.presentAtT0, x.confirmedPieces, x.sellThrough, x.sellOutMs, x.missedShare, x.piecesRevenueMinor])).toEqual([
      // 4 pieces confirmed, 1 cancelled by ORBES Client Services: 3 at € 4 800 in the revenue.
      ['r', true, 5, 9, 8, 4, 0.8, null, 1 / 6, 1_440_000],
      ['q', false, 1, 1, 0, 1, 1, MINUTE, 0, 480_000],
    ]);
    expect(cmp.reasoning).toHaveLength(4);
    expect(cmp.reasoning[3]).toBe('The revenue: the pieces and add-ons of the confirmed reservations at their prices, those ORBES Client Services cancelled left out.');
  });

  it('reads the rates of the turns and holds a summary is made of', () => {
    const rates = lineRates(reportFixture().entries);
    expect(rates).toMatchObject({ turns: 6, turnsEnded: 6, secured: 5, holdsEnded: 5, confirmed: 4, secureDelayMs: 20 * SECOND, payDelayMs: 40 * SECOND });
  });
});

// ── The reads ──────────────────────────────────────────────────────────────

describe('LiveInsightsService on a database', () => {
  let t: TestDb;
  let f: LiveFixture;
  let insights: LiveInsightsService;
  const START = '2026-11-01T09:00:00.000Z';
  const now = () => f.clock.now();
  const later = (ms: number) => new Date(now().getTime() + ms);
  /** The account's turn taken: the seal pressed, held 1.5 s, secured. */
  const secure = async (a: { id: string; actor: any }, dropId: string) => {
    const e = await f.live.entry(a.id, dropId);
    await f.live.press(a.id, dropId, e!.turn!.token!);
    f.clock.advance(1500);
    return f.live.secure(a.id, dropId, e!.turn!.token!, a.actor);
  };
  const created = async (accountId: string, at: Date) => t.db.updateTable('accounts').set({ created_at: at }).where('id', '=', accountId).execute();

  let none1: { id: string; actor: any };
  let none2: { id: string; actor: any };
  let titane: { id: string; actor: any };
  let platine: { id: string; actor: any };
  let palladium: { id: string; actor: any };
  let otherModel: string;
  let collection: string;
  let pastId: string;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, START);
    insights = new LiveInsightsService({ db: t.db, clock: f.clock.now });
    collection = await createCollection(t.db, 'ORBIT');
    otherModel = await createModel(t.db, 'ECLIPSE', collection);
    const pendant = await createModel(t.db, 'HALO', null, 'PENDANT');
    none1 = await createAccount(t.db);
    none2 = await createAccount(t.db);
    titane = await createAccount(t.db);
    platine = await createAccount(t.db);
    palladium = await createAccount(t.db);
    const old = new Date('2024-06-01T00:00:00Z');
    for (const a of [none1, none2, titane, platine, palladium]) await created(a.id, old);
    // TITANE (two pieces): an ECLIPSE ring in 52, and a later pendant (another type: its size is not read).
    await holdPieces(t.db, titane.id, 1, otherModel, { variant: '52', startedAt: new Date('2025-02-01T00:00:00Z') });
    await holdPieces(t.db, titane.id, 1, pendant, { variant: 'M', startedAt: new Date('2025-05-01T00:00:00Z') });
    // PLATINE: five MONOLITHE, the latest in 54. PALLADIUM: ten, the latest in 52.
    await holdPieces(t.db, platine.id, 4, f.modelId, { variant: '52', startedAt: new Date('2025-01-01T00:00:00Z') });
    await holdPieces(t.db, platine.id, 1, f.modelId, { variant: '54', startedAt: new Date('2025-03-01T00:00:00Z') });
    await holdPieces(t.db, palladium.id, 10, f.modelId, { variant: '52' });
    // A pendant of PALLADIUM's in size L, later: another type, left out of the rings' sizes.
    await holdPieces(t.db, palladium.id, 1, pendant, { variant: 'L', startedAt: new Date('2025-06-01T00:00:00Z') });
    // A locked account holding pieces counts nowhere.
    const locked = await createAccount(t.db);
    await holdPieces(t.db, locked.id, 10, f.modelId, { variant: '52' });
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
  });
  afterAll(() => t?.close());

  it('counts the eligible accounts by tier under each rule, and the sizes they hold of the model\'s type', async () => {
    // PALLADIUM holds 11 pieces (ten rings, a pendant): still tier 3.
    const r = await createLiveRelease(f, { opensAt: later(2 * HOUR), sizes: [{ label: '52', stock: 2 }, { label: '54', stock: 1 }], published: false });
    const fc = await insights.forecast(r.id);
    expect(fc).toMatchObject({ eligibleByTier: [2, 1, 1, 1], eligible: 5, basis: 'NONE', low: 0, high: 5, interest: 0, inRoom: null });
    const plan = await insights.plan(r.id);
    // The rings' sizes: TITANE 52 (its ECLIPSE), PLATINE 54 (its latest MONOLITHE), PALLADIUM 52; the pendants are not rings.
    expect(plan.sizes.map((s) => [s.label, s.collectors, s.suggested])).toEqual([
      ['52', 2, null],
      ['54', 1, null],
    ]);
    expect(plan).toMatchObject({ modelType: 'RING', otherSizes: [], quantity: null });

    const platineUp = await createLiveRelease(f, { opensAt: later(2 * HOUR), minTier: 2, published: false });
    expect((await insights.forecast(platineUp.id)).eligibleByTier).toEqual([0, 0, 1, 1]);
    const eclipseOwners = await createLiveRelease(f, { opensAt: later(2 * HOUR), accessModels: [otherModel], published: false });
    expect((await insights.forecast(eclipseOwners.id)).eligibleByTier).toEqual([0, 1, 0, 0]);
    const orbitOwners = await createLiveRelease(f, { opensAt: later(2 * HOUR), accessCollectionId: collection, published: false });
    expect((await insights.forecast(orbitOwners.id)).eligibleByTier).toEqual([0, 1, 0, 0]);
    await expect(insights.plan('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
    await expect(insights.report('not-an-id')).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
  });

  it('runs a past release with the live service, then reads it back for the next one', async () => {
    const opensAt = later(HOUR);
    const past = await createLiveRelease(f, { opensAt, closesAt: new Date(opensAt.getTime() + HOUR), sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }] });
    pastId = past.id;
    const [s52, s54] = past.sizes;
    for (const a of [titane, platine, palladium]) await f.live.setInterest(a.id, past.id, s52!.id, a.actor);
    await f.live.setInterest(none1.id, past.id, s54!.id, none1.actor);
    f.clock.set(new Date(opensAt.getTime() - 2 * MINUTE));
    await f.live.enter(palladium.id, past.id, { sizeId: s52!.id }, palladium.actor);
    await f.live.enter(platine.id, past.id, { sizeId: s52!.id }, platine.actor);
    await f.live.enter(none1.id, past.id, { sizeId: s54!.id }, none1.actor);
    // The room before T0: two in 52 for one piece; the radar reads the room.
    const radar = await insights.radar(past.id);
    expect(radar).toMatchObject({ roomOpen: true, formed: false, inRoom: 3 });
    expect(radar.sizes.map((s) => [s.label, s.demand, s.sellsOut, s.addPieces])).toEqual([
      ['52', 2, true, 1],
      ['54', 1, true, null],
    ]);
    expect((await insights.forecast(past.id)).inRoom).toBe(3);
    f.clock.set(opensAt);
    await f.live.advance(past.id);
    // PALLADIUM is first in 52 (tier priority): it secures and pays; 54 runs out its turn.
    f.clock.advance(5 * SECOND);
    await secure(palladium, past.id);
    f.clock.advance(10 * SECOND);
    await f.live.confirm(palladium.id, past.id, palladium.actor);
    await f.live.advance(past.id);
    f.clock.set(new Date(opensAt.getTime() + 31 * SECOND));
    await f.live.advance(past.id);
    // A late TITANE in 54, ten seconds before the close: its turn runs on past it.
    f.clock.set(new Date(opensAt.getTime() + HOUR - 10 * SECOND));
    await f.live.enter(titane.id, past.id, { sizeId: s54!.id }, titane.actor);
    await f.live.advance(past.id);
    f.clock.set(new Date(opensAt.getTime() + HOUR));
    await f.live.advance(past.id);

    const rep = await insights.report(past.id);
    expect(rep).toMatchObject({ final: false, endedReason: 'CLOSED' });
    expect(rep.funnel.map((s) => s.people)).toEqual([4, 4, 3, 1, 1, 0]);
    expect(rep.sizes.map((s) => [s.label, s.confirmedPieces, s.sellOutMs, s.unservedPieces, s.missed])).toEqual([
      ['52', 1, 16_500, 1, 0],
      ['54', 0, null, 0, 1],
    ]);
    const turnOf = (await f.live.entry(titane.id, past.id))!;
    expect(turnOf.status).toBe('TURN');
    f.clock.advance(31 * SECOND);
    await f.live.advance(past.id);
    expect((await insights.report(past.id)).final).toBe(true);

    // The next release reads it, before any interest: from each tier's eligible accounts at its share present at T0.
    const next = await createLiveRelease(f, { opensAt: later(3 * HOUR), sizes: [{ label: '52', stock: 2 }], published: false });
    const fc = await insights.forecast(next.id);
    expect(fc).toMatchObject({ basis: 'ELIGIBLE', pastReleases: 1 });
    const plan = await insights.plan(next.id);
    // The past demand: 1 confirmed + round(1 unserved × 1/3 turns confirmed) = 1, for 3 present at T0.
    expect(plan.demandPerPerson).toBeCloseTo(1 / 3, 10);
    expect(plan.pastReleases).toBe(1);

    const collectors = await insights.collectors(next.id);
    expect(collectors.unsecured.total).toBe(0);
    const repeat = await insights.collectors(past.id);
    expect(repeat.repeat.entered).toBe(0);
    expect(repeat.unsecured.items.map((x) => x.accountId).sort()).toEqual([platine.id, none1.id, titane.id].sort());
  });

  it('flags a new account and a crowded network in the bot radar', async () => {
    const opensAt = later(HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 3 }] });
    const pepper = 'pepper';
    const crowd = [await createAccount(t.db), await createAccount(t.db), await createAccount(t.db)];
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    await created(crowd[0]!.id, new Date(now().getTime() - 3 * HOUR));
    for (const [i, a] of crowd.entries()) await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor, { networkHash: liveNetworkHash(pepper, `203.0.113.${10 + i}`) });
    await f.live.enter(titane.id, r.id, { sizeId: r.sizes[0]!.id }, titane.actor, { networkHash: liveNetworkHash(pepper, '198.51.100.7') });
    const radar = await insights.bots(r.id);
    expect(radar).toMatchObject({ entries: 4, flagged: 3, bySign: { NEW_ACCOUNT: 1, NETWORK: 3 }, networks: [{ group: 1, entries: 3 }] });
    expect(radar.items[0]).toMatchObject({ accountId: crowd[0]!.id, signs: ['NEW_ACCOUNT', 'NETWORK'], open: true, email: crowd[0]!.email });
    expect(radar.items.some((x) => x.accountId === titane.id)).toBe(false);
  });

  it('says the line has stalled when the engine stops, and no longer once it runs; ADD PIECES reported', async () => {
    const opensAt = later(HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 1 }] });
    const [a, b] = [await createAccount(t.db), await createAccount(t.db)];
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    for (const x of [a, b]) await f.live.enter(x.id, r.id, { sizeId: r.sizes[0]!.id }, x.actor);
    f.clock.set(opensAt);
    await f.live.advance(r.id);
    const drop = async () => t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    // The first turn runs out at T0 + 30 s, the engine stopped: 10 s after it, the line has stalled.
    f.clock.set(new Date(opensAt.getTime() + 39 * SECOND));
    expect((await insights.signals(await drop(), now())).alerts).toEqual([]);
    f.clock.set(new Date(opensAt.getTime() + 41 * SECOND));
    const stalled = (await insights.signals(await drop(), now())).alerts;
    expect(stalled.map((x) => [x.kind, x.since])).toEqual([['LINE_STALLED', new Date(opensAt.getTime() + 30 * SECOND)]]);
    // ADD PIECES gives the next its turn at once; the engine marks the missed turn.
    await f.live.addPieces(r.id, r.sizes[0]!.id, 1, f.admin);
    await f.live.advance(r.id);
    const after = await insights.signals(await drop(), now());
    expect(after.alerts).toEqual([]);
    expect(after.sellOut).toMatchObject({ sizes: [{ size: { label: '52' }, stock: 2 }] });
    const rep = await insights.report(r.id);
    expect(rep.additions).toMatchObject([{ size: '52', pieces: 1, before: 1, after: 2 }]);
    expect(rep.sizes[0]!.added).toBe(1);
    // Before T0, nothing to say.
    expect(await insights.signals({ ...(await drop()), opens_at: later(HOUR) }, now())).toEqual({ alerts: [], sellOut: null });
  });

  it('reads the pace from the latest RESUME once a pause has ended', async () => {
    const opensAt = later(HOUR);
    const r = await createLiveRelease(f, { opensAt, closesAt: new Date(opensAt.getTime() + HOUR), sizes: [{ label: '52', stock: 3 }] });
    const [a, b] = [await createAccount(t.db), await createAccount(t.db)];
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    for (const x of [a, b]) await f.live.enter(x.id, r.id, { sizeId: r.sizes[0]!.id }, x.actor);
    f.clock.set(opensAt);
    await f.live.advance(r.id);
    const drop = async () => t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    // Paused from T0 + 1 min to T0 + 4 min, read at T0 + 5 min: 1 min of sales since the RESUME, not 5.
    f.clock.set(new Date(opensAt.getTime() + MINUTE));
    await f.live.pause(r.id, f.admin);
    f.clock.set(new Date(opensAt.getTime() + 4 * MINUTE));
    await f.live.resume(r.id, f.admin);
    f.clock.set(new Date(opensAt.getTime() + 5 * MINUTE));
    const sellOut = (await insights.signals(await drop(), now())).sellOut!;
    expect(sellOut.windowMs).toBe(MINUTE);
    expect(sellOut.reasoning[0]).toContain(`since ${utc(new Date(opensAt.getTime() + 4 * MINUTE))}, the latest RESUME (1 min of sales, the pause before it left out)`);
  });

  it('compares the release with the others whose T0 has passed, latest first', async () => {
    const cmp = await insights.comparison(pastId);
    expect(cmp.releases[0]!.current).toBe(false);
    const own = cmp.releases.find((x) => x.current)!;
    expect(own).toMatchObject({ id: pastId, stock: 2, interest: 4, room: 4, presentAtT0: 3, confirmedPieces: 1, sellThrough: 0.5, missedShare: 2 / 3 });
    expect(cmp.releases.map((x) => x.opensAt.getTime())).toEqual([...cmp.releases.map((x) => x.opensAt.getTime())].sort((p, q) => q - p));
    expect(cmp.releases.length).toBeLessThanOrEqual(LIVE_INSIGHT_RULES.pastReleases + 1);
  });

  it('leaves a reservation ORBES Client Services cancelled out of the revenue, its add-ons included: as its orders say', async () => {
    const reserved = await t.db.selectFrom('live_entries').select(['id', 'quantity']).where('drop_id', '=', pastId).where('status', '=', 'CONFIRMED').executeTakeFirstOrThrow();
    const { price_minor: price } = await t.db.selectFrom('drops').select('price_minor').where('id', '=', pastId).executeTakeFirstOrThrow();
    const addon = await t.db.insertInto('live_addons').values({ drop_id: pastId, label: 'ENGRAVING', line: null, price_minor: 15_000, position: 1 }).returning('id').executeTakeFirstOrThrow();
    await t.db.insertInto('live_entry_addons').values({ entry_id: reserved.id, addon_id: addon.id, price_minor: 15_000 }).execute();
    const revenue = async () => {
      const own = (await insights.comparison(pastId)).releases.find((x) => x.current)!;
      const rep = await insights.report(pastId);
      return [own.piecesRevenueMinor, own.addonsRevenueMinor, rep.piecesRevenueMinor, rep.addonsRevenueMinor, rep.cancelled];
    };
    expect(await revenue()).toEqual([price! * reserved.quantity, 15_000, price! * reserved.quantity, 15_000, { reservations: 0, pieces: 0 }]);
    // Cancelled by ORBES Client Services: its orders are (plan LIVE RELEASE+, the Orders board), the entry's own resolution
    // left as the LIVE plan had it.
    const orders = new OrderService({ db: t.db, audit: f.audit, clock: f.clock.now });
    for (const o of await t.db.selectFrom('orders').select('id').where('live_entry_id', '=', reserved.id).execute()) {
      await orders.transition(o.id, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin);
    }
    expect(await revenue()).toEqual([0, 0, 0, 0, { reservations: 1, pieces: reserved.quantity }]);
    expect((await t.db.selectFrom('live_entries').select('resolution').where('id', '=', reserved.id).executeTakeFirstOrThrow()).resolution).toBeNull();
  });
});
