/**
 * Where they come from, the console's readings (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.5, A.7.1, A.10, step
 * 4.6): AcquisitionReportService (`ctx.services.acquisitionReport`) only reads, each reading in one REPEATABLE READ,
 * READ ONLY transaction like GROWTH, no cache, no snapshot table.
 *
 *   report      GET /api/admin/links (AUDITOR): for a period of Paris days (or all time), each source's figures, twice
 *               side by side: Visits and First visits once (a visit is not attributed), then Sign-ups, Entries,
 *               Purchases and Revenue as the FIRST LINK (discovery: the collector's first source) and as the LAST LINK
 *               (conversion: the source each act's conversion names). Three views: LINKS (the links grouped by channel
 *               in the channels' order, the newest link first, each channel the sum of its links, archived ones
 *               included in the sums and listed only when asked; each link's cost and its RETURN, SINCE MADE), CAMPAIGN TAGS (one row per
 *               source / medium / campaign, its content and term variants summed in, grouped by utm_source) and
 *               REFERRING SITES (one row per site, the most visits first). Then the lines without one (Campaign tags,
 *               Referring sites, Links, Direct, Before tracking, Console device, those the view does not list) and the
 *               TOTAL: every sign-up, entry, purchase and revenue of the period of counted collectors, which the rows
 *               and the lines add up to on every view.
 *   link        GET /api/admin/links/:id (AUDITOR): one link, its figures, its days and its return.
 *   collectors  GET /api/admin/acquisition/collectors (AUDITOR): the collectors behind a figure, ACQUISITION_COLLECTORS_PAGE
 *               a page, the newest sign-up first, each with its entries, purchases and revenue in the period under that
 *               attribution and source (emails as stored: the route masks them for an AUDITOR).
 *   overview    the Collectors page's « Where they come from » block (§3.4 A.10.6; the page is phase 9's): sign-ups by
 *               first source kind and channel, the top links and campaigns by first-link sign-ups, first visits by
 *               Paris day, the collectors whose first and last link differ.
 *   sourceFilter  the SQL condition « the account's first source is in these channels, links or kinds », exported for the
 *               Collectors page's other queries and Segments' FIRST_SOURCE.
 *
 * The rules (§3.4 A.5, §3.0 (d)):
 *   - Who is counted: `countedCollector` (services/population.ts): no test entrant, no team account, no DELETED account,
 *     in every figure, the TOTAL included (GROWTH keeps DELETED accounts; the Links page says so).
 *   - A collector's first source is its `account_sources` row; without one, Before tracking when the account was made
 *     before the recording started, else Direct (its sign-up's safety net is the conversions job's, within minutes).
 *   - An act's last link is its conversion's; without one, Before tracking when its row was written before the
 *     recording started, else Direct (the job writes it within minutes). An order's written time is its reservation.
 *   - Entries are draw entries and LIVE RELEASE entries made in the period, whatever became of them. Purchases are
 *     GROWTH's: orders paid in the period, never GIFT, not CANCELLED or RETURNED. Revenue is GROWTH's: every invoice
 *     less every credit note issued in the period, of the collector's orders (supplementary invoices and line credit
 *     notes included), in one currency (by default the most invoiced, growth.ts currenciesOf), never converted.
 *   - Visits come from `acquisition_daily` for the days summarised and from `acquisition_touches` and the devices'
 *     first sight for the days after (never both for one day). First visits count a device on the Paris day it was
 *     first seen, by its first source, Direct included.
 *   - RETURN, SINCE MADE: the link's revenue since it was made, whatever the period, in its cost's currency, divided by
 *     its cost; each attribution its own.
 *
 * Every Paris bound is computed in JavaScript (services/schedule.ts) and passed to SQL as a timestamptz or a date
 * (§3.0 (e)). Nothing is audited: these are readings.
 */
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { Db } from '../db/connection.js';
import type { HouseCurrency, SourceKind } from '../db/schema.js';
import { validationError } from '../errors.js';
import { currenciesOf } from './growth.js';
import type { LinkService, LinkView } from './links.js';
import { countedCollector } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';
import { nextParisDay } from './tracking.js';

/** A period's days apart at most (to − from). */
export const REPORT_MAX_DAYS = 800;
/** The collectors behind a figure, a page. */
export const ACQUISITION_COLLECTORS_PAGE = 25;
/** The overview's top links and campaigns. */
export const OVERVIEW_TOP = 10;
/** Source ids a `source:` click-through names at most. */
export const SOURCE_IDS_MAX = 200;

export const REPORT_VIEWS = ['links', 'campaigns', 'sites'] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];
export const ATTRIBUTIONS = ['first', 'last'] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];
export const MEASURES = ['signups', 'entries', 'purchases', 'revenue'] as const;
export type Measure = (typeof MEASURES)[number];

/** A period of Paris days, both or neither (all time). */
export interface PeriodInput {
  from?: string | null;
  to?: string | null;
}

/** What a source brought in, under one attribution. */
export interface Results {
  signups: number;
  entries: number;
  purchases: number;
  revenueMinor: number;
}

/** A row's figures: visits once, then both attributions side by side. */
export interface Figures {
  visits: number;
  firstVisits: number;
  first: Results;
  last: Results;
}

/** A RETURN, SINCE MADE: revenue in the cost's currency since the link was made, divided by its cost. */
export interface LinkReturn {
  revenueMinor: number;
  costMinor: number;
  currency: HouseCurrency;
  /** Revenue ÷ cost, two decimals; null for a cost of 0. */
  ratio: number | null;
}

export interface LinkRow {
  link: LinkView;
  sourceId: number | null;
  figures: Figures;
  /** Null without a cost. */
  returns: { first: LinkReturn; last: LinkReturn } | null;
}

