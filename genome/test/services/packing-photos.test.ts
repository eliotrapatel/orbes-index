/**
 * The packing photos' keeping (plan NEXT LOT of 2026-10-07, §3.5.6.8 housekeeping, step 5.9; services/parcels.ts
 * purgePackingPhotos, run by context.ts startHousekeeping as `packingPhotos`): « kept until the return window ends
 * (a fixed 14 days after delivery), or until a return opened in that time is closed, then deleted ».
 *
 *  - a delivered parcel's photo: kept 14 days after its delivery, erased after them (`shipment.photo.erase`);
 *  - a return opened in those 14 days holds it until the return is closed or cancelled;
 *  - a parcel never delivered: 14 days after its parcel problem is decided or cancelled (never while one is open), or
 *    after the shipment is cancelled.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHousekeeping } from '../../src/server/context.js';
import { purgePackingPhotos } from '../../src/server/services/parcels.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { packAndShip, stockPieces } from '../support/fulfil.js';
import { jpegPhoto } from '../support/images.js';
import { createAccount } from '../support/live.js';

const MINUTE = 60_000;
const DAY = 86_400_000;

describe('the packing photos\' keeping (§3.5.6.8)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let france: string;
  let colissimo: string;
  let sizes = 40;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  const db = () => h.t.db;
  /** A paid salon order of a size of its own, its piece stocked, packed and shipped: its order and its shipment. */
  async function shipped(): Promise<{ orderId: string; shipmentId: string }> {
    sizes += 2;
    const size = String(sizes);
    const skuId = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, size));
    const account = await createAccount(db());
    const request = await db().insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(MINUTE);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const orderId = (await db().selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(orderId, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(orderId, { to: 'PAID' }, admin);
    await stockPieces(h.ctx, { skuId, locationId: france, count: 1, forOrderIds: [orderId] }, admin);
    await packAndShip(h.ctx, orderId, { carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    const s = await db().selectFrom('shipments').select('id').where('order_id', '=', orderId).executeTakeFirstOrThrow();
    return { orderId, shipmentId: s.id };
  }
  const photo = async (id: string) => db().selectFrom('shipments').select(['photo_sha256', 'photo_erased_at']).where('id', '=', id).executeTakeFirstOrThrow();
  const caseOn = (orderId: string, kind: 'RETURN' | 'LOST', shipmentId: string | null) =>
    db()
      .insertInto('order_cases')
      .values({ order_id: orderId, shipment_id: shipmentId, kind, opened_by_type: 'admin', opened_by_id: admin.id!, opened_at: h.clock.now(), reason: kind === 'RETURN' ? 'SIZE' : null, note: 'Client Services.' })
      .returning('id')
      .executeTakeFirstOrThrow();

  it('keeps a delivered parcel\'s photo 14 days after its delivery, then erases it (journaled, never the photo)', async () => {
    const { orderId, shipmentId } = await shipped();
    h.clock.advance(DAY);
    await h.ctx.services.logistics.markDelivered(orderId, admin, null);
    const deliveredAt = h.clock.now();
    h.clock.set(new Date(deliveredAt.getTime() + 14 * DAY - MINUTE));
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(0);
    expect((await photo(shipmentId)).photo_sha256).not.toBeNull();
    h.clock.advance(2 * MINUTE);
    // The housekeeping's own job.
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      expect((await hk.runOnce()).packingPhotos).toBe(1);
    } finally {
      await hk.stop();
    }
    expect(await photo(shipmentId)).toEqual({ photo_sha256: null, photo_erased_at: h.clock.now() });
    await expect(h.ctx.services.logistics.photo(shipmentId, null)).rejects.toMatchObject({ code: 'SHIPMENT_NOT_FOUND' });
    const journal = await db().selectFrom('event_journal').select(['type', 'entity_type', 'payload']).where('entity_id', '=', shipmentId).execute();
    expect(journal.map((j) => [j.type, j.entity_type, Object.keys(j.payload).sort()])).toEqual([['shipment.photo.erase', 'shipment', ['erasedAt', 'id', 'orderId']]]);
  });

  it('holds it while a return opened in the 14 days is open, and erases it once the return is closed', async () => {
    const { orderId, shipmentId } = await shipped();
    await h.ctx.services.logistics.markDelivered(orderId, admin, null);
    const deliveredAt = h.clock.now();
    h.clock.advance(3 * DAY);
    const c = await caseOn(orderId, 'RETURN', null);
    h.clock.set(new Date(deliveredAt.getTime() + 20 * DAY));
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(0);
    expect((await photo(shipmentId)).photo_sha256).not.toBeNull();
    await db().updateTable('order_cases').set({ status: 'CANCELLED', cancelled_at: h.clock.now(), cancelled_by: admin.id!, cancel_note: 'Withdrawn.' }).where('id', '=', c.id).execute();
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(1);
  });

  it('erases a parcel never delivered 14 days after its parcel problem is decided, never while it is open; a cancelled shipment 14 days after', async () => {
    const { orderId, shipmentId } = await shipped();
    await db().updateTable('shipments').set({ status: 'LOST' }).where('id', '=', shipmentId).execute();
    const c = await caseOn(orderId, 'LOST', shipmentId);
    h.clock.advance(30 * DAY);
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(0);
    await db().updateTable('order_cases').set({ status: 'CLOSED', outcome: 'REFUND', piece_to: 'REVOKED', closed_at: h.clock.now(), closed_by: admin.id! }).where('id', '=', c.id).execute();
    h.clock.advance(14 * DAY - MINUTE);
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(0);
    h.clock.advance(2 * MINUTE);
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(1);
    expect((await photo(shipmentId)).photo_sha256).toBeNull();
  });

  it('erases the photo of a shipment cancelled while packing 14 days after its cancellation', async () => {
    sizes += 2;
    const size = String(sizes);
    const skuId = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, size));
    const account = await createAccount(db());
    const request = await db().insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const orderId = (await db().selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(orderId, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(orderId, { to: 'PAID' }, admin);
    await stockPieces(h.ctx, { skuId, locationId: france, count: 1, forOrderIds: [orderId] }, admin);
    await h.ctx.services.orders.setBuyer(orderId, { name: 'Ada Martin', address: '4 rue du Bac', country: 'FR' }, admin);
    const view = await h.ctx.services.logistics.startPacking(orderId, admin, null);
    await h.ctx.services.logistics.setPhoto(orderId, { mime: 'image/jpeg', bytes: jpegPhoto(8, 8) }, admin, null);
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(orderId, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    expect((await db().selectFrom('shipments').select('status').where('id', '=', view.shipment!.id).executeTakeFirstOrThrow()).status).toBe('CANCELLED');
    h.clock.advance(14 * DAY - MINUTE);
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(0);
    h.clock.advance(2 * MINUTE);
    expect(await purgePackingPhotos(db(), h.clock.now())).toBe(1);
    expect((await photo(view.shipment!.id)).photo_sha256).toBeNull();
  });
});
