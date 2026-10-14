/**
 * The Collectors page (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6, C.9; steps 9.2 and on): CollectorInsightsService
 * (`ctx.services.collectorInsights`) reads the figures of « all the data we have » about the counted collectors, over the
 * period the page chooses, compared with the period before. It only reads: no write, no audit (the export, step 9.12,
 * is its one audited act).
 *
 *   options   GET /api/admin/collectors/options (AUDITOR): the filters' choices (the countries present, the link
 *             channels and the kinds of first source, the tiers, the collection's types), the currencies, and the
 *             earliest dates with data: `recordingSince` (the recording's start, tracking_state) and `snapshotsSince`
 *             (the monthly history's first month, collector_history, null before its back-fill).
 *   report    GET /api/admin/collectors/report?panel=… (AUDITOR): one panel's figures for the period and, with the
 *             comparison on, the previous period, read in one transaction. The panels so far: `overview` (At a glance:
 *             six KPIs), `who` (Who they are: AGES, COUNTRIES and CITIES, each as given and from the connection) and
 *             `origin` (Where they come from: SOURCES, HOW THEY HEARD, LINKS first and last, CAMPAIGNS, REFERRING
 *             SITES, FIRST VISITS; §3.4 A.10.6's block: the first source by kind and channel, the links and campaigns,
 *             the first visits over time, the collectors whose first and last link differ) and `likes` (What they
 *             like: FAVOURITE PIECES, FINISHES, MOST WISHED models and collections, MOST VIEWED by the collectors and by
 *             every visitor, PIECES HELD; read by likes.ts `readLikes`, §3.2 W.8), `devices` (Devices: DEVICE, SYSTEM,
 *             OPENED IN and BROWSERS by collectors, by visits and for all devices; tracking-reads.ts devicesReport, §3.3
 *             T.4.2) and `engagement` (Engagement: SCORE SPREAD with the month the history kept beside it, THE FIVE
 *             PARTS, ACTIVE AND DORMANT as of the period's last day, MONTHLY COHORTS from collector_history) and
 *             `trends` (Over time: one figure by bucket, split by up to six groups and Other, the previous period's line).
 *   list      GET /api/admin/collectors/list (AUDITOR): the collectors behind one figure, its `slice` (§3.6 C.6.5's closed
 *             list, SLICE_DIMENSIONS, each written with the rule of the figure that opens it, so a figure equals its
 *             list's total), 50 a page ordered by email for every slice, never a score, a tag or a mark; the city
 *             withheld for an AUDITOR (the route masks the email). Never cached; read under the same load guard.
 *
 * How a reading runs (§3.6 C.6.4, §5.1 console 25):
 *   - one REPEATABLE READ, READ ONLY transaction per panel, `work_mem` 32 MB (several panels run at once on the shared
 *     box) and `statement_timeout` 8 s; a reading cut by the timeout answers 503 INSIGHTS_TIMEOUT, logged with the panel
 *     and the period, never the filters' values;
 *   - at most INSIGHTS_CONCURRENT readings at once in the process; another waits up to INSIGHTS_WAIT_MS, then answers 503
 *     INSIGHTS_BUSY;
 *   - an in-process cache of the last INSIGHTS_CACHE_SIZE panel results, keyed by the panel and the normalised query,
 *     kept INSIGHTS_CACHE_MS; `fresh` (Read again) reads again unless the cached result is under INSIGHTS_FRESH_MS old. It
 *     holds figures only, never a list or an email, so every role shares it.
 *
 * Who is counted: the collectors of insights-scope.ts `scopeCte` (population.ts `countedCollector`: no test entrant, no
 * team account, no DELETED account; LOCKED ones counted), the five filters and the scope applied. Event figures count
 * events of the period (first visits, wishes added); the scope narrows whose. The comparison of a bar (`compare`):
 * with the scope ALL, a stock has no earlier value, so it is « new in the period » against « new in the previous
 * period » (`compareBy` NEW); with ACTIVE or NEW, the same bar over the previous period's collectors (`compareBy` SCOPE).
 * Counts are always given; an average or a median of fewer than INSIGHTS_MIN_GROUP collectors is withheld (null), as
 * GROWTH withholds its amounts (`GROWTH_MIN_GROUP`).
 */
import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../db/connection.js';
import { DEVICE_KINDS, DEVICE_SYSTEMS, HOUSE_CURRENCIES, IN_APPS, OPENED_IN, VIEW_PAGE_CODES, type HouseCurrency, type SourceKind } from '../db/schema.js';
import { DomainError, validationError } from '../errors.js';
import { ageOn } from '../../shared/profile-rules.js';
import { fold } from '../../shared/fold.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { AcquisitionReportService } from './acquisition-report.js';
import { CLUB_EXCLUDED_STATUSES } from './club.js';
import { plusMonths } from './collector-history.js';
import { band, ENGAGEMENT_PARTS, PART_MAX, type EngagementPart } from './engagement-formula.js';
import { currenciesOf, GROWTH_MIN_GROUP, median } from './growth.js';
import {
  AGE_SLICES,
  ageBandSql,
  activeIn,
  bucketUnit,
  filtersKey,
  hasFilters,
  narrowsCollectors,
  parseFilters,
  parisPeriod,
  periodBuckets,
  plusDays,
  previousPeriod,
  scopeCte,
  SCOPES,
  SOURCE_FILTER_KINDS,
  TIER_CHOICES,
  type Bucket,
  type BucketUnit,
  type InsightsFilters,
  type Period,
  type Scope,
} from './insights-scope.js';
import { readLikes, type LikesFigures } from './likes.js';
import type { LinkService } from './links.js';
import { countedCollector } from './population.js';
import { parisDay, parisDayStart, parisMonthStart } from './schedule.js';
import { tasteOptions } from './tastes.js';
import { viewHistoryCutoff } from './tracking.js';
import { devicesReport, mainDeviceRows, type DevicesBy, type DevicesFigures, type ViewFilters } from './tracking-reads.js';

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The panels the page reads, top to bottom (§3.6 C.6.3); the others come with their steps. */
export const COLLECTOR_PANELS = ['overview', 'who', 'origin', 'likes', 'devices', 'engagement', 'trends'] as const;
export type CollectorPanel = (typeof COLLECTOR_PANELS)[number];

/** The cache: results kept, for how long, and the age under which Read again keeps the cached one. */
export const INSIGHTS_CACHE_SIZE = 50;
export const INSIGHTS_CACHE_MS = 5 * 60_000;
export const INSIGHTS_FRESH_MS = 30_000;
/** The load guard: readings at once, and how long another waits for its turn. */
export const INSIGHTS_CONCURRENT = 2;
export const INSIGHTS_WAIT_MS = 10_000;
/** A reading's `statement_timeout`, and its `work_mem`. */
export const INSIGHTS_TIMEOUT_MS = 8_000;
export const INSIGHTS_WORK_MEM = '32MB';
/** An average or a median of fewer collectors is withheld (GROWTH's minimum group). */
export const INSIGHTS_MIN_GROUP = GROWTH_MIN_GROUP;
/** Who they are, CITIES: the groups given at most (the page shows the top 20, then Show all). */
export const WHO_CITIES_MAX = 500;
/** Devices, BROWSERS: the browsers given (§3.6 C.6.3 item 5: the top 6). */
export const DEVICE_BROWSERS_TOP = 6;
/** Engagement, ACTIVE AND DORMANT: active with an act in the Paris days before the period's end, its last day included. */
export const ENGAGEMENT_ACTIVE_DAYS = 90;
/** Engagement, MONTHLY COHORTS: the months of sign-up shown (the latest first), and the marks after them, in months. */
export const COHORT_MONTHS = 12;
export const COHORT_MARKS = [1, 3, 6, 12] as const;
/** Engagement, SCORE SPREAD: the ten bands of ten, then the collectors with no score (`none`, Not measured). */
export const SCORE_SLICES = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'] as const;
/** Engagement, ACTIVE AND DORMANT, in the page's order. */
export const ENGAGEMENT_STATUSES = ['active', 'dormant', 'never'] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];
/** Over time (§3.6 C.6.3 item 7): the select Figure, in the page's order (`figure`), the first by default. */
export const TREND_FIGURES = ['collectors', 'new', 'firstvisits', 'active', 'medianscore', 'wishes', 'views', 'buyers'] as const;
export type TrendFigure = (typeof TREND_FIGURES)[number];
/** Over time: the select Split by (`split`), Nothing by default. */
export const TREND_SPLITS = ['none', 'country', 'source', 'tier', 'age', 'device'] as const;
export type TrendSplit = (typeof TREND_SPLITS)[number];
/** Over time: the groups drawn at most; the others are summed as `other`. */
export const TREND_GROUPS_MAX = 6;

export const insightsBusy = (): DomainError => new DomainError('INSIGHTS_BUSY', 503, 'The figures are being read for someone else. Try again in a moment.');
export const insightsTimeout = (): DomainError =>
  new DomainError('INSIGHTS_TIMEOUT', 503, 'These figures took too long to read. Choose a shorter period or fewer filters, then try again.');

/** PostgreSQL's query_canceled: what `statement_timeout` raises. */
const QUERY_CANCELED = '57014';

// ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the route sends (the page's query, §3.6 C.6.2): strings as the query holds them, checked here. */
export interface InsightsRequest {
  panel: string;
  p?: string;
  from?: string;
  to?: string;
  /** Compare with the previous period (on by default). */
  cmp?: boolean;
  scope?: string;
  c?: string;
  s?: string;
  t?: string;
  sc?: string;
  ft?: string;
  currency?: string;
  /** Over time: the figure and the split (the panel `trends` only reads them). */
  figure?: string;
  split?: string;
  /** Read again: bypass the cache unless its result is under INSIGHTS_FRESH_MS old. */
  fresh?: boolean;
}

/** The request checked and normalised. */
export interface InsightsQuery {
  panel: CollectorPanel;
  period: Period;
  /** The previous period, when the comparison is on. */
  previous: Period | null;
  scope: Scope;
  filters: InsightsFilters;
  currency: HouseCurrency | null;
  /** Over time's figure and split. */
  trend: { figure: TrendFigure; split: TrendSplit };
}

/** A bar: its key, its collectors, and its comparison (see the file header), null when the comparison is off. */
export interface BarRow {
  key: string;
  collectors: number;
  compare: { now: number; before: number } | null;
}

/** A KPI: its value now and in the previous period (null: off, or not comparable). */
export interface Kpi {
  value: number | null;
  previous: number | null;
}

export interface OverviewFigures {
  /** The collectors in scope; before: the scope's at the previous period's end (ALL: those whose account existed then). */
  collectors: Kpi;
  newCollectors: Kpi;
  /** Devices first seen in the period; `becameCollectors`: collectors whose first visit fell in it (its list). */
  firstVisits: Kpi & { becameCollectors: number };
  active: Kpi;
  /**
   * The median of the scores now, withheld under INSIGHTS_MIN_GROUP; the previous value is the median of the scores the
   * monthly history kept for the month that ended by the previous period's end (null while the history does not hold it).
   */
  medianScore: Kpi & { scored: number; scoresOn: string | null };
  /** Wishes added in the period, and by how many collectors. */
  wishesAdded: Kpi & { collectors: number; previousCollectors: number | null };
}

export interface CityRow extends BarRow {
  /** As given: the form most often typed; from the connection: the GeoIP city. Null for 'none' and 'unknown'. */
  label: string | null;
  /** From the connection: the place's country. */
  country: string | null;
}

export interface WhoFigures {
  total: number;
  /** AGE_SLICES in order, 'none' last; the median age withheld under INSIGHTS_MIN_GROUP. */
  ages: { rows: BarRow[]; median: number | null };
  /** As given (`none`: not given) and from the connection (`unknown`), the most collectors first, those last. */
  countries: { given: BarRow[]; connection: BarRow[] };
  /** Grouped ignoring case and accents (as given) or by GeoIP place; `groups` before the cut at WHO_CITIES_MAX. */
  cities: { given: { rows: CityRow[]; groups: number }; connection: { rows: CityRow[]; groups: number } };
}

export interface ReportHead {
  panel: CollectorPanel;
  /** When the figures were read (the cached result's time when it came from the cache). */
  readAt: Date;
  period: { key: Period['key']; from: string; to: string; days: number };
  previous: { from: string; to: string } | null;
  scope: Scope;
  /** How the bars compare: NEW with the scope ALL, SCOPE otherwise; null without the comparison. */
  compareBy: 'NEW' | 'SCOPE' | null;
  /** The recording's start (tracking_state): before it, the figures that need tracking have nothing. */
  recordingSince: Date | null;
}

export type CollectorsReport =
  | (ReportHead & { panel: 'overview'; figures: OverviewFigures })
  | (ReportHead & { panel: 'who'; figures: WhoFigures })
  | (ReportHead & { panel: 'origin'; figures: OriginFigures })
  | (ReportHead & { panel: 'likes'; figures: LikesFigures })
  | (ReportHead & { panel: 'devices'; figures: DevicesPanelFigures })
  | (ReportHead & { panel: 'engagement'; figures: EngagementFigures })
  | (ReportHead & { panel: 'trends'; figures: TrendsFigures });

export interface CollectorsOptions {
  /** The accounts' countries among the counted collectors. */
  countries: string[];
  /** The link channels in their order, then the kinds of first source the Source filter offers. */
  channels: { id: string; name: string }[];
  sourceKinds: readonly (typeof SOURCE_FILTER_KINDS)[number][];
  tiers: readonly number[];
  /** The collection's types (FAVOURITE PIECES' choices). */
  types: { key: string; label: string }[];
  currencies: HouseCurrency[];
  currency: HouseCurrency;
  recordingSince: Date | null;
  /** The monthly history's first month, `YYYY-MM-01` (collector_history); null before the first back-fill. */
  snapshotsSince: string | null;
}

/** What a panel's reading is given. */
export interface Reading {
  q: InsightsQuery;
  now: Date;
  /** Today's Paris day. */
  today: string;
  links: Pick<LinkService, 'list' | 'get' | 'channels'>;
}

export type PanelReader = (tx: Db, x: Reading) => Promise<unknown>;

export interface CollectorInsightsServiceDeps {
  db: Db;
  links: Pick<LinkService, 'list' | 'get' | 'channels'>;
  clock?: Clock;
  log?: Logger;
  /** The guard's and cache's bounds (tests). */
  limits?: Partial<{ concurrent: number; waitMs: number; timeoutMs: number; cacheSize: number; cacheMs: number; freshMs: number }>;
  /** A panel's reading replaced (tests: a slow or a cut reading). */
  panels?: Partial<Record<CollectorPanel, PanelReader>>;
}

// ── The load guard ─────────────────────────────────────────────────────────────────────────────────────────────

