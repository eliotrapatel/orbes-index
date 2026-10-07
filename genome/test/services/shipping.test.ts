/**
 * The orders' shipping (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T4, step 2.4; migration 0027), on the services as
 * createContext wires them:
 *
 *  - the tier is read at the order's creation: PLATINE's free standard, PALLADIUM's free express (THE PROGRAM);
 *  - below PLATINE without a rate: no shipping, no SHIPPING line, MARK PAID allowed, as before;
 *  - a fee entered by hand gives its SHIPPING line, an empty one clears it; a fee over a free benefit is refused, express
 *    below PALLADIUM is paid at the fee entered;
 *  - an optional rate, once set, is applied at creation; a salon's order or an unpriced draw's takes it when its price
 *    gives it its currency; a rate taken follows a change of currency (none without a rate), a fee entered by hand stays;
 *  - a LIVE entry of three pieces pays one fee: the other two travel with the first (its service at 0), have no SHIPPING
 *    line of their own, and follow it when its shipping changes;
 *  - an order keeps its free shipping after the tier drops;
 *  - the invoice's SHIPPING line, read back with its kind; the Shopify export's Shipping column;
 *  - every change audited `order.shipping`, with an event and a journal entry.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { DEFAULT_PROGRAM } from '../../src/server/services/club-program.js';
import { linesOf } from '../../src/server/services/invoices.js';
import { orderReference } from '../../src/server/services/orders.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
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

describe('the orders\' shipping (BP-19 T4)', () => {
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
  const orderRow = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const shippingOfRow = async (id: string) => {
    const o = await orderRow(id);
    return [o.shipping_service, o.shipping_minor, o.shipping_benefit];
  };
  const invoiceOf = async (id: string) => t.db.selectFrom('invoices').selectAll().where('order_id', '=', id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow();
  const auditsOf = (id: string, action: string) => t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('target_id', '=', id).where('action', '=', action).orderBy('id').execute();
  /** An account holding `n` pieces: 5 make it PLATINE, 10 PALLADIUM. */
  const accountWith = async (n: number) => {
    const a = await createAccount(t.db);
    if (n > 0) await holdPieces(t.db, a.id, n, f.modelId);
    return a;
  };
  const pay = (id: string) => {
    clock.advance(MINUTE);
    return orders().transition(id, { to: 'PAID' }, admin);
  };

  /** A private salon's order closed as ACCEPTED for `accountId`; priced when `priceMinor` is given. */
  async function salonOrder(accountId: string, o: { priceMinor?: number; currency?: 'EUR' | 'GBP' } = {}) {
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    if (o.priceMinor !== undefined) await orders().setTerms(id, { sizeLabel: '58', priceMinor: o.priceMinor, currency: o.currency ?? 'EUR' }, admin);
    return id;
  }

  /** A LIVE sale of `quantity` pieces by `account`: entered, the line, the seal held, PAY. Its orders by piece. */
  async function liveSale(account: { id: string; actor: Actor }, quantity: number) {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 5 }], perAccount: quantity, priceMinor: 480_000 });
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(account.id, r.id, { sizeId: r.sizes[0]!.id, quantity }, account.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(account.id, r.id))!.turn!.token!;
    await f.live.press(account.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(account.id, r.id, token, account.actor);
    await f.live.confirm(account.id, r.id, account.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', account.id).executeTakeFirstOrThrow();
    return t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).orderBy('piece').execute();
  }

  it('reads the tier at the order\'s creation: PLATINE\'s free standard, PALLADIUM\'s free express; below PLATINE, none, and MARK PAID as before', async () => {
    expect(DEFAULT_PROGRAM).toMatchObject({ shippingFreePlatine: 'STANDARD', shippingFreePalladium: 'EXPRESS' });
    const [titane, platine, palladium] = [await accountWith(1), await accountWith(5), await accountWith(10)];
    const [below, standard, express] = [await salonOrder(titane.id), await salonOrder(platine.id), await salonOrder(palladium.id)];
    expect(await shippingOfRow(below)).toEqual([null, null, null]);
    expect(await shippingOfRow(standard)).toEqual(['STANDARD', 0, 2]);
    expect(await shippingOfRow(express)).toEqual(['EXPRESS', 0, 3]);
    expect((await orders().get(express)).shipping).toEqual({ service: 'EXPRESS', minor: 0, benefit: 3 });
    // Below PLATINE, no rate: no shipping, no SHIPPING line, and MARK PAID as before.
    await orders().setTerms(below, { sizeLabel: '58', priceMinor: 300_000, currency: 'EUR' }, admin);
    await pay(below);
    expect(linesOf((await invoiceOf(below)).lines).map((l) => l.kind)).toEqual(['PIECE']);
    // The creation's audit says the shipping it fixed.
    expect((await auditsOf(standard, 'order.create'))[0]!.details).toMatchObject({ shipping: { service: 'STANDARD', minor: 0, benefit: 2 } });
    // THE PROGRAM sets the free shipping: NONE for PLATINE gives none; PALLADIUM's own NONE falls to PLATINE's.
    const program = ctx.services.clubProgram;
    await program.update({ ...(await program.read()), shippingFreePlatine: 'NONE', shippingFreePalladium: 'NONE' }, admin);
    expect(await shippingOfRow(await salonOrder(platine.id))).toEqual([null, null, null]);
    await program.update({ ...(await program.read()), shippingFreePlatine: 'EXPRESS', shippingFreePalladium: 'NONE' }, admin);
    expect(await shippingOfRow(await salonOrder(palladium.id))).toEqual(['EXPRESS', 0, 2]);
    await t.db.deleteFrom('club_program_settings').execute();
  });

  it('keeps an order\'s free shipping after its tier drops; the next order follows the tier', async () => {
    const a = await accountWith(5);
    const kept = await salonOrder(a.id);
    // A piece passed on: TITANE now.
    const piece = await t.db.selectFrom('ownership').select('id').where('account_id', '=', a.id).where('ended_at', 'is', null).executeTakeFirstOrThrow();
    await t.db.updateTable('ownership').set({ ended_at: clock.now(), ended_reason: 'TRANSFERRED_OUT' }).where('id', '=', piece.id).execute();
    expect(await shippingOfRow(kept)).toEqual(['STANDARD', 0, 2]);
    expect(await shippingOfRow(await salonOrder(a.id))).toEqual([null, null, null]);
    await orders().setTerms(kept, { sizeLabel: '58', priceMinor: 300_000, currency: 'EUR' }, admin);
    await pay(kept);
    expect(linesOf((await invoiceOf(kept)).lines).find((l) => l.kind === 'SHIPPING')).toEqual({ kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: 'FREE · PLATINE', amountMinor: 0 });
  });

  it('enters a fee by hand while RESERVED: its SHIPPING line; empty clears it; never over a free benefit; express below PALLADIUM at its fee; audited order.shipping', async () => {
    const titane = await accountWith(1);
    const o = await salonOrder(titane.id, { priceMinor: 300_000 });
    const view = await orders().setTerms(o, { shippingService: 'STANDARD', shippingMinor: 2_000 }, admin);
    expect(view.shipping).toEqual({ service: 'STANDARD', minor: 2_000, benefit: null });
    const [audit] = await auditsOf(o, 'order.shipping');
    expect(audit).toEqual({ actor_type: 'admin', details: expect.objectContaining({ from: 'RESERVED', to: 'RESERVED', service: 'STANDARD', minor: 2_000, benefit: null }) });
    expect((await t.db.selectFrom('order_events').select('action').where('order_id', '=', o).execute()).map((e) => e.action)).toContain('order.shipping');
    expect((await t.db.selectFrom('event_journal').select('payload').where('entity_id', '=', o).where('type', '=', 'order.shipping').executeTakeFirstOrThrow()).payload).toMatchObject({ shippingService: 'STANDARD', shippingMinor: 2_000 });
    // Cleared: no shipping; set again; both or neither; a fee in no currency is refused.
    expect((await orders().setTerms(o, { shippingService: null, shippingMinor: null }, admin)).shipping).toEqual({ service: null, minor: null, benefit: null });
    await rejects(orders().setTerms(o, { shippingService: 'STANDARD' }, admin), 'VALIDATION_FAILED', 400);
    await rejects(orders().setTerms(o, { shippingService: null, shippingMinor: null }, admin), 'VALIDATION_FAILED', 400);
    const unpriced = await salonOrder(titane.id);
    await rejects(orders().setTerms(unpriced, { shippingService: 'STANDARD', shippingMinor: 2_000 }, admin), 'VALIDATION_FAILED', 400);
    await orders().setTerms(o, { shippingService: 'EXPRESS', shippingMinor: 4_000 }, admin);
    await pay(o);
    const invoice = await invoiceOf(o);
    expect(linesOf(invoice.lines)).toEqual([
      { kind: 'PIECE', label: 'MONOLITHE · SIZE 58', detail: 'THE PRIVATE SALON', amountMinor: 300_000 },
      { kind: 'SHIPPING', label: 'SHIPPING · EXPRESS', detail: null, amountMinor: 4_000 },
    ]);
    expect(invoice.total_minor).toBe(304_000);
    // Paid: the shipping no longer changes.
    await rejects(orders().setTerms(o, { shippingService: null, shippingMinor: null }, admin), 'ORDER_PAID', 409);

    // A free benefit: no fee on its service; express below PALLADIUM is paid at the fee entered, the benefit then gone.
    const platine = await accountWith(5);
    const free = await salonOrder(platine.id, { priceMinor: 300_000 });
    await rejects(orders().setTerms(free, { shippingService: 'STANDARD', shippingMinor: 2_000 }, admin), 'ORDER_SHIPPING_FREE', 409);
    expect((await orders().setTerms(free, { shippingService: 'EXPRESS', shippingMinor: 3_500 }, admin)).shipping).toEqual({ service: 'EXPRESS', minor: 3_500, benefit: null });
  });

  it('applies an optional rate at creation, and to a salon\'s or an unpriced draw\'s order when its price gives it its currency', async () => {
    await ctx.services.clubProgram.setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 2_000 }, { currency: 'GBP', service: 'STANDARD', feeMinor: 1_800 }], admin);
    const titane = await accountWith(1);
    // A salon's order: no currency at its creation, the rate of its first currency then.
    const salon = await salonOrder(titane.id);
    expect(await shippingOfRow(salon)).toEqual([null, null, null]);
    await orders().setTerms(salon, { sizeLabel: '58', priceMinor: 300_000, currency: 'GBP' }, admin);
    expect(await shippingOfRow(salon)).toEqual(['STANDARD', 1_800, null]);
    expect((await auditsOf(salon, 'order.shipping'))[0]!.details).toMatchObject({ service: 'STANDARD', minor: 1_800, rate: true });
    // Its price changed in the same currency: the shipping stays as set.
    await orders().setTerms(salon, { priceMinor: 305_000, currency: 'GBP' }, admin);
    expect(await shippingOfRow(salon)).toEqual(['STANDARD', 1_800, null]);
    // In another currency: the rate follows it, audited as the rate's; a currency without a rate gives no shipping.
    await orders().setTerms(salon, { priceMinor: 310_000, currency: 'EUR' }, admin);
    expect(await shippingOfRow(salon)).toEqual(['STANDARD', 2_000, null]);
    expect((await auditsOf(salon, 'order.shipping')).map((a) => a.details)).toEqual([
      expect.objectContaining({ service: 'STANDARD', minor: 1_800, rate: true }),
      expect.objectContaining({ service: 'STANDARD', minor: 2_000, rate: true }),
    ]);
    await orders().setTerms(salon, { priceMinor: 320_000, currency: 'USD' }, admin);
    expect(await shippingOfRow(salon)).toEqual([null, null, null]);
    // A fee entered by hand stays as entered when the currency changes: Client Services enters it again.
    await orders().setTerms(salon, { shippingService: 'STANDARD', shippingMinor: 2_500 }, admin);
    await orders().setTerms(salon, { priceMinor: 300_000, currency: 'EUR' }, admin);
    expect(await shippingOfRow(salon)).toEqual(['STANDARD', 2_500, null]);
    // A LIVE order is created in its currency: the rate at once. A PLATINE account keeps its free shipping.
    const [first] = await liveSale(titane, 1);
    expect([first!.shipping_service, first!.shipping_minor, first!.shipping_benefit]).toEqual(['STANDARD', 2_000, null]);
    const [platineOrder] = await liveSale(await accountWith(5), 1);
    expect([platineOrder!.shipping_service, platineOrder!.shipping_minor, platineOrder!.shipping_benefit]).toEqual(['STANDARD', 0, 2]);
    // An unpriced draw's order: the rate when Client Services prices it.
    const drop = await ctx.services.drops.create({ modelId: f.modelId, title: 'A DRAW', quantity: 1, opensAt: new Date(clock.now().getTime() + HOUR), closesAt: new Date(clock.now().getTime() + 2 * HOUR), earlyAccessHours: 0 }, admin);
    await ctx.services.drops.publish(drop.id, admin);
    clock.advance(HOUR + MINUTE);
    await ctx.services.drops.enter(titane.id, drop.id, titane.actor);
    clock.advance(HOUR);
    await ctx.services.drops.draw(drop.id, admin);
    const entry = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop.id).executeTakeFirstOrThrow();
    await ctx.services.drops.confirm(drop.id, entry.id, null, admin);
    const draw = (await t.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry.id).executeTakeFirstOrThrow()).id;
    expect(await shippingOfRow(draw)).toEqual([null, null, null]);
    await orders().setTerms(draw, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    expect(await shippingOfRow(draw)).toEqual(['STANDARD', 2_000, null]);
    await ctx.services.clubProgram.setShippingRates([], admin);
  });

  it('charges a LIVE entry of three pieces one fee: the others travel with the first, with no SHIPPING line of their own, and follow it', async () => {
    await ctx.services.clubProgram.setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 2_500 }], admin);
    const a = await accountWith(1);
    const [first, second, third] = await liveSale(a, 3);
    expect([first!.shipping_service, first!.shipping_minor, first!.with_order_id]).toEqual(['STANDARD', 2_500, null]);
    for (const o of [second!, third!]) expect([o.shipping_service, o.shipping_minor, o.shipping_benefit, o.with_order_id]).toEqual(['STANDARD', 0, null, first!.id]);
    // The others never take a fee of their own.
    await rejects(orders().setTerms(second!.id, { shippingService: 'EXPRESS', shippingMinor: 4_000 }, admin), 'ORDER_SHIPPING_WITH', 409);
    // The first goes express: the others follow, each audited.
    await orders().setTerms(first!.id, { shippingService: 'EXPRESS', shippingMinor: 4_000 }, admin);
    for (const o of [second!, third!]) {
      expect(await shippingOfRow(o.id)).toEqual(['EXPRESS', 0, null]);
      expect((await auditsOf(o.id, 'order.shipping'))[0]!.details).toMatchObject({ service: 'EXPRESS', minor: 0, withOrderId: first!.id });
    }
    expect((await orders().get(second!.id)).withOrder).toEqual({ id: first!.id, reference: orderReference(first!.id), shipment: null });
    // Paid: one fee, on the first's invoice; the others carry no SHIPPING line.
    for (const o of [first!, second!, third!]) await pay(o.id);
    expect(linesOf((await invoiceOf(first!.id)).lines).filter((l) => l.kind === 'SHIPPING')).toEqual([{ kind: 'SHIPPING', label: 'SHIPPING · EXPRESS', detail: null, amountMinor: 4_000 }]);
    for (const o of [second!, third!]) expect(linesOf((await invoiceOf(o.id)).lines).map((l) => l.kind)).toEqual(['PIECE']);
    // MY PIECES: the first's fee, the others WITH ORDER OR-…; the Shopify export: one fee, on the first.
    const mine = await orders().forAccount(a.id);
    expect(mine.find((o) => o.id === first!.id)!.shipping).toEqual({ service: 'EXPRESS', minor: 4_000, benefit: null, withOrder: null });
    expect(mine.find((o) => o.id === second!.id)!.shipping).toEqual({ service: 'EXPRESS', minor: 0, benefit: null, withOrder: orderReference(first!.id) });
    const day = clock.now().toISOString().slice(0, 10);
    const csv = (await ctx.services.shopify.orderCsv({ from: day, to: day }, { email: (e) => e, buyer: (b) => b })).body;
    const header = csv.split('\r\n')[0]!.split(',').map((c) => c.replace(/^"|"$/g, ''));
    const rows = csv.trimEnd().split('\r\n').slice(1).map((l) => l.split('","').map((c) => c.replace(/^"|"$/g, '')));
    const at = (name: string) => header.indexOf(name);
    const byName = new Map(rows.filter((r) => r[at('Shipping')] !== '').map((r) => [r[at('Name')], r]));
    expect(byName.get(orderReference(first!.id))![at('Shipping')]).toBe('40.00');
    expect(byName.get(orderReference(first!.id))![at('Total')]).toBe('4840.00');
    expect(byName.get(orderReference(second!.id))![at('Shipping')]).toBe('0.00');
    await ctx.services.clubProgram.setShippingRates([], admin);
  });

  it('gives an unpriced draw\'s travelling piece no fee of its own when priced first; the first\'s rate then reaches only the RESERVED ones', async () => {
    await ctx.services.clubProgram.setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 1_500 }], admin);
    const a = await accountWith(1);
    const opensAt = new Date(clock.now().getTime() + 2 * HOUR);
    const drop = await ctx.services.drops.create({ modelId: f.modelId, title: 'A DRAW', quantity: 4, opensAt, closesAt: new Date(opensAt.getTime() + HOUR), earlyAccessHours: 0, earlyAccessPlatineHours: 0 }, admin);
    await ctx.services.drops.publish(drop.id, admin);
    await ctx.services.guarantees.grant(a.id, { scope: 'RELEASE', targetId: drop.id, pieces: 3, validUntil: '2026-12-31', visible: true }, admin);
    clock.set(new Date(opensAt.getTime() + MINUTE));
    await ctx.services.drops.enter(a.id, drop.id, a.actor);
    clock.advance(HOUR);
    await ctx.services.drops.draw(drop.id, admin);
    const entry = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop.id).executeTakeFirstOrThrow();
    await ctx.services.drops.confirm(drop.id, entry.id, null, admin);
    const [first, second, third] = await t.db.selectFrom('orders').selectAll().where('drop_entry_id', '=', entry.id).orderBy('piece').execute();
    for (const o of [second!, third!]) expect(o.with_order_id).toBe(first!.id);
    // Priced before the first: no fee of its own, whatever the rate of its currency.
    await orders().setTerms(second!.id, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    expect(await shippingOfRow(second!.id)).toEqual([null, null, null]);
    expect(await auditsOf(second!.id, 'order.shipping')).toEqual([]);
    // The third is priced and paid before the first: its shipping stays as it was paid.
    await orders().setTerms(third!.id, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    await pay(third!.id);
    expect(linesOf((await invoiceOf(third!.id)).lines).map((l) => l.kind)).toEqual(['PIECE']);
    // The first priced: the rate, once; the RESERVED piece follows at 0; the PAID one is left untouched.
    await orders().setTerms(first!.id, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    expect(await shippingOfRow(first!.id)).toEqual(['STANDARD', 1_500, null]);
    expect(await shippingOfRow(second!.id)).toEqual(['STANDARD', 0, null]);
    expect(await shippingOfRow(third!.id)).toEqual([null, null, null]);
    expect(await auditsOf(third!.id, 'order.shipping')).toEqual([]);
    await ctx.services.clubProgram.setShippingRates([], admin);
  });
});
