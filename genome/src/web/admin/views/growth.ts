/**
 * Growth (plan NEXT-NINE, §3.9 BP-29, step 9.2): how the house grows, on one page, Analytics' sibling under Overview.
 * Every figure comes from GET /api/admin/growth (services/growth.ts), which reads only and names no account; COLLECTORS
 * BY VALUE from GET /api/admin/growth/collectors (each client's email masked for an AUDITOR by the server).
 *
 *   - the window (LAST 12 MONTHS · LAST 24 MONTHS) and, when more than one appears, the currency: amounts are never
 *     converted;
 *   - four figures: Collectors, Second piece, New owners, Net revenue;
 *   - Lifetime value: per collector, COLLECTORS BY VALUE (25 a page, each row opening the client sheet), then the
 *     breakdowns BY TIER · BY COUNTRY · BY FIRST MODEL · BY CHANNEL, a group under three collectors without amounts;
 *   - Repeat buying: the second piece, the time to it, the cohorts by month of the first piece;
 *   - From scan to PALLADIUM: each step and its share of the one before, the months, the club now;
 *   - Revenue: the net of each month (each opening its Invoices page), BY CHANNEL · BY COUNTRY · BY MODEL;
 *   - Margin (lot M4 plan §1.3, K43 N1 to N3, D61): from GET /api/admin/margin, the same window in euros at the rates of
 *     Margin settings: Revenue, Costs, Margin and Margin %, BY MODEL · BY CHANNEL · BY TIER (never by release) with
 *     PERKS' and THE VAULT's parts, the orders holding an estimate, THE VAULT's line and its way to Club → THE VAULT's
 *     report, Partner experiences beside it (once recorded), What is missing, its CSV and Margin settings;
 *   - Elsewhere in the console: the console's own figures, each linking to its detailed page.
 *
 * The console's house style: white paper, ink, hairlines, hairline bars, no cards; figures in --font, so the labels set in
 * the display face carry none (`figures` sets a label's digits in --font). A panel that cannot be read says so; the rest
 * of the page stands.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { countryBars } from '../model/analytics.js';
import { hourText, shareText } from '../model/best-time.js';
import { circleMemberBars } from '../model/circle.js';
import {
  clubNowLine,
  cohortCells,
  collectorRow,
  collectorsRange,
  EMPTY,
  funnelBars,
  funnelNote,
  growthKpis,
  growthParams,
  GROWTH_COLLECTORS_PAGE,
  LEAD,
  ltvGroupRows,
  LTV_TABS,
  LTV_TAB_LABELS,
  money,
  NOTES,
  perCollectorFigures,
  releaseRow,
  repeatFigures,
  revenueBars,
  revenueGroupRows,
  MARGIN_TABS,
  REVENUE_TABS,
  REVENUE_TAB_LABELS,
  secondPieceBars,
  type GrowthParams,
  type LtvTab,
  type RevenueTab,
} from '../model/growth.js';
import { monthLabel } from '../model/invoices.js';
import {
  MARGIN_GROUP_HEAD,
  MARGIN_TAB_LABELS,
  MARGIN_TEXT,
  MARGIN_VAULT_WORDS,
  marginEmpty,
  marginKpis,
  marginRows,
  missingItems,
  partnerLine,
  vaultLineEmpty,
  vaultLineItems,
  vaultReportCost,
  vaultReportHref,
  type MarginRow,
} from '../model/margin.js';
import { href } from '../router.js';
import { FUNNEL_STEPS, GROWTH_WINDOWS, type AnalyticsData, type BestTime, type CircleStats, type GrowthCollectors, type GrowthRelease, type GrowthReport, type MarginReport } from '../types.js';
import { barList, busy, button, emptyState, kpi, linkButton, pageHeader, section, select, table } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

type Failed = 'failed';
const failed = (): Failed => 'failed';

/** A label whose digits read in --font inside the display face (`Top 10% from`). */
function figures(text: string): Child[] {
  return text.split(/(\d+)/).filter(Boolean).map((part) => (/^\d+$/.test(part) ? h('span', { class: 'growth__figure' }, part) : part));
}

/** The page's own address with `q` merged in (an empty value dropped). */
function growthHref(p: GrowthParams, q: Partial<Record<keyof GrowthParams, string | number | null>>): string {
  const all: Record<string, string | number | null> = { months: p.months, currency: p.currency, ltv: p.ltv, rev: p.rev, mg: p.mg === 'model' ? null : p.mg, page: p.page > 1 ? p.page : null, ...q };
  return href('growth', {}, all);
}

