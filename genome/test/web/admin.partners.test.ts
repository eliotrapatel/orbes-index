/**
 * Club → Partners in the console (macro scope of 2026-10-20, K49 P1 to P4; lot M4 plan §2.3, step M4.7): the pure model
 * (src/web/admin/model/partners.ts) against the server's rules and words, the circle editor's PARTNER EXPERIENCE
 * (model/circle.ts), the routes and roles, and the API client's calls.
 *
 *  - The pages: #/club/partners, a partner's and an experience's, under Club in the sidebar; entered from the Circle tab.
 *  - A partner's and an experience's dialogs: what the server would refuse said first, only what changed sent, an
 *    experience's amount and currency changed while it is a DRAFT only.
 *  - Who may do what: OPERATOR records and sees the guests' names; ADMIN issues the invoice, records the payment and
 *    cancels an invoiced experience; an AUDITOR reads.
 *  - The words: ISSUE THE INVOICE's confirmation naming the number, the partner and the amount; the guests' line; the
 *    circle's « MAISON X · DINNER · 12 NOV »; Invoices' Partners switch; Growth's Partner experiences.
 */
import { describe, expect, it } from 'vitest';
import { PARTNER_LIMITS as SERVER_LIMITS, PARTNER_INVOICE_DIGITS, partnerInvoiceNumber } from '../../src/server/services/partners.js';
import { partnerIncomeOf, type PartnerIncomeRow as ServerIncomeRow } from '../../src/server/services/growth.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { circleChange, circleFormValues, circleInput } from '../../src/web/admin/model/circle.js';
import {
  amountsText,
  billingCountryOptions,
  billingLines,
  billingMissing,
  cancelText,
  contactLine,
  exactMoney,
  experienceActions,
  experienceChange,
  experienceFormValues,
  experienceInput,
  experienceLead,
  experienceOptionLabel,
  experienceProblem,
  guestsLine,
  invoiceIssuedTo,
  issueText,
  monthsOfYearSoFar,
  nextInvoiceNumber,
  paidOnProblem,
  partnerActions,
  partnerChange,
  partnerDocumentExperience,
  partnerExperienceOptions,
  partnerFormValues,
  partnerIncomeByPartner,
  partnerIncomeEmpty,
  partnerIncomeMonths,
  partnerIncomeTotals,
  partnerInput,
  partnerLinked,
  partnerProblem,
  partnerState,
  PARTNER_INCOME_EMPTY,
  PARTNER_LIMITS,
  PARTNERS_TEXT,
} from '../../src/web/admin/model/partners.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import type * as web from '../../src/web/admin/types.js';

