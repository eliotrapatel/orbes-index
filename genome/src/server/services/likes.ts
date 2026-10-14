/**
 * What they like (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.8, §3.6 C.6.3 item 4; step 9.4): LikesService
 * (`ctx.services.likes`) gives the Collectors page's panel `likes` its figures, for a population of collectors over a
 * period, compared with the previous period. It only reads, as GrowthService does: no audit, no cache (the page's
 * CollectorInsightsService caches the panel), one REPEATABLE READ, READ ONLY transaction (the panel's own when it is
 * called inside one).
 *
 *   wishlists    the collectors with a wish open at the period's end (and their share of the population), the wishes
 *                added and removed in the period; the same for the previous period.
 *   mostWished   by main model, each variant under it (§3.0 (g)): a main row counts the distinct collectors wishing any
 *                of its dots, a variant's row its own; `wished` open at the period's end, `added` in the period,
 *                `previous` open at the previous period's end. The top LIKES_TOP main rows, then `groups`.
 *   collections  the distinct collectors wishing a model of each collection (the wished model's own collection, read
 *                live, as Segments' WISHES_COLLECTION), at the period's end and the previous one's.
 *   pieces, finishes  the collectors who chose each FAVOURITE PIECE or FAVOURITE FINISH (a choice no longer offered by
 *                the collection `retired`, with its stored words), those who chose it in the period (`created_at`; tastes
 *                have no history), the number chosen in the previous period, and the collectors with none chosen.
 *   viewed       MOST VIEWED: COLLECTORS, the views of the population's collectors (signed-in rows of collector_views,
 *                kept 13 months: a period reaching further back is read from the first day kept, `reachesBackTo`), by
 *                main model with its variants and by release, with the collectors who looked, the views, the time and
 *                the median time per collector (withheld under LIKES_MIN_GROUP collectors); ALL VISITORS, every
 *                visitor's views from the daily totals kept for good (tracking-reads.ts viewsReport), where only the
 *                countries apply (the connection's country, the one the totals hold), with What they look at's
 *                figures (§3.3 T.4.2, `look`): Views, Time spent, Visitors, Collectors seen (the counted collectors
 *                with a signed-in view, from the 13 months of detail), Views by day and Pages.
 *   held         PIECES HELD: by main model with its variants, the collectors holding at least one piece now and the
 *                pieces (CLUB_EXCLUDED_STATUSES left out, as the tiers count them).
 *
 * The population (`AccountFilter`) is the page's: CollectorInsightsService passes its `scopeCte` (counted collectors,
 * the five filters, the scope); alone, LikesService reads every counted collector (population.ts `countedCollector`:
 * no test entrant, no team account, no DELETED account). `tasteFilter` is the favourite-type filter it supplies
 * (insights-scope.ts applies it).
 *
 * The 13-month line (W.8): removed wishes are purged 13 Paris months after their removal (wishlist.ts
 * wishHistoryCutoff). A period starting before that line cannot be read from the rows: its wish figures come from the
 * monthly totals (`model_wish_months`, the counted months touching the period), which name no collector and take no
 * filter, and the answer says `raw: false` (the page: 'Older than 13 months: monthly totals, without filters.'). There
 * `wished` and a collection's `collectors` count wishes open at the last month's end, not distinct collectors, and the
 * collectors with a wishlist are unknown (null). When only the previous period starts before the line, its wish
 * figures are withheld (null): the rows cannot give them, and monthly totals without filters would compare unlike
 * with like.
 *
 * Every Paris day and month is computed in JavaScript (schedule.ts) and passed to SQL as a timestamptz or a date
 * (§3.0 (e)).
 */
import { sql, type RawBuilder } from 'kysely';
import { jitOff, type Db } from '../db/connection.js';
import { VIEW_PAGE_CODES, type ViewPage } from '../db/schema.js';
import { tasteKey } from '../../shared/profile-rules.js';
import { systemClock, type Clock } from '../types.js';
import { CLUB_EXCLUDED_STATUSES } from './club.js';
import { GROWTH_MIN_GROUP } from './growth.js';
import { daysApart } from './insights-scope.js';
import { countedCollector } from './population.js';
import { parisDay } from './schedule.js';
import { tasteOptions } from './tastes.js';
import { viewHistoryCutoff } from './tracking.js';
import { collectorsSeen, viewsReport } from './tracking-reads.js';
import { wishHistoryCutoff, wishModelState, type WishModelState } from './wishlist.js';

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The main rows (or collections, or releases) given at most; the page shows 20, then Show all. */
export const LIKES_TOP = 50;
/** A median of fewer collectors is withheld (GROWTH's minimum group). */
export const LIKES_MIN_GROUP = GROWTH_MIN_GROUP;
/**
 * MOST VIEWED, COLLECTORS: a reading of more Paris days reads each collector's own views (collector_views_account_idx),
 * one of fewer the period's views by time (collector_views_at_idx). Measured at 20,000 collectors and 3 M views: the
 * same time either way from about 60 days; under it, the time index is the faster.
 */
