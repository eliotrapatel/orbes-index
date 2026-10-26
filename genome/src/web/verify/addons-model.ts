/**
 * The catalogue add-ons as the collector reads them (plan MACRO M3 §4.4, D2): POLISHING CLOTH, CHAIN EXTENDER… chosen
 * on the LIVE hold, on a draw's PLACE HELD and with a salon request, then added and removed in YOUR ORDERS until packing
 * begins. Pure (no DOM) and unit-tested, like the orders' view-model.
 *
 *   a row        its name (as the house writes it, wrapped, never cut), its line, its price per unit (`+ € 15`), its
 *                units from 0 to what may be taken now (at most 3 of each, while available): rows of what is offered,
 *                then of what was chosen and is no longer offered (its units may only go down);
 *   the total    what the units chosen add (`+ € 45`), in the currency of where they are chosen;
 *   an order     its add-ons among its terms (`POLISHING CLOTH × 2` · `+ € 30`), each REMOVE until packing begins, ADD
 *                AN ADD-ON while the server offers it, the line once packing has begun;
 *   left out     an add-on chosen that could not be added to the order (none left, no longer offered), by its name.
 *
 * Lot Q2, step Q2.9 (D3, N8, N9): the rows are what each moment's offer holds (a draw's PLACE HELD: its DRAW switch and
 * the draw's pick; the salon and YOUR ORDERS: their switch alone), a service listed like a product. The engraving is a
 * row of at most 1 there (its words typed in YOUR ORDERS, ENTER YOUR ENGRAVING), never in ADD AN ADD-ON (its own
 * ENGRAVING section); a row carries whether it is the engraving and, for it, its most characters (`textMax`).
 *
 * Prices are the server's, never computed here but for the sum of what is shown; an add-on the app cannot read is left
 * out, never guessed.
 */
import { ADDONS, ORDERS, VAULT } from './copy.js';
import { parisTime } from './vault-model.js';
import type { AccountAddonOffer, AccountOrder, AddonOfferItem, ChosenAddon, LeftOutAddon } from './types.js';
import { formatMoney, upper, type Row } from './view-model.js';

/** At most this many of one add-on on an order (services/order-addons.ts ADDON_LIMIT). */
export const ADDON_UNITS_MAX = 3;
/** The engraving: one on an order (services/order-addons.ts, lot Q2, step Q2.3). */
export const ENGRAVING_UNITS_MAX = 1;
/** The house's most characters of an engraving (ENGRAVING_COLLECTOR_MAX): the ceiling and the default of `textMax`. */
export const ENGRAVING_TEXT_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const units = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0);
const price = (n: unknown): number | null => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null);
const words = (t: unknown): string => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ') : '');
/** The engraving's most characters as offered (1 to 20); the house's 20 when the offer does not say. */
const textMaxOf = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= ENGRAVING_TEXT_MAX ? n : ENGRAVING_TEXT_MAX);

/** An add-on's price per unit as it adds to an order: `+ € 15`. */
export function addonPrice(minor: number, currency: string): string {
  return ADDONS.price(formatMoney(minor, currency));
}

/** One row of add-ons to choose: what it is, its price, the units chosen and the most that may be. */
export interface AddonRowModel {
  addonId: string;
  /** `POLISHING CLOTH`, in capitals. */
  name: string;
  line: string | null;
  /** Per unit, in minor units; null when it is no longer priced (left out at the order). */
  priceMinor: number | null;
  /** `+ € 15`; '' without a price. */
  price: string;
  /** The units chosen now (0: none). */
  units: number;
  /** The most units that may be chosen now (never under `units`); the engraving's at most 1. */
  max: number;
  /** The engraving (lot Q2): its words are typed where the order is (YOUR ORDERS, or 5b at a LIVE hold). */
  engraving: boolean;
  /** The engraving's most characters (its add-on's, 1 to 20); null on any other row. */
  textMax: number | null;
}

/**
 * The rows to choose from: each add-on offered (with the units chosen of it), then each chosen and no longer offered
 * (its units kept, to be taken down). `chosen`: the units by add-on as they stand (the server's choice, or the
 * collector's taps not sent yet).
 */
