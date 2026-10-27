/**
 * The margin's settings (macro scope of 2026-10-20, K43 N1 and N2; D61 for THE VAULT CARD; lot M4 plan §1.2, step
 * M4.2; migration 0063): what the owner enters so the margin on GROWTH can cost an order. Nothing is pre-filled: an
 * absent row reads as « not set », and the margin counts it as 0 and names it in its missing list.
 *
 *   rates        one euro rate per currency (`1 GBP = 1.150000 EUR`), above 0 and at most 100 000, six decimals at most;
 *                EUR is 1 and never set (422 MARGIN_RATE_EUR). The rate in force applies to every amount in that
 *                currency at reading time, the whole history included (N2: « a rate the owner sets per currency »).
 *                Cleared: the currency's amounts are left out of the margin and named.
 *   bands        the outbound shipping cost table (N1): what ORBES pays the carrier for a parcel of a country (or ALL
 *                OTHER COUNTRIES, `country` null) weighing up to `maxWeightG` (1 to 100 000 g), its cost (0 to
 *                1 000 000.00) and currency; one band per country and limit (409 SHIPPING_COST_TAKEN). A parcel takes the
 *                smallest band of its country that holds its weight, else of ALL OTHER COUNTRIES (margin.ts rateFor).
 *                Never a buyer's price (`shipping_rates`, THE PROGRAM's).
 *   unit costs   the POUCH and the CARD (per piece), THE VAULT CARD (VAULT_CARD, per card packed: THE VAULT's cost,
 *                D61), one PRIVATE CARE service (CARE_SERVICE) and what each warranty claim outcome costs
 *                (CLAIM_REPLACEMENT … CLAIM_REFUSED), each a cost (0 to 1 000 000.00) and its currency.
 *   allowances   the returns and claims allowance of a category, a percent of an order's revenue with two decimals at
 *                most (0 to 100), stored in hundredths of a percent (`allowance_bp`); 404 CATEGORY_NOT_FOUND.
 *
 * ADMIN writes (the routes' guard, as Orders → Settings); AUDITOR and above read. Every write is checked, takes its row
 * (or the band's key) and is audited: `margin.rate`, `margin.shipping_cost.create`, `.update`, `.delete`,
 * `margin.unit_cost`, `margin.allowance`, with keys, amounts and currencies, never anything personal. A write that
 * changes nothing writes nothing. Each write answers the whole settings (`read`), as the console shows them.
 *
 * Currencies are those of two decimals (suppliers.ts cleanCurrency): every amount of the house is in hundredths.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  ALLOWANCE_BP_MAX,
  CURRENCY_RATE_DECIMALS,
  CURRENCY_RATE_MAX,
  MARGIN_COST_MINOR_MAX,
  MARGIN_CURRENCY,
  MARGIN_UNIT_COST_KEYS,
  SHIPMENT_WEIGHT_G_MAX,
  type JsonObject,
  type MarginUnitCostKey,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import { isCountryCode } from '../../shared/countries.js';
import type { AuditService } from './audit.js';
import { cleanCurrency } from './suppliers.js';

// ── Rules ──────────────────────────────────────────────────────────────────

export { MARGIN_CURRENCY, MARGIN_UNIT_COST_KEYS };
export const MARGIN_SETTING_LIMITS = Object.freeze({
  rateMax: CURRENCY_RATE_MAX,
  rateDecimals: CURRENCY_RATE_DECIMALS,
  costMinor: MARGIN_COST_MINOR_MAX,
  weightG: SHIPMENT_WEIGHT_G_MAX,
  allowancePercent: ALLOWANCE_BP_MAX / 100,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_RE = new RegExp(`^(\\d{1,6})(?:\\.(\\d{1,${CURRENCY_RATE_DECIMALS}}))?$`);
const PERCENT_RE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/**
 * A euro rate as the console types it (`1.15`, `'0.0085'`): a decimal above 0 and at most CURRENCY_RATE_MAX with at
 * most six decimals, returned as numeric(14,6) reads it back (`'1.150000'`). 400 VALIDATION_FAILED otherwise.
 */
export function parseRate(v: unknown): string {
  const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  const m = RATE_RE.exec(text);
  const value = m ? Number(text) : NaN;
  if (!m || !(value > 0) || value > CURRENCY_RATE_MAX) {
    throw validationError(`A rate is the euros one unit is worth, above 0 and at most ${CURRENCY_RATE_MAX.toLocaleString('en-US')}, with at most ${CURRENCY_RATE_DECIMALS} decimals.`);
  }
  return `${Number(m[1])}.${(m[2] ?? '').padEnd(CURRENCY_RATE_DECIMALS, '0')}`;
}

