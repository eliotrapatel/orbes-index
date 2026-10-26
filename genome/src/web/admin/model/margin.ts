/**
 * Growth's Margin (macro scope of 2026-10-20, K43 N1 to N3; D61 THE VAULT's cost; lot M4 plan §1.3, step M4.4): pure
 * helpers, no DOM.
 *
 *  - The section follows the page's window (LAST 12 MONTHS · LAST 24 MONTHS); its tab (BY MODEL · BY CHANNEL · BY TIER)
 *    reads from the page's query (`mg`), the first one by default and then left out of the address.
 *  - Every figure is in euros, at the rates of Margin settings (services/margin.ts converts; the console never does).
 *  - Four figures (Revenue, Costs, Margin, Margin %), then each view's table: its groups, orders, revenue, each cost
 *    column (PERKS with its three parts and THE VAULT with its five under their totals), margin, margin %, and the mark
 *    of the orders holding an estimate. The channel view names a VAULT order as the Orders board does: FROM THE VAULT.
 *  - THE VAULT's line, beside the tables and never inside them (D61, OP-26, OP-22): its counts and costs as the margin
 *    counts them, the guaranteed pieces (a piece each, never a place), the report's own cost of the rewards won with its
 *    rewards without a supplier price, why the two can differ, and the way to Club → THE VAULT's report.
 *  - Partner experiences (K49, P1), beside the margin, never inside the tables: nothing until partners are recorded.
 *  - What is missing: each item the margin counted as 0, with its count and where it is fixed.
 *  - Never by release (N3): no release is named, filtered or linked here.
 */
import { formatCount } from '../format.js';
import { href, type RouteName } from '../router.js';
import { MARGIN_CURRENCY, type MarginChannel, type MarginCosts, type MarginGroup, type MarginMissing, type MarginReport, type MarginUnitCostKey, type MarginVaultCosts, type MarginVaultLine } from '../types.js';
import { MARGIN_TAB_LABELS, MARGIN_TABS, marginTab, money, SOURCE_LABELS, type MarginTab } from './growth.js';
import { VAULT_KIND_LABELS } from './vault.js';

export { MARGIN_TABS, MARGIN_TAB_LABELS, marginTab, type MarginTab };

export const MARGIN_TEXT = Object.freeze({
  title: 'Margin',
  line: 'In euros, at the rates of Margin settings. Not by release.',
  note: 'Paid orders of the window, before credits; returned and cancelled ones left out',
  empty: 'No paid order in this window.',
  settings: 'Margin settings',
  csv: 'Download CSV',
  missing: 'What is missing',
  missingNone: 'Nothing is missing for this window.',
  missingLead: 'Counted as 0 until it is entered.',
  vault: 'THE VAULT',
  vaultLead: 'What THE VAULT cost in this window, as the margin counts it: its parts are in the column THE VAULT.',
  vaultLink: 'THE VAULT’s report',
});

/**
 * THE VAULT line's own words, the server's (services/margin.ts MARGIN_VAULT_WORDS, held equal by admin.margin.test.ts):
 * a guaranteed piece (OP-22 "GUARANTEED · A piece at the next LIVE release", never a place), why the report's cost and
 * the margin can differ, the rewards without a supplier price, and where each reward's value and cost is read.
 */
export const MARGIN_VAULT_WORDS = Object.freeze({
  guaranteed: 'Guaranteed pieces: each is bought at its price, so it costs nothing here.',
  reading: "THE VAULT's report counts the rewards won in the window, as Club → THE VAULT shows them; the margin counts what was spent and shipped in it, so the two can differ.",
  costUnknown: (n: number): string => `${n} ${n === 1 ? 'reward' : 'rewards'} without a supplier price`,
  report: "Each reward's value and cost: Club → THE VAULT, its report.",
});

/** An amount in euros, its sign when below zero: `€ 4 800`, `−€ 50`. */
export const eur = (minor: number): string => money(minor, MARGIN_CURRENCY);

