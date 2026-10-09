/**
 * The views' daily work (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.10, §3.0 (e) and (f), step 3.7): the jobs the
 * app's housekeeping runs in the lot's morning window (context.ts `startHousekeeping`, services/schedule.ts
 * `morningWindowOpen`), in the order of §3.0 (f). No timer of its own, no process: one pass every 10 minutes, never two
 * at once, each job isolated and logged, never thrown.
 *
 *   viewStats   aggregateViews: each complete Paris day not counted yet, up to yesterday, ONE DAY PER TRANSACTION and
 *               at most VIEW_STATS_MAX_DAYS a pass (a first run after a gap catches up over a few passes). Each day's
 *               transaction takes the advisory lock `orbes/views-daily` (the link's, services/tracking.ts: a link and a
 *               day's count never cross), then writes the day's anonymous totals into `view_daily_stats` (by page,
 *               subject and the place's country, 'ZZ' unknown: views, seconds, distinct devices, signed-in views) and
 *               `device_daily_stats` (by country and the device's class: devices, new devices, signed-in devices),
 *               adds the day to each collector's places (`collector_places`), and writes the day's marker row (page 0,
 *               counts 0), so a day without a view is counted too. A day is counted once: the next pass starts after
 *               the newest marker, and a day whose marker is there is skipped inside the lock. Test entrants and the
 *               team's own accounts are left out (services/tracking.ts countedViewRow). The first day counted is the
 *               earliest of the oldest row's Paris day and the recording's start; nothing is counted until the past
 *               scans' backfill is done (`tracking_state.scans_backfilled_at`), since it writes rows of days already
 *               past; meanwhile each pass calls `onBackfillPending` (the housekeeping resumes a backfill that failed,
 *               TrackingService.resumeBackfill, and logs that the views are not counted yet).
 *   viewMonths  in the same transaction as the count of a month's last Paris day (on Paris day 1, the month just
 *               ended): every collector with rows that month gets its row in `collector_view_months` (views, seconds,
 *               scans, active Paris days), INSERT … ON CONFLICT DO NOTHING. So a month is written exactly when its last
 *               day is counted (tracking.ts monthWritten), once, and a link that later attaches rows of a written month
 *               adds them (tracking.ts catchUpCounted) while the rows of a month not written yet wait for it. The pass's
 *               `viewMonths` is how many months its `viewStats` wrote.
 *   viewPurge   purgeViews (run only when viewStats succeeded in the same pass): the raw rows older than 13 Paris
 *               calendar months (tracking.ts viewHistoryCutoff), ONE WHOLE PARIS DAY PER TRANSACTION, the oldest first,
 *               at most VIEW_PURGE_MAX_DAYS a pass, and only a day already counted whose month is written: its
 *               signed-in rows are folded into `collector_view_totals` (per collector, page
 *               and subject: views, seconds, first and last), then the day is deleted on `collector_views_at_idx`.
 *               Folding and deleting in one transaction, a day is never folded twice. Anonymous rows go without a
 *               fold: the daily totals keep them.
 *   devicePurge TrackingService.purgeDevices (services/tracking.ts), after viewPurge.
 *   sizes       intelligenceSizes: once a Paris day in the window, `pg_total_relation_size` of the lot's growing
 *               tables (those that exist), for the `intelligence sizes` log line (the 50 MB backup watch, §8), kept by
 *               IntelligenceSizes (`ctx.services.intelligenceSizes`) for Server status's « Visitor data » line (§3.4
 *               A.10.7, step 4.10): the last figures measured, read once on demand while this process has none.
 *
 * Every bound is a Paris day or month computed here in JavaScript (services/schedule.ts) and passed to SQL as
 * timestamptz, so PostgreSQL and PGlite agree whatever time-zone data they carry (§3.0 (e)).
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { VIEW_PAGE_CODES } from '../db/schema.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { UNKNOWN_COUNTRY } from './scan-stats.js';
import { parisDay, parisDayStart, parisMonthStart } from './schedule.js';
import { countedViewRow, lastDayOfMonth, lockViewsDaily, monthWritten, nextParisDay, NIL_UUID, viewHistoryCutoff, viewsCountedThrough } from './tracking.js';

/** The nil uuid and 'ZZ' as SQL literals: an expression in GROUP BY must be the same text as in the select list. */
const NIL = sql.raw(`'${NIL_UUID}'::uuid`);
const ZZ = sql.raw(`'${UNKNOWN_COUNTRY}'`);

