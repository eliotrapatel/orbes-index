/**
 * 0066 — TEST PURGE (lot PURGE, plan §A.1 to §A.3 and §W; the owner's answers of 27 Oct 2026, answer 4 and Claude's
 * points 5 to 8): an ended test's entries, cancelled orders, sessions, audit rows and test accounts deleted in bounded
 * batches by the database itself, which trusts nothing of the app; its report stays as a stored summary. Nothing here
 * runs by itself: the service, its loop and its routes come in steps PURGE.5 and PURGE.6.
 *
 * `orbes_reject_mutation` (0001) gains ONE way through: a DELETE (never an UPDATE, never a TRUNCATE) on one of the
 * purge's five append-only tables (`audit_logs`, `order_events`, `event_journal`, `credit_uses`, `tier_grants`) of
 * `public`, while `orbes.guard_bypass` is `purge` AND the current user is a superuser. The app connects as a role that
 * is no superuser (deploy/vps/scripts/lib.sh): the setting alone, which any session may set, opens nothing. Inside the
 * purge's SECURITY DEFINER functions, owned by the migrations' superuser, both hold. Every other use answers exactly as
 * before (same message, SQLSTATE OR001). No replica mode anywhere.
 *
 * `test_runs` gains the purge's columns, each value in one stated home, guarded by `test_runs_purge_guard`:
 *  - `purge_state` PURGING, PAUSED or DONE, one way: NULL → PURGING ⇄ PAUSED, PURGING → DONE; never back to NULL,
 *    nothing after DONE. NULL → PURGING passes only in a transaction that itself wrote an `admin.step_up` audit row with
 *    purpose `test_run.purge:<this run>` or `test_run.purge_all` for the admin named in `purge_requested_by`, an ADMIN
 *    still active, AND updated that admin's `admin_users` row (both rows' xmin is this transaction's id):
 *    otherwise OR010 PURGE_NOT_AUTHORIZED. PAUSED → PURGING (a resume) needs nothing more;
 *  - `purge_requested_at`, `purge_requested_by` and `purge_summary` (the report and the plan the console showed),
 *    written by that request, once;
 *  - `purge_step_up_id`: set BY THE TRIGGER at NULL → PURGING to that step-up row's id, whatever the app sends, never
 *    changed after (OR010 PURGE_STEP_UP_LOCKED): the run's upper chain bound;
 *  - `purge_windows` `{fromId, toId, from, to, accounts}`: the run's own audit range and its test accounts, written once
 *    by the purge function, as the superuser, at its first step 9; any other write OR010 PURGE_WINDOWS_LOCKED;
 *  - `purge_reason`: set exactly while PAUSED; `purge_result` `{deleted, kept}` and `purged_at`: exactly when DONE;
 *  - the purge columns only on an ENDED run; the run's release never changes once its purge started.
 * `purge_summary.all` marks a run requested by PURGE ALL, for the console only: no function reads the summary.
 *
 * `audit_purge_gaps`: one tombstone per audit row the purge deleted (its id, prev_hash and hash, the run), so that the
 * chain check still proves nothing else was removed (ANSWERS Claude 5). Written by the superuser only, append-only.
 *
 * `purge_delete_tables`: step 10's DELETE-class tables referencing `accounts`, children first (services' copy:
 * db/purge-plan.ts PURGE_DELETE_TABLES). `orbes_purge_plan()`: every foreign key the purge meets with its class
 * (db/purge-plan.ts PURGE_REFERENCES). Both written here only (`orbes_require_superuser`), compared by test.
 *
 * `orbes_maintenance_window(at)`: 'NIGHT' for [03:00, 05:30) UTC or [04:00, 06:30) Paris, 'BACKUP' for [03:00, 03:10)
 * and [03:45, 03:55) Paris, NULL outside (the TypeScript copy: services/maintenance-window.ts, kept equal by test);
 * `orbes_maintenance_window_within(at, margin)`: the window at `at`, else at `at + margin` (0 to 5 minutes).
 *
 * `orbes_purge_test_run_batch(run, max)` and `orbes_purge_test_pool_batch(max)`: SECURITY DEFINER, `search_path` fixed,
 * `lock_timeout` 2 s, `orbes.guard_bypass` 'purge'. Each call re-checks everything (plan §A.2) and deletes one bounded
 * step (plan §A.3); static SQL, plus `EXECUTE format('%I')` on names read from the catalogue only, values only through
 * USING. EXECUTE stays with PUBLIC (only the app and the owner connect). Refusals raise OR010 with the reason as the
 * message. The helpers they share (`orbes_purge_scope`, `orbes_purge_held`, `orbes_purge_free`, `orbes_purge_accounts`,
 * `orbes_purge_count`) run with the caller's rights and are revoked from PUBLIC.
 *
 * Every foreign key ON DELETE RESTRICT at the head of an index. On the previous image during the roll-out: columns and
 * tables it never reads. `down` refuses while a tombstone or a purge exists, naming the counts (dropping the tombstones
 * would leave the chain BROKEN); otherwise it puts back 0001's `orbes_reject_mutation` exactly and drops the rest: the
 * schema of 0065. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration
 * inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal lists, kept local on purpose (a migration never changes); test/db/migrations-0066.test.ts checks they match
// db/purge-plan.ts and schema.ts.
/** test_runs.purge_state (schema.ts TEST_RUN_PURGE_STATES). */
const PURGE_STATES = `'PURGING','PAUSED','DONE'`;
/** The append-only tables the bypass deletes from (purge-plan.ts PURGE_GUARDED_TABLES). */
const GUARDED = `'audit_logs','order_events','event_journal','credit_uses','tier_grants'`;
/** Step 10's DELETE-class tables, children first (purge-plan.ts PURGE_DELETE_TABLES). */
const DELETE_TABLES = [
  'account_sizes',
  'account_profiles',
  'email_preferences',
  'account_scores',
  'collector_history',
  'collector_places',
  'collector_view_months',
  'collector_view_totals',
  'tier_grants',
  'test_entrants',
] as const;
/** Every foreign key the purge meets: [table, columns, references, class] (purge-plan.ts PURGE_REFERENCES). */
const PLAN: readonly (readonly [string, string, string, 'DELETE' | 'BLOCK'])[] = [
  ['account_addresses', 'account_id', 'accounts', 'BLOCK'],
  ['account_notes', 'account_id', 'accounts', 'BLOCK'],
  ['account_profiles', 'account_id', 'accounts', 'DELETE'],
  ['account_recovery_codes', 'account_id', 'accounts', 'BLOCK'],
  ['account_scores', 'account_id', 'accounts', 'DELETE'],
  ['account_sizes', 'account_id', 'accounts', 'DELETE'],
  ['account_sources', 'account_id', 'accounts', 'BLOCK'],
  ['account_tags', 'account_id', 'accounts', 'BLOCK'],
  ['account_tastes', 'account_id', 'accounts', 'BLOCK'],
  ['account_wishes', 'account_id', 'accounts', 'BLOCK'],
  ['accounts', 'invited_by', 'accounts', 'BLOCK'],
  ['acquisition_conversions', 'account_id', 'accounts', 'BLOCK'],
  ['acquisition_touches', 'account_id', 'accounts', 'BLOCK'],
  ['ad_clicks', 'account_id', 'accounts', 'BLOCK'],
  ['ad_consents', 'account_id', 'accounts', 'BLOCK'],
  ['care_requests', 'account_id', 'accounts', 'BLOCK'],
  ['circle_poll_votes', 'account_id', 'accounts', 'BLOCK'],
  ['circle_rsvps', 'account_id', 'accounts', 'BLOCK'],
  ['claim_code_renewals', 'account_id', 'accounts', 'BLOCK'],
  ['client_conversations', 'account_id', 'accounts', 'BLOCK'],
  ['collector_history', 'account_id', 'accounts', 'DELETE'],
  ['collector_places', 'account_id', 'accounts', 'DELETE'],
  ['collector_view_months', 'account_id', 'accounts', 'DELETE'],
  ['collector_view_totals', 'account_id', 'accounts', 'DELETE'],
  ['collector_views', 'account_id', 'accounts', 'BLOCK'],
  ['drop_entries', 'account_id', 'accounts', 'BLOCK'],
  ['email_outbox', 'account_id', 'accounts', 'BLOCK'],
  ['email_preferences', 'account_id', 'accounts', 'DELETE'],
  ['house_deliveries', 'account_id', 'accounts', 'BLOCK'],
  ['house_guarantees', 'account_id', 'accounts', 'BLOCK'],
  ['invitations', 'account_id', 'accounts', 'BLOCK'],
  ['live_entries', 'account_id', 'accounts', 'BLOCK'],
  ['live_interest', 'account_id', 'accounts', 'BLOCK'],
  ['orders', 'account_id', 'accounts', 'BLOCK'],
  ['ownership', 'account_id', 'accounts', 'BLOCK'],
  ['ownership_transfers', 'from_account_id', 'accounts', 'BLOCK'],
  ['ownership_transfers', 'to_account_id', 'accounts', 'BLOCK'],
  ['preregistrations', 'account_id', 'accounts', 'BLOCK'],
  ['release_answers', 'account_id', 'accounts', 'BLOCK'],
  ['scan_events', 'account_id', 'accounts', 'BLOCK'],
  ['set_sales', 'account_id', 'accounts', 'BLOCK'],
  ['shop_requests', 'account_id', 'accounts', 'BLOCK'],
  ['test_entrants', 'account_id', 'accounts', 'DELETE'],
  ['tier_grants', 'account_id', 'accounts', 'DELETE'],
  ['tracking_device_accounts', 'account_id', 'accounts', 'BLOCK'],
  ['tracking_devices', 'account_id', 'accounts', 'BLOCK'],
  ['vault_gifts', 'accepted_by', 'accounts', 'BLOCK'],
  ['vault_occasions_before', 'account_id', 'accounts', 'BLOCK'],
  ['vaults', 'account_id', 'accounts', 'BLOCK'],
  ['vaults', 'friend_account_id', 'accounts', 'BLOCK'],
  ['warranty_claims', 'account_id', 'accounts', 'BLOCK'],
  ['worn_photos', 'account_id', 'accounts', 'BLOCK'],
  ['bench_items', 'order_id', 'orders', 'BLOCK'],
  ['claim_code_renewals', 'order_id', 'orders', 'BLOCK'],
  ['client_messages', 'order_id', 'orders', 'BLOCK'],
  ['credit_uses', 'order_id', 'orders', 'DELETE'],
  ['invoices', 'order_id', 'orders', 'BLOCK'],
  ['order_addon_items', 'order_id', 'orders', 'DELETE'],
  ['order_cases', 'exchange_order_id', 'orders', 'BLOCK'],
  ['order_cases', 'order_id', 'orders', 'BLOCK'],
  ['order_events', 'order_id', 'orders', 'DELETE'],
  ['orders', 'exchange_of_order_id', 'orders', 'BLOCK'],
  ['orders', 'with_order_id', 'orders', 'DELETE'],
  ['returns', 'order_id', 'orders', 'BLOCK'],
  ['shipment_items', 'order_id', 'orders', 'BLOCK'],
  ['shipments', 'order_id', 'orders', 'BLOCK'],
  ['stock_movements', 'order_id', 'orders', 'BLOCK'],
  ['vaults', 'order_id', 'orders', 'BLOCK'],
  ['addon_choices', 'drop_entry_id', 'drop_entries', 'DELETE'],
  ['drop_entry_sizes', 'entry_id,drop_id', 'drop_entries', 'DELETE'],
  ['orders', 'drop_entry_id', 'drop_entries', 'DELETE'],
  ['addon_choices', 'live_entry_id', 'live_entries', 'DELETE'],
  ['after_room_guests', 'entry_id', 'live_entries', 'DELETE'],
  ['live_entry_sizes', 'entry_id,drop_id', 'live_entries', 'DELETE'],
  ['orders', 'live_entry_id', 'live_entries', 'DELETE'],
  ['vaults', 'entry_id', 'live_entries', 'BLOCK'],
  ['live_interest_sizes', 'drop_id,account_id', 'live_interest', 'DELETE'],
  ['stock_movements', 'order_addon_item_id,order_id,sku_id', 'order_addon_items', 'BLOCK'],
  ['orders', 'set_sale_id,account_id', 'set_sales', 'DELETE'],
  ['test_run_entrants', 'account_id', 'test_entrants', 'BLOCK'],
  ['credit_uses', 'grant_id', 'tier_grants', 'BLOCK'],
  ['orders', 'gift_grant_id', 'tier_grants', 'BLOCK'],
  ['vault_gifts', 'grant_id', 'tier_grants', 'BLOCK'],
  ['vaults', 'grant_id', 'tier_grants', 'BLOCK'],
  ['warranty_claims', 'grant_id', 'tier_grants', 'BLOCK'],
];
/** A test account (services/test-entrants.ts takePool): its address and the password hash nothing matches. */
const TEST_EMAIL_RE = `'^test-[0-9]+@orbes\\.test$'`;
const TEST_PASSWORD_HASH = `'!test-entrant: never signs in'`;
/** The settings the definer functions run with (each asserted by test, exactly). */
const DEFINER = `SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET lock_timeout = '2s' SET orbes.guard_bypass = 'purge'`;
/** The helpers' fixed path (they run with the caller's rights). */
const HELPER = `SET search_path = pg_catalog, public, pg_temp`;