export interface ChannelGroup {
  channel: { id: string; name: string; position: number };
  /** The sum of its links, archived ones included. */
  figures: Figures;
  /** Its links' costs in the currency shown (null: none). */
  cost: { minor: number; currency: HouseCurrency } | null;
  /** Summed over its links with a cost in the currency shown. */
  returns: { first: LinkReturn; last: LinkReturn } | null;
  /** Its links, the archived ones only when asked. */
  links: LinkRow[];
}

export interface CampaignRow {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** Its sources (one per content and term), for the click-through (`source:<id>,<id>…`). */
  sourceIds: number[];
  /** How many content/term variants it sums. */
  variants: number;
  /** The one variant's content and term (null when several or none). */
  content: string | null;
  term: string | null;
  figures: Figures;
}

export interface CampaignGroup {
  utmSource: string | null;
  figures: Figures;
  rows: CampaignRow[];
}

export interface SiteRow {
  site: string;
  sourceId: number;
  figures: Figures;
}

/** A line without a link, a tag or a site: its kind, the sum of its sources. */
export interface SourceLine {
  kind: SourceKind;
  figures: Figures;
}

export interface AcquisitionReport {
  view: ReportView;
  period: { from: string | null; to: string | null };
  currency: HouseCurrency;
  currencies: HouseCurrency[];
  archived: boolean;
  /** The recording's start: before it, Before tracking. */
  trackingStartedAt: Date | null;
  channels: ChannelGroup[];
  campaigns: CampaignGroup[];
  sites: SiteRow[];
  without: SourceLine[];
  total: Figures;
}

export interface LinkDay {
  day: string;
  visits: number;
  firstVisits: number;
  signupsFirst: number;
  signupsLast: number;
}

export interface LinkReport {
  link: LinkView;
  /** Its release is cancelled or gone, or its model inactive: the address opens the list instead. */
  destinationGone: boolean;
  period: { from: string | null; to: string | null };
  currency: HouseCurrency;
  currencies: HouseCurrency[];
  figures: Figures;
  returns: { first: LinkReturn; last: LinkReturn } | null;
  days: LinkDay[];
}

/** Which sources a figure names (the click-through's `source`). */
export type SourceSpec = { total: true } | { link: string } | { channel: string } | { sources: number[] } | { kind: SourceKind };

export interface CollectorsQuery extends PeriodInput {
  source: SourceSpec;
  attribution: Attribution;
  measure: Measure;
  currency?: HouseCurrency;
  page?: number;
}

export interface FigureCollector {
  accountId: string;
  /** As stored: the route masks it for an AUDITOR. */
  email: string;
  country: string | null;
  signedUpAt: Date;
  entries: number;
  purchases: number;
  revenueMinor: number;
}

export interface FigureCollectors {
  items: FigureCollector[];
  total: number;
  page: number;
  pageSize: number;
  currency: HouseCurrency;
}

/** « The account's first source is in these channels, links or kinds » (Segments' FIRST_SOURCE shape). */
export interface SourceFilter {
  channelIds?: readonly string[];
  linkIds?: readonly string[];
  kinds?: readonly SourceKind[];
}

export interface AcquisitionOverview {
  period: { from: string | null; to: string | null };
  /** Sign-ups in the period by first source: a kind, a LINK split by its channel. */
  signupsByFirst: { kind: SourceKind; channel: { id: string; name: string } | null; collectors: number }[];
  topLinks: { link: { id: string; name: string; code: string; channel: { id: string; name: string } }; signups: number }[];
  topCampaigns: { source: string | null; medium: string | null; campaign: string | null; signups: number }[];
  /** First visits by Paris day, the days with any. */
  firstVisits: { day: string; n: number }[];
  /** Sign-ups in the period, and those whose first and last link differ. */
  firstLastDiffer: { collectors: number; differ: number };
}

// ── The pure parts ───────────────────────────────────────────────────────────────────────────────────────────────

const zeroResults = (): Results => ({ signups: 0, entries: 0, purchases: 0, revenueMinor: 0 });
export const zeroFigures = (): Figures => ({ visits: 0, firstVisits: 0, first: zeroResults(), last: zeroResults() });

/** `a` + `b`, a new object. */
export function addFigures(a: Figures, b: Figures): Figures {
  const add = (x: Results, y: Results): Results => ({ signups: x.signups + y.signups, entries: x.entries + y.entries, purchases: x.purchases + y.purchases, revenueMinor: x.revenueMinor + y.revenueMinor });
  return { visits: a.visits + b.visits, firstVisits: a.firstVisits + b.firstVisits, first: add(a.first, b.first), last: add(a.last, b.last) };
}

const sumFigures = (list: readonly Figures[]): Figures => list.reduce(addFigures, zeroFigures());
const ratio = (revenue: number, cost: number): number | null => (cost > 0 ? Math.round((revenue / cost) * 100) / 100 : null);

/**
 * The click-through's `source` (§3.4 A.7.2): `total`, `link:<uuid>`, `channel:<uuid>`, `source:<id>[,<id>…]` (a campaign
 * row names its content and term variants), `kind:<LINK|CAMPAIGN|SITE|DIRECT|BEFORE|STAFF>`. 400 VALIDATION_FAILED.
 */
export function parseSourceSpec(raw: string): SourceSpec {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const v = raw.trim();
  if (v === 'total') return { total: true };
  const [head, rest = ''] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
  if (head === 'link' && UUID.test(rest)) return { link: rest.toLowerCase() };
  if (head === 'channel' && UUID.test(rest)) return { channel: rest.toLowerCase() };
  if (head === 'kind' && (['LINK', 'CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'] as const).includes(rest as SourceKind)) return { kind: rest as SourceKind };
  if (head === 'source' && /^\d{1,10}(,\d{1,10})*$/.test(rest)) {
    const ids = [...new Set(rest.split(',').map(Number))];
    if (ids.length <= SOURCE_IDS_MAX && ids.every((n) => n >= 1 && n <= 2_147_483_647)) return { sources: ids };
  }
  throw validationError('source: total, link:<id>, channel:<id>, source:<number>[,<number>…] or kind:<LINK|CAMPAIGN|SITE|DIRECT|BEFORE|STAFF>.');
}

