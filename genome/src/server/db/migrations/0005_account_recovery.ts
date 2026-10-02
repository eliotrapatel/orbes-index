/**
 * 0005 — assisted account recovery (C-04; API §10.8 and §16.10,
 * SECURITY-MODEL §3.3).
 *
 * `account_recovery_codes`: the one-time code ORBES Client Services gives a
 * customer who forgot the password, after checking their identity. Only the
 * scrypt hash of the code is stored (like claim codes); a code is used once
 * (`used_at`), lives 30 minutes (`expires_at`, RECOVERY_CODE_TTL_MS) and is
 * revoked when a newer one is issued (`revoked_at`). One code at most is
 * open per account: a partial UNIQUE index over the rows neither used nor
 * revoked. `created_by` names the ADMIN who issued it.
 *
 * `accounts.transfers_frozen_until`: a recovery pauses new transfers out of
 * the account for 72 hours (409 TRANSFERS_PAUSED), so that a taken-over
 * account cannot hand its pieces on at once.
 *
 * Both are additions an older image ignores (DATABASE §9.1). Every foreign
 * key leads a full index (the partial one does not serve the RESTRICT check
 * on all rows).
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction. The down step drops
 * the table (its indexes and constraints with it) and the column: the schema
 * of 0004.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE account_recovery_codes (
     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     code_hash   text        NOT NULL CHECK (code_hash LIKE 'scrypt$%'),
     created_by  uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at  timestamptz NOT NULL DEFAULT now(),
     expires_at  timestamptz NOT NULL,
     used_at     timestamptz NULL,
     revoked_at  timestamptz NULL,
     CHECK (expires_at > created_at),
     CHECK (used_at IS NULL OR used_at >= created_at),
     CHECK (revoked_at IS NULL OR revoked_at >= created_at),
     CONSTRAINT account_recovery_codes_used_or_revoked CHECK (used_at IS NULL OR revoked_at IS NULL)
   )`,
  `CREATE INDEX account_recovery_codes_account_idx ON account_recovery_codes (account_id, created_at)`,
  `CREATE INDEX account_recovery_codes_created_by_idx ON account_recovery_codes (created_by)`,
  // One open code per account: issuing a new one revokes the previous one first.
  `CREATE UNIQUE INDEX account_recovery_codes_single_open ON account_recovery_codes (account_id) WHERE used_at IS NULL AND revoked_at IS NULL`,
  `ALTER TABLE accounts ADD COLUMN transfers_frozen_until timestamptz NULL`,
];

export const DOWN: readonly string[] = [
  `ALTER TABLE accounts DROP COLUMN IF EXISTS transfers_frozen_until`,
  `DROP TABLE IF EXISTS account_recovery_codes`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