/** A refusal of the purge: SQLSTATE OR010, the reason as the message (the app maps it to its words). */
const refuse = (reason: string, detail: string) => `RAISE EXCEPTION USING ERRCODE = 'OR010', MESSAGE = '${reason}', DETAIL = ${detail}`;
const IS_SUPERUSER = `coalesce((SELECT su.rolsuper FROM pg_catalog.pg_roles su WHERE su.rolname = current_user), false)`;
/** The 9 Oct start guards (reset-to-catalogue.sql:106-111): the migrations' superuser, the origin replication role. */
const START_GUARDS = `
     IF NOT ${IS_SUPERUSER} THEN
       ${refuse('PURGE_NOT_SUPERUSER', `format('the purge runs as the migrations'' superuser, not as %s', current_user)`)};
     END IF;
     IF current_setting('session_replication_role') <> 'origin' THEN
       ${refuse('PURGE_REPLICA_MODE', `format('session_replication_role is %s, expected origin', current_setting('session_replication_role'))`)};
     END IF;`;

/** 0001's body, put back exactly by `down`. */
const REJECT_0001 = `CREATE OR REPLACE FUNCTION orbes_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'immutable')
       USING ERRCODE = 'OR001';
   END $$`;

/** With the purge's one way through (§A.1 a). */
const REJECT_0066 = `CREATE OR REPLACE FUNCTION orbes_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     -- The purge's way through: a DELETE on one of its five tables of public, purpose 'purge', by a superuser (the
     -- purge's definer functions). Never an UPDATE, never a TRUNCATE; everything else raises as 0001 did.
     IF TG_OP = 'DELETE'
        AND TG_TABLE_SCHEMA = 'public'
        AND TG_TABLE_NAME IN (${GUARDED})
        AND pg_catalog.current_setting('orbes.guard_bypass', true) = 'purge'
        AND ${IS_SUPERUSER} THEN
       IF TG_LEVEL = 'ROW' THEN
         RETURN OLD;
       END IF;
       RETURN NULL;
     END IF;
     RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'immutable')
       USING ERRCODE = 'OR001';
   END $$`;

/** Every purge column of test_runs, in one list (the guard's comparisons). */
const PURGE_COLUMNS = ['purge_state', 'purge_requested_at', 'purge_requested_by', 'purged_at', 'purge_summary', 'purge_step_up_id', 'purge_windows', 'purge_reason', 'purge_result'] as const;
const cols = (prefix: string, list: readonly string[]) => list.map((c) => `${prefix}.${c}`).join(', ');