/** At most `max` readings at once; another waits up to `waitMs` for a turn, then 503 INSIGHTS_BUSY. */
export class ReadingGate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly max: number,
    private readonly waitMs: number,
  ) {}

  /** The readings running now. */
  get active(): number {
    return this.running;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running < this.max) this.running += 1;
    else await this.turn();
    try {
      return await fn();
    } finally {
      // The slot passes to the next one waiting, or is given back.
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  private turn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const go = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(go);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(insightsBusy());
      }, this.waitMs);
      this.waiting.push(go);
    });
  }
}

// ── The service ────────────────────────────────────────────────────────────────────────────────────────────────

export class CollectorInsightsService {
  private readonly db: Db;
  private readonly links: Pick<LinkService, 'list' | 'get' | 'channels'>;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly gate: ReadingGate;
  private readonly timeoutMs: number;
  private readonly cacheSize: number;
  private readonly cacheMs: number;
  private readonly freshMs: number;
  private readonly cache = new Map<string, { at: number; value: CollectorsReport }>();
  private readonly panels: Record<CollectorPanel, PanelReader>;

  constructor(deps: CollectorInsightsServiceDeps) {
    this.db = deps.db;
    this.links = deps.links;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    const l = deps.limits ?? {};
    this.gate = new ReadingGate(l.concurrent ?? INSIGHTS_CONCURRENT, l.waitMs ?? INSIGHTS_WAIT_MS);
    this.timeoutMs = l.timeoutMs ?? INSIGHTS_TIMEOUT_MS;
    this.cacheSize = l.cacheSize ?? INSIGHTS_CACHE_SIZE;
    this.cacheMs = l.cacheMs ?? INSIGHTS_CACHE_MS;
    this.freshMs = l.freshMs ?? INSIGHTS_FRESH_MS;
    this.panels = { overview: overviewPanel, who: whoPanel, origin: originPanel, likes: likesPanel, devices: devicesPanel, engagement: engagementPanel, trends: trendsPanel, ...deps.panels };
  }

  /** The filters' choices and the earliest dates with data (see the file header). */
  async options(): Promise<CollectorsOptions> {
    return this.readOnly(async (tx) => {
      const countries = await sql<{ country: string }>`
        SELECT DISTINCT a.country FROM accounts a WHERE a.country IS NOT NULL AND ${countedCollector('a.id')} ORDER BY a.country`.execute(tx);
      const channels = await this.links.channels(tx);
      const types = await tasteOptions(tx);
      const { currency, currencies } = await currenciesOf(tx, undefined);
      return {
        countries: countries.rows.map((r) => r.country.trim()),
        channels: channels.map((c) => ({ id: c.id, name: c.name })),
        sourceKinds: SOURCE_FILTER_KINDS,
        tiers: TIER_CHOICES,
        types: types.pieces.map((p) => ({ key: p.key, label: p.label })),
        currencies,
        currency,
        recordingSince: await recordingSince(tx),
        snapshotsSince: (await sql<{ m: string | null }>`SELECT min(first_month)::text AS m FROM collector_history`.execute(tx)).rows[0]?.m ?? null,
      };
    });
  }

  /** The request checked and normalised at `now` (400 VALIDATION_FAILED otherwise). */
  query(req: InsightsRequest, now: Date = this.clock()): InsightsQuery {
    const panel = req.panel as CollectorPanel;
    if (!COLLECTOR_PANELS.includes(panel)) throw validationError(`panel: ${COLLECTOR_PANELS.join(', ')}.`);
    const scope = (req.scope ?? 'all') as Scope;
    if (!SCOPES.includes(scope)) throw validationError(`scope: ${SCOPES.join(', ')}.`);
    const currency = req.currency ?? null;
    if (currency !== null && !(HOUSE_CURRENCIES as readonly string[]).includes(currency)) throw validationError(`currency: ${HOUSE_CURRENCIES.join(', ')}.`);
    const period = parisPeriod({ p: req.p, from: req.from, to: req.to }, now);
    const figure = (req.figure ?? TREND_FIGURES[0]) as TrendFigure;
    if (!TREND_FIGURES.includes(figure)) throw validationError(`figure: ${TREND_FIGURES.join(', ')}.`);
    const split = (req.split ?? 'none') as TrendSplit;
    if (!TREND_SPLITS.includes(split)) throw validationError(`split: ${TREND_SPLITS.join(', ')}.`);
    return {
      panel,
      period,
      previous: req.cmp === false ? null : previousPeriod(period),
      scope,
      filters: parseFilters({ c: req.c, s: req.s, t: req.t, sc: req.sc, ft: req.ft }),
      currency: currency as HouseCurrency | null,
      trend: { figure, split },
    };
  }

  /** One panel's figures (see the file header): from the cache, or read under the load guard. */
  async report(req: InsightsRequest): Promise<CollectorsReport> {
    const now = this.clock();
    const q = this.query(req, now);
    const key = cacheKey(q);
    const cached = this.cache.get(key);
    const age = cached ? now.getTime() - cached.at : Number.POSITIVE_INFINITY;
    if (cached && age < this.cacheMs && (!req.fresh || age < this.freshMs)) {
      // Most recently used last: the oldest is the first evicted.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    const value = await this.gate.run(() => this.read(q));
    this.cache.delete(key);
    this.cache.set(key, { at: value.readAt.getTime(), value });
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  /**
   * The collectors behind one figure (§3.6 C.6.5): the page's query with `slice` and `page` (1 by default), a page of
   * COLLECTORS_LIST_PAGE ordered by email, never cached, read under the load guard in one read-only transaction (503
   * INSIGHTS_BUSY or INSIGHTS_TIMEOUT as a panel). `withCities` false (an AUDITOR) withholds every city.
   */
  async list(req: Omit<InsightsRequest, 'panel' | 'fresh'> & { slice: string; page?: number }, opts: { withCities: boolean }): Promise<CollectorsList> {
    const now = this.clock();
    const q = this.query({ ...req, panel: 'overview' }, now);
    const slice = parseSlice(req.slice);
    const page = req.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > COLLECTORS_LIST_PAGES_MAX) throw validationError(`page: a whole number from 1 to ${COLLECTORS_LIST_PAGES_MAX}.`);
    try {
      return await this.gate.run(() =>
        this.readOnly(async (tx) => {
          const r = await readList(tx, { q, now, today: parisDay(now), links: this.links }, slice, page, opts.withCities);
          return {
            slice: req.slice,
            subject: r.subject,
            period: { key: q.period.key, from: q.period.from, to: q.period.to, days: q.period.days },
            previous: q.previous ? { from: q.previous.from, to: q.previous.to } : null,
            scope: q.scope,
            readAt: now,
            total: r.total,
            page,
            pageSize: COLLECTORS_LIST_PAGE,
            rows: r.rows,
          };
        }),
      );
    } catch (e) {
      if ((e as { code?: unknown })?.code === QUERY_CANCELED) {
        // The slice's dimension and the period only: a value may name a person's choices.
        this.log.warn({ list: slice.dim, from: q.period.from, to: q.period.to, scope: q.scope }, 'collectors list took too long to read');
        throw insightsTimeout();
      }
      throw e;
    }
  }

  /** Forget every cached result. */
  clearCache(): void {
    this.cache.clear();
  }

  private async read(q: InsightsQuery): Promise<CollectorsReport> {
    const now = this.clock();
    const reader = this.panels[q.panel];
    try {
      return await this.readOnly(async (tx) => {
        const figures = await reader(tx, { q, now, today: parisDay(now), links: this.links });
        const head: ReportHead = {
          panel: q.panel,
          readAt: now,
          period: { key: q.period.key, from: q.period.from, to: q.period.to, days: q.period.days },
          previous: q.previous ? { from: q.previous.from, to: q.previous.to } : null,
          scope: q.scope,
          compareBy: q.previous ? (q.scope === 'all' ? 'NEW' : 'SCOPE') : null,
          recordingSince: await recordingSince(tx),
        };
        return { ...head, figures } as CollectorsReport;
      });
    } catch (e) {
      if ((e as { code?: unknown })?.code === QUERY_CANCELED) {
        // The panel and the period only: the filters' values may name a person's choices.
        this.log.warn({ panel: q.panel, from: q.period.from, to: q.period.to, scope: q.scope }, 'collectors figures took too long to read');
        throw insightsTimeout();
      }
      throw e;
    }
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction with the page's work_mem and statement_timeout. */
  private async readOnly<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      await sql.raw(`SET LOCAL work_mem = '${INSIGHTS_WORK_MEM}'`).execute(tx);
      await sql.raw(`SET LOCAL statement_timeout = '${Math.max(1, Math.floor(this.timeoutMs))}ms'`).execute(tx);
      return fn(tx);
    });
  }
}

/** The cache's key: the panel and the normalised query (equal for two requests that read the same figures). */
export function cacheKey(q: InsightsQuery): string {
  const trend = q.panel === 'trends' ? `${q.trend.figure}/${q.trend.split}` : '';
  return [q.panel, q.period.key, q.period.from, q.period.to, q.previous ? 'cmp' : 'nocmp', q.scope, filtersKey(q.filters), q.currency ?? '', trend].join('|');
}

async function recordingSince(tx: Db): Promise<Date | null> {
  const row = await tx.selectFrom('tracking_state').select('started_at').where('id', '=', 1).executeTakeFirst();
  return row?.started_at ?? null;
}

// ── Shared readings ────────────────────────────────────────────────────────────────────────────────────────────

export const within = (column: RawBuilder<unknown>, p: Pick<Period, 'start' | 'end'>) => sql`${column} >= ${p.start}::timestamptz AND ${column} < ${p.end}::timestamptz`;

/** Counts of `rows`' keys: per dimension, per key, the collectors, and those made in the period and the previous one. */
type Counts = Map<string, Map<string, { n: number; now: number; before: number }>>;

/**
 * For each dimension of `keyed` (rows `created_at`, `dim`, `key` read from the CTE it is given), each key's collectors
 * and its comparison (the file header): one statement over `col`, and over `colp` (the previous period's collectors)
 * for the scopes ACTIVE and NEW.
 */
export async function countBy(tx: Db, x: Reading, keyed: (cte: string) => RawBuilder<unknown>): Promise<{ counts: Counts; total: number }> {
  const { q } = x;
  const P = q.period;
  const B = q.previous;
  const withPrevious = B !== null && q.scope !== 'all';
  const rows = await sql<{ w: string; dim: string; key: string | null; n: number; fresh_now: number; fresh_before: number }>`
    WITH ${scopeCte('col', q, P)}${withPrevious ? sql`, ${scopeCte('colp', q, B!)}` : sql``}
    SELECT 'c' AS w, k.dim, k.key, count(*)::int AS n,
           count(*) FILTER (WHERE ${within(sql`k.created_at`, P)})::int AS fresh_now,
           ${B ? sql`count(*) FILTER (WHERE ${within(sql`k.created_at`, B)})::int` : sql`0`} AS fresh_before
      FROM (${keyed('col')}) k GROUP BY k.dim, k.key
    ${withPrevious ? sql`UNION ALL SELECT 'p', k.dim, k.key, count(*)::int, 0, 0 FROM (${keyed('colp')}) k GROUP BY k.dim, k.key` : sql``}
    UNION ALL SELECT 't', '', NULL, count(*)::int, 0, 0 FROM col`.execute(tx);
  const counts: Counts = new Map();
  let total = 0;
  for (const r of rows.rows) {
    if (r.w === 't') {
      total = Number(r.n);
      continue;
    }
    const dim = counts.get(r.dim) ?? new Map<string, { n: number; now: number; before: number }>();
    counts.set(r.dim, dim);
    const key = r.key ?? '';
    const e = dim.get(key) ?? { n: 0, now: 0, before: 0 };
    if (r.w === 'c') {
      e.n = Number(r.n);
      if (q.scope === 'all') {
        e.now = Number(r.fresh_now);
        e.before = Number(r.fresh_before);
      } else e.now = Number(r.n);
    } else e.before = Number(r.n);
    dim.set(key, e);
  }
  return { counts, total };
}

/** A dimension's counts as bars, in `order` when given (missing keys as 0), else the most collectors first; `last` keys at the end. */
export function barsOf(x: Reading, counts: Counts, dim: string, opts: { order?: readonly string[]; last?: readonly string[] } = {}): BarRow[] {
  const m = counts.get(dim) ?? new Map<string, { n: number; now: number; before: number }>();
  const row = (key: string): BarRow => {
    const e = m.get(key) ?? { n: 0, now: 0, before: 0 };
    return { key, collectors: e.n, compare: x.q.previous ? { now: e.now, before: e.before } : null };
  };
  if (opts.order) return opts.order.map(row);
  const last = opts.last ?? [];
  const keys = [...m.keys()].filter((k) => !last.includes(k));
  keys.sort((a, b) => m.get(b)!.n - m.get(a)!.n || (a < b ? -1 : a > b ? 1 : 0));
  return [...keys, ...last.filter((k) => m.has(k))].map(row);
}

/**
 * First visits in a period, by Paris day or by source (§3.6 C.6.3): with no filter narrowing the collectors (the source
 * alone, or none), the Links reports' rule (AcquisitionReportService.firstVisits: every device first seen, anonymous
 * included, from the daily summary and the devices' first sight), the source filter applied to the device's first
 * source; with one, the devices first seen in the period that were linked to one of the collectors (never a console's
 * device; by source, those with a first source).
 */
export async function firstVisitsBy(tx: Db, x: Reading, p: Period, by: 'day' | 'source'): Promise<Map<string, number>> {
  const f = x.q.filters;
  if (!narrowsCollectors(f, x.q.scope)) {
    const acquisition = new AcquisitionReportService({ db: tx, links: x.links });
    return acquisition.firstVisits({ from: p.from, to: p.to, sources: { channelIds: f.sources.channelIds, kinds: f.sources.kinds } }, by);
  }
  const theirs = sql`${within(sql`td.first_seen_at`, p)} AND td.staff_at IS NULL
       AND EXISTS (SELECT 1 FROM tracking_device_accounts tda JOIN col c ON c.account_id = tda.account_id WHERE tda.device_id = td.id)`;
  const out = new Map<string, number>();
  if (by === 'source') {
    const rows = await sql<{ id: number; n: number }>`
      WITH ${scopeCte('col', x.q, p)}
      SELECT td.first_source_id AS id, count(*)::int AS n FROM tracking_devices td
       WHERE ${theirs} AND td.first_source_id IS NOT NULL GROUP BY 1`.execute(tx);
    for (const r of rows.rows) out.set(String(r.id), Number(r.n));
    return out;
  }
  const days: string[] = [];
  for (let d = p.from; d <= p.to; d = plusDays(d, 1)) days.push(d);
  const starts = sql`ARRAY[${sql.join([...days, plusDays(p.to, 1)].map((d) => sql`${parisDayStart(d)}::timestamptz`))}]`;
  const rows = await sql<{ b: number; n: number }>`
    WITH ${scopeCte('col', x.q, p)}
    SELECT width_bucket(td.first_seen_at, ${starts}) AS b, count(*)::int AS n FROM tracking_devices td WHERE ${theirs} GROUP BY 1`.execute(tx);
  for (const r of rows.rows) {
    const day = days[Number(r.b) - 1];
    if (day !== undefined && Number(r.n) > 0) out.set(day, Number(r.n));
  }
  return out;
}

