/**
 * 0028 — the yearly care (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6, step 2.6: « Yearly care service: PLATINE 1 piece
 * a year, PALLADIUM all pieces. It is asked for from the piece; Client Services sends a prepaid label both ways; it is
 * recorded in SERVICE HISTORY »).
 *
 * `service_records.type` gains YEARLY_CARE: the record the care opens when the piece reaches the atelier, listed as
 * YEARLY CARE in the piece's SERVICE HISTORY. Only the care flow opens one (services/care.ts).
 *
 * `care_requests`: a collector's request for the yearly care of a piece it holds (`account_id`, `product_id`), for a
 * calendar `year` (UTC, 2026 to 2099), with the `tier` the account held when it asked (2 PLATINE, 3 PALLADIUM), and the
 * name and address the piece returns to (`return_name` 1 to 200 characters, `return_address` 1 to 1 000, trimmed, as an
 * order's buyer: personal data, never in the audit log). Its `status` steps REQUESTED → LABEL_SENT (the prepaid label
 * Client Services uploaded, a PDF of at most 2 MiB in `label_pdf`, with its carrier and tracking number) → RECEIVED (at
 * the atelier: `received_at` and the YEARLY_CARE `service_record_id` it opened) → RETURNING (shipped back:
 * `return_carrier_id`, `return_tracking`, `return_shipped_at`) → DONE (`done_at`), or CANCELLED before RETURNING
 * (`cancelled_at`, `cancelled_by` the account or ORBES, and a staff `note` of 1 to 500 characters). `care_requests_steps`
 * holds the columns each status needs, each later status keeping those of the earlier ones (the label PDF itself may be
 * erased by the housekeeping, 30 days after DONE or CANCELLED). `handled_by` the console user of the latest step.
 * One request per piece and year that is not CANCELLED (`care_requests_once`); the identity, the year, the tier and the
 * address never change (to change the address, the collector cancels and asks again); a request is never deleted.
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. Compatible with the previous image: a table it
 * never reads, and a CHECK that only widens (it never writes YEARLY_CARE). No row is inserted. `down` refuses, naming the
 * counts, while any care request or YEARLY_CARE record exists (the previous image would read neither); otherwise it
 * drops the table and restores 0001's CHECK: the schema of 0027 exactly. One statement per array entry (PGlite's
 * extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const SERVICE_TYPES_0001 = `'INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION'`;
const SERVICE_TYPES = `'INSPECTION','CLEANING','POLISH','RESIZE','REPAIR','REPLACEMENT','AUTHENTICATION','YEARLY_CARE'`;
const STATUSES = `'REQUESTED','LABEL_SENT','RECEIVED','RETURNING','DONE','CANCELLED'`;
const CANCELLED_BY = `'account','admin'`;

/** The label's PDF: at most 2 MiB (services/care.ts CARE_LABEL_MAX_BYTES). */
const LABEL_MAX_BYTES = 2 * 1024 * 1024;
/** A tracking number, as an order's (0022). */
const TRACKING = `'^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$'`;
const words = (column: string, max: number) => `length(btrim(${column})) BETWEEN 1 AND ${max}`;

/** What each status needs: each later step keeps the columns of the earlier ones. */
const LABELLED = `label_at IS NOT NULL AND label_carrier_id IS NOT NULL AND label_tracking IS NOT NULL`;
const RECEIVED = `${LABELLED} AND received_at IS NOT NULL AND service_record_id IS NOT NULL`;
const RETURNING = `${RECEIVED} AND return_carrier_id IS NOT NULL AND return_tracking IS NOT NULL AND return_shipped_at IS NOT NULL`;
const STEPS = `(status = 'CANCELLED') = (cancelled_at IS NOT NULL) AND (
       (status = 'REQUESTED' AND label_at IS NULL AND received_at IS NULL AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'LABEL_SENT' AND ${LABELLED} AND received_at IS NULL AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'RECEIVED' AND ${RECEIVED} AND return_shipped_at IS NULL AND done_at IS NULL)
    OR (status = 'RETURNING' AND ${RETURNING} AND done_at IS NULL)
    OR (status = 'DONE' AND ${RETURNING} AND done_at IS NOT NULL)
    OR (status = 'CANCELLED' AND cancelled_by IS NOT NULL AND return_shipped_at IS NULL AND done_at IS NULL))`;

