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
 *   The daily job, `runIfDue`, is called at each housekeeping pass (every 10 minutes) and runs once per Paris day:
 *     1. due?    the pass is in the lot's morning window (services/schedule.ts: from 07:30 UTC until the Paris day ends),
 *                no run of that Paris day is finished, no LIVE RELEASE's room is open and no test of test entrants is
 *                RUNNING (the box has 2 vCPU: a release or a load test never shares them with a batch job). Otherwise
 *                it waits for a later pass; a day when nothing clears before midnight has no run.
 *     2. claim   one row of `engagement_runs` per Paris day: a second process, or a second pass, gets no row back and
 *                stops. A run cut short (a restart) is taken over ENGAGEMENT_STALE_MINUTES later, from the start: each
 *                batch is idempotent.
 *     3. score   the ACTIVE accounts that are not test entrants, in `id` order, ENGAGEMENT_BATCH at a time, a pause
 *                of ENGAGEMENT_PAUSE_MS between two batches so requests get the CPU.
 *     4. clean   the rows of DELETED accounts and of test entrants are removed; a LOCKED account's is left as it was.
 *     5. finish  the run's row takes its end, the accounts scored, the rows changed, how long it took, and the bands:
 *                the scores of the ACTIVE counted collectors (no test entrant, no team account, §3.0 (d)) per band of
 *                ten. One log line, `{ job: 'engagement', day, accounts, changed, ms }`.
 *   A failed batch fails the whole run: the error is thrown to the housekeeping pass, which logs it; the run's row
 *   stays unfinished and is claimed again once stale.
 *
 *   `account` is the client sheet's Engagement block (SB.3.6), sent by GET /api/admin/owners/:id/intelligence to
 *   every console role that reaches the sheet: the score with its five parts and the figures behind them, when it was
 *   calculated, whether the runs are stale, and the formula's lines. It has no route of its own.
 *
 * Nothing here is audited: a score is derived by the system and holds no decision (SB.3.3); the runs' table and the
 * job's log line are its trace. Nothing here is ever sent to a collector.
 */
import { sql } from 'kysely';
import { inTransaction, uuidArray, type Db } from '../db/connection.js';
import { SCORE_ACT_KINDS, VIEW_PAGE_CODES, type ScoreActKind, type ScoreOtherCurrency } from '../db/schema.js';
import { notFound } from '../errors.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import {
  ENGAGEMENT_FORMULA,
  ENGAGEMENT_WINDOW_DAYS,
  FORMULA_LINES,
  isOtherCurrency,
  PART_MAX,
  scoreOf,
  toEurMinor,
  type EngagementInputs,
  type EngagementPart,
  type EngagementScore,
} from './engagement-formula.js';
import { median, purchaseRows } from './growth.js';
import { releaseEntries } from './participation.js';
import { countedCollector, notTestEntrant } from './population.js';
import { morningWindowOpen, parisDay, parisDayStart } from './schedule.js';
import { nextParisDay } from './tracking.js';

/** The accounts scored in one transaction. */
export const ENGAGEMENT_BATCH = 500;
/** The rows of one upsert statement (a batch is written in a few of them, in its one transaction). */
const UPSERT_ROWS = 100;
/** The pause between two batches of a run, in milliseconds. */
export const ENGAGEMENT_PAUSE_MS = 100;
/** An unfinished run is taken over once its claim is older than this many minutes. */
export const ENGAGEMENT_STALE_MINUTES = 20;

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

/** What the client sheet says of an account's score (SB.3.6). */
export type EngagementState =
  /** An ACTIVE account with its score. */
  | 'SCORED'
  /** An ACTIVE account without a score yet: created since the last run. */
  | 'NOT_YET'
  /** A test entrant: never scored. */
  | 'TEST_ENTRANT'
  /** A LOCKED account: its score as last calculated (none when it never had one), not updated while it is locked. */
  | 'LOCKED'
  /** A DELETED account: no score. */
  | 'DELETED';

/** A score as the client sheet reads it: the points of each part and the figure behind them. */
export interface SheetScore {
  score: number;
  /** The formula that made it. */
  formula: number;
  points: Record<EngagementPart, number>;
  lastActAt: Date | null;
  lastActKind: ScoreActKind | null;
  activeDays: number;
  spendEurMinor: number;
  purchases: number;
  unpriced: number;
  otherCurrencies: ScoreOtherCurrency[];
  speedMinutes: number | null;
  speedReleases: number;
  releasesTaken: number;
  releasesOpen: number;
  /** Since when the releases are counted: the window's start at the calculation, or the account's creation if later. */
  releasesSince: Date;
}

/** The client sheet's Engagement block (GET /api/admin/owners/:id/intelligence, `engagement`). Staff only. */
export interface EngagementBlock {
  state: EngagementState;
  /** With SCORED, and with LOCKED when the account had a score; null otherwise. */
  score: SheetScore | null;
  /** When the score shown was calculated; null without one. A LOCKED account's: when its row was last written. */
  calculatedAt: Date | null;
  /** The Paris day of the latest finished run, `YYYY-MM-DD`; null before the first. */
  lastRunDay: string | null;
  /** The latest finished run is more than one day before today (Paris): the scores are not being recalculated. */
  stale: boolean;
  /** The most each part gives. */
  partMax: Record<EngagementPart, number>;
  /** « How the score is calculated »: the formula's lines, written from its constants. */
  formulaLines: string[];
}

