/**
 * 0048 — ORBES CARE (plan ORBES CARE of 2026-10-15, §2(c), step 1.1): the warranty chosen per model, lifetime or 2 years;
 * PRIVATE CARE for every piece from PLATINE; the warranty credit; the warranty claims.
 *
 * `models.warranty_lifetime` (boolean, NOT NULL, column default false): the model's warranty, LIFETIME (true) or 2 years
 * (false: manufacturing defects only, for the months of its category, `categories.warranty_months`). Every existing
 * model is backfilled true (the owner's answer 12: every model takes the default, Lifetime; he switches the leather
 * models to 2 years after the deploy). A NEW model's default, Lifetime, is the service's and the console's; the column's
 * false keeps a model written by plain SQL (the previous image during the roll-out, the test fixtures, the demo seed)
 * at today's 2-year behaviour.
 *
 * `warranties.lifetime` (boolean, NOT NULL, no default): the piece's warranty kind, copied from its model and following a
 * later change of it. Backfilled in this order: a VOID warranty keeps its dates (false: VOID wins); every other is
 * lifetime with no end date (its model being Lifetime), `duration_months` kept, so DOWN and a later switch to 2 years
 * give back the end date `start + duration_months`. `warranties_lifetime_open`: a lifetime warranty has no end date.
 * The trigger `warranties_kind` (function `orbes_warranty_kind`), BEFORE INSERT OR UPDATE: on INSERT, a `lifetime` left
 * NULL takes its model's choice (`models.warranty_lifetime` through the piece); then, on both, a lifetime row's end date
 * is cleared. PostgreSQL runs BEFORE ROW triggers before the NOT NULL and CHECK constraints, so the previous image's
 * inserts (which never name `lifetime`) and its activation (which writes an end date) pass on the new schema instead
 * of being refused. The new code always names `lifetime` and never writes an end date on a lifetime row, so the trigger
 * never changes its writes.
 *
 * `club_program_settings`: `care_pieces_platine` becomes nullable with the default NULL (every piece, as PALLADIUM's
 * NULL; its CHECK 0–20 kept), the saved row (`id` 1) backfilled NULL; `warranty_credit_percent` (30, 1 to 100), the
 * credit of an accepted lifetime claim after the free replacement, in percent of the piece's value.
 *
 * `tier_grants` takes the warranty credits as kind WARRANTY, following 0045's BIRTHDAY: `tier_grants_kind_check` gains
 * WARRANTY; `tier_grants_birthday` gives a WARRANTY grant no tier (and no birthday); `tier_grants_credit` holds the
 * amount, currency and expiry on it. `tier_grants_once`, the guard and `credit_uses` are unchanged (a NULL tier never
 * conflicts).
 *
 * `warranty_claims`: a claim under the piece's ORBES warranty (`basis` LIFETIME or TWO_YEARS, the piece's kind read at
 * opening, never changed) or under the legal guarantee of conformity (LEGAL), opened by Client Services from the
 * claimant's conversation (`account_id`, `conversation_id`: both, or neither for a legal claim of a buyer without an
 * account, whose receipt is in `note`). Its `status` steps OPEN → LABEL_SENT (the prepaid label: a PDF of at most 2 MiB,
 * its carrier and tracking) → RECEIVED (`received_at` and the INSPECTION record it opened) → DECIDED (`outcome`, by
 * whom and when) → DONE (`done_at`; the return's carrier, tracking and time when the piece goes back), or CANCELLED before
 * any decision. `warranty_claims_steps` holds the columns each status needs, outcome by outcome: DONE is a refusal from
 * OPEN (no label, receipt nor return), a credit of value or a refund (ORBES keeps the piece: received, no return), or any
 * other outcome received and returned; a CANCELLED claim has no record (a 2-year claim moved to the legal guarantee
 * keeps its label and receipt times and hands its record to the LEGAL claim that continues it, `continues_claim_id`).
 * `_basis_outcome` and `_basis_refusal` hold each basis to its own outcomes and refusal reasons (schema.ts
 * WARRANTY_CLAIM_OUTCOMES_BY_BASIS, WARRANTY_CLAIM_REFUSALS_BY_BASIS): the lifetime warranty a replacement, a credit
 * of value or a part credit; the 2-year warranty a repair or a replacement, never a credit; the legal guarantee its four
 * remedies, never a credit. One live claim per piece (`warranty_claims_open_once`); ONE free replacement per original
 * purchase under the lifetime warranty (`warranty_claims_free_once`, on the root piece: a replacement's claims share
 * the original's root). Its identity never changes; it is never deleted.
 *
 * `service_records`: the place of PRIVATE CARE is ORBES, no longer the atelier: the YEARLY_CARE records stored at
 * « ORBES atelier » (location and performed_by, written from services/care.ts CARE_LOCATION) are rewritten « ORBES ».
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. On the previous image during the roll-out: a
 * model it creates takes the column's false (2 years); a warranty it inserts takes its model's choice through the
 * trigger, and its activation's end date on a lifetime row is cleared; program rows and tier grants with a tier take
 * their defaults; it reads its credits filtered `kind IN ('CREDIT','BIRTHDAY')`, so a WARRANTY grant is invisible to it;
 * it never reads `warranty_claims`; it reads PLATINE's NULL as an allowance of null until the new image is up. No row is
 * inserted. `down` refuses, naming the counts, while any warranty claim or WARRANTY grant exists; otherwise, in this
 * order (the trigger would clear each restored date): the trigger, its function and the CHECK dropped, the end dates of
 * the started lifetime warranties restored (`start + duration_months`, clamped to the month's end as addMonthsClamped
 * does), the two columns dropped, the YEARLY_CARE place given back, PLATINE's allowance NOT NULL DEFAULT 1 (NULL back to
 * 1), `warranty_credit_percent` dropped, 0045's three grant constraints restored, `warranty_claims` dropped: the schema
 * of 0047 exactly (nothing is rolled back in production). One statement per array entry (PGlite's extended protocol);
 * Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const GRANT_KINDS_0045 = `'GIFT','CREDIT','BIRTHDAY'`;
const GRANT_KINDS = `'GIFT','CREDIT','BIRTHDAY','WARRANTY'`;
const CURRENCIES = `'EUR','GBP','USD','CHF'`;
const BASES = `'LIFETIME','TWO_YEARS','LEGAL'`;
const STATUSES = `'OPEN','LABEL_SENT','RECEIVED','DECIDED','DONE','CANCELLED'`;
const OUTCOMES = `'REPLACEMENT','VALUE_CREDIT','PART_CREDIT','REPAIR','PRICE_REDUCTION','REFUND','REFUSED'`;
const REFUSALS = `'LOST','THEFT_REPORTED','SCRATCHED','DAMAGED_ON_PURPOSE','DAMAGED_BY_SOMEONE_ELSE','ALTERED_OUTSIDE_ORBES','NO_FAULT_FOUND','WARRANTY_ENDED','WARRANTY_VOID'`;
/** Each basis's outcomes (answer 10 and D1): the 2-year warranty never a credit, the legal guarantee never a credit. */
const OUTCOMES_LIFETIME = `'REPLACEMENT','VALUE_CREDIT','PART_CREDIT','REFUSED'`;
const OUTCOMES_TWO_YEARS = `'REPLACEMENT','REPAIR','REFUSED'`;
const OUTCOMES_LEGAL = `'REPLACEMENT','REPAIR','PRICE_REDUCTION','REFUND','REFUSED'`;
/** Each basis's refusal reasons: the lifetime warranty never ends; the ORBES warranty's exclusions never defeat a conformity claim. */
const REFUSALS_LIFETIME = `'LOST','THEFT_REPORTED','SCRATCHED','DAMAGED_ON_PURPOSE','DAMAGED_BY_SOMEONE_ELSE','ALTERED_OUTSIDE_ORBES','NO_FAULT_FOUND','WARRANTY_VOID'`;
const REFUSALS_TWO_YEARS = `'LOST','THEFT_REPORTED','NO_FAULT_FOUND','WARRANTY_ENDED','WARRANTY_VOID'`;
const REFUSALS_LEGAL = `'DAMAGED_ON_PURPOSE','DAMAGED_BY_SOMEONE_ELSE','NO_FAULT_FOUND'`;

