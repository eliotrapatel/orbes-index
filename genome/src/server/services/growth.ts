/**
 * GROWTH (plan NEXT-NINE of 2026-10-06, §3.9 BP-29: « A GROWTH console page … LTV (per collector, and by tier, country,
 * first model and channel); repeat buying (second-piece rate, time to it, cohorts); the funnel (scans → accounts →
 * owners → buyers → PLATINE → PALLADIUM); revenue (month, channel, country, model, net of returns) »).
 *
 * GrowthService only reads: it writes nothing, audits nothing, keeps no snapshot table and no cache (migration 0032 adds
 * the three indexes it reads on). Amounts are never converted: one currency at a time (`currency`, by default the one
 * with the most invoices, EUR when there is none).
 *
 *   report      GET /api/admin/growth (AUDITOR): the window (the last 12 or 24 UTC months, the current one included),
 *               `ltv`, `repeat`, `funnel` and `revenue`, read in one REPEATABLE READ, READ ONLY transaction. It names
 *               no account: counts, amounts and groups, the groups of fewer than GROWTH_MIN_GROUP collectors without
 *               their amounts (`maskSmallGroups`).
 *   collectors  GET /api/admin/growth/collectors (AUDITOR): COLLECTORS BY VALUE, every collector with a counted piece in
 *               the currency, highest value first then by account id, GROWTH_COLLECTORS_PAGE a page; each row its
 *               account, email (as stored: the route masks it for an AUDITOR, as on the owners' list), tier now,
 *               country, pieces counted, value and first piece. DELETED accounts are left out.
 *   releases    GET /api/admin/growth/releases (AUDITOR): the GROWTH_RELEASES latest releases past their opening, no
 *               draft, cancelled release or after-room; a LIVE RELEASE measured by live-insights `summarize`.
 *   collectorValue  the client sheet's Lifetime value (OwnerService.sheet): the account's value per currency, by the
 *               rule of `collectors`.
 *
 * The rules (§5.1 defaults):
 *
 *   - A purchase is a paid order not CANCELLED or RETURNED, and never a GIFT order (a welcome gift is not bought), at
 *     its invoiced price after credit notes; or a FIRST_REGISTRATION of a piece no order names (`ELSEWHERE`, or
 *     `POINT_OF_SALE` when its warranty names a point of sale), at its model's base price, or its main model's for a
 *     variant without one; a piece whose model has neither counts and adds no value (« Pieces without a price »). A
 *     piece is named by an order when an order not CANCELLED names it, for its buyer, or for anyone while not
 *     RETURNED: an ordered piece counts once, and a returned order nets to zero. TRANSFER, RESALE and ADMIN pieces never
 *     count. The Shopify store's pieces are ELSEWHERE until the sync (PIECE_SOURCES gains its channel then).
 *   - Revenue is invoices less credit notes, in the UTC month each was issued, app orders only: BP-19's shipping lines
 *     and credits are inside the totals, and a GIFT order (no invoice) adds nothing. Its orders are counted on their main
 *     invoice only: a supplementary invoice (an engraving after PAID) adds to the totals, never another order.
 *   - Lifetime value is lifetime to date, whatever the window; its channel and model are those of the collector's first
 *     piece, its tier the one held now. A collector's country is the account's, or none (« Not given »).
 *   - Repeat buying counts every purchase, whatever its currency: the second piece, the time to it, the cohorts by
 *     month of the first piece.
 *   - The funnel counts each account in the month it first reached each step: its creation, its first ownership of any
 *     kind (« Registered owners »), its first paid LIVE, DRAW or SALON order (« Buyers », never a GIFT order), and the
 *     tiers by pieces held over all history (CLUB_TIER_THRESHOLDS, the pieces now excluded from the club left out).
 *     Scans are Analytics' total per UTC month: counted, not people.
 *   - DELETED accounts are left out of lifetime value, repeat buying and COLLECTORS BY VALUE, and kept in the funnel
 *     and the revenue.
 *   - The test entrants' pool (services/test-entrants.ts: `test-0001@orbes.test`…, a test_entrants row each, kept
 *     after END TEST, their accounts' creation dates moved back at each test) is left out of the purchases (lifetime
 *     value, repeat buying, COLLECTORS BY VALUE, the client sheet's value) and of every step of the funnel: they are
 *     not sign-ups, owners or buyers (`notTestEntrant`, services/population.ts).
 */
