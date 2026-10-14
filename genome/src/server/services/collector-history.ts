/**
 * The monthly history of each collector (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.8 item 3, C.10, §3.0 (f) row
 * 13; step 9.5; migration 0047 `collector_history`): for « how it changes over time » and the monthly cohorts, each
 * counted collector keeps, per Paris month, the engagement score at the month's end, the tier held at its end and
 * whether it was active in it, in one row of arrays (at most HISTORY_MAX_MONTHS months).
 *
 *   writeMonth  month M (`YYYY-MM-01`, a month already ended) for every counted collector (population.ts
 *               `countedCollector`: no test entrant, no team account, no DELETED account; LOCKED ones counted) made
 *               before M's end whose row is missing or stops before M. Each gets the months after its `last_month` up
 *               to M (a row's first: HISTORY_BACKFILL_MONTHS months back from M, or the account's month of creation if
 *               later; so a collector made during M starts at M): the tier at each month's end (the pieces held at that
 *               instant, from the ownership intervals, CLUB_EXCLUDED_STATUSES left out, by CLUB_TIER_THRESHOLDS as the
 *               tiers count them), the activity in it (insights-scope.ts `activeIn`: a sign-in, a scan, a view, a draw
 *               entry, a LIVE entry or an order), and the score: M's from `account_scores` when `withScores`, NULL for
 *               every other month (not measured). Past HISTORY_MAX_MONTHS the oldest months are dropped and
 *               `first_month` moves on. HISTORY_BATCH accounts by keyset on the account, each batch its own short
 *               transaction (`UPDATE … FROM (VALUES …)` where the row still ends where it was read, `INSERT … ON
 *               CONFLICT DO NOTHING` for a new one), HISTORY_PAUSE_MS between two batches: a batch run twice writes
 *               nothing the second time, and a restart resumes where it stopped.
 *   backfill    once, when the table is empty (the first deployment): writeMonth of the month just ended without
 *               scores, which writes the 12 months before the current one for every counted collector, the oldest
 *               first in each row (views did not exist then; the scores are 'Not measured'). Logged 'collector history
 *               back-filled: 12 months, N collectors'.
 *   runCollectorHistory  the housekeeping job `collectorHistory`, after `engagement` in the lot's morning window. Never
 *               while a test of test entrants is RUNNING (a load test and a batch job never meet; a later pass writes).
 *               The table empty: the back-fill. On Paris day 1: the month just ended, once that day's
 *               `engagement_runs` row is finished, with the scores; from HISTORY_SCORE_WAIT_UTC_HOUR:00 UTC without it,
 *               with no score (logged 'collector history written without the morning’s score'). Any other day: only
 *               the collectors a back-fill or a day 1 left behind (a restart, a test running all day), without scores.
 *               Its figure is the rows written.
 *
 * Nothing here is audited (derived data, §3.0 (m)); nothing reaches a collector. Every month is a Paris month computed
 * in JavaScript (schedule.ts) and passed to SQL as a timestamptz or a date (§3.0 (e)).
 */
import { sql } from 'kysely';
import { uuidArray, type Db } from '../db/connection.js';
import { noopLogger, type Logger } from '../types.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_THRESHOLDS } from './club.js';
import { activeIn } from './insights-scope.js';
import { countedCollector } from './population.js';
import { morningWindowOpen, parisDay, parisMonthStart } from './schedule.js';

/** The months a row keeps at most: 12, the previous 12, and the cohorts' 12-month mark (§3.6 C.8). */
export const HISTORY_MAX_MONTHS = 36;
/** The months the first deployment writes back, before the current one. */
export const HISTORY_BACKFILL_MONTHS = 12;
/** The accounts of one batch, and the pause between two. */
export const HISTORY_BATCH = 1_000;
export const HISTORY_PAUSE_MS = 200;
/** On day 1, the hour (UTC) from which the month is written without the morning's score. */
export const HISTORY_SCORE_WAIT_UTC_HOUR = 12;

// ── Months ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The month `n` months after (before, when negative) `month`, both `YYYY-MM-01`. */
export function plusMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const k = y * 12 + (m - 1) + n;
  return `${String(Math.floor(k / 12)).padStart(4, '0')}-${String((k % 12) + 1).padStart(2, '0')}-01`;
}