/** A finished run of the daily job. */
export interface EngagementRun {
  /** The Paris day, `YYYY-MM-DD`. */
  day: string;
  /** The accounts scored. */
  accounts: number;
  /** The rows inserted, rewritten or removed. */
  changed: number;
  /** The ACTIVE counted collectors per band of ten: 0–9 … 90–100. */
  bands: number[];
  /** How long the run took, in milliseconds. */
  ms: number;
}

export interface EngagementServiceDeps {
  db: Db;
  clock?: Clock;
  log?: Logger;
  /** The pause between two batches (a test passes its own). */
  sleep?: (ms: number) => Promise<void>;
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

  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: EngagementServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * The daily job (see the header): run the Paris day of `now` when it is due, and return the finished run; null when
   * it is not due, or when another pass or process holds the day. Throws when a batch fails (the housekeeping pass
   * logs it): the day's row stays unfinished and is claimed again ENGAGEMENT_STALE_MINUTES later.
   */
  async runIfDue(now: Date = this.clock()): Promise<EngagementRun | null> {
    // 1. Due?
    if (!morningWindowOpen(now)) return null;
    const day = parisDay(now);
    const done = await this.db.selectFrom('engagement_runs').select('day').where('day', '=', day).where('finished_at', 'is not', null).executeTakeFirst();
    if (done) return null;
    if (await this.busy(now)) return null;
    // 2. Claim the day: no row back means another pass or process holds it, or it is finished.
    const stale = new Date(now.getTime() - ENGAGEMENT_STALE_MINUTES * 60_000);
    const claimed = await sql<{ day: string }>`
      INSERT INTO engagement_runs (day, formula, started_at) VALUES (${day}::date, ${ENGAGEMENT_FORMULA}::smallint, ${now}::timestamptz)
      ON CONFLICT (day) DO UPDATE SET started_at = excluded.started_at, formula = excluded.formula
       WHERE engagement_runs.finished_at IS NULL AND engagement_runs.started_at < ${stale}::timestamptz
      RETURNING day`.execute(this.db);
    if (claimed.rows.length === 0) return null;
    const began = performance.now();

    // 3. Score: every ACTIVE account that is not a test entrant, in id order.
    const open = await this.openReleases(this.db, now);
    let accounts = 0;
    let changed = 0;
    for (let after: string | null = null; ; ) {
      const batch: { id: string }[] = (
        await sql<{ id: string }>`
          SELECT a.id FROM accounts a
           WHERE a.status = 'ACTIVE' AND ${notTestEntrant('a.id')} ${after === null ? sql`` : sql`AND a.id > ${after}::uuid`}
           ORDER BY a.id LIMIT ${ENGAGEMENT_BATCH}`.execute(this.db)
      ).rows;
      if (batch.length === 0) break;
      const r = await this.scoreBatch(batch.map((b) => b.id), now, open);
      accounts += r.scores.size;
      changed += r.changed;
      if (batch.length < ENGAGEMENT_BATCH) break;
      after = batch[batch.length - 1]!.id;
      await this.sleep(ENGAGEMENT_PAUSE_MS);
    }

    // 4. Clean: the row of an account neither ACTIVE nor LOCKED (a DELETED one), and a test entrant's (never expected: a
    // guard). LOCKED accounts are left.
    const removed = await sql<{ account_id: string }>`
      DELETE FROM account_scores s USING accounts a
       WHERE a.id = s.account_id AND (a.status NOT IN ('ACTIVE', 'LOCKED') OR NOT ${notTestEntrant('a.id')})
      RETURNING s.account_id`.execute(this.db);
    changed += removed.rows.length;

    // 5. Finish: the bands over the ACTIVE counted collectors, then the run's row, while this pass still holds it.
    const counts = await sql<{ band: number; n: number }>`
      SELECT least(9, s.score / 10)::int AS band, count(*)::int AS n
        FROM account_scores s
        JOIN accounts a ON a.id = s.account_id
       WHERE a.status = 'ACTIVE' AND ${countedCollector('s.account_id')}
       GROUP BY 1`.execute(this.db);
    const bands = Array.from({ length: 10 }, () => 0);
    for (const c of counts.rows) bands[c.band] = c.n;
    const ms = Math.max(0, Math.round(performance.now() - began));
    const ended = this.clock();
    const finished = await this.db
      .updateTable('engagement_runs')
      .set({ finished_at: ended.getTime() < now.getTime() ? now : ended, accounts, changed, bands, duration_ms: ms })
      .where('day', '=', day)
      .where('finished_at', 'is', null)
      .where('started_at', '=', now)
      .returning('day')
      .executeTakeFirst();
    if (!finished) {
      // The claim was taken over meanwhile (this run outlived ENGAGEMENT_STALE_MINUTES): the other run finishes the day.
      this.log.warn({ job: 'engagement', day }, 'engagement run not recorded: the day was taken over');
      return null;
    }
    this.log.info({ job: 'engagement', day, accounts, changed, ms }, 'engagement scores calculated');
    return { day, accounts, changed, bands, ms };
  }

