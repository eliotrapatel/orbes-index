/**
 * Migration 0066_test_purge (lot PURGE, step PURGE.2; plan §A.1 to §A.3 and §W): the guards' one way through for the
 * purge, the purge's columns of test_runs with their guard, the tombstones, step 10's list and the plan, the forbidden
 * windows and the two definer functions; on PGlite here and on a real PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL,
 * a throwaway database; skipped without it), the same cases on both, each with a throwaway NOSUPERUSER role standing
 * for the app (lib.sh's grants: DML on every table, nothing else):
 *  - down to 0065 without rows: exactly the schema of 0065 (PGlite: against a database migrated to 0065 alone), 0001's
 *    orbes_reject_mutation back byte for byte, and up again the latest;
 *  - the 57 guard uses of orbes_reject_mutation refuse as before, each with its own words, with the setting or without;
 *    the way through only for a DELETE, purpose `purge`, on the five tables of public, by a superuser: an UPDATE never,
 *    a TRUNCATE never, another table never, the setting required, the app's role never;
 *  - the definer functions: SECURITY DEFINER, owned by a superuser, their exact settings; the only definer functions of
 *    public; the helpers out of PUBLIC's reach;
 *  - the plan: purge_delete_tables and orbes_purge_plan() equal db/purge-plan.ts, which classes every foreign key the
 *    purge meets (pg_constraint), the owner-column rule (H11), the bypass list;
 *  - test_runs: each new column's CHECK and write-once rule, the one-way state, NULL -> PURGING only in a step-up's own
 *    transaction, the step-up id set by the database whatever is sent, the windows written once and never by the app;
 *  - the tombstones: written by a superuser only, append-only;
 *  - the windows: the SQL copy equals services/maintenance-window.ts minute by minute (margins 0, 1 and 5 minutes);
 *  - the functions' first refusals; down refused while a tombstone or a purge exists, naming the counts.
 * A purge of a real test run end to end (PGlite) closes the file; the full proof on seeded runs is PURGE.4's.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import { isCheckViolation, isGuardViolation, pgError, purgeRefusal } from '../../src/server/db/pg-errors.js';
import { PURGE_BLOCK_BY_NAME, PURGE_DELETE_TABLES, PURGE_GUARDED_TABLES, PURGE_REFERENCES, PURGE_ROW_TABLES, purgeReferenceKey } from '../../src/server/db/purge-plan.js';
import { TEST_RUN_PURGE_STATES } from '../../src/server/db/schema.js';
import { maintenanceWindow } from '../../src/server/services/maintenance-window.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { jsonText } from '../../src/server/db/schema.js';
import { testPhrase } from '../../src/server/services/test-entrants.js';
import { toHex } from '../../src/core/bytes.js';
import { createHarness, type Harness } from '../api/support.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';

const BEFORE = '0065_ad_conversions';
const NAME = '0066_test_purge';
const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
const APP_ROLE = `orbes_t66_${randomBytes(4).toString('hex')}`;

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

/** Down to 0065 (0066 reverted). */
async function downTo0065(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** What names an object of 0066 in a snapshot. */
const of0066 = (o: string) =>
  /\b(audit_purge_gaps|purge_delete_tables|test_runs_purge_\w+|purge_(state|requested_at|requested_by|summary|step_up_id|windows|reason|result)|purged_at|orbes_require_superuser|orbes_test_runs_purge_guard|orbes_purge_\w+|orbes_maintenance_window\w*|orbes_reject_mutation)\b/.test(o);
/** A NOT NULL's own constraint entry: PGlite's PostgreSQL lists it among the constraints, PostgreSQL 16 does not. */
const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);

const ZERO = '\\x' + '00'.repeat(32);

