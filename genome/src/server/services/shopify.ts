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
 *                        (choice 9), the owner publishes there. A model inactive or discontinued is `archived`.
 *                        A model and its variants (plan NOCTURNE, N1) are ONE product, the main model's (its title, type
 *                        and handle): Option1 « Variant » (each model's label) and Option2 « Size » (its sizes; left out
 *                        when every model of it is in one size), each model of it priced in the store's currency in its
 *                        order (the main model first, then its variants as they were added), each with its own SKUs,
 *                        base price and photographs, its cover as the image of its variants (« Variant image URL »);
 *                        archived once none of them is active.
 *   the ids pasted back  N2: once imported, the product's id and each variant's, from Shopify's admin, are kept on the
 *                        model's SKUs (`skus.shopify_product_id`, one product per model; `skus.shopify_variant_id`, unique):
 *                        both sides are linked. A size of the export without its SKU yet has it created (ensureSku).
 *                        Audited `model.shopify` with the ids before and after; nothing written when nothing changes.
 *   the order export     N3: the orders reserved in a period (UTC days, at most SHOPIFY_PERIOD_MAX_DAYS), priced, in
 *                        Shopify's order CSV format (help.shopify.com, « Exporting orders », read 2026-10-05): one order
 *                        per ORBES order (one piece), its piece the first line item and each add-on the next ones (the
 *                        lines after the first carry only the order's name and the line item, as Shopify lays them
 *                        out), its steps as Shopify's financial and fulfilment statuses and their dates, its buyer
 *                        (Client Services' entry) as billing and shipping, and the collector's email, by which the
 *                        store matches its customers to the ORBES accounts once it exists. No VAT, no shipping fee:
 *                        taxes and shipping are 0.00. An AUDITOR reads the emails and the buyers masked (the routes).
 *
 * Only the columns ORBES fills are written, in the published order: Shopify leaves the others to their defaults on an
 * import, and its header names are its own (test/services/shopify.test.ts holds them against the published lists).
 */
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { OrderChannel, OrderStatus } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { majorUnits } from './live-console.js';
import { mediaUrl } from './media.js';
import { ORDER_CURRENCIES, orderReference } from './orders.js';
import { deriveSku, ensureSku, ONE_SIZE_LABEL } from './stock.js';

// ── Shopify's formats ──────────────────────────────────────────────────────

/** The product CSV's columns ORBES fills, in the order of Shopify's published product format. */
export const SHOPIFY_PRODUCT_COLUMNS = Object.freeze([
  'Title',
  'URL handle',
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

/** Sizes in the order a client reads them: ONE SIZE (null) first, then naturally (48, 50, 52; S, M, L as written). */
export function compareSizes(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || a.localeCompare(b);
}

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
    const skus = ids.length ? await this.db.selectFrom('skus').select(['model_id', 'size_label', 'code', 'shopify_variant_id']).where('model_id', 'in', ids).execute() : [];
    const gallery = ids.length ? await this.db.selectFrom('model_images').select(['model_id', 'sha256', 'alt']).where('model_id', 'in', ids).orderBy('model_id').orderBy('position').execute() : [];
    const handles = await handlesOf(this.db);
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
          'Requires shipping': v ? 'true' : '',
          'Product image URL': img ? `${this.publicOrigin}${img.url}` : '',
          'Image position': img ? String(i + 1) : '',
          'Image alt text': img ? img.alt : '',
          'Variant image URL': cover ? `${this.publicOrigin}${cover}` : '',
        };
        rows.push(SHOPIFY_PRODUCT_COLUMNS.map((c) => row[c]));
      }
    }
    const day = this.clock().toISOString().slice(0, 10);
    return { filename: `ORBES-shopify-products-${currency}-${day}.csv`, contentType: CSV_CONTENT_TYPE, body: csvDocument([[...SHOPIFY_PRODUCT_COLUMNS], ...rows]) };
  }

  /** A model's Shopify product: its handle, its product id, its sizes as the export gives them with their variant ids. */
  async product(modelId: string): Promise<ShopifyProduct> {
    const id = modelKey(modelId);
    const m = await this.db.selectFrom('models').select(['id', 'name', 'sku_prefix', 'variant_of']).where('id', '=', id).executeTakeFirst();
    if (!m) throw modelNotFound();
    const skus = await this.db.selectFrom('skus').select(['size_label', 'code', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', id).execute();
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
        const m = await tx.selectFrom('models').select(['id', 'sku_prefix', 'variant_of']).where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
        if (!m) throw modelNotFound();
        // N1: the models of its product, a main model and its variants.
        const root = m.variant_of ?? m.id;
        const group = (await tx.selectFrom('models').select('id').where((eb) => eb.or([eb('id', '=', root), eb('variant_of', '=', root)])).execute()).map((g) => g.id);
        const before = await tx.selectFrom('skus').select(['id', 'size_label', 'code', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', id).execute();
        const known = variantsOf(m.sku_prefix, before);
        for (const v of given) {
          if (!known.some((k) => k.size === v.size)) throw validationError(`${v.size ?? ONE_SIZE_LABEL} is not a size of this model in the export.`);
        }
        if (productId !== null) {
          // Two links of one product run one after the other, so the check below sees the other's SKUs.
          await advisoryXactLock(tx, ADVISORY_LOCK.SHOPIFY_PRODUCT, lockKeyOf(productId));
          const other = await tx.selectFrom('skus').select('id').where('shopify_product_id', '=', productId).where('model_id', 'not in', group).executeTakeFirst();
          if (other) throw shopifyProductTaken();
        }
        // A size of the export without its SKU yet (a model in one size never issued nor sold) has it now, given or not:
        // the product's id is kept on the model's SKUs, so a linked model has at least one.
        if (productId !== null) for (const k of known) if (!k.known) await ensureSku(tx, id, k.size);
        const skus = await tx.selectFrom('skus').select(['id', 'size_label', 'code', 'shopify_product_id', 'shopify_variant_id']).where('model_id', '=', id).orderBy('id').execute();
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
   * (see the header). `view` masks the email and the buyer for an AUDITOR.
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
        'o.shipped_at', 'o.cancelled_at', 'o.shopify_order_id', 'a.email', 'm.name as model_name', 'k.code as sku_code', 'c.name as carrier_name', 'l.name as location_name',
      ])
      .where('o.reserved_at', '>=', new Date(start))
      .where('o.reserved_at', '<', new Date(end + DAY_MS))
      .where('o.price_minor', 'is not', null)
      .orderBy('o.reserved_at')
      .orderBy('o.id')
      .execute()) as OrderRow[];
    const out: string[][] = [];
    for (const r of rows) {
      const subtotal = r.price_minor + r.addons.reduce((n, a) => n + a.priceMinor, 0);
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
        Shipping: '0.00',
        Taxes: '0.00',
        Total: majorUnits(subtotal),
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
        'Refunded Amount': financial === 'refunded' ? majorUnits(subtotal) : '',
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

/** A Shopify product id as the second part of its advisory lock: an int4 (FNV-1a over its digits). */
function lockKeyOf(productId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < productId.length; i++) h = Math.imul(h ^ productId.charCodeAt(i), 0x01000193);
  return h | 0;
}

function modelKey(modelId: string): string {
  if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw modelNotFound();
  return modelId.toLowerCase();
}

/** 409 SHOPIFY_PRODUCT_TAKEN: another model is linked to that Shopify product. */
const shopifyProductTaken = () => conflict('SHOPIFY_PRODUCT_TAKEN', 'Another model is already linked to this Shopify product.');
