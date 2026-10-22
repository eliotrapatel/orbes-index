/**
 * Add-ons on orders (macro scope of 2026-10-20, K48 D1 and D2; lot M3 plan §4.1 and §4.2, step M3.10; migration 0056):
 * a catalogue add-on (services/addons.ts: a care kit, a polishing cloth…) sold with a piece, unit by unit, each unit
 * holding one of its SKU in stock at its order's location from the moment it is added. No ORBES CODE, no identity, no
 * ownership, never a product row, never counted toward the tier (S7): the tier reads pieces held, never a unit.
 *
 *   chosen       before the order exists (`addon_choices`, 1 to 3 units of each, once per add-on): on a LIVE entry's
 *                hold (SECURED, PUT /api/v1/live/:id/addons `items`), on a draw's PLACE HELD (a SELECTED entry of a
 *                priced draw, PUT /api/v1/club/drops/:id/addons) and in a salon request (its body's `addons`, the
 *                model's base price's currency). Each checked against what is offered there now (`setChoices`): active,
 *                priced in the currency (409 ADDON_NOT_OFFERED), that many available at the location (409
 *                ADDON_OUT_OF_STOCK), at most 3 (409 ADDON_LIMIT).
 *   carried      onto the sale's first order where it is created (`carryChoices`: PAY's `ordersForLiveEntry`, a draw's
 *                CONFIRMED `orderForDrawEntry`, a salon's ACCEPTED `orderForShopRequest`), each unit taken under its
 *                SKU's lock (stock.ts lockSku) or left out with its reason (NONE_LEFT, NOT_OFFERED), never blocking
 *                the sale; the choices then deleted. A salon order has no price yet: its units take the model's base
 *                currency, and Client Services enters the piece's price in that currency (409 ORDER_ADDON_CURRENCY).
 *   YOUR ORDERS  the collector adds and removes add-ons on an order of their own (`OrderAddonService.addForAccount`,
 *                `removeForAccount`; GET lists what can be added now): RESERVED or PAID (409 ORDER_CLOSED), before its
 *                packing starts (409 ORDER_PACKING_STARTED), never on a welcome gift, a size exchange nor an order
 *                paid on the Shopify store (409 ADDON_NOT_OFFERED: the platform takes no second payment it cannot
 *                take, S2), the order's currency entered; the account ACTIVE (403 ACCOUNT_LOCKED).
 *   staff        Client Services adds and removes units until SHIPPED (`addForStaff`, `removeForStaff`, OPERATOR).
 *   price        the add-on's price in the unit's currency when it is added, kept (`price_minor`, `currency`).
 *   documents    (services/invoices.ts) each unit is an ADD_ON_ITEM line (its name and price): on the invoice issued at
 *                PAID; added after PAID, a supplementary invoice of its lines (`invoice_id`); removed after PAID, a
 *                credit note for its line; credited with the rest (FULL) when the order is cancelled or returned.
 *   the life     cancelled with its order (`cancelUnits`: the stock it held free again); shipped with it (`shipUnits`:
 *                the ledger's SHIPPED −1 per unit); returned with it (`returnUnits`: back to stock at the return's
 *                location, the ledger's RETURNED +1, unless ORBES marks a unit not to be sold again,
 *                `returned_to_stock` false); a size exchange leaves them with the collector (still SHIPPED, billed
 *                again on the EXCHANGE order's invoice as its original's return credits them); the order's location
 *                changed, its units move with it or the change is refused (`moveUnits`, 409
 *                ORDER_ADDON_NOT_AT_LOCATION).
 *   packing      one checklist line per add-on of each order (`addon-item:<orderId>:<addonId>`, « Add-on: POLISHING
 *                CLOTH × 2 »), ticked by hand (no scan: no identity); the parcel's weight adds each unit's weight.
 *   history      each addition and removal is one event of the order, one journal entry (`order.addon.add`,
 *                `order.addon.remove`: the order as it stands with the add-on, its units and price, for the future
 *                Shopify sync) and one audit entry; the units' stock movements journal themselves (`stock.move`).
 *
 * Lock order (orders.ts): the source's rows, the order, the units' SKUs in id order (lockSku), the invoice numbers, the
 * journal, the audit log last.
 */
import { sql } from 'kysely';
import { inRetriedTransaction, type Db } from '../db/connection.js';
import { ADDON_UNITS_MAX, HOUSE_CURRENCIES, jsonText, type HouseCurrency, type JsonObject, type OrderAddonAddedBy, type OrderAddonStatus, type OrderRow } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { addonNotFound } from './addons.js';
import { customerAccountLocked } from './auth.js';
import { issueAddonCreditNotes, issueSupplementaryInvoice, type InvoiceLine } from './invoices.js';
import { writeJournal } from './journal.js';
import { orderPayload, ORDER_HOLDING_STATUSES } from './orders.js';
import { lockSku, recordMovement, stockLevel } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The units of one add-on on one order, or chosen on one entry or request, at most (ADDON_UNITS_MAX, 3). */
export const ADDON_LIMIT = ADDON_UNITS_MAX;
/** The add-ons one choice names, at most (each once). */
export const ADDON_CHOICES_MAX = 20;
/** The invoice line kind of a unit (services/invoices.ts INVOICE_LINE_KINDS). */
export const ADD_ON_ITEM = 'ADD_ON_ITEM' as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Errors ─────────────────────────────────────────────────────────────────

export const addonOutOfStock = (name: string) => conflict('ADDON_OUT_OF_STOCK', `${name} could not be added: none left.`);
export const addonNotOffered = (why?: string) => conflict('ADDON_NOT_OFFERED', why ?? 'This add-on is not offered here.');
export const addonLimit = () => conflict('ADDON_LIMIT', `At most ${ADDON_LIMIT} of each add-on on an order.`);
const addonNotAtLocation = (name: string) =>
  conflict('ORDER_ADDON_NOT_AT_LOCATION', `${name} is not in stock at the new location: move its stock there first, or remove the add-on.`);
const orderNotFound = () => notFound('Order', 'ORDER_NOT_FOUND');
const orderClosed = () => conflict('ORDER_CLOSED', 'This order can no longer change.');
const packingStarted = () => conflict('ORDER_PACKING_STARTED', 'Packing has begun: write to ORBES Client Services to change this order.');
const unitNotFound = () => notFound('Add-on', 'ADDON_NOT_FOUND');

// ── Views ──────────────────────────────────────────────────────────────────

/** One add-on chosen before the order exists (a LIVE hold, a draw's place held, a salon request), priced now. */
export interface ChosenAddon {
  addonId: string;
  name: string;
  line: string | null;
  units: number;
  /** Per unit, in the currency of where it was chosen; null when it is no longer priced in it. */
  priceMinor: number | null;
}