/** Tabs as links, the current one marked: the window, a breakdown. */
function tabs(label: string, items: { key: string; text: Child[]; href: string; current: boolean; testid: string }[]): HTMLElement {
  return h(
    'nav',
    { class: 'range', attrs: { 'aria-label': label } },
    ...items.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: t.href, 'aria-current': t.current ? 'page' : null, 'data-testid': t.testid } }, ...t.text),
    ]),
  );
}

/** A row of figures under their labels (per collector, repeat buying). */
function figureRow(rows: { key: string; label: string; value: string; note?: string }[], testid: string): HTMLElement {
  return h(
    'dl',
    { class: 'growth__figures', data: { testid } },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'growth__fig', data: { key: r.key } },
        h('dt', { class: 'kpi__label' }, ...figures(r.label)),
        h('dd', { class: 'growth__value' }, r.value),
        r.note ? h('dd', { class: 'growth__note' }, r.note) : null,
      ),
    ),
  );
}

function subtitle(text: string): HTMLElement {
  return h('h3', { class: 'panel__subtitle' }, text);
}

function failedPanel(title: string, cls: string): HTMLElement {
  return section(title, emptyState(NOTES.failed), { class: `${cls} growth__failed` });
}

// ── Lifetime value ─────────────────────────────────────────────────────────

function collectorsBlock(ctx: ViewContext, p: GrowthParams, r: GrowthReport, c: GrowthCollectors | Failed): HTMLElement {
  if (c === 'failed') return h('div', { class: 'growth__block', data: { testid: 'growth-collectors' } }, subtitle('Collectors by value'), emptyState(NOTES.failed));
  const range = collectorsRange(c);
  const page = (n: number) => () => ctx.setQuery({ page: n > 1 ? n : null });
  const pagerButton = (text: string, enabled: boolean, go: () => void, testid: string) => {
    const b = h('button', { class: ['cbtn', 'cbtn--ghost'], attrs: { type: 'button', disabled: !enabled, 'data-testid': testid } }, `${text} `, h('span', { class: 'cbtn__figure' }, String(GROWTH_COLLECTORS_PAGE)));
    b.addEventListener('click', go);
    return b;
  };
  return h(
    'div',
    { class: 'growth__block', data: { testid: 'growth-collectors' } },
    subtitle('Collectors by value'),
    table(
      [
        { label: 'Client', cell: (x) => h('a', { class: 'idlink', attrs: { href: x.link, 'data-testid': 'growth-collector' } }, x.email), kind: ['wide'] },
        { label: 'Tier now', cell: (x) => x.tier, kind: ['nowrap'] },
        { label: 'Country', cell: (x) => x.country, kind: ['nowrap'] },
        { label: 'Pieces counted', cell: (x) => x.pieces, kind: ['num'] },
        { label: 'Value', cell: (x) => x.value, kind: ['num', 'nowrap'] },
        { label: 'First piece', cell: (x) => x.first, kind: ['nowrap'] },
      ],
      c.items.map((x) => collectorRow(x, c.currency)),
      { empty: EMPTY.ltv, onRow: (x) => x.link, caption: 'Collectors by value, the highest first' },
    ),
    c.total > 0
      ? h(
          'nav',
          { class: 'pager', attrs: { 'aria-label': 'Collectors by value' } },
          h('span', { class: 'pager__range', data: { testid: 'growth-collectors-range' } }, range.text),
          h(
            'span',
            { class: 'pager__nav' },
            pagerButton('Previous', range.previous, page(c.page - 1), 'growth-collectors-previous'),
            pagerButton('Next', range.next, page(c.page + 1), 'growth-collectors-next'),
          ),
        )
      : null,
    h('p', { class: 'growth__line' }, `Lifetime to date, whatever the window · ${r.window.currency}`),
  );
}