/** The period's bounds: its Paris days and their instants (null: all time). Both or neither, `to` not before `from`. */
export function periodOf(p: PeriodInput): { from: string | null; to: string | null; start: Date | null; end: Date | null } {
  const from = p.from ?? null;
  const to = p.to ?? null;
  if ((from === null) !== (to === null)) throw validationError('Give both from and to, or neither.');
  if (from === null || to === null) return { from: null, to: null, start: null, end: null };
  if (to < from) throw validationError('to must not be before from.');
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > REPORT_MAX_DAYS) throw validationError(`The period is at most ${REPORT_MAX_DAYS} days.`);
  return { from, to, start: parisDayStart(from), end: parisDayStart(nextParisDay(to)) };
}

// ── SQL ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An instant inside the period, or no bound. */
const inPeriod = (column: RawBuilder<unknown>, start: Date | null, end: Date | null) =>
  sql`${start ? sql`${column} >= ${start}::timestamptz` : sql`TRUE`} AND ${end ? sql`${column} < ${end}::timestamptz` : sql`TRUE`}`;

interface Basis {
  /** The recording's start (far in the future when it has none: everything is Before tracking). */
  started: Date;
  before: number;
  direct: number;
}

/** A reading's basis: the fallbacks, the recording's start as recorded, the last Paris day summarised. */
interface ReportBasis extends Basis {
  recorded: Date | null;
  dailyUntil: string | null;
}

/** The Before tracking / Direct fallback of a row written at `at` with no conversion. */
const fallback = (b: Basis, at: RawBuilder<unknown>) => sql`(CASE WHEN ${at} < ${b.started}::timestamptz THEN ${b.before}::integer ELSE ${b.direct}::integer END)`;

/**
 * The counted collectors with their first source (`fs`), then every act of the period as one row (`facts`): its
 * measure, its account, its first and last source, a count and an amount.
 */
function factsWith(b: Basis, start: Date | null, end: Date | null, currency: HouseCurrency): RawBuilder<unknown> {
  return sql`
    fs AS (
      SELECT a.id AS account_id, a.email, a.country, a.created_at, coalesce(s.first_source_id, ${fallback(b, sql`a.created_at`)}) AS src
        FROM accounts a LEFT JOIN account_sources s ON s.account_id = a.id
       WHERE ${countedCollector('a.id')}),
    facts AS (
      SELECT 'signups'::text AS measure, fs.account_id, fs.src AS first_src, coalesce(c.last_source_id, ${fallback(b, sql`fs.created_at`)}) AS last_src, 1 AS n, 0::bigint AS amount
        FROM fs LEFT JOIN acquisition_conversions c ON c.kind = 'SIGNUP' AND c.ref_id = fs.account_id
       WHERE ${inPeriod(sql`fs.created_at`, start, end)}
      UNION ALL
      SELECT 'entries', e.account_id, fs.src, coalesce(c.last_source_id, ${fallback(b, sql`e.created_at`)}), 1, 0::bigint
        FROM drop_entries e JOIN fs ON fs.account_id = e.account_id
        LEFT JOIN acquisition_conversions c ON c.kind = 'DRAW_ENTRY' AND c.ref_id = e.id
       WHERE ${inPeriod(sql`e.created_at`, start, end)}
      UNION ALL
      SELECT 'entries', e.account_id, fs.src, coalesce(c.last_source_id, ${fallback(b, sql`e.joined_at`)}), 1, 0::bigint
        FROM live_entries e JOIN fs ON fs.account_id = e.account_id
        LEFT JOIN acquisition_conversions c ON c.kind = 'LIVE_ENTRY' AND c.ref_id = e.id
       WHERE ${inPeriod(sql`e.joined_at`, start, end)}
      UNION ALL
      SELECT 'purchases', o.account_id, fs.src, coalesce(c.last_source_id, ${fallback(b, sql`o.reserved_at`)}), 1, 0::bigint
        FROM orders o JOIN fs ON fs.account_id = o.account_id
        LEFT JOIN acquisition_conversions c ON c.kind = 'ORDER' AND c.ref_id = o.id
       WHERE o.paid_at IS NOT NULL AND o.channel <> 'GIFT' AND o.status NOT IN ('CANCELLED', 'RETURNED') AND ${inPeriod(sql`o.paid_at`, start, end)}
      UNION ALL
      SELECT 'revenue', o.account_id, fs.src, coalesce(c.last_source_id, ${fallback(b, sql`o.reserved_at`)}), 0,
             (CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END)::bigint
        FROM invoices i JOIN orders o ON o.id = i.order_id JOIN fs ON fs.account_id = o.account_id
        LEFT JOIN acquisition_conversions c ON c.kind = 'ORDER' AND c.ref_id = o.id
       WHERE i.currency = ${currency} AND ${inPeriod(sql`i.issued_at`, start, end)})`;
}

/** The sources a SourceSpec names, as a condition on the source id in `column`. */
function specCondition(spec: SourceSpec, column: RawBuilder<unknown>): RawBuilder<SqlBool> {
  if ('total' in spec) return sql<SqlBool>`TRUE`;
  if ('sources' in spec) return sql<SqlBool>`${column} IN (${sql.join(spec.sources.map((id) => sql`${id}::integer`))})`;
  if ('link' in spec) return sql<SqlBool>`${column} IN (SELECT id FROM acquisition_sources WHERE link_id = ${spec.link}::uuid)`;
  if ('channel' in spec) return sql<SqlBool>`${column} IN (SELECT s.id FROM acquisition_sources s JOIN links l ON l.id = s.link_id WHERE l.channel_id = ${spec.channel}::uuid)`;
  return sql<SqlBool>`${column} IN (SELECT id FROM acquisition_sources WHERE kind = ${spec.kind})`;
}

