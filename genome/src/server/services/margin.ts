/**
 * The margin on GROWTH (macro scope of 2026-10-20, K43 N1, N2 and N3; D61 "M4's margin counts the converted add-ons and
 * the vault's cost"; lot M4 plan §1.1 and §1.2, step M4.3): what an order brings in and what it costs, in euros, by model,
 * channel and tier, with THE VAULT's cost. MarginService only reads: it writes nothing, audits nothing, keeps no snapshot
 * and no cache; one REPEATABLE READ, READ ONLY transaction per reading, as GROWTH.
 *
 *   report  GET /api/admin/margin?months=12|24&test= (AUDITOR): GROWTH's window (its UTC months, services/growth.ts
 *           GROWTH_WINDOWS), the totals, the three views, THE VAULT's line, the partner income (in euros, by partner), how many
 *           orders hold an estimate and what is missing. Amounts, counts and groups only: no account, no email, no vault,
 *           no release.
 *   csv     GET /api/admin/margin.csv (AUDITOR): the totals and the three views, in euros, THE VAULT's five parts as
 *           columns, `orbes-margin-<Paris day>.csv`.
 *
 * The rules (plan §1.1, the scope's N1 to N3, D61):
 *
 *   - An order counts when it is paid in the window, its channel LIVE, DRAW, SALON or VAULT (the Shopify store's channel
 *     joins when the sync creates its orders: same rule, S2 and S3), never a GIFT or an EXCHANGE order (costs of another
 *     order), its account not a test entrant (`notTestEntrant`, as GROWTH; `test` reads them too), and it is not
 *     CANCELLED or RETURNED. A size exchange returns the original order and pays an EXCHANGE order in its place
 *     (services/orders.ts createExchangeOrder): the sale goes on through it, so an order and its exchanges are one sale
 *     (its « chain »), counted once under the original (its payment, channel, model and buyer), while its last order is
 *     not CANCELLED or RETURNED. A returned or cancelled sale is not counted: the allowance stands for it.
 *   - REVENUE: what the chain's invoices bill before credits: its invoices (supplementary ones included) less its credit
 *     notes, with their CREDIT lines added back. Each CREDIT line goes to its grant's kind (`credit_uses` → `tier_grants`):
 *     `CREDIT · VAULT` to THE VAULT, as a credit to give when its grant is a friend's accepted `vault_gifts` credit (the
 *     order's uses not removed say how much), else as a house credit won; every other one (a tier's CREDIT, BIRTHDAY,
 *     WARRANTY) to PERKS. So REVENUE − PERKS' credits − THE VAULT's credits − THE VAULT's credits to give is GROWTH's net
 *     revenue for the same orders. The old release add-ons and engravings (`orders.addons`, `engraving_minor`), catalogue
 *     add-on units of both kinds and the shipping charged are revenue. A VAULT order at 0 has REVENUE 0.
 *   - PIECE and INBOUND: each piece's supplier unit price (`supplier_order_lines.unit_price_minor`, in its supplier
 *     order's currency) and its share of that supplier order's `shipping_minor`, shared equally over the pieces and units
 *     it brings (its lines' quantity less what was cancelled or credited), traced through `products.reception_line_id`;
 *     a piece not bound yet, or not traced, is an estimate: its SKU's average over the pieces accepted, else its latest
 *     priced line sent; else it is missing (counted 0), never priced from another SKU. A catalogue add-on unit HELD or
 *     SHIPPED by its kind (lot Q2, D): a PRODUCT at its SKU's average (add-ons are not traced one by one), never a pouch
 *     or a card; a SERVICE (the engraving, a converted release add-on: no supplier) costs nothing and is never missing; a
 *     unit of source VAULT (the vault's free add-on, a PRODUCT at 0) goes to THE VAULT's add-ons. A piece a parcel problem
 *     lost or archived and reshipped (`order_cases` RESHIP, its piece REVOKED or ARCHIVED) adds its own cost, pouch and
 *     card; the piece of an order a size exchange returned came back to stock and costs nothing (its pouch and card do),
 *     unless its return sent it to the archive.
 *   - PACKAGING: each parcel's box cost (its shipment's box, written at PACKED; before, the box packing would suggest:
 *     services/parcels.ts suggestPacking, an estimate) shared equally over the parcel's paid orders, plus the POUCH and the
 *     CARD per piece (the owner's unit costs).
 *   - OUTBOUND: each parcel's cost from the owner's bands (margin-settings.ts): its first order's delivery country, its
 *     weight (`shipments.weight_g` at PACKED, else the computed weight, `parcelWeight`, an estimate, a service unit adding
 *     its weight when it has one), the smallest band of that country holding the weight, else of ALL OTHER COUNTRIES (a
 *     parcel without a country takes ALL OTHER COUNTRIES), shared equally over the parcel's paid orders. Every parcel of
 *     the chain counts: a size exchange's, a reshipment's. No carrier cost is entered at shipping (N1); Shopify's shipping
 *     rates are prices to the buyer, never these costs.
 *   - ALLOWANCE: the category's returns and claims allowance, a percent of the order's REVENUE (0 on a VAULT order at 0).
 *   - PERKS: the credits used (PERKS' kinds); the free shipping (a parcel whose first order's shipping was made free by
 *     its tier, `shipping_benefit` 2 or 3: its OUTBOUND moves here); the welcome gifts travelling with the order (each GIFT
 *     order not cancelled or returned: its PIECE, INBOUND, POUCH and CARD).
 *   - THE VAULT (D61): what THE VAULT cost on this sale, in five parts: its credits (house credits won, used), its credits
 *     to give (a friend's credit for a first piece, used), its add-ons (each free unit of source VAULT: its SKU's average),
 *     its products won (a VAULT order at 0: its whole PIECE, INBOUND, box share, POUCH, CARD and OUTBOUND, free shipping
 *     included, moved here from their columns, as a gift's go to PERKS), its cards (THE VAULT CARD of each order whose box
 *     holds it, at the owner's unit cost VAULT_CARD: the parcel's stored checklist line once packed, else the rule of
 *     services/parcels.ts vaultCardOrders, an estimate). A VAULT order bought under its RIGHT TO BUY is a sale like any
 *     (its own columns, channel VAULT). A guaranteed piece is bought at its price: counted on the line, never costed.
 *   - CARE & WARRANTY: each PRIVATE CARE request DONE and each warranty claim decided in the window, at the owner's cost
 *     per service and per outcome, on its piece: its model, the channel of the order that sold it (a piece won from the
 *     vault: VAULT; none, a gift or a replacement: ELSEWHERE, a row of the channel view carrying only these costs), its
 *     owner's tier on that day.
 *   - MARGIN = REVENUE − every cost; MARGIN % = MARGIN / REVENUE (null when REVENUE is 0), in hundredths of a percent.
 *   - N2: every amount in euros, converted at the owner's rate for its currency (the rate in force, for the whole
 *     history); an amount in a currency without a rate is left out (counted 0) and named with its count. Every currency
 *     of the house has two decimals, so a minor unit converts as one.
 *   - N3: by model (the main model, a variant folded into it, as GROWTH's revenue by model; a set's pieces each under its
 *     own model; a VAULT order at 0 under its model, THE PIECE and a VAULT EDITION included), by channel (LIVE, DRAW,
 *     SALON, VAULT, ELSEWHERE) and by tier at payment (from the pieces the buyer held then, as GROWTH's funnel reads the
 *     ownership history; NONE below TITANE). Never by release: no release is read out, in the report, the CSV or the
 *     line; `house_guarantees.used_drop_id` is read only to count a guarantee's use.
 *   - THE VAULT's line (D61, OP-26, OP-22), beside the views, never inside them: its counts and costs follow the margin's
 *     rules (paid or used in the window, CANCELLED and RETURNED out, test entrants out unless `test`), so its VAULT orders
 *     at 0 claimed cost the column's products won and its credits, credits to give, free add-ons and cards are the
 *     column's parts; the LIVE guarantees from a vault used in the window (a piece each, bought at its price: they cost
 *     nothing here); and the report's cost of the rewards won (`rewardsCost`): THE VAULT report's own reading of the vaults
 *     opened in the window (services/vault.ts vaultRewardCosts, every vault, as CLUB > THE VAULT shows it), by reward kind,
 *     with its rewards won without a supplier price (`costUnknown`); its amounts in a currency without a rate are left out
 *     and named in `missing`. The report counts the rewards won; the margin what was spent and shipped: the two can differ.
 *   - Estimates never block the report: `estimated` counts the orders holding one, and `missing` names what is counted
 *     as 0 (pieces without a supplier price, parcels without a weight, without a band or without a box cost, categories
 *     without an allowance, unit costs not set, amounts without a rate).
 *   - Rounding: each order's figures are summed in euro cents as exact fractions, rounded once per order and column; a
 *     parcel's box and band are shared in their own minor units by largest remainder first (`shareEqually`).
 */
