/**
 * 0057 — THE SET (macro scope of 2026-10-20, K44 T1 to T4; lot M3 plan §5.2, step M3.13): staff group 2 to 4 models into
 * a set with one price, sold as its own release (a draw or a LIVE), one entry and one price, each piece's size chosen at
 * entry (T1); each piece its own order, its own ORBES identity, counted toward the tier (T2); in a LIVE, a set counts as
 * one toward the pieces per account (T4); returned whole only (T3).
 *
 * `sets`: one row per set.
 *  - `name` (1 to 60 characters, trimmed, unique whatever the case, `sets_name_key`), `code` (its reference and future
 *    Shopify handle, `^[A-Z0-9][A-Z0-9-]{1,39}$`, unique, `sets_code_key`);
 *  - `base_price_minor` (0 to 100 000 000) and `base_currency` (three capital letters), both or neither (`sets_base_price`),
 *    as a model's: a release carries its own price;
 *  - `active` (DEFAULT true: set aside when false, never deleted), `shopify_product_id` (the set's one Shopify product,
 *    pasted back; once, S5);
 *  - `created_at`, `created_by` (NULL for a script), `updated_at` (stamped by `orbes_touch_updated_at`); its id, creation
 *    and author never change.
 *
 * `set_models`: its pieces in order, `position` 1 to 4 (the primary key with the set), each a model or a variant
 * (`models`), each model once per set (`set_models_model_key`). That a set holds 2 to 4 of them, at positions 1 to n, is
 * the service's rule (SetService, M3.14), which replaces them together and only while no release names the set.
 *
 * `drops` (a release sells a model or a set): `model_id` becomes NULL-able, `set_id` (`sets`) is added, and exactly one is
 * named (`drops_one_offer`). A set's release is never an after-room (`drops_set_no_after_room`); that it never has one is
 * the service's (an after-room is opened by its parent's settings). `drops_set_key` (id, set_id) lets a set sale name a
 * release of its own set. Every existing release keeps its model.
 *
 * `drop_sizes` (a set release's sizes are given per piece): `piece` (1 to 4, the set's position; NULL on a model's
 * release), `position` widened to 1 to 96 (4 pieces × 24 sizes), a label once per release and piece
 * (`drop_sizes_label_key`, NULLS NOT DISTINCT: once per release on a model's), `drop_sizes_piece_key` (id, drop_id, piece)
 * so that an entry's size is of its release and of the piece it is chosen for; the identity guard gains `piece`.
 *
 * The sizes an entry chose, one per piece (a model's release keeps its one `size_id`):
 *  - `drop_entry_sizes` (a draw entry; its `drop_entries.size_id` stays NULL), `live_entry_sizes` (a LIVE entry; its
 *    `live_entries.size_id` keeps its first piece's size, NOT NULL as today) and `live_interest_sizes` (I'LL BE THERE;
 *    its `live_interest.size_id` keeps its first piece's size);
 *  - each row its entry (or interest) with its release, the piece and a size of that release and piece (the composite
 *    foreign keys to `drop_entries`/`live_entries` (id, drop_id), `live_interest` (drop_id, account_id) and `drop_sizes`
 *    (id, drop_id, piece)); one per piece (the primary key); its entry, release and piece never change, its size does
 *    (CHANGE SIZE).
 *  - Every foreign key is ON DELETE RESTRICT, as every other (the contract test): the service deletes an entry's or an
 *    interest's sizes where it deletes the interest (I'LL BE THERE withdrawn, END TEST), as it deletes a LIVE entry's
 *    add-ons.
 *
 * `set_sales`: one per set sold, its set, its release (NULL for a sale on the future Shopify store, S2: never assumed to
 * be the only place people pay; `set_sales_drop_fkey` (drop_id, set_id) to a release of that set), its account, the one
 * price and currency (both or neither, as an order's: a draw without a price has none until Client Services enters it),
 * `created_at`, `shopify_line_item_id` (the store's line item, once, S5). Its id, set, release, account and creation never
 * change. `set_sales_sale_account_key` (id, account_id) lets each of its orders name it with its own account.
 *
 * `orders.set_sale_id` and `orders.set_piece` (1 to 4), both or neither (`orders_set_sale`): the piece of a set sale an
 * order is (an EXCHANGE order joins the set sale in its piece's place); `orders_set_sale_fkey` (set_sale_id, account_id)
 * to `set_sales (id, account_id)`: a set sale's orders are its buyer's. The order's identity guard gains both.
 * `orders.piece` (0022's `orders_piece_check`, 1 to 5: a LIVE entry's pieces) reaches 20 on a set sale's orders (T4: a
 * set counts as one toward the pieces per person, so a LIVE entry of up to 5 sets of up to 4 pieces numbers its orders
 * 1 to 20); every other order keeps 1 to 5.
 *
 * `order_cases.group_id`: the cases of one set's return, opened and decided together (RETURN only, `order_cases_group`);
 * its identity guard gains it.
 *
 * Every foreign key ON DELETE RESTRICT, at the head of an index. On the previous image (0056) during the roll-out: tables
 * and columns it never reads, and every release it writes names its model. No row is inserted. `down` refuses, naming the
 * counts, while a set, a set release, a set sale, a grouped return case or a release size given per piece (or past the
 * 24th) exists; otherwise it restores the schema of 0056 exactly. One statement per array entry (PGlite's extended
 * protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** A set's name, at most (schema.ts SET_NAME_MAX). */
