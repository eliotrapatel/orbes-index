/**
 * 0060 — the release add-ons CONVERTED (lot Q2, step Q2.6; ANSWERS "ADD-ONS, ONE SYSTEM" 22 Oct 16:00–16:02, line 4:
 * "The existing release add-ons: CONVERTED to catalogue items before the field goes."; line 1: "Only the CATALOGUE
 * add-ons (M3, K48) remain … The release add-ons (live_addons, set inside a LIVE release since the first LIVE) GO."):
 * every add-on set inside a LIVE release (`live_addons`, 0021) and the engraving's price of Orders → Settings
 * (`engraving_prices`, 0039) become catalogue add-ons of 0056/0059, then their three tables go. In one transaction, in
 * this order:
 *
 *  1. `up` refuses, naming the count, while a release add-on is chosen on an entry in TURN or SECURED (a LIVE hold under
 *     way): deploy only while no LIVE release runs (the runbook's pre-check reads it first).
 *  2. `addon_conversions`, the record of what was converted, read by Catalogue → Add-ons ("Converted from…") and by
 *     `down`: `source` LIVE_ADDON (a release's add-on: `source_id` its `live_addons.id`, `drop_id` its release) or
 *     ENGRAVING_PRICES (Orders → Settings: neither); `addon_id` the catalogue add-on it became (RESTRICT); `currency`
 *     (its release's, any three capitals, or the settings' house currency) and `price_minor`, the price it gave its
 *     add-on in that currency (NULL: none, its release's currency not a house currency, a newer release's price or the
 *     settings' taken instead); `converted_at`. A record never changes (its guard); a release's are deleted only with
 *     the release itself (an after-room taken away while it is a draft, services/live-console.ts).
 *  3. Each distinct label (`upper(btrim(label))`) of `live_addons` becomes one catalogue add-on: the add-on already of
 *     that name, whatever the case (its kind, line, switches and prices untouched: only the currencies it has no price
 *     in are filled), or a new one (N6): a SERVICE (a release add-on never had stock), its name and line as written in
 *     its newest release (by `opens_at`), after the last, active, offered at a LIVE purchase only, the engraving when
 *     its label holds the word ENGRAVING (the house's rule, services/orders.ts `hasEngravingAddon`) and it is the
 *     newest such label (the others are not; one engraving at a time), its SKU `ADD-<LABEL WORDS>` (capitals and
 *     figures, the rest one hyphen, 64 at most, `-2`, `-3`… until free), no supplier, no weight. An add-on already
 *     named as the newest label holding ENGRAVING (an M3 PRODUCT named ENGRAVING, say) is kept as it is and never made
 *     the engraving (a product cannot be): the releases' ENGRAVING then map to it, and the engraving is only the
 *     settings' new one (5), or none. The runbook's read-only pre-check lists such a name before the deploy.
 *  4. Its prices: in each house currency, the price of the newest release offering it in that currency; a release in
 *     another currency gives none (recorded without a price).
 *  5. The settings' engraving (N4): its prices become the engraving add-on's (they win in their currencies: the house's
 *     standing price, N6), and that add-on is offered in YOUR ORDERS (`offer_orders`), as the setting was sold there;
 *     without an engraving add-on, a new SERVICE `ENGRAVING` (the engraving, YOUR ORDERS only, no line, SKU
 *     `ADD-ENGRAVING`) carries them. One record per currency.
 *  6. The picks (`drop_addons`) of every release not ended and not cancelled (a LIVE release, its after-room, a draw not
 *     drawn yet or within its place-held window), so each keeps offering what it offered (D19): every active catalogue
 *     add-on of M3 first (it was offered in every release), then its converted ones in their old order. Only what its
 *     pick may hold (services/addons.ts `checkPick`, so staff sending the pick again are never refused one): active, its
 *     switch for the release's moment on, and, when the release's currency is a house currency (a draw's only with its
 *     price), priced in it; a converted add-on set aside (an M3 one merged by name) is left out. A release that already
 *     has a pick keeps it and gains its converted ones after it. An ended release needs none: YOUR ORDERS
 *     follows the ORDERS switch alone (N8), so its orders, until packing, are still offered every add-on whose ORDERS
 *     switch is on, the converted Settings ENGRAVING included.
 *  7. The choices of release add-ons still kept (CONFIRMED entries only, after 1; their orders hold them as sold,
 *     `orders.addons`) are deleted, then `live_entry_addons`, `live_addons` and `engraving_prices` are dropped.
 *
 * `orders.addons` (the release add-ons as sold) and `orders.engraving_minor` / `engraving_by` stay as history (N15): old
 * orders, their invoices, credit notes, exchanges and exports read them; no new order writes them.
 *
 * On the previous image during the roll-out: its reads of the three tables (a LIVE hold's add-ons, Orders → Settings'
 * engraving price) fail until the new image serves, which is why the deploy waits for no LIVE release to run. `down`
 * refuses, naming the count, while `addon_conversions` holds a row (what was converted cannot be put back without
 * loss); otherwise it re-creates the three tables, empty, exactly as 0021 and 0039 made them, and drops
 * `addon_conversions`. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** What a conversion was made from (schema.ts ADDON_CONVERSION_SOURCES). */
