/**
 * The engagement score's formula (plan CUSTOMER INTELLIGENCE §3.5 SB.3.1, SB.3.3, SB.3.7, step 7.2;
 * services/engagement-formula.ts), pure functions:
 *
 *  - every step of the five parts at, below and above each boundary: Recency (inclusive bounds), Frequency, Spend with
 *    the owner's steps of question 13 (any purchase, € 150, € 350, € 700, € 1 500), Release speed, Attendance;
 *  - `scoreOf` sums its five parts, from 0 to 100; `band` puts 100 in the last band;
 *  - `toEurMinor` rounds half up and refuses an unknown currency; every house currency has its rate;
 *  - FORMULA_LINES are written from the constants: a changed constant changes its line;
 *  - the constants' hash is pinned with ENGAGEMENT_FORMULA: one never moves without the other.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HOUSE_CURRENCIES, SCORE_OTHER_CURRENCIES } from '../../src/server/db/schema.js';
import {
  ATTENDANCE_FULL_SHARE,
  attendancePoints,
  band,
  ENGAGEMENT_FORMULA,
  ENGAGEMENT_PARTS,
  ENGAGEMENT_WINDOW_DAYS,
  FORMULA_CONSTANTS,
  FORMULA_LINES,
  formulaLines,
  FREQUENCY_STEPS,
  frequencyPoints,
  isOtherCurrency,
  PART_MAX,
  RECENCY_STEPS,
  recencyPoints,
  scoreOf,
  SPEED_LATER_POINTS,
  SPEED_STEPS_MINUTES,
  speedPoints,
  SPEND_EUR_RATES,
  SPEND_POINTS,
  SPEND_STEPS_EUR_MINOR,
  spendPoints,
  toEurMinor,
  type EngagementInputs,
} from '../../src/server/services/engagement-formula.js';

const DAY = 86_400_000;
const NOW = new Date('2026-11-02T08:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const NOTHING: EngagementInputs = {
  lastActAt: null, lastActKind: null, activeDays: 0, spendEurMinor: 0, purchases: 0, unpriced: 0, otherCurrencies: [], speedMinutes: null, speedReleases: 0, releasesTaken: 0, releasesOpen: 0,
};

describe('the engagement formula\'s parts (§3.5 SB.3.1)', () => {
  it('weighs its five parts 25, 20, 25, 10 and 20 over 12 months', () => {
    expect(ENGAGEMENT_FORMULA).toBe(1);
    expect(ENGAGEMENT_WINDOW_DAYS).toBe(365);
    expect(PART_MAX).toEqual({ recency: 25, frequency: 20, spend: 25, speed: 10, attendance: 20 });
    expect([...ENGAGEMENT_PARTS]).toEqual(['recency', 'frequency', 'spend', 'speed', 'attendance']);
    expect(Object.values(PART_MAX).reduce((a, b) => a + b, 0)).toBe(100);
    // Each table ends on its part's most.
    expect(RECENCY_STEPS[0]!.points).toBe(PART_MAX.recency);
    expect(FREQUENCY_STEPS.at(-1)!.points).toBe(PART_MAX.frequency);
    expect(SPEND_POINTS.at(-1)).toBe(PART_MAX.spend);
    expect(SPEED_STEPS_MINUTES[0]!.points).toBe(PART_MAX.speed);
    expect(SPEND_POINTS).toHaveLength(SPEND_STEPS_EUR_MINOR.length + 1);
  });

  it('Recency: within 7 days 25, 30 days 20, 90 days 14, 180 days 8, 365 days 3, each bound inclusive; none 0', () => {
    expect(recencyPoints(null, NOW)).toBe(0);
    expect(recencyPoints(NOW, NOW)).toBe(25);
    for (const [days, at, after] of [[7, 25, 20], [30, 20, 14], [90, 14, 8], [180, 8, 3], [365, 3, 0]] as const) {
      expect(recencyPoints(ago(days * DAY - 1), NOW), `just inside ${days} days`).toBe(at);
      expect(recencyPoints(ago(days * DAY), NOW), `${days} days exactly`).toBe(at);
      expect(recencyPoints(ago(days * DAY + 1), NOW), `just beyond ${days} days`).toBe(after);
    }
  });

  it('Frequency: no day 0, 1 day 4, 2 to 3 days 8, 4 to 6 days 12, 7 to 11 days 16, 12 days or more 20', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 11, 12, 13, 366].map(frequencyPoints)).toEqual([0, 4, 8, 8, 12, 12, 16, 16, 20, 20, 20]);
  });

  it('Spend (question 13): no purchase 0, any purchase 8, from € 150 13, from € 350 18, from € 700 22, from € 1 500 25', () => {
    expect([...SPEND_STEPS_EUR_MINOR]).toEqual([15_000, 35_000, 70_000, 150_000]);
    expect(spendPoints(0, 0)).toBe(0);
    // A spend without a purchase counted never scores: the purchase is what opens the part.
    expect(spendPoints(200_000, 0)).toBe(0);
    // A piece with no known price is a purchase of € 0.
    expect(spendPoints(0, 1)).toBe(8);
    expect(spendPoints(7_000, 1)).toBe(8); // one purchase of € 70
    expect(spendPoints(14_999, 1)).toBe(8); // € 149.99
    expect(spendPoints(15_000, 1)).toBe(13); // € 150
    expect(spendPoints(34_999, 2)).toBe(13); // € 349.99
    expect(spendPoints(35_000, 2)).toBe(18); // € 350
    expect(spendPoints(69_999, 3)).toBe(18); // € 699.99
    expect(spendPoints(70_000, 3)).toBe(22); // € 700
    expect(spendPoints(149_999, 4)).toBe(22); // € 1 499.99
    expect(spendPoints(150_000, 4)).toBe(25); // € 1 500
    expect(spendPoints(9_000_000, 40)).toBe(25);
  });

  it('Release speed: at the opening 10, within 5 minutes 9, 30 minutes 7, 2 hours 5, 24 hours 3, later 1; no release 0', () => {
    expect(speedPoints(null)).toBe(0);
    expect([0, 1, 5, 6, 30, 31, 120, 121, 1440, 1441, 100_000].map(speedPoints)).toEqual([10, 9, 9, 7, 7, 5, 5, 3, 3, 1, 1]);
    expect(SPEED_LATER_POINTS).toBe(1);
  });

  it('Attendance: 40 points per release taken out of each open, rounded, 20 at most; half or more gives 20; none open 0', () => {
    expect(ATTENDANCE_FULL_SHARE).toBe(0.5);
    expect(attendancePoints(0, 0)).toBe(0);
    expect(attendancePoints(0, 8)).toBe(0);
    expect(attendancePoints(3, 8)).toBe(15);
    expect(attendancePoints(4, 8)).toBe(20);
    expect(attendancePoints(8, 8)).toBe(20);
    expect(attendancePoints(1, 2)).toBe(20);
    expect(attendancePoints(1, 3)).toBe(13);
    expect(attendancePoints(1, 16)).toBe(3); // 2.5 rounds up
    expect(attendancePoints(1, 81)).toBe(0); // 0.49 rounds down
    expect(attendancePoints(1, 80)).toBe(1); // 0.5 rounds up
    expect(attendancePoints(1, 1)).toBe(20);
  });
});

describe('the engagement score (§3.5 SB.3.1)', () => {
  it('scoreOf sums its five parts, from 0 with nothing to 100 with everything', () => {
    expect(scoreOf(NOTHING, NOW)).toEqual({ score: 0, parts: { recency: 0, frequency: 0, spend: 0, speed: 0, attendance: 0 }, inputs: NOTHING });
    const all: EngagementInputs = {
      lastActAt: ago(3_600_000), lastActKind: 'ORDER', activeDays: 40, spendEurMinor: 200_000, purchases: 6, unpriced: 0, otherCurrencies: [], speedMinutes: 0, speedReleases: 4, releasesTaken: 4, releasesOpen: 5,
    };
    expect(scoreOf(all, NOW)).toEqual({ score: 100, parts: { recency: 25, frequency: 20, spend: 25, speed: 10, attendance: 20 }, inputs: all });
    // The plan's example sheet: 20 + 12 + 18 + 9 + 15 = 74.
    const mid: EngagementInputs = {
      lastActAt: ago(12 * DAY), lastActKind: 'DRAW', activeDays: 6, spendEurMinor: 41_000, purchases: 2, unpriced: 0, otherCurrencies: ['GBP'], speedMinutes: 4, speedReleases: 5, releasesTaken: 3, releasesOpen: 8,
    };
    const scored = scoreOf(mid, NOW);
    expect(scored.parts).toEqual({ recency: 20, frequency: 12, spend: 18, speed: 9, attendance: 15 });
    expect(scored.score).toBe(74);
    expect(scored.score).toBe(Object.values(scored.parts).reduce((a, b) => a + b, 0));
    // A median without a release counted is no speed.
    expect(scoreOf({ ...NOTHING, speedMinutes: 0, speedReleases: 0 }, NOW).parts.speed).toBe(0);
  });

  it('band: ten bands of ten, 100 in the last', () => {
    expect([0, 9, 10, 19, 55, 89, 90, 99, 100].map(band)).toEqual([0, 0, 1, 1, 5, 8, 9, 9, 9]);
  });

  it('toEurMinor: fixed rates, rounded half up; every house currency has its rate; an unknown currency throws', () => {
    expect(SPEND_EUR_RATES).toEqual({ EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.06 });
    expect(Object.keys(SPEND_EUR_RATES).sort()).toEqual([...HOUSE_CURRENCIES].sort());
    expect(HOUSE_CURRENCIES.filter(isOtherCurrency).sort()).toEqual([...SCORE_OTHER_CURRENCIES].sort());
    expect(isOtherCurrency('EUR')).toBe(false);
    expect(isOtherCurrency('JPY')).toBe(false);
    expect(toEurMinor(12_345, 'EUR')).toBe(12_345);
    expect(toEurMinor(10_000, 'GBP')).toBe(11_700);
    expect(toEurMinor(10_000, 'USD')).toBe(9_200);
    expect(toEurMinor(10_000, 'CHF')).toBe(10_600);
    // The half goes up, exactly: 50 pence are 58.5 cents, 25 US cents are 23 cents, 75 Swiss centimes are 79.5 cents.
    expect(toEurMinor(50, 'GBP')).toBe(59);
    expect(toEurMinor(25, 'USD')).toBe(23);
    expect(toEurMinor(75, 'CHF')).toBe(80);
    expect(toEurMinor(1, 'USD')).toBe(1); // 0.92
    expect(toEurMinor(0, 'GBP')).toBe(0);
    for (const bad of ['JPY', 'eur', '', 'toString', '__proto__']) expect(() => toEurMinor(100, bad), bad).toThrow(RangeError);
    expect(() => toEurMinor(1.5, 'EUR')).toThrow(RangeError);
    expect(() => toEurMinor(Number.NaN, 'EUR')).toThrow(RangeError);
  });
});

describe('the formula\'s words and its number (§3.5 SB.3.3, SB.3.6)', () => {
  it('FORMULA_LINES are the client sheet\'s six lines', () => {
    expect([...FORMULA_LINES]).toEqual([
      'Recency, up to 25: the latest scan, draw entry, LIVE RELEASE entry, I’LL BE THERE, order or piece registered. Within 7 days 25, 30 days 20, 90 days 14, 180 days 8, 12 months 3.',
      'Frequency, up to 20: the days with one of these acts in 12 months. 1 day 4, 2 to 3 days 8, 4 to 6 days 12, 7 to 11 days 16, 12 days or more 20.',
      'Spend, up to 25: the pieces bought in 12 months, counted as GROWTH counts them, in euros. A purchase 8, from € 150 13, from € 350 18, from € 700 22, from € 1 500 25.',
      'Release speed, up to 10: how soon after a release opens the client enters it, the median over 12 months. At the opening 10, within 5 minutes 9, 30 minutes 7, 2 hours 5, 24 hours 3, later 1.',
      'Attendance, up to 20: the releases taken part in, out of those open to every client since the account was created, plus those it entered by access. Half of them or more gives 20.',
      'Formula 1, fixed in the code.',
    ]);
    expect(Object.isFrozen(FORMULA_LINES)).toBe(true);
    // The house's voice: no exclamation mark, 'piece' and never 'product', no atelier, handmade or craft word.
    for (const line of FORMULA_LINES) expect(line).not.toMatch(/!|product|atelier|handmade|hand-made|craft/i);
  });

  it('are written from the constants: a changed constant changes its line, and only its line', () => {
    const base = formulaLines();
    expect(base).toEqual([...FORMULA_LINES]);
    const changed = (over: Partial<typeof FORMULA_CONSTANTS>, formula = ENGAGEMENT_FORMULA) => {
      const lines = formulaLines({ ...FORMULA_CONSTANTS, ...over }, formula);
      return lines.map((l, i) => (l === base[i] ? null : l));
    };
    expect(changed({ recencySteps: [{ days: 14, points: 25 }, ...RECENCY_STEPS.slice(1)] })).toEqual([
      'Recency, up to 25: the latest scan, draw entry, LIVE RELEASE entry, I’LL BE THERE, order or piece registered. Within 14 days 25, 30 days 20, 90 days 14, 180 days 8, 12 months 3.',
      null, null, null, null, null,
    ]);
    expect(changed({ frequencySteps: [{ from: 1, points: 4 }, { from: 2, points: 8 }, { from: 3, points: 12 }, { from: 7, points: 16 }, { from: 10, points: 20 }] })[1]).toBe(
      'Frequency, up to 20: the days with one of these acts in 12 months. 1 day 4, 2 days 8, 3 to 6 days 12, 7 to 9 days 16, 10 days or more 20.',
    );
    expect(changed({ spendStepsEurMinor: [20_000, 50_000, 100_000, 250_000], spendPoints: [5, 10, 15, 20, 25] })).toEqual([
      null, null,
      'Spend, up to 25: the pieces bought in 12 months, counted as GROWTH counts them, in euros. A purchase 5, from € 200 10, from € 500 15, from € 1 000 20, from € 2 500 25.',
      null, null, null,
    ]);
    expect(changed({ speedStepsMinutes: [{ minutes: 0, points: 10 }, { minutes: 1, points: 9 }, { minutes: 60, points: 6 }, { minutes: 90, points: 4 }], speedLaterPoints: 2 })[3]).toBe(
      'Release speed, up to 10: how soon after a release opens the client enters it, the median over 12 months. At the opening 10, within 1 minute 9, 1 hour 6, 90 minutes 4, later 2.',
    );
    expect(changed({ attendanceFullShare: 0.75 })[4]).toBe(
      'Attendance, up to 20: the releases taken part in, out of those open to every client since the account was created, plus those it entered by access. 75 % of them or more gives 20.',
    );
    expect(changed({ partMax: { ...PART_MAX, spend: 30 } })[2]).toMatch(/^Spend, up to 30: /);
    expect(changed({}, 2)).toEqual([null, null, null, null, null, 'Formula 2, fixed in the code.']);
  });

  it('ENGAGEMENT_FORMULA is raised whenever a constant changes: the constants\' hash is pinned with the formula\'s number', () => {
    // A change of any step, weight, rate or window changes this hash. Then raise ENGAGEMENT_FORMULA by one in
    // engagement-formula.ts and write the new pair here: the next morning's run rescores every account (SB.3.3 step 6).
    const hash = createHash('sha256').update(JSON.stringify(FORMULA_CONSTANTS)).digest('hex');
    expect({ formula: ENGAGEMENT_FORMULA, hash }).toEqual({ formula: 1, hash: 'eccc30f5c19e3dd75436eed609ae49d8e201dc808de73438cfbd68c9da0d12b2' });
    expect(Object.isFrozen(FORMULA_CONSTANTS)).toBe(true);
    expect(JSON.parse(JSON.stringify(FORMULA_CONSTANTS))).toEqual({
      windowDays: 365,
      partMax: { recency: 25, frequency: 20, spend: 25, speed: 10, attendance: 20 },
      recencySteps: [{ days: 7, points: 25 }, { days: 30, points: 20 }, { days: 90, points: 14 }, { days: 180, points: 8 }, { days: 365, points: 3 }],
      frequencySteps: [{ from: 1, points: 4 }, { from: 2, points: 8 }, { from: 4, points: 12 }, { from: 7, points: 16 }, { from: 12, points: 20 }],
      spendStepsEurMinor: [15_000, 35_000, 70_000, 150_000],
      spendPoints: [8, 13, 18, 22, 25],
      speedStepsMinutes: [{ minutes: 0, points: 10 }, { minutes: 5, points: 9 }, { minutes: 30, points: 7 }, { minutes: 120, points: 5 }, { minutes: 1440, points: 3 }],
      speedLaterPoints: 1,
      attendanceFullShare: 0.5,
      spendEurRates: { EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.06 },
    });
  });
});