/** The Paris days `aggregateViews` counts at most a pass. */
export const VIEW_STATS_MAX_DAYS = 31;
/** The Paris days `purgeViews` folds and deletes at most a pass. */
export const VIEW_PURGE_MAX_DAYS = 7;

/**
 * The lot's growing tables (§3.3 T.10): the `intelligence sizes` line measures those that exist (the acquisition's since
 * migration 0043).
 */
export const INTELLIGENCE_TABLES = [
  'collector_views',
  'tracking_devices',
  'view_daily_stats',
  'acquisition_touches',
  'acquisition_conversions',
  'account_wishes',
  'account_profiles',
  'account_tastes',
] as const;

/** The Paris day before `YYYY-MM-DD`. */
function previousParisDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The Paris month after `YYYY-MM`. */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${String(y + 1).padStart(4, '0')}-01` : `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
}

/** The start of every Paris day of a month `YYYY-MM`, in order: the thresholds that number a row's day (width_bucket). */
function dayStartsOf(month: string): Date[] {
  const out: Date[] = [];
  for (let day = `${month}-01`; day.startsWith(month); day = nextParisDay(day)) out.push(parisDayStart(day));
  return out;
}

const oldestRowAt = async (db: Db): Promise<Date | null> => {
  const r = await db.selectFrom('collector_views').select((eb) => eb.fn.min('at').as('at')).executeTakeFirst();
  return (r?.at as Date | null | undefined) ?? null;
};

/**
 * Write the Paris month `YYYY-MM` into `collector_view_months` (see the header), inside the transaction of its last
 * day's count. The active days are numbered by the month's Paris day starts (width_bucket), computed here.
 */
async function writeMonth(tx: Db, month: string): Promise<void> {
  const start = parisMonthStart(month);
  const end = parisMonthStart(nextMonth(month));
  const thresholds = sql.join(dayStartsOf(month).map((d) => sql`${d}::timestamptz`));
  await sql`
    INSERT INTO collector_view_months (account_id, month, views, seconds, scans, active_days)
    SELECT v.account_id, ${`${month}-01`}::date,
           (count(*) FILTER (WHERE v.page <> ${VIEW_PAGE_CODES.SCAN}))::int,
           coalesce(sum(v.seconds), 0)::bigint,
           (count(*) FILTER (WHERE v.page = ${VIEW_PAGE_CODES.SCAN}))::int,
           count(DISTINCT width_bucket(v.at, ARRAY[${thresholds}]))::smallint
      FROM collector_views v
     WHERE v.at >= ${start} AND v.at < ${end} AND v.account_id IS NOT NULL AND ${countedViewRow('v.account_id')}
     GROUP BY v.account_id
    ON CONFLICT (account_id, month) DO NOTHING`.execute(tx);
}

