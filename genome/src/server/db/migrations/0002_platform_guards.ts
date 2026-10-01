/**
 * 0002 — platform integrity guards and the customer login throttle.
 *
 * Integrity (defence in depth against application bugs and ad-hoc SQL, same
 * guard function and SQLSTATE OR001 as 0001):
 *  - product_status_history is append-only (UPDATE, DELETE and TRUNCATE raise):
 *    it is the lifecycle evidence behind every status shown in the console;
 *  - genomes are never deleted (0001 already refuses UPDATE): a GENOME is the
 *    permanent visual identity of a signed product id;
 *  - cryptographic_keys are never deleted: a key id is a 1-byte value signed
 *    into every code, so deleting a row would let a later key reuse the id and
 *    make old codes verify (or fail) under the wrong key. Keys are RETIRED or
 *    REVOKED, never removed.
 *
 * Customer login throttle (accounts): `failed_logins` counts consecutive
 * wrong passwords inside the window that started at `failed_logins_since`;
 * AuthService refuses further attempts for that account with the generic
 * INVALID_CREDENTIALS error once the budget is spent (SECURITY-MODEL §3).
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TRIGGER product_status_history_append_only BEFORE UPDATE OR DELETE ON product_status_history
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('product_status_history is append-only')`,
  `CREATE TRIGGER product_status_history_no_truncate BEFORE TRUNCATE ON product_status_history
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('product_status_history is append-only')`,

  `CREATE TRIGGER genomes_no_delete BEFORE DELETE ON genomes
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('genomes are permanent')`,
  `CREATE TRIGGER genomes_no_truncate BEFORE TRUNCATE ON genomes
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('genomes are permanent')`,

  `CREATE TRIGGER cryptographic_keys_no_delete BEFORE DELETE ON cryptographic_keys
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('key ids are never reused; retire or revoke the key instead')`,
  `CREATE TRIGGER cryptographic_keys_no_truncate BEFORE TRUNCATE ON cryptographic_keys
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('key ids are never reused; retire or revoke the key instead')`,

  `ALTER TABLE accounts ADD COLUMN failed_logins int NOT NULL DEFAULT 0 CHECK (failed_logins >= 0)`,
  `ALTER TABLE accounts ADD COLUMN failed_logins_since timestamptz NULL`,
];

export const DOWN: readonly string[] = [
  `ALTER TABLE accounts DROP COLUMN IF EXISTS failed_logins_since`,
  `ALTER TABLE accounts DROP COLUMN IF EXISTS failed_logins`,
  `DROP TRIGGER IF EXISTS cryptographic_keys_no_truncate ON cryptographic_keys`,
  `DROP TRIGGER IF EXISTS cryptographic_keys_no_delete ON cryptographic_keys`,
  `DROP TRIGGER IF EXISTS genomes_no_truncate ON genomes`,
  `DROP TRIGGER IF EXISTS genomes_no_delete ON genomes`,
  `DROP TRIGGER IF EXISTS product_status_history_no_truncate ON product_status_history`,
  `DROP TRIGGER IF EXISTS product_status_history_append_only ON product_status_history`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
