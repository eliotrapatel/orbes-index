/**
 * Genomes registry: every derived GENOME, its glyph pattern drawn in the
 * row layout, fingerprint and value.
 */
import { h } from '../../shared/dom.js';
import { formatDate } from '../format.js';
import { productHref } from '../router.js';
import { mono, pageHeader, pager, table } from '../ui/components.js';
import { genomeFigure } from '../ui/figures.js';
import { pageParam, type ViewContext } from './context.js';

export async function genomesView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.genomes(pageParam(ctx), 50);
  return h(
    'div',
    { class: 'view view--genomes' },
    pageHeader({ eyebrow: 'Registry', title: 'Genomes', lead: 'GENOME-01: eight glyphs per identity, a public bijection of the canonical product id.' }),
    table(
      [
        { label: 'Genome', cell: (g) => genomeFigure(g, { layout: 'row', size: 'sm', framed: false }), kind: ['nowrap'] },
        { label: 'Product', cell: (g) => h('a', { class: 'idlink', attrs: { href: productHref(g.productId) } }, g.productId), kind: ['nowrap'] },
        { label: 'Fingerprint', cell: (g) => mono(g.fingerprint), kind: ['nowrap'] },
        { label: 'Pattern', cell: (g) => h('span', { class: 'cell-details' }, g.pattern), kind: ['wide'] },
        { label: 'Version', cell: (g) => g.versionLabel, kind: ['nowrap'] },
        { label: 'Value', cell: (g) => mono(`0x${(g.value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`), kind: ['nowrap'] },
        { label: 'Created', cell: (g) => formatDate(g.createdAt), kind: ['nowrap'] },
      ],
      list.items,
      { empty: 'No genome yet.', onRow: (g) => productHref(g.productId), caption: 'Genomes' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
