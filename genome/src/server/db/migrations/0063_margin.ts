/**
 * 0063 — the margin's settings (macro scope of 2026-10-20, K43 N1 and N2, with THE VAULT's cost D61; lot M4 plan §1.2,
 * step M4.1): what the owner sets so that GROWTH reads each order's landed cost and margin in euros (MarginService,
 * M4.3; Growth → Margin settings, M4.4). The costs the house already holds are read where they are (a supplier order's
 * prices and shipping, a box's cost, a parcel's box and weight); these four tables hold only what nothing else does.
 * The first M4 attempt's 0058_margin, renumbered after ONE QUEUE's 0058–0062, with THE VAULT CARD's unit cost added.
 *
 * `currency_rates`: one euro rate per currency (N2), applied to every amount in that currency at reading time, the whole
 * history included (one rate per currency, never dated).
 *  - `currency` (three capital letters) is the primary key, never changed (`currency_rates_immutable_key`); EUR is 1 and
 *    is never set (`currency_rates_not_eur`);
 *  - `eur_rate` numeric(14,6), above 0 and at most 100 000: one unit of the currency is worth that many euros.
 *
 * `shipping_cost_rates`: what ORBES pays the carrier for a parcel (N1), by its country and weight; a parcel takes the
 * smallest band of its country whose upper limit holds its weight, else of ALL OTHER COUNTRIES. Never a price charged to
 * the buyer (that is `shipping_rates`, 0022), and the same table for every parcel the platform packs, a future Shopify
 * store's included (S3).
 *  - `country` (ISO 3166-1 alpha-2, two capital letters) or NULL for ALL OTHER COUNTRIES;
 *  - `max_weight_g` the band's upper limit (1 to 100 000 g, a parcel's weight at most); one band per country and limit,
 *    ALL OTHER COUNTRIES once per limit too (`shipping_cost_rates_band_key`, on coalesce(country, '*'));
 *  - `cost_minor` (0 to 100 000 000 minor units) and `currency` (three capital letters); its id never changes.
 *
 * `margin_unit_costs`: the owner's unit costs (N1, D61), each by its key: POUCH and CARD (per piece), VAULT_CARD (THE
 * VAULT CARD, per card packed: THE VAULT's cost, D61), CARE_SERVICE (one PRIVATE CARE service done), and CLAIM_<outcome>
 * for each warranty claim outcome of 0048 (schema.ts MARGIN_UNIT_COST_KEYS, held equal to WARRANTY_CLAIM_OUTCOMES by
 * test/db/schema.test.ts); `cost_minor` (0 to 100 000 000) and `currency`; its key never changes.
 *
 * `category_allowances`: the returns and claims allowance of a category (N1), `allowance_bp` in hundredths of a percent
 * of an order's revenue (0 to 10 000, i.e. 0 % to 100 %); one per category (`categories`), its category never changed.
 *
 * Currencies are text with the three-capital-letters CHECK, as every other currency column of the house. Each row
 * carries `updated_by` (the ADMIN who set it last; NULL for a script) and `updated_at` (stamped on every update by
 * `orbes_touch_updated_at`). Every foreign key ON DELETE RESTRICT, at the head of an index, as every other. A rate, a
 * unit cost or an allowance cleared is a row deleted (absent rows read as "not set"); a band removed likewise.
 *
 * On the previous image (0062, lot Q3) during the roll-out: four tables it never reads. No row is inserted: until the
 * owner sets them, the margin lists what is missing. `down` refuses while any row exists, naming the counts; otherwise
 * it drops the four tables: the schema of 0062 exactly. One statement per array entry (PGlite's extended protocol);
 * Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** A euro rate, at most (schema.ts CURRENCY_RATE_MAX), and its scale (schema.ts CURRENCY_RATE_DECIMALS). */
const RATE_MAX = 100000;
/** A band's upper limit, at most, in g: a parcel's weight at most (schema.ts SHIPMENT_WEIGHT_G_MAX). */
const WEIGHT_MAX = 100000;
/** A cost, at most, in minor units (schema.ts MARGIN_COST_MINOR_MAX). */
const COST_MAX = 100000000;
/** An allowance, at most, in hundredths of a percent (schema.ts ALLOWANCE_BP_MAX): 100 %. */
const ALLOWANCE_MAX = 10000;
/**
 * The unit costs' keys (schema.ts MARGIN_UNIT_COST_KEYS): the pouch, the card, THE VAULT CARD, a care service and each
 * claim outcome of 0048.
 */
const UNIT_COST_KEYS = [
  'POUCH', 'CARD', 'VAULT_CARD', 'CARE_SERVICE',
  'CLAIM_REPLACEMENT', 'CLAIM_VALUE_CREDIT', 'CLAIM_PART_CREDIT', 'CLAIM_REPAIR', 'CLAIM_PRICE_REDUCTION', 'CLAIM_REFUND', 'CLAIM_REFUSED',
];
const CURRENCY = `'^[A-Z]{3}$'`;

