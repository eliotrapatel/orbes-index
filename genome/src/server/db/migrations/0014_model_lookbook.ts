/**
 * 0014 — the lookbook of the models (P-R02; API §8.8, §10.9, §13.4; DATABASE §5.3, §5.28).
 *
 * A model the console publishes in the lookbook gets a public sheet at
 * `/verify/lookbook/<slug>`: its photographs, its story, its specifications
 * and its care. Five columns of `models`:
 *  - `slug`: the address of the sheet, unique, lower-case words joined by
 *    hyphens, at most 80 characters (NULL until the console names it);
 *  - `lookbook`: HIDDEN (the default: every existing model stays out of the
 *    lookbook), PUBLIC (listed for everyone) or RESERVED (listed for the owners
 *    of a piece only; unlisted, not confidential: its photographs are served by
 *    the public media route like any other). A model shown needs its slug
 *    (`models_lookbook_slug`);
 *  - `story`: plain paragraphs, at most 4 000 characters;
 *  - `specs`: one `Label: value` line per specification, at most 1 000
 *    characters (the line format is CatalogService's rule);
 *  - `published_at`: when the model first left HIDDEN. From then on its slug
 *    never changes (a service rule: links to the sheet are out), so a model
 *    once published always has one (`models_published_slug`).
 *
 * `model_images`: the gallery of a model, at most 8 photographs
 * (`position` 1 to 8, unique per model, deferred so a reorder may swap two
 * positions inside its transaction), each a `media_objects` row stored by
 * MediaService, with its alternative text (NULL: the sheet's default). The
 * reference photograph (`models.image_sha256`) stays the cover and is not a
 * row here. Both foreign keys lead an index (the primary key, `model_id`
 * first; `model_images_sha256_idx`), as does `created_by`; ON DELETE RESTRICT
 * like every other. A row never changes model, photograph or author
 * (`model_images_immutable_identity`).
 *
 * Compatible with the previous image: the new columns are nullable or have a
 * constant default, and the table is unknown to it. `down` drops the table,
 * then the columns (their constraints and the unique index go with them): the
 * schema of the previous migration exactly. One statement per array entry
 * (PGlite's extended protocol); Kysely's Migrator applies the migration
 * inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const LOOKBOOK_STATES = `'HIDDEN','PUBLIC','RESERVED'`;

export const UP: readonly string[] = [
  `ALTER TABLE models ADD COLUMN slug text NULL`,
  `ALTER TABLE models ADD CONSTRAINT models_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80)`,
  `ALTER TABLE models ADD CONSTRAINT models_slug_key UNIQUE (slug)`,
  `ALTER TABLE models ADD COLUMN lookbook text NOT NULL DEFAULT 'HIDDEN' CHECK (lookbook IN (${LOOKBOOK_STATES}))`,
  `ALTER TABLE models ADD CONSTRAINT models_lookbook_slug CHECK (lookbook = 'HIDDEN' OR slug IS NOT NULL)`,
  `ALTER TABLE models ADD COLUMN story text NULL CHECK (length(btrim(story)) BETWEEN 1 AND 4000)`,
  `ALTER TABLE models ADD COLUMN specs text NULL CHECK (length(btrim(specs)) BETWEEN 1 AND 1000)`,
  `ALTER TABLE models ADD COLUMN published_at timestamptz NULL`,
  `ALTER TABLE models ADD CONSTRAINT models_published_slug CHECK (published_at IS NULL OR slug IS NOT NULL)`,

  `CREATE TABLE model_images (
     model_id   uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     sha256     text        NOT NULL REFERENCES media_objects (sha256) ON DELETE RESTRICT,
     position   smallint    NOT NULL CHECK (position BETWEEN 1 AND 8),
     alt        text        NULL CHECK (length(btrim(alt)) BETWEEN 1 AND 200),
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (model_id, sha256),
     CONSTRAINT model_images_position_key UNIQUE (model_id, position) DEFERRABLE INITIALLY DEFERRED
   )`,
  `CREATE INDEX model_images_sha256_idx ON model_images (sha256)`,
  `CREATE INDEX model_images_created_by_idx ON model_images (created_by)`,
  `CREATE TRIGGER model_images_immutable_identity BEFORE UPDATE ON model_images
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('model_id', 'sha256', 'created_by', 'created_at')`,
];

export const DOWN: readonly string[] = [
  `DROP TABLE IF EXISTS model_images`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_published_slug`,
  `ALTER TABLE models DROP COLUMN IF EXISTS published_at`,
  `ALTER TABLE models DROP COLUMN IF EXISTS specs`,
  `ALTER TABLE models DROP COLUMN IF EXISTS story`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_lookbook_slug`,
  `ALTER TABLE models DROP COLUMN IF EXISTS lookbook`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_slug_key`,
  `ALTER TABLE models DROP CONSTRAINT IF EXISTS models_slug_format`,
  `ALTER TABLE models DROP COLUMN IF EXISTS slug`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