/** THE VAULT's five parts, summed (services/margin.ts vaultCostTotal). */
export function vaultTotal(v: MarginVaultCosts): number {
  return v.credits + v.creditsToGive + v.addons + v.productsWon + v.cards;
}

/** Every cost column of a group, PERKS' three parts and THE VAULT's five included (REVENUE − COSTS = MARGIN, as the server counts it). */
export function costTotal(c: MarginCosts): number {
  return c.piece + c.inbound + c.packaging + c.outbound + c.allowance + c.perks.credits + c.perks.freeShipping + c.perks.gifts + vaultTotal(c.vault) + c.careWarranty;
}

/** MARGIN % from hundredths of a percent, one decimal: `72.4 %`, `−3.0 %`; '—' without revenue. */
export function marginPercent(bp: number | null): string {
  if (bp === null || !Number.isFinite(bp)) return '—';
  const text = `${(Math.abs(bp) / 100).toFixed(1)} %`;
  return bp < 0 ? `−${text}` : text;
}

/** `Includes estimates for 3 orders`; null without one. */
export function estimateText(n: number): string | null {
  return n > 0 ? `Includes estimates for ${formatCount(n)} ${n === 1 ? 'order' : 'orders'}` : null;
}

export interface MarginKpi {
  key: 'revenue' | 'costs' | 'margin' | 'percent';
  label: string;
  value: string;
  note: string;
}

/** Revenue, Costs, Margin and Margin % of the window's totals. */
export function marginKpis(r: MarginReport): MarginKpi[] {
  const t = r.totals;
  const months = `IN ${r.window.months} MONTHS`;
  return [
    { key: 'revenue', label: 'Revenue', value: eur(t.revenueMinor), note: `${months} · BEFORE CREDITS` },
    { key: 'costs', label: 'Costs', value: eur(costTotal(t.costs)), note: 'PERKS, THE VAULT, CARE AND WARRANTY INCLUDED' },
    { key: 'margin', label: 'Margin', value: eur(t.marginMinor), note: t.estimated > 0 ? (estimateText(t.estimated) ?? '').toUpperCase() : 'NO ESTIMATE' },
    { key: 'percent', label: 'Margin %', value: marginPercent(t.marginBp), note: 'OF REVENUE' },
  ];
}

/** Whether the window holds nothing to show: no sale and no cost (care and warranty included). */
export function marginEmpty(r: MarginReport): boolean {
  return r.totals.orders === 0 && r.totals.revenueMinor === 0 && costTotal(r.totals.costs) === 0;
}

/** The tier view's names: the tier held when the order was paid. */
export const MARGIN_TIER_LABELS: Readonly<Record<string, string>> = Object.freeze({ PALLADIUM: 'PALLADIUM', PLATINE: 'PLATINE', TITANE: 'TITANE', NONE: 'Below TITANE' });

/** The channel view's names: Growth's for its sources, and a VAULT order as the Orders board names it (FROM THE VAULT). */
export const MARGIN_CHANNEL_LABELS: Readonly<Record<MarginChannel, string>> = Object.freeze({
  LIVE: SOURCE_LABELS.LIVE,
  DRAW: SOURCE_LABELS.DRAW,
  SALON: SOURCE_LABELS.SALON,
  VAULT: 'FROM THE VAULT',
  ELSEWHERE: SOURCE_LABELS.ELSEWHERE,
});

/** A group's name in the tab's terms: the model, the channel (ELSEWHERE: care and warranty only), the tier at payment. */
export function marginGroupLabel(tab: MarginTab, g: Pick<MarginGroup, 'key' | 'label'>): string {
  if (tab === 'model') return g.label ?? '—';
  if (tab === 'channel') return MARGIN_CHANNEL_LABELS[g.key as MarginChannel] ?? g.key;
  return MARGIN_TIER_LABELS[g.key] ?? g.key;
}

