/**
 * Migration 0067_platform_reset (lot PURGE, step PURGE.8; plan §B.1 and §B.2): the reset's plan in the database, the
 * guards' second way through, the gate, the precheck, the authorization, the reset and LOCK RESET; on PGlite here and on
 * a real PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL, a throwaway database; skipped without it), the same cases on
 * both, each with a throwaway NOSUPERUSER role standing for the app (lib.sh's grants: DML on every table, nothing else):
 *  - down to 0066 without rows: exactly the schema of 0066 (PGlite: against a database migrated to 0066 alone), 0066's
 *    orbes_reject_mutation back byte for byte, and up again the latest, the plan and the gate written;
 *  - the reset's way through: a TRUNCATE of a wiped table or a DELETE on a wiped or partly kept one, purpose `reset`, by
 *    a superuser; an UPDATE never, a kept table never, a partly kept table never truncated, the app's role never; the
 *    purge's way unchanged; every guard use of orbes_reject_mutation still refuses with its own words otherwise;
 *  - the plan and the gate written by a superuser only; the gate one row, LOCK RESET one way, the holder fixed once
 *    launched, the count never down, its CHECKs;
 *  - the holder recorded by the migration: the oldest active ADMIN with two-factor authentication, NULL when none;
 *  - the definer functions: SECURITY DEFINER, owned by a superuser, their exact settings (the precheck carries no bypass
 *    and no lock timeout, H7), exactly the lot's (the purge's two and the reset's five); the numbering locks' helper out
 *    of PUBLIC's reach; the app's role reaches each function's first refusal, never a permission error;
 *  - the precheck's answers, the authorization's own refusals.
 * Then on PGlite (one connection: the other-backend and lock-contention cases are PURGE.13's, on PostgreSQL): the
 * precheck on real fixtures (a test running, a LIVE room open, the collectors counted as GROWTH's rule counts them); a
 * reset end to end on a small platform (the founding list on a release link kept and re-pointed, every other link
 * wiped, an invitation chain, segments, revocations, a reward given), the locks it holds, a failed last proof rolling
 * everything back, LOCK RESET; down refused after a reset or a lock. The full rehearsal on the demo seed is PURGE.9's.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { closeDb, createDb, inTransaction, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import { isGuardViolation, pgError, PG_ERROR, resetRefusal } from '../../src/server/db/pg-errors.js';
import { RESET_PLAN } from '../../src/server/db/reset-plan.js';
import { countedCollector } from '../../src/server/services/population.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createHarness, type Harness } from '../api/support.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const BEFORE = '0066_test_purge';
const NAME = '0067_platform_reset';
const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
const APP_ROLE = `orbes_t67_${randomBytes(4).toString('hex')}`;
const PATH = 'search_path=pg_catalog, public, pg_temp';

/** Every column, index, constraint, trigger and function of the public schema (functions by their source's md5 and settings). */
async function snapshotOf(db: Kysely<any>): Promise<string[]> {
  return (
    await sql<{ object: string }>`
      SELECT 'table ' || table_name || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS object
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
      UNION ALL SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%'
      UNION ALL SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
      UNION ALL SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(p.prosrc) || ' ' || p.prosecdef
                       || ' ' || coalesce(array_to_string(p.proconfig, ';'), '')
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      ORDER BY 1`.execute(db)
  ).rows.map((r) => r.object);
}

/** Down to 0066 (0067 reverted). */
async function downTo0066(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** What names an object of 0067 in a snapshot. */
const of0067 = (o: string) => /\b(platform_reset_\w+|orbes_platform_reset\w*|orbes_reject_mutation)\b/.test(o);
/** A NOT NULL's own constraint entry: PGlite's PostgreSQL lists it among the constraints, PostgreSQL 16 does not. */
const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);

