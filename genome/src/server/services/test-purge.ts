/**
 * TEST PURGE (lot PURGE, plan §A.4; the owner's answers of 27 Oct 2026, answer 4 and Claude's points 1, 2, 6, 7 and
 * 8): an ended test's entries, cancelled orders, sessions, audit rows and test accounts deleted in bounded batches by
 * the database itself (migration 0066, `orbes_purge_test_run_batch` and `orbes_purge_test_pool_batch`, which re-check
 * every rule at every call and trust nothing of the app); its report stays as a stored summary.
 *
 * The request (ADMIN; the routes come with step PURGE.6):
 *  - one test: the phrase `PURGE TEST <the run id's first 8 characters>` and a fresh code of the admin's authenticator
 *    app. Pre-checked here first, with the console's words, Paris time first (a forbidden window with the batch's
 *    1-minute margin, a test RUNNING, the test not ENDED, already purged or being purged, its release not over, another
 *    test of the release not ended, a DRAWN draw holding an entry of anyone outside the test: PURGE_NOT_TEST). Then the
 *    step-up verified BEFORE the transaction (AuthService.verifyAdminStepUp: a wrong code is counted in its own commit),
 *    then ONE transaction: the step-up consumed first (its `admin.step_up` row is what the database's guard of
 *    `test_runs` looks for), the run and the release's rows FOR UPDATE (the release and its after-room: the row lock the
 *    staff's draw actions take) and every pre-check again under that lock, the run's figures stored as the console
 *    showed them (`purge_summary`, once), PURGING, audited `test_run.purge.start`. On a PAUSED test the same request is
 *    a RESUME (H12): the same step-up and checks, PAUSED → PURGING, its reason cleared, audited `test_run.purge.resume`;
 *    the summary and the step-up the database stored at the first request stay as they are;
 *  - PURGE ALL ENDED TESTS: the phrase `PURGE ALL TESTS` and a code, one step-up for every ended test whose release is
 *    over (PURGING, each with its summary, `all: true` for the console only), the PAUSED ones resumed, the others listed
 *    as skipped with their reason; audited `test_run.purge_all.start`. Once none of them is still being purged, the
 *    pool's accounts no test holds any more are swept (`orbes_purge_test_pool_batch`, which reads its authorization from
 *    the audit chain's own step-up row, never from anything the app wrote); audited `test_run.purge_all.done`. The sweep
 *    waits while any test of any release is not ENDED (or a window, or a test running); still held when its step-up is
 *    24 h old (PURGE_ALL_SWEEP_MS), it stops, audited `test_run.purge_all.pause` with what held it.
 *
 * The loop (`start`, every second, single-flight; `pass` is one step, the tests drive it on a manual clock): the oldest
 * test PURGING, or PAUSED for a window or a running test. Inside a forbidden window (1-minute margin) or while a test is
 * RUNNING: PAUSED with that reason (audited `test_run.purge.pause` once per pause), resumed by the loop when it clears.
 * Otherwise one function call per transaction (`SET LOCAL statement_timeout = '20s'`, 500 rows, or 50 accounts at step
 * 10), then a 300 ms pause before the next. Before the first call that can delete accounts (step 9 has stored the run's
 * windows), the views' buffer is written (TrackingService.flushNow), so no buffered view names an account about to go.
 * After every call that deleted accounts, and once more when the test is done, what this process still holds of them is
 * forgotten: the test entrants' set read again, the release's readings dropped and its room built again from the
 * database (LiveFrameGate.forget), the views' devices and rows naming one cleared (TrackingService.forgetAccounts). The
 * last call (ACCOUNTS_DONE) sets DONE with `purge_result` in its own transaction, audited `test_run.purge.done`.
 *
 * What a refusal does: the database's own refusal (SQLSTATE OR010) pauses with its reason (a window or a running test
 * clears by itself; any other, such as PURGE_NOT_TEST, waits for a new request); a lock or statement timeout, a
 * serialization failure or a deadlock (55P03, 57014, 40001, 40P01) is tried again after 1, 2, 4 and 8 s and pauses
 * `PURGE_STUCK_<SQLSTATE>` at the 5th in a row; any other SQLSTATE pauses `SQLSTATE_<code>` at once (purge_reason holds
 * capitals, digits and underscores only). Never retried for
 * ever. A test PAUSED for good lifts the staff's guard on its release (DropService `lockUnpurged`, plan §N, G14).
 *
 * `boot` (at the app's start): the tests left PURGING, or PAUSED for a window or a running test, go on (each call
 * commits on its own and the function is idempotent); a PURGE ALL of the last 24 h whose sweep did not end goes on.
 *
 * LOCK ORDER (PostgreSQL): every transaction here takes the test runs' rows, then the releases' rows, then the
 * admin's row and the audit chain's lock (an audit row holds it until the commit): the batch function locks the run
 * then its release; the staff's draw actions lock the release then write their audit row; so a request locks the run
 * and its release BEFORE it consumes the step-up (which writes `admin.step_up`), and the loop writes its pause and
 * DONE rows after the run's row. The step-up is still consumed before anything else is written, inside the action's
 * transaction, so it is used only by a request that commits (plan §S.1); taken in the other order, a request and an
 * OFFER NEXT pressed at the same moment on the same release could deadlock.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { pgError, purgeRefusal } from '../db/pg-errors.js';
import { PURGE_REFERENCES } from '../db/purge-plan.js';
import { jsonText, type JsonObject, type TestRunPurgeState, type TestRunStatus, type DropMode } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError, type DomainError } from '../errors.js';
import { noopLogger, systemActor, systemClock, type Actor, type Clock, type Logger } from '../types.js';
import type { AuditService } from './audit.js';
import type { AuthService, ClientMeta, VerifiedStepUp } from './auth.js';
import type { LiveFrameGate } from './live-frames.js';
import { MAINTENANCE_MARGIN_MS, maintenanceWindow, parisClock, windowWords } from './maintenance-window.js';
import { orderReference } from './orders.js';
import type { TestEntrantAccounts } from './population.js';
import { TEST_EMAIL_DOMAIN, TEST_PASSWORD_HASH, testRunFigures, type TestRunView } from './test-entrants.js';
import type { TrackingService } from './tracking.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The phrase of PURGE ALL ENDED TESTS. */
export const PURGE_ALL_PHRASE = 'PURGE ALL TESTS';
/** Rows per call of steps 1 to 9 (the function takes a tenth of it as accounts at step 10, and clamps it to 1 000). */
export const PURGE_BATCH_ROWS = 500;
/** The loop's tick (single-flight), and the pause between two calls while there is work. */
export const PURGE_TICK_MS = 1000;
export const PURGE_PAUSE_MS = 300;
/** Each call's statement timeout (under the 30 s of the server and Fastify). */
export const PURGE_STATEMENT_TIMEOUT = '20s';
/** The waits before a call is tried again after a timeout, a serialization failure or a deadlock; paused at the 5th in a row. */
export const PURGE_RETRY_MS: readonly number[] = Object.freeze([1000, 2000, 4000, 8000, 16000]);
export const PURGE_RETRY_MAX = 5;
/**
 * How long a PURGE ALL's sweep waits for its tests (each ENDED, none being purged) before it stops: its step-up's 24 h,
 * after which the pool function refuses it anyway (PURGE_ALL_NOT_REQUESTED).
 */
