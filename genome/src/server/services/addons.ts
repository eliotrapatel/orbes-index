/**
 * The add-ons' catalogue (macro scope of 2026-10-20, K48 D1; lot M3 plan §4.1 and §4.2, step M3.9; migration 0056): a
 * care kit, a polishing cloth, a chain extender, a spare strap, a travel pouch, and any other the owner adds. Each is a
 * catalogue item with real stock, sold with a piece (services/order-addons.ts, M3.10): no ORBES CODE, no identity, never
 * a product row, never registered, never counted toward the tier.
 *
 *   an add-on    its name as the collector reads it (1 to 40 characters, one line, unique whatever the case: 409
 *                ADDON_NAME_TAKEN), its line (at most 120 characters, one line; none), its supplier (a supplier of the
 *                house: 404 SUPPLIER_NOT_FOUND; none), its weight (1 to 30 000 g, for the parcel's weight; unknown),
 *                the order it is offered in (`position`, 0 to 10 000; after the last by default) and `active`.
 *   its SKU      one per add-on, created with it (`skus.addon_id`, no size, no fit): its code given by staff at the
 *                creation and never changed (2 to 64 capitals, digits and hyphens, starting with a capital or a digit;
 *                unique among every SKU, a model's sizes included: 409 SKU_CODE_TAKEN). A colour or a length is an
 *                add-on of its own. The SKU is the add-on's stock: the same ledger as the pieces (stock_movements),
 *                its minimums per location, its supplier orders and receptions (counted in without identity), named
 *                by the add-on wherever SKUs are listed (services/sku-owner.ts).
 *   its prices   one per house currency (EUR, GBP, USD, CHF), 0 to 1 000 000.00 in minor units, as the engraving's:
 *                without a price in a currency, it is not offered in it (`setPrices`; null removes one).
 *   set aside    `setAside` (active false): offered nowhere again (no order, no minimum, no supplier order: 409
 *                ADDON_SET_ASIDE), its stock, its units on orders and its history kept; `reinstate` offers it again.
 *                Never deleted.
 *   Shopify      (S5) one Shopify product per add-on with one variant: `setShopify` keeps the ids pasted back from
 *                Shopify's admin, the product on the add-on (`addon_items.shopify_product_id`, once) and on its SKU,
 *                the variant on its SKU (`skus.shopify_variant_id`, once); a product another add-on, a model or a set
 *                (macro scope K44) is linked to answers 409 SHOPIFY_PRODUCT_TAKEN, a variant another SKU has 409 SHOPIFY_VARIANT_TAKEN. The
 *                product export lists each active add-on (services/shopify.ts).
 *   available    `availableAt(location, currency)`: the active add-ons priced in that currency with at least one
 *                available at that location now (on hand less what is held: `stock_holds`), in their order; a service
 *                always (no count).
 *
 * ADD-ONS ONE SYSTEM (lot Q2, step Q2.2; migration 0059; ANSWERS CURRENT STATE D):
 *   its kind     PRODUCT (the default: everything above, M3's add-on with real stock, kept whole) or SERVICE (an
 *                engraving, a gift wrapping: a price and a product, no stock count, no supplier, no warehouse), given
 *                at the creation and never changed (409 ADDON_KIND_FIXED: set one aside and create the other). A
 *                service names no supplier (400), lists no stock (`stock` []) and its SKU takes none (409 ADDON_SERVICE
 *                wherever a SKU takes stock, services/sku-owner.ts); its SKU keeps its code and its Shopify variant (S5).
 *   offered at   four switches, all on by default (every M3 add-on was offered at all four): a LIVE RELEASE's purchase,
 *                a draw's, the private salon's, and YOUR ORDERS until packing (`offeredAt`).
 *   engraving    a service only (400 otherwise): the add-on whose collector types the words engraved on the piece; one
 *                active at a time (409 ADDON_ENGRAVING_TAKEN, at its creation, its change and its reinstatement). Its
 *                most characters `textMax`, 1 to 20 (20, the house's, by default), is the engraving's only (400 for any
 *                other value on another add-on; an add-on that stops being the engraving goes back to 20).
 *   releases     how many releases not ended pick it (drop_addons); `convertedFrom`, what it was converted from
 *                (addon_conversions, migration 0060; none before it).
 *
 * OPERATOR writes (as the models), AUDITOR reads (routes/admin/addons.ts). Audited `addon.create`, `addon.update` (each
 * field before and after), `addon.prices` (each currency before and after), `addon.set_aside`, `addon.reinstate`,
 * `addon.shopify` (the ids before and after); a change that changes nothing writes nothing. Nothing here is read by a
 * collector: the collector reads an add-on's name, line and price in its order's currency through the order flows.
 */
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  ADDON_KINDS,
  ADDON_LINE_MAX,
  ADDON_NAME_MAX,
  ADDON_POSITION_MAX,
  ADDON_PRICE_MINOR_MAX,
  ADDON_TEXT_MAX,
  ADDON_UNITS_MAX,
  ADDON_WEIGHT_G_MAX,
  HOUSE_CURRENCIES,
  type AddonKind,
  type HouseCurrency,
  type JsonObject,
} from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { lockKeyOf, shopifyIdOf, shopifyProductTaken } from './shopify.js';
import { knownLocation } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** An add-on SKU's code: 2 to 64 capitals, digits and hyphens, a capital or a digit first (skus.code, unique). */
export const ADDON_SKU_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,63}$/;

