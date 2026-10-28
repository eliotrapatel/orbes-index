/**
 * TEST PURGE and PLATFORM RESET on a real PostgreSQL, as the app connects to it (lot PURGE, step PURGE.13; plan §T, D3,
 * D19, M8, M12, M16, F10, F12, F19, F26, G5, G9, G11, G12, H7, H13). Opt-in: it runs in genome-ci on postgres:16 with
 * ORBES_TEST_POSTGRES_URL (a superuser able to create databases and roles) and is skipped without it.
 *
 * A throwaway database, migrated by the superuser as deploy.sh migrates, and a throwaway role made and granted EXACTLY
 * as deploy/vps/scripts/lib.sh makes and grants orbes_app (`db_ensure_app_role`, `db_grant_app_role`: its heredocs read
 * from the file and run statement by statement, `\gexec` included): LOGIN NOSUPERUSER, DML on every table, no TRUNCATE,
 * the migrations' bookkeeping read only. Every call below that stands for the app goes through REAL connections of that
 * role, by password, as the app opens them (db/connection.ts, application_name 'orbes-genome'); a second session is
 * another real connection. The app's own seeding (TEST ENTRANTS' bots, releases, a real sign-up) runs through the app's
 * services on a superuser connection, which is closed before any reset.
 *
 *  - the role: its attributes and grants; it cannot write platform_reset_gate, platform_reset_plan, purge_delete_tables
 *    or audit_purge_gaps, cannot TRUNCATE any table, cannot pass ANY guard use of orbes_reject_mutation with
 *    `SET orbes.guard_bypass` alone ('purge' or 'reset'), cannot set purge_state outside a step-up transaction, cannot
 *    write purge_windows or purge_step_up_id (A7.pg, B7.pg);
 *  - the purge end to end through the role (G11, M12): a real registered account disguised as a test entrant kept byte
 *    for byte, a run whose created_at was moved back deleting no audit row older than its test_run.start, the chain OK
 *    over its tombstones; then takePool's SELECT ... FOR UPDATE OF t (the statement itself, read from
 *    services/test-entrants.ts) in a second session against a step-10 batch on the same test_entrants rows: the batch
 *    waits, re-checks, and deletes none of the accounts the new test took;
 *  - the console-only residual risk (D3, M8, F12, F19), stated as a proven fact: code running as orbes_app forges the
 *    step-up transaction's rows (the admin's row updated, admin.step_up, platform.reset.requested, the authorization)
 *    and resets the platform with the holder's id; with any other id, without an authorization, with a stale or a used
 *    one, with a test RUNNING, and after LOCK RESET it is refused;
 *  - the reset against other sessions (H13, F26, G9): another session idle in transaction, a long SELECT under a
 *    pg_dump stand-in, an idle psql, an idle connection that names itself 'orbes-genome' as the app's own do: each
 *    refused RESET_OTHER_CONNECTIONS with nothing changed (every table's count and md5, the gate); the LIVE engine's
 *    session lock held elsewhere: RESET_LIVE_ENGINE;
 *  - a write held on skus (e): a bare one refused at once (another connection); one made as the services make it, with
 *    its audit row (the AUDIT_CHAIN lock held to its COMMIT), makes the reset wait inside its transaction and give up
 *    at its 5 s lock timeout (55P03), nothing changed. (f), the 9 Oct "lost connection before commit": while the reset
 *    waits there, the second connection terminates the reset's backend: every table's count and md5, the gate (its
 *    resets, last_reset_at and authorization) and the audit log as before, the chain OK. The wait is on the AUDIT_CHAIN
 *    lock of step 3 (§B.2 d), not on step 5's LOCK TABLE: step 4 refuses any other connection before it, so no other
 *    session can hold a table lock the reset would wait for at step 5 (H13);
 *  - (d) the chain's and the numbers' locks held by the reset until its COMMIT, in the services' own key forms (G5):
 *    a session that connects once the reset has passed its step 4, while run() (PlatformResetService, the real one) is
 *    between the function and entry 1, fails pg_try_advisory_xact_lock on every key the services take (AUDIT_CHAIN and
 *    CATEGORY_ALLOCATION one-key, INVOICE_NUMBER and PARTNER_INVOICE_NUMBER `year * 2 + kind`, SERIAL_ALLOCATION
 *    `serialLockKey(year, c)`, this UTC year and the next, LIVE_ENGINE), while the one-key form of a two-part key is
 *    free; an invoice number, a serial and an audit entry started meanwhile wait until the COMMIT (the entry then
 *    chains onto entry 1);
 *  - the bypass never leaks (H7, M16): a probe trigger (schema t13, outside the plan) sees `orbes.guard_bypass` set to
 *    'purge' inside a purge batch and to 'reset' inside the reset, for the app's session; in the same session the
 *    setting is empty right after the call returns, and after it raises (the probe raising inside it), in its
 *    transaction and after: the behaviour production's PostgreSQL 17 check does not repeat;
 *  - two resets end to end through the role (entry 1 from the genesis hash, the post-check lines OK), then LOCK RESET.
 * The role and the database are dropped after, and checked gone.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toHex } from '../../src/core/bytes.js';
import { advisoryXactLock, ADVISORY_LOCK, closeDb, createDb, inTransaction, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { isGuardViolation, pgError, purgeRefusal, resetRefusal } from '../../src/server/db/pg-errors.js';
import { RESET_PLAN } from '../../src/server/db/reset-plan.js';
import { INVOICE_KINDS, jsonText, PARTNER_INVOICE_KINDS } from '../../src/server/db/schema.js';
import { AUDIT_GENESIS_HASH, AuditService } from '../../src/server/services/audit.js';
import { serialLockKey } from '../../src/server/services/issuance.js';
import { PlatformResetService, type PlatformResetServiceDeps, type ResetResult } from '../../src/server/services/platform-reset.js';
import { testPhrase, type TestEntrantService, type TestRunSettingsInput } from '../../src/server/services/test-entrants.js';
import type { Actor } from '../../src/server/types.js';
import { createHarness, PASSWORD, type Harness } from '../api/support.js';
import { giveSizes, poolDraw } from '../support/draws.js';
import { createAccount, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';

const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
const APP = `orbes_t13_${randomBytes(4).toString('hex')}`;
const APP_PASSWORD = randomBytes(24).toString('base64url');
const DB_NAME = `orbes_t13_${randomBytes(6).toString('hex')}`;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ── lib.sh's own statements ─────────────────────────────────────────────────

/** A psql literal, as `:'var'` writes it. */
const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * The SQL of one of lib.sh's psql heredocs (`db_ensure_app_role`, `db_grant_app_role`), read from the file, its `\set`
 * variables given: each statement as psql runs it (`gexec`: a query whose every row is a statement to run).
 */
function libShStatements(fn: string, vars: Record<string, string>): { text: string; gexec: boolean }[] {
  const src = source('../../../deploy/vps/scripts/lib.sh');
  const start = src.indexOf(`\n${fn}() {`);
  expect(start, fn).toBeGreaterThan(0);
  const open = src.indexOf('<<SQL\n', start);
  const close = src.indexOf('\nSQL\n', open);
  expect(open, fn).toBeGreaterThan(start);
  const lines = src.slice(open + 6, close).split('\n');
  const out: { text: string; gexec: boolean }[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (/^\s*--/.test(line) || /^\\\\set /.test(line) || line.trim() === '') continue;
    const gexec = /\\\\gexec\s*$/.test(line);
    buf.push(line.replace(/\\\\gexec\s*$/, ''));
    if (gexec || /;\s*$/.test(line)) {
      let text = buf.join('\n').trim().replace(/;\s*$/, '');
      const named = [...text.matchAll(/:'([a-z]+)'/g)].map((m) => m[1]!);
      expect(named.filter((v) => !(v in vars)), `${fn}: every variable given`).toEqual([]);
      expect(text, `${fn}: no shell variable left`).not.toMatch(/\$[a-z]/);
      for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`:'${k}'`, literal(v));
      out.push({ text, gexec });
      buf = [];
    }
  }
  expect(buf.join('').trim(), `${fn}: no statement left unterminated`).toBe('');
  return out;
}

async function runLibSh(db: Db, fn: string, vars: Record<string, string>): Promise<number> {
  let n = 0;
  for (const s of libShStatements(fn, vars)) {
    const rows = (await sql.raw<Record<string, unknown>>(s.text).execute(db)).rows;
    if (!s.gexec) {
      n++;
      continue;
    }
    for (const row of rows) {
      await sql.raw(String(Object.values(row)[0])).execute(db);
      n++;
    }
  }
  return n;
}

// ── small tools ─────────────────────────────────────────────────────────────

const q = async <T,>(db: Db, s: string): Promise<T[]> => (await sql.raw<T>(s).execute(db)).rows;
const one = async <T,>(db: Db, s: string): Promise<T> => (await q<T>(db, s))[0] as T;
const count = async (db: Db, from: string): Promise<number> => Number((await one<{ n: string | number }>(db, `SELECT count(*) AS n FROM ${from}`)).n);
const pidOf = async (db: Db): Promise<number> => Number((await one<{ pid: number }>(db, 'SELECT pg_backend_pid() AS pid')).pid);
const bypassNow = async (db: Db): Promise<string> => (await one<{ v: string | null }>(db, `SELECT current_setting('orbes.guard_bypass', true) AS v`)).v ?? '';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
}
function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

