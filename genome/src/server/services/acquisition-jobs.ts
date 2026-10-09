/**
 * Where they come from, the daily work (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.8, §3.0 (e) and (f), step
 * 4.5): the three jobs the app's housekeeping runs (context.ts `startHousekeeping`), offered by AcquisitionService. No
 * timer of its own, no process: one pass every 10 minutes, never two at once, each job isolated and logged, never thrown.
 *
 *   acquisitionConversions  recordConversions, every pass: each sign-up, draw entry, LIVE RELEASE entry and order
 *               written since the recording started gets its one conversion (`acquisition_conversions`), with its last
 *               link (AcquisitionService.lastSourceAt's rule, `lastTouch`) judged at the act's MOMENT (§3.4 A.5), never
 *               when its row was written: a sign-up at its creation, an entry when made, an order of a draw at its
 *               entry, of a LIVE RELEASE at its room entry, of the private salon at its request, an order travelling with
 *               another at that order's moment, any other at its reservation; a moment before the recording's start
 *               names BEFORE (« Before tracking »). A GIFT order is never one. The CANDIDATES are found by when their row
 *               was written (`accounts.created_at`, `drop_entries.created_at`, `live_entries.joined_at`,
 *               `orders.reserved_at`, on their indexes), from CONVERSIONS_OVERLAP_MS before the watermark
 *               (`acquisition_state.conversions_until`) to CONVERSIONS_LAG_MS before now, at most CONVERSIONS_BATCH a
 *               kind a pass, the oldest first, never a test entrant's; a sign-up only once it is SIGNUP_NET_DELAY_MS
 *               old (the attach at the sign-up writes it; this is the safety net), its first source written too when
 *               missing (set by JOB, DIRECT). One set-based INSERT … SELECT … ON CONFLICT (kind, ref_id) DO NOTHING per
 *               kind and the watermark, in one transaction: the watermark moves to now − CONVERSIONS_LAG_MS when every
 *               kind came back under the batch, else to the latest written time of a full kind's batch (the next pass
 *               resumes there). A pass repeated writes nothing new.
 *               Once a Paris day in the morning window (`catch_up_on` before today): the CATCH-UP, the same statements
 *               without the written-time window, over every row written since the start with no conversion, at most
 *               CATCH_UP_BATCH a kind, then `catch_up_on` = today: an order made with a past reservation behind the
 *               watermark, or a transaction that committed late, is never missed.
 *   acquisitionDaily  summariseDays, in the morning window: each complete Paris day after `daily_until` (from the
 *               recording's first day) up to yesterday, ONE DAY PER TRANSACTION, at most DAILY_MAX_DAYS a pass: the
 *               day's visits (`acquisition_touches`: visits and arrivals by source) and first visits (the devices first
 *               seen that day, by their first source) into `acquisition_daily`, ON CONFLICT DO UPDATE with the same
 *               figures, then `daily_until` moved.
 *   acquisitionPurge  purgeTouches, right after it and only when it succeeded in the same pass: the visits older than 13
 *               Paris calendar months (tracking.ts viewHistoryCutoff) whose day is summarised, in batches of
 *               PURGE_BATCH, at most PURGE_MAX_BATCHES a pass. The devices themselves go with TrackingService
 *               .purgeDevices, after it, which keeps any device a visit still names.
 *
 * Nothing here is audited: conversions and visits are data, not decisions (§3.0 (m)). Every Paris bound is computed in
 * JavaScript (services/schedule.ts) and passed to SQL as a timestamptz or a date (§3.0 (e)).
 */
import { sql, type RawBuilder } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { ConversionKind } from '../db/schema.js';
import { fixedSourceIds, lastTouch, type FixedSourceIds } from './acquisition.js';
import { notTestEntrant } from './population.js';
import { morningWindowOpen, parisDay, parisDayStart } from './schedule.js';
import { nextParisDay, viewHistoryCutoff } from './tracking.js';