const NAME_MAX = 60;
/** A set's code (schema.ts SET_CODE_PATTERN). */
const CODE = `'^[A-Z0-9][A-Z0-9-]{1,39}$'`;
/** A set's pieces, at most (schema.ts SET_PIECES_MAX). */
const PIECES_MAX = 4;
/** A price, at most, in minor units (schema.ts SET_PRICE_MINOR_MAX). */
const PRICE_MAX = 100000000;
/** A release's sizes, at most: 24 per piece (schema.ts DROP_SIZE_POSITION_MAX); 24 before this migration. */
const POSITION_MAX = 96;
const POSITION_MAX_0021 = 24;
/** An order's piece, at most (schema.ts ORDER_PIECE_MAX): 5 sets of 4 pieces on a set sale's; 5 before this migration. */
const ORDER_PIECE_MAX = 20;
const ORDER_PIECE_MAX_0022 = 5;
/** A Shopify id, as 0022's. */
const SHOPIFY_ID = `'^[1-9][0-9]{0,19}$'`;

const words = (column: string, max: number) => `length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column})`;
const quoted = (columns: readonly string[]) => columns.map((c) => `'${c}'`).join(', ');

/** The identity guards before this migration (0021's drop sizes, 0037's orders and order cases), restored by down. */
const DROP_SIZE_IDENTITY_0021 = ['id', 'drop_id'] as const;
const ORDER_IDENTITY_0037 = [
  'id', 'channel', 'live_entry_id', 'piece', 'drop_entry_id', 'shop_request_id', 'drop_id', 'account_id', 'model_id', 'reserved_at',
  'with_order_id', 'gift_grant_id', 'exchange_of_order_id',
] as const;
const ORDER_CASE_IDENTITY_0037 = [
  'id', 'order_id', 'shipment_id', 'kind', 'opened_by_type', 'opened_by_id', 'opened_at', 'reason', 'note', 'exchange_sku_id', 'exchange_size_label',
  'message_id',
] as const;

