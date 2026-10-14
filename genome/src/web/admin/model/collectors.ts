/**
 * The Collectors page's words and pure helpers (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6, §3.0 (d), (e); steps
 * 9.2 and 9.9): the page under Clients, after Owners, read from AUDITOR (`readCollectors`). Pure: no DOM; every word here
 * is checked by admin.brand.test.ts.
 *
 *   - The query (§3.6 C.6.2): the period `p` (7d, 30d, 90d, 12m, custom with `from` and `to`), `cmp` (on by default,
 *     written `cmp=0` when off), `scope` (all, active, new) and the five filters `c`, `s`, `t`, `sc`, `ft`, read from the
 *     route (`collectorsParams`: anything the server would refuse reads as the default) and written back
 *     (`collectorsRouteQuery`: the defaults left out). A view whose address would pass the route's 512 characters is
 *     refused before it is applied (`tooManyChoices`).
 *   - The view in words under the bar (`viewWords`), the periods in Paris days as the server counts them.
 *   - The comparison of a figure with the previous period (`compareWords`, `newWords`): `+86 (+7%)` and `1 118 before`,
 *     'new' when there was none, '—' when both are 0, no percentage when either side counts fewer than 3 collectors.
 *   - Every figure's link to its collectors (`listHref`, slices of §3.6 C.6.5) with its `aria-label`, never for a 0, and
 *     never for a city when the reader is an AUDITOR (the server refuses those lists: §3.0 (h)).
 */
import { formatCount, formatDate } from '../format.js';
import { href } from '../router.js';
import {
  COLLECTOR_AGE_SLICES,
  COLLECTOR_PERIODS,
  COLLECTOR_SCOPES,
  COLLECTOR_SOURCE_KINDS,
  type CollectorAgeSlice,
  type CollectorPeriod,
  type CollectorScope,
  type CollectorSourceKind,
  type CollectorsOptions,
  type CollectorsQuery,
  type HouseCurrency,
} from '../types.js';
import { countryName } from './analytics.js';
import { addDays, daysApart, isDay, parisDay } from './links.js';

export const COLLECTORS_PAGE_COPY = Object.freeze({
  eyebrow: 'Clients',
  title: 'Collectors',
  lead: 'Who the collectors are, where they come from, what they like, the devices they use and how engaged they are, over the period you choose. Every figure opens its collectors. Test entrants and the team’s own accounts are left out.',
  /** §3.0 (d): GROWTH is unchanged. */
  growthTeam: 'GROWTH still counts the team’s accounts.',
  /** §3.0 (e): the page counts Paris months. */
  parisMonths: 'Months are Paris months; GROWTH counts UTC months.',
});

/** The controls' words (§3.6 C.6.2). */
export const CONTROLS_COPY = Object.freeze({
  period: 'Period',
  compare: 'Compare with the previous period',
  scope: 'Collectors',
  country: 'Country',
  source: 'Source',
  tier: 'Tier',
  tierHint: 'Tier held now.',
  score: 'Score',
  scoreFrom: 'From',
  scoreTo: 'To',
  scoreApply: 'Apply',
  scoreProblem: 'A score from 0 to 100, the first not above the second.',
  favourite: 'Favourite piece',
  clear: 'Clear filters',
  filters: 'Filters',
  done: 'Done',
  from: 'From',
  to: 'To',
  apply: 'Apply',
  customProblem: 'Choose dates from 1 Jan 2026 to today, at most two years apart.',
  tooMany: 'Too many choices for one view: remove one.',
  readAt: 'Read at',
  readAgain: 'Read again',
  noChoice: 'None to choose yet.',
});

/** The periods' tabs: the figure in --font, then its words. */
export const PERIOD_TABS: Readonly<Record<CollectorPeriod, { figure: string | null; words: string }>> = Object.freeze({
  '7d': { figure: '7', words: 'LAST DAYS' },
  '30d': { figure: '30', words: 'LAST DAYS' },
  '90d': { figure: '90', words: 'LAST DAYS' },
  '12m': { figure: '12', words: 'LAST MONTHS' },
  custom: { figure: null, words: 'CUSTOM' },
});

/** A period's tab as it reads: `LAST 30 DAYS`, `CUSTOM`. */
export function periodTabWords(p: CollectorPeriod): string {
  const t = PERIOD_TABS[p];
  return t.figure ? t.words.replace(' ', ` ${t.figure} `) : t.words;
}