/** A percent with at most two decimals, 0 to 100, in hundredths of a percent (12.5 → 1250). 400 VALIDATION_FAILED otherwise. */
export function percentToBp(v: unknown): number {
  const text = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  const m = PERCENT_RE.exec(text);
  const bp = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  if (!m || !(bp >= 0) || bp > ALLOWANCE_BP_MAX) throw validationError('An allowance is a percent from 0 to 100, with at most two decimals.');
  return bp;
}

// ── Errors ─────────────────────────────────────────────────────────────────

const rateEur = () => new DomainError('MARGIN_RATE_EUR', 422, 'Every margin figure is in euros: the euro is 1 and takes no rate.');
const bandTaken = () => conflict('SHIPPING_COST_TAKEN', 'This country already has a band with this weight limit.');
const bandNotFound = () => notFound('Shipping cost band', 'SHIPPING_COST_NOT_FOUND');
const categoryNotFound = () => notFound('Category', 'CATEGORY_NOT_FOUND');

// ── Views ──────────────────────────────────────────────────────────────────

/** A currency's rate: one unit is worth `eurRate` euros (numeric(14,6) as text, '1.150000'). */
export interface CurrencyRateView {
  currency: string;
  eurRate: string;
  updatedAt: Date;
}

/** A band of the outbound shipping cost table; `country` null: ALL OTHER COUNTRIES. */
export interface ShippingCostView {
  id: string;
  country: string | null;
  maxWeightG: number;
  costMinor: number;
  currency: string;
  updatedAt: Date;
}

/** A unit cost; cost and currency null while it is not set. */
export interface UnitCostView {
  key: MarginUnitCostKey;
  costMinor: number | null;
  currency: string | null;
  updatedAt: Date | null;
}

/** A category's allowance, in hundredths of a percent; null while it is not set. */
export interface AllowanceView {
  categoryId: number;
  code: string;
  name: string;
  active: boolean;
  allowanceBp: number | null;
  updatedAt: Date | null;
}

/** The settings as Margin settings reads them (AUDITOR and above). */
export interface MarginSettings {
  /** The currency of every margin figure. */
  currency: typeof MARGIN_CURRENCY;
  /** The rates set, by currency. */
  rates: CurrencyRateView[];
  /**
   * The currencies that appear (orders, invoices, supplier orders, boxes, credits granted (THE VAULT's included), credits
   * to give, the vaults' values and costs, unit costs, bands) and have no rate: left out of the margin.
   */
  currenciesWithoutRate: string[];
  /** The bands, by country (ALL OTHER COUNTRIES last), then by weight limit. */
  shippingCosts: ShippingCostView[];
  /** Every key of MARGIN_UNIT_COST_KEYS, in its order. */
  unitCosts: UnitCostView[];
  /** Every category, by code. */
  allowances: AllowanceView[];
}

/** The settings as the margin reads them (services/margin.ts), in one transaction. */
export interface MarginSettingRows {
  /** Euros per unit, by currency (EUR absent: it is 1). */
  rates: Map<string, number>;
  bands: { country: string | null; maxWeightG: number; costMinor: number; currency: string }[];
  unitCosts: Map<MarginUnitCostKey, { costMinor: number; currency: string }>;
  /** Hundredths of a percent, by category id. */
  allowances: Map<number, number>;
}

/** The settings the margin applies (see MarginSettingRows). */
export async function marginSettingRows(db: Db): Promise<MarginSettingRows> {
  const [rates, bands, costs, allowances] = await Promise.all([
    db.selectFrom('currency_rates').select(['currency', 'eur_rate']).execute(),
    db.selectFrom('shipping_cost_rates').select(['country', 'max_weight_g', 'cost_minor', 'currency']).execute(),
    db.selectFrom('margin_unit_costs').select(['key', 'cost_minor', 'currency']).execute(),
    db.selectFrom('category_allowances').select(['category_id', 'allowance_bp']).execute(),
  ]);
  return {
    rates: new Map(rates.map((r) => [r.currency, Number(r.eur_rate)])),
    bands: bands.map((b) => ({ country: b.country === null ? null : b.country.trim(), maxWeightG: b.max_weight_g, costMinor: Number(b.cost_minor), currency: b.currency })),
    unitCosts: new Map(costs.map((c) => [c.key, { costMinor: Number(c.cost_minor), currency: c.currency }])),
    allowances: new Map(allowances.map((a) => [Number(a.category_id), a.allowance_bp])),
  };
}

