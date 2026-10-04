import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { createMigrator, migrateDown, migrateToLatest, migrationStatus, MIGRATIONS } from '../../src/server/db/migrate.js';
import * as m0007 from '../../src/server/db/migrations/0007_print_batch_indexes.js';
import * as m0009 from '../../src/server/db/migrations/0009_scan_daily_stats.js';
import * as m0011 from '../../src/server/db/migrations/0011_scan_token_transfer_accept.js';

const EXPECTED_TABLES = [
  'account_recovery_codes', 'accounts', 'admin_users', 'anomalies', 'audit_logs', 'authentication_events', 'categories',
  'circle_daily_visits', 'circle_poll_votes', 'circle_post_images', 'circle_posts', 'circle_rsvps', 'club_tiers', 'codes',
  'collections', 'cryptographic_keys', 'drop_entries', 'drops', 'genomes', 'media_objects', 'model_images', 'models', 'ownership', 'ownership_certificates',
  'ownership_transfers', 'product_status_history', 'products', 'retailers', 'revocations', 'scan_daily_stats', 'scan_events', 'scan_reports',
  'scan_tokens', 'service_records', 'sessions', 'warranties',
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
    // 0012: the photographs, each foreign key at the head of its own index.
    expect(has(/INDEX models_image_sha256_idx ON public\.models USING btree \(image_sha256\)$/)).toBe(true);
    expect(has(/INDEX products_photo_sha256_idx ON public\.products USING btree \(photo_sha256\)$/)).toBe(true);
    expect(has(/INDEX media_objects_created_by_idx ON public\.media_objects USING btree \(created_by\)$/)).toBe(true);
    // 0013: one certificate per token hash; a piece's certificates, an ownership period's.
    expect(has(/UNIQUE INDEX ownership_certificates_token_hash_key ON public\.ownership_certificates USING btree \(token_hash\)$/)).toBe(true);
    expect(has(/INDEX ownership_certificates_product_idx ON public\.ownership_certificates USING btree \(product_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX ownership_certificates_ownership_idx ON public\.ownership_certificates USING btree \(ownership_id, created_at\)$/)).toBe(true);
    // 0014: one model per address; a gallery keyed by its model, then by each foreign key at the head of its own index.
    expect(has(/UNIQUE INDEX models_slug_key ON public\.models USING btree \(slug\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX model_images_pkey ON public\.model_images USING btree \(model_id, sha256\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX model_images_position_key ON public\.model_images USING btree \(model_id, "?position"?\)$/)).toBe(true);
    expect(has(/INDEX model_images_sha256_idx ON public\.model_images USING btree \(sha256\)$/)).toBe(true);
    expect(has(/INDEX model_images_created_by_idx ON public\.model_images USING btree \(created_by\)$/)).toBe(true);
    // 0015: a drop's model and author, each foreign key at the head of its own index; one entry per account and drop;
    // an account's entries; the entries of a drop by status and rank.
    expect(has(/INDEX drops_model_id_idx ON public\.drops USING btree \(model_id\)$/)).toBe(true);
    expect(has(/INDEX drops_created_by_idx ON public\.drops USING btree \(created_by\)$/)).toBe(true);
    expect(has(/INDEX drops_published_opens_idx ON public\.drops USING btree \(opens_at\) WHERE \(published_at IS NOT NULL\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_entries_drop_account_key ON public\.drop_entries USING btree \(drop_id, account_id\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_account_idx ON public\.drop_entries USING btree \(account_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_handled_by_idx ON public\.drop_entries USING btree \(handled_by\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_drop_status_idx ON public\.drop_entries USING btree \(drop_id, status, rank\)$/)).toBe(true);
    // 0018: one row per tier at most, the console user who wrote it at the head of its own index.
    expect(has(/UNIQUE INDEX club_tiers_pkey ON public\.club_tiers USING btree \(tier\)$/)).toBe(true);
    expect(has(/INDEX club_tiers_updated_by_idx ON public\.club_tiers USING btree \(updated_by\)$/)).toBe(true);
    // 0019: the console user who discontinued a model, at the head of its own index.
    expect(has(/INDEX models_discontinued_by_idx ON public\.models USING btree \(discontinued_by\)$/)).toBe(true);
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

  it('0012 down drops media_objects, models.image_sha256 and products.photo_sha256, and nothing else; up again restores them', async () => {
    const latest = await snapshot();
    const { with: withMedia, without: before } = await rollBackTo('0012_media');
    const touched = (o: string) => o.includes('media_objects') || o.includes('image_sha256') || o.includes('photo_sha256');
    const added = withMedia.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table ') && !o.startsWith('table media_objects '))).toEqual([
      'table models image_sha256 text YES ',
      'table products photo_sha256 text YES ',
    ]);
    expect(added.filter((o) => o.startsWith('table media_objects ')).map((o) => o.split(' ')[2])).toEqual(['bytes', 'created_at', 'created_by', 'height', 'mime', 'sha256', 'width']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger media_objects media_objects_immutable']);
    // Nothing of 0012 is left, and nothing else changed.
    expect(before.filter(touched)).toEqual([]);
    expect(withMedia.filter((o) => !touched(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0012_media');
    expect(await snapshot()).toEqual(latest);
  });

  it('0012: a photograph is named by the SHA-256 of its bytes, JPEG or WebP of at most 1 MiB and 4 096 px, never changed, and kept while a model or a piece uses it', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const insert = (v: Partial<{ sha256: string; mime: string; bytes: Uint8Array; width: number; height: number }> = {}) =>
      sql`INSERT INTO media_objects (sha256, mime, bytes, width, height)
          VALUES (${v.sha256 ?? sha}, ${v.mime ?? 'image/jpeg'}, ${v.bytes ?? bytes}, ${v.width ?? 10}, ${v.height ?? 10})`.execute(t.db);
    await expect(insert({ sha256: 'ab'.repeat(32) })).rejects.toSatisfy((e) => isCheckViolation(e, 'media_objects_sha256_consistent'));
    await expect(insert({ sha256: sha.toUpperCase() })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ mime: 'image/svg+xml' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ width: 4097 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ height: 0 })).rejects.toSatisfy((e) => isCheckViolation(e));
    const big = new Uint8Array(1024 * 1024 + 1);
    await expect(insert({ bytes: big, sha256: createHash('sha256').update(big).digest('hex') })).rejects.toSatisfy((e) => isCheckViolation(e));
    await insert();
    await expect(insert()).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE media_objects SET width = 11`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // Used by a model: the photograph cannot be deleted under it.
    await sql`INSERT INTO categories (id, code, name) VALUES (29, 'P', 'Media test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, image_sha256) VALUES (29, 'M', 'RING', 'MEDIA', ${sha}) RETURNING id`.execute(t.db)).rows[0];
    await expect(sql`DELETE FROM media_objects`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`UPDATE models SET image_sha256 = ${'cd'.repeat(32)} WHERE id = ${model.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`UPDATE models SET image_sha256 = NULL WHERE id = ${model.id}`.execute(t.db);
    await sql`DELETE FROM media_objects`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

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
    await sql`INSERT INTO categories (id, code, name) VALUES (28, 'T', 'Purpose test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (28, 'M', 'RING', 'PURP') RETURNING id`.execute(t.db)).rows[0];
    const product = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-T-00001', ${(26 << 25) | (28 << 20) | 1}, 2026, 28, 1, 'PURP-1', ${model.id}, 'SILVER') RETURNING id`.execute(t.db)
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

  it('0014 adds the lookbook of a model and its gallery, and nothing else; down restores 0013 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withLookbook, without: before } = await rollBackTo('0014_model_lookbook');
    // What 0014 adds names the new table or one of the five new columns (PGlite's PostgreSQL also lists a NOT NULL as a
    // constraint, models_lookbook_not_null; PostgreSQL 16 does not).
    const of0014 = (o: string) => o.includes('model_images') || /\b(slug|lookbook|story|specs|published_at)\b/.test(o);
    const added = withLookbook.filter((o) => !before.includes(o));
    const columns = added.filter((o) => o.startsWith('table models '));
    expect(columns).toEqual([
      "table models lookbook text NO 'HIDDEN'::text",
      'table models published_at timestamp with time zone YES ',
      'table models slug text YES ',
      'table models specs text YES ',
      'table models story text YES ',
    ]);
    expect(added.filter((o) => o.startsWith('table model_images ')).map((o) => o.split(' ')[2])).toEqual(['alt', 'created_at', 'created_by', 'model_id', 'position', 'sha256']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger model_images model_images_immutable_identity']);
    for (const c of [
      /^constraint models models_slug_format CHECK \(\(\(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'::text\) AND \(length\(slug\) <= 80\)\)\)$/,
      /^constraint models models_slug_key UNIQUE \(slug\)$/,
      /^constraint models models_lookbook_slug CHECK \(\(\(lookbook = 'HIDDEN'::text\) OR \(slug IS NOT NULL\)\)\)$/,
      /^constraint models models_published_slug CHECK \(\(\(published_at IS NULL\) OR \(slug IS NOT NULL\)\)\)$/,
      /^constraint model_images model_images_position_key UNIQUE \(model_id, "?position"?\) DEFERRABLE INITIALLY DEFERRED$/,
      /^constraint model_images model_images_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint model_images model_images_sha256_fkey FOREIGN KEY \(sha256\) REFERENCES media_objects\(sha256\) ON DELETE RESTRICT$/,
      /^constraint model_images model_images_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // Nothing of 0014 is left, and nothing else changed.
    expect(before.filter(of0014)).toEqual([]);
    expect(added.filter((o) => !of0014(o))).toEqual([]);
    expect(withLookbook.filter((o) => !of0014(o))).toEqual(before);
    // Later migrations (0015…) were rolled back first: up again applies them after it.
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0014_model_lookbook'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0014: every model stays HIDDEN without an address; a model shown has one, unique and lower-case; at most 8 photographs a gallery, in positions 1 to 8', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (27, 'U', 'Lookbook test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string; lookbook: string; slug: string | null }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (27, 'M', 'RING', 'LOOK') RETURNING id, lookbook, slug`.execute(t.db)).rows[0];
    expect([model.lookbook, model.slug]).toEqual(['HIDDEN', null]);
    const set = (assignments: string) => sql.raw(`UPDATE models SET ${assignments} WHERE id = '${model.id}'`).execute(t.db);
    await expect(set(`lookbook = 'PUBLIC'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_lookbook_slug'));
    await expect(set(`lookbook = 'SHOWN', slug = 'm'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const slug of ['Monolithe', 'mono--lithe', '-mono', 'mono-', 'mono lithe', 'é', 'a'.repeat(81)]) {
      await expect(set(`slug = '${slug}'`), slug).rejects.toSatisfy((e) => isCheckViolation(e, 'models_slug_format'));
    }
    await expect(set(`published_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_published_slug'));
    await set(`slug = 'monolithe-ring', lookbook = 'RESERVED', published_at = now()`);
    await expect(set(`slug = NULL`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`story = '   '`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`story = '${'x'.repeat(4001)}'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`specs = '${'x'.repeat(1001)}'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await set(`story = '${'x'.repeat(4000)}', specs = 'Metal: silver'`);
    const other = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (27, 'N', 'RING', 'LOOK2') RETURNING id`.execute(t.db)).rows[0];
    await expect(sql`UPDATE models SET slug = 'monolithe-ring' WHERE id = ${other.id}`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e, 'models_slug_key'));

    // The gallery: photographs of media_objects, positions 1 to 8, each once per model; never moved to another model.
    const photo = async (n: number) => {
      const bytes = new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]);
      const sha = createHash('sha256').update(bytes).digest('hex');
      await sql`INSERT INTO media_objects (sha256, mime, bytes, width, height) VALUES (${sha}, 'image/jpeg', ${bytes}, 10, 10)`.execute(t.db);
      return sha;
    };
    const shas = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(photo));
    const add = (sha: string, position: number, modelId = model.id) => sql`INSERT INTO model_images (model_id, sha256, position) VALUES (${modelId}, ${sha}, ${position})`.execute(t.db);
    for (const [i, sha] of shas.slice(0, 8).entries()) await add(sha, i + 1);
    await expect(add(shas[8]!, 9)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(add(shas[8]!, 0)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(add(shas[8]!, 3)).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_images_position_key'));
    await expect(add(shas[0]!, 8, model.id)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`INSERT INTO model_images (model_id, sha256, position) VALUES (${model.id}, ${'ab'.repeat(32)}, 1)`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`UPDATE model_images SET alt = '  ' WHERE model_id = ${model.id} AND position = 1`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    // Two positions swapped in one transaction: the uniqueness is checked at commit.
    await t.db.transaction().execute(async (tx) => {
      await sql`UPDATE model_images SET position = 2 WHERE model_id = ${model.id} AND sha256 = ${shas[0]!}`.execute(tx);
      await sql`UPDATE model_images SET position = 1 WHERE model_id = ${model.id} AND sha256 = ${shas[1]!}`.execute(tx);
    });
    await expect(sql`UPDATE model_images SET position = 1 WHERE model_id = ${model.id} AND sha256 = ${shas[2]!}`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_images_position_key'));
    await expect(sql`UPDATE model_images SET model_id = ${other.id} WHERE model_id = ${model.id} AND position = 1`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // A photograph of a gallery cannot be deleted under it, nor its model.
    await expect(sql`DELETE FROM media_objects WHERE sha256 = ${shas[0]!}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM model_images WHERE model_id = ${model.id}`.execute(t.db);
    await sql`DELETE FROM media_objects WHERE sha256 IN (${sql.join(shas)})`.execute(t.db);
    await sql`DELETE FROM models WHERE id IN (${model.id}, ${other.id})`.execute(t.db);
  });

  it('0015 adds drops and drop_entries, and nothing else; down drops them alone, and up again', async () => {
    const latest = await snapshot();
    const { with: withDrops, without: before } = await rollBackTo('0015_drops');
    const of0015 = (o: string) => /\bdrops\b|\bdrop_entries\b/.test(o);
    const added = withDrops.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0015(o))).toEqual([]);
    expect(before.filter(of0015)).toEqual([]);
    expect(withDrops.filter((o) => !of0015(o))).toEqual(before);
    expect(added.filter((o) => o.startsWith('table drops ')).map((o) => o.split(' ')[2])).toEqual([
      'cancelled_at', 'closes_at', 'created_at', 'created_by', 'description', 'drawn_at', 'id', 'model_id', 'opens_at', 'published_at',
      'purchase_window_hours', 'quantity', 'seed', 'seed_enc', 'seed_hash', 'title',
    ]);
    expect(added.filter((o) => o.startsWith('table drop_entries ')).map((o) => o.split(' ')[2])).toEqual([
      'account_id', 'created_at', 'drop_id', 'handled_at', 'handled_by', 'id', 'note', 'rank', 'respond_by', 'seniority', 'status', 'tier',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger drop_entries drop_entries_immutable_identity', 'trigger drops drops_immutable_seed']);
    for (const c of [
      /^constraint drops drops_window CHECK \(\(closes_at > opens_at\)\)$/,
      /^constraint drops drops_seed CHECK \(\(\(seed IS NULL\) OR \(\(octet_length\(seed\) = 32\) AND \(seed_hash = sha256\(seed\)\)\)\)\)$/,
      /^constraint drops drops_drawn CHECK \(\(\(drawn_at IS NULL\) = \(seed IS NULL\)\)\)$/,
      /^constraint drops drops_drawn_after_close CHECK /,
      /^constraint drops drops_cancelled_before_draw CHECK \(\(\(cancelled_at IS NULL\) OR \(drawn_at IS NULL\)\)\)$/,
      /^constraint drops drops_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint drops drops_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_drop_account_key UNIQUE \(drop_id, account_id\)$/,
      /^constraint drop_entries drop_entries_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_handled_by_fkey FOREIGN KEY \(handled_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_lapsed CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0015_drops'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0015: a seed sealed and committed, written in clear by the draw only; one entry per account and drop, its identity fixed, its status consistent', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (26, 'Z', 'Drop test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (26, 'D', 'RING', 'DROPT') RETURNING id`.execute(t.db)).rows[0];
    const seed = new Uint8Array(32).fill(7);
    const seedHash = createHash('sha256').update(seed).digest();
    const sealed = `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`;
    const insert = (v: Record<string, unknown> = {}) =>
      sql<{ id: string }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
          VALUES (${v.model ?? model.id}, ${v.title ?? 'Release'}, ${v.quantity ?? 2}, ${v.opens ?? '2026-11-01T10:00:00Z'}, ${v.closes ?? '2026-11-03T10:00:00Z'},
                  ${v.sealed ?? sealed}, ${v.hash ?? seedHash}) RETURNING id`.execute(t.db);
    await expect(insert({ quantity: 0 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ closes: '2026-11-01T10:00:00Z' })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_window'));
    await expect(insert({ title: '  ' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ sealed: 'plain seed' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ hash: new Uint8Array(31) })).rejects.toSatisfy((e) => isCheckViolation(e));
    const drop = (await insert()).rows[0];
    const row = (await sql<{ purchase_window_hours: number; seed: Uint8Array | null }>`SELECT purchase_window_hours, seed FROM drops WHERE id = ${drop.id}`.execute(t.db)).rows[0];
    expect(row).toEqual({ purchase_window_hours: 48, seed: null });
    const set = (assignments: string) => sql.raw(`UPDATE drops SET ${assignments} WHERE id = '${drop.id}'`).execute(t.db);
    for (const hours of [0, 337]) await expect(set(`purchase_window_hours = ${hours}`), String(hours)).rejects.toSatisfy((e) => isCheckViolation(e));
    // The seed and its commitment never change; the seed in clear only with the draw, and only the one committed.
    await expect(set(`seed_hash = decode(repeat('00', 32), 'hex')`)).rejects.toSatisfy(isGuardViolation);
    await expect(set(`seed_enc = 'v1.${'C'.repeat(16)}.${'D'.repeat(64)}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(set(`seed = decode(repeat('07', 32), 'hex')`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_drawn'));
    await expect(set(`drawn_at = '2026-11-04T10:00:00Z'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_drawn'));
    await expect(set(`seed = decode(repeat('08', 32), 'hex'), drawn_at = '2026-11-04T10:00:00Z', published_at = '2026-10-30T10:00:00Z'`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drops_seed'),
    );
    // A draw needs a publication and a close behind it; a cancellation forbids it.
    await expect(set(`seed = decode(repeat('07', 32), 'hex'), drawn_at = '2026-11-04T10:00:00Z'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_drawn_after_close'));
    await expect(set(`seed = decode(repeat('07', 32), 'hex'), drawn_at = '2026-11-02T10:00:00Z', published_at = '2026-10-30T10:00:00Z'`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drops_drawn_after_close'),
    );
    await expect(set(`seed = decode(repeat('07', 32), 'hex'), drawn_at = '2026-11-04T10:00:00Z', published_at = '2026-10-30T10:00:00Z', cancelled_at = now()`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drops_cancelled_before_draw'),
    );

    // Entries: one per account and drop; the identity of a row never changes.
    const account = async (n: number) =>
      (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES (${`drop${n}@example.com`}, ${`drop${n}@example.com`}, 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const [a1, a2] = [await account(1), await account(2)];
    const enter = (accountId: string, v: Record<string, unknown> = {}) =>
      sql<{ id: string; status: string }>`INSERT INTO drop_entries (drop_id, account_id, status, tier, seniority, rank, respond_by)
          VALUES (${drop.id}, ${accountId}, ${v.status ?? 'ENTERED'}, ${v.tier ?? null}, ${v.seniority ?? null}, ${v.rank ?? null}, ${v.respondBy ?? null}) RETURNING id, status`.execute(t.db);
    const e1 = (await enter(a1)).rows[0];
    expect(e1.status).toBe('ENTERED');
    await expect(enter(a1)).rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_entries_drop_account_key'));
    await expect(enter(a2, { status: 'DRAWN' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(enter(a2, { tier: 1, seniority: 0, rank: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_entered'));
    await expect(enter(a2, { status: 'WAITLISTED', tier: 1, seniority: 0 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_waitlisted'));
    await expect(enter(a2, { status: 'SELECTED', tier: 1, seniority: 0, rank: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_held'));
    await expect(enter(a2, { status: 'WITHDRAWN', tier: 1, seniority: 0, rank: 2 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_withdrawn'));
    await expect(enter(a2, { status: 'WAITLISTED', tier: 4, seniority: 0, rank: 2 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(enter(a2, { status: 'WAITLISTED', tier: 1, rank: 2 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_standing'));
    for (const col of ['id', 'drop_id', 'account_id', 'created_at']) {
      const value = col === 'created_at' ? `now() + interval '1 day'` : col === 'account_id' ? `'${a2}'` : `gen_random_uuid()`;
      await expect(sql.raw(`UPDATE drop_entries SET ${col} = ${value} WHERE id = '${e1.id}'`).execute(t.db), col).rejects.toSatisfy(isGuardViolation);
    }
    // A concluded entry names when; a lapse comes after the place held.
    const respondBy = new Date(Date.now() + 3 * 86_400_000);
    await sql`UPDATE drop_entries SET status = 'SELECTED', tier = 1, seniority = 0, rank = 1, respond_by = ${respondBy} WHERE id = ${e1.id}`.execute(t.db);
    await expect(sql`UPDATE drop_entries SET status = 'CONFIRMED' WHERE id = ${e1.id}`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_handled'));
    await expect(sql`UPDATE drop_entries SET status = 'LAPSED', handled_at = ${new Date(respondBy.getTime() - 1000)} WHERE id = ${e1.id}`.execute(t.db)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drop_entries_lapsed'),
    );
    await sql`UPDATE drop_entries SET status = 'LAPSED', handled_at = ${respondBy} WHERE id = ${e1.id}`.execute(t.db);
    await expect(sql`UPDATE drop_entries SET note = ' ' WHERE id = ${e1.id}`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    // A drop and an account stay while an entry names them.
    await expect(sql`DELETE FROM drops WHERE id = ${drop.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM accounts WHERE id = ${a1}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM drop_entries WHERE drop_id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM drops WHERE id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id IN (${a1}, ${a2})`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  it('0016 adds the five tables of the circle, and nothing else; down drops them alone, and up again', async () => {
    const latest = await snapshot();
    const { with: withCircle, without: before } = await rollBackTo('0016_circle');
    const of0016 = (o: string) => /\bcircle_(posts|post_images|rsvps|poll_votes|daily_visits)\b/.test(o);
    const added = withCircle.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0016(o))).toEqual([]);
    expect(before.filter(of0016)).toEqual([]);
    expect(withCircle.filter((o) => !of0016(o))).toEqual(before);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('circle_posts')).toEqual([
      'body', 'capacity', 'created_at', 'created_by', 'drop_id', 'event_at', 'event_place', 'external_url', 'id', 'kind', 'min_tier', 'model_id', 'poll_options',
      'published_at', 'title',
    ]);
    expect(columns('circle_post_images')).toEqual(['alt', 'created_at', 'created_by', 'position', 'post_id', 'sha256']);
    expect(columns('circle_rsvps')).toEqual(['account_id', 'answer', 'created_at', 'post_id', 'updated_at']);
    expect(columns('circle_poll_votes')).toEqual(['account_id', 'created_at', 'option_index', 'post_id']);
    // The visits of a day: a count, and no account.
    expect(columns('circle_daily_visits')).toEqual(['day', 'visits']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger circle_poll_votes circle_poll_votes_final',
      'trigger circle_post_images circle_post_images_immutable_identity',
      'trigger circle_posts circle_posts_immutable_identity',
      'trigger circle_rsvps circle_rsvps_immutable_identity',
    ]);
    for (const c of [
      /^constraint circle_posts circle_posts_invitation CHECK /,
      /^constraint circle_posts circle_posts_invitation_only CHECK /,
      /^constraint circle_posts circle_posts_poll CHECK /,
      /^constraint circle_posts circle_posts_poll_options CHECK /,
      /^constraint circle_posts circle_posts_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_posts circle_posts_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_posts circle_posts_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_post_images circle_post_images_position_key UNIQUE \(post_id, "?position"?\) DEFERRABLE INITIALLY DEFERRED$/,
      /^constraint circle_post_images circle_post_images_sha256_fkey FOREIGN KEY \(sha256\) REFERENCES media_objects\(sha256\) ON DELETE RESTRICT$/,
      /^constraint circle_rsvps circle_rsvps_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_poll_votes circle_poll_votes_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^index CREATE INDEX circle_posts_published_idx ON public\.circle_posts USING btree \(published_at\) WHERE \(published_at IS NOT NULL\)$/,
      /^index CREATE INDEX circle_rsvps_account_idx ON public\.circle_rsvps USING btree \(account_id, created_at\)$/,
      /^index CREATE INDEX circle_poll_votes_account_idx ON public\.circle_poll_votes USING btree \(account_id, created_at\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0016_circle'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0016: a post holds the fields of its kind only, never changes kind; its photographs 1 to 4; one answer and one final vote per account; visits without an account', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (25, 'Y', 'Circle test') ON CONFLICT DO NOTHING`.execute(t.db);
    const insert = (v: Record<string, unknown> = {}) =>
      sql<{ id: string; min_tier: number; published_at: Date | null }>`INSERT INTO circle_posts (kind, title, body, event_at, event_place, capacity, poll_options, external_url)
          VALUES (${v.kind ?? 'NOTE'}, ${v.title ?? 'A note'}, ${v.body ?? null}, ${v.eventAt ?? null}, ${v.place ?? null}, ${v.capacity ?? null},
                  ${v.options ?? null}::text[], ${v.url ?? null}) RETURNING id, min_tier, published_at`.execute(t.db);
    await expect(insert({ kind: 'NEWS' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ title: '  ' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ title: 'x'.repeat(121) })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ body: 'x'.repeat(6001) })).rejects.toSatisfy((e) => isCheckViolation(e));
    // An invitation has its event; nothing else has an event, a place or a capacity; a poll has 2 to 6 options, a poll only.
    await expect(insert({ kind: 'INVITATION' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation'));
    await expect(insert({ eventAt: '2026-11-01T19:00:00Z' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation'));
    await expect(insert({ place: 'Paris' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation_only'));
    await expect(insert({ capacity: 10 })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation_only'));
    await expect(insert({ kind: 'INVITATION', eventAt: '2026-11-01T19:00:00Z', capacity: 0 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ kind: 'POLL' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll'));
    await expect(insert({ options: '{a,b}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll'));
    await expect(insert({ kind: 'POLL', options: '{a}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll_options'));
    await expect(insert({ kind: 'POLL', options: '{a,b,c,d,e,f,g}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll_options'));
    await expect(insert({ kind: 'POLL', options: '{a,NULL}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll_options'));
    await expect(insert({ url: 'http://youtube.com/watch' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ url: `https://theorbes.com/${'x'.repeat(480)}` })).rejects.toSatisfy((e) => isCheckViolation(e));
    const note = (await insert({ body: 'Two paragraphs.\n\nThe second.', url: 'https://www.youtube.com/watch?v=x' })).rows[0];
    expect([note.min_tier, note.published_at]).toEqual([1, null]);
    const invitation = (await insert({ kind: 'INVITATION', title: 'A dinner', eventAt: '2026-11-01T19:00:00Z', place: 'Paris', capacity: 2 })).rows[0];
    const poll = (await insert({ kind: 'POLL', title: 'A poll', options: '{"Paris, at night","Milan"}' })).rows[0];
    expect((await sql<{ poll_options: string[] }>`SELECT poll_options FROM circle_posts WHERE id = ${poll.id}`.execute(t.db)).rows[0].poll_options).toEqual(['Paris, at night', 'Milan']);
    for (const tier of [0, 4]) await expect(sql`UPDATE circle_posts SET min_tier = ${tier} WHERE id = ${note.id}`.execute(t.db), String(tier)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const [col, value] of [['kind', `'POLL'`], ['id', 'gen_random_uuid()'], ['created_at', `now() + interval '1 day'`]] as const) {
      await expect(sql.raw(`UPDATE circle_posts SET ${col} = ${value} WHERE id = '${note.id}'`).execute(t.db), col).rejects.toSatisfy(isGuardViolation);
    }

    // Photographs: positions 1 to 4, each once per post, never moved to another post.
    const photo = async (n: number) => {
      const bytes = new Uint8Array([0xff, 0xd8, 0x70 + n, 0xff, 0xd9]);
      const sha = createHash('sha256').update(bytes).digest('hex');
      await sql`INSERT INTO media_objects (sha256, mime, bytes, width, height) VALUES (${sha}, 'image/jpeg', ${bytes}, 10, 10)`.execute(t.db);
      return sha;
    };
    const shas = await Promise.all([1, 2, 3, 4, 5].map(photo));
    const add = (sha: string, position: number, postId = note.id) => sql`INSERT INTO circle_post_images (post_id, sha256, position) VALUES (${postId}, ${sha}, ${position})`.execute(t.db);
    for (const [i, sha] of shas.slice(0, 4).entries()) await add(sha, i + 1);
    await expect(add(shas[4]!, 5)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(add(shas[4]!, 2)).rejects.toSatisfy((e) => isUniqueViolation(e, 'circle_post_images_position_key'));
    await expect(add(shas[0]!, 4, note.id)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE circle_post_images SET post_id = ${poll.id} WHERE post_id = ${note.id} AND position = 1`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    await expect(sql`DELETE FROM media_objects WHERE sha256 = ${shas[0]!}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // Answers: YES or NO, one per account and post, changed in place; votes: one per account, final.
    const account = async (n: number) =>
      (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES (${`circle${n}@example.com`}, ${`circle${n}@example.com`}, 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const [a1, a2] = [await account(1), await account(2)];
    const answer = (accountId: string, value: string) => sql`INSERT INTO circle_rsvps (post_id, account_id, answer) VALUES (${invitation.id}, ${accountId}, ${value})`.execute(t.db);
    await expect(answer(a1, 'MAYBE')).rejects.toSatisfy((e) => isCheckViolation(e));
    await answer(a1, 'YES');
    await expect(answer(a1, 'NO')).rejects.toSatisfy((e) => isUniqueViolation(e));
    await sql`UPDATE circle_rsvps SET answer = 'NO', updated_at = now() + interval '1 minute' WHERE post_id = ${invitation.id} AND account_id = ${a1}`.execute(t.db);
    await expect(sql`UPDATE circle_rsvps SET account_id = ${a2} WHERE post_id = ${invitation.id}`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    await expect(sql`UPDATE circle_rsvps SET updated_at = created_at - interval '1 minute' WHERE post_id = ${invitation.id}`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    const vote = (accountId: string, option: number) => sql`INSERT INTO circle_poll_votes (post_id, account_id, option_index) VALUES (${poll.id}, ${accountId}, ${option})`.execute(t.db);
    await expect(vote(a1, 6)).rejects.toSatisfy((e) => isCheckViolation(e));
    await vote(a1, 1);
    await expect(vote(a1, 0)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE circle_poll_votes SET option_index = 0 WHERE post_id = ${poll.id}`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // A post and an account stay while an answer or a vote names them.
    await expect(sql`DELETE FROM circle_posts WHERE id = ${invitation.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM accounts WHERE id = ${a1}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // The visits of a day: one row per day, a count of zero or more.
    await expect(sql`INSERT INTO circle_daily_visits (day, visits) VALUES ('2026-10-04', -1)`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    await sql`INSERT INTO circle_daily_visits (day, visits) VALUES ('2026-10-04', 3)`.execute(t.db);
    await expect(sql`INSERT INTO circle_daily_visits (day) VALUES ('2026-10-04')`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e));

    await sql`DELETE FROM circle_daily_visits`.execute(t.db);
    await sql`DELETE FROM circle_poll_votes`.execute(t.db);
    await sql`DELETE FROM circle_rsvps`.execute(t.db);
    await sql`DELETE FROM circle_post_images`.execute(t.db);
    await sql`DELETE FROM media_objects WHERE sha256 IN (${sql.join(shas)})`.execute(t.db);
    await sql`DELETE FROM circle_posts`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id IN (${a1}, ${a2})`.execute(t.db);
  });

  it('0017 adds drops.early_access_hours, and nothing else; down restores 0016 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withEarly, without: before } = await rollBackTo('0017_drop_early_access');
    // What 0017 adds names its column (PGlite's PostgreSQL also lists its NOT NULL as a constraint; PostgreSQL 16 does not).
    const of0017 = (o: string) => o.includes('early_access_hours');
    const added = withEarly.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual(['table drops early_access_hours smallint NO 48']);
    expect(added.some((o) => /^constraint drops drops_early_access_hours_check CHECK \(\(\(early_access_hours >= 0\) AND \(early_access_hours <= 336\)\)\)$/.test(o))).toBe(true);
    expect(added.filter((o) => !of0017(o))).toEqual([]);
    expect(before.filter(of0017)).toEqual([]);
    expect(withEarly.filter((o) => !of0017(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0017_drop_early_access'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0017: the early access of a drop, 48 hours by default, 0 (none) to 336; a direct reservation is an entry SELECTED with its tier and no rank', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (24, 'X', 'Early access test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (24, 'E', 'RING', 'EARLY') RETURNING id`.execute(t.db)).rows[0];
    const seedHash = createHash('sha256').update(new Uint8Array(32).fill(5)).digest();
    const drop = (
      await sql<{ id: string; early_access_hours: number }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
          VALUES (${model.id}, 'Release', 2, '2026-11-01T10:00:00Z', '2026-11-03T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash})
          RETURNING id, early_access_hours`.execute(t.db)
    ).rows[0];
    expect(drop.early_access_hours).toBe(48);
    const set = (hours: number) => sql`UPDATE drops SET early_access_hours = ${hours} WHERE id = ${drop.id}`.execute(t.db);
    for (const hours of [-1, 337]) await expect(set(hours), String(hours)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const hours of [0, 336, 48]) await set(hours);
    // The reservation of the early access: SELECTED at once, held until its time, the tier of the request, never a rank.
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('early@example.com', 'early@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    await sql`INSERT INTO drop_entries (drop_id, account_id, status, tier, seniority, respond_by) VALUES (${drop.id}, ${account}, 'SELECTED', 2, 0, '2026-10-31T10:00:00Z')`.execute(t.db);
    await sql`DELETE FROM drop_entries WHERE drop_id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM drops WHERE id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id = ${account}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  it('0018 adds club_tiers, and nothing else; down restores 0017 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withTiers, without: before } = await rollBackTo('0018_club_tiers');
    const of0018 = (o: string) => o.includes('club_tiers');
    const added = withTiers.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table club_tiers benefits text NO ',
      'table club_tiers tier text NO ',
      'table club_tiers updated_at timestamp with time zone NO now()',
      'table club_tiers updated_by uuid YES ',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger club_tiers club_tiers_immutable_tier']);
    expect(added.some((o) => /^constraint club_tiers club_tiers_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/.test(o))).toBe(true);
    expect(added.filter((o) => !of0018(o))).toEqual([]);
    expect(before.filter(of0018)).toEqual([]);
    expect(withTiers.filter((o) => !of0018(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0018_club_tiers'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0018: a tier\'s benefits, one row per tier at most, 1 to 600 characters; its tier never changes; its author stays while named', async () => {
    const insert = (tier: string, benefits: string, by: string | null = null) =>
      sql`INSERT INTO club_tiers (tier, benefits, updated_by) VALUES (${tier}, ${benefits}, ${by})`.execute(t.db);
    await expect(insert('GOLD', 'A benefit.')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert('TITANE', '   ')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert('TITANE', 'x'.repeat(601))).rejects.toSatisfy((e) => isCheckViolation(e));
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('tiers@orbes.test', 'tiers@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    await insert('TITANE', 'x'.repeat(600), admin);
    await expect(insert('TITANE', 'Again.')).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE club_tiers SET tier = 'PLATINE' WHERE tier = 'TITANE'`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    await sql`UPDATE club_tiers SET benefits = 'The circle.' WHERE tier = 'TITANE'`.execute(t.db);
    await expect(sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM club_tiers`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
  });

  it('0019 adds models.discontinued_at and discontinued_by, and nothing else; down restores 0018 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withDiscontinued, without: before } = await rollBackTo('0019_model_discontinued');
    const of0019 = (o: string) => o.includes('discontinued');
    const added = withDiscontinued.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual(['table models discontinued_at timestamp with time zone YES ', 'table models discontinued_by uuid YES ']);
    for (const c of [
      /^constraint models models_discontinued_by_fkey FOREIGN KEY \(discontinued_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint models models_discontinued_inactive CHECK \(\(\(discontinued_at IS NULL\) OR \(NOT active\)\)\)$/,
      /^constraint models models_discontinued_by_when CHECK \(\(\(discontinued_by IS NULL\) OR \(discontinued_at IS NOT NULL\)\)\)$/,
      /^index CREATE INDEX models_discontinued_by_idx ON public\.models USING btree \(discontinued_by\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => !of0019(o))).toEqual([]);
    expect(before.filter(of0019)).toEqual([]);
    expect(withDiscontinued.filter((o) => !of0019(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0019_model_discontinued'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0019: a model discontinued is never active; its author only with its date, and stays while named; reinstated, both cleared', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (25, 'Y', 'Discontinued test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string; discontinued_at: Date | null; discontinued_by: string | null }>`
      INSERT INTO models (category_id, name, type, sku_prefix) VALUES (25, 'D', 'RING', 'DISC') RETURNING id, discontinued_at, discontinued_by`.execute(t.db)).rows[0];
    // Every model starts as it was: not discontinued.
    expect([model.discontinued_at, model.discontinued_by]).toEqual([null, null]);
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('disc@orbes.test', 'disc@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`.execute(t.db)).rows[0].id;
    const set = (sets: string) => sql.raw(`UPDATE models SET ${sets} WHERE id = '${model.id}'`).execute(t.db);
    // Discontinued while active, an author without a date, an active discontinued model: refused.
    await expect(set(`discontinued_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_discontinued_inactive'));
    await expect(set(`discontinued_by = '${admin}', active = false`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_discontinued_by_when'));
    await set(`discontinued_at = now(), discontinued_by = '${admin}', active = false`);
    await expect(set(`active = true`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_discontinued_inactive'));
    // A script discontinues without an author.
    await set(`discontinued_by = NULL`);
    await set(`discontinued_by = '${admin}'`);
    await expect(sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    // Reinstated: both cleared, active again.
    await set(`discontinued_at = NULL, discontinued_by = NULL, active = true`);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
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
    // Later migrations (0014…) were rolled back first: up again applies them after it.
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0013_ownership_certificates'));
    expect(await snapshot()).toEqual(latest);
  });

  it('each migration of the 2026-10-02 plan (0004 to 0013) and of the 2026-10-03 one (0014 on) goes down to exactly the schema a fresh database has one migration earlier', async () => {
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
      '0012_media',
      '0013_ownership_certificates',
      // The « Potentiel » plan of 2026-10-03 (docs/launch/DEPLOY-POTENTIEL-2026-10.md): deployment A.
      '0014_model_lookbook',
      '0015_drops',
      '0016_circle',
      '0017_drop_early_access',
      '0018_club_tiers',
      // Deployment B+C.
      '0019_model_discontinued',
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
