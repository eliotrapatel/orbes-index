/**
 * Shopify readiness (plan LIVE RELEASE+ of 2026-10-04, choices 9, 24 and 25: N2 and N3): files in Shopify's own
 * formats, and the ids its store gives back. Nothing here calls Shopify; the store does not exist yet.
 *
 *   the product export   N2: a CSV in Shopify's product import format (help.shopify.com, « Using CSV files to import
 *                        and export products », read 2026-10-05), in the store's currency: every model with a base
 *                        price in it (Catalogue), one product per model, its sizes as variants (Option1 « Size »; a model
 *                        in one size is Shopify's single variant, « Title » / « Default Title »), each variant with its
 *                        SKU's code and the model's base price (releases keep their own), the reference photograph then
 *                        the gallery as its images, by their absolute address. A model's sizes are its SKUs (one per
 *                        model and size, services/stock.ts), naturally sorted, ONE SIZE first; a model without a SKU
 *                        yet is in one size. Every product is imported as a draft, not published: Shopify is not decided
 *                        (choice 9), the owner publishes there. A model inactive or discontinued is `archived`. A
 *                        vault-only model (THE VAULT, lot Q3, §4.5: never sold) is never one of its lines.
 *                        A model and its variants (plan NOCTURNE, N1) are ONE product, the main model's (its title, type
 *                        and handle): Option1 « Variant » (each model's label) and Option2 « Size » (its sizes; left out
 *                        when every model of it is in one size), each model of it priced in the store's currency in its
 *                        order (the main model first, then its variants as they were added), each with its own SKUs,
 *                        base price and photographs, its cover as the image of its variants (« Variant image URL »);
 *                        archived once none of them is active. Each variant carries its model's packed weight in grams
 *                        (plan MACRO M3 §1.2, B2: its own, else a variant's main model's), empty when unknown.
 *                        After the models, each active add-on priced in the store's currency (macro scope K48 D1, plan
 *                        MACRO M3 §4.2, S5): one product of a single variant, its SKU's code, its price and weight,
 *                        type « Add-on », a draft, a handle no model's product has. Its ids pasted back are the
 *                        add-on's (services/addons.ts setShopify), the same advisory lock as a model's.
 *                        After the add-ons, each active set priced in the store's currency (macro scope K44 T1, S5): one
 *                        product of a single variant, its code as SKU and handle, its base price, its pieces' packed
 *                        weights added, type « Set », a draft, its pieces named in its description (« Description »,
 *                        empty for the models and the add-ons); its id pasted back is the set's (services/sets.ts
 *                        setShopify), the same advisory lock again.
 *   the ids pasted back  N2: once imported, the product's id and each variant's, from Shopify's admin, are kept on the
 *                        model's SKUs (`skus.shopify_product_id`, one product per model; `skus.shopify_variant_id`, unique):
 *                        both sides are linked. A size of the export without its SKU yet has it created (ensureSku), on
 *                        a model with no size type. A size set aside (plan NEXT LOT §3.3) is left out of the export, the
 *                        model's view and the link: its ids stay as they are.
 *                        Audited `model.shopify` with the ids before and after; nothing written when nothing changes.
 *   the order export     N3: the orders reserved in a period (UTC days, at most SHOPIFY_PERIOD_MAX_DAYS), priced, in
 *                        Shopify's order CSV format (help.shopify.com, « Exporting orders », read 2026-10-05): one order
 *                        per ORBES order (one piece), its piece the first line item and each add-on the next ones (the
 *                        release's add-ons, then each unit of a catalogue add-on not removed, with its SKU code, plan
 *                        MACRO M3 §4.2; the lines after the first carry only the order's name and the line item, as
 *                        Shopify lays them out), its steps as Shopify's financial and fulfilment statuses and their dates, its buyer
 *                        (Client Services' entry) as billing and shipping, and the collector's email, by which the
 *                        store matches its customers to the ORBES accounts once it exists. No VAT, no shipping fee:
 *                        taxes and shipping are 0.00. An AUDITOR reads the emails and the buyers masked (the routes).
 *                        Never an order of a test account (the test entrants' pool, services/population.ts).
 *
 * Only the columns ORBES fills are written, in the published order: Shopify leaves the others to their defaults on an
 * import, and its header names are its own (test/services/shopify.test.ts holds them against the published lists).
 */
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { HouseCurrency, OrderChannel, OrderStatus } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { majorUnits } from './live-console.js';
import { modelPackings } from './boxes.js';
import { mediaUrl } from './media.js';
import { exportAddonUnits } from './order-addons.js';
import { ORDER_CURRENCIES, orderReference } from './orders.js';
import { notTestEntrant } from './population.js';
import { compareSizes, deriveSku, ensureSku, ONE_SIZE_LABEL } from './stock.js';

// ── Shopify's formats ──────────────────────────────────────────────────────

