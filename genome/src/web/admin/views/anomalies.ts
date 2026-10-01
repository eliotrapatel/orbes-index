/**
 * Anomalies with their triage workflow: OPEN → ACKNOWLEDGED → RESOLVED or
 * DISMISSED, reopen when needed. Closing a finding requires a note so the
 * audit trail explains every decision.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, humanize, summarizeDetails } from '../format.js';
import { can } from '../model/permissions.js';
import { triageMoves } from '../model/registry.js';
import { toneOf } from '../model/tone.js';
import { productHref } from '../router.js';
import { ANOMALY_SEVERITIES, ANOMALY_STATUSES, type AnomalyRecord } from '../types.js';
import { button, field, filterBar, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function anomaliesView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const list = await ctx.api.anomalies({ status: q.status, severity: q.severity, page: pageParam(ctx), pageSize: 50 });
  const canTriage = can(ctx.session.admin.role, 'triageAnomaly');

  const status = select('status', [{ value: '', label: 'All' }, ...ANOMALY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], q.status ?? '');
  const severity = select('severity', [{ value: '', label: 'All' }, ...[...ANOMALY_SEVERITIES].reverse().map((s) => ({ value: s, label: s }))], q.severity ?? '');
  status.addEventListener('change', () => ctx.setQuery({ status: status.value, page: undefined }));
  severity.addEventListener('change', () => ctx.setQuery({ severity: severity.value, page: undefined }));

  const triage = (a: AnomalyRecord) =>
    h(
      'span',
      { class: 'row-actions' },
      ...triageMoves(a.status).map((m) =>
        button(m.label, {
          kind: 'ghost',
          testId: `triage-${m.to.toLowerCase()}`,
          onClick: () =>
            void openDialog({
              title: `${m.label} · ${humanize(a.type)}`,
              eyebrow: a.productId ?? 'Unregistered identity',
              body: h('p', { class: 'dialog__text' }, summarizeDetails(a.details, 400) || 'No details recorded.'),
              fields: [{ name: 'note', label: m.noteRequired ? 'Resolution note' : 'Note', kind: 'textarea', required: m.noteRequired, maxlength: 2000 }],
              confirmLabel: m.label,
              submit: async (v) => {
                await ctx.api.updateAnomaly(a.id, m.to, v.note?.trim() || undefined);
              },
            }).then((r) => {
              if (!r) return;
              notify(`Finding ${humanize(m.to)}.`);
              ctx.reload();
            }),
        }),
      ),
    );

  return h(
    'div',
    { class: 'view view--anomalies' },
    pageHeader({ eyebrow: 'Activity', title: 'Anomalies', lead: 'Findings from scan patterns and registry checks. Detection only: nothing is revoked automatically.' }),
    filterBar(field('Status', status), field('Severity', severity)),
    table(
      [
        { label: 'Severity', cell: (a) => statusMark(a.severity, toneOf('severity', a.severity)), kind: ['nowrap'] },
        { label: 'Finding', cell: (a) => humanize(a.type), kind: ['nowrap'] },
        { label: 'Product', cell: (a) => (a.productId ? h('a', { class: 'idlink', attrs: { href: productHref(a.productId) } }, a.productId) : h('span', { class: 'soft' }, 'Unregistered')), kind: ['nowrap'] },
        { label: 'Status', cell: (a) => statusMark(humanize(a.status), toneOf('anomaly', a.status)), kind: ['nowrap'] },
        { label: 'Risk', cell: (a) => String(a.riskScore), kind: ['num'] },
        { label: 'Seen', cell: (a) => String(a.occurrences), kind: ['num'] },
        { label: 'Last seen', cell: (a) => formatDateTime(a.lastSeenAt), kind: ['nowrap'] },
        {
          label: 'Details',
          cell: (a) =>
            h(
              'span',
              { class: 'cell-details' },
              summarizeDetails(a.details),
              a.resolutionNote ? h('span', { class: 'cell-sub' }, `${a.resolvedBy ? `${a.resolvedBy}: ` : ''}${a.resolutionNote}`) : null,
            ),
          kind: ['wide'],
        },
        ...(canTriage ? [{ label: 'Triage', cell: triage, kind: ['actions' as const] }] : []),
      ],
      list.items,
      { empty: q.status || q.severity ? 'No finding matches these filters.' : 'No anomaly recorded.', caption: 'Anomalies' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