export const SCOPE_LABELS: Readonly<Record<CollectorScope, string>> = Object.freeze({ all: 'ALL', active: 'ACTIVE IN THE PERIOD', new: 'NEW IN THE PERIOD' });
/** The Source filter's kinds after the link channels (where they first came from). */
export const SOURCE_KIND_LABELS: Readonly<Record<CollectorSourceKind, string>> = Object.freeze({
  CAMPAIGN: 'Campaign tags',
  SITE: 'Referring sites',
  DIRECT: 'Direct',
  BEFORE: 'Before tracking',
  STAFF: 'Console device',
});
/** The Tier filter's choices: 0 NO TIER, then the tiers. */
export const TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({ 0: 'NO TIER', 1: 'TITANE', 2: 'PLATINE', 3: 'PALLADIUM' });
/** The Tier filter's order (§3.6 C.6.2). */
export const TIER_ORDER = [0, 1, 2, 3] as const;

// ── The query ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The route's hash, at most (router.ts MAX_HASH). */
export const COLLECTORS_MAX_HASH = 512;
/** The first day a CUSTOM period may start (insights-scope.ts CUSTOM_FIRST_DAY), its days apart at most. */
export const CUSTOM_FIRST_DAY = '2026-01-01';
export const CUSTOM_MAX_DAYS = 731;
/** The days of each rolling period, today included (insights-scope.ts PERIOD_DAYS). */
export const PERIOD_DAYS: Readonly<Record<Exclude<CollectorPeriod, 'custom'>, number>> = Object.freeze({ '7d': 7, '30d': 30, '90d': 90, '12m': 365 });

/** The page's state, from its address. */
export interface CollectorsParams {
  p: CollectorPeriod;
  /** CUSTOM's days, null otherwise or while not valid. */
  from: string | null;
  to: string | null;
  cmp: boolean;
  scope: CollectorScope;
  /** The five filters, each list once and sorted as the server keys them. */
  c: string[];
  s: string[];
  t: number[];
  sc: { min: number; max: number } | null;
  ft: string[];
}

export const DEFAULT_PARAMS: CollectorsParams = Object.freeze({ p: '30d', from: null, to: null, cmp: true, scope: 'all', c: [], s: [], t: [], sc: null, ft: [] }) as CollectorsParams;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const listOf = (raw: string | undefined): string[] => [...new Set((raw ?? '').split(',').map((x) => x.trim()).filter((x) => x !== ''))];

/** A CUSTOM period's problem at `today` (Paris), or null (insights-scope.ts parisPeriod's rule). */
export function customProblem(from: string | null, to: string | null, today: string): string | null {
  if (!isDay(from) || !isDay(to) || from < CUSTOM_FIRST_DAY || to > today || from > to || daysApart(from, to) > CUSTOM_MAX_DAYS) return CONTROLS_COPY.customProblem;
  return null;
}

/** A score range typed in From and To: null when both are empty, the problem's words when not 0–100 in order. */
export function scoreRange(from: string, to: string): { min: number; max: number } | null | string {
  const a = from.trim();
  const b = to.trim();
  if (a === '' && b === '') return null;
  const min = a === '' ? 0 : Number(a);
  const max = b === '' ? 100 : Number(b);
  if (![min, max].every((n) => Number.isInteger(n) && n >= 0 && n <= 100) || min > max) return CONTROLS_COPY.scoreProblem;
  return { min, max };
}