/** The product CSV's columns ORBES fills, in the order of Shopify's published product format. */
export const SHOPIFY_PRODUCT_COLUMNS = Object.freeze([
  'Title',
  'URL handle',
  'Description',
  'Vendor',
  'Type',
  'Published on online store',
  'Status',
  'SKU',
  'Option1 name',
  'Option1 value',
  'Option2 name',
  'Option2 value',
  'Price',
  'Weight value (grams)',
  'Requires shipping',
  'Product image URL',
  'Image position',
  'Image alt text',
  'Variant image URL',
] as const);

/** The order CSV's columns ORBES fills, in the order of Shopify's published order format. */
export const SHOPIFY_ORDER_COLUMNS = Object.freeze([
  'Name',
  'Email',
  'Financial Status',
  'Paid at',
  'Fulfillment Status',
  'Fulfilled at',
  'Currency',
  'Subtotal',
  'Shipping',
  'Taxes',
  'Total',
  'Shipping Method',
  'Created at',
  'Lineitem quantity',
  'Lineitem name',
  'Lineitem price',
  'Lineitem SKU',
  'Lineitem requires shipping',
  'Lineitem taxable',
  'Lineitem fulfillment status',
  'Billing Name',
  'Billing Street',
  'Billing Address1',
  'Billing Address2',
  'Shipping Name',
  'Shipping Street',
  'Shipping Address1',
  'Shipping Address2',
  'Canceled at',
  'Refunded Amount',
  'Vendor',
  'Location',
  'Id',
  'Source',
] as const);

/** The vendor every product and line item names. */
export const SHOPIFY_VENDOR = 'ORBES';
/** The option a model's sizes are, and Shopify's single variant of a model in one size. */
export const SHOPIFY_SIZE_OPTION = 'Size';
/** NOCTURNE N1: the option a model's variants are (each its label), before its sizes. */
export const SHOPIFY_VARIANT_OPTION = 'Variant';
export const SHOPIFY_SINGLE_OPTION = Object.freeze({ name: 'Title', value: 'Default Title' });
/** The product type of an add-on (macro scope K48 D1, S5). */
export const SHOPIFY_ADDON_TYPE = 'Add-on';
/** The product type of a set (macro scope K44 T1, S5). */
export const SHOPIFY_SET_TYPE = 'Set';
/** The longest period one order export covers, in days. */
export const SHOPIFY_PERIOD_MAX_DAYS = 366;
/** A Shopify id as its admin shows it: a positive decimal (the CHECK of migration 0022). */
export const SHOPIFY_ID_RE = /^[1-9][0-9]{0,19}$/;

/** Shopify's financial status of an order at each of its steps; a cancelled order is refunded once it was paid. */
export function shopifyFinancialStatus(status: OrderStatus, paid: boolean): 'pending' | 'paid' | 'refunded' | 'voided' {
  if (status === 'RESERVED') return 'pending';
  if (status === 'CANCELLED') return paid ? 'refunded' : 'voided';
  if (status === 'RETURNED') return 'refunded';
  return 'paid';
}

/** Shopify's fulfilment status: fulfilled once the piece has left (shipped, delivered, returned). */
export function shopifyFulfilled(status: OrderStatus): boolean {
  return status === 'SHIPPED' || status === 'DELIVERED' || status === 'RETURNED';
}

