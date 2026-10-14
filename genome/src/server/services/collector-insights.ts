/**
 * The Collectors page (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6, C.9; steps 9.2 and on): CollectorInsightsService
 * (`ctx.services.collectorInsights`) reads the figures of « all the data we have » about the counted collectors, over the
 * period the page chooses, compared with the period before. It only reads: no write, no audit (the export, step 9.12,
 * is its one audited act).
 *
 *   options   GET /api/admin/collectors/options (AUDITOR): the filters' choices (the countries present, the link
 *             channels and the kinds of first source, the tiers, the collection's types), the currencies, and the
 *             earliest dates with data: `recordingSince` (the recording's start, tracking_state) and `snapshotsSince`
 *             (the monthly history, null until step 9.5 writes it).
 *   report    GET /api/admin/collectors/report?panel=… (AUDITOR): one panel's figures for the period and, with the
 *             comparison on, the previous period, read in one transaction. The panels so far: `overview` (At a glance:
 *             six KPIs), `who` (Who they are: AGES, COUNTRIES and CITIES, each as given and from the connection) and
 *             `origin` (Where they come from: SOURCES, HOW THEY HEARD, LINKS first and last, CAMPAIGNS, REFERRING
 *             SITES, FIRST VISITS; §3.4 A.10.6's block: the first source by kind and channel, the links and campaigns,
 *             the first visits over time, the collectors whose first and last link differ).
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
import { HOUSE_CURRENCIES, type HouseCurrency, type SourceKind } from '../db/schema.js';
import { DomainError, validationError } from '../errors.js';
import { ageOn } from '../../shared/profile-rules.js';
import { fold } from '../../shared/fold.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import { AcquisitionReportService } from './acquisition-report.js';
import { currenciesOf, GROWTH_MIN_GROUP, median } from './growth.js';
import {
  AGE_SLICES,
  ageBandSql,
  activeIn,
  bucketUnit,
  filtersKey,
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
  type BucketUnit,
  type InsightsFilters,
  type Period,
  type Scope,
} from './insights-scope.js';
import type { LinkService } from './links.js';
import { countedCollector } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';
import { tasteOptions } from './tastes.js';

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The panels the page reads, top to bottom (§3.6 C.6.3); the others come with their steps. */
export const COLLECTOR_PANELS = ['overview', 'who', 'origin'] as const;
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
  /** The median of the scores now, withheld under INSIGHTS_MIN_GROUP; no previous value (the scores are of this morning). */
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
  | (ReportHead & { panel: 'origin'; figures: OriginFigures });

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
  /** The monthly history's first month (null until step 9.5). */
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
    this.panels = { overview: overviewPanel, who: whoPanel, origin: originPanel, ...deps.panels };
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
        snapshotsSince: null,
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
    return {
      panel,
      period,
      previous: req.cmp === false ? null : previousPeriod(period),
      scope,
      filters: parseFilters({ c: req.c, s: req.s, t: req.t, sc: req.sc, ft: req.ft }),
      currency: currency as HouseCurrency | null,
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
  return [q.panel, q.period.key, q.period.from, q.period.to, q.previous ? 'cmp' : 'nocmp', q.scope, filtersKey(q.filters), q.currency ?? ''].join('|');
}

async function recordingSince(tx: Db): Promise<Date | null> {
  const row = await tx.selectFrom('tracking_state').select('started_at').where('id', '=', 1).executeTakeFirst();
  return row?.started_at ?? null;
}

// ── Shared readings ────────────────────────────────────────────────────────────────────────────────────────────

const within = (column: RawBuilder<unknown>, p: Pick<Period, 'start' | 'end'>) => sql`${column} >= ${p.start}::timestamptz AND ${column} < ${p.end}::timestamptz`;

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
  return {
    // ALL: the collectors whose account existed at the previous period's end; ACTIVE, NEW: the previous period's.
    collectors: { value: now.collectors, previous: before ? (q.scope === 'all' ? before.existed : before.collectors) : null },
    newCollectors: { value: now.fresh, previous: before?.fresh ?? null },
    firstVisits: { value: visitsNow, previous: visitsBefore, becameCollectors: now.became },
    active: { value: now.active, previous: before?.active ?? null },
    medianScore: { value: scored.length >= INSIGHTS_MIN_GROUP ? median(scored) : null, previous: null, scored: scored.length, scoresOn: scoresOn.rows[0]?.day ?? null },
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
async function acquisitionBasis(tx: Db): Promise<{ started: Date; before: number; direct: number }> {
  const state = await tx.selectFrom('acquisition_state').select('tracking_started_at').where('id', '=', 1).executeTakeFirst();
  const fixed = await tx.selectFrom('acquisition_sources').select(['key', 'id']).where('key', 'in', ['BEFORE', 'DIRECT']).execute();
  return {
    started: state?.tracking_started_at ?? new Date('9999-12-31T00:00:00.000Z'),
    before: fixed.find((f) => f.key === 'BEFORE')?.id ?? 0,
    direct: fixed.find((f) => f.key === 'DIRECT')?.id ?? 0,
  };
}

/** A paid order bought in the period (GROWTH's purchases: never GIFT, not CANCELLED or RETURNED). */
const bought = (o: string, p: Period) => sql`${sql.ref(`${o}.paid_at`)} IS NOT NULL AND ${sql.ref(`${o}.channel`)} <> 'GIFT' AND ${sql.ref(`${o}.status`)} NOT IN ('CANCELLED', 'RETURNED') AND ${within(sql.ref(`${o}.paid_at`), p)}`;

/** SOURCES, HOW THEY HEARD, LINKS, CAMPAIGNS, REFERRING SITES and FIRST VISITS (§3.6 C.6.3 item 3; §3.4 A.10.6). */
async function originPanel(tx: Db, x: Reading): Promise<OriginFigures> {
  const { q } = x;
  const basis = await acquisitionBasis(tx);
  const firstKey = sql`(CASE WHEN fs.account_id IS NULL THEN (CASE WHEN c.created_at < ${basis.started}::timestamptz THEN 'kind:BEFORE' ELSE 'kind:DIRECT' END)
                             WHEN fk.kind = 'LINK' THEN 'channel:' || fl.channel_id::text ELSE 'kind:' || fk.kind END)`;
  const keyed = (cte: string) => sql`
    SELECT c.created_at, v.dim, v.key
      FROM ${sql.table(cte)} c
      LEFT JOIN account_sources fs ON fs.account_id = c.account_id
      LEFT JOIN acquisition_sources fk ON fk.id = fs.first_source_id
      LEFT JOIN links fl ON fl.id = fk.link_id
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
    const buckets: FirstVisitBucket[] = periodBuckets(p).map((b) => ({ key: b.key, from: b.from, to: b.to, firstVisits: 0, newCollectors: 0 }));
    const at = (day: string) => buckets.find((b) => day >= b.from && day <= b.to);
    for (const [day, n] of days) {
      const b = at(day);
      if (b) b.firstVisits += n;
    }
    for (const r of created.rows) {
      const b = at(parisDay(new Date(r.created_at)));
      if (b) b.newCollectors += 1;
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
