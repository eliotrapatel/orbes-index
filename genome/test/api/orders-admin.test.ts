/**
 * The console's routes of the orders, the atelier and their settings (plan LIVE RELEASE+, step S2), over HTTP with real
 * sessions (OPERATOR, AUDITOR, ADMIN):
 *
 *  - the board and an order's page, the buyer's name and address masked for an AUDITOR as the emails are; the steps
 *    with what each requires; the terms of a salon's order, the buyer, the location, a piece picked from the stock;
 *  - the delays of the alerts (ADMIN), the locations and the carriers (ADMIN), their validation, audited;
 *  - the atelier: the stock, a minimum and its suggestion confirmed, the pieces to make started and finished (the claim
 *    code once, no-store), the work sheets with each code's data (OPERATOR only, no-store), the CSV of what to make.
 * Which role reaches which route is test/api/admin-roles.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';
import { stockPiece } from '../support/fulfil.js';

type Json = Record<string, any>;
const MINUTE = 60_000;

describe('orders, the atelier and their settings: the console\'s routes', () => {
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

    // No piece to make is created for it (plan NEXT LOT §3.5): its piece is taken from the stock (test/support/fulfil.ts
    // stockPiece: a piece issued, bound with Link a piece); then it ships, with its carrier, tracking link and declared value.
    expect((safeJson(await auditor.get(`/api/admin/atelier/bench?origin=SALON`)) as Json).groups.flatMap((g: Json) => g.items).find((b: Json) => b.order?.id === id)).toBeUndefined();
    const piece = await stockPiece(h.ctx, { orderId: id, productionBatch: 'B-2026-11-SALON', material: '925 STERLING SILVER' }, f.admin);
    expect((safeJson(await auditor.get(`/api/admin/orders/${id}`)) as Json).order).toMatchObject({ reservation: 'STOCK', productId: piece.productId });
    const shipped = safeJson(await op.post(`/api/admin/orders/${id}/transition`, ship)) as Json;
    expect(shipped.order).toMatchObject({ status: 'SHIPPED', productId: piece.productId, shipment: { carrier: { name: 'Colissimo' }, trackingNumber: '6A12345678901', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901', declaredValueMinor: 480_000 } });
    expect(shipped.piece).toEqual({ productId: piece.productId, status: 'ISSUED', registered: false });
    const delivered = safeJson(await op.post(`/api/admin/orders/${id}/transition`, { to: 'DELIVERED' })) as Json;
    expect(delivered.order.status).toBe('DELIVERED');
    expect(delivered.timing).toMatchObject({ rule: 'UNREGISTERED', late: false });
  });

  it('links a piece picked from the stock to an order holding one, which ships only then', async () => {
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '56'));
    const piece = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '56', material: '925 STERLING SILVER' }, f.admin);
    expect((await op.post('/api/admin/atelier/stock/adjust', { skuId: sku, locationId: france, delta: 1, note: 'Counted.' })).statusCode).toBe(200);
    const id = await salonOrder();
    await op.patch(`/api/admin/orders/${id}/terms`, { sizeLabel: '56', priceMinor: 480_000, currency: 'EUR' });
    expect((safeJson(await op.post(`/api/admin/orders/${id}/transition`, { to: 'PAID' })) as Json).order).toMatchObject({ status: 'PAID', reservation: 'STOCK', productId: null });
    // In stock, its piece not linked yet: it does not ship.
    const carrier = ((safeJson(await auditor.get('/api/admin/carriers')) as { items: Json[] }).items.find((c) => c.name === 'Colissimo'))!;
    const ship = { to: 'SHIPPED', carrierId: carrier.id, trackingNumber: '6A12345678902' };
    const unlinked = await op.post(`/api/admin/orders/${id}/transition`, ship);
    expect([unlinked.statusCode, errorOf(unlinked).code]).toEqual([409, 'ORDER_PIECE_NOT_LINKED']);
    expect(errorOf(await op.post(`/api/admin/orders/${id}/piece`, { productId: 'nope' })).code).toBe('VALIDATION_FAILED');
    const linked = safeJson(await op.post(`/api/admin/orders/${id}/piece`, { productId: piece.product.productId })) as Json;
    expect(linked.order).toMatchObject({ reservation: 'STOCK', productId: piece.product.productId });
    expect(linked.order.events.at(-1)).toMatchObject({ action: 'order.link' });
    expect((safeJson(await op.post(`/api/admin/orders/${id}/transition`, ship)) as Json).order).toMatchObject({ status: 'SHIPPED', productId: piece.product.productId });
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

  it('reads the stock, sets a minimum, confirms its suggestion; prints the work sheets (OPERATOR, each code\'s data, no-store); the CSV of what to make', async () => {
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '58'));
    expect((await op.request('PUT', '/api/admin/atelier/thresholds', { body: { skuId: sku, locationId: logistics, minimum: 2 } })).statusCode).toBe(204);
    const stock = safeJson(await auditor.get(`/api/admin/atelier/stock?locationId=${logistics}`)) as Json;
    expect(stock.rows.find((r: Json) => r.sku.id === sku)).toMatchObject({ onHand: 0, reserved: 0, available: 0, toMake: 0, minimum: 2, suggestion: 2 });
    const made = await op.post('/api/admin/atelier/make', { skuId: sku, locationId: logistics, quantity: 2 });
    expect(made.statusCode).toBe(201);
    const items = (safeJson(made) as { items: Json[] }).items;
    expect(items.map((b) => [b.status, b.origin, b.piece.status])).toEqual([
      ['TO_MAKE', { kind: 'STOCK' }, 'RESERVED'],
      ['TO_MAKE', { kind: 'STOCK' }, 'RESERVED'],
    ]);
    expect((safeJson(await auditor.get(`/api/admin/atelier/stock?locationId=${logistics}`)) as Json).rows.find((r: Json) => r.sku.id === sku)).toMatchObject({ toMake: 2, suggestion: 0 });
    // A count corrected at FRANCE, then two pieces moved to LOGISTICS (two movements, paired).
    expect(errorOf(await op.post('/api/admin/atelier/stock/adjust', { skuId: sku, locationId: france, delta: 3 })).code).toBe('VALIDATION_FAILED');
    expect(safeJson(await op.post('/api/admin/atelier/stock/adjust', { skuId: sku, locationId: france, delta: 3, note: 'Counted.' }))).toEqual({ onHand: 3, reserved: 0, available: 3 });
    const moved = safeJson(await op.post('/api/admin/atelier/stock/transfer', { skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 2, note: '' })) as Json;
    expect([moved.from, moved.to]).toEqual([
      { onHand: 1, reserved: 0, available: 1 },
      { onHand: 2, reserved: 0, available: 2 },
    ]);
    expect(errorOf(await op.post('/api/admin/atelier/stock/transfer', { skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 2 })).code).toBe('STOCK_NOT_AVAILABLE');

    expect((await auditor.post('/api/admin/atelier/sheets', { origin: 'STOCK', skuId: sku })).statusCode).toBe(403);
    const sheets = await op.post('/api/admin/atelier/sheets', { origin: 'STOCK', skuId: sku });
    expect(sheets.headers['cache-control']).toBe('no-store');
    const body = safeJson(sheets) as { printedAt: string; sheets: Json[] };
    expect(body.sheets.map((s) => s.reference)).toEqual(items.map((b) => b.piece.reference));
    expect(body.sheets[0]).toMatchObject({ sizeLabel: '58', location: 'LOGISTICS WAREHOUSE', order: null, code: { data: expect.stringMatching(/^[A-Za-z0-9_-]+$/), glyphs: expect.any(Array) } });
    expect(errorOf(await op.post('/api/admin/atelier/sheets', { benchItemIds: [items[0]!.id], origin: 'STOCK' })).code).toBe('VALIDATION_FAILED');
    // The bench never reads the data: the code is drawn only on a sheet.
    expect(JSON.stringify(safeJson(await op.get('/api/admin/atelier/bench?origin=STOCK')))).not.toContain(body.sheets[0]!.code.data);

    expect((safeJson(await op.post(`/api/admin/atelier/bench/${items[1]!.id}/cancel`, {})) as Json).status).toBe('CANCELLED');
    const csv = await auditor.get(`/api/admin/atelier/bench.csv?origin=STOCK&skuId=${sku}`);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8; header=present');
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename="ORBES-atelier-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = csv.body.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"FOR STOCK","MONOLITHE","58"`);
    expect(lines[1]).toContain(`"${items[0]!.piece.reference}","TO_MAKE"`);
    h.clock.advance(MINUTE);
  });
});
