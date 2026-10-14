/**
 * 0047 — The monthly history of each collector (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.8 item 3, C.10, §3.0
 * (a), step 9.5): the lot's eighth and last migration, after 0046_engagement_scores.
 *
 * `collector_history`: one row per counted collector (its primary key, which leads the foreign key's index), arrays
 * rather than a row per month (about 250 bytes a collector at 36 months, whatever the number of months): one element per
 * Paris month from `first_month` (the first day of a month, `collector_history_month`) to `last_month` (the latest month
 * written): `scores` the engagement score of that month's end (0..100, NULL: not measured), `tiers` the tier held at the
 * month's end (0 no tier .. 3 PALLADIUM, never NULL), `active` any activity in the month (never NULL). The three arrays
 * have the same length, at most 36 (`collector_history_lengths`: the job drops the oldest month when it adds the 37th),
 * and `last_month` is exactly the last element's month (`collector_history_span`: none without an element).
 *
 * Derived data, written by the housekeeping job `collectorHistory` only (services/collector-history.ts): no audit
 * entry, no trigger. Test entrants and the team's own accounts never have a row. Compatible with the previous image,
 * which never reads this table; no row is inserted. `down` drops it, the schema of 0046 exactly (nothing is rolled back
 * in production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration
 * inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE collector_history (
     account_id  uuid       PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     first_month date       NOT NULL CONSTRAINT collector_history_month CHECK (extract(day FROM first_month) = 1),
     scores      smallint[] NOT NULL DEFAULT '{}' CONSTRAINT collector_history_scores_check
                   CHECK (0 <= ALL (scores) AND 100 >= ALL (scores)),
     tiers       smallint[] NOT NULL DEFAULT '{}' CONSTRAINT collector_history_tiers_check
                   CHECK (array_position(tiers, NULL) IS NULL AND 0 <= ALL (tiers) AND 3 >= ALL (tiers)),
     active      boolean[]  NOT NULL DEFAULT '{}' CONSTRAINT collector_history_active_check
                   CHECK (array_position(active, NULL) IS NULL),
     last_month  date       NULL,
     CONSTRAINT collector_history_lengths
       CHECK (cardinality(scores) = cardinality(tiers) AND cardinality(tiers) = cardinality(active) AND cardinality(active) <= 36),
     CONSTRAINT collector_history_span
       CHECK ((last_month IS NULL AND cardinality(active) = 0)
           OR (last_month IS NOT NULL AND cardinality(active) >= 1
               AND last_month = (first_month + (cardinality(active) - 1) * interval '1 month')::date))
   )`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS collector_history`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