/** The candidates' window reaches back this far before the watermark: a row that committed a little late is still found. */
export const CONVERSIONS_OVERLAP_MS = 60 * 60_000;
/** The candidates stop this long before now: a row written in the last minute waits for the next pass. */
export const CONVERSIONS_LAG_MS = 60_000;
/** A sign-up is the job's only once this old: the attach at the sign-up writes it first. */
export const SIGNUP_NET_DELAY_MS = 5 * 60_000;
/** Candidates a kind a pass at most. */
export const CONVERSIONS_BATCH = 1_000;
/** Candidates a kind in the daily catch-up at most. */
export const CATCH_UP_BATCH = 5_000;
/** Paris days `summariseDays` summarises at most a pass. */
export const DAILY_MAX_DAYS = 31;
/** Visits `purgeTouches` deletes a batch, and its batches a pass. */
export const PURGE_BATCH = 5_000;
export const PURGE_MAX_BATCHES = 20;

/** What `recordConversions` wrote. */
export interface ConversionsOutcome {
  /** Conversions written by the pass's window. */
  written: number;
  /** Conversions written by the daily catch-up (0 when it did not run). */
  caughtUp: number;
  /** The catch-up ran in this pass. */
  catchUp: boolean;
}

interface Window {
  /** Written at or after (null: since the recording's start only). */
  from: Date | null;
  /** Written before. */
  to: Date;
  limit: number;
}

interface KindOutcome {
  candidates: number;
  lastWritten: Date | null;
  written: number;
}

/** A bound in SQL, or no bound. */
const atLeast = (column: RawBuilder<unknown>, bound: Date | null) => (bound ? sql`AND ${column} >= ${bound}::timestamptz` : sql``);

/** The insert of one kind's conversions over `w` (see the header); its candidates, their latest written time, the rows written. */
async function convertKind(tx: Db, kind: ConversionKind, w: Window, started: Date, ids: FixedSourceIds, now: Date): Promise<KindOutcome> {
  const last = (account: RawBuilder<unknown>, at: RawBuilder<unknown>) =>
    sql`CASE WHEN ${at} < ${started}::timestamptz THEN ${ids.BEFORE}::integer ELSE coalesce(${lastTouch(account, at)}, ${ids.DIRECT}::integer) END`;
  let cand: RawBuilder<unknown>;
  let extra = sql``;
  if (kind === 'SIGNUP') {
    const net = new Date(Math.min(w.to.getTime(), now.getTime() - SIGNUP_NET_DELAY_MS));
    cand = sql`
      SELECT a.id AS ref_id, a.id AS account_id, a.created_at AS written, a.created_at AS at
        FROM accounts a
       WHERE a.created_at >= ${started}::timestamptz ${atLeast(sql`a.created_at`, w.from)} AND a.created_at < ${net}::timestamptz
         AND NOT EXISTS (SELECT 1 FROM acquisition_conversions x WHERE x.kind = 'SIGNUP' AND x.ref_id = a.id)
         AND ${notTestEntrant('a.id')}
       ORDER BY a.created_at, a.id LIMIT ${w.limit}`;
    // The safety net's first source: Direct, when the sign-up's attach wrote none.
    extra = sql`, src AS (
      INSERT INTO account_sources (account_id, first_source_id, first_seen_at, set_at, set_by)
      SELECT cand.account_id, ${ids.DIRECT}::integer, cand.at, ${now}::timestamptz, 'JOB' FROM cand
      ON CONFLICT (account_id) DO NOTHING RETURNING account_id)`;
  } else if (kind === 'DRAW_ENTRY') {
    cand = sql`
      SELECT e.id AS ref_id, e.account_id, e.created_at AS written, e.created_at AS at
        FROM drop_entries e
       WHERE e.created_at >= ${started}::timestamptz ${atLeast(sql`e.created_at`, w.from)} AND e.created_at < ${w.to}::timestamptz
         AND NOT EXISTS (SELECT 1 FROM acquisition_conversions x WHERE x.kind = 'DRAW_ENTRY' AND x.ref_id = e.id)
         AND ${notTestEntrant('e.account_id')}
       ORDER BY e.created_at, e.id LIMIT ${w.limit}`;
  } else if (kind === 'LIVE_ENTRY') {
    cand = sql`
      SELECT e.id AS ref_id, e.account_id, e.joined_at AS written, e.joined_at AS at
        FROM live_entries e
       WHERE e.joined_at >= ${started}::timestamptz ${atLeast(sql`e.joined_at`, w.from)} AND e.joined_at < ${w.to}::timestamptz
         AND NOT EXISTS (SELECT 1 FROM acquisition_conversions x WHERE x.kind = 'LIVE_ENTRY' AND x.ref_id = e.id)
         AND ${notTestEntrant('e.account_id')}
       ORDER BY e.joined_at, e.id LIMIT ${w.limit}`;
  } else {
    // An order's moment is the collector's act (§3.4 A.5): its draw entry, its room entry, its salon request; an order
    // travelling with another, that order's; else its reservation.
    cand = sql`
      SELECT o.id AS ref_id, o.account_id, o.reserved_at AS written,
             coalesce(de.created_at, le.joined_at, sr.created_at, pde.created_at, ple.joined_at, psr.created_at, p.reserved_at, o.reserved_at) AS at
        FROM orders o
        LEFT JOIN drop_entries de ON de.id = o.drop_entry_id
        LEFT JOIN live_entries le ON le.id = o.live_entry_id
        LEFT JOIN shop_requests sr ON sr.id = o.shop_request_id
        LEFT JOIN orders p ON p.id = o.with_order_id AND o.drop_entry_id IS NULL AND o.live_entry_id IS NULL AND o.shop_request_id IS NULL
        LEFT JOIN drop_entries pde ON pde.id = p.drop_entry_id
        LEFT JOIN live_entries ple ON ple.id = p.live_entry_id
        LEFT JOIN shop_requests psr ON psr.id = p.shop_request_id
       WHERE o.reserved_at >= ${started}::timestamptz ${atLeast(sql`o.reserved_at`, w.from)} AND o.reserved_at < ${w.to}::timestamptz
         AND o.channel <> 'GIFT'
         AND NOT EXISTS (SELECT 1 FROM acquisition_conversions x WHERE x.kind = 'ORDER' AND x.ref_id = o.id)
         AND ${notTestEntrant('o.account_id')}
       ORDER BY o.reserved_at, o.id LIMIT ${w.limit}`;
  }
  const r = await sql<{ candidates: number; last_written: Date | null; written: number }>`
    WITH cand AS (${cand}),
    ins AS (
      INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
      SELECT ${kind}, cand.ref_id, cand.account_id, cand.at, ${last(sql`cand.account_id`, sql`cand.at`)}, ${now}::timestamptz FROM cand
      ON CONFLICT (kind, ref_id) DO NOTHING RETURNING 1)${extra}
    SELECT (SELECT count(*) FROM cand)::int AS candidates, (SELECT max(written) FROM cand) AS last_written, (SELECT count(*) FROM ins)::int AS written`.execute(tx);
  const row = r.rows[0]!;
  return { candidates: Number(row.candidates), lastWritten: row.last_written ? new Date(row.last_written) : null, written: Number(row.written) };
}

