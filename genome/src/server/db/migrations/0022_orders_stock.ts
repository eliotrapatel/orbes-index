/**
 * 0022 — orders, stock and operations (plan LIVE RELEASE+ of 2026-10-04, steps S1 to S4): the stock both ways (pieces
 * made in advance count, the rest are made to order), the orders of every sales channel step by step, the atelier's
 * pieces to make, the shipments, returns and invoices, and the journal the future connections read.
 *
 * `stock_locations`: where pieces are kept, by `name` (1 to 60 characters, unique whatever the case), FRANCE WAREHOUSE
 * and LOGISTICS WAREHOUSE created at the first boot (services/stock.ts ensureStockSetup), more added by the console;
 * `is_default` marks the one location draws and private-salon orders go to when nothing else names one (at most one);
 * `shopify_location_id` the Shopify location it will be, once the store exists (decimal, unique).
 *
 * `skus`: a model in one size (`size_label`, the label a release's size or a piece's `variant` says, 1 to 100
 * characters; NULL for a model in one size), one row per model and size (`skus_model_size_key`, NULLS NOT DISTINCT),
 * its `code` (the model's SKU prefix and the size, unique) and its future Shopify ids (`shopify_product_id`,
 * `shopify_variant_id`, the latter unique). No stock column: the stock is the ledger's. id, model and size never change.
 * `products.sku_id` (with the piece's model: `products_sku_fkey`, composite) and `drop_sizes.sku_id` link the pieces
 * and the sizes on sale to them; NULL until linked (the previous image writes neither: the boot links them).
 *
 * `products.status` gains RESERVED: an ORBES identity reserved for a piece to make (L6), its serial and genome taken,
 * printed on the atelier's work sheet but not issued: /verify answers it as an unknown code. It is never registered
 * nor claimable (no claim secret: `products_reserved`), never written in `product_status_history` (whose values stay
 * those of 0001): its lifecycle starts when the atelier issues it (null → ISSUED), or when its order is cancelled
 * (null → RETIRED, the serial never reused). RETIRED, already a status, is where a cancelled reservation and an
 * archived return end.
 *
 * `stock_movements`: the ledger, append-only. Each movement is a `delta` (± 1 to 10 000, never 0) of a SKU at a
 * location, with its `reason`: PRODUCED (+1, a piece finished by the atelier, the piece named), ADJUSTED (± a count
 * corrected, by the console), TRANSFER_OUT and TRANSFER_IN (the two halves of a transfer between locations, paired by
 * `transfer_id`, at most one of each), SHIPPED (−1, an order shipped) and RETURNED (+1, an order returned to stock):
 * the signs and the order each requires are the `stock_movements_sign`, `_transfer` and `_order` CHECKs.
 * The order and the piece it concerns when there is one (a piece moves one at a time), its note, who (`actor_type`,
 * `actor_id`, as in `product_status_history`) and when. The balance of a (SKU, location) is the sum of its deltas: on
 * hand; the orders holding one of them (`orders.reservation` STOCK) are reserved; the rest is available.
 *
 * `sku_thresholds`: a minimum (1 to 10 000) per SKU and location, below which the atelier is told what to make (L2).
 *
 * `carriers`: Colissimo, Chronopost, DHL Express and UPS at the first boot, more added by the console; a `name` (unique
 * whatever the case), its `tracking_url` (https, with `{tracking}` where the number goes), `active`.
 *
 * `orders`: one per piece sold, by `channel`: LIVE (an entry of a LIVE RELEASE CONFIRMED: `live_entry_id` and its
 * `piece`, 1 to the entry's quantity), DRAW (an entry of a draw confirmed by Client Services: `drop_entry_id`) or
 * SALON (a request of the private salon closed as ACCEPTED: `shop_request_id`), each source once (`orders_source`, the
 * three unique keys); `drop_id` the release of a LIVE or DRAW order. The `account_id` that bought it, the `model_id`,
 * its `size_label` and `sku_id` (a SKU of that model: `orders_sku_fkey`; NULL while a draw's or a salon's size is not
 * entered), its `price_minor` and `currency` (both or neither), the snapshots of its `addons` (a JSON array, at most 6)
 * and of the release's `surprise`, the `engraving_text`, and the buyer's name and address entered by Client Services
 * (`buyer_name`, `buyer_address`: personal data, never in the audit log nor the journal). Its `status` and the time it
 * reached each step: RESERVED (`reserved_at`, its creation) → PAID (`paid_at`) → SHIPPED (`shipped_at`, with
 * `carrier_id` and `tracking_number`, and the `declared_value_minor` insured, in the order's currency) → DELIVERED
 * (`delivered_at`); CANCELLED (`cancelled_at`) from RESERVED or PAID; RETURNED (`returned_at`) from SHIPPED or
 * DELIVERED: each status with the columns it requires (the `orders_status_*` CHECKs), the times in order
 * (`orders_times`). Its `location_id`, and what it holds there while RESERVED or PAID (`reservation`): STOCK (one piece
 * of its SKU, counted as reserved) or BENCH (a piece to make, `bench_items`); NULL otherwise. The `product_id` of the
 * piece that fulfils it (one open order per piece: `orders_product_key`), and its future `shopify_order_id`. Its
 * identity (id, channel, source, release, account, model, `reserved_at`) never changes.
 *
 * `order_events`: an order's history, append-only: each change as its audit action (`order.create`, `order.pay`…),
 * the status after it, a note, details (never personal data), who and when.
 *
 * `bench_items`: the atelier's pieces to make, each for an order or for the stock (`order_id` NULL), of a SKU, made for
 * a location (where the finished piece goes, which moves with its order) and a release; its `status` TO_MAKE →
 * IN_PROGRESS → DONE, or CANCELLED, each with its time; the `product_id` of its ORBES identity, reserved at creation
 * (unique); the engraving text and the surprise it carries. At most one open per order (`bench_items_one_open`).
 *
 * `returns`: an order returned (one at most), RESTOCKED at a location or ARCHIVED, with a note, by whom and when, and
 * the `ownership_id` ORBES took back when the buyer had registered the piece (ended by the return), NULL otherwise.
 *
 * `invoices`: the invoices and credit notes, numbered in sequence per kind and year (`invoices_number_key`), each of an
 * order (one invoice per order; a credit note credits one invoice, once), the issuer, the buyer, the lines and the
 * amounts as issued (JSON snapshots), the currency, the VAT fields (NULL: no VAT, both or neither; the total is the
 * subtotal plus the VAT), `issued_at`. Never changed nor deleted.
 *
 * `event_journal`: every change of an order, the stock, a piece or an invoice, written once in the transaction of the
 * change: its `type` (dotted lowercase), the entity it concerns (`entity_type`, `entity_id`), the entity as it stands
 * after the change (`payload`, a JSON object), `created_at`, and the connections that consumed it (`consumed_by`, the
 * only column that changes). Read in order of `id`, it replays the state; never deleted.
 *
 * `order_alert_settings`: the delays after which an order stands out (M3), in days: RESERVED (2), PAID with its piece
 * ready (3), SHIPPED (10), DELIVERED without its piece registered (30). One row at most (`id` 1), none inserted: the
 * defaults are the columns'.
 *
 * `shop_requests.outcome`: ACCEPTED or DECLINED, set when a request is CLOSED (NULL for one closed before 0022).
 * `models.base_price_minor` and `base_currency` (both or neither): a model's base price for the Shopify export;
 * `models.care_guide`: its care guide (1 to 8 000 characters). `drops.stock_location_id`: a release's default location.
 * `accounts.shopify_customer_id`: the Shopify customer an account will be, matched by email once the store exists (N3;
 * decimal, unique).
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. Compatible with the previous image: new
 * nullable columns it never names (it inserts products, sizes, models, drops, requests and accounts without them and reads them
 * column by column) and new tables it never reads; a RESERVED identity carries a code only once its work sheet is
 * printed (services/atelier.ts), which only this image does. No row is inserted. `down` revokes the codes of the
 * identities still RESERVED and retires them (the previous image has no such status; their serials stay taken, their
 * sheets never verify), drops the twelve tables, then the columns and
 * constraints this migration added: the schema of 0021 exactly. One statement per array entry (PGlite's extended
 * protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const PRODUCT_STATUS_0001 = `'ISSUED','ACTIVATED','REGISTERED','OWNED','TRANSFERRED','SERVICED','RESOLD','RETIRED','REVOKED','COUNTERFEIT_FLAGGED','LOST','STOLEN'`;
const PRODUCT_STATUS = `'RESERVED',${PRODUCT_STATUS_0001}`;
const ACTOR_TYPE = `'admin','account','system'`;
const ORDER_CHANNELS = `'LIVE','DRAW','SALON'`;
const ORDER_STATUSES = `'RESERVED','PAID','SHIPPED','DELIVERED','CANCELLED','RETURNED'`;
const ORDER_RESERVATIONS = `'STOCK','BENCH'`;
const MOVEMENT_REASONS = `'PRODUCED','ADJUSTED','TRANSFER_OUT','TRANSFER_IN','SHIPPED','RETURNED'`;
const BENCH_STATUSES = `'TO_MAKE','IN_PROGRESS','DONE','CANCELLED'`;
const RETURN_OUTCOMES = `'RESTOCKED','ARCHIVED'`;
const INVOICE_KINDS = `'INVOICE','CREDIT_NOTE'`;
const SHOP_OUTCOMES = `'ACCEPTED','DECLINED'`;

/** A Shopify id as its admin shows it: a positive decimal. */
const SHOPIFY_ID = `'^[1-9][0-9]{0,19}$'`;
/** Text of 1 to n characters once trimmed. */
const words = (column: string, max: number) => `length(btrim(${column})) BETWEEN 1 AND ${max}`;

