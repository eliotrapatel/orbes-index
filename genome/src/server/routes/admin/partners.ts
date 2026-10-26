/**
 * The partners (macro scope of 2026-10-20, K49 P1 to P4; lot M4 plan §2.2, step M4.6; services/partners.ts): the brands
 * that pay ORBES for an experience offered to the circle, their experiences, the invoices ORBES issues them in their own
 * series, and the guests who chose to share their name.
 *
 *   GET    /api/admin/partners                               AUDITOR   every partner (the contact's email and phone masked
 *                                                                      for an AUDITOR)
 *   POST   /api/admin/partners                               OPERATOR  a partner (409 PARTNER_BRAND_TAKEN)
 *   GET    /api/admin/partners/:id                           AUDITOR   a partner and its experiences
 *   PATCH  /api/admin/partners/:id                           OPERATOR  any of its fields
 *   POST   /api/admin/partners/:id/set-aside                 OPERATOR  SET ASIDE: offered for no new experience
 *   POST   /api/admin/partners/:id/reinstate                 OPERATOR  ACTIVE again
 *   POST   /api/admin/partners/:id/experiences               OPERATOR  a DRAFT experience of an ACTIVE partner
 *   GET    /api/admin/partner-experiences/:id                AUDITOR   an experience, its documents and its invitations
 *   PATCH  /api/admin/partner-experiences/:id                OPERATOR  its title, date and note; its amount and currency
 *                                                                      while DRAFT
 *   POST   /api/admin/partner-experiences/:id/invoice        ADMIN     ISSUE THE INVOICE (the next P- number)
 *   POST   /api/admin/partner-experiences/:id/paid           ADMIN     RECORD PAYMENT (or its date corrected)
 *   POST   /api/admin/partner-experiences/:id/cancel         OPERATOR  a DRAFT cancelled; an INVOICED or PAID one by an
 *                                                                      ADMIN only, with its PC- credit note
 *   GET    /api/admin/partner-experiences/:id/guests         AUDITOR   the headcount and the number of names shared; the
 *                                                                      names for OPERATOR and ADMIN only
 *   GET    /api/admin/partner-experiences/:id/guests.csv     OPERATOR  the guest list ORBES sends the partner
 *   GET    /api/admin/partner-invoices?month=                AUDITOR   a month's partner invoices and credit notes
 *   GET    /api/admin/partner-invoices.csv?month=            AUDITOR   the month's partner CSV for the accountant
 *   GET    /api/admin/partner-invoices/:id/pdf               AUDITOR   one document's PDF
 *
 * Audited and journaled by PartnerService. Files are attachments, never stored by a cache. Validation: the partner
 * schemas of http/schemas.ts (400 VALIDATION_FAILED).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createPartnerBody,
  createPartnerExperienceBody,
  emptyBody,
  parse,
  partnerExperienceParams,
  partnerInvoiceCsvQuery,
  partnerInvoiceListQuery,
  partnerInvoiceParams,
  partnerPaidBody,
  partnerParams,
  updatePartnerBody,
  updatePartnerExperienceBody,
} from '../../http/schemas.js';
import { adminActor, hasRole, requireAdmin } from '../../http/sessions.js';
import type { PartnerDetail, PartnerGuests, PartnerInput, PartnerView } from '../../services/partners.js';
import { safeFilename } from './codes.js';
import type { AdminRouteDeps } from './index.js';
import { maskEmail, MASKED_ADDRESS, readsClientEmails } from './serialize.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

/** A partner as the caller may read it: its contact's email and phone masked for an AUDITOR. */
export function partnerJson<T extends PartnerView | PartnerDetail>(p: T, inClear: boolean): T {
  if (inClear) return p;
  return { ...p, contact: { ...p.contact, email: p.contact.email === null ? null : maskEmail(p.contact.email), phone: p.contact.phone === null ? null : MASKED_ADDRESS } };
}

/** The guests as the caller may read them: the names for OPERATOR and ADMIN only (K49 P3), the counts for every reader. */
export function guestsJson(g: PartnerGuests, inClear: boolean): PartnerGuests | Omit<PartnerGuests, 'shared'> {
  if (inClear) return g;
  const { shared: _names, ...counts } = g;
  return counts;
}

const inClearOf = (request: FastifyRequest) => readsClientEmails(request);

/** The fields given, as PartnerService takes them. */
function partnerInput(b: Record<string, unknown>): PartnerInput {
  return Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as PartnerInput;
}

