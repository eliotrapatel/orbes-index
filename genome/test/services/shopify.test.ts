/**
 * Shopify readiness (plan LIVE RELEASE+ of 2026-10-04, step S9: choices 24 and 25, N2 and N3), on the services as
 * createContext wires them. Nothing calls Shopify: the files are in its formats, the ids come back pasted.
 *
 *  - the columns against Shopify's published formats: every column written is one of the published list, spelled as
 *    Shopify spells it, in the published order; the required ones are there (a product's Title and URL handle, its
 *    Option1 name and value, without which Shopify replaces the variants; an order's Name);
 *  - NOCTURNE N1: a model and its variants one product, the main model's (Option1 Variant, Option2 Size, each model's
 *    SKUs, price and photographs, its cover the image of its variants), a variant linked to its main model's product;
 *  - the product CSV: the models priced in the store's currency, one product each, its sizes as variants (Option1
 *    Size, naturally sorted, ONE SIZE first; a model in one size is Shopify's single variant), each with its SKU and the
 *    base price, its photographs by their absolute address (the cover, then the gallery), a draft not published
 *    (archived once inactive); the handle its lookbook address or its name, never shared;
 *  - the ids pasted back: the number or the address of the page, on the model's SKUs, the SKU of a model never issued
 *    made for it, audited `model.shopify`; refusals: an unknown size, an id given twice, a variant without its product,
 *    another model's product, another size's variant; nothing written when nothing changes;
 *  - the order CSV: the priced orders reserved in a period (UTC days), the piece then each add-on as line items, the
 *    steps as Shopify's statuses and dates, the buyer as billing and shipping, the collector's email (masked as the
 *    caller's view says), no tax, no shipping fee; the period's bounds.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { orderReference } from '../../src/server/services/orders.js';
import {
  compareSizes,
  SHOPIFY_ORDER_COLUMNS,
  SHOPIFY_PRODUCT_COLUMNS,
  shopifyDate,
  shopifyFinancialStatus,
  shopifyFulfilled,
  shopifyHandle,
  shopifyIdOf,
} from '../../src/server/services/shopify.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { countPiecesIn, packAndShip } from '../support/fulfil.js';
import { accountOfTier, createAccount, createLiveRelease, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';

/**
 * Shopify's product CSV columns as its help center publishes them (« Using CSV files to import and export products »,
 * help.shopify.com/en/manual/products/import-export/using-csv, read 2026-10-05), in their order.
 */
const PUBLISHED_PRODUCT_COLUMNS = [
  'Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Type', 'Tags', 'Published on online store', 'Status', 'SKU', 'Barcode',
  'Option1 name', 'Option1 value', 'Option1 Linked To', 'Option2 name', 'Option2 value', 'Option2 Linked To', 'Option3 name', 'Option3 value',
  'Option3 Linked To', 'Price', 'Price / International', 'Compare-at price', 'Compare-at price / International', 'Cost per item', 'Charge tax',
  'Tax code', 'Inventory tracker', 'Inventory quantity', 'Continue selling when out of stock', 'Weight value (grams)', 'Weight unit for display',
  'Requires shipping', 'Fulfillment service', 'Product image URL', 'Image position', 'Image alt text', 'Variant image URL', 'Gift card', 'SEO title',
  'SEO description', 'Google Shopping / Google Product Category', 'Metafields',
];

/**
 * Shopify's order CSV columns as its help center publishes them (« Exporting orders »,
 * help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders, read 2026-10-05), in their order.
 */
const PUBLISHED_ORDER_COLUMNS = [
  'Name', 'Phone', 'Email', 'Financial Status', 'Paid at', 'Fulfillment Status', 'Fulfilled at', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping',
  'Taxes', 'Total', 'Discount Code', 'Discount Amount', 'Shipping Method', 'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price',
  'Lineitem compare-at price', 'Lineitem SKU', 'Lineitem requires shipping', 'Lineitem taxable', 'Lineitem fulfillment status', 'Billing Name',
  'Billing Street', 'Billing Address1', 'Billing Address2', 'Billing Company', 'Billing City', 'Billing Zip', 'Billing Province', 'Billing Province Name',
  'Billing Country', 'Billing Phone', 'Shipping Name', 'Shipping Street', 'Shipping Address1', 'Shipping Address2', 'Shipping Company', 'Shipping City',
  'Shipping Zip', 'Shipping Province', 'Shipping Province Name', 'Shipping Country', 'Shipping Phone', 'Notes', 'Note Attributes', 'Canceled at',
  'Payment Method', 'Payment Reference', 'Payment References', 'Refunded Amount', 'Vendor', 'Outstanding Balance', 'Employee', 'Location', 'Device ID',
  'Id', 'Tags', 'Risk Level', 'Source', 'Lineitem discount', 'Tax # Name', 'Tax # Value', 'Phone', 'Payment ID', 'Payment terms', 'Next payment due at',
];

/** Whether `ours` appears in `published` in the same order, each spelled exactly so. */
function inPublishedOrder(ours: readonly string[], published: readonly string[]): boolean {
  let at = -1;
  for (const c of ours) {
    const i = published.indexOf(c, at + 1);
    if (i < 0) return false;
    at = i;
  }
  return true;
}

