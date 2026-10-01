/**
 * Real PostgreSQL parity suite (opt-in).
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/db/postgres.test.ts
 *
 * The role needs CREATEDB: each run creates a throwaway database, migrates
 * it, checks that pg returns the same JS types as PGlite and that audit
 * appends stay linear under true parallelism (pool of 8), then drops it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
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
});
