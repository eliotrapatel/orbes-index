/**
 * Partner-paid experiences (macro scope K49 P1 to P4; lot M4 plan §2.2, §2.5, step M4.6; services/partners.ts), on the
 * services as createContext wires them:
 *
 *  - a partner's fields and bounds (the brand one line of 1 to 80, unique whatever the case: 409 PARTNER_BRAND_TAKEN;
 *    an email and a country checked), changed field by field and audited before and after, SET ASIDE and reinstated;
 *  - an experience's life: a DRAFT (its amount and currency changed while DRAFT only) → INVOICED (ISSUE THE INVOICE: 409
 *    PARTNER_BILLING_MISSING without the billing name, address and country) → PAID (its date the day the money arrived,
 *    never after today; corrected, audited with the previous date), or CANCELLED from each state (an OPERATOR a DRAFT
 *    only; an invoiced one by an ADMIN, with its PC- credit note); every other move 409 PARTNER_EXPERIENCE_STATE;
 *  - the P- and PC- series apart from INV- and CN- (a collector's invoice and a partner's the same day each start at 1),
 *    the year's restart, a document never changed (the trigger), its one line « Partner experience · <title> · <date> »,
 *    issued by CONGLOMERAT LLC to the partner's billing details, without VAT; the month's list, its totals and its CSV;
 *  - the guests: every YES across two invitations counted, a NO's tick cleared, a name shared once per account, an
 *    account without both names counted only, a locked account's shared name withheld (still counted), the test
 *    entrants left out; the guest list's CSV, audited by its counts;
 *  - the journal (`partner_invoice.issue`, `.credit`: never the buyer) and the audit (`partner.*`), never a guest's name;
 *  - two invoices issued at once take consecutive P- numbers: on PGlite always, on PostgreSQL in genome-ci
 *    (ORBES_TEST_POSTGRES_URL, a pool of 8: true parallelism).
 * The routes and roles are test/api/admin-partners.test.ts's; the circle's link and the RSVP's choice are
 * test/api/circle.test.ts's.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { INVOICE_ISSUER } from '../../src/server/services/invoices.js';
import { readJournal } from '../../src/server/services/journal.js';
import { experienceDate, partnerInvoiceNumber, type PartnerExperienceView } from '../../src/server/services/partners.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { createAccount, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

const BILLING = { billingName: 'Maison X SAS', billingAddress: '8 place Vendôme\n75001 Paris', billingCountry: 'fr', companyNumber: 'RCS Paris 123 456 789' };

describe('PartnerService (lot M4 plan §2.2, K49)', () => {
  let close: () => Promise<void>;
  let db: Db;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor & { id: string };
  let operator: Actor & { id: string };

  const partners = () => ctx.services.partners;
  const audits = (action: string, targetId?: string) =>
    db.selectFrom('audit_logs').select(['action', 'actor_id', 'details']).where('action', '=', action).$if(targetId !== undefined, (q) => q.where('target_id', '=', targetId!)).orderBy('id').execute();

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    clock = createManualClock('2026-11-03T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    close = async () => {
      await ctx.close();
      await t.close();
    };
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    const email = `partners-operator-${randomBytes(4).toString('hex')}@orbes.test`;
    operator = { type: 'admin', id: (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id };
  });
  afterAll(() => close?.());

  async function experienceOf(brand: string, o: { billing?: boolean; amountMinor?: number; currency?: string; title?: string; eventOn?: string } = {}): Promise<PartnerExperienceView> {
    const p = await partners().create({ brand, ...(o.billing === false ? {} : BILLING) }, operator);
    return partners().createExperience(p.id, { title: o.title ?? 'Dinner', eventOn: o.eventOn ?? '2026-11-12', amountMinor: o.amountMinor ?? 1_200_000, currency: o.currency ?? 'EUR' }, operator);
  }

  it('numbers its documents P- and PC-, the UTC year, four figures; an experience\'s date as its line says it', () => {
    expect([partnerInvoiceNumber('INVOICE', 2026, 1), partnerInvoiceNumber('CREDIT_NOTE', 2027, 42), partnerInvoiceNumber('INVOICE', 2026, 12_345)]).toEqual(['P-2026-0001', 'PC-2027-0042', 'P-2026-12345']);
    expect([experienceDate('2026-11-12'), experienceDate('2027-01-01')]).toEqual(['12 November 2026', '1 January 2027']);
  });

  it('records a partner: its fields and bounds, its brand unique whatever the case, changed field by field, set aside and reinstated, audited', async () => {
    const p = await partners().create({ brand: '  Maison   Lumière ', contactName: 'Ines Martel', contactEmail: 'ines@maison-lumiere.example', contactPhone: '+33 1 23 45 67 89', ...BILLING, note: 'First line\r\nSecond line' }, operator);
    expect(p).toMatchObject({
      brand: 'Maison Lumière',
      contact: { name: 'Ines Martel', email: 'ines@maison-lumiere.example', phone: '+33 1 23 45 67 89' },
      billing: { name: 'Maison X SAS', address: '8 place Vendôme\n75001 Paris', country: 'FR', companyNumber: 'RCS Paris 123 456 789' },
      note: 'First line\nSecond line',
      active: true,
      experienceCount: 0,
      invoiced: [],
      paid: [],
      createdBy: { id: operator.id },
      experiences: [],
    });
    // The audit log (permanent, read by an AUDITOR) says whether the contact's email and phone and a note are written.
    expect((await audits('partner.create', p.id))[0]!.details).toEqual({
      brand: 'Maison Lumière',
      contactName: 'Ines Martel',
      contactEmail: true,
      contactPhone: true,
      billingName: 'Maison X SAS',
      billingAddress: '8 place Vendôme\n75001 Paris',
      billingCountry: 'FR',
      companyNumber: 'RCS Paris 123 456 789',
      note: true,
    });
    // Its brand unique whatever the case; the bounds.
    await rejects(partners().create({ brand: 'MAISON LUMIÈRE' }, operator), 'PARTNER_BRAND_TAKEN', 409);
    for (const bad of [{ brand: '' }, { brand: 'x'.repeat(81) }, { brand: 'Bad\u0007bell' }, { brand: 'B', contactEmail: 'not-an-email' }, { brand: 'B', billingCountry: 'XX' }, { brand: 'B', note: 'n'.repeat(2001) }, { brand: 'B', companyNumber: 'c'.repeat(61) }]) {
      await rejects(partners().create(bad, operator), 'VALIDATION_FAILED', 400);
    }
    await rejects(partners().create({ brand: 'A collector' }, { type: 'account', id: p.id }), 'FORBIDDEN', 403);
    // One line: the breaks and runs of spaces a console field may carry are one space.
    expect((await partners().create({ brand: 'Deux\nLignes' }, operator)).brand).toBe('Deux Lignes');
    // Changed field by field: only what changes is written and audited; a field cleared.
    clock.advance(MINUTE);
    const changed = await partners().update(p.id, { contactPhone: null, contactName: 'Ines Martel', note: '' }, operator);
    expect(changed.contact.phone).toBeNull();
    expect(changed.note).toBeNull();
    expect((await audits('partner.update', p.id)).map((a) => a.details)).toEqual([{ before: { contactPhone: true, note: true }, after: { contactPhone: false, note: false } }]);
    await partners().update(p.id, { contactName: 'Ines Martel' }, operator);
    expect(await audits('partner.update', p.id)).toHaveLength(1);
    const other = await partners().create({ brand: 'Atelier Nord' }, operator);
    await rejects(partners().update(other.id, { brand: 'maison lumière' }, operator), 'PARTNER_BRAND_TAKEN', 409);
    await rejects(partners().get('00000000-0000-4000-8000-000000000000'), 'PARTNER_NOT_FOUND', 404);
    await rejects(partners().get('nope'), 'PARTNER_NOT_FOUND', 404);
    // SET ASIDE: offered for no new experience; reinstated.
    expect((await partners().setAside(other.id, operator)).active).toBe(false);
    await partners().setAside(other.id, operator);
    expect(await audits('partner.set_aside', other.id)).toHaveLength(1);
    await rejects(partners().createExperience(other.id, { title: 'Preview', eventOn: '2026-12-01', amountMinor: 100, currency: 'EUR' }, operator), 'PARTNER_EXPERIENCE_STATE', 409);
    expect((await partners().reinstate(other.id, operator)).active).toBe(true);
    expect(await audits('partner.reinstate', other.id)).toHaveLength(1);
    // The list: ACTIVE first, then by brand.
    await partners().setAside(other.id, operator);
    const list = await partners().list();
    expect(list.findIndex((x) => x.id === p.id)).toBeLessThan(list.findIndex((x) => x.id === other.id));
    await partners().reinstate(other.id, operator);
  });

  it('takes an experience from DRAFT to INVOICED to PAID: its amount while DRAFT only, its invoice in the P- series to the billing details, its payment and its correction', async () => {
    const bare = await experienceOf('Sans Facture', { billing: false });
    // Its fields and bounds.
    for (const bad of [{ title: '', eventOn: '2026-11-12', amountMinor: 100, currency: 'EUR' }, { title: 'T', eventOn: '2026-02-30', amountMinor: 100, currency: 'EUR' }, { title: 'T', eventOn: '2026-11-12', amountMinor: 0, currency: 'EUR' }, { title: 'T', eventOn: '2026-11-12', amountMinor: 1.5, currency: 'EUR' }, { title: 'T', eventOn: '2026-11-12', amountMinor: 100, currency: 'JPY' }]) {
      await rejects(partners().createExperience(bare.partner.id, bad, operator), 'VALIDATION_FAILED', 400);
    }
    // Billing missing: refused, nothing issued.
    await rejects(partners().issueInvoice(bare.id, admin), 'PARTNER_BILLING_MISSING', 409);
    expect(await db.selectFrom('partner_invoices').select('id').where('experience_id', '=', bare.id).execute()).toEqual([]);

    const e = await experienceOf('Maison Ombre', { title: 'Private dinner', amountMinor: 1_000_000 });
    expect(e).toMatchObject({ status: 'DRAFT', amountMinor: 1_000_000, currency: 'EUR', eventOn: '2026-11-12', invoice: null, creditNote: null, paidOn: null, invitations: [], partner: { brand: 'Maison Ombre', active: true } });
    // A DRAFT's amount and currency change; audited before and after.
    const draft = await partners().updateExperience(e.id, { amountMinor: 1_200_000, currency: 'GBP', title: 'Private dinner' }, operator);
    expect([draft.amountMinor, draft.currency]).toEqual([1_200_000, 'GBP']);
    expect((await audits('partner.experience.update', e.id)).map((a) => a.details)).toEqual([{ before: { amountMinor: 1_000_000, currency: 'EUR' }, after: { amountMinor: 1_200_000, currency: 'GBP' } }]);
    await partners().updateExperience(e.id, { currency: 'EUR' }, operator);

    // ISSUE THE INVOICE.
    clock.advance(HOUR);
    const invoiced = await partners().issueInvoice(e.id, admin);
    expect(invoiced).toMatchObject({ status: 'INVOICED', invoice: { number: 'P-2026-0001' }, invoicedAt: clock.now() });
    const [doc] = (await partners().invoices('2026-11')).items;
    expect(doc).toMatchObject({
      kind: 'INVOICE',
      number: 'P-2026-0001',
      issuedAt: clock.now(),
      experience: { id: e.id, title: 'Private dinner', eventOn: '2026-11-12' },
      partner: { brand: 'Maison Ombre' },
      credits: null,
      creditedBy: null,
      issuer: { name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] },
      buyer: { name: 'Maison X SAS', address: '8 place Vendôme\n75001 Paris', country: 'France', companyNumber: 'RCS Paris 123 456 789' },
      lines: [{ kind: 'PARTNER_EXPERIENCE', label: 'Partner experience · Private dinner · 12 November 2026', detail: null, amountMinor: 1_200_000 }],
      currency: 'EUR',
      totalMinor: 1_200_000,
    });
    // Its row as issued: no VAT anywhere.
    expect(Object.keys(await db.selectFrom('partner_invoices').selectAll().where('id', '=', doc!.id).executeTakeFirstOrThrow())).not.toContain('vat_minor');
    expect((await audits('partner.experience.invoice', e.id))[0]).toMatchObject({ actor_id: admin.id, details: { number: 'P-2026-0001', amountMinor: 1_200_000, currency: 'EUR' } });
    // Once invoiced: its amount and currency are its invoice's; a second invoice refused; the title still changes.
    await rejects(partners().updateExperience(e.id, { amountMinor: 5 }, operator), 'PARTNER_EXPERIENCE_STATE', 409);
    await rejects(partners().issueInvoice(e.id, admin), 'PARTNER_EXPERIENCE_STATE', 409);
    expect((await partners().updateExperience(e.id, { title: 'Private dinner, Paris' }, operator)).title).toBe('Private dinner, Paris');
    expect((await partners().invoice(doc!.id)).lines[0]!.label).toBe('Partner experience · Private dinner · 12 November 2026');
    // An issued document never changes (migration 0064's trigger).
    await expect(db.updateTable('partner_invoices').set({ total_minor: 1 }).where('id', '=', doc!.id).execute()).rejects.toThrow(/never changed/);
    await expect(db.deleteFrom('partner_invoices').where('id', '=', doc!.id).execute()).rejects.toThrow(/never changed/);

    // RECORD PAYMENT: never after today (Paris); a draft's payment refused.
    await rejects(partners().recordPaid(e.id, '2026-11-04', admin), 'VALIDATION_FAILED', 400);
    await rejects(partners().recordPaid(bare.id, '2026-11-01', admin), 'PARTNER_EXPERIENCE_STATE', 409);
    await rejects(partners().correctPaid(e.id, '2026-11-01', admin), 'PARTNER_EXPERIENCE_STATE', 409);
    const paid = await partners().recordPaid(e.id, '2026-11-02', admin);
    expect(paid).toMatchObject({ status: 'PAID', paidOn: '2026-11-02', paidRecordedAt: clock.now(), paidRecordedBy: { id: admin.id } });
    // Corrected, audited with the previous date; the same date again writes nothing.
    clock.advance(MINUTE);
    expect((await partners().correctPaid(e.id, '2026-11-03', admin)).paidOn).toBe('2026-11-03');
    await partners().recordPaid(e.id, '2026-11-03', admin);
    expect((await audits('partner.experience.paid', e.id)).map((a) => a.details)).toEqual([
      { paidOn: '2026-11-02', amountMinor: 1_200_000, currency: 'EUR' },
      { paidOn: '2026-11-03', previous: '2026-11-02', amountMinor: 1_200_000, currency: 'EUR' },
    ]);
    // The partner's figures: invoiced and paid, per currency.
    expect(await partners().get(e.partner.id)).toMatchObject({ experienceCount: 1, invoiced: [{ currency: 'EUR', amountMinor: 1_200_000 }], paid: [{ currency: 'EUR', amountMinor: 1_200_000 }] });
  });

  it('cancels an experience from each state: a DRAFT by an OPERATOR; an invoiced or paid one by an ADMIN only, with its PC- credit note in the same transaction', async () => {
    const draft = await experienceOf('Annulée Brouillon');
    const cancelled = await partners().cancel(draft.id, operator, { admin: false });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', creditNote: null, invoice: null, cancelledAt: clock.now(), cancelledBy: { id: operator.id } });
    await rejects(partners().cancel(draft.id, admin, { admin: true }), 'PARTNER_EXPERIENCE_STATE', 409);
    await rejects(partners().issueInvoice(draft.id, admin), 'PARTNER_EXPERIENCE_STATE', 409);
    await rejects(partners().updateExperience(draft.id, { title: 'Again' }, operator), 'PARTNER_EXPERIENCE_STATE', 409);

    const invoiced = await experienceOf('Annulée Facturée', { amountMinor: 50_000 });
    clock.advance(MINUTE);
    const number = (await partners().issueInvoice(invoiced.id, admin)).invoice!.number;
    // An OPERATOR cannot: its credit note is an ADMIN's.
    await rejects(partners().cancel(invoiced.id, operator, { admin: false }), 'FORBIDDEN', 403);
    clock.advance(MINUTE);
    const gone = await partners().cancel(invoiced.id, admin, { admin: true });
    expect(gone).toMatchObject({ status: 'CANCELLED', invoice: { number }, creditNote: { number: 'PC-2026-0001' } });
    const note = (await partners().invoices('2026-11')).items.find((i) => i.number === 'PC-2026-0001')!;
    expect(note).toMatchObject({ kind: 'CREDIT_NOTE', credits: { number }, totalMinor: 50_000, buyer: { name: 'Maison X SAS', country: 'France' } });
    expect((await partners().invoices('2026-11')).items.find((i) => i.number === number)!.creditedBy).toEqual({ id: note.id, number: 'PC-2026-0001' });
    expect((await audits('partner.experience.cancel', invoiced.id))[0]!.details).toEqual({ from: 'INVOICED', creditNoteId: note.id, creditNote: 'PC-2026-0001' });

    // A PAID one too: its payment date kept, its invoice credited.
    const paid = await experienceOf('Annulée Payée', { amountMinor: 70_000, currency: 'USD' });
    clock.advance(MINUTE);
    await partners().issueInvoice(paid.id, admin);
    await partners().recordPaid(paid.id, '2026-11-03', admin);
    clock.advance(MINUTE);
    expect(await partners().cancel(paid.id, admin, { admin: true })).toMatchObject({ status: 'CANCELLED', paidOn: '2026-11-03', creditNote: { number: 'PC-2026-0002' } });
    // The month's totals: a credit note counts against.
    const month = await partners().invoices('2026-11');
    expect(month.totals.find((t) => t.currency === 'USD')).toEqual({ currency: 'USD', invoiced: 70_000, credited: 70_000, net: 0 });
    // Its CSV for the accountant: every document, in order of issue, the VAT columns empty.
    const csv = await partners().invoicesCsv('2026-11');
    expect(csv.filename).toBe('ORBES-partner-invoices-2026-11.csv');
    const rows = csv.body.trim().split('\r\n');
    expect(rows[0]).toBe('"number","kind","issued at","date","partner","experience","cancels","issuer","buyer name","buyer address","buyer country","company number","lines","currency","vat rate","vat","total"');
    expect(rows.find((r) => r.startsWith('"PC-2026-0002"'))).toContain(`"P-2026-0003","CONGLOMERAT LLC","Maison X SAS"`);
    expect(rows.find((r) => r.startsWith('"PC-2026-0002"'))).toContain('"USD","","","700.00"');
  });

  it('keeps its own series apart from the collectors\' INV- and CN-: each starts at 1 the same day, and again each year', async () => {
    // A collector's order paid now: its invoice is INV-2026-000001, whatever the partners' numbers.
    const a = await createAccount(db);
    const request = await db.insertInto('shop_requests').values({ account_id: a.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const order = (await db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await ctx.services.orders.setTerms(order, { sizeLabel: '58', priceMinor: 300_000, currency: 'EUR' }, admin);
    clock.advance(MINUTE);
    await ctx.services.orders.transition(order, { to: 'PAID' }, admin);
    const collector = await db.selectFrom('invoices').select(['year', 'sequence']).where('order_id', '=', order).executeTakeFirstOrThrow();
    expect([collector.year, collector.sequence]).toEqual([2026, 1]);
    // The partners' series goes on from its own last number, the same day.
    const e = await experienceOf('Série Propre');
    const issued = await partners().issueInvoice(e.id, admin);
    expect(issued.invoice!.number).toMatch(/^P-2026-\d{4}$/);
    const before = Number(issued.invoice!.number.slice(-4));
    expect(before).toBeGreaterThan(1);
    // A new year: P-2027-0001.
    clock.set('2027-01-01T00:30:00.000Z');
    const next = await experienceOf('Nouvelle Année', { eventOn: '2027-02-01' });
    expect((await partners().issueInvoice(next.id, admin)).invoice!.number).toBe('P-2027-0001');
    expect((await partners().cancel(next.id, admin, { admin: true })).creditNote!.number).toBe('PC-2027-0001');
    clock.set('2026-11-03T12:00:00.000Z');
  });

  it('gives the experience\'s guests: every YES across its invitations, the names of those who shared them once each, an account without names counted only, a locked account counted without its name, the test entrants out; the guest list audited by its counts', async () => {
    const e = await experienceOf('Maison Invitée');
    clock.set('2026-11-04T09:00:00.000Z');
    const invitation = async (title: string) => {
      clock.advance(MINUTE);
      const post = await ctx.services.circle.create({ kind: 'INVITATION', title, eventAt: new Date(clock.now().getTime() + 48 * HOUR), experience: 'PARTNER_EXPERIENCE', partnerExperienceId: e.id }, admin);
      await ctx.services.circle.publish(post.id, admin);
      return post.id;
    };
    const first = await invitation('Dinner, first sitting');
    const second = await invitation('Dinner, second sitting');
    const guest = async (names: { first: string; last: string } | null) => {
      const a = await createAccount(db);
      await holdPieces(db, a.id, 10, f.modelId);
      if (names) await db.insertInto('account_profiles').values({ account_id: a.id, first_name: names.first, last_name: names.last }).execute();
      return a;
    };
    const camille = await guest({ first: 'Camille', last: 'Durand' });
    const alix = await guest({ first: 'Alix', last: 'Bernard' });
    const nameless = await guest(null);
    const changed = await guest({ first: 'Noé', last: 'Petit' });
    const entrant = await guest({ first: 'Test', last: 'Entrant' });
    const locked = await guest({ first: 'Romy', last: 'Lefèvre' });
    // A test entrant stands where its test row puts it (PALLADIUM here), never its pieces.
    await db.insertInto('test_entrants').values({ account_id: entrant.id, tier: 3 }).execute();
    const rsvp = (a: { id: string; actor: Actor }, post: string, answer: 'YES' | 'NO', shareName?: boolean) =>
      ctx.services.circle.rsvp(a.id, post, answer, a.actor, shareName === undefined ? {} : { shareName });
    await rsvp(camille, first, 'YES', true);
    await rsvp(camille, second, 'YES', true);
    await rsvp(alix, second, 'YES', true);
    await rsvp(nameless, first, 'YES');
    await rejects(rsvp(nameless, second, 'YES', true), 'CIRCLE_SHARE_NAME_MISSING', 409);
    await rsvp(changed, first, 'YES', true);
    await rsvp(changed, first, 'NO');
    await rsvp(entrant, first, 'YES', true);
    // Shared, then locked (a takeover, THREAT-MODEL U): its holder can no longer untick, so the name stays with ORBES.
    await rsvp(locked, second, 'YES', true);
    await ctx.services.owners.lock(locked.id, admin);
    // A NO with a tick is impossible: the NO cleared it.
    expect((await db.selectFrom('circle_rsvps').select(['answer', 'share_name', 'share_name_at']).where('account_id', '=', changed.id).executeTakeFirstOrThrow())).toEqual({ answer: 'NO', share_name: false, share_name_at: null });

    const g = await partners().guests(e.id);
    // YES: Camille twice (two sittings), Alix, the account without names, the locked one (counted, its name not given);
    // not the NO, not the test entrant.
    expect(g).toEqual({ experienceId: e.id, headcount: 5, sharedCount: 2, shared: [{ firstName: 'Alix', lastName: 'Bernard' }, { firstName: 'Camille', lastName: 'Durand' }] });
    // The experience's page lists its invitations with their YES and places.
    expect((await partners().experience(e.id)).invitations.map((i) => [i.title, i.yes, i.minTier, i.published])).toEqual([
      ['Dinner, first sitting', 3, 3, true],
      ['Dinner, second sitting', 3, 3, true],
    ]);
    // The list ORBES sends: the headcount line, then the names; audited by its counts, never a name.
    const csv = await partners().guestsCsv(e.id, operator);
    expect(csv.filename).toBe('ORBES-guests-2026-11-12.csv');
    expect(csv.body).toBe('"guests","5"\r\n"first name","last name"\r\n"Alix","Bernard"\r\n"Camille","Durand"\r\n');
    const exported = await audits('partner.guests.export', e.id);
    expect(exported.map((a) => a.details)).toEqual([{ headcount: 5, names: 2 }]);
    expect(JSON.stringify(await db.selectFrom('audit_logs').select('details').where('action', 'like', 'partner.%').execute())).not.toMatch(/Camille|Durand|Bernard|Romy|Lefèvre/);
    await rejects(partners().guests('00000000-0000-4000-8000-000000000000'), 'PARTNER_EXPERIENCE_NOT_FOUND', 404);
  });

  it('journals each document without its buyer (partner_invoice.issue, .credit), as the collectors\' invoices are', async () => {
    const entries = (await readJournal(db)).filter((x) => x.entityType === 'partner_invoice');
    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(new Set(entries.map((x) => x.type))).toEqual(new Set(['partner_invoice.issue', 'partner_invoice.credit']));
    for (const x of entries) {
      expect(Object.keys(x.payload).sort()).toEqual(['credits', 'creditsInvoiceId', 'currency', 'experienceId', 'id', 'issuedAt', 'issuer', 'kind', 'lines', 'number', 'partnerId', 'totalMinor']);
      expect(JSON.stringify(x.payload)).not.toMatch(/Maison X SAS|Vendôme|RCS Paris/);
    }
    const credit = entries.find((x) => x.type === 'partner_invoice.credit')!;
    expect(credit.payload).toMatchObject({ kind: 'CREDIT_NOTE', credits: expect.stringMatching(/^P-20\d{2}-\d{4}$/) });
  });

  it('renders a document\'s PDF in its own series, the partner as buyer', async () => {
    const [doc] = (await partners().invoices('2026-11')).items;
    const pdf = await partners().invoicePdf(doc!.id);
    expect(pdf.filename).toBe(`ORBES-invoice-${doc!.number}.pdf`);
    expect(Buffer.from(pdf.body).toString('latin1')).toContain(`(ORBES INVOICE ${doc!.number})`);
    await rejects(partners().invoicePdf('00000000-0000-4000-8000-000000000000'), 'PARTNER_INVOICE_NOT_FOUND', 404);
  });
});

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const root = createDb(adminUrl!);
      const name = `orbes_partners_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(root);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(root);
          await closeDb(root);
        },
      };
    },
  },
];

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`PartnerService on ${backend.name}`, () => {
    it('two partner invoices issued at once take consecutive P- numbers', async () => {
      const { db, close } = await backend.open();
      const clock = createManualClock('2026-11-05T10:00:00.000Z');
      const ctx = await createContext(testConfig(), { db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
      try {
        const email = `partners-race-${randomBytes(4).toString('hex')}@orbes.test`;
        const admin: Actor = { type: 'admin', id: (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id };
        const ids: string[] = [];
        for (let i = 0; i < 6; i++) {
          const p = await ctx.services.partners.create({ brand: `Race ${i}`, ...BILLING }, admin);
          ids.push((await ctx.services.partners.createExperience(p.id, { title: 'Race', eventOn: '2026-12-01', amountMinor: 1000 + i, currency: 'EUR' }, admin)).id);
        }
        const issued = await Promise.all(ids.map((id) => ctx.services.partners.issueInvoice(id, admin)));
        expect(issued.map((e) => e.invoice!.number).sort()).toEqual(['P-2026-0001', 'P-2026-0002', 'P-2026-0003', 'P-2026-0004', 'P-2026-0005', 'P-2026-0006']);
        // The numbers and the times of issue rise together.
        const rows = await db.selectFrom('partner_invoices').select(['sequence', 'issued_at']).orderBy('sequence').execute();
        for (let i = 1; i < rows.length; i++) expect(rows[i]!.issued_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1]!.issued_at.getTime());
      } finally {
        await ctx.close();
        await close();
      }
    }, 60_000);
  });
}