function ltvSection(ctx: ViewContext, p: GrowthParams, r: GrowthReport, c: GrowthCollectors | Failed): HTMLElement {
  const groupHead: Record<LtvTab, string> = { tier: 'Tier', country: 'Country', model: 'First model', channel: 'Channel' };
  const rows = ltvGroupRows(r, p.ltv);
  const none = r.ltv.perCollector.collectors === 0;
  return section(
    'Lifetime value',
    [
      subtitle('Per collector'),
      figureRow(perCollectorFigures(r), 'growth-per-collector'),
      collectorsBlock(ctx, p, r, c),
      h(
        'div',
        { class: 'growth__block', data: { testid: 'growth-ltv-groups' } },
        tabs(
          'Lifetime value by',
          LTV_TABS.map((t) => ({ key: t, text: [LTV_TAB_LABELS[t]], href: growthHref(p, { ltv: t }), current: t === p.ltv, testid: `growth-ltv-${t}` })),
        ),
        none
          ? emptyState(EMPTY.ltv)
          : table(
              [
                { label: groupHead[p.ltv], cell: (x) => x.label, kind: ['wide'] },
                { label: 'Collectors', cell: (x) => x.collectors, kind: ['num'] },
                { label: 'Total', cell: (x) => x.total, kind: ['num', 'nowrap'] },
                { label: 'Average', cell: (x) => x.average, kind: ['num', 'nowrap'] },
                { label: 'Median', cell: (x) => x.median, kind: ['num', 'nowrap'] },
              ],
              rows,
              { caption: `Lifetime value ${LTV_TAB_LABELS[p.ltv].toLowerCase()}` },
            ),
        rows.some((x) => x.masked) ? h('p', { class: 'growth__line', data: { testid: 'growth-masked' } }, NOTES.masked) : null,
      ),
    ],
    { note: NOTES.ltv, class: 'panel--growth-ltv', id: 'growth-ltv' },
  );
}

// ── Repeat buying ──────────────────────────────────────────────────────────

function repeatSection(r: GrowthReport): HTMLElement {
  if (r.repeat.collectors === 0) return section('Repeat buying', emptyState(EMPTY.repeat), { note: NOTES.repeat, class: 'panel--growth-repeat', id: 'growth-repeat' });
  return section(
    'Repeat buying',
    [
      figureRow(repeatFigures(r), 'growth-repeat-figures'),
      subtitle('Time to the second piece'),
      h('div', { class: 'growth__bars', data: { testid: 'growth-second-piece' } }, barList(secondPieceBars(r))),
      subtitle('By month of first piece'),
      table(
        [
          { label: 'Cohort', cell: (x: ReturnType<typeof cohortCells>) => x.month, kind: ['nowrap'] },
          { label: 'Collectors', cell: (x) => x.collectors, kind: ['num'] },
          { label: 'In a month', cell: (x) => x.within[0]!, kind: ['num'] },
          { label: 'In three months', cell: (x) => x.within[1]!, kind: ['num'] },
          { label: 'In six months', cell: (x) => x.within[2]!, kind: ['num'] },
          { label: 'In a year', cell: (x) => x.within[3]!, kind: ['num'] },
          { label: 'To date', cell: (x) => x.toDate, kind: ['num'] },
        ],
        r.repeat.cohorts.map(cohortCells),
        { caption: 'A second piece by month of first piece' },
      ),
    ],
    { note: NOTES.repeat, class: 'panel--growth-repeat', id: 'growth-repeat' },
  );
}

// ── From scan to PALLADIUM ─────────────────────────────────────────────────

function funnelSection(r: GrowthReport): HTMLElement {
  const head: Record<(typeof FUNNEL_STEPS)[number], string> = { scans: 'Scans', accounts: 'Accounts', owners: 'Owners', buyers: 'Buyers', platine: 'PLATINE', palladium: 'PALLADIUM' };
  return section(
    'From scan to PALLADIUM',
    [
      h('div', { class: ['growth__bars', 'growth__bars--wide'], data: { testid: 'growth-funnel' } }, barList(funnelBars(r))),
      h('p', { class: 'growth__line' }, NOTES.scansCounted),
      table(
        [
          { label: 'Month', cell: (x: GrowthReport['funnel']['months'][number]) => monthLabel(x.month), kind: ['nowrap'] },
          ...FUNNEL_STEPS.map((s) => ({ label: head[s], cell: (x: GrowthReport['funnel']['months'][number]) => formatCount(x.counts[s]), kind: ['num' as const] })),
        ],
        r.funnel.months,
        { caption: 'Each step by month' },
      ),
      h('p', { class: 'growth__line', data: { testid: 'growth-club-now' } }, clubNowLine(r)),
    ],
    { note: funnelNote(r.funnel.thresholds), class: 'panel--growth-funnel', id: 'growth-funnel' },
  );
}

