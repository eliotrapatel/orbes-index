/**
 * 0040 — The profile (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.3.2 and §3.2 W.3, step 1.1): the first migration
 * of the customer intelligence lot, after the next lot's 0039.
 *
 * `heard_options`: the answers to « How did you hear about ORBES? », a list an ADMIN edits in the console (Sign-up). A
 * label of 1 to 40 characters, trimmed, no control character nor `<>`, unique whatever the case
 * (`heard_options_label_key`); exactly one Other (`is_other`, `heard_options_one_other`), with its text field; a
 * position of 1 to 100 (not unique: a reorder rewrites them all in one transaction); `active` offered at sign-up and in
 * YOUR PROFILE, false once set aside. Never deleted, only set aside, so past answers keep their meaning. Its identity and
 * Other mark never change. The presets are not inserted here: ProfileService.prepare creates them at the first boot,
 * only while the table is empty (as the carriers), so a renamed answer is never created again.
 *
 * `account_profiles`: one row per account that has given anything, beside `accounts` (read whole on every signed-in
 * request, so not widened). The first and last name (1 to 50 characters, trimmed, no control character nor `<>`), the
 * phone in E.164 with the country picked for its code (both or neither: `account_profiles_phone_pair`), the date of
 * birth with who set it and when (all three or none: `account_profiles_birth_pair`; from 1900-01-01, the service checks
 * the 13 years), `birth_date_collector_at` (the collector's one entry, never cleared: the service is its guard), the
 * city (1 to 80), the Instagram username (lower case, no @), the heard answer (its option, Other's words only with an
 * option, and the first answer's time), a version (+1 on every save, the 409 of two saves at once) and who saved last.
 * The country stays on `accounts.country`, and `accounts.display_name` is kept as « First Last » by the service.
 *
 * `account_tastes`: the favourite pieces (PIECE, a type) and finishes (FINISH, a variant's label) of an account, chosen
 * from the catalogue in YOUR PROFILE. Kept by their words, never by model id: a key (trimmed, single spaces, in
 * capitals, 1 to 60 characters) and the label as it read when chosen, which normalises to the key
 * (`account_tastes_label`). One row per account, kind and key; an unticked choice is a deleted row (the collector's own
 * data, as YOUR SIZES). `account_tastes_key_idx` serves Segments and the counts.
 *
 * Every foreign key leads an index (the primary keys lead the accounts'; `account_profiles_heard_option_idx`), ON DELETE
 * RESTRICT like every other. Compatible with the previous image: three tables it never reads, no ALTER TABLE accounts,
 * no row inserted. `down` drops the three tables, the schema of 0039 exactly (nothing is rolled back in production).
 * One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a
 * transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const PROFILE_SOURCES = `'COLLECTOR','STAFF'`;
const TASTE_KINDS = `'PIECE','FINISH'`;

/** Words of 1 to n characters, trimmed, with no control character nor `<` `>`. */
const words = (column: string, max: number) => `length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]<>]'`;

