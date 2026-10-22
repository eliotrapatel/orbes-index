/**
 * 0054 — standard boxes and packed weights (macro scope of 2026-10-20, D16 B1 and B2; lot M3 plan §1.2, step M3.1): the
 * owner lists his real boxes in the console, each model (or variant) is given its box and its packed weight, and a
 * parcel's box and weight are written on its shipment when it is packed.
 *
 * `boxes`: one row per box the house uses.
 *  - `name` (1 to 60 characters, trimmed, unique whatever the case, `boxes_name_key`);
 *  - its inside dimensions `inside_length_mm`, `inside_width_mm`, `inside_height_mm` (1 to 2 000 mm each) and its
 *    `empty_weight_g` (1 to 30 000 g);
 *  - the card rule (`boxes_card_fits`): its inside length and width take the 95 × 62 mm certificate card 79t flat, in
 *    either orientation (the longer side at least 95 mm, the shorter at least 62 mm; render/certificate.ts
 *    CERTIFICATE_CARD, schema.ts CERTIFICATE_CARD_MM);
 *  - its cost: `cost_minor` (0 to 100 000 000 minor units) and `currency` (three capital letters), both or neither
 *    (`boxes_cost`);
 *  - `active` (DEFAULT true: set aside when false, never deleted by the service), `created_at`, `created_by` (the ADMIN
 *    who listed it; NULL for a script), `updated_at` (stamped by `orbes_touch_updated_at`); its id, creation and author
 *    never change (`boxes_immutable_identity`).
 *
 * `models` gains `box_id` (NULL: none, or on a variant its main model's) and `packed_weight_g` (1 to 30 000 g: the piece
 * as it is packed, with its pouch and card, without the box; NULL: unknown, or on a variant its main model's), read by
 * the service as `size_kind` and `supplier_id` are.
 *
 * `shipments` gains `box_id` (the box chosen while packing, or the one suggested, written at PACKED), `weight_g` (1 to
 * 100 000 g: the box's empty weight plus every piece's packed weight and every add-on's weight, written at PACKED) and
 * `weight_missing` (what was missing at PACKED when the weight is unknown: model names, « box »; 1 to 64 entries, none
 * NULL). The weight and its missing list only once packed and never both (`shipments_weight`): a parcel packed before
 * this migration, or by the previous image, keeps both NULL.
 *
 * Every foreign key ON DELETE RESTRICT, at the head of an index, like every other. On the previous image (0053) during
 * the roll-out: one table and five columns it never reads; a model or a parcel it writes has none. No row is inserted.
 * `down` refuses, naming the counts, while a box exists, a model has a box or a packed weight, or a shipment has a box, a
 * weight or a missing list; otherwise it drops them: the schema of 0053 exactly. One statement per array entry (PGlite's
 * extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** A box's name, at most (schema.ts BOX_NAME_MAX). */
const NAME_MAX = 60;
/** A box's inside side, at most, in mm (schema.ts BOX_INSIDE_MM_MAX). */
const SIDE_MAX = 2000;
/** A box's empty weight and a model's packed weight, at most, in g (schema.ts BOX_EMPTY_WEIGHT_G_MAX, PACKED_WEIGHT_G_MAX). */
const WEIGHT_MAX = 30000;
/** A parcel's weight, at most, in g (schema.ts SHIPMENT_WEIGHT_G_MAX). */
const PARCEL_MAX = 100000;
/** A box's cost, at most, in minor units (schema.ts BOX_COST_MINOR_MAX). */
const COST_MAX = 100000000;
/** What a parcel's unknown weight lists, at most (schema.ts SHIPMENT_WEIGHT_MISSING_MAX). */
const MISSING_MAX = 64;
/** The certificate card 79t, flat: its longer and shorter sides in mm (schema.ts CERTIFICATE_CARD_MM). */
const CARD_LONG = 95;
const CARD_SHORT = 62;

const side = (column: string) => `${column} integer NOT NULL CONSTRAINT boxes_${column}_check CHECK (${column} BETWEEN 1 AND ${SIDE_MAX})`;

