/**
 * MY PIECES: an order's documents over HTTP (plan LIVE RELEASE+, step S4: choice 21, M6), with real sessions:
 *
 *  - GET /api/v1/account/orders lists each order's documents: its invoice once PAID, its credit note once cancelled
 *    after PAID or returned, the care guide while the piece is on its way or kept, the ownership certificate once the
 *    piece is registered to the account;
 *  - GET /api/v1/account/orders/:id/invoice.pdf, /credit-note.pdf and /certificate.pdf: PDFs, attachments never stored;
 *    the ownership certificate a new document (the record as read now, naming the order), never the claim card: 409
 *    before the piece is registered to the account and after it is returned;
 *  - GET /api/v1/account/orders/:id/care-guide: the model's care guide, else its care instructions, else none (the
 *    house's general care text, in the app);
 *  - an account session only (401), the account's own orders only (404 for another's, as for an unknown one).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { liveFixtureOn, type LiveFixture } from '../support/live.js';
import { countPiecesIn, packAndShip } from '../support/fulfil.js';
import { accountClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

type Json = Record<string, any>;
const MINUTE = 60_000;

describe('MY PIECES: an order\'s documents', () => {
  let h: Harness;
  let f: LiveFixture;
  let mine: Client;
  let mineId: string;
  let other: Client;
  let colissimo: string;
  let france: string;
  /** Delivered and registered; paid then cancelled; reserved. */
  let delivered: string;
  let cancelled: string;
  let reserved: string;
  let piece: Awaited<ReturnType<Harness['ctx']['services']['issuance']['issueProduct']>>;

  const orders = () => h.ctx.services.orders;
  const listed = async (c: Client) => new Map(((safeJson(await c.get('/api/v1/account/orders')) as { orders: Json[] }).orders).map((o) => [o.id, o]));

  async function salonOrder(account: string, size: string, priceMinor: number): Promise<string> {
    h.clock.advance(MINUTE);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    const id = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: size, priceMinor, currency: 'EUR' }, f.admin);
    return id;
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-11T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    colissimo = (await h.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    france = (await h.ctx.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    const a = await accountClient(h);
    mine = a.client;
    mineId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', a.email).executeTakeFirstOrThrow()).id;
    other = (await accountClient(h)).client;

    // Delivered: a piece in stock, paid, packed and shipped through the agent's steps (its card scanned binds it).
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '57'));
    piece = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '57', material: '925 STERLING SILVER', withClaimSecret: true }, f.admin);
    await countPiecesIn(h.ctx, { skuId: sku, locationId: france, productRefs: [piece.product.productId] }, f.admin);
    delivered = await salonOrder(mineId, '57', 480_000);
    h.clock.advance(MINUTE);
    await orders().transition(delivered, { to: 'PAID' }, f.admin);
    h.clock.advance(MINUTE);
    await packAndShip(h.ctx, delivered, { carrierId: colissimo, trackingNumber: '6A12345678901', pieces: { [delivered]: piece.product.productId } }, f.admin);

    cancelled = await salonOrder(mineId, '58', 300_000);
    await orders().transition(cancelled, { to: 'PAID' }, f.admin);
    h.clock.advance(MINUTE);
    await orders().transition(cancelled, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin);

    reserved = await salonOrder(mineId, '59', 200_000);
  }, 120_000);
  afterAll(() => h?.close());

  it('needs an account session for every document: 401, never stored', async () => {
    for (const path of ['invoice.pdf', 'credit-note.pdf', 'certificate.pdf', 'care-guide']) {
      const res = await h.client().get(`/api/v1/account/orders/${delivered}/${path}`);
      expect(res.statusCode, path).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('lists each order\'s documents: the invoice once paid, the credit note once cancelled after it, the care guide while the piece comes or is kept', async () => {
    const list = await listed(mine);
    expect(list.get(delivered)!.documents).toEqual({ invoice: { number: 'INV-2026-000001', issuedAt: expect.any(String) }, creditNote: null, others: [], careGuide: true, certificate: false });
    expect(list.get(cancelled)!.documents).toEqual({
      invoice: { number: 'INV-2026-000002', issuedAt: expect.any(String) },
      creditNote: { number: 'CN-2026-000001', issuedAt: expect.any(String) },
      // Plan NEXT LOT §3.6.C: no supplementary invoice nor credit note for single lines.
      others: [],
      careGuide: false,
      certificate: false,
    });
    expect(list.get(reserved)!.documents).toEqual({ invoice: null, creditNote: null, others: [], careGuide: true, certificate: false });
  });

  it('gives the account its own invoice and credit note as PDFs, never stored; nothing of another account\'s', async () => {
    const invoice = await mine.get(`/api/v1/account/orders/${delivered}/invoice.pdf`);
    expect(invoice.statusCode).toBe(200);
    expect(invoice.headers['content-type']).toBe('application/pdf');
    expect(invoice.headers['content-disposition']).toBe('attachment; filename="ORBES-invoice-INV-2026-000001.pdf"');
    expect(invoice.headers['cache-control']).toBe('no-store');
    expect(invoice.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const credit = await mine.get(`/api/v1/account/orders/${cancelled}/credit-note.pdf`);
    expect(credit.headers['content-disposition']).toBe('attachment; filename="ORBES-credit-note-CN-2026-000001.pdf"');
    // None issued, another account's order, an unknown one: one answer.
    for (const [c, path] of [
      [mine, `${reserved}/invoice.pdf`],
      [mine, `${delivered}/credit-note.pdf`],
      [other, `${delivered}/invoice.pdf`],
      [other, `${cancelled}/credit-note.pdf`],
      [mine, '00000000-0000-4000-8000-000000000000/invoice.pdf'],
    ] as const) {
      const res = await c.get(`/api/v1/account/orders/${path}`);
      expect(res.statusCode, path).toBe(404);
      expect(errorOf(res).code).toBe('INVOICE_NOT_FOUND');
    }
    expect(errorOf(await mine.get('/api/v1/account/orders/nope/invoice.pdf')).code).toBe('VALIDATION_FAILED');
  });

  it('gives the model\'s care guide: its own, else its care instructions, else none for the house\'s general text', async () => {
    const guide = async () => (safeJson(await mine.get(`/api/v1/account/orders/${reserved}/care-guide`)) as Json).careGuide;
    expect(await guide()).toEqual({ model: 'MONOLITHE', text: null });
    await h.ctx.db.updateTable('models').set({ care_instructions: 'Wipe with a soft cloth.' }).where('id', '=', f.modelId).execute();
    expect(await guide()).toEqual({ model: 'MONOLITHE', text: 'Wipe with a soft cloth.' });
    await h.ctx.db.updateTable('models').set({ care_guide: 'Store it alone.\nAvoid perfume.' }).where('id', '=', f.modelId).execute();
    expect(await guide()).toEqual({ model: 'MONOLITHE', text: 'Store it alone.\nAvoid perfume.' });
    const res = await other.get(`/api/v1/account/orders/${reserved}/care-guide`);
    expect([res.statusCode, errorOf(res).code]).toEqual([404, 'ORDER_NOT_FOUND']);
  });

  it('gives the ownership certificate once the piece is registered to the account: a new document naming the order, never the claim card; not after a return', async () => {
    const before = await mine.get(`/api/v1/account/orders/${delivered}/certificate.pdf`);
    expect([before.statusCode, errorOf(before).code]).toEqual([409, 'CERTIFICATE_NOT_AVAILABLE']);
    // The buyer registers the piece (its warranty started at SHIP, question 14): the order is DELIVERED, its certificate offered.
    const scan = await h.ctx.services.verification.verify({ code: piece.code.data }, {});
    await h.ctx.services.ownership.registerFirst(mineId, { registrationToken: scan.registration!.token, claimCode: piece.claimCode! }, { type: 'account', id: mineId });
    const list = await listed(mine);
    expect(list.get(delivered)!).toMatchObject({ status: 'DELIVERED', documents: { certificate: true, careGuide: true } });
    const pdf = await mine.get(`/api/v1/account/orders/${delivered}/certificate.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="ORBES-ownership-certificate-${piece.product.productId}-2026-11-11.pdf"`);
    expect(pdf.headers['cache-control']).toBe('no-store');
    const raw = pdf.rawPayload.toString('latin1');
    expect(raw).toContain(`bought with order ${orderReference(delivered)}`);
    // Never the claim card: the claim code is nowhere in the file, as lettering or as text.
    expect(raw).not.toContain(piece.claimCode!);
    expect(raw).not.toContain('CLAIM');
    const theirs = await other.get(`/api/v1/account/orders/${delivered}/certificate.pdf`);
    expect([theirs.statusCode, errorOf(theirs).code]).toEqual([404, 'ORDER_NOT_FOUND']);
    const notYet = await mine.get(`/api/v1/account/orders/${reserved}/certificate.pdf`);
    expect([notYet.statusCode, errorOf(notYet).code]).toEqual([409, 'CERTIFICATE_NOT_AVAILABLE']);

    // Returned: ORBES took the ownership back; the certificate is no longer offered, the credit note is.
    h.clock.advance(MINUTE);
    await orders().returnOrder(delivered, { outcome: 'ARCHIVED', note: 'Returned damaged.' }, f.admin);
    expect((await listed(mine)).get(delivered)!.documents).toEqual({
      invoice: { number: 'INV-2026-000001', issuedAt: expect.any(String) },
      creditNote: { number: 'CN-2026-000002', issuedAt: expect.any(String) },
      others: [],
      careGuide: false,
      certificate: false,
    });
    const after = await mine.get(`/api/v1/account/orders/${delivered}/certificate.pdf`);
    expect([after.statusCode, errorOf(after).code]).toEqual([409, 'CERTIFICATE_NOT_AVAILABLE']);
    expect((await mine.get(`/api/v1/account/orders/${delivered}/credit-note.pdf`)).statusCode).toBe(200);
  });
});