/** An amount, as an order's (0022). */
const AMOUNT_MAX = 100_000_000;
/** The label's PDF: at most 2 MiB, as a care label's (0028). */
const LABEL_MAX_BYTES = 2 * 1024 * 1024;
/** A tracking number, as an order's (0022) and a care request's (0028). */
const TRACKING = `'^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$'`;
const words = (column: string, max: number) => `length(btrim(${column})) BETWEEN 1 AND ${max}`;

/** The place of PRIVATE CARE before and after (services/care.ts CARE_LOCATION). */
const PLACE_0028 = `'ORBES atelier'`;
const PLACE = `'ORBES'`;

/** tier_grants' two constraints as 0045 wrote them. */
const BIRTHDAY_0045 = `(kind = 'BIRTHDAY') = (tier IS NULL) AND (kind = 'BIRTHDAY') = (birthday_on IS NOT NULL)`;
const CREDIT_0045 = `(kind IN ('CREDIT', 'BIRTHDAY')) = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)`;
/** With WARRANTY: no tier (and no birthday); an amount, currency and expiry. */
const BIRTHDAY = `(kind IN ('BIRTHDAY', 'WARRANTY')) = (tier IS NULL) AND (kind = 'BIRTHDAY') = (birthday_on IS NOT NULL)`;
const CREDIT = `(kind IN ('CREDIT', 'BIRTHDAY', 'WARRANTY')) = (amount_minor IS NOT NULL) AND (amount_minor IS NULL) = (currency IS NULL) AND (amount_minor IS NULL) = (expires_at IS NULL)`;

