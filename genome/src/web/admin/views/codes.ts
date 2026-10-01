/**
 * Codes registry: every signed code with its issue, key, status and payload
 * hash. Read views never carry the scannable data (the API withholds it).
 */
import { h } from '../../shared/dom.js';
import { formatDate, humanize, shortHash, versionLabel } from '../format.js';
import { toneOf } from '../model/tone.js';
import { productHref } from '../router.js';
import { mono, pageHeader, pager, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

export async function codesView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.codes(pageParam(ctx), 50);
  return h(
    'div',
    { class: 'view view--codes' },
    pageHeader({ eyebrow: 'Registry', title: 'Codes', lead: 'Signed CODE-01 artifacts. A product may hold several issues; only one is ACTIVE.' }),
    table(
      [
        { label: 'Product', cell: (c) => h('a', { class: 'idlink', attrs: { href: productHref(c.productId) } }, c.productId), kind: ['nowrap'] },
        { label: 'Issue', cell: (c) => String(c.issue), kind: ['num'] },
        { label: 'Status', cell: (c) => statusMark(humanize(c.status), toneOf('code', c.status)), kind: ['nowrap'] },
        { label: 'Version', cell: (c) => versionLabel('CODE', c.codeVersion), kind: ['nowrap'] },
        { label: 'Key', cell: (c) => mono(`#${c.keyId}`), kind: ['nowrap'] },
        { label: 'Issued', cell: (c) => formatDate(c.issuedAt), kind: ['nowrap'] },
        { label: 'Payload SHA-256', cell: (c) => mono(c.payloadHash, shortHash(c.payloadHash, 12, 6)), kind: ['wide'] },
        { label: 'Code id', cell: (c) => mono(c.id, shortHash(c.id, 8, 4)), kind: ['nowrap'] },
        { label: 'Revoked', cell: (c) => (c.revokedAt ? h('span', { attrs: { title: c.revocationReason ?? '' } }, formatDate(c.revokedAt)) : '—'), kind: ['nowrap'] },
      ],
      list.items,
      { empty: 'No code yet.', onRow: (c) => productHref(c.productId), caption: 'Codes' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
