/**
 * 0029 — THE HOUSE'S GUARANTEE (plan NEXT-NINE of 2026-10-06, §3.3 IN-01, step 3.1: « Staff give one collector a
 * guaranteed place at the next release of a model or collection »; « in a DRAW, selected first; in a LIVE RELEASE, first
 * in line for its size; audited, and consumed once used »).
 *
 * `house_guarantees`: a place granted by ORBES Client Services to one account (`account_id`), at the next release of a
 * model (`scope` MODEL, `model_id`: a main model covers its variants), of a collection (COLLECTION, `collection_id`), or
 * at a chosen release (RELEASE, `drop_id`): exactly one target, matching the scope (`house_guarantees_scope`). For
 * `pieces` 1 to 5, valid for a release that opens by `valid_until` (after the grant: `house_guarantees_valid`), shown to
 * the client or not (`visible`), with an optional `note` for Client Services (1 to 500 characters, never shown in the
 * app). `covered_drop_id` and `covered_at`: the release it is set aside for, both or neither
 * (`house_guarantees_cover`; a chosen release's own release only: `house_guarantees_release_cover`). `status` ACTIVE,
 * USED (`used_at` and `used_drop_id`, exactly then: `house_guarantees_used`), EXPIRED or REVOKED (`revoked_by` exactly
 * then, with an optional `revoke_note`: `house_guarantees_revoked`); every status but ACTIVE closed, with its time and
 * reason, and only those (`house_guarantees_closed`). Who granted it (NULL: a script), who changed it last and when. One
 * ACTIVE guarantee per account and release set aside (`house_guarantees_one_per_release`); the waiting ones by scope and
 * target (`house_guarantees_waiting_idx`). Its identity, target and grant never change.
 *
 * `guarantee_settings`: the defaults of the Grant dialog (Orders → Settings, House guarantee), one row at most (`id` 1),
 * none inserted: valid for 90 days (1 to 730), 1 piece (1 to 5), shown to the client; who changed them and when.
 *
 * `drop_entries` gains `guarantee_id` (the guarantee its entry uses, once each: `drop_entries_guarantee_key`) and
 * `pieces` (1 to 5; above 1 only with a guarantee: `drop_entries_pieces`); a guaranteed entry is never ranked nor tiered
 * (`drop_entries_guaranteed`). `live_entries` gains `guarantee_id` (once each: `live_entries_guarantee_key`).
 *
 * `orders`: a draw's entry gives one order per piece (`orders_drop_entry_key` on (drop_entry_id, piece)), and
 * `orders_source` is 0027's with its piece clause widened to DRAW (`channel IN ('LIVE','DRAW') OR piece = 1`).
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. Compatible with the previous image: two tables
 * it never reads, columns with a constant default or nullable that it never names. If the previous image runs a draw
 * during the deployment, `drop_entries_guaranteed` refuses its UPDATE of a guaranteed entry and the draw fails closed
 * (none exists before this image grants one). No row is inserted. `down` refuses, naming the count, while any DRAW order
 * has a piece above 1 (the previous image keeps one order per entry); otherwise it restores 0027's `orders_source` and
 * `orders_drop_entry_key`, drops the entries' columns and constraints, then the two tables: the schema of 0028 exactly.
 * One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a
 * transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const SCOPES = `'RELEASE','MODEL','COLLECTION'`;
const STATUSES = `'ACTIVE','USED','EXPIRED','REVOKED'`;
const CLOSED_REASONS = `'USED','RELEASE_ENDED','RELEASE_CANCELLED','REVOKED'`;

const words = (column: string, max: number) => `${column} IS NULL OR length(btrim(${column})) BETWEEN 1 AND ${max}`;

/** orders_source as 0027 wrote it. */
const SOURCE_0027 = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel IN ('SALON', 'GIFT')) = (drop_id IS NULL)
       AND (channel = 'LIVE' OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)`;
/** orders_source with a draw's entry giving one order per piece. */
const SOURCE = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel IN ('SALON', 'GIFT')) = (drop_id IS NULL)
       AND (channel IN ('LIVE', 'DRAW') OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)`;

