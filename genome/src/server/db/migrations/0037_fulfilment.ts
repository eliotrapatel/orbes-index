/**
 * 0037 — Fulfilment: orders waiting for supplier stock, the size exchange, the parcels and the order cases (plan NEXT LOT
 * of 2026-10-07, §3.5.5.3, step 5.5: the Atelier « is wrong for ORBES and must be replaced »; « The console proposes,
 * ORBES confirms »; « an order ships complete »).
 *
 * `orders.reservation`: what an order RESERVED or PAID holds at its location is a piece in stock (STOCK) or nothing yet,
 * waiting for supplier stock (AWAITING, never shown to the collector); no more piece to make (BENCH, whose rows become
 * AWAITING). `orders.queue_first`: a reshipment after a parcel lost or damaged, served ahead of the oldest-first queue.
 * `orders_awaiting_idx`: the queue of a SKU at a location, in serving order (`queue_first` first, then the oldest, then
 * the id).
 *
 * `orders.channel` EXCHANGE: the order a size exchange creates (services/order-cases.ts), naming the order it exchanges
 * (`exchange_of_order_id`, once: unique) and no other source; it keeps its original's release, so its `drop_id` may be
 * either way (`orders_source` rebuilt). `exchange_of_order_id` appears only on an EXCHANGE order and joins the order's
 * identity (the guard).
 *
 * `orders.packing_started_at`: set on every order of a parcel by Start packing (services/logistics.ts) and never
 * cleared, only on an order paid: the one moment after which the collector no longer changes the delivery address nor
 * the engraving.
 *
 * `shipments`: one parcel, keyed by its first order (`order_id`, the parent; a parcel is that order and the orders
 * travelling with it), at a location. `status` PACKING (Start packing) → PACKED (the check) → SHIPPED → DELIVERED; or the
 * kind of the parcel problem its order case reports (BACK_TO_SENDER, LOST, DAMAGED, after it shipped); or CANCELLED (an
 * order of the parcel cancelled while packing). Each status with its times (`shipments_*` CHECKs). The checklist ticked
 * (a JSON array), the packing photo (`photo`, at most 1 MiB, JPEG or WebP, its SHA-256; erased 14 days after delivery,
 * `photo_erased_at`), the carrier and tracking number once shipped. One open shipment (PACKING, PACKED, SHIPPED) per
 * order (`shipments_one_open`).
 *
 * `shipment_items`: one per order of the parcel, and the piece the packing scan bound to it (`product_id`, `scanned_at`;
 * `scan_event_id` without a foreign key: the scans' retention clears them).
 *
 * `order_cases`: the one table for every order case (§1.1 (b)): a RETURN or a size EXCHANGE (with its reason, and the
 * size asked for an exchange), a parcel BACK_TO_SENDER, LOST or DAMAGED (naming its shipment). Opened by the collector
 * (`opened_by_type` account) or by staff (admin), with a note (the client's or the staff member's words: personal data,
 * never in the audit log, the events nor the journal) and the collector's message in MESSAGES (`message_id`). OPEN →
 * RECEIVED (the agent records the parcel back and the piece's state; never a LOST parcel) → CLOSED (ORBES's decision:
 * `outcome` REFUND, EXCHANGE or RESHIP as its kind allows, where the piece went, the exchange order), or CANCELLED (ended
 * with no decision). One case not ended per order (`order_cases_one_open`). Never deleted.
 *
 * `order_alert_settings.ready_days`: LATE after 5 days (the owner's), its stored 3 (the old default) becoming 5.
 * `bench_items`: the open pieces to make (TO_MAKE, IN_PROGRESS) are CANCELLED now (« forget those, the platform is not
 * launched yet so no impact »); their RESERVED identities are left as they are, reserved and unused.
 *
 * Every foreign key leads an index (whole indexes; the partial unique ones beside them); ON DELETE RESTRICT like every
 * other. Not compatible with the previous image for AWAITING (it reads BENCH as a piece to make), which is why H2 ships
 * as one deployment. `down` refuses while an AWAITING or EXCHANGE order, a shipment or an order case exists, naming the
 * counts; otherwise it restores 0022's reservation CHECK, 0029's channel CHECK and `orders_source`, 0027's identity guard
 * and the delay's default 3, and drops the rest: the schema of 0036 exactly (the cancelled pieces to make stay cancelled;
 * nothing is rolled back in production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const RESERVATIONS_0022 = `'STOCK','BENCH'`;
const RESERVATIONS = `'STOCK','AWAITING'`;
const CHANNELS_0027 = `'LIVE','DRAW','SALON','GIFT'`;
const CHANNELS = `'LIVE','DRAW','SALON','GIFT','EXCHANGE'`;
const SHIPMENT_STATUSES = `'PACKING','PACKED','SHIPPED','DELIVERED','BACK_TO_SENDER','LOST','DAMAGED','CANCELLED'`;
const CASE_KINDS = `'RETURN','EXCHANGE','BACK_TO_SENDER','LOST','DAMAGED'`;
const CASE_OPENERS = `'account','admin'`;
const CASE_REASONS = `'SIZE','NOT_AS_EXPECTED','DAMAGED','OTHER'`;
const CASE_STATUSES = `'OPEN','RECEIVED','CLOSED','CANCELLED'`;
const PIECE_STATES = `'OK','DAMAGED'`;
const CASE_OUTCOMES = `'REFUND','EXCHANGE','RESHIP'`;
const PIECE_DESTINATIONS = `'RESTOCKED','ARCHIVED','REVOKED'`;
const PHOTO_TYPES = `'image/jpeg','image/webp'`;

/** The packing photo's bytes, at most (services/logistics.ts PACKING_PHOTO_MAX_BYTES). */
const PHOTO_MAX = 1048576;
/** Text of 1 to n characters once trimmed (as 0022's). */
const words = (column: string, max: number) => `length(btrim(${column})) BETWEEN 1 AND ${max}`;
/** A tracking number, as an order's (0022). */
const TRACKING = `'^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$'`;
const admin = (column: string) => `${column} uuid NULL REFERENCES admin_users (id) ON DELETE RESTRICT`;
const quoted = (cols: readonly string[]) => cols.map((c) => `'${c}'`).join(', ');

