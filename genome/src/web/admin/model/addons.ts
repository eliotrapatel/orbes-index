/**
 * The add-ons in the console (macro scope of 2026-10-20, K48 D1 and D2; lot M3 plan §4.3, step M3.11): pure helpers, no
 * DOM.
 *
 *  - Catalogue → Add-ons: an add-on's words as its row reads them (its prices, its stock and minimums per location, its
 *    state, its Shopify link), its dialog's checks (the bounds of migration 0056, the SKU code's rule) and what it sends
 *    (a creation with its SKU code and prices; an edit only what changed, its fields and its prices apart).
 *  - Logistics: an add-on's SKU named by its add-on, never a size (`model` null): the stock's ADD-ONS group, a reception's
 *    line counted in without an ORBES CODE, the supplier orders' lines.
 *  - The order page's Add-ons: the units grouped (name × units, price, who added it, status), Add an add-on's options,
 *    units and total, Remove's words; the draw's Confirm and the salon's Accept: the collector's choices, and what was
 *    left out after.
 *  - The parcel and its slips: the add-ons to pack (POLISHING CLOTH × 2), never a price.
 * The server stays the authority (409 ADDON_NAME_TAKEN, SKU_CODE_TAKEN, ADDON_OUT_OF_STOCK, ADDON_LIMIT, ADDON_NOT_OFFERED).
 */
import { formatCount } from '../format.js';
import {
  ADDON_LINE_MAX,
  ADDON_NAME_MAX,
  ADDON_PRICE_MINOR_MAX,
  ADDON_UNITS_MAX,
  ADDON_WEIGHT_G_MAX,
  HOUSE_CURRENCIES,
  type AddonCreateInput,
  type AddonInput,
  type AddonView,
  type AdminOrderAddonUnit,
  type ChosenAddon,
  type HouseCurrency,
  type LeftOutAddon,
  type LogisticsSku,
  type OrderAddonOffer,
  type OrderAddonStatus,
  type OrderView,
  type ParcelPiece,
} from '../types.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import { pastedShopifyId } from './shopify.js';

/** An add-on SKU's code (services/addons.ts ADDON_SKU_CODE_RE): 2 to 64 capitals, digits and hyphens, a capital or a digit first. */
export const ADDON_SKU_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,63}$/;

/** The bounds of an add-on (migration 0056, mirrored in types.ts). */
export const ADDON_LIMITS = Object.freeze({ name: ADDON_NAME_MAX, line: ADDON_LINE_MAX, weightG: ADDON_WEIGHT_G_MAX, priceMinor: ADDON_PRICE_MINOR_MAX, units: ADDON_UNITS_MAX, skuCode: 64 });

// ── Catalogue → Add-ons ────────────────────────────────────────────────────

export const ADDONS_TEXT = Object.freeze({
  title: 'Add-ons',
  lead: 'Items sold with a piece: a care kit, a polishing cloth, a chain extender. Each has its own SKU and stock, no ORBES CODE, and never counts toward the tier. It is offered when a purchase is confirmed and in YOUR ORDERS until packing begins, in each currency it has a price in, while one is in stock at the order’s location. Its stock moves in Logistics; the Shopify export lists each active add-on priced in the store’s currency.',
  empty: 'No add-on yet.',
  add: 'New add-on',
  addTitle: 'New add-on',
  editTitle: 'Edit the add-on',
  eyebrow: 'Catalogue · Add-ons',
  added: 'Add-on added.',
  saved: 'Add-on saved.',
  unchanged: 'Nothing has changed.',
  nameHint: 'As the collector reads it: POLISHING CLOTH. A colour or a length is an add-on of its own.',
  lineHint: 'One line under its name, as the collector reads it. Optional.',
  skuHint: 'Its own SKU, for its stock and its supplier orders: capitals, digits and hyphens, such as ADD-CLOTH. It never changes.',
  skuFixed: (code: string) => `Its SKU, ${code}, never changes.`,
  supplierHint: 'Its supplier orders go to this supplier. None: it cannot be ordered yet.',
  weightHint: 'In grams, for the parcel’s weight. Empty: unknown.',
  priceHint: (currency: string, first: boolean) => (first ? `In units: 15, or 15.50. Empty: not offered in ${currency}.` : `Empty: not offered in ${currency}.`),
  setAside: 'Set aside',
  setAsideTitle: 'Set the add-on aside',
  setAsideText: 'It is offered nowhere again: no order, no minimum, no supplier order. Its stock, its units on orders and its history stay.',
  setAsideDone: 'Add-on set aside.',
  reinstate: 'Reinstate',
  reinstateTitle: 'Reinstate the add-on',
  reinstateText: 'It is offered again, in each currency it has a price in, while one is in stock.',
  reinstateDone: 'Add-on reinstated.',
  shopify: 'Shopify',
  shopifyTitle: 'Shopify ids',
  shopifyText: (code: string) =>
    `Once the product export is imported, paste here the id Shopify gave the add-on’s product and its one variant (SKU ${code}): the number at the end of its address in Shopify’s admin, or the address itself. They link both sides; nothing is sent to Shopify.`,
  shopifySaved: 'Shopify ids saved.',
});

