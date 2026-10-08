/**
 * The suppliers (plan NEXT LOT of 2026-10-07, §3.5.6.2, step 5.3; migration 0035), on the service and the routes as
 * createContext and buildApp wire them:
 *
 *  - a supplier created with its contact, currency and note; its name unique whatever the case (409
 *    SUPPLIER_NAME_TAKEN); a currency of zero or three decimals refused (400, 'choose one with cents'); set inactive,
 *    never deleted; the audit `supplier.create` (name, currency, state) and `supplier.update` (the fields' names only,
 *    never the contact's words); nothing changed, nothing audited;
 *  - `supplierOf`: a size's own supplier, else its model's, else a variant's main model's, else none;
 *  - a model's supplier and its sizes' own set together (`setModelSupplier`), a SKU of another model 404, an unknown
 *    supplier 404, audited `model.supplier`; the model's Sizes section reads them (its own, a variant's inherited one,
 *    each size's own);
 *  - the routes: an AUDITOR reads, an OPERATOR writes, a LOGISTICS login never reaches them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { CURRENCY_NOT_SUPPORTED, supplierOf, UNSUPPORTED_CURRENCIES } from '../../src/server/services/suppliers.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from '../api/support.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('SupplierService (plan NEXT LOT §3.5.6.2)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let operator: Client;
  let auditor: Client;
  let agent: Client;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-08T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    agent = await adminClient(h, 'LOGISTICS');
    admin = { type: 'admin', id: (await h.t.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow()).id };
  });
  afterAll(() => h?.close());

  const suppliers = () => h.ctx.services.suppliers;

  it('creates a supplier with its contact, currency and note; its name once whatever the case; a currency with cents only', async () => {
    const s = await suppliers().create(
      { name: '  Maison  Nord ', contactName: 'A. Martin', email: 'orders@nord.example', phone: '+33 1 00 00 00 01', address: '1 rue du Nord\r\n59000 Lille', currency: 'eur', note: 'Rings and bracelets.' },
      admin,
    );
    expect(s).toEqual({
      id: expect.any(String),
      name: 'Maison Nord',
      contactName: 'A. Martin',
      email: 'orders@nord.example',
      phone: '+33 1 00 00 00 01',
      address: '1 rue du Nord\n59000 Lille',
      currency: 'EUR',
      note: 'Rings and bracelets.',
      active: true,
      models: 0,
      createdAt: h.clock.now(),
    });
    expect(await refusal(suppliers().create({ name: 'MAISON NORD' }, admin))).toEqual({ code: 'SUPPLIER_NAME_TAKEN', status: 409, message: 'Another supplier has this name.' });
    expect(UNSUPPORTED_CURRENCIES).toEqual(expect.arrayContaining(['JPY', 'KRW', 'CLP', 'KWD', 'BHD', 'TND']));
    for (const currency of ['JPY', 'kwd', 'XOF']) {
      expect(await refusal(suppliers().create({ name: `Yen ${currency}`, currency }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: CURRENCY_NOT_SUPPORTED });
    }
    expect(CURRENCY_NOT_SUPPORTED).toBe('This currency is not supported: choose one with cents.');
    for (const currency of ['EURO', 'E1R']) expect((await refusal(suppliers().create({ name: `Bad ${currency}`, currency }, admin))).code).toBe('VALIDATION_FAILED');
    // Any ISO code with two decimals, outside the four order currencies too.
    expect((await suppliers().create({ name: 'Swiss Cases', currency: 'SEK' }, admin)).currency).toBe('SEK');
    expect((await refusal(suppliers().create({ name: 'x'.repeat(121) }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(suppliers().create({ name: 'No email', email: 'not an email' }, admin))).code).toBe('VALIDATION_FAILED');
    // A one-line field reads as one line; the address and the note keep their line breaks.
    expect((await suppliers().create({ name: 'One line', contactName: 'A.\n  Martin' }, admin)).contactName).toBe('A. Martin');
    const entry = (await h.ctx.audit.list({ action: 'supplier.create', targetId: s.id })).items[0];
    expect(entry).toMatchObject({ actorId: admin.id, details: { name: 'Maison Nord', currency: 'EUR', active: true } });
    for (const words of ['A. Martin', 'orders@nord.example', '+33 1 00 00 00 01', 'rue du Nord', 'Rings and bracelets.']) expect(JSON.stringify(entry)).not.toContain(words);
    expect((await suppliers().list()).map((x) => x.name)).toEqual(['Maison Nord', 'One line', 'Swiss Cases']);
  });

  it('changes a supplier\'s fields, sets it inactive, never deletes it; the audit names the fields only; nothing changed, nothing audited', async () => {
    const s = await suppliers().create({ name: 'Atlas Chains', currency: 'GBP' }, admin);
    const changed = await suppliers().update(s.id, { contactName: 'J. Doe', email: 'j@atlas.example', currency: 'USD', active: false, name: 'Atlas Chains' }, admin);
    expect(changed).toMatchObject({ name: 'Atlas Chains', contactName: 'J. Doe', email: 'j@atlas.example', currency: 'USD', active: false });
    const entries = async () => (await h.ctx.audit.list({ action: 'supplier.update', targetId: s.id })).items;
    expect((await entries())[0]).toMatchObject({ actorId: admin.id, details: { fields: ['contactName', 'email', 'currency', 'active'] } });
    expect(JSON.stringify(await entries())).not.toContain('J. Doe');
    expect(JSON.stringify(await entries())).not.toContain('j@atlas.example');
    // The same values again: nothing written, nothing audited.
    await suppliers().update(s.id, { contactName: 'J. Doe', active: false }, admin);
    expect(await entries()).toHaveLength(1);
    // Cleared with null; the name never.
    expect((await suppliers().update(s.id, { contactName: null, email: '' }, admin))).toMatchObject({ contactName: null, email: null });
    expect((await refusal(suppliers().update(s.id, { name: '' }, admin))).code).toBe('VALIDATION_FAILED');
    expect(await refusal(suppliers().update(s.id, { name: 'maison nord' }, admin))).toMatchObject({ code: 'SUPPLIER_NAME_TAKEN', status: 409 });
    expect(await refusal(suppliers().update('00000000-0000-4000-8000-000000000000', { note: 'x' }, admin))).toMatchObject({ code: 'SUPPLIER_NOT_FOUND', status: 404 });
    expect(await refusal(suppliers().get('nope'))).toMatchObject({ code: 'SUPPLIER_NOT_FOUND', status: 404 });
    await expect(h.t.db.deleteFrom('suppliers').where('id', '=', s.id).execute()).rejects.toThrow();
    expect((await suppliers().get(s.id)).active).toBe(false);
  });

  it('reads a size\'s supplier from the size, else its model, else a variant\'s main model, else none', async () => {
    const nord = await suppliers().create({ name: 'Nord Rings' }, admin);
    const south = await suppliers().create({ name: 'South Rings' }, admin);
    const main = (await seedCatalog(h.ctx)).modelId;
    await h.t.db.updateTable('models').set({ variant_label: 'Steel', variant_swatch: '#8A8D8F' }).where('id', '=', main).execute();
    const m = await h.t.db.selectFrom('models').selectAll().where('id', '=', main).executeTakeFirstOrThrow();
    const blue = (
      await h.t.db
        .insertInto('models')
        .values({ category_id: m.category_id, name: m.name, type: m.type, sku_prefix: `${m.sku_prefix}-BL`, variant_of: main, variant_label: 'Blue', variant_swatch: '#1F3A93' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const main52 = await ensureSku(h.t.db, main, '52');
    const blue52 = await ensureSku(h.t.db, blue, '52');
    const blue54 = await ensureSku(h.t.db, blue, '54');
    expect(await supplierOf(h.t.db, blue52)).toBeNull();
    // The main model's supplier reaches its variant's sizes.
    await suppliers().setModelSupplier(main, { supplierId: nord.id }, admin);
    expect(await supplierOf(h.t.db, main52)).toBe(nord.id);
    expect(await supplierOf(h.t.db, blue52)).toBe(nord.id);
    // The variant's own wins over its main model's; a size's own over its model's.
    await suppliers().setModelSupplier(blue, { supplierId: south.id, sizes: { [blue54]: nord.id } }, admin);
    expect(await supplierOf(h.t.db, blue52)).toBe(south.id);
    expect(await supplierOf(h.t.db, blue54)).toBe(nord.id);
    // The Sizes section reads them: the variant's own, then without it its main model's, and each size's own.
    let section = await h.ctx.services.sizes.modelSizes(blue);
    expect(section.supplier).toEqual({ own: { id: south.id, name: 'South Rings', active: true }, inherited: null, sizes: { [blue54]: { id: nord.id, name: 'Nord Rings', active: true } } });
    await suppliers().setModelSupplier(blue, { supplierId: null, sizes: { [blue54]: null } }, admin);
    section = await h.ctx.services.sizes.modelSizes(blue);
    expect(section.supplier).toEqual({ own: null, inherited: { id: nord.id, name: 'Nord Rings', active: true, from: 'MONOLITHE' }, sizes: {} });
    expect(await supplierOf(h.t.db, blue54)).toBe(nord.id);
    expect((await suppliers().get(nord.id)).models).toBe(1);
  });

  it('sets a model\'s supplier and its sizes\' own in one transaction, audited model.supplier; a size of another model or an unknown supplier 404', async () => {
    const a = await suppliers().create({ name: 'Cases A' }, admin);
    const model = catalog.modelId;
    const own52 = await ensureSku(h.t.db, model, '52');
    const other = await ensureSku(h.t.db, (await seedCatalog(h.ctx)).modelId, '52');
    expect(await refusal(suppliers().setModelSupplier(model, { supplierId: a.id, sizes: { [other]: a.id } }, admin))).toMatchObject({ code: 'SKU_NOT_FOUND', status: 404 });
    expect(await refusal(suppliers().setModelSupplier(model, { supplierId: '00000000-0000-4000-8000-000000000000' }, admin))).toMatchObject({ code: 'SUPPLIER_NOT_FOUND', status: 404 });
    expect(await refusal(suppliers().setModelSupplier('00000000-0000-4000-8000-000000000000', { supplierId: a.id }, admin))).toMatchObject({ code: 'MODEL_NOT_FOUND', status: 404 });
    // Refused whole: nothing of it was written.
    expect((await h.t.db.selectFrom('models').select('supplier_id').where('id', '=', model).executeTakeFirstOrThrow()).supplier_id).toBeNull();
    const view = await suppliers().setModelSupplier(model, { supplierId: a.id, sizes: { [own52]: a.id } }, admin);
    expect(view).toEqual({ own: { id: a.id, name: 'Cases A', active: true }, inherited: null, sizes: { [own52]: { id: a.id, name: 'Cases A', active: true } } });
    const entries = async () => (await h.ctx.audit.list({ action: 'model.supplier', targetId: model })).items;
    expect((await entries())[0]).toMatchObject({ actorId: admin.id, details: { supplierId: { from: null, to: a.id }, sizes: { [own52]: { from: null, to: a.id } } } });
    await suppliers().setModelSupplier(model, { supplierId: a.id }, admin);
    expect(await entries()).toHaveLength(1);
  });

  it('serves the routes: an AUDITOR reads, an OPERATOR writes, a LOGISTICS login never reaches them; the model\'s supplier answers its Sizes section', async () => {
    const created = await operator.post('/api/admin/suppliers', { name: 'Route Supplies', currency: 'CHF', contactName: '', active: true });
    expect(created.statusCode, created.body).toBe(201);
    const s = safeJson(created) as { id: string; name: string; contactName: string | null; currency: string; models: number };
    expect(s).toMatchObject({ name: 'Route Supplies', contactName: null, currency: 'CHF', models: 0 });
    expect(errorOf(await operator.post('/api/admin/suppliers', { name: 'route supplies' })).code).toBe('SUPPLIER_NAME_TAKEN');
    expect(errorOf(await operator.post('/api/admin/suppliers', { name: 'Yen', currency: 'JPY' }))).toEqual({ code: 'VALIDATION_FAILED', message: CURRENCY_NOT_SUPPORTED });
    expect((await operator.post('/api/admin/suppliers', { name: 'Extra', unknown: 1 })).statusCode).toBe(400);
    expect((await operator.patch(`/api/admin/suppliers/${s.id}`, {})).statusCode).toBe(400);
    expect((safeJson(await operator.patch(`/api/admin/suppliers/${s.id}`, { note: 'Boxes.' })) as { note: string }).note).toBe('Boxes.');
    const list = safeJson(await auditor.get('/api/admin/suppliers')) as { items: { name: string }[] };
    expect(list.items.map((x) => x.name)).toContain('Route Supplies');
    const refusedAuditor = await auditor.post('/api/admin/suppliers', { name: 'Nope' });
    expect(refusedAuditor.statusCode).toBe(403);
    for (const [method, url] of [
      ['GET', '/api/admin/suppliers'],
      ['POST', '/api/admin/suppliers'],
      ['PATCH', `/api/admin/suppliers/${s.id}`],
      ['PUT', `/api/admin/models/${catalog.modelId}/supplier`],
    ] as const) {
      const res = await agent.request(method, url, method === 'GET' ? {} : { body: { name: 'x' } });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
    const sku = await ensureSku(h.t.db, catalog.modelId, '56');
    const put = await operator.request('PUT', `/api/admin/models/${catalog.modelId}/supplier`, { body: { supplierId: s.id, sizes: { [sku]: null } } });
    expect(put.statusCode, put.body).toBe(200);
    const section = safeJson(put) as { modelId: string; supplier: { own: { name: string } | null } };
    expect(section.modelId).toBe(catalog.modelId);
    expect(section.supplier.own?.name).toBe('Route Supplies');
    expect((safeJson(await auditor.get(`/api/admin/models/${catalog.modelId}/sizes`)) as typeof section).supplier.own?.name).toBe('Route Supplies');
    expect((await operator.request('PUT', `/api/admin/models/${catalog.modelId}/supplier`, { body: {} })).statusCode).toBe(400);
    expect((await auditor.request('PUT', `/api/admin/models/${catalog.modelId}/supplier`, { body: { supplierId: null } })).statusCode).toBe(403);
  });
});