export const LIKES_PROBE_AFTER_DAYS = 60;

const MODEL = VIEW_PAGE_CODES.MODEL;
const RELEASE_PAGES = [VIEW_PAGE_CODES.RELEASE, VIEW_PAGE_CODES.LIVE, VIEW_PAGE_CODES.AFTER_ROOM] as const;

// ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A period of whole Paris days, `from` to `to` included, with its instants (`end` exclusive). */
export interface LikesPeriod {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

/** The period read and, with the comparison, the previous one. */
export interface LikesWindow extends LikesPeriod {
  previous: LikesPeriod | null;
}

/**
 * The collectors read for a period: `<name> AS (SELECT … account_id …)`, a CTE with one row per collector and the
 * column `account_id` (CollectorInsightsService passes insights-scope.ts `scopeCte`).
 */
export type AccountFilter = (name: string, period: LikesPeriod) => RawBuilder<unknown>;

/** Every counted collector, whatever the period (LikesService's population by default). */
export const countedCollectors: AccountFilter = (name) => sql`${sql.id(name)} AS (SELECT a.id AS account_id FROM accounts a WHERE ${countedCollector('a.id')})`;

/** The favourite-type filter (W.8), written beside the tastes: the account in `column` chose one of these FAVOURITE PIECES. */
export { tasteFilter } from './tastes.js';

export interface WishedModelRow {
  modelId: string;
  name: string;
  variant: string | null;
  type: string;
  collection: string | null;
  state: WishModelState;
  /** Collectors with a wish open at the period's end (raw: false, the wishes open at the last month's end). */
  wished: number;
  /** Wishes added in the period. */
  added: number;
  /** Open at the previous period's end; null without the comparison, or withheld. */
  previous: number | null;
}

export interface WishedModel extends WishedModelRow {
  variants: WishedModelRow[];
}

export interface WishedCollection {
  collectionId: string;
  name: string;
  collectors: number;
  previous: number | null;
}

export interface TasteFigure {
  key: string;
  label: string;
  retired: boolean;
  collectors: number;
  /** Chosen in the period. */
  chosen: number;
  /** Chosen in the previous period; null without the comparison. */
  previous: number | null;
}

export interface FinishFigure extends TasteFigure {
  swatch: string | null;
}

export interface ViewedModelRow {
  modelId: string;
  name: string | null;
  variant: string | null;
  /** COLLECTORS: the collectors who looked; ALL VISITORS: null (the totals hold devices, not collectors). */
  collectors: number | null;
  views: number;
  seconds: number;
  /** COLLECTORS: the median of each collector's seconds, withheld under LIKES_MIN_GROUP; ALL VISITORS: null. */
  medianSeconds: number | null;
  /** ALL VISITORS: devices summed per Paris day; COLLECTORS: null. */
  visitors: number | null;
}

export interface ViewedModel extends ViewedModelRow {
  variants: ViewedModelRow[];
}

export interface ViewedRelease {
  dropId: string;
  title: string | null;
  collectors: number | null;
  views: number;
  seconds: number;
  medianSeconds: number | null;
  visitors: number | null;
}

export interface HeldModelRow {
  modelId: string;
  name: string;
  variant: string | null;
  collectors: number;
  pieces: number;
}

export interface HeldModel extends HeldModelRow {
  variants: HeldModelRow[];
}

/** What they look at's totals for a period (§3.3 T.4.2), every visitor's from the daily totals. */
export interface LookTotals {
  views: number;
  seconds: number;
  /** Devices summed per Paris day (the daily totals' visitors). */
  visitors: number;
  /** Collectors seen: the counted collectors with a signed-in view (13 months kept); null when not comparable. */
  collectors: number | null;
}

/**
 * MOST VIEWED, ALL VISITORS: What they look at (§3.3 T.4.2): Views, Time spent, Visitors (devices), Collectors seen
 * (accounts), Views by day with the previous period's beside it, and Pages (each page's share of time).
 */
export interface LookFigures extends LookTotals {
  /** The first day kept when the period reaches past the 13 months of detail: Collectors seen counts from it. */
  collectorsFrom: string | null;
  /** The previous period's totals (with the comparison); its Collectors seen null when the detail cannot give it whole. */
  previous: LookTotals | null;
  /** Every Paris day of the period, in order. */
  byDay: { day: string; views: number }[];
  /** Every Paris day of the previous period, in order (with the comparison). */
  previousByDay: { day: string; views: number }[] | null;
  /** Every page's share of time, the most time first. */
  pages: { page: ViewPage; views: number; seconds: number; share: number }[];
}

/** The panel `likes` (§3.6 C.6.3 item 4; W.8's AdminLikes with C.6.3's tabs). */
export interface LikesFigures {
  /** False when the wish figures come from the monthly totals (see the file header). */
  raw: boolean;
  /** The collectors of the population for the period. */
  total: number;
  wishlists: {
    collectors: number | null;
    /** Of the population, in whole percent; null with raw: false. */
    share: number | null;
    added: number;
    removed: number;
    previous: { collectors: number | null; added: number; removed: number } | null;
  };
  mostWished: { rows: WishedModel[]; groups: number };
  collections: { rows: WishedCollection[]; groups: number };
  pieces: { rows: TasteFigure[]; none: number };
  finishes: { rows: FinishFigure[]; none: number };
  viewed: {
    collectors: { models: ViewedModel[]; releases: ViewedRelease[]; groups: number; reachesBackTo: string | null };
    visitors: { models: ViewedModel[]; releases: ViewedRelease[]; groups: number; through: string | null; look: LookFigures };
  };
  held: { rows: HeldModel[]; groups: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number => Number(v ?? 0);
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const within = (column: RawBuilder<unknown>, p: Pick<LikesPeriod, 'start' | 'end'>) => sql`${column} >= ${p.start}::timestamptz AND ${column} < ${p.end}::timestamptz`;
const openAt = (end: Date) => sql`w.added_at < ${end}::timestamptz AND (w.removed_at IS NULL OR w.removed_at >= ${end}::timestamptz)`;
const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;

interface ModelMeta {
  id: string;
  name: string;
  variant_label: string | null;
  variant_of: string | null;
  type: string;
  collection_id: string | null;
  collection: string | null;
  slug: string | null;
  lookbook: string;
  discontinued_at: Date | null;
}

async function modelsById(db: Db, ids: readonly string[]): Promise<Map<string, ModelMeta>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('models as m')
    .leftJoin('collections as c', 'c.id', 'm.collection_id')
    .select(['m.id', 'm.name', 'm.variant_label', 'm.variant_of', 'm.type', 'm.collection_id', 'c.name as collection', 'm.slug', 'm.lookbook', 'm.discontinued_at'])
    .where('m.id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((m) => [m.id, m as ModelMeta]));
}

/** Rows grouped by main model: the main row (`model` null) and its dots, the dots in order of `order`, the main ones too. */
function grouped<R extends { main: string; model: string | null }, T>(
  rows: readonly R[],
  make: (r: R, modelId: string) => T,
  order: (a: T, b: T) => number,
): { main: T; variants: T[] }[] {
  const mains = new Map<string, { main: T | null; variants: T[] }>();
  for (const r of rows) {
    const g = mains.get(r.main) ?? { main: null, variants: [] };
    if (r.model === null) g.main = make(r, r.main);
    else if (r.model !== r.main) g.variants.push(make(r, r.model));
    mains.set(r.main, g);
  }
  const out: { main: T; variants: T[] }[] = [];
  for (const g of mains.values()) if (g.main) out.push({ main: g.main, variants: g.variants.sort(order) });
  return out.sort((a, b) => order(a.main, b.main));
}

// ── The reading ────────────────────────────────────────────────────────────────────────────────────────────────

export interface LikesInput {
  window: LikesWindow;
  population: AccountFilter;
  /** ALL VISITORS: the countries the daily totals are read for (none: every country). */
  countries?: readonly string[];
  now: Date;
}

/** The figures of the panel `likes` (see the file header), read in the caller's transaction. */
export async function readLikes(tx: Db, x: LikesInput): Promise<LikesFigures> {
  const P = x.window;
  const B = x.window.previous;
  const cutoff = wishHistoryCutoff(x.now);
  const raw = P.start >= cutoff;
  const totalRow = await sql<{ n: number }>`WITH ${x.population('pop', P)} SELECT count(*)::int AS n FROM pop`.execute(tx);
  const total = num(totalRow.rows[0]?.n);
  const wishes = raw ? await rawWishes(tx, x, total, B !== null && B.start >= cutoff) : await monthlyWishes(tx, x);
  return {
    raw,
    total,
    ...wishes,
    ...(await tastes(tx, x)),
    viewed: { collectors: await viewedByCollectors(tx, x), visitors: await viewedByVisitors(tx, x) },
    held: await held(tx, x),
  };
}

type WishParts = Pick<LikesFigures, 'wishlists' | 'mostWished' | 'collections'>;

/** The wish figures from the rows (`raw`), the population's and filters applied. */
async function rawWishes(tx: Db, x: LikesInput, total: number, previousRaw: boolean): Promise<WishParts> {
  const P = x.window;
  const B = previousRaw ? x.window.previous : null;
  type Row = { main: string; model: string | null; wished: number; added: number };
  const byModel = async (p: LikesPeriod, cte: string) =>
    (
      await sql<Row>`
        WITH ${x.population(cte, p)},
        w AS (SELECT w.account_id, w.model_id, coalesce(m.variant_of, m.id) AS main, w.added_at, w.removed_at
                FROM account_wishes w JOIN ${sql.table(cte)} c ON c.account_id = w.account_id JOIN models m ON m.id = w.model_id)
        SELECT w.main::text AS main, w.model_id::text AS model,
               (count(DISTINCT w.account_id) FILTER (WHERE ${openAt(p.end)}))::int AS wished,
               (count(*) FILTER (WHERE ${within(sql`w.added_at`, p)}))::int AS added
          FROM w GROUP BY GROUPING SETS ((w.main, w.model_id), (w.main))`.execute(tx)
    ).rows;
  const now = await byModel(P, 'pop');
  const before = B ? new Map((await byModel(B, 'popp')).map((r) => [`${r.main}/${r.model ?? ''}`, num(r.wished)])) : null;
  const meta = await modelsById(tx, now.flatMap((r) => [r.main, ...(r.model ? [r.model] : [])]));
  const make = (r: Row, id: string): WishedModelRow => {
    const m = meta.get(id)!;
    return {
      modelId: id,
      name: m.name,
      variant: m.variant_label,
      type: m.type,
      collection: m.collection,
      state: wishModelState(m),
      wished: num(r.wished),
      added: num(r.added),
      previous: before ? (before.get(`${r.main}/${r.model ?? ''}`) ?? 0) : null,
    };
  };
  const order = (a: WishedModelRow, b: WishedModelRow) => b.wished - a.wished || byCode(a.name, b.name) || byCode(a.variant ?? '', b.variant ?? '') || byCode(a.modelId, b.modelId);
  const models = grouped(now, make, order)
    .filter((g) => g.main.wished + g.main.added + (g.main.previous ?? 0) > 0)
    .map((g) => ({ ...g.main, variants: g.variants.filter((v) => v.wished + v.added + (v.previous ?? 0) > 0) }));

  type CRow = { id: string; name: string; collectors: number };
  const byCollection = async (p: LikesPeriod, cte: string) =>
    (
      await sql<CRow>`
        WITH ${x.population(cte, p)}
        SELECT col.id::text AS id, col.name, count(DISTINCT w.account_id)::int AS collectors
          FROM account_wishes w JOIN ${sql.table(cte)} c ON c.account_id = w.account_id
          JOIN models m ON m.id = w.model_id JOIN collections col ON col.id = m.collection_id
         WHERE ${openAt(p.end)} GROUP BY col.id, col.name`.execute(tx)
    ).rows;
  const cNow = await byCollection(P, 'pop');
  const cBefore = B ? new Map((await byCollection(B, 'popp')).map((r) => [r.id, num(r.collectors)])) : null;
  const collections = cNow
    .map((r) => ({ collectionId: r.id, name: r.name, collectors: num(r.collectors), previous: cBefore ? (cBefore.get(r.id) ?? 0) : null }))
    .sort((a, b) => b.collectors - a.collectors || byCode(a.name, b.name) || byCode(a.collectionId, b.collectionId));

  type WRow = { collectors: number; added: number; removed: number };
  const lists = async (p: LikesPeriod, cte: string) =>
    (
      await sql<WRow>`
        WITH ${x.population(cte, p)}
        SELECT (count(DISTINCT w.account_id) FILTER (WHERE ${openAt(p.end)}))::int AS collectors,
               (count(*) FILTER (WHERE ${within(sql`w.added_at`, p)}))::int AS added,
               (count(*) FILTER (WHERE ${within(sql`w.removed_at`, p)}))::int AS removed
          FROM account_wishes w JOIN ${sql.table(cte)} c ON c.account_id = w.account_id`.execute(tx)
    ).rows[0]!;
  const l = await lists(P, 'pop');
  const lb = B ? await lists(B, 'popp') : null;
  return {
    wishlists: {
      collectors: num(l.collectors),
      share: total > 0 ? Math.round((num(l.collectors) * 100) / total) : 0,
      added: num(l.added),
      removed: num(l.removed),
      previous: lb ? { collectors: num(lb.collectors), added: num(lb.added), removed: num(lb.removed) } : null,
    },
    mostWished: { rows: models.slice(0, LIKES_TOP), groups: models.length },
    collections: { rows: collections.slice(0, LIKES_TOP), groups: collections.length },
  };
}

/** The wish figures from the monthly totals (`raw: false`): the counted months touching each period, no filter. */
async function monthlyWishes(tx: Db, x: LikesInput): Promise<WishParts> {
  type Row = { model: string; month: string; added: number; removed: number; wished_end: number };
  const months = async (p: LikesPeriod): Promise<{ rows: Row[]; last: string | null }> => {
    const counted = await sql<{ month: string }>`
      SELECT month::text AS month FROM wish_months_counted WHERE month >= ${monthOf(p.from)}::date AND month <= ${monthOf(p.to)}::date ORDER BY month`.execute(tx);
    if (counted.rows.length === 0) return { rows: [], last: null };
    const rows = await sql<Row>`
      SELECT model_id::text AS model, month::text AS month, added, removed, wished_end FROM model_wish_months
       WHERE month >= ${monthOf(p.from)}::date AND month <= ${monthOf(p.to)}::date`.execute(tx);
    return { rows: rows.rows.map((r) => ({ ...r, month: String(r.month).slice(0, 10) })), last: String(counted.rows[counted.rows.length - 1]!.month).slice(0, 10) };
  };
  const now = await months(x.window);
  const before = x.window.previous ? await months(x.window.previous) : null;
  const meta = await modelsById(tx, [...now.rows, ...(before?.rows ?? [])].map((r) => r.model));
  const mains = await modelsById(tx, [...meta.values()].map((m) => m.variant_of ?? m.id));
  const sums = (m: { rows: Row[]; last: string | null }) => {
    const out = new Map<string, { wished: number; added: number; removed: number }>();
    for (const r of m.rows) {
      const e = out.get(r.model) ?? { wished: 0, added: 0, removed: 0 };
      e.added += num(r.added);
      e.removed += num(r.removed);
      if (r.month === m.last) e.wished += num(r.wished_end);
      out.set(r.model, e);
    }
    return out;
  };
  const sNow = sums(now);
  const sBefore = before && before.last ? sums(before) : null;
  // By main model: the dots' wishes summed (wishes, not distinct collectors).
  const rows: { main: string; model: string | null; wished: number; added: number; previous: number | null }[] = [];
  const mainOf = (id: string) => meta.get(id)?.variant_of ?? id;
  const ids = new Set([...sNow.keys()]);
  const mainTotals = new Map<string, { wished: number; added: number; previous: number | null }>();
  for (const id of ids) {
    const e = sNow.get(id)!;
    const previous = sBefore ? (sBefore.get(id)?.wished ?? 0) : null;
    rows.push({ main: mainOf(id), model: id, wished: e.wished, added: e.added, previous });
    const t = mainTotals.get(mainOf(id)) ?? { wished: 0, added: 0, previous: sBefore ? 0 : null };
    t.wished += e.wished;
    t.added += e.added;
    if (t.previous !== null && previous !== null) t.previous += previous;
    mainTotals.set(mainOf(id), t);
  }
  for (const [main, t] of mainTotals) rows.push({ main, model: null, ...t });
  const make = (r: (typeof rows)[number], id: string): WishedModelRow => {
    const m = meta.get(id) ?? mains.get(id)!;
    return { modelId: id, name: m.name, variant: m.variant_label, type: m.type, collection: m.collection, state: wishModelState(m), wished: r.wished, added: r.added, previous: r.previous };
  };
  const order = (a: WishedModelRow, b: WishedModelRow) => b.wished - a.wished || byCode(a.name, b.name) || byCode(a.variant ?? '', b.variant ?? '') || byCode(a.modelId, b.modelId);
  const models = grouped(rows, make, order)
    .filter((g) => g.main.wished + g.main.added + (g.main.previous ?? 0) > 0)
    .map((g) => ({ ...g.main, variants: g.variants.filter((v) => v.wished + v.added + (v.previous ?? 0) > 0) }));

  // Collections: the wishes open at the last month's end, by the wished model's own collection (read live).
  const byCollection = (s: Map<string, { wished: number }>) => {
    const out = new Map<string, { name: string; n: number }>();
    for (const [id, e] of s) {
      const m = meta.get(id);
      if (!m?.collection_id) continue;
      const c = out.get(m.collection_id) ?? { name: m.collection ?? '', n: 0 };
      c.n += e.wished;
      out.set(m.collection_id, c);
    }
    return out;
  };
  const cNow = byCollection(sNow);
  const cBefore = sBefore ? byCollection(sBefore) : null;
  const collections = [...cNow]
    .filter(([id, c]) => c.n > 0 || (cBefore?.get(id)?.n ?? 0) > 0)
    .map(([id, c]) => ({ collectionId: id, name: c.name, collectors: c.n, previous: cBefore ? (cBefore.get(id)?.n ?? 0) : null }))
    .sort((a, b) => b.collectors - a.collectors || byCode(a.name, b.name) || byCode(a.collectionId, b.collectionId));
  const total = (s: Map<string, { added: number; removed: number }>) => [...s.values()].reduce((a, e) => ({ added: a.added + e.added, removed: a.removed + e.removed }), { added: 0, removed: 0 });
  const t = total(sNow);
  return {
    wishlists: { collectors: null, share: null, added: t.added, removed: t.removed, previous: sBefore ? { collectors: null, ...total(sBefore) } : null },
    mostWished: { rows: models.slice(0, LIKES_TOP), groups: models.length },
    collections: { rows: collections.slice(0, LIKES_TOP), groups: collections.length },
  };
}

/** FAVOURITE PIECES and FAVOURITE FINISHES (§3.6 C.6.3), with 'None chosen'. */
async function tastes(tx: Db, x: LikesInput): Promise<Pick<LikesFigures, 'pieces' | 'finishes'>> {
  const P = x.window;
  const B = x.window.previous;
  type Row = { kind: 'PIECE' | 'FINISH'; value_key: string; label: string; collectors: number; chosen: number };
  const rows = (
    await sql<Row>`
      WITH ${x.population('pop', P)}
      SELECT t.kind, t.value_key, (array_agg(t.label ORDER BY t.created_at DESC, t.label))[1] AS label,
             count(*)::int AS collectors, (count(*) FILTER (WHERE ${within(sql`t.created_at`, P)}))::int AS chosen
        FROM account_tastes t JOIN pop c ON c.account_id = t.account_id GROUP BY t.kind, t.value_key`.execute(tx)
  ).rows;
  const previous = B
    ? new Map(
        (
          await sql<{ kind: string; value_key: string; n: number }>`
            WITH ${x.population('popp', B)}
            SELECT t.kind, t.value_key, count(*)::int AS n FROM account_tastes t JOIN popp c ON c.account_id = t.account_id
             WHERE ${within(sql`t.created_at`, B)} GROUP BY t.kind, t.value_key`.execute(tx)
        ).rows.map((r) => [`${r.kind}/${r.value_key}`, num(r.n)]),
      )
    : null;
  const none = (
    await sql<{ pieces: number; finishes: number }>`
      WITH ${x.population('pop', P)}
      SELECT (count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM account_tastes t WHERE t.account_id = c.account_id AND t.kind = 'PIECE')))::int AS pieces,
             (count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM account_tastes t WHERE t.account_id = c.account_id AND t.kind = 'FINISH')))::int AS finishes
        FROM pop c`.execute(tx)
  ).rows[0]!;
  const offered = await tasteOptions(tx);
  const pieceOf = new Map(offered.pieces.map((o) => [tasteKey(o.key) ?? o.key, o]));
  const finishOf = new Map(offered.finishes.map((o) => [tasteKey(o.key) ?? o.key, o]));
  const figure = (r: Row) => {
    const o = (r.kind === 'PIECE' ? pieceOf : finishOf).get(tasteKey(r.value_key) ?? r.value_key);
    return {
      key: r.value_key,
      label: o?.label ?? r.label,
      retired: !o,
      collectors: num(r.collectors),
      chosen: num(r.chosen),
      previous: previous ? (previous.get(`${r.kind}/${r.value_key}`) ?? 0) : null,
      swatch: o && 'swatch' in o ? (o.swatch as string) : null,
    };
  };
  const order = (a: TasteFigure, b: TasteFigure) => b.collectors - a.collectors || byCode(a.label, b.label) || byCode(a.key, b.key);
  const pieces = rows
    .filter((r) => r.kind === 'PIECE')
    .map(figure)
    .map(({ swatch: _swatch, ...p }) => p)
    .sort(order);
  const finishes = rows
    .filter((r) => r.kind === 'FINISH')
    .map(figure)
    .sort(order);
  return { pieces: { rows: pieces, none: num(none.pieces) }, finishes: { rows: finishes, none: num(none.finishes) } };
}

/** MOST VIEWED, COLLECTORS: the population's signed-in views within the 13 months kept (see the file header). */
async function viewedByCollectors(tx: Db, x: LikesInput): Promise<LikesFigures['viewed']['collectors']> {
  const P = x.window;
  const first = parisDay(viewHistoryCutoff(x.now));
  const reachesBackTo = P.from < first ? first : null;
  if (P.to < first) return { models: [], releases: [], groups: 0, reachesBackTo };
  const start = P.from < first ? viewHistoryCutoff(x.now) : P.start;
  const range = { start, end: P.end };
  const days = daysApart(P.from < first ? first : P.from, P.to) + 1;
  /**
   * The population's views of `pages` in the reading, as `v (account_id, subject, seconds)`. Over LIKES_PROBE_AFTER_DAYS
   * Paris days, one probe of collector_views_account_idx per collector: OFFSET 0 keeps it a probe, since as a join,
   * PostgreSQL's parallel plans (genome-ci's postgres:16) read the 13 months whole. Within them, the period's rows by
   * time (collector_views_at_idx).
   */
  const viewsOf = (pages: RawBuilder<unknown>) =>
    days > LIKES_PROBE_AFTER_DAYS
      ? sql`(SELECT c.account_id, r.subject, r.seconds FROM pop c
               CROSS JOIN LATERAL (SELECT cv.subject, cv.seconds FROM collector_views cv
                                    WHERE cv.account_id = c.account_id AND ${within(sql`cv.at`, range)} AND ${pages} AND cv.subject IS NOT NULL
                                   OFFSET 0) r) v`
      : sql`(SELECT cv.account_id, cv.subject, cv.seconds FROM collector_views cv JOIN pop c ON c.account_id = cv.account_id
              WHERE ${within(sql`cv.at`, range)} AND ${pages} AND cv.subject IS NOT NULL) v`;
  const median = sql`floor(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.secs) + 0.5)::int`;
  type MRow = { main: string; model: string | null; collectors: number; views: number; seconds: number; median: number };
  const models = (
    await sql<MRow>`
      WITH ${x.population('pop', P)},
      pv AS (SELECT coalesce(m.variant_of, m.id) AS main, v.subject AS model, v.account_id, count(*)::int AS views, sum(v.seconds)::bigint AS secs
               FROM ${viewsOf(sql`cv.page = ${MODEL}`)} JOIN models m ON m.id = v.subject
              GROUP BY 1, 2, 3)
      SELECT s.main::text AS main, s.model::text AS model, count(*)::int AS collectors, sum(s.views)::int AS views, sum(s.secs)::bigint AS seconds, ${median} AS median
        FROM pv s GROUP BY s.main, s.model
      UNION ALL
      SELECT s.main::text, NULL, count(*)::int, sum(s.views)::int, sum(s.secs)::bigint, ${median}
        FROM (SELECT main, account_id, sum(views) AS views, sum(secs) AS secs FROM pv GROUP BY main, account_id) s GROUP BY s.main`.execute(tx)
  ).rows;
  type RRow = { drop: string; title: string | null; collectors: number; views: number; seconds: number; median: number };
  const releases = (
    await sql<RRow>`
      WITH ${x.population('pop', P)},
      pv AS (SELECT v.subject, v.account_id, count(*)::int AS views, sum(v.seconds)::bigint AS secs
               FROM ${viewsOf(sql`cv.page IN (${sql.join([...RELEASE_PAGES])})`)}
              GROUP BY 1, 2)
      SELECT s.subject::text AS drop, d.title, count(*)::int AS collectors, sum(s.views)::int AS views, sum(s.secs)::bigint AS seconds, ${median} AS median
        FROM pv s LEFT JOIN drops d ON d.id = s.subject GROUP BY s.subject, d.title`.execute(tx)
  ).rows;
  const meta = await modelsById(tx, models.flatMap((r) => [r.main, ...(r.model ? [r.model] : [])]));
  const withheld = (collectors: number, m: number) => (collectors >= LIKES_MIN_GROUP ? num(m) : null);
  const make = (r: MRow, id: string): ViewedModelRow => ({
    modelId: id,
    name: meta.get(id)?.name ?? null,
    variant: meta.get(id)?.variant_label ?? null,
    collectors: num(r.collectors),
    views: num(r.views),
    seconds: num(r.seconds),
    medianSeconds: withheld(num(r.collectors), r.median),
    visitors: null,
  });
  const order = (a: ViewedModelRow, b: ViewedModelRow) => (b.collectors ?? 0) - (a.collectors ?? 0) || b.seconds - a.seconds || byCode(a.name ?? '', b.name ?? '') || byCode(a.modelId, b.modelId);
  const list = grouped(models, make, order).map((g) => ({ ...g.main, variants: g.variants }));
  const rel = releases
    .map((r) => ({ dropId: r.drop, title: r.title, collectors: num(r.collectors), views: num(r.views), seconds: num(r.seconds), medianSeconds: withheld(num(r.collectors), r.median), visitors: null }))
    .sort((a, b) => b.collectors - a.collectors || b.seconds - a.seconds || byCode(a.dropId, b.dropId));
  return { models: list.slice(0, LIKES_TOP), releases: rel.slice(0, LIKES_TOP), groups: list.length, reachesBackTo };
}

/**
 * MOST VIEWED, ALL VISITORS: every visitor's views from the daily totals (viewsReport), the countries alone applied,
 * with What they look at's figures (T.4.2): the totals, Collectors seen (collectorsSeen, from the detail), the views
 * by day and the pages; the previous period's read the same way when the page compares.
 */
async function viewedByVisitors(tx: Db, x: LikesInput): Promise<LikesFigures['viewed']['visitors']> {
  const countries = x.countries?.length ? { countries: x.countries } : undefined;
  const r = await viewsReport(tx, { from: x.window.from, to: x.window.to }, countries, { now: x.now });
  const f = r.current;
  const B = x.window.previous;
  const before = B ? (await viewsReport(tx, { from: B.from, to: B.to }, countries, { now: x.now })).current : null;
  const seen = await collectorsSeen(tx, { from: x.window.from, to: x.window.to }, x.countries, x.now);
  const seenBefore = B ? await collectorsSeen(tx, { from: B.from, to: B.to }, x.countries, x.now) : null;
  const look: LookFigures = {
    views: f.views,
    seconds: f.seconds,
    visitors: f.devices,
    collectors: seen.collectors,
    collectorsFrom: seen.from,
    previous: before
      ? { views: before.views, seconds: before.seconds, visitors: before.devices, collectors: seenBefore && seenBefore.from === null && seen.from === null ? seenBefore.collectors : null }
      : null,
    byDay: f.byDay.map((d) => ({ day: d.day, views: d.views })),
    previousByDay: before ? before.byDay.map((d) => ({ day: d.day, views: d.views })) : null,
    pages: f.pages.map((p) => ({ page: p.page, views: p.views, seconds: p.seconds, share: p.share })),
  };
  const meta = await modelsById(tx, f.models.map((m) => m.mainModelId));
  type Row = { main: string; model: string | null; views: number; seconds: number; devices: number };
  const rows: Row[] = [];
  const totals = new Map<string, Row>();
  for (const m of f.models) {
    rows.push({ main: m.mainModelId, model: m.modelId, views: m.views, seconds: m.seconds, devices: m.devices });
    const t = totals.get(m.mainModelId) ?? { main: m.mainModelId, model: null, views: 0, seconds: 0, devices: 0 };
    t.views += m.views;
    t.seconds += m.seconds;
    t.devices += m.devices;
    totals.set(m.mainModelId, t);
  }
  rows.push(...totals.values());
  const names = new Map(f.models.map((m) => [m.modelId, { name: m.name, variant: m.variant }]));
  const make = (r: Row, id: string): ViewedModelRow => ({
    modelId: id,
    name: names.get(id)?.name ?? meta.get(id)?.name ?? null,
    variant: names.get(id)?.variant ?? meta.get(id)?.variant_label ?? null,
    collectors: null,
    views: r.views,
    seconds: r.seconds,
    medianSeconds: null,
    visitors: r.devices,
  });
  const order = (a: ViewedModelRow, b: ViewedModelRow) => b.seconds - a.seconds || b.views - a.views || byCode(a.name ?? '', b.name ?? '') || byCode(a.modelId, b.modelId);
  const list = grouped(rows, make, order).map((g) => ({ ...g.main, variants: g.variants }));
  const releases = f.releases.map((d) => ({ dropId: d.dropId, title: d.title, collectors: null, views: d.views, seconds: d.seconds, medianSeconds: null, visitors: d.devices }));
  return { models: list.slice(0, LIKES_TOP), releases: releases.slice(0, LIKES_TOP), groups: list.length, through: r.through, look };
}

/** PIECES HELD (§3.6 C.6.3): by main model with its variants, the collectors holding one now and the pieces. */
async function held(tx: Db, x: LikesInput): Promise<LikesFigures['held']> {
  type Row = { main: string; model: string | null; collectors: number; pieces: number };
  const rows = (
    await sql<Row>`
      WITH ${x.population('pop', x.window)},
      h AS (SELECT coalesce(m.variant_of, m.id) AS main, m.id AS model, o.account_id
              FROM ownership o JOIN pop c ON c.account_id = o.account_id JOIN products p ON p.id = o.product_id JOIN models m ON m.id = p.model_id
             WHERE o.ended_at IS NULL AND p.status NOT IN (${sql.join([...CLUB_EXCLUDED_STATUSES])}))
      SELECT h.main::text AS main, h.model::text AS model, count(DISTINCT h.account_id)::int AS collectors, count(*)::int AS pieces
        FROM h GROUP BY GROUPING SETS ((h.main, h.model), (h.main))`.execute(tx)
  ).rows;
  const meta = await modelsById(tx, rows.flatMap((r) => [r.main, ...(r.model ? [r.model] : [])]));
  const make = (r: Row, id: string): HeldModelRow => ({ modelId: id, name: meta.get(id)!.name, variant: meta.get(id)!.variant_label, collectors: num(r.collectors), pieces: num(r.pieces) });
  const order = (a: HeldModelRow, b: HeldModelRow) => b.collectors - a.collectors || b.pieces - a.pieces || byCode(a.name, b.name) || byCode(a.variant ?? '', b.variant ?? '') || byCode(a.modelId, b.modelId);
  const list = grouped(rows, make, order).map((g) => ({ ...g.main, variants: g.variants }));
  return { rows: list.slice(0, LIKES_TOP), groups: list.length };
}

// ── The service ────────────────────────────────────────────────────────────────────────────────────────────────

export interface LikesServiceDeps {
  db: Db;
  clock?: Clock;
}

export class LikesService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: LikesServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * What they like over `window` (and its previous period), for `population` (every counted collector by default); the
   * countries for ALL VISITORS. One REPEATABLE READ, READ ONLY transaction with JIT off as the Collectors page's
   * (connection.ts jitOff), or the caller's.
   */
  async likes(window: LikesWindow, population: AccountFilter = countedCollectors, opts: { countries?: readonly string[] } = {}): Promise<LikesFigures> {
    const input: LikesInput = { window, population, countries: opts.countries, now: this.clock() };
    if (this.db.isTransaction) return readLikes(this.db, input);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      await jitOff(tx);
      return readLikes(tx, input);
    });
  }
}
