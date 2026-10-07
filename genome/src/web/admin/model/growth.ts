/**
 * The Growth page of the console (plan NEXT-NINE, §3.9 BP-29, step 9.2) — pure helpers, no DOM.
 *
 *  - The page's state reads from its query, kept to what the server takes: the window (`months`, 12 or 24), one
 *    currency of the house, the tab of the lifetime value's breakdowns (`ltv`), the revenue's (`rev`), the page of
 *    COLLECTORS BY VALUE (`page`).
 *  - The words and figures of each section: amounts in the house's money (`€ 4 800`, never converted), a group under
 *    three collectors read as its count and '—', a mark not reached yet as '—'. Figures read in the console's --font;
 *    the labels that sit in the display face carry no figure.
 */
import { formatCount, formatDate, percent } from '../format.js';
import { href } from '../router.js';
import {
  FUNNEL_STEPS,
  GROWTH_WINDOWS,
  HOUSE_CURRENCIES,
  PIECE_SOURCES,
  SECOND_PIECE_BUCKETS,
  type FunnelStep,
  type GrowthCollector,
  type GrowthLtvGroup,
  type GrowthRelease,
  type GrowthReport,
  type GrowthRevenueGroup,
  type GrowthWindowMonths,
  type HouseCurrency,
  type LifetimeValue,
  type PieceSource,
  type SecondPieceBucket,
} from '../types.js';
import type { BarRow, Kpi } from './dashboard.js';
import { monthLabel } from './invoices.js';
import { formatMoney } from './live.js';

/** The breakdowns of lifetime value, and of the revenue, as the page's tabs. */
export const LTV_TABS = ['tier', 'country', 'model', 'channel'] as const;
export type LtvTab = (typeof LTV_TABS)[number];
export const REVENUE_TABS = ['channel', 'country', 'model'] as const;
export type RevenueTab = (typeof REVENUE_TABS)[number];

export const LTV_TAB_LABELS: Readonly<Record<LtvTab, string>> = Object.freeze({ tier: 'By tier', country: 'By country', model: 'By first model', channel: 'By channel' });
export const REVENUE_TAB_LABELS: Readonly<Record<RevenueTab, string>> = Object.freeze({ channel: 'By channel', country: 'By country', model: 'By model' });

/** COLLECTORS BY VALUE: rows per page (services/growth.ts GROWTH_COLLECTORS_PAGE). */
export const GROWTH_COLLECTORS_PAGE = 25;

export interface GrowthParams {
  months: GrowthWindowMonths;
  /** Only when the query names one: the server chooses otherwise. */
  currency: HouseCurrency | null;
  ltv: LtvTab;
  rev: RevenueTab;
  page: number;
}