/** A line under a group's name, for the rows that need one. */
export function marginGroupHint(tab: MarginTab, g: Pick<MarginGroup, 'key'>): string | null {
  if (tab === 'channel' && g.key === 'ELSEWHERE') return 'Care and warranty on pieces no order sold';
  return null;
}

export interface MarginRow {
  key: string;
  label: string;
  hint: string | null;
  orders: string;
  revenue: string;
  piece: string;
  inbound: string;
  packaging: string;
  outbound: string;
  allowance: string;
  perks: string;
  /** PERKS' three parts, each on its line under the total; none while the total is 0. `text` is its label and amount
   *  on one line; the page sets the amount under its label on a narrower computer (below 1 280 px). */
  perkParts: { key: 'credits' | 'freeShipping' | 'gifts'; label: string; amount: string; text: string }[];
  vault: string;
  /** THE VAULT's five parts, as PERKS': each on its line under the total; none while the total is 0. */
  vaultParts: { key: keyof MarginVaultCosts; label: string; amount: string; text: string }[];
  care: string;
  margin: string;
  percent: string;
  loss: boolean;
  estimate: string | null;
}

/** One of PERKS' or THE VAULT's parts: `Credits € 100`, its label and its amount apart for the page. */
function part<K extends string>(key: K, label: string, minor: number): { key: K; label: string; amount: string; text: string } {
  const amount = eur(minor);
  return { key, label, amount, text: `${label} ${amount}` };
}

/** THE VAULT's five parts, as the column names them under its total. */
export const MARGIN_VAULT_PARTS: readonly { key: keyof MarginVaultCosts; label: string }[] = Object.freeze([
  { key: 'credits', label: 'Credits' },
  { key: 'creditsToGive', label: 'Credits to give' },
  { key: 'addons', label: 'Add-ons' },
  { key: 'productsWon', label: 'Products won' },
  { key: 'cards', label: 'Cards' },
]);

/** A group as its table row reads. */
export function marginRow(tab: MarginTab, g: MarginGroup): MarginRow {
  const c = g.costs;
  return {
    key: g.key,
    label: marginGroupLabel(tab, g),
    hint: marginGroupHint(tab, g),
    orders: formatCount(g.orders),
    revenue: eur(g.revenueMinor),
    piece: eur(c.piece),
    inbound: eur(c.inbound),
    packaging: eur(c.packaging),
    outbound: eur(c.outbound),
    allowance: eur(c.allowance),
    perks: eur(c.perks.credits + c.perks.freeShipping + c.perks.gifts),
    // Its three parts under the total, once there is a perk to part.
    perkParts:
      c.perks.credits + c.perks.freeShipping + c.perks.gifts === 0
        ? []
        : [part('credits', 'Credits', c.perks.credits), part('freeShipping', 'Free shipping', c.perks.freeShipping), part('gifts', 'Welcome gifts', c.perks.gifts)],
    vault: eur(vaultTotal(c.vault)),
    vaultParts: vaultTotal(c.vault) === 0 ? [] : MARGIN_VAULT_PARTS.map((v) => part(v.key, v.label, c.vault[v.key])),
    care: eur(c.careWarranty),
    margin: eur(g.marginMinor),
    percent: marginPercent(g.marginBp),
    loss: g.marginMinor < 0,
    estimate: estimateText(g.estimated),
  };
}

/** The tab's rows: the report's view, in its order (models by revenue, the channels and tiers in theirs). */
export function marginRows(r: MarginReport, tab: MarginTab): MarginRow[] {
  const groups = { model: r.byModel, channel: r.byChannel, tier: r.byTier }[tab];
  return groups.map((g) => marginRow(tab, g));
}

/** The table's head for the tab's first column. */
export const MARGIN_GROUP_HEAD: Readonly<Record<MarginTab, string>> = Object.freeze({ model: 'Model', channel: 'Channel', tier: 'Tier when paid' });

