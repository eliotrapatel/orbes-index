/**
 * 0064 — partner-paid experiences (macro scope of 2026-10-20, K49 P1, P2, P3 and P4; lot M4 plan §2.2, step M4.5): a
 * brand that pays ORBES for an experience offered to the circle, the deals it signs, the invoices ORBES issues to it in
 * their own series, the circle's invitations linked to a deal, and the guests who chose to share their name with it.
 * The partner pays by its own means (a transfer), outside the platform and any store (S1–S7): nothing here is a sale.
 * The first M4 attempt's 0059_partners, renumbered after ONE QUEUE's 0058–0062 and M4's 0063_margin.
 *
 * `partners`: one row per brand (P1).
 *  - `brand` (1 to 80 characters, one line, trimmed; unique whatever the case, `partners_brand_key`), as the circle's
 *    invitation shows it ("WITH <BRAND>");
 *  - its contact: `contact_name` (≤ 120, one line), `contact_email` (3 to 254, trimmed, as the founding list's),
 *    `contact_phone` (≤ 40, one line); each NULL when unknown;
 *  - its billing details, printed on its invoices: `billing_name` (≤ 120, one line), `billing_address` (≤ 1 000, line
 *    breaks kept), `billing_country` (ISO 3166-1 alpha-2), `company_number` (≤ 60, one line; printed when given); the
 *    service refuses to invoice without the name, the address and the country;
 *  - `note` (≤ 2 000, line breaks kept), `active` (ACTIVE; false: SET ASIDE, offered for no new experience);
 *  - `created_at`, `created_by` (the staff member; NULL for a script), `updated_at` (stamped by `orbes_touch_updated_at`);
 *    its id, creation and author never change. A partner is set aside, never deleted.
 *
 * `partner_experiences`: one deal of a partner (P1): `title` (1 to 120, one line), `event_on` (the event's date in Paris),
 * the `amount_minor` (1 to 100 000 000) the partner pays and its `currency` (a house currency), a `note` (≤ 2 000).
 *  - `status` DRAFT → INVOICED (its invoice issued, `invoiced_at`) → PAID (`paid_on`, the date the money arrived, entered
 *    by ORBES, with `paid_recorded_at` and `paid_recorded_by`), or CANCELLED (`cancelled_at`, `cancelled_by`) from any of
 *    them; each state with its own times only (`partner_experiences_status_times`): a DRAFT has none, an INVOICED its
 *    invoice time, a PAID its invoice time and paid date, a CANCELLED its cancellation and, when it had them, its
 *    invoice time and paid date (an invoiced one gets its credit note); the payment recorded whole
 *    (`partner_experiences_paid`), the authors with their times (`partner_experiences_by`), the times in order
 *    (`partner_experiences_times`);
 *  - `created_at`, `created_by`, `updated_at`; its id, partner, creation and author never change. An experience is
 *    cancelled, never deleted.
 *
 * `partner_invoices`: the invoices ORBES issues to a partner and their credit notes (P1, P4), apart from the collectors'
 * (`invoices`, 0022): `kind` INVOICE or CREDIT_NOTE, numbered in their own series per kind and UTC year of issue
 * (`partner_invoices_number_key` on (kind, year, sequence): P-2026-0001 and PC-2026-0001, allocated under
 * ADVISORY_LOCK.PARTNER_INVOICE_NUMBER); its `experience_id`, one INVOICE per experience
 * (`partner_invoices_one_per_experience`); a credit note names the invoice it cancels (`credits_invoice_id`, once,
 * `partner_invoices_credits_key`; with CREDIT_NOTE only, `partner_invoices_credit`). Its content as issued: the
 * `issuer` (INVOICE_ISSUER at the time), the `buyer` (the partner's billing details at the time), the `lines` (at least
 * one), the `currency` and `total_minor` (1 to 100 000 000), without VAT; `issued_at`, `issued_by` (the ADMIN; NULL for a
 * script). Never changed nor deleted (`partner_invoices_immutable`, as 0022's `invoices_immutable`).
 *
 * `circle_posts.partner_experience_id`: the experience an invitation is for (P2), on an invitation whose experience is
 * PARTNER_EXPERIENCE only (`circle_posts_partner_experience`, never passed by a NULL experience); several invitations
 * may name one experience.
 *
 * `circle_rsvps.share_name` and `share_name_at` (P3): a guest who answered YES chose to share their name with the
 * partner (false by default), and when; on a YES only (`circle_rsvps_share_name_yes`), the time with the choice
 * (`circle_rsvps_share_name`). Answering NO clears it (the service, in the same update).
 *
 * Every foreign key ON DELETE RESTRICT, at the head of an index. On the previous image during the roll-out (Q3's, at
 * 0062: lot M4's migrations ship together): three tables and three columns it never reads; an answer it writes takes
 * `share_name` false, its default; an invitation it writes is linked to no experience. No row is inserted. `down`
 * refuses while a partner, an experience, a partner invoice, a linked invitation or a shared name exists, naming the
 * counts; otherwise it restores the schema of 0063 exactly. One statement per array entry (PGlite's extended protocol);
 * Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** A brand, at most (schema.ts PARTNER_BRAND_MAX). */