import { sql } from 'kysely';
import { uuidArray, type Db } from '../db/connection.js';
import { MARGIN_CURRENCY, type MarginUnitCostKey, type OrderChannel, type OrderStatus, type VaultRewardKind, type WarrantyClaimOutcome } from '../db/schema.js';
import { validationError } from '../errors.js';
import { csvField, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Clock } from '../types.js';
import { boxRef, modelPackings, type BoxRef } from './boxes.js';
import { CLUB_TIER_NAMES, clubCounts, CLUB_TIER_THRESHOLDS, tierName } from './club.js';
import { GROWTH_WINDOWS, heldAt, monthsOfWindow, monthStart, partnerIncomeRows, tierAt, type GrowthWindowMonths, type PartnerIncomeRow } from './growth.js';
import { marginSettingRows, type MarginSettingRows } from './margin-settings.js';
import { parcelAddonItems } from './order-addons.js';
import { parcelWeight, suggestPacking, vaultCardOrders } from './parcels.js';
import { notTestEntrant } from './population.js';
import { parisDay } from './schedule.js';
import { addUtcMonths } from './tier-grants.js';
import { byHouseCurrency, orderOfABoughtPiece, vaultRewardCosts, VAULT_GRID, type VaultMoney } from './vault.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** The channel view's rows: the orders' channels, then ELSEWHERE (care and warranty on pieces no order sold). */
export const MARGIN_CHANNELS = Object.freeze(['LIVE', 'DRAW', 'SALON', 'VAULT', 'ELSEWHERE'] as const);
export type MarginChannel = (typeof MARGIN_CHANNELS)[number];
/** The channels a sale is counted under: every order channel but a GIFT and an EXCHANGE (costs of another order). */
type SaleChannel = Exclude<OrderChannel, 'GIFT' | 'EXCHANGE'>;
/**
 * Compile-time check: every sale channel has its row in MARGIN_CHANNELS. A channel added to ORDER_CHANNELS (the Shopify
 * store's at the sync, S2) fails to compile here until it is given its row, never silently missing from byChannel.
 */
const EVERY_SALE_CHANNEL_HAS_ITS_ROW: [Exclude<SaleChannel, MarginChannel>] extends [never] ? true : never = true;
void EVERY_SALE_CHANNEL_HAS_ITS_ROW;
/** The tier view's rows, the highest first. */
export const MARGIN_TIERS = Object.freeze([...[...CLUB_TIER_NAMES].reverse(), 'NONE'] as const);
export type MarginTier = (typeof MARGIN_TIERS)[number];
/** The views of the report, as the console's tabs name them. */
export const MARGIN_VIEWS = Object.freeze(['byModel', 'byChannel', 'byTier'] as const);

/**
 * THE VAULT line's words (plan §1.1, §1.3; OP-22 "GUARANTEED · A piece at the next LIVE release": a guaranteed piece,
 * never a place), as the console's Margin section says them (step M4.4).
 */
export const MARGIN_VAULT_WORDS = Object.freeze({
  guaranteed: 'Guaranteed pieces: each is bought at its price, so it costs nothing here.',
  reading: "THE VAULT's report counts the rewards won in the window, as Club → THE VAULT shows them; the margin counts what was spent and shipped in it, so the two can differ.",
  costUnknown: (n: number): string => `${n} ${n === 1 ? 'reward' : 'rewards'} without a supplier price`,
  report: "Each reward's value and cost: Club → THE VAULT, its report.",
});

/** The invoice line of a vault's credits (services/invoices.ts: `CREDIT · VAULT`, one per order). */
const VAULT_CREDIT_LABEL = 'CREDIT · VAULT';
const DONE_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'RETURNED'];

// ── Pure functions ─────────────────────────────────────────────────────────

/**
 * `total` minor units shared equally over `n`, by largest remainder: each gets the floor, the first ones one more until
 * the remainder is spent; the shares add up to `total`. Empty for n < 1.
 */
export function shareEqually(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) return [];
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** A band of the outbound shipping cost table (margin-settings.ts). */
export interface ShippingBand {
  country: string | null;
  maxWeightG: number;
  costMinor: number;
  currency: string;
}

/**
 * The band a parcel of `country` weighing `weightG` takes: the smallest of its country's bands whose limit holds the
 * weight, else the smallest of ALL OTHER COUNTRIES' (`country` null) that does; null when none holds it. A parcel without
 * a country reads ALL OTHER COUNTRIES.
 */
export function rateFor(country: string | null, weightG: number, bands: readonly ShippingBand[]): ShippingBand | null {
  const smallest = (c: string | null) =>
    bands.filter((b) => b.country === c && b.maxWeightG >= weightG).sort((a, b) => a.maxWeightG - b.maxWeightG)[0] ?? null;
  return (country !== null ? smallest(country) : null) ?? smallest(null);
}

/** Converts amounts to euros at the owner's rates, counting the amounts left out by currency (N2). */
export class EuroConverter {
  /** The amounts (not zero) seen in a currency without a rate, by currency. */
  readonly missing = new Map<string, number>();

  constructor(private readonly rates: ReadonlyMap<string, number>) {}

  /** `minor` of `currency` in euro cents (a fraction); 0 and counted when the currency has no rate. */
  eur(minor: number, currency: string | null): number {
    if (minor === 0) return 0;
    if (currency === MARGIN_CURRENCY) return minor;
    const rate = currency ? this.rates.get(currency) : undefined;
    if (rate === undefined) {
      const c = currency ?? 'NONE';
      this.missing.set(c, (this.missing.get(c) ?? 0) + 1);
      return 0;
    }
    return minor * rate;
  }

  /** An amount of `currency` left out (no rate), counted without being converted. */
  leftOut(currency: string): void {
    this.missing.set(currency, (this.missing.get(currency) ?? 0) + 1);
  }

  /** Whether a currency converts (EUR, or one with a rate). */
  has(currency: string | null): boolean {
    return currency === MARGIN_CURRENCY || (currency !== null && this.rates.has(currency));
  }
}

// ── Shapes ─────────────────────────────────────────────────────────────────

/** THE VAULT's five parts of a group's costs (euro cents, D61). */
export interface MarginVaultCosts {
  /** House credits won, used on the sale (CREDIT · VAULT lines whose grant is not a credit to give). */
  credits: number;
  /** A friend's credit for a first piece, used on the sale (its grant the accepted `vault_gifts` credit's). */
  creditsToGive: number;
  /** The vault's free add-on units (source VAULT, a PRODUCT at 0): their SKU's average. */
  addons: number;
  /** A VAULT order at 0: its whole PIECE, INBOUND, box share, POUCH, CARD and OUTBOUND. */
  productsWon: number;
  /** THE VAULT CARD of each order whose box holds it, at VAULT_CARD. */
  cards: number;
}

/** The cost columns of a group (euro cents). */
export interface MarginCosts {
  piece: number;
  inbound: number;
  packaging: number;
  outbound: number;
  allowance: number;
  perks: { credits: number; freeShipping: number; gifts: number };
  vault: MarginVaultCosts;
  careWarranty: number;
}

/** A row of a view, or the totals. */
export interface MarginGroup {
  /** A main model's id, a channel (MARGIN_CHANNELS), a tier (MARGIN_TIERS), or 'ALL' for the totals. */
  key: string;
  /** The model's name; null for a channel, a tier and the totals. */
  label: string | null;
  /** The sales counted (one per piece sold, a VAULT order at 0 included). */
  orders: number;
  /** The pieces that left: those sold or won and the welcome gifts travelling with them. */
  pieces: number;
  revenueMinor: number;
  costs: MarginCosts;
  marginMinor: number;
  /** MARGIN / REVENUE in hundredths of a percent; null when REVENUE is 0. */
  marginBp: number | null;
  /** How many of its orders hold an estimate (a piece not bound or not traced, a parcel not packed). */
  estimated: number;
}

/** What the margin counts as 0, and where the owner fixes it. */
export interface MarginMissing {
  /** Pieces and add-on units without any supplier price (a supplier order's prices). */
  piecePrices: number;
  /** Parcels whose weight is unknown (the model's Packing). */
  parcelWeights: number;
  /** Parcels with a weight that no band holds, for their country or ALL OTHER COUNTRIES (Margin settings). */
  shippingRates: number;
  /** Parcels without a box, or whose box has no cost (Orders → Settings → Boxes). */
  boxCosts: number;
  /** The categories of counted orders without an allowance, each with its orders (Margin settings). */
  allowances: { categoryId: number; code: string; name: string; orders: number }[];
  /** The unit costs the window needs and that are not set (Margin settings). */
  unitCosts: MarginUnitCostKey[];
  /** The amounts in a currency without a rate, left out (Margin settings), THE VAULT report's cost amounts included. */
  currencies: { currency: string; amounts: number }[];
}

