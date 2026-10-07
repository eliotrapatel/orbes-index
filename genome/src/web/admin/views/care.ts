/**
 * Clients → Yearly care (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6; `#/care` and `#/care/:careId`): the yearly care
 * the PLATINE and PALLADIUM tiers include, asked for by clients from a piece.
 *
 * The board: tabs by step (Requested · Label sent · At the atelier · On its way back · Done · Cancelled), oldest first;
 * each row when it was asked for, the piece's serial and model, the client (the email masked for an AUDITOR), the tier
 * at the request and the year. A request's page: its facts, the name and address the piece returns to as the client gave
 * them (masked for an AUDITOR), the client's MESSAGES conversation as a link (or « No conversation yet. »), and the
 * steps (OPERATOR): SEND LABEL (the PDF, its carrier and tracking number; the label then shows in the piece's SERVICE
 * tab), RECEIVED AT THE ATELIER, SHIP BACK, COMPLETE (the notes of the service record), CANCEL (a note). Each change is
 * audited, and the page is read again. Nothing is written in the client's messages.
 */
import { h } from '../../shared/dom.js';
import { formatDate, formatDateTime } from '../format.js';
import {
  CARE_ACTION_LABELS,
  CARE_EMPTY,
  CARE_LEAD,
  CARE_STATUS_LABELS,
  CARE_TABS,
  careActions,
  careTab,
  labelFileProblem,
  NO_CONVERSATION,
  shipmentText,
  type CareAction,
} from '../model/care.js';
import { STATUS_LABELS } from '../model/messages.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import type { CareRow, CareSheet, Carrier } from '../types.js';
import { button, defList, field, input, pageHeader, pager, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

/** The tabs of the board: links, the current one marked (as the Club's). */
function careTabs(current: string): HTMLElement {
  return h(
    'nav',
    { class: 'range care__tabs', attrs: { 'aria-label': 'Yearly care' } },
    ...CARE_TABS.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: href('care', {}, { status: t.value }), 'aria-current': t.value === current ? 'page' : null, 'data-testid': `care-tab-${t.value}` } }, t.label),
    ]),
  );
}

export async function careView(ctx: ViewContext): Promise<HTMLElement> {
  const status = careTab(ctx.route.query);
  const list = await ctx.api.careRequests({ status, page: pageParam(ctx), pageSize: 50 });
  return h(
    'div',
    { class: 'view view--care' },
    pageHeader({ eyebrow: 'Clients', title: 'Yearly care', lead: CARE_LEAD }),
    careTabs(status),
    section(
      CARE_STATUS_LABELS[status],
      [
        table<CareRow>(
          [
            { label: 'Requested', cell: (r) => h('span', { attrs: { title: formatDateTime(r.requestedAt) } }, formatDate(r.requestedAt)), kind: ['nowrap'] },
            {
              label: 'Piece',
              cell: (r) => h('span', null, h('a', { class: 'idlink', attrs: { href: productHref(r.piece.productId), 'data-testid': 'care-piece' } }, r.piece.productId), h('span', { class: 'cell-sub' }, r.piece.model)),
              kind: ['nowrap'],
            },
            { label: 'Client', cell: (r) => h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: r.account.id }), 'data-testid': 'care-client' } }, r.account.email), kind: ['nowrap'] },
            { label: 'Tier', cell: (r) => r.tier, kind: ['nowrap'] },
            { label: 'Year', cell: (r) => String(r.year), kind: ['nowrap'] },
            { label: 'Status', cell: (r) => statusMark(CARE_STATUS_LABELS[r.status], toneOf('care', r.status)), kind: ['nowrap'] },
          ],
          list.items,
          { empty: CARE_EMPTY, onRow: (r) => href('careRequest', { careId: r.id }), caption: 'Yearly care' },
        ),
        pager(list, (p) => ctx.setQuery({ page: p })),
      ],
      { id: 'care' },
    ),
  );
}

/** The name and the address the piece returns to, as the client gave them (masked for an AUDITOR). */
function returnAddress(s: CareSheet): HTMLElement {
  return h('span', { class: 'care__address', attrs: { 'data-testid': 'care-return-address' } }, h('span', { class: 'care__address-name' }, s.returnName), h('span', { class: 'cell-sub care__address-lines' }, s.returnAddress));
}

function shipment(s: CareSheet['label'] | CareSheet['return'], testid: string): HTMLElement | string {
  if (!s) return '—';
  return h('a', { class: 'idlink', attrs: { href: s.trackingUrl, target: '_blank', rel: 'noopener noreferrer', 'data-testid': testid } }, shipmentText(s));
}

function carrierOptions(carriers: Carrier[]): { value: string; label: string }[] {
  return [{ value: '', label: 'Choose a carrier' }, ...carriers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))];
}