/** One add-on offered now (at a location, in a currency): what can still be chosen or added. */
export interface AddonOfferItem {
  addonId: string;
  name: string;
  line: string | null;
  priceMinor: number;
  currency: HouseCurrency;
  /** The units that can be chosen or added now: what is available there, within ADDON_LIMIT (less what the order holds). */
  maxUnits: number;
}

/** A choice carried onto an order that could not be added: no unit left (NONE_LEFT), or no longer offered (NOT_OFFERED). */
export interface LeftOutAddon {
  addonId: string;
  name: string;
  units: number;
  reason: 'NONE_LEFT' | 'NOT_OFFERED';
}

/** An order's add-ons as its collector reads them (YOUR ORDERS): one row per add-on and price, never a unit's internals. */
export interface AccountOrderAddonItem {
  addonId: string;
  name: string;
  units: number;
  /** Per unit, as it was added. */
  priceMinor: number;
  currency: HouseCurrency;
  /** Removable from YOUR ORDERS now (held, before packing). */
  canRemove: boolean;
}

/** A unit as the console's order page reads it. */
export interface AdminOrderAddonUnit {
  id: string;
  addon: { id: string; name: string };
  skuCode: string;
  priceMinor: number;
  currency: HouseCurrency;
  status: OrderAddonStatus;
  addedAt: Date;
  /** PURCHASE (carried from the collector's choice), COLLECTOR (YOUR ORDERS) or STAFF; `by` the account or the admin. */
  addedBy: { type: OrderAddonAddedBy; id: string | null };
  /** When it left HELD (removed, cancelled, shipped), and when it came back (returned). */
  removedAt: Date | null;
  cancelledAt: Date | null;
  shippedAt: Date | null;
  returnedAt: Date | null;
  returnedToStock: boolean | null;
  location: { id: string; name: string };
  /** Its supplementary invoice (added after PAID), by number; null otherwise. */
  invoiceId: string | null;
}

/** GET /api/v1/account/orders/:id/addons: what can be added to the order now. */
export interface AccountAddonOffer {
  /** Whether add-ons can be added now; `reason` says why not. */
  canAdd: boolean;
  reason: AddonWindowReason | null;
  /** The order is paid: an add-on added has its own invoice. */
  paid: boolean;
  currency: HouseCurrency | null;
  offer: AddonOfferItem[];
}

/** Why an order takes no add-on now. */
export type AddonWindowReason = 'NOT_OFFERED' | 'CLOSED' | 'PACKING_STARTED' | 'NO_CURRENCY';

/** Who adds or removes: the purchase (carried, no one named), the collector, or staff (an admin, or a script). */
export interface AddonBy {
  type: OrderAddonAddedBy;
  /** The account (COLLECTOR) or the admin (STAFF); null for PURCHASE and a script. */
  id: string | null;
  actor: Actor;
}

/** The owner of a choice: one LIVE entry, one draw entry or one salon request. */
export type AddonChoiceOwner = { liveEntryId: string } | { dropEntryId: string } | { shopRequestId: string };

/** One add-on chosen or added: its id and units. */
export interface AddonUnitsInput {
  addonId: string;
  units: number;
}

type OwnerColumn = 'live_entry_id' | 'drop_entry_id' | 'shop_request_id';
const ownerOf = (o: AddonChoiceOwner): [OwnerColumn, string] =>
  'liveEntryId' in o ? ['live_entry_id', o.liveEntryId] : 'dropEntryId' in o ? ['drop_entry_id', o.dropEntryId] : ['shop_request_id', o.shopRequestId];

const isHouseCurrency = (c: string | null | undefined): c is HouseCurrency => typeof c === 'string' && (HOUSE_CURRENCIES as readonly string[]).includes(c);
const later = (now: Date, since: Date): Date => (now.getTime() < since.getTime() ? since : now);

// ── Checking ───────────────────────────────────────────────────────────────

/** An add-on's units, checked: 1 to ADDON_LIMIT (409 ADDON_LIMIT above), a whole number. */
export function cleanUnits(units: unknown): number {
  if (typeof units !== 'number' || !Number.isInteger(units) || units < 1) throw validationError('Choose 1 to 3 of an add-on.');
  if (units > ADDON_LIMIT) throw addonLimit();
  return units;
}

