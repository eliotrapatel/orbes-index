/**
 * Audit log: the hash-chained record of every change, newest first, with a
 * full re-computation of the chain on demand (each entry's hash covers the
 * previous hash, so any edit, deletion or reordering breaks the chain).
 */
import { h, mount } from '../../shared/dom.js';
import { formatDateTime, humanize, shortHash, summarizeDetails } from '../format.js';
import { chainVerdict } from '../model/registry.js';
import { busy, button, field, filterBar, input, mono, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function auditView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const list = await ctx.api.audit({ action: q.action, actorType: q.actorType, targetType: q.targetType, targetId: q.targetId, page: pageParam(ctx), pageSize: 50 });

  const verdict = h('div', { class: 'chain', attrs: { 'aria-live': 'polite' }, data: { testid: 'chain-result' } });
  const verify = button('Verify chain', { kind: 'primary', testId: 'audit-verify' });
  verify.addEventListener('click', () =>
    void busy(verify, async () => {
      try {
        const r = await ctx.api.verifyAudit();
        const v = chainVerdict(r);
        mount(verdict, statusMark(v.title.toUpperCase(), v.tone), h('span', { class: 'chain__detail' }, v.detail));
        verdict.dataset.ok = String(r.ok);
      } catch (e) {
        notifyError(e, 'The chain could not be verified.');
      }
    }, 'Verifying…'),
  );

  const action = input('action', { value: q.action ?? '', placeholder: 'e.g. key.rotate', maxlength: 200, mono: true });
  const actorType = select('actorType', [{ value: '', label: 'All actors' }, { value: 'admin', label: 'Admin' }, { value: 'account', label: 'Client' }, { value: 'system', label: 'System' }], q.actorType ?? '');
  const target = input('targetId', { value: q.targetId ?? '', placeholder: 'Target id', maxlength: 200, mono: true });
  const form = h('form', { class: 'filters__form', attrs: { role: 'search' } }, filterBar(field('Action', action), field('Actor', actorType), field('Target', target), button('Apply', { type: 'submit' })));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ action: action.value.trim(), actorType: actorType.value, targetId: target.value.trim(), page: undefined });
  });

  return h(
    'div',
    { class: 'view view--audit' },
    pageHeader({
      eyebrow: 'Security',
      title: 'Audit log',
      lead: 'Append-only, hash-chained: hash = SHA-256(previous hash ‖ canonical entry).',
      actions: [verify],
    }),
    verdict,
    form,
    table(
      [
        { label: '#', cell: (e) => String(e.id), kind: ['num'] },
        { label: 'When', cell: (e) => formatDateTime(e.occurredAt, { seconds: true }), kind: ['nowrap'] },
        { label: 'Actor', cell: (e) => h('span', null, e.actorType.toUpperCase(), e.actorId ? h('span', { class: 'cell-sub mono' }, shortHash(e.actorId, 14, 4)) : null), kind: ['nowrap'] },
        { label: 'Action', cell: (e) => mono(e.action), kind: ['nowrap'] },
        { label: 'Target', cell: (e) => (e.targetType ? h('span', null, humanize(e.targetType), e.targetId ? h('span', { class: 'cell-sub mono' }, shortHash(e.targetId, 14, 4)) : null) : '—'), kind: ['nowrap'] },
        { label: 'Details', cell: (e) => h('span', { class: 'cell-details' }, summarizeDetails(e.details, 160)), kind: ['wide'] },
        { label: 'Hash', cell: (e) => mono(e.hash, shortHash(e.hash, 10, 4)), kind: ['nowrap'] },
      ],
      list.items,
      { empty: 'No entry matches these filters.', caption: 'Audit log' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