/** `fn` in a transaction on `db`, always rolled back; answers what it returned. */
async function rolledBack<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  try {
    await db.transaction().execute(async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error('unreachable');
}

/** `p` refused, and `check` says it is the refusal wanted; the error. */
async function refusedWith(p: Promise<unknown>, check: (e: unknown) => boolean, label: string): Promise<unknown> {
  let error: unknown = null;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  if (error === null) throw new Error(`${label}: expected a refusal, it went through`);
  if (!check(error)) throw new Error(`${label}: got ${pgError(error)?.code} « ${(error as Error)?.message} » ${(error as { detail?: string }).detail ?? ''}`);
  return error;
}
const resetRefused = (p: Promise<unknown>, reason: string, label = reason) => refusedWith(p, (e) => resetRefusal(e) === reason, label);
const purgeRefused = (p: Promise<unknown>, reason: string, label = reason) => refusedWith(p, (e) => purgeRefusal(e) === reason, label);
const guarded = (p: Promise<unknown>, message: string, label = message) => refusedWith(p, (e) => isGuardViolation(e) && (e as Error).message === message, label);
const denied = (p: Promise<unknown>, label: string) => refusedWith(p, (e) => pgError(e)?.code === '42501', label);

/** Every table of public: its rows' count and md5 (the 9 Oct fingerprint), the gate included. */
async function fingerprint(db: Db): Promise<Record<string, string>> {
  const tables = (await q<{ t: string }>(db, `SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((r) => r.t);
  expect(tables.length).toBe(Object.keys(RESET_PLAN).length);
  const rows = await q<{ t: string; v: string }>(
    db,
    tables
      .map((t) => `SELECT '${t}'::text AS t, count(*)::text || ' ' || coalesce(md5(string_agg(x::text, chr(10) ORDER BY x::text)), '-') AS v FROM public."${t}" x`)
      .join('\nUNION ALL\n'),
  );
  return Object.fromEntries(rows.map((r) => [r.t, r.v]));
}

/** Polls `test` every 25 ms until it holds (or fails after `ms`). */
async function waitFor<T>(label: string, test: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await test();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A Kysely plugin that holds the result of the first raw query naming `fragment` until released: run() paused between the function and entry 1. */
class PauseAfter implements KyselyPlugin {
  readonly reached = deferred();
  readonly release = deferred();
  private readonly ids = new WeakSet<object>();
  constructor(private readonly fragment: string) {}
  transformQuery(args: PluginTransformQueryArgs): PluginTransformQueryArgs['node'] {
    const node = args.node as { kind: string; sqlFragments?: readonly string[] };
    if (node.kind === 'RawNode' && node.sqlFragments?.join('?').includes(this.fragment)) this.ids.add(args.queryId as object);
    return args.node;
  }
  async transformResult(args: PluginTransformResultArgs): Promise<PluginTransformResultArgs['result']> {
    if (this.ids.has(args.queryId as object)) {
      this.reached.resolve();
      await this.release.promise;
    }
    return args.result;
  }
}

// ── the purge, as TestPurgeService writes it (PURGE.5), here through the app's role ──

interface Batch {
  phase: string;
  left: number;
  deleted: Record<string, number>;
  deletedAccounts: string[];
  kept: { orders?: number; entries?: number; accounts: number };
}
const batch = async (db: Db, runId: string, max = 500): Promise<Batch> => (await sql<{ r: Batch }>`SELECT orbes_purge_test_run_batch(${runId}::uuid, ${max}::int) AS r`.execute(db)).rows[0]!.r;

/** What a forbidden window answers: nothing (CI runs at any hour; the windows have their own tests). */
const WINDOWS_OPEN = `CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`;

/**
 * The probe (schema t13: outside the reset's plan, which reads public only): a statement trigger after DELETE that
 * notes `orbes.guard_bypass` as the deleting statement sees it, and the session's login role; or raises with it when
 * the session asks (`SET LOCAL t13.probe = 'raise'`), from inside whatever function deletes.
 */
const PROBE = [
  `CREATE SCHEMA t13`,
  `CREATE TABLE t13.seen (at timestamptz NOT NULL DEFAULT clock_timestamp(), tbl text NOT NULL, op text NOT NULL, bypass text NOT NULL, who text NOT NULL)`,
  `CREATE FUNCTION t13.probe() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
   BEGIN
     IF current_setting('t13.probe', true) = 'raise' THEN
       RAISE EXCEPTION 'T13_PROBE % saw bypass=%', TG_TABLE_NAME, coalesce(current_setting('orbes.guard_bypass', true), '');
     END IF;
     INSERT INTO t13.seen (tbl, op, bypass, who) VALUES (TG_TABLE_NAME, TG_OP, coalesce(current_setting('orbes.guard_bypass', true), ''), session_user::text);
     RETURN NULL;
   END $$`,
  `CREATE TRIGGER t13_probe AFTER DELETE ON public.test_run_entrants FOR EACH STATEMENT EXECUTE FUNCTION t13.probe()`,
  `CREATE TRIGGER t13_probe AFTER DELETE ON public.drops FOR EACH STATEMENT EXECUTE FUNCTION t13.probe()`,
];

/**
 * The release-level system rows a purge never deletes (plan §A.3, A3.never): they may name a deleted account by its id
 * (no personal data). As test/services/test-purge-function.test.ts reads them.
 */
const SYSTEM_ACTIONS = /^(drop\.live\.(batch|queue|end|after_room\..+)|vault\.give|test_run\..+)$/;

describe.skipIf(!pgUrl)('TEST PURGE and PLATFORM RESET through the app\'s role, two real connections (PostgreSQL)', () => {
  let admin: Db;
  let owner: Db | null = null;
  let main: Db;
  let ownerUrl = '';
  let appUrl = '';
  let h: Harness | null = null;
  let f: LiveFixture;
  let tests: TestEntrantService;
  let holder = '';
  let other = '';
  let holderActor: Actor;
  const cleanups: (() => Promise<unknown>)[] = [];
  // Run A: the purge end to end (G11); its release, the real sign-up disguised in it, the collector before it.
  const A = { run: '', drop: '', bots: [] as string[], disguised: '', real: '', early: 0, fromId: 0 };

  // ── connections ──

  /** A raw session as the app's role (`application_name` its own), error events swallowed (a terminated one emits). */
  async function rawSession(applicationName: string): Promise<pg.Client & { pid: number }> {
    const c = new pg.Client({ connectionString: appUrl, application_name: applicationName });
    c.on('error', () => undefined);
    await c.connect();
    cleanups.push(() => c.end().catch(() => undefined));
    const pid = Number((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    return Object.assign(c, { pid });
  }

  /** A Kysely database of the app's role, as the app opens it (createDb: 'orbes-genome'), closed by the cleanups. */
  function appDb(poolMax = 1): Db {
    const db = createDb(appUrl, { poolMax });
    cleanups.push(() => closeDb(db).catch(() => undefined));
    return db;
  }

  /** Every client backend of the throwaway database (read from the server's own database). */
  const backends = async () =>
    (
      await sql<{ pid: number; state: string | null; app: string; wait: string | null; event: string | null; query: string; who: string }>`
        SELECT pid, state, application_name AS app, wait_event_type AS wait, wait_event AS event, query, usename::text AS who
          FROM pg_stat_activity WHERE datname = ${DB_NAME} AND backend_type = 'client backend' ORDER BY pid`.execute(admin)
    ).rows.map((b) => ({ ...b, pid: Number(b.pid), query: b.query ?? '' }));

  /** Nobody connected to the throwaway database but `main` (closed pools leave pg_stat_activity a moment later). */
  async function onlyMain(): Promise<number> {
    const me = await pidOf(main);
    await waitFor('the other connections gone', async () => (await backends()).every((b) => b.pid === me));
    return me;
  }

  /** The superuser for one thing (a test's own fixture), its connection closed after. */
  async function asOwner<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const o = createDb(ownerUrl, { poolMax: 1 });
    try {
      return await fn(o);
    } finally {
      await closeDb(o);
    }
  }

  // ── the reset, as code running as orbes_app can drive it ──

  /**
   * The step-up's own writes, forged by code running as orbes_app (the residual risk of console-only, D3, M8): what
   * AuthService.consumeAdminStepUp writes, the admin's row updated and `admin.step_up` audited, with no code and no
   * password checked.
   */
  const forgedAuth = {
    async verifyAdminStepUp(input: { adminId: string; purpose: string }) {
      return { adminId: input.adminId, purpose: input.purpose };
    },
    async consumeAdminStepUp(v: { adminId: string; purpose: string }, tx: Db) {
      await tx.updateTable('admin_users').set({ failed_logins: 0, updated_at: new Date() }).where('id', '=', v.adminId).execute();
      await new AuditService({ db: tx }).record({ actor: { type: 'admin', id: v.adminId }, action: 'admin.step_up', targetType: 'admin', targetId: v.adminId, details: { purpose: v.purpose } }, tx);
    },
  } as unknown as PlatformResetServiceDeps['auth'];

  /** PlatformResetService on the app's role: its main database `on` (never the connection run() is given). */
  const service = (on: Db = main) => new PlatformResetService({ db: on, audit: new AuditService({ db: on }), auth: forgedAuth });

  /** The page read, then RESET PLATFORM pressed through the service with the forged step-up: the authorization written. */
  async function forgeReset(as = holder): Promise<{ seen: number; until: string | null }> {
    const svc = service();
    const p = await svc.preview(as);
    await svc.request(
      { phrase: 'RESET PLATFORM', password: 'not checked', totp: '000000', collectorsSeen: p.collectorsSeen, collectorsSeenUntil: p.collectorsSeenUntil },
      { actor: { type: 'admin', id: as }, token: 'not checked' },
    );
    const g = await one<{ by: string | null; purpose: string | null }>(main, `SELECT authorized_by AS by, authorized_purpose AS purpose FROM platform_reset_gate`);
    expect(g).toEqual({ by: as, purpose: 'platform.reset' });
    return { seen: p.collectorsSeen, until: p.collectorsSeenUntil };
  }

  /** orbes_platform_reset called on `db` in its own transaction (rolled back by any refusal). */
  const resetCall = (db: Db, who: string, s: { seen: number; until: string | null }) =>
    db.transaction().execute(async (tx) => (await sql<{ r: ResetResult }>`SELECT orbes_platform_reset(${who}::uuid, ${s.seen}::int, ${s.until}::timestamptz) AS r`.execute(tx)).rows[0]!.r);

  const gate = () => one<Record<string, unknown>>(main, `SELECT * FROM platform_reset_gate`);

  /** `p` refused with `reason`, every table's count and md5 (the gate's included) as they were. */
  async function resetRefusedAsWas(p: () => Promise<unknown>, reason: string, label = reason): Promise<unknown> {
    const before = await fingerprint(main);
    const e = await resetRefused(p(), reason, label);
    expect(await fingerprint(main), label).toEqual(before);
    return e;
  }

  // ── seeding with the app's services (a superuser connection; TestEntrantService's bots through the app) ──

  const world = () => ({ h: h!, f, tests });
  const press = (dropId: string, tiers: Partial<TestRunSettingsInput['tiers']>) => ({
    phrase: testPhrase(dropId),
    tiers: { none: 0, titane: 0, platine: 0, palladium: 0, ...tiers },
    arrival: { mode: 'all' as const, interestPct: 0 },
  });
  async function drive(): Promise<void> {
    for (let pass = 0; pass < 2; pass++) {
      await tests.tick();
      await tests.settle();
    }
  }
  async function openDraw(title: string): Promise<string> {
    const now = h!.clock.now().getTime();
    return (await poolDraw(h!.ctx.services.drops, owner!, { modelId: f.modelId, title, quantity: 2, opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR), earlyAccessHours: 0 }, f.admin)).id;
  }
  const accountsOf = async (db: Db, runId: string) => (await db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', runId).orderBy('account_id').execute()).map((r) => r.account_id);

  /** The purge's request through `on` (the app's role): its step-up's transaction, PURGING, test_run.purge.start. */
  function requestPurge(on: Db, runId: string, o: { sendStepUpId?: number; sendWindows?: object } = {}): Promise<number> {
    return inTransaction(on, async (tx) => {
      await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', holder).execute();
      const stepUp = await new AuditService({ db: tx }).record({ actor: holderActor, action: 'admin.step_up', targetType: 'admin', targetId: holder, details: { purpose: `test_run.purge:${runId}` } }, tx);
      await tx
        .updateTable('test_runs')
        .set({
          purge_state: 'PURGING',
          purge_requested_at: new Date(),
          purge_requested_by: holder,
          purge_summary: jsonText({ all: false }),
          ...(o.sendStepUpId !== undefined ? { purge_step_up_id: o.sendStepUpId } : {}),
          ...(o.sendWindows !== undefined ? { purge_windows: jsonText(o.sendWindows) } : {}),
        })
        .where('id', '=', runId)
        .execute();
      await new AuditService({ db: tx }).record({ actor: holderActor, action: 'test_run.purge.start', targetType: 'test_run', targetId: runId, details: {} }, tx);
      return stepUp.id;
    });
  }

  /** One batch in its own transaction on `on`, the bypass checked empty in that transaction right after it returned. */
  async function batchChecked(on: Db, runId: string): Promise<Batch> {
    return on.transaction().execute(async (tx) => {
      const r = await batch(tx, runId);
      expect(await bypassNow(tx), 'the bypass after a batch returned, in its transaction').toBe('');
      expect(await one(tx, `SELECT current_user::text AS c, session_user::text AS s`)).toEqual({ c: APP, s: APP });
      return r;
    });
  }

  /** DONE as the loop sets it. */
  const purgeDone = (on: Db, runId: string, deleted: Record<string, number>, kept: Batch['kept']) =>
    inTransaction(on, async (tx) => {
      await tx.updateTable('test_runs').set({ purge_state: 'DONE', purged_at: new Date(), purge_result: jsonText({ deleted, kept }) }).where('id', '=', runId).execute();
      await new AuditService({ db: tx }).record({ actor: holderActor, action: 'test_run.purge.done', targetType: 'test_run', targetId: runId, details: { deleted, kept } }, tx);
    });

  /** Every row of public whose text names one of `ids`, by table (`except` left out). */
  async function rowsNaming(db: Db, ids: readonly string[], except: readonly string[] = []): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    if (ids.length === 0) return out;
    const re = ids.map((i) => i.toLowerCase()).join('|');
    for (const { t } of await q<{ t: string }>(db, `SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%' ORDER BY 1`)) {
      if (except.includes(t)) continue;
      const rows = (await q<{ r: string }>(db, `SELECT x::text AS r FROM public."${t}" x WHERE x::text ~ '${re}' ORDER BY 1`)).map((r) => r.r);
      if (rows.length) out[t] = rows;
    }
    return out;
  }

  beforeAll(async () => {
    admin = createDb(pgUrl!);
    await sql`CREATE DATABASE ${sql.id(DB_NAME)}`.execute(admin);
    const u = new URL(pgUrl!);
    u.pathname = `/${DB_NAME}`;
    ownerUrl = u.toString();
    const superuser = decodeURIComponent(u.username);
    owner = createDb(ownerUrl, { poolMax: 4 });
    await migrateToLatest(owner);
    // The app's role, made and granted by lib.sh's own statements (after the migrations, as deploy.sh runs them).
    expect(await runLibSh(owner, 'db_ensure_app_role', { app: APP, pw: APP_PASSWORD })).toBeGreaterThanOrEqual(3);
    expect(await runLibSh(owner, 'db_grant_app_role', { app: APP, owner: superuser, db: DB_NAME })).toBeGreaterThanOrEqual(8);
    const a = new URL(ownerUrl);
    a.username = APP;
    a.password = APP_PASSWORD;
    appUrl = a.toString();
    for (const s of [WINDOWS_OPEN, ...PROBE]) await sql.raw(s).execute(owner);

    // The app on the superuser's connection, to seed through its own services.
    h = await createHarness({ context: { db: owner }, app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    f = await liveFixtureOn(h.ctx, h.clock);
    tests = h.app.testEntrants;
    tests.useTimers(false);
    tests.sleep = async (ms) => {
      h!.clock.advance(ms);
    };
    // The holder: the fixture's ADMIN with a second factor (its sealed value never read), named in the gate; another ADMIN.
    holder = f.admin.id;
    holderActor = { type: 'admin', id: holder };
    await sql`UPDATE admin_users SET totp_secret_enc = 'sealed-holder' WHERE id = ${holder}`.execute(owner);
    await sql`UPDATE platform_reset_gate SET holder_admin_id = ${holder}`.execute(owner);
    other = (
      await owner
        .insertInto('admin_users')
        .values({ email: `other-${randomUUID()}@orbes.test`, email_normalized: `other-${randomUUID()}@orbes.test`, password_hash: 'scrypt$x', role: 'ADMIN', totp_secret_enc: 'sealed-other' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Run A: a draw of the test, undrawn and cancelled; before the test, an audit row on its release and a real
    // collector's entry; in it, a real sign-up (AuthService, its account.register row) disguised afterwards as a test
    // entrant; its created_at then moved back a day (G11).
    const w = world();
    A.drop = await openDraw('T13 · THE PURGE');
    A.early = (await w.h.ctx.audit.record({ actor: f.admin, action: 'drop.live.interest.withdraw', targetType: 'drop', targetId: A.drop, details: { reason: 'test_ended' } })).id;
    const real = await createAccount(owner);
    A.real = real.id;
    await w.h.ctx.services.drops.enter(real.id, A.drop, real.actor);
    w.h.clock.advance(MINUTE);
    const started = await tests.start(A.drop, press(A.drop, { titane: 5 }), f.admin);
    A.run = started.id;
    await drive();
    A.bots = await accountsOf(owner, A.run);
    expect(A.bots).toHaveLength(5);
    const registered = await w.h.ctx.services.auth.registerAccount({ email: `real-${randomUUID().slice(0, 8)}@example.com`, password: PASSWORD, firstName: 'Léa', lastName: 'Martin', country: 'FR' });
    A.disguised = registered.account.id;
    await w.h.ctx.services.drops.enter(A.disguised, A.drop, { type: 'account', id: A.disguised });
    expect((await tests.end(A.run, testPhrase(A.drop, true), f.admin)).status).toBe('ENDED');
    await w.h.ctx.services.drops.cancel(A.drop, f.admin);
    w.h.clock.advance(MINUTE);
    await owner.updateTable('test_runs').set({ created_at: new Date(Date.now() - 24 * HOUR) }).where('id', '=', A.run).execute();
    const n = 9000 + Math.floor(Math.random() * 900);
    await owner.insertInto('test_entrants').values({ account_id: A.disguised }).execute();
    await owner.insertInto('test_run_entrants').values({ run_id: A.run, account_id: A.disguised, network: '100.64.250.0/24', plan: jsonText({}) }).execute();
    await owner.updateTable('accounts').set({ email: `test-${n}@orbes.test`, email_normalized: `test-${n}@orbes.test`, password_hash: '!test-entrant: never signs in' }).where('id', '=', A.disguised).execute();
    A.fromId = Number((await owner.selectFrom('audit_logs').select('id').where('action', '=', 'test_run.start').where('target_id', '=', A.run).executeTakeFirstOrThrow()).id);
    expect(A.early).toBeLessThan(A.fromId);

    // One offered model SKU for (e) and (f) to hold a write on: poolDraw takes away the SKUs it made, so the fixture's
    // model holds none; a model of its own, of one size, whose SKU stays (the reset keeps skus).
    const sized = await createModel(owner, 'T13 SIZES');
    await giveSizes(owner, sized);
    expect(await count(owner, `skus WHERE model_id = '${sized}' AND set_aside_at IS NULL`)).toBe(1);

    main = appDb(1);
  }, 300_000);

  afterAll(async () => {
    // Each cleanup at most 10 s (a test that failed half-way may leave a session waiting).
    for (const c of cleanups.reverse()) await Promise.race([c().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    await h?.close().catch(() => undefined);
    if (owner) await closeDb(owner).catch(() => undefined);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(DB_NAME)} WITH (FORCE)`.execute(admin);
      await sql.raw(`DROP ROLE IF EXISTS ${APP}`).execute(admin);
      // The role and the database are gone.
      expect(await count(admin, `pg_database WHERE datname = '${DB_NAME}'`)).toBe(0);
      expect(await count(admin, `pg_roles WHERE rolname = '${APP}'`)).toBe(0);
      await closeDb(admin);
    }
  }, 120_000);

  it('the app\'s role as lib.sh makes it: LOGIN NOSUPERUSER, DML on every table, never TRUNCATE, the migrations\' bookkeeping read only; the app connects as it, by password', async () => {
    expect(await one(main, `SELECT current_user::text AS c, session_user::text AS s, current_setting('application_name') AS app`)).toEqual({ c: APP, s: APP, app: 'orbes-genome' });
    expect(await one(main, `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname = '${APP}'`)).toEqual({
      rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: true, rolcanlogin: true, rolconnlimit: 30,
    });
    const privileges = await q<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean; tr: boolean }>(
      main,
      `SELECT tablename::text AS t, has_table_privilege(current_user, format('public.%I', tablename), 'SELECT') AS s,
              has_table_privilege(current_user, format('public.%I', tablename), 'INSERT') AS i,
              has_table_privilege(current_user, format('public.%I', tablename), 'UPDATE') AS u,
              has_table_privilege(current_user, format('public.%I', tablename), 'DELETE') AS d,
              has_table_privilege(current_user, format('public.%I', tablename), 'TRUNCATE') AS tr
         FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    );
    expect(privileges).toHaveLength(Object.keys(RESET_PLAN).length);
    for (const p of privileges) {
      const bookkeeping = p.t === 'kysely_migration' || p.t === 'kysely_migration_lock';
      expect(p, p.t).toEqual({ t: p.t, s: true, i: !bookkeeping, u: !bookkeeping, d: !bookkeeping, tr: false });
    }
    expect(await one(main, `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS c, has_database_privilege(current_user, current_database(), 'CREATE') AS d`)).toEqual({ c: false, d: false });
    // The definer functions reach it; the numbering locks' helper does not (revoked from PUBLIC by 0067).
    await denied(sql`SELECT * FROM orbes_platform_reset_numbering_locks(2026)`.execute(main), 'the numbering locks\' helper');
    expect(await one(main, `SELECT orbes_platform_reset_precheck('${holder}') AS r`)).toEqual({ r: null });
  });

  it('it cannot write the gate, the reset\'s plan, the purge\'s list or a tombstone, nor TRUNCATE any table, nor pass any guard use of orbes_reject_mutation with SET orbes.guard_bypass alone (A7.pg, B7.pg)', async () => {
    const asApp = (stmt: string, setting = '') =>
      rolledBack(main, async (tx) => {
        if (setting) await sql`SELECT set_config('orbes.guard_bypass', ${setting}, true)`.execute(tx);
        return (await sql.raw(stmt).execute(tx)).rows;
      });
    const words = {
      gate: 'written by the reset functions only',
      plan: "the reset's plan is written by the migrations only",
      list: "the purge's list is written by the migrations only",
    };
    for (const setting of ['', 'purge', 'reset']) {
      const s = `with '${setting}'`;
      await guarded(asApp(`INSERT INTO platform_reset_gate (id) VALUES (1)`, setting), `INSERT on platform_reset_gate is not allowed (${words.gate})`, s);
      await guarded(asApp(`UPDATE platform_reset_gate SET resets = resets + 1, last_reset_at = now(), last_reset_by = '${holder}', last_reset_details = '{}'`, setting), `UPDATE on platform_reset_gate is not allowed (${words.gate})`, s);
      await guarded(asApp(`UPDATE platform_reset_gate SET authorized_by = '${holder}', authorized_at = now(), authorized_purpose = 'platform.reset'`, setting), `UPDATE on platform_reset_gate is not allowed (${words.gate})`, s);
      await guarded(asApp(`UPDATE platform_reset_gate SET holder_admin_id = '${other}'`, setting), `UPDATE on platform_reset_gate is not allowed (${words.gate})`, s);
      await guarded(asApp(`DELETE FROM platform_reset_gate`, setting), `DELETE on platform_reset_gate is not allowed (${words.gate})`, s);
      await guarded(asApp(`INSERT INTO platform_reset_plan (tbl, kind) VALUES ('t13_table', 'KEEP')`, setting), `INSERT on platform_reset_plan is not allowed (${words.plan})`, s);
      await guarded(asApp(`UPDATE platform_reset_plan SET kind = 'KEEP' WHERE tbl = 'accounts'`, setting), `UPDATE on platform_reset_plan is not allowed (${words.plan})`, s);
      await guarded(asApp(`DELETE FROM platform_reset_plan WHERE tbl = 'accounts'`, setting), `DELETE on platform_reset_plan is not allowed (${words.plan})`, s);
      await guarded(asApp(`INSERT INTO purge_delete_tables (tbl, col, ord) VALUES ('accounts', 'id', 999)`, setting), `INSERT on purge_delete_tables is not allowed (${words.list})`, s);
      await guarded(asApp(`UPDATE purge_delete_tables SET ord = ord + 1000`, setting), `UPDATE on purge_delete_tables is not allowed (${words.list})`, s);
      await guarded(asApp(`DELETE FROM purge_delete_tables`, setting), `DELETE on purge_delete_tables is not allowed (${words.list})`, s);
      await guarded(
        asApp(`INSERT INTO audit_purge_gaps (id, prev_hash, hash) VALUES (1, sha256('t13 prev'::bytea), sha256('t13 hash'::bytea))`, setting),
        'INSERT on audit_purge_gaps is not allowed (audit_purge_gaps is written by the purge only)',
        s,
      );
    }
    expect(await gate()).toMatchObject({ holder_admin_id: holder, resets: 0, authorized_by: null, launched_at: null });

    // TRUNCATE: no table, with or without the setting (lib.sh never grants it).
    const tables = (await q<{ t: string }>(main, `SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((r) => r.t);
    await rolledBack(main, async (tx) => {
      for (const t of tables) {
        for (const setting of ['', 'reset']) {
          await sql`SAVEPOINT t13_truncate`.execute(tx);
          await sql`SELECT set_config('orbes.guard_bypass', ${setting}, true)`.execute(tx);
          await denied(sql.raw(`TRUNCATE public."${t}"`).execute(tx), `TRUNCATE ${t} with '${setting}'`);
          await sql`ROLLBACK TO SAVEPOINT t13_truncate`.execute(tx);
        }
      }
    });

    // Every guard use of orbes_reject_mutation, fired as the app's role on a copy of its table holding one row (the
    // superuser puts the table aside in a transaction rolled back, makes the copy and its guard again from the guard's
    // own definition, grants the app's DML on it, then becomes the app's role): every event refused, without the
    // setting, with 'purge' and with 'reset', OR001 with its own words; a TRUNCATE by privilege. A WHEN qualifier only
    // says when the guard is asked: left out, as in migrations-0067.
    const uses = await q<{ tbl: string; tgname: string; tgtype: number; words: string | null; cols: string | null; def: string; qual: boolean }>(
      owner!,
      `SELECT c.relname AS tbl, t.tgname, t.tgtype,
              CASE WHEN t.tgnargs = 0 THEN NULL ELSE convert_from(substring(t.tgargs FROM 1 FOR position('\\x00'::bytea IN t.tgargs) - 1), 'UTF8') END AS words,
              (SELECT string_agg(a.attname, ',') FROM unnest(t.tgattr) AS k (n) JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.n) AS cols,
              pg_get_triggerdef(t.oid) AS def, t.tgqual IS NOT NULL AS qual
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND t.tgfoid = 'orbes_reject_mutation'::regproc AND n.nspname = 'public'
        ORDER BY 1, 2`,
    );
    expect(uses).toHaveLength(60);
    const tally: Record<string, number> = {};
    for (const [i, u] of uses.entries()) {
      const message = (event: string) => `${event} on ${u.tbl} is not allowed (${u.words ?? 'immutable'})`;
      const events = [...(u.tgtype & 4 ? ['INSERT'] : []), ...(u.tgtype & 8 ? ['DELETE'] : []), ...(u.tgtype & 16 ? ['UPDATE'] : []), ...(u.tgtype & 32 ? ['TRUNCATE'] : [])];
      expect(events.length, u.tgname).toBeGreaterThan(0);
      const def = u.qual ? u.def.replace(/ WHEN \(.*?\) EXECUTE FUNCTION /, ' EXECUTE FUNCTION ') : u.def;
      expect(def, u.tgname).not.toMatch(/ WHEN /);
      await rolledBack(owner!, async (tx) => {
        const exec = (s: string) => sql.raw(s).execute(tx);
        await exec(`ALTER TABLE public.${u.tbl} RENAME TO t13_aside_${i}`);
        await exec(`CREATE TABLE public.${u.tbl} AS SELECT * FROM public.t13_aside_${i} WITH NO DATA`);
        await exec(`INSERT INTO public.${u.tbl} DEFAULT VALUES`);
        await exec(def);
        await exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${u.tbl} TO ${APP}`);
        const first = (await sql<{ c: string }>`SELECT attname AS c FROM pg_attribute WHERE attrelid = ${`public.${u.tbl}`}::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum LIMIT 1`.execute(tx)).rows[0]!.c;
        const col = u.cols?.split(',')[0] ?? first;
        await exec(`SET LOCAL ROLE ${APP}`);
        expect(await one(tx, `SELECT current_user::text AS c`)).toEqual({ c: APP });
        for (const event of events) {
          const statement =
            event === 'INSERT' ? `INSERT INTO public.${u.tbl} DEFAULT VALUES` : event === 'DELETE' ? `DELETE FROM public.${u.tbl}` : event === 'UPDATE' ? `UPDATE public.${u.tbl} SET "${col}" = "${col}"` : `TRUNCATE public.${u.tbl}`;
          for (const setting of ['', 'purge', 'reset']) {
            const label = `${u.tgname} ${event} with '${setting}'`;
            await sql`SAVEPOINT t13_use`.execute(tx);
            await sql`SELECT set_config('orbes.guard_bypass', ${setting}, true)`.execute(tx);
            if (event === 'TRUNCATE') await denied(exec(statement), label);
            else await guarded(exec(statement), message(event), label);
            await sql`ROLLBACK TO SAVEPOINT t13_use`.execute(tx);
            tally[event] = (tally[event] ?? 0) + 1;
          }
        }
      });
    }
    // No use guards an INSERT (a guarded table refuses changes, never new rows); each of the others asked 3 times a use.
    expect(Object.keys(tally).sort()).toEqual(['DELETE', 'TRUNCATE', 'UPDATE']);

    // And on the real rows, through the app's own connection: a DELETE of one row of every table a guard use of
    // orbes_reject_mutation keeps, that holds a row now (the purge's five and the reset's wiped and partly kept ones the
    // superuser's way would let through), refused with either setting.
    const real = uses.filter((u) => !u.qual && (u.tgtype & 8) !== 0 && (u.tgtype & 1) !== 0);
    const fired: string[] = [];
    for (const t of [...new Set(real.map((u) => u.tbl))]) {
      if ((await count(main, `public."${t}"`)) === 0) continue;
      for (const setting of ['purge', 'reset']) {
        await refusedWith(asApp(`DELETE FROM public."${t}" WHERE ctid = (SELECT ctid FROM public."${t}" LIMIT 1)`, setting), isGuardViolation, `a row of ${t} with '${setting}'`);
      }
      fired.push(t);
    }
    expect(fired).toContain('audit_logs');
    // The setting never outlives its transaction.
    expect(await bypassNow(main)).toBe('');
  }, 240_000);

  it('it cannot set purge_state outside a step-up transaction, nor write purge_windows or purge_step_up_id (G11, F19)', async () => {
    const asked = { purge_state: 'PURGING' as const, purge_requested_at: new Date(), purge_requested_by: holder, purge_summary: jsonText({ all: false }) };
    // Outside any step-up: refused.
    await purgeRefused(main.updateTable('test_runs').set(asked).where('id', '=', A.run).execute(), 'PURGE_NOT_AUTHORIZED', 'no step-up');
    // The admin's row updated, no step-up row.
    await purgeRefused(
      inTransaction(main, async (tx) => {
        await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', holder).execute();
        await tx.updateTable('test_runs').set(asked).where('id', '=', A.run).execute();
      }),
      'PURGE_NOT_AUTHORIZED',
      'the admin\'s row only',
    );
    // A step-up of another purpose, then one of an earlier transaction.
    await purgeRefused(
      inTransaction(main, async (tx) => {
        await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', holder).execute();
        await new AuditService({ db: tx }).record({ actor: holderActor, action: 'admin.step_up', targetType: 'admin', targetId: holder, details: { purpose: 'platform.reset' } }, tx);
        await tx.updateTable('test_runs').set(asked).where('id', '=', A.run).execute();
      }),
      'PURGE_NOT_AUTHORIZED',
      'a step-up of another purpose',
    );
    await inTransaction(main, async (tx) => {
      await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', holder).execute();
      await new AuditService({ db: tx }).record({ actor: holderActor, action: 'admin.step_up', targetType: 'admin', targetId: holder, details: { purpose: `test_run.purge:${A.run}` } }, tx);
    });
    await purgeRefused(
      inTransaction(main, async (tx) => {
        await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', holder).execute();
        await tx.updateTable('test_runs').set(asked).where('id', '=', A.run).execute();
      }),
      'PURGE_NOT_AUTHORIZED',
      'a step-up of an earlier transaction',
    );
    // In its step-up's transaction, windows sent with the request: refused.
    await purgeRefused(requestPurge(main, A.run, { sendWindows: { fromId: 1, toId: 2, from: new Date(0).toISOString(), to: new Date().toISOString(), accounts: [] } }), 'PURGE_WINDOWS_LOCKED', 'windows with the request');
    expect(await one(main, `SELECT purge_state, purge_step_up_id, purge_windows FROM test_runs WHERE id = '${A.run}'`)).toEqual({ purge_state: null, purge_step_up_id: null, purge_windows: null });
    // The request as the console makes it, a step-up id of the app's own choosing sent: the database's is stored.
    const stepUp = await requestPurge(main, A.run, { sendStepUpId: 1 });
    expect(stepUp).toBeGreaterThan(1);
    expect(await one(main, `SELECT purge_state, purge_step_up_id::int AS s FROM test_runs WHERE id = '${A.run}'`)).toEqual({ purge_state: 'PURGING', s: stepUp });
    // Under way: the step-up id, the windows and the request's values are the database's, written once.
    await purgeRefused(main.updateTable('test_runs').set({ purge_step_up_id: stepUp + 1 }).where('id', '=', A.run).execute(), 'PURGE_STEP_UP_LOCKED');
    await purgeRefused(
      main.updateTable('test_runs').set({ purge_windows: jsonText({ fromId: 1, toId: stepUp, from: new Date(0).toISOString(), to: new Date().toISOString(), accounts: [] }) }).where('id', '=', A.run).execute(),
      'PURGE_WINDOWS_LOCKED',
    );
    await purgeRefused(main.updateTable('test_runs').set({ purge_summary: jsonText({ all: true }) }).where('id', '=', A.run).execute(), 'PURGE_WRITE_ONCE');
  });

  it('the purge end to end through the app\'s role: the disguised sign-up kept byte for byte, no audit row older than the test\'s start deleted, the chain OK; the bypass seen inside, never after a return or a raise (G11, H7)', async () => {
    const keptBefore = await rowsNaming(main, [A.disguised], ['test_runs']);
    const realBefore = await rowsNaming(main, [A.real], ['test_runs']);
    const older = (await q<{ id: number }>(main, `SELECT id FROM audit_logs WHERE id < ${A.fromId} ORDER BY id`)).map((r) => Number(r.id));
    expect(older).toContain(A.early);
    expect(keptBefore.audit_logs?.length ?? 0).toBeGreaterThan(1);
    expect(keptBefore.test_run_entrants).toHaveLength(1);

    const deleted: Record<string, number> = {};
    const deletedAccounts: string[] = [];
    const add = (r: Batch) => {
      for (const [t, n] of Object.entries(r.deleted)) deleted[t] = (deleted[t] ?? 0) + n;
      deletedAccounts.push(...r.deletedAccounts);
    };
    // The probe raising from inside the batch that deletes test_run_entrants (step 9): the batch raises, its
    // transaction goes back to the savepoint; the setting empty there and after.
    let raised: unknown = null;
    for (let i = 0; i < 40 && raised === null; i++) {
      await main.transaction().execute(async (tx) => {
        await sql`SET LOCAL t13.probe = 'raise'`.execute(tx);
        await sql`SAVEPOINT t13_call`.execute(tx);
        try {
          const r = await batch(tx, A.run);
          expect(r.phase, 'step 9 raises before it answers').not.toBe('RUN_ENTRANTS');
          add(r);
        } catch (e) {
          raised = e;
          await sql`ROLLBACK TO SAVEPOINT t13_call`.execute(tx);
          expect(await bypassNow(tx), 'the bypass after a raise, in its transaction').toBe('');
          expect(await one(tx, `SELECT current_user::text AS c`)).toEqual({ c: APP });
        }
        expect(await bypassNow(tx)).toBe('');
      });
    }
    expect((raised as Error | null)?.message).toBe('T13_PROBE test_run_entrants saw bypass=purge');
    expect(await bypassNow(main), 'the bypass after a raise, after its transaction').toBe('');

    // Then the batches as the loop calls them, each in its own transaction, to ACCOUNTS_DONE.
    let last: Batch | null = null;
    for (let i = 0; i < 200 && last?.phase !== 'ACCOUNTS_DONE'; i++) {
      last = await batchChecked(main, A.run);
      add(last);
      if (last.phase === 'RUN_ENTRANTS') {
        // The windows are the purge's own, written once by the definer: the app cannot change them.
        const windows = (await one<{ w: Record<string, unknown> | null }>(main, `SELECT purge_windows AS w FROM test_runs WHERE id = '${A.run}'`)).w;
        expect(windows).toMatchObject({ fromId: A.fromId });
        await purgeRefused(main.updateTable('test_runs').set({ purge_windows: jsonText({ ...windows, fromId: 1 }) }).where('id', '=', A.run).execute(), 'PURGE_WINDOWS_LOCKED', 'windows rewritten');
      }
    }
    expect(last?.phase).toBe('ACCOUNTS_DONE');
    expect(await bypassNow(main)).toBe('');
    await purgeDone(main, A.run, deleted, last!.kept);

    // The bots gone, every row of them; the disguised sign-up and the collector before the test byte for byte.
    expect(deletedAccounts.sort()).toEqual([...A.bots].sort());
    expect(last!.kept.accounts).toBe(1);
    expect(await rowsNaming(main, [A.disguised], ['test_runs'])).toEqual(keptBefore);
    expect(await rowsNaming(main, [A.real], ['test_runs'])).toEqual(realBefore);
    const left = await rowsNaming(main, A.bots, ['test_runs']);
    if (left.audit_logs) {
      const rows = (await q<{ action: string }>(main, `SELECT action FROM audit_logs x WHERE x::text ~ '${A.bots.join('|')}'`)).filter((r) => !SYSTEM_ACTIONS.test(r.action));
      expect(rows, 'no audit row but the release\'s system rows names a deleted bot').toEqual([]);
      delete left.audit_logs;
    }
    expect(left).toEqual({});
    // The chain bound: every tombstone after the test's start, every row before it still there.
    const gaps = (await q<{ id: number }>(main, `SELECT id FROM audit_purge_gaps WHERE run_id = '${A.run}' ORDER BY id`)).map((g) => Number(g.id));
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThan(A.fromId);
    expect((await q<{ id: number }>(main, `SELECT id FROM audit_logs WHERE id < ${A.fromId} ORDER BY id`)).map((r) => Number(r.id))).toEqual(older);
    const chain = await new AuditService({ db: main }).verifyChain({ batchSize: 97 });
    expect(chain.ok, JSON.stringify(chain)).toBe(true);
    expect(chain.purged).toBe(gaps.length);
    // The tombstones: the app can neither change nor remove one.
    for (const setting of ['', 'purge', 'reset']) {
      const asApp = (s: string) =>
        rolledBack(main, async (tx) => {
          await sql`SELECT set_config('orbes.guard_bypass', ${setting}, true)`.execute(tx);
          await sql.raw(s).execute(tx);
        });
      await guarded(asApp(`UPDATE audit_purge_gaps SET purged_at = purged_at WHERE id = ${gaps[0]}`), 'UPDATE on audit_purge_gaps is not allowed (audit_purge_gaps is append-only)', setting);
      await guarded(asApp(`DELETE FROM audit_purge_gaps WHERE id = ${gaps[0]}`), 'DELETE on audit_purge_gaps is not allowed (audit_purge_gaps is append-only)', setting);
    }
    // The bypass, as the probe saw it from inside the batch, for the app's session.
    expect(await q(owner!, `SELECT DISTINCT tbl, op, bypass, who FROM t13.seen WHERE who = '${APP}' ORDER BY 1`)).toEqual([{ tbl: 'test_run_entrants', op: 'DELETE', bypass: 'purge', who: APP }]);
  }, 240_000);

  it('(c) a step-10 batch against takePool\'s SELECT ... FOR UPDATE OF t on the same test_entrants rows in a second session: it waits, and deletes none of the accounts the new test took; their pool rows and entrants intact (M12, M15)', async () => {
    // From here the disguised sign-up stays out of the pool (takePool takes ACTIVE accounts only).
    await sql`UPDATE accounts SET status = 'LOCKED' WHERE id = ${A.disguised}`.execute(owner!);
    // Run B: four bots in a draw, ended, the draw cancelled; and the release a new test is about to start on.
    const drop = await openDraw('T13 · THE POOL');
    const started = await tests.start(drop, press(drop, { titane: 4 }), f.admin);
    await drive();
    const bots = await accountsOf(owner!, started.id);
    expect(bots).toHaveLength(4);
    expect(bots).not.toContain(A.disguised);
    await tests.end(started.id, testPhrase(drop, true), f.admin);
    await h!.ctx.services.drops.cancel(drop, f.admin);
    const next = await openDraw('T13 · THE NEXT TEST');

    // The purge through step 9: the run's test_run_entrants gone, its accounts free in the pool.
    await requestPurge(main, started.id);
    let r: Batch | null = null;
    for (let i = 0; i < 100 && !(r?.phase === 'RUN_ENTRANTS' && r.left === 0); i++) r = await batchChecked(main, started.id);
    expect(r).toMatchObject({ phase: 'RUN_ENTRANTS', left: 0 });
    expect(await count(main, `test_run_entrants WHERE run_id = '${started.id}'`)).toBe(0);

    // A second session starts a test: takePool's own statement (services/test-entrants.ts), FOR UPDATE OF t.
    const src = source('../../src/server/services/test-entrants.ts');
    const at = src.indexOf('private async takePool(');
    const open = src.indexOf('`', src.indexOf('const free = await sql<', at)) + 1;
    const take = src.slice(open, src.indexOf('`.execute(tx)', open));
    expect(take).toContain('FOR UPDATE OF t');
    expect(take.match(/\$\{[^}]+\}/g)).toEqual(['${d.id}', '${d.id}', '${d.id}', '${n}']);
    const x = await rawSession('orbes-genome');
    await x.query('BEGIN');
    const taken = (await x.query<{ id: string; email: string }>(take.replaceAll('${d.id}', '$1::uuid').replaceAll('${n}', '$2::int'), [next, 2])).rows.map((t) => t.id).sort();
    expect(taken).toHaveLength(2);
    expect(bots).toEqual(expect.arrayContaining(taken));

    // The batch (step 10) meanwhile: it waits on the rows the press holds.
    const step10 = batchChecked(main, started.id).then(
      (v) => ({ ok: v }),
      (e: unknown) => ({ error: e }),
    );
    const waiting = await waitFor('the batch waiting on the press\'s rows', async () =>
      (await backends()).find((b) => b.query.includes('orbes_purge_test_run_batch') && b.wait === 'Lock' && b.who === APP),
    );
    expect(['transactionid', 'tuple']).toContain(waiting.event);
    // The press goes on and commits: its run, RUNNING, and its entrants (as start() writes them).
    const run = (await x.query<{ id: string }>(`INSERT INTO test_runs (drop_id, mode, settings, entrants, created_by) VALUES ($1, 'DRAW', '[]', 2, $2) RETURNING id`, [next, holder])).rows[0]!.id;
    for (const [k, account] of taken.entries()) {
      await x.query(`INSERT INTO test_run_entrants (run_id, account_id, network, plan) VALUES ($1, $2, $3, '{}')`, [run, account, `100.64.${200 + k}.0/24`]);
    }
    await x.query('COMMIT');
    const out = await step10;
    if ('error' in out) throw out.error;
    // Re-checked under the lock: what the press took is kept, whole; the rest deleted.
    expect(out.ok.phase).toBe('ACCOUNTS');
    expect(out.ok.deletedAccounts.sort()).toEqual(bots.filter((b) => !taken.includes(b)).sort());
    for (const account of taken) {
      expect(await count(main, `accounts WHERE id = '${account}' AND status = 'ACTIVE'`), account).toBe(1);
      expect(await count(main, `test_entrants WHERE account_id = '${account}'`), account).toBe(1);
      expect(await count(main, `test_run_entrants WHERE run_id = '${run}' AND account_id = '${account}'`), account).toBe(1);
    }
    // The new test ends; the purge ends, keeping the two.
    await main.updateTable('test_runs').set({ status: 'ENDED', ended_at: new Date(), ended_by: holder }).where('id', '=', run).execute();
    let last: Batch = out.ok;
    for (let i = 0; i < 50 && last.phase !== 'ACCOUNTS_DONE'; i++) last = await batchChecked(main, started.id);
    expect(last).toMatchObject({ phase: 'ACCOUNTS_DONE', deletedAccounts: [] });
    expect(last.kept.accounts).toBe(2);
    await purgeDone(main, started.id, {}, last.kept);
    expect(await count(main, `accounts WHERE id = ANY ('{${taken.join(',')}}'::uuid[])`)).toBe(2);
    await x.end();
  }, 240_000);

  it('the console-only residual risk (D3, M8, F12, F19): with the authorization only code running as orbes_app can forge, the holder\'s id passes the start; with any other id, without one, with a stale one, with a test running, it is refused, nothing changed', async () => {
    // From here only the app: the superuser's app and connection closed.
    await h!.close();
    h = null;
    await closeDb(owner!);
    owner = null;
    await onlyMain();
    const none = { seen: 0, until: null };
    await resetRefusedAsWas(() => resetCall(main, holder, none), 'RESET_NOT_AUTHORIZED', 'without an authorization');
    // The authorization forged by the app's code: the preview read and the press made through the service, its
    // step-up's rows written by the app itself, no code, no password.
    const s = await forgeReset();
    const forged = await q<{ action: string; actor: string }>(main, `SELECT action, actor_id AS actor FROM audit_logs ORDER BY id DESC LIMIT 2`);
    expect(forged).toEqual([{ action: 'platform.reset.requested', actor: holder }, { action: 'admin.step_up', actor: holder }]);
    // Any other id: refused, the authorization kept for the holder.
    await resetRefusedAsWas(() => resetCall(main, other, s), 'RESET_NOT_HOLDER', 'another ADMIN\'s id');
    await resetRefusedAsWas(() => resetCall(main, randomUUID(), s), 'RESET_NOT_HOLDER', 'an unknown id');
    await resetRefused(
      inTransaction(main, async (tx) => {
        await forgedAuth.consumeAdminStepUp({ adminId: other, purpose: 'platform.reset' } as never, tx, {});
        await new AuditService({ db: tx }).record({ actor: { type: 'admin', id: other }, action: 'platform.reset.requested', targetType: 'admin', targetId: other, details: {} }, tx);
        await sql`SELECT orbes_platform_reset_authorize(${other}::uuid, 'platform.reset')`.execute(tx);
      }),
      'RESET_NOT_HOLDER',
      'another ADMIN authorizing itself',
    );
    await expect(service().request({ phrase: 'RESET PLATFORM', password: 'x', totp: '000000', collectorsSeen: s.seen, collectorsSeenUntil: s.until }, { actor: { type: 'admin', id: other }, token: 'x' })).rejects.toMatchObject({ code: 'RESET_NOT_HOLDER' });
    expect(await gate()).toMatchObject({ authorized_by: holder, authorized_purpose: 'platform.reset', resets: 0 });
    // A test running.
    const running = (await one<{ id: string }>(main, `INSERT INTO test_runs (drop_id, mode, settings, entrants, created_by) VALUES ('${A.drop}', 'DRAW', '[]', 0, '${holder}') RETURNING id`)).id;
    expect(await one(main, `SELECT orbes_platform_reset_precheck('${holder}') AS r`)).toEqual({ r: 'TEST_RUNNING' });
    await resetRefusedAsWas(() => resetCall(main, holder, s), 'RESET_TEST_RUNNING', 'a test running');
    await main.updateTable('test_runs').set({ status: 'ENDED', ended_at: new Date(), ended_by: holder }).where('id', '=', running).execute();
    // Stale: older than 5 minutes (its time moved back by the superuser, the test's own fixture).
    await asOwner((o) => sql`UPDATE platform_reset_gate SET authorized_at = authorized_at - interval '5 minutes 1 second'`.execute(o));
    await onlyMain();
    await resetRefusedAsWas(() => resetCall(main, holder, s), 'RESET_NOT_AUTHORIZED', 'a stale authorization');
    expect(await gate()).toMatchObject({ resets: 0, last_reset_at: null, launched_at: null });
  }, 120_000);

  it('(a) another session idle in transaction, a long SELECT under a pg_dump stand-in, an idle psql, an idle connection named \'orbes-genome\' as the app\'s own: each refuses the reset RESET_OTHER_CONNECTIONS, nothing changed (H13, F26)', async () => {
    const s = await forgeReset();
    const me = await onlyMain();
    expect((await backends()).find((b) => b.pid === me)?.app).toBe('orbes-genome');
    const refusedFor = async (state: string, label: string) => {
      const e = await resetRefusedAsWas(() => resetCall(main, holder, s), 'RESET_OTHER_CONNECTIONS', label);
      expect((e as { detail?: string }).detail, label).toBe(`1 other connection(s) to this database: ${state}`);
      expect(await gate(), label).toMatchObject({ authorized_by: holder, authorized_purpose: 'platform.reset', resets: 0 });
    };
    const stateOf = (pid: number, state: string) => waitFor(`${pid} ${state}`, async () => (await backends()).find((b) => b.pid === pid && b.state === state));

    // Idle in transaction (a one-off script's session).
    const script = await rawSession('scripts/admin.ts');
    await script.query('BEGIN');
    await script.query('SELECT count(*) FROM accounts');
    await stateOf(script.pid, 'idle in transaction');
    await refusedFor('idle in transaction', 'idle in transaction');
    await script.query('ROLLBACK');
    await script.end();
    await onlyMain();

    // A long SELECT in a read-only snapshot, as pg_dump reads.
    const dump = await rawSession('pg_dump');
    await dump.query('BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const long = dump.query('SELECT pg_sleep(60), (SELECT count(*) FROM public.audit_logs)').then(
      () => null,
      (e: unknown) => e,
    );
    await stateOf(dump.pid, 'active');
    await refusedFor('active', 'a long SELECT');
    await sql`SELECT pg_cancel_backend(${dump.pid}::int)`.execute(admin);
    expect(pgError(await long)?.code).toBe('57014');
    await dump.query('ROLLBACK');
    await dump.end();
    await onlyMain();

    // An idle psql.
    const psql = await rawSession('psql');
    await psql.query('SELECT 1');
    await stateOf(psql.pid, 'idle');
    await refusedFor('idle', 'an idle psql');
    await psql.end();
    await onlyMain();

    // An idle connection of another process that names itself as the app does (application_name is the client's).
    const another = appDb(1);
    const pid = await pidOf(another);
    expect((await backends()).find((b) => b.pid === pid)).toMatchObject({ app: 'orbes-genome', who: APP });
    await stateOf(pid, 'idle');
    await refusedFor('idle', 'an idle orbes-genome');
    await closeDb(another);
    await onlyMain();
  }, 120_000);

  it('(b) the LIVE engine\'s session lock held by another session: RESET_LIVE_ENGINE, nothing changed (M12)', async () => {
    const s = await forgeReset();
    await onlyMain();
    // The engine's own statement (services/live-engine.ts).
    expect(source('../../src/server/services/live-engine.ts')).toContain('pg_try_advisory_lock(${ADVISORY_LOCK.LIVE_ENGINE}::bigint)');
    const engine = await rawSession('orbes-genome');
    expect((await engine.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [ADVISORY_LOCK.LIVE_ENGINE])).rows[0].locked).toBe(true);
    await resetRefusedAsWas(() => resetCall(main, holder, s), 'RESET_LIVE_ENGINE');
    await engine.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK.LIVE_ENGINE]);
    await engine.end();
    await onlyMain();
  });

  /** A write held on skus in a second session, as the services make it: the size set aside under FOR UPDATE and audited in its transaction (AUDIT_CHAIN held to its COMMIT). */
  async function heldSkuWrite(): Promise<{ tx: Db; pid: number; release(): Promise<void> }> {
    const second = appDb(1);
    const held = deferred<{ tx: Db; pid: number }>();
    const release = deferred();
    cleanups.push(async () => release.resolve());
    const done = rolledBack(second, async (tx) => {
      const sku = await tx.selectFrom('skus').select(['id', 'code', 'model_id']).where('set_aside_at', 'is', null).where('model_id', 'is not', null).orderBy('id').limit(1).forUpdate().executeTakeFirstOrThrow();
      await tx.updateTable('skus').set({ set_aside_at: new Date(), set_aside_by: holder }).where('id', '=', sku.id).execute();
      await new AuditService({ db: tx }).record(
        { actor: holderActor, action: 'model.sizes.declare', targetType: 'model', targetId: sku.model_id!, details: { added: [], reinstated: [], setAside: [sku.code], removed: [] } },
        tx,
      );
      held.resolve({ tx, pid: await pidOf(tx) });
      await release.promise;
    });
    const h2 = await held.promise;
    return {
      ...h2,
      async release() {
        release.resolve();
        await done;
        await closeDb(second);
      },
    };
  }

  it('(e) a write held on skus: a bare one refuses the reset at once (another connection); one made as the services make it, its audit row with it, makes the reset wait in its transaction and give up at its 5 s lock timeout; nothing changed', async () => {
    const s = await forgeReset();
    await onlyMain();
    // A bare write, held.
    const bare = await rawSession('psql');
    await bare.query('BEGIN');
    expect((await bare.query(`UPDATE skus SET set_aside_at = now(), set_aside_by = $1 WHERE id = (SELECT id FROM skus WHERE set_aside_at IS NULL AND model_id IS NOT NULL ORDER BY id LIMIT 1)`, [holder])).rowCount).toBe(1);
    const t0 = Date.now();
    await resetRefusedAsWas(() => resetCall(main, holder, s), 'RESET_OTHER_CONNECTIONS', 'a bare write held');
    expect(Date.now() - t0).toBeLessThan(4_000);
    await bare.query('ROLLBACK');
    await bare.end();
    await onlyMain();

    // As the services write: the reset waits on the chain's lock, then its lock timeout.
    const held = await heldSkuWrite();
    const before = await fingerprint(main);
    const gateBefore = await gate();
    const t1 = Date.now();
    await refusedWith(resetCall(main, holder, s), (e) => pgError(e)?.code === '55P03', 'the lock timeout');
    const waited = Date.now() - t1;
    expect(waited).toBeGreaterThanOrEqual(4_500);
    expect(waited).toBeLessThan(15_000);
    expect(await fingerprint(main)).toEqual(before);
    expect(await gate()).toEqual(gateBefore);
    await held.release();
    await onlyMain();
    expect(await fingerprint(main)).toEqual(before);
  }, 120_000);

  it('(f) the 9 Oct "lost connection before commit": the reset waiting inside its transaction behind a held write on skus, its backend terminated by the second connection: every table\'s count and md5, the gate (resets, last_reset_at, authorization) and the audit log as before (G9)', async () => {
    const s = await forgeReset();
    await onlyMain();
    const before = await fingerprint(main);
    const gateBefore = await gate();
    const held = await heldSkuWrite();
    // The reset's session: a connection of the app's role of its own (a raw one: its client keeps an error handler
    // when its backend goes, which a pool's checked-out client has not).
    const victim = await rawSession('orbes-genome');
    const victimPid = victim.pid;
    await victim.query('BEGIN');
    const t0 = Date.now();
    const call = victim.query('SELECT orbes_platform_reset($1::uuid, $2::int, $3::timestamptz) AS r', [holder, s.seen, s.until]).then(
      () => null,
      (e: unknown) => e,
    );
    // Inside orbes_platform_reset, waiting on a lock (the chain's, step 3), within its 5 s lock timeout.
    const waiting = await waitFor('the reset waiting', async () => (await backends()).find((b) => b.pid === victimPid && b.wait === 'Lock' && b.query.includes('orbes_platform_reset(')));
    expect(waiting.event).toBe('advisory');
    expect((await sql<{ ok: boolean }>`SELECT pg_terminate_backend(${victimPid}::int) AS ok`.execute(held.tx)).rows[0]!.ok).toBe(true);
    const error = await call;
    expect(error).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(resetRefusal(error)).toBeUndefined();
    await waitFor('the reset\'s backend gone', async () => !(await backends()).some((b) => b.pid === victimPid));
    await held.release();
    await victim.end().catch(() => undefined);
    await onlyMain();
    expect(await fingerprint(main)).toEqual(before);
    const g = await gate();
    expect(g).toEqual(gateBefore);
    expect(g).toMatchObject({ resets: 0, last_reset_at: null, authorized_by: holder, authorized_purpose: 'platform.reset' });
    expect((await new AuditService({ db: main }).verifyChain({ batchSize: 97 })).ok).toBe(true);
  }, 120_000);

  it('the bypass inside the reset, never after it raises (H7): the probe raising from step 8 rolls the reset back whole; the setting empty in its transaction and after', async () => {
    const s = await forgeReset();
    await onlyMain();
    const before = await fingerprint(main);
    await main.transaction().execute(async (tx) => {
      await sql`SET LOCAL t13.probe = 'raise'`.execute(tx);
      await sql`SAVEPOINT t13_reset`.execute(tx);
      const e = await refusedWith(sql`SELECT orbes_platform_reset(${holder}::uuid, ${s.seen}::int, ${s.until}::timestamptz)`.execute(tx), (x) => (x as Error).message === 'T13_PROBE drops saw bypass=reset', 'the probe inside step 8');
      expect(pgError(e)?.code).toBe('P0001');
      await sql`ROLLBACK TO SAVEPOINT t13_reset`.execute(tx);
      expect(await bypassNow(tx)).toBe('');
      expect(await one(tx, `SELECT current_user::text AS c`)).toEqual({ c: APP });
    });
    expect(await bypassNow(main)).toBe('');
    expect(await fingerprint(main)).toEqual(before);
  }, 120_000);

  it('(d) the reset through the app\'s role and the real run(), end to end: the holder\'s id with the forged authorization passes; while run() is between the function and entry 1, every chain and numbering lock is held in the services\' own key forms, and an invoice number, a serial and an audit entry wait for its COMMIT; then entry 1, the post-check, the authorization used once', async () => {
    const s = await forgeReset();
    const year = Number((await one<{ y: number }>(main, `SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int AS y`)).y);
    const category = Number((await one<{ id: number }>(main, `SELECT id FROM categories WHERE code = 'J'`)).id);
    await onlyMain();
    const svc = service(main);
    const pause = new PauseAfter('orbes_platform_reset(');
    cleanups.push(async () => pause.release.resolve());
    const ran = svc.run(holder, s.seen, s.until, main.withPlugin(pause));
    ran.catch(() => undefined);
    await Promise.race([
      pause.reached.promise,
      ran.then(() => {
        throw new Error('run() ended before the function answered');
      }),
    ]);

    // Past its step 4: a session may connect now. Every key the services take, in their own forms, is held.
    const probe = await rawSession('orbes-genome');
    await probe.query('BEGIN');
    const one1 = async (key: number) => (await probe.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS got', [key])).rows[0].got as boolean;
    const two = async (key: number, sub: number) => (await probe.query('SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS got', [key, sub])).rows[0].got as boolean;
    const held: string[] = [];
    for (const k of ['AUDIT_CHAIN', 'CATEGORY_ALLOCATION', 'LIVE_ENGINE'] as const) {
      expect(await one1(ADVISORY_LOCK[k]), k).toBe(false);
      held.push(k);
    }
    for (const y of [year, year + 1]) {
      for (const kind of INVOICE_KINDS) {
        expect(await two(ADVISORY_LOCK.INVOICE_NUMBER, y * 2 + INVOICE_KINDS.indexOf(kind)), `INVOICE_NUMBER ${y} ${kind}`).toBe(false);
        held.push(`INVOICE_NUMBER ${y} ${kind}`);
      }
      for (const kind of PARTNER_INVOICE_KINDS) {
        expect(await two(ADVISORY_LOCK.PARTNER_INVOICE_NUMBER, y * 2 + PARTNER_INVOICE_KINDS.indexOf(kind)), `PARTNER_INVOICE_NUMBER ${y} ${kind}`).toBe(false);
        held.push(`PARTNER_INVOICE_NUMBER ${y} ${kind}`);
      }
      for (let c = 0; c < 32; c++) {
        expect(await two(ADVISORY_LOCK.SERIAL_ALLOCATION, serialLockKey(y, c)), `SERIAL_ALLOCATION ${y} ${c}`).toBe(false);
        held.push(`SERIAL_ALLOCATION ${y} ${c}`);
      }
    }
    expect(held).toHaveLength(3 + 2 * (2 + 2 + 32));
    // The forms matter (G5): the one-key form of a two-part key is another lock, free.
    expect(await one1(ADVISORY_LOCK.INVOICE_NUMBER)).toBe(true);
    await probe.query('ROLLBACK');
    // The services take them through the shared helper, with these keys (invoices.ts, partners.ts, issuance.ts).
    expect(source('../../src/server/services/invoices.ts')).toContain('advisoryXactLock(tx, ADVISORY_LOCK.INVOICE_NUMBER, year * 2 + INVOICE_KINDS.indexOf(kind))');
    expect(source('../../src/server/services/partners.ts')).toContain('advisoryXactLock(tx, ADVISORY_LOCK.PARTNER_INVOICE_NUMBER, year * 2 + PARTNER_INVOICE_KINDS.indexOf(kind))');
    expect(source('../../src/server/services/issuance.ts')).toContain('advisoryXactLock(trx, ADVISORY_LOCK.SERIAL_ALLOCATION, serialLockKey(year, categoryIndex))');

    // Started meanwhile, each in its own session: an invoice number, a serial, an audit entry. They wait.
    const invoices = appDb(1);
    const serials = appDb(1);
    const audits = appDb(1);
    const pids = { invoice: await pidOf(invoices), serial: await pidOf(serials), audit: await pidOf(audits) };
    const invoice = invoices.transaction().execute(async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.INVOICE_NUMBER, year * 2 + INVOICE_KINDS.indexOf('INVOICE'));
      const at = Date.now();
      const r = await tx.selectFrom('invoices').select((eb) => eb.fn.max('sequence').as('n')).where('kind', '=', 'INVOICE').where('year', '=', year).executeTakeFirst();
      return { at, next: Number(r?.n ?? 0) + 1 };
    });
    const serial = serials.transaction().execute(async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.SERIAL_ALLOCATION, serialLockKey(year, category));
      const at = Date.now();
      const r = await tx.selectFrom('products').select((eb) => eb.fn.max('serial').as('n')).where('year', '=', year).where('category_id', '=', category).executeTakeFirst();
      return { at, next: Number(r?.n ?? 0) + 1 };
    });
    const entry = new AuditService({ db: audits }).record({ actor: holderActor, action: 'admin.login', targetType: 'admin', targetId: holder, details: {} }).then((e) => ({ at: Date.now(), e }));
    for (const [k, pid] of Object.entries(pids)) {
      await waitFor(`the ${k} waiting`, async () => (await backends()).find((b) => b.pid === pid && b.wait === 'Lock' && b.event === 'advisory'));
    }
    const released = Date.now();
    pause.release.resolve();
    const out = await ran;
    const [inv, ser, aud] = await Promise.all([invoice, serial, entry]);
    // Each went on after the release, once the reset had committed: numbered from 1, the entry chained onto entry 1.
    expect(inv.at).toBeGreaterThanOrEqual(released);
    expect(ser.at).toBeGreaterThanOrEqual(released);
    expect(aud.at).toBeGreaterThanOrEqual(released);
    expect(inv.next).toBe(1);
    expect(ser.next).toBe(1);
    expect(out.entry.id).toBe(1);
    expect(aud.e).toMatchObject({ id: 2, prevHash: out.entry.hash });
    for (const db of [invoices, serials, audits]) await closeDb(db);
    await probe.end();
    await onlyMain();

    // Its proofs: every wiped table empty, the kept ones counted, entry 1 from the genesis hash, the gate's own columns.
    expect(out.result.wiped.accounts).toBeGreaterThanOrEqual(3);
    expect(out.result.wiped.drops).toBeGreaterThanOrEqual(3);
    expect(Object.keys(out.result.wiped).sort()).toEqual(Object.entries(RESET_PLAN).filter(([, k]) => k === 'WIPE').map(([t]) => t).sort());
    for (const t of ['accounts', 'drops', 'test_runs', 'test_entrants', 'audit_purge_gaps']) expect(await count(main, t), t).toBe(0);
    const first = await one<{ id: number; prev: string; action: string }>(main, `SELECT id, encode(prev_hash, 'hex') AS prev, action FROM audit_logs WHERE id = 1`);
    expect(first).toEqual({ id: 1, prev: toHex(AUDIT_GENESIS_HASH), action: 'platform.reset' });
    expect(await gate()).toMatchObject({ holder_admin_id: holder, resets: 1, last_reset_by: holder, launched_at: null, authorized_by: null, authorized_at: null, authorized_purpose: null });
    const state = await svc.state(holder, main);
    if (!state.holder) throw new Error('the holder reads the page');
    expect(state.lastReset?.anchor).toEqual({ id: 1, hash: out.entry.hash });
    expect(state.lastReset!.postCheck.filter((l) => !l.ok)).toEqual([]);
    expect((await new AuditService({ db: main }).verifyChain()).ok).toBe(true);
    expect(await bypassNow(main)).toBe('');
    // The bypass as the probe saw it inside the reset, for the app's session.
    expect(await asOwner((o) => q(o, `SELECT DISTINCT tbl, op, bypass, who FROM t13.seen WHERE tbl = 'drops' ORDER BY 1`))).toEqual([{ tbl: 'drops', op: 'DELETE', bypass: 'reset', who: APP }]);
    await onlyMain();
    // The authorization was used: a second call with it refused, nothing changed.
    await resetRefusedAsWas(() => resetCall(main, holder, { seen: 0, until: null }), 'RESET_NOT_AUTHORIZED', 'the used authorization');
  }, 240_000);

  it('a second reset through the app\'s role, the bypass empty in its transaction right after the function returned; then LOCK RESET, and every reset and authorization refused for good', async () => {
    const s = await forgeReset();
    await onlyMain();
    await main.transaction().execute(async (tx) => {
      const r = (await sql<{ r: ResetResult }>`SELECT orbes_platform_reset(${holder}::uuid, ${s.seen}::int, ${s.until}::timestamptz) AS r`.execute(tx)).rows[0]!.r;
      expect(await bypassNow(tx), 'the bypass after the reset returned, in its transaction').toBe('');
      const entry = await new AuditService({ db: tx }).record(
        {
          actor: holderActor,
          action: 'platform.reset',
          targetType: 'admin',
          targetId: holder,
          details: { by: holder, at: r.at, counts: { wiped: r.wiped, kept: r.kept, partly: r.partly, collectors: r.collectors }, oldHead: r.oldHead, totp: r.totp, requestId: r.requestId, stepUpId: r.stepUpId, recent24h: r.recent24h, capture: r.capture },
        },
        tx,
      );
      expect(entry).toMatchObject({ id: 1, prevHash: toHex(AUDIT_GENESIS_HASH) });
    });
    expect(await gate()).toMatchObject({ resets: 2, authorized_by: null });
    expect(await bypassNow(main)).toBe('');

    // LOCK RESET, its authorization forged the same way, through the service.
    const locked = await service().lock({ phrase: 'LOCK RESET', password: 'not checked', totp: '000000' }, { actor: holderActor, token: 'not checked' });
    expect(locked.launched.at).toEqual(expect.any(String));
    expect(await gate()).toMatchObject({ resets: 2, launched_by: holder, authorized_by: null });
    expect(await one(main, `SELECT orbes_platform_reset_precheck('${holder}') AS r`)).toEqual({ r: 'LOCKED' });
    await resetRefusedAsWas(() => resetCall(main, holder, s), 'RESET_LOCKED', 'a reset after LOCK RESET');
    await resetRefused(
      inTransaction(main, async (tx) => {
        await forgedAuth.consumeAdminStepUp({ adminId: holder, purpose: 'platform.reset' } as never, tx, {});
        await new AuditService({ db: tx }).record({ actor: holderActor, action: 'platform.reset.requested', targetType: 'admin', targetId: holder, details: {} }, tx);
        await sql`SELECT orbes_platform_reset_authorize(${holder}::uuid, 'platform.reset')`.execute(tx);
      }),
      'RESET_LOCKED',
      'an authorization forged after LOCK RESET',
    );
    await expect(service().request({ phrase: 'RESET PLATFORM', password: 'x', totp: '000000', collectorsSeen: s.seen, collectorsSeenUntil: s.until }, { actor: holderActor, token: 'x' })).rejects.toMatchObject({ code: 'RESET_LOCKED' });
    await guarded(
      rolledBack(main, (tx) => sql`UPDATE platform_reset_gate SET launched_at = NULL, launched_by = NULL`.execute(tx)),
      'UPDATE on platform_reset_gate is not allowed (written by the reset functions only)',
    );
    expect(await gate()).toMatchObject({ resets: 2, launched_by: holder });
    expect((await new AuditService({ db: main }).verifyChain()).ok).toBe(true);
  }, 240_000);
});
