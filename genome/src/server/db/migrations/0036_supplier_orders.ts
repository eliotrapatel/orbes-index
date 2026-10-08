/**
 * 0036 — Supplier orders, receptions, the cards to print, pieces sent back to a supplier, stock corrections (plan NEXT
 * LOT of 2026-10-07, §3.5.5.2, step 5.4: « The console proposes, ORBES confirms »; « the agent attaches the code and the
 * claim card before storing the pieces »).
 *
 * `supplier_orders`: what ORBES orders from a supplier, delivered to a location. `status` DRAFT (one per supplier and
 * location, `supplier_orders_one_draft`; discarded by deleting it, a draft never left ORBES) → SENT (its lines and prices
 * fixed; its currency and expected date then required, `supplier_orders_sent`) → EXPECTED (the supplier confirmed it, an
 * optional step) → PARTLY_RECEIVED → RECEIVED; or CANCELLED (the rest cancelled with nothing accepted). Each status with
 * its times (`supplier_orders_*` CHECKs): `sent_at`/`_by`, `supplier_confirmed_at`/`_by`, `received_at`,
 * `rest_cancelled_at`/`_by`/`_note`. `currency` (three capitals; the service accepts two-decimal currencies only),
 * `shipping_minor` (0 to 100 000 000 hundredths; NULL: no shipping cost), `expected_on`, `note` (printed on its PDF).
 * The supplier's invoice: `invoice_number`, `invoice_minor`, `invoice_date`, all three or none
 * (`supplier_orders_invoice`), `invoice_paid_at`/`_by` only with an invoice. Its reference is `SO-` and its id's first
 * eight hex figures (services/supplier-orders.ts), never stored.
 *
 * `supplier_order_lines`: a SKU once per order (`supplier_order_lines_order_sku_key`), its `quantity` (1 to 10 000) and
 * `unit_price_minor` (NULL until set; required to send), and what came of it: `accepted_quantity`,
 * `rejected_quantity`, `credited_quantity` (rejected pieces the supplier credited instead of replacing),
 * `rest_cancelled_quantity`. Still expected: max(0, quantity − accepted − credited − rest cancelled).
 *
 * `receptions`: a delivery counted by the agent against its supplier order, at its location. TO_CONFIRM (counted) →
 * CONFIRMED by ORBES (which issues the identities), or SENT_BACK to be counted again (then TO_CONFIRM anew); one open
 * (TO_CONFIRM or SENT_BACK) per supplier order (`receptions_one_open`). Its times: `counted_at`/`_by`,
 * `sent_back_at`/`_by`/`sent_back_note`, `confirmed_at`/`_by`, `issued_at` (every identity issued, only once
 * confirmed), `cards_attached_at`/`_by` (only once issued).
 *
 * `reception_lines`: a SKU once per reception, its `supplier_order_line_id` (NULL: a piece not on the order), the
 * pieces `accepted` and `rejected` (0 to 10 000 each, at least one piece), `issued` (0 to accepted: the identities the
 * worker issued so far, restart-safe), the agent's `note`.
 *
 * `card_prints`: a piece issued by a reception and its claim code sealed (AES-256-GCM, crypto/secretbox.ts, HKDF info
 * 'orbes/card-claim-codes/v1', AAD 'card:<product id>') until its card is attached; then erased, with why
 * (`erased_reason` ATTACHED, REPLACED by a new claim code, REGISTERED, UNREADABLE): sealed exactly while not erased
 * (`card_prints_sealed`). `printed_count` and `last_printed_at`.
 *
 * `supplier_returns`: rejected pieces of a reception, TO_RETURN then RETURNED by the agent (`returned_at`/`_by`, an
 * optional carrier and tracking number), and the supplier's answer noted by ORBES: `settlement` REPLACEMENT or CREDIT
 * (`credit_minor` with a CREDIT only), `settled_at`/`_by`.
 *
 * `stock_corrections`: a count the agent proposes (`delta` ±1 to 10 000, never 0, with its `reason`), TO_APPROVE until
 * ORBES approves it (APPROVED, the ledger's movement named, `movement_id`) or declines it (DECLINED, with its note).
 *
 * `stock_movements`: the reason RECEIVED (+n, a reception line's pieces entering the stock, `reception_line_id` named;
 * no order, no single piece). `products.reception_line_id` (the reception that issued the piece) and
 * `products.stock_entered_at` (when the piece first entered the stock; never cleared). Backfill: `stock_entered_at` is
 * the time of the piece's earliest PRODUCED movement, where one exists (a piece finished by the atelier); a count made by
 * hand (ADJUSTED) names no piece and a Generator piece has no PRODUCED movement, so neither gets one: the console shows
 * such counts as « NO PIECE » until ORBES counts their pieces in (§3.5.6.6).
 *
 * Every foreign key leads an index (whole indexes; the partial unique ones beside them); ON DELETE RESTRICT like every
 * other. Compatible with the previous image: new tables it never reads, a reason it never writes, nullable columns it
 * never names. `down` refuses while any supplier order, reception or stock correction exists, naming the counts (the
 * other tables hang from them); otherwise it drops what this migration added in reverse and restores 0022's
 * `stock_movements` CHECKs: the schema of 0035 exactly (nothing is rolled back in production). One statement per array
 * entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const ORDER_STATUSES = `'DRAFT','SENT','EXPECTED','PARTLY_RECEIVED','RECEIVED','CANCELLED'`;
const RECEPTION_STATUSES = `'TO_CONFIRM','SENT_BACK','CONFIRMED'`;
const ERASED_REASONS = `'ATTACHED','REPLACED','REGISTERED','UNREADABLE'`;
const RETURN_STATUSES = `'TO_RETURN','RETURNED'`;
const SETTLEMENTS = `'REPLACEMENT','CREDIT'`;
const CORRECTION_STATUSES = `'TO_APPROVE','APPROVED','DECLINED'`;
const MOVEMENT_REASONS_0022 = `'PRODUCED','ADJUSTED','TRANSFER_OUT','TRANSFER_IN','SHIPPED','RETURNED'`;
const MOVEMENT_REASONS = `'PRODUCED','ADJUSTED','TRANSFER_OUT','TRANSFER_IN','SHIPPED','RETURNED','RECEIVED'`;

/** Text of 1 to n characters once trimmed (as 0022's). */
const words = (column: string, max: number) => `length(btrim(${column})) BETWEEN 1 AND ${max}`;
/** A whole amount of hundredths. */
const AMOUNT_MAX = 100000000;
const INVOICE_MAX = 100000000000;
/** A tracking number, as an order's (0022). */
const TRACKING = `'^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$'`;
const admin = (column: string) => `${column} uuid NULL REFERENCES admin_users (id) ON DELETE RESTRICT`;

