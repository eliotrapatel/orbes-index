/**
 * The collectors behind a figure, `#/links/collectors?source&attribution&measure&period&from&to&currency&name&page`
 * (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.10.4; step 4.9), from GET /api/admin/acquisition/collectors: the
 * collectors a figure of the Links page or of a link's page counts, under its attribution, in its period, 25 a page,
 * the newest sign-up first, each row opening the client sheet. Emails are masked for an AUDITOR by the server.
 *
 *   Title from the figure: « Sign-ups through Instagram bio · first link · 30 days » (« Sign-ups · Direct · … »).
 *   Columns COLLECTOR · COUNTRY · SIGNED UP · ENTRIES · PURCHASES · REVENUE (in the period, under that attribution).
 *   Empty: « No collector for this figure in these days. »
 *
 * `collectorsTable` is shared with a link's page (views/link.ts).
 */
import { h } from '../../shared/dom.js';
import { collectorRow, collectorsParams, collectorsTitle, COLLECTORS_COPY as K, linkHref } from '../model/links.js';
import { href } from '../router.js';
import type { LinkFigureCollectors } from '../types.js';
import { linkButton, pageHeader, pager, table } from '../ui/components.js';
import type { ViewContext } from './context.js';

/** A title in the display face, its figures in --font (`30 days`, `Story 14 Oct`), as GROWTH sets them. */
export function figuresTitle(text: string): HTMLElement {
  return h('span', null, ...text.split(/(\d+)/).filter(Boolean).map((part) => (/^\d+$/.test(part) ? h('span', { class: 'growth__figure' }, part) : part)));
}

/** The list: one row per collector, opening its client sheet; the pager under it. */
export function collectorsTable(page: LinkFigureCollectors, go: (page: number) => void): HTMLElement {
  const rows = page.items.map((c) => collectorRow(c, page.currency));
  return h(
    'div',
    { class: 'links__collectors', data: { testid: 'link-collectors' } },
    table(
      [
        { label: K.columns.collector, cell: (x: (typeof rows)[number]) => h('a', { class: 'idlink', attrs: { href: x.link, 'data-testid': 'link-collector' } }, x.email), kind: ['email'] },
        { label: K.columns.country, cell: (x) => x.country, kind: ['nowrap'] },
        { label: K.columns.signedUp, cell: (x) => x.signedUp, kind: ['nowrap'] },
        { label: K.columns.entries, cell: (x) => x.entries, kind: ['num'] },
        { label: K.columns.purchases, cell: (x) => x.purchases, kind: ['num'] },
        { label: K.columns.revenue, cell: (x) => x.revenue, kind: ['num', 'nowrap'] },
      ],
      rows,
      { empty: K.empty, onRow: (x) => x.link, caption: K.columns.collector },
    ),
    pager(page, go),
  );
}

export async function linkCollectorsView(ctx: ViewContext): Promise<HTMLElement> {
  const q = collectorsParams(ctx.route.query, ctx.now());
  const back = linkButton(K.back, href('links'), 'ghost');
  if (!q) return h('div', { class: 'view view--link-collectors' }, pageHeader({ eyebrow: K.eyebrow, title: K.back, actions: [back] }), table([], [], { empty: K.empty }));
  const page = await ctx.api.linkCollectors({ source: q.source, attribution: q.attribution, measure: q.measure, from: q.from, to: q.to, currency: q.currency, page: q.page });
  const actions = [q.linkId ? linkButton(q.name, linkHref(q.linkId), 'ghost') : null, back].filter((x): x is HTMLAnchorElement => x !== null);
  return h(
    'div',
    { class: 'view view--link-collectors' },
    pageHeader({ eyebrow: K.eyebrow, title: figuresTitle(collectorsTitle(q)), actions }),
    h('section', { class: 'panel' }, collectorsTable(page, (n) => ctx.setQuery({ page: n > 1 ? n : null }))),
  );
}
