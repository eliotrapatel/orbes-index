/**
 * The PLATFORM RESET's plan (lot PURGE, step PURGE.8; plan §B.1, B1.plan, M17, F7, G4, G5, G10): db/reset-plan.ts, the
 * tables the migrations create (test/support/expected-tables.ts, Kysely's two added) and the database's own plan
 * (`platform_reset_plan`, migration 0067) are one plan, so a future migration that adds a table fails here until both
 * plans class it; and the reset function, read from the database itself (`pg_get_functiondef`), carries that plan's
 * rules: every partly kept table's rule, every foreign key from a kept table into a wiped one handled, the step-8 order,
 * the numbering locks in the services' own forms, the gate's rule column by column.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { ADVISORY_LOCK } from '../../src/server/db/connection.js';
import {
  RESET_CLASSES,
  RESET_DELETE_AFTER_TRUNCATE,
  RESET_GATE_CHANGED,
  RESET_GATE_UNCHANGED,
  RESET_PARTLY_RULES,
  RESET_PLAN,
  RESET_PURPOSES,
} from '../../src/server/db/reset-plan.js';
import { INVOICE_KINDS, PARTNER_INVOICE_KINDS, PLATFORM_RESET_CLASSES, PLATFORM_RESET_PURPOSES } from '../../src/server/db/schema.js';
import { serialLockKey } from '../../src/server/services/issuance.js';
import { LIVE_ROOM_OPENS_MINUTES } from '../../src/server/services/live.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { EXPECTED_TABLES } from '../support/expected-tables.js';

const of = (kind: string) => Object.entries(RESET_PLAN).filter(([, k]) => k === kind).map(([t]) => t).sort();

describe('the PLATFORM RESET plan', () => {
  let t: TestDb;
  let def: string;
  beforeAll(async () => {
    t = await createTestDb();
    def = (await sql<{ def: string }>`SELECT pg_get_functiondef('orbes_platform_reset(uuid, int, timestamptz)'::regprocedure) AS def`.execute(t.db)).rows[0]!.def;
  }, 120_000);
  afterAll(() => t?.close());
  const rows = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows;

  it('classes exactly the tables the migrations create, Kysely\'s two included: KEEP 40, PARTLY 8, WIPE 116 = 164', () => {
    expect(Object.keys(RESET_PLAN).sort()).toEqual([...EXPECTED_TABLES, 'kysely_migration', 'kysely_migration_lock'].sort());
    expect([of('KEEP').length, of('PARTLY').length, of('WIPE').length, Object.keys(RESET_PLAN).length]).toEqual([40, 8, 116, 164]);
    expect(Object.values(RESET_PLAN).every((k) => RESET_CLASSES.includes(k))).toBe(true);
    expect([...RESET_CLASSES]).toEqual([...PLATFORM_RESET_CLASSES]);
    expect([...RESET_PURPOSES]).toEqual([...PLATFORM_RESET_PURPOSES]);
    // What the owner kept (ANSWERS 2): the catalogue, the settings, the console logins, the key; the founding list in part.
    for (const table of ['categories', 'models', 'skus', 'admin_users', 'cryptographic_keys', 'club_tiers', 'purge_delete_tables', 'platform_reset_plan']) expect(RESET_PLAN[table], table).toBe('KEEP');
    for (const table of ['preregistrations', 'acquisition_sources', 'links', 'platform_reset_gate']) expect(RESET_PLAN[table], table).toBe('PARTLY');
    // What he wiped: every collector account, the partner brands, the marketing links but those the list needs.
    for (const table of ['accounts', 'partners', 'partner_experiences', 'partner_invoices', 'audit_logs', 'audit_purge_gaps', 'sessions', 'drops']) expect(RESET_PLAN[table], table).toBe('WIPE');
  });

  it('the database\'s plan is the code\'s, and the tables of public are exactly the plan\'s', async () => {
    const plan = await rows<{ tbl: string; kind: string }>(`SELECT tbl, kind FROM platform_reset_plan ORDER BY tbl`);
    expect(Object.fromEntries(plan.map((p) => [p.tbl, p.kind]))).toEqual(RESET_PLAN);
    const tables = await rows<{ t: string }>(`SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
    expect(tables.map((x) => x.t)).toEqual(Object.keys(RESET_PLAN).sort());
  });

  it('every partly kept table has its rule in words, and in the reset function its step and its proof', () => {
    expect(Object.keys(RESET_PARTLY_RULES).sort()).toEqual(of('PARTLY'));
    for (const [table, words] of Object.entries(RESET_PARTLY_RULES)) {
      expect(words.length, table).toBeGreaterThan(20);
      expect(def, table).toContain(table);
    }
    // Each one's step (§B.2 d 8) and each one's proof (§B.2 d 9).
    for (const step of [
      'UPDATE preregistrations SET account_id = NULL, matched_at = NULL',
      "UPDATE links SET destination = 'RELEASES', drop_id = NULL WHERE destination = 'RELEASE'",
      'DELETE FROM acquisition_sources s WHERE NOT',
      'DELETE FROM links l WHERE NOT EXISTS (SELECT 1 FROM acquisition_sources s WHERE s.link_id = l.id)',
      'DELETE FROM segments s WHERE',
      "DELETE FROM revocations WHERE target_type IS DISTINCT FROM 'KEY'",
      'DELETE FROM media_objects m WHERE NOT',
      'UPDATE vault_rewards SET given = 0 WHERE given > 0',
      'UPDATE platform_reset_gate',
    ]) {
      expect(def, step).toContain(step);
    }
    for (const proof of ['media_objects:', 'revocations:', 'segments:', 'vault_rewards:', 'preregistrations:', 'acquisition_sources:', 'links:', 'platform_reset_gate:']) {
      expect(def, proof).toContain(`'${proof}`);
    }
  });

  it('every foreign key from a kept or partly kept table into a wiped one is one RESET_DELETE_AFTER_TRUNCATE empties after its re-point or clear; those two reference no other wiped table', async () => {
    const fks = await rows<{ child: string; parent: string; cols: string }>(`
      SELECT cl.relname AS child, rl.relname AS parent,
             (SELECT string_agg(a.attname, ',' ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY AS k (n, o) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols
        FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class rl ON rl.oid = c.confrelid
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace ORDER BY 1, 3`);
    const kept = (t: string) => RESET_PLAN[t] !== 'WIPE';
    const intoWiped = fks.filter((k) => kept(k.child) && !kept(k.parent));
    expect(intoWiped.map((k) => `${k.child}.${k.cols} -> ${k.parent}`)).toEqual(['links.drop_id -> drops', 'preregistrations.account_id -> accounts']);
    expect([...new Set(intoWiped.map((k) => k.parent))].sort()).toEqual([...RESET_DELETE_AFTER_TRUNCATE].sort());
    // Each one cleared or re-pointed before its parent's DELETE, in the function.
    const at = (s: string) => {
      const i = def.indexOf(s);
      expect(i, s).toBeGreaterThan(0);
      return i;
    };
    expect(at('UPDATE links SET destination')).toBeLessThan(at('DELETE FROM drops WHERE parent_drop_id IS NOT NULL'));
    expect(at('UPDATE preregistrations SET account_id = NULL')).toBeLessThan(at('DELETE FROM accounts;'));
    // The TRUNCATE leaves them out; nothing they reference is wiped but themselves (else the TRUNCATE would refuse).
    expect(def).toContain(`p.kind = 'WIPE' AND p.tbl NOT IN ('drops', 'accounts')`);
    expect(fks.filter((k) => RESET_DELETE_AFTER_TRUNCATE.includes(k.child) && !kept(k.parent) && k.parent !== k.child)).toEqual([]);
    // Every other foreign key into a wiped table comes from a wiped table: one TRUNCATE takes both.
    expect(fks.filter((k) => !kept(k.parent) && kept(k.child)).length).toBe(2);
  });

  it('the order, read from the function itself: guards, locks, other connections, the plan, the collectors, the capture, the snapshot, one TRUNCATE, steps (i) to (ix), the proofs, the last on the clock, then the gate', () => {
    const markers = [
      "MESSAGE = 'RESET_NOT_SUPERUSER'",
      "MESSAGE = 'RESET_REPLICA_MODE'",
      "MESSAGE = 'RESET_TRIGGER_DISABLED'",
      'FROM platform_reset_gate WHERE id = 1 FOR UPDATE',
      "MESSAGE = 'RESET_NOT_AUTHORIZED'",
      'UPDATE platform_reset_gate SET authorized_by = NULL',
      "MESSAGE = 'RESET_WINDOW'",
      "MESSAGE = 'RESET_TEST_RUNNING'",
      "MESSAGE = 'RESET_LIVE_OPEN'",
      'pg_try_advisory_xact_lock(',
      'pg_advisory_xact_lock(r.key, r.sub)',
      "MESSAGE = 'RESET_OTHER_CONNECTIONS'",
      "MESSAGE = 'RESET_UNPLANNED_TABLES'",
      'LOCK TABLE public.%I IN %s MODE',
      "MESSAGE = 'RESET_COLLECTORS_CHANGED'",
      "'skus', (SELECT",
      "'recent24h'",
      'SELECT to_jsonb(x) INTO v_gate FROM platform_reset_gate',
      "'TRUNCATE TABLE '",
      'EXECUTE v_stmt',
      // (i) to (ix)
      'UPDATE preregistrations SET account_id = NULL, matched_at = NULL',
      "UPDATE links SET destination = 'RELEASES'",
      'DELETE FROM drops WHERE parent_drop_id IS NOT NULL',
      'DELETE FROM drops;',
      'DELETE FROM accounts;',
      'DELETE FROM acquisition_sources s WHERE NOT',
      'DELETE FROM links l WHERE NOT EXISTS',
      'DELETE FROM segments s WHERE',
      'DELETE FROM revocations WHERE',
      'DELETE FROM media_objects m WHERE NOT',
      'UPDATE vault_rewards SET given = 0 WHERE given > 0',
      // the proofs, the last one on the clock, then the gate's own step
      "'kept table %s changed",
      "'wiped table %s still has %s rows'",
      'orbes_maintenance_window(clock_timestamp())',
      "MESSAGE = 'RESET_PROOF_FAILED'",
      'SET last_reset_at = now(), last_reset_by = p_admin, resets = resets + 1, last_reset_details = v_details',
    ];
    const positions = markers.map((m) => [m, def.indexOf(m)] as const);
    for (const [m, i] of positions) expect(i, m).toBeGreaterThan(0);
    for (let i = 1; i < positions.length; i++) expect(positions[i]![1], `${positions[i - 1]![0]} before ${positions[i]![0]}`).toBeGreaterThan(positions[i - 1]![1]);
    // One TRUNCATE, never a CASCADE; no replica mode anywhere (C7); the window's 5-minute margin.
    expect(def.match(/EXECUTE v_stmt/g)).toHaveLength(1);
    expect(def).toContain(`IF v_stmt IS NULL OR v_stmt ~* 'cascade' THEN`);
    expect(def).toContain(`|| ' RESTART IDENTITY' INTO v_stmt`);
    expect(def).not.toMatch(/SET\s+(LOCAL\s+)?session_replication_role/i);
    expect(def).toContain(`orbes_maintenance_window_within(now(), interval '5 minutes')`);
    // A LIVE room opens as the services say it does when its release names no minutes.
    expect(def).toContain(`coalesce(d.room_opens_minutes, ${LIVE_ROOM_OPENS_MINUTES.default})`);
  });

  it('the locks are the services\' own: LIVE_ENGINE tried, AUDIT_CHAIN and CATEGORY_ALLOCATION one-key, INVOICE_NUMBER and PARTNER_INVOICE_NUMBER (year * 2 + kind) and SERIAL_ALLOCATION (serialLockKey) two-part, for this UTC year and the next', async () => {
    expect(def).toContain(`pg_try_advisory_xact_lock(${ADVISORY_LOCK.LIVE_ENGINE}::bigint)`);
    expect(def).toContain(`pg_advisory_xact_lock(${ADVISORY_LOCK.AUDIT_CHAIN}::bigint)`);
    expect(def).toContain(`pg_advisory_xact_lock(${ADVISORY_LOCK.CATEGORY_ALLOCATION}::bigint)`);
    expect(def).toContain(`v_year := extract(year FROM now() AT TIME ZONE 'UTC')::int`);
    expect(def).toContain('orbes_platform_reset_numbering_locks(v_year + 1)');
    for (const year of [2026, 2027, 2099]) {
      const got = await rows<{ key: number; sub: number }>(`SELECT key, sub FROM orbes_platform_reset_numbering_locks(${year}) ORDER BY key, sub`);
      const want = [
        ...INVOICE_KINDS.map((k) => ({ key: ADVISORY_LOCK.INVOICE_NUMBER, sub: year * 2 + INVOICE_KINDS.indexOf(k) })),
        ...PARTNER_INVOICE_KINDS.map((k) => ({ key: ADVISORY_LOCK.PARTNER_INVOICE_NUMBER, sub: year * 2 + PARTNER_INVOICE_KINDS.indexOf(k) })),
        ...Array.from({ length: 32 }, (_, c) => ({ key: ADVISORY_LOCK.SERIAL_ALLOCATION, sub: serialLockKey(year, c) })),
      ].sort((a, b) => a.key - b.key || a.sub - b.sub);
      expect(got, String(year)).toEqual(want);
    }
    // 2 one-key + (2 + 2 + 32) x 2 years = 74 (the LIVE_ENGINE try-lock apart).
    expect(2 + (INVOICE_KINDS.length + PARTNER_INVOICE_KINDS.length + 32) * 2).toBe(74);
  });

  it('the gate\'s rule, column by column: the reset changes its four columns only, the holder, LOCK RESET and the cleared authorization checked one by one', async () => {
    const columns = (await rows<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'platform_reset_gate' ORDER BY ordinal_position`)).map((x) => x.c);
    expect([...RESET_GATE_CHANGED, ...RESET_GATE_UNCHANGED].sort()).toEqual([...columns].sort());
    expect(RESET_GATE_CHANGED.filter((c) => RESET_GATE_UNCHANGED.includes(c))).toEqual([]);
    // The function: everything but the four compared as a whole to the snapshot, then each one named.
    const minus = `ARRAY[${RESET_GATE_CHANGED.map((c) => `'${c}'`).join(', ')}]`;
    expect(def).toContain(`(to_jsonb(g2) - ${minus}) IS DISTINCT FROM (v_gate - ${minus})`);
    for (const check of [
      `g2.holder_admin_id IS DISTINCT FROM (v_gate ->> 'holder_admin_id')::uuid`,
      `g2.launched_at IS DISTINCT FROM (v_gate ->> 'launched_at')::timestamptz`,
      `g2.launched_by IS DISTINCT FROM (v_gate ->> 'launched_by')::uuid`,
      `g2.authorized_by IS NOT NULL OR g2.authorized_at IS NOT NULL OR g2.authorized_purpose IS NOT NULL`,
      `g2.resets IS DISTINCT FROM (v_gate ->> 'resets')::int + 1`,
      `g2.last_reset_at IS DISTINCT FROM now() OR g2.last_reset_by IS DISTINCT FROM p_admin`,
      `g2.last_reset_details IS DISTINCT FROM v_details`,
    ]) {
      expect(def, check).toContain(check);
    }
    // At the step-9 proof, the gate is its snapshot (taken once its authorization was cleared, at step 1).
    expect(def).toContain(`(SELECT to_jsonb(x) FROM platform_reset_gate x WHERE x.id = 1) IS DISTINCT FROM v_gate`);
    // The same rule in words.
    for (const c of [...RESET_GATE_CHANGED, 'holder', 'launched_at', 'launched_by', 'authorization']) expect(RESET_PARTLY_RULES.platform_reset_gate, c).toContain(c);
  });
});
