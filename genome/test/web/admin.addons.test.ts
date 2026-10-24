/**
 * The add-ons in the console (macro scope of 2026-10-20, K48 D1 and D2; lot M3 plan §4.3, step M3.11) — the pure model
 * (src/web/admin/model/addons.ts) against the server's rules, the SKU words of Logistics and the supplier orders, the
 * slips, and the API client's routes:
 *
 *  - Catalogue → Add-ons: an add-on's row (prices, weight, stock and minimum per location, state, Shopify link), its
 *    dialog's checks (the bounds of migration 0056, the SKU code's rule, the server's own) and what it sends (a creation
 *    with its SKU code and prices; an edit only what changed, its fields and prices apart).
 *  - An add-on's SKU: named by its add-on, never a size, in Logistics, a reception's confirmation and the proposal.
 *  - The order page: the units grouped, who added them, Add an add-on's options, check and total, a refund's units.
 *  - The draw's Confirm and the salon's Accept: the choices, and what was left out.
 *  - The parcel and both slips: the add-ons with their units after the release's, never a price.
 *  - The words: calm, no atelier, handmade or craft, no exclamation mark.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADDON_LIMITS as SERVER_LIMITS, ADDON_SKU_CODE_RE as SERVER_SKU_RE } from '../../src/server/services/addons.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  ADDON_LIMITS,
  ADDON_SKU_CODE_RE,
  addAddonProblem,
  addAddonTotal,
  addedByText,
  addonChange,
  addonCreateInput,
  addonFormValues,
  addonGroups,
  addonStockLines,
  addonOfferOptions,
  addonPricesText,
  addonProblem,
  ADDONS_TEXT,
  addonShopifyInput,
  addonShopifyProblem,
  addonShopifyStatus,
  addonState,
  addonSupplierOptions,
  addonUnchanged,
  addonWeightText,
  canAddAddon,
  canRemoveAddon,
  choiceLines,
  documentAddonLine,
  groupPriceText,
  leftOutLines,
  noOfferText,
  ORDER_ADDONS_TEXT,
  orderPackedAddons,
  orderTakesAddons,
  parcelAddonWords,
  returnedLine,
  shippedUnits,
  skuOwnerName,
  type AddonForm,
} from '../../src/web/admin/model/addons.js';
import { confirmReceptionText, shippingSlip, skuSizeText, skuWords } from '../../src/web/admin/model/logistics.js';
import { noSupplierLine } from '../../src/web/admin/model/supplier-orders.js';
import type { AddonView, AdminOrderAddonUnit, LogisticsSku, OrderAddonOffer } from '../../src/web/admin/types.js';

/** formatCount's thin space; formatMoney's no-break space. */
const T = '\u2009';
const N = '\u00a0';
const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const FR = '1f0e0d0c-0b0a-4908-8706-050403020100';
const UK = '2f0e0d0c-0b0a-4908-8706-050403020100';
const SUP = '3f0e0d0c-0b0a-4908-8706-050403020100';
const ADMIN = '4f0e0d0c-0b0a-4908-8706-050403020100';

const CLOTH: AddonView = {
  id: ID,
  name: 'POLISHING CLOTH',
  line: 'For silver and gold.',
  supplier: { id: SUP, name: 'MAISON SOIE', active: true },
  weightG: 20,
  position: 0,
  active: true,
  sku: { id: ID, code: 'ADD-CLOTH', shopifyVariantId: null },
  shopifyProductId: null,
  prices: [
    { currency: 'EUR', priceMinor: 1500 },
    { currency: 'CHF', priceMinor: 1650 },
  ],
  stock: [
    { location: { id: FR, name: 'FRANCE WAREHOUSE', isDefault: true }, onHand: 12, reserved: 2, available: 10, minimum: 5 },
    { location: { id: UK, name: 'LONDON', isDefault: false }, onHand: 0, reserved: 0, available: 0, minimum: null },
  ],
  offeredAt: { live: true, draw: true, salon: true, orders: true },
  engraving: false,
  textMax: 20,
  releases: 0,
  convertedFrom: [],
  kind: 'PRODUCT',
  createdAt: '2026-10-22T08:00:00.000Z',
  updatedAt: '2026-10-22T08:00:00.000Z',
};

const form = (extra: Partial<AddonForm> = {}): AddonForm => ({ ...addonFormValues(CLOTH), ...extra });

