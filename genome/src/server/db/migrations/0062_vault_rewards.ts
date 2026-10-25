/**
 * 0062 — THE VAULT's rewards (lot Q3, step Q3.2; plan §1.2, §1.3; vault/SCOPE.md E7 "credits in YOUR ACCOUNT, products
 * in YOUR ORDERS", E8 "A product won free: … claimed within 30 days or back to stock", round 2 "Right to buy: 24 HOURS,
 * at its usual price", "House credit: … (30 days)", "Guaranteed piece: AT THE NEXT LIVE RELEASE, ANY MODEL"): the links
 * from a vault into the systems that deliver what it held (D19, D20, D29), each reward through the house's existing
 * system (S E7, E8).
 *
 * `tier_grants` takes a vault's credits as kind VAULT, following 0045's BIRTHDAY and 0048's WARRANTY:
 * `tier_grants_kind_check` gains VAULT; `tier_grants_birthday` gives a VAULT grant no tier (and no birthday);
 * `tier_grants_credit` holds the amount, currency and expiry on it. `vault_id` (the vault it came from: a house credit
 * won, or, on the friend's account, the vault whose credit to give they accepted) is on a VAULT grant and only there
 * (`tier_grants_vault`), once per vault (`tier_grants_vault_key`: a delivery run twice never gives two);
 * `usable_while_no_piece` (DEFAULT false) is true only on a VAULT grant (the credit given to a friend, "a credit for a
 * friend's first piece", N10). The guard gains both. `tier_grants_once`, `credit_uses` and the expiry are unchanged.
 *
 * `orders.channel` gains VAULT (a product won free, a VAULT EDITION, THE PIECE, or a product bought under its right to
 * buy), with `vault_id` on a VAULT order and only there, no release, no shop request, travelling with no order, piece 1
 * (`orders_source` rebuilt, as 0027 did for GIFT); every VAULT order names its SKU and its price (`orders_vault`: 0 when
 * won free, the product's usual price under a right to buy); a VAULT order at 0 carries `claim_by` (its 30 days to be
 * claimed, D20) and only it, and holds the unit reserved for the winner at the opening (never AWAITING, STOCK while
 * RESERVED, N12) — its SKU may change at the claim to a size with stock (`sku_id` is not of the identity), so a size
 * sold out elsewhere after the win never takes the winner's unit. One open VAULT order per vault (`orders_vault_key`,
 * its CANCELLED ones aside, as `orders_gift_grant_key`). The identity guard gains `vault_id`.
 *
 * `house_guarantees.scope` gains LIVE ("a guaranteed piece at the next LIVE release, any model", OP-22, N13), with
 * `vault_id` on a LIVE guarantee and only there and no release, model or collection named (`house_guarantees_scope`),
 * once per vault (`house_guarantees_vault_key`). The guard gains `vault_id`.
 *
 * `order_addon_items.added_by_type` (a unit's source) gains VAULT (the vault's free add-on, Q2 HANDOVER "a unit at price 0
 * with its own source"), with `vault_id` on a VAULT unit and only there, at price 0 (`order_addon_items_vault`), no one
 * named (`order_addon_items_added_by`); one unit not removed nor cancelled per vault (`order_addon_items_vault_key`). The
 * guard gains `vault_id`.
 *
 * `vault_gifts` (CREDIT TO GIVE, N10): the vault it came from (`vault_id`, once), the one-time code's HMAC-SHA256
 * (`code_hash`, 32 bytes, unique: the code itself is never stored), the credit's amount and currency, `created_at` and
 * `expires_at` = `created_at` + 30 days of 24 hours (`vault_gifts_expiry`); `accepted_by`, `accepted_at` and `grant_id`
 * (the friend's VAULT credit, once) all three or none, set once (`vault_gifts_accepted_once`); its identity never
 * changes; never deleted. Accepting writes nothing else: never `accounts.invited_by` (the FRIEND source stays the
 * personal invitation link's alone; the service's rule).
 *
 * `vaults` gains the link to its gift (`gift_id`, set once, as 0061's links), and its offer: `offer_until` (a RIGHT TO
 * BUY's 24 h, or a free add-on's 30 days to be used on an order; written with the outcome at the opening, on an ADDON
 * or PRODUCT reward only, after the opening) and `offer_used_at` (within it, set once) (`vaults_offer`). An unopened
 * vault has neither, nor a gift (`vaults_outcome` rebuilt); `orbes_vaults_guard` replaced with `offer_until` in the
 * outcome written once and the gift's link and the offer's use set once.
 *
 * Every foreign key leads an index, ON DELETE RESTRICT. On the previous image (0061, Q3.1) during the roll-out: columns
 * with defaults or nullable it never names, a table it never reads, and no VAULT grant, order, guarantee or unit until
 * this image adds one; it reads its credits filtered by kind, so a VAULT grant is invisible to it. No row is inserted.
 * `down` refuses, naming the counts, while any VAULT grant, VAULT order, LIVE guarantee, VAULT unit, vault gift or vault
 * offer exists; otherwise it restores 0061's guard, 0061's `vaults_outcome`, 0056's units' checks and guard, 0029's
 * scopes and guard, 0037's channels and `orders_source`, 0057's order guard and 0048's grants' checks and 0045's guard:
 * the schema of 0061 exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they
// match schema.ts.
/** tier_grants.kind (schema.ts TIER_GRANT_KINDS), before (0048) and since. */
const GRANT_KINDS_0048 = `'GIFT','CREDIT','BIRTHDAY','WARRANTY'`;
const GRANT_KINDS = `'GIFT','CREDIT','BIRTHDAY','WARRANTY','VAULT'`;
/** orders.channel (schema.ts ORDER_CHANNELS), before (0037) and since. */
const CHANNELS_0037 = `'LIVE','DRAW','SALON','GIFT','EXCHANGE'`;
const CHANNELS = `'LIVE','DRAW','SALON','GIFT','EXCHANGE','VAULT'`;
/** house_guarantees.scope (schema.ts GUARANTEE_SCOPES), before (0029) and since. */
const SCOPES_0029 = `'RELEASE','MODEL','COLLECTION'`;
const SCOPES = `'RELEASE','MODEL','COLLECTION','LIVE'`;
/** order_addon_items.added_by_type (schema.ts ORDER_ADDON_ADDED_BY), before (0056) and since. */
const ADDED_BY_0056 = `'PURCHASE','COLLECTOR','STAFF'`;
const ADDED_BY = `'PURCHASE','COLLECTOR','STAFF','VAULT'`;