export async function careRequestView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.careId ?? '';
  const [s, carriers] = await Promise.all([ctx.api.careRequest(id), ctx.api.carriers().then((r) => r.items)]);
  const done = (msg: string) => (ok: unknown) => {
    if (!ok) return;
    notify(msg);
    ctx.reload();
  };
  const tracking = { name: 'tracking', label: 'Tracking number', required: true, maxlength: 40 } as const;
  const carrier = { name: 'carrierId', label: 'Carrier', kind: 'select' as const, required: true, options: carrierOptions(carriers) };

  const open: Record<CareAction, () => void> = {
    label: () => {
      const file = input('label', { type: 'file' });
      file.accept = 'application/pdf,.pdf';
      file.setAttribute('data-testid', 'care-label-file');
      void openDialog({
        title: 'Send label',
        eyebrow: `${s.piece.productId} · ${s.account.email}`,
        body: [
          h('p', { class: 'dialog__text' }, 'The prepaid label shows in the piece’s SERVICE tab of the client’s app, with its carrier and tracking number. Nothing is written in their messages.'),
          field('Label', file, { wide: true, hint: 'The PDF itself, at most 2 MB.' }),
        ],
        confirmLabel: 'Send label',
        fields: [carrier, tracking],
        validate: () => labelFileProblem(file.files?.[0] ?? null),
        submit: async (v) => {
          await ctx.api.sendCareLabel(s.id, file.files![0]!, v.carrierId ?? '', (v.tracking ?? '').trim());
        },
      }).then(done('Label sent.'), notifyError);
    },
    receive: () => {
      void openDialog({
        title: 'Received at the atelier',
        eyebrow: s.piece.productId,
        body: h('p', { class: 'dialog__text' }, 'The piece is at the ORBES atelier: its YEARLY CARE service record opens, and the piece reads IN SERVICE.'),
        confirmLabel: 'Received at the atelier',
        submit: async () => {
          await ctx.api.receiveCare(s.id);
        },
      }).then(done('Received at the atelier.'), notifyError);
    },
    return: () => {
      void openDialog({
        title: 'Ship back',
        eyebrow: s.piece.productId,
        body: [h('p', { class: 'dialog__text' }, 'To the name and address the client gave:'), returnAddress(s)],
        confirmLabel: 'Ship back',
        fields: [carrier, tracking],
        submit: async (v) => {
          await ctx.api.shipCareBack(s.id, v.carrierId ?? '', (v.tracking ?? '').trim());
        },
      }).then(done('Shipped back.'), notifyError);
    },
    complete: () => {
      void openDialog({
        title: 'Complete',
        eyebrow: s.piece.productId,
        body: h('p', { class: 'dialog__text' }, 'The YEARLY CARE service record is completed, and the piece returns to its status.'),
        confirmLabel: 'Complete',
        fields: [{ name: 'notes', label: 'Notes for the service record', kind: 'textarea', maxlength: 4000, hint: 'Staff only: the client reads YEARLY CARE and its dates.' }],
        submit: async (v) => {
          await ctx.api.completeCare(s.id, v.notes ?? '');
        },
      }).then(done('Yearly care completed.'), notifyError);
    },
    cancel: () => {
      void openDialog({
        title: 'Cancel the yearly care',
        eyebrow: s.piece.productId,
        body: h('p', { class: 'dialog__text' }, s.serviceRecordId ? 'Its open service record is cancelled with it, and the piece returns to its status.' : 'The client may ask for it again this year.'),
        confirmLabel: 'Cancel the yearly care',
        cancelLabel: 'Keep it',
        danger: true,
        fields: [{ name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: 500, hint: 'Staff only.' }],
        submit: async (v) => {
          await ctx.api.cancelCare(s.id, v.note ?? '');
        },
      }).then(done('Yearly care cancelled.'), notifyError);
    },
  };
  const actions = careActions(s.status, ctx.session.admin.role).map((a) =>
    button(CARE_ACTION_LABELS[a], { kind: a === 'cancel' ? 'ghost' : 'secondary', testId: `care-${a}`, onClick: () => open[a]() }),
  );

  const facts = defList([
    { label: 'Status', value: h('span', { attrs: { 'data-testid': 'care-status' } }, statusMark(CARE_STATUS_LABELS[s.status], toneOf('care', s.status))) },
    { label: 'Piece', value: h('a', { class: 'idlink', attrs: { href: productHref(s.piece.productId) } }, s.piece.productId), note: s.piece.model },
    { label: 'Client', value: h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: s.account.id }) } }, s.account.email) },
    { label: 'Tier at the request', value: s.tier },
    { label: 'Year', value: String(s.year) },
    { label: 'Requested', value: formatDateTime(s.requestedAt) },
    { label: 'Return address', value: returnAddress(s), note: 'As the client gave it. To change it, they cancel and ask again.' },
    { label: 'Label', value: shipment(s.label, 'care-label-shipment'), note: s.label ? `Sent ${formatDateTime(s.label.at)}${s.label.pdf ? '' : ' · its PDF erased'}` : undefined },
    { label: 'At the atelier', value: s.receivedAt ? formatDateTime(s.receivedAt) : '—' },
    { label: 'Shipped back', value: shipment(s.return, 'care-return-shipment'), note: s.return ? formatDateTime(s.return.at) : undefined },
    { label: 'Done', value: s.doneAt ? formatDateTime(s.doneAt) : '—' },
    ...(s.cancelledAt ? [{ label: 'Cancelled', value: formatDateTime(s.cancelledAt), note: s.cancelledBy === 'account' ? 'By the client' : 'By ORBES' }] : []),
    ...(s.note ? [{ label: 'Note', value: s.note }] : []),
    { label: 'Handled by', value: s.handledBy?.email ?? '—' },
    {
      label: 'Messages',
      value: s.conversation
        ? h('a', { class: 'idlink', attrs: { href: href('conversation', { conversationId: s.conversation.conversationId }), 'data-testid': 'care-conversation' } }, STATUS_LABELS[s.conversation.status])
        : h('span', { attrs: { 'data-testid': 'care-conversation' } }, NO_CONVERSATION),
    },
  ]);

  return h(
    'div',
    { class: 'view view--care-request' },
    pageHeader({ eyebrow: 'Yearly care', title: s.piece.productId, identifier: true, actions }),
    section('The request', facts, { id: 'care-request' }),
  );
}