import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../db/connection.js';
import { HOUSE_CURRENCIES, type DropMode } from '../db/schema.js';
import { notFound, validationError } from '../errors.js';
import { systemClock, type Clock } from '../types.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS, clubMembersByTier, tierName, type ClubMembers, type ClubTier, type ClubTierName } from './club.js';
import { LiveInsightsService } from './live-insights.js';
import { notTestEntrant } from './population.js';
import { scanMonths } from './scan-stats.js';
import { addUtcMonths } from './tier-grants.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** The windows GROWTH offers, in months; it opens on the first. */
export const GROWTH_WINDOWS = Object.freeze([12, 24] as const);
export type GrowthWindowMonths = (typeof GROWTH_WINDOWS)[number];
/** A group of fewer collectors shows its count, never its amounts. */
export const GROWTH_MIN_GROUP = 3;
/** COLLECTORS BY VALUE: rows per page. */
export const GROWTH_COLLECTORS_PAGE = 25;
/** Latest releases: how many. */
export const GROWTH_RELEASES = 6;
/** The marks of the cohorts, in months after the first piece. */
export const COHORT_MARKS = Object.freeze([1, 3, 6, 12] as const);
/** The time to the second piece, by bucket: before `months` after the first (the last bucket: after a year). */
export const SECOND_PIECE_BUCKETS = Object.freeze([
  { key: 'MONTH', months: 1 },
  { key: 'THREE_MONTHS', months: 3 },
  { key: 'SIX_MONTHS', months: 6 },
  { key: 'YEAR', months: 12 },
  { key: 'LATER', months: null },
] as const);
export type SecondPieceBucket = (typeof SECOND_PIECE_BUCKETS)[number]['key'];
/** Where a counted piece came from: the app's channels, then the pieces registered from elsewhere. Shopify's joins after the sync. */
export const PIECE_SOURCES = Object.freeze(['LIVE', 'DRAW', 'SALON', 'POINT_OF_SALE', 'ELSEWHERE'] as const);
export type PieceSource = (typeof PIECE_SOURCES)[number];
/** The funnel's steps, in order. */
export const FUNNEL_STEPS = Object.freeze(['scans', 'accounts', 'owners', 'buyers', 'platine', 'palladium'] as const);
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
/** The revenue's channels: the app's (a GIFT order has no invoice). */
export const REVENUE_CHANNELS = Object.freeze(['LIVE', 'DRAW', 'SALON'] as const);

type Currency = (typeof HOUSE_CURRENCIES)[number];
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Pure functions ─────────────────────────────────────────────────────────

/** The median (the mean of the two middle values for an even count, rounded); null without values. */
export function median(values: readonly number[]): number | null {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/** The nearest-rank percentile `p` (0 < p ≤ 1): the smallest value with at least p of the values at or below it; null without values. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (v.length === 0 || !(p > 0) || p > 1) return null;
  const rank = Math.max(1, Math.ceil(p * v.length - 1e-9));
  return v[Math.min(v.length, rank) - 1]!;
}

export interface LtvStats {
  collectors: number;
  totalMinor: number;
  averageMinor: number | null;
  medianMinor: number | null;
  /** The value from which the top tenth of the collectors start (the lowest of the ⌈n / 10⌉ highest). */
  topTenthFromMinor: number | null;
}

/** The lifetime values of a group: its collectors, total, average, median and where its top tenth starts. */
export function ltvStats(values: readonly number[]): LtvStats {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  const total = v.reduce((a, b) => a + b, 0);
  const top = Math.ceil(n / 10);
  return {
    collectors: n,
    totalMinor: total,
    averageMinor: n ? Math.round(total / n) : null,
    medianMinor: median(v),
    topTenthFromMinor: n ? percentile(v, (n - top + 1) / n) : null,
  };
}

/** How many collectors bought their second piece in each bucket of SECOND_PIECE_BUCKETS after their first. */
export function secondPieceBuckets(pairs: readonly { first: Date; second: Date }[]): Record<SecondPieceBucket, number> {
  const out = Object.fromEntries(SECOND_PIECE_BUCKETS.map((b) => [b.key, 0])) as Record<SecondPieceBucket, number>;
  for (const p of pairs) {
    const b = SECOND_PIECE_BUCKETS.find((x) => x.months === null || p.second.getTime() < addUtcMonths(p.first, x.months).getTime())!;
    out[b.key] += 1;
  }
  return out;
}

/** `YYYY-MM` of a UTC instant. */
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

/** The first instant of a month `YYYY-MM` (UTC). */
export function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

/** The `months` UTC months that end with the month of `now` (it included), oldest first. */
export function monthsOfWindow(now: Date, months: number): string[] {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) out.push(monthOf(addUtcMonths(first, -i)));
  return out;
}

export interface CohortRow {
  /** The month of the first piece, `YYYY-MM`. */
  month: string;
  collectors: number;
  /** Per COHORT_MARKS: the collectors with a second piece before the mark; null while the mark is not reached for the whole cohort. */
  within: (number | null)[];
  /** With a second piece to date. */
  toDate: number;
}

/**
 * The cohorts by month of the first piece, for the `months` given, the newest first: each one's collectors, those with a
 * second piece within each mark after their first, and to date. A mark is reached once the cohort's last day is that
 * many months behind `now`.
 */
