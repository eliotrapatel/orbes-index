/**
 * 0050 — the founding list in the platform (macro scope of 2026-10-20, F2, F3 and F4; lot M1, step M1.10): the people
 * the theorbes.com form adds, where they came from, and the account each one becomes; a link that goes to theorbes.com;
 * a draw that may be opened to a segment first.
 *
 * `preregistrations`: one row per address on the founding list (F2, F3), never imported (F5: start fresh).
 *  - `email` as typed (trimmed, at most 254 characters) and `email_normalized`, its lookup key, once
 *    (`preregistrations_email_normalized_key`): the same address sent twice leaves the row as it was;
 *  - `first_name` (1 to 80 characters, trimmed, no control character nor `<` `>`, as shared/profile-rules.ts cleans
 *    words) and `country` (two capital letters, shared/countries.ts);
 *  - `consent_at` and `consent_version` (the LEGAL_VERSION shown, a `YYYY-MM-DD` date): never without them;
 *  - `source_id`: where the person came from (acquisition_sources: the link's `o` code, the campaign's utm_ tags, the
 *    referring site, or DIRECT when nothing), never NULL;
 *  - `account_id` and `matched_at`, both or neither (`preregistrations_matched`): the ORBES account with the same
 *    address, matched at once or at its sign-up;
 *  - `unsubscribed_at`: the person asked to receive nothing more; the row stays, so the address is never written to
 *    again;
 *  - its identity, address, consent, source and creation never change (`preregistrations_immutable_identity`); removal
 *    on request deletes the row.
 *
 * `links.destination` gains LANDING (`links_destination_check` re-created): theorbes.com, the founding list's page.
 * LANDING names neither a release nor a model, so `links_destination` holds as it is.
 *
 * `drops_draw_plus` (0023) is re-created without `access_segment_id`, so a DRAW may be opened to a segment's members
 * (F4: today segments gate LIVE access only); every other LIVE-only setting stays NULL for a draw, and an after-room
 * still has no segment (`drops_after_room`, unchanged).
 *
 * Every foreign key leads an index (`preregistrations_source_idx`, `preregistrations_account_idx`); ON DELETE RESTRICT
 * like every other. On the previous image during the roll-out: it never names the new table; it never writes LANDING
 * nor a draw's segment, which only the new image's console makes. No row is inserted. `down` refuses, naming the
 * counts, while any pre-registration, LANDING link or draw with a segment exists; otherwise it drops the table and
 * restores 0043's destinations and 0023's `drops_draw_plus`: the schema of 0049 exactly. One statement per array entry
 * (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts and
// migrations.test.ts check they match schema.ts.
/** 0043's destinations, and this migration's with LANDING (schema.ts LINK_DESTINATIONS). */
const LINK_DESTINATIONS_0043 = `'NOW','RELEASES','RELEASE','COLLECTION','MODEL','CLUB','HOW'`;
const LINK_DESTINATIONS = `'NOW','RELEASES','RELEASE','COLLECTION','MODEL','CLUB','HOW','LANDING'`;
/** A pre-registration's first name, at most (schema.ts FOUNDING_FIRST_NAME_MAX). */
const FIRST_NAME_MAX = 80;
/** An address, at most (services/auth.ts MAX_EMAIL). */
const EMAIL_MAX = 254;

/** 0023's LIVE-only columns of `drops`, in 0023's order: `drops_draw_plus` held every one NULL for a DRAW. */
const LIVE_ONLY_0023 = [
  'parent_drop_id', 'after_room_delay_minutes', 'after_room_length_minutes', 'surprise_enabled', 'surprise_text', 'min_participations', 'access_segment_id',
  'access_combine', 'question_enabled', 'question_text', 'question_answers',
];
/** From this migration a DRAW may have a segment: every other one stays LIVE only. */
const LIVE_ONLY = LIVE_ONLY_0023.filter((c) => c !== 'access_segment_id');
const drawPlus = (columns: readonly string[]) => `mode = 'LIVE' OR (${columns.map((c) => `${c} IS NULL`).join(' AND ')})`;

