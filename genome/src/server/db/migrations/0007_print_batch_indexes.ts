/**
 * 0007 — indexes for printing by production batch (recommendation A-03).
 *
 * The codes registry now filters by the product's production batch and by
 * the day a code was issued, and lists codes newest first
 * (GET /api/admin/codes, GET /api/admin/codes/ids):
 *
 * - `products_production_batch_idx` on `products (production_batch)`: a
 *   batch's products without a scan of every product;
 * - `codes_created_at_idx` on `codes (created_at)`: the issue-day range and
 *   the newest-first order.
 *
 * Indexes only: the previous application version runs unchanged on this
 * schema. Plain CREATE INDEX (not CONCURRENTLY, which cannot run inside the
 * migration's transaction): writes to the two tables wait while the indexes
 * build, which at the registry's size is brief.
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE INDEX products_production_batch_idx ON products (production_batch)`,
  `CREATE INDEX codes_created_at_idx ON codes (created_at)`,
];

export const DOWN: readonly string[] = [`DROP INDEX codes_created_at_idx`, `DROP INDEX products_production_batch_idx`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