/** First visits by Paris day in a period (firstVisitsBy). */
export const firstVisitDays = (tx: Db, x: Reading, p: Period): Promise<Map<string, number>> => firstVisitsBy(tx, x, p, 'day');

const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

// ── At a glance (`overview`) ───────────────────────────────────────────────────────────────────────────────────

interface OverviewRow {
  collectors: number;
  existed: number;
  fresh: number;
  active: number;
  wishes: number;
  wishers: number;
  became: number;
}

/** The six KPIs (§3.6 C.6.3 item 1). */
async function overviewPanel(tx: Db, x: Reading): Promise<OverviewFigures> {
  const { q } = x;
  const one = async (p: Period): Promise<OverviewRow> => {
    const r = await sql<OverviewRow>`
      WITH ${scopeCte('col', q, p)}
      SELECT (SELECT count(*) FROM col)::int AS collectors,
             (SELECT count(*) FROM col WHERE created_at < ${p.end}::timestamptz)::int AS existed,
             (SELECT count(*) FROM col WHERE ${within(sql`created_at`, p)})::int AS fresh,
             (SELECT count(*) FROM col c WHERE ${activeIn('c.account_id', p.start, p.end)})::int AS active,
             (SELECT count(*) FROM account_wishes w JOIN col c ON c.account_id = w.account_id WHERE ${within(sql`w.added_at`, p)})::int AS wishes,
             (SELECT count(DISTINCT w.account_id) FROM account_wishes w JOIN col c ON c.account_id = w.account_id WHERE ${within(sql`w.added_at`, p)})::int AS wishers,
             (SELECT count(*) FROM col c JOIN account_sources s ON s.account_id = c.account_id WHERE ${within(sql`s.first_seen_at`, p)})::int AS became`.execute(tx);
    const row = r.rows[0]!;
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as unknown as OverviewRow;
  };
  const now = await one(q.period);
  const before = q.previous ? await one(q.previous) : null;
  const visitsNow = sum(await firstVisitDays(tx, x, q.period));
  const visitsBefore = q.previous ? sum(await firstVisitDays(tx, x, q.previous)) : null;
  const scores = await sql<{ score: number }>`WITH ${scopeCte('col', q, q.period)} SELECT score FROM col WHERE score IS NOT NULL`.execute(tx);
  const scoresOn = await sql<{ day: string | null }>`SELECT max(day)::text AS day FROM engagement_runs WHERE finished_at IS NOT NULL`.execute(tx);
  const scored = scores.rows.map((r) => Number(r.score));
  // The previous value: the scores the monthly history kept for the month that ended by the previous period's end (§3.6 C.6.6).
  const before_ = q.previous ? await scoresAtPreviousEnd(tx, x, q.previous) : null;
  const previousScored = before_ ? before_.scores.filter((s): s is number => s !== null) : [];
  return {
    // ALL: the collectors whose account existed at the previous period's end; ACTIVE, NEW: the previous period's.
    collectors: { value: now.collectors, previous: before ? (q.scope === 'all' ? before.existed : before.collectors) : null },
    newCollectors: { value: now.fresh, previous: before?.fresh ?? null },
    firstVisits: { value: visitsNow, previous: visitsBefore, becameCollectors: now.became },
    active: { value: now.active, previous: before?.active ?? null },
    medianScore: {
      value: scored.length >= INSIGHTS_MIN_GROUP ? median(scored) : null,
      previous: before_ && previousScored.length >= INSIGHTS_MIN_GROUP ? median(previousScored) : null,
      scored: scored.length,
      scoresOn: scoresOn.rows[0]?.day ?? null,
    },
    wishesAdded: { value: now.wishes, previous: before?.wishes ?? null, collectors: now.wishers, previousCollectors: before?.wishers ?? null },
  };
}

// ── Who they are (`who`) ───────────────────────────────────────────────────────────────────────────────────────

/** AGES, COUNTRIES and CITIES, as given and from the connection (§3.6 C.6.3 item 2). */
async function whoPanel(tx: Db, x: Reading): Promise<WhoFigures> {
  const keyed = (cte: string) => sql`
    SELECT c.created_at, v.dim, v.key
      FROM ${sql.table(cte)} c
      LEFT JOIN account_profiles pr ON pr.account_id = c.account_id
      LEFT JOIN LATERAL (SELECT cp.place_id FROM collector_places cp WHERE cp.account_id = c.account_id
                          ORDER BY cp.days DESC, cp.last_day DESC, cp.place_id LIMIT 1) up ON TRUE
      LEFT JOIN geo_places gp ON gp.id = up.place_id
      CROSS JOIN LATERAL (VALUES
        ('age', ${ageBandSql(sql`pr.birth_date`, x.today)}),
        ('country', coalesce(btrim(c.country), 'none')),
        ('conncountry', coalesce(btrim(gp.country), 'unknown')),
        ('city', coalesce(btrim(pr.city), '')),
        ('conncity', CASE WHEN gp.city IS NULL THEN 'unknown' ELSE gp.id::text END)) AS v(dim, key)`;
  const { counts, total } = await countBy(tx, x, keyed);
  const births = await sql<{ birth_date: string }>`
    WITH ${scopeCte('col', x.q, x.q.period)}
    SELECT pr.birth_date::text AS birth_date FROM col c JOIN account_profiles pr ON pr.account_id = c.account_id WHERE pr.birth_date IS NOT NULL`.execute(tx);
  const ages = births.rows.map((r) => ageOn(String(r.birth_date).slice(0, 10), x.today));

  // CITIES as given: each spelling counted, then grouped ignoring case and accents (fold.ts, orbes_fold's twin),
  // shown as the form most often typed (equal counts: the first in code order).
  const spellings = counts.get('city') ?? new Map<string, { n: number; now: number; before: number }>();
  const groups = new Map<string, { n: number; now: number; before: number; label: string; labelN: number }>();
  for (const [spelling, e] of spellings) {
    if (spelling === '') continue;
    const k = fold(spelling);
    const g = groups.get(k) ?? { n: 0, now: 0, before: 0, label: spelling, labelN: -1 };
    g.n += e.n;
    g.now += e.now;
    g.before += e.before;
    if (e.n > g.labelN || (e.n === g.labelN && spelling < g.label)) {
      g.label = spelling;
      g.labelN = e.n;
    }
    groups.set(k, g);
  }
  const compare = (e: { now: number; before: number }) => (x.q.previous ? { now: e.now, before: e.before } : null);
  const given: CityRow[] = [...groups]
    .filter(([, g]) => g.n > 0 || g.before > 0)
    .sort(([a, ga], [b, gb]) => gb.n - ga.n || (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, g]) => ({ key, label: g.label, country: null, collectors: g.n, compare: compare(g) }));
  const none = spellings.get('');
  const cityRows = given.slice(0, WHO_CITIES_MAX);
  if (none) cityRows.push({ key: 'none', label: null, country: null, collectors: none.n, compare: compare(none) });

  // CITIES from the connection: by GeoIP place, named from geo_places.
  const placeBars = barsOf(x, counts, 'conncity', { last: ['unknown'] });
  const ids = placeBars.filter((b) => b.key !== 'unknown').map((b) => Number(b.key));
  const places = ids.length
    ? new Map((await tx.selectFrom('geo_places').select(['id', 'country', 'city']).where('id', 'in', ids).execute()).map((p) => [String(p.id), p]))
    : new Map<string, { id: number; country: string; city: string | null }>();
  const connection: CityRow[] = placeBars.map((b) => {
    const p = places.get(b.key);
    return { ...b, label: p?.city ?? null, country: p ? p.country.trim() : null };
  });
  const connectionCities = connection.filter((c) => c.key !== 'unknown');
  const connectionRows = [...connectionCities.slice(0, WHO_CITIES_MAX), ...connection.filter((c) => c.key === 'unknown')];

  return {
    total,
    ages: { rows: barsOf(x, counts, 'age', { order: AGE_SLICES }), median: ages.length >= INSIGHTS_MIN_GROUP ? median(ages) : null },
    countries: { given: barsOf(x, counts, 'country', { last: ['none'] }), connection: barsOf(x, counts, 'conncountry', { last: ['unknown'] }) },
    cities: { given: { rows: cityRows, groups: given.length }, connection: { rows: connectionRows, groups: connectionCities.length } },
  };
}

// ── Where they come from (`origin`) ────────────────────────────────────────────────────────────────────────────

/** A bar of SOURCES: a link channel, or a kind of first source. */
export interface SourceBar extends BarRow {
  kind: SourceKind;
  channel: { id: string; name: string } | null;
}

/** A bar of HOW THEY HEARD: an answer (Other marked, one set aside marked), or `none` (Not answered). */
export interface HeardBar extends BarRow {
  optionId: string | null;
  label: string | null;
  other: boolean;
  setAside: boolean;
}

/** A link's (or a channel's) results under one attribution; the revenue withheld under INSIGHTS_MIN_GROUP buyers. */
export interface LinkResult {
  collectors: number;
  buyers: number;
  revenueMinor: number | null;
}

export interface LinkTableRow {
  link: { id: string; name: string; code: string; archived: boolean };
  cost: { minor: number; currency: HouseCurrency } | null;
  first: LinkResult;
  last: LinkResult;
}

export interface LinkChannelRows {
  channel: { id: string; name: string };
  /** Its collectors and buyers counted once each, its revenue summed. */
  first: LinkResult;
  last: LinkResult;
  links: LinkTableRow[];
}

export interface CampaignCounts {
  firstVisits: number;
  collectors: number;
  buyers: number;
}

/** A campaign (utm_campaign), its sources and mediums under it (each with its content and term variants summed). */
export interface CampaignGroupRow extends CampaignCounts {
  campaign: string | null;
  rows: (CampaignCounts & { source: string | null; medium: string | null; sourceIds: number[] })[];
}

/** A bar of REFERRING SITES: a site, Other sites, or None (typed or shared). */
export interface SiteBar extends BarRow {
  site: string | null;
}

export interface FirstVisitBucket {
  key: string;
  from: string;
  to: string;
  firstVisits: number;
  newCollectors: number;
  /** The collectors whose first visit fell in it (the bucket's list, `bucket:firstvisit:<key>`, `bucket:firstvisit:prev:<key>` for the previous period's). */
  becameCollectors: number;
}

export interface OriginFigures {
  total: number;
  /** The link channels in their order, then Campaign tags, Referring sites, Direct, Before tracking (Console device when any). */
  sources: SourceBar[];
  /** The answers in the console's order (set aside ones when any collector gave them), then Not answered. */
  heard: HeardBar[];
  /** LINKS: by channel, each link's First link and Last link (sign-up or purchase): collectors, buyers, revenue; cost. */
  links: { currency: HouseCurrency; currencies: HouseCurrency[]; channels: LinkChannelRows[] };
  /** CAMPAIGNS: the top ORIGIN_CAMPAIGNS_TOP by collectors; `groups` before the cut. */
  campaigns: { rows: CampaignGroupRow[]; groups: number };
  /** REFERRING SITES: the top ORIGIN_SITES_TOP, then the other sites summed, then None (a direct first visit). */
  sites: { rows: SiteBar[]; other: SiteBar; none: SiteBar; groups: number };
  /** FIRST VISITS: by day, week or month, with the previous period's buckets; those that became collectors. */
  firstVisits: { unit: BucketUnit; buckets: FirstVisitBucket[]; previous: FirstVisitBucket[] | null; total: number; previousTotal: number | null; becameCollectors: number };
  /** The collectors made in the period, and those whose sign-up's last link is not their first source (§3.4 A.10.6). */
  firstLastDiffer: { collectors: number; differ: number };
}

/** CAMPAIGNS and REFERRING SITES: the rows given at most. */
export const ORIGIN_CAMPAIGNS_TOP = 50;
export const ORIGIN_SITES_TOP = 20;

/** The kinds of first source after the link channels, in the page's order (§3.6 C.6.3 SOURCES). */
const SOURCE_KIND_ORDER = ['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE'] as const;

/** The recording's start and the BEFORE and DIRECT sources: the fallbacks of an account or an act with no row (§3.4 A.5). */
export async function acquisitionBasis(tx: Db): Promise<{ started: Date; before: number; direct: number }> {
  const state = await tx.selectFrom('acquisition_state').select('tracking_started_at').where('id', '=', 1).executeTakeFirst();
  const fixed = await tx.selectFrom('acquisition_sources').select(['key', 'id']).where('key', 'in', ['BEFORE', 'DIRECT']).execute();
  return {
    started: state?.tracking_started_at ?? new Date('9999-12-31T00:00:00.000Z'),
    before: fixed.find((f) => f.key === 'BEFORE')?.id ?? 0,
    direct: fixed.find((f) => f.key === 'DIRECT')?.id ?? 0,
  };
}

/**
 * Where the collector `c` first came from, as SOURCES keys it (§3.4 A.5, question 18): `channel:<id>` for a link, else
 * `kind:<KIND>`; with no row, Before tracking for an account made before the recording, else Direct. It reads the
 * joins FIRST_SOURCE_JOINS (`fs`, `fk`, `fl`) and `c.created_at`.
 */
export const firstSourceKey = (basis: { started: Date }): RawBuilder<string> =>
  sql<string>`(CASE WHEN fs.account_id IS NULL THEN (CASE WHEN c.created_at < ${basis.started}::timestamptz THEN 'kind:BEFORE' ELSE 'kind:DIRECT' END)
                             WHEN fk.kind = 'LINK' THEN 'channel:' || fl.channel_id::text ELSE 'kind:' || fk.kind END)`;
export const FIRST_SOURCE_JOINS = sql`LEFT JOIN account_sources fs ON fs.account_id = c.account_id
      LEFT JOIN acquisition_sources fk ON fk.id = fs.first_source_id
      LEFT JOIN links fl ON fl.id = fk.link_id`;

/** A paid order bought in the period (GROWTH's purchases: never GIFT, not CANCELLED or RETURNED). */
export const bought = (o: string, p: Pick<Period, 'start' | 'end'>) => sql`${sql.ref(`${o}.paid_at`)} IS NOT NULL AND ${sql.ref(`${o}.channel`)} <> 'GIFT' AND ${sql.ref(`${o}.status`)} NOT IN ('CANCELLED', 'RETURNED') AND ${within(sql.ref(`${o}.paid_at`), p)}`;

