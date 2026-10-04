/**
 * 0020 — the private salon (P-X08; API §10.9, §16.22; DATABASE §5.3 and §5.37): the lookbook's RESERVED models, each
 * with a price shown and the lowest tier it is offered to, requested from /verify and concluded by ORBES Client
 * Services.
 *
 * Two columns of `models`:
 *  - `price_label`: the price as THE PRIVATE SALON shows it, 1 to 60 characters once trimmed (« € 4 800 », « Price on
 *    request »); NULL: no price shown. Read for a RESERVED model only (a PUBLIC sheet shows none);
 *  - `private_min_tier`: the lowest tier of the club the model is shown to while it is RESERVED, 1 TITANE (the
 *    default), 2 PLATINE or 3 PALLADIUM. Below it, its sheet answers 404 like a model not in the collection.
 *
 * `shop_requests`: an account's request for a model of the salon (REQUEST THIS PIECE), OPEN until the console closes
 * it (`handled_by`, `handled_at`, `resolution_note`: what was done), or until the account is locked (closed by the
 * lock's ADMIN, without a note). `note` is the account's own words, at most 500 characters (personal data: never
 * copied into the audit log). At most one OPEN request per account and model (`shop_requests_one_open`); a closed one
 * may be followed by another. An entry's id, account, model, creation and note never change
 * (`shop_requests_immutable_identity`).
 *
 * Every foreign key leads a full index (`shop_requests_account_idx`, `shop_requests_model_idx`,
 * `shop_requests_handled_by_idx`); ON DELETE RESTRICT like every other. `shop_requests_queue_idx` serves the console's
 * Requests tab (open first, newest first).
 *
 * Compatible with the previous image: a nullable column and a NOT NULL one with a constant default, which it never
 * names (it inserts models without them and reads them column by column), and a table it never reads. No row is
 * inserted. `down` drops the table, then the constraints and the columns: the schema of 0019 exactly. One statement
 * per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const REQUEST_STATUSES = `'OPEN','CLOSED'`;

export const UP: readonly string[] = [
  `ALTER TABLE models ADD COLUMN price_label text NULL CONSTRAINT models_price_label_check CHECK (length(btrim(price_label)) BETWEEN 1 AND 60)`,
  `ALTER TABLE models ADD COLUMN private_min_tier smallint NOT NULL DEFAULT 1 CONSTRAINT models_private_min_tier_check CHECK (private_min_tier BETWEEN 1 AND 3)`,

  `CREATE TABLE shop_requests (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id      uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     model_id        uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     note            text        NULL CHECK (length(btrim(note)) BETWEEN 1 AND 500),
     status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN (${REQUEST_STATUSES})),
     created_at      timestamptz NOT NULL DEFAULT now(),
     handled_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     handled_at      timestamptz NULL,
     resolution_note text        NULL CHECK (length(btrim(resolution_note)) BETWEEN 1 AND 2000),
     CONSTRAINT shop_requests_closed CHECK ((status = 'CLOSED') = (handled_at IS NOT NULL)),
     CONSTRAINT shop_requests_handled CHECK (handled_by IS NULL OR handled_at IS NOT NULL),
     CONSTRAINT shop_requests_resolution CHECK (resolution_note IS NULL OR status = 'CLOSED'),
     CONSTRAINT shop_requests_handled_after CHECK (handled_at IS NULL OR handled_at >= created_at)
   )`,
  `CREATE INDEX shop_requests_account_idx ON shop_requests (account_id, created_at)`,
  `CREATE INDEX shop_requests_model_idx ON shop_requests (model_id)`,
  `CREATE INDEX shop_requests_handled_by_idx ON shop_requests (handled_by)`,
  // The console's queue: by status, the newest first.
  `CREATE INDEX shop_requests_queue_idx ON shop_requests (status, created_at)`,
  // One open request per account and model.
  `CREATE UNIQUE INDEX shop_requests_one_open ON shop_requests (account_id, model_id) WHERE status = 'OPEN'`,
  `CREATE TRIGGER shop_requests_immutable_identity BEFORE UPDATE ON shop_requests
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'model_id', 'created_at', 'note')`,
];

export const DOWN: readonly string[] = [
  `DROP TABLE IF EXISTS shop_requests`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_private_min_tier_check`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_price_label_check`,
  `ALTER TABLE models DROP COLUMN IF EXISTS private_min_tier`,
  `ALTER TABLE models DROP COLUMN IF EXISTS price_label`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