/** A list of add-ons and their units, checked: each add-on once, at most ADDON_CHOICES_MAX. */
export function cleanAddonItems(items: unknown): AddonUnitsInput[] {
  if (!Array.isArray(items)) throw validationError('Send the add-ons as a list.');
  if (items.length > ADDON_CHOICES_MAX) throw validationError(`At most ${ADDON_CHOICES_MAX} add-ons.`);
  const seen = new Set<string>();
  return items.map((i) => {
    const x = (i ?? {}) as { addonId?: unknown; units?: unknown };
    if (typeof x.addonId !== 'string' || !UUID_RE.test(x.addonId)) throw addonNotFound();
    const addonId = x.addonId.toLowerCase();
    if (seen.has(addonId)) throw validationError('Each add-on is chosen once, with its units.');
    seen.add(addonId);
    return { addonId, units: cleanUnits(x.units) };
  });
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Add-ons as one location offers them in a currency now: active, priced, available there (read in `db`). */
interface AddonStanding {
  addonId: string;
  skuId: string;
  name: string;
  line: string | null;
  active: boolean;
  weightG: number | null;
  priceMinor: number | null;
  available: number;
}

/** The standing of each add-on named (unknown ones absent): its SKU, its price in `currency`, what is available at `locationId`. */
async function standings(db: Db, addonIds: readonly string[], locationId: string, currency: HouseCurrency | null): Promise<Map<string, AddonStanding>> {
  if (addonIds.length === 0) return new Map();
  const rows = await sql<{ addon_id: string; sku_id: string; name: string; line: string | null; active: boolean; weight_g: number | null; price_minor: number | null; available: number }>`
    SELECT a.id AS addon_id, k.id AS sku_id, a.name, a.line, a.active, a.weight_g, p.price_minor,
           (coalesce((SELECT sum(m.delta) FROM stock_movements m WHERE m.sku_id = k.id AND m.location_id = ${locationId}::uuid), 0)
            - (SELECT count(*) FROM stock_holds h WHERE h.sku_id = k.id AND h.location_id = ${locationId}::uuid AND h.reservation = 'STOCK'))::int AS available
      FROM addon_items a
      JOIN skus k ON k.addon_id = a.id
      LEFT JOIN addon_item_prices p ON p.addon_id = a.id AND p.currency = ${currency ?? ''}
     WHERE a.id IN (${sql.join([...new Set(addonIds)].map((id) => sql`${id}::uuid`))})`.execute(db);
  return new Map(
    rows.rows.map((r) => [
      r.addon_id,
      {
        addonId: r.addon_id,
        skuId: r.sku_id,
        name: r.name,
        line: r.line,
        active: r.active,
        weightG: r.weight_g,
        priceMinor: r.price_minor === null ? null : Number(r.price_minor),
        available: Number(r.available),
      },
    ]),
  );
}

/**
 * What is offered at `locationId` in `currency` now (services/addons.ts availableAddons' rule: active, priced, at least
 * one available), each with the units that can still be taken: what is available, within ADDON_LIMIT less `held` (the
 * units of that add-on the order holds already). An add-on whose limit is reached is left out.
 */
export async function addonOffer(db: Db, locationId: string, currency: HouseCurrency | null, held: ReadonlyMap<string, number> = new Map()): Promise<AddonOfferItem[]> {
  if (currency === null) return [];
  const rows = await sql<{ addon_id: string; name: string; line: string | null; price_minor: number; available: number }>`
    SELECT a.id AS addon_id, a.name, a.line, p.price_minor,
           (coalesce((SELECT sum(m.delta) FROM stock_movements m WHERE m.sku_id = k.id AND m.location_id = ${locationId}::uuid), 0)
            - (SELECT count(*) FROM stock_holds h WHERE h.sku_id = k.id AND h.location_id = ${locationId}::uuid AND h.reservation = 'STOCK'))::int AS available
      FROM addon_items a
      JOIN skus k ON k.addon_id = a.id
      JOIN addon_item_prices p ON p.addon_id = a.id AND p.currency = ${currency}
     WHERE a.active
     ORDER BY a.position, lower(a.name), a.id`.execute(db);
  return rows.rows
    .map((r) => ({
      addonId: r.addon_id,
      name: r.name,
      line: r.line,
      priceMinor: Number(r.price_minor),
      currency,
      maxUnits: Math.max(0, Math.min(Number(r.available), ADDON_LIMIT - (held.get(r.addon_id) ?? 0))),
    }))
    .filter((r) => r.maxUnits >= 1);
}

/** The choices of each owner (by its id), each add-on with its price in `currency` now, in the order they are offered. */
export async function choicesOf(db: Db, column: OwnerColumn, ownerIds: readonly string[], currencyOf: (ownerId: string) => HouseCurrency | null): Promise<Map<string, ChosenAddon[]>> {
  const out = new Map<string, ChosenAddon[]>();
  if (ownerIds.length === 0) return out;
  const rows = await db
    .selectFrom('addon_choices as c')
    .innerJoin('addon_items as a', 'a.id', 'c.addon_id')
    .select([`c.${column} as owner_id`, 'c.addon_id', 'c.units', 'a.name', 'a.line', 'a.position'])
    .where(`c.${column}`, 'in', [...new Set(ownerIds)])
    .orderBy('a.position')
    .orderBy(sql`lower(a.name)`)
    .execute();
  if (rows.length === 0) return out;
  const prices = await db.selectFrom('addon_item_prices').select(['addon_id', 'currency', 'price_minor']).where('addon_id', 'in', [...new Set(rows.map((r) => r.addon_id))]).execute();
  for (const r of rows) {
    const owner = r.owner_id as string;
    const currency = currencyOf(owner);
    const price = currency === null ? undefined : prices.find((p) => p.addon_id === r.addon_id && p.currency === currency);
    const list = out.get(owner) ?? [];
    list.push({ addonId: r.addon_id, name: r.name, line: r.line, units: r.units, priceMinor: price ? Number(price.price_minor) : null });
    out.set(owner, list);
  }
  return out;
}

/**
 * The choices of an owner replaced (in the caller's transaction, the owner's row held): each checked against what is
 * offered at `locationId` in `currency` now (404 ADDON_NOT_FOUND, 409 ADDON_NOT_OFFERED without a currency or a price
 * in it or once set aside, 409 ADDON_OUT_OF_STOCK when fewer are available there, 409 ADDON_LIMIT above 3). Nothing is
 * held: the stock is taken when the order is created (`carryChoices`). An empty list clears them. Returns what was
 * chosen, for the caller's audit entry.
 */
export async function setChoices(tx: Db, owner: AddonChoiceOwner, items: readonly AddonUnitsInput[], at: { locationId: string; currency: HouseCurrency | null }, now: Date): Promise<JsonObject[]> {
  const [column, ownerId] = ownerOf(owner);
  if (items.length > 0) {
    if (at.currency === null) throw addonNotOffered('Add-ons are offered once the price is known.');
    const found = await standings(tx, items.map((i) => i.addonId), at.locationId, at.currency);
    for (const i of items) {
      const s = found.get(i.addonId);
      if (!s) throw addonNotFound();
      if (!s.active || s.priceMinor === null) throw addonNotOffered(`${s.name} is not offered here.`);
      if (s.available < i.units) throw addonOutOfStock(s.name);
    }
  }
  await tx.deleteFrom('addon_choices').where(column, '=', ownerId).execute();
  if (items.length > 0) {
    await tx
      .insertInto('addon_choices')
      .values(items.map((i) => ({ [column]: ownerId, addon_id: i.addonId, units: i.units, chosen_at: now }) as { addon_id: string; units: number; chosen_at: Date }))
      .execute();
  }
  return items.map((i) => ({ addonId: i.addonId, units: i.units }));
}

/** The choices of owners deleted (an entry released, expired, removed or lapsed; carried onto its order). */
export async function clearChoices(tx: Db, column: OwnerColumn, ownerIds: readonly string[]): Promise<void> {
  if (ownerIds.length === 0) return;
  await tx.deleteFrom('addon_choices').where(column, 'in', [...new Set(ownerIds)]).execute();
}

/** The units of orders, oldest first (`statuses` narrows them). */
async function unitsOf(db: Db, orderIds: readonly string[], statuses?: readonly OrderAddonStatus[]) {
  if (orderIds.length === 0) return [];
  return db
    .selectFrom('order_addon_items as u')
    .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
    .selectAll('u')
    .select(['a.name', 'a.weight_g'])
    .where('u.order_id', 'in', [...new Set(orderIds)])
    .$if(statuses !== undefined, (q) => q.where('u.status', 'in', [...statuses!]))
    .orderBy('u.added_at')
    .orderBy('u.id')
    .execute();
}
type UnitRow = Awaited<ReturnType<typeof unitsOf>>[number];

/** The units HELD of each SKU of `units`, by SKU, its add-on's name. */
function bySku(units: readonly UnitRow[]): Map<string, { name: string; units: UnitRow[] }> {
  const out = new Map<string, { name: string; units: UnitRow[] }>();
  for (const u of units) {
    const g = out.get(u.sku_id) ?? { name: u.name, units: [] };
    g.units.push(u);
    out.set(u.sku_id, g);
  }
  return out;
}

/** The units HELD of each add-on on an order, by add-on id. */
async function heldByAddon(db: Db, orderId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const u of await unitsOf(db, [orderId], ['HELD'])) out.set(u.addon_id, (out.get(u.addon_id) ?? 0) + 1);
  return out;
}

