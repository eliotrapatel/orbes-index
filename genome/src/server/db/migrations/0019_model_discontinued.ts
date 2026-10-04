/**
 * 0019 — a model DISCONTINUED (P-R06; API §13.4; DATABASE §5.3).
 *
 * An ADMIN closes a model's edition from the console's Catalogue (CatalogService.discontinueModel, audited
 * `model.discontinue`), and may open it again (`reinstateModel`, `model.reinstate`). Two columns of `models`:
 *  - `discontinued_at`: when the model was discontinued; NULL while it is not. Its year is said as
 *    « DISCONTINUED · <year> » on the AUTHENTIC results of its pieces, on its lookbook sheet and on the ownership
 *    certificates of its pieces (page and PDF). Reinstating it clears it;
 *  - `discontinued_by`: the console user who discontinued it (admin_users, ON DELETE RESTRICT like every other key,
 *    at the head of its own index); NULL for a script, and cleared with `discontinued_at`.
 *
 * Discontinuing a model also sets `active = false` in the same transaction (0010): the issuance refuses it (409
 * MODEL_INACTIVE) and the generator hides it, as for any inactive model; its pieces verify as before. Reinstating it
 * sets `active = true` again. `models_discontinued_inactive` holds it below the service: a discontinued model is never
 * active (an edit that would make it active is refused, 409 MODEL_DISCONTINUED: it is reinstated instead).
 * `models_discontinued_by_when`: an author only with the date.
 *
 * Compatible with the previous image: two nullable columns it never names (it inserts models without them and reads
 * them column by column); no row has a date until the new image discontinues one. `down` drops the index, the two
 * constraints and the columns (the foreign key goes with its column): the schema of 0018 exactly. One statement per
 * array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `ALTER TABLE models ADD COLUMN discontinued_at timestamptz NULL`,
  `ALTER TABLE models ADD COLUMN discontinued_by uuid NULL REFERENCES admin_users (id) ON DELETE RESTRICT`,
  `ALTER TABLE models ADD CONSTRAINT models_discontinued_inactive CHECK (discontinued_at IS NULL OR NOT active)`,
  `ALTER TABLE models ADD CONSTRAINT models_discontinued_by_when CHECK (discontinued_by IS NULL OR discontinued_at IS NOT NULL)`,
  `CREATE INDEX models_discontinued_by_idx ON models (discontinued_by)`,
];

export const DOWN: readonly string[] = [
  `DROP INDEX IF EXISTS models_discontinued_by_idx`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_discontinued_by_when`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_discontinued_inactive`,
  `ALTER TABLE models DROP COLUMN IF EXISTS discontinued_by`,
  `ALTER TABLE models DROP COLUMN IF EXISTS discontinued_at`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