export const adminPartnerRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { partners } = ctx.services;

  app.get('/api/admin/partners', async (request) => {
    const inClear = inClearOf(request);
    return { items: (await partners.list()).map((p) => partnerJson(p, inClear)) };
  });

  app.post('/api/admin/partners', async (request, reply) => {
    const b = parse(createPartnerBody, request.body);
    const created = await partners.create(partnerInput(b), adminActor(request));
    reply.code(201);
    return created;
  });

  app.get('/api/admin/partners/:id', async (request) => {
    const { id } = parse(partnerParams, request.params);
    return partnerJson(await partners.get(id), inClearOf(request));
  });

  app.patch('/api/admin/partners/:id', async (request) => {
    const { id } = parse(partnerParams, request.params);
    const b = parse(updatePartnerBody, request.body);
    return partners.update(id, partnerInput(b), adminActor(request));
  });

  app.post('/api/admin/partners/:id/set-aside', async (request) => {
    const { id } = parse(partnerParams, request.params);
    parse(emptyBody, request.body);
    return partners.setAside(id, adminActor(request));
  });

  app.post('/api/admin/partners/:id/reinstate', async (request) => {
    const { id } = parse(partnerParams, request.params);
    parse(emptyBody, request.body);
    return partners.reinstate(id, adminActor(request));
  });

  app.post('/api/admin/partners/:id/experiences', async (request, reply) => {
    const { id } = parse(partnerParams, request.params);
    const b = parse(createPartnerExperienceBody, request.body);
    const created = await partners.createExperience(
      id,
      { title: b.title, eventOn: b.eventOn, amountMinor: b.amountMinor, currency: b.currency, ...(b.note !== undefined ? { note: b.note } : {}) },
      adminActor(request),
    );
    reply.code(201);
    return created;
  });

  app.get('/api/admin/partner-experiences/:id', async (request) => {
    const { id } = parse(partnerExperienceParams, request.params);
    return partners.experience(id);
  });

  app.patch('/api/admin/partner-experiences/:id', async (request) => {
    const { id } = parse(partnerExperienceParams, request.params);
    const b = parse(updatePartnerExperienceBody, request.body);
    return partners.updateExperience(id, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)), adminActor(request));
  });

  app.post('/api/admin/partner-experiences/:id/invoice', { config: ADMIN }, async (request) => {
    const { id } = parse(partnerExperienceParams, request.params);
    parse(emptyBody, request.body);
    return partners.issueInvoice(id, adminActor(request));
  });

  app.post('/api/admin/partner-experiences/:id/paid', { config: ADMIN }, async (request) => {
    const { id } = parse(partnerExperienceParams, request.params);
    const b = parse(partnerPaidBody, request.body);
    return partners.recordPaid(id, b.paidOn, adminActor(request));
  });

  app.post('/api/admin/partner-experiences/:id/cancel', async (request) => {
    const { id } = parse(partnerExperienceParams, request.params);
    parse(emptyBody, request.body);
    return partners.cancel(id, adminActor(request), { admin: hasRole(requireAdmin(request).admin.role, 'ADMIN') });
  });

  app.get('/api/admin/partner-experiences/:id/guests', async (request) => {
    const { id } = parse(partnerExperienceParams, request.params);
    return guestsJson(await partners.guests(id), inClearOf(request));
  });

  app.get('/api/admin/partner-experiences/:id/guests.csv', { config: { guard: { minRole: 'OPERATOR' as const } } }, async (request, reply) => {
    const { id } = parse(partnerExperienceParams, request.params);
    const file = await partners.guestsCsv(id, adminActor(request));
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.get('/api/admin/partner-invoices', async (request) => {
    const q = parse(partnerInvoiceListQuery, request.query);
    return partners.invoices(q.month);
  });

  app.get('/api/admin/partner-invoices.csv', async (request, reply) => {
    const { month } = parse(partnerInvoiceCsvQuery, request.query);
    const file = await partners.invoicesCsv(month);
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    return reply.type(file.contentType).send(file.body);
  });

  app.get('/api/admin/partner-invoices/:id/pdf', async (request, reply) => {
    const { id } = parse(partnerInvoiceParams, request.params);
    const file = await partners.invoicePdf(id);
    reply.header('content-type', file.contentType);
    reply.header('content-disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(file.body.buffer, file.body.byteOffset, file.body.byteLength));
  });
};
