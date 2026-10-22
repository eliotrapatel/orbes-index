/**
 * The returns and exchanges report (macro scope of 2026-10-20, K12 R1; plan MACRO M3 §2, step M3.4): Orders → Returns.
 * ReturnsReportService (`ctx.services.returnsReport`) only reads, each reading in one REPEATABLE READ, READ ONLY
 * transaction like GROWTH and the Links page, no cache, no table of its own, nothing audited.
 *
 *   report   GET /api/admin/orders/returns (AUDITOR): the order cases RETURN and EXCHANGE (never a parcel problem),
 *            opened by the collector or by Client Services, not CANCELLED, opened in the period:
 *              - the summary: requests, returns, exchanges;
 *              - by reason: the four (SIZE, NOT_AS_EXPECTED, DAMAGED, OTHER) and NOT_GIVEN for a case without one
 *                (migration 0037 requires a reason today: the row stays so a case of another source reads true),
 *                each its returns, exchanges, total and share of the requests;
 *              - by model: a variant on its own row (its main model's name and its own label), its cases, returns,
 *                exchanges, each reason, its exchanges to a larger and to a smaller size, and the flag;
 *              - by size: each model row's sizes (the order's size; ONE SIZE for none), returns, exchanges, exchanged
 *                to a larger and to a smaller size.
 *   csv      GET /api/admin/orders/returns.csv (AUDITOR): the by-model and by-size tables, counts only; the file named
 *            by the period's Paris days.
 *
 * The rules (plan §2.1):
 *   - The filters: the model (every model; one model, a main model with its variants; a variant alone), the period of
 *     Paris days on the case's opening (the last 12 months to today by default, `all` for all time, `from` and `to`
 *     both or neither), the test entrants' orders left out (`notTestEntrant`, as the Orders board) unless `test`.
 *   - An exchange's direction: the order's size and the size asked compared by `compareSizes` (services/stock.ts), each
 *     read by `sizeLabelOf` (ONE SIZE is none); the same size is neither way.
 *   - The flag of a model row: RUNS SMALL when it has at least RETURNS_FLAG.minExchanges size exchanges in the period
 *     and at least two thirds of them go to a larger size; RUNS LARGE for a smaller size; none otherwise. A model in one
 *     size has no exchange to another size, so it is never flagged.
 *   - Each order of a set is a piece with its own case (plan §5): counted per piece, under its own model.
 *   - R2: nothing about a collector's saved sizes is read; no account is named (counts only), so an AUDITOR reads it all.
 *
 * Every order the platform ships comes back through order cases, a Shopify order included (S3): nothing here assumes
 * the platform is the only place people pay.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import { ORDER_CASE_REASONS, type OrderCaseReason } from '../db/schema.js';
import { DomainError, notFound } from '../errors.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Clock } from '../types.js';
import { notTestEntrant } from './population.js';
import { parisDay, parisDayStart } from './schedule.js';
import { compareSizes, ONE_SIZE_LABEL, sizeLabelOf } from './stock.js';
import { nextParisDay } from './tracking.js';

/** A reason as the report counts it: the four of migration 0037, and none. */
export const RETURN_REASONS = Object.freeze([...ORDER_CASE_REASONS, 'NOT_GIVEN'] as const);
export type ReturnReason = OrderCaseReason | 'NOT_GIVEN';

/** The flag's rule (plan §2.1): at least 3 size exchanges, two thirds of them one way. */
export const RETURNS_FLAG = Object.freeze({ minExchanges: 3, shareNumerator: 2, shareDenominator: 3 });
export type ReturnsFlag = 'RUNS_SMALL' | 'RUNS_LARGE';

/** The default period: the last 12 months of Paris days, to today. */
export const RETURNS_DEFAULT_MONTHS = 12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReturnsReportQuery {
  modelId?: string | null;
  from?: string | null;
  to?: string | null;
  /** All time: no period (never with `from` or `to`). */
  all?: boolean;
  /** The test entrants' orders too. */
  test?: boolean;
}

/** A model row: a model, or a variant on its own row (its main model's name, its label). */
export interface ReturnsModel {
  id: string;
  name: string;
  /** A variant's label, or a main model's own when it has variants; null otherwise. */
  variant: string | null;
  /** The main model of a variant; null for a main model. */
  variantOf: string | null;
}

export interface ReasonRow {
  reason: ReturnReason;
  returns: number;
  exchanges: number;
  total: number;
  /** total ÷ the requests, 0..1 (4 decimals); 0 without requests. */
  share: number;
}