const unit = (extra: Partial<AdminOrderAddonUnit> = {}): AdminOrderAddonUnit => ({
  id: ID,
  addon: { id: ID, name: 'POLISHING CLOTH' },
  skuCode: 'ADD-CLOTH',
  priceMinor: 1500,
  currency: 'EUR',
  status: 'HELD',
  addedAt: '2026-10-22T08:00:00.000Z',
  addedBy: { type: 'STAFF', id: ADMIN },
  removedAt: null,
  cancelledAt: null,
  shippedAt: null,
  returnedAt: null,
  returnedToStock: null,
  location: { id: FR, name: 'FRANCE WAREHOUSE' },
  invoiceId: null,
  ...extra,
});

const OFFER: OrderAddonOffer = {
  canAdd: true,
  reason: null,
  paid: false,
  currency: 'EUR',
  offer: [
    { addonId: ID, name: 'POLISHING CLOTH', line: null, priceMinor: 1500, currency: 'EUR', maxUnits: 3 },
    { addonId: SUP, name: 'CHAIN EXTENDER', line: null, priceMinor: 3000, currency: 'EUR', maxUnits: 1 },
  ],
};

describe('the mirrors of the server', () => {
  it('holds the server\'s bounds and the SKU code\'s rule', () => {
    expect({ ...ADDON_LIMITS }).toEqual({ name: SERVER_LIMITS.name, line: SERVER_LIMITS.line, weightG: SERVER_LIMITS.weightG, priceMinor: SERVER_LIMITS.priceMinor, units: SERVER_LIMITS.units, skuCode: SERVER_LIMITS.skuCode });
    expect(ADDON_SKU_CODE_RE.source).toBe(SERVER_SKU_RE.source);
  });
});