/** An order's identity as 0027 guards it (0022's, with the order it travels with and its grant). */
const ORDER_IDENTITY_0027 = ['id', 'channel', 'live_entry_id', 'piece', 'drop_entry_id', 'shop_request_id', 'drop_id', 'account_id', 'model_id', 'reserved_at', 'with_order_id', 'gift_grant_id'];

/** orders_source as 0029 wrote it. */
const SOURCE_0029 = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel IN ('SALON', 'GIFT')) = (drop_id IS NULL)
       AND (channel IN ('LIVE', 'DRAW') OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)`;
/** orders_source with EXCHANGE: the order it exchanges and no other source; its original's release, whichever it is. */
const SOURCE = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel = 'EXCHANGE' OR (channel IN ('SALON', 'GIFT')) = (drop_id IS NULL))
       AND (channel IN ('LIVE', 'DRAW') OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)
       AND (channel = 'EXCHANGE') = (exchange_of_order_id IS NOT NULL)`;

export const UP: readonly string[] = [
  // ── orders: AWAITING, the queue, the size exchange, the packing lock ─────
  `ALTER TABLE orders DROP CONSTRAINT orders_reservation_check`,
  `UPDATE orders SET reservation = 'AWAITING' WHERE reservation = 'BENCH'`,
  `ALTER TABLE orders ADD CONSTRAINT orders_reservation_check CHECK (reservation IN (${RESERVATIONS}))`,
  `ALTER TABLE orders ADD COLUMN queue_first boolean NOT NULL DEFAULT false`,
  `CREATE INDEX orders_awaiting_idx ON orders (sku_id, location_id, queue_first DESC, reserved_at, id) WHERE reservation = 'AWAITING'`,
  `ALTER TABLE orders ADD COLUMN exchange_of_order_id uuid NULL CONSTRAINT orders_exchange_of_order_id_fkey REFERENCES orders (id) ON DELETE RESTRICT`,
  `ALTER TABLE orders ADD CONSTRAINT orders_exchange_of_order_key UNIQUE (exchange_of_order_id)`,
  `ALTER TABLE orders ADD CONSTRAINT orders_exchange_of_order CHECK (exchange_of_order_id <> id)`,
  `ALTER TABLE orders DROP CONSTRAINT orders_channel_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN (${CHANNELS}))`,
  `ALTER TABLE orders DROP CONSTRAINT orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE})`,
  `ALTER TABLE orders ADD COLUMN packing_started_at timestamptz NULL`,
  `ALTER TABLE orders ADD CONSTRAINT orders_packing CHECK (packing_started_at IS NULL OR (paid_at IS NOT NULL AND packing_started_at >= paid_at))`,
  `DROP TRIGGER orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...ORDER_IDENTITY_0027, 'exchange_of_order_id'])})`,

  // ── shipments: one parcel ────────────────────────────────────────────────
  `CREATE TABLE shipments (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id           uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     location_id        uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     status             text        NOT NULL DEFAULT 'PACKING' CHECK (status IN (${SHIPMENT_STATUSES})),
     packing_started_at timestamptz NOT NULL DEFAULT now(),
     ${admin('packing_started_by')},
     checklist          jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 64),
     photo              bytea       NULL CHECK (octet_length(photo) BETWEEN 1 AND ${PHOTO_MAX}),
     photo_mime         text        NULL CHECK (photo_mime IN (${PHOTO_TYPES})),
     photo_sha256       text        NULL CHECK (photo_sha256 ~ '^[0-9a-f]{64}$'),
     photo_erased_at    timestamptz NULL,
     packed_at          timestamptz NULL,
     ${admin('packed_by')},
     carrier_id         uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     tracking_number    text        NULL CHECK (tracking_number ~ ${TRACKING}),
     shipped_at         timestamptz NULL,
     ${admin('shipped_by')},
     delivered_at       timestamptz NULL,
     cancelled_at       timestamptz NULL,
     created_at         timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT shipments_photo CHECK ((photo IS NULL) = (photo_mime IS NULL) AND (photo IS NULL) = (photo_sha256 IS NULL) AND (photo_erased_at IS NULL OR photo IS NULL)),
     CONSTRAINT shipments_packed CHECK (
       (status = 'PACKING' OR status = 'CANCELLED' OR packed_at IS NOT NULL)
       AND (status <> 'PACKING' OR packed_at IS NULL)
       AND (packed_by IS NULL OR packed_at IS NOT NULL)
       AND (packed_at IS NULL OR packed_at >= packing_started_at)),
     CONSTRAINT shipments_shipped CHECK (
       (shipped_at IS NOT NULL) = (status IN ('SHIPPED', 'DELIVERED', 'BACK_TO_SENDER', 'LOST', 'DAMAGED'))
       AND (shipped_at IS NULL) = (carrier_id IS NULL) AND (carrier_id IS NULL) = (tracking_number IS NULL)
       AND (shipped_by IS NULL OR shipped_at IS NOT NULL)
       AND (shipped_at IS NULL OR shipped_at >= packed_at)),
     CONSTRAINT shipments_delivered CHECK ((status = 'DELIVERED') = (delivered_at IS NOT NULL)),
     CONSTRAINT shipments_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
   )`,
  `CREATE INDEX shipments_order_idx ON shipments (order_id)`,
  `CREATE UNIQUE INDEX shipments_one_open ON shipments (order_id) WHERE status IN ('PACKING', 'PACKED', 'SHIPPED')`,
  `CREATE INDEX shipments_location_idx ON shipments (location_id)`,
  `CREATE INDEX shipments_status_idx ON shipments (status, location_id)`,
  `CREATE INDEX shipments_packing_started_by_idx ON shipments (packing_started_by)`,
  `CREATE INDEX shipments_packed_by_idx ON shipments (packed_by)`,
  `CREATE INDEX shipments_carrier_idx ON shipments (carrier_id)`,
  `CREATE INDEX shipments_shipped_by_idx ON shipments (shipped_by)`,
  `CREATE TRIGGER shipments_immutable_identity BEFORE UPDATE ON shipments
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'order_id', 'location_id', 'packing_started_at', 'packing_started_by', 'created_at')`,

  // ── shipment_items: each order of the parcel and its piece ───────────────
  `CREATE TABLE shipment_items (
     shipment_id   uuid        NOT NULL REFERENCES shipments (id) ON DELETE RESTRICT,
     order_id      uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     product_id    uuid        NULL REFERENCES products (id) ON DELETE RESTRICT,
     scan_event_id uuid        NULL,
     scanned_at    timestamptz NULL,
     PRIMARY KEY (shipment_id, order_id),
     CONSTRAINT shipment_items_scanned CHECK (product_id IS NULL OR scanned_at IS NOT NULL)
   )`,
  `CREATE INDEX shipment_items_order_idx ON shipment_items (order_id)`,
  `CREATE INDEX shipment_items_product_idx ON shipment_items (product_id)`,
  `CREATE TRIGGER shipment_items_immutable_identity BEFORE UPDATE ON shipment_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('shipment_id', 'order_id')`,

  // ── order_cases: returns, size exchanges and parcel problems ─────────────
  `CREATE TABLE order_cases (
     id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     order_id            uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     shipment_id         uuid        NULL REFERENCES shipments (id) ON DELETE RESTRICT,
     kind                text        NOT NULL CHECK (kind IN (${CASE_KINDS})),
     opened_by_type      text        NOT NULL CHECK (opened_by_type IN (${CASE_OPENERS})),
     opened_by_id        uuid        NOT NULL,
     opened_at           timestamptz NOT NULL DEFAULT now(),
     reason              text        NULL CHECK (reason IN (${CASE_REASONS})),
     note                text        NULL CHECK (${words('note', 1000)}),
     exchange_sku_id     uuid        NULL REFERENCES skus (id) ON DELETE RESTRICT,
     exchange_size_label text        NULL CHECK (length(exchange_size_label) BETWEEN 1 AND 100 AND exchange_size_label = btrim(exchange_size_label)),
     message_id          uuid        NULL REFERENCES client_messages (id) ON DELETE RESTRICT,
     status              text        NOT NULL DEFAULT 'OPEN' CHECK (status IN (${CASE_STATUSES})),
     received_at         timestamptz NULL,
     ${admin('received_by')},
     piece_state         text        NULL CHECK (piece_state IN (${PIECE_STATES})),
     receive_note        text        NULL CHECK (${words('receive_note', 500)}),
     outcome             text        NULL CHECK (outcome IN (${CASE_OUTCOMES})),
     piece_to            text        NULL CHECK (piece_to IN (${PIECE_DESTINATIONS})),
     exchange_order_id   uuid        NULL REFERENCES orders (id) ON DELETE RESTRICT,
     decision_note       text        NULL CHECK (${words('decision_note', 1000)}),
     closed_at           timestamptz NULL,
     ${admin('closed_by')},
     cancelled_at        timestamptz NULL,
     ${admin('cancelled_by')},
     cancel_note         text        NULL CHECK (${words('cancel_note', 1000)}),
     CONSTRAINT order_cases_exchange_order_key UNIQUE (exchange_order_id),
     CONSTRAINT order_cases_shipment CHECK ((shipment_id IS NOT NULL) = (kind IN ('BACK_TO_SENDER', 'LOST', 'DAMAGED'))),
     CONSTRAINT order_cases_reason CHECK ((reason IS NOT NULL) = (kind IN ('RETURN', 'EXCHANGE'))),
     CONSTRAINT order_cases_exchange_size CHECK ((exchange_sku_id IS NOT NULL) = (kind = 'EXCHANGE') AND (exchange_size_label IS NOT NULL) = (kind = 'EXCHANGE')),
     CONSTRAINT order_cases_received CHECK (
       (received_at IS NULL) = (piece_state IS NULL)
       AND (received_by IS NULL OR received_at IS NOT NULL)
       AND (receive_note IS NULL OR received_at IS NOT NULL)
       AND (received_at IS NULL OR kind <> 'LOST')
       AND (status <> 'OPEN' OR received_at IS NULL)
       AND (status <> 'RECEIVED' OR received_at IS NOT NULL)
       AND (received_at IS NULL OR received_at >= opened_at)),
     CONSTRAINT order_cases_closed CHECK (
       (status = 'CLOSED') = (closed_at IS NOT NULL)
       AND (closed_at IS NULL) = (outcome IS NULL)
       AND (closed_by IS NULL OR closed_at IS NOT NULL)
       AND (piece_to IS NULL OR closed_at IS NOT NULL)
       AND (decision_note IS NULL OR closed_at IS NOT NULL)
       AND (exchange_order_id IS NULL OR outcome = 'EXCHANGE')
       AND (closed_at IS NULL OR closed_at >= opened_at)),
     CONSTRAINT order_cases_outcome CHECK (outcome IS NULL OR CASE kind
       WHEN 'RETURN' THEN outcome = 'REFUND'
       WHEN 'EXCHANGE' THEN outcome IN ('EXCHANGE', 'REFUND')
       ELSE outcome IN ('RESHIP', 'REFUND') END),
     CONSTRAINT order_cases_cancelled CHECK (
       (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
       AND (cancelled_at IS NULL) = (cancel_note IS NULL)
       AND (cancelled_by IS NULL OR cancelled_at IS NOT NULL)
       AND (cancelled_at IS NULL OR cancelled_at >= opened_at))
   )`,
  `CREATE INDEX order_cases_order_idx ON order_cases (order_id)`,
  `CREATE UNIQUE INDEX order_cases_one_open ON order_cases (order_id) WHERE status IN ('OPEN', 'RECEIVED')`,
  `CREATE INDEX order_cases_shipment_idx ON order_cases (shipment_id)`,
  `CREATE INDEX order_cases_exchange_sku_idx ON order_cases (exchange_sku_id)`,
  `CREATE INDEX order_cases_message_idx ON order_cases (message_id)`,
  `CREATE INDEX order_cases_received_by_idx ON order_cases (received_by)`,
  `CREATE INDEX order_cases_closed_by_idx ON order_cases (closed_by)`,
  `CREATE INDEX order_cases_cancelled_by_idx ON order_cases (cancelled_by)`,
  `CREATE INDEX order_cases_status_idx ON order_cases (status, opened_at)`,
  `CREATE TRIGGER order_cases_immutable_identity BEFORE UPDATE ON order_cases
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'order_id', 'shipment_id', 'kind', 'opened_by_type', 'opened_by_id', 'opened_at', 'reason', 'note', 'exchange_sku_id', 'exchange_size_label', 'message_id')`,
  `CREATE TRIGGER order_cases_no_delete BEFORE DELETE ON order_cases
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('order cases are kept')`,
  `CREATE TRIGGER order_cases_no_truncate BEFORE TRUNCATE ON order_cases
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('order cases are kept')`,

  // ── LATE after 5 days ────────────────────────────────────────────────────
  `ALTER TABLE order_alert_settings ALTER COLUMN ready_days SET DEFAULT 5`,
  `UPDATE order_alert_settings SET ready_days = 5 WHERE ready_days = 3`,

  // ── The open pieces to make: cancelled; their reserved identities left as they are ──
  `UPDATE bench_items SET status = 'CANCELLED', cancelled_at = greatest(now(), coalesce(started_at, created_at)) WHERE status IN ('TO_MAKE', 'IN_PROGRESS')`,
];

