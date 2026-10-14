/**
 * 0046 — The engagement score (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.3.2, §3.0 (a), step 7.1): the lot's
 * seventh migration, after 0045_birthday_credit.
 *
 * `account_scores`: the current score of each scored account, one row per account (its primary key, which leads the
 * foreign key's index). The score from 0 to 100 is the sum of its five parts (`account_scores_sum`): recency (0..25),
 * frequency (0..20), spend (0..25), release speed (0..10) and attendance (0..20), each kept with the figure behind it:
 * the latest act and its kind (both or neither, `account_scores_last_act`), the active Paris days, the spend in euros
 * with its purchases, those without a known price and the other currencies converted, the median minutes to enter a
 * release over its releases (a median exactly when there is a release, `account_scores_speed`), the releases taken part
 * in out of those open. `formula` is the version of the code's formula that made the row; `changed_at` when any value
 * last changed. `account_scores_score_idx` serves the score spread and Segments.
 *
 * `engagement_runs`: one row per Paris day the daily job ran: the job's claim (`started_at`, taken over when left
 * unfinished) and, once finished, the history of the score spread: the accounts scored, the rows changed, the counted
 * collectors per band of ten (`bands`: ten counts, 0–9 … 90–100) and how long it took (`engagement_runs_done`: finished
 * exactly with its accounts and bands).
 *
 * Derived data, written by the job only (services/engagement.ts): no audit entry, no delete trigger, no immutable
 * column; a DELETED account's score is removed by the job. Compatible with the previous image, which never reads
 * these tables; no row is inserted. `down` drops both tables, the schema of 0045 exactly (nothing is rolled back in
 * production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration
 * inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  // ── account_scores ───────────────────────────────────────────────────────
  `CREATE TABLE account_scores (
     account_id        uuid        PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     formula           smallint    NOT NULL CONSTRAINT account_scores_formula_check CHECK (formula >= 1),
     score             smallint    NOT NULL CONSTRAINT account_scores_score_check CHECK (score BETWEEN 0 AND 100),
     recency_points    smallint    NOT NULL CONSTRAINT account_scores_recency_points_check CHECK (recency_points BETWEEN 0 AND 25),
     frequency_points  smallint    NOT NULL CONSTRAINT account_scores_frequency_points_check CHECK (frequency_points BETWEEN 0 AND 20),
     spend_points      smallint    NOT NULL CONSTRAINT account_scores_spend_points_check CHECK (spend_points BETWEEN 0 AND 25),
     speed_points      smallint    NOT NULL CONSTRAINT account_scores_speed_points_check CHECK (speed_points BETWEEN 0 AND 10),
     attendance_points smallint    NOT NULL CONSTRAINT account_scores_attendance_points_check CHECK (attendance_points BETWEEN 0 AND 20),
     last_act_at       timestamptz NULL,
     last_act_kind     text        NULL CONSTRAINT account_scores_last_act_kind_check
                         CHECK (last_act_kind IN ('SCAN', 'DRAW', 'LIVE', 'INTEREST', 'ORDER', 'REGISTRATION')),
     active_days       smallint    NOT NULL CONSTRAINT account_scores_active_days_check CHECK (active_days BETWEEN 0 AND 366),
     spend_eur_minor   bigint      NOT NULL CONSTRAINT account_scores_spend_eur_minor_check CHECK (spend_eur_minor >= 0),
     purchases         smallint    NOT NULL CONSTRAINT account_scores_purchases_check CHECK (purchases >= 0),
     unpriced          smallint    NOT NULL CONSTRAINT account_scores_unpriced_check CHECK (unpriced >= 0),
     other_currencies  text[]      NOT NULL DEFAULT '{}' CONSTRAINT account_scores_other_currencies_check
                         CHECK (other_currencies <@ ARRAY['GBP', 'USD', 'CHF']),
     speed_minutes     integer     NULL CONSTRAINT account_scores_speed_minutes_check CHECK (speed_minutes >= 0),
     speed_releases    smallint    NOT NULL CONSTRAINT account_scores_speed_releases_check CHECK (speed_releases >= 0),
     releases_taken    smallint    NOT NULL CONSTRAINT account_scores_releases_taken_check CHECK (releases_taken >= 0),
     releases_open     smallint    NOT NULL,
     changed_at        timestamptz NOT NULL,
     CONSTRAINT account_scores_sum CHECK (score = recency_points + frequency_points + spend_points + speed_points + attendance_points),
     CONSTRAINT account_scores_last_act CHECK ((last_act_at IS NULL) = (last_act_kind IS NULL)),
     CONSTRAINT account_scores_priced CHECK (unpriced <= purchases),
     CONSTRAINT account_scores_speed CHECK ((speed_minutes IS NULL) = (speed_releases = 0)),
     CONSTRAINT account_scores_releases CHECK (releases_taken <= releases_open)
   )`,
  // The score spread and Segments' counts over large populations.
  `CREATE INDEX account_scores_score_idx ON account_scores (score)`,

  // ── engagement_runs ──────────────────────────────────────────────────────
  `CREATE TABLE engagement_runs (
     day         date        PRIMARY KEY,
     formula     smallint    NOT NULL CONSTRAINT engagement_runs_formula_check CHECK (formula >= 1),
     started_at  timestamptz NOT NULL,
     finished_at timestamptz NULL,
     accounts    integer     NULL CONSTRAINT engagement_runs_accounts_check CHECK (accounts >= 0),
     changed     integer     NULL CONSTRAINT engagement_runs_changed_check CHECK (changed >= 0),
     bands       integer[]   NULL CONSTRAINT engagement_runs_bands_check
                   CHECK (bands IS NULL OR (cardinality(bands) = 10 AND array_position(bands, NULL) IS NULL AND 0 <= ALL (bands))),
     duration_ms integer     NULL CONSTRAINT engagement_runs_duration_ms_check CHECK (duration_ms >= 0),
     CONSTRAINT engagement_runs_finished CHECK (finished_at >= started_at),
     CONSTRAINT engagement_runs_done CHECK ((finished_at IS NULL) = (accounts IS NULL) AND (finished_at IS NULL) = (bands IS NULL))
   )`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS engagement_runs`, `DROP TABLE IF EXISTS account_scores`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