/** The report's cost of one reward kind won in the window (its own reading, CLUB > THE VAULT's). */
export interface MarginRewardKindCost {
  kind: VaultRewardKind;
  /** The report's cost by currency, before conversion (as VaultService.report's byKind). */
  cost: VaultMoney[];
  /** In euros at the owner's rates, an amount without a rate left out (and named in `missing`). */
  costMinor: number;
  /** Its rewards won without a supplier price. */
  costUnknown: number;
}

/** THE VAULT's line (plan §1.1; D61, OP-26, OP-22): beside the views, never inside them. No account, vault or release. */
export interface MarginVaultLine {
  /** The VAULT orders at 0 claimed (paid) in the window and counted: the column's products won. */
  claimed: { orders: number; costMinor: number };
  /** The sales on which a house credit won was used, and its cost: the column's credits. */
  credits: { orders: number; costMinor: number };
  /** The sales on which a friend's credit to give was used, and its cost: the column's credits to give. */
  creditsToGive: { orders: number; costMinor: number };
  /** The vault's free add-on units on the counted sales, and their cost: the column's add-ons. */
  addons: { units: number; costMinor: number };
  /** THE VAULT CARDs of the counted sales (`estimated` of them before packing), and their cost: the column's cards. */
  cards: { cards: number; estimated: number; costMinor: number };
  /** LIVE guarantees from a vault used in the window: a piece each, bought at its price, so it costs nothing here. */
  guaranteedPieces: number;
  /** The report's cost of the rewards won in the window: every vault opened, as CLUB > THE VAULT reads it. */
  rewardsCost: { byKind: MarginRewardKindCost[]; costMinor: number; costUnknown: number };
}

/** A partner's income beside the margin (K49, P1; step M4.6), in euros: invoiced in the window net of its credit notes, and paid. */
export interface MarginPartnerIncome {
  partnerId: string;
  brand: string;
  invoicedMinor: number;
  paidMinor: number;
}

export interface MarginReport {
  window: { months: GrowthWindowMonths; from: string; to: string; list: string[]; currency: typeof MARGIN_CURRENCY; test: boolean; generatedAt: Date };
  currency: typeof MARGIN_CURRENCY;
  totals: MarginGroup;
  byModel: MarginGroup[];
  byChannel: MarginGroup[];
  byTier: MarginGroup[];
  vault: MarginVaultLine;
  /** Beside the margin, never inside its views: each partner with income in the window (none: empty). */
  partnerIncome: MarginPartnerIncome[];
  /** Orders holding an estimate, over the window. */
  estimated: number;
  missing: MarginMissing;
}

// ── Internal rows ──────────────────────────────────────────────────────────

interface ChainRow {
  root_id: string;
  depth: number;
  id: string;
  channel: OrderChannel;
  account_id: string;
  model_id: string;
  sku_id: string | null;
  status: OrderStatus;
  paid_at: Date | string | null;
  price_minor: number | string | null;
  product_id: string | null;
  with_order_id: string | null;
  main_model_id: string;
  main_model_name: string;
  category_id: number;
}

interface MemberRow {
  id: string;
  channel: OrderChannel;
  status: OrderStatus;
  paid_at: Date | string | null;
  price_minor: number | null;
  with_order_id: string | null;
  model_id: string;
  sku_id: string | null;
  product_id: string | null;
  shipping_benefit: number | null;
  buyer_country: string | null;
  reserved_at: Date | string;
}

interface ShipmentRead {
  id: string;
  order_id: string;
  packed_at: Date | null;
  box_id: string | null;
  weight_g: number | null;
  checklist: { key: string; label: string }[] | null;
}

interface LineRow {
  sku_id: string;
  unit_price_minor: number | null;
  quantity: number;
  accepted_quantity: number;
  rest_cancelled_quantity: number;
  credited_quantity: number;
  so_id: string;
  currency: string | null;
  shipping_minor: number | null;
  status: string;
  sent_at: Date | string | null;
}

/** A piece's cost in its own currency: its unit price and inbound share, or an average already in euros. */
type PieceCost =
  | { kind: 'TRACED'; priceMinor: number; inboundMinor: number; currency: string | null }
  | { kind: 'AVERAGE'; priceEur: number; inboundEur: number }
  | { kind: 'UNCONVERTED'; currency: string }
  | { kind: 'NONE' };

/** One sale's figures, in euro cents (fractions until rounded). */
export interface Sale {
  rootId: string;
  modelId: string;
  modelName: string;
  categoryId: number;
  channel: MarginChannel;
  tier: MarginTier;
  /** A VAULT order at 0 (D61): its piece's, box's and band's costs are THE VAULT's products won. */
  wonFree: boolean;
  pieces: number;
  revenue: number;
  credits: number;
  vaultCredits: number;
  vaultCreditsToGive: number;
  /** The chain's own pieces, boxes and bands (THE VAULT's products won on a VAULT order at 0). */
  piece: number;
  inbound: number;
  packaging: number;
  outbound: number;
  freeShipping: number;
  /** Its catalogue add-on units bought (PRODUCT), always in PIECE and INBOUND. */
  addonPiece: number;
  addonInbound: number;
  gifts: number;
  vaultAddons: number;
  vaultAddonUnits: number;
  cards: number;
  cardCount: number;
  cardsEstimated: number;
  estimated: boolean;
}

/** A care service or a warranty claim's cost, on its piece's group. */
interface CareItem {
  modelId: string;
  modelName: string;
  channel: MarginChannel;
  tier: MarginTier;
  cost: number;
}

const dateOf = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const num = (v: unknown): number => Number(v ?? 0);

// ── Aggregation (pure) ─────────────────────────────────────────────────────

const zeroVault = (): MarginVaultCosts => ({ credits: 0, creditsToGive: 0, addons: 0, productsWon: 0, cards: 0 });
const zeroCosts = (): MarginCosts => ({ piece: 0, inbound: 0, packaging: 0, outbound: 0, allowance: 0, perks: { credits: 0, freeShipping: 0, gifts: 0 }, vault: zeroVault(), careWarranty: 0 });

/** A sale rounded to cents, column by column, with its allowance (a percent of its rounded revenue). */
export interface RoundedSale {
  sale: Sale;
  revenue: number;
  costs: MarginCosts;
}

/** THE VAULT's five parts, summed. */
export const vaultCostTotal = (v: MarginVaultCosts): number => v.credits + v.creditsToGive + v.addons + v.productsWon + v.cards;

export function costTotal(c: MarginCosts): number {
  return c.piece + c.inbound + c.packaging + c.outbound + c.allowance + c.perks.credits + c.perks.freeShipping + c.perks.gifts + vaultCostTotal(c.vault) + c.careWarranty;
}

function addCosts(to: MarginCosts, c: MarginCosts): void {
  to.piece += c.piece;
  to.inbound += c.inbound;
  to.packaging += c.packaging;
  to.outbound += c.outbound;
  to.allowance += c.allowance;
  to.perks.credits += c.perks.credits;
  to.perks.freeShipping += c.perks.freeShipping;
  to.perks.gifts += c.perks.gifts;
  to.vault.credits += c.vault.credits;
  to.vault.creditsToGive += c.vault.creditsToGive;
  to.vault.addons += c.vault.addons;
  to.vault.productsWon += c.vault.productsWon;
  to.vault.cards += c.vault.cards;
  to.careWarranty += c.careWarranty;
}

function group(key: string, label: string | null, sales: readonly RoundedSale[], care: readonly CareItem[]): MarginGroup {
  const costs = zeroCosts();
  let revenue = 0;
  let pieces = 0;
  let estimated = 0;
  for (const s of sales) {
    revenue += s.revenue;
    pieces += s.sale.pieces;
    if (s.sale.estimated) estimated += 1;
    addCosts(costs, s.costs);
  }
  for (const c of care) costs.careWarranty += c.cost;
  const marginMinor = revenue - costTotal(costs);
  return { key, label, orders: sales.length, pieces, revenueMinor: revenue, costs, marginMinor, marginBp: revenue !== 0 ? Math.round((marginMinor * 10_000) / revenue) : null, estimated };
}