/**
 * An order's add-ons for YOUR ORDERS: one row per add-on and price, its units not removed (a cancelled order's units
 * listed as they were ordered), in the order they were added; removable while the order takes add-ons and a unit is held.
 */
export async function accountAddonItems(db: Db, orders: readonly Pick<OrderRow, 'id' | 'channel' | 'status' | 'packing_started_at' | 'shopify_order_id' | 'currency'>[]): Promise<Map<string, AccountOrderAddonItem[]>> {
  const out = new Map<string, AccountOrderAddonItem[]>();
  const units = (await unitsOf(db, orders.map((o) => o.id))).filter((u) => u.status !== 'REMOVED');
  for (const o of orders) {
    const editable = removalWindow(o) === null;
    const items: AccountOrderAddonItem[] = [];
    for (const u of units.filter((x) => x.order_id === o.id)) {
      const row = items.find((i) => i.addonId === u.addon_id && i.priceMinor === u.price_minor && i.currency === u.currency);
      if (row) {
        row.units += 1;
        row.canRemove ||= editable && u.status === 'HELD';
      } else items.push({ addonId: u.addon_id, name: u.name, units: 1, priceMinor: u.price_minor, currency: u.currency, canRemove: editable && u.status === 'HELD' });
    }
    out.set(o.id, items);
  }
  return out;
}

/**
 * The orders of `orders` on which YOUR ORDERS offers ADD AN ADD-ON now (plan MACRO M3 §4.1, §4.4, D2): the order takes
 * add-ons (`addonWindow`) and at least one add-on is offered at its location in its currency with a unit it may still
 * take (`addonOffer` less the units of it the order holds), as `OrderAddonService.offerForAccount` would list it. The
 * offer is read once per location and currency. Stock that runs out between this read and the sheet's leaves the
 * sheet's « none available ».
 */
export async function accountAddonOpen(db: Db, orders: readonly Pick<OrderRow, 'id' | 'channel' | 'status' | 'packing_started_at' | 'shopify_order_id' | 'currency' | 'location_id'>[]): Promise<Set<string>> {
  const out = new Set<string>();
  const open = orders.filter((o) => addonWindow(o) === null);
  if (open.length === 0) return out;
  const held = new Map<string, Map<string, number>>();
  for (const u of await unitsOf(db, open.map((o) => o.id), ['HELD'])) {
    const byAddon = held.get(u.order_id) ?? new Map<string, number>();
    byAddon.set(u.addon_id, (byAddon.get(u.addon_id) ?? 0) + 1);
    held.set(u.order_id, byAddon);
  }
  const offers = new Map<string, AddonOfferItem[]>();
  for (const o of open) {
    if (!isHouseCurrency(o.currency)) continue;
    const key = `${o.location_id} ${o.currency}`;
    let offer = offers.get(key);
    if (!offer) {
      offer = await addonOffer(db, o.location_id, o.currency);
      offers.set(key, offer);
    }
    const mine = held.get(o.id);
    if (offer.some((a) => (mine?.get(a.addonId) ?? 0) < ADDON_LIMIT)) out.add(o.id);
  }
  return out;
}

/** An order's units as the console reads them, oldest first. */
export async function adminAddonUnits(db: Db, orderId: string): Promise<AdminOrderAddonUnit[]> {
  const rows = await db
    .selectFrom('order_addon_items as u')
    .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
    .innerJoin('skus as k', 'k.id', 'u.sku_id')
    .innerJoin('stock_locations as l', 'l.id', 'u.location_id')
    .selectAll('u')
    .select(['a.name', 'k.code', 'l.name as location_name'])
    .where('u.order_id', '=', orderId)
    .orderBy('u.added_at')
    .orderBy('u.id')
    .execute();
  return rows.map((u) => ({
    id: u.id,
    addon: { id: u.addon_id, name: u.name },
    skuCode: u.code,
    priceMinor: u.price_minor,
    currency: u.currency,
    status: u.status,
    addedAt: u.added_at,
    addedBy: { type: u.added_by_type, id: u.added_by },
    removedAt: u.removed_at,
    cancelledAt: u.cancelled_at,
    shippedAt: u.shipped_at,
    returnedAt: u.returned_at,
    returnedToStock: u.returned_to_stock,
    location: { id: u.location_id, name: u.location_name },
    invoiceId: u.invoice_id,
  }));
}

/**
 * The add-ons each order of a parcel packs (HELD, or SHIPPED once it has gone): by order, one row per add-on with its
 * units and weight (null: unknown), in the order they were added.
 */
export async function parcelAddonItems(db: Db, orderIds: readonly string[]): Promise<Map<string, { addonId: string; name: string; units: number; weightG: number | null }[]>> {
  const out = new Map<string, { addonId: string; name: string; units: number; weightG: number | null }[]>();
  for (const u of await unitsOf(db, orderIds, ['HELD', 'SHIPPED'])) {
    const list = out.get(u.order_id) ?? [];
    const row = list.find((x) => x.addonId === u.addon_id);
    if (row) row.units += 1;
    else list.push({ addonId: u.addon_id, name: u.name, units: 1, weightG: u.weight_g });
    out.set(u.order_id, list);
  }
  return out;
}

/** An order's units as the Shopify order export lists them (not removed), oldest first: name, SKU code, price. */
export async function exportAddonUnits(db: Db, orderIds: readonly string[]): Promise<Map<string, { name: string; skuCode: string; priceMinor: number }[]>> {
  const out = new Map<string, { name: string; skuCode: string; priceMinor: number }[]>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .selectFrom('order_addon_items as u')
    .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
    .innerJoin('skus as k', 'k.id', 'u.sku_id')
    .select(['u.order_id', 'a.name', 'k.code', 'u.price_minor'])
    .where('u.order_id', 'in', [...new Set(orderIds)])
    .where('u.status', '<>', 'REMOVED')
    .orderBy('u.added_at')
    .orderBy('u.id')
    .execute();
  for (const r of rows) {
    const list = out.get(r.order_id) ?? [];
    list.push({ name: r.name, skuCode: r.code, priceMinor: r.price_minor });
    out.set(r.order_id, list);
  }
  return out;
}

