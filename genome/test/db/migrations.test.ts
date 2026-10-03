import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import { isCheckViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { createMigrator, migrateDown, migrateToLatest, migrationStatus, MIGRATIONS } from '../../src/server/db/migrate.js';
import * as m0007 from '../../src/server/db/migrations/0007_print_batch_indexes.js';
import * as m0009 from '../../src/server/db/migrations/0009_scan_daily_stats.js';
import * as m0011 from '../../src/server/db/migrations/0011_scan_token_transfer_accept.js';

const EXPECTED_TABLES = [
  'account_recovery_codes', 'accounts', 'admin_users', 'anomalies', 'audit_logs', 'authentication_events', 'categories', 'codes',
  'collections', 'cryptographic_keys', 'genomes', 'models', 'ownership', 'ownership_certificates', 'ownership_transfers', 'product_status_history',
  'products', 'retailers', 'revocations', 'scan_daily_stats', 'scan_events', 'scan_reports', 'scan_tokens', 'service_records',
  'sessions', 'warranties',
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
    // 0004: one report per scan, the admin who closed a case, the Cases queue.
    expect(has(/UNIQUE INDEX scan_reports_scan_event_id_key ON public\.scan_reports USING btree \(scan_event_id\)/)).toBe(true);
    expect(has(/INDEX scan_reports_handled_by_idx ON public\.scan_reports USING btree \(handled_by\)/)).toBe(true);
    expect(has(/INDEX scan_reports_status_created_idx ON public\.scan_reports USING btree \(status, created_at\)/)).toBe(true);
    // 0005: one open recovery code per account, and the full indexes that lead with its foreign keys.
    expect(
      has(/UNIQUE INDEX account_recovery_codes_single_open ON public\.account_recovery_codes USING btree \(account_id\) WHERE \(\(used_at IS NULL\) AND \(revoked_at IS NULL\)\)/),
    ).toBe(true);
    expect(has(/INDEX account_recovery_codes_account_idx ON public\.account_recovery_codes USING btree \(account_id, created_at\)/)).toBe(true);
    expect(has(/INDEX account_recovery_codes_created_by_idx ON public\.account_recovery_codes USING btree \(created_by\)/)).toBe(true);
    // 0007: printing by production batch, codes by issue day.
    expect(has(/INDEX products_production_batch_idx ON public\.products USING btree \(production_batch\)$/)).toBe(true);
    expect(has(/INDEX codes_created_at_idx ON public\.codes USING btree \(created_at\)$/)).toBe(true);
    // 0013: one certificate per token hash; a piece's certificates, an ownership period's.
    expect(has(/UNIQUE INDEX ownership_certificates_token_hash_key ON public\.ownership_certificates USING btree \(token_hash\)$/)).toBe(true);
    expect(has(/INDEX ownership_certificates_product_idx ON public\.ownership_certificates USING btree \(product_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX ownership_certificates_ownership_idx ON public\.ownership_certificates USING btree \(ownership_id, created_at\)$/)).toBe(true);
  });

  /**
   * Every column, index, constraint and trigger of the public schema. Not the column positions: PostgreSQL
   * never reuses the number of a dropped column, so a column dropped and added again comes back one further.
   */
  const snapshotOf = async (db: Kysely<any>) =>
    (
      await sql<{ object: string }>`
        SELECT 'table ' || table_name || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS object
          FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
        UNION ALL SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%'
        UNION ALL SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
          FROM pg_constraint WHERE connamespace = 'public'::regnamespace
        UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
        ORDER BY 1`.execute(db)
    ).rows.map((r) => r.object);
  const snapshot = () => snapshotOf(t.db);

  /** Roll back until `name` is reverted: the schema with it applied, and without it. */
  async function rollBackTo(name: string): Promise<{ with: string[]; without: string[] }> {
    let withIt: string[] | undefined;
    for (let i = 0; i < Object.keys(MIGRATIONS).length && !withIt; i++) {
      const state = await snapshot();
      if ((await migrateDown(t.db)).reverted[0] === name) withIt = state;
    }
    expect(withIt, name).toBeDefined();
    return { with: withIt!, without: await snapshot() };
  }

  it('0010 down drops models.active and the guard on a model\'s identity, and nothing else; up again restores them', async () => {
    const latest = await snapshot();
    // Later migrations (0011…) are rolled back first, then 0010 alone.
    const { with: withActive, without: before } = await rollBackTo('0010_models_active');
    // PGlite's PostgreSQL also lists a NOT NULL as a constraint (models_active_not_null); PostgreSQL 16 does not.
    const added = withActive.filter((o) => !before.includes(o) && o !== 'constraint models models_active_not_null NOT NULL active');
    expect(added).toEqual(['table models active boolean NO true', 'trigger models models_immutable_identity']);
    expect(before.filter((o) => !withActive.includes(o))).toEqual([]);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0010_models_active');
    expect(await snapshot()).toEqual(latest);
  });

  it('0005 down restores the schema of 0004 exactly, and up again re-creates the recovery codes and the transfer pause', async () => {
    const latest = await snapshot();
    // Later migrations (0006…) are rolled back first, then 0005 alone.
    const { with: withRecovery, without: before } = await rollBackTo('0005_account_recovery');
    const added = withRecovery.filter((o) => !before.includes(o));
    expect(added.some((o) => o.startsWith('table account_recovery_codes '))).toBe(true);
    expect(added.filter((o) => o.startsWith('table accounts '))).toEqual(['table accounts transfers_frozen_until timestamp with time zone YES ']);
    // Nothing of 0005 is left, and nothing else changed.
    expect(before.filter((o) => o.includes('account_recovery_codes') || o.includes('transfers_frozen_until'))).toEqual([]);
    expect(withRecovery.filter((o) => !o.includes('account_recovery_codes') && !o.includes('transfers_frozen_until'))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0005_account_recovery');
    expect(await snapshot()).toEqual(latest);
  });

  it('0004 down restores the schema of 0003 exactly, and up again re-creates scan_reports', async () => {
    // Later migrations (0005…) are rolled back first, then 0004 alone.
    const latest = await snapshot();
    const { with: withReports, without: before } = await rollBackTo('0004_scan_reports');
    expect(withReports.some((o) => o.startsWith('table scan_reports '))).toBe(true);
    expect(before.filter((o) => o.includes('scan_reports'))).toEqual([]);
    // Only scan_reports went: everything else is as 0004 found it.
    expect(withReports.filter((o) => !o.includes('scan_reports'))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0004_scan_reports');
    expect(await snapshot()).toEqual(latest);
  });

  it('0007: adds the two print-batch indexes, and its down step drops exactly them', async () => {
    const indexes = async () =>
      (await sql<{ name: string; def: string }>`SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`.execute(t.db)).rows;
    const added = ['codes_created_at_idx', 'products_production_batch_idx'];
    const before = await indexes();
    expect(before.map((i) => i.name)).toEqual(expect.arrayContaining(added));
    await m0007.down(t.db);
    expect((await indexes()).map((i) => i.name)).toEqual(before.map((i) => i.name).filter((n) => !added.includes(n)));
    await m0007.up(t.db);
    expect(await indexes()).toEqual(before);
    expect(MIGRATIONS['0007_print_batch_indexes']).toBe(m0007);
  });

  it('0009: creates scan_daily_stats keyed by day, country, state and event type, and its down step drops exactly it', async () => {
    const columns = async () =>
      (
        await sql<{ table: string; column: string; type: string; nullable: string }>`
          SELECT table_name AS table, column_name AS column, data_type AS type, is_nullable AS nullable
          FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`.execute(t.db)
      ).rows;
    const before = await columns();
    expect(before.filter((c) => c.table === 'scan_daily_stats').map((c) => [c.column, c.type, c.nullable])).toEqual([
      ['day', 'date', 'NO'],
      ['country', 'character', 'NO'],
      ['result_state', 'text', 'NO'],
      ['event_type', 'text', 'NO'],
      ['n', 'integer', 'NO'],
    ]);
    const pk = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'scan_daily_stats'::regclass AND contype = 'p'`.execute(t.db);
    expect(pk.rows.map((r) => r.def)).toEqual(['PRIMARY KEY (day, country, result_state, event_type)']);
    // n ≥ 0, a two-letter country, never a staff scan.
    const insert = (v: Record<string, unknown>) =>
      sql`INSERT INTO scan_daily_stats (day, country, result_state, event_type, n)
          VALUES (${v.day ?? '2026-10-01'}, ${v.country ?? 'FR'}, ${v.state ?? 'AUTHENTIC'}, ${v.type ?? 'VERIFY'}, ${v.n ?? 1})`.execute(t.db);
    await expect(insert({ n: -1 })).rejects.toThrow(/check/i);
    await expect(insert({ country: 'fr' })).rejects.toThrow(/check/i);
    await expect(insert({ type: 'ADMIN_TEST' })).rejects.toThrow(/check/i);
    await expect(insert({ state: 'PENDING' })).rejects.toThrow(/check/i);
    await insert({ n: 0 });
    await expect(insert({ n: 2 })).rejects.toThrow(/duplicate key/i);
    await sql`DELETE FROM scan_daily_stats`.execute(t.db);

    await m0009.down(t.db);
    expect(await columns()).toEqual(before.filter((c) => c.table !== 'scan_daily_stats'));
    await m0009.up(t.db);
    expect(await columns()).toEqual(before);
    expect(MIGRATIONS['0009_scan_daily_stats']).toBe(m0009);
  });

  it('0006 adds admin_users.password_change_required (NOT NULL, false by default); its down step disables the accounts on a temporary password, then drops it', async () => {
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
    // A staff account still on its temporary password, signed in, and one disabled earlier: without the column, the
    // first would use its full role with a password an ADMIN was shown, for good.
    const staff = (
      await sql<{ id: string }>`
        INSERT INTO admin_users (email_normalized, email, password_hash, role, password_change_required)
        VALUES ('temp@orbes.test', 'temp@orbes.test', 'scrypt$x', 'OPERATOR', true) RETURNING id`.execute(t.db)
    ).rows[0];
    const earlier = new Date('2026-09-01T00:00:00.000Z');
    await sql`
      INSERT INTO admin_users (email_normalized, email, password_hash, role, password_change_required, disabled_at)
      VALUES ('gone@orbes.test', 'gone@orbes.test', 'scrypt$x', 'AUDITOR', true, ${earlier})`.execute(t.db);
    await sql`INSERT INTO sessions (id_hash, subject_type, subject_id, csrf_token, expires_at) VALUES (decode(repeat('cd', 32), 'hex'), 'admin', ${staff.id}, 'c', now() + interval '1 hour')`.execute(t.db);
    const state = async (db: Kysely<any>) =>
      (
        await sql<{ email_normalized: string; disabled_at: Date | null }>`
          SELECT email_normalized, disabled_at FROM admin_users WHERE email_normalized IN ('old@orbes.test', 'temp@orbes.test', 'gone@orbes.test') ORDER BY email_normalized`.execute(db)
      ).rows;
    // Down then up, run directly: later migrations of other features do not touch this column.
    const m = MIGRATIONS['0006_admin_password_change_required']!;
    expect(m.down).toBeTypeOf('function');
    await t.db.transaction().execute(async (tx) => {
      await m.down!(tx);
      expect(await column(tx)).toEqual([]);
      const after = await state(tx);
      expect(after.map((r) => [r.email_normalized, r.disabled_at !== null])).toEqual([
        ['gone@orbes.test', true],
        ['old@orbes.test', false],
        ['temp@orbes.test', true],
      ]);
      // An earlier date is kept.
      expect(after[0].disabled_at?.getTime()).toBe(earlier.getTime());
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sessions WHERE subject_id = ${staff.id}`.execute(tx)).rows[0].n).toBe(0);
      await m.up(tx);
    });
    expect(await column()).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    await sql`DELETE FROM admin_users WHERE email_normalized IN ('old@orbes.test', 'temp@orbes.test', 'gone@orbes.test')`.execute(t.db);
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
    // A warranty named by its point of sale keeps the name as text; a seller's sessions end, the account stays, disabled.
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
      // Another table pointing to the seller with ON DELETE RESTRICT, as 0004 scan_reports.handled_by and
      // 0005 account_recovery_codes.created_by do on the integration branch: the rollback must not trip on it.
      await sql`CREATE TABLE down_test_ref (admin_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT)`.execute(tx);
      await sql`INSERT INTO down_test_ref (admin_id) VALUES (${admin.id})`.execute(tx);
      // 0011 (F-03) re-creates the purpose CHECK after 0008: it goes first, as Kysely would take it down first.
      await m0011.down(tx);
      await m.down!(tx);
      const seller = (await sql<{ role: string; disabled: boolean }>`SELECT role, disabled_at IS NOT NULL AS disabled FROM admin_users WHERE email_normalized = 'seller@orbes.test'`.execute(tx)).rows;
      expect(seller).toEqual([{ role: 'AUDITOR', disabled: true }]);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sessions`.execute(tx)).rows[0].n).toBe(0);
      await sql`DROP TABLE down_test_ref`.execute(tx);
      expect((await sql<{ retailer: string | null }>`SELECT retailer FROM warranties WHERE product_id = ${product.id}`.execute(tx)).rows[0].retailer).toBe('ORBES Paris');
      expect(await roleCheck(tx)).toBe("CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERATOR'::text, 'AUDITOR'::text])))");
      // As 0001 wrote it (PostgreSQL normalises a one-value IN to an equality).
      expect(await purposeCheck(tx)).toBe("CHECK ((purpose = 'FIRST_REGISTRATION'::text))");
      expect(await tables(tx)).not.toContain('retailers');
      expect(await columns('warranties', tx)).not.toContain('retailer_id');
      expect(await columns('scan_events', tx)).not.toContain('admin_id');
      await m.up(tx);
      await m0011.up(tx);
    });
    expect(await roleCheck()).toContain("'RETAIL'::text");
    expect(await purposeCheck()).toContain("'TRANSFER_ACCEPT'::text");
    expect(await tables()).toContain('retailers');
    await sql`DELETE FROM scan_events`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE email_normalized = 'seller@orbes.test'`.execute(t.db);
  });

  it('0011 adds TRANSFER_ACCEPT to the scan token purposes; its down step restores the CHECK of 0008, SALE_ACTIVATION working, and up again', async () => {
    const purposeCheck = async () =>
      (await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'scan_tokens_purpose_check'`.execute(t.db)).rows[0]?.def ?? '';
    const latest = await snapshot();
    expect(await purposeCheck()).toBe("CHECK ((purpose = ANY (ARRAY['FIRST_REGISTRATION'::text, 'SALE_ACTIVATION'::text, 'TRANSFER_ACCEPT'::text])))");

    // A piece, a scan and one token of each purpose.
    await sql`INSERT INTO categories (id, code, name) VALUES (29, 'P', 'Purpose test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (29, 'M', 'RING', 'PURP') RETURNING id`.execute(t.db)).rows[0];
    const product = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-P-00001', ${(26 << 25) | (29 << 20) | 1}, 2026, 29, 1, 'PURP-1', ${model.id}, 'SILVER') RETURNING id`.execute(t.db)
    ).rows[0];
    const scan = (await sql<{ id: string }>`INSERT INTO scan_events (event_type, result_state, product_id) VALUES ('VERIFY', 'AUTHENTIC_REGISTERED', ${product.id}) RETURNING id`.execute(t.db)).rows[0];
    const token = (n: number, purpose: string) =>
      sql`INSERT INTO scan_tokens (id_hash, product_id, scan_event_id, purpose, expires_at) VALUES (decode(repeat(${n.toString(16).padStart(2, '0')}, 32), 'hex'), ${product.id}, ${scan.id}, ${purpose}, now() + interval '15 minutes')`.execute(t.db);
    const purposes = async () =>
      (await sql<{ purpose: string }>`SELECT purpose FROM scan_tokens WHERE product_id = ${product.id} ORDER BY purpose`.execute(t.db)).rows.map((r) => r.purpose);
    await token(1, 'FIRST_REGISTRATION');
    await token(2, 'SALE_ACTIVATION');
    await token(3, 'TRANSFER_ACCEPT');
    await expect(token(4, 'OTHER')).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_tokens_purpose_check'));

    // Down (the migrations after it first, as Kysely takes them down): the outstanding transfer tokens go, the CHECK
    // is 0008's again, and a sale token still goes in.
    const later = Object.keys(MIGRATIONS).filter((n) => n > '0011_scan_token_transfer_accept');
    for (const name of [...later].reverse()) expect((await migrateDown(t.db)).reverted).toEqual([name]);
    expect((await migrateDown(t.db)).reverted).toEqual(['0011_scan_token_transfer_accept']);
    expect(await purposeCheck()).toBe("CHECK ((purpose = ANY (ARRAY['FIRST_REGISTRATION'::text, 'SALE_ACTIVATION'::text])))");
    expect(await purposes()).toEqual(['FIRST_REGISTRATION', 'SALE_ACTIVATION']);
    await token(5, 'SALE_ACTIVATION');
    await expect(token(6, 'TRANSFER_ACCEPT')).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_tokens_purpose_check'));

    // Up again: the three purposes, the tokens kept, the schema as before.
    expect((await migrateToLatest(t.db)).applied).toEqual(['0011_scan_token_transfer_accept', ...later]);
    await token(7, 'TRANSFER_ACCEPT');
    await token(8, 'SALE_ACTIVATION');
    expect(await purposes()).toEqual(['FIRST_REGISTRATION', 'SALE_ACTIVATION', 'SALE_ACTIVATION', 'SALE_ACTIVATION', 'TRANSFER_ACCEPT']);
    expect(await snapshot()).toEqual(latest);

    await sql`DELETE FROM scan_tokens WHERE product_id = ${product.id}`.execute(t.db);
    await sql`DELETE FROM scan_events WHERE id = ${scan.id}`.execute(t.db);
  });

  it('0013 adds ownership_certificates, bound to a piece and an ownership period, and nothing else; down drops it alone, and up again', async () => {
    const latest = await snapshot();
    const { with: withCertificates, without: before } = await rollBackTo('0013_ownership_certificates');
    const added = withCertificates.filter((o) => !before.includes(o));
    expect(added.filter((o) => !o.includes('ownership_certificates'))).toEqual([]);
    expect(before.filter((o) => o.includes('ownership_certificates'))).toEqual([]);
    expect(withCertificates.filter((o) => !o.includes('ownership_certificates'))).toEqual(before);
    // The token's hash (32 bytes, unique), the piece, the ownership period, at most 90 days, withdrawn after creation.
    for (const c of [
      /^constraint ownership_certificates ownership_certificates_lifetime CHECK \(\(\(expires_at > created_at\) AND \(\(expires_at - created_at\) <= '90 days'::interval\)\)\)$/,
      /^constraint ownership_certificates ownership_certificates_token_hash_check CHECK \(\(octet_length\(token_hash\) = 32\)\)$/,
      /^constraint ownership_certificates ownership_certificates_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint ownership_certificates ownership_certificates_ownership_id_fkey FOREIGN KEY \(ownership_id\) REFERENCES ownership\(id\) ON DELETE RESTRICT$/,
      /^constraint ownership_certificates ownership_certificates_check CHECK \(\(\(revoked_at IS NULL\) OR \(revoked_at >= created_at\)\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(['0013_ownership_certificates']);
    expect(await snapshot()).toEqual(latest);
  });

  it('each migration of the 2026-10-02 plan (0004 to 0013) goes down to exactly the schema a fresh database has one migration earlier', async () => {
    // The tracks wrote them apart; deployed together, every down step must still land on its predecessor's schema.
    const names = Object.keys(MIGRATIONS);
    const first = names.indexOf('0004_scan_reports');
    expect(names.slice(first)).toEqual([
      '0004_scan_reports',
      '0005_account_recovery',
      '0006_admin_password_change_required',
      '0007_print_batch_indexes',
      '0008_retail_mode',
      '0009_scan_daily_stats',
      '0010_models_active',
      '0011_scan_token_transfer_accept',
      '0013_ownership_certificates',
    ]);
    // A fresh database migrated one step at a time: the schema after each migration, as a deployment builds it.
    const built = new Map<string, string[]>();
    const fresh = await createTestDb({ migrated: false });
    try {
      const migrator = createMigrator(fresh.db);
      for (const name of names) {
        const r = await migrator.migrateUp();
        expect(r.error, name).toBeUndefined();
        expect(r.results?.map((x) => x.migrationName)).toEqual([name]);
        built.set(name, await snapshotOf(fresh.db));
      }
    } finally {
      await fresh.close();
    }
    const latest = await snapshot();
    expect(latest).toEqual(built.get(names[names.length - 1]));
    // This database rolled back one migration at a time: each step lands on the fresh schema of the one before.
    for (let i = names.length - 1; i >= first; i--) {
      expect((await migrateDown(t.db)).reverted).toEqual([names[i]]);
      expect(await snapshot(), `${names[i]} down`).toEqual(built.get(names[i - 1]));
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(names.slice(first));
    expect(await snapshot()).toEqual(latest);
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
