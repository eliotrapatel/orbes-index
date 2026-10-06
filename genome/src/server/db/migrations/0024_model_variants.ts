/**
 * 0024 — the variants of a model and a draw's price (plan NOCTURNE of 2026-10-05, step N1: « Variants », the owner's
 * decision « it's more like variants », and the owner's addition 5, the price shown on draws).
 *
 * A model can have variants, like a product's variants in a shop: MONOLITHE in steel, in gold, in blue. A variant IS a
 * model (its pieces, SKUs, stock, releases and orders point at it as at any model), linked to its main model. Three
 * columns of `models`:
 *  - `variant_of`: the main model, or NULL. Variants are never chained: a variant's main model is never a variant
 *    itself, and a model with variants never becomes one (`models_variant_rules`, below); never its own
 *    (`models_variant_self`);
 *  - `variant_label`: the variant's name among its model's dots (« Steel »), 1 to 40 characters, trimmed. The main
 *    model carries its own label too, so that it is one of the dots: required on a variant (`models_variant_labelled`)
 *    and on a model that has variants (`models_variant_rules`); unique within a model and its variants whatever the
 *    case (`models_variant_label_key`, on the main model's id and the lower-cased label);
 *  - `variant_swatch`: the dot's colour, `#RRGGBB` in capitals; a label and its colour go together
 *    (`models_variant_dot`).
 * `models_variant_rules` (a row trigger before an insert or a change of `variant_of` or `variant_label`) reads the
 * other rows a CHECK cannot: the main model FOR SHARE (a change of it waits, then is read again), and whether the model
 * has variants. It refuses a chain and a main model without its label as a CHECK does (SQLSTATE 23514, with the names
 * `models_variant_no_chain` and `models_variant_main_labelled`).
 *
 * A draw's price: `drops.price_minor` and `currency`, required for a LIVE RELEASE since 0021 and NULL for a DRAW, may now
 * be set on a DRAW too, both or neither (`drops_draw_price`): the price the draw's card and page show, and the price an
 * order created from the draw takes (services/orders.ts orderForDrawEntry) instead of « to be confirmed ».
 * `drops_draw_fields` is the CHECK of 0021 without these two columns. A LIVE RELEASE is unchanged.
 *
 * `models_variant_of_idx` leads the new foreign key (ON DELETE RESTRICT like every other). Compatible with the previous
 * image: three nullable columns it never names (it inserts models without them and reads them column by column), and a
 * draw's price it never reads (it reads a drop's price on a LIVE RELEASE only). No row is inserted. `down` clears the
 * draws' prices (the previous image's `drops_draw_fields` refuses them), restores that CHECK as 0021 wrote it, drops
 * the trigger, its function, the indexes, the constraints and the columns: the schema of 0023 exactly (a variant is
 * then a model of its own, as it was). One statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

/** The longest label of a variant (services/catalog.ts VARIANT_LABEL_MAX; test/db/migrations.test.ts holds them equal). */
const LABEL_MAX = 40;

// Literal column lists, kept local on purpose (a migration never changes): drops_draw_fields as 0021 wrote it, and
// without the price this migration lets a DRAW carry. test/db/migrations.test.ts checks that down restores 0023 exactly.
const LIVE_SETTINGS_0021 = ['live_min_tier', 'tier_priority', 'room_opens_minutes', 'turn_seconds', 'pay_minutes', 'per_account', 'price_minor', 'currency', 'quantity_line'];
const LIVE_ONLY_0021 = ['announce_at', 'silhouette_at', 'name_at', 'photo_at', 'silhouette_sha256', 'access_collection_id', 'paused_at', 'ended_at', 'board_token_hash'];
const DRAW_PRICE = ['price_minor', 'currency'];
const drawFields = (columns: readonly string[]) => `mode = 'LIVE' OR (${columns.map((c) => `${c} IS NULL`).join(' AND ')} AND paused_ms_total = 0)`;
const DRAW_FIELDS_0021 = drawFields([...LIVE_SETTINGS_0021, ...LIVE_ONLY_0021]);
const DRAW_FIELDS_0024 = drawFields([...LIVE_SETTINGS_0021, ...LIVE_ONLY_0021].filter((c) => !DRAW_PRICE.includes(c)));

