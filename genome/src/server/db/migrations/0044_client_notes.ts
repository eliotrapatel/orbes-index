/**
 * 0044 — The client sheet's private notes and tags (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.8 items 1, 2, 4 and
 * 5, step 5.1): the lot's fifth migration, after 0043_acquisition, the last of deployment I1. Two tables, one function
 * and two indexes the previous image never names; no row inserted.
 *
 * `account_notes`: Client Services' private notes on a client, never shown to the client. A note's text, 1 to 2,000
 * characters with no space at either end (`account_notes_body`), who wrote it (a console login; NULL: a script) and
 * when. Never edited: only its removal changes it, `removed_at` and `removed_by` together and never before it was
 * written (`account_notes_removed`); `account_notes_immutable` keeps the rest. A removed note stays a row, so the audit
 * entry that names it still points at it.
 *
 * `account_tags`: Client Services' tags on a client (VIP, PRESS, FRIEND OF THE HOUSE…), once each per account, in
 * capitals, 1 to 32 letters of any script, figures, single spaces and & ' ’ . - (`account_tags_tag`). A removed tag is a
 * deleted row (the audit log keeps who added and removed it); the 20 per account are the service's bound.
 *
 * `audit_logs_account_login_idx`: the sign-ins of an account in a period (§3.6 C.6.8), read by the Collectors page and
 * by Segments' ACTIVE rule. Built inside the migration's transaction, as every index of the house (no CONCURRENTLY).
 *
 * `orbes_fold(text)`: lower case, then the common Latin diacritics removed by `translate()`, IMMUTABLE so an index can
 * read it: src/shared/fold.ts is the same rule in JavaScript (test/shared/fold.test.ts holds the two to the same
 * answers). Not the `unaccent` extension, which PGlite and the production image may lack.
 * `account_profiles_city_fold_idx`: the cities given in YOUR PROFILE, folded, for Segments' CITY and the city groups.
 *
 * Every foreign key leads a full index, ON DELETE RESTRICT like every other. `down` drops the city index, the function,
 * the sign-ins index and the two tables: the schema of 0043 exactly (nothing is rolled back in production). One
 * statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// The folding lists, kept local on purpose (a migration never changes); test/shared/fold.test.ts checks they are
// src/shared/fold.ts's FOLD_FROM and FOLD_TO.
const FOLD_FROM = 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšșţťŧțùúûüũūŭůűųŵýÿŷźżž';
const FOLD_TO = 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnooooooooorrrsssssttttuuuuuuuuuuwyyyzzz';

export const UP: readonly string[] = [
  // ── account_notes ────────────────────────────────────────────────────────
  `CREATE TABLE account_notes (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     body       text        NOT NULL,
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     removed_at timestamptz NULL,
     removed_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     CONSTRAINT account_notes_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000 AND body = btrim(body)),
     CONSTRAINT account_notes_removed CHECK ((removed_at IS NULL) = (removed_by IS NULL) AND (removed_at IS NULL OR removed_at >= created_at))
   )`,
  `CREATE INDEX account_notes_account_idx ON account_notes (account_id, created_at DESC) WHERE removed_at IS NULL`,
  `CREATE INDEX account_notes_account_all_idx ON account_notes (account_id)`,
  `CREATE INDEX account_notes_created_by_idx ON account_notes (created_by)`,
  `CREATE INDEX account_notes_removed_by_idx ON account_notes (removed_by)`,
  `CREATE TRIGGER account_notes_immutable BEFORE UPDATE ON account_notes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'body', 'created_by', 'created_at')`,

  // ── account_tags ─────────────────────────────────────────────────────────
  `CREATE TABLE account_tags (
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     tag        text        NOT NULL,
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (account_id, tag),
     CONSTRAINT account_tags_tag CHECK (char_length(tag) BETWEEN 1 AND 32 AND tag = upper(tag) AND tag = btrim(tag) AND tag !~ '\\s{2,}' AND tag ~ '^[[:alnum:] &''’.-]+$')
   )`,
  `CREATE INDEX account_tags_tag_idx ON account_tags (tag)`,
  `CREATE INDEX account_tags_created_by_idx ON account_tags (created_by)`,

  // ── The sign-ins of an account, on the audit log ─────────────────────────
  `CREATE INDEX audit_logs_account_login_idx ON audit_logs (target_id, occurred_at) WHERE action = 'account.login'`,

  // ── orbes_fold and the cities it folds ───────────────────────────────────
  `CREATE FUNCTION orbes_fold(text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
     AS $$ SELECT translate(lower($1), '${FOLD_FROM}', '${FOLD_TO}') $$`,
  `CREATE INDEX account_profiles_city_fold_idx ON account_profiles (orbes_fold(city)) WHERE city IS NOT NULL`,
];

export const DOWN: readonly string[] = [
  `DROP INDEX IF EXISTS account_profiles_city_fold_idx`,
  `DROP FUNCTION IF EXISTS orbes_fold(text)`,
  `DROP INDEX IF EXISTS audit_logs_account_login_idx`,
  `DROP TABLE IF EXISTS account_tags`,
  `DROP TABLE IF EXISTS account_notes`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
