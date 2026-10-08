/**
 * A LIVE RELEASE and the stock (plan LIVE RELEASE+ of 2026-10-04): the arithmetic of two of the console's readings, each
 * in a pure function tested on known figures, and the one read of the stock both need.
 *
 *   feasibility (K5, choice 12)   before publishing, per size: the pieces on sale against what the stock can give them at
 *                                 the release's location (services/stock.ts: on hand less what orders hold, never below
 *                                 0). The release's sizes first, then its after-room's from what the release leaves
 *                                 (the same SKU draws on one stock). The orders the stock does not cover wait for
 *                                 supplier stock, the oldest first (plan NEXT LOT §3.5: « 12 in stock, 13 will wait for
 *                                 supplier stock »): a warning per size, never a refusal, never a date.
 *   size mix (L1, choice 13)      creating a release: the sizes from the stock on hand first, each with what is
 *                                 available at the location; then the planner's demand per size (live-insights.ts
 *                                 releasePlan): when the planner expects more pieces than the stock holds, the difference
 *                                 goes to the sizes where its demand exceeds the stock, in proportion to that excess
 *                                 (largest remainder). The console keeps the last word.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import { apportion, count } from './live-insights.js';
import { ONE_SIZE_LABEL } from './stock.js';

/** A release's sizes at most, and a size's stock at most (live-console.ts LIVE_SIZES, live.ts LIVE_SIZE_STOCK_MAX). */
const SIZES_MAX = 24;
const SIZE_LABEL_MAX = 12;
const SIZE_STOCK_MAX = 10_000;
/** A release's pieces in all, at most (drops.ts DROP_QUANTITY_MAX). */
const QUANTITY_MAX = 10_000;

const pieces = (n: number) => `${count(n)} ${n === 1 ? 'piece' : 'pieces'}`;

// ── The stock a release can draw on ────────────────────────────────────────

/** What the stock gives a SKU at a location: on hand less reserved (never below 0). */
export interface StockSupply {
  available: number;
}

