/**
 * 0011 — the TRANSFER_ACCEPT scan token (F-03; API §9.2 and §11.3, DATABASE §5.17).
 *
 * `scan_tokens.purpose` accepts TRANSFER_ACCEPT: the 15-minute token that a
 * verification gives a signed-in reader who is not the owner of a piece whose
 * transfer is pending (VerifyOutcome.transfer). `POST /api/v1/ownership/
 * transfers/accept` consumes it in its transaction, for the same piece and the
 * same account as the scan, so no transfer completes without a scan of the
 * piece it hands over. The CHECK is dropped and re-created with the three
 * purposes, those of 0008 kept (FIRST_REGISTRATION, SALE_ACTIVATION).
 *
 * Compatible with the previous image: it never writes the new purpose. `down`
 * restores the CHECK of 0008 exactly, after deleting the outstanding
 * TRANSFER_ACCEPT tokens (15-minute proofs that nothing else refers to), as
 * 0008's own down step deletes its SALE_ACTIVATION tokens.
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `ALTER TABLE scan_tokens DROP CONSTRAINT scan_tokens_purpose_check`,
  `ALTER TABLE scan_tokens ADD CONSTRAINT scan_tokens_purpose_check CHECK (purpose IN ('FIRST_REGISTRATION','SALE_ACTIVATION','TRANSFER_ACCEPT'))`,
];

export const DOWN: readonly string[] = [
  `DELETE FROM scan_tokens WHERE purpose = 'TRANSFER_ACCEPT'`,
  `ALTER TABLE scan_tokens DROP CONSTRAINT scan_tokens_purpose_check`,
  `ALTER TABLE scan_tokens ADD CONSTRAINT scan_tokens_purpose_check CHECK (purpose IN ('FIRST_REGISTRATION','SALE_ACTIVATION'))`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