/** A trigger argument as encode(…, 'escape') gives it: octal escapes for the bytes beyond ASCII, back to UTF-8. */
function unescapeBytea(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '\\') {
      bytes.push(0x5c);
      i++;
    } else if (s[i] === '\\' && /^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else bytes.push(s.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
}

function cases(state: { db: () => Db; schemaAt0065: () => Promise<string[] | null> }) {
  const db = () => state.db();
  const run = (q: string, on: Db = db()) => sql.raw(q).execute(on);
  const one = async <T,>(q: string, on: Db = db()) => (await sql.raw<T>(q).execute(on)).rows[0] as T;
  const all = async <T,>(q: string, on: Db = db()) => (await sql.raw<T>(q).execute(on)).rows;
  const count = async (from: string) => Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`)).n);
  const refused = (p: Promise<unknown>, reason: string, label = reason) =>
    expect(p, label).rejects.toSatisfy((e) => {
      if (purgeRefusal(e) !== reason) throw new Error(`${label}: expected OR010 ${reason}, got ${pgError(e)?.code} ${(e as Error).message}`);
      return true;
    });
  const guarded = (p: Promise<unknown>, message: string, label = message) =>
    expect(p, label).rejects.toSatisfy((e) => {
      if (!isGuardViolation(e) || (e as Error).message !== message) throw new Error(`${label}: expected OR001 « ${message} », got ${pgError(e)?.code} « ${(e as Error).message} »`);
      return true;
    });
  /** In one transaction as the app's role (NOSUPERUSER, DML only), rolled back unless `keep`. */
  const asApp = async (q: string, keep = false) =>
    db().transaction().execute(async (tx) => {
      await sql.raw(`SET LOCAL ROLE ${APP_ROLE}`).execute(tx);
      const r = await sql.raw(q).execute(tx);
      if (!keep) throw Object.assign(new Error('rollback'), { rows: r.rows, rollback: true });
      return r.rows;
    }).catch((e: { rollback?: boolean; rows?: unknown[] }) => {
      if (e?.rollback) return e.rows;
      throw e;
    });
  /** An audit row with hashes nobody else has (the chain itself is AuditService's; these tests read ids and xmin). */
  const audit = async (o: { action: string; actorType?: string; actorId?: string | null; targetType?: string | null; targetId?: string | null; details?: object; at?: string }, on: Db = db()) =>
    Number(
      (
        await one<{ id: string | number }>(
          `INSERT INTO audit_logs (occurred_at, actor_type, actor_id, action, target_type, target_id, details, prev_hash, hash)
           VALUES (${o.at ?? 'now()'}, '${o.actorType ?? 'system'}', ${o.actorId ? `'${o.actorId}'` : 'NULL'}, '${o.action}', ${o.targetType ? `'${o.targetType}'` : 'NULL'},
                   ${o.targetId ? `'${o.targetId}'` : 'NULL'}, '${JSON.stringify(o.details ?? {})}'::jsonb,
                   sha256(convert_to(gen_random_uuid()::text, 'UTF8')), sha256(convert_to(gen_random_uuid()::text, 'UTF8')))
           RETURNING id`,
          on,
        )
      ).id,
    );

  it('rolls back to the schema of 0065 exactly without rows: what 0066 added, 0001\'s orbes_reject_mutation back byte for byte; and applies again to the latest, its list written', async () => {
    const latest = await snapshotOf(db());
    expect(await downTo0065(db())).toEqual([NAME]);
    const before = await snapshotOf(db());
    const at0065 = await state.schemaAt0065();
    if (at0065) expect(before).toEqual(at0065);
    const reject = (s: string[]) => s.filter((o) => o.startsWith('function orbes_reject_mutation('));
    // 0001's body exactly (its md5 at 0065 is the one 0001 wrote; 0066 replaced it; down put it back).
    expect(reject(before)).toHaveLength(1);
    expect(reject(latest)).toHaveLength(1);
    expect(reject(latest)).not.toEqual(reject(before));
    const src = (await one<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'orbes_reject_mutation'`)).src;
    expect(src).toBe(`
   BEGIN
     RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'immutable')
       USING ERRCODE = 'OR001';
   END `);
    const added = latest.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !latest.includes(o) && !notNull(o));
    expect(removed).toEqual(reject(before));
    expect(added.filter((o) => !of0066(o))).toEqual([]);
    expect(before.filter((o) => of0066(o) && !o.startsWith('function orbes_reject_mutation('))).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table audit_purge_gaps hash bytea NO ',
      'table audit_purge_gaps id bigint NO ',
      'table audit_purge_gaps prev_hash bytea NO ',
      'table audit_purge_gaps purged_at timestamp with time zone NO now()',
      'table audit_purge_gaps run_id uuid YES ',
      'table purge_delete_tables col text NO ',
      'table purge_delete_tables ord integer NO ',
      'table purge_delete_tables tbl text NO ',
      'table test_runs purge_reason text YES ',
      'table test_runs purge_requested_at timestamp with time zone YES ',
      'table test_runs purge_requested_by uuid YES ',
      'table test_runs purge_result jsonb YES ',
      'table test_runs purge_state text YES ',
      'table test_runs purge_step_up_id bigint YES ',
      'table test_runs purge_summary jsonb YES ',
      'table test_runs purge_windows jsonb YES ',
      'table test_runs purged_at timestamp with time zone YES ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint ')).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual([
      'constraint audit_purge_gaps audit_purge_gaps_hash_check',
      'constraint audit_purge_gaps audit_purge_gaps_id_check',
      'constraint audit_purge_gaps audit_purge_gaps_pkey',
      'constraint audit_purge_gaps audit_purge_gaps_prev_hash_check',
      'constraint audit_purge_gaps audit_purge_gaps_prev_hash_key',
      'constraint audit_purge_gaps audit_purge_gaps_run_id_fkey',
      'constraint purge_delete_tables purge_delete_tables_col_check',
      'constraint purge_delete_tables purge_delete_tables_ord_check',
      'constraint purge_delete_tables purge_delete_tables_ord_key',
      'constraint purge_delete_tables purge_delete_tables_pkey',
      'constraint purge_delete_tables purge_delete_tables_tbl_check',
      'constraint test_runs test_runs_purge_done',
      'constraint test_runs test_runs_purge_ended',
      'constraint test_runs test_runs_purge_paused',
      'constraint test_runs test_runs_purge_reason_check',
      'constraint test_runs test_runs_purge_requested',
      'constraint test_runs test_runs_purge_requested_by_fkey',
      'constraint test_runs test_runs_purge_result_check',
      'constraint test_runs test_runs_purge_state_check',
      'constraint test_runs test_runs_purge_step_up_id_check',
      'constraint test_runs test_runs_purge_summary_check',
      'constraint test_runs test_runs_purge_windows_check',
    ]);
    for (const c of [
      'constraint audit_purge_gaps audit_purge_gaps_run_id_fkey FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE RESTRICT',
      'constraint test_runs test_runs_purge_requested_by_fkey FOREIGN KEY (purge_requested_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      "constraint test_runs test_runs_purge_state_check CHECK ((purge_state = ANY (ARRAY['PURGING'::text, 'PAUSED'::text, 'DONE'::text])))",
      "constraint test_runs test_runs_purge_paused CHECK (((NOT (purge_state IS DISTINCT FROM 'PAUSED'::text)) = (purge_reason IS NOT NULL)))",
    ]) {
      expect(added, c).toContain(c);
    }
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX audit_purge_gaps_run_idx ON public.audit_purge_gaps USING btree (run_id)',
      'index CREATE INDEX test_runs_purge_requested_by_idx ON public.test_runs USING btree (purge_requested_by)',
      'index CREATE UNIQUE INDEX audit_purge_gaps_pkey ON public.audit_purge_gaps USING btree (id)',
      'index CREATE UNIQUE INDEX audit_purge_gaps_prev_hash_key ON public.audit_purge_gaps USING btree (prev_hash)',
      'index CREATE UNIQUE INDEX purge_delete_tables_ord_key ON public.purge_delete_tables USING btree (ord)',
      'index CREATE UNIQUE INDEX purge_delete_tables_pkey ON public.purge_delete_tables USING btree (tbl, col)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger audit_purge_gaps audit_purge_gaps_append_only',
      'trigger audit_purge_gaps audit_purge_gaps_no_truncate',
      'trigger audit_purge_gaps audit_purge_gaps_written_by_purge',
      'trigger purge_delete_tables purge_delete_tables_no_truncate',
      'trigger purge_delete_tables purge_delete_tables_superuser',
      'trigger test_runs test_runs_purge_guard',
    ]);
    expect(added.filter((o) => o.startsWith('function ')).map((o) => o.split(' ')[1])).toEqual([
      'orbes_maintenance_window(p_at',
      'orbes_maintenance_window_within(p_at',
      'orbes_purge_accounts(p_ids',
      'orbes_purge_count(p_counts',
      'orbes_purge_free(p_ids',
      'orbes_purge_held(p_ref',
      'orbes_purge_plan()',
      'orbes_purge_scope(p_cands',
      'orbes_purge_test_pool_batch(p_max',
      'orbes_purge_test_run_batch(p_run',
      'orbes_reject_mutation()',
      'orbes_require_superuser()',
      'orbes_test_runs_purge_guard()',
    ]);
    // Up again: the same schema, the list written, nothing else.
    expect((await migrateToLatest(db())).applied).toEqual([NAME]);
    expect(await snapshotOf(db())).toEqual(latest);
    expect(await count('audit_purge_gaps')).toBe(0);
    expect(await count('purge_delete_tables')).toBe(PURGE_DELETE_TABLES.length);
    expect(await count('test_runs WHERE purge_state IS NOT NULL')).toBe(0);
  });

  it('the app\'s role: a throwaway NOSUPERUSER role with lib.sh\'s grants (DML on every table)', async () => {
    await run(`CREATE ROLE ${APP_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`);
    await run(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
    expect(await asApp(`SELECT current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`)).toEqual([{ who: APP_ROLE, su: false }]);
  });

  it('every one of the 57 guard uses of orbes_reject_mutation refuses as before, with its own words, the setting set or not', async () => {
    const uses = await all<{ tbl: string; tgname: string; tgtype: number; args: string; cols: string | null }>(`
      SELECT c.relname AS tbl, t.tgname, t.tgtype, encode(t.tgargs, 'escape') AS args,
             (SELECT string_agg(a.attname, ',') FROM unnest(t.tgattr) AS k (n) JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.n) AS cols
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND t.tgfoid = 'orbes_reject_mutation'::regproc AND n.nspname = 'public'
       ORDER BY 1, 2`);
    // 0066 adds its own two (the tombstones' append-only and no-truncate); the 57 of 0065 are unchanged.
    expect(uses.filter((u) => u.tbl === 'audit_purge_gaps').map((u) => u.tgname)).toEqual(['audit_purge_gaps_append_only', 'audit_purge_gaps_no_truncate']);
    const old = uses.filter((u) => u.tbl !== 'audit_purge_gaps');
    expect(old).toHaveLength(57);
    // Each one fired on a copy of its table outside public, alone, for each of its events: its own words, as 0001 says them.
    await run(`DROP SCHEMA IF EXISTS t66 CASCADE`);
    await run(`CREATE SCHEMA t66`);
    try {
      let fired = 0;
      for (const u of old) {
        const args = u.args.split('\\000').filter(Boolean).map(unescapeBytea);
        expect(args.length, u.tgname).toBeLessThanOrEqual(1);
        const words = args[0] ?? 'immutable';
        const row = (u.tgtype & 1) === 1;
        const events = [
          ...((u.tgtype & 4) ? ['INSERT'] : []),
          ...((u.tgtype & 8) ? ['DELETE'] : []),
          ...((u.tgtype & 16) ? ['UPDATE'] : []),
          ...((u.tgtype & 32) ? ['TRUNCATE'] : []),
        ];
        expect(events.length, u.tgname).toBeGreaterThan(0);
        await run(`DROP TABLE IF EXISTS t66.${u.tbl}`);
        await run(`CREATE TABLE t66.${u.tbl} AS SELECT * FROM public.${u.tbl} WITH NO DATA`);
        const first = (await one<{ c: string }>(`SELECT attname AS c FROM pg_attribute WHERE attrelid = 't66.${u.tbl}'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum LIMIT 1`)).c;
        const col = u.cols?.split(',')[0] ?? first;
        await run(`INSERT INTO t66.${u.tbl} DEFAULT VALUES`);
        await run(`CREATE TRIGGER ${u.tgname} ${(u.tgtype & 2) ? 'BEFORE' : 'AFTER'} ${events.join(' OR ')} ON t66.${u.tbl}
                     FOR EACH ${row ? 'ROW' : 'STATEMENT'} EXECUTE FUNCTION public.orbes_reject_mutation(${args.map((a) => `'${a.replace(/'/g, "''")}'`).join(', ')})`);
        for (const event of events) {
          const statement = event === 'INSERT' ? `INSERT INTO t66.${u.tbl} DEFAULT VALUES` : event === 'DELETE' ? `DELETE FROM t66.${u.tbl}` : event === 'UPDATE' ? `UPDATE t66.${u.tbl} SET "${col}" = "${col}"` : `TRUNCATE t66.${u.tbl}`;
          const message = `${event} on ${u.tbl} is not allowed (${words})`;
          await guarded(run(statement), message, `${u.tgname} ${event}`);
          // The setting changes nothing here: the way through is for public's five tables only.
          await guarded(
            db().transaction().execute(async (tx) => {
              await sql`SET LOCAL orbes.guard_bypass = 'purge'`.execute(tx);
              await sql.raw(statement).execute(tx);
            }),
            message,
            `${u.tgname} ${event} with the setting`,
          );
          fired++;
        }
        await run(`DROP TABLE t66.${u.tbl}`);
      }
      expect(fired).toBeGreaterThanOrEqual(57);
    } finally {
      await run(`DROP SCHEMA IF EXISTS t66 CASCADE`);
    }
  });

  it('the way through: a DELETE, purpose purge, on the five tables of public, by a superuser; an UPDATE never, a TRUNCATE never, another table never, the setting required, the app\'s role never', async () => {
    const bypass = (statement: string, value = 'purge') =>
      db().transaction().execute(async (tx) => {
        await sql.raw(`SET LOCAL orbes.guard_bypass = '${value}'`).execute(tx);
        return sql.raw(statement).execute(tx);
      });
    const a = await audit({ action: 't66.row' });
    // Without the setting, or with another purpose: refused as always.
    await guarded(run(`DELETE FROM audit_logs WHERE id = ${a}`), 'DELETE on audit_logs is not allowed (audit_logs is append-only)');
    await guarded(bypass(`DELETE FROM audit_logs WHERE id = ${a}`, 'reset'), 'DELETE on audit_logs is not allowed (audit_logs is append-only)');
    await guarded(bypass(`DELETE FROM audit_logs WHERE id = ${a}`, 'PURGE'), 'DELETE on audit_logs is not allowed (audit_logs is append-only)');
    // An UPDATE never, a TRUNCATE never, even with it.
    await guarded(bypass(`UPDATE audit_logs SET action = 't66.changed' WHERE id = ${a}`), 'UPDATE on audit_logs is not allowed (audit_logs is append-only)');
    await guarded(bypass(`TRUNCATE audit_logs`), 'TRUNCATE on audit_logs is not allowed (audit_logs is append-only)');
    // The app's role, the setting set: refused (it is no superuser).
    await guarded(asApp(`DELETE FROM audit_logs WHERE id = ${a}`) as Promise<unknown>, 'DELETE on audit_logs is not allowed (audit_logs is append-only)', 'the app');
    await guarded(
      db().transaction().execute(async (tx) => {
        await sql.raw(`SET LOCAL ROLE ${APP_ROLE}`).execute(tx);
        await sql`SET LOCAL orbes.guard_bypass = 'purge'`.execute(tx);
        await sql.raw(`DELETE FROM audit_logs WHERE id = ${a}`).execute(tx);
      }),
      'DELETE on audit_logs is not allowed (audit_logs is append-only)',
      'the app with the setting',
    );
    expect(await count(`audit_logs WHERE id = ${a}`)).toBe(1);
    // Another table, the setting set: refused (categories, the vault's sources seeded by 0061, a statement guard).
    await run(`INSERT INTO categories (id, code, name) VALUES (30, 'Y', 'T66') ON CONFLICT DO NOTHING`);
    await guarded(bypass(`DELETE FROM categories WHERE id = 30`), 'DELETE on categories is not allowed (category indices are never released; deactivate instead)');
    await guarded(bypass(`DELETE FROM vault_sources`), 'DELETE on vault_sources is not allowed (a vault source is switched off, never deleted)');
    await guarded(bypass(`TRUNCATE product_status_history`), 'TRUNCATE on product_status_history is not allowed (product_status_history is append-only)');
    await guarded(bypass(`TRUNCATE audit_purge_gaps`), 'TRUNCATE on audit_purge_gaps is not allowed (audit_purge_gaps is append-only)');
    // The way through: the superuser with the setting deletes (here as the purge's function would), and only that row.
    const journal = Number((await one<{ id: string }>(`INSERT INTO event_journal (type, entity_type, entity_id, payload) VALUES ('purge_test.event', 'order', 'x', '{}') RETURNING id`)).id);
    await guarded(run(`DELETE FROM event_journal WHERE id = ${journal}`), 'DELETE on event_journal is not allowed (the event journal is replayed from its start)');
    const n = await count('audit_logs');
    await bypass(`DELETE FROM audit_logs WHERE id = ${a}`);
    await bypass(`DELETE FROM event_journal WHERE id = ${journal}`);
    expect(await count('audit_logs')).toBe(n - 1);
    expect(await count(`event_journal WHERE id = ${journal}`)).toBe(0);
    // The setting never outlives its transaction.
    expect((await one<{ v: string | null }>(`SELECT current_setting('orbes.guard_bypass', true) AS v`)).v ?? '').toBe('');
    // The function's own list is the plan's.
    const src = (await one<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'orbes_reject_mutation'`)).src;
    expect(src).toContain(`TG_TABLE_NAME IN (${PURGE_GUARDED_TABLES.map((t) => `'${t}'`).join(',')})`);
  });

  it('the definer functions: SECURITY DEFINER, owned by a superuser, their exact settings, the only ones of public; the helpers out of PUBLIC\'s reach, the batches and the windows not', async () => {
    const definers = await all<{ name: string; su: boolean; config: string[] }>(`
      SELECT p.proname AS name, r.rolsuper AS su, p.proconfig AS config
        FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef ORDER BY 1`);
    expect(definers).toEqual(
      ['orbes_purge_test_pool_batch', 'orbes_purge_test_run_batch'].map((name) => ({
        name,
        su: true,
        config: ['search_path=pg_catalog, public, pg_temp', 'lock_timeout=2s', 'orbes.guard_bypass=purge'],
      })),
    );
    const can = async (fn: string) => (await one<{ ok: boolean }>(`SELECT has_function_privilege('${APP_ROLE}', '${fn}', 'EXECUTE') AS ok`)).ok;
    for (const fn of ['orbes_purge_test_run_batch(uuid, int)', 'orbes_purge_test_pool_batch(int)', 'orbes_maintenance_window(timestamptz)', 'orbes_maintenance_window_within(timestamptz, interval)']) {
      expect(await can(fn), fn).toBe(true);
    }
    for (const fn of ['orbes_purge_scope(uuid[])', 'orbes_purge_held(text, uuid[])', 'orbes_purge_free(uuid[], bigint)', 'orbes_purge_accounts(uuid[], int, bigint, uuid)', 'orbes_purge_count(jsonb, text, bigint)']) {
      expect(await can(fn), fn).toBe(false);
    }
    await expect(asApp(`SELECT orbes_purge_scope('{}')`)).rejects.toThrow(/permission denied/);
    // Called by the app's role, a batch runs as its owner: its first refusal, not a permission error.
    await refused(asApp(`SELECT orbes_purge_test_run_batch(gen_random_uuid(), 10)`) as Promise<unknown>, 'PURGE_NOT_FOUND');
  });

  it('the plan: purge_delete_tables and orbes_purge_plan() are db/purge-plan.ts\'s; every foreign key the purge meets is classed (pg_constraint), by the owner-column rule; the BLOCK-by-name ones BLOCK; the bypass\'s tables are the guarded ones it deletes from', async () => {
    expect(await all(`SELECT tbl, col, ord FROM purge_delete_tables ORDER BY ord`)).toEqual(PURGE_DELETE_TABLES.map((t, i) => ({ tbl: t.table, col: t.column, ord: i + 1 })));
    const plan = await all<{ tbl: string; cols: string; ref: string; kind: string }>(`SELECT * FROM orbes_purge_plan()`);
    const key = (r: { tbl: string; cols: string; ref: string }) => purgeReferenceKey({ table: r.tbl, columns: r.cols, references: r.ref });
    expect(plan.map((p) => `${key(p)} ${p.kind}`).sort()).toEqual(PURGE_REFERENCES.map((r) => `${purgeReferenceKey(r)} ${r.kind}`).sort());
    expect(new Set(PURGE_REFERENCES.map(purgeReferenceKey)).size).toBe(PURGE_REFERENCES.length);

    // Every foreign key into accounts, orders, drop_entries, live_entries and every table whose rows the purge deletes.
    const refs = ['accounts', 'orders', 'drop_entries', 'live_entries', ...PURGE_ROW_TABLES];
    const fks = await all<{ tbl: string; cols: string; ref: string; notnull: boolean }>(`
      SELECT cl.relname AS tbl, rl.relname AS ref,
             (SELECT string_agg(a.attname, ',' ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY AS k (n, o) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols,
             (SELECT bool_and(a.attnotnull) FROM unnest(c.conkey) AS k (n) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS notnull
        FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class rl ON rl.oid = c.confrelid
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND rl.relname IN (${refs.map((r) => `'${r}'`).join(', ')})`);
    expect(fks.map((f) => purgeReferenceKey({ table: f.tbl, columns: f.cols, references: f.ref })).sort()).toEqual(PURGE_REFERENCES.map(purgeReferenceKey).sort());
    // The 52 columns referencing accounts, the 16 into orders (measured at 0065, plan §A.2).
    expect(fks.filter((f) => f.ref === 'accounts')).toHaveLength(52);
    expect(fks.filter((f) => f.ref === 'orders')).toHaveLength(16);
    // The owner-column rule (H11): DELETE only on the row's own owner column, account_id NOT NULL, never on accounts itself.
    for (const f of fks.filter((x) => x.ref === 'accounts')) {
      const kind = PURGE_REFERENCES.find((r) => purgeReferenceKey(r) === purgeReferenceKey({ table: f.tbl, columns: f.cols, references: f.ref }))!.kind;
      if (kind === 'DELETE') expect(f.cols === 'account_id' && f.notnull && f.tbl !== 'accounts', `${f.tbl}.${f.cols}`).toBe(true);
      if (!(f.cols === 'account_id' && f.notnull)) expect(kind, `${f.tbl}.${f.cols} is not its row's owner column`).toBe('BLOCK');
    }
    const accountsDelete = PURGE_REFERENCES.filter((r) => r.references === 'accounts' && r.kind === 'DELETE').map((r) => r.table).sort();
    expect(accountsDelete).toEqual(PURGE_DELETE_TABLES.map((t) => t.table).sort());
    for (const name of PURGE_BLOCK_BY_NAME) {
      const [table, column] = name.split('.');
      expect(PURGE_REFERENCES.find((r) => r.table === table && r.columns === column)?.kind, name).toBe('BLOCK');
    }
    for (const [table, column] of [['accounts', 'invited_by'], ['vaults', 'friend_account_id']] as const) {
      expect(await count(`purge_delete_tables WHERE tbl = '${table}' AND col = '${column}'`)).toBe(0);
    }
    // The append-only tables among those the purge deletes from are exactly the bypass's: each carries a DELETE guard.
    const deleteGuards = await all<{ tbl: string }>(`
      SELECT DISTINCT c.relname AS tbl FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND t.tgfoid = 'orbes_reject_mutation'::regproc AND (t.tgtype & 8) = 8 AND t.tgqual IS NULL
         AND c.relname IN (${PURGE_ROW_TABLES.map((r) => `'${r}'`).join(', ')}) ORDER BY 1`);
    expect(deleteGuards.map((g) => g.tbl)).toEqual([...PURGE_GUARDED_TABLES].sort());
    // Written by the migrations' superuser only.
    await guarded(asApp(`INSERT INTO purge_delete_tables (tbl, col, ord) VALUES ('t66', 'account_id', 99)`) as Promise<unknown>, "INSERT on purge_delete_tables is not allowed (the purge's list is written by the migrations only)");
    await guarded(asApp(`UPDATE purge_delete_tables SET ord = ord + 100`) as Promise<unknown>, "UPDATE on purge_delete_tables is not allowed (the purge's list is written by the migrations only)");
    await guarded(asApp(`DELETE FROM purge_delete_tables WHERE tbl = 'account_sizes'`) as Promise<unknown>, "DELETE on purge_delete_tables is not allowed (the purge's list is written by the migrations only)");
    expect(await count('purge_delete_tables')).toBe(PURGE_DELETE_TABLES.length);
  });

  it('the windows: the SQL copy equals services/maintenance-window.ts every 30 s of a winter day, a summer day and both change days, with margins 0, 1 and 5 minutes; its absolute cases; a margin over 5 minutes refused', async () => {
    const days = ['2026-01-15', '2026-07-15', '2026-03-29', '2026-10-25'];
    let compared = 0;
    for (const day of days) {
      const rows = await all<{ ms: number; w0: string | null; w1: string | null; w5: string | null }>(`
        SELECT (extract(epoch FROM t) * 1000)::bigint AS ms,
               orbes_maintenance_window_within(t, interval '0') AS w0,
               orbes_maintenance_window_within(t, interval '1 minute') AS w1,
               orbes_maintenance_window_within(t, interval '5 minutes') AS w5
          FROM generate_series(timestamptz '${day}T00:00:00Z', timestamptz '${day}T23:59:30Z', interval '30 seconds') AS t`);
      expect(rows).toHaveLength(2880);
      for (const r of rows) {
        const at = new Date(Number(r.ms));
        const ts = [0, 60_000, 300_000].map((m) => maintenanceWindow(at, m)?.kind ?? null);
        if ([r.w0, r.w1, r.w5].some((w, i) => w !== ts[i])) expect([at.toISOString(), r.w0, r.w1, r.w5]).toEqual([at.toISOString(), ...ts]);
        compared++;
      }
    }
    expect(compared).toBe(4 * 2880);
    const w = async (iso: string, margin = '0') => (await one<{ w: string | null }>(`SELECT orbes_maintenance_window_within(timestamptz '${iso}', interval '${margin}') AS w`)).w;
    expect(await w('2026-07-15T01:05:00Z')).toBe('BACKUP');
    expect(await w('2026-07-15T01:30:00Z')).toBeNull();
    expect(await w('2026-07-15T02:30:00Z')).toBe('NIGHT');
    expect(await w('2026-07-15T05:15:00Z')).toBe('NIGHT');
    expect(await w('2026-01-15T02:05:00Z')).toBe('BACKUP');
    expect(await w('2026-01-15T01:05:00Z')).toBeNull();
    expect(await w('2026-01-15T03:00:00Z')).toBe('NIGHT');
    expect(await w('2026-01-15T05:29:00Z')).toBe('NIGHT');
    expect(await w('2026-01-15T05:30:00Z')).toBeNull();
    expect(await w('2026-01-15T02:57:00Z', '5 minutes')).toBe('NIGHT');
    expect(await w('2026-01-15T01:59:30Z', '1 minute')).toBe('BACKUP');
    expect(await w('2026-01-15T01:59:30Z')).toBeNull();
    await expect(w('2026-01-15T12:00:00Z', '6 minutes')).rejects.toSatisfy((e) => pgError(e)?.code === '22023');
    await expect(w('2026-01-15T12:00:00Z', '-1 minute')).rejects.toSatisfy((e) => pgError(e)?.code === '22023');
  });

  describe('test_runs, the tombstones and the batches\' first refusals', () => {
    let admin = '';
    let other = '';
    let drop = '';
    let drop2 = '';
    let model = '';
    const runOf = async (o: { status?: string } = {}) => {
      const id = (await one<{ id: string }>(`INSERT INTO test_runs (drop_id, mode, settings, entrants, created_by) VALUES ('${drop}', 'DRAW', '[]', 0, '${admin}') RETURNING id`)).id;
      if (o.status !== 'RUNNING') {
        await run(`UPDATE test_runs SET status = '${o.status ?? 'ENDED'}'${(o.status ?? 'ENDED') === 'ENDED' ? `, ended_at = created_at, ended_by = '${admin}'` : ''} WHERE id = '${id}'`);
      }
      return id;
    };
    /**
     * The request as the service writes it (PURGE.5): in ONE transaction, the step-up consumed (the admin's row updated,
     * `admin.step_up {purpose}` audited), then the run set PURGING. Each part can be left out or changed.
     */
    const request = (runId: string, o: { by?: string; purpose?: string | null; touch?: boolean; set?: Record<string, string>; at?: string } = {}) => {
      const by = o.by ?? admin;
      const purpose = o.purpose === undefined ? `test_run.purge:${runId}` : o.purpose;
      const columns: Record<string, string> = { purge_state: `'PURGING'`, purge_requested_at: 'now()', purge_requested_by: `'${by}'`, purge_summary: `'{"all": false}'`, ...o.set };
      return db().transaction().execute(async (tx) => {
        if (o.touch !== false) await run(`UPDATE admin_users SET failed_logins = 0 WHERE id = '${by}'`, tx);
        const stepUp = purpose === null ? null : await audit({ action: 'admin.step_up', actorType: 'admin', actorId: by, targetType: 'admin', targetId: by, details: { purpose }, ...(o.at ? { at: o.at } : {}) }, tx);
        await run(`UPDATE test_runs SET ${Object.entries(columns).map(([c, v]) => `${c} = ${v}`).join(', ')} WHERE id = '${runId}'`, tx);
        return stepUp;
      });
    };
    /** An UPDATE with the guard off, to reach a CHECK the guard would refuse first. */
    const unguarded = async (q: string) => {
      await run(`ALTER TABLE test_runs DISABLE TRIGGER test_runs_purge_guard`);
      try {
        await run(q);
      } finally {
        await run(`ALTER TABLE test_runs ENABLE TRIGGER test_runs_purge_guard`);
      }
    };
    const purgeOf = (runId: string) =>
      one<{ state: string | null; step_up: number | null; reason: string | null; windows: object | null }>(
        `SELECT purge_state AS state, purge_step_up_id AS step_up, purge_reason AS reason, purge_windows AS windows FROM test_runs WHERE id = '${runId}'`,
      );
    /** The forbidden windows replaced for these cases (CI runs at any hour), put back after. */
    const windowsOpen = () => run(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`);
    let windowSource = '';

    beforeAll(async () => {
      windowSource = (await one<{ def: string }>(`SELECT pg_get_functiondef('orbes_maintenance_window(timestamptz)'::regprocedure) AS def`)).def;
      admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('purge-0066@orbes.test', 'purge-0066@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
      other = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('purge-0066-op@orbes.test', 'purge-0066-op@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
      await run(`INSERT INTO categories (id, code, name) VALUES (29, 'X', 'T66 CAT') ON CONFLICT DO NOTHING`);
      model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (29, 'T66 MODEL', 'RING', 'T66') RETURNING id`)).id;
      drop = (
        await one<{ id: string }>(
          `INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, cancelled_at)
           VALUES ('${model}', 'T66 DRAW', 1, now() - interval '2 days', now() - interval '1 day', 'v1.${'A'.repeat(16)}.${'B'.repeat(64)}', '${ZERO}', now()) RETURNING id`,
        )
      ).id;
      drop2 = (
        await one<{ id: string }>(
          `INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, cancelled_at)
           VALUES ('${model}', 'T66 OTHER', 1, now() - interval '2 days', now() - interval '1 day', 'v1.${'C'.repeat(16)}.${'D'.repeat(64)}', '${ZERO}', now()) RETURNING id`,
        )
      ).id;
      await windowsOpen();
    });
    afterAll(async () => {
      await run(windowSource);
    });

    it('the purge columns: each CHECK; only on an ENDED run; nothing of a purge at a run\'s creation', async () => {
      const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
      expect(TEST_RUN_PURGE_STATES).toEqual(['PURGING', 'PAUSED', 'DONE']);
      const running = await runOf({ status: 'RUNNING' });
      await refused(run(`INSERT INTO test_runs (drop_id, mode, settings, entrants, created_by, purge_reason) VALUES ('${drop}', 'DRAW', '[]', 0, '${admin}', 'X')`), 'PURGE_NOT_AUTHORIZED', 'a run created with a purge column');
      // On a run not ENDED: refused by the CHECK (the guard lets the transition through, the row cannot hold it).
      await check(request(running), 'a purge of a run not ended', 'test_runs_purge_ended');
      await run(`UPDATE test_runs SET status = 'STOPPED' WHERE id = '${running}'`);
      const ended = await runOf();
      await refused(request(ended, { set: { purge_state: `'PAUSED'`, purge_reason: `'PURGE_WINDOW'` } }), 'PURGE_STATE_ONE_WAY', 'NULL -> PAUSED');
      await refused(request(ended, { set: { purge_state: `'DONE'` } }), 'PURGE_STATE_ONE_WAY', 'NULL -> DONE');
      await refused(request(ended, { set: { purge_requested_by: 'NULL' } }), 'PURGE_NOT_AUTHORIZED', 'no author');
      await refused(request(ended, { set: { purge_windows: `'{"fromId": 1, "toId": 2, "from": null, "to": null, "accounts": []}'` } }), 'PURGE_WINDOWS_LOCKED', 'windows at the request');
      await check(request(ended, { set: { purge_summary: `'[]'` } }), 'a summary not an object', 'test_runs_purge_summary_check');
      await check(request(ended, { set: { purge_summary: 'NULL' } }), 'a request without its summary', 'test_runs_purge_requested');
      await check(request(ended, { set: { purge_requested_at: 'NULL' } }), 'a request without its time', 'test_runs_purge_requested');
      await check(unguarded(`UPDATE test_runs SET purge_state = 'NOPE', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}', purge_step_up_id = 1 WHERE id = '${ended}'`), 'an unknown state', 'test_runs_purge_state_check');
      await check(unguarded(`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}' WHERE id = '${ended}'`), 'PURGING without its step-up', 'test_runs_purge_requested');
      await check(unguarded(`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}', purge_step_up_id = 0 WHERE id = '${ended}'`), 'a step-up id below 1', 'test_runs_purge_step_up_id_check');
      await check(unguarded(`UPDATE test_runs SET purge_windows = '{"fromId": 1, "toId": 2, "from": null, "to": null, "accounts": []}' WHERE id = '${ended}'`), 'windows without a purge', 'test_runs_purge_requested');
      // Each CHECK read back as PostgreSQL holds it.
      const def = async (c: string) => (await one<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = '${c}'`)).def;
      expect(await def('test_runs_purge_requested')).toContain('(purge_state IS NULL) = (purge_step_up_id IS NULL)');
      expect(await def('test_runs_purge_done')).toContain('(purged_at IS NOT NULL)');
      expect(await def('test_runs_purge_windows_check')).toContain("ARRAY['fromId'::text, 'toId'::text, 'from'::text, 'to'::text, 'accounts'::text]");
      expect(await def('test_runs_purge_reason_check')).toContain("'^[A-Z0-9_]{1,64}$'");
      expect(await def('test_runs_purge_result_check')).toContain("ARRAY['deleted'::text, 'kept'::text]");
      expect(await purgeOf(ended)).toEqual({ state: null, step_up: null, reason: null, windows: null });
    });

    it('NULL -> PURGING only in a transaction that itself consumed a step-up of that admin for this purge (or PURGE ALL); the step-up id set by the database whatever is sent', async () => {
      const r = await runOf();
      // A direct UPDATE by the app outside any step-up transaction, as the app's role and as the superuser.
      await refused(asApp(`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}' WHERE id = '${r}'`) as Promise<unknown>, 'PURGE_NOT_AUTHORIZED', 'the app outside a step-up');
      await refused(run(`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}' WHERE id = '${r}'`), 'PURGE_NOT_AUTHORIZED', 'outside a step-up');
      // A step-up of another purpose, of another run, of another admin; the admin's row not updated; the step-up in an
      // earlier transaction; an OPERATOR; no author.
      await refused(request(r, { purpose: 'platform.reset' }), 'PURGE_NOT_AUTHORIZED', 'another purpose');
      await refused(request(r, { purpose: `test_run.purge:${await runOf()}` }), 'PURGE_NOT_AUTHORIZED', 'another run');
      await refused(request(r, { touch: false }), 'PURGE_NOT_AUTHORIZED', 'the admin row not updated');
      await refused(request(r, { purpose: null }), 'PURGE_NOT_AUTHORIZED', 'no step-up');
      await audit({ action: 'admin.step_up', actorType: 'admin', actorId: admin, targetType: 'admin', targetId: admin, details: { purpose: `test_run.purge:${r}` } });
      await refused(request(r, { purpose: null }), 'PURGE_NOT_AUTHORIZED', 'a step-up of an earlier transaction');
      await refused(request(r, { by: other, purpose: `test_run.purge:${r}` }), 'PURGE_NOT_AUTHORIZED', 'an OPERATOR');
      await refused(
        db().transaction().execute(async (tx) => {
          await run(`UPDATE admin_users SET failed_logins = 0 WHERE id = '${admin}'`, tx);
          await audit({ action: 'admin.step_up', actorType: 'admin', actorId: other, targetType: 'admin', targetId: admin, details: { purpose: `test_run.purge:${r}` } }, tx);
          await run(`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}' WHERE id = '${r}'`, tx);
        }),
        'PURGE_NOT_AUTHORIZED',
        'a step-up row written by another actor',
      );
      expect((await purgeOf(r)).state).toBeNull();
      // The request: the step-up id is the database's, whatever the app sends.
      const stepUp = await request(r, { set: { purge_step_up_id: '1' } });
      expect(await purgeOf(r)).toEqual({ state: 'PURGING', step_up: stepUp, reason: null, windows: null });
      // PURGE ALL's purpose authorizes too (its time put two days back, so that the pool sweep's cases below start with none).
      const r2 = await runOf();
      const all2 = await request(r2, { purpose: 'test_run.purge_all', at: `now() - interval '2 days'` });
      expect((await purgeOf(r2)).step_up).toBe(all2);
      // As the app's role in its own step-up transaction: the same (the residual the plan names, bounded by §A.2).
      const r3 = await runOf();
      await db().transaction().execute(async (tx) => {
        await sql.raw(`SET LOCAL ROLE ${APP_ROLE}`).execute(tx);
        await run(`UPDATE admin_users SET failed_logins = 0 WHERE id = '${admin}'`, tx);
        await audit({ action: 'admin.step_up', actorType: 'admin', actorId: admin, targetType: 'admin', targetId: admin, details: { purpose: `test_run.purge:${r3}` } }, tx);
        await run(`UPDATE test_runs SET purge_state = 'PURGING', purge_requested_at = now(), purge_requested_by = '${admin}', purge_summary = '{}', purge_step_up_id = 7 WHERE id = '${r3}'`, tx);
      });
      expect((await purgeOf(r3)).step_up).not.toBe(7);
    });

    it('one way: PURGING <-> PAUSED with its reason, PURGING -> DONE with its time and result; never back to NULL, never PAUSED -> DONE, nothing after DONE; the request, its summary and its step-up written once; the windows once, by the superuser only; the release kept', async () => {
      const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
      const r = await runOf();
      const stepUp = await request(r);
      const set = (s: string) => run(`UPDATE test_runs SET ${s} WHERE id = '${r}'`);
      await check(set(`purge_state = 'PAUSED'`), 'PAUSED without its reason', 'test_runs_purge_paused');
      await check(set(`purge_reason = 'PURGE_WINDOW'`), 'a reason while PURGING', 'test_runs_purge_paused');
      await check(set(`purge_state = 'PAUSED', purge_reason = 'purge window'`), 'a reason not a code', 'test_runs_purge_reason_check');
      await set(`purge_state = 'PAUSED', purge_reason = 'PURGE_WINDOW'`);
      await set(`purge_reason = 'PURGE_TEST_RUNNING'`);
      await refused(set(`purge_state = 'DONE', purged_at = now(), purge_result = '{"deleted": {}, "kept": {}}', purge_reason = NULL`), 'PURGE_STATE_ONE_WAY', 'PAUSED -> DONE');
      await refused(set(`purge_state = NULL, purge_reason = NULL`), 'PURGE_STATE_ONE_WAY', 'PAUSED -> NULL');
      // The resume: back to PURGING, the reason cleared; the request's values never touched.
      await set(`purge_state = 'PURGING', purge_reason = NULL`);
      await refused(set(`purge_summary = '{"all": true}'`), 'PURGE_WRITE_ONCE', 'a second summary');
      await refused(set(`purge_requested_at = now() + interval '1 hour'`), 'PURGE_WRITE_ONCE', 'a second request time');
      await refused(set(`purge_requested_by = '${other}'`), 'PURGE_WRITE_ONCE', 'another author');
      await refused(set(`purge_step_up_id = purge_step_up_id + 1`), 'PURGE_STEP_UP_LOCKED', 'another step-up');
      await refused(set(`drop_id = '${drop2}'`), 'PURGE_RUN_LOCKED', 'another release');
      await refused(set(`purge_state = NULL`), 'PURGE_STATE_ONE_WAY', 'PURGING -> NULL');
      // The windows: never by the app; once by the superuser (the purge function, at its step 9), never twice.
      const windows = `'{"fromId": 1, "toId": 2, "from": "2026-10-01T00:00:00Z", "to": "2026-10-01T01:00:00Z", "accounts": []}'`;
      await refused(asApp(`UPDATE test_runs SET purge_windows = ${windows} WHERE id = '${r}'`) as Promise<unknown>, 'PURGE_WINDOWS_LOCKED', 'the app writes the windows');
      await refused(asApp(`UPDATE test_runs SET purge_step_up_id = 1 WHERE id = '${r}'`) as Promise<unknown>, 'PURGE_STEP_UP_LOCKED', 'the app writes the step-up');
      await check(set(`purge_windows = '{"fromId": 1}'`), 'windows without their keys', 'test_runs_purge_windows_check');
      await set(`purge_windows = ${windows}`);
      await refused(set(`purge_windows = '{"fromId": 0, "toId": 2, "from": "2026-10-01T00:00:00Z", "to": "2026-10-01T01:00:00Z", "accounts": []}'`), 'PURGE_WINDOWS_LOCKED', 'a second write, even by the superuser');
      await refused(set(`purge_windows = NULL`), 'PURGE_WINDOWS_LOCKED', 'the windows taken away');
      // DONE: its time and its result, both or neither; then nothing of the purge changes.
      await check(set(`purge_state = 'DONE'`), 'DONE without its time and result', 'test_runs_purge_done');
      await check(set(`purge_state = 'DONE', purged_at = now()`), 'DONE without its result', 'test_runs_purge_done');
      await check(set(`purge_state = 'DONE', purged_at = now(), purge_result = '{"deleted": {}}'`), 'a result without its keys', 'test_runs_purge_result_check');
      await set(`purge_state = 'DONE', purged_at = now(), purge_result = '{"deleted": {"orders": 1}, "kept": {"accounts": 0}}'`);
      for (const s of [`purge_state = 'PURGING', purged_at = NULL, purge_result = NULL`, `purge_result = '{"deleted": {}, "kept": {}}'`, `purged_at = now() + interval '1 day'`]) {
        await refused(set(s), 'PURGE_DONE', s);
      }
      expect(await purgeOf(r)).toMatchObject({ state: 'DONE', step_up: stepUp, reason: null });
      // The rest of the row lives on as before (its report, for one).
      await set(`report = '{"passed": 5}'`);
      await check(set(`status = 'STOPPED', ended_at = NULL, ended_by = NULL`), 'a purged run not ENDED', 'test_runs_purge_ended');
      // A test with no purge changes as it always did.
      const plain = await runOf({ status: 'RUNNING' });
      await run(`UPDATE test_runs SET status = 'STOPPED', entrants = 3, settings = '[{"x": 1}]' WHERE id = '${plain}'`);
      await run(`UPDATE test_runs SET status = 'ENDED', ended_at = now(), ended_by = '${admin}' WHERE id = '${plain}'`);
    });

    it('the tombstones: written by a superuser only (the purge), append-only, each hash 32 bytes, each prev_hash once', async () => {
      const r = await runOf();
      const gap = (id: number, prev = `sha256('p${id}')`) => `INSERT INTO audit_purge_gaps (id, prev_hash, hash, run_id) VALUES (${id}, ${prev}, sha256('h${id}'), '${r}')`;
      await guarded(asApp(gap(900_001)) as Promise<unknown>, 'INSERT on audit_purge_gaps is not allowed (audit_purge_gaps is written by the purge only)');
      await run(gap(900_001));
      await expect(run(gap(900_002, `sha256('p900001')`))).rejects.toSatisfy((e) => pgError(e)?.constraint === 'audit_purge_gaps_prev_hash_key');
      await expect(run(gap(900_003, `'\\x00'`))).rejects.toSatisfy((e) => isCheckViolation(e, 'audit_purge_gaps_prev_hash_check'));
      const bypass = (statement: string) =>
        db().transaction().execute(async (tx) => {
          await sql`SET LOCAL orbes.guard_bypass = 'purge'`.execute(tx);
          await sql.raw(statement).execute(tx);
        });
      for (const s of [`UPDATE audit_purge_gaps SET hash = sha256('x') WHERE id = 900001`, `DELETE FROM audit_purge_gaps WHERE id = 900001`]) {
        const op = s.split(' ')[0];
        await guarded(run(s), `${op} on audit_purge_gaps is not allowed (audit_purge_gaps is append-only)`);
        await guarded(bypass(s), `${op} on audit_purge_gaps is not allowed (audit_purge_gaps is append-only)`, `${op} with the setting`);
      }
      await guarded(run(`TRUNCATE audit_purge_gaps`), 'TRUNCATE on audit_purge_gaps is not allowed (audit_purge_gaps is append-only)');
      expect(await count('audit_purge_gaps')).toBe(1);
    });

    it('the batches\' first refusals: the start guards (superuser, origin), a forbidden window with its 1-minute margin, no such test, a test running, not ended, not asked, the release not over, another test of the release not ended; the pool sweep without a PURGE ALL of the last 24 h', async () => {
      const batch = (id: string) => run(`SELECT orbes_purge_test_run_batch('${id}', 500)`);
      const pool = () => run(`SELECT orbes_purge_test_pool_batch(500)`);
      await refused(batch('00000000-0000-4000-8000-000000000066'), 'PURGE_NOT_FOUND');
      const notAsked = await runOf();
      await refused(batch(notAsked), 'PURGE_NOT_REQUESTED');
      const stopped = await runOf({ status: 'STOPPED' });
      await refused(batch(stopped), 'PURGE_NOT_ENDED');
      const running = await runOf({ status: 'RUNNING' });
      await refused(batch(notAsked), 'PURGE_TEST_RUNNING');
      await refused(pool(), 'PURGE_TEST_RUNNING');
      await run(`UPDATE test_runs SET status = 'STOPPED' WHERE id = '${running}'`);
      await refused(pool(), 'PURGE_RUNS_NOT_ENDED');
      await refused(batch(notAsked), 'PURGE_NOT_REQUESTED');
      // The release (cancelled: over) holds a STOPPED test: refused until it is ended.
      const asked = await runOf();
      await request(asked);
      await refused(batch(asked), 'PURGE_RUNS_NOT_ENDED');
      await run(`UPDATE test_runs SET status = 'ENDED', ended_at = now(), ended_by = '${admin}' WHERE status <> 'ENDED'`);
      // A release not over: refused, then over again.
      await run(`UPDATE drops SET cancelled_at = NULL WHERE id = '${drop}'`);
      await refused(batch(asked), 'PURGE_RELEASE_NOT_OVER');
      await run(`UPDATE drops SET cancelled_at = now() WHERE id = '${drop}'`);
      // A window (the function answers NIGHT now; then only for the margin's end, 30 s ahead): refused, both.
      await run(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT 'NIGHT'::text $$`);
      await refused(batch(asked), 'PURGE_WINDOW');
      await refused(pool(), 'PURGE_WINDOW');
      await run(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT CASE WHEN p_at > now() + interval '30 seconds' THEN 'BACKUP' END $$`);
      await refused(batch(asked), 'PURGE_WINDOW', 'the 1-minute margin');
      await run(`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT CASE WHEN p_at > now() + interval '2 minutes' THEN 'BACKUP' END $$`);
      expect((await one<{ r: { phase: string } }>(`SELECT orbes_purge_test_run_batch('${asked}', 500) AS r`)).r.phase).toBe('RUN_ENTRANTS');
      await windowsOpen();
      // The pool sweep: no PURGE ALL step-up, then one 24 h 01 min old: refused; one of a minute ago: it sweeps (nothing here).
      await refused(pool(), 'PURGE_ALL_NOT_REQUESTED');
      await audit({ action: 'admin.step_up', actorType: 'admin', actorId: admin, targetType: 'admin', targetId: admin, details: { purpose: 'test_run.purge_all' }, at: `now() - interval '24 hours 1 minute'` });
      await refused(pool(), 'PURGE_ALL_NOT_REQUESTED', 'a PURGE ALL of yesterday');
      // A forged summary or request time changes nothing: the chain decides.
      await run(`ALTER TABLE test_runs DISABLE TRIGGER test_runs_purge_guard`);
      await run(`UPDATE test_runs SET purge_summary = '{"all": true}', purge_requested_at = now() WHERE id = '${asked}'`);
      await run(`ALTER TABLE test_runs ENABLE TRIGGER test_runs_purge_guard`);
      await refused(pool(), 'PURGE_ALL_NOT_REQUESTED', 'a forged summary');
      const su = await audit({ action: 'admin.step_up', actorType: 'admin', actorId: admin, targetType: 'admin', targetId: admin, details: { purpose: 'test_run.purge_all' } });
      // A run of that PURGE ALL still PURGING (its step-up id the database's) holds the sweep back.
      await run(`ALTER TABLE test_runs DISABLE TRIGGER test_runs_purge_guard`);
      await run(`UPDATE test_runs SET purge_step_up_id = ${su} WHERE id = '${asked}'`);
      await run(`ALTER TABLE test_runs ENABLE TRIGGER test_runs_purge_guard`);
      await refused(pool(), 'PURGE_ALL_NOT_DONE');
      await run(`UPDATE test_runs SET purge_state = 'PAUSED', purge_reason = 'PURGE_STUCK' WHERE id = '${asked}'`);
      expect((await one<{ r: { phase: string; deletedAccounts: string[] } }>(`SELECT orbes_purge_test_pool_batch(500) AS r`)).r).toMatchObject({ phase: 'POOL_DONE', deletedAccounts: [] });
      // The start guards: the replica role (set by this superuser), then a definer function owned by no superuser.
      await refused(
        db().transaction().execute(async (tx) => {
          await sql`SET LOCAL session_replication_role = replica`.execute(tx);
          await sql.raw(`SELECT orbes_purge_test_run_batch('${asked}', 10)`).execute(tx);
        }),
        'PURGE_REPLICA_MODE',
      );
      await refused(
        db().transaction().execute(async (tx) => {
          await sql.raw(`ALTER FUNCTION orbes_purge_test_run_batch(uuid, int) OWNER TO ${APP_ROLE}`).execute(tx);
          await sql.raw(`SELECT orbes_purge_test_run_batch('${asked}', 10)`).execute(tx);
        }),
        'PURGE_NOT_SUPERUSER',
      );
      expect((await one<{ su: boolean }>(`SELECT r.rolsuper AS su FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'orbes_purge_test_run_batch'`)).su).toBe(true);
    });

    it('refuses to roll back while a tombstone or a purge exists, naming the counts; without them it goes down, and up again', async () => {
      const counts = [await count('audit_purge_gaps'), await count('test_runs WHERE purge_state IS NOT NULL')];
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[1]).toBeGreaterThan(0);
      const lastApplied = async () => (await createMigrator(db()).getMigrations()).filter((m) => m.executedAt).map((m) => m.name).at(-1);
      const message = (n: readonly number[]) => `migration 0066_test_purge cannot be rolled back: ${n[0]} audit tombstones and ${n[1]} test purges exist`;
      await expect(downTo0065(db())).rejects.toThrow(message(counts));
      expect(await lastApplied()).toBe(NAME);
      await run(`ALTER TABLE audit_purge_gaps DISABLE TRIGGER audit_purge_gaps_append_only`);
      await run(`DELETE FROM audit_purge_gaps`);
      await run(`ALTER TABLE audit_purge_gaps ENABLE TRIGGER audit_purge_gaps_append_only`);
      await expect(downTo0065(db())).rejects.toThrow(message([0, counts[1]!]));
      await run(`ALTER TABLE test_runs DISABLE TRIGGER test_runs_purge_guard`);
      await run(`UPDATE test_runs SET ${['purge_state', 'purge_requested_at', 'purge_requested_by', 'purged_at', 'purge_summary', 'purge_step_up_id', 'purge_windows', 'purge_reason', 'purge_result'].map((c) => `${c} = NULL`).join(', ')}`);
      await run(`ALTER TABLE test_runs ENABLE TRIGGER test_runs_purge_guard`);
      const runs = await count('test_runs');
      expect(await downTo0065(db())).toEqual([NAME]);
      expect(await count('test_runs')).toBe(runs);
      expect((await migrateToLatest(db())).applied).toEqual([NAME]);
      expect(await count('purge_delete_tables')).toBe(PURGE_DELETE_TABLES.length);
      await windowsOpen();
    });
  });
}

