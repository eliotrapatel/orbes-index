/**
 * 0051 — the emails, prepared and switched off (macro scope of 2026-10-20, E0; lot M1, step M1.14): the wording the
 * console edits, the outbox every email goes through, a collector's release notices, the release notices' watermark,
 * and a recovery code that can be sent by email.
 *
 * `email_templates`: one row per kind the console has touched (`kind`, one of EMAIL_KINDS); no row is the default: off,
 * with the default words. `enabled` (DEFAULT false: every kind starts off), `subject` (1 to 150 characters, trimmed, no
 * control character, so never a header break) and `body` (1 to 5 000 characters), each NULL for the default words;
 * `updated_by` (the console member, NOT NULL: a row exists only once the console wrote it) and `updated_at`.
 *
 * `email_outbox`: every email, written in the transaction of the act that causes it and sent later by the sender loop.
 *  - `kind` (EMAIL_KINDS) and `dedupe_key` (1 to 200 characters, once: `email_outbox_dedupe_key`), so each trigger is
 *    idempotent;
 *  - who it is for: `account_id` or `preregistration_id`, at most one (`email_outbox_subject`; neither for a test the
 *    console sends to itself);
 *  - `to_address` (3 to 254 characters, trimmed, no control character), `subject` (1 to 300 characters, no control
 *    character), `body_text` and `body_html`, rendered at enqueue so the console shows exactly what was sent; none of
 *    them, nor the kind, the key, the recipient or the creation, ever changes (`email_outbox_immutable_content`);
 *  - `not_before` (when it may go: now, or a release's opening), `status` QUEUED, SENT, FAILED or CANCELLED,
 *    `attempts` (≥ 0), `last_error` (at most 300 characters, never the credentials; a FAILED row always has one);
 *  - `sent_at` exactly when SENT (`email_outbox_sent`), and `settled_at` exactly when no longer QUEUED
 *    (`email_outbox_settled`): the purge erases a row 90 days after it was sent, failed or was cancelled;
 *  - `email_outbox_due` (status, not_before) serves the sender loop; each foreign key leads its own index.
 *
 * `email_preferences`: a collector's choice, one row per account (`account_id`, the key): `release_notices` (DEFAULT
 * false: E2 is opt-in) and `changed_at`.
 *
 * `email_state`: one row (id 1), `releases_until`, the release notices' watermark. Written by the sender at its first
 * run, never by the migration.
 *
 * `account_recovery_codes`: a code is issued by ORBES Client Services (`issued_via` STAFF, DEFAULT, by its ADMIN in
 * `created_by`) or sent by email at the collector's request (EMAIL, by no one): `created_by` becomes NULL, exactly for
 * EMAIL (`account_recovery_codes_issued_by`). The open-code rule, the hash, the 30 minutes and the one use are 0005's.
 *
 * On the previous image during the roll-out: it never names the new tables; it issues a code as Client Services does,
 * with its ADMIN and without `issued_via`, which the DEFAULT makes STAFF, and it reads a code by its account, never by
 * who issued it. No row is inserted. Every foreign key leads a full index, ON DELETE RESTRICT like every other. `down`
 * refuses, naming the counts, while any template, outbox row, preference or code sent by email exists (the watermark
 * is the sender's own and goes with its table); otherwise it drops the four tables, the CHECKs and the column and gives
 * `created_by` its NOT NULL back: the schema of 0050 exactly. One statement per array entry (PGlite's extended
 * protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they
// match schema.ts.
/** The emails (schema.ts EMAIL_KINDS): E1, E2, E3, E4's three and E5's five (lot M1 plan §4.2). */
const EMAIL_KINDS = `'FOUNDING_ANNOUNCEMENT','RELEASE_NOTICE','PASSWORD_RESET','ORDER_CONFIRMED','ORDER_SHIPPED','ORDER_DELIVERED','ORDER_CANCELLED','DRAW_SELECTED','DRAW_OFFERED','WARRANTY_LABEL','CARE_LABEL'`;
/** An outbox row's status (schema.ts EMAIL_STATUSES). */
const EMAIL_STATUSES = `'QUEUED','SENT','FAILED','CANCELLED'`;
/** How a recovery code was issued (schema.ts RECOVERY_ISSUED_VIA). */
const ISSUED_VIA = `'STAFF','EMAIL'`;
/** A template's subject and body, at most (schema.ts EMAIL_TEMPLATE_SUBJECT_MAX, EMAIL_TEMPLATE_BODY_MAX). */
const TEMPLATE_SUBJECT_MAX = 150;
const TEMPLATE_BODY_MAX = 5000;
/** An email's subject as sent, its key and its last error, at most (schema.ts EMAIL_SUBJECT_MAX, EMAIL_DEDUPE_MAX, EMAIL_ERROR_MAX). */
const SUBJECT_MAX = 300;
const DEDUPE_MAX = 200;
const ERROR_MAX = 300;
/** An address, at most (services/auth.ts MAX_EMAIL). */
const EMAIL_MAX = 254;

/** One line of 1 to n characters, trimmed, with no control character (no header break). */
const line = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'`;