export const UP: readonly string[] = [
  // ── house_guarantees ─────────────────────────────────────────────────────
  `CREATE TABLE house_guarantees (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id      uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     scope           text        NOT NULL CHECK (scope IN (${SCOPES})),
     drop_id         uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     model_id        uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     collection_id   uuid        NULL REFERENCES collections (id) ON DELETE RESTRICT,
     pieces          smallint    NOT NULL DEFAULT 1 CHECK (pieces BETWEEN 1 AND 5),
     valid_until     timestamptz NOT NULL,
     visible         boolean     NOT NULL DEFAULT true,
     note            text        NULL CHECK (${words('note', 500)}),
     covered_drop_id uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     covered_at      timestamptz NULL,
     status          text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (${STATUSES})),
     used_at         timestamptz NULL,
     used_drop_id    uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     closed_at       timestamptz NULL,
     closed_reason   text        NULL CHECK (closed_reason IN (${CLOSED_REASONS})),
     revoked_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     revoke_note     text        NULL CHECK (${words('revoke_note', 500)}),
     granted_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     granted_at      timestamptz NOT NULL DEFAULT now(),
     updated_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at      timestamptz NULL,
     CONSTRAINT house_guarantees_scope CHECK (
       (scope = 'RELEASE') = (drop_id IS NOT NULL) AND (scope = 'MODEL') = (model_id IS NOT NULL) AND (scope = 'COLLECTION') = (collection_id IS NOT NULL)),
     CONSTRAINT house_guarantees_release_cover CHECK (scope <> 'RELEASE' OR covered_drop_id IS NULL OR covered_drop_id = drop_id),
     CONSTRAINT house_guarantees_valid CHECK (valid_until > granted_at),
     CONSTRAINT house_guarantees_cover CHECK ((covered_drop_id IS NULL) = (covered_at IS NULL)),
     CONSTRAINT house_guarantees_used CHECK ((status = 'USED') = (used_at IS NOT NULL AND used_drop_id IS NOT NULL)),
     CONSTRAINT house_guarantees_closed CHECK (((status = 'ACTIVE') = (closed_at IS NULL)) AND ((closed_reason IS NULL) = (closed_at IS NULL))),
     CONSTRAINT house_guarantees_revoked CHECK ((status = 'REVOKED') = (revoked_by IS NOT NULL))
   )`,
  `CREATE INDEX house_guarantees_account_idx ON house_guarantees (account_id, status)`,
  // The guarantees set aside for a release, as its draw, its end and its room count read them.
  `CREATE INDEX house_guarantees_covered_idx ON house_guarantees (covered_drop_id) WHERE status = 'ACTIVE'`,
  // The guarantees waiting for the next release of their model or collection, as a publication reads them.
  `CREATE INDEX house_guarantees_waiting_idx ON house_guarantees (scope, model_id, collection_id) WHERE status = 'ACTIVE' AND covered_drop_id IS NULL`,
  // One ACTIVE guarantee per account and release set aside.
  `CREATE UNIQUE INDEX house_guarantees_one_per_release ON house_guarantees (account_id, covered_drop_id) WHERE status = 'ACTIVE' AND covered_drop_id IS NOT NULL`,
  `CREATE INDEX house_guarantees_drop_idx ON house_guarantees (drop_id)`,
  `CREATE INDEX house_guarantees_model_idx ON house_guarantees (model_id)`,
  `CREATE INDEX house_guarantees_collection_idx ON house_guarantees (collection_id)`,
  `CREATE INDEX house_guarantees_covered_drop_idx ON house_guarantees (covered_drop_id)`,
  `CREATE INDEX house_guarantees_used_drop_idx ON house_guarantees (used_drop_id)`,
  `CREATE INDEX house_guarantees_revoked_by_idx ON house_guarantees (revoked_by)`,
  `CREATE INDEX house_guarantees_granted_by_idx ON house_guarantees (granted_by)`,
  `CREATE INDEX house_guarantees_updated_by_idx ON house_guarantees (updated_by)`,
  `CREATE TRIGGER house_guarantees_immutable BEFORE UPDATE ON house_guarantees
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'scope', 'drop_id', 'model_id', 'collection_id', 'granted_by', 'granted_at')`,

  // ── guarantee_settings ───────────────────────────────────────────────────
  `CREATE TABLE guarantee_settings (
     id         smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     valid_days smallint    NOT NULL DEFAULT 90 CHECK (valid_days BETWEEN 1 AND 730),
     pieces     smallint    NOT NULL DEFAULT 1 CHECK (pieces BETWEEN 1 AND 5),
     visible    boolean     NOT NULL DEFAULT true,
     updated_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX guarantee_settings_updated_by_idx ON guarantee_settings (updated_by)`,

  // ── drop_entries: the guarantee it uses, and its pieces ──────────────────
  `ALTER TABLE drop_entries ADD COLUMN guarantee_id uuid NULL REFERENCES house_guarantees (id) ON DELETE RESTRICT`,
  `ALTER TABLE drop_entries ADD COLUMN pieces smallint NOT NULL DEFAULT 1 CHECK (pieces BETWEEN 1 AND 5)`,
  `ALTER TABLE drop_entries ADD CONSTRAINT drop_entries_guaranteed CHECK (guarantee_id IS NULL OR (rank IS NULL AND tier IS NULL))`,
  `ALTER TABLE drop_entries ADD CONSTRAINT drop_entries_pieces CHECK (pieces = 1 OR guarantee_id IS NOT NULL)`,
  `ALTER TABLE drop_entries ADD CONSTRAINT drop_entries_guarantee_key UNIQUE (guarantee_id)`,

  // ── live_entries: the guarantee it uses ──────────────────────────────────
  `ALTER TABLE live_entries ADD COLUMN guarantee_id uuid NULL REFERENCES house_guarantees (id) ON DELETE RESTRICT`,
  `ALTER TABLE live_entries ADD CONSTRAINT live_entries_guarantee_key UNIQUE (guarantee_id)`,

  // ── orders: one order per piece of a draw's entry ────────────────────────
  `ALTER TABLE orders DROP CONSTRAINT orders_drop_entry_key`,
  `ALTER TABLE orders ADD CONSTRAINT orders_drop_entry_key UNIQUE (drop_entry_id, piece)`,
  `ALTER TABLE orders DROP CONSTRAINT orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE})`,
];

