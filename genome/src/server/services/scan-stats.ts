/**
 * Daily scan statistics (recommendation A-09; DATABASE §5.24 and §10,
 * API §16.16).
 *
 * `aggregateScanStats` counts the scans of every complete UTC day into
 * `scan_daily_stats` by country, verification state and event type. It is
 * the first scan job of every housekeeping pass, before the scan-history
 * purge (context.ts `startHousekeeping`), so a purge never removes a scan
 * that is not counted yet, and the trends survive any SCAN_RETENTION_DAYS.
 *
 * - **Complete days only.** A day is aggregated once it is over and
 *   SCAN_STATS_SETTLE_MS more have passed (a verification that began at
 *   23:59:59 has committed by then): yesterday from 00:10 UTC.
 * - **Each day once.** A pass aggregates the days after the latest day
 *   already counted, up to the last complete day, in ONE statement (one
 *   snapshot: the bound and the scans it counts agree even when another
 *   instance runs the same pass). A day is never recounted, so the purge
 *   of its scans cannot lower it. The rows are upserted on the primary key,
 *   so a pass that repeats (two instances, a retry) writes the same values:
 *   the job is idempotent.
 * - **Anonymous.** Only the day, the country (`ZZ` when unknown), the state,
 *   the event type and the count. Staff scans (ADMIN_TEST) are left out, as
 *   the anomaly rules leave them out.
 *
 * `scanStatsReport` reads a window of at most ANALYTICS_MAX_DAYS days for the
 * console (GET /api/admin/analytics).
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import { SCAN_STAT_EVENT_TYPES, VERIFICATION_STATES, type ScanStatEventType, type VerificationState } from '../db/schema.js';
import { validationError } from '../errors.js';

const DAY_MS = 86_400_000;

/** How long after midnight UTC a day counts as complete (a scan that began before midnight has committed). */
export const SCAN_STATS_SETTLE_MS = 10 * 60_000;

/** The country of a scan whose location is unknown (ISO 3166-1 user-assigned code). */
export const UNKNOWN_COUNTRY = 'ZZ';

/** The longest window GET /api/admin/analytics serves, in days. */
export const ANALYTICS_MAX_DAYS = 366;

/** The window the console opens on when none is given, in days. */
export const ANALYTICS_DEFAULT_DAYS = 30;

/**
 * The states that signal a code ORBES did not issue, or did not issue for this scan: a forged or
 * damaged signature, a code nobody can verify, an unreadable code, a scan history that needs review.
 */
export const SIGNAL_STATES = ['INVALID_SIGNATURE', 'UNKNOWN', 'MALFORMED_CODE', 'SUSPICIOUS_ACTIVITY'] as const satisfies readonly VerificationState[];
export type SignalState = (typeof SIGNAL_STATES)[number];

/** `YYYY-MM-DD` of a UTC instant. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The UTC day `n` days after `day` (`YYYY-MM-DD`; `n` may be negative). */
export function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS));
}

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daySpan(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1);
}

/** The last UTC day the statistics cover at `now`: yesterday, or the day before in the first SCAN_STATS_SETTLE_MS after midnight. */
export function lastCompleteDay(now: Date): string {
  const settled = now.getTime() - SCAN_STATS_SETTLE_MS;
  return utcDay(new Date(Math.floor(settled / DAY_MS) * DAY_MS - DAY_MS));
}

/** The end of the last complete day: scans before it may be counted. */
function countableUntil(now: Date): Date {
  return new Date(Date.parse(`${lastCompleteDay(now)}T00:00:00.000Z`) + DAY_MS);
}

/** The scans a pass counts: of a complete day, after the last day already counted, of a counted type and state. */
const UNCOUNTED = (until: Date) => sql`
  s.occurred_at < ${until}
  AND s.occurred_at >= COALESCE((SELECT (max(d.day) + 1)::timestamp AT TIME ZONE 'UTC' FROM scan_daily_stats d), '-infinity'::timestamptz)
  AND s.event_type IN (${sql.join([...SCAN_STAT_EVENT_TYPES])})
  AND s.result_state IN (${sql.join([...VERIFICATION_STATES])})`;

