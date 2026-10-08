/**
 * The supplier orders in the console (plan NEXT LOT of 2026-10-07, §3.5.4.2; step 5.11d) — the pure model
 * model/supplier-orders.ts against the server's rules (its bounds mirrored and compared), the list's filters, what may be
 * done in each status, the money in the order's currency, the dialogs' checks and what they send; AdminApi's paths.
 */
import { describe, expect, it } from 'vitest';
import { SUPPLIER_ORDER_LIMITS as SERVER_LIMITS } from '../../src/server/services/supplier-orders.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  addQuantityProblem,
  amountField,
  amountOf,
  draftChange,
  draftProblem,
  expectedElsewhereLine,
  invoiceCell,
  invoiceProblem,
  lineProblem,
  linesWith,
  listFilters,
  money,
  noSupplierLine,
  piecesLine,
  settledCell,
  settleProblem,
  statusOptions,
  SUPPLIER_ORDER_LIMITS,
  SUPPLIER_ORDER_STATUS_LABELS,
  supplierOrderActions,
} from '../../src/web/admin/model/supplier-orders.js';
import { can } from '../../src/web/admin/model/permissions.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import { ADMIN_ROLES, SUPPLIER_ORDER_STATUSES, type LogisticsSku } from '../../src/web/admin/types.js';

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const LOC = '1f0e0d0c-0b0a-4908-8706-050403020100';
const SKU: LogisticsSku = { id: ID, code: 'MNL-BLU-52', model: { id: ID, name: 'MONOLITHE' }, variant: 'BLUE', sizeLabel: '52', setAside: false };

describe('the mirrors of the server', () => {
  it('holds the server\'s bounds and names every status', () => {
    for (const k of Object.keys(SUPPLIER_ORDER_LIMITS) as (keyof typeof SUPPLIER_ORDER_LIMITS)[]) expect(SUPPLIER_ORDER_LIMITS[k], k).toBe(SERVER_LIMITS[k]);
    expect(Object.keys(SUPPLIER_ORDER_STATUS_LABELS)).toEqual([...SUPPLIER_ORDER_STATUSES]);
    expect(SUPPLIER_ORDER_STATUS_LABELS.PARTLY_RECEIVED).toBe('PARTLY RECEIVED');
    expect(statusOptions().map((o) => o.label)).toEqual(['Draft', 'Sent', 'Expected', 'Partly received', 'Received', 'Cancelled', 'All']);
  });
});