const SOURCES = `'LIVE_ADDON','ENGRAVING_PRICES'`;
/** The house currencies (schema.ts HOUSE_CURRENCIES). */
const CURRENCIES = `'EUR','GBP','USD','CHF'`;
/** A price, at most, in minor units (schema.ts ADDON_PRICE_MINOR_MAX). */
const PRICE_MAX = 100000000;
/** An add-on's position, at most (schema.ts ADDON_POSITION_MAX). */
const POSITION_MAX = 10000;
/** A release's pick, its positions at most (schema.ts ADDON_PICK_POSITION_MAX). */
const PICK_POSITION_MAX = 100;
/** A SKU's code, at most (skus.code, services/addons.ts ADDON_SKU_CODE_RE). */
const CODE_MAX = 64;

/** A release not ended and not cancelled, as services/addons.ts `releaseNotEnded` reads it. */
const NOT_ENDED = `d.cancelled_at IS NULL AND CASE WHEN d.mode = 'LIVE' THEN d.ended_at IS NULL
     ELSE (d.drawn_at IS NULL OR d.drawn_at + make_interval(hours => d.purchase_window_hours) > now()) END`;

export const UP: readonly string[] = [
  // ── 1. Never during a LIVE hold with a release add-on chosen ─────────────
  `DO $$
   DECLARE held bigint;
   BEGIN
     SELECT count(*) INTO held FROM live_entry_addons x JOIN live_entries e ON e.id = x.entry_id WHERE e.status IN ('TURN', 'SECURED');
     IF held > 0 THEN
       RAISE EXCEPTION 'migration 0060_release_addons_converted cannot be applied: % release add-ons are chosen on entries in TURN or SECURED', held;
     END IF;
   END $$`,

  // ── 2. The record of what was converted ──────────────────────────────────
  `CREATE TABLE addon_conversions (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     source       text        NOT NULL CONSTRAINT addon_conversions_source_check CHECK (source IN (${SOURCES})),
     source_id    uuid        NULL,
     drop_id      uuid        NULL CONSTRAINT addon_conversions_drop_id_fkey REFERENCES drops (id) ON DELETE RESTRICT,
     addon_id     uuid        NOT NULL CONSTRAINT addon_conversions_addon_id_fkey REFERENCES addon_items (id) ON DELETE RESTRICT,
     currency     text        NULL CONSTRAINT addon_conversions_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
     price_minor  integer     NULL CONSTRAINT addon_conversions_price_minor_check CHECK (price_minor BETWEEN 0 AND ${PRICE_MAX}),
     converted_at timestamptz NOT NULL DEFAULT now(),
     -- A release's add-on names it and its release; the settings' engraving neither, and always its currency.
     CONSTRAINT addon_conversions_source_fields CHECK (CASE source
       WHEN 'LIVE_ADDON' THEN source_id IS NOT NULL AND drop_id IS NOT NULL
       ELSE source_id IS NULL AND drop_id IS NULL AND currency IS NOT NULL END),
     -- A price given in a house currency only.
     CONSTRAINT addon_conversions_price CHECK (price_minor IS NULL OR currency IN (${CURRENCIES})),
     CONSTRAINT addon_conversions_source_key UNIQUE (source_id)
   )`,
  `CREATE INDEX addon_conversions_addon_idx ON addon_conversions (addon_id)`,
  `CREATE INDEX addon_conversions_drop_idx ON addon_conversions (drop_id)`,

  // ── 3 to 6. The add-ons, their prices, the settings' engraving, the picks ─
  `DO $$
   DECLARE
     m3 uuid[];
     g record;
     c record;
     r record;
     v_addon uuid;
     v_engraving uuid;
     v_engraving_key text;
     v_position integer;
     v_pick integer;
     v_base text;
     v_code text;
     v_name text;
     v_n integer;
   BEGIN
     -- The catalogue add-ons of M3 offered now, in their order, before any is converted (step 6 picks them first).
     SELECT coalesce(array_agg(id ORDER BY position, lower(name), id), '{}') INTO m3 FROM addon_items WHERE active;
     -- The engraving offered now, if any (one at most, addon_items_engraving_key), and the newest label holding ENGRAVING.
     SELECT id INTO v_engraving FROM addon_items WHERE engraving AND active;
     SELECT upper(btrim(a.label)) INTO v_engraving_key
       FROM live_addons a JOIN drops d ON d.id = a.drop_id
      WHERE upper(a.label) ~ '\\yENGRAVING\\y'
      ORDER BY d.opens_at DESC, d.id DESC, a.position
      LIMIT 1;
     SELECT coalesce(max(position), -1) INTO v_position FROM addon_items;

     -- 3. One catalogue add-on per label, the newest release's label first, in its order.
     FOR g IN
       SELECT * FROM (
         SELECT DISTINCT ON (upper(btrim(a.label))) upper(btrim(a.label)) AS key, btrim(a.label) AS name, btrim(a.line) AS line,
                d.opens_at, d.id AS drop_id, a.position
           FROM live_addons a JOIN drops d ON d.id = a.drop_id
          ORDER BY upper(btrim(a.label)), d.opens_at DESC, d.id DESC, a.position
       ) newest
       ORDER BY opens_at DESC, drop_id DESC, position
     LOOP
       v_addon := NULL;
       SELECT id INTO v_addon FROM addon_items WHERE lower(name) = lower(g.name);
       IF v_addon IS NULL THEN
         v_position := least(v_position + 1, ${POSITION_MAX});
         INSERT INTO addon_items (name, line, position, kind, offer_live, offer_draw, offer_salon, offer_orders, engraving)
         VALUES (g.name, g.line, v_position, 'SERVICE', true, false, false, false, g.key IS NOT DISTINCT FROM v_engraving_key AND v_engraving IS NULL)
         RETURNING id INTO v_addon;
         IF g.key IS NOT DISTINCT FROM v_engraving_key AND v_engraving IS NULL THEN
           v_engraving := v_addon;
         END IF;
         v_base := rtrim(left('ADD-' || coalesce(nullif(btrim(regexp_replace(upper(g.name), '[^A-Z0-9]+', '-', 'g'), '-'), ''), 'ADDON'), ${CODE_MAX}), '-');
         v_code := v_base;
         v_n := 1;
         WHILE EXISTS (SELECT 1 FROM skus k WHERE k.code = v_code) LOOP
           v_n := v_n + 1;
           v_code := rtrim(left(v_base, ${CODE_MAX} - length(v_n::text) - 1), '-') || '-' || v_n;
         END LOOP;
         INSERT INTO skus (addon_id, code) VALUES (v_addon, v_code);
       END IF;
       INSERT INTO addon_conversions (source, source_id, drop_id, addon_id, currency)
       SELECT 'LIVE_ADDON', a.id, a.drop_id, v_addon, d.currency
         FROM live_addons a JOIN drops d ON d.id = a.drop_id
        WHERE upper(btrim(a.label)) = g.key
        ORDER BY d.opens_at, d.id, a.position;
       -- 4. Its price in each house currency: the newest release offering it in that currency's.
       FOR c IN
         SELECT DISTINCT ON (d.currency) a.id, d.currency, a.price_minor
           FROM live_addons a JOIN drops d ON d.id = a.drop_id
          WHERE upper(btrim(a.label)) = g.key AND d.currency IN (${CURRENCIES}) AND a.price_minor <= ${PRICE_MAX}
          ORDER BY d.currency, d.opens_at DESC, d.id DESC, a.position
       LOOP
         INSERT INTO addon_item_prices (addon_id, currency, price_minor) VALUES (v_addon, c.currency, c.price_minor)
         ON CONFLICT (addon_id, currency) DO NOTHING;
         IF FOUND THEN
           UPDATE addon_conversions SET price_minor = c.price_minor WHERE source_id = c.id;
         END IF;
       END LOOP;
     END LOOP;

     -- 5. The settings' engraving: the engraving add-on's prices, winning in their currencies, sold in YOUR ORDERS.
     IF EXISTS (SELECT 1 FROM engraving_prices) THEN
       IF v_engraving IS NULL THEN
         v_name := 'ENGRAVING';
         v_n := 1;
         WHILE EXISTS (SELECT 1 FROM addon_items WHERE lower(name) = lower(v_name)) LOOP
           v_n := v_n + 1;
           v_name := 'ENGRAVING ' || v_n;
         END LOOP;
         v_position := least(v_position + 1, ${POSITION_MAX});
         INSERT INTO addon_items (name, line, position, kind, offer_live, offer_draw, offer_salon, offer_orders, engraving)
         VALUES (v_name, NULL, v_position, 'SERVICE', false, false, false, true, true)
         RETURNING id INTO v_engraving;
         v_code := 'ADD-ENGRAVING';
         v_n := 1;
         WHILE EXISTS (SELECT 1 FROM skus k WHERE k.code = v_code) LOOP
           v_n := v_n + 1;
           v_code := 'ADD-ENGRAVING-' || v_n;
         END LOOP;
         INSERT INTO skus (addon_id, code) VALUES (v_engraving, v_code);
       ELSE
         UPDATE addon_items SET offer_orders = true WHERE id = v_engraving AND NOT offer_orders;
       END IF;
       FOR c IN SELECT currency, price_minor, updated_by FROM engraving_prices ORDER BY currency LOOP
         INSERT INTO addon_item_prices (addon_id, currency, price_minor, updated_by) VALUES (v_engraving, c.currency, c.price_minor, c.updated_by)
         ON CONFLICT (addon_id, currency) DO UPDATE SET price_minor = EXCLUDED.price_minor, updated_by = EXCLUDED.updated_by;
         UPDATE addon_conversions SET price_minor = NULL WHERE source = 'LIVE_ADDON' AND addon_id = v_engraving AND currency = c.currency;
         INSERT INTO addon_conversions (source, addon_id, currency, price_minor) VALUES ('ENGRAVING_PRICES', v_engraving, c.currency, c.price_minor);
       END LOOP;
     END IF;

     -- 6. Every release not ended keeps offering what it offered: M3's add-ons, then its converted ones in their order,
     -- each only as its pick may hold it (active, its moment's switch on, priced in its house currency if it has one).
     FOR r IN
       SELECT d.id, d.mode = 'LIVE' AS live,
              CASE WHEN d.currency IN (${CURRENCIES}) AND (d.mode = 'LIVE' OR d.price_minor IS NOT NULL) THEN d.currency END AS currency
         FROM drops d WHERE ${NOT_ENDED} ORDER BY d.opens_at, d.id
     LOOP
       SELECT coalesce(max(position), 0) INTO v_pick FROM drop_addons WHERE drop_id = r.id;
       IF v_pick = 0 THEN
         INSERT INTO drop_addons (drop_id, addon_id, position)
         SELECT r.id, x.id, x.position
           FROM (
             SELECT a.id, row_number() OVER (ORDER BY m.n) AS position
               FROM unnest(m3) WITH ORDINALITY AS m(id, n) JOIN addon_items a ON a.id = m.id
              WHERE a.active AND CASE WHEN r.live THEN a.offer_live ELSE a.offer_draw END
                AND (r.currency IS NULL OR EXISTS (SELECT 1 FROM addon_item_prices p WHERE p.addon_id = a.id AND p.currency = r.currency))
           ) x
          WHERE x.position <= ${PICK_POSITION_MAX};
         SELECT coalesce(max(position), 0) INTO v_pick FROM drop_addons WHERE drop_id = r.id;
       END IF;
       INSERT INTO drop_addons (drop_id, addon_id, position)
       SELECT r.id, x.addon_id, x.position
         FROM (
           SELECT v.addon_id, v_pick + row_number() OVER (ORDER BY v.first, v.addon_id) AS position
             FROM (
               SELECT c2.addon_id, min(a.position) AS first
                 FROM addon_conversions c2 JOIN live_addons a ON a.id = c2.source_id JOIN addon_items i ON i.id = c2.addon_id
                WHERE c2.drop_id = r.id
                  AND i.active AND CASE WHEN r.live THEN i.offer_live ELSE i.offer_draw END
                  AND (r.currency IS NULL OR EXISTS (SELECT 1 FROM addon_item_prices p WHERE p.addon_id = i.id AND p.currency = r.currency))
                  AND NOT EXISTS (SELECT 1 FROM drop_addons p WHERE p.drop_id = r.id AND p.addon_id = c2.addon_id)
                GROUP BY c2.addon_id
             ) v
         ) x
        WHERE x.position <= ${PICK_POSITION_MAX};
     END LOOP;
   END $$`,

  // A record never changes.
  `CREATE TRIGGER addon_conversions_immutable BEFORE UPDATE ON addon_conversions
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'source', 'source_id', 'drop_id', 'addon_id', 'currency', 'price_minor', 'converted_at')`,

  // ── 7. The release add-ons and the settings' engraving go ────────────────
  `DELETE FROM live_entry_addons`,
  `DROP TABLE live_entry_addons`,
  `DROP TABLE live_addons`,
  `DROP TABLE engraving_prices`,
];