/** Months from `a` to `b` (0 for the same month), both `YYYY-MM-01`. */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return yb * 12 + mb - (ya * 12 + ma);
}

/** The Paris month of an instant, `YYYY-MM-01`. */
export const parisMonthOf = (at: Date): string => `${parisDay(at).slice(0, 7)}-01`;

/** A month's first instant and its end (the next month's first instant, exclusive). */
const monthBounds = (month: string): { start: Date; end: Date } => ({ start: parisMonthStart(month.slice(0, 7)), end: parisMonthStart(plusMonths(month, 1).slice(0, 7)) });

/** The tier of `pieces` held, by CLUB_TIER_THRESHOLDS (1 TITANE, 5 PLATINE, 10 PALLADIUM). */
export function tierOfPieces(pieces: number): number {
  let tier = 0;
  CLUB_TIER_THRESHOLDS.forEach((t, i) => {
    if (pieces >= t) tier = i + 1;
  });
  return tier;
}

/** A Postgres array literal of numbers, NULLs or booleans (passed as text, then cast). */
const literal = (values: readonly (number | boolean | null)[]): string => `{${values.map((v) => (v === null ? 'NULL' : typeof v === 'boolean' ? (v ? 't' : 'f') : String(Math.trunc(v)))).join(',')}}`;

// ── Writing a month ────────────────────────────────────────────────────────────────────────────────────────────