describe('the page and the list', () => {
  it('reads its filters, routes an order, says pieces, totals and invoices', () => {
    expect(listFilters({ status: 'SENT', supplierId: ID.toUpperCase() })).toEqual({ status: 'SENT', supplierId: ID });
    expect(listFilters({ status: 'LOST', supplierId: 'x' })).toEqual({});
    expect(parseHash(`#/supplier-orders/${ID}`)).toMatchObject({ name: 'supplierOrder', params: { supplierOrderId: ID } });
    expect(href('supplierOrder', { supplierOrderId: ID })).toBe(`#/supplier-orders/${ID}`);
    expect(piecesLine({ ordered: 50, received: 12 })).toBe('12 / 50');
    expect(money(null, 'EUR')).toBe('—');
    expect(money(12_050, null)).toBe('—');
    expect(money(12_050, 'EUR').replace(/\s/g, ' ')).toBe('€ 120.50');
    expect(invoiceCell(null)).toBe('—');
    expect(invoiceCell({ number: 'MN-1', paid: true })).toBe('MN-1 · PAID');
    expect(noSupplierLine(SKU)).toBe('No supplier set for MONOLITHE · BLUE · 52: set it on the model’s page.');
    expect(expectedElsewhereLine(5)).toBe('Expected on other supplier orders: 5');
    expect(expectedElsewhereLine(0)).toBeNull();
    expect(settledCell({ settlement: 'REPLACEMENT', creditMinor: null }, 'EUR')).toBe('Replacement');
    expect(settledCell({ settlement: 'CREDIT', creditMinor: 12_000 }, 'EUR').replace(/\s/g, ' ')).toBe('Credit · € 120');
    expect(settledCell({ settlement: null, creditMinor: null }, 'EUR')).toBe('—');
  });

  it('offers each action in its status, to a role that manages supplier orders (never LOGISTICS)', () => {
    expect(supplierOrderActions({ status: 'DRAFT', invoice: null }, true)).toMatchObject({ edit: true, send: true, discard: true, confirmed: false, cancelRest: false, invoice: false });
    expect(supplierOrderActions({ status: 'SENT', invoice: null }, true)).toMatchObject({ edit: false, send: false, confirmed: true, cancelRest: true, invoice: true, invoicePaid: false });
    expect(supplierOrderActions({ status: 'PARTLY_RECEIVED', invoice: { number: 'x', amountMinor: 1, date: '2026-11-01', paidAt: null } }, true)).toMatchObject({ confirmed: false, cancelRest: true, invoicePaid: true });
    expect(supplierOrderActions({ status: 'RECEIVED', invoice: { number: 'x', amountMinor: 1, date: '2026-11-01', paidAt: '2026-11-02' } }, true)).toMatchObject({ cancelRest: false, invoice: false, invoicePaid: false });
    expect(Object.values(supplierOrderActions({ status: 'SENT', invoice: null }, false)).every((x) => x === false)).toBe(true);
    expect([...ADMIN_ROLES].filter((r) => can(r, 'manageSupplierOrders')).sort()).toEqual(['ADMIN', 'OPERATOR']);
  });
});

describe('the dialogs', () => {
  it('reads amounts in hundredths, up to their bound', () => {
    expect(amountOf('4 800,5')).toBe(480_050);
    expect(amountOf('120')).toBe(12_000);
    expect(amountOf('12.345')).toBeNull();
    expect(amountOf('1000001')).toBeNull();
    expect(amountOf('1000001', SUPPLIER_ORDER_LIMITS.invoiceMinor)).toBe(100_000_100);
    expect(amountField(12_050)).toBe('120.50');
    expect(amountField(null)).toBe('');
  });

  it('checks a draft\'s Edit and sends what changed as the server takes it', () => {
    expect(draftProblem({ currency: 'EURO' })).toMatch(/three-letter/);
    expect(draftProblem({ expectedOn: '20/11/2026' })).toMatch(/a day/);
    expect(draftProblem({ shipping: 'a lot' })).toMatch(/Shipping costs/);
    expect(draftProblem({ currency: 'gbp', expectedOn: '2026-11-20', shipping: '25', note: '' })).toBeNull();
    expect(draftChange({ currency: 'gbp', expectedOn: '2026-11-20', shipping: '25', note: ' ' })).toEqual({ currency: 'GBP', expectedOn: '2026-11-20', shippingMinor: 2_500, note: null });
    expect(draftChange({ currency: '', expectedOn: '', shipping: '', note: '' })).toEqual({ currency: null, expectedOn: null, shippingMinor: null, note: null });
  });

  it('checks a line and sends the draft\'s lines whole, one changed, added or removed', () => {
    expect(lineProblem({ skuId: '', quantity: '1' }, true)).toBe('Choose the size.');
    expect(lineProblem({ quantity: '0' }, false)).toMatch(/1 to 10/);
    expect(lineProblem({ quantity: '2', unitPrice: 'x' }, false)).toMatch(/unit price/);
    expect(lineProblem({ quantity: '2', unitPrice: '' }, false)).toBeNull();
    const o = { lines: [{ sku: SKU, quantity: 2, unitPriceMinor: null }] } as unknown as Parameters<typeof linesWith>[0];
    expect(linesWith(o, { skuId: ID, quantity: 3, unitPriceMinor: 12_000 })).toEqual([{ skuId: ID, quantity: 3, unitPriceMinor: 12_000 }]);
    expect(linesWith(o, { skuId: LOC, quantity: 1, unitPriceMinor: null })).toEqual([
      { skuId: ID, quantity: 2, unitPriceMinor: null },
      { skuId: LOC, quantity: 1, unitPriceMinor: null },
    ]);
    expect(linesWith(o, { remove: ID })).toEqual([]);
  });

  it('checks the invoice, the supplier\'s answer and a quantity added', () => {
    expect(invoiceProblem({ number: '', amount: '1', date: '2026-11-01' })).toMatch(/number/);
    expect(invoiceProblem({ number: 'MN-1', amount: 'x', date: '2026-11-01' })).toMatch(/amount/);
    expect(invoiceProblem({ number: 'MN-1', amount: '385', date: '' })).toMatch(/date/);
    expect(invoiceProblem({ number: 'MN-1', amount: '385', date: '2026-11-01' })).toBeNull();
    expect(settleProblem({ settlement: '' })).toMatch(/answer/);
    expect(settleProblem({ settlement: 'CREDIT', credit: '' })).toMatch(/amount/);
    expect(settleProblem({ settlement: 'REPLACEMENT', note: '' })).toBeNull();
    expect(addQuantityProblem({ quantity: '13' })).toBeNull();
    expect(addQuantityProblem({ quantity: '0' })).toMatch(/Add 1 to/);
  });
});

