/**
 * 0053 — WORN, the owners' gallery (macro scope of 2026-10-20, D31 G1 to G3; lot M2 plan §2.2, step M2.6): the
 * photograph the owner of a registered piece sends from that piece, read by ORBES staff before it appears, once
 * published, at the foot of the model's sheet, credited with the owner's first name and country, plus their Instagram if
 * they chose it. The owner withdraws it at any time.
 *
 * `worn_photos`: one row per photograph sent.
 *  - `product_id`, `ownership_id` (the period of ownership it was sent in: once that period ends, the photograph leaves
 *    WORN), `account_id` (the sender) and `model_id` (the piece's model at sending: the sheet it appears on);
 *  - the photograph: `photo` (1 byte to 1 MiB), `photo_mime` (JPEG or WebP), `photo_sha256` (the hex SHA-256 of its
 *    bytes, `worn_photos_sha256_consistent`), `width` and `height` (1 to 4 096 px), as media_objects (0012) and the
 *    packing photo (0037) hold theirs, all present exactly while PENDING or PUBLISHED (`worn_photos_photo`): a photograph
 *    refused, withdrawn, taken down or ended is erased, its row kept. Never in media_objects, whose public route serves
 *    any stored hash and is cached for good. Erased, never replaced (`worn_photos_photo_kept`);
 *  - the credit, written at sending and shown as staff approved it (G3): `credit_first_name` (as
 *    account_profiles.first_name: 1 to 50 characters, trimmed, no control character nor `<` `>`), `credit_country` (two
 *    capital letters, as accounts.country) and `credit_instagram` (as account_profiles.instagram), NULL unless the owner
 *    chose to show it;
 *  - the consent: `consent_at` and `consent_version` (the LEGAL_VERSION shown, a `YYYY-MM-DD` date), never without them;
 *  - `status` PENDING, PUBLISHED, REFUSED, WITHDRAWN, TAKEN_DOWN or ENDED (DEFAULT PENDING), moving only forward
 *    (`worn_photos_forward`): PENDING to PUBLISHED, REFUSED, WITHDRAWN or ENDED; PUBLISHED to WITHDRAWN, TAKEN_DOWN or
 *    ENDED; any other status is settled and its row never changes again (`worn_photos_settled_immutable`);
 *  - `refusal` (WORN_REFUSALS), set exactly when REFUSED or TAKEN_DOWN (`worn_photos_refusal`);
 *  - `reviewed_by` and `reviewed_at`, both or neither, set when published, refused or taken down, never while PENDING
 *    (`worn_photos_reviewed`); `published_at` set once published and kept after (`worn_photos_published`,
 *    `worn_photos_published_kept`): never on a PENDING or REFUSED row, always on a PUBLISHED or TAKEN_DOWN one;
 *    `ended_at` set exactly when no longer PENDING or PUBLISHED (`worn_photos_ended`); `created_at`;
 *  - the identity, the credit and the consent never change (`worn_photos_immutable_identity`); never deleted nor
 *    truncated: the record (its dates and status) stays with the account and in the copy of its data.
 *  - indexes: one live photograph per piece (`worn_photos_live_once`, UNIQUE on product_id while PENDING or PUBLISHED,
 *    G1's "one photograph at a time"); a model's published photographs newest first (`worn_photos_sheet`); the review
 *    queue by status, oldest first (`worn_photos_queue`); an account's photographs over time (the rate, the export); and
 *    each foreign key at the head of a full index.
 *
 * Every foreign key ON DELETE RESTRICT, like every other. On the previous image (0052) during the roll-out: one table it
 * never reads. No row is inserted. `down` refuses, naming the count, while any photograph exists; otherwise it drops the
 * table: the schema of 0052 exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they
// match schema.ts.
/** A WORN photograph's status (schema.ts WORN_STATUSES). */
const WORN_STATUSES = `'PENDING','PUBLISHED','REFUSED','WITHDRAWN','TAKEN_DOWN','ENDED'`;
/** The statuses in which the photograph is live and its bytes kept. */
const LIVE = `'PENDING','PUBLISHED'`;
/** Why staff refuse or take down a photograph (schema.ts WORN_REFUSALS). */
const WORN_REFUSALS = `'PIECE_NOT_VISIBLE','QUALITY','NOT_SUITABLE'`;
/** The photograph's types (schema.ts MEDIA_MIME_TYPES). */
const PHOTO_TYPES = `'image/jpeg','image/webp'`;
/** The photograph's bytes and sides, at most (schema.ts WORN_PHOTO_MAX_BYTES, WORN_PHOTO_MAX_SIDE; media/image.ts). */
const PHOTO_MAX = 1048576;
const SIDE_MAX = 4096;
/** The credit's first name, at most (schema.ts WORN_CREDIT_FIRST_NAME_MAX, as account_profiles.first_name). */
const FIRST_NAME_MAX = 50;