export const ADDON_LIMITS = Object.freeze({
  name: ADDON_NAME_MAX,
  line: ADDON_LINE_MAX,
  weightG: ADDON_WEIGHT_G_MAX,
  position: ADDON_POSITION_MAX,
  priceMinor: ADDON_PRICE_MINOR_MAX,
  /** The units of one add-on on one order, at most (M3.10). */
  units: ADDON_UNITS_MAX,
  skuCode: 64,
  /** The engraving's most characters (Q2, D12/N3): 1 to 20, 20 by default. */
  textMax: ADDON_TEXT_MAX,
});

/** The moments an add-on is offered at (migration 0059, D3), in the order the console lists them. */
export const ADDON_MOMENTS = ['live', 'draw', 'salon', 'orders'] as const;
export type AddonMoment = (typeof ADDON_MOMENTS)[number];
/** Its switches: a LIVE RELEASE's purchase, a draw's, the private salon's, YOUR ORDERS until packing. */
export type AddonOfferedAt = Record<AddonMoment, boolean>;
const MOMENT_COLUMN = { live: 'offer_live', draw: 'offer_draw', salon: 'offer_salon', orders: 'offer_orders' } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// ── Errors ─────────────────────────────────────────────────────────────────

export const addonNotFound = () => notFound('Add-on', 'ADDON_NOT_FOUND');
const addonNameTaken = () => conflict('ADDON_NAME_TAKEN', 'Another add-on has this name.');
const skuCodeTaken = () => conflict('SKU_CODE_TAKEN', 'Another SKU has this code.');
const supplierNotFound = () => notFound('Supplier', 'SUPPLIER_NOT_FOUND');
const variantTaken = () => conflict('SHOPIFY_VARIANT_TAKEN', 'Another size or add-on already has this Shopify variant id.');
/** 409 ADDON_ENGRAVING_TAKEN: one engraving offered at a time (`addon_items_engraving_key`). */
const engravingTaken = () => conflict('ADDON_ENGRAVING_TAKEN', 'Another add-on is the engraving: set it aside, or make it another service, first.');
/** 409 ADDON_KIND_FIXED: a product stays a product, a service a service (N13). */
const kindFixed = () => conflict('ADDON_KIND_FIXED', 'An add-on’s type never changes: set this one aside and create the other.');
const serviceSupplier = () => validationError('A service has no supplier: it holds no stock.');
const engravingNotService = () => validationError('Only a service can be the engraving.');
const textMaxNotEngraving = () => validationError('Only the engraving has a most characters.');

// ── Views ──────────────────────────────────────────────────────────────────

/** An add-on's price in a house currency, in minor units. */
export interface AddonPrice {
  currency: HouseCurrency;
  priceMinor: number;
}

/** An add-on's stock at a location (every location listed, 0 included). */
export interface AddonStock {
  location: { id: string; name: string; isDefault: boolean };
  onHand: number;
  /** The units held on orders (`stock_holds`). */
  reserved: number;
  available: number;
  minimum: number | null;
}

/** What an add-on was converted from (addon_conversions, migration 0060): a release's add-ons, or Orders → Settings' engraving. */
export interface AddonConversion {
  source: 'LIVE_ADDON' | 'ENGRAVING_PRICES';
  /** The release whose add-on it was; null for the settings' engraving. */
  release: { id: string; title: string } | null;
  convertedAt: Date;
}

/** An add-on as Catalogue → Add-ons reads it (AUDITOR and above). */
export interface AddonView {
  id: string;
  /** PRODUCT (real stock) or SERVICE (none), fixed at its creation. */
  kind: AddonKind;
  name: string;
  line: string | null;
  supplier: { id: string; name: string; active: boolean } | null;
  weightG: number | null;
  position: number;
  active: boolean;
  /** Its SKU: its code and its Shopify variant. */
  sku: { id: string; code: string; shopifyVariantId: string | null };
  shopifyProductId: string | null;
  /** Its prices, in the house currencies' order (EUR, GBP, USD, CHF); a currency without one is absent. */
  prices: AddonPrice[];
  /** Its stock per location, the default first, then by name; none for a service. */
  stock: AddonStock[];
  /** Where it is offered (its four switches). */
  offeredAt: AddonOfferedAt;
  /** The engraving (a service; one active at a time), whose collector types the words. */
  engraving: boolean;
  /** The engraving's most characters, 1 to 20 (20 on every other add-on). */
  textMax: number;
  /** How many releases not ended pick it (a LIVE RELEASE, its after-room, a draw). */
  releases: number;
  /** What it was converted from (migration 0060), oldest first; none for an add-on staff created. */
  convertedFrom: AddonConversion[];
  createdAt: Date;
  updatedAt: Date;
}