export interface ModelReturnsRow {
  model: ReturnsModel;
  cases: number;
  returns: number;
  exchanges: number;
  reasons: Record<ReturnReason, number>;
  toLarger: number;
  toSmaller: number;
  flag: ReturnsFlag | null;
}

export interface SizeReturnsRow {
  model: ReturnsModel;
  /** The order's size; null: ONE SIZE. */
  size: string | null;
  returns: number;
  exchanges: number;
  toLarger: number;
  toSmaller: number;
}

export interface ReturnsReport {
  /** The Paris days read; both null: all time. */
  period: { from: string | null; to: string | null };
  modelId: string | null;
  test: boolean;
  summary: { requests: number; returns: number; exchanges: number };
  byReason: ReasonRow[];
  byModel: ModelReturnsRow[];
  bySize: SizeReturnsRow[];
  /** The filter's choices: every model, each main model followed by its variants. */
  models: ReturnsModel[];
}

/** One case as the report reads it. */
export interface ReturnCase {
  kind: 'RETURN' | 'EXCHANGE';
  reason: OrderCaseReason | null;
  modelId: string;
  /** The order's size label as stored. */
  orderSize: string | null;
  /** An exchange's size asked. */
  exchangeSize: string | null;
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────────────────────

const periodInvalid = (message: string) => new DomainError('PERIOD_INVALID', 422, message);
const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');

// ── Pure rules ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `day` moved back one year, then on one day (29 February a year back is 1 March): the start of the last 12 months. */
export function twelveMonthsBefore(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const back = new Date(Date.UTC(y - 1, m - 1, d));
  if (back.getUTCMonth() !== m - 1) back.setUTCDate(0);
  back.setUTCDate(back.getUTCDate() + 1);
  return back.toISOString().slice(0, 10);
}

const isDay = (v: string): boolean => {
  if (!DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** The period's Paris days and instants: the last 12 months by default, all time when asked (422 PERIOD_INVALID otherwise). */
export function returnsPeriod(q: Pick<ReturnsReportQuery, 'from' | 'to' | 'all'>, now: Date): { from: string | null; to: string | null; start: Date | null; end: Date | null } {
  const from = q.from || null;
  const to = q.to || null;
  if (q.all) {
    if (from !== null || to !== null) throw periodInvalid('All time takes no first or last day.');
    return { from: null, to: null, start: null, end: null };
  }
  if ((from === null) !== (to === null)) throw periodInvalid('Give the first and the last day, or neither.');
  const period = from !== null && to !== null ? { from, to } : { from: twelveMonthsBefore(parisDay(now)), to: parisDay(now) };
  if (!isDay(period.from) || !isDay(period.to)) throw periodInvalid('A day is YYYY-MM-DD.');
  if (period.to < period.from) throw periodInvalid('The last day is before the first.');
  return { ...period, start: parisDayStart(period.from), end: parisDayStart(nextParisDay(period.to)) };
}

/** An exchange's direction: +1 to a larger size, −1 to a smaller, 0 the same (or none asked). */
export function exchangeDirection(orderSize: string | null, exchangeSize: string | null): -1 | 0 | 1 {
  if (exchangeSize === null) return 0;
  const a = sizeLabelOf(orderSize);
  const b = sizeLabelOf(exchangeSize);
  if (a !== null && b !== null && a.toUpperCase() === b.toUpperCase()) return 0;
  const c = compareSizes(a, b);
  return c < 0 ? 1 : c > 0 ? -1 : 0;
}

/** The flag of a model row from its exchanges (plan §2.1). */
export function returnsFlag(exchanges: number, toLarger: number, toSmaller: number): ReturnsFlag | null {
  if (exchanges < RETURNS_FLAG.minExchanges) return null;
  const oneWay = (n: number) => n * RETURNS_FLAG.shareDenominator >= exchanges * RETURNS_FLAG.shareNumerator;
  if (oneWay(toLarger)) return 'RUNS_SMALL';
  if (oneWay(toSmaller)) return 'RUNS_LARGE';
  return null;
}

const zeroReasons = (): Record<ReturnReason, number> => Object.fromEntries(RETURN_REASONS.map((r) => [r, 0])) as Record<ReturnReason, number>;

/** A model row's words for sorting: its main model's name, the main model first, then its variants by label. */
const modelOrder = (models: ReadonlyMap<string, ReturnsModel>) => (a: ReturnsModel, b: ReturnsModel): number => {
  const mainA = a.variantOf ? (models.get(a.variantOf) ?? a) : a;
  const mainB = b.variantOf ? (models.get(b.variantOf) ?? b) : b;
  return (
    mainA.name.localeCompare(mainB.name, 'en', { sensitivity: 'base' }) ||
    mainA.id.localeCompare(mainB.id) ||
    Number(a.variantOf !== null) - Number(b.variantOf !== null) ||
    (a.variant ?? '').localeCompare(b.variant ?? '', 'en', { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  );
};

/**
 * The report's tables from its cases (pure): the summary, by reason (always its five rows), by model (the models with
 * a case), by size (each model row's sizes with a case, in compareSizes' order).
 */
export function aggregateReturns(cases: readonly ReturnCase[], models: ReadonlyMap<string, ReturnsModel>): Pick<ReturnsReport, 'summary' | 'byReason' | 'byModel' | 'bySize'> {
  const reasons = new Map<ReturnReason, { returns: number; exchanges: number }>(RETURN_REASONS.map((r) => [r, { returns: 0, exchanges: 0 }]));
  const byModel = new Map<string, ModelReturnsRow>();
  const bySize = new Map<string, SizeReturnsRow>();
  let returns = 0;
  let exchanges = 0;
  for (const c of cases) {
    const model = models.get(c.modelId);
    if (!model) continue;
    const reason: ReturnReason = c.reason ?? 'NOT_GIVEN';
    const isReturn = c.kind === 'RETURN';
    const direction = isReturn ? 0 : exchangeDirection(c.orderSize, c.exchangeSize);
    if (isReturn) returns += 1;
    else exchanges += 1;
    const r = reasons.get(reason)!;
    if (isReturn) r.returns += 1;
    else r.exchanges += 1;

    let m = byModel.get(model.id);
    if (!m) byModel.set(model.id, (m = { model, cases: 0, returns: 0, exchanges: 0, reasons: zeroReasons(), toLarger: 0, toSmaller: 0, flag: null }));
    m.cases += 1;
    if (isReturn) m.returns += 1;
    else m.exchanges += 1;
    m.reasons[reason] += 1;
    if (direction > 0) m.toLarger += 1;
    if (direction < 0) m.toSmaller += 1;

    const size = sizeLabelOf(c.orderSize);
    const key = `${model.id}\u0000${size === null ? '' : size.toUpperCase()}`;
    let s = bySize.get(key);
    if (!s) bySize.set(key, (s = { model, size, returns: 0, exchanges: 0, toLarger: 0, toSmaller: 0 }));
    if (isReturn) s.returns += 1;
    else s.exchanges += 1;
    if (direction > 0) s.toLarger += 1;
    if (direction < 0) s.toSmaller += 1;
  }
  const requests = returns + exchanges;
  for (const m of byModel.values()) m.flag = returnsFlag(m.exchanges, m.toLarger, m.toSmaller);
  const order = modelOrder(models);
  return {
    summary: { requests, returns, exchanges },
    byReason: RETURN_REASONS.map((reason) => {
      const r = reasons.get(reason)!;
      const total = r.returns + r.exchanges;
      return { reason, returns: r.returns, exchanges: r.exchanges, total, share: requests === 0 ? 0 : Math.round((total / requests) * 10_000) / 10_000 };
    }),
    byModel: [...byModel.values()].sort((a, b) => order(a.model, b.model)),
    bySize: [...bySize.values()].sort((a, b) => order(a.model, b.model) || compareSizes(a.size, b.size)),
  };
}

/** A size row's size in the CSV: its label, or ONE SIZE. */
const SIZE_WORD = (size: string | null) => size ?? ONE_SIZE_LABEL;

/** The CSV's columns, the by-model table's then the by-size table's (`Table` names the row's table). */
export const RETURNS_CSV_COLUMNS = Object.freeze([
  'Table',
  'Model',
  'Variant',
  'Size',
  'Cases',
  'Returns',
  'Exchanges',
  'Size does not fit',
  'Not as expected',
  'Damaged',
  'Other',
  'Not given',
  'Exchanged to a larger size',
  'Exchanged to a smaller size',
  'Flag',
] as const);

const FLAG_WORDS: Readonly<Record<ReturnsFlag, string>> = Object.freeze({ RUNS_SMALL: 'RUNS SMALL', RUNS_LARGE: 'RUNS LARGE' });

/** The CSV of a report: one line per model row, then one per size row (counts only). */
export function returnsCsv(r: Pick<ReturnsReport, 'byModel' | 'bySize'>): string {
  const n = (x: number) => String(x);
  return csvDocument([
    [...RETURNS_CSV_COLUMNS],
    ...r.byModel.map((m) => [
      'By model',
      m.model.name,
      m.model.variant ?? '',
      '',
      n(m.cases),
      n(m.returns),
      n(m.exchanges),
      n(m.reasons.SIZE),
      n(m.reasons.NOT_AS_EXPECTED),
      n(m.reasons.DAMAGED),
      n(m.reasons.OTHER),
      n(m.reasons.NOT_GIVEN),
      n(m.toLarger),
      n(m.toSmaller),
      m.flag ? FLAG_WORDS[m.flag] : '',
    ]),
    ...r.bySize.map((s) => ['By size', s.model.name, s.model.variant ?? '', SIZE_WORD(s.size), n(s.returns + s.exchanges), n(s.returns), n(s.exchanges), '', '', '', '', '', n(s.toLarger), n(s.toSmaller), '']),
  ]);
}

/** The CSV's file name: its Paris days, or all time to today (Paris). */
export function returnsCsvName(period: { from: string | null; to: string | null }, now: Date): string {
  return period.from && period.to ? `orbes-returns-${period.from}-to-${period.to}.csv` : `orbes-returns-all-time-to-${parisDay(now)}.csv`;
}

// ── The service ────────────────────────────────────────────────────────────────────────────────────────────────

export class ReturnsReportService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: { db: Db; clock?: Clock }) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** The report (see the file header): 404 MODEL_NOT_FOUND for an unknown model, 422 PERIOD_INVALID for a bad period. */
  async report(q: ReturnsReportQuery = {}): Promise<ReturnsReport> {
    const now = this.clock();
    const period = returnsPeriod(q, now);
    const modelId = q.modelId || null;
    if (modelId !== null && !UUID_RE.test(modelId)) throw modelNotFound();
    const test = q.test === true;
    return this.readOnly(async (tx) => {
      const rows = await tx.selectFrom('models').select(['id', 'name', 'variant_label', 'variant_of']).execute();
      const models = new Map<string, ReturnsModel>(rows.map((m) => [m.id, { id: m.id, name: m.name, variant: m.variant_label, variantOf: m.variant_of }]));
      let ids: string[] | null = null;
      if (modelId !== null) {
        const chosen = models.get(modelId.toLowerCase());
        if (!chosen) throw modelNotFound();
        ids = chosen.variantOf === null ? [chosen.id, ...rows.filter((m) => m.variant_of === chosen.id).map((m) => m.id)] : [chosen.id];
      }
      const found = await sql<{ kind: 'RETURN' | 'EXCHANGE'; reason: OrderCaseReason | null; model_id: string; size_label: string | null; exchange_size_label: string | null }>`
        SELECT c.kind, c.reason, o.model_id, o.size_label, c.exchange_size_label
          FROM order_cases c
          JOIN orders o ON o.id = c.order_id
         WHERE c.kind IN ('RETURN', 'EXCHANGE')
           AND c.status <> 'CANCELLED'
           ${period.start ? sql`AND c.opened_at >= ${period.start}::timestamptz` : sql``}
           ${period.end ? sql`AND c.opened_at < ${period.end}::timestamptz` : sql``}
           ${test ? sql`` : sql`AND ${notTestEntrant('o.account_id')}`}
           ${ids ? sql`AND o.model_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`))})` : sql``}`.execute(tx);
      const cases: ReturnCase[] = found.rows.map((c) => ({ kind: c.kind, reason: c.reason, modelId: c.model_id, orderSize: c.size_label, exchangeSize: c.exchange_size_label }));
      const order = modelOrder(models);
      return {
        period: { from: period.from, to: period.to },
        modelId: modelId === null ? null : modelId.toLowerCase(),
        test,
        ...aggregateReturns(cases, models),
        models: [...models.values()].sort(order),
      };
    });
  }

  /** The CSV of the report's by-model and by-size tables, named by its Paris days. */
  async csv(q: ReturnsReportQuery = {}): Promise<{ filename: string; contentType: string; body: string }> {
    const r = await this.report(q);
    return { filename: returnsCsvName(r.period, this.clock()), contentType: CSV_CONTENT_TYPE, body: returnsCsv(r) };
  }

  /** `fn` in one REPEATABLE READ, READ ONLY transaction: every table of the report sees the same moment. */
  private async readOnly<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.db.isTransaction) return fn(this.db);
    return this.db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      return fn(tx);
    });
  }
}