// ── THE VAULT's line (D61, OP-26, OP-22): beside the tables, never inside them ──

export interface VaultLineItem {
  key: 'claimed' | 'credits' | 'creditsToGive' | 'addons' | 'cards' | 'guaranteed';
  text: string;
  figure: string;
  /** A second line under it (THE VAULT CARDs estimated before packing); null for none. */
  note: string | null;
}

/** THE VAULT's counts and costs in the window, as the margin counts them (its parts are the column's). Never a release, an account or a vault. */
export function vaultLineItems(v: MarginVaultLine): VaultLineItem[] {
  return [
    { key: 'claimed', text: 'Products won, claimed (VAULT orders at 0)', figure: `${plural(v.claimed.orders, 'order', 'orders')} · ${eur(v.claimed.costMinor)}`, note: null },
    { key: 'credits', text: 'Vault credits used', figure: `${plural(v.credits.orders, 'order', 'orders')} · ${eur(v.credits.costMinor)}`, note: null },
    { key: 'creditsToGive', text: 'Credits to give used', figure: `${plural(v.creditsToGive.orders, 'order', 'orders')} · ${eur(v.creditsToGive.costMinor)}`, note: null },
    { key: 'addons', text: 'Free add-ons given', figure: `${plural(v.addons.units, 'unit', 'units')} · ${eur(v.addons.costMinor)}`, note: null },
    {
      key: 'cards',
      text: 'THE VAULT CARDs packed',
      figure: `${plural(v.cards.cards, 'card', 'cards')} · ${eur(v.cards.costMinor)}`,
      note: v.cards.estimated > 0 ? `${plural(v.cards.estimated, 'card', 'cards')} estimated before packing` : null,
    },
    { key: 'guaranteed', text: MARGIN_VAULT_WORDS.guaranteed, figure: plural(v.guaranteedPieces, 'piece', 'pieces'), note: null },
  ];
}

export interface VaultReportCost {
  text: string;
  /** The report's cost in euros, at the rates of Margin settings. */
  figure: string;
  /** Each reward kind with a cost, as Club → THE VAULT names it: `House credit € 50 · Product € 120`; null for none. */
  kinds: string | null;
  /** `2 rewards without a supplier price`, shown only when the report has any, so a partial cost never reads as whole. */
  unknown: string | null;
}

/** The report's cost of the rewards won in the window: CLUB > THE VAULT's own reading, in euros. */
export function vaultReportCost(v: MarginVaultLine): VaultReportCost {
  const kinds = v.rewardsCost.byKind.filter((k) => k.costMinor !== 0).map((k) => `${VAULT_KIND_LABELS[k.kind] ?? k.kind} ${eur(k.costMinor)}`);
  return {
    text: 'The report’s cost of the rewards won',
    figure: eur(v.rewardsCost.costMinor),
    kinds: kinds.length ? kinds.join(' · ') : null,
    unknown: v.rewardsCost.costUnknown > 0 ? MARGIN_VAULT_WORDS.costUnknown(v.rewardsCost.costUnknown) : null,
  };
}

/** Where each reward's value and cost is read: Club → THE VAULT, its report. */
export const vaultReportHref = (): string => href('club', {}, { tab: 'vault' });

/** Whether THE VAULT's line holds nothing in the window: no count, no cost, no reward won. */
export function vaultLineEmpty(v: MarginVaultLine): boolean {
  return (
    v.claimed.orders + v.credits.orders + v.creditsToGive.orders + v.addons.units + v.cards.cards + v.guaranteedPieces === 0 &&
    v.claimed.costMinor + v.credits.costMinor + v.creditsToGive.costMinor + v.addons.costMinor + v.cards.costMinor + v.rewardsCost.costMinor === 0 &&
    v.rewardsCost.costUnknown === 0 &&
    v.rewardsCost.byKind.every((k) => k.cost.length === 0)
  );
}