/** A claim's outcome among `list`, false when there is none (a CHECK's NULL would pass). */
const outcomeIn = (list: string) => `coalesce(outcome IN (${list}), false)`;

/** What each status needs (`warranty_claims_steps`). */
const LABELLED = `label_at IS NOT NULL AND label_carrier_id IS NOT NULL AND label_tracking IS NOT NULL`;
const RECEIVED = `${LABELLED} AND received_at IS NOT NULL AND service_record_id IS NOT NULL`;
const RETURNED = `return_carrier_id IS NOT NULL AND return_tracking IS NOT NULL AND return_shipped_at IS NOT NULL`;
const DECIDED = `outcome IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL`;
/** The piece goes back after these outcomes; ORBES keeps it after a credit of its value or a refund. */
const GOES_BACK = `'REPLACEMENT','PART_CREDIT','REPAIR','PRICE_REDUCTION','REFUSED'`;
const KEPT = `'VALUE_CREDIT','REFUND'`;
const STEPS = `(status = 'CANCELLED') = (cancelled_at IS NOT NULL) AND (
       (status = 'OPEN' AND label_at IS NULL AND received_at IS NULL AND outcome IS NULL AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'LABEL_SENT' AND ${LABELLED} AND received_at IS NULL AND outcome IS NULL AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'RECEIVED' AND ${RECEIVED} AND outcome IS NULL AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'DECIDED' AND ${RECEIVED} AND ${DECIDED} AND outcome IN (${GOES_BACK}) AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'DONE' AND ${DECIDED} AND done_at IS NOT NULL AND (
          (outcome = 'REFUSED' AND label_at IS NULL AND received_at IS NULL AND return_shipped_at IS NULL)
       OR (outcome IN (${KEPT}) AND ${RECEIVED} AND return_shipped_at IS NULL)
       OR (outcome IN (${GOES_BACK}) AND ${RECEIVED} AND ${RETURNED})))
    OR (status = 'CANCELLED' AND service_record_id IS NULL AND outcome IS NULL AND return_shipped_at IS NULL AND done_at IS NULL))`;

/** The claim's guarded columns: who claims what, on which basis, opened when and by whom, continuing which claim. */
const IMMUTABLE = ['id', 'product_id', 'root_product_id', 'account_id', 'conversation_id', 'basis', 'opened_at', 'opened_by', 'continues_claim_id'];
const quoted = (cols: readonly string[]) => cols.map((c) => `'${c}'`).join(', ');