/** Words of 1 to n characters, trimmed, with no control character nor `<` `>` (0040's names). */
const words = (column: string, max: number) => `length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]<>]'`;

export const UP: readonly string[] = [
  // ── preregistrations ─────────────────────────────────────────────────────
  `CREATE TABLE preregistrations (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     email            text        NOT NULL CONSTRAINT preregistrations_email_check CHECK (char_length(email) BETWEEN 3 AND ${EMAIL_MAX} AND email = btrim(email)),
     email_normalized text        NOT NULL CONSTRAINT preregistrations_email_normalized_check CHECK (char_length(email_normalized) BETWEEN 3 AND ${EMAIL_MAX}),
     first_name       text        NOT NULL CONSTRAINT preregistrations_first_name_check CHECK (${words('first_name', FIRST_NAME_MAX)}),
     country          char(2)     NOT NULL CONSTRAINT preregistrations_country_check CHECK (country ~ '^[A-Z]{2}$'),
     consent_at       timestamptz NOT NULL,
     consent_version  text        NOT NULL CONSTRAINT preregistrations_consent_version_check CHECK (consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
     source_id        integer     NOT NULL REFERENCES acquisition_sources (id) ON DELETE RESTRICT,
     account_id       uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     matched_at       timestamptz NULL,
     unsubscribed_at  timestamptz NULL,
     created_at       timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT preregistrations_email_normalized_key UNIQUE (email_normalized),
     CONSTRAINT preregistrations_matched CHECK ((account_id IS NULL) = (matched_at IS NULL))
   )`,
  // The summary by source; it leads the source's foreign key.
  `CREATE INDEX preregistrations_source_idx ON preregistrations (source_id)`,
  // The account's pre-registration (its sheet, its export, the FOUNDING_LIST rule); it leads the account's foreign key.
  `CREATE INDEX preregistrations_account_idx ON preregistrations (account_id)`,
  `CREATE TRIGGER preregistrations_immutable_identity BEFORE UPDATE ON preregistrations
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'email', 'email_normalized', 'consent_at', 'consent_version', 'source_id', 'created_at')`,

  // ── links: LANDING ───────────────────────────────────────────────────────
  `ALTER TABLE links DROP CONSTRAINT links_destination_check`,
  `ALTER TABLE links ADD CONSTRAINT links_destination_check CHECK (destination IN (${LINK_DESTINATIONS}))`,

  // ── drops: a draw may have a segment ─────────────────────────────────────
  `ALTER TABLE drops DROP CONSTRAINT drops_draw_plus`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_plus CHECK (${drawPlus(LIVE_ONLY)})`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no founding list, no LANDING and no draw's segment: refused while any exists.
  `DO $$
   DECLARE listed bigint; landing bigint; draws bigint;
   BEGIN
     SELECT count(*) INTO listed FROM preregistrations;
     SELECT count(*) INTO landing FROM links WHERE destination = 'LANDING';
     SELECT count(*) INTO draws FROM drops WHERE mode <> 'LIVE' AND access_segment_id IS NOT NULL;
     IF listed > 0 OR landing > 0 OR draws > 0 THEN
       RAISE EXCEPTION 'migration 0050_founding_list cannot be rolled back: % pre-registrations, % LANDING links and % draws with a segment exist', listed, landing, draws;
     END IF;
   END $$`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_draw_plus`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_plus CHECK (${drawPlus(LIVE_ONLY_0023)})`,
  `ALTER TABLE links DROP CONSTRAINT IF EXISTS links_destination_check`,
  `ALTER TABLE links ADD CONSTRAINT links_destination_check CHECK (destination IN (${LINK_DESTINATIONS_0043}))`,
  `DROP TABLE IF EXISTS preregistrations`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
