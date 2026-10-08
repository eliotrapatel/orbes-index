/**
 * Logistics over HTTP (plan NEXT LOT of 2026-10-07, §3.5.6.9; routes/admin/locations.ts and routes/admin/logistics.ts),
 * built in halves: the location's address (step 5.6), the receptions and their cards (step 5.7), the stock (step 5.8),
 * the packing (step 5.9).
 *
 *  - a location's postal address, entered by an ADMIN (an OPERATOR 403), line breaks kept, cleared with null, read by an
 *    AUDITOR, never by a LOGISTICS login; audited `stock.location.update` with `fields: ['address']`, never its words.
 *  - the receptions (step 5.7): the agent finds its supplier order by the reference only and reads its lines without a
 *    price, counts, counts again; an AUDITOR reads the board, never counts; ORBES staff see the orders on their way,
 *    never the agent; an OPERATOR sends back and confirms; the cards come as a PDF, no-store, the skipped pieces in a
 *    header; Cards attached; the rejected pieces sent back; another location's rows 404.
 *  - the stock (step 5.8): the agent's rows of its locations without expected, to order nor NO PIECE, ORBES staff's
 *    with them; a correction proposed by the agent (201), approved by an OPERATOR only; pieces counted in by an
 *    OPERATOR; a minimum (204); a transfer.
 *  - the packing (step 5.9): the agent's orders to ship (no price, email, account nor release), Start packing refused
 *    without an address, the photo's upload (an image body only: 415 otherwise; bytes that are no photo 422), the photo
 *    read no-store by the agent and AUDITOR+, never RETAIL; Ship refused from the agent with a declared value (403);
 *    the scan drawing from the `verify` rate group, as /api/v1/verify.
 *  - the order cases (step 5.10): the agent reports a parcel problem and records it back; an AUDITOR reads the case
 *    without its note; ORBES decides it, no-store; Client Services opens a return (201).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { jpegPhoto } from '../support/images.js';
import { createAccount } from '../support/live.js';
import { packAndShip, stockPieces } from '../support/fulfil.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, seedCatalog, type Client, type Harness } from './support.js';

type Json = Record<string, any>;

describe('Logistics over HTTP (plan NEXT LOT §3.5.6.9)', () => {
  let h: Harness;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  let agent: Client;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-08T09:00:00.000Z');
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    logistics = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'LOGISTICS WAREHOUSE').executeTakeFirstOrThrow()).id;
    agent = await adminClient(h, 'LOGISTICS', {}, { stockLocationIds: [logistics] });
  });
  afterAll(() => h?.close());

  describe('a location\'s address (step 5.6)', () => {
    it('is entered by an ADMIN, its lines kept, read by an AUDITOR, cleared; never an OPERATOR\'s nor the agent\'s; audited without its words', async () => {
      const address = '12 rue des Entrepôts\r\n93200 Saint-Denis\nFrance';
      expect(errorOf(await operator.patch(`/api/admin/locations/${logistics}`, { address })).code).toBe('FORBIDDEN');
      expect(errorOf(await admin.patch(`/api/admin/locations/${logistics}`, { address: 'x'.repeat(501) })).code).toBe('VALIDATION_FAILED');
      expect(errorOf(await admin.patch(`/api/admin/locations/${logistics}`, { address: 'A\u0007B' })).code).toBe('VALIDATION_FAILED');
      const set = safeJson(await admin.patch(`/api/admin/locations/${logistics}`, { address })) as Json;
      expect(set).toEqual({ id: logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false, shopifyLocationId: null, address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' });
      const read = (safeJson(await auditor.get('/api/admin/locations')) as { items: Json[] }).items.find((l) => l.id === logistics)!;
      expect(read.address).toBe('12 rue des Entrepôts\n93200 Saint-Denis\nFrance');
      expect(errorOf(await agent.get('/api/admin/locations')).code).toBe('FORBIDDEN');
      // The same address again changes nothing; cleared with null.
      expect(errorOf(await admin.patch(`/api/admin/locations/${logistics}`, { address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' })).code).toBe('VALIDATION_FAILED');
      expect((safeJson(await admin.patch(`/api/admin/locations/${logistics}`, { address: null })) as Json).address).toBeNull();
      // A location added with its address.
      const added = safeJson(await admin.post('/api/admin/locations', { name: 'NORTH HUB', address: '1 Quay Street\nLeith' })) as Json;
      expect(added).toMatchObject({ name: 'NORTH HUB', address: '1 Quay Street\nLeith' });
      const audits = await h.t.db.selectFrom('audit_logs').select(['action', 'target_id', 'details']).where('action', 'in', ['stock.location.update', 'stock.location.create']).orderBy('id').execute();
      expect(audits.map((a) => [a.action, a.details])).toEqual([
        ['stock.location.update', { fields: ['address'] }],
        ['stock.location.update', { fields: ['address'] }],
        ['stock.location.create', { name: 'NORTH HUB', fields: ['address'] }],
      ]);
      expect(JSON.stringify(audits)).not.toMatch(/Entrep|Saint-Denis|Quay/);
    });
  });
  describe('the receptions (step 5.7)', () => {
    it('lets the agent find its order by reference, count and count again; ORBES confirms; the cards as a PDF, no-store; Cards attached; the rejected pieces sent back; never a price for the agent', { timeout: 60_000 }, async () => {
      const catalog = await seedCatalog(h.ctx);
      const staff: Actor = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
      const nord = await h.ctx.services.suppliers.create({ name: 'Maison Nord', currency: 'EUR' }, staff);
      await h.ctx.services.suppliers.setModelSupplier(catalog.modelId, { supplierId: nord.id }, staff);
      const k52 = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
      const draft = await h.ctx.services.supplierOrders.addToDraft({ skuId: k52, locationId: logistics, quantity: 3 }, staff);
      await h.ctx.services.supplierOrders.updateDraft(draft.id, { lines: [{ skuId: k52, quantity: 3, unitPriceMinor: 12_000 }], expectedOn: '2026-11-02' }, staff);
      const order = await h.ctx.services.supplierOrders.send(draft.id, staff);

      // The way in: the reference only; the lines without a price.
      const found = safeJson(await agent.get(`/api/admin/logistics/receptions/supplier-order?reference=${order.reference.toLowerCase()}`)) as Json;
      expect(found).toMatchObject({ id: order.id, reference: order.reference, supplierName: 'Maison Nord', location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, expectedOn: '2026-11-02' });
      expect(found.lines).toEqual([{ lineId: expect.any(String), sku: expect.objectContaining({ id: k52, sizeLabel: '52', model: { id: catalog.modelId, name: 'MONOLITHE' } }), ordered: 3, alreadyReceived: 0, expected: 3 }]);
      expect(JSON.stringify(found)).not.toMatch(/price|Minor|currency|total/i);
      const missing = await agent.get('/api/admin/logistics/receptions/supplier-order?reference=SO-00000000');
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing)).toEqual({ code: 'SUPPLIER_ORDER_NOT_FOUND', message: 'No supplier order SO-00000000 is expected here. Check the reference, or ask ORBES.' });
      expect((safeJson(await agent.get(`/api/admin/logistics/receptions/lines/${order.id}`)) as Json).lines).toHaveLength(1);
      // The board: ORBES staff see the order on its way, the agent never.
      const staffBoard = safeJson(await auditor.get(`/api/admin/logistics/receptions?locationId=${logistics}`)) as Json;
      expect(staffBoard.expected).toContainEqual({ id: order.id, reference: order.reference, supplierName: 'Maison Nord', location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, expectedOn: '2026-11-02', piecesExpected: 3 });
      expect(Object.keys(safeJson(await agent.get('/api/admin/logistics/receptions')) as Json).sort()).toEqual(['backToSupplier', 'cardsToPrint', 'count', 'toConfirm']);

      // The count: 201; an AUDITOR never counts; counted again.
      expect(errorOf(await auditor.post('/api/admin/logistics/receptions', { supplierOrderId: order.id, lines: [] })).code).toBe('FORBIDDEN');
      expect(errorOf(await agent.post('/api/admin/logistics/receptions', { supplierOrderId: order.id, lines: [{ skuId: k52, accepted: 0, rejected: 0 }] })).code).toBe('RECEPTION_EMPTY');
      const created = await agent.post('/api/admin/logistics/receptions', { supplierOrderId: order.id, lines: [{ skuId: k52, accepted: 3, rejected: 0 }], deliveryNote: 'BL-2210', note: '' });
      expect(created.statusCode).toBe(201);
      const r = safeJson(created) as Json;
      expect(r).toMatchObject({ status: 'TO_CONFIRM', supplierOrder: { id: order.id, reference: order.reference }, supplierName: null, deliveryNote: 'BL-2210', note: null, accepted: 3, rejected: 0 });
      expect(errorOf(await agent.post('/api/admin/logistics/receptions', { supplierOrderId: order.id, lines: [{ skuId: k52, accepted: 1, rejected: 0 }] })).code).toBe('RECEPTION_OPEN');
      const again = safeJson(await agent.request('PUT', `/api/admin/logistics/receptions/${r.id}`, { body: { lines: [{ skuId: k52, accepted: 2, rejected: 1 }] } })) as Json;
      expect(again).toMatchObject({ status: 'TO_CONFIRM', accepted: 2, rejected: 1 });
      expect((safeJson(await auditor.get(`/api/admin/logistics/receptions/${r.id}`)) as Json).supplierName).toBe('Maison Nord');
      // Sent back and confirmed by an OPERATOR only.
      expect(errorOf(await agent.post(`/api/admin/logistics/receptions/${r.id}/confirm`)).code).toBe('FORBIDDEN');
      expect((safeJson(await operator.post(`/api/admin/logistics/receptions/${r.id}/send-back`, { note: 'Count again.' })) as Json).status).toBe('SENT_BACK');
      await agent.request('PUT', `/api/admin/logistics/receptions/${r.id}`, { body: { lines: [{ skuId: k52, accepted: 2, rejected: 1 }] } });
      expect((safeJson(await operator.post(`/api/admin/logistics/receptions/${r.id}/confirm`)) as Json)).toMatchObject({ status: 'CONFIRMED', issuing: { issued: 0, accepted: 2, done: false } });
      const issuing = await agent.post(`/api/admin/logistics/receptions/${r.id}/cards`, { layout: 'sheet' });
      expect(issuing.statusCode).toBe(409);
      expect(errorOf(issuing).code).toBe('RECEPTION_ISSUING');
      expect(await h.ctx.services.receptions.issuePending()).toBe(2);

      // The cards: a PDF, no-store; nothing skipped.
      const cards = await agent.post(`/api/admin/logistics/receptions/${r.id}/cards`, { layout: 'sheet', run: 1 });
      expect(cards.statusCode).toBe(200);
      expect(cards.headers['content-type']).toBe('application/pdf');
      expect(cards.headers['cache-control']).toBe('no-store');
      expect(cards.headers['x-orbes-cards-printed']).toBe('2');
      expect(cards.headers['x-orbes-cards-skipped']).toBeUndefined();
      expect(cards.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const otherAgent = await adminClient(h, 'LOGISTICS', {}, { stockLocationIds: [(await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id] });
      expect((await otherAgent.post(`/api/admin/logistics/receptions/${r.id}/cards`, { layout: 'sheet' })).statusCode).toBe(404);
      expect((await otherAgent.get(`/api/admin/logistics/receptions/${r.id}`)).statusCode).toBe(404);
      const attached = safeJson(await agent.post(`/api/admin/logistics/receptions/${r.id}/cards-attached`)) as Json;
      expect(attached.cards).toMatchObject({ sealed: 0, erased: { ATTACHED: 2 } });
      expect(errorOf(await agent.post(`/api/admin/logistics/receptions/${r.id}/cards`, { layout: 'card' })).code).toBe('CARDS_ATTACHED');

      // The rejected piece, sent back by the agent.
      const board = safeJson(await agent.get('/api/admin/logistics/receptions')) as Json;
      const ret = (board.backToSupplier as Json[]).find((x) => x.supplierOrder.id === order.id)!;
      expect(ret).toMatchObject({ quantity: 1, status: 'TO_RETURN', sku: { id: k52 } });
      expect(errorOf(await auditor.post(`/api/admin/logistics/supplier-returns/${ret.id}/sent`, {})).code).toBe('FORBIDDEN');
      expect((safeJson(await agent.post(`/api/admin/logistics/supplier-returns/${ret.id}/sent`, {})) as Json).status).toBe('RETURNED');
      expect(JSON.stringify(board)).not.toMatch(/price|Minor|Maison Nord/i);
    });
  });
  describe('the stock (step 5.8)', () => {
    it('gives the agent its locations without expected, to order nor NO PIECE; takes its correction for an OPERATOR to approve; counts pieces in; sets a minimum; transfers', async () => {
      const catalog = await seedCatalog(h.ctx);
      const sku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '54'));
      const mine = safeJson(await agent.get(`/api/admin/logistics/stock?modelId=${catalog.modelId}`)) as Json;
      expect(mine.rows.map((r: Json) => [r.sku.sizeLabel, r.location.name])).toEqual([['54', 'LOGISTICS WAREHOUSE']]);
      expect(Object.keys(mine.rows[0]).sort()).toEqual(['available', 'location', 'minimum', 'onHand', 'reserved', 'sku', 'waiting']);
      expect(Object.keys(mine).sort()).toEqual(['locations', 'rows', 'skus']);
      const france = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
      expect(errorOf(await agent.get(`/api/admin/logistics/stock?locationId=${france}`)).code).toBe('STOCK_LOCATION_NOT_FOUND');
      const staff = safeJson(await auditor.get(`/api/admin/logistics/stock?modelId=${catalog.modelId}`)) as Json;
      expect(staff.rows.map((r: Json) => r.location.name)).toEqual(['FRANCE WAREHOUSE', 'LOGISTICS WAREHOUSE', 'NORTH HUB']);
      expect(staff.rows[0]).toMatchObject({ expected: 0, toOrder: 0, unbacked: 0 });
      // A piece counted in by an OPERATOR, then the agent's correction up approved by an OPERATOR.
      const made = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: catalog.modelId, material: '925 STERLING SILVER', variant: '54' }, SYSTEM_ACTOR);
      expect(errorOf(await agent.post('/api/admin/logistics/count-in', { skuId: sku, productIds: [made.product.productId], note: 'On the shelf.' })).code).toBe('FORBIDDEN');
      expect(safeJson(await operator.post('/api/admin/logistics/count-in', { skuId: sku, productIds: [made.product.productId], note: 'On the shelf.' }))).toEqual({ skuId: sku, productIds: [made.product.productId], unbacked: 0 });
      const proposed = await agent.post('/api/admin/logistics/corrections', { skuId: sku, locationId: logistics, delta: 1, reason: 'Found on the shelf.' });
      expect(proposed.statusCode).toBe(201);
      const c = safeJson(proposed) as Json;
      expect(c).toMatchObject({ status: 'TO_APPROVE', delta: 1, sku: { id: sku }, location: { id: logistics } });
      expect((safeJson(await agent.get('/api/admin/logistics/corrections')) as Json).toApprove).toBe(1);
      expect(errorOf(await agent.post(`/api/admin/logistics/corrections/${c.id}/approve`)).code).toBe('FORBIDDEN');
      expect((safeJson(await operator.post(`/api/admin/logistics/corrections/${c.id}/approve`)) as Json).status).toBe('APPROVED');
      expect(errorOf(await operator.post(`/api/admin/logistics/corrections/${c.id}/decline`, { note: 'No.' })).code).toBe('CORRECTION_NOT_PENDING');
      // A minimum, then a transfer.
      expect((await operator.request('PUT', '/api/admin/logistics/minimums', { body: { skuId: sku, locationId: logistics, minimum: 2 } })).statusCode).toBe(204);
      const moved = safeJson(await operator.post('/api/admin/logistics/transfers', { skuId: sku, fromLocationId: logistics, toLocationId: france, quantity: 1 })) as Json;
      expect(moved).toMatchObject({ from: { onHand: 0 }, to: { onHand: 1 } });
      expect((safeJson(await agent.get(`/api/admin/logistics/stock?modelId=${catalog.modelId}`)) as Json).rows[0]).toMatchObject({ onHand: 0, minimum: 2 });
    });
  });
  describe('the packing (step 5.9)', () => {
    it('lists the agent\'s orders to ship without a price, packs them with the photo as an image body, reads the photo no-store, refuses the agent a declared value', async () => {
      const catalog = await seedCatalog(h.ctx);
      const sku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '56'));
      const ops = { type: 'admin' as const, id: (await createAdmin(h.ctx, 'OPERATOR')).id };
      const account = await createAccount(h.t.db);
      const request = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
      await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, ops);
      const id = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
      await h.ctx.services.orders.setTerms(id, { sizeLabel: '56', priceMinor: 420_000, currency: 'EUR' }, ops);
      await h.ctx.services.orders.changeLocation(id, logistics, ops);
      h.clock.advance(60_000);
      await h.ctx.services.orders.transition(id, { to: 'PAID' }, ops);
      const [piece] = await stockPieces(h.ctx, { skuId: sku, locationId: logistics, count: 1, forOrderIds: [id] }, ops);
      const board = safeJson(await agent.get('/api/admin/logistics/orders')) as Json;
      expect(board.toShip.map((r: Json) => r.id)).toContain(id);
      expect(board.locations.map((l: Json) => l.name)).toEqual(['LOGISTICS WAREHOUSE']);
      for (const word of ['price', 'Minor', 'email', 'account', 'release']) expect(JSON.stringify(board)).not.toContain(word);
      expect(errorOf(await agent.post(`/api/admin/logistics/orders/${id}/packing`)).code).toBe('ORDER_ADDRESS_MISSING');
      await operator.request('PUT', `/api/admin/orders/${id}/buyer`, { body: { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris' } });
      expect(errorOf(await auditor.post(`/api/admin/logistics/orders/${id}/packing`)).code).toBe('FORBIDDEN');
      const started = safeJson(await agent.post(`/api/admin/logistics/orders/${id}/packing`)) as Json;
      expect(started).toMatchObject({ step: 'PACKING', shipTo: { name: 'Ada Martin' }, carriers: expect.arrayContaining([expect.objectContaining({ name: 'Colissimo' })]) });
      for (const word of ['price', 'Minor', 'email', 'account', 'release']) expect(JSON.stringify(started)).not.toContain(word);
      expect((await agent.post(`/api/admin/logistics/orders/${id}/packing/scan`, { code: piece!.data })).statusCode).toBe(200);
      // The photo: an image body only.
      const url = `/api/admin/logistics/orders/${id}/packing/photo`;
      const json = await agent.request('PUT', url, { body: { photo: 'x' } });
      expect([json.statusCode, errorOf(json).code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
      const png = await agent.request('PUT', url, { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), headers: { 'content-type': 'image/png' } });
      expect([png.statusCode, errorOf(png).code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
      const garbage = await agent.request('PUT', url, { body: Buffer.from('not a photo at all'), headers: { 'content-type': 'image/jpeg' } });
      expect([garbage.statusCode, errorOf(garbage).code]).toEqual([422, 'PACKING_PHOTO_INVALID']);
      const put = await agent.request('PUT', url, { body: Buffer.from(jpegPhoto(16, 12)), headers: { 'content-type': 'image/jpeg' } });
      expect(put.statusCode).toBe(200);
      const shipmentId = (safeJson(put) as Json).shipment.id;
      for (const c of [agent, auditor]) {
        const res = await c.get(`/api/admin/logistics/shipments/${shipmentId}/photo`);
        expect([res.statusCode, res.headers['content-type'], res.headers['cache-control']]).toEqual([200, 'image/jpeg', 'no-store']);
      }
      const retail = await adminClient(h, 'RETAIL');
      expect(errorOf(await retail.get(`/api/admin/logistics/shipments/${shipmentId}/photo`)).code).toBe('FORBIDDEN');
      const keys = (safeJson(put) as Json).checklist.filter((l: Json) => !l.byScan).map((l: Json) => l.key);
      expect((safeJson(await agent.post(`/api/admin/logistics/orders/${id}/packing/check`, { ticked: keys })) as Json).step).toBe('PACKED');
      const colissimo = started.carriers.find((c: Json) => c.name === 'Colissimo').id;
      const priced = await agent.post(`/api/admin/logistics/orders/${id}/ship`, { carrierId: colissimo, trackingNumber: '6A12345678901', declaredValues: [{ orderId: id, minor: 420_000 }] });
      expect([priced.statusCode, errorOf(priced).code]).toEqual([403, 'FORBIDDEN']);
      expect((safeJson(await agent.post(`/api/admin/logistics/orders/${id}/ship`, { carrierId: colissimo, trackingNumber: '6A12345678901' })) as Json).step).toBe('SHIPPED');
      expect((safeJson(await agent.post(`/api/admin/logistics/orders/${id}/delivered`)) as Json).step).toBe('DELIVERED');
    });

    it('draws the packing scan from the verify rate group, as /api/v1/verify', async () => {
      const limited = await createHarness({ config: { rateLimits: { verifyPerMinute: 2 } } });
      try {
        const c = await adminClient(limited, 'OPERATOR');
        const scan = () => c.post(`/api/admin/logistics/orders/${randomUUID()}/packing/scan`, { code: 'AAAA' });
        expect((await scan()).statusCode).toBe(404);
        expect((await scan()).statusCode).toBe(404);
        expect((await scan()).statusCode).toBe(429);
        // The verify budget, not the console's: the console's other routes still answer.
        expect((await c.get('/api/admin/logistics/orders')).statusCode).toBe(200);
      } finally {
        await limited.close();
      }
    });
  });
  describe('the order cases (step 5.10)', () => {
    it('lets the agent report a parcel back to sender and record it; an AUDITOR reads it without any of its notes; an OPERATOR decides it, no-store; Client Services opens a return', async () => {
      const catalog = await seedCatalog(h.ctx);
      const sku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '58'));
      const ops = { type: 'admin' as const, id: (await createAdmin(h.ctx, 'OPERATOR')).id };
      const account = await createAccount(h.t.db);
      const request = await h.t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
      await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, ops);
      const id = (await h.t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
      await h.ctx.services.orders.setTerms(id, { sizeLabel: '58', priceMinor: 420_000, currency: 'EUR' }, ops);
      await h.ctx.services.orders.changeLocation(id, logistics, ops);
      h.clock.advance(60_000);
      await h.ctx.services.orders.transition(id, { to: 'PAID' }, ops);
      await stockPieces(h.ctx, { skuId: sku, locationId: logistics, count: 1, forOrderIds: [id] }, ops);
      const colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
      await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, ops);
      const reported = await agent.post(`/api/admin/logistics/orders/${id}/order-case`, { kind: 'BACK_TO_SENDER', note: 'Address unknown.' });
      expect(reported.statusCode).toBe(201);
      const c = safeJson(reported) as Json;
      expect((safeJson(await agent.get('/api/admin/logistics/order-cases')) as Json).items.map((i: Json) => [i.id, i.kind])).toEqual([[c.id, 'BACK_TO_SENDER']]);
      expect(errorOf(await auditor.post(`/api/admin/logistics/order-cases/${c.id}/received`, { pieceState: 'OK' })).code).toBe('FORBIDDEN');
      expect((safeJson(await agent.post(`/api/admin/logistics/order-cases/${c.id}/received`, { pieceState: 'OK', note: 'The box is intact.' })) as Json).status).toBe('RECEIVED');
      expect(errorOf(await agent.get(`/api/admin/order-cases/${c.id}`)).code).toBe('FORBIDDEN');
      expect((safeJson(await auditor.get(`/api/admin/order-cases/${c.id}`)) as Json).note).toBeNull();
      expect((safeJson(await operator.get(`/api/admin/order-cases/${c.id}`)) as Json).note).toBe('Address unknown.');
      const decided = await operator.post(`/api/admin/order-cases/${c.id}/decide`, { decision: 'RESHIP', note: 'Shipped again to the corrected address.' });
      expect([decided.statusCode, decided.headers['cache-control']]).toEqual([200, 'no-store']);
      expect((safeJson(decided) as Json).case.status).toBe('CLOSED');
      // Every note of the case withheld from an AUDITOR: the opening one, the agent's and ORBES's decision's.
      const read = safeJson(await auditor.get(`/api/admin/order-cases/${c.id}`)) as Json;
      expect([read.note, read.received.note, read.decision.note, read.received.pieceState, read.decision.outcome]).toEqual([null, null, null, 'OK', 'RESHIP']);
      const full = safeJson(await operator.get(`/api/admin/order-cases/${c.id}`)) as Json;
      expect([full.note, full.received.note, full.decision.note]).toEqual(['Address unknown.', 'The box is intact.', 'Shipped again to the corrected address.']);
      // Packed and shipped again, delivered, then a return opened by Client Services.
      await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A00000000002' }, ops);
      await agent.post(`/api/admin/logistics/orders/${id}/delivered`);
      expect(errorOf(await auditor.post(`/api/admin/orders/${id}/case`, { kind: 'RETURN', reason: 'SIZE', note: 'Too small.' })).code).toBe('FORBIDDEN');
      const opened = await operator.post(`/api/admin/orders/${id}/case`, { kind: 'RETURN', reason: 'SIZE', note: 'Too small.' });
      expect(opened.statusCode).toBe(201);
      expect(safeJson(opened)).toMatchObject({ kind: 'RETURN', status: 'OPEN', reason: 'SIZE', note: 'Too small.' });
      expect(errorOf(await operator.post(`/api/admin/orders/${id}/case`, { kind: 'EXCHANGE', reason: 'SIZE', note: 'No size named.' })).code).toBe('VALIDATION_FAILED');
      // Cancelled with a note quoting the client: withheld from an AUDITOR too.
      const returnId = (safeJson(opened) as Json).id;
      expect((safeJson(await operator.post(`/api/admin/order-cases/${returnId}/cancel`, { note: 'The client wrote: I keep it.' })) as Json).cancelled.note).toBe('The client wrote: I keep it.');
      const cancelled = safeJson(await auditor.get(`/api/admin/order-cases/${returnId}`)) as Json;
      expect([cancelled.status, cancelled.note, cancelled.cancelled.note]).toEqual(['CANCELLED', null, null]);
    });
  });
});