// ── Checking ───────────────────────────────────────────────────────────────

/** A cost in hundredths, 0 to MARGIN_COST_MINOR_MAX. */
function cost(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MARGIN_COST_MINOR_MAX) {
    throw validationError(`A cost is a whole number of cents, 0 to ${MARGIN_COST_MINOR_MAX.toLocaleString('en-US')}.`);
  }
  return v;
}

/** A currency of two decimals (any, EUR included: a cost may be in any). */
function currencyOf(v: unknown): string {
  const c = cleanCurrency(v);
  if (c === null) throw validationError('The currency is a three-letter code, such as EUR.');
  return c;
}

function weight(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > SHIPMENT_WEIGHT_G_MAX) {
    throw validationError(`A band's limit is a whole number of grams, 1 to ${SHIPMENT_WEIGHT_G_MAX.toLocaleString('en-US')}.`);
  }
  return v;
}

/** A country code (two capitals, one of COUNTRY_CODES), or null for ALL OTHER COUNTRIES. */
function country(v: unknown): string | null {
  if (v === null) return null;
  const code = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!isCountryCode(code)) throw validationError('The country is a two-letter code, such as FR, or none for ALL OTHER COUNTRIES.');
  return code;
}

function unitKey(v: unknown): MarginUnitCostKey {
  if (typeof v !== 'string' || !(MARGIN_UNIT_COST_KEYS as readonly string[]).includes(v)) throw validationError(`A unit cost is one of ${MARGIN_UNIT_COST_KEYS.join(', ')}.`);
  return v as MarginUnitCostKey;
}

function rateCurrency(v: unknown): string {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (c === MARGIN_CURRENCY) throw rateEur();
  return currencyOf(c);
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only ORBES staff can change the margin settings.');
}

const adminIdOf = (actor: Actor): string | null => (actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null);

/** What a band's input sets, checked; only the fields given (every one when adding). */
export interface ShippingCostInput {
  country?: string | null;
  maxWeightG?: number;
  costMinor?: number;
  currency?: string;
}

// ── The service ────────────────────────────────────────────────────────────