/** SOURCES, HOW THEY HEARD, LINKS, CAMPAIGNS, REFERRING SITES and FIRST VISITS (§3.6 C.6.3 item 3; §3.4 A.10.6). */
async function originPanel(tx: Db, x: Reading): Promise<OriginFigures> {
  const { q } = x;
  const basis = await acquisitionBasis(tx);
  const firstKey = firstSourceKey(basis);
  const keyed = (cte: string) => sql`
    SELECT c.created_at, v.dim, v.key
      FROM ${sql.table(cte)} c
      ${FIRST_SOURCE_JOINS}
      LEFT JOIN account_profiles pr ON pr.account_id = c.account_id
      CROSS JOIN LATERAL (VALUES
        ('source', ${firstKey}),
        ('heard', coalesce(pr.heard_option_id::text, 'none')),
        ('site', CASE WHEN fk.kind = 'SITE' THEN 'site:' || fk.site WHEN ${firstKey} = 'kind:DIRECT' THEN 'none' ELSE 'x' END)) AS v(dim, key)`;
  const { counts, total } = await countBy(tx, x, keyed);

  // SOURCES: every channel in its order, then the kinds; Console device only when some collector came first through it.
  const channels = await x.links.channels(tx);
  const sourceKeys = [...channels.map((c) => `channel:${c.id}`), ...SOURCE_KIND_ORDER.map((k) => `kind:${k}`)];
  if (counts.get('source')?.has('kind:STAFF')) sourceKeys.push('kind:STAFF');
  const sources: SourceBar[] = barsOf(x, counts, 'source', { order: sourceKeys }).map((b) => {
    const channel = b.key.startsWith('channel:') ? channels.find((c) => `channel:${c.id}` === b.key)! : null;
    return { ...b, kind: channel ? 'LINK' : (b.key.slice(5) as SourceKind), channel: channel ? { id: channel.id, name: channel.name } : null };
  });

  // HOW THEY HEARD: the answers in the console's order, a set-aside one while it has collectors, then Not answered.
  const options = await tx.selectFrom('heard_options').select(['id', 'label', 'is_other', 'active']).orderBy('position').orderBy('id').execute();
  const heardCounts = counts.get('heard') ?? new Map<string, { n: number; now: number; before: number }>();
  const shown = options.filter((o) => o.active || (heardCounts.get(o.id)?.n ?? 0) + (heardCounts.get(o.id)?.before ?? 0) > 0);
  const heard: HeardBar[] = barsOf(x, counts, 'heard', { order: [...shown.map((o) => o.id), 'none'] }).map((b) => {
    const o = shown.find((x) => x.id === b.key);
    return { ...b, optionId: o?.id ?? null, label: o?.label ?? null, other: o?.is_other ?? false, setAside: o ? !o.active : false };
  });

  // REFERRING SITES: the first source's site, the top ones, the rest as Other sites, then None (a direct first visit).
  const siteBars = barsOf(x, counts, 'site').filter((b) => b.key.startsWith('site:'));
  const sumBars = (key: string, list: BarRow[]): SiteBar => ({
    key,
    site: null,
    collectors: list.reduce((a, b) => a + b.collectors, 0),
    compare: q.previous ? { now: list.reduce((a, b) => a + b.compare!.now, 0), before: list.reduce((a, b) => a + b.compare!.before, 0) } : null,
  });
  const noneBar = barsOf(x, counts, 'site', { order: ['none'] })[0]!;
  const sites = {
    rows: siteBars.slice(0, ORIGIN_SITES_TOP).map((b) => ({ ...b, site: b.key.slice(5) })),
    other: sumBars('other', siteBars.slice(ORIGIN_SITES_TOP)),
    none: { ...noneBar, site: null },
    groups: siteBars.length,
  };

  return {
    total,
    sources,
    heard,
    links: await originLinks(tx, x),
    campaigns: await originCampaigns(tx, x),
    sites,
    firstVisits: await originFirstVisits(tx, x),
    firstLastDiffer: await firstLastDiffer(tx, x, basis),
  };
}

/** LINKS (§3.6 C.6.3): each link's and channel's collectors, buyers and revenue as the first link and as the last link. */
async function originLinks(tx: Db, x: Reading): Promise<OriginFigures['links']> {
  const { q } = x;
  const P = q.period;
  const { currency, currencies } = await currenciesOf(tx, q.currency ?? undefined);
  const amount = sql`(CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END)::bigint`;
  // Facts: m = fc/fb/fr (first link: collectors, buyers, revenue), lc/lb/lr (last link). The Before tracking and Direct
  // fallbacks are never a link, so an account or an act without a row is never one of a link's.
  const rows = await sql<{ m: string; channel_id: string; link_id: string | null; n: number; amount: number | null }>`
    WITH ${scopeCte('col', q, P)},
    fl AS (SELECT c.account_id, k.link_id FROM col c JOIN account_sources s ON s.account_id = c.account_id
             JOIN acquisition_sources k ON k.id = s.first_source_id WHERE k.link_id IS NOT NULL),
    buys AS (SELECT o.id, o.account_id FROM orders o JOIN col c ON c.account_id = o.account_id WHERE ${bought('o', P)}),
    rev AS (SELECT o.id AS order_id, o.account_id, ${amount} AS amount
              FROM invoices i JOIN orders o ON o.id = i.order_id JOIN col c ON c.account_id = o.account_id
             WHERE i.currency = ${currency} AND ${within(sql`i.issued_at`, P)}),
    ll AS (SELECT cv.account_id, k.link_id FROM acquisition_conversions cv JOIN col c ON c.account_id = cv.account_id
             JOIN acquisition_sources k ON k.id = cv.last_source_id
            WHERE k.link_id IS NOT NULL
              AND (cv.kind = 'SIGNUP' OR (cv.kind = 'ORDER' AND EXISTS (
                     SELECT 1 FROM orders lo WHERE lo.id = cv.ref_id AND lo.paid_at IS NOT NULL AND lo.channel <> 'GIFT')))),
    ol AS (SELECT cv.ref_id AS order_id, k.link_id FROM acquisition_conversions cv JOIN acquisition_sources k ON k.id = cv.last_source_id
            WHERE cv.kind = 'ORDER' AND k.link_id IS NOT NULL),
    x AS (
      SELECT 'fc'::text AS m, fl.account_id, fl.link_id, 0::bigint AS amount FROM fl
      UNION ALL SELECT 'fb', b.account_id, fl.link_id, 0 FROM buys b JOIN fl ON fl.account_id = b.account_id
      UNION ALL SELECT 'fr', r.account_id, fl.link_id, r.amount FROM rev r JOIN fl ON fl.account_id = r.account_id
      UNION ALL SELECT 'lc', ll.account_id, ll.link_id, 0 FROM ll
      UNION ALL SELECT 'lb', b.account_id, ol.link_id, 0 FROM buys b JOIN ol ON ol.order_id = b.id
      UNION ALL SELECT 'lr', r.account_id, ol.link_id, r.amount FROM rev r JOIN ol ON ol.order_id = r.order_id)
    SELECT x.m, l.channel_id::text AS channel_id, x.link_id::text AS link_id, count(DISTINCT x.account_id)::int AS n, sum(x.amount)::bigint AS amount
      FROM x JOIN links l ON l.id = x.link_id
     GROUP BY x.m, GROUPING SETS ((l.channel_id, x.link_id), (l.channel_id))`.execute(tx);
  const figures = new Map<string, Record<string, { n: number; amount: number }>>();
  for (const r of rows.rows) {
    const key = r.link_id ?? `channel:${r.channel_id}`;
    const f = figures.get(key) ?? {};
    f[r.m] = { n: Number(r.n), amount: Number(r.amount ?? 0) };
    figures.set(key, f);
  }
  const result = (key: string, side: 'f' | 'l'): LinkResult => {
    const f = figures.get(key) ?? {};
    const buyers = f[`${side}b`]?.n ?? 0;
    return { collectors: f[`${side}c`]?.n ?? 0, buyers, revenueMinor: buyers >= INSIGHTS_MIN_GROUP ? (f[`${side}r`]?.amount ?? 0) : null };
  };
  const links = await x.links.list({ archived: true }, tx);
  const out: LinkChannelRows[] = [];
  for (const c of await x.links.channels(tx)) {
    const mine = links
      .filter((l) => l.channel.id === c.id)
      .map((l) => ({ link: { id: l.id, name: l.name, code: l.code, archived: l.archivedAt !== null }, cost: l.cost, first: result(l.id, 'f'), last: result(l.id, 'l') }))
      // An archived link is listed while it has a figure (§3.6 C.6.6: it stays, marked).
      .filter((r) => !r.link.archived || figures.has(r.link.id));
    if (mine.length === 0) continue;
    out.push({ channel: { id: c.id, name: c.name }, first: result(`channel:${c.id}`, 'f'), last: result(`channel:${c.id}`, 'l'), links: mine });
  }
  return { currency, currencies, channels: out };
}

/** CAMPAIGNS (§3.6 C.6.3): by utm_campaign, then source and medium, first visits, collectors and buyers; the top 50. */
async function originCampaigns(tx: Db, x: Reading): Promise<OriginFigures['campaigns']> {
  const { q } = x;
  const P = q.period;
  const meta = await tx.selectFrom('acquisition_sources').select(['id', 'utm_source', 'utm_medium', 'utm_campaign']).where('kind', '=', 'CAMPAIGN').orderBy('id').execute();
  if (meta.length === 0) return { rows: [], groups: 0 };
  const visits = await firstVisitsBy(tx, x, P, 'source');
  const rows = await sql<{ id: number; collectors: number; buyers: number }>`
    WITH ${scopeCte('col', q, P)}
    SELECT s.first_source_id AS id, count(*)::int AS collectors,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.account_id = c.account_id AND ${bought('o', P)}))::int AS buyers
      FROM col c JOIN account_sources s ON s.account_id = c.account_id
      JOIN acquisition_sources k ON k.id = s.first_source_id AND k.kind = 'CAMPAIGN'
     GROUP BY 1`.execute(tx);
  const bySource = new Map(rows.rows.map((r) => [Number(r.id), { collectors: Number(r.collectors), buyers: Number(r.buyers) }]));
  const groups = new Map<string, CampaignGroupRow>();
  for (const m of meta) {
    const c = bySource.get(m.id) ?? { collectors: 0, buyers: 0 };
    const v = visits.get(String(m.id)) ?? 0;
    if (c.collectors + v === 0) continue;
    const g = groups.get(m.utm_campaign ?? '') ?? { campaign: m.utm_campaign, firstVisits: 0, collectors: 0, buyers: 0, rows: [] };
    g.firstVisits += v;
    g.collectors += c.collectors;
    g.buyers += c.buyers;
    const row = g.rows.find((r) => r.source === m.utm_source && r.medium === m.utm_medium);
    if (row) {
      row.firstVisits += v;
      row.collectors += c.collectors;
      row.buyers += c.buyers;
      row.sourceIds.push(m.id);
    } else g.rows.push({ source: m.utm_source, medium: m.utm_medium, sourceIds: [m.id], firstVisits: v, collectors: c.collectors, buyers: c.buyers });
    groups.set(m.utm_campaign ?? '', g);
  }
  const order = <T extends CampaignCounts>(a: T, b: T, ka: string, kb: string) => b.collectors - a.collectors || b.firstVisits - a.firstVisits || (ka < kb ? -1 : ka > kb ? 1 : 0);
  const list = [...groups.values()];
  for (const g of list) g.rows.sort((a, b) => order(a, b, `${a.source}/${a.medium}`, `${b.source}/${b.medium}`));
  list.sort((a, b) => order(a, b, a.campaign ?? '', b.campaign ?? ''));
  return { rows: list.slice(0, ORIGIN_CAMPAIGNS_TOP), groups: list.length };
}

/** FIRST VISITS (§3.6 C.6.3): first visits and new collectors by bucket, the previous period's buckets beside them. */
async function originFirstVisits(tx: Db, x: Reading): Promise<OriginFigures['firstVisits']> {
  const { q } = x;
  const of = async (p: Period) => {
    const days = await firstVisitsBy(tx, x, p, 'day');
    const created = await sql<{ created_at: Date }>`WITH ${scopeCte('col', q, p)} SELECT created_at FROM col WHERE ${within(sql`created_at`, p)}`.execute(tx);
    const came = await sql<{ at: Date }>`
      WITH ${scopeCte('col', q, p)}
      SELECT s.first_seen_at AS at FROM col c JOIN account_sources s ON s.account_id = c.account_id WHERE ${within(sql`s.first_seen_at`, p)}`.execute(tx);
    const buckets: FirstVisitBucket[] = periodBuckets(p).map((b) => ({ key: b.key, from: b.from, to: b.to, firstVisits: 0, newCollectors: 0, becameCollectors: 0 }));
    const at = (day: string) => buckets.find((b) => day >= b.from && day <= b.to);
    for (const [day, n] of days) {
      const b = at(day);
      if (b) b.firstVisits += n;
    }
    for (const r of created.rows) {
      const b = at(parisDay(new Date(r.created_at)));
      if (b) b.newCollectors += 1;
    }
    for (const r of came.rows) {
      const b = at(parisDay(new Date(r.at)));
      if (b) b.becameCollectors += 1;
    }
    return buckets;
  };
  const buckets = await of(q.period);
  const previous = q.previous ? await of(q.previous) : null;
  const became = await sql<{ n: number }>`
    WITH ${scopeCte('col', q, q.period)}
    SELECT count(*)::int AS n FROM col c JOIN account_sources s ON s.account_id = c.account_id WHERE ${within(sql`s.first_seen_at`, q.period)}`.execute(tx);
  const total = (list: FirstVisitBucket[]) => list.reduce((a, b) => a + b.firstVisits, 0);
  return { unit: bucketUnit(q.period), buckets, previous, total: total(buckets), previousTotal: previous ? total(previous) : null, becameCollectors: Number(became.rows[0]?.n ?? 0) };
}

/** The collectors made in the period whose sign-up's last link differs from their first source, with the reports' fallbacks. */
async function firstLastDiffer(tx: Db, x: Reading, basis: { started: Date; before: number; direct: number }): Promise<OriginFigures['firstLastDiffer']> {
  const fallback = sql`(CASE WHEN c.created_at < ${basis.started}::timestamptz THEN ${basis.before}::integer ELSE ${basis.direct}::integer END)`;
  const r = await sql<{ collectors: number; differ: number }>`
    WITH ${scopeCte('col', x.q, x.q.period)}
    SELECT count(*)::int AS collectors, count(*) FILTER (WHERE d.first_src IS DISTINCT FROM d.last_src)::int AS differ FROM (
      SELECT coalesce(s.first_source_id, ${fallback}) AS first_src, coalesce(cv.last_source_id, ${fallback}) AS last_src
        FROM col c LEFT JOIN account_sources s ON s.account_id = c.account_id
        LEFT JOIN acquisition_conversions cv ON cv.kind = 'SIGNUP' AND cv.ref_id = c.account_id
       WHERE ${within(sql`c.created_at`, x.q.period)}) d`.execute(tx);
  return { collectors: Number(r.rows[0]?.collectors ?? 0), differ: Number(r.rows[0]?.differ ?? 0) };
}

