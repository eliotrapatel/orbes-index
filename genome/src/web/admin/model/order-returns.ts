/**
 * Orders → Returns in the console (macro scope of 2026-10-20, K12 R1; plan MACRO M3 §2.3, step M3.4): pure helpers, no
 * DOM. The page's state from its address (`#/orders/returns?model=&period=&from=&to=&test=true`), the query it sends,
 * and the words of its summary, tables and flag. The figures are the server's (services/returns-report.ts); R2: nothing
 * here reads a collector's saved sizes.
 */
import { formatCount, formatDate } from '../format.js';
import type { ReturnReason, ReturnsFlag, ReturnsModel, ReturnsReport, ReturnsReportQuery } from '../types.js';
import { RETURN_REASONS } from '../types.js';
import { isDay } from './links.js';

export const RETURNS_COPY = Object.freeze({
  lead: 'The returns and size exchanges asked for, by the collector or by Client Services, by reason, model and size. Parcel problems and cancelled requests are not counted. Each exchange compares the size ordered with the size asked, so a model that runs small or large stands out.',
  empty: 'No return or exchange in this period.',
  byReason: 'By reason',
  byModel: 'By model',
  bySize: 'By size',
  everyModel: 'Every model',
  ofEveryModel: 'Every model',
  model: 'Model',
  period: 'Period',
  from: 'First day',
  to: 'Last day',
  apply: 'Show',
  showTest: 'Show test orders',
  csv: 'Download CSV',
  orders: 'Orders',
  customProblem: 'Choose a first and a last day, the last on or after the first.',
  rule: 'RUNS SMALL: at least 3 size exchanges in the period, two thirds or more of them to a larger size. RUNS LARGE: the same, to a smaller size. A model in one size is never flagged.',
  sizeNote: 'The size ordered.',
  /** A main model with variants, chosen whole: « AURA · every variant ». */
  everyVariant: 'every variant',
  /** A variant's choice under its main model: « — Steel » (an option's leading spaces are not shown). */
  variantMark: '—',
});

/** The period's choices: the last 12 months by default, all time, or two Paris days. */
export const RETURNS_PERIODS = ['12m', 'all', 'custom'] as const;
export type ReturnsPeriod = (typeof RETURNS_PERIODS)[number];
export const RETURNS_PERIOD_LABELS: Readonly<Record<ReturnsPeriod, string>> = Object.freeze({ '12m': 'Last 12 months', all: 'All time', custom: 'Custom' });

/** A reason in the By reason table. */
export const RETURN_REASON_LABELS: Readonly<Record<ReturnReason, string>> = Object.freeze({
  SIZE: 'The size does not fit',
  NOT_AS_EXPECTED: 'Not as expected',
  DAMAGED: 'Arrived damaged',
  OTHER: 'Another reason',
  NOT_GIVEN: 'Not given',
});

/** A reason as a column of the By model table. */
export const RETURN_REASON_COLUMNS: Readonly<Record<ReturnReason, string>> = Object.freeze({
  SIZE: 'Size',
  NOT_AS_EXPECTED: 'Not as expected',
  DAMAGED: 'Damaged',
  OTHER: 'Other',
  NOT_GIVEN: 'Not given',
});

