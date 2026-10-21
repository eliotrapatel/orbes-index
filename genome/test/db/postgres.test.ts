/**
 * Real PostgreSQL parity suite (opt-in).
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/db/postgres.test.ts
 *
 * The role needs CREATEDB: each run creates a throwaway database, migrates
 * it, checks that pg returns the same JS types as PGlite and that audit
 * appends stay linear under true parallelism (pool of 8), as do category
 * allocation, the last-active-ADMIN rule of the Team page (A-02) and the
 * sale mode's activation (A-08: one warranty start per piece, one use per
 * token), then drops it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AuditService } from '../../src/server/services/audit.js';
import { AuthService } from '../../src/server/services/auth.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { SessionService } from '../../src/server/services/sessions.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { RetailerService } from '../../src/server/services/retailers.js';
import { SaleService } from '../../src/server/services/sale.js';
import { createScanToken } from '../../src/server/services/scan-tokens.js';
import type { VerificationService } from '../../src/server/services/verification.js';
import { WarrantyService } from '../../src/server/services/warranty.js';
import { isCheckViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('PostgreSQL parity', () => {
  let admin: Db;
  let db: Db;
  const dbName = `orbes_t_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 8 });
    await migrateToLatest(db);
  });

  afterAll(async () => {
    if (db) await closeDb(db);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });

  it('returns the same JS types as PGlite', async () => {
    const r = await sql<Record<string, unknown>>`
      SELECT 4294967295::int8 AS i8, 9007199254740993::int8 AS big, '2026-03-04'::date AS d,
             '\\x00ff10'::bytea AS b, ARRAY[1,2,15]::smallint[] AS arr, '{"a":[1,"x"]}'::jsonb AS j,
             '2026-01-01T00:00:00.123Z'::timestamptz AS ts, count(*) AS n FROM (VALUES (1)) v(x)`.execute(db);
    const row = r.rows[0];
    expect(row.i8).toBe(4294967295);
    expect(row.big).toBe(9007199254740993n);
    expect(row.d).toBe('2026-03-04');
    expect(row.b).toEqual(new Uint8Array([0, 255, 16]));
    expect((row.b as Uint8Array).constructor).toBe(Uint8Array);
    expect(row.arr).toEqual([1, 2, 15]);
    expect(row.j).toEqual({ a: [1, 'x'] });
    expect(row.ts).toEqual(new Date('2026-01-01T00:00:00.123Z'));
    expect(row.n).toBe(1);
  });

  it('writes JSON text into jsonb, including top-level arrays', async () => {
    const r = await sql<{ j: unknown }>`SELECT ${JSON.stringify([1, { a: 2 }])}::jsonb AS j`.execute(db);
    expect(r.rows[0].j).toEqual([1, { a: 2 }]);
  });

  it('keeps the audit chain linear under parallel appends from a pool', async () => {
    const audit = new AuditService({ db });
    const n = 40;
    await Promise.all(Array.from({ length: n }, (_, i) => audit.record({ actor: { type: 'system' }, action: 'test.parallel', details: { i } })));
    expect(await audit.verifyChain()).toEqual({ ok: true, checked: n });
    await expect(db.deleteFrom('audit_logs').execute()).rejects.toSatisfy(isGuardViolation);
  });

  it('allocates distinct category indices under parallel creates', async () => {
    const audit = new AuditService({ db });
    const registries = Array.from({ length: 6 }, () => new CategoryRegistry({ db, audit }));
    await Promise.all(registries.map((r) => r.load()));
    const created = await Promise.all(
      'ABCDEF'.split('').map((code, i) => registries[i].create({ code, name: `Cat ${code}` }, { type: 'system' })),
    );
    expect(created.map((c) => c.index).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('keeps one active ADMIN when ADMINs disable each other at the same moment from a pool', async () => {
    const audit = new AuditService({ db });
    const sessions = new SessionService({ db, ttlHours: { account: 1, admin: 1 } });
    const auth = new AuthService({ db, audit, sessions, totpKey: new Uint8Array(32).fill(3) });
    const password = 'a long parity passphrase';
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c']) ids.push((await auth.createAdmin({ email: `${name}@parity.test`, password, role: 'ADMIN' }, { type: 'system' })).id);
    // Each ADMIN disables the next one: without the roster lock all three could commit.
    const results = await Promise.allSettled(ids.map((id, i) => auth.setAdminDisabled(ids[(i + 1) % ids.length], true, { type: 'admin', id })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['LAST_ADMIN']);
    const active = await db.selectFrom('admin_users').select('id').where('role', '=', 'ADMIN').where('disabled_at', 'is', null).execute();
    expect(active).toHaveLength(1);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('starts a warranty once when two phones activate the same piece at the same moment, and uses a sale token once', async () => {
    const audit = new AuditService({ db });
    const lifecycle = new LifecycleService({ db, audit });
    const warranty = new WarrantyService({ db, audit, lifecycle });
    // activate() never calls the verification service (lookup does).
    const sale = new SaleService({ db, verification: null as unknown as VerificationService, warranty });
    const shop = await new RetailerService({ db, audit }).create({ name: 'ORBES Paris', city: 'Paris', country: 'FR' }, { type: 'system' });
    const seller = await db
      .insertInto('admin_users')
      .values({ email: 'seller@parity.test', email_normalized: 'seller@parity.test', password_hash: 'scrypt$x', role: 'RETAIL' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.insertInto('categories').values({ id: 20, code: 'S', name: 'Sale parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 20, name: 'MONOLITHE', type: 'RING', sku_prefix: 'SALE' }).returning('id').executeTakeFirstOrThrow();
    await db
      .insertInto('cryptographic_keys')
      .values({ key_id: 9, kid: 'sale-parity', public_key: new Uint8Array(32).fill(9), status: 'RETIRED', provider: 'memory', provider_ref: 'mem:9' })
      .execute();
    // A piece with its genome and its code in force: the activation checks again, under the row lock, that the
    // scanned code is still the piece's ACTIVE code (WarrantyService.assertStillForSale).
    const piece = async (serial: number) => {
      const p = await db
        .insertInto('products')
        .values({ product_id: `O26-S-${String(serial).padStart(5, '0')}`, packed_identity: (26 << 25) | (20 << 20) | serial, year: 2026, category_id: 20, serial, sku: `SALE-${serial}`, model_id: model.id, material: 'SILVER' })
        .returning(['id', 'product_id'])
        .executeTakeFirstOrThrow();
      await db.insertInto('product_status_history').values({ product_id: p.id, from_status: null, to_status: 'ISSUED', actor_type: 'system' }).execute();
      const genome = await db
        .insertInto('genomes')
        .values({ product_id: p.id, genome_version: 1, genome_id: p.product_id, value: serial, glyphs: [1, 2, 3, 4, 5, 6, 7, serial], pattern: 'sale parity', fingerprint: `G1-5A1E-${serial.toString(16).toUpperCase().padStart(4, '0')}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      const code = await db
        .insertInto('codes')
        .values({ product_id: p.id, genome_id: genome.id, key_id: 9, code_version: 1, issue: 1, issued_day: 1000, nonce: randomBytes(4), payload: randomBytes(13), signature: randomBytes(64), payload_hash: randomBytes(32) })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { ...p, codeId: code.id };
    };
    // The seller's staff scan of the piece's code, and the sale token it earned.
    const token = async (p: { id: string; codeId: string }) => {
      const scan = await db
        .insertInto('scan_events')
        .values({ event_type: 'ADMIN_TEST', admin_id: seller.id, product_id: p.id, code_id: p.codeId, result_state: 'AUTHENTIC' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return (await createScanToken(db, { productId: p.id, scanEventId: scan.id, purpose: 'SALE_ACTIVATION', ttlMs: 600_000 })).token;
    };
    const actor = { type: 'admin' as const, id: seller.id };
    // What refused each activation, in the failure message: a domain code, or a PostgreSQL error (40P01, 40001).
    const refusals = (rs: PromiseSettledResult<unknown>[]) =>
      rs.map((r) => (r.status === 'rejected' ? `${(r.reason as { code?: string }).code ?? ''} ${(r.reason as Error).message}` : 'activated')).join('; ');

    // Two sellers' scans of one piece: one warranty start; the losing token is rolled back, not used.
    const a = await piece(1);
    const tokens = [await token(a), await token(a)];
    const results = await Promise.allSettled(tokens.map((t) => sale.activate({ token: t, retailerId: shop.id }, actor)));
    expect(results.filter((r) => r.status === 'fulfilled'), refusals(results)).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['WARRANTY_ALREADY_ACTIVATED']);
    const used = await db.selectFrom('scan_tokens').select('used_at').where('product_id', '=', a.id).execute();
    expect(used.filter((r) => r.used_at !== null)).toHaveLength(1);

    // One token sent twice at once: used once.
    const b = await piece(2);
    const t = await token(b);
    const twice = await Promise.allSettled([t, t].map((x) => sale.activate({ token: x, retailerId: shop.id }, actor)));
    expect(twice.filter((r) => r.status === 'fulfilled'), refusals(twice)).toHaveLength(1);
    expect(twice.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['SALE_TOKEN_USED']);
    expect(await db.selectFrom('product_status_history').select('to_status').where('product_id', '=', b.id).where('to_status', '=', 'ACTIVATED').execute()).toHaveLength(1);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('fills a warranty\'s kind from its model and clears a lifetime warranty\'s end date before its constraints (0048, warranties_kind), so the previous image\'s insert and activation pass during the roll-out; gives back an end date clamped to the month\'s end', async () => {
    await db.insertInto('categories').values({ id: 21, code: 'W', name: 'Warranty parity' }).execute();
    // A model written by plain SQL is at 2 years (the column's false); the service's Lifetime is written explicitly.
    const twoYears = await db.insertInto('models').values({ category_id: 21, name: 'ECLIPSE', type: 'BAG', sku_prefix: 'WKIND-BG' }).returning(['id', 'warranty_lifetime']).executeTakeFirstOrThrow();
    expect(twoYears.warranty_lifetime).toBe(false);
    const lifetime = await db.insertInto('models').values({ category_id: 21, name: 'HALO', type: 'RING', sku_prefix: 'WKIND-RG', warranty_lifetime: true }).returning('id').executeTakeFirstOrThrow();
    const piece = async (serial: number, model: string) =>
      (
        await db
          .insertInto('products')
          .values({ product_id: `O26-W-${String(serial).padStart(5, '0')}`, packed_identity: (26 << 25) | (21 << 20) | serial, year: 2026, category_id: 21, serial, sku: `WKIND-${serial}`, model_id: model, material: 'SILVER' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const bag = await piece(1, twoYears.id);
    const ring = await piece(2, lifetime.id);
    // Inserted as the previous image does, without the kind: each takes its model's.
    await db.insertInto('warranties').values({ product_id: bag, duration_months: 24 }).execute();
    await db.insertInto('warranties').values({ product_id: ring, duration_months: 24 }).execute();
    // Its activation writes the start, the months and the end: kept on the 2-year piece, the end cleared on the lifetime one.
    await db.updateTable('warranties').set({ start_date: '2026-01-31', duration_months: 1, end_date: '2026-02-28' }).where('product_id', 'in', [bag, ring]).execute();
    const rows = await db.selectFrom('warranties').select(['product_id', 'lifetime', 'end_date']).where('product_id', 'in', [bag, ring]).execute();
    expect(rows.find((r) => r.product_id === bag)).toMatchObject({ lifetime: false, end_date: '2026-02-28' });
    expect(rows.find((r) => r.product_id === ring)).toMatchObject({ lifetime: true, end_date: null });
    // DOWN's (and a switch to 2 years') end date: start + months, clamped to the month's end as addMonthsClamped does.
    const end = await sql<{ d: string }>`SELECT ((date '2026-01-31' + make_interval(months => 1))::date)::text AS d`.execute(db);
    expect(end.rows[0].d).toBe('2026-02-28');
  });

  it('holds the pace of a LIVE RELEASE and the admission of its entries by their CHECKs (0049), with the previous image\'s inserts unpaced and not admitted, and the same JS types as PGlite', async () => {
    await db.insertInto('categories').values({ id: 22, code: 'P', name: 'Pace parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 22, name: 'PACE', type: 'RING', sku_prefix: 'PACE-PG' }).returning('id').executeTakeFirstOrThrow();
    const account = await db.insertInto('accounts').values({ email: 'pace-pg@example.com', email_normalized: 'pace-pg@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    // Inserted as the previous image does, naming none of the pace's columns.
    const release = await db
      .insertInto('drops')
      .values({
        model_id: model.id, title: 'PACE PG', quantity: 2, opens_at: new Date('2026-12-01T10:00:00Z'), closes_at: new Date('2026-12-01T11:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
        seed_hash: new Uint8Array(32), early_access_hours: 0, mode: 'LIVE', live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1,
        price_minor: 1000, currency: 'EUR', quantity_line: '2 PIECES', published_at: new Date('2026-11-30T10:00:00Z'),
      })
      .returning(['id', 'pace_batch', 'pace_minutes', 'pace_next_at', 'pace_paused_at', 'pace_batches'])
      .executeTakeFirstOrThrow();
    expect(release).toEqual({ id: expect.any(String), pace_batch: null, pace_minutes: null, pace_next_at: null, pace_paused_at: null, pace_batches: 0 });
    const set = (v: Record<string, unknown>) => db.updateTable('drops').set(v).where('id', '=', release.id).execute();
    await expect(set({ pace_batch: 250 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace'));
    await expect(set({ pace_batch: 5001, pace_minutes: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace_batch_check'));
    await expect(set({ pace_batch: 250, pace_minutes: 61 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace_minutes_check'));
    await expect(set({ pace_next_at: new Date('2026-12-01T10:01:00Z') })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace_state'));
    await expect(set({ pace_batches: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace'));
    const next = new Date('2026-12-01T10:01:00Z');
    await set({ pace_batch: 250, pace_minutes: 1, pace_next_at: next, pace_batches: 1 });
    const paced = await db.selectFrom('drops').select(['pace_batch', 'pace_minutes', 'pace_next_at', 'pace_batches']).where('id', '=', release.id).executeTakeFirstOrThrow();
    expect(paced).toEqual({ pace_batch: 250, pace_minutes: 1, pace_next_at: next, pace_batches: 1 });
    const size = await db.insertInto('drop_sizes').values({ drop_id: release.id, label: '52', position: 1, stock: 2 }).returning('id').executeTakeFirstOrThrow();
    // An entry queued as the previous image queues it: not admitted.
    const entry = await db
      .insertInto('live_entries')
      .values({ drop_id: release.id, account_id: account.id, size_id: size.id, quantity: 1, tier: 0, status: 'QUEUED', position: 1, queued_at: new Date('2026-12-01T10:00:00Z') })
      .returning(['id', 'admitted_at', 'admitted_batch'])
      .executeTakeFirstOrThrow();
    expect(entry).toEqual({ id: expect.any(String), admitted_at: null, admitted_batch: null });
    const admit = (v: Record<string, unknown>) => db.updateTable('live_entries').set(v).where('id', '=', entry.id).execute();
    await expect(admit({ admitted_at: next })).rejects.toSatisfy((e) => isCheckViolation(e, 'live_entries_admitted'));
    await expect(admit({ admitted_at: next, admitted_batch: -1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'live_entries_admitted_batch_check'));
    await admit({ admitted_at: next, admitted_batch: 1 });
    expect(await db.selectFrom('live_entries').select(['admitted_at', 'admitted_batch']).where('id', '=', entry.id).executeTakeFirstOrThrow()).toEqual({ admitted_at: next, admitted_batch: 1 });
  });

  it('holds a draw\'s segment and a LANDING link by their CHECKs (0050: drops_draw_plus, links_destination_check), and a pre-registration by its own, with the same JS types as PGlite', async () => {
    // Its own letter: this database's categories already hold A to F (the parallel creates above), S, W and P; G is WORN's (0053) below.
    await db.insertInto('categories').values({ id: 23, code: 'H', name: 'Founding parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 23, name: 'FOUNDING', type: 'RING', sku_prefix: 'FOUND-PG' }).returning('id').executeTakeFirstOrThrow();
    const segment = await db.insertInto('segments').values({ name: 'Founding list PG', criteria: JSON.stringify({ rule: 'FOUNDING_LIST' }) }).returning('id').executeTakeFirstOrThrow();
    // A draw opened to a segment's members; its other LIVE-only settings still refused; an after-room still without one.
    const draw = await db
      .insertInto('drops')
      .values({
        model_id: model.id, title: 'FOUNDING PG', quantity: 1, opens_at: new Date('2026-12-01T10:00:00Z'), closes_at: new Date('2026-12-02T10:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
        seed_hash: new Uint8Array(32), access_segment_id: segment.id,
      })
      .returning(['id', 'mode', 'access_segment_id'])
      .executeTakeFirstOrThrow();
    expect(draw).toEqual({ id: expect.any(String), mode: 'DRAW', access_segment_id: segment.id });
    await expect(db.updateTable('drops').set({ access_combine: 'AND' }).where('id', '=', draw.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_draw_plus'));
    await expect(db.updateTable('drops').set({ min_participations: 1 }).where('id', '=', draw.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_draw_plus'));
    const live = {
      model_id: model.id, title: 'FOUNDING LIVE PG', quantity: 1, opens_at: new Date('2026-12-01T10:00:00Z'), closes_at: new Date('2026-12-01T11:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
      seed_hash: new Uint8Array(32), early_access_hours: 0, mode: 'LIVE' as const, live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1,
      price_minor: 1000, currency: 'EUR' as const, quantity_line: '1 PIECE',
    };
    const parent = await db.insertInto('drops').values({ ...live, access_segment_id: segment.id }).returning('id').executeTakeFirstOrThrow();
    await expect(
      db.insertInto('drops').values({ ...live, parent_drop_id: parent.id, after_room_delay_minutes: 10, after_room_length_minutes: 15, surprise_enabled: false, question_enabled: false, access_segment_id: segment.id }).execute(),
    ).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_after_room'));

    // A LANDING link names neither a release nor a model; an unknown destination is refused.
    const admin = await db.insertInto('admin_users').values({ email: 'links-pg0050@orbes.test', email_normalized: 'links-pg0050@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
    const channel = await db.insertInto('link_channels').values({ name: 'Founding PG' }).returning('id').executeTakeFirstOrThrow();
    const link = { code: 'founding-pg', name: 'theorbes.com', channel_id: channel.id, destination: 'LANDING' as const, created_by: admin.id };
    await expect(db.insertInto('links').values({ ...link, model_id: model.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'links_destination'));
    await expect(sql`INSERT INTO links (code, name, channel_id, destination, created_by) VALUES ('founding-pg', 'x', ${channel.id}, 'THEORBES', ${admin.id})`.execute(db)).rejects.toSatisfy((e) => isCheckViolation(e, 'links_destination_check'));
    expect(await db.insertInto('links').values(link).returning(['destination', 'drop_id', 'model_id']).executeTakeFirstOrThrow()).toEqual({ destination: 'LANDING', drop_id: null, model_id: null });

    // A pre-registration: its address once, its CHECKs, its identity guarded; the same types as PGlite.
    const source = await db.insertInto('acquisition_sources').values({ kind: 'SITE', site: 'founding-pg.test', key: 'S:founding-pg.test' }).returning('id').executeTakeFirstOrThrow();
    const consentAt = new Date('2026-10-21T08:00:00Z');
    const prereg = { email: 'Lea-PG@example.com', email_normalized: 'lea-pg@example.com', first_name: 'Léa', country: 'FR', consent_at: consentAt, consent_version: '2026-10-21', source_id: source.id };
    for (const [bad, constraint] of [
      [{ first_name: ' Léa' }, 'preregistrations_first_name_check'],
      [{ first_name: 'é'.repeat(81) }, 'preregistrations_first_name_check'],
      [{ country: 'fr' }, 'preregistrations_country_check'],
      [{ consent_version: '21/10/2026' }, 'preregistrations_consent_version_check'],
      [{ matched_at: consentAt }, 'preregistrations_matched'],
    ] as const) {
      await expect(db.insertInto('preregistrations').values({ ...prereg, ...bad }).execute(), constraint).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    const row = await db.insertInto('preregistrations').values(prereg).returningAll().executeTakeFirstOrThrow();
    expect(row).toEqual({ ...prereg, id: expect.any(String), account_id: null, matched_at: null, unsubscribed_at: null, created_at: expect.any(Date) });
    await expect(db.insertInto('preregistrations').values({ ...prereg, email: 'LEA-PG@EXAMPLE.COM' }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'preregistrations_email_normalized_key'));
    await expect(db.updateTable('preregistrations').set({ email_normalized: 'other-pg@example.com' }).where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
  });

  it('holds a recovery code sent by email by its CHECKs (0051: issued_via, account_recovery_codes_issued_by), with the previous image\'s staff insert STAFF by DEFAULT, and the outbox, the templates and the preferences by theirs, with the same JS types as PGlite', async () => {
    const admin = await db.insertInto('admin_users').values({ email: 'emails-pg0051@orbes.test', email_normalized: 'emails-pg0051@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    const account = await db.insertInto('accounts').values({ email: 'lea-pg0051@example.com', email_normalized: 'lea-pg0051@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    // Issued as the previous image issues it: its ADMIN, no issued_via.
    const staff = await sql<{ issued_via: string; created_by: string | null }>`
      INSERT INTO account_recovery_codes (account_id, code_hash, created_by, expires_at, used_at) VALUES (${account.id}, 'scrypt$x', ${admin.id}, ${expiresAt}, now()) RETURNING issued_via, created_by`.execute(db);
    expect(staff.rows[0]).toEqual({ issued_via: 'STAFF', created_by: admin.id });
    const code = (v: Record<string, unknown>) => db.insertInto('account_recovery_codes').values({ account_id: account.id, code_hash: 'scrypt$x', expires_at: expiresAt, ...v }).execute();
    await expect(code({})).rejects.toSatisfy((e) => isCheckViolation(e, 'account_recovery_codes_issued_by'));
    await expect(code({ issued_via: 'EMAIL', created_by: admin.id })).rejects.toSatisfy((e) => isCheckViolation(e, 'account_recovery_codes_issued_by'));
    await expect(sql`INSERT INTO account_recovery_codes (account_id, code_hash, expires_at, issued_via) VALUES (${account.id}, 'scrypt$x', ${expiresAt}, 'SMS')`.execute(db)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'account_recovery_codes_issued_via_check'),
    );
    const emailed = await db.insertInto('account_recovery_codes').values({ account_id: account.id, code_hash: 'scrypt$x', expires_at: expiresAt, issued_via: 'EMAIL' }).returning(['issued_via', 'created_by']).executeTakeFirstOrThrow();
    expect(emailed).toEqual({ issued_via: 'EMAIL', created_by: null });

    // A template off with the default words; an email queued, its words guarded, then sent; release notices off.
    expect(await db.insertInto('email_templates').values({ kind: 'PASSWORD_RESET', updated_by: admin.id }).returning(['enabled', 'subject', 'body']).executeTakeFirstOrThrow()).toEqual({ enabled: false, subject: null, body: null });
    await expect(db.insertInto('email_templates').values({ kind: 'ORDER_SHIPPED', updated_by: admin.id, subject: 'On its way\r\nBcc: x@example.com' }).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'email_templates_subject_check'),
    );
    const email = {
      kind: 'PASSWORD_RESET' as const, dedupe_key: 'E3:pg0051', account_id: account.id, to_address: 'lea-pg0051@example.com', subject: 'Your password', body_text: 'Your link.', body_html: '<p>Your link.</p>',
    };
    await expect(db.insertInto('email_outbox').values({ ...email, settled_at: new Date() }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'email_outbox_settled'));
    const row = await db.insertInto('email_outbox').values(email).returning(['id', 'status', 'attempts', 'not_before', 'sent_at']).executeTakeFirstOrThrow();
    expect(row).toEqual({ id: expect.any(String), status: 'QUEUED', attempts: 0, not_before: expect.any(Date), sent_at: null });
    await expect(db.insertInto('email_outbox').values(email).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'email_outbox_dedupe_key'));
    await expect(db.updateTable('email_outbox').set({ to_address: 'other-pg0051@example.com' }).where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    const at = new Date('2026-10-21T09:00:00Z');
    expect(await db.updateTable('email_outbox').set({ status: 'SENT', attempts: 1, sent_at: at, settled_at: at }).where('id', '=', row.id).returning(['status', 'attempts', 'sent_at']).executeTakeFirstOrThrow()).toEqual({
      status: 'SENT', attempts: 1, sent_at: at,
    });
    expect(await db.insertInto('email_preferences').values({ account_id: account.id }).returning(['release_notices']).executeTakeFirstOrThrow()).toEqual({ release_notices: false });
  });
  it('holds house messages and their deliveries by their CHECKs and guards (0052)', async () => {
    const admin = await db.insertInto('admin_users').values({ email: 'house-pg0052@orbes.test', email_normalized: 'house-pg0052@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    const account = await db.insertInto('accounts').values({ email: 'lea-pg0052@example.com', email_normalized: 'lea-pg0052@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    // A moment's setting: off by default, on exactly with its time, its title one line.
    expect(await db.insertInto('house_moment_settings').values({ moment: 'NINETY_DAYS', updated_by: admin.id }).returning(['enabled', 'enabled_at', 'title', 'body']).executeTakeFirstOrThrow()).toEqual({
      enabled: false, enabled_at: null, title: null, body: null,
    });
    await expect(db.insertInto('house_moment_settings').values({ moment: 'OWNERSHIP_YEAR', enabled: true, updated_by: admin.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_moment_settings_enabled'));
    await expect(db.insertInto('house_moment_settings').values({ moment: 'OWNERSHIP_YEAR', title: 'ONE\nYEAR', updated_by: admin.id }).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'house_moment_settings_title_check'),
    );
    // A custom message: a segment or a tier while a draft, then sent and frozen; only a draft is deleted.
    const base = { title: 'A word from ORBES', body: 'Thank you.', created_by: admin.id, updated_by: admin.id };
    await expect(db.insertInto('house_messages').values(base).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_messages_audience'));
    const message = await db.insertInto('house_messages').values({ ...base, audience_min_tier: 3 }).returning(['id', 'status']).executeTakeFirstOrThrow();
    expect(message.status).toBe('DRAFT');
    const at = new Date('2026-10-21T16:00:00Z');
    await expect(db.updateTable('house_messages').set({ status: 'SENT', send_at: at, sent_at: at, reach: 0, sent_by: admin.id }).where('id', '=', message.id).execute()).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'house_messages_label'),
    );
    expect(
      await db.updateTable('house_messages').set({ status: 'SENT', send_at: at, sent_at: at, reach: 1, sent_by: admin.id, audience_label: 'PALLADIUM' }).where('id', '=', message.id).returning(['reach', 'sent_at']).executeTakeFirstOrThrow(),
    ).toEqual({ reach: 1, sent_at: at });
    await expect(db.updateTable('house_messages').set({ title: 'Other' }).where('id', '=', message.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db.deleteFrom('house_messages').where('id', '=', message.id).execute()).rejects.toSatisfy(isGuardViolation);
    // A delivery once per key; a moment with its words and piece; never changed but its reading; never deleted nor truncated.
    const delivery = { account_id: account.id, source: 'MOMENT' as const, moment: 'OWNERSHIP_YEAR' as const, title: 'ONE YEAR', body: 'A year today.', piece_ref: 'O26-J-00184', dedupe_key: 'OWNERSHIP_YEAR:pg0052' };
    await expect(db.insertInto('house_deliveries').values({ ...delivery, piece_ref: null }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'house_deliveries_piece'));
    const row = await db.insertInto('house_deliveries').values(delivery).returning(['id', 'read_at', 'delivered_at']).executeTakeFirstOrThrow();
    expect(row).toEqual({ id: expect.any(String), read_at: null, delivered_at: expect.any(Date) });
    await expect(db.insertInto('house_deliveries').values(delivery).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'house_deliveries_dedupe_key'));
    await db.insertInto('house_deliveries').values({ account_id: account.id, source: 'CUSTOM', house_message_id: message.id, dedupe_key: `CUSTOM:${message.id}:${account.id}` }).execute();
    await db.updateTable('house_deliveries').set({ read_at: sql<Date>`now()` }).where('id', '=', row.id).execute();
    await expect(db.updateTable('house_deliveries').set({ body: 'Other.' }).where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db.deleteFrom('house_deliveries').where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`TRUNCATE house_deliveries`.execute(db)).rejects.toSatisfy(isGuardViolation);
  });
  it('holds WORN photographs by their CHECKs, one live per piece (0053)', async () => {
    await db.insertInto('categories').values({ id: 24, code: 'G', name: 'WORN parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 24, name: 'WORN', type: 'RING', sku_prefix: 'WORN-PG' }).returning('id').executeTakeFirstOrThrow();
    const product = await db
      .insertInto('products')
      .values({ product_id: 'O26-G-00001', packed_identity: (26 << 25) | (24 << 20) | 1, year: 2026, category_id: 24, serial: 1, sku: 'WORN-PG-1', model_id: model.id, material: 'SILVER' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const admin = await db.insertInto('admin_users').values({ email: 'worn-pg0053@orbes.test', email_normalized: 'worn-pg0053@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
    const account = await db.insertInto('accounts').values({ email: 'lea-pg0053@example.com', email_normalized: 'lea-pg0053@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const ownership = await db.insertInto('ownership').values({ product_id: product.id, account_id: account.id, acquired_via: 'FIRST_REGISTRATION' }).returning('id').executeTakeFirstOrThrow();
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const sha = createHash('sha256').update(photo).digest('hex');
    const sending = {
      product_id: product.id, ownership_id: ownership.id, account_id: account.id, model_id: model.id, photo, photo_mime: 'image/jpeg' as const, photo_sha256: sha, width: 1600, height: 2000,
      credit_first_name: 'Léa', credit_country: 'FR', consent_at: new Date('2026-10-22T09:00:00Z'), consent_version: '2026-10-22',
    };
    // Its hash its bytes'; its photograph whole while in review.
    await expect(db.insertInto('worn_photos').values({ ...sending, photo_sha256: '0'.repeat(64) }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'worn_photos_sha256_consistent'));
    await expect(db.insertInto('worn_photos').values({ ...sending, width: null }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'worn_photos_photo'));
    const row = await db.insertInto('worn_photos').values(sending).returning(['id', 'status', 'photo']).executeTakeFirstOrThrow();
    expect(row).toEqual({ id: expect.any(String), status: 'PENDING', photo });
    expect(row.photo?.constructor).toBe(Uint8Array);
    await expect(db.insertInto('worn_photos').values(sending).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'worn_photos_live_once'));
    // Published, then never back in review; withdrawn with its photograph erased; then settled.
    const at = new Date('2026-10-22T10:00:00Z');
    await db.updateTable('worn_photos').set({ status: 'PUBLISHED', reviewed_by: admin.id, reviewed_at: at, published_at: at }).where('id', '=', row.id).execute();
    await expect(db.updateTable('worn_photos').set({ status: 'PENDING', reviewed_by: null, reviewed_at: null, published_at: null }).where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db.updateTable('worn_photos').set({ credit_first_name: 'Camille' }).where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db.updateTable('worn_photos').set({ status: 'WITHDRAWN', ended_at: at }).where('id', '=', row.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'worn_photos_photo'));
    await db.updateTable('worn_photos').set({ status: 'WITHDRAWN', ended_at: at, photo: null, photo_mime: null, photo_sha256: null, width: null, height: null }).where('id', '=', row.id).execute();
    await expect(db.updateTable('worn_photos').set({ ended_at: new Date() }).where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db.deleteFrom('worn_photos').where('id', '=', row.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`TRUNCATE worn_photos`.execute(db)).rejects.toSatisfy(isGuardViolation);
    // The piece sends again once the first is withdrawn.
    expect(await db.insertInto('worn_photos').values(sending).returning('status').executeTakeFirstOrThrow()).toEqual({ status: 'PENDING' });
  });
});
