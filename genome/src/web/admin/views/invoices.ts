/**
 * The Invoices page (Clients), `#/invoices` (plan LIVE RELEASE+: choices 20 and 22, The console → Invoices): the
 * invoices and credit notes of a month, as CONGLOMERAT LLC issued them — an invoice when an order is paid, a credit note
 * when a paid order is cancelled or returned — in English, without VAT.
 *
 * The month (UTC; the current one by default), one kind, a number or an order's reference narrow the list
 * (`?month=YYYY-MM&kind=&q=`). Each row: its number, kind, date, order (its page), buyer (masked for an AUDITOR), total,
 * what it cancels or what cancels it, and its PDF. The month's totals per currency (invoiced, credited, net), the whole
 * month's whatever the list keeps, head the list; DOWNLOAD THE MONTH gives the accountant's CSV. Nothing here issues or
 * changes a document: the orders' steps do.
 *
 * The Partners switch beside the month (lot M4 plan §2.3, K49 P1 and P4; `?to=partners`): the month's partner invoices
 * and credit notes (P-, PC-), as ISSUE THE INVOICE and CANCEL issue them in Club → Partners, their totals, each PDF and
 * the month's partner CSV; the collectors' documents are unchanged.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDateTime } from '../format.js';
import { buyerLine, invoiceFilters, invoiceMonths, KIND_FILTER_LABELS, linkedDocument, monthLabel, signedMoney, INVOICE_SEARCH_MAX } from '../model/invoices.js';
import { formatMoney } from '../model/live.js';
import { DOCUMENT_LABELS } from '../model/orders.js';
import { INVOICE_ISSUED_TO, invoiceIssuedTo, ISSUED_TO_LABELS, PARTNER_DOCUMENT_LABELS, partnerDocumentExperience, partnerLinked, type InvoiceIssuedTo } from '../model/partners.js';
import { href } from '../router.js';
import { INVOICE_KINDS, type Invoice, type InvoiceList, type PartnerInvoice, type PartnerInvoiceList } from '../types.js';
import { busy, button, field, filterBar, input, mono, pageHeader, section, select, table } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const LEAD =
  'The invoices and credit notes issued by CONGLOMERAT LLC, in English and without VAT: an invoice when an order is paid, a credit note when a paid order is cancelled or returned. The orders’ steps issue them; none is ever changed.';

const PARTNERS_LEAD =
  'The invoices and credit notes issued by CONGLOMERAT LLC to the partners, in English and without VAT, in their own series: an invoice (P-) when an experience is invoiced in Club → Partners, a credit note (PC-) when an invoiced one is cancelled. None is ever changed.';

/** The Partners switch beside the month (`?to=partners`): the collectors' documents or the partners'. */
function issuedToField(ctx: ViewContext, to: InvoiceIssuedTo): HTMLElement {
  const choice = select('to', INVOICE_ISSUED_TO.map((t) => ({ value: t, label: ISSUED_TO_LABELS[t] })), to);
  choice.setAttribute('data-testid', 'invoices-to');
  choice.addEventListener('change', () => ctx.setQuery({ to: choice.value === 'partners' ? 'partners' : undefined, kind: undefined, q: undefined }));
  return field('Issued to', choice);
}

export async function invoicesView(ctx: ViewContext): Promise<HTMLElement> {
  const filters = invoiceFilters(ctx.route.query);
  if (invoiceIssuedTo(ctx.route.query) === 'partners') return partnerInvoicesView(ctx, filters.month);
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
    filterBar(field('Month', month), issuedToField(ctx, 'collectors'), field('Document', kind), field('Search', search)),
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

/** Invoices → Partners: the month's partner invoices and credit notes, their totals, PDFs and CSV. */
async function partnerInvoicesView(ctx: ViewContext, monthAsked: string | undefined): Promise<HTMLElement> {
  const list = await ctx.api.partnerInvoices(monthAsked);
  const month = select('month', invoiceMonths(list.currentMonth, list.month).map((m) => ({ value: m, label: monthLabel(m) })), list.month);
  month.addEventListener('change', () => ctx.setQuery({ month: month.value }));
  const csv = button('Download the month (CSV)', { kind: 'ghost', testId: 'partner-invoices-csv' });
  csv.addEventListener('click', () =>
    void busy(csv, async () => {
      try {
        saveDownload(await ctx.api.partnerInvoicesCsv(list.month));
      } catch (e) {
        notifyError(e);
      }
    }),
  );
  return h(
    'div',
    { class: 'view view--invoices view--partner-invoices' },
    pageHeader({ eyebrow: 'Clients', title: 'Invoices', lead: PARTNERS_LEAD, actions: [csv] }),
    filterBar(field('Month', month), issuedToField(ctx, 'partners')),
    totalsSection(list),
    section(
      'Documents',
      table<PartnerInvoice>(
        [
          { label: 'Number', cell: (i) => h('span', { data: { testid: 'partner-invoice-number' } }, mono(i.number)), kind: ['nowrap'] },
          { label: 'Document', cell: (i) => PARTNER_DOCUMENT_LABELS[i.kind], kind: ['nowrap'] },
          { label: 'Issued', cell: (i) => formatDateTime(i.issuedAt), kind: ['nowrap'] },
          { label: 'Partner', cell: (i) => h('a', { class: 'idlink', attrs: { href: href('clubPartner', { partnerId: i.partner.id }) } }, i.partner.brand), kind: ['wide'] },
          { label: 'Experience', cell: (i) => h('a', { class: 'idlink', attrs: { href: href('partnerExperience', { experienceId: i.experience.id }) } }, partnerDocumentExperience(i)), kind: ['wide'] },
          { label: 'Total', cell: (i) => formatMoney(i.totalMinor, i.currency), kind: ['nowrap', 'num'] },
          { label: 'Linked', cell: (i) => partnerLinked(i) || '—', kind: ['nowrap'] },
          { label: '', cell: (i) => partnerPdfButton(ctx, i), kind: ['actions'] },
        ],
        list.items,
        { caption: 'Partner invoices and credit notes', empty: 'No partner document was issued this month.' },
      ),
      { id: 'invoices-list', note: `${monthLabel(list.month)} · ${formatCount(list.items.length)} ${list.items.length === 1 ? 'document' : 'documents'}` },
    ),
  );
}

function partnerPdfButton(ctx: ViewContext, i: PartnerInvoice): HTMLButtonElement {
  const b = button('PDF', { kind: 'ghost', testId: 'partner-invoice-pdf' });
  b.setAttribute('aria-label', `${PARTNER_DOCUMENT_LABELS[i.kind]} ${i.number}, PDF`);
  b.addEventListener('click', () =>
    void busy(b, async () => {
      try {
        saveDownload(await ctx.api.partnerInvoicePdf(i.id));
      } catch (e) {
        notifyError(e, 'The document could not be produced.');
      }
    }),
  );
  return b;
}

/** The month's totals per currency: invoiced, credited, net. */
function totalsSection(list: Pick<InvoiceList | PartnerInvoiceList, 'totals' | 'month'>): HTMLElement | null {
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