export function cohortTable(collectors: readonly { first: Date; second: Date | null }[], months: readonly string[], now: Date): CohortRow[] {
  const by = new Map<string, { first: Date; second: Date | null }[]>();
  for (const c of collectors) {
    const m = monthOf(c.first);
    const group = by.get(m);
    if (group) group.push(c);
    else by.set(m, [c]);
  }
  return [...months]
    .reverse()
    .map((month) => {
      const group = by.get(month) ?? [];
      const end = addUtcMonths(monthStart(month), 1);
      return {
        month,
        collectors: group.length,
        within: COHORT_MARKS.map((mark) =>
          addUtcMonths(end, mark).getTime() <= now.getTime() ? group.filter((c) => c.second !== null && c.second.getTime() < addUtcMonths(c.first, mark).getTime()).length : null,
        ),
        toDate: group.filter((c) => c.second !== null).length,
      };
    });
}

export interface FunnelMonth {
  month: string;
  counts: Record<FunnelStep, number>;
}

/** The funnel's counts per month of `months` (each step's count of that month, 0 when none), the newest first. */
export function funnelMonths(months: readonly string[], counts: Readonly<Record<FunnelStep, ReadonlyMap<string, number>>>): FunnelMonth[] {
  return [...months].reverse().map((month) => ({ month, counts: Object.fromEntries(FUNNEL_STEPS.map((s) => [s, counts[s].get(month) ?? 0])) as Record<FunnelStep, number> }));
}

/** How many of `dates` fall in each UTC month. */
export function countByMonth(dates: readonly (Date | null)[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of dates) if (d) out.set(monthOf(d), (out.get(monthOf(d)) ?? 0) + 1);
  return out;
}

/**
 * When an account first held at least each threshold of `thresholds` (CLUB_TIER_THRESHOLDS: TITANE, PLATINE,
 * PALLADIUM), from its ownerships over all history: each starts a piece held, each end gives one back (an end and a start
 * at the same instant: the end first). null for a threshold never reached.
 */
export function tierReachDates(intervals: readonly { start: Date; end: Date | null }[], thresholds: readonly number[] = CLUB_TIER_THRESHOLDS): (Date | null)[] {
  const events = intervals.flatMap((i) => [{ at: i.start.getTime(), d: 1 }, ...(i.end ? [{ at: i.end.getTime(), d: -1 }] : [])]).sort((a, b) => a.at - b.at || a.d - b.d);
  const out: (Date | null)[] = thresholds.map(() => null);
  let held = 0;
  for (const e of events) {
    held += e.d;
    thresholds.forEach((t, i) => {
      if (out[i] === null && held >= t) out[i] = new Date(e.at);
    });
  }
  return out;
}

/** A group's amounts withheld below GROWTH_MIN_GROUP collectors: its count stays, its amounts read null. */
export function maskSmallGroups<T extends { collectors: number }>(rows: readonly T[], amounts: readonly (keyof T)[]): T[] {
  return rows.map((r) => (r.collectors >= GROWTH_MIN_GROUP ? r : { ...r, ...Object.fromEntries(amounts.map((k) => [k, null])) }));
}

// ── Shapes ─────────────────────────────────────────────────────────────────

export interface LtvGroup {
  /** PALLADIUM, PLATINE, TITANE or NONE; a country code or null; a model's id; a piece's source. */
  key: string | null;
  /** The model's name (by first model), else null. */
  label: string | null;
  collectors: number;
  totalMinor: number | null;
  averageMinor: number | null;
  medianMinor: number | null;
}

export interface RevenueMonth {
  month: string;
  /** Invoices issued (one per order). */
  orders: number;
  invoicedMinor: number;
  creditedMinor: number;
  netMinor: number;
}

export interface RevenueGroup {
  /** A channel, a country code (null: not given) or a model's id. */
  key: string | null;
  label: string | null;
  /** The accounts behind it: under GROWTH_MIN_GROUP, its amount is withheld. */
  collectors: number;
  orders: number;
  netMinor: number | null;
}

export interface GrowthReport {
  window: { months: GrowthWindowMonths; from: string; to: string; list: string[]; currency: Currency; currencies: Currency[]; generatedAt: Date };
  ltv: {
    perCollector: LtvStats;
    /** Counted pieces whose model has no price in the Catalogue. */
    unpricedPieces: number;
    byTier: LtvGroup[];
    byCountry: LtvGroup[];
    byFirstModel: LtvGroup[];
    byChannel: LtvGroup[];
  };
  repeat: {
    collectors: number;
    withSecond: number;
    /** withSecond / collectors, null without a collector. */
    rate: number | null;
    medianDays: number | null;
    buckets: Record<SecondPieceBucket, number>;
    /** The months of the window, the newest first. */
    cohorts: CohortRow[];
  };
  funnel: {
    thresholds: number[];
    /** Each step over the window. */
    totals: Record<FunnelStep, number>;
    /** The months of the window, the newest first. */
    months: FunnelMonth[];
    /** The members of the club now (ACTIVE accounts holding a piece), as Analytics counts them. */
    clubNow: ClubMembers;
  };
  revenue: {
    /** The months of the window, the newest first. */
    months: RevenueMonth[];
    total: Omit<RevenueMonth, 'month'>;
    byChannel: RevenueGroup[];
    byCountry: RevenueGroup[];
    byModel: RevenueGroup[];
  };
}