/** The totals and the three views of rounded sales and care items (N3). */
export function marginViews(sales: readonly RoundedSale[], care: readonly CareItem[]): Pick<MarginReport, 'totals' | 'byModel' | 'byChannel' | 'byTier'> {
  const models = new Map<string, string>();
  for (const s of sales) models.set(s.sale.modelId, s.sale.modelName);
  for (const c of care) models.set(c.modelId, c.modelName);
  const byModel = [...models.entries()]
    .map(([id, name]) => group(id, name, sales.filter((s) => s.sale.modelId === id), care.filter((c) => c.modelId === id)))
    .sort((a, b) => b.revenueMinor - a.revenueMinor || (a.label! < b.label! ? -1 : a.label! > b.label! ? 1 : a.key < b.key ? -1 : 1));
  return {
    totals: group('ALL', null, sales, care),
    byModel,
    byChannel: MARGIN_CHANNELS.map((ch) => group(ch, null, sales.filter((s) => s.sale.channel === ch), care.filter((c) => c.channel === ch))),
    byTier: MARGIN_TIERS.map((t) => group(t, null, sales.filter((s) => s.sale.tier === t), care.filter((c) => c.tier === t))),
  };
}

/**
 * A sale rounded (each column once) with its allowance: `bp` hundredths of a percent of its rounded revenue. A VAULT order
 * at 0 (`wonFree`) moves its own piece's, box's and band's costs, free shipping included, to THE VAULT's products won; its
 * add-on units bought stay in PIECE and INBOUND.
 */
export function roundSale(sale: Sale, allowanceBp: number | null): RoundedSale {
  const revenue = Math.round(sale.revenue);
  const won = sale.wonFree;
  return {
    sale,
    revenue,
    costs: {
      piece: Math.round(won ? sale.addonPiece : sale.piece + sale.addonPiece),
      inbound: Math.round(won ? sale.addonInbound : sale.inbound + sale.addonInbound),
      packaging: won ? 0 : Math.round(sale.packaging),
      outbound: won ? 0 : Math.round(sale.outbound),
      allowance: allowanceBp ? Math.round((revenue * allowanceBp) / 10_000) : 0,
      perks: { credits: Math.round(sale.credits), freeShipping: won ? 0 : Math.round(sale.freeShipping), gifts: Math.round(sale.gifts) },
      vault: {
        credits: Math.round(sale.vaultCredits),
        creditsToGive: Math.round(sale.vaultCreditsToGive),
        addons: Math.round(sale.vaultAddons),
        productsWon: won ? Math.round(sale.piece + sale.inbound + sale.packaging + sale.outbound + sale.freeShipping) : 0,
        cards: Math.round(sale.cards),
      },
      careWarranty: 0,
    },
  };
}

/** THE VAULT line's counts and costs from the rounded sales (the column's parts, by construction), with its guarantees and the report's cost. */
export function vaultLine(sales: readonly RoundedSale[], guaranteedPieces: number, rewardsCost: MarginVaultLine['rewardsCost']): MarginVaultLine {
  const line: MarginVaultLine = {
    claimed: { orders: 0, costMinor: 0 },
    credits: { orders: 0, costMinor: 0 },
    creditsToGive: { orders: 0, costMinor: 0 },
    addons: { units: 0, costMinor: 0 },
    cards: { cards: 0, estimated: 0, costMinor: 0 },
    guaranteedPieces,
    rewardsCost,
  };
  for (const { sale, costs } of sales) {
    if (sale.wonFree) {
      line.claimed.orders += 1;
      line.claimed.costMinor += costs.vault.productsWon;
    }
    if (costs.vault.credits !== 0) line.credits.orders += 1;
    line.credits.costMinor += costs.vault.credits;
    if (costs.vault.creditsToGive !== 0) line.creditsToGive.orders += 1;
    line.creditsToGive.costMinor += costs.vault.creditsToGive;
    line.addons.units += sale.vaultAddonUnits;
    line.addons.costMinor += costs.vault.addons;
    line.cards.cards += sale.cardCount;
    line.cards.estimated += sale.cardsEstimated;
    line.cards.costMinor += costs.vault.cards;
  }
  return line;
}

// ── CSV ────────────────────────────────────────────────────────────────────

export const MARGIN_CSV_COLUMNS = Object.freeze([
  'View',
  'Group',
  'Orders',
  'Pieces',
  'Revenue (EUR)',
  'Piece',
  'Inbound',
  'Packaging',
  'Outbound',
  'Allowance',
  'Perks: credits',
  'Perks: free shipping',
  'Perks: welcome gifts',
  'THE VAULT: credits',
  'THE VAULT: credits to give',
  'THE VAULT: add-ons',
  'THE VAULT: products won',
  'THE VAULT: cards',
  'Care and warranty',
  'Margin',
  'Margin %',
  'Orders with estimates',
] as const);

const euros = (minor: number): string => (minor / 100).toFixed(2);
const percent = (bp: number | null): string => (bp === null ? '' : (bp / 100).toFixed(2));

/** A figure the margin writes: a plain number, a minus sign at most before it (`-10.00`), never anything else. */
const FIGURE = /^-?\d+(?:\.\d+)?$/;

/**
 * A field of the margin's CSV: a figure quoted as it is, so a loss opens as a number a spreadsheet can sum (a plain
 * number cannot be a formula); any other field through csvField (its formula guard would write a loss as `'-10.00`, text).
 */
export const marginCsvField = (value: string): string => (FIGURE.test(value) ? `"${value}"` : csvField(value));

/** The CSV of a report: the totals, then each view's rows, in euros (never a release, never a person). */
export function marginCsv(r: Pick<MarginReport, 'totals' | 'byModel' | 'byChannel' | 'byTier'>): string {
  const row = (view: string, name: string, g: MarginGroup): string[] => [
    view,
    name,
    String(g.orders),
    String(g.pieces),
    euros(g.revenueMinor),
    euros(g.costs.piece),
    euros(g.costs.inbound),
    euros(g.costs.packaging),
    euros(g.costs.outbound),
    euros(g.costs.allowance),
    euros(g.costs.perks.credits),
    euros(g.costs.perks.freeShipping),
    euros(g.costs.perks.gifts),
    euros(g.costs.vault.credits),
    euros(g.costs.vault.creditsToGive),
    euros(g.costs.vault.addons),
    euros(g.costs.vault.productsWon),
    euros(g.costs.vault.cards),
    euros(g.costs.careWarranty),
    euros(g.marginMinor),
    percent(g.marginBp),
    String(g.estimated),
  ];
  const rows = [
    [...MARGIN_CSV_COLUMNS],
    row('Total', 'Every order', r.totals),
    ...r.byModel.map((g) => row('By model', g.label ?? g.key, g)),
    ...r.byChannel.map((g) => row('By channel', g.key, g)),
    ...r.byTier.map((g) => row('By tier', g.key, g)),
  ];
  // RFC 4180 as csvDocument writes it (every field quoted, CRLF), each field through marginCsvField.
  return rows.map((x) => x.map(marginCsvField).join(',')).join('\r\n') + '\r\n';
}

/** The CSV's file name: the Paris day it is read on. */
export const marginCsvName = (now: Date): string => `orbes-margin-${parisDay(now)}.csv`;

// ── The service ────────────────────────────────────────────────────────────

export interface MarginServiceDeps {
  db: Db;
  clock?: Clock;
  /** The tiers' thresholds (CLUB_TIER_THRESHOLDS): a test may stub them, as GROWTH's. */
  thresholds?: readonly number[];
}

export class MarginService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly thresholds: readonly number[];

  constructor(deps: MarginServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
    this.thresholds = deps.thresholds ?? CLUB_TIER_THRESHOLDS;
  }

  /** The report of the window (see the file header). 400 VALIDATION_FAILED for another window. */
  async report(q: { months?: number | undefined; test?: boolean | undefined } = {}): Promise<MarginReport> {
    const months = (q.months ?? GROWTH_WINDOWS[0]) as GrowthWindowMonths;
    if (!GROWTH_WINDOWS.includes(months)) throw validationError(`months: ${GROWTH_WINDOWS.join(' or ')}.`);
    const test = q.test === true;
    return this.readOnly(async (tx) => {
      const now = this.clock();
      const list = monthsOfWindow(now, months);
      const from = monthStart(list[0]!);
      const to = addUtcMonths(monthStart(list[list.length - 1]!), 1);
      const settings = await marginSettingRows(tx);
      const reading = await new MarginReading(tx, settings, this.thresholds).read(from, to, test);
      return { window: { months, from: list[0]!, to: list[list.length - 1]!, list, currency: MARGIN_CURRENCY, test, generatedAt: now }, currency: MARGIN_CURRENCY, ...reading };
    });
  }

  /** The CSV of the report's totals and views, named by the Paris day. */
  async csv(q: { months?: number | undefined; test?: boolean | undefined } = {}): Promise<{ filename: string; contentType: string; body: string }> {
    const r = await this.report(q);
    return { filename: marginCsvName(this.clock()), contentType: CSV_CONTENT_TYPE, body: marginCsv(r) };
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction: every reading of the report sees the same moment. */
  private async readOnly<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      return fn(tx);
    });
  }
}

