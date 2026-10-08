/**
 * 0034 — NEW CLAIM CODE (plan NEXT LOT of 2026-10-07, §3.4, step 4.1: a lost card on a piece not registered yet). A claim
 * code is kept only as its scrypt hash (products.claim_secret_hash), so a lost card could not be replaced: Client
 * Services now makes a new claim code for the piece, and the old one stops working at once.
 *
 * `claim_code_renewals`: one row per new claim code made by this feature, never changed in its identity, never deleted.
 *   kind     STAFF    a piece with no buyer (in stock): the code was shown once to the staff member, with its card to
 *                     print (status SHOWN; no order, no account);
 *            BUYER    a sold piece (its open order): the code waits, sealed, for that order's buyer, who reads it once in
 *                     YOUR ORDERS (status WAITING → READ, or WITHDRAWN); staff never see it; the order and the account
 *                     it was made for are kept;
 *            UNSHOWN  made when a sold piece's order was cancelled: a code nobody ever sees replaces the one its buyer
 *                     may have read (status UNSHOWN; the order kept, no account).
 *   claim_hash        the scrypt hash this row wrote into products.claim_secret_hash: the row is the piece's current code
 *                     while the two are equal, whatever changed the piece's hash since (a return, a later lot).
 *   sealed_code       the BUYER's code sealed with AES-256-GCM (crypto/secretbox.ts, its own HKDF key
 *                     'orbes/claim-code-reveal/v1'), bound to its row by its AAD; held exactly while WAITING
 *                     (`claim_code_renewals_sealed`), wiped when it is read or withdrawn.
 *   read_at           exactly when READ; withdrawn_at and withdrawn_reason exactly when WITHDRAWN: a newer code
 *                     (RENEWED_AGAIN), its order cancelled (ORDER_CANCELLED) or returned (ORDER_RETURNED), the piece
 *                     registered (REGISTERED), a key that no longer opens it (UNREADABLE), the piece's code changed by
 *                     another path (SUPERSEDED).
 *   reason            the staff member's reason, 1 to 500 characters once trimmed, exactly when the kind is not UNSHOWN.
 *   created_by        the admin who made it (an UNSHOWN row: who cancelled the order); NULL for the system.
 * At most one code waits per piece (`claim_code_renewals_waiting_key`).
 *
 * Every foreign key leads an index (`claim_code_renewals_product_idx`, and one each for the order, the account and the
 * author); ON DELETE RESTRICT like every other. No row is inserted: every piece keeps its hash, and the new codes of
 * past returns stay as they are (audited `order.return` with `claimCodeReissued`). Compatible with the previous image: a
 * new table it never reads. `down` drops it: the schema of 0033 exactly (nothing is rolled back in production). One
 * statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const KINDS = `'STAFF','BUYER','UNSHOWN'`;
const STATUSES = `'SHOWN','UNSHOWN','WAITING','READ','WITHDRAWN'`;
const WITHDRAWN_REASONS = `'RENEWED_AGAIN','ORDER_CANCELLED','ORDER_RETURNED','REGISTERED','UNREADABLE','SUPERSEDED'`;

/** The staff member's reason (services/claim-renewals.ts CLAIM_RENEWAL_REASON_MAX). */
const REASON_MAX = 500;

export const UP: readonly string[] = [
  `CREATE TABLE claim_code_renewals (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id       uuid        NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
     kind             text        NOT NULL CHECK (kind IN (${KINDS})),
     order_id         uuid        NULL REFERENCES orders (id) ON DELETE RESTRICT,
     account_id       uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     claim_hash       text        NOT NULL,
     sealed_code      text        NULL,
     status           text        NOT NULL CHECK (status IN (${STATUSES})),
     read_at          timestamptz NULL,
     withdrawn_at     timestamptz NULL,
     withdrawn_reason text        NULL CHECK (withdrawn_reason IN (${WITHDRAWN_REASONS})),
     reason           text        NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND ${REASON_MAX}),
     created_by       uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at       timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT claim_code_renewals_target CHECK (
       (kind = 'STAFF' AND order_id IS NULL AND account_id IS NULL)
       OR (kind = 'BUYER' AND order_id IS NOT NULL AND account_id IS NOT NULL)
       OR (kind = 'UNSHOWN' AND order_id IS NOT NULL AND account_id IS NULL)),
     CONSTRAINT claim_code_renewals_kind_status CHECK (
       (kind = 'STAFF' AND status = 'SHOWN')
       OR (kind = 'UNSHOWN' AND status = 'UNSHOWN')
       OR (kind = 'BUYER' AND status IN ('WAITING', 'READ', 'WITHDRAWN'))),
     CONSTRAINT claim_code_renewals_sealed CHECK ((sealed_code IS NOT NULL) = (status = 'WAITING')),
     CONSTRAINT claim_code_renewals_read CHECK ((status = 'READ') = (read_at IS NOT NULL)),
     CONSTRAINT claim_code_renewals_withdrawn CHECK (
       (status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL AND withdrawn_reason IS NOT NULL)
       AND (withdrawn_at IS NULL) = (withdrawn_reason IS NULL)),
     CONSTRAINT claim_code_renewals_reason CHECK ((reason IS NOT NULL) = (kind <> 'UNSHOWN'))
   )`,
  `CREATE INDEX claim_code_renewals_product_idx ON claim_code_renewals (product_id, created_at)`,
  // Whole indexes, not partial ones: a foreign key leads an index that serves every row (test/db/migrations.test.ts).
  `CREATE INDEX claim_code_renewals_order_idx ON claim_code_renewals (order_id)`,
  `CREATE INDEX claim_code_renewals_account_idx ON claim_code_renewals (account_id)`,
  `CREATE INDEX claim_code_renewals_created_by_idx ON claim_code_renewals (created_by)`,
  // At most one code waits per piece: a second press withdraws the first (RENEWED_AGAIN) in its transaction.
  `CREATE UNIQUE INDEX claim_code_renewals_waiting_key ON claim_code_renewals (product_id) WHERE status = 'WAITING'`,
  `CREATE TRIGGER claim_code_renewals_immutable BEFORE UPDATE ON claim_code_renewals
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'product_id', 'kind', 'order_id', 'account_id', 'claim_hash', 'reason', 'created_by', 'created_at')`,
  `CREATE TRIGGER claim_code_renewals_no_delete BEFORE DELETE ON claim_code_renewals
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('claim code renewals are kept')`,
  `CREATE TRIGGER claim_code_renewals_no_truncate BEFORE TRUNCATE ON claim_code_renewals
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('claim code renewals are kept')`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS claim_code_renewals`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
