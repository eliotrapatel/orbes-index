/**
 * The Invoices page (Clients), `#/invoices` (plan LIVE RELEASE+: choices 20 and 22, The console → Invoices): the
 * invoices and credit notes of a month, as CONGLOMERAT LLC issued them — an invoice when an order is paid, a credit note
 * when a paid order is cancelled or returned — in English, without VAT.
 *
 * The month (UTC; the current one by default), one kind, a number or an order's reference narrow the list
 * (`?month=YYYY-MM&kind=&q=`). Each row: its number, kind, date, order (its page), buyer (masked for an AUDITOR), total,
 * what it cancels or what cancels it, and its PDF. The month's totals per currency (invoiced, credited, net) head the
 * list; DOWNLOAD THE MONTH gives the accountant's CSV. Nothing here issues or changes a document: the orders' steps do.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDateTime } from '../format.js';
import { buyerLine, invoiceFilters, invoiceMonths, KIND_FILTER_LABELS, linkedDocument, monthLabel, signedMoney, INVOICE_SEARCH_MAX } from '../model/invoices.js';
import { formatMoney } from '../model/live.js';
import { DOCUMENT_LABELS } from '../model/orders.js';
import { href } from '../router.js';
import { INVOICE_KINDS, type Invoice, type InvoiceList } from '../types.js';
import { button, field, filterBar, input, mono, pageHeader, section, select, table } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const LEAD =
  'The invoices and credit notes issued by CONGLOMERAT LLC, in English and without VAT: an invoice when an order is paid, a credit note when a paid order is cancelled or returned. The orders’ steps issue them; none is ever changed.';

export async function invoicesView(ctx: ViewContext): Promise<HTMLElement> {
  const filters = invoiceFilters(ctx.route.query);
  const list = await ctx.api.invoices(filters);

  const month = select('month', invoiceMonths(list.currentMonth, list.month).map((m) => ({ value: m, label: monthLabel(m) })), list.month);
  month.addEventListener('change', () => ctx.setQuery({ month: month.value }));
  const kind = select('kind', [{ value: '', label: 'Every document' }, ...INVOICE_KINDS.map((k) => ({ value: k, label: KIND_FILTER_LABELS[k] }))], filters.kind ?? '');
  kind.addEventListener('change', () => ctx.setQuery({ kind: kind.value }));
  const search = input('q', { value: filters.q ?? '', placeholder: 'INV-…, CN-…, OR-…', maxlength: INVOICE_SEARCH_MAX });
  const searchFor = () => ctx.setQuery({ q: search.value.trim() });
  search.addEventListener('change', searchFor);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchFor();
  });

  const csv = button('Download the month (CSV)', { kind: 'ghost', testId: 'invoices-csv' });
  csv.addEventListener('click', async () => {
    csv.disabled = true;
    try {
      saveDownload(await ctx.api.invoicesCsv(list.month));
    } catch (e) {
      notifyError(e);
    } finally {
      csv.disabled = false;
    }
  });

  return h(
    'div',
    { class: 'view view--invoices' },
    pageHeader({ eyebrow: 'Clients', title: 'Invoices', lead: LEAD, actions: [csv] }),
    filterBar(field('Month', month), field('Document', kind), field('Search', search)),
    totalsSection(list),
    section(
      'Documents',
      table(
        [
          { label: 'Number', cell: (i) => mono(i.number), kind: ['nowrap'] },
          { label: 'Document', cell: (i) => DOCUMENT_LABELS[i.kind], kind: ['nowrap'] },
          { label: 'Issued', cell: (i) => formatDateTime(i.issuedAt), kind: ['nowrap'] },
          { label: 'Order', cell: (i) => h('a', { class: 'idlink mono', attrs: { href: href('order', { orderId: i.order.id }) } }, i.order.reference), kind: ['nowrap'] },
          { label: 'Buyer', cell: (i) => h('span', { data: { testid: 'invoice-buyer' } }, buyerLine(i)), kind: ['wide'] },
          { label: 'Total', cell: (i) => formatMoney(i.totalMinor, i.currency), kind: ['nowrap', 'num'] },
          { label: 'Linked', cell: (i) => linkedDocument(i) || '—', kind: ['nowrap'] },
          { label: '', cell: (i) => pdfButton(ctx, i), kind: ['actions'] },
        ],
        list.items,
        { caption: 'Invoices and credit notes', empty: filters.q || filters.kind ? 'No document matches.' : 'No document was issued this month.' },
      ),
      { id: 'invoices-list', note: `${monthLabel(list.month)} · ${formatCount(list.items.length)} ${list.items.length === 1 ? 'document' : 'documents'}` },
    ),
  );
}

/** The month's totals per currency: invoiced, credited, net. */
function totalsSection(list: InvoiceList): HTMLElement | null {
  if (list.totals.length === 0) return null;
  return section(
    'The month',
    table(
      [
        { label: 'Currency', cell: (t) => t.currency, kind: ['nowrap'] },
        { label: 'Invoiced', cell: (t) => formatMoney(t.invoiced, t.currency), kind: ['nowrap', 'num'] },
        { label: 'Credited', cell: (t) => formatMoney(t.credited, t.currency), kind: ['nowrap', 'num'] },
        { label: 'Net', cell: (t) => h('span', { data: { testid: `invoices-net-${t.currency}` } }, signedMoney(t.net, t.currency)), kind: ['nowrap', 'num'] },
      ],
      list.totals,
      { caption: 'Totals of the month' },
    ),
    { id: 'invoices-totals', note: monthLabel(list.month) },
  );
}

function pdfButton(ctx: ViewContext, i: Invoice): HTMLButtonElement {
  const b = button('PDF', { kind: 'ghost', testId: 'invoice-pdf' });
  b.setAttribute('aria-label', `${DOCUMENT_LABELS[i.kind]} ${i.number}, PDF`);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      saveDownload(await ctx.api.invoicePdf(i.id));
    } catch (e) {
      notifyError(e, 'The document could not be produced.');
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