describe('migration 0066_test_purge (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  cases({
    db: () => t.db,
    schemaAt0065: async () => {
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

describe.skipIf(!pgUrl)('migration 0066_test_purge (PostgreSQL)', () => {
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
  cases({ db: () => db, schemaAt0065: async () => null });
});

/**
 * A purge of a real test run, end to end, on PGlite (the rest is proven on seeded runs in PURGE.4): a draw of test
 * entrants only, drawn and confirmed by themselves, ended; the request as the service writes it (PURGE.5); the batches
 * until ACCOUNTS_DONE. Every test row of the release goes with its accounts; a real collector's account and entry in
 * another draw stay as they were; every audit row the purge deleted has its tombstone and the chain still links; no
 * audit row names a deleted account; the run's windows written once.
 */
describe('migration 0066_test_purge: a test run purged end to end (PGlite)', () => {
  let h: Harness;
  let f: LiveFixture;
  beforeAll(async () => {
    h = await createHarness({ app: { liveHub: { pulseMs: 0, cacheMs: 0 } } });
    f = await liveFixtureOn(h.ctx, h.clock);
    h.app.testEntrants.useTimers(false);
    h.app.testEntrants.sleep = async (ms) => {
      h.clock.advance(ms);
    };
    // CI runs at any hour: the forbidden windows answered open here (their own cases are above).
    await sql`CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`.execute(h.ctx.db);
  }, 120_000);
  afterAll(() => h?.close());

  it('deletes the run\'s entries, cancelled orders, their events, journal and audit rows (each with its tombstone), its test_run_entrants and its accounts; keeps the report, the release, a real collector\'s rows; the chain still links', async () => {
    const db = h.ctx.db;
    const tests = h.app.testEntrants;
    const HOUR = 3_600_000;
    const drive = async () => {
      for (let i = 0; i < 40; i++) {
        await tests.tick();
        await tests.settle();
        h.clock.advance(500);
      }
    };
    const draw = async (title: string) => {
      const now = h.clock.now().getTime();
      return (await poolDraw(h.ctx.services.drops, db, { modelId: f.modelId, title, quantity: 2, opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR), earlyAccessHours: 0 }, f.admin)).id;
    };
    // A real collector in another draw.
    const other = await draw('MONOLITHE · REAL DRAW');
    const real = await createAccount(db);
    await h.ctx.services.drops.enter(real.id, other, real.actor);
    // The test: six bots enter, the staff draws two places, the bots confirm them by themselves (an order each).
    const drop = await draw('MONOLITHE · TEST DRAW');
    const run = await tests.start(drop, { phrase: testPhrase(drop), tiers: { none: 6, titane: 0, platine: 0, palladium: 0 }, arrival: { mode: 'all', interestPct: 0 }, behaviour: { confirmPct: 100 } }, f.admin);
    await drive();
    h.clock.advance(2 * HOUR);
    await h.ctx.services.drops.draw(drop, f.admin);
    await tests.sweep();
    h.clock.advance(61_000);
    await tests.sweep();
    const ended = await tests.end(run.id, testPhrase(drop, true), f.admin);
    expect(ended.status).toBe('ENDED');
    const accounts = (await db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', run.id).execute()).map((r) => r.account_id);
    expect(accounts).toHaveLength(6);
    const orders = await db.selectFrom('orders').select(['id', 'status']).where('drop_id', '=', drop).execute();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.status === 'CANCELLED')).toBe(true);
    const realBefore = await db.selectFrom('drop_entries').selectAll().where('account_id', '=', real.id).execute();
    const auditBefore = Number((await db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);

    // The request, as TestPurgeService writes it: the step-up consumed and audited, then PURGING, then purge.start.
    await inTransaction(db, async (tx) => {
      await tx.updateTable('admin_users').set({ failed_logins: 0 }).where('id', '=', f.admin.id!).execute();
      await h.ctx.audit.record({ actor: f.admin, action: 'admin.step_up', targetType: 'admin', targetId: f.admin.id!, details: { purpose: `test_run.purge:${run.id}` } }, tx);
      await tx.updateTable('test_runs').set({ purge_state: 'PURGING', purge_requested_at: h.clock.now(), purge_requested_by: f.admin.id!, purge_summary: jsonText({ all: false }) }).where('id', '=', run.id).execute();
      await h.ctx.audit.record({ actor: f.admin, action: 'test_run.purge.start', targetType: 'test_run', targetId: run.id, details: {} }, tx);
    });

    const phases: string[] = [];
    let last: { phase: string; left: number; deleted: Record<string, number>; deletedAccounts: string[]; kept: Record<string, number> } | undefined;
    const deleted: Record<string, number> = {};
    for (let i = 0; i < 200 && last?.phase !== 'ACCOUNTS_DONE'; i++) {
      last = (await sql<{ r: NonNullable<typeof last> }>`SELECT orbes_purge_test_run_batch(${run.id}::uuid, 7) AS r`.execute(db)).rows[0]!.r;
      if (phases.at(-1) !== last.phase) phases.push(last.phase);
      for (const [table, n] of Object.entries(last.deleted)) deleted[table] = (deleted[table] ?? 0) + n;
      // Bounded: at most 7 rows a call, or one whole order, or 1 account (7 / 10, at least one).
      expect(last.deletedAccounts.length).toBeLessThanOrEqual(1);
    }
    expect(last?.phase).toBe('ACCOUNTS_DONE');
    expect(phases).toEqual(expect.arrayContaining(['ORDERS', 'ENTRY_AUDIT', 'ENTRIES', 'RUN_ENTRANTS', 'ACCOUNTS', 'ACCOUNTS_DONE']));
    expect(phases.indexOf('ORDERS')).toBeLessThan(phases.indexOf('ENTRIES'));
    expect(phases.indexOf('RUN_ENTRANTS')).toBeLessThan(phases.indexOf('ACCOUNTS'));
    expect(last?.kept).toEqual({ orders: 0, entries: 0, accounts: 0 });

    // Gone: the test's entries, orders and their events and journal, its run's entrants, its accounts and pool rows.
    expect(await db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop).execute()).toEqual([]);
    expect(await db.selectFrom('orders').select('id').where('id', 'in', orders.map((o) => o.id)).execute()).toEqual([]);
    expect(await db.selectFrom('order_events').select('id').where('order_id', 'in', orders.map((o) => o.id)).execute()).toEqual([]);
    expect(await db.selectFrom('event_journal').select('id').where('entity_type', '=', 'order').where('entity_id', 'in', orders.map((o) => o.id)).execute()).toEqual([]);
    expect(await db.selectFrom('test_run_entrants').select('account_id').where('run_id', '=', run.id).execute()).toEqual([]);
    expect(await db.selectFrom('accounts').select('id').where('id', 'in', accounts).execute()).toEqual([]);
    expect(await db.selectFrom('test_entrants').select('account_id').where('account_id', 'in', accounts).execute()).toEqual([]);
    expect(deleted.accounts).toBe(6);
    expect(deleted.orders).toBe(orders.length);
    // Kept: the run with its report and its windows, the release, the real collector's account and entry as they were.
    const kept = await db.selectFrom('test_runs').selectAll().where('id', '=', run.id).executeTakeFirstOrThrow();
    expect(kept.report).toEqual(ended.report ? expect.objectContaining({ passed: ended.report.passed }) : null);
    expect(kept.purge_windows).toMatchObject({ toId: kept.purge_step_up_id, accounts: expect.arrayContaining(accounts) });
    expect((kept.purge_windows as { accounts: string[] }).accounts).toHaveLength(6);
    expect(await db.selectFrom('drops').select('id').where('id', '=', drop).execute()).toHaveLength(1);
    expect(await db.selectFrom('drop_entries').selectAll().where('account_id', '=', real.id).execute()).toEqual(realBefore);
    expect(await db.selectFrom('accounts').select('id').where('id', '=', real.id).execute()).toHaveLength(1);

    // The audit: each row deleted has its tombstone; no row names a deleted account; the chain links over the gaps.
    const gaps = await db.selectFrom('audit_purge_gaps').selectAll().orderBy('id').execute();
    expect(gaps.length).toBe(deleted.audit_logs);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.run_id === run.id)).toBe(true);
    const auditAfter = Number((await db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    expect(auditAfter).toBe(auditBefore + 2 - gaps.length);
    const naming = await db.selectFrom('audit_logs').select(['id', 'action']).where((eb) => eb.or([eb('actor_id', 'in', accounts), eb('target_id', 'in', accounts)])).execute();
    expect(naming).toEqual([]);
    const rows = await db.selectFrom('audit_logs').select(['id', 'prev_hash', 'hash']).execute();
    const chain = [...rows, ...gaps].sort((a, b) => a.id - b.id);
    let prev = toHex(new Uint8Array(32));
    for (const row of chain) {
      expect(toHex(row.prev_hash), `id ${row.id}`).toBe(prev);
      prev = toHex(row.hash);
    }
    // The tail stays: the step-up, the purge's start and every row after the run's range.
    expect(Math.max(...gaps.map((g) => g.id))).toBeLessThan(kept.purge_step_up_id!);
    // Done: a further call finds nothing more; the run then set DONE by the service (PURGE.5).
    const again = (await sql<{ r: { phase: string; left: number } }>`SELECT orbes_purge_test_run_batch(${run.id}::uuid, 500) AS r`.execute(db)).rows[0]!.r;
    expect(again).toMatchObject({ phase: 'ACCOUNTS_DONE', left: 0 });
  }, 240_000);
});