export interface WriteOptions {
  /** M's score from account_scores (the morning's run finished); otherwise every month is written not measured. */
  withScores: boolean;
  batchSize?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Written {
  /** Rows inserted or rewritten. */
  rows: number;
  /** Rows that were new. */
  created: number;
}

interface Read {
  id: string;
  created_at: Date;
  first_month: string | null;
  last_month: string | null;
  scores: (number | null)[] | null;
  tiers: number[] | null;
  active: boolean[] | null;
}

/** Month `month` (`YYYY-MM-01`) for every counted collector whose row stops before it (see the file header). */
export async function writeMonth(db: Db, month: string, opts: WriteOptions): Promise<Written> {
  const batchSize = opts.batchSize ?? HISTORY_BATCH;
  const pauseMs = opts.pauseMs ?? HISTORY_PAUSE_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { end } = monthBounds(month);
  const out: Written = { rows: 0, created: 0 };
  for (let after: string | null = null; ; ) {
    const batch: Read[] = (
      await sql<Read>`
        SELECT a.id::text AS id, a.created_at, h.first_month::text AS first_month, h.last_month::text AS last_month, h.scores, h.tiers, h.active
          FROM accounts a LEFT JOIN collector_history h ON h.account_id = a.id
         WHERE ${countedCollector('a.id')} AND a.created_at < ${end}::timestamptz
           AND (h.last_month IS NULL OR h.last_month < ${month}::date)
           ${after === null ? sql`` : sql`AND a.id > ${after}::uuid`}
         ORDER BY a.id LIMIT ${batchSize}`.execute(db)
    ).rows;
    if (batch.length === 0) break;
    const w = await writeBatch(db, month, batch, opts.withScores);
    out.rows += w.rows;
    out.created += w.created;
    if (batch.length < batchSize) break;
    after = batch[batch.length - 1]!.id;
    await sleep(pauseMs);
  }
  return out;
}

/** One batch, in one short transaction. */
async function writeBatch(db: Db, month: string, batch: readonly Read[], withScores: boolean): Promise<Written> {
  // Each account's months to write, from the month after its row's last (or its first month) to `month`.
  const plans = batch.map((r) => {
    const last = r.last_month ? String(r.last_month).slice(0, 10) : null;
    let from = last ? plusMonths(last, 1) : null;
    let fresh = last === null;
    // Too far behind to keep its old months: written again from the oldest month kept.
    if (from !== null && monthsBetween(from, month) + 1 >= HISTORY_MAX_MONTHS) {
      from = plusMonths(month, -(HISTORY_MAX_MONTHS - 1));
      fresh = true;
    }
    if (from === null) {
      const created = parisMonthOf(new Date(r.created_at));
      const back = plusMonths(month, -(HISTORY_BACKFILL_MONTHS - 1));
      from = created > back ? created : back;
    }
    const months: string[] = [];
    for (let m = from; m <= month; m = plusMonths(m, 1)) months.push(m);
    return { r, months, fresh, expected: last };
  });
  const ids = batch.map((r) => r.id);
  // The tier at each month's end and the activity in it, one statement per month for the accounts that need it.
  const facts = new Map<string, { tier: number; active: boolean }>();
  const needed = [...new Set(plans.flatMap((p) => p.months))].sort();
  for (const m of needed) {
    const who = plans.filter((p) => p.months.includes(m)).map((p) => p.r.id);
    const { start, end } = monthBounds(m);
    const rows = await sql<{ id: string; pieces: number; active: boolean }>`
      SELECT a.id::text AS id, coalesce(hp.pieces, 0)::int AS pieces, ${activeIn('a.id', start, end)} AS active
        FROM accounts a
        LEFT JOIN (SELECT o.account_id, count(*)::int AS pieces FROM ownership o JOIN products p ON p.id = o.product_id
                    WHERE o.account_id = ANY(${uuidArray(who)}) AND p.status NOT IN (${sql.join([...CLUB_EXCLUDED_STATUSES])})
                      AND o.started_at < ${end}::timestamptz AND (o.ended_at IS NULL OR o.ended_at >= ${end}::timestamptz)
                    GROUP BY o.account_id) hp ON hp.account_id = a.id
       WHERE a.id = ANY(${uuidArray(who)})`.execute(db);
    for (const r of rows.rows) facts.set(`${r.id}/${m}`, { tier: tierOfPieces(Number(r.pieces)), active: Boolean(r.active) });
  }
  const scores = new Map<string, number>();
  if (withScores) {
    const rows = await db.selectFrom('account_scores').select(['account_id', 'score']).where('account_id', 'in', ids).execute();
    for (const r of rows) scores.set(r.account_id, Number(r.score));
  }
  const rows = plans.map((p) => {
    let first = p.fresh ? p.months[0]! : String(p.r.first_month).slice(0, 10);
    let s: (number | null)[] = p.fresh ? [] : [...(p.r.scores ?? [])];
    let t: number[] = p.fresh ? [] : [...(p.r.tiers ?? [])];
    let a: boolean[] = p.fresh ? [] : [...(p.r.active ?? [])];
    for (const m of p.months) {
      const f = facts.get(`${p.r.id}/${m}`) ?? { tier: 0, active: false };
      s.push(m === month && withScores ? (scores.get(p.r.id) ?? null) : null);
      t.push(f.tier);
      a.push(f.active);
    }
    const over = a.length - HISTORY_MAX_MONTHS;
    if (over > 0) {
      s = s.slice(over);
      t = t.slice(over);
      a = a.slice(over);
      first = plusMonths(first, over);
    }
    return { id: p.r.id, first, s, t, a, isNew: p.r.last_month === null && p.r.first_month === null, expected: p.expected };
  });
  return db.transaction().execute(async (tx) => {
    let written = 0;
    let created = 0;
    const updates = rows.filter((r) => !r.isNew);
    if (updates.length) {
      const values = sql.join(updates.map((r) => sql`(${r.id}::uuid, ${r.first}::date, ${literal(r.s)}::smallint[], ${literal(r.t)}::smallint[], ${literal(r.a)}::boolean[], ${r.expected}::date)`));
      const done = await sql<{ account_id: string }>`
        UPDATE collector_history h
           SET first_month = v.first_month, scores = v.scores, tiers = v.tiers, active = v.active, last_month = ${month}::date
          FROM (VALUES ${values}) AS v(account_id, first_month, scores, tiers, active, expected)
         WHERE h.account_id = v.account_id AND h.last_month IS NOT DISTINCT FROM v.expected
        RETURNING h.account_id`.execute(tx);
      written += done.rows.length;
    }
    const inserts = rows.filter((r) => r.isNew);
    if (inserts.length) {
      const values = sql.join(inserts.map((r) => sql`(${r.id}::uuid, ${r.first}::date, ${literal(r.s)}::smallint[], ${literal(r.t)}::smallint[], ${literal(r.a)}::boolean[], ${month}::date)`));
      const done = await sql<{ account_id: string }>`
        INSERT INTO collector_history (account_id, first_month, scores, tiers, active, last_month) VALUES ${values}
        ON CONFLICT (account_id) DO NOTHING RETURNING account_id`.execute(tx);
      written += done.rows.length;
      created += done.rows.length;
    }
    return { rows: written, created };
  });
}

/** The month just ended at `now`, `YYYY-MM-01`. */
export const monthEnded = (now: Date): string => plusMonths(parisMonthOf(now), -1);

/** The first deployment's back-fill, when the table is empty (see the file header); 0 otherwise. */
export async function backfill(db: Db, now: Date, opts: Omit<WriteOptions, 'withScores'> & { log?: Logger } = {}): Promise<Written> {
  const any = await db.selectFrom('collector_history').select('account_id').limit(1).executeTakeFirst();
  if (any) return { rows: 0, created: 0 };
  const w = await writeMonth(db, monthEnded(now), { ...opts, withScores: false });
  if (w.rows > 0) (opts.log ?? noopLogger).info({ job: 'collectorHistory', months: HISTORY_BACKFILL_MONTHS, collectors: w.created }, `collector history back-filled: ${HISTORY_BACKFILL_MONTHS} months, ${w.created} collectors`);
  return w;
}

export interface HistoryJobOptions extends Omit<WriteOptions, 'withScores'> {
  log?: Logger;
  /**
   * The housekeeping's in-process memo (context.ts, like its `sizesDay`): the Paris day a pass last found nobody left
   * behind, so the rest of that day's passes skip the check (§3.6 C.10: a job that works once a month). One left
   * behind later in the day (a test entrant's test ended) is written at the next day's first pass.
   */
  memo?: HistoryMemo;
}

export interface HistoryMemo {
  clearDay: string | null;
}

/** The housekeeping job `collectorHistory` (see the file header): the rows written by this pass. */
export async function runCollectorHistory(db: Db, now: Date, opts: HistoryJobOptions = {}): Promise<number> {
  const log = opts.log ?? noopLogger;
  if (!morningWindowOpen(now)) return 0;
  const test = await sql<{ running: boolean }>`SELECT EXISTS (SELECT 1 FROM test_runs WHERE status = 'RUNNING') AS running`.execute(db);
  if (test.rows[0]?.running) return 0;
  const month = monthEnded(now);
  const first = await backfill(db, now, opts);
  if (first.rows > 0) return first.rows;
  const today = parisDay(now);
  if (opts.memo?.clearDay === today) return 0;
  // Anyone left behind: a counted collector made before this month whose row stops before the month just ended.
  const behind = await sql<{ behind: boolean }>`
    SELECT EXISTS (SELECT 1 FROM accounts a LEFT JOIN collector_history h ON h.account_id = a.id
                    WHERE ${countedCollector('a.id')} AND a.created_at < ${parisMonthStart(now)}::timestamptz
                      AND (h.last_month IS NULL OR h.last_month < ${month}::date)) AS behind`.execute(db);
  if (!behind.rows[0]?.behind) {
    if (opts.memo) opts.memo.clearDay = today;
    return 0;
  }
  if (today.endsWith('-01')) {
    const run = await db.selectFrom('engagement_runs').select('day').where('day', '=', today).where('finished_at', 'is not', null).executeTakeFirst();
    if (run) return (await writeMonth(db, month, { ...opts, withScores: true })).rows;
    if (now.getUTCHours() < HISTORY_SCORE_WAIT_UTC_HOUR) return 0;
    const w = await writeMonth(db, month, { ...opts, withScores: false });
    log.warn({ job: 'collectorHistory', month: month.slice(0, 7), rows: w.rows }, 'collector history written without the morning’s score');
    return w.rows;
  }
  return (await writeMonth(db, month, { ...opts, withScores: false })).rows;
}
