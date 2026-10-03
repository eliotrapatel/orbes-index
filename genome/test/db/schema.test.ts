import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import * as S from '../../src/server/db/schema.js';
import { ACTOR_TYPES } from '../../src/server/types.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, pgError } from '../../src/server/db/pg-errors.js';
import { packIdentity } from '../../src/core/identity.js';
import type { Db } from '../../src/server/db/connection.js';

/** Quoted literals of the CHECK constraint(s) on table.column. */
async function checkValues(db: Db, table: string, column: string): Promise<string[]> {
  const r = await sql<{ def: string }>`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'c' AND c.conrelid = ${table}::regclass AND a.attname = ${column}`.execute(db);
  const values = new Set<string>();
  for (const { def } of r.rows) for (const m of def.matchAll(/'([^']*)'::text/g)) values.add(m[1]);
  return [...values].sort();
}

const sorted = (a: readonly string[]) => [...a].sort();

let seq = 0;
async function seedProduct(db: Db, overrides: Partial<S.NewProduct> = {}) {
  seq++;
  // ids 11..26 ↔ letters K..Z (the categories test below owns id 1 / 'J').
  const catId = 11 + (seq % 16);
  const code = String.fromCharCode(64 + catId);
  await db
    .insertInto('categories')
    .values({ id: catId, code, name: `CAT ${code}` })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const cat = await db.selectFrom('categories').selectAll().where('id', '=', catId).executeTakeFirstOrThrow();
  const model = await db
    .insertInto('models')
    .values({ category_id: catId, name: 'MONOLITHE', type: 'RING', sku_prefix: `MON-${seq}` })
    .returningAll()
    .executeTakeFirstOrThrow();
  const serial = 100 + seq;
  const product = await db
    .insertInto('products')
    .values({
      product_id: `O26-${cat.code}-${String(serial).padStart(5, '0')}`,
      packed_identity: packIdentity({ year: 2026, categoryIndex: catId, serial }),
      year: 2026,
      category_id: catId,
      serial,
      sku: `MON-${seq}-925`,
      model_id: model.id,
      material: '925 STERLING SILVER',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { product, model, category: cat };
}

describe('schema', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it('CHECK constraint value sets match the schema.ts enumerations', async () => {
    const cases: [string, string, readonly string[]][] = [
      ['products', 'status', S.PRODUCT_STATUSES],
      ['products', 'ownership_state', S.OWNERSHIP_STATES],
      ['product_status_history', 'from_status', S.PRODUCT_STATUSES],
      ['product_status_history', 'to_status', S.PRODUCT_STATUSES],
      ['product_status_history', 'actor_type', ACTOR_TYPES],
      ['cryptographic_keys', 'status', S.KEY_STATUSES],
      ['codes', 'status', S.CODE_STATUSES],
      ['accounts', 'status', S.ACCOUNT_STATUSES],
      ['admin_users', 'role', S.ADMIN_ROLES],
      ['sessions', 'subject_type', S.SESSION_SUBJECT_TYPES],
      ['ownership', 'acquired_via', S.ACQUIRED_VIA],
      ['ownership_transfers', 'status', S.TRANSFER_STATUSES],
      ['service_records', 'type', S.SERVICE_TYPES],
      ['service_records', 'status', S.SERVICE_STATUSES],
      ['scan_tokens', 'purpose', S.SCAN_TOKEN_PURPOSES],
      ['scan_events', 'event_type', S.SCAN_EVENT_TYPES],
      ['scan_daily_stats', 'event_type', S.SCAN_STAT_EVENT_TYPES],
      ['scan_daily_stats', 'result_state', S.VERIFICATION_STATES],
      ['authentication_events', 'genome_check', S.GENOME_CHECKS],
      ['authentication_events', 'state', S.VERIFICATION_STATES],
      ['anomalies', 'severity', S.ANOMALY_SEVERITIES],
      ['anomalies', 'status', S.ANOMALY_STATUSES],
      ['revocations', 'target_type', S.REVOCATION_TARGET_TYPES],
      ['audit_logs', 'actor_type', ACTOR_TYPES],
      ['scan_reports', 'channel', S.REPORT_CHANNELS],
      ['scan_reports', 'status', S.REPORT_STATUSES],
      ['media_objects', 'mime', S.MEDIA_MIME_TYPES],
    ];
    for (const [table, column, values] of cases) {
      expect(await checkValues(t.db, table, column), `${table}.${column}`).toEqual(sorted(values));
    }
  });

  it('returns identical JS types for int8, date, bytea, arrays and jsonb', async () => {
    const r = await sql<{ i8: unknown; big: unknown; d: unknown; b: unknown; arr: unknown; j: unknown; ts: unknown }>`
      SELECT 4294967295::int8 AS i8, 9007199254740993::int8 AS big, '2026-03-04'::date AS d,
             '\\x00ff10'::bytea AS b, ARRAY[1,2,15]::smallint[] AS arr, '{"a":[1,"x"]}'::jsonb AS j,
             '2026-01-01T00:00:00.123Z'::timestamptz AS ts`.execute(t.db);
    const row = r.rows[0];
    expect(row.i8).toBe(4294967295);
    expect(row.big).toBe(9007199254740993n); // never silently rounded
    expect(row.d).toBe('2026-03-04');
    expect(row.b).toEqual(new Uint8Array([0, 255, 16]));
    expect((row.b as Uint8Array).constructor).toBe(Uint8Array);
    expect(row.arr).toEqual([1, 2, 15]);
    expect(row.j).toEqual({ a: [1, 'x'] });
    expect(row.ts).toEqual(new Date('2026-01-01T00:00:00.123Z'));
  });

  it('enforces product identity consistency (packed identity and product id)', async () => {
    const { product } = await seedProduct(t.db);
    expect(product.status).toBe('ISSUED');
    expect(product.ownership_state).toBe('UNREGISTERED');
    expect(product.auth_policy).toBe('PRINTED_CODE');
    expect(typeof product.packed_identity).toBe('number');

    await expect(seedProduct(t.db, { packed_identity: 12345 })).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'products_packed_identity_consistent'),
    );
    await expect(seedProduct(t.db, { product_id: 'O25-Z-99999' })).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'products_product_id_consistent'),
    );
    await expect(seedProduct(t.db, { product_id: 'not-an-id' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(seedProduct(t.db, { status: 'BOGUS' as S.ProductStatus })).rejects.toSatisfy((e) => isCheckViolation(e));
  });

  it('guards immutable identity columns and keeps updated_at current', async () => {
    const { product } = await seedProduct(t.db);
    await expect(
      t.db.updateTable('products').set({ serial: 999 }).where('id', '=', product.id).execute(),
    ).rejects.toSatisfy(isGuardViolation);

    const before = product.updated_at;
    await t.pglite.query(`SELECT pg_sleep(0.01)`);
    // now() is the transaction start, so run the update in its own statement/transaction.
    const after = await t.db
      .updateTable('products')
      .set({ status: 'ACTIVATED' })
      .where('id', '=', product.id)
      .returning(['updated_at', 'status'])
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('ACTIVATED');
    expect(after.updated_at.getTime()).toBeGreaterThan(before.getTime());

    // An explicit updated_at (injected clock) is respected.
    const explicit = new Date('2030-05-05T05:05:05.000Z');
    const r = await t.db
      .updateTable('products')
      .set({ variant: 'XL', updated_at: explicit })
      .where('id', '=', product.id)
      .returning('updated_at')
      .executeTakeFirstOrThrow();
    expect(r.updated_at).toEqual(explicit);
  });

  it('categories: index/code immutable, never deleted', async () => {
    await t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'JEWELRY' }).execute();
    const c = await t.db.selectFrom('categories').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
    expect(c).toMatchObject({ code: 'J', warranty_months: 24, active: true });
    await expect(t.db.updateTable('categories').set({ code: 'K' }).where('id', '=', 1).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.updateTable('categories').set({ id: 2 }).where('id', '=', 1).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.deleteFrom('categories').where('id', '=', 1).execute()).rejects.toSatisfy(isGuardViolation);
    await t.db.updateTable('categories').set({ active: false, name: 'JEWELLERY' }).where('id', '=', 1).execute();
    await expect(t.db.insertInto('categories').values({ id: 32, code: 'Q', name: 'X' }).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e),
    );
    await expect(t.db.insertInto('categories').values({ id: 3, code: 'j', name: 'X' }).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e),
    );
    await expect(t.db.insertInto('categories').values({ id: 4, code: 'J', name: 'X' }).execute()).rejects.toSatisfy((e) =>
      isUniqueViolation(e),
    );
  });

  it('models: active by default (0010); category and SKU prefix immutable, the shown fields editable', async () => {
    const { model, product } = await seedProduct(t.db);
    expect(model.active).toBe(true);
    await expect(t.db.updateTable('models').set({ sku_prefix: 'OTHER' }).where('id', '=', model.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.updateTable('models').set({ category_id: 1 }).where('id', '=', model.id).execute()).rejects.toSatisfy(isGuardViolation);
    const updated = await t.db
      .updateTable('models')
      .set({ name: 'MONOLITHE II', type: 'RING', default_material: null, care_instructions: 'Wipe with a soft, dry cloth.', collection_id: null, active: false })
      .where('id', '=', model.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(updated).toMatchObject({ name: 'MONOLITHE II', active: false, sku_prefix: model.sku_prefix, category_id: model.category_id });
    // The piece issued with it keeps its model.
    expect((await t.db.selectFrom('products').select('model_id').where('id', '=', product.id).executeTakeFirstOrThrow()).model_id).toBe(model.id);
  });

  it('foreign keys restrict deletes', async () => {
    const { model } = await seedProduct(t.db);
    const err = await t.db.deleteFrom('models').where('id', '=', model.id).execute().catch((e: unknown) => e);
    expect(pgError(err)).toMatchObject({ code: '23001', table: 'products' });
    expect(isForeignKeyViolation(err)).toBe(true);
    expect(isGuardViolation(err)).toBe(false);
  });

  it('keys: single ACTIVE key, 32-byte public keys, immutable key material', async () => {
    const pk = (b: number) => new Uint8Array(32).fill(b);
    await t.db
      .insertInto('cryptographic_keys')
      .values({ key_id: 1, kid: 'k1', public_key: pk(1), status: 'ACTIVE', provider: 'memory', provider_ref: 'mem:1' })
      .execute();
    await expect(
      t.db
        .insertInto('cryptographic_keys')
        .values({ key_id: 2, kid: 'k2', public_key: pk(2), status: 'ACTIVE', provider: 'memory', provider_ref: 'mem:2' })
        .execute(),
    ).rejects.toSatisfy((e) => isUniqueViolation(e, 'cryptographic_keys_single_active'));
    await expect(
      t.db
        .insertInto('cryptographic_keys')
        .values({ key_id: 3, kid: 'k3', public_key: new Uint8Array(31), status: 'RETIRED', provider: 'memory', provider_ref: 'mem:3' })
        .execute(),
    ).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(
      t.db.updateTable('cryptographic_keys').set({ public_key: pk(9) }).where('key_id', '=', 1).execute(),
    ).rejects.toSatisfy(isGuardViolation);
    // Lifecycle columns stay mutable.
    await t.db.updateTable('cryptographic_keys').set({ status: 'RETIRED', retired_at: new Date() }).where('key_id', '=', 1).execute();
    const k = await t.db.selectFrom('cryptographic_keys').selectAll().where('key_id', '=', 1).executeTakeFirstOrThrow();
    expect(k.public_key).toEqual(pk(1));
    expect(k.algorithm).toBe('Ed25519');
  });

  it('genomes, codes and product_overview', async () => {
    const { product, category } = await seedProduct(t.db);
    const pk = new Uint8Array(32).fill(77);
    await t.db
      .insertInto('cryptographic_keys')
      .values({ key_id: 7, kid: 'k7', public_key: pk, status: 'RETIRED', provider: 'memory', provider_ref: 'mem:7' })
      .execute();
    const genome = await t.db
      .insertInto('genomes')
      .values({
        product_id: product.id,
        genome_version: 1,
        genome_id: product.product_id,
        value: 0xdeadbeef,
        glyphs: [13, 14, 10, 13, 11, 14, 14, 15],
        pattern: 'a·b·c·d·e·f·g·h',
        fingerprint: 'G1-DEAD-BEEF',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(genome.value).toBe(0xdeadbeef);
    expect(genome.glyphs).toEqual([13, 14, 10, 13, 11, 14, 14, 15]);

    await expect(
      t.db
        .insertInto('genomes')
        .values({
          product_id: product.id,
          genome_version: 2,
          genome_id: product.product_id,
          value: 1,
          glyphs: [1, 2, 3, 4, 5, 6, 7, 16],
          pattern: 'x',
          fingerprint: 'G2-0000-0001',
        })
        .execute(),
    ).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(t.db.updateTable('genomes').set({ pattern: 'tampered' }).where('id', '=', genome.id).execute()).rejects.toSatisfy(
      isGuardViolation,
    );

    const codeValues = (issue: number, status: S.CodeStatus = 'ACTIVE'): S.NewCode => ({
      product_id: product.id,
      genome_id: genome.id,
      key_id: 7,
      code_version: 1,
      issue,
      issued_day: 1000,
      nonce: new Uint8Array([1, 2, 3, issue]),
      payload: new Uint8Array(13).fill(issue),
      signature: new Uint8Array(64).fill(issue),
      payload_hash: new Uint8Array(32).fill(issue),
      status,
    });
    const code1 = await t.db.insertInto('codes').values(codeValues(1)).returningAll().executeTakeFirstOrThrow();
    expect(code1.nonce).toEqual(new Uint8Array([1, 2, 3, 1]));
    // Only one ACTIVE code per product.
    await expect(t.db.insertInto('codes').values(codeValues(2)).execute()).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'codes_single_active_per_product'),
    );
    await t.db.updateTable('codes').set({ status: 'SUPERSEDED' }).where('id', '=', code1.id).execute();
    await expect(t.db.updateTable('codes').set({ signature: new Uint8Array(64) }).where('id', '=', code1.id).execute()).rejects.toSatisfy(
      isGuardViolation,
    );
    const code2 = await t.db.insertInto('codes').values(codeValues(2)).returningAll().executeTakeFirstOrThrow();

    await t.db
      .insertInto('warranties')
      .values({ product_id: product.id, duration_months: 24, start_date: '2026-02-01', end_date: '2028-02-01' })
      .execute();

    const o = await t.db.selectFrom('product_overview').selectAll().where('id', '=', product.id).executeTakeFirstOrThrow();
    expect(o).toMatchObject({
      product_id: product.product_id,
      packed_identity: product.packed_identity,
      category_code: category.code,
      category: category.name,
      collection: null,
      model: 'MONOLITHE',
      model_type: 'RING',
      material: '925 STERLING SILVER',
      genome_id: product.product_id,
      genome_version: 1,
      genome_pattern: 'a·b·c·d·e·f·g·h',
      genome_fingerprint: 'G1-DEAD-BEEF',
      code_id: code2.id,
      code_version: 1,
      code_issue: 2,
      status: 'ISSUED',
      warranty_start: '2026-02-01',
      warranty_end: '2028-02-01',
      ownership_state: 'UNREGISTERED',
    });
  });

  it('ownership, transfers and anomalies partial unique indexes', async () => {
    const { product } = await seedProduct(t.db);
    const acc = (n: number) =>
      t.db
        .insertInto('accounts')
        .values({ email: `u${n}@x.test`, email_normalized: `u${n}@x.test`, password_hash: 'scrypt$x' })
        .returningAll()
        .executeTakeFirstOrThrow();
    const a1 = await acc(1);
    const a2 = await acc(2);
    await t.db.insertInto('ownership').values({ product_id: product.id, account_id: a1.id, acquired_via: 'FIRST_REGISTRATION' }).execute();
    await expect(
      t.db.insertInto('ownership').values({ product_id: product.id, account_id: a2.id, acquired_via: 'TRANSFER' }).execute(),
    ).rejects.toSatisfy((e) => isUniqueViolation(e, 'ownership_single_current'));
    await t.db.updateTable('ownership').set({ ended_at: new Date(Date.now() + 1000), ended_reason: 'TRANSFERRED_OUT' }).where('account_id', '=', a1.id).execute();
    await t.db.insertInto('ownership').values({ product_id: product.id, account_id: a2.id, acquired_via: 'TRANSFER' }).execute();

    const transfer = (b: number) => ({
      product_id: product.id,
      from_account_id: a2.id,
      token_hash: new Uint8Array(32).fill(b),
      expires_at: new Date(Date.now() + 86_400_000),
    });
    await t.db.insertInto('ownership_transfers').values(transfer(1)).execute();
    await expect(t.db.insertInto('ownership_transfers').values(transfer(2)).execute()).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'ownership_transfers_single_pending'),
    );

    const anomaly = { product_id: product.id, type: 'SCAN_VELOCITY', severity: 'MEDIUM' as const, risk_score: 35, details: S.jsonText({ scans: 25 }) };
    const an = await t.db.insertInto('anomalies').values(anomaly).returningAll().executeTakeFirstOrThrow();
    expect(an.details).toEqual({ scans: 25 });
    expect(an.occurrences).toBe(1);
    await expect(t.db.insertInto('anomalies').values(anomaly).execute()).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'anomalies_single_open_per_type'),
    );
    await t.db.updateTable('anomalies').set({ status: 'RESOLVED' }).where('id', '=', an.id).execute();
    await t.db.insertInto('anomalies').values(anomaly).execute();
  });

  it('scan and authentication events store metrics, reasons and authenticators', async () => {
    const { product } = await seedProduct(t.db);
    const scan = await t.db
      .insertInto('scan_events')
      .values({
        product_id: product.id,
        packed_identity: product.packed_identity,
        event_type: 'VERIFY',
        country: 'FR',
        lat: 48.9,
        lon: 2.3,
        client_metrics: S.jsonText({ rsErrors: 2 }),
        result_state: 'AUTHENTIC',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(scan.client_metrics).toEqual({ rsErrors: 2 });
    expect(scan.lat).toBeCloseTo(48.9, 4);
    const ae = await t.db
      .insertInto('authentication_events')
      .values({
        scan_event_id: scan.id,
        product_id: product.id,
        key_id: 1,
        signature_valid: true,
        genome_check: 'MATCH',
        state: 'AUTHENTIC',
        reasons: ['SIGNATURE_OK', 'a,b "quoted"'],
        risk_score: 0,
        // A top-level JSON array: the reason jsonb columns take JSON text.
        authenticators: S.jsonText([{ kind: 'PRINTED_CODE', status: 'PASS' }]),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(ae.reasons).toEqual(['SIGNATURE_OK', 'a,b "quoted"']);
    expect(ae.authenticators).toEqual([{ kind: 'PRINTED_CODE', status: 'PASS' }]);
    await expect(
      t.db
        .insertInto('authentication_events')
        .values({ scan_event_id: scan.id, signature_valid: false, genome_check: 'MATCH', state: 'FAKE' as S.VerificationState, risk_score: 0 })
        .execute(),
    ).rejects.toSatisfy((e) => isCheckViolation(e));
  });

  it('scan_reports: one report per scan, bounded free text, a closed case names who closed it and when', async () => {
    const scan = await t.db.insertInto('scan_events').values({ event_type: 'VERIFY', result_state: 'INVALID_SIGNATURE' }).returning('id').executeTakeFirstOrThrow();
    const report = await t.db
      .insertInto('scan_reports')
      .values({ scan_event_id: scan.id, channel: 'ONLINE', place: 'a marketplace', note: 'Listed at a third of the price.' })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(report).toMatchObject({ status: 'OPEN', handled_by: null, handled_at: null, resolution_note: null });
    await expect(t.db.insertInto('scan_reports').values({ scan_event_id: scan.id, channel: 'OTHER' }).execute()).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'scan_reports_scan_event_id_key'),
    );
    const other = await t.db.insertInto('scan_events').values({ event_type: 'VERIFY', result_state: 'UNKNOWN' }).returning('id').executeTakeFirstOrThrow();
    for (const bad of [
      { channel: 'MARKET' as S.ReportChannel },
      { channel: 'ONLINE' as const, place: '' },
      { channel: 'ONLINE' as const, place: 'x'.repeat(201) },
      { channel: 'ONLINE' as const, note: 'x'.repeat(501) },
    ]) {
      await expect(t.db.insertInto('scan_reports').values({ scan_event_id: other.id, ...bad }).execute(), JSON.stringify(bad).slice(0, 60)).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    // The report needs a scan; the scan cannot go while its report is there (the purge deletes reports first).
    await expect(t.db.insertInto('scan_reports').values({ scan_event_id: '00000000-0000-4000-8000-000000000000', channel: 'OTHER' }).execute()).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e),
    );
    await expect(t.db.deleteFrom('scan_events').where('id', '=', scan.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // CLOSED ⇔ handled: who and when, and nothing of the kind on an OPEN case.
    const admin = await t.db
      .insertInto('admin_users')
      .values({ email: 'cases@orbes.test', email_normalized: 'cases@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(t.db.updateTable('scan_reports').set({ status: 'CLOSED' }).where('id', '=', report.id).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'scan_reports_handled_consistent'),
    );
    await expect(t.db.updateTable('scan_reports').set({ handled_by: admin.id }).where('id', '=', report.id).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'scan_reports_handled_consistent'),
    );
    await expect(
      t.db.updateTable('scan_reports').set({ status: 'CLOSED', handled_by: admin.id, handled_at: new Date(report.created_at.getTime() - 1000) }).where('id', '=', report.id).execute(),
    ).rejects.toSatisfy((e) => isCheckViolation(e));
    const closed = await t.db
      .updateTable('scan_reports')
      .set({ status: 'CLOSED', handled_by: admin.id, handled_at: new Date(report.created_at.getTime() + 1000), resolution_note: 'Seller reported to the platform.' })
      .where('id', '=', report.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(closed).toMatchObject({ status: 'CLOSED', handled_by: admin.id, resolution_note: 'Seller reported to the platform.' });
    await expect(t.db.deleteFrom('admin_users').where('id', '=', admin.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });

  it('account_recovery_codes: a scrypt hash, one open code per account, used or revoked but not both; transfers_frozen_until', async () => {
    const account = await t.db
      .insertInto('accounts')
      .values({ email: 'recover@example.com', email_normalized: 'recover@example.com', password_hash: 'scrypt$x' })
      .returningAll()
      .executeTakeFirstOrThrow();
    // 0005: a nullable pause on the account, null by default.
    expect(account.transfers_frozen_until).toBeNull();
    const admin = await t.db
      .insertInto('admin_users')
      .values({ email: 'recovery@orbes.test', email_normalized: 'recovery@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const now = new Date('2026-10-02T09:00:00.000Z');
    const code = (over: Partial<S.NewAccountRecoveryCode> = {}): S.NewAccountRecoveryCode => ({
      account_id: account.id,
      code_hash: 'scrypt$15$8$1$salt$hash',
      created_by: admin.id,
      created_at: now,
      expires_at: new Date(now.getTime() + 30 * 60_000),
      ...over,
    });
    const first = await t.db.insertInto('account_recovery_codes').values(code()).returningAll().executeTakeFirstOrThrow();
    expect(first).toMatchObject({ used_at: null, revoked_at: null, created_by: admin.id });
    // One open code per account (neither used nor revoked).
    await expect(t.db.insertInto('account_recovery_codes').values(code()).execute()).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'account_recovery_codes_single_open'),
    );
    for (const bad of [
      { code_hash: 'plaintext-code' },
      { expires_at: now },
      { used_at: new Date(now.getTime() - 1000), revoked_at: null },
    ]) {
      await t.db.updateTable('account_recovery_codes').set({ revoked_at: now }).where('id', '=', first.id).execute();
      await expect(t.db.insertInto('account_recovery_codes').values(code(bad)).execute(), JSON.stringify(bad)).rejects.toSatisfy((e) => isCheckViolation(e));
      await t.db.deleteFrom('account_recovery_codes').where('id', '!=', first.id).execute();
    }
    await expect(t.db.updateTable('account_recovery_codes').set({ used_at: now }).where('id', '=', first.id).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'account_recovery_codes_used_or_revoked'),
    );
    // Revoked, so a second one may be open; the account and the admin cannot go while their codes are there.
    await t.db.insertInto('account_recovery_codes').values(code()).execute();
    await expect(t.db.insertInto('account_recovery_codes').values(code({ account_id: '00000000-0000-4000-8000-000000000000' })).execute()).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e),
    );
    await expect(t.db.deleteFrom('accounts').where('id', '=', account.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(t.db.deleteFrom('admin_users').where('id', '=', admin.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });

  it('ownership_certificates (0013): a 32-byte token hash, unique; a piece and its ownership period; at most 90 days', async () => {
    const { product } = await seedProduct(t.db);
    const account = await t.db
      .insertInto('accounts')
      .values({ email: 'certificate@example.com', email_normalized: 'certificate@example.com', password_hash: 'scrypt$x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const period = await t.db.insertInto('ownership').values({ product_id: product.id, account_id: account.id, acquired_via: 'FIRST_REGISTRATION' }).returning('id').executeTakeFirstOrThrow();
    const now = new Date('2026-10-03T09:00:00.000Z');
    const day = 86_400_000;
    const cert = (over: Partial<S.NewOwnershipCertificate> = {}): S.NewOwnershipCertificate => ({
      token_hash: new Uint8Array(32).fill(1),
      product_id: product.id,
      ownership_id: period.id,
      created_at: now,
      expires_at: new Date(now.getTime() + 30 * day),
      ...over,
    });
    const first = await t.db.insertInto('ownership_certificates').values(cert()).returningAll().executeTakeFirstOrThrow();
    expect(first).toMatchObject({ product_id: product.id, ownership_id: period.id, revoked_at: null });
    expect(first.token_hash).toEqual(new Uint8Array(32).fill(1));
    // One certificate per token.
    await expect(t.db.insertInto('ownership_certificates').values(cert()).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'ownership_certificates_token_hash_key'));
    // Exactly 90 days is the longest; a SHA-256 is 32 bytes; it expires after it was created, and is withdrawn after too.
    await t.db.insertInto('ownership_certificates').values(cert({ token_hash: new Uint8Array(32).fill(2), expires_at: new Date(now.getTime() + 90 * day) })).execute();
    for (const [bad, constraint] of [
      [{ expires_at: new Date(now.getTime() + 90 * day + 1) }, 'ownership_certificates_lifetime'],
      [{ expires_at: now }, 'ownership_certificates_lifetime'],
      [{ token_hash: new Uint8Array(31).fill(3) }, 'ownership_certificates_token_hash_check'],
      [{ revoked_at: new Date(now.getTime() - 1) }, 'ownership_certificates_check'],
    ] as const) {
      await expect(t.db.insertInto('ownership_certificates').values(cert({ token_hash: new Uint8Array(32).fill(4), ...bad })).execute(), constraint).rejects.toSatisfy((e) =>
        isCheckViolation(e, constraint),
      );
    }
    // The piece and the ownership period exist, and stay while a certificate names them.
    await expect(t.db.insertInto('ownership_certificates').values(cert({ token_hash: new Uint8Array(32).fill(5), ownership_id: '00000000-0000-4000-8000-000000000000' })).execute()).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e),
    );
    await expect(t.db.deleteFrom('ownership').where('id', '=', period.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });

  it('audit_logs is append-only at the database level', async () => {
    const h = (b: number) => new Uint8Array(32).fill(b);
    await t.db
      .insertInto('audit_logs')
      .values({ occurred_at: new Date(), actor_type: 'system', action: 'test.raw', prev_hash: h(0), hash: h(1) })
      .execute();
    await expect(t.db.updateTable('audit_logs').set({ action: 'x' }).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.deleteFrom('audit_logs').execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`TRUNCATE audit_logs`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // A second entry claiming the same predecessor (a fork) is refused.
    await expect(
      t.db
        .insertInto('audit_logs')
        .values({ occurred_at: new Date(), actor_type: 'system', action: 'test.fork', prev_hash: h(0), hash: h(2) })
        .execute(),
    ).rejects.toSatisfy((e) => isUniqueViolation(e, 'audit_logs_prev_hash_key'));
  });

  it('product_status_history is append-only; genomes and keys are never deleted (key ids never reused)', async () => {
    const { product } = await seedProduct(t.db);
    const h = await t.db
      .insertInto('product_status_history')
      .values({ product_id: product.id, from_status: null, to_status: 'ISSUED', actor_type: 'system' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await expect(t.db.updateTable('product_status_history').set({ reason: 'rewritten' }).where('id', '=', h.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.deleteFrom('product_status_history').where('id', '=', h.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`TRUNCATE product_status_history`.execute(t.db)).rejects.toSatisfy(isGuardViolation);

    const genome = await t.db
      .insertInto('genomes')
      .values({
        product_id: product.id,
        genome_version: 1,
        genome_id: product.product_id,
        value: 0x0badf00d,
        glyphs: [0, 11, 10, 13, 15, 0, 0, 13],
        pattern: 'a·b·c·d·e·f·g·h',
        fingerprint: 'G1-0BAD-F00D',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await expect(t.db.deleteFrom('genomes').where('id', '=', genome.id).execute()).rejects.toSatisfy(isGuardViolation);

    await t.db
      .insertInto('cryptographic_keys')
      .values({ key_id: 42, kid: 'k42', public_key: new Uint8Array(32).fill(42), status: 'REVOKED', provider: 'memory', provider_ref: 'mem:42', revoked_at: new Date() })
      .execute();
    await expect(t.db.deleteFrom('cryptographic_keys').where('key_id', '=', 42).execute()).rejects.toSatisfy(isGuardViolation);
    expect(await t.db.selectFrom('cryptographic_keys').select('key_id').where('key_id', '=', 42).executeTakeFirst()).toEqual({ key_id: 42 });
  });

  it('pg error helpers expose code and constraint', async () => {
    const e = await t.db.insertInto('categories').values({ id: 0, code: 'A', name: 'x' }).execute().catch((x: unknown) => x);
    expect(pgError(e)).toMatchObject({ code: '23514', constraint: 'categories_id_check', table: 'categories' });
    expect(pgError(new Error('plain'))).toBeUndefined();
    expect(pgError(null)).toBeUndefined();
  });
});

describe('schema value helpers', () => {
  it('toBytes normalises Buffers, ArrayBuffers and bytea hex text', () => {
    const buf = Buffer.from([1, 2, 3]);
    const out = S.toBytes(buf);
    expect(out.constructor).toBe(Uint8Array);
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
    const plain = new Uint8Array([4]);
    expect(S.toBytes(plain)).toBe(plain);
    expect(S.toBytes(new Uint8Array([5, 6]).buffer)).toEqual(new Uint8Array([5, 6]));
    expect(S.toBytes('\\x00ff')).toEqual(new Uint8Array([0, 255]));
    expect(() => S.toBytes('\\x0')).toThrow(TypeError);
    expect(() => S.toBytes('00ff')).toThrow(TypeError);
  });

  it('jsonText rejects values jsonb cannot hold', () => {
    expect(S.jsonText({ a: [1, 'b'] })).toBe('{"a":[1,"b"]}');
    expect(() => S.jsonText({ a: NaN })).toThrow(TypeError);
    expect(() => S.jsonText({ a: 1n })).toThrow(TypeError);
    expect(() => S.jsonText({ a: 'x\u0000y' })).toThrow(TypeError);
    expect(() => S.jsonText(undefined)).toThrow(TypeError);
  });
});