/** An order's units as the account's export says them (every unit, its state and times), by order id. */
export async function exportedAddonItems(
  db: Db,
  orderIds: readonly string[],
): Promise<Map<string, { name: string; priceMinor: number; currency: HouseCurrency; status: OrderAddonStatus; addedAt: Date; endedAt: Date | null; returnedAt: Date | null }[]>> {
  const out = new Map<string, { name: string; priceMinor: number; currency: HouseCurrency; status: OrderAddonStatus; addedAt: Date; endedAt: Date | null; returnedAt: Date | null }[]>();
  for (const u of await unitsOf(db, orderIds)) {
    const list = out.get(u.order_id) ?? [];
    list.push({ name: u.name, priceMinor: u.price_minor, currency: u.currency, status: u.status, addedAt: u.added_at, endedAt: u.removed_at ?? u.cancelled_at ?? u.shipped_at, returnedAt: u.returned_at });
    out.set(u.order_id, list);
  }
  return out;
}

// ── Windows ────────────────────────────────────────────────────────────────

type WindowFacts = Pick<OrderRow, 'channel' | 'status' | 'packing_started_at' | 'shopify_order_id' | 'currency'>;

/** Why an order takes no add-on from YOUR ORDERS now; null when it does. */
export function addonWindow(o: WindowFacts): AddonWindowReason | null {
  if (o.channel === 'GIFT' || o.channel === 'EXCHANGE' || o.shopify_order_id !== null) return 'NOT_OFFERED';
  if (!ORDER_HOLDING_STATUSES.includes(o.status)) return 'CLOSED';
  if (o.packing_started_at !== null) return 'PACKING_STARTED';
  if (!isHouseCurrency(o.currency)) return 'NO_CURRENCY';
  return null;
}

/** Why an order's add-on cannot be removed from YOUR ORDERS now; null when it can (its currency does not matter). */
function removalWindow(o: WindowFacts): AddonWindowReason | null {
  const why = addonWindow(o);
  return why === 'NO_CURRENCY' ? null : why;
}

const windowError = (why: AddonWindowReason) =>
  why === 'CLOSED' ? orderClosed() : why === 'PACKING_STARTED' ? packingStarted() : why === 'NO_CURRENCY' ? addonNotOffered('Add-ons are offered once the order’s price is entered.') : addonNotOffered('Add-ons are not offered on this order.');

// ── The changes (inside the order's transaction) ───────────────────────────

/**
 * Record an addition or a removal: the order's event, its journal entry (the order as it stands, with the add-on) and
 * the audit entry, returned for the caller to write last.
 */
async function recordAddon(tx: Db, o: OrderRow, action: 'order.addon.add' | 'order.addon.remove', addon: JsonObject, by: AddonBy, now: Date): Promise<AuditRecordInput> {
  const details: JsonObject = { ...addon, by: by.type.toLowerCase() };
  await tx
    .insertInto('order_events')
    .values({ order_id: o.id, action, status: o.status, note: null, details: jsonText(details), actor_type: by.actor.type, actor_id: by.actor.id ?? null, created_at: now })
    .execute();
  await writeJournal(tx, [{ type: action, entityType: 'order', entityId: o.id, payload: { ...orderPayload(o), addon: details } }], now);
  return { actor: by.actor, action, targetType: 'order', targetId: o.id, details: { to: o.status, ...details } };
}

/** The ADD_ON_ITEM line of a unit: its add-on's name and its price, never its SKU. */
export const addonLine = (name: string, priceMinor: number): InvoiceLine => ({ kind: ADD_ON_ITEM, label: name, detail: null, amountMinor: priceMinor });

/**
 * `units` units of an add-on added to a locked order, in `currency` (the order's; at a salon's ACCEPTED, the model's
 * base currency), under its SKU's lock: offered (404 ADDON_NOT_FOUND; 409 ADDON_NOT_OFFERED, set aside or without a
 * price in it), within ADDON_LIMIT with what the order holds already (409 ADDON_LIMIT), that many available at the
 * order's location (409 ADDON_OUT_OF_STOCK). After PAID, a supplementary invoice of their lines. Returns the units'
 * ids and the audit entries.
 */
async function addUnits(tx: Db, o: OrderRow, addonId: string, units: number, currency: HouseCurrency, by: AddonBy, now: Date): Promise<{ unitIds: string[]; notes: AuditRecordInput[] }> {
  const s = (await standings(tx, [addonId], o.location_id, currency)).get(addonId);
  if (!s) throw addonNotFound();
  if (!s.active || s.priceMinor === null) throw addonNotOffered(`${s.name} is not offered on this order.`);
  await lockSku(tx, s.skuId);
  const held = (await tx.selectFrom('order_addon_items').select('id').where('order_id', '=', o.id).where('addon_id', '=', addonId).where('status', '=', 'HELD').execute()).length;
  if (held + units > ADDON_LIMIT) throw addonLimit();
  const level = await stockLevel(tx, s.skuId, o.location_id);
  if (level.available < units) throw addonOutOfStock(s.name);
  return insertUnits(tx, o, s, units, currency, by, now);
}

async function insertUnits(
  tx: Db,
  o: OrderRow,
  s: Pick<AddonStanding, 'addonId' | 'skuId' | 'name'> & { priceMinor: number | null },
  units: number,
  currency: HouseCurrency,
  by: AddonBy,
  now: Date,
): Promise<{ unitIds: string[]; notes: AuditRecordInput[] }> {
  const price = s.priceMinor!;
  const rows = await tx
    .insertInto('order_addon_items')
    .values(
      Array.from({ length: units }, () => ({
        order_id: o.id,
        addon_id: s.addonId,
        sku_id: s.skuId,
        location_id: o.location_id,
        price_minor: price,
        currency,
        added_at: now,
        added_by_type: by.type,
        added_by: by.id,
      })),
    )
    .returning('id')
    .execute();
  const unitIds = rows.map((r) => r.id);
  const notes: AuditRecordInput[] = [];
  // Added after PAID: its own invoice (the engraving's path, plan NEXT LOT §3.6.C); a free add-on issues no document.
  if (o.status === 'PAID' && price > 0) {
    const invoice = await issueSupplementaryInvoice(tx, o, unitIds.map(() => addonLine(s.name, price)), by.actor, now);
    await tx.updateTable('order_addon_items').set({ invoice_id: invoice.targetId! }).where('id', 'in', unitIds).execute();
    notes.push(await recordAddon(tx, o, 'order.addon.add', { addonId: s.addonId, units, unitIds, priceMinor: price, currency, invoiceId: invoice.targetId! }, by, now), invoice);
  } else {
    notes.push(await recordAddon(tx, o, 'order.addon.add', { addonId: s.addonId, units, unitIds, priceMinor: price, currency }, by, now));
  }
  return { unitIds, notes };
}

/**
 * Units HELD of a locked order removed (REMOVED, the stock they held free again): after PAID, a credit note for their
 * lines, on the invoice that carries each (its supplementary invoice, or the order's). One event per add-on.
 */
