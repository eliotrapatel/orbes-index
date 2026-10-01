/**
 * Owners: customer accounts with their current and lifetime product counts.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate, humanize, shortHash } from '../format.js';
import { mono, pageHeader, pager, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

export async function ownersView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.owners(pageParam(ctx), 50);
  return h(
    'div',
    { class: 'view view--owners' },
    pageHeader({ eyebrow: 'Clients', title: 'Owners', lead: 'Registered client accounts. Ownership never changes a product’s cryptographic identity.' }),
    table(
      [
        { label: 'Account', cell: (o) => h('span', null, o.email, o.displayName ? h('span', { class: 'cell-sub' }, o.displayName) : null), kind: ['wide'] },
        { label: 'Status', cell: (o) => statusMark(humanize(o.status), o.status === 'ACTIVE' ? 'solid' : 'alert'), kind: ['nowrap'] },
        { label: 'Country', cell: (o) => o.country ?? '—', kind: ['nowrap'] },
        { label: 'Products', cell: (o) => formatCount(o.products), kind: ['num'] },
        { label: 'Ever owned', cell: (o) => formatCount(o.productsEver), kind: ['num'] },
        { label: 'Since', cell: (o) => formatDate(o.createdAt), kind: ['nowrap'] },
        { label: 'Id', cell: (o) => mono(o.id, shortHash(o.id, 8, 4)), kind: ['nowrap'] },
      ],
      list.items,
      { empty: 'No client account yet.', caption: 'Owners' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