/** Who set a row last and when (every foreign key at the head of an index, below). */
const stamp = (table: string) => `
     updated_by uuid NULL CONSTRAINT ${table}_updated_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at timestamptz NOT NULL DEFAULT now()`;
/** The author's index, the key's guard and the update's stamp of a table. */
const stamped = (table: string, immutable: string) => [
  `CREATE INDEX ${table}_updated_by_idx ON ${table} (updated_by)`,
  `CREATE TRIGGER ${table}_immutable_key BEFORE UPDATE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${immutable})`,
  `CREATE TRIGGER ${table}_touch_updated_at BEFORE UPDATE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
];

export const UP: readonly string[] = [
  // ── currency_rates ───────────────────────────────────────────────────────
  `CREATE TABLE currency_rates (
     currency   text          PRIMARY KEY CONSTRAINT currency_rates_currency_check CHECK (currency ~ ${CURRENCY}),
     eur_rate   numeric(14,6) NOT NULL CONSTRAINT currency_rates_eur_rate_check CHECK (eur_rate > 0 AND eur_rate <= ${RATE_MAX}),${stamp('currency_rates')},
     CONSTRAINT currency_rates_not_eur CHECK (currency <> 'EUR')
   )`,
  ...stamped('currency_rates', `'currency'`),

  // ── shipping_cost_rates ──────────────────────────────────────────────────
  `CREATE TABLE shipping_cost_rates (
     id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
     country      char(2) NULL CONSTRAINT shipping_cost_rates_country_check CHECK (country ~ '^[A-Z]{2}$'),
     max_weight_g integer NOT NULL CONSTRAINT shipping_cost_rates_max_weight_g_check CHECK (max_weight_g BETWEEN 1 AND ${WEIGHT_MAX}),
     cost_minor   bigint  NOT NULL CONSTRAINT shipping_cost_rates_cost_minor_check CHECK (cost_minor BETWEEN 0 AND ${COST_MAX}),
     currency     text    NOT NULL CONSTRAINT shipping_cost_rates_currency_check CHECK (currency ~ ${CURRENCY}),${stamp('shipping_cost_rates')}
   )`,
  // One band per country and upper limit; ALL OTHER COUNTRIES (NULL) once per limit too.
  `CREATE UNIQUE INDEX shipping_cost_rates_band_key ON shipping_cost_rates ((coalesce(country, '*')), max_weight_g)`,
  ...stamped('shipping_cost_rates', `'id'`),

  // ── margin_unit_costs ────────────────────────────────────────────────────
  `CREATE TABLE margin_unit_costs (
     key        text   PRIMARY KEY CONSTRAINT margin_unit_costs_key_check CHECK (key IN (${UNIT_COST_KEYS.map((k) => `'${k}'`).join(', ')})),
     cost_minor bigint NOT NULL CONSTRAINT margin_unit_costs_cost_minor_check CHECK (cost_minor BETWEEN 0 AND ${COST_MAX}),
     currency   text   NOT NULL CONSTRAINT margin_unit_costs_currency_check CHECK (currency ~ ${CURRENCY}),${stamp('margin_unit_costs')}
   )`,
  ...stamped('margin_unit_costs', `'key'`),

  // ── category_allowances ──────────────────────────────────────────────────
  `CREATE TABLE category_allowances (
     category_id  smallint PRIMARY KEY CONSTRAINT category_allowances_category_id_fkey REFERENCES categories (id) ON DELETE RESTRICT,
     allowance_bp integer  NOT NULL CONSTRAINT category_allowances_allowance_bp_check CHECK (allowance_bp BETWEEN 0 AND ${ALLOWANCE_MAX}),${stamp('category_allowances')}
   )`,
  ...stamped('category_allowances', `'category_id'`),
];

export const DOWN: readonly string[] = [
  // The previous image knows no rate, band, unit cost nor allowance: refused while any would be lost.
  `DO $$
   DECLARE rates_n bigint; bands_n bigint; costs_n bigint; allowances_n bigint;
   BEGIN
     SELECT count(*) INTO rates_n FROM currency_rates;
     SELECT count(*) INTO bands_n FROM shipping_cost_rates;
     SELECT count(*) INTO costs_n FROM margin_unit_costs;
     SELECT count(*) INTO allowances_n FROM category_allowances;
     IF rates_n > 0 OR bands_n > 0 OR costs_n > 0 OR allowances_n > 0 THEN
       RAISE EXCEPTION 'migration 0063_margin cannot be rolled back: % currency rates, % shipping cost bands, % unit costs and % category allowances exist', rates_n, bands_n, costs_n, allowances_n;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS category_allowances`,
  `DROP TABLE IF EXISTS margin_unit_costs`,
  `DROP TABLE IF EXISTS shipping_cost_rates`,
  `DROP TABLE IF EXISTS currency_rates`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