/** A date as Shopify's exports write it: `2026-10-05 14:03:00 +0000` (UTC). */
export function shopifyDate(d: Date | null): string {
  if (!d) return '';
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} +0000`;
}

/** A product's handle: the model's lookbook address, else its name in lower-case words joined by hyphens. */
export function shopifyHandle(m: { name: string; slug: string | null; skuPrefix: string }): string {
  const words = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return m.slug ?? (words(m.name) || words(m.skuPrefix) || 'orbes');
}

/** Sizes in the order a client reads them (services/stock.ts, shared with the lookbook's SIZES). */
export { compareSizes };

/** An id pasted from Shopify's admin: the number itself, or the address of its page (…/products/123/variants/456). */
export function shopifyIdOf(input: unknown, kind: 'products' | 'variants'): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') throw validationError('A Shopify id is the number Shopify gives it.');
  const s = input.trim();
  if (s === '') return null;
  if (SHOPIFY_ID_RE.test(s)) return s;
  const m = new RegExp(`/${kind}/([1-9][0-9]{0,19})(?:[/?#]|$)`).exec(s);
  if (m) return m[1];
  throw validationError(`A Shopify ${kind === 'products' ? 'product' : 'variant'} id is the number at the end of its address in Shopify's admin.`);
}

// ── Views ──────────────────────────────────────────────────────────────────

/** A size of a model as the product export gives it, and its Shopify variant. */
export interface ShopifyVariant {
  /** The size (null: one size). */
  size: string | null;
  /** The SKU's code, or the one it will have (a model without a SKU yet). */
  sku: string;
  /** Its SKU exists. */
  known: boolean;
  variantId: string | null;
}

/** A model and its Shopify product: the console's dialog where the ids are pasted back. */
export interface ShopifyProduct {
  model: { id: string; name: string; skuPrefix: string };
  handle: string;
  productId: string | null;
  variants: ShopifyVariant[];
}

/** The ids pasted back: the product's, and a variant's per size (the export's); null clears one. */
export interface ShopifyLinkInput {
  productId: string | null;
  variants: { size: string | null; variantId: string | null }[];
}

export interface ShopifyExportServiceDeps {
  db: Db;
  audit: AuditService;
  /** scheme://host of this server: the photographs' absolute addresses, which Shopify fetches on an import. */
  publicOrigin: string;
  clock?: Clock;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');

/** A model's one-size code when it has no SKU yet: the code ensureSku will give it. */
const oneSizeCode = (prefix: string) => deriveSku(prefix, undefined).replace(/^[^A-Za-z0-9]+/, '') || 'SKU';

interface OrderRow {
  id: string;
  channel: OrderChannel;
  status: OrderStatus;
  size_label: string | null;
  price_minor: number;
  currency: string;
  addons: { label: string; priceMinor: number }[];
  buyer_name: string | null;
  buyer_address: string | null;
  reserved_at: Date;
  paid_at: Date | null;
  shipped_at: Date | null;
  cancelled_at: Date | null;
  shopify_order_id: string | null;
  shipping_minor: number | null;
  with_order_id: string | null;
  email: string;
  model_name: string;
  sku_code: string | null;
  carrier_name: string | null;
  location_name: string;
}

export class ShopifyExportService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly publicOrigin: string;
  private readonly clock: Clock;

  constructor(deps: ShopifyExportServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.publicOrigin = deps.publicOrigin.replace(/\/+$/, '');
    this.clock = deps.clock ?? systemClock;
  }

  // ── The product export (N2) ──────────────────────────────────────────────

  /** Every model priced in `currency`, as Shopify's product CSV (see the header): a model and its variants one product. */
  async productCsv(currency: string): Promise<{ filename: string; contentType: string; body: string }> {
    if (!(ORDER_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`The store's currency is one of ${ORDER_CURRENCIES.join(', ')}.`);
    const priced = await this.db
      .selectFrom('models')
      .select(['id', 'name', 'type', 'sku_prefix', 'slug', 'active', 'image_sha256', 'base_price_minor', 'variant_of', 'variant_label', 'created_at'])
      .where('base_currency', '=', currency)
      .where('base_price_minor', 'is not', null)
      // THE VAULT (lot Q3, §4.5, S4): a vault-only model is never sold, so never one of the store's sellable lines.
      .where('vault_only', '=', false)
      .orderBy('name')
      .orderBy('id')
      .execute();
    // N1: each product is a main model's, with its variants; the main model is read even when it is not priced here.
    const roots = [...new Set(priced.map((m) => m.variant_of ?? m.id))];
    const mains = roots.length ? await this.db.selectFrom('models').select(['id', 'name', 'type']).where('id', 'in', roots).execute() : [];
    const grouped = new Set(
      roots.length ? (await this.db.selectFrom('models').select('variant_of').where('variant_of', 'in', roots).execute()).map((r) => r.variant_of!) : [],
    );
    const ids = priced.map((m) => m.id);
    // Plan NEXT LOT §3.3: the store offers a model's offered sizes; one set aside is left out (its ids kept).
    const skus = ids.length ? await this.db.selectFrom('skus').select(['model_id', 'size_label', 'code', 'shopify_variant_id']).where('model_id', 'in', ids).where('set_aside_at', 'is', null).execute() : [];
    const gallery = ids.length ? await this.db.selectFrom('model_images').select(['model_id', 'sha256', 'alt']).where('model_id', 'in', ids).orderBy('model_id').orderBy('position').execute() : [];
    const handles = await handlesOf(this.db);
    // Plan MACRO M3 §1.2 (B2): each variant's weight, its model's packed weight (a variant without one: its main model's).
    const packings = await modelPackings(this.db, ids);
    const rows: string[][] = [];
    const done = new Set<string>();
    for (const first of priced) {
      const root = first.variant_of ?? first.id;
      if (done.has(root)) continue;
      done.add(root);
      const main = mains.find((m) => m.id === root)!;
      const group = grouped.has(root);
      // The models of the product in their order: the main model first, then its variants as they were added.
      const members = priced
        .filter((m) => (m.variant_of ?? m.id) === root)
        .sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : 1)));
      const variants = members.flatMap((m) => variantsOf(m.sku_prefix, skus.filter((k) => k.model_id === m.id)).map((v) => ({ model: m, ...v })));
      const single = !group && variants.length === 1 && variants[0].size === null;
      const sized = group && variants.some((v) => v.size !== null);
      const altOf = (m: (typeof members)[number]) =>
        `The ${m.name} ${m.type} model${group && m.variant_label ? ` in ${m.variant_label.toLowerCase()}` : ''}, photographed by ORBES`;
      const images = members.flatMap((m) => [
        ...(mediaUrl(m.image_sha256) ? [{ url: mediaUrl(m.image_sha256)!, alt: altOf(m) }] : []),
        ...gallery.filter((g) => g.model_id === m.id && mediaUrl(g.sha256)).map((g) => ({ url: mediaUrl(g.sha256)!, alt: g.alt ?? altOf(m) })),
      ]);
      const lines = Math.max(variants.length, images.length);
      for (let i = 0; i < lines; i++) {
        const v = variants[i];
        const img = images[i];
        const cover = v && group ? mediaUrl(v.model.image_sha256) : null;
        const row: Record<(typeof SHOPIFY_PRODUCT_COLUMNS)[number], string> = {
          Title: i === 0 ? main.name : '',
          'URL handle': handles.get(root)!,
          Description: '',
          Vendor: i === 0 ? SHOPIFY_VENDOR : '',
          Type: i === 0 ? main.type : '',
          'Published on online store': i === 0 ? 'false' : '',
          Status: i === 0 ? (members.some((m) => m.active) ? 'draft' : 'archived') : '',
          SKU: v ? v.sku : '',
          'Option1 name': i === 0 ? (group ? SHOPIFY_VARIANT_OPTION : single ? SHOPIFY_SINGLE_OPTION.name : SHOPIFY_SIZE_OPTION) : '',
          'Option1 value': v ? (group ? (v.model.variant_label ?? v.model.name) : single ? SHOPIFY_SINGLE_OPTION.value : (v.size ?? ONE_SIZE_LABEL)) : '',
          'Option2 name': i === 0 && sized ? SHOPIFY_SIZE_OPTION : '',
          'Option2 value': v && sized ? (v.size ?? ONE_SIZE_LABEL) : '',
          Price: v ? majorUnits(v.model.base_price_minor!) : '',
          'Weight value (grams)': v ? String(packings.get(v.model.id)?.packedWeightG ?? '') : '',
          'Requires shipping': v ? 'true' : '',
          'Product image URL': img ? `${this.publicOrigin}${img.url}` : '',
          'Image position': img ? String(i + 1) : '',
          'Image alt text': img ? img.alt : '',
          'Variant image URL': cover ? `${this.publicOrigin}${cover}` : '',
        };
        rows.push(SHOPIFY_PRODUCT_COLUMNS.map((c) => row[c]));
      }
    }
    // Macro scope K48 D1 (plan MACRO M3 §4.2, S5): each active add-on priced in the store's currency, one product of one
    // variant after the models, its SKU, price and weight, a draft as the models are.
    const taken = new Set(handles.values());
    const addons = await this.addonRows(currency, taken);
    rows.push(...addons.rows);
    // Macro scope K44 T1 (plan MACRO M3 §5.2, S5): each active set priced in the store's currency, one product after the
    // add-ons, its code the handle, its pieces named in its description.
    rows.push(...(await this.setRows(currency, addons.taken)));
    const day = this.clock().toISOString().slice(0, 10);
    return { filename: `ORBES-shopify-products-${currency}-${day}.csv`, contentType: CSV_CONTENT_TYPE, body: csvDocument([[...SHOPIFY_PRODUCT_COLUMNS], ...rows]) };
  }

  /**
   * The product export's add-ons (S5): each active add-on priced in `currency`, in its order (position, then name), one
   * product with Shopify's single variant (« Title » / « Default Title »), its SKU's code, its price and weight, type
   * « Add-on », a draft, no image (an add-on has no photograph). Its handle is its name's words, never one a model's
   * product has (`taken`): its SKU code is added, then a number, until it is free. A service (lot Q2, D9, S5: an
   * engraving, a gift wrapping) is one product of one variant too, not shipped (`Requires shipping` false), no weight.
   */
  private async addonRows(currency: string, taken: Set<string>): Promise<{ rows: string[][]; taken: Set<string> }> {
    const addons = await this.db
      .selectFrom('addon_items as a')
      .innerJoin('skus as k', 'k.addon_id', 'a.id')
      .innerJoin('addon_item_prices as p', (j) => j.onRef('p.addon_id', '=', 'a.id').on('p.currency', '=', currency as HouseCurrency))
      .select(['a.id', 'a.name', 'a.weight_g', 'a.kind', 'k.code', 'p.price_minor'])
      .where('a.active', '=', true)
      .orderBy('a.position')
      .orderBy(sql`lower(a.name)`)
      .orderBy('a.id')
      .execute();
    const used = new Set(taken);
    const rows = addons.map((a) => {
      const base = shopifyHandle({ name: a.name, slug: null, skuPrefix: a.code });
      const withCode = `${base}-${shopifyHandle({ name: a.code, slug: null, skuPrefix: a.code })}`;
      let handle = used.has(base) ? withCode : base;
      for (let n = 2; used.has(handle); n++) handle = `${withCode}-${n}`;
      used.add(handle);
      const row: Record<(typeof SHOPIFY_PRODUCT_COLUMNS)[number], string> = {
        Title: a.name,
        'URL handle': handle,
        Description: '',
        Vendor: SHOPIFY_VENDOR,
        Type: SHOPIFY_ADDON_TYPE,
        'Published on online store': 'false',
        Status: 'draft',
        SKU: a.code,
        'Option1 name': SHOPIFY_SINGLE_OPTION.name,
        'Option1 value': SHOPIFY_SINGLE_OPTION.value,
        'Option2 name': '',
        'Option2 value': '',
        Price: majorUnits(Number(a.price_minor)),
        'Weight value (grams)': a.weight_g === null || a.kind === 'SERVICE' ? '' : String(a.weight_g),
        'Requires shipping': a.kind === 'SERVICE' ? 'false' : 'true',
        'Product image URL': '',
        'Image position': '',
        'Image alt text': '',
        'Variant image URL': '',
      };
      return SHOPIFY_PRODUCT_COLUMNS.map((c) => row[c]);
    });
    return { rows, taken: used };
  }

  /**
   * The product export's sets (macro scope K44 T1, S5): each active set priced in `currency` (its base price), by name, one
   * product with Shopify's single variant, its code as its SKU, its price, its weight (its pieces' packed weights added,
   * empty while one is unknown), type « Set », a draft, no image (a set has no photograph of its own, §15 note 13), its
   * pieces named in its description in their order; the components are linked in the store by the Shopify lot. Its
   * handle is its code in lower case, never one a model's or an add-on's product has (`taken`): « -set » is added, then a
   * number, until it is free.
   */
  private async setRows(currency: string, taken: Set<string>): Promise<string[][]> {
    const sets = await this.db
      .selectFrom('sets')
      .select(['id', 'name', 'code', 'base_price_minor'])
      .where('active', '=', true)
      .where('base_currency', '=', currency)
      .where('base_price_minor', 'is not', null)
      .orderBy(sql`lower(name)`)
      .orderBy('id')
      .execute();
    if (sets.length === 0) return [];
    const pieces = await this.db
      .selectFrom('set_models as s')
      .innerJoin('models as m', 'm.id', 's.model_id')
      .select(['s.set_id', 's.model_id', 'm.name', 'm.variant_label', 'm.type'])
      .where('s.set_id', 'in', sets.map((x) => x.id))
      .orderBy('s.set_id')
      .orderBy('s.position')
      .execute();
    const packings = await modelPackings(this.db, [...new Set(pieces.map((p) => p.model_id))]);
    const used = new Set(taken);
    return sets.map((x) => {
      const own = pieces.filter((p) => p.set_id === x.id);
      const base = x.code.toLowerCase();
      let handle = used.has(base) ? `${base}-set` : base;
      for (let n = 2; used.has(handle); n++) handle = `${base}-set-${n}`;
      used.add(handle);
      const weights = own.map((p) => packings.get(p.model_id)?.packedWeightG ?? null);
      const row: Record<(typeof SHOPIFY_PRODUCT_COLUMNS)[number], string> = {
        Title: x.name,
        'URL handle': handle,
        Description: `THE SET: ${own.map((p) => `${p.name}${p.variant_label ? ` in ${p.variant_label}` : ''} (${p.type})`).join(', ')}.`,
        Vendor: SHOPIFY_VENDOR,
        Type: SHOPIFY_SET_TYPE,
        'Published on online store': 'false',
        Status: 'draft',
        SKU: x.code,
        'Option1 name': SHOPIFY_SINGLE_OPTION.name,
        'Option1 value': SHOPIFY_SINGLE_OPTION.value,
        'Option2 name': '',
        'Option2 value': '',
        Price: majorUnits(Number(x.base_price_minor)),
        'Weight value (grams)': weights.every((w): w is number => w !== null) ? String(weights.reduce((t, w) => t + w, 0)) : '',
        'Requires shipping': 'true',
        'Product image URL': '',
        'Image position': '',
        'Image alt text': '',
        'Variant image URL': '',
      };
      return SHOPIFY_PRODUCT_COLUMNS.map((c) => row[c]);
    });
  }

  /** A model's Shopify product: its handle, its product id, its sizes as the export gives them with their variant ids. */
  async product(modelId: string): Promise<ShopifyProduct> {
    const id = modelKey(modelId);
    const m = await this.db.selectFrom('models').select(['id', 'name', 'sku_prefix', 'variant_of']).where('id', '=', id).executeTakeFirst();
    if (!m) throw modelNotFound();
    const skus = await this.db.selectFrom('skus').select(['size_label', 'code', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', id).where('set_aside_at', 'is', null).execute();
    return {
      model: { id: m.id, name: m.name, skuPrefix: m.sku_prefix },
      // The handle the product export writes for this model (a variant's: its main model's, N1), so the console names the
      // product Shopify imported.
      handle: (await handlesOf(this.db)).get(m.variant_of ?? m.id)!,
      productId: skus.find((k) => k.shopify_product_id !== null)?.shopify_product_id ?? null,
      variants: variantsOf(m.sku_prefix, skus),
    };
  }

  /**
   * The ids pasted back from Shopify (see the header): the product's on every SKU of the model, each size's variant on
   * its SKU. Every size given is one of the export's (400 otherwise), once; a variant needs the product (400). 409
   * SHOPIFY_PRODUCT_TAKEN when the SKUs of a model outside its group carry that product (N1: a model and its variants
   * share theirs), SHOPIFY_VARIANT_TAKEN when another SKU carries that variant. The model's row first (FOR NO KEY UPDATE: pieces and SKUs of it may still be written), then the
   * product's advisory lock (ADVISORY_LOCK.SHOPIFY_PRODUCT: no unique index keeps one product to one model), then its
   * SKUs by id, the audit last.
   */
  async link(modelId: string, input: ShopifyLinkInput, actor: Actor): Promise<ShopifyProduct> {
    const id = modelKey(modelId);
    if (input === null || typeof input !== 'object' || !Array.isArray(input.variants)) throw validationError('Send the product id and the variant id of each size.');
    const productId = shopifyIdOf(input.productId, 'products');
    const given = input.variants.map((v) => ({ size: v?.size === null || v?.size === undefined ? null : String(v.size), variantId: shopifyIdOf(v?.variantId, 'variants') }));
    const sizes = new Set(given.map((v) => v.size ?? ''));
    if (sizes.size !== given.length) throw validationError('Each size is given once.');
    const variantIds = given.map((v) => v.variantId).filter((v): v is string => v !== null);
    if (new Set(variantIds).size !== variantIds.length) throw validationError('Each variant id belongs to one size.');
    if (productId === null && variantIds.length > 0) throw validationError('A variant id is given with its product id.');
    try {
      await inTransaction(this.db, async (tx) => {
        const m = await tx.selectFrom('models').select(['id', 'sku_prefix', 'variant_of', 'size_type']).where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
        if (!m) throw modelNotFound();
        // N1: the models of its product, a main model and its variants.
        const root = m.variant_of ?? m.id;
        const group = (await tx.selectFrom('models').select('id').where((eb) => eb.or([eb('id', '=', root), eb('variant_of', '=', root)])).execute()).map((g) => g.id);
        // Plan NEXT LOT §3.3: the export's sizes are the offered ones; a size set aside is unknown here, its ids kept.
        const before = await tx.selectFrom('skus').select(['id', 'size_label', 'code', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', id).where('set_aside_at', 'is', null).execute();
        const known = variantsOf(m.sku_prefix, before);
        for (const v of given) {
          if (!known.some((k) => k.size === v.size)) throw validationError(`${v.size ?? ONE_SIZE_LABEL} is not a size of this model in the export.`);
        }
        if (productId !== null) {
          // Two links of one product run one after the other, so the check below sees the other's SKUs.
          await advisoryXactLock(tx, ADVISORY_LOCK.SHOPIFY_PRODUCT, lockKeyOf(productId));
          // Another model's SKUs, or an add-on's (its SKU has no model; macro scope K48 D1, S5: one product each).
          const other = await tx
            .selectFrom('skus')
            .select('id')
            .where('shopify_product_id', '=', productId)
            .where((eb) => eb.or([eb('model_id', 'not in', group), eb('model_id', 'is', null)]))
            .executeTakeFirst();
          const addon = await tx.selectFrom('addon_items').select('id').where('shopify_product_id', '=', productId).executeTakeFirst();
          // Macro scope K44 T1 (S5): a set is one product of its own too.
          const set = await tx.selectFrom('sets').select('id').where('shopify_product_id', '=', productId).executeTakeFirst();
          if (other || addon || set) throw shopifyProductTaken();
        }
        // A size of the export without its SKU yet (a model in one size never issued nor sold) has it now, given or not:
        // the product's id is kept on the model's SKUs, so a linked model has at least one. A typed model's sizes are
        // all declared (plan NEXT LOT §3.3): none is created here.
        if (productId !== null && m.size_type === null) for (const k of known) if (!k.known) await ensureSku(tx, id, k.size);
        const skus = await tx.selectFrom('skus').select(['id', 'size_label', 'code', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', id).where('set_aside_at', 'is', null).orderBy('id').execute();
        const changes: { sku: string; from: string | null; to: string | null }[] = [];
        const products: { from: string | null; to: string | null } = {
          from: before.find((k) => k.shopify_product_id !== null)?.shopify_product_id ?? null,
          to: skus.length > 0 ? productId : null,
        };
        for (const k of skus) {
          const v = given.find((g) => g.size === k.size_label);
          // Without the product, no variant stands; a size not given keeps its variant of the same product.
          const variant = productId === null ? null : v ? v.variantId : k.shopify_product_id === productId ? k.shopify_variant_id : null;
          if (k.shopify_product_id === productId && k.shopify_variant_id === variant) continue;
          if (k.shopify_variant_id !== variant) changes.push({ sku: k.code, from: k.shopify_variant_id, to: variant });
          await tx.updateTable('skus').set({ shopify_product_id: productId, shopify_variant_id: variant }).where('id', '=', k.id).execute();
        }
        if (changes.length === 0 && products.from === products.to) return;
        changes.sort((a, b) => a.sku.localeCompare(b.sku, 'en', { numeric: true }));
        await this.audit.record({ actor, action: 'model.shopify', targetType: 'model', targetId: id, details: { product: products, variants: changes } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'skus_shopify_variant_key')) throw conflict('SHOPIFY_VARIANT_TAKEN', 'Another size already has this Shopify variant id.');
      throw e;
    }
    return this.product(id);
  }

  // ── The order export (N3) ────────────────────────────────────────────────

  /**
   * The priced orders reserved from `from` to `to` (UTC days, both included), the oldest first, as Shopify's order CSV
   * (see the header); never an order of a test account. `view` masks the email and the buyer for an AUDITOR.
   */
  async orderCsv(
    period: { from: string; to: string },
    view: { email: (stored: string) => string; buyer: (b: { name: string | null; address: string | null }) => { name: string | null; address: string | null } },
  ): Promise<{ filename: string; contentType: string; body: string }> {
    const start = Date.parse(`${period?.from}T00:00:00.000Z`);
    const end = Date.parse(`${period?.to}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period?.from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(period?.to ?? '') || Number.isNaN(start) || Number.isNaN(end)) {
      throw validationError('A period is two days, YYYY-MM-DD.');
    }
    if (end < start) throw validationError('The period ends on or after its first day.');
    if ((end - start) / DAY_MS + 1 > SHOPIFY_PERIOD_MAX_DAYS) throw validationError(`A period is at most ${SHOPIFY_PERIOD_MAX_DAYS} days.`);
    const rows = (await this.db
      .selectFrom('orders as o')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .innerJoin('models as m', 'm.id', 'o.model_id')
      .innerJoin('stock_locations as l', 'l.id', 'o.location_id')
      .leftJoin('skus as k', 'k.id', 'o.sku_id')
      .leftJoin('carriers as c', 'c.id', 'o.carrier_id')
      .select([
        'o.id', 'o.channel', 'o.status', 'o.size_label', 'o.price_minor', 'o.currency', 'o.addons', 'o.buyer_name', 'o.buyer_address', 'o.reserved_at', 'o.paid_at',
        'o.shipped_at', 'o.cancelled_at', 'o.shopify_order_id', 'o.shipping_minor', 'o.with_order_id', 'a.email', 'm.name as model_name', 'k.code as sku_code', 'c.name as carrier_name', 'l.name as location_name',
      ])
      .where('o.reserved_at', '>=', new Date(start))
      .where('o.reserved_at', '<', new Date(end + DAY_MS))
      .where('o.price_minor', 'is not', null)
      .where(sql<boolean>`${notTestEntrant('o.account_id')}`) // never an order of a test account (TEST ENTRANTS)
      .orderBy('o.reserved_at')
      .orderBy('o.id')
      .execute()) as OrderRow[];
    // Plan MACRO M3 §4.2 (S5): each catalogue add-on unit (not removed) is a line item after the piece's; a service's is
    // not shipped (lot Q2, D9).
    const units = await exportAddonUnits(this.db, rows.map((r) => r.id));
    const out: string[][] = [];
    for (const r of rows) {
      const items = units.get(r.id) ?? [];
      const subtotal = r.price_minor + r.addons.reduce((n, a) => n + a.priceMinor, 0) + items.reduce((n, u) => n + u.priceMinor, 0);
      // BP-19 T4: its shipping fee (0 when free by its tier); an order travelling with another carries none of its own.
      const shipping = r.with_order_id === null ? (r.shipping_minor ?? 0) : 0;
      const fulfilled = shopifyFulfilled(r.status);
      const financial = shopifyFinancialStatus(r.status, r.paid_at !== null);
      const buyer = view.buyer({ name: r.buyer_name, address: r.buyer_address });
      const lines = (buyer.address ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const name = orderReference(r.id);
      const line = (item: { name: string; price: number; sku: string; shipping: boolean }) => ({
        'Lineitem quantity': '1',
        'Lineitem name': item.name,
        'Lineitem price': majorUnits(item.price),
        'Lineitem SKU': item.sku,
        'Lineitem requires shipping': item.shipping ? 'true' : 'false',
        'Lineitem taxable': 'false',
        'Lineitem fulfillment status': fulfilled ? 'fulfilled' : 'pending',
      });
      const first: Partial<Record<(typeof SHOPIFY_ORDER_COLUMNS)[number], string>> = {
        Name: name,
        Email: view.email(r.email),
        'Financial Status': financial,
        'Paid at': shopifyDate(r.paid_at),
        'Fulfillment Status': fulfilled ? 'fulfilled' : 'unfulfilled',
        'Fulfilled at': shopifyDate(fulfilled ? r.shipped_at : null),
        Currency: r.currency,
        Subtotal: majorUnits(subtotal),
        Shipping: majorUnits(shipping),
        Taxes: '0.00',
        Total: majorUnits(subtotal + shipping),
        'Shipping Method': r.carrier_name ?? '',
        'Created at': shopifyDate(r.reserved_at),
        ...line({ name: r.size_label ? `${r.model_name} - ${r.size_label}` : r.model_name, price: r.price_minor, sku: r.sku_code ?? '', shipping: true }),
        'Billing Name': buyer.name ?? '',
        'Billing Street': lines.join(', '),
        'Billing Address1': lines[0] ?? '',
        'Billing Address2': lines.slice(1).join(', '),
        'Shipping Name': buyer.name ?? '',
        'Shipping Street': lines.join(', '),
        'Shipping Address1': lines[0] ?? '',
        'Shipping Address2': lines.slice(1).join(', '),
        'Canceled at': shopifyDate(r.cancelled_at),
        'Refunded Amount': financial === 'refunded' ? majorUnits(subtotal + shipping) : '',
        Vendor: SHOPIFY_VENDOR,
        Location: r.location_name,
        Id: r.shopify_order_id ?? '',
        Source: `orbes-${r.channel.toLowerCase()}`,
      };
      out.push(SHOPIFY_ORDER_COLUMNS.map((c) => first[c] ?? ''));
      for (const a of r.addons) {
        const next: Partial<Record<(typeof SHOPIFY_ORDER_COLUMNS)[number], string>> = { Name: name, ...line({ name: a.label, price: a.priceMinor, sku: '', shipping: false }), Vendor: SHOPIFY_VENDOR };
        out.push(SHOPIFY_ORDER_COLUMNS.map((c) => next[c] ?? ''));
      }
      for (const u of items) {
        const next: Partial<Record<(typeof SHOPIFY_ORDER_COLUMNS)[number], string>> = { Name: name, ...line({ name: u.name, price: u.priceMinor, sku: u.skuCode, shipping: u.shipping }), Vendor: SHOPIFY_VENDOR };
        out.push(SHOPIFY_ORDER_COLUMNS.map((c) => next[c] ?? ''));
      }
    }
    return {
      filename: `ORBES-shopify-orders-${period.from}-to-${period.to}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: csvDocument([[...SHOPIFY_ORDER_COLUMNS], ...out]),
    };
  }
}

/** A model's sizes as the export gives them, sorted: its SKUs, or one size when it has none yet. */
/**
 * Every model's product handle, as the product export writes it: unique across the catalogue (Shopify keys a product by
 * its handle), whatever the currency exported. The lookbook addresses first (unique already), then each other model by
 * name and id with its own handle (shopifyHandle); one already given takes the model's SKU prefix, then a number, until
 * it is free. The same models in the same order give the same handles, in the export and in the console's dialog.
 * Only a main model takes a handle (N1): a variant is its main model's product and names its handle, so adding one
 * never takes or shifts the handle a product was imported under.
 */
async function handlesOf(db: Db): Promise<Map<string, string>> {
  const all = await db.selectFrom('models').select(['id', 'name', 'slug', 'sku_prefix', 'variant_of']).orderBy('name').orderBy('id').execute();
  const models = all.filter((m) => m.variant_of === null);
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const m of models) {
    if (m.slug === null) continue;
    taken.add(m.slug);
    out.set(m.id, m.slug);
  }
  for (const m of models) {
    if (m.slug !== null) continue;
    const base = shopifyHandle({ name: m.name, slug: null, skuPrefix: m.sku_prefix });
    let handle = base;
    if (taken.has(handle)) handle = `${base}-${shopifyHandle({ name: m.sku_prefix, slug: null, skuPrefix: m.sku_prefix })}`;
    for (let n = 2; taken.has(handle); n++) handle = `${base}-${shopifyHandle({ name: m.sku_prefix, slug: null, skuPrefix: m.sku_prefix })}-${n}`;
    taken.add(handle);
    out.set(m.id, handle);
  }
  for (const m of all) if (m.variant_of !== null) out.set(m.id, out.get(m.variant_of)!);
  return out;
}

function variantsOf(prefix: string, skus: readonly { size_label: string | null; code: string; shopify_variant_id: string | null }[]): ShopifyVariant[] {
  if (skus.length === 0) return [{ size: null, sku: oneSizeCode(prefix), known: false, variantId: null }];
  return [...skus]
    .sort((a, b) => compareSizes(a.size_label, b.size_label))
    .map((k) => ({ size: k.size_label, sku: k.code, known: true, variantId: k.shopify_variant_id }));
}

/**
 * A Shopify product id as the second part of its advisory lock (ADVISORY_LOCK.SHOPIFY_PRODUCT): an int4 (FNV-1a over
 * its digits). A model's link and an add-on's (services/addons.ts) take the same lock, so a product goes to one of them.
 */
export function lockKeyOf(productId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < productId.length; i++) h = Math.imul(h ^ productId.charCodeAt(i), 0x01000193);
  return h | 0;
}

function modelKey(modelId: string): string {
  if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
  return modelId.toLowerCase();
}

/** 409 SHOPIFY_PRODUCT_TAKEN: another model is linked to that Shopify product. */
export const shopifyProductTaken = () => conflict('SHOPIFY_PRODUCT_TAKEN', 'Another model, add-on or set is already linked to this Shopify product.');