/** The forbidden windows answered open (CI runs at any hour), or by `body` (SQL over p_at); the original's source to put back. */
async function windowsAs(db: Db, body = 'NULL::text'): Promise<() => Promise<void>> {
  const def = (await sql<{ def: string }>`SELECT pg_get_functiondef('orbes_maintenance_window(timestamptz)'::regprocedure) AS def`.execute(db)).rows[0]!.def;
  await sql.raw(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT ${body} $$`).execute(db);
  return async () => {
    await sql.raw(def).execute(db);
  };
}

function cases(state: { db: () => Db; schemaAt0066: () => Promise<string[] | null> }) {
  const db = () => state.db();
  const run = (q: string, on: Db = db()) => sql.raw(q).execute(on);
  const one = async <T,>(q: string, on: Db = db()) => (await sql.raw<T>(q).execute(on)).rows[0] as T;
  const all = async <T,>(q: string, on: Db = db()) => (await sql.raw<T>(q).execute(on)).rows;
  const count = async (from: string) => Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`)).n);
  const refused = (p: Promise<unknown>, reason: string, label = reason) =>
    expect(p, label).rejects.toSatisfy((e) => {
      if (resetRefusal(e) !== reason || pgError(e)?.code !== PG_ERROR.RESET_REFUSED) throw new Error(`${label}: expected OR011 ${reason}, got ${pgError(e)?.code} ${(e as Error).message}`);
      return true;
    });
  const guarded = (p: Promise<unknown>, message: string, label = message) =>
    expect(p, label).rejects.toSatisfy((e) => {
      if (!isGuardViolation(e) || (e as Error).message !== message) throw new Error(`${label}: expected OR001 « ${message} », got ${pgError(e)?.code} « ${(e as Error).message} »`);
      return true;
    });
  /** `body` in one transaction, always rolled back; its value returned. */
  const rolledBack = async <T,>(body: (tx: Db) => Promise<T>): Promise<T> => {
    let out: T | undefined;
    await db()
      .transaction()
      .execute(async (tx) => {
        out = await body(tx);
        throw Object.assign(new Error('rollback'), { rollback: true });
      })
      .catch((e: { rollback?: boolean }) => {
        if (!e?.rollback) throw e;
      });
    return out as T;
  };
  /** In one transaction as the app's role (NOSUPERUSER, DML only), rolled back; `setting`: orbes.guard_bypass. */
  const asApp = (q: string, setting?: string) =>
    rolledBack(async (tx) => {
      await sql.raw(`SET LOCAL ROLE ${APP_ROLE}`).execute(tx);
      if (setting) await sql.raw(`SET LOCAL orbes.guard_bypass = '${setting}'`).execute(tx);
      return (await sql.raw(q).execute(tx)).rows;
    });
  /** As the superuser with orbes.guard_bypass set, rolled back. */
  const asSuper = (q: string, setting: string) =>
    rolledBack(async (tx) => {
      await sql.raw(`SET LOCAL orbes.guard_bypass = '${setting}'`).execute(tx);
      return (await sql.raw(q).execute(tx)).rows;
    });
  const admin = async (o: { email: string; role?: string; totp?: boolean; disabled?: boolean; at?: string }) =>
    (
      await one<{ id: string }>(
        `INSERT INTO admin_users (email, email_normalized, password_hash, role, totp_secret_enc, disabled_at, created_at)
         VALUES ('${o.email}', '${o.email}', 'scrypt$x', '${o.role ?? 'ADMIN'}', ${o.totp === false ? 'NULL' : `'sealed-${o.email}'`},
                 ${o.disabled ? 'now()' : 'NULL'}, ${o.at ? `'${o.at}'` : 'now()'}) RETURNING id`,
      )
    ).id;
  const gate = () => one<Record<string, unknown>>(`SELECT * FROM platform_reset_gate`);

  it('rolls back to the schema of 0066 exactly without rows: what 0067 added, 0066\'s orbes_reject_mutation back byte for byte; and applies again to the latest, its plan and its gate written', async () => {
    const latest = await snapshotOf(db());
    expect(await downTo0066(db())).toEqual([NAME]);
    const before = await snapshotOf(db());
    const at0066 = await state.schemaAt0066();
    if (at0066) expect(before).toEqual(at0066);
    const reject = (s: string[]) => s.filter((o) => o.startsWith('function orbes_reject_mutation('));
    expect(reject(before)).toHaveLength(1);
    expect(reject(latest)).toHaveLength(1);
    expect(reject(latest)).not.toEqual(reject(before));
    const src = (await one<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'orbes_reject_mutation'`)).src;
    expect(src).toContain(`TG_TABLE_NAME IN ('audit_logs','order_events','event_journal','credit_uses','tier_grants')`);
    expect(src).not.toContain('reset');
    const added = latest.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !latest.includes(o) && !notNull(o));
    expect(removed).toEqual(reject(before));
    expect(added.filter((o) => !of0067(o))).toEqual([]);
    expect(before.filter((o) => of0067(o) && !o.startsWith('function orbes_reject_mutation('))).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table platform_reset_gate authorized_at timestamp with time zone YES ',
      'table platform_reset_gate authorized_by uuid YES ',
      'table platform_reset_gate authorized_purpose text YES ',
      'table platform_reset_gate holder_admin_id uuid YES ',
      'table platform_reset_gate id smallint NO ',
      'table platform_reset_gate last_reset_at timestamp with time zone YES ',
      'table platform_reset_gate last_reset_by uuid YES ',
      'table platform_reset_gate last_reset_details jsonb YES ',
      'table platform_reset_gate launched_at timestamp with time zone YES ',
      'table platform_reset_gate launched_by uuid YES ',
      'table platform_reset_gate resets integer NO 0',
      'table platform_reset_plan kind text NO ',
      'table platform_reset_plan tbl text NO ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint ')).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual([
      'constraint platform_reset_gate platform_reset_gate_authorized',
      'constraint platform_reset_gate platform_reset_gate_authorized_by_fkey',
      'constraint platform_reset_gate platform_reset_gate_authorized_purpose_check',
      'constraint platform_reset_gate platform_reset_gate_holder_admin_id_fkey',
      'constraint platform_reset_gate platform_reset_gate_id_check',
      'constraint platform_reset_gate platform_reset_gate_last_reset',
      'constraint platform_reset_gate platform_reset_gate_last_reset_by_fkey',
      'constraint platform_reset_gate platform_reset_gate_last_reset_details_check',
      'constraint platform_reset_gate platform_reset_gate_launched',
      'constraint platform_reset_gate platform_reset_gate_launched_by_fkey',
      'constraint platform_reset_gate platform_reset_gate_pkey',
      'constraint platform_reset_gate platform_reset_gate_resets_check',
      'constraint platform_reset_plan platform_reset_plan_kind_check',
      'constraint platform_reset_plan platform_reset_plan_pkey',
      'constraint platform_reset_plan platform_reset_plan_tbl_check',
    ]);
    for (const c of [
      'constraint platform_reset_gate platform_reset_gate_holder_admin_id_fkey FOREIGN KEY (holder_admin_id) REFERENCES admin_users(id) ON DELETE RESTRICT',
      "constraint platform_reset_plan platform_reset_plan_kind_check CHECK ((kind = ANY (ARRAY['KEEP'::text, 'PARTLY'::text, 'WIPE'::text])))",
    ]) {
      expect(added, c).toContain(c);
    }
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX platform_reset_gate_authorized_by_idx ON public.platform_reset_gate USING btree (authorized_by)',
      'index CREATE INDEX platform_reset_gate_holder_admin_id_idx ON public.platform_reset_gate USING btree (holder_admin_id)',
      'index CREATE INDEX platform_reset_gate_last_reset_by_idx ON public.platform_reset_gate USING btree (last_reset_by)',
      'index CREATE INDEX platform_reset_gate_launched_by_idx ON public.platform_reset_gate USING btree (launched_by)',
      'index CREATE UNIQUE INDEX platform_reset_gate_pkey ON public.platform_reset_gate USING btree (id)',
      'index CREATE UNIQUE INDEX platform_reset_plan_pkey ON public.platform_reset_plan USING btree (tbl)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger platform_reset_gate platform_reset_gate_guard',
      'trigger platform_reset_gate platform_reset_gate_no_truncate',
      'trigger platform_reset_plan platform_reset_plan_no_truncate',
      'trigger platform_reset_plan platform_reset_plan_superuser',
    ]);
    expect(added.filter((o) => o.startsWith('function ')).map((o) => o.split(' ')[1])).toEqual([
      'orbes_platform_reset(p_admin',
      'orbes_platform_reset_authorize(p_admin',
      'orbes_platform_reset_gate_guard()',
      'orbes_platform_reset_lock(p_admin',
      'orbes_platform_reset_numbering_locks(p_year',
      'orbes_platform_reset_precheck(p_admin',
      'orbes_platform_reset_unauthorize()',
      'orbes_reject_mutation()',
    ]);
    // Up again: the same schema, the plan and the one gate row written, nothing else.
    expect((await migrateToLatest(db())).applied).toEqual([NAME]);
    expect(await snapshotOf(db())).toEqual(latest);
    expect(await count('platform_reset_plan')).toBe(Object.keys(RESET_PLAN).length);
    expect(await gate()).toEqual({
      id: 1, holder_admin_id: null, launched_at: null, launched_by: null, last_reset_at: null, last_reset_by: null, resets: 0,
      last_reset_details: null, authorized_by: null, authorized_at: null, authorized_purpose: null,
    });
  });

  it('the app\'s role: a throwaway NOSUPERUSER role with lib.sh\'s grants (DML on every table)', async () => {
    await run(`CREATE ROLE ${APP_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`);
    await run(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
    expect(await asApp(`SELECT current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`)).toEqual([{ who: APP_ROLE, su: false }]);
  });

  it('the reset\'s way through: a TRUNCATE of a wiped table or a DELETE on a wiped or partly kept one, purpose reset, by a superuser; an UPDATE never, a kept table never, a partly kept one never truncated, the app\'s role never; the purge\'s way unchanged', async () => {
    const a = Number((await one<{ id: string }>(`INSERT INTO audit_logs (occurred_at, actor_type, action, details, prev_hash, hash)
      VALUES (now(), 'system', 't67.row', '{}', sha256(convert_to(gen_random_uuid()::text, 'UTF8')), sha256(convert_to(gen_random_uuid()::text, 'UTF8'))) RETURNING id`)).id);
    const appendOnly = (op: string, t = 'audit_logs') => `${op} on ${t} is not allowed (${t} is append-only)`;
    // Without the setting, or with another purpose (the purge's never truncates; its DELETE is its own list's).
    await guarded(run(`DELETE FROM audit_logs WHERE id = ${a}`), appendOnly('DELETE'));
    await guarded(asSuper(`TRUNCATE audit_logs`, 'purge'), appendOnly('TRUNCATE'));
    await guarded(asSuper(`TRUNCATE audit_logs`, 'RESET'), appendOnly('TRUNCATE'));
    await guarded(asSuper(`TRUNCATE product_status_history`, 'purge'), appendOnly('TRUNCATE', 'product_status_history'));
    // The superuser with 'reset': a wiped table truncated or deleted from (rolled back here), the guards as before after.
    expect(await asSuper(`DELETE FROM audit_logs WHERE id = ${a} RETURNING id`, 'reset')).toEqual([{ id: a }]);
    expect(await asSuper(`TRUNCATE audit_logs, audit_purge_gaps RESTART IDENTITY`, 'reset')).toEqual([]);
    expect(await count(`audit_logs WHERE id = ${a}`)).toBe(1);
    // An UPDATE never, even with it.
    await guarded(asSuper(`UPDATE audit_logs SET action = 't67.changed' WHERE id = ${a}`, 'reset'), appendOnly('UPDATE'));
    // A kept table never (its guards, row and statement), nor a partly kept table truncated.
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'Z', 'T67') ON CONFLICT DO NOTHING`);
    await guarded(asSuper(`DELETE FROM categories WHERE id = 31`, 'reset'), 'DELETE on categories is not allowed (category indices are never released; deactivate instead)');
    await guarded(asSuper(`DELETE FROM vault_sources`, 'reset'), 'DELETE on vault_sources is not allowed (a vault source is switched off, never deleted)');
    await run(`INSERT INTO suppliers (name) VALUES ('T67 SUPPLIER')`);
    await guarded(asSuper(`DELETE FROM suppliers WHERE name = 'T67 SUPPLIER'`, 'reset'), 'DELETE on suppliers is not allowed (suppliers are set inactive, never deleted)');
    await guarded(asSuper(`TRUNCATE platform_reset_gate`, 'reset'), 'TRUNCATE on platform_reset_gate is not allowed (the gate is one row, kept for good)');
    // A partly kept table's DELETE passes the guard (a reward given: the reset never deletes one, its proof says so).
    await run(`UPDATE vault_rewards SET given = 0 WHERE kind = 'I_WAS_THERE'`);
    await guarded(run(`DELETE FROM vault_rewards WHERE kind = 'I_WAS_THERE'`), 'DELETE on vault_rewards is not allowed (the I WAS THERE floor and a reward given are never deleted, only made inactive)');
    expect((await asSuper(`DELETE FROM vault_rewards WHERE kind = 'I_WAS_THERE' RETURNING kind`, 'reset')).length).toBe(1);
    // The app's role, the setting set: refused (it is no superuser); TRUNCATE is not even granted.
    await guarded(asApp(`DELETE FROM audit_logs WHERE id = ${a}`, 'reset'), appendOnly('DELETE'), 'the app');
    await expect(asApp(`TRUNCATE partners`, 'reset')).rejects.toThrow(/permission denied/);
    expect(await asSuper(`TRUNCATE product_status_history`, 'reset')).toEqual([]);
    await expect(asApp(`TRUNCATE audit_logs`, 'reset')).rejects.toThrow(/permission denied/);
    // The purge's way unchanged: a DELETE on its five, by a superuser.
    expect(await asSuper(`DELETE FROM audit_logs WHERE id = ${a} RETURNING id`, 'purge')).toEqual([{ id: a }]);
    expect(await count(`audit_logs WHERE id = ${a}`)).toBe(1);
    // The setting never outlives its transaction.
    expect((await one<{ v: string | null }>(`SELECT current_setting('orbes.guard_bypass', true) AS v`)).v ?? '').toBe('');
  });

  it('every guard use of orbes_reject_mutation outside the reset\'s tables refuses as before, with its own words, the setting reset set as the superuser', async () => {
    const uses = await all<{ tbl: string; tgname: string; tgtype: number; kind: string }>(`
      SELECT c.relname AS tbl, t.tgname, t.tgtype, coalesce(p.kind, 'NONE') AS kind
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN platform_reset_plan p ON p.tbl = c.relname
       WHERE NOT t.tgisinternal AND t.tgfoid = 'orbes_reject_mutation'::regproc AND n.nspname = 'public'
       ORDER BY 1, 2`);
    // 0065's 57, 0066's two and the gate's one.
    expect(uses).toHaveLength(60);
    expect(uses.every((u) => u.kind !== 'NONE')).toBe(true);
    // A guard on a kept table refuses its DELETE and TRUNCATE whatever the setting; every UPDATE guard refuses too.
    for (const u of uses) {
      const update = (u.tgtype & 16) === 16;
      const remove = (u.tgtype & 8) === 8;
      const truncate = (u.tgtype & 32) === 32;
      if (u.kind === 'KEEP') expect(remove || truncate || update, u.tgname).toBe(true);
    }
    const src = (await one<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'orbes_reject_mutation'`)).src;
    expect(src).toContain(`p.kind = 'WIPE' OR (TG_OP = 'DELETE' AND p.kind = 'PARTLY')`);
    expect(src).toContain(`TG_OP IN ('DELETE', 'TRUNCATE')`);
  });

  it('the plan and the gate: written by a superuser only; the gate one row, LOCK RESET one way, the holder fixed once launched, the count never down, its CHECKs', async () => {
    const plan = await all<{ tbl: string; kind: string }>(`SELECT tbl, kind FROM platform_reset_plan ORDER BY tbl`);
    expect(Object.fromEntries(plan.map((p) => [p.tbl, p.kind]))).toEqual(RESET_PLAN);
    const planWords = "the reset's plan is written by the migrations only";
    await guarded(asApp(`INSERT INTO platform_reset_plan (tbl, kind) VALUES ('t67', 'KEEP')`), `INSERT on platform_reset_plan is not allowed (${planWords})`);
    await guarded(asApp(`UPDATE platform_reset_plan SET kind = 'KEEP' WHERE tbl = 'accounts'`), `UPDATE on platform_reset_plan is not allowed (${planWords})`);
    await guarded(asApp(`DELETE FROM platform_reset_plan WHERE tbl = 'accounts'`), `DELETE on platform_reset_plan is not allowed (${planWords})`);
    await expect(asApp(`TRUNCATE platform_reset_plan`)).rejects.toThrow(/permission denied/);

    const gateWords = (op: string) => `${op} on platform_reset_gate is not allowed (written by the reset functions only)`;
    await guarded(asApp(`UPDATE platform_reset_gate SET resets = 5, last_reset_at = now(), last_reset_by = NULL`), gateWords('UPDATE'));
    await guarded(asApp(`UPDATE platform_reset_gate SET holder_admin_id = NULL`), gateWords('UPDATE'));
    await guarded(asApp(`DELETE FROM platform_reset_gate`), gateWords('DELETE'));
    await guarded(asApp(`INSERT INTO platform_reset_gate (id) VALUES (1)`), gateWords('INSERT'));
    await guarded(run(`DELETE FROM platform_reset_gate`), 'DELETE on platform_reset_gate is not allowed (the gate is one row, kept for good)');
    expect(await count('platform_reset_gate')).toBe(1);
    // One row only; its CHECKs.
    await expect(run(`INSERT INTO platform_reset_gate (id) VALUES (2)`)).rejects.toSatisfy((e) => pgError(e)?.code === '23514');
    const holder = await admin({ email: 'gate-holder@orbes.test', at: '2020-01-01T00:00:00Z' });
    for (const [set, constraint] of [
      [`launched_at = now()`, 'platform_reset_gate_launched'],
      [`authorized_by = '${holder}'`, 'platform_reset_gate_authorized'],
      [`authorized_by = '${holder}', authorized_at = now(), authorized_purpose = 'test_run.purge_all'`, 'platform_reset_gate_authorized_purpose_check'],
      [`resets = 1`, 'platform_reset_gate_last_reset'],
      [`last_reset_at = now(), last_reset_by = '${holder}', resets = 1`, 'platform_reset_gate_last_reset'],
      [`last_reset_at = now(), last_reset_by = '${holder}', resets = 1, last_reset_details = '[]'`, 'platform_reset_gate_last_reset_details_check'],
    ] as const) {
      await expect(rolledBack((tx) => sql.raw(`UPDATE platform_reset_gate SET ${set}`).execute(tx)), set).rejects.toSatisfy((e) => pgError(e)?.code === '23514' && pgError(e)?.constraint === constraint);
    }
    // LOCK RESET one way; the holder fixed once launched; the count never down (as the superuser itself).
    await rolledBack(async (tx) => {
      await sql.raw(`UPDATE platform_reset_gate SET holder_admin_id = '${holder}', last_reset_at = now(), last_reset_by = '${holder}', resets = 2, last_reset_details = '{}'`).execute(tx);
      await expect(sql.raw(`UPDATE platform_reset_gate SET resets = 1`).execute(tx)).rejects.toSatisfy(isGuardViolation);
    });
    await rolledBack(async (tx) => {
      await sql.raw(`UPDATE platform_reset_gate SET holder_admin_id = '${holder}', launched_at = now(), launched_by = '${holder}'`).execute(tx);
      const words = 'UPDATE on platform_reset_gate is not allowed (LOCK RESET is one way: the lock and the holder never change once it is pressed)';
      for (const set of [`launched_at = NULL, launched_by = NULL`, `launched_at = now() + interval '1 day'`, `holder_admin_id = NULL`]) {
        await sql`SAVEPOINT s`.execute(tx);
        await expect(sql.raw(`UPDATE platform_reset_gate SET ${set}`).execute(tx), set).rejects.toSatisfy((e) => isGuardViolation(e) && (e as Error).message === words);
        await sql`ROLLBACK TO SAVEPOINT s`.execute(tx);
      }
    });
    expect((await gate()).holder_admin_id).toBeNull();
  });

  it('the holder: the oldest active ADMIN with two-factor authentication at the migration, NULL when none; recorded again only by a migration', async () => {
    // Below 0067: the admins that exist when it is applied (those of the cases above disabled first: none qualifies).
    expect(await downTo0066(db())).toEqual([NAME]);
    await run(`UPDATE admin_users SET disabled_at = now() WHERE disabled_at IS NULL`);
    const ids: string[] = [];
    ids.push(await admin({ email: 'h-no-totp@orbes.test', totp: false, at: '2019-01-01T00:00:00Z' }));
    ids.push(await admin({ email: 'h-operator@orbes.test', role: 'OPERATOR', at: '2019-01-02T00:00:00Z' }));
    ids.push(await admin({ email: 'h-disabled@orbes.test', disabled: true, at: '2019-01-03T00:00:00Z' }));
    expect((await migrateToLatest(db())).applied).toEqual([NAME]);
    expect((await gate()).holder_admin_id).toBeNull();
    expect(await downTo0066(db())).toEqual([NAME]);
    const second = await admin({ email: 'h-second@orbes.test', at: '2019-01-05T00:00:00Z' });
    const first = await admin({ email: 'h-first@orbes.test', at: '2019-01-04T00:00:00Z' });
    expect((await migrateToLatest(db())).applied).toEqual([NAME]);
    expect((await gate()).holder_admin_id).toBe(first);
    // The tables made again: the app's grants given again, as lib.sh gives them after every migration.
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    // Fixed forward only: an ADMIN made later never becomes the holder; the app cannot name another.
    await admin({ email: 'h-later@orbes.test', at: '2018-01-01T00:00:00Z' });
    expect((await gate()).holder_admin_id).toBe(first);
    await guarded(asApp(`UPDATE platform_reset_gate SET holder_admin_id = '${second}'`), 'UPDATE on platform_reset_gate is not allowed (written by the reset functions only)');
    // Back to no holder for the cases below (they name their own).
    await run(`UPDATE platform_reset_gate SET holder_admin_id = NULL`);
  });

  it('the definer functions: SECURITY DEFINER, owned by a superuser, their exact settings, exactly the lot\'s; the numbering locks\' helper out of PUBLIC\'s reach; the app reaches each first refusal, never a permission error', async () => {
    const definers = await all<{ name: string; su: boolean; config: string[] }>(`
      SELECT p.proname AS name, r.rolsuper AS su, p.proconfig AS config
        FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef ORDER BY 1`);
    const purge = [PATH, 'lock_timeout=2s', 'orbes.guard_bypass=purge'];
    const writer = [PATH, 'lock_timeout=5s'];
    expect(definers).toEqual([
      { name: 'orbes_platform_reset', su: true, config: [PATH, 'lock_timeout=5s', 'orbes.guard_bypass=reset'] },
      { name: 'orbes_platform_reset_authorize', su: true, config: writer },
      { name: 'orbes_platform_reset_lock', su: true, config: writer },
      // The precheck carries no bypass and no lock timeout: a call to it proves nothing about the bypass (H7).
      { name: 'orbes_platform_reset_precheck', su: true, config: [PATH] },
      { name: 'orbes_platform_reset_unauthorize', su: true, config: writer },
      { name: 'orbes_purge_test_pool_batch', su: true, config: purge },
      { name: 'orbes_purge_test_run_batch', su: true, config: purge },
    ]);
    const can = async (fn: string) => (await one<{ ok: boolean }>(`SELECT has_function_privilege('${APP_ROLE}', '${fn}', 'EXECUTE') AS ok`)).ok;
    for (const fn of [
      'orbes_platform_reset(uuid, int, timestamptz)',
      'orbes_platform_reset_precheck(uuid, int, timestamptz)',
      'orbes_platform_reset_authorize(uuid, text)',
      'orbes_platform_reset_unauthorize()',
      'orbes_platform_reset_lock(uuid)',
    ]) {
      expect(await can(fn), fn).toBe(true);
    }
    expect(await can('orbes_platform_reset_numbering_locks(int)')).toBe(false);
    await expect(asApp(`SELECT * FROM orbes_platform_reset_numbering_locks(2026)`)).rejects.toThrow(/permission denied/);
    // Called by the app's role, each runs as its owner: its first refusal (no holder here), not a permission error.
    await run(`UPDATE platform_reset_gate SET holder_admin_id = NULL`);
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect(await asApp(`SELECT orbes_platform_reset_precheck('${nobody}') AS r`)).toEqual([{ r: 'NO_HOLDER' }]);
    await refused(asApp(`SELECT orbes_platform_reset('${nobody}', 0, NULL)`), 'RESET_NO_HOLDER');
    await refused(asApp(`SELECT orbes_platform_reset_lock('${nobody}')`), 'RESET_NO_HOLDER');
    await refused(asApp(`SELECT orbes_platform_reset_authorize('${nobody}', 'platform.reset')`), 'RESET_NO_HOLDER');
    await refused(asApp(`SELECT orbes_platform_reset_authorize('${nobody}', 'test_run.purge_all')`), 'RESET_NOT_AUTHORIZED');
    expect(await asApp(`SELECT orbes_platform_reset_unauthorize()`)).toHaveLength(1);
    // The start guards: replica mode refused first (the superuser here; the app cannot set it).
    await refused(
      rolledBack(async (tx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(tx);
        await sql.raw(`SELECT orbes_platform_reset('${nobody}', 0, NULL)`).execute(tx);
      }),
      'RESET_REPLICA_MODE',
    );
  });

  it('the precheck: NO_HOLDER (none, or disabled, no longer ADMIN or without its second factor), NOT_HOLDER, LOCKED, WINDOW with a 5-minute margin, COLLECTORS_CHANGED; NULL when allowed', async () => {
    const restore = await windowsAs(db());
    try {
      const holder = await admin({ email: 'pre-holder@orbes.test' });
      const other = await admin({ email: 'pre-other@orbes.test' });
      const pre = async (who: string, seen: number | null = null, until: string | null = null, on?: Db) =>
        (await one<{ r: string | null }>(`SELECT orbes_platform_reset_precheck('${who}', ${seen ?? 'NULL'}, ${until ? `'${until}'` : 'NULL'}) AS r`, on)).r;
      await run(`UPDATE platform_reset_gate SET holder_admin_id = NULL`);
      expect(await pre(holder)).toBe('NO_HOLDER');
      await run(`UPDATE platform_reset_gate SET holder_admin_id = '${holder}'`);
      expect(await pre(holder)).toBeNull();
      expect(await pre(other)).toBe('NOT_HOLDER');
      for (const set of [`disabled_at = now()`, `role = 'OPERATOR'`, `totp_secret_enc = NULL`]) {
        expect(await rolledBack(async (tx) => {
          await sql.raw(`UPDATE admin_users SET ${set} WHERE id = '${holder}'`).execute(tx);
          return pre(holder, null, null, tx);
        }), set).toBe('NO_HOLDER');
      }
      expect(await rolledBack(async (tx) => {
        await sql.raw(`UPDATE platform_reset_gate SET launched_at = now(), launched_by = '${holder}'`).execute(tx);
        return pre(holder, null, null, tx);
      })).toBe('LOCKED');
      // A window now, and only the margin's end in one: both refused; 6 minutes ahead: allowed.
      await windowsAs(db(), `'NIGHT'::text`);
      expect(await pre(holder)).toBe('WINDOW');
      await windowsAs(db(), `CASE WHEN p_at > now() + interval '30 seconds' THEN 'BACKUP' END`);
      expect(await pre(holder)).toBe('WINDOW');
      await windowsAs(db(), `CASE WHEN p_at > now() + interval '6 minutes' THEN 'BACKUP' END`);
      expect(await pre(holder)).toBeNull();
      await windowsAs(db());
      // The collectors (counted as GROWTH counts them): more than seen, or one signed up after the newest seen.
      const n = await count(`accounts a WHERE a.status <> 'DELETED' AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = a.id) AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.email_normalized = a.email_normalized)`);
      const newest = (await one<{ m: string | null }>(`SELECT max(created_at)::text AS m FROM accounts`)).m;
      expect(await pre(holder, n, newest)).toBeNull();
      await run(`INSERT INTO accounts (email, email_normalized, password_hash, created_at) VALUES ('pre-c1@example.com', 'pre-c1@example.com', 'x', '2024-01-01T00:00:00Z')`);
      expect(await pre(holder, n, newest)).toBe('COLLECTORS_CHANGED');
      expect(await pre(holder, n + 1, newest ?? '2024-01-01T00:00:00Z')).toBeNull();
      expect(await pre(holder, n + 1, null)).toBe('COLLECTORS_CHANGED');
      expect(await pre(holder, -1, null)).toBe('COLLECTORS_CHANGED');
      await run(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('pre-c2@example.com', 'pre-c2@example.com', 'x')`);
      await run(`UPDATE accounts SET status = 'DELETED' WHERE email_normalized = 'pre-c1@example.com'`);
      // One deletion and one sign-up: the count is equal, the sign-up is after the newest seen (G18).
      expect(await pre(holder, n + 1, newest ?? '2024-01-01T00:00:00Z')).toBe('COLLECTORS_CHANGED');
      await run(`UPDATE platform_reset_gate SET holder_admin_id = NULL`);
    } finally {
      await restore();
    }
  });

  it('the authorization: only in the transaction that consumed the holder\'s step-up for its purpose and audited the request; every other refusal; unauthorize clears it', async () => {
    const holder = await admin({ email: 'auth-holder@orbes.test' });
    const other = await admin({ email: 'auth-other@orbes.test' });
    await run(`UPDATE platform_reset_gate SET holder_admin_id = '${holder}'`);
    const row = (tx: Db, o: { action: string; actor?: string; target?: string; details?: object }) =>
      sql.raw(`INSERT INTO audit_logs (occurred_at, actor_type, actor_id, action, target_type, target_id, details, prev_hash, hash)
               VALUES (now(), 'admin', '${o.actor ?? holder}', '${o.action}', 'admin', '${o.target ?? holder}', '${JSON.stringify(o.details ?? {})}'::jsonb,
                       sha256(convert_to(gen_random_uuid()::text, 'UTF8')), sha256(convert_to(gen_random_uuid()::text, 'UTF8')))`).execute(tx);
    const touch = (tx: Db, id = holder) => sql.raw(`UPDATE admin_users SET failed_logins = 0 WHERE id = '${id}'`).execute(tx);
    const authorize = (tx: Db, who = holder, purpose = 'platform.reset') => sql.raw(`SELECT orbes_platform_reset_authorize('${who}', '${purpose}')`).execute(tx);
    const steps: [string, (tx: Db) => Promise<unknown>, string][] = [
      ['no step-up in this transaction', async (tx) => authorize(tx), 'RESET_NOT_AUTHORIZED'],
      ['the admin row not updated', async (tx) => { await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } }); await row(tx, { action: 'platform.reset.requested' }); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['a step-up for LOCK RESET', async (tx) => { await touch(tx); await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset.lock' } }); await row(tx, { action: 'platform.reset.requested' }); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['a purge\'s step-up', async (tx) => { await touch(tx); await row(tx, { action: 'admin.step_up', details: { purpose: 'test_run.purge_all' } }); await row(tx, { action: 'platform.reset.requested' }); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['another admin\'s step-up', async (tx) => { await touch(tx, other); await row(tx, { action: 'admin.step_up', actor: other, target: other, details: { purpose: 'platform.reset' } }); await row(tx, { action: 'platform.reset.requested', actor: other }); await touch(tx); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['no request audited', async (tx) => { await touch(tx); await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } }); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['the request before the step-up', async (tx) => { await touch(tx); await row(tx, { action: 'platform.reset.requested' }); await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } }); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['the request of LOCK RESET', async (tx) => { await touch(tx); await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } }); await row(tx, { action: 'platform.reset.lock.requested' }); await authorize(tx); }, 'RESET_NOT_AUTHORIZED'],
      ['not the holder', async (tx) => { await touch(tx, other); await row(tx, { action: 'admin.step_up', actor: other, target: other, details: { purpose: 'platform.reset' } }); await row(tx, { action: 'platform.reset.requested', actor: other }); await authorize(tx, other); }, 'RESET_NOT_HOLDER'],
      ['the holder disabled', async (tx) => { await sql.raw(`UPDATE admin_users SET disabled_at = now() WHERE id = '${holder}'`).execute(tx); await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } }); await row(tx, { action: 'platform.reset.requested' }); await authorize(tx); }, 'RESET_NO_HOLDER'],
      ['launched', async (tx) => { await sql.raw(`UPDATE platform_reset_gate SET launched_at = now(), launched_by = '${holder}'`).execute(tx); await touch(tx); await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } }); await row(tx, { action: 'platform.reset.requested' }); await authorize(tx); }, 'RESET_LOCKED'],
    ];
    for (const [label, body, reason] of steps) await refused(rolledBack(body), reason, label);
    // Earlier transactions' rows never count: a step-up committed before, then only the request in a new one.
    await inTransaction(db(), async (tx) => {
      await touch(tx);
      await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } });
    });
    await refused(rolledBack(async (tx) => { await touch(tx); await row(tx, { action: 'platform.reset.requested' }); await authorize(tx); }), 'RESET_NOT_AUTHORIZED', 'a step-up of another transaction');
    expect((await gate()).authorized_by).toBeNull();
    // The right transaction: written, then cleared by unauthorize.
    await inTransaction(db(), async (tx) => {
      await touch(tx);
      await row(tx, { action: 'admin.step_up', details: { purpose: 'platform.reset' } });
      await row(tx, { action: 'platform.reset.requested', details: { collectorsSeen: 0 } });
      await authorize(tx);
    });
    expect(await gate()).toMatchObject({ authorized_by: holder, authorized_purpose: 'platform.reset', authorized_at: expect.any(Date) });
    await run(`SELECT orbes_platform_reset_unauthorize()`);
    expect(await gate()).toMatchObject({ authorized_by: null, authorized_at: null, authorized_purpose: null });
    await run(`UPDATE platform_reset_gate SET holder_admin_id = NULL`);
  });
}

