/**
 * 0017 — the early access of a drop, with a direct reservation (P-X02; API §8.9, §10.10, §16.19; DATABASE §5.29).
 *
 * `drops.early_access_hours`: how long before `opens_at` the accounts PLATINE or PALLADIUM (the club's tier 2 or 3,
 * read at the moment of their request) reserve a place directly, first come, first served, under the drop's row lock
 * and within its `quantity` (services/drops.ts `DropService.reserve`): 0 to 336 hours (14 days), 48 by default; 0, no
 * early access. Set by the console with the drop's other fields while it is a DRAFT, fixed once published. The early
 * access goes from `opens_at − early_access_hours` to `opens_at`; from `opens_at` on, the places left follow the draw
 * of 0015 (entries, then the draw after `closes_at`, which draws `quantity` less the places held or sold).
 *
 * A direct reservation is a row of `drop_entries` (0015) SELECTED at once, its `respond_by` set, the tier and seniority
 * of the moment of the request kept, and no rank: the draw ranks only the entries still ENTERED. No other column.
 *
 * Compatible with the previous image: a column with a constant default, which the image of 0015 never names (it
 * inserts drops without it, and reads them column by column). `down` drops the column (its CHECK goes with it): the
 * schema of 0016 exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `ALTER TABLE drops ADD COLUMN early_access_hours smallint NOT NULL DEFAULT 48 CHECK (early_access_hours BETWEEN 0 AND 336)`,
];

export const DOWN: readonly string[] = [`ALTER TABLE drops DROP COLUMN IF EXISTS early_access_hours`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