/**
 * The account in `accountColumn` came first through one of these channels, links or kinds (§3.4 A.10.6, §3.6 C.6.2):
 * its `account_sources` row, else Before tracking for an account made before the recording started (or with no
 * recording), else Direct. A filter naming nothing matches every account.
 */
export function sourceFilter(accountColumn: string, f: SourceFilter): RawBuilder<SqlBool> {
  const channels = [...(f.channelIds ?? [])];
  const links = [...(f.linkIds ?? [])];
  const kinds = [...(f.kinds ?? [])];
  if (channels.length + links.length + kinds.length === 0) return sql<SqlBool>`TRUE`;
  const any: RawBuilder<SqlBool>[] = [];
  if (kinds.length) any.push(sql<SqlBool>`sfk.kind IN (${sql.join(kinds)})`);
  if (channels.length) any.push(sql<SqlBool>`sfl.channel_id IN (${sql.join(channels.map((c) => sql`${c}::uuid`))})`);
  if (links.length) any.push(sql<SqlBool>`sfk.link_id IN (${sql.join(links.map((l) => sql`${l}::uuid`))})`);
  return sql<SqlBool>`EXISTS (
    SELECT 1 FROM accounts sfa
      LEFT JOIN account_sources sfs ON sfs.account_id = sfa.id
      JOIN acquisition_sources sfk ON sfk.id = coalesce(sfs.first_source_id, (
        SELECT sfx.id FROM acquisition_sources sfx
         WHERE sfx.key = CASE WHEN EXISTS (SELECT 1 FROM acquisition_state sfst WHERE sfst.id = 1 AND sfst.tracking_started_at <= sfa.created_at)
                              THEN 'DIRECT' ELSE 'BEFORE' END))
      LEFT JOIN links sfl ON sfl.id = sfk.link_id
     WHERE sfa.id = ${sql.ref(accountColumn)} AND (${sql.join(any, sql` OR `)}))`;
}

interface SourceMeta {
  id: number;
  kind: SourceKind;
  link_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  site: string | null;
}

export interface AcquisitionReportServiceDeps {
  db: Db;
  links: Pick<LinkService, 'list' | 'get' | 'channels'>;
}

export class AcquisitionReportService {
  private readonly db: Db;
  private readonly links: Pick<LinkService, 'list' | 'get' | 'channels'>;

  constructor(deps: AcquisitionReportServiceDeps) {
    this.db = deps.db;
    this.links = deps.links;
  }

  /** The report of a view (see the file header). 400 VALIDATION_FAILED for a bad period, view or currency. */
  async report(q: PeriodInput & { currency?: HouseCurrency; view?: ReportView; archived?: boolean } = {}): Promise<AcquisitionReport> {
    const p = periodOf(q);
    const view = q.view ?? 'links';
    if (!REPORT_VIEWS.includes(view)) throw validationError(`view: ${REPORT_VIEWS.join(', ')}.`);
    return this.readOnly(async (tx) => {
      const { currency, currencies } = await currenciesOf(tx, q.currency);
      const basis = await this.basis(tx);
      const sources = await this.sources(tx);
      const figures = await this.figuresBySource(tx, basis, p, currency);
      const of = (id: number | null | undefined) => (id === null || id === undefined ? zeroFigures() : (figures.get(id) ?? zeroFigures()));
      const kindSum = (kind: SourceKind) => sumFigures(sources.filter((s) => s.kind === kind).map((s) => of(s.id)));
      const total = sumFigures([...figures.values()]);
      const report: AcquisitionReport = {
        view,
        period: { from: p.from, to: p.to },
        currency,
        currencies,
        archived: q.archived ?? false,
        trackingStartedAt: basis.recorded,
        channels: [],
        campaigns: [],
        sites: [],
        without: [],
        total,
      };
      const lines = (kinds: SourceKind[]) => kinds.map((kind) => ({ kind, figures: kindSum(kind) }));
      if (view === 'links') {
        report.channels = await this.channelGroups(tx, sources, of, currency, q.archived ?? false);
        report.without = lines(['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF']);
      } else if (view === 'campaigns') {
        report.campaigns = campaignGroups(sources, of);
        report.without = lines(['LINK', 'SITE', 'DIRECT', 'BEFORE', 'STAFF']);
      } else {
        report.sites = sources
          .filter((s) => s.kind === 'SITE')
          .map((s) => ({ site: s.site!, sourceId: s.id, figures: of(s.id) }))
          .filter((r) => !isZero(r.figures))
          .sort((a, b) => b.figures.visits - a.figures.visits || a.site.localeCompare(b.site));
        report.without = lines(['LINK', 'CAMPAIGN', 'DIRECT', 'BEFORE', 'STAFF']);
      }
      return report;
    });
  }

  /** One link's figures, days and return (see the file header). 404 LINK_NOT_FOUND. */
  async link(id: string, q: PeriodInput & { currency?: HouseCurrency } = {}): Promise<LinkReport> {
    const p = periodOf(q);
    return this.readOnly(async (tx) => {
      const link = await this.links.get(id, tx);
      const { currency, currencies } = await currenciesOf(tx, q.currency);
      const basis = await this.basis(tx);
      const source = await tx.selectFrom('acquisition_sources').select('id').where('link_id', '=', link.id).executeTakeFirst();
      const figures = source ? ((await this.figuresBySource(tx, basis, p, currency, source.id)).get(source.id) ?? zeroFigures()) : zeroFigures();
      const returns = link.cost && source ? ((await this.returns(tx, link.id)).get(link.id) ?? null) : null;
      const gone =
        link.destination === 'RELEASE'
          ? !(await tx.selectFrom('drops').select('id').where('id', '=', link.dropId!).where('cancelled_at', 'is', null).executeTakeFirst())
          : link.destination === 'MODEL'
            ? !(await tx.selectFrom('models').select('id').where('id', '=', link.modelId!).where('active', '=', true).executeTakeFirst())
            : false;
      return {
        link,
        destinationGone: gone,
        period: { from: p.from, to: p.to },
        currency,
        currencies,
        figures,
        returns: returns ?? (link.cost ? zeroReturns(link.cost) : null),
        days: source ? await this.days(tx, basis, p, source.id) : [],
      };
    });
  }

