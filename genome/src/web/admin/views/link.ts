/**
 * A link's page, `#/links/:linkId` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.10.3; step 4.9), from its name on
 * the Links page: GET /api/admin/links/:id (services/acquisition-report.ts `link`) for the period asked.
 *
 *   - Its channel and short address with Copy; where it goes (« Goes to a release that no longer exists: it opens THE
 *     RELEASES. » when its release is gone or cancelled); who made it and when (Paris); its note; ARCHIVED on ….
 *   - Edit, Archive (confirmed: it keeps working where it is posted) and Unarchive, for manageLinks (OPERATOR).
 *   - The period control as on the Links page; the figures, Visits and First visits once above two columns FIRST
 *     LINK · DISCOVERY and LAST LINK · CONVERSION (Sign-ups, Entries, Purchases, Revenue, Return), each figure opening
 *     its collectors; « No visit yet… » while it has brought nothing.
 *   - By day: hairline bars of visits per Paris day (weeks beyond 90 days), with « Sign-ups (first) · Sign-ups (last) »
 *     as each row's figures.
 *   - Collectors, tabs FIRST LINK · LAST LINK and the measure (Sign-ups by default): the list of A.10.4 for this link.
 */
import { h, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatCount } from '../format.js';
import {
  attributionCells,
  COLLECTORS_COPY as K,
  dayBars,
  destinationText,
  HEADING_NOTES,
  LINK_PAGE as P,
  LINK_PERIODS,
  LINKS_COPY as C,
  linkUnused,
  linksParams,
  linksQuery,
  MEASURE_LABELS,
  MEASURES,
  parisDateTime,
  parisDay,
  PERIOD_TABS,
  returnCell,
  type LinkPeriod,
} from '../model/links.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import { LINK_ATTRIBUTIONS, type LinkAttribution, type LinkDestinations, type LinkMeasure, type LinkReport } from '../types.js';
import { barList, button, copyButton, emptyState, linkButton, pageHeader, section, select } from '../ui/components.js';
import { confirmAction } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { collectorsTable, figuresTitle } from './link-collectors.js';
import { customPeriodForm, openLinkDialog } from './links.js';

function tabs(label: string, items: { text: Child[]; href: string; current: boolean; testid: string }[]): HTMLElement {
  return h(
    'nav',
    { class: 'range', attrs: { 'aria-label': label } },
    ...items.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: t.href, 'aria-current': t.current ? 'page' : null, 'data-testid': t.testid } }, ...t.text),
    ]),
  );
}

const periodText = (x: LinkPeriod): Child[] => {
  const t = PERIOD_TABS[x];
  return t.figure ? [h('span', { class: 'range__figure' }, t.figure), ` ${t.words}`] : [t.words];
};

