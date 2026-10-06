/**
 * The console's client sheet and Shopify readiness (plan LIVE RELEASE+, step S9), as pure functions: what the
 * Catalogue says of a model's base price and Shopify product, what the product export will hold, the ids pasted back
 * as the server reads them, the order export's period; the client sheet's steps, lines and words. And, at compile
 * time, that the console reads exactly what the server sends.
 */
import { describe, expect, it } from 'vitest';
import type { OwnerSheet as ServerOwnerSheet } from '../../src/server/services/owners.js';
import type { ClientOrder as ServerClientOrder } from '../../src/server/services/fulfilment.js';
import { SHOPIFY_PERIOD_MAX_DAYS as SERVER_PERIOD_MAX, shopifyIdOf, type ShopifyProduct as ServerShopifyProduct } from '../../src/server/services/shopify.js';
import { formatMoney } from '../../src/web/admin/model/live.js';
import { INTEREST_OUTCOME_LABELS, NOTE_ABOUT_LABELS, orderSteps, participationLine, RELEASE_KIND_LABELS } from '../../src/web/admin/model/owners.js';
import {
  basePriceText,
  defaultPeriod,
  pastedShopifyId,
  periodProblem,
  productExportSummary,
  SHOPIFY_CURRENCY_OPTIONS,
  SHOPIFY_PERIOD_MAX_DAYS,
  shopifyLinkInput,
  shopifyLinkProblem,
  shopifyStatus,
  shopifyValues,
  variantField,
} from '../../src/web/admin/model/shopify.js';
import type * as web from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
/** The client sheet as the route sends it: the owner's sheet and the collector's orders (routes/admin/owners.ts). */
export const clientSheetFits = (s: Json<Omit<ServerOwnerSheet, 'owner'>> & { orders: Json<ServerClientOrder>[] }): Omit<web.OwnerSheet, 'owner'> => s;
export const shopifyProductFits = (p: Json<ServerShopifyProduct>): web.ShopifyProduct => p;

