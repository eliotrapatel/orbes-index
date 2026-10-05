/**
 * The stock under concurrency (plan LIVE RELEASE+ of 2026-10-04, step S1): the last piece of a SKU at a location is held
 * by one order only, whichever channel the orders come from and whatever moves the stock meanwhile; the others have
 * their piece made (a piece to make, its identity reserved). Every change of a SKU's stock or reservations takes the
 * SKU's row first (services/stock.ts lockSku).
 *
 * On PGlite (always) the calls are issued together and the database serialises their transactions: every order must
 * give a correct result. On PostgreSQL (opt-in, a pool of 8: true parallelism) the same cases run:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/orders-concurrency.test.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, inTransaction, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { ensureSku, stockLevel } from '../../src/server/services/stock.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { accountOfTier, createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
const HOUR = 3_600_000;
const MINUTE = 60_000;

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
      const name = `orbes_orders_${randomBytes(6).toString('hex')}`;
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
  describe.skipIf(backend.skip)(`the stock under concurrency, on ${backend.name}`, () => {
    let handle: Awaited<ReturnType<Backend['open']>>;
    let ctx: AppContext;
    let clock: ManualClock;
    let f: LiveFixture;
    let france: string;
    let logistics: string;

    beforeAll(async () => {
      handle = await backend.open();
      clock = createManualClock('2026-12-06T09:00:00.000Z');
      ctx = await createContext(testConfig(), { db: handle.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
      f = await liveFixtureOn(ctx, clock);
      const locations = await handle.db.selectFrom('stock_locations').select(['id', 'name']).execute();
      france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
      logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    });
    afterAll(async () => {
      await ctx?.close();
      await handle?.close();
    });

    const skuOf = (label: string) => inTransaction(handle.db, (tx) => ensureSku(tx, f.modelId, label));
    const receive = (skuId: string, locationId: string, n: number) => ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Counted.' }, f.admin);
    /** A request of the salon closed as ACCEPTED: its order, RESERVED at FRANCE WAREHOUSE, its size not entered yet. */
    async function salonOrder(): Promise<string> {
      const a = await createAccount(handle.db);
      const r = await handle.db.insertInto('shop_requests').values({ account_id: a.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
      await ctx.services.salon.close(r.id, { note: 'Sold.', outcome: 'ACCEPTED' }, f.admin);
      return (await handle.db.selectFrom('orders').select('id').where('shop_request_id', '=', r.id).executeTakeFirstOrThrow()).id;
    }
    const holdings = async (ids: string[]) =>
      (await handle.db.selectFrom('orders').select('reservation').where('id', 'in', ids).execute()).map((o) => o.reservation).sort();

    it('the last piece of a SKU goes to one order only: entered together, the others have their piece made', async () => {
      const sku = await skuOf('52');
      await receive(sku, france, 1);
      const ids = await Promise.all(Array.from({ length: 6 }, () => salonOrder()));
      clock.advance(MINUTE);
      expect(await together(ids.map((id) => () => ctx.services.orders.setTerms(id, { sizeLabel: '52' }, f.admin)))).toEqual(Array(6).fill('ok'));
      expect(await holdings(ids)).toEqual(['BENCH', 'BENCH', 'BENCH', 'BENCH', 'BENCH', 'STOCK']);
      expect(await stockLevel(handle.db, sku, france)).toEqual({ onHand: 1, reserved: 1, available: 0 });
      // Each piece to make with its own identity, its serial unique.
      const identities = await handle.db.selectFrom('bench_items as b').innerJoin('products as p', 'p.id', 'b.product_id').select(['p.serial', 'p.status']).where('b.order_id', 'in', ids).execute();
      expect(identities).toHaveLength(5);
      expect(new Set(identities.map((p) => p.serial)).size).toBe(5);
      expect(identities.every((p) => p.status === 'RESERVED')).toBe(true);
    });

    it('confirmed together in different LIVE RELEASES, their orders take the last piece once', async () => {
      const sku = await skuOf('54');
      await receive(sku, france, 1);
      // Four releases of the same size at the same T0, one collector in each.
      const opensAt = new Date(clock.now().getTime() + HOUR);
      const sales = [];
      for (let i = 0; i < 4; i++) sales.push({ r: await createLiveRelease(f, { opensAt, sizes: [{ label: '54', stock: 1 }] }), a: await accountOfTier(f, 0) });
      clock.set(new Date(opensAt.getTime() - MINUTE));
      for (const s of sales) await f.live.enter(s.a.id, s.r.id, { sizeId: s.r.sizes[0]!.id }, s.a.actor);
      clock.set(opensAt);
      for (const s of sales) await f.live.advance(s.r.id);
      for (const s of sales) {
        const token = (await f.live.entry(s.a.id, s.r.id))!.turn!.token!;
        await f.live.press(s.a.id, s.r.id, token);
      }
      clock.advance(1500);
      for (const s of sales) await f.live.secure(s.a.id, s.r.id, (await f.live.entry(s.a.id, s.r.id))!.turn!.token!, s.a.actor);
      expect(await together(sales.map((s) => () => f.live.confirm(s.a.id, s.r.id, s.a.actor)))).toEqual(['ok', 'ok', 'ok', 'ok']);
      const ids = (await handle.db.selectFrom('orders').select('id').where('drop_id', 'in', sales.map((s) => s.r.id)).execute()).map((o) => o.id);
      expect(await holdings(ids)).toEqual(['BENCH', 'BENCH', 'BENCH', 'STOCK']);
      expect(await stockLevel(handle.db, sku, france)).toEqual({ onHand: 1, reserved: 1, available: 0 });
    });

    it('a transfer and an order racing for the last piece: one of them has it, never both', async () => {
      for (let round = 0; round < 4; round++) {
        const sku = await skuOf(`6${round}`);
        await receive(sku, france, 1);
        const id = await salonOrder();
        clock.advance(MINUTE);
        const [moved, held] = await together([
          () => ctx.services.stock.transfer({ skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 1 }, f.admin),
          () => ctx.services.orders.setTerms(id, { sizeLabel: `6${round}` }, f.admin),
        ]);
        expect(held).toBe('ok');
        const reservation = (await handle.db.selectFrom('orders').select('reservation').where('id', '=', id).executeTakeFirstOrThrow()).reservation;
        const level = await stockLevel(handle.db, sku, france);
        if (moved === 'ok') {
          // The piece left first: the order has its piece made.
          expect([reservation, level]).toEqual(['BENCH', { onHand: 0, reserved: 0, available: 0 }]);
        } else {
          expect(moved).toBe('STOCK_NOT_AVAILABLE');
          expect([reservation, level]).toEqual(['STOCK', { onHand: 1, reserved: 1, available: 0 }]);
        }
      }
    });

    it('cancelled together with the reservation of another order, the piece released goes to it or stays available, never twice', async () => {
      const sku = await skuOf('70');
      await receive(sku, france, 1);
      const first = await salonOrder();
      await ctx.services.orders.setTerms(first, { sizeLabel: '70' }, f.admin);
      const second = await salonOrder();
      clock.advance(MINUTE);
      expect(
        await together([
          () => ctx.services.orders.transition(first, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin),
          () => ctx.services.orders.setTerms(second, { sizeLabel: '70' }, f.admin),
        ]),
      ).toEqual(['ok', 'ok']);
      const level = await stockLevel(handle.db, sku, france);
      expect(level.reserved).toBeLessThanOrEqual(level.onHand);
      expect(level.onHand).toBe(1);
      const reservation = (await handle.db.selectFrom('orders').select('reservation').where('id', '=', second).executeTakeFirstOrThrow()).reservation;
      expect(level).toEqual(reservation === 'STOCK' ? { onHand: 1, reserved: 1, available: 0 } : { onHand: 1, reserved: 0, available: 1 });
    });
  });
}