export const UP: readonly string[] = [
  // ── boxes ────────────────────────────────────────────────────────────────
  `CREATE TABLE boxes (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name             text        NOT NULL CONSTRAINT boxes_name_check CHECK (length(name) BETWEEN 1 AND ${NAME_MAX} AND name = btrim(name)),
     ${side('inside_length_mm')},
     ${side('inside_width_mm')},
     ${side('inside_height_mm')},
     empty_weight_g   integer     NOT NULL CONSTRAINT boxes_empty_weight_g_check CHECK (empty_weight_g BETWEEN 1 AND ${WEIGHT_MAX}),
     cost_minor       bigint      NULL CONSTRAINT boxes_cost_minor_check CHECK (cost_minor BETWEEN 0 AND ${COST_MAX}),
     currency         text        NULL CONSTRAINT boxes_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
     active           boolean     NOT NULL DEFAULT true,
     created_at       timestamptz NOT NULL DEFAULT now(),
     created_by       uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at       timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT boxes_cost CHECK ((cost_minor IS NULL) = (currency IS NULL)),
     CONSTRAINT boxes_card_fits CHECK (
       greatest(inside_length_mm, inside_width_mm) >= ${CARD_LONG} AND least(inside_length_mm, inside_width_mm) >= ${CARD_SHORT})
   )`,
  `CREATE UNIQUE INDEX boxes_name_key ON boxes (lower(name))`,
  `CREATE INDEX boxes_created_by_idx ON boxes (created_by)`,
  `CREATE TRIGGER boxes_immutable_identity BEFORE UPDATE ON boxes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at', 'created_by')`,
  `CREATE TRIGGER boxes_touch_updated_at BEFORE UPDATE ON boxes
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,

  // ── models: the box and the packed weight ────────────────────────────────
  `ALTER TABLE models ADD COLUMN box_id uuid NULL CONSTRAINT models_box_id_fkey REFERENCES boxes (id) ON DELETE RESTRICT`,
  `CREATE INDEX models_box_id_idx ON models (box_id)`,
  `ALTER TABLE models ADD COLUMN packed_weight_g integer NULL CONSTRAINT models_packed_weight_g_check CHECK (packed_weight_g BETWEEN 1 AND ${WEIGHT_MAX})`,

  // ── shipments: the parcel's box and weight ───────────────────────────────
  `ALTER TABLE shipments ADD COLUMN box_id uuid NULL CONSTRAINT shipments_box_id_fkey REFERENCES boxes (id) ON DELETE RESTRICT`,
  `CREATE INDEX shipments_box_idx ON shipments (box_id)`,
  `ALTER TABLE shipments ADD COLUMN weight_g integer NULL CONSTRAINT shipments_weight_g_check CHECK (weight_g BETWEEN 1 AND ${PARCEL_MAX})`,
  `ALTER TABLE shipments ADD COLUMN weight_missing text[] NULL CONSTRAINT shipments_weight_missing_check CHECK (
     cardinality(weight_missing) BETWEEN 1 AND ${MISSING_MAX} AND array_position(weight_missing, NULL) IS NULL)`,
  // The weight and what was missing only once packed, never both.
  `ALTER TABLE shipments ADD CONSTRAINT shipments_weight CHECK (
     (packed_at IS NOT NULL OR (weight_g IS NULL AND weight_missing IS NULL)) AND (weight_g IS NULL OR weight_missing IS NULL))`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no box nor weight: refused while any would be lost.
  `DO $$
   DECLARE boxes_n bigint; models_n bigint; shipments_n bigint;
   BEGIN
     SELECT count(*) INTO boxes_n FROM boxes;
     SELECT count(*) INTO models_n FROM models WHERE box_id IS NOT NULL OR packed_weight_g IS NOT NULL;
     SELECT count(*) INTO shipments_n FROM shipments WHERE box_id IS NOT NULL OR weight_g IS NOT NULL OR weight_missing IS NOT NULL;
     IF boxes_n > 0 OR models_n > 0 OR shipments_n > 0 THEN
       RAISE EXCEPTION 'migration 0054_boxes_weights cannot be rolled back: % boxes, % models with a box or a packed weight and % shipments with a box or a weight exist', boxes_n, models_n, shipments_n;
     END IF;
   END $$`,
  `ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_weight`,
  `ALTER TABLE shipments DROP COLUMN IF EXISTS weight_missing`,
  `ALTER TABLE shipments DROP COLUMN IF EXISTS weight_g`,
  `DROP INDEX IF EXISTS shipments_box_idx`,
  `ALTER TABLE shipments DROP COLUMN IF EXISTS box_id`,
  `ALTER TABLE models DROP COLUMN IF EXISTS packed_weight_g`,
  `DROP INDEX IF EXISTS models_box_id_idx`,
  `ALTER TABLE models DROP COLUMN IF EXISTS box_id`,
  `DROP TABLE IF EXISTS boxes`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