/** A price of an add-on as its row reads it: `€ 15`. */
export function addonPriceText(p: { priceMinor: number; currency: string }): string {
  return formatMoney(p.priceMinor, p.currency);
}

/** Its prices, in the house currencies' order; none: said. */
export function addonPricesText(a: Pick<AddonView, 'prices'>): string[] {
  return a.prices.length ? a.prices.map(addonPriceText) : ['No price: offered nowhere'];
}

/** Its weight: `20 g`, or Unknown. */
export function addonWeightText(a: Pick<AddonView, 'weightG'>): string {
  return a.weightG === null ? 'Unknown' : `${formatCount(a.weightG)} g`;
}

/** Its stock per location, each location listed (0 included): what is available, and its minimum when it has one. */
export function addonStockLines(a: Pick<AddonView, 'stock'>): string[] {
  return a.stock.map((s) => `${s.location.name} · ${formatCount(s.available)}${s.minimum === null ? '' : ` · minimum ${formatCount(s.minimum)}`}`);
}

/** Its state as its mark reads. */
export function addonState(a: Pick<AddonView, 'active'>): 'ACTIVE' | 'SET ASIDE' {
  return a.active ? 'ACTIVE' : 'SET ASIDE';
}

/** How far it is linked to its Shopify product (one product, one variant), as a model's row says it. */
export function addonShopifyStatus(a: Pick<AddonView, 'shopifyProductId' | 'sku'>): string {
  if (a.shopifyProductId === null) return 'NOT LINKED';
  return a.sku.shopifyVariantId === null ? 'LINKED · NO VARIANT' : 'LINKED';
}

export type AddonForm = Record<'name' | 'line' | 'skuCode' | 'supplierId' | 'weightG' | 'EUR' | 'GBP' | 'USD' | 'CHF', string>;

/** The add-on dialog's values as it opens: the add-on's, or empty for a new one. */
export function addonFormValues(a: AddonView | null): AddonForm {
  const price = (c: HouseCurrency) => {
    const p = a?.prices.find((x) => x.currency === c);
    return p ? moneyField(p.priceMinor) : '';
  };
  return {
    name: a?.name ?? '',
    line: a?.line ?? '',
    skuCode: a?.sku.code ?? '',
    supplierId: a?.supplier?.id ?? '',
    weightG: a?.weightG === null || a?.weightG === undefined ? '' : String(a.weightG),
    EUR: price('EUR'),
    GBP: price('GBP'),
    USD: price('USD'),
    CHF: price('CHF'),
  };
}

/** The supplier select: None, the active suppliers, and the add-on's own when it is no longer active. */
export function addonSupplierOptions(suppliers: readonly { id: string; name: string; active: boolean }[], a: AddonView | null): { value: string; label: string }[] {
  const listed = suppliers.filter((s) => s.active || s.id === a?.supplier?.id);
  return [{ value: '', label: 'None' }, ...listed.map((s) => ({ value: s.id, label: s.active ? s.name : `${s.name} · INACTIVE` }))];
}

/** A whole number of grams typed (spaces allowed) within its bounds; null otherwise. */
function grams(text: string | undefined): number | null {
  const s = (text ?? '').replace(/[\s  ]/g, '');
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= ADDON_LIMITS.weightG ? n : null;
}

/** The SKU code as it is sent: trimmed, in capitals. */
export function skuCodeOf(text: string | undefined): string {
  return (text ?? '').trim().toUpperCase();
}