export async function linkView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.linkId ?? '';
  const p = linksParams(ctx.route.query, ctx.now());
  const attribution: LinkAttribution = ctx.route.query.attribution === 'last' ? 'last' : 'first';
  const measure: LinkMeasure = (MEASURES as readonly string[]).includes(ctx.route.query.measure ?? '') ? (ctx.route.query.measure as LinkMeasure) : 'signups';
  const page = Number(ctx.route.query.page);
  const manage = can(ctx.session.admin.role, 'manageLinks');
  const here = (q: Record<string, string | null | undefined>) => href('link', { linkId: id }, { ...linksQuery(p), view: null, archived: null, attribution: attribution === 'last' ? 'last' : null, measure: measure === 'signups' ? null : measure, ...q });

  const [report, destinations] = await Promise.all([
    ctx.api.linkReport(id, { from: p.from, to: p.to, currency: p.currency }),
    ctx.api.linkDestinations().catch((): LinkDestinations | null => null),
  ]);
  const l = report.link;
  let collectors: Awaited<ReturnType<typeof ctx.api.linkCollectors>> | null = null;
  try {
    collectors = await ctx.api.linkCollectors({ source: `link:${l.id}`, attribution, measure, from: p.from, to: p.to, currency: p.currency, page: Number.isInteger(page) && page > 1 ? page : 1 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
  }

  // ── Tools ──
  const edit = async () => {
    try {
      const channels = await ctx.api.linkChannels();
      const saved = await openLinkDialog(ctx.api, { link: l, channels, destinations: destinations ?? (await ctx.api.linkDestinations()), taken: new Set() });
      if (saved) ctx.reload();
    } catch (e) {
      notifyError(e);
    }
  };
  const archive = async () => {
    try {
      if (l.archivedAt === null) {
        if (!(await confirmAction(P.archiveTitle, P.archiveText, P.archive))) return;
        await ctx.api.archiveLink(l.id, true);
        notify(P.archived);
      } else {
        await ctx.api.archiveLink(l.id, false);
        notify(P.unarchived);
      }
      ctx.reload();
    } catch (e) {
      notifyError(e);
    }
  };
  const actions: Child[] = [
    ...(manage
      ? [
          button(P.edit, { kind: 'secondary', testId: 'link-edit', onClick: () => void edit() }),
          button(l.archivedAt === null ? P.archive : P.unarchive, { kind: 'ghost', testId: 'link-archive', onClick: () => void archive() }),
        ]
      : []),
    linkButton(C.title, href('links'), 'ghost'),
  ];

  // ── Facts ──
  const gone = report.destinationGone ? (l.destination === 'MODEL' ? P.goneModel : P.gone) : null;
  const facts = h(
    'div',
    { class: 'link__facts', data: { testid: 'link-facts' } },
    h('p', { class: 'link__line' }, h('span', { class: 'link__channel' }, l.channel.name.toUpperCase()), ' · ', h('span', { class: 'mono', data: { testid: 'link-address' } }, l.address.replace(/^https?:\/\//, '')), ' ', copyButton(l.address, C.copy)),
    h('p', { class: 'link__line', data: { testid: 'link-goes-to' } }, gone ?? P.goesTo(destinationText(l, destinations))),
    h('p', { class: 'link__line link__soft' }, P.made(l.createdBy.email, parisDateTime(l.createdAt))),
    l.note ? h('p', { class: 'link__line link__soft', data: { testid: 'link-note' } }, l.note) : null,
    l.archivedAt ? h('p', { class: 'link__line link__soft', data: { testid: 'link-archived-on' } }, P.archivedOn(parisDateTime(l.archivedAt))) : null,
  );

  // ── Period ──
  const period = tabs(
    C.period,
    LINK_PERIODS.map((x) => ({ text: periodText(x), href: here({ ...linksQuery(p, { period: x }), view: null, archived: null, page: null }), current: x === p.period, testid: `link-period-${x}` })),
  );
  // On a phone, the period as a select, as on the Links page.
  const periodSelect = select('linkPeriod', LINK_PERIODS.map((x) => ({ value: x, label: `${PERIOD_TABS[x].figure ? `${PERIOD_TABS[x].figure} ` : ''}${PERIOD_TABS[x].words}` })), p.period);
  periodSelect.setAttribute('aria-label', C.period);
  periodSelect.addEventListener('change', () => ctx.navigate(here({ ...linksQuery(p, { period: periodSelect.value as LinkPeriod }), view: null, archived: null, page: null })));
  const extra: Child[] = [];
  const custom = p.period === 'custom' ? customPeriodForm(p, (from, to) => ctx.navigate(here({ ...linksQuery(p, { period: 'custom', from, to }), view: null, archived: null, page: null }))) : null;
  if (report.currencies.length > 1) {
    const cur = select('linkCurrency', report.currencies.map((c) => ({ value: c, label: c })), report.currency);
    cur.setAttribute('aria-label', C.currency);
    cur.addEventListener('change', () => ctx.navigate(here({ currency: cur.value, page: null })));
    extra.push(cur);
  }

  // ── Figures ──
  const q = { period: p.period, from: p.from, to: p.to, currency: p.currency ?? report.currency };
  const ref = { source: `link:${l.id}`, name: l.name };
  const column = (a: LinkAttribution) => {
    const cells = attributionCells(report.figures, a, ref, q, report.currency, { linkId: l.id });
    const r = returnCell(report.returns?.[a], report.currency);
    return h(
      'dl',
      { class: 'link__col', data: { testid: `link-${a}` } },
      h('dt', { class: 'link__col-title', attrs: { title: a === 'first' ? HEADING_NOTES.first : HEADING_NOTES.last } }, a === 'first' ? C.firstGroup : C.lastGroup),
      ...MEASURES.map((m) =>
        h(
          'dd',
          { class: 'link__fig', data: { key: m } },
          h('span', { class: 'link__fig-label' }, MEASURE_LABELS[m]),
          cells[m].href ? h('a', { class: 'idlink', attrs: { href: cells[m].href, 'data-testid': `link-figure-${a}-${m}` } }, cells[m].text) : h('span', null, cells[m].text),
        ),
      ),
      h('dd', { class: 'link__fig', data: { key: 'return' } }, h('span', { class: 'link__fig-label' }, 'Return'), h('span', { class: 'links__return' }, h('span', null, r.text), r.sub ? h('span', { class: 'cell-sub' }, r.sub) : null)),
    );
  };
  const figures = section(
    P.figures,
    [
      linkUnused(report) ? emptyState(P.nothingYet) : null,
      h(
        'p',
        { class: 'link__visits', data: { testid: 'link-visits' } },
        C.visitsLine(formatCount(report.figures.visits), formatCount(report.figures.firstVisits)),
      ),
      h('div', { class: 'link__cols' }, column('first'), column('last')),
    ],
    { id: 'link-figures', note: HEADING_NOTES.entries },
  );

  // ── By day ──
  const days = dayBars(report.days, report.period, parisDay(ctx.now()));
  const byDay = section(P.byDay, days.bars.some((b) => b.value > 0 || b.share !== '0 · 0') ? h('div', { class: 'link__bars', data: { testid: 'link-days' } }, barList(days.bars)) : emptyState(P.noDay), {
    id: 'link-days',
    note: days.weeks ? P.byWeekNote : P.byDayNote,
  });

  // ── Collectors ──
  const attrTabs = tabs(
    P.collectors,
    LINK_ATTRIBUTIONS.map((a) => ({ text: [K.tabs[a]], href: here({ attribution: a === 'last' ? 'last' : null, page: null }), current: a === attribution, testid: `link-collectors-${a}` })),
  );
  const measureSelect = select('linkMeasure', MEASURES.map((m) => ({ value: m, label: MEASURE_LABELS[m] })), measure);
  measureSelect.setAttribute('aria-label', K.measure);
  measureSelect.addEventListener('change', () => ctx.navigate(here({ measure: measureSelect.value === 'signups' ? null : measureSelect.value, page: null })));
  const list = section(
    P.collectors,
    [h('div', { class: 'links__bar' }, attrTabs, measureSelect), collectors ? collectorsTable(collectors, (n) => ctx.setQuery({ page: n > 1 ? n : null })) : emptyState(C.failed)],
    { id: 'link-collectors' },
  );

  return h(
    'div',
    { class: 'view view--link' },
    pageHeader({ eyebrow: P.crumb(l.name), title: figuresTitle(l.name), actions }),
    facts,
    h('div', { class: 'links__controls' }, h('div', { class: 'links__bar links__bar--desk' }, period), h('div', { class: 'links__bar links__bar--phone' }, periodSelect), extra.length ? h('div', { class: 'links__bar' }, ...extra) : null, custom),
    figures,
    byDay,
    list,
  );
}