export const UP: readonly string[] = [
  // ── stock_locations ──────────────────────────────────────────────────────
  `CREATE TABLE stock_locations (
     id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name                text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = btrim(name)),
     is_default          boolean     NOT NULL DEFAULT false,
     shopify_location_id text        NULL CHECK (shopify_location_id ~ ${SHOPIFY_ID}),
     created_at          timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT stock_locations_shopify_key UNIQUE (shopify_location_id)
   )`,
  `CREATE UNIQUE INDEX stock_locations_name_key ON stock_locations (lower(name))`,
  // At most one default location.
  `CREATE UNIQUE INDEX stock_locations_one_default ON stock_locations (is_default) WHERE is_default`,
  `CREATE TRIGGER stock_locations_immutable_identity BEFORE UPDATE ON stock_locations
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at')`,

  // ── skus ─────────────────────────────────────────────────────────────────
  `CREATE TABLE skus (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     model_id           uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     size_label         text        NULL CHECK (length(size_label) BETWEEN 1 AND 100 AND size_label = btrim(size_label)),
     code               text        NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._/ -]{0,63}$'),
     shopify_product_id text        NULL CHECK (shopify_product_id ~ ${SHOPIFY_ID}),
     shopify_variant_id text        NULL CHECK (shopify_variant_id ~ ${SHOPIFY_ID}),
     created_at         timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT skus_model_size_key UNIQUE NULLS NOT DISTINCT (model_id, size_label),
     CONSTRAINT skus_model_sku_key UNIQUE (model_id, id),
     CONSTRAINT skus_code_key UNIQUE (code),
     CONSTRAINT skus_shopify_variant_key UNIQUE (shopify_variant_id)
   )`,
  `CREATE TRIGGER skus_immutable_identity BEFORE UPDATE ON skus
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'model_id', 'size_label', 'created_at')`,

  // ── products: the SKU of a piece, the RESERVED identity ─────────────────
  `ALTER TABLE products ADD COLUMN sku_id uuid NULL`,
  `ALTER TABLE products ADD CONSTRAINT products_sku_fkey FOREIGN KEY (model_id, sku_id) REFERENCES skus (model_id, id) ON DELETE RESTRICT`,
  `CREATE INDEX products_sku_id_idx ON products (sku_id)`,
  `ALTER TABLE products DROP CONSTRAINT products_status_check`,
  `ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN (${PRODUCT_STATUS}))`,
  `ALTER TABLE products ADD CONSTRAINT products_reserved CHECK (status <> 'RESERVED' OR claim_secret_hash IS NULL)`,

  // ── drop_sizes: the SKU of a size on sale ────────────────────────────────
  `ALTER TABLE drop_sizes ADD COLUMN sku_id uuid NULL CONSTRAINT drop_sizes_sku_id_fkey REFERENCES skus (id) ON DELETE RESTRICT`,
  `CREATE INDEX drop_sizes_sku_id_idx ON drop_sizes (sku_id)`,

  // ── carriers ─────────────────────────────────────────────────────────────
  `CREATE TABLE carriers (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = btrim(name)),
     tracking_url text        NOT NULL CHECK (length(tracking_url) <= 500 AND tracking_url ~ '^https://[^[:space:]]+$' AND strpos(tracking_url, '{tracking}') > 0),
     active       boolean     NOT NULL DEFAULT true,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX carriers_name_key ON carriers (lower(name))`,
  `CREATE TRIGGER carriers_immutable_identity BEFORE UPDATE ON carriers
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at')`,

  // ── drops: a release's default location ──────────────────────────────────
  `ALTER TABLE drops ADD COLUMN stock_location_id uuid NULL CONSTRAINT drops_stock_location_id_fkey REFERENCES stock_locations (id) ON DELETE RESTRICT`,
  `CREATE INDEX drops_stock_location_id_idx ON drops (stock_location_id)`,

  // ── shop_requests: the outcome of a closed request ───────────────────────
  `ALTER TABLE shop_requests ADD COLUMN outcome text NULL CONSTRAINT shop_requests_outcome_check CHECK (outcome IN (${SHOP_OUTCOMES}))`,
  // Closed, as shop_requests_closed reads it: handled.
  `ALTER TABLE shop_requests ADD CONSTRAINT shop_requests_outcome_closed CHECK (outcome IS NULL OR handled_at IS NOT NULL)`,

  // ── models: the base price and the care guide ────────────────────────────
  `ALTER TABLE models ADD COLUMN base_price_minor integer NULL CONSTRAINT models_base_price_minor_check CHECK (base_price_minor BETWEEN 0 AND 100000000)`,
  `ALTER TABLE models ADD COLUMN base_currency text NULL CONSTRAINT models_base_currency_check CHECK (base_currency ~ '^[A-Z]{3}$')`,
  `ALTER TABLE models ADD CONSTRAINT models_base_price CHECK ((base_price_minor IS NULL) = (base_currency IS NULL))`,
  `ALTER TABLE models ADD COLUMN care_guide text NULL CONSTRAINT models_care_guide_check CHECK (${words('care_guide', 8000)})`,

  // ── accounts: the Shopify customer each will be ──────────────────────────
  `ALTER TABLE accounts ADD COLUMN shopify_customer_id text NULL CONSTRAINT accounts_shopify_customer_id_check CHECK (shopify_customer_id ~ ${SHOPIFY_ID})`,
  `ALTER TABLE accounts ADD CONSTRAINT accounts_shopify_customer_key UNIQUE (shopify_customer_id)`,

  // ── orders ───────────────────────────────────────────────────────────────
  `CREATE TABLE orders (
     id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     channel              text        NOT NULL CHECK (channel IN (${ORDER_CHANNELS})),
     live_entry_id        uuid        NULL REFERENCES live_entries (id) ON DELETE RESTRICT,
     piece                smallint    NOT NULL DEFAULT 1 CHECK (piece BETWEEN 1 AND 5),
     drop_entry_id        uuid        NULL REFERENCES drop_entries (id) ON DELETE RESTRICT,
     shop_request_id      uuid        NULL REFERENCES shop_requests (id) ON DELETE RESTRICT,
     drop_id              uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     account_id           uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     model_id             uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     size_label           text        NULL CHECK (length(size_label) BETWEEN 1 AND 100 AND size_label = btrim(size_label)),
     sku_id               uuid        NULL,
     price_minor          integer     NULL CHECK (price_minor BETWEEN 0 AND 100000000),
     currency             text        NULL CHECK (currency ~ '^[A-Z]{3}$'),
     addons               jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(addons) = 'array' AND jsonb_array_length(addons) <= 6),
     surprise             text        NULL CHECK (${words('surprise', 500)}),
     engraving_text       text        NULL CHECK (${words('engraving_text', 120)}),
     buyer_name           text        NULL CHECK (${words('buyer_name', 200)}),
     buyer_address        text        NULL CHECK (${words('buyer_address', 1000)}),
     status               text        NOT NULL DEFAULT 'RESERVED' CHECK (status IN (${ORDER_STATUSES})),
     reserved_at          timestamptz NOT NULL DEFAULT now(),
     paid_at              timestamptz NULL,
     shipped_at           timestamptz NULL,
     delivered_at         timestamptz NULL,
     cancelled_at         timestamptz NULL,
     returned_at          timestamptz NULL,
     location_id          uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     reservation          text        NULL CHECK (reservation IN (${ORDER_RESERVATIONS})),
     carrier_id           uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     tracking_number      text        NULL CHECK (tracking_number ~ '^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$'),
     declared_value_minor integer     NULL CHECK (declared_value_minor BETWEEN 0 AND 100000000),
     product_id           uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     shopify_order_id     text        NULL CHECK (shopify_order_id ~ ${SHOPIFY_ID}),
     CONSTRAINT orders_sku_fkey FOREIGN KEY (model_id, sku_id) REFERENCES skus (model_id, id) ON DELETE RESTRICT,
     CONSTRAINT orders_live_entry_key UNIQUE (live_entry_id, piece),
     CONSTRAINT orders_drop_entry_key UNIQUE (drop_entry_id),
     CONSTRAINT orders_shop_request_key UNIQUE (shop_request_id),
     CONSTRAINT orders_shopify_order_key UNIQUE (shopify_order_id),
     CONSTRAINT orders_source CHECK (
       (channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel = 'SALON') = (drop_id IS NULL)
       AND (channel = 'LIVE' OR piece = 1)),
     CONSTRAINT orders_price CHECK ((price_minor IS NULL) = (currency IS NULL)),
     -- Held while RESERVED or PAID only: neither shipped nor cancelled (orders_status_*).
     CONSTRAINT orders_reservation CHECK (reservation IS NULL OR (sku_id IS NOT NULL AND shipped_at IS NULL AND cancelled_at IS NULL)),
     CONSTRAINT orders_shipment CHECK (
       (shipped_at IS NULL) = (carrier_id IS NULL) AND (carrier_id IS NULL) = (tracking_number IS NULL)
       AND (declared_value_minor IS NULL OR (shipped_at IS NOT NULL AND currency IS NOT NULL))),
     CONSTRAINT orders_times CHECK (
       paid_at >= reserved_at AND shipped_at >= paid_at AND delivered_at >= shipped_at
       AND returned_at >= coalesce(delivered_at, shipped_at) AND cancelled_at >= coalesce(paid_at, reserved_at)),
     CONSTRAINT orders_steps CHECK (
       (shipped_at IS NULL OR paid_at IS NOT NULL) AND (delivered_at IS NULL OR shipped_at IS NOT NULL)
       AND (returned_at IS NULL OR shipped_at IS NOT NULL) AND (cancelled_at IS NULL OR shipped_at IS NULL)),
     CONSTRAINT orders_status_reserved CHECK (status <> 'RESERVED' OR (paid_at IS NULL AND shipped_at IS NULL AND cancelled_at IS NULL)),
     CONSTRAINT orders_status_paid CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND shipped_at IS NULL AND cancelled_at IS NULL)),
     CONSTRAINT orders_status_shipped CHECK (status <> 'SHIPPED' OR (shipped_at IS NOT NULL AND delivered_at IS NULL AND returned_at IS NULL)),
     CONSTRAINT orders_status_delivered CHECK ((status = 'DELIVERED') = (delivered_at IS NOT NULL AND returned_at IS NULL)),
     CONSTRAINT orders_status_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
     CONSTRAINT orders_status_returned CHECK ((status = 'RETURNED') = (returned_at IS NOT NULL))
   )`,
  `CREATE INDEX orders_drop_idx ON orders (drop_id, status)`,
  `CREATE INDEX orders_account_idx ON orders (account_id, reserved_at)`,
  `CREATE INDEX orders_model_sku_idx ON orders (model_id, sku_id)`,
  `CREATE INDEX orders_location_idx ON orders (location_id)`,
  `CREATE INDEX orders_carrier_idx ON orders (carrier_id)`,
  `CREATE INDEX orders_product_idx ON orders (product_id)`,
  // The board: by status, the oldest first.
  `CREATE INDEX orders_board_idx ON orders (status, reserved_at)`,
  // The pieces reserved per SKU and location.
  `CREATE INDEX orders_stock_reservation_idx ON orders (sku_id, location_id) WHERE reservation = 'STOCK'`,
  // One open order per piece.
  `CREATE UNIQUE INDEX orders_product_key ON orders (product_id) WHERE status IN ('RESERVED', 'PAID', 'SHIPPED', 'DELIVERED')`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'channel', 'live_entry_id', 'piece', 'drop_entry_id', 'shop_request_id', 'drop_id', 'account_id', 'model_id', 'reserved_at')`,

  // ── order_events ─────────────────────────────────────────────────────────
  `CREATE TABLE order_events (
     id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     order_id   uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     action     text        NOT NULL CHECK (action ~ '^order\\.[a-z_]+(\\.[a-z_]+)*$'),
     status     text        NOT NULL CHECK (status IN (${ORDER_STATUSES})),
     note       text        NULL CHECK (${words('note', 500)}),
     details    jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
     actor_type text        NOT NULL CHECK (actor_type IN (${ACTOR_TYPE})),
     actor_id   text        NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX order_events_order_idx ON order_events (order_id, id)`,
  `CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON order_events
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('order_events is append-only')`,

  // ── bench_items ──────────────────────────────────────────────────────────
  `CREATE TABLE bench_items (
     id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id       uuid        NULL REFERENCES orders (id) ON DELETE RESTRICT,
     sku_id         uuid        NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     location_id    uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     drop_id        uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     product_id     uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     status         text        NOT NULL DEFAULT 'TO_MAKE' CHECK (status IN (${BENCH_STATUSES})),
     engraving_text text        NULL CHECK (${words('engraving_text', 120)}),
     surprise       text        NULL CHECK (${words('surprise', 500)}),
     created_at     timestamptz NOT NULL DEFAULT now(),
     started_at     timestamptz NULL,
     done_at        timestamptz NULL,
     cancelled_at   timestamptz NULL,
     CONSTRAINT bench_items_product_key UNIQUE (product_id),
     CONSTRAINT bench_items_times CHECK (started_at >= created_at AND done_at >= coalesce(started_at, created_at) AND cancelled_at >= coalesce(started_at, created_at)),
     CONSTRAINT bench_items_status_to_make CHECK (status <> 'TO_MAKE' OR (started_at IS NULL AND done_at IS NULL AND cancelled_at IS NULL)),
     CONSTRAINT bench_items_status_in_progress CHECK (status <> 'IN_PROGRESS' OR (started_at IS NOT NULL AND done_at IS NULL AND cancelled_at IS NULL)),
     CONSTRAINT bench_items_status_done CHECK ((status = 'DONE') = (done_at IS NOT NULL) AND (status <> 'DONE' OR cancelled_at IS NULL)),
     CONSTRAINT bench_items_status_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
   )`,
  `CREATE INDEX bench_items_order_idx ON bench_items (order_id)`,
  // What to make, per SKU, location and release.
  `CREATE INDEX bench_items_sku_idx ON bench_items (sku_id, status)`,
  `CREATE INDEX bench_items_location_idx ON bench_items (location_id)`,
  `CREATE INDEX bench_items_drop_idx ON bench_items (drop_id, status)`,
  // One open piece to make per order.
  `CREATE UNIQUE INDEX bench_items_one_open ON bench_items (order_id) WHERE status IN ('TO_MAKE', 'IN_PROGRESS')`,
  `CREATE TRIGGER bench_items_immutable_identity BEFORE UPDATE ON bench_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'order_id', 'sku_id', 'drop_id', 'product_id', 'created_at')`,

  // ── stock_movements (the ledger) ─────────────────────────────────────────
  `CREATE TABLE stock_movements (
     id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     sku_id      uuid        NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     location_id uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     delta       integer     NOT NULL CHECK (delta <> 0 AND delta BETWEEN -10000 AND 10000),
     reason      text        NOT NULL CHECK (reason IN (${MOVEMENT_REASONS})),
     order_id    uuid        NULL REFERENCES orders (id) ON DELETE RESTRICT,
     product_id  uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     transfer_id uuid        NULL,
     note        text        NULL CHECK (${words('note', 500)}),
     actor_type  text        NOT NULL CHECK (actor_type IN (${ACTOR_TYPE})),
     actor_id    text        NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT stock_movements_sign CHECK (
       (reason IN ('PRODUCED', 'TRANSFER_IN', 'RETURNED') AND delta > 0) OR (reason IN ('TRANSFER_OUT', 'SHIPPED') AND delta < 0) OR reason = 'ADJUSTED'),
     CONSTRAINT stock_movements_transfer CHECK ((reason IN ('TRANSFER_OUT', 'TRANSFER_IN')) = (transfer_id IS NOT NULL)),
     CONSTRAINT stock_movements_piece CHECK (product_id IS NULL OR delta IN (-1, 1)),
     -- A shipment and a return move one piece of their order; a piece finished is one piece, for an order or the stock.
     CONSTRAINT stock_movements_order CHECK (CASE reason
       WHEN 'SHIPPED' THEN order_id IS NOT NULL AND delta = -1
       WHEN 'RETURNED' THEN order_id IS NOT NULL AND delta = 1
       WHEN 'PRODUCED' THEN product_id IS NOT NULL AND delta = 1
       ELSE order_id IS NULL END)
   )`,
  // The balances: the deltas of a SKU at a location.
  `CREATE INDEX stock_movements_balance_idx ON stock_movements (sku_id, location_id)`,
  `CREATE INDEX stock_movements_location_idx ON stock_movements (location_id)`,
  `CREATE INDEX stock_movements_order_idx ON stock_movements (order_id)`,
  `CREATE INDEX stock_movements_product_idx ON stock_movements (product_id)`,
  // The two halves of a transfer, once each.
  `CREATE UNIQUE INDEX stock_movements_transfer_key ON stock_movements (transfer_id, reason) WHERE transfer_id IS NOT NULL`,
  `CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('the stock ledger is append-only')`,

  // ── sku_thresholds ───────────────────────────────────────────────────────
  `CREATE TABLE sku_thresholds (
     sku_id      uuid        NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     location_id uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     minimum     integer     NOT NULL CHECK (minimum BETWEEN 1 AND 10000),
     updated_by  uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (sku_id, location_id)
   )`,
  `CREATE INDEX sku_thresholds_location_idx ON sku_thresholds (location_id)`,
  `CREATE INDEX sku_thresholds_updated_by_idx ON sku_thresholds (updated_by)`,

  // ── returns ──────────────────────────────────────────────────────────────
  `CREATE TABLE returns (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id     uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     outcome      text        NOT NULL CHECK (outcome IN (${RETURN_OUTCOMES})),
     location_id  uuid        NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     note         text        NOT NULL CHECK (${words('note', 500)}),
     ownership_id uuid        NULL REFERENCES ownership (id) ON DELETE RESTRICT,
     created_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at   timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT returns_order_key UNIQUE (order_id),
     CONSTRAINT returns_ownership_key UNIQUE (ownership_id),
     CONSTRAINT returns_location CHECK ((outcome = 'RESTOCKED') = (location_id IS NOT NULL))
   )`,
  `CREATE INDEX returns_location_idx ON returns (location_id)`,
  `CREATE INDEX returns_created_by_idx ON returns (created_by)`,
  `CREATE TRIGGER returns_immutable BEFORE UPDATE OR DELETE ON returns
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a return never changes')`,

  // ── invoices ─────────────────────────────────────────────────────────────
  `CREATE TABLE invoices (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     kind               text        NOT NULL CHECK (kind IN (${INVOICE_KINDS})),
     year               smallint    NOT NULL CHECK (year BETWEEN 2000 AND 2099),
     sequence           integer     NOT NULL CHECK (sequence BETWEEN 1 AND 999999),
     order_id           uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     credits_invoice_id uuid        NULL REFERENCES invoices (id) ON DELETE RESTRICT,
     issuer             jsonb       NOT NULL CHECK (jsonb_typeof(issuer) = 'object'),
     buyer              jsonb       NOT NULL CHECK (jsonb_typeof(buyer) = 'object'),
     lines              jsonb       NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 1),
     currency           text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
     subtotal_minor     integer     NOT NULL CHECK (subtotal_minor >= 0),
     vat_rate_bp        integer     NULL CHECK (vat_rate_bp BETWEEN 0 AND 10000),
     vat_minor          integer     NULL CHECK (vat_minor >= 0),
     total_minor        integer     NOT NULL CHECK (total_minor >= 0),
     issued_at          timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT invoices_number_key UNIQUE (kind, year, sequence),
     CONSTRAINT invoices_credits_key UNIQUE (credits_invoice_id),
     CONSTRAINT invoices_credit CHECK ((kind = 'CREDIT_NOTE') = (credits_invoice_id IS NOT NULL)),
     CONSTRAINT invoices_vat CHECK ((vat_rate_bp IS NULL) = (vat_minor IS NULL)),
     CONSTRAINT invoices_total CHECK (total_minor = subtotal_minor + coalesce(vat_minor, 0))
   )`,
  `CREATE INDEX invoices_order_idx ON invoices (order_id)`,
  // The monthly CSV: by the time of issue.
  `CREATE INDEX invoices_issued_idx ON invoices (issued_at)`,
  // One invoice per order.
  `CREATE UNIQUE INDEX invoices_one_per_order ON invoices (order_id) WHERE kind = 'INVOICE'`,
  `CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('an invoice is never changed; a credit note follows it')`,

  // ── event_journal ────────────────────────────────────────────────────────
  `CREATE TABLE event_journal (
     id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     type        text        NOT NULL CHECK (type ~ '^[a-z_]+(\\.[a-z_]+)+$'),
     entity_type text        NOT NULL CHECK (entity_type ~ '^[a-z_]{1,40}$'),
     entity_id   text        NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 100),
     payload     jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
     created_at  timestamptz NOT NULL DEFAULT now(),
     consumed_by text[]      NOT NULL DEFAULT '{}'
   )`,
  // An entity's events, in order.
  `CREATE INDEX event_journal_entity_idx ON event_journal (entity_type, entity_id, id)`,
  `CREATE TRIGGER event_journal_immutable BEFORE UPDATE ON event_journal
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'type', 'entity_type', 'entity_id', 'payload', 'created_at')`,
  `CREATE TRIGGER event_journal_no_delete BEFORE DELETE ON event_journal
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('the event journal is replayed from its start')`,

  // ── order_alert_settings ─────────────────────────────────────────────────
  `CREATE TABLE order_alert_settings (
     id                smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     reserved_days     smallint    NOT NULL DEFAULT 2 CHECK (reserved_days BETWEEN 1 AND 90),
     ready_days        smallint    NOT NULL DEFAULT 3 CHECK (ready_days BETWEEN 1 AND 90),
     shipped_days      smallint    NOT NULL DEFAULT 10 CHECK (shipped_days BETWEEN 1 AND 90),
     unregistered_days smallint    NOT NULL DEFAULT 30 CHECK (unregistered_days BETWEEN 1 AND 365),
     updated_by        uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at        timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX order_alert_settings_updated_by_idx ON order_alert_settings (updated_by)`,
];