describe('Catalogue → Add-ons', () => {
  it('reads a row: its prices, weight, stock and minimum per location, state and Shopify link', () => {
    expect(addonPricesText(CLOTH)).toEqual([`€${N}15`, `CHF${N}16.50`]);
    expect(addonPricesText({ prices: [] })).toEqual(['No price: offered nowhere']);
    expect(addonWeightText(CLOTH)).toBe('20 g');
    expect(addonWeightText({ weightG: null })).toBe('Unknown');
    expect(addonStockLines(CLOTH)).toEqual(['FRANCE WAREHOUSE · 10 · minimum 5', 'LONDON · 0']);
    expect(addonState(CLOTH)).toBe('ACTIVE');
    expect(addonState({ active: false })).toBe('SET ASIDE');
    expect(addonShopifyStatus(CLOTH)).toBe('NOT LINKED');
    expect(addonShopifyStatus({ shopifyProductId: '1', sku: { ...CLOTH.sku } })).toBe('LINKED · NO VARIANT');
    expect(addonShopifyStatus({ shopifyProductId: '1', sku: { ...CLOTH.sku, shopifyVariantId: '2' } })).toBe('LINKED');
  });

  it('opens its dialog with its values, a supplier among the active ones and its own', () => {
    expect(addonFormValues(null)).toEqual({ name: '', line: '', skuCode: '', supplierId: '', weightG: '', EUR: '', GBP: '', USD: '', CHF: '' });
    expect(addonFormValues(CLOTH)).toEqual({ name: 'POLISHING CLOTH', line: 'For silver and gold.', skuCode: 'ADD-CLOTH', supplierId: SUP, weightG: '20', EUR: '15', GBP: '', USD: '', CHF: '16.50' });
    const suppliers = [
      { id: SUP, name: 'MAISON SOIE', active: false },
      { id: ID, name: 'NORD', active: true },
      { id: UK, name: 'OLD', active: false },
    ];
    expect(addonSupplierOptions(suppliers, CLOTH)).toEqual([
      { value: '', label: 'None' },
      { value: SUP, label: 'MAISON SOIE · INACTIVE' },
      { value: ID, label: 'NORD' },
    ]);
    expect(addonSupplierOptions(suppliers, null).map((o) => o.label)).toEqual(['None', 'NORD']);
  });

  it('refuses before sending what the server would refuse', () => {
    const fresh = (extra: Partial<AddonForm>) => ({ ...addonFormValues(null), name: 'POLISHING CLOTH', skuCode: 'add-cloth', ...extra });
    expect(addonProblem(fresh({}), true)).toBeNull();
    expect(addonProblem(fresh({ name: ' ' }), true)).toBe('Name the add-on.');
    expect(addonProblem(fresh({ name: 'X'.repeat(41) }), true)).toBe('A name has at most 40 characters.');
    expect(addonProblem(fresh({ line: 'Y'.repeat(121) }), true)).toBe('Its line has at most 120 characters.');
    expect(addonProblem(fresh({ skuCode: '-CLOTH' }), true)).toBe('A SKU code is 2 to 64 capitals, digits and hyphens, starting with a capital or a digit: ADD-CLOTH.');
    expect(addonProblem(fresh({ skuCode: '' }), false)).toBeNull();
    expect(addonProblem(fresh({ weightG: '0' }), true)).toBe(`The weight is a whole number of grams, 1 to 30${T}000.`);
    expect(addonProblem(fresh({ weightG: '30001' }), true)).toBe(`The weight is a whole number of grams, 1 to 30${T}000.`);
    expect(addonProblem(fresh({ GBP: '12,5' }), true)).toBeNull();
    expect(addonProblem(fresh({ USD: 'twelve' }), true)).toBe('The price in USD reads 15, or 15.50.');
    expect(addonProblem(fresh({ CHF: '1000001' }), true)).toBe('The price in CHF reads 15, or 15.50.');
  });

  it('sends a creation with its SKU code in capitals and the prices given; an edit only what changed', () => {
    expect(addonCreateInput({ ...addonFormValues(null), name: ' POLISHING CLOTH ', skuCode: 'add-cloth', weightG: '20', EUR: '15', CHF: '16.5' })).toEqual({
      name: 'POLISHING CLOTH',
      skuCode: 'ADD-CLOTH',
      weightG: 20,
      prices: { EUR: 1500, CHF: 1650 },
    });
    expect(addonCreateInput({ ...addonFormValues(null), name: 'X', skuCode: 'X1', line: 'One line', supplierId: SUP })).toEqual({ name: 'X', skuCode: 'X1', line: 'One line', supplierId: SUP });
    const same = addonChange(CLOTH, form());
    expect(same).toEqual({ fields: {}, prices: {} });
    expect(addonUnchanged(same)).toBe(true);
    expect(addonChange(CLOTH, form({ line: '', weightG: '', supplierId: '', EUR: '16', CHF: '', GBP: '12' }))).toEqual({
      fields: { line: null, supplierId: null, weightG: null },
      prices: { EUR: 1600, GBP: 1200, CHF: null },
    });
  });

  it('checks the Shopify ids pasted back and sends them, a variant only with its product', () => {
    expect(addonShopifyProblem(CLOTH, { productId: '', variantId: '' })).toBe('Nothing has changed.');
    expect(addonShopifyProblem(CLOTH, { productId: '', variantId: '42' })).toBe('A variant id is pasted with its product id.');
    expect(addonShopifyProblem(CLOTH, { productId: 'abc', variantId: '' })).toBe('The product id is the number at the end of the product’s address in Shopify’s admin.');
    expect(addonShopifyProblem(CLOTH, { productId: 'https://admin.shopify.com/store/orbes/products/77', variantId: '88' })).toBeNull();
    expect(addonShopifyInput({ productId: 'https://admin.shopify.com/store/orbes/products/77', variantId: '88' })).toEqual({ productId: '77', variantId: '88' });
    expect(addonShopifyInput({ productId: '', variantId: '88' })).toEqual({ productId: null, variantId: null });
  });
});