/**
 * Count the scans of every complete UTC day not counted yet into scan_daily_stats (see the module
 * comment). Returns the number of rows written: 0 when every complete day is already counted.
 */
export async function aggregateScanStats(db: Db, now: Date): Promise<number> {
  // Scans before the end of the last complete day, after the last day already counted.
  const r = await sql`
    INSERT INTO scan_daily_stats (day, country, result_state, event_type, n)
    SELECT (s.occurred_at AT TIME ZONE 'UTC')::date, COALESCE(s.country, ${UNKNOWN_COUNTRY}), s.result_state, s.event_type, count(*)::int
    FROM scan_events s
    WHERE ${UNCOUNTED(countableUntil(now))}
    GROUP BY 1, 2, 3, 4
    ON CONFLICT (day, country, result_state, event_type) DO UPDATE SET n = EXCLUDED.n`.execute(db);
  return Number(r.numAffectedRows ?? 0n);
}

/**
 * The last UTC day the statistics really cover: the last complete day when every scan of the complete days
 * is counted, else the day before the first scan no pass has counted yet (a pass that failed, or none since
 * midnight: the days after it would read as days without scans). A pass counts every complete day after the
 * last one counted in one statement, so the days before that scan are whole. Read on scan_events_occurred_at_idx.
 */
export async function countedThrough(db: Db, now: Date): Promise<string> {
  const r = await sql<{ first: Date | null }>`SELECT min(s.occurred_at) AS first FROM scan_events s WHERE ${UNCOUNTED(countableUntil(now))}`.execute(db);
  const first = r.rows[0]?.first;
  return first ? addDays(utcDay(new Date(first)), -1) : lastCompleteDay(now);
}

// ── Report ─────────────────────────────────────────────────────────────────

/** The first day PostgreSQL stores as a date of the common era (it has no year 0000). */
const FIRST_DAY = '0001-01-01';

/**
 * The window of a report from the query (http/schemas.ts `analyticsQuery`, which already checks a
 * window given by both ends): `to` defaults to the last complete day, `from` to the `days` days
 * (default ANALYTICS_DEFAULT_DAYS) that end on `to`. Throws 400 VALIDATION_FAILED when `from` is after
 * `to`, the window is longer than ANALYTICS_MAX_DAYS, or the `days` before `to` would start before
 * 0001-01-01 (`to=0001-01-01&days=2`).
 */
export function analyticsWindow(q: { from?: string; to?: string; days?: number }, now: Date): { from: string; to: string } {
  const to = q.to ?? lastCompleteDay(now);
  const from = q.from ?? addDays(to, -((q.days ?? ANALYTICS_DEFAULT_DAYS) - 1));
  // A day before year 0001 reads `0000-…` or `-000001-…`: both sort before FIRST_DAY.
  if (from < FIRST_DAY) throw validationError(`days: The window must start on ${FIRST_DAY} or later.`);
  if (from > to) throw validationError('to: from must not be after to.');
  if (daySpan(from, to) > ANALYTICS_MAX_DAYS) throw validationError(`to: The window is at most ${ANALYTICS_MAX_DAYS} days.`);
  return { from, to };
}

type Counts<K extends string> = Record<K, number>;

function zeros<K extends string>(keys: readonly K[]): Counts<K> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Counts<K>;
}

export interface ScanStatsDay {
  day: string;
  total: number;
  byState: Counts<VerificationState>;
}

export interface ScanStatsCountry {
  /** ISO 3166-1 alpha-2, `ZZ` when unknown. */
  country: string;
  total: number;
  /** Scans in one of the SIGNAL_STATES. */
  signals: number;
  byState: Counts<VerificationState>;
}

export interface ScanStatsReport {
  from: string;
  to: string;
  days: number;
  /**
   * The last day the statistics cover (countedThrough): yesterday (UTC) once its scans are counted, today's being
   * counted after midnight UTC; earlier while a day's scans wait for a housekeeping pass. Days after it read 0
   * because they are not counted yet, not because nobody scanned.
   */
  through: string;
  total: number;
  byState: Counts<VerificationState>;
  byEventType: Counts<ScanStatEventType>;
  /** Signals by state over the window. */
  signals: Counts<SignalState> & { total: number };
  /** One entry per day of the window, oldest first, days without scans included. */
  daily: ScanStatsDay[];
  /** Every country with scans in the window: most scans first, then by code. */
  countries: ScanStatsCountry[];
}

