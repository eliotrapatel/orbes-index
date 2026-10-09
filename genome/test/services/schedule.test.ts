/**
 * The lot's clock (plan CUSTOMER INTELLIGENCE §3.0 (e) and (f), step 0.2; services/schedule.ts), pure functions:
 *
 *  - parisDay: the Paris calendar day of an instant, summer and winter time, around midnight Paris;
 *  - parisDayStart: 00:00 Paris of a day, from `YYYY-MM-DD` or an instant; 25 October 2026 is a 25-hour day (the change
 *    to winter time), the spring change a 23-hour day: 28 March 2027 (the last Sunday of March 2027; the plan's step
 *    0.2 says 29 March 2027, a Monday and a 24-hour day, checked too) and 29 March 2026; a bad day refused;
 *  - parisMonthStart: 00:00 Paris on day 1, from `YYYY-MM` or an instant; October 2026 has 31 days and 1 hour;
 *  - morningWindowOpen: closed at 07:29 UTC and open at 07:30 UTC under CEST and CET (09:30 Paris until 25 October,
 *    08:30 after), open until the Paris day ends (22:00 UTC in summer, 23:00 UTC in winter), closed in the night.
 */
import { describe, expect, it } from 'vitest';
import { MORNING_WINDOW_UTC, morningWindowOpen, PARIS_TIME_ZONE, parisDay, parisDayStart, parisMonthStart } from '../../src/server/services/schedule.js';

const H = 3_600_000;
const at = (iso: string) => new Date(iso);
const hoursOf = (day: string, next: string) => (parisDayStart(next).getTime() - parisDayStart(day).getTime()) / H;