export const UP: readonly string[] = [
  // ── models: the warranty of each model ───────────────────────────────────
  `ALTER TABLE models ADD COLUMN warranty_lifetime boolean NOT NULL DEFAULT false`,
  // Every existing model takes the default, Lifetime (answer 12).
  `UPDATE models SET warranty_lifetime = true`,

  // ── warranties: the piece's kind, its backfill, its CHECK and trigger ────
  `ALTER TABLE warranties ADD COLUMN lifetime boolean NULL`,
  // VOID wins: a voided warranty keeps its dates.
  `UPDATE warranties SET lifetime = false WHERE voided_at IS NOT NULL`,
  // Every other follows its model, Lifetime: no end date, its months kept.
  `UPDATE warranties SET lifetime = true, end_date = NULL WHERE voided_at IS NULL`,
  `ALTER TABLE warranties ALTER COLUMN lifetime SET NOT NULL`,
  `ALTER TABLE warranties ADD CONSTRAINT warranties_lifetime_open CHECK (NOT lifetime OR end_date IS NULL)`,
  `CREATE FUNCTION orbes_warranty_kind() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF TG_OP = 'INSERT' AND NEW.lifetime IS NULL THEN
       NEW.lifetime := (SELECT m.warranty_lifetime FROM products p JOIN models m ON m.id = p.model_id WHERE p.id = NEW.product_id);
     END IF;
     IF NEW.lifetime THEN
       NEW.end_date := NULL;
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER warranties_kind BEFORE INSERT OR UPDATE ON warranties
     FOR EACH ROW EXECUTE FUNCTION orbes_warranty_kind()`,

  // ── club_program_settings: PRIVATE CARE for every piece from PLATINE; the warranty credit
  `ALTER TABLE club_program_settings ALTER COLUMN care_pieces_platine DROP NOT NULL`,
  `ALTER TABLE club_program_settings ALTER COLUMN care_pieces_platine SET DEFAULT NULL`,
  // A saved row would keep PLATINE at its number otherwise.
  `UPDATE club_program_settings SET care_pieces_platine = NULL WHERE id = 1`,
  `ALTER TABLE club_program_settings ADD COLUMN warranty_credit_percent smallint NOT NULL DEFAULT 30 CHECK (warranty_credit_percent BETWEEN 1 AND 100)`,

  // ── tier_grants: the kind WARRANTY ───────────────────────────────────────
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_kind_check`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_kind_check CHECK (kind IN (${GRANT_KINDS}))`,
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_birthday`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_birthday CHECK (${BIRTHDAY})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT tier_grants_credit`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_credit CHECK (${CREDIT})`,

  // ── warranty_claims ──────────────────────────────────────────────────────
  `CREATE TABLE warranty_claims (
     id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id             uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     root_product_id        uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     account_id             uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     conversation_id        uuid        NULL REFERENCES client_conversations (id) ON DELETE RESTRICT,
     basis                  text        NOT NULL CHECK (basis IN (${BASES})),
     status                 text        NOT NULL DEFAULT 'OPEN' CHECK (status IN (${STATUSES})),
     opened_at              timestamptz NOT NULL DEFAULT now(),
     opened_by              uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     label_pdf              bytea       NULL CHECK (octet_length(label_pdf) BETWEEN 1 AND ${LABEL_MAX_BYTES}),
     label_carrier_id       uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     label_tracking         text        NULL CHECK (label_tracking ~ ${TRACKING}),
     label_at               timestamptz NULL,
     service_record_id      uuid        NULL UNIQUE REFERENCES service_records (id) ON DELETE RESTRICT,
     received_at            timestamptz NULL,
     outcome                text        NULL CHECK (outcome IN (${OUTCOMES})),
     refusal_reason         text        NULL CHECK (refusal_reason IN (${REFUSALS})),
     value_minor            integer     NULL CHECK (value_minor BETWEEN 1 AND ${AMOUNT_MAX}),
     currency               text        NULL CHECK (currency IN (${CURRENCIES})),
     credit_percent         smallint    NULL CHECK (credit_percent BETWEEN 1 AND 100),
     grant_id               uuid        NULL UNIQUE REFERENCES tier_grants (id) ON DELETE RESTRICT,
     replacement_product_id uuid        NULL UNIQUE REFERENCES products (id) ON DELETE RESTRICT,
     other_size             boolean     NOT NULL DEFAULT false,
     decided_at             timestamptz NULL,
     decided_by             uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     return_carrier_id      uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     return_tracking        text        NULL CHECK (return_tracking ~ ${TRACKING}),
     return_shipped_at      timestamptz NULL,
     done_at                timestamptz NULL,
     cancelled_at           timestamptz NULL,
     note                   text        NULL CHECK (${words('note', 500)}),
     continues_claim_id     uuid        NULL UNIQUE REFERENCES warranty_claims (id) ON DELETE RESTRICT,
     CONSTRAINT warranty_claims_steps CHECK (${STEPS}),
     CONSTRAINT warranty_claims_times CHECK (
       label_at >= opened_at AND received_at >= label_at AND decided_at >= coalesce(received_at, opened_at)
       AND return_shipped_at >= decided_at AND done_at >= coalesce(return_shipped_at, decided_at) AND cancelled_at >= opened_at),
     CONSTRAINT warranty_claims_label CHECK (
       (label_at IS NULL) = (label_carrier_id IS NULL) AND (label_at IS NULL) = (label_tracking IS NULL) AND (label_pdf IS NULL OR label_at IS NOT NULL)),
     CONSTRAINT warranty_claims_return CHECK (
       (return_shipped_at IS NULL) = (return_carrier_id IS NULL) AND (return_shipped_at IS NULL) = (return_tracking IS NULL)),
     CONSTRAINT warranty_claims_received CHECK (status = 'CANCELLED' OR (received_at IS NULL) = (service_record_id IS NULL)),
     CONSTRAINT warranty_claims_continues CHECK (continues_claim_id IS NULL OR (basis = 'LEGAL' AND continues_claim_id <> id)),
     CONSTRAINT warranty_claims_decided CHECK ((outcome IS NULL) = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
     CONSTRAINT warranty_claims_claimant CHECK (
       (account_id IS NULL) = (conversation_id IS NULL) AND (basis = 'LEGAL' OR account_id IS NOT NULL) AND (account_id IS NOT NULL OR note IS NOT NULL)),
     CONSTRAINT warranty_claims_refusal CHECK (${outcomeIn(`'REFUSED'`)} = (refusal_reason IS NOT NULL)),
     CONSTRAINT warranty_claims_value CHECK (
       ${outcomeIn(`'VALUE_CREDIT','PART_CREDIT','PRICE_REDUCTION','REFUND'`)} = (value_minor IS NOT NULL) AND (value_minor IS NULL) = (currency IS NULL)),
     CONSTRAINT warranty_claims_credit CHECK (
       ${outcomeIn(`'VALUE_CREDIT','PART_CREDIT'`)} = (grant_id IS NOT NULL) AND ${outcomeIn(`'PART_CREDIT'`)} = (credit_percent IS NOT NULL)),
     CONSTRAINT warranty_claims_replacement CHECK (
       ${outcomeIn(`'REPLACEMENT'`)} = (replacement_product_id IS NOT NULL) AND replacement_product_id <> product_id
       AND (NOT other_size OR replacement_product_id IS NOT NULL)),
     CONSTRAINT warranty_claims_basis_outcome CHECK (
       (basis <> 'LIFETIME' OR outcome IS NULL OR outcome IN (${OUTCOMES_LIFETIME}))
       AND (basis <> 'TWO_YEARS' OR outcome IS NULL OR outcome IN (${OUTCOMES_TWO_YEARS}))
       AND (basis <> 'LEGAL' OR outcome IS NULL OR outcome IN (${OUTCOMES_LEGAL}))),
     CONSTRAINT warranty_claims_basis_refusal CHECK (
       (basis <> 'LIFETIME' OR refusal_reason IS NULL OR refusal_reason IN (${REFUSALS_LIFETIME}))
       AND (basis <> 'TWO_YEARS' OR refusal_reason IS NULL OR refusal_reason IN (${REFUSALS_TWO_YEARS}))
       AND (basis <> 'LEGAL' OR refusal_reason IS NULL OR refusal_reason IN (${REFUSALS_LEGAL})))
   )`,
  `CREATE INDEX warranty_claims_product_idx ON warranty_claims (product_id, opened_at)`,
  `CREATE INDEX warranty_claims_root_idx ON warranty_claims (root_product_id)`,
  `CREATE INDEX warranty_claims_account_idx ON warranty_claims (account_id, opened_at)`,
  `CREATE INDEX warranty_claims_conversation_idx ON warranty_claims (conversation_id)`,
  `CREATE INDEX warranty_claims_opened_by_idx ON warranty_claims (opened_by)`,
  `CREATE INDEX warranty_claims_decided_by_idx ON warranty_claims (decided_by)`,
  `CREATE INDEX warranty_claims_label_carrier_idx ON warranty_claims (label_carrier_id)`,
  `CREATE INDEX warranty_claims_return_carrier_idx ON warranty_claims (return_carrier_id)`,
  // The Claims tab, by status.
  `CREATE INDEX warranty_claims_status_idx ON warranty_claims (status, opened_at)`,
  // One live claim per piece.
  `CREATE UNIQUE INDEX warranty_claims_open_once ON warranty_claims (product_id) WHERE status IN ('OPEN','LABEL_SENT','RECEIVED','DECIDED')`,
  // One free replacement per original purchase, under the lifetime warranty only (answers 4 and 10, D1).
  `CREATE UNIQUE INDEX warranty_claims_free_once ON warranty_claims (root_product_id) WHERE basis = 'LIFETIME' AND outcome IN ('REPLACEMENT','VALUE_CREDIT')`,
  `CREATE TRIGGER warranty_claims_immutable BEFORE UPDATE ON warranty_claims
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(IMMUTABLE)})`,
  `CREATE TRIGGER warranty_claims_no_delete BEFORE DELETE ON warranty_claims
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a warranty claim is cancelled, never deleted')`,

  // ── service_records: the place of PRIVATE CARE ───────────────────────────
  `UPDATE service_records SET location = ${PLACE}, performed_by = ${PLACE} WHERE type = 'YEARLY_CARE' AND location = ${PLACE_0028}`,
];

