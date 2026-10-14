/**
 * The Collectors page's scope (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6.2, C.6.4, C.6.8, C.9; step 9.1): the
 * period, the previous period, the activity in a period, the age bands, the page's five filters and its three scopes,
 * and `scopeCte`, the one CTE every panel of CollectorInsightsService reads its collectors from.
 *
 *   parisPeriod     LAST 7 DAYS, LAST 30 DAYS, LAST 90 DAYS: today and the N − 1 Paris days before, up to now; LAST 12
 *                   MONTHS: today and the 364 days before; CUSTOM: two Paris days from 1 Jan 2026 to today, `from` not
 *                   after `to`, at most CUSTOM_MAX_DAYS apart (400 'Choose dates from 1 Jan 2026 to today, at most two
 *                   years apart.'). Rolling days, not calendar months (§5.1 console 14).
 *   previousPeriod  the same number of days, ending the day before the period starts (the comparison).
 *   periodBuckets   the period cut by day up to 31 days, by ISO week (Monday to Sunday) up to 120 days, by month beyond,
 *                   the first and last buckets cut to the period (the FIRST VISITS chart, and the trends of step 9.7).
 *   activeIn        the account was active in a period: a sign-in (`account.login` in the audit log, on
 *                   audit_logs_account_login_idx), a scan, a view, a draw entry, a LIVE entry or an order (§3.6 C.6.8).
 *   ageBand         the age band today of a date of birth ('Not given': `none`), by profile-rules' ageOn and ageBand;
 *                   `ageBandSql` gives the same band in SQL from the bounds latestBirthDateForAge computes here.
 *   parseFilters    the page's five filters from the route's query (`c`, `s`, `t`, `sc`, `ft`), checked and in one
 *                   order (`filtersKey`), so two views that read the same collectors share the panels' cache.
 *   scopeCte        `<name> AS (…)`: the counted collectors (population.ts `countedCollector`: no test entrant, no team
 *                   account, no DELETED account) the five filters keep and the scope selects, one row each with its
 *                   creation, its country, its tier now and its score now. The tier comes from one grouped pass over
 *                   the pieces held now (`ownership` ⋈ `products`, CLUB_EXCLUDED_STATUSES left out), never a per-row
 *                   subquery, by CLUB_TIER_THRESHOLDS as club.ts counts them; the score from `account_scores`.
 *
 * The filters (§3.6 C.6.2): Country is the account's country; Source is where the collector first came from
 * (acquisition-filters.ts `sourceFilter`: its first source's link channel, else its kind, question 18); Tier the tier
 * held now (0 for NO TIER); Score the engagement score now (an account with none is outside every range); Favourite
 * piece the collector's FAVOURITE PIECES (`account_tastes` kind PIECE, its keys as `tasteKey` reads them). The scopes:
 * ALL every counted collector now, ACTIVE those active in the period, NEW those whose account was made in it.
 *
 * Every Paris bound is computed here in JavaScript (schedule.ts, through `Intl`) and passed to SQL as a timestamptz or a
 * date, so PostgreSQL and PGlite agree whatever time-zone data they carry (§3.0 (e)). Nothing here reads or writes the
 * database by itself: the service runs what these build.
 */
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { ageBand as bandOfAge, ageOn, AGE_BANDS, latestBirthDateForAge, tasteKey, type AgeBand } from '../../shared/profile-rules.js';
import { validationError } from '../errors.js';
import { sourceFilter } from './acquisition-filters.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_THRESHOLDS } from './club.js';
import { countedCollector } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The page's periods (§3.6 C.6.2, `p`). */
export const PERIOD_KEYS = ['7d', '30d', '90d', '12m', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
/** The rolling periods' lengths in Paris days, today included. */
export const PERIOD_DAYS: Readonly<Record<Exclude<PeriodKey, 'custom'>, number>> = Object.freeze({ '7d': 7, '30d': 30, '90d': 90, '12m': 365 });
/** The period by default. */
export const DEFAULT_PERIOD: PeriodKey = '30d';
/** A CUSTOM period's first day at the earliest, and its days apart (`to` − `from`) at most. */
export const CUSTOM_FIRST_DAY = '2026-01-01';
export const CUSTOM_MAX_DAYS = 731;
export const CUSTOM_PROBLEM = 'Choose dates from 1 Jan 2026 to today, at most two years apart.';

/** The page's scopes (§3.6 C.6.2, `scope`). */
export const SCOPES = ['all', 'active', 'new'] as const;
export type Scope = (typeof SCOPES)[number];

/** The buckets of a chart over the period: by day up to 31 days, by week up to 120 days, by month beyond (§3.6 C.6.3). */
export const BUCKET_DAY_MAX = 31;
export const BUCKET_WEEK_MAX = 120;
export type BucketUnit = 'day' | 'week' | 'month';

/** The age slices in the page's order: the bands, then 'Not given' (§3.6 C.6.3 AGES, C.6.5 `age`). */
export const AGE_SLICES = [...AGE_BANDS, 'none'] as const;
export type AgeSlice = (typeof AGE_SLICES)[number];

/** The kinds the Source filter offers after the link channels (§3.6 C.6.2): Campaign tags, Referring sites, Direct, Before tracking; and Console device, the first source of a sign-up on a console's browser. */
export const SOURCE_FILTER_KINDS = ['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'] as const;
export type SourceFilterKind = (typeof SOURCE_FILTER_KINDS)[number];
/** The tiers the Tier filter offers: 0 NO TIER, 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
export const TIER_CHOICES = [0, 1, 2, 3] as const;
/** The choices one filter names at most (the route's hash is 512 characters anyway, router.ts MAX_HASH). */
export const FILTER_ITEMS_MAX = 50;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Paris days ─────────────────────────────────────────────────────────────────────────────────────────────────

function validDay(day: string): boolean {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The calendar day `n` days after (before, when negative) `day`, both 'YYYY-MM-DD'. */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (0 for the same day). */
export function daysApart(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ── Periods ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A period of whole Paris days, `from` to `to` included, and its instants (`end` exclusive: the next day's start). */
export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  days: number;
  start: Date;
  end: Date;
}

function periodOf(key: PeriodKey, from: string, to: string): Period {
  return { key, from, to, days: daysApart(from, to) + 1, start: parisDayStart(from), end: parisDayStart(plusDays(to, 1)) };
}

/**
 * The period of the page's controls at `now` (see the file header). `p` defaults to LAST 30 DAYS; `from` and `to` are
 * read for CUSTOM only. 400 VALIDATION_FAILED for another period, or CUSTOM_PROBLEM for custom dates out of bounds.
 */
export function parisPeriod(q: { p?: string | null; from?: string | null; to?: string | null }, now: Date): Period {
  const key = (q.p ?? DEFAULT_PERIOD) as PeriodKey;
  if (!PERIOD_KEYS.includes(key)) throw validationError(`p: ${PERIOD_KEYS.join(', ')}.`);
  const today = parisDay(now);
  if (key !== 'custom') return periodOf(key, plusDays(today, -(PERIOD_DAYS[key] - 1)), today);
  const from = q.from ?? '';
  const to = q.to ?? '';
  if (!validDay(from) || !validDay(to) || from < CUSTOM_FIRST_DAY || to > today || from > to || daysApart(from, to) > CUSTOM_MAX_DAYS) throw validationError(CUSTOM_PROBLEM);
  return periodOf('custom', from, to);
}

/** The previous period: the same number of days, ending the day before the period starts (§3.6 C.6.2). */
export function previousPeriod(p: Period): Period {
  const to = plusDays(p.from, -1);
  return periodOf(p.key, plusDays(to, -(p.days - 1)), to);
}

/** A chart's bucket: its key (`2026-09-14`, `2026-W37`, `2026-09`), its first and last Paris days, its instants. */
export interface Bucket {
  key: string;
  from: string;
  to: string;
  start: Date;
  end: Date;
}

/** The ISO week of a calendar day, `YYYY-Www` (the week's Thursday decides its year). */
export function isoWeek(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const weekday = (t.getUTCDay() + 6) % 7; // Monday 0
  t.setUTCDate(t.getUTCDate() - weekday + 3); // that week's Thursday
  const year = t.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The unit a period's chart is cut by. */
export function bucketUnit(p: Pick<Period, 'days'>): BucketUnit {
  return p.days <= BUCKET_DAY_MAX ? 'day' : p.days <= BUCKET_WEEK_MAX ? 'week' : 'month';
}

/** The period's buckets in order, by its unit; each Paris day of the period in exactly one. */
export function periodBuckets(p: Pick<Period, 'from' | 'to' | 'days'>): Bucket[] {
  const unit = bucketUnit(p);
  const keyOf = (day: string) => (unit === 'day' ? day : unit === 'week' ? isoWeek(day) : day.slice(0, 7));
  const out: Bucket[] = [];
  for (let day = p.from; day <= p.to; day = plusDays(day, 1)) {
    const key = keyOf(day);
    const last = out[out.length - 1];
    if (last && last.key === key) last.to = day;
    else out.push({ key, from: day, to: day, start: parisDayStart(day), end: parisDayStart(plusDays(day, 1)) });
  }
  for (const b of out) b.end = parisDayStart(plusDays(b.to, 1));
  return out;
}

/** The bucket of `buckets` a Paris day falls in, or null outside them. */
export function bucketOf(buckets: readonly Bucket[], day: string): Bucket | null {
  for (const b of buckets) if (day >= b.from && day <= b.to) return b;
  return null;
}

// ── Activity ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The account in `column` was active in [start, end): a sign-in, a scan, a view, a draw entry, a LIVE entry or an order
 * (§3.6 C.6.8). Each part is an EXISTS on the account's own index (audit_logs_account_login_idx, scan_events_account_id_idx,
 * collector_views_account_idx, drop_entries_account_idx, live_entries_account_idx, orders_account_idx).
 */
export function activeIn(column: string, start: Date, end: Date): RawBuilder<SqlBool> {
  const a = sql.ref(column);
  const s = sql`${start}::timestamptz`;
  const e = sql`${end}::timestamptz`;
  return sql<SqlBool>`(
    EXISTS (SELECT 1 FROM audit_logs ail WHERE ail.action = 'account.login' AND ail.target_id = ${a}::text AND ail.occurred_at >= ${s} AND ail.occurred_at < ${e})
    OR EXISTS (SELECT 1 FROM scan_events ais WHERE ais.account_id = ${a} AND ais.occurred_at >= ${s} AND ais.occurred_at < ${e})
    OR EXISTS (SELECT 1 FROM collector_views aiv WHERE aiv.account_id = ${a} AND aiv.at >= ${s} AND aiv.at < ${e})
    OR EXISTS (SELECT 1 FROM drop_entries aid WHERE aid.account_id = ${a} AND aid.created_at >= ${s} AND aid.created_at < ${e})
    OR EXISTS (SELECT 1 FROM live_entries aie WHERE aie.account_id = ${a} AND aie.joined_at >= ${s} AND aie.joined_at < ${e})
    OR EXISTS (SELECT 1 FROM orders aio WHERE aio.account_id = ${a} AND aio.reserved_at >= ${s} AND aio.reserved_at < ${e}))`;
}

// ── Ages ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The ages a band starts at, after 'under18' (profile-rules ageBand: 18, 25, 35, 45, 55, 65). */
const BAND_STARTS: readonly [number, AgeBand][] = [
  [18, '18-24'],
  [25, '25-34'],
  [35, '35-44'],
  [45, '45-54'],
  [55, '55-64'],
  [65, '65plus'],
];

/** The age band today (Paris, 'YYYY-MM-DD') of a date of birth, or `none` without one ('Not given'). */
export function ageBand(birthDate: string | null, today: string): AgeSlice {
  if (birthDate === null) return 'none';
  return bandOfAge(ageOn(birthDate, today));
}

/**
 * The same band in SQL from a date of birth column (a `date`): before the latest date of birth of someone 18 today is
 * 'under18', and so on (latestBirthDateForAge follows ageOn, 29 February included); NULL gives `none`.
 */
export function ageBandSql(birthDate: RawBuilder<unknown>, today: string): RawBuilder<string> {
  const steps = [...BAND_STARTS].reverse().map(([age, band]) => sql`WHEN ${birthDate} <= ${latestBirthDateForAge(today, age)}::date THEN ${band}`);
  return sql<string>`(CASE WHEN ${birthDate} IS NULL THEN 'none' ${sql.join(steps, sql` `)} ELSE 'under18' END)`;
}

// ── Filters ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page's five filters, checked, each list sorted and once (§3.6 C.6.2). */
export interface InsightsFilters {
  /** The account's country, ISO codes. */
  countries: string[];
  /** Where they first came from: link channels and kinds. */
  sources: { channelIds: string[]; kinds: SourceFilterKind[] };
  /** The tier held now, 0 to 3. */
  tiers: number[];
  /** The engagement score now, both included. */
  score: { min: number; max: number } | null;
  /** The FAVOURITE PIECES' keys. */
  types: string[];
}

export const NO_FILTERS: InsightsFilters = Object.freeze({ countries: [], sources: { channelIds: [], kinds: [] }, tiers: [], score: null, types: [] }) as InsightsFilters;

const listOf = (raw: string | undefined, what: string): string[] => {
  if (raw === undefined || raw.trim() === '') return [];
  const items = [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => x !== ''))];
  if (items.length > FILTER_ITEMS_MAX) throw validationError(`${what}: at most ${FILTER_ITEMS_MAX}.`);
  return items;
};
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The five filters from the route's query (§3.6 C.6.2): `c=FR,IT`, `s=<channel id>,kind:SITE`, `t=0,2,3`, `sc=40-100`,
 * `ft=RING,CUFF`. 400 VALIDATION_FAILED with the filter named for anything else.
 */
export function parseFilters(raw: { c?: string; s?: string; t?: string; sc?: string; ft?: string }): InsightsFilters {
  const countries = listOf(raw.c, 'c').map((x) => x.toUpperCase());
  if (countries.some((x) => !/^[A-Z]{2}$/.test(x))) throw validationError('c: country codes of two letters, separated by commas.');
  const channelIds: string[] = [];
  const kinds: SourceFilterKind[] = [];
  for (const item of listOf(raw.s, 's')) {
    if (UUID_RE.test(item)) channelIds.push(item.toLowerCase());
    else if (item.startsWith('kind:') && (SOURCE_FILTER_KINDS as readonly string[]).includes(item.slice(5))) kinds.push(item.slice(5) as SourceFilterKind);
    else throw validationError(`s: a channel's id or kind:${SOURCE_FILTER_KINDS.join('|')}, separated by commas.`);
  }
  const tiers = listOf(raw.t, 't').map((x) => (/^[0-3]$/.test(x) ? Number(x) : Number.NaN));
  if (tiers.some((x) => Number.isNaN(x))) throw validationError('t: tiers from 0 to 3, separated by commas.');
  let score: InsightsFilters['score'] = null;
  if (raw.sc !== undefined && raw.sc.trim() !== '') {
    const m = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(raw.sc);
    const [min, max] = m ? [Number(m[1]), Number(m[2])] : [Number.NaN, Number.NaN];
    if (!m || min > 100 || max > 100 || min > max) throw validationError('sc: a score from … to …, two whole numbers from 0 to 100, the first not above the second.');
    score = { min, max };
  }
  const types = listOf(raw.ft, 'ft').map((x) => tasteKey(x));
  if (types.some((x) => x === null)) throw validationError('ft: favourite pieces, separated by commas.');
  return {
    countries: [...new Set(countries)].sort(byCode),
    sources: { channelIds: [...new Set(channelIds)].sort(byCode), kinds: [...new Set(kinds)].sort(byCode) },
    tiers: [...new Set(tiers)].sort((a, b) => a - b),
    score,
    types: [...new Set(types as string[])].sort(byCode),
  };
}

/** One string per set of filters: equal for two queries that select the same collectors (the cache's key). */
export function filtersKey(f: InsightsFilters): string {
  return [
    `c=${f.countries.join(',')}`,
    `s=${[...f.sources.channelIds, ...f.sources.kinds.map((k) => `kind:${k}`)].join(',')}`,
    `t=${f.tiers.join(',')}`,
    `sc=${f.score ? `${f.score.min}-${f.score.max}` : ''}`,
    `ft=${f.types.join(',')}`,
  ].join('&');
}

/** Whether a filter other than the source narrows the collectors (the readings of devices then follow the collectors). */
export function narrowsCollectors(f: InsightsFilters, scope: Scope): boolean {
  return scope !== 'all' || f.countries.length > 0 || f.tiers.length > 0 || f.score !== null || f.types.length > 0;
}

/** Whether any of the five filters is set. */
export function hasFilters(f: InsightsFilters): boolean {
  return narrowsCollectors(f, 'all') || f.sources.channelIds.length > 0 || f.sources.kinds.length > 0;
}

// ── The scope ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The tier of `pieces` held now, by CLUB_TIER_THRESHOLDS (1 TITANE, 5 PLATINE, 10 PALLADIUM), in SQL. */
function tierSql(pieces: RawBuilder<unknown>): RawBuilder<number> {
  const steps = CLUB_TIER_THRESHOLDS.map((t, i) => ({ t, tier: i + 1 }))
    .reverse()
    .map(({ t, tier }) => sql`WHEN ${pieces} >= ${t}::int THEN ${tier}::int`);
  return sql<number>`(CASE ${sql.join(steps, sql` `)} ELSE 0 END)`;
}

/**
 * `<name> AS (…)`: the collectors of the page for `period` (see the file header), one row each:
 * `account_id`, `created_at`, `country`, `tier` (0–3, now), `score` (now, or NULL). `name` is a plain identifier.
 */
export function scopeCte(name: string, q: { filters: InsightsFilters; scope: Scope }, period: Pick<Period, 'start' | 'end'>): RawBuilder<unknown> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new TypeError(`scopeCte: not a plain name: ${name}`);
  const f = q.filters;
  const where: RawBuilder<unknown>[] = [countedCollector('a.id')];
  if (f.countries.length) where.push(sql`a.country IN (${sql.join(f.countries)})`);
  if (f.sources.channelIds.length + f.sources.kinds.length) where.push(sourceFilter('a.id', { channelIds: f.sources.channelIds, kinds: f.sources.kinds }));
  if (f.score) where.push(sql`sc.score BETWEEN ${f.score.min}::int AND ${f.score.max}::int`);
  if (f.types.length) where.push(sql`EXISTS (SELECT 1 FROM account_tastes ft WHERE ft.account_id = a.id AND ft.kind = 'PIECE' AND ft.value_key IN (${sql.join(f.types)}))`);
  if (q.scope === 'new') where.push(sql`a.created_at >= ${period.start}::timestamptz AND a.created_at < ${period.end}::timestamptz`);
  if (q.scope === 'active') where.push(activeIn('a.id', period.start, period.end));
  const outer = f.tiers.length ? sql`WHERE b.tier IN (${sql.join(f.tiers.map((t) => sql`${t}::int`))})` : sql``;
  return sql`${sql.id(name)} AS (
    SELECT b.account_id, b.created_at, b.country, b.tier, b.score FROM (
      SELECT a.id AS account_id, a.created_at, a.country, ${tierSql(sql`coalesce(h.pieces, 0)`)} AS tier, sc.score
        FROM accounts a
        LEFT JOIN (SELECT o.account_id, count(*)::int AS pieces
                     FROM ownership o JOIN products p ON p.id = o.product_id
                    WHERE o.ended_at IS NULL AND p.status NOT IN (${sql.join([...CLUB_EXCLUDED_STATUSES])})
                    GROUP BY o.account_id) h ON h.account_id = a.id
        LEFT JOIN account_scores sc ON sc.account_id = a.id
       WHERE ${sql.join(where, sql` AND `)}) b
    ${outer})`;
}