// ── Revenue ────────────────────────────────────────────────────────────────

function revenueSection(p: GrowthParams, r: GrowthReport): HTMLElement {
  const none = r.revenue.total.orders === 0 && r.revenue.total.creditedMinor === 0;
  const c = r.window.currency;
  const bars = revenueBars(r);
  const groupHead: Record<RevenueTab, string> = { channel: 'Channel', country: 'Country', model: 'Model' };
  const rows = revenueGroupRows(r, p.rev);
  return section(
    'Revenue',
    none
      ? [emptyState(EMPTY.revenue)]
      : [
          h(
            'ul',
            { class: ['bars', 'growth__money'], data: { testid: 'growth-revenue-bars' } },
            ...bars.map((b) => {
              const fill = h('span', { class: ['bar__fill', b.negative ? 'bar__fill--outline' : 'bar__fill--solid'] });
              fill.style.setProperty('--f', String(b.fraction));
              return h(
                'li',
                { class: ['bar', b.fraction === 0 ? 'bar--zero' : null] },
                h('a', { class: 'bar__label', attrs: { href: b.link } }, b.label),
                h('span', { class: 'bar__track', attrs: { 'aria-hidden': 'true' } }, fill),
                h('span', { class: 'bar__value' }, b.value),
              );
            }),
          ),
          table(
            [
              { label: 'Month', cell: (x: GrowthReport['revenue']['months'][number]) => h('a', { class: 'idlink', attrs: { href: href('invoices', {}, { month: x.month }) } }, monthLabel(x.month)), kind: ['nowrap'] },
              { label: 'Orders', cell: (x) => formatCount(x.orders), kind: ['num'] },
              { label: 'Invoiced', cell: (x) => money(x.invoicedMinor, c), kind: ['num', 'nowrap'] },
              { label: 'Credited', cell: (x) => money(x.creditedMinor, c), kind: ['num', 'nowrap'] },
              { label: 'Net', cell: (x) => money(x.netMinor, c), kind: ['num', 'nowrap'] },
            ],
            r.revenue.months,
            { caption: 'Revenue by month', onRow: (x) => href('invoices', {}, { month: x.month }) },
          ),
          h(
            'div',
            { class: 'growth__block', data: { testid: 'growth-revenue-groups' } },
            tabs(
              'Revenue by',
              REVENUE_TABS.map((t) => ({ key: t, text: [REVENUE_TAB_LABELS[t]], href: growthHref(p, { rev: t }), current: t === p.rev, testid: `growth-rev-${t}` })),
            ),
            table(
              [
                { label: groupHead[p.rev], cell: (x) => x.label, kind: ['wide'] },
                { label: 'Orders', cell: (x) => x.orders, kind: ['num'] },
                { label: 'Net', cell: (x) => x.net, kind: ['num', 'nowrap'] },
              ],
              rows,
              { empty: EMPTY.revenue, caption: `Revenue ${REVENUE_TAB_LABELS[p.rev].toLowerCase()}` },
            ),
            rows.some((x) => x.masked) ? h('p', { class: 'growth__line' }, NOTES.masked) : null,
          ),
        ],
    { note: NOTES.revenue, class: 'panel--growth-revenue', id: 'growth-revenue' },
  );
}

// ── Margin (lot M4 plan §1.3) ────────────────────────────────────────────

/** A money cell, a loss marked. */
function moneyCell(text: string, loss = false): HTMLElement {
  return h('span', { class: ['margin__money', loss ? 'margin__money--loss' : null] }, text);
}

/** A cost column with its parts under its total (PERKS' three, THE VAULT's five), once there is a part to show. */
function partsCell(cls: string, testid: string, total: string, parts: readonly { key: string; label: string; amount: string }[]): HTMLElement {
  return h(
    'span',
    { class: cls, data: { testid } },
    moneyCell(total),
    ...parts.map((part) =>
      h('span', { class: ['cell-sub', 'margin__part'], data: { part: part.key } }, h('span', { class: 'margin__part-label' }, part.label), ' ', h('span', { class: 'margin__part-amount' }, part.amount)),
    ),
  );
}

