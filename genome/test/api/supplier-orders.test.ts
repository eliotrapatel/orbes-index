/**
 * The supplier orders over HTTP (plan NEXT LOT of 2026-10-07, §3.5.6.9, step 5.6; routes/admin/supplier-orders.ts): the
 * shapes of the proposal, a draft, a sent order and the list; the PDF (no-store, attached as ORBES-SO-….pdf); every
 * write guarded by CSRF; an AUDITOR reads and never writes; a LOGISTICS login never reaches one of them, so the agent
 * never reads a price (plan NEXT LOT §3.5.3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAccount } from '../support/live.js';
import { adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

type Json = Record<string, any>;

describe('supplier orders over HTTP (plan NEXT LOT §3.5.6.9)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let agent: Client;
  let admin: Actor;
  let france: string;
  let sku: string;
  let supplierId: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-08T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    agent = await adminClient(h, 'LOGISTICS', {}, { stockLocationIds: [france] });
    admin = { type: 'admin', id: (await h.t.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow()).id };
    sku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
    const created = safeJson(await operator.post('/api/admin/suppliers', { name: 'Maison Nord', currency: 'EUR', email: 'orders@nord.example', phone: '+33 1 00 00 00 01' })) as Json;
    supplierId = created.id;
    await operator.request('PUT', `/api/admin/models/${catalog.modelId}/supplier`, { body: { supplierId } });
    // Two orders waiting for supplier stock.
    for (let i = 0; i < 2; i++) {
      const account = await createAccount(h.ctx.db);
      const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
      await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
      const id = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
      await h.ctx.services.orders.setTerms(id, { sizeLabel: '52' }, admin);
    }
  });
  afterAll(() => h?.close());

  it('proposes, drafts, sends and lists, in the shapes the console reads; the PDF attached, never cached', async () => {
    const proposal = safeJson(await auditor.get('/api/admin/supplier-orders/proposal')) as Json;
    expect(proposal).toEqual({
      toOrder: 2,
      groups: [
        {
          supplier: { id: supplierId, name: 'Maison Nord' },
          location: { id: france, name: 'FRANCE WAREHOUSE' },
          draft: null,
          toOrder: 2,
          rows: [{ sku: { id: sku, code: expect.any(String), model: { id: catalog.modelId, name: 'MONOLITHE' }, addon: null, variant: null, sizeLabel: '52', setAside: false }, waiting: 2, underMinimum: 0, expected: 0, inDraft: 0, toOrder: 2 }],
        },
      ],
    });
    expect(errorOf(await auditor.post('/api/admin/supplier-orders/draft-lines', { skuId: sku, locationId: france, quantity: 2 })).code).toBe('FORBIDDEN');
    expect(errorOf(await operator.post('/api/admin/supplier-orders/draft-lines', { skuId: sku, locationId: france, quantity: 0 })).code).toBe('VALIDATION_FAILED');
    const draft = safeJson(await operator.post('/api/admin/supplier-orders/draft-lines', { skuId: sku, locationId: france, quantity: 2 })) as Json;
    expect(draft).toMatchObject({ reference: expect.stringMatching(/^SO-[0-9A-F]{8}$/), status: 'DRAFT', supplier: { id: supplierId, name: 'Maison Nord', active: true, currency: 'EUR' }, location: { id: france, name: 'FRANCE WAREHOUSE', address: null }, currency: 'EUR', lines: [{ quantity: 2, unitPriceMinor: null, lineTotalMinor: null, expected: 0, expectedElsewhere: 0 }], totalMinor: null });
    expect(JSON.stringify(draft)).not.toMatch(/orders@nord|\+33/);
    // A CSRF token on every write.
    const noCsrf = await operator.request('PATCH', `/api/admin/supplier-orders/${draft.id}`, { body: { expectedOn: '2026-11-02' }, noCsrf: true });
    expect(noCsrf.statusCode).toBe(403);
    expect(errorOf(await operator.patch(`/api/admin/supplier-orders/${draft.id}`, { currency: 'JPY' })).message).toBe('This currency is not supported: choose one with cents.');
    expect(errorOf(await operator.patch(`/api/admin/supplier-orders/${draft.id}`, {})).code).toBe('VALIDATION_FAILED');
    const edited = safeJson(await operator.patch(`/api/admin/supplier-orders/${draft.id}`, { lines: [{ skuId: sku, quantity: 2, unitPriceMinor: 12_000 }], expectedOn: '2026-11-02', shippingMinor: null, note: '' })) as Json;
    expect(edited).toMatchObject({ expectedOn: '2026-11-02', shippingMinor: null, note: null, linesTotalMinor: 24_000, totalMinor: 24_000 });
    const pdf = await auditor.get(`/api/admin/supplier-orders/${draft.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="ORBES-${draft.reference}.pdf"`);
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const sent = safeJson(await operator.post(`/api/admin/supplier-orders/${draft.id}/send`, {})) as Json;
    expect(sent).toMatchObject({ status: 'SENT', pieces: { ordered: 2, received: 0, expected: 2 } });
    expect(errorOf(await operator.patch(`/api/admin/supplier-orders/${draft.id}`, { note: 'Late.' }))).toEqual({ code: 'SUPPLIER_ORDER_NOT_DRAFT', message: 'A sent order no longer changes: cancel the rest, or start another order.' });
    expect((await operator.request('DELETE', `/api/admin/supplier-orders/${draft.id}`)).statusCode).toBe(409);
    expect(safeJson(await operator.post(`/api/admin/supplier-orders/${draft.id}/supplier-confirmed`, { expectedOn: '2026-11-03' }))).toMatchObject({ status: 'EXPECTED', expectedOn: '2026-11-03' });
    expect(safeJson(await operator.request('PUT', `/api/admin/supplier-orders/${draft.id}/invoice`, { body: { number: 'F-1', amountMinor: 24_000, date: '2026-11-04' } }))).toMatchObject({ invoice: { number: 'F-1', amountMinor: 24_000, date: '2026-11-04', paidAt: null } });
    expect((safeJson(await operator.post(`/api/admin/supplier-orders/${draft.id}/invoice/paid`, {})) as Json).invoice.paidAt).toBe(h.clock.now().toISOString());
    const list = safeJson(await auditor.get(`/api/admin/supplier-orders?supplierId=${supplierId}`)) as Json;
    expect(list.items).toEqual([
      {
        id: draft.id,
        reference: draft.reference,
        status: 'EXPECTED',
        supplier: { id: supplierId, name: 'Maison Nord' },
        location: { id: france, name: 'FRANCE WAREHOUSE' },
        pieces: { ordered: 2, received: 0 },
        currency: 'EUR',
        totalMinor: 24_000,
        expectedOn: '2026-11-03',
        invoice: { number: 'F-1', paid: true },
        createdAt: expect.any(String),
      },
    ]);
    expect((safeJson(await auditor.get('/api/admin/supplier-orders?status=DRAFT')) as Json).items).toEqual([]);
    expect(errorOf(await auditor.get('/api/admin/supplier-orders?status=LOST')).code).toBe('VALIDATION_FAILED');
    expect((await auditor.get('/api/admin/supplier-orders/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    // Sent and expected: the proposal subtracts it.
    expect((safeJson(await auditor.get('/api/admin/supplier-orders/proposal')) as Json).groups[0].rows[0]).toMatchObject({ waiting: 2, expected: 2, toOrder: 0 });
    // The rest cancelled, with its note.
    expect(errorOf(await operator.post(`/api/admin/supplier-orders/${draft.id}/cancel-rest`, {})).code).toBe('VALIDATION_FAILED');
    expect(safeJson(await operator.post(`/api/admin/supplier-orders/${draft.id}/cancel-rest`, { note: 'Stopped.' }))).toMatchObject({ status: 'CANCELLED', restCancelled: { note: 'Stopped.' } });
    expect(errorOf(await operator.post(`/api/admin/supplier-returns/00000000-0000-4000-8000-000000000000/settle`, { settlement: 'REPLACEMENT' })).code).toBe('SUPPLIER_RETURN_NOT_FOUND');
    expect(errorOf(await operator.post(`/api/admin/supplier-returns/00000000-0000-4000-8000-000000000000/settle`, { settlement: 'CREDIT' })).code).toBe('VALIDATION_FAILED');
  });

  it('ORDER A MODEL (plan MACRO M3 §3.2, Z1, Z2): the split proposed to an OPERATOR in counts only, its lines added to the drafts; a location\'s countries set by an ADMIN', async () => {
    const logistics = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'LOGISTICS WAREHOUSE').executeTakeFirstOrThrow()).id;
    const body = { modelId: catalog.modelId, quantity: 5 };
    expect(errorOf(await auditor.post('/api/admin/supplier-orders/split', body)).code).toBe('FORBIDDEN');
    expect((await agent.post('/api/admin/supplier-orders/split', body)).statusCode).toBe(403);
    expect(errorOf(await operator.post('/api/admin/supplier-orders/split', { ...body, quantity: 10_001 })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await operator.post('/api/admin/supplier-orders/split', { ...body, locationIds: [] })).code).toBe('VALIDATION_FAILED');
    const res = await operator.post('/api/admin/supplier-orders/split', body);
    expect(res.statusCode).toBe(200);
    const split = safeJson(res) as Json;
    // MONOLITHE has no size kind: its two orders waiting at FRANCE, no saved size.
    expect(split).toEqual({
      model: { id: catalog.modelId, name: 'MONOLITHE', variant: null },
      sizeKind: null,
      quantity: 5,
      locations: [
        { id: france, name: 'FRANCE WAREHOUSE', isDefault: true },
        { id: logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false },
      ],
      lines: [
        { sku: { id: sku, code: expect.any(String), sizeLabel: '52' }, location: { id: france, name: 'FRANCE WAREHOUSE' }, orders: 2, savedSizes: 0, proposed: 5 },
        { sku: { id: sku, code: expect.any(String), sizeLabel: '52' }, location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, orders: 0, savedSizes: 0, proposed: 0 },
      ],
      totals: { orders: 2, savedSizes: 0, proposed: 5 },
      unmatched: 0,
      source: 'DATA',
    });
    for (const a of await h.t.db.selectFrom('accounts').select('id').execute()) expect(res.body).not.toContain(a.id);

    const drafts = { lines: [{ skuId: sku, locationId: logistics, quantity: 3 }] };
    expect(errorOf(await auditor.post('/api/admin/supplier-orders/split/drafts', drafts)).code).toBe('FORBIDDEN');
    expect(errorOf(await operator.post('/api/admin/supplier-orders/split/drafts', { lines: [] })).code).toBe('VALIDATION_FAILED');
    const added = safeJson(await operator.post('/api/admin/supplier-orders/split/drafts', drafts)) as Json;
    expect(added).toEqual({
      drafts: [{ id: expect.any(String), reference: expect.stringMatching(/^SO-[0-9A-F]{8}$/), supplier: { id: supplierId, name: 'Maison Nord' }, location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, lines: 1, pieces: 3 }],
      pieces: 3,
    });
    expect(safeJson(await auditor.get(`/api/admin/supplier-orders/${added.drafts[0].id}`))).toMatchObject({ status: 'DRAFT', lines: [{ sku: { id: sku }, quantity: 3 }] });

    // A location's countries: an ADMIN's, read by every role with the locations.
    const boss = await adminClient(h, 'ADMIN');
    expect(errorOf(await operator.request('PUT', `/api/admin/locations/${logistics}/countries`, { body: { countries: ['GB'] } })).code).toBe('FORBIDDEN');
    expect(errorOf(await boss.request('PUT', `/api/admin/locations/${logistics}/countries`, { body: { countries: ['XX'] } })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await boss.request('PUT', `/api/admin/locations/${logistics}/countries`, { body: {} })).code).toBe('VALIDATION_FAILED');
    expect(safeJson(await boss.request('PUT', `/api/admin/locations/${france}/countries`, { body: { countries: ['GB', 'FR'] } }))).toMatchObject({ location: { id: france, countries: ['FR', 'GB'] }, moved: [] });
    expect(safeJson(await boss.request('PUT', `/api/admin/locations/${logistics}/countries`, { body: { countries: ['gb'] } }))).toEqual({
      location: { id: logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false, shopifyLocationId: null, address: null, countries: ['GB'] },
      moved: [{ country: 'GB', from: { id: france, name: 'FRANCE WAREHOUSE' } }],
    });
    expect((safeJson(await auditor.get('/api/admin/locations')) as { items: Json[] }).items.map((l) => [l.name, l.countries])).toEqual([
      ['FRANCE WAREHOUSE', ['FR']],
      ['LOGISTICS WAREHOUSE', ['GB']],
    ]);
  });

  it('never lets a LOGISTICS login read a supplier order, a proposal, a PDF or a price', async () => {
    const order = (await h.t.db.selectFrom('supplier_orders').select('id').executeTakeFirstOrThrow()).id;
    for (const url of ['/api/admin/supplier-orders', '/api/admin/supplier-orders/proposal', `/api/admin/supplier-orders/${order}`, `/api/admin/supplier-orders/${order}/pdf`, '/api/admin/suppliers']) {
      const res = await agent.get(url);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('FORBIDDEN');
    }
    expect((await agent.post('/api/admin/supplier-orders/draft-lines', { skuId: sku, locationId: france, quantity: 1 })).statusCode).toBe(403);
  });
});