/** The add-on dialog's check: what the server would refuse, said before anything is sent (`creating`: the SKU code too). */
export function addonProblem(v: Partial<AddonForm>, creating: boolean): string | null {
  const name = (v.name ?? '').trim();
  if (!name) return 'Name the add-on.';
  if (name.length > ADDON_LIMITS.name) return `A name has at most ${ADDON_LIMITS.name} characters.`;
  if (/[\r\n]/.test(name)) return 'A name holds on one line.';
  const line = (v.line ?? '').trim();
  if (line.length > ADDON_LIMITS.line) return `Its line has at most ${ADDON_LIMITS.line} characters.`;
  if (/[\r\n]/.test(line)) return 'Its line holds on one line.';
  if (creating && !ADDON_SKU_CODE_RE.test(skuCodeOf(v.skuCode))) return 'A SKU code is 2 to 64 capitals, digits and hyphens, starting with a capital or a digit: ADD-CLOTH.';
  if ((v.weightG ?? '').trim() !== '' && grams(v.weightG) === null) return `The weight is a whole number of grams, 1 to ${formatCount(ADDON_LIMITS.weightG)}.`;
  for (const c of HOUSE_CURRENCIES) {
    const text = (v[c] ?? '').trim();
    if (text === '') continue;
    const minor = parseMoney(text);
    if (minor === null || minor > ADDON_LIMITS.priceMinor) return `The price in ${c} reads 15, or 15.50.`;
  }
  return null;
}

/** The prices typed, by currency (an empty one: none). */
function pricesOf(v: Partial<AddonForm>): Partial<Record<HouseCurrency, number | null>> {
  const out: Partial<Record<HouseCurrency, number | null>> = {};
  for (const c of HOUSE_CURRENCIES) {
    const text = (v[c] ?? '').trim();
    out[c] = text === '' ? null : parseMoney(text);
  }
  return out;
}

/** What New add-on sends: its fields, its SKU code, and its prices (the currencies given). */
export function addonCreateInput(v: AddonForm): AddonCreateInput {
  const line = v.line.trim();
  const prices = Object.fromEntries(Object.entries(pricesOf(v)).filter(([, p]) => p !== null)) as Partial<Record<HouseCurrency, number>>;
  return {
    name: v.name.trim(),
    skuCode: skuCodeOf(v.skuCode),
    ...(line ? { line } : {}),
    ...(v.supplierId ? { supplierId: v.supplierId } : {}),
    ...(v.weightG.trim() ? { weightG: grams(v.weightG)! } : {}),
    ...(Object.keys(prices).length ? { prices } : {}),
  };
}

/** What Edit sends: the fields that changed (PATCH) and the prices that changed (PUT …/prices, null removes one). */
export function addonChange(a: AddonView, v: AddonForm): { fields: AddonInput; prices: Partial<Record<HouseCurrency, number | null>> } {
  const fields: AddonInput = {};
  const name = v.name.trim();
  if (name !== a.name) fields.name = name;
  const line = v.line.trim() || null;
  if (line !== a.line) fields.line = line;
  const supplierId = v.supplierId || null;
  if (supplierId !== (a.supplier?.id ?? null)) fields.supplierId = supplierId;
  const weightG = v.weightG.trim() ? grams(v.weightG) : null;
  if (weightG !== a.weightG) fields.weightG = weightG;
  const prices: Partial<Record<HouseCurrency, number | null>> = {};
  const typed = pricesOf(v);
  for (const c of HOUSE_CURRENCIES) {
    const was = a.prices.find((p) => p.currency === c)?.priceMinor ?? null;
    if ((typed[c] ?? null) !== was) prices[c] = typed[c] ?? null;
  }
  return { fields, prices };
}

/** Whether an edit changes nothing. */
export function addonUnchanged(c: ReturnType<typeof addonChange>): boolean {
  return Object.keys(c.fields).length === 0 && Object.keys(c.prices).length === 0;
}

/** The Shopify dialog's values as it opens, its check and what it sends. */
export function addonShopifyValues(a: Pick<AddonView, 'shopifyProductId' | 'sku'>): { productId: string; variantId: string } {
  return { productId: a.shopifyProductId ?? '', variantId: a.sku.shopifyVariantId ?? '' };
}

