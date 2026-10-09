/**
 * 0041 — The wishlist (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.3, step 2.1): the lot's second migration, after
 * 0040_account_profiles (whose `account_tastes` is the tastes' table).
 *
 * `account_wishes`: one row per wish, a collector's heart on one model's sheet (the dot shown: a main model or a
 * variant, each its own `models` row). Open while `removed_at` is NULL; removing sets it and keeps the row, for the
 * figures over time, until the purge 13 months later (`wishHistory`, once its month is counted). Never edited but for
 * `removed_at`: set on removal, cleared by the 10-minute re-add (`account_wishes_immutable` guards the rest). One open
 * wish per account and model (`account_wishes_open`, which also serves Segments and the account's list); the model's
 * foreign key leads `account_wishes_model_idx` (the most wished counts and the monthly summary); the purge reads
 * `account_wishes_removed_idx`. No audit entry per heart tap: the row is its own record.
 *
 * `model_wish_months`: the summary that outlives the 13 months, one row per Paris month and model that had a wish open
 * or moving that month (added, removed, open at the month's last instant), counted collectors only, kept for good.
 * `wish_months_counted`: which months the summary holds (a month with no wish leaves no summary row), about 12 a year.
 *
 * Every foreign key leads an index, ON DELETE RESTRICT like every other. Compatible with the previous image: three
 * tables it never reads, no row inserted. `down` drops the three tables, the schema of 0040 exactly (nothing is rolled
 * back in production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  // ── account_wishes ───────────────────────────────────────────────────────
  `CREATE TABLE account_wishes (
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     model_id   uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     added_at   timestamptz NOT NULL DEFAULT now(),
     removed_at timestamptz NULL,
     PRIMARY KEY (account_id, model_id, added_at),
     CONSTRAINT account_wishes_removed CHECK (removed_at IS NULL OR removed_at >= added_at)
   )`,
  // One open wish per account and model; Segments' exists and the account's list.
  `CREATE UNIQUE INDEX account_wishes_open ON account_wishes (account_id, model_id) WHERE removed_at IS NULL`,
  `CREATE INDEX account_wishes_model_idx ON account_wishes (model_id, added_at)`,
  `CREATE INDEX account_wishes_removed_idx ON account_wishes (removed_at) WHERE removed_at IS NOT NULL`,
  `CREATE TRIGGER account_wishes_immutable BEFORE UPDATE ON account_wishes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('account_id', 'model_id', 'added_at')`,

  // ── model_wish_months ────────────────────────────────────────────────────
  `CREATE TABLE model_wish_months (
     month      date        NOT NULL CONSTRAINT model_wish_months_month_check CHECK (extract(day FROM month) = 1),
     model_id   uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     added      integer     NOT NULL CONSTRAINT model_wish_months_added_check CHECK (added >= 0),
     removed    integer     NOT NULL CONSTRAINT model_wish_months_removed_check CHECK (removed >= 0),
     wished_end integer     NOT NULL CONSTRAINT model_wish_months_wished_end_check CHECK (wished_end >= 0),
     counted_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (month, model_id)
   )`,
  `CREATE INDEX model_wish_months_model_idx ON model_wish_months (model_id)`,

  // ── wish_months_counted ──────────────────────────────────────────────────
  `CREATE TABLE wish_months_counted (
     month      date        PRIMARY KEY CONSTRAINT wish_months_counted_month_check CHECK (extract(day FROM month) = 1),
     counted_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export const DOWN: readonly string[] = [
  `DROP TABLE IF EXISTS wish_months_counted`,
  `DROP TABLE IF EXISTS model_wish_months`,
  `DROP TABLE IF EXISTS account_wishes`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