/** The page's state from its query: anything the server would refuse reads as the default. */
export function growthParams(query: Readonly<Record<string, string | undefined>>): GrowthParams {
  const months = Number(query.months);
  const page = Number(query.page);
  return {
    months: (GROWTH_WINDOWS as readonly number[]).includes(months) ? (months as GrowthWindowMonths) : GROWTH_WINDOWS[0],
    currency: (HOUSE_CURRENCIES as readonly string[]).includes(query.currency ?? '') ? (query.currency as HouseCurrency) : null,
    ltv: (LTV_TABS as readonly string[]).includes(query.ltv ?? '') ? (query.ltv as LtvTab) : 'tier',
    rev: (REVENUE_TABS as readonly string[]).includes(query.rev ?? '') ? (query.rev as RevenueTab) : 'channel',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** An amount as the house writes it, its sign when below zero: `€ 4 800`, `−€ 50`; '—' when withheld. */
export function money(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  return minor < 0 ? `−${formatMoney(-minor, currency)}` : formatMoney(minor, currency);
}

/** A rate (0..1) as `18 %`, '—' without one. */
export function rateText(rate: number | null | undefined): string {
  return rate === null || rate === undefined || !Number.isFinite(rate) ? '—' : `${Math.round(rate * 100)} %`;
}

export const LEAD =
  'How the house grows: what a collector is worth, who comes back for a second piece, how a scan becomes a member, and the revenue. Clients are named only in COLLECTORS BY VALUE, masked for read-only staff.';

export const NOTES = Object.freeze({
  ltv: 'App orders at their invoiced price, after credit notes, and pieces registered from elsewhere at their model’s price',
  repeat: 'A piece bought in the app or registered from elsewhere; cancelled and returned orders left out',
  revenue: 'Invoices less credit notes, in the month each was issued',
  masked: 'Fewer than 3 collectors: amounts not shown.',
  scansCounted: 'Scans are counted, not people.',
  unpriced: 'Their model has no price in the Catalogue',
  failed: 'This figure could not be read. The rest of the page is current.',
});

export const EMPTY = Object.freeze({
  ltv: 'No piece counted yet.',
  repeat: 'No collector has a piece yet.',
  revenue: 'No invoice in these months.',
  releases: 'No release has opened yet.',
});

// ── KPIs ───────────────────────────────────────────────────────────────────

/** Collectors (their average value), Second piece (the median time to it), New owners and Net revenue of the window. */
export function growthKpis(r: GrowthReport): Kpi[] {
  const c = r.window.currency;
  const months = `IN ${r.window.months} MONTHS`;
  return [
    {
      key: 'collectors',
      label: 'Collectors',
      value: formatCount(r.ltv.perCollector.collectors),
      note: r.ltv.perCollector.averageMinor === null ? 'NO PIECE COUNTED' : `AVERAGE VALUE ${money(r.ltv.perCollector.averageMinor, c)}`,
      tone: 'solid',
    },
    {
      key: 'second',
      label: 'Second piece',
      value: rateText(r.repeat.rate),
      note: r.repeat.medianDays === null ? 'NONE YET' : `MEDIAN ${formatCount(r.repeat.medianDays)} ${r.repeat.medianDays === 1 ? 'DAY' : 'DAYS'}`,
      tone: 'solid',
    },
    { key: 'owners', label: 'New owners', value: formatCount(r.funnel.totals.owners), note: months, tone: 'solid' },
    { key: 'revenue', label: 'Net revenue', value: money(r.revenue.total.netMinor, c), note: `${months} · AFTER CREDIT NOTES`, tone: 'solid' },
  ];
}

// ── Lifetime value ─────────────────────────────────────────────────────────

/** Per collector: Collectors · Average · Median · Top 10% from · Pieces without a price. */
export function perCollectorFigures(r: GrowthReport): { key: string; label: string; value: string; note?: string }[] {
  const p = r.ltv.perCollector;
  const c = r.window.currency;
  return [
    { key: 'collectors', label: 'Collectors', value: formatCount(p.collectors) },
    { key: 'average', label: 'Average', value: money(p.averageMinor, c) },
    { key: 'median', label: 'Median', value: money(p.medianMinor, c) },
    { key: 'top', label: 'Top 10% from', value: money(p.topTenthFromMinor, c) },
    { key: 'unpriced', label: 'Pieces without a price', value: formatCount(r.ltv.unpricedPieces), note: NOTES.unpriced },
  ];
}

export const SOURCE_LABELS: Readonly<Record<PieceSource, string>> = Object.freeze({
  LIVE: 'LIVE RELEASE',
  DRAW: 'DRAW',
  SALON: 'THE PRIVATE SALON',
  POINT_OF_SALE: 'POINT OF SALE',
  ELSEWHERE: 'ELSEWHERE',
});

/** A country's code as a breakdown names it, or 'Not given'. */
export function countryText(code: string | null): string {
  return code ? code : 'Not given';
}

/** A group's name in the tab's terms. */
export function ltvGroupLabel(tab: LtvTab, g: Pick<GrowthLtvGroup, 'key' | 'label'>): string {
  if (tab === 'tier') return g.key === 'NONE' || !g.key ? 'No piece held now' : g.key;
  if (tab === 'channel') return (PIECE_SOURCES as readonly string[]).includes(g.key ?? '') ? SOURCE_LABELS[g.key as PieceSource] : (g.key ?? '—');
  if (tab === 'model') return g.label ?? '—';
  return countryText(g.key);
}

export interface GroupRow {
  key: string;
  label: string;
  collectors: string;
  total: string;
  average: string;
  median: string;
  /** Under three collectors: the amounts read '—'. */
  masked: boolean;
}

/** The tab's table: Collectors, Total, Average and Median; '—' under three collectors. */
export function ltvGroupRows(r: GrowthReport, tab: LtvTab): GroupRow[] {
  const groups = { tier: r.ltv.byTier, country: r.ltv.byCountry, model: r.ltv.byFirstModel, channel: r.ltv.byChannel }[tab];
  const c = r.window.currency;
  return groups.map((g) => ({
    key: g.key ?? 'none',
    label: ltvGroupLabel(tab, g),
    collectors: formatCount(g.collectors),
    total: money(g.totalMinor, c),
    average: money(g.averageMinor, c),
    median: money(g.medianMinor, c),
    masked: g.totalMinor === null && g.collectors > 0,
  }));
}

/** COLLECTORS BY VALUE's row: the client (its email, masked for an AUDITOR by the server), its tier, country, pieces, value, first piece. */
export function collectorRow(c: GrowthCollector, currency: string): { link: string; email: string; tier: string; country: string; pieces: string; value: string; first: string } {
  return {
    link: href('owner', { accountId: c.accountId }),
    email: c.email,
    tier: c.tier ?? 'No piece held now',
    country: countryText(c.country),
    pieces: formatCount(c.pieces),
    value: money(c.valueMinor, currency),
    first: formatDate(c.firstPieceAt),
  };
}

/** `1–25 of 120`, and whether the pages before and after exist. */
export function collectorsRange(p: { page: number; pageSize: number; total: number }): { text: string; previous: boolean; next: boolean } {
  const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
  const to = Math.min(p.total, p.page * p.pageSize);
  return { text: `${formatCount(from)}–${formatCount(to)} of ${formatCount(p.total)}`, previous: p.page > 1, next: p.page * p.pageSize < p.total };
}

// ── Repeat buying ──────────────────────────────────────────────────────────

export const BUCKET_LABELS: Readonly<Record<SecondPieceBucket, string>> = Object.freeze({
  MONTH: 'Within a month',
  THREE_MONTHS: 'One to three months',
  SIX_MONTHS: 'Three to six months',
  YEAR: 'Six months to a year',
  LATER: 'After a year',
});

/** Collectors with a piece, With a second piece, Rate and Median time to the second piece. */
export function repeatFigures(r: GrowthReport): { key: string; label: string; value: string }[] {
  const x = r.repeat;
  return [
    { key: 'collectors', label: 'Collectors with a piece', value: formatCount(x.collectors) },
    { key: 'second', label: 'With a second piece', value: formatCount(x.withSecond) },
    { key: 'rate', label: 'Rate', value: rateText(x.rate) },
    { key: 'median', label: 'Median time to the second piece', value: x.medianDays === null ? '—' : `${formatCount(x.medianDays)} ${x.medianDays === 1 ? 'day' : 'days'}` },
  ];
}

/** The time to the second piece as hairline bars, each bucket's share of the collectors with one. */
export function secondPieceBars(r: GrowthReport): BarRow[] {
  const values = SECOND_PIECE_BUCKETS.map((b) => r.repeat.buckets[b] ?? 0);
  const max = Math.max(0, ...values);
  return SECOND_PIECE_BUCKETS.map((b, i) => ({
    key: b,
    label: BUCKET_LABELS[b],
    value: values[i]!,
    fraction: max > 0 ? values[i]! / max : 0,
    share: percent(values[i]!, r.repeat.withSecond),
    tone: 'solid',
  }));
}

/** A cohort's cells: its collectors, the share with a second piece at each mark ('—' until reached) and to date. */
export function cohortCells(row: GrowthReport['repeat']['cohorts'][number]): { month: string; collectors: string; within: string[]; toDate: string } {
  const share = (n: number | null) => (n === null ? '—' : row.collectors === 0 ? '—' : `${Math.round((n / row.collectors) * 100)} %`);
  return { month: monthLabel(row.month), collectors: formatCount(row.collectors), within: row.within.map(share), toDate: share(row.toDate) };
}

// ── The funnel ─────────────────────────────────────────────────────────────

export const FUNNEL_LABELS: Readonly<Record<FunnelStep, string>> = Object.freeze({
  scans: 'Scans',
  accounts: 'Accounts created',
  owners: 'Registered owners',
  buyers: 'Buyers',
  platine: 'Reached PLATINE',
  palladium: 'Reached PALLADIUM',
});

/** The funnel's note, its thresholds read from the server (CLUB_TIER_THRESHOLDS). */
export function funnelNote(thresholds: readonly number[]): string {
  const [t, p, pd] = thresholds;
  return `Each account in the month it first reached the step · tiers by pieces held: TITANE ${t}, PLATINE ${p}, PALLADIUM ${pd}`;
}

/** Each step over the window as a bar, its share of the step before (Accounts: per 100 scans). */
export function funnelBars(r: GrowthReport): BarRow[] {
  const t = r.funnel.totals;
  const max = Math.max(0, ...FUNNEL_STEPS.map((s) => t[s]));
  return FUNNEL_STEPS.map((s, i) => {
    const before = i > 0 ? t[FUNNEL_STEPS[i - 1]!] : 0;
    const share =
      i === 0 ? '' : s === 'accounts' ? (before > 0 ? `${formatCount(Math.round((t[s] / before) * 100))} per 100 scans` : '—') : before > 0 ? `${percent(t[s], before)} of the step before` : '—';
    return { key: s, label: FUNNEL_LABELS[s], value: t[s], fraction: max > 0 ? t[s] / max : 0, share, tone: 'solid' };
  });
}

/** 'In the club now: 4 TITANE · 0 PLATINE · 1 PALLADIUM'. */
export function clubNowLine(r: GrowthReport): string {
  const m = r.funnel.clubNow;
  return `In the club now: ${formatCount(m.TITANE)} TITANE · ${formatCount(m.PLATINE)} PLATINE · ${formatCount(m.PALLADIUM)} PALLADIUM`;
}

// ── Revenue ────────────────────────────────────────────────────────────────

export interface MoneyBar {
  key: string;
  label: string;
  value: string;
  fraction: number;
  negative: boolean;
  link: string;
}

/** The net of each month, the oldest first, as hairline bars; each month opens its Invoices page. */
export function revenueBars(r: GrowthReport): MoneyBar[] {
  const months = [...r.revenue.months].reverse();
  const max = Math.max(0, ...months.map((m) => Math.abs(m.netMinor)));
  return months.map((m) => ({
    key: m.month,
    label: monthLabel(m.month),
    value: money(m.netMinor, r.window.currency),
    fraction: max > 0 ? Math.abs(m.netMinor) / max : 0,
    negative: m.netMinor < 0,
    link: href('invoices', {}, { month: m.month }),
  }));
}

/** A revenue group's name in the tab's terms. */
export function revenueGroupLabel(tab: RevenueTab, g: Pick<GrowthRevenueGroup, 'key' | 'label'>): string {
  if (tab === 'channel') return (PIECE_SOURCES as readonly string[]).includes(g.key ?? '') ? SOURCE_LABELS[g.key as PieceSource] : (g.key ?? '—');
  if (tab === 'model') return g.label ?? '—';
  return countryText(g.key);
}

/** The tab's table: Orders and Net; '—' under three collectors. */
export function revenueGroupRows(r: GrowthReport, tab: RevenueTab): { key: string; label: string; orders: string; net: string; masked: boolean }[] {
  const groups = { channel: r.revenue.byChannel, country: r.revenue.byCountry, model: r.revenue.byModel }[tab];
  return groups.map((g) => ({
    key: g.key ?? 'none',
    label: revenueGroupLabel(tab, g),
    orders: formatCount(g.orders),
    net: money(g.netMinor, r.window.currency),
    masked: g.netMinor === null,
  }));
}

// ── Elsewhere in the console ───────────────────────────────────────────────

/** A sell-out's time: `4 MIN 20 S`, `1 H 05 MIN`, `40 S`. */
export function durationText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} S`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} MIN ${String(s % 60).padStart(2, '0')} S`;
  return `${Math.floor(m / 60)} H ${String(m % 60).padStart(2, '0')} MIN`;
}

/** Latest releases' row: its page, method, opening, pieces, sold, then the sell-out (LIVE) or the entries (DRAW). */
export function releaseRow(x: GrowthRelease): { link: string; title: string; method: string; opened: string; pieces: string; sold: string; soldOutIn: string; entries: string } {
  return {
    link: x.mode === 'LIVE' ? href('liveRelease', { dropId: x.id }) : href('drop', { dropId: x.id }),
    title: x.title,
    method: x.mode === 'LIVE' ? 'LIVE RELEASE' : 'DRAW',
    opened: formatDate(x.opensAt),
    pieces: formatCount(x.pieces),
    sold: formatCount(x.sold),
    soldOutIn: x.mode === 'LIVE' ? durationText(x.sellOutMs) : '—',
    entries: x.mode === 'DRAW' ? formatCount(x.entries) : '—',
  };
}

// ── The client sheet ───────────────────────────────────────────────────────

/** The client sheet's Lifetime value: `€ 6 700`, several currencies joined by ' · ', '—' when none. */
export function lifetimeValueText(v: LifetimeValue | undefined): string {
  return v && v.length ? v.map((x) => money(x.valueMinor, x.currency)).join(' · ') : '—';
}
