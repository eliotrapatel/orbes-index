/**
 * Anomalies with their triage workflow: OPEN → ACKNOWLEDGED → RESOLVED or
 * DISMISSED, reopen when needed. Closing a finding requires a note so the
 * audit trail explains every decision. A finding shows what customers said
 * about the scans that took part in it (where they saw or bought the
 * piece), and leads to those cases.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, humanize, summarizeDetails } from '../format.js';
import { can } from '../model/permissions.js';
import { reportWhere, triageMoves } from '../model/registry.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { ANOMALY_SEVERITIES, ANOMALY_STATUSES, type AnomalyRecord } from '../types.js';
import { button, field, filterBar, narrowedTo, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function anomaliesView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const list = await ctx.api.anomalies({ id: q.id, status: q.status, severity: q.severity, page: pageParam(ctx), pageSize: 50 });
  const canTriage = can(ctx.session.admin.role, 'triageAnomaly');

  const status = select('status', [{ value: '', label: 'All' }, ...ANOMALY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], q.status ?? '');
  const severity = select('severity', [{ value: '', label: 'All' }, ...[...ANOMALY_SEVERITIES].reverse().map((s) => ({ value: s, label: s }))], q.severity ?? '');
  status.addEventListener('change', () => ctx.setQuery({ status: status.value, id: undefined, page: undefined }));
  severity.addEventListener('change', () => ctx.setQuery({ severity: severity.value, id: undefined, page: undefined }));

  // The customers' answers on the scans that took part in the finding: how many, how many still open, the latest.
  const reports = (a: AnomalyRecord) =>
    a.reports
      ? h(
          'span',
          { class: 'cell-report' },
          h('a', { class: 'idlink', attrs: { href: href('cases', {}, { anomalyId: a.id }), 'data-testid': 'anomaly-reports' } }, `${a.reports.count} ${a.reports.count === 1 ? 'case' : 'cases'}`),
          h('span', { class: 'cell-sub' }, `${a.reports.open} open`),
          h('span', { class: 'cell-details' }, reportWhere(a.reports.latest)),
        )
      : h('span', { class: 'soft' }, '—');

  const triage = (a: AnomalyRecord) => {
    const moves = triageMoves(a.status);
    if (moves.length === 0) return null;
    return button('Triage', {
      kind: 'ghost',
      testId: 'triage',
      onClick: () =>
        void openDialog({
          title: humanize(a.type),
          eyebrow: `${a.severity} · ${a.productId ?? 'Unregistered identity'} · ${humanize(a.status)}`,
          body: h('p', { class: 'dialog__text' }, summarizeDetails(a.details, 400) || 'No details recorded.'),
          fields: [
            { name: 'status', label: 'Decision', kind: 'select', required: true, options: moves.map((m) => ({ value: m.to, label: `${m.label} → ${humanize(m.to)}` })) },
            { name: 'note', label: 'Note', kind: 'textarea', maxlength: 2000, hint: 'Required to resolve, dismiss or reopen a closed finding.' },
          ],
          validate: (v) => (moves.find((m) => m.to === v.status)?.noteRequired && !v.note?.trim() ? 'Explain the decision in the note.' : null),
          confirmLabel: 'Record decision',
          submit: async (v) => {
            await ctx.api.updateAnomaly(a.id, v.status as AnomalyRecord['status'], v.note?.trim() || undefined);
          },
        }).then((r) => {
          if (!r) return;
          notify(`Finding ${humanize(r.status)}.`);
          ctx.reload();
        }),
    });
  };

  return h(
    'div',
    { class: 'view view--anomalies' },
    pageHeader({ eyebrow: 'Activity', title: 'Anomalies', lead: 'Findings from scan patterns and registry checks. Detection only: nothing is revoked automatically.' }),
    filterBar(field('Status', status), field('Severity', severity), q.id ? narrowedTo('One finding', href('anomalies')) : null),
    table(
      [
        { label: 'Severity', cell: (a) => statusMark(a.severity, toneOf('severity', a.severity)), kind: ['nowrap'] },
        {
          label: 'Finding',
          cell: (a) =>
            h(
              'span',
              null,
              humanize(a.type),
              h('span', { class: 'cell-details' }, summarizeDetails(a.details, 220)),
              a.resolutionNote ? h('span', { class: 'cell-sub' }, `${a.resolvedBy ? `${a.resolvedBy}: ` : ''}${a.resolutionNote}`) : null,
            ),
          kind: ['wide'],
        },
        { label: 'Product', cell: (a) => (a.productId ? h('a', { class: 'idlink', attrs: { href: productHref(a.productId) } }, a.productId) : h('span', { class: 'soft' }, 'Unregistered')), kind: ['nowrap'] },
        { label: 'Status', cell: (a) => statusMark(humanize(a.status), toneOf('anomaly', a.status)), kind: ['nowrap'] },
        { label: 'Risk', cell: (a) => String(a.riskScore), kind: ['num'] },
        { label: 'Seen', cell: (a) => String(a.occurrences), kind: ['num'] },
        { label: 'Last seen', cell: (a) => formatDateTime(a.lastSeenAt), kind: ['nowrap'] },
        { label: 'Reports', cell: reports },
        ...(canTriage ? [{ label: '', cell: triage, kind: ['actions' as const] }] : []),
      ],
      list.items,
      { empty: q.status || q.severity || q.id ? 'No finding matches these filters.' : 'No anomaly recorded.', caption: 'Anomalies' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
