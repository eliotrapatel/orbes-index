/**
 * The customer intelligence lot's clock (plan CUSTOMER INTELLIGENCE §3.0 (e) and (f), step 0.2): Paris days and months,
 * and the morning window of the 10-minute housekeeping pass.
 *
 *   Paris days and months   Every day or month the lot keys or counts is a Paris calendar day or month (Europe/Paris),
 *               as the owner reads times. The bounds are computed here, in JavaScript through `Intl`, and passed to SQL
 *               as `timestamptz`, so PostgreSQL and PGlite agree whatever time-zone data they carry. A day is a true
 *               Paris day: 25 October 2026 has 25 hours (the change to winter time), 28 March 2027 has 23 (the change
 *               to summer time), each counted once. The existing UTC tables (`scan_daily_stats`, `activity_hourly`,
 *               GROWTH's months) are not changed.
 *
 *   The morning window      One window for every daily job of the lot (`morningWindowOpen`): the passes at or after
 *               07:30 UTC (MORNING_WINDOW_UTC) on the date of the Paris day, until that Paris day ends (00:00 Paris:
 *               22:00 UTC in summer time, 23:00 UTC in winter time). That is 09:30 Paris until 25 October 2026 and
 *               08:30 Paris after. It is clear of the night freeze (03:00–05:30 UTC), the ORBES backup at 03:17 UTC,
 *               the hub's backup minutes, the Monday GeoIP refresh (04:41 UTC plus up to 1 h), the 07:00 Paris
 *               Morning Brief and AI Stack Atlas's no-load windows. No new timer: the jobs run in `startHousekeeping`.
 *
 * Pure functions, no database.
 */

/** The time zone every day and month of the lot is counted in. */
export const PARIS_TIME_ZONE = 'Europe/Paris';

/** The morning window opens at this UTC time of the Paris day's date, `HH:MM` (§3.0 (f)). */
export const MORNING_WINDOW_UTC = '07:30';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const parisParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsOf(at: Date): Record<string, string> {
  return Object.fromEntries(parisParts.formatToParts(at).map((x) => [x.type, x.value]));
}

/** Paris's offset from UTC at `at`, in milliseconds (+1 h in winter time, +2 h in summer time). */
function parisOffsetMs(at: Date): number {
  const p = partsOf(at);
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** The first instant of the calendar day y-m-d in Paris (m from 1). Paris never changes its clock at midnight. */
function startOfParisDate(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - parisOffsetMs(new Date(guess));
  return new Date(guess - parisOffsetMs(new Date(first)));
}

function validDate(y: number, m: number, d: number): boolean {
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function checkInstant(at: Date, fn: string): void {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new RangeError(`${fn}: not a valid instant`);
}

/** The calendar day of `at` in Paris, `YYYY-MM-DD`. */
export function parisDay(at: Date): string {
  checkInstant(at, 'parisDay');
  const p = partsOf(at);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * The first instant (00:00 Paris) of a Paris day: the day `YYYY-MM-DD`, or the Paris day an instant falls in. The next
 * day's start is the end (exclusive) of this one: `parisDayStart('2026-10-25')` to `parisDayStart('2026-10-26')` is 25
 * hours.
 */
export function parisDayStart(day: string | Date): Date {
  if (day instanceof Date) {
    const [y, m, d] = parisDay(day).split('-').map(Number) as [number, number, number];
    return startOfParisDate(y, m, d);
  }
  const match = DAY_RE.exec(day);
  const [y, m, d] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  if (!match || !validDate(y, m, d)) throw new RangeError('parisDayStart: a day is YYYY-MM-DD');
  return startOfParisDate(y, m, d);
}

/**
 * The first instant (00:00 Paris on day 1) of a Paris month: the month `YYYY-MM`, or the Paris month an instant falls
 * in. The next month's start is the end (exclusive) of this one.
 */
export function parisMonthStart(month: string | Date): Date {
  if (month instanceof Date) {
    const [y, m] = parisDay(month).split('-').map(Number) as [number, number];
    return startOfParisDate(y, m, 1);
  }
  const match = MONTH_RE.exec(month);
  const [y, m] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!match || !validDate(y, m, 1)) throw new RangeError('parisMonthStart: a month is YYYY-MM');
  return startOfParisDate(y, m, 1);
}

/**
 * Whether a housekeeping pass at `now` is in the lot's morning window: at or after MORNING_WINDOW_UTC on the date of
 * the Paris day of `now`. The window then lasts until that Paris day ends (a pass between 22:00 and 23:00 UTC in
 * summer time is already in the next Paris day, before its window). Never thrown.
 */
export function morningWindowOpen(now: Date): boolean {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  const [y, m, d] = parisDay(now).split('-').map(Number) as [number, number, number];
  const [hh, mm] = MORNING_WINDOW_UTC.split(':').map(Number) as [number, number];
  return now.getTime() >= Date.UTC(y, m - 1, d, hh, mm);
}