/** RFC 4180 rows (render/csv.ts writes every field quoted, CRLF). */
function parseCsv(body: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && body[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}

/** The CSV's rows as records by column. */
function records(body: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(body);
  for (const r of rows) expect(r.length).toBe(head!.length);
  return rows.map((r) => Object.fromEntries(head!.map((c, i) => [c, r[i]!])));
}

async function rejects(p: Promise<unknown>, code: string): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  return e as DomainError;
}

describe('Shopify\'s formats (N2, N3, pure)', () => {
  it('writes only columns of Shopify\'s published product format, spelled as published, in its order, the required ones included', () => {
    expect(inPublishedOrder(SHOPIFY_PRODUCT_COLUMNS, PUBLISHED_PRODUCT_COLUMNS)).toBe(true);
    expect(new Set(SHOPIFY_PRODUCT_COLUMNS).size).toBe(SHOPIFY_PRODUCT_COLUMNS.length);
    for (const c of ['Title', 'URL handle', 'Option1 name', 'Option1 value', 'SKU', 'Price', 'Product image URL']) expect(SHOPIFY_PRODUCT_COLUMNS).toContain(c);
  });

  it('writes only columns of Shopify\'s published order format, spelled as published, in its order, the order\'s name first', () => {
    expect(inPublishedOrder(SHOPIFY_ORDER_COLUMNS, PUBLISHED_ORDER_COLUMNS)).toBe(true);
    expect(new Set(SHOPIFY_ORDER_COLUMNS).size).toBe(SHOPIFY_ORDER_COLUMNS.length);
    expect(SHOPIFY_ORDER_COLUMNS[0]).toBe('Name');
    for (const c of ['Email', 'Financial Status', 'Fulfillment Status', 'Currency', 'Total', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem SKU']) {
      expect(SHOPIFY_ORDER_COLUMNS).toContain(c);
    }
  });

  it('says each step as Shopify\'s statuses, and a date as its exports write one', () => {
    expect(shopifyFinancialStatus('RESERVED', false)).toBe('pending');
    for (const s of ['PAID', 'SHIPPED', 'DELIVERED'] as const) expect(shopifyFinancialStatus(s, true)).toBe('paid');
    expect(shopifyFinancialStatus('CANCELLED', false)).toBe('voided');
    expect(shopifyFinancialStatus('CANCELLED', true)).toBe('refunded');
    expect(shopifyFinancialStatus('RETURNED', true)).toBe('refunded');
    expect(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'].map((s) => shopifyFulfilled(s as never))).toEqual([false, false, true, true, false, true]);
    expect(shopifyDate(new Date('2026-10-05T14:03:09.120Z'))).toBe('2026-10-05 14:03:09 +0000');
    expect(shopifyDate(null)).toBe('');
  });

  it('makes a handle of the lookbook address or of the name; sorts sizes as a client reads them; reads a pasted id or its address', () => {
    expect(shopifyHandle({ name: 'MONOLITHE II', slug: null, skuPrefix: 'MNL-RG' })).toBe('monolithe-ii');
    expect(shopifyHandle({ name: 'Éclipse — Nuit', slug: null, skuPrefix: 'ECL' })).toBe('eclipse-nuit');
    expect(shopifyHandle({ name: 'MONOLITHE', slug: 'monolithe-ring', skuPrefix: 'MNL-RG' })).toBe('monolithe-ring');
    expect(shopifyHandle({ name: '—', slug: null, skuPrefix: 'MNL-RG' })).toBe('mnl-rg');
    expect(['56', null, '8', 'L', '48', 'S'].sort(compareSizes)).toEqual([null, '8', '48', '56', 'L', 'S']);
    expect(shopifyIdOf('8123456789', 'products')).toBe('8123456789');
    expect(shopifyIdOf(' https://admin.shopify.com/store/orbes/products/8123456789 ', 'products')).toBe('8123456789');
    expect(shopifyIdOf('https://admin.shopify.com/store/orbes/products/8123456789/variants/4401?x=1', 'variants')).toBe('4401');
    expect(shopifyIdOf('', 'variants')).toBeNull();
    expect(shopifyIdOf(null, 'variants')).toBeNull();
    for (const bad of ['0123', 'abc', 'https://admin.shopify.com/store/orbes/products/0', '1'.repeat(21)]) expect(() => shopifyIdOf(bad, 'products'), bad).toThrow(DomainError);
  });
});

describe('the Shopify exports and the ids pasted back (plan LIVE RELEASE+, S9)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let france: string;
  let colissimo: string;
  const ORIGIN = 'https://verify.orbes.test';
  const asStored = { email: (e: string) => e, buyer: (b: { name: string | null; address: string | null }) => b };

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig({ publicOrigin: ORIGIN }), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    france = (await t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    colissimo = (await t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const shopify = () => ctx.services.shopify;
  const skuOf = (modelId: string, label: string | null) => inTransaction(t.db, (tx) => ensureSku(tx, modelId, label));
  const price = (modelId: string, minor: number, currency: 'EUR' | 'USD' = 'EUR') => ctx.services.catalog.updateModel(modelId, { basePriceMinor: minor, baseCurrency: currency }, f.admin);
  /** A stored photograph's address (content-addressed: the SHA-256 of its bytes), by a letter. */
  const bytesOf = (c: string) => new TextEncoder().encode(`photograph ${c}`);
  const sha = (c: string) => createHash('sha256').update(bytesOf(c)).digest('hex');

  async function photo(modelId: string, cover: string, gallery: { sha256: string; alt: string | null }[]) {
    for (const c of ['a', 'b', 'c', 'd', 'e']) {
      await t.db.insertInto('media_objects').values({ sha256: sha(c), mime: 'image/jpeg', width: 8, height: 8, bytes: bytesOf(c), created_at: clock.now() }).onConflict((oc) => oc.doNothing()).execute();
    }
    await t.db.updateTable('models').set({ image_sha256: cover }).where('id', '=', modelId).execute();
    if (gallery.length) await t.db.insertInto('model_images').values(gallery.map((g, i) => ({ model_id: modelId, sha256: g.sha256, alt: g.alt, position: i + 1 }))).execute();
  }

  it('exports the models priced in the store\'s currency as Shopify products: sizes as variants, SKUs, base price, photographs', async () => {
    const ring = await createModel(t.db, 'ORBITE');
    await t.db.updateTable('models').set({ type: 'RING', slug: 'orbite-ring' }).where('id', '=', ring).execute();
    const codes = { s56: '', s48: '', s50: '' };
    codes.s56 = (await t.db.selectFrom('skus').select('code').where('id', '=', await skuOf(ring, '56')).executeTakeFirstOrThrow()).code;
    codes.s48 = (await t.db.selectFrom('skus').select('code').where('id', '=', await skuOf(ring, '48')).executeTakeFirstOrThrow()).code;
    codes.s50 = (await t.db.selectFrom('skus').select('code').where('id', '=', await skuOf(ring, '50')).executeTakeFirstOrThrow()).code;
    await price(ring, 480_050);
    await photo(ring, sha('a'), [
      { sha256: sha('b'), alt: 'The ring on its side' },
      { sha256: sha('c'), alt: null },
      { sha256: sha('d'), alt: null },
      { sha256: sha('e'), alt: null },
    ]);
    const pendant = await createModel(t.db, 'ECLAT', null, 'PENDANT');
    await price(pendant, 120_000);
    await t.db.updateTable('models').set({ active: false }).where('id', '=', pendant).execute();
    const dollars = await createModel(t.db, 'DOLLAR');
    await price(dollars, 99_00, 'USD');
    await createModel(t.db, 'UNPRICED');

    const file = await shopify().productCsv('EUR');
    expect(file.filename).toBe('ORBES-shopify-products-EUR-2026-11-02.csv');
    expect(file.contentType).toMatch(/^text\/csv/);
    const [head] = parseCsv(file.body);
    expect(head).toEqual([...SHOPIFY_PRODUCT_COLUMNS]);
    const rows = records(file.body);
    // ECLAT before ORBITE (by name); no USD model, no model without a price.
    expect([...new Set(rows.map((r) => r['URL handle']))]).toEqual(['eclat', 'orbite-ring']);
    const eclat = rows.filter((r) => r['URL handle'] === 'eclat');
    expect(eclat).toHaveLength(1);
    // Never issued nor sold: in one size, Shopify's single variant, its SKU the model's prefix.
    const prefix = (await t.db.selectFrom('models').select('sku_prefix').where('id', '=', pendant).executeTakeFirstOrThrow()).sku_prefix;
    expect(eclat[0]).toMatchObject({ Title: 'ECLAT', Vendor: 'ORBES', Type: 'PENDANT', 'Published on online store': 'false', Status: 'archived', SKU: prefix.toUpperCase(), 'Option1 name': 'Title', 'Option1 value': 'Default Title', Price: '1200.00', 'Requires shipping': 'true', 'Product image URL': '' });

    const orbite = rows.filter((r) => r['URL handle'] === 'orbite-ring');
    // Five photographs, three sizes: five rows, the variants on the first three.
    expect(orbite).toHaveLength(5);
    expect(orbite[0]).toMatchObject({ Title: 'ORBITE', Vendor: 'ORBES', Type: 'RING', 'Published on online store': 'false', Status: 'draft', 'Option1 name': 'Size' });
    expect(orbite.map((r) => r['Option1 value'])).toEqual(['48', '50', '56', '', '']);
    expect(orbite.map((r) => r.SKU)).toEqual([codes.s48, codes.s50, codes.s56, '', '']);
    expect(orbite.map((r) => r.Price)).toEqual(['4800.50', '4800.50', '4800.50', '', '']);
    expect(orbite.map((r) => r['Product image URL'])).toEqual(['a', 'b', 'c', 'd', 'e'].map((c) => `${ORIGIN}/api/v1/media/${sha(c)}`));
    expect(orbite.map((r) => r['Image position'])).toEqual(['1', '2', '3', '4', '5']);
    expect(orbite.map((r) => r['Image alt text'])).toEqual(['The ORBITE RING model, photographed by ORBES', 'The ring on its side', ...Array(3).fill('The ORBITE RING model, photographed by ORBES')]);
    for (const r of orbite.slice(1)) expect([r.Title, r.Vendor, r.Type, r.Status, r['Option1 name']]).toEqual(['', '', '', '', '']);

    // The store in dollars: the one model priced in USD.
    expect(records((await shopify().productCsv('USD')).body).map((r) => r.Title)).toEqual(['DOLLAR']);
    await rejects(shopify().productCsv('JPY'), 'VALIDATION_FAILED');
  });

  it('gives each model its own handle, ONE SIZE beside the sizes, and the cover alone when it has no size yet', async () => {
    const a = await createModel(t.db, 'TWIN');
    const b = await createModel(t.db, 'TWIN');
    await skuOf(a, null);
    await skuOf(a, '52');
    await price(a, 100_00);
    await price(b, 100_00);
    const rows = records((await shopify().productCsv('EUR')).body).filter((r) => r['URL handle'].startsWith('twin'));
    const handles = [...new Set(rows.map((r) => r['URL handle']))];
    expect(handles).toHaveLength(2);
    expect(handles[0]).toBe('twin');
    expect(handles[1]).toMatch(/^twin-twi-[0-9a-f]{8}$/);
    // The console's dialog names the handle the export writes.
    expect(new Set([(await shopify().product(a)).handle, (await shopify().product(b)).handle])).toEqual(new Set(handles));
    const first = rows.filter((r) => r['URL handle'] === handles[0]);
    const withSizes = first.length === 2 ? first : rows.filter((r) => r['URL handle'] === handles[1]);
    expect(withSizes.map((r) => [r['Option1 name'], r['Option1 value']])).toEqual([
      ['Size', 'ONE SIZE'],
      ['', '52'],
    ]);
  });

  it('keeps a lookbook address as its handle, and gives a name that meets one a free handle, the same in the export and the dialog', async () => {
    const named = await createModel(t.db, 'NOVA');
    const addressed = await createModel(t.db, 'ASTRE');
    await t.db.updateTable('models').set({ slug: 'nova' }).where('id', '=', addressed).execute();
    const prefix = (await t.db.selectFrom('models').select('sku_prefix').where('id', '=', named).executeTakeFirstOrThrow()).sku_prefix;
    const suffixed = `nova-${shopifyHandle({ name: prefix, slug: null, skuPrefix: prefix })}`;
    // A third model's lookbook address is the handle the name would take next: the name takes a number.
    const third = await createModel(t.db, 'ZENITH');
    await t.db.updateTable('models').set({ slug: suffixed }).where('id', '=', third).execute();
    for (const m of [named, addressed, third]) await price(m, 50_00);
    const rows = records((await shopify().productCsv('EUR')).body);
    const handleOf = (title: string) => rows.find((r) => r.Title === title)!['URL handle'];
    expect([handleOf('ASTRE'), handleOf('ZENITH'), handleOf('NOVA')]).toEqual(['nova', suffixed, `${suffixed}-2`]);
    expect((await shopify().product(addressed)).handle).toBe('nova');
    expect((await shopify().product(third)).handle).toBe(suffixed);
    expect((await shopify().product(named)).handle).toBe(`${suffixed}-2`);
  });

  it('exports a model and its variants as one product (NOCTURNE N1): Option1 Variant, Option2 Size, each its SKUs, price and photographs, its cover its variants\' image', async () => {
    const main = await createModel(t.db, 'GROUPE', null, 'BRACELET');
    await t.db.updateTable('models').set({ slug: 'groupe-monolithe' }).where('id', '=', main).execute();
    const gold = (await ctx.services.catalog.createVariant(main, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'GRP-GD', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, f.admin)).id;
    clock.advance(1000);
    const blue = (await ctx.services.catalog.createVariant(main, { label: 'Blue', swatch: '#16224A', skuPrefix: 'GRP-BL' }, f.admin)).id;
    const code = async (m: string, size: string) => (await t.db.selectFrom('skus').select('code').where('id', '=', await skuOf(m, size)).executeTakeFirstOrThrow()).code;
    const codes = [await code(main, '17'), await code(main, '16'), await code(gold, '16'), await code(gold, '17')];
    await price(main, 420_000);
    await price(gold, 480_000);
    // Blue never issued nor sold: in one size.
    await price(blue, 450_000);
    await photo(main, sha('a'), []);
    await photo(gold, sha('b'), [{ sha256: sha('c'), alt: null }]);
    const rows = records((await shopify().productCsv('EUR')).body);
    // One product, the main model's handle; none of its variants' own.
    const product = rows.filter((r) => r['URL handle'] === 'groupe-monolithe');
    const variantHandles = [(await shopify().product(gold)).handle, (await shopify().product(blue)).handle];
    expect(variantHandles).toEqual(['groupe-monolithe', 'groupe-monolithe']);
    expect(rows.filter((r) => r.Title === 'GROUPE')).toHaveLength(1);
    // Five variants (two sizes of Steel, two of Gold, Blue in one size), three photographs: five rows.
    expect(product).toHaveLength(5);
    expect(product[0]).toMatchObject({ Title: 'GROUPE', Type: 'BRACELET', Vendor: 'ORBES', Status: 'draft', 'Option1 name': 'Variant', 'Option2 name': 'Size' });
    for (const r of product.slice(1)) expect([r.Title, r['Option1 name'], r['Option2 name']]).toEqual(['', '', '']);
    expect(product.map((r) => [r['Option1 value'], r['Option2 value'], r.SKU, r.Price])).toEqual([
      ['Steel', '16', codes[1], '4200.00'],
      ['Steel', '17', codes[0], '4200.00'],
      ['Gold', '16', codes[2], '4800.00'],
      ['Gold', '17', codes[3], '4800.00'],
      ['Blue', 'ONE SIZE', 'GRP-BL', '4500.00'],
    ]);
    const url = (c: string) => `${ORIGIN}/api/v1/media/${sha(c)}`;
    expect(product.map((r) => r['Variant image URL'])).toEqual([url('a'), url('a'), url('b'), url('b'), '']);
    expect(product.map((r) => r['Product image URL'])).toEqual([url('a'), url('b'), url('c'), '', '']);
    expect(product.map((r) => r['Image alt text'])).toEqual([
      'The GROUPE BRACELET model in steel, photographed by ORBES',
      'The GROUPE BRACELET model in gold, photographed by ORBES',
      'The GROUPE BRACELET model in gold, photographed by ORBES',
      '',
      '',
    ]);
    // A model alone keeps its sizes as Option1 and no Option2.
    expect(rows.filter((r) => r['Option1 name'] === 'Size').every((r) => r['Option2 name'] === '')).toBe(true);
    // Only a variant priced in a currency: the main model's product still, by Variant, without sizes.
    await price(blue, 9_900, 'USD');
    const usd = records((await shopify().productCsv('USD')).body).filter((r) => r['URL handle'] === 'groupe-monolithe');
    expect(usd.map((r) => [r.Title, r['Option1 name'], r['Option1 value'], r['Option2 name'], r['Option2 value'], r.Price])).toEqual([['GROUPE', 'Variant', 'Blue', '', '', '99.00']]);
    // Archived once none of its models is active.
    await t.db.updateTable('models').set({ active: false }).where('id', 'in', [main, gold]).execute();
    expect(records((await shopify().productCsv('EUR')).body).find((r) => r['URL handle'] === 'groupe-monolithe')!.Status).toBe('archived');

    // The ids pasted back: a variant takes its main model's product; a model of another group may not.
    await shopify().link(main, { productId: '6601', variants: [{ size: '16', variantId: '6616' }] }, f.admin);
    const linked = await shopify().link(gold, { productId: '6601', variants: [{ size: '16', variantId: '6716' }] }, f.admin);
    expect(linked.productId).toBe('6601');
    const stranger = await createModel(t.db, 'STRANGER');
    await skuOf(stranger, '52');
    await rejects(shopify().link(stranger, { productId: '6601', variants: [] }, f.admin), 'SHOPIFY_PRODUCT_TAKEN');
  });

  it('keeps a main model\'s handle when variants are added (NOCTURNE N1): a variant never takes a handle nor shifts its main model\'s', async () => {
    const main = await createModel(t.db, 'UNSLUGGED');
    await price(main, 300_00);
    const handleOfMain = async () => records((await shopify().productCsv('EUR')).body).find((r) => r.Title === 'UNSLUGGED')!['URL handle'];
    expect(await handleOfMain()).toBe('unslugged');
    expect((await shopify().product(main)).handle).toBe('unslugged');
    const variants: string[] = [];
    for (const [i, label] of ['Gold', 'Blue', 'Black'].entries()) {
      variants.push((await ctx.services.catalog.createVariant(main, { label, swatch: '#16224A', skuPrefix: `UNS-V${i}`, ...(i === 0 ? { mainLabel: 'Steel', mainSwatch: '#9D9B96' } : {}) }, f.admin)).id);
      clock.advance(1000);
    }
    // A variant whose id sorts before every other (its name its main model's, as ADD A VARIANT gives it): it still takes
    // no handle of its own.
    const m = await t.db.selectFrom('models').select(['category_id', 'type']).where('id', '=', main).executeTakeFirstOrThrow();
    const first = '00000000-0000-4000-8000-000000000001';
    await t.db
      .insertInto('models')
      .values({ id: first, category_id: m.category_id, name: 'UNSLUGGED', type: m.type, sku_prefix: 'UNS-V3', variant_of: main, variant_label: 'Silver', variant_swatch: '#C0C0C0', created_at: clock.now() })
      .execute();
    variants.push(first);
    for (const v of variants) await price(v, 350_00);
    expect(await handleOfMain()).toBe('unslugged');
    expect((await shopify().product(main)).handle).toBe('unslugged');
    for (const v of variants) expect((await shopify().product(v)).handle).toBe('unslugged');
    const rows = records((await shopify().productCsv('EUR')).body);
    expect(rows.filter((r) => r['URL handle'].startsWith('unslugged'))).toHaveLength(5);
    expect(new Set(rows.filter((r) => r['URL handle'].startsWith('unslugged')).map((r) => r['URL handle']))).toEqual(new Set(['unslugged']));
  });

  it('keeps the ids pasted back on the model\'s SKUs, audited; refuses what would link two sides wrongly', async () => {
    const model = await createModel(t.db, 'LINKED');
    await skuOf(model, '52');
    await skuOf(model, '54');
    const before = await shopify().product(model);
    expect(before).toMatchObject({ model: { id: model, name: 'LINKED' }, handle: 'linked', productId: null });
    expect(before.variants.map((v) => [v.size, v.known, v.variantId])).toEqual([
      ['52', true, null],
      ['54', true, null],
    ]);

    const linked = await shopify().link(
      model,
      { productId: 'https://admin.shopify.com/store/orbes/products/9001', variants: [{ size: '52', variantId: '5201' }, { size: '54', variantId: 'https://admin.shopify.com/store/orbes/products/9001/variants/5401' }] },
      f.admin,
    );
    expect(linked.productId).toBe('9001');
    expect(linked.variants.map((v) => v.variantId)).toEqual(['5201', '5401']);
    const skus = await t.db.selectFrom('skus').select(['size_label', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', model).orderBy('size_label').execute();
    expect(skus).toEqual([
      { size_label: '52', shopify_product_id: '9001', shopify_variant_id: '5201' },
      { size_label: '54', shopify_product_id: '9001', shopify_variant_id: '5401' },
    ]);
    const audit = await t.db.selectFrom('audit_logs').select(['action', 'target_id', 'details']).where('action', '=', 'model.shopify').where('target_id', '=', model).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ product: { from: null, to: '9001' }, variants: [{ from: null, to: '5201' }, { from: null, to: '5401' }] });
    expect((await ctx.services.catalog.getModel(model)).shopify).toEqual({ productId: '9001', variants: 2, linked: 2 });

    // The same again writes nothing; one size changed, the other kept.
    await shopify().link(model, { productId: '9001', variants: [{ size: '52', variantId: '5201' }, { size: '54', variantId: '5401' }] }, f.admin);
    await shopify().link(model, { productId: '9001', variants: [{ size: '54', variantId: '5402' }] }, f.admin);
    expect((await shopify().product(model)).variants.map((v) => v.variantId)).toEqual(['5201', '5402']);
    expect(await t.db.selectFrom('audit_logs').select('id').where('action', '=', 'model.shopify').where('target_id', '=', model).execute()).toHaveLength(2);

    // Refusals.
    await rejects(shopify().link(model, { productId: '9001', variants: [{ size: '58', variantId: '5801' }] }, f.admin), 'VALIDATION_FAILED');
    await rejects(shopify().link(model, { productId: '9001', variants: [{ size: '52', variantId: '7' }, { size: '54', variantId: '7' }] }, f.admin), 'VALIDATION_FAILED');
    await rejects(shopify().link(model, { productId: '9001', variants: [{ size: '52', variantId: '7' }, { size: '52', variantId: '8' }] }, f.admin), 'VALIDATION_FAILED');
    await rejects(shopify().link(model, { productId: null, variants: [{ size: '52', variantId: '7' }] }, f.admin), 'VALIDATION_FAILED');
    await rejects(shopify().link(model, { productId: 'abc', variants: [] }, f.admin), 'VALIDATION_FAILED');
    const other = await createModel(t.db, 'OTHER');
    await skuOf(other, '52');
    await rejects(shopify().link(other, { productId: '9001', variants: [] }, f.admin), 'SHOPIFY_PRODUCT_TAKEN');
    await rejects(shopify().link(other, { productId: '9002', variants: [{ size: '52', variantId: '5201' }] }, f.admin), 'SHOPIFY_VARIANT_TAKEN');
    await rejects(shopify().link('00000000-0000-4000-8000-000000000000', { productId: null, variants: [] }, f.admin), 'MODEL_NOT_FOUND');
    expect((await shopify().product(other)).productId).toBeNull();

    // The product cleared: no variant stands.
    await shopify().link(model, { productId: null, variants: [] }, f.admin);
    expect(await t.db.selectFrom('skus').select(['shopify_product_id', 'shopify_variant_id']).where('model_id', '=', model).execute()).toEqual([
      { shopify_product_id: null, shopify_variant_id: null },
      { shopify_product_id: null, shopify_variant_id: null },
    ]);
  });

  it('makes the SKU of a model never issued nor sold when its ids are pasted back', async () => {
    const model = await createModel(t.db, 'NEWCOMER');
    const p = await shopify().product(model);
    expect(p.variants).toEqual([{ size: null, sku: expect.stringMatching(/^NEW-/), known: false, variantId: null }]);
    const linked = await shopify().link(model, { productId: '7001', variants: [{ size: null, variantId: '7101' }] }, f.admin);
    expect(linked.variants).toEqual([{ size: null, sku: p.variants[0]!.sku, known: true, variantId: '7101' }]);
    expect(await t.db.selectFrom('skus').select(['size_label', 'code', 'shopify_variant_id']).where('model_id', '=', model).execute()).toEqual([{ size_label: null, code: p.variants[0]!.sku, shopify_variant_id: '7101' }]);
  });

  it('keeps the product id of a model never issued nor sold on its one-size SKU when no variant is given, audited as stored', async () => {
    const model = await createModel(t.db, 'PROBE');
    const linked = await shopify().link(model, { productId: '8001', variants: [] }, f.admin);
    expect(linked.productId).toBe('8001');
    expect(linked.variants.map((v) => [v.size, v.known, v.variantId])).toEqual([[null, true, null]]);
    expect(await t.db.selectFrom('skus').select(['size_label', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', model).execute()).toEqual([
      { size_label: null, shopify_product_id: '8001', shopify_variant_id: null },
    ]);
    const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'model.shopify').where('target_id', '=', model).execute();
    expect(audit.map((a) => a.details)).toEqual([{ product: { from: null, to: '8001' }, variants: [] }]);
    // Cleared again: the product leaves the SKU, audited; a model never linked, cleared, writes nothing.
    await shopify().link(model, { productId: null, variants: [] }, f.admin);
    expect((await shopify().product(model)).productId).toBeNull();
    const untouched = await createModel(t.db, 'UNTOUCHED');
    await shopify().link(untouched, { productId: null, variants: [] }, f.admin);
    expect(await t.db.selectFrom('skus').select('id').where('model_id', '=', untouched).execute()).toEqual([]);
    expect(await t.db.selectFrom('audit_logs').select('id').where('action', '=', 'model.shopify').where('target_id', 'in', [model, untouched]).execute()).toHaveLength(2);
  });

  it('leaves a size set aside out of the export, the model\'s view and the link, its ids kept (NEXT LOT §3.3)', async () => {
    const model = await createModel(t.db, 'ASIDE');
    await t.db.updateTable('models').set({ slug: 'aside-ring' }).where('id', '=', model).execute();
    for (const label of ['50', '52', '54']) await skuOf(model, label);
    await price(model, 300_000);
    await shopify().link(model, { productId: '6001', variants: [{ size: '50', variantId: '6050' }, { size: '52', variantId: '6052' }, { size: '54', variantId: '6054' }] }, f.admin);
    await t.db.updateTable('skus').set({ set_aside_at: clock.now() }).where('model_id', '=', model).where('size_label', '=', '52').execute();
    const rows = records((await shopify().productCsv('EUR')).body).filter((r) => r['URL handle'] === 'aside-ring');
    expect(rows.map((r) => r['Option1 value'])).toEqual(['50', '54']);
    expect((await shopify().product(model)).variants.map((v) => [v.size, v.variantId])).toEqual([['50', '6050'], ['54', '6054']]);
    expect((await ctx.services.catalog.getModel(model)).shopify).toEqual({ productId: '6001', variants: 2, linked: 2 });
    // The link: a size set aside is unknown there; a link of the others leaves its ids as they are.
    await rejects(shopify().link(model, { productId: '6001', variants: [{ size: '52', variantId: '6099' }] }, f.admin), 'VALIDATION_FAILED');
    await shopify().link(model, { productId: '6002', variants: [{ size: '50', variantId: '6150' }] }, f.admin);
    expect(await t.db.selectFrom('skus').select(['size_label', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', model).orderBy('size_label').execute()).toEqual([
      { size_label: '50', shopify_product_id: '6002', shopify_variant_id: '6150' },
      { size_label: '52', shopify_product_id: '6001', shopify_variant_id: '6052' },
      { size_label: '54', shopify_product_id: '6002', shopify_variant_id: null },
    ]);
    // The Catalogue's product id reads the offered sizes only: a re-link to an id sorting before the set-aside size's
    // old one is the one shown.
    await shopify().link(model, { productId: '5990', variants: [{ size: '50', variantId: '6150' }] }, f.admin);
    expect((await ctx.services.catalog.getModel(model)).shopify).toEqual({ productId: '5990', variants: 2, linked: 1 });
  });

  it('exports the priced orders of a period in Shopify\'s order format: line items, statuses, dates, the buyer, the email', async () => {
    clock.set('2026-12-01T10:00:00.000Z');
    // A LIVE sale with an add-on: its order RESERVED.
    const opensAt = new Date(clock.now().getTime() + 3_600_000);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '54', stock: 2 }], addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }] });
    const a = await accountOfTier(f, 0);
    clock.set(new Date(opensAt.getTime() - 60_000));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 1 }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    await f.live.setAddons(a.id, r.id, r.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const live = await t.db.selectFrom('orders').selectAll().where('account_id', '=', a.id).executeTakeFirstOrThrow();

    // A salon order: priced, paid, shipped from stock, its buyer entered; another paid then cancelled; one unpriced.
    const salon = async () => {
      const buyer = await createAccount(t.db);
      const request = await t.db.insertInto('shop_requests').values({ account_id: buyer.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
      await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
      const o = await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
      return { id: o.id, email: buyer.email };
    };
    clock.advance(60_000);
    const shipped = await salon();
    const sku = await skuOf(f.modelId, '56');
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '56', material: '925 STERLING SILVER', withClaimSecret: true }, f.admin);
    await countPiecesIn(ctx, { skuId: sku, locationId: france, productRefs: [piece.product.productId] }, f.admin);
    await ctx.services.orders.setTerms(shipped.id, { sizeLabel: '56', priceMinor: 480_000, currency: 'EUR' }, f.admin);
    await ctx.services.orders.setBuyer(shipped.id, { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris\nFrance' }, f.admin);
    clock.advance(60_000);
    await ctx.services.orders.transition(shipped.id, { to: 'PAID' }, f.admin);
    clock.advance(60_000);
    await packAndShip(ctx, shipped.id, { carrierId: colissimo, trackingNumber: '6A12345678901', pieces: { [shipped.id]: piece.product.productId } }, f.admin);
    const cancelled = await salon();
    await ctx.services.orders.setTerms(cancelled.id, { sizeLabel: '52', priceMinor: 300_000, currency: 'EUR' }, f.admin);
    await ctx.services.orders.transition(cancelled.id, { to: 'PAID' }, f.admin);
    clock.advance(60_000);
    await ctx.services.orders.transition(cancelled.id, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin);
    const unpriced = await salon();
    await t.db.updateTable('orders').set({ shopify_order_id: '450789469' }).where('id', '=', shipped.id).execute();

    const file = await shopify().orderCsv({ from: '2026-12-01', to: '2026-12-01' }, asStored);
    expect(file.filename).toBe('ORBES-shopify-orders-2026-12-01-to-2026-12-01.csv');
    const [head] = parseCsv(file.body);
    expect(head).toEqual([...SHOPIFY_ORDER_COLUMNS]);
    const rows = records(file.body);
    expect(rows.map((x) => x.Name)).toEqual([orderReference(live.id), orderReference(live.id), orderReference(shipped.id), orderReference(cancelled.id)]);
    expect(rows.some((x) => x.Name === orderReference(unpriced.id))).toBe(false);

    const [piece1, engraving, ship, cancel] = rows as [Record<string, string>, Record<string, string>, Record<string, string>, Record<string, string>];
    const liveSku = (await t.db.selectFrom('skus').select('code').where('id', '=', live.sku_id!).executeTakeFirstOrThrow()).code;
    expect(piece1).toMatchObject({
      Email: a.email,
      'Financial Status': 'pending',
      'Paid at': '',
      'Fulfillment Status': 'unfulfilled',
      Currency: 'EUR',
      Subtotal: '5200.00',
      Shipping: '0.00',
      Taxes: '0.00',
      Total: '5200.00',
      'Created at': shopifyDate(live.reserved_at),
      'Lineitem quantity': '1',
      'Lineitem name': 'MONOLITHE - 54',
      'Lineitem price': '5050.00',
      'Lineitem SKU': liveSku,
      'Lineitem requires shipping': 'true',
      'Lineitem taxable': 'false',
      'Lineitem fulfillment status': 'pending',
      'Refunded Amount': '',
      Vendor: 'ORBES',
      Location: 'FRANCE WAREHOUSE',
      Id: '',
      Source: 'orbes-live',
    });
    // The add-on: the order's name and the line item only.
    expect(Object.entries(engraving).filter(([, v]) => v !== '').map(([k]) => k)).toEqual([
      'Name', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem requires shipping', 'Lineitem taxable', 'Lineitem fulfillment status', 'Vendor',
    ]);
    expect(engraving).toMatchObject({ 'Lineitem name': 'ENGRAVING', 'Lineitem price': '150.00', 'Lineitem requires shipping': 'false' });

    const shippedRow = await t.db.selectFrom('orders').selectAll().where('id', '=', shipped.id).executeTakeFirstOrThrow();
    expect(ship).toMatchObject({
      Email: shipped.email,
      'Financial Status': 'paid',
      'Paid at': shopifyDate(shippedRow.paid_at),
      'Fulfillment Status': 'fulfilled',
      'Fulfilled at': shopifyDate(shippedRow.shipped_at),
      Total: '4800.00',
      'Shipping Method': 'Colissimo',
      'Lineitem name': 'MONOLITHE - 56',
      'Lineitem fulfillment status': 'fulfilled',
      'Billing Name': 'Jane Doe',
      'Billing Street': '1 rue de la Paix, 75002 Paris, France',
      'Billing Address1': '1 rue de la Paix',
      'Billing Address2': '75002 Paris, France',
      'Shipping Name': 'Jane Doe',
      'Shipping Street': '1 rue de la Paix, 75002 Paris, France',
      'Shipping Address1': '1 rue de la Paix',
      'Shipping Address2': '75002 Paris, France',
      Id: '450789469',
      Source: 'orbes-salon',
    });
    const cancelledRow = await t.db.selectFrom('orders').selectAll().where('id', '=', cancelled.id).executeTakeFirstOrThrow();
    expect(cancel).toMatchObject({ 'Financial Status': 'refunded', 'Canceled at': shopifyDate(cancelledRow.cancelled_at), 'Refunded Amount': '3000.00', 'Fulfillment Status': 'unfulfilled', Total: '3000.00' });

    // As the caller's view reads them (an AUDITOR's, masked by the route).
    const masked = records(
      (await shopify().orderCsv({ from: '2026-12-01', to: '2026-12-01' }, { email: () => 'x***@example.com', buyer: (b) => ({ name: b.name ? 'J*** D***' : null, address: b.address ? '***' : null }) })).body,
    );
    expect(masked.filter((x) => x.Email !== '').every((x) => x.Email === 'x***@example.com')).toBe(true);
    expect(masked[2]).toMatchObject({ 'Billing Name': 'J*** D***', 'Billing Street': '***', 'Billing Address1': '***', 'Billing Address2': '' });

    // The period: its days in UTC, both included.
    expect(records((await shopify().orderCsv({ from: '2026-11-01', to: '2026-11-30' }, asStored)).body)).toEqual([]);
    expect(records((await shopify().orderCsv({ from: '2026-12-02', to: '2026-12-31' }, asStored)).body)).toEqual([]);
    expect(records((await shopify().orderCsv({ from: '2026-01-01', to: '2026-12-31' }, asStored)).body)).toHaveLength(4);
    await rejects(shopify().orderCsv({ from: '2026-12-02', to: '2026-12-01' }, asStored), 'VALIDATION_FAILED');
    await rejects(shopify().orderCsv({ from: '2025-12-01', to: '2026-12-02' }, asStored), 'VALIDATION_FAILED');
    await rejects(shopify().orderCsv({ from: '2026-12', to: '2026-12-02' }, asStored), 'VALIDATION_FAILED');
  });
});