export const DOWN: readonly string[] = [
  // The previous image reads BENCH as a piece to make, and knows no exchange, parcel nor case: refused while any exists.
  `DO $$
   DECLARE awaiting bigint; exchanges bigint; shipments bigint; cases bigint;
   BEGIN
     SELECT count(*) INTO awaiting FROM orders WHERE reservation = 'AWAITING';
     SELECT count(*) INTO exchanges FROM orders WHERE channel = 'EXCHANGE';
     SELECT count(*) INTO shipments FROM shipments;
     SELECT count(*) INTO cases FROM order_cases;
     IF awaiting > 0 OR exchanges > 0 OR shipments > 0 OR cases > 0 THEN
       RAISE EXCEPTION 'migration 0037_fulfilment cannot be rolled back: % orders awaiting stock, % exchange orders, % shipments and % order cases exist', awaiting, exchanges, shipments, cases;
     END IF;
   END $$`,
  `ALTER TABLE order_alert_settings ALTER COLUMN ready_days SET DEFAULT 3`,
  `DROP TABLE IF EXISTS order_cases`,
  `DROP TABLE IF EXISTS shipment_items`,
  `DROP TABLE IF EXISTS shipments`,
  `DROP TRIGGER IF EXISTS orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(ORDER_IDENTITY_0027)})`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_packing`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS packing_started_at`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE_0029})`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN (${CHANNELS_0027}))`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_exchange_of_order`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_exchange_of_order_key`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS exchange_of_order_id`,
  `DROP INDEX IF EXISTS orders_awaiting_idx`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS queue_first`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_reservation_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_reservation_check CHECK (reservation IN (${RESERVATIONS_0022}))`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
