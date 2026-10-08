/**
 * Invoices and credit notes (plan LIVE RELEASE+ of 2026-10-04, step S4: choices 21 and 22, M7), on the services as
 * createContext wires them:
 *
 *  - issued by CONGLOMERAT LLC (the legal notice's identity), in English, without VAT (the VAT fields kept, empty);
 *  - an invoice when an order is PAID (its price required), numbered in sequence per kind and year, from 1 each year,
 *    two orders paid at once never sharing a number; its lines (the piece, its size and where it was sold; each add-on
 *    as sold), its buyer (the name and address entered, the account's email), its totals;
 *  - a credit note when an order paid is cancelled (none before PAID) or returned: its invoice cancelled in full, once;
 *  - (plan NEXT LOT §3.6.C) an engraving added after PAID: a supplementary invoice; removed after PAID: a credit note for
 *    its one line; a cancellation then credits each invoice for what remains, never a line twice; one main invoice per
 *    order, one credit note in full per invoice; each listed in MY PIECES and read by its number;
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
import { INVOICE_ISSUER, INVOICE_LINE_KINDS, invoiceNumber, linesOf, monthRange } from '../../src/server/services/invoices.js';
import { isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { readJournal, replayJournal } from '../../src/server/services/journal.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { LEGAL_IDENTITY } from '../../src/web/legal/content/notice.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

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
  const orderRowOf = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
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
    // An order whose clock reads earlier than the last invoice's (its transaction took the number after it) is dated
    // with that invoice: the numbers and the dates rise together.
    const early = await salonOrder({ priceMinor: 300_000 });
    clock.advance(60 * MINUTE);
    const later = await salonOrder({ priceMinor: 300_000 });
    await orders().transition(later.id, { to: 'PAID' }, admin);
    const ahead = clock.now();
    clock.set(new Date(ahead.getTime() - 30 * MINUTE));
    await orders().transition(early.id, { to: 'PAID' }, admin);
    const [laterInvoice] = await invoiceRows(later.id);
    const [earlyInvoice] = await invoiceRows(early.id);
    expect([earlyInvoice!.sequence, earlyInvoice!.issued_at]).toEqual([laterInvoice!.sequence + 1, ahead]);
    expect((await orderRowOf(early.id)).paid_at).toEqual(new Date(ahead.getTime() - 30 * MINUTE));
    clock.set(new Date(ahead.getTime() + MINUTE));
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
    // The month's totals stay the whole month's, whatever the kind and the search keep.
    const credits = await invoices().list({ month: '2027-03', kind: 'CREDIT_NOTE' });
    expect(credits.items.map((i) => i.id)).toEqual([credit!.id]);
    expect(credits.totals).toEqual(march.totals);
    expect((await invoices().list({ month: '2027-03', q: march.items[2]!.order.reference })).totals).toEqual(march.totals);
    // A number in part, the credit note found by the invoice it cancels; nothing for a search matching none.
    expect((await invoices().list({ month: '2027-03', q: invoiceTwo!.number })).items.map((i) => i.id)).toEqual([credit!.id, invoiceTwo!.id]);
    expect((await invoices().list({ month: '2027-03', q: credit!.number.slice(0, 7).toLowerCase() })).items.map((i) => i.id)).toEqual([credit!.id]);
    expect((await invoices().list({ month: '2027-03', q: '%' })).items).toEqual([]);
    expect((await invoices().list({ month: '2027-03', q: 'INV_2027' })).items).toEqual([]);
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

  it('an engraving after PAID (plan NEXT LOT §3.6.C): a supplementary invoice, a credit note for its one line, and at a cancellation each invoice credited for what remains, never a line twice', async () => {
    await ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: 3_000, GBP: null, USD: null, CHF: null } }, admin);
    const { id, accountId } = await salonOrder({ priceMinor: 420_000, buyer: { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris' } });
    const collector: Actor = { type: 'account', id: accountId };
    // Before PAID: its line on the order's invoice.
    await orders().setEngraving(accountId, id, 'A. M.', collector);
    await pay(id);
    const [main] = await invoiceRows(id);
    expect(linesOf(main!.lines as unknown[]).map((l) => [l.kind, l.label, l.amountMinor])).toEqual([
      ['PIECE', 'MONOLITHE · SIZE 58', 420_000],
      ['ENGRAVING', 'Engraving', 3_000],
    ]);
    expect(main!.total_minor).toBe(423_000);
    expect(JSON.stringify(main!.lines)).not.toContain('A. M.');
    // Removed after PAID: a credit note for that one line, on the order's invoice.
    clock.advance(MINUTE);
    await orders().setEngraving(accountId, id, null, collector);
    // Added again (the price now € 40): a supplementary invoice of one line, billed as the order's invoice was.
    await ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: 4_000, GBP: null, USD: null, CHF: null } }, admin);
    clock.advance(MINUTE);
    await orders().setEngraving(accountId, id, 'A. & M.', collector);
    // Its words changed: no document.
    clock.advance(MINUTE);
    await orders().setEngraving(accountId, id, 'A. M. 2026', collector);
    const docs = await invoiceRows(id);
    expect(docs.map((d) => [d.kind, d.credit_scope, d.total_minor])).toEqual([
      ['INVOICE', null, 423_000],
      ['CREDIT_NOTE', 'LINES', 3_000],
      ['INVOICE', null, 4_000],
    ]);
    const [, lineCredit, supplement] = docs;
    expect(lineCredit!.credits_invoice_id).toBe(main!.id);
    expect(linesOf(lineCredit!.lines as unknown[])).toEqual([{ kind: 'ENGRAVING', label: 'Engraving', detail: null, amountMinor: 3_000 }]);
    expect(supplement!.supplements_invoice_id).toBe(main!.id);
    expect(supplement!.buyer).toEqual(main!.buyer);
    expect(linesOf(supplement!.lines as unknown[])).toEqual([{ kind: 'ENGRAVING', label: 'Engraving', detail: null, amountMinor: 4_000 }]);
    // Audited and journaled as invoices are, with what each supplements or credits.
    const issued = (await t.db.selectFrom('audit_logs').select('details').where('action', 'in', ['invoice.issue', 'invoice.credit']).where('target_id', 'in', [lineCredit!.id, supplement!.id]).execute()).map((x) => x.details);
    expect(issued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: id, credits: invoiceNumber('INVOICE', main!.year, main!.sequence), reason: 'engraving', scope: 'LINES', totalMinor: 3_000 }),
        expect.objectContaining({ orderId: id, supplements: invoiceNumber('INVOICE', main!.year, main!.sequence), totalMinor: 4_000 }),
      ]),
    );
    // MY PIECES: the order's invoice, and the others by their number, each its PDF.
    const mine = (await orders().forAccount(accountId)).find((o) => o.id === id)!;
    expect(mine.documents.invoice!.number).toBe(invoiceNumber('INVOICE', main!.year, main!.sequence));
    expect(mine.documents.others.map((d) => [d.kind, d.number])).toEqual([
      ['CREDIT_NOTE', invoiceNumber('CREDIT_NOTE', lineCredit!.year, lineCredit!.sequence)],
      ['INVOICE', invoiceNumber('INVOICE', supplement!.year, supplement!.sequence)],
    ]);
    for (const d of mine.documents.others) expect((await invoices().accountDocumentByNumber(accountId, id, d.number)).body.length).toBeGreaterThan(0);
    await rejects(invoices().accountDocumentByNumber((await createAccount(t.db)).id, id, mine.documents.others[0]!.number), 'INVOICE_NOT_FOUND', 404);
    await rejects(invoices().accountDocumentByNumber(accountId, id, 'INV-2026-999999'), 'INVOICE_NOT_FOUND', 404);
    // The PDFs say what each is.
    expect((await invoices().pdf(supplement!.id)).filename).toMatch(/^ORBES-invoice-INV-/);
    expect((await invoices().pdf(lineCredit!.id)).filename).toMatch(/^ORBES-credit-note-CN-/);
    // The database keeps one main invoice per order and one credit note in full per invoice.
    await expect(
      t.db.insertInto('invoices').values({ kind: 'INVOICE', year: 2026, sequence: 999_001, order_id: id, issuer: '{}', buyer: '{}', lines: '[{"kind":"PIECE","label":"X","amountMinor":0}]', currency: 'EUR', subtotal_minor: 0, total_minor: 0 }).execute(),
    ).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_one_per_order'));
    // Cancelled: each invoice credited for what remains (the order's, without its engraving; the supplementary one whole).
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    const after = await invoiceRows(id);
    const full = after.filter((d) => d.credit_scope === 'FULL');
    expect(full.map((d) => [d.credits_invoice_id, d.total_minor])).toEqual([
      [main!.id, 420_000],
      [supplement!.id, 4_000],
    ]);
    expect(linesOf(full[0]!.lines as unknown[]).map((l) => l.kind)).toEqual(['PIECE']);
    // Everything invoiced is credited once: 423 000 + 4 000 = 3 000 + 420 000 + 4 000.
    const total = (k: 'INVOICE' | 'CREDIT_NOTE') => after.filter((d) => d.kind === k).reduce((n, d) => n + d.total_minor, 0);
    expect(total('INVOICE')).toBe(total('CREDIT_NOTE'));
    // MY PIECES: the credit note of the order's invoice, the others listed.
    const cancelled = (await orders().forAccount(accountId)).find((o) => o.id === id)!;
    expect(cancelled.documents.creditNote!.number).toBe(invoiceNumber('CREDIT_NOTE', full[0]!.year, full[0]!.sequence));
    expect(cancelled.documents.others).toHaveLength(3);
    // The credit note of what remains says so; its PDF is drawn.
    const view = await invoices().get(full[0]!.id);
    expect(view).toMatchObject({ scope: 'FULL', remains: true, credits: { id: main!.id } });
    expect((await invoices().get(main!.id)).creditedBy!.id).toBe(full[0]!.id);
    expect((await invoices().get(lineCredit!.id))).toMatchObject({ scope: 'LINES', remains: false });
    expect((await invoices().pdf(full[0]!.id)).body.length).toBeGreaterThan(0);
    // The journal replays them.
    const journal = await t.db.selectFrom('event_journal').select(['type', 'entity_id']).where('entity_type', '=', 'invoice').where('entity_id', 'in', [lineCredit!.id, supplement!.id, ...full.map((d) => d.id)]).execute();
    expect(journal.map((j) => j.type).sort()).toEqual(['invoice.credit', 'invoice.credit', 'invoice.credit', 'invoice.issue']);
    await ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: null, GBP: null, USD: null, CHF: null } }, admin);
  });

  it('reads every line back with its own kind (plan NEXT-NINE, BP-19): SHIPPING, CREDIT and GIFT beside PIECE and ADDON, on the invoice, its credit note and MY PIECES\' documents; an old invoice unchanged', () => {
    // Plan NEXT LOT §3.6.C: and an engraving priced from the settings.
    expect([...INVOICE_LINE_KINDS]).toEqual(['PIECE', 'ADDON', 'SHIPPING', 'CREDIT', 'GIFT', 'ENGRAVING']);
    const issued = [
      { kind: 'PIECE', label: 'MONOLITHE · SIZE 52', detail: 'DRAW · THE OCTOBER DRAW', amountMinor: 420_000 },
      { kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: 'FREE · PLATINE', amountMinor: 0 },
      { kind: 'CREDIT', label: 'CREDIT · PLATINE', detail: null, amountMinor: -5_000 },
      { kind: 'GIFT', label: 'WELCOME GIFT · ECLIPSE', detail: 'ORDER OR-1A2B3C4D', amountMinor: 0 },
    ];
    expect(linesOf(JSON.parse(JSON.stringify(issued)))).toEqual(issued);
    // An invoice issued before: its PIECE and ADDON lines read as they were; an unknown kind stays a PIECE.
    expect(linesOf([{ kind: 'PIECE', label: 'A', detail: null, amountMinor: 1 }, { kind: 'ADDON', label: 'B', detail: null, amountMinor: 2 }, { kind: 'BONUS', label: 'C', detail: null, amountMinor: 3 }])).toEqual([
      { kind: 'PIECE', label: 'A', detail: null, amountMinor: 1 },
      { kind: 'ADDON', label: 'B', detail: null, amountMinor: 2 },
      { kind: 'PIECE', label: 'C', detail: null, amountMinor: 3 },
    ]);
  });

  it('carries the SHIPPING line on the invoice, its credit note and the account\'s PDFs, read back with its kind (BP-19 T4)', async () => {
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, 5, f.modelId);
    const { id } = await salonOrder({ accountId: a.id, priceMinor: 300_000, buyer: { name: 'Jane Doe', address: '1 rue de Paris\n75001 Paris' } });
    await pay(id);
    const shipping = { kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: 'FREE · PLATINE', amountMinor: 0 };
    const [invoice] = await invoiceRows(id);
    expect(invoice!.lines).toEqual([{ kind: 'PIECE', label: 'MONOLITHE · SIZE 58', detail: 'THE PRIVATE SALON', amountMinor: 300_000 }, shipping]);
    expect((await invoices().get(invoice!.id)).lines[1]).toEqual(shipping);
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    const [, credit] = await invoiceRows(id);
    expect(credit!.kind).toBe('CREDIT_NOTE');
    expect((await invoices().get(credit!.id)).lines).toEqual((await invoices().get(invoice!.id)).lines);
    // MY PIECES' documents: both PDFs, their account's own.
    for (const kind of ['INVOICE', 'CREDIT_NOTE'] as const) {
      const pdf = await invoices().accountDocument(a.id, id, kind);
      expect(pdf.contentType).toBe('application/pdf');
      expect(new TextDecoder().decode(pdf.body.slice(0, 8))).toBe('%PDF-1.4');
    }
    // The right of access exports them as issued.
    const exported = (await ctx.services.owners.exportData(a.id, admin)).orders.find((o) => o.invoices.length === 2)!;
    expect(exported.invoices[0]!.lines[1]).toEqual({ label: 'SHIPPING · STANDARD', detail: 'FREE · PLATINE', amountMinor: 0 });
    expect(exported.shipping).toEqual({ service: 'STANDARD', minor: 0, benefit: 2 });
  });

  it('the orders paid at boot get their invoices too (a LIVE resolution CONCLUDED, mapped to PAID by the system)', async () => {
    const o = await salonOrder({ priceMinor: 200_000 });
    await orders().transition(o.id, { to: 'PAID' }, SYSTEM_ACTOR);
    const [row] = await invoiceRows(o.id);
    expect(row!.kind).toBe('INVOICE');
    expect((await auditsOf(row!.id))[0]!.action).toBe('invoice.issue');
  });
});