export const UP: readonly string[] = [
  // ── service_records: the type of the yearly care ─────────────────────────
  `ALTER TABLE service_records DROP CONSTRAINT service_records_type_check`,
  `ALTER TABLE service_records ADD CONSTRAINT service_records_type_check CHECK (type IN (${SERVICE_TYPES}))`,

  // ── care_requests ────────────────────────────────────────────────────────
  `CREATE TABLE care_requests (
     id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id        uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     product_id        uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     year              smallint    NOT NULL CHECK (year BETWEEN 2026 AND 2099),
     tier              smallint    NOT NULL CHECK (tier IN (2, 3)),
     status            text        NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (${STATUSES})),
     requested_at      timestamptz NOT NULL DEFAULT now(),
     return_name       text        NOT NULL CHECK (${words('return_name', 200)}),
     return_address    text        NOT NULL CHECK (${words('return_address', 1000)}),
     label_pdf         bytea       NULL CHECK (octet_length(label_pdf) BETWEEN 1 AND ${LABEL_MAX_BYTES}),
     label_carrier_id  uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     label_tracking    text        NULL CHECK (label_tracking ~ ${TRACKING}),
     label_at          timestamptz NULL,
     service_record_id uuid        NULL UNIQUE REFERENCES service_records (id) ON DELETE RESTRICT,
     received_at       timestamptz NULL,
     return_carrier_id uuid        NULL REFERENCES carriers (id) ON DELETE RESTRICT,
     return_tracking   text        NULL CHECK (return_tracking ~ ${TRACKING}),
     return_shipped_at timestamptz NULL,
     done_at           timestamptz NULL,
     cancelled_at      timestamptz NULL,
     cancelled_by      text        NULL CHECK (cancelled_by IN (${CANCELLED_BY})),
     note              text        NULL CHECK (${words('note', 500)}),
     handled_by        uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     CONSTRAINT care_requests_steps CHECK (${STEPS}),
     CONSTRAINT care_requests_label CHECK (
       (label_at IS NULL) = (label_carrier_id IS NULL) AND (label_at IS NULL) = (label_tracking IS NULL) AND (label_pdf IS NULL OR label_at IS NOT NULL)),
     CONSTRAINT care_requests_return CHECK (
       (return_shipped_at IS NULL) = (return_carrier_id IS NULL) AND (return_shipped_at IS NULL) = (return_tracking IS NULL)),
     CONSTRAINT care_requests_received CHECK ((received_at IS NULL) = (service_record_id IS NULL)),
     CONSTRAINT care_requests_cancelled CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
     CONSTRAINT care_requests_times CHECK (
       label_at >= requested_at AND received_at >= label_at AND return_shipped_at >= received_at AND done_at >= return_shipped_at AND cancelled_at >= requested_at)
   )`,
  // One request per piece and year that is not cancelled: a cancelled one gives the year back.
  `CREATE UNIQUE INDEX care_requests_once ON care_requests (product_id, year) WHERE status <> 'CANCELLED'`,
  `CREATE INDEX care_requests_account_idx ON care_requests (account_id, year)`,
  `CREATE INDEX care_requests_product_idx ON care_requests (product_id)`,
  `CREATE INDEX care_requests_status_idx ON care_requests (status, requested_at)`,
  `CREATE INDEX care_requests_label_carrier_idx ON care_requests (label_carrier_id)`,
  `CREATE INDEX care_requests_return_carrier_idx ON care_requests (return_carrier_id)`,
  `CREATE INDEX care_requests_handled_by_idx ON care_requests (handled_by)`,
  `CREATE TRIGGER care_requests_immutable BEFORE UPDATE ON care_requests
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'account_id', 'product_id', 'year', 'tier', 'requested_at', 'return_name', 'return_address')`,
  `CREATE TRIGGER care_requests_no_delete BEFORE DELETE ON care_requests
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a care request is cancelled, never deleted')`,
];

export const DOWN: readonly string[] = [
  // The previous image reads neither a care request nor a YEARLY_CARE record: refused while any exists.
  `DO $$
   DECLARE requests bigint; records bigint;
   BEGIN
     SELECT count(*) INTO requests FROM care_requests;
     SELECT count(*) INTO records FROM service_records WHERE type = 'YEARLY_CARE';
     IF requests > 0 OR records > 0 THEN
       RAISE EXCEPTION 'migration 0028_yearly_care cannot be rolled back: % care requests and % yearly care records exist', requests, records;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS care_requests`,
  `ALTER TABLE service_records DROP CONSTRAINT IF EXISTS service_records_type_check`,
  `ALTER TABLE service_records ADD CONSTRAINT service_records_type_check CHECK (type IN (${SERVICE_TYPES_0001}))`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
