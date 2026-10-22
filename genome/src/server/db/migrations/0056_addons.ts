/**
 * 0056 — add-ons (macro scope of 2026-10-20, K48 D1 and D2; lot M3 plan §4.2, step M3.8): a catalogue item with real
 * stock (a care kit, a polishing cloth, a chain extender, a spare strap, a travel pouch…), priced per currency, bought
 * with a piece at the purchase or from YOUR ORDERS until packing starts, held in stock unit by unit, packed with its
 * order. An add-on has no ORBES CODE, no identity, no ownership, and never counts toward the tier: it is never a
 * product row. The release add-ons of a LIVE (`live_addons`, the gift box, the engraving, ORBES Care) are unchanged.
 *
 * `addon_items`: one row per add-on.
 *  - `name` (1 to 40 characters, trimmed, as the collector reads it, unique whatever the case, `addon_items_name_key`),
 *    `line` (1 to 120 characters, trimmed; NULL: none);
 *  - `supplier_id` (`suppliers`; NULL: none yet), `weight_g` (1 to 30 000 g, for the parcel's weight; NULL: unknown);
 *  - `position` (0 to 10 000, the order they are offered in), `active` (DEFAULT true: set aside when false, never
 *    deleted), `shopify_product_id` (the add-on's Shopify product, pasted back; once, S5);
 *  - `created_at`, `created_by` (the staff member who listed it; NULL for a script), `updated_at` (stamped by
 *    `orbes_touch_updated_at`); its id, creation and author never change.
 *
 * `addon_item_prices`: its price per house currency (EUR, GBP, USD, CHF), 0 to 100 000 000 minor units, as the
 * engraving's; no row: not offered in that currency. Its add-on and currency never change; updated_at stamped.
 *
 * `skus`: an add-on's SKU is a SKU like a size's (the same ledger, minimums, supplier orders, receptions), owned by its
 * add-on instead of a model: `model_id` becomes NULL-able, `addon_id` (`addon_items`, one SKU per add-on,
 * `skus_addon_id_key`) is added, and exactly one owner is named (`skus_owner`). An add-on's SKU has no size and no fit
 * (`skus_addon_plain`). Every existing SKU keeps its model. `skus_model_size_key` (one SKU per model and size) now
 * reads the models' SKUs only, so two add-ons' SKUs (no model, no size) never collide. `skus_addon_sku_key` (addon_id,
 * id) lets a unit name its add-on's SKU, as `skus_model_sku_key` lets an order name its model's. The identity guard
 * gains `addon_id`. An order or a piece names a SKU with its model (`orders_sku_fkey`, `products_sku_fkey`): an
 * add-on's SKU can never be an order's piece nor a product's.
 *
 * `order_addon_items`: one row per unit of an add-on on an order.
 *  - `order_id`, `addon_id` and its SKU `sku_id` (`order_addon_items_sku_fkey` to `skus (addon_id, id)`: the SKU of that
 *    add-on), `location_id` (where the unit is held; it moves with its order's location);
 *  - `price_minor` (0 to 100 000 000) and `currency` (a house currency): its price when it was added, kept;
 *  - `status` HELD → SHIPPED → RETURNED, or HELD → REMOVED (taken off before packing) or CANCELLED (with its order),
 *    each with its time (`added_at`, `removed_at`, `shipped_at`, `cancelled_at`, `returned_at`) and only its own
 *    (`order_addon_items_status_times`), in order (`order_addon_items_times`);
 *  - `added_by_type` PURCHASE (at the purchase, carried from the collector's choice: no one named), COLLECTOR (from
 *    YOUR ORDERS: their account) or STAFF (an admin; NULL for a script), `added_by` (`order_addon_items_added_by`);
 *  - `returned_to_stock` with RETURNED only (`order_addon_items_returned`): back in stock at the return's location,
 *    or kept out when ORBES marks it not to be sold again;
 *  - `invoice_id` (its supplementary invoice, when added after PAID), `shopify_line_item_id` (its Shopify line item,
 *    once, S5).
 *  Its id, order, add-on, SKU, price, currency, addition and author never change. The units HELD are read by
 *  `order_addon_items_held_idx` (sku_id, location_id), as `orders_stock_reservation_idx` reads the orders' holds.
 *
 * `addon_choices`: the add-ons a collector chose before their order exists, on exactly one owner (`addon_choices_owner`):
 * a LIVE entry, a draw entry or a salon request; `units` 1 to 3; once per owner and add-on; `chosen_at`. Carried onto
 * the order at its creation, then deleted by the service. Every foreign key is ON DELETE RESTRICT, as every other (the
 * contract test): an entry and a request are never deleted (they change status), and the service deletes a choice
 * where it deletes an entry's release add-ons.
 *
 * `stock_movements.order_addon_item_id`: the unit a SHIPPED or RETURNED movement moves, with its order and SKU
 * (`stock_movements_order_addon_item_fkey` to `order_addon_items (id, order_id, sku_id)`), never with a piece
 * (`stock_movements_order_addon_item`).
 *
 * The view `stock_holds` (sku_id, location_id, reservation, reserved_at, kind, id): what is held in stock, the orders'
 * holds (`orders.reservation` STOCK or AWAITING, kind PIECE, the order's id) UNION ALL the add-on units HELD (as STOCK,
 * kind ADD_ON, the unit's id, since its addition), so every reading of "reserved" reads one source.
 *
 * Every foreign key ON DELETE RESTRICT, at the head of an index. On the previous image (0055) during the roll-out:
 * three tables, a view and two columns it never reads, and a SKU it writes always has its model. No row is inserted.
 * `down` refuses, naming the counts, while an add-on, an add-on's SKU, a unit or a choice exists; otherwise it restores
 * the schema of 0055 exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** An add-on's name and line, at most (schema.ts ADDON_NAME_MAX, ADDON_LINE_MAX). */
