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
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
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
});
