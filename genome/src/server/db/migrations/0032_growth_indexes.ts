/**
 * 0032 — GROWTH's indexes (plan NEXT-NINE of 2026-10-06, §3.9 BP-29, step 9.1: « A GROWTH console page … LTV, repeat
 * buying, the funnel, revenue »).
 *
 * GROWTH (services/growth.ts) only reads; it keeps no snapshot table and no cache. Three indexes serve its readings:
 *
 *   - `accounts_created_at_idx` on `accounts (created_at)`: the accounts created in each month of the window (the
 *     funnel's « Accounts created »);
 *   - `ownership_account_started_idx` on `ownership (account_id, started_at)`: an account's first ownership (« Registered
 *     owners »), its pieces in the order they came (repeat buying, the tiers reached over all history);
 *   - `orders_paid_idx` on `orders (account_id, paid_at) WHERE paid_at IS NOT NULL`: an account's paid orders in the
 *     order they were paid (« Buyers », lifetime value, repeat buying).
 *
 * Indexes only: no column, constraint or trigger. Compatible with the previous image, which never names them. `down`
 * drops the three: the schema of 0031 exactly. One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE INDEX accounts_created_at_idx ON accounts (created_at)`,
  `CREATE INDEX ownership_account_started_idx ON ownership (account_id, started_at)`,
  `CREATE INDEX orders_paid_idx ON orders (account_id, paid_at) WHERE paid_at IS NOT NULL`,
];

export const DOWN: readonly string[] = [
  `DROP INDEX IF EXISTS orders_paid_idx`,
  `DROP INDEX IF EXISTS ownership_account_started_idx`,
  `DROP INDEX IF EXISTS accounts_created_at_idx`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
