/**
 * Verification events: every scan with its public result and, for admins
 * only, the internal facts behind it (signature, genome check, reasons,
 * risk score). These never leave the console.
 *
 * Filters, kept in the URL: product and result, and the window `from`–`to`
 * an anomaly's detail links to (its scans, or the one scan `scan` that
 * raised it, marked in the list).
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, formatWindowBound, humanize, shortHash } from '../format.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import type { ScanRecord } from '../types.js';
import { VERIFICATION_STATES } from '../types.js';
import { button, field, filterBar, input, linkButton, mono, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

export async function scansView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const list = await ctx.api.scans({ productId: q.productId, state: q.state, from: q.from, to: q.to, page: pageParam(ctx), pageSize: 50 });
  const windowed = !!(q.from || q.to);

  const product = input('productId', { value: q.productId ?? '', placeholder: 'O26-J-00184', maxlength: 64 });
  const state = select('state', [{ value: '', label: 'All results' }, ...VERIFICATION_STATES.map((s) => ({ value: s, label: humanize(s) }))], q.state ?? '');
  const form = h('form', { class: 'filters__form', attrs: { role: 'search' } }, filterBar(field('Product', product), field('Result', state), button('Apply', { type: 'submit' })));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ productId: product.value.trim().toUpperCase(), state: state.value, page: undefined });
  });
  state.addEventListener('change', () => form.requestSubmit());

  // The window an anomaly links to, said in words, with the way back to every scan.
  const windowNote = windowed
    ? h(
        'p',
        { class: 'filters__window', data: { testid: 'scans-window' } },
        `Window ${formatWindowBound(q.from, 'from')} → ${formatWindowBound(q.to, 'to')}`,
        ' ',
        linkButton('Clear', href('scans', {}, { ...q, from: undefined, to: undefined, scan: undefined, page: undefined }), 'ghost'),
      )
    : null;

  return h(
    'div',
    { class: 'view view--scans' },
    pageHeader({ eyebrow: 'Activity', title: 'Verification events', lead: 'Public results with their internal evidence. Risk scores and reasons are visible to the console only.' }),
    form,
    windowNote,
    table(
      [
        {
          label: 'When',
          cell: (r) => h('span', null, formatDateTime(r.occurredAt, { seconds: true }), r.latencyMs === null ? null : h('span', { class: 'cell-sub' }, `${r.latencyMs} ms`)),
          kind: ['nowrap'],
        },
        { label: 'Product', cell: (r) => (r.productId ? h('a', { class: 'idlink', attrs: { href: productHref(r.productId) } }, r.productId) : h('span', { class: 'soft' }, '—')), kind: ['nowrap'] },
        { label: 'Event', cell: (r) => humanize(r.eventType), kind: ['nowrap'] },
        {
          label: 'Result',
          cell: (r) =>
            h(
              'span',
              null,
              statusMark(humanize(r.state), toneOf('verification', r.state)),
              r.authentication?.reasons?.length ? h('span', { class: 'cell-details' }, r.authentication.reasons.map(humanize).join(' · ')) : null,
            ),
          kind: ['wide'],
        },
        {
          label: 'Signature',
          cell: (r) => (r.authentication ? (r.authentication.signatureValid ? 'VALID' : statusMark('INVALID', 'critical')) : '—'),
          kind: ['nowrap'],
        },
        { label: 'Genome', cell: (r) => humanize(r.authentication?.genomeCheck), kind: ['nowrap'] },
        { label: 'Risk', cell: (r) => (r.authentication ? String(r.authentication.riskScore) : '—'), kind: ['num'] },
        { label: 'Where', cell: (r) => [r.country, r.region].filter(Boolean).join(' · ') || '—', kind: ['nowrap'] },
        { label: 'Device', cell: (r) => mono(r.deviceHash, shortHash(r.deviceHash, 6, 2)), kind: ['nowrap'] },
      ],
      list.items,
      {
        empty: q.productId || q.state || windowed ? 'No event matches these filters.' : 'No verification yet.',
        caption: 'Verification events',
        current: (r: ScanRecord) => r.id === q.scan,
      },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
