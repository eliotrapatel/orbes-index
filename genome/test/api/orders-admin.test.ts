/**
 * The console's routes of the orders, the stock and their settings (plan LIVE RELEASE+, step S2), over HTTP with real
 * sessions (OPERATOR, AUDITOR, ADMIN):
 *
 *  - the board and an order's page, the buyer's name and address masked for an AUDITOR as the emails are; the steps
 *    with what each requires; the terms of a salon's order, the buyer, the location; its piece bound by the packing
 *    scan, its parcel shipped through Logistics (the SHIPPED gate, plan NEXT LOT step 5.12);
 *  - the delays of the alerts (ADMIN), the locations and the carriers (ADMIN), their validation, audited;
 *  - the stock through Logistics' routes since the atelier went (plan NEXT LOT step 5.13): a minimum, a count corrected,
 *    a transfer; the atelier's routes and Link a piece answer 404.
 * Which role reaches which route is test/api/admin-roles.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';
import { packParcel, scanIntoParcel, stockPieces } from '../support/fulfil.js';

type Json = Record<string, any>;
const MINUTE = 60_000;

describe('orders, the stock and their settings: the console\'s routes', () => {
  let h: Harness;
  let f: LiveFixture;
  let op: Client;
  let auditor: Client;
  let admin: Client;
  let france: string;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-09T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
    const locations = (safeJson(await auditor.get('/api/admin/locations')) as { items: Json[] }).items;
    expect(locations.map((l) => [l.name, l.isDefault])).toEqual([
      ['FRANCE WAREHOUSE', true],
      ['LOGISTICS WAREHOUSE', false],
    ]);
    france = locations[0]!.id;
    logistics = locations[1]!.id;
  });
  afterAll(() => h?.close());

  /** A request of the private salon closed as ACCEPTED: its order, RESERVED, its terms to enter. */
  async function salonOrder(): Promise<string> {
    const account = await createAccount(h.ctx.db);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    return (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
  }

  it('reads the board and an order, the buyer masked for an AUDITOR; enters the terms, the buyer and the location; steps it with what each requires', async () => {
    const id = await salonOrder();
    const board = safeJson(await auditor.get('/api/admin/orders?channel=SALON')) as Json;
    expect(board.columns.map((c: Json) => c.status)).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']);
    expect(board.columns[0].items.map((x: Json) => x.id)).toContain(id);
    expect(board.delays).toMatchObject({ reservedDays: 2, readyDays: 5, shippedDays: 10, unregisteredDays: 30 });
    expect(errorOf(await auditor.get('/api/admin/orders?channel=SHOP')).code).toBe('VALIDATION_FAILED');
    expect((await auditor.get('/api/admin/orders/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);

    // Terms: the size (none in stock: it waits for supplier stock), the price; the engraving.
    expect(errorOf(await op.patch(`/api/admin/orders/${id}/terms`, {})).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await op.patch(`/api/admin/orders/${id}/terms`, { priceMinor: 480_000 })).code).toBe('VALIDATION_FAILED');
    const terms = safeJson(await op.patch(`/api/admin/orders/${id}/terms`, { sizeLabel: '52', priceMinor: 480_000, currency: 'EUR', engravingText: 'A. & L.' })) as Json;
    expect(terms.order).toMatchObject({ sizeLabel: '52', priceMinor: 480_000, currency: 'EUR', engravingText: 'A. & L.', reservation: 'AWAITING' });
    expect(terms.order).not.toHaveProperty('bench');

    // The buyer: in clear for an OPERATOR, masked for an AUDITOR, never in the audit log.
    const buyer = safeJson(await op.request('PUT', `/api/admin/orders/${id}/buyer`, { body: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' } })) as Json;
    expect(buyer.order.buyer).toEqual({ name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' });
    const read = safeJson(await auditor.get(`/api/admin/orders/${id}`)) as Json;
    expect(read.order.buyer).toEqual({ name: 'J*** D***', address: '***' });
    expect(read.account.email).toMatch(/^l\*\*\*@example\.com$/);
    expect(read).toMatchObject({ sourceReference: null, timing: { rule: 'RESERVED', late: false }, piece: null, delays: { reservedDays: 2 } });
    const auditRows = await h.ctx.db.selectFrom('audit_logs').select('details').where('target_id', '=', id).execute();
    expect(JSON.stringify(auditRows)).not.toMatch(/Jane|Paix|A\. & L\./);
    const maskedCsv = await auditor.get(`/api/admin/orders.csv?q=${orderReference(id)}`);
    expect(maskedCsv.body).toContain('"J*** D***","***"');
    expect(maskedCsv.body).not.toContain('Jane');
    expect((await op.get(`/api/admin/orders.csv?q=${orderReference(id)}`)).body).toContain('"Jane Doe","1 rue de la Paix\n75002 Paris"');
    expect(errorOf(await op.request('PUT', `/api/admin/orders/${id}/buyer`, { body: { name: 'Jane\nDoe', address: null } })).code).toBe('VALIDATION_FAILED');

    // The location: it waits there.
    const moved = safeJson(await op.post(`/api/admin/orders/${id}/location`, { locationId: logistics })) as Json;
    expect(moved.order).toMatchObject({ location: { id: logistics }, reservation: 'AWAITING' });

    // Steps: SHIPPED before the piece is ready is refused; a RETURN is not a step of this page; CANCELLED needs a note.
    expect(errorOf(await op.post(`/api/admin/orders/${id}/transition`, { to: 'RETURNED', outcome: 'ARCHIVED', note: 'x' })).code).toBe('VALIDATION_FAILED');
    const paid = safeJson(await op.post(`/api/admin/orders/${id}/transition`, { to: 'PAID', note: 'Paid by transfer.' })) as Json;
    expect(paid.order.status).toBe('PAID');
    const carrier = ((safeJson(await auditor.get('/api/admin/carriers')) as { items: Json[] }).items.find((c) => c.name === 'Colissimo'))!;
    const ship = { to: 'SHIPPED', carrierId: carrier.id, trackingNumber: '6A12345678901', declaredValueMinor: 480_000 };
    expect(errorOf(await op.post(`/api/admin/orders/${id}/transition`, ship)).code).toBe('ORDER_NOT_READY');
    expect(errorOf(await op.post(`/api/admin/orders/${id}/transition`, { ...ship, trackingNumber: '#' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await op.post(`/api/admin/orders/${id}/transition`, { to: 'CANCELLED' })).code).toBe('VALIDATION_FAILED');

    // No piece to make is created for it (plan NEXT LOT §3.5): a piece counted in where it waits serves it
    // (test/support/fulfil.ts stockPieces), the packing scan binds it; it ships only through its parcel's Ship, once
    // packed (the SHIPPED gate, step 5.12), with its carrier, tracking link and declared value.
    expect(await h.ctx.db.selectFrom('bench_items').select('id').where('order_id', '=', id).execute()).toEqual([]);
    const [piece] = await stockPieces(h.ctx, { skuId: (safeJson(await auditor.get(`/api/admin/orders/${id}`)) as Json).order.skuId, locationId: logistics, count: 1, productionBatch: 'B-2026-11-SALON', material: '925 STERLING SILVER', forOrderIds: [id] }, f.admin);
    expect((safeJson(await auditor.get(`/api/admin/orders/${id}`)) as Json).order).toMatchObject({ reservation: 'STOCK', productId: null });
    await scanIntoParcel(h.ctx, id, {}, f.admin);
    expect((safeJson(await auditor.get(`/api/admin/orders/${id}`)) as Json).order).toMatchObject({ reservation: 'STOCK', productId: piece!.productId });
    const unpacked = await op.post(`/api/admin/orders/${id}/transition`, ship);
    expect([unpacked.statusCode, errorOf(unpacked).code]).toEqual([409, 'ORDER_NOT_PACKED']);
    await packParcel(h.ctx, id, {}, f.admin);
    // Packed: still never by a bare step, only by its parcel's Ship.
    expect(errorOf(await op.post(`/api/admin/orders/${id}/transition`, ship)).code).toBe('ORDER_NOT_PACKED');
    const sent = await op.post(`/api/admin/logistics/orders/${id}/ship`, { carrierId: carrier.id, trackingNumber: '6A12345678901', declaredValues: [{ orderId: id, minor: 480_000 }] });
    expect((safeJson(sent) as Json).step).toBe('SHIPPED');
    const shipped = safeJson(await auditor.get(`/api/admin/orders/${id}`)) as Json;
    expect(shipped.order).toMatchObject({ status: 'SHIPPED', productId: piece!.productId, shipment: { carrier: { name: 'Colissimo' }, trackingNumber: '6A12345678901', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901', declaredValueMinor: 480_000 } });
    // Its warranty started at SHIP (question 14).
    expect(shipped.piece).toEqual({ productId: piece!.productId, status: 'ACTIVATED', registered: false });
    const delivered = safeJson(await op.post(`/api/admin/orders/${id}/transition`, { to: 'DELIVERED' })) as Json;
    expect(delivered.order.status).toBe('DELIVERED');
    expect(delivered.timing).toMatchObject({ rule: 'UNREGISTERED', late: false });
  });

  it('binds a piece of the stock to an order by the packing scan, which ships only once packed; Link a piece is gone', async () => {
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '56'));
    const piece = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '56', material: '925 STERLING SILVER' }, f.admin);
    // Counted in through Logistics (a piece on the shelf, then the count corrected up by ORBES, applied at once).
    expect((await op.post('/api/admin/logistics/count-in', { skuId: sku, productIds: [piece.product.productId], note: 'On the shelf.' })).statusCode).toBe(200);
    expect((await op.post('/api/admin/logistics/corrections', { skuId: sku, locationId: france, delta: 1, reason: 'Counted.' })).statusCode).toBe(201);
    const id = await salonOrder();
    await op.patch(`/api/admin/orders/${id}/terms`, { sizeLabel: '56', priceMinor: 480_000, currency: 'EUR' });
    expect((safeJson(await op.post(`/api/admin/orders/${id}/transition`, { to: 'PAID' })) as Json).order).toMatchObject({ status: 'PAID', reservation: 'STOCK', productId: null });
    // In stock, its piece not bound yet: it does not ship.
    const carrier = ((safeJson(await auditor.get('/api/admin/carriers')) as { items: Json[] }).items.find((c) => c.name === 'Colissimo'))!;
    const ship = { to: 'SHIPPED', carrierId: carrier.id, trackingNumber: '6A12345678902' };
    const unlinked = await op.post(`/api/admin/orders/${id}/transition`, ship);
    expect([unlinked.statusCode, errorOf(unlinked).code]).toEqual([409, 'ORDER_PIECE_NOT_LINKED']);
    // Link a piece is gone with the atelier (plan NEXT LOT step 5.13): the packing scan binds the piece.
    expect((await op.post(`/api/admin/orders/${id}/piece`, { productId: piece.product.productId })).statusCode).toBe(404);
    await scanIntoParcel(h.ctx, id, {}, f.admin);
    const bound = safeJson(await op.get(`/api/admin/orders/${id}`)) as Json;
    expect(bound.order).toMatchObject({ reservation: 'STOCK', productId: piece.product.productId });
    expect(bound.order.events.map((e: Json) => e.action)).toContain('order.link');
    // Bound, not packed: the SHIPPED gate (step 5.12); packed through the agent's steps, its parcel's Ship sends it.
    expect(errorOf(await op.post(`/api/admin/orders/${id}/transition`, ship)).code).toBe('ORDER_NOT_PACKED');
    await packParcel(h.ctx, id, {}, f.admin);
    await op.post(`/api/admin/logistics/orders/${id}/ship`, { carrierId: carrier.id, trackingNumber: '6A12345678902' });
    expect((safeJson(await op.get(`/api/admin/orders/${id}`)) as Json).order).toMatchObject({ status: 'SHIPPED', productId: piece.product.productId });
  });

  it('sets the delays of the alerts (ADMIN), within their bounds, audited', async () => {
    const body = { reservedDays: 3, readyDays: 4, shippedDays: 12, unregisteredDays: 45 };
    expect((await op.request('PUT', '/api/admin/orders/alerts', { body })).statusCode).toBe(403);
    expect(errorOf(await admin.request('PUT', '/api/admin/orders/alerts', { body: { ...body, unregisteredDays: 366 } })).code).toBe('VALIDATION_FAILED');
    const set = safeJson(await admin.request('PUT', '/api/admin/orders/alerts', { body })) as Json;
    expect(set).toMatchObject({ ...body, updatedBy: { email: expect.stringMatching(/^admin-/) } });
    expect(safeJson(await auditor.get('/api/admin/orders/alerts'))).toMatchObject(body);
    await admin.request('PUT', '/api/admin/orders/alerts', { body: { reservedDays: 2, readyDays: 5, shippedDays: 10, unregisteredDays: 30 } });
  });

  it('adds and renames a location, makes it the default; adds a carrier with its tracking link, edits it, sets it aside (ADMIN), audited', async () => {
    expect((await op.post('/api/admin/locations', { name: 'PARIS ATELIER' })).statusCode).toBe(403);
    const paris = safeJson(await admin.post('/api/admin/locations', { name: 'PARIS ATELIER' })) as Json;
    expect(paris).toMatchObject({ name: 'PARIS ATELIER', isDefault: false });
    expect(errorOf(await admin.post('/api/admin/locations', { name: 'paris atelier' })).code).toBe('STOCK_LOCATION_NAME_TAKEN');
    expect((safeJson(await admin.patch(`/api/admin/locations/${paris.id}`, { name: 'PARIS STUDIO' })) as Json).name).toBe('PARIS STUDIO');
    expect(errorOf(await admin.patch(`/api/admin/locations/${paris.id}`, { isDefault: false })).code).toBe('VALIDATION_FAILED');
    expect((safeJson(await admin.patch(`/api/admin/locations/${paris.id}`, { isDefault: true })) as Json).isDefault).toBe(true);
    const all = (safeJson(await auditor.get('/api/admin/locations')) as { items: Json[] }).items;
    expect(all.filter((l) => l.isDefault).map((l) => l.name)).toEqual(['PARIS STUDIO']);
    const audits = await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', paris.id).orderBy('id').execute();
    expect(audits.map((a) => a.action)).toEqual(['stock.location.create', 'stock.location.update', 'stock.location.update']);
    expect(audits[2]!.details).toEqual({ default: { from: france, to: paris.id } });
    await admin.patch(`/api/admin/locations/${france}`, { isDefault: true });

    for (const bad of ['http://track.example/{tracking}', 'https://track.example/no-placeholder', 'https://track.example/{tracking}/{tracking}', 'https://track example/{tracking}']) {
      expect(errorOf(await admin.post('/api/admin/carriers', { name: 'FEDEX', trackingUrl: bad })).code, bad).toBe('VALIDATION_FAILED');
    }
    const fedex = safeJson(await admin.post('/api/admin/carriers', { name: 'FedEx', trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr={tracking}' })) as Json;
    expect(fedex).toMatchObject({ name: 'FedEx', active: true });
    expect(errorOf(await admin.post('/api/admin/carriers', { name: 'FEDEX', trackingUrl: 'https://x.example/{tracking}' })).code).toBe('CARRIER_NAME_TAKEN');
    const edited = safeJson(await admin.patch(`/api/admin/carriers/${fedex.id}`, { trackingUrl: 'https://www.fedex.com/en-us/tracking.html?tracknumbers={tracking}' })) as Json;
    expect(edited.trackingUrl).toBe('https://www.fedex.com/en-us/tracking.html?tracknumbers={tracking}');
    expect((safeJson(await admin.patch(`/api/admin/carriers/${fedex.id}`, { active: false })) as Json).active).toBe(false);
    const carriers = (safeJson(await auditor.get('/api/admin/carriers')) as { items: Json[] }).items;
    expect(carriers.at(-1)).toMatchObject({ name: 'FedEx', active: false });
    expect((await h.ctx.db.selectFrom('audit_logs').select('action').where('target_id', '=', fedex.id).orderBy('id').execute()).map((a) => a.action)).toEqual(['carrier.create', 'carrier.update', 'carrier.update']);
  });

  it('reads the stock, sets a minimum, corrects a count and transfers pieces through Logistics; the atelier\'s routes answer 404 (plan NEXT LOT step 5.13)', async () => {
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '58'));
    expect((await op.request('PUT', '/api/admin/logistics/minimums', { body: { skuId: sku, locationId: logistics, minimum: 2 } })).statusCode).toBe(204);
    const stock = safeJson(await auditor.get(`/api/admin/logistics/stock?locationId=${logistics}`)) as Json;
    expect(stock.rows.find((r: Json) => r.sku.id === sku)).toMatchObject({ onHand: 0, reserved: 0, available: 0, waiting: 0, minimum: 2, toOrder: 2 });
    // Two pieces counted in at FRANCE (ORBES's correction applied at once), then one moved to LOGISTICS (two movements, paired).
    const pieces = [];
    for (let i = 0; i < 2; i++) pieces.push((await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '58', material: '925 STERLING SILVER' }, f.admin)).product.productId);
    expect((await op.post('/api/admin/logistics/count-in', { skuId: sku, productIds: pieces, note: 'On the shelf.' })).statusCode).toBe(200);
    expect(errorOf(await op.post('/api/admin/logistics/corrections', { skuId: sku, locationId: france, delta: 3, reason: 'Counted.' })).code).toBe('STOCK_NOT_BACKED');
    expect((await op.post('/api/admin/logistics/corrections', { skuId: sku, locationId: france, delta: 2, reason: 'Counted.' })).statusCode).toBe(201);
    const moved = safeJson(await op.post('/api/admin/logistics/transfers', { skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 1, note: '' })) as Json;
    expect([moved.from, moved.to]).toEqual([
      { onHand: 1, reserved: 0, available: 1 },
      { onHand: 1, reserved: 0, available: 1 },
    ]);
    expect(errorOf(await op.post('/api/admin/logistics/transfers', { skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 2 })).code).toBe('STOCK_NOT_AVAILABLE');
    expect((safeJson(await auditor.get(`/api/admin/logistics/stock?locationId=${logistics}`)) as Json).rows.find((r: Json) => r.sku.id === sku)).toMatchObject({ onHand: 1, minimum: 2, toOrder: 1 });
    // The atelier's routes are gone: no stock of its own, no pieces to make, no work sheets.
    for (const [method, url] of [
      ['GET', `/api/admin/atelier/stock?locationId=${logistics}`],
      ['PUT', '/api/admin/atelier/thresholds'],
      ['POST', '/api/admin/atelier/make'],
      ['GET', '/api/admin/atelier/bench?origin=STOCK'],
      ['GET', '/api/admin/atelier/bench.csv'],
      ['POST', '/api/admin/atelier/sheets'],
    ] as const) {
      expect((await op.request(method, url, method === 'GET' ? {} : { body: { skuId: sku } })).statusCode, url).toBe(404);
    }
    h.clock.advance(MINUTE);
  });
});