export const DOWN: readonly string[] = [
  // A work sheet's code of an identity never issued: revoked, as retiring it in this image revokes it.
  `UPDATE codes SET status = 'REVOKED', revoked_at = now(), revocation_reason = 'Reserved identity retired: migration 0022 rolled back'
     WHERE status = 'ACTIVE' AND product_id IN (SELECT id FROM products WHERE status = 'RESERVED')`,
  // The previous image has no RESERVED: an identity reserved and never issued is retired, its serial kept taken.
  `INSERT INTO product_status_history (product_id, from_status, to_status, reason, actor_type)
     SELECT id, NULL, 'RETIRED', 'Reserved identity retired: migration 0022 rolled back', 'system' FROM products WHERE status = 'RESERVED'`,
  `UPDATE products SET status = 'RETIRED' WHERE status = 'RESERVED'`,
  `DROP TABLE IF EXISTS order_alert_settings`,
  `DROP TABLE IF EXISTS event_journal`,
  `DROP TABLE IF EXISTS invoices`,
  `DROP TABLE IF EXISTS returns`,
  `DROP TABLE IF EXISTS sku_thresholds`,
  `DROP TABLE IF EXISTS stock_movements`,
  `DROP TABLE IF EXISTS bench_items`,
  `DROP TABLE IF EXISTS order_events`,
  `DROP TABLE IF EXISTS orders`,
  `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_shopify_customer_key`,
  `ALTER TABLE accounts DROP COLUMN IF EXISTS shopify_customer_id`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_base_price`,
  `ALTER TABLE models DROP COLUMN IF EXISTS care_guide`,
  `ALTER TABLE models DROP COLUMN IF EXISTS base_currency`,
  `ALTER TABLE models DROP COLUMN IF EXISTS base_price_minor`,
  `ALTER TABLE shop_requests DROP CONSTRAINT IF EXISTS shop_requests_outcome_closed`,
  `ALTER TABLE shop_requests DROP COLUMN IF EXISTS outcome`,
  `DROP INDEX IF EXISTS drops_stock_location_id_idx`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS stock_location_id`,
  `DROP TABLE IF EXISTS carriers`,
  `DROP INDEX IF EXISTS drop_sizes_sku_id_idx`,
  `ALTER TABLE drop_sizes DROP COLUMN IF EXISTS sku_id`,
  `ALTER TABLE products DROP CONSTRAINT IF EXISTS products_reserved`,
  `ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check`,
  `ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN (${PRODUCT_STATUS_0001}))`,
  `DROP INDEX IF EXISTS products_sku_id_idx`,
  `ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_fkey`,
  `ALTER TABLE products DROP COLUMN IF EXISTS sku_id`,
  `DROP TABLE IF EXISTS skus`,
  `DROP TABLE IF EXISTS stock_locations`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
