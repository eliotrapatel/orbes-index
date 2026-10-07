/**
 * 0030 — YOUR SIZES (plan NEXT-NINE of 2026-10-06, §3.4 AC-01, step 4.1: « Ring size, bracelet size, wrist (for
 * watches) and necklace length … They preselect the size for I'LL BE THERE, the LIVE ready check and a salon request,
 * always confirmed each time »).
 *
 * `account_sizes`: the sizes a collector saved in YOUR SIZES, one row per account and kind (PRIMARY KEY (account_id,
 * kind), which leads with the account's foreign key). `kind` RING, BRACELET, WRIST or NECKLACE; `value_mm` in whole
 * millimetres: the French ring size itself (40 to 76), or the centimetres × 10 (a bracelet 140 to 240 by 5, a wrist 120
 * to 240 by 5, a necklace 350 to 1 000 by 10), as `account_sizes_value` holds them. A cleared size is a deleted row.
 *
 * `models.size_kind`: which saved size preselects the model's size (the same four kinds); NULL: none, or, on a variant,
 * its main model's (services/sizes.ts sizeKindOf).
 *
 * `skus.fit_min_mm` and `fit_max_mm`: the measures a size fits, in the kind's whole millimetres, both or neither, from 1
 * to 1 000 and the first at most the second (`skus_fit`); NULL: the size's label itself is read as the measure.
 *
 * `shop_requests.size_label`: the size a collector asked for with REQUEST THIS PIECE (one of the model's, 1 to 100
 * characters, trimmed, as a SKU's label), NULL for NOT SURE YET or a model of one size. It never changes:
 * `shop_requests_immutable_identity` is created again to guard it with the columns of 0020.
 *
 * Compatible with the previous image: a table it never reads and nullable columns it never writes. No row is inserted.
 * `down` drops them and creates 0020's trigger again: the schema of 0029 exactly. One statement per array entry
 * (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const SIZE_KINDS = `'RING','BRACELET','WRIST','NECKLACE'`;

/** The measures each kind is saved in (services/sizes.ts SIZE_RANGES): whole millimetres, a step of them. */
const VALUES = `(kind = 'RING' AND value_mm BETWEEN 40 AND 76)
    OR (kind = 'BRACELET' AND value_mm BETWEEN 140 AND 240 AND value_mm % 5 = 0)
    OR (kind = 'WRIST' AND value_mm BETWEEN 120 AND 240 AND value_mm % 5 = 0)
    OR (kind = 'NECKLACE' AND value_mm BETWEEN 350 AND 1000 AND value_mm % 10 = 0)`;

export const UP: readonly string[] = [
  // ── account_sizes ────────────────────────────────────────────────────────
  `CREATE TABLE account_sizes (
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     kind       text        NOT NULL CHECK (kind IN (${SIZE_KINDS})),
     value_mm   smallint    NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (account_id, kind),
     CONSTRAINT account_sizes_value CHECK (${VALUES})
   )`,

  // ── models: the saved size that preselects its size ─────────────────────
  `ALTER TABLE models ADD COLUMN size_kind text NULL CONSTRAINT models_size_kind_check CHECK (size_kind IN (${SIZE_KINDS}))`,

  // ── skus: the measures a size fits ──────────────────────────────────────
  `ALTER TABLE skus ADD COLUMN fit_min_mm smallint NULL`,
  `ALTER TABLE skus ADD COLUMN fit_max_mm smallint NULL`,
  `ALTER TABLE skus ADD CONSTRAINT skus_fit CHECK (
     (fit_min_mm IS NULL) = (fit_max_mm IS NULL)
     AND (fit_min_mm IS NULL OR (fit_min_mm BETWEEN 1 AND 1000 AND fit_max_mm BETWEEN 1 AND 1000 AND fit_min_mm <= fit_max_mm)))`,

  // ── shop_requests: the size asked, never changed ────────────────────────
  `ALTER TABLE shop_requests ADD COLUMN size_label text NULL CONSTRAINT shop_requests_size_label_check CHECK (length(size_label) BETWEEN 1 AND 100 AND size_label = btrim(size_label))`,
  `DROP TRIGGER shop_requests_immutable_identity ON shop_requests`,
  `CREATE TRIGGER shop_requests_immutable_identity BEFORE UPDATE ON shop_requests
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'model_id', 'created_at', 'note', 'size_label')`,
];

export const DOWN: readonly string[] = [
  `DROP TRIGGER IF EXISTS shop_requests_immutable_identity ON shop_requests`,
  `ALTER TABLE shop_requests DROP CONSTRAINT IF EXISTS shop_requests_size_label_check`,
  `ALTER TABLE shop_requests DROP COLUMN IF EXISTS size_label`,
  // 0020's trigger, as it was.
  `CREATE TRIGGER shop_requests_immutable_identity BEFORE UPDATE ON shop_requests
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'model_id', 'created_at', 'note')`,
  `ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_fit`,
  `ALTER TABLE skus DROP COLUMN IF EXISTS fit_max_mm`,
  `ALTER TABLE skus DROP COLUMN IF EXISTS fit_min_mm`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_size_kind_check`,
  `ALTER TABLE models DROP COLUMN IF EXISTS size_kind`,
  `DROP TABLE IF EXISTS account_sizes`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
