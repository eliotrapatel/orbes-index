/**
 * Verification events: every scan with its public result and, for admins
 * only, the internal facts behind it (signature, genome check, reasons,
 * risk score). These never leave the console.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, humanize, shortHash } from '../format.js';
import { toneOf } from '../model/tone.js';
import { productHref } from '../router.js';
import { VERIFICATION_STATES } from '../types.js';
import { button, field, filterBar, input, mono, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

export async function scansView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const list = await ctx.api.scans({ productId: q.productId, state: q.state, page: pageParam(ctx), pageSize: 50 });

  const product = input('productId', { value: q.productId ?? '', placeholder: 'O26-J-00184', maxlength: 64 });
  const state = select('state', [{ value: '', label: 'All results' }, ...VERIFICATION_STATES.map((s) => ({ value: s, label: humanize(s) }))], q.state ?? '');
  const form = h('form', { class: 'filters__form', attrs: { role: 'search' } }, filterBar(field('Product', product), field('Result', state), button('Apply', { type: 'submit' })));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ productId: product.value.trim().toUpperCase(), state: state.value, page: undefined });
  });
  state.addEventListener('change', () => form.requestSubmit());

  return h(
    'div',
    { class: 'view view--scans' },
    pageHeader({ eyebrow: 'Activity', title: 'Verification events', lead: 'Public results with their internal evidence. Risk scores and reasons are visible to the console only.' }),
    form,
    table(
      [
        { label: 'When', cell: (r) => formatDateTime(r.occurredAt, { seconds: true }), kind: ['nowrap'] },
        { label: 'Product', cell: (r) => (r.productId ? h('a', { class: 'idlink', attrs: { href: productHref(r.productId) } }, r.productId) : h('span', { class: 'soft' }, '—')), kind: ['nowrap'] },
        { label: 'Event', cell: (r) => humanize(r.eventType), kind: ['nowrap'] },
        { label: 'Result', cell: (r) => statusMark(humanize(r.state), toneOf('verification', r.state)), kind: ['nowrap'] },
        {
          label: 'Signature',
          cell: (r) => (r.authentication ? (r.authentication.signatureValid ? 'VALID' : statusMark('INVALID', 'critical')) : '—'),
          kind: ['nowrap'],
        },
        { label: 'Genome', cell: (r) => humanize(r.authentication?.genomeCheck), kind: ['nowrap'] },
        { label: 'Risk', cell: (r) => (r.authentication ? String(r.authentication.riskScore) : '—'), kind: ['num'] },
        { label: 'Reasons', cell: (r) => h('span', { class: 'cell-details' }, (r.authentication?.reasons ?? []).map(humanize).join(' · ')), kind: ['wide'] },
        { label: 'Where', cell: (r) => [r.country, r.region].filter(Boolean).join(' · ') || '—', kind: ['nowrap'] },
        { label: 'Device', cell: (r) => mono(r.deviceHash, shortHash(r.deviceHash, 6, 2)), kind: ['nowrap'] },
        { label: 'ms', cell: (r) => (r.latencyMs === null ? '—' : String(r.latencyMs)), kind: ['num'] },
      ],
      list.items,
      { empty: q.productId || q.state ? 'No event matches these filters.' : 'No verification yet.', caption: 'Verification events' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
