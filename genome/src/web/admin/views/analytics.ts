/**
 * Analytics (A-09): where the pieces are scanned and where the counterfeit
 * signals appear, over the last 30 or 90 complete days, on one page. Every
 * figure comes from the daily scan statistics (GET /api/admin/analytics),
 * which outlive the scan history and leave staff scans out.
 *
 * Four figures; every scan per day with a cursor that reads a day; one
 * small curve per verification state; the countries with the most scans and
 * the countries of the counterfeit signals (INVALID SIGNATURE, UNKNOWN,
 * MALFORMED CODE, SUSPICIOUS ACTIVITY) as hairline bars, then their
 * breakdown by result; the days with scans as a table. No map: the CSP admits no
 * external tiles, and the volume does not call for one.
 *
 * Then The Circle (P-X01, GET /api/admin/analytics/circle, the same window):
 * the members of the club by tier now, and the visits of the circle by day,
 * counted per day without any account (no follow-up of anyone). A panel that
 * cannot be read says so; the rest of the page stands.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate } from '../format.js';
import { circleMemberBars, circleVisitDays } from '../model/circle.js';
import {
  ANALYTICS_RANGES,
  analyticsKpis,
  analyticsLead,
  analyticsRange,
  AUTHENTIC_STATES,
  countryBars,
  countryLabel,
  signalBars,
  signalCountries,
  SIGNAL_COLUMNS,
  stateRows,
  type AnalyticsRange,
} from '../model/analytics.js';
import { href } from '../router.js';
import type { AnalyticsData, CircleStats } from '../types.js';
import { trendChart, sparkline } from '../ui/charts.js';
import { barList, emptyState, kpi, pageHeader, section, statusMark, table } from '../ui/components.js';
import type { ViewContext } from './context.js';

/** LAST 30 DAYS · LAST 90 DAYS, each its own URL; the figures read in Helvetica Neue inside the display-face tab. */
function rangeTabs(current: AnalyticsRange): HTMLElement {
  const tabs = ANALYTICS_RANGES.map((days) =>
    h(
      'a',
      { class: 'range__tab', attrs: { href: href('analytics', {}, { days }), 'aria-current': days === current ? 'page' : null, 'data-testid': `range-${days}` } },
      'Last ',
      h('span', { class: 'range__figure' }, String(days)),
      ' days',
    ),
  );
  return h('nav', { class: 'range', attrs: { 'aria-label': 'Window' } }, tabs[0], h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }), tabs[1]);
}

/** One row per verification state: its mark and name (a link to its scans), its curve, its total and share. */
function stateList(d: AnalyticsData): HTMLElement {
  return h(
    'ul',
    { class: 'srows', data: { testid: 'analytics-states' } },
    ...stateRows(d).map((r) =>
      h(
        'li',
        { class: ['srow', r.total === 0 ? 'srow--zero' : null], data: { state: r.state } },
        h('a', { class: 'srow__label', attrs: { href: r.link } }, statusMark(r.label, r.tone)),
        h('span', { class: 'srow__curve' }, sparkline(r)),
        h('span', { class: 'srow__value' }, formatCount(r.total)),
        h('span', { class: 'srow__share' }, r.share),
      ),
    ),
  );
}

/** The countries of the signals, state by state. */
function signalTable(d: AnalyticsData): HTMLElement {
  return table(
    [
      { label: 'Country', cell: (c) => countryLabel(c.country), kind: ['nowrap'] },
      ...SIGNAL_COLUMNS.map((col) => ({
        label: col.label,
        cell: (c: AnalyticsData['countries'][number]) => {
          const n = c.byState[col.state] ?? 0;
          return n > 0 && col.state === 'INVALID_SIGNATURE' ? h('span', { class: 'critical-text' }, formatCount(n)) : formatCount(n);
        },
        kind: ['num' as const],
      })),
      { label: 'Signals', cell: (c) => formatCount(c.signals), kind: ['num'] },
      { label: 'All scans', cell: (c) => formatCount(c.total), kind: ['num'] },
    ],
    signalCountries(d),
    { empty: 'No counterfeit signal in these days.', caption: 'Counterfeit signals by country and state' },
  );
}