export const PURGE_ALL_SWEEP_MS = 24 * 3_600_000;
/** The pauses that clear by themselves: the loop resumes them; the staff's guard holds while they last. */
export const PURGE_SELF_CLEARING: readonly string[] = Object.freeze(['PURGE_WINDOW', 'PURGE_TEST_RUNNING']);
/** The SQLSTATEs tried again (plan §A.4): lock timeout, statement timeout, serialization failure, deadlock. */
const RETRYABLE: ReadonlySet<string> = new Set(['55P03', '57014', '40001', '40P01']);
/** The names of the SQLSTATEs the console may show (PostgreSQL's own names); any other is shown by its code. */
const SQLSTATE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '55P03': 'lock_not_available',
  '57014': 'query_canceled',
  '40001': 'serialization_failure',
  '40P01': 'deadlock_detected',
  '23503': 'foreign_key_violation',
  '23001': 'restrict_violation',
  '23505': 'unique_violation',
  '23514': 'check_violation',
  '23502': 'not_null_violation',
  OR001: 'guard_violation',
  ERROR: 'no answer',
});
/** The blocking orders a summary names, at most (the console lists them). */
const BLOCKING_LISTED_MAX = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURGE_ACTOR = systemActor('test-purge');

/** The phrase of one test's PURGE: `PURGE TEST 1A2B3C4D` (the run's id, its first 8 characters). */
export function purgePhrase(runId: string): string {
  return `PURGE TEST ${runId.slice(0, 8).toUpperCase()}`;
}

function checkPhrase(typed: unknown, wanted: string): void {
  if (typeof typed !== 'string' || typed.trim().replace(/\s+/g, ' ').toUpperCase() !== wanted) throw validationError(`Type ${wanted} to confirm.`);
}

/** A SQLSTATE's name, or its code. */
export function sqlstateName(code: string): string {
  return SQLSTATE_NAMES[code] ?? code;
}

// ── Types ──────────────────────────────────────────────────────────────────

/** What one batch call answers (migration 0066). */
export interface PurgeBatch {
  phase: string;
  left: number;
  deleted: Record<string, number>;
  deletedAccounts: string[];
  kept: { orders?: number; entries?: number; accounts: number };
}

/**
 * The run's figures as the console showed them, stored once by the request (`test_runs.purge_summary`): the view's
 * byTier, release and selected, what the purge plans to delete and the orders that will keep their accounts.
 * `all`: requested by PURGE ALL (for the console only: no function reads the summary).
 */
export interface TestPurgeSummary extends Pick<TestRunView, 'byTier' | 'release' | 'selected'> {
  all: boolean;
  planned: { accounts: number; entries: number; orders: number };
  /** The test's orders a purge keeps with their accounts (an invoice, a parcel, a return, or not cancelled). */
  blockingOrders: number;
  blocking: { orderRef: string; status: string }[];
  /** A draw of the release was drawn: its public ranked list no longer matches its seed once purged. */
  drawn: boolean;
}

/** A run's purge as the console reads it (TestEntrantService.view and list). */
export interface TestPurgeView {
  state: TestRunPurgeState;
  /** Why it is PAUSED (purge_reason), else null. */
  reason: string | null;
  /** That reason in the console's words, Paris time first; null unless PAUSED. */
  message: string | null;
  requestedAt: Date | null;
  /** The ADMIN who asked (email). */
  requestedBy: string | null;
  purgedAt: Date | null;
  all: boolean;
  /** Once DONE: rows deleted by table, and what was kept (purge_result). */
  deleted: Record<string, number> | null;
  kept: JsonObject | null;
  /** While under way: this process's calls so far (its phase and the rows they deleted); null otherwise. */
  progress: { phase: string | null; rows: number } | null;
}

/** Whether PURGE can be pressed on a run: true, or why not (the console's muted line). */
export type Purgeable = true | { reason: string; message: string };

/** Who asks: the console's ADMIN and its session's token (the step-up checks the session passed the code). */
export interface PurgeAsker {
  actor: Actor;
  token: string;
}

export interface PurgeInput {
  phrase: unknown;
  totp: unknown;
}

export interface TestPurgeServiceDeps {
  db: Db;
  audit: AuditService;
  auth: Pick<AuthService, 'verifyAdminStepUp' | 'consumeAdminStepUp'>;
  clock?: Clock;
  log?: Logger;
  testEntrantAccounts: Pick<TestEntrantAccounts, 'invalidate'>;
  tracking: Pick<TrackingService, 'flushNow' | 'forgetAccounts'>;
  liveFrames: Pick<LiveFrameGate, 'forget'>;
}

/** What one pass of the loop did (tests). */
export type PurgePass = 'idle' | 'called' | 'done' | 'paused' | 'waiting' | 'retry';

interface RunRow {
  id: string;
  drop_id: string;
  mode: DropMode;
  status: TestRunStatus;
  purge_state: TestRunPurgeState | null;
  purge_reason: string | null;
  purge_windows: JsonObject | null;
}

// ── Errors ─────────────────────────────────────────────────────────────────

