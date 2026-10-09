/**
 * YOUR WISHLIST under concurrency (plan CUSTOMER INTELLIGENCE §3.2 W.4 and W.13, step 2.2): two adds of one account
 * wait for each other on the account's row (FOR NO KEY UPDATE), so WISHLIST_FULL is never passed, and the partial unique
 * index `account_wishes_open` keeps one open wish per account and model whatever happens; an add and a remove of the
 * same model at once end in one consistent row, the last to commit winning.
 *
 * On PGlite (always) the calls are issued together and the database serialises their transactions: every order must
 * give a correct result. On PostgreSQL (opt-in, a pool of 8: true parallelism) the same cases run, in genome-ci:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/wishlist-concurrency.test.ts
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { WISHLIST_MAX, WishlistService } from '../../src/server/services/wishlist.js';
import { createManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const admin = createDb(adminUrl!);
      const name = `orbes_wishes_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        },
      };
    },
  },
];

/** Every outcome of a batch of calls made together: 'ok' or the code of the refusal. */
async function together(calls: (() => Promise<unknown>)[]): Promise<string[]> {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return settled.map((s) => {
    if (s.status === 'fulfilled') return 'ok';
    if (s.reason instanceof DomainError) return s.reason.code;
    throw s.reason;
  });
}

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`YOUR WISHLIST under concurrency, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    const clock = createManualClock('2026-10-09T09:00:00.000Z');
    let wishlist: WishlistService;

    beforeAll(async () => {
      ({ db, close } = await backend.open());
      wishlist = new WishlistService({ db, clock: clock.now });
      await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    }, 60_000);
    afterAll(() => close?.());

    async function account(): Promise<string> {
      const email = `wish-${randomUUID()}@example.com`;
      return (await db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;
    }

    async function models(n: number): Promise<{ id: string; slug: string }[]> {
      const rows = Array.from({ length: n }, () => {
        const id = randomUUID();
        return { id, category_id: 1, name: 'MODEL', type: 'RING', sku_prefix: `WC-${id.slice(0, 8)}`, slug: `wc-${id.slice(0, 8)}`, lookbook: 'PUBLIC' as const, published_at: '2026-01-01T00:00:00Z' };
      });
      await db.insertInto('models').values(rows).execute();
      return rows.map((r) => ({ id: r.id, slug: r.slug }));
    }

    const open = async (accountId: string) =>
      Number((await db.selectFrom('account_wishes').select((eb) => eb.fn.countAll<number>().as('n')).where('account_id', '=', accountId).where('removed_at', 'is', null).executeTakeFirstOrThrow()).n);

    it('20 adds at once at 190 open wishes end at exactly 200, with ten 409 WISHLIST_FULL', async () => {
      const a = await account();
      const held = await models(WISHLIST_MAX - 10);
      await db.insertInto('account_wishes').values(held.map((m, i) => ({ account_id: a, model_id: m.id, added_at: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 1000) }))).execute();
      const fresh = await models(20);
      const outcomes = await together(fresh.map((m) => () => wishlist.add(a, m.slug)));
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(10);
      expect(outcomes.filter((o) => o === 'WISHLIST_FULL')).toHaveLength(10);
      expect(await open(a)).toBe(WISHLIST_MAX);
    }, 60_000);

    it('the same model added 10 times at once from two tabs is one open wish', async () => {
      const a = await account();
      const [m] = await models(1);
      const outcomes = await together(Array.from({ length: 10 }, () => () => wishlist.add(a, m!.slug)));
      expect(outcomes).toEqual(Array(10).fill('ok'));
      expect(await db.selectFrom('account_wishes').selectAll().where('account_id', '=', a).execute()).toHaveLength(1);
    }, 60_000);

    it('an add and a remove racing end in one consistent row: open or removed, never two open', async () => {
      const a = await account();
      const [m] = await models(1);
      await wishlist.add(a, m!.slug);
      for (let round = 0; round < 10; round++) {
        clock.advance(1_000);
        expect(await together([() => wishlist.remove(a, m!.slug), () => wishlist.add(a, m!.slug), () => wishlist.remove(a, m!.slug), () => wishlist.add(a, m!.slug)])).toEqual(['ok', 'ok', 'ok', 'ok']);
        const rows = await db.selectFrom('account_wishes').selectAll().where('account_id', '=', a).execute();
        expect(rows.filter((r) => r.removed_at === null).length).toBeLessThanOrEqual(1);
        // Within the 10 minutes, every add reopens the one row.
        expect(rows).toHaveLength(1);
        const listed = await wishlist.list(a);
        expect(listed.length).toBe(rows[0]!.removed_at === null ? 1 : 0);
      }
    }, 60_000);
  });
}
