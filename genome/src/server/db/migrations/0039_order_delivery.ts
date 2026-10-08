/**
 * 0039 — The delivery address and the engraving, the collector's own (plan NEXT LOT of 2026-10-07, §3.6.B and §3.6.C,
 * step 6.6: the collector « enters it on the order and can change it until the agent starts packing; after that, only
 * through Client Services »; saved addresses « one or more, one by default, picked on each order, still changeable on
 * the order until packing »; the engraving « with its price … until packing starts »).
 *
 * `account_addresses`: YOUR ADDRESSES, a collector's saved delivery addresses (at most 5, services/addresses.ts): a
 * name (1 to 200 characters), the address lines as typed (1 to 1000, line breaks kept), a country (ISO 3166-1 alpha-2,
 * src/shared/countries.ts) and a phone with its country code (`+` then 6 to 25 digits, spaces, dots, hyphens or
 * brackets); `is_default` on one of them at most (`account_addresses_one_default`). The collector's own data, as
 * `account_sizes`: a removed address is a deleted row. id, account and creation never change (the guard).
 *
 * `orders`: the delivery address's country and phone (`buyer_country`, `buyer_phone`, beside 0022's `buyer_name` and
 * `buyer_address`), who entered it (`address_by`: the COLLECTOR, or STAFF for ORBES Client Services) and when
 * (`address_at`), both or neither (`orders_address_by`), and when it was replaced after it was first entered
 * (`address_changed_at`, never before `address_at`: the agent's ADDRESS CHANGED). An order travelling with another
 * (`with_order_id`) never carries its own: it is delivered with that order, to its address (`orders_address_travels`;
 * its old name and address, entered before this lot, stay as they are). None of them is on the identity guard.
 *
 * `engraving_prices`: the engraving's price per currency (the house's four), set in Orders → Settings, Engraving
 * (ADMIN), for an order whose release did not sell the engraving as an add-on; none inserted: a currency without a
 * price offers no engraving. `orders.engraving_minor`: the price an engraving was taken at (the setting's then, kept;
 * NULL for one bought as the release's add-on, and for one entered before this lot), only with its words and the
 * order's currency (`orders_engraving_price`); `orders.engraving_by`: who typed the words, the COLLECTOR or STAFF,
 * present exactly with them (`orders_engraving_by`; an engraving of before reads STAFF).
 *
 * `invoices`: an engraving added or removed after PAID gets its own document, since an invoice is never changed. A
 * supplementary INVOICE names the order's invoice it supplements (`supplements_invoice_id`, an INVOICE only:
 * `invoices_supplements`); one invoice per order is now one main invoice (`invoices_one_per_order`, rebuilt without the
 * supplementary ones). A credit note says what it credits (`credit_scope`, on a credit note only:
 * `invoices_credit_scope`): FULL, what remains of the invoice (every credit note of before), or LINES, single lines;
 * an invoice takes credit notes for single lines, then at most one FULL (`invoices_full_credit_key`, in place of 0022's
 * `invoices_credits_key`, its foreign key led by `invoices_credits_idx`). The invoices' trigger refuses every change
 * of a document: it is dropped while the credit notes of before are marked FULL, then created again as 0022 made it.
 *
 * Existing data: orders keep their buyer's name and address; an order that does not travel with another and has an
 * address reads entered by STAFF at its latest `order.buyer` event (its reservation when none is found); its country and
 * phone stay empty ('Not entered'). Orders keep their engraving words (STAFF, no price). No saved address, no engraving
 * price. Every foreign key leads an index; ON DELETE RESTRICT like every other. Compatible with the previous image: a
 * table it never reads, nullable columns it never names (it inserts orders and invoices without them; its one-invoice
 * rule still holds: it issues no supplementary invoice). `down` refuses while a supplementary invoice or a credit note
 * for single lines exists, naming the counts; otherwise it drops the rest and restores 0022's invoice keys: the schema of
 * 0038 exactly (nothing is rolled back in production). One statement per array entry (PGlite's extended protocol);
 * Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const ADDRESS_SOURCES = `'COLLECTOR','STAFF'`;
const CURRENCIES = `'EUR','GBP','USD','CHF'`;
const CREDIT_SCOPES = `'FULL','LINES'`;

/** A country: ISO 3166-1 alpha-2. */
const COUNTRY = `'^[A-Z]{2}$'`;
/** A phone with its country code: `+33 6 12 34 56 78`. */
const PHONE = `'^\\+[0-9][0-9 ().-]{5,24}$'`;
/** Text of 1 to n characters, trimmed. */
const trimmed = (column: string, max: number) => `length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column})`;

