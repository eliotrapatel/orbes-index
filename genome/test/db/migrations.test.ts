import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import { migrateDown, migrateToLatest, migrationStatus, MIGRATIONS } from '../../src/server/db/migrate.js';

const EXPECTED_TABLES = [
  'accounts', 'admin_users', 'anomalies', 'audit_logs', 'authentication_events', 'categories', 'codes',
  'collections', 'cryptographic_keys', 'genomes', 'models', 'ownership', 'ownership_transfers', 'product_status_history',
  'products', 'revocations', 'scan_events', 'scan_tokens', 'service_records', 'sessions', 'warranties',
];

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrated: false });
  });
  afterAll(() => t.close());

  it('apply to an empty database, then are a no-op', async () => {
    const first = await migrateToLatest(t.db);
    expect(first.applied).toEqual(Object.keys(MIGRATIONS));
    const second = await migrateToLatest(t.db);
    expect(second.applied).toEqual([]);
    const status = await migrationStatus(t.db);
    expect(status.every((m) => m.executedAt instanceof Date)).toBe(true);
  });

  it('create every contract table and the product_overview view', async () => {
    const r = await sql<{ table_name: string; table_type: string }>`
      SELECT table_name, table_type FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%' ORDER BY table_name`.execute(t.db);
    const tables = r.rows.filter((x) => x.table_type === 'BASE TABLE').map((x) => x.table_name);
    const views = r.rows.filter((x) => x.table_type === 'VIEW').map((x) => x.table_name);
    expect(tables).toEqual(EXPECTED_TABLES);
    expect(views).toEqual(['product_overview']);
  });

  it('seed no business data', async () => {
    for (const table of EXPECTED_TABLES) {
      const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(t.db);
      expect(r.rows[0].n, table).toBe(0);
    }
  });

  it('use ON DELETE RESTRICT for every foreign key, and index every FK column', async () => {
    const fks = await sql<{ table: string; columns: string; delete_rule: string }>`
      SELECT c.conrelid::regclass::text AS table,
             (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
             c.confdeltype AS delete_rule
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`.execute(t.db);
    expect(fks.rows.length).toBeGreaterThanOrEqual(25);
    for (const fk of fks.rows) expect(fk.delete_rule, `${fk.table}.${fk.columns}`).toBe('r');

    const idx = await sql<{ table: string; first_col: string }>`
      SELECT i.indrelid::regclass::text AS table, a.attname AS first_col
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indpred IS NULL`.execute(t.db);
    const leading = new Set(idx.rows.map((r) => `${r.table}.${r.first_col}`));
    for (const fk of fks.rows) expect(leading.has(`${fk.table}.${fk.columns.split(',')[0]}`), `${fk.table}.${fk.columns}`).toBe(true);
  });

  it('create the contract indexes', async () => {
    const r = await sql<{ indexdef: string }>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`.execute(t.db);
    const defs = r.rows.map((x) => x.indexdef.replace(/\s+/g, ' '));
    const has = (re: RegExp) => defs.some((d) => re.test(d));
    expect(has(/ON public\.scan_events USING btree \(product_id, occurred_at\)/)).toBe(true);
    expect(has(/ON public\.scan_events USING btree \(code_id, occurred_at\)/)).toBe(true);
    expect(has(/ON public\.anomalies USING btree \(status, severity\)/)).toBe(true);
    expect(has(/ON public\.audit_logs USING btree \(occurred_at\)/)).toBe(true);
    // Partial unique indexes.
    expect(has(/UNIQUE INDEX .* ON public\.cryptographic_keys .*\(status\) WHERE \(status = 'ACTIVE'::text\)/)).toBe(true);
    expect(has(/UNIQUE INDEX .* ON public\.ownership .*\(product_id\) WHERE \(ended_at IS NULL\)/)).toBe(true);
    expect(has(/UNIQUE INDEX .* ON public\.ownership_transfers .*\(product_id\) WHERE \(status = 'PENDING'::text\)/)).toBe(true);
    expect(has(/UNIQUE INDEX .* ON public\.anomalies .*\(product_id, type\) WHERE \(status = ANY/)).toBe(true);
  });

  it('0006 adds admin_users.password_change_required (NOT NULL, false by default) and its down step drops it', async () => {
    const column = async (db: Kysely<any> = t.db) =>
      (
        await sql<{ data_type: string; is_nullable: string; column_default: string | null }>`
          SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'admin_users' AND column_name = 'password_change_required'`.execute(db)
      ).rows;
    expect(await column()).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    // A row written by code that does not know the column (the previous image) gets false.
    const row = await sql<{ password_change_required: boolean }>`
      INSERT INTO admin_users (email_normalized, email, password_hash, role)
      VALUES ('old@orbes.test', 'old@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING password_change_required`.execute(t.db);
    expect(row.rows[0].password_change_required).toBe(false);
    // Down then up, run directly: later migrations of other features do not touch this column.
    const m = MIGRATIONS['0006_admin_password_change_required']!;
    expect(m.down).toBeTypeOf('function');
    await t.db.transaction().execute(async (tx) => {
      await m.down!(tx);
      expect(await column(tx)).toEqual([]);
      await m.up(tx);
    });
    expect(await column()).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    await sql`DELETE FROM admin_users WHERE email_normalized = 'old@orbes.test'`.execute(t.db);
  });

  it('roll back cleanly and re-apply', async () => {
    // One migration per call, newest first, until none is applied.
    const reverted: string[] = [];
    for (let i = 0; i < Object.keys(MIGRATIONS).length; i++) reverted.push(...(await migrateDown(t.db)).reverted);
    expect(reverted).toEqual(Object.keys(MIGRATIONS).reverse());
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'`.execute(t.db);
    expect(r.rows[0].n).toBe(0);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS));
  });
});
