/**
 * What the recording gives the console and the right of access (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.4 and
 * T.8.6, §3.0 (d), (e), (h) and (k), step 3.9): the reads of `collector_views` and its summaries. They only read: no
 * write, no audit (the right of access is audited by OwnerService.exportData, the Collectors export by its own step).
 * TrackingService (services/tracking.ts) offers each of them as a method; the console's routes call them from their own
 * steps (the client sheet's Intelligence, §3.6 C.4.4; the Collectors page, §3.6 C.6; Segments, §3.6 C.5).
 *
 *   collectorBrowsing  the client sheet's blocks What they look at, Devices and Places (T.4.1): last seen, active days,
 *               views over the 13 months and the summary older than them, « Before the account » in its four forms,
 *               scans, the pages' shares of time, the most viewed models and releases (the summary's figures added), the
 *               devices and the places. `withCities: false` (an AUDITOR, §3.0 (h)) withholds every city.
 *   viewsReport, devicesReport, placesReport  the Collectors page's figures (T.4.2): with no filter, or only the
 *               connection's countries, they read the daily totals kept for good (`view_daily_stats`,
 *               `device_daily_stats`); with the collectors the other filters select (`accounts`), the 13 months of
 *               detail, counted collectors only, a period reaching further back counted from the first day kept
 *               (`reachesBackTo`). The previous period on request.
 *   viewedModels  the client sheet's « Show all » of the models viewed (§3.6 C.11), a page of 50 at a time.
 *   collectorsFor  the click-through: the collectors behind one figure, a page at a time.
 *   activityOf  views, seconds, active Paris days and visits (a device's views more than 30 minutes apart) per account.
 *   browsingCondition  the four BROWSING criteria of Segments (T.4.3) as one condition on an account (the `not` is the
 *               caller's, services/segments.ts).
 *   exportColumns  the Collectors export's tracking columns (T.4.4), set-based, TRACKING_EXPORT_CHUNK accounts a query.
 *   exportedBrowsing  the right-of-access `browsing` (§3.0 (k)): the devices, the places, the 13 months of views by page
 *               and subject, the monthly summaries and the summary older than 13 months; never a device's pseudonym, an
 *               id of another table, or anything of staff.
 *
 * Who is counted (§3.0 (d)): every figure, list and export column reads counted collectors only (population.ts
 * `countedCollector`: no test entrant, no team account, no DELETED account); the anonymous daily totals never held
 * them. A client sheet and the right of access show the account's own data, whoever it is.
 *
 * Every day is a Paris day computed here in JavaScript (services/schedule.ts) and passed to SQL as timestamptz; a row's
 * Paris day is numbered by `width_bucket` over those day starts, so PostgreSQL and PGlite agree whatever time-zone data
 * they carry (§3.0 (e)). Emails are returned as stored: the routes mask them for an AUDITOR (routes/admin/serialize.ts
 * `clientEmail`), as OwnerService's are.
 */
import { sql, type Expression, type RawBuilder, type SqlBool } from 'kysely';
import type { Db } from '../db/connection.js';
import {
  DEVICE_KINDS,
  DEVICE_SYSTEMS,
  IN_APPS,
  OPENED_IN,
  VIEW_PAGE_CODES,
  VIEW_PAGES,
  type DeviceBrowser,
  type DeviceKind,
  type DeviceSystem,
  type InApp,
  type LinkVia,
  type OpenedIn,
  type ViewPage,
} from '../db/schema.js';
import { notFound, validationError } from '../errors.js';
import { countedCollector } from './population.js';
import { UNKNOWN_COUNTRY } from './scan-stats.js';
import { parisDay, parisDayStart } from './schedule.js';
import { nextParisDay, NIL_UUID, viewHistoryCutoff, viewsCountedThrough } from './tracking.js';

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The client sheet's tables at most (T.4.1). */
export const SHEET_MODELS = 5;
export const SHEET_RELEASES = 5;
export const SHEET_DEVICES = 6;
export const SHEET_PLACES = 5;
/** A page of the client sheet's « Show all » of the models viewed (§3.6 C.11). */
export const VIEWED_MODELS_PAGE = 50;
/** The pages named on the sheet before 'Other' (T.4.1). */
export const SHEET_PAGES = 4;
/** Two views of one device further apart than this begin a new visit (T.8.6). */
export const VISIT_GAP_MINUTES = 30;
/** The click-through's page by default (T.8.6). */
export const COLLECTORS_PAGE_SIZE = 25;
/** The click-through's page at most. */
export const COLLECTORS_PAGE_MAX = 100;
/** The accounts one query of exportColumns reads (T.4.4). */
export const TRACKING_EXPORT_CHUNK = 500;
/** The top models of the export (T.4.4). */
export const EXPORT_TOP_MODELS = 3;
/** The longest window a report reads, in days (the console bounds its own periods; this only guards the service). */
export const WINDOW_MAX_DAYS = 3_660;
/** A Segments criterion's `days` (T.4.3: 13 months of detail at most) and `min`. */
export const VIEW_RULE_DAYS = Object.freeze({ min: 1, max: 395 });
export const VIEW_RULE_MIN = Object.freeze({ min: 1, max: 100 });

