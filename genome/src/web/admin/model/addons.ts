/**
 * The add-ons in the console (macro scope of 2026-10-20, K48 D1 and D2; lot M3 plan §4.3, step M3.11): pure helpers, no
 * DOM.
 *
 *  - Catalogue → Add-ons: an add-on's words as its row reads them (its type, WITH STOCK or SERVICE, where it is offered,
 *    how many releases pick it, the ENGRAVING mark, what it was converted from, its prices, its stock and minimums per
 *    location or No stock, its state, its Shopify link), its dialog's checks (the bounds of migrations 0056 and 0059, the
 *    SKU code's rule, the engraving's most characters) and what it sends (a creation with its type, SKU code, switches
 *    and prices; an edit only what changed, its fields and its prices apart; lot Q2, step Q2.7, D3, D4, D12, N3).
 *  - A release's pick (lot Q2, step Q2.7, D3, N7): the active add-ons a LIVE RELEASE or a draw may offer, ticked, the ones
 *    it cannot offer listed with why (its switch is off, no price in its currency), and what its form sends.
 *  - Logistics: an add-on's SKU named by its add-on, never a size (`model` null): the stock's ADD-ONS group, a reception's
 *    line counted in without an ORBES CODE, the supplier orders' lines.
 *  - The order page's Add-ons: the units grouped (name × units, price, who added it, status; a service's held nowhere),
 *    Add an add-on's options, units and total, Remove's words, the engraving's unit beside its words; the draw's Confirm
 *    and the salon's Accept: the collector's choices, and what was left out after.
 *  - The parcel and its slips: the add-ons to pack (POLISHING CLOTH × 2), never a price.
 * The server stays the authority (409 ADDON_NAME_TAKEN, SKU_CODE_TAKEN, ADDON_OUT_OF_STOCK, ADDON_LIMIT, ADDON_NOT_OFFERED,
 * ADDON_ENGRAVING_TAKEN, ADDON_KIND_FIXED, ADDON_SERVICE).
 */
import { formatCount } from '../format.js';
import {
  ADDON_KINDS,
  ADDON_LINE_MAX,
  ADDON_TEXT_MAX,
  ADDON_NAME_MAX,
  ADDON_PRICE_MINOR_MAX,
  ADDON_UNITS_MAX,
  ADDON_WEIGHT_G_MAX,
  HOUSE_CURRENCIES,
  type AddonCreateInput,
  type AddonInput,
  type AddonKind,
  type AddonOfferedAt,
  type AddonPickable,
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
  type PickedAddon,
} from '../types.js';
import { parisDateTime } from './links.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import { pastedShopifyId } from './shopify.js';

/** An add-on SKU's code (services/addons.ts ADDON_SKU_CODE_RE): 2 to 64 capitals, digits and hyphens, a capital or a digit first. */
export const ADDON_SKU_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,63}$/;

/** The bounds of an add-on (migration 0056, mirrored in types.ts). */
export const ADDON_LIMITS = Object.freeze({ name: ADDON_NAME_MAX, line: ADDON_LINE_MAX, weightG: ADDON_WEIGHT_G_MAX, priceMinor: ADDON_PRICE_MINOR_MAX, units: ADDON_UNITS_MAX, skuCode: 64 });

/** The engraving's most characters (migration 0059, D12, N3): 1 to 20, 20 by default. */
export const ADDON_TEXT_LIMITS = Object.freeze({ min: ADDON_TEXT_MAX.min, max: ADDON_TEXT_MAX.max, default: ADDON_TEXT_MAX.max });

// ── Catalogue → Add-ons ────────────────────────────────────────────────────