/** One reading of the margin, in its transaction: what it loads and how it costs each sale. */
class MarginReading {
  private readonly money: EuroConverter;
  private readonly missing = { piecePrices: 0, parcelWeights: 0, shippingRates: 0, boxCosts: 0 };
  private readonly unitsNeeded = new Set<MarginUnitCostKey>();

  constructor(
    private readonly db: Db,
    private readonly settings: MarginSettingRows,
    private readonly thresholds: readonly number[],
  ) {
    this.money = new EuroConverter(settings.rates);
  }

  async read(from: Date, to: Date, test: boolean): Promise<Omit<MarginReport, 'window' | 'currency'>> {
    const db = this.db;
    const people = test ? sql`TRUE` : notTestEntrant('o.account_id');

    // The sales of the window: each original order paid in it, with its exchanges after it (its chain).
    const chainRows = (
      await sql<ChainRow>`
        WITH RECURSIVE chain AS (
          SELECT o.id AS root_id, o.id, 0 AS depth FROM orders o
           WHERE o.channel NOT IN ('GIFT', 'EXCHANGE') AND o.paid_at >= ${from} AND o.paid_at < ${to} AND ${people}
          UNION ALL
          SELECT c.root_id, x.id, c.depth + 1 FROM chain c JOIN orders x ON x.exchange_of_order_id = c.id AND x.channel = 'EXCHANGE'
        )
        SELECT c.root_id, c.depth, o.id, o.channel, o.account_id, o.model_id, o.sku_id, o.status, o.paid_at, o.price_minor, o.product_id, o.with_order_id,
               coalesce(m.variant_of, m.id) AS main_model_id, coalesce(mm.name, m.name) AS main_model_name, coalesce(mm.category_id, m.category_id) AS category_id
          FROM chain c
          JOIN orders o ON o.id = c.id
          JOIN models m ON m.id = o.model_id
          LEFT JOIN models mm ON mm.id = m.variant_of`.execute(db)
    ).rows.map((r) => ({ ...r, depth: Number(r.depth), category_id: Number(r.category_id) }));
    const chains = new Map<string, ChainRow[]>();
    for (const r of chainRows) chains.set(r.root_id, [...(chains.get(r.root_id) ?? []), r]);
    for (const c of chains.values()) c.sort((a, b) => a.depth - b.depth);
    const counted = [...chains.values()].filter((c) => !DONE_STATUSES.includes(c[c.length - 1]!.status));
    /** Each counted chain order's root. */
    const rootOf = new Map<string, string>();
    for (const c of counted) for (const o of c) rootOf.set(o.id, c[0]!.id);
    const chainIds = [...rootOf.keys()];

    const sales = new Map<string, Sale>();
    const tiers = await this.tiers(db, counted.map((c) => ({ accountId: c[0]!.account_id, at: dateOf(c[0]!.paid_at)! })));
    for (const c of counted) {
      const root = c[0]!;
      sales.set(root.id, {
        rootId: root.id,
        modelId: root.main_model_id,
        modelName: root.main_model_name,
        categoryId: root.category_id,
        channel: root.channel as SaleChannel, // the reading's WHERE leaves GIFT and EXCHANGE out
        tier: tiers.get(`${root.account_id}:${dateOf(root.paid_at)!.getTime()}`) ?? 'NONE',
        wonFree: root.channel === 'VAULT' && root.price_minor !== null && num(root.price_minor) === 0,
        pieces: 1,
        revenue: 0,
        credits: 0,
        vaultCredits: 0,
        vaultCreditsToGive: 0,
        piece: 0,
        inbound: 0,
        packaging: 0,
        outbound: 0,
        freeShipping: 0,
        addonPiece: 0,
        addonInbound: 0,
        gifts: 0,
        vaultAddons: 0,
        vaultAddonUnits: 0,
        cards: 0,
        cardCount: 0,
        cardsEstimated: 0,
        estimated: false,
      });
    }
    const saleOf = (orderId: string | null): Sale | undefined => (orderId ? sales.get(rootOf.get(orderId) ?? '') : undefined);

    // REVENUE and the credits used: every invoice and credit note of the chains, each CREDIT line by its grant's kind.
    if (chainIds.length) {
      const toGive = await this.creditsToGive(db, chainIds);
      const docs = await db.selectFrom('invoices').select(['order_id', 'kind', 'lines', 'currency', 'total_minor']).where('order_id', '=', sql<string>`ANY(${uuidArray(chainIds)})`).execute();
      for (const d of docs) {
        const sale = saleOf(d.order_id)!;
        const sign = d.kind === 'INVOICE' ? 1 : -1;
        let perks = 0;
        let vault = 0;
        for (const l of Array.isArray(d.lines) ? (d.lines as { kind?: unknown; label?: unknown; amountMinor?: unknown }[]) : []) {
          if (l?.kind !== 'CREDIT') continue;
          if (l.label === VAULT_CREDIT_LABEL) vault -= num(l.amountMinor);
          else perks -= num(l.amountMinor);
        }
        // A friend's credit for a first piece, as much as the order's uses of it (never more than the line).
        const given = Math.min(vault, toGive.get(d.order_id) ?? 0);
        sale.revenue += this.money.eur(sign * (num(d.total_minor) + perks + vault), d.currency);
        sale.credits += this.money.eur(sign * perks, d.currency);
        sale.vaultCredits += this.money.eur(sign * (vault - given), d.currency);
        sale.vaultCreditsToGive += this.money.eur(sign * given, d.currency);
      }
    }

    // The parcels of the chains: their orders (gifts included) and shipments.
    const keys = [...new Set(chainRows.filter((o) => rootOf.has(o.id)).map((o) => o.with_order_id ?? o.id))];
    const members = keys.length
      ? ((
          await sql<MemberRow>`
            SELECT id, channel, status, paid_at, price_minor, with_order_id, model_id, sku_id, product_id, shipping_benefit, buyer_country, reserved_at
              FROM orders WHERE id = ANY(${uuidArray(keys)}) OR with_order_id = ANY(${uuidArray(keys)})`.execute(db)
        ).rows.map((m) => ({ ...m, price_minor: m.price_minor === null ? null : num(m.price_minor) })) as MemberRow[])
      : [];
    const byKey = new Map<string, MemberRow[]>();
    for (const m of members) byKey.set(m.with_order_id ?? m.id, [...(byKey.get(m.with_order_id ?? m.id) ?? []), m]);
    for (const [key, list] of byKey) list.sort((a, b) => Number(b.id === key) - Number(a.id === key) || dateOf(a.reserved_at)!.getTime() - dateOf(b.reserved_at)!.getTime() || (a.id < b.id ? -1 : 1));
    const gifts = members.filter((m) => m.channel === 'GIFT' && !DONE_STATUSES.includes(m.status) && m.with_order_id !== null && rootOf.has(m.with_order_id));
    const shipments: ShipmentRead[] = keys.length
      ? await db
          .selectFrom('shipments')
          .select(['id', 'order_id', 'packed_at', 'box_id', 'weight_g', 'checklist'])
          .where('order_id', '=', sql<string>`ANY(${uuidArray(keys)})`)
          .where('status', '<>', 'CANCELLED')
          .orderBy('created_at')
          .orderBy('id')
          .execute()
      : [];

    // The pieces: each chain order's, each gift's, and those a parcel problem lost and reshipped.
    const memberIds = [...chainIds, ...gifts.map((g) => g.id)];
    const lost = memberIds.length
      ? await db
          .selectFrom('order_cases as c')
          .innerJoin('shipment_items as i', 'i.shipment_id', 'c.shipment_id')
          .select(['i.order_id', 'i.product_id'])
          .where('c.outcome', '=', 'RESHIP')
          .where('c.piece_to', 'in', ['ARCHIVED', 'REVOKED'])
          .where('i.product_id', 'is not', null)
          .where('i.order_id', '=', sql<string>`ANY(${uuidArray(memberIds)})`)
          .execute()
      : [];
    const productIds = [...new Set([...chainRows.filter((o) => rootOf.has(o.id)).map((o) => o.product_id), ...gifts.map((g) => g.product_id), ...lost.map((l) => l.product_id)].filter((x): x is string => x !== null))];
    const lines = (
      await sql<LineRow>`
        SELECT l.sku_id, l.unit_price_minor, l.quantity, l.accepted_quantity, l.rest_cancelled_quantity, l.credited_quantity,
               so.id AS so_id, so.currency, so.shipping_minor, so.status, so.sent_at
          FROM supplier_order_lines l
          JOIN supplier_orders so ON so.id = l.supplier_order_id
         WHERE so.status <> 'DRAFT'`.execute(db)
    ).rows;
    const traced = productIds.length
      ? (
          await sql<{ id: string; sku_id: string | null; so_id: string | null; unit_price_minor: number | null; currency: string | null; shipping_minor: number | null }>`
            SELECT p.id, p.sku_id, so.id AS so_id, l.unit_price_minor, so.currency, so.shipping_minor
              FROM products p
              LEFT JOIN reception_lines rl ON rl.id = p.reception_line_id
              LEFT JOIN supplier_order_lines l ON l.id = rl.supplier_order_line_id
              LEFT JOIN supplier_orders so ON so.id = l.supplier_order_id
             WHERE p.id = ANY(${uuidArray(productIds)})`.execute(db)
        ).rows
      : [];
    const costs = new PieceCosts(lines, this.money);
    const tracedBy = new Map(traced.map((t) => [t.id, t]));

    /** A piece's cost: traced through its reception, else its SKU's average, an estimate. */
    const pieceCost = (productId: string | null, skuId: string | null): { cost: PieceCost; estimated: boolean } => {
      const t = productId ? tracedBy.get(productId) : undefined;
      if (t && t.so_id && t.unit_price_minor !== null) return { cost: { kind: 'TRACED', priceMinor: num(t.unit_price_minor), inboundMinor: costs.inboundPerUnit(t.so_id), currency: t.currency }, estimated: false };
      return { cost: costs.average(t?.sku_id ?? skuId), estimated: true };
    };
    const pouchAndCard = (): number => this.unit('POUCH') + this.unit('CARD');
    /** Adds a piece's cost to `into` (its PIECE and INBOUND, or a gift's single figure); counts what is missing. */
    const applyPiece = (cost: PieceCost, add: (price: number, inbound: number) => void): void => {
      if (cost.kind === 'TRACED') add(this.money.eur(cost.priceMinor, cost.currency), this.money.eur(cost.inboundMinor, cost.currency));
      else if (cost.kind === 'AVERAGE') add(cost.priceEur, cost.inboundEur);
      else if (cost.kind === 'UNCONVERTED') this.money.leftOut(cost.currency);
      else this.missing.piecePrices += 1;
    };

    // PIECE, INBOUND, POUCH and CARD of each chain order's piece, and of each piece lost and reshipped.
    const lostBy = new Map<string, string[]>();
    for (const l of lost) lostBy.set(l.order_id, [...(lostBy.get(l.order_id) ?? []), l.product_id!]);
    // An order of the chain a size exchange returned: its piece came back to stock (no cost), unless it went to the archive.
    const returned = chainRows.filter((x) => rootOf.has(x.id) && x.status === 'RETURNED').map((x) => x.id);
    const archived = new Set(
      returned.length ? (await db.selectFrom('returns').select('order_id').where('order_id', '=', sql<string>`ANY(${uuidArray(returned)})`).where('outcome', '=', 'ARCHIVED').execute()).map((r) => r.order_id) : [],
    );
    for (const o of chainRows.filter((x) => rootOf.has(x.id))) {
      const sale = saleOf(o.id)!;
      if (o.status !== 'RETURNED' || archived.has(o.id)) {
        const { cost, estimated } = pieceCost(o.product_id, o.sku_id);
        if (estimated) sale.estimated = true;
        applyPiece(cost, (p, i) => {
          sale.piece += p;
          sale.inbound += i;
        });
      }
      sale.packaging += pouchAndCard();
      for (const pid of new Set(lostBy.get(o.id) ?? [])) {
        if (pid === o.product_id) continue;
        applyPiece(pieceCost(pid, o.sku_id).cost, (p, i) => {
          sale.piece += p;
          sale.inbound += i;
        });
        sale.packaging += pouchAndCard();
      }
    }

    // A catalogue add-on unit, by its kind (lot Q2): a PRODUCT at its SKU's average (never traced one by one), no pouch,
    // no card; a SERVICE nothing, never missing; the vault's free unit (source VAULT) THE VAULT's add-ons.
    if (chainIds.length) {
      const units = await db
        .selectFrom('order_addon_items as u')
        .innerJoin('addon_items as a', 'a.id', 'u.addon_id')
        .select(['u.order_id', 'u.sku_id', 'a.kind', 'u.added_by_type'])
        .where('u.order_id', '=', sql<string>`ANY(${uuidArray(chainIds)})`)
        .where('u.status', 'in', ['HELD', 'SHIPPED'])
        .execute();
      for (const u of units) {
        if (u.kind === 'SERVICE') continue;
        const sale = saleOf(u.order_id)!;
        if (u.added_by_type === 'VAULT') {
          sale.vaultAddonUnits += 1;
          applyPiece(costs.average(u.sku_id), (p, i) => {
            sale.vaultAddons += p + i;
          });
        } else {
          applyPiece(costs.average(u.sku_id), (p, i) => {
            sale.addonPiece += p;
            sale.addonInbound += i;
          });
        }
      }
    }

    // PERKS' welcome gifts: each gift's piece, inbound, pouch and card, on the sale it travels with.
    for (const g of gifts) {
      const sale = saleOf(g.with_order_id)!;
      sale.pieces += 1;
      const { cost, estimated } = pieceCost(g.product_id, g.sku_id);
      if (estimated) sale.estimated = true;
      applyPiece(cost, (p, i) => {
        sale.gifts += p + i;
      });
      sale.gifts += pouchAndCard();
      for (const pid of new Set(lostBy.get(g.id) ?? [])) {
        if (pid === g.product_id) continue;
        applyPiece(pieceCost(pid, g.sku_id).cost, (p, i) => {
          sale.gifts += p + i;
        });
        sale.gifts += pouchAndCard();
      }
    }

    // PACKAGING's boxes, OUTBOUND and THE VAULT CARDs: each parcel's, shared over its paid orders.
    await this.parcels(db, keys, byKey, shipments, saleOf);

    // CARE & WARRANTY in the window.
    const care = await this.care(db, from, to, test);

    // ALLOWANCE, the rounding, the views.
    const allowanceMissing = new Map<number, number>();
    const rounded = [...sales.values()].map((s) => {
      const bp = this.settings.allowances.get(s.categoryId) ?? null;
      if (bp === null) allowanceMissing.set(s.categoryId, (allowanceMissing.get(s.categoryId) ?? 0) + 1);
      return roundSale(s, bp);
    });
    const categories = allowanceMissing.size
      ? await db.selectFrom('categories').select(['id', 'code', 'name']).where('id', 'in', [...allowanceMissing.keys()]).execute()
      : [];
    const views = marginViews(rounded, care);

    // THE VAULT's line: the column's parts, the guarantees used, the report's cost of the rewards won.
    const vault = vaultLine(rounded, await this.guaranteedPieces(db, from, to, test), await this.rewardsCost(db, from, to));
    // Partner experiences (K49 P1), beside the margin and never inside it: GROWTH's partner income of the window, in euros.
    const partnerIncome = this.partnerIncome(await partnerIncomeRows(db, from, to));
    return {
      ...views,
      vault,
      partnerIncome,
      estimated: views.totals.estimated,
      missing: {
        ...this.missing,
        allowances: categories
          .map((c) => ({ categoryId: Number(c.id), code: c.code.trim(), name: c.name, orders: allowanceMissing.get(Number(c.id)) ?? 0 }))
          .sort((a, b) => (a.code < b.code ? -1 : 1)),
        unitCosts: [...this.unitsNeeded].filter((k) => !this.settings.unitCosts.has(k)).sort(),
        currencies: [...this.money.missing.entries()].map(([currency, amounts]) => ({ currency, amounts })).sort((a, b) => (a.currency < b.currency ? -1 : 1)),
      },
    };
  }