// ── What they like (`likes`) ───────────────────────────────────────────────────────────────────────────────────

/**
 * FAVOURITE PIECES, FINISHES, MOST WISHED, MOST VIEWED and PIECES HELD (§3.6 C.6.3 item 4), read by LikesService's
 * `readLikes` (§3.2 W.8) over the page's collectors (`scopeCte`: the five filters and the scope) for the period and the
 * previous one; ALL VISITORS reads the daily totals, where only the country filter applies.
 */
async function likesPanel(tx: Db, x: Reading): Promise<LikesFigures> {
  const { q } = x;
  return readLikes(tx, {
    window: { from: q.period.from, to: q.period.to, start: q.period.start, end: q.period.end, previous: q.previous },
    population: (name, p) => scopeCte(name, q, p),
    countries: q.filters.countries,
    now: x.now,
  });
}

// ── Devices (`devices`) ────────────────────────────────────────────────────────────────────────────────────────

/** One switch of the Devices panel: the period's figures and, with the comparison, the previous period's. */
export interface DevicesTab {
  current: DevicesFigures;
  previous: DevicesFigures | null;
}

export interface DevicesPanelFigures {
  /** The collectors in scope. */
  total: number;
  /** BY COLLECTORS: each collector once, under the device used most in the period (the 13 months of detail). */
  byCollectors: DevicesTab;
  /** BY VISITS: every visit of the collectors (a device's views more than 30 minutes apart begin one; the detail). */
  byVisits: DevicesTab;
  /** ALL DEVICES: every device seen, anonymous included, from the daily totals; only the country filter applies. */
  allDevices: DevicesTab;
  /** The last Paris day the daily totals count (« Figures through … »). */
  through: string | null;
  /** BY COLLECTORS and BY VISITS: the first day kept when the period reaches past the 13 months (« … reach back 13 months, to … »). */
  reachesBackTo: string | null;
}

/** The page's collectors for `p` as a condition on an account column (null: every counted collector, nothing narrowing them). */
function collectorsOf(x: Reading, p: Period): ViewFilters | undefined {
  const { q } = x;
  if (q.scope === 'all' && !hasFilters(q.filters)) return undefined;
  return { accounts: (column: string) => sql`${sql.ref(column)} IN (WITH ${scopeCte('dcol', q, p)} SELECT dcol.account_id FROM dcol)` };
}

const topBrowsers = (f: DevicesFigures): DevicesFigures => ({ ...f, browsers: f.browsers.slice(0, DEVICE_BROWSERS_TOP) });

/**
 * DEVICE, SYSTEM, OPENED IN and BROWSERS by collectors, by visits and for all devices (§3.6 C.6.3 item 5; §3.3 T.4.2),
 * read by tracking-reads.ts devicesReport: BY COLLECTORS and BY VISITS over the page's collectors of each period (the
 * scope and the five filters), ALL DEVICES from the daily totals with the page's countries as the connection's (the only
 * country they hold). The comparison is the same figure over the previous period and its collectors.
 */
async function devicesPanel(tx: Db, x: Reading): Promise<DevicesPanelFigures> {
  const { q } = x;
  const read = async (p: Period, by: DevicesBy) => {
    const filters = by === 'DEVICES' ? (q.filters.countries.length ? { countries: q.filters.countries } : undefined) : collectorsOf(x, p);
    return devicesReport(tx, { from: p.from, to: p.to }, filters, { now: x.now, by });
  };
  const tab = async (by: DevicesBy) => {
    const now = await read(q.period, by);
    const before = q.previous ? await read(q.previous, by) : null;
    return { report: now, tab: { current: topBrowsers(now.current), previous: before ? topBrowsers(before.current) : null } };
  };
  const collectors = await tab('COLLECTORS');
  const visits = await tab('VISITS');
  const all = await tab('DEVICES');
  const total = await sql<{ n: number }>`WITH ${scopeCte('col', q, q.period)} SELECT count(*)::int AS n FROM col`.execute(tx);
  return {
    total: Number(total.rows[0]?.n ?? 0),
    byCollectors: collectors.tab,
    byVisits: visits.tab,
    allDevices: all.tab,
    through: all.report.through,
    reachesBackTo: collectors.report.reachesBackTo,
  };
}

// ── Engagement (`engagement`) ──────────────────────────────────────────────────────────────────────────────────

/** A bar of SCORE SPREAD or of ACTIVE AND DORMANT: its collectors, and the previous period's end's (null: off or not held). */
export interface SpreadRow {
  key: string;
  collectors: number;
  previous: number | null;
}

export interface CohortRow {
  /** The Paris month of sign-up, `YYYY-MM`. */
  month: string;
  collectors: number;
  /** COHORT_MARKS in order: the collectors active in the month that many months after; null (« — ») while not written yet. */
  marks: { after: number; active: number | null; share: number | null }[];
}

export interface EngagementFigures {
  /** The collectors in scope. */
  total: number;
  /** The day of the latest finished morning run (« Scores of … » when it is not today's). */
  scoresOn: string | null;
  spread: {
    /** SCORE_SLICES in order, then `none` (Not measured). */
    rows: SpreadRow[];
    /** Withheld under INSIGHTS_MIN_GROUP. */
    median: number | null;
    scored: number;
    /** The month whose kept scores make the previous spread (`YYYY-MM-01`), null without one. */
    previousMonth: string | null;
  };
  /** THE FIVE PARTS: each part's average points of the scored collectors (one decimal), withheld under INSIGHTS_MIN_GROUP. */
  parts: { key: EngagementPart; max: number; average: number | null; collectors: number }[];
  /** ACTIVE AND DORMANT as of the period's last day (and the previous period's last day). */
  status: { asOf: string; previousAsOf: string | null; rows: SpreadRow[] };
  /** MONTHLY COHORTS: the COHORT_MONTHS months up to the period's last month, the newest first; `through` the last month written. */
  cohorts: { through: string | null; rows: CohortRow[] };
}

/** The month (`YYYY-MM-01`) that ended by a period's last day: its own month when that day is the month's last, else the one before. */
export function monthEndedBy(day: string): string {
  const month = `${day.slice(0, 7)}-01`;
  return plusDays(plusMonths(month, 1), -1) === day ? month : plusMonths(month, -1);
}

/** The months collector_history holds, from the first row's first month to the latest written; null while it is empty. */
async function historySpan(tx: Db): Promise<{ first: string; last: string } | null> {
  const r = await sql<{ first: string | null; last: string | null }>`SELECT min(first_month)::text AS first, max(last_month)::text AS last FROM collector_history`.execute(tx);
  const row = r.rows[0];
  return row?.first && row.last ? { first: String(row.first).slice(0, 10), last: String(row.last).slice(0, 10) } : null;
}

/** The 1-based index of month `month` (a `YYYY-MM-01` date, or an SQL date) in a history row's arrays: past its last element, NULL. */
export const historyIndex = (month: RawBuilder<unknown>, row = 'h'): RawBuilder<number> =>
  sql<number>`((extract(year FROM ${month}) - extract(year FROM ${sql.ref(`${row}.first_month`)})) * 12 + extract(month FROM ${month}) - extract(month FROM ${sql.ref(`${row}.first_month`)}) + 1)::int`;

/**
 * The scores the monthly history kept, for the month that ended by the previous period's end, of the previous period's
 * collectors whose account existed then (null elements: not measured); null when the history does not hold that month.
 */
async function scoresAtPreviousEnd(tx: Db, x: Reading, B: Period): Promise<{ month: string; scores: (number | null)[] } | null> {
  const span = await historySpan(tx);
  const month = monthEndedBy(B.to);
  if (!span || month < span.first || month > span.last) return null;
  const r = await sql<{ s: number | null }>`
    WITH ${scopeCte('colp', x.q, B)}
    SELECT h.scores[${historyIndex(sql`${month}::date`)}] AS s
      FROM colp c LEFT JOIN collector_history h ON h.account_id = c.account_id
     WHERE c.created_at < ${B.end}::timestamptz`.execute(tx);
  return { month, scores: r.rows.map((row) => (row.s === null || row.s === undefined ? null : Number(row.s))) };
}

/** A score's slice of SCORE SPREAD. */
export const scoreSlice = (score: number | null): string => (score === null ? 'none' : SCORE_SLICES[band(score)]!);

/** Counts per slice in SCORE_SLICES' order, then `none`. */
function spreadOf(scores: readonly (number | null)[]): Map<string, number> {
  const out = new Map<string, number>([...SCORE_SLICES, 'none'].map((k) => [k, 0]));
  for (const s of scores) out.set(scoreSlice(s), out.get(scoreSlice(s))! + 1);
  return out;
}

/** The Paris day starts from the day of `first` to the day after `to`: a row's day by width_bucket, the day after it at +1. */
export function dayStarts(first: Date, to: string): RawBuilder<unknown> {
  const days: string[] = [];
  for (let d = parisDay(first); d <= plusDays(to, 1); d = plusDays(d, 1)) days.push(d);
  return sql`ARRAY[${sql.join(days.map((d) => sql`${parisDayStart(d)}::timestamptz`))}]::timestamptz[]`;
}

/** The latest act (activeIn's: a sign-in, a scan, a view, a draw entry, a LIVE entry or an order) of `c` before `end`. */
const lastActBefore = (end: Date) => {
  const e = sql`${end}::timestamptz`;
  return sql`greatest(
    (SELECT max(ail.occurred_at) FROM audit_logs ail WHERE ail.action = 'account.login' AND ail.target_id = c.account_id::text AND ail.occurred_at < ${e}),
    (SELECT max(ais.occurred_at) FROM scan_events ais WHERE ais.account_id = c.account_id AND ais.occurred_at < ${e}),
    (SELECT max(aiv.at) FROM collector_views aiv WHERE aiv.account_id = c.account_id AND aiv.at < ${e}),
    (SELECT max(aid.created_at) FROM drop_entries aid WHERE aid.account_id = c.account_id AND aid.created_at < ${e}),
    (SELECT max(aie.joined_at) FROM live_entries aie WHERE aie.account_id = c.account_id AND aie.joined_at < ${e}),
    (SELECT max(aio.reserved_at) FROM orders aio WHERE aio.account_id = c.account_id AND aio.reserved_at < ${e}))`;
};

/**
 * ACTIVE AND DORMANT of the collector `c` (its `account_id`, `created_at`) as of period `p`'s last day, over the day
 * starts `starts` (dayStarts): `never` with no act after the account's first Paris day; `active` with one in the
 * ENGAGEMENT_ACTIVE_DAYS Paris days up to the period's end; `dormant` otherwise. Accounts made after the period are
 * the caller's to leave out.
 */
export function statusSql(p: Pick<Period, 'to' | 'end'>, starts: RawBuilder<unknown>): RawBuilder<EngagementStatus> {
  const windowStart = parisDayStart(plusDays(p.to, -(ENGAGEMENT_ACTIVE_DAYS - 1)));
  const firstDayEnd = sql`(${starts})[width_bucket(c.created_at, ${starts}) + 1]`;
  return sql<EngagementStatus>`(SELECT CASE WHEN st.la IS NULL OR st.la < st.fe THEN 'never' WHEN st.la >= greatest(st.fe, ${windowStart}::timestamptz) THEN 'active' ELSE 'dormant' END
      FROM (SELECT ${lastActBefore(p.end)} AS la, ${firstDayEnd} AS fe) st)`;
}

/** The collectors of a scope CTE by ACTIVE AND DORMANT as of the period's last day (those made by its end). */
async function statusCounts(tx: Db, x: Reading, p: Period, cte: string): Promise<Map<string, number>> {
  const first = await sql<{ m: Date | null }>`WITH ${scopeCte(cte, x.q, p)} SELECT min(created_at) AS m FROM ${sql.table(cte)} WHERE created_at < ${p.end}::timestamptz`.execute(tx);
  const out = new Map<string, number>(ENGAGEMENT_STATUSES.map((k) => [k, 0]));
  const min = first.rows[0]?.m;
  if (!min) return out;
  const starts = dayStarts(new Date(min), p.to);
  const r = await sql<{ st: string; n: number }>`
    WITH ${scopeCte(cte, x.q, p)}
    SELECT ${statusSql(p, starts)} AS st, count(*)::int AS n FROM ${sql.table(cte)} c WHERE c.created_at < ${p.end}::timestamptz GROUP BY 1`.execute(tx);
  for (const row of r.rows) out.set(row.st, Number(row.n));
  return out;
}

/**
 * SCORE SPREAD, THE FIVE PARTS, ACTIVE AND DORMANT and MONTHLY COHORTS (§3.6 C.6.3 item 6) over the page's collectors:
 * the spread of the scores now (account_scores, this morning's run) with, beside it, the scores the monthly history kept
 * for the month that ended by the previous period's end; the parts' averages of the scored collectors; the statuses as
 * of the period's last day and the previous period's; the cohorts of the COHORT_MONTHS months up to the period's last
 * month, each mark read from collector_history.active (a month not written yet: null).
 */