export function addonShopifyProblem(a: Pick<AddonView, 'shopifyProductId' | 'sku'>, v: Record<string, string>): string | null {
  const product = pastedShopifyId(v.productId, 'products');
  if (product === undefined) return 'The product id is the number at the end of the product’s address in Shopify’s admin.';
  const variant = pastedShopifyId(v.variantId, 'variants');
  if (variant === undefined) return 'The variant id is the number at the end of the variant’s address in Shopify’s admin.';
  if (product === null && variant !== null) return 'A variant id is pasted with its product id.';
  return product === a.shopifyProductId && variant === a.sku.shopifyVariantId ? 'Nothing has changed.' : null;
}

export function addonShopifyInput(v: Record<string, string>): { productId: string | null; variantId: string | null } {
  const productId = pastedShopifyId(v.productId, 'products') ?? null;
  return { productId, variantId: productId === null ? null : (pastedShopifyId(v.variantId, 'variants') ?? null) };
}

// ── Logistics and the supplier orders: an add-on's SKU ─────────────────────

/** Whether a SKU is an add-on's (named by its add-on, never a size). */
export function isAddonSku(sku: Pick<LogisticsSku, 'model'>): boolean {
  return sku.model === null;
}

/** The first cell of a SKU's row: its model, or its add-on. */
export function skuOwnerName(sku: Pick<LogisticsSku, 'model' | 'addon'>): string {
  return sku.model?.name ?? sku.addon?.name ?? '—';
}

/** The words of Logistics and the supplier orders about an add-on's SKU. */
export const ADDON_SKU_TEXT = Object.freeze({
  mark: 'ADD-ON',
  group: 'Add-ons',
  groupLead: 'The add-ons’ stock at each location: counted without an ORBES CODE, held by the orders they are added to.',
  groupEmpty: 'No add-on yet: list one in Catalogue → Add-ons.',
  /** The LOGISTICS agent's, who has no Catalogue page. */
  groupEmptyAgent: 'No add-on yet.',
  receptionLine: 'No ORBES CODE: counted into stock',
});

// ── The order page's Add-ons ───────────────────────────────────────────────

/** A unit's state as the Add-ons part reads it. */
export const ADDON_STATUS_LABELS: Readonly<Record<OrderAddonStatus, string>> = Object.freeze({
  HELD: 'HELD',
  SHIPPED: 'SHIPPED',
  REMOVED: 'REMOVED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
});

export const ORDER_ADDONS_TEXT = Object.freeze({
  title: 'Add-ons',
  lead: 'The catalogue add-ons of this order: each unit held in stock at the order’s location, packed and shipped with it. Credits apply to the piece’s price only.',
  empty: 'No add-on on this order.',
  add: 'Add an add-on',
  addText: 'Units of an add-on in stock at the order’s location, at its price now in the order’s currency, held at once. At most 3 of each add-on on an order.',
  paidAdd: 'The order is paid: the add-on is added with its own invoice, in Documents.',
  added: 'Add-on added.',
  remove: 'Remove',
  removeTitle: 'Remove one add-on',
  paidRemove: 'The order is paid: a credit note is issued for its line, in Documents.',
  removed: 'Add-on removed.',
  noneTitle: 'No add-on to add',
  close: 'Close',
  notToSell: 'Add-ons not to be sold again',
  notToSellHint: 'Ticked: kept out of the stock. The others go back to stock with the piece.',
});

/** The units of an order grouped as its Add-ons part lists them: one row per add-on, price, who added it, state and invoice. */
export interface AddonGroup {
  addonId: string;
  name: string;
  skuCode: string;
  units: number;
  priceMinor: number;
  currency: HouseCurrency;
  status: OrderAddonStatus;
  addedBy: AdminOrderAddonUnit['addedBy'];
  addedAt: string;
  returnedToStock: boolean | null;
  invoiceId: string | null;
  location: string;
  /** Its units, oldest first: Remove takes the newest held. */
  unitIds: string[];
}

export function addonGroups(units: readonly AdminOrderAddonUnit[]): AddonGroup[] {
  const groups = new Map<string, AddonGroup>();
  for (const u of units) {
    const key = [u.addon.id, u.priceMinor, u.currency, u.status, u.addedBy.type, u.addedBy.id ?? '', u.returnedToStock ?? '', u.invoiceId ?? '', u.location.id].join('|');
    const g = groups.get(key);
    if (g) {
      g.units += 1;
      g.unitIds.push(u.id);
    } else {
      groups.set(key, {
        addonId: u.addon.id,
        name: u.addon.name,
        skuCode: u.skuCode,
        units: 1,
        priceMinor: u.priceMinor,
        currency: u.currency,
        status: u.status,
        addedBy: u.addedBy,
        addedAt: u.addedAt,
        returnedToStock: u.returnedToStock,
        invoiceId: u.invoiceId,
        location: u.location.name,
        unitIds: [u.id],
      });
    }
  }
  return [...groups.values()];
}

