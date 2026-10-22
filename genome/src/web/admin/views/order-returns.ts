/**
 * Orders → Returns, `#/orders/returns` (macro scope of 2026-10-20, K12 R1; plan MACRO M3 §2.3, step M3.4), from the
 * Orders board's header: the returns and size exchanges, read from GET /api/admin/orders/returns
 * (services/returns-report.ts), which counts only and names no one, so an AUDITOR reads the whole page.
 *
 *   - The filter bar: the model (every model, a main model with its variants, a variant alone), the period (the last 12
 *     months by default, all time, Custom's first and last Paris days), Show test orders (off, as on the board). All
 *     kept in the address, so a reload keeps them.
 *   - The summary line (« 42 requests · 30 returns · 12 exchanges ») and the period read.
 *   - By reason: returns, exchanges, total and share; Not given only when a case has no reason.
 *   - By model: a variant on its own row; its cases, returns, exchanges, each reason, and the flag as a status mark
 *     (RUNS SMALL / RUNS LARGE) with « 9 of 12 exchanges to a larger size » beside it; the rule written under the table.
 *   - By size: the size ordered, its returns and exchanges, exchanged to a larger and to a smaller size.
 *   - Download CSV: the by-model and by-size tables, named by the period's Paris days.
 * Empty: « No return or exchange in this period. »; loading and a failed read are the console's own (main.ts), as on
 * Growth. R2: nothing here compares an order's size with a collector's saved size.
 *
 * The console's house style: white paper, ink, hairlines, no cards. Text through h() only (CSP-safe).
 */
import { h } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import {
  customReturnsProblem,
  RETURN_REASON_COLUMNS,
  RETURN_REASON_LABELS,
  RETURNS_COPY as C,
  RETURNS_FLAG_LABELS,
  RETURNS_PERIOD_LABELS,
  RETURNS_PERIODS,
  returnsApiQuery,
  returnsFlagLine,
  returnsHrefQuery,
  returnsModelChoices,
  returnsModelName,
  returnsParams,
  returnsPeriodWords,
  returnsReasons,
  returnsShare,
  returnsSizeLabel,
  returnsSizeNote,
  returnsSummary,
  type ReturnsParams,
  type ReturnsPeriod,
} from '../model/order-returns.js';
import { href } from '../router.js';
import type { ReturnsModel, ReturnsReport } from '../types.js';
import { busy, button, checkbox, emptyState, field, filterBar, input, linkButton, pageHeader, section, select, statusMark, table, type Column } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

type ModelRow = ReturnsReport['byModel'][number];
type SizeRow = ReturnsReport['bySize'][number];
type ReasonRow = ReturnsReport['byReason'][number];

export async function orderReturnsView(ctx: ViewContext): Promise<HTMLElement> {
  const p = returnsParams(ctx.route.query);
  const r = await ctx.api.returnsReport(returnsApiQuery(p));

  const csv = button(C.csv, { kind: 'ghost', testId: 'returns-csv' });
  csv.addEventListener('click', () =>
    void busy(csv, async () => {
      try {
        saveDownload(await ctx.api.returnsCsv(returnsApiQuery(p)));
      } catch (e) {
        notifyError(e);
      }
    }),
  );
  const empty = r.summary.requests === 0;

  return h(
    'div',
    { class: 'view view--returns' },
    pageHeader({ eyebrow: 'Orders', title: 'Returns', lead: C.lead, actions: [linkButton(C.orders, href('orders'), 'ghost'), ...(empty ? [] : [csv])] }),
    filters(ctx, p, r),
    h(
      'p',
      { class: 'board__summary returns__summary', data: { testid: 'returns-summary' } },
      h('span', { class: 'board__figures' }, returnsSummary(r.summary)),
      h('span', { class: 'board__delays', data: { testid: 'returns-period' } }, returnsPeriodWords(r.period)),
    ),
    ...(empty
      ? [h('div', { data: { testid: 'returns-empty' } }, emptyState(C.empty))]
      : [reasonSection(r), modelSection(r), sizeSection(r)]),
  );
}

// ── The filter bar ───────────────────────────────────────────────────────────────────────────────────────────────

function filters(ctx: ViewContext, p: ReturnsParams, r: ReturnsReport): HTMLElement {
  const go = (change: Partial<ReturnsParams>) => ctx.navigate(href('orderReturns', {}, returnsHrefQuery(p, change)));
  const model = select('model', returnsModelChoices(r.models), p.model ?? '');
  model.setAttribute('data-testid', 'returns-model');
  model.addEventListener('change', () => go({ model: model.value || null }));
  const period = select(
    'period',
    RETURNS_PERIODS.map((x) => ({ value: x, label: RETURNS_PERIOD_LABELS[x] })),
    p.period,
  );
  period.setAttribute('data-testid', 'returns-period-choice');
  period.addEventListener('change', () => go({ period: period.value as ReturnsPeriod, customFrom: null, customTo: null }));
  const test = checkbox('test', C.showTest, p.test);
  (test.querySelector('input') as HTMLInputElement).addEventListener('change', (e) => go({ test: (e.target as HTMLInputElement).checked }));

  const custom: HTMLElement[] = [];
  if (p.period === 'custom') {
    const from = input('from', { type: 'date', value: p.customFrom ?? '' });
    const to = input('to', { type: 'date', value: p.customTo ?? '' });
    from.setAttribute('data-testid', 'returns-from');
    to.setAttribute('data-testid', 'returns-to');
    const problem = h('p', { class: 'returns__problem', attrs: { role: 'alert' } }, p.customFrom || p.customTo ? (customReturnsProblem(p.customFrom, p.customTo) ?? '') : '');
    const apply = button(C.apply, { kind: 'secondary', testId: 'returns-apply' });
    apply.addEventListener('click', () => {
      const bad = customReturnsProblem(from.value, to.value);
      if (bad) {
        problem.textContent = bad;
        return;
      }
      go({ customFrom: from.value, customTo: to.value });
    });
    custom.push(field(C.from, from), field(C.to, to), h('div', { class: 'cfield returns__apply' }, apply), problem);
  }

  return h(
    'div',
    { class: 'returns__filters', data: { testid: 'returns-filters' } },
    filterBar(field(C.model, model), field(C.period, period), ...custom, h('div', { class: 'cfield cfield--checks' }, test)),
  );
}