const runNotFound = () => notFound('Test', 'TEST_RUN_NOT_FOUND');
const REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  PURGE_NOT_ENDED: 'Only an ended test can be purged: END TEST first.',
  PURGE_IN_PROGRESS: 'This test is being purged.',
  PURGE_DONE: 'This test is already purged.',
  PURGE_TEST_RUNNING: 'A test is running. Purge once it has ended.',
  PURGE_RELEASE_NOT_OVER: 'Purge once the release is over.',
  PURGE_RUNS_NOT_ENDED: 'Another test of this release has not ended. END TEST on it first.',
  PURGE_NOT_TEST: 'This draw was drawn with real collectors’ entries: its public ranked list stays as drawn, so this test cannot be purged.',
});

function refusal(reason: string, now: Date): DomainError {
  if (reason === 'PURGE_WINDOW') return conflict('PURGE_WINDOW', windowWords(now, MAINTENANCE_MARGIN_MS.purgeBatch) ?? 'A maintenance window is under way. Try again in a few minutes.');
  return conflict(reason, REFUSAL_WORDS[reason] ?? 'This test cannot be purged now.');
}

/** A PAUSED purge's reason in the console's words (plan §A.6), Paris time first, the window's end computed for its date. */
export function pauseWords(reason: string, now: Date): string {
  if (reason === 'PURGE_WINDOW') {
    const w = maintenanceWindow(now, MAINTENANCE_MARGIN_MS.purgeBatch);
    if (!w) return 'Paused for a maintenance window; it goes on in a moment.';
    return `Paused for ${w.kind === 'NIGHT' ? 'the night maintenance' : 'the hub backup'} until ${parisClock(w.endsAt)} Paris.`;
  }
  if (reason === 'PURGE_TEST_RUNNING') return 'Paused while a test is running; it goes on once that test has stopped.';
  if (reason === 'PURGE_NOT_TEST') return 'A real collector’s entry is now in this drawn draw: the purge stopped here.';
  if (reason === 'PURGE_RELEASE_NOT_OVER') return 'Stopped: the release is no longer over. Nothing more is deleted until it is asked again.';
  if (reason === 'PURGE_RUNS_NOT_ENDED') return 'Stopped: another test of this release has not ended. Nothing more is deleted until it is asked again.';
  const code = /^(?:PURGE_STUCK|SQLSTATE)_([0-9A-Z]{5}|ERROR)$/.exec(reason)?.[1];
  const name = code !== undefined ? sqlstateName(code) : reason;
  return `Stopped: the database refused a step (${name}). Nothing more is deleted until it is asked again.`;
}

function assertAdmin(actor: Actor): string {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only an ORBES admin can purge a test.');
  return actor.id.toLowerCase();
}

// ── The service ────────────────────────────────────────────────────────────