export interface GrowthCollector {
  accountId: string;
  /** As stored: the route masks it for an AUDITOR. */
  email: string;
  tier: ClubTierName | null;
  country: string | null;
  pieces: number;
  valueMinor: number;
  firstPieceAt: Date;
}

export interface GrowthCollectors {
  currency: Currency;
  currencies: Currency[];
  page: number;
  pageSize: number;
  total: number;
  items: GrowthCollector[];
}

export interface GrowthRelease {
  id: string;
  mode: DropMode;
  title: string;
  opensAt: Date;
  /** The pieces it announced: a draw's quantity, a LIVE RELEASE's stock. */
  pieces: number;
  /** The pieces sold: a draw's paid orders not cancelled or returned; a LIVE RELEASE's confirmed pieces less those cancelled. */
  sold: number;
  /** LIVE: from T0 to its last piece confirmed, when every piece was. */
  sellOutMs: number | null;
  /** DRAW: its entries, withdrawn ones left out. */
  entries: number | null;
}

/** The client sheet's Lifetime value: per currency, the newest rule's value. Empty: no priced piece. */
export type LifetimeValue = { currency: string; valueMinor: number }[];

// ── Reads ──────────────────────────────────────────────────────────────────

const EXCLUDED = sql.join([...CLUB_EXCLUDED_STATUSES]);

/**
 * Every purchase (the rule in the file header): its account, when, a reference that orders ties, its source, its main
 * model, its currency and value (both NULL: a piece from elsewhere whose model has no price). `account` narrows it.
 */
function purchases(account?: string): RawBuilder<unknown> {
  const own = account ? sql`AND o.account_id = ${account}` : sql``;
  const reg = account ? sql`AND w.account_id = ${account}` : sql``;
  const inv = account ? sql`JOIN orders io ON io.id = i.order_id AND io.account_id = ${account}` : sql``;
  return sql`
    SELECT o.account_id, o.paid_at AS at, o.id AS ref, o.channel AS source, coalesce(m.variant_of, m.id) AS model_id,
           coalesce(iv.currency, o.currency) AS currency, coalesce(iv.net, 0)::bigint AS value
      FROM orders o
      JOIN models m ON m.id = o.model_id
      LEFT JOIN (SELECT i.order_id, min(i.currency) AS currency, sum(CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END) AS net
                   FROM invoices i ${inv} GROUP BY i.order_id) iv ON iv.order_id = o.id
     WHERE o.paid_at IS NOT NULL AND o.channel <> 'GIFT' AND o.status NOT IN ('CANCELLED', 'RETURNED') ${own} AND ${notTestEntrant('o.account_id')}
    UNION ALL
    SELECT w.account_id, w.started_at, w.id,
           CASE WHEN EXISTS (SELECT 1 FROM warranties wa WHERE wa.product_id = w.product_id AND wa.voided_at IS NULL AND (wa.retailer_id IS NOT NULL OR wa.retailer IS NOT NULL))
                THEN 'POINT_OF_SALE' ELSE 'ELSEWHERE' END,
           coalesce(m.variant_of, m.id),
           CASE WHEN m.base_price_minor IS NOT NULL THEN m.base_currency ELSE mm.base_currency END,
           coalesce(m.base_price_minor, mm.base_price_minor)::bigint
      FROM ownership w
      JOIN products p ON p.id = w.product_id
      JOIN models m ON m.id = p.model_id
      LEFT JOIN models mm ON mm.id = m.variant_of
     WHERE w.acquired_via = 'FIRST_REGISTRATION' ${reg} AND ${notTestEntrant('w.account_id')}
       AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.product_id = w.product_id AND x.status <> 'CANCELLED' AND (x.account_id = w.account_id OR x.status <> 'RETURNED'))`;
}

interface CollectorRow {
  account_id: string;
  email: string;
  country: string | null;
  held: number;
  priced: number;
  unpriced: number;
  value: number;
  first_at: Date;
  second_at: Date | null;
  first_source: PieceSource;
  first_model: string;
}

/**
 * Every collector with a purchase (DELETED accounts left out): their pieces and value in `currency`, their first two
 * pieces, the pieces they hold now. Grouped by account alone (the window's order), then joined to the account and to the
 * pieces held: one sort of the purchases, no sort of the groups.
 */