async function engagementPanel(tx: Db, x: Reading): Promise<EngagementFigures> {
  const { q } = x;
  const P = q.period;
  const B = q.previous;
  const scores = await sql<{ score: number | null }>`WITH ${scopeCte('col', q, P)} SELECT score FROM col`.execute(tx);
  const now = scores.rows.map((r) => (r.score === null ? null : Number(r.score)));
  const scored = now.filter((s): s is number => s !== null);
  const before = B ? await scoresAtPreviousEnd(tx, x, B) : null;
  const spreadNow = spreadOf(now);
  const spreadBefore = before ? spreadOf(before.scores) : null;
  const scoresOn = await sql<{ day: string | null }>`SELECT max(day)::text AS day FROM engagement_runs WHERE finished_at IS NOT NULL`.execute(tx);

  // THE FIVE PARTS: the averages of the scored collectors.
  const parts = await sql<Record<string, unknown>>`
    WITH ${scopeCte('col', q, P)}
    SELECT count(*)::int AS n, ${sql.join(ENGAGEMENT_PARTS.map((k) => sql`avg(s.${sql.ref(`${k}_points`)})::float8 AS ${sql.ref(k)}`))}
      FROM col c JOIN account_scores s ON s.account_id = c.account_id`.execute(tx);
  const pr = parts.rows[0] ?? {};
  const partsScored = Number(pr.n ?? 0);

  // ACTIVE AND DORMANT.
  const statusNow = await statusCounts(tx, x, P, 'col');
  const statusBefore = B ? await statusCounts(tx, x, B, 'colp') : null;

  // MONTHLY COHORTS.
  const span = await historySpan(tx);
  const lastMonth = `${P.to.slice(0, 7)}-01`;
  const months = Array.from({ length: COHORT_MONTHS }, (_, i) => plusMonths(lastMonth, -i));
  const cm = sql.join(months.map((m) => sql`(${m}::date, ${parisMonthStart(m.slice(0, 7))}::timestamptz, ${parisMonthStart(plusMonths(m, 1).slice(0, 7))}::timestamptz)`));
  const cohortRows = await sql<Record<string, unknown>>`
    WITH ${scopeCte('col', q, P)}, cm(m, s, e) AS (VALUES ${cm})
    SELECT cm.m::text AS month, count(*)::int AS n,
           ${sql.join(COHORT_MARKS.map((k) => sql`(count(*) FILTER (WHERE h.active[${historyIndex(sql`(cm.m + ${sql.raw(`interval '${k} months'`)})::date`)}]))::int AS ${sql.ref(`a${k}`)}`))}
      FROM col c JOIN cm ON c.created_at >= cm.s AND c.created_at < cm.e
      LEFT JOIN collector_history h ON h.account_id = c.account_id
     GROUP BY cm.m`.execute(tx);
  const byMonth = new Map(cohortRows.rows.map((r) => [String(r.month).slice(0, 10), r]));
  const cohorts: CohortRow[] = months.map((m) => {
    const r = byMonth.get(m);
    const n = Number(r?.n ?? 0);
    return {
      month: m.slice(0, 7),
      collectors: n,
      marks: COHORT_MARKS.map((k) => {
        const reached = span !== null && plusMonths(m, k) <= span.last;
        const active = reached ? Number(r?.[`a${k}`] ?? 0) : null;
        return { after: k, active, share: active !== null && n > 0 ? Math.round((active * 100) / n) : null };
      }),
    };
  });

  return {
    total: now.length,
    scoresOn: scoresOn.rows[0]?.day ?? null,
    spread: {
      rows: [...SCORE_SLICES, 'none'].map((key) => ({ key, collectors: spreadNow.get(key)!, previous: spreadBefore ? spreadBefore.get(key)! : null })),
      median: scored.length >= INSIGHTS_MIN_GROUP ? median(scored) : null,
      scored: scored.length,
      previousMonth: before?.month ?? null,
    },
    parts: ENGAGEMENT_PARTS.map((key) => ({
      key,
      max: PART_MAX[key],
      average: partsScored >= INSIGHTS_MIN_GROUP && pr[key] !== null && pr[key] !== undefined ? Math.round(Number(pr[key]) * 10) / 10 : null,
      collectors: partsScored,
    })),
    status: {
      asOf: P.to,
      previousAsOf: B ? B.to : null,
      rows: ENGAGEMENT_STATUSES.map((key) => ({ key, collectors: statusNow.get(key)!, previous: statusBefore ? statusBefore.get(key)! : null })),
    },
    cohorts: { through: span ? span.last.slice(0, 7) : null, rows: cohorts },
  };
}

// ── Over time (`trends`) ───────────────────────────────────────────────────────────────────────────────────────

/** A point of a line: its bucket, the figure (null: withheld or not known then), and the collectors behind it (its list). */
export interface TrendPoint {
  key: string;
  from: string;
  to: string;
  value: number | null;
  collectors: number;
}

export interface TrendSeries {
  /** The split's group (a country, `channel:<id>` or `kind:<KIND>`, a tier, an age slice, a device kind), `other`, or `visitor`. */
  group: string;
  points: TrendPoint[];
}

export interface TrendsFigures {
  figure: TrendFigure;
  split: TrendSplit;
  unit: BucketUnit;
  /** Every group together: the line drawn without a split. */
  total: TrendPoint[];
  /** With a split: the TREND_GROUPS_MAX largest groups, then `other` (the rest summed), then `visitor` (first visits of no collector in scope). */
  groups: TrendSeries[];
  /** The previous period's line (every group together), drawn pale; null without the comparison. */
  previous: TrendPoint[] | null;
  /** Views of models: the first day kept when the period reaches past the 13 months. */
  reachesBackTo: string | null;
}

/** A cell of a line: the figure's value, the collectors behind it, and the scores a median is taken of. */
interface TrendCell {
  v: number;
  n: number;
  scores: number[];
}

/** By group, then by bucket (1 the first): the cells of one figure over one period. */
type TrendCells = Map<string, Map<number, TrendCell>>;

/**
 * The group the split gives the collector `c` of a scope CTE (§3.6 C.6.3 item 7): its country (`none`: not given), its
 * first source (SOURCES' keys), its tier now, its age slice today, or the kind of its main device in the period
 * (`unknown` without a view in the 13 months). `joins` brings what the expression reads.
 */
export function trendGroup(x: Pick<Reading, 'today' | 'now'>, split: TrendSplit, basis: { started: Date }, p: Pick<Period, 'from' | 'to'>): { expr: RawBuilder<string>; joins: RawBuilder<unknown> } {
  switch (split) {
    case 'none':
      return { expr: sql<string>`'all'`, joins: sql`` };
    case 'country':
      return { expr: sql<string>`coalesce(btrim(c.country), 'none')`, joins: sql`` };
    case 'source':
      return { expr: firstSourceKey(basis), joins: FIRST_SOURCE_JOINS };
    case 'tier':
      return { expr: sql<string>`c.tier::text`, joins: sql`` };
    case 'age':
      return { expr: ageBandSql(sql`pr.birth_date`, x.today), joins: sql`LEFT JOIN account_profiles pr ON pr.account_id = c.account_id` };
    case 'device': {
      const rows = mainDeviceRows({ from: p.from, to: p.to }, x.now);
      return { expr: sql<string>`coalesce(md.kind::text, 'unknown')`, joins: rows ? sql`LEFT JOIN (${rows}) md ON md.account_id = c.account_id` : sql`LEFT JOIN (SELECT NULL::uuid AS account_id, NULL::text AS kind) md ON FALSE` };
    }
  }
}

/** A period's bucket starts and its end, for width_bucket (1 the first bucket, 0 before, n + 1 after). */
const bucketStarts = (buckets: readonly Bucket[], end: Date) => sql`ARRAY[${sql.join([...buckets.map((b) => sql`${b.start}::timestamptz`), sql`${end}::timestamptz`])}]::timestamptz[]`;

/** Whether a Paris day is its month's last. */
const lastOfMonth = (day: string): boolean => plusDays(plusMonths(`${day.slice(0, 7)}-01`, 1), -1) === day;

/**
 * The cells of `figure` over period `p`, for the collectors of the scope CTE `cte` (scopeCte for `p`), by the split's
 * group and the period's bucket (§3.6 C.6.3 item 7):
 *   collectors   the collectors whose account existed at the bucket's end;
 *   new          those made in the bucket;
 *   firstvisits  the first visits of the bucket (the overview's rule, firstVisitsBy), by the group of the collector the
 *                device was last linked to, the others as `visitor`; behind each, the collectors whose first visit fell in it;
 *   active       those active in the bucket (activeIn's acts);
 *   medianscore  the median of the scores at the bucket's end: this morning's for the bucket holding now, else the
 *                month the history kept when the bucket ends on a month's last day, else not known;
 *   wishes       the wishes added in the bucket, by how many collectors;
 *   views        the views of models' sheets in the bucket (signed-in, the 13 months kept), by how many collectors;
 *   buyers       the collectors with a paid order of the bucket (GROWTH's purchases: never GIFT, not cancelled or returned).
 */
async function trendCells(tx: Db, x: Reading, p: Period, cte: string, split: TrendSplit, figure: TrendFigure, basis: { started: Date }): Promise<{ buckets: Bucket[]; cells: TrendCells; reachesBackTo: string | null }> {
  const buckets = periodBuckets(p);
  const starts = bucketStarts(buckets, p.end);
  const g = trendGroup(x, split, basis, p);
  const cg = sql`${scopeCte(cte, x.q, p)}, cg AS (SELECT c.account_id, c.created_at, c.score, ${g.expr} AS g FROM ${sql.table(cte)} c ${g.joins})`;
  const cells: TrendCells = new Map();
  const cell = (group: string, b: number): TrendCell => {
    const m = cells.get(group) ?? new Map<number, TrendCell>();
    cells.set(group, m);
    const c = m.get(b) ?? { v: 0, n: 0, scores: [] };
    m.set(b, c);
    return c;
  };
  const inRange = (b: number) => b >= 1 && b <= buckets.length;
  type Row = { g: string; b: number; v?: number; n: number };
  const put = (rows: Row[], valueIsN = false) => {
    for (const r of rows) {
      const b = Number(r.b);
      if (!inRange(b)) continue;
      const c = cell(r.g, b);
      c.n += Number(r.n);
      c.v += valueIsN ? Number(r.n) : Number(r.v ?? 0);
    }
  };
  let reachesBackTo: string | null = null;
  switch (figure) {
    case 'collectors':
    case 'new': {
      const rows = (await sql<Row>`WITH ${cg} SELECT g, width_bucket(created_at, ${starts}) AS b, count(*)::int AS n FROM cg GROUP BY 1, 2`.execute(tx)).rows;
      if (figure === 'new') put(rows, true);
      else {
        for (const group of new Set(rows.map((r) => r.g))) {
          let running = 0;
          const mine = rows.filter((r) => r.g === group);
          for (let b = 0; b <= buckets.length; b++) {
            running += mine.filter((r) => Number(r.b) === b).reduce((a, r) => a + Number(r.n), 0);
            if (b >= 1 && running > 0) Object.assign(cell(group, b), { v: running, n: running });
          }
        }
      }
      break;
    }
    case 'firstvisits': {
      put(
        (
          await sql<Row>`WITH ${cg} SELECT cg.g, width_bucket(s.first_seen_at, ${starts}) AS b, count(*)::int AS n
             FROM cg JOIN account_sources s ON s.account_id = cg.account_id WHERE ${within(sql`s.first_seen_at`, p)} GROUP BY 1, 2`.execute(tx)
        ).rows.map((r) => ({ ...r, v: 0 })),
      );
      const days = await firstVisitsBy(tx, x, p, 'day');
      const totals = new Map<number, number>();
      for (const [d, n] of days) {
        const b = buckets.findIndex((k) => d >= k.from && d <= k.to) + 1;
        if (b > 0) totals.set(b, (totals.get(b) ?? 0) + n);
      }
      if (split === 'none') {
        for (const [b, n] of totals) cell('all', b).v = n;
        break;
      }
      const linked = (
        await sql<{ g: string; b: number; v: number }>`
          WITH ${cg}
          SELECT lk.g, width_bucket(td.first_seen_at, ${starts}) AS b, count(*)::int AS v
            FROM tracking_devices td
            CROSS JOIN LATERAL (SELECT cg.g FROM tracking_device_accounts tda JOIN cg ON cg.account_id = tda.account_id
                                 WHERE tda.device_id = td.id ORDER BY tda.last_linked_at DESC, tda.account_id LIMIT 1) lk
           WHERE ${within(sql`td.first_seen_at`, p)} AND td.staff_at IS NULL
           GROUP BY 1, 2`.execute(tx)
      ).rows;
      const linkedBy = new Map<number, number>();
      for (const r of linked) {
        const b = Number(r.b);
        if (!inRange(b)) continue;
        cell(r.g, b).v += Number(r.v);
        linkedBy.set(b, (linkedBy.get(b) ?? 0) + Number(r.v));
      }
      for (const [b, n] of totals) if (n - (linkedBy.get(b) ?? 0) > 0) cell('visitor', b).v = n - (linkedBy.get(b) ?? 0);
      break;
    }
    case 'active': {
      const a = (t: string, at: string, account = 'account_id') => sql`SELECT cg.account_id, x.${sql.raw(at)} AS at FROM cg JOIN ${sql.table(t)} x ON x.${sql.raw(account)} = cg.account_id AND ${within(sql.ref(`x.${at}`), p)}`;
      put(
        (
          await sql<Row>`
            WITH ${cg}, ev AS (
              SELECT cg.account_id, x.occurred_at AS at FROM cg JOIN audit_logs x ON x.action = 'account.login' AND x.target_id = cg.account_id::text AND ${within(sql`x.occurred_at`, p)}
              UNION ALL ${a('scan_events', 'occurred_at')}
              UNION ALL ${a('collector_views', 'at')}
              UNION ALL ${a('drop_entries', 'created_at')}
              UNION ALL ${a('live_entries', 'joined_at')}
              UNION ALL ${a('orders', 'reserved_at')})
            SELECT cg.g, width_bucket(ev.at, ${starts}) AS b, count(DISTINCT ev.account_id)::int AS n FROM ev JOIN cg ON cg.account_id = ev.account_id GROUP BY 1, 2`.execute(tx)
        ).rows,
        true,
      );
      break;
    }
    case 'medianscore': {
      const span = await historySpan(tx);
      let current: { g: string; score: number }[] | null = null;
      for (let i = 0; i < buckets.length; i++) {
        const k = buckets[i]!;
        let rows: { g: string; score: number }[] = [];
        if (x.now >= k.start && x.now < k.end) {
          current ??= (await sql<{ g: string; score: number }>`WITH ${cg} SELECT g, score FROM cg WHERE score IS NOT NULL`.execute(tx)).rows;
          rows = current;
        } else {
          const month = `${k.to.slice(0, 7)}-01`;
          if (!lastOfMonth(k.to) || !span || month < span.first || month > span.last) continue;
          rows = (
            await sql<{ g: string; score: number }>`
              WITH ${cg} SELECT cg.g, h.scores[${historyIndex(sql`${month}::date`)}] AS score
                FROM cg JOIN collector_history h ON h.account_id = cg.account_id
               WHERE cg.created_at < ${k.end}::timestamptz AND h.scores[${historyIndex(sql`${month}::date`)}] IS NOT NULL`.execute(tx)
          ).rows;
        }
        for (const r of rows) {
          const c = cell(r.g, i + 1);
          c.scores.push(Number(r.score));
          c.n += 1;
        }
      }
      break;
    }
    case 'wishes':
      put(
        (
          await sql<Row>`WITH ${cg} SELECT cg.g, width_bucket(w.added_at, ${starts}) AS b, count(*)::int AS v, count(DISTINCT w.account_id)::int AS n
             FROM account_wishes w JOIN cg ON cg.account_id = w.account_id WHERE ${within(sql`w.added_at`, p)} GROUP BY 1, 2`.execute(tx)
        ).rows,
      );
      break;
    case 'views': {
      const cutoff = viewHistoryCutoff(x.now);
      const first = parisDay(cutoff);
      if (p.from < first) reachesBackTo = first;
      if (p.end <= cutoff) break;
      const start = p.start < cutoff ? cutoff : p.start;
      put(
        (
          await sql<Row>`WITH ${cg} SELECT cg.g, width_bucket(v.at, ${starts}) AS b, count(*)::int AS v, count(DISTINCT v.account_id)::int AS n
             FROM collector_views v JOIN cg ON cg.account_id = v.account_id
            WHERE v.page = ${VIEW_PAGE_CODES.MODEL} AND ${within(sql`v.at`, { start, end: p.end })} GROUP BY 1, 2`.execute(tx)
        ).rows,
      );
      break;
    }
    case 'buyers':
      put(
        (
          await sql<Row>`WITH ${cg} SELECT cg.g, width_bucket(o.paid_at, ${starts}) AS b, count(DISTINCT o.account_id)::int AS n
             FROM orders o JOIN cg ON cg.account_id = o.account_id WHERE ${bought('o', p)} GROUP BY 1, 2`.execute(tx)
        ).rows,
        true,
      );
      break;
  }
  return { buckets, cells, reachesBackTo };
}