export const UP: readonly string[] = [
  // ── models: the variants ─────────────────────────────────────────────────
  `ALTER TABLE models ADD COLUMN variant_of uuid NULL CONSTRAINT models_variant_of_fkey REFERENCES models (id) ON DELETE RESTRICT`,
  `ALTER TABLE models ADD COLUMN variant_label text NULL CONSTRAINT models_variant_label_check CHECK (length(variant_label) BETWEEN 1 AND ${LABEL_MAX} AND variant_label = btrim(variant_label))`,
  `ALTER TABLE models ADD COLUMN variant_swatch text NULL CONSTRAINT models_variant_swatch_check CHECK (variant_swatch ~ '^#[0-9A-F]{6}$')`,
  `ALTER TABLE models ADD CONSTRAINT models_variant_self CHECK (variant_of <> id)`,
  `ALTER TABLE models ADD CONSTRAINT models_variant_labelled CHECK (variant_of IS NULL OR variant_label IS NOT NULL)`,
  `ALTER TABLE models ADD CONSTRAINT models_variant_dot CHECK ((variant_label IS NULL) = (variant_swatch IS NULL))`,
  `CREATE INDEX models_variant_of_idx ON models (variant_of)`,
  // One label per dot of a model and its variants, whatever its case.
  `CREATE UNIQUE INDEX models_variant_label_key ON models (coalesce(variant_of, id), lower(variant_label))`,
  `CREATE FUNCTION orbes_models_variant_rules() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     main_of uuid;
     main_label text;
   BEGIN
     IF NEW.variant_of IS NOT NULL THEN
       SELECT variant_of, variant_label INTO main_of, main_label FROM models WHERE id = NEW.variant_of FOR SHARE;
       IF FOUND AND main_of IS NOT NULL THEN
         RAISE EXCEPTION 'a variant''s main model is never a variant itself'
           USING ERRCODE = 'check_violation', CONSTRAINT = 'models_variant_no_chain', TABLE = 'models';
       END IF;
       IF FOUND AND main_label IS NULL THEN
         RAISE EXCEPTION 'the main model of a variant carries its own label'
           USING ERRCODE = 'check_violation', CONSTRAINT = 'models_variant_main_labelled', TABLE = 'models';
       END IF;
     END IF;
     IF TG_OP = 'UPDATE' AND (NEW.variant_of IS NOT NULL OR NEW.variant_label IS NULL)
        AND EXISTS (SELECT 1 FROM models WHERE variant_of = NEW.id) THEN
       IF NEW.variant_of IS NOT NULL THEN
         RAISE EXCEPTION 'a model with variants never becomes a variant'
           USING ERRCODE = 'check_violation', CONSTRAINT = 'models_variant_no_chain', TABLE = 'models';
       END IF;
       RAISE EXCEPTION 'a model with variants keeps its own label'
         USING ERRCODE = 'check_violation', CONSTRAINT = 'models_variant_main_labelled', TABLE = 'models';
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER models_variant_rules BEFORE INSERT OR UPDATE OF variant_of, variant_label ON models
     FOR EACH ROW EXECUTE FUNCTION orbes_models_variant_rules()`,

  // ── drops: a draw's price ────────────────────────────────────────────────
  `ALTER TABLE drops DROP CONSTRAINT drops_draw_fields`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_fields CHECK (${DRAW_FIELDS_0024})`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_price CHECK (mode = 'LIVE' OR (price_minor IS NULL) = (currency IS NULL))`,
];

export const DOWN: readonly string[] = [
  // The previous image's drops_draw_fields refuses a draw's price.
  `UPDATE drops SET price_minor = NULL, currency = NULL WHERE mode = 'DRAW' AND (price_minor IS NOT NULL OR currency IS NOT NULL)`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_draw_price`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_draw_fields`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_fields CHECK (${DRAW_FIELDS_0021})`,
  `DROP TRIGGER IF EXISTS models_variant_rules ON models`,
  `DROP FUNCTION IF EXISTS orbes_models_variant_rules()`,
  `DROP INDEX IF EXISTS models_variant_label_key`,
  `DROP INDEX IF EXISTS models_variant_of_idx`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_variant_dot`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_variant_labelled`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_variant_self`,
  `ALTER TABLE models DROP COLUMN IF EXISTS variant_swatch`,
  `ALTER TABLE models DROP COLUMN IF EXISTS variant_label`,
  `ALTER TABLE models DROP COLUMN IF EXISTS variant_of`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