function collectorRows(currency: Currency): RawBuilder<CollectorRow> {
  return sql<CollectorRow>`
    WITH pur AS (${purchases()}),
         r AS (SELECT pur.*, row_number() OVER (PARTITION BY pur.account_id ORDER BY pur.at, pur.ref) AS rn FROM pur),
         agg AS (
           SELECT r.account_id,
                  (count(*) FILTER (WHERE r.value IS NOT NULL AND r.currency = ${currency}))::int AS priced,
                  (count(*) FILTER (WHERE r.value IS NULL))::int AS unpriced,
                  coalesce(sum(r.value) FILTER (WHERE r.value IS NOT NULL AND r.currency = ${currency}), 0)::bigint AS value,
                  min(r.at) FILTER (WHERE r.rn = 1) AS first_at,
                  min(r.at) FILTER (WHERE r.rn = 2) AS second_at,
                  min(r.source) FILTER (WHERE r.rn = 1) AS first_source,
                  min(r.model_id::text) FILTER (WHERE r.rn = 1) AS first_model
             FROM r GROUP BY r.account_id),
         held AS (SELECT o.account_id, count(*)::int AS n FROM ownership o JOIN products p ON p.id = o.product_id
                   WHERE o.ended_at IS NULL AND p.status NOT IN (${EXCLUDED}) GROUP BY o.account_id)
    SELECT agg.account_id, a.email, a.country, coalesce(h.n, 0)::int AS held, agg.priced, agg.unpriced, agg.value,
           agg.first_at, agg.second_at, agg.first_source, agg.first_model
      FROM agg
      JOIN accounts a ON a.id = agg.account_id
      LEFT JOIN held h ON h.account_id = agg.account_id
     WHERE a.status <> 'DELETED'`;
}

/** The tier of `held` pieces under `thresholds` (CLUB_TIER_THRESHOLDS unless a test stubs them), as club.ts tierForPieces. */
const tierAt = (held: number, thresholds: readonly number[]): ClubTier => thresholds.filter((t) => held >= t).length as ClubTier;
/** Names in code-point order, none last (« Not given » closes a list). */
const byName = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
const dateOf = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const country = (c: string | null): string | null => (c ? c.trim() || null : null);

/** The currencies that appear (invoices, priced models) and the one shown: `requested`, else the most invoiced, else EUR. */
async function currenciesOf(db: Db, requested: Currency | undefined): Promise<{ currency: Currency; currencies: Currency[] }> {
  const [invoiced, priced] = await Promise.all([
    sql<{ currency: string; n: number }>`SELECT currency, count(*)::int AS n FROM invoices WHERE kind = 'INVOICE' GROUP BY currency`.execute(db),
    sql<{ currency: string }>`SELECT DISTINCT base_currency AS currency FROM models WHERE base_currency IS NOT NULL`.execute(db),
  ]);
  const known = (c: string): c is Currency => (HOUSE_CURRENCIES as readonly string[]).includes(c);
  const most = invoiced.rows.filter((r) => known(r.currency)).sort((a, b) => Number(b.n) - Number(a.n) || a.currency.localeCompare(b.currency))[0]?.currency as Currency | undefined;
  const currency = requested ?? most ?? 'EUR';
  const currencies = [...new Set([...invoiced.rows.map((r) => r.currency), ...priced.rows.map((r) => r.currency), currency])].filter(known).sort();
  return { currency, currencies };
}

export interface GrowthServiceDeps {
  db: Db;
  clock?: Clock;
  /** The tiers' thresholds (CLUB_TIER_THRESHOLDS): a test may stub them. */
  thresholds?: readonly number[];
}

