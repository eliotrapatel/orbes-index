/**
 * 0012 — reference photographs (F-04; API §8.6, §13.4, §14.12; DATABASE §5.26).
 *
 * `media_objects`: one stored image per SHA-256 of its bytes, the photographs
 * the console uploads (JPEG or WebP, at most 1 MiB, EXIF and XMP already
 * stripped by `server/media/image.ts`). Content-addressed: the key is the
 * lower-case hex SHA-256 of `bytes` (a CHECK recomputes it), so the same
 * photograph uploaded twice is stored once and its public URL
 * (`GET /api/v1/media/:sha256`) can be cached for good. A row never changes
 * (trigger); one that no model and no piece uses any more is deleted by the
 * service that dropped the last use.
 *
 * Both phases share it:
 *  - `models.image_sha256` (phase 1): the model's reference photograph,
 *    shown on the authentic results of every piece issued with the model;
 *  - `products.photo_sha256` (phase 2): the photograph of one piece, taken
 *    at issuance (the grain of the leather, the stone), which the customer
 *    compares with the piece in hand.
 * Each is a nullable foreign key at the head of its own index, ON DELETE
 * RESTRICT like every other.
 *
 * Compatible with the previous image: the new columns are nullable and the
 * table is unknown to it (it shows no photograph). The `products` and
 * `models` identity guards do not list the new columns, so an OPERATOR may
 * set, replace and remove them. `down` drops the columns (their indexes and
 * foreign keys go with them) and the table, with every photograph it holds:
 * the schema of the previous migration exactly.
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE media_objects (
     sha256     text        PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
     mime       text        NOT NULL CHECK (mime IN ('image/jpeg','image/webp')),
     bytes      bytea       NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
     width      int         NOT NULL CHECK (width BETWEEN 1 AND 4096),
     height     int         NOT NULL CHECK (height BETWEEN 1 AND 4096),
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT media_objects_sha256_consistent CHECK (sha256 = encode(sha256(bytes), 'hex'))
   )`,
  `CREATE INDEX media_objects_created_by_idx ON media_objects (created_by)`,
  `CREATE TRIGGER media_objects_immutable BEFORE UPDATE ON media_objects
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('media objects are content-addressed and never change')`,

  `ALTER TABLE models ADD COLUMN image_sha256 text NULL REFERENCES media_objects (sha256) ON DELETE RESTRICT`,
  `CREATE INDEX models_image_sha256_idx ON models (image_sha256)`,

  `ALTER TABLE products ADD COLUMN photo_sha256 text NULL REFERENCES media_objects (sha256) ON DELETE RESTRICT`,
  `CREATE INDEX products_photo_sha256_idx ON products (photo_sha256)`,
];

export const DOWN: readonly string[] = [
  `DROP INDEX IF EXISTS products_photo_sha256_idx`,
  `ALTER TABLE products DROP COLUMN IF EXISTS photo_sha256`,
  `DROP INDEX IF EXISTS models_image_sha256_idx`,
  `ALTER TABLE models DROP COLUMN IF EXISTS image_sha256`,
  `DROP TABLE IF EXISTS media_objects`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
