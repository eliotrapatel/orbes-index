/**
 * The collectors behind one figure of the Collectors page, `#/collectors/list?…the page's query…&slice=…&page=` (plan
 * CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6.5; step 9.11), from GET /api/admin/collectors/list: 50 a page, ordered
 * by email for every figure, each row opening the client sheet.
 *
 *   - Eyebrow 'Collectors'; the title names the figure without ranking anyone (« Country: France », « Wish for MONOLITHE
 *     · Blue on 14 OCT 2026 »); the lead is the view in words; Back to the figures returns to the page with its query.
 *   - The table: Email · Name · Country · City · Tier · Joined · Last seen (and the words given for HOW THEY HEARD's
 *     Other); no score, tag, mark or colour. An AUDITOR reads the emails masked and no city (§3.0 (h)): the column goes.
 *   - The pager reads « 1–50 of 312 »; the note « Read now: … »; empty: « No collector in this figure now. »
 *
 * The console's house style; text through h() only (CSP-safe).
 */
import { h } from '../../shared/dom.js';
import { countryName } from '../model/analytics.js';
import { collectorsApiQuery, collectorsHref, joinedText, LIST_COPY as K, listParams, listTitle, periodDays, tierWords, viewWords } from '../model/collectors.js';
import { parisDateTime } from '../model/links.js';
import { href } from '../router.js';
import type { CollectorsListRow, CollectorsOptions, TrendFigure, TrendSplit } from '../types.js';
import { linkButton, pageHeader, pager, table, type Column } from '../ui/components.js';
import type { ViewContext } from './context.js';
import { figuresTitle } from './link-collectors.js';

export async function collectorsListView(ctx: ViewContext): Promise<HTMLElement> {
  const l = listParams(ctx.route.query, ctx.now());
  const back = linkButton(K.back, collectorsHref(l), 'ghost');
  back.setAttribute('data-testid', 'collectors-list-back');
  const [list, options] = await Promise.all([
    ctx.api.collectorsList({
      ...collectorsApiQuery(l, { ...(l.figure ? { figure: l.figure as TrendFigure } : {}), ...(l.split ? { split: l.split as TrendSplit } : {}) }),
      slice: l.slice,
      page: l.page,
    }),
    ctx.api.collectorsOptions().catch((): CollectorsOptions | null => null),
  ]);
  const withCities = ctx.session.admin.role !== 'AUDITOR';
  const heardOther = list.rows.some((r) => r.heardOther !== undefined);
  const columns: Column<CollectorsListRow>[] = [
    { label: K.columns.email, cell: (r) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: r.accountId }), 'data-testid': 'collectors-list-row' } }, r.email), kind: ['email'] },
    { label: K.columns.name, cell: (r) => r.name ?? '—', kind: ['wrap'] },
    { label: K.columns.country, cell: (r) => (r.country ? `${r.country} · ${countryName(r.country)}` : '—'), kind: ['nowrap'] },
    ...(withCities ? [{ label: K.columns.city, cell: (r: CollectorsListRow) => r.city ?? '—', kind: ['nowrap' as const] }] : []),
    { label: K.columns.tier, cell: (r) => tierWords(r.tier), kind: ['nowrap'] },
    { label: K.columns.joined, cell: (r) => joinedText(r.createdAt), kind: ['nowrap'] },
    { label: K.columns.lastSeen, cell: (r) => (r.lastSeenAt ? parisDateTime(r.lastSeenAt) : '—'), kind: ['nowrap'] },
    ...(heardOther ? [{ label: K.columns.words, cell: (r: CollectorsListRow) => r.heardOther ?? '—', kind: ['wrap' as const] }] : []),
  ];
  const end = list.period?.to ?? periodDays(l, ctx.now()).to;
  return h(
    'div',
    { class: ['view', 'view--collectors-list'], data: { testid: 'collectors-list' } },
    pageHeader({ eyebrow: K.eyebrow, title: figuresTitle(listTitle(l, list.subject, options, end)), lead: viewWords(l, options, ctx.now()), actions: [back] }),
    h(
      'section',
      { class: 'panel' },
      table(columns, list.rows, { empty: K.empty, onRow: (r) => href('owner', { accountId: r.accountId }), caption: K.eyebrow }),
      pager(list, (n) => ctx.setQuery({ page: n > 1 ? n : null })),
      h('p', { class: 'growth__line', data: { testid: 'collectors-list-note' } }, K.note),
    ),
  );
}