  /**
   * Each partner's income of the window in euro cents (K49 P1, step M4.6): its invoices less its credit notes, and its
   * payments, as GROWTH reads them (growth.ts partnerIncomeRows), converted at the owner's rates; an amount in a
   * currency without a rate is left out and named in the missing list. By brand; a partner without income is not listed.
   */
  private partnerIncome(rows: readonly PartnerIncomeRow[]): MarginPartnerIncome[] {
    const by = new Map<string, { partnerId: string; brand: string; invoiced: number; paid: number }>();
    for (const r of rows) {
      const p = by.get(r.partnerId) ?? { partnerId: r.partnerId, brand: r.brand, invoiced: 0, paid: 0 };
      p.invoiced += this.money.eur(r.invoicedMinor - r.creditedMinor, r.currency);
      p.paid += this.money.eur(r.paidMinor, r.currency);
      by.set(r.partnerId, p);
    }
    return [...by.values()]
      .map((p) => ({ partnerId: p.partnerId, brand: p.brand, invoicedMinor: Math.round(p.invoiced), paidMinor: Math.round(p.paid) }))
      .sort((a, b) => (a.brand < b.brand ? -1 : a.brand > b.brand ? 1 : a.partnerId < b.partnerId ? -1 : 1));
  }

  /** A unit cost in euro cents (0, and needed, when not set). */
  private unit(key: MarginUnitCostKey): number {
    this.unitsNeeded.add(key);
    const c = this.settings.unitCosts.get(key);
    return c ? this.money.eur(c.costMinor, c.currency) : 0;
  }