// ── The three tables ─────────────────────────────────────────────────────────────────────────────────────────────

const count = (n: number) => formatCount(n);

function reasonSection(r: ReturnsReport): HTMLElement {
  const shown = new Set(returnsReasons(r));
  const rows = r.byReason.filter((x) => shown.has(x.reason));
  const columns: Column<ReasonRow>[] = [
    { label: 'Reason', cell: (x) => RETURN_REASON_LABELS[x.reason], kind: ['wide'] },
    { label: 'Returns', cell: (x) => count(x.returns), kind: ['num', 'nowrap'] },
    { label: 'Exchanges', cell: (x) => count(x.exchanges), kind: ['num', 'nowrap'] },
    { label: 'Total', cell: (x) => count(x.total), kind: ['num', 'nowrap'] },
    { label: 'Share', cell: (x) => returnsShare(x.share), kind: ['num', 'nowrap'] },
  ];
  return section(C.byReason, h('div', { data: { testid: 'returns-by-reason' } }, table(columns, rows, { caption: C.byReason })), { id: 'returns-reasons', class: 'returns__reasons' });
}

/** A model row's name, its variant on a line of its own. */
const modelCell = (m: ReturnsModel) =>
  h('span', { class: 'returns__model', attrs: { title: returnsModelName(m) } }, m.name, m.variant ? h('span', { class: 'cell-sub' }, m.variant) : null);

/** The flag's mark and its line; `phone`: its twin under the model's name, shown only under 600 px, where the Flag column is hidden (so each width reads it once). */
function flagMark(x: ModelRow, phone = false): HTMLElement | null {
  const line = returnsFlagLine(x);
  if (!x.flag || !line) return phone ? null : h('span', { class: 'soft', data: { testid: 'returns-flag-none' } }, '—');
  return h(
    'span',
    { class: ['returns__flag', phone ? 'returns__flag--phone' : null], data: { testid: phone ? 'returns-flag-phone' : 'returns-flag' } },
    statusMark(RETURNS_FLAG_LABELS[x.flag], 'alert'),
    h('span', { class: 'cell-sub', data: { testid: phone ? undefined : 'returns-flag-line' } }, line),
  );
}

function modelSection(r: ReturnsReport): HTMLElement {
  const reasons = returnsReasons(r);
  const columns: Column<ModelRow>[] = [
    { label: 'Model', cell: (x) => h('span', null, modelCell(x.model), flagMark(x, true)), kind: ['wide'] },
    { label: 'Cases', cell: (x) => count(x.cases), kind: ['num', 'nowrap'] },
    { label: 'Returns', cell: (x) => count(x.returns), kind: ['num', 'nowrap'] },
    { label: 'Exchanges', cell: (x) => count(x.exchanges), kind: ['num', 'nowrap'] },
    ...reasons.map((reason): Column<ModelRow> => ({ label: RETURN_REASON_COLUMNS[reason], cell: (x) => count(x.reasons[reason]), kind: ['num', 'nowrap'] })),
    { label: 'Flag', cell: (x) => flagMark(x)!, kind: ['nowrap'] },
  ];
  return section(
    C.byModel,
    [h('div', { data: { testid: 'returns-by-model' } }, table(columns, r.byModel, { caption: C.byModel })), h('p', { class: 'returns__rule', data: { testid: 'returns-rule' } }, C.rule)],
    { id: 'returns-models', class: 'returns__models' },
  );
}

function sizeSection(r: ReturnsReport): HTMLElement {
  // One model chosen, one row: its sizes need no Model column (the note names it).
  const one = r.modelId !== null && r.byModel.length === 1;
  const columns: Column<SizeRow>[] = [
    ...(one ? [] : [{ label: 'Model', cell: (x: SizeRow) => modelCell(x.model), kind: ['wide' as const] }]),
    { label: 'Size', cell: (x) => h('span', { class: 'returns__size' }, returnsSizeLabel(x.size)), kind: one ? ['wide'] : ['nowrap'] },
    { label: 'Returns', cell: (x) => count(x.returns), kind: ['num', 'nowrap'] },
    { label: 'Exchanges', cell: (x) => count(x.exchanges), kind: ['num', 'nowrap'] },
    { label: 'To a larger size', cell: (x) => count(x.toLarger), kind: ['num', 'nowrap'] },
    { label: 'To a smaller size', cell: (x) => count(x.toSmaller), kind: ['num', 'nowrap'] },
  ];
  return section(C.bySize, h('div', { data: { testid: 'returns-by-size' } }, table(columns, r.bySize, { caption: C.bySize })), { id: 'returns-sizes', class: 'returns__sizes', note: returnsSizeNote(r) });
}