/** The house's thin spaces read as plain ones. */
const plain = (s: string) => s.replace(/[   ]/g, ' ');
const ROLES = ['RETAIL', 'LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const;

const partner: web.PartnerDetail = {
  id: 'p1',
  brand: 'MAISON X',
  contact: { name: 'Claire Martin', email: 'claire@maison-x.test', phone: '+33 1 23 45 67 89' },
  billing: { name: 'Maison X SAS', address: '12 rue de la Paix\n75002 Paris', country: 'FR', companyNumber: '552 100 554' },
  note: null,
  active: true,
  experienceCount: 1,
  invoiced: [{ currency: 'EUR', amountMinor: 1_200_000 }],
  paid: [],
  createdAt: '2026-10-26T09:00:00.000Z',
  createdBy: null,
  updatedAt: '2026-10-26T09:00:00.000Z',
  experiences: [],
};

const experience: web.PartnerExperience = {
  id: 'e1',
  title: 'DINNER',
  eventOn: '2026-11-12',
  amountMinor: 1_200_000,
  currency: 'EUR',
  status: 'DRAFT',
  invoice: null,
  creditNote: null,
  paidOn: null,
  partner: { id: 'p1', brand: 'MAISON X', active: true },
  note: null,
  invoicedAt: null,
  paidRecordedAt: null,
  paidRecordedBy: null,
  cancelledAt: null,
  cancelledBy: null,
  invitations: [],
  createdAt: '2026-10-26T09:00:00.000Z',
  createdBy: null,
  updatedAt: '2026-10-26T09:00:00.000Z',
};

describe('Club → Partners: its pages and who reaches them', () => {
  it('has its own routes under Club, never read as a post, a drop or a release', () => {
    expect(href('clubPartners')).toBe('#/club/partners');
    expect(href('clubPartner', { partnerId: 'p1' })).toBe('#/club/partners/p1');
    expect(href('partnerExperience', { experienceId: 'e1' })).toBe('#/club/partner-experiences/e1');
    expect(parseHash('#/club/partners').name).toBe('clubPartners');
    expect(parseHash('#/club/partners/p1')).toMatchObject({ name: 'clubPartner', params: { partnerId: 'p1' } });
    expect(parseHash('#/club/partner-experiences/e1')).toMatchObject({ name: 'partnerExperience', params: { experienceId: 'e1' } });
    // The Club's own pages unchanged.
    expect(parseHash('#/club?tab=circle')).toMatchObject({ name: 'club', query: { tab: 'circle' } });
    expect(parseHash('#/club/circle/c1').name).toBe('circlePost');
    expect(parseHash('#/club/drops/d1').name).toBe('drop');
    expect(parseHash('#/club/live/d1').name).toBe('liveRelease');
  });

  it('lets an OPERATOR record and an ADMIN invoice, as the server does; an AUDITOR reads', () => {
    expect([CAPABILITY_MIN_ROLE.managePartners, CAPABILITY_MIN_ROLE.invoicePartners]).toEqual(['OPERATOR', 'ADMIN']);
    expect(ROLES.map((r) => can(r, 'managePartners'))).toEqual([false, false, false, true, true]);
    expect(ROLES.map((r) => can(r, 'invoicePartners'))).toEqual([false, false, false, false, true]);
    expect(partnerActions(partner, 'AUDITOR')).toEqual({ manage: false, newExperience: false });
    expect(partnerActions(partner, 'OPERATOR')).toEqual({ manage: true, newExperience: true });
    // A partner set aside takes no new experience (409 PARTNER_EXPERIENCE_STATE).
    expect(partnerActions({ active: false }, 'ADMIN')).toEqual({ manage: true, newExperience: false });
  });

  it('offers each step of an experience to the role the server lets take it', () => {
    const at = (status: web.PartnerExperienceStatus, role: web.AdminRole) => experienceActions({ status }, role);
    expect(at('DRAFT', 'AUDITOR')).toEqual({ edit: false, issue: false, pay: null, cancel: false, guests: false });
    expect(at('DRAFT', 'OPERATOR')).toEqual({ edit: true, issue: false, pay: null, cancel: true, guests: true });
    expect(at('DRAFT', 'ADMIN')).toEqual({ edit: true, issue: true, pay: null, cancel: true, guests: true });
    expect(at('INVOICED', 'OPERATOR')).toEqual({ edit: true, issue: false, pay: null, cancel: false, guests: true });
    expect(at('INVOICED', 'ADMIN')).toEqual({ edit: true, issue: false, pay: 'record', cancel: true, guests: true });
    expect(at('PAID', 'ADMIN')).toEqual({ edit: true, issue: false, pay: 'correct', cancel: true, guests: true });
    expect(at('CANCELLED', 'ADMIN')).toEqual({ edit: false, issue: false, pay: null, cancel: false, guests: true });
    expect([toneOf('partner', 'ACTIVE'), toneOf('partner', 'SET_ASIDE')]).toEqual(['solid', 'muted']);
    expect((['DRAFT', 'INVOICED', 'PAID', 'CANCELLED'] as const).map((s) => toneOf('partnerExperience', s))).toEqual(['outline', 'outline', 'solid', 'muted']);
    expect([partnerState({ active: true }).label, partnerState({ active: false }).label]).toEqual(['Active', 'Set aside']);
  });
});

describe('a partner\'s dialog (P1)', () => {
  it('holds the server\'s bounds', () => {
    expect(PARTNER_LIMITS).toEqual(SERVER_LIMITS);
  });

  it('says what the server would refuse before anything is sent', () => {
    const v = partnerFormValues(null);
    expect(partnerProblem(v)).toBe('Give the partner its brand.');
    expect(partnerProblem({ ...v, brand: 'x'.repeat(81) })).toBe('A brand has at most 80 characters.');
    expect(partnerProblem({ ...v, brand: 'MAISON X', contactEmail: 'claire' })).toBe('Enter a valid email address.');
    expect(partnerProblem({ ...v, brand: 'MAISON X', billingCountry: 'XX' })).toBe('Choose the billing country in the list.');
    expect(partnerProblem({ ...v, brand: 'MAISON X', billingAddress: 'a'.repeat(1001) })).toMatch(/^A billing address has at most 1.000 characters\.$/);
    expect(partnerProblem({ ...v, brand: 'MAISON X' })).toBeNull();
    expect(billingCountryOptions()[0]).toEqual({ value: '', label: 'Not set' });
    expect(billingCountryOptions().find((o) => o.value === 'FR')?.label).toBe('France');
  });

  it('sends a new partner\'s fields given only, then only what changed, a field emptied cleared', () => {
    expect(partnerInput({ ...partnerFormValues(null), brand: ' MAISON X ', contactEmail: ' claire@maison-x.test ', billingCountry: 'FR' })).toEqual({ brand: 'MAISON X', contactEmail: 'claire@maison-x.test', billingCountry: 'FR' });
    const v = partnerFormValues(partner);
    expect(v).toMatchObject({ brand: 'MAISON X', billingAddress: '12 rue de la Paix\n75002 Paris', billingCountry: 'FR' });
    expect(partnerChange(partner, v)).toEqual({});
    expect(partnerChange(partner, { ...v, contactPhone: ' ', note: 'Through Claire.' })).toEqual({ contactPhone: null, note: 'Through Claire.' });
    expect(partnerChange(partner, { ...v, brand: 'MAISON Y' })).toEqual({ brand: 'MAISON Y' });
  });

  it('writes the partner as the pages show it, and says what an invoice still needs', () => {
    expect(contactLine(partner)).toBe('Claire Martin · claire@maison-x.test · +33 1 23 45 67 89');
    expect(contactLine({ contact: { name: null, email: null, phone: null } })).toBe('—');
    expect(billingLines(partner)).toEqual(['Maison X SAS', '12 rue de la Paix', '75002 Paris', 'France', 'Company number 552 100 554']);
    expect(billingMissing(partner)).toEqual([]);
    expect(billingMissing({ billing: { name: 'Maison X SAS', address: null, country: null, companyNumber: null } })).toEqual(['billing address', 'billing country']);
    expect(plain(amountsText([{ currency: 'GBP', amountMinor: 300_000 }, { currency: 'EUR', amountMinor: 1_200_000 }]))).toBe('€ 12 000 · £ 3 000');
    expect(amountsText([])).toBe('—');
  });
});

describe('an experience (P1, P4)', () => {
  it('says what the server would refuse, the amount and currency asked of a DRAFT only', () => {
    const v = experienceFormValues(null);
    expect(v).toEqual({ title: '', eventOn: '', amount: '', currency: 'EUR', note: '' });
    expect(experienceProblem(v)).toBe('Give the experience its title.');
    expect(experienceProblem({ ...v, title: 'DINNER' })).toBe('Choose the event’s date (in Paris).');
    expect(experienceProblem({ ...v, title: 'DINNER', eventOn: '2026-02-30' })).toBe('Choose the event’s date (in Paris).');
    expect(experienceProblem({ ...v, title: 'DINNER', eventOn: '2026-11-12', amount: '0' })).toMatch(/^The amount is from 0\.01 to 1.000.000/);
    expect(experienceProblem({ ...v, title: 'DINNER', eventOn: '2026-11-12', amount: '1000000.01' })).toMatch(/^The amount is from/);
    expect(experienceProblem({ ...v, title: 'DINNER', eventOn: '2026-11-12', amount: '12 000' })).toBeNull();
    expect(experienceProblem({ ...v, title: 'DINNER', eventOn: '2026-11-12' }, { amount: false })).toBeNull();
    expect(experienceInput({ title: ' DINNER ', eventOn: '2026-11-12', amount: '12000.50', currency: 'GBP', note: '' })).toEqual({ title: 'DINNER', eventOn: '2026-11-12', amountMinor: 1_200_050, currency: 'GBP' });
  });

  it('changes only what changed, its amount and currency while it is a DRAFT only', () => {
    const v = experienceFormValues(experience);
    expect(v).toEqual({ title: 'DINNER', eventOn: '2026-11-12', amount: '12000', currency: 'EUR', note: '' });
    expect(experienceChange(experience, v)).toEqual({});
    expect(experienceChange(experience, { ...v, amount: '15000', currency: 'CHF', note: 'Champagne.' })).toEqual({ amountMinor: 1_500_000, currency: 'CHF', note: 'Champagne.' });
    expect(experienceChange({ ...experience, status: 'INVOICED' }, { ...v, amount: '15000', title: 'DINNER FOR TWELVE' })).toEqual({ title: 'DINNER FOR TWELVE' });
  });

  it('confirms ISSUE THE INVOICE naming its number, the partner and the amount, its number the next of the year\'s P- series', () => {
    expect(plain(issueText('P-2026-0001', 'MAISON X', 1_200_000, 'EUR'))).toBe('This issues invoice P-2026-0001 to MAISON X for € 12 000.00. An invoice is never changed.');
    expect(plain(issueText(null, 'MAISON X', 1_200_050, 'EUR'))).toBe('This issues the next partner invoice to MAISON X for € 12 000.50. An invoice is never changed.');
    expect(plain(exactMoney(800_000, 'GBP'))).toBe('£ 8 000.00');
    const doc = (kind: web.PartnerInvoiceKind, number: string) => ({ kind, number }) as web.PartnerInvoice;
    expect(nextInvoiceNumber([], 2026)).toBe('P-2026-0001');
    expect(nextInvoiceNumber([{ items: [doc('INVOICE', 'P-2026-0007'), doc('CREDIT_NOTE', 'PC-2026-0009'), doc('INVOICE', 'P-2025-0042')] }], 2026)).toBe('P-2026-0008');
    // The server's own numbering (P4): the same prefix, year and figures.
    expect(nextInvoiceNumber([], 2026)).toBe(partnerInvoiceNumber('INVOICE', 2026, 1));
    expect(PARTNER_INVOICE_DIGITS).toBe(4);
    expect(monthsOfYearSoFar(new Date('2026-03-15T12:00:00Z'))).toEqual(['2026-03', '2026-02', '2026-01']);
  });

  it('says each state, CANCEL\'s credit note and RECORD PAYMENT\'s Paris day', () => {
    expect(experienceLead(experience)).toBe('A draft: nothing is invoiced to MAISON X yet. An ADMIN issues its invoice.');
    const invoiced = { ...experience, status: 'INVOICED' as const, invoice: { id: 'i1', number: 'P-2026-0001', issuedAt: '2026-10-26T09:00:00.000Z' } };
    expect(experienceLead(invoiced)).toBe('Invoiced to MAISON X with P-2026-0001: waiting for the payment.');
    expect(experienceLead({ ...invoiced, status: 'PAID', paidOn: '2026-10-27' })).toBe('Paid by MAISON X on 27 OCT 2026 (Paris).');
    expect(experienceLead({ ...invoiced, status: 'CANCELLED', creditNote: { id: 'c1', number: 'PC-2026-0001', issuedAt: '2026-10-28T09:00:00.000Z' } })).toBe('Cancelled: PC-2026-0001 cancels P-2026-0001 in full.');
    expect(experienceLead({ ...experience, status: 'CANCELLED' })).toBe('Cancelled before it was invoiced.');
    expect(cancelText(experience)).toMatch(/^Nothing was invoiced/);
    expect(plain(cancelText(invoiced))).toBe('A credit note in the PC- series is issued at once to MAISON X, cancelling P-2026-0001 in full (€ 12 000.00). A credit note is never changed.');
    const now = new Date('2026-10-26T23:30:00Z'); // 27 October in Paris (UTC+1 since 25 October)
    expect(paidOnProblem('2026-10-27', now)).toBeNull();
    expect(paidOnProblem('2026-10-28', now)).toBe('The money cannot arrive after today.');
    expect(paidOnProblem('', now)).toBe('Choose the day the money arrived (in Paris).');
  });

  it('counts the guests, naming those who shared their name (P3)', () => {
    expect(guestsLine({ headcount: 18, sharedCount: 11 })).toBe('18 guests · 11 names shared');
    expect(guestsLine({ headcount: 1, sharedCount: 1 })).toBe('1 guest · 1 name shared');
    expect(guestsLine({ headcount: 0, sharedCount: 0 })).toBe('0 guests · 0 names shared');
    expect(PARTNERS_TEXT.guestsLead).toMatch(/the platform sends nothing to a partner/);
  });
});

describe('the circle editor\'s PARTNER EXPERIENCE (P2)', () => {
  const post: web.CirclePost = {
    id: 'c1',
    kind: 'INVITATION',
    title: 'Dinner',
    body: null,
    minTier: 3,
    experience: 'PARTNER_EXPERIENCE',
    eventAt: '2026-11-12T19:00:00.000Z',
    eventPlace: null,
    capacity: 20,
    pollOptions: null,
    drop: null,
    model: null,
    externalUrl: null,
    segment: null,
    partnerExperience: null,
    published: false,
    publishedAt: null,
    createdAt: '2026-10-26T09:00:00.000Z',
    createdBy: null,
    photos: [],
    answers: { YES: 0, NO: 0 },
    results: null,
  };
  const values = (p: web.CirclePost, extra: Record<string, string> = {}) => ({ ...circleFormValues(p.kind, p, new Date()), ...extra });

  it('names each experience « MAISON X · DINNER · 12 NOV », the soonest first, the cancelled ones out but the post\'s own', () => {
    expect(experienceOptionLabel('MAISON X', { title: 'DINNER', eventOn: '2026-11-12' })).toBe('MAISON X · DINNER · 12 NOV');
    const card = (id: string, title: string, eventOn: string, status: web.PartnerExperienceStatus) => ({ id, title, eventOn, status });
    const partners = [
      { brand: 'MAISON X', experiences: [card('e1', 'DINNER', '2026-11-12', 'DRAFT'), card('e2', 'LUNCH', '2026-12-01', 'CANCELLED')] },
      { brand: 'LUMEN Y', experiences: [card('e3', 'PREVIEW', '2026-11-05', 'PAID')] },
    ];
    expect(partnerExperienceOptions(partners, null)).toEqual([
      { value: '', label: 'None' },
      { value: 'e3', label: 'LUMEN Y · PREVIEW · 05 NOV' },
      { value: 'e1', label: 'MAISON X · DINNER · 12 NOV' },
    ]);
    const own = { id: 'e2', title: 'LUNCH', eventOn: '2026-12-01', status: 'CANCELLED' as const, partner: { id: 'p1', brand: 'MAISON X' } };
    expect(partnerExperienceOptions(partners, own).map((o) => o.label)).toEqual(['None', 'LUMEN Y · PREVIEW · 05 NOV', 'MAISON X · DINNER · 12 NOV', 'MAISON X · LUNCH · 01 DEC (cancelled)']);
    // Unread: None and the post's own.
    expect(partnerExperienceOptions([], own)).toEqual([{ value: '', label: 'None' }, { value: 'e2', label: 'MAISON X · LUNCH · 01 DEC (cancelled)' }]);
  });

  it('sends the link on an invitation of a partner experience only, and drops it when the experience changes', () => {
    expect(circleFormValues('INVITATION', null, new Date()).partnerExperienceId).toBe('');
    expect(circleInput('INVITATION', values(post, { partnerExperienceId: 'e1' }))).toMatchObject({ experience: 'PARTNER_EXPERIENCE', partnerExperienceId: 'e1' });
    expect(circleInput('INVITATION', values(post))).toMatchObject({ partnerExperienceId: null });
    expect(circleInput('INVITATION', values(post, { experience: 'MEMBERS_EVENING', partnerExperienceId: 'e1' }))).not.toHaveProperty('partnerExperienceId');
    expect(circleInput('INVITATION', values(post, { experience: '' }))).not.toHaveProperty('partnerExperienceId');
    expect(circleChange(post, values(post))).toEqual({});
    expect(circleChange(post, values(post, { partnerExperienceId: 'e1' }))).toEqual({ partnerExperienceId: 'e1' });
    const linked = { ...post, partnerExperience: { id: 'e1', title: 'DINNER', eventOn: '2026-11-12', status: 'DRAFT' as const, partner: { id: 'p1', brand: 'MAISON X' } } };
    expect(circleFormValues('INVITATION', linked, new Date()).partnerExperienceId).toBe('e1');
    expect(circleChange(linked, values(linked))).toEqual({});
    expect(circleChange(linked, values(linked, { partnerExperienceId: '' }))).toEqual({ partnerExperienceId: null });
    expect(circleChange(linked, values(linked, { experience: 'LAUNCH_PREVIEW' }))).toEqual({ experience: 'LAUNCH_PREVIEW', partnerExperienceId: null });
  });
});

describe('Invoices → Partners and Growth\'s Partner experiences', () => {
  it('reads the switch from the query, the collectors\' documents by default', () => {
    expect(invoiceIssuedTo({})).toBe('collectors');
    expect(invoiceIssuedTo({ to: 'partners' })).toBe('partners');
    expect(invoiceIssuedTo({ to: 'x' })).toBe('collectors');
    expect(parseHash('#/invoices?month=2026-10&to=partners')).toMatchObject({ name: 'invoices', query: { month: '2026-10', to: 'partners' } });
    const doc = { credits: { id: 'i1', number: 'P-2026-0001' }, creditedBy: null, experience: { id: 'e1', title: 'DINNER', eventOn: '2026-11-12' } };
    expect(partnerLinked(doc)).toBe('Cancels P-2026-0001');
    expect(partnerLinked({ credits: null, creditedBy: { id: 'c1', number: 'PC-2026-0001' } })).toBe('Cancelled by PC-2026-0001');
    expect(partnerDocumentExperience(doc)).toBe('DINNER · 12 NOV 2026');
  });

  it('writes GROWTH\'s partner income as the server sums it: each currency apart, months with income, each partner opening its page', () => {
    const rows: ServerIncomeRow[] = [
      { month: '2026-09', partnerId: 'p1', brand: 'MAISON X', currency: 'EUR', invoicedMinor: 1_200_000, creditedMinor: 0, paidMinor: 0 },
      { month: '2026-10', partnerId: 'p1', brand: 'MAISON X', currency: 'EUR', invoicedMinor: 0, creditedMinor: 200_000, paidMinor: 800_000 },
      { month: '2026-10', partnerId: 'p2', brand: 'LUMEN Y', currency: 'GBP', invoicedMinor: 300_000, creditedMinor: 0, paidMinor: 0 },
    ];
    const income = JSON.parse(JSON.stringify(partnerIncomeOf(rows, ['2026-08', '2026-09', '2026-10']))) as web.PartnerIncome;
    expect(partnerIncomeEmpty(income)).toBe(false);
    expect(partnerIncomeEmpty({ months: [], total: [], byPartner: [] })).toBe(true);
    expect(partnerIncomeEmpty(undefined)).toBe(true);
    expect(PARTNER_INCOME_EMPTY).toBe('No partner invoice in this window.');
    expect(partnerIncomeMonths(income).map((r) => [r.label, r.currency, plain(r.invoiced), plain(r.credited), plain(r.paid)])).toEqual([
      ['October 2026', 'EUR', '−€ 2 000', '€ 2 000', '€ 8 000'],
      ['October 2026', 'GBP', '£ 3 000', '£ 0', '£ 0'],
      ['September 2026', 'EUR', '€ 12 000', '€ 0', '€ 0'],
    ]);
    expect(partnerIncomeByPartner(income, (id) => href('clubPartner', { partnerId: id })).map((r) => [r.label, r.link, r.currency, plain(r.invoiced), plain(r.paid)])).toEqual([
      ['LUMEN Y', '#/club/partners/p2', 'GBP', '£ 3 000', '£ 0'],
      ['MAISON X', '#/club/partners/p1', 'EUR', '€ 10 000', '€ 8 000'],
    ]);
    expect(partnerIncomeTotals(income).map(plain)).toEqual(['€ 10 000 invoiced · € 8 000 paid', '£ 3 000 invoiced · £ 0 paid']);
  });
});

describe('the API client', () => {
  it('calls the partners\' routes with their methods and bodies, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.partners();
    await api.partner('p1');
    await api.partnerExperience('e1');
    await api.partnerGuests('e1');
    await api.partnerInvoices('2026-10');
    await api.createPartner({ brand: 'MAISON X' });
    await api.updatePartner('p1', { note: null });
    await api.setPartnerAside('p1');
    await api.reinstatePartner('p1');
    await api.createPartnerExperience('p1', { title: 'DINNER', eventOn: '2026-11-12', amountMinor: 1_200_000, currency: 'EUR' });
    await api.updatePartnerExperience('e1', { title: 'DINNER FOR TWELVE' });
    await api.issuePartnerInvoice('e1');
    await api.recordPartnerPayment('e1', '2026-10-27');
    await api.cancelPartnerExperience('e1');
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/partners',
      'GET /api/admin/partners/p1',
      'GET /api/admin/partner-experiences/e1',
      'GET /api/admin/partner-experiences/e1/guests',
      'GET /api/admin/partner-invoices?month=2026-10',
      'POST /api/admin/partners',
      'PATCH /api/admin/partners/p1',
      'POST /api/admin/partners/p1/set-aside',
      'POST /api/admin/partners/p1/reinstate',
      'POST /api/admin/partners/p1/experiences',
      'PATCH /api/admin/partner-experiences/e1',
      'POST /api/admin/partner-experiences/e1/invoice',
      'POST /api/admin/partner-experiences/e1/paid',
      'POST /api/admin/partner-experiences/e1/cancel',
    ]);
    const bodies = calls.slice(5).map((c) => JSON.parse(String(c.init.body)));
    expect(bodies).toEqual([
      { brand: 'MAISON X' },
      { note: null },
      {},
      {},
      { title: 'DINNER', eventOn: '2026-11-12', amountMinor: 1_200_000, currency: 'EUR' },
      { title: 'DINNER FOR TWELVE' },
      {},
      { paidOn: '2026-10-27' },
      {},
    ]);
    for (const c of calls.slice(5)) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });

  it('downloads the guest list, the month\'s partner CSV and a document\'s PDF as files', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      return new Response('x', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="f.csv"' } });
    };
    const api = new AdminApi({ fetch });
    await api.partnerGuestsCsv('e1');
    await api.partnerInvoicesCsv('2026-10');
    await api.partnerInvoicePdf('i1');
    expect(urls).toEqual(['/api/admin/partner-experiences/e1/guests.csv', '/api/admin/partner-invoices.csv?month=2026-10', '/api/admin/partner-invoices/i1/pdf']);
  });
});

describe('the words', () => {
  it('are calm: no atelier, handmade or craft, no exclamation mark', () => {
    const text = Object.values(PARTNERS_TEXT).join(' ');
    expect(text).not.toMatch(/atelier|handmade|craft|!/i);
  });
});