/** Count one Paris day (see the header), and its month on its last day. Null when another pass counted it first. */
async function countDay(db: Db, day: string): Promise<{ month: boolean } | null> {
  const start = parisDayStart(day);
  const end = parisDayStart(nextParisDay(day));
  return inTransaction(db, async (tx) => {
    await lockViewsDaily(tx);
    const done = await tx.selectFrom('view_daily_stats').select('day').where('day', '=', day).where('page', '=', 0).executeTakeFirst();
    if (done) return null;
    const inDay = sql`v.at >= ${start} AND v.at < ${end} AND ${countedViewRow('v.account_id')}`;
    await sql`
      INSERT INTO view_daily_stats (day, page, subject, country, views, seconds, devices, signed_in_views)
      SELECT ${day}::date, v.page, coalesce(v.subject, ${NIL}), coalesce(gp.country, ${ZZ}),
             count(*)::int, coalesce(sum(v.seconds), 0)::int, count(DISTINCT v.device_id)::int, count(v.account_id)::int
        FROM collector_views v LEFT JOIN geo_places gp ON gp.id = v.place_id
       WHERE ${inDay}
       GROUP BY v.page, coalesce(v.subject, ${NIL}), coalesce(gp.country, ${ZZ})
      ON CONFLICT (day, page, subject, country) DO UPDATE
        SET views = EXCLUDED.views, seconds = EXCLUDED.seconds, devices = EXCLUDED.devices, signed_in_views = EXCLUDED.signed_in_views`.execute(tx);
    // The device's country that day is the one of its latest row; its class is the device's own.
    await sql`
      INSERT INTO device_daily_stats (day, country, kind, os, browser, opened_in, in_app, devices, new_devices, signed_in_devices)
      SELECT ${day}::date, d.country, td.kind, td.os, td.browser, td.opened_in, coalesce(td.in_app, 'NONE'),
             count(*)::int,
             (count(*) FILTER (WHERE td.first_seen_at >= ${start} AND td.first_seen_at < ${end}))::int,
             (count(*) FILTER (WHERE d.signed_in))::int
        FROM (SELECT v.device_id,
                     (array_agg(coalesce(gp.country, ${ZZ}) ORDER BY v.at DESC, v.id DESC))[1] AS country,
                     bool_or(v.account_id IS NOT NULL) AS signed_in
                FROM collector_views v LEFT JOIN geo_places gp ON gp.id = v.place_id
               WHERE ${inDay}
               GROUP BY v.device_id) d
        JOIN tracking_devices td ON td.id = d.device_id
       GROUP BY d.country, td.kind, td.os, td.browser, td.opened_in, coalesce(td.in_app, 'NONE')
      ON CONFLICT (day, country, kind, os, browser, opened_in, in_app) DO UPDATE
        SET devices = EXCLUDED.devices, new_devices = EXCLUDED.new_devices, signed_in_devices = EXCLUDED.signed_in_devices`.execute(tx);
    // A day is added to a place only once: the days are counted in order, so a day already there is never newer.
    await sql`
      INSERT INTO collector_places (account_id, place_id, days, first_day, last_day)
      SELECT v.account_id, v.place_id, 1, ${day}::date, ${day}::date
        FROM collector_views v
       WHERE ${inDay} AND v.account_id IS NOT NULL AND v.place_id IS NOT NULL
       GROUP BY v.account_id, v.place_id
      ON CONFLICT (account_id, place_id) DO UPDATE
        SET days = collector_places.days + CASE WHEN collector_places.last_day < EXCLUDED.last_day THEN 1 ELSE 0 END,
            first_day = least(collector_places.first_day, EXCLUDED.first_day),
            last_day = greatest(collector_places.last_day, EXCLUDED.last_day)`.execute(tx);
    // The month's last day: the month is written with it (job viewMonths), so « written » is « its last day counted ».
    const lastOfMonth = lastDayOfMonth(day) === day;
    if (lastOfMonth) await writeMonth(tx, day.slice(0, 7));
    await tx
      .insertInto('view_daily_stats')
      .values({ day, page: 0, subject: NIL_UUID, country: UNKNOWN_COUNTRY, views: 0, seconds: 0, devices: 0, signed_in_views: 0 })
      .onConflict((oc) => oc.doNothing())
      .execute();
    return { month: lastOfMonth };
  });
}

