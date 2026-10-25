/**
 * 0059 — ADD-ONS ONE SYSTEM (lot Q2, step Q2.1; ANSWERS CURRENT STATE D: "Offered PER ADD-ON (switches: LIVE purchase,
 * draw purchase, salon purchase, YOUR ORDERS until packing) AND PER RELEASE (each release picks which add-ons it
 * offers)." and "Services (engraving, gift wrapping) = catalogue items of a 'no stock' type (price, no stock/supplier/
 * warehouse); engraving keeps its text field."): every add-on is a catalogue item of 0056, a product or a service,
 * offered where its switches and the release's pick say. Additive: the release add-ons (`live_addons`) and the
 * settings' engraving (`engraving_prices`) are converted by 0060, not here.
 *
 * `addon_items` gains:
 *  - `kind` PRODUCT (0056's add-on with real stock, the default: every M3 add-on stays one) or SERVICE (no stock count,
 *    no supplier, no warehouse: `addon_items_service_plain`, a service names no supplier), fixed at its creation (the
 *    identity guard gains `kind`): a product's stock history and a service's absence of stock are never switched;
 *  - the four moments it is offered at, each NOT NULL DEFAULT true (every M3 add-on was offered at all four, and stays):
 *    `offer_live` (a piece held in a LIVE RELEASE, its after-room included), `offer_draw` (a place held in a release
 *    with a draw), `offer_salon` (a request of the private salon), `offer_orders` (YOUR ORDERS, until packing begins);
 *  - `engraving` (DEFAULT false): the add-on whose collector types the words engraved on the piece, a service only
 *    (`addon_items_engraving_service`), at most one offered at a time (`addon_items_engraving_key`, one active row):
 *    an order carries one engraving (`orders.engraving_text`);
 *  - `text_max` (smallint NOT NULL DEFAULT 20, 1 to 20, `addon_items_text_max_check`): the most characters of the
 *    engraving's words, read on the engraving add-on only; 20 is the house's ENGRAVING_COLLECTOR_MAX, its ceiling and
 *    its default, so every add-on of M3 and the converted engraving keep today's 20.
 *
 * `drop_addons`: a release's pick, the add-ons it offers at its purchase moments (a LIVE hold, its after-room, its own
 * drop, and a draw's PLACE HELD), in its order: `drop_id`, `addon_id`, `position` 1 to 100 (no cap beyond it);
 * once per release and add-on (the primary key), once per release and position (`drop_addons_position_key`); its
 * release and add-on never change (identity guard). YOUR ORDERS never reads it: it follows the add-on's ORDERS switch
 * alone, on every order until packing, as M3 does.
 *
 * `addon_choices.text` (NULL; 1 to 120 characters, trimmed, as `orders.engraving_text`): the engraving's words typed
 * before the order exists (on the engraving's choice; the service checks the engraving add-on's own `text_max`).
 *
 * `order_addon_items.location_id` becomes NULL-able: a service's unit is held nowhere. `order_addon_items_kind_guard`
 * (BEFORE INSERT, and BEFORE UPDATE of `location_id`, since a unit's location moves with its order's): a product's unit
 * names a location, a service's names none (raised as a check violation of that name). The view `stock_holds` reads
 * only the units with a location, so a service's unit never holds stock.
 *
 * On the previous image (0058) during the roll-out: it never names the new columns (their defaults apply: a product,
 * offered everywhere, not the engraving, 20), never reads `drop_addons` nor a choice's text, and every unit it writes
 * is a product's with its location. No row is inserted. `down` refuses, naming the counts, while a service, an engraving
 * add-on, a release's pick, a choice's words or a unit without a location exists; otherwise it restores the schema of
 * 0058 exactly (`text_max` dropped with the rest). One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** An add-on's kinds (schema.ts ADDON_KINDS). */
const KINDS = `'PRODUCT','SERVICE'`;
/** A release's pick, its positions at most (schema.ts ADDON_PICK_POSITION_MAX). */
const PICK_POSITION_MAX = 100;
/** The engraving's most characters, its bounds (schema.ts ADDON_TEXT_MAX; 20 = ENGRAVING_COLLECTOR_MAX, the default). */
const TEXT_MAX_MIN = 1;
const TEXT_MAX_MAX = 20;
/** A choice's words, at most (as orders.engraving_text, 0022). */
const WORDS_MAX = 120;