  /**
   * How much of each order's vault credits a friend's credit for a first piece paid: its uses of a VAULT grant that an
   * accepted `vault_gifts` row names, not removed (a use given back by a cancellation or a return was on its invoice).
   */
  private async creditsToGive(db: Db, orderIds: readonly string[]): Promise<Map<string, number>> {
    const rows = (
      await sql<{ order_id: string; amount: string | number }>`
        SELECT u.order_id, sum(u.amount_minor) AS amount
          FROM credit_uses u
          JOIN tier_grants g ON g.id = u.grant_id
          JOIN vault_gifts vg ON vg.grant_id = g.id
         WHERE u.order_id = ANY(${uuidArray(orderIds)}) AND g.kind = 'VAULT' AND (u.released_reason IS NULL OR u.released_reason <> 'REMOVED')
         GROUP BY u.order_id`.execute(db)
    ).rows;
    return new Map(rows.map((r) => [r.order_id, num(r.amount)]));
  }

  /**
   * Each parcel's box and band, shared equally over its paid orders (first order first, then the oldest), and its orders'
   * THE VAULT CARDs: its shipments not cancelled (a reshipment's too), each read as recorded at PACKED (its stored
   * checklist's card lines), or, before (PACKING, or no shipment yet), as packing would suggest it and as
   * services/parcels.ts vaultCardOrders would line it (an estimate).
   */
  private async parcels(db: Db, keys: readonly string[], byKey: ReadonlyMap<string, MemberRow[]>, shipments: readonly ShipmentRead[], saleOf: (id: string | null) => Sale | undefined): Promise<void> {
    const allBoxes = await db.selectFrom('boxes').select(['id', 'name', 'inside_length_mm', 'inside_width_mm', 'inside_height_mm', 'empty_weight_g', 'active', 'cost_minor', 'currency']).execute();
    const boxes = new Map<string, BoxRef>(allBoxes.map((b) => [b.id, boxRef(b)]));
    const boxCost = new Map(allBoxes.map((b) => [b.id, b.cost_minor === null || b.currency === null ? null : { costMinor: num(b.cost_minor), currency: b.currency }]));
    const shipmentsBy = new Map<string, ShipmentRead[]>();
    for (const s of shipments) shipmentsBy.set(s.order_id, [...(shipmentsBy.get(s.order_id) ?? []), s]);
    // What packing would suggest, read once for every parcel not packed yet.
    const unpacked = keys.filter((k) => (shipmentsBy.get(k) ?? []).length === 0 || shipmentsBy.get(k)!.some((s) => s.packed_at === null));
    const open = unpacked.flatMap((k) => (byKey.get(k) ?? []).filter((m) => m.status !== 'CANCELLED'));
    const packings = await modelPackings(db, open.map((m) => m.model_id));
    const addonItems = open.length ? await parcelAddonItems(db, open.map((m) => m.id)) : new Map();
    // THE VAULT CARD's rule before packing (vaultCardOrders'), its PIECE source read once for every parcel.
    const pieceSourceOn = unpacked.length > 0 && (await db.selectFrom('vault_sources').select('enabled').where('source', '=', 'PIECE').executeTakeFirst())?.enabled === true;

    for (const key of keys) {
      const list = byKey.get(key) ?? [];
      const first = list.find((m) => m.id === key);
      const sharers = list.filter((m) => m.channel !== 'GIFT' && m.paid_at !== null && m.status !== 'CANCELLED');
      const ours = sharers.map((m) => saleOf(m.id));
      if (!ours.some(Boolean)) continue;
      const free = first?.shipping_benefit === 2 || first?.shipping_benefit === 3;
      const country = first?.buyer_country ?? null;
      const own = shipmentsBy.get(key) ?? [];
      const live = list.filter((m) => m.status !== 'CANCELLED');
      for (const s of own.length ? own : [null]) {
        let box: BoxRef | null;
        let weightG: number | null;
        const estimated = s === null || s.packed_at === null;
        if (!estimated) {
          box = s!.box_id ? (boxes.get(s!.box_id) ?? null) : null;
          weightG = s!.weight_g;
        } else {
          const suggestion = suggestPacking(live, packings, boxes, addonItems);
          box = s?.box_id ? (boxes.get(s.box_id) ?? suggestion.box) : suggestion.box;
          weightG = parcelWeight(box, suggestion).weightG;
        }
        const cost = box ? boxCost.get(box.id) : null;
        const boxShares = cost ? shareEqually(cost.costMinor, sharers.length).map((x) => this.money.eur(x, cost.currency)) : null;
        if (!boxShares) this.missing.boxCosts += 1;
        const band = weightG === null ? null : rateFor(country, weightG, this.settings.bands);
        if (weightG === null) this.missing.parcelWeights += 1;
        else if (!band) this.missing.shippingRates += 1;
        const bandShares = band ? shareEqually(band.costMinor, sharers.length).map((x) => this.money.eur(x, band.currency)) : null;
        ours.forEach((sale, i) => {
          if (!sale) return;
          if (estimated) sale.estimated = true;
          if (boxShares) sale.packaging += boxShares[i]!;
          if (bandShares) {
            if (free) sale.freeShipping += bandShares[i]!;
            else sale.outbound += bandShares[i]!;
          }
        });
        // THE VAULT CARD of each order its box holds (D61): the stored line once packed, else the rule (an estimate).
        const cards = !estimated ? await vaultCardOrders(db, live, { packed_at: s!.packed_at, checklist: s!.checklist ?? [] }) : pieceSourceOn ? live.filter(orderOfABoughtPiece).map((o) => o.id) : [];
        for (const orderId of cards) {
          const sale = saleOf(orderId);
          if (!sale) continue;
          sale.cards += this.unit('VAULT_CARD');
          sale.cardCount += 1;
          if (estimated) {
            sale.cardsEstimated += 1;
            sale.estimated = true;
          }
        }
      }
    }
  }

  /** Each account's tier at each instant asked, keyed `<account>:<ms>` (MARGIN_TIERS; NONE below TITANE). */
  private async tiers(db: Db, asks: readonly { accountId: string; at: Date }[]): Promise<Map<string, MarginTier>> {
    const out = new Map<string, MarginTier>();
    const accounts = [...new Set(asks.map((a) => a.accountId))];
    if (accounts.length === 0) return out;
    const rows = (
      await sql<{ account_id: string; started_at: Date | string; ended_at: Date | string | null }>`
        SELECT o.account_id, o.started_at, o.ended_at FROM ownership o JOIN products p ON p.id = o.product_id
         WHERE o.account_id = ANY(${uuidArray(accounts)}) AND ${clubCounts('p', 'o.account_id')}`.execute(db)
    ).rows;
    const held = new Map<string, { start: Date; end: Date | null }[]>();
    for (const r of rows) held.set(r.account_id, [...(held.get(r.account_id) ?? []), { start: dateOf(r.started_at)!, end: dateOf(r.ended_at) }]);
    for (const a of asks) out.set(`${a.accountId}:${a.at.getTime()}`, tierName(tierAt(heldAt(held.get(a.accountId) ?? [], a.at), this.thresholds)) ?? 'NONE');
    return out;
  }