export const ADDONS_TEXT = Object.freeze({
  title: 'Add-ons',
  lead: 'Items sold with a piece: a care kit, a polishing cloth, a chain extender, each WITH STOCK; or a SERVICE without stock, such as gift wrapping or the engraving. Each has its own SKU, no ORBES CODE, and never counts toward the tier. It is offered where its switches say: at the purchase in a LIVE RELEASE, in a release with a draw or in the private salon, and in YOUR ORDERS until packing begins; a release offers at its purchase only the add-ons it picks. It is offered in each currency it has a price in, and one with stock while one is in stock at the order’s location. Its stock moves in Logistics; the Shopify export lists each active add-on priced in the store’s currency.',
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
  kindHint: 'Fixed once added. WITH STOCK: counted in Logistics, ordered from its supplier. SERVICE: no stock, no supplier and no warehouse, such as gift wrapping or the engraving.',
  kindFixed: (kind: string) => `Its type, ${kind}, never changes: set it aside and add another to change it.`,
  offeredHint: 'On by default. A release offers at its purchase only the add-ons it picks, among those offered there.',
  ordersHint: 'Every order until packing begins, whatever its release.',
  engraving: 'The engraving',
  engravingHint: 'The collector types the words engraved on the piece. One engraving is offered at a time.',
  textMax: 'Most characters',
  textMaxHint: `The most characters the collector may type, ${ADDON_TEXT_MAX.max} at most.`,
  noStock: 'No stock',
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

/** An add-on's type as the console says it (D4): WITH STOCK (a product) or SERVICE (no stock). */
export const ADDON_KIND_LABELS: Readonly<Record<AddonKind, string>> = Object.freeze({ PRODUCT: 'WITH STOCK', SERVICE: 'SERVICE' });

/** The Type select of New add-on, WITH STOCK first. */
export const ADDON_KIND_OPTIONS = Object.freeze(ADDON_KINDS.map((k) => Object.freeze({ value: k, label: ADDON_KIND_LABELS[k] })));

/** The four moments an add-on is offered at (D3, K48 D2): its switch's label in the dialog and its mark in the row. */
export const ADDON_SWITCHES: readonly { key: keyof AddonOfferedAt; label: string; mark: string }[] = Object.freeze([
  { key: 'live', label: 'Offered at the purchase in a LIVE RELEASE', mark: 'LIVE' },
  { key: 'draw', label: 'Offered at the purchase in a release with a draw', mark: 'DRAW' },
  { key: 'salon', label: 'Offered at the purchase in the private salon', mark: 'SALON' },
  { key: 'orders', label: 'In YOUR ORDERS, until packing begins', mark: 'YOUR ORDERS' },
]);

/** Where it is offered, the switches on, one mark each (its row lists them one per line): LIVE, DRAW, SALON, YOUR ORDERS; or Nowhere. */
export function addonOfferedMarks(a: Pick<AddonView, 'offeredAt'>): string[] {
  const on = ADDON_SWITCHES.filter((x) => a.offeredAt[x.key]).map((x) => x.mark);
  return on.length ? on : ['Nowhere'];
}

/** Where it is offered on one line: `LIVE · DRAW · SALON · YOUR ORDERS`, or Nowhere. */
export function addonOfferedText(a: Pick<AddonView, 'offeredAt'>): string {
  return addonOfferedMarks(a).join(' · ');
}

/** The engraving's mark: `ENGRAVING · 12 characters at most`; null for any other add-on. */
export function addonEngravingText(a: Pick<AddonView, 'engraving' | 'textMax'>): string | null {
  return a.engraving ? `ENGRAVING · ${formatCount(a.textMax)} ${a.textMax === 1 ? 'character' : 'characters'} at most` : null;
}

/** How many releases not ended pick it: `2`, or None. */
export function addonReleasesText(a: Pick<AddonView, 'releases'>): string {
  return a.releases > 0 ? formatCount(a.releases) : 'None';
}

/**
 * What it was converted from (migration 0060): `Converted from the add-ons of SPRING, AUTUMN (24 OCT 2026)`, and
 * `Converted from Orders → Settings, Engraving`; none for an add-on staff created.
 */
export function addonConvertedLines(a: Pick<AddonView, 'convertedFrom'>): string[] {
  const releases = a.convertedFrom.filter((c) => c.source === 'LIVE_ADDON' && c.release !== null);
  const out: string[] = [];
  if (releases.length) out.push(`Converted from the add-ons of ${releases.map((c) => c.release!.title).join(', ')} (${parisDateTime(releases[0]!.convertedAt).split(' · ')[0]})`);
  if (a.convertedFrom.some((c) => c.source === 'ENGRAVING_PRICES')) out.push('Converted from Orders → Settings, Engraving');
  return out;
}

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

/** Its stock per location, each location listed (0 included): what is available, and its minimum when it has one; a service: No stock. */
export function addonStockLines(a: Pick<AddonView, 'stock'> & { kind?: AddonKind }): string[] {
  if (a.kind === 'SERVICE') return [ADDONS_TEXT.noStock];
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

/**
 * The add-on dialog's values: its fields, its prices, its type (`kind`, at the creation only), its four switches and the
 * engraving with its most characters (a checkbox's value is 'true' when ticked, '' otherwise).
 */
export type AddonForm = Record<
  'name' | 'line' | 'skuCode' | 'supplierId' | 'weightG' | 'EUR' | 'GBP' | 'USD' | 'CHF' | 'kind' | 'live' | 'draw' | 'salon' | 'orders' | 'engraving' | 'textMax',
  string
>;

const ticked = (v: string | undefined) => v === 'true';
const tick = (b: boolean) => (b ? 'true' : '');

/** The add-on dialog's values as it opens: the add-on's, or empty for a new one (WITH STOCK, offered everywhere, 20 characters). */
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
    kind: a?.kind ?? 'PRODUCT',
    live: tick(a?.offeredAt.live ?? true),
    draw: tick(a?.offeredAt.draw ?? true),
    salon: tick(a?.offeredAt.salon ?? true),
    orders: tick(a?.offeredAt.orders ?? true),
    engraving: tick(a?.engraving ?? false),
    textMax: String(a?.textMax ?? ADDON_TEXT_LIMITS.default),
  };
}

/** Whether the dialog's values make a service (its type chosen at the creation, the add-on's after). */
export function isServiceForm(v: Partial<AddonForm>): boolean {
  return v.kind === 'SERVICE';
}

/** Whether the dialog's values make the engraving: a service, The engraving ticked. */
export function isEngravingForm(v: Partial<AddonForm>): boolean {
  return isServiceForm(v) && ticked(v.engraving);
}

/** The engraving's most characters typed, 1 to 20; null otherwise. */
function textMaxOf(text: string | undefined): number | null {
  const s = (text ?? '').trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= ADDON_TEXT_LIMITS.min && n <= ADDON_TEXT_LIMITS.max ? n : null;
}

/** The four switches as ticked. */
function offeredOf(v: Partial<AddonForm>): AddonOfferedAt {
  return { live: ticked(v.live), draw: ticked(v.draw), salon: ticked(v.salon), orders: ticked(v.orders) };
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
  if (isEngravingForm(v) && textMaxOf(v.textMax) === null) return `The engraving takes ${ADDON_TEXT_LIMITS.min} to ${ADDON_TEXT_LIMITS.max} characters at most.`;
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

/**
 * What New add-on sends: its fields, its SKU code, its type, its four switches, its prices (the currencies given); a
 * service never a supplier, the engraving with its most characters.
 */
export function addonCreateInput(v: AddonForm): AddonCreateInput {
  const line = v.line.trim();
  const prices = Object.fromEntries(Object.entries(pricesOf(v)).filter(([, p]) => p !== null)) as Partial<Record<HouseCurrency, number>>;
  const service = isServiceForm(v);
  return {
    name: v.name.trim(),
    skuCode: skuCodeOf(v.skuCode),
    kind: service ? 'SERVICE' : 'PRODUCT',
    ...(line ? { line } : {}),
    ...(v.supplierId && !service ? { supplierId: v.supplierId } : {}),
    ...(v.weightG.trim() ? { weightG: grams(v.weightG)! } : {}),
    offeredAt: offeredOf(v),
    ...(isEngravingForm(v) ? { engraving: true, textMax: textMaxOf(v.textMax)! } : {}),
    ...(Object.keys(prices).length ? { prices } : {}),
  };
}

/**
 * What Edit sends: the fields that changed (PATCH: its switches that changed, the engraving and its most characters on a
 * service, never its type) and the prices that changed (PUT …/prices, null removes one).
 */
export function addonChange(a: AddonView, v: AddonForm): { fields: AddonInput; prices: Partial<Record<HouseCurrency, number | null>> } {
  const fields: AddonInput = {};
  const name = v.name.trim();
  if (name !== a.name) fields.name = name;
  const line = v.line.trim() || null;
  if (line !== a.line) fields.line = line;
  const service = a.kind === 'SERVICE';
  const supplierId = v.supplierId || null;
  if (!service && supplierId !== (a.supplier?.id ?? null)) fields.supplierId = supplierId;
  const weightG = v.weightG.trim() ? grams(v.weightG) : null;
  if (weightG !== a.weightG) fields.weightG = weightG;
  const offered = offeredOf(v);
  const switched = Object.fromEntries(ADDON_SWITCHES.filter((x) => offered[x.key] !== a.offeredAt[x.key]).map((x) => [x.key, offered[x.key]])) as Partial<AddonOfferedAt>;
  if (Object.keys(switched).length) fields.offeredAt = switched;
  if (service) {
    const engraving = ticked(v.engraving);
    if (engraving !== a.engraving) fields.engraving = engraving;
    const textMax = engraving ? textMaxOf(v.textMax) : null;
    if (textMax !== null && textMax !== a.textMax) fields.textMax = textMax;
  }
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

// ── A release's pick (lot Q2, step Q2.7, D3, N7) ───────────────────────────

/** The moments a release picks its add-ons for: a LIVE RELEASE (and its after-room), a draw. */
export type PickMoment = 'LIVE' | 'DRAW';

export const PICK_TEXT = Object.freeze({
  label: 'Add-ons offered',
  liveHint: 'Offered with a piece held, in this order. Each add-on’s switches and prices are set in Catalogue → Add-ons.',
  drawHint: 'Offered with a place held, in this order. Each add-on’s switches and prices are set in Catalogue → Add-ons.',
  empty: 'No add-on yet: list one in Catalogue → Add-ons.',
  none: 'None: PAY is the piece alone.',
  drawNone: 'None: the place held is the piece alone.',
  setAside: 'Set aside: offered nowhere',
  saved: 'Add-ons saved.',
  lead: 'Ticked: offered with the release’s purchase, until it is announced. Unticked: never offered there; YOUR ORDERS follows each add-on’s own switch.',
  drawLead: 'Ticked: offered with a place held, while the release is a draft. Unticked: never offered there; YOUR ORDERS follows each add-on’s own switch.',
});

/** Why a release cannot pick an add-on: `Not offered in a LIVE RELEASE` (its switch is off), `No price in GBP`. */
export function pickWhy(why: AddonPickable['why'], moment: PickMoment, currency: string | null): string {
  if (why === 'SWITCH_OFF') return moment === 'LIVE' ? 'Not offered in a LIVE RELEASE' : 'Not offered in a release with a draw';
  if (why === 'NO_PRICE') return `No price in ${currency ?? 'its currency'}`;
  return '';
}

/** Whether a release may pick it now: its switch on and, with a currency, priced in it (a draw without a price: any priced or not). */
function pickableNow(x: AddonPickable, currency: string | null): boolean {
  return x.pickable || (currency === null && x.why === 'NO_PRICE');
}

/**
 * The release's tick boxes: the add-ons it picks first, in its order (one it can no longer offer still listed, ticked,
 * with why, so it can be unticked), then the others in the catalogue's order, the ones it cannot pick disabled with why.
 * Each named with its price in the release's currency.
 */
export function pickOptions(pickable: readonly AddonPickable[], picked: readonly PickedAddon[] | null, moment: PickMoment, currency: string | null): { value: string; label: string; disabled?: boolean }[] {
  const priced = (x: { name: string; priceMinor: number | null }) => (currency !== null && x.priceMinor !== null ? `${x.name} · ${formatMoney(x.priceMinor, currency)}` : x.name);
  const why = (x: AddonPickable) => `${x.name} · ${pickWhy(x.why, moment, currency)}`;
  const mine = (picked ?? []).map((p) => {
    const x = pickable.find((y) => y.id === p.id);
    return { value: p.id, label: !x ? `${p.name} · ${PICK_TEXT.setAside}` : pickableNow(x, currency) ? priced(x) : why(x) };
  });
  const others = pickable
    .filter((x) => !(picked ?? []).some((p) => p.id === x.id))
    .map((x) => (pickableNow(x, currency) ? { value: x.id, label: priced(x) } : { value: x.id, label: why(x), disabled: true }));
  return [...mine, ...others];
}

/** The boxes ticked as the dialog opens: the release's pick, or for a new one every add-on it may offer (N7). */
export function pickTicked(pickable: readonly AddonPickable[], picked: readonly PickedAddon[] | null, currency: string | null): string {
  return (picked ? picked.map((p) => p.id) : pickable.filter((x) => pickableNow(x, currency)).map((x) => x.id)).join(',');
}

/** The pick to send: the boxes ticked, in their order; null when it is the release's pick unchanged. */
export function pickChange(picked: readonly PickedAddon[] | null, ticked: readonly string[]): string[] | null {
  if (picked && picked.length === ticked.length && picked.every((p, i) => p.id === ticked[i])) return null;
  return [...ticked];
}

/** What the server would refuse in a pick sent: a box ticked that the release can no longer offer, named with why. */
export function pickProblem(pickable: readonly AddonPickable[], picked: readonly PickedAddon[] | null, ticked: readonly string[], moment: PickMoment, currency: string | null): string | null {
  if (pickChange(picked, ticked) === null) return null;
  for (const id of ticked) {
    const x = pickable.find((y) => y.id === id);
    if (!x) return `Untick ${(picked ?? []).find((p) => p.id === id)?.name ?? 'the add-on set aside'}: it is set aside, offered nowhere.`;
    if (!pickableNow(x, currency)) {
      const w = pickWhy(x.why, moment, currency);
      return `Untick ${x.name}: ${w.charAt(0).toLowerCase()}${w.slice(1)}.`;
    }
  }
  return null;
}

/** A release's pick on one line: `GIFT WRAPPING € 15 · ENGRAVING € 40`, or None. */
export function pickLine(pick: readonly PickedAddon[] | undefined, currency: string | null): string {
  return pick?.length ? pick.map((x) => (x.priceMinor === null || currency === null ? x.name : `${x.name} ${formatMoney(x.priceMinor, currency)}`)).join(' · ') : 'None';
}

/** A release's pick as its Add-ons part lists it: each name, its price in the release's currency, its line or why it is offered nowhere. */
export function pickRows(pick: readonly PickedAddon[], currency: string | null): { label: string; value: string; note?: string }[] {
  return pick.map((a) => ({
    label: a.name,
    value: currency === null ? 'Its price in the order’s currency' : a.priceMinor === null ? `No price in ${currency}` : formatMoney(a.priceMinor, currency),
    ...(a.active ? (a.line ? { note: a.line } : {}) : { note: `${PICK_TEXT.setAside}.` }),
  }));
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
  groupLead: 'The add-ons’ stock at each location: counted without an ORBES CODE, held by the orders they are added to. A service, such as the engraving, has no stock: it is never listed here.',
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
  lead: 'The catalogue add-ons of this order: each unit of an add-on with stock held at the order’s location, a service’s held nowhere; packed and shipped with it. Credits apply to the piece’s price only.',
  empty: 'No add-on on this order.',
  add: 'Add an add-on',
  addText: 'Units of an add-on at its price now in the order’s currency: one with stock from the stock at the order’s location, held at once; a service with no stock. At most 3 of each add-on on an order, and one engraving.',
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
  service: 'Service',
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
  /** A service's units (lot Q2): held nowhere, no stock to go back to. */
  service: boolean;
  /** Its units, oldest first: Remove takes the newest held. */
  unitIds: string[];
}

export function addonGroups(units: readonly AdminOrderAddonUnit[]): AddonGroup[] {
  const groups = new Map<string, AddonGroup>();
  for (const u of units) {
    const key = [u.addon.id, u.priceMinor, u.currency, u.status, u.addedBy.type, u.addedBy.id ?? '', u.returnedToStock ?? '', u.invoiceId ?? '', u.location?.id ?? ''].join('|');
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
        location: u.location?.name ?? ORDER_ADDONS_TEXT.service,
        service: u.location === null,
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

/** Remove's words: one unit released to stock at its location; a service's, removed (it holds no stock). */
export function removeAddonText(g: Pick<AddonGroup, 'name' | 'location'> & { service?: boolean }): string {
  return g.service ? `One ${g.name} is removed: a service holds no stock.` : `One ${g.name} is released, back to the stock at ${g.location}.`;
}

/** Where a group of units is held, under its status: `At FRANCE WAREHOUSE`, or Service. */
export function heldLine(g: Pick<AddonGroup, 'location' | 'service'>): string {
  return g.service ? ORDER_ADDONS_TEXT.service : `At ${g.location}`;
}

/**
 * The order's engraving unit beside its words (lot Q2, step Q2.5 and Q2.7, D4, N5): `ENGRAVING add-on · € 150 · At the
 * purchase`, and `its words to be entered` when it has none yet; null on an order without one (or one of before Q2).
 */
export function engravingUnitLine(units: readonly AdminOrderAddonUnit[], hasWords: boolean, actors: Record<string, string>): string | null {
  const u = units.find((x) => x.addon.engraving && x.status !== 'REMOVED');
  if (!u) return null;
  return [`${u.addon.name} add-on`, formatMoney(u.priceMinor, u.currency), addedByText(u.addedBy, actors), ...(hasWords ? [] : ['its words to be entered'])].join(' · ');
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