export interface MarginSettingsServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class MarginSettingsService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: MarginSettingsServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** The settings (GET /api/admin/margin/settings, AUDITOR): the four lists and the currencies without a rate. */
  async read(): Promise<MarginSettings> {
    const db = this.db;
    const [rates, bands, costs, categories, seen] = await Promise.all([
      db.selectFrom('currency_rates').select(['currency', 'eur_rate', 'updated_at']).orderBy('currency').execute(),
      db.selectFrom('shipping_cost_rates').select(['id', 'country', 'max_weight_g', 'cost_minor', 'currency', 'updated_at']).execute(),
      db.selectFrom('margin_unit_costs').select(['key', 'cost_minor', 'currency', 'updated_at']).execute(),
      db
        .selectFrom('categories as c')
        .leftJoin('category_allowances as a', 'a.category_id', 'c.id')
        .select(['c.id', 'c.code', 'c.name', 'c.active', 'a.allowance_bp', 'a.updated_at'])
        .orderBy('c.code')
        .execute(),
      sql<{ currency: string }>`
        SELECT DISTINCT currency FROM (
          SELECT currency FROM orders WHERE currency IS NOT NULL
          UNION SELECT currency FROM invoices
          UNION SELECT currency FROM supplier_orders WHERE currency IS NOT NULL
          UNION SELECT currency FROM boxes WHERE currency IS NOT NULL
          UNION SELECT currency FROM tier_grants WHERE currency IS NOT NULL
          UNION SELECT currency FROM vault_gifts
          UNION SELECT currency FROM vaults WHERE currency IS NOT NULL
          UNION SELECT currency FROM margin_unit_costs
          UNION SELECT currency FROM shipping_cost_rates) c`.execute(db),
    ]);
    const rated = new Set(rates.map((r) => r.currency));
    const byKey = new Map(costs.map((c) => [c.key, c]));
    return {
      currency: MARGIN_CURRENCY,
      rates: rates.map((r) => ({ currency: r.currency, eurRate: Number(r.eur_rate).toFixed(CURRENCY_RATE_DECIMALS), updatedAt: r.updated_at })),
      currenciesWithoutRate: seen.rows.map((r) => r.currency).filter((c) => c !== MARGIN_CURRENCY && !rated.has(c)).sort(),
      shippingCosts: bands
        .map((b) => ({ id: b.id, country: b.country === null ? null : b.country.trim(), maxWeightG: b.max_weight_g, costMinor: Number(b.cost_minor), currency: b.currency, updatedAt: b.updated_at }))
        .sort((a, b) => (a.country === b.country ? a.maxWeightG - b.maxWeightG : a.country === null ? 1 : b.country === null ? -1 : a.country < b.country ? -1 : 1)),
      unitCosts: MARGIN_UNIT_COST_KEYS.map((key) => {
        const c = byKey.get(key);
        return { key, costMinor: c ? Number(c.cost_minor) : null, currency: c?.currency ?? null, updatedAt: c?.updated_at ?? null };
      }),
      allowances: categories.map((c) => ({
        categoryId: Number(c.id),
        code: c.code.trim(),
        name: c.name,
        active: c.active,
        allowanceBp: c.allowance_bp ?? null,
        updatedAt: c.updated_at ?? null,
      })),
    };
  }

  /**
   * A currency's rate set (PUT /api/admin/margin/rates/:currency, ADMIN): 422 MARGIN_RATE_EUR for the euro. Audited
   * `margin.rate` with the rate before and after; the same rate again writes nothing.
   */
  async setRate(currencyCode: string, rate: unknown, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const currency = rateCurrency(currencyCode);
    const eurRate = parseRate(rate);
    await this.save(async (tx) => {
      const before = await tx.selectFrom('currency_rates').select('eur_rate').where('currency', '=', currency).forUpdate().executeTakeFirst();
      const from = before ? Number(before.eur_rate).toFixed(CURRENCY_RATE_DECIMALS) : null;
      if (from === eurRate) return;
      if (before) await tx.updateTable('currency_rates').set({ eur_rate: eurRate, updated_by: adminIdOf(actor) }).where('currency', '=', currency).execute();
      else await tx.insertInto('currency_rates').values({ currency, eur_rate: eurRate, updated_by: adminIdOf(actor), updated_at: this.clock() }).execute();
      await this.audit.record({ actor, action: 'margin.rate', targetType: 'currency_rate', targetId: currency, details: { currency, from, to: eurRate } }, tx);
    });
    return this.read();
  }

  /** A currency's rate cleared (DELETE /api/admin/margin/rates/:currency, ADMIN): its amounts are left out again. Audited `margin.rate` (to null). */
  async clearRate(currencyCode: string, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const currency = rateCurrency(currencyCode);
    await inTransaction(this.db, async (tx) => {
      const gone = await tx.deleteFrom('currency_rates').where('currency', '=', currency).returning('eur_rate').executeTakeFirst();
      if (!gone) return;
      await this.audit.record({ actor, action: 'margin.rate', targetType: 'currency_rate', targetId: currency, details: { currency, from: Number(gone.eur_rate).toFixed(CURRENCY_RATE_DECIMALS), to: null } }, tx);
    });
    return this.read();
  }

  /**
   * A band added (POST /api/admin/margin/shipping-costs, ADMIN): its country (null: ALL OTHER COUNTRIES), limit, cost
   * and currency; 409 SHIPPING_COST_TAKEN when the country has that limit already. Audited `margin.shipping_cost.create`.
   */
  async addShippingCost(input: ShippingCostInput, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const i = input ?? {};
    if (i.country === undefined) throw validationError('The country is a two-letter code, such as FR, or none for ALL OTHER COUNTRIES.');
    const row = { country: country(i.country), max_weight_g: weight(i.maxWeightG), cost_minor: cost(i.costMinor), currency: currencyOf(i.currency) };
    await this.band(() =>
      inTransaction(this.db, async (tx) => {
        const created = await tx
          .insertInto('shipping_cost_rates')
          .values({ ...row, updated_by: adminIdOf(actor), updated_at: this.clock() })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'margin.shipping_cost.create', targetType: 'shipping_cost_rate', targetId: created.id, details: bandDetails(row) }, tx);
      }),
    );
    return this.read();
  }

  /**
   * A band changed (PATCH /api/admin/margin/shipping-costs/:id, ADMIN): the fields given, under its row lock; 404
   * SHIPPING_COST_NOT_FOUND, 409 SHIPPING_COST_TAKEN. Audited `margin.shipping_cost.update` with each field changed,
   * before and after; nothing changed, nothing written.
   */
  async updateShippingCost(id: string, input: ShippingCostInput, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const bandId = knownBand(id);
    const i = input ?? {};
    const next: Partial<BandRow> = {};
    if (i.country !== undefined) next.country = country(i.country);
    if (i.maxWeightG !== undefined) next.max_weight_g = weight(i.maxWeightG);
    if (i.costMinor !== undefined) next.cost_minor = cost(i.costMinor);
    if (i.currency !== undefined) next.currency = currencyOf(i.currency);
    if (Object.keys(next).length === 0) throw validationError('Nothing to change.');
    await this.band(() =>
      inTransaction(this.db, async (tx) => {
        const found = await tx.selectFrom('shipping_cost_rates').select(['country', 'max_weight_g', 'cost_minor', 'currency']).where('id', '=', bandId).forUpdate().executeTakeFirst();
        if (!found) throw bandNotFound();
        const before: BandRow = { country: found.country === null ? null : found.country.trim(), max_weight_g: found.max_weight_g, cost_minor: Number(found.cost_minor), currency: found.currency };
        const changed = (Object.keys(next) as (keyof BandRow)[]).filter((k) => next[k] !== before[k]);
        if (changed.length === 0) return;
        await tx
          .updateTable('shipping_cost_rates')
          .set({ ...Object.fromEntries(changed.map((k) => [k, next[k]])), updated_by: adminIdOf(actor) })
          .where('id', '=', bandId)
          .execute();
        const details: JsonObject = {};
        for (const k of changed) details[BAND_FIELDS[k]] = { from: before[k], to: next[k] ?? null };
        await this.audit.record({ actor, action: 'margin.shipping_cost.update', targetType: 'shipping_cost_rate', targetId: bandId, details }, tx);
      }),
    );
    return this.read();
  }

  /** A band removed (DELETE /api/admin/margin/shipping-costs/:id, ADMIN); 404 SHIPPING_COST_NOT_FOUND. Audited `margin.shipping_cost.delete`. */
  async removeShippingCost(id: string, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const bandId = knownBand(id);
    await inTransaction(this.db, async (tx) => {
      const gone = await tx.deleteFrom('shipping_cost_rates').where('id', '=', bandId).returning(['country', 'max_weight_g', 'cost_minor', 'currency']).executeTakeFirst();
      if (!gone) throw bandNotFound();
      const row: BandRow = { country: gone.country === null ? null : gone.country.trim(), max_weight_g: gone.max_weight_g, cost_minor: Number(gone.cost_minor), currency: gone.currency };
      await this.audit.record({ actor, action: 'margin.shipping_cost.delete', targetType: 'shipping_cost_rate', targetId: bandId, details: bandDetails(row) }, tx);
    });
    return this.read();
  }

  /**
   * A unit cost set (PUT /api/admin/margin/unit-costs/:key, ADMIN): the POUCH, the CARD, THE VAULT CARD, a care service
   * or a claim outcome, its cost and currency. Audited `margin.unit_cost`, before and after; the same again writes nothing.
   */
  async setUnitCost(keyValue: string, input: { costMinor?: unknown; currency?: unknown }, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const key = unitKey(keyValue);
    const next = { costMinor: cost(input?.costMinor), currency: currencyOf(input?.currency) };
    await this.save(async (tx) => {
      const found = await tx.selectFrom('margin_unit_costs').select(['cost_minor', 'currency']).where('key', '=', key).forUpdate().executeTakeFirst();
      const before = found ? { costMinor: Number(found.cost_minor), currency: found.currency } : null;
      if (before && before.costMinor === next.costMinor && before.currency === next.currency) return;
      if (found) await tx.updateTable('margin_unit_costs').set({ cost_minor: next.costMinor, currency: next.currency, updated_by: adminIdOf(actor) }).where('key', '=', key).execute();
      else await tx.insertInto('margin_unit_costs').values({ key, cost_minor: next.costMinor, currency: next.currency, updated_by: adminIdOf(actor), updated_at: this.clock() }).execute();
      await this.audit.record({ actor, action: 'margin.unit_cost', targetType: 'margin_unit_cost', targetId: key, details: { key, from: before, to: next } }, tx);
    });
    return this.read();
  }

  /** A unit cost cleared (DELETE /api/admin/margin/unit-costs/:key, ADMIN). Audited `margin.unit_cost` (to null). */
  async clearUnitCost(keyValue: string, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const key = unitKey(keyValue);
    await inTransaction(this.db, async (tx) => {
      const gone = await tx.deleteFrom('margin_unit_costs').where('key', '=', key).returning(['cost_minor', 'currency']).executeTakeFirst();
      if (!gone) return;
      await this.audit.record({ actor, action: 'margin.unit_cost', targetType: 'margin_unit_cost', targetId: key, details: { key, from: { costMinor: Number(gone.cost_minor), currency: gone.currency }, to: null } }, tx);
    });
    return this.read();
  }

  /**
   * A category's allowance set (PUT /api/admin/margin/allowances/:categoryId, ADMIN): a percent from 0 to 100 with two
   * decimals at most; 404 CATEGORY_NOT_FOUND. Audited `margin.allowance` in hundredths of a percent, before and after.
   */
  async setAllowance(categoryId: number, percent: unknown, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const id = knownCategory(categoryId);
    const bp = percentToBp(percent);
    await this.save(async (tx) => {
      const category = await tx.selectFrom('categories').select('code').where('id', '=', id).forShare().executeTakeFirst();
      if (!category) throw categoryNotFound();
      const found = await tx.selectFrom('category_allowances').select('allowance_bp').where('category_id', '=', id).forUpdate().executeTakeFirst();
      if (found?.allowance_bp === bp) return;
      if (found) await tx.updateTable('category_allowances').set({ allowance_bp: bp, updated_by: adminIdOf(actor) }).where('category_id', '=', id).execute();
      else await tx.insertInto('category_allowances').values({ category_id: id, allowance_bp: bp, updated_by: adminIdOf(actor), updated_at: this.clock() }).execute();
      await this.audit.record({ actor, action: 'margin.allowance', targetType: 'category', targetId: String(id), details: { category: category.code.trim(), fromBp: found?.allowance_bp ?? null, toBp: bp } }, tx);
    });
    return this.read();
  }

  /** A category's allowance cleared (DELETE /api/admin/margin/allowances/:categoryId, ADMIN); 404 CATEGORY_NOT_FOUND. Audited `margin.allowance` (to null). */
  async clearAllowance(categoryId: number, actor: Actor): Promise<MarginSettings> {
    assertStaff(actor);
    const id = knownCategory(categoryId);
    await inTransaction(this.db, async (tx) => {
      const category = await tx.selectFrom('categories').select('code').where('id', '=', id).executeTakeFirst();
      if (!category) throw categoryNotFound();
      const gone = await tx.deleteFrom('category_allowances').where('category_id', '=', id).returning('allowance_bp').executeTakeFirst();
      if (!gone) return;
      await this.audit.record({ actor, action: 'margin.allowance', targetType: 'category', targetId: String(id), details: { category: category.code.trim(), fromBp: gone.allowance_bp, toBp: null } }, tx);
    });
    return this.read();
  }

  /**
   * A rate, a unit cost or an allowance saved: read under its row lock, then updated, or inserted when absent. Two first
   * saves of the same key at once (two ADMIN tabs) both find it absent and the second insert meets the primary key: that
   * one is run again once, in a new transaction, where it reads the row the first saved (its audit's before) and updates
   * it, or writes nothing when it holds the same value.
   */
  private async save(fn: (tx: Db) => Promise<void>): Promise<void> {
    try {
      await inTransaction(this.db, fn);
    } catch (e) {
      if (!isUniqueViolation(e) || this.db.isTransaction) throw e;
      await inTransaction(this.db, fn);
    }
  }

  /** A band's key in use (the unique index on country and limit) answers 409 SHIPPING_COST_TAKEN. */
  private async band<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw bandTaken();
      throw e;
    }
  }
}

interface BandRow {
  country: string | null;
  max_weight_g: number;
  cost_minor: number;
  currency: string;
}

const BAND_FIELDS: Readonly<Record<keyof BandRow, string>> = Object.freeze({ country: 'country', max_weight_g: 'maxWeightG', cost_minor: 'costMinor', currency: 'currency' });

const bandDetails = (r: BandRow): JsonObject => ({ country: r.country, maxWeightG: r.max_weight_g, costMinor: r.cost_minor, currency: r.currency });

function knownBand(v: unknown): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw bandNotFound();
  return v.toLowerCase();
}

function knownCategory(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 32_767) throw categoryNotFound();
  return v;
}