describe('an add-on\'s SKU in Logistics and the supplier orders', () => {
  const SKU: LogisticsSku = { id: ID, code: 'ADD-CLOTH', model: null, addon: { id: ID, name: 'POLISHING CLOTH' }, variant: null, sizeLabel: null, setAside: false };
  const SIZE: LogisticsSku = { id: ID, code: 'MNL-52', model: { id: ID, name: 'MONOLITHE' }, addon: null, variant: 'BLUE', sizeLabel: '52', setAside: false };

  it('is named by its add-on, never a size', () => {
    expect(skuWords(SKU)).toBe('POLISHING CLOTH');
    expect(skuWords(SIZE)).toBe('MONOLITHE · BLUE · 52');
    expect(skuSizeText(SKU)).toBe('—');
    expect(skuSizeText({ model: SIZE.model, sizeLabel: null })).toBe('ONE SIZE');
    expect(skuOwnerName(SKU)).toBe('POLISHING CLOTH');
    expect(skuOwnerName(SIZE)).toBe('MONOLITHE');
    expect(noSupplierLine(SKU)).toBe('No supplier set for POLISHING CLOTH: set it in Catalogue → Add-ons.');
    expect(noSupplierLine(SIZE)).toBe('No supplier set for MONOLITHE · BLUE · 52: set it on the model’s page.');
  });

  it('is counted into stock at a reception\'s confirmation without an identity or a card', () => {
    const view = { supplierOrder: { id: ID, reference: 'SO-0F0E0D0C' }, location: { id: FR, name: 'FRANCE WAREHOUSE' }, rejected: 0 };
    expect(confirmReceptionText({ ...view, accepted: 5, lines: [{ sku: SKU, accepted: 5 }] })).toBe('5 add-ons enter the stock at FRANCE WAREHOUSE as counted, with no ORBES CODE and no card.');
    expect(confirmReceptionText({ ...view, accepted: 3, lines: [{ sku: SIZE, accepted: 2 }, { sku: SKU, accepted: 1 }] })).toBe(
      '2 pieces get their ORBES identity now: a serial, a signed ORBES code and a claim code each. They enter the stock at FRANCE WAREHOUSE and go to the orders waiting for them, the oldest first. The agent then prints their cards. 1 add-on enters the stock at FRANCE WAREHOUSE as counted, with no ORBES CODE and no card.',
    );
  });
});

