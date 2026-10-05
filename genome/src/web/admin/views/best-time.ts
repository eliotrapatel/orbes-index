/**
 * The best time to open (plan LIVE RELEASE+, choice 10): one panel, on a LIVE RELEASE's page among its readings while
 * its settings change (its tiers, its T0 marked) and in Analytics (any tier, any country). Model in model/best-time.ts;
 * server services/activity.ts. Sign-ins and scans counted by hour, never an account.
 *
 *   19:00 Paris · 23 % of the activity of collectors from PLATINE     the suggested hour
 *   Its T0 · 20:00 Paris · 12 % of that activity                      a release's own
 *   ▁▁▁▂▃▅█▆▃▂ …                                                       the 24 hours of the day, Paris time: the
 *   00 01 02 … 23                                                      suggested one in ink, its T0 outlined, a dot
 *                                                                      under the hours a past release opened at
 *   the table of the hours with anything to say, by tier, with the past releases and their line at T0
 *   the countries, each with its busiest hour
 *   HOW IT IS READ
 *
 * CSP-safe: built with h(), the columns' heights set through the CSSOM (`--f`), as barList does.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { bestTimeCountryBars, bestTimeHeadline, bestTimeReleaseLine, bestTimeRows, hourColumns, hourText } from '../model/best-time.js';
import type { BestTime } from '../types.js';
import { barList, emptyState, section, table } from '../ui/components.js';
import { reasoning } from './live-intelligence.js';

/** The 24 hours as hairline columns (decorative: the table under them says every figure). */
function hourStrip(b: BestTime): HTMLElement {
  return h(
    'div',
    { class: 'best__hours', attrs: { 'aria-hidden': 'true' }, data: { testid: 'best-time-hours' } },
    ...hourColumns(b).map((c) => {
      const fill = h('span', { class: 'best__fill' });
      // CSSOM custom property (CSP-safe): the stylesheet scales the column with it.
      fill.style.setProperty('--f', String(Math.max(0, Math.min(1, c.fraction))));
      return h(
        'span',
        { class: ['best__col', c.suggested ? 'best__col--suggested' : null, c.release ? 'best__col--release' : null, c.past ? 'best__col--past' : null], data: { hour: String(c.hour) } },
        h('span', { class: 'best__track' }, fill),
        h('span', { class: 'best__hour' }, String(c.hour).padStart(2, '0')),
      );
    }),
  );
}

/** The figures of each hour with anything to say. */
function hourTable(b: BestTime): HTMLElement {
  type Row = BestTime['hours'][number];
  return table<Row>(
    [
      { label: 'Hour (Paris)', cell: (x) => hourText(x.hour), kind: ['nowrap'] },
      { label: 'Activity', cell: (x) => formatCount(x.activity), kind: ['num'] },
      { label: 'Sign-ins', cell: (x) => formatCount(x.signIns), kind: ['num'] },
      { label: 'Scans', cell: (x) => formatCount(x.scans), kind: ['num'] },
      { label: 'No tier', cell: (x) => formatCount(x.byTier[0] ?? 0), kind: ['num'] },
      { label: 'Titane', cell: (x) => formatCount(x.byTier[1] ?? 0), kind: ['num'] },
      { label: 'Platine', cell: (x) => formatCount(x.byTier[2] ?? 0), kind: ['num'] },
      { label: 'Palladium', cell: (x) => formatCount(x.byTier[3] ?? 0), kind: ['num'] },
      { label: 'Past releases', cell: (x) => (x.past.releases ? `${formatCount(x.past.releases)} · ${formatCount(x.past.present)} at T0` : '—'), kind: ['num', 'nowrap'] },
    ],
    bestTimeRows(b),
    { empty: 'No sign-in or scan counted in these days.', caption: 'Activity by hour, Paris time' },
  );
}

/** The panel; `failed` says it could not be read, the page stands. */
export function bestTimePanel(b: BestTime | 'failed', opts: { id: string; tools?: Child[]; filters?: Child } = { id: 'best-time' }): HTMLElement {
  if (b === 'failed') return section('Best time to open', h('p', { class: 'notice' }, 'This reading could not be read: read the page again.'), { id: opts.id });
  const release = bestTimeReleaseLine(b);
  const countries = bestTimeCountryBars(b);
  return section(
    'Best time to open',
    [
      opts.filters ?? null,
      h('p', { class: 'best__headline', data: { testid: 'best-time-suggested' } }, bestTimeHeadline(b)),
      release ? h('p', { class: 'best__release', data: { testid: 'best-time-release' } }, release) : null,
      hourStrip(b),
      h('p', { class: 'best__legend' }, 'Paris time · in ink the suggested hour, outlined its T0, dotted the hours past releases opened at'),
      hourTable(b),
      h('h3', { class: 'panel__subtitle' }, 'Countries, each with its busiest hour'),
      countries.length ? barList(countries) : emptyState('No activity from these tiers in these days.'),
      reasoning(b.reasoning, 'best-time-why'),
    ],
    { id: opts.id, note: `Last ${b.days} days · sign-ins and scans, no account`, class: 'panel--best', ...(opts.tools ? { tools: opts.tools } : {}) },
  );
}