/** The invoices' guard as 0022 made it. */
const INVOICES_IMMUTABLE = `CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('an invoice is never changed; a credit note follows it')`;

export const UP: readonly string[] = [
  // ── account_addresses ────────────────────────────────────────────────────
  `CREATE TABLE account_addresses (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     name       text        NOT NULL CHECK (${trimmed('name', 200)}),
     address    text        NOT NULL CHECK (${trimmed('address', 1000)}),
     country    text        NOT NULL CHECK (country ~ ${COUNTRY}),
     phone      text        NOT NULL CHECK (phone ~ ${PHONE}),
     is_default boolean     NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX account_addresses_account_idx ON account_addresses (account_id, created_at)`,
  // One default address per account.
  `CREATE UNIQUE INDEX account_addresses_one_default ON account_addresses (account_id) WHERE is_default`,
  `CREATE TRIGGER account_addresses_immutable_identity BEFORE UPDATE ON account_addresses
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'created_at')`,

  // ── orders: the delivery address ─────────────────────────────────────────
  `ALTER TABLE orders ADD COLUMN buyer_country text NULL CONSTRAINT orders_buyer_country_check CHECK (buyer_country ~ ${COUNTRY})`,
  `ALTER TABLE orders ADD COLUMN buyer_phone text NULL CONSTRAINT orders_buyer_phone_check CHECK (buyer_phone ~ ${PHONE})`,
  `ALTER TABLE orders ADD COLUMN address_by text NULL CONSTRAINT orders_address_by_check CHECK (address_by IN (${ADDRESS_SOURCES}))`,
  `ALTER TABLE orders ADD COLUMN address_at timestamptz NULL`,
  `ALTER TABLE orders ADD COLUMN address_changed_at timestamptz NULL`,
  // An address of before, on an order that does not travel with another: entered by Client Services at its latest
  // order.buyer event, or at the order's reservation. A travelling order is left out (orders_address_travels).
  `UPDATE orders o SET address_by = 'STAFF',
     address_at = coalesce((SELECT max(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.action = 'order.buyer'), o.reserved_at)
   WHERE o.with_order_id IS NULL AND o.buyer_address IS NOT NULL`,
  `ALTER TABLE orders ADD CONSTRAINT orders_address_by CHECK ((address_by IS NULL) = (address_at IS NULL))`,
  `ALTER TABLE orders ADD CONSTRAINT orders_address_changed CHECK (address_changed_at IS NULL OR (address_at IS NOT NULL AND address_changed_at >= address_at))`,
  `ALTER TABLE orders ADD CONSTRAINT orders_address_travels CHECK (with_order_id IS NULL OR (buyer_country IS NULL AND buyer_phone IS NULL AND address_by IS NULL))`,

  // ── engraving_prices, and the order's engraving ──────────────────────────
  `CREATE TABLE engraving_prices (
     currency    text        PRIMARY KEY CHECK (currency IN (${CURRENCIES})),
     price_minor integer     NOT NULL CHECK (price_minor BETWEEN 0 AND 100000000),
     updated_by  uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX engraving_prices_updated_by_idx ON engraving_prices (updated_by)`,
  `ALTER TABLE orders ADD COLUMN engraving_minor integer NULL CONSTRAINT orders_engraving_minor_check CHECK (engraving_minor BETWEEN 0 AND 100000000)`,
  `ALTER TABLE orders ADD CONSTRAINT orders_engraving_price CHECK (engraving_minor IS NULL OR (engraving_text IS NOT NULL AND currency IS NOT NULL))`,
  `ALTER TABLE orders ADD COLUMN engraving_by text NULL CONSTRAINT orders_engraving_by_check CHECK (engraving_by IN (${ADDRESS_SOURCES}))`,
  // An engraving of before was entered by Client Services.
  `UPDATE orders SET engraving_by = 'STAFF' WHERE engraving_text IS NOT NULL`,
  `ALTER TABLE orders ADD CONSTRAINT orders_engraving_by CHECK ((engraving_by IS NULL) = (engraving_text IS NULL))`,

  // ── invoices: the supplementary invoice, the credit note for single lines ─
  `ALTER TABLE invoices ADD COLUMN supplements_invoice_id uuid NULL REFERENCES invoices (id) ON DELETE RESTRICT`,
  `CREATE INDEX invoices_supplements_idx ON invoices (supplements_invoice_id)`,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_supplements CHECK (supplements_invoice_id IS NULL OR kind = 'INVOICE')`,
  `DROP INDEX invoices_one_per_order`,
  // One main invoice per order; its supplementary ones beside it.
  `CREATE UNIQUE INDEX invoices_one_per_order ON invoices (order_id) WHERE kind = 'INVOICE' AND supplements_invoice_id IS NULL`,
  `ALTER TABLE invoices ADD COLUMN credit_scope text NULL CONSTRAINT invoices_credit_scope_check CHECK (credit_scope IN (${CREDIT_SCOPES}))`,
  // Every credit note of before credits its invoice in full: the guard set aside for that one statement.
  `DROP TRIGGER invoices_immutable ON invoices`,
  `UPDATE invoices SET credit_scope = 'FULL' WHERE kind = 'CREDIT_NOTE'`,
  INVOICES_IMMUTABLE,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_credit_scope CHECK ((kind = 'CREDIT_NOTE') = (credit_scope IS NOT NULL))`,
  `ALTER TABLE invoices DROP CONSTRAINT invoices_credits_key`,
  `CREATE INDEX invoices_credits_idx ON invoices (credits_invoice_id)`,
  // Credit notes for single lines, then at most one for what remains.
  `CREATE UNIQUE INDEX invoices_full_credit_key ON invoices (credits_invoice_id) WHERE credit_scope = 'FULL'`,
];