/** Cells merged (values and collectors summed, scores gathered): a total, or `other`. */
function mergeCells(groups: readonly Map<number, TrendCell>[]): Map<number, TrendCell> {
  const out = new Map<number, TrendCell>();
  for (const m of groups)
    for (const [b, c] of m) {
      const e = out.get(b) ?? { v: 0, n: 0, scores: [] };
      e.v += c.v;
      e.n += c.n;
      e.scores.push(...c.scores);
      out.set(b, e);
    }
  return out;
}

/** A line's points over the buckets: a median of fewer than INSIGHTS_MIN_GROUP scores, or a figure not known then, is null. */
function trendPoints(buckets: readonly Bucket[], m: Map<number, TrendCell>, figure: TrendFigure): TrendPoint[] {
  return buckets.map((k, i) => {
    const c = m.get(i + 1);
    const value =
      figure === 'medianscore' ? (c && c.scores.length >= INSIGHTS_MIN_GROUP ? median(c.scores) : null) : (c?.v ?? 0);
    return { key: k.key, from: k.from, to: k.to, value, collectors: c?.n ?? 0 };
  });
}

/**
 * The groups drawn by name: the TREND_GROUPS_MAX largest over the period (Collectors: at the last bucket; a median: by
 * the collectors behind it; the others: their sum), then by the collectors behind them, equal ones in code order;
 * never `visitor`.
 */
export function namedTrendGroups(cells: TrendCells, figure: TrendFigure, buckets: number): string[] {
  const weight = (m: Map<number, TrendCell>) =>
    figure === 'collectors' ? (m.get(buckets)?.n ?? 0) : [...m.values()].reduce((a, c) => a + (figure === 'medianscore' ? c.n : c.v), 0);
  const behind = (m: Map<number, TrendCell>) => [...m.values()].reduce((a, c) => a + c.n, 0);
  return [...cells]
    .filter(([g]) => g !== 'visitor')
    .map(([g, m]) => ({ g, w: weight(m), n: behind(m) }))
    .sort((a, b) => b.w - a.w || b.n - a.n || (a.g < b.g ? -1 : a.g > b.g ? 1 : 0))
    .slice(0, TREND_GROUPS_MAX)
    .map((e) => e.g);
}

/** The named groups of a trend reading for `p` (the list's `other`: the collectors of none of them). */
export async function trendNamedGroups(tx: Db, x: Reading, p: Period): Promise<string[]> {
  const basis = await acquisitionBasis(tx);
  const { buckets, cells } = await trendCells(tx, x, p, 'col', x.q.trend.split, x.q.trend.figure, basis);
  return namedTrendGroups(cells, x.q.trend.figure, buckets.length);
}

/**
 * Over time (§3.6 C.6.3 item 7): one figure (TREND_FIGURES) by bucket over the period (by day up to 31 days, by week up
 * to 120, by month beyond), split by up to TREND_GROUPS_MAX groups and `other`, with the previous period's line beside
 * it. Every point carries the collectors behind it, which its list (`bucket:trend:<figure>:<key>[:<group>]`, the previous
 * line's `bucket:trend:<figure>:prev:<key>`) opens.
 */
async function trendsPanel(tx: Db, x: Reading): Promise<TrendsFigures> {
  const { q } = x;
  const { figure, split } = q.trend;
  const basis = await acquisitionBasis(tx);
  const now = await trendCells(tx, x, q.period, 'col', split, figure, basis);
  let groups: TrendSeries[] = [];
  if (split !== 'none') {
    const named = namedTrendGroups(now.cells, figure, now.buckets.length);
    const rest = [...now.cells].filter(([g]) => g !== 'visitor' && !named.includes(g)).map(([, m]) => m);
    groups = named.map((group) => ({ group, points: trendPoints(now.buckets, now.cells.get(group)!, figure) }));
    if (rest.length) groups.push({ group: 'other', points: trendPoints(now.buckets, mergeCells(rest), figure) });
    if (now.cells.has('visitor')) groups.push({ group: 'visitor', points: trendPoints(now.buckets, now.cells.get('visitor')!, figure) });
  }
  const before = q.previous ? await trendCells(tx, x, q.previous, 'colp', 'none', figure, basis) : null;
  return {
    figure,
    split,
    unit: bucketUnit(q.period),
    total: trendPoints(now.buckets, mergeCells([...now.cells.values()]), figure),
    groups,
    previous: before ? trendPoints(before.buckets, mergeCells([...before.cells.values()]), figure) : null,
    reachesBackTo: now.reachesBackTo,
  };
}

// ── The click-through (`list`) ─────────────────────────────────────────────────────────────────────────────────

/** A list's page: 50 collectors (§3.6 C.6.5). */
export const COLLECTORS_LIST_PAGE = 50;
/** The pages a list reaches at most. */
export const COLLECTORS_LIST_PAGES_MAX = 100_000;

/** The figures a list opens (§3.6 C.6.5), a closed list. */
export const SLICE_DIMENSIONS = [
  'all',
  'new',
  'active',
  'firstvisit',
  'scored',
  'wished',
  'age',
  'country',
  'conncountry',
  'city',
  'conncity',
  'source',
  'heard',
  'heardother',
  'link1',
  'link2',
  'campaign',
  'referrer',
  'bucket',
  'favpiece',
  'favfinish',
  'haswish',
  'wishmodel',
  'wishcollection',
  'viewed',
  'holds',
  'device',
  'system',
  'openedin',
  'app',
  'score',
  'part',
  'status',
  'cohort',
] as const;
export type SliceDimension = (typeof SLICE_DIMENSIONS)[number];

/** A slice: its dimension and its value as the query gives it ('' for a dimension without one). */
export interface Slice {
  dim: SliceDimension;
  value: string;
}

/** One collector of a list: no score, no tag, no mark (§3.6 C.6.5). */
export interface CollectorsListRow {
  accountId: string;
  /** As stored: the route masks it for an AUDITOR. */
  email: string;
  name: string | null;
  country: string | null;
  /** The city given in YOUR PROFILE; null for an AUDITOR (§3.0 (h)). */
  city: string | null;
  tier: number;
  createdAt: Date;
  /** The latest of the account's sessions and views; null when none is held. */
  lastSeenAt: Date | null;
  /** HOW THEY HEARD's Other: the words given (the slice `heardother` only). */
  heardOther?: string | null;
}

export interface CollectorsList {
  slice: string;
  /** What the slice names when it names a thing: a model (« MONOLITHE · Blue »), a collection, a link, a release, an answer, a place. */
  subject: string | null;
  period: ReportHead['period'];
  previous: ReportHead['previous'];
  scope: Scope;
  /** When it was read: a list is never cached. */
  readAt: Date;
  total: number;
  page: number;
  pageSize: number;
  rows: CollectorsListRow[];
}

const SLICE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BUCKET_KEY = /^\d{4}-(\d{2}-\d{2}|W\d{2}|\d{2})$/;
const badSlice = (why: string) => validationError(`slice: ${why}`);

/**
 * A bucket slice's parts: `firstvisit:<key>`, `signup:<key>`, `trend:<figure>:<key>[:<group>]`, each with `prev:` before the
 * key for a bucket of the previous period. A week or a month is cut at the two periods' meeting day, so the previous
 * period's last bucket and the period's first can share a key (`2026-W29`, `2025-10`): the marker names which one.
 * Null when the value is not one of these forms.
 */
export interface BucketSlice {
  kind: 'firstvisit' | 'signup' | 'trend';
  figure: TrendFigure | null;
  previous: boolean;
  key: string;
  /** The split's group of a trend point ('' for none); never on the previous period's line, which is not split. */
  group: string;
}
export function bucketSlice(value: string): BucketSlice | null {
  const parts = value.split(':');
  const kind = parts.shift();
  let figure: TrendFigure | null = null;
  if (kind === 'trend') {
    const f = parts.shift();
    if (!f || !(TREND_FIGURES as readonly string[]).includes(f)) return null;
    figure = f as TrendFigure;
  } else if (kind !== 'firstvisit' && kind !== 'signup') return null;
  const previous = parts[0] === 'prev';
  if (previous) parts.shift();
  const key = parts.shift();
  if (!key || !BUCKET_KEY.test(key)) return null;
  const group = parts.join(':');
  if (parts.length && (kind !== 'trend' || previous || !group)) return null;
  return { kind, figure, previous, key, group };
}

/** A slice from the query, checked against its dimension's values (400 VALIDATION_FAILED otherwise). */
export function parseSlice(raw: string): Slice {
  const i = raw.indexOf(':');
  const dim = (i < 0 ? raw : raw.slice(0, i)) as SliceDimension;
  const value = i < 0 ? '' : raw.slice(i + 1);
  if (!SLICE_DIMENSIONS.includes(dim)) throw badSlice(`one of ${SLICE_DIMENSIONS.join(', ')}, then its value.`);
  const one = (ok: boolean) => {
    if (!ok) throw badSlice(`not a value of ${dim}.`);
    return { dim, value };
  };
  const uuid = (v: string) => SLICE_UUID.test(v);
  switch (dim) {
    case 'all':
    case 'new':
    case 'active':
    case 'firstvisit':
    case 'scored':
    case 'wished':
    case 'heardother':
    case 'haswish':
      return one(value === '');
    case 'age':
      return one((AGE_SLICES as readonly string[]).includes(value));
    case 'country':
      return one(/^[A-Z]{2}$/.test(value) || value === 'none');
    case 'conncountry':
      return one(/^[A-Z]{2}$/.test(value) || value === 'unknown');
    case 'city':
      return one(value.length >= 1 && value.length <= 80 && value === fold(value).trim());
    case 'conncity':
      return one(/^\d{1,10}$/.test(value) || value === 'unknown');
    case 'source':
      return one((value.startsWith('channel:') && uuid(value.slice(8))) || (value.startsWith('kind:') && (SOURCE_FILTER_KINDS as readonly string[]).includes(value.slice(5))));
    case 'heard':
      return one(uuid(value) || value === 'none');
    case 'link1':
    case 'link2':
    case 'wishmodel':
    case 'wishcollection':
    case 'holds':
      return one(uuid(value));
    case 'campaign':
      return one(value.length >= 1 && value.length <= 200);
    case 'referrer':
      return one(value === 'none' || /^[a-z0-9.-]{1,253}$/.test(value));
    case 'bucket':
      return one(bucketSlice(value) !== null);
    case 'favpiece':
    case 'favfinish':
      return one(value.length >= 1 && value.length <= 64);
    case 'viewed':
      return one(uuid(value) || (value.startsWith('r:') && uuid(value.slice(2))));
    case 'device':
      return one((DEVICE_KINDS as readonly string[]).includes(value));
    case 'system':
      return one((DEVICE_SYSTEMS as readonly string[]).includes(value) || value === 'IPAD');
    case 'openedin':
      return one((OPENED_IN as readonly string[]).includes(value));
    case 'app':
      return one((IN_APPS as readonly string[]).includes(value));
    case 'score':
      return one((SCORE_SLICES as readonly string[]).includes(value) || value === 'none');
    case 'part':
      return one((ENGAGEMENT_PARTS as readonly string[]).includes(value));
    case 'status':
      return one((ENGAGEMENT_STATUSES as readonly string[]).includes(value));
    case 'cohort':
      return one(/^\d{4}-\d{2}:(all|(1|3|6|12):(active|inactive))$/.test(value));
  }
}

/** What a slice selects among the collectors `c` of a scope CTE (with `pr`, their profile): a condition, its joins, the period of the scope. */
interface SliceSql {
  cond: RawBuilder<unknown>;
  joins: RawBuilder<unknown>;
  /** The period the collectors are those of (a previous period's bucket opens the previous period's collectors). */
  period: Period;
}

const exists = (body: RawBuilder<unknown>) => sql`EXISTS (${body})`;
const openWishAt = (end: Date) => sql`w.added_at < ${end}::timestamptz AND (w.removed_at IS NULL OR w.removed_at >= ${end}::timestamptz)`;
const USUAL_PLACE = sql`LEFT JOIN LATERAL (SELECT cp.place_id FROM collector_places cp WHERE cp.account_id = c.account_id
                          ORDER BY cp.days DESC, cp.last_day DESC, cp.place_id LIMIT 1) up ON TRUE
      LEFT JOIN geo_places gp ON gp.id = up.place_id`;

/** The bucket a key names in the period, or with `previous` in the previous one only (with the period it belongs to). */
function bucketOfKey(q: InsightsQuery, key: string, previous: boolean): { bucket: Bucket; period: Period } {
  const period = previous ? (q.previous ?? previousPeriod(q.period)) : q.period;
  const bucket = periodBuckets(period).find((b) => b.key === key);
  if (bucket) return { bucket, period };
  throw badSlice(previous ? `no bucket ${key} in the period before.` : `no bucket ${key} in the period.`);
}

/**
 * The condition of the trend point `figure` × bucket (trendCells' rules, each over the collector `c`), for the
 * collectors behind it.
 */
async function trendPointSql(tx: Db, x: Reading, figure: TrendFigure, k: Bucket): Promise<RawBuilder<unknown>> {
  switch (figure) {
    case 'collectors':
      return sql`c.created_at < ${k.end}::timestamptz`;
    case 'new':
      return within(sql`c.created_at`, k);
    case 'firstvisits':
      return exists(sql`SELECT 1 FROM account_sources s WHERE s.account_id = c.account_id AND ${within(sql`s.first_seen_at`, k)}`);
    case 'active':
      return activeIn('c.account_id', k.start, k.end);
    case 'medianscore': {
      if (x.now >= k.start && x.now < k.end) return sql`c.score IS NOT NULL`;
      const span = await historySpan(tx);
      const month = `${k.to.slice(0, 7)}-01`;
      if (!lastOfMonth(k.to) || !span || month < span.first || month > span.last) return sql`FALSE`;
      return sql`c.created_at < ${k.end}::timestamptz AND ${exists(sql`SELECT 1 FROM collector_history h WHERE h.account_id = c.account_id AND h.scores[${historyIndex(sql`${month}::date`)}] IS NOT NULL`)}`;
    }
    case 'wishes':
      return exists(sql`SELECT 1 FROM account_wishes w WHERE w.account_id = c.account_id AND ${within(sql`w.added_at`, k)}`);
    case 'views': {
      const cutoff = viewHistoryCutoff(x.now);
      if (k.end <= cutoff) return sql`FALSE`;
      const start = k.start < cutoff ? cutoff : k.start;
      return exists(sql`SELECT 1 FROM collector_views v WHERE v.account_id = c.account_id AND v.page = ${VIEW_PAGE_CODES.MODEL} AND ${within(sql`v.at`, { start, end: k.end })}`);
    }
    case 'buyers':
      return exists(sql`SELECT 1 FROM orders o WHERE o.account_id = c.account_id AND ${bought('o', k)}`);
  }
}