export const UP: readonly string[] = [
  // ── heard_options ────────────────────────────────────────────────────────
  `CREATE TABLE heard_options (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     label      text        NOT NULL CONSTRAINT heard_options_label_check CHECK (${words('label', 40)}),
     is_other   boolean     NOT NULL DEFAULT false,
     position   smallint    NOT NULL CONSTRAINT heard_options_position_check CHECK (position BETWEEN 1 AND 100),
     active     boolean     NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX heard_options_label_key ON heard_options (lower(label))`,
  // Exactly one Other.
  `CREATE UNIQUE INDEX heard_options_one_other ON heard_options (is_other) WHERE is_other`,
  `CREATE TRIGGER heard_options_touch_updated_at BEFORE UPDATE ON heard_options
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER heard_options_immutable_identity BEFORE UPDATE ON heard_options
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'is_other', 'created_at')`,

  // ── account_profiles ─────────────────────────────────────────────────────
  `CREATE TABLE account_profiles (
     account_id              uuid        PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     first_name              text        NULL CONSTRAINT account_profiles_first_name_check CHECK (${words('first_name', 50)}),
     last_name               text        NULL CONSTRAINT account_profiles_last_name_check CHECK (${words('last_name', 50)}),
     phone                   text        NULL CONSTRAINT account_profiles_phone_check CHECK (phone ~ '^\\+[1-9][0-9]{6,14}$'),
     phone_country           text        NULL CONSTRAINT account_profiles_phone_country_check CHECK (phone_country ~ '^[A-Z]{2}$'),
     birth_date              date        NULL CONSTRAINT account_profiles_birth_date_check CHECK (birth_date >= DATE '1900-01-01'),
     birth_date_by           text        NULL CONSTRAINT account_profiles_birth_date_by_check CHECK (birth_date_by IN (${PROFILE_SOURCES})),
     birth_date_at           timestamptz NULL,
     birth_date_collector_at timestamptz NULL,
     city                    text        NULL CONSTRAINT account_profiles_city_check CHECK (${words('city', 80)}),
     instagram               text        NULL CONSTRAINT account_profiles_instagram_check CHECK (instagram ~ '^[a-z0-9._]{1,30}$'),
     heard_option_id         uuid        NULL REFERENCES heard_options (id) ON DELETE RESTRICT,
     heard_other             text        NULL CONSTRAINT account_profiles_heard_other_check CHECK (${words('heard_other', 100)}),
     heard_at                timestamptz NULL,
     version                 integer     NOT NULL DEFAULT 1 CONSTRAINT account_profiles_version_check CHECK (version >= 1),
     updated_by              text        NOT NULL DEFAULT 'COLLECTOR' CONSTRAINT account_profiles_updated_by_check CHECK (updated_by IN (${PROFILE_SOURCES})),
     created_at              timestamptz NOT NULL DEFAULT now(),
     updated_at              timestamptz NOT NULL DEFAULT now(),
     -- +1 and +44 are shared by several countries: the one picked goes with the number.
     CONSTRAINT account_profiles_phone_pair CHECK ((phone IS NULL) = (phone_country IS NULL)),
     CONSTRAINT account_profiles_birth_pair CHECK ((birth_date IS NULL) = (birth_date_by IS NULL) AND (birth_date IS NULL) = (birth_date_at IS NULL)),
     CONSTRAINT account_profiles_heard_other_option CHECK (heard_other IS NULL OR heard_option_id IS NOT NULL),
     CONSTRAINT account_profiles_heard_at CHECK (heard_option_id IS NULL OR heard_at IS NOT NULL)
   )`,
  `CREATE INDEX account_profiles_heard_option_idx ON account_profiles (heard_option_id)`,
  `CREATE TRIGGER account_profiles_touch_updated_at BEFORE UPDATE ON account_profiles
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER account_profiles_immutable_identity BEFORE UPDATE ON account_profiles
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('account_id', 'created_at')`,

  // ── account_tastes ───────────────────────────────────────────────────────
  `CREATE TABLE account_tastes (
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     kind       text        NOT NULL CONSTRAINT account_tastes_kind_check CHECK (kind IN (${TASTE_KINDS})),
     value_key  text        NOT NULL,
     label      text        NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (account_id, kind, value_key),
     CONSTRAINT account_tastes_key CHECK (length(value_key) BETWEEN 1 AND 60 AND value_key = upper(value_key) AND value_key = btrim(value_key) AND value_key !~ '\\s\\s'),
     CONSTRAINT account_tastes_label CHECK (length(label) BETWEEN 1 AND 60 AND upper(regexp_replace(btrim(label), '\\s+', ' ', 'g')) = value_key)
   )`,
  `CREATE INDEX account_tastes_key_idx ON account_tastes (kind, value_key)`,
];

export const DOWN: readonly string[] = [
  `DROP TABLE IF EXISTS account_tastes`,
  `DROP TABLE IF EXISTS account_profiles`,
  `DROP TABLE IF EXISTS heard_options`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
