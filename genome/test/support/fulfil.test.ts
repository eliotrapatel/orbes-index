/**
 * The shared fulfilment helpers (test/support/fulfil.ts, plan NEXT LOT §3.5.10, step 5.9), on the real paths:
 * `stockPieces` stocks counted pieces that serve the orders waiting, the oldest first; `packAndShip` packs and ships an
 * order's parcel through the agent's steps, entering the fixture address when its order has none, and SHIP starts the
 * piece's warranty once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { FIXTURE_BUYER, packAndShip, stockPieces } from './fulfil.js';
import { createAccount } from './live.js';

describe('test/support/fulfil.ts', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let france: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  it('stocks a piece for an order that had no buyer, packs and ships it, and starts its warranty once', async () => {
    const skuId = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
    const account = await createAccount(h.t.db);
    const request = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    h.clock.advance(60_000);
    await h.ctx.services.orders.transition(id, { to: 'PAID' }, admin);
    expect((await h.t.db.selectFrom('orders').select('reservation').where('id', '=', id).executeTakeFirstOrThrow()).reservation).toBe('AWAITING');
    const [piece] = await stockPieces(h.ctx, { skuId, locationId: france, count: 1, productionBatch: 'B-2026-11-TEST', forOrderIds: [id] }, admin);
    expect(piece!.productId).toMatch(/^O26-J-/);
    const row = await h.t.db.selectFrom('products').select(['production_batch', 'stock_entered_at']).where('id', '=', piece!.uuid).executeTakeFirstOrThrow();
    expect(row.production_batch).toBe('B-2026-11-TEST');
    expect(row.stock_entered_at).not.toBeNull();
    await packAndShip(h.ctx, id, { carrierId: (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id, trackingNumber: '6A12345678901' }, admin);
    const o = await h.t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(o).toMatchObject({ status: 'SHIPPED', product_id: piece!.uuid, buyer_name: FIXTURE_BUYER.name, buyer_address: FIXTURE_BUYER.address, tracking_number: '6A12345678901' });
    const started = await h.t.db.selectFrom('audit_logs').select('details').where('action', '=', 'warranty.activate').where('target_id', '=', piece!.productId).execute();
    expect(started.map((a) => [a.details.via, a.details.orderId])).toEqual([['ship', id]]);
    // stockPieces refuses a fixture whose order an older waiting one overtook.
    const older = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(older.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const first = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', older.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(first, { sizeLabel: '52' }, admin);
    h.clock.advance(60_000);
    const younger = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(younger.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const second = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', younger.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(second, { sizeLabel: '52' }, admin);
    await expect(stockPieces(h.ctx, { skuId, locationId: france, count: 1, forOrderIds: [second] }, admin)).rejects.toThrow(/an older order of its size took it/);
  });
});