async function removeUnits(tx: Db, o: OrderRow, units: readonly UnitRow[], by: AddonBy, now: Date): Promise<AuditRecordInput[]> {
  const notes: AuditRecordInput[] = [];
  for (const u of units) {
    await tx.updateTable('order_addon_items').set({ status: 'REMOVED', removed_at: later(now, u.added_at) }).where('id', '=', u.id).where('status', '=', 'HELD').execute();
  }
  const groups = new Map<string, UnitRow[]>();
  for (const u of units) groups.set(u.addon_id, [...(groups.get(u.addon_id) ?? []), u]);
  for (const [addonId, list] of groups) {
    notes.push(
      await recordAddon(
        tx,
        o,
        'order.addon.remove',
        { addonId, units: list.length, unitIds: list.map((u) => u.id), priceMinor: list[0]!.price_minor, currency: list[0]!.currency },
        by,
        now,
      ),
    );
  }
  if (o.status === 'PAID') {
    notes.push(...(await issueAddonCreditNotes(tx, o, units.filter((u) => u.price_minor > 0).map((u) => ({ invoiceId: u.invoice_id, line: addonLine(u.name, u.price_minor) })), by.actor, now)));
  }
  return notes;
}

/**
 * The choices of a sale's source carried onto its first order (in the transaction that creates it, the order just
 * created): each add-on in `currency`, under its SKU's lock (the SKUs in id order), as many units as are available at
 * the order's location (the rest left out, NONE_LEFT), none when it is set aside or no longer priced in it (NOT_OFFERED)
 * or without a currency; never blocking the sale. The choices are then deleted. Returns the units' audit entries and
 * what was left out, for the source's answer and audit entry.
 */
export async function carryChoices(tx: Db, o: OrderRow, owner: AddonChoiceOwner, currency: HouseCurrency | null, actor: Actor, now: Date): Promise<{ leftOut: LeftOutAddon[]; notes: AuditRecordInput[] }> {
  const [column, ownerId] = ownerOf(owner);
  const choices = await tx.selectFrom('addon_choices').select(['addon_id', 'units']).where(column, '=', ownerId).execute();
  const leftOut: LeftOutAddon[] = [];
  const notes: AuditRecordInput[] = [];
  if (choices.length === 0) return { leftOut, notes };
  const found = await standings(tx, choices.map((c) => c.addon_id), o.location_id, currency);
  const by: AddonBy = { type: 'PURCHASE', id: null, actor };
  // The SKUs in one order (two sales carrying the same add-ons never wait for each other).
  const ordered = [...choices].sort((a, b) => (found.get(a.addon_id)?.skuId ?? '').localeCompare(found.get(b.addon_id)?.skuId ?? ''));
  for (const c of ordered) {
    const s = found.get(c.addon_id)!;
    if (currency === null || !s.active || s.priceMinor === null) {
      leftOut.push({ addonId: s.addonId, name: s.name, units: c.units, reason: 'NOT_OFFERED' });
      continue;
    }
    await lockSku(tx, s.skuId);
    const level = await stockLevel(tx, s.skuId, o.location_id);
    const units = Math.max(0, Math.min(c.units, level.available, ADDON_LIMIT));
    if (units > 0) notes.push(...(await insertUnits(tx, o, s, units, currency, by, now)).notes);
    if (units < c.units) leftOut.push({ addonId: s.addonId, name: s.name, units: c.units - units, reason: 'NONE_LEFT' });
  }
  await clearChoices(tx, column, [ownerId]);
  return { leftOut, notes };
}

/** An order cancelled: its units HELD cancelled with it (the stock they held free again). In its transaction. */
export async function cancelUnits(tx: Db, o: OrderRow, now: Date): Promise<number> {
  const held = await unitsOf(tx, [o.id], ['HELD']);
  for (const u of held) await tx.updateTable('order_addon_items').set({ status: 'CANCELLED', cancelled_at: later(now, u.added_at) }).where('id', '=', u.id).execute();
  return held.length;
}

/** An order shipped: each unit HELD leaves the ledger with it (SHIPPED, −1, the unit named), under its SKU's lock. */
export async function shipUnits(tx: Db, o: OrderRow, actor: Actor, now: Date): Promise<number> {
  const held = await unitsOf(tx, [o.id], ['HELD']);
  const skus = bySku(held);
  for (const skuId of [...skus.keys()].sort()) {
    await lockSku(tx, skuId);
    for (const u of skus.get(skuId)!.units) {
      await recordMovement(tx, { skuId, locationId: u.location_id, delta: -1, reason: 'SHIPPED', orderId: o.id, orderAddonItemId: u.id }, actor, now);
      await tx.updateTable('order_addon_items').set({ status: 'SHIPPED', shipped_at: later(now, u.added_at) }).where('id', '=', u.id).execute();
    }
  }
  return held.length;
}

/** The orders a size exchange chain started from: an EXCHANGE order's original, its original's, and so on (oldest last). */
async function exchangedFrom(tx: Db, o: Pick<OrderRow, 'exchange_of_order_id'>): Promise<string[]> {
  const out: string[] = [];
  let next = o.exchange_of_order_id;
  while (next !== null && !out.includes(next)) {
    out.push(next);
    next = (await tx.selectFrom('orders').select('exchange_of_order_id').where('id', '=', next).executeTakeFirst())?.exchange_of_order_id ?? null;
  }
  return out;
}

/**
 * The units a size exchange left with the collector (plan §4.1): those of the orders an EXCHANGE order replaces, still
 * SHIPPED. Its invoice bills them again (its original's return credited them); a refund of it returns them.
 */
export async function keptUnits(tx: Db, o: Pick<OrderRow, 'channel' | 'exchange_of_order_id'>): Promise<{ name: string; priceMinor: number }[]> {
  if (o.channel !== 'EXCHANGE') return [];
  return (await unitsOf(tx, await exchangedFrom(tx, o), ['SHIPPED'])).map((u) => ({ name: u.name, priceMinor: u.price_minor }));
}

/**
 * An order returned (in its transaction): a size exchange (`keep`) leaves its units with the collector; any other
 * return takes back its units SHIPPED (and those a size exchange it replaces had left with the collector): RETURNED,
 * back to stock at `locationId` (the return's, else the order's) with the ledger's RETURNED +1 under each SKU's lock,
 * unless named in `out` (not to be sold again: `returned_to_stock` false, no movement). Returns how many came back.
 */
