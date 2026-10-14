/**
 * The birthday credit's rules (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.4.1; services/birthday-credits.ts), as
 * pure functions read by the client sheet's Club block (step 6.3) and the daily grant (step 6.4):
 *
 *  - the birthday a Paris day, 29 February on 28 February in a common year;
 *  - its expiry the end of its 30th day (Paris), the birthday day 1, under CET and CEST;
 *  - 365 days between two birthdays, across a leap year;
 *  - the next birthday: not granted, not expired, the date entered before its 00:00 Paris, 365 days after the last.
 */
import { describe, expect, it } from 'vitest';
import { BIRTHDAY_GAP_DAYS, birthdayExpiry, birthdayIn, dayPlus, daysBetween, nextBirthday } from '../../src/server/services/birthday-credits.js';

describe('the birthday credit\'s rules (§3.5 SB.4.1)', () => {
  it('puts the birthday on its month and day, 29 February on 28 February in a common year', () => {
    expect(birthdayIn(2027, '1994-03-14')).toBe('2027-03-14');
    expect(birthdayIn(2027, '2000-02-29')).toBe('2027-02-28');
    expect(birthdayIn(2028, '2000-02-29')).toBe('2028-02-29');
    expect(birthdayIn(2100, '2000-02-29')).toBe('2100-02-28');
    expect(birthdayIn(2000, '1996-02-29')).toBe('2000-02-29');
  });

  it('ends a credit at the last instant (Paris) of its days, the birthday day 1: 14 March with 30 days until 12 April 23:59:59.999', () => {
    // CEST (UTC+2) on 12 April 2027.
    expect(birthdayExpiry('2027-03-14', 30).toISOString()).toBe('2027-04-12T21:59:59.999Z');
    // CET (UTC+1): 1 December with 30 days until 30 December.
    expect(birthdayExpiry('2026-12-01', 30).toISOString()).toBe('2026-12-30T22:59:59.999Z');
    // One day: the birthday itself; across 25 October 2026 (a 25-hour day), its end is CET's.
    expect(birthdayExpiry('2026-10-25', 1).toISOString()).toBe('2026-10-25T22:59:59.999Z');
    expect(birthdayExpiry('2026-10-24', 1).toISOString()).toBe('2026-10-24T21:59:59.999Z');
  });

  it('counts 365 days birthday against birthday, across a leap year', () => {
    expect(BIRTHDAY_GAP_DAYS).toBe(365);
    expect(daysBetween('2028-02-29', '2029-02-28')).toBe(365);
    expect(daysBetween('2027-03-14', '2028-03-14')).toBe(366);
    expect(daysBetween('2027-03-14', '2027-11-20')).toBe(251);
    expect(dayPlus('2027-03-14', 29)).toBe('2027-04-12');
    expect(dayPlus('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('says the next birthday the rules allow', () => {
    const now = new Date('2027-02-01T10:00:00.000Z');
    const next = (birthDate: string | null, at: string | null, granted: string[] = [], days = 30, when = now) => nextBirthday({ birthDate, birthDateAt: at === null ? null : new Date(at), granted, days, now: when });
    expect(next(null, null)).toBeNull();
    expect(next('1994-03-14', '2027-01-01T09:00:00.000Z')).toBe('2027-03-14');
    // Entered at 23:59 Paris on the eve (CET): it counts; at 00:00 Paris on the birthday: the next year.
    expect(next('1994-03-14', '2027-03-13T22:59:00.000Z', [], 30, new Date('2027-03-13T23:30:00.000Z'))).toBe('2027-03-14');
    expect(next('1994-03-14', '2027-03-13T23:00:00.000Z', [], 30, new Date('2027-03-13T23:30:00.000Z'))).toBe('2028-03-14');
    // Under CEST: 21:59 and 22:00 UTC on the eve.
    expect(next('1994-07-10', '2027-07-09T21:59:00.000Z', [], 30, new Date('2027-07-09T22:30:00.000Z'))).toBe('2027-07-10');
    expect(next('1994-07-10', '2027-07-09T22:00:00.000Z', [], 30, new Date('2027-07-09T22:30:00.000Z'))).toBe('2028-07-10');
    // A birthday passed within its days, not granted, entered before: today's; once expired, the next year's.
    expect(next('1990-01-20', '2026-12-01T09:00:00.000Z')).toBe('2027-02-01');
    expect(next('1990-01-02', '2026-12-01T09:00:00.000Z')).toBe('2028-01-02');
    // Granted: the next, 365 days on; a date changed after it: never before 365 days.
    expect(next('1994-03-14', '2026-01-01T09:00:00.000Z', ['2027-03-14'], 30, new Date('2027-03-20T10:00:00.000Z'))).toBe('2028-03-14');
    expect(next('1994-11-20', '2027-03-20T10:00:00.000Z', ['2027-03-14'], 30, new Date('2027-03-20T10:00:00.000Z'))).toBe('2028-11-20');
    // 29 February granted in 2028, 28 February 2029 is 365 days on.
    expect(next('2000-02-29', '2027-01-01T09:00:00.000Z', ['2028-02-29'], 30, new Date('2028-03-01T10:00:00.000Z'))).toBe('2029-02-28');
  });
});