/** The supply of each SKU at a location, from the ledger and the orders' reservations. */
export async function stockSupply(db: Db, skuIds: readonly string[], locationId: string): Promise<Map<string, StockSupply>> {
  const ids = [...new Set(skuIds)];
  const out = new Map<string, StockSupply>(ids.map((id) => [id, { available: 0 }]));
  if (ids.length === 0) return out;
  const rows = await sql<{ sku_id: string; on_hand: number; reserved: number }>`
    SELECT k.id AS sku_id,
           coalesce((SELECT sum(m.delta) FROM stock_movements m WHERE m.sku_id = k.id AND m.location_id = ${locationId}::uuid), 0)::int AS on_hand,
           (SELECT count(*) FROM orders o WHERE o.sku_id = k.id AND o.location_id = ${locationId}::uuid AND o.reservation = 'STOCK')::int AS reserved
      FROM skus k
     WHERE k.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`))})`.execute(db);
  for (const r of rows.rows) out.set(r.sku_id, { available: Math.max(0, Number(r.on_hand) - Number(r.reserved)) });
  return out;
}

// ── Feasibility (K5) ───────────────────────────────────────────────────────

/** A size on sale, as the check reads it. */
export interface FeasibilitySize {
  sizeId: string;
  label: string;
  /** Its SKU (null: not linked yet, nothing in stock for it). */
  skuId: string | null;
  /** The pieces on sale in it. */
  onSale: number;
}

/** A size checked: what the stock gives it, and what will wait for supplier stock once sold. */
export interface FeasibilityLine {
  sizeId: string;
  label: string;
  onSale: number;
  /** Pieces available at the location, from what the sizes before it on the same SKU left. */
  available: number;
  /** Of the pieces on sale: from the stock, and those that will wait for supplier stock. */
  fromStock: number;
  short: number;
  /** The console's reply only (live-console.ts): the size's SKU and its supplier, for Add to supplier order (§3.5.4.3). */
  skuId?: string | null;
  supplier?: { id: string; name: string } | null;
}

export interface Feasibility {
  /** The release's location (null only before the stock's first setup: nothing in stock anywhere). */
  location: { id: string; name: string } | null;
  sizes: FeasibilityLine[];
  /** The after-room's sizes (null without one). */
  afterRoom: FeasibilityLine[] | null;
  /** Pieces that will wait for supplier stock in all (0: everything on sale is in stock). */
  short: number;
  /** One per size not covered, in words. */
  warnings: string[];
  reasoning: string[];
}

/**
 * The check (pure): each size, in order, takes from its SKU's available pieces what the sizes before it left; the
 * release's sizes first, then the after-room's.
 */
export function feasibilityCheck(input: {
  location: { id: string; name: string } | null;
  sizes: readonly FeasibilitySize[];
  afterRoom: readonly FeasibilitySize[] | null;
  supply: ReadonlyMap<string, StockSupply>;
}): Feasibility {
  const left = new Map<string, StockSupply>([...input.supply].map(([k, v]) => [k, { ...v }]));
  const take = (s: FeasibilitySize): FeasibilityLine => {
    const available = s.skuId ? (left.get(s.skuId)?.available ?? 0) : 0;
    const fromStock = Math.min(s.onSale, available);
    if (s.skuId) left.set(s.skuId, { available: available - fromStock });
    return { sizeId: s.sizeId, label: s.label, onSale: s.onSale, available, fromStock, short: s.onSale - fromStock };
  };
  const sizes = input.sizes.map(take);
  const afterRoom = input.afterRoom ? input.afterRoom.map(take) : null;
  const where = input.location?.name ?? 'no location';
  // The owner's sentence (plan NEXT LOT §2.5): « 52: 12 in stock, 13 will wait for supplier stock. »
  const warn = (prefix: string) => (l: FeasibilityLine) => `${prefix}${l.label}: ${count(l.fromStock)} in stock, ${count(l.short)} will wait for supplier stock.`;
  const warnings = [...sizes.filter((l) => l.short > 0).map(warn('')), ...(afterRoom ?? []).filter((l) => l.short > 0).map(warn('THE AFTER-ROOM · '))];
  const all = [...sizes, ...(afterRoom ?? [])];
  const short = all.reduce((n, l) => n + l.short, 0);
  const onSale = all.reduce((n, l) => n + l.onSale, 0);
  const reasoning = [
    ...(input.location ? [] : ['No stock location is set up yet: nothing is in stock.']),
    `Each size against the pieces available at ${where} (on hand less those orders hold).`,
    ...(afterRoom ? ['The release’s sizes first, then its after-room’s from what they leave: the same model in the same size draws on one stock.'] : []),
    short === 0
      ? `Every one of the ${pieces(onSale)} on sale is in stock.`
      : `${pieces(short)} of the ${pieces(onSale)} on sale would wait for supplier stock once sold, the oldest orders first. It does not hold the release back: it can be published as it is.`,
  ];
  return { location: input.location, sizes, afterRoom, short, warnings, reasoning };
}

// ── Size mix (L1) ──────────────────────────────────────────────────────────

/** A size the mix proposes: its stock on sale, from the stock on hand and from the planner's demand. */
export interface SizeMixSize {
  label: string;
  stock: number;
  fromStock: number;
  fromDemand: number;
}

export interface SizeMix {
  model: { id: string; name: string };
  location: { id: string; name: string };
  /** The sizes proposed, in the order of their labels (none: nothing to propose, the console keeps its own). */
  sizes: SizeMixSize[];
  /** Their pieces in all. */
  quantity: number;
  /** The pieces available at the location for the model, and the planner's quantity (null: no basis). */
  inStock: number;
  planned: number | null;
  reasoning: string[];
  /**
   * Plan NEXT LOT §3.3: the model's offered sizes, by their declared labels (ONE SIZE for a size of none), which the
   * proposal is read among; empty for a model with no size type.
   */
  offered: string[];
}

/** Labels in their natural order: 48 before 52 before 104, then words. */
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/**
 * The mix (pure): every size in stock with what is available; then, when the planner expects more than the stock holds,
 * the difference shared out by how far its demand in each size exceeds the stock there (largest remainder). Sizes
 * whose label is too long for a release are left out, as are those beyond the 24 a release offers.
 */
export function sizeMix(input: {
  model: { id: string; name: string };
  location: { id: string; name: string };
  /** The model's sizes available at the location (a one-size SKU: ONE SIZE). */
  stock: readonly { label: string; available: number }[];
  /** The planner's quantity, null without any basis; and its demand per size. */
  planned: number | null;
  demand: readonly { label: string; pieces: number }[];
  /** The planner's own reasoning, said after the mix's. */
  plannerReasoning?: readonly string[];
  /** The model's offered sizes (a typed model's); none: a model with no size type. */
  offered?: readonly string[];
}): SizeMix {
  const why: string[] = [];
  const key = (l: string) => l.trim().toUpperCase();
  const labels = new Map<string, string>();
  const available = new Map<string, number>();
  const demand = new Map<string, number>();
  const tooLong = new Map<string, string>();
  const name = (k: string) => labels.get(k) ?? k;
  const add = (label: string) => {
    const k = key(label);
    if (k.length === 0) return null;
    if (k.length > SIZE_LABEL_MAX) {
      if (!tooLong.has(k)) tooLong.set(k, label.trim());
      return null;
    }
    // The first label seen names the size: the stock's own (its SKU's), so a release on this proposal draws on it.
    if (!labels.has(k)) labels.set(k, label.trim());
    return k;
  };
  for (const s of input.stock) {
    const k = add(s.label);
    if (k && s.available > 0) available.set(k, (available.get(k) ?? 0) + s.available);
  }
  for (const d of input.demand) {
    const k = add(d.label);
    if (k && d.pieces > 0) demand.set(k, (demand.get(k) ?? 0) + d.pieces);
  }
  const inStock = [...available.values()].reduce((a, b) => a + b, 0);
  why.push(
    inStock > 0
      ? `In stock at ${input.location.name}: ${[...available.entries()].map(([k, n]) => [name(k), n] as const).sort((a, b) => natural(a[0], b[0])).map(([l, n]) => `${l}: ${count(n)}`).join(', ')}, offered first.`
      : `Nothing of ${input.model.name} is available at ${input.location.name}: the sizes come from the planner alone.`,
  );
  const proposed = new Map<string, { fromStock: number; fromDemand: number }>();
  for (const [k, n] of available) proposed.set(k, { fromStock: n, fromDemand: 0 });
  if (input.planned === null) {
    why.push('The planner has no basis yet (no past release, no audience to forecast): nothing is added to the stock.');
  } else {
    const extra = Math.max(0, input.planned - inStock);
    const over = [...labels.keys()].map((k) => ({ k, excess: Math.max(0, (demand.get(k) ?? 0) - (available.get(k) ?? 0)) })).filter((x) => x.excess > 0);
    if (extra === 0) {
      why.push(`The planner expects ${pieces(input.planned)}: the stock covers ${input.planned === inStock ? 'it' : 'it and more'}, so the sizes are the stock's.`);
    } else if (over.length === 0) {
      why.push(`The planner expects ${pieces(input.planned)}, ${count(extra)} more than the stock, but tells no size apart for this model yet: set the sizes to make by hand.`);
    } else {
      const shares = apportion(extra, over.map((x) => x.excess));
      over.forEach((x, i) => {
        const p = proposed.get(x.k) ?? { fromStock: 0, fromDemand: 0 };
        p.fromDemand += shares[i]!;
        proposed.set(x.k, p);
      });
      why.push(
        `The planner expects ${pieces(input.planned)}, ${count(extra)} more than the stock: shared by how far its demand exceeds the stock in each size (${over
          .map((x) => ({ l: name(x.k), excess: x.excess }))
          .sort((a, b) => natural(a.l, b.l))
          .map((x) => `${x.l}: ${count(x.excess)}`)
          .join(', ')}), the largest remainders rounded up; made to order once sold.`,
      );
    }
  }
  if (tooLong.size) why.push(`Left out, their labels longer than a release's ${SIZE_LABEL_MAX} characters: ${[...tooLong.values()].sort(natural).join(', ')}.`);
  let sizes = [...proposed.entries()]
    .map(([k, p]) => ({ label: name(k), fromStock: p.fromStock, fromDemand: p.fromDemand, stock: Math.min(SIZE_STOCK_MAX, p.fromStock + p.fromDemand) }))
    .filter((s) => s.stock > 0);
  if (sizes.length > SIZES_MAX) {
    // The sizes with the most pieces stay, a release offering 24 at most.
    const kept = new Set([...sizes].sort((a, b) => b.stock - a.stock || natural(a.label, b.label)).slice(0, SIZES_MAX).map((s) => s.label));
    why.push(`A release offers ${SIZES_MAX} sizes at most: the ${count(sizes.length - SIZES_MAX)} with the fewest pieces are left out.`);
    sizes = sizes.filter((s) => kept.has(s.label));
  }
  sizes.sort((a, b) => natural(a.label, b.label));
  let quantity = sizes.reduce((n, s) => n + s.stock, 0);
  if (quantity > QUANTITY_MAX) {
    why.push(`A release offers ${count(QUANTITY_MAX)} pieces at most: the proposal is cut there.`);
    let room = QUANTITY_MAX;
    sizes = sizes.map((s) => {
      const stock = Math.min(s.stock, room);
      room -= stock;
      return { ...s, stock, fromDemand: Math.max(0, stock - s.fromStock), fromStock: Math.min(s.fromStock, stock) };
    }).filter((s) => s.stock > 0);
    quantity = sizes.reduce((n, s) => n + s.stock, 0);
  }
  if (sizes.length) why.push(`Proposed: ${sizes.map((s) => `${s.label} = ${count(s.stock)}`).join(', ')} (${pieces(quantity)}). You keep the last word.`);
  else why.push('Nothing to propose: the sizes stay as you set them.');
  return { model: input.model, location: input.location, sizes, quantity, inStock, planned: input.planned, reasoning: [...why, ...(input.plannerReasoning ?? [])], offered: [...(input.offered ?? [])] };
}

/** A SKU's size label as a release names it: its own, or ONE SIZE for a model in one size. */
export function releaseSizeLabel(skuSizeLabel: string | null): string {
  return skuSizeLabel ?? ONE_SIZE_LABEL;
}
