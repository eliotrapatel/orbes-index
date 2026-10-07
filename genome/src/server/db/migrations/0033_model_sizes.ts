/**
 * 0033 — Sizes per model and per variant (plan NEXT LOT of 2026-10-07, §3.3, step 3.1: « each model, variant needs to
 * have its sizes and each size must have its own stock count, with different skus »).
 *
 * `models.size_type`: the model's kind of size, from which its sizes are ticked in the Catalogue (services/sizes.ts
 * standardSizes): RING (French sizes 40 to 76), BRACELET (14 to 24 cm by 0.5), NECKLACE (35 to 100 cm by 1), WATCH and
 * ONE_SIZE (a single SKU, its label NULL). NULL: 'To give', the model works as before this migration until staff give it
 * its type. Once given, next-nine's `size_kind` (the saved size that preselects the model's size) is derived from it
 * (`models_size_type_kind`: RING, BRACELET and NECKLACE their own kind, WATCH the wrist, ONE_SIZE none).
 *
 * `skus.set_aside_at` and `set_aside_by`: a declared size that something uses (stock, an order, a piece, a release, a
 * minimum, a salon request, a Shopify id) is set aside rather than removed when staff take it off the model: nothing new
 * offers it, its history keeps it, and it can be reinstated. NULL `set_aside_at`: offered. `set_aside_by` the admin who
 * set it aside, NULL for a script, never without `set_aside_at` (`skus_set_aside`); its foreign key leads
 * `skus_set_aside_by_idx`. `skus_model_offered_idx` serves a model's offered sizes. `skus_immutable_identity` is unchanged:
 * it guards a SKU's identity, not these columns.
 *
 * No row is written: every SKU stays a declared, offered size, and every model's type stays NULL. Compatible with the
 * previous image: nullable columns it never reads, and CHECKs that hold for every row it writes (a NULL type). `down`
 * drops them: the schema of 0032 exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const SIZE_TYPES = `'RING','BRACELET','NECKLACE','WATCH','ONE_SIZE'`;

export const UP: readonly string[] = [
  // ── models: the size type, and the saved size it preselects with ────────
  `ALTER TABLE models ADD COLUMN size_type text NULL CONSTRAINT models_size_type_check CHECK (size_type IN (${SIZE_TYPES}))`,
  `ALTER TABLE models ADD CONSTRAINT models_size_type_kind CHECK (
     size_type IS NULL OR size_kind IS NOT DISTINCT FROM (CASE size_type WHEN 'RING' THEN 'RING' WHEN 'BRACELET' THEN 'BRACELET' WHEN 'NECKLACE' THEN 'NECKLACE' WHEN 'WATCH' THEN 'WRIST' ELSE NULL END))`,

  // ── skus: a declared size set aside ─────────────────────────────────────
  `ALTER TABLE skus ADD COLUMN set_aside_at timestamptz NULL`,
  `ALTER TABLE skus ADD COLUMN set_aside_by uuid NULL CONSTRAINT skus_set_aside_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT`,
  `CREATE INDEX skus_set_aside_by_idx ON skus (set_aside_by)`,
  `ALTER TABLE skus ADD CONSTRAINT skus_set_aside CHECK (set_aside_by IS NULL OR set_aside_at IS NOT NULL)`,
  `CREATE INDEX skus_model_offered_idx ON skus (model_id) WHERE set_aside_at IS NULL`,
];

export const DOWN: readonly string[] = [
  `DROP INDEX IF EXISTS skus_model_offered_idx`,
  `ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_set_aside`,
  `DROP INDEX IF EXISTS skus_set_aside_by_idx`,
  `ALTER TABLE skus DROP COLUMN IF EXISTS set_aside_by`,
  `ALTER TABLE skus DROP COLUMN IF EXISTS set_aside_at`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_size_type_kind`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_size_type_check`,
  `ALTER TABLE models DROP COLUMN IF EXISTS size_type`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
