/**
 * 0008 — Retail mode (A-08): the RETAIL role, the register of points of sale,
 * the point of sale of a warranty, the console user behind a staff scan and the
 * SALE_ACTIVATION scan token.
 *
 *  - `admin_users.role` accepts RETAIL: a seller's console account, ranked under
 *    AUDITOR (http/sessions.ts), which reaches only the sale routes, the list of
 *    points of sale and its own session, password and second factor;
 *  - `retailers` (id, name, city, country, active): the points of sale an ADMIN
 *    keeps in the console, chosen from a list instead of typed; a retailer is
 *    never deleted (warranties point to it), it is made inactive. One row per
 *    name and city, case-insensitively, so the list holds no look-alikes;
 *  - `warranties.retailer_id`: the point of sale of the activation. The free-text
 *    `retailer` stays for the history and for API callers; the name shown comes
 *    from `retailer_id` first, then from that text;
 *  - `scan_events.admin_id`: the console user who scanned (a sale lookup writes an
 *    ADMIN_TEST scan with it). Only an ADMIN_TEST scan may name one;
 *  - `scan_tokens.purpose` accepts SALE_ACTIVATION: the 10-minute token a sale
 *    lookup returns, which ties the activation to a fresh scan of that piece.
 *
 * Compatible with the previous image: every new column is nullable, the new
 * table is unknown to it, and code that does not know RETAIL ranks it at 0
 * (refused everywhere). `down` restores the previous schema exactly, and with
 * it drops what only this migration gave a meaning to, as it drops the
 * register itself: the outstanding SALE_ACTIVATION tokens (10-minute proofs,
 * nothing else refers to them) and the sessions of the RETAIL accounts. The
 * RETAIL accounts themselves are kept but can no longer sign in: they become
 * AUDITOR and disabled (`disabled_at` set, an earlier one kept). Deleting them
 * could fail: other tables point to a console user with ON DELETE RESTRICT
 * (a case handled, 0004 `scan_reports.handled_by`; a recovery code issued,
 * 0005 `account_recovery_codes.created_by`), and a member of the team stepped
 * down to RETAIL keeps what they did before. AUDITOR is the lowest role the
 * previous schema knows; an ADMIN who re-enables such an account gives it
 * AUDITOR rights (DATABASE §9.1). The name of each warranty's point of sale is
 * first copied into the free-text `retailer` where that is empty, so the
 * history keeps it.
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check`,
  `ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('ADMIN','OPERATOR','AUDITOR','RETAIL'))`,

  `CREATE TABLE retailers (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
     city       text        NULL CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 80),
     country    char(2)     NULL CHECK (country ~ '^[A-Z]{2}$'),
     active     boolean     NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX retailers_name_city_unique ON retailers (lower(name), lower(coalesce(city, '')))`,
  `CREATE TRIGGER retailers_touch_updated_at BEFORE UPDATE ON retailers
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
  `CREATE TRIGGER retailers_no_delete BEFORE DELETE ON retailers
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('retailers are made inactive, never deleted')`,

  `ALTER TABLE warranties ADD COLUMN retailer_id uuid NULL REFERENCES retailers (id) ON DELETE RESTRICT`,
  `CREATE INDEX warranties_retailer_id_idx ON warranties (retailer_id)`,

  `ALTER TABLE scan_events ADD COLUMN admin_id uuid NULL REFERENCES admin_users (id) ON DELETE RESTRICT`,
  `ALTER TABLE scan_events ADD CONSTRAINT scan_events_admin_id_admin_test CHECK (admin_id IS NULL OR event_type = 'ADMIN_TEST')`,
  `CREATE INDEX scan_events_admin_id_idx ON scan_events (admin_id)`,

  `ALTER TABLE scan_tokens DROP CONSTRAINT scan_tokens_purpose_check`,
  `ALTER TABLE scan_tokens ADD CONSTRAINT scan_tokens_purpose_check CHECK (purpose IN ('FIRST_REGISTRATION','SALE_ACTIVATION'))`,
];

export const DOWN: readonly string[] = [
  `DELETE FROM scan_tokens WHERE purpose = 'SALE_ACTIVATION'`,
  `ALTER TABLE scan_tokens DROP CONSTRAINT scan_tokens_purpose_check`,
  `ALTER TABLE scan_tokens ADD CONSTRAINT scan_tokens_purpose_check CHECK (purpose IN ('FIRST_REGISTRATION'))`,

  `DROP INDEX IF EXISTS scan_events_admin_id_idx`,
  `ALTER TABLE scan_events DROP CONSTRAINT IF EXISTS scan_events_admin_id_admin_test`,
  `ALTER TABLE scan_events DROP COLUMN IF EXISTS admin_id`,

  `UPDATE warranties w SET retailer = r.name FROM retailers r WHERE w.retailer_id = r.id AND w.retailer IS NULL`,
  `DROP INDEX IF EXISTS warranties_retailer_id_idx`,
  `ALTER TABLE warranties DROP COLUMN IF EXISTS retailer_id`,

  `DROP TABLE IF EXISTS retailers`,

  // The sellers' sessions end; their accounts stay (other tables may point to them) but cannot sign in.
  `DELETE FROM sessions WHERE subject_type = 'admin' AND subject_id IN (SELECT id FROM admin_users WHERE role = 'RETAIL')`,
  `UPDATE admin_users SET role = 'AUDITOR', disabled_at = COALESCE(disabled_at, now()) WHERE role = 'RETAIL'`,
  `ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check`,
  `ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('ADMIN','OPERATOR','AUDITOR'))`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
