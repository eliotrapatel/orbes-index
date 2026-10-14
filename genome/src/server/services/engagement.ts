/**
 * The engagement score (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.3, steps 7.3 to 7.5): a score from 0 to 100
 * for each collector, staff only, calculated each morning by the fixed formula of services/engagement-formula.ts from
 * the 12 months before the run. This file reads the figures behind the five parts and writes the rows; the formula
 * itself is pure, next door.
 *
 *   What is read (SB.3.1), per batch of at most ENGAGEMENT_BATCH accounts, each read `account_id = ANY(batch)` inside
 *   the window (after `from` = now − 365 days, up to now: an act exactly 365 days old is outside) and on the existing
 *   indexes:
 *     acts          the collector's own gestures, each from its table: a scan of an ORBES CODE (the SCAN rows of
 *                   `collector_views`, so an anonymous scan counts once attached to the account at sign-up or
 *                   sign-in), a draw entry or early-access reservation (`drop_entries`, whatever its status), a LIVE
 *                   RELEASE entry (`live_entries`), I'LL BE THERE (`live_interest`), an order (`orders` of channel
 *                   LIVE, DRAW or SALON: never GIFT, never EXCHANGE; a cancelled one stays an act), a piece registered
 *                   (`ownership` by FIRST_REGISTRATION, TRANSFER or RESALE: never ADMIN). Never a page view or a
 *                   sign-in. The latest gives Recency (two at the same instant: the first of SCAN, DRAW, LIVE,
 *                   INTEREST, ORDER, REGISTRATION); the Paris calendar days with one give Frequency (numbered by the
 *                   Paris day starts computed here, §3.0 (e), so PostgreSQL and PGlite agree).
 *     spend         the purchases dated in the window by GROWTH's rule (`purchaseRows`, growth.ts), by currency,
 *                   converted to euros here (toEurMinor); a piece with no known price is a purchase of € 0.
 *     releases      the releases taken part in (`releaseEntries`, participation.ts: the rule of `participationRows`)
 *                   among those opened in the window, each with the minutes from its opening to the entry (before the
 *                   opening: 0); their median gives Release speed.
 *     attendance    the releases taken part in out of those open to the collector, both among the releases opened
 *                   between the later of `from` and the account's creation, and now: every published release open to
 *                   all (a draw; a LIVE RELEASE with no tier, segment, collection, models or participations rule),
 *                   never cancelled, after-rooms left out, plus each restricted release the collector took part in.
 *
 *   Who is scored: the ACTIVE accounts that are not test entrants. A LOCKED account keeps its last row, untouched; a
 *   DELETED account's row and a test entrant's are removed by the daily job.
 *
 *   `scoreBatch` writes a batch in one transaction: a row is inserted, or rewritten only when one of its values (the
 *   formula's number included) differs, so an unchanged score keeps its `changed_at` and costs no write.
 *
 * Nothing here is audited: a score is derived by the system and holds no decision (SB.3.3); the runs' table and the
 * job's log line are its trace. Nothing here is ever sent to a collector.
 */
import { sql } from 'kysely';
import { inTransaction, uuidArray, type Db } from '../db/connection.js';
import { SCORE_ACT_KINDS, VIEW_PAGE_CODES, type ScoreActKind, type ScoreOtherCurrency } from '../db/schema.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { ENGAGEMENT_FORMULA, ENGAGEMENT_WINDOW_DAYS, isOtherCurrency, scoreOf, toEurMinor, type EngagementInputs, type EngagementScore } from './engagement-formula.js';
import { median, purchaseRows } from './growth.js';
import { releaseEntries } from './participation.js';
import { notTestEntrant } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';
import { nextParisDay } from './tracking.js';

/** The accounts scored in one transaction. */
export const ENGAGEMENT_BATCH = 500;
/** The rows of one upsert statement (a batch is written in a few of them, in its one transaction). */
const UPSERT_ROWS = 100;

const DAY_MS = 86_400_000;
const SMALLINT_MAX = 32_767;

/** Where the window of `now` starts, 365 days before it: what is later counts, an act exactly 365 days old does not. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * DAY_MS);
}

/** A release open to every collector, with when it opened (the Attendance part). */
export interface OpenRelease {
  id: string;
  opensAt: Date;
}