const BRAND_MAX = 80;
/** A contact's or a billing name, at most (schema.ts PARTNER_NAME_MAX). */
const NAME_MAX = 120;
/** An email address, at most (schema.ts PARTNER_EMAIL_MAX), as the founding list's. */
const EMAIL_MAX = 254;
/** A phone number, at most (schema.ts PARTNER_PHONE_MAX). */
const PHONE_MAX = 40;
/** A billing address, at most (schema.ts PARTNER_BILLING_ADDRESS_MAX). */
const ADDRESS_MAX = 1000;
/** A company number, at most (schema.ts PARTNER_COMPANY_NUMBER_MAX). */
const COMPANY_NUMBER_MAX = 60;
/** A partner's or an experience's note, at most (schema.ts PARTNER_NOTE_MAX). */
const NOTE_MAX = 2000;
/** An experience's title, at most (schema.ts PARTNER_EXPERIENCE_TITLE_MAX). */
const TITLE_MAX = 120;
/** An experience's amount and an invoice's total, at most, in minor units (schema.ts PARTNER_AMOUNT_MINOR_MAX). */
const AMOUNT_MAX = 100000000;
/** The house currencies (schema.ts HOUSE_CURRENCIES). */
const CURRENCIES = `'EUR','GBP','USD','CHF'`;
/** An experience's states (schema.ts PARTNER_EXPERIENCE_STATUSES). */
const STATUSES = `'DRAFT','INVOICED','PAID','CANCELLED'`;
/** A partner invoice's kinds (schema.ts PARTNER_INVOICE_KINDS). */
const KINDS = `'INVOICE','CREDIT_NOTE'`;