/** An amount, as an order's (0022). */
const AMOUNT_MAX = 100_000_000;
/** A credit to give's validity, from its creation at the opening (schema.ts VAULT_GIFT_DAYS). */
const GIFT_DAYS = 30;
/** The one-time code's HMAC-SHA256 (schema.ts VAULT_GIFT_CODE_HASH_BYTES). */
const CODE_HASH_BYTES = 32;

const quoted = (cols: readonly string[]) => cols.map((c) => `'${c}'`).join(', ');

// ── tier_grants ───────────────────────────────────────────────────────────
/** The guard as 0045 rebuilt it (0027's columns and `birthday_on`; 0048 left it). */
const GRANT_IDENTITY_0045 = ['id', 'account_id', 'tier', 'kind', 'granted_at', 'amount_minor', 'currency', 'expires_at', 'birthday_on'];
/** tier_grants' two constraints as 0048 wrote them. */
const BIRTHDAY_0048 = `(kind IN ('BIRTHDAY', 'WARRANTY')) = (tier IS NULL) AND (kind = 'BIRTHDAY') = (birthday_on IS NOT NULL)`;
const CREDIT_0048 = `(kind IN ('CREDIT', 'BIRTHDAY', 'WARRANTY')) = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)`;
/** With VAULT: no tier (and no birthday); an amount, currency and expiry. */
const BIRTHDAY = `(kind IN ('BIRTHDAY', 'WARRANTY', 'VAULT')) = (tier IS NULL) AND (kind = 'BIRTHDAY') = (birthday_on IS NOT NULL)`;
const CREDIT = `(kind IN ('CREDIT', 'BIRTHDAY', 'WARRANTY', 'VAULT')) = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)`;