const KINDS: readonly ConversionKind[] = ['SIGNUP', 'DRAW_ENTRY', 'LIVE_ENTRY', 'ORDER'];

/** Job `acquisitionConversions` (see the header). Nothing before AcquisitionService.prepare wrote the state row. */
export async function recordConversions(db: Db, now: Date, opts: { batch?: number; catchUpBatch?: number } = {}): Promise<ConversionsOutcome> {
  const batch = opts.batch ?? CONVERSIONS_BATCH;
  const out: ConversionsOutcome = { written: 0, caughtUp: 0, catchUp: false };
  const to = new Date(now.getTime() - CONVERSIONS_LAG_MS);
  const ran = await inTransaction(db, async (tx) => {
    const state = await tx.selectFrom('acquisition_state').selectAll().where('id', '=', 1).forUpdate().executeTakeFirst();
    if (!state) return null;
    const ids = await fixedSourceIds(tx);
    const from = new Date(state.conversions_until.getTime() - CONVERSIONS_OVERLAP_MS);
    let until = to;
    for (const kind of KINDS) {
      const k = await convertKind(tx, kind, { from, to, limit: batch }, state.tracking_started_at, ids, now);
      out.written += k.written;
      // A full batch: the next pass resumes from its latest written time (the overlap covers the rows at that instant).
      if (k.candidates >= batch && k.lastWritten && k.lastWritten < until) until = k.lastWritten;
    }
    await tx.updateTable('acquisition_state').set({ conversions_until: until }).where('id', '=', 1).execute();
    return state;
  });
  if (!ran) return out;
  // The daily catch-up, once a Paris day in the morning window.
  const today = parisDay(now);
  if (!morningWindowOpen(now) || (ran.catch_up_on !== null && ran.catch_up_on >= today)) return out;
  await inTransaction(db, async (tx) => {
    const state = await tx.selectFrom('acquisition_state').selectAll().where('id', '=', 1).forUpdate().executeTakeFirstOrThrow();
    if (state.catch_up_on !== null && state.catch_up_on >= today) return;
    const ids = await fixedSourceIds(tx);
    for (const kind of KINDS) out.caughtUp += (await convertKind(tx, kind, { from: null, to, limit: opts.catchUpBatch ?? CATCH_UP_BATCH }, state.tracking_started_at, ids, now)).written;
    await tx.updateTable('acquisition_state').set({ catch_up_on: today }).where('id', '=', 1).execute();
    out.catchUp = true;
  });
  return out;
}

