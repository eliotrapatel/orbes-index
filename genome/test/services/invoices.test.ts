/**
 * Invoices and credit notes (plan LIVE RELEASE+ of 2026-10-04, step S4: choices 21 and 22, M7), on the services as
 * createContext wires them:
 *
 *  - issued by CONGLOMERAT LLC (the legal notice's identity), in English, without VAT (the VAT fields kept, empty);
 *  - an invoice when an order is PAID (its price required), numbered in sequence per kind and year, from 1 each year,
 *    two orders paid at once never sharing a number; its lines (the piece, its size and where it was sold; each add-on
 *    as sold), its buyer (the name and address entered, the account's email), its totals;
 *  - a credit note when an order paid is cancelled (none before PAID) or returned: its invoice cancelled in full, once;
 *  - each journaled (`invoice.issue`, `invoice.credit`, replayed) and audited by ids, numbers and amounts, never the
 *    buyer's details;
 *  - a month's documents with their totals per currency, the month's CSV for the accountant (a credit note's amounts
 *    as issued, its kind saying they are credited; the VAT columns empty; the buyer as the caller reads it), each
 *    document's PDF, the account's own only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { INVOICE_ISSUER, invoiceNumber, monthRange } from '../../src/server/services/invoices.js';
import { readJournal, replayJournal } from '../../src/server/services/journal.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { LEGAL_IDENTITY } from '../../src/web/legal/content/notice.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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

describe('invoices and credit notes (plan LIVE RELEASE+, S4)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-03T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const orders = () => ctx.services.orders;
  const invoices = () => ctx.services.invoices;
  const invoiceRows = (orderId: string) => t.db.selectFrom('invoices').selectAll().where('order_id', '=', orderId).orderBy('issued_at').orderBy('kind', 'desc').execute();
  const auditsOf = (targetId: string) => t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', targetId).orderBy('id').execute();

  /** A private salon's order closed as ACCEPTED, priced when `priceMinor` is given, its buyer entered when `buyer` is. */
  async function salonOrder(o: { accountId?: string; priceMinor?: number; currency?: 'EUR' | 'GBP'; buyer?: { name: string; address: string } } = {}) {
    const accountId = o.accountId ?? (await createAccount(t.db)).id;
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    if (o.priceMinor !== undefined) await orders().setTerms(id, { sizeLabel: '58', priceMinor: o.priceMinor, currency: o.currency ?? 'EUR' }, admin);
    if (o.buyer) await orders().setBuyer(id, o.buyer, admin);
    return { id, accountId };
  }
  const pay = (id: string) => {
    clock.advance(MINUTE);
    return orders().transition(id, { to: 'PAID' }, admin);
  };

  it('are issued by CONGLOMERAT LLC as the legal notice names it, and numbered INV- or CN-, the year, six figures', () => {
    expect(INVOICE_ISSUER.name).toBe(LEGAL_IDENTITY.companyName);
    expect(INVOICE_ISSUER.address.join(', ')).toBe(LEGAL_IDENTITY.registeredOffice.en);
    expect([invoiceNumber('INVOICE', 2026, 1), invoiceNumber('CREDIT_NOTE', 2027, 123_456)]).toEqual(['INV-2026-000001', 'CN-2027-123456']);
    expect(monthRange('2026-12')).toEqual({ from: new Date('2026-12-01T00:00:00.000Z'), to: new Date('2027-01-01T00:00:00.000Z') });
    for (const bad of ['2026-13', '2026-1', '26-01', '', null]) expect(() => monthRange(bad)).toThrow(DomainError);
  });

  it('PAID issues the invoice: the piece and each add-on as sold, the buyer entered and the account\'s email, no VAT; a price first', async () => {
    const unpriced = await salonOrder();
    await rejects(pay(unpriced.id), 'ORDER_PRICE_MISSING', 409);
    expect(await invoiceRows(unpriced.id)).toEqual([]);

    // A LIVE RELEASE's piece with its add-ons, its buyer entered.
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, {
      opensAt,
      sizes: [{ label: '52', stock: 3 }],
      priceMinor: 480_000,
      addons: [
        { label: 'Engraving', priceMinor: 15_000 },
        { label: 'Gift box', priceMinor: 0 },
      ],
    });
    await t.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    const a = await createAccount(t.db);
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 1 }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    await f.live.setAddons(a.id, r.id, r.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const live = (await t.db.selectFrom('orders').select('id').where('account_id', '=', a.id).executeTakeFirstOrThrow()).id;
    await orders().setBuyer(live, { name: 'Ada Zurbaran-Quill', address: '12 rue Imaginaire\n75003 Paris' }, admin);
    const view = await pay(live);

    const [row] = await invoiceRows(live);
    expect(row).toMatchObject({
      kind: 'INVOICE',
      year: 2026,
      credits_invoice_id: null,
      issuer: { name: 'CONGLOMERAT LLC', address: ['30 N Gould St, Ste N', 'Sheridan, WY 82801', 'United States'] },
      buyer: { name: 'Ada Zurbaran-Quill', address: '12 rue Imaginaire\n75003 Paris', email: a.email },
      lines: [
        { kind: 'PIECE', label: 'MONOLITHE · SIZE 52', detail: 'LIVE RELEASE · MONOLITHE — LIVE', amountMinor: 480_000 },
        { kind: 'ADDON', label: 'Engraving', detail: null, amountMinor: 15_000 },
        { kind: 'ADDON', label: 'Gift box', detail: null, amountMinor: 0 },
      ],
      currency: 'EUR',
      subtotal_minor: 495_000,
      vat_rate_bp: null,
      vat_minor: null,
      total_minor: 495_000,
      issued_at: clock.now(),
    });
    expect(view.invoices).toEqual([{ id: row!.id, kind: 'INVOICE', number: invoiceNumber('INVOICE', 2026, row!.sequence), issuedAt: clock.now(), currency: 'EUR', totalMinor: 495_000 }]);
    // Audited and journaled by ids, numbers and amounts: never the buyer.
    const [audit] = await auditsOf(row!.id);
    expect(audit).toEqual({ action: 'invoice.issue', details: { orderId: live, number: invoiceNumber('INVOICE', 2026, row!.sequence), currency: 'EUR', totalMinor: 495_000 } });
    const journal = await t.db.selectFrom('event_journal').selectAll().where('entity_id', '=', row!.id).execute();
    expect(journal.map((j) => [j.type, j.entity_type])).toEqual([['invoice.issue', 'invoice']]);
    expect(journal[0]!.payload).toMatchObject({ id: row!.id, kind: 'INVOICE', orderId: live, totalMinor: 495_000, vatRateBp: null, vatMinor: null });
    const everything = JSON.stringify([await t.db.selectFrom('audit_logs').select('details').execute(), await t.db.selectFrom('event_journal').select('payload').execute()]);
    expect(everything).not.toContain('Zurbaran');
    expect(everything).not.toContain('Imaginaire');
    expect(everything).not.toContain(a.email);
    expect(replayJournal(await readJournal(t.db, { limit: 1000 })).invoices.get(row!.id)).toEqual(journal[0]!.payload);
    // Paid once: never a second invoice.
    await rejects(pay(live), 'ORDER_TRANSITION_NOT_ALLOWED', 409);
    expect(await invoiceRows(live)).toHaveLength(1);
  });

  it('numbers in sequence per kind and year, from 1 each year; orders paid at once never share a number', async () => {
    clock.set('2027-01-04T09:00:00.000Z');
    const many = await Promise.all(Array.from({ length: 6 }, () => salonOrder({ priceMinor: 300_000 })));
    await Promise.all(many.map((o) => orders().transition(o.id, { to: 'PAID' }, admin)));
    const seqs = (await t.db.selectFrom('invoices').select('sequence').where('kind', '=', 'INVOICE').where('year', '=', 2027).orderBy('sequence').execute()).map((r) => r.sequence);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    // A credit note starts its own sequence.
    clock.advance(MINUTE);
    await orders().transition(many[0]!.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    const [credit] = (await invoiceRows(many[0]!.id)).filter((i) => i.kind === 'CREDIT_NOTE');
    expect([credit!.year, credit!.sequence]).toEqual([2027, 1]);
  });

  it('a credit note cancels the invoice in full when an order paid is cancelled; none before PAID; once', async () => {
    clock.set('2027-02-01T09:00:00.000Z');
    const reserved = await salonOrder({ priceMinor: 120_000 });
    clock.advance(MINUTE);
    await orders().transition(reserved.id, { to: 'CANCELLED', note: 'Never paid.' }, admin);
    expect(await invoiceRows(reserved.id)).toEqual([]);

    const paid = await salonOrder({ priceMinor: 250_000, currency: 'GBP', buyer: { name: 'Jane Doe', address: '1 Bond St\nLondon' } });
    await pay(paid.id);
    clock.advance(MINUTE);
    const view = await orders().transition(paid.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    const [invoice, credit] = await invoiceRows(paid.id);
    expect(credit).toMatchObject({
      kind: 'CREDIT_NOTE',
      credits_invoice_id: invoice!.id,
      buyer: invoice!.buyer,
      lines: invoice!.lines,
      currency: 'GBP',
      subtotal_minor: 250_000,
      vat_rate_bp: null,
      vat_minor: null,
      total_minor: 250_000,
      issued_at: clock.now(),
    });
    expect(view.invoices.map((i) => i.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
    const [audit] = await auditsOf(credit!.id);
    expect(audit).toEqual({
      action: 'invoice.credit',
      details: { orderId: paid.id, number: invoiceNumber('CREDIT_NOTE', 2027, credit!.sequence), credits: invoiceNumber('INVOICE', 2027, invoice!.sequence), reason: 'cancel', currency: 'GBP', totalMinor: 250_000 },
    });
    // The journal says which invoice it cancels.
    expect((await t.db.selectFrom('event_journal').select('payload').where('entity_id', '=', credit!.id).executeTakeFirstOrThrow()).payload).toMatchObject({
      kind: 'CREDIT_NOTE',
      creditsInvoiceId: invoice!.id,
      credits: invoiceNumber('INVOICE', 2027, invoice!.sequence),
    });
  });

  it('a month\'s documents and their totals; the month\'s CSV for the accountant; each PDF; the account\'s own only', async () => {
    clock.set('2027-03-01T09:00:00.000Z');
    const one = await salonOrder({ priceMinor: 400_000, buyer: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' } });
    const two = await salonOrder({ priceMinor: 100_050 });
    await pay(one.id);
    await pay(two.id);
    clock.advance(MINUTE);
    await orders().transition(two.id, { to: 'CANCELLED', note: 'Withdrawn.' }, admin);
    // The next month: not in March.
    clock.set('2027-04-01T00:00:00.000Z');
    const april = await salonOrder({ priceMinor: 900_000 });
    await pay(april.id);

    const march = await invoices().list({ month: '2027-03' });
    expect(march.month).toBe('2027-03');
    expect(march.currentMonth).toBe('2027-04');
    expect(march.items.map((i) => [i.kind, i.order.id])).toEqual([
      ['CREDIT_NOTE', two.id],
      ['INVOICE', two.id],
      ['INVOICE', one.id],
    ]);
    expect(march.totals).toEqual([{ currency: 'EUR', invoiced: 500_050, credited: 100_050, net: 400_000 }]);
    const [credit, invoiceTwo] = march.items;
    expect(credit!.credits).toEqual({ id: invoiceTwo!.id, number: invoiceTwo!.number });
    expect(invoiceTwo!.creditedBy).toEqual({ id: credit!.id, number: credit!.number });
    expect((await invoices().list({ month: '2027-03', kind: 'INVOICE' })).items).toHaveLength(2);
    expect((await invoices().list({ month: '2027-03', q: credit!.order.reference.toLowerCase() })).items.map((i) => i.id)).toEqual([credit!.id, invoiceTwo!.id]);
    expect((await invoices().list({})).month).toBe('2027-04');
    await rejects(invoices().list({ month: '2027-3' }), 'VALIDATION_FAILED', 400);

    const csv = await invoices().csv('2027-03');
    expect(csv.filename).toBe('ORBES-invoices-2027-03.csv');
    expect(csv.contentType).toMatch(/^text\/csv/);
    const lines = csv.body.trimEnd().split('\r\n');
    expect(lines[0]).toBe('"number","kind","issued at","date","order","cancels","issuer","buyer name","buyer address","buyer email","lines","currency","subtotal","vat rate","vat","total"');
    expect(lines).toHaveLength(4);
    const [first, second, third] = lines.slice(1);
    expect(first).toContain(`"${march.items[2]!.number}","INVOICE","2027-03-01T09:`);
    expect(first).toContain('"Jane Doe","1 rue de la Paix\n75002 Paris"');
    expect(first).toContain('"EUR","4000.00","","","4000.00"');
    expect(second).toContain(`"${invoiceTwo!.number}","INVOICE"`);
    expect(third).toContain(`"${credit!.number}","CREDIT_NOTE"`);
    expect(third).toContain(`"${invoiceTwo!.number}","CONGLOMERAT LLC"`);
    // As issued: its kind says it is credited.
    expect(third).toContain('"EUR","1000.50","","","1000.50"');
    // As an AUDITOR reads it: the buyer masked.
    const masked = await invoices().csv('2027-03', (b) => ({ name: b.name ? 'J*** D***' : null, address: b.address ? '***' : null, email: b.email ? 'm***' : null }));
    expect(masked.body).not.toContain('Jane Doe');
    expect(masked.body).not.toContain('Paix');
    expect(masked.body).toContain('"J*** D***","***","m***"');

    const pdf = await invoices().pdf(credit!.id);
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.filename).toBe(`ORBES-credit-note-${credit!.number}.pdf`);
    expect(Buffer.from(pdf.body.slice(0, 5)).toString()).toBe('%PDF-');
    // Deterministic: the same document, the same bytes.
    expect(Buffer.from((await invoices().pdf(credit!.id)).body).equals(Buffer.from(pdf.body))).toBe(true);
    await rejects(invoices().pdf('5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6'), 'INVOICE_NOT_FOUND', 404);

    // The account's own documents only.
    expect((await invoices().accountDocument(one.accountId, one.id, 'INVOICE')).filename).toBe(`ORBES-invoice-${march.items[2]!.number}.pdf`);
    await rejects(invoices().accountDocument(one.accountId, one.id, 'CREDIT_NOTE'), 'INVOICE_NOT_FOUND', 404);
    await rejects(invoices().accountDocument(two.accountId, one.id, 'INVOICE'), 'INVOICE_NOT_FOUND', 404);
    expect((await invoices().accountDocument(two.accountId, two.id, 'CREDIT_NOTE')).filename).toBe(`ORBES-credit-note-${credit!.number}.pdf`);
  });

  it('the orders paid at boot get their invoices too (a LIVE resolution CONCLUDED, mapped to PAID by the system)', async () => {
    const o = await salonOrder({ priceMinor: 200_000 });
    await orders().transition(o.id, { to: 'PAID' }, SYSTEM_ACTOR);
    const [row] = await invoiceRows(o.id);
    expect(row!.kind).toBe('INVOICE');
    expect((await auditsOf(row!.id))[0]!.action).toBe('invoice.issue');
  });
});
