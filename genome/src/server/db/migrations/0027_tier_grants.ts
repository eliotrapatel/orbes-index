/**
 * 0027 — the tiers' grants and the orders' shipping (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T4 and T5, steps 2.4 and
 * 2.5: « Shipping: PLATINE gets free shipping on every order, PALLADIUM free EXPRESS shipping on every order », « the
 * gift and the credit are given once per tier per account, EVER »).
 *
 * `tier_grants`: what an account received on reaching a tier (2 PLATINE, 3 PALLADIUM): its welcome GIFT and its CREDIT,
 * once per tier and per account, ever (`tier_grants_once`). A CREDIT carries its amount (1 to 100 000 000 minor units),
 * currency and expiry, a GIFT none of them (`tier_grants_credit`); a GIFT names the model it was given as once attached
 * to an order (`model_id`, set each time it is attached; the size lives on its GIFT order), never a CREDIT
 * (`tier_grants_gift`). Its identity and its amount never change; a grant is never deleted (« a grant is never taken
 * back »): it waits while the account is below its tier.
 *
 * `credit_uses`: a credit taken off an order (`grant_id`, `order_id`), its amount (> 0), who applied it and when; released
 * (`released_at`, `released_reason` REMOVED, CANCELLED or RETURNED, `released_by`) when Client Services removes it, or the
 * order is cancelled or returned: both or neither. One open use per grant and order (`credit_uses_open_key`). Never
 * deleted; only the release changes. A grant's balance is its amount less its open uses.
 *
 * `orders` gains:
 *   - `with_order_id`: the order it travels with (a GIFT order, and the 2nd to 5th piece of a LIVE entry);
 *   - `gift_grant_id`: a GIFT order's grant, one open GIFT order per grant (`orders_gift_grant_key`, its CANCELLED ones
 *     aside);
 *   - `shipping_service` STANDARD or EXPRESS and `shipping_minor` 0 to 100 000 000, both or neither (`orders_shipping`):
 *     NULL is no shipping (an order of before, or one below the free tiers with no fee, as before); `shipping_benefit`
 *     the tier that made it free (2, 3), only at 0 (`orders_shipping_benefit`).
 * The channel CHECK gains GIFT (a welcome gift, its own order at price 0, travelling with the order it was added to), and
 * `orders_source` is rebuilt: 0022's clauses, the salon's « no release » extended to GIFT, a GIFT order with its grant
 * and the order it travels with, a grant on a GIFT order only. A GIFT order's SKU and size may be NULL (to be confirmed),
 * as a draw's or a salon's already may. The identity guard gains `with_order_id` and `gift_grant_id`.
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. Compatible with the previous image: two tables
 * it never reads, nullable columns it never names (it inserts orders without them and reads them column by column), and
 * no GIFT order until this image adds one. No row is inserted. `down` refuses, naming the count, while any GIFT order or
 * credit use exists (the previous image would read neither); otherwise it restores 0022's channel CHECK, `orders_source`
 * and identity guard, drops the columns and the two tables: the schema of 0026 exactly. One statement per array entry
 * (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const GRANT_KINDS = `'GIFT','CREDIT'`;
const RELEASED_REASONS = `'REMOVED','CANCELLED','RETURNED'`;
const SHIPPING_SERVICES = `'STANDARD','EXPRESS'`;
const ORDER_CHANNELS_0022 = `'LIVE','DRAW','SALON'`;
const ORDER_CHANNELS = `'LIVE','DRAW','SALON','GIFT'`;

/** An amount, as an order's (0022). */
const AMOUNT_MAX = 100_000_000;

/** 0022's identity of an order. */
const ORDER_IDENTITY_0022 = ['id', 'channel', 'live_entry_id', 'piece', 'drop_entry_id', 'shop_request_id', 'drop_id', 'account_id', 'model_id', 'reserved_at'];
const quoted = (cols: readonly string[]) => cols.map((c) => `'${c}'`).join(', ');

/** orders_source as 0022 wrote it. */
const SOURCE_0022 = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel = 'SALON') = (drop_id IS NULL)
       AND (channel = 'LIVE' OR piece = 1)`;
/** orders_source with GIFT: no release, its grant and the order it travels with; a grant on a GIFT order only. */
const SOURCE = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel IN ('SALON', 'GIFT')) = (drop_id IS NULL)
       AND (channel = 'LIVE' OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)`;