export const UP: readonly string[] = [
  REJECT_0066,

  // ── orbes_require_superuser: the tables only the migrations' superuser writes (0067 reuses it) ──
  `CREATE FUNCTION orbes_require_superuser() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NOT ${IS_SUPERUSER} THEN
       RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'written by the superuser only')
         USING ERRCODE = 'OR001';
     END IF;
     IF TG_LEVEL = 'STATEMENT' THEN
       RETURN NULL;
     END IF;
     IF TG_OP = 'DELETE' THEN
       RETURN OLD;
     END IF;
     RETURN NEW;
   END $$`,

  // ── test_runs: the purge's columns ───────────────────────────────────────
  `ALTER TABLE test_runs ADD COLUMN purge_state text NULL CONSTRAINT test_runs_purge_state_check CHECK (purge_state IN (${PURGE_STATES}))`,
  `ALTER TABLE test_runs ADD COLUMN purge_requested_at timestamptz NULL`,
  `ALTER TABLE test_runs ADD COLUMN purge_requested_by uuid NULL CONSTRAINT test_runs_purge_requested_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT`,
  `ALTER TABLE test_runs ADD COLUMN purged_at timestamptz NULL`,
  `ALTER TABLE test_runs ADD COLUMN purge_summary jsonb NULL CONSTRAINT test_runs_purge_summary_check CHECK (jsonb_typeof(purge_summary) = 'object')`,
  `ALTER TABLE test_runs ADD COLUMN purge_step_up_id bigint NULL CONSTRAINT test_runs_purge_step_up_id_check CHECK (purge_step_up_id >= 1)`,
  `ALTER TABLE test_runs ADD COLUMN purge_windows jsonb NULL CONSTRAINT test_runs_purge_windows_check CHECK (
     jsonb_typeof(purge_windows) = 'object' AND purge_windows ?& ARRAY['fromId', 'toId', 'from', 'to', 'accounts'] AND jsonb_typeof(purge_windows -> 'accounts') = 'array')`,
  `ALTER TABLE test_runs ADD COLUMN purge_reason text NULL CONSTRAINT test_runs_purge_reason_check CHECK (purge_reason ~ '^[A-Z0-9_]{1,64}$')`,
  `ALTER TABLE test_runs ADD COLUMN purge_result jsonb NULL CONSTRAINT test_runs_purge_result_check CHECK (
     jsonb_typeof(purge_result) = 'object' AND purge_result ?& ARRAY['deleted', 'kept'])`,
  // Only on an ENDED run; requested with its author, its summary and its step-up from PURGING on; windows only once
  // started; a reason exactly while PAUSED; a result and a time exactly when DONE.
  `ALTER TABLE test_runs ADD CONSTRAINT test_runs_purge_ended CHECK (status = 'ENDED' OR num_nonnulls(${PURGE_COLUMNS.join(', ')}) = 0)`,
  `ALTER TABLE test_runs ADD CONSTRAINT test_runs_purge_requested CHECK (
     (purge_state IS NULL) = (purge_requested_at IS NULL) AND (purge_state IS NULL) = (purge_requested_by IS NULL)
     AND (purge_state IS NULL) = (purge_summary IS NULL) AND (purge_state IS NULL) = (purge_step_up_id IS NULL)
     AND (purge_windows IS NULL OR purge_state IS NOT NULL))`,
  `ALTER TABLE test_runs ADD CONSTRAINT test_runs_purge_paused CHECK ((purge_state IS NOT DISTINCT FROM 'PAUSED') = (purge_reason IS NOT NULL))`,
  `ALTER TABLE test_runs ADD CONSTRAINT test_runs_purge_done CHECK (
     (purge_state IS NOT DISTINCT FROM 'DONE') = (purged_at IS NOT NULL) AND (purge_state IS NOT DISTINCT FROM 'DONE') = (purge_result IS NOT NULL))`,
  `CREATE INDEX test_runs_purge_requested_by_idx ON test_runs (purge_requested_by)`,

  `CREATE FUNCTION orbes_test_runs_purge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     step_up bigint;
     v_xid xid;
   BEGIN
     IF TG_OP = 'INSERT' THEN
       IF num_nonnulls(${cols('NEW', PURGE_COLUMNS)}) > 0 THEN
         ${refuse('PURGE_NOT_AUTHORIZED', `'a test run is created without a purge'`)};
       END IF;
       RETURN NEW;
     END IF;
     -- Nothing of a purge, as before this lot.
     IF OLD.purge_state IS NULL AND num_nonnulls(${cols('NEW', PURGE_COLUMNS)}) = 0 THEN
       RETURN NEW;
     END IF;
     IF OLD.purge_state = 'DONE' THEN
       IF ROW(${cols('NEW', PURGE_COLUMNS)}, NEW.drop_id) IS DISTINCT FROM ROW(${cols('OLD', PURGE_COLUMNS)}, OLD.drop_id) THEN
         ${refuse('PURGE_DONE', `'a purged test never changes its purge'`)};
       END IF;
       RETURN NEW;
     END IF;
     IF NEW.drop_id IS DISTINCT FROM OLD.drop_id THEN
       ${refuse('PURGE_RUN_LOCKED', `'a test under purge keeps its release'`)};
     END IF;

     IF OLD.purge_state IS NULL THEN
       -- The request: NULL -> PURGING, in the step-up's own transaction, and nothing the purge itself writes later.
       IF NEW.purge_state IS DISTINCT FROM 'PURGING' THEN
         ${refuse('PURGE_STATE_ONE_WAY', `format('purge_state NULL -> %s', coalesce(NEW.purge_state, 'NULL'))`)};
       END IF;
       IF NEW.purge_windows IS NOT NULL THEN
         ${refuse('PURGE_WINDOWS_LOCKED', `'the windows are written by the purge itself'`)};
       END IF;
       IF NEW.purge_requested_by IS NULL THEN
         ${refuse('PURGE_NOT_AUTHORIZED', `'a purge names the admin who asked for it'`)};
       END IF;
       v_xid := pg_catalog.pg_current_xact_id()::xid;
       IF NOT EXISTS (SELECT 1 FROM public.admin_users a
                       WHERE a.id = NEW.purge_requested_by AND a.role = 'ADMIN' AND a.disabled_at IS NULL AND a.xmin = v_xid) THEN
         ${refuse('PURGE_NOT_AUTHORIZED', `'no step-up of this admin in this transaction'`)};
       END IF;
       SELECT max(l.id) INTO step_up FROM public.audit_logs l
        WHERE l.target_type = 'admin' AND l.target_id = NEW.purge_requested_by::text
          AND l.action = 'admin.step_up' AND l.actor_type = 'admin' AND l.actor_id = NEW.purge_requested_by::text
          AND (l.details ->> 'purpose') IN ('test_run.purge:' || NEW.id::text, 'test_run.purge_all')
          AND l.xmin = v_xid;
       IF step_up IS NULL THEN
         ${refuse('PURGE_NOT_AUTHORIZED', `'no step-up of this admin for this purge in this transaction'`)};
       END IF;
       NEW.purge_step_up_id := step_up;
       RETURN NEW;
     END IF;

     -- Under way (PURGING or PAUSED): one way, the request's values written once.
     IF NEW.purge_state IS NULL
        OR (OLD.purge_state = 'PAUSED' AND NEW.purge_state NOT IN ('PAUSED', 'PURGING')) THEN
       ${refuse('PURGE_STATE_ONE_WAY', `format('purge_state %s -> %s', OLD.purge_state, coalesce(NEW.purge_state, 'NULL'))`)};
     END IF;
     IF NEW.purge_step_up_id IS DISTINCT FROM OLD.purge_step_up_id THEN
       ${refuse('PURGE_STEP_UP_LOCKED', `'the step-up of the request is set once, by the database'`)};
     END IF;
     IF ROW(NEW.purge_requested_at, NEW.purge_requested_by, NEW.purge_summary) IS DISTINCT FROM ROW(OLD.purge_requested_at, OLD.purge_requested_by, OLD.purge_summary) THEN
       ${refuse('PURGE_WRITE_ONCE', `'the request and its summary are written once'`)};
     END IF;
     IF NEW.purge_windows IS DISTINCT FROM OLD.purge_windows
        AND NOT (OLD.purge_windows IS NULL AND ${IS_SUPERUSER}) THEN
       ${refuse('PURGE_WINDOWS_LOCKED', `'the windows are written once, by the purge itself'`)};
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER test_runs_purge_guard BEFORE INSERT OR UPDATE ON test_runs
     FOR EACH ROW EXECUTE FUNCTION orbes_test_runs_purge_guard()`,

  // ── audit_purge_gaps: the tombstones ─────────────────────────────────────
  `CREATE TABLE audit_purge_gaps (
     id        bigint      PRIMARY KEY CONSTRAINT audit_purge_gaps_id_check CHECK (id >= 1),
     prev_hash bytea       NOT NULL CONSTRAINT audit_purge_gaps_prev_hash_check CHECK (octet_length(prev_hash) = 32),
     hash      bytea       NOT NULL CONSTRAINT audit_purge_gaps_hash_check CHECK (octet_length(hash) = 32),
     run_id    uuid        NULL CONSTRAINT audit_purge_gaps_run_id_fkey REFERENCES test_runs (id) ON DELETE RESTRICT,
     purged_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT audit_purge_gaps_prev_hash_key UNIQUE (prev_hash)
   )`,
  `CREATE INDEX audit_purge_gaps_run_idx ON audit_purge_gaps (run_id)`,
  `CREATE TRIGGER audit_purge_gaps_written_by_purge BEFORE INSERT ON audit_purge_gaps
     FOR EACH ROW EXECUTE FUNCTION orbes_require_superuser('audit_purge_gaps is written by the purge only')`,
  `CREATE TRIGGER audit_purge_gaps_append_only BEFORE UPDATE OR DELETE ON audit_purge_gaps
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('audit_purge_gaps is append-only')`,
  `CREATE TRIGGER audit_purge_gaps_no_truncate BEFORE TRUNCATE ON audit_purge_gaps
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('audit_purge_gaps is append-only')`,

  // ── purge_delete_tables: step 10's list, children first ──────────────────
  `CREATE TABLE purge_delete_tables (
     tbl text NOT NULL CONSTRAINT purge_delete_tables_tbl_check CHECK (tbl ~ '^[a-z][a-z0-9_]{0,62}$'),
     col text NOT NULL CONSTRAINT purge_delete_tables_col_check CHECK (col ~ '^[a-z][a-z0-9_]{0,62}$'),
     ord int  NOT NULL CONSTRAINT purge_delete_tables_ord_check CHECK (ord >= 1),
     CONSTRAINT purge_delete_tables_pkey PRIMARY KEY (tbl, col),
     CONSTRAINT purge_delete_tables_ord_key UNIQUE (ord)
   )`,
  `INSERT INTO purge_delete_tables (tbl, col, ord) VALUES ${DELETE_TABLES.map((t, i) => `('${t}', 'account_id', ${i + 1})`).join(', ')}`,
  `CREATE TRIGGER purge_delete_tables_superuser BEFORE INSERT OR UPDATE OR DELETE ON purge_delete_tables
     FOR EACH ROW EXECUTE FUNCTION orbes_require_superuser('the purge''s list is written by the migrations only')`,
  `CREATE TRIGGER purge_delete_tables_no_truncate BEFORE TRUNCATE ON purge_delete_tables
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_require_superuser('the purge''s list is written by the migrations only')`,

  // ── the plan: every foreign key the purge meets, with its class ──────────
  `CREATE FUNCTION orbes_purge_plan() RETURNS TABLE (tbl text, cols text, ref text, kind text) LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
     SELECT * FROM (VALUES ${PLAN.map(([t, c, r, k]) => `('${t}', '${c}', '${r}', '${k}')`).join(',\n       ')}) AS p (tbl, cols, ref, kind)
   $$`,

  // ── the forbidden windows (§W) ───────────────────────────────────────────
  `CREATE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
     SELECT CASE
       WHEN ((p_at AT TIME ZONE 'UTC')::time >= time '03:00' AND (p_at AT TIME ZONE 'UTC')::time < time '05:30')
         OR ((p_at AT TIME ZONE 'Europe/Paris')::time >= time '04:00' AND (p_at AT TIME ZONE 'Europe/Paris')::time < time '06:30') THEN 'NIGHT'
       WHEN ((p_at AT TIME ZONE 'Europe/Paris')::time >= time '03:00' AND (p_at AT TIME ZONE 'Europe/Paris')::time < time '03:10')
         OR ((p_at AT TIME ZONE 'Europe/Paris')::time >= time '03:45' AND (p_at AT TIME ZONE 'Europe/Paris')::time < time '03:55') THEN 'BACKUP'
     END
   $$`,
  `CREATE FUNCTION orbes_maintenance_window_within(p_at timestamptz, p_margin interval) RETURNS text LANGUAGE plpgsql STABLE AS $$
   BEGIN
     IF p_margin IS NULL OR p_margin < interval '0' OR p_margin > interval '5 minutes' THEN
       RAISE EXCEPTION 'orbes_maintenance_window_within: the margin is 0 to 5 minutes, not %', p_margin USING ERRCODE = '22023';
     END IF;
     RETURN coalesce(public.orbes_maintenance_window(p_at),
                     CASE WHEN p_margin > interval '0' THEN public.orbes_maintenance_window(p_at + p_margin) END);
   END $$`,

  // ── helpers (the caller's rights; revoked from PUBLIC) ───────────────────
  `CREATE FUNCTION orbes_purge_count(p_counts jsonb, p_table text, p_n bigint) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
     SELECT CASE WHEN coalesce(p_n, 0) = 0 THEN p_counts
                 ELSE p_counts || jsonb_build_object(p_table, coalesce((p_counts ->> p_table)::bigint, 0) + p_n) END
   $$`,

  // The scope A among the candidates (§A.2): test accounts by their pool row, address and password hash; no sign-up
  // row in the chain; no audit row targeting them below their lowest chain bound (the smallest test_run.start id over
  // the runs of their test_run_entrants and the runs whose stored windows name them; none: out); no row in a table
  // that references accounts outside the plan (anti-disguise, C6).
  `CREATE FUNCTION orbes_purge_scope(p_cands uuid[]) RETURNS uuid[] LANGUAGE plpgsql STABLE ${HELPER} AS $$
   DECLARE
     v_ids uuid[];
     v_bad uuid[];
     fk record;
   BEGIN
     SELECT coalesce(array_agg(a.id ORDER BY a.id), '{}') INTO v_ids
       FROM accounts a JOIN test_entrants t ON t.account_id = a.id
      WHERE a.id = ANY (coalesce(p_cands, '{}'))
        AND a.email_normalized ~ ${TEST_EMAIL_RE}
        AND a.password_hash = ${TEST_PASSWORD_HASH}
        AND NOT EXISTS (SELECT 1 FROM audit_logs l WHERE l.target_type = 'account' AND l.target_id = a.id::text AND l.action = 'account.register');
     IF cardinality(v_ids) = 0 THEN
       RETURN v_ids;
     END IF;

     WITH live AS (
            SELECT e.account_id AS id, e.run_id FROM test_run_entrants e WHERE e.account_id = ANY (v_ids)),
          live_bound AS (
            SELECT x.run_id,
                   (SELECT min(l.id) FROM audit_logs l WHERE l.target_type = 'test_run' AND l.target_id = x.run_id::text AND l.action = 'test_run.start') AS b
              FROM (SELECT DISTINCT run_id FROM live) x),
          stored AS (
            SELECT s.v::uuid AS id, (r.purge_windows ->> 'fromId')::bigint AS b
              FROM test_runs r CROSS JOIN LATERAL jsonb_array_elements_text(r.purge_windows -> 'accounts') AS s (v)
             WHERE r.purge_windows IS NOT NULL AND s.v = ANY (v_ids::text[])),
          bounds AS (
            SELECT live.id, lb.b FROM live JOIN live_bound lb USING (run_id)
            UNION ALL
            SELECT id, b FROM stored),
          lowest AS (
            SELECT id, CASE WHEN bool_and(b IS NOT NULL) THEN min(b) END AS lo FROM bounds GROUP BY id)
     SELECT coalesce(array_agg(w.id ORDER BY w.id), '{}') INTO v_ids
       FROM lowest w
      WHERE w.lo IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM audit_logs l WHERE l.target_type = 'account' AND l.target_id = w.id::text AND l.id < w.lo);

     FOR fk IN
       SELECT cl.relname AS tbl, ca.attname AS col
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k (child, parent)
         JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent
        WHERE c.contype = 'f' AND c.confrelid = 'public.accounts'::regclass AND n.nspname = 'public' AND pa.attname = 'id'
          AND NOT EXISTS (SELECT 1 FROM orbes_purge_plan() p WHERE p.ref = 'accounts' AND p.tbl = cl.relname AND p.cols = ca.attname)
        ORDER BY 1, 2
     LOOP
       EXECUTE format('SELECT coalesce(array_agg(DISTINCT c.%1$I), ''{}'') FROM public.%2$I c WHERE c.%1$I = ANY ($1)', fk.col, fk.tbl)
         INTO v_bad USING v_ids;
       IF cardinality(v_bad) > 0 THEN
         v_ids := array(SELECT x FROM unnest(v_ids) x EXCEPT SELECT y FROM unnest(v_bad) y ORDER BY 1);
       END IF;
     END LOOP;
     RETURN v_ids;
   END $$`,

  // The rows of p_ref (orders, drop_entries, live_entries: by id) that a row of a table the plan does not class DELETE
  // names: they are kept (BLOCK), whatever table it is, a future one included.
  `CREATE FUNCTION orbes_purge_held(p_ref text, p_ids uuid[]) RETURNS uuid[] LANGUAGE plpgsql STABLE ${HELPER} AS $$
   DECLARE
     v_out uuid[] := '{}';
     v_part uuid[];
     fk record;
   BEGIN
     IF p_ref NOT IN ('orders', 'drop_entries', 'live_entries') THEN
       RAISE EXCEPTION 'orbes_purge_held: % is not held this way', p_ref;
     END IF;
     IF cardinality(coalesce(p_ids, '{}')) = 0 THEN
       RETURN v_out;
     END IF;
     FOR fk IN
       SELECT cl.relname AS tbl, ca.attname AS col
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k (child, parent)
         JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent
        WHERE c.contype = 'f' AND c.confrelid = format('public.%I', p_ref)::regclass AND n.nspname = 'public' AND pa.attname = 'id'
          AND NOT EXISTS (
            SELECT 1 FROM orbes_purge_plan() p
             WHERE p.ref = p_ref AND p.tbl = cl.relname AND p.kind = 'DELETE'
               AND p.cols = (SELECT string_agg(a2.attname, ',' ORDER BY k2.o)
                               FROM unnest(c.conkey) WITH ORDINALITY AS k2 (n, o)
                               JOIN pg_attribute a2 ON a2.attrelid = c.conrelid AND a2.attnum = k2.n))
        ORDER BY 1, 2
     LOOP
       EXECUTE format('SELECT coalesce(array_agg(DISTINCT c.%1$I), ''{}'') FROM public.%2$I c WHERE c.%1$I = ANY ($1)', fk.col, fk.tbl)
         INTO v_part USING p_ids;
       v_out := v_out || v_part;
     END LOOP;
     RETURN v_out;
   END $$`,

  // Of the accounts p_ids, those step 10 may delete now (§A.3 step 10): no row of a table referencing accounts outside
  // purge_delete_tables names it (BLOCK, the BLOCK-by-name columns included, H11), no row names one of its rows of
  // those tables from outside them (a grant used, a test still holding it), at least one stored range names it (G13),
  // and every audit row naming it inside its stored ranges is one the purge may delete (below p_cap, inside the
  // range's times), as is every row targeting it.
  `CREATE FUNCTION orbes_purge_free(p_ids uuid[], p_cap bigint) RETURNS uuid[] LANGUAGE plpgsql STABLE ${HELPER} AS $$
   DECLARE
     v_ids uuid[] := coalesce(p_ids, '{}');
     v_txt text[];
     v_bad uuid[];
     fk record;
   BEGIN
     IF cardinality(v_ids) = 0 THEN
       RETURN v_ids;
     END IF;
     -- A row of a BLOCK-class (or unclassed) table naming the account.
     FOR fk IN
       SELECT cl.relname AS tbl, ca.attname AS col
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k (child, parent)
         JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent
        WHERE c.contype = 'f' AND c.confrelid = 'public.accounts'::regclass AND n.nspname = 'public' AND pa.attname = 'id'
          AND NOT EXISTS (SELECT 1 FROM purge_delete_tables d WHERE d.tbl = cl.relname AND d.col = ca.attname)
        ORDER BY 1, 2
     LOOP
       EXECUTE format('SELECT coalesce(array_agg(DISTINCT c.%1$I), ''{}'') FROM public.%2$I c WHERE c.%1$I = ANY ($1)', fk.col, fk.tbl)
         INTO v_bad USING v_ids;
       IF cardinality(v_bad) > 0 THEN
         v_ids := array(SELECT x FROM unnest(v_ids) x EXCEPT SELECT y FROM unnest(v_bad) y ORDER BY 1);
       END IF;
     END LOOP;
     -- A row from outside the list naming one of the account's rows of the list (credit_uses -> tier_grants,
     -- test_run_entrants -> test_entrants, ...).
     FOR fk IN
       SELECT d.tbl AS parent, d.col AS owner, cl.relname AS child,
              string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' AND ' ORDER BY k.child) AS joins
         FROM purge_delete_tables d
         JOIN pg_constraint c ON c.contype = 'f' AND c.confrelid = format('public.%I', d.tbl)::regclass
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
         CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k (child, parent)
         JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child
         JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent
        WHERE NOT EXISTS (SELECT 1 FROM purge_delete_tables d2 WHERE d2.tbl = cl.relname)
        GROUP BY d.tbl, d.col, c.oid, cl.relname
        ORDER BY 1, 3
     LOOP
       EXECUTE format('SELECT coalesce(array_agg(DISTINCT p.%1$I), ''{}'') FROM public.%2$I p WHERE p.%1$I = ANY ($1) AND EXISTS (SELECT 1 FROM public.%3$I c WHERE %4$s)',
                      fk.owner, fk.parent, fk.child, fk.joins)
         INTO v_bad USING v_ids;
       IF cardinality(v_bad) > 0 THEN
         v_ids := array(SELECT x FROM unnest(v_ids) x EXCEPT SELECT y FROM unnest(v_bad) y ORDER BY 1);
       END IF;
     END LOOP;
     IF cardinality(v_ids) = 0 THEN
       RETURN v_ids;
     END IF;
     v_txt := v_ids::text[];
     -- The stored ranges naming them; an account no stored range names is kept (never deleted unbounded, G13).
     WITH g AS (
            SELECT (r.purge_windows ->> 'fromId')::bigint AS f, (r.purge_windows ->> 'toId')::bigint AS t,
                   (r.purge_windows ->> 'from')::timestamptz AS tf, (r.purge_windows ->> 'to')::timestamptz AS tt,
                   array_agg(s.v) AS accs
              FROM test_runs r CROSS JOIN LATERAL jsonb_array_elements_text(r.purge_windows -> 'accounts') AS s (v)
             WHERE r.purge_windows IS NOT NULL AND s.v = ANY (v_txt)
             GROUP BY r.id, r.purge_windows),
          ok AS (SELECT * FROM g WHERE f IS NOT NULL AND t IS NOT NULL AND f < t AND tf IS NOT NULL AND tt IS NOT NULL),
          ranged AS (SELECT DISTINCT unnest(accs) AS v FROM ok),
          stuck AS (
            -- a row of its ranges the purge may not delete: at or above the cap, or outside the range's times
            SELECT l.actor_id AS v FROM ok JOIN audit_logs l ON l.id >= ok.f AND l.id < ok.t
             WHERE l.actor_type = 'account' AND l.actor_id = ANY (ok.accs) AND (l.id >= p_cap OR l.occurred_at < ok.tf OR l.occurred_at > ok.tt)
            UNION
            SELECT l.target_id FROM ok JOIN audit_logs l ON l.id >= ok.f AND l.id < ok.t
             WHERE l.target_type = 'account' AND l.target_id = ANY (ok.accs) AND (l.id >= p_cap OR l.occurred_at < ok.tf OR l.occurred_at > ok.tt)),
          outside AS (
            -- a row targeting it outside every stored range of it
            SELECT x.v FROM unnest(v_txt) AS x (v)
             WHERE EXISTS (SELECT 1 FROM audit_logs l
                            WHERE l.target_type = 'account' AND l.target_id = x.v
                              AND NOT EXISTS (SELECT 1 FROM ok WHERE x.v = ANY (ok.accs) AND l.id >= ok.f AND l.id < ok.t)))
     SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid), '{}') INTO v_ids
       FROM (SELECT v AS x FROM ranged WHERE v = ANY (v_txt)
             EXCEPT SELECT v FROM stuck
             EXCEPT SELECT v FROM outside) q;
     RETURN v_ids;
   END $$`,

  // Step 10 for up to p_limit of the accounts p_ids (§A.3): atomic per account, under FOR UPDATE on test_entrants then
  // accounts, re-checked; sessions, the audit rows naming it within its stored ranges (tombstones), the
  // purge_delete_tables rows in their order (test_entrants last), then the account.
  `CREATE FUNCTION orbes_purge_accounts(p_ids uuid[], p_limit int, p_cap bigint, p_run uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE ${HELPER} AS $$
   DECLARE
     v_existing int;
     v_free uuid[];
     v_take uuid[];
     v_first int;
     v_txt text[];
     v_cap bigint;
     v_top bigint;
     v_deleted jsonb := '{}';
     v_n bigint;
     t record;
   BEGIN
     SELECT max(id) INTO v_top FROM audit_logs;
     v_cap := least(p_cap, v_top);
     SELECT count(*) INTO v_existing FROM accounts a WHERE a.id = ANY (coalesce(p_ids, '{}'));
     v_free := array(SELECT a.id FROM accounts a
                      WHERE a.id = ANY (coalesce(p_ids, '{}'))
                        AND NOT EXISTS (SELECT 1 FROM test_run_entrants e WHERE e.account_id = a.id)
                      ORDER BY a.id);
     IF v_cap IS NULL THEN
       v_free := '{}';
     END IF;
     v_free := orbes_purge_free(v_free, v_cap);
     v_take := v_free[1:greatest(p_limit, 1)];
     v_first := cardinality(v_take);
     IF v_first > 0 THEN
       PERFORM 1 FROM test_entrants WHERE account_id = ANY (v_take) ORDER BY account_id FOR UPDATE;
       PERFORM 1 FROM accounts WHERE id = ANY (v_take) ORDER BY id FOR UPDATE;
       -- Re-checked under the locks: a press may have taken one meanwhile (takePool's FOR UPDATE OF test_entrants).
       v_take := orbes_purge_scope(v_take);
       v_take := array(SELECT x FROM unnest(v_take) x WHERE NOT EXISTS (SELECT 1 FROM test_run_entrants e WHERE e.account_id = x) ORDER BY x);
       v_take := orbes_purge_free(v_take, v_cap);
     END IF;
     IF cardinality(v_take) > 0 THEN
       v_txt := v_take::text[];
       DELETE FROM sessions WHERE subject_type = 'account' AND subject_id = ANY (v_take);
       GET DIAGNOSTICS v_n = ROW_COUNT;
       v_deleted := orbes_purge_count(v_deleted, 'sessions', v_n);
       WITH g AS (
              SELECT (r.purge_windows ->> 'fromId')::bigint AS f, (r.purge_windows ->> 'toId')::bigint AS t,
                     (r.purge_windows ->> 'from')::timestamptz AS tf, (r.purge_windows ->> 'to')::timestamptz AS tt,
                     array_agg(s.v) AS accs
                FROM test_runs r CROSS JOIN LATERAL jsonb_array_elements_text(r.purge_windows -> 'accounts') AS s (v)
               WHERE r.purge_windows IS NOT NULL AND s.v = ANY (v_txt)
               GROUP BY r.id, r.purge_windows),
            d AS (
              DELETE FROM audit_logs l USING g
               WHERE g.f IS NOT NULL AND g.t IS NOT NULL
                 AND l.id >= g.f AND l.id < g.t AND l.id < v_cap AND l.occurred_at >= g.tf AND l.occurred_at <= g.tt
                 AND ((l.target_type = 'account' AND l.target_id = ANY (g.accs)) OR (l.actor_type = 'account' AND l.actor_id = ANY (g.accs)))
              RETURNING l.id, l.prev_hash, l.hash)
       INSERT INTO audit_purge_gaps (id, prev_hash, hash, run_id) SELECT DISTINCT id, prev_hash, hash, p_run FROM d;
       GET DIAGNOSTICS v_n = ROW_COUNT;
       v_deleted := orbes_purge_count(v_deleted, 'audit_logs', v_n);
       FOR t IN SELECT tbl, col FROM purge_delete_tables ORDER BY ord LOOP
         EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)', t.tbl, t.col) USING v_take;
         GET DIAGNOSTICS v_n = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, t.tbl, v_n);
       END LOOP;
       DELETE FROM accounts WHERE id = ANY (v_take);
       GET DIAGNOSTICS v_n = ROW_COUNT;
       v_deleted := orbes_purge_count(v_deleted, 'accounts', v_n);
     END IF;
     RETURN jsonb_build_object(
       'deleted', v_deleted,
       'deletedAccounts', to_jsonb(coalesce(v_take, '{}')),
       'left', greatest(cardinality(v_free) - v_first, 0),
       'kept', greatest(v_existing - cardinality(v_free), 0));
   END $$`,

  // ── one batch of a run's purge (§A.2, §A.3) ──────────────────────────────
  `CREATE FUNCTION orbes_purge_test_run_batch(p_run uuid, p_max int) RETURNS jsonb LANGUAGE plpgsql ${DEFINER} AS $$
   DECLARE
     v_max int := least(greatest(coalesce(p_max, 1), 1), 1000);
     r test_runs%ROWTYPE;
     v_kind text;
     v_r uuid[];
     v_rt text[];
     v_cands uuid[];
     v_a uuid[];
     v_from bigint;
     v_to bigint;
     v_pstart bigint;
     v_top bigint;
     v_hi bigint;
     v_tfrom timestamptz;
     v_tto timestamptz;
     v_o0 uuid[];
     v_bad uuid[];
     v_new uuid[];
     v_odel uuid[];
     v_e0d uuid[];
     v_e0l uuid[];
     v_keptd uuid[];
     v_keptl uuid[];
     v_edd uuid[];
     v_edl uuid[];
     v_et text[];
     v_afull uuid[];
     v_aft text[];
     v_kept jsonb;
     v_deleted jsonb := '{}';
     v_phase text;
     v_left bigint := 0;
     v_n bigint;
     v_d bigint;
     v_used bigint;
     v_cost bigint;
     v_oid uuid;
     v_res jsonb;
     v_accounts jsonb := '[]';
   BEGIN
     ${START_GUARDS}
     v_kind := orbes_maintenance_window_within(now(), interval '1 minute');
     IF v_kind IS NOT NULL THEN
       ${refuse('PURGE_WINDOW', 'v_kind')};
     END IF;

     SELECT * INTO r FROM test_runs WHERE id = p_run FOR UPDATE;
     IF NOT FOUND THEN
       ${refuse('PURGE_NOT_FOUND', `'no such test'`)};
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs WHERE status = 'RUNNING') THEN
       ${refuse('PURGE_TEST_RUNNING', `'a test is running'`)};
     END IF;
     IF r.status <> 'ENDED' THEN
       ${refuse('PURGE_NOT_ENDED', `format('the test is %s', r.status)`)};
     END IF;
     IF r.purge_state = 'DONE' THEN
       ${refuse('PURGE_DONE', `'the test is purged'`)};
     END IF;
     IF r.purge_state IS NULL THEN
       ${refuse('PURGE_NOT_REQUESTED', `'no purge was asked for this test'`)};
     END IF;

     -- The release and its after-room, locked before the checks (the row lock the staff's draw actions take).
     PERFORM 1 FROM drops WHERE id = r.drop_id OR parent_drop_id = r.drop_id ORDER BY id FOR UPDATE;
     v_r := array(SELECT id FROM drops WHERE id = r.drop_id OR parent_drop_id = r.drop_id ORDER BY id);
     v_rt := v_r::text[];
     IF EXISTS (SELECT 1 FROM drops d WHERE d.id = ANY (v_r)
                  AND d.cancelled_at IS NULL AND d.ended_at IS NULL
                  AND NOT (d.mode = 'DRAW' AND d.drawn_at IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM drop_entries e WHERE e.drop_id = d.id AND e.status = 'SELECTED' AND e.respond_by > now()))) THEN
       ${refuse('PURGE_RELEASE_NOT_OVER', `'the release or its after-room is not over'`)};
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs x WHERE x.drop_id = ANY (v_r) AND x.status <> 'ENDED') THEN
       ${refuse('PURGE_RUNS_NOT_ENDED', `'another test of the release is not ended'`)};
     END IF;

     -- The run's chain range [fromId, toId), never past its purge.start nor the chain's newest row; its times only narrow it.
     SELECT min(id) INTO v_from FROM audit_logs WHERE target_type = 'test_run' AND target_id = p_run::text AND action = 'test_run.start';
     v_to := r.purge_step_up_id;
     SELECT min(id) INTO v_pstart FROM audit_logs WHERE target_type = 'test_run' AND target_id = p_run::text AND action = 'test_run.purge.start';
     SELECT max(id) INTO v_top FROM audit_logs;
     v_hi := least(v_to, v_pstart, v_top);
     v_tfrom := r.created_at - interval '1 minute';
     v_tto := r.ended_at + interval '10 minutes';

     -- The scope: the run's test_run_entrants until step 9 wrote its windows, then the accounts stored there.
     IF r.purge_windows IS NULL THEN
       v_cands := array(SELECT account_id FROM test_run_entrants WHERE run_id = p_run);
     ELSE
       v_cands := array(SELECT s.v::uuid FROM jsonb_array_elements_text(r.purge_windows -> 'accounts') AS s (v));
     END IF;
     IF v_from IS NULL OR v_to IS NULL OR v_from >= v_to THEN
       v_a := '{}';
     ELSE
       v_a := orbes_purge_scope(v_cands);
     END IF;

     -- Test releases only (D15, G1): a drawn draw holding an entry of anyone outside the scope is never purged.
     IF EXISTS (SELECT 1 FROM drops d JOIN drop_entries e ON e.drop_id = d.id
                 WHERE d.id = ANY (v_r) AND d.drawn_at IS NOT NULL AND NOT (e.account_id = ANY (v_a))) THEN
       ${refuse('PURGE_NOT_TEST', `'a drawn draw of the release holds an entry outside the test'`)};
     END IF;

     -- O: the test's orders (its accounts', in the release, and the GIFT orders travelling with them); the blocking ones.
     v_o0 := array(
       SELECT o.id FROM orders o
        WHERE o.account_id = ANY (v_a)
          AND (o.drop_id = ANY (v_r)
               OR (o.channel = 'GIFT' AND o.with_order_id IN (SELECT p.id FROM orders p WHERE p.drop_id = ANY (v_r) AND p.account_id = ANY (v_a))))
        ORDER BY o.id);
     v_bad := array(
       SELECT o.id FROM orders o
        WHERE o.id = ANY (v_o0)
          AND (o.status <> 'CANCELLED' OR o.channel NOT IN ('DRAW', 'LIVE', 'GIFT') OR o.product_id IS NOT NULL OR o.vault_id IS NOT NULL
               OR o.shop_request_id IS NOT NULL OR o.shopify_order_id IS NOT NULL OR o.exchange_of_order_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM credit_uses u WHERE u.order_id = o.id AND (u.released_at IS NULL OR u.applied_by IS NOT NULL))
               OR EXISTS (SELECT 1 FROM order_addon_items i WHERE i.order_id = o.id
                            AND (i.status NOT IN ('CANCELLED', 'REMOVED') OR i.invoice_id IS NOT NULL OR i.vault_id IS NOT NULL OR i.shopify_line_item_id IS NOT NULL))
               -- linked to an order outside O, either way
               OR (o.with_order_id IS NOT NULL AND NOT (o.with_order_id = ANY (v_o0)))
               OR EXISTS (SELECT 1 FROM orders x WHERE x.with_order_id = o.id AND NOT (x.id = ANY (v_o0)))
               OR EXISTS (SELECT 1 FROM orders x WHERE x.exchange_of_order_id = o.id)));
     v_bad := v_bad || orbes_purge_held('orders', v_o0);
     -- A crafted with_order_id cycle is never walked: kept.
     v_bad := v_bad || array(
       WITH RECURSIVE walk (start, cur, depth) AS (
         SELECT o.id, o.with_order_id, 1 FROM orders o WHERE o.id = ANY (v_o0) AND o.with_order_id IS NOT NULL
         UNION ALL
         SELECT w.start, o.with_order_id, w.depth + 1 FROM walk w JOIN orders o ON o.id = w.cur
          WHERE o.with_order_id IS NOT NULL AND w.cur <> w.start AND w.depth < 64)
       SELECT DISTINCT start FROM walk WHERE cur = start);
     -- Closed over the with_order_id links, either way (G20): one blocking order keeps its whole group.
     LOOP
       v_new := array(
         SELECT o.id FROM orders o
          WHERE o.id = ANY (v_o0) AND NOT (o.id = ANY (v_bad))
            AND (o.with_order_id = ANY (v_bad) OR EXISTS (SELECT 1 FROM orders x WHERE x.with_order_id = o.id AND x.id = ANY (v_bad))));
       EXIT WHEN cardinality(v_new) = 0;
       v_bad := v_bad || v_new;
     END LOOP;
     v_odel := array(SELECT x FROM unnest(v_o0) x EXCEPT SELECT y FROM unnest(v_bad) y ORDER BY 1);

     -- E: the scope's entries in the release; those an order kept, a guarantee or a table the plan keeps holds stay.
     v_e0d := array(SELECT e.id FROM drop_entries e WHERE e.drop_id = ANY (v_r) AND e.account_id = ANY (v_a) ORDER BY e.id);
     v_e0l := array(SELECT e.id FROM live_entries e WHERE e.drop_id = ANY (v_r) AND e.account_id = ANY (v_a) ORDER BY e.id);
     v_keptd := array(SELECT e.id FROM drop_entries e WHERE e.id = ANY (v_e0d)
                        AND (e.guarantee_id IS NOT NULL OR EXISTS (SELECT 1 FROM orders o WHERE o.drop_entry_id = e.id AND NOT (o.id = ANY (v_odel)))))
                || orbes_purge_held('drop_entries', v_e0d);
     v_keptl := array(SELECT e.id FROM live_entries e WHERE e.id = ANY (v_e0l)
                        AND (e.guarantee_id IS NOT NULL OR EXISTS (SELECT 1 FROM orders o WHERE o.live_entry_id = e.id AND NOT (o.id = ANY (v_odel)))))
                || orbes_purge_held('live_entries', v_e0l);
     v_edd := array(SELECT x FROM unnest(v_e0d) x EXCEPT SELECT y FROM unnest(v_keptd) y ORDER BY 1);
     v_edl := array(SELECT x FROM unnest(v_e0l) x EXCEPT SELECT y FROM unnest(v_keptl) y ORDER BY 1);
     v_et := (v_edd || v_edl)::text[];
     -- The accounts whose release rows all go (their own audit rows go too; one holding a kept row stays tied to the run).
     v_afull := array(
       SELECT x FROM unnest(v_a) x
       EXCEPT SELECT o.account_id FROM orders o WHERE o.id = ANY (v_bad)
       EXCEPT SELECT e.account_id FROM drop_entries e WHERE e.id = ANY (v_keptd)
       EXCEPT SELECT e.account_id FROM live_entries e WHERE e.id = ANY (v_keptl)
       ORDER BY 1);
     v_aft := v_afull::text[];
     v_kept := jsonb_build_object(
       'orders', (SELECT count(DISTINCT x) FROM unnest(v_bad) x),
       'entries', (SELECT count(DISTINCT x) FROM unnest(v_keptd || v_keptl) x),
       'accounts', cardinality(v_a) - cardinality(v_afull));

     -- One phase per call, the first that is not empty (§A.3).
     -- 1. after-room places of the entries going
     SELECT count(*) INTO v_n FROM after_room_guests WHERE entry_id = ANY (v_edl);
     IF v_n > 0 THEN
       v_phase := 'AFTER_ROOM_GUESTS';
       DELETE FROM after_room_guests WHERE ctid IN (SELECT ctid FROM after_room_guests WHERE entry_id = ANY (v_edl) LIMIT v_max);
       GET DIAGNOSTICS v_d = ROW_COUNT;
       v_deleted := orbes_purge_count(v_deleted, 'after_room_guests', v_d);
       v_left := v_n - v_d;
     END IF;
     -- 2. their add-on choices
     IF v_phase IS NULL THEN
       SELECT count(*) INTO v_n FROM addon_choices WHERE drop_entry_id = ANY (v_edd) OR live_entry_id = ANY (v_edl);
       IF v_n > 0 THEN
         v_phase := 'ADDON_CHOICES';
         DELETE FROM addon_choices WHERE id IN (SELECT id FROM addon_choices WHERE drop_entry_id = ANY (v_edd) OR live_entry_id = ANY (v_edl) ORDER BY id LIMIT v_max);
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'addon_choices', v_d);
         v_left := v_n - v_d;
       END IF;
     END IF;
     -- 3. the orders going, each whole in one call (its credit uses given back, add-on units, events, journal, audit
     --    rows with their tombstones, then itself), children before parents for every with_order_id link
     IF v_phase IS NULL AND cardinality(v_odel) > 0 THEN
       v_phase := 'ORDERS';
       v_used := 0;
       LOOP
         v_oid := NULL;
         SELECT o.id INTO v_oid FROM orders o
          WHERE o.id = ANY (v_odel) AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.with_order_id = o.id)
          ORDER BY o.id LIMIT 1;
         EXIT WHEN v_oid IS NULL;
         v_cost := 1
           + (SELECT count(*) FROM credit_uses WHERE order_id = v_oid)
           + (SELECT count(*) FROM order_addon_items WHERE order_id = v_oid)
           + (SELECT count(*) FROM order_events WHERE order_id = v_oid)
           + (SELECT count(*) FROM event_journal WHERE entity_type = 'order' AND entity_id = v_oid::text)
           + (SELECT count(*) FROM audit_logs WHERE target_type = 'order' AND target_id = v_oid::text
                AND id >= v_from AND id < v_hi AND occurred_at >= v_tfrom AND occurred_at <= v_tto);
         EXIT WHEN v_used > 0 AND v_used + v_cost > v_max;
         DELETE FROM credit_uses WHERE order_id = v_oid;
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'credit_uses', v_d);
         DELETE FROM order_addon_items WHERE order_id = v_oid;
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'order_addon_items', v_d);
         DELETE FROM order_events WHERE order_id = v_oid;
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'order_events', v_d);
         DELETE FROM event_journal WHERE entity_type = 'order' AND entity_id = v_oid::text;
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'event_journal', v_d);
         IF v_from IS NOT NULL AND v_hi IS NOT NULL THEN
           WITH d AS (
             DELETE FROM audit_logs l
              WHERE l.target_type = 'order' AND l.target_id = v_oid::text
                AND l.id >= v_from AND l.id < v_hi AND l.occurred_at >= v_tfrom AND l.occurred_at <= v_tto
             RETURNING l.id, l.prev_hash, l.hash)
           INSERT INTO audit_purge_gaps (id, prev_hash, hash, run_id) SELECT id, prev_hash, hash, p_run FROM d;
           GET DIAGNOSTICS v_d = ROW_COUNT;
           v_deleted := orbes_purge_count(v_deleted, 'audit_logs', v_d);
         END IF;
         DELETE FROM orders WHERE id = v_oid;
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'orders', v_d);
         v_odel := array_remove(v_odel, v_oid);
         v_used := v_used + v_cost;
         EXIT WHEN v_used >= v_max;
       END LOOP;
       v_left := cardinality(v_odel);
     END IF;
     -- 4. the sets the scope bought in the release, once no order names them
     IF v_phase IS NULL THEN
       SELECT count(*) INTO v_n FROM set_sales s
        WHERE s.account_id = ANY (v_a) AND s.drop_id = ANY (v_r) AND s.shopify_line_item_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.set_sale_id = s.id);
       IF v_n > 0 THEN
         v_phase := 'SET_SALES';
         DELETE FROM set_sales WHERE id IN (
           SELECT s.id FROM set_sales s
            WHERE s.account_id = ANY (v_a) AND s.drop_id = ANY (v_r) AND s.shopify_line_item_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.set_sale_id = s.id)
            ORDER BY s.id LIMIT v_max);
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'set_sales', v_d);
         v_left := v_n - v_d;
       END IF;
     END IF;
     -- 5. the sizes of the entries going
     IF v_phase IS NULL THEN
       SELECT (SELECT count(*) FROM drop_entry_sizes WHERE entry_id = ANY (v_edd)) + (SELECT count(*) FROM live_entry_sizes WHERE entry_id = ANY (v_edl)) INTO v_n;
       IF v_n > 0 THEN
         v_phase := 'ENTRY_SIZES';
         DELETE FROM drop_entry_sizes WHERE ctid IN (SELECT ctid FROM drop_entry_sizes WHERE entry_id = ANY (v_edd) LIMIT v_max);
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'drop_entry_sizes', v_d);
         v_used := v_d;
         IF v_used < v_max THEN
           DELETE FROM live_entry_sizes WHERE ctid IN (SELECT ctid FROM live_entry_sizes WHERE entry_id = ANY (v_edl) LIMIT v_max - v_used);
           GET DIAGNOSTICS v_d = ROW_COUNT;
           v_deleted := orbes_purge_count(v_deleted, 'live_entry_sizes', v_d);
           v_used := v_used + v_d;
         END IF;
         v_left := v_n - v_used;
       END IF;
     END IF;
     -- 6. the entries' audit rows, with their tombstones, inside the run's chain range narrowed by its times: the
     --    scope's own acts on the release, the rows naming an entry going, END TEST's interest withdrawals
     IF v_phase IS NULL AND v_from IS NOT NULL AND v_hi IS NOT NULL AND v_from < v_hi THEN
       SELECT count(*) INTO v_n FROM audit_logs l
        WHERE l.id >= v_from AND l.id < v_hi AND l.occurred_at >= v_tfrom AND l.occurred_at <= v_tto
          AND l.target_type = 'drop' AND l.target_id = ANY (v_rt)
          AND ((l.actor_type = 'account' AND l.actor_id = ANY (v_aft))
               OR (l.details ->> 'entryId') = ANY (v_et)
               OR (l.action = 'drop.live.interest.withdraw' AND (l.details ->> 'reason') = 'test_ended'));
       IF v_n > 0 THEN
         v_phase := 'ENTRY_AUDIT';
         WITH d AS (
           DELETE FROM audit_logs WHERE id IN (
             SELECT l.id FROM audit_logs l
              WHERE l.id >= v_from AND l.id < v_hi AND l.occurred_at >= v_tfrom AND l.occurred_at <= v_tto
                AND l.target_type = 'drop' AND l.target_id = ANY (v_rt)
                AND ((l.actor_type = 'account' AND l.actor_id = ANY (v_aft))
                     OR (l.details ->> 'entryId') = ANY (v_et)
                     OR (l.action = 'drop.live.interest.withdraw' AND (l.details ->> 'reason') = 'test_ended'))
              ORDER BY l.id LIMIT v_max)
           RETURNING id, prev_hash, hash)
         INSERT INTO audit_purge_gaps (id, prev_hash, hash, run_id) SELECT id, prev_hash, hash, p_run FROM d;
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'audit_logs', v_d);
         v_left := v_n - v_d;
       END IF;
     END IF;
     -- 7. the entries going
     IF v_phase IS NULL AND cardinality(v_edd) + cardinality(v_edl) > 0 THEN
       v_phase := 'ENTRIES';
       v_n := cardinality(v_edd) + cardinality(v_edl);
       DELETE FROM drop_entries WHERE id IN (SELECT x FROM unnest(v_edd) x ORDER BY x LIMIT v_max);
       GET DIAGNOSTICS v_d = ROW_COUNT;
       v_deleted := orbes_purge_count(v_deleted, 'drop_entries', v_d);
       v_used := v_d;
       IF v_used < v_max THEN
         DELETE FROM live_entries WHERE id IN (SELECT x FROM unnest(v_edl) x ORDER BY x LIMIT v_max - v_used);
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'live_entries', v_d);
         v_used := v_used + v_d;
       END IF;
       v_left := v_n - v_used;
     END IF;
     -- 8. the scope's I'LL BE THERE in the release, its sizes first
     IF v_phase IS NULL THEN
       SELECT (SELECT count(*) FROM live_interest_sizes WHERE drop_id = ANY (v_r) AND account_id = ANY (v_a))
            + (SELECT count(*) FROM live_interest WHERE drop_id = ANY (v_r) AND account_id = ANY (v_a)) INTO v_n;
       IF v_n > 0 THEN
         v_phase := 'INTEREST';
         DELETE FROM live_interest_sizes WHERE ctid IN (SELECT ctid FROM live_interest_sizes WHERE drop_id = ANY (v_r) AND account_id = ANY (v_a) LIMIT v_max);
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'live_interest_sizes', v_d);
         v_used := v_d;
         IF v_used < v_max THEN
           DELETE FROM live_interest WHERE ctid IN (
             SELECT i.ctid FROM live_interest i
              WHERE i.drop_id = ANY (v_r) AND i.account_id = ANY (v_a)
                AND NOT EXISTS (SELECT 1 FROM live_interest_sizes z WHERE z.drop_id = i.drop_id AND z.account_id = i.account_id)
              LIMIT v_max - v_used);
           GET DIAGNOSTICS v_d = ROW_COUNT;
           v_deleted := orbes_purge_count(v_deleted, 'live_interest', v_d);
           v_used := v_used + v_d;
         END IF;
         v_left := v_n - v_used;
       END IF;
     END IF;
     -- 9. the run's windows written once, then its test_run_entrants (an account holding a kept row stays tied to it)
     IF v_phase IS NULL THEN
       SELECT count(*) INTO v_n FROM test_run_entrants WHERE run_id = p_run AND account_id = ANY (v_afull);
       IF r.purge_windows IS NULL OR v_n > 0 THEN
         v_phase := 'RUN_ENTRANTS';
         IF r.purge_windows IS NULL THEN
           UPDATE test_runs SET purge_windows = jsonb_build_object(
               'fromId', v_from, 'toId', v_to, 'from', v_tfrom, 'to', v_tto, 'accounts', to_jsonb(v_a))
            WHERE id = p_run;
         END IF;
         DELETE FROM test_run_entrants WHERE run_id = p_run AND account_id IN (
           SELECT account_id FROM test_run_entrants WHERE run_id = p_run AND account_id = ANY (v_afull) ORDER BY account_id LIMIT v_max);
         GET DIAGNOSTICS v_d = ROW_COUNT;
         v_deleted := orbes_purge_count(v_deleted, 'test_run_entrants', v_d);
         v_left := v_n - v_d;
       END IF;
     END IF;
     -- 10. the scope's accounts no test holds any more, atomic per account, max / 10 of them per call
     IF v_phase IS NULL THEN
       v_res := orbes_purge_accounts(v_a, greatest(v_max / 10, 1), v_hi, p_run);
       v_accounts := v_res -> 'deletedAccounts';
       v_deleted := v_res -> 'deleted';
       v_left := (v_res ->> 'left')::bigint;
       v_kept := v_kept || jsonb_build_object('accounts', (v_res ->> 'kept')::int);
       v_phase := CASE WHEN jsonb_array_length(v_accounts) > 0 OR v_left > 0 THEN 'ACCOUNTS' ELSE 'ACCOUNTS_DONE' END;
     END IF;

     RETURN jsonb_build_object('deleted', v_deleted, 'deletedAccounts', v_accounts, 'left', v_left, 'kept', v_kept, 'phase', v_phase);
   END $$`,

  // ── one batch of PURGE ALL's final sweep of the pool (§A.2) ──────────────
  `CREATE FUNCTION orbes_purge_test_pool_batch(p_max int) RETURNS jsonb LANGUAGE plpgsql ${DEFINER} AS $$
   DECLARE
     v_max int := least(greatest(coalesce(p_max, 1), 1), 1000);
     v_kind text;
     v_su bigint;
     v_cands uuid[];
     v_a uuid[];
     v_res jsonb;
     v_left bigint;
   BEGIN
     ${START_GUARDS}
     v_kind := orbes_maintenance_window_within(now(), interval '1 minute');
     IF v_kind IS NOT NULL THEN
       ${refuse('PURGE_WINDOW', 'v_kind')};
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs WHERE status = 'RUNNING') THEN
       ${refuse('PURGE_TEST_RUNNING', `'a test is running'`)};
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs WHERE status <> 'ENDED') THEN
       ${refuse('PURGE_RUNS_NOT_ENDED', `'a test is not ended'`)};
     END IF;
     -- Asked from the chain only (H12): the newest PURGE ALL step-up of an admin, under 24 h old.
     SELECT max(s.id) INTO v_su
       FROM admin_users a
       CROSS JOIN LATERAL (
         SELECT l.id, l.occurred_at FROM audit_logs l
          WHERE l.target_type = 'admin' AND l.target_id = a.id::text AND l.action = 'admin.step_up'
            AND (l.details ->> 'purpose') = 'test_run.purge_all'
          ORDER BY l.id DESC LIMIT 1) s
      WHERE s.occurred_at > now() - interval '24 hours';
     IF v_su IS NULL THEN
       ${refuse('PURGE_ALL_NOT_REQUESTED', `'no PURGE ALL was asked in the last 24 hours'`)};
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs WHERE purge_step_up_id = v_su
                  AND (purge_state = 'PURGING' OR (purge_state = 'PAUSED' AND purge_reason IN ('PURGE_WINDOW', 'PURGE_TEST_RUNNING')))) THEN
       ${refuse('PURGE_ALL_NOT_DONE', `'a test of this PURGE ALL is still being purged'`)};
     END IF;
     -- The pool's accounts in no test at all, by step 10's rules, bounded by their stored ranges below the step-up.
     v_cands := array(SELECT t.account_id FROM test_entrants t
                       WHERE NOT EXISTS (SELECT 1 FROM test_run_entrants e WHERE e.account_id = t.account_id) ORDER BY 1);
     v_a := orbes_purge_scope(v_cands);
     v_res := orbes_purge_accounts(v_a, greatest(v_max / 10, 1), v_su, NULL);
     v_left := (v_res ->> 'left')::bigint;
     RETURN jsonb_build_object(
       'deleted', v_res -> 'deleted',
       'deletedAccounts', v_res -> 'deletedAccounts',
       'left', v_left,
       'kept', jsonb_build_object('accounts', (v_res ->> 'kept')::int + (cardinality(v_cands) - cardinality(v_a))),
       'phase', CASE WHEN jsonb_array_length(v_res -> 'deletedAccounts') > 0 OR v_left > 0 THEN 'POOL' ELSE 'POOL_DONE' END);
   END $$`,

  // The helpers run only inside the purge (the definer functions' owner); the app keeps the two batches and the windows.
  `REVOKE EXECUTE ON FUNCTION orbes_purge_count(jsonb, text, bigint), orbes_purge_scope(uuid[]), orbes_purge_held(text, uuid[]),
     orbes_purge_free(uuid[], bigint), orbes_purge_accounts(uuid[], int, bigint, uuid) FROM PUBLIC`,
];

