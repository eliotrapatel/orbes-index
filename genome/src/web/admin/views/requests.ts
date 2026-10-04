/**
 * The requests of THE PRIVATE SALON (P-X08) in the console: the Club page's
 * Requests tab (`#/club?tab=requests`).
 *
 * Every request an owner made from a reserved model's sheet on /verify
 * (REQUEST THIS PIECE), open ones first, then the newest; `?status=` narrows
 * to OPEN or CLOSED. Each row: when it was made, the client (its sheet; the
 * email masked for an AUDITOR, j***@example.com), the model (its type and the
 * price the salon shows), the client's note, and its status (who closed it,
 * when, and what was done). Close (OPERATOR) opens the dialog of the note,
 * required, then the tab is read again; the server audits it
 * (`shop.request.close`, never the note). ORBES Client Services concludes the
 * sale with the client: nothing is paid on /verify, and no email is sent.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime, humanize } from '../format.js';
import { canCloseRequest, closeRequestProblem, requestModelLine, SHOP_REQUEST_LIMITS, shopRequestStatusOf } from '../model/club.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import { SHOP_REQUEST_STATUSES, type ShopRequest } from '../types.js';
import { button, field, filterBar, pager, section, select, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

/** The Requests tab: the requests of the private salon, OPEN first. */
export async function requestsTab(ctx: ViewContext): Promise<HTMLElement> {
  const status = shopRequestStatusOf(ctx.route.query);
  const list = await ctx.api.shopRequests({ ...(status ? { status } : {}), page: pageParam(ctx), pageSize: 50 });
  const role = ctx.session.admin.role;

  const filter = select('status', [{ value: '', label: 'All' }, ...SHOP_REQUEST_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], status ?? '');
  filter.addEventListener('change', () => ctx.setQuery({ tab: 'requests', status: filter.value, page: undefined }));

  const close = (r: ShopRequest) =>
    canCloseRequest(role, r)
      ? button('Close', {
          kind: 'ghost',
          testId: 'close-request',
          onClick: () =>
            void openDialog({
              title: 'Close request',
              eyebrow: `${humanize(r.model.name)} · ${r.account.email}`,
              body: r.note ? h('p', { class: 'dialog__text' }, r.note) : undefined,
              fields: [
                {
                  name: 'note',
                  label: 'Note',
                  kind: 'textarea',
                  maxlength: SHOP_REQUEST_LIMITS.resolution,
                  required: true,
                  hint: 'What was done for the client: the sale concluded, a fitting arranged, or why nothing was. Kept with the request.',
                },
              ],
              validate: (v) => closeRequestProblem(v.note),
              confirmLabel: 'Close request',
              submit: async (v) => {
                await ctx.api.closeShopRequest(r.id, v.note.trim());
              },
            }).then((done) => {
              if (!done) return;
              notify('Request closed.');
              ctx.reload();
            }),
        })
      : null;

  return section(
    'Requests',
    [
      filterBar(field('Status', filter)),
      table<ShopRequest>(
        [
          { label: 'Requested', cell: (r) => formatDateTime(r.createdAt), kind: ['nowrap'] },
          {
            label: 'Client',
            cell: (r) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: r.account.id }), 'data-testid': 'request-client' } }, r.account.email),
            kind: ['nowrap'],
          },
          {
            label: 'Model',
            cell: (r) =>
              h(
                'span',
                null,
                h('span', { attrs: { 'data-testid': 'request-model' } }, humanize(r.model.name)),
                h('span', { class: 'cell-sub' }, requestModelLine(r)),
                r.note ? h('span', { class: 'cell-details', attrs: { 'data-testid': 'request-note' } }, r.note) : null,
              ),
            kind: ['wide'],
          },
          {
            label: 'Status',
            cell: (r) =>
              h(
                'span',
                null,
                statusMark(humanize(r.status), toneOf('shopRequest', r.status)),
                r.handledAt ? h('span', { class: 'cell-sub' }, [r.handledBy?.email, formatDateTime(r.handledAt)].filter(Boolean).join(' · ')) : null,
                r.resolutionNote ? h('span', { class: 'cell-details' }, r.resolutionNote) : null,
              ),
          },
          { label: '', cell: close, kind: ['actions'] },
        ],
        list.items,
        {
          empty: status
            ? 'No request matches this status.'
            : 'No request yet. An owner requests a model of the private salon from its sheet on /verify (REQUEST THIS PIECE); ORBES Client Services then contacts the client.',
          caption: 'Requests',
        },
      ),
      pager(list, (p) => ctx.setQuery({ tab: 'requests', page: p })),
    ],
    { id: 'requests' },
  );
}