export function addonRows(offer: readonly AddonOfferItem[] | null | undefined, chosen: ReadonlyMap<string, number> = new Map(), kept: readonly ChosenAddon[] = [], currency?: string): AddonRowModel[] {
  const rows: AddonRowModel[] = [];
  const seen = new Set<string>();
  for (const o of Array.isArray(offer) ? offer : []) {
    if (!o || typeof o.addonId !== 'string' || !UUID.test(o.addonId) || seen.has(o.addonId)) continue;
    const name = upper(o.name);
    const p = price(o.priceMinor);
    if (!name || p === null || typeof o.currency !== 'string') continue;
    const engraving = o.engraving === true;
    const n = units(chosen.get(o.addonId));
    const max = Math.min(engraving ? ENGRAVING_UNITS_MAX : ADDON_UNITS_MAX, Math.max(units(o.maxUnits), n));
    if (max <= 0) continue;
    seen.add(o.addonId);
    rows.push({ addonId: o.addonId, name, line: words(o.line) || null, priceMinor: p, price: addonPrice(p, o.currency), units: Math.min(n, max), max, engraving, textMax: engraving ? textMaxOf(o.textMax) : null });
  }
  for (const c of kept) {
    if (!c || typeof c.addonId !== 'string' || seen.has(c.addonId)) continue;
    const n = units(chosen.has(c.addonId) ? chosen.get(c.addonId) : c.units);
    const name = upper(c.name);
    if (!name || n <= 0) continue;
    seen.add(c.addonId);
    const p = price(c.priceMinor);
    rows.push({ addonId: c.addonId, name, line: words(c.line) || null, priceMinor: p, price: p !== null && currency ? addonPrice(p, currency) : '', units: n, max: n, engraving: false, textMax: null });
  }
  return rows;
}

/** The units by add-on of a choice as the server holds it (each once, its units). */
export function chosenUnits(list: readonly ChosenAddon[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of Array.isArray(list) ? list : []) if (c && typeof c.addonId === 'string' && units(c.units) > 0) out.set(c.addonId, units(c.units));
  return out;
}

/** What `rows` add at their units, in minor units (rows without a price add nothing). */
export function rowsTotal(rows: readonly AddonRowModel[]): number {
  return rows.reduce((n, r) => n + r.units * (r.priceMinor ?? 0), 0);
}

/** The choice to send: each row with units, in the rows' order. */
export function rowsChoice(rows: readonly AddonRowModel[]): { addonId: string; units: number }[] {
  return rows.filter((r) => r.units > 0).map((r) => ({ addonId: r.addonId, units: r.units }));
}

/** `rows` with `addonId` set to `n` units (kept between 0 and its most). */
export function withUnits(rows: readonly AddonRowModel[], addonId: string, n: number): AddonRowModel[] {
  return rows.map((r) => (r.addonId === addonId ? { ...r, units: Math.max(0, Math.min(r.max, Math.round(n))) } : r));
}

/**
 * The note under the rows while one of them stands at what may be taken; null otherwise. The engraving at its one is
 * not such a row: the note's "at most 3 of each" is not its rule (one on an order).
 */
export function rowsLimit(rows: readonly AddonRowModel[]): string | null {
  return rows.some((r) => !r.engraving && r.units > 0 && r.units >= r.max) ? ADDONS.limit : null;
}

/**
 * Add-ons chosen or carried as a receipt's rows: `POLISHING CLOTH × 2` · `+ € 30` (their price for all their units); one
 * no longer priced reads its name alone (its value ''). `money` writes the price: `+ € 30` by default, `€ 30` on a
 * plate whose other add-ons read without the sign (the room's CONFIRMED).
 */
export function chosenRows(list: readonly ChosenAddon[] | null | undefined, currency: string | null, money: (minor: number, currency: string) => string = addonPrice): Row[] {
  const out: Row[] = [];
  for (const c of Array.isArray(list) ? list : []) {
    const n = units(c?.units);
    const name = upper(c?.name);
    if (!name || n <= 0) continue;
    const p = price(c.priceMinor);
    out.push([ADDONS.units(name, n), p !== null && currency ? money(p * n, currency) : '']);
  }
  return out;
}

/** What add-ons chosen add, in minor units. */
export function chosenTotal(list: readonly ChosenAddon[] | null | undefined): number {
  return (Array.isArray(list) ? list : []).reduce((n, c) => n + units(c?.units) * (price(c?.priceMinor) ?? 0), 0);
}

/** The lines of what could not be added: `THE POLISHING CLOTH COULD NOT BE ADDED: NONE LEFT.` */
export function leftOutLines(list: readonly LeftOutAddon[] | null | undefined): string[] {
  return (Array.isArray(list) ? list : [])
    .filter((l) => l && words(l.name) !== '' && (l.reason === 'NONE_LEFT' || l.reason === 'NOT_OFFERED'))
    .map((l) => ADDONS.leftOut(upper(l.name), l.reason));
}

// ── An order's add-ons (YOUR ORDERS) ───────────────────────────────────────

/** An order's catalogue add-ons as rows of its terms: `POLISHING CLOTH × 2` · `+ € 30`. */
export function orderAddonRows(o: Pick<AccountOrder, 'addonItems'>): Row[] {
  const out: Row[] = [];
  for (const a of Array.isArray(o.addonItems) ? o.addonItems : []) {
    const n = units(a?.units);
    const name = upper(a?.name);
    const p = price(a?.priceMinor);
    if (!name || n <= 0 || p === null || typeof a.currency !== 'string') continue;
    // A free add-on from THE VAULT (lot Q3 §3.8, N11): its unit at 0 reads FREE.
    out.push([ADDONS.units(name, n), p === 0 ? VAULT.orders.free : addonPrice(p * n, a.currency)]);
  }
  return out;
}