export const RETURNS_FLAG_LABELS: Readonly<Record<ReturnsFlag, string>> = Object.freeze({ RUNS_SMALL: 'RUNS SMALL', RUNS_LARGE: 'RUNS LARGE' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReturnsParams {
  /** A model's id, or null: every model. */
  model: string | null;
  period: ReturnsPeriod;
  /** Custom's days as typed (kept in the address). */
  customFrom: string | null;
  customTo: string | null;
  test: boolean;
}

/** The page's state from its address: anything the server would refuse reads as the default. */
export function returnsParams(query: Readonly<Record<string, string | undefined>>): ReturnsParams {
  const period = (RETURNS_PERIODS as readonly string[]).includes(query.period ?? '') ? (query.period as ReturnsPeriod) : '12m';
  return {
    model: query.model && UUID_RE.test(query.model) ? query.model.toLowerCase() : null,
    period,
    customFrom: period === 'custom' && isDay(query.from) ? query.from : null,
    customTo: period === 'custom' && isDay(query.to) ? query.to : null,
    test: query.test === 'true',
  };
}

/** Custom's problem, or null. */
export function customReturnsProblem(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!isDay(from) || !isDay(to) || to < from) return RETURNS_COPY.customProblem;
  return null;
}

/** What the page asks the server: the last 12 months (the server's default) unless all time or a valid Custom. */
export function returnsApiQuery(p: ReturnsParams): ReturnsReportQuery {
  const q: ReturnsReportQuery = {};
  if (p.model) q.modelId = p.model;
  if (p.test) q.test = true;
  if (p.period === 'all') q.all = true;
  if (p.period === 'custom' && customReturnsProblem(p.customFrom, p.customTo) === null) {
    q.from = p.customFrom;
    q.to = p.customTo;
  }
  return q;
}

/** The address's query for a state, `change` merged in (the defaults left out: `#/orders/returns` is every model, 12 months). */
export function returnsHrefQuery(p: ReturnsParams, change: Partial<ReturnsParams> = {}): Record<string, string | null> {
  const n = { ...p, ...change };
  return {
    model: n.model,
    period: n.period === '12m' ? null : n.period,
    from: n.period === 'custom' ? n.customFrom : null,
    to: n.period === 'custom' ? n.customTo : null,
    test: n.test ? 'true' : null,
  };
}

/** A model row's name: MONOLITHE, or MONOLITHE · Steel for a variant (or a main model with variants). */
export function returnsModelName(m: Pick<ReturnsModel, 'name' | 'variant'>): string {
  return m.variant ? `${m.name} · ${m.variant}` : m.name;
}

/** Whether a main model has variants (it is then chosen with all of them: the server reads the main model and its variants). */
const hasVariants = (m: Pick<ReturnsModel, 'id' | 'variantOf'>, models: readonly Pick<ReturnsModel, 'variantOf'>[]): boolean =>
  m.variantOf === null && models.some((x) => x.variantOf === m.id);

/** A choice's words: AURA · every variant for a main model with variants, — Steel for a variant under it, else the row's name. */
function returnsModelChoiceLabel(m: ReturnsModel, models: readonly ReturnsModel[]): string {
  if (hasVariants(m, models)) return `${m.name} · ${RETURNS_COPY.everyVariant}`;
  if (m.variantOf) return `${RETURNS_COPY.variantMark} ${m.variant ?? returnsModelName(m)}`;
  return returnsModelName(m);
}

/** The model filter's choices: Every model, then each main model (with every variant when it has some) and its variants under it. */
export function returnsModelChoices(models: readonly ReturnsModel[]): { value: string; label: string }[] {
  return [{ value: '', label: RETURNS_COPY.everyModel }, ...models.map((m) => ({ value: m.id, label: returnsModelChoiceLabel(m, models) }))];
}

/** The summary line: « 42 requests · 30 returns · 12 exchanges ». */
export function returnsSummary(s: ReturnsReport['summary']): string {
  const n = (x: number, one: string, many: string) => `${formatCount(x)} ${x === 1 ? one : many}`;
  return `${n(s.requests, 'request', 'requests')} · ${n(s.returns, 'return', 'returns')} · ${n(s.exchanges, 'exchange', 'exchanges')}`;
}

/** The period read, in words: « 23 OCT 2025 – 22 OCT 2026 », or « All time ». */
export function returnsPeriodWords(period: ReturnsReport['period']): string {
  return period.from && period.to ? `${formatDate(period.from)} – ${formatDate(period.to)}` : RETURNS_PERIOD_LABELS.all;
}

/** A share of the requests: « 79 % ». */
export function returnsShare(share: number): string {
  return `${Math.round(share * 100)} %`;
}

/** The flag's line beside its mark: « 9 of 12 exchanges to a larger size ». */
export function returnsFlagLine(r: Pick<ReturnsReport['byModel'][number], 'flag' | 'exchanges' | 'toLarger' | 'toSmaller'>): string | null {
  if (!r.flag) return null;
  const n = r.flag === 'RUNS_SMALL' ? r.toLarger : r.toSmaller;
  return `${formatCount(n)} of ${formatCount(r.exchanges)} ${r.exchanges === 1 ? 'exchange' : 'exchanges'} to a ${r.flag === 'RUNS_SMALL' ? 'larger' : 'smaller'} size`;
}

/** The reasons the page shows: the four always, Not given only when a case has none. */
export function returnsReasons(r: Pick<ReturnsReport, 'byReason'>): ReturnReason[] {
  return RETURN_REASONS.filter((x) => x !== 'NOT_GIVEN' || (r.byReason.find((y) => y.reason === 'NOT_GIVEN')?.total ?? 0) > 0);
}

/** A size row's size: its label, or ONE SIZE. */
export const returnsSizeLabel = (size: string | null): string => size ?? 'ONE SIZE';

/** The By size section's note: the model chosen (a main model with variants: with every variant), or every model. */
export function returnsSizeNote(r: Pick<ReturnsReport, 'modelId' | 'models'>): string {
  const m = r.modelId ? r.models.find((x) => x.id === r.modelId) : null;
  const name = !m ? RETURNS_COPY.ofEveryModel : hasVariants(m, r.models) ? `${m.name} · ${RETURNS_COPY.everyVariant}` : returnsModelName(m);
  return `${name} · ${RETURNS_COPY.sizeNote}`;
}