/**
 * Jobs `viewStats` and `viewMonths` (see the header). Counts the complete Paris days not counted yet, up to the day
 * before `now`'s, at most `maxDays` a pass, and writes each month whose last day it counts. Returns how many days and
 * months (0 and 0 almost every pass).
 */
export async function aggregateViews(db: Db, now: Date, opts: { maxDays?: number; onBackfillPending?: () => void } = {}): Promise<{ days: number; months: number }> {
  const maxDays = Math.max(1, Math.floor(opts.maxDays ?? VIEW_STATS_MAX_DAYS));
  const yesterday = previousParisDay(parisDay(now));
  const counted = await viewsCountedThrough(db);
  let day: string;
  if (counted !== null) {
    day = nextParisDay(counted);
  } else {
    const state = await db.selectFrom('tracking_state').select(['started_at', 'scans_backfilled_at']).where('id', '=', 1).executeTakeFirst();
    // The past scans are written as rows of days already past: count nothing before they are all there.
    if (!state?.scans_backfilled_at) {
      opts.onBackfillPending?.();
      return { days: 0, months: 0 };
    }
    const oldest = await oldestRowAt(db);
    const startDay = parisDay(state.started_at);
    day = oldest && parisDay(oldest) < startDay ? parisDay(oldest) : startDay;
  }
  const out = { days: 0, months: 0 };
  for (; day <= yesterday && out.days < maxDays; day = nextParisDay(day)) {
    const r = await countDay(db, day);
    if (!r) continue;
    out.days += 1;
    if (r.month) out.months += 1;
  }
  return out;
}

/**
 * Job `viewPurge` (see the header; the housekeeping runs it only when `viewStats` succeeded in the same pass). Returns
 * how many raw rows it deleted.
 */
export async function purgeViews(db: Db, now: Date, opts: { maxDays?: number } = {}): Promise<number> {
  const maxDays = Math.max(1, Math.floor(opts.maxDays ?? VIEW_PURGE_MAX_DAYS));
  const cutoff = viewHistoryCutoff(now);
  const counted = await viewsCountedThrough(db);
  if (counted === null) return 0;
  let deleted = 0;
  for (let days = 0; days < maxDays; days++) {
    const oldest = await oldestRowAt(db);
    if (!oldest || oldest.getTime() >= cutoff.getTime()) break;
    const day = parisDay(oldest);
    // Never a day the totals have not counted, nor one of a month not written yet (the summary holds its rows first).
    if (day > counted || !monthWritten(day, counted)) break;
    const start = parisDayStart(day);
    const end = parisDayStart(nextParisDay(day));
    const n = await inTransaction(db, async (tx) => {
      await lockViewsDaily(tx);
      await sql`
        INSERT INTO collector_view_totals (account_id, page, subject, views, seconds, first_at, last_at)
        SELECT v.account_id, v.page, coalesce(v.subject, ${NIL}), count(*)::int, coalesce(sum(v.seconds), 0)::bigint, min(v.at), max(v.at)
          FROM collector_views v
         WHERE v.at >= ${start} AND v.at < ${end} AND v.account_id IS NOT NULL
         GROUP BY v.account_id, v.page, coalesce(v.subject, ${NIL})
        ON CONFLICT (account_id, page, subject) DO UPDATE
          SET views = collector_view_totals.views + EXCLUDED.views,
              seconds = collector_view_totals.seconds + EXCLUDED.seconds,
              first_at = least(collector_view_totals.first_at, EXCLUDED.first_at),
              last_at = greatest(collector_view_totals.last_at, EXCLUDED.last_at)`.execute(tx);
      const r = await tx.deleteFrom('collector_views').where('at', '>=', start).where('at', '<', end).executeTakeFirst();
      return Number(r.numDeletedRows ?? 0);
    });
    deleted += n;
  }
  return deleted;
}