export const DOWN: readonly string[] = [
  // The previous image reads one invoice per order and one credit note per invoice: refused while either is not so.
  `DO $$
   DECLARE supplements bigint; lines bigint;
   BEGIN
     SELECT count(*) INTO supplements FROM invoices WHERE supplements_invoice_id IS NOT NULL;
     SELECT count(*) INTO lines FROM invoices WHERE credit_scope = 'LINES';
     IF supplements > 0 OR lines > 0 THEN
       RAISE EXCEPTION 'migration 0039_order_delivery cannot be rolled back: % supplementary invoices and % credit notes for single lines exist', supplements, lines;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS invoices_full_credit_key`,
  `DROP INDEX IF EXISTS invoices_credits_idx`,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_credits_key UNIQUE (credits_invoice_id)`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_credit_scope`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_credit_scope_check`,
  `ALTER TABLE invoices DROP COLUMN IF EXISTS credit_scope`,
  `DROP INDEX IF EXISTS invoices_one_per_order`,
  `CREATE UNIQUE INDEX invoices_one_per_order ON invoices (order_id) WHERE kind = 'INVOICE'`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_supplements`,
  `DROP INDEX IF EXISTS invoices_supplements_idx`,
  `ALTER TABLE invoices DROP COLUMN IF EXISTS supplements_invoice_id`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_engraving_by`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_engraving_by_check`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS engraving_by`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_engraving_price`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_engraving_minor_check`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS engraving_minor`,
  `DROP TABLE IF EXISTS engraving_prices`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_address_travels`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_address_changed`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_address_by`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS address_changed_at`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS address_at`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_address_by_check`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS address_by`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_buyer_phone_check`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS buyer_phone`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_buyer_country_check`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS buyer_country`,
  `DROP TABLE IF EXISTS account_addresses`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