export const UP: readonly string[] = [
  // ── sets ─────────────────────────────────────────────────────────────────
  `CREATE TABLE sets (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name               text        NOT NULL CONSTRAINT sets_name_check CHECK (${words('name', NAME_MAX)}),
     code               text        NOT NULL CONSTRAINT sets_code_check CHECK (code ~ ${CODE}),
     base_price_minor   integer     NULL CONSTRAINT sets_base_price_minor_check CHECK (base_price_minor BETWEEN 0 AND ${PRICE_MAX}),
     base_currency      text        NULL CONSTRAINT sets_base_currency_check CHECK (base_currency ~ '^[A-Z]{3}$'),
     active             boolean     NOT NULL DEFAULT true,
     shopify_product_id text        NULL CONSTRAINT sets_shopify_product_id_check CHECK (shopify_product_id ~ ${SHOPIFY_ID}),
     created_at         timestamptz NOT NULL DEFAULT now(),
     created_by         uuid        NULL CONSTRAINT sets_created_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at         timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT sets_code_key UNIQUE (code),
     CONSTRAINT sets_shopify_product_key UNIQUE (shopify_product_id),
     CONSTRAINT sets_base_price CHECK ((base_price_minor IS NULL) = (base_currency IS NULL))
   )`,
  `CREATE UNIQUE INDEX sets_name_key ON sets (lower(name))`,
  `CREATE INDEX sets_created_by_idx ON sets (created_by)`,
  `CREATE TRIGGER sets_immutable_identity BEFORE UPDATE ON sets
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at', 'created_by')`,
  `CREATE TRIGGER sets_touch_updated_at BEFORE UPDATE ON sets
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  // ── set_models: its pieces, in order ─────────────────────────────────────
  `CREATE TABLE set_models (
     set_id   uuid     NOT NULL CONSTRAINT set_models_set_id_fkey REFERENCES sets (id) ON DELETE RESTRICT,
     position smallint NOT NULL CONSTRAINT set_models_position_check CHECK (position BETWEEN 1 AND ${PIECES_MAX}),
     model_id uuid     NOT NULL CONSTRAINT set_models_model_id_fkey REFERENCES models (id) ON DELETE RESTRICT,
     CONSTRAINT set_models_pkey PRIMARY KEY (set_id, position),
     CONSTRAINT set_models_model_key UNIQUE (set_id, model_id)
   )`,
  `CREATE INDEX set_models_model_idx ON set_models (model_id)`,

  // ── drops: a model's release or a set's ──────────────────────────────────
  `ALTER TABLE drops ALTER COLUMN model_id DROP NOT NULL`,
  `ALTER TABLE drops ADD COLUMN set_id uuid NULL CONSTRAINT drops_set_id_fkey REFERENCES sets (id) ON DELETE RESTRICT`,
  `CREATE INDEX drops_set_id_idx ON drops (set_id)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_set_key UNIQUE (id, set_id)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_one_offer CHECK (num_nonnulls(model_id, set_id) = 1)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_set_no_after_room CHECK (set_id IS NULL OR parent_drop_id IS NULL)`,

  // ── drop_sizes: per piece on a set's release ─────────────────────────────
  `ALTER TABLE drop_sizes ADD COLUMN piece smallint NULL CONSTRAINT drop_sizes_piece_check CHECK (piece BETWEEN 1 AND ${PIECES_MAX})`,
  `ALTER TABLE drop_sizes DROP CONSTRAINT drop_sizes_position_check`,
  `ALTER TABLE drop_sizes ADD CONSTRAINT drop_sizes_position_check CHECK (position BETWEEN 1 AND ${POSITION_MAX})`,
  `ALTER TABLE drop_sizes DROP CONSTRAINT drop_sizes_label_key`,
  `ALTER TABLE drop_sizes ADD CONSTRAINT drop_sizes_label_key UNIQUE NULLS NOT DISTINCT (drop_id, piece, label)`,
  `ALTER TABLE drop_sizes ADD CONSTRAINT drop_sizes_piece_key UNIQUE (id, drop_id, piece)`,
  `DROP TRIGGER drop_sizes_immutable_identity ON drop_sizes`,
  `CREATE TRIGGER drop_sizes_immutable_identity BEFORE UPDATE ON drop_sizes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...DROP_SIZE_IDENTITY_0021, 'piece'])})`,

  // ── the sizes an entry or an interest chose, one per piece ──────────────
  `ALTER TABLE drop_entries ADD CONSTRAINT drop_entries_entry_drop_key UNIQUE (id, drop_id)`,
  `ALTER TABLE live_entries ADD CONSTRAINT live_entries_entry_drop_key UNIQUE (id, drop_id)`,
  `CREATE TABLE drop_entry_sizes (
     entry_id uuid     NOT NULL,
     drop_id  uuid     NOT NULL,
     piece    smallint NOT NULL CONSTRAINT drop_entry_sizes_piece_check CHECK (piece BETWEEN 1 AND ${PIECES_MAX}),
     size_id  uuid     NOT NULL,
     CONSTRAINT drop_entry_sizes_pkey PRIMARY KEY (entry_id, piece),
     CONSTRAINT drop_entry_sizes_entry_fkey FOREIGN KEY (entry_id, drop_id) REFERENCES drop_entries (id, drop_id) ON DELETE RESTRICT,
     CONSTRAINT drop_entry_sizes_size_fkey FOREIGN KEY (size_id, drop_id, piece) REFERENCES drop_sizes (id, drop_id, piece) ON DELETE RESTRICT
   )`,
  `CREATE INDEX drop_entry_sizes_size_idx ON drop_entry_sizes (size_id)`,
  `CREATE TRIGGER drop_entry_sizes_immutable_identity BEFORE UPDATE ON drop_entry_sizes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('entry_id', 'drop_id', 'piece')`,
  `CREATE TABLE live_entry_sizes (
     entry_id uuid     NOT NULL,
     drop_id  uuid     NOT NULL,
     piece    smallint NOT NULL CONSTRAINT live_entry_sizes_piece_check CHECK (piece BETWEEN 1 AND ${PIECES_MAX}),
     size_id  uuid     NOT NULL,
     CONSTRAINT live_entry_sizes_pkey PRIMARY KEY (entry_id, piece),
     CONSTRAINT live_entry_sizes_entry_fkey FOREIGN KEY (entry_id, drop_id) REFERENCES live_entries (id, drop_id) ON DELETE RESTRICT,
     CONSTRAINT live_entry_sizes_size_fkey FOREIGN KEY (size_id, drop_id, piece) REFERENCES drop_sizes (id, drop_id, piece) ON DELETE RESTRICT
   )`,
  `CREATE INDEX live_entry_sizes_size_idx ON live_entry_sizes (size_id)`,
  `CREATE TRIGGER live_entry_sizes_immutable_identity BEFORE UPDATE ON live_entry_sizes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('entry_id', 'drop_id', 'piece')`,
  `CREATE TABLE live_interest_sizes (
     drop_id    uuid     NOT NULL,
     account_id uuid     NOT NULL,
     piece      smallint NOT NULL CONSTRAINT live_interest_sizes_piece_check CHECK (piece BETWEEN 1 AND ${PIECES_MAX}),
     size_id    uuid     NOT NULL,
     CONSTRAINT live_interest_sizes_pkey PRIMARY KEY (drop_id, account_id, piece),
     CONSTRAINT live_interest_sizes_interest_fkey FOREIGN KEY (drop_id, account_id) REFERENCES live_interest (drop_id, account_id) ON DELETE RESTRICT,
     CONSTRAINT live_interest_sizes_size_fkey FOREIGN KEY (size_id, drop_id, piece) REFERENCES drop_sizes (id, drop_id, piece) ON DELETE RESTRICT
   )`,
  `CREATE INDEX live_interest_sizes_size_idx ON live_interest_sizes (size_id)`,
  `CREATE TRIGGER live_interest_sizes_immutable_identity BEFORE UPDATE ON live_interest_sizes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('drop_id', 'account_id', 'piece')`,

  // ── set_sales: one per set sold ──────────────────────────────────────────
  `CREATE TABLE set_sales (
     id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     set_id               uuid        NOT NULL CONSTRAINT set_sales_set_id_fkey REFERENCES sets (id) ON DELETE RESTRICT,
     drop_id              uuid        NULL,
     account_id           uuid        NOT NULL CONSTRAINT set_sales_account_id_fkey REFERENCES accounts (id) ON DELETE RESTRICT,
     price_minor          integer     NULL CONSTRAINT set_sales_price_minor_check CHECK (price_minor BETWEEN 0 AND ${PRICE_MAX}),
     currency             text        NULL CONSTRAINT set_sales_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
     created_at           timestamptz NOT NULL DEFAULT now(),
     shopify_line_item_id text        NULL CONSTRAINT set_sales_shopify_line_item_id_check CHECK (shopify_line_item_id ~ ${SHOPIFY_ID}),
     CONSTRAINT set_sales_drop_fkey FOREIGN KEY (drop_id, set_id) REFERENCES drops (id, set_id) ON DELETE RESTRICT,
     CONSTRAINT set_sales_price CHECK ((price_minor IS NULL) = (currency IS NULL)),
     CONSTRAINT set_sales_sale_account_key UNIQUE (id, account_id),
     CONSTRAINT set_sales_shopify_line_item_key UNIQUE (shopify_line_item_id)
   )`,
  `CREATE INDEX set_sales_set_idx ON set_sales (set_id)`,
  `CREATE INDEX set_sales_drop_idx ON set_sales (drop_id)`,
  `CREATE INDEX set_sales_account_idx ON set_sales (account_id)`,
  `CREATE TRIGGER set_sales_immutable_identity BEFORE UPDATE ON set_sales
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'set_id', 'drop_id', 'account_id', 'created_at')`,

  // ── orders: the piece of a set sale ──────────────────────────────────────
  `ALTER TABLE orders ADD COLUMN set_sale_id uuid NULL`,
  `ALTER TABLE orders ADD COLUMN set_piece smallint NULL CONSTRAINT orders_set_piece_check CHECK (set_piece BETWEEN 1 AND ${PIECES_MAX})`,
  `ALTER TABLE orders ADD CONSTRAINT orders_set_sale CHECK ((set_sale_id IS NULL) = (set_piece IS NULL))`,
  `ALTER TABLE orders ADD CONSTRAINT orders_set_sale_fkey FOREIGN KEY (set_sale_id, account_id) REFERENCES set_sales (id, account_id) ON DELETE RESTRICT`,
  `ALTER TABLE orders DROP CONSTRAINT orders_piece_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_piece_check CHECK (piece BETWEEN 1 AND ${ORDER_PIECE_MAX} AND (piece <= ${ORDER_PIECE_MAX_0022} OR set_sale_id IS NOT NULL))`,
  `CREATE INDEX orders_set_sale_idx ON orders (set_sale_id)`,
  `DROP TRIGGER orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...ORDER_IDENTITY_0037, 'set_sale_id', 'set_piece'])})`,

  // ── order_cases: the cases of one set's return ───────────────────────────
  `ALTER TABLE order_cases ADD COLUMN group_id uuid NULL`,
  `ALTER TABLE order_cases ADD CONSTRAINT order_cases_group CHECK (group_id IS NULL OR kind = 'RETURN')`,
  `CREATE INDEX order_cases_group_idx ON order_cases (group_id)`,
  `DROP TRIGGER order_cases_immutable_identity ON order_cases`,
  `CREATE TRIGGER order_cases_immutable_identity BEFORE UPDATE ON order_cases
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...ORDER_CASE_IDENTITY_0037, 'group_id'])})`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no set: refused while any would be lost.
  `DO $$
   DECLARE sets_n bigint; releases_n bigint; sales_n bigint; cases_n bigint; sizes_n bigint;
   BEGIN
     SELECT count(*) INTO sets_n FROM sets;
     SELECT count(*) INTO releases_n FROM drops WHERE set_id IS NOT NULL;
     SELECT count(*) INTO sales_n FROM set_sales;
     SELECT count(*) INTO cases_n FROM order_cases WHERE group_id IS NOT NULL;
     SELECT count(*) INTO sizes_n FROM drop_sizes WHERE piece IS NOT NULL OR position > ${POSITION_MAX_0021};
     IF sets_n > 0 OR releases_n > 0 OR sales_n > 0 OR cases_n > 0 OR sizes_n > 0 THEN
       RAISE EXCEPTION 'migration 0057_sets cannot be rolled back: % sets, % set releases, % set sales, % grouped return cases and % release sizes given per piece exist', sets_n, releases_n, sales_n, cases_n, sizes_n;
     END IF;
   END $$`,
  `DROP TRIGGER IF EXISTS order_cases_immutable_identity ON order_cases`,
  `CREATE TRIGGER order_cases_immutable_identity BEFORE UPDATE ON order_cases
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(ORDER_CASE_IDENTITY_0037)})`,
  `DROP INDEX IF EXISTS order_cases_group_idx`,
  `ALTER TABLE order_cases DROP CONSTRAINT IF EXISTS order_cases_group`,
  `ALTER TABLE order_cases DROP COLUMN IF EXISTS group_id`,
  `DROP TRIGGER IF EXISTS orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(ORDER_IDENTITY_0037)})`,
  `DROP INDEX IF EXISTS orders_set_sale_idx`,
  // No order past its 5th piece is left: each is a set sale's, refused above.
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_piece_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_piece_check CHECK (piece BETWEEN 1 AND ${ORDER_PIECE_MAX_0022})`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_set_sale_fkey`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_set_sale`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS set_piece`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS set_sale_id`,
  `DROP TABLE IF EXISTS set_sales`,
  `DROP TABLE IF EXISTS live_interest_sizes`,
  `DROP TABLE IF EXISTS live_entry_sizes`,
  `DROP TABLE IF EXISTS drop_entry_sizes`,
  `ALTER TABLE live_entries DROP CONSTRAINT IF EXISTS live_entries_entry_drop_key`,
  `ALTER TABLE drop_entries DROP CONSTRAINT IF EXISTS drop_entries_entry_drop_key`,
  `DROP TRIGGER IF EXISTS drop_sizes_immutable_identity ON drop_sizes`,
  `CREATE TRIGGER drop_sizes_immutable_identity BEFORE UPDATE ON drop_sizes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(DROP_SIZE_IDENTITY_0021)})`,
  `ALTER TABLE drop_sizes DROP CONSTRAINT IF EXISTS drop_sizes_piece_key`,
  `ALTER TABLE drop_sizes DROP CONSTRAINT IF EXISTS drop_sizes_label_key`,
  `ALTER TABLE drop_sizes ADD CONSTRAINT drop_sizes_label_key UNIQUE (drop_id, label)`,
  `ALTER TABLE drop_sizes DROP CONSTRAINT IF EXISTS drop_sizes_position_check`,
  `ALTER TABLE drop_sizes ADD CONSTRAINT drop_sizes_position_check CHECK (position BETWEEN 1 AND ${POSITION_MAX_0021})`,
  `ALTER TABLE drop_sizes DROP COLUMN IF EXISTS piece`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_set_no_after_room`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_one_offer`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_set_key`,
  `DROP INDEX IF EXISTS drops_set_id_idx`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS set_id`,
  `ALTER TABLE drops ALTER COLUMN model_id SET NOT NULL`,
  `DROP TABLE IF EXISTS set_models`,
  `DROP TABLE IF EXISTS sets`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