/** The identity guard of 0056, restored by down. */
const ADDON_IDENTITY_0056 = `'id', 'created_at', 'created_by'`;

/** The view of 0056, restored by down. */
const STOCK_HOLDS_0056 = `CREATE VIEW stock_holds AS
   SELECT o.sku_id, o.location_id, o.reservation, o.reserved_at, 'PIECE'::text AS kind, o.id
     FROM orders o
    WHERE o.reservation IS NOT NULL
   UNION ALL
   SELECT u.sku_id, u.location_id, 'STOCK'::text AS reservation, u.added_at AS reserved_at, 'ADD_ON'::text AS kind, u.id
     FROM order_addon_items u
    WHERE u.status = 'HELD'`;

export const UP: readonly string[] = [
  // ── addon_items: a product or a service, its moments, the engraving ─────
  `ALTER TABLE addon_items ADD COLUMN kind text NOT NULL DEFAULT 'PRODUCT' CONSTRAINT addon_items_kind_check CHECK (kind IN (${KINDS}))`,
  `ALTER TABLE addon_items ADD CONSTRAINT addon_items_service_plain CHECK (kind = 'PRODUCT' OR supplier_id IS NULL)`,
  `ALTER TABLE addon_items ADD COLUMN offer_live boolean NOT NULL DEFAULT true`,
  `ALTER TABLE addon_items ADD COLUMN offer_draw boolean NOT NULL DEFAULT true`,
  `ALTER TABLE addon_items ADD COLUMN offer_salon boolean NOT NULL DEFAULT true`,
  `ALTER TABLE addon_items ADD COLUMN offer_orders boolean NOT NULL DEFAULT true`,
  `ALTER TABLE addon_items ADD COLUMN engraving boolean NOT NULL DEFAULT false`,
  `ALTER TABLE addon_items ADD CONSTRAINT addon_items_engraving_service CHECK (NOT engraving OR kind = 'SERVICE')`,
  // At most one engraving offered at a time.
  `CREATE UNIQUE INDEX addon_items_engraving_key ON addon_items ((true)) WHERE engraving AND active`,
  `ALTER TABLE addon_items ADD COLUMN text_max smallint NOT NULL DEFAULT ${TEXT_MAX_MAX} CONSTRAINT addon_items_text_max_check CHECK (text_max BETWEEN ${TEXT_MAX_MIN} AND ${TEXT_MAX_MAX})`,
  // Its kind is fixed at its creation.
  `DROP TRIGGER addon_items_immutable_identity ON addon_items`,
  `CREATE TRIGGER addon_items_immutable_identity BEFORE UPDATE ON addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at', 'created_by', 'kind')`,

  // ── drop_addons: a release's pick ────────────────────────────────────────
  `CREATE TABLE drop_addons (
     drop_id  uuid     NOT NULL CONSTRAINT drop_addons_drop_id_fkey REFERENCES drops (id) ON DELETE RESTRICT,
     addon_id uuid     NOT NULL CONSTRAINT drop_addons_addon_id_fkey REFERENCES addon_items (id) ON DELETE RESTRICT,
     position smallint NOT NULL CONSTRAINT drop_addons_position_check CHECK (position BETWEEN 1 AND ${PICK_POSITION_MAX}),
     CONSTRAINT drop_addons_pkey PRIMARY KEY (drop_id, addon_id),
     CONSTRAINT drop_addons_position_key UNIQUE (drop_id, position)
   )`,
  `CREATE INDEX drop_addons_addon_idx ON drop_addons (addon_id)`,
  `CREATE TRIGGER drop_addons_immutable_identity BEFORE UPDATE ON drop_addons
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('drop_id', 'addon_id')`,

  // ── addon_choices: the engraving's words before the order ────────────────
  `ALTER TABLE addon_choices ADD COLUMN text text NULL CONSTRAINT addon_choices_text_check CHECK (length(text) BETWEEN 1 AND ${WORDS_MAX} AND text = btrim(text))`,

  // ── order_addon_items: a service's unit is held nowhere ──────────────────
  `ALTER TABLE order_addon_items ALTER COLUMN location_id DROP NOT NULL`,
  `CREATE FUNCTION orbes_order_addon_items_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     item_kind text;
   BEGIN
     SELECT kind INTO item_kind FROM addon_items WHERE id = NEW.addon_id;
     IF item_kind = 'SERVICE' AND NEW.location_id IS NOT NULL THEN
       RAISE EXCEPTION 'a service''s unit is held at no location'
         USING ERRCODE = 'check_violation', CONSTRAINT = 'order_addon_items_kind_guard', TABLE = 'order_addon_items';
     END IF;
     IF item_kind = 'PRODUCT' AND NEW.location_id IS NULL THEN
       RAISE EXCEPTION 'a product''s unit names its location'
         USING ERRCODE = 'check_violation', CONSTRAINT = 'order_addon_items_kind_guard', TABLE = 'order_addon_items';
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER order_addon_items_kind_guard BEFORE INSERT OR UPDATE OF location_id ON order_addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_order_addon_items_kind_guard()`,

  // ── stock_holds: a unit without a location holds no stock ────────────────
  `DROP VIEW stock_holds`,
  `CREATE VIEW stock_holds AS
   SELECT o.sku_id, o.location_id, o.reservation, o.reserved_at, 'PIECE'::text AS kind, o.id
     FROM orders o
    WHERE o.reservation IS NOT NULL
   UNION ALL
   SELECT u.sku_id, u.location_id, 'STOCK'::text AS reservation, u.added_at AS reserved_at, 'ADD_ON'::text AS kind, u.id
     FROM order_addon_items u
    WHERE u.status = 'HELD' AND u.location_id IS NOT NULL`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no service, no engraving add-on, no pick, no words before the order and no unit held
  // nowhere: refused while any would be lost.
  `DO $$
   DECLARE services_n bigint; engravings_n bigint; picks_n bigint; texts_n bigint; units_n bigint;
   BEGIN
     SELECT count(*) INTO services_n FROM addon_items WHERE kind = 'SERVICE';
     SELECT count(*) INTO engravings_n FROM addon_items WHERE engraving;
     SELECT count(*) INTO picks_n FROM drop_addons;
     SELECT count(*) INTO texts_n FROM addon_choices WHERE text IS NOT NULL;
     SELECT count(*) INTO units_n FROM order_addon_items WHERE location_id IS NULL;
     IF services_n > 0 OR engravings_n > 0 OR picks_n > 0 OR texts_n > 0 OR units_n > 0 THEN
       RAISE EXCEPTION 'migration 0059_addons_one_system cannot be rolled back: % service add-ons, % engraving add-ons, % add-ons picked by releases, % add-on choices with words and % add-on units without a location exist', services_n, engravings_n, picks_n, texts_n, units_n;
     END IF;
   END $$`,
  `DROP VIEW IF EXISTS stock_holds`,
  STOCK_HOLDS_0056,
  `DROP TRIGGER IF EXISTS order_addon_items_kind_guard ON order_addon_items`,
  `DROP FUNCTION IF EXISTS orbes_order_addon_items_kind_guard()`,
  `ALTER TABLE order_addon_items ALTER COLUMN location_id SET NOT NULL`,
  `ALTER TABLE addon_choices DROP COLUMN IF EXISTS text`,
  `DROP TABLE IF EXISTS drop_addons`,
  `DROP TRIGGER IF EXISTS addon_items_immutable_identity ON addon_items`,
  `CREATE TRIGGER addon_items_immutable_identity BEFORE UPDATE ON addon_items
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${ADDON_IDENTITY_0056})`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS text_max`,
  `DROP INDEX IF EXISTS addon_items_engraving_key`,
  `ALTER TABLE addon_items DROP CONSTRAINT IF EXISTS addon_items_engraving_service`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS engraving`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS offer_orders`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS offer_salon`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS offer_draw`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS offer_live`,
  `ALTER TABLE addon_items DROP CONSTRAINT IF EXISTS addon_items_service_plain`,
  `ALTER TABLE addon_items DROP COLUMN IF EXISTS kind`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