function marginTable(p: GrowthParams, rows: MarginRow[]): HTMLElement {
  return table<MarginRow>(
    [
      {
        label: MARGIN_GROUP_HEAD[p.mg],
        cell: (x) =>
          h(
            'span',
            { class: 'margin__group', data: { testid: 'margin-group' } },
            h('span', { class: 'margin__name' }, x.label),
            x.hint ? h('span', { class: 'cell-sub' }, x.hint) : null,
            x.estimate ? h('span', { class: ['cell-sub', 'margin__estimate'], data: { testid: 'margin-estimate' } }, x.estimate) : null,
          ),
        kind: ['wide'],
      },
      { label: 'Orders', cell: (x) => x.orders, kind: ['num'] },
      { label: 'Revenue', cell: (x) => moneyCell(x.revenue), kind: ['num', 'nowrap'] },
      { label: 'Piece', cell: (x) => moneyCell(x.piece), kind: ['num', 'nowrap'] },
      { label: 'Inbound', cell: (x) => moneyCell(x.inbound), kind: ['num', 'nowrap'] },
      { label: 'Packaging', cell: (x) => moneyCell(x.packaging), kind: ['num', 'nowrap'] },
      { label: 'Outbound', cell: (x) => moneyCell(x.outbound), kind: ['num', 'nowrap'] },
      { label: 'Allowance', cell: (x) => moneyCell(x.allowance), kind: ['num', 'nowrap'] },
      { label: 'Perks', cell: (x) => partsCell('margin__perks', 'margin-perks', x.perks, x.perkParts), kind: ['num', 'nowrap'] },
      { label: 'THE VAULT', cell: (x) => partsCell('margin__vault', 'margin-vault', x.vault, x.vaultParts), kind: ['num', 'nowrap'] },
      { label: 'Care and warranty', cell: (x) => moneyCell(x.care), kind: ['num', 'nowrap'] },
      { label: 'Margin', cell: (x) => h('span', { data: { testid: 'margin-value' } }, moneyCell(x.margin, x.loss)), kind: ['num', 'nowrap'] },
      { label: 'Margin %', cell: (x) => h('span', { data: { testid: 'margin-percent' } }, moneyCell(x.percent, x.loss)), kind: ['num', 'nowrap'] },
    ],
    rows,
    { empty: MARGIN_TEXT.empty, caption: `Margin ${MARGIN_TAB_LABELS[p.mg].toLowerCase()}` },
  );
}

function missingBlock(r: MarginReport): HTMLElement {
  const items = missingItems(r.missing);
  return h(
    'div',
    { class: ['growth__block', 'margin__missing'], data: { testid: 'margin-missing' } },
    subtitle(MARGIN_TEXT.missing),
    items.length === 0
      ? h('p', { class: 'growth__line', data: { testid: 'margin-missing-none' } }, MARGIN_TEXT.missingNone)
      : h(
          'div',
          null,
          h('p', { class: 'growth__line' }, MARGIN_TEXT.missingLead),
          h(
            'ul',
            { class: 'margin__list' },
            ...items.map((m) =>
              h(
                'li',
                { class: 'margin__item', data: { testid: 'margin-missing-item', key: m.key } },
                h('span', { class: 'margin__item-text' }, m.text),
                h('a', { class: ['idlink', 'margin__fix'], attrs: { href: m.fix.href } }, m.fix.label),
              ),
            ),
          ),
        ),
  );
}