/** `POLISHING CLOTH × 2`. */
export function unitsWords(name: string, units: number): string {
  return `${name} × ${formatCount(units)}`;
}

/** A group's price: `€ 15 each · € 30` (one unit: `€ 15`). */
export function groupPriceText(g: Pick<AddonGroup, 'priceMinor' | 'currency' | 'units'>): string {
  const each = formatMoney(g.priceMinor, g.currency);
  return g.units > 1 ? `${each} each · ${formatMoney(g.priceMinor * g.units, g.currency)}` : each;
}

/** Who added a group: at the purchase, the collector in YOUR ORDERS, or a console user by email. */
export function addedByText(by: AdminOrderAddonUnit['addedBy'], actors: Record<string, string>): string {
  if (by.type === 'PURCHASE') return 'At the purchase';
  if (by.type === 'COLLECTOR') return 'The collector, in YOUR ORDERS';
  return (by.id && actors[by.id]) || 'A console user';
}

/** A returned group's line: back to stock, or kept out of it. */
export function returnedLine(g: Pick<AddonGroup, 'status' | 'returnedToStock'>): string | null {
  if (g.status !== 'RETURNED') return null;
  return g.returnedToStock === false ? 'Not to be sold again' : 'Back to stock';
}

/** Whether the order takes add-ons at all (not a welcome gift, a size exchange nor a Shopify order). */
export function orderTakesAddons(o: Pick<OrderView, 'channel' | 'shopifyOrderId'>): boolean {
  return o.channel !== 'GIFT' && o.channel !== 'EXCHANGE' && o.shopifyOrderId === null;
}

/**
 * Add an add-on: offered to OPERATOR, on an order RESERVED or PAID that takes add-ons, its currency entered (packing
 * begun or not). Once its parcel is packed, the dialog says so (the offer's `PACKED`) and the server refuses (409
 * PACKING_PACKED).
 */
export function canAddAddon(o: Pick<OrderView, 'channel' | 'shopifyOrderId' | 'status' | 'currency'>, manage: boolean): boolean {
  return manage && orderTakesAddons(o) && (o.status === 'RESERVED' || o.status === 'PAID') && o.currency !== null;
}

/** Remove: a group held, on an order RESERVED or PAID, until its parcel is packed (the server refuses after: 409 PACKING_PACKED). */
export function canRemoveAddon(o: Pick<OrderView, 'status'>, g: Pick<AddonGroup, 'status'>, manage: boolean): boolean {
  return manage && g.status === 'HELD' && (o.status === 'RESERVED' || o.status === 'PAID');
}

/** Add an add-on's select: each add-on offered, its price and what is in stock (`POLISHING CLOTH · € 15 · up to 3`). */
export function addonOfferOptions(offer: OrderAddonOffer): { value: string; label: string }[] {
  return offer.offer.map((x) => ({ value: x.addonId, label: `${x.name} · ${formatMoney(x.priceMinor, x.currency)} · up to ${formatCount(x.maxUnits)}` }));
}

/** The units select: 1 to 3. */
export const UNIT_OPTIONS = Object.freeze(Array.from({ length: ADDON_UNITS_MAX }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })));

/** Add an add-on's check: an add-on chosen, its units within what it can take. */
export function addAddonProblem(offer: OrderAddonOffer, v: Record<string, string>): string | null {
  const x = offer.offer.find((o) => o.addonId === v.addonId);
  if (!x) return 'Choose an add-on.';
  const units = Number(v.units);
  if (!Number.isInteger(units) || units < 1) return 'Choose the units.';
  if (units > x.maxUnits) return x.maxUnits === 1 ? `${x.name}: 1 can be added.` : `${x.name}: at most ${formatCount(x.maxUnits)} can be added.`;
  return null;
}

/** Add an add-on's total: `2 × € 15 = € 30`; null before an add-on is chosen. */
export function addAddonTotal(offer: OrderAddonOffer, v: Record<string, string>): string | null {
  const x = offer.offer.find((o) => o.addonId === v.addonId);
  const units = Number(v.units);
  if (!x || !Number.isInteger(units) || units < 1) return null;
  return `${formatCount(units)} × ${formatMoney(x.priceMinor, x.currency)} = ${formatMoney(x.priceMinor * units, x.currency)}`;
}

