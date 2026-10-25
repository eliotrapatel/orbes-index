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
 *   staff        Client Services adds and removes units until the parcel is packed (`addForStaff`, `removeForStaff`,
 *                OPERATOR; 409 PACKING_PACKED once its shipment is PACKED: the sealed parcel, its checklist and its
 *                weight never change, and Ship moves exactly the units packed). While PACKING, Packed rebuilds the
 *                checklist and the weight from the units held then.
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
 *   packing      one checklist line per add-on of each order (`addon-item:<orderId>:<addonId>:<units>`, « Add-on:
 *                POLISHING CLOTH × 2 »: a line ticked at × 2 no longer counts once staff make it 3), ticked by hand (no
 *                scan: no identity); the parcel's weight adds each unit's weight.
 *   history      each addition and removal is one event of the order, one journal entry (`order.addon.add`,
 *                `order.addon.remove`: the order as it stands with the add-on, its units and price, for the future
 *                Shopify sync) and one audit entry; the units' stock movements journal themselves (`stock.move`).
 *
 * ONE OFFER RULE (lot Q2, step Q2.3, D3 and D8; N8): an add-on is offered at a moment when it is active, priced in the
 * currency, its moment's switch on (services/addons.ts `offeredAt`) and, at the two purchase moments with a release (a
 * LIVE RELEASE's hold, its after-room's own; a draw's place held), picked by that release (`drop_addons`, in its order).
 * A salon request and YOUR ORDERS follow their switch alone: YOUR ORDERS offers every add-on whose YOUR ORDERS switch is
 * on, on every order until packing, whatever its release and whether it has ended (as M3; its exclusions kept). Staff
 * are bound by none of it (every active add-on priced in the order's currency). `addonOffer` lists what a moment offers,
 * and every choice, addition and carry checks the same (409 ADDON_NOT_OFFERED naming the switch or the pick). The
 * engraving (services/addons.ts) is one unit at most on an order, and the only add-on whose choice takes words (at most
 * its `textMax` characters, the house's set); YOUR ORDERS' ADD AN ADD-ON leaves it out (it has its own ENGRAVING). In
 * YOUR ORDERS its unit is added and removed with its words, in the order's ENGRAVING (services/orders.ts setEngraving,
 * Q2.5), and never read among the order's add-on rows.
 *
 * A service's unit (lot Q2, step Q2.2, D4: an engraving, a gift wrapping; services/addons.ts) is held nowhere: added
 * with no location and no SKU lock (always available: no count), shipped and returned with its order by its status and
 * times only (no stock movement; `returned_to_stock` false), left where it is when the order's location changes, its
 * weight counted in the parcel when it has one; its documents, packing line and export lines are a product's.
 *
 * Lock order (orders.ts): the source's rows, the order, the units' SKUs in id order (lockSku), the invoice numbers, the
 * journal, the audit log last.
 */
import { sql } from 'kysely';
import { inRetriedTransaction, type Db } from '../db/connection.js';
import { ADDON_UNITS_MAX, HOUSE_CURRENCIES, jsonText, type AddonKind, type HouseCurrency, type JsonObject, type OrderAddonAddedBy, type OrderAddonStatus, type OrderRow } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { addonNotFound, OFFER_COLUMN, OFFER_MOMENT_WORDS, type OfferMoment } from './addons.js';
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
/** The engraving: one on an order (Q2.3). */
const engravingLimit = (name: string) => conflict('ADDON_LIMIT', `At most one ${name} on an order.`);
/** The engraving's words (Q2.3, D12, N3): at most its most characters, of the house's set. */
export const engravingWordsInvalid = (max: number) => validationError(`Up to ${max} characters: letters, figures, spaces and . & ’ -`);
const wordsNotEngraving = () => validationError('Only the engraving takes words.');
const addonNotAtLocation = (name: string) =>
  conflict('ORDER_ADDON_NOT_AT_LOCATION', `${name} is not in stock at the new location: move its stock there first, or remove the add-on.`);
const orderNotFound = () => notFound('Order', 'ORDER_NOT_FOUND');
const orderClosed = () => conflict('ORDER_CLOSED', 'This order can no longer change.');
const packingStarted = () => conflict('ORDER_PACKING_STARTED', 'Packing has begun: write to ORBES Client Services to change this order.');
const unitNotFound = () => notFound('Add-on', 'ADDON_NOT_FOUND');
const parcelPacked = () => conflict('PACKING_PACKED', 'The parcel is packed: it no longer changes.');

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
  /** The units that can be chosen or added now: what is available there, within ADDON_LIMIT (less what the order holds); the engraving 1. */
  maxUnits: number;
  /** The engraving: its collector types the words engraved on the piece (Q2.3). */
  engraving: boolean;
  /** The engraving's most characters (1 to 20); on the engraving only. */
  textMax?: number;
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
  addon: { id: string; name: string; kind: AddonKind; engraving: boolean };
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
  /** Where it is held; null for a service's unit (held nowhere, Q2). */
  location: { id: string; name: string } | null;
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

/** GET /api/admin/orders/:id/addons: as the collector's, packing begun or not; `PACKED` once its parcel is packed. */
export interface StaffAddonOffer extends Omit<AccountAddonOffer, 'reason'> {
  reason: Exclude<AddonWindowReason, 'PACKING_STARTED'> | 'PACKED' | null;
}

/** Who adds or removes: the purchase (carried, no one named), the collector, or staff (an admin, or a script). */
export interface AddonBy {
  type: OrderAddonAddedBy;
  /** The account (COLLECTOR) or the admin (STAFF); null for PURCHASE and a script. */
  id: string | null;
  actor: Actor;
}

/** The owner of a choice: one LIVE entry, one draw entry or one salon request. */
export type AddonChoiceOwner = { liveEntryId: string } | { dropEntryId: string } | { shopRequestId: string };

/** One add-on chosen or added: its id and units; the engraving's words with its choice (Q2.3), none on any other. */
export interface AddonUnitsInput {
  addonId: string;
  units: number;
  text?: string | null;
}

/**
 * Where an add-on is offered (Q2.3): a moment and, at LIVE and DRAW, the release whose pick it reads; STAFF, the console
 * (bound by no switch and no pick).
 */
export interface OfferAt {
  moment: OfferMoment | 'STAFF';
  /** The release (a LIVE RELEASE, its after-room, a draw) at LIVE and DRAW; null otherwise. */
  dropId: string | null;
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

/** A list of add-ons and their units, checked: each add-on once, at most ADDON_CHOICES_MAX; words given as text (checked against the add-on in setChoices). */
export function cleanAddonItems(items: unknown): AddonUnitsInput[] {
  if (!Array.isArray(items)) throw validationError('Send the add-ons as a list.');
  if (items.length > ADDON_CHOICES_MAX) throw validationError(`At most ${ADDON_CHOICES_MAX} add-ons.`);
  const seen = new Set<string>();
  return items.map((i) => {
    const x = (i ?? {}) as { addonId?: unknown; units?: unknown; text?: unknown };
    if (typeof x.addonId !== 'string' || !UUID_RE.test(x.addonId)) throw addonNotFound();
    const addonId = x.addonId.toLowerCase();
    if (seen.has(addonId)) throw validationError('Each add-on is chosen once, with its units.');
    seen.add(addonId);
    if (x.text !== undefined && x.text !== null && typeof x.text !== 'string') throw validationError('The words are text.');
    return { addonId, units: cleanUnits(x.units), ...(typeof x.text === 'string' ? { text: x.text } : {}) };
  });
}

/** One row chosen at a LIVE hold (lot Q2, step Q2.4, N1): its add-on and, for the engraving, its words. */
export interface LiveAddonRowInput {
  addonId: string;
  text?: string | null;
}

/**
 * The rows chosen at a LIVE hold, checked (lot Q2, step Q2.4, N1): each add-on once, at most ADDON_CHOICES_MAX, words as
 * text (checked against the add-on in setChoices); each a choice of one unit (taken on each piece's order at PAY).
 */
export function cleanAddonRows(items: unknown): AddonUnitsInput[] {
  if (!Array.isArray(items)) throw validationError('Send the add-ons as a list.');
  return cleanAddonItems(items.map((i: unknown) => ({ ...((i ?? {}) as object), units: 1 })));
}

/**
 * The engraving's words as typed (Q2.3, D12, N3): runs of spaces kept to one, trimmed; empty: none (they are then
 * entered in YOUR ORDERS); otherwise 1 to `max` characters of letters, figures, spaces and . & ' ’ - (400 with the
 * house's sentence at that maximum).
 */
export function engravingWordsOf(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  const words = text.replace(/\s+/g, ' ').trim();
  if (words === '') return null;
  if ([...words].length > max || !/^[\p{L}\p{M}0-9 .&'’-]+$/u.test(words)) throw engravingWordsInvalid(max);
  return words;
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
  /** Available at the location; a service, without count, always (Infinity). */
  available: number;
  kind: AddonKind;
  /** Its switches by moment (Q2.3). */
  offered: Record<OfferMoment, boolean>;
  engraving: boolean;
  textMax: number;
  /** Picked by the release named (drop_addons); false without one. */
  picked: boolean;
}

/**
 * The standing of each add-on named (unknown ones absent): its SKU, its price in `currency`, what is available at
 * `locationId`, its switches, and whether the release `dropId` picks it.
 */
async function standings(db: Db, addonIds: readonly string[], locationId: string, currency: HouseCurrency | null, dropId: string | null = null): Promise<Map<string, AddonStanding>> {
  if (addonIds.length === 0) return new Map();
  const rows = await sql<{
    addon_id: string;
    sku_id: string;
    name: string;
    line: string | null;
    active: boolean;
    weight_g: number | null;
    price_minor: number | null;
    available: number;
    kind: AddonKind;
    offer_live: boolean;
    offer_draw: boolean;
    offer_salon: boolean;
    offer_orders: boolean;
    engraving: boolean;
    text_max: number;
    picked: boolean;
  }>`
    SELECT a.id AS addon_id, k.id AS sku_id, a.name, a.line, a.active, a.weight_g, p.price_minor, a.kind,
           a.offer_live, a.offer_draw, a.offer_salon, a.offer_orders, a.engraving, a.text_max,
           EXISTS (SELECT 1 FROM drop_addons x WHERE x.addon_id = a.id AND x.drop_id = ${dropId}::uuid) AS picked,
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
        available: r.kind === 'SERVICE' ? Number.POSITIVE_INFINITY : Number(r.available),
        kind: r.kind,
        offered: { LIVE: r.offer_live, DRAW: r.offer_draw, SALON: r.offer_salon, ORDERS: r.offer_orders },
        engraving: r.engraving,
        textMax: Number(r.text_max),
        picked: r.picked === true,
      },
    ]),
  );
}

/** At a purchase moment with a release (Q2.3, D3): only what it picks. */
const readsPick = (at: OfferAt): boolean => at.moment === 'LIVE' || at.moment === 'DRAW';

/**
 * Why an add-on is not offered where `at` says (Q2.3), in words, or null when it is: set aside or without a price in the
 * currency (`unpriced`, the caller's words), its moment's switch off, or not picked by the release.
 */
function notOfferedWhy(s: AddonStanding, at: OfferAt, unpriced: string): string | null {
  if (!s.active || s.priceMinor === null) return unpriced;
  if (at.moment === 'STAFF') return null;
  if (!s.offered[at.moment]) return `${s.name} is not offered ${OFFER_MOMENT_WORDS[at.moment]}.`;
  if (readsPick(at) && !s.picked) return `${s.name} is not one of this release’s add-ons.`;
  return null;
}

/** Where a choice's owner chooses (Q2.3): a LIVE entry at LIVE in its release (an after-room's: its own), a draw's entry at DRAW, a salon request at SALON. */
async function offerAtOf(db: Db, owner: AddonChoiceOwner): Promise<OfferAt> {
  if ('liveEntryId' in owner) {
    const e = await db.selectFrom('live_entries').select('drop_id').where('id', '=', owner.liveEntryId).executeTakeFirst();
    return { moment: 'LIVE', dropId: e?.drop_id ?? null };
  }
  if ('dropEntryId' in owner) {
    const e = await db.selectFrom('drop_entries').select('drop_id').where('id', '=', owner.dropEntryId).executeTakeFirst();
    return { moment: 'DRAW', dropId: e?.drop_id ?? null };
  }
  return { moment: 'SALON', dropId: null };
}

/**
 * What a moment offers at `locationId` in `currency` now (ONE OFFER RULE, Q2.3: active, priced, its moment's switch on
 * and, at LIVE and DRAW, picked by the release `dropId`, in the release's order; at SALON and ORDERS the switch alone,
 * in the add-ons' order; STAFF bound by neither), each with the units that can still be taken: a product what is
 * available there (at least one), a service ADDON_LIMIT (no count), the engraving one; less `held` (the units of that
 * add-on the order holds already). An add-on whose limit is reached is left out. At a LIVE hold (`pieces`, lot Q2, step
 * Q2.4, N1) a row is chosen or not: one unit per piece of the entry (one per set), so each offers one, a product only
 * while `pieces` are available there.
 */
export async function addonOffer(
  db: Db,
  at: OfferAt & { locationId: string; currency: HouseCurrency | null; held?: ReadonlyMap<string, number>; pieces?: number },
): Promise<AddonOfferItem[]> {
  const { locationId, currency } = at;
  // A LIVE hold (lot Q2, step Q2.4, N1): a row chosen is one unit per piece of the entry (one per set), so each row
  // takes one, and a product is offered only while that many are available.
  const pieces = at.pieces === undefined ? null : Math.max(1, at.pieces);
  const held = at.held ?? new Map<string, number>();
  if (currency === null) return [];
  const pick = readsPick(at);
  if (pick && at.dropId === null) return [];
  const rows = await sql<{ addon_id: string; name: string; line: string | null; price_minor: number; available: number; kind: AddonKind; engraving: boolean; text_max: number }>`
    SELECT a.id AS addon_id, a.name, a.line, p.price_minor, a.kind, a.engraving, a.text_max,
           (coalesce((SELECT sum(m.delta) FROM stock_movements m WHERE m.sku_id = k.id AND m.location_id = ${locationId}::uuid), 0)
            - (SELECT count(*) FROM stock_holds h WHERE h.sku_id = k.id AND h.location_id = ${locationId}::uuid AND h.reservation = 'STOCK'))::int AS available
      FROM addon_items a
      JOIN skus k ON k.addon_id = a.id
      JOIN addon_item_prices p ON p.addon_id = a.id AND p.currency = ${currency}
      ${pick ? sql`JOIN drop_addons x ON x.addon_id = a.id AND x.drop_id = ${at.dropId}::uuid` : sql``}
     WHERE a.active ${at.moment === 'STAFF' ? sql`` : sql`AND ${sql.ref(`a.${OFFER_COLUMN[at.moment]}`)}`}
     ORDER BY ${pick ? sql`x.position, ` : sql``}a.position, lower(a.name), a.id`.execute(db);
  return rows.rows
    .map((r) => {
      const limit = r.engraving ? 1 : ADDON_LIMIT;
      if (pieces !== null) {
        const enough = r.kind === 'SERVICE' || Number(r.available) >= pieces;
        return { addonId: r.addon_id, name: r.name, line: r.line, priceMinor: Number(r.price_minor), currency, maxUnits: enough ? 1 : 0, engraving: r.engraving, ...(r.engraving ? { textMax: Number(r.text_max) } : {}) };
      }
      return {
        addonId: r.addon_id,
        name: r.name,
        line: r.line,
        priceMinor: Number(r.price_minor),
        currency,
        maxUnits: Math.max(0, Math.min(r.kind === 'SERVICE' ? limit : Number(r.available), limit - (held.get(r.addon_id) ?? 0))),
        engraving: r.engraving,
        ...(r.engraving ? { textMax: Number(r.text_max) } : {}),
      };
    })
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
 * The choices of an owner replaced (in the caller's transaction, the owner's row held): each checked against what its
 * moment offers at `locationId` in `currency` now (ONE OFFER RULE: 404 ADDON_NOT_FOUND; 409 ADDON_NOT_OFFERED without a
 * currency or a price in it, once set aside, its moment's switch off, or at a LIVE hold or a draw's place held not
 * picked by the release; 409 ADDON_OUT_OF_STOCK when fewer are available there; 409 ADDON_LIMIT above 3, the engraving
 * above 1). The engraving's words (`text`, its choice only: 400 on another) are at most its most characters of the
 * house's set (400); none is allowed. At a LIVE hold (`pieces`, lot Q2, step Q2.4, N1) each choice's units are taken
 * on each piece's order (each set's), so `pieces` times as many must be available. Nothing is held: the stock is taken
 * when the order is created (`carryChoices`). An empty list clears them. Returns what was chosen, for the caller's audit entry (never the words: `text: true`).
 */
export async function setChoices(
  tx: Db,
  owner: AddonChoiceOwner,
  items: readonly AddonUnitsInput[],
  at: { locationId: string; currency: HouseCurrency | null; pieces?: number },
  now: Date,
): Promise<JsonObject[]> {
  // A LIVE hold (lot Q2, step Q2.4, N1): each choice is one unit per piece of the entry (one per set), checked against
  // the stock for that many.
  const pieces = Math.max(1, at.pieces ?? 1);
  const [column, ownerId] = ownerOf(owner);
  const words = new Map<string, string | null>();
  if (items.length > 0) {
    if (at.currency === null) throw addonNotOffered('Add-ons are offered once the price is known.');
    const where = await offerAtOf(tx, owner);
    const found = await standings(tx, items.map((i) => i.addonId), at.locationId, at.currency, where.dropId);
    for (const i of items) {
      const s = found.get(i.addonId);
      if (!s) throw addonNotFound();
      const why = notOfferedWhy(s, where, `${s.name} is not offered here.`);
      if (why !== null) throw addonNotOffered(why);
      if (s.engraving && i.units > 1) throw engravingLimit(s.name);
      if (s.available < i.units * pieces) throw addonOutOfStock(s.name);
      if (i.text !== undefined && i.text !== null && !s.engraving) throw wordsNotEngraving();
      words.set(i.addonId, s.engraving ? engravingWordsOf(i.text, s.textMax) : null);
    }
  }
  await tx.deleteFrom('addon_choices').where(column, '=', ownerId).execute();
  if (items.length > 0) {
    await tx
      .insertInto('addon_choices')
      .values(
        items.map((i) => ({ [column]: ownerId, addon_id: i.addonId, units: i.units, text: words.get(i.addonId) ?? null, chosen_at: now }) as { addon_id: string; units: number; text: string | null; chosen_at: Date }),
      )
      .execute();
  }
  return items.map((i) => ({ addonId: i.addonId, units: i.units, ...(words.get(i.addonId) ? { text: true } : {}) }));
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
    .select(['a.name', 'a.weight_g', 'a.kind', 'a.engraving'])
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
 * The engraving's unit is never one of them: it is read in the order's own ENGRAVING (lot Q2, step Q2.5).
 */
export async function accountAddonItems(db: Db, orders: readonly Pick<OrderRow, 'id' | 'channel' | 'status' | 'packing_started_at' | 'shopify_order_id' | 'currency'>[]): Promise<Map<string, AccountOrderAddonItem[]>> {
  const out = new Map<string, AccountOrderAddonItem[]>();
  const units = (await unitsOf(db, orders.map((o) => o.id))).filter((u) => u.status !== 'REMOVED' && !u.engraving);
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
 * take (`addonOffer` at ORDERS, its switch alone, whatever the order's release (Q2.3, N8), the engraving left out: it
 * has its own ENGRAVING; less the units of it the order holds), as `OrderAddonService.offerForAccount` would list it.
 * The offer is read once per location and currency. Stock that runs out between this read and the sheet's leaves the
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
      offer = (await addonOffer(db, { moment: 'ORDERS', dropId: null, locationId: o.location_id, currency: o.currency })).filter((a) => !a.engraving);
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
    // A service's unit is held nowhere (Q2): no location.
    .leftJoin('stock_locations as l', 'l.id', 'u.location_id')
    .selectAll('u')
    .select(['a.name', 'a.kind', 'a.engraving', 'k.code', 'l.id as location_ref', 'l.name as location_name'])
    .where('u.order_id', '=', orderId)
    .orderBy('u.added_at')
    .orderBy('u.id')
    .execute();
  return rows.map((u) => ({
    id: u.id,
    addon: { id: u.addon_id, name: u.name, kind: u.kind, engraving: u.engraving },
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
    location: u.location_ref === null ? null : { id: u.location_ref, name: u.location_name! },
    invoiceId: u.invoice_id,
  }));
}

/** An add-on a parcel packs: its units and weight (null: unknown), whether it is a service and the engraving (Q2). */
export interface ParcelAddonItem {
  addonId: string;
  name: string;
  units: number;
  weightG: number | null;
  /** A service: its weight counts when it has one, and is never missing (Q2, D4). */
  service: boolean;
  /** The engraving: its packing line is the order's « Engraving done » line (services/parcels.ts checklistOf). */
  engraving: boolean;
}

/**
 * The add-ons each order of a parcel packs (HELD, or SHIPPED once it has gone): by order, one row per add-on with its
 * units and weight (null: unknown), in the order they were added.
 */
export async function parcelAddonItems(db: Db, orderIds: readonly string[]): Promise<Map<string, ParcelAddonItem[]>> {
  const out = new Map<string, ParcelAddonItem[]>();
  for (const u of await unitsOf(db, orderIds, ['HELD', 'SHIPPED'])) {
    const list = out.get(u.order_id) ?? [];
    const row = list.find((x) => x.addonId === u.addon_id);
    if (row) row.units += 1;
    else list.push({ addonId: u.addon_id, name: u.name, units: 1, weightG: u.weight_g, service: u.kind === 'SERVICE', engraving: u.engraving });
    out.set(u.order_id, list);
  }
  return out;
}

/**
 * An order's units as the Shopify order export lists them (not removed), oldest first: name, SKU code, price, and
 * whether it is shipped (a service's is not: Q2, S5).
 */
export async function exportAddonUnits(db: Db, orderIds: readonly string[]): Promise<Map<string, { name: string; skuCode: string; priceMinor: number; shipping: boolean }[]>> {
  const out = new Map<string, { name: string; skuCode: string; priceMinor: number; shipping: boolean }[]>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .selectFrom('order_addon_items as u')
    .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
    .innerJoin('skus as k', 'k.id', 'u.sku_id')
    .select(['u.order_id', 'a.name', 'a.kind', 'k.code', 'u.price_minor'])
    .where('u.order_id', 'in', [...new Set(orderIds)])
    .where('u.status', '<>', 'REMOVED')
    .orderBy('u.added_at')
    .orderBy('u.id')
    .execute();
  for (const r of rows) {
    const list = out.get(r.order_id) ?? [];
    list.push({ name: r.name, skuCode: r.code, priceMinor: r.price_minor, shipping: r.kind !== 'SERVICE' });
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

/**
 * Whether the order's parcel (its first order's shipment, services/parcels.ts openShipment) is PACKED: sealed, its
 * checklist and weight written. A plain read after the order's FOR UPDATE is enough: Packed locks every order of the
 * parcel before it writes PACKED (the logistics lock order, the orders then the shipment).
 */
async function packedShipment(db: Db, o: Pick<OrderRow, 'id' | 'with_order_id'>): Promise<boolean> {
  const s = await db.selectFrom('shipments').select('id').where('order_id', '=', o.with_order_id ?? o.id).where('status', '=', 'PACKED').executeTakeFirst();
  return s !== undefined;
}

/** Staff change an order's add-ons until its parcel is packed (409 PACKING_PACKED). */
async function assertNotPacked(tx: Db, o: Pick<OrderRow, 'id' | 'with_order_id'>): Promise<void> {
  if (await packedShipment(tx, o)) throw parcelPacked();
}

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
 * price in it; the collector's (YOUR ORDERS, Q2.3) its YOUR ORDERS switch on and never the engraving, which has its own
 * ENGRAVING; staff bound by no switch), within ADDON_LIMIT with what the order holds already (409 ADDON_LIMIT; the
 * engraving one), that many available at the order's location (409 ADDON_OUT_OF_STOCK; a service, held nowhere, without
 * lock or count). After PAID, a supplementary invoice of their lines. Returns the units' ids and the audit entries.
 */
async function addUnits(tx: Db, o: OrderRow, addonId: string, units: number, currency: HouseCurrency, by: AddonBy, now: Date): Promise<{ unitIds: string[]; notes: AuditRecordInput[] }> {
  const s = (await standings(tx, [addonId], o.location_id, currency)).get(addonId);
  if (!s) throw addonNotFound();
  const why = notOfferedWhy(s, { moment: by.type === 'COLLECTOR' ? 'ORDERS' : 'STAFF', dropId: null }, `${s.name} is not offered on this order.`);
  if (why !== null) throw addonNotOffered(why);
  if (by.type === 'COLLECTOR' && s.engraving) throw addonNotOffered(`${s.name} is added with its words, in its own section of the order.`);
  if (s.kind === 'PRODUCT') await lockSku(tx, s.skuId);
  const held = (await tx.selectFrom('order_addon_items').select('id').where('order_id', '=', o.id).where('addon_id', '=', addonId).where('status', '=', 'HELD').execute()).length;
  if (s.engraving && held + units > 1) throw engravingLimit(s.name);
  if (held + units > ADDON_LIMIT) throw addonLimit();
  if (s.kind === 'PRODUCT' && (await stockLevel(tx, s.skuId, o.location_id)).available < units) throw addonOutOfStock(s.name);
  return insertUnits(tx, o, s, units, currency, by, now);
}

async function insertUnits(
  tx: Db,
  o: OrderRow,
  s: Pick<AddonStanding, 'addonId' | 'skuId' | 'name' | 'kind'> & { priceMinor: number | null },
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
        // A service's unit is held nowhere (order_addon_items_kind_guard).
        location_id: s.kind === 'SERVICE' ? null : o.location_id,
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

// ── The engraving (lot Q2, step Q2.5) ──────────────────────────────────────

/**
 * The engraving an order carries as a unit (lot Q2, step Q2.5, D4): the unit of the engraving add-on not removed (the
 * latest), its price and currency as sold, who added it (PURCHASE: bought with the order, N5), and the most characters
 * of its add-on's words (`text_max`, N3).
 */
export interface EngravingUnit {
  unitId: string;
  addonId: string;
  name: string;
  status: OrderAddonStatus;
  priceMinor: number;
  currency: HouseCurrency;
  addedBy: OrderAddonAddedBy;
  textMax: number;
}

/** The engraving unit of each order of `orderIds` that carries one, by order id. */
export async function engravingUnits(db: Db, orderIds: readonly string[]): Promise<Map<string, EngravingUnit>> {
  const out = new Map<string, EngravingUnit>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .selectFrom('order_addon_items as u')
    .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
    .select(['u.id', 'u.order_id', 'u.addon_id', 'a.name', 'u.status', 'u.price_minor', 'u.currency', 'u.added_by_type', 'a.text_max'])
    .where('u.order_id', 'in', [...new Set(orderIds)])
    .where('a.engraving', '=', true)
    .where('u.status', '<>', 'REMOVED')
    .orderBy('u.added_at')
    .orderBy('u.id')
    .execute();
  for (const r of rows) {
    out.set(r.order_id, { unitId: r.id, addonId: r.addon_id, name: r.name, status: r.status, priceMinor: r.price_minor, currency: r.currency, addedBy: r.added_by_type, textMax: Number(r.text_max) });
  }
  return out;
}

/** The engraving YOUR ORDERS offers in a currency (lot Q2, step Q2.5): its add-on, SKU, name, price and most characters. */
export interface OrdersEngraving {
  addonId: string;
  skuId: string;
  name: string;
  priceMinor: number;
  textMax: number;
}

/**
 * The engraving YOUR ORDERS offers in `currency` now (lot Q2, step Q2.5, N8, as Orders → Settings' engraving did): the
 * active engraving add-on with its YOUR ORDERS switch on, priced in that currency, whatever an order's release; null
 * otherwise (no engraving offered).
 */
export async function ordersEngraving(db: Db, currency: string | null): Promise<OrdersEngraving | null> {
  if (!isHouseCurrency(currency)) return null;
  const r = await db
    .selectFrom('addon_items as a')
    .innerJoin('skus as k', 'k.addon_id', 'a.id')
    .innerJoin('addon_item_prices as p', (j) => j.onRef('p.addon_id', '=', 'a.id').on('p.currency', '=', currency))
    .select(['a.id', 'k.id as sku_id', 'a.name', 'p.price_minor', 'a.text_max'])
    .where('a.engraving', '=', true)
    .where('a.active', '=', true)
    .where('a.offer_orders', '=', true)
    .executeTakeFirst();
  return r ? { addonId: r.id, skuId: r.sku_id, name: r.name, priceMinor: Number(r.price_minor), textMax: Number(r.text_max) } : null;
}

/**
 * The engraving's unit added to a locked order (lot Q2, step Q2.5): one unit of `e`, held nowhere (a service), at its
 * price in the order's currency; after PAID, its supplementary invoice (its ADD_ON_ITEM line). Returns the audit entries.
 */
export async function addEngravingUnit(tx: Db, o: OrderRow, e: OrdersEngraving, by: AddonBy, now: Date): Promise<AuditRecordInput[]> {
  return (await insertUnits(tx, o, { addonId: e.addonId, skuId: e.skuId, name: e.name, kind: 'SERVICE', priceMinor: e.priceMinor }, 1, o.currency as HouseCurrency, by, now)).notes;
}

/**
 * The engraving's unit `unitId` of a locked order removed (lot Q2, step Q2.5): REMOVED; after PAID, a credit note for its
 * line. Staff remove it only until the parcel is packed (409 PACKING_PACKED). Returns the audit entries.
 */
export async function removeEngravingUnit(tx: Db, o: OrderRow, unitId: string, by: AddonBy, now: Date): Promise<AuditRecordInput[]> {
  if (by.type === 'STAFF') await assertNotPacked(tx, o);
  const units = (await unitsOf(tx, [o.id], ['HELD'])).filter((u) => u.id === unitId);
  return removeUnits(tx, o, units, by, now);
}

/** Staff add an engraving's unit only until the parcel is packed (409 PACKING_PACKED; lot Q2, step Q2.5). */
export async function assertEngravingNotPacked(tx: Db, o: Pick<OrderRow, 'id' | 'with_order_id'>): Promise<void> {
  await assertNotPacked(tx, o);
}

/**
 * The choices of a sale's source carried onto its orders (in the transaction that creates them, the orders just
 * created): a draw's entry and a salon request onto their first order; a LIVE entry (lot Q2, step Q2.4, N1) onto each
 * piece's order, a set's entry onto each set's first piece's order (D25), each order taking the choice's units. Each
 * add-on in `currency`, under its SKU's lock (the SKUs in id order), as many units as are available at the orders'
 * location, given in the orders' order (the rest left out, NONE_LEFT; a service's, all of them, without lock; the
 * engraving one an order), none when it is no longer offered at its moment (NOT_OFFERED: set aside, no longer priced in
 * it, its switch turned off or, at a LIVE hold or a draw's place held, no longer picked by the release; Q2.3) or without
 * a currency; never blocking the sale. The engraving's words chosen with it are written on each order that takes an
 * engraving unit (`engraving_text`, by COLLECTOR, D25), never on another. The choices are then deleted. Returns the
 * units' audit entries and what was left out, for the source's answer and audit entry.
 */
export async function carryChoices(
  tx: Db,
  orders: readonly OrderRow[],
  owner: AddonChoiceOwner,
  currency: HouseCurrency | null,
  actor: Actor,
  now: Date,
): Promise<{ leftOut: LeftOutAddon[]; notes: AuditRecordInput[] }> {
  const [column, ownerId] = ownerOf(owner);
  const leftOut: LeftOutAddon[] = [];
  const notes: AuditRecordInput[] = [];
  const first = orders[0];
  if (!first) return { leftOut, notes };
  const choices = await tx.selectFrom('addon_choices').select(['addon_id', 'units', 'text']).where(column, '=', ownerId).execute();
  if (choices.length === 0) return { leftOut, notes };
  const where = await offerAtOf(tx, owner);
  const found = await standings(tx, choices.map((c) => c.addon_id), first.location_id, currency, where.dropId);
  const by: AddonBy = { type: 'PURCHASE', id: null, actor };
  // The SKUs in one order (two sales carrying the same add-ons never wait for each other).
  const ordered = [...choices].sort((a, b) => (found.get(a.addon_id)?.skuId ?? '').localeCompare(found.get(b.addon_id)?.skuId ?? ''));
  for (const c of ordered) {
    const s = found.get(c.addon_id)!;
    // Each order's units: the choice's, at most ADDON_LIMIT (the engraving one).
    const each = Math.min(c.units, s.engraving ? 1 : ADDON_LIMIT);
    const wanted = c.units * orders.length;
    if (currency === null || notOfferedWhy(s, where, '') !== null) {
      leftOut.push({ addonId: s.addonId, name: s.name, units: wanted, reason: 'NOT_OFFERED' });
      continue;
    }
    // A service has no stock (lot Q2, D4): no lock, as many as chosen.
    if (s.kind === 'PRODUCT') await lockSku(tx, s.skuId);
    let left = s.kind === 'PRODUCT' ? (await stockLevel(tx, s.skuId, first.location_id)).available : Number.POSITIVE_INFINITY;
    let given = 0;
    for (const o of orders) {
      const units = Math.max(0, Math.min(each, left));
      if (units === 0) continue;
      // The engraving's words, on the order that carries its unit (D25), never logged; written first, so that the unit's
      // journal entry carries the order as it now stands.
      if (s.engraving && c.text !== null) {
        await tx.updateTable('orders').set({ engraving_text: c.text, engraving_by: 'COLLECTOR' }).where('id', '=', o.id).execute();
        Object.assign(o, { engraving_text: c.text, engraving_by: 'COLLECTOR' });
      }
      notes.push(...(await insertUnits(tx, o, s, units, currency, by, now)).notes);
      left -= units;
      given += units;
    }
    if (given < wanted) leftOut.push({ addonId: s.addonId, name: s.name, units: wanted - given, reason: 'NONE_LEFT' });
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

/**
 * An order shipped: each unit HELD leaves the ledger with it (SHIPPED, −1, the unit named), under its SKU's lock; a
 * service's unit, held nowhere, is SHIPPED without lock nor movement.
 */
export async function shipUnits(tx: Db, o: OrderRow, actor: Actor, now: Date): Promise<number> {
  const held = await unitsOf(tx, [o.id], ['HELD']);
  const skus = bySku(held);
  for (const skuId of [...skus.keys()].sort()) {
    if (skus.get(skuId)!.units.some((u) => u.location_id !== null)) await lockSku(tx, skuId);
    for (const u of skus.get(skuId)!.units) {
      if (u.location_id !== null) await recordMovement(tx, { skuId, locationId: u.location_id, delta: -1, reason: 'SHIPPED', orderId: o.id, orderAddonItemId: u.id }, actor, now);
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
 * unless named in `out` (not to be sold again: `returned_to_stock` false, no movement). A service's unit comes back
 * RETURNED with no lock and no movement, `returned_to_stock` false (it never held stock). Returns how many came back.
 */
export async function returnUnits(tx: Db, o: OrderRow, r: { keep: boolean; locationId: string | null; out: ReadonlySet<string> }, actor: Actor, now: Date): Promise<{ returned: number; restocked: number }> {
  if (r.keep) return { returned: 0, restocked: 0 };
  const shipped = await unitsOf(tx, [o.id, ...(o.channel === 'EXCHANGE' ? await exchangedFrom(tx, o) : [])], ['SHIPPED']);
  const location = r.locationId ?? o.location_id;
  let restocked = 0;
  const skus = bySku(shipped);
  for (const skuId of [...skus.keys()].sort()) {
    const g = skus.get(skuId)!;
    if (g.units.some((u) => u.kind === 'PRODUCT')) await lockSku(tx, skuId);
    for (const u of g.units) {
      const toStock = u.kind === 'PRODUCT' && !r.out.has(u.id);
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
 * order's cancellation. A service's unit comes back to HELD held nowhere, with no lock, no movement and never short.
 */
export async function reshipUnits(tx: Db, o: OrderRow, r: { cameBack: boolean; reship: boolean }, actor: Actor, now: Date): Promise<{ units: number; short: { addonId: string; name: string; units: number }[] }> {
  if (!r.cameBack && !r.reship) return { units: 0, short: [] };
  const shipped = await unitsOf(tx, [o.id], ['SHIPPED']);
  const skus = bySku(shipped);
  const short: { addonId: string; name: string; units: number }[] = [];
  for (const skuId of [...skus.keys()].sort()) {
    const g = skus.get(skuId)!;
    if (g.units[0]!.kind === 'SERVICE') {
      await tx.updateTable('order_addon_items').set({ status: 'HELD', shipped_at: null }).where('id', 'in', g.units.map((u) => u.id)).execute();
      continue;
    }
    await lockSku(tx, skuId);
    for (const u of g.units) {
      if (r.cameBack && u.location_id !== null) await recordMovement(tx, { skuId, locationId: u.location_id, delta: 1, reason: 'RETURNED', orderId: o.id, orderAddonItemId: u.id }, actor, now);
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
 * ORDER_ADDON_NOT_AT_LOCATION: move the stock first, or remove the add-on). A service's unit, held nowhere, stays as it
 * is. Returns how many moved.
 */
export async function moveUnits(tx: Db, o: OrderRow, toLocationId: string): Promise<number> {
  const moving = (await unitsOf(tx, [o.id], ['HELD'])).filter((u) => u.kind === 'PRODUCT' && u.location_id !== toLocationId);
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
   * in YOUR ORDERS at its location in its currency (their YOUR ORDERS switch alone, whatever the order's release, Q2.3
   * N8; the engraving left out: it has its own ENGRAVING), each with the units it can still take; `canAdd` false with
   * its reason otherwise. Their own order only (404 ORDER_NOT_FOUND).
   */
  async offerForAccount(accountId: string, orderId: string): Promise<AccountAddonOffer> {
    const o = await this.ownOrder(this.db, accountId, orderId);
    const reason = addonWindow(o);
    const currency = isHouseCurrency(o.currency) ? o.currency : null;
    const offer =
      reason === null ? (await addonOffer(this.db, { moment: 'ORDERS', dropId: null, locationId: o.location_id, currency, held: await heldByAddon(this.db, o.id) })).filter((a) => !a.engraving) : [];
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
   * order, until packing starts (404 ADDON_NOT_FOUND when it holds none; the engraving's, removed with its words in the
   * order's ENGRAVING, lot Q2, step Q2.5, among them). After PAID, a credit note for their lines. Audited
   * `order.addon.remove` by the account.
   */
  async removeForAccount(accountId: string, orderId: string, addonId: string, actor: Actor): Promise<string> {
    if (typeof addonId !== 'string' || !UUID_RE.test(addonId)) throw unitNotFound();
    await inRetriedTransaction(this.db, async (tx) => {
      await this.activeAccount(tx, accountId);
      const o = await this.ownOrder(tx, accountId, orderId, { forUpdate: true });
      const why = removalWindow(o);
      if (why !== null) throw windowError(why);
      // The engraving's unit is removed in the order's ENGRAVING, with its words (lot Q2, step Q2.5).
      const units = (await unitsOf(tx, [o.id], ['HELD'])).filter((u) => u.addon_id === addonId.toLowerCase() && !u.engraving);
      if (units.length === 0) throw unitNotFound();
      const notes = await removeUnits(tx, o, units, { type: 'COLLECTOR', id: o.account_id, actor }, this.clock());
      for (const n of notes) await this.audit.record(n, tx);
    });
    return orderId.toLowerCase();
  }

  /**
   * Add an add-on (POST /api/admin/orders/:id/addons, OPERATOR): `units` of it on any order RESERVED or PAID (409
   * ORDER_CLOSED once shipped or ended), packing begun or not, until its parcel is packed (409 PACKING_PACKED); never
   * on a welcome gift, a size exchange nor a Shopify order (409 ADDON_NOT_OFFERED), its currency entered. Audited
   * `order.addon.add` by the admin.
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
      await assertNotPacked(tx, o);
      const done = await addUnits(tx, o, item!.addonId, item!.units, o.currency as HouseCurrency, { type: 'STAFF', id: adminId, actor }, this.clock());
      for (const n of done.notes) await this.audit.record(n, tx);
    });
  }

  /**
   * Remove one unit (DELETE /api/admin/orders/:id/addons/:lineId, OPERATOR): a unit HELD of the order (404
   * ADDON_NOT_FOUND otherwise), on an order RESERVED or PAID (409 ORDER_CLOSED) until its parcel is packed (409
   * PACKING_PACKED). After PAID, a credit note for its line. Audited `order.addon.remove` by the admin.
   */
  async removeForStaff(orderId: string, unitId: string, actor: Actor): Promise<void> {
    const adminId = this.staff(actor);
    const id = this.knownOrder(orderId);
    if (typeof unitId !== 'string' || !UUID_RE.test(unitId)) throw unitNotFound();
    await inRetriedTransaction(this.db, async (tx) => {
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!o) throw orderNotFound();
      if (!ORDER_HOLDING_STATUSES.includes(o.status)) throw orderClosed();
      await assertNotPacked(tx, o);
      const unit = (await unitsOf(tx, [o.id], ['HELD'])).find((u) => u.id === unitId.toLowerCase());
      if (!unit) throw unitNotFound();
      const notes = await removeUnits(tx, o, [unit], { type: 'STAFF', id: adminId, actor }, this.clock());
      for (const n of notes) await this.audit.record(n, tx);
    });
  }

  /**
   * The add-ons offered at a location in a currency now, as the console's Add an add-on dialog lists them for an order
   * (staff bound by no switch and no pick, Q2.3: every active add-on priced in its currency, the engraving included);
   * none once its parcel is packed (`PACKED`).
   */
  async offerForStaff(orderId: string): Promise<StaffAddonOffer> {
    const id = this.knownOrder(orderId);
    const o = await this.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirst();
    if (!o) throw orderNotFound();
    const why = addonWindow(o);
    const open = why === null || why === 'PACKING_STARTED';
    const reason: StaffAddonOffer['reason'] = !open ? why : (await packedShipment(this.db, o)) ? 'PACKED' : null;
    const currency = isHouseCurrency(o.currency) ? o.currency : null;
    const offer = reason === null ? await addonOffer(this.db, { moment: 'STAFF', dropId: null, locationId: o.location_id, currency, held: await heldByAddon(this.db, o.id) }) : [];
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