/** The Paris day before `YYYY-MM-DD`. */
function previousParisDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Job `acquisitionDaily` (see the header): the days summarised. Only in the morning window. */
export async function summariseDays(db: Db, now: Date, opts: { maxDays?: number } = {}): Promise<number> {
  if (!morningWindowOpen(now)) return 0;
  const state = await db.selectFrom('acquisition_state').select(['tracking_started_at', 'daily_until']).where('id', '=', 1).executeTakeFirst();
  if (!state) return 0;
  const yesterday = previousParisDay(parisDay(now));
  let day = state.daily_until ? nextParisDay(state.daily_until) : parisDay(state.tracking_started_at);
  let done = 0;
  while (day <= yesterday && done < (opts.maxDays ?? DAILY_MAX_DAYS)) {
    const start = parisDayStart(day);
    const end = parisDayStart(nextParisDay(day));
    const moved = await inTransaction(db, async (tx) => {
      // Another process got here first: the day is summarised already.
      const s = await tx.selectFrom('acquisition_state').select('daily_until').where('id', '=', 1).forUpdate().executeTakeFirstOrThrow();
      if (s.daily_until !== null && s.daily_until >= day) return false;
      await sql`
        INSERT INTO acquisition_daily (source_id, day, visits, first_visits, arrivals)
        SELECT x.source_id, ${day}::date, sum(x.visits)::int, sum(x.first_visits)::int, sum(x.arrivals)::int
          FROM (SELECT t.source_id, 1 AS visits, 0 AS first_visits, t.arrivals FROM acquisition_touches t WHERE t.day = ${day}::date
                UNION ALL
                SELECT d.first_source_id, 0, 1, 0 FROM tracking_devices d
                 WHERE d.first_source_id IS NOT NULL AND d.first_seen_at >= ${start}::timestamptz AND d.first_seen_at < ${end}::timestamptz) x
         GROUP BY x.source_id
        ON CONFLICT (source_id, day) DO UPDATE SET visits = EXCLUDED.visits, first_visits = EXCLUDED.first_visits, arrivals = EXCLUDED.arrivals`.execute(tx);
      await tx.updateTable('acquisition_state').set({ daily_until: day }).where('id', '=', 1).execute();
      return true;
    });
    if (moved) done += 1;
    day = nextParisDay(day);
  }
  return done;
}

/**
 * Job `acquisitionPurge` (see the header): the visits deleted. The first Paris day kept is the views' (13 calendar
 * months, tracking.ts viewHistoryCutoff); a day is deleted only once `acquisition_daily` holds it.
 */
export async function purgeTouches(db: Db, now: Date, opts: { batch?: number; maxBatches?: number } = {}): Promise<number> {
  if (!morningWindowOpen(now)) return 0;
  const state = await db.selectFrom('acquisition_state').select('daily_until').where('id', '=', 1).executeTakeFirst();
  if (!state?.daily_until) return 0;
  const firstKept = parisDay(viewHistoryCutoff(now));
  const batch = opts.batch ?? PURGE_BATCH;
  let deleted = 0;
  for (let i = 0; i < (opts.maxBatches ?? PURGE_MAX_BATCHES); i++) {
    const r = await sql`
      DELETE FROM acquisition_touches WHERE id IN (
        SELECT id FROM acquisition_touches WHERE day < ${firstKept}::date AND day <= ${state.daily_until}::date LIMIT ${batch})`.execute(db);
    const n = Number(r.numAffectedRows ?? 0);
    deleted += n;
    if (n < batch) break;
  }
  return deleted;
}
