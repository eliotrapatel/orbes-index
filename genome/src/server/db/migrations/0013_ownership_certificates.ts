/**
 * 0013 — `ownership_certificates`: the shareable ownership certificate (F-06;
 * API §8.6 and §11.7, DATABASE §5.27, SECURITY-MODEL §3.6).
 *
 * The current owner of a piece creates a link that shows, live, what the
 * ORBES registry records about it: the piece, its GENOME, the ownership
 * (verified or not) and its date, the warranty, and that no loss or theft is
 * reported. Never a name or an email. The link carries a random 32-byte
 * token in its fragment (`/verify/c#…`, never in a path Caddy logs); only
 * SHA-256 of those 32 bytes is stored (`token_hash`, unique), so a reader of
 * the table cannot open a certificate.
 *
 * A certificate is bound to the piece (`product_id`) and to the ownership
 * period it was created in (`ownership_id`): once the piece changes hands
 * that period ends, and the certificate is no longer valid. It lives at most
 * 90 days (`expires_at - created_at <= 90 days`, in absolute time), and its
 * owner can withdraw it (`revoked_at`). Rows are never deleted: the audit
 * log names them by id.
 *
 * Nothing in an older image reads or writes the table (DATABASE §9.1). Every
 * foreign key leads an index. One statement per array entry (PGlite's
 * extended protocol); Kysely's Migrator applies the migration inside a
 * transaction. The down step drops the table (its indexes and constraints
 * with it): the schema of the migration before.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE ownership_certificates (
     id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     token_hash    bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
     product_id    uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     ownership_id  uuid        NOT NULL REFERENCES ownership (id) ON DELETE RESTRICT,
     created_at    timestamptz NOT NULL DEFAULT now(),
     expires_at    timestamptz NOT NULL,
     revoked_at    timestamptz NULL,
     CONSTRAINT ownership_certificates_lifetime CHECK (expires_at > created_at AND expires_at - created_at <= interval '90 days'),
     CHECK (revoked_at IS NULL OR revoked_at >= created_at)
   )`,
  // A piece's certificates (the limit of open ones per piece), newest last.
  `CREATE INDEX ownership_certificates_product_idx ON ownership_certificates (product_id, created_at)`,
  // An owner's certificates: those of the ownership periods of the account (MY PIECES, the withdrawal).
  `CREATE INDEX ownership_certificates_ownership_idx ON ownership_certificates (ownership_id, created_at)`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS ownership_certificates`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