// ── Partner experiences (K49, P1): beside the margin, never inside it ──────

/**
 * `Partner experiences: € 12 000 invoiced in this window, € 8 000 paid.` (every partner's, in euros at the owner's
 * rates); null while no partner income is recorded (step M4.6 fills it): the line then shows nothing.
 */
export function partnerLine(r: Pick<MarginReport, 'partnerIncome'>): string | null {
  const list = r.partnerIncome ?? [];
  if (list.length === 0) return null;
  const invoiced = list.reduce((n, p) => n + p.invoicedMinor, 0);
  const paid = list.reduce((n, p) => n + p.paidMinor, 0);
  return `Partner experiences: ${eur(invoiced)} invoiced in this window, ${eur(paid)} paid.`;
}

// ── What is missing ────────────────────────────────────────────────────────

/** A unit cost's name, as Margin settings writes it. */
export function unitCostLabel(key: MarginUnitCostKey): string {
  if (key === 'POUCH') return 'POUCH';
  if (key === 'CARD') return 'CARD';
  if (key === 'VAULT_CARD') return 'THE VAULT CARD';
  if (key === 'CARE_SERVICE') return 'PRIVATE CARE service';
  return `Claim: ${key.slice('CLAIM_'.length).replace(/_/g, ' ')}`;
}

export interface MissingItem {
  key: string;
  text: string;
  /** Where it is fixed. */
  fix: { label: string; route: RouteName; href: string };
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Each item the margin counted as 0, with its count and where to fix it; empty when nothing is missing. */
export function missingItems(m: MarginMissing): MissingItem[] {
  const settings = { label: MARGIN_TEXT.settings, route: 'marginSettings' as const, href: href('marginSettings') };
  const out: MissingItem[] = [];
  for (const c of m.currencies) {
    out.push({
      key: `currency-${c.currency}`,
      text: `${plural(c.amounts, 'amount', 'amounts')} in ${c.currency} ${c.amounts === 1 ? 'has' : 'have'} no rate: ${c.amounts === 1 ? 'it is' : 'they are'} left out.`,
      fix: settings,
    });
  }
  if (m.piecePrices > 0) {
    out.push({
      key: 'piece-prices',
      text: `${plural(m.piecePrices, 'piece or unit has', 'pieces or units have')} no supplier price.`,
      fix: { label: 'A supplier order’s prices', route: 'supplierOrders', href: href('supplierOrders') },
    });
  }
  if (m.parcelWeights > 0) {
    out.push({
      key: 'parcel-weights',
      text: `${plural(m.parcelWeights, 'parcel has', 'parcels have')} no weight.`,
      fix: { label: 'The model’s Packing', route: 'catalogue', href: href('catalogue') },
    });
  }
  if (m.boxCosts > 0) {
    out.push({
      key: 'box-costs',
      text: `${plural(m.boxCosts, 'parcel has', 'parcels have')} no box, or a box without a cost.`,
      fix: { label: 'Boxes, in Orders → Settings', route: 'settings', href: href('settings') },
    });
  }
  if (m.shippingRates > 0) {
    out.push({
      key: 'shipping-rates',
      text: `${plural(m.shippingRates, 'parcel has', 'parcels have')} no shipping band for ${m.shippingRates === 1 ? 'its' : 'their'} country and weight.`,
      fix: settings,
    });
  }
  for (const a of m.allowances) {
    out.push({
      key: `allowance-${a.categoryId}`,
      text: `${a.name} (${a.code}) has no returns and claims allowance: ${plural(a.orders, 'order', 'orders')}.`,
      fix: settings,
    });
  }
  if (m.unitCosts.length > 0) {
    out.push({ key: 'unit-costs', text: `Not set: ${m.unitCosts.map(unitCostLabel).join(', ')}.`, fix: settings });
  }
  return out;
}