/** One line of 1 to n characters, trimmed, no control character. */
const line = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'`;
/** Text of 1 to n characters, trimmed (line breaks inside kept). */
const text = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column})`;
/** A staff member, NULL for a script. */
const admin = (table: string, column: string) =>
  `${column} uuid NULL CONSTRAINT ${table}_${column}_fkey REFERENCES admin_users (id) ON DELETE RESTRICT`;

export const UP: readonly string[] = [
  // ── partners ─────────────────────────────────────────────────────────────
  `CREATE TABLE partners (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     brand           text        NOT NULL CONSTRAINT partners_brand_check CHECK (${line('brand', BRAND_MAX)}),
     contact_name    text        NULL CONSTRAINT partners_contact_name_check CHECK (${line('contact_name', NAME_MAX)}),
     contact_email   text        NULL CONSTRAINT partners_contact_email_check CHECK (char_length(contact_email) BETWEEN 3 AND ${EMAIL_MAX} AND contact_email = btrim(contact_email) AND contact_email !~ '[[:cntrl:]]'),
     contact_phone   text        NULL CONSTRAINT partners_contact_phone_check CHECK (${line('contact_phone', PHONE_MAX)}),
     billing_name    text        NULL CONSTRAINT partners_billing_name_check CHECK (${line('billing_name', NAME_MAX)}),
     billing_address text        NULL CONSTRAINT partners_billing_address_check CHECK (${text('billing_address', ADDRESS_MAX)}),
     billing_country char(2)     NULL CONSTRAINT partners_billing_country_check CHECK (billing_country ~ '^[A-Z]{2}$'),
     company_number  text        NULL CONSTRAINT partners_company_number_check CHECK (${line('company_number', COMPANY_NUMBER_MAX)}),
     note            text        NULL CONSTRAINT partners_note_check CHECK (${text('note', NOTE_MAX)}),
     active          boolean     NOT NULL DEFAULT true,
     created_at      timestamptz NOT NULL DEFAULT now(),
     ${admin('partners', 'created_by')},
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX partners_brand_key ON partners (lower(brand))`,
  `CREATE INDEX partners_created_by_idx ON partners (created_by)`,
  `CREATE TRIGGER partners_immutable_identity BEFORE UPDATE ON partners
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at', 'created_by')`,
  `CREATE TRIGGER partners_touch_updated_at BEFORE UPDATE ON partners
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER partners_no_delete BEFORE DELETE ON partners
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('partners are set aside, never deleted')`,
  `CREATE TRIGGER partners_no_truncate BEFORE TRUNCATE ON partners
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('partners are set aside, never deleted')`,

  // ── partner_experiences ──────────────────────────────────────────────────
  `CREATE TABLE partner_experiences (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     partner_id       uuid        NOT NULL CONSTRAINT partner_experiences_partner_id_fkey REFERENCES partners (id) ON DELETE RESTRICT,
     title            text        NOT NULL CONSTRAINT partner_experiences_title_check CHECK (${line('title', TITLE_MAX)}),
     event_on         date        NOT NULL,
     amount_minor     bigint      NOT NULL CONSTRAINT partner_experiences_amount_minor_check CHECK (amount_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     currency         text        NOT NULL CONSTRAINT partner_experiences_currency_check CHECK (currency IN (${CURRENCIES})),
     note             text        NULL CONSTRAINT partner_experiences_note_check CHECK (${text('note', NOTE_MAX)}),
     status           text        NOT NULL DEFAULT 'DRAFT' CONSTRAINT partner_experiences_status_check CHECK (status IN (${STATUSES})),
     invoiced_at      timestamptz NULL,
     paid_on          date        NULL,
     paid_recorded_at timestamptz NULL,
     ${admin('partner_experiences', 'paid_recorded_by')},
     cancelled_at     timestamptz NULL,
     ${admin('partner_experiences', 'cancelled_by')},
     created_at       timestamptz NOT NULL DEFAULT now(),
     ${admin('partner_experiences', 'created_by')},
     updated_at       timestamptz NOT NULL DEFAULT now(),
     -- Each state with its own times, and only its own; a cancelled one keeps those it had.
     CONSTRAINT partner_experiences_status_times CHECK (CASE status
       WHEN 'DRAFT' THEN invoiced_at IS NULL AND paid_on IS NULL AND cancelled_at IS NULL
       WHEN 'INVOICED' THEN invoiced_at IS NOT NULL AND paid_on IS NULL AND cancelled_at IS NULL
       WHEN 'PAID' THEN invoiced_at IS NOT NULL AND paid_on IS NOT NULL AND cancelled_at IS NULL
       WHEN 'CANCELLED' THEN cancelled_at IS NOT NULL AND (paid_on IS NULL OR invoiced_at IS NOT NULL)
     END),
     CONSTRAINT partner_experiences_paid CHECK ((paid_on IS NULL) = (paid_recorded_at IS NULL)),
     CONSTRAINT partner_experiences_by CHECK (
       (paid_recorded_by IS NULL OR paid_recorded_at IS NOT NULL) AND (cancelled_by IS NULL OR cancelled_at IS NOT NULL)),
     CONSTRAINT partner_experiences_times CHECK (
       invoiced_at >= created_at AND paid_recorded_at >= invoiced_at AND cancelled_at >= created_at AND cancelled_at >= invoiced_at)
   )`,
  `CREATE INDEX partner_experiences_partner_idx ON partner_experiences (partner_id, event_on)`,
  `CREATE INDEX partner_experiences_paid_recorded_by_idx ON partner_experiences (paid_recorded_by)`,
  `CREATE INDEX partner_experiences_cancelled_by_idx ON partner_experiences (cancelled_by)`,
  `CREATE INDEX partner_experiences_created_by_idx ON partner_experiences (created_by)`,
  // GROWTH's partner income, paid by its date.
  `CREATE INDEX partner_experiences_paid_on_idx ON partner_experiences (paid_on) WHERE paid_on IS NOT NULL`,
  `CREATE TRIGGER partner_experiences_immutable_identity BEFORE UPDATE ON partner_experiences
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'partner_id', 'created_at', 'created_by')`,
  `CREATE TRIGGER partner_experiences_touch_updated_at BEFORE UPDATE ON partner_experiences
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER partner_experiences_no_delete BEFORE DELETE ON partner_experiences
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('partner experiences are cancelled, never deleted')`,
  `CREATE TRIGGER partner_experiences_no_truncate BEFORE TRUNCATE ON partner_experiences
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('partner experiences are cancelled, never deleted')`,

  // ── partner_invoices ─────────────────────────────────────────────────────
  `CREATE TABLE partner_invoices (
     id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     kind               text        NOT NULL CONSTRAINT partner_invoices_kind_check CHECK (kind IN (${KINDS})),
     year               smallint    NOT NULL CONSTRAINT partner_invoices_year_check CHECK (year BETWEEN 2000 AND 2099),
     sequence           integer     NOT NULL CONSTRAINT partner_invoices_sequence_check CHECK (sequence BETWEEN 1 AND 999999),
     experience_id      uuid        NOT NULL CONSTRAINT partner_invoices_experience_id_fkey REFERENCES partner_experiences (id) ON DELETE RESTRICT,
     credits_invoice_id uuid        NULL CONSTRAINT partner_invoices_credits_invoice_id_fkey REFERENCES partner_invoices (id) ON DELETE RESTRICT,
     issuer             jsonb       NOT NULL CONSTRAINT partner_invoices_issuer_check CHECK (jsonb_typeof(issuer) = 'object'),
     buyer              jsonb       NOT NULL CONSTRAINT partner_invoices_buyer_check CHECK (jsonb_typeof(buyer) = 'object'),
     lines              jsonb       NOT NULL CONSTRAINT partner_invoices_lines_check CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 1),
     currency           text        NOT NULL CONSTRAINT partner_invoices_currency_check CHECK (currency IN (${CURRENCIES})),
     total_minor        bigint      NOT NULL CONSTRAINT partner_invoices_total_minor_check CHECK (total_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     issued_at          timestamptz NOT NULL DEFAULT now(),
     ${admin('partner_invoices', 'issued_by')},
     CONSTRAINT partner_invoices_number_key UNIQUE (kind, year, sequence),
     CONSTRAINT partner_invoices_credits_key UNIQUE (credits_invoice_id),
     CONSTRAINT partner_invoices_credit CHECK ((kind = 'CREDIT_NOTE') = (credits_invoice_id IS NOT NULL))
   )`,
  `CREATE INDEX partner_invoices_experience_idx ON partner_invoices (experience_id)`,
  // The month's partner invoices (Invoices → Partners, the accountant's CSV) and GROWTH's: by the time of issue.
  `CREATE INDEX partner_invoices_issued_idx ON partner_invoices (issued_at)`,
  `CREATE INDEX partner_invoices_issued_by_idx ON partner_invoices (issued_by)`,
  // One invoice per experience.
  `CREATE UNIQUE INDEX partner_invoices_one_per_experience ON partner_invoices (experience_id) WHERE kind = 'INVOICE'`,
  `CREATE TRIGGER partner_invoices_immutable BEFORE UPDATE OR DELETE ON partner_invoices
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a partner invoice is never changed; a credit note follows it')`,
  `CREATE TRIGGER partner_invoices_no_truncate BEFORE TRUNCATE ON partner_invoices
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('a partner invoice is never changed; a credit note follows it')`,

  // ── circle_posts: an invitation for a partner's experience ───────────────
  `ALTER TABLE circle_posts ADD COLUMN partner_experience_id uuid NULL
     CONSTRAINT circle_posts_partner_experience_id_fkey REFERENCES partner_experiences (id) ON DELETE RESTRICT`,
  `ALTER TABLE circle_posts ADD CONSTRAINT circle_posts_partner_experience
     CHECK (partner_experience_id IS NULL OR experience IS NOT DISTINCT FROM 'PARTNER_EXPERIENCE')`,
  `CREATE INDEX circle_posts_partner_experience_idx ON circle_posts (partner_experience_id)`,

  // ── circle_rsvps: a guest's name shared with the partner ─────────────────
  `ALTER TABLE circle_rsvps ADD COLUMN share_name boolean NOT NULL DEFAULT false`,
  `ALTER TABLE circle_rsvps ADD COLUMN share_name_at timestamptz NULL`,
  `ALTER TABLE circle_rsvps ADD CONSTRAINT circle_rsvps_share_name CHECK (share_name = (share_name_at IS NOT NULL))`,
  `ALTER TABLE circle_rsvps ADD CONSTRAINT circle_rsvps_share_name_yes CHECK (NOT share_name OR answer = 'YES')`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no partner, experience, partner invoice, linked invitation nor shared name: refused while
  // any would be lost.
  `DO $$
   DECLARE partners_n bigint; experiences_n bigint; invoices_n bigint; posts_n bigint; shared_n bigint;
   BEGIN
     SELECT count(*) INTO partners_n FROM partners;
     SELECT count(*) INTO experiences_n FROM partner_experiences;
     SELECT count(*) INTO invoices_n FROM partner_invoices;
     SELECT count(*) INTO posts_n FROM circle_posts WHERE partner_experience_id IS NOT NULL;
     SELECT count(*) INTO shared_n FROM circle_rsvps WHERE share_name;
     IF partners_n > 0 OR experiences_n > 0 OR invoices_n > 0 OR posts_n > 0 OR shared_n > 0 THEN
       RAISE EXCEPTION 'migration 0064_partners cannot be rolled back: % partners, % partner experiences, % partner invoices, % invitations linked to an experience and % names shared exist', partners_n, experiences_n, invoices_n, posts_n, shared_n;
     END IF;
   END $$`,
  `ALTER TABLE circle_rsvps DROP CONSTRAINT IF EXISTS circle_rsvps_share_name_yes`,
  `ALTER TABLE circle_rsvps DROP CONSTRAINT IF EXISTS circle_rsvps_share_name`,
  `ALTER TABLE circle_rsvps DROP COLUMN IF EXISTS share_name_at`,
  `ALTER TABLE circle_rsvps DROP COLUMN IF EXISTS share_name`,
  `DROP INDEX IF EXISTS circle_posts_partner_experience_idx`,
  `ALTER TABLE circle_posts DROP CONSTRAINT IF EXISTS circle_posts_partner_experience`,
  `ALTER TABLE circle_posts DROP COLUMN IF EXISTS partner_experience_id`,
  `DROP TABLE IF EXISTS partner_invoices`,
  `DROP TABLE IF EXISTS partner_experiences`,
  `DROP TABLE IF EXISTS partners`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