describe('Paris days', () => {
  it('parisDay reads the Paris calendar day, in summer time and in winter time', () => {
    expect(PARIS_TIME_ZONE).toBe('Europe/Paris');
    expect(parisDay(at('2026-10-09T21:59:59.999Z'))).toBe('2026-10-09'); // 23:59:59 CEST
    expect(parisDay(at('2026-10-09T22:00:00Z'))).toBe('2026-10-10'); // 00:00 CEST
    expect(parisDay(at('2026-11-09T22:59:59.999Z'))).toBe('2026-11-09'); // 23:59:59 CET
    expect(parisDay(at('2026-11-09T23:00:00Z'))).toBe('2026-11-10'); // 00:00 CET
    expect(parisDay(at('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(() => parisDay(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('parisDayStart: 00:00 Paris, from a day or from an instant', () => {
    expect(parisDayStart('2026-10-09').toISOString()).toBe('2026-10-08T22:00:00.000Z');
    expect(parisDayStart('2026-11-09').toISOString()).toBe('2026-11-08T23:00:00.000Z');
    expect(parisDayStart(at('2026-10-09T21:59:59Z')).toISOString()).toBe('2026-10-08T22:00:00.000Z');
    expect(parisDayStart(at('2026-10-09T22:00:00Z')).toISOString()).toBe('2026-10-09T22:00:00.000Z');
    expect(parisDayStart('2028-02-29').toISOString()).toBe('2028-02-28T23:00:00.000Z');
  });

  it('25 October 2026 is a 25-hour day, counted once', () => {
    expect(parisDayStart('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z'); // still CEST at midnight
    expect(parisDayStart('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z'); // CET
    expect(hoursOf('2026-10-24', '2026-10-25')).toBe(24);
    expect(hoursOf('2026-10-25', '2026-10-26')).toBe(25);
    expect(hoursOf('2026-10-26', '2026-10-27')).toBe(24);
    // Every instant of the long day falls in it, and only in it: 01:30 UTC is 02:30 CET, after the clocks went back.
    for (const iso of ['2026-10-24T22:00:00Z', '2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z', '2026-10-25T22:59:59.999Z']) {
      expect(parisDay(at(iso))).toBe('2026-10-25');
      expect(parisDayStart(at(iso)).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    }
    expect(parisDay(at('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('the spring change is a 23-hour day: 28 March 2027 and 29 March 2026; 29 March 2027 has 24 hours', () => {
    expect(parisDayStart('2027-03-28').toISOString()).toBe('2027-03-27T23:00:00.000Z'); // CET at midnight
    expect(parisDayStart('2027-03-29').toISOString()).toBe('2027-03-28T22:00:00.000Z'); // CEST
    expect(hoursOf('2027-03-28', '2027-03-29')).toBe(23);
    expect(hoursOf('2027-03-29', '2027-03-30')).toBe(24);
    expect(hoursOf('2026-03-29', '2026-03-30')).toBe(23);
    expect(parisDay(at('2027-03-28T21:59:59.999Z'))).toBe('2027-03-28');
    expect(parisDay(at('2027-03-28T22:00:00Z'))).toBe('2027-03-29');
  });

  it('refuses what is not a day', () => {
    for (const bad of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-01', '26-10-01', '2026-10-09T00:00', '']) {
      expect(() => parisDayStart(bad)).toThrow(RangeError);
    }
    expect(() => parisDayStart(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('Paris months', () => {
  it('parisMonthStart: 00:00 Paris on day 1, from a month or from an instant', () => {
    expect(parisMonthStart('2026-10').toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(parisMonthStart('2026-11').toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(parisMonthStart('2027-01').toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(parisMonthStart('2027-04').toISOString()).toBe('2027-03-31T22:00:00.000Z');
    // October 2026 is 31 days and one hour long (its last Sunday has 25 hours).
    expect((parisMonthStart('2026-11').getTime() - parisMonthStart('2026-10').getTime()) / H).toBe(31 * 24 + 1);
    // March 2027 is 31 days less one hour.
    expect((parisMonthStart('2027-04').getTime() - parisMonthStart('2027-03').getTime()) / H).toBe(31 * 24 - 1);
    // An instant on 31 October at 23:30 UTC is already 1 November in Paris.
    expect(parisMonthStart(at('2026-10-31T23:30:00Z')).toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(parisMonthStart(at('2026-10-31T22:59:59Z')).toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('refuses what is not a month', () => {
    for (const bad of ['2026-00', '2026-13', '2026-1', '2026-10-01', '']) expect(() => parisMonthStart(bad)).toThrow(RangeError);
  });
});

describe('the morning window', () => {
  it('opens at 07:30 UTC: 09:30 Paris in summer time, 08:30 Paris in winter time', () => {
    expect(MORNING_WINDOW_UTC).toBe('07:30');
    // CEST (until 25 October 2026).
    expect(morningWindowOpen(at('2026-10-09T07:29:00Z'))).toBe(false);
    expect(morningWindowOpen(at('2026-10-09T07:29:59.999Z'))).toBe(false);
    expect(morningWindowOpen(at('2026-10-09T07:30:00Z'))).toBe(true);
    // CET (after 25 October 2026).
    expect(morningWindowOpen(at('2026-11-09T07:29:00Z'))).toBe(false);
    expect(morningWindowOpen(at('2026-11-09T07:30:00Z'))).toBe(true);
    // The long day itself, and the spring change.
    expect(morningWindowOpen(at('2026-10-25T07:29:00Z'))).toBe(false);
    expect(morningWindowOpen(at('2026-10-25T07:30:00Z'))).toBe(true);
    expect(morningWindowOpen(at('2027-03-28T07:29:00Z'))).toBe(false);
    expect(morningWindowOpen(at('2027-03-28T07:30:00Z'))).toBe(true);
  });

  it('stays open until the Paris day ends, and is closed through the night', () => {
    expect(morningWindowOpen(at('2026-10-09T12:00:00Z'))).toBe(true);
    expect(morningWindowOpen(at('2026-10-09T21:59:59Z'))).toBe(true); // 23:59 CEST
    expect(morningWindowOpen(at('2026-10-09T22:00:00Z'))).toBe(false); // 00:00 CEST, the next Paris day
    expect(morningWindowOpen(at('2026-10-09T22:50:00Z'))).toBe(false);
    expect(morningWindowOpen(at('2026-11-09T22:59:59Z'))).toBe(true); // 23:59 CET
    expect(morningWindowOpen(at('2026-11-09T23:00:00Z'))).toBe(false); // 00:00 CET
    // The night freeze, the backups and the GeoIP refresh are all before the window.
    for (const iso of ['2026-10-10T01:05:00Z', '2026-10-10T03:17:00Z', '2026-10-12T04:41:00Z', '2026-10-10T05:30:00Z', '2026-11-10T05:00:00Z']) {
      expect(morningWindowOpen(at(iso))).toBe(false);
    }
    expect(morningWindowOpen(new Date(Number.NaN))).toBe(false);
  });
});