  /** The collectors behind a figure (see the file header). */
  async collectors(q: CollectorsQuery): Promise<FigureCollectors> {
    const p = periodOf(q);
    if (!ATTRIBUTIONS.includes(q.attribution)) throw validationError(`attribution: ${ATTRIBUTIONS.join(', ')}.`);
    if (!MEASURES.includes(q.measure)) throw validationError(`measure: ${MEASURES.join(', ')}.`);
    const page = Math.max(1, Math.floor(q.page ?? 1));
    return this.readOnly(async (tx) => {
      const { currency } = await currenciesOf(tx, q.currency);
      const basis = await this.basis(tx);
      const col = q.attribution === 'first' ? sql`f.first_src` : sql`f.last_src`;
      const rows = await sql<{ account_id: string; email: string; country: string | null; created_at: Date; entries: number; purchases: number; revenue: number; total: number }>`
        WITH ${factsWith(basis, p.start, p.end, currency)},
        mine AS (SELECT f.* FROM facts f WHERE ${specCondition(q.source, col)}),
        per AS (
          SELECT m.account_id,
                 (count(*) FILTER (WHERE m.measure = 'entries'))::int AS entries,
                 (count(*) FILTER (WHERE m.measure = 'purchases'))::int AS purchases,
                 coalesce(sum(m.amount) FILTER (WHERE m.measure = 'revenue'), 0)::bigint AS revenue
            FROM mine m GROUP BY m.account_id
          HAVING count(*) FILTER (WHERE m.measure = ${q.measure}) > 0)
        SELECT per.*, fs.email, fs.country, fs.created_at, (count(*) OVER ())::int AS total
          FROM per JOIN fs ON fs.account_id = per.account_id
         ORDER BY fs.created_at DESC, per.account_id DESC
         LIMIT ${ACQUISITION_COLLECTORS_PAGE} OFFSET ${(page - 1) * ACQUISITION_COLLECTORS_PAGE}`.execute(tx);
      let total = Number(rows.rows[0]?.total ?? 0);
      if (rows.rows.length === 0 && page > 1) {
        const n = await sql<{ n: number }>`
          WITH ${factsWith(basis, p.start, p.end, currency)}
          SELECT count(DISTINCT f.account_id)::int AS n FROM facts f WHERE f.measure = ${q.measure} AND ${specCondition(q.source, col)}`.execute(tx);
        total = Number(n.rows[0]?.n ?? 0);
      }
      return {
        items: rows.rows.map((r) => ({
          accountId: r.account_id,
          email: r.email,
          country: r.country,
          signedUpAt: new Date(r.created_at),
          entries: Number(r.entries),
          purchases: Number(r.purchases),
          revenueMinor: Number(r.revenue),
        })),
        total,
        page,
        pageSize: ACQUISITION_COLLECTORS_PAGE,
        currency,
      };
    });
  }