/** Why Add an add-on has nothing to offer. */
export function noOfferText(offer: OrderAddonOffer, location: string): string {
  if (offer.reason === 'NO_CURRENCY') return 'Add-ons are offered once the order’s price and currency are entered.';
  if (offer.reason === 'CLOSED') return 'This order can no longer change.';
  if (offer.reason === 'NOT_OFFERED') return 'Add-ons are not offered on this order.';
  if (offer.reason === 'PACKED') return 'The parcel is packed: it no longer changes.';
  return `No add-on is in stock at ${location} with a price in ${offer.currency ?? 'its currency'} just now.`;
}

/** Remove's words: one unit released to stock at its location. */
export function removeAddonText(g: Pick<AddonGroup, 'name' | 'location'>): string {
  return `One ${g.name} is released, back to the stock at ${g.location}.`;
}

/** A document that is an add-on's own invoice: `For POLISHING CLOTH × 2`; null otherwise. */
export function documentAddonLine(units: readonly AdminOrderAddonUnit[], documentId: string): string | null {
  const own = addonGroups(units.filter((u) => u.invoiceId === documentId));
  return own.length ? `For ${own.map((g) => unitsWords(g.name, g.units)).join(' · ')}` : null;
}

/** The units shipped with the order (an order case's REFUND: those that may be kept out of the stock). */
export function shippedUnits(units: readonly AdminOrderAddonUnit[]): { value: string; label: string }[] {
  const shipped = units.filter((u) => u.status === 'SHIPPED');
  const count = new Map<string, number>();
  return shipped.map((u) => {
    const n = (count.get(u.addon.id) ?? 0) + 1;
    count.set(u.addon.id, n);
    const of = shipped.filter((x) => x.addon.id === u.addon.id).length;
    return { value: u.id, label: of > 1 ? `${u.addon.name} · ${n} of ${of}` : u.addon.name };
  });
}

// ── The draw's Confirm and the salon's Accept ──────────────────────────────

/** The collector's choices: `POLISHING CLOTH × 2 · € 30` (the price when its currency is known and it is priced). */
export function choiceLines(choices: readonly ChosenAddon[], currency: string | null): string[] {
  return choices.map((c) => {
    const words = unitsWords(c.name, c.units);
    return currency && c.priceMinor !== null ? `${words} · ${formatMoney(c.priceMinor * c.units, currency)}` : words;
  });
}

export const CHOICES_TEXT = Object.freeze({
  drawLead: 'Add-ons the collector chose on the place held:',
  salonLead: 'Add-ons the collector chose with the request:',
  rule: 'Each is added to the order if one is in stock at its location then; one that is not is left out, never holding the sale.',
  leftOutTitle: 'Add-ons left out',
  leftOutLead: 'The order is created. These add-ons the collector chose could not be added:',
  leftOutAfter: 'Tell the collector, or add another in the order’s Add-ons.',
});

/** What was left out: `POLISHING CLOTH × 2: none left.` */
export function leftOutLines(left: readonly LeftOutAddon[]): string[] {
  return left.map((l) => `${unitsWords(l.name, l.units)}: ${l.reason === 'NONE_LEFT' ? 'none left' : 'no longer offered'}.`);
}

// ── The parcel and its slips ───────────────────────────────────────────────

/** What a parcel's order packs beside the piece: the release's add-ons, then the catalogue add-ons with their units. */
export function parcelAddonWords(p: Pick<ParcelPiece, 'addons' | 'addonItems'>): string[] {
  return [...p.addons, ...p.addonItems.map((a) => unitsWords(a.name, a.units))];
}

/** The catalogue add-ons an order packs (held, or shipped once it has gone), by add-on: `POLISHING CLOTH × 2`. */
export function orderPackedAddons(units: readonly AdminOrderAddonUnit[]): string[] {
  const out = new Map<string, { name: string; units: number }>();
  for (const u of units) {
    if (u.status !== 'HELD' && u.status !== 'SHIPPED') continue;
    const g = out.get(u.addon.id) ?? { name: u.addon.name, units: 0 };
    g.units += 1;
    out.set(u.addon.id, g);
  }
  return [...out.values()].map((g) => unitsWords(g.name, g.units));
}
