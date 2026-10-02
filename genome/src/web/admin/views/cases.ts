/**
 * Cases (Activity): what customers said about results that were not
 * authentic, where they saw or bought the piece, one case per scan. Each
 * case leads to its scan (Verification events), the anomaly the scan took
 * part in (Anomalies) and its piece (the product page). Open cases come
 * first; an OPERATOR closes one with a note, recorded in the audit log.
 *
 * The place and note are the customer's own words (personal data, purged
 * with the scan): shown here, never copied into the audit log.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, humanize } from '../format.js';
import { can } from '../model/permissions.js';
import { reportWhere, scanReference } from '../model/registry.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { REPORT_STATUSES, type CaseRecord } from '../types.js';
import { button, field, filterBar, narrowedTo, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function casesView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const list = await ctx.api.cases({ status: q.status, scanId: q.scanId, anomalyId: q.anomalyId, page: pageParam(ctx), pageSize: 50 });
  const canClose = can(ctx.session.admin.role, 'closeCase');

  const status = select('status', [{ value: '', label: 'All' }, ...REPORT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], q.status ?? '');
  status.addEventListener('change', () => ctx.setQuery({ status: status.value, page: undefined }));
  const narrowed = q.scanId ? narrowedTo('The case of one scan', href('cases')) : q.anomalyId ? narrowedTo('The cases of one finding', href('cases')) : null;

  const close = (c: CaseRecord) =>
    c.status === 'OPEN' && canClose
      ? button('Close', {
          kind: 'ghost',
          testId: 'close-case',
          onClick: () =>
            void openDialog({
              title: 'Close case',
              eyebrow: `REF ${scanReference(c.scanId)} · ${reportWhere(c)}`,
              body: c.note ? h('p', { class: 'dialog__text' }, c.note) : undefined,
              fields: [{ name: 'note', label: 'Note', kind: 'textarea', maxlength: 2000, required: true, hint: 'What was done for the customer, or why nothing was. Kept with the case.' }],
              confirmLabel: 'Close case',
              submit: async (v) => {
                await ctx.api.closeCase(c.id, v.note.trim());
              },
            }).then((r) => {
              if (!r) return;
              notify('Case closed.');
              ctx.reload();
            }),
        })
      : null;

  return h(
    'div',
    { class: 'view view--cases' },
    pageHeader({
      eyebrow: 'Activity',
      title: 'Cases',
      lead: 'Where customers saw or bought a piece whose result was not authentic, one case per scan, open cases first. Each leads to its scan, the anomaly the scan took part in, and the piece.',
    }),
    filterBar(field('Status', status), narrowed),
    table(
      [
        { label: 'Reported', cell: (c) => formatDateTime(c.createdAt), kind: ['nowrap'] },
        {
          label: 'Where',
          cell: (c) =>
            h(
              'span',
              null,
              h('span', { attrs: { 'data-testid': 'case-where' } }, reportWhere(c)),
              c.note ? h('span', { class: 'cell-details' }, c.note) : null,
            ),
          kind: ['wide'],
        },
        {
          label: 'Scan',
          cell: (c) =>
            h(
              'span',
              null,
              h('a', { class: 'idlink', attrs: { href: href('scans', {}, { scanId: c.scanId }), title: c.scanId, 'data-testid': 'case-scan' } }, scanReference(c.scanId)),
              h('span', { class: 'cell-sub' }, statusMark(humanize(c.scan.state), toneOf('verification', c.scan.state))),
            ),
          kind: ['nowrap'],
        },
        {
          label: 'Anomaly',
          cell: (c) =>
            c.anomaly
              ? h(
                  'span',
                  null,
                  h('a', { class: 'idlink', attrs: { href: href('anomalies', {}, { finding: c.anomaly.id }), 'data-testid': 'case-anomaly' } }, humanize(c.anomaly.type)),
                  h('span', { class: 'cell-sub' }, `${c.anomaly.severity} · ${humanize(c.anomaly.status)}`),
                )
              : h('span', { class: 'soft' }, '—'),
          kind: ['nowrap'],
        },
        {
          label: 'Piece',
          cell: (c) =>
            c.scan.productId
              ? h('a', { class: 'idlink', attrs: { href: productHref(c.scan.productId), 'data-testid': 'case-piece' } }, c.scan.productId)
              : h('span', { class: 'soft' }, 'Unregistered'),
          kind: ['nowrap'],
        },
        {
          label: 'Status',
          cell: (c) =>
            h(
              'span',
              null,
              statusMark(humanize(c.status), toneOf('case', c.status)),
              c.handledBy ? h('span', { class: 'cell-sub' }, `${c.handledBy.email} · ${formatDateTime(c.handledAt)}`) : null,
              c.resolutionNote ? h('span', { class: 'cell-details' }, c.resolutionNote) : null,
            ),
        },
        ...(canClose ? [{ label: '', cell: close, kind: ['actions' as const] }] : []),
      ],
      list.items,
      {
        empty: q.status || q.scanId || q.anomalyId ? 'No case matches these filters.' : 'No case yet. A case opens when a customer answers WHERE DID YOU SEE OR BUY THIS PIECE? on a result that was not authentic.',
        caption: 'Cases',
      },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