/** THE VAULT's line, beside the tables (D61, OP-26, OP-22): what it cost as the margin counts it, the report's own cost, and the way to it. */
function vaultBlock(r: MarginReport): HTMLElement {
  const cost = vaultReportCost(r.vault);
  const link = linkButton(MARGIN_TEXT.vaultLink, vaultReportHref(), 'ghost');
  link.setAttribute('data-testid', 'margin-vault-link');
  return h(
    'div',
    { class: ['growth__block', 'margin__vault-line'], data: { testid: 'margin-vault-line' } },
    subtitle(MARGIN_TEXT.vault),
    h('p', { class: 'growth__line' }, MARGIN_TEXT.vaultLead),
    h(
      'ul',
      { class: 'margin__list' },
      ...vaultLineItems(r.vault).map((v) =>
        h(
          'li',
          { class: 'margin__item', data: { testid: 'margin-vault-item', key: v.key } },
          h('span', { class: 'margin__item-text' }, v.text, v.note ? h('span', { class: 'cell-sub' }, v.note) : null),
          h('span', { class: 'margin__figure' }, v.figure),
        ),
      ),
      h(
        'li',
        { class: ['margin__item', 'margin__item--report'], data: { testid: 'margin-vault-report', key: 'report' } },
        h(
          'span',
          { class: 'margin__item-text' },
          cost.text,
          cost.kinds ? h('span', { class: 'cell-sub', data: { testid: 'margin-vault-kinds' } }, cost.kinds) : null,
          cost.unknown ? h('span', { class: 'cell-sub', data: { testid: 'margin-vault-unknown' } }, cost.unknown) : null,
        ),
        h('span', { class: 'margin__figure' }, cost.figure),
      ),
    ),
    h('p', { class: ['growth__line', 'margin__reading'], data: { testid: 'margin-vault-reading' } }, MARGIN_VAULT_WORDS.reading),
    h('div', { class: ['margin__item', 'margin__item--link'] }, h('span', { class: 'margin__item-text' }, MARGIN_VAULT_WORDS.report), link),
  );
}

function marginSection(ctx: ViewContext, p: GrowthParams, r: MarginReport | Failed): HTMLElement {
  const settings = linkButton(MARGIN_TEXT.settings, href('marginSettings'), 'ghost');
  settings.setAttribute('data-testid', 'margin-settings-link');
  if (r === 'failed') return section(MARGIN_TEXT.title, emptyState(NOTES.failed), { class: 'panel--growth-margin growth__failed', id: 'growth-margin', tools: [settings] });
  const csv = button(MARGIN_TEXT.csv, { kind: 'ghost', testId: 'margin-csv' });
  csv.addEventListener('click', () =>
    void busy(csv, async () => {
      try {
        saveDownload(await ctx.api.marginCsv({ months: r.window.months }));
      } catch (e) {
        notifyError(e);
      }
    }),
  );
  const empty = marginEmpty(r);
  const vaultShown = !(empty && vaultLineEmpty(r.vault));
  const partner = partnerLine(r);
  return section(
    MARGIN_TEXT.title,
    [
      h('p', { class: ['growth__line', 'margin__lead'], data: { testid: 'margin-line' } }, MARGIN_TEXT.line),
      ...(empty
        ? [h('div', { data: { testid: 'margin-empty' } }, emptyState(MARGIN_TEXT.empty))]
        : [
            h('div', { class: ['kpis', 'margin__kpis'], data: { testid: 'margin-kpis' } }, ...marginKpis(r).map((k) => kpi(k.label, k.value, k.note, 'solid'))),
            h(
              'div',
              { class: 'growth__block', data: { testid: 'margin-groups' } },
              tabs(
                'Margin by',
                MARGIN_TABS.map((t) => ({ key: t, text: [MARGIN_TAB_LABELS[t]], href: growthHref(p, { mg: t === 'model' ? null : t }), current: t === p.mg, testid: `growth-margin-${t}` })),
              ),
              marginTable(p, marginRows(r, p.mg)),
            ),
          ]),
      vaultShown ? vaultBlock(r) : null,
      partner ? h('p', { class: ['growth__line', 'margin__partner'], data: { testid: 'margin-partner' } }, partner) : null,
      missingBlock(r),
    ],
    { note: MARGIN_TEXT.note, class: 'panel--growth-margin', id: 'growth-margin', tools: empty ? [settings] : [csv, settings] },
  );
}

// ── Elsewhere in the console ───────────────────────────────────────────────

