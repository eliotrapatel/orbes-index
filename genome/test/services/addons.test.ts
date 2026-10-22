/**
 * The add-ons' catalogue (macro scope of 2026-10-20, K48 D1; plan MACRO M3 §4.2, step M3.9; services/addons.ts), on the
 * service as createContext wires it:
 *
 *  - an add-on created with its own SKU (no model, no size) and its code given by staff, its prices per house currency,
 *    its supplier, weight and position; every bound; its name once whatever the case (409 ADDON_NAME_TAKEN), its code
 *    once among every SKU, a model's sizes included (409 SKU_CODE_TAKEN); audited `addon.create`;
 *  - changed field by field (`addon.update`, before and after; nothing changed, nothing written); its prices set,
 *    changed and removed (`addon.prices`); set aside and reinstated (`addon.set_aside`, `addon.reinstate`), offered
 *    nowhere while set aside (409 ADDON_SET_ASIDE where a SKU must be offered);
 *  - its Shopify ids pasted back (S5): the product on the add-on and its SKU, the variant on its SKU, audited
 *    `addon.shopify`; a product a model or another add-on has (both ways) and a variant another SKU has refused;
 *  - `availableAt`: the active add-ons priced in the currency with at least one available at the location now, a unit
 *    held on an order counted (`stock_holds`), in their order.
 * The routes are test/api/admin-addons.test.ts's; the stock chain (Logistics, the supplier orders, the receptions) is
 * held in test/services/logistics.test.ts, supplier-orders.test.ts and receptions.test.ts; the product export in
 * shopify.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { ADDON_SKU_CODE_RE } from '../../src/server/services/addons.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { createAccount } from '../support/live.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('AddonService (plan MACRO M3 §4.2, D1)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let france: string;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
  });
  afterAll(() => h?.close());

  const addons = () => h.ctx.services.addons;
  const auditsOf = (id: string, action: string) => h.t.db.selectFrom('audit_logs').select('details').where('target_type', '=', 'addon').where('target_id', '=', id).where('action', '=', action).orderBy('id').execute();
  const count = (skuId: string, locationId: string, delta: number) => h.ctx.services.stock.adjust({ skuId, locationId, delta, note: 'Counted.' }, admin);
  /** A unit of an add-on held on an order (M3.10's flow, written here directly): what `stock_holds` reads. */
  async function holdUnit(addonId: string, skuId: string, locationId: string): Promise<void> {
    const account = await createAccount(h.ctx.db);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(1000);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const order = await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    await h.t.db.insertInto('order_addon_items').values({ order_id: order.id, addon_id: addonId, sku_id: skuId, location_id: locationId, price_minor: 1500, currency: 'EUR', added_by_type: 'STAFF' }).execute();
  }

  it('lists an add-on with its own SKU (no model, no size), its code, prices, supplier, weight and position; audited addon.create', async () => {
    const supplier = await h.ctx.services.suppliers.create({ name: 'Care Works', currency: 'EUR' }, admin);
    const a = await addons().create(
      { name: '  Polishing   Cloth ', line: ' Microfibre, for silver and steel. ', skuCode: ' add-cloth ', supplierId: supplier.id, weightG: 20, prices: { EUR: 1500, CHF: 1600 } },
      admin,
    );
    expect(a).toEqual({
      id: expect.any(String),
      name: 'Polishing Cloth',
      line: 'Microfibre, for silver and steel.',
      supplier: { id: supplier.id, name: 'Care Works', active: true },
      weightG: 20,
      position: 0,
      active: true,
      sku: { id: expect.any(String), code: 'ADD-CLOTH', shopifyVariantId: null },
      shopifyProductId: null,
      prices: [
        { currency: 'EUR', priceMinor: 1500 },
        { currency: 'CHF', priceMinor: 1600 },
      ],
      stock: [
        { location: { id: france, name: 'FRANCE WAREHOUSE', isDefault: true }, onHand: 0, reserved: 0, available: 0, minimum: null },
        { location: { id: logistics, name: 'LOGISTICS WAREHOUSE', isDefault: false }, onHand: 0, reserved: 0, available: 0, minimum: null },
      ],
      createdAt: new Date('2026-10-22T09:00:00.000Z'),
      updatedAt: new Date('2026-10-22T09:00:00.000Z'),
    });
    // Its SKU: the add-on's, no model, no size, no fit.
    expect(await h.t.db.selectFrom('skus').select(['model_id', 'addon_id', 'size_label', 'fit_min_mm', 'code']).where('id', '=', a.sku.id).executeTakeFirstOrThrow()).toEqual({
      model_id: null,
      addon_id: a.id,
      size_label: null,
      fit_min_mm: null,
      code: 'ADD-CLOTH',
    });
    expect((await h.t.db.selectFrom('addon_items').select('created_by').where('id', '=', a.id).executeTakeFirstOrThrow()).created_by).toBe(admin.id);
    expect((await auditsOf(a.id, 'addon.create'))[0]!.details).toEqual({
      name: 'Polishing Cloth',
      skuId: a.sku.id,
      skuCode: 'ADD-CLOTH',
      supplierId: supplier.id,
      weightG: 20,
      position: 0,
      prices: { EUR: 1500, CHF: 1600 },
    });
    // The next one goes after it; without a line, supplier, weight or price.
    expect(await addons().create({ name: 'Travel Pouch', skuCode: 'ADD-POUCH' }, admin)).toMatchObject({ position: 1, line: null, supplier: null, weightG: null, prices: [] });
  });

  it('refuses a name taken whatever its case, a SKU code any SKU has (a model\'s size too), a code out of shape, an unknown supplier and every bound', async () => {
    expect(await refusal(addons().create({ name: 'POLISHING CLOTH', skuCode: 'ADD-OTHER' }, admin))).toEqual({ code: 'ADDON_NAME_TAKEN', status: 409, message: 'Another add-on has this name.' });
    expect(await refusal(addons().create({ name: 'Another Cloth', skuCode: 'add-cloth' }, admin))).toEqual({ code: 'SKU_CODE_TAKEN', status: 409, message: 'Another SKU has this code.' });
    const modelSku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '52'));
    const modelCode = (await h.t.db.selectFrom('skus').select('code').where('id', '=', modelSku).executeTakeFirstOrThrow()).code;
    expect((await refusal(addons().create({ name: 'Spare Strap', skuCode: modelCode }, admin))).code).toBe('SKU_CODE_TAKEN');
    // Nothing of a refused add-on stays.
    expect(await h.t.db.selectFrom('addon_items').select('id').where('name', '=', 'Spare Strap').execute()).toEqual([]);
    expect(ADDON_SKU_CODE_RE.test('A')).toBe(false);
    for (const skuCode of ['', 'A', '-ADD', 'ADD CLOTH', 'ADD_CLOTH', `A${'B'.repeat(64)}`]) expect((await refusal(addons().create({ name: 'Spare Strap', skuCode }, admin))).code, skuCode).toBe('VALIDATION_FAILED');
    expect(await refusal(addons().create({ name: 'Spare Strap', skuCode: 'ADD-STRAP', supplierId: '00000000-0000-4000-8000-000000000000' }, admin))).toMatchObject({ code: 'SUPPLIER_NOT_FOUND', status: 404 });
    for (const bad of [
      { name: 'X'.repeat(41) },
      { name: '   ' },
      { line: 'L'.repeat(121) },
      { weightG: 0 },
      { weightG: 30_001 },
      { weightG: 1.5 },
      { position: -1 },
      { position: 10_001 },
      { prices: { EUR: -1 } },
      { prices: { EUR: 100_000_001 } },
      { prices: { JPY: 100 } as never },
    ]) {
      expect((await refusal(addons().create({ name: 'Spare Strap', skuCode: 'ADD-STRAP', ...bad }, admin))).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    // The upper bounds hold.
    expect(
      await addons().create({ name: 'S'.repeat(40), line: 'L'.repeat(120), skuCode: `A${'B'.repeat(63)}`, weightG: 30_000, position: 10_000, prices: { USD: 100_000_000, GBP: 0 } }, admin),
    ).toMatchObject({ weightG: 30_000, position: 10_000, prices: [{ currency: 'GBP', priceMinor: 0 }, { currency: 'USD', priceMinor: 100_000_000 }] });
    // Only ORBES staff.
    expect((await refusal(addons().create({ name: 'Spare Strap', skuCode: 'ADD-STRAP' }, { type: 'account', id: 'x' } as unknown as Actor))).code).toBe('FORBIDDEN');
  });

  it('changes an add-on field by field, audited addon.update before and after; nothing changed, nothing written; its prices set, changed and removed, audited addon.prices', async () => {
    const a = await addons().create({ name: 'Chain Extender', skuCode: 'ADD-EXT', prices: { EUR: 2500 } }, admin);
    h.clock.advance(60_000);
    const supplier = await h.ctx.services.suppliers.create({ name: 'Chain House', currency: 'EUR' }, admin);
    const changed = await addons().update(a.id, { name: 'Chain Extender 5 cm', line: 'Five centimetres more.', supplierId: supplier.id, weightG: 4, position: 7 }, admin);
    expect(changed).toMatchObject({ name: 'Chain Extender 5 cm', line: 'Five centimetres more.', supplier: { id: supplier.id }, weightG: 4, position: 7, sku: { code: 'ADD-EXT' } });
    expect(changed.updatedAt).toEqual(h.clock.now());
    expect((await auditsOf(a.id, 'addon.update'))[0]!.details).toEqual({
      name: { from: 'Chain Extender', to: 'Chain Extender 5 cm' },
      line: { from: null, to: 'Five centimetres more.' },
      supplierId: { from: null, to: supplier.id },
      weightG: { from: null, to: 4 },
      position: { from: a.position, to: 7 },
    });
    await addons().update(a.id, { name: 'Chain Extender 5 cm', weightG: 4 }, admin);
    await addons().update(a.id, { line: null }, admin);
    expect((await auditsOf(a.id, 'addon.update')).map((x) => x.details)).toEqual([expect.anything(), { line: { from: 'Five centimetres more.', to: null } }]);
    expect((await refusal(addons().update(a.id, {}, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(addons().update(a.id, { name: 'polishing cloth' }, admin))).code).toBe('ADDON_NAME_TAKEN');
    expect((await refusal(addons().update('00000000-0000-4000-8000-000000000000', { position: 1 }, admin))).code).toBe('ADDON_NOT_FOUND');

    // Prices: one changed, one added, one removed; the same again writes nothing.
    const priced = await addons().setPrices(a.id, { EUR: 2700, USD: 3000 }, admin);
    expect(priced.prices).toEqual([
      { currency: 'EUR', priceMinor: 2700 },
      { currency: 'USD', priceMinor: 3000 },
    ]);
    expect(await addons().setPrices(a.id, { EUR: null }, admin)).toMatchObject({ prices: [{ currency: 'USD', priceMinor: 3000 }] });
    await addons().setPrices(a.id, { USD: 3000, GBP: null }, admin);
    expect((await auditsOf(a.id, 'addon.prices')).map((x) => x.details)).toEqual([{ EUR: { from: 2500, to: 2700 }, USD: { from: null, to: 3000 } }, { EUR: { from: 2700, to: null } }]);
    expect((await refusal(addons().setPrices(a.id, {}, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(addons().setPrices(a.id, { EUR: 1.5 }, admin))).code).toBe('VALIDATION_FAILED');
  });

  it('sets an add-on aside and reinstates it, audited; set aside, its SKU is offered nowhere (409 ADDON_SET_ASIDE), its stock and history kept', async () => {
    const a = await addons().create({ name: 'Spare Strap', skuCode: 'ADD-STRAP', prices: { EUR: 3500 } }, admin);
    await count(a.sku.id, france, 2);
    const aside = await addons().setAside(a.id, admin);
    expect(aside).toMatchObject({ active: false, stock: [{ location: { id: france }, onHand: 2 }, expect.anything()] });
    await addons().setAside(a.id, admin);
    expect(await auditsOf(a.id, 'addon.set_aside')).toEqual([{ details: { name: 'Spare Strap' } }]);
    expect(await refusal(h.ctx.services.logistics.setMinimum({ skuId: a.sku.id, locationId: france, minimum: 3 }, admin))).toEqual({
      code: 'ADDON_SET_ASIDE',
      status: 409,
      message: 'Spare Strap is set aside. Reinstate it in Catalogue → Add-ons to offer it again.',
    });
    // Set aside, it sorts after the active ones.
    expect((await addons().list()).at(-1)!.id).toBe(a.id);
    expect((await addons().reinstate(a.id, admin)).active).toBe(true);
    expect(await auditsOf(a.id, 'addon.reinstate')).toEqual([{ details: { name: 'Spare Strap' } }]);
    await h.ctx.services.logistics.setMinimum({ skuId: a.sku.id, locationId: france, minimum: 3 }, admin);
    expect((await addons().get(a.id)).stock.find((s) => s.location.id === france)).toEqual({ location: { id: france, name: 'FRANCE WAREHOUSE', isDefault: true }, onHand: 2, reserved: 0, available: 2, minimum: 3 });
  });

  it('keeps the Shopify ids pasted back (S5): the product on the add-on and its SKU, the variant on its SKU, audited; refuses a product or a variant another side has', async () => {
    const a = await addons().create({ name: 'Care Kit', skuCode: 'ADD-KIT', prices: { EUR: 4500 } }, admin);
    const linked = await addons().setShopify(a.id, { productId: 'https://admin.shopify.com/store/orbes/products/7001', variantId: '7101' }, admin);
    expect(linked).toMatchObject({ shopifyProductId: '7001', sku: { shopifyVariantId: '7101' } });
    expect(await h.t.db.selectFrom('skus').select(['shopify_product_id', 'shopify_variant_id']).where('id', '=', a.sku.id).executeTakeFirstOrThrow()).toEqual({ shopify_product_id: '7001', shopify_variant_id: '7101' });
    expect(await auditsOf(a.id, 'addon.shopify')).toEqual([{ details: { product: { from: null, to: '7001' }, variant: { from: null, to: '7101' } } }]);
    // The same again writes nothing.
    await addons().setShopify(a.id, { productId: '7001', variantId: '7101' }, admin);
    expect(await auditsOf(a.id, 'addon.shopify')).toHaveLength(1);
    // A model's product and variant.
    const modelSku = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, '54'));
    await h.ctx.services.shopify.link(catalog.modelId, { productId: '8001', variants: [{ size: '54', variantId: '8154' }] }, admin);
    const b = await addons().create({ name: 'Ring Box', skuCode: 'ADD-RBOX' }, admin);
    expect((await refusal(addons().setShopify(b.id, { productId: '8001', variantId: null }, admin))).code).toBe('SHOPIFY_PRODUCT_TAKEN');
    expect((await refusal(addons().setShopify(b.id, { productId: '7001', variantId: null }, admin))).code).toBe('SHOPIFY_PRODUCT_TAKEN');
    expect((await refusal(addons().setShopify(b.id, { productId: '7002', variantId: '8154' }, admin))).code).toBe('SHOPIFY_VARIANT_TAKEN');
    expect((await refusal(addons().setShopify(b.id, { productId: null, variantId: '7201' }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(addons().setShopify(b.id, { productId: 'abc', variantId: null }, admin))).code).toBe('VALIDATION_FAILED');
    // A model is refused the add-on's product too.
    const other = await h.ctx.db
      .insertInto('models')
      .values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'ORBITE', type: 'RING', sku_prefix: 'ORB-AD', default_material: 'SILVER' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.ctx.db.transaction().execute((tx) => ensureSku(tx, other.id, null));
    expect((await refusal(h.ctx.services.shopify.link(other.id, { productId: '7001', variants: [] }, admin))).code).toBe('SHOPIFY_PRODUCT_TAKEN');
    expect(modelSku).toBeTruthy();
    // Cleared: no variant stands.
    expect(await addons().setShopify(a.id, { productId: null, variantId: null }, admin)).toMatchObject({ shopifyProductId: null, sku: { shopifyVariantId: null } });
  });

  it('offers at a location in a currency the active add-ons priced in it with one available there now, a unit held on an order counted, in their order', async () => {
    const cloth = (await addons().list()).find((x) => x.name === 'Polishing Cloth')!;
    const kit = (await addons().list()).find((x) => x.name === 'Care Kit')!;
    const strap = (await addons().list()).find((x) => x.name === 'Spare Strap')!;
    // Nothing on hand: none offered.
    expect((await addons().availableAt(logistics, 'EUR')).map((x) => x.name)).toEqual([]);
    await count(cloth.sku.id, logistics, 1);
    await count(kit.sku.id, logistics, 2);
    await count(strap.sku.id, logistics, 1);
    expect(await addons().availableAt(logistics, 'EUR')).toEqual([
      { addonId: cloth.id, skuId: cloth.sku.id, name: 'Polishing Cloth', line: 'Microfibre, for silver and steel.', currency: 'EUR', priceMinor: 1500, available: 1, weightG: 20 },
      // Both at the last position (10 000, the longest name's): by name.
      { addonId: kit.id, skuId: kit.sku.id, name: 'Care Kit', line: null, currency: 'EUR', priceMinor: 4500, available: 2, weightG: null },
      { addonId: strap.id, skuId: strap.sku.id, name: 'Spare Strap', line: null, currency: 'EUR', priceMinor: 3500, available: 1, weightG: null },
    ]);
    expect([cloth.position, kit.position, strap.position]).toEqual([0, 10_000, 10_000]);
    // Priced in CHF: the cloth only. Elsewhere: none.
    expect((await addons().availableAt(logistics, 'CHF')).map((x) => [x.name, x.priceMinor])).toEqual([['Polishing Cloth', 1600]]);
    expect(await addons().availableAt(france, 'GBP')).toEqual([]);
    // The cloth's one unit held on an order: no longer available; the stock says it.
    await holdUnit(cloth.id, cloth.sku.id, logistics);
    expect((await addons().availableAt(logistics, 'EUR')).map((x) => x.name)).toEqual(['Care Kit', 'Spare Strap']);
    expect((await addons().get(cloth.id)).stock.find((s) => s.location.id === logistics)).toMatchObject({ onHand: 1, reserved: 1, available: 0 });
    expect(await h.ctx.services.stock.balances({ skuId: cloth.sku.id })).toEqual([]);
    // A unit held is never taken by a count down or a transfer.
    expect((await refusal(count(cloth.sku.id, logistics, -1))).code).toBe('STOCK_NOT_AVAILABLE');
    expect((await refusal(h.ctx.services.stock.transfer({ skuId: cloth.sku.id, fromLocationId: logistics, toLocationId: france, quantity: 1 }, admin))).code).toBe('STOCK_NOT_AVAILABLE');
    // Set aside: not offered.
    await addons().setAside(kit.id, admin);
    expect((await addons().availableAt(logistics, 'EUR')).map((x) => x.name)).toEqual(['Spare Strap']);
    await addons().reinstate(kit.id, admin);
    expect((await refusal(addons().availableAt('00000000-0000-4000-8000-000000000000', 'EUR'))).code).toBe('STOCK_LOCATION_NOT_FOUND');
    expect((await refusal(addons().availableAt(logistics, 'JPY'))).code).toBe('VALIDATION_FAILED');
  });
});