export const DOWN: readonly string[] = [
  // The previous image keeps one order per draw's entry: refused while any has a second piece.
  `DO $$
   DECLARE pieces bigint;
   BEGIN
     SELECT count(*) INTO pieces FROM orders WHERE channel = 'DRAW' AND piece > 1;
     IF pieces > 0 THEN
       RAISE EXCEPTION 'migration 0029_house_guarantee cannot be rolled back: % draw orders of a second piece or more exist', pieces;
     END IF;
   END $$`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE_0027})`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_drop_entry_key`,
  `ALTER TABLE orders ADD CONSTRAINT orders_drop_entry_key UNIQUE (drop_entry_id)`,
  `ALTER TABLE live_entries DROP CONSTRAINT IF EXISTS live_entries_guarantee_key`,
  `ALTER TABLE live_entries DROP COLUMN IF EXISTS guarantee_id`,
  `ALTER TABLE drop_entries DROP CONSTRAINT IF EXISTS drop_entries_guarantee_key`,
  `ALTER TABLE drop_entries DROP CONSTRAINT IF EXISTS drop_entries_pieces`,
  `ALTER TABLE drop_entries DROP CONSTRAINT IF EXISTS drop_entries_guaranteed`,
  `ALTER TABLE drop_entries DROP COLUMN IF EXISTS pieces`,
  `ALTER TABLE drop_entries DROP COLUMN IF EXISTS guarantee_id`,
  `DROP TABLE IF EXISTS guarantee_settings`,
  `DROP TABLE IF EXISTS house_guarantees`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