  /**
   * PRIVATE CARE requests DONE and warranty claims decided in the window, each at its unit cost, on its piece: its main
   * model, the channel of the order that sold it (its exchanges followed back to it; a piece won from the vault: VAULT;
   * none: ELSEWHERE), its owner's tier that day. The test entrants' are left out unless `test`.
   */
  private async care(db: Db, from: Date, to: Date, test: boolean): Promise<CareItem[]> {
    const people = (column: string) => (test ? sql`TRUE` : notTestEntrant(column));
    const done = (
      await sql<{ account_id: string; product_id: string; at: Date | string }>`
        SELECT r.account_id, r.product_id, r.done_at AS at FROM care_requests r
         WHERE r.status = 'DONE' AND r.done_at >= ${from} AND r.done_at < ${to} AND ${people('r.account_id')}`.execute(db)
    ).rows.map((r) => ({ accountId: r.account_id as string | null, productId: r.product_id, at: dateOf(r.at)!, key: 'CARE_SERVICE' as MarginUnitCostKey }));
    const decided = (
      await sql<{ account_id: string | null; product_id: string; at: Date | string; outcome: WarrantyClaimOutcome }>`
        SELECT c.account_id, c.product_id, c.decided_at AS at, c.outcome FROM warranty_claims c
         WHERE c.outcome IS NOT NULL AND c.status <> 'CANCELLED' AND c.decided_at >= ${from} AND c.decided_at < ${to}
           AND (c.account_id IS NULL OR ${people('c.account_id')})`.execute(db)
    ).rows.map((r) => ({ accountId: r.account_id, productId: r.product_id, at: dateOf(r.at)!, key: `CLAIM_${r.outcome}` as MarginUnitCostKey }));
    const items = [...done, ...decided];
    if (items.length === 0) return [];
    const pieces = [...new Set(items.map((i) => i.productId))];
    const models = new Map(
      (
        await sql<{ id: string; model_id: string; name: string }>`
          SELECT p.id, coalesce(m.variant_of, m.id) AS model_id, coalesce(mm.name, m.name) AS name
            FROM products p JOIN models m ON m.id = p.model_id LEFT JOIN models mm ON mm.id = m.variant_of
           WHERE p.id = ANY(${uuidArray(pieces)})`.execute(db)
      ).rows.map((r) => [r.id, r] as const),
    );
    // The order that sold each piece: the latest not cancelled naming it (no gift), an exchange followed back to its original.
    const sold = (
      await sql<{ product_id: string; channel: OrderChannel; exchange_of_order_id: string | null }>`
        SELECT DISTINCT ON (o.product_id) o.product_id, o.channel, o.exchange_of_order_id FROM orders o
         WHERE o.product_id = ANY(${uuidArray(pieces)}) AND o.status <> 'CANCELLED' AND o.channel <> 'GIFT'
         ORDER BY o.product_id, o.paid_at DESC NULLS LAST, o.id`.execute(db)
    ).rows;
    const channelOf = new Map<string, MarginChannel>();
    for (const s of sold) {
      let channel: OrderChannel = s.channel;
      let back = s.exchange_of_order_id;
      for (let hops = 0; channel === 'EXCHANGE' && back !== null && hops < 50; hops++) {
        const o = await db.selectFrom('orders').select(['channel', 'exchange_of_order_id']).where('id', '=', back).executeTakeFirst();
        if (!o) break;
        channel = o.channel;
        back = o.exchange_of_order_id;
      }
      if ((MARGIN_CHANNELS as readonly string[]).includes(channel)) channelOf.set(s.product_id, channel as MarginChannel);
    }
    const tiers = await this.tiers(db, items.filter((i) => i.accountId !== null).map((i) => ({ accountId: i.accountId!, at: i.at })));
    return items.map((i) => {
      const m = models.get(i.productId)!;
      return {
        modelId: m.model_id,
        modelName: m.name,
        channel: channelOf.get(i.productId) ?? 'ELSEWHERE',
        tier: i.accountId ? (tiers.get(`${i.accountId}:${i.at.getTime()}`) ?? 'NONE') : 'NONE',
        cost: Math.round(this.unit(i.key)),
      };
    });
  }

  /**
   * The LIVE guarantees from a vault used in the window (OP-22: a piece at the next LIVE release, bought at its price),
   * counted only: their release (`used_drop_id`) is read to know a use, never returned. Test entrants out unless `test`.
   */
  private async guaranteedPieces(db: Db, from: Date, to: Date, test: boolean): Promise<number> {
    const people = test ? sql`TRUE` : notTestEntrant('g.account_id');
    const row = (
      await sql<{ n: string | number }>`
        SELECT count(*) AS n FROM house_guarantees g
         WHERE g.scope = 'LIVE' AND g.vault_id IS NOT NULL AND g.status = 'USED' AND g.used_drop_id IS NOT NULL
           AND g.used_at >= ${from} AND g.used_at < ${to} AND ${people}`.execute(db)
    ).rows[0];
    return num(row?.n);
  }

  /**
   * The report's cost of the rewards won in the window (services/vault.ts vaultRewardCosts, CLUB > THE VAULT's own
   * reading: every vault opened in it), by reward kind as the report orders them, in euros at the owner's rates (an
   * amount in a currency without a rate left out and named), with its rewards won without a supplier price.
   */
  private async rewardsCost(db: Db, from: Date, to: Date): Promise<MarginVaultLine['rewardsCost']> {
    const figures = [...(await vaultRewardCosts(db, from, to)).values()];
    let costMinor = 0;
    let costUnknown = 0;
    const byKind = VAULT_GRID.map(({ kind }): MarginRewardKindCost => {
      const cost = new Map<string, number>();
      let unknown = 0;
      for (const f of figures) {
        if (f.kind !== kind) continue;
        unknown += f.costUnknown;
        for (const [c, m] of f.cost) cost.set(c, (cost.get(c) ?? 0) + m);
      }
      const list = [...cost].filter(([, minor]) => minor !== 0).map(([currency, minor]) => ({ currency, minor })).sort(byHouseCurrency);
      const eur = Math.round(list.reduce((n, m) => n + this.money.eur(m.minor, m.currency), 0));
      costMinor += eur;
      costUnknown += unknown;
      return { kind, cost: list, costMinor: eur, costUnknown: unknown };
    });
    return { byKind, costMinor, costUnknown };
  }
}

/**
 * The supplier prices the margin reads (every supplier order line sent): each supplier order's inbound share per unit
 * (its shipping over its lines' quantity less what was cancelled or credited), and each SKU's average in euros over
 * the pieces accepted, else its latest priced line sent (plan §1.1: never another SKU's price).
 */
class PieceCosts {
  private readonly units = new Map<string, { shipping: number; units: number }>();
  private readonly bySku = new Map<string, LineRow[]>();
  private readonly cache = new Map<string, PieceCost>();

  constructor(
    lines: readonly LineRow[],
    private readonly money: EuroConverter,
  ) {
    for (const l of lines) {
      const u = this.units.get(l.so_id) ?? { shipping: num(l.shipping_minor), units: 0 };
      u.units += Math.max(0, num(l.quantity) - num(l.rest_cancelled_quantity) - num(l.credited_quantity));
      this.units.set(l.so_id, u);
      this.bySku.set(l.sku_id, [...(this.bySku.get(l.sku_id) ?? []), l]);
    }
  }

  /** A supplier order's shipping per unit it brings, in its own minor units (a fraction). */
  inboundPerUnit(soId: string): number {
    const u = this.units.get(soId);
    return u && u.units > 0 ? u.shipping / u.units : 0;
  }

  /** The average cost of a SKU's piece, in euros: an estimate; NONE without any priced line of that SKU. */
  average(skuId: string | null): PieceCost {
    if (skuId === null) return { kind: 'NONE' };
    const hit = this.cache.get(skuId);
    if (hit) return hit;
    const found = this.of(this.bySku.get(skuId)) ?? ({ kind: 'NONE' } as const);
    this.cache.set(skuId, found);
    return found;
  }

  private of(lines: readonly LineRow[] | undefined): PieceCost | null {
    const priced = (lines ?? []).filter((l) => l.unit_price_minor !== null);
    if (priced.length === 0) return null;
    const accepted = priced.filter((l) => num(l.accepted_quantity) > 0);
    const usable = accepted.filter((l) => this.money.has(l.currency));
    if (usable.length) {
      const n = usable.reduce((s, l) => s + num(l.accepted_quantity), 0);
      const price = usable.reduce((s, l) => s + this.money.eur(num(l.unit_price_minor), l.currency) * num(l.accepted_quantity), 0) / n;
      const inbound = usable.reduce((s, l) => s + this.money.eur(this.inboundPerUnit(l.so_id), l.currency) * num(l.accepted_quantity), 0) / n;
      return { kind: 'AVERAGE', priceEur: price, inboundEur: inbound };
    }
    if (accepted.length) return { kind: 'UNCONVERTED', currency: accepted[0]!.currency ?? 'NONE' };
    // No piece accepted yet: the latest priced line sent (a cancelled supplier order's last).
    const latest = [...priced].sort((a, b) => Number(a.status === 'CANCELLED') - Number(b.status === 'CANCELLED') || (dateOf(b.sent_at)?.getTime() ?? 0) - (dateOf(a.sent_at)?.getTime() ?? 0))[0]!;
    if (!this.money.has(latest.currency)) return { kind: 'UNCONVERTED', currency: latest.currency ?? 'NONE' };
    return { kind: 'AVERAGE', priceEur: this.money.eur(num(latest.unit_price_minor), latest.currency), inboundEur: this.money.eur(this.inboundPerUnit(latest.so_id), latest.currency) };
  }
}