/** The page's state from its address at `now`: anything the server would refuse reads as the default. */
export function collectorsParams(query: Readonly<Record<string, string | undefined>>, now: Date): CollectorsParams {
  const today = parisDay(now);
  let p = (COLLECTOR_PERIODS as readonly string[]).includes(query.p ?? '') ? (query.p as CollectorPeriod) : DEFAULT_PARAMS.p;
  let from: string | null = null;
  let to: string | null = null;
  if (p === 'custom') {
    if (customProblem(query.from ?? null, query.to ?? null, today) === null) {
      from = query.from!;
      to = query.to!;
    } else p = DEFAULT_PARAMS.p;
  }
  const scope = (COLLECTOR_SCOPES as readonly string[]).includes(query.scope ?? '') ? (query.scope as CollectorScope) : 'all';
  const c = listOf(query.c).map((x) => x.toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  const s = listOf(query.s).filter((x) => UUID_RE.test(x) || (x.startsWith('kind:') && (COLLECTOR_SOURCE_KINDS as readonly string[]).includes(x.slice(5))));
  const t = listOf(query.t).filter((x) => /^[0-3]$/.test(x)).map(Number);
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(query.sc ?? '');
  const sc = m && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 100 ? { min: Number(m[1]), max: Number(m[2]) } : null;
  const ft = listOf(query.ft).filter((x) => x.length <= 64);
  return {
    p,
    from,
    to,
    cmp: query.cmp !== '0',
    scope,
    c: [...new Set(c)].sort(byCode),
    s: [...new Set(s)].sort(byCode),
    t: [...new Set(t)].sort((a, b) => a - b),
    sc,
    ft: [...new Set(ft)].sort(byCode),
  };
}

/** The address's query for a state, `change` merged in (the defaults left out, so `#/collectors` is the default view). */
export function collectorsRouteQuery(p: CollectorsParams, change: Partial<CollectorsParams> = {}): Record<string, string | null> {
  const n = { ...p, ...change };
  const custom = n.p === 'custom';
  return {
    p: n.p === DEFAULT_PARAMS.p ? null : n.p,
    from: custom ? n.from : null,
    to: custom ? n.to : null,
    cmp: n.cmp ? null : '0',
    scope: n.scope === 'all' ? null : n.scope,
    c: n.c.length ? [...n.c].sort(byCode).join(',') : null,
    s: n.s.length ? [...n.s].sort(byCode).join(',') : null,
    t: n.t.length ? [...n.t].sort((a, b) => a - b).join(',') : null,
    sc: n.sc ? `${n.sc.min}-${n.sc.max}` : null,
    ft: n.ft.length ? [...n.ft].sort(byCode).join(',') : null,
  };
}

/** The page's address for a state (`#/collectors?…`). */
export function collectorsHref(p: CollectorsParams, change: Partial<CollectorsParams> = {}): string {
  return href('collectors', {}, collectorsRouteQuery(p, change));
}

/** Whether an address passes the route's 512 characters: the choice that makes it is refused (CONTROLS_COPY.tooMany). */
export function tooManyChoices(hash: string): boolean {
  return hash.length > COLLECTORS_MAX_HASH;
}

/** The query the routes read for a state (and Over time's figure and split, or a currency, when given). */
export function collectorsApiQuery(p: CollectorsParams, extra: Pick<CollectorsQuery, 'figure' | 'split' | 'currency'> = {}): CollectorsQuery {
  const q = collectorsRouteQuery(p);
  return {
    p: p.p,
    ...(p.p === 'custom' ? { from: p.from ?? undefined, to: p.to ?? undefined } : {}),
    ...(p.cmp ? {} : { cmp: false }),
    scope: p.scope,
    ...(q.c ? { c: q.c } : {}),
    ...(q.s ? { s: q.s } : {}),
    ...(q.t ? { t: q.t } : {}),
    ...(q.sc ? { sc: q.sc } : {}),
    ...(q.ft ? { ft: q.ft } : {}),
    ...extra,
  };
}

/** The filters set, of the five (« Filters (3) »). */
export function filterCount(p: CollectorsParams): number {
  return [p.c.length > 0, p.s.length > 0, p.t.length > 0, p.sc !== null, p.ft.length > 0].filter(Boolean).length;
}

/** The five filters emptied (Clear filters), the period, the comparison and the scope kept. */
export function clearedFilters(p: CollectorsParams): CollectorsParams {
  return { ...p, c: [], s: [], t: [], sc: null, ft: [] };
}

/** One choice of a list filter ticked or not. */
export function toggled<T extends string | number>(list: readonly T[], value: T, on: boolean): T[] {
  const rest = list.filter((x) => x !== value);
  return on ? [...rest, value] : rest;
}

// ── The periods, in words ────────────────────────────────────────────────────────────────────────────────────────

/** The period's Paris days at `now` (insights-scope.ts parisPeriod's rule), and the previous period's. */
export function periodDays(p: Pick<CollectorsParams, 'p' | 'from' | 'to'>, now: Date): { from: string; to: string; previous: { from: string; to: string } } {
  const today = parisDay(now);
  const range = p.p === 'custom' && p.from && p.to ? { from: p.from, to: p.to } : { from: addDays(today, -((PERIOD_DAYS[p.p === 'custom' ? '30d' : p.p] ?? 30) - 1)), to: today };
  const days = daysApart(range.from, range.to) + 1;
  const prevTo = addDays(range.from, -1);
  return { ...range, previous: { from: addDays(prevTo, -(days - 1)), to: prevTo } };
}

/** Two Paris days as a range: `15 SEP to 14 OCT 2026`, the year once when they share it; one day alone. */
export function rangeWords(from: string, to: string): string {
  if (from === to) return formatDate(from);
  const a = formatDate(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.slice(0, -5)} to ${formatDate(to)}` : `${a} to ${formatDate(to)}`;
}

const PERIOD_WORDS: Readonly<Record<CollectorPeriod, string>> = Object.freeze({ '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months', custom: 'From' });

/** A list in words: `France`, `France or Italy`, `France, Italy or Spain`. */
export function orWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** A Source choice in words: its channel's name, or its kind's. */
export function sourceWords(value: string, options: Pick<CollectorsOptions, 'channels'> | null): string {
  if (value.startsWith('kind:')) return SOURCE_KIND_LABELS[value.slice(5) as CollectorSourceKind] ?? value.slice(5);
  return options?.channels.find((c) => c.id === value)?.name ?? 'a channel no longer listed';
}

/** A favourite piece's key in words, as the collection names it. */
export function typeWords(key: string, options: Pick<CollectorsOptions, 'types'> | null): string {
  return options?.types.find((x) => x.key === key)?.label ?? key;
}

/**
 * The view in words (§3.6 C.6.2): `Collectors in France or Italy · first came from Instagram · PLATINE · score 40 to 100
 * · favourite piece Rings. Last 30 days, 15 SEP to 14 OCT 2026, compared with 16 AUG to 14 SEP 2026.`
 */
export function viewWords(p: CollectorsParams, options: Pick<CollectorsOptions, 'channels' | 'types'> | null, now: Date): string {
  const who = p.scope === 'active' ? 'Collectors active in the period' : p.scope === 'new' ? 'Collectors new in the period' : 'Collectors';
  const parts: string[] = [p.c.length ? `${who} in ${orWords(p.c.map(countryName))}` : p.scope === 'all' && filterCount(p) === 0 ? 'All collectors' : who];
  if (p.s.length) parts.push(`first came from ${orWords(p.s.map((x) => sourceWords(x, options)))}`);
  if (p.t.length) parts.push(orWords(p.t.map((x) => TIER_LABELS[x] ?? String(x))));
  if (p.sc) parts.push(`score ${p.sc.min} to ${p.sc.max}`);
  if (p.ft.length) parts.push(`favourite piece ${orWords(p.ft.map((x) => typeWords(x, options)))}`);
  const d = periodDays(p, now);
  const period = p.p === 'custom' ? `From ${rangeWords(d.from, d.to)}` : `${PERIOD_WORDS[p.p]}, ${rangeWords(d.from, d.to)}`;
  const compared = p.cmp ? `, compared with ${rangeWords(d.previous.from, d.previous.to)}` : '';
  return `${parts.join(' · ')}. ${period}${compared}.`;
}

const PARIS_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** When the figures were read, in Paris time: `Read at 14:02`. */
export function readAtWords(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? CONTROLS_COPY.readAt : `${CONTROLS_COPY.readAt} ${PARIS_TIME.format(d)}`;
}

// ── Comparisons ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A change or a percentage counted on fewer collectors has no percentage (GROWTH's minimum group). */
export const COMPARE_MIN_GROUP = 3;

/** A figure's comparison: the change (`+86 (+7%)`, `new`, `—`) and the previous value under it (`1 118 before`). */
export interface CompareWords {
  change: string;
  before: string | null;
}

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : n < 0 ? `−${formatCount(-n)}` : '0');

/**
 * A count against the previous period's (§3.6 C.6.3): `+86 (+7%)` with `1 118 before`; 'new' when there was none and
 * now some; '—' when both are 0; no percentage when either side is under COMPARE_MIN_GROUP. `points` (a median score):
 * the change in points, never a percentage. Null when there is nothing to compare with.
 */
export function compareWords(now: number | null, before: number | null, o: { points?: boolean } = {}): CompareWords | null {
  if (now === null || before === null) return null;
  if (now === 0 && before === 0) return { change: '—', before: null };
  if (before === 0 && !o.points) return { change: 'new', before: null };
  const d = now - before;
  const pct = o.points || now < COMPARE_MIN_GROUP || before < COMPARE_MIN_GROUP ? null : Math.round((d / before) * 100);
  return { change: pct === null ? signed(d) : `${signed(d)} (${signed(pct)}%)`, before: `${formatCount(before)} before` };
}

/** A stock's comparison with the scope ALL (`compareBy` NEW): `+42 new, 31 before`; '—' when neither period made any. */
export function newWords(now: number, before: number): CompareWords {
  if (now === 0 && before === 0) return { change: '—', before: null };
  return { change: `+${formatCount(now)} new`, before: `${formatCount(before)} before` };
}

/** A bar's comparison, as the panel's `compareBy` says to read it; null without the comparison. */
export function barCompare(compare: { now: number; before: number } | null, by: 'NEW' | 'SCOPE' | null): CompareWords | null {
  if (!compare || !by) return null;
  return by === 'NEW' ? newWords(compare.now, compare.before) : compareWords(compare.now, compare.before);
}

/** A share of the collectors: `42%`; '0%' when there are none. */
export function shareOf(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
}

/** An average or a median withheld under 3 collectors (GROWTH's `maskSmallGroups`). */
export const WITHHELD = 'Fewer than 3 collectors';

// ── The links to the collectors (§3.6 C.6.5) ─────────────────────────────────────────────────────────────────────

/** `1 collector`, `312 collectors`. */
export function collectorsWords(n: number): string {
  return n === 1 ? '1 collector' : `${formatCount(n)} collectors`;
}

/** A figure's `aria-label`: `Open the 312 collectors in France`. */
export function openLabel(n: number, what: string): string {
  return `Open the ${collectorsWords(n)} ${what}`.trim();
}

/** Who reads the page: an AUDITOR's lists name no city, so no city opens a list for one (§3.0 (h)). */
export interface Reader {
  withCities: boolean;
}

/** The slice's dimensions that name a city: never opened by an AUDITOR. */
const CITY_SLICES = new Set(['city', 'conncity']);

/**
 * The address of the collectors behind a figure: the page's query, the slice and what the list carries for its title
 * (`name`, Over time's `figure` and `split`). Null for a figure of 0, a city for an AUDITOR, or an address that would pass
 * the route's 512 characters (the figure is then shown without a link).
 */
export function listHref(p: CollectorsParams, slice: string, n: number, o: { reader?: Reader; name?: string | null; figure?: string; split?: string } = {}): string | null {
  if (n <= 0) return null;
  if (o.reader && !o.reader.withCities && CITY_SLICES.has(slice.slice(0, slice.indexOf(':') < 0 ? slice.length : slice.indexOf(':')))) return null;
  const hash = href('collectorsList', {}, { ...collectorsRouteQuery(p), slice, name: o.name ? o.name.slice(0, 80) : null, figure: o.figure ?? null, split: o.split && o.split !== 'none' ? o.split : null });
  return tooManyChoices(hash) ? null : hash;
}

// ── At a glance (`overview`) ─────────────────────────────────────────────────────────────────────────────────────

/** The six KPIs' labels, in the page's order (§3.6 C.6.3 item 1). */
export const KPI_LABELS = Object.freeze({
  collectors: 'Collectors',
  newCollectors: 'New collectors',
  firstVisits: 'First visits',
  active: 'Active',
  medianScore: 'Median score',
  wishesAdded: 'Wishes added',
});

export const OVERVIEW_COPY = Object.freeze({
  title: 'At a glance',
  became: (n: number) => `${formatCount(n)} became collectors`,
  scored: (n: number) => `of ${collectorsWords(n)} with a score`,
  scoresOf: (day: string) => `Scores of ${formatDate(day)}`,
  by: (n: number) => `by ${collectorsWords(n)}`,
});

// ── Who they are (`who`) ─────────────────────────────────────────────────────────────────────────────────────────

export const AGE_LABELS: Readonly<Record<CollectorAgeSlice, string>> = Object.freeze({
  under18: 'Under 18',
  '18-24': '18–24',
  '25-34': '25–34',
  '35-44': '35–44',
  '45-54': '45–54',
  '55-64': '55–64',
  '65plus': '65 and over',
  none: 'Not given',
});
export const AGE_ORDER: readonly CollectorAgeSlice[] = COLLECTOR_AGE_SLICES;

export const WHO_COPY = Object.freeze({
  title: 'Who they are',
  tabs: Object.freeze({ ages: 'AGES', countries: 'COUNTRIES', cities: 'CITIES' }),
  switch: Object.freeze({ given: 'AS GIVEN', connection: 'FROM THE CONNECTION' }),
  agesNote: (median: number | null) => `Age today, from the date of birth the client entered. Median: ${median === null ? WITHHELD.toLowerCase() : formatCount(median)}.`,
  notGiven: 'Not given',
  unknown: 'Unknown',
  showAll: (n: number) => `Show all ${formatCount(n)}`,
  dbip: 'Cities from the connection: IP geolocation by DB-IP (db-ip.com), approximate.',
  citiesWithheld: 'An AUDITOR does not open the collectors of a city.',
  connection: 'From the connection: each collector’s usual place, the one with the most days.',
});
/** CITIES shows the top 20, then Show all. */
export const WHO_CITIES_SHOWN = 20;

/** A country's row: `FR · France`, or 'Not given', 'Unknown'. */
export function countryRowLabel(key: string): string {
  if (key === 'none') return WHO_COPY.notGiven;
  if (key === 'unknown') return WHO_COPY.unknown;
  return `${key} · ${countryName(key)}`;
}

/** What a who bar's link says after `Open the N collectors`: `aged 25–34`, `in France`, `in Lyon`, `from the connection in Lyon`. */
export function whoWhat(dim: 'age' | 'country' | 'conncountry' | 'city' | 'conncity', key: string, label: string | null): string {
  switch (dim) {
    case 'age':
      return key === 'none' ? 'who gave no date of birth' : `aged ${AGE_LABELS[key as CollectorAgeSlice] ?? key}`;
    case 'country':
      return key === 'none' ? 'who gave no country' : `in ${countryName(key)}`;
    case 'conncountry':
      return key === 'unknown' ? 'from an unknown country' : `connecting from ${countryName(key)}`;
    case 'city':
      return key === 'none' ? 'who gave no city' : `in ${label ?? key}`;
    case 'conncity':
      return key === 'unknown' ? 'from an unknown city' : `connecting from ${label ?? key}`;
  }
}

// ── The panels' states (§3.6 C.6.3) ──────────────────────────────────────────────────────────────────────────────

export const PANEL_COPY = Object.freeze({
  loading: 'Reading the figures',
  failed: 'These figures could not be read just now.',
  tryAgain: 'Try again',
  noMatch: 'No collector matches these filters.',
  nothingYet: (since: string) => `Nothing recorded yet: visits are recorded since ${formatDate(since)}.`,
  nothingBefore: (since: string) => `Nothing recorded before ${formatDate(since)}.`,
  notComparable: (since: string) => `Not comparable: recording started on ${formatDate(since)}.`,
});

/** The panels whose figures need the recording (views, devices, visits): before it, they say since when it runs. */
export function recordingNote(recordingSince: string | null, period: { from: string; to: string }, previous: { from: string } | null): string | null {
  if (!recordingSince) return null;
  const since = parisDay(new Date(recordingSince));
  if (period.to < since) return PANEL_COPY.nothingYet(since);
  if (period.from < since) return PANEL_COPY.nothingBefore(since);
  if (previous && previous.from < since) return PANEL_COPY.notComparable(since);
  return null;
}

/** The currencies a select offers, the chosen one first when it is not. */
export function currencyChoices(currencies: readonly HouseCurrency[]): { value: string; label: string }[] {
  return currencies.map((c) => ({ value: c, label: c }));
}

// ── Where they come from (`origin`, step 9.10) ───────────────────────────────────────────────────────────────────

export const ORIGIN_COPY = Object.freeze({
  title: 'Where they come from',
  tabs: Object.freeze({ sources: 'SOURCES', heard: 'HOW THEY HEARD', links: 'LINKS', campaigns: 'CAMPAIGNS', sites: 'REFERRING SITES', visits: 'FIRST VISITS' }),
  notAnswered: 'Not answered',
  setAside: '(set aside)',
  otherWords: 'Other: opens the words they gave',
  archived: '(archived)',
  noCampaign: '(no campaign)',
  noSource: '(no source)',
  otherSites: 'Other sites',
  noSite: 'None (typed or shared)',
  currency: 'Currency',
  columns: Object.freeze({
    link: 'Link',
    channel: 'Channel',
    first: 'First link',
    last: 'Last link',
    collectors: 'Collectors',
    buyers: 'Buyers',
    revenue: 'Revenue',
    cost: 'Cost',
    campaign: 'Campaign',
    firstVisits: 'First visits',
    bucket: 'Period',
    newCollectors: 'New collectors',
    became: 'Became collectors',
    before: 'Before',
  }),
  linksNote: 'By collectors. Visits, entries and the return on cost are on each link’s page in Links.',
  noLink: 'No link has brought a collector in this view.',
  noCampaignYet: 'No campaign tag in this view.',
  noSiteYet: 'No referring site in this view.',
  noVisit: 'No first visit in this period.',
});

/** FIRST VISITS' line: `12 first visits became collectors (8%).` */
export function becameWords(became: number, visits: number): string {
  return `${formatCount(became)} first ${visits === 1 ? 'visit' : 'visits'} became collectors (${shareOf(became, visits)}).`;
}

/** First and last link (§3.4 A.10.6): `3 of the 12 collectors who signed up in the period came last through another source than their first (25%).` */
export function differWords(f: { collectors: number; differ: number }): string {
  return `${formatCount(f.differ)} of the ${collectorsWords(f.collectors)} who signed up in the period came last through another source than their first (${shareOf(f.differ, f.collectors)}).`;
}

/** A first source's name: its channel, or its kind. */
export function sourceBarLabel(b: { kind: string; channel: { name: string } | null }): string {
  return b.channel ? b.channel.name : (SOURCE_KIND_LABELS[b.kind as CollectorSourceKind] ?? b.kind);
}

/** A bucket of a chart: one day, or its first and last days. */
export function bucketWords(b: { from: string; to: string }): string {
  return rangeWords(b.from, b.to);
}

// ── What they like (`likes`), devices, engagement (step 9.10) ────────────────────────────────────────────────────

/** Devices' words (§3.6 C.6.3 item 5). */
export const DEVICES_COPY = Object.freeze({
  title: 'Devices',
  switch: Object.freeze({ byCollectors: 'BY COLLECTORS', byVisits: 'BY VISITS', allDevices: 'ALL DEVICES' }),
  device: 'DEVICE',
  system: 'SYSTEM',
  openedIn: 'OPENED IN',
  apps: 'INSIDE AN APP',
  browsers: 'BROWSERS',
  byCollectorsNote: 'Each collector once, under the device they used most in the period.',
  byVisitsNote: 'Every visit of these collectors.',
  allDevicesNote: 'Every device seen, anonymous included: only the country filter applies.',
  through: (day: string) => `Figures through ${formatDate(day)}.`,
  nothing: 'No device seen in this period.',
});
export const DEVICE_LABELS: Readonly<Record<string, string>> = Object.freeze({ PHONE: 'Phone', TABLET: 'Tablet', COMPUTER: 'Computer', UNKNOWN: 'Unknown device' });
export const SYSTEM_ORDER = ['IOS', 'IPAD', 'ANDROID', 'MACOS', 'WINDOWS', 'CHROMEOS', 'LINUX', 'OTHER'] as const;
export const SYSTEM_LABELS: Readonly<Record<(typeof SYSTEM_ORDER)[number], string>> = Object.freeze({
  IOS: 'iPhone',
  IPAD: 'iPad',
  ANDROID: 'Android',
  MACOS: 'Mac',
  WINDOWS: 'Windows',
  CHROMEOS: 'ChromeOS',
  LINUX: 'Linux',
  OTHER: 'Other',
});
export const OPENED_LABELS: Readonly<Record<string, string>> = Object.freeze({ BROWSER: 'Browser', IN_APP: 'Inside an app', HOME_SCREEN: 'Home screen' });
export const BROWSER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  SAFARI: 'Safari',
  CHROME: 'Chrome',
  FIREFOX: 'Firefox',
  EDGE: 'Edge',
  SAMSUNG: 'Samsung Internet',
  OPERA: 'Opera',
  WEBVIEW: 'In-app view',
  OTHER: 'Other',
});

/** Engagement's words (§3.6 C.6.3 item 6). */
export const ENGAGEMENT_PANEL_COPY = Object.freeze({
  title: 'Engagement',
  spread: 'SCORE SPREAD',
  parts: 'THE FIVE PARTS',
  status: 'ACTIVE AND DORMANT',
  cohorts: 'MONTHLY COHORTS',
  notMeasured: 'Not measured',
  spreadNote: (median: number | null) => `Median ${median === null ? WITHHELD.toLowerCase() : formatCount(median)} · Each morning’s score; the five parts below are averages.`,
  previousMonth: (month: string) => `Pale: the scores kept at the end of ${monthWords(month)}.`,
  statusLabels: Object.freeze({ active: 'Active', dormant: 'Dormant', never: 'Never active since sign-up' } as Record<string, string>),
  statusNote: (asOf: string) => `As of ${formatDate(asOf)}: active means an act in the 90 days before.`,
  month: 'Month of sign-up',
  collectors: 'Collectors',
  after: (k: number) => (k === 1 ? 'Active after 1 month' : `${k} months`),
  notYet: '—',
  noScore: 'No collector of this view has a score yet.',
});

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-03` or `2026-03-01` → `March 2026`. */
export function monthWords(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

/** A part's average: `12.4 / 25`, or withheld. */
export function partWords(average: number | null, max: number): string {
  return average === null ? WITHHELD : `${average.toFixed(1)} / ${max}`;
}

/** A cohort cell: `42% · 5`, '—' while the mark is not reached. */
export function cohortWords(m: { active: number | null; share: number | null }): string {
  return m.active === null || m.share === null ? ENGAGEMENT_PANEL_COPY.notYet : `${formatCount(m.share)}% · ${formatCount(m.active)}`;
}

// ── Over time (`trends`, step 9.10) ──────────────────────────────────────────────────────────────────────────────

export const TRENDS_COPY = Object.freeze({
  title: 'Over time',
  figure: 'Figure',
  split: 'Split by',
  previous: 'The previous period',
  total: 'All',
  other: 'Other',
  visitor: 'No collector',
  unknownDevice: 'No view recorded',
  bucket: 'Period',
  noPoint: 'Nothing to draw in this period.',
});
export const TREND_FIGURE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  collectors: 'Collectors',
  new: 'New collectors',
  firstvisits: 'First visits',
  active: 'Active collectors',
  medianscore: 'Median score',
  wishes: 'Wishes added',
  views: 'Views of models',
  buyers: 'Buyers',
});
export const TREND_SPLIT_LABELS: Readonly<Record<string, string>> = Object.freeze({ none: 'Nothing', country: 'Country', source: 'Source', tier: 'Tier', age: 'Age', device: 'Device' });

/** A split's group in words: a country, a first source, a tier, an age band, a device; Other; No collector. */
export function groupWords(split: string, group: string, options: Pick<CollectorsOptions, 'channels'> | null): string {
  if (group === 'other') return TRENDS_COPY.other;
  if (group === 'visitor') return TRENDS_COPY.visitor;
  switch (split) {
    case 'country':
      return countryRowLabel(group);
    case 'source':
      return sourceWords(group.startsWith('channel:') ? group.slice(8) : group, options);
    case 'tier':
      return TIER_LABELS[Number(group)] ?? group;
    case 'age':
      return AGE_LABELS[group as CollectorAgeSlice] ?? group;
    case 'device':
      return group === 'unknown' ? TRENDS_COPY.unknownDevice : (DEVICE_LABELS[group] ?? group);
    default:
      return TRENDS_COPY.total;
  }
}

/** A trend point's slice: `bucket:trend:<figure>:[prev:]<key>[:<group>]` (a group never on the previous line). */
export function trendSlice(figure: string, key: string, o: { previous?: boolean; group?: string | null } = {}): string {
  const group = o.previous || !o.group || o.group === 'all' ? '' : `:${o.group}`;
  return `bucket:trend:${figure}:${o.previous ? 'prev:' : ''}${key}${group}`;
}
