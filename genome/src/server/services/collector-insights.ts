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
 *             six KPIs) and `who` (Who they are: AGES, COUNTRIES and CITIES, each as given and from the connection).
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
import { HOUSE_CURRENCIES, type HouseCurrency } from '../db/schema.js';
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
  filtersKey,
  narrowsCollectors,
  parseFilters,
  parisPeriod,
  plusDays,
  previousPeriod,
  scopeCte,
  SCOPES,
  SOURCE_FILTER_KINDS,
  TIER_CHOICES,
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
export const COLLECTOR_PANELS = ['overview', 'who'] as const;
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

export type CollectorsReport = (ReportHead & { panel: 'overview'; figures: OverviewFigures }) | (ReportHead & { panel: 'who'; figures: WhoFigures });

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
    this.panels = { overview: overviewPanel, who: whoPanel, ...deps.panels };
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
 * First visits by Paris day in a period (§3.6 C.6.3): with no filter narrowing the collectors (the source alone, or
 * none), the Links reports' rule (AcquisitionReportService.firstVisits: every device first seen, anonymous included,
 * from the daily summary and the devices' first sight), the source filter applied to the device's first source; with
 * one, the devices first seen in the period that were linked to one of the collectors (never a console's device).
 */
export async function firstVisitDays(tx: Db, x: Reading, p: Period): Promise<Map<string, number>> {
  const f = x.q.filters;
  if (!narrowsCollectors(f, x.q.scope)) {
    const acquisition = new AcquisitionReportService({ db: tx, links: x.links });
    return acquisition.firstVisits({ from: p.from, to: p.to, sources: { channelIds: f.sources.channelIds, kinds: f.sources.kinds } }, 'day');
  }
  const days: string[] = [];
  for (let d = p.from; d <= p.to; d = plusDays(d, 1)) days.push(d);
  const starts = sql`ARRAY[${sql.join([...days, plusDays(p.to, 1)].map((d) => sql`${parisDayStart(d)}::timestamptz`))}]`;
  const rows = await sql<{ b: number; n: number }>`
    WITH ${scopeCte('col', x.q, p)}
    SELECT width_bucket(td.first_seen_at, ${starts}) AS b, count(*)::int AS n
      FROM tracking_devices td
     WHERE ${within(sql`td.first_seen_at`, p)} AND td.staff_at IS NULL
       AND EXISTS (SELECT 1 FROM tracking_device_accounts tda JOIN col c ON c.account_id = tda.account_id WHERE tda.device_id = td.id)
     GROUP BY 1`.execute(tx);
  const out = new Map<string, number>();
  for (const r of rows.rows) {
    const day = days[Number(r.b) - 1];
    if (day !== undefined && Number(r.n) > 0) out.set(day, Number(r.n));
  }
  return out;
}

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