/** The chart's figures as a table: the days with scans, newest first. */
function dailyTable(d: AnalyticsData): HTMLElement {
  const days = d.daily.filter((x) => x.total > 0).reverse();
  return table(
    [
      { label: 'Day', cell: (x) => formatDate(x.day), kind: ['nowrap'] },
      { label: 'Scans', cell: (x) => formatCount(x.total), kind: ['num'] },
      { label: 'Authentic', cell: (x) => formatCount(AUTHENTIC_STATES.reduce((a, s) => a + (x.byState[s] ?? 0), 0)), kind: ['num'] },
      ...SIGNAL_COLUMNS.map((col) => ({ label: col.label, cell: (x: AnalyticsData['daily'][number]) => formatCount(x.byState[col.state] ?? 0), kind: ['num' as const] })),
    ],
    days,
    { empty: 'No scan counted in these days.', caption: 'Scans per day' },
  );
}

/** The Circle (P-X01): the members of the club by tier now, the visits of the window by day; never an account. */
function circlePanel(c: CircleStats | null): HTMLElement {
  if (!c) return section('The Circle', emptyState('The figures of the circle could not be read just now.'), { class: 'panel--circle' });
  const days = circleVisitDays(c);
  return section(
    'The Circle',
    h(
      'div',
      { class: 'grid grid--2' },
      h(
        'div',
        { data: { testid: 'circle-members' } },
        h('h3', { class: 'panel__subtitle' }, 'Members now, by tier'),
        c.members.total === 0 ? emptyState('No account holds a piece now.') : barList(circleMemberBars(c)),
      ),
      h(
        'div',
        { data: { testid: 'circle-visits' } },
        h('h3', { class: 'panel__subtitle' }, 'Visits by day'),
        table(
          [
            { label: 'Day', cell: (x: { day: string; visits: number }) => formatDate(x.day), kind: ['nowrap'] },
            { label: 'Visits', cell: (x: { day: string; visits: number }) => formatCount(x.visits), kind: ['num'] },
          ],
          days,
          { empty: 'No visit of the circle in these days.', caption: 'Visits of the circle by day' },
        ),
      ),
    ),
    {
      note: `${formatCount(c.members.total)} ${c.members.total === 1 ? 'member' : 'members'} · ${formatCount(c.visits.total)} ${c.visits.total === 1 ? 'visit' : 'visits'} · counted per day, without any account`,
      class: 'panel--circle',
    },
  );
}

export async function analyticsView(ctx: ViewContext): Promise<HTMLElement> {
  const range = analyticsRange(ctx.route.query);
  const [d, circle] = await Promise.all([ctx.api.analytics({ days: range }), ctx.api.circleStats({ days: range }).catch(() => null)]);
  const none = d.total === 0;

  return h(
    'div',
    { class: 'view view--analytics' },
    pageHeader({ eyebrow: 'Activity', title: 'Analytics', lead: analyticsLead(d), actions: [rangeTabs(range)] }),
    h('div', { class: 'kpis' }, ...analyticsKpis(d).map((k) => kpi(k.label, k.value, k.note, k.tone))),
    section('Scans by day', none ? emptyState('No scan counted in these days.') : trendChart(d), {
      note: `${formatDate(d.from)} – ${formatDate(d.to)}`,
      class: 'panel--trend',
    }),
    section('By result', stateList(d), { note: 'Each curve to its busiest day' }),
    h(
      'div',
      { class: 'grid grid--2' },
      section('Countries', none ? emptyState('No scan counted in these days.') : barList(countryBars(d)), { note: 'Most scans', class: 'panel--countries' }),
      section('Counterfeit signals by country', d.signals.total === 0 ? emptyState('No counterfeit signal in these days.') : barList(signalBars(d)), {
        note: 'Invalid signature · Unknown · Malformed code · Suspicious activity',
        class: 'panel--signals',
      }),
    ),
    section('Signals by country and result', signalTable(d), { note: 'Country by country', class: 'panel--signal-table' }),
    section('Days with scans', dailyTable(d), { note: `${formatCount(d.daily.filter((x) => x.total > 0).length)} of ${formatCount(d.days)} days` }),
    circlePanel(circle),
  );
}