const NAME_MAX = 40;
const LINE_MAX = 120;
/** An add-on's weight, at most, in g (schema.ts ADDON_WEIGHT_G_MAX). */
const WEIGHT_MAX = 30000;
/** An add-on's position, at most (schema.ts ADDON_POSITION_MAX). */
const POSITION_MAX = 10000;
/** A price, at most, in minor units (schema.ts ADDON_PRICE_MINOR_MAX). */
const PRICE_MAX = 100000000;
/** The units of one add-on chosen or on one order, at most (schema.ts ADDON_UNITS_MAX). */
const UNITS_MAX = 3;
/** The house currencies (schema.ts HOUSE_CURRENCIES). */
const CURRENCIES = `'EUR','GBP','USD','CHF'`;
/** A unit's states (schema.ts ORDER_ADDON_STATUSES) and who added it (ORDER_ADDON_ADDED_BY). */
const STATUSES = `'HELD','SHIPPED','REMOVED','CANCELLED','RETURNED'`;
const ADDED_BY = `'PURCHASE','COLLECTOR','STAFF'`;
/** A Shopify id, as 0022's. */
const SHOPIFY_ID = `'^[1-9][0-9]{0,19}$'`;

const words = (column: string, max: number) => `length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column})`;

/** The identity guard of 0022, restored by down. */
const SKUS_IDENTITY_0022 = `'id', 'model_id', 'size_label', 'created_at'`;