describe('the API client', () => {
  it('calls each supplier-order route with its method and body, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/pdf')) return new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ORBES-SO-7C21A0B9.pdf"' } });
      return new Response(url.includes('DELETE') ? null : '{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.supplierOrders({ status: 'SENT', supplierId: ID });
    await api.supplierOrderProposal({ locationId: LOC });
    await api.addToSupplierDraft({ skuId: ID, locationId: LOC, quantity: 13, from: 'RELEASE' });
    await api.supplierOrder(ID);
    await api.updateSupplierDraft(ID, { expectedOn: '2026-11-20' });
    await api.discardSupplierDraft(ID);
    await api.sendSupplierOrder(ID);
    await api.supplierConfirmed(ID, '2026-11-20');
    await api.cancelSupplierRest(ID, 'Stopped.');
    const pdf = await api.supplierOrderPdf(ID);
    await api.setSupplierInvoice(ID, { number: 'MN-1', amountMinor: 38_500, date: '2026-11-21' });
    await api.markSupplierInvoicePaid(ID);
    await api.settleSupplierReturn(ID, { settlement: 'CREDIT', creditMinor: 12_000 });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `GET /api/admin/supplier-orders?status=SENT&supplierId=${ID}`,
      `GET /api/admin/supplier-orders/proposal?locationId=${LOC}`,
      'POST /api/admin/supplier-orders/draft-lines',
      `GET /api/admin/supplier-orders/${ID}`,
      `PATCH /api/admin/supplier-orders/${ID}`,
      `DELETE /api/admin/supplier-orders/${ID}`,
      `POST /api/admin/supplier-orders/${ID}/send`,
      `POST /api/admin/supplier-orders/${ID}/supplier-confirmed`,
      `POST /api/admin/supplier-orders/${ID}/cancel-rest`,
      `GET /api/admin/supplier-orders/${ID}/pdf`,
      `PUT /api/admin/supplier-orders/${ID}/invoice`,
      `POST /api/admin/supplier-orders/${ID}/invoice/paid`,
      `POST /api/admin/supplier-returns/${ID}/settle`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : undefined));
    expect(bodies[2]).toEqual({ skuId: ID, locationId: LOC, quantity: 13, from: 'RELEASE' });
    expect(bodies[7]).toEqual({ expectedOn: '2026-11-20' });
    expect(bodies[8]).toEqual({ note: 'Stopped.' });
    expect(bodies[10]).toEqual({ number: 'MN-1', amountMinor: 38_500, date: '2026-11-21' });
    expect(bodies[12]).toEqual({ settlement: 'CREDIT', creditMinor: 12_000 });
    expect(pdf.filename).toBe('ORBES-SO-7C21A0B9.pdf');
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
  });
});
