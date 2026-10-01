/**
 * Products registry: search (product id, SKU, model, genome fingerprint),
 * status and category filters, paginated.
 */
import { h } from '../../shared/dom.js';
import { formatDate, humanize } from '../format.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { PRODUCT_STATUSES } from '../types.js';
import { button, field, filterBar, input, linkButton, mono, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

export async function productsView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const page = pageParam(ctx);
  const [list, cats] = await Promise.all([
    ctx.api.products({ status: q.status, category: q.category, q: q.q, page, pageSize: 50 }),
    ctx.api.categories(),
  ]);

  const search = input('q', { value: q.q ?? '', placeholder: 'O26-J-00184, SKU, model, G1-…', maxlength: 64 });
  const status = select('status', [{ value: '', label: 'All statuses' }, ...PRODUCT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], q.status ?? '');
  const category = select('category', [{ value: '', label: 'All categories' }, ...cats.items.map((c) => ({ value: c.code, label: `${humanize(c.name)} · ${c.code}` }))], q.category ?? '');
  const form = h('form', { class: 'filters__form', attrs: { role: 'search' } },
    filterBar(field('Search', search), field('Status', status), field('Category', category), button('Apply', { type: 'submit', kind: 'secondary' })),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ q: search.value.trim(), status: status.value, category: category.value, page: undefined });
  });
  status.addEventListener('change', () => form.requestSubmit());
  category.addEventListener('change', () => form.requestSubmit());

  return h(
    'div',
    { class: 'view view--products' },
    pageHeader({
      eyebrow: 'Registry',
      title: 'Products',
      lead: 'Every issued identity, its genome and the code in force.',
      actions: can(ctx.session.admin.role, 'issue') ? [linkButton('Issue a product', href('generator'), 'primary')] : [],
    }),
    form,
    table(
      [
        { label: 'Product', cell: (r) => h('a', { class: 'idlink', attrs: { href: productHref(r.productId) } }, r.productId), kind: ['nowrap'] },
        { label: 'Model', cell: (r) => h('span', null, humanize(r.model), h('span', { class: 'cell-sub' }, humanize(r.modelType))) },
        { label: 'Collection', cell: (r) => humanize(r.collection) },
        { label: 'Material', cell: (r) => humanize(r.material), kind: ['wide'] },
        { label: 'Genome', cell: (r) => mono(r.genomeFingerprint), kind: ['nowrap'] },
        { label: 'Code', cell: (r) => (r.codeIssue ? `ISSUE ${r.codeIssue}` : '—'), kind: ['nowrap'] },
        { label: 'Status', cell: (r) => statusMark(humanize(r.status), toneOf('product', r.status)), kind: ['nowrap'] },
        { label: 'Ownership', cell: (r) => humanize(r.ownershipState), kind: ['nowrap'] },
        { label: 'Created', cell: (r) => formatDate(r.createdAt), kind: ['nowrap'] },
      ],
      list.items,
      { empty: q.q || q.status || q.category ? 'No product matches these filters.' : 'No product issued yet.', onRow: (r) => productHref(r.productId), caption: 'Products' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
