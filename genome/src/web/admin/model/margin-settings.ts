/**
 * Margin settings (macro scope of 2026-10-20, K43 N1 and N2; D61; lot M4 plan §1.3, step M4.4; #/growth/margin-settings):
 * pure helpers, no DOM. What the owner enters so Growth's Margin can cost an order; nothing is pre-filled, and what is
 * not set is counted as 0 and named in Growth's What is missing.
 *
 *  - Currencies: each currency that appears and its euro rate (`1 GBP = 1.150000 EUR`), Set / Clear; one without a
 *    rate is marked "No rate: left out of the margin". EUR is 1 and takes no rate.
 *  - Outbound shipping: the bands, a row per country by its English name (ALL OTHER COUNTRIES last), each band
 *    `up to 500 g · € 6.90`; a band's dialog (COUNTRY or ALL OTHER COUNTRIES, UP TO in grams, COST, CURRENCY).
 *  - Packaging: POUCH and CARD per piece, THE VAULT CARD per card packed (D61); each box's cost is in Orders → Settings
 *    → Boxes.
 *  - Returns and claims allowance: each category's percent of an order's revenue, two decimals at most.
 *  - PRIVATE CARE and warranty: one PRIVATE CARE service and each claim outcome.
 * The dialogs' checks say before anything is sent what the server would refuse (services/margin-settings.ts); the
 * server stays the authority (422 MARGIN_RATE_EUR, 409 SHIPPING_COST_TAKEN, 404 SHIPPING_COST_NOT_FOUND).
 */
import { COUNTRY_CODES, countryName } from '../../../shared/countries.js';
import { formatCount } from '../format.js';
import {
  ALLOWANCE_BP_MAX,
  CURRENCY_RATE_DECIMALS,
  CURRENCY_RATE_MAX,
  MARGIN_COST_MINOR_MAX,
  MARGIN_CURRENCY,
  SHIPMENT_WEIGHT_G_MAX,
  type AllowanceView,
  type MarginSettings,
  type MarginUnitCostKey,
  type ShippingCostInput,
  type ShippingCostView,
  type UnitCostView,
} from '../types.js';
import { formatMoney, parseMoney } from './live.js';
import { unitCostLabel } from './margin.js';

export { unitCostLabel };

export const MARGIN_SETTINGS_TEXT = Object.freeze({
  eyebrow: 'Overview · Growth',
  title: 'Margin settings',
  lead: 'What Growth’s Margin counts as costs: the euro rates, what a parcel costs to ship, the pouch and the card, the returns and claims allowance, PRIVATE CARE and warranty work. Nothing is set at first: what is missing counts as 0 until it is entered. Everyone who reads Growth reads these settings; an ADMIN changes them.',
  growth: 'Growth',
  unchanged: 'Nothing has changed.',
  notSet: 'Not set',
  // Currencies
  currencies: 'Currencies',
  currenciesLead: 'Every margin figure is in euros. Each other currency is converted at the rate set here, for the whole history; an amount in a currency without a rate is left out of the margin and named in What is missing.',
  currenciesEmpty: 'Every amount of the house is in euros: no rate is needed.',
  noRate: 'No rate: left out of the margin',
  setRate: 'Set a rate',
  rateTitle: 'Set the rate',
  rateHint: 'The euros one unit is worth, six decimals at most: 1.15, or 0.0085.',
  rateCurrencyHint: 'A three-letter code, such as GBP. The euro is 1 and takes no rate.',
  rateSaved: 'Rate saved.',
  clearRateTitle: 'Clear the rate',
  clearRateText: 'Its amounts are left out of the margin again, and named in What is missing.',
  rateCleared: 'Rate cleared.',
  // Outbound shipping
  shipping: 'Outbound shipping',
  shippingLead: 'What ORBES pays the carrier for a parcel, by its country and weight. A parcel takes the smallest band that holds its weight.',
  shippingNote: 'A country without a band of its own takes ALL OTHER COUNTRIES. These are costs, never a price to the buyer.',
  shippingEmpty: 'No band yet. Add one for your main country and one for ALL OTHER COUNTRIES.',
  addBand: 'Add a band',
  addBandTitle: 'Add a band',
  editBandTitle: 'Edit the band',
  bandEyebrow: 'Margin settings · Outbound shipping',
  bandAdded: 'Band added.',
  bandSaved: 'Band saved.',
  removeBandTitle: 'Remove the band',
  removeBandText: 'Parcels it held take the next band that holds their weight, or none.',
  bandRemoved: 'Band removed.',
  otherCountries: 'ALL OTHER COUNTRIES',
  // Packaging
  packaging: 'Packaging',
  packagingLead: 'Each piece leaves in its pouch, with its card. An add-on unit has neither. THE VAULT CARD goes in the box of each order whose piece opens a vault; its cost counts in THE VAULT.',
  boxesLine: 'Each box’s cost is in Boxes.',
  boxesLink: 'Orders → Settings → Boxes',
  // Allowance
  allowance: 'Returns and claims allowance',
  allowanceLead: 'A percent of each order’s revenue, per category, standing for the returns and claims to come: returned and cancelled orders are not counted in the margin.',
  allowanceEmpty: 'No category yet.',
  allowanceTitle: 'Set the allowance',
  allowanceHint: 'A percent of the order’s revenue, 0 to 100, two decimals at most: 2.5.',
  allowanceSaved: 'Allowance saved.',
  clearAllowanceTitle: 'Clear the allowance',
  clearAllowanceText: 'Its orders count no allowance again, and the category is named in What is missing.',
  allowanceCleared: 'Allowance cleared.',
  inactive: 'INACTIVE',
  // PRIVATE CARE and warranty
  care: 'PRIVATE CARE and warranty',
  careLead: 'What each PRIVATE CARE service done and each warranty claim decided costs the house, counted in the window it happened.',
  careHint: 'A credit given is counted when it is used on an order (PERKS); set here what the outcome itself costs.',
  // Unit costs
  costTitle: 'Set the cost',
  costHint: 'In units: 3.50, or 12.',
  currencyHint: 'Any currency with cents, such as EUR, GBP, USD or CHF.',
  costSaved: 'Cost saved.',
  clearCostTitle: 'Clear the cost',
  clearCostText: 'It counts as 0 again, and is named in What is missing.',
  costCleared: 'Cost cleared.',
  set: 'Set',
  edit: 'Edit',
  clear: 'Clear',
  remove: 'Remove',
});