describe('the Catalogue\'s base price and Shopify product (N2)', () => {
  const m = (extra: Partial<web.Model> = {}) => ({ basePriceMinor: null, baseCurrency: null, shopify: { productId: null, variants: 3, linked: 0 }, ...extra }) as web.Model;

  it('says the base price, and how far the model is linked to its Shopify product', () => {
    expect(basePriceText(m())).toBe('None');
    expect(basePriceText(m({ basePriceMinor: 480_050, baseCurrency: 'EUR' }))).toBe(formatMoney(480_050, 'EUR'));
    expect(shopifyStatus(m())).toBe('NOT LINKED');
    expect(shopifyStatus(m({ shopify: { productId: '9001', variants: 3, linked: 2 } }))).toBe('LINKED · 2 OF 3 SIZES');
    expect(shopifyStatus(m({ shopify: { productId: '9001', variants: 3, linked: 3 } }))).toBe('LINKED');
    expect(typeof shopifyProductFits).toBe('function');
    expect(typeof clientSheetFits).toBe('function');
  });

  it('says what the product export holds in a currency, and what it leaves out', () => {
    const models = [m({ id: 'a', basePriceMinor: 1, baseCurrency: 'EUR' }), m({ id: 'b', basePriceMinor: 1, baseCurrency: 'EUR' }), m({ id: 'c', basePriceMinor: 1, baseCurrency: 'USD' }), m({ id: 'd' })];
    expect(productExportSummary(models, 'EUR')).toBe(
      '2 models priced in EUR, each a product with its sizes as variants and its photographs. 1 model priced in another currency is left out. 1 model without a base price is left out: set it with Edit. Each product is a draft, not published: Shopify decides nothing until the store is open.',
    );
    // NOCTURNE N1: a model and its variants are one product.
    const grouped = [...models, m({ id: 'e', basePriceMinor: 1, baseCurrency: 'EUR', variantOf: { id: 'a', name: 'MONOLITHE', label: 'Steel' } })];
    expect(productExportSummary(grouped, 'EUR')).toMatch(/^3 models priced in EUR, in 2 products: a model and its variants are one product, by Variant and Size, with their photographs\. /);
    expect(productExportSummary([m()], 'CHF')).toBe(
      'No model has a base price in CHF: the file holds its header only. 1 model without a base price is left out: set it with Edit. Each product is a draft, not published: Shopify decides nothing until the store is open.',
    );
    expect(SHOPIFY_CURRENCY_OPTIONS.map((o) => o.value)).toEqual(['EUR', 'GBP', 'USD', 'CHF']);
  });

  it('reads a pasted id as the server reads it: the number, or the address of its page', () => {
    const inputs = ['8123456789', ' https://admin.shopify.com/store/orbes/products/8123456789 ', 'https://admin.shopify.com/store/orbes/products/81/variants/4401?x=1', '', '0123', 'abc', '1'.repeat(21)];
    for (const kind of ['products', 'variants'] as const) {
      for (const input of inputs) {
        let server: string | null | undefined;
        try {
          server = shopifyIdOf(input, kind);
        } catch {
          server = undefined;
        }
        expect(pastedShopifyId(input, kind), `${kind} ${input}`).toBe(server);
      }
    }
  });

  it('opens the ids\' dialog with the model\'s, sends every size with its id, and says a mistake before it is sent', () => {
    const p: web.ShopifyProduct = {
      model: { id: 'm1', name: 'MONOLITHE', skuPrefix: 'MNL-RG' },
      handle: 'monolithe',
      productId: null,
      variants: [
        { size: null, sku: 'MNL-RG', known: true, variantId: null },
        { size: '52', sku: 'MNL-RG-52', known: true, variantId: null },
      ],
    };
    const v = shopifyValues(p);
    expect(v).toEqual({ productId: '', [variantField(0)]: '', [variantField(1)]: '' });
    expect(shopifyLinkProblem(p, v)).toBe('Nothing has changed.');
    expect(shopifyLinkProblem(p, { ...v, productId: 'nope' })).toMatch(/^The product id is the number/);
    expect(shopifyLinkProblem(p, { ...v, productId: '9001', [variantField(1)]: 'x' })).toMatch(/^A variant id is the number/);
    expect(shopifyLinkProblem(p, { ...v, [variantField(1)]: '52' })).toBe('A variant id is pasted with its product id.');
    expect(shopifyLinkProblem(p, { ...v, productId: '9001', [variantField(0)]: '7', [variantField(1)]: '7' })).toBe('Each variant id belongs to one size.');
    const filled = { productId: 'https://admin.shopify.com/store/orbes/products/9001', [variantField(0)]: '5200', [variantField(1)]: 'https://admin.shopify.com/store/orbes/products/9001/variants/5201' };
    expect(shopifyLinkProblem(p, filled)).toBeNull();
    expect(shopifyLinkInput(p, filled)).toEqual({ productId: '9001', variants: [{ size: null, variantId: '5200' }, { size: '52', variantId: '5201' }] });
    const linked = { ...p, productId: '9001', variants: p.variants.map((x, i) => ({ ...x, variantId: ['5200', '5201'][i]! })) };
    expect(shopifyLinkProblem(linked, shopifyValues(linked))).toBe('Nothing has changed.');
    // The product cleared: every variant goes with it.
    expect(shopifyLinkInput(linked, { ...shopifyValues(linked), productId: '' })).toEqual({ productId: null, variants: [{ size: null, variantId: null }, { size: '52', variantId: null }] });
    expect(shopifyLinkProblem(linked, { ...shopifyValues(linked), productId: '' })).toBe('A variant id is pasted with its product id.');
    expect(shopifyLinkProblem(linked, { productId: '', [variantField(0)]: '', [variantField(1)]: '' })).toBeNull();
  });

  it('proposes the month to today as the order export\'s period, and holds it to the server\'s bounds', () => {
    expect(defaultPeriod(new Date('2026-11-17T23:30:00.000Z'))).toEqual({ from: '2026-11-01', to: '2026-11-17' });
    expect(SHOPIFY_PERIOD_MAX_DAYS).toBe(SERVER_PERIOD_MAX);
    expect(periodProblem('2026-11-01', '2026-11-30')).toBeNull();
    expect(periodProblem('2026-01-01', '2026-12-31')).toBeNull();
    expect(periodProblem('2025-12-31', '2026-12-31')).toBeNull();
    expect(periodProblem('2025-12-30', '2026-12-31')).toBe('A period is at most 366 days.');
    expect(periodProblem('2026-11-30', '2026-11-01')).toBe('The last day comes on or after the first.');
    for (const [a, b] of [['', '2026-11-01'], ['2026-02-30', '2026-03-01'], ['2026-11', '2026-11-30']]) expect(periodProblem(a, b), `${a} ${b}`).toBe('Choose the first and the last day.');
  });
});

describe('the client sheet (N4)', () => {
  it('lists the steps an order reached, each with its date, in order', () => {
    const steps = { reservedAt: '2026-11-02T09:00:00.000Z', paidAt: '2026-11-03T09:00:00.000Z', shippedAt: null, deliveredAt: null, cancelledAt: '2026-11-04T09:00:00.000Z', returnedAt: null };
    expect(orderSteps({ steps })).toEqual([
      { step: 'RESERVED', at: '2026-11-02T09:00:00.000Z' },
      { step: 'PAID', at: '2026-11-03T09:00:00.000Z' },
      { step: 'CANCELLED', at: '2026-11-04T09:00:00.000Z' },
    ]);
    const all = { reservedAt: 'a', paidAt: 'b', shippedAt: 'c', deliveredAt: 'd', cancelledAt: null, returnedAt: 'e' };
    expect(orderSteps({ steps: all }).map((x) => x.step)).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'RETURNED']);
  });

  it('says the releases taken part in and the pieces secured, and names each outcome and note', () => {
    expect(participationLine({ count: 3, secured: 2 })).toBe('3 releases taken part in · 2 pieces secured');
    expect(participationLine({ count: 1, secured: 1 })).toBe('1 release taken part in · 1 piece secured');
    expect(participationLine({ count: 0, secured: 0 })).toBe('0 releases taken part in · 0 pieces secured');
    expect(Object.values(INTEREST_OUTCOME_LABELS)).toEqual(['UPCOMING', 'CAME', 'DID NOT COME', 'CANCELLED']);
    expect(NOTE_ABOUT_LABELS).toEqual({ ORDER: 'Order', DRAW: 'Draw', SALON: 'Private salon', LIVE: 'LIVE RELEASE' });
    expect(RELEASE_KIND_LABELS).toEqual({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW' });
  });
});