export async function returnUnits(tx: Db, o: OrderRow, r: { keep: boolean; locationId: string | null; out: ReadonlySet<string> }, actor: Actor, now: Date): Promise<{ returned: number; restocked: number }> {
  if (r.keep) return { returned: 0, restocked: 0 };
  const shipped = await unitsOf(tx, [o.id, ...(o.channel === 'EXCHANGE' ? await exchangedFrom(tx, o) : [])], ['SHIPPED']);
  const location = r.locationId ?? o.location_id;
  let restocked = 0;
  const skus = bySku(shipped);
  for (const skuId of [...skus.keys()].sort()) {
    await lockSku(tx, skuId);
    for (const u of skus.get(skuId)!.units) {
      const toStock = !r.out.has(u.id);
      await tx.updateTable('order_addon_items').set({ status: 'RETURNED', returned_at: later(now, u.shipped_at!), returned_to_stock: toStock }).where('id', '=', u.id).execute();
      if (toStock) {
        await recordMovement(tx, { skuId, locationId: location, delta: 1, reason: 'RETURNED', orderId: u.order_id, orderAddonItemId: u.id }, actor, now);
        restocked += 1;
      }
    }
  }
  return { returned: shipped.length, restocked };
}

/**
 * A parcel problem decided (services/order-cases.ts decideParcel, the order back to PAID): its units SHIPPED come back
 * to HELD with it. A parcel back to its sender (`cameBack`) brings them back to stock (the ledger's RETURNED +1, then
 * held again); a parcel lost or damaged reshipped takes a new unit of each from the stock (held, no movement: the one
 * that left is gone with the parcel), never waiting for one: the units held beyond what the order's location has are
 * returned (`short`, by add-on), for the decision's answer and its `order.reship` event, so Client Services counts them
 * in, moves them there or removes them before packing; refunded, they stay as they left (gone), credited with the
 * order's cancellation.
 */
export async function reshipUnits(tx: Db, o: OrderRow, r: { cameBack: boolean; reship: boolean }, actor: Actor, now: Date): Promise<{ units: number; short: { addonId: string; name: string; units: number }[] }> {
  if (!r.cameBack && !r.reship) return { units: 0, short: [] };
  const shipped = await unitsOf(tx, [o.id], ['SHIPPED']);
  const skus = bySku(shipped);
  const short: { addonId: string; name: string; units: number }[] = [];
  for (const skuId of [...skus.keys()].sort()) {
    await lockSku(tx, skuId);
    const g = skus.get(skuId)!;
    for (const u of g.units) {
      if (r.cameBack) await recordMovement(tx, { skuId, locationId: u.location_id, delta: 1, reason: 'RETURNED', orderId: o.id, orderAddonItemId: u.id }, actor, now);
      await tx.updateTable('order_addon_items').set({ status: 'HELD', shipped_at: null, location_id: o.location_id }).where('id', '=', u.id).execute();
    }
    if (!r.cameBack) {
      const missing = Math.min(g.units.length, -(await stockLevel(tx, skuId, o.location_id)).available);
      if (missing > 0) short.push({ addonId: g.units[0]!.addon_id, name: g.name, units: missing });
    }
  }
  return { units: shipped.length, short };
}

/**
 * An order's location changed (in its transaction, the order's row held): its units HELD move with it, each SKU under
 * its lock, while the new location has them available; otherwise the change is refused (409
 * ORDER_ADDON_NOT_AT_LOCATION: move the stock first, or remove the add-on). Returns how many moved.
 */
export async function moveUnits(tx: Db, o: OrderRow, toLocationId: string): Promise<number> {
  const moving = (await unitsOf(tx, [o.id], ['HELD'])).filter((u) => u.location_id !== toLocationId);
  const skus = bySku(moving);
  for (const skuId of [...skus.keys()].sort()) {
    await lockSku(tx, skuId);
    const g = skus.get(skuId)!;
    if ((await stockLevel(tx, skuId, toLocationId)).available < g.units.length) throw addonNotAtLocation(g.name);
    await tx.updateTable('order_addon_items').set({ location_id: toLocationId }).where('id', 'in', g.units.map((u) => u.id)).execute();
  }
  return moving.length;
}

/**
 * The currency of an order's units HELD (one currency: the order's, or a salon's base currency before its price is
 * entered); null without any. setTerms keeps the piece's price in it (409 ORDER_ADDON_CURRENCY).
 */
export async function heldCurrency(tx: Db, orderId: string): Promise<HouseCurrency | null> {
  const u = await tx.selectFrom('order_addon_items').select('currency').where('order_id', '=', orderId).where('status', '=', 'HELD').limit(1).executeTakeFirst();
  return u?.currency ?? null;
}

export const addonCurrencyFixed = (currency: string) =>
  conflict('ORDER_ADDON_CURRENCY', `The add-ons on this order are priced in ${currency}: enter its price in ${currency}, or remove them first.`);

// ── The service (YOUR ORDERS and the console) ──────────────────────────────