describe('the order page\'s Add-ons', () => {
  it('groups the units by add-on, price, state and who added them', () => {
    const units = [
      unit({ id: 'u1' }),
      unit({ id: 'u2' }),
      unit({ id: 'u3', addedBy: { type: 'COLLECTOR', id: 'acc' }, invoiceId: 'inv' }),
      unit({ id: 'u4', addon: { id: SUP, name: 'CHAIN EXTENDER' }, skuCode: 'ADD-EXT', priceMinor: 3000, status: 'REMOVED', addedBy: { type: 'PURCHASE', id: null } }),
    ];
    const groups = addonGroups(units);
    expect(groups.map((g) => [g.name, g.units, g.status, g.unitIds])).toEqual([
      ['POLISHING CLOTH', 2, 'HELD', ['u1', 'u2']],
      ['POLISHING CLOTH', 1, 'HELD', ['u3']],
      ['CHAIN EXTENDER', 1, 'REMOVED', ['u4']],
    ]);
    expect(groupPriceText(groups[0]!)).toBe(`€${N}15 each · €${N}30`);
    expect(groupPriceText(groups[2]!)).toBe(`€${N}30`);
    expect(addedByText(groups[0]!.addedBy, { [ADMIN]: 'ops@orbes.test' })).toBe('ops@orbes.test');
    expect(addedByText(groups[0]!.addedBy, {})).toBe('A console user');
    expect(addedByText(groups[1]!.addedBy, {})).toBe('The collector, in YOUR ORDERS');
    expect(addedByText(groups[2]!.addedBy, {})).toBe('At the purchase');
    expect(returnedLine({ status: 'RETURNED', returnedToStock: false })).toBe('Not to be sold again');
    expect(returnedLine({ status: 'RETURNED', returnedToStock: true })).toBe('Back to stock');
    expect(returnedLine({ status: 'HELD', returnedToStock: null })).toBeNull();
    expect(documentAddonLine(units, 'inv')).toBe('For POLISHING CLOTH × 1');
    expect(documentAddonLine(units, 'other')).toBeNull();
    // Lot Q2 (D4): a service's units are held nowhere, read as a service, grouped apart from a product's.
    const wrap = addonGroups([unit({ id: 's1', addon: { id: UK, name: 'GIFT WRAPPING' }, location: null }), unit({ id: 's2', addon: { id: UK, name: 'GIFT WRAPPING' }, location: null })]);
    expect(wrap.map((g) => [g.name, g.units, g.location])).toEqual([['GIFT WRAPPING', 2, 'Service']]);
  });

  it('offers Add an add-on to OPERATOR on an order RESERVED or PAID that takes add-ons, Remove on a unit held on an order RESERVED or PAID (the server refusing once the parcel is packed)', () => {
    const o = { channel: 'DRAW' as const, shopifyOrderId: null, status: 'PAID' as const, currency: 'EUR' as const };
    expect(orderTakesAddons(o)).toBe(true);
    expect(orderTakesAddons({ ...o, channel: 'GIFT' })).toBe(false);
    expect(orderTakesAddons({ ...o, channel: 'EXCHANGE' })).toBe(false);
    expect(orderTakesAddons({ ...o, shopifyOrderId: '9' })).toBe(false);
    expect(canAddAddon(o, true)).toBe(true);
    expect(canAddAddon(o, false)).toBe(false);
    expect(canAddAddon({ ...o, status: 'SHIPPED' }, true)).toBe(false);
    expect(canAddAddon({ ...o, currency: null }, true)).toBe(false);
    expect(canRemoveAddon(o, { status: 'HELD' }, true)).toBe(true);
    expect(canRemoveAddon(o, { status: 'SHIPPED' }, true)).toBe(false);
    expect(canRemoveAddon({ status: 'SHIPPED' }, { status: 'HELD' }, true)).toBe(false);
  });

  it('lists the add-ons offered, checks the units against what is in stock and says the total', () => {
    expect(addonOfferOptions(OFFER)).toEqual([
      { value: ID, label: `POLISHING CLOTH · €${N}15 · up to 3` },
      { value: SUP, label: `CHAIN EXTENDER · €${N}30 · up to 1` },
    ]);
    expect(addAddonProblem(OFFER, { addonId: '', units: '1' })).toBe('Choose an add-on.');
    expect(addAddonProblem(OFFER, { addonId: SUP, units: '2' })).toBe('CHAIN EXTENDER: 1 can be added.');
    expect(addAddonProblem(OFFER, { addonId: ID, units: '3' })).toBeNull();
    expect(addAddonTotal(OFFER, { addonId: ID, units: '2' })).toBe(`2 × €${N}15 = €${N}30`);
    expect(addAddonTotal(OFFER, { addonId: '', units: '2' })).toBeNull();
    expect(noOfferText({ ...OFFER, offer: [] }, 'FRANCE WAREHOUSE')).toBe('No add-on is in stock at FRANCE WAREHOUSE with a price in EUR just now.');
    expect(noOfferText({ ...OFFER, offer: [], canAdd: false, reason: 'NO_CURRENCY', currency: null }, 'FRANCE WAREHOUSE')).toBe('Add-ons are offered once the order’s price and currency are entered.');
    expect(noOfferText({ ...OFFER, offer: [], canAdd: false, reason: 'PACKED' }, 'FRANCE WAREHOUSE')).toBe('The parcel is packed: it no longer changes.');
  });

  it('lists a refund\'s shipped units, one line each', () => {
    const units = [unit({ id: 'a', status: 'SHIPPED' }), unit({ id: 'b', status: 'SHIPPED' }), unit({ id: 'c', status: 'REMOVED' }), unit({ id: 'd', status: 'SHIPPED', addon: { id: SUP, name: 'CHAIN EXTENDER' } })];
    expect(shippedUnits(units)).toEqual([
      { value: 'a', label: 'POLISHING CLOTH · 1 of 2' },
      { value: 'b', label: 'POLISHING CLOTH · 2 of 2' },
      { value: 'd', label: 'CHAIN EXTENDER' },
    ]);
  });
});

describe('the draw\'s Confirm and the salon\'s Accept', () => {
  it('say the collector\'s choices, priced when the currency is known, and what was left out after', () => {
    const choices = [
      { addonId: ID, name: 'POLISHING CLOTH', line: null, units: 2, priceMinor: 1500 },
      { addonId: SUP, name: 'CHAIN EXTENDER', line: null, units: 1, priceMinor: null },
    ];
    expect(choiceLines(choices, 'EUR')).toEqual([`POLISHING CLOTH × 2 · €${N}30`, 'CHAIN EXTENDER × 1']);
    expect(choiceLines(choices, null)).toEqual(['POLISHING CLOTH × 2', 'CHAIN EXTENDER × 1']);
    expect(
      leftOutLines([
        { addonId: ID, name: 'POLISHING CLOTH', units: 2, reason: 'NONE_LEFT' },
        { addonId: SUP, name: 'CHAIN EXTENDER', units: 1, reason: 'NOT_OFFERED' },
      ]),
    ).toEqual(['POLISHING CLOTH × 2: none left.', 'CHAIN EXTENDER × 1: no longer offered.']);
  });
});