export const DOWN: readonly string[] = [
  // The previous image knows neither a warranty claim nor a WARRANTY grant: refused while any exists (neither is ever deleted).
  `DO $$
   DECLARE claims bigint; grants bigint;
   BEGIN
     SELECT count(*) INTO claims FROM warranty_claims;
     SELECT count(*) INTO grants FROM tier_grants WHERE kind = 'WARRANTY';
     IF claims > 0 OR grants > 0 THEN
       RAISE EXCEPTION 'migration 0048_orbes_care cannot be rolled back: % warranty claims and % warranty credits exist', claims, grants;
     END IF;
   END $$`,
  // First the trigger (its UPDATE branch would clear each date restored below), its function and the CHECK.
  `DROP TRIGGER IF EXISTS warranties_kind ON warranties`,
  `DROP FUNCTION IF EXISTS orbes_warranty_kind()`,
  `ALTER TABLE warranties DROP CONSTRAINT IF EXISTS warranties_lifetime_open`,
  // Then the end dates of the started lifetime warranties, from their kept months (clamped to the month's end).
  `UPDATE warranties SET end_date = (start_date + make_interval(months => duration_months))::date WHERE lifetime AND start_date IS NOT NULL`,
  `ALTER TABLE warranties DROP COLUMN IF EXISTS lifetime`,
  `ALTER TABLE models DROP COLUMN IF EXISTS warranty_lifetime`,
  `UPDATE service_records SET location = ${PLACE_0028}, performed_by = ${PLACE_0028} WHERE type = 'YEARLY_CARE' AND location = ${PLACE}`,
  `UPDATE club_program_settings SET care_pieces_platine = 1 WHERE care_pieces_platine IS NULL`,
  `ALTER TABLE club_program_settings ALTER COLUMN care_pieces_platine SET DEFAULT 1`,
  `ALTER TABLE club_program_settings ALTER COLUMN care_pieces_platine SET NOT NULL`,
  `ALTER TABLE club_program_settings DROP COLUMN IF EXISTS warranty_credit_percent`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_credit`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_credit CHECK (${CREDIT_0045})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_birthday`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_birthday CHECK (${BIRTHDAY_0045})`,
  `ALTER TABLE tier_grants DROP CONSTRAINT IF EXISTS tier_grants_kind_check`,
  `ALTER TABLE tier_grants ADD CONSTRAINT tier_grants_kind_check CHECK (kind IN (${GRANT_KINDS_0045}))`,
  `DROP TABLE IF EXISTS warranty_claims`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