/** Every column of the table, frozen once settled. */
const COLUMNS = [
  'id', 'product_id', 'ownership_id', 'account_id', 'model_id', 'photo', 'photo_mime', 'photo_sha256', 'width', 'height', 'credit_first_name', 'credit_country',
  'credit_instagram', 'consent_at', 'consent_version', 'status', 'refusal', 'reviewed_by', 'reviewed_at', 'published_at', 'ended_at', 'created_at',
];
/** The identity, the credit and the consent, never changed. */
const IDENTITY = ['id', 'product_id', 'ownership_id', 'account_id', 'model_id', 'credit_first_name', 'credit_country', 'credit_instagram', 'consent_at', 'consent_version', 'created_at'];
/** The photograph's columns, erased together and never replaced. */
const PHOTO_COLUMNS = ['photo', 'photo_mime', 'photo_sha256', 'width', 'height'];

const quoted = (columns: readonly string[]) => columns.map((c) => `'${c}'`).join(', ');

export const UP: readonly string[] = [
  `CREATE TABLE worn_photos (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id        uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     ownership_id      uuid        NOT NULL REFERENCES ownership (id) ON DELETE RESTRICT,
     account_id        uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     model_id          uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     photo             bytea       NULL CONSTRAINT worn_photos_photo_check CHECK (octet_length(photo) BETWEEN 1 AND ${PHOTO_MAX}),
     photo_mime        text        NULL CONSTRAINT worn_photos_photo_mime_check CHECK (photo_mime IN (${PHOTO_TYPES})),
     photo_sha256      text        NULL CONSTRAINT worn_photos_photo_sha256_check CHECK (photo_sha256 ~ '^[0-9a-f]{64}$'),
     width             integer     NULL CONSTRAINT worn_photos_width_check CHECK (width BETWEEN 1 AND ${SIDE_MAX}),
     height            integer     NULL CONSTRAINT worn_photos_height_check CHECK (height BETWEEN 1 AND ${SIDE_MAX}),
     credit_first_name text        NOT NULL CONSTRAINT worn_photos_credit_first_name_check CHECK (
                                     length(credit_first_name) BETWEEN 1 AND ${FIRST_NAME_MAX} AND credit_first_name = btrim(credit_first_name) AND credit_first_name !~ '[[:cntrl:]<>]'),
     credit_country    char(2)     NOT NULL CONSTRAINT worn_photos_credit_country_check CHECK (credit_country ~ '^[A-Z]{2}$'),
     credit_instagram  text        NULL CONSTRAINT worn_photos_credit_instagram_check CHECK (credit_instagram ~ '^[a-z0-9._]{1,30}$'),
     consent_at        timestamptz NOT NULL,
     consent_version   text        NOT NULL CONSTRAINT worn_photos_consent_version_check CHECK (consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
     status            text        NOT NULL DEFAULT 'PENDING' CONSTRAINT worn_photos_status_check CHECK (status IN (${WORN_STATUSES})),
     refusal           text        NULL CONSTRAINT worn_photos_refusal_check CHECK (refusal IN (${WORN_REFUSALS})),
     reviewed_by       uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     reviewed_at       timestamptz NULL,
     published_at      timestamptz NULL,
     ended_at          timestamptz NULL,
     created_at        timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT worn_photos_photo CHECK (
       (status IN (${LIVE})) = (photo IS NOT NULL) AND (photo IS NULL) = (photo_mime IS NULL) AND (photo IS NULL) = (photo_sha256 IS NULL)
       AND (photo IS NULL) = (width IS NULL) AND (photo IS NULL) = (height IS NULL)),
     CONSTRAINT worn_photos_sha256_consistent CHECK (photo_sha256 = encode(sha256(photo), 'hex')),
     CONSTRAINT worn_photos_refusal CHECK ((status IN ('REFUSED', 'TAKEN_DOWN')) = (refusal IS NOT NULL)),
     CONSTRAINT worn_photos_reviewed CHECK (
       (reviewed_by IS NULL) = (reviewed_at IS NULL)
       AND (status <> 'PENDING' OR reviewed_at IS NULL)
       AND (status NOT IN ('PUBLISHED', 'REFUSED', 'TAKEN_DOWN') OR reviewed_at IS NOT NULL)),
     CONSTRAINT worn_photos_published CHECK (
       CASE status WHEN 'PENDING' THEN published_at IS NULL WHEN 'REFUSED' THEN published_at IS NULL
                   WHEN 'PUBLISHED' THEN published_at IS NOT NULL WHEN 'TAKEN_DOWN' THEN published_at IS NOT NULL ELSE true END),
     CONSTRAINT worn_photos_ended CHECK ((status IN (${LIVE})) = (ended_at IS NULL))
   )`,
  // One live photograph per piece (G1: one photograph at a time): a second sending while one is in review or published fails here.
  `CREATE UNIQUE INDEX worn_photos_live_once ON worn_photos (product_id) WHERE status IN (${LIVE})`,
  // A model's sheet: its published photographs, newest first.
  `CREATE INDEX worn_photos_sheet ON worn_photos (model_id, published_at DESC) WHERE status = 'PUBLISHED'`,
  // The console's queue: TO REVIEW oldest first, and each status over time.
  `CREATE INDEX worn_photos_queue ON worn_photos (status, created_at)`,
  // An account's photographs over time (the sendings' rate, the copy of its data), a piece's, and each other foreign key at
  // the head of a full index.
  `CREATE INDEX worn_photos_account_idx ON worn_photos (account_id, created_at)`,
  `CREATE INDEX worn_photos_product_idx ON worn_photos (product_id, created_at)`,
  `CREATE INDEX worn_photos_ownership_idx ON worn_photos (ownership_id)`,
  `CREATE INDEX worn_photos_model_idx ON worn_photos (model_id)`,
  `CREATE INDEX worn_photos_reviewed_by_idx ON worn_photos (reviewed_by)`,
  `CREATE TRIGGER worn_photos_immutable_identity BEFORE UPDATE ON worn_photos
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(IDENTITY)})`,
  `CREATE TRIGGER worn_photos_forward BEFORE UPDATE ON worn_photos
     FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('PUBLISHED', 'REFUSED', 'WITHDRAWN', 'ENDED'))
       OR (OLD.status = 'PUBLISHED' AND NEW.status IN ('WITHDRAWN', 'TAKEN_DOWN', 'ENDED'))))
     EXECUTE FUNCTION orbes_reject_mutation('a WORN photograph only moves forward')`,
  `CREATE TRIGGER worn_photos_settled_immutable BEFORE UPDATE ON worn_photos
     FOR EACH ROW WHEN (OLD.status NOT IN (${LIVE})) EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(COLUMNS)})`,
  `CREATE TRIGGER worn_photos_published_kept BEFORE UPDATE ON worn_photos
     FOR EACH ROW WHEN (OLD.published_at IS NOT NULL) EXECUTE FUNCTION orbes_guard_immutable_columns('published_at')`,
  `CREATE TRIGGER worn_photos_photo_kept BEFORE UPDATE ON worn_photos
     FOR EACH ROW WHEN (NEW.photo IS NOT NULL AND (${PHOTO_COLUMNS.map((c) => `NEW.${c} IS DISTINCT FROM OLD.${c}`).join(' OR ')}))
     EXECUTE FUNCTION orbes_reject_mutation('a WORN photograph is erased, never replaced')`,
  `CREATE TRIGGER worn_photos_no_delete BEFORE DELETE ON worn_photos
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('WORN photographs are kept with the account')`,
  `CREATE TRIGGER worn_photos_no_truncate BEFORE TRUNCATE ON worn_photos
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('WORN photographs are kept with the account')`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no WORN photograph: refused while any exists.
  `DO $$
   DECLARE photos bigint;
   BEGIN
     SELECT count(*) INTO photos FROM worn_photos;
     IF photos > 0 THEN
       RAISE EXCEPTION 'migration 0053_worn cannot be rolled back: % WORN photographs exist', photos;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS worn_photos`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