export const UP: readonly string[] = [
  // ── addon_items ──────────────────────────────────────────────────────────
  `CREATE TABLE addon_items (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name               text        NOT NULL CONSTRAINT addon_items_name_check CHECK (${words('name', NAME_MAX)}),
     line               text        NULL CONSTRAINT addon_items_line_check CHECK (${words('line', LINE_MAX)}),
     supplier_id        uuid        NULL CONSTRAINT addon_items_supplier_id_fkey REFERENCES suppliers (id) ON DELETE RESTRICT,
     weight_g           integer     NULL CONSTRAINT addon_items_weight_g_check CHECK (weight_g BETWEEN 1 AND ${WEIGHT_MAX}),
     position           smallint    NOT NULL DEFAULT 0 CONSTRAINT addon_items_position_check CHECK (position BETWEEN 0 AND ${POSITION_MAX}),
     active             boolean     NOT NULL DEFAULT true,
     shopify_product_id text        NULL CONSTRAINT addon_items_shopify_product_id_check CHECK (shopify_product_id ~ ${SHOPIFY_ID}),
     created_at         timestamptz NOT NULL DEFAULT now(),
     created_by         uuid        NULL CONSTRAINT addon_items_created_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at         timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT addon_items_shopify_product_key UNIQUE (shopify_product_id)
   )`,
  `CREATE UNIQUE INDEX addon_items_name_key ON addon_items (lower(name))`,
  `CREATE INDEX addon_items_supplier_idx ON addon_items (supplier_id)`,
  `CREATE INDEX addon_items_created_by_idx ON addon_items (created_by)`,
  `CREATE TRIGGER addon_items_immutable_identity BEFORE UPDATE ON addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at', 'created_by')`,
  `CREATE TRIGGER addon_items_touch_updated_at BEFORE UPDATE ON addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  // ── addon_item_prices ────────────────────────────────────────────────────
  `CREATE TABLE addon_item_prices (
     addon_id    uuid        NOT NULL CONSTRAINT addon_item_prices_addon_id_fkey REFERENCES addon_items (id) ON DELETE RESTRICT,
     currency    text        NOT NULL CONSTRAINT addon_item_prices_currency_check CHECK (currency IN (${CURRENCIES})),
     price_minor integer     NOT NULL CONSTRAINT addon_item_prices_price_minor_check CHECK (price_minor BETWEEN 0 AND ${PRICE_MAX}),
     updated_by  uuid        NULL CONSTRAINT addon_item_prices_updated_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT addon_item_prices_pkey PRIMARY KEY (addon_id, currency)
   )`,
  `CREATE INDEX addon_item_prices_updated_by_idx ON addon_item_prices (updated_by)`,
  `CREATE TRIGGER addon_item_prices_immutable_identity BEFORE UPDATE ON addon_item_prices
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('addon_id', 'currency')`,
  `CREATE TRIGGER addon_item_prices_touch_updated_at BEFORE UPDATE ON addon_item_prices
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  // ── skus: a model's or an add-on's ───────────────────────────────────────
  `ALTER TABLE skus ALTER COLUMN model_id DROP NOT NULL`,
  `ALTER TABLE skus ADD COLUMN addon_id uuid NULL CONSTRAINT skus_addon_id_fkey REFERENCES addon_items (id) ON DELETE RESTRICT`,
  `ALTER TABLE skus ADD CONSTRAINT skus_addon_id_key UNIQUE (addon_id)`,
  `ALTER TABLE skus ADD CONSTRAINT skus_addon_sku_key UNIQUE (addon_id, id)`,
  `ALTER TABLE skus ADD CONSTRAINT skus_owner CHECK (num_nonnulls(model_id, addon_id) = 1)`,
  `ALTER TABLE skus ADD CONSTRAINT skus_addon_plain CHECK (addon_id IS NULL OR (size_label IS NULL AND fit_min_mm IS NULL AND fit_max_mm IS NULL))`,
  // One SKU per model and size: the models' SKUs only (two add-ons' SKUs have no model and no size).
  `DROP INDEX skus_model_size_key`,
  `CREATE UNIQUE INDEX skus_model_size_key ON skus (model_id, upper(size_label)) NULLS NOT DISTINCT WHERE model_id IS NOT NULL`,
  `DROP TRIGGER skus_immutable_identity ON skus`,
  `CREATE TRIGGER skus_immutable_identity BEFORE UPDATE ON skus
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'model_id', 'addon_id', 'size_label', 'created_at')`,

  // ── order_addon_items: one row per unit ──────────────────────────────────
  `CREATE TABLE order_addon_items (
     id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id             uuid        NOT NULL CONSTRAINT order_addon_items_order_id_fkey REFERENCES orders (id) ON DELETE RESTRICT,
     addon_id             uuid        NOT NULL CONSTRAINT order_addon_items_addon_id_fkey REFERENCES addon_items (id) ON DELETE RESTRICT,
     sku_id               uuid        NOT NULL,
     location_id          uuid        NOT NULL CONSTRAINT order_addon_items_location_id_fkey REFERENCES stock_locations (id) ON DELETE RESTRICT,
     price_minor          integer     NOT NULL CONSTRAINT order_addon_items_price_minor_check CHECK (price_minor BETWEEN 0 AND ${PRICE_MAX}),
     currency             text        NOT NULL CONSTRAINT order_addon_items_currency_check CHECK (currency IN (${CURRENCIES})),
     status               text        NOT NULL DEFAULT 'HELD' CONSTRAINT order_addon_items_status_check CHECK (status IN (${STATUSES})),
     added_at             timestamptz NOT NULL DEFAULT now(),
     removed_at           timestamptz NULL,
     shipped_at           timestamptz NULL,
     cancelled_at         timestamptz NULL,
     returned_at          timestamptz NULL,
     added_by_type        text        NOT NULL CONSTRAINT order_addon_items_added_by_type_check CHECK (added_by_type IN (${ADDED_BY})),
     added_by             uuid        NULL,
     returned_to_stock    boolean     NULL,
     invoice_id           uuid        NULL CONSTRAINT order_addon_items_invoice_id_fkey REFERENCES invoices (id) ON DELETE RESTRICT,
     shopify_line_item_id text        NULL CONSTRAINT order_addon_items_shopify_line_item_id_check CHECK (shopify_line_item_id ~ ${SHOPIFY_ID}),
     CONSTRAINT order_addon_items_sku_fkey FOREIGN KEY (addon_id, sku_id) REFERENCES skus (addon_id, id) ON DELETE RESTRICT,
     CONSTRAINT order_addon_items_unit_key UNIQUE (id, order_id, sku_id),
     CONSTRAINT order_addon_items_shopify_line_item_key UNIQUE (shopify_line_item_id),
     -- Each state with its own time, and only its own.
     CONSTRAINT order_addon_items_status_times CHECK (CASE status
       WHEN 'HELD' THEN removed_at IS NULL AND shipped_at IS NULL AND cancelled_at IS NULL AND returned_at IS NULL
       WHEN 'REMOVED' THEN removed_at IS NOT NULL AND shipped_at IS NULL AND cancelled_at IS NULL AND returned_at IS NULL
       WHEN 'CANCELLED' THEN cancelled_at IS NOT NULL AND removed_at IS NULL AND shipped_at IS NULL AND returned_at IS NULL
       WHEN 'SHIPPED' THEN shipped_at IS NOT NULL AND removed_at IS NULL AND cancelled_at IS NULL AND returned_at IS NULL
       WHEN 'RETURNED' THEN shipped_at IS NOT NULL AND returned_at IS NOT NULL AND removed_at IS NULL AND cancelled_at IS NULL
     END),
     CONSTRAINT order_addon_items_times CHECK (
       removed_at >= added_at AND cancelled_at >= added_at AND shipped_at >= added_at AND returned_at >= shipped_at),
     -- At the purchase no one is named; from YOUR ORDERS the collector is; staff are, or a script is not.
     CONSTRAINT order_addon_items_added_by CHECK (CASE added_by_type
       WHEN 'PURCHASE' THEN added_by IS NULL
       WHEN 'COLLECTOR' THEN added_by IS NOT NULL
       ELSE true END),
     CONSTRAINT order_addon_items_returned CHECK ((returned_to_stock IS NOT NULL) = (status = 'RETURNED'))
   )`,
  `CREATE INDEX order_addon_items_order_idx ON order_addon_items (order_id)`,
  `CREATE INDEX order_addon_items_addon_idx ON order_addon_items (addon_id)`,
  `CREATE INDEX order_addon_items_location_idx ON order_addon_items (location_id)`,
  `CREATE INDEX order_addon_items_invoice_idx ON order_addon_items (invoice_id)`,
  // The units held at a location, as orders_stock_reservation_idx reads the orders'.
  `CREATE INDEX order_addon_items_held_idx ON order_addon_items (sku_id, location_id) WHERE status = 'HELD'`,
  `CREATE TRIGGER order_addon_items_immutable_identity BEFORE UPDATE ON order_addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'order_id', 'addon_id', 'sku_id', 'price_minor', 'currency', 'added_at', 'added_by_type', 'added_by')`,

  // ── addon_choices: chosen before the order exists ────────────────────────
  `CREATE TABLE addon_choices (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     live_entry_id   uuid        NULL CONSTRAINT addon_choices_live_entry_id_fkey REFERENCES live_entries (id) ON DELETE RESTRICT,
     drop_entry_id   uuid        NULL CONSTRAINT addon_choices_drop_entry_id_fkey REFERENCES drop_entries (id) ON DELETE RESTRICT,
     shop_request_id uuid        NULL CONSTRAINT addon_choices_shop_request_id_fkey REFERENCES shop_requests (id) ON DELETE RESTRICT,
     addon_id        uuid        NOT NULL CONSTRAINT addon_choices_addon_id_fkey REFERENCES addon_items (id) ON DELETE RESTRICT,
     units           smallint    NOT NULL CONSTRAINT addon_choices_units_check CHECK (units BETWEEN 1 AND ${UNITS_MAX}),
     chosen_at       timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT addon_choices_owner CHECK (num_nonnulls(live_entry_id, drop_entry_id, shop_request_id) = 1),
     CONSTRAINT addon_choices_live_entry_key UNIQUE (live_entry_id, addon_id),
     CONSTRAINT addon_choices_drop_entry_key UNIQUE (drop_entry_id, addon_id),
     CONSTRAINT addon_choices_shop_request_key UNIQUE (shop_request_id, addon_id)
   )`,
  `CREATE INDEX addon_choices_addon_idx ON addon_choices (addon_id)`,
  `CREATE TRIGGER addon_choices_immutable_identity BEFORE UPDATE ON addon_choices
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'live_entry_id', 'drop_entry_id', 'shop_request_id', 'addon_id')`,

  // ── stock_movements: the unit a shipment or a return moves ───────────────
  `ALTER TABLE stock_movements ADD COLUMN order_addon_item_id uuid NULL`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_order_addon_item_fkey
     FOREIGN KEY (order_addon_item_id, order_id, sku_id) REFERENCES order_addon_items (id, order_id, sku_id) ON DELETE RESTRICT`,
  `CREATE INDEX stock_movements_order_addon_item_idx ON stock_movements (order_addon_item_id)`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_order_addon_item CHECK (
     order_addon_item_id IS NULL OR (reason IN ('SHIPPED', 'RETURNED') AND order_id IS NOT NULL AND product_id IS NULL))`,

  // ── stock_holds: every hold, from one source ─────────────────────────────
  `CREATE VIEW stock_holds AS
   SELECT o.sku_id, o.location_id, o.reservation, o.reserved_at, 'PIECE'::text AS kind, o.id
     FROM orders o
    WHERE o.reservation IS NOT NULL
   UNION ALL
   SELECT u.sku_id, u.location_id, 'STOCK'::text AS reservation, u.added_at AS reserved_at, 'ADD_ON'::text AS kind, u.id
     FROM order_addon_items u
    WHERE u.status = 'HELD'`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no add-on: refused while any would be lost.
  `DO $$
   DECLARE addons_n bigint; skus_n bigint; units_n bigint; choices_n bigint;
   BEGIN
     SELECT count(*) INTO addons_n FROM addon_items;
     SELECT count(*) INTO skus_n FROM skus WHERE addon_id IS NOT NULL;
     SELECT count(*) INTO units_n FROM order_addon_items;
     SELECT count(*) INTO choices_n FROM addon_choices;
     IF addons_n > 0 OR skus_n > 0 OR units_n > 0 OR choices_n > 0 THEN
       RAISE EXCEPTION 'migration 0056_addons cannot be rolled back: % add-ons, % add-on SKUs, % add-on units on orders and % add-on choices exist', addons_n, skus_n, units_n, choices_n;
     END IF;
   END $$`,
  `DROP VIEW IF EXISTS stock_holds`,
  `ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_order_addon_item`,
  `DROP INDEX IF EXISTS stock_movements_order_addon_item_idx`,
  `ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_order_addon_item_fkey`,
  `ALTER TABLE stock_movements DROP COLUMN IF EXISTS order_addon_item_id`,
  `DROP TABLE IF EXISTS addon_choices`,
  `DROP TABLE IF EXISTS order_addon_items`,
  `DROP TRIGGER IF EXISTS skus_immutable_identity ON skus`,
  `CREATE TRIGGER skus_immutable_identity BEFORE UPDATE ON skus
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${SKUS_IDENTITY_0022})`,
  `DROP INDEX IF EXISTS skus_model_size_key`,
  `CREATE UNIQUE INDEX skus_model_size_key ON skus (model_id, upper(size_label)) NULLS NOT DISTINCT`,
  `ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_addon_plain`,
  `ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_owner`,
  `ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_addon_sku_key`,
  `ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_addon_id_key`,
  `ALTER TABLE skus DROP COLUMN IF EXISTS addon_id`,
  `ALTER TABLE skus ALTER COLUMN model_id SET NOT NULL`,
  `DROP TABLE IF EXISTS addon_item_prices`,
  `DROP TABLE IF EXISTS addon_items`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