  /**
   * The client sheet's Engagement block of an account (see the header): its state, its score when it has one, when it
   * was calculated and whether the runs are stale. 404 ACCOUNT_NOT_FOUND for an unknown account. It only reads.
   */
  async account(accountId: string, now: Date = this.clock()): Promise<EngagementBlock> {
    const found = await sql<{ status: string; created_at: Date; test_entrant: boolean }>`
      SELECT a.status, a.created_at, NOT ${notTestEntrant('a.id')} AS test_entrant FROM accounts a WHERE a.id = ${accountId}`.execute(this.db);
    const a = found.rows[0];
    if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const run = await this.db.selectFrom('engagement_runs').select(['day', 'finished_at']).where('finished_at', 'is not', null).orderBy('day', 'desc').limit(1).executeTakeFirst();
    const lastRunDay = run?.day ?? null;
    const block = (state: EngagementState, score: SheetScore | null, calculatedAt: Date | null): EngagementBlock => ({
      state,
      score,
      calculatedAt,
      lastRunDay,
      // More than one day before today: the day after the latest run is already past.
      stale: lastRunDay !== null && nextParisDay(lastRunDay) < parisDay(now),
      partMax: { ...PART_MAX },
      formulaLines: [...FORMULA_LINES],
    });
    if (a.status !== 'ACTIVE' && a.status !== 'LOCKED') return block('DELETED', null, null);
    if (a.test_entrant) return block('TEST_ENTRANT', null, null);
    const row = await this.db.selectFrom('account_scores').selectAll().where('account_id', '=', accountId).executeTakeFirst();
    const locked = a.status === 'LOCKED';
    if (!row) return block(locked ? 'LOCKED' : 'NOT_YET', null, null);
    // An ACTIVE account is calculated at every run: the latest finished one, or its row's own time when that is later
    // (a run under way). A LOCKED account's row dates from when it was last written.
    const finishedAt = run?.finished_at ?? null;
    const calculatedAt = !locked && finishedAt && finishedAt.getTime() > row.changed_at.getTime() ? finishedAt : row.changed_at;
    const since = Math.max(windowStart(calculatedAt).getTime(), a.created_at.getTime());
    return block(
      locked ? 'LOCKED' : 'SCORED',
      {
        score: row.score,
        formula: row.formula,
        points: { recency: row.recency_points, frequency: row.frequency_points, spend: row.spend_points, speed: row.speed_points, attendance: row.attendance_points },
        lastActAt: row.last_act_at,
        lastActKind: row.last_act_kind,
        activeDays: row.active_days,
        spendEurMinor: Number(row.spend_eur_minor),
        purchases: row.purchases,
        unpriced: row.unpriced,
        otherCurrencies: [...row.other_currencies],
        speedMinutes: row.speed_minutes,
        speedReleases: row.speed_releases,
        releasesTaken: row.releases_taken,
        releasesOpen: row.releases_open,
        releasesSince: new Date(since),
      },
      calculatedAt,
    );
  }

  /** Whether the job must wait at `now`: a LIVE RELEASE's room is open, or a test of test entrants is RUNNING. */
  private async busy(now: Date): Promise<boolean> {
    const r = await sql<{ room: boolean; test: boolean }>`
      SELECT EXISTS (SELECT 1 FROM drops d
                      WHERE d.mode = 'LIVE' AND d.published_at IS NOT NULL AND d.cancelled_at IS NULL AND d.ended_at IS NULL
                        AND d.opens_at <= ${now}::timestamptz + coalesce(d.room_opens_minutes, 0) * interval '1 minute') AS room,
             EXISTS (SELECT 1 FROM test_runs tr WHERE tr.status = 'RUNNING') AS test`.execute(this.db);
    return Boolean(r.rows[0]?.room || r.rows[0]?.test);
  }

  /**
   * The releases of the window open to every collector at `now`, the oldest first: published, never cancelled, an
   * after-room left out (it counts as the release it follows); every draw but one opened to a segment (plan MACRO M1
   * §3.1, F4), and a LIVE RELEASE without any access rule.
   * Read once per run, not per batch.
   */
  async openReleases(db: Db, now: Date): Promise<OpenRelease[]> {
    const r = await sql<{ id: string; opens_at: Date }>`
      SELECT d.id, d.opens_at
        FROM drops d
       WHERE d.published_at IS NOT NULL AND d.cancelled_at IS NULL AND d.parent_drop_id IS NULL
         AND d.opens_at > ${windowStart(now)} AND d.opens_at <= ${now}
         AND ((d.mode = 'DRAW' AND d.access_segment_id IS NULL)
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