const SCAN = VIEW_PAGE_CODES.SCAN;
const MODEL = VIEW_PAGE_CODES.MODEL;
const LIVE = VIEW_PAGE_CODES.LIVE;
/** The pages whose subject is a release. */
const RELEASE_PAGES = [VIEW_PAGE_CODES.RELEASE, VIEW_PAGE_CODES.LIVE, VIEW_PAGE_CODES.AFTER_ROOM] as const;
/** The pages whose subject is a model (a scan's, a piece's, a sheet's). */
const MODEL_SUBJECT_PAGES = new Set<number>([SCAN, VIEW_PAGE_CODES.PIECE, MODEL]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The nil uuid as an SQL literal, read when a query is built (tracking.ts imports this file: no use at load time). */
const nil = () => sql.raw(`'${NIL_UUID}'::uuid`);
const ZZ = sql.raw(`'${UNKNOWN_COUNTRY}'`);
const GAP = sql.raw(`interval '${VISIT_GAP_MINUTES} minutes'`);

// ── Words (the export's and the right of access's; the console's sheet words are its own, §3.6 C.4.4) ────────────

const SYSTEM_WORDS: Record<DeviceSystem, string> = { IOS: 'iOS', ANDROID: 'Android', MACOS: 'macOS', WINDOWS: 'Windows', CHROMEOS: 'ChromeOS', LINUX: 'Linux', OTHER: '' };
const BROWSER_WORDS: Record<DeviceBrowser, string> = { SAFARI: 'Safari', CHROME: 'Chrome', FIREFOX: 'Firefox', EDGE: 'Edge', SAMSUNG: 'Samsung Internet', OPERA: 'Opera', WEBVIEW: 'WebView', OTHER: '' };
/** The apps' names, as the console's Devices panel writes them (T.4.2). */
export const APP_WORDS: Record<InApp, string> = {
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
  THREADS: 'Threads',
  SNAPCHAT: 'Snapchat',
  PINTEREST: 'Pinterest',
  LINKEDIN: 'LinkedIn',
  GOOGLE: 'Google',
  WECHAT: 'WeChat',
  LINE: 'LINE',
  OTHER: 'Other app',
};
const KIND_WORDS: Record<DeviceKind, string> = { PHONE: 'Phone', TABLET: 'Tablet', COMPUTER: 'Computer', UNKNOWN: 'Device' };

/** A device's class, as the reads return it. */
export interface DeviceClassView {
  kind: DeviceKind;
  system: DeviceSystem;
  browser: DeviceBrowser;
  openedIn: OpenedIn;
  app: InApp | null;
}

/** A device's name: 'iPhone', 'iPad', 'Android phone', 'Computer · macOS' as words (« Computer », « macOS »). */
export function deviceNameWords(d: Pick<DeviceClassView, 'kind' | 'system'>): string[] {
  if (d.system === 'IOS' && d.kind === 'PHONE') return ['iPhone'];
  if (d.system === 'IOS' && d.kind === 'TABLET') return ['iPad'];
  if (d.system === 'ANDROID' && d.kind === 'PHONE') return ['Android phone'];
  if (d.system === 'ANDROID' && d.kind === 'TABLET') return ['Android tablet'];
  const system = SYSTEM_WORDS[d.system];
  if (d.kind === 'UNKNOWN' && system) return [system];
  return system ? [KIND_WORDS[d.kind], system] : [KIND_WORDS[d.kind]];
}

/** A device in words, its name then its browser outside an app (« iPhone Safari », « Computer macOS Chrome », « iPhone »). */
export function deviceWords(d: DeviceClassView, separator = ' '): string {
  const browser = d.openedIn === 'IN_APP' ? '' : BROWSER_WORDS[d.browser];
  return [...deviceNameWords(d), ...(browser ? [browser] : [])].join(separator);
}

/** Where it was opened, in words: 'Browser', 'Home screen', or the app's name. */
export function openedInWords(d: Pick<DeviceClassView, 'openedIn' | 'app'>): string {
  if (d.openedIn === 'IN_APP') return APP_WORDS[d.app ?? 'OTHER'];
  return d.openedIn === 'HOME_SCREEN' ? 'Home screen' : 'Browser';
}

/** The main device of the export: its kind with its system (« Phone iOS », « Computer macOS »). */
export function mainDeviceWords(d: Pick<DeviceClassView, 'kind' | 'system'>): string {
  const system = SYSTEM_WORDS[d.system];
  return system ? `${KIND_WORDS[d.kind]} ${system}` : KIND_WORDS[d.kind];
}

// ── Windows (Paris days) ──────────────────────────────────────────────────────────────────────────────────────

/** A period of whole Paris days, `from` to `to` included, `YYYY-MM-DD`. */
export interface DayWindow {
  from: string;
  to: string;
}

function checkDay(day: string, what: string): void {
  if (typeof day !== 'string' || !DAY_RE.test(day)) throw validationError(`${what}: a day is YYYY-MM-DD.`);
  try {
    parisDayStart(day);
  } catch {
    throw validationError(`${what}: a day is YYYY-MM-DD.`);
  }
}

/** The number of Paris days of a window. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The Paris day `n` days after (or before, when negative) `day`. */
export function addParisDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A window checked: two days, `from` not after `to`, at most WINDOW_MAX_DAYS. 400 VALIDATION_FAILED otherwise. */
export function checkWindow(w: DayWindow): DayWindow {
  checkDay(w?.from, 'from');
  checkDay(w?.to, 'to');
  if (w.from > w.to) throw validationError('from: not after to.');
  if (daysBetween(w.from, w.to) > WINDOW_MAX_DAYS) throw validationError(`A period is ${WINDOW_MAX_DAYS} days at most.`);
  return { from: w.from, to: w.to };
}

/** The previous period: the same number of days, ending the day before the period starts (§3.6 C.6.2). */
export function previousWindow(w: DayWindow): DayWindow {
  const n = daysBetween(w.from, w.to);
  const to = addParisDays(w.from, -1);
  return { from: addParisDays(to, -(n - 1)), to };
}

/** Every Paris day of a window, in order. */
function daysOf(w: DayWindow): string[] {
  const out: string[] = [];
  for (let d = w.from; d <= w.to; d = nextParisDay(d)) out.push(d);
  return out;
}

/** The day starts from `from` to the day after `to`: `width_bucket(at, …)` numbers a row's Paris day, 1 the first. */
function bucketsOf(w: DayWindow): RawBuilder<unknown> {
  const starts = [...daysOf(w), nextParisDay(w.to)].map((d) => sql`${parisDayStart(d)}::timestamptz`);
  return sql`ARRAY[${sql.join(starts)}]`;
}

/**
 * The detail's part of a window: the raw rows are kept 13 Paris calendar months (viewHistoryCutoff), so a window
 * starting earlier is read from the first day kept, which `reachesBackTo` names (T.4.2). Null when nothing of it is kept.
 */
function detailWindow(w: DayWindow, now: Date): { window: DayWindow | null; reachesBackTo: string | null } {
  const first = parisDay(viewHistoryCutoff(now));
  if (w.from >= first) return { window: w, reachesBackTo: null };
  return { window: w.to < first ? null : { from: first, to: w.to }, reachesBackTo: first };
}

// ── Filters ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A condition on a column holding an account id (population.ts's shape): the collectors the console's filters select. */
export type AccountCondition = (column: string) => RawBuilder<unknown>;

/** What narrows a report (T.4.2). */
export interface ViewFilters {
  /** The connection's countries (ISO codes, 'ZZ' unknown), the one filter the daily totals hold. */
  countries?: readonly string[];
  /**
   * The collectors the console's other filters select (source, tier, score, favourite type: the Collectors page's
   * filter function, §3.6 C.6.4). When given, the figures read the 13 months of detail, signed-in rows only.
   */
  accounts?: AccountCondition;
}

function cleanCountries(c: readonly string[] | undefined): string[] {
  if (!c || c.length === 0) return [];
  const out = [...new Set(c.map((x) => String(x).trim().toUpperCase()))];
  if (out.some((x) => !/^[A-Z]{2}$/.test(x))) throw validationError('countries: two capital letters each.');
  return out;
}

/** The counted collectors the filters select, as a subquery of `id`s (a semi-join, read once). */
function countedIds(f: ViewFilters | undefined): RawBuilder<unknown> {
  return sql`SELECT ra.id FROM accounts ra WHERE ${countedCollector('ra.id')}${f?.accounts ? sql` AND ${f.accounts('ra.id')}` : sql``}`;
}

/** The rows of the detail a report reads: the window's, of counted collectors selected, from the countries named. */
function detailRows(w: DayWindow, f: ViewFilters | undefined, countries: string[]): RawBuilder<unknown> {
  const start = parisDayStart(w.from);
  const end = parisDayStart(nextParisDay(w.to));
  const where = sql`v.at >= ${start} AND v.at < ${end} AND v.account_id IN (${countedIds(f)})`;
  return countries.length
    ? sql`${where} AND coalesce((SELECT gp.country FROM geo_places gp WHERE gp.id = v.place_id), ${ZZ}) IN (${sql.join(countries)})`
    : where;
}

// ── The client sheet (T.4.1) ──────────────────────────────────────────────────────────────────────────────────

export interface ViewedModel {
  modelId: string;
  /** Null for a model no longer found (the console writes « (withdrawn) »). */
  name: string | null;
  variant: string | null;
  views: number;
  seconds: number;
  lastAt: Date;
}

export interface ViewedRelease {
  dropId: string;
  title: string | null;
  /** A LIVE RELEASE (its console page is the LIVE one), else a draw; false for a release no longer found. */
  live: boolean;
  views: number;
  seconds: number;
  /** The seconds in its LIVE room. */
  liveSeconds: number;
  lastAt: Date;
}

/** The client sheet's « Show all » of the models viewed (§3.6 C.11): a page of VIEWED_MODELS_PAGE, the most time first. */
export interface ViewedModelsPage {
  items: ViewedModel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BrowsingDevice extends DeviceClassView {
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstVia: LinkVia;
}

export interface BrowsingPlace {
  country: string;
  /** Null: the connection gave no city, or the reader withholds it. */
  city: string | null;
  days: number;
  lastDay: string;
}

/** « Before the account » (T.4.1), in its four forms. */
export type BeforeAccount =
  | { kind: 'BROWSED'; days: number; from: Date; views: number; scans: number }
  | { kind: 'FIRST_VISIT' }
  | { kind: 'NOTHING' }
  | { kind: 'OLDER'; startedAt: Date };

export interface CollectorBrowsing {
  /** The recording's start (`tracking_state.started_at`); null before the first boot on this schema. */
  recordingSince: Date | null;
  /** The first day the raw rows keep (13 Paris calendar months). */
  keptFrom: string;
  lastSeen: { at: Date; device: DeviceClassView | null; place: { country: string; city: string | null } | null } | null;
  activeDays: { last30: number; last90: number };
  /** The views of the 13 months (not the scans). */
  views: { count: number; seconds: number };
  /** The summary of what passed 13 months; null when it holds no view. */
  older: { before: string; views: number; seconds: number } | null;
  beforeAccount: BeforeAccount;
  scans: { count: number; beforeAccount: number; firstAt: Date | null };
  /** The share of time per page over the 13 months: the SHEET_PAGES largest, then 'OTHER'. */
  pages: { page: ViewPage | 'OTHER'; seconds: number; share: number }[];
  models: ViewedModel[];
  /** How many models were viewed (the 13 months and the summary): more than `models` shows « Show all ». */
  modelsViewed: number;
  releases: ViewedRelease[];
  devices: BrowsingDevice[];
  places: BrowsingPlace[];
  /** Whether the cities were withheld (an AUDITOR). */
  citiesWithheld: boolean;
}

const asNumber = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** The Paris days from the first day kept to today, numbered for `width_bucket`. */
function keptWindow(now: Date): DayWindow {
  return { from: parisDay(viewHistoryCutoff(now)), to: parisDay(now) };
}

interface RawTotals {
  views: number;
  seconds: number;
  scans: number;
  scansBefore: number;
  viewsBefore: number;
  firstScanAt: Date | null;
  firstAt: Date | null;
  lastAt: Date | null;
  firstBeforeAt: Date | null;
  active30: number;
  active90: number;
  daysBefore: number;
  releases: number;
}

/** Per account, its rows of the 13 months in one grouped read on `collector_views_account_idx`. */
async function rawTotals(db: Db, ids: readonly string[], now: Date): Promise<Map<string, RawTotals>> {
  const kept = keptWindow(now);
  const buckets = bucketsOf(kept);
  const day = sql`width_bucket(v.at, ${buckets})`;
  const d30 = parisDayStart(addParisDays(kept.to, -29));
  const d90 = parisDayStart(addParisDays(kept.to, -89));
  const r = await sql<Record<string, unknown> & { account_id: string }>`
    SELECT v.account_id,
           (count(*) FILTER (WHERE v.page <> ${SCAN}))::int AS views,
           coalesce(sum(v.seconds) FILTER (WHERE v.page <> ${SCAN}), 0)::bigint AS seconds,
           (count(*) FILTER (WHERE v.page = ${SCAN}))::int AS scans,
           (count(*) FILTER (WHERE v.page = ${SCAN} AND v.at < a.created_at))::int AS scans_before,
           (count(*) FILTER (WHERE v.page <> ${SCAN} AND v.at < a.created_at))::int AS views_before,
           min(v.at) FILTER (WHERE v.page = ${SCAN}) AS first_scan_at,
           min(v.at) AS first_at,
           max(v.at) AS last_at,
           min(v.at) FILTER (WHERE v.at < a.created_at) AS first_before_at,
           (count(DISTINCT ${day}) FILTER (WHERE v.at >= ${d30}))::int AS active30,
           (count(DISTINCT ${day}) FILTER (WHERE v.at >= ${d90}))::int AS active90,
           (count(DISTINCT ${day}) FILTER (WHERE v.at < a.created_at))::int AS days_before,
           (count(DISTINCT v.subject) FILTER (WHERE v.page IN (${sql.join([...RELEASE_PAGES])}) AND v.subject IS NOT NULL))::int AS releases
      FROM collector_views v JOIN accounts a ON a.id = v.account_id
     WHERE v.account_id IN (${sql.join([...ids])}) AND v.at >= ${parisDayStart(kept.from)}
     GROUP BY v.account_id`.execute(db);
  return new Map(
    r.rows.map((x) => [
      x.account_id,
      {
        views: asNumber(x.views),
        seconds: asNumber(x.seconds),
        scans: asNumber(x.scans),
        scansBefore: asNumber(x.scans_before),
        viewsBefore: asNumber(x.views_before),
        firstScanAt: (x.first_scan_at as Date | null) ?? null,
        firstAt: (x.first_at as Date | null) ?? null,
        lastAt: (x.last_at as Date | null) ?? null,
        firstBeforeAt: (x.first_before_at as Date | null) ?? null,
        active30: asNumber(x.active30),
        active90: asNumber(x.active90),
        daysBefore: asNumber(x.days_before),
        releases: asNumber(x.releases),
      },
    ]),
  );
}

/** Per account, whether its rows before the account are one visit ending at the sign-up (« Signed up on the first visit. »). */
async function oneVisitBefore(db: Db, ids: readonly string[], now: Date): Promise<Map<string, boolean>> {
  const r = await sql<{ account_id: string; one: boolean }>`
    SELECT g.account_id, bool_and(g.gap <= ${GAP}) AS one
      FROM (SELECT v.account_id, lead(v.at, 1, a.created_at) OVER (PARTITION BY v.account_id ORDER BY v.at, v.id) - v.at AS gap
              FROM collector_views v JOIN accounts a ON a.id = v.account_id
             WHERE v.account_id IN (${sql.join([...ids])}) AND v.at >= ${viewHistoryCutoff(now)} AND v.at < a.created_at) g
     GROUP BY g.account_id`.execute(db);
  return new Map(r.rows.map((x) => [x.account_id, x.one === true]));
}

interface SummaryTotals {
  views: number;
  seconds: number;
  scans: number;
  firstScanAt: Date | null;
  firstAt: Date | null;
  releases: Set<string>;
}

/** Per account, the summary of what passed 13 months (`collector_view_totals`, by its primary key). */
async function summaryTotals(db: Db, ids: readonly string[]): Promise<Map<string, SummaryTotals>> {
  const rows = await db
    .selectFrom('collector_view_totals')
    .select(['account_id', 'page', 'subject', 'views', 'seconds', 'first_at'])
    .where('account_id', 'in', [...ids])
    .execute();
  const out = new Map<string, SummaryTotals>();
  for (const t of rows) {
    const s = out.get(t.account_id) ?? { views: 0, seconds: 0, scans: 0, firstScanAt: null, firstAt: null, releases: new Set<string>() };
    if (t.page === SCAN) {
      s.scans += t.views;
      if (!s.firstScanAt || t.first_at < s.firstScanAt) s.firstScanAt = t.first_at;
    } else {
      s.views += t.views;
      s.seconds += Number(t.seconds);
    }
    if ((RELEASE_PAGES as readonly number[]).includes(t.page) && t.subject !== NIL_UUID) s.releases.add(t.subject);
    if (!s.firstAt || t.first_at < s.firstAt) s.firstAt = t.first_at;
    out.set(t.account_id, s);
  }
  return out;
}

/** Per account, the subjects of `pages` most looked at (raw rows and the summary together), the most time first. */
async function topSubjects(
  db: Db,
  ids: readonly string[],
  pages: readonly number[],
  limit: number,
  now: Date,
  offset = 0,
): Promise<Map<string, { subject: string; views: number; seconds: number; live: number; lastAt: Date; total: number }[]>> {
  const p = sql.join([...pages]);
  const r = await sql<{ account_id: string; subject: string; views: unknown; seconds: unknown; live: unknown; last_at: Date; total: unknown }>`
    WITH s AS (
      SELECT v.account_id, v.subject, count(*) AS views, sum(v.seconds) AS seconds,
             coalesce(sum(v.seconds) FILTER (WHERE v.page = ${LIVE}), 0) AS live, max(v.at) AS last_at
        FROM collector_views v
       WHERE v.account_id IN (${sql.join([...ids])}) AND v.at >= ${viewHistoryCutoff(now)} AND v.page IN (${p}) AND v.subject IS NOT NULL
       GROUP BY v.account_id, v.subject
      UNION ALL
      SELECT t.account_id, t.subject, t.views, t.seconds, CASE WHEN t.page = ${LIVE} THEN t.seconds ELSE 0 END, t.last_at
        FROM collector_view_totals t
       WHERE t.account_id IN (${sql.join([...ids])}) AND t.page IN (${p}) AND t.subject <> ${nil()}),
    g AS (SELECT account_id, subject, sum(views) AS views, sum(seconds) AS seconds, sum(live) AS live, max(last_at) AS last_at FROM s GROUP BY account_id, subject),
    r AS (SELECT g.*, row_number() OVER (PARTITION BY account_id ORDER BY seconds DESC, views DESC, last_at DESC, subject) AS n,
                 count(*) OVER (PARTITION BY account_id) AS total FROM g)
    SELECT account_id, subject, views, seconds, live, last_at, total FROM r WHERE n > ${offset} AND n <= ${offset + limit} ORDER BY account_id, n`.execute(db);
  const out = new Map<string, { subject: string; views: number; seconds: number; live: number; lastAt: Date; total: number }[]>();
  for (const x of r.rows) {
    const list = out.get(x.account_id) ?? [];
    list.push({ subject: x.subject, views: asNumber(x.views), seconds: asNumber(x.seconds), live: asNumber(x.live), lastAt: x.last_at, total: asNumber(x.total) });
    out.set(x.account_id, list);
  }
  return out;
}

/** Models by id: their name and variant (the console's variant line, its own line under the name). */
async function modelNames(db: Db, ids: readonly string[]): Promise<Map<string, { name: string; variant: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('models').select(['id', 'name', 'variant_label']).where('id', 'in', [...new Set(ids)]).execute();
  return new Map(rows.map((m) => [m.id, { name: m.name, variant: m.variant_label }]));
}

/** Releases by id: their title and whether each is a LIVE RELEASE (the console's page differs). */
async function dropFacts(db: Db, ids: readonly string[]): Promise<Map<string, { title: string; live: boolean }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('drops').select(['id', 'title', 'mode']).where('id', 'in', [...new Set(ids)]).execute();
  return new Map(rows.map((d) => [d.id, { title: d.title, live: d.mode === 'LIVE' }]));
}

async function dropTitles(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('drops').select(['id', 'title']).where('id', 'in', [...new Set(ids)]).execute();
  return new Map(rows.map((d) => [d.id, d.title]));
}

const deviceClassOf = (r: { kind: string; os: string; browser: string; opened_in: string; in_app: string | null }): DeviceClassView => ({
  kind: r.kind as DeviceKind,
  system: r.os as DeviceSystem,
  browser: r.browser as DeviceBrowser,
  openedIn: r.opened_in as OpenedIn,
  app: (r.in_app as InApp | null) ?? null,
});

/** Per account, its devices (never one marked staff), the latest first: first seen, last seen for that account. */
async function devicesOf(db: Db, ids: readonly string[]): Promise<Map<string, BrowsingDevice[]>> {
  const r = await sql<{ account_id: string; kind: string; os: string; browser: string; opened_in: string; in_app: string | null; first_seen_at: Date; last_seen: Date; first_via: LinkVia }>`
    SELECT tda.account_id, td.kind, td.os, td.browser, td.opened_in, td.in_app, td.first_seen_at, tda.first_via,
           greatest(tda.last_linked_at, (SELECT max(v.at) FROM collector_views v WHERE v.device_id = td.id AND v.account_id = tda.account_id)) AS last_seen
      FROM tracking_device_accounts tda JOIN tracking_devices td ON td.id = tda.device_id
     WHERE tda.account_id IN (${sql.join([...ids])}) AND td.staff_at IS NULL
     ORDER BY tda.account_id, last_seen DESC, td.id DESC`.execute(db);
  const out = new Map<string, BrowsingDevice[]>();
  for (const x of r.rows) {
    const list = out.get(x.account_id) ?? [];
    list.push({ ...deviceClassOf(x), firstSeenAt: x.first_seen_at, lastSeenAt: x.last_seen, firstVia: x.first_via });
    out.set(x.account_id, list);
  }
  return out;
}

/** Per account, its places from the connection (`collector_places`), the most days first. */
async function placesOf(db: Db, ids: readonly string[]): Promise<Map<string, { placeId: number; country: string; city: string | null; days: number; firstDay: string; lastDay: string }[]>> {
  const rows = await db
    .selectFrom('collector_places as cp')
    .innerJoin('geo_places as gp', 'gp.id', 'cp.place_id')
    .select(['cp.account_id', 'cp.place_id', 'gp.country', 'gp.city', 'cp.days', 'cp.first_day', 'cp.last_day'])
    .where('cp.account_id', 'in', [...ids])
    .orderBy('cp.account_id')
    .orderBy('cp.days', 'desc')
    .orderBy('cp.last_day', 'desc')
    .orderBy('cp.place_id')
    .execute();
  const out = new Map<string, { placeId: number; country: string; city: string | null; days: number; firstDay: string; lastDay: string }[]>();
  for (const p of rows) {
    const list = out.get(p.account_id) ?? [];
    list.push({ placeId: p.place_id, country: p.country.trim(), city: p.city, days: p.days, firstDay: dayText(p.first_day), lastDay: dayText(p.last_day) });
    out.set(p.account_id, list);
  }
  return out;
}

/** A place's day as `YYYY-MM-DD` whatever the driver hands back for a `date`. */
const dayText = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/**
 * The client sheet's What they look at, Devices and Places (T.4.1). `withCities: false` (an AUDITOR) withholds every
 * city: the last seen place and the Places read the country only. 404 ACCOUNT_NOT_FOUND for an unknown account.
 */
export async function collectorBrowsing(db: Db, accountId: string, opts: { withCities: boolean; now: Date }): Promise<CollectorBrowsing> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const id = accountId.toLowerCase();
  const { now, withCities } = opts;
  const account = await db.selectFrom('accounts').select(['id', 'created_at']).where('id', '=', id).executeTakeFirst();
  if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const state = await db.selectFrom('tracking_state').select('started_at').where('id', '=', 1).executeTakeFirst();
  const ids = [id];
  // One after the other: a transaction (the intelligence route's) holds one connection.
  const raw = (await rawTotals(db, ids, now)).get(id);
  const summary = (await summaryTotals(db, ids)).get(id);
  const oneVisit = (await oneVisitBefore(db, ids, now)).get(id) ?? false;
  const topModels = (await topSubjects(db, ids, [MODEL], SHEET_MODELS, now)).get(id) ?? [];
  const topReleases = (await topSubjects(db, ids, RELEASE_PAGES, SHEET_RELEASES, now)).get(id) ?? [];
  const devices = ((await devicesOf(db, ids)).get(id) ?? []).slice(0, SHEET_DEVICES);
  const places = (await placesOf(db, ids)).get(id) ?? [];
  const pageRows = await db
    .selectFrom('collector_views')
    .select(['page', (eb) => eb.fn.sum<string>('seconds').as('seconds')])
    .where('account_id', '=', id)
    .where('at', '>=', viewHistoryCutoff(now))
    .where('page', '<>', SCAN)
    .groupBy('page')
    .execute();
  const last = await db
    .selectFrom('collector_views as v')
    .innerJoin('tracking_devices as td', 'td.id', 'v.device_id')
    .leftJoin('geo_places as gp', 'gp.id', 'v.place_id')
    .select(['v.at', 'td.kind', 'td.os', 'td.browser', 'td.opened_in', 'td.in_app', 'gp.country', 'gp.city'])
    .where('v.account_id', '=', id)
    .where('v.at', '>=', viewHistoryCutoff(now))
    .orderBy('v.at', 'desc')
    .orderBy('v.id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const models = await modelNames(db, topModels.map((m) => m.subject));
  const releases = await dropFacts(db, topReleases.map((r) => r.subject));

  const startedAt = state?.started_at ?? null;
  let beforeAccount: BeforeAccount;
  if (startedAt && account.created_at.getTime() < startedAt.getTime()) beforeAccount = { kind: 'OLDER', startedAt };
  else if (!raw?.firstBeforeAt) beforeAccount = { kind: 'NOTHING' };
  else if (oneVisit) beforeAccount = { kind: 'FIRST_VISIT' };
  else beforeAccount = { kind: 'BROWSED', days: raw.daysBefore, from: raw.firstBeforeAt, views: raw.viewsBefore, scans: raw.scansBefore };

  return {
    recordingSince: startedAt,
    keptFrom: keptWindow(now).from,
    lastSeen: last
      ? { at: last.at, device: deviceClassOf(last), place: last.country ? { country: last.country.trim(), city: withCities ? last.city : null } : null }
      : null,
    activeDays: { last30: raw?.active30 ?? 0, last90: raw?.active90 ?? 0 },
    views: { count: raw?.views ?? 0, seconds: raw?.seconds ?? 0 },
    older: summary && summary.views > 0 ? { before: keptWindow(now).from, views: summary.views, seconds: summary.seconds } : null,
    beforeAccount,
    scans: {
      count: (raw?.scans ?? 0) + (summary?.scans ?? 0),
      beforeAccount: raw?.scansBefore ?? 0,
      firstAt: earliest(raw?.firstScanAt ?? null, summary?.firstScanAt ?? null),
    },
    pages: pageShares(pageRows.map((p) => ({ page: p.page, seconds: Number(p.seconds ?? 0) }))),
    models: topModels.map((m) => ({ modelId: m.subject, name: models.get(m.subject)?.name ?? null, variant: models.get(m.subject)?.variant ?? null, views: m.views, seconds: m.seconds, lastAt: m.lastAt })),
    modelsViewed: topModels[0]?.total ?? 0,
    releases: topReleases.map((r) => ({ dropId: r.subject, title: releases.get(r.subject)?.title ?? null, live: releases.get(r.subject)?.live ?? false, views: r.views, seconds: r.seconds, liveSeconds: r.live, lastAt: r.lastAt })),
    devices,
    places: withCities ? places.slice(0, SHEET_PLACES).map((p) => ({ country: p.country, city: p.city, days: p.days, lastDay: dayText(p.lastDay) })) : byCountry(places).slice(0, SHEET_PLACES),
    citiesWithheld: !withCities,
  };
}

/**
 * The client sheet's « Show all » of the models viewed (§3.6 C.11, for a collector with many): every model viewed over
 * the 13 months and in the summary, the most time first, VIEWED_MODELS_PAGE a page (1 to 2,000). Cities are never in
 * it, so every role reads it. 404 ACCOUNT_NOT_FOUND for an unknown account.
 */
export async function viewedModels(db: Db, accountId: string, opts: { page: number; now: Date }): Promise<ViewedModelsPage> {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const id = accountId.toLowerCase();
  if (!Number.isInteger(opts.page) || opts.page < 1 || opts.page > 2_000) throw validationError('page: a whole number from 1 to 2000.');
  const account = await db.selectFrom('accounts').select('id').where('id', '=', id).executeTakeFirst();
  if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  const rows = (await topSubjects(db, [id], [MODEL], VIEWED_MODELS_PAGE, opts.now, (opts.page - 1) * VIEWED_MODELS_PAGE)).get(id) ?? [];
  const total = rows[0]?.total ?? (opts.page > 1 ? ((await topSubjects(db, [id], [MODEL], 1, opts.now)).get(id)?.[0]?.total ?? 0) : 0);
  const names = await modelNames(db, rows.map((m) => m.subject));
  return {
    items: rows.map((m) => ({ modelId: m.subject, name: names.get(m.subject)?.name ?? null, variant: names.get(m.subject)?.variant ?? null, views: m.views, seconds: m.seconds, lastAt: m.lastAt })),
    total,
    page: opts.page,
    pageSize: VIEWED_MODELS_PAGE,
  };
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * An AUDITOR's Places: the country only. A country's days add its places' days (two cities of one country on one day
 * count twice: the summary keeps no day of its own per country); its last day is its places' latest.
 */
function byCountry(places: readonly { country: string; days: number; lastDay: string }[]): BrowsingPlace[] {
  const m = new Map<string, BrowsingPlace>();
  for (const p of places) {
    const c = m.get(p.country) ?? { country: p.country, city: null, days: 0, lastDay: dayText(p.lastDay) };
    c.days += p.days;
    if (dayText(p.lastDay) > c.lastDay) c.lastDay = dayText(p.lastDay);
    m.set(p.country, c);
  }
  return [...m.values()].sort((a, b) => b.days - a.days || b.lastDay.localeCompare(a.lastDay) || a.country.localeCompare(b.country));
}

/** The pages' shares of time: the SHEET_PAGES largest, then 'OTHER' for the rest; shares in whole per cent. */
export function pageShares(rows: readonly { page: number; seconds: number }[]): { page: ViewPage | 'OTHER'; seconds: number; share: number }[] {
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  if (total <= 0) return [];
  const sorted = [...rows].filter((r) => r.seconds > 0).sort((a, b) => b.seconds - a.seconds || a.page - b.page);
  const named = sorted.slice(0, SHEET_PAGES).map((r) => ({ page: VIEW_PAGES[r.page as keyof typeof VIEW_PAGES] as ViewPage, seconds: r.seconds }));
  const rest = sorted.slice(SHEET_PAGES).reduce((s, r) => s + r.seconds, 0);
  const all: { page: ViewPage | 'OTHER'; seconds: number }[] = rest > 0 ? [...named, { page: 'OTHER', seconds: rest }] : named;
  return all.map((r) => ({ ...r, share: Math.round((r.seconds * 100) / total) }));
}

// ── The Collectors page's figures (T.4.2) ─────────────────────────────────────────────────────────────────────

export type ReportSource = 'DAILY' | 'DETAIL';

export interface ViewsFigures {
  window: DayWindow;
  views: number;
  seconds: number;
  scans: number;
  /** Devices summed per Paris day (a device seen on two days counts twice): what the daily totals hold. */
  devices: number;
  /** Distinct collectors over the window: the detail only (null from the anonymous daily totals). */
  collectors: number | null;
  byDay: { day: string; views: number }[];
  /** Per model (a variant its own row, `mainModelId` naming its main model), the most time first. */
  models: { modelId: string; mainModelId: string; name: string | null; variant: string | null; views: number; seconds: number; devices: number; collectors: number | null }[];
  releases: { dropId: string; title: string | null; views: number; seconds: number; liveSeconds: number; devices: number; collectors: number | null }[];
  /** Every page's share of time, the most time first. */
  pages: { page: ViewPage; views: number; seconds: number; share: number }[];
}

export interface ReportHead {
  source: ReportSource;
  /** The last Paris day the daily totals count (« Figures through … »), null before the first. */
  through: string | null;
  /** The detail's first day when the period reaches further back (« Filters other than the country reach back 13 months, to … »). */
  reachesBackTo: string | null;
}

export interface ViewsReport extends ReportHead {
  current: ViewsFigures;
  previous: ViewsFigures | null;
}

/** Models by id with their main model (a variant's `variant_of`, else itself). */
async function modelsWithMain(db: Db, ids: readonly string[]): Promise<Map<string, { main: string; name: string; variant: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('models').select(['id', 'name', 'variant_label', 'variant_of']).where('id', 'in', [...new Set(ids)]).execute();
  return new Map(rows.map((m) => [m.id, { main: m.variant_of ?? m.id, name: m.name, variant: m.variant_label }]));
}

async function viewsFigures(db: Db, w: DayWindow, f: ViewFilters | undefined, countries: string[], source: ReportSource): Promise<ViewsFigures> {
  type Row = { key: string | number; views: unknown; seconds: unknown; devices: unknown; collectors?: unknown; live?: unknown };
  let total: { views: unknown; seconds: unknown; scans: unknown; devices: unknown; collectors: unknown };
  let byDayRows: { day: string; views: unknown }[];
  let modelRows: Row[];
  let releaseRows: Row[];
  let pageRows: Row[];
  if (source === 'DAILY') {
    const days = sql`s.day >= ${w.from}::date AND s.day <= ${w.to}::date${countries.length ? sql` AND s.country IN (${sql.join(countries)})` : sql``}`;
    total = (
      await sql<typeof total>`
        SELECT coalesce(sum(s.views) FILTER (WHERE s.page > ${SCAN}), 0) AS views,
               coalesce(sum(s.seconds) FILTER (WHERE s.page > ${SCAN}), 0) AS seconds,
               coalesce(sum(s.views) FILTER (WHERE s.page = ${SCAN}), 0) AS scans,
               (SELECT coalesce(sum(s.devices), 0) FROM device_daily_stats s WHERE ${days}) AS devices,
               NULL AS collectors
          FROM view_daily_stats s WHERE ${days}`.execute(db)
    ).rows[0]!;
    byDayRows = (await sql<{ day: unknown; views: unknown }>`SELECT s.day, sum(s.views) AS views FROM view_daily_stats s WHERE ${days} AND s.page > ${SCAN} GROUP BY s.day`.execute(db)).rows.map((r) => ({
      day: dayText(r.day),
      views: r.views,
    }));
    modelRows = (
      await sql<Row>`SELECT s.subject AS key, sum(s.views) AS views, sum(s.seconds) AS seconds, sum(s.devices) AS devices FROM view_daily_stats s
         WHERE ${days} AND s.page = ${MODEL} AND s.subject <> ${nil()} GROUP BY s.subject`.execute(db)
    ).rows;
    releaseRows = (
      await sql<Row>`SELECT s.subject AS key, sum(s.views) AS views, sum(s.seconds) AS seconds, sum(s.devices) AS devices,
                            coalesce(sum(s.seconds) FILTER (WHERE s.page = ${LIVE}), 0) AS live
                       FROM view_daily_stats s WHERE ${days} AND s.page IN (${sql.join([...RELEASE_PAGES])}) AND s.subject <> ${nil()} GROUP BY s.subject`.execute(db)
    ).rows;
    pageRows = (await sql<Row>`SELECT s.page AS key, sum(s.views) AS views, sum(s.seconds) AS seconds, sum(s.devices) AS devices FROM view_daily_stats s WHERE ${days} AND s.page > ${SCAN} GROUP BY s.page`.execute(db))
      .rows;
  } else {
    const rows = detailRows(w, f, countries);
    const day = sql`width_bucket(v.at, ${bucketsOf(w)})`;
    const deviceDays = sql`count(DISTINCT (${day}, v.device_id))`;
    total = (
      await sql<typeof total>`
        SELECT (count(*) FILTER (WHERE v.page <> ${SCAN}))::int AS views,
               coalesce(sum(v.seconds) FILTER (WHERE v.page <> ${SCAN}), 0)::bigint AS seconds,
               (count(*) FILTER (WHERE v.page = ${SCAN}))::int AS scans,
               ${deviceDays}::int AS devices,
               (count(DISTINCT v.account_id))::int AS collectors
          FROM collector_views v WHERE ${rows}`.execute(db)
    ).rows[0]!;
    const all = daysOf(w);
    byDayRows = (await sql<{ b: number; views: unknown }>`SELECT ${day} AS b, count(*) AS views FROM collector_views v WHERE ${rows} AND v.page <> ${SCAN} GROUP BY 1`.execute(db)).rows.map((r) => ({
      day: all[Number(r.b) - 1]!,
      views: r.views,
    }));
    modelRows = (
      await sql<Row>`SELECT v.subject AS key, count(*) AS views, sum(v.seconds) AS seconds, ${deviceDays} AS devices, count(DISTINCT v.account_id) AS collectors
                       FROM collector_views v WHERE ${rows} AND v.page = ${MODEL} AND v.subject IS NOT NULL GROUP BY v.subject`.execute(db)
    ).rows;
    releaseRows = (
      await sql<Row>`SELECT v.subject AS key, count(*) AS views, sum(v.seconds) AS seconds, ${deviceDays} AS devices, count(DISTINCT v.account_id) AS collectors,
                            coalesce(sum(v.seconds) FILTER (WHERE v.page = ${LIVE}), 0) AS live
                       FROM collector_views v WHERE ${rows} AND v.page IN (${sql.join([...RELEASE_PAGES])}) AND v.subject IS NOT NULL GROUP BY v.subject`.execute(db)
    ).rows;
    pageRows = (
      await sql<Row>`SELECT v.page AS key, count(*) AS views, sum(v.seconds) AS seconds, ${deviceDays} AS devices, count(DISTINCT v.account_id) AS collectors
                       FROM collector_views v WHERE ${rows} AND v.page <> ${SCAN} GROUP BY v.page`.execute(db)
    ).rows;
  }
  const detail = source === 'DETAIL';
  const viewsOf = new Map(byDayRows.map((r) => [r.day, asNumber(r.views)]));
  const models = await modelsWithMain(db, modelRows.map((r) => String(r.key)));
  const titles = await dropTitles(db, releaseRows.map((r) => String(r.key)));
  const seconds = asNumber(total.seconds);
  const pageSeconds = pageRows.reduce((s, r) => s + asNumber(r.seconds), 0);
  const bySeconds = <T extends { seconds: number; views: number }>(a: T, b: T) => b.seconds - a.seconds || b.views - a.views;
  return {
    window: w,
    views: asNumber(total.views),
    seconds,
    scans: asNumber(total.scans),
    devices: asNumber(total.devices),
    collectors: detail ? asNumber(total.collectors) : null,
    byDay: daysOf(w).map((day) => ({ day, views: viewsOf.get(day) ?? 0 })),
    models: modelRows
      .map((r) => {
        const m = models.get(String(r.key));
        return {
          modelId: String(r.key),
          mainModelId: m?.main ?? String(r.key),
          name: m?.name ?? null,
          variant: m?.variant ?? null,
          views: asNumber(r.views),
          seconds: asNumber(r.seconds),
          devices: asNumber(r.devices),
          collectors: detail ? asNumber(r.collectors) : null,
        };
      })
      .sort((a, b) => bySeconds(a, b) || a.modelId.localeCompare(b.modelId)),
    releases: releaseRows
      .map((r) => ({
        dropId: String(r.key),
        title: titles.get(String(r.key)) ?? null,
        views: asNumber(r.views),
        seconds: asNumber(r.seconds),
        liveSeconds: asNumber(r.live),
        devices: asNumber(r.devices),
        collectors: detail ? asNumber(r.collectors) : null,
      }))
      .sort((a, b) => bySeconds(a, b) || a.dropId.localeCompare(b.dropId)),
    pages: pageRows
      .map((r) => ({
        page: VIEW_PAGES[Number(r.key) as keyof typeof VIEW_PAGES] as ViewPage,
        views: asNumber(r.views),
        seconds: asNumber(r.seconds),
        share: pageSeconds > 0 ? Math.round((asNumber(r.seconds) * 100) / pageSeconds) : 0,
      }))
      .sort((a, b) => bySeconds(a, b) || a.page.localeCompare(b.page)),
  };
}

/** Which reading a report takes, and the detail's window. */
function plan(w: DayWindow, f: ViewFilters | undefined, now: Date): { source: ReportSource; window: DayWindow | null; reachesBackTo: string | null } {
  if (!f?.accounts) return { source: 'DAILY', window: w, reachesBackTo: null };
  const d = detailWindow(w, now);
  return { source: 'DETAIL', window: d.window, reachesBackTo: d.reachesBackTo };
}

const emptyViews = (w: DayWindow, source: ReportSource): ViewsFigures => ({
  window: w,
  views: 0,
  seconds: 0,
  scans: 0,
  devices: 0,
  collectors: source === 'DETAIL' ? 0 : null,
  byDay: [],
  models: [],
  releases: [],
  pages: [],
});

/**
 * What they look at (T.4.2): views, time, devices a day, collectors (the detail), views by day, the models (variants
 * their own rows with their main model), the releases and the pages. With `compare`, the previous period too.
 */
export async function viewsReport(db: Db, window: DayWindow, filters: ViewFilters | undefined, opts: { now: Date; compare?: boolean }): Promise<ViewsReport> {
  const w = checkWindow(window);
  const countries = cleanCountries(filters?.countries);
  const read = async (x: DayWindow) => {
    const p = plan(x, filters, opts.now);
    return { p, figures: p.window ? await viewsFigures(db, p.window, filters, countries, p.source) : emptyViews(x, p.source) };
  };
  const current = await read(w);
  const previous = opts.compare ? (await read(previousWindow(w))).figures : null;
  return { source: current.p.source, through: await viewsCountedThrough(db), reachesBackTo: current.p.reachesBackTo, current: current.figures, previous };
}

/** A system line of the Devices panel: an iPad on its own line (T.4.2). */
export type SystemLine = DeviceSystem | 'IPAD';
export type DevicesBy = 'DEVICES' | 'COLLECTORS' | 'VISITS';

export interface DevicesFigures {
  window: DayWindow;
  total: number;
  kinds: Record<DeviceKind, number>;
  systems: Record<SystemLine, number>;
  openedIn: Record<OpenedIn, number>;
  apps: Record<InApp, number>;
  /** The browsers, the most first. */
  browsers: { browser: DeviceBrowser; count: number }[];
}

export interface DevicesReport extends ReportHead {
  by: DevicesBy;
  current: DevicesFigures;
  previous: DevicesFigures | null;
}

const systemLine = (kind: string, os: string): SystemLine => (os === 'IOS' && kind === 'TABLET' ? 'IPAD' : (os as DeviceSystem));

function foldDevices(w: DayWindow, rows: readonly { kind: string; os: string; browser: string; opened_in: string; in_app: string | null; n: unknown }[]): DevicesFigures {
  const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const out: DevicesFigures = {
    window: w,
    total: 0,
    kinds: zero(DEVICE_KINDS),
    systems: zero<SystemLine>([...DEVICE_SYSTEMS, 'IPAD']),
    openedIn: zero(OPENED_IN),
    apps: zero(IN_APPS),
    browsers: [],
  };
  const browsers = new Map<DeviceBrowser, number>();
  for (const r of rows) {
    const n = asNumber(r.n);
    if (n === 0) continue;
    out.total += n;
    out.kinds[r.kind as DeviceKind] += n;
    out.systems[systemLine(r.kind, r.os)] += n;
    out.openedIn[r.opened_in as OpenedIn] += n;
    if (r.in_app && r.in_app !== 'NONE') out.apps[r.in_app as InApp] += n;
    browsers.set(r.browser as DeviceBrowser, (browsers.get(r.browser as DeviceBrowser) ?? 0) + n);
  }
  out.browsers = [...browsers].map(([browser, count]) => ({ browser, count })).sort((a, b) => b.count - a.count || a.browser.localeCompare(b.browser));
  return out;
}

/** Each collector's main device in a window: the one with the most time there (ties: the most rows, the latest, the lowest id). */
function mainDevices(w: DayWindow, f: ViewFilters | undefined, countries: string[]): RawBuilder<unknown> {
  return sql`
    SELECT DISTINCT ON (r.account_id) r.account_id, r.device_id
      FROM (SELECT v.account_id, v.device_id, sum(v.seconds) AS s, count(*) AS n, max(v.at) AS last
              FROM collector_views v WHERE ${detailRows(w, f, countries)} GROUP BY v.account_id, v.device_id) r
     ORDER BY r.account_id, r.s DESC, r.n DESC, r.last DESC, r.device_id`;
}

async function devicesFigures(db: Db, w: DayWindow, f: ViewFilters | undefined, countries: string[], by: DevicesBy): Promise<DevicesFigures> {
  type Row = { kind: string; os: string; browser: string; opened_in: string; in_app: string | null; n: unknown };
  let rows: Row[];
  if (by === 'DEVICES') {
    rows = (
      await sql<Row>`SELECT s.kind, s.os, s.browser, s.opened_in, s.in_app, sum(s.devices) AS n FROM device_daily_stats s
         WHERE s.day >= ${w.from}::date AND s.day <= ${w.to}::date${countries.length ? sql` AND s.country IN (${sql.join(countries)})` : sql``}
         GROUP BY s.kind, s.os, s.browser, s.opened_in, s.in_app`.execute(db)
    ).rows;
  } else if (by === 'COLLECTORS') {
    rows = (
      await sql<Row>`SELECT td.kind, td.os, td.browser, td.opened_in, td.in_app, count(*) AS n
                       FROM (${mainDevices(w, f, countries)}) m JOIN tracking_devices td ON td.id = m.device_id
                      GROUP BY td.kind, td.os, td.browser, td.opened_in, td.in_app`.execute(db)
    ).rows;
  } else {
    rows = (
      await sql<Row>`SELECT td.kind, td.os, td.browser, td.opened_in, td.in_app, count(*) FILTER (WHERE r.prev IS NULL OR r.at - r.prev > ${GAP}) AS n
                       FROM (SELECT v.device_id, v.at, lag(v.at) OVER (PARTITION BY v.account_id, v.device_id ORDER BY v.at, v.id) AS prev
                               FROM collector_views v WHERE ${detailRows(w, f, countries)}) r
                       JOIN tracking_devices td ON td.id = r.device_id
                      GROUP BY td.kind, td.os, td.browser, td.opened_in, td.in_app`.execute(db)
    ).rows;
  }
  return foldDevices(w, rows);
}

/**
 * The Devices panel (T.4.2): DEVICES every device seen, anonymous included, summed per Paris day from the daily totals
 * (the country filter only); COLLECTORS each collector once, under its main device of the period; VISITS each visit of
 * the collectors. COLLECTORS and VISITS read the detail (every counted collector when no `accounts` is given).
 */
export async function devicesReport(
  db: Db,
  window: DayWindow,
  filters: ViewFilters | undefined,
  opts: { now: Date; by?: DevicesBy; compare?: boolean },
): Promise<DevicesReport> {
  const w = checkWindow(window);
  const by = opts.by ?? 'DEVICES';
  const countries = cleanCountries(filters?.countries);
  const read = async (x: DayWindow) => {
    if (by === 'DEVICES') return { reachesBackTo: null, source: 'DAILY' as const, figures: await devicesFigures(db, x, filters, countries, by) };
    const d = detailWindow(x, opts.now);
    return { reachesBackTo: d.reachesBackTo, source: 'DETAIL' as const, figures: d.window ? await devicesFigures(db, d.window, filters, countries, by) : foldDevices(x, []) };
  };
  const current = await read(w);
  const previous = opts.compare ? (await read(previousWindow(w))).figures : null;
  return { by, source: current.source, through: await viewsCountedThrough(db), reachesBackTo: current.reachesBackTo, current: current.figures, previous };
}

export interface PlacesReport {
  /** Counted collectors by the country of their usual place (the place with most days, from the connection). */
  countries: { country: string; collectors: number }[];
  cities: { placeId: number; country: string; city: string; collectors: number }[];
  /** Counted collectors with no place recorded. */
  unknown: number;
  /** Collectors whose usual place has a country and no city. */
  noCity: number;
}

/** Each counted collector's usual place: the most days, then the latest day, then the lowest place id. */
function usualPlaces(f: ViewFilters | undefined): RawBuilder<unknown> {
  return sql`
    SELECT DISTINCT ON (cp.account_id) cp.account_id, cp.place_id
      FROM collector_places cp WHERE cp.account_id IN (${countedIds(f)})
     ORDER BY cp.account_id, cp.days DESC, cp.last_day DESC, cp.place_id`;
}

/**
 * Places (T.4.2): counted collectors by their usual place (`collector_places`, kept for good, so for every period).
 * `countries` keeps the usual places of those countries.
 */
export async function placesReport(db: Db, filters?: ViewFilters): Promise<PlacesReport> {
  const countries = cleanCountries(filters?.countries);
  const rows = (
    await sql<{ place_id: number; country: string; city: string | null; n: unknown }>`
      SELECT gp.id AS place_id, gp.country, gp.city, count(*) AS n
        FROM (${usualPlaces(filters)}) u JOIN geo_places gp ON gp.id = u.place_id
       ${countries.length ? sql`WHERE gp.country IN (${sql.join(countries)})` : sql``}
       GROUP BY gp.id, gp.country, gp.city`.execute(db)
  ).rows;
  const byCountryMap = new Map<string, number>();
  let noCity = 0;
  const cities: PlacesReport['cities'] = [];
  for (const r of rows) {
    const n = asNumber(r.n);
    const country = r.country.trim();
    byCountryMap.set(country, (byCountryMap.get(country) ?? 0) + n);
    if (r.city === null) noCity += n;
    else cities.push({ placeId: r.place_id, country, city: r.city, collectors: n });
  }
  const unknown = countries.length
    ? 0
    : asNumber(
        (await sql<{ n: unknown }>`SELECT count(*) AS n FROM (${countedIds(filters)}) c WHERE NOT EXISTS (SELECT 1 FROM collector_places cp WHERE cp.account_id = c.id)`.execute(db)).rows[0]?.n,
      );
  return {
    countries: [...byCountryMap].map(([country, collectors]) => ({ country, collectors })).sort((a, b) => b.collectors - a.collectors || a.country.localeCompare(b.country)),
    cities: cities.sort((a, b) => b.collectors - a.collectors || a.country.localeCompare(b.country) || a.city.localeCompare(b.city)),
    unknown,
    noCity,
  };
}

// ── The click-through (T.4.2, T.8.6) ──────────────────────────────────────────────────────────────────────────

/** The figure behind a click: a model (a main model with its variants), a release, a page, a device's class, a place. */
export type CollectorsFigure =
  | { kind: 'MODEL'; id: string }
  | { kind: 'RELEASE'; id: string }
  | { kind: 'PAGE'; id: ViewPage }
  | { kind: 'DEVICE'; id: DeviceKind }
  | { kind: 'SYSTEM'; id: SystemLine }
  | { kind: 'OPENED_IN'; id: OpenedIn }
  | { kind: 'APP'; id: InApp }
  | { kind: 'COUNTRY'; id: string }
  | { kind: 'CITY'; id: number };

export interface CollectorsPage {
  rows: { accountId: string; email: string; name: string | null; country: string | null; city: string | null; views: number; seconds: number }[];
  total: number;
  page: number;
  pageSize: number;
  reachesBackTo: string | null;
}

/** A model and its variants when it is a main model; a variant only itself. */
const modelAndVariants = (id: string) => sql`SELECT m.id FROM models m WHERE m.id = ${id}::uuid OR m.variant_of = ${id}::uuid`;

/**
 * The collectors behind one figure (T.4.2's click-through; §3.6 C.6.5's slices `viewed`, `device`, `system`,
 * `openedin`, `app`, `conncountry`, `conncity`): MODEL, RELEASE and PAGE those who looked at it in the window; DEVICE,
 * SYSTEM, OPENED_IN and APP those whose main device of the window is of it (devicesReport's COLLECTORS); COUNTRY and CITY
 * those whose usual place is there (placesReport). Counted collectors only, the filters applied. A page at a time:
 * `order` 'TIME' the most time first (T.8.6), 'EMAIL' by email (the Collectors page's lists, §3.6 C.6.5); each row's
 * views and seconds are those of the figure in the window (all of the window's for a device or a place). The city is
 * the usual one from the connection, withheld unless `withCities`.
 */
export async function collectorsFor(
  db: Db,
  figure: CollectorsFigure,
  window: DayWindow,
  filters: ViewFilters | undefined,
  opts: { now: Date; page?: number; pageSize?: number; order?: 'TIME' | 'EMAIL'; withCities: boolean },
): Promise<CollectorsPage> {
  const w = checkWindow(window);
  const countries = cleanCountries(filters?.countries);
  const pageSize = Math.min(COLLECTORS_PAGE_MAX, Math.max(1, Math.floor(opts.pageSize ?? COLLECTORS_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const d = detailWindow(w, opts.now);
  const empty: CollectorsPage = { rows: [], total: 0, page, pageSize, reachesBackTo: d.reachesBackTo };
  const placeFigure = figure.kind === 'COUNTRY' || figure.kind === 'CITY';
  if (!d.window && !placeFigure) return empty;
  const dw = d.window ?? w;
  const rows = detailRows(dw, filters, countries);
  let members: RawBuilder<unknown>;
  let only: RawBuilder<unknown> = sql`TRUE`;
  switch (figure.kind) {
    case 'MODEL':
      if (!UUID_RE.test(figure.id)) return empty;
      only = sql`v.page = ${MODEL} AND v.subject IN (${modelAndVariants(figure.id)})`;
      members = sql`SELECT DISTINCT v.account_id FROM collector_views v WHERE ${rows} AND ${only}`;
      break;
    case 'RELEASE':
      if (!UUID_RE.test(figure.id)) return empty;
      only = sql`v.page IN (${sql.join([...RELEASE_PAGES])}) AND v.subject = ${figure.id}::uuid`;
      members = sql`SELECT DISTINCT v.account_id FROM collector_views v WHERE ${rows} AND ${only}`;
      break;
    case 'PAGE': {
      const code = VIEW_PAGE_CODES[figure.id];
      if (!code) return empty;
      only = sql`v.page = ${code}`;
      members = sql`SELECT DISTINCT v.account_id FROM collector_views v WHERE ${rows} AND ${only}`;
      break;
    }
    case 'DEVICE':
    case 'SYSTEM':
    case 'OPENED_IN':
    case 'APP': {
      const match =
        figure.kind === 'DEVICE'
          ? sql`td.kind = ${figure.id}`
          : figure.kind === 'OPENED_IN'
            ? sql`td.opened_in = ${figure.id}`
            : figure.kind === 'APP'
              ? sql`td.in_app = ${figure.id}`
              : figure.id === 'IPAD'
                ? sql`td.os = 'IOS' AND td.kind = 'TABLET'`
                : figure.id === 'IOS'
                  ? sql`td.os = 'IOS' AND td.kind <> 'TABLET'`
                  : sql`td.os = ${figure.id}`;
      members = sql`SELECT m.account_id FROM (${mainDevices(dw, filters, countries)}) m JOIN tracking_devices td ON td.id = m.device_id WHERE ${match}`;
      break;
    }
    case 'COUNTRY':
    case 'CITY': {
      const match = figure.kind === 'COUNTRY' ? sql`gp.country = ${String(figure.id).toUpperCase()}` : sql`gp.id = ${Number(figure.id)}::integer`;
      members = sql`SELECT u.account_id FROM (${usualPlaces(filters)}) u JOIN geo_places gp ON gp.id = u.place_id WHERE ${match}`;
      break;
    }
  }
  const agg = d.window
    ? sql`SELECT v.account_id, (count(*) FILTER (WHERE v.page <> ${SCAN}))::int AS views, coalesce(sum(v.seconds), 0)::bigint AS seconds
            FROM collector_views v WHERE ${rows} AND ${only} AND v.account_id IN (SELECT account_id FROM m) GROUP BY v.account_id`
    : sql`SELECT NULL::uuid AS account_id, 0 AS views, 0 AS seconds WHERE FALSE`;
  const order = opts.order === 'EMAIL' ? sql`a.email_normalized, a.id` : sql`coalesce(g.seconds, 0) DESC, coalesce(g.views, 0) DESC, a.email_normalized, a.id`;
  const r = await sql<{ id: string; email: string; display_name: string | null; country: string | null; views: unknown; seconds: unknown; total: unknown }>`
    WITH m AS (${members}), g AS (${agg})
    SELECT a.id, a.email, a.display_name, a.country, coalesce(g.views, 0) AS views, coalesce(g.seconds, 0) AS seconds, count(*) OVER () AS total
      FROM m JOIN accounts a ON a.id = m.account_id LEFT JOIN g ON g.account_id = a.id
     ORDER BY ${order}
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(db);
  let cities = new Map<string, string | null>();
  if (opts.withCities && r.rows.length > 0) {
    const ids = r.rows.map((x) => x.id);
    cities = new Map(
      (
        await sql<{ account_id: string; city: string | null }>`
          SELECT u.account_id, gp.city FROM (SELECT DISTINCT ON (cp.account_id) cp.account_id, cp.place_id FROM collector_places cp
            WHERE cp.account_id IN (${sql.join(ids)}) ORDER BY cp.account_id, cp.days DESC, cp.last_day DESC, cp.place_id) u
            JOIN geo_places gp ON gp.id = u.place_id`.execute(db)
      ).rows.map((x) => [x.account_id, x.city]),
    );
  }
  return {
    rows: r.rows.map((x) => ({
      accountId: x.id,
      email: x.email,
      name: x.display_name,
      country: x.country?.trim() || null,
      city: opts.withCities ? (cities.get(x.id) ?? null) : null,
      views: asNumber(x.views),
      seconds: asNumber(x.seconds),
    })),
    total: asNumber(r.rows[0]?.total),
    page,
    pageSize,
    reachesBackTo: d.reachesBackTo,
  };
}

// ── Activity (T.8.6) ──────────────────────────────────────────────────────────────────────────────────────────

export interface Activity {
  views: number;
  seconds: number;
  activeDays: number;
  /** A device's views more than VISIT_GAP_MINUTES apart begin a new visit. */
  visits: number;
}

/**
 * Per account, its views, seconds, active Paris days and visits in a window (the detail; a window reaching past 13 months
 * is read from the first day kept, named by `reachesBackTo`). Accounts with nothing are absent from `byAccount`.
 * The Collectors page's activity and other sections; the score reads its SCAN rows on its own (§3.5).
 */
export async function activityOf(db: Db, accountIds: readonly string[], window: DayWindow, opts: { now: Date }): Promise<{ byAccount: Map<string, Activity>; reachesBackTo: string | null }> {
  const w = checkWindow(window);
  const d = detailWindow(w, opts.now);
  const ids = [...new Set(accountIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()))];
  const byAccount = new Map<string, Activity>();
  if (!d.window || ids.length === 0) return { byAccount, reachesBackTo: d.reachesBackTo };
  const start = parisDayStart(d.window.from);
  const end = parisDayStart(nextParisDay(d.window.to));
  const day = sql`width_bucket(r.at, ${bucketsOf(d.window)})`;
  for (let i = 0; i < ids.length; i += TRACKING_EXPORT_CHUNK) {
    const chunk = ids.slice(i, i + TRACKING_EXPORT_CHUNK);
    const r = await sql<{ account_id: string; views: unknown; seconds: unknown; days: unknown; visits: unknown }>`
      SELECT r.account_id, (count(*) FILTER (WHERE r.page <> ${SCAN}))::int AS views, coalesce(sum(r.seconds), 0)::bigint AS seconds,
             (count(DISTINCT ${day}))::int AS days, (count(*) FILTER (WHERE r.prev IS NULL OR r.at - r.prev > ${GAP}))::int AS visits
        FROM (SELECT v.account_id, v.at, v.page, v.seconds, lag(v.at) OVER (PARTITION BY v.account_id, v.device_id ORDER BY v.at, v.id) AS prev
                FROM collector_views v WHERE v.account_id IN (${sql.join(chunk)}) AND v.at >= ${start} AND v.at < ${end}) r
       GROUP BY r.account_id`.execute(db);
    for (const x of r.rows) byAccount.set(x.account_id, { views: asNumber(x.views), seconds: asNumber(x.seconds), activeDays: asNumber(x.days), visits: asNumber(x.visits) });
  }
  return { byAccount, reachesBackTo: d.reachesBackTo };
}

// ── Segments' BROWSING criteria (T.4.3) ───────────────────────────────────────────────────────────────────────

/** The four criteria of the BROWSING group, as services/segments.ts holds them (its `not` aside). */
export type BrowsingRule =
  | { kind: 'VIEWED_MODEL'; modelIds: readonly string[]; min: number; days: number }
  | { kind: 'VIEWED_RELEASE'; dropId: string; min: number }
  | { kind: 'DEVICE'; kinds?: readonly DeviceKind[]; systems?: readonly DeviceSystem[]; openedIn?: readonly OpenedIn[]; apps?: readonly InApp[]; days: number }
  | { kind: 'PLACE'; countries?: readonly string[]; placeIds?: readonly number[]; days: number };

function whole(v: number, b: { min: number; max: number }, what: string): number {
  if (!Number.isInteger(v) || v < b.min || v > b.max) throw validationError(`${what}: from ${b.min} to ${b.max}.`);
  return v;
}

/** The first instant of the last `days` Paris days, today included. */
const sinceDays = (now: Date, days: number): Date => parisDayStart(addParisDays(parisDay(now), -(days - 1)));

/**
 * A BROWSING criterion as one condition on the account `account` (T.4.3, §3.6 C.5.1), each an EXISTS or a count on an
 * index that leads with the account: VIEWED_MODEL its MODEL views of the models named (a main model with its variants)
 * in the last `days` Paris days, at least `min`; VIEWED_RELEASE its views of the release (its page, its LIVE room, its
 * after-room) over the 13 months, at least `min`; DEVICE a device of its, not staff's, matching every list given, used
 * in the last `days` (its last link, or its last sight while it is linked to the account); PLACE a place of its from the
 * connection in one of the countries or places named, on a day of the last `days`. Test entrants never match: they have
 * no rows. Bounds checked (400 VALIDATION_FAILED): `days` 1–395, `min` 1–100, at least one list.
 */
export function browsingCondition(rule: BrowsingRule, account: Expression<string>, now: Date): Expression<SqlBool> {
  switch (rule.kind) {
    case 'VIEWED_MODEL': {
      const days = whole(rule.days, VIEW_RULE_DAYS, 'Viewed a model in the last N days');
      const min = whole(rule.min, VIEW_RULE_MIN, 'Viewed a model at least N times');
      if (rule.modelIds.length === 0) throw validationError('Viewed a model: choose at least one model.');
      const ids = sql.join(rule.modelIds.map((x) => sql`${x}::uuid`));
      return sql<SqlBool>`((SELECT count(*) FROM collector_views bv WHERE bv.account_id = ${account} AND bv.at >= ${sinceDays(now, days)} AND bv.page = ${MODEL}
        AND bv.subject IN (SELECT bm.id FROM models bm WHERE bm.id IN (${ids}) OR bm.variant_of IN (${ids}))) >= ${min})`;
    }
    case 'VIEWED_RELEASE': {
      const min = whole(rule.min, VIEW_RULE_MIN, 'Viewed a release at least N times');
      return sql<SqlBool>`((SELECT count(*) FROM collector_views bv WHERE bv.account_id = ${account} AND bv.at >= ${viewHistoryCutoff(now)}
        AND bv.page IN (${sql.join([...RELEASE_PAGES])}) AND bv.subject = ${rule.dropId}::uuid) >= ${min})`;
    }
    case 'DEVICE': {
      const days = whole(rule.days, VIEW_RULE_DAYS, 'Device: in the last N days');
      const lists: RawBuilder<unknown>[] = [];
      if (rule.kinds?.length) lists.push(sql`bd.kind IN (${sql.join([...rule.kinds])})`);
      if (rule.systems?.length) lists.push(sql`bd.os IN (${sql.join([...rule.systems])})`);
      if (rule.openedIn?.length) lists.push(sql`bd.opened_in IN (${sql.join([...rule.openedIn])})`);
      if (rule.apps?.length) lists.push(sql`bd.in_app IN (${sql.join([...rule.apps])})`);
      if (lists.length === 0) throw validationError('Device: tick at least one.');
      const since = sinceDays(now, days);
      return sql<SqlBool>`EXISTS (SELECT 1 FROM tracking_device_accounts bda JOIN tracking_devices bd ON bd.id = bda.device_id
        WHERE bda.account_id = ${account} AND bd.staff_at IS NULL AND ${sql.join(lists, sql` AND `)}
          AND (bda.last_linked_at >= ${since} OR (bd.account_id = ${account} AND bd.last_seen_at >= ${since})))`;
    }
    case 'PLACE': {
      const days = whole(rule.days, VIEW_RULE_DAYS, 'Seen from: in the last N days');
      const countries = cleanCountries(rule.countries);
      const placeIds = (rule.placeIds ?? []).filter((x) => Number.isInteger(x) && x > 0);
      if (countries.length === 0 && placeIds.length === 0) throw validationError('Seen from: choose at least one place.');
      const any: RawBuilder<unknown>[] = [];
      if (countries.length) any.push(sql`bg.country IN (${sql.join(countries)})`);
      if (placeIds.length) any.push(sql`bp.place_id IN (${sql.join(placeIds)})`);
      return sql<SqlBool>`EXISTS (SELECT 1 FROM collector_places bp JOIN geo_places bg ON bg.id = bp.place_id
        WHERE bp.account_id = ${account} AND bp.last_day >= ${addParisDays(parisDay(now), -(days - 1))}::date AND (${sql.join(any, sql` OR `)}))`;
    }
  }
}

// ── The Collectors export's tracking columns (T.4.4) ──────────────────────────────────────────────────────────

/** The tracking columns of the Collectors export, in their order (§3.6 C.7 places them among its 76). */
export const TRACKING_EXPORT_COLUMNS = [
  'first_visit_at',
  'days_browsing_before_sign_up',
  'views_13_months',
  'minutes_13_months',
  'active_days_30',
  'active_days_90',
  'last_seen_at',
  'top_models',
  'releases_viewed',
  'scans',
  'scans_before_account',
  'devices',
  'main_device',
  'opened_in_apps',
  'usual_country',
  'usual_city',
  'other_cities',
  'views_before_13_months',
  'minutes_before_13_months',
] as const;
export type TrackingExportColumn = (typeof TRACKING_EXPORT_COLUMNS)[number];

export interface TrackingExportRow {
  first_visit_at: Date | null;
  days_browsing_before_sign_up: number;
  views_13_months: number;
  minutes_13_months: number;
  active_days_30: number;
  active_days_90: number;
  last_seen_at: Date | null;
  /** The top three, « MONOLITHE BLUE; ORBITE ». */
  top_models: string;
  releases_viewed: number;
  scans: number;
  scans_before_account: number;
  /** « iPhone Safari; Computer macOS Chrome », the latest first. */
  devices: string;
  /** « Phone iOS »; empty without a device. */
  main_device: string;
  /** « Instagram; TikTok », or empty. */
  opened_in_apps: string;
  usual_country: string;
  usual_city: string;
  /** The other places' cities, the most days first: « Lyon; Milan ». */
  other_cities: string;
  views_before_13_months: number;
  minutes_before_13_months: number;
}

/** A model as the export's top models write it: its name, then its variant in capitals. */
const modelWords = (m: { name: string; variant: string | null } | undefined): string => (m ? (m.variant ? `${m.name} ${m.variant.toUpperCase()}` : m.name) : '(withdrawn)');

/**
 * The Collectors export's tracking columns per account (T.4.4), TRACKING_EXPORT_CHUNK accounts a round of set-based
 * queries. Counted collectors only: a test entrant, a team account or a DELETED account gets no row (§3.0 (d)).
 */
export async function exportColumns(db: Db, accountIds: readonly string[], opts: { now: Date }): Promise<Map<string, TrackingExportRow>> {
  const out = new Map<string, TrackingExportRow>();
  const wanted = [...new Set(accountIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()))];
  for (let i = 0; i < wanted.length; i += TRACKING_EXPORT_CHUNK) {
    const chunk = wanted.slice(i, i + TRACKING_EXPORT_CHUNK);
    const counted = (await sql<{ id: string }>`SELECT a.id FROM accounts a WHERE a.id IN (${sql.join(chunk)}) AND ${countedCollector('a.id')}`.execute(db)).rows.map((r) => r.id);
    if (counted.length === 0) continue;
    const raw = await rawTotals(db, counted, opts.now);
    const summary = await summaryTotals(db, counted);
    const tops = await topSubjects(db, counted, [MODEL], EXPORT_TOP_MODELS, opts.now);
    const devices = await devicesOf(db, counted);
    const places = await placesOf(db, counted);
    const main = await sql<{ account_id: string; kind: string; os: string }>`
      SELECT DISTINCT ON (r.account_id) r.account_id, td.kind, td.os
        FROM (SELECT v.account_id, v.device_id, sum(v.seconds) AS s, count(*) AS n, max(v.at) AS last FROM collector_views v
               WHERE v.account_id IN (${sql.join(counted)}) AND v.at >= ${viewHistoryCutoff(opts.now)} GROUP BY v.account_id, v.device_id) r
        JOIN tracking_devices td ON td.id = r.device_id
       ORDER BY r.account_id, r.s DESC, r.n DESC, r.last DESC, r.device_id`.execute(db);
    const mainOf = new Map(main.rows.map((m) => [m.account_id, m]));
    const names = await modelNames(db, [...tops.values()].flat().map((t) => t.subject));
    const releasesRaw = await sql<{ account_id: string; subject: string }>`
      SELECT DISTINCT v.account_id, v.subject FROM collector_views v
       WHERE v.account_id IN (${sql.join(counted)}) AND v.at >= ${viewHistoryCutoff(opts.now)} AND v.page IN (${sql.join([...RELEASE_PAGES])}) AND v.subject IS NOT NULL`.execute(db);
    const releases = new Map<string, Set<string>>();
    for (const x of releasesRaw.rows) releases.set(x.account_id, (releases.get(x.account_id) ?? new Set()).add(x.subject));
    for (const id of counted) {
      const r = raw.get(id);
      const s = summary.get(id);
      const ps = places.get(id) ?? [];
      const usual = ps[0];
      const ds = devices.get(id) ?? [];
      const apps = [...new Set(ds.filter((d) => d.openedIn === 'IN_APP').map((d) => APP_WORDS[d.app ?? 'OTHER']))];
      const m = mainOf.get(id);
      const released = new Set([...(releases.get(id) ?? []), ...(s?.releases ?? [])]);
      out.set(id, {
        first_visit_at: earliest(r?.firstAt ?? null, s?.firstAt ?? null),
        days_browsing_before_sign_up: r?.daysBefore ?? 0,
        views_13_months: r?.views ?? 0,
        minutes_13_months: Math.round((r?.seconds ?? 0) / 60),
        active_days_30: r?.active30 ?? 0,
        active_days_90: r?.active90 ?? 0,
        last_seen_at: r?.lastAt ?? null,
        top_models: (tops.get(id) ?? []).map((t) => modelWords(names.get(t.subject))).join('; '),
        releases_viewed: released.size,
        scans: (r?.scans ?? 0) + (s?.scans ?? 0),
        scans_before_account: r?.scansBefore ?? 0,
        devices: ds.map((d) => deviceWords(d)).join('; '),
        main_device: m ? mainDeviceWords({ kind: m.kind as DeviceKind, system: m.os as DeviceSystem }) : '',
        opened_in_apps: apps.join('; '),
        usual_country: usual?.country ?? '',
        usual_city: usual?.city ?? '',
        other_cities: [...new Set(ps.slice(1).map((p) => p.city).filter((c): c is string => c !== null && c !== usual?.city))].join('; '),
        views_before_13_months: s?.views ?? 0,
        minutes_before_13_months: Math.round((s?.seconds ?? 0) / 60),
      });
    }
  }
  return out;
}

// ── The right of access (§3.0 (k)) ────────────────────────────────────────────────────────────────────────────

export interface ExportedBrowsing {
  /** The devices linked to the account, by their class in words; never a device's pseudonym, never one marked staff. */
  devices: { device: string; openedIn: string; firstSeenAt: Date; lastSeenAt: Date; linkedAt: 'SIGN_UP' | 'SIGN_IN' | 'SESSION' }[];
  /** Its places from the connection (approximate, IP geolocation by DB-IP): the Paris days seen from there. */
  places: { country: string; city: string | null; days: number; firstDay: string; lastDay: string }[];
  /** The 13 months of views and scans, by page and what it was about: how many, how long, the first and the last. */
  views: { page: ViewPage; about: string | null; views: number; seconds: number; firstAt: Date; lastAt: Date }[];
  /** The summary written as each Paris month ends: views (scans apart), seconds, scans, active Paris days. */
  months: { month: string; views: number; seconds: number; scans: number; activeDays: number }[];
  /** The summary of what passed 13 months, by page and what it was about. */
  before: { page: ViewPage; about: string | null; views: number; seconds: number; firstAt: Date; lastAt: Date }[];
}

/** What a row was about, in words: a model (« MONOLITHE · Blue »), a release's or a post's title. */
async function aboutWords(db: Db, rows: readonly { page: number; subject: string | null }[]): Promise<(p: number, s: string | null) => string | null> {
  const subjects = (pred: (p: number) => boolean) => [...new Set(rows.filter((r) => r.subject && r.subject !== NIL_UUID && pred(r.page)).map((r) => r.subject!))];
  const models = await modelNames(db, subjects((p) => MODEL_SUBJECT_PAGES.has(p)));
  const drops = await dropTitles(db, subjects((p) => (RELEASE_PAGES as readonly number[]).includes(p)));
  const postIds = subjects((p) => p === VIEW_PAGE_CODES.POST);
  const posts = new Map(
    postIds.length ? (await db.selectFrom('circle_posts').select(['id', 'title']).where('id', 'in', postIds).execute()).map((x) => [x.id, x.title]) : [],
  );
  return (p, s) => {
    if (!s || s === NIL_UUID) return null;
    if (MODEL_SUBJECT_PAGES.has(p)) {
      const m = models.get(s);
      return m ? (m.variant ? `${m.name} · ${m.variant}` : m.name) : null;
    }
    if ((RELEASE_PAGES as readonly number[]).includes(p)) return drops.get(s) ?? null;
    if (p === VIEW_PAGE_CODES.POST) return posts.get(s) ?? null;
    return null;
  };
}

/** The right-of-access `browsing` of one account (§3.0 (k), T.4.4), read in the export's transaction `db`. */
export async function exportedBrowsing(db: Db, accountId: string, now: Date): Promise<ExportedBrowsing> {
  const ids = [accountId];
  const devices = (await devicesOf(db, ids)).get(accountId) ?? [];
  const places = (await placesOf(db, ids)).get(accountId) ?? [];
  const views = await db
    .selectFrom('collector_views')
    .select(['page', 'subject', (eb) => eb.fn.countAll<string>().as('views'), (eb) => eb.fn.sum<string>('seconds').as('seconds'), (eb) => eb.fn.min('at').as('first_at'), (eb) => eb.fn.max('at').as('last_at')])
    .where('account_id', '=', accountId)
    .where('at', '>=', viewHistoryCutoff(now))
    .groupBy(['page', 'subject'])
    .orderBy('page')
    .orderBy(sql`min(at)`)
    .execute();
  const months = await db.selectFrom('collector_view_months').selectAll().where('account_id', '=', accountId).orderBy('month').execute();
  const before = await db.selectFrom('collector_view_totals').selectAll().where('account_id', '=', accountId).orderBy('page').orderBy('first_at').execute();
  const about = await aboutWords(db, [...views, ...before]);
  const pageName = (p: number) => VIEW_PAGES[p as keyof typeof VIEW_PAGES] as ViewPage;
  return {
    devices: devices.map((d) => ({ device: deviceWords(d), openedIn: openedInWords(d), firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt, linkedAt: d.firstVia })),
    places: places.map((p) => ({ country: p.country, city: p.city, days: p.days, firstDay: dayText(p.firstDay), lastDay: dayText(p.lastDay) })),
    views: views.map((v) => ({ page: pageName(v.page), about: about(v.page, v.subject), views: Number(v.views), seconds: Number(v.seconds ?? 0), firstAt: v.first_at as Date, lastAt: v.last_at as Date })),
    months: months.map((m) => ({ month: dayText(m.month).slice(0, 7), views: m.views, seconds: Number(m.seconds), scans: m.scans, activeDays: m.active_days })),
    before: before.map((t) => ({ page: pageName(t.page), about: about(t.page, t.subject), views: t.views, seconds: Number(t.seconds), firstAt: t.first_at, lastAt: t.last_at })),
  };
}

/** The entries of a right-of-access `browsing`, for `account.export`'s counts. */
export const exportedBrowsingCount = (b: ExportedBrowsing): number => b.devices.length + b.places.length + b.views.length + b.months.length + b.before.length;
