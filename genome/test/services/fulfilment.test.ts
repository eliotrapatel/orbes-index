/**
 * The fulfilment board (plan LIVE RELEASE+ of 2026-10-04, step S2: choices 7 and 19, The console → Orders), on the
 * services as createContext wires them:
 *
 *  - each order's time in its step and the M3 rules: RESERVED over 2 days; PAID with its piece ready but not shipped
 *    over 3 (from when it was both paid and ready); SHIPPED not delivered over 10; DELIVERED, its piece not registered
 *    by its buyer, over 30; never a PAID order whose piece is being made, nor a closed one; the delays editable within
 *    their bounds (audited `order.alerts`);
 *  - the board: the six columns, their counts and late counts, the longest waiting first, the latest closed first; the
 *    filters (channel, release, location, late, a reference or words); the CSV with the buyer as the caller may read it;
 *  - an order's page: its timing, its piece, who changed it;
 *  - the LIVE resolution retired into the orders: the release report reads them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { BOARD_COLUMN_MAX, ORDER_ALERT_DEFAULTS, orderTiming, readySince, type TimedOrder } from '../../src/server/services/fulfilment.js';
import { liveReference } from '../../src/server/services/live-console.js';
import { orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { countPiecesIn, packAndShip, scanIntoParcel } from '../support/fulfil.js';
import { accountOfTier, createAccount, createLiveRelease, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;

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

describe('orderTiming and readySince (M3, pure)', () => {
  const at = (d: number) => new Date(Date.UTC(2026, 10, 1) + d * DAY);
  const base: TimedOrder = { status: 'RESERVED', reservedAt: at(0), paidAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null, returnedAt: null, reservation: null, readySince: null, registered: false };
  const d = ORDER_ALERT_DEFAULTS;

  it('RESERVED is late strictly past 2 days', () => {
    expect(orderTiming(base, d, at(2))).toEqual({ since: at(0), dueAt: at(2), rule: 'RESERVED', late: false });
    expect(orderTiming(base, d, new Date(at(2).getTime() + 1)).late).toBe(true);
  });

  it('PAID is late 5 days after it was both paid and ready (plan NEXT LOT §3.5: 5 days); never while it awaits supplier stock', () => {
    expect(d.readyDays).toBe(5);
    const paid: TimedOrder = { ...base, status: 'PAID', paidAt: at(1), reservation: 'AWAITING' };
    expect(orderTiming(paid, d, at(30))).toEqual({ since: at(1), dueAt: null, rule: null, late: false });
    // Ready before it was paid: from the payment.
    expect(orderTiming({ ...paid, reservation: 'STOCK', readySince: at(0) }, d, at(6))).toEqual({ since: at(1), dueAt: at(6), rule: 'READY', late: false });
    // Ready after: from the day it was ready.
    const late = orderTiming({ ...paid, reservation: 'STOCK', readySince: at(5) }, d, at(10.5));
    expect([late.dueAt, late.rule, late.late]).toEqual([at(10), 'READY', true]);
  });

  it('SHIPPED is late past 10 days; DELIVERED past 30 while its buyer has not registered the piece; CANCELLED and RETURNED never', () => {
    const shipped: TimedOrder = { ...base, status: 'SHIPPED', paidAt: at(1), shippedAt: at(2) };
    expect(orderTiming(shipped, d, at(12.5))).toMatchObject({ since: at(2), dueAt: at(12), rule: 'SHIPPED', late: true });
    const delivered: TimedOrder = { ...shipped, status: 'DELIVERED', deliveredAt: at(3) };
    expect(orderTiming(delivered, d, at(34))).toMatchObject({ since: at(3), rule: 'UNREGISTERED', late: true });
    expect(orderTiming({ ...delivered, registered: true }, d, at(400))).toEqual({ since: at(3), dueAt: null, rule: null, late: false });
    expect(orderTiming({ ...base, status: 'CANCELLED', cancelledAt: at(1) }, d, at(400))).toEqual({ since: at(1), dueAt: null, rule: null, late: false });
    expect(orderTiming({ ...delivered, status: 'RETURNED', deliveredAt: null, returnedAt: at(5) }, d, at(400))).toEqual({ since: at(5), dueAt: null, rule: null, late: false });
    // The delays as set.
    expect(orderTiming(base, { ...d, reservedDays: 5 }, at(4)).late).toBe(false);
  });

  it('reads when the piece became ready from the history: the last change that made it hold one in stock after holding none or awaiting supplier stock', () => {
    const e = (day: number, details: Record<string, unknown>) => ({ at: at(day), details: details as never });
    // A waiting order served (order.serve) is ready from then on.
    expect(readySince([e(0, { reservation: 'AWAITING' }), e(1, {}), e(3, { reservation: 'STOCK', skuId: 'k', locationId: 'l' }), e(4, { fields: ['engraving'], reservation: 'STOCK' })])).toEqual(at(3));
    expect(readySince([e(0, { reservation: 'STOCK' }), e(1, { reservation: null }), e(2, { reservation: 'STOCK' })])).toEqual(at(2));
    expect(readySince([e(0, { reservation: 'STOCK' }), e(1, { reservation: 'AWAITING' })])).toBeNull();
    expect(readySince([])).toBeNull();
  });
});

describe('the fulfilment board (plan LIVE RELEASE+, S2)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  let france: string;
  let logistics: string;
  let colissimo: string;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    const locations = await t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    colissimo = (await t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const board = (filter = {}) => ctx.services.fulfilment.board(filter);
  const orders = () => ctx.services.orders;
  const skuOf = (label: string | null, modelId = f.modelId) => inTransaction(t.db, (tx) => ensureSku(tx, modelId, label));
  const receive = (skuId: string, locationId: string, n: number) => ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Counted.' }, admin);
  const card = async (orderId: string, filter = {}) => (await board(filter)).columns.flatMap((c) => c.items).find((x) => x.id === orderId);

  async function salonOrder(size: string | null, modelId = f.modelId) {
    const account = await createAccount(t.db);
    const request = await t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const order = await t.db.selectFrom('orders').selectAll().where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    if (size !== null) await orders().setTerms(order.id, { sizeLabel: size, priceMinor: 480_000, currency: 'EUR' }, admin);
    return { order: await t.db.selectFrom('orders').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow(), account };
  }

  async function liveSale(label: string, quantity = 1) {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label, stock: 3 }], perAccount: quantity, addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }] });
    const a = await accountOfTier(f, 0);
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    await f.live.setAddons(a.id, r.id, r.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const rows = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).orderBy('piece').execute();
    return { release: r, account: a, entryId: entry.id, orders: rows };
  }

  it('has six columns, each with its count, its late count and its cards; the longest waiting first, the latest closed first', async () => {
    const empty = await board();
    expect(empty.columns.map((c) => c.status)).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']);
    expect(empty.delays).toMatchObject({ ...ORDER_ALERT_DEFAULTS, updatedAt: null, updatedBy: null });
    expect(empty.locations.map((l) => l.name)).toEqual(['FRANCE WAREHOUSE', 'LOGISTICS WAREHOUSE']);
    expect(BOARD_COLUMN_MAX).toBe(100);

    const older = (await salonOrder('52')).order;
    clock.advance(HOUR);
    const newer = (await salonOrder('52')).order;
    clock.advance(HOUR);
    const cancelA = (await salonOrder(null)).order;
    await orders().transition(cancelA.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    clock.advance(HOUR);
    const cancelB = (await salonOrder(null)).order;
    await orders().transition(cancelB.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    const b = await board({ channel: 'SALON' });
    const reserved = b.columns.find((c) => c.status === 'RESERVED')!;
    const ids = reserved.items.map((x) => x.id);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
    const cancelled = b.columns.find((c) => c.status === 'CANCELLED')!.items.map((x) => x.id);
    expect(cancelled.indexOf(cancelB.id)).toBeLessThan(cancelled.indexOf(cancelA.id));
    expect(reserved.total).toBe(reserved.items.length);
  });

  it('gives each card its channel, release, collector, model, size, add-ons, what it holds and its time in its step', async () => {
    const sale = await liveSale('54');
    await orders().setTerms(sale.orders[0]!.id, { engravingText: 'L. 2026' }, admin);
    const c = (await card(sale.orders[0]!.id))!;
    expect(c).toMatchObject({
      reference: orderReference(sale.orders[0]!.id),
      sourceReference: liveReference(sale.entryId),
      channel: 'LIVE',
      status: 'RESERVED',
      release: { id: sale.release.id, title: 'LIVE' },
      account: { id: sale.account.id, email: sale.account.email },
      model: { id: f.modelId, name: 'MONOLITHE' },
      sizeLabel: '54',
      addons: [{ label: 'ENGRAVING' }],
      surprise: null,
      engraving: true,
      location: { id: france, name: 'FRANCE WAREHOUSE' },
      reservation: 'AWAITING',
      piece: null,
      shipment: null,
      timing: { since: sale.orders[0]!.reserved_at, rule: 'RESERVED', late: false },
    });
    expect(c.skuCode).toMatch(/-54$/);
  });

  it('makes each late order stand out by its rule (M3) and narrows the board to them; the delays editable within their bounds, audited', async () => {
    const model = await createModel(t.db, 'LATE');
    const sku = await skuOf('56', model);
    await receive(sku, france, 3);
    const reserved = (await salonOrder('56', model)).order;
    const paidReady = (await salonOrder('56', model)).order;
    await orders().transition(paidReady.id, { to: 'PAID' }, admin);
    const shipped = (await salonOrder('56', model)).order;
    await orders().transition(shipped.id, { to: 'PAID' }, admin);
    // Its piece, issued in advance and counted in, packed and shipped through the agent's steps.
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: model, variant: '56', material: '925 STERLING SILVER' }, admin);
    await ctx.services.logistics.countIn(sku, { productRefs: [piece.product.productId], note: 'On the shelf.' }, admin);
    await packAndShip(ctx, shipped.id, { carrierId: colissimo, trackingNumber: '6A00000000001', pieces: { [shipped.id]: piece.product.productId } }, admin);
    const paidMaking = (await salonOrder('57', model)).order;
    await orders().transition(paidMaking.id, { to: 'PAID' }, admin);
    expect(paidMaking.reservation).toBe('AWAITING');
    const narrow = { q: 'LATE' };
    const lateOnes = async () => (await board({ ...narrow, late: true })).columns.flatMap((c) => c.items.map((x) => [x.id, x.timing.rule]));

    expect(await lateOnes()).toEqual([]);
    clock.advance(2 * DAY + MINUTE);
    expect(await lateOnes()).toEqual([[reserved.id, 'RESERVED']]);
    // READY: 5 days (plan NEXT LOT §3.5); an order awaiting supplier stock is never late.
    clock.advance(2 * DAY);
    expect(await lateOnes()).toEqual([[reserved.id, 'RESERVED']]);
    clock.advance(DAY);
    expect(await lateOnes()).toEqual([
      [reserved.id, 'RESERVED'],
      [paidReady.id, 'READY'],
    ]);
    const counts = (await board(narrow)).columns.map((c) => [c.status, c.total, c.late]);
    expect(counts).toEqual([
      ['RESERVED', 1, 1],
      ['PAID', 2, 1],
      ['SHIPPED', 1, 0],
      ['DELIVERED', 0, 0],
      ['CANCELLED', 0, 0],
      ['RETURNED', 0, 0],
    ]);
    clock.advance(5 * DAY);
    expect((await lateOnes()).map(([, rule]) => rule)).toEqual(['RESERVED', 'READY', 'SHIPPED']);
    // Delivered: late 30 days on while its buyer has not registered the piece.
    await orders().transition(shipped.id, { to: 'DELIVERED' }, admin);
    clock.advance(30 * DAY + MINUTE);
    expect((await lateOnes()).map(([, rule]) => rule)).toEqual(['RESERVED', 'READY', 'UNREGISTERED']);

    // The other delays, longer: none late any more but the delivered one; then its own, longer too.
    const set = await ctx.services.fulfilment.setDelays({ reservedDays: 90, readyDays: 90, shippedDays: 90, unregisteredDays: 30 }, admin);
    expect(set).toMatchObject({ reservedDays: 90, readyDays: 90, shippedDays: 90, unregisteredDays: 30, updatedAt: clock.now(), updatedBy: { id: admin.id } });
    expect((await lateOnes()).map(([, rule]) => rule)).toEqual(['UNREGISTERED']);
    const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'order.alerts').executeTakeFirstOrThrow();
    expect(audit.details).toEqual({ from: { ...ORDER_ALERT_DEFAULTS }, to: { reservedDays: 90, readyDays: 90, shippedDays: 90, unregisteredDays: 30 } });
    await ctx.services.fulfilment.setDelays({ reservedDays: 90, readyDays: 90, shippedDays: 90, unregisteredDays: 31 }, admin);
    expect(await lateOnes()).toEqual([]);
    await rejects(ctx.services.fulfilment.setDelays({ reservedDays: 0, readyDays: 3, shippedDays: 10, unregisteredDays: 30 }, admin), 'VALIDATION_FAILED', 400);
    await rejects(ctx.services.fulfilment.setDelays({ reservedDays: 2, readyDays: 3, shippedDays: 91, unregisteredDays: 30 }, admin), 'VALIDATION_FAILED', 400);
    await rejects(ctx.services.fulfilment.setDelays({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 366 }, admin), 'VALIDATION_FAILED', 400);
    await ctx.services.fulfilment.setDelays({ ...ORDER_ALERT_DEFAULTS }, admin);
  });

  it('narrows by channel, release, location and a search: an order\'s reference, a LIVE reservation\'s, a piece\'s, words of the model or the release', async () => {
    const sale = await liveSale('58');
    const salon = (await salonOrder('58')).order;
    await orders().changeLocation(salon.id, logistics, admin);
    const all = async (filter: object) => (await board(filter)).columns.flatMap((c) => c.items.map((x) => x.id));
    expect(await all({ dropId: sale.release.id })).toEqual([sale.orders[0]!.id]);
    expect(await all({ channel: 'LIVE' })).toContain(sale.orders[0]!.id);
    expect(await all({ channel: 'LIVE' })).not.toContain(salon.id);
    expect(await all({ locationId: logistics })).toContain(salon.id);
    expect(await all({ locationId: logistics })).not.toContain(sale.orders[0]!.id);
    expect(await all({ q: orderReference(salon.id) })).toEqual([salon.id]);
    expect(await all({ q: orderReference(salon.id).toLowerCase().replace('-', '') })).toEqual([salon.id]);
    expect(await all({ q: liveReference(sale.entryId) })).toEqual([sale.orders[0]!.id]);
    // A piece's reference finds the order it fulfils (no piece to make carries one any more, plan NEXT LOT §3.5): its
    // piece counted in where it waits, paid, bound by the packing scan.
    const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '58', material: '925 STERLING SILVER' }, admin);
    await countPiecesIn(ctx, { skuId: salon.sku_id!, locationId: logistics, productRefs: [piece.product.productId], forOrderIds: [salon.id] }, admin);
    await orders().transition(salon.id, { to: 'PAID' }, admin);
    await scanIntoParcel(ctx, salon.id, {}, admin);
    expect(await all({ q: piece.product.productId })).toEqual([salon.id]);
    expect(await all({ q: 'monolith' })).toEqual(expect.arrayContaining([salon.id, sale.orders[0]!.id]));
    expect(await all({ q: '%' })).toEqual([]);
    expect((await board()).releases.map((r) => r.id)).toContain(sale.release.id);
  });

  it('exports the orders the filters keep as a CSV, the buyer as the caller may read it, oldest first', async () => {
    const { order } = await salonOrder('60');
    await orders().setBuyer(order.id, { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' }, admin);
    await orders().setTerms(order.id, { engravingText: 'J.D.' }, admin);
    const file = await ctx.services.fulfilment.csv({ q: orderReference(order.id) }, { email: (e) => `masked:${e}`, buyer: (b) => ({ name: b.name ? 'J*** D***' : null, address: b.address ? '***' : null }) });
    expect(file.filename).toMatch(/^ORBES-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    const [head, line, ...rest] = file.body.trim().split('\r\n');
    expect(rest).toEqual([]);
    expect(head!.split(',').slice(0, 6)).toEqual(['"reference"', '"source reference"', '"channel"', '"release"', '"collector"', '"model"']);
    expect(line).toContain(`"${orderReference(order.id)}"`);
    expect(line).toContain('"masked:');
    expect(line).toContain('"J*** D***","***"');
    expect(line).toContain('"4800.00"');
    expect(line).toContain('"J.D."');
    expect(line).not.toContain('Jane');
    expect(line).not.toContain('Paix');
  });

  it('reads one order\'s page: its collector, timing, piece and who changed it', async () => {
    const { order, account } = await salonOrder('62');
    clock.advance(MINUTE);
    await orders().transition(order.id, { to: 'PAID', note: 'Paid by transfer.' }, admin);
    const d = await ctx.services.fulfilment.detail(order.id);
    expect(d.account).toEqual({ id: account.id, email: account.email });
    expect(d.sourceReference).toBeNull();
    expect(d.timing).toMatchObject({ since: clock.now(), rule: null, late: false });
    expect(d.piece).toBeNull();
    expect(d.order.events.at(-1)).toMatchObject({ action: 'order.pay', note: 'Paid by transfer.' });
    const adminEmail = (await t.db.selectFrom('admin_users').select('email').where('id', '=', admin.id!).executeTakeFirstOrThrow()).email;
    expect(d.actors).toEqual({ [admin.id!]: adminEmail });
    expect(d.delays).toEqual({ ...ORDER_ALERT_DEFAULTS });
    await rejects(ctx.services.fulfilment.detail('00000000-0000-4000-8000-000000000000'), 'ORDER_NOT_FOUND', 404);
  });

  it('reads a LIVE reservation\'s outcome from its orders in the release report: CONCLUDED once paid, CANCELLED once every order is', async () => {
    const paid = await liveSale('64');
    await orders().transition(paid.orders[0]!.id, { to: 'PAID' }, admin);
    const cancelled = await liveSale('66');
    await orders().transition(cancelled.orders[0]!.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    for (const [sale, outcome] of [
      [paid, 'CONCLUDED'],
      [cancelled, 'CANCELLED'],
    ] as const) {
      await t.db.updateTable('drops').set({ ended_at: clock.now(), ended_reason: 'ENDED' }).where('id', '=', sale.release.id).execute();
      const report = await ctx.services.liveInsights.report(sale.release.id);
      expect(report.funnel.find((x) => x.step === 'CONCLUDED')!.people, outcome).toBe(outcome === 'CONCLUDED' ? 1 : 0);
      // The entry's own resolution stays as the LIVE plan left it: none.
      expect((await t.db.selectFrom('live_entries').select('resolution').where('id', '=', sale.entryId).executeTakeFirstOrThrow()).resolution).toBeNull();
    }
    const report = await ctx.services.liveInsights.report(cancelled.release.id);
    expect(report.cancelled).toEqual({ reservations: 1, pieces: 1 });
    expect(report.piecesRevenueMinor).toBe(0);
  });
});