export const DOWN: readonly string[] = [
  // What was converted cannot be put back without loss: refused while a record exists.
  `DO $$
   DECLARE converted bigint;
   BEGIN
     SELECT count(*) INTO converted FROM addon_conversions;
     IF converted > 0 THEN
       RAISE EXCEPTION 'migration 0060_release_addons_converted cannot be rolled back: % add-on conversions exist', converted;
     END IF;
   END $$`,
  // 0021's release add-ons and their choices, empty, exactly as it made them.
  `CREATE TABLE live_addons (
     id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id     uuid     NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     label       text     NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
     line        text     NULL CHECK (length(btrim(line)) BETWEEN 1 AND 120),
     price_minor integer  NOT NULL CHECK (price_minor >= 0),
     position    smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
     CONSTRAINT live_addons_position_key UNIQUE (drop_id, position)
   )`,
  `CREATE TRIGGER live_addons_immutable_identity BEFORE UPDATE ON live_addons
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'drop_id')`,
  `CREATE TABLE live_entry_addons (
     entry_id    uuid    NOT NULL REFERENCES live_entries (id) ON DELETE RESTRICT,
     addon_id    uuid    NOT NULL REFERENCES live_addons (id) ON DELETE RESTRICT,
     price_minor integer NOT NULL CHECK (price_minor >= 0),
     PRIMARY KEY (entry_id, addon_id)
   )`,
  `CREATE INDEX live_entry_addons_addon_idx ON live_entry_addons (addon_id)`,
  // 0039's engraving prices, empty, exactly as it made them.
  `CREATE TABLE engraving_prices (
     currency    text        PRIMARY KEY CHECK (currency IN (${CURRENCIES})),
     price_minor integer     NOT NULL CHECK (price_minor BETWEEN 0 AND ${PRICE_MAX}),
     updated_by  uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX engraving_prices_updated_by_idx ON engraving_prices (updated_by)`,
  `DROP TABLE addon_conversions`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
