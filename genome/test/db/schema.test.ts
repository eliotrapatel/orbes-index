import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import * as S from '../../src/server/db/schema.js';
import { ACTOR_TYPES } from '../../src/server/types.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, pgError } from '../../src/server/db/pg-errors.js';
import { packIdentity } from '../../src/core/identity.js';
import type { Db } from '../../src/server/db/connection.js';

/**
 * Quoted literals of the CHECK constraint(s) on table.column alone: a constraint across columns (a LIVE-only setting
 * NULL for a DRAW, a status with the columns it requires) quotes the other columns' values too, a subset of theirs.
 */
async function checkValues(db: Db, table: string, column: string): Promise<string[]> {
  const r = await sql<{ def: string }>`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'c' AND c.conrelid = ${table}::regclass AND a.attname = ${column} AND cardinality(c.conkey) = 1`.execute(db);
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
      // RESERVED (migration 0022) is never written in the history: an identity's lifecycle starts when it is issued.
      ['product_status_history', 'from_status', S.PRODUCT_HISTORY_STATUSES],
      ['product_status_history', 'to_status', S.PRODUCT_HISTORY_STATUSES],
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
      ['models', 'lookbook', S.LOOKBOOK_STATES],
      ['drop_entries', 'status', S.DROP_ENTRY_STATUSES],
      ['circle_posts', 'kind', S.CIRCLE_POST_KINDS],
      ['circle_rsvps', 'answer', S.CIRCLE_RSVP_ANSWERS],
      ['club_tiers', 'tier', S.CLUB_TIER_NAMES],
      ['shop_requests', 'status', S.SHOP_REQUEST_STATUSES],
      ['drops', 'mode', S.DROP_MODES],
      ['drops', 'ended_reason', S.LIVE_END_REASONS],
      ['live_entries', 'status', S.LIVE_ENTRY_STATUSES],
      ['live_entries', 'resolution', S.LIVE_RESOLUTIONS],
      ['shop_requests', 'outcome', S.SHOP_REQUEST_OUTCOMES],
      ['orders', 'channel', S.ORDER_CHANNELS],
      ['orders', 'status', S.ORDER_STATUSES],
      ['orders', 'reservation', S.ORDER_RESERVATIONS],
      ['order_events', 'status', S.ORDER_STATUSES],
      ['order_events', 'actor_type', ACTOR_TYPES],
      ['stock_movements', 'reason', S.STOCK_MOVEMENT_REASONS],
      ['stock_movements', 'actor_type', ACTOR_TYPES],
      ['bench_items', 'status', S.BENCH_ITEM_STATUSES],
      ['returns', 'outcome', S.RETURN_OUTCOMES],
      ['invoices', 'kind', S.INVOICE_KINDS],
      ['drops', 'access_combine', S.ACCESS_COMBINES],
      ['client_conversations', 'status', S.CLIENT_CONVERSATION_STATUSES],
      ['client_messages', 'author', S.CLIENT_MESSAGE_AUTHORS],
      ['client_messages', 'context_kind', S.CLIENT_MESSAGE_CONTEXTS],
      ['club_program_settings', 'shipping_free_platine', S.SHIPPING_FREE_LEVELS],
      ['club_program_settings', 'shipping_free_palladium', S.SHIPPING_FREE_LEVELS],
      ['club_program_settings', 'credit_currency', S.HOUSE_CURRENCIES],
      ['club_program_settings', 'credit_channels', S.CREDIT_CHANNELS],
      ['shipping_rates', 'currency', S.HOUSE_CURRENCIES],
      ['shipping_rates', 'service', S.SHIPPING_SERVICES],
      ['circle_posts', 'experience', S.CIRCLE_EXPERIENCES],
      ['tier_grants', 'kind', S.TIER_GRANT_KINDS],
      ['credit_uses', 'released_reason', S.CREDIT_RELEASE_REASONS],
      ['orders', 'shipping_service', S.SHIPPING_SERVICES],
      ['care_requests', 'status', S.CARE_REQUEST_STATUSES],
      ['care_requests', 'cancelled_by', S.CARE_CANCELLED_BY],
      ['house_guarantees', 'scope', S.GUARANTEE_SCOPES],
      ['house_guarantees', 'status', S.GUARANTEE_STATUSES],
      ['house_guarantees', 'closed_reason', S.GUARANTEE_CLOSED_REASONS],
      ['account_sizes', 'kind', S.SIZE_KINDS],
      ['models', 'size_kind', S.SIZE_KINDS],
      ['models', 'size_type', S.SIZE_TYPES],
      ['claim_code_renewals', 'kind', S.CLAIM_RENEWAL_KINDS],
      ['claim_code_renewals', 'status', S.CLAIM_RENEWAL_STATUSES],
      ['claim_code_renewals', 'withdrawn_reason', S.CLAIM_RENEWAL_WITHDRAWN_REASONS],
      ['supplier_orders', 'status', S.SUPPLIER_ORDER_STATUSES],
      ['receptions', 'status', S.RECEPTION_STATUSES],
      ['card_prints', 'erased_reason', S.CARD_ERASED_REASONS],
      ['supplier_returns', 'status', S.SUPPLIER_RETURN_STATUSES],
      ['supplier_returns', 'settlement', S.SUPPLIER_RETURN_SETTLEMENTS],
      ['stock_corrections', 'status', S.STOCK_CORRECTION_STATUSES],
      ['shipments', 'status', S.SHIPMENT_STATUSES],
      ['shipments', 'photo_mime', ['image/jpeg', 'image/webp']],
      ['order_cases', 'kind', S.ORDER_CASE_KINDS],
      ['order_cases', 'opened_by_type', S.ORDER_CASE_OPENERS],
      ['order_cases', 'reason', S.ORDER_CASE_REASONS],
      ['order_cases', 'status', S.ORDER_CASE_STATUSES],
      ['order_cases', 'piece_state', S.ORDER_CASE_PIECE_STATES],
      ['order_cases', 'outcome', S.ORDER_CASE_OUTCOMES],
      ['order_cases', 'piece_to', S.ORDER_CASE_PIECE_DESTINATIONS],
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

  it('claim_code_renewals (0034): each kind its target and status; sealed exactly while WAITING; read and withdrawn with their times; a reason but for UNSHOWN; one code waiting per piece; identity guarded; never deleted', async () => {
    const { product, model } = await seedProduct(t.db);
    const other = (await seedProduct(t.db)).product;
    const account = await t.db.insertInto('accounts').values({ email: 'renewal@example.com', email_normalized: 'renewal@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const admin = await t.db.insertInto('admin_users').values({ email: 'renewal@orbes.test', email_normalized: 'renewal@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
    const location = await t.db.insertInto('stock_locations').values({ name: 'RENEWAL STOCK' }).returning('id').executeTakeFirstOrThrow();
    const request = await t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: model.id }).returning('id').executeTakeFirstOrThrow();
    const order = await t.db
      .insertInto('orders')
      .values({ channel: 'SALON', shop_request_id: request.id, account_id: account.id, model_id: model.id, location_id: location.id, product_id: product.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const base = { product_id: product.id, claim_hash: 'scrypt$hash', reason: 'Card lost at the warehouse.', created_by: admin.id };
    const staff: S.NewClaimCodeRenewal = { ...base, kind: 'STAFF', status: 'SHOWN' };
    const buyer: S.NewClaimCodeRenewal = { ...base, kind: 'BUYER', status: 'WAITING', order_id: order.id, account_id: account.id, sealed_code: 'v1.iv.sealed' };
    const unshown: S.NewClaimCodeRenewal = { product_id: product.id, claim_hash: 'scrypt$other', kind: 'UNSHOWN', status: 'UNSHOWN', order_id: order.id };
    const insert = (v: S.NewClaimCodeRenewal) => t.db.insertInto('claim_code_renewals').values(v).returning('id').executeTakeFirstOrThrow();
    const now = new Date('2026-10-08T12:00:00.000Z');
    for (const [label, v, constraint] of [
      // Each kind its target: STAFF neither order nor account, BUYER both, UNSHOWN the order alone.
      ['STAFF with an order', { ...staff, order_id: order.id }, 'claim_code_renewals_target'],
      ['BUYER without its account', { ...buyer, account_id: null }, 'claim_code_renewals_target'],
      ['BUYER without its order', { ...buyer, order_id: null }, 'claim_code_renewals_target'],
      ['UNSHOWN with an account', { ...unshown, account_id: account.id }, 'claim_code_renewals_target'],
      ['UNSHOWN without its order', { ...unshown, order_id: null }, 'claim_code_renewals_target'],
      // Each kind its statuses.
      ['STAFF waiting', { ...staff, status: 'WAITING', sealed_code: 'v1.x.y' }, 'claim_code_renewals_kind_status'],
      ['BUYER shown', { ...buyer, status: 'SHOWN', sealed_code: null }, 'claim_code_renewals_kind_status'],
      ['UNSHOWN read', { ...unshown, status: 'READ', read_at: now }, 'claim_code_renewals_kind_status'],
      // An unknown kind or status fails its own CHECK and the kind's statuses together.
      ['an unknown status', { ...staff, status: 'LOST' as 'SHOWN' }, undefined],
      ['an unknown kind', { ...staff, kind: 'AGENT' as 'STAFF' }, undefined],
      // Sealed exactly while WAITING.
      ['WAITING without its sealed code', { ...buyer, sealed_code: null }, 'claim_code_renewals_sealed'],
      ['SHOWN with a sealed code', { ...staff, sealed_code: 'v1.x.y' }, 'claim_code_renewals_sealed'],
      ['READ with its sealed code', { ...buyer, status: 'READ', read_at: now }, 'claim_code_renewals_sealed'],
      // Read exactly when READ.
      ['READ without its time', { ...buyer, status: 'READ', sealed_code: null }, 'claim_code_renewals_read'],
      ['WAITING with a read time', { ...buyer, read_at: now }, 'claim_code_renewals_read'],
      // Withdrawn exactly when WITHDRAWN, its time and reason together.
      ['WITHDRAWN without its reason', { ...buyer, status: 'WITHDRAWN', sealed_code: null, withdrawn_at: now }, 'claim_code_renewals_withdrawn'],
      ['WITHDRAWN without its time', { ...buyer, status: 'WITHDRAWN', sealed_code: null, withdrawn_reason: 'REGISTERED' }, 'claim_code_renewals_withdrawn'],
      ['WAITING with a withdrawal', { ...buyer, withdrawn_at: now, withdrawn_reason: 'REGISTERED' }, 'claim_code_renewals_withdrawn'],
      ['SHOWN with a reason withdrawn', { ...staff, withdrawn_reason: 'REGISTERED' }, 'claim_code_renewals_withdrawn'],
      ['an unknown reason withdrawn', { ...buyer, status: 'WITHDRAWN', sealed_code: null, withdrawn_at: now, withdrawn_reason: 'LOST' as 'REGISTERED' }, 'claim_code_renewals_withdrawn_reason_check'],
      // A reason of 1 to 500 characters, exactly when the kind is not UNSHOWN.
      ['STAFF without its reason', { ...staff, reason: null }, 'claim_code_renewals_reason'],
      ['UNSHOWN with a reason', { ...unshown, reason: 'x' }, 'claim_code_renewals_reason'],
      ['a blank reason', { ...staff, reason: '   ' }, 'claim_code_renewals_reason_check'],
      ['a reason of 501 characters', { ...staff, reason: 'x'.repeat(501) }, 'claim_code_renewals_reason_check'],
    ] as const) {
      await expect(insert(v as S.NewClaimCodeRenewal), label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    await insert({ ...staff, reason: 'x'.repeat(500) });
    const shown = await insert(staff);
    const waiting = await insert(buyer);
    await insert(unshown);
    // One code waits per piece; another piece may have its own.
    await expect(insert(buyer)).rejects.toSatisfy((e) => isUniqueViolation(e, 'claim_code_renewals_waiting_key'));
    await insert({ ...buyer, product_id: other.id });
    // Read: the sealed code wiped, the time kept; then a new one may wait.
    await t.db.updateTable('claim_code_renewals').set({ status: 'READ', read_at: now, sealed_code: null }).where('id', '=', waiting.id).execute();
    const next = await insert(buyer);
    await t.db.updateTable('claim_code_renewals').set({ status: 'WITHDRAWN', withdrawn_at: now, withdrawn_reason: 'RENEWED_AGAIN', sealed_code: null }).where('id', '=', next.id).execute();
    // Its identity, target, hash, reason and author never change; a row is never deleted nor truncated.
    for (const set of [{ product_id: other.id }, { kind: 'BUYER' as const }, { order_id: order.id }, { account_id: account.id }, { claim_hash: 'scrypt$changed' }, { reason: 'Rewritten.' }, { created_by: null }, { created_at: now }]) {
      await expect(t.db.updateTable('claim_code_renewals').set(set).where('id', '=', shown.id).execute(), JSON.stringify(set)).rejects.toSatisfy(isGuardViolation);
    }
    await expect(t.db.deleteFrom('claim_code_renewals').where('id', '=', shown.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`TRUNCATE claim_code_renewals`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // Its piece, order, account and author stay while a row names them (RESTRICT).
    await expect(t.db.deleteFrom('orders').where('id', '=', order.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(t.db.deleteFrom('accounts').where('id', '=', account.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(t.db.deleteFrom('admin_users').where('id', '=', admin.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(insert({ ...staff, product_id: '00000000-0000-4000-8000-000000000000' })).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });

  it('LOGISTICS (0035): a login\'s locations once each; a location\'s address; a supplier named once, never deleted, its identity guarded; the supplier of a model and of a size', async () => {
    const { model } = await seedProduct(t.db);
    const admin = await t.db.insertInto('admin_users').values({ email: 'team-0035@orbes.test', email_normalized: 'team-0035@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    const agent = await t.db.insertInto('admin_users').values({ email: 'agent-0035@orbes.test', email_normalized: 'agent-0035@orbes.test', password_hash: 'scrypt$x', role: 'LOGISTICS' }).returning(['id', 'role']).executeTakeFirstOrThrow();
    expect(agent.role).toBe('LOGISTICS');
    const location = await t.db.insertInto('stock_locations').values({ name: 'AGENT 0035', address: '1 quai de Test\n93200 Saint-Denis' }).returning(['id', 'address']).executeTakeFirstOrThrow();
    expect(location.address).toBe('1 quai de Test\n93200 Saint-Denis');
    const tie = await t.db.insertInto('admin_user_locations').values({ admin_user_id: agent.id, stock_location_id: location.id, created_by: admin.id }).returningAll().executeTakeFirstOrThrow();
    expect(tie).toEqual({ admin_user_id: agent.id, stock_location_id: location.id, created_by: admin.id, created_at: expect.any(Date) });
    await expect(t.db.insertInto('admin_user_locations').values({ admin_user_id: agent.id, stock_location_id: location.id }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'admin_user_locations_pkey'));
    const supplier = await t.db.insertInto('suppliers').values({ name: 'NORD SUPPLY 0035', currency: 'GBP', created_by: admin.id }).returningAll().executeTakeFirstOrThrow();
    expect(supplier).toMatchObject({ name: 'NORD SUPPLY 0035', contact_name: null, email: null, phone: null, address: null, currency: 'GBP', note: null, active: true, created_by: admin.id });
    await expect(t.db.insertInto('suppliers').values({ name: 'nord supply 0035' }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'suppliers_name_key'));
    await expect(t.db.insertInto('suppliers').values({ name: 'X', currency: 'gbp' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'suppliers_currency_check'));
    await t.db.updateTable('suppliers').set({ active: false, note: 'Paused.' }).where('id', '=', supplier.id).execute();
    await expect(t.db.updateTable('suppliers').set({ created_at: new Date('2026-01-01T00:00:00Z') }).where('id', '=', supplier.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.deleteFrom('suppliers').where('id', '=', supplier.id).execute()).rejects.toSatisfy(isGuardViolation);
    await t.db.updateTable('models').set({ supplier_id: supplier.id }).where('id', '=', model.id).execute();
    const sku = await t.db.insertInto('skus').values({ model_id: model.id, size_label: '54', code: `${model.sku_prefix}-54`, supplier_id: supplier.id }).returning(['supplier_id']).executeTakeFirstOrThrow();
    expect(sku.supplier_id).toBe(supplier.id);
    await expect(t.db.deleteFrom('stock_locations').where('id', '=', location.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(t.db.deleteFrom('admin_users').where('id', '=', agent.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });

  it('supplier orders (0036): the mirror at work: a draft, its line, a reception and its line, a RECEIVED movement, the piece it issued, its card, a correction', async () => {
    const { model } = await seedProduct(t.db);
    const admin = await t.db.insertInto('admin_users').values({ email: 'so-0036@orbes.test', email_normalized: 'so-0036@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
    const location = await t.db.insertInto('stock_locations').values({ name: 'SO MIRROR 0036' }).returning('id').executeTakeFirstOrThrow();
    const supplier = await t.db.insertInto('suppliers').values({ name: 'MIRROR SUPPLY 0036', currency: 'EUR' }).returning('id').executeTakeFirstOrThrow();
    const sku = await t.db.insertInto('skus').values({ model_id: model.id, size_label: '56', code: `${model.sku_prefix}-56` }).returning('id').executeTakeFirstOrThrow();
    const order = await t.db.insertInto('supplier_orders').values({ supplier_id: supplier.id, location_id: location.id, created_by: admin.id }).returningAll().executeTakeFirstOrThrow();
    expect(order).toMatchObject({ status: 'DRAFT', currency: null, shipping_minor: null, expected_on: null, sent_at: null, invoice_minor: null });
    await t.db.updateTable('supplier_orders').set({ status: 'SENT', sent_at: new Date(), currency: 'EUR', expected_on: '2026-11-02', shipping_minor: 1500 }).where('id', '=', order.id).execute();
    expect((await t.db.selectFrom('supplier_orders').select(['expected_on', 'shipping_minor']).where('id', '=', order.id).executeTakeFirstOrThrow())).toEqual({ expected_on: '2026-11-02', shipping_minor: 1500 });
    const line = await t.db.insertInto('supplier_order_lines').values({ supplier_order_id: order.id, sku_id: sku.id, quantity: 4, unit_price_minor: 4200 }).returningAll().executeTakeFirstOrThrow();
    expect(line).toMatchObject({ accepted_quantity: 0, rejected_quantity: 0, credited_quantity: 0, rest_cancelled_quantity: 0 });
    const reception = await t.db.insertInto('receptions').values({ supplier_order_id: order.id, location_id: location.id, counted_by: admin.id }).returningAll().executeTakeFirstOrThrow();
    expect(reception.status).toBe('TO_CONFIRM');
    const rline = await t.db.insertInto('reception_lines').values({ reception_id: reception.id, sku_id: sku.id, supplier_order_line_id: line.id, accepted: 4 }).returningAll().executeTakeFirstOrThrow();
    expect(rline).toMatchObject({ rejected: 0, issued: 0, note: null });
    const movement = await t.db
      .insertInto('stock_movements')
      .values({ sku_id: sku.id, location_id: location.id, delta: 4, reason: 'RECEIVED', reception_line_id: rline.id, actor_type: 'system' })
      .returning(['id', 'reason', 'reception_line_id'])
      .executeTakeFirstOrThrow();
    expect(movement).toMatchObject({ reason: 'RECEIVED', reception_line_id: rline.id });
    const { product } = await seedProduct(t.db, { reception_line_id: rline.id, stock_entered_at: new Date('2026-10-08T10:00:00Z') });
    expect((await t.db.selectFrom('products').select(['reception_line_id', 'stock_entered_at']).where('id', '=', product.id).executeTakeFirstOrThrow())).toEqual({ reception_line_id: rline.id, stock_entered_at: new Date('2026-10-08T10:00:00Z') });
    await t.db.insertInto('card_prints').values({ product_id: product.id, reception_id: reception.id, sealed_claim_code: 'v1.iv.sealed' }).execute();
    const correction = await t.db.insertInto('stock_corrections').values({ sku_id: sku.id, location_id: location.id, delta: -1, reason: 'A piece found damaged.', proposed_by: admin.id }).returningAll().executeTakeFirstOrThrow();
    expect(correction).toMatchObject({ status: 'TO_APPROVE', decided_at: null, movement_id: null });
    await expect(t.db.deleteFrom('stock_corrections').where('id', '=', correction.id).execute()).rejects.toSatisfy(isGuardViolation);
  });

  it('draw sizes (0038): the mirror at work: a draw\'s sizes, an entry in one of them, none in a draw without sizes; another drop\'s size refused; a size chosen kept', async () => {
    const { model } = await seedProduct(t.db);
    const admin = await t.db.insertInto('admin_users').values({ email: 'draw-0038@orbes.test', email_normalized: 'draw-0038@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
    const account = await t.db.insertInto('accounts').values({ email: 'draw-0038@example.com', email_normalized: 'draw-0038@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const draw = (title: string) =>
      t.db
        .insertInto('drops')
        .values({ model_id: model.id, title, quantity: 8, opens_at: new Date('2026-11-01T10:00:00Z'), closes_at: new Date('2026-11-02T10:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`, seed_hash: new Uint8Array(32), created_by: admin.id })
        .returning('id')
        .executeTakeFirstOrThrow();
    const sized = await draw('SIZED 0038');
    const pooled = await draw('POOLED 0038');
    const size = await t.db.insertInto('drop_sizes').values({ drop_id: sized.id, label: '17', position: 1, stock: 5 }).returning(['id', 'stock', 'sku_id']).executeTakeFirstOrThrow();
    expect(size).toEqual({ id: expect.any(String), stock: 5, sku_id: null });
    const entry = await t.db.insertInto('drop_entries').values({ drop_id: sized.id, account_id: account.id, size_id: size.id }).returning(['size_id', 'status']).executeTakeFirstOrThrow();
    expect(entry).toEqual({ size_id: size.id, status: 'ENTERED' });
    const none = await t.db.insertInto('drop_entries').values({ drop_id: pooled.id, account_id: account.id }).returning('size_id').executeTakeFirstOrThrow();
    expect(none.size_id).toBeNull();
    await expect(t.db.updateTable('drop_entries').set({ size_id: size.id }).where('drop_id', '=', pooled.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'drop_entries_size_fkey'));
    await expect(t.db.deleteFrom('drop_sizes').where('id', '=', size.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
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