export const UP: readonly string[] = [
  // ── email_templates ──────────────────────────────────────────────────────
  `CREATE TABLE email_templates (
     kind        text        PRIMARY KEY CONSTRAINT email_templates_kind_check CHECK (kind IN (${EMAIL_KINDS})),
     enabled     boolean     NOT NULL DEFAULT false,
     subject     text        NULL CONSTRAINT email_templates_subject_check CHECK (${line('subject', TEMPLATE_SUBJECT_MAX)}),
     body        text        NULL CONSTRAINT email_templates_body_check CHECK (char_length(body) BETWEEN 1 AND ${TEMPLATE_BODY_MAX}),
     updated_by  uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX email_templates_updated_by_idx ON email_templates (updated_by)`,

  // ── email_outbox ─────────────────────────────────────────────────────────
  `CREATE TABLE email_outbox (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     kind               text        NOT NULL CONSTRAINT email_outbox_kind_check CHECK (kind IN (${EMAIL_KINDS})),
     dedupe_key         text        NOT NULL CONSTRAINT email_outbox_dedupe_key_check CHECK (${line('dedupe_key', DEDUPE_MAX)}),
     account_id         uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     preregistration_id uuid        NULL REFERENCES preregistrations (id) ON DELETE RESTRICT,
     to_address         text        NOT NULL CONSTRAINT email_outbox_to_address_check CHECK (char_length(to_address) BETWEEN 3 AND ${EMAIL_MAX} AND to_address = btrim(to_address) AND to_address !~ '[[:cntrl:]]'),
     subject            text        NOT NULL CONSTRAINT email_outbox_subject_check CHECK (${line('subject', SUBJECT_MAX)}),
     body_text          text        NOT NULL CONSTRAINT email_outbox_body_text_check CHECK (char_length(body_text) >= 1),
     body_html          text        NOT NULL CONSTRAINT email_outbox_body_html_check CHECK (char_length(body_html) >= 1),
     not_before         timestamptz NOT NULL DEFAULT now(),
     status             text        NOT NULL DEFAULT 'QUEUED' CONSTRAINT email_outbox_status_check CHECK (status IN (${EMAIL_STATUSES})),
     attempts           smallint    NOT NULL DEFAULT 0 CONSTRAINT email_outbox_attempts_check CHECK (attempts >= 0),
     last_error         text        NULL CONSTRAINT email_outbox_last_error_check CHECK (char_length(last_error) BETWEEN 1 AND ${ERROR_MAX}),
     created_at         timestamptz NOT NULL DEFAULT now(),
     sent_at            timestamptz NULL,
     settled_at         timestamptz NULL,
     CONSTRAINT email_outbox_dedupe_key UNIQUE (dedupe_key),
     CONSTRAINT email_outbox_subject CHECK (num_nonnulls(account_id, preregistration_id) <= 1),
     CONSTRAINT email_outbox_sent CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
     CONSTRAINT email_outbox_settled CHECK ((status = 'QUEUED') = (settled_at IS NULL)),
     CONSTRAINT email_outbox_failed CHECK (status <> 'FAILED' OR last_error IS NOT NULL)
   )`,
  // The sender loop: the QUEUED rows due, oldest first.
  `CREATE INDEX email_outbox_due ON email_outbox (status, not_before)`,
  // An account's emails (its export, its lock), a pre-registration's (its unsubscribe, its removal); each leads its foreign key.
  `CREATE INDEX email_outbox_account_idx ON email_outbox (account_id)`,
  `CREATE INDEX email_outbox_preregistration_idx ON email_outbox (preregistration_id)`,
  `CREATE TRIGGER email_outbox_immutable_content BEFORE UPDATE ON email_outbox
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'kind', 'dedupe_key', 'account_id', 'preregistration_id', 'to_address', 'subject', 'body_text', 'body_html', 'created_at')`,

  // ── email_preferences ────────────────────────────────────────────────────
  `CREATE TABLE email_preferences (
     account_id      uuid        PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     release_notices boolean     NOT NULL DEFAULT false,
     changed_at      timestamptz NOT NULL DEFAULT now()
   )`,

  // ── email_state ──────────────────────────────────────────────────────────
  `CREATE TABLE email_state (
     id             smallint    PRIMARY KEY DEFAULT 1 CONSTRAINT email_state_id_check CHECK (id = 1),
     releases_until timestamptz NOT NULL
   )`,

  // ── account_recovery_codes: a code sent by email ─────────────────────────
  `ALTER TABLE account_recovery_codes ADD COLUMN issued_via text NOT NULL DEFAULT 'STAFF' CONSTRAINT account_recovery_codes_issued_via_check CHECK (issued_via IN (${ISSUED_VIA}))`,
  `ALTER TABLE account_recovery_codes ALTER COLUMN created_by DROP NOT NULL`,
  `ALTER TABLE account_recovery_codes ADD CONSTRAINT account_recovery_codes_issued_by CHECK ((issued_via = 'STAFF') = (created_by IS NOT NULL))`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no email: refused while any template, email, preference or code sent by email exists.
  `DO $$
   DECLARE templates bigint; emails bigint; preferences bigint; codes bigint;
   BEGIN
     SELECT count(*) INTO templates FROM email_templates;
     SELECT count(*) INTO emails FROM email_outbox;
     SELECT count(*) INTO preferences FROM email_preferences;
     SELECT count(*) INTO codes FROM account_recovery_codes WHERE issued_via = 'EMAIL';
     IF templates > 0 OR emails > 0 OR preferences > 0 OR codes > 0 THEN
       RAISE EXCEPTION 'migration 0051_emails cannot be rolled back: % email templates, % emails, % email preferences and % recovery codes sent by email exist', templates, emails, preferences, codes;
     END IF;
   END $$`,
  `ALTER TABLE account_recovery_codes DROP CONSTRAINT IF EXISTS account_recovery_codes_issued_by`,
  `ALTER TABLE account_recovery_codes ALTER COLUMN created_by SET NOT NULL`,
  `ALTER TABLE account_recovery_codes DROP COLUMN IF EXISTS issued_via`,
  `DROP TABLE IF EXISTS email_state`,
  `DROP TABLE IF EXISTS email_preferences`,
  `DROP TABLE IF EXISTS email_outbox`,
  `DROP TABLE IF EXISTS email_templates`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
