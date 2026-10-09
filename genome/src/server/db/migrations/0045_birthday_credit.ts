/**
 * 0045 — The birthday credit (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.4.2, step 6.1): the lot's sixth
 * migration, the first of deployment I2, after 0044_client_notes and before the engagement score's 0046.
 *
 * `club_program_settings` gains THE PROGRAM's birthday credit, beside the tiers' credits: whether it is given
 * (`birthday_credit_on`, true; a switch of its own, so switching it off keeps the amount for when it comes back), its
 * amount in minor units of the credit's currency (`birthday_credit_minor`, 2000: € 20.00; 1 to 100 000 000) and how many
 * days it is valid from the birthday, the birthday counting as day 1 (`birthday_credit_days`, 30; 1 to 365). The single
 * row is still updated whole; a row of before takes the columns' defaults.
 *
 * `tier_grants` takes the birthday credits as kind BIRTHDAY, so `credit_uses` (its foreign key, its open-use key, its
 * releases), the balances, Apply credit, the invoice line, the export and END TEST work on them unchanged:
 *   - `tier_grants_kind_check` gains BIRTHDAY;
 *   - `tier` becomes nullable: a BIRTHDAY grant has none, every other has one (`tier_grants_tier_check` stays, NULL
 *     passes it); `birthday_on`, the Paris day of the birthday it was given for, only on a BIRTHDAY grant
 *     (`tier_grants_birthday`);
 *   - `tier_grants_credit` holds the amount, currency and expiry on a CREDIT or a BIRTHDAY grant, none on a GIFT;
 *   - `tier_grants_birthday_key`: one BIRTHDAY grant per account and birthday, so a grant run twice never gives two
 *     (`tier_grants_once` is untouched: a NULL tier never conflicts, and the tiers keep their « once, ever »);
 *   - `tier_grants_immutable` re-created with `birthday_on` in its list. `tier_grants_no_delete` and `credit_uses` are
 *     unchanged.
 *
 * No foreign key is added. Compatible with the previous image: it inserts program rows without the new columns (their
 * defaults) and grants with a tier, and reads its credits filtered `kind = 'CREDIT'` (and its gifts `'GIFT'`), so a
 * BIRTHDAY row is invisible to its credit paths. No row is inserted. `down` refuses, naming the count, while any
 * BIRTHDAY grant exists (the previous image does not know them); otherwise it restores 0027's constraints, trigger and
 * `tier NOT NULL`, drops `birthday_on` and the key, and drops the three program columns: the schema of 0044 exactly
 * (nothing is rolled back in production). One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const GRANT_KINDS_0027 = `'GIFT','CREDIT'`;
const GRANT_KINDS = `'GIFT','CREDIT','BIRTHDAY'`;

/** An amount, as an order's (0022). */
const AMOUNT_MAX = 100_000_000;
/** A birthday credit's validity, in days from the birthday. */
const DAYS_MAX = 365;

/** 0027's guarded columns of a grant. */
const IMMUTABLE_0027 = ['id', 'account_id', 'tier', 'kind', 'granted_at', 'amount_minor', 'currency', 'expires_at'];
const quoted = (cols: readonly string[]) => cols.map((c) => `'${c}'`).join(', ');

/** tier_grants_credit as 0027 wrote it. */
const CREDIT_0027 = `(kind = 'CREDIT') = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)`;
/** tier_grants_credit with BIRTHDAY: an amount, currency and expiry on a credit of either kind, none on a GIFT. */
const CREDIT = `(kind IN ('CREDIT', 'BIRTHDAY')) = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)`;

export const UP: readonly string[] = [
  // ── club_program_settings: THE PROGRAM's birthday credit ─────────────────
  `ALTER TABLE club_program_settings ADD COLUMN birthday_credit_on boolean NOT NULL DEFAULT true`,
  `ALTER TABLE club_program_settings ADD COLUMN birthday_credit_minor integer NOT NULL DEFAULT 2000 CHECK (birthday_credit_minor BETWEEN 1 AND ${AMOUNT_MAX})`,
  `ALTER TABLE club_program_settings ADD COLUMN birthday_credit_days smallint NOT NULL DEFAULT 30 CHECK (birthday_credit_days BETWEEN 1 AND ${DAYS_MAX})`,

  // ── tier_grants: the kind BIRTHDAY ───────────────────────────────────────
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_kind_check`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_kind_check CHECK (kind IN (${GRANT_KINDS}))`,
  `ALTER TABLE tier_grants ALTER COLUMN tier DROP NOT NULL`,
  `ALTER TABLE tier_grants ADD COLUMN birthday_on date NULL`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_birthday CHECK ((kind = 'BIRTHDAY') = (tier IS NULL) AND (kind = 'BIRTHDAY') = (birthday_on IS NOT NULL))`,
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_credit`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_credit CHECK (${CREDIT})`,
  // One birthday credit per account and birthday: a grant run twice gives one.
  `CREATE UNIQUE INDEX tier_grants_birthday_key ON tier_grants (account_id, birthday_on) WHERE kind = 'BIRTHDAY'`,
  `DROP TRIGGER tier_grants_immutable ON tier_grants`,
  `CREATE TRIGGER tier_grants_immutable BEFORE UPDATE ON tier_grants
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted([...IMMUTABLE_0027, 'birthday_on'])})`,
];

export const DOWN: readonly string[] = [
  // The previous image does not know a birthday credit: refused while any exists (a grant is never deleted).
  `DO $$
   DECLARE birthdays bigint;
   BEGIN
     SELECT count(*) INTO birthdays FROM tier_grants WHERE kind = 'BIRTHDAY';
     IF birthdays > 0 THEN
       RAISE EXCEPTION 'migration 0045_birthday_credit cannot be rolled back: % birthday credits exist', birthdays;
     END IF;
   END $$`,
  `DROP TRIGGER IF EXISTS tier_grants_immutable ON tier_grants`,
  `CREATE TRIGGER tier_grants_immutable BEFORE UPDATE ON tier_grants
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(IMMUTABLE_0027)})`,
  `DROP INDEX IF EXISTS tier_grants_birthday_key`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_credit`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_credit CHECK (${CREDIT_0027})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_birthday`,
  `ALTER TABLE tier_grants DROP COLUMN IF EXISTS birthday_on`,
  `ALTER TABLE tier_grants ALTER COLUMN tier SET NOT NULL`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_kind_check`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_kind_check CHECK (kind IN (${GRANT_KINDS_0027}))`,
  `ALTER TABLE club_program_settings DROP COLUMN IF EXISTS birthday_credit_days`,
  `ALTER TABLE club_program_settings DROP COLUMN IF EXISTS birthday_credit_minor`,
  `ALTER TABLE club_program_settings DROP COLUMN IF EXISTS birthday_credit_on`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