/** What an order's catalogue add-ons add to its TOTAL, in minor units. */
export function orderAddonsMinor(o: Pick<AccountOrder, 'addonItems'>): number {
  return (Array.isArray(o.addonItems) ? o.addonItems : []).reduce((n, a) => n + units(a?.units) * (price(a?.priceMinor) ?? 0), 0);
}

/** An order's ADD-ONS under its rows: REMOVE each until packing begins, ADD AN ADD-ON while offered, or the line once packing has begun. */
export interface OrderAddonsModel {
  /** The add-ons removable now, each by its words (`POLISHING CLOTH × 2`). */
  removable: { addonId: string; words: string; label: string }[];
  /** ADD AN ADD-ON is offered. */
  canAdd: boolean;
  /** Said once REMOVE is pressed on a paid order: the credit note; null otherwise. */
  removeNote: string | null;
  /** 'Packing has begun. Add-ons can no longer be added.' in place of the actions; null otherwise. */
  locked: string | null;
}

/**
 * Whether packing has begun on an order still held (RESERVED or PAID): its address or its engraving no longer changes
 * though the server would let it (its own address, an engraving offered), as the address's and the engraving's lines
 * read it.
 */
function packingBegun(o: AccountOrder): boolean {
  if (o.status !== 'RESERVED' && o.status !== 'PAID') return false;
  const byAddress = (o.addressOf ?? null) === null && o.editable?.address === false;
  const byEngraving = !!o.engravingOffer && o.editable?.engraving === false;
  return byAddress || byEngraving;
}

/** An order's ADD-ONS: null when there is nothing to do nor to say (no add-on and none to add, or an order ended). */
export function orderAddons(o: AccountOrder): OrderAddonsModel | null {
  const reference = typeof o.reference === 'string' ? o.reference : '';
  const items = Array.isArray(o.addonItems) ? o.addonItems : [];
  // One REMOVE per add-on: its rows at two prices (added before and after a price change) are one add-on, and REMOVE
  // takes every unit of it still held.
  const byAddon = new Map<string, { name: string; units: number }>();
  for (const a of items) {
    if (!a || a.canRemove !== true || typeof a.addonId !== 'string' || !UUID.test(a.addonId) || upper(a.name) === '' || units(a.units) <= 0) continue;
    const seen = byAddon.get(a.addonId);
    if (seen) seen.units += units(a.units);
    else byAddon.set(a.addonId, { name: upper(a.name), units: units(a.units) });
  }
  const removable = [...byAddon].map(([addonId, a]) => {
    const w = ADDONS.units(a.name, a.units);
    return { addonId, words: w, label: ORDERS.addons.removeLabel(w, reference) };
  });
  const canAdd = o.canAddAddons === true;
  if (removable.length > 0 || canAdd) return { removable, canAdd, removeNote: o.status === 'PAID' ? ORDERS.addons.paidRemove : null, locked: null };
  // Packing begun on an order that carries add-ons: they stay, and none is added now.
  if (items.length > 0 && packingBegun(o)) return { removable: [], canAdd: false, removeNote: null, locked: ORDERS.addons.locked };
  return null;
}

/** ADD AN ADD-ON's sheet once its offer is read: the rows, or why none can be added now. */
export interface AddonSheetModel {
  rows: AddonRowModel[];
  /** `null` while rows may be chosen; else the sentence in their place (none available, packing begun). */
  empty: string | null;
  /** Said before ADD on a paid order: its own invoice; null otherwise. */
  paidNote: string | null;
  currency: string | null;
}

export function addonSheet(offer: AccountAddonOffer, chosen: ReadonlyMap<string, number> = new Map()): AddonSheetModel {
  const currency = typeof offer.currency === 'string' ? offer.currency : null;
  if (!offer.canAdd) return { rows: [], empty: offer.reason === 'PACKING_STARTED' ? ORDERS.addons.locked : ORDERS.addons.none, paidNote: null, currency };
  // The engraving is never added here: it has its own ENGRAVING section on the order (lot Q2, N9), as the server offers it.
  const rows = addonRows(offer.offer, chosen)
    .filter((r) => !r.engraving)
    // An add-on a vault's right to buy offers (lot Q3 §3.8, N11): its line says until when, in Paris.
    .map((r) => {
      const until = (Array.isArray(offer.offer) ? offer.offer : []).find((o) => o?.addonId === r.addonId)?.vaultUntil;
      const time = typeof until === 'string' ? parisTime(until) : '';
      return time ? { ...r, line: VAULT.orders.addonUntil(time) } : r;
    });
  return { rows, empty: rows.length === 0 ? ORDERS.addons.none : null, paidNote: offer.paid === true && rows.length > 0 ? ORDERS.addons.paidAdd : null, currency };
}
