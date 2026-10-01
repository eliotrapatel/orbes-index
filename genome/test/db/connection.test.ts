import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { DatabaseUrlError, parseDatabaseUrl, redactDatabaseUrl } from '../../src/server/db/url.js';
import { advisoryXactLock, closeDb, createDb, inTransaction, parseInt8 } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { createTestDb, type TestDb } from '../support/db.js';

describe('parseDatabaseUrl', () => {
  it('accepts the supported forms', () => {
    expect(parseDatabaseUrl('pglite:memory')).toEqual({ kind: 'pglite', dataDir: null });
    expect(parseDatabaseUrl('pglite:/var/lib/orbes/../orbes/db')).toEqual({ kind: 'pglite', dataDir: '/var/lib/orbes/db' });
    expect(parseDatabaseUrl('postgres://u:p@db:5432/orbes')).toEqual({ kind: 'postgres', url: 'postgres://u:p@db:5432/orbes' });
    expect(parseDatabaseUrl('postgresql://db/orbes?sslmode=require').kind).toBe('postgres');
    expect(parseDatabaseUrl('postgres:///orbes?host=/var/run/postgresql').kind).toBe('postgres');
  });

  it('rejects everything else without echoing the URL', () => {
    for (const bad of ['', '  ', 'pglite:relative/dir', 'pglite:', 'mysql://u:secret@h/db', 'postgres://', 'sqlite:memory', 'pglite:memory2']) {
      let err: unknown;
      try {
        parseDatabaseUrl(bad);
      } catch (e) {
        err = e;
      }
      expect(err, bad).toBeInstanceOf(DatabaseUrlError);
      expect((err as Error).message).not.toContain('secret');
    }
  });

  it('redacts passwords for logs', () => {
    expect(redactDatabaseUrl('postgres://orbes:s3cr3t@db:5432/orbes')).toBe('postgres://orbes:***@db:5432/orbes');
    expect(redactDatabaseUrl('postgres://db/orbes')).toBe('postgres://db/orbes');
    expect(redactDatabaseUrl('pglite:memory')).toBe('pglite:memory');
    expect(redactDatabaseUrl('nonsense://a:b@c')).toBe('[invalid database url]');
  });
});

describe('parseInt8', () => {
  it('returns numbers when exact and BigInt otherwise', () => {
    expect(parseInt8('0')).toBe(0);
    expect(parseInt8('-42')).toBe(-42);
    expect(parseInt8('4294967295')).toBe(4294967295);
    expect(parseInt8('9007199254740991')).toBe(9007199254740991);
    expect(parseInt8('9007199254740992')).toBe(9007199254740992n);
    expect(parseInt8('-9223372036854775808')).toBe(-9223372036854775808n);
  });
});

describe('createDb', () => {
  it('pglite:memory gives a working, migratable database', async () => {
    const db = createDb('pglite:memory');
    try {
      await migrateToLatest(db);
      const r = await sql<{ n: number; d: string }>`SELECT count(*) AS n, '2026-01-31'::date AS d FROM categories`.execute(db);
      expect(r.rows[0]).toEqual({ n: 0, d: '2026-01-31' });
    } finally {
      await closeDb(db);
      await closeDb(db); // idempotent
    }
  });

  it('pglite:/abs/dir persists across reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orbes-pglite-'));
    try {
      const db1 = createDb(`pglite:${dir}`);
      await migrateToLatest(db1);
      await db1.insertInto('categories').values({ id: 1, code: 'J', name: 'JEWELRY' }).execute();
      await closeDb(db1);

      const db2 = createDb(`pglite:${dir}`);
      try {
        expect((await migrateToLatest(db2)).applied).toEqual([]);
        const c = await db2.selectFrom('categories').select(['id', 'code']).executeTakeFirstOrThrow();
        expect(c).toEqual({ id: 1, code: 'J' });
      } finally {
        await closeDb(db2);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('postgres URLs connect lazily (construction never touches the network)', async () => {
    const db = createDb('postgres://nobody:nothing@127.0.0.1:1/none');
    await closeDb(db);
  });

  it('rejects unsupported URLs', () => {
    expect(() => createDb('mysql://x')).toThrow(DatabaseUrlError);
  });
});

describe('transactions and advisory locks', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it('inTransaction opens a transaction, or joins the caller one', async () => {
    await expect(
      inTransaction(t.db, async (trx) => {
        expect(trx.isTransaction).toBe(true);
        await trx.insertInto('collections').values({ name: 'ROLLED BACK' }).execute();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await t.db.selectFrom('collections').selectAll().execute()).toEqual([]);

    await t.db.transaction().execute(async (outer) => {
      await inTransaction(outer, async (inner) => {
        expect(inner).toBe(outer);
        await inner.insertInto('collections').values({ name: 'JOINED' }).execute();
      });
    });
    expect((await t.db.selectFrom('collections').select('name').execute()).map((c) => c.name)).toEqual(['JOINED']);
  });

  it('advisoryXactLock requires a transaction and validates keys', async () => {
    await expect(advisoryXactLock(t.db, 1)).rejects.toThrow(/inside a transaction/);
    await t.db.transaction().execute(async (trx) => {
      await advisoryXactLock(trx, 0x4f52_0001);
      await advisoryXactLock(trx, 7, 9);
      await expect(advisoryXactLock(trx, 1.5)).rejects.toThrow(RangeError);
      await expect(advisoryXactLock(trx, 2 ** 40, 1)).rejects.toThrow(RangeError);
    });
  });
});
