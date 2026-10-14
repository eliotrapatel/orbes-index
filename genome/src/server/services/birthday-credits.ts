/**
 * The birthday credit's rules (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.4.1; migration 0045): every account
 * with a date of birth, piece or not, receives on its birthday (a Paris day) one credit of THE PROGRAM's amount, in
 * THE PROGRAM's credit currency, valid THE PROGRAM's days from the birthday (the birthday is day 1), as a `tier_grants`
 * row of kind BIRTHDAY, taken off an order by Client Services like a tier's credit (services/tier-grants.ts usableAt).
 *
 *   the day        the Paris calendar day whose month and day are the date of birth's; 29 February falls on
 *                  28 February in a common year (never skipped) (`birthdayIn`);
 *   its expiry     the end (23:59:59.999 Paris) of the birthday's day `days` − 1 later: 14 March with 30 days is usable
 *                  until 12 April (`birthdayExpiry`);
 *   12 months      a new one only when the account's previous one was for a birthday at least 365 days earlier
 *                  (`BIRTHDAY_GAP_DAYS`, birthday against birthday, exact across leap years and date changes);
 *   entered before the date of birth must be on the account before 00:00 Paris on the birthday (`birth_date_at`, the
 *                  last time it was entered or changed, by the collector or by Client Services; question 20 of
 *                  8 October 2026): typing a recent date never gives € 20 at once;
 *   a missed day   given at the first pass afterwards while the birthday's credit has not expired, with the days left.
 *
 * `nextBirthday` answers, for the client sheet's Club block (OwnerService, §3.5 SB.4.3 `birthdayNext`), the first
 * birthday from today these rules allow. The daily grant itself is step 6.4's.
 */
import { parisDay, parisDayStart } from './schedule.js';

/** Two birthday credits of an account are at least this many days apart, birthday against birthday. */
export const BIRTHDAY_GAP_DAYS = 365;

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(day: string): [number, number, number] {
  const m = DATE_RE.exec(day);
  if (!m) throw new RangeError('A day is YYYY-MM-DD.');
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The calendar day `n` days after `day` (`YYYY-MM-DD`), negative for before. */
export function dayPlus(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (`YYYY-MM-DD`), as calendar days: positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** The birthday of a date of birth (`YYYY-MM-DD`) in `year`, as a Paris day: 29 February on 28 February in a common year. */
export function birthdayIn(year: number, birthDate: string): string {
  const [, m, d] = parts(birthDate);
  return m === 2 && d === 29 && !isLeap(year) ? iso(year, 2, 28) : iso(year, m, d);
}

/** When a birthday credit given for `birthdayOn` expires: the last instant (Paris) of its `days`-th day, the birthday being day 1. */
export function birthdayExpiry(birthdayOn: string, days: number): Date {
  return new Date(parisDayStart(dayPlus(birthdayOn, days)).getTime() - 1);
}

/**
 * The first birthday from today (Paris) the rules allow (SB.4.1): not granted yet, its credit not expired (a birthday
 * passed within its days counts, as `today`: the next pass grants it), the date of birth on the account before its
 * 00:00 Paris, and 365 days at least after the last birthday granted. Null without a date of birth.
 */
export function nextBirthday(input: {
  /** The date of birth, `YYYY-MM-DD`, or null. */
  birthDate: string | null;
  /** When the date of birth was last entered or changed (`account_profiles.birth_date_at`). */
  birthDateAt: Date | null;
  /** The birthdays already granted (`tier_grants.birthday_on` of the account's BIRTHDAY grants). */
  granted: readonly string[];
  /** THE PROGRAM's days. */
  days: number;
  now: Date;
}): string | null {
  const { birthDate, birthDateAt, granted, days, now } = input;
  if (birthDate === null || birthDateAt === null) return null;
  const today = parisDay(now);
  const last = granted.reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);
  const [year] = parts(today);
  // The rules reach at most two birthdays beyond the next one (a date changed after the last credit, 365 days after it).
  for (let y = year - 1; y <= year + 3; y++) {
    const b = birthdayIn(y, birthDate);
    if (granted.includes(b)) continue;
    if (birthdayExpiry(b, days).getTime() < now.getTime()) continue;
    if (birthDateAt.getTime() >= parisDayStart(b).getTime()) continue;
    if (last !== null && daysBetween(last, b) < BIRTHDAY_GAP_DAYS) continue;
    return b < today ? today : b;
  }
  return null;
}
