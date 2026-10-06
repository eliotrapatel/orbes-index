/**
 * Shopify readiness in the console (plan LIVE RELEASE+, N2 and N3), as pure functions the views and the tests share:
 * what the Catalogue says of a model's base price and its Shopify product, what the product export will hold in a
 * currency, the ids pasted back from Shopify's admin (the number, or the address of its page), and the period of the
 * order export. The server checks everything again (services/shopify.ts); this only says a mistake before it is sent.
 */
import { formatCount } from '../format.js';
import { ORDER_CURRENCIES, type Model, type ShopifyLink, type ShopifyProduct } from '../types.js';
import { formatMoney } from './live.js';

/** The longest period one order export covers, in days (services/shopify.ts SHOPIFY_PERIOD_MAX_DAYS). */
export const SHOPIFY_PERIOD_MAX_DAYS = 366;
/** A Shopify id: a positive decimal of at most 20 figures. */
const SHOPIFY_ID_RE = /^[1-9][0-9]{0,19}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A model's base price as the Catalogue reads it: `€ 4 800`, or None. */
export function basePriceText(m: Pick<Model, 'basePriceMinor' | 'baseCurrency'>): string {
  return m.basePriceMinor === null || m.baseCurrency === null ? 'None' : formatMoney(m.basePriceMinor, m.baseCurrency);
}

/** How far a model is linked to its Shopify product: NOT LINKED, LINKED, or LINKED · 2 OF 3 SIZES. */
export function shopifyStatus(m: Pick<Model, 'shopify'>): string {
  if (m.shopify.productId === null) return 'NOT LINKED';
  if (m.shopify.linked >= m.shopify.variants) return 'LINKED';
  return `LINKED · ${formatCount(m.shopify.linked)} OF ${formatCount(m.shopify.variants)} SIZES`;
}

/**
 * What the product export holds in a currency: the models priced in it, and those it leaves out. A model and its
 * variants are one product (NOCTURNE N1), by Variant and Size.
 */
export function productExportSummary(models: readonly (Pick<Model, 'id' | 'baseCurrency' | 'basePriceMinor'> & { variantOf?: Model['variantOf'] })[], currency: string): string {
  const priced = models.filter((m) => m.basePriceMinor !== null && m.baseCurrency !== null);
  const keptModels = priced.filter((m) => m.baseCurrency === currency);
  const kept = keptModels.length;
  const products = new Set(keptModels.map((m) => m.variantOf?.id ?? m.id)).size;
  const other = priced.length - kept;
  const none = models.length - priced.length;
  const n = (k: number, one: string, many: string) => `${formatCount(k)} ${k === 1 ? one : many}`;
  return [
    kept === 0
      ? `No model has a base price in ${currency}: the file holds its header only.`
      : products === kept
        ? `${n(kept, 'model', 'models')} priced in ${currency}, each a product with its sizes as variants and its photographs.`
        : `${n(kept, 'model', 'models')} priced in ${currency}, in ${n(products, 'product', 'products')}: a model and its variants are one product, by Variant and Size, with their photographs.`,
    other > 0 ? `${n(other, 'model priced', 'models priced')} in another currency ${other === 1 ? 'is' : 'are'} left out.` : null,
    none > 0 ? `${n(none, 'model', 'models')} without a base price ${none === 1 ? 'is' : 'are'} left out: set it with Edit.` : null,
    'Each product is a draft, not published: Shopify decides nothing until the store is open.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The currencies the export is offered in. */
export const SHOPIFY_CURRENCY_OPTIONS = ORDER_CURRENCIES.map((c) => ({ value: c, label: c }));

/**
 * An id pasted from Shopify's admin: the number, or the address of its page (…/products/123, …/variants/456).
 * `''` is none (null); undefined when it is neither.
 */
export function pastedShopifyId(input: string | undefined, kind: 'products' | 'variants'): string | null | undefined {
  const s = (input ?? '').trim();
  if (s === '') return null;
  if (SHOPIFY_ID_RE.test(s)) return s;
  const m = new RegExp(`/${kind}/([1-9][0-9]{0,19})(?:[/?#]|$)`).exec(s);
  return m ? m[1] : undefined;
}

/** The dialog's field of a size: `variant-<n>`, its place in the export's list. */
export const variantField = (i: number) => `variant-${i}`;

/** The values the dialog opens with. */
export function shopifyValues(p: ShopifyProduct): Record<string, string> {
  return Object.fromEntries([['productId', p.productId ?? ''], ...p.variants.map((v, i) => [variantField(i), v.variantId ?? ''])]);
}

/** What the server would refuse in the dialog, or null. */
export function shopifyLinkProblem(p: ShopifyProduct, v: Record<string, string>): string | null {
  const product = pastedShopifyId(v.productId, 'products');
  if (product === undefined) return 'The product id is the number at the end of the product’s address in Shopify’s admin.';
  const variants = p.variants.map((_, i) => pastedShopifyId(v[variantField(i)], 'variants'));
  if (variants.some((x) => x === undefined)) return 'A variant id is the number at the end of the variant’s address in Shopify’s admin.';
  const given = variants.filter((x): x is string => typeof x === 'string');
  if (product === null && given.length > 0) return 'A variant id is pasted with its product id.';
  if (new Set(given).size !== given.length) return 'Each variant id belongs to one size.';
  const change = shopifyLinkInput(p, v);
  const same = change.productId === p.productId && change.variants.every((x, i) => x.variantId === p.variants[i].variantId);
  return same ? 'Nothing has changed.' : null;
}

/** What PUT /api/admin/models/:id/shopify sends: the product and every size of the export with its id (null: none). */
export function shopifyLinkInput(p: ShopifyProduct, v: Record<string, string>): ShopifyLink {
  const productId = pastedShopifyId(v.productId, 'products') ?? null;
  return { productId, variants: p.variants.map((x, i) => ({ size: x.size, variantId: productId === null ? null : (pastedShopifyId(v[variantField(i)], 'variants') ?? null) })) };
}

/** The order export's period by default: the first day of the month to today (UTC). */
export function defaultPeriod(now: Date): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** What the server would refuse in a period, or null. */
export function periodProblem(from: string | undefined, to: string | undefined): string | null {
  const day = (s: string | undefined) => (s && DAY_RE.test(s) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s ? Date.parse(`${s}T00:00:00.000Z`) : NaN);
  const a = day(from);
  const b = day(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Choose the first and the last day.';
  if (b < a) return 'The last day comes on or after the first.';
  if ((b - a) / DAY_MS + 1 > SHOPIFY_PERIOD_MAX_DAYS) return `A period is at most ${SHOPIFY_PERIOD_MAX_DAYS} days.`;
  return null;
}
