/**
 * 0024a — the test entrants (the owner's lot of 2026-10-07: TEST ENTRANTS, services/test-entrants.ts): artificial
 * collectors the console sends into a draw or a LIVE RELEASE, real ORBES accounts that behave as any collector does.
 * Named `0024a` so that it sorts after 0024 and before the next lot's 0025 (Kysely refuses migrations out of order).
 *
 * `test_entrants`: the pool of test accounts, one row per account (`test-0001@orbes.test`, …): the tier (0 to 3) and
 * the seniority (0 to 50 full years) the club reads for it instead of its pieces (services/club.ts `clubStandings`),
 * set by each press that sends it. A test account also counts as owning the release's model and collection for a LIVE
 * RELEASE's rule (services/live.ts `accessOf`). Nothing else of the code tells it apart.
 *
 * `test_runs`: one test, on one release (`drop_id`, its `mode` copied): RUNNING (its bots acting), DONE (every bot
 * has acted; a draw's waits there for the staff's draw), STOPPED (STOP), INTERRUPTED (a restart while it ran), ENDED
 * (END TEST, its clean-up done, `ended_at` and `ended_by` then set: `test_runs_ended`). At most one RUNNING in the
 * whole database (`test_runs_one_running`, a unique partial index): one test at a time. `settings` is the list of its
 * presses (START, then each ADD MORE), each with its settings; `entrants` the bots sent; `report` the TEST REPORT
 * computed at END TEST before the clean-up; `peaks` the test's running maxima from the server status sampler.
 *
 * `test_run_entrants`: one row per bot of a run: its network (its own /24 of 100.64.0.0/10, RFC 6598, or the shared
 * one), its plan (what it was drawn to do: arrival, choices, outcome, auto-confirm), the outcome it reached, and for a
 * draw's place it confirms by itself the time it does (`confirm_due_at`, read by the sweeper after a restart too).
 *
 * Every foreign key leads an index, or is the head of the primary key; ON DELETE RESTRICT like every other. Nothing in
 * an older image reads or writes the three tables. One statement per array entry (PGlite's extended protocol);
 * Kysely's Migrator applies the migration inside a transaction. The down step drops the three tables (the accounts of
 * the pool stay, plain accounts again): the schema of 0024.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/migrations.test.ts checks they match schema.ts.
const MODES = `'DRAW','LIVE'`;
const STATUSES = `'RUNNING','DONE','STOPPED','INTERRUPTED','ENDED'`;

export const UP: readonly string[] = [
  `CREATE TABLE test_entrants (
     account_id uuid        PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     tier       smallint    NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 3),
     seniority  smallint    NOT NULL DEFAULT 0 CHECK (seniority BETWEEN 0 AND 50),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE test_runs (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id    uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     mode       text        NOT NULL CHECK (mode IN (${MODES})),
     status     text        NOT NULL DEFAULT 'RUNNING' CHECK (status IN (${STATUSES})),
     settings   jsonb       NOT NULL CHECK (jsonb_typeof(settings) = 'array'),
     entrants   int         NOT NULL CHECK (entrants BETWEEN 0 AND 5000),
     created_by uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     ended_at   timestamptz NULL,
     ended_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     report     jsonb       NULL CHECK (jsonb_typeof(report) = 'object'),
     peaks      jsonb       NULL CHECK (jsonb_typeof(peaks) = 'object'),
     CONSTRAINT test_runs_ended CHECK ((status = 'ENDED') = (ended_at IS NOT NULL) AND (ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL OR ended_at >= created_at))
   )`,
  // A release's tests, the latest first (its page's PAST TESTS and the run under way).
  `CREATE INDEX test_runs_drop_idx ON test_runs (drop_id, created_at)`,
  `CREATE INDEX test_runs_created_by_idx ON test_runs (created_by)`,
  `CREATE INDEX test_runs_ended_by_idx ON test_runs (ended_by)`,
  // One test at a time in the whole console.
  `CREATE UNIQUE INDEX test_runs_one_running ON test_runs (status) WHERE status = 'RUNNING'`,

  `CREATE TABLE test_run_entrants (
     run_id         uuid        NOT NULL REFERENCES test_runs (id) ON DELETE RESTRICT,
     account_id     uuid        NOT NULL REFERENCES test_entrants (account_id) ON DELETE RESTRICT,
     network        text        NOT NULL CHECK (network ~ '^100\\.[0-9]{1,3}\\.[0-9]{1,3}\\.0/24$'),
     plan           jsonb       NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
     outcome        text        NULL CHECK (outcome ~ '^[A-Z_]{1,40}$'),
     confirm_due_at timestamptz NULL,
     updated_at     timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (run_id, account_id)
   )`,
  `CREATE INDEX test_run_entrants_account_idx ON test_run_entrants (account_id)`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS test_run_entrants`, `DROP TABLE IF EXISTS test_runs`, `DROP TABLE IF EXISTS test_entrants`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
