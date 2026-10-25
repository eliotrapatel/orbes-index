/**
 * The add-ons' catalogue over HTTP (macro scope of 2026-10-20, K48 D1; plan MACRO M3 §4.2, step M3.9;
 * routes/admin/addons.ts): an AUDITOR reads the list and one add-on, an OPERATOR lists, changes, prices, sets aside,
 * reinstates and links an add-on to Shopify, as the models; an AUDITOR and a LOGISTICS login are refused the writes,
 * LOGISTICS the reads too; the bodies are strict, and the service's refusals answer as it says (test/services/
 * addons.test.ts holds the service).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

/** A PUT with its body (the harness's client has no shorthand for it). */
const put = (c: Client, url: string, body: unknown) => c.request('PUT', url, { body });

interface Addon {
  id: string;
  name: string;
  active: boolean;
  sku: { id: string; code: string; shopifyVariantId: string | null };
  shopifyProductId: string | null;
  prices: { currency: string; priceMinor: number }[];
}

describe('the add-ons\' routes (plan MACRO M3 §4.2, D1)', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let agent: Client;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    agent = await adminClient(h, 'LOGISTICS');
  });
  afterAll(() => h?.close());

  it('an OPERATOR lists, changes, prices, sets aside, reinstates and links an add-on; an AUDITOR reads; the writes refused to an AUDITOR and LOGISTICS', async () => {
    const created = await operator.post('/api/admin/addons', { name: 'Polishing Cloth', line: '', skuCode: 'add-cloth', weightG: 20, prices: { EUR: 1500, CHF: null } });
    expect(created.statusCode, created.body).toBe(201);
    const a = safeJson(created) as Addon;
    expect(a).toMatchObject({ name: 'Polishing Cloth', active: true, sku: { code: 'ADD-CLOTH' }, prices: [{ currency: 'EUR', priceMinor: 1500 }] });
    expect(errorOf(await operator.post('/api/admin/addons', { name: 'polishing cloth', skuCode: 'ADD-OTHER' }))).toEqual({ code: 'ADDON_NAME_TAKEN', message: 'Another add-on has this name.' });
    expect(errorOf(await operator.post('/api/admin/addons', { name: 'Care Kit', skuCode: 'ADD-CLOTH' }))).toEqual({ code: 'SKU_CODE_TAKEN', message: 'Another SKU has this code.' });
    // Strict bodies: an unknown field, a price in a currency the house does not sell in, a fraction, a missing code.
    for (const bad of [
      { name: 'Care Kit', skuCode: 'ADD-KIT', active: false },
      { name: 'Care Kit', skuCode: 'ADD-KIT', prices: { JPY: 100 } },
      { name: 'Care Kit', skuCode: 'ADD-KIT', weightG: 1.5 },
      { name: 'Care Kit' },
    ]) {
      expect(errorOf(await operator.post('/api/admin/addons', bad)).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }

    const patched = await operator.patch(`/api/admin/addons/${a.id}`, { line: 'Microfibre.', position: 3 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(safeJson(patched)).toMatchObject({ line: 'Microfibre.', position: 3 });
    expect(errorOf(await operator.patch(`/api/admin/addons/${a.id}`, {})).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await operator.patch(`/api/admin/addons/${a.id}`, { skuCode: 'ADD-NEW' })).code).toBe('VALIDATION_FAILED');

    const priced = await put(operator, `/api/admin/addons/${a.id}/prices`, { prices: { EUR: null, USD: 1800 } });
    expect(priced.statusCode, priced.body).toBe(200);
    expect((safeJson(priced) as Addon).prices).toEqual([{ currency: 'USD', priceMinor: 1800 }]);
    expect(errorOf(await put(operator, `/api/admin/addons/${a.id}/prices`, { prices: {} })).code).toBe('VALIDATION_FAILED');

    expect((safeJson(await operator.post(`/api/admin/addons/${a.id}/set-aside`)) as Addon).active).toBe(false);
    expect((safeJson(await operator.post(`/api/admin/addons/${a.id}/reinstate`, {})) as Addon).active).toBe(true);

    const linked = await put(operator, `/api/admin/addons/${a.id}/shopify`, { productId: 'https://admin.shopify.com/store/orbes/products/7001', variantId: '' });
    expect(linked.statusCode, linked.body).toBe(200);
    expect(safeJson(linked)).toMatchObject({ shopifyProductId: '7001', sku: { shopifyVariantId: null } });
    expect(errorOf(await put(operator, `/api/admin/addons/${a.id}/shopify`, { productId: null, variantId: '7101' })).code).toBe('VALIDATION_FAILED');

    // An AUDITOR reads the list and one add-on.
    const list = await auditor.get('/api/admin/addons');
    expect(list.statusCode).toBe(200);
    expect((safeJson(list) as { items: Addon[] }).items.map((x) => x.name)).toEqual(['Polishing Cloth']);
    expect((safeJson(await auditor.get(`/api/admin/addons/${a.id}`)) as Addon).sku.code).toBe('ADD-CLOTH');
    expect(errorOf(await auditor.get('/api/admin/addons/00000000-0000-4000-8000-000000000000'))).toEqual({ code: 'ADDON_NOT_FOUND', message: expect.any(String) });

    // The writes are an OPERATOR's; LOGISTICS reads its add-on stock through Logistics, never this list.
    expect(errorOf(await auditor.post('/api/admin/addons', { name: 'Care Kit', skuCode: 'ADD-KIT' })).code).toBe('FORBIDDEN');
    expect(errorOf(await put(auditor, `/api/admin/addons/${a.id}/prices`, { prices: { EUR: 1 } })).code).toBe('FORBIDDEN');
    expect(errorOf(await agent.get('/api/admin/addons')).code).toBe('FORBIDDEN');
    expect(errorOf(await agent.post(`/api/admin/addons/${a.id}/set-aside`)).code).toBe('FORBIDDEN');
    const stock = safeJson(await agent.get('/api/admin/logistics/stock')) as { rows: { sku: { id: string; addon: { name: string } | null; model: unknown } }[] };
    expect(stock.rows.filter((r) => r.sku.id === a.sku.id).map((r) => [r.sku.addon?.name, r.sku.model])).toEqual([['Polishing Cloth', null]]);
  });

  it('creates a service and the engraving with their switches and most characters (lot Q2, step Q2.2): its kind at the creation only (409 ADDON_KIND_FIXED), one engraving (409 ADDON_ENGRAVING_TAKEN), strict bodies, no stock anywhere (409 ADDON_SERVICE)', async () => {
    const created = await operator.post('/api/admin/addons', {
      kind: 'SERVICE',
      name: 'Engraving',
      line: 'Up to 12 characters, engraved by ORBES.',
      skuCode: 'ADD-ENGRAVING',
      offeredAt: { salon: false },
      engraving: true,
      textMax: 12,
      prices: { EUR: 4000 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const e = safeJson(created) as Addon & Record<string, unknown>;
    expect(e).toMatchObject({ kind: 'SERVICE', offeredAt: { live: true, draw: true, salon: false, orders: true }, engraving: true, textMax: 12, stock: [], releases: 0, convertedFrom: [], supplier: null });
    // A product by default, all its switches on, 20 characters.
    expect(safeJson(await operator.post('/api/admin/addons', { name: 'Care Kit', skuCode: 'ADD-KIT' }))).toMatchObject({ kind: 'PRODUCT', offeredAt: { live: true, draw: true, salon: true, orders: true }, engraving: false, textMax: 20 });
    expect(errorOf(await operator.post('/api/admin/addons', { kind: 'SERVICE', name: 'Second Engraving', skuCode: 'ADD-ENGR2', engraving: true }))).toEqual({
      code: 'ADDON_ENGRAVING_TAKEN',
      message: 'Another add-on is the engraving: set it aside first.',
    });
    expect(errorOf(await operator.post('/api/admin/addons', { name: 'Engraved Tag', skuCode: 'ADD-TAG', engraving: true }))).toEqual({ code: 'VALIDATION_FAILED', message: 'Only a service can be the engraving.' });
    for (const bad of [
      { kind: 'BUNDLE', name: 'Gift Box', skuCode: 'ADD-BOX' },
      { kind: 'SERVICE', name: 'Gift Box', skuCode: 'ADD-BOX', offeredAt: { shop: true } },
      { kind: 'SERVICE', name: 'Gift Box', skuCode: 'ADD-BOX', offeredAt: { live: 'yes' } },
      { kind: 'SERVICE', name: 'Gift Box', skuCode: 'ADD-BOX', engraving: true, textMax: 21 },
      { kind: 'SERVICE', name: 'Gift Box', skuCode: 'ADD-BOX', engraving: true, textMax: 0 },
    ]) {
      expect(errorOf(await operator.post('/api/admin/addons', bad)).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    // Its kind never changes; its switches and most characters do.
    expect(errorOf(await operator.patch(`/api/admin/addons/${e.id}`, { kind: 'PRODUCT' }))).toEqual({ code: 'ADDON_KIND_FIXED', message: 'An add-on’s type never changes: set this one aside and create the other.' });
    const patched = await operator.patch(`/api/admin/addons/${e.id}`, { offeredAt: { live: false }, textMax: 20 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(safeJson(patched)).toMatchObject({ offeredAt: { live: false, draw: true, salon: false, orders: true }, textMax: 20 });
    expect(errorOf(await operator.patch(`/api/admin/addons/${e.id}`, { textMax: 21 })).code).toBe('VALIDATION_FAILED');
    // A service takes no stock: never in Logistics, a minimum refused.
    const stock = safeJson(await operator.get('/api/admin/logistics/stock')) as { rows: { sku: { id: string } }[]; skus: { id: string }[]; locations: { id: string }[] };
    expect(stock.skus.some((k) => k.id === (e.sku as { id: string }).id)).toBe(false);
    expect(stock.rows.some((r) => r.sku.id === (e.sku as { id: string }).id)).toBe(false);
    const location = stock.locations[0]!.id;
    expect(errorOf(await put(operator, '/api/admin/logistics/minimums', { skuId: (e.sku as { id: string }).id, locationId: location, minimum: 2 }))).toEqual({
      code: 'ADDON_SERVICE',
      message: 'Engraving is a service: it has no stock.',
    });
    // An AUDITOR reads it; never writes it.
    expect(safeJson(await auditor.get(`/api/admin/addons/${e.id}`))).toMatchObject({ kind: 'SERVICE', engraving: true });
    expect(errorOf(await auditor.patch(`/api/admin/addons/${e.id}`, { engraving: false })).code).toBe('FORBIDDEN');
  });
});