function elsewhere(a: AnalyticsData | Failed, circle: CircleStats | Failed, releases: { items: GrowthRelease[] } | Failed, best: BestTime | Failed): HTMLElement {
  const analytics = linkButton('Analytics', href('analytics', {}, { days: 30 }), 'ghost');
  const scans =
    a === 'failed'
      ? failedPanel('Scans by country', 'panel--growth-scans')
      : section('Scans by country', a.total === 0 ? emptyState('No scan counted in these days.') : barList(countryBars(a, 5)), { note: 'The top five over 30 days', tools: [analytics], class: 'panel--growth-scans' });
  const club =
    circle === 'failed'
      ? failedPanel('The circle by tier', 'panel--growth-circle')
      : section('The circle by tier', circle.members.total === 0 ? emptyState('No account holds a piece now.') : barList(circleMemberBars(circle)), {
          tools: [linkButton('Analytics', href('analytics'), 'ghost')],
          class: 'panel--growth-circle',
        });
  const latest =
    releases === 'failed'
      ? failedPanel('Latest releases', 'panel--growth-releases')
      : section(
          'Latest releases',
          table(
            [
              { label: 'Release', cell: (x: ReturnType<typeof releaseRow>) => h('a', { class: 'idlink', attrs: { href: x.link } }, x.title), kind: ['wide'] },
              { label: 'Method', cell: (x) => x.method, kind: ['nowrap'] },
              { label: 'Opened', cell: (x) => x.opened, kind: ['nowrap'] },
              { label: 'Pieces', cell: (x) => x.pieces, kind: ['num'] },
              { label: 'Sold', cell: (x) => x.sold, kind: ['num'] },
              { label: 'Sold out in', cell: (x) => x.soldOutIn, kind: ['num', 'nowrap'] },
              { label: 'Entries', cell: (x) => x.entries, kind: ['num'] },
            ],
            releases.items.map(releaseRow),
            { empty: EMPTY.releases, onRow: (x) => x.link, caption: 'The latest releases past their opening' },
          ),
          { tools: [linkButton('All drops', href('club', {}, { tab: 'drops' }), 'ghost')], class: 'panel--growth-releases' },
        );
  const time =
    best === 'failed'
      ? failedPanel('Best time to open', 'panel--growth-best')
      : section(
          'Best time to open',
          h('p', { class: 'growth__headline', data: { testid: 'growth-best-time' } }, best.suggested ? `${hourText(best.suggested.hour)} Paris · ${shareText(best.suggested.share)} of the activity` : 'Not enough activity yet.'),
          { note: 'Every collector, over 30 days', tools: [linkButton('Analytics', href('analytics', {}, { days: 30 }), 'ghost')], class: 'panel--growth-best' },
        );
  return h(
    'div',
    { class: 'growth__elsewhere', data: { testid: 'growth-elsewhere' } },
    h('h2', { class: ['panel__title', 'growth__heading'] }, 'Elsewhere in the console'),
    h('div', { class: 'grid grid--2' }, scans, club),
    latest,
    time,
  );
}

export async function growthView(ctx: ViewContext): Promise<HTMLElement> {
  const p = growthParams(ctx.route.query);
  const q = { months: p.months, ...(p.currency ? { currency: p.currency } : {}) };
  const [r, collectors, releases, analytics, circle, best, margin] = await Promise.all([
    ctx.api.growth(q),
    ctx.api.growthCollectors({ ...(p.currency ? { currency: p.currency } : {}), page: p.page }).catch(failed),
    ctx.api.growthReleases().catch(failed),
    ctx.api.analytics({ days: 30 }).catch(failed),
    ctx.api.circleStats({ days: 30 }).catch(failed),
    ctx.api.bestTime({ days: 30 }).catch(failed),
    ctx.api.margin({ months: p.months }).catch(failed),
  ]);

  const windowTabs = tabs(
    'Window',
    GROWTH_WINDOWS.map((m) => ({ key: String(m), text: ['Last ', h('span', { class: 'range__figure' }, String(m)), ' months'], href: growthHref(p, { months: m, page: null }), current: m === r.window.months, testid: `growth-window-${m}` })),
  );
  const actions: Child[] = [windowTabs];
  if (r.window.currencies.length > 1) {
    const choice = select('growthCurrency', r.window.currencies.map((c) => ({ value: c, label: c })), r.window.currency);
    choice.setAttribute('aria-label', 'Currency');
    choice.setAttribute('data-testid', 'growth-currency');
    choice.addEventListener('change', () => ctx.setQuery({ currency: choice.value, page: null }));
    actions.push(choice);
  }

  return h(
    'div',
    { class: 'view view--growth' },
    pageHeader({ eyebrow: 'Overview', title: 'Growth', lead: LEAD, actions }),
    h('div', { class: 'kpis', data: { testid: 'growth-kpis' } }, ...growthKpis(r).map((k) => kpi(k.label, k.value, k.note, k.tone))),
    ltvSection(ctx, p, r, collectors),
    repeatSection(r),
    funnelSection(r),
    revenueSection(p, r),
    marginSection(ctx, p, margin),
    elsewhere(analytics, circle, releases, best),
  );
}