/** What an add-on is created with (`skuCode` and `prices` at the creation only) or changed with; `undefined` leaves a field. */
export interface AddonInput {
  name?: string;
  line?: string | null;
  supplierId?: string | null;
  weightG?: number | null;
  position?: number;
  /** Its switches (those given; the others left, all on at the creation). */
  offeredAt?: Partial<AddonOfferedAt>;
  /** The engraving (a service only). */
  engraving?: boolean;
  /** The engraving's most characters, 1 to 20. */
  textMax?: number;
  /** Given at the creation only; on a change, 409 ADDON_KIND_FIXED unless it is the add-on's own. */
  kind?: AddonKind;
}

export interface AddonCreateInput extends AddonInput {
  name: string;
  skuCode: string;
  /** Its prices per house currency (none given: not offered yet). */
  prices?: Partial<Record<HouseCurrency, number | null>>;
}

/** An add-on offered at a location in a currency (`availableAt`). */
export interface AvailableAddon {
  addonId: string;
  skuId: string;
  name: string;
  line: string | null;
  currency: HouseCurrency;
  priceMinor: number;
  /** Units available there now (≥ 1); null for a service (no count: always available). */
  available: number | null;
  weightG: number | null;
  kind: AddonKind;
}

type AddonColumns = {
  name?: string;
  line?: string | null;
  supplier_id?: string | null;
  weight_g?: number | null;
  position?: number;
  offer_live?: boolean;
  offer_draw?: boolean;
  offer_salon?: boolean;
  offer_orders?: boolean;
  engraving?: boolean;
  text_max?: number;
};

/** The fields of an add-on and their columns, in the order an audit entry lists them. */
const FIELDS = [
  ['name', 'name'],
  ['line', 'line'],
  ['supplierId', 'supplier_id'],
  ['weightG', 'weight_g'],
  ['position', 'position'],
  ['engraving', 'engraving'],
  ['textMax', 'text_max'],
] as const;
/** The switches' columns, audited together as `offeredAt`. */
const MOMENT_COLUMNS = ADDON_MOMENTS.map((m) => MOMENT_COLUMN[m]);

// ── Checking ───────────────────────────────────────────────────────────────