export class TestPurgeService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly auth: TestPurgeServiceDeps['auth'];
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly testEntrantAccounts: TestPurgeServiceDeps['testEntrantAccounts'];
  private readonly tracking: TestPurgeServiceDeps['tracking'];
  private readonly liveFrames: TestPurgeServiceDeps['liveFrames'];
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private passing: Promise<PurgePass> | null = null;
  private draining: Promise<void> | null = null;
  /** Calls failed in a row with a SQLSTATE tried again, and when the next try may run (the clock's ms). */
  private failures = 0;
  private retryAt = 0;
  /** The runs whose views' buffer was written before their account steps, in this process. */
  private readonly flushed = new Set<string>();
  /** This process's calls per run: the phase, the rows deleted by table. */
  private readonly counted = new Map<string, { phase: string | null; deleted: Record<string, number> }>();
  /** The runs this process took over at boot (their counts start there). */
  private readonly takenOver = new Set<string>();
  /**
   * The pool sweep of a PURGE ALL under way: who asked (its audit rows target them), when (ms; it stops waiting
   * PURGE_ALL_SWEEP_MS later), and whether the buffer was written.
   */
  private sweep: { adminId: string; startedAt: number; flushed: boolean; deleted: Record<string, number> } | null = null;
  /** Rows per call (PURGE_BATCH_ROWS; tests lower it to see step 10 span several calls). */
  batchRows = PURGE_BATCH_ROWS;
  /** How the loop waits between two calls (tests on a manual clock replace it). */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

  constructor(deps: TestPurgeServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.auth = deps.auth;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.testEntrantAccounts = deps.testEntrantAccounts;
    this.tracking = deps.tracking;
    this.liveFrames = deps.liveFrames;
  }

  // ── The requests ─────────────────────────────────────────────────────────

  /**
   * PURGE one ended test (see the header), or RESUME it when PAUSED. Refused: 404 TEST_RUN_NOT_FOUND, 400 for the
   * phrase, 409 PURGE_IN_PROGRESS / PURGE_DONE / PURGE_NOT_ENDED / PURGE_WINDOW / PURGE_TEST_RUNNING /
   * PURGE_RELEASE_NOT_OVER / PURGE_RUNS_NOT_ENDED / PURGE_NOT_TEST with the console's words, and the step-up's own
   * answers (400, 403, 429; 401 only for an ended session). Nothing is written by a refusal, and the code is consumed
   * only by a request that commits.
   */
  async request(runId: string, input: PurgeInput, asker: PurgeAsker, meta: ClientMeta = {}): Promise<{ runId: string; resumed: boolean }> {
    const admin = assertAdmin(asker?.actor);
    if (typeof runId !== 'string' || !UUID_RE.test(runId)) throw runNotFound();
    const id = runId.toLowerCase();
    const first = await this.runRow(this.db, id);
    if (!first) throw runNotFound();
    checkPhrase(input?.phrase, purgePhrase(id));
    const now = this.clock();
    const before = await this.check(this.db, first, now, { global: true });
    if (before) throw refusal(before, now);
    const verified = await this.auth.verifyAdminStepUp(
      { adminId: admin, token: asker.token, totp: input.totp, purpose: `test_run.purge:${id}`, requirePassword: false },
      meta,
    );
    const resumed = await inTransaction(this.db, async (tx) => {
      // The run's and the release's rows first, then the step-up consumed before anything is written (see LOCK ORDER).
      const run = await this.lockRuns(tx, [id]);
      const r = run.get(id);
      if (!r) throw runNotFound();
      await this.lockReleases(tx, [r.drop_id]);
      await this.auth.consumeAdminStepUp(verified, tx, meta);
      const at = this.clock();
      const why = await this.check(tx, r, at, { global: true });
      if (why) throw refusal(why, at);
      if (r.purge_state === 'PAUSED') {
        await this.resume(tx, r, asker.actor, verified);
        return true;
      }
      await this.begin(tx, r, admin, at, false, asker.actor);
      return false;
    });
    if (!resumed) this.counted.delete(id);
    return { runId: id, resumed };
  }

  /**
   * PURGE ALL ENDED TESTS (see the header): one step-up; every ended test whose release is over PURGING, the PAUSED
   * ones resumed, the others skipped with their reason; then the pool sweep. Refused before anything: 400 for the
   * phrase, 409 PURGE_WINDOW / PURGE_TEST_RUNNING, the step-up's answers.
   */
  async requestAll(input: PurgeInput, asker: PurgeAsker, meta: ClientMeta = {}): Promise<{ runs: string[]; resumed: string[]; skipped: { runId: string; reason: string; message: string }[] }> {
    const admin = assertAdmin(asker?.actor);
    checkPhrase(input?.phrase, PURGE_ALL_PHRASE);
    const now = this.clock();
    const global = await this.globalHold(this.db, now);
    if (global) throw refusal(global, now);
    const verified = await this.auth.verifyAdminStepUp({ adminId: admin, token: asker.token, totp: input.totp, purpose: 'test_run.purge_all', requirePassword: false }, meta);
    const out = await inTransaction(this.db, async (tx) => {
      const ids = (
        await tx
          .selectFrom('test_runs')
          .select('id')
          .where('status', '=', 'ENDED')
          .where((eb) => eb.or([eb('purge_state', 'is', null), eb('purge_state', '=', 'PAUSED')]))
          .orderBy('id')
          .execute()
      ).map((r) => r.id);
      const runs = await this.lockRuns(tx, ids);
      await this.lockReleases(tx, [...new Set([...runs.values()].map((r) => r.drop_id))]);
      await this.auth.consumeAdminStepUp(verified, tx, meta);
      const at = this.clock();
      const hold = await this.globalHold(tx, at);
      if (hold) throw refusal(hold, at);
      const started: string[] = [];
      const resumed: string[] = [];
      const skipped: { runId: string; reason: string; message: string }[] = [];
      for (const id of ids) {
        const r = runs.get(id);
        if (!r || r.status !== 'ENDED' || (r.purge_state !== null && r.purge_state !== 'PAUSED')) continue;
        const why = await this.check(tx, r, at, { global: false });
        if (why) {
          skipped.push({ runId: id, reason: why, message: REFUSAL_WORDS[why] ?? why });
        } else if (r.purge_state === 'PAUSED') {
          await this.resume(tx, r, asker.actor, verified, true);
          resumed.push(id);
        } else {
          await this.begin(tx, r, admin, at, true, null);
          started.push(id);
        }
      }
      await this.audit.record(
        {
          actor: asker.actor,
          action: 'test_run.purge_all.start',
          targetType: 'admin',
          targetId: admin,
          details: { runs: started, resumed, skipped: skipped.map((s) => ({ runId: s.runId, reason: s.reason })) },
        },
        tx,
      );
      return { runs: started, resumed, skipped };
    });
    for (const id of out.runs) this.counted.delete(id);
    this.sweep = { adminId: admin, startedAt: now.getTime(), flushed: false, deleted: {} };
    return out;
  }

  /** NULL → PURGING: the run's figures stored once, the request's admin, audited `test_run.purge.start` (one test's request only). */
  private async begin(tx: Db, r: RunRow, admin: string, at: Date, all: boolean, actor: Actor | null): Promise<void> {
    const summary = await this.summaryOf(tx, r, all);
    const updated = await tx
      .updateTable('test_runs')
      .set({ purge_state: 'PURGING', purge_requested_at: at, purge_requested_by: admin, purge_summary: jsonText(summary as unknown as JsonObject) })
      .where('id', '=', r.id)
      .where('purge_state', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw refusal('PURGE_IN_PROGRESS', at);
    if (actor) {
      await this.audit.record(
        {
          actor,
          action: 'test_run.purge.start',
          targetType: 'test_run',
          targetId: r.id,
          details: { dropId: r.drop_id, planned: summary.planned, blockingOrders: summary.blockingOrders, drawn: summary.drawn },
        },
        tx,
      );
    }
  }

  /** PAUSED → PURGING by a request (H12): the reason cleared, audited `test_run.purge.resume`; the stored request untouched. */
  private async resume(tx: Db, r: RunRow, actor: Actor, verified: VerifiedStepUp, all = false): Promise<void> {
    const updated = await tx
      .updateTable('test_runs')
      .set({ purge_state: 'PURGING', purge_reason: null })
      .where('id', '=', r.id)
      .where('purge_state', '=', 'PAUSED')
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw refusal('PURGE_IN_PROGRESS', this.clock());
    await this.audit.record(
      { actor, action: 'test_run.purge.resume', targetType: 'test_run', targetId: r.id, details: { reason: r.purge_reason, via: all ? 'purge_all' : 'request', purpose: verified.purpose } },
      tx,
    );
  }

  // ── Checks ───────────────────────────────────────────────────────────────

  private async runRow(db: Db, id: string): Promise<RunRow | undefined> {
    return db.selectFrom('test_runs').select(['id', 'drop_id', 'mode', 'status', 'purge_state', 'purge_reason', 'purge_windows']).where('id', '=', id).executeTakeFirst();
  }

  /** The runs FOR UPDATE, in id order (the purge function takes the run's row first too). */
  private async lockRuns(tx: Db, ids: readonly string[]): Promise<Map<string, RunRow>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .selectFrom('test_runs')
      .select(['id', 'drop_id', 'mode', 'status', 'purge_state', 'purge_reason', 'purge_windows'])
      .where('id', 'in', [...ids].sort())
      .orderBy('id')
      .forUpdate()
      .execute();
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The releases and their after-rooms FOR UPDATE, in id order (the staff's draw actions and the batches take these rows). */
  private async lockReleases(tx: Db, dropIds: readonly string[]): Promise<void> {
    if (dropIds.length === 0) return;
    await tx
      .selectFrom('drops')
      .select('id')
      .where((eb) => eb.or([eb('id', 'in', [...dropIds]), eb('parent_drop_id', 'in', [...dropIds])]))
      .orderBy('id')
      .forUpdate()
      .execute();
  }

  /** A forbidden window (with the batch's margin) or a test RUNNING anywhere: the reason, or null. */
  private async globalHold(db: Db, now: Date): Promise<'PURGE_WINDOW' | 'PURGE_TEST_RUNNING' | null> {
    if (maintenanceWindow(now, MAINTENANCE_MARGIN_MS.purgeBatch)) return 'PURGE_WINDOW';
    if (await db.selectFrom('test_runs').select('id').where('status', '=', 'RUNNING').limit(1).executeTakeFirst()) return 'PURGE_TEST_RUNNING';
    return null;
  }

  /**
   * Why `r` cannot be purged (or resumed) now, or null: its state (not ENDED, being purged, purged), then with `global`
   * a window or a running test, then its release: not over (cancelled, ended, or drawn with no place still offered; its
   * after-room the same), another test of it not ended, a drawn draw of it holding an entry outside the test (the same
   * rules as the function's, which decides again at every call).
   */
  private async check(db: Db, r: RunRow, now: Date, opts: { global: boolean }): Promise<string | null> {
    if (r.purge_state === 'DONE') return 'PURGE_DONE';
    if (r.purge_state === 'PURGING') return 'PURGE_IN_PROGRESS';
    if (r.status !== 'ENDED') return 'PURGE_NOT_ENDED';
    if (opts.global) {
      const hold = await this.globalHold(db, now);
      if (hold) return hold;
    }
    const drops = await db
      .selectFrom('drops as d')
      .select((eb) => [
        'd.id',
        'd.mode',
        'd.cancelled_at',
        'd.ended_at',
        'd.drawn_at',
        eb
          .exists(eb.selectFrom('drop_entries as e').select('e.id').whereRef('e.drop_id', '=', 'd.id').where('e.status', '=', 'SELECTED').where('e.respond_by', '>', now))
          .as('offering'),
      ])
      .where((eb) => eb.or([eb('d.id', '=', r.drop_id), eb('d.parent_drop_id', '=', r.drop_id)]))
      .execute();
    const over = (d: (typeof drops)[number]) => d.cancelled_at !== null || d.ended_at !== null || (d.mode === 'DRAW' && d.drawn_at !== null && !d.offering);
    if (drops.length === 0 || !drops.every(over)) return 'PURGE_RELEASE_NOT_OVER';
    const ids = drops.map((d) => d.id);
    if (await db.selectFrom('test_runs').select('id').where('drop_id', 'in', ids).where('status', '<>', 'ENDED').limit(1).executeTakeFirst()) return 'PURGE_RUNS_NOT_ENDED';
    if (drops.some((d) => d.drawn_at !== null) && (await this.realInDrawn(db, ids))) return 'PURGE_NOT_TEST';
    return null;
  }

  /**
   * Test releases only (D15, G1): whether a DRAWN draw of the release holds an entry, whatever its status, of an
   * account outside the tests of the release: a test entrant of the pool (its address, its password hash that never
   * matches) that one of the release's tests sent, or that one stored when it was purged.
   */
  private async realInDrawn(db: Db, dropIds: readonly string[]): Promise<boolean> {
    const ids = sql.join(dropIds.map((d) => sql`${d}::uuid`));
    const r = await sql<{ real: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM drops d JOIN drop_entries e ON e.drop_id = d.id
         WHERE d.id IN (${ids}) AND d.drawn_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM test_entrants t JOIN accounts a ON a.id = t.account_id
              WHERE t.account_id = e.account_id
                AND a.email_normalized LIKE ${`test-%@${TEST_EMAIL_DOMAIN}`} AND a.password_hash = ${TEST_PASSWORD_HASH}
                AND (EXISTS (SELECT 1 FROM test_run_entrants re JOIN test_runs x ON x.id = re.run_id
                              WHERE re.account_id = e.account_id AND x.drop_id IN (${ids}))
                     OR EXISTS (SELECT 1 FROM test_runs x
                                 WHERE x.drop_id IN (${ids}) AND jsonb_exists(coalesce(x.purge_windows -> 'accounts', '[]'::jsonb), e.account_id::text)))))
      AS real`.execute(db);
    return r.rows[0]?.real === true;
  }

  /** The run's figures as the view shows them, with what the purge plans (stored once by the request, on `tx`). */
  private async summaryOf(tx: Db, r: RunRow, all: boolean): Promise<TestPurgeSummary> {
    const figures = await testRunFigures(tx, r);
    const drops = await tx.selectFrom('drops').select(['id', 'drawn_at']).where((eb) => eb.or([eb('id', '=', r.drop_id), eb('parent_drop_id', '=', r.drop_id)])).execute();
    const ids = sql.join(drops.map((d) => sql`${d.id}::uuid`));
    const blockedBy = PURGE_REFERENCES.filter((x) => x.references === 'orders' && x.kind === 'BLOCK' && x.table !== 'orders');
    const held = sql.join(
      blockedBy.map((x) => sql`EXISTS (SELECT 1 FROM ${sql.table(x.table)} b WHERE ${sql.ref(`b.${x.columns}`)} = o.id)`),
      sql` OR `,
    );
    const counts = await sql<{ accounts: number; entries: number }>`
      SELECT (SELECT count(*)::int FROM test_run_entrants WHERE run_id = ${r.id}) AS accounts,
             (SELECT count(*)::int FROM drop_entries e WHERE e.drop_id IN (${ids})
                 AND e.account_id IN (SELECT account_id FROM test_run_entrants WHERE run_id = ${r.id}))
           + (SELECT count(*)::int FROM live_entries e WHERE e.drop_id IN (${ids})
                 AND e.account_id IN (SELECT account_id FROM test_run_entrants WHERE run_id = ${r.id})) AS entries`.execute(tx);
    const orders = await sql<{ id: string; status: string; blocking: boolean }>`
      SELECT o.id, o.status, (o.status <> 'CANCELLED' OR ${held}) AS blocking
        FROM orders o
       WHERE o.account_id IN (SELECT account_id FROM test_run_entrants WHERE run_id = ${r.id})
         AND (o.drop_id IN (${ids})
              OR (o.channel = 'GIFT' AND o.with_order_id IN (
                    SELECT p.id FROM orders p WHERE p.drop_id IN (${ids})
                       AND p.account_id IN (SELECT account_id FROM test_run_entrants WHERE run_id = ${r.id}))))
       ORDER BY o.reserved_at, o.id`.execute(tx);
    const blocking = orders.rows.filter((o) => o.blocking);
    const c = counts.rows[0]!;
    return {
      all,
      ...figures,
      planned: { accounts: Number(c.accounts), entries: Number(c.entries), orders: orders.rows.length - blocking.length },
      blockingOrders: blocking.length,
      blocking: blocking.slice(0, BLOCKING_LISTED_MAX).map((o) => ({ orderRef: orderReference(o.id), status: o.status })),
      drawn: drops.some((d) => d.drawn_at !== null),
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * Whether PURGE can be pressed on each run now (the console's button), or why not; a PAUSED run can be (its request is
   * a resume). A window or a test running elsewhere passes here: the press answers them with their words.
   */
  async purgeability(runIds: readonly string[]): Promise<Map<string, Purgeable>> {
    const out = new Map<string, Purgeable>();
    if (runIds.length === 0) return out;
    const rows = await this.db.selectFrom('test_runs').select(['id', 'drop_id', 'mode', 'status', 'purge_state', 'purge_reason', 'purge_windows']).where('id', 'in', [...runIds]).execute();
    const now = this.clock();
    for (const r of rows) {
      const why = await this.check(this.db, r, now, { global: false });
      out.set(r.id, why ? { reason: why, message: REFUSAL_WORDS[why] ?? why } : true);
    }
    return out;
  }

  /** A run's purge as the console reads it, from its row (with the requester's email), or null before any request. */
  purgeOf(row: {
    id: string;
    purge_state: TestRunPurgeState | null;
    purge_reason: string | null;
    purge_requested_at: Date | null;
    purge_requested_email: string | null;
    purged_at: Date | null;
    purge_summary: unknown;
    purge_result: unknown;
  }): TestPurgeView | null {
    if (row.purge_state === null) return null;
    const result = (row.purge_result as { deleted?: Record<string, number>; kept?: JsonObject } | null) ?? null;
    const counted = this.counted.get(row.id);
    return {
      state: row.purge_state,
      reason: row.purge_reason,
      message: row.purge_state === 'PAUSED' && row.purge_reason ? pauseWords(row.purge_reason, this.clock()) : null,
      requestedAt: row.purge_requested_at,
      requestedBy: row.purge_requested_email,
      purgedAt: row.purged_at,
      all: (row.purge_summary as { all?: unknown } | null)?.all === true,
      deleted: result?.deleted ?? null,
      kept: result?.kept ?? null,
      progress: row.purge_state !== 'DONE' && counted ? { phase: counted.phase, rows: Object.values(counted.deleted).reduce((a, b) => a + b, 0) } : null,
    };
  }

  /** This process's progress on a run (the phase of its last call and the rows deleted by table), or null. */
  progress(runId: string): { phase: string | null; deleted: Record<string, number> } | null {
    const c = this.counted.get(runId);
    return c ? { phase: c.phase, deleted: { ...c.deleted } } : null;
  }

  // ── The loop ─────────────────────────────────────────────────────────────

  /**
   * At the app's start: the tests left PURGING, or PAUSED for a window or a running test, are the loop's again; a PURGE
   * ALL of the last 24 h whose sweep did not end (read from the chain: its newest `test_run.purge_all.*` row targeting
   * an admin is a start) sweeps again. Returns what goes on.
   */
  async boot(): Promise<{ runs: string[]; sweep: boolean }> {
    const runs = (
      await this.db
        .selectFrom('test_runs')
        .select('id')
        .where((eb) => eb.or([eb('purge_state', '=', 'PURGING'), eb.and([eb('purge_state', '=', 'PAUSED'), eb('purge_reason', 'in', [...PURGE_SELF_CLEARING])])]))
        .orderBy('id')
        .execute()
    ).map((r) => r.id);
    for (const id of runs) this.takenOver.add(id);
    const since = new Date(this.clock().getTime() - 24 * 3_600_000);
    const last = await sql<{ admin_id: string; action: string; occurred_at: Date }>`
      SELECT a.id AS admin_id, l.action, l.occurred_at
        FROM admin_users a
        CROSS JOIN LATERAL (
          SELECT x.action, x.occurred_at FROM audit_logs x
           WHERE x.target_type = 'admin' AND x.target_id = a.id::text
             AND x.action IN ('test_run.purge_all.start', 'test_run.purge_all.done', 'test_run.purge_all.pause')
           ORDER BY x.id DESC LIMIT 1) l
       ORDER BY l.occurred_at DESC`.execute(this.db);
    const open = last.rows.find((r) => r.action === 'test_run.purge_all.start' && new Date(r.occurred_at).getTime() > since.getTime());
    if (open) this.sweep = { adminId: open.admin_id, startedAt: new Date(open.occurred_at).getTime(), flushed: false, deleted: {} };
    if (runs.length > 0 || open) this.log.info({ runs, sweep: !!open }, 'test purge: goes on after a restart');
    return { runs, sweep: !!open };
  }

  /** The loop's timer (every PURGE_TICK_MS, unref'd): while there is work, one call, PURGE_PAUSE_MS, the next. */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      this.draining ??= this.drain().finally(() => {
        this.draining = null;
      });
    }, PURGE_TICK_MS);
    this.timer.unref();
  }

  /** Stop the loop; the call under way ends (its transaction commits or rolls back on its own). Idempotent. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining?.catch(() => undefined);
    await this.passing?.catch(() => undefined);
  }

  private async drain(): Promise<void> {
    try {
      while (!this.stopped) {
        const r = await this.pass();
        if (r !== 'called' || this.stopped) return;
        await this.sleep(PURGE_PAUSE_MS);
      }
    } catch (e) {
      this.log.error({ err: { message: (e as Error)?.message } }, 'test purge: a pass failed');
    }
  }

  /** One step of the loop, single-flight (see the header): what it did. */
  pass(): Promise<PurgePass> {
    if (this.stopped) return Promise.resolve('idle');
    this.passing ??= this.passOnce().finally(() => {
      this.passing = null;
    });
    return this.passing;
  }

  private async passOnce(): Promise<PurgePass> {
    const now = this.clock();
    if (now.getTime() < this.retryAt) return 'waiting';
    const run = await this.db
      .selectFrom('test_runs')
      .select(['id', 'drop_id', 'mode', 'status', 'purge_state', 'purge_reason', 'purge_windows'])
      .where((eb) => eb.or([eb('purge_state', '=', 'PURGING'), eb.and([eb('purge_state', '=', 'PAUSED'), eb('purge_reason', 'in', [...PURGE_SELF_CLEARING])])]))
      .orderBy('purge_requested_at')
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();
    if (run) return this.step(run, now);
    if (this.sweep) return this.sweepStep(now);
    return 'idle';
  }

  /** One call on `run`: held in a window or while a test runs; else one batch (and DONE with the last). */
  private async step(run: RunRow, now: Date): Promise<PurgePass> {
    const hold = await this.globalHold(this.db, now);
    if (hold) {
      // PAUSED for the other hold (a window ended while a test runs, or the other way round): its reason follows.
      if (run.purge_state === 'PURGING' || run.purge_reason !== hold) await this.pause(run.id, hold, now);
      return 'paused';
    }
    if (run.purge_windows !== null && !this.flushed.has(run.id)) {
      if (!(await this.flushViews(now))) return 'waiting';
      this.flushed.add(run.id);
    }
    const counted = this.counted.get(run.id) ?? { phase: null, deleted: {} };
    let batch: PurgeBatch;
    try {
      batch = await inTransaction(this.db, async (tx) => {
        await sql.raw(`SET LOCAL statement_timeout = '${PURGE_STATEMENT_TIMEOUT}'`).execute(tx);
        const b = (await sql<{ r: PurgeBatch }>`SELECT orbes_purge_test_run_batch(${run.id}::uuid, ${this.batchRows}::int) AS r`.execute(tx)).rows[0]!.r;
        // A pause for a window or a running test ends with a call that went through.
        if (run.purge_state === 'PAUSED') {
          await tx.updateTable('test_runs').set({ purge_state: 'PURGING', purge_reason: null }).where('id', '=', run.id).where('purge_state', '=', 'PAUSED').execute();
        }
        if (b.phase === 'ACCOUNTS_DONE') {
          const deleted = add(counted.deleted, b.deleted);
          const result = { deleted, kept: b.kept, ...(this.takenOver.has(run.id) ? { countedFromRestart: true } : {}) };
          await tx
            .updateTable('test_runs')
            .set({ purge_state: 'DONE', purge_reason: null, purged_at: this.clock(), purge_result: jsonText(result as unknown as JsonObject) })
            .where('id', '=', run.id)
            .where('purge_state', 'in', ['PURGING', 'PAUSED'])
            .execute();
          await this.audit.record({ actor: PURGE_ACTOR, action: 'test_run.purge.done', targetType: 'test_run', targetId: run.id, details: result as unknown as JsonObject }, tx);
        }
        return b;
      });
    } catch (e) {
      return this.failed(run, e, now);
    }
    this.failures = 0;
    this.counted.set(run.id, { phase: batch.phase, deleted: add(counted.deleted, batch.deleted) });
    const releases = await this.releasesOf(run.drop_id);
    if (batch.deletedAccounts.length > 0) await this.forget(batch.deletedAccounts, releases);
    if (batch.phase !== 'ACCOUNTS_DONE') return 'called';
    // Done: once more, every account of the run that no longer exists.
    const gone = await this.goneAccounts(run.id);
    await this.forget(gone, releases);
    this.flushed.delete(run.id);
    this.takenOver.delete(run.id);
    this.counted.delete(run.id);
    this.log.info({ runId: run.id }, 'test purge: done');
    return 'done';
  }

  /** What a refused call does (see the header). */
  private async failed(run: RunRow, e: unknown, now: Date): Promise<PurgePass> {
    const reason = purgeRefusal(e);
    if (reason !== undefined) {
      this.failures = 0;
      if (reason === 'PURGE_DONE') return 'done';
      if (PURGE_SELF_CLEARING.includes(reason)) {
        if (run.purge_state === 'PURGING' || run.purge_reason !== reason) await this.pause(run.id, reason, now);
        return 'paused';
      }
      await this.pause(run.id, reason, now);
      return 'paused';
    }
    const code = pgError(e)?.code;
    if (code === undefined || RETRYABLE.has(code)) {
      this.failures += 1;
      this.log.warn({ runId: run.id, code: code ?? null, tries: this.failures, err: { message: (e as Error)?.message } }, 'test purge: a call failed; tried again');
      if (this.failures >= PURGE_RETRY_MAX) {
        this.failures = 0;
        await this.pause(run.id, `PURGE_STUCK_${code ?? 'ERROR'}`, now);
        return 'paused';
      }
      this.retryAt = now.getTime() + PURGE_RETRY_MS[this.failures - 1]!;
      return 'retry';
    }
    this.failures = 0;
    this.log.error({ runId: run.id, code, err: { message: (e as Error)?.message } }, 'test purge: the database refused a call; paused');
    await this.pause(run.id, `SQLSTATE_${code}`, now);
    return 'paused';
  }

  /** PAUSED with `reason`, audited `test_run.purge.pause` once (nothing when it is already paused for it). */
  private async pause(runId: string, reason: string, now: Date): Promise<void> {
    try {
      await inTransaction(this.db, async (tx) => {
        const r = await tx
          .updateTable('test_runs')
          .set({ purge_state: 'PAUSED', purge_reason: reason })
          .where('id', '=', runId)
          .where('purge_state', 'in', ['PURGING', 'PAUSED'])
          .where((eb) => eb.or([eb('purge_reason', 'is', null), eb('purge_reason', '<>', reason)]))
          .returning('id')
          .executeTakeFirst();
        if (!r) return;
        const code = /^(?:PURGE_STUCK|SQLSTATE)_([0-9A-Z]{5}|ERROR)$/.exec(reason)?.[1];
        await this.audit.record(
          { actor: PURGE_ACTOR, action: 'test_run.purge.pause', targetType: 'test_run', targetId: runId, details: { reason, ...(code ? { sqlstate: code, name: sqlstateName(code) } : {}) } },
          tx,
        );
      });
      this.log.warn({ runId, reason }, 'test purge: paused');
    } catch (e) {
      // The database is not answering: the next pass tries again.
      this.retryAt = now.getTime() + PURGE_RETRY_MS[0]!;
      this.log.error({ runId, reason, err: { message: (e as Error)?.message } }, 'test purge: the pause could not be written');
    }
  }

  /** PURGE ALL's sweep of the pool (after every run it set PURGING is done or paused for good). */
  private async sweepStep(now: Date): Promise<PurgePass> {
    const sweep = this.sweep!;
    // Past its step-up's 24 h, a sweep still held stops (audited with what held it) instead of asking for ever.
    const expired = now.getTime() - sweep.startedAt >= PURGE_ALL_SWEEP_MS;
    const hold = await this.globalHold(this.db, now);
    if (hold) return expired ? this.stopSweep(sweep, hold) : 'paused';
    if (!sweep.flushed) {
      if (!(await this.flushViews(now))) return 'waiting';
      sweep.flushed = true;
    }
    let batch: PurgeBatch;
    try {
      batch = await inTransaction(this.db, async (tx) => {
        await sql.raw(`SET LOCAL statement_timeout = '${PURGE_STATEMENT_TIMEOUT}'`).execute(tx);
        const b = (await sql<{ r: PurgeBatch }>`SELECT orbes_purge_test_pool_batch(${this.batchRows}::int) AS r`.execute(tx)).rows[0]!.r;
        if (b.phase === 'POOL_DONE') {
          await this.audit.record(
            { actor: PURGE_ACTOR, action: 'test_run.purge_all.done', targetType: 'admin', targetId: sweep.adminId, details: { deleted: add(sweep.deleted, b.deleted), kept: b.kept } },
            tx,
          );
        }
        return b;
      });
    } catch (e) {
      const reason = purgeRefusal(e);
      // Not yet: a run of it still under way, a window, a test running or not ended. The function decides again next
      // time, until the step-up's 24 h are over: then the sweep stops with that reason.
      if (reason === 'PURGE_ALL_NOT_DONE' || reason === 'PURGE_WINDOW' || reason === 'PURGE_TEST_RUNNING' || reason === 'PURGE_RUNS_NOT_ENDED') {
        if (expired) return this.stopSweep(sweep, reason, e);
        this.retryAt = now.getTime() + PURGE_TICK_MS;
        return 'waiting';
      }
      const code = pgError(e)?.code;
      if (reason === undefined && (code === undefined || RETRYABLE.has(code))) {
        this.failures += 1;
        if (this.failures < PURGE_RETRY_MAX) {
          this.retryAt = now.getTime() + PURGE_RETRY_MS[this.failures - 1]!;
          return 'retry';
        }
      }
      this.failures = 0;
      return this.stopSweep(sweep, reason ?? (code === undefined || RETRYABLE.has(code) ? `PURGE_STUCK_${code ?? 'ERROR'}` : `SQLSTATE_${code}`), e);
    }
    this.failures = 0;
    sweep.deleted = add(sweep.deleted, batch.deleted);
    if (batch.deletedAccounts.length > 0) await this.forget(batch.deletedAccounts, []);
    if (batch.phase !== 'POOL_DONE') return 'called';
    this.sweep = null;
    this.log.info({ deleted: sweep.deleted }, 'test purge: the pool sweep is done');
    return 'done';
  }

  /** The pool sweep stopped with `why`, audited `test_run.purge_all.pause` (a new PURGE ALL starts it again). */
  private async stopSweep(sweep: NonNullable<TestPurgeService['sweep']>, why: string, e?: unknown): Promise<PurgePass> {
    this.sweep = null;
    this.log.error({ reason: why, ...(e === undefined ? {} : { err: { message: (e as Error)?.message } }) }, 'test purge: the pool sweep stopped');
    try {
      await this.audit.record({ actor: PURGE_ACTOR, action: 'test_run.purge_all.pause', targetType: 'admin', targetId: sweep.adminId, details: { reason: why } });
    } catch (err) {
      this.log.error({ err: { message: (err as Error)?.message } }, 'test purge: the sweep’s stop could not be audited');
    }
    return 'paused';
  }

  /** The views' buffer written before accounts go; false (and a wait) when it could not be. */
  private async flushViews(now: Date): Promise<boolean> {
    const f = await this.tracking.flushNow();
    if (!f.failed) return true;
    this.retryAt = now.getTime() + PURGE_RETRY_MS[0]!;
    this.log.warn({ left: f.left }, 'test purge: the views could not be written; waiting before the accounts');
    return false;
  }

  /** What this process still holds of deleted accounts and entries, forgotten (see the header). */
  private async forget(accountIds: readonly string[], dropIds: readonly string[]): Promise<void> {
    this.testEntrantAccounts.invalidate();
    if (accountIds.length > 0) this.tracking.forgetAccounts(accountIds);
    for (const d of dropIds) await this.liveFrames.forget(d);
  }

  /** The release of a run and its after-room. */
  private async releasesOf(dropId: string): Promise<string[]> {
    return (await this.db.selectFrom('drops').select('id').where((eb) => eb.or([eb('id', '=', dropId), eb('parent_drop_id', '=', dropId)])).orderBy('id').execute()).map((r) => r.id);
  }

  /** The accounts the run's windows stored that no longer exist. */
  private async goneAccounts(runId: string): Promise<string[]> {
    const r = await sql<{ id: string }>`
      SELECT s.v AS id FROM test_runs r CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(r.purge_windows -> 'accounts', '[]'::jsonb)) AS s (v)
       WHERE r.id = ${runId} AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text = s.v)`.execute(this.db);
    return r.rows.map((x) => x.id);
  }
}

/** Two counts by table, added. */
function add(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>> | null | undefined): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [t, n] of Object.entries(b ?? {})) out[t] = (out[t] ?? 0) + Number(n);
  return out;
}