const RATE_RE = new RegExp(`^(\\d{1,6})(?:\\.(\\d{1,${CURRENCY_RATE_DECIMALS}}))?$`);
const CURRENCY_RE = /^[A-Za-z]{3}$/;

// ── Currencies ─────────────────────────────────────────────────────────────

/** `1 GBP = 1.150000 EUR`. */
export function rateLine(currency: string, eurRate: string): string {
  return `1 ${currency} = ${eurRate} ${MARGIN_CURRENCY}`;
}

export interface CurrencyRow {
  currency: string;
  /** The rate as stored ('1.150000'); null: none, the currency's amounts left out. */
  eurRate: string | null;
  text: string;
}

/** Each currency that has a rate or appears without one, by code. */
export function currencyRows(s: Pick<MarginSettings, 'rates' | 'currenciesWithoutRate'>): CurrencyRow[] {
  const rows: CurrencyRow[] = [
    ...s.rates.map((r) => ({ currency: r.currency, eurRate: r.eurRate, text: rateLine(r.currency, r.eurRate) })),
    ...s.currenciesWithoutRate.filter((c) => !s.rates.some((r) => r.currency === c)).map((c) => ({ currency: c, eurRate: null, text: MARGIN_SETTINGS_TEXT.noRate })),
  ];
  return rows.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** A rate as typed, its comma read as a point and its spaces dropped. */
export function rateValue(text: string | undefined): string {
  return (text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
}

/** The rate dialog's check: a currency other than EUR and a rate above 0, at most 100 000, six decimals at most. */
export function rateProblem(v: { currency?: string; rate?: string }): string | null {
  const currency = (v.currency ?? '').trim();
  if (!CURRENCY_RE.test(currency)) return 'The currency is a three-letter code, such as GBP.';
  if (currency.toUpperCase() === MARGIN_CURRENCY) return 'Every margin figure is in euros: the euro is 1 and takes no rate.';
  const rate = rateValue(v.rate);
  const value = RATE_RE.test(rate) ? Number(rate) : NaN;
  if (!(value > 0) || value > CURRENCY_RATE_MAX) {
    return `A rate is the euros one unit is worth, above 0 and at most ${formatCount(CURRENCY_RATE_MAX)}, with at most ${CURRENCY_RATE_DECIMALS} decimals.`;
  }
  return null;
}

/** A stored rate as the dialog shows it: `1.15` for '1.150000'. */
export function rateField(eurRate: string | null): string {
  if (!eurRate) return '';
  return eurRate.includes('.') ? eurRate.replace(/0+$/, '').replace(/\.$/, '') : eurRate;
}

// ── Outbound shipping ──────────────────────────────────────────────────────

/** A band's country: its English name, or ALL OTHER COUNTRIES. */
export function countryLabel(code: string | null): string {
  return code === null ? MARGIN_SETTINGS_TEXT.otherCountries : countryName(code);
}

/** Grams as the console reads them: `1 000 g`. */
const grams = (n: number) => `${formatCount(n)} g`;

/** `up to 500 g · € 6.90`. */
export function bandText(b: Pick<ShippingCostView, 'maxWeightG' | 'costMinor' | 'currency'>): string {
  return `up to ${grams(b.maxWeightG)} · ${formatMoney(b.costMinor, b.currency)}`;
}

export interface BandGroup {
  /** The country's code, or '*' for ALL OTHER COUNTRIES. */
  key: string;
  label: string;
  bands: ShippingCostView[];
}

/** The bands, a group per country by its English name, ALL OTHER COUNTRIES last; each group's bands by weight. */
export function bandGroups(bands: readonly ShippingCostView[]): BandGroup[] {
  const groups = new Map<string, BandGroup>();
  for (const b of bands) {
    const key = b.country ?? '*';
    const g = groups.get(key) ?? { key, label: countryLabel(b.country), bands: [] };
    g.bands.push(b);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.bands.sort((a, b) => a.maxWeightG - b.maxWeightG);
  return [...groups.values()].sort((a, b) => (a.key === '*' ? 1 : b.key === '*' ? -1 : a.label.localeCompare(b.label, 'en')));
}

/** The dialog's COUNTRY: ALL OTHER COUNTRIES first, then every country by its English name. */
export function bandCountryOptions(): { value: string; label: string }[] {
  return [
    { value: '*', label: MARGIN_SETTINGS_TEXT.otherCountries },
    ...COUNTRY_CODES.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label, 'en')),
  ];
}

export type BandForm = Record<'country' | 'maxWeightG' | 'cost' | 'currency', string>;

/** Cents as a field shows them: `12`, `6.90`. */
export function moneyField(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** The band dialog's values as it opens: the band's, or ALL OTHER COUNTRIES in euros for a new one. */
export function bandFormValues(b: ShippingCostView | null): BandForm {
  return {
    country: b ? (b.country ?? '*') : '*',
    maxWeightG: b ? String(b.maxWeightG) : '',
    cost: b ? moneyField(b.costMinor) : '',
    currency: b?.currency ?? MARGIN_CURRENCY,
  };
}

/** A whole number typed (spaces allowed) within its bounds; null otherwise. */
function whole(text: string | undefined, min: number, max: number): number | null {
  const s = (text ?? '').replace(/[\s  ]/g, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** A cost and its currency, as both dialogs check them. */
function costProblem(cost: string | undefined, currency: string | undefined): string | null {
  const minor = parseMoney(cost);
  if (minor === null || minor > MARGIN_COST_MINOR_MAX) return 'A cost reads 6.90, or 12.';
  if (!CURRENCY_RE.test((currency ?? '').trim())) return 'The currency is a three-letter code, such as EUR.';
  return null;
}

/** The band dialog's check. */
export function bandProblem(v: Partial<BandForm>): string | null {
  const country = v.country ?? '';
  if (country !== '*' && !COUNTRY_CODES.includes(country)) return 'Choose the country, or ALL OTHER COUNTRIES.';
  if (whole(v.maxWeightG, 1, SHIPMENT_WEIGHT_G_MAX) === null) return `UP TO is a whole number of grams, 1 to ${formatCount(SHIPMENT_WEIGHT_G_MAX)}.`;
  return costProblem(v.cost, v.currency);
}

/** A new band from values bandProblem accepted. */
export function bandInput(v: BandForm): ShippingCostInput {
  return {
    country: v.country === '*' ? null : v.country,
    maxWeightG: whole(v.maxWeightG, 1, SHIPMENT_WEIGHT_G_MAX)!,
    costMinor: parseMoney(v.cost)!,
    currency: v.currency.trim().toUpperCase(),
  };
}

/** What an edit changes, or null when nothing has. */
export function bandChange(b: ShippingCostView, v: BandForm): Partial<ShippingCostInput> | null {
  const next = bandInput(v);
  const out: Partial<ShippingCostInput> = {};
  if (next.country !== b.country) out.country = next.country;
  if (next.maxWeightG !== b.maxWeightG) out.maxWeightG = next.maxWeightG;
  if (next.costMinor !== b.costMinor) out.costMinor = next.costMinor;
  if (next.currency !== b.currency) out.currency = next.currency;
  return Object.keys(out).length ? out : null;
}

// ── Unit costs ─────────────────────────────────────────────────────────────

/** Packaging's rows: the POUCH, the CARD and THE VAULT CARD. */
export const PACKAGING_KEYS: readonly MarginUnitCostKey[] = Object.freeze(['POUCH', 'CARD', 'VAULT_CARD']);

/** What a unit cost is, as its row says under its name. */
export function unitCostNote(key: MarginUnitCostKey): string {
  if (key === 'POUCH' || key === 'CARD') return 'Per piece';
  if (key === 'VAULT_CARD') return 'Per card packed';
  if (key === 'CARE_SERVICE') return 'Per service done';
  return 'Per claim decided';
}

/** A unit cost, or Not set. */
export function unitCostText(u: Pick<UnitCostView, 'costMinor' | 'currency'>): string {
  return u.costMinor === null || !u.currency ? MARGIN_SETTINGS_TEXT.notSet : formatMoney(u.costMinor, u.currency);
}

export type UnitCostForm = Record<'cost' | 'currency', string>;

/** The cost dialog's values as it opens: the cost set, or empty in euros. */
export function unitCostFormValues(u: UnitCostView): UnitCostForm {
  return { cost: u.costMinor === null ? '' : moneyField(u.costMinor), currency: u.currency ?? MARGIN_CURRENCY };
}

/** The cost dialog's check, and Nothing has changed for the same cost again. */
export function unitCostProblem(u: UnitCostView, v: Partial<UnitCostForm>): string | null {
  const problem = costProblem(v.cost, v.currency);
  if (problem) return problem;
  return parseMoney(v.cost) === u.costMinor && (v.currency ?? '').trim().toUpperCase() === u.currency ? MARGIN_SETTINGS_TEXT.unchanged : null;
}

/** What PUT /api/admin/margin/unit-costs/:key takes, from values unitCostProblem accepted. */
export function unitCostInput(v: UnitCostForm): { costMinor: number; currency: string } {
  return { costMinor: parseMoney(v.cost)!, currency: v.currency.trim().toUpperCase() };
}

/** The care section's rows: the PRIVATE CARE service, then each claim outcome in its order. */
export function careKeys(s: Pick<MarginSettings, 'unitCosts'>): UnitCostView[] {
  return s.unitCosts.filter((u) => !PACKAGING_KEYS.includes(u.key));
}

/** Packaging's rows. */
export function packagingKeys(s: Pick<MarginSettings, 'unitCosts'>): UnitCostView[] {
  return s.unitCosts.filter((u) => PACKAGING_KEYS.includes(u.key));
}

// ── Returns and claims allowance ───────────────────────────────────────────

/** Hundredths of a percent as the table reads them: `2.50 %`; Not set. */
export function allowanceText(bp: number | null): string {
  return bp === null ? MARGIN_SETTINGS_TEXT.notSet : `${(bp / 100).toFixed(2)} %`;
}

/** The allowance dialog's value as it opens: `2.5` for 250. */
export function allowanceField(bp: number | null): string {
  if (bp === null) return '';
  return String(bp / 100);
}

/** A percent as typed, its comma read as a point. */
export function percentValue(text: string | undefined): string {
  return (text ?? '').replace(/[\s  %]/g, '').replace(',', '.');
}

/** The allowance dialog's check: 0 to 100 with two decimals at most; Nothing has changed for the same percent again. */
export function allowanceProblem(a: Pick<AllowanceView, 'allowanceBp'>, text: string | undefined): string | null {
  const v = percentValue(text);
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v);
  const bp = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  if (!m || bp > ALLOWANCE_BP_MAX) return 'An allowance is a percent from 0 to 100, with at most two decimals.';
  return bp === a.allowanceBp ? MARGIN_SETTINGS_TEXT.unchanged : null;
}

/** The categories the section lists: every active one, and an inactive one that still has an allowance. */
export function allowanceRows(s: Pick<MarginSettings, 'allowances'>): AllowanceView[] {
  return s.allowances.filter((a) => a.active || a.allowanceBp !== null);
}