/** The statistics of the UTC days `from` to `to` (both included; the caller bounds the window). */
export async function scanStatsReport(db: Db, window: { from: string; to: string }, now: Date): Promise<ScanStatsReport> {
  const { from, to } = window;
  const inWindow = db.selectFrom('scan_daily_stats').where('day', '>=', from).where('day', '<=', to);
  const [byDayState, byCountryState, byType, through] = await Promise.all([
    inWindow
      .select(['day', 'result_state', sql<number>`sum(n)::int`.as('n')])
      .groupBy(['day', 'result_state'])
      .execute(),
    inWindow
      .select(['country', 'result_state', sql<number>`sum(n)::int`.as('n')])
      .groupBy(['country', 'result_state'])
      .execute(),
    inWindow
      .select(['event_type', sql<number>`sum(n)::int`.as('n')])
      .groupBy('event_type')
      .execute(),
    countedThrough(db, now),
  ]);

  const days = daySpan(from, to);
  const daily: ScanStatsDay[] = [];
  const dayIndex = new Map<string, ScanStatsDay>();
  for (let i = 0; i < days; i++) {
    const entry = { day: addDays(from, i), total: 0, byState: zeros(VERIFICATION_STATES) };
    daily.push(entry);
    dayIndex.set(entry.day, entry);
  }
  const byState = zeros(VERIFICATION_STATES);
  for (const r of byDayState) {
    const n = Number(r.n);
    const entry = dayIndex.get(r.day);
    if (entry) {
      entry.byState[r.result_state] += n;
      entry.total += n;
    }
    byState[r.result_state] += n;
  }

  const countryIndex = new Map<string, ScanStatsCountry>();
  for (const r of byCountryState) {
    const country = r.country.trim();
    let c = countryIndex.get(country);
    if (!c) countryIndex.set(country, (c = { country, total: 0, signals: 0, byState: zeros(VERIFICATION_STATES) }));
    const n = Number(r.n);
    c.byState[r.result_state] += n;
    c.total += n;
    if ((SIGNAL_STATES as readonly string[]).includes(r.result_state)) c.signals += n;
  }
  const countries = [...countryIndex.values()].sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));

  const byEventType = zeros(SCAN_STAT_EVENT_TYPES);
  for (const r of byType) byEventType[r.event_type] += Number(r.n);

  const signals = { ...zeros(SIGNAL_STATES), total: 0 };
  for (const s of SIGNAL_STATES) {
    signals[s] = byState[s];
    signals.total += byState[s];
  }

  return {
    from,
    to,
    days,
    through,
    total: Object.values(byState).reduce((a, b) => a + b, 0),
    byState,
    byEventType,
    signals,
    daily,
    countries,
  };
}

// ── Months (plan NEXT-NINE, BP-29 GROWTH) ──────────────────────────────────

/**
 * The scans of each UTC month from the month of `from` to the month of `to` (`YYYY-MM`, both included), as
 * Analytics counts them (`scan_daily_stats`, every country, state and type: staff scans are never in it): one entry
 * per month that has scans, oldest first. GROWTH's funnel reads its « Scans » from it (services/growth.ts).
 */
export async function scanMonths(db: Db, from: string, to: string): Promise<{ month: string; scans: number }[]> {
  const rows = await db
    .selectFrom('scan_daily_stats')
    .select([sql<string>`to_char(day, 'YYYY-MM')`.as('month'), sql<number>`sum(n)::int`.as('scans')])
    .where('day', '>=', `${from}-01`)
    .where('day', '<', sql<string>`(${`${to}-01`}::date + interval '1 month')::date`)
    .groupBy(sql`to_char(day, 'YYYY-MM')`)
    .orderBy(sql`to_char(day, 'YYYY-MM')`)
    .execute();
  return rows.map((r) => ({ month: r.month, scans: Number(r.scans) }));
}