/** One line of text: trimmed, runs of spaces kept to one, 1 to `max` characters. */
function oneLine(v: unknown, max: number, label: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError(`${label} is required.`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if ([...s].length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

function whole(v: unknown, min: number, max: number, label: string, unit: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw validationError(`${label} is a whole number of ${unit}, ${min} to ${max.toLocaleString('en-US')}.`);
  return v;
}

function knownId(v: unknown, missing: () => Error): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw missing();
  return v.toLowerCase();
}

/** An add-on SKU's code as staff type it: trimmed, in capitals (ADDON_SKU_CODE_RE). */
export function cleanSkuCode(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError('The SKU code is required.');
  const code = v.trim().toUpperCase();
  if (!ADDON_SKU_CODE_RE.test(code)) throw validationError('The SKU code is 2 to 64 capitals, digits and hyphens, starting with a capital or a digit.');
  return code;
}

/** The columns an input sets, checked; only the fields given (the name required when creating). */
function columnsOf(input: AddonInput, creating: boolean): AddonColumns {
  const out: AddonColumns = {};
  if (creating || input.name !== undefined) out.name = oneLine(input.name, ADDON_NAME_MAX, 'The name');
  if (input.line !== undefined) out.line = input.line === null || (typeof input.line === 'string' && input.line.trim() === '') ? null : oneLine(input.line, ADDON_LINE_MAX, 'The line');
  if (input.supplierId !== undefined) out.supplier_id = input.supplierId === null ? null : knownId(input.supplierId, supplierNotFound);
  if (input.weightG !== undefined) out.weight_g = input.weightG === null ? null : whole(input.weightG, 1, ADDON_WEIGHT_G_MAX, 'The weight', 'grams');
  if (input.position !== undefined) out.position = whole(input.position, 0, ADDON_POSITION_MAX, 'The position', 'places');
  if (input.offeredAt !== undefined) {
    if (input.offeredAt === null || typeof input.offeredAt !== 'object' || Array.isArray(input.offeredAt)) throw validationError('Give where it is offered as LIVE, draw, salon and YOUR ORDERS switches.');
    for (const [moment, on] of Object.entries(input.offeredAt)) {
      if (on === undefined) continue;
      if (!(ADDON_MOMENTS as readonly string[]).includes(moment)) throw validationError(`An add-on is offered at ${ADDON_MOMENTS.join(', ')}.`);
      if (typeof on !== 'boolean') throw validationError('Each switch is on or off.');
      out[MOMENT_COLUMN[moment as AddonMoment]] = on;
    }
  }
  if (input.engraving !== undefined) {
    if (typeof input.engraving !== 'boolean') throw validationError('The engraving is on or off.');
    out.engraving = input.engraving;
  }
  if (input.textMax !== undefined) out.text_max = whole(input.textMax, ADDON_TEXT_MAX.min, ADDON_TEXT_MAX.max, 'The most characters', 'characters');
  return out;
}

/** A kind as staff give it: PRODUCT or SERVICE (PRODUCT when none is given). */
function kindOf(v: unknown): AddonKind {
  if (v === undefined) return 'PRODUCT';
  if (typeof v !== 'string' || !(ADDON_KINDS as readonly string[]).includes(v)) throw validationError(`An add-on is a ${ADDON_KINDS.join(' or a ')}.`);
  return v as AddonKind;
}

/**
 * An add-on's rules on its columns as they will stand (`kind` fixed): a service names no supplier (400), only a service
 * is the engraving (400), and a most characters other than 20 belongs to the engraving only (400).
 */
function assertKindRules(kind: AddonKind, after: { supplier_id: string | null; engraving: boolean; text_max: number }): void {
  if (kind === 'SERVICE' && after.supplier_id !== null) throw serviceSupplier();
  if (after.engraving && kind !== 'SERVICE') throw engravingNotService();
  if (!after.engraving && after.text_max !== ADDON_TEXT_MAX.max) throw textMaxNotEngraving();
}

/** A release not ended (a LIVE RELEASE or its after-room not ended; a draw not drawn yet or within its place-held window), not cancelled. */
export const releaseNotEnded = (d: string, now: Date) =>
  sql<boolean>`(${sql.ref(`${d}.cancelled_at`)} IS NULL AND CASE WHEN ${sql.ref(`${d}.mode`)} = 'LIVE' THEN ${sql.ref(`${d}.ended_at`)} IS NULL
     ELSE (${sql.ref(`${d}.drawn_at`)} IS NULL OR ${sql.ref(`${d}.drawn_at`)} + make_interval(hours => ${sql.ref(`${d}.purchase_window_hours`)}) > ${now}) END)`;

/** Prices per currency, checked: a house currency each, 0 to ADDON_PRICE_MINOR_MAX minor units, or null (none). */
function cleanPrices(prices: unknown): [HouseCurrency, number | null][] {
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) throw validationError('Give the prices by currency.');
  const out: [HouseCurrency, number | null][] = [];
  for (const [currency, price] of Object.entries(prices as Record<string, unknown>)) {
    if (price === undefined) continue;
    if (!(HOUSE_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`A price is in ${HOUSE_CURRENCIES.join(', ')}.`);
    out.push([currency as HouseCurrency, price === null ? null : whole(price, 0, ADDON_PRICE_MINOR_MAX, `The price in ${currency}`, 'cents')]);
  }
  return out.sort((a, b) => HOUSE_CURRENCIES.indexOf(a[0]) - HOUSE_CURRENCIES.indexOf(b[0]));
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only ORBES staff can change the add-ons.');
}

const adminIdOf = (actor: Actor): string | null => (actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null);

// ── Reads shared with the order flows ──────────────────────────────────────

/**
 * The active add-ons priced in `currency` with at least one available at `locationId` now (on hand less the holds of
 * `stock_holds`), in the order they are offered (position, then name); a service always (no count: `available` null).
 * Read in `db` (a transaction under the SKUs' locks when a decision depends on it).
 */
export async function availableAddons(db: Db, locationId: string, currency: HouseCurrency): Promise<AvailableAddon[]> {
  const rows = await sql<{ addon_id: string; sku_id: string; name: string; line: string | null; price_minor: number; weight_g: number | null; available: number; kind: AddonKind }>`
    SELECT a.id AS addon_id, k.id AS sku_id, a.name, a.line, p.price_minor, a.weight_g, a.kind,
           (coalesce((SELECT sum(m.delta) FROM stock_movements m WHERE m.sku_id = k.id AND m.location_id = ${locationId}::uuid), 0)
            - (SELECT count(*) FROM stock_holds h WHERE h.sku_id = k.id AND h.location_id = ${locationId}::uuid AND h.reservation = 'STOCK'))::int AS available
      FROM addon_items a
      JOIN skus k ON k.addon_id = a.id
      JOIN addon_item_prices p ON p.addon_id = a.id AND p.currency = ${currency}
     WHERE a.active
     ORDER BY a.position, lower(a.name), a.id`.execute(db);
  return rows.rows
    .filter((r) => r.kind === 'SERVICE' || Number(r.available) >= 1)
    .map((r) => ({
      addonId: r.addon_id,
      skuId: r.sku_id,
      name: r.name,
      line: r.line,
      currency,
      priceMinor: Number(r.price_minor),
      available: r.kind === 'SERVICE' ? null : Number(r.available),
      weightG: r.weight_g,
      kind: r.kind,
    }));
}

// ── The service ────────────────────────────────────────────────────────────

export interface AddonServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class AddonService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: AddonServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** Every add-on: the active ones first, each in its order (position, then name) (GET /api/admin/addons, AUDITOR). */
  list(): Promise<AddonView[]> {
    return this.rows();
  }

  /** One add-on (404 ADDON_NOT_FOUND). */
  async get(addonId: string): Promise<AddonView> {
    const row = (await this.rows(knownId(addonId, addonNotFound)))[0];
    if (!row) throw addonNotFound();
    return row;
  }

  /**
   * An add-on listed with its SKU (POST /api/admin/addons, OPERATOR): its kind (PRODUCT by default; SERVICE), its fields
   * checked, its supplier known (404 SUPPLIER_NOT_FOUND; none on a service: 400), its name free (409 ADDON_NAME_TAKEN),
   * its SKU code free among every SKU (409 SKU_CODE_TAKEN), its switches (all on by default), the engraving (a service;
   * 409 ADDON_ENGRAVING_TAKEN when another active one exists) and its most characters (1 to 20, 20 by default, the
   * engraving's only), its prices when given. Audited `addon.create` with its kind, name, SKU, supplier, weight,
   * position, switches, engraving, most characters and prices.
   */
  async create(input: AddonCreateInput, actor: Actor): Promise<AddonView> {
    assertStaff(actor);
    const kind = kindOf(input?.kind);
    const c = columnsOf(input ?? ({} as AddonCreateInput), true);
    const offeredAt = Object.fromEntries(ADDON_MOMENTS.map((m) => [m, c[MOMENT_COLUMN[m]] ?? true])) as AddonOfferedAt;
    const engraving = c.engraving ?? false;
    const textMax = c.text_max ?? ADDON_TEXT_MAX.max;
    assertKindRules(kind, { supplier_id: c.supplier_id ?? null, engraving, text_max: textMax });
    const code = cleanSkuCode(input?.skuCode);
    const prices = input?.prices === undefined ? [] : cleanPrices(input.prices).filter((p): p is [HouseCurrency, number] => p[1] !== null);
    const id = await this.taken(() =>
      inTransaction(this.db, async (tx) => {
        const now = this.clock();
        if (c.supplier_id) await this.knownSupplier(tx, c.supplier_id);
        // After the last by default.
        const position =
          c.position ?? Math.min(ADDON_POSITION_MAX, Number((await tx.selectFrom('addon_items').select((eb) => eb.fn.max('position').as('p')).executeTakeFirst())?.p ?? -1) + 1);
        const row = await tx
          .insertInto('addon_items')
          .values({
            kind,
            name: c.name!,
            line: c.line ?? null,
            supplier_id: c.supplier_id ?? null,
            weight_g: c.weight_g ?? null,
            position,
            offer_live: offeredAt.live,
            offer_draw: offeredAt.draw,
            offer_salon: offeredAt.salon,
            offer_orders: offeredAt.orders,
            engraving,
            text_max: textMax,
            created_by: adminIdOf(actor),
            created_at: now,
            updated_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const sku = await tx.insertInto('skus').values({ addon_id: row.id, model_id: null, size_label: null, code, created_at: now }).returning('id').executeTakeFirstOrThrow();
        if (prices.length > 0) {
          await tx
            .insertInto('addon_item_prices')
            .values(prices.map(([currency, price_minor]) => ({ addon_id: row.id, currency, price_minor, updated_by: adminIdOf(actor), updated_at: now })))
            .execute();
        }
        const details: JsonObject = {
          kind,
          name: c.name!,
          skuId: sku.id,
          skuCode: code,
          supplierId: c.supplier_id ?? null,
          weightG: c.weight_g ?? null,
          position,
          offeredAt,
          engraving,
          textMax,
          prices: Object.fromEntries(prices),
        };
        await this.audit.record({ actor, action: 'addon.create', targetType: 'addon', targetId: row.id, details }, tx);
        return row.id;
      }),
    );
    return this.get(id);
  }

  /**
   * An add-on changed (PATCH /api/admin/addons/:id, OPERATOR): its name, line, supplier, weight, position, switches,
   * engraving and most characters, under its row lock; its SKU code never changes, nor its kind (409 ADDON_KIND_FIXED
   * for another kind than its own). The kind's rules hold on the result (a service names no supplier, only a service
   * is the engraving, a most characters other than 20 is the engraving's only: 400); an add-on that stops being the
   * engraving goes back to 20; one becoming the engraving while another active one is: 409 ADDON_ENGRAVING_TAKEN. A unit
   * already on an order keeps its price. Audited `addon.update` with each field changed, before and after (the switches
   * together as `offeredAt`); nothing changed, nothing written.
   */
  async update(addonId: string, input: AddonInput, actor: Actor): Promise<AddonView> {
    assertStaff(actor);
    const id = knownId(addonId, addonNotFound);
    const askedKind = input?.kind === undefined ? undefined : kindOf(input.kind);
    const c = columnsOf(input ?? {}, false);
    if (Object.keys(c).length === 0 && askedKind === undefined) throw validationError('Nothing to change.');
    await this.taken(() =>
      inTransaction(this.db, async (tx) => {
        const before = await tx.selectFrom('addon_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!before) throw addonNotFound();
        if (askedKind !== undefined && askedKind !== before.kind) throw kindFixed();
        // No longer the engraving: its most characters goes back to the house's 20, unless given.
        if (c.engraving === false && before.engraving && c.text_max === undefined) c.text_max = ADDON_TEXT_MAX.max;
        const after = { ...before, ...c };
        assertKindRules(before.kind, { supplier_id: after.supplier_id, engraving: after.engraving, text_max: after.text_max });
        const changed = FIELDS.filter(([, column]) => column in c && c[column] !== before[column]);
        const switches = MOMENT_COLUMNS.filter((column) => column in c && c[column] !== before[column]);
        if (changed.length === 0 && switches.length === 0) return;
        if (c.supplier_id) await this.knownSupplier(tx, c.supplier_id);
        await tx
          .updateTable('addon_items')
          .set({ ...Object.fromEntries([...changed.map(([, column]) => column), ...switches].map((column) => [column, c[column]])), updated_at: this.clock() })
          .where('id', '=', id)
          .execute();
        const details: JsonObject = {};
        for (const [field, column] of changed) details[field] = { from: before[column], to: c[column] ?? null };
        if (switches.length > 0) {
          const of = (row: Pick<typeof before, (typeof MOMENT_COLUMNS)[number]>) => Object.fromEntries(ADDON_MOMENTS.map((m) => [m, row[MOMENT_COLUMN[m]]]));
          details.offeredAt = { from: of(before), to: of(after) };
        }
        await this.audit.record({ actor, action: 'addon.update', targetType: 'addon', targetId: id, details }, tx);
      }),
    );
    return this.get(id);
  }

  /**
   * An add-on's prices (PUT /api/admin/addons/:id/prices, OPERATOR): each currency given set (0 to 1 000 000.00) or
   * removed (null: not offered in it), the others left. A unit already on an order keeps its price. Audited
   * `addon.prices` with each currency changed, before and after; nothing changed, nothing written.
   */
  async setPrices(addonId: string, prices: Partial<Record<HouseCurrency, number | null>>, actor: Actor): Promise<AddonView> {
    assertStaff(actor);
    const id = knownId(addonId, addonNotFound);
    const given = cleanPrices(prices);
    if (given.length === 0) throw validationError('Give at least one price, or null to remove one.');
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const a = await tx.selectFrom('addon_items').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!a) throw addonNotFound();
      const before = new Map((await tx.selectFrom('addon_item_prices').select(['currency', 'price_minor']).where('addon_id', '=', id).execute()).map((p) => [p.currency, p.price_minor]));
      const details: JsonObject = {};
      for (const [currency, price] of given) {
        const was = before.get(currency) ?? null;
        if (was === price) continue;
        if (price === null) await tx.deleteFrom('addon_item_prices').where('addon_id', '=', id).where('currency', '=', currency).execute();
        else
          await tx
            .insertInto('addon_item_prices')
            .values({ addon_id: id, currency, price_minor: price, updated_by: adminIdOf(actor), updated_at: now })
            .onConflict((oc) => oc.columns(['addon_id', 'currency']).doUpdateSet({ price_minor: price, updated_by: adminIdOf(actor), updated_at: now }))
            .execute();
        details[currency] = { from: was, to: price };
      }
      if (Object.keys(details).length === 0) return;
      await tx.updateTable('addon_items').set({ updated_at: now }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: 'addon.prices', targetType: 'addon', targetId: id, details }, tx);
    });
    return this.get(id);
  }

  /**
   * An add-on set aside (POST /api/admin/addons/:id/set-aside, OPERATOR): offered nowhere again (no order, no minimum,
   * no supplier order); its stock, its units on orders and its history stay. Audited `addon.set_aside`; one already set
   * aside: nothing written.
   */
  setAside(addonId: string, actor: Actor): Promise<AddonView> {
    return this.setActive(addonId, false, actor);
  }

  /**
   * An add-on offered again (POST /api/admin/addons/:id/reinstate, OPERATOR); the engraving while another active one is:
   * 409 ADDON_ENGRAVING_TAKEN. Audited `addon.reinstate`; one active: nothing written.
   */
  reinstate(addonId: string, actor: Actor): Promise<AddonView> {
    return this.taken(() => this.setActive(addonId, true, actor));
  }

  /**
   * The Shopify ids pasted back (PUT /api/admin/addons/:id/shopify, OPERATOR; S5): its product (on the add-on and its
   * SKU) and its variant (on its SKU), each the number or its page's address; null clears one, a variant needs its
   * product (400). Under the add-on's row lock, then the product's advisory lock (the one a model's link takes): 409
   * SHOPIFY_PRODUCT_TAKEN when another add-on or a model has that product, 409 SHOPIFY_VARIANT_TAKEN when another SKU has
   * that variant. Audited `addon.shopify` with the ids before and after; nothing changed, nothing written.
   */
  async setShopify(addonId: string, input: { productId: string | null; variantId: string | null }, actor: Actor): Promise<AddonView> {
    assertStaff(actor);
    const id = knownId(addonId, addonNotFound);
    if (input === null || typeof input !== 'object') throw validationError('Send the product id and the variant id.');
    const productId = shopifyIdOf(input.productId, 'products');
    const variantId = shopifyIdOf(input.variantId, 'variants');
    if (productId === null && variantId !== null) throw validationError('A variant id is given with its product id.');
    try {
      await inTransaction(this.db, async (tx) => {
        const a = await tx.selectFrom('addon_items').select(['id', 'shopify_product_id']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!a) throw addonNotFound();
        const sku = await tx.selectFrom('skus').select(['id', 'shopify_variant_id']).where('addon_id', '=', id).forNoKeyUpdate().executeTakeFirstOrThrow();
        if (a.shopify_product_id === productId && sku.shopify_variant_id === variantId) return;
        if (productId !== null) {
          await advisoryXactLock(tx, ADVISORY_LOCK.SHOPIFY_PRODUCT, lockKeyOf(productId));
          const model = await tx.selectFrom('skus').select('id').where('shopify_product_id', '=', productId).where('id', '<>', sku.id).executeTakeFirst();
          const other = await tx.selectFrom('addon_items').select('id').where('shopify_product_id', '=', productId).where('id', '<>', id).executeTakeFirst();
          // Macro scope K44 T1 (S5): a set's product is its own too.
          const set = await tx.selectFrom('sets').select('id').where('shopify_product_id', '=', productId).executeTakeFirst();
          if (model || other || set) throw shopifyProductTaken();
        }
        await tx.updateTable('addon_items').set({ shopify_product_id: productId, updated_at: this.clock() }).where('id', '=', id).execute();
        await tx.updateTable('skus').set({ shopify_product_id: productId, shopify_variant_id: variantId }).where('id', '=', sku.id).execute();
        await this.audit.record(
          { actor, action: 'addon.shopify', targetType: 'addon', targetId: id, details: { product: { from: a.shopify_product_id, to: productId }, variant: { from: sku.shopify_variant_id, to: variantId } } },
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e, 'skus_shopify_variant_key')) throw variantTaken();
      if (isUniqueViolation(e, 'addon_items_shopify_product_key')) throw shopifyProductTaken();
      throw e;
    }
    return this.get(id);
  }

  /**
   * The add-ons offered at a location in a currency now (availableAddons): active, priced in it, at least one available
   * there. 404 STOCK_LOCATION_NOT_FOUND; 400 for a currency the house does not sell in.
   */
  async availableAt(locationId: string, currency: string): Promise<AvailableAddon[]> {
    const loc = await knownLocation(this.db, locationId);
    if (!(HOUSE_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`The currency is one of ${HOUSE_CURRENCIES.join(', ')}.`);
    return availableAddons(this.db, loc, currency as HouseCurrency);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async setActive(addonId: string, active: boolean, actor: Actor): Promise<AddonView> {
    assertStaff(actor);
    const id = knownId(addonId, addonNotFound);
    await inTransaction(this.db, async (tx) => {
      const before = await tx.selectFrom('addon_items').select(['active', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw addonNotFound();
      if (before.active === active) return;
      await tx.updateTable('addon_items').set({ active, updated_at: this.clock() }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: active ? 'addon.reinstate' : 'addon.set_aside', targetType: 'addon', targetId: id, details: { name: before.name } }, tx);
    });
    return this.get(id);
  }

  /** A supplier of the house, held FOR SHARE (404 SUPPLIER_NOT_FOUND). */
  private async knownSupplier(tx: Db, supplierId: string): Promise<void> {
    const s = await tx.selectFrom('suppliers').select('id').where('id', '=', supplierId).forShare().executeTakeFirst();
    if (!s) throw supplierNotFound();
  }

  /** The add-ons with their SKU, supplier, prices and stock per location; active first, then position and name (`id` narrows to one). */
  private async rows(id?: string): Promise<AddonView[]> {
    let q = this.db
      .selectFrom('addon_items as a')
      .innerJoin('skus as k', 'k.addon_id', 'a.id')
      .leftJoin('suppliers as s', 's.id', 'a.supplier_id')
      .selectAll('a')
      .select(['k.id as sku_id', 'k.code as sku_code', 'k.shopify_variant_id', 's.name as supplier_name', 's.active as supplier_active']);
    if (id !== undefined) q = q.where('a.id', '=', id);
    const rows = await q.orderBy('a.active', 'desc').orderBy('a.position').orderBy(sql`lower(a.name)`).orderBy('a.id').execute();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const prices = await this.db.selectFrom('addon_item_prices').select(['addon_id', 'currency', 'price_minor']).where('addon_id', 'in', ids).execute();
    // A service holds no stock: none listed (D4).
    const skuIds = rows.filter((r) => r.kind === 'PRODUCT').map((r) => r.sku_id);
    const picked = await this.db
      .selectFrom('drop_addons as x')
      .innerJoin('drops as d', 'd.id', 'x.drop_id')
      .select((eb) => ['x.addon_id', eb.fn.countAll<number>().as('n')])
      .where('x.addon_id', 'in', ids)
      .where(releaseNotEnded('d', this.clock()))
      .groupBy('x.addon_id')
      .execute();
    const stock = skuIds.length === 0 ? { rows: [] } : await sql<{ sku_id: string; location_id: string; name: string; is_default: boolean; on_hand: number; reserved: number; minimum: number | null }>`
      SELECT k.id AS sku_id, l.id AS location_id, l.name, l.is_default,
             coalesce((SELECT sum(m.delta) FROM stock_movements m WHERE m.sku_id = k.id AND m.location_id = l.id), 0)::int AS on_hand,
             (SELECT count(*) FROM stock_holds h WHERE h.sku_id = k.id AND h.location_id = l.id AND h.reservation = 'STOCK')::int AS reserved,
             t.minimum
        FROM skus k
        CROSS JOIN stock_locations l
        LEFT JOIN sku_thresholds t ON t.sku_id = k.id AND t.location_id = l.id
       WHERE k.id IN (${sql.join(skuIds.map((s) => sql`${s}::uuid`))})
       ORDER BY l.is_default DESC, l.name, l.id`.execute(this.db);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      line: r.line,
      supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier_name!, active: r.supplier_active! } : null,
      weightG: r.weight_g,
      position: r.position,
      active: r.active,
      sku: { id: r.sku_id, code: r.sku_code, shopifyVariantId: r.shopify_variant_id },
      shopifyProductId: r.shopify_product_id,
      prices: prices
        .filter((p) => p.addon_id === r.id)
        .map((p) => ({ currency: p.currency, priceMinor: Number(p.price_minor) }))
        .sort((a, b) => HOUSE_CURRENCIES.indexOf(a.currency) - HOUSE_CURRENCIES.indexOf(b.currency)),
      stock: stock.rows
        .filter((x) => x.sku_id === r.sku_id)
        .map((x) => {
          const onHand = Number(x.on_hand);
          const reserved = Number(x.reserved);
          return { location: { id: x.location_id, name: x.name, isDefault: x.is_default }, onHand, reserved, available: onHand - reserved, minimum: x.minimum === null ? null : Number(x.minimum) };
        }),
      offeredAt: { live: r.offer_live, draw: r.offer_draw, salon: r.offer_salon, orders: r.offer_orders },
      engraving: r.engraving,
      textMax: r.text_max,
      releases: Number(picked.find((p) => p.addon_id === r.id)?.n ?? 0),
      // Migration 0060 (Q2.6) records what was converted; nothing before it.
      convertedFrom: [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** A name or a SKU code in use answers 409 ADDON_NAME_TAKEN or SKU_CODE_TAKEN; a second active engraving 409 ADDON_ENGRAVING_TAKEN. */
  private async taken<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e, 'addon_items_name_key')) throw addonNameTaken();
      if (isUniqueViolation(e, 'skus_code_key')) throw skuCodeTaken();
      if (isUniqueViolation(e, 'addon_items_engraving_key')) throw engravingTaken();
      throw e;
    }
  }
}