// ── orders ────────────────────────────────────────────────────────────────
/** The order's identity as 0057 rebuilt it. */
const ORDER_IDENTITY_0057 = [
  'id', 'channel', 'live_entry_id', 'piece', 'drop_entry_id', 'shop_request_id', 'drop_id', 'account_id', 'model_id', 'reserved_at',
  'with_order_id', 'gift_grant_id', 'exchange_of_order_id', 'set_sale_id', 'set_piece',
];
/** orders_source as 0037 wrote it. */
const SOURCE_0037 = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel = 'EXCHANGE' OR (channel IN ('SALON', 'GIFT')) = (drop_id IS NULL))
       AND (channel IN ('LIVE', 'DRAW') OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)
       AND (channel = 'EXCHANGE') = (exchange_of_order_id IS NOT NULL)`;
/** orders_source with VAULT: its vault, no release, travelling with no order (piece 1 as every channel but LIVE and DRAW). */
const SOURCE = `(channel = 'LIVE') = (live_entry_id IS NOT NULL) AND (channel = 'DRAW') = (drop_entry_id IS NOT NULL)
       AND (channel = 'SALON') = (shop_request_id IS NOT NULL) AND (channel = 'EXCHANGE' OR (channel IN ('SALON', 'GIFT', 'VAULT')) = (drop_id IS NULL))
       AND (channel IN ('LIVE', 'DRAW') OR piece = 1)
       AND (channel = 'GIFT') = (gift_grant_id IS NOT NULL) AND (channel <> 'GIFT' OR with_order_id IS NOT NULL)
       AND (channel = 'EXCHANGE') = (exchange_of_order_id IS NOT NULL)
       AND (channel = 'VAULT') = (vault_id IS NOT NULL) AND (channel <> 'VAULT' OR with_order_id IS NULL)`;
/** A VAULT order at 0: won free (D20, N12). */
const VAULT_FREE = `channel = 'VAULT' AND coalesce(price_minor = 0, false)`;

// ── house_guarantees ──────────────────────────────────────────────────────
/** The guarantee's identity as 0029 wrote it. */
const GUARANTEE_IDENTITY_0029 = ['id', 'account_id', 'scope', 'drop_id', 'model_id', 'collection_id', 'granted_by', 'granted_at'];
/** house_guarantees_scope as 0029 wrote it, and with LIVE: its vault, nothing else named. */
const SCOPE_0029 = `(scope = 'RELEASE') = (drop_id IS NOT NULL) AND (scope = 'MODEL') = (model_id IS NOT NULL) AND (scope = 'COLLECTION') = (collection_id IS NOT NULL)`;
const SCOPE = `${SCOPE_0029} AND (scope = 'LIVE') = (vault_id IS NOT NULL)`;

// ── order_addon_items ─────────────────────────────────────────────────────
/** The unit's identity as 0056 wrote it. */
const UNIT_IDENTITY_0056 = ['id', 'order_id', 'addon_id', 'sku_id', 'price_minor', 'currency', 'added_at', 'added_by_type', 'added_by'];
/** order_addon_items_added_by as 0056 wrote it, and with VAULT: no one named. */
const ADDED_BY_SHAPE_0056 = `CASE added_by_type
       WHEN 'PURCHASE' THEN added_by IS NULL
       WHEN 'COLLECTOR' THEN added_by IS NOT NULL
       ELSE true END`;
const ADDED_BY_SHAPE = `CASE added_by_type
       WHEN 'PURCHASE' THEN added_by IS NULL
       WHEN 'COLLECTOR' THEN added_by IS NOT NULL
       WHEN 'VAULT' THEN added_by IS NULL
       ELSE true END`;

// ── vaults ────────────────────────────────────────────────────────────────
/** The outcome, written once at the opening: 0061's, and since this migration its offer's end. */
const OUTCOME_0061 = ['opened_at', 'reward_id', 'reward_kind', 'prize', 'prize_line', 'odds_text', 'rare', 'value_minor', 'currency', 'cost_minor'];
const OUTCOME = [...OUTCOME_0061, 'offer_until'];
const row = (prefix: string, columns: readonly string[]) => `ROW(${columns.map((c) => `${prefix}.${c}`).join(', ')})`;
/** vaults_outcome as 0061 wrote it, and with the gift and the offer: none before the opening. */
const VAULT_OUTCOME_0061 = `(opened_at IS NULL) = (reward_id IS NULL) AND (opened_at IS NULL) = (reward_kind IS NULL) AND (opened_at IS NULL) = (prize IS NULL)
       AND (opened_at IS NULL) = (odds_text IS NULL) AND (opened_at IS NULL) = (rare IS NULL)
       AND (value_minor IS NULL) = (currency IS NULL)
       AND (opened_at IS NOT NULL OR (prize_line IS NULL AND value_minor IS NULL AND cost_minor IS NULL AND grant_id IS NULL AND order_id IS NULL AND guarantee_id IS NULL))`;
const VAULT_OUTCOME = `(opened_at IS NULL) = (reward_id IS NULL) AND (opened_at IS NULL) = (reward_kind IS NULL) AND (opened_at IS NULL) = (prize IS NULL)
       AND (opened_at IS NULL) = (odds_text IS NULL) AND (opened_at IS NULL) = (rare IS NULL)
       AND (value_minor IS NULL) = (currency IS NULL)
       AND (opened_at IS NOT NULL OR (prize_line IS NULL AND value_minor IS NULL AND cost_minor IS NULL AND grant_id IS NULL AND order_id IS NULL AND guarantee_id IS NULL
         AND gift_id IS NULL AND offer_until IS NULL AND offer_used_at IS NULL))`;

/** orbes_vaults_guard as 0061 wrote it (restored by down). */
const VAULTS_GUARD_0061 = `CREATE OR REPLACE FUNCTION orbes_vaults_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF OLD.opened_at IS NOT NULL AND ${row('NEW', OUTCOME_0061)} IS DISTINCT FROM ${row('OLD', OUTCOME_0061)} THEN
       RAISE EXCEPTION 'a vault''s outcome is written once, at its opening' USING ERRCODE = 'OR001';
     END IF;
     IF OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at, NEW.revoked_reason) IS DISTINCT FROM ROW(OLD.revoked_at, OLD.revoked_reason) THEN
       RAISE EXCEPTION 'a vault taken back stays taken back' USING ERRCODE = 'OR001';
     END IF;
     IF (OLD.grant_id IS NOT NULL AND NEW.grant_id IS DISTINCT FROM OLD.grant_id)
        OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
        OR (OLD.guarantee_id IS NOT NULL AND NEW.guarantee_id IS DISTINCT FROM OLD.guarantee_id) THEN
       RAISE EXCEPTION 'what a vault gave is linked once' USING ERRCODE = 'OR001';
     END IF;
     RETURN NEW;
   END $$`;
/** With the offer's end in the outcome, the gift's link set once and the offer used once. */
const VAULTS_GUARD = `CREATE OR REPLACE FUNCTION orbes_vaults_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF OLD.opened_at IS NOT NULL AND ${row('NEW', OUTCOME)} IS DISTINCT FROM ${row('OLD', OUTCOME)} THEN
       RAISE EXCEPTION 'a vault''s outcome is written once, at its opening' USING ERRCODE = 'OR001';
     END IF;
     IF OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at, NEW.revoked_reason) IS DISTINCT FROM ROW(OLD.revoked_at, OLD.revoked_reason) THEN
       RAISE EXCEPTION 'a vault taken back stays taken back' USING ERRCODE = 'OR001';
     END IF;
     IF (OLD.grant_id IS NOT NULL AND NEW.grant_id IS DISTINCT FROM OLD.grant_id)
        OR (OLD.order_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM OLD.order_id)
        OR (OLD.guarantee_id IS NOT NULL AND NEW.guarantee_id IS DISTINCT FROM OLD.guarantee_id)
        OR (OLD.gift_id IS NOT NULL AND NEW.gift_id IS DISTINCT FROM OLD.gift_id) THEN
       RAISE EXCEPTION 'what a vault gave is linked once' USING ERRCODE = 'OR001';
     END IF;
     IF OLD.offer_used_at IS NOT NULL AND NEW.offer_used_at IS DISTINCT FROM OLD.offer_used_at THEN
       RAISE EXCEPTION 'a vault''s offer is used once' USING ERRCODE = 'OR001';
     END IF;
     RETURN NEW;
   END $$`;

/** A gift's identity: its vault, its code, its credit and its time. */
const GIFT_IDENTITY = ['id', 'vault_id', 'code_hash', 'amount_minor', 'currency', 'created_at', 'expires_at'];

export const UP: readonly string[] = [
  // ── tier_grants: a vault's credits ──────────────────────────────────────
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_kind_check`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_kind_check CHECK (kind IN (${GRANT_KINDS}))`,
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_birthday`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_birthday CHECK (${BIRTHDAY})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_credit`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_credit CHECK (${CREDIT})`,
  `ALTER TABLE tier_grants ADD COLUMN vault_id uuid NULL CONSTRAINT tier_grants_vault_id_fkey REFERENCES vaults (id) ON DELETE RESTRICT`,
  `ALTER TABLE tier_grants ADD COLUMN usable_while_no_piece boolean NOT NULL DEFAULT false`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_vault CHECK ((kind = 'VAULT') = (vault_id IS NOT NULL) AND (NOT usable_while_no_piece OR kind = 'VAULT'))`,
  // One credit per vault: a delivery run twice gives one.
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_vault_key UNIQUE (vault_id)`,
  `DROP TRIGGER tier_grants_immutable ON tier_grants`,
  `CREATE TRIGGER tier_grants_immutable BEFORE UPDATE ON tier_grants
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...GRANT_IDENTITY_0045, 'vault_id', 'usable_while_no_piece'])})`,

  // ── orders: a product from the vault ────────────────────────────────────
  `ALTER TABLE orders ADD COLUMN vault_id uuid NULL CONSTRAINT orders_vault_id_fkey REFERENCES vaults (id) ON DELETE RESTRICT`,
  `ALTER TABLE orders ADD COLUMN claim_by timestamptz NULL`,
  `ALTER TABLE orders DROP CONSTRAINT orders_channel_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN (${CHANNELS}))`,
  `ALTER TABLE orders DROP CONSTRAINT orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE})`,
  // Its SKU and price; won free: 30 days to claim it and the unit reserved for the winner, never waiting for stock.
  `ALTER TABLE orders ADD CONSTRAINT orders_vault CHECK (
       (channel <> 'VAULT' OR (sku_id IS NOT NULL AND price_minor IS NOT NULL))
       AND (${VAULT_FREE}) = (claim_by IS NOT NULL) AND claim_by > reserved_at
       AND (NOT (${VAULT_FREE}) OR (reservation IS DISTINCT FROM 'AWAITING' AND (status <> 'RESERVED' OR reservation IS NOT DISTINCT FROM 'STOCK'))))`,
  `CREATE INDEX orders_vault_idx ON orders (vault_id)`,
  // One open VAULT order per vault: a cancelled one aside.
  `CREATE UNIQUE INDEX orders_vault_key ON orders (vault_id) WHERE status <> 'CANCELLED'`,
  `DROP TRIGGER orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...ORDER_IDENTITY_0057, 'vault_id'])})`,

  // ── house_guarantees: a piece at the next LIVE release ──────────────────
  `ALTER TABLE house_guarantees ADD COLUMN vault_id uuid NULL CONSTRAINT house_guarantees_vault_id_fkey REFERENCES vaults (id) ON DELETE RESTRICT`,
  `ALTER TABLE house_guarantees DROP CONSTRAINT house_guarantees_scope_check`,
  `ALTER TABLE house_guarantees ADD CONSTRAINT house_guarantees_scope_check CHECK (scope IN (${SCOPES}))`,
  `ALTER TABLE house_guarantees DROP CONSTRAINT house_guarantees_scope`,
  `ALTER TABLE house_guarantees ADD CONSTRAINT house_guarantees_scope CHECK (${SCOPE})`,
  `ALTER TABLE house_guarantees ADD CONSTRAINT house_guarantees_vault_key UNIQUE (vault_id)`,
  `DROP TRIGGER house_guarantees_immutable ON house_guarantees`,
  `CREATE TRIGGER house_guarantees_immutable BEFORE UPDATE ON house_guarantees
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...GUARANTEE_IDENTITY_0029, 'vault_id'])})`,

  // ── order_addon_items: the vault's free add-on ──────────────────────────
  `ALTER TABLE order_addon_items ADD COLUMN vault_id uuid NULL CONSTRAINT order_addon_items_vault_id_fkey REFERENCES vaults (id) ON DELETE RESTRICT`,
  `ALTER TABLE order_addon_items DROP CONSTRAINT order_addon_items_added_by_type_check`,
  `ALTER TABLE order_addon_items ADD CONSTRAINT order_addon_items_added_by_type_check CHECK (added_by_type IN (${ADDED_BY}))`,
  `ALTER TABLE order_addon_items DROP CONSTRAINT order_addon_items_added_by`,
  `ALTER TABLE order_addon_items ADD CONSTRAINT order_addon_items_added_by CHECK (${ADDED_BY_SHAPE})`,
  `ALTER TABLE order_addon_items ADD CONSTRAINT order_addon_items_vault CHECK ((added_by_type = 'VAULT') = (vault_id IS NOT NULL) AND (added_by_type <> 'VAULT' OR price_minor = 0))`,
  `CREATE INDEX order_addon_items_vault_idx ON order_addon_items (vault_id)`,
  // One unit per vault, a removed or cancelled one aside.
  `CREATE UNIQUE INDEX order_addon_items_vault_key ON order_addon_items (vault_id) WHERE status IN ('HELD', 'SHIPPED', 'RETURNED')`,
  `DROP TRIGGER order_addon_items_immutable_identity ON order_addon_items`,
  `CREATE TRIGGER order_addon_items_immutable_identity BEFORE UPDATE ON order_addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...UNIT_IDENTITY_0056, 'vault_id'])})`,

  // ── vault_gifts: a credit to give ───────────────────────────────────────
  `CREATE TABLE vault_gifts (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     vault_id     uuid        NOT NULL REFERENCES vaults (id) ON DELETE RESTRICT,
     code_hash    bytea       NOT NULL CONSTRAINT vault_gifts_code_hash_check CHECK (octet_length(code_hash) = ${CODE_HASH_BYTES}),
     amount_minor integer     NOT NULL CONSTRAINT vault_gifts_amount_minor_check CHECK (amount_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     currency     text        NOT NULL CONSTRAINT vault_gifts_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
     created_at   timestamptz NOT NULL DEFAULT now(),
     expires_at   timestamptz NOT NULL,
     accepted_by  uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     accepted_at  timestamptz NULL,
     grant_id     uuid        NULL REFERENCES tier_grants (id) ON DELETE RESTRICT,
     CONSTRAINT vault_gifts_vault_key UNIQUE (vault_id),
     CONSTRAINT vault_gifts_code_hash_key UNIQUE (code_hash),
     CONSTRAINT vault_gifts_grant_key UNIQUE (grant_id),
     CONSTRAINT vault_gifts_expiry CHECK (expires_at = created_at + interval '${GIFT_DAYS * 24} hours'),
     CONSTRAINT vault_gifts_accepted CHECK ((accepted_by IS NULL) = (accepted_at IS NULL) AND (accepted_by IS NULL) = (grant_id IS NULL) AND accepted_at >= created_at)
   )`,
  `CREATE INDEX vault_gifts_accepted_by_idx ON vault_gifts (accepted_by)`,
  `CREATE TRIGGER vault_gifts_immutable_identity BEFORE UPDATE ON vault_gifts
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(GIFT_IDENTITY)})`,
  `CREATE TRIGGER vault_gifts_accepted_once BEFORE UPDATE OF accepted_by, accepted_at, grant_id ON vault_gifts
     FOR EACH ROW WHEN (OLD.accepted_by IS NOT NULL AND ROW(NEW.accepted_by, NEW.accepted_at, NEW.grant_id) IS DISTINCT FROM ROW(OLD.accepted_by, OLD.accepted_at, OLD.grant_id))
     EXECUTE FUNCTION orbes_reject_mutation('a credit to give is accepted once')`,
  `CREATE TRIGGER vault_gifts_no_delete BEFORE DELETE ON vault_gifts
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a credit to give is never deleted')`,

  // ── vaults: its gift and its offer ──────────────────────────────────────
  `ALTER TABLE vaults ADD COLUMN gift_id uuid NULL CONSTRAINT vaults_gift_id_fkey REFERENCES vault_gifts (id) ON DELETE RESTRICT`,
  `ALTER TABLE vaults ADD COLUMN offer_until timestamptz NULL`,
  `ALTER TABLE vaults ADD COLUMN offer_used_at timestamptz NULL`,
  `CREATE INDEX vaults_gift_idx ON vaults (gift_id)`,
  `ALTER TABLE vaults DROP CONSTRAINT vaults_outcome`,
  `ALTER TABLE vaults ADD CONSTRAINT vaults_outcome CHECK (
       ${VAULT_OUTCOME})`,
  // A RIGHT TO BUY's 24 h or a free add-on's 30 days, from the opening, on those rewards only; used within it.
  `ALTER TABLE vaults ADD CONSTRAINT vaults_offer CHECK (
       (offer_until IS NULL OR coalesce(reward_kind IN ('ADDON', 'PRODUCT') AND offer_until > opened_at, false))
       AND (offer_used_at IS NULL OR coalesce(offer_used_at >= opened_at AND offer_used_at <= offer_until, false)))`,
  VAULTS_GUARD,
];

