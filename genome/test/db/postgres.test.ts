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
import { migrateDown, migrateToLatest } from '../../src/server/db/migrate.js';
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
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';

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
    // Inserted as the previous image does, naming none of the pace's columns (ended: at 0058 an open LIVE release has a
    // pace, drops_live_paced; 0049's rules hold whatever the release).
    const release = await db
      .insertInto('drops')
      .values({
        model_id: model.id, title: 'PACE PG', quantity: 2, opens_at: new Date('2026-12-01T10:00:00Z'), closes_at: new Date('2026-12-01T11:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
        seed_hash: new Uint8Array(32), early_access_hours: 0, mode: 'LIVE', live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1,
        price_minor: 1000, currency: 'EUR', quantity_line: '2 PIECES', published_at: new Date('2026-11-30T10:00:00Z'), ended_at: new Date('2026-12-01T11:00:00Z'), ended_reason: 'CLOSED',
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
    // (Its pace: every open LIVE release has one at 0058, drops_live_paced.)
    const parent = await db.insertInto('drops').values({ ...live, access_segment_id: segment.id, pace_batch: 250, pace_minutes: 1 }).returning('id').executeTakeFirstOrThrow();
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
  it('holds boxes and packed weights by their CHECKs (0054)', async () => {
    // Its own letter: this database's categories already hold A to F, S, W, P, H and G (the tests above).
    await db.insertInto('categories').values({ id: 25, code: 'K', name: 'Boxes parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 25, name: 'BOXED', type: 'RING', sku_prefix: 'BOX-PG' }).returning('id').executeTakeFirstOrThrow();
    const admin = await db.insertInto('admin_users').values({ email: 'box-pg0054@orbes.test', email_normalized: 'box-pg0054@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    const account = await db.insertInto('accounts').values({ email: 'box-pg0054@example.com', email_normalized: 'box-pg0054@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const location = await db.insertInto('stock_locations').values({ name: 'BOXES PG 0054' }).returning('id').executeTakeFirstOrThrow();
    const sides = { inside_length_mm: 95, inside_width_mm: 62, inside_height_mm: 30, empty_weight_g: 60 };
    // The 95 × 62 mm card flat, in either orientation; a cost with its currency; a name once whatever the case.
    await expect(db.insertInto('boxes').values({ name: 'NARROW', ...sides, inside_width_mm: 61 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'boxes_card_fits'));
    await expect(db.insertInto('boxes').values({ name: 'SHORT', ...sides, inside_length_mm: 62, inside_width_mm: 94 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'boxes_card_fits'));
    await expect(db.insertInto('boxes').values({ name: 'PRICED', ...sides, cost_minor: 120 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'boxes_cost'));
    const box = await db.insertInto('boxes').values({ name: 'CARD', ...sides, inside_length_mm: 62, inside_width_mm: 95, cost_minor: 100000000, currency: 'EUR', created_by: admin.id }).returningAll().executeTakeFirstOrThrow();
    expect(box).toMatchObject({ cost_minor: 100000000, active: true, created_by: admin.id });
    expect(typeof box.cost_minor).toBe('number');
    await expect(db.insertInto('boxes').values({ name: 'card', ...sides }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'boxes_name_key'));
    await expect(sql`UPDATE boxes SET created_by = NULL WHERE id = ${box.id}`.execute(db)).rejects.toSatisfy(isGuardViolation);
    // A model's box and packed weight; a box named is never deleted.
    await expect(db.updateTable('models').set({ packed_weight_g: 30001 }).where('id', '=', model.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'models_packed_weight_g_check'));
    await db.updateTable('models').set({ box_id: box.id, packed_weight_g: 140 }).where('id', '=', model.id).execute();
    await expect(db.deleteFrom('boxes').where('id', '=', box.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    // A parcel's weight or what was missing only once packed, never both; the list comes back as an array.
    const request = await db.insertInto('shop_requests').values({ account_id: account.id, model_id: model.id, status: 'CLOSED', created_at: new Date(Date.now() - 60_000), handled_at: new Date(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    const order = await db
      .insertInto('orders')
      .values({ channel: 'SALON', shop_request_id: request.id, account_id: account.id, model_id: model.id, location_id: location.id, price_minor: 1000, currency: 'EUR' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const now = new Date();
    await db.updateTable('orders').set({ status: 'PAID', paid_at: now, packing_started_at: now }).where('id', '=', order.id).execute();
    const parcel = await db.insertInto('shipments').values({ order_id: order.id, location_id: location.id, packing_started_by: admin.id, box_id: box.id }).returning('id').executeTakeFirstOrThrow();
    await expect(db.updateTable('shipments').set({ weight_g: 200 }).where('id', '=', parcel.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'shipments_weight'));
    const packed = { status: 'PACKED' as const, packed_at: new Date(Date.now() + 1000), packed_by: admin.id };
    await expect(db.updateTable('shipments').set({ ...packed, weight_g: 200, weight_missing: ['BOXED'] }).where('id', '=', parcel.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'shipments_weight'));
    await expect(db.updateTable('shipments').set({ ...packed, weight_missing: [] }).where('id', '=', parcel.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'shipments_weight_missing_check'));
    expect(
      await db.updateTable('shipments').set({ ...packed, weight_missing: ['BOXED', 'box'] }).where('id', '=', parcel.id).returning(['box_id', 'weight_g', 'weight_missing']).executeTakeFirstOrThrow(),
    ).toEqual({ box_id: box.id, weight_g: null, weight_missing: ['BOXED', 'box'] });
    expect(
      await db.updateTable('shipments').set({ weight_g: 200, weight_missing: null }).where('id', '=', parcel.id).returning(['weight_g', 'weight_missing']).executeTakeFirstOrThrow(),
    ).toEqual({ weight_g: 200, weight_missing: null });
  });
  it('holds a country served by one location (0055)', async () => {
    // No category: the countries name locations only.
    const admin = await db.insertInto('admin_users').values({ email: 'countries-pg0055@orbes.test', email_normalized: 'countries-pg0055@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow();
    const [france, usa] = await db.insertInto('stock_locations').values([{ name: 'COUNTRIES PG 0055 FR' }, { name: 'COUNTRIES PG 0055 US' }]).returning('id').execute();
    // char(2) comes back as two letters, unpadded; one location per country; two capital letters.
    expect(await db.insertInto('stock_location_countries').values({ country: 'FR', location_id: france.id, updated_by: admin.id }).returningAll().executeTakeFirstOrThrow()).toEqual({
      country: 'FR', location_id: france.id, updated_by: admin.id, updated_at: expect.any(Date),
    });
    await expect(db.insertInto('stock_location_countries').values({ country: 'FR', location_id: usa.id }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'stock_location_countries_pkey'));
    await expect(db.insertInto('stock_location_countries').values({ country: 'us', location_id: usa.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'stock_location_countries_country_check'));
    await expect(db.insertInto('stock_location_countries').values({ country: 'U', location_id: usa.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'stock_location_countries_country_check'));
    // Moved by its location, its update stamped; its country never changed; a location serving it never deleted.
    await db.updateTable('stock_location_countries').set({ updated_at: new Date('2026-10-01T10:00:00Z') }).where('country', '=', 'FR').execute();
    const moved = await db.updateTable('stock_location_countries').set({ location_id: usa.id }).where('country', '=', 'FR').returning(['location_id', 'updated_at']).executeTakeFirstOrThrow();
    expect(moved.location_id).toBe(usa.id);
    expect(moved.updated_at.getTime()).toBeGreaterThan(new Date('2026-10-01T10:00:00Z').getTime());
    await expect(sql`UPDATE stock_location_countries SET country = 'DE' WHERE country = 'FR'`.execute(db)).rejects.toSatisfy(isGuardViolation);
    await expect(db.deleteFrom('stock_locations').where('id', '=', usa.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });
  it('holds add-ons, their SKUs, units and choices by their CHECKs, and stock_holds (0056)', async () => {
    // Its own letter: this database's categories already hold A to F, S, W, P, H, G and K (the tests above); the demo seed's are J, L, W, F and A.
    await db.insertInto('categories').values({ id: 26, code: 'N', name: 'Add-ons parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 26, name: 'ADDED', type: 'RING', sku_prefix: 'ADD-PG' }).returning('id').executeTakeFirstOrThrow();
    const account = await db.insertInto('accounts').values({ email: 'addon-pg0056@example.com', email_normalized: 'addon-pg0056@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const location = await db.insertInto('stock_locations').values({ name: 'ADD-ONS PG 0056' }).returning('id').executeTakeFirstOrThrow();
    // An add-on, its prices, and its SKU beside a model's: one owner each, no size on an add-on's, two add-ons' SKUs side by side.
    const [cloth, pouch] = await db.insertInto('addon_items').values([{ name: 'POLISHING CLOTH', position: 1 }, { name: 'TRAVEL POUCH', position: 2 }]).returning(['id', 'position']).execute();
    expect(typeof cloth.position).toBe('number');
    await expect(db.insertInto('addon_items').values({ name: 'polishing cloth' }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_items_name_key'));
    expect(await db.insertInto('addon_item_prices').values({ addon_id: cloth.id, currency: 'EUR', price_minor: 1500 }).returning(['price_minor']).executeTakeFirstOrThrow()).toEqual({ price_minor: 1500 });
    const clothSku = await db.insertInto('skus').values({ addon_id: cloth.id, code: 'CLOTH-PG0056' }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('skus').values({ addon_id: pouch.id, code: 'POUCH-PG0056' }).execute();
    const sized = await db.insertInto('skus').values({ model_id: model.id, size_label: '52', code: 'ADD-PG-52' }).returning('id').executeTakeFirstOrThrow();
    await expect(db.insertInto('skus').values({ model_id: model.id, addon_id: cloth.id, code: 'BOTH-PG0056' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'skus_owner'));
    await expect(db.insertInto('skus').values({ code: 'NONE-PG0056' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'skus_owner'));
    await expect(db.insertInto('skus').values({ addon_id: cloth.id, size_label: 'M', code: 'SIZED-PG0056' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'skus_addon_plain'));
    await expect(db.insertInto('skus').values({ addon_id: cloth.id, code: 'CLOTH-PG0056-B' }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_addon_id_key'));
    await expect(sql`UPDATE skus SET addon_id = ${pouch.id} WHERE id = ${clothSku.id}`.execute(db)).rejects.toSatisfy(isGuardViolation);
    // An order holding its piece, and a unit of the add-on held with it; its state with its own time.
    const request = await db.insertInto('shop_requests').values({ account_id: account.id, model_id: model.id, status: 'CLOSED', created_at: new Date(Date.now() - 60_000), handled_at: new Date(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    const order = await db
      .insertInto('orders')
      .values({ channel: 'SALON', shop_request_id: request.id, account_id: account.id, model_id: model.id, location_id: location.id, sku_id: sized.id, reservation: 'STOCK', price_minor: 1000, currency: 'EUR' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(db.updateTable('orders').set({ sku_id: clothSku.id }).where('id', '=', order.id).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    const unit = { order_id: order.id, addon_id: cloth.id, sku_id: clothSku.id, location_id: location.id, price_minor: 1500, currency: 'EUR' as const, added_by_type: 'PURCHASE' as const };
    await expect(db.insertInto('order_addon_items').values({ ...unit, status: 'SHIPPED' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_status_times'));
    await expect(db.insertInto('order_addon_items').values({ ...unit, added_by: account.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_added_by'));
    await expect(db.insertInto('order_addon_items').values({ ...unit, returned_to_stock: true }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_returned'));
    const held = await db.insertInto('order_addon_items').values(unit).returning(['id', 'price_minor', 'status']).executeTakeFirstOrThrow();
    expect(held).toEqual({ id: expect.any(String), price_minor: 1500, status: 'HELD' });
    await expect(sql`UPDATE order_addon_items SET price_minor = 1400 WHERE id = ${held.id}`.execute(db)).rejects.toSatisfy(isGuardViolation);
    // stock_holds: the order's piece and the unit held, as STOCK.
    const holds = await db.selectFrom('stock_holds').select(['kind', 'id', 'sku_id', 'reservation']).where('location_id', '=', location.id).orderBy('kind', 'desc').execute();
    expect(holds).toEqual([
      { kind: 'PIECE', id: order.id, sku_id: sized.id, reservation: 'STOCK' },
      { kind: 'ADD_ON', id: held.id, sku_id: clothSku.id, reservation: 'STOCK' },
    ]);
    // Shipped with its movement: of its order and SKU, never with a piece.
    await db.updateTable('order_addon_items').set({ status: 'SHIPPED', shipped_at: new Date(Date.now() + 1000) }).where('id', '=', held.id).execute();
    const move = { sku_id: clothSku.id, location_id: location.id, delta: -1, reason: 'SHIPPED' as const, order_id: order.id, order_addon_item_id: held.id, actor_type: 'system' as const };
    await expect(db.insertInto('stock_movements').values({ ...move, sku_id: sized.id }).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    expect(await db.insertInto('stock_movements').values(move).returning(['order_addon_item_id']).executeTakeFirstOrThrow()).toEqual({ order_addon_item_id: held.id });
    expect((await db.selectFrom('stock_holds').select('kind').where('location_id', '=', location.id).execute()).map((h) => h.kind)).toEqual(['PIECE']);
    // A choice on exactly one owner, 1 to 3 units, once per add-on; smallint comes back as a number.
    await expect(db.insertInto('addon_choices').values({ addon_id: cloth.id, units: 1 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'addon_choices_owner'));
    await expect(db.insertInto('addon_choices').values({ shop_request_id: request.id, addon_id: cloth.id, units: 4 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'addon_choices_units_check'));
    expect(await db.insertInto('addon_choices').values({ shop_request_id: request.id, addon_id: cloth.id, units: 3 }).returning(['units']).executeTakeFirstOrThrow()).toEqual({ units: 3 });
    await expect(db.insertInto('addon_choices').values({ shop_request_id: request.id, addon_id: cloth.id, units: 1 }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_choices_shop_request_key'));
  });

  it('holds sets, set releases, entry sizes, set sales and grouped cases by their CHECKs (0057)', async () => {
    // Its own letter: this database's categories already hold A to F, S, W, P, H, G, K and N (the tests above); the demo seed's are J, L, W, F and A.
    await db.insertInto('categories').values({ id: 27, code: 'Q', name: 'Sets parity' }).execute();
    const [ring, chain] = await db
      .insertInto('models')
      .values([{ category_id: 27, name: 'SET RING', type: 'RING', sku_prefix: 'SET-PG-R' }, { category_id: 27, name: 'SET CHAIN', type: 'NECKLACE', sku_prefix: 'SET-PG-C' }])
      .returning('id')
      .execute();
    const account = await db.insertInto('accounts').values({ email: 'set-pg0057@example.com', email_normalized: 'set-pg0057@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow();
    const location = await db.insertInto('stock_locations').values({ name: 'SETS PG 0057' }).returning('id').executeTakeFirstOrThrow();
    // A set: its name once whatever the case, its code, its price with its currency; its pieces, each model once.
    const set = await db.insertInto('sets').values({ name: 'THE PAIR', code: 'THE-PAIR-PG', base_price_minor: 90000, base_currency: 'EUR' }).returning(['id', 'active']).executeTakeFirstOrThrow();
    expect(set.active).toBe(true);
    await expect(db.insertInto('sets').values({ name: 'the pair', code: 'OTHER-PG' }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'sets_name_key'));
    await expect(db.insertInto('sets').values({ name: 'LOWER', code: 'lower' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'sets_code_check'));
    await expect(db.insertInto('sets').values({ name: 'HALF', code: 'HALF-PG', base_price_minor: 1 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'sets_base_price'));
    const pieces = await db.insertInto('set_models').values([{ set_id: set.id, position: 1, model_id: ring.id }, { set_id: set.id, position: 2, model_id: chain.id }]).returning('position').execute();
    expect(pieces.map((p) => p.position)).toEqual([1, 2]);
    await expect(db.insertInto('set_models').values({ set_id: set.id, position: 3, model_id: ring.id }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'set_models_model_key'));
    // A release of the set, never of a model too; its sizes per piece, a label once per piece, positions to 96.
    const release = { title: 'THE PAIR', quantity: 2, opens_at: new Date('2026-12-01T10:00:00Z'), closes_at: new Date('2026-12-02T10:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`, seed_hash: new Uint8Array(32) };
    await expect(db.insertInto('drops').values({ ...release, model_id: ring.id, set_id: set.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_one_offer'));
    await expect(db.insertInto('drops').values(release).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_one_offer'));
    const draw = await db.insertInto('drops').values({ ...release, set_id: set.id }).returning(['id', 'model_id']).executeTakeFirstOrThrow();
    expect(draw.model_id).toBeNull();
    const [ring52, chain45] = await db
      .insertInto('drop_sizes')
      .values([{ drop_id: draw.id, piece: 1, label: '52', position: 1, stock: 2 }, { drop_id: draw.id, piece: 2, label: '45', position: 96, stock: 2 }])
      .returning(['id', 'piece'])
      .execute();
    expect(ring52.piece).toBe(1);
    await db.insertInto('drop_sizes').values({ drop_id: draw.id, piece: 2, label: '52', position: 25, stock: 0 }).execute();
    await expect(db.insertInto('drop_sizes').values({ drop_id: draw.id, piece: 1, label: '52', position: 2, stock: 0 }).execute()).rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_sizes_label_key'));
    await expect(db.insertInto('drop_sizes').values({ drop_id: draw.id, piece: 1, label: '56', position: 97, stock: 0 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_sizes_position_check'));
    // An entry's size per piece, of its release and that piece.
    const entry = await db.insertInto('drop_entries').values({ drop_id: draw.id, account_id: account.id }).returning('id').executeTakeFirstOrThrow();
    await expect(db.insertInto('drop_entry_sizes').values({ entry_id: entry.id, drop_id: draw.id, piece: 2, size_id: ring52.id }).execute()).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'drop_entry_sizes_size_fkey'));
    const chosen = await db
      .insertInto('drop_entry_sizes')
      .values([{ entry_id: entry.id, drop_id: draw.id, piece: 1, size_id: ring52.id }, { entry_id: entry.id, drop_id: draw.id, piece: 2, size_id: chain45.id }])
      .returning('piece')
      .execute();
    expect(chosen.map((c) => c.piece)).toEqual([1, 2]);
    await expect(sql`UPDATE drop_entry_sizes SET piece = 3 WHERE entry_id = ${entry.id} AND piece = 2`.execute(db)).rejects.toSatisfy(isGuardViolation);
    // A set sale of a release of its set, its price with its currency; its orders of the buyer's account, both columns or neither.
    await expect(db.insertInto('set_sales').values({ set_id: set.id, drop_id: draw.id, account_id: account.id, price_minor: 90000 }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'set_sales_price'));
    const sale = await db.insertInto('set_sales').values({ set_id: set.id, drop_id: draw.id, account_id: account.id, price_minor: 90000, currency: 'EUR' }).returning(['id', 'price_minor']).executeTakeFirstOrThrow();
    expect(sale.price_minor).toBe(90000);
    const store = await db.insertInto('set_sales').values({ set_id: set.id, account_id: account.id }).returning('drop_id').executeTakeFirstOrThrow();
    expect(store.drop_id).toBeNull();
    await db.updateTable('drop_entries').set({ status: 'CONFIRMED', tier: 0, seniority: 0, rank: 1, respond_by: new Date(), handled_at: new Date() }).where('id', '=', entry.id).execute();
    const order = { channel: 'DRAW' as const, drop_entry_id: entry.id, drop_id: draw.id, account_id: account.id, location_id: location.id, price_minor: 45000, currency: 'EUR' };
    await expect(db.insertInto('orders').values({ ...order, piece: 1, model_id: ring.id, set_sale_id: sale.id }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_set_sale'));
    const [first, second] = await db
      .insertInto('orders')
      .values([{ ...order, piece: 1, model_id: ring.id, set_sale_id: sale.id, set_piece: 1 }, { ...order, piece: 2, model_id: chain.id, set_sale_id: sale.id, set_piece: 2 }])
      .returning(['id', 'set_piece'])
      .execute();
    expect([first.set_piece, second.set_piece]).toEqual([1, 2]);
    await expect(sql`UPDATE orders SET set_piece = 2 WHERE id = ${first.id}`.execute(db)).rejects.toSatisfy(isGuardViolation);
    // Its return: a group of RETURN cases.
    const group = '00000000-0000-4000-8000-000000000057';
    const kases = await db
      .insertInto('order_cases')
      .values([first, second].map((o) => ({ order_id: o.id, kind: 'RETURN' as const, reason: 'SIZE' as const, opened_by_type: 'account' as const, opened_by_id: account.id, group_id: group })))
      .returning('group_id')
      .execute();
    expect(kases.map((k) => k.group_id)).toEqual([group, group]);
    await expect(sql`UPDATE order_cases SET group_id = NULL WHERE order_id = ${first.id}`.execute(db)).rejects.toSatisfy(isGuardViolation);
  });

  it('holds ONE QUEUE\'s hold after the opening and every open LIVE release\'s pace by their CHECKs (0058: drops_pace_hold_minutes_check, drops_pace_hold, drops_live_paced), with the previous image\'s insert at 0 and the same JS types as PGlite; down refused while a hold exists and up refused while an open LIVE release has no pace, each naming its count', async () => {
    // Its own letter: this database's categories already hold A to F, S, W, P, H, G, K, N and Q (the tests above).
    await db.insertInto('categories').values({ id: 28, code: 'O', name: 'One queue parity' }).execute();
    const model = await db.insertInto('models').values({ category_id: 23, name: 'QUEUE', type: 'RING', sku_prefix: 'QUEUE-PG' }).returning('id').executeTakeFirstOrThrow();
    const live = {
      model_id: model.id, title: 'ONE QUEUE PG', quantity: 2, opens_at: new Date('2026-12-01T10:00:00Z'), closes_at: new Date('2026-12-01T11:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
      seed_hash: new Uint8Array(32), early_access_hours: 0, mode: 'LIVE' as const, live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1,
      price_minor: 1000, currency: 'EUR', quantity_line: '2 PIECES', published_at: new Date('2026-11-30T10:00:00Z'),
    };
    // Inserted as the previous image does, naming the pace but not the hold: 0, a number.
    const release = await db.insertInto('drops').values({ ...live, pace_batch: 250, pace_minutes: 1 }).returning(['id', 'pace_hold_minutes']).executeTakeFirstOrThrow();
    expect(release).toEqual({ id: expect.any(String), pace_hold_minutes: 0 });
    const set = (v: Record<string, unknown>, id = release.id) => db.updateTable('drops').set(v).where('id', '=', id).execute();
    await expect(set({ pace_hold_minutes: 121 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace_hold_minutes_check'));
    await expect(set({ pace_hold_minutes: -1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace_hold_minutes_check'));
    await set({ pace_hold_minutes: 30 });
    expect(await db.selectFrom('drops').select('pace_hold_minutes').where('id', '=', release.id).executeTakeFirstOrThrow()).toEqual({ pace_hold_minutes: 30 });
    // Every open LIVE release that is not an after-room keeps a pace (drops_live_paced): written without one, or its pace
    // taken away, refused; an ended one may have none. A pace with a hold is never taken away (drops_pace_hold).
    await expect(db.insertInto('drops').values({ ...live, title: 'ONE QUEUE PG NO PACE' }).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_paced'));
    await set({ pace_hold_minutes: 0 });
    await expect(set({ pace_batch: null, pace_minutes: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_paced'));
    const ended = await db.insertInto('drops').values({ ...live, title: 'ONE QUEUE PG ENDED', pace_batch: 250, pace_minutes: 1, pace_hold_minutes: 30, ended_at: new Date('2026-12-01T11:00:00Z'), ended_reason: 'CLOSED' }).returning('id').executeTakeFirstOrThrow();
    await expect(set({ pace_batch: null, pace_minutes: null }, ended.id)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_pace_hold'));
    await set({ pace_hold_minutes: 0 }, ended.id);
    await set({ pace_batch: null, pace_minutes: null }, ended.id);
    await set({ pace_hold_minutes: 30 });
    // Down refused while a hold exists; without one it restores 0057.
    await expect(migrateDown(db)).rejects.toThrow(/0058_one_queue cannot be rolled back: 1 releases with a hold after the opening exist/);
    await set({ pace_hold_minutes: 0 });
    expect((await migrateDown(db)).reverted).toEqual(['0058_one_queue']);
    // Up refused while an open LIVE release has no pace, naming the count (the releases this suite left open count too).
    const unpaced = sql<{ n: number }>`SELECT count(*)::int AS n FROM drops WHERE mode = 'LIVE' AND parent_drop_id IS NULL AND pace_batch IS NULL AND ended_at IS NULL AND cancelled_at IS NULL`;
    const left = (await unpaced.execute(db)).rows[0].n;
    const open = await db.insertInto('drops').values({ ...live, title: 'ONE QUEUE PG UNPACED' }).returning('id').executeTakeFirstOrThrow();
    await expect(migrateToLatest(db)).rejects.toThrow(new RegExp(`0058_one_queue cannot be applied: ${left + 1} open LIVE releases have no pace`));
    // The owner's answer, cancelled (this suite's others with them), then up again.
    await set({ cancelled_at: new Date() }, open.id);
    await sql`UPDATE drops SET cancelled_at = now() WHERE mode = 'LIVE' AND parent_drop_id IS NULL AND pace_batch IS NULL AND ended_at IS NULL AND cancelled_at IS NULL`.execute(db);
    expect((await unpaced.execute(db)).rows[0].n).toBe(0);
    expect((await migrateToLatest(db)).applied).toEqual(['0058_one_queue']);
    expect(await db.selectFrom('drops').select('pace_hold_minutes').where('id', '=', release.id).executeTakeFirstOrThrow()).toEqual({ pace_hold_minutes: 0 });
  });
});
