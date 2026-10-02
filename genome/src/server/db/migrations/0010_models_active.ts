/**
 * 0010 — an editable catalogue (A-10; API §13.4, DATABASE §5.3).
 *
 * `models.active`: a model retired from the range is no longer offered for
 * new products. The generator hides it and `IssuanceService.issueProduct`
 * refuses it (409 MODEL_INACTIVE); the pieces already issued with it verify
 * as before. Every existing model stays active (`DEFAULT true`).
 *
 * `models_immutable_identity`: the name, default material, care
 * instructions, collection and `active` of a model become editable
 * (`CatalogService.updateModel`), but never its category (the letter in the
 * identity of every piece issued with it) nor its SKU prefix (the start of
 * every SKU issued with it). The service refuses them; this trigger refuses
 * them below the service, like `categories_immutable_identity`.
 *
 * Both are additions an older image ignores: it never updates a model and
 * inserts without the column. One statement per array entry (PGlite's
 * extended protocol); Kysely's Migrator applies the migration inside a
 * transaction. The down step drops the trigger and the column, and nothing
 * else: the schema of the previous migration.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `ALTER TABLE models ADD COLUMN active boolean NOT NULL DEFAULT true`,
  `CREATE TRIGGER models_immutable_identity BEFORE UPDATE ON models
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'category_id', 'sku_prefix', 'created_at')`,
];

export const DOWN: readonly string[] = [
  `DROP TRIGGER IF EXISTS models_immutable_identity ON models`,
  `ALTER TABLE models DROP COLUMN IF EXISTS active`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