export const DOWN: readonly string[] = [
  // The previous image knows none of the rewards' links: refused while any exists.
  `DO $$
   DECLARE grants_n bigint; orders_n bigint; guarantees_n bigint; units_n bigint; gifts_n bigint; offers_n bigint;
   BEGIN
     SELECT count(*) INTO grants_n FROM tier_grants WHERE kind = 'VAULT';
     SELECT count(*) INTO orders_n FROM orders WHERE channel = 'VAULT';
     SELECT count(*) INTO guarantees_n FROM house_guarantees WHERE scope = 'LIVE';
     SELECT count(*) INTO units_n FROM order_addon_items WHERE added_by_type = 'VAULT';
     SELECT count(*) INTO gifts_n FROM vault_gifts;
     SELECT count(*) INTO offers_n FROM vaults WHERE offer_until IS NOT NULL;
     IF grants_n > 0 OR orders_n > 0 OR guarantees_n > 0 OR units_n > 0 OR gifts_n > 0 OR offers_n > 0 THEN
       RAISE EXCEPTION 'migration 0062_vault_rewards cannot be rolled back: % vault credits, % vault orders, % LIVE guarantees, % vault add-on units, % credits to give and % vault offers exist', grants_n, orders_n, guarantees_n, units_n, gifts_n, offers_n;
     END IF;
   END $$`,
  // ── vaults ──────────────────────────────────────────────────────────────
  VAULTS_GUARD_0061,
  `ALTER TABLE vaults DROP CONSTRAINT IF EXISTS vaults_offer`,
  `ALTER TABLE vaults DROP CONSTRAINT IF EXISTS vaults_outcome`,
  `ALTER TABLE vaults ADD CONSTRAINT vaults_outcome CHECK (
       ${VAULT_OUTCOME_0061})`,
  `DROP INDEX IF EXISTS vaults_gift_idx`,
  `ALTER TABLE vaults DROP COLUMN IF EXISTS offer_used_at`,
  `ALTER TABLE vaults DROP COLUMN IF EXISTS offer_until`,
  `ALTER TABLE vaults DROP COLUMN IF EXISTS gift_id`,
  // ── vault_gifts ─────────────────────────────────────────────────────────
  `DROP TABLE IF EXISTS vault_gifts`,
  // ── order_addon_items ───────────────────────────────────────────────────
  `DROP TRIGGER IF EXISTS order_addon_items_immutable_identity ON order_addon_items`,
  `CREATE TRIGGER order_addon_items_immutable_identity BEFORE UPDATE ON order_addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(UNIT_IDENTITY_0056)})`,
  `DROP INDEX IF EXISTS order_addon_items_vault_key`,
  `DROP INDEX IF EXISTS order_addon_items_vault_idx`,
  `ALTER TABLE order_addon_items DROP CONSTRAINT IF EXISTS order_addon_items_vault`,
  `ALTER TABLE order_addon_items DROP CONSTRAINT IF EXISTS order_addon_items_added_by`,
  `ALTER TABLE order_addon_items ADD CONSTRAINT order_addon_items_added_by CHECK (${ADDED_BY_SHAPE_0056})`,
  `ALTER TABLE order_addon_items DROP CONSTRAINT IF EXISTS order_addon_items_added_by_type_check`,
  `ALTER TABLE order_addon_items ADD CONSTRAINT order_addon_items_added_by_type_check CHECK (added_by_type IN (${ADDED_BY_0056}))`,
  `ALTER TABLE order_addon_items DROP COLUMN IF EXISTS vault_id`,
  // ── house_guarantees ────────────────────────────────────────────────────
  `DROP TRIGGER IF EXISTS house_guarantees_immutable ON house_guarantees`,
  `CREATE TRIGGER house_guarantees_immutable BEFORE UPDATE ON house_guarantees
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(GUARANTEE_IDENTITY_0029)})`,
  `ALTER TABLE house_guarantees DROP CONSTRAINT IF EXISTS house_guarantees_vault_key`,
  `ALTER TABLE house_guarantees DROP CONSTRAINT IF EXISTS house_guarantees_scope`,
  `ALTER TABLE house_guarantees ADD CONSTRAINT house_guarantees_scope CHECK (${SCOPE_0029})`,
  `ALTER TABLE house_guarantees DROP CONSTRAINT IF EXISTS house_guarantees_scope_check`,
  `ALTER TABLE house_guarantees ADD CONSTRAINT house_guarantees_scope_check CHECK (scope IN (${SCOPES_0029}))`,
  `ALTER TABLE house_guarantees DROP COLUMN IF EXISTS vault_id`,
  // ── orders ──────────────────────────────────────────────────────────────
  `DROP TRIGGER IF EXISTS orders_immutable_identity ON orders`,
  `CREATE TRIGGER orders_immutable_identity BEFORE UPDATE ON orders
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(ORDER_IDENTITY_0057)})`,
  `DROP INDEX IF EXISTS orders_vault_key`,
  `DROP INDEX IF EXISTS orders_vault_idx`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_vault`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source`,
  `ALTER TABLE orders ADD CONSTRAINT orders_source CHECK (${SOURCE_0037})`,
  `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check`,
  `ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN (${CHANNELS_0037}))`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS claim_by`,
  `ALTER TABLE orders DROP COLUMN IF EXISTS vault_id`,
  // ── tier_grants ─────────────────────────────────────────────────────────
  `DROP TRIGGER IF EXISTS tier_grants_immutable ON tier_grants`,
  `CREATE TRIGGER tier_grants_immutable BEFORE UPDATE ON tier_grants
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(GRANT_IDENTITY_0045)})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_vault_key`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_vault`,
  `ALTER TABLE tier_grants DROP COLUMN IF EXISTS usable_while_no_piece`,
  `ALTER TABLE tier_grants DROP COLUMN IF EXISTS vault_id`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_credit`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_credit CHECK (${CREDIT_0048})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_birthday`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_birthday CHECK (${BIRTHDAY_0048})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_kind_check`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_kind_check CHECK (kind IN (${GRANT_KINDS_0048}))`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
