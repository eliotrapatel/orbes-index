import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import { isCheckViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { migrateDown, migrateToLatest, migrationStatus, MIGRATIONS } from '../../src/server/db/migrate.js';

const EXPECTED_TABLES = [
  'accounts', 'admin_users', 'anomalies', 'audit_logs', 'authentication_events', 'categories', 'codes',
  'collections', 'cryptographic_keys', 'genomes', 'models', 'ownership', 'ownership_transfers', 'product_status_history',
  'products', 'retailers', 'revocations', 'scan_events', 'scan_tokens', 'service_records', 'sessions', 'warranties',
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

  it('0008 adds RETAIL, the points of sale, warranties.retailer_id, scan_events.admin_id and SALE_ACTIVATION; its down step restores 0006', async () => {
    const roleCheck = async (db: Kysely<any> = t.db) =>
      (await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'admin_users_role_check'`.execute(db)).rows[0]?.def ?? '';
    const purposeCheck = async (db: Kysely<any> = t.db) =>
      (await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'scan_tokens_purpose_check'`.execute(db)).rows[0]?.def ?? '';
    const columns = async (table: string, db: Kysely<any> = t.db) =>
      (await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY column_name`.execute(db)).rows.map((r) => r.column_name);
    const tables = async (db: Kysely<any> = t.db) =>
      (await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`.execute(db)).rows.map((r) => r.table_name);

    expect(await roleCheck()).toContain("'RETAIL'::text");
    expect(await purposeCheck()).toContain("'SALE_ACTIVATION'::text");
    expect(await columns('retailers')).toEqual(['active', 'city', 'country', 'created_at', 'id', 'name', 'updated_at']);
    expect(await columns('warranties')).toContain('retailer_id');
    expect(await columns('scan_events')).toContain('admin_id');

    // Only an ADMIN_TEST scan names a console user.
    const admin = (
      await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('seller@orbes.test', 'seller@orbes.test', 'scrypt$x', 'RETAIL') RETURNING id`.execute(t.db)
    ).rows[0];
    const scan = (rows: string) => sql.raw(`INSERT INTO scan_events (event_type, result_state, admin_id) VALUES ${rows}`).execute(t.db);
    await expect(scan(`('VERIFY', 'AUTHENTIC', '${admin.id}')`)).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_events_admin_id_admin_test'));
    await scan(`('ADMIN_TEST', 'AUTHENTIC', '${admin.id}')`);
    // Points of sale: one per name and city, ignoring case; never deleted.
    await sql`INSERT INTO retailers (name, city, country) VALUES ('ORBES Paris', 'Paris', 'FR')`.execute(t.db);
    await expect(sql`INSERT INTO retailers (name, city) VALUES ('orbes paris', 'PARIS')`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e, 'retailers_name_city_unique'));
    await expect(sql`INSERT INTO retailers (name, country) VALUES ('X', 'fr')`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(sql`DELETE FROM retailers`.execute(t.db)).rejects.toSatisfy(isGuardViolation);

    const m = MIGRATIONS['0008_retail_mode']!;
    expect(m.down).toBeTypeOf('function');
    // A warranty named by its point of sale keeps the name as text; a seller goes with its sessions, never promoted.
    const shop = (await sql<{ id: string }>`SELECT id FROM retailers WHERE name = 'ORBES Paris'`.execute(t.db)).rows[0];
    await sql`INSERT INTO categories (id, code, name) VALUES (30, 'Q', 'Down test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (30, 'M', 'RING', 'DOWN') RETURNING id`.execute(t.db)).rows[0];
    const product = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-Q-00001', ${(26 << 25) | (30 << 20) | 1}, 2026, 30, 1, 'DOWN-1', ${model.id}, 'SILVER') RETURNING id`.execute(t.db)
    ).rows[0];
    await sql`INSERT INTO warranties (product_id, duration_months, start_date, retailer_id) VALUES (${product.id}, 24, '2026-10-01', ${shop.id})`.execute(t.db);
    await sql`INSERT INTO sessions (id_hash, subject_type, subject_id, csrf_token, expires_at) VALUES (decode(repeat('ab', 32), 'hex'), 'admin', ${admin.id}, 'c', now() + interval '1 hour')`.execute(t.db);
    await t.db.transaction().execute(async (tx) => {
      await m.down!(tx);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM admin_users WHERE email_normalized = 'seller@orbes.test'`.execute(tx)).rows[0].n).toBe(0);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sessions`.execute(tx)).rows[0].n).toBe(0);
      expect((await sql<{ retailer: string | null }>`SELECT retailer FROM warranties WHERE product_id = ${product.id}`.execute(tx)).rows[0].retailer).toBe('ORBES Paris');
      expect(await roleCheck(tx)).toBe("CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERATOR'::text, 'AUDITOR'::text])))");
      // As 0001 wrote it (PostgreSQL normalises a one-value IN to an equality).
      expect(await purposeCheck(tx)).toBe("CHECK ((purpose = 'FIRST_REGISTRATION'::text))");
      expect(await tables(tx)).not.toContain('retailers');
      expect(await columns('warranties', tx)).not.toContain('retailer_id');
      expect(await columns('scan_events', tx)).not.toContain('admin_id');
      await m.up(tx);
    });
    expect(await roleCheck()).toContain("'RETAIL'::text");
    expect(await tables()).toContain('retailers');
    await sql`DELETE FROM scan_events`.execute(t.db);
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
