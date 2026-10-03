/**
 * 0015 — drops: a release of a model in a limited number of pieces, on a
 * waiting list, with a draw by tier (P-R03; API §8.9, §10.10, §16.19;
 * DATABASE §5.29, §5.30).
 *
 * `drops`: one release, created by the console (OPERATOR) as a DRAFT and
 * edited freely until it is published; once published only its description
 * changes, and it is cancelled only before its draw. Its state is computed,
 * never stored: DRAFT (`published_at` NULL), UPCOMING, OPEN (`opens_at` ≤
 * now < `closes_at`), CLOSED, DRAWN (`drawn_at`), CANCELLED (`cancelled_at`).
 *  - `quantity` ≥ 1 pieces; `closes_at` after `opens_at` (`drops_window`);
 *    `purchase_window_hours`, 1 to 336 (48 by default): how long a place
 *    drawn is held (`drop_entries.respond_by`).
 *  - The seed of the draw: 32 random bytes drawn at creation, sealed with a
 *    key derived from KEY_ENCRYPTION_KEY like the console's TOTP secrets
 *    (`seed_enc`: `v1.<iv>.<ciphertext>`, the drop's id as associated
 *    data), and committed by its SHA-256 (`seed_hash`), which the public
 *    page shows from the publication on. The seed itself (`seed`) is stored
 *    in clear only by the draw, which reveals it: `drops_seed` makes it the
 *    32 bytes whose SHA-256 is `seed_hash`, `drops_drawn` sets it exactly
 *    when `drawn_at` is set. `seed_enc` and `seed_hash` never change
 *    (`drops_immutable_seed`): a drop cannot be drawn with another seed than
 *    the one its published fingerprint commits to.
 *  - A draw follows the publication and `closes_at`
 *    (`drops_drawn_after_close`), never a cancellation
 *    (`drops_cancelled_before_draw`).
 *
 * `drop_entries`: one row per account and drop (`drop_entries_drop_account_key`),
 * ENTERED, then WITHDRAWN by its account (an entry again sets the same row
 * back to ENTERED: never a deletion and a new row, which would let a draw
 * be run again with other ids), or, by the draw, SELECTED (a place held
 * until `respond_by`) or WAITLISTED (its `rank`); then CONFIRMED (the sale
 * concluded by ORBES Client Services) or LAPSED (after `respond_by`), by
 * the console (`handled_by`, `handled_at`, `note`). `tier` and `seniority`
 * are written by the draw (the club's standing of the account at that
 * moment, never at entry: pieces borrowed by a transfer for the entry
 * would otherwise count), with the `rank` of every entry drawn. An entry's
 * id, account and creation never change (`drop_entries_immutable_identity`).
 *
 * Every foreign key leads an index (`drops_model_id_idx`,
 * `drops_created_by_idx`, the unique `(drop_id, account_id)`,
 * `drop_entries_account_idx`, `drop_entries_handled_by_idx`); ON DELETE
 * RESTRICT like every other. Nothing in an older image reads or writes the
 * two tables (DATABASE §9.1). One statement per array entry (PGlite's
 * extended protocol); Kysely's Migrator applies the migration inside a
 * transaction. The down step drops both tables: the schema of 0014.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const ENTRY_STATUSES = `'ENTERED','SELECTED','WAITLISTED','CONFIRMED','LAPSED','WITHDRAWN'`;

export const UP: readonly string[] = [
  `CREATE TABLE drops (
     id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     model_id              uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     title                 text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
     description           text        NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
     quantity              int         NOT NULL CHECK (quantity >= 1),
     opens_at              timestamptz NOT NULL,
     closes_at             timestamptz NOT NULL,
     purchase_window_hours smallint    NOT NULL DEFAULT 48 CHECK (purchase_window_hours BETWEEN 1 AND 336),
     published_at          timestamptz NULL,
     cancelled_at          timestamptz NULL,
     seed_enc              text        NOT NULL CHECK (seed_enc ~ '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{64}$'),
     seed_hash             bytea       NOT NULL CHECK (octet_length(seed_hash) = 32),
     seed                  bytea       NULL,
     drawn_at              timestamptz NULL,
     created_by            uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at            timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT drops_window CHECK (closes_at > opens_at),
     CONSTRAINT drops_seed CHECK (seed IS NULL OR (octet_length(seed) = 32 AND seed_hash = sha256(seed))),
     CONSTRAINT drops_drawn CHECK ((drawn_at IS NULL) = (seed IS NULL)),
     CONSTRAINT drops_drawn_after_close CHECK (drawn_at IS NULL OR (published_at IS NOT NULL AND drawn_at >= closes_at)),
     CONSTRAINT drops_cancelled_before_draw CHECK (cancelled_at IS NULL OR drawn_at IS NULL)
   )`,
  `CREATE INDEX drops_model_id_idx ON drops (model_id)`,
  `CREATE INDEX drops_created_by_idx ON drops (created_by)`,
  // The public list: the drops published, by their opening.
  `CREATE INDEX drops_published_opens_idx ON drops (opens_at) WHERE published_at IS NOT NULL`,
  `CREATE TRIGGER drops_immutable_seed BEFORE UPDATE ON drops
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('seed_enc', 'seed_hash')`,

  `CREATE TABLE drop_entries (
     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id     uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     created_at  timestamptz NOT NULL DEFAULT now(),
     status      text        NOT NULL DEFAULT 'ENTERED' CHECK (status IN (${ENTRY_STATUSES})),
     tier        smallint    NULL CHECK (tier BETWEEN 0 AND 3),
     seniority   smallint    NULL CHECK (seniority >= 0),
     rank        int         NULL CHECK (rank >= 1),
     respond_by  timestamptz NULL,
     handled_by  uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     handled_at  timestamptz NULL,
     note        text        NULL CHECK (length(btrim(note)) BETWEEN 1 AND 500),
     CONSTRAINT drop_entries_drop_account_key UNIQUE (drop_id, account_id),
     CONSTRAINT drop_entries_standing CHECK ((tier IS NULL) = (seniority IS NULL) AND (rank IS NULL OR tier IS NOT NULL)),
     CONSTRAINT drop_entries_entered CHECK (status <> 'ENTERED' OR (tier IS NULL AND rank IS NULL AND respond_by IS NULL AND handled_at IS NULL)),
     CONSTRAINT drop_entries_withdrawn CHECK (status <> 'WITHDRAWN' OR rank IS NULL),
     CONSTRAINT drop_entries_waitlisted CHECK (status <> 'WAITLISTED' OR rank IS NOT NULL),
     CONSTRAINT drop_entries_held CHECK (status NOT IN ('SELECTED','CONFIRMED','LAPSED') OR respond_by IS NOT NULL),
     CONSTRAINT drop_entries_handled CHECK (status NOT IN ('CONFIRMED','LAPSED') OR handled_at IS NOT NULL),
     CONSTRAINT drop_entries_lapsed CHECK (status <> 'LAPSED' OR handled_at >= respond_by),
     CHECK (handled_at IS NULL OR handled_at >= created_at)
   )`,
  `CREATE INDEX drop_entries_account_idx ON drop_entries (account_id, created_at)`,
  `CREATE INDEX drop_entries_handled_by_idx ON drop_entries (handled_by)`,
  // A drop's entries by status and rank: the draw's list, the next on the waiting list, the places taken.
  `CREATE INDEX drop_entries_drop_status_idx ON drop_entries (drop_id, status, rank)`,
  `CREATE TRIGGER drop_entries_immutable_identity BEFORE UPDATE ON drop_entries
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'drop_id', 'account_id', 'created_at')`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS drop_entries`, `DROP TABLE IF EXISTS drops`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
