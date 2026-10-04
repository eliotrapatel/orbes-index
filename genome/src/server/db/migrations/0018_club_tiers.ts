/**
 * 0018 — the tiers of the collectors' club (P-X04): the words of each tier's benefits, as the console changed them.
 *
 * `club_tiers`: at most one row per tier, TITANE, PLATINE or PALLADIUM (the club's tiers 1, 2 and 3: 1, 3 and 5 pieces
 * held now, a constant of the code, services/club.ts CLUB_TIER_THRESHOLDS, never a setting). `benefits` is what the
 * tier adds to the ones below it, one benefit per line, at most 600 characters; `updated_by` the console user who
 * wrote it (NULL: a script), `updated_at` when. The tier of a row never changes (`club_tiers_immutable_tier`).
 *
 * No row is inserted: the default words are constants of the code, in English (services/club.ts
 * CLUB_TIER_DEFAULT_BENEFITS); the table keeps only what the console changed, and a tier restored to its default
 * loses its row. Nothing personal is stored here.
 *
 * The foreign key leads an index (`club_tiers_updated_by_idx`); ON DELETE RESTRICT like every other. Nothing in an
 * older image reads or writes the table. One statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction. The down step drops the table: the schema of 0017.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const TIER_NAMES = `'TITANE','PLATINE','PALLADIUM'`;

export const UP: readonly string[] = [
  `CREATE TABLE club_tiers (
     tier       text        PRIMARY KEY CHECK (tier IN (${TIER_NAMES})),
     benefits   text        NOT NULL CHECK (length(btrim(benefits)) BETWEEN 1 AND 600),
     updated_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX club_tiers_updated_by_idx ON club_tiers (updated_by)`,
  `CREATE TRIGGER club_tiers_immutable_tier BEFORE UPDATE ON club_tiers
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('tier')`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS club_tiers`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