/** 0022's two CHECKs of the ledger, restored by `down`. */
const SIGN_0022 = `(reason IN ('PRODUCED', 'TRANSFER_IN', 'RETURNED') AND delta > 0) OR (reason IN ('TRANSFER_OUT', 'SHIPPED') AND delta < 0) OR reason = 'ADJUSTED'`;
const ORDER_0022 = `CASE reason
       WHEN 'SHIPPED' THEN order_id IS NOT NULL AND delta = -1
       WHEN 'RETURNED' THEN order_id IS NOT NULL AND delta = 1
       WHEN 'PRODUCED' THEN product_id IS NOT NULL AND delta = 1
       ELSE order_id IS NULL END`;

export const UP: readonly string[] = [
  // ── supplier_orders ──────────────────────────────────────────────────────
  `CREATE TABLE supplier_orders (
     id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     supplier_id           uuid        NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
     location_id           uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     status                text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN (${ORDER_STATUSES})),
     currency              text        NULL CHECK (currency ~ '^[A-Z]{3}$'),
     shipping_minor        integer     NULL CHECK (shipping_minor BETWEEN 0 AND ${AMOUNT_MAX}),
     expected_on           date        NULL,
     note                  text        NULL CHECK (${words('note', 1000)}),
     sent_at               timestamptz NULL,
     ${admin('sent_by')},
     supplier_confirmed_at timestamptz NULL,
     ${admin('supplier_confirmed_by')},
     received_at           timestamptz NULL,
     rest_cancelled_at     timestamptz NULL,
     ${admin('rest_cancelled_by')},
     rest_cancelled_note   text        NULL CHECK (${words('rest_cancelled_note', 1000)}),
     invoice_number        text        NULL CHECK (${words('invoice_number', 60)}),
     invoice_minor         bigint      NULL CHECK (invoice_minor BETWEEN 0 AND ${INVOICE_MAX}),
     invoice_date          date        NULL,
     invoice_paid_at       timestamptz NULL,
     ${admin('invoice_paid_by')},
     created_at            timestamptz NOT NULL DEFAULT now(),
     ${admin('created_by')},
     updated_at            timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT supplier_orders_sent CHECK (status = 'DRAFT' OR (sent_at IS NOT NULL AND currency IS NOT NULL AND expected_on IS NOT NULL)),
     CONSTRAINT supplier_orders_draft CHECK ((status = 'DRAFT') = (sent_at IS NULL)),
     CONSTRAINT supplier_orders_sent_by CHECK (sent_by IS NULL OR sent_at IS NOT NULL),
     CONSTRAINT supplier_orders_confirmed CHECK (
       (supplier_confirmed_at IS NULL OR status NOT IN ('DRAFT', 'SENT'))
       AND (status <> 'EXPECTED' OR supplier_confirmed_at IS NOT NULL)
       AND (supplier_confirmed_by IS NULL OR supplier_confirmed_at IS NOT NULL)),
     CONSTRAINT supplier_orders_received CHECK ((status = 'RECEIVED') = (received_at IS NOT NULL)),
     CONSTRAINT supplier_orders_rest_cancelled CHECK (
       (rest_cancelled_at IS NULL OR status IN ('RECEIVED', 'CANCELLED'))
       AND (status <> 'CANCELLED' OR rest_cancelled_at IS NOT NULL)
       AND (rest_cancelled_at IS NULL) = (rest_cancelled_note IS NULL)
       AND (rest_cancelled_by IS NULL OR rest_cancelled_at IS NOT NULL)),
     CONSTRAINT supplier_orders_invoice CHECK ((invoice_number IS NULL) = (invoice_minor IS NULL) AND (invoice_minor IS NULL) = (invoice_date IS NULL)),
     CONSTRAINT supplier_orders_invoice_paid CHECK (
       (invoice_paid_at IS NULL OR invoice_number IS NOT NULL) AND (invoice_paid_by IS NULL OR invoice_paid_at IS NOT NULL))
   )`,
  `CREATE INDEX supplier_orders_supplier_idx ON supplier_orders (supplier_id)`,
  `CREATE INDEX supplier_orders_location_idx ON supplier_orders (location_id)`,
  `CREATE INDEX supplier_orders_status_idx ON supplier_orders (status, expected_on)`,
  `CREATE UNIQUE INDEX supplier_orders_one_draft ON supplier_orders (supplier_id, location_id) WHERE status = 'DRAFT'`,
  `CREATE INDEX supplier_orders_sent_by_idx ON supplier_orders (sent_by)`,
  `CREATE INDEX supplier_orders_supplier_confirmed_by_idx ON supplier_orders (supplier_confirmed_by)`,
  `CREATE INDEX supplier_orders_rest_cancelled_by_idx ON supplier_orders (rest_cancelled_by)`,
  `CREATE INDEX supplier_orders_invoice_paid_by_idx ON supplier_orders (invoice_paid_by)`,
  `CREATE INDEX supplier_orders_created_by_idx ON supplier_orders (created_by)`,
  `CREATE TRIGGER supplier_orders_immutable_identity BEFORE UPDATE ON supplier_orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'supplier_id', 'location_id', 'created_at', 'created_by')`,

  // ── supplier_order_lines ─────────────────────────────────────────────────
  `CREATE TABLE supplier_order_lines (
     id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     supplier_order_id       uuid        NOT NULL REFERENCES supplier_orders (id) ON DELETE RESTRICT,
     sku_id                  uuid        NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     quantity                integer     NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
     unit_price_minor        integer     NULL CHECK (unit_price_minor BETWEEN 0 AND ${AMOUNT_MAX}),
     accepted_quantity       integer     NOT NULL DEFAULT 0 CHECK (accepted_quantity BETWEEN 0 AND 100000),
     rejected_quantity       integer     NOT NULL DEFAULT 0 CHECK (rejected_quantity BETWEEN 0 AND 100000),
     credited_quantity       integer     NOT NULL DEFAULT 0 CHECK (credited_quantity BETWEEN 0 AND 100000),
     rest_cancelled_quantity integer     NOT NULL DEFAULT 0 CHECK (rest_cancelled_quantity BETWEEN 0 AND 100000),
     created_at              timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT supplier_order_lines_order_sku_key UNIQUE (supplier_order_id, sku_id)
   )`,
  `CREATE INDEX supplier_order_lines_sku_idx ON supplier_order_lines (sku_id)`,
  `CREATE TRIGGER supplier_order_lines_immutable_identity BEFORE UPDATE ON supplier_order_lines
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'supplier_order_id', 'sku_id', 'created_at')`,

  // ── receptions ───────────────────────────────────────────────────────────
  `CREATE TABLE receptions (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     supplier_order_id uuid        NOT NULL REFERENCES supplier_orders (id) ON DELETE RESTRICT,
     location_id       uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     status            text        NOT NULL DEFAULT 'TO_CONFIRM' CHECK (status IN (${RECEPTION_STATUSES})),
     delivery_note     text        NULL CHECK (${words('delivery_note', 60)}),
     note              text        NULL CHECK (${words('note', 1000)}),
     counted_at        timestamptz NOT NULL DEFAULT now(),
     ${admin('counted_by')},
     sent_back_at      timestamptz NULL,
     ${admin('sent_back_by')},
     sent_back_note    text        NULL CHECK (${words('sent_back_note', 1000)}),
     confirmed_at      timestamptz NULL,
     ${admin('confirmed_by')},
     issued_at         timestamptz NULL,
     cards_attached_at timestamptz NULL,
     ${admin('cards_attached_by')},
     created_at        timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT receptions_confirmed CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL) AND (confirmed_by IS NULL OR confirmed_at IS NOT NULL)),
     CONSTRAINT receptions_sent_back CHECK (
       (status <> 'SENT_BACK' OR sent_back_at IS NOT NULL)
       AND (sent_back_at IS NULL) = (sent_back_note IS NULL)
       AND (sent_back_by IS NULL OR sent_back_at IS NOT NULL)),
     CONSTRAINT receptions_issued CHECK (issued_at IS NULL OR confirmed_at IS NOT NULL),
     CONSTRAINT receptions_cards_attached CHECK ((cards_attached_at IS NULL OR issued_at IS NOT NULL) AND (cards_attached_by IS NULL OR cards_attached_at IS NOT NULL))
   )`,
  `CREATE INDEX receptions_supplier_order_idx ON receptions (supplier_order_id)`,
  `CREATE UNIQUE INDEX receptions_one_open ON receptions (supplier_order_id) WHERE status IN ('TO_CONFIRM', 'SENT_BACK')`,
  `CREATE INDEX receptions_location_idx ON receptions (location_id, status)`,
  `CREATE INDEX receptions_counted_by_idx ON receptions (counted_by)`,
  `CREATE INDEX receptions_sent_back_by_idx ON receptions (sent_back_by)`,
  `CREATE INDEX receptions_confirmed_by_idx ON receptions (confirmed_by)`,
  `CREATE INDEX receptions_cards_attached_by_idx ON receptions (cards_attached_by)`,
  `CREATE TRIGGER receptions_immutable_identity BEFORE UPDATE ON receptions
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'supplier_order_id', 'location_id', 'created_at')`,

  // ── reception_lines ──────────────────────────────────────────────────────
  `CREATE TABLE reception_lines (
     id                     uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
     reception_id           uuid    NOT NULL REFERENCES receptions (id) ON DELETE RESTRICT,
     sku_id                 uuid    NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     supplier_order_line_id uuid    NULL REFERENCES supplier_order_lines (id) ON DELETE RESTRICT,
     accepted               integer NOT NULL DEFAULT 0 CHECK (accepted BETWEEN 0 AND 10000),
     rejected               integer NOT NULL DEFAULT 0 CHECK (rejected BETWEEN 0 AND 10000),
     issued                 integer NOT NULL DEFAULT 0,
     note                   text    NULL CHECK (${words('note', 500)}),
     CONSTRAINT reception_lines_pieces CHECK (accepted + rejected >= 1),
     CONSTRAINT reception_lines_issued CHECK (issued BETWEEN 0 AND accepted),
     CONSTRAINT reception_lines_reception_sku_key UNIQUE (reception_id, sku_id)
   )`,
  `CREATE INDEX reception_lines_sku_idx ON reception_lines (sku_id)`,
  `CREATE INDEX reception_lines_supplier_order_line_idx ON reception_lines (supplier_order_line_id)`,
  `CREATE TRIGGER reception_lines_immutable_identity BEFORE UPDATE ON reception_lines
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'reception_id', 'sku_id', 'supplier_order_line_id')`,

  // ── card_prints ──────────────────────────────────────────────────────────
  `CREATE TABLE card_prints (
     product_id        uuid        PRIMARY KEY REFERENCES products (id) ON DELETE RESTRICT,
     reception_id      uuid        NOT NULL REFERENCES receptions (id) ON DELETE RESTRICT,
     sealed_claim_code text        NULL,
     printed_count     integer     NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
     last_printed_at   timestamptz NULL,
     erased_at         timestamptz NULL,
     erased_reason     text        NULL CHECK (erased_reason IN (${ERASED_REASONS})),
     CONSTRAINT card_prints_sealed CHECK ((sealed_claim_code IS NULL) = (erased_at IS NOT NULL)),
     CONSTRAINT card_prints_erased CHECK ((erased_at IS NULL) = (erased_reason IS NULL)),
     CONSTRAINT card_prints_printed CHECK ((printed_count = 0) = (last_printed_at IS NULL))
   )`,
  `CREATE INDEX card_prints_reception_idx ON card_prints (reception_id)`,
  `CREATE TRIGGER card_prints_immutable_identity BEFORE UPDATE ON card_prints
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('product_id', 'reception_id')`,

  // ── supplier_returns ─────────────────────────────────────────────────────
  `CREATE TABLE supplier_returns (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     supplier_order_id uuid        NOT NULL REFERENCES supplier_orders (id) ON DELETE RESTRICT,
     reception_id      uuid        NOT NULL REFERENCES receptions (id) ON DELETE RESTRICT,
     sku_id            uuid        NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     quantity          integer     NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
     status            text        NOT NULL DEFAULT 'TO_RETURN' CHECK (status IN (${RETURN_STATUSES})),
     returned_at       timestamptz NULL,
     ${admin('returned_by')},
     carrier_id        uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     tracking_number   text        NULL CHECK (tracking_number ~ ${TRACKING}),
     settlement        text        NULL CHECK (settlement IN (${SETTLEMENTS})),
     credit_minor      integer     NULL CHECK (credit_minor BETWEEN 0 AND ${AMOUNT_MAX}),
     settled_at        timestamptz NULL,
     ${admin('settled_by')},
     note              text        NULL CHECK (${words('note', 500)}),
     created_at        timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT supplier_returns_returned CHECK (
       (status = 'RETURNED') = (returned_at IS NOT NULL)
       AND (returned_by IS NULL OR returned_at IS NOT NULL)
       AND (returned_at IS NOT NULL OR (carrier_id IS NULL AND tracking_number IS NULL))),
     CONSTRAINT supplier_returns_settled CHECK (
       (settlement IS NULL) = (settled_at IS NULL)
       AND (credit_minor IS NOT NULL) = (settlement = 'CREDIT')
       AND (settled_by IS NULL OR settled_at IS NOT NULL))
   )`,
  `CREATE INDEX supplier_returns_supplier_order_idx ON supplier_returns (supplier_order_id)`,
  `CREATE INDEX supplier_returns_reception_idx ON supplier_returns (reception_id)`,
  `CREATE INDEX supplier_returns_sku_idx ON supplier_returns (sku_id)`,
  `CREATE INDEX supplier_returns_carrier_idx ON supplier_returns (carrier_id)`,
  `CREATE INDEX supplier_returns_returned_by_idx ON supplier_returns (returned_by)`,
  `CREATE INDEX supplier_returns_settled_by_idx ON supplier_returns (settled_by)`,
  `CREATE TRIGGER supplier_returns_immutable_identity BEFORE UPDATE ON supplier_returns
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'supplier_order_id', 'reception_id', 'sku_id', 'quantity', 'created_at')`,

  // ── stock_movements: RECEIVED, and the reception line it names ───────────
  `ALTER TABLE stock_movements ADD COLUMN reception_line_id uuid NULL CONSTRAINT stock_movements_reception_line_id_fkey REFERENCES reception_lines (id) ON DELETE RESTRICT`,
  `CREATE INDEX stock_movements_reception_line_idx ON stock_movements (reception_line_id)`,
  `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check CHECK (reason IN (${MOVEMENT_REASONS}))`,
  `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_sign`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sign CHECK (
     (reason IN ('PRODUCED', 'TRANSFER_IN', 'RETURNED', 'RECEIVED') AND delta > 0) OR (reason IN ('TRANSFER_OUT', 'SHIPPED') AND delta < 0) OR reason = 'ADJUSTED')`,
  `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_order`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_order CHECK (CASE reason
       WHEN 'SHIPPED' THEN order_id IS NOT NULL AND delta = -1
       WHEN 'RETURNED' THEN order_id IS NOT NULL AND delta = 1
       WHEN 'PRODUCED' THEN product_id IS NOT NULL AND delta = 1
       WHEN 'RECEIVED' THEN order_id IS NULL AND product_id IS NULL AND reception_line_id IS NOT NULL
       ELSE order_id IS NULL END)`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_received CHECK ((reason = 'RECEIVED') = (reception_line_id IS NOT NULL))`,

  // ── stock_corrections ────────────────────────────────────────────────────
  `CREATE TABLE stock_corrections (
     id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     sku_id        uuid        NOT NULL REFERENCES skus (id) ON DELETE RESTRICT,
     location_id   uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     delta         integer     NOT NULL CHECK (delta <> 0 AND delta BETWEEN -10000 AND 10000),
     reason        text        NOT NULL CHECK (${words('reason', 500)}),
     status        text        NOT NULL DEFAULT 'TO_APPROVE' CHECK (status IN (${CORRECTION_STATUSES})),
     ${admin('proposed_by')},
     proposed_at   timestamptz NOT NULL DEFAULT now(),
     ${admin('decided_by')},
     decided_at    timestamptz NULL,
     decision_note text        NULL CHECK (${words('decision_note', 500)}),
     movement_id   bigint      NULL REFERENCES stock_movements (id) ON DELETE RESTRICT,
     CONSTRAINT stock_corrections_decided CHECK ((status = 'TO_APPROVE') = (decided_at IS NULL) AND (decided_by IS NULL OR decided_at IS NOT NULL)),
     CONSTRAINT stock_corrections_movement CHECK ((status = 'APPROVED') = (movement_id IS NOT NULL)),
     CONSTRAINT stock_corrections_declined CHECK (status <> 'DECLINED' OR decision_note IS NOT NULL),
     CONSTRAINT stock_corrections_movement_key UNIQUE (movement_id)
   )`,
  `CREATE INDEX stock_corrections_sku_idx ON stock_corrections (sku_id)`,
  `CREATE INDEX stock_corrections_location_idx ON stock_corrections (location_id, status)`,
  `CREATE INDEX stock_corrections_proposed_by_idx ON stock_corrections (proposed_by)`,
  `CREATE INDEX stock_corrections_decided_by_idx ON stock_corrections (decided_by)`,
  `CREATE TRIGGER stock_corrections_immutable_identity BEFORE UPDATE ON stock_corrections
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'sku_id', 'location_id', 'delta', 'reason', 'proposed_by', 'proposed_at')`,
  `CREATE TRIGGER stock_corrections_no_delete BEFORE DELETE ON stock_corrections
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('stock corrections are kept')`,

  // ── products: the reception that issued a piece, and when it entered the stock ──
  `ALTER TABLE products ADD COLUMN reception_line_id uuid NULL CONSTRAINT products_reception_line_id_fkey REFERENCES reception_lines (id) ON DELETE RESTRICT`,
  `CREATE INDEX products_reception_line_idx ON products (reception_line_id)`,
  `ALTER TABLE products ADD COLUMN stock_entered_at timestamptz NULL`,
  // A piece finished by the atelier entered the stock with its PRODUCED movement; nothing else is known to (§3.5.5.2 item 9).
  `UPDATE products p SET stock_entered_at = m.at
     FROM (SELECT product_id, min(created_at) AS at FROM stock_movements WHERE reason = 'PRODUCED' AND product_id IS NOT NULL GROUP BY product_id) m
    WHERE p.id = m.product_id AND p.stock_entered_at IS NULL`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no supplier order, reception nor correction: refused while any exists.
  `DO $$
   DECLARE orders bigint; receptions bigint; corrections bigint;
   BEGIN
     SELECT count(*) INTO orders FROM supplier_orders;
     SELECT count(*) INTO receptions FROM receptions;
     SELECT count(*) INTO corrections FROM stock_corrections;
     IF orders > 0 OR receptions > 0 OR corrections > 0 THEN
       RAISE EXCEPTION 'migration 0036_supplier_orders cannot be rolled back: % supplier orders, % receptions and % stock corrections exist', orders, receptions, corrections;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS products_reception_line_idx`,
  `ALTER TABLE products DROP COLUMN IF EXISTS reception_line_id`,
  `ALTER TABLE products DROP COLUMN IF EXISTS stock_entered_at`,
  `DROP TABLE IF EXISTS stock_corrections`,
  `ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_received`,
  `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_order`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_order CHECK (${ORDER_0022})`,
  `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_sign`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sign CHECK (${SIGN_0022})`,
  `ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check`,
  `ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check CHECK (reason IN (${MOVEMENT_REASONS_0022}))`,
  `DROP INDEX IF EXISTS stock_movements_reception_line_idx`,
  `ALTER TABLE stock_movements DROP COLUMN IF EXISTS reception_line_id`,
  `DROP TABLE IF EXISTS supplier_returns`,
  `DROP TABLE IF EXISTS card_prints`,
  `DROP TABLE IF EXISTS reception_lines`,
  `DROP TABLE IF EXISTS receptions`,
  `DROP TABLE IF EXISTS supplier_order_lines`,
  `DROP TABLE IF EXISTS supplier_orders`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
