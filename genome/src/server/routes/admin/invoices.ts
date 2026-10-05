/**
 * The invoices in the console (plan LIVE RELEASE+ of 2026-10-04, choice 22, The console → Invoices, Clients;
 * services/invoices.ts): the invoices and credit notes of a month, their PDFs, the month's CSV for the accountant.
 * Issued by the orders' steps (PAID; a cancellation after PAID, a return): nothing here changes one.
 *
 *   GET    /api/admin/invoices              AUDITOR  a month's documents and their totals (?month=YYYY-MM&kind=&q=)
 *   GET    /api/admin/invoices.csv          AUDITOR  the month's CSV (?month=YYYY-MM)
 *   GET    /api/admin/invoices/:id/pdf      AUDITOR  one document's PDF
 *
 * An AUDITOR reads the buyer masked (`J*** D***`, the address withheld, `j***@example.com`: serialize.ts), on the
 * page, in the CSV and in the PDF; OPERATOR and ADMIN in clear. Files are attachments, never stored by a cache.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { invoiceCsvQuery, invoiceListQuery, invoiceParams, parse } from '../../http/schemas.js';
import type { BuyerView, InvoiceFilter, InvoiceList } from '../../services/invoices.js';
import { safeFilename } from './codes.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, orderBuyer, readsClientEmails } from './serialize.js';

/** The buyer of a document as the caller may read it. */
export function invoiceBuyerView(inClear: boolean): BuyerView {
  return (b) => ({ ...orderBuyer(b, inClear), email: b.email === null ? null : clientEmail(b.email, inClear) });
}

/** A month's documents as the caller may read them. */
export function invoiceListJson(list: InvoiceList, inClear: boolean): InvoiceList {
  const view = invoiceBuyerView(inClear);
  return { ...list, items: list.items.map((i) => ({ ...i, buyer: view(i.buyer) })) };
}

const viewOf = (request: FastifyRequest) => invoiceBuyerView(readsClientEmails(request));

export const adminInvoiceRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { invoices } = ctx.services;

  app.get('/api/admin/invoices', async (request) => {
    const q = parse(invoiceListQuery, request.query);
    const filter = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as InvoiceFilter;
    return invoiceListJson(await invoices.list(filter), readsClientEmails(request));
  });

  app.get('/api/admin/invoices.csv', async (request, reply) => {
    const { month } = parse(invoiceCsvQuery, request.query);
    const file = await invoices.csv(month, viewOf(request));
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.get('/api/admin/invoices/:id/pdf', async (request, reply) => {
    const { id } = parse(invoiceParams, request.params);
    const file = await invoices.pdf(id, viewOf(request));
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(file.body.buffer, file.body.byteOffset, file.body.byteLength));
  });
};
