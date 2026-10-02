/**
 * Warranties, filterable by computed status (NOT_STARTED, ACTIVE, EXPIRED, VOID).
 */
import { h } from '../../shared/dom.js';
import { formatDate, humanize } from '../format.js';
import { toneOf } from '../model/tone.js';
import { productHref } from '../router.js';
import { WARRANTY_STATUSES } from '../types.js';
import { field, filterBar, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

export async function warrantiesView(ctx: ViewContext): Promise<HTMLElement> {
  const status = ctx.route.query.status;
  const list = await ctx.api.warranties({ status, page: pageParam(ctx), pageSize: 50 });
  const filter = select('status', [{ value: '', label: 'All' }, ...WARRANTY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], status ?? '');
  filter.addEventListener('change', () => ctx.setQuery({ status: filter.value, page: undefined }));
  return h(
    'div',
    { class: 'view view--warranties' },
    pageHeader({ eyebrow: 'Clients', title: 'Warranties', lead: 'Started on the purchase date for the category’s warranty period.' }),
    filterBar(field('Status', filter)),
    table(
      [
        { label: 'Product', cell: (w) => h('a', { class: 'idlink', attrs: { href: productHref(w.productId) } }, w.productId), kind: ['nowrap'] },
        { label: 'Status', cell: (w) => statusMark(humanize(w.status), toneOf('warranty', w.status)), kind: ['nowrap'] },
        { label: 'Start', cell: (w) => formatDate(w.startDate), kind: ['nowrap'] },
        { label: 'End', cell: (w) => formatDate(w.endDate), kind: ['nowrap'] },
        { label: 'Months', cell: (w) => String(w.durationMonths), kind: ['num'] },
        { label: 'Point of sale', cell: (w) => w.retailer ?? '—', kind: ['wide'] },
        { label: 'Country', cell: (w) => w.country ?? '—', kind: ['nowrap'] },
        { label: 'Void', cell: (w) => (w.voidedAt ? h('span', { attrs: { title: w.voidReason ?? '' } }, formatDate(w.voidedAt)) : '—'), kind: ['nowrap'] },
      ],
      list.items,
      { empty: status ? 'No warranty with this status.' : 'No warranty yet.', onRow: (w) => productHref(w.productId), caption: 'Warranties' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