/** The SQL of a slice (see SLICE_DIMENSIONS and §3.6 C.6.5), matching the figure that opens it. */
async function sliceSql(tx: Db, x: Reading, s: Slice): Promise<SliceSql> {
  const { q } = x;
  const P = q.period;
  const v = s.value;
  const none = sql``;
  const at = (cond: RawBuilder<unknown>, joins: RawBuilder<unknown> = none, period: Period = P): SliceSql => ({ cond, joins, period });
  switch (s.dim) {
    case 'all':
      return at(sql`TRUE`);
    case 'new':
      return at(within(sql`c.created_at`, P));
    case 'active':
      return at(activeIn('c.account_id', P.start, P.end));
    case 'firstvisit':
      return at(exists(sql`SELECT 1 FROM account_sources s WHERE s.account_id = c.account_id AND ${within(sql`s.first_seen_at`, P)}`));
    case 'scored':
    case 'part':
      return at(sql`c.score IS NOT NULL`);
    case 'wished':
      return at(exists(sql`SELECT 1 FROM account_wishes w WHERE w.account_id = c.account_id AND ${within(sql`w.added_at`, P)}`));
    case 'age':
      return at(sql`${ageBandSql(sql`pr.birth_date`, x.today)} = ${v}`);
    case 'country':
      return at(sql`coalesce(btrim(c.country), 'none') = ${v}`);
    case 'conncountry':
      return at(sql`coalesce(btrim(gp.country), 'unknown') = ${v}`, USUAL_PLACE);
    case 'conncity':
      return at(sql`(CASE WHEN gp.city IS NULL THEN 'unknown' ELSE gp.id::text END) = ${v}`, USUAL_PLACE);
    case 'city':
      return at(v === 'none' ? sql`coalesce(btrim(pr.city), '') = ''` : sql`coalesce(btrim(pr.city), '') <> '' AND orbes_fold(btrim(pr.city)) = ${v}`);
    case 'source':
      return at(sql`${firstSourceKey(await acquisitionBasis(tx))} = ${v}`, FIRST_SOURCE_JOINS);
    case 'heard':
      return at(v === 'none' ? sql`pr.heard_option_id IS NULL` : sql`pr.heard_option_id = ${v}::uuid`);
    case 'heardother':
      return at(sql`pr.heard_option_id IN (SELECT ho.id FROM heard_options ho WHERE ho.is_other)`);
    case 'link1':
      return at(exists(sql`SELECT 1 FROM account_sources s JOIN acquisition_sources k ON k.id = s.first_source_id WHERE s.account_id = c.account_id AND k.link_id = ${v}::uuid`));
    case 'link2':
      return at(
        exists(sql`SELECT 1 FROM acquisition_conversions cv JOIN acquisition_sources k ON k.id = cv.last_source_id
                    WHERE cv.account_id = c.account_id AND k.link_id = ${v}::uuid
                      AND (cv.kind = 'SIGNUP' OR (cv.kind = 'ORDER' AND EXISTS (
                             SELECT 1 FROM orders lo WHERE lo.id = cv.ref_id AND lo.paid_at IS NOT NULL AND lo.channel <> 'GIFT')))`),
      );
    case 'campaign':
      return at(
        exists(sql`SELECT 1 FROM account_sources s JOIN acquisition_sources k ON k.id = s.first_source_id AND k.kind = 'CAMPAIGN'
                    WHERE s.account_id = c.account_id AND ${v === 'none' ? sql`k.utm_campaign IS NULL` : sql`k.utm_campaign = ${v}`}`),
      );
    case 'referrer':
      return v === 'none'
        ? at(sql`${firstSourceKey(await acquisitionBasis(tx))} = 'kind:DIRECT'`, FIRST_SOURCE_JOINS)
        : at(sql`fk.kind = 'SITE' AND fk.site = ${v}`, FIRST_SOURCE_JOINS);
    case 'bucket': {
      const b = bucketSlice(v)!;
      const { bucket, period } = bucketOfKey(q, b.key, b.previous);
      if (b.kind === 'signup') return at(within(sql`c.created_at`, bucket), none, period);
      if (b.kind === 'firstvisit') return at(exists(sql`SELECT 1 FROM account_sources s WHERE s.account_id = c.account_id AND ${within(sql`s.first_seen_at`, bucket)}`), none, period);
      // trend:<figure>:[prev:]<bucket>[:<group>]: the group is of the query's split, on a bucket of the period (parseSlice
      // refuses a group on the previous period's line, which is not split).
      const figure = b.figure!;
      const point = await trendPointSql(tx, x, figure, bucket);
      const g = b.group;
      if (!g) return at(point, none, period);
      if (q.trend.split === 'none') throw badSlice('a trend group needs the split it belongs to (split).');
      if (g === 'visitor') return at(sql`FALSE`);
      const t = trendGroup(x, q.trend.split, await acquisitionBasis(tx), P);
      // The age's expression reads `pr`, which every list joins already.
      const joins = q.trend.split === 'age' ? none : t.joins;
      if (g !== 'other') return at(sql`${point} AND ${t.expr} = ${g}`, joins);
      const named = await trendNamedGroups(tx, { ...x, q: { ...q, trend: { figure, split: q.trend.split } } }, P);
      return at(named.length ? sql`${point} AND ${t.expr} NOT IN (${sql.join(named)})` : point, joins);
    }
    case 'favpiece':
    case 'favfinish': {
      const kind = s.dim === 'favpiece' ? 'PIECE' : 'FINISH';
      return v === 'none'
        ? at(sql`NOT ${exists(sql`SELECT 1 FROM account_tastes t WHERE t.account_id = c.account_id AND t.kind = ${kind}`)}`)
        : at(exists(sql`SELECT 1 FROM account_tastes t WHERE t.account_id = c.account_id AND t.kind = ${kind} AND t.value_key = ${v}`));
    }
    case 'haswish':
      return at(exists(sql`SELECT 1 FROM account_wishes w WHERE w.account_id = c.account_id AND ${openWishAt(P.end)}`));
    case 'wishmodel':
      return at(exists(sql`SELECT 1 FROM account_wishes w JOIN models m ON m.id = w.model_id WHERE w.account_id = c.account_id AND ${openWishAt(P.end)} AND (m.id = ${v}::uuid OR m.variant_of = ${v}::uuid)`));
    case 'wishcollection':
      return at(exists(sql`SELECT 1 FROM account_wishes w JOIN models m ON m.id = w.model_id WHERE w.account_id = c.account_id AND ${openWishAt(P.end)} AND m.collection_id = ${v}::uuid`));
    case 'viewed': {
      const cutoff = viewHistoryCutoff(x.now);
      if (P.end <= cutoff) return at(sql`FALSE`);
      const range = within(sql`vw.at`, { start: P.start < cutoff ? cutoff : P.start, end: P.end });
      return v.startsWith('r:')
        ? at(exists(sql`SELECT 1 FROM collector_views vw WHERE vw.account_id = c.account_id AND vw.page IN (${sql.join([VIEW_PAGE_CODES.RELEASE, VIEW_PAGE_CODES.LIVE, VIEW_PAGE_CODES.AFTER_ROOM])}) AND vw.subject = ${v.slice(2)}::uuid AND ${range}`))
        : at(exists(sql`SELECT 1 FROM collector_views vw JOIN models m ON m.id = vw.subject WHERE vw.account_id = c.account_id AND vw.page = ${VIEW_PAGE_CODES.MODEL} AND (m.id = ${v}::uuid OR m.variant_of = ${v}::uuid) AND ${range}`));
    }
    case 'holds':
      return at(
        exists(sql`SELECT 1 FROM ownership o JOIN products p ON p.id = o.product_id JOIN models m ON m.id = p.model_id
                    WHERE o.account_id = c.account_id AND o.ended_at IS NULL AND p.status NOT IN (${sql.join([...CLUB_EXCLUDED_STATUSES])})
                      AND (m.id = ${v}::uuid OR m.variant_of = ${v}::uuid)`),
      );
    case 'device':
    case 'system':
    case 'openedin':
    case 'app': {
      const rows = mainDeviceRows({ from: P.from, to: P.to }, x.now);
      if (!rows) return at(sql`FALSE`);
      const match =
        s.dim === 'device'
          ? sql`md.kind = ${v}`
          : s.dim === 'openedin'
            ? sql`md.opened_in = ${v}`
            : s.dim === 'app'
              ? sql`md.in_app = ${v}`
              : v === 'IPAD'
                ? sql`md.os = 'IOS' AND md.kind = 'TABLET'`
                : v === 'IOS'
                  ? sql`md.os = 'IOS' AND md.kind <> 'TABLET'`
                  : sql`md.os = ${v}`;
      return at(sql`c.account_id IN (SELECT md.account_id FROM (${rows}) md WHERE ${match})`);
    }
    case 'score': {
      if (v === 'none') return at(sql`c.score IS NULL`);
      const [lo, hi] = v.split('-').map(Number) as [number, number];
      return at(sql`c.score BETWEEN ${lo}::int AND ${hi}::int`);
    }
    case 'status': {
      const first = await sql<{ m: Date | null }>`WITH ${scopeCte('col', q, P)} SELECT min(created_at) AS m FROM col`.execute(tx);
      const min = first.rows[0]?.m;
      if (!min) return at(sql`FALSE`);
      return at(sql`c.created_at < ${P.end}::timestamptz AND ${statusSql(P, dayStarts(new Date(min), P.to))} = ${v}`);
    }
    case 'cohort': {
      const [month, mark, side] = v.split(':') as [string, string, string | undefined];
      const m = `${month}-01`;
      const made = sql`c.created_at >= ${parisMonthStart(month)}::timestamptz AND c.created_at < ${parisMonthStart(plusMonths(m, 1).slice(0, 7))}::timestamptz`;
      if (mark === 'all') return at(made);
      const target = plusMonths(m, Number(mark));
      const span = await historySpan(tx);
      if (!span || target > span.last) return at(sql`FALSE`);
      const active = exists(sql`SELECT 1 FROM collector_history h WHERE h.account_id = c.account_id AND h.active[${historyIndex(sql`${target}::date`)}] IS TRUE`);
      return at(side === 'active' ? sql`${made} AND ${active}` : sql`${made} AND NOT ${active}`);
    }
  }
}

/** What the slice names, in words (the list's title), when it names a thing. */
async function sliceSubject(tx: Db, s: Slice): Promise<string | null> {
  const model = async (id: string) => {
    const m = await tx.selectFrom('models').select(['name', 'variant_label']).where('id', '=', id).executeTakeFirst();
    return m ? (m.variant_label ? `${m.name} · ${m.variant_label}` : m.name) : null;
  };
  switch (s.dim) {
    case 'wishmodel':
    case 'holds':
      return model(s.value);
    case 'viewed':
      if (!s.value.startsWith('r:')) return model(s.value);
      return (await tx.selectFrom('drops').select('title').where('id', '=', s.value.slice(2)).executeTakeFirst())?.title ?? null;
    case 'wishcollection':
      return (await tx.selectFrom('collections').select('name').where('id', '=', s.value).executeTakeFirst())?.name ?? null;
    case 'link1':
    case 'link2':
      return (await tx.selectFrom('links').select('name').where('id', '=', s.value).executeTakeFirst())?.name ?? null;
    case 'heard':
      return s.value === 'none' ? null : ((await tx.selectFrom('heard_options').select('label').where('id', '=', s.value).executeTakeFirst())?.label ?? null);
    case 'conncity':
      return s.value === 'unknown' ? null : ((await tx.selectFrom('geo_places').select('city').where('id', '=', Number(s.value)).executeTakeFirst())?.city ?? null);
    case 'source':
      return s.value.startsWith('channel:') ? ((await tx.selectFrom('link_channels').select('name').where('id', '=', s.value.slice(8)).executeTakeFirst())?.name ?? null) : null;
    default:
      return null;
  }
}

/**
 * A page of the collectors behind one figure (§3.6 C.6.5): the page's collectors (the scope and the five filters, for
 * the slice's period) the slice selects, COLLECTORS_LIST_PAGE a page ordered by email for every slice, with no score.
 */
async function readList(tx: Db, x: Reading, s: Slice, page: number, withCities: boolean): Promise<{ total: number; rows: CollectorsListRow[]; subject: string | null }> {
  const sel = await sliceSql(tx, x, s);
  const members = sql`${scopeCte('col', x.q, sel.period)},
    m AS (SELECT c.account_id, c.tier FROM col c LEFT JOIN account_profiles pr ON pr.account_id = c.account_id ${sel.joins} WHERE ${sel.cond})`;
  const total = Number((await sql<{ n: number }>`WITH ${members} SELECT count(*)::int AS n FROM m`.execute(tx)).rows[0]?.n ?? 0);
  const rows = await sql<{ id: string; email: string; display_name: string | null; country: string | null; city: string | null; tier: number; created_at: Date; heard_other: string | null; last_seen: Date | null }>`
    WITH ${members}
    SELECT a.id, a.email, a.display_name, a.country, pr.city, m.tier, a.created_at, pr.heard_other,
           greatest((SELECT max(se.last_seen_at) FROM sessions se WHERE se.subject_type = 'account' AND se.subject_id = a.id),
                    (SELECT max(cv.at) FROM collector_views cv WHERE cv.account_id = a.id)) AS last_seen
      FROM m JOIN accounts a ON a.id = m.account_id LEFT JOIN account_profiles pr ON pr.account_id = a.id
     ORDER BY a.email_normalized, a.id
     LIMIT ${COLLECTORS_LIST_PAGE} OFFSET ${(page - 1) * COLLECTORS_LIST_PAGE}`.execute(tx);
  return {
    total,
    subject: await sliceSubject(tx, s),
    rows: rows.rows.map((r) => ({
      accountId: r.id,
      email: r.email,
      name: r.display_name,
      country: r.country?.trim() || null,
      city: withCities ? (r.city?.trim() || null) : null,
      tier: Number(r.tier),
      createdAt: r.created_at,
      lastSeenAt: r.last_seen ?? null,
      ...(s.dim === 'heardother' ? { heardOther: r.heard_other } : {}),
    })),
  };
}
