/**
 * 0003 — `authentication_events.authenticators` default.
 *
 * 0001 declared `DEFAULT '[]'` (an array) while VerificationService always
 * writes an object (`{ policy, assurance, results }`, or
 * `{ policy: null, results: [] }` when the policy was not evaluated). The
 * default is aligned to the object form `'{}'` so a row written without the
 * column has the same JSON type as every other row. Existing rows are left
 * untouched (the service never relied on the default).
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [`ALTER TABLE authentication_events ALTER COLUMN authenticators SET DEFAULT '{}'::jsonb`];

export const DOWN: readonly string[] = [`ALTER TABLE authentication_events ALTER COLUMN authenticators SET DEFAULT '[]'::jsonb`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
