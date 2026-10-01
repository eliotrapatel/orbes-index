/**
 * Revocations register (codes, products, keys) and the ADMIN entry point
 * that revokes any of them with a typed confirmation.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, humanize, shortHash } from '../format.js';
import { can } from '../model/permissions.js';
import { revocationTargetError } from '../model/registry.js';
import { productHref } from '../router.js';
import { REVOCATION_TARGET_TYPES, type RevocationRecord, type RevocationTargetType } from '../types.js';
import { button, mono, pageHeader, pager, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

function targetCell(r: RevocationRecord): HTMLElement {
  if (r.targetType === 'PRODUCT' && /^O\d{2}-/.test(r.targetId)) return h('a', { class: 'idlink', attrs: { href: productHref(r.targetId) } }, r.targetId);
  if (r.targetType === 'KEY') return mono(`#${r.targetId}`);
  return mono(r.targetId, shortHash(r.targetId, 8, 4));
}

export async function revocationsView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.revocations(pageParam(ctx), 50);
  const canRevoke = can(ctx.session.admin.role, 'createRevocation');

  const create = () =>
    void (async () => {
      const first = await openDialog({
        title: 'New revocation',
        eyebrow: 'Revocations',
        body: h('p', { class: 'dialog__text' }, 'CODE: one code (UUID) answers REVOKED. PRODUCT: the product (id) answers REVOKED. KEY: the signing key (1–255) is distrusted from now on.'),
        fields: [
          { name: 'targetType', label: 'Target', kind: 'select', options: REVOCATION_TARGET_TYPES.map((t) => ({ value: t, label: t })), required: true },
          { name: 'targetId', label: 'Identifier', required: true, maxlength: 64 },
          { name: 'reason', label: 'Reason', kind: 'textarea', required: true, maxlength: 500 },
        ],
        validate: (v) => revocationTargetError(v.targetType as RevocationTargetType, v.targetId),
        confirmLabel: 'Continue',
        danger: true,
      });
      if (!first) return;
      const type = first.targetType as RevocationTargetType;
      const id = first.targetId.trim().toUpperCase();
      const phrase = `REVOKE ${type} ${type === 'CODE' ? id.slice(0, 8) : id}`;
      const ok = await openDialog({
        title: `Revoke ${type.toLowerCase()} ${type === 'CODE' ? shortHash(id.toLowerCase(), 8, 4) : id}`,
        eyebrow: 'Confirm revocation',
        danger: true,
        body: h('p', { class: 'dialog__text' }, `Reason: ${first.reason.trim()}`),
        phrase,
        confirmLabel: 'Revoke',
        submit: async () => {
          await ctx.api.createRevocation(type, type === 'CODE' ? id.toLowerCase() : id, first.reason.trim());
        },
      });
      if (ok) {
        notify(`${humanize(type)} revoked.`);
        ctx.reload();
      }
    })();

  return h(
    'div',
    { class: 'view view--revocations' },
    pageHeader({
      eyebrow: 'Security',
      title: 'Revocations',
      lead: 'Codes, products and keys withdrawn from trust. Signed data cannot be recalled; the registry answers for it.',
      actions: canRevoke ? [button('New revocation', { kind: 'danger', onClick: create, testId: 'revocation-new' })] : [],
    }),
    table(
      [
        { label: 'When', cell: (r) => formatDateTime(r.createdAt), kind: ['nowrap'] },
        { label: 'Type', cell: (r) => statusMark(r.targetType, 'alert'), kind: ['nowrap'] },
        { label: 'Target', cell: targetCell, kind: ['nowrap'] },
        { label: 'Reason code', cell: (r) => humanize(r.reasonCode), kind: ['nowrap'] },
        { label: 'Reason', cell: (r) => r.reason ?? '—', kind: ['wide'] },
        { label: 'By', cell: (r) => mono(r.createdBy, shortHash(r.createdBy, 14, 4)), kind: ['nowrap'] },
        { label: 'Lifted', cell: (r) => (r.liftedAt ? formatDateTime(r.liftedAt) : '—'), kind: ['nowrap'] },
      ],
      list.items,
      { empty: 'Nothing has been revoked.', caption: 'Revocations' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
