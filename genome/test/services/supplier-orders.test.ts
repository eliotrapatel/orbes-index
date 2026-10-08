/**
 * The supplier orders (plan NEXT LOT of 2026-10-07, §3.5.6.3 and §3.5.6.4, step 5.6; migration 0036), on the service
 * as createContext wires it:
 *
 *  - the proposal on known figures: waiting orders (AWAITING), the stock under its minimum, what sent orders still
 *    owe, what a draft holds; toOrder = max(0, waiting + under the minimum − expected − in the draft); a size set aside
 *    left out, its waiting orders and its minimum alike (question 7 as built); a size without a supplier apart, an
 *    inactive supplier counting as none;
 *  - the draft: one per supplier and location, created in its supplier's currency, the pieces added to the SKU's line,
 *    its unit price prefilled from the last sent line; refused for a size set aside (SIZE_SET_ASIDE) or without a
 *    supplier (SKU_NO_SUPPLIER); its lines, currency (two decimals only), shipping (none: '—'), date and note changed;
 *    discarded;
 *  - send: refused while incomplete (422 SUPPLIER_ORDER_INCOMPLETE), then fixed (SUPPLIER_ORDER_NOT_DRAFT); confirmed by
 *    the supplier; its statuses through receptions, credits and Cancel the rest (refused while a reception is open);
 *    the pieces not on the order (`extras`); the supplier's answer to rejected pieces; the invoice and its payment;
 *  - the PDF's document: Deliver to with the location's address, never an email; the journal and the audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { supplierOrderTexts } from '../../src/server/render/supplier-order.js';
import { refreshStatus, supplierOrderReference, toOrderOf } from '../../src/server/services/supplier-orders.js';
import { CURRENCY_NOT_SUPPORTED } from '../../src/server/services/suppliers.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { createAccount } from '../support/live.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('SupplierOrderService (plan NEXT LOT §3.5.6.3)', () => {
  let h: Harness;
  let catalog: Catalog;
  let admin: Actor;
  let france: string;
  let logistics: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-08T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    const row = await h.t.db.insertInto('admin_users').values({ email: 'so@orbes.test', email_normalized: 'so@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: row.id };
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
  });
  afterAll(() => h?.close());

  const so = () => h.ctx.services.supplierOrders;
  const skuOf = (label: string | null, modelId = catalog.modelId) => h.ctx.db.transaction().execute((tx) => ensureSku(tx, modelId, label));
  const receive = (skuId: string, locationId: string, n: number) => h.ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Counted.' }, admin);
  /** A salon order of the size, at the default location (FRANCE WAREHOUSE): it holds a piece, or waits for one. */
  async function salonOrder(size: string, modelId = catalog.modelId): Promise<string> {
    const account = await createAccount(h.ctx.db);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(1000);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: size }, admin);
    return id;
  }
  const auditsOf = (id: string) => h.t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_type', '=', 'supplier_order').where('target_id', '=', id).orderBy('id').execute();
  const lineOf = (orderId: string, skuId: string) => h.t.db.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', orderId).where('sku_id', '=', skuId).executeTakeFirstOrThrow();

  it('the arithmetic: what to order covers every waiting order and every minimum once', () => {
    expect(toOrderOf({ waiting: 3, underMinimum: 2, expected: 1, inDraft: 1 })).toBe(3);
    expect(toOrderOf({ waiting: 1, underMinimum: 0, expected: 4, inDraft: 0 })).toBe(0);
    expect(toOrderOf({ waiting: 0, underMinimum: 5, expected: 0, inDraft: 2 })).toBe(3);
    expect(supplierOrderReference('7c21a0b9-1111-4222-8333-944445555666')).toBe('SO-7C21A0B9');
  });

  it('proposes per supplier and location: waiting orders, the minimum, what is expected and in a draft; a size set aside left out; a size without a supplier apart', async () => {
    const nord = await h.ctx.services.suppliers.create({ name: 'Maison Nord', currency: 'EUR' }, admin);
    await h.ctx.services.suppliers.setModelSupplier(catalog.modelId, { supplierId: nord.id }, admin);
    const [k52, k54, k56] = [await skuOf('52'), await skuOf('54'), await skuOf('56')];
    // 52: three orders waiting at FRANCE, a minimum of 2 there (nothing on hand): 5 to order.
    for (let i = 0; i < 3; i++) await salonOrder('52');
    await h.ctx.services.atelier.setThreshold({ skuId: k52, locationId: france, minimum: 2 }, admin);
    // 54: one piece on hand, a minimum of 4 at LOGISTICS: 3 under the minimum.
    await receive(k54, logistics, 1);
    await h.ctx.services.atelier.setThreshold({ skuId: k54, locationId: logistics, minimum: 4 }, admin);
    // 56: one order waiting, then the size set aside: left out entirely (question 7, as built).
    await salonOrder('56');
    const proposal = await so().proposal();
    const nordGroups = proposal.groups.filter((g) => g.supplier?.id === nord.id);
    expect(nordGroups.map((g) => [g.location.name, g.rows.map((r) => [r.sku.sizeLabel, r.waiting, r.underMinimum, r.expected, r.inDraft, r.toOrder])])).toEqual([
      ['FRANCE WAREHOUSE', [['52', 3, 2, 0, 0, 5], ['56', 1, 0, 0, 0, 1]]],
      ['LOGISTICS WAREHOUSE', [['54', 0, 3, 0, 0, 3]]],
    ]);
    await h.ctx.db.updateTable('skus').set({ set_aside_at: h.clock.now(), set_aside_by: admin.id! }).where('id', '=', k56).execute();
    const after = await so().proposal({ locationId: france });
    expect(after.groups.flatMap((g) => g.rows.map((r) => r.sku.sizeLabel))).not.toContain('56');
    expect(await refusal(so().addToDraft({ skuId: k56, locationId: france, quantity: 1 }, admin))).toMatchObject({ code: 'SIZE_SET_ASIDE', status: 409 });

    // In the draft and expected: subtracted, never ordered twice.
    const draft = await so().addToDraft({ skuId: k52, locationId: france, quantity: 2 }, admin);
    expect(draft).toMatchObject({ reference: supplierOrderReference(draft.id), status: 'DRAFT', supplier: { id: nord.id }, location: { id: france }, currency: 'EUR', lines: [{ sku: { id: k52 }, quantity: 2, unitPriceMinor: null }] });
    let row52 = (await so().proposal({ locationId: france })).groups.find((g) => g.supplier?.id === nord.id)!;
    expect(row52.draft).toEqual({ id: draft.id, reference: draft.reference });
    expect(row52.rows.find((r) => r.sku.id === k52)).toMatchObject({ waiting: 3, underMinimum: 2, inDraft: 2, toOrder: 3 });
    await h.ctx.db.updateTable('supplier_orders').set({ status: 'SENT', sent_at: h.clock.now(), currency: 'EUR', expected_on: '2026-11-01' }).where('id', '=', draft.id).execute();
    row52 = (await so().proposal({ locationId: france })).groups.find((g) => g.supplier?.id === nord.id)!;
    expect(row52.rows.find((r) => r.sku.id === k52)).toMatchObject({ expected: 2, inDraft: 0, toOrder: 3 });
    expect(row52.draft).toBeNull();

    // A model without a supplier: its sizes apart, refused in a draft.
    const loose = (await h.ctx.db.insertInto('models').values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'ORBITE', type: 'RING', sku_prefix: 'ORB-LS', default_material: 'SILVER' }).returning('id').executeTakeFirstOrThrow()).id;
    const kLoose = await skuOf('50', loose);
    await salonOrder('50', loose);
    const apart = (await so().proposal()).groups.find((g) => g.supplier === null)!;
    expect(apart.rows.map((r) => [r.sku.model.name, r.sku.sizeLabel, r.toOrder])).toEqual([['ORBITE', '50', 1]]);
    expect((await so().proposal()).groups.at(-1)!.supplier).toBeNull();
    expect(await refusal(so().addToDraft({ skuId: kLoose, locationId: france, quantity: 1 }, admin))).toEqual({ code: 'SKU_NO_SUPPLIER', status: 409, message: "Set the supplier of ORBITE · 50 on its model's page first." });
    // An inactive supplier counts as none.
    const gone = await h.ctx.services.suppliers.create({ name: 'Closed Works', currency: 'EUR', active: false }, admin);
    await h.ctx.services.suppliers.setModelSupplier(loose, { supplierId: gone.id }, admin);
    expect((await so().proposal()).groups.find((g) => g.supplier === null)!.rows.map((r) => r.sku.id)).toEqual([kLoose]);
    expect((await refusal(so().addToDraft({ skuId: kLoose, locationId: france, quantity: 1 }, admin))).code).toBe('SKU_NO_SUPPLIER');
    // Only the supplier asked.
    expect((await so().proposal({ supplierId: nord.id })).groups.every((g) => g.supplier?.id === nord.id)).toBe(true);
  });

  it('keeps one draft per supplier and location, in its supplier\'s currency; the pieces added to the line, its price from the last sent one; its fields changed, a currency with cents only; discarded', async () => {
    const sud = await h.ctx.services.suppliers.create({ name: 'Atelier Sud Works', currency: 'CHF' }, admin);
    const model = (await h.ctx.db.insertInto('models').values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'HALO', type: 'RING', sku_prefix: 'HAL-RG', default_material: 'SILVER', supplier_id: sud.id }).returning('id').executeTakeFirstOrThrow()).id;
    const [k48, k50] = [await skuOf('48', model), await skuOf('50', model)];
    const first = await so().addToDraft({ skuId: k48, locationId: logistics, quantity: 3, from: 'RELEASE' }, admin);
    expect(first).toMatchObject({ status: 'DRAFT', currency: 'CHF', shippingMinor: null, expectedOn: null, lines: [{ quantity: 3, unitPriceMinor: null }] });
    const again = await so().addToDraft({ skuId: k48, locationId: logistics, quantity: 2 }, admin);
    expect(again.id).toBe(first.id);
    expect(again.lines.map((l) => [l.sku.id, l.quantity])).toEqual([[k48, 5]]);
    expect((await auditsOf(first.id)).map((a) => [a.action, a.details])).toEqual([
      ['supplier_order.create', expect.objectContaining({ supplierId: sud.id, locationId: logistics, currency: 'CHF' })],
      ['supplier_order.draft', expect.objectContaining({ skuId: k48, quantity: 3, from: 'RELEASE' })],
      ['supplier_order.draft', expect.objectContaining({ skuId: k48, quantity: 2, from: 'PROPOSAL' })],
    ]);
    // Another location: another draft.
    expect((await so().addToDraft({ skuId: k48, locationId: france, quantity: 1 }, admin)).id).not.toBe(first.id);
    // Its fields: a currency with cents only (any such ISO code), shipping, date, note, the lines given becoming its lines.
    expect(await refusal(so().updateDraft(first.id, { currency: 'JPY' }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: CURRENCY_NOT_SUPPORTED });
    expect((await refusal(so().updateDraft(first.id, { lines: [{ skuId: k48, quantity: 0 }] }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(so().updateDraft(first.id, { lines: [{ skuId: k48, quantity: 1 }, { skuId: k48, quantity: 2 }] }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(so().updateDraft(first.id, {}, admin))).code).toBe('VALIDATION_FAILED');
    const edited = await so().updateDraft(first.id, { currency: 'sek', shippingMinor: 2_500, expectedOn: '2026-11-02', note: 'Deliver in the morning.', lines: [{ skuId: k48, quantity: 4, unitPriceMinor: 12_000 }, { skuId: k50, quantity: 2, unitPriceMinor: 12_500 }] }, admin);
    expect(edited).toMatchObject({ currency: 'SEK', shippingMinor: 2_500, expectedOn: '2026-11-02', note: 'Deliver in the morning.', linesTotalMinor: 73_000, totalMinor: 75_500 });
    expect(edited.lines.map((l) => [l.sku.sizeLabel, l.quantity, l.unitPriceMinor, l.lineTotalMinor])).toEqual([
      ['48', 4, 12_000, 48_000],
      ['50', 2, 12_500, 25_000],
    ]);
    expect((await auditsOf(first.id)).at(-1)).toMatchObject({ action: 'supplier_order.update', details: { fields: ['currency', 'shipping', 'expectedOn', 'note', 'lines'] } });
    expect(JSON.stringify(await auditsOf(first.id))).not.toContain('morning');
    // Sent: a later draft's new line takes the last sent price of that SKU with that supplier.
    await so().send(first.id, admin);
    const next = await so().addToDraft({ skuId: k48, locationId: logistics, quantity: 1 }, admin);
    expect(next.id).not.toBe(first.id);
    expect(next.lines[0]).toMatchObject({ unitPriceMinor: 12_000, expectedElsewhere: 4 });
    // A draft discarded is deleted; a sent order never is.
    await so().discardDraft(next.id, admin);
    expect(await h.t.db.selectFrom('supplier_orders').select('id').where('id', '=', next.id).execute()).toEqual([]);
    expect((await auditsOf(next.id)).at(-1)).toMatchObject({ action: 'supplier_order.discard', details: { lines: 1, pieces: 1 } });
    expect((await refusal(so().discardDraft(first.id, admin))).code).toBe('SUPPLIER_ORDER_NOT_DRAFT');
    expect(await refusal(so().updateDraft(first.id, { note: 'Late.' }, admin))).toEqual({ code: 'SUPPLIER_ORDER_NOT_DRAFT', status: 409, message: 'A sent order no longer changes: cancel the rest, or start another order.' });
    expect((await refusal(so().get('00000000-0000-4000-8000-000000000000'))).code).toBe('SUPPLIER_ORDER_NOT_FOUND');
  });

  it('sends a complete order only, then follows it through the supplier\'s confirmation, receptions, a credit and Cancel the rest; the pieces not on the order; the invoice and its payment', async () => {
    const est = await h.ctx.services.suppliers.create({ name: 'Est Foundry', currency: 'EUR' }, admin);
    const model = (await h.ctx.db.insertInto('models').values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'ARC', type: 'RING', sku_prefix: 'ARC-RG', default_material: 'SILVER', supplier_id: est.id }).returning('id').executeTakeFirstOrThrow()).id;
    const [k52, k54, k58] = [await skuOf('52', model), await skuOf('54', model), await skuOf('58', model)];
    const o = await so().addToDraft({ skuId: k52, locationId: france, quantity: 10 }, admin);
    // Incomplete: no price, no date. Then complete; with no shipping, its total is its lines'.
    const incomplete = { code: 'SUPPLIER_ORDER_INCOMPLETE', status: 422, message: 'Before it is sent, an order needs at least one line, a unit price on each, its currency and its expected delivery date.' };
    expect(await refusal(so().send(o.id, admin))).toEqual(incomplete);
    await so().updateDraft(o.id, { lines: [{ skuId: k52, quantity: 10, unitPriceMinor: 10_000 }, { skuId: k54, quantity: 5, unitPriceMinor: 10_000 }] }, admin);
    expect(await refusal(so().send(o.id, admin))).toEqual(incomplete);
    await so().updateDraft(o.id, { expectedOn: '2026-11-01', currency: null }, admin);
    expect(await refusal(so().send(o.id, admin))).toEqual(incomplete);
    await so().updateDraft(o.id, { currency: 'EUR' }, admin);
    expect((await so().get(o.id)).totalMinor).toBe(150_000);
    h.clock.advance(60_000);
    const sent = await so().send(o.id, admin);
    expect(sent).toMatchObject({ status: 'SENT', sentAt: h.clock.now(), pieces: { ordered: 15, received: 0, expected: 15 } });
    expect((await auditsOf(o.id)).at(-1)).toMatchObject({ action: 'supplier_order.send', details: { lines: 2, pieces: 15, currency: 'EUR', expectedOn: '2026-11-01' } });
    expect((await refusal(so().send(o.id, admin))).code).toBe('SUPPLIER_ORDER_NOT_DRAFT');
    // Confirmed by the supplier, its date changed.
    const confirmed = await so().supplierConfirmed(o.id, { expectedOn: '2026-11-05' }, admin);
    expect(confirmed).toMatchObject({ status: 'EXPECTED', expectedOn: '2026-11-05', supplierConfirmedAt: h.clock.now() });
    expect((await refusal(so().supplierConfirmed(o.id, {}, admin))).code).toBe('SUPPLIER_ORDER_CONFIRMED');

    // A reception counted (services/receptions.ts, step 5.7): Cancel the rest waits while ORBES has not confirmed it.
    const reception = (await h.t.db.insertInto('receptions').values({ supplier_order_id: o.id, location_id: france, counted_by: admin.id! }).returning('id').executeTakeFirstOrThrow()).id;
    expect(await refusal(so().cancelRest(o.id, { note: 'The supplier stops.' }, admin))).toEqual({ code: 'RECEPTION_OPEN', status: 409, message: 'A reception of this order is already waiting for ORBES.' });
    // Confirmed: 8 of 52 OK, 2 rejected; 1 piece of 58, not on the order, with its note.
    const line52 = await lineOf(o.id, k52);
    await h.t.db.insertInto('reception_lines').values([
      { reception_id: reception, sku_id: k52, supplier_order_line_id: line52.id, accepted: 8, rejected: 2 },
      { reception_id: reception, sku_id: k58, supplier_order_line_id: null, accepted: 1, rejected: 0, note: 'One more, in 58.' },
    ]).execute();
    await h.t.db.updateTable('receptions').set({ status: 'CONFIRMED', confirmed_at: h.clock.now(), confirmed_by: admin.id! }).where('id', '=', reception).execute();
    await h.t.db.updateTable('supplier_order_lines').set({ accepted_quantity: 8, rejected_quantity: 2 }).where('id', '=', line52.id).execute();
    const back = (await h.t.db.insertInto('supplier_returns').values({ supplier_order_id: o.id, reception_id: reception, sku_id: k52, quantity: 2 }).returning('id').executeTakeFirstOrThrow()).id;
    await h.ctx.db.transaction().execute((tx) => refreshStatus(tx, o.id, h.clock.now()));
    let v = await so().get(o.id);
    expect(v).toMatchObject({ status: 'PARTLY_RECEIVED', pieces: { ordered: 15, received: 8, expected: 7 } });
    expect(v.lines.map((l) => [l.sku.sizeLabel, l.received, l.rejected, l.expected])).toEqual([
      ['52', 8, 2, 2],
      ['54', 0, 0, 5],
    ]);
    expect(v.extras).toEqual([{ sku: expect.objectContaining({ id: k58, sizeLabel: '58' }), received: 1, rejected: 0, notes: ['One more, in 58.'] }]);
    expect(v.receptions).toEqual([{ id: reception, status: 'CONFIRMED', countedAt: expect.any(Date), accepted: 9, rejected: 2, confirmedAt: h.clock.now(), confirmedBy: 'so@orbes.test' }]);
    // The supplier credits the two rejected pieces: no longer expected.
    expect((await refusal(so().settleReturn(back, { settlement: 'CREDIT' }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await refusal(so().settleReturn(back, { settlement: 'REPLACEMENT', creditMinor: 1 }, admin))).code).toBe('VALIDATION_FAILED');
    v = await so().settleReturn(back, { settlement: 'CREDIT', creditMinor: 20_000, note: 'Credit note 44.' }, admin);
    expect(v.returns).toEqual([expect.objectContaining({ id: back, quantity: 2, settlement: 'CREDIT', creditMinor: 20_000, settledAt: h.clock.now(), note: 'Credit note 44.' })]);
    expect(v.lines[0]).toMatchObject({ credited: 2, expected: 0 });
    expect(v.status).toBe('PARTLY_RECEIVED');
    expect(await refusal(so().settleReturn(back, { settlement: 'REPLACEMENT' }, admin))).toEqual({ code: 'SUPPLIER_RETURN_SETTLED', status: 409, message: 'The supplier’s answer is already noted.' });
    const audit = await h.t.db.selectFrom('audit_logs').select('details').where('action', '=', 'supplier_return.settle').executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ supplierReturnId: back, settlement: 'CREDIT', creditMinor: 20_000, quantity: 2, noted: true });
    expect(JSON.stringify(audit.details)).not.toContain('Credit note 44');

    // The rest cancelled: what has not come stops being expected; something was accepted: RECEIVED.
    expect((await refusal(so().cancelRest(o.id, { note: ' ' }, admin))).code).toBe('VALIDATION_FAILED');
    v = await so().cancelRest(o.id, { note: 'The supplier stops the 54.' }, admin);
    expect(v).toMatchObject({ status: 'RECEIVED', receivedAt: h.clock.now(), restCancelled: { at: h.clock.now(), note: 'The supplier stops the 54.' }, pieces: { expected: 0 } });
    expect(v.lines[1]).toMatchObject({ restCancelled: 5, expected: 0 });
    expect((await auditsOf(o.id)).at(-1)).toMatchObject({ action: 'supplier_order.cancel_rest', details: { pieces: 5, to: 'RECEIVED', noted: true } });
    expect(await refusal(so().cancelRest(o.id, { note: 'Again.' }, admin))).toEqual({ code: 'SUPPLIER_ORDER_CLOSED', status: 409, message: 'This supplier order expects nothing more.' });

    // The invoice: entered, replaced, paid; then fixed.
    expect((await refusal(so().markInvoicePaid(o.id, admin))).code).toBe('SUPPLIER_INVOICE_MISSING');
    await so().setInvoice(o.id, { number: 'F-2026-118', amountMinor: 80_000, date: '2026-11-06' }, admin);
    v = await so().setInvoice(o.id, { number: 'F-2026-119', amountMinor: 81_000, date: '2026-11-07' }, admin);
    expect(v.invoice).toEqual({ number: 'F-2026-119', amountMinor: 81_000, date: '2026-11-07', paidAt: null });
    v = await so().markInvoicePaid(o.id, admin);
    expect(v.invoice?.paidAt).toEqual(h.clock.now());
    expect((await refusal(so().markInvoicePaid(o.id, admin))).code).toBe('SUPPLIER_INVOICE_PAID');
    expect((await refusal(so().setInvoice(o.id, { number: 'F-1', amountMinor: 1, date: '2026-11-08' }, admin))).code).toBe('SUPPLIER_INVOICE_PAID');
    expect((await so().list({ supplierId: est.id }))[0]).toMatchObject({ id: o.id, reference: o.reference, status: 'RECEIVED', pieces: { ordered: 15, received: 8 }, totalMinor: 150_000, currency: 'EUR', expectedOn: '2026-11-05', invoice: { number: 'F-2026-119', paid: true } });
    expect((await so().list({ status: 'DRAFT', supplierId: est.id }))).toEqual([]);
    expect(v.history.map((x) => x.action)).toEqual([
      'supplier_order.create',
      'supplier_order.draft',
      'supplier_order.update',
      'supplier_order.update',
      'supplier_order.update',
      'supplier_order.send',
      'supplier_order.confirm',
      'supplier_return.settle',
      'supplier_order.cancel_rest',
      'supplier_order.invoice',
      'supplier_order.invoice',
      'supplier_order.invoice_paid',
    ]);
    // Journaled, the order as it stands with its prices.
    const journal = await h.t.db.selectFrom('event_journal').select(['type', 'payload']).where('entity_type', '=', 'supplier_order').where('entity_id', '=', o.id).orderBy('id').execute();
    expect(journal.at(-1)).toMatchObject({ type: 'supplier_order.invoice_paid', payload: { reference: o.reference, status: 'RECEIVED', invoice: { number: 'F-2026-119', paid: true } } });
  });

  it('closes an order where nothing came as CANCELLED; a REPLACEMENT keeps the pieces expected', async () => {
    const west = await h.ctx.services.suppliers.create({ name: 'West Casting', currency: 'EUR' }, admin);
    const model = (await h.ctx.db.insertInto('models').values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'DUNE', type: 'RING', sku_prefix: 'DUN-RG', default_material: 'SILVER', supplier_id: west.id }).returning('id').executeTakeFirstOrThrow()).id;
    const k = await skuOf('52', model);
    const o = await so().addToDraft({ skuId: k, locationId: france, quantity: 4 }, admin);
    expect((await refusal(so().cancelRest(o.id, { note: 'x' }, admin))).code).toBe('SUPPLIER_ORDER_NOT_SENT');
    await so().updateDraft(o.id, { lines: [{ skuId: k, quantity: 4, unitPriceMinor: 5_000 }], expectedOn: '2026-12-01' }, admin);
    await so().send(o.id, admin);
    // Two rejected, replaced: still expected.
    const reception = (await h.t.db.insertInto('receptions').values({ supplier_order_id: o.id, location_id: france, status: 'CONFIRMED', confirmed_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow()).id;
    await h.t.db.updateTable('supplier_order_lines').set({ rejected_quantity: 2 }).where('supplier_order_id', '=', o.id).execute();
    const back = (await h.t.db.insertInto('supplier_returns').values({ supplier_order_id: o.id, reception_id: reception, sku_id: k, quantity: 2 }).returning('id').executeTakeFirstOrThrow()).id;
    const v = await so().settleReturn(back, { settlement: 'REPLACEMENT' }, admin);
    expect(v).toMatchObject({ status: 'SENT', pieces: { expected: 4 }, returns: [expect.objectContaining({ settlement: 'REPLACEMENT', creditMinor: null })] });
    const closed = await so().cancelRest(o.id, { note: 'Nothing will come.' }, admin);
    expect(closed).toMatchObject({ status: 'CANCELLED', receivedAt: null, pieces: { expected: 0 } });
  });

  it('prints from the house, to the supplier and to the location with its address, never an email or a phone; the shipping « — » when none', async () => {
    const north = await h.ctx.services.suppliers.create({ name: 'Polar Metals', currency: 'GBP', email: 'orders@polar.example', phone: '+44 20 0000 0000', address: '2 Quay Street\nLeith' }, admin);
    const model = (await h.ctx.db.insertInto('models').values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'NOCTA', type: 'RING', sku_prefix: 'NOC-RG', default_material: 'SILVER', supplier_id: north.id }).returning('id').executeTakeFirstOrThrow()).id;
    const k = await skuOf('52', model);
    await h.ctx.services.stock.updateLocation(logistics, { address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' }, admin);
    const o = await so().addToDraft({ skuId: k, locationId: logistics, quantity: 6 }, admin);
    await so().updateDraft(o.id, { lines: [{ skuId: k, quantity: 6, unitPriceMinor: 9_950 }], expectedOn: '2026-11-20', note: 'Box each piece.' }, admin);
    const doc = await so().document(o.id);
    expect(doc).toMatchObject({ reference: o.reference, currency: 'GBP', shippingMinor: null, deliverTo: { name: 'LOGISTICS WAREHOUSE', address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' }, to: { name: 'Polar Metals', address: '2 Quay Street\nLeith' } });
    expect(JSON.stringify(doc)).not.toMatch(/orders@polar|\+44/);
    const texts = supplierOrderTexts(doc).flat();
    expect(texts).toEqual(expect.arrayContaining(['DELIVER TO', 'LOGISTICS WAREHOUSE', '12 RUE DES ENTREPOTS', '93200 SAINT-DENIS', 'FRANCE', 'CONGLOMERAT LLC', 'POLAR METALS', 'NOCTA · 52', 'GBP 99.50', 'GBP 597.00', 'SHIPPING', '—', 'TOTAL', 'BOX EACH PIECE.']));
    const pdf = await so().pdf(o.id);
    expect(pdf.filename).toBe(`ORBES-${o.reference}.pdf`);
    expect(Buffer.from(pdf.body.subarray(0, 5)).toString()).toBe('%PDF-');
  });
});