export const DOWN: readonly string[] = [
  // The tombstones carry the chain over the rows the purge deleted: dropping them would leave it BROKEN.
  `DO $$
   DECLARE gaps bigint; purges bigint;
   BEGIN
     SELECT count(*) INTO gaps FROM audit_purge_gaps;
     SELECT count(*) INTO purges FROM test_runs WHERE purge_state IS NOT NULL;
     IF gaps > 0 OR purges > 0 THEN
       RAISE EXCEPTION 'migration 0066_test_purge cannot be rolled back: % audit tombstones and % test purges exist', gaps, purges;
     END IF;
   END $$`,
  `DROP FUNCTION IF EXISTS orbes_purge_test_pool_batch(int)`,
  `DROP FUNCTION IF EXISTS orbes_purge_test_run_batch(uuid, int)`,
  `DROP FUNCTION IF EXISTS orbes_purge_accounts(uuid[], int, bigint, uuid)`,
  `DROP FUNCTION IF EXISTS orbes_purge_free(uuid[], bigint)`,
  `DROP FUNCTION IF EXISTS orbes_purge_held(text, uuid[])`,
  `DROP FUNCTION IF EXISTS orbes_purge_scope(uuid[])`,
  `DROP FUNCTION IF EXISTS orbes_purge_count(jsonb, text, bigint)`,
  `DROP FUNCTION IF EXISTS orbes_maintenance_window_within(timestamptz, interval)`,
  `DROP FUNCTION IF EXISTS orbes_maintenance_window(timestamptz)`,
  `DROP FUNCTION IF EXISTS orbes_purge_plan()`,
  `DROP TABLE IF EXISTS purge_delete_tables`,
  `DROP TABLE IF EXISTS audit_purge_gaps`,
  `DROP TRIGGER IF EXISTS test_runs_purge_guard ON test_runs`,
  `DROP FUNCTION IF EXISTS orbes_test_runs_purge_guard()`,
  `DROP INDEX IF EXISTS test_runs_purge_requested_by_idx`,
  `ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_purge_done, DROP CONSTRAINT IF EXISTS test_runs_purge_paused,
     DROP CONSTRAINT IF EXISTS test_runs_purge_requested, DROP CONSTRAINT IF EXISTS test_runs_purge_ended`,
  `ALTER TABLE test_runs DROP COLUMN IF EXISTS purge_result, DROP COLUMN IF EXISTS purge_reason, DROP COLUMN IF EXISTS purge_windows,
     DROP COLUMN IF EXISTS purge_step_up_id, DROP COLUMN IF EXISTS purge_summary, DROP COLUMN IF EXISTS purged_at,
     DROP COLUMN IF EXISTS purge_requested_by, DROP COLUMN IF EXISTS purge_requested_at, DROP COLUMN IF EXISTS purge_state`,
  `DROP FUNCTION IF EXISTS orbes_require_superuser()`,
  REJECT_0001,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
