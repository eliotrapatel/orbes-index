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
import { randomBytes } from 'node:crypto';
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
import { isGuardViolation } from '../../src/server/db/pg-errors.js';

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
    const piece = async (serial: number) => {
      const p = await db
        .insertInto('products')
        .values({ product_id: `O26-S-${String(serial).padStart(5, '0')}`, packed_identity: (26 << 25) | (20 << 20) | serial, year: 2026, category_id: 20, serial, sku: `SALE-${serial}`, model_id: model.id, material: 'SILVER' })
        .returning(['id', 'product_id'])
        .executeTakeFirstOrThrow();
      await db.insertInto('product_status_history').values({ product_id: p.id, from_status: null, to_status: 'ISSUED', actor_type: 'system' }).execute();
      return p;
    };
    const token = async (productId: string) => {
      const scan = await db.insertInto('scan_events').values({ event_type: 'ADMIN_TEST', admin_id: seller.id, product_id: productId, result_state: 'AUTHENTIC' }).returning('id').executeTakeFirstOrThrow();
      return (await createScanToken(db, { productId, scanEventId: scan.id, purpose: 'SALE_ACTIVATION', ttlMs: 600_000 })).token;
    };
    const actor = { type: 'admin' as const, id: seller.id };

    // Two sellers' scans of one piece: one warranty start; the losing token is rolled back, not used.
    const a = await piece(1);
    const tokens = [await token(a.id), await token(a.id)];
    const results = await Promise.allSettled(tokens.map((t) => sale.activate({ token: t, retailerId: shop.id }, actor)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['WARRANTY_ALREADY_ACTIVATED']);
    const used = await db.selectFrom('scan_tokens').select('used_at').where('product_id', '=', a.id).execute();
    expect(used.filter((r) => r.used_at !== null)).toHaveLength(1);

    // One token sent twice at once: used once.
    const b = await piece(2);
    const t = await token(b.id);
    const twice = await Promise.allSettled([t, t].map((x) => sale.activate({ token: x, retailerId: shop.id }, actor)));
    expect(twice.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(twice.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['SALE_TOKEN_USED']);
    expect(await db.selectFrom('product_status_history').select('to_status').where('product_id', '=', b.id).where('to_status', '=', 'ACTIVATED').execute()).toHaveLength(1);
    expect((await audit.verifyChain()).ok).toBe(true);
  });
});
