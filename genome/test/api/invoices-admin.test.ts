/**
 * Returns and invoices in the console (plan LIVE RELEASE+, step S4), over HTTP with real sessions (OPERATOR, AUDITOR):
 *
 *  - POST /api/admin/orders/:id/return: back to stock at a location, or to the archive, with a note; the claim code of
 *    the piece's new card once (no-store) when ORBES took its buyer's ownership back; validated; the order's page then
 *    says where the piece went, and lists the invoice and its credit note;
 *  - GET /api/admin/invoices (a month's documents and totals), /invoices.csv (the accountant's), /invoices/:id/pdf:
 *    the buyer in clear for an OPERATOR, masked for an AUDITOR (on the page, in the CSV and in the PDF); attachments
 *    never stored by a cache.
 * Which role reaches which route is test/api/admin-roles.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

type Json = Record<string, any>;
const MINUTE = 60_000;

describe('returns and invoices: the console\'s routes', () => {
  let h: Harness;
  let f: LiveFixture;
  let op: Client;
  let auditor: Client;
  let france: string;
  let colissimo: string;
  /** A delivered order whose piece its buyer registered, its account's email. */
  let order: string;
  let email: string;
  let productId: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-10T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    france = (await h.ctx.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    colissimo = (await h.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;

    // A piece in stock, a salon's order for it, its buyer entered; paid, shipped, registered by its buyer.
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '56'));
    await h.ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted.' }, f.admin);
    const piece = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '56', material: '925 STERLING SILVER', withClaimSecret: true }, f.admin);
    productId = piece.product.productId;
    const buyer = await createAccount(h.ctx.db);
    email = buyer.email;
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: buyer.id, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    order = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await op.patch(`/api/admin/orders/${order}/terms`, { sizeLabel: '56', priceMinor: 480_000, currency: 'EUR' });
    await op.request('PUT', `/api/admin/orders/${order}/buyer`, { body: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' } });
    await op.post(`/api/admin/orders/${order}/piece`, { productId });
    h.clock.advance(MINUTE);
    expect((await op.post(`/api/admin/orders/${order}/transition`, { to: 'PAID' })).statusCode).toBe(200);
    h.clock.advance(MINUTE);
    await op.post(`/api/admin/orders/${order}/transition`, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' });
    await h.ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-11-10', retailer: 'ORBES PARIS', country: 'FR' }, f.admin);
    const scan = await h.ctx.services.verification.verify({ code: piece.code.data }, {});
    await h.ctx.services.ownership.registerFirst(buyer.id, { registrationToken: scan.registration!.token, claimCode: piece.claimCode! }, buyer.actor);
  }, 120_000);
  afterAll(() => h?.close());

  it('pays an order once priced: its invoice on its page', async () => {
    const page = safeJson(await op.get(`/api/admin/orders/${order}`)) as Json;
    expect(page.order.status).toBe('DELIVERED');
    expect(page.order.invoices).toEqual([{ id: expect.any(String), kind: 'INVOICE', number: 'INV-2026-000001', issuedAt: expect.any(String), currency: 'EUR', totalMinor: 480_000 }]);
    expect(page.order.return).toBeNull();
  });

  it('opens a return: validated; back to stock, the ownership taken back and the claim code of the new card once, never stored', async () => {
    expect(errorOf(await op.post(`/api/admin/orders/${order}/return`, { outcome: 'RESTOCKED', note: 'x' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await op.post(`/api/admin/orders/${order}/return`, { outcome: 'ARCHIVED', locationId: france, note: 'x' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await op.post(`/api/admin/orders/${order}/return`, { outcome: 'ARCHIVED' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await op.post(`/api/admin/orders/${order}/return`, { outcome: 'ARCHIVED', note: 'x', extra: true })).code).toBe('VALIDATION_FAILED');
    expect((await auditor.post(`/api/admin/orders/${order}/return`, { outcome: 'ARCHIVED', note: 'x' })).statusCode).toBe(403);
    // The archive retires the piece: an ADMIN's alone.
    const archived = await op.post(`/api/admin/orders/${order}/return`, { outcome: 'ARCHIVED', note: 'Returned damaged.' });
    expect([archived.statusCode, errorOf(archived).code]).toEqual([403, 'FORBIDDEN']);
    h.clock.advance(MINUTE);
    const res = await op.post(`/api/admin/orders/${order}/return`, { outcome: 'RESTOCKED', locationId: france, note: 'Returned within the delay.' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = safeJson(res) as Json;
    expect(body.productId).toBe(productId);
    expect(body.claimCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(body.order).toMatchObject({ status: 'RETURNED', return: { outcome: 'RESTOCKED', location: { id: france, name: 'FRANCE WAREHOUSE' }, note: 'Returned within the delay.', ownershipReclaimed: true } });
    expect(body.order.invoices.map((i: Json) => [i.kind, i.number])).toEqual([
      ['INVOICE', 'INV-2026-000001'],
      ['CREDIT_NOTE', 'CN-2026-000001'],
    ]);
    // Read again: the same, without the claim code (its `claimCode` is the page's block of a buyer's new claim code, plan
    // NEXT LOT §3.4: none here, and never a code).
    const again = safeJson(await auditor.get(`/api/admin/orders/${order}`)) as Json;
    expect(again.claimCode).toBeNull();
    expect(JSON.stringify(again)).not.toContain(body.claimCode);
    expect(again.order.return.ownershipReclaimed).toBe(true);
    expect(errorOf(await op.post(`/api/admin/orders/${order}/return`, { outcome: 'RESTOCKED', locationId: france, note: 'Again.' })).code).toBe('ORDER_TRANSITION_NOT_ALLOWED');
  });

  it('lists a month\'s invoices and credit notes with their totals: the buyer in clear for an OPERATOR, masked for an AUDITOR', async () => {
    const clear = safeJson(await op.get('/api/admin/invoices?month=2026-11')) as Json;
    expect(clear.month).toBe('2026-11');
    expect(clear.currentMonth).toBe('2026-11');
    expect(clear.items.map((i: Json) => i.number)).toEqual(['CN-2026-000001', 'INV-2026-000001']);
    expect(clear.items[1]).toMatchObject({
      kind: 'INVOICE',
      order: { id: order },
      creditedBy: { number: 'CN-2026-000001' },
      issuer: { name: 'CONGLOMERAT LLC' },
      buyer: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris', email },
      lines: [{ kind: 'PIECE', label: 'MONOLITHE · SIZE 56', detail: 'THE PRIVATE SALON', amountMinor: 480_000 }],
      vatRateBp: null,
      vatMinor: null,
      totalMinor: 480_000,
    });
    expect(clear.totals).toEqual([{ currency: 'EUR', invoiced: 480_000, credited: 480_000, net: 0 }]);
    const masked = await auditor.get('/api/admin/invoices');
    expect((safeJson(masked) as Json).items[1].buyer).toEqual({ name: 'J*** D***', address: '***', email: expect.stringMatching(/^l\*\*\*@example\.com$/) });
    expect(masked.body).not.toMatch(/Jane|Paix/);
    expect(masked.body).not.toContain(email);
    expect((safeJson(await op.get('/api/admin/invoices?month=2026-10')) as Json).items).toEqual([]);
    expect((safeJson(await op.get('/api/admin/invoices?kind=CREDIT_NOTE')) as Json).items.map((i: Json) => i.kind)).toEqual(['CREDIT_NOTE']);
    expect((safeJson(await op.get('/api/admin/invoices?q=inv-2026')) as Json).items.map((i: Json) => i.number)).toEqual(['CN-2026-000001', 'INV-2026-000001']);
    for (const q of ['month=2026-13', 'month=nov', 'kind=RECEIPT', `q=${'x'.repeat(41)}`]) expect(errorOf(await op.get(`/api/admin/invoices?${q}`)).code, q).toBe('VALIDATION_FAILED');
  });

  it('gives the month\'s CSV and each PDF as attachments never stored, the buyer masked for an AUDITOR', async () => {
    const csv = await op.get('/api/admin/invoices.csv?month=2026-11');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toBe('attachment; filename="ORBES-invoices-2026-11.csv"');
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.body).toContain('"Jane Doe"');
    const maskedCsv = await auditor.get('/api/admin/invoices.csv?month=2026-11');
    expect(maskedCsv.body).toContain('"J*** D***","***"');
    expect(maskedCsv.body).not.toMatch(/Jane|Paix/);
    expect(errorOf(await op.get('/api/admin/invoices.csv')).code).toBe('VALIDATION_FAILED');

    const id = ((safeJson(await op.get('/api/admin/invoices')) as Json).items as Json[]).find((i) => i.kind === 'INVOICE')!.id;
    for (const c of [op, auditor]) {
      const pdf = await c.get(`/api/admin/invoices/${id}/pdf`);
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toBe('attachment; filename="ORBES-invoice-INV-2026-000001.pdf"');
      expect(pdf.headers['cache-control']).toBe('no-store');
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    }
    // The AUDITOR's PDF is not the OPERATOR's: its buyer is masked.
    expect((await op.get(`/api/admin/invoices/${id}/pdf`)).rawPayload.equals((await auditor.get(`/api/admin/invoices/${id}/pdf`)).rawPayload)).toBe(false);
    expect((await op.get('/api/admin/invoices/00000000-0000-4000-8000-000000000000/pdf')).statusCode).toBe(404);
    expect(errorOf(await op.get('/api/admin/invoices/nope/pdf')).code).toBe('VALIDATION_FAILED');
  });
});
