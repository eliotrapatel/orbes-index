/**
 * A supplier order's page, `#/supplier-orders/:supplierOrderId` (plan NEXT LOT of 2026-10-07, §3.5.4.2): ORBES's only,
 * read by an AUDITOR, acted on by an OPERATOR. Title its reference, with its status.
 *
 *  - Actions: PDF; while DRAFT, Mark sent and Discard the draft; SENT, Confirmed by the supplier; SENT, EXPECTED and
 *    PARTLY RECEIVED, Cancel the rest.
 *  - Order: the supplier, where it is delivered (the location and its address), the currency, the expected date, the
 *    shipping costs, the total, the note printed on the PDF; Edit while DRAFT.
 *  - Lines: model, variant, size, SKU, quantity, unit price, line total, received, rejected, expected; while DRAFT, Add a
 *    line, Edit, Remove (offered sizes only), and under a line what other supplier orders still owe of it.
 *  - Not on the order: the confirmed pieces with no line (extra pieces, a size not ordered), with the agent's notes.
 *  - Receptions; Back to the supplier (the supplier's answer: a replacement or a credit); Supplier invoice (entered,
 *    paid); History.
 * Each request is audited by the server; the page is read again.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount, formatDate, formatDateTime } from '../format.js';
import { RECEPTION_STATUS_LABELS, sizeText, skuWords } from '../model/logistics.js';
import { can } from '../model/permissions.js';
import {
  amountField,
  amountOf,
  draftChange,
  draftProblem,
  expectedElsewhereLine,
  HISTORY_LABELS,
  invoiceProblem,
  lineProblem,
  linesWith,
  money,
  ORDER_TEXT,
  settledCell,
  settleProblem,
  SUPPLIER_ORDER_LIMITS,
  SUPPLIER_ORDER_STATUS_LABELS,
  supplierOrderActions,
} from '../model/supplier-orders.js';
import { href } from '../router.js';
import type { LogisticsSku, SupplierOrderDetail, SupplierOrderLine } from '../types.js';
import { button, defList, linkButton, pageHeader, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

export async function supplierOrderView(ctx: ViewContext): Promise<HTMLElement> {
  const o = await ctx.api.supplierOrder(ctx.route.params.supplierOrderId ?? '');
  const manage = can(ctx.session.admin.role, 'manageSupplierOrders');
  const acts = supplierOrderActions(o, manage);
  const eyebrow = `${o.reference} · ${o.supplier.name}`;
  const after = (message: string) => (v: unknown) => {
    if (!v) return;
    notify(message);
    ctx.reload();
  };
  const currency = o.currency;

  // ── The order's actions ──────────────────────────────────────────────────
  const pdf = button('PDF', { kind: 'secondary', testId: 'supplier-order-pdf' });
  pdf.addEventListener('click', async () => {
    pdf.disabled = true;
    try {
      saveDownload(await ctx.api.supplierOrderPdf(o.id));
    } catch (e) {
      notifyError(e, 'The PDF could not be produced.');
    } finally {
      pdf.disabled = false;
    }
  });
  const send = () =>
    void openDialog({
      title: ORDER_TEXT.markSent,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, ORDER_TEXT.markSentText),
      confirmLabel: ORDER_TEXT.markSent,
      submit: async () => {
        await ctx.api.sendSupplierOrder(o.id);
      },
    }).then(after(ORDER_TEXT.sent));
  const discard = () =>
    void openDialog({
      title: ORDER_TEXT.discard,
      eyebrow,
      danger: true,
      body: h('p', { class: 'dialog__text' }, ORDER_TEXT.discardText),
      confirmLabel: ORDER_TEXT.discard,
      submit: async () => {
        await ctx.api.discardSupplierDraft(o.id);
      },
    }).then((v) => {
      if (!v) return;
      notify(ORDER_TEXT.discarded);
      ctx.navigate(href('supplierOrders'));
    });
  const confirmed = () =>
    void openDialog({
      title: ORDER_TEXT.confirmed,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, ORDER_TEXT.confirmedText),
      fields: [{ name: 'expectedOn', label: 'Expected on', kind: 'date', value: o.expectedOn ?? '' }],
      confirmLabel: ORDER_TEXT.confirmed,
      submit: async (v) => {
        await ctx.api.supplierConfirmed(o.id, v.expectedOn || null);
      },
    }).then(after(ORDER_TEXT.confirmedToast));
  const cancelRest = () =>
    void openDialog({
      title: ORDER_TEXT.cancelRest,
      eyebrow,
      danger: true,
      body: h('p', { class: 'dialog__text' }, ORDER_TEXT.cancelRestText),
      fields: [{ name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: SUPPLIER_ORDER_LIMITS.note }],
      confirmLabel: ORDER_TEXT.cancelRest,
      submit: async (v) => {
        await ctx.api.cancelSupplierRest(o.id, v.note.trim());
      },
    }).then(after(ORDER_TEXT.cancelRestToast));
  const actions: Child[] = [
    pdf,
    acts.send ? button(ORDER_TEXT.markSent, { kind: 'primary', testId: 'supplier-order-send', onClick: send }) : null,
    acts.confirmed ? button(ORDER_TEXT.confirmed, { kind: 'primary', testId: 'supplier-order-confirmed', onClick: confirmed }) : null,
    acts.cancelRest ? button(ORDER_TEXT.cancelRest, { kind: 'ghost', testId: 'supplier-order-cancel-rest', onClick: cancelRest }) : null,
    acts.discard ? button(ORDER_TEXT.discard, { kind: 'danger', testId: 'supplier-order-discard', onClick: discard }) : null,
    linkButton('All supplier orders', href('supplierOrders'), 'ghost'),
  ];

  // ── Order ────────────────────────────────────────────────────────────────
  const edit = () =>
    void openDialog({
      title: 'Edit the order',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, ORDER_TEXT.editText),
      fields: [
        { name: 'currency', label: 'Currency', maxlength: 3, value: o.currency ?? '', hint: 'Any currency with cents, such as EUR, GBP, USD or CHF.' },
        { name: 'expectedOn', label: 'Expected on', kind: 'date', value: o.expectedOn ?? '' },
        { name: 'shipping', label: 'Shipping costs', maxlength: 14, value: amountField(o.shippingMinor), hint: 'In units: 120, or 120.50. Empty: none.' },
        { name: 'note', label: 'Note', kind: 'textarea', maxlength: SUPPLIER_ORDER_LIMITS.note, value: o.note ?? '', hint: 'Printed on the PDF.' },
      ],
      validate: draftProblem,
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.updateSupplierDraft(o.id, draftChange(v));
      },
    }).then(after(ORDER_TEXT.saved));
  const orderSection = section(
    'Order',
    defList([
      { label: 'Supplier', value: o.supplier.name },
      { label: 'Deliver to', value: h('span', { class: 'prewrap', data: { testid: 'supplier-order-deliver-to' } }, [o.location.name, o.location.address].filter(Boolean).join('\n')) },
      { label: 'Currency', value: o.currency ?? '—' },
      { label: 'Expected on', value: o.expectedOn ? formatDate(o.expectedOn) : '—' },
      { label: 'Shipping costs', value: money(o.shippingMinor, currency) },
      { label: 'Total', value: h('span', { data: { testid: 'supplier-order-total' } }, money(o.totalMinor, currency)) },
      { label: 'Note', value: h('span', { class: 'prewrap' }, o.note ?? '—') },
      ...(o.restCancelled ? [{ label: 'The rest cancelled', value: h('span', { class: 'prewrap' }, o.restCancelled.note), note: formatDateTime(o.restCancelled.at) }] : []),
    ]),
    { id: 'supplier-order-facts', tools: acts.edit ? [button('Edit', { kind: 'ghost', testId: 'supplier-order-edit', onClick: edit })] : [] },
  );

  // ── Lines ────────────────────────────────────────────────────────────────
  const lineDialog = async (line: SupplierOrderLine | null) => {
    let offered: LogisticsSku[] = [];
    if (!line) offered = (await ctx.api.logisticsStock()).skus.filter((k) => !o.lines.some((l) => l.sku.id === k.id));
    void openDialog({
      title: line ? 'Edit the line' : ORDER_TEXT.addLine,
      eyebrow: line ? `${skuWords(line.sku)} · ${line.sku.code}` : eyebrow,
      fields: [
        ...(line ? [] : [{ name: 'skuId', label: 'Size', kind: 'select' as const, required: true, options: [{ value: '', label: 'Choose a size' }, ...offered.map((k) => ({ value: k.id, label: `${skuWords(k)} · ${k.code}` }))], value: '' }]),
        { name: 'quantity', label: 'Quantity', required: true, maxlength: 5, value: line ? String(line.quantity) : '' },
        { name: 'unitPrice', label: 'Unit price', maxlength: 14, value: amountField(line?.unitPriceMinor), hint: `In ${o.currency ?? 'the order’s currency'}: 120, or 120.50. Required to send.` },
      ],
      validate: (v) => lineProblem(v, !line),
      confirmLabel: 'Save',
      submit: async (v) => {
        const price = v.unitPrice.trim();
        await ctx.api.updateSupplierDraft(o.id, { lines: linesWith(o, { skuId: line?.sku.id ?? v.skuId, quantity: Number(v.quantity), unitPriceMinor: price ? amountOf(price) : null }) });
      },
    }).then(after(ORDER_TEXT.lineSaved));
  };
  const remove = (line: SupplierOrderLine) =>
    void openDialog({
      title: 'Remove the line',
      eyebrow: `${skuWords(line.sku)} · ${line.sku.code}`,
      body: h('p', { class: 'dialog__text' }, `${formatCount(line.quantity)} ${line.quantity === 1 ? 'piece leaves' : 'pieces leave'} the draft.`),
      confirmLabel: 'Remove',
      submit: async () => {
        await ctx.api.updateSupplierDraft(o.id, { lines: linesWith(o, { remove: line.sku.id }) });
      },
    }).then(after(ORDER_TEXT.lineRemoved));
  const lineColumns: Column<SupplierOrderLine>[] = [
    { label: 'Model', cell: (l) => l.sku.model.name },
    { label: 'Variant', cell: (l) => l.sku.variant ?? '—', kind: ['nowrap'] },
    {
      label: 'Size',
      cell: (l) => h('span', null, sizeText(l.sku.sizeLabel), o.status === 'DRAFT' && expectedElsewhereLine(l.expectedElsewhere) ? h('span', { class: 'cell-sub', data: { testid: 'line-elsewhere' } }, expectedElsewhereLine(l.expectedElsewhere)!) : null),
      kind: ['nowrap'],
    },
    { label: 'SKU', cell: (l) => h('span', { class: 'mono' }, l.sku.code), kind: ['nowrap'] },
    { label: 'Quantity', cell: (l) => formatCount(l.quantity), kind: ['num'] },
    { label: 'Unit price', cell: (l) => money(l.unitPriceMinor, currency), kind: ['num', 'nowrap'] },
    { label: 'Line total', cell: (l) => money(l.lineTotalMinor, currency), kind: ['num', 'nowrap'] },
    { label: 'Received', cell: (l) => formatCount(l.received), kind: ['num'] },
    { label: 'Rejected', cell: (l) => formatCount(l.rejected), kind: ['num'] },
    { label: 'Expected', cell: (l) => formatCount(l.expected), kind: ['num'] },
    ...(acts.edit
      ? [
          {
            label: '',
            cell: (l) =>
              h(
                'span',
                { class: 'row-actions' },
                button('Edit', { kind: 'ghost', testId: 'line-edit', onClick: () => void lineDialog(l) }),
                button('Remove', { kind: 'ghost', testId: 'line-remove', onClick: () => remove(l) }),
              ),
            kind: ['actions'],
          } satisfies Column<SupplierOrderLine>,
        ]
      : []),
  ];
  const linesSection = section('Lines', table(lineColumns, o.lines, { caption: 'Lines', empty: 'No line yet.' }), {
    id: 'supplier-order-lines',
    note: `${formatCount(o.pieces.received)} / ${formatCount(o.pieces.ordered)} received`,
    tools: acts.edit ? [button(ORDER_TEXT.addLine, { kind: 'ghost', testId: 'line-add', onClick: () => void lineDialog(null) })] : [],
  });

  const extrasSection = o.extras.length
    ? section(
        ORDER_TEXT.extrasTitle,
        table(
          [
            { label: 'Model', cell: (x) => x.sku.model.name },
            { label: 'Variant', cell: (x) => x.sku.variant ?? '—', kind: ['nowrap'] },
            { label: 'Size', cell: (x) => sizeText(x.sku.sizeLabel), kind: ['nowrap'] },
            { label: 'SKU', cell: (x) => h('span', { class: 'mono' }, x.sku.code), kind: ['nowrap'] },
            { label: 'Received', cell: (x) => formatCount(x.received), kind: ['num'] },
            { label: 'Rejected', cell: (x) => formatCount(x.rejected), kind: ['num'] },
            { label: 'Note', cell: (x) => h('span', { class: 'prewrap' }, x.notes.join('\n') || '—'), kind: ['wide'] },
          ],
          o.extras,
          { caption: ORDER_TEXT.extrasTitle },
        ),
        { id: 'supplier-order-extras' },
      )
    : null;

  // ── Receptions and returns ───────────────────────────────────────────────
  const receptionsSection = section(
    ORDER_TEXT.receptionsTitle,
    table(
      [
        { label: 'Counted', cell: (r) => h('a', { class: 'idlink', attrs: { href: href('reception', { receptionId: r.id }) } }, formatDate(r.countedAt)), kind: ['nowrap'] },
        { label: 'OK', cell: (r) => formatCount(r.accepted), kind: ['num'] },
        { label: 'Rejected', cell: (r) => formatCount(r.rejected), kind: ['num'] },
        { label: 'Status', cell: (r) => statusMark(RECEPTION_STATUS_LABELS[r.status], r.status === 'CONFIRMED' ? 'solid' : 'outline'), kind: ['nowrap'] },
        { label: 'Confirmed by', cell: (r) => (r.confirmedBy ? `${r.confirmedBy} · ${formatDate(r.confirmedAt)}` : '—') },
      ],
      o.receptions,
      { caption: ORDER_TEXT.receptionsTitle, empty: ORDER_TEXT.receptionsEmpty },
    ),
    { id: 'supplier-order-receptions' },
  );
  const settle = (r: SupplierOrderDetail['returns'][number]) =>
    void openDialog({
      title: ORDER_TEXT.settle,
      eyebrow: `${skuWords(r.sku)} · ${formatCount(r.quantity)} ${r.quantity === 1 ? 'piece' : 'pieces'}`,
      fields: [
        {
          name: 'settlement',
          label: 'The supplier’s answer',
          kind: 'select',
          required: true,
          options: [
            { value: '', label: 'Choose' },
            { value: 'REPLACEMENT', label: 'Replacement' },
            { value: 'CREDIT', label: 'Credit' },
          ],
          value: '',
        },
        { name: 'credit', label: 'Amount', maxlength: 14, hint: `In ${o.currency ?? 'the order’s currency'}: 120, or 120.50.`, shown: (v) => v.settlement === 'CREDIT' },
        { name: 'note', label: 'Note', kind: 'textarea', maxlength: SUPPLIER_ORDER_LIMITS.returnNote },
      ],
      live: (v) => (v.settlement === 'REPLACEMENT' ? h('p', { class: 'dialog__text' }, ORDER_TEXT.replacementText) : []),
      validate: settleProblem,
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.settleSupplierReturn(r.id, {
          settlement: v.settlement as 'REPLACEMENT' | 'CREDIT',
          ...(v.settlement === 'CREDIT' ? { creditMinor: amountOf(v.credit) } : {}),
          note: v.note.trim() || null,
        });
      },
    }).then(after(ORDER_TEXT.settled));
  const returnsSection = section(
    ORDER_TEXT.backTitle,
    table(
      [
        { label: 'Model · variant · size', cell: (r) => skuWords(r.sku) },
        { label: 'Pieces', cell: (r) => formatCount(r.quantity), kind: ['num'] },
        { label: 'Status', cell: (r) => statusMark(r.status === 'TO_RETURN' ? 'TO RETURN' : 'RETURNED', r.status === 'TO_RETURN' ? 'outline' : 'solid'), kind: ['nowrap'] },
        { label: 'Settled', cell: (r) => h('span', { data: { testid: 'return-settled' } }, settledCell(r, currency)), kind: ['nowrap'] },
        ...(manage ? [{ label: '', cell: (r) => (r.settlement ? null : button(ORDER_TEXT.settle, { kind: 'ghost', testId: 'return-settle', onClick: () => settle(r) })), kind: ['actions'] } satisfies Column<SupplierOrderDetail['returns'][number]>] : []),
      ],
      o.returns,
      { caption: ORDER_TEXT.backTitle, empty: ORDER_TEXT.backEmpty },
    ),
    { id: 'supplier-order-returns' },
  );

  // ── Invoice ──────────────────────────────────────────────────────────────
  const enterInvoice = () =>
    void openDialog({
      title: ORDER_TEXT.invoiceEnter,
      eyebrow,
      fields: [
        { name: 'number', label: 'Number', required: true, maxlength: SUPPLIER_ORDER_LIMITS.invoiceNumber, value: o.invoice?.number ?? '' },
        { name: 'amount', label: 'Amount', required: true, maxlength: 16, value: amountField(o.invoice?.amountMinor), hint: `In ${o.currency ?? 'the order’s currency'}: 4800, or 4800.50.` },
        { name: 'date', label: 'Date', kind: 'date', required: true, value: o.invoice?.date ?? '' },
      ],
      validate: invoiceProblem,
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setSupplierInvoice(o.id, { number: v.number.trim(), amountMinor: amountOf(v.amount, SUPPLIER_ORDER_LIMITS.invoiceMinor)!, date: v.date.trim() });
      },
    }).then(after(ORDER_TEXT.invoiceSaved));
  const paid = () =>
    void openDialog({
      title: ORDER_TEXT.invoicePaid,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, ORDER_TEXT.invoicePaidText),
      confirmLabel: ORDER_TEXT.invoicePaid,
      submit: async () => {
        await ctx.api.markSupplierInvoicePaid(o.id);
      },
    }).then(after(ORDER_TEXT.invoicePaidToast));
  const invoiceSection = section(
    ORDER_TEXT.invoiceTitle,
    defList([
      { label: 'Number', value: h('span', { data: { testid: 'invoice-number' } }, o.invoice?.number ?? '—') },
      { label: 'Amount', value: money(o.invoice?.amountMinor, currency) },
      { label: 'Date', value: o.invoice ? formatDate(o.invoice.date) : '—' },
      { label: 'Paid', value: h('span', { data: { testid: 'invoice-paid' } }, o.invoice?.paidAt ? formatDate(o.invoice.paidAt) : '—') },
    ]),
    {
      id: 'supplier-order-invoice',
      tools: [
        acts.invoice ? button(ORDER_TEXT.invoiceEnter, { kind: 'ghost', testId: 'invoice-enter', onClick: enterInvoice }) : null,
        acts.invoicePaid ? button(ORDER_TEXT.invoicePaid, { kind: 'secondary', testId: 'invoice-paid-button', onClick: paid }) : null,
      ].filter((b): b is HTMLButtonElement => b !== null),
    },
  );

  const historySection = section(
    ORDER_TEXT.historyTitle,
    table(
      [
        { label: 'When', cell: (e) => formatDateTime(e.at), kind: ['nowrap'] },
        { label: 'Change', cell: (e) => HISTORY_LABELS[e.action] ?? e.action },
        { label: 'By', cell: (e) => e.by ?? 'ORBES', kind: ['nowrap'] },
      ],
      [...o.history].reverse(),
      { caption: ORDER_TEXT.historyTitle, empty: 'No change yet.' },
    ),
    { id: 'supplier-order-history' },
  );

  return h(
    'div',
    { class: 'view view--supplier-order', data: { testid: 'supplier-order' } },
    pageHeader({ eyebrow: 'Supplier orders', title: o.reference, identifier: true, actions }),
    h('p', { class: 'supplier-order__status', data: { testid: 'supplier-order-mark' } }, statusMark(SUPPLIER_ORDER_STATUS_LABELS[o.status], o.status === 'DRAFT' ? 'outline' : o.status === 'CANCELLED' ? 'muted' : 'solid')),
    orderSection,
    linesSection,
    extrasSection,
    receptionsSection,
    returnsSection,
    invoiceSection,
    historySection,
  );
}