/** A batch's result: the scores made, and how many rows were inserted or rewritten. */
export interface ScoredBatch {
  scores: Map<string, number>;
  changed: number;
}

export interface EngagementServiceDeps {
  db: Db;
  clock?: Clock;
  log?: Logger;
}

const small = (n: number): number => Math.max(0, Math.min(SMALLINT_MAX, Math.trunc(n)));

/** The start of every Paris day the window touches, then the next day's: `width_bucket(at, …)` numbers an act's Paris day. */
function dayThresholds(from: Date, now: Date): Date[] {
  const out: Date[] = [];
  const last = nextParisDay(parisDay(now));
  for (let day = parisDay(from); day <= last; day = nextParisDay(day)) out.push(parisDayStart(day));
  return out;
}

export class EngagementService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: EngagementServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /**
   * The releases of the window open to every collector at `now`, the oldest first: published, never cancelled, an
   * after-room left out (it counts as the release it follows); every draw, and a LIVE RELEASE without any access rule.
   * Read once per run, not per batch.
   */
  async openReleases(db: Db, now: Date): Promise<OpenRelease[]> {
    const r = await sql<{ id: string; opens_at: Date }>`
      SELECT d.id, d.opens_at
        FROM drops d
       WHERE d.published_at IS NOT NULL AND d.cancelled_at IS NULL AND d.parent_drop_id IS NULL
         AND d.opens_at > ${windowStart(now)} AND d.opens_at <= ${now}
         AND (d.mode = 'DRAW'
              OR (d.live_min_tier = 0 AND d.access_segment_id IS NULL AND d.access_collection_id IS NULL AND d.min_participations IS NULL
                  AND NOT EXISTS (SELECT 1 FROM live_access_models am WHERE am.drop_id = d.id)))
       ORDER BY d.opens_at, d.id`.execute(db);
    return r.rows.map((x) => ({ id: x.id, opensAt: x.opens_at }));
  }

  /**
   * The figures behind the five parts (see the header) of the accounts `accountIds` that exist, at `now`: five
   * set-based reads, whatever the accounts' status. `open`: the releases open to all, when the caller read them once
   * for its whole run.
   */
  async inputsFor(tx: Db, accountIds: readonly string[], now: Date, open?: readonly OpenRelease[]): Promise<Map<string, EngagementInputs>> {
    const out = new Map<string, EngagementInputs>();
    if (accountIds.length === 0) return out;
    const from = windowStart(now);
    const ids = uuidArray(accountIds);

    // 5. The accounts and when each was created.
    const accounts = await sql<{ id: string; created_at: Date }>`SELECT a.id, a.created_at FROM accounts a WHERE a.id = ANY(${ids})`.execute(tx);
    if (accounts.rows.length === 0) return out;

    // 1. The acts: the latest with its kind, and the Paris days with one.
    const kindCode = (k: ScoreActKind) => sql.lit(SCORE_ACT_KINDS.indexOf(k) + 1);
    const thresholds = sql.join(dayThresholds(from, now).map((d) => sql`${d}::timestamptz`));
    const acts = await sql<{ account_id: string; last_at: Date; last_kind: number; days: number }>`
      WITH acts AS (
        SELECT v.account_id, v.at, ${kindCode('SCAN')}::smallint AS k FROM collector_views v
         WHERE v.account_id = ANY(${ids}) AND v.page = ${VIEW_PAGE_CODES.SCAN} AND v.at > ${from} AND v.at <= ${now}
        UNION ALL
        SELECT de.account_id, de.created_at, ${kindCode('DRAW')}::smallint FROM drop_entries de
         WHERE de.account_id = ANY(${ids}) AND de.created_at > ${from} AND de.created_at <= ${now}
        UNION ALL
        SELECT le.account_id, le.joined_at, ${kindCode('LIVE')}::smallint FROM live_entries le
         WHERE le.account_id = ANY(${ids}) AND le.joined_at > ${from} AND le.joined_at <= ${now}
        UNION ALL
        SELECT li.account_id, li.created_at, ${kindCode('INTEREST')}::smallint FROM live_interest li
         WHERE li.account_id = ANY(${ids}) AND li.created_at > ${from} AND li.created_at <= ${now}
        UNION ALL
        SELECT o.account_id, o.reserved_at, ${kindCode('ORDER')}::smallint FROM orders o
         WHERE o.account_id = ANY(${ids}) AND o.channel IN ('LIVE', 'DRAW', 'SALON') AND o.reserved_at > ${from} AND o.reserved_at <= ${now}
        UNION ALL
        SELECT w.account_id, w.started_at, ${kindCode('REGISTRATION')}::smallint FROM ownership w
         WHERE w.account_id = ANY(${ids}) AND w.acquired_via IN ('FIRST_REGISTRATION', 'TRANSFER', 'RESALE') AND w.started_at > ${from} AND w.started_at <= ${now}
      )
      SELECT acts.account_id, max(acts.at) AS last_at,
             ((array_agg(acts.k ORDER BY acts.at DESC, acts.k))[1])::int AS last_kind,
             (count(DISTINCT width_bucket(acts.at, ARRAY[${thresholds}])))::int AS days
        FROM acts GROUP BY acts.account_id`.execute(tx);
    const actsOf = new Map(acts.rows.map((r) => [r.account_id, r]));

    // 2. The spend: GROWTH's purchases dated in the window, by currency; converted here.
    const spend = await sql<{ account_id: string; currency: string | null; purchases: number; unpriced: number; value: number | bigint }>`
      SELECT p.account_id, p.currency, count(*)::int AS purchases, (count(*) FILTER (WHERE p.value IS NULL))::int AS unpriced,
             coalesce(sum(p.value), 0)::bigint AS value
        FROM (${purchaseRows(accountIds)}) p
       WHERE p.at > ${from} AND p.at <= ${now}
       GROUP BY p.account_id, p.currency`.execute(tx);
    const spendOf = new Map<string, { eurMinor: number; purchases: number; unpriced: number; others: Set<ScoreOtherCurrency> }>();
    for (const r of spend.rows) {
      const s = spendOf.get(r.account_id) ?? { eurMinor: 0, purchases: 0, unpriced: 0, others: new Set<ScoreOtherCurrency>() };
      s.purchases += r.purchases;
      s.unpriced += r.unpriced;
      if (r.currency !== null) {
        // An unknown currency throws: the batch fails, the run is retried at the next pass (SB.3.5).
        s.eurMinor += toEurMinor(Number(r.value), r.currency);
        if (isOtherCurrency(r.currency)) s.others.add(r.currency);
      }
      spendOf.set(r.account_id, s);
    }

    // 3. The releases taken part in, with the opening and the entry.
    const entries = await releaseEntries(tx, accountIds, from, now);
    const entriesOf = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = entriesOf.get(e.account_id);
      if (list) list.push(e);
      else entriesOf.set(e.account_id, [e]);
    }

    // 4. The releases open to all: the caller's, or read now.
    const openToAll = open ?? (await this.openReleases(tx, now));

    for (const a of accounts.rows) {
      const act = actsOf.get(a.id);
      const s = spendOf.get(a.id);
      const taken = entriesOf.get(a.id) ?? [];
      const minutes = taken.map((e) => Math.max(0, Math.floor((e.entered_at.getTime() - e.opens_at.getTime()) / 60_000)));
      // Attendance: among the releases opened since the later of the window's start and the account's creation.
      const since = Math.max(from.getTime(), a.created_at.getTime());
      const counted = new Set(taken.filter((e) => e.release_opens_at.getTime() >= since).map((e) => e.release_id));
      const openIds = new Set(counted);
      for (const o of openToAll) if (o.opensAt.getTime() >= since && o.opensAt.getTime() <= now.getTime()) openIds.add(o.id);
      const purchases = small(s?.purchases ?? 0);
      out.set(a.id, {
        lastActAt: act?.last_at ?? null,
        lastActKind: act ? (SCORE_ACT_KINDS[act.last_kind - 1] ?? null) : null,
        activeDays: Math.min(366, act?.days ?? 0),
        spendEurMinor: Math.max(0, s?.eurMinor ?? 0),
        purchases,
        unpriced: Math.min(purchases, small(s?.unpriced ?? 0)),
        otherCurrencies: SCORE_OTHER_ORDER.filter((c) => s?.others.has(c)),
        speedMinutes: minutes.length ? median(minutes) : null,
        speedReleases: small(minutes.length),
        releasesTaken: small(counted.size),
        releasesOpen: small(openIds.size),
      });
    }
    return out;
  }

  /**
   * Score the accounts of `accountIds` that are ACTIVE and not test entrants, at `now`, in one READ COMMITTED
   * transaction of at most 30 seconds: the figures, the formula, then the rows, written only where a value differs.
   */
  async scoreBatch(accountIds: readonly string[], now: Date = this.clock(), open?: readonly OpenRelease[]): Promise<ScoredBatch> {
    const result: ScoredBatch = { scores: new Map(), changed: 0 };
    if (accountIds.length === 0) return result;
    return inTransaction(this.db, async (tx) => {
      await sql`SET LOCAL statement_timeout = '30s'`.execute(tx);
      const scored = await sql<{ id: string }>`
        SELECT a.id FROM accounts a WHERE a.id = ANY(${uuidArray(accountIds)}) AND a.status = 'ACTIVE' AND ${notTestEntrant('a.id')} ORDER BY a.id`.execute(tx);
      const ids = scored.rows.map((r) => r.id);
      const inputs = await this.inputsFor(tx, ids, now, open);
      const rows: { id: string; s: EngagementScore }[] = [];
      for (const id of ids) {
        const i = inputs.get(id);
        if (!i) continue;
        const s = scoreOf(i, now);
        rows.push({ id, s });
        result.scores.set(id, s.score);
      }
      for (let at = 0; at < rows.length; at += UPSERT_ROWS) result.changed += await upsert(tx, rows.slice(at, at + UPSERT_ROWS), now);
      return result;
    });
  }
}

