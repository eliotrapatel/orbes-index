/**
 * The partners over HTTP (macro scope K49 P1 to P4; lot M4 plan §2.2, §2.5, step M4.6; routes/admin/partners.ts):
 *
 *  - an AUDITOR reads the partners (the contact's email and phone masked), a partner, an experience, its guests counted
 *    only (the headcount and the number of names), the month's partner invoices, their CSV and each PDF; it records
 *    nothing and never downloads the guest list;
 *  - an OPERATOR records partners and experiences (fields validated: 400; a brand taken: 409 PARTNER_BRAND_TAKEN),
 *    changes them, sets a partner aside and reinstates it, cancels a DRAFT, reads the guests' names and downloads
 *    their list; it never issues an invoice, records a payment nor cancels an invoiced experience (403);
 *  - an ADMIN issues the invoice (P-2026-0001; 409 PARTNER_BILLING_MISSING without billing details), records the
 *    payment, cancels an invoiced experience with its PC- credit note;
 *  - unknown ids answer 404 (PARTNER_NOT_FOUND, PARTNER_EXPERIENCE_NOT_FOUND, PARTNER_INVOICE_NOT_FOUND); the files
 *    are attachments, never stored by a cache.
 * The rules are test/services/partners.test.ts's; every route's role in the matrix of test/api/admin-roles.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PartnerDetail, PartnerExperienceView, PartnerInvoiceList } from '../../src/server/services/partners.js';
import { holdPieces } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('the partners routes (lot M4 plan §2.2)', () => {
  let h: Harness;
  let catalog: Catalog;
  let auditor: Client;
  let operator: Client;
  let admin: Client;
  let partner: PartnerDetail;
  let experience: PartnerExperienceView;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    admin = await adminClient(h, 'ADMIN');
  }, 60_000);
  afterAll(() => h?.close());

  const json = async <T>(p: Promise<{ statusCode: number; body: string }>, status = 200): Promise<T> => {
    const res = await p;
    expect(res.statusCode, res.body).toBe(status);
    return JSON.parse(res.body) as T;
  };

  it('an OPERATOR records a partner and its experience; an AUDITOR reads them, the contact masked, and records nothing', async () => {
    // Validation and the brand's uniqueness.
    for (const body of [{}, { brand: '' }, { brand: 'B', unknown: 1 }, { brand: 'B', billingCountry: 'FRA' }, { brand: 'x'.repeat(81) }]) {
      expect(errorOf(await operator.post('/api/admin/partners', body)).code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    partner = await json<PartnerDetail>(operator.post('/api/admin/partners', { brand: 'Maison Route', contactName: 'Ines Martel', contactEmail: 'ines@maison-route.example', contactPhone: '+33 1 23 45 67 89' }), 201);
    expect(partner).toMatchObject({ brand: 'Maison Route', active: true, contact: { email: 'ines@maison-route.example' } });
    expect(errorOf(await operator.post('/api/admin/partners', { brand: 'MAISON ROUTE' })).code).toBe('PARTNER_BRAND_TAKEN');
    // An AUDITOR reads it, the contact's email and phone masked; never records.
    const listed = await json<{ items: PartnerDetail[] }>(auditor.get('/api/admin/partners'));
    expect(listed.items.find((p) => p.id === partner.id)!.contact).toEqual({ name: 'Ines Martel', email: 'i***@maison-route.example', phone: '***' });
    expect((await json<PartnerDetail>(auditor.get(`/api/admin/partners/${partner.id}`))).contact.email).toBe('i***@maison-route.example');
    expect((await json<PartnerDetail>(operator.get(`/api/admin/partners/${partner.id}`))).contact.email).toBe('ines@maison-route.example');
    for (const [method, url, body] of [
      ['POST', '/api/admin/partners', { brand: 'Auditor brand' }],
      ['PATCH', `/api/admin/partners/${partner.id}`, { note: 'x' }],
      ['POST', `/api/admin/partners/${partner.id}/set-aside`, undefined],
      ['POST', `/api/admin/partners/${partner.id}/experiences`, { title: 'T', eventOn: '2026-12-01', amountMinor: 100, currency: 'EUR' }],
    ] as const) {
      const res = await auditor.request(method, url, body !== undefined ? { body } : {});
      expect([res.statusCode, errorOf(res).code], `${method} ${url}`).toEqual([403, 'FORBIDDEN']);
    }
    // Changed; set aside and reinstated.
    expect((await json<PartnerDetail>(operator.patch(`/api/admin/partners/${partner.id}`, { billingName: 'Maison Route SAS', billingAddress: '8 place Vendôme\n75001 Paris', billingCountry: 'fr', companyNumber: 'RCS 123' }))).billing).toEqual({
      name: 'Maison Route SAS',
      address: '8 place Vendôme\n75001 Paris',
      country: 'FR',
      companyNumber: 'RCS 123',
    });
    expect(errorOf(await operator.patch(`/api/admin/partners/${partner.id}`, {})).code).toBe('VALIDATION_FAILED');
    expect((await json<PartnerDetail>(operator.post(`/api/admin/partners/${partner.id}/set-aside`))).active).toBe(false);
    expect(errorOf(await operator.post(`/api/admin/partners/${partner.id}/experiences`, { title: 'Dinner', eventOn: '2026-12-01', amountMinor: 1_200_000, currency: 'EUR' })).code).toBe('PARTNER_EXPERIENCE_STATE');
    expect((await json<PartnerDetail>(operator.post(`/api/admin/partners/${partner.id}/reinstate`))).active).toBe(true);
    // Its experience: validated, recorded by an OPERATOR, read by an AUDITOR.
    for (const body of [{ title: 'Dinner', eventOn: '1 December', amountMinor: 1, currency: 'EUR' }, { title: 'Dinner', eventOn: '2026-12-01', amountMinor: 0, currency: 'EUR' }, { title: 'Dinner', eventOn: '2026-12-01', amountMinor: 1, currency: 'JPY' }, { title: 'Dinner', eventOn: '2026-12-01', amountMinor: 1 }]) {
      expect(errorOf(await operator.post(`/api/admin/partners/${partner.id}/experiences`, body)).code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    experience = await json<PartnerExperienceView>(operator.post(`/api/admin/partners/${partner.id}/experiences`, { title: 'Dinner', eventOn: '2026-12-01', amountMinor: 1_200_000, currency: 'EUR', note: 'Twenty guests' }), 201);
    expect(experience).toMatchObject({ status: 'DRAFT', partner: { id: partner.id, brand: 'Maison Route' }, note: 'Twenty guests' });
    expect((await json<PartnerExperienceView>(auditor.get(`/api/admin/partner-experiences/${experience.id}`))).title).toBe('Dinner');
    expect((await json<PartnerExperienceView>(operator.patch(`/api/admin/partner-experiences/${experience.id}`, { amountMinor: 1_300_000 }))).amountMinor).toBe(1_300_000);
    // Unknown ids.
    expect(errorOf(await auditor.get(`/api/admin/partners/${UNKNOWN}`)).code).toBe('PARTNER_NOT_FOUND');
    expect(errorOf(await auditor.get(`/api/admin/partner-experiences/${UNKNOWN}`)).code).toBe('PARTNER_EXPERIENCE_NOT_FOUND');
    expect(errorOf(await auditor.get(`/api/admin/partner-invoices/${UNKNOWN}/pdf`)).code).toBe('PARTNER_INVOICE_NOT_FOUND');
  });

  it('the guests: an AUDITOR reads their number and the names counted; an OPERATOR the names and their list', async () => {
    const post = await json<{ id: string }>(
      operator.post('/api/admin/circle/posts', { kind: 'INVITATION', title: 'Dinner with Maison Route', eventAt: new Date(h.clock.now().getTime() + 72 * 3_600_000).toISOString(), experience: 'PARTNER_EXPERIENCE', partnerExperienceId: experience.id }),
      201,
    );
    expect((await operator.post(`/api/admin/circle/posts/${post.id}/publish`)).statusCode).toBe(200);
    for (const share of [true, false]) {
      const m = await accountClient(h);
      const id = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', m.email.toLowerCase()).executeTakeFirstOrThrow()).id;
      await holdPieces(h.ctx.db, id, 10, catalog.modelId);
      expect((await m.client.post(`/api/v1/club/circle/${post.id}/rsvp`, { answer: 'YES', shareName: share })).statusCode).toBe(200);
    }
    expect(await json(auditor.get(`/api/admin/partner-experiences/${experience.id}/guests`))).toEqual({ experienceId: experience.id, headcount: 2, sharedCount: 1 });
    expect(await json(operator.get(`/api/admin/partner-experiences/${experience.id}/guests`))).toEqual({ experienceId: experience.id, headcount: 2, sharedCount: 1, shared: [{ firstName: 'Owner', lastName: 'Test' }] });
    expect((await json<PartnerExperienceView>(auditor.get(`/api/admin/partner-experiences/${experience.id}`))).invitations).toEqual([
      expect.objectContaining({ id: post.id, title: 'Dinner with Maison Route', minTier: 3, segment: null, published: true, yes: 2, capacity: null }),
    ]);
    // The list ORBES sends: an OPERATOR's; an AUDITOR is refused.
    expect([(await auditor.get(`/api/admin/partner-experiences/${experience.id}/guests.csv`)).statusCode]).toEqual([403]);
    const csv = await operator.get(`/api/admin/partner-experiences/${experience.id}/guests.csv`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="ORBES-guests-2026-12-01.csv"');
    expect(csv.body).toBe('"guests","2"\r\n"first name","last name"\r\n"Owner","Test"\r\n');
  });

  it('an ADMIN issues the invoice, records the payment and cancels an invoiced experience; an OPERATOR cancels a DRAFT only; the PDFs and the month\'s CSV', async () => {
    // An OPERATOR never issues, records a payment, nor cancels an invoiced experience.
    expect([(await operator.post(`/api/admin/partner-experiences/${experience.id}/invoice`)).statusCode]).toEqual([403]);
    const issued = await json<PartnerExperienceView>(admin.post(`/api/admin/partner-experiences/${experience.id}/invoice`));
    expect(issued).toMatchObject({ status: 'INVOICED', invoice: { number: 'P-2026-0001' } });
    expect(errorOf(await admin.post(`/api/admin/partner-experiences/${experience.id}/invoice`)).code).toBe('PARTNER_EXPERIENCE_STATE');
    expect(errorOf(await operator.patch(`/api/admin/partner-experiences/${experience.id}`, { currency: 'GBP' })).code).toBe('PARTNER_EXPERIENCE_STATE');
    expect([(await operator.post(`/api/admin/partner-experiences/${experience.id}/paid`, { paidOn: '2026-11-02' })).statusCode]).toEqual([403]);
    expect(errorOf(await admin.post(`/api/admin/partner-experiences/${experience.id}/paid`, { paidOn: '2 November' })).code).toBe('VALIDATION_FAILED');
    expect((await json<PartnerExperienceView>(admin.post(`/api/admin/partner-experiences/${experience.id}/paid`, { paidOn: '2026-11-02' }))).paidOn).toBe('2026-11-02');
    const refused = await operator.post(`/api/admin/partner-experiences/${experience.id}/cancel`);
    expect([refused.statusCode, errorOf(refused).code]).toEqual([403, 'FORBIDDEN']);
    expect((await json<PartnerExperienceView>(admin.post(`/api/admin/partner-experiences/${experience.id}/cancel`))).creditNote!.number).toBe('PC-2026-0001');
    // Billing missing: 409; a DRAFT cancelled by an OPERATOR.
    const bare = await json<PartnerDetail>(operator.post('/api/admin/partners', { brand: 'Maison Sans Facture' }), 201);
    const draft = await json<PartnerExperienceView>(operator.post(`/api/admin/partners/${bare.id}/experiences`, { title: 'Preview', eventOn: '2026-12-08', amountMinor: 50_000, currency: 'GBP' }), 201);
    const missing = await admin.post(`/api/admin/partner-experiences/${draft.id}/invoice`);
    expect([missing.statusCode, errorOf(missing).code]).toEqual([409, 'PARTNER_BILLING_MISSING']);
    expect((await json<PartnerExperienceView>(operator.post(`/api/admin/partner-experiences/${draft.id}/cancel`))).status).toBe('CANCELLED');

    // The month's documents, read by an AUDITOR; their PDFs and the CSV for the accountant.
    const month = await json<PartnerInvoiceList>(auditor.get('/api/admin/partner-invoices?month=2026-11'));
    expect(month.items.map((i) => [i.number, i.kind, i.totalMinor])).toEqual([
      ['P-2026-0001', 'INVOICE', 1_300_000],
      ['PC-2026-0001', 'CREDIT_NOTE', 1_300_000],
    ]);
    expect(month.totals).toEqual([{ currency: 'EUR', invoiced: 1_300_000, credited: 1_300_000, net: 0 }]);
    expect((await json<PartnerInvoiceList>(auditor.get('/api/admin/partner-invoices'))).month).toBe('2026-11');
    expect(errorOf(await auditor.get('/api/admin/partner-invoices?month=2026-13')).code).toBe('VALIDATION_FAILED');
    for (const doc of month.items) {
      const pdf = await auditor.get(`/api/admin/partner-invoices/${doc.id}/pdf`);
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['cache-control']).toBe('no-store');
      expect(pdf.headers['content-disposition']).toBe(`attachment; filename="ORBES-${doc.kind === 'INVOICE' ? 'invoice' : 'credit-note'}-${doc.number}.pdf"`);
      expect(pdf.rawPayload.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    }
    const csv = await auditor.get('/api/admin/partner-invoices.csv?month=2026-11');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-disposition']).toBe('attachment; filename="ORBES-partner-invoices-2026-11.csv"');
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(3);
    expect(errorOf(await auditor.get('/api/admin/partner-invoices.csv')).code).toBe('VALIDATION_FAILED');
    // The partner's page: its experiences with their numbers, invoiced and paid.
    const page = await json<PartnerDetail>(auditor.get(`/api/admin/partners/${partner.id}`));
    expect(page.experiences.map((e) => [e.title, e.status, e.invoice?.number ?? null, e.creditNote?.number ?? null, e.paidOn])).toEqual([['Dinner', 'CANCELLED', 'P-2026-0001', 'PC-2026-0001', '2026-11-02']]);
    expect(page.invoiced).toEqual([{ currency: 'EUR', amountMinor: 0 }]);
  });
});