/**
 * The bytes of the lot's growing tables that exist (`pg_total_relation_size`: the table, its indexes and TOAST), for
 * the `intelligence sizes` line and Server status (§3.3 T.10, §3.4 A.10.7). One query.
 */
export async function intelligenceSizes(db: Db): Promise<Record<string, number>> {
  const names = sql.join(INTELLIGENCE_TABLES.map((t) => sql`${t}::text`));
  const r = await sql<{ name: string; bytes: number | string }>`
    SELECT t.name, pg_total_relation_size(to_regclass(t.name)) AS bytes
      FROM unnest(ARRAY[${names}]) WITH ORDINALITY AS t(name, n)
     WHERE to_regclass(t.name) IS NOT NULL
     ORDER BY t.n`.execute(db);
  return Object.fromEntries(r.rows.map((row) => [row.name, Number(row.bytes)]));
}

/**
 * Server status's « Visitor data » line (§3.4 A.10.7): the bytes of the lot's growing tables (the `intelligence sizes`
 * figures), in all and by part: views (`collector_views` and `view_daily_stats`), devices, visits
 * (`acquisition_touches`), conversions, wishes, profiles (`account_profiles` and `account_tastes`). `at`: when measured.
 */
export interface VisitorData {
  at: string;
  totalBytes: number;
  viewsBytes: number;
  devicesBytes: number;
  visitsBytes: number;
  conversionsBytes: number;
  wishesBytes: number;
  profilesBytes: number;
}

/** The « Visitor data » parts of an `intelligence sizes` measure (a table not there yet counts 0). */
export function visitorDataOf(tables: Readonly<Record<string, number>>, at: Date): VisitorData {
  const of = (...names: (typeof INTELLIGENCE_TABLES)[number][]) => names.reduce((n, t) => n + (tables[t] ?? 0), 0);
  return {
    at: at.toISOString(),
    totalBytes: Object.values(tables).reduce((a, b) => a + b, 0),
    viewsBytes: of('collector_views', 'view_daily_stats'),
    devicesBytes: of('tracking_devices'),
    visitsBytes: of('acquisition_touches'),
    conversionsBytes: of('acquisition_conversions'),
    wishesBytes: of('account_wishes'),
    profilesBytes: of('account_profiles', 'account_tastes'),
  };
}

/** A failed on-demand read is tried again after this long (Server status asks every 2 s). */
export const VISITOR_DATA_RETRY_MS = 10 * 60_000;

/**
 * The last `intelligence sizes` figures of this process (`ctx.services.intelligenceSizes`): the housekeeping's `sizes`
 * job measures them once a Paris day in the morning window; Server status reads them (`visitorData`), and while this
 * process has measured none yet (a boot outside the window) reads them once on demand, a failure tried again after
 * VISITOR_DATA_RETRY_MS. One query; never two at once.
 */
export class IntelligenceSizes {
  private latest: VisitorData | null = null;
  private measuring: Promise<Record<string, number>> | null = null;
  private failedAt = -Infinity;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock = systemClock,
    private readonly log: Logger = noopLogger,
  ) {}

  /** Measure now (the daily job): the tables' bytes, kept for Server status. Throws on a database failure. */
  measure(): Promise<Record<string, number>> {
    this.measuring ??= intelligenceSizes(this.db)
      .then((tables) => {
        this.latest = visitorDataOf(tables, this.clock());
        return tables;
      })
      .finally(() => {
        this.measuring = null;
      });
    return this.measuring;
  }

  /** The last figures; measured now when this process has none. Never throws: null when they cannot be read. */
  async visitorData(): Promise<VisitorData | null> {
    if (this.latest) return this.latest;
    if (this.clock().getTime() - this.failedAt < VISITOR_DATA_RETRY_MS) return null;
    try {
      await this.measure();
    } catch (e) {
      this.failedAt = this.clock().getTime();
      this.log.warn({ err: { message: (e as Error)?.message } }, 'visitor data not measured');
    }
    return this.latest;
  }
}