describe('the parcel and its slips', () => {
  it('pack the catalogue add-ons with their units after the release\'s, never a price', () => {
    expect(parcelAddonWords({ addons: ['GIFT BOX'], addonItems: [{ name: 'POLISHING CLOTH', units: 2 }] })).toEqual(['GIFT BOX', 'POLISHING CLOTH × 2']);
    expect(orderPackedAddons([unit({ id: 'a' }), unit({ id: 'b', status: 'SHIPPED' }), unit({ id: 'c', status: 'REMOVED' })])).toEqual(['POLISHING CLOTH × 2']);
    const slip = shippingSlip({
      id: ID,
      reference: 'OR-0F0E0D0C',
      orders: [{ orderId: ID, reference: 'OR-0F0E0D0C', status: 'PAID', model: 'MONOLITHE', variant: null, sizeLabel: '52', skuCode: 'MNL-52', addons: [], addonItems: [{ name: 'POLISHING CLOTH', units: 1 }], engraving: null, surprise: null, piece: null }],
      shipTo: { name: null, address: null, country: null, phone: null },
      addressChanged: null,
      packing: { box: null, boxSource: null, unboxed: [], weightG: null, missing: [], boxes: [], recorded: false },
    } as unknown as Parameters<typeof shippingSlip>[0]);
    expect(slip.pieces[0]!.addons).toEqual(['POLISHING CLOTH × 1']);
  });
});

describe('the words', () => {
  it('are calm: no atelier, handmade or craft, no exclamation mark', () => {
    for (const file of ['model/addons.ts', 'views/addons.ts']) {
      const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/admin', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code).not.toMatch(/atelier|handmade|hand-made|craft|!['"`]/i);
    }
    expect(ADDONS_TEXT.empty).toBe('No add-on yet.');
    expect(ORDER_ADDONS_TEXT.paidAdd).toBe('The order is paid: the add-on is added with its own invoice, in Documents.');
  });
});

describe('the API client', () => {
  it('calls the add-ons\' and an order\'s add-on routes with their methods and bodies, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.addons();
    await api.createAddon({ name: 'POLISHING CLOTH', skuCode: 'ADD-CLOTH', prices: { EUR: 1500 } });
    await api.updateAddon(ID, { weightG: 20 });
    await api.setAddonPrices(ID, { EUR: 1600, CHF: null });
    await api.setAddonAside(ID);
    await api.reinstateAddon(ID);
    await api.linkAddonShopify(ID, { productId: '77', variantId: '88' });
    await api.orderAddonOffer(FR);
    await api.addOrderAddon(FR, { addonId: ID, units: 2 });
    await api.removeOrderAddon(FR, UK);
    await api.decideOrderCase(SUP, { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: FR, note: 'Back.', addonsOut: [UK] });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/addons',
      'POST /api/admin/addons',
      `PATCH /api/admin/addons/${ID}`,
      `PUT /api/admin/addons/${ID}/prices`,
      `POST /api/admin/addons/${ID}/set-aside`,
      `POST /api/admin/addons/${ID}/reinstate`,
      `PUT /api/admin/addons/${ID}/shopify`,
      `GET /api/admin/orders/${FR}/addons`,
      `POST /api/admin/orders/${FR}/addons`,
      `DELETE /api/admin/orders/${FR}/addons/${UK}`,
      `POST /api/admin/order-cases/${SUP}/decide`,
    ]);
    const bodies = calls.filter((c) => c.init.method !== 'GET' && c.init.method !== 'DELETE').map((c) => JSON.parse(String(c.init.body)));
    expect(bodies).toEqual([
      { name: 'POLISHING CLOTH', skuCode: 'ADD-CLOTH', prices: { EUR: 1500 } },
      { weightG: 20 },
      { prices: { EUR: 1600, CHF: null } },
      {},
      {},
      { productId: '77', variantId: '88' },
      { addonId: ID, units: 2 },
      { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: FR, note: 'Back.', addonsOut: [UK] },
    ]);
    for (const c of calls.filter((x) => x.init.method !== 'GET')) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});