/** The other currencies in the order the row keeps them. */
const SCORE_OTHER_ORDER: readonly ScoreOtherCurrency[] = Object.freeze(['GBP', 'USD', 'CHF']);

/** Every column of account_scores but its key and `changed_at`: what makes a row differ. */
const SCORE_COLUMNS = Object.freeze([
  'formula', 'score', 'recency_points', 'frequency_points', 'spend_points', 'speed_points', 'attendance_points', 'last_act_at', 'last_act_kind', 'active_days',
  'spend_eur_minor', 'purchases', 'unpriced', 'other_currencies', 'speed_minutes', 'speed_releases', 'releases_taken', 'releases_open',
] as const);

/** Insert the rows, or rewrite those whose values differ (the formula's number included): returns how many were written. */
async function upsert(tx: Db, rows: readonly { id: string; s: EngagementScore }[], now: Date): Promise<number> {
  if (rows.length === 0) return 0;
  const values = sql.join(
    rows.map(({ id, s }) => {
      const i = s.inputs;
      return sql`(${id}::uuid, ${ENGAGEMENT_FORMULA}::smallint, ${s.score}::smallint, ${s.parts.recency}::smallint, ${s.parts.frequency}::smallint, ${s.parts.spend}::smallint,
                  ${s.parts.speed}::smallint, ${s.parts.attendance}::smallint, ${i.lastActAt}::timestamptz, ${i.lastActKind}::text, ${i.activeDays}::smallint,
                  ${i.spendEurMinor}::bigint, ${i.purchases}::smallint, ${i.unpriced}::smallint, ${`{${i.otherCurrencies.join(',')}}`}::text[], ${i.speedMinutes}::integer,
                  ${i.speedReleases}::smallint, ${i.releasesTaken}::smallint, ${i.releasesOpen}::smallint, ${now}::timestamptz)`;
    }),
  );
  const columns = sql.join(SCORE_COLUMNS.map((c) => sql.ref(c)));
  const set = sql.join(SCORE_COLUMNS.map((c) => sql`${sql.ref(c)} = excluded.${sql.ref(c)}`));
  const mine = sql.join(SCORE_COLUMNS.map((c) => sql`account_scores.${sql.ref(c)}`));
  const theirs = sql.join(SCORE_COLUMNS.map((c) => sql`excluded.${sql.ref(c)}`));
  const r = await sql<{ account_id: string }>`
    INSERT INTO account_scores (account_id, ${columns}, changed_at)
    VALUES ${values}
    ON CONFLICT (account_id) DO UPDATE SET ${set}, changed_at = excluded.changed_at
     WHERE (${mine}) IS DISTINCT FROM (${theirs})
    RETURNING account_id`.execute(tx);
  return r.rows.length;
}