describe('migration 0067_platform_reset (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  cases({
    db: () => t.db,
    schemaAt0066: async () => {
      const fresh = await createTestDb({ migrated: false });
      try {
        const rs = await createMigrator(fresh.db).migrateTo(BEFORE);
        if (rs.error) throw rs.error;
        return await snapshotOf(fresh.db);
      } finally {
        await fresh.close();
      }
    },
  });
});

describe.skipIf(!pgUrl)('migration 0067_platform_reset (PostgreSQL)', () => {
  let admin: Db;
  let db: Db;
  const dbName = `orbes_t_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = createDb(pgUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(pgUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 4 });
    await migrateToLatest(db);
  }, 120_000);
  afterAll(async () => {
    if (db) {
      await sql.raw(`DROP OWNED BY ${APP_ROLE}`).execute(db).catch(() => undefined);
      await closeDb(db).catch(() => undefined);
    }
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await sql.raw(`DROP ROLE IF EXISTS ${APP_ROLE}`).execute(admin).catch(() => undefined);
      await closeDb(admin);
    }
  });
  cases({ db: () => db, schemaAt0066: async () => null });
});

/**
 * On PGlite, with the app's own services: the precheck on real fixtures, a reset end to end on a small platform, its
 * locks, a failed last proof, LOCK RESET, and down refused after them.
 */
describe('migration 0067_platform_reset: the reset end to end (PGlite)', () => {
  let h: Harness;
  let f: LiveFixture;
  let restore: () => Promise<void>;
  const HOUR = 3_600_000;
  beforeAll(async () => {
    h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    f = await liveFixtureOn(h.ctx, h.clock);
    restore = await windowsAs(h.ctx.db);
    // The holder: the fixture's ADMIN, given a second factor (its sealed value is never read here).
    await sql`UPDATE admin_users SET totp_secret_enc = 'sealed' WHERE id = ${f.admin.id}`.execute(h.ctx.db);
    await sql`UPDATE platform_reset_gate SET holder_admin_id = ${f.admin.id}`.execute(h.ctx.db);
  }, 120_000);
  afterAll(async () => {
    await restore?.();
    await h?.close();
  });
  const q = async <T,>(s: string, on?: Db) => (await sql.raw<T>(s).execute(on ?? h.ctx.db)).rows;
  const n = async (from: string) => Number((await q<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`))[0]!.n);
  const precheck = async (seen: number | null = null, until: string | null = null) =>
    (await q<{ r: string | null }>(`SELECT orbes_platform_reset_precheck('${f.admin.id}', ${seen ?? 'NULL'}, ${until ? `'${until}'` : 'NULL'}) AS r`))[0]!.r;
  const seen = async () => {
    const r = (await q<{ n: string | number; m: string | null }>(`SELECT count(*) AS n, max(a.created_at)::text AS m FROM accounts a WHERE ${'a.status <> \'DELETED\''}
       AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = a.id) AND NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.email_normalized = a.email_normalized)`))[0]!;
    return { n: Number(r.n), until: r.m };
  };
  /** The request's transaction as PlatformResetService writes it (PURGE.10): the step-up consumed and audited, the request, the authorization. */
  const authorize = (purpose: 'platform.reset' | 'platform.reset.lock') =>
    inTransaction(h.ctx.db, async (tx) => {
      await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', f.admin.id).execute();
      await h.ctx.audit.record({ actor: f.admin, action: 'admin.step_up', targetType: 'admin', targetId: f.admin.id, details: { purpose } }, tx);
      await h.ctx.audit.record({ actor: f.admin, action: `${purpose}.requested`, targetType: 'admin', targetId: f.admin.id, details: {} }, tx);
      await sql`SELECT orbes_platform_reset_authorize(${f.admin.id}::uuid, ${purpose})`.execute(tx);
    });
  const reset = (s: { n: number; until: string | null }, inside?: (tx: Db) => Promise<void>) =>
    inTransaction(h.ctx.db, async (tx) => {
      const r = (await sql<{ r: Record<string, any> }>`SELECT orbes_platform_reset(${f.admin.id}::uuid, ${s.n}::int, ${s.until}::timestamptz) AS r`.execute(tx)).rows[0]!.r;
      await inside?.(tx);
      return r;
    });
  const refusedWith = (p: Promise<unknown>, reason: string) =>
    expect(p, reason).rejects.toSatisfy((e) => {
      if (resetRefusal(e) !== reason) throw new Error(`expected ${reason}, got ${pgError(e)?.code} ${(e as Error).message}`);
      return true;
    });

  it('the precheck on the app\'s own fixtures: a test running, a LIVE room open; the collectors counted exactly as population.ts countedCollector counts them', async () => {
    const db = h.ctx.db;
    expect(await precheck()).toBeNull();
    // A test running on a draw.
    const now = Date.now();
    const draw = (await poolDraw(h.ctx.services.drops, db, { modelId: f.modelId, title: 'MONOLITHE · T67', quantity: 2, opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR), earlyAccessHours: 0 }, f.admin)).id;
    const runId = (await q<{ id: string }>(`INSERT INTO test_runs (drop_id, mode, settings, entrants, created_by) VALUES ('${draw}', 'DRAW', '[]', 0, '${f.admin.id}') RETURNING id`))[0]!.id;
    expect(await precheck()).toBe('TEST_RUNNING');
    await refusedWith(reset(await seen()), 'RESET_NOT_AUTHORIZED');
    await q(`UPDATE test_runs SET status = 'ENDED', ended_at = now(), ended_by = '${f.admin.id}' WHERE id = '${runId}'`);
    expect(await precheck()).toBeNull();
    // A LIVE room open: its room opened (5 minutes before T0), not ended.
    const live = await createLiveRelease(f, { opensAt: new Date(Date.now() + 2 * 60_000), roomOpensMinutes: 5 });
    expect(await precheck()).toBe('LIVE_OPEN');
    await q(`UPDATE drops SET opens_at = now() + interval '6 minutes', closes_at = now() + interval '2 hours' WHERE id = '${live.id}'`);
    expect(await precheck()).toBeNull();
    await q(`UPDATE drops SET opens_at = now() + interval '1 minute' WHERE id = '${live.id}'`);
    expect(await precheck()).toBe('LIVE_OPEN');
    await q(`UPDATE drops SET cancelled_at = now() WHERE id = '${live.id}'`);
    expect(await precheck()).toBeNull();
    // The collectors: a person, a deleted account, a test entrant, the team's own account: one counted.
    const person = await createAccount(db);
    const gone = await createAccount(db);
    await q(`UPDATE accounts SET status = 'DELETED' WHERE id = '${gone.id}'`);
    const bot = await createAccount(db);
    await q(`INSERT INTO test_entrants (account_id) VALUES ('${bot.id}')`);
    const email = (await q<{ e: string }>(`SELECT email_normalized AS e FROM admin_users WHERE id = '${f.admin.id}'`))[0]!.e;
    await q(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('${email}', '${email}', 'x')`);
    const growth = Number((await db.selectFrom('accounts').select((eb) => eb.fn.countAll<number>().as('n')).where(countedCollector('accounts.id') as never).executeTakeFirstOrThrow()).n);
    const s = await seen();
    expect(s.n).toBe(growth);
    expect(growth).toBeGreaterThanOrEqual(1);
    expect(await precheck(s.n, s.until)).toBeNull();
    expect(await precheck(s.n - 1, s.until)).toBe('COLLECTORS_CHANGED');
    expect(person.id).toBeTruthy();
  });

  it('a reset end to end: wiped, kept, kept in part by rule; the locks held to the commit; the gate\'s own four columns; the capture; the authorization used once; down refused after it', async () => {
    const db = h.ctx.db;
    // A small platform: an invitation chain, a founding-list address on a release's link (kept, re-pointed), another
    // release link and its source (wiped), segments, revocations, a reward given, some audit history.
    const inviter = await createAccount(db);
    const invitee = await createAccount(db);
    await q(`UPDATE accounts SET invited_by = '${inviter.id}', invited_at = now() WHERE id = '${invitee.id}'`);
    const release = await createLiveRelease(f, { opensAt: new Date(Date.now() + 3 * 24 * HOUR) });
    const channel = (await q<{ id: string }>(`INSERT INTO link_channels (name) VALUES ('T67 CHANNEL') RETURNING id`))[0]!.id;
    const link = async (code: string) =>
      (await q<{ id: string }>(`INSERT INTO links (code, name, channel_id, destination, drop_id, created_by) VALUES ('${code}', '${code}', '${channel}', 'RELEASE', '${release.id}', '${f.admin.id}') RETURNING id`))[0]!.id;
    const keptLink = await link('t67-kept');
    const goneLink = await link('t67-gone');
    const source = async (l: string) => (await q<{ id: number }>(`INSERT INTO acquisition_sources (kind, link_id, key) VALUES ('LINK', '${l}', 'link:${l}') RETURNING id`))[0]!.id;
    const keptSource = await source(keptLink);
    await source(goneLink);
    await q(`INSERT INTO preregistrations (email, email_normalized, first_name, country, consent_at, consent_version, source_id, account_id, matched_at)
             VALUES ('Founder@Example.com', 'founder@example.com', 'Ana', 'FR', now(), '2026-10-01', ${keptSource}, '${invitee.id}', now())`);
    const segment = async (name: string, criteria: object) => (await q<{ id: string }>(`INSERT INTO segments (name, criteria, created_by) VALUES ('${name}', '${JSON.stringify(criteria)}', '${f.admin.id}') RETURNING id`))[0]!.id;
    await segment('T67 TOOK PART', { all: [{ kind: 'TOOK_PART', dropId: release.id }] });
    await segment('T67 GONE LINK', { all: [{ kind: 'FIRST_SOURCE', linkIds: [goneLink] }] });
    const keptSegments = [await segment('T67 KEPT LINK', { all: [{ kind: 'FIRST_SOURCE', linkIds: [keptLink] }] }), await segment('T67 TIER', { all: [{ kind: 'TIER', min: 1 }] })];
    await q(`INSERT INTO revocations (target_type, target_id, reason_code, created_by) VALUES ('KEY', '1', 'ROTATED', 'admin'), ('CODE', 'x', 'LOST', 'admin')`);
    await q(`INSERT INTO vault_rewards (kind, odds_in, quantity, position) VALUES ('GUARANTEED', 200, 3, 1)`);
    await q(`UPDATE vault_rewards SET given = 2 WHERE kind = 'GUARANTEED'`);
    await h.ctx.audit.record({ actor: f.admin, action: 'admin.totp.enable', targetType: 'admin', targetId: f.admin.id, details: {} });
    const keptBefore = await q<{ t: string }>(`SELECT md5(string_agg(x::text, chr(10) ORDER BY x::text)) AS t FROM skus x`);
    const zeroReward = await q(`SELECT * FROM vault_rewards WHERE kind = 'I_WAS_THERE'`);
    const rewardBefore = (await q<Record<string, unknown>>(`SELECT * FROM vault_rewards WHERE kind = 'GUARANTEED'`))[0]!;
    const srcSeq = (await q<{ v: string | null }>(`SELECT last_value::text AS v FROM pg_sequences WHERE sequencename = 'acquisition_sources_id_seq'`))[0]!.v;
    const head = (await q<{ id: number; hash: string }>(`SELECT id, encode(hash, 'hex') AS hash FROM audit_logs ORDER BY id DESC LIMIT 1`))[0]!;
    const s = await seen();
    expect(s.n).toBeGreaterThan(0);

    // Refused without its authorization; then authorized and done, the locks it holds read inside its transaction.
    await refusedWith(reset(s), 'RESET_NOT_AUTHORIZED');
    await authorize('platform.reset.lock');
    await refusedWith(reset(s), 'RESET_NOT_AUTHORIZED');
    await q(`SELECT orbes_platform_reset_unauthorize()`);
    await authorize('platform.reset');
    let locks: { classid: number; objid: number; objsubid: number }[] = [];
    const result = await reset(s, async (tx) => {
      locks = (await sql<{ classid: number; objid: number; objsubid: number }>`SELECT classid::bigint::int AS classid, objid::bigint AS objid, objsubid::int AS objsubid FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`.execute(tx)).rows;
    });
    // 74 numbering and chain locks (2 one-key, 2 x 2 invoices, 2 x 2 partner invoices, 32 x 2 serials) and LIVE_ENGINE.
    expect(locks.filter((l) => l.objsubid === 2)).toHaveLength(72);
    expect(locks.filter((l) => l.objsubid === 1)).toHaveLength(3);

    // Wiped: every account (the invitation chain in one statement), every release, the audit log, the other link.
    for (const table of ['accounts', 'drops', 'audit_logs', 'drop_sizes', 'test_runs', 'segments WHERE id <> ALL (ARRAY[' + keptSegments.map((x) => `'${x}'::uuid`).join(', ') + '])']) {
      expect(await n(table), table).toBe(0);
    }
    expect(result.wiped.accounts).toBeGreaterThanOrEqual(4);
    expect(result.wiped.drops).toBeGreaterThanOrEqual(2);
    expect(Object.keys(result.wiped).sort()).toEqual(Object.entries(RESET_PLAN).filter(([, k]) => k === 'WIPE').map(([t]) => t).sort());
    expect(Object.keys(result.kept).sort()).toEqual(Object.entries(RESET_PLAN).filter(([, k]) => k === 'KEEP').map(([t]) => t).sort());
    expect(Object.keys(result.partly).sort()).toEqual(Object.entries(RESET_PLAN).filter(([, k]) => k === 'PARTLY').map(([t]) => t).sort());
    expect(result.sequencesRestarted).toEqual(expect.arrayContaining(['audit_logs_id_seq', 'event_journal_id_seq', 'order_events_id_seq', 'stock_movements_id_seq']));
    expect(result.sequencesRestarted).not.toContain('acquisition_sources_id_seq');
    expect((await q<{ v: string | null }>(`SELECT last_value::text AS v FROM pg_sequences WHERE sequencename = 'acquisition_sources_id_seq'`))[0]!.v).toBe(srcSeq);
    // Kept: the catalogue identical; the founding list with its account cleared; its source; its link re-pointed.
    expect(await q(`SELECT md5(string_agg(x::text, chr(10) ORDER BY x::text)) AS t FROM skus x`)).toEqual(keptBefore);
    expect(await q(`SELECT email_normalized, account_id, matched_at, source_id FROM preregistrations`)).toEqual([{ email_normalized: 'founder@example.com', account_id: null, matched_at: null, source_id: keptSource }]);
    expect(await q(`SELECT id FROM acquisition_sources`)).toEqual([{ id: keptSource }]);
    expect(await q(`SELECT id, destination, drop_id FROM links`)).toEqual([{ id: keptLink, destination: 'RELEASES', drop_id: null }]);
    expect((await q<{ id: string }>(`SELECT id FROM segments ORDER BY id`)).map((x) => x.id)).toEqual([...keptSegments].sort());
    expect(await q(`SELECT target_type FROM revocations`)).toEqual([{ target_type: 'KEY' }]);
    expect(await q(`SELECT * FROM vault_rewards WHERE kind = 'I_WAS_THERE'`)).toEqual(zeroReward);
    const rewardAfter = (await q<Record<string, unknown>>(`SELECT * FROM vault_rewards WHERE kind = 'GUARANTEED'`))[0]!;
    expect({ ...rewardAfter, given: undefined, updated_at: undefined }).toEqual({ ...rewardBefore, given: undefined, updated_at: undefined });
    expect(rewardAfter.given).toBe(0);
    // The gate: only its four columns; the capture with the old head, the TOTP enrolment, the request, recent24h.
    const g = (await q<Record<string, any>>(`SELECT * FROM platform_reset_gate`))[0]!;
    expect(g).toMatchObject({ holder_admin_id: f.admin.id, launched_at: null, launched_by: null, last_reset_by: f.admin.id, resets: 1, authorized_by: null, authorized_at: null, authorized_purpose: null });
    expect(g.last_reset_details.oldHead.id).toBeGreaterThan(head.id);
    expect(g.last_reset_details.totp).toMatchObject({ enabledAt: expect.any(String), enabledBy: f.admin.id, disabledAt: null, disabledBy: null });
    expect(g.last_reset_details.stepUpId).toBeLessThan(g.last_reset_details.requestId);
    expect(g.last_reset_details.recent24h).toEqual([{ action: 'admin.totp.enable', targetAdminId: f.admin.id, occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/) }]);
    expect(g.last_reset_details.capture.segmentsGone).toEqual(['T67 GONE LINK', 'T67 TOOK PART']);
    expect(g.last_reset_details.capture.logins).toEqual(expect.arrayContaining([expect.objectContaining({ email: expect.any(String), role: 'ADMIN', totp: true, status: 'active' })]));
    expect(result.capture).toEqual(g.last_reset_details.capture);
    // Nothing secret in what it kept: no password hash, no sealed second factor.
    expect(JSON.stringify(g.last_reset_details)).not.toMatch(/scrypt|sealed/);

    // Used once: the same authorization refused; down refused, naming the reset.
    await refusedWith(reset(await seen()), 'RESET_NOT_AUTHORIZED');
    const down = await createMigrator(db).migrateTo(BEFORE);
    expect(String(down.error)).toContain('migration 0067_platform_reset cannot be rolled back: 1 platform resets done and LOCK RESET not pressed');
  }, 120_000);

  it('a failed proof rolls everything back: OR020 naming the check, the gate and every row as before, the authorization given back', async () => {
    await createAccount(h.ctx.db);
    const before = { accounts: await n('accounts'), gate: (await q(`SELECT * FROM platform_reset_gate`))[0] };
    await authorize('platform.reset');
    const authorized = (await q(`SELECT * FROM platform_reset_gate`))[0];
    // The last proof reads the clock now: a window that opens after the transaction's start.
    // (A window from just after the transaction's start: its checks at the start, now() and now() + 5 minutes, pass.)
    const back = await windowsAs(h.ctx.db, `CASE WHEN p_at > now() AND p_at < now() + interval '1 minute' THEN 'NIGHT' END`);
    try {
      await expect(reset(await seen())).rejects.toSatisfy((e) => {
        expect(pgError(e)?.code).toBe(PG_ERROR.RESET_PROOF_FAILED);
        expect(resetRefusal(e)).toBe('RESET_PROOF_FAILED');
        expect((e as { detail?: string }).detail).toContain('inside a forbidden window now (NIGHT)');
        return true;
      });
    } finally {
      await back();
      await windowsAs(h.ctx.db);
    }
    expect(await n('accounts')).toBe(before.accounts);
    expect((await q(`SELECT * FROM platform_reset_gate`))[0]).toEqual(authorized);
    await q(`SELECT orbes_platform_reset_unauthorize()`);
    expect((await q(`SELECT * FROM platform_reset_gate`))[0]).toEqual(before.gate);
  }, 120_000);

  it('LOCK RESET: only with its own authorization, once; then every reset and lock refused, the lock and the holder fixed, down refused', async () => {
    await refusedWith(inTransaction(h.ctx.db, (tx) => sql`SELECT orbes_platform_reset_lock(${f.admin.id}::uuid)`.execute(tx)), 'RESET_NOT_AUTHORIZED');
    await authorize('platform.reset');
    await refusedWith(inTransaction(h.ctx.db, (tx) => sql`SELECT orbes_platform_reset_lock(${f.admin.id}::uuid)`.execute(tx)), 'RESET_NOT_AUTHORIZED');
    await q(`SELECT orbes_platform_reset_unauthorize()`);
    await inTransaction(h.ctx.db, async (tx) => {
      await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', f.admin.id).execute();
      await h.ctx.audit.record({ actor: f.admin, action: 'admin.step_up', targetType: 'admin', targetId: f.admin.id, details: { purpose: 'platform.reset.lock' } }, tx);
      await h.ctx.audit.record({ actor: f.admin, action: 'platform.reset.lock.requested', targetType: 'admin', targetId: f.admin.id, details: {} }, tx);
      await sql`SELECT orbes_platform_reset_authorize(${f.admin.id}::uuid, 'platform.reset.lock')`.execute(tx);
      await sql`SELECT orbes_platform_reset_lock(${f.admin.id}::uuid)`.execute(tx);
    });
    const g = (await q<Record<string, unknown>>(`SELECT * FROM platform_reset_gate`))[0]!;
    expect(g).toMatchObject({ launched_by: f.admin.id, launched_at: expect.any(Date), authorized_by: null, resets: 1 });
    expect(await precheck()).toBe('LOCKED');
    await refusedWith(authorize('platform.reset'), 'RESET_LOCKED');
    await refusedWith(reset(await seen()), 'RESET_LOCKED');
    await refusedWith(inTransaction(h.ctx.db, (tx) => sql`SELECT orbes_platform_reset_lock(${f.admin.id}::uuid)`.execute(tx)), 'RESET_LOCKED');
    await expect(q(`UPDATE platform_reset_gate SET launched_at = NULL, launched_by = NULL`)).rejects.toSatisfy(isGuardViolation);
    await expect(q(`UPDATE platform_reset_gate SET holder_admin_id = NULL`)).rejects.toSatisfy(isGuardViolation);
    const down = await createMigrator(h.ctx.db).migrateTo(BEFORE);
    expect(String(down.error)).toContain('migration 0067_platform_reset cannot be rolled back: 1 platform resets done and LOCK RESET pressed');
  }, 120_000);
});