export const UP: readonly string[] = [
  // ── tier_grants ──────────────────────────────────────────────────────────
  `CREATE TABLE tier_grants (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id   uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     tier         smallint    NOT NULL CHECK (tier IN (2, 3)),
     kind         text        NOT NULL CHECK (kind IN (${GRANT_KINDS})),
     granted_at   timestamptz NOT NULL DEFAULT now(),
     amount_minor integer     NULL CHECK (amount_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     currency     text        NULL CHECK (currency ~ '^[A-Z]{3}$'),
     expires_at   timestamptz NULL,
     model_id     uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     CONSTRAINT tier_grants_once UNIQUE (account_id, tier, kind),
     CONSTRAINT tier_grants_credit CHECK (
       (kind = 'CREDIT') = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)),
     CONSTRAINT tier_grants_gift CHECK (kind = 'GIFT' OR model_id IS NULL),
     CONSTRAINT tier_grants_expiry CHECK (expires_at > granted_at)
   )`,
  `CREATE INDEX tier_grants_model_id_idx ON tier_grants (model_id)`,
  `CREATE TRIGGER tier_grants_immutable BEFORE UPDATE ON tier_grants
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'tier', 'kind', 'granted_at', 'amount_minor', 'currency', 'expires_at')`,
  `CREATE TRIGGER tier_grants_no_delete BEFORE DELETE ON tier_grants
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a grant is never taken back')`,

  // ── orders: shipping, the order travelled with, a gift's grant ───────────
  `ALTER TABLE orders ADD COLUMN with_order_id uuid NULL REFERENCES orders (id) ON DELETE RESTRICT`,
  `ALTER TABLE orders ADD COLUMN gift_grant_id uuid NULL REFERENCES tier_grants (id) ON DELETE RESTRICT`,
  `ALTER TABLE orders ADD COLUMN shipping_service text NULL CHECK (shipping_service IN (${SHIPPING_SERVICES}))`,
  `ALTER TABLE orders ADD COLUMN shipping_minor integer NULL CHECK (shipping_minor BETWEEN 0 AND ${AMOUNT_MAX})`,
  `ALTER TABLE orders ADD COLUMN shipping_benefit smallint NULL CHECK (shipping_benefit IN (2, 3))`,
  `ALTER TABLE orders ADD CONSTRAINT orders_shipping CHECK ((shipping_minor IS NULL) = (shipping_service IS NULL))`,
  `ALTER TABLE orders ADD CONSTRAINT orders_shipping_benefit CHECK (shipping_benefit IS NULL OR shipping_minor = 0)`,
  `ALTER TABLE orders ADD CONSTRAINT orders_with_order CHECK (with_order_id <> id)`,
  `ALTER TABLE orders DROP CONSTRAINT orders_channel_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN (${ORDER_CHANNELS}))`,
  `ALTER TABLE orders DROP CONSTRAINT orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE})`,
  `CREATE INDEX orders_with_order_idx ON orders (with_order_id)`,
  `CREATE INDEX orders_gift_grant_idx ON orders (gift_grant_id)`,
  // One open GIFT order per grant: a cancelled one gives the grant back.
  `CREATE UNIQUE INDEX orders_gift_grant_key ON orders (gift_grant_id) WHERE status <> 'CANCELLED'`,
  `DROP TRIGGER orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...ORDER_IDENTITY_0022, 'with_order_id', 'gift_grant_id'])})`,

  // ── credit_uses ──────────────────────────────────────────────────────────
  `CREATE TABLE credit_uses (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     grant_id        uuid        NOT NULL REFERENCES tier_grants (id) ON DELETE RESTRICT,
     order_id        uuid        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
     amount_minor    integer     NOT NULL CHECK (amount_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     applied_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     applied_at      timestamptz NOT NULL DEFAULT now(),
     released_at     timestamptz NULL,
     released_reason text        NULL CHECK (released_reason IN (${RELEASED_REASONS})),
     released_by     uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     CONSTRAINT credit_uses_released CHECK ((released_at IS NULL) = (released_reason IS NULL)),
     CONSTRAINT credit_uses_released_by CHECK (released_at IS NOT NULL OR released_by IS NULL),
     CONSTRAINT credit_uses_times CHECK (released_at >= applied_at)
   )`,
  `CREATE INDEX credit_uses_grant_idx ON credit_uses (grant_id)`,
  `CREATE INDEX credit_uses_order_idx ON credit_uses (order_id)`,
  `CREATE INDEX credit_uses_applied_by_idx ON credit_uses (applied_by)`,
  `CREATE INDEX credit_uses_released_by_idx ON credit_uses (released_by)`,
  `CREATE UNIQUE INDEX credit_uses_open_key ON credit_uses (grant_id, order_id) WHERE released_at IS NULL`,
  `CREATE TRIGGER credit_uses_immutable BEFORE UPDATE ON credit_uses
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'grant_id', 'order_id', 'amount_minor', 'applied_by', 'applied_at')`,
  `CREATE TRIGGER credit_uses_no_delete BEFORE DELETE ON credit_uses
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a credit taken off an order is released, never deleted')`,
];

export const DOWN: readonly string[] = [
  // The previous image reads neither a GIFT order nor a credit taken off one: refused while any exists.
  `DO $$
   DECLARE gifts bigint; uses bigint;
   BEGIN
     SELECT count(*) INTO gifts FROM orders WHERE channel = 'GIFT';
     SELECT count(*) INTO uses FROM credit_uses;
     IF gifts > 0 OR uses > 0 THEN
       RAISE EXCEPTION 'migration 0027_tier_grants cannot be rolled back: % welcome gift orders and % credit uses exist', gifts, uses;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS credit_uses`,
  `DROP TRIGGER IF EXISTS orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(ORDER_IDENTITY_0022)})`,
  `DROP INDEX IF EXISTS orders_gift_grant_key`,
  `DROP INDEX IF EXISTS orders_gift_grant_idx`,
  `DROP INDEX IF EXISTS orders_with_order_idx`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE_0022})`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN (${ORDER_CHANNELS_0022}))`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_with_order`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_shipping_benefit`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_shipping`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS shipping_benefit`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS shipping_minor`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS shipping_service`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS gift_grant_id`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS with_order_id`,
  `DROP TABLE IF EXISTS tier_grants`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