export interface OrderAddonServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class OrderAddonService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: OrderAddonServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * What the collector can add to one of their orders now (GET /api/v1/account/orders/:id/addons): the add-ons offered
   * at its location in its currency, each with the units it can still take; `canAdd` false with its reason otherwise.
   * Their own order only (404 ORDER_NOT_FOUND).
   */
  async offerForAccount(accountId: string, orderId: string): Promise<AccountAddonOffer> {
    const o = await this.ownOrder(this.db, accountId, orderId);
    const reason = addonWindow(o);
    const currency = isHouseCurrency(o.currency) ? o.currency : null;
    const offer = reason === null ? await addonOffer(this.db, o.location_id, currency, await heldByAddon(this.db, o.id)) : [];
    return { canAdd: reason === null, reason, paid: o.status === 'PAID', currency, offer };
  }

  /**
   * ADD AN ADD-ON (POST /api/v1/account/orders/:id/addons): `units` of an add-on on the collector's own order while it
   * takes add-ons (see the header), at its price now in the order's currency, held at once. After PAID, its own
   * invoice. The account's row, then the order's. Audited `order.addon.add` by the account.
   */
  async addForAccount(accountId: string, orderId: string, input: AddonUnitsInput, actor: Actor): Promise<string> {
    const [item] = cleanAddonItems([input]);
    await inRetriedTransaction(this.db, async (tx) => {
      await this.activeAccount(tx, accountId);
      const o = await this.ownOrder(tx, accountId, orderId, { forUpdate: true });
      const why = addonWindow(o);
      if (why !== null) throw windowError(why);
      const now = this.clock();
      const done = await addUnits(tx, o, item!.addonId, item!.units, o.currency as HouseCurrency, { type: 'COLLECTOR', id: o.account_id, actor }, now);
      for (const n of done.notes) await this.audit.record(n, tx);
    });
    return orderId.toLowerCase();
  }

  /**
   * REMOVE (DELETE /api/v1/account/orders/:id/addons/:addonId): every unit HELD of that add-on on the collector's own
   * order, until packing starts (404 ADDON_NOT_FOUND when it holds none). After PAID, a credit note for their lines.
   * Audited `order.addon.remove` by the account.
   */
  async removeForAccount(accountId: string, orderId: string, addonId: string, actor: Actor): Promise<string> {
    if (typeof addonId !== 'string' || !UUID_RE.test(addonId)) throw unitNotFound();
    await inRetriedTransaction(this.db, async (tx) => {
      await this.activeAccount(tx, accountId);
      const o = await this.ownOrder(tx, accountId, orderId, { forUpdate: true });
      const why = removalWindow(o);
      if (why !== null) throw windowError(why);
      const units = (await unitsOf(tx, [o.id], ['HELD'])).filter((u) => u.addon_id === addonId.toLowerCase());
      if (units.length === 0) throw unitNotFound();
      const notes = await removeUnits(tx, o, units, { type: 'COLLECTOR', id: o.account_id, actor }, this.clock());
      for (const n of notes) await this.audit.record(n, tx);
    });
    return orderId.toLowerCase();
  }

  /**
   * Add an add-on (POST /api/admin/orders/:id/addons, OPERATOR): `units` of it on any order RESERVED or PAID (409
   * ORDER_CLOSED once shipped or ended), packing begun or not; never on a welcome gift, a size exchange nor a Shopify
   * order (409 ADDON_NOT_OFFERED), its currency entered. Audited `order.addon.add` by the admin.
   */
  async addForStaff(orderId: string, input: AddonUnitsInput, actor: Actor): Promise<void> {
    const adminId = this.staff(actor);
    const id = this.knownOrder(orderId);
    const [item] = cleanAddonItems([input]);
    await inRetriedTransaction(this.db, async (tx) => {
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!o) throw orderNotFound();
      const why = addonWindow(o);
      if (why !== null && why !== 'PACKING_STARTED') throw windowError(why);
      const done = await addUnits(tx, o, item!.addonId, item!.units, o.currency as HouseCurrency, { type: 'STAFF', id: adminId, actor }, this.clock());
      for (const n of done.notes) await this.audit.record(n, tx);
    });
  }

  /**
   * Remove one unit (DELETE /api/admin/orders/:id/addons/:lineId, OPERATOR): a unit HELD of the order (404
   * ADDON_NOT_FOUND otherwise), until SHIPPED (409 ORDER_CLOSED). After PAID, a credit note for its line. Audited
   * `order.addon.remove` by the admin.
   */
  async removeForStaff(orderId: string, unitId: string, actor: Actor): Promise<void> {
    const adminId = this.staff(actor);
    const id = this.knownOrder(orderId);
    if (typeof unitId !== 'string' || !UUID_RE.test(unitId)) throw unitNotFound();
    await inRetriedTransaction(this.db, async (tx) => {
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!o) throw orderNotFound();
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      const unit = (await unitsOf(tx, [o.id], ['HELD'])).find((u) => u.id === unitId.toLowerCase());
      if (!unit) throw unitNotFound();
      const notes = await removeUnits(tx, o, [unit], { type: 'STAFF', id: adminId, actor }, this.clock());
      for (const n of notes) await this.audit.record(n, tx);
    });
  }

  /** The add-ons offered at a location in a currency now, as the console's Add an add-on dialog lists them for an order. */
  async offerForStaff(orderId: string): Promise<AccountAddonOffer> {
    const id = this.knownOrder(orderId);
    const o = await this.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirst();
    if (!o) throw orderNotFound();
    const why = addonWindow(o);
    const reason = why === 'PACKING_STARTED' ? null : why;
    const currency = isHouseCurrency(o.currency) ? o.currency : null;
    const offer = reason === null ? await addonOffer(this.db, o.location_id, currency, await heldByAddon(this.db, o.id)) : [];
    return { canAdd: reason === null, reason, paid: o.status === 'PAID', currency, offer };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private staff(actor: Actor): string | null {
    if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only ORBES staff can change an order’s add-ons this way.');
    return actor.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
  }

  private knownOrder(orderId: string): string {
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw orderNotFound();
    return orderId.toLowerCase();
  }

  /** The account ACTIVE (403 ACCOUNT_LOCKED), its row held FOR SHARE. */
  private async activeAccount(tx: Db, accountId: string): Promise<void> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const a = await tx.selectFrom('accounts').select('status').where('id', '=', accountId.toLowerCase()).forShare().executeTakeFirst();
    if (!a) throw orderNotFound();
    if (a.status !== 'ACTIVE') throw customerAccountLocked();
  }

  /** The account's own order (404 ORDER_NOT_FOUND for another's or an unknown one), FOR UPDATE when asked. */
  private async ownOrder(db: Db, accountId: string, orderId: string, opts: { forUpdate?: boolean } = {}): Promise<OrderRow> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw orderNotFound();
    const id = this.knownOrder(orderId);
    const q = db.selectFrom('orders').selectAll().where('id', '=', id).where('account_id', '=', accountId.toLowerCase());
    const o = await (opts.forUpdate ? q.forUpdate() : q).executeTakeFirst();
    if (!o) throw orderNotFound();
    return o;
  }
}

/** An add-on chosen before its order, as the account's export says it (OwnerService.exportData). */
export interface ExportedAddonChoice {
  /** Where it was chosen: a LIVE RELEASE's hold, a draw's place held, a salon request. */
  on: 'LIVE_ENTRY' | 'DRAW_ENTRY' | 'SALON_REQUEST';
  /** The entry's or the request's id (as the export's entries and requests name them). */
  sourceId: string;
  addon: string;
  units: number;
  chosenAt: Date;
}

/** The add-ons an account chose and that are not on an order yet, oldest first (its right of access). */
export async function exportedAddonChoices(db: Db, accountId: string): Promise<ExportedAddonChoice[]> {
  const rows = await db
    .selectFrom('addon_choices as c')
    .innerJoin('addon_items as a', 'a.id', 'c.addon_id')
    .leftJoin('live_entries as l', 'l.id', 'c.live_entry_id')
    .leftJoin('drop_entries as d', 'd.id', 'c.drop_entry_id')
    .leftJoin('shop_requests as r', 'r.id', 'c.shop_request_id')
    .select(['c.live_entry_id', 'c.drop_entry_id', 'c.shop_request_id', 'a.name', 'c.units', 'c.chosen_at'])
    .where((eb) => eb.or([eb('l.account_id', '=', accountId), eb('d.account_id', '=', accountId), eb('r.account_id', '=', accountId)]))
    .orderBy('c.chosen_at')
    .orderBy('c.id')
    .execute();
  return rows.map((r) => ({
    on: r.live_entry_id ? 'LIVE_ENTRY' : r.drop_entry_id ? 'DRAW_ENTRY' : 'SALON_REQUEST',
    sourceId: (r.live_entry_id ?? r.drop_entry_id ?? r.shop_request_id)!,
    addon: r.name,
    units: r.units,
    chosenAt: r.chosen_at,
  }));
}