export class GrowthService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly thresholds: readonly number[];
  private readonly insights: LiveInsightsService;

  constructor(deps: GrowthServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
    this.thresholds = deps.thresholds ?? CLUB_TIER_THRESHOLDS;
    this.insights = new LiveInsightsService({ db: deps.db, clock: this.clock });
  }

  /** The report of the window (see the file header). 400 VALIDATION_FAILED for another window or currency. */
  async report(q: { months?: number; currency?: string } = {}): Promise<GrowthReport> {
    const months = (q.months ?? GROWTH_WINDOWS[0]) as GrowthWindowMonths;
    if (!GROWTH_WINDOWS.includes(months)) throw validationError(`months: ${GROWTH_WINDOWS.join(' or ')}.`);
    const requested = parseCurrency(q.currency);
    return this.readOnly(async (trx) => {
      const now = this.clock();
      const list = monthsOfWindow(now, months);
      const from = monthStart(list[0]!);
      const to = addUtcMonths(monthStart(list[list.length - 1]!), 1);
      const { currency, currencies } = await currenciesOf(trx, requested);
      const window = { months, from: list[0]!, to: list[list.length - 1]!, list, currency, currencies, generatedAt: now };

      // Lifetime value and repeat buying: every collector with a purchase.
      const rows = (await collectorRows(currency).execute(trx)).rows.map((r) => ({ ...r, first_at: dateOf(r.first_at)!, second_at: dateOf(r.second_at), value: Number(r.value) }));
      const counted = rows.filter((r) => r.priced + r.unpriced > 0);
      const modelIds = [...new Set(counted.map((r) => r.first_model))];
      const names = new Map(
        modelIds.length ? (await trx.selectFrom('models').select(['id', 'name']).where('id', 'in', modelIds).execute()).map((m) => [m.id, m.name] as const) : [],
      );
      const groups = (keyOf: (r: (typeof counted)[number]) => string | null, keys?: readonly (string | null)[], label: (k: string | null) => string | null = () => null): LtvGroup[] => {
        const by = new Map<string | null, number[]>();
        for (const k of keys ?? []) by.set(k, []);
        for (const r of counted) {
          const k = keyOf(r);
          const values = by.get(k);
          if (values) values.push(r.value);
          else by.set(k, [r.value]);
        }
        const out = [...by.entries()].map(([key, values]) => {
          const s = ltvStats(values);
          return { key, label: label(key), collectors: s.collectors, totalMinor: s.totalMinor, averageMinor: s.averageMinor, medianMinor: s.medianMinor };
        });
        if (!keys) out.sort((a, b) => b.collectors - a.collectors || byName(a.label ?? a.key, b.label ?? b.key));
        return maskSmallGroups(out, ['totalMinor', 'averageMinor', 'medianMinor']);
      };
      const tierKey = (held: number) => tierName(tierAt(held, this.thresholds)) ?? 'NONE';
      const ltv: GrowthReport['ltv'] = {
        perCollector: ltvStats(counted.map((r) => r.value)),
        unpricedPieces: counted.reduce((n, r) => n + r.unpriced, 0),
        byTier: groups((r) => tierKey(r.held), [...[...CLUB_TIER_NAMES].reverse(), 'NONE']),
        byCountry: groups((r) => country(r.country)),
        byFirstModel: groups((r) => r.first_model, undefined, (k) => (k ? (names.get(k) ?? null) : null)),
        byChannel: groups((r) => r.first_source, PIECE_SOURCES),
      };

      const seconds = rows.filter((r) => r.second_at !== null).map((r) => ({ first: r.first_at, second: r.second_at! }));
      const repeat: GrowthReport['repeat'] = {
        collectors: rows.length,
        withSecond: seconds.length,
        rate: rows.length ? seconds.length / rows.length : null,
        medianDays: median(seconds.map((p) => Math.floor((p.second.getTime() - p.first.getTime()) / DAY_MS))),
        buckets: secondPieceBuckets(seconds),
        cohorts: cohortTable(
          rows.map((r) => ({ first: r.first_at, second: r.second_at })),
          list,
          now,
        ),
      };

      // The funnel: each account in the month it first reached each step (DELETED accounts kept, the test entrants' pool
      // left out).
      const [scans, accounts, owners, buyers, intervals, clubNow] = [
        await scanMonths(trx, window.from, window.to),
        (await sql<{ month: string; n: number }>`
          SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*)::int AS n FROM accounts
           WHERE created_at >= ${from} AND created_at < ${to} AND ${notTestEntrant('accounts.id')} GROUP BY 1`.execute(trx)).rows,
        (await sql<{ month: string; n: number }>`
          SELECT to_char(f AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*)::int AS n
            FROM (SELECT min(started_at) AS f FROM ownership WHERE ${notTestEntrant('ownership.account_id')} GROUP BY account_id) x
           WHERE f >= ${from} AND f < ${to} GROUP BY 1`.execute(trx)).rows,
        (await sql<{ month: string; n: number }>`
          SELECT to_char(f AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*)::int AS n
            FROM (SELECT min(paid_at) AS f FROM orders
                   WHERE paid_at IS NOT NULL AND channel IN ('LIVE', 'DRAW', 'SALON') AND status NOT IN ('CANCELLED', 'RETURNED')
                     AND ${notTestEntrant('orders.account_id')}
                   GROUP BY account_id) x
           WHERE f >= ${from} AND f < ${to} GROUP BY 1`.execute(trx)).rows,
        // Only the accounts that held enough pieces at some time can have reached PLATINE: the others are not read.
        (await sql<{ account_id: string; started_at: Date; ended_at: Date | null }>`
          SELECT o.account_id, o.started_at, o.ended_at FROM ownership o JOIN products p ON p.id = o.product_id
           WHERE p.status NOT IN (${EXCLUDED}) AND ${notTestEntrant('o.account_id')}
             AND o.account_id IN (SELECT o2.account_id FROM ownership o2 JOIN products p2 ON p2.id = o2.product_id
                                   WHERE p2.status NOT IN (${EXCLUDED}) GROUP BY o2.account_id HAVING count(*) >= ${this.thresholds[1]!})`.execute(trx)).rows,
        await clubMembersByTier(trx, this.thresholds, { withoutTestEntrants: true }),
      ];
      const byAccount = new Map<string, { start: Date; end: Date | null }[]>();
      for (const i of intervals) {
        const iv = { start: dateOf(i.started_at)!, end: dateOf(i.ended_at) };
        const held = byAccount.get(i.account_id);
        if (held) held.push(iv);
        else byAccount.set(i.account_id, [iv]);
      }
      const reached = [...byAccount.values()].map((iv) => tierReachDates(iv, this.thresholds));
      const counts: Record<FunnelStep, Map<string, number>> = {
        scans: new Map(scans.map((s) => [s.month, s.scans])),
        accounts: new Map(accounts.map((r) => [r.month, Number(r.n)])),
        owners: new Map(owners.map((r) => [r.month, Number(r.n)])),
        buyers: new Map(buyers.map((r) => [r.month, Number(r.n)])),
        platine: countByMonth(reached.map((d) => d[1] ?? null)),
        palladium: countByMonth(reached.map((d) => d[2] ?? null)),
      };
      const funnelRows = funnelMonths(list, counts);
      const funnel: GrowthReport['funnel'] = {
        thresholds: [...this.thresholds],
        totals: Object.fromEntries(FUNNEL_STEPS.map((s) => [s, funnelRows.reduce((n, m) => n + m.counts[s], 0)])) as Record<FunnelStep, number>,
        months: funnelRows,
        clubNow,
      };

      const revenue = await this.revenue(trx, currency, list, from, to);
      return { window, ltv, repeat, funnel, revenue };
    });
  }

  /**
   * Invoices less credit notes in `currency`, per month of `list` and by channel, country and model over it. An order is
   * counted once, on its main invoice: a supplementary invoice (plan NEXT LOT §3.6.C, an engraving after PAID) adds to
   * the amounts, never to the orders.
   */
  private async revenue(db: Db, currency: Currency, list: readonly string[], from: Date, to: Date): Promise<GrowthReport['revenue']> {
    const monthly = (
      await sql<{ month: string; kind: string; n: number; total: number }>`
        SELECT to_char(issued_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, kind,
               (count(*) FILTER (WHERE supplements_invoice_id IS NULL))::int AS n, sum(total_minor)::bigint AS total
          FROM invoices WHERE currency = ${currency} AND issued_at >= ${from} AND issued_at < ${to} GROUP BY 1, 2`.execute(db)
    ).rows;
    const months = [...list].reverse().map((month) => {
      const inv = monthly.find((r) => r.month === month && r.kind === 'INVOICE');
      const cn = monthly.find((r) => r.month === month && r.kind === 'CREDIT_NOTE');
      const invoiced = Number(inv?.total ?? 0);
      const credited = Number(cn?.total ?? 0);
      return { month, orders: Number(inv?.n ?? 0), invoicedMinor: invoiced, creditedMinor: credited, netMinor: invoiced - credited };
    });
    const total = months.reduce((t, m) => ({ orders: t.orders + m.orders, invoicedMinor: t.invoicedMinor + m.invoicedMinor, creditedMinor: t.creditedMinor + m.creditedMinor, netMinor: t.netMinor + m.netMinor }), {
      orders: 0,
      invoicedMinor: 0,
      creditedMinor: 0,
      netMinor: 0,
    });
    const grouped = async (key: RawBuilder<string | null>, label: RawBuilder<string | null>): Promise<RevenueGroup[]> => {
      const rows = (
        await sql<{ key: string | null; label: string | null; collectors: number; orders: number; net: number }>`
          SELECT ${key} AS key, min(${label}) AS label, count(DISTINCT o.account_id)::int AS collectors,
                 (count(*) FILTER (WHERE i.kind = 'INVOICE' AND i.supplements_invoice_id IS NULL))::int AS orders,
                 sum(CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END)::bigint AS net
            FROM invoices i
            JOIN orders o ON o.id = i.order_id
            JOIN accounts a ON a.id = o.account_id
            JOIN models m ON m.id = o.model_id
            LEFT JOIN models mm ON mm.id = m.variant_of
           WHERE i.currency = ${currency} AND i.issued_at >= ${from} AND i.issued_at < ${to}
           GROUP BY 1`.execute(db)
      ).rows.map((r) => ({ key: r.key === null ? null : r.key.trim() || null, label: r.label, collectors: Number(r.collectors), orders: Number(r.orders), netMinor: Number(r.net) }));
      rows.sort((a, b) => (b.netMinor ?? 0) - (a.netMinor ?? 0) || byName(a.label ?? a.key, b.label ?? b.key));
      return maskSmallGroups(rows, ['netMinor']);
    };
    const byChannel = await grouped(sql`o.channel`, sql`NULL::text`);
    return {
      months,
      total,
      byChannel: REVENUE_CHANNELS.map((c) => byChannel.find((g) => g.key === c) ?? { key: c, label: null, collectors: 0, orders: 0, netMinor: 0 }),
      byCountry: await grouped(sql`a.country::text`, sql`NULL::text`),
      byModel: await grouped(sql`coalesce(m.variant_of, m.id)::text`, sql`coalesce(mm.name, m.name)`),
    };
  }

  /** COLLECTORS BY VALUE: a page of GROWTH_COLLECTORS_PAGE (see the file header); emails as stored. */
  async collectors(q: { currency?: string; page?: number } = {}): Promise<GrowthCollectors> {
    const requested = parseCurrency(q.currency);
    const page = q.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 100_000) throw validationError('page: A whole number from 1.');
    return this.readOnly(async (trx) => {
      const { currency, currencies } = await currenciesOf(trx, requested);
      const rows = (
        await sql<CollectorRow & { total: number }>`
          SELECT c.*, count(*) OVER ()::int AS total FROM (${collectorRows(currency)}) c
           WHERE c.priced + c.unpriced > 0
           ORDER BY c.value DESC, c.account_id
           LIMIT ${GROWTH_COLLECTORS_PAGE} OFFSET ${(page - 1) * GROWTH_COLLECTORS_PAGE}`.execute(trx)
      ).rows;
      let total = Number(rows[0]?.total ?? 0);
      if (rows.length === 0 && page > 1) {
        const c = await sql<{ n: number }>`SELECT count(*)::int AS n FROM (${collectorRows(currency)}) c WHERE c.priced + c.unpriced > 0`.execute(trx);
        total = Number(c.rows[0]?.n ?? 0);
      }
      return {
        currency,
        currencies,
        page,
        pageSize: GROWTH_COLLECTORS_PAGE,
        total,
        items: rows.map((r) => ({
          accountId: r.account_id,
          email: r.email,
          tier: tierName(tierAt(Number(r.held), this.thresholds)),
          country: country(r.country),
          pieces: Number(r.priced) + Number(r.unpriced),
          valueMinor: Number(r.value),
          firstPieceAt: dateOf(r.first_at)!,
        })),
      };
    });
  }

  /** The GROWTH_RELEASES latest releases past their opening (no draft, cancelled release or after-room), the latest first. */
  async releases(): Promise<GrowthRelease[]> {
    const now = this.clock();
    const drops = await this.db
      .selectFrom('drops')
      .select(['id', 'mode', 'title', 'opens_at', 'quantity'])
      .where('published_at', 'is not', null)
      .where('cancelled_at', 'is', null)
      .where('parent_drop_id', 'is', null)
      .where('opens_at', '<=', now)
      .orderBy('opens_at', 'desc')
      .orderBy('id')
      .limit(GROWTH_RELEASES)
      .execute();
    const draws = drops.filter((d) => d.mode === 'DRAW').map((d) => d.id);
    const [summaries, entries, sold] = await Promise.all([
      this.insights.summaries(drops.filter((d) => d.mode === 'LIVE').map((d) => d.id)),
      draws.length
        ? this.db.selectFrom('drop_entries').select((eb) => ['drop_id', eb.fn.countAll<number>().as('n')]).where('drop_id', 'in', draws).where('status', '<>', 'WITHDRAWN').groupBy('drop_id').execute()
        : [],
      draws.length
        ? this.db
            .selectFrom('orders')
            .select((eb) => ['drop_id', eb.fn.countAll<number>().as('n')])
            .where('drop_id', 'in', draws)
            .where('channel', '=', 'DRAW')
            .where('paid_at', 'is not', null)
            .where('status', 'not in', ['CANCELLED', 'RETURNED'])
            .groupBy('drop_id')
            .execute()
        : [],
    ]);
    return drops.map((d) => {
      if (d.mode === 'LIVE') {
        const s = summaries.get(d.id);
        return { id: d.id, mode: d.mode, title: d.title, opensAt: d.opens_at, pieces: s?.stock ?? d.quantity, sold: s ? s.confirmedPieces - s.cancelledPieces : 0, sellOutMs: s?.sellOutMs ?? null, entries: null };
      }
      return {
        id: d.id,
        mode: d.mode,
        title: d.title,
        opensAt: d.opens_at,
        pieces: d.quantity,
        sold: Number(sold.find((x) => x.drop_id === d.id)?.n ?? 0),
        sellOutMs: null,
        entries: Number(entries.find((x) => x.drop_id === d.id)?.n ?? 0),
      };
    });
  }

  /** The account's lifetime value per currency (the client sheet), by the rule of COLLECTORS BY VALUE; 404 ACCOUNT_NOT_FOUND. */
  async collectorValue(accountId: string): Promise<LifetimeValue> {
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    return collectorValue(this.db, accountId.toLowerCase());
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction: every reading of a report sees the same moment. */
  private async readOnly<T>(fn: (trx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (trx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(trx);
      // The purchases are sorted once per reading (by account, then time): in memory rather than on disk.
      await sql`SET LOCAL work_mem = '64MB'`.execute(trx);
      return fn(trx);
    });
  }
}

/** The account's lifetime value per currency: its purchases' values, the currencies in order (empty: no priced piece). */
export async function collectorValue(db: Db, accountId: string): Promise<LifetimeValue> {
  const rows = (
    await sql<{ currency: string; value: number }>`
      SELECT p.currency, sum(p.value)::bigint AS value FROM (${purchases(accountId)}) p
       WHERE p.value IS NOT NULL GROUP BY p.currency ORDER BY p.currency`.execute(db)
  ).rows;
  return rows.map((r) => ({ currency: r.currency, valueMinor: Number(r.value) }));
}

/** A currency of the house (HOUSE_CURRENCIES) or none; 400 VALIDATION_FAILED otherwise. */
function parseCurrency(v: string | undefined): Currency | undefined {
  if (v === undefined) return undefined;
  if (!(HOUSE_CURRENCIES as readonly string[]).includes(v)) throw validationError(`currency: ${HOUSE_CURRENCIES.join(', ')}.`);
  return v as Currency;
}