  /** The Collectors page's « Where they come from » block (see the file header). */
  async overview(q: PeriodInput & { filters?: { sources?: SourceFilter } } = {}): Promise<AcquisitionOverview> {
    const p = periodOf(q);
    const filter = q.filters?.sources ?? {};
    return this.readOnly(async (tx) => {
      const basis = await this.basis(tx);
      const signups = await sql<{ account_id: string; first_src: number; last_src: number }>`
        WITH ${factsWith(basis, p.start, p.end, 'EUR')}
        SELECT f.account_id, f.first_src, f.last_src FROM facts f WHERE f.measure = 'signups' AND ${sourceFilter('f.account_id', filter)}`.execute(tx);
      const sources = new Map((await this.sources(tx)).map((s) => [s.id, s]));
      const links = new Map((await this.links.list({ archived: true }, tx)).map((l) => [l.id, l]));
      const byKind = new Map<string, AcquisitionOverview['signupsByFirst'][number]>();
      const byLink = new Map<string, number>();
      const byCampaign = new Map<string, AcquisitionOverview['topCampaigns'][number]>();
      let differ = 0;
      for (const r of signups.rows) {
        const s = sources.get(Number(r.first_src));
        if (!s) continue;
        if (Number(r.first_src) !== Number(r.last_src)) differ += 1;
        const link = s.link_id ? links.get(s.link_id) : undefined;
        const key = link ? `LINK:${link.channel.id}` : s.kind;
        const row = byKind.get(key) ?? { kind: s.kind, channel: link ? link.channel : null, collectors: 0 };
        row.collectors += 1;
        byKind.set(key, row);
        if (link) byLink.set(link.id, (byLink.get(link.id) ?? 0) + 1);
        if (s.kind === 'CAMPAIGN') {
          const ck = [s.utm_source, s.utm_medium, s.utm_campaign].join('\u001f');
          const c = byCampaign.get(ck) ?? { source: s.utm_source, medium: s.utm_medium, campaign: s.utm_campaign, signups: 0 };
          c.signups += 1;
          byCampaign.set(ck, c);
        }
      }
      const filtered = await this.filteredSourceIds(tx, filter);
      const visits = await this.visitsBy(tx, basis, p, filtered, 'day');
      return {
        period: { from: p.from, to: p.to },
        signupsByFirst: [...byKind.values()].sort((a, b) => b.collectors - a.collectors || a.kind.localeCompare(b.kind)),
        topLinks: [...byLink.entries()]
          .map(([id, n]) => ({ link: { id, name: links.get(id)!.name, code: links.get(id)!.code, channel: links.get(id)!.channel }, signups: n }))
          .sort((a, b) => b.signups - a.signups || a.link.name.localeCompare(b.link.name))
          .slice(0, OVERVIEW_TOP),
        topCampaigns: [...byCampaign.values()].sort((a, b) => b.signups - a.signups || String(a.campaign).localeCompare(String(b.campaign))).slice(0, OVERVIEW_TOP),
        firstVisits: [...visits.values()]
          .filter((v) => v.firstVisits > 0)
          .map((v) => ({ day: v.key, n: v.firstVisits }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        firstLastDiffer: { collectors: signups.rows.length, differ },
      };
    });
  }

  // ── Readings ─────────────────────────────────────────────────────────────

  /** The recording's start and the BEFORE and DIRECT sources. */
  private async basis(tx: Db): Promise<ReportBasis> {
    const state = await tx.selectFrom('acquisition_state').select(['tracking_started_at', 'daily_until']).where('id', '=', 1).executeTakeFirst();
    const fixed = await tx.selectFrom('acquisition_sources').select(['key', 'id']).where('key', 'in', ['BEFORE', 'DIRECT']).execute();
    const id = (k: string) => fixed.find((f) => f.key === k)?.id ?? 0;
    return {
      started: state?.tracking_started_at ?? new Date('9999-12-31T00:00:00.000Z'),
      recorded: state?.tracking_started_at ?? null,
      dailyUntil: state?.daily_until ?? null,
      before: id('BEFORE'),
      direct: id('DIRECT'),
    };
  }

  private async sources(tx: Db): Promise<SourceMeta[]> {
    return tx
      .selectFrom('acquisition_sources')
      .select(['id', 'kind', 'link_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'site'])
      .orderBy('id')
      .execute();
  }

  /** The period's figures by source (only `only` when given). */
  private async figuresBySource(tx: Db, basis: ReportBasis, p: ReturnType<typeof periodOf>, currency: HouseCurrency, only?: number): Promise<Map<number, Figures>> {
    const out = new Map<number, Figures>();
    const get = (id: number) => {
      let f = out.get(id);
      if (!f) out.set(id, (f = zeroFigures()));
      return f;
    };
    const ids = only === undefined ? null : [only];
    for (const v of (await this.visitsBy(tx, basis, p, ids, 'source')).values()) {
      const f = get(Number(v.key));
      f.visits += v.visits;
      f.firstVisits += v.firstVisits;
    }
    const restrict = only === undefined ? sql`` : sql`WHERE first_src = ${only}::integer OR last_src = ${only}::integer`;
    // Both attributions in one pass over the facts (grouping sets): the facts are never written out to be read twice.
    const rows = await sql<{ measure: Measure; attribution: Attribution; source_id: number; n: number; amount: number }>`
      WITH ${factsWith(basis, p.start, p.end, currency)}
      SELECT measure, CASE WHEN GROUPING(first_src) = 0 THEN 'first' ELSE 'last' END AS attribution,
             coalesce(first_src, last_src) AS source_id, sum(n)::int AS n, sum(amount)::bigint AS amount
        FROM facts ${restrict}
       GROUP BY GROUPING SETS ((measure, first_src), (measure, last_src))`.execute(tx);
    for (const r of rows.rows) {
      const id = Number(r.source_id);
      if (only !== undefined && id !== only) continue;
      const results = get(id)[r.attribution];
      if (r.measure === 'revenue') results.revenueMinor += Number(r.amount);
      else results[r.measure] += Number(r.n);
    }
    return out;
  }

  /**
   * Visits and first visits, by source or by Paris day: `acquisition_daily` for the days summarised, then the visits and
   * the devices' first sight for the days after (never both for one day). `ids` narrows the sources (null: all).
   */
  private async visitsBy(
    tx: Db,
    basis: ReportBasis,
    p: ReturnType<typeof periodOf>,
    ids: readonly number[] | null,
    by: 'source' | 'day',
  ): Promise<Map<string, { key: string; visits: number; firstVisits: number }>> {
    const out = new Map<string, { key: string; visits: number; firstVisits: number }>();
    if (ids !== null && ids.length === 0) return out;
    const these = (column: RawBuilder<unknown>) => (ids === null ? sql`TRUE` : sql`${column} IN (${sql.join(ids.map((i) => sql`${i}::integer`))})`);
    const dayFrom = p.from ? sql`AND day >= ${p.from}::date` : sql``;
    const dayTo = p.to ? sql`AND day <= ${p.to}::date` : sql``;
    const until = basis.dailyUntil;
    // The devices first seen on the days not summarised yet: from the day after the last summarised (or the recording's
    // first day), within the period.
    const firstDay = until ? nextParisDay(until) : basis.recorded ? parisDay(basis.recorded) : null;
    const lower = [firstDay ? parisDayStart(firstDay) : null, p.start].filter((d): d is Date => d !== null).reduce<Date | null>((a, d) => (a === null || d > a ? d : a), null);
    const deviceRows = firstDay
      ? sql`
        SELECT first_source_id AS source_id, NULL::date AS day, 0 AS visits, 1 AS first_visits, first_seen_at AS seen
          FROM tracking_devices
         WHERE first_source_id IS NOT NULL AND ${these(sql`first_source_id`)}
           ${lower ? sql`AND first_seen_at >= ${lower}::timestamptz` : sql``} ${p.end ? sql`AND first_seen_at < ${p.end}::timestamptz` : sql``}`
      : sql`SELECT NULL::integer AS source_id, NULL::date AS day, 0 AS visits, 0 AS first_visits, NULL::timestamptz AS seen WHERE FALSE`;
    const parts = sql`
      SELECT source_id, day, visits, first_visits, NULL::timestamptz AS seen FROM acquisition_daily
       WHERE ${until ? sql`day <= ${until}::date` : sql`FALSE`} ${dayFrom} ${dayTo} AND ${these(sql`source_id`)}
      UNION ALL
      SELECT source_id, day, count(*)::int, 0, NULL::timestamptz FROM acquisition_touches
       WHERE ${until ? sql`day > ${until}::date` : sql`TRUE`} ${dayFrom} ${dayTo} AND ${these(sql`source_id`)}
       GROUP BY source_id, day
      UNION ALL
      ${deviceRows}`;
    // By source, added up in the database: one row a source, never a row a source and day (13 months of days).
    const rows = await sql<{ source_id: number; day: string | null; visits: number; first_visits: number; seen: Date | null }>`${
      by === 'source'
        ? sql`SELECT u.source_id, NULL::date AS day, sum(u.visits)::int AS visits, sum(u.first_visits)::int AS first_visits, NULL::timestamptz AS seen
                FROM (${parts}) u GROUP BY u.source_id`
        : parts
    }`.execute(tx);
    for (const r of rows.rows) {
      const key = by === 'source' ? String(r.source_id) : (r.day ?? parisDay(new Date(r.seen!)));
      const e = out.get(key) ?? { key, visits: 0, firstVisits: 0 };
      e.visits += Number(r.visits);
      e.firstVisits += Number(r.first_visits);
      out.set(key, e);
    }
    return out;
  }

  /** The source ids a filter names (null: every source). */
  private async filteredSourceIds(tx: Db, f: SourceFilter): Promise<number[] | null> {
    const channels = [...(f.channelIds ?? [])];
    const links = [...(f.linkIds ?? [])];
    const kinds = [...(f.kinds ?? [])];
    if (channels.length + links.length + kinds.length === 0) return null;
    const rows = await tx
      .selectFrom('acquisition_sources as s')
      .leftJoin('links as l', 'l.id', 's.link_id')
      .select('s.id')
      .where((eb) =>
        eb.or([
          ...(kinds.length ? [eb('s.kind', 'in', kinds)] : []),
          ...(channels.length ? [eb('l.channel_id', 'in', channels)] : []),
          ...(links.length ? [eb('s.link_id', 'in', links)] : []),
        ]),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * Each costed link's RETURN, SINCE MADE, both attributions (see the file header), or one link's when `linkId` is given.
   * It starts from the costed links' sources (read first, a few rows), then by index from them to the buyers: first, the
   * accounts whose first source it is (`account_sources_first_idx`), last, the orders whose conversion names it
   * (`acquisition_conversions_last_idx`); then their orders and invoices. The Before tracking and Direct fallbacks are
   * never a link, so a buyer without a row is never one of a link's. The counted collectors are checked for those
   * buyers only, never built over every account (§3.4 A.14: under 300 ms at the 1,000-a-day level, step 4.13's bench).
   */
  private async returns(tx: Db, linkId?: string): Promise<Map<string, { first: LinkReturn; last: LinkReturn }>> {
    const out = new Map<string, { first: LinkReturn; last: LinkReturn }>();
    let costed = tx
      .selectFrom('links as l')
      .innerJoin('acquisition_sources as s', 's.link_id', 'l.id')
      .select(['l.id as link_id', 's.id as source_id', 'l.cost_minor', 'l.cost_currency'])
      .where('l.cost_minor', 'is not', null);
    if (linkId !== undefined) costed = costed.where('l.id', '=', linkId);
    const links = await costed.execute();
    if (links.length === 0) return out;
    const ids = sql.join(links.map((l) => sql`${l.source_id}::integer`));
    const amount = sql`(CASE WHEN i.kind = 'INVOICE' THEN i.total_minor ELSE -i.total_minor END)::bigint`;
    const sinceMade = sql`l.cost_minor IS NOT NULL AND i.currency = l.cost_currency AND i.issued_at >= l.created_at AND ${countedCollector('o.account_id')}`;
    const rows = await sql<{ source_id: number; first: number; last: number }>`
      SELECT x.source_id, coalesce(sum(x.amount) FILTER (WHERE x.w = 'first'), 0)::bigint AS first,
             coalesce(sum(x.amount) FILTER (WHERE x.w = 'last'), 0)::bigint AS last
        FROM (SELECT fs.first_source_id AS source_id, ${amount} AS amount, 'first'::text AS w
                FROM account_sources fs JOIN acquisition_sources k ON k.id = fs.first_source_id JOIN links l ON l.id = k.link_id
                JOIN orders o ON o.account_id = fs.account_id JOIN invoices i ON i.order_id = o.id
               WHERE fs.first_source_id IN (${ids}) AND ${sinceMade}
              UNION ALL
              SELECT c.last_source_id, ${amount}, 'last'
                FROM acquisition_conversions c JOIN acquisition_sources k ON k.id = c.last_source_id JOIN links l ON l.id = k.link_id
                JOIN orders o ON o.id = c.ref_id JOIN invoices i ON i.order_id = o.id
               WHERE c.kind = 'ORDER' AND c.last_source_id IN (${ids}) AND ${sinceMade}) x
       GROUP BY x.source_id`.execute(tx);
    const sums = new Map(rows.rows.map((r) => [Number(r.source_id), r]));
    for (const l of links) {
      const cost = Number(l.cost_minor);
      const currency = l.cost_currency as HouseCurrency;
      const one = (revenue: number): LinkReturn => ({ revenueMinor: revenue, costMinor: cost, currency, ratio: ratio(revenue, cost) });
      const r = sums.get(l.source_id);
      out.set(l.link_id, { first: one(Number(r?.first ?? 0)), last: one(Number(r?.last ?? 0)) });
    }
    return out;
  }

  /** LINKS: the channels in their order, each with its links (see the file header). */
  private async channelGroups(
    tx: Db,
    sources: SourceMeta[],
    of: (id: number | null | undefined) => Figures,
    currency: HouseCurrency,
    archived: boolean,
  ): Promise<ChannelGroup[]> {
    const all = await this.links.list({ archived: true }, tx);
    const channels = await this.links.channels(tx);
    const returns = await this.returns(tx);
    const sourceOf = new Map(sources.filter((s) => s.link_id).map((s) => [s.link_id!, s.id]));
    const groups: ChannelGroup[] = [];
    for (const c of channels) {
      // The link builder's order: newest first (LinkService.list).
      const mine = all.filter((l) => l.channel.id === c.id);
      if (mine.length === 0) continue;
      const rows: LinkRow[] = mine.map((link) => {
        const sourceId = sourceOf.get(link.id) ?? null;
        return { link, sourceId, figures: of(sourceId), returns: link.cost ? (returns.get(link.id) ?? zeroReturns(link.cost)) : null };
      });
      const costed = rows.filter((r) => r.link.cost?.currency === currency);
      const costMinor = costed.reduce((n, r) => n + r.link.cost!.minor, 0);
      const sum = (pick: 'first' | 'last') => costed.reduce((n, r) => n + (r.returns?.[pick].revenueMinor ?? 0), 0);
      groups.push({
        channel: { id: c.id, name: c.name, position: c.position },
        figures: sumFigures(rows.map((r) => r.figures)),
        cost: costed.length ? { minor: costMinor, currency } : null,
        returns: costed.length
          ? {
              first: { revenueMinor: sum('first'), costMinor, currency, ratio: ratio(sum('first'), costMinor) },
              last: { revenueMinor: sum('last'), costMinor, currency, ratio: ratio(sum('last'), costMinor) },
            }
          : null,
        links: archived ? rows : rows.filter((r) => r.link.archivedAt === null),
      });
    }
    return groups;
  }

  /** A link's days in the period: visits, first visits, sign-ups first and last (the days with any). */
  private async days(tx: Db, basis: ReportBasis, p: ReturnType<typeof periodOf>, sourceId: number): Promise<LinkDay[]> {
    const out = new Map<string, LinkDay>();
    const get = (day: string) => {
      let d = out.get(day);
      if (!d) out.set(day, (d = { day, visits: 0, firstVisits: 0, signupsFirst: 0, signupsLast: 0 }));
      return d;
    };
    for (const v of (await this.visitsBy(tx, basis, p, [sourceId], 'day')).values()) {
      const d = get(v.key);
      d.visits += v.visits;
      d.firstVisits += v.firstVisits;
    }
    const signups = await sql<{ created_at: Date; first_src: number; last_src: number }>`
      WITH ${factsWith(basis, p.start, p.end, 'EUR')}
      SELECT fs.created_at, f.first_src, f.last_src FROM facts f JOIN fs ON fs.account_id = f.account_id
       WHERE f.measure = 'signups' AND (f.first_src = ${sourceId}::integer OR f.last_src = ${sourceId}::integer)`.execute(tx);
    for (const s of signups.rows) {
      const d = get(parisDay(new Date(s.created_at)));
      if (Number(s.first_src) === sourceId) d.signupsFirst += 1;
      if (Number(s.last_src) === sourceId) d.signupsLast += 1;
    }
    return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction: every reading of a report sees the same moment. */
  private async readOnly<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      return fn(tx);
    });
  }
}

const isZero = (f: Figures): boolean =>
  f.visits === 0 && f.firstVisits === 0 && (['first', 'last'] as const).every((k) => f[k].signups === 0 && f[k].entries === 0 && f[k].purchases === 0 && f[k].revenueMinor === 0);

const zeroReturns = (cost: { minor: number; currency: HouseCurrency }): { first: LinkReturn; last: LinkReturn } => {
  const one = (): LinkReturn => ({ revenueMinor: 0, costMinor: cost.minor, currency: cost.currency, ratio: ratio(0, cost.minor) });
  return { first: one(), last: one() };
};

/** CAMPAIGN TAGS: the campaigns with any figure, by source / medium / campaign, grouped by utm_source. */
function campaignGroups(sources: SourceMeta[], of: (id: number) => Figures): CampaignGroup[] {
  const rows = new Map<string, CampaignRow & { variantsSeen: SourceMeta[] }>();
  for (const s of sources) {
    if (s.kind !== 'CAMPAIGN') continue;
    const f = of(s.id);
    if (isZero(f)) continue;
    const key = [s.utm_source, s.utm_medium, s.utm_campaign].map((v) => v ?? '').join('\u001f');
    const row = rows.get(key) ?? { source: s.utm_source, medium: s.utm_medium, campaign: s.utm_campaign, sourceIds: [], variants: 0, content: null, term: null, figures: zeroFigures(), variantsSeen: [] };
    row.sourceIds.push(s.id);
    row.variantsSeen.push(s);
    row.figures = addFigures(row.figures, f);
    rows.set(key, row);
  }
  const groups = new Map<string, CampaignGroup>();
  for (const { variantsSeen, ...row } of rows.values()) {
    row.variants = variantsSeen.length;
    if (variantsSeen.length === 1) {
      row.content = variantsSeen[0]!.utm_content;
      row.term = variantsSeen[0]!.utm_term;
    }
    const g = groups.get(row.source ?? '') ?? { utmSource: row.source, figures: zeroFigures(), rows: [] };
    g.rows.push(row);
    g.figures = addFigures(g.figures, row.figures);
    groups.set(row.source ?? '', g);
  }
  const byVisits = <T extends { figures: Figures }>(a: T, b: T, ka: string, kb: string) => b.figures.visits - a.figures.visits || ka.localeCompare(kb);
  for (const g of groups.values()) g.rows.sort((a, b) => byVisits(a, b, `${a.medium}/${a.campaign}`, `${b.medium}/${b.campaign}`));
  return [...groups.values()].sort((a, b) => byVisits(a, b, a.utmSource ?? '', b.utmSource ?? ''));
}

